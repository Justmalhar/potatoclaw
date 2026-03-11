'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// settings.js reads DATA_DIR at module load time — must set before require
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uisettings-'));
  process.env.DATA_DIR = tmpDir;
  register = require('../../ui/api/settings');
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/settings', () => {
  describe('GET /api/settings', () => {
    test('returns default settings', async () => {
      const server = await buildServer({ config: {} });
      const res = await server.inject({ method: 'GET', url: '/api/settings' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.defaultModel).toBe('string');
      expect(typeof body.defaultProvider).toBe('string');
      expect(typeof body.maxTurns).toBe('number');
      expect(typeof body.logLevel).toBe('string');
    });

    test('includes config-provided values', async () => {
      const server = await buildServer({
        config: { defaultModel: 'claude-haiku-4-5-20251001', maxTurns: 50 },
      });
      const res = await server.inject({ method: 'GET', url: '/api/settings' });
      const body = JSON.parse(res.body);
      expect(body.defaultModel).toBe('claude-haiku-4-5-20251001');
      expect(body.maxTurns).toBe(50);
    });

    test('includes dataDir in response', async () => {
      const server = await buildServer({ config: {} });
      const res = await server.inject({ method: 'GET', url: '/api/settings' });
      const body = JSON.parse(res.body);
      expect(typeof body.dataDir).toBe('string');
    });
  });

  describe('PUT /api/settings', () => {
    test('updates safe fields', async () => {
      const server = await buildServer({ config: {} });
      const res = await server.inject({
        method: 'PUT', url: '/api/settings',
        payload: { defaultModel: 'claude-sonnet-4-6', maxTurns: 200 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.defaultModel).toBe('claude-sonnet-4-6');
      expect(body.maxTurns).toBe(200);
    });

    test('persists settings to file', async () => {
      const server = await buildServer({ config: {} });
      await server.inject({
        method: 'PUT', url: '/api/settings',
        payload: { logLevel: 'debug' },
      });

      const settingsFile = path.join(tmpDir, 'settings.json');
      expect(fs.existsSync(settingsFile)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(saved.logLevel).toBe('debug');
    });

    test('does not allow changing dataDir', async () => {
      const server = await buildServer({ config: {} });
      const res = await server.inject({
        method: 'PUT', url: '/api/settings',
        payload: { dataDir: '/some/other/path' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // dataDir should remain unchanged (not /some/other/path)
      expect(body.dataDir).toBe(tmpDir);
    });

    test('updates live config object when provided', async () => {
      const config = { defaultModel: 'old-model', maxTurns: 10 };
      const server = await buildServer({ config });
      await server.inject({
        method: 'PUT', url: '/api/settings',
        payload: { maxTurns: 999 },
      });
      expect(config.maxTurns).toBe(999);
    });
  });
});
