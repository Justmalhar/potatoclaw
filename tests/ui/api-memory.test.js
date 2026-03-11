'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// memory.js reads DATA_DIR at module load time — must set before require
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uimemory-'));
  process.env.DATA_DIR = tmpDir;
  register = require('../../ui/api/memory');
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

function getMemoryDir(agentId) {
  return path.join(tmpDir, 'memory', agentId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/memory', () => {
  describe('GET /api/memory/:agentId', () => {
    test('returns empty content when no memory file', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/no_agent' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.agentId).toBe('no_agent');
      expect(body.content).toBe('');
    });

    test('returns MEMORY.md content from filesystem', async () => {
      const memDir = getMemoryDir('agent1');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# My Memory\n\nSome notes.', 'utf-8');

      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/agent1' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content).toContain('# My Memory');
    });
  });

  describe('PUT /api/memory/:agentId', () => {
    test('writes MEMORY.md content', async () => {
      const server = await buildServer({ memoryManager: null });
      await server.inject({
        method: 'PUT', url: '/api/memory/agent2',
        payload: { content: '# Agent 2 Memory\n\nNew content.' },
      });

      const memFile = path.join(getMemoryDir('agent2'), 'MEMORY.md');
      expect(fs.existsSync(memFile)).toBe(true);
      expect(fs.readFileSync(memFile, 'utf-8')).toContain('New content');
    });

    test('returns ok: true', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({
        method: 'PUT', url: '/api/memory/agent3',
        payload: { content: 'data' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });
  });

  describe('GET /api/memory/:agentId/logs', () => {
    test('returns empty logs when no memory dir', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/no_logs_agent/logs' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.logs)).toBe(true);
      expect(body.logs).toHaveLength(0);
    });

    test('returns daily log file list', async () => {
      const memDir = getMemoryDir('log_agent');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, '2026-01-01.md'), 'Day 1 log', 'utf-8');
      fs.writeFileSync(path.join(memDir, '2026-01-02.md'), 'Day 2 log', 'utf-8');
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), 'main memory', 'utf-8');

      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/log_agent/logs' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.logs).toContain('2026-01-01');
      expect(body.logs).toContain('2026-01-02');
      expect(body.logs).not.toContain('MEMORY'); // not a date-named file
    });
  });

  describe('GET /api/memory/:agentId/logs/:date', () => {
    test('returns 400 for invalid date format', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/agent/logs/invalid-date' });
      expect(res.statusCode).toBe(400);
    });

    test('returns 404 when log file not found', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/agent/logs/2025-01-01' });
      expect(res.statusCode).toBe(404);
    });

    test('returns log content for valid date', async () => {
      const memDir = getMemoryDir('dated_agent');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, '2026-03-12.md'), '## Today log\nWork done.', 'utf-8');

      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({ method: 'GET', url: '/api/memory/dated_agent/logs/2026-03-12' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.date).toBe('2026-03-12');
      expect(body.content).toContain('Work done');
    });
  });

  describe('POST /api/memory/:agentId/search', () => {
    test('returns 400 when query is missing', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({
        method: 'POST', url: '/api/memory/agent/search',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns search results from memory files', async () => {
      const memDir = getMemoryDir('search_agent');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# Notes\n\nImportant: remember the password is 1234.', 'utf-8');

      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({
        method: 'POST', url: '/api/memory/search_agent/search',
        payload: { query: 'password' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.query).toBe('password');
      expect(body.results.length).toBeGreaterThan(0);
    });

    test('returns empty results when query not found', async () => {
      const server = await buildServer({ memoryManager: null });
      const res = await server.inject({
        method: 'POST', url: '/api/memory/no_content_agent/search',
        payload: { query: 'quantum_flux_capacitor' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.results).toHaveLength(0);
    });
  });
});
