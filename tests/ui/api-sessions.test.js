'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// sessions.js reads DATA_DIR at module load time — must set before require
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uisessions-'));
  process.env.DATA_DIR = tmpDir;
  register = require('../../ui/api/sessions');
});

afterAll(() => {
  delete process.env.DATA_DIR;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildServer(ctx = {}) {
  const server = Fastify({ logger: false });
  await register(server, ctx);
  await server.ready();
  return server;
}

function writeSessionFile(agentId, key, messages) {
  const dir = path.join(tmpDir, 'sessions', agentId);
  fs.mkdirSync(dir, { recursive: true });
  const lines = messages.map((m) => JSON.stringify(m)).join('\n');
  fs.writeFileSync(path.join(dir, `${key}.jsonl`), lines, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/sessions', () => {
  describe('GET /api/sessions/:agentId', () => {
    test('returns empty sessions when no sessions dir', async () => {
      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/sessions/noagent' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.agentId).toBe('noagent');
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(0);
    });

    test('returns sessions from filesystem', async () => {
      writeSessionFile('myagent', 'session-key-1', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);

      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/sessions/myagent' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions.length).toBeGreaterThanOrEqual(1);
      expect(body.sessions[0].key).toBe('session-key-1');
      expect(body.sessions[0].messageCount).toBe(2);
    });
  });

  describe('GET /api/sessions/:agentId/:key', () => {
    test('returns 404 when session not found', async () => {
      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/sessions/myagent/no-such-key' });
      expect(res.statusCode).toBe(404);
    });

    test('returns transcript from file', async () => {
      const messages = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
      ];
      writeSessionFile('myagent', 'tx-session', messages);

      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/sessions/myagent/tx-session' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.agentId).toBe('myagent');
      expect(body.key).toBe('tx-session');
      expect(body.transcript.length).toBe(2);
      expect(body.total).toBe(2);
    });

    test('respects limit and offset query params', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
      writeSessionFile('myagent', 'paged-session', messages);

      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({
        method: 'GET',
        url: '/api/sessions/myagent/paged-session?limit=3&offset=2',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.transcript.length).toBe(3);
      expect(body.total).toBe(10);
    });
  });

  describe('DELETE /api/sessions/:agentId/:key', () => {
    test('deletes session file and returns 204', async () => {
      writeSessionFile('myagent', 'del-session', [{ role: 'user', content: 'bye' }]);

      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'DELETE', url: '/api/sessions/myagent/del-session' });
      expect(res.statusCode).toBe(204);

      // Verify gone
      const filePath = path.join(tmpDir, 'sessions', 'myagent', 'del-session.jsonl');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('returns 204 even when session does not exist', async () => {
      const server = await buildServer({ sessionManager: null });
      const res = await server.inject({ method: 'DELETE', url: '/api/sessions/myagent/nonexistent' });
      expect(res.statusCode).toBe(204);
    });
  });
});
