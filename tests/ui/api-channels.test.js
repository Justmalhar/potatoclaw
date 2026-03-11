'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// channels.js reads DATA_DIR at module load time — must set before require
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uichannels-'));
  process.env.DATA_DIR = tmpDir;
  register = require('../../ui/api/channels');
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

function channelPayload(overrides = {}) {
  return {
    platform: 'slack',
    channelId: 'C123',
    agentId: 'engineer',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/channels', () => {
  describe('GET /api/channels', () => {
    test('returns empty channels array initially', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/channels' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.channels)).toBe(true);
    });
  });

  describe('POST /api/channels', () => {
    test('creates channel binding and returns 201', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/channels',
        payload: channelPayload({ channelId: 'C_UNIQUE1' }),
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('slack:C_UNIQUE1');
      expect(body.agentId).toBe('engineer');
    });

    test('returns 400 when platform is missing', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/channels',
        payload: { channelId: 'C1', agentId: 'eng' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when channelId is missing', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/channels',
        payload: { platform: 'slack', agentId: 'eng' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when agentId is missing', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/channels',
        payload: { platform: 'slack', channelId: 'C1' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('sets default summaryEnabled and recentMessageWindow', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/channels',
        payload: channelPayload({ channelId: 'C_DEFAULTS' }),
      });
      const body = JSON.parse(res.body);
      expect(body.summaryEnabled).toBe(true);
      expect(body.recentMessageWindow).toBe(20);
    });
  });

  describe('PUT /api/channels/:id', () => {
    test('updates channel binding', async () => {
      const server = await buildServer();
      await server.inject({
        method: 'POST', url: '/api/channels',
        payload: channelPayload({ channelId: 'C_UPDATE' }),
      });

      const res = await server.inject({
        method: 'PUT', url: '/api/channels/slack:C_UPDATE',
        payload: { agentId: 'researcher' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.agentId).toBe('researcher');
    });

    test('returns 404 for unknown channel', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'PUT', url: '/api/channels/slack:NOTEXIST',
        payload: { agentId: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/channels/:id', () => {
    test('deletes channel binding and returns 204', async () => {
      const server = await buildServer();
      await server.inject({
        method: 'POST', url: '/api/channels',
        payload: channelPayload({ channelId: 'C_DEL' }),
      });

      const res = await server.inject({ method: 'DELETE', url: '/api/channels/slack:C_DEL' });
      expect(res.statusCode).toBe(204);
    });

    test('returns 404 for unknown channel', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'DELETE', url: '/api/channels/slack:GHOST' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/channels/:id/memory', () => {
    test('returns empty content when no memory file', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/channels/slack:NOMEM/memory' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content).toBe('');
    });
  });

  describe('PUT /api/channels/:id/memory', () => {
    test('writes and reads back memory content', async () => {
      const server = await buildServer();
      await server.inject({
        method: 'PUT', url: '/api/channels/slack:C_MEM/memory',
        payload: { content: '# Memory\n\nRemember this.' },
      });

      const res = await server.inject({ method: 'GET', url: '/api/channels/slack:C_MEM/memory' });
      const body = JSON.parse(res.body);
      expect(body.content).toBe('# Memory\n\nRemember this.');
    });
  });

  describe('GET /api/channels/:id/summary', () => {
    test('returns empty summary when no summary file', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/channels/slack:NOSUM/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.summary).toBe('');
    });
  });
});
