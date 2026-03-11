'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');
const RUNS_DIR = path.join(DATA_DIR, 'runs');

function loadIndex() {
  const indexPath = path.join(RUNS_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return {};
  try { return JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch { return {}; }
}

function loadRun(runId) {
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ runTracker }} ctx
 */
async function register(server, ctx) {

  // GET /api/runs/active — must be before /:id
  server.get('/api/runs/active', async () => {
    if (ctx.runTracker) {
      try {
        const result = await ctx.runTracker.list?.({ status: 'running', limit: 50 });
        if (result) return result;
      } catch (_) {}
    }

    const index = loadIndex();
    const active = Object.values(index)
      .filter((r) => r.status === 'running' || r.status === 'queued');
    return { runs: active, total: active.length };
  });

  // GET /api/runs
  server.get('/api/runs', async (req) => {
    const { agentId, taskId, status, limit = '50', offset = '0' } = req.query;

    if (ctx.runTracker) {
      try {
        const result = await ctx.runTracker.list?.({
          agentId: agentId || undefined,
          taskId: taskId || undefined,
          status: status || undefined,
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
        });
        if (result) return result;
      } catch (_) {}
    }

    // Fallback: read from files
    const index = loadIndex();
    let entries = Object.values(index);

    if (agentId) entries = entries.filter((r) => r.agentId === agentId);
    if (taskId) entries = entries.filter((r) => r.taskId === taskId);
    if (status) entries = entries.filter((r) => r.status === status);

    entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const total = entries.length;
    const lim = parseInt(limit, 10);
    const off = parseInt(offset, 10);
    const runs = entries.slice(off, off + lim);

    return { runs, total };
  });

  // GET /api/runs/:id — full run with all steps
  server.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params;

    if (ctx.runTracker) {
      try {
        const run = await ctx.runTracker.get?.(id);
        if (run) return run;
      } catch (_) {}
    }

    const run = loadRun(id);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });
}

module.exports = register;
