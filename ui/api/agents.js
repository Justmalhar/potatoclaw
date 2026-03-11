'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');
const AGENTS_DIR = path.join(DATA_DIR, 'agents');

function ensureAgentsDir() {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function listAgentFiles() {
  ensureAgentsDir();
  return fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.json'));
}

function loadAgent(id) {
  const file = path.join(AGENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function saveAgent(agentDef) {
  ensureAgentsDir();
  fs.writeFileSync(
    path.join(AGENTS_DIR, `${agentDef.id}.json`),
    JSON.stringify(agentDef, null, 2),
    'utf-8'
  );
}

function deleteAgentFile(id) {
  const file = path.join(AGENTS_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function generateAgentId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ agentRegistry, runTracker, taskManager }} ctx
 */
async function register(server, ctx) {
  // GET /api/agents — list all agents with live status
  server.get('/api/agents', async () => {
    const files = listAgentFiles();
    const agents = [];

    for (const file of files) {
      const id = file.replace('.json', '');
      const def = loadAgent(id);
      if (!def) continue;

      let status = 'idle';
      let currentTask = null;

      if (ctx.agentRegistry) {
        try {
          const info = await ctx.agentRegistry.getStatus?.(id);
          if (info) {
            status = info.status || 'idle';
            currentTask = info.currentTask || null;
          }
        } catch (_) {}
      }

      agents.push({ ...def, status, currentTask });
    }

    return { agents };
  });

  // GET /api/agents/:id — agent details + status
  server.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params;
    const def = loadAgent(id);
    if (!def) return reply.code(404).send({ error: 'Agent not found' });

    let status = 'idle';
    let currentTask = null;
    if (ctx.agentRegistry) {
      try {
        const info = await ctx.agentRegistry.getStatus?.(id);
        if (info) { status = info.status || 'idle'; currentTask = info.currentTask || null; }
      } catch (_) {}
    }

    return { ...def, status, currentTask };
  });

  // POST /api/agents — create agent
  server.post('/api/agents', async (req, reply) => {
    const body = req.body || {};
    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const id = body.id || generateAgentId(body.name);
    if (loadAgent(id)) return reply.code(409).send({ error: `Agent '${id}' already exists` });

    const now = new Date().toISOString();
    const agent = {
      id,
      name: body.name,
      description: body.description || '',
      avatar: body.avatar || '🤖',
      model: body.model || 'claude-opus-4-6',
      provider: body.provider || 'claude',
      systemPrompt: body.systemPrompt || '',
      tools: body.tools || [],
      maxTurns: body.maxTurns || 100,
      permissionMode: body.permissionMode || 'bypassPermissions',
      workspacePath: body.workspacePath || `/data/workspaces/${id}`,
      createdAt: now,
      updatedAt: now,
    };

    saveAgent(agent);
    reply.code(201).send(agent);
  });

  // PUT /api/agents/:id — update agent definition
  server.put('/api/agents/:id', async (req, reply) => {
    const { id } = req.params;
    const existing = loadAgent(id);
    if (!existing) return reply.code(404).send({ error: 'Agent not found' });

    const body = req.body || {};
    const updated = {
      ...existing,
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };

    saveAgent(updated);
    return updated;
  });

  // DELETE /api/agents/:id
  server.delete('/api/agents/:id', async (req, reply) => {
    const { id } = req.params;
    if (!loadAgent(id)) return reply.code(404).send({ error: 'Agent not found' });
    deleteAgentFile(id);
    reply.code(204).send();
  });

  // GET /api/agents/:id/memory — MEMORY.md content
  server.get('/api/agents/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const memFile = path.join(DATA_DIR, 'memory', id, 'MEMORY.md');
    const content = fs.existsSync(memFile)
      ? fs.readFileSync(memFile, 'utf-8')
      : '';
    return { agentId: id, content };
  });

  // PUT /api/agents/:id/memory — update MEMORY.md
  server.put('/api/agents/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const { content = '' } = req.body || {};
    const memDir = path.join(DATA_DIR, 'memory', id);
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content, 'utf-8');
    return { ok: true };
  });

  // GET /api/agents/:id/runs — recent runs for this agent
  server.get('/api/agents/:id/runs', async (req) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit, 10) || 20;

    if (ctx.runTracker) {
      try {
        const result = await ctx.runTracker.list?.({ agentId: id, limit });
        return result || { runs: [], total: 0 };
      } catch (_) {}
    }

    // Fallback: read from runs directory
    const runsDir = path.join(DATA_DIR, 'runs');
    const indexPath = path.join(runsDir, 'index.json');
    if (!fs.existsSync(indexPath)) return { runs: [], total: 0 };

    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const runs = Object.values(index)
        .filter((r) => r.agentId === id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
      return { runs, total: runs.length };
    } catch {
      return { runs: [], total: 0 };
    }
  });
}

module.exports = register;
