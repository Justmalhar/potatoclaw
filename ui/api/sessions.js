'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

function getSessionsDir(agentId) {
  return path.join(DATA_DIR, 'sessions', agentId);
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ sessionManager }} ctx
 */
async function register(server, ctx) {
  // GET /api/sessions/:agentId — list sessions for agent
  server.get('/api/sessions/:agentId', async (req) => {
    const { agentId } = req.params;

    if (ctx.sessionManager) {
      try {
        const mgr = ctx.sessionManager.for?.(agentId);
        if (mgr) {
          const sessions = await mgr.listSessions();
          return { agentId, sessions };
        }
      } catch (_) {}
    }

    // Fallback: scan filesystem
    const dir = getSessionsDir(agentId);
    if (!fs.existsSync(dir)) return { agentId, sessions: [] };

    const sessions = [];
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.includes('.archive.'));
      for (const file of files) {
        const filepath = path.join(dir, file);
        let stat;
        try { stat = fs.statSync(filepath); } catch { continue; }
        let messageCount = 0;
        try {
          const raw = fs.readFileSync(filepath, 'utf-8');
          messageCount = raw.trim().split('\n').filter(Boolean).length;
        } catch (_) {}
        sessions.push({
          key: file.replace('.jsonl', ''),
          lastActivity: stat.mtimeMs,
          messageCount,
          fileSizeBytes: stat.size,
        });
      }
    } catch (_) {}

    return { agentId, sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity) };
  });

  // GET /api/sessions/:agentId/:key — transcript (paginated)
  server.get('/api/sessions/:agentId/:key', async (req, reply) => {
    const { agentId, key } = req.params;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    if (ctx.sessionManager) {
      try {
        const mgr = ctx.sessionManager.for?.(agentId);
        if (mgr) {
          const transcript = await mgr.getTranscript(key, limit);
          return { agentId, key, transcript, total: transcript.length };
        }
      } catch (_) {}
    }

    // Fallback: read JSONL file
    const dir = getSessionsDir(agentId);
    const sanitized = key.replace(/[^a-zA-Z0-9]/g, '-');
    const filepath = path.join(dir, `${sanitized}.jsonl`);

    if (!fs.existsSync(filepath)) return reply.code(404).send({ error: 'Session not found' });

    let transcript = [];
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      transcript = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (_) {}

    const total = transcript.length;
    const page = transcript.slice(offset, offset + limit);
    return { agentId, key, transcript: page, total };
  });

  // DELETE /api/sessions/:agentId/:key
  server.delete('/api/sessions/:agentId/:key', async (req, reply) => {
    const { agentId, key } = req.params;

    if (ctx.sessionManager) {
      try {
        const mgr = ctx.sessionManager.for?.(agentId);
        if (mgr) {
          await mgr.deleteSession(key);
          return reply.code(204).send();
        }
      } catch (_) {}
    }

    const dir = getSessionsDir(agentId);
    const sanitized = key.replace(/[^a-zA-Z0-9]/g, '-');
    const filepath = path.join(dir, `${sanitized}.jsonl`);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    reply.code(204).send();
  });
}

module.exports = register;
