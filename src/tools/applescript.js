'use strict';

/**
 * AppleScript MCP Tool — macOS automation via osascript.
 * Only available on macOS (process.platform === 'darwin').
 *
 * Export: createAppleScriptTool(context)
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { z } = require('zod');

const execFileAsync = promisify(execFile);

/**
 * Run an AppleScript snippet via osascript.
 * @param {string} script
 * @returns {Promise<{ success: boolean, output?: string, stderr?: string, error?: string }>}
 */
async function runOsascript(script) {
  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], { timeout: 30000 });
    return {
      success: true,
      output: stdout.trim(),
      ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      ...(err.stderr ? { stderr: err.stderr.trim() } : {}),
    };
  }
}

/**
 * @param {Object} [context] - Unused for now; reserved for future config
 * @returns {{ name, version, tools } | null}
 */
function createAppleScriptTool(context) {
  if (process.platform !== 'darwin') {
    console.log('[AppleScript] Not on macOS — AppleScript tools disabled');
    return null;
  }

  console.log('[AppleScript] Tools available');

  const tools = [
    {
      name: 'run_script',
      description:
        'Execute arbitrary AppleScript code via osascript. Returns stdout/stderr. Use for macOS automation — controlling apps, system actions, UI scripting, etc.',
      inputSchema: z.object({
        script: z.string().describe('The AppleScript code to execute'),
      }),
      handler: async (input) => {
        const result = await runOsascript(input.script);
        return { result };
      },
    },

    {
      name: 'list_apps',
      description: 'List currently running (foreground) applications on macOS.',
      inputSchema: z.object({}),
      handler: async () => {
        const result = await runOsascript(
          'tell application "System Events" to get name of every process whose background only is false'
        );
        return { result };
      },
    },

    {
      name: 'activate_app',
      description: 'Bring a macOS application to the foreground.',
      inputSchema: z.object({
        app_name: z.string().describe('Name of the application to activate (e.g. "Safari", "Finder")'),
      }),
      handler: async (input) => {
        const result = await runOsascript(`tell application "${input.app_name}" to activate`);
        return { result };
      },
    },

    {
      name: 'display_notification',
      description: 'Show a macOS notification banner.',
      inputSchema: z.object({
        message: z.string().describe('Notification body text'),
        title: z.string().optional().describe('Notification title'),
        subtitle: z.string().optional().describe('Notification subtitle'),
      }),
      handler: async (input) => {
        const titlePart = input.title ? ` with title "${input.title}"` : '';
        const subtitlePart = input.subtitle ? ` subtitle "${input.subtitle}"` : '';
        const result = await runOsascript(
          `display notification "${input.message}"${subtitlePart}${titlePart}`
        );
        return { result };
      },
    },

    {
      name: 'get_clipboard',
      description: 'Get the current clipboard content.',
      inputSchema: z.object({}),
      handler: async () => {
        const result = await runOsascript('get the clipboard');
        return { result };
      },
    },

    {
      name: 'set_clipboard',
      description: 'Set the clipboard content.',
      inputSchema: z.object({
        text: z.string().describe('Text to put on the clipboard'),
      }),
      handler: async (input) => {
        // Escape double quotes in the text
        const escaped = input.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await runOsascript(`set the clipboard to "${escaped}"`);
        return { result };
      },
    },

    {
      name: 'open_url',
      description: 'Open a URL in the default browser.',
      inputSchema: z.object({
        url: z.string().url().describe('URL to open'),
      }),
      handler: async (input) => {
        const result = await runOsascript(`open location "${input.url}"`);
        return { result };
      },
    },
  ];

  return {
    name: 'applescript',
    version: '1.0.0',
    tools,
  };
}

module.exports = { createAppleScriptTool };
