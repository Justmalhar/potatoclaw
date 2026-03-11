'use strict';

/**
 * Filesystem MCP Tool — scoped to agent workspace directory.
 * Prevents path traversal by resolving all paths within workspacePath.
 *
 * Export: createFilesystemTool(context)
 *   context = { workspacePath: '/data/workspaces/${agentId}' }
 */

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

/**
 * Resolve a user-supplied relative path to an absolute path inside workspacePath.
 * Throws if the result escapes the workspace (path traversal attempt).
 *
 * @param {string} workspacePath
 * @param {string} userPath
 * @returns {string}
 */
function safePath(workspacePath, userPath) {
  const resolved = path.resolve(workspacePath, userPath || '.');
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new Error(`Access denied: path "${userPath}" is outside the workspace`);
  }
  return resolved;
}

/**
 * @param {{ workspacePath: string }} context
 * @returns {{ name, version, tools }}
 */
function createFilesystemTool(context) {
  const workspacePath = (context && context.workspacePath) || '/data/workspaces/default';

  // Ensure workspace exists
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const tools = [
    {
      name: 'read_file',
      description: 'Read a file from the agent workspace. Paths are relative to the workspace root.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the workspace'),
      }),
      handler: async (input) => {
        try {
          const abs = safePath(workspacePath, input.path);
          if (!fs.existsSync(abs)) {
            return { result: { success: false, error: `File not found: ${input.path}` } };
          }
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) {
            return { result: { success: false, error: `"${input.path}" is a directory, not a file` } };
          }
          const content = fs.readFileSync(abs, 'utf-8');
          return { result: { success: true, path: input.path, content, sizeBytes: stat.size } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'write_file',
      description: 'Write content to a file in the agent workspace. Creates parent directories as needed.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the workspace'),
        content: z.string().describe('Content to write'),
      }),
      handler: async (input) => {
        try {
          const abs = safePath(workspacePath, input.path);
          const dir = path.dirname(abs);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(abs, input.content, 'utf-8');
          return { result: { success: true, path: input.path, sizeBytes: Buffer.byteLength(input.content, 'utf-8') } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'list_directory',
      description: 'List the contents of a directory in the agent workspace.',
      inputSchema: z.object({
        path: z.string().optional().describe('Relative path to the directory (default: workspace root)'),
      }),
      handler: async (input) => {
        try {
          const abs = safePath(workspacePath, input.path || '.');
          if (!fs.existsSync(abs)) {
            return { result: { success: false, error: `Directory not found: ${input.path || '.'}` } };
          }
          const stat = fs.statSync(abs);
          if (!stat.isDirectory()) {
            return { result: { success: false, error: `"${input.path}" is not a directory` } };
          }

          const entries = fs.readdirSync(abs);
          const items = entries.map((name) => {
            const itemPath = path.join(abs, name);
            let itemStat;
            try { itemStat = fs.statSync(itemPath); } catch { return { name, type: 'unknown', size: 0, modified: null }; }
            return {
              name,
              type: itemStat.isDirectory() ? 'directory' : 'file',
              size: itemStat.size,
              modified: itemStat.mtime.toISOString(),
            };
          });

          return { result: { success: true, path: input.path || '.', entries: items, count: items.length } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'delete_file',
      description: 'Delete a file from the agent workspace.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the workspace'),
      }),
      handler: async (input) => {
        try {
          const abs = safePath(workspacePath, input.path);
          if (!fs.existsSync(abs)) {
            return { result: { success: false, error: `File not found: ${input.path}` } };
          }
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) {
            return { result: { success: false, error: `"${input.path}" is a directory. Use delete_directory instead.` } };
          }
          fs.unlinkSync(abs);
          return { result: { success: true, path: input.path } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'search_files',
      description: 'Search file contents in the workspace (grep-like). Returns matching lines with file and line number.',
      inputSchema: z.object({
        query: z.string().describe('Search query (case-insensitive substring match)'),
        path: z.string().optional().describe('Relative path to search within (default: workspace root)'),
      }),
      handler: async (input) => {
        try {
          const searchRoot = safePath(workspacePath, input.path || '.');
          const queryLower = input.query.toLowerCase();
          const results = [];

          function searchDir(dir) {
            let entries;
            try { entries = fs.readdirSync(dir); } catch { return; }
            for (const entry of entries) {
              const fullPath = path.join(dir, entry);
              let stat;
              try { stat = fs.statSync(fullPath); } catch { continue; }
              if (stat.isDirectory()) {
                // Skip hidden dirs like .git
                if (!entry.startsWith('.')) searchDir(fullPath);
              } else if (stat.isFile() && stat.size < 10 * 1024 * 1024) {
                // Only search text-like files (up to 10 MB)
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(queryLower)) {
                      const relativePath = path.relative(workspacePath, fullPath);
                      results.push({ file: relativePath, line: i + 1, content: lines[i].trim() });
                      if (results.length >= 200) return; // cap results
                    }
                  }
                } catch {
                  // Binary file or unreadable — skip
                }
              }
            }
          }

          searchDir(searchRoot);
          return { result: { success: true, query: input.query, matches: results, count: results.length } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'create_directory',
      description: 'Create a directory (and any missing parent directories) in the agent workspace.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the directory to create'),
      }),
      handler: async (input) => {
        try {
          const abs = safePath(workspacePath, input.path);
          fs.mkdirSync(abs, { recursive: true });
          return { result: { success: true, path: input.path } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },
  ];

  return {
    name: 'filesystem',
    version: '1.0.0',
    tools,
    workspacePath,
  };
}

module.exports = { createFilesystemTool };
