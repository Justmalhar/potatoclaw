'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');
const CHANNELS_DIR = path.join(DATA_DIR, 'channels');

function ensureChannelsDir() {
  if (!fs.existsSync(CHANNELS_DIR)) fs.mkdirSync(CHANNELS_DIR, { recursive: true });
}

function listChannelFiles() {
  ensureChannelsDir();
  return fs.readdirSync(CHANNELS_DIR)
    .filter((f) => f.endsWith('.json') && !f.includes('-memory') && !f.includes('-summary'));
}

function loadChannel(id) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const file = path.join(CHANNELS_DIR, `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function saveChannel(binding) {
  ensureChannelsDir();
  const safe = binding.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  fs.writeFileSync(path.join(CHANNELS_DIR, `${safe}.json`), JSON.stringify(binding, null, 2), 'utf-8');
}

function deleteChannelFile(id) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const file = path.join(CHANNELS_DIR, `${safe}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {object} ctx
 */
async function register(server, ctx) {
  // GET /api/channels
  server.get('/api/channels', async () => {
    const files = listChannelFiles();
    const channels = [];
    for (const file of files) {
      const id = file.replace('.json', '');
      // Try loading via channelRegistry first
      let binding = null;
      if (ctx.channelRegistry) {
        try { binding = await ctx.channelRegistry.get?.(id); } catch (_) {}
      }
      if (!binding) {
        binding = loadChannel(id);
      }
      if (binding) channels.push(binding);
    }
    return { channels };
  });

  // POST /api/channels — create binding
  server.post('/api/channels', async (req, reply) => {
    const body = req.body || {};
    if (!body.platform || !body.channelId || !body.agentId) {
      return reply.code(400).send({ error: 'platform, channelId, and agentId are required' });
    }

    const id = `${body.platform}:${body.channelId}`;
    const now = new Date().toISOString();
    const binding = {
      id,
      platform: body.platform,
      channelId: body.channelId,
      channelName: body.channelName || body.channelId,
      agentId: body.agentId,
      systemPromptOverride: body.systemPromptOverride || '',
      toolOverrides: body.toolOverrides || { add: [], remove: [] },
      recentMessageWindow: body.recentMessageWindow || 20,
      summaryEnabled: body.summaryEnabled !== false,
      summaryIntervalMessages: body.summaryIntervalMessages || 50,
      createdAt: now,
    };

    saveChannel(binding);

    if (ctx.channelRegistry) {
      try { await ctx.channelRegistry.set?.(id, binding); } catch (_) {}
    }

    reply.code(201).send(binding);
  });

  // PUT /api/channels/:id
  server.put('/api/channels/:id', async (req, reply) => {
    const { id } = req.params;
    const existing = loadChannel(id);
    if (!existing) return reply.code(404).send({ error: 'Channel binding not found' });

    const updated = { ...existing, ...(req.body || {}), id };
    saveChannel(updated);

    if (ctx.channelRegistry) {
      try { await ctx.channelRegistry.set?.(id, updated); } catch (_) {}
    }

    return updated;
  });

  // DELETE /api/channels/:id
  server.delete('/api/channels/:id', async (req, reply) => {
    const { id } = req.params;
    if (!loadChannel(id)) return reply.code(404).send({ error: 'Channel binding not found' });
    deleteChannelFile(id);

    if (ctx.channelRegistry) {
      try { await ctx.channelRegistry.delete?.(id); } catch (_) {}
    }

    reply.code(204).send();
  });

  // GET /api/channels/:id/memory
  server.get('/api/channels/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
    const memFile = path.join(CHANNELS_DIR, `${safe}-memory.md`);
    const content = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf-8') : '';
    return { channelId: id, content };
  });

  // PUT /api/channels/:id/memory
  server.put('/api/channels/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const { content = '' } = req.body || {};
    ensureChannelsDir();
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
    fs.writeFileSync(path.join(CHANNELS_DIR, `${safe}-memory.md`), content, 'utf-8');
    return { ok: true };
  });

  // GET /api/channels/:id/summary
  server.get('/api/channels/:id/summary', async (req, reply) => {
    const { id } = req.params;
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
    const summaryFile = path.join(CHANNELS_DIR, `${safe}-summary.md`);
    const content = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf-8') : '';
    return { channelId: id, summary: content };
  });
}

module.exports = register;
