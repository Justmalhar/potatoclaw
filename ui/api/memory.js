'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

function getMemoryDir(agentId) {
  return path.join(DATA_DIR, 'memory', agentId);
}

function readFileSafe(filepath) {
  try {
    if (fs.existsSync(filepath)) return fs.readFileSync(filepath, 'utf-8');
  } catch (_) {}
  return null;
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ memoryManager }} ctx
 */
async function register(server, ctx) {
  // GET /api/memory/:agentId — MEMORY.md
  server.get('/api/memory/:agentId', async (req) => {
    const { agentId } = req.params;

    if (ctx.memoryManager) {
      try {
        const mgr = ctx.memoryManager.for?.(agentId);
        if (mgr) {
          const content = await mgr.readMemory();
          return { agentId, content };
        }
      } catch (_) {}
    }

    const memFile = path.join(getMemoryDir(agentId), 'MEMORY.md');
    const content = readFileSafe(memFile) || '';
    return { agentId, content };
  });

  // PUT /api/memory/:agentId — update MEMORY.md
  server.put('/api/memory/:agentId', async (req) => {
    const { agentId } = req.params;
    const { content = '' } = req.body || {};

    if (ctx.memoryManager) {
      try {
        const mgr = ctx.memoryManager.for?.(agentId);
        if (mgr) {
          await mgr.writeMemory(content);
          return { ok: true };
        }
      } catch (_) {}
    }

    const memDir = getMemoryDir(agentId);
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content, 'utf-8');
    return { ok: true };
  });

  // GET /api/memory/:agentId/logs — list daily log files
  server.get('/api/memory/:agentId/logs', async (req) => {
    const { agentId } = req.params;
    const memDir = getMemoryDir(agentId);

    let files = [];
    try {
      if (fs.existsSync(memDir)) {
        files = fs.readdirSync(memDir)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
          .sort()
          .reverse();
      }
    } catch (_) {}

    return { agentId, logs: files.map((f) => f.replace('.md', '')) };
  });

  // GET /api/memory/:agentId/logs/:date — specific day's log
  server.get('/api/memory/:agentId/logs/:date', async (req, reply) => {
    const { agentId, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const logFile = path.join(getMemoryDir(agentId), `${date}.md`);
    const content = readFileSafe(logFile);
    if (content === null) return reply.code(404).send({ error: 'Log not found' });

    return { agentId, date, content };
  });

  // POST /api/memory/:agentId/search — search memory
  server.post('/api/memory/:agentId/search', async (req, reply) => {
    const { agentId } = req.params;
    const { query } = req.body || {};
    if (!query) return reply.code(400).send({ error: 'query is required' });

    if (ctx.memoryManager) {
      try {
        const mgr = ctx.memoryManager.for?.(agentId);
        if (mgr) {
          const results = await mgr.searchMemory(query);
          return { agentId, query, results };
        }
      } catch (_) {}
    }

    // Fallback: simple text search
    const memDir = getMemoryDir(agentId);
    const results = [];
    const queryLower = query.toLowerCase();

    const searchFile = (filename, filepath) => {
      const content = readFileSafe(filepath);
      if (!content || !content.toLowerCase().includes(queryLower)) return;
      const lines = content.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          matches.push({ line: i + 1, context: lines.slice(Math.max(0, i - 1), i + 2).join('\n') });
          if (matches.length >= 5) break;
        }
      }
      if (matches.length) results.push({ file: filename, matches });
    };

    try {
      if (fs.existsSync(memDir)) {
        searchFile('MEMORY.md', path.join(memDir, 'MEMORY.md'));
        for (const file of fs.readdirSync(memDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))) {
          searchFile(file, path.join(memDir, file));
        }
      }
    } catch (_) {}

    return { agentId, query, results };
  });
}

module.exports = register;
