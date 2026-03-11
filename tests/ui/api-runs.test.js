'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// runs.js reads DATA_DIR at module load time — must set before require
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uiruns-'));
  process.env.DATA_DIR = tmpDir;
  register = require('../../ui/api/runs');
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

function makeRunTracker(runs = []) {
  return {
    list: jest.fn().mockResolvedValue({ runs, total: runs.length }),
    get: jest.fn().mockImplementation(async (id) => runs.find((r) => r.id === id) || null),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/runs', () => {
  describe('GET /api/runs (no runTracker)', () => {
    test('returns empty runs list from filesystem fallback', async () => {
      const server = await buildServer({ runTracker: null });
      const res = await server.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.runs)).toBe(true);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /api/runs (with runTracker)', () => {
    test('returns runs from tracker', async () => {
      const runs = [
        { id: 'r1', agentId: 'eng', status: 'done', createdAt: new Date().toISOString() },
        { id: 'r2', agentId: 'eng', status: 'running', createdAt: new Date().toISOString() },
      ];
      const server = await buildServer({ runTracker: makeRunTracker(runs) });
      const res = await server.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.runs.length).toBe(2);
    });
  });

  describe('GET /api/runs/active', () => {
    test('returns active runs from filesystem fallback', async () => {
      // Write a mock index.json with a running run
      const runsDir = path.join(tmpDir, 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      const idx = { r_running: { id: 'r_running', status: 'running' } };
      fs.writeFileSync(path.join(runsDir, 'index.json'), JSON.stringify(idx), 'utf-8');

      const server = await buildServer({ runTracker: null });
      const res = await server.inject({ method: 'GET', url: '/api/runs/active' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.runs)).toBe(true);
    });

    test('uses runTracker when available', async () => {
      const tracker = makeRunTracker([{ id: 'r1', status: 'running' }]);
      const server = await buildServer({ runTracker: tracker });
      const res = await server.inject({ method: 'GET', url: '/api/runs/active' });
      expect(res.statusCode).toBe(200);
      expect(tracker.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    });
  });

  describe('GET /api/runs/:id', () => {
    test('returns 404 when run not found', async () => {
      const server = await buildServer({ runTracker: null });
      const res = await server.inject({ method: 'GET', url: '/api/runs/no_such_run' });
      expect(res.statusCode).toBe(404);
    });

    test('returns run from tracker when found', async () => {
      const run = { id: 'r_found', agentId: 'eng', status: 'done' };
      const tracker = makeRunTracker([run]);
      const server = await buildServer({ runTracker: tracker });
      const res = await server.inject({ method: 'GET', url: '/api/runs/r_found' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('r_found');
    });

    test('falls back to file when tracker returns null', async () => {
      const tracker = { list: jest.fn(), get: jest.fn().mockResolvedValue(null) };
      // Write a run file
      const runsDir = path.join(tmpDir, 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      const run = { id: 'r_file', agentId: 'eng', status: 'done' };
      fs.writeFileSync(path.join(runsDir, 'r_file.json'), JSON.stringify(run), 'utf-8');

      const server = await buildServer({ runTracker: tracker });
      const res = await server.inject({ method: 'GET', url: '/api/runs/r_file' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe('r_file');
    });
  });
});
