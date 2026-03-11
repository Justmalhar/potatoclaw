'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');

// ---------------------------------------------------------------------------
// logs.js reads DATA_DIR at module load time — must set before require.
// NOTE: The module also keeps a module-level logBuffer, so we need a fresh
// require each time to avoid cross-test pollution of the buffer.
// ---------------------------------------------------------------------------

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uilogs-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildServer() {
  const register = require('../../ui/api/logs');
  const server = Fastify({ logger: false });
  await register(server, {});
  await server.ready();
  return { server, register };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/logs', () => {
  describe('GET /api/logs/history', () => {
    test('returns empty lines when no log file and buffer empty', async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/logs/history' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.lines)).toBe(true);
      expect(body.lines).toHaveLength(0);
    });

    test('returns lines from log file when buffer is empty', async () => {
      const logDir = path.join(tmpDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const logLines = [
        JSON.stringify({ level: 30, msg: 'Server started', time: Date.now() }),
        JSON.stringify({ level: 40, msg: 'Warning occurred', time: Date.now() }),
      ];
      fs.writeFileSync(path.join(logDir, 'potatoclaw.log'), logLines.join('\n'), 'utf-8');

      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/logs/history' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.lines.length).toBeGreaterThanOrEqual(2);
    });

    test('filters logs by level', async () => {
      const logDir = path.join(tmpDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const logLines = [
        JSON.stringify({ level: 20, msg: 'debug msg', time: Date.now() }),
        JSON.stringify({ level: 30, msg: 'info msg', time: Date.now() }),
        JSON.stringify({ level: 50, msg: 'error msg', time: Date.now() }),
      ];
      fs.writeFileSync(path.join(logDir, 'potatoclaw.log'), logLines.join('\n'), 'utf-8');

      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/logs/history?level=error' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Should only return error level (50)
      expect(body.lines.every((l) => l.level >= 50)).toBe(true);
    });

    test('parses JSON log lines', async () => {
      const logDir = path.join(tmpDir, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const entry = { level: 30, msg: 'test message', time: Date.now() };
      fs.writeFileSync(path.join(logDir, 'potatoclaw.log'), JSON.stringify(entry), 'utf-8');

      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/logs/history' });
      const body = JSON.parse(res.body);
      expect(body.lines.length).toBeGreaterThanOrEqual(1);
      expect(body.lines[0].msg).toBe('test message');
    });
  });

  describe('ingestLogLine', () => {
    test('exported function exists', () => {
      const logsModule = require('../../ui/api/logs');
      expect(typeof logsModule.ingestLogLine).toBe('function');
    });

    test('logEmitter is exported', () => {
      const logsModule = require('../../ui/api/logs');
      const { EventEmitter } = require('events');
      expect(logsModule.logEmitter).toBeInstanceOf(EventEmitter);
    });

    test('ingested lines appear in history', async () => {
      const logsModule = require('../../ui/api/logs');
      logsModule.ingestLogLine(JSON.stringify({ level: 30, msg: 'Ingested line', time: Date.now() }));

      const { server } = await buildServer();
      // Need to use the same module since we already ingested into the buffer
      // Rebuild using the already-required module
      const server2 = Fastify({ logger: false });
      await logsModule(server2, {});
      await server2.ready();

      const res = await server2.inject({ method: 'GET', url: '/api/logs/history' });
      const body = JSON.parse(res.body);
      expect(body.lines.some((l) => l.msg === 'Ingested line')).toBe(true);
    });
  });
});
