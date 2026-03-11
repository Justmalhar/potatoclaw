'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify  = require('fastify');

// ---------------------------------------------------------------------------
// Because the agents API reads/writes from DATA_DIR at module-load time we
// need to set DATA_DIR before requiring it.
// ---------------------------------------------------------------------------

let tmpDir;
let register;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uiagents-'));
  process.env.DATA_DIR = tmpDir;
  // Require after setting DATA_DIR so the module picks up the temp dir
  register = require('../../ui/api/agents');
});

afterAll(() => {
  delete process.env.DATA_DIR;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildServer() {
  const server = Fastify({ logger: false });
  await register(server, { agentRegistry: null, runTracker: null, taskManager: null });
  await server.ready();
  return server;
}

function agentPayload(overrides = {}) {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/agents', () => {
  describe('GET /api/agents', () => {
    test('returns empty agents array initially', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/agents' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.agents)).toBe(true);
    });
  });

  describe('POST /api/agents', () => {
    test('creates agent and returns 201', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload(),
      });
      expect(res.statusCode).toBe(201);
      const agent = JSON.parse(res.body);
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.model).toBe('claude-sonnet-4-6');
    });

    test('returns 400 when name is missing', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/agents',
        payload: { model: 'claude-sonnet-4-6' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 409 for duplicate agent id', async () => {
      const server = await buildServer();
      await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ id: 'dup_agent', name: 'Dup' }),
      });
      const res = await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ id: 'dup_agent', name: 'Dup 2' }),
      });
      expect(res.statusCode).toBe(409);
    });

    test('stamped with createdAt and updatedAt', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'Timestamped' }),
      });
      const agent = JSON.parse(res.body);
      expect(agent.createdAt).toBeDefined();
      expect(agent.updatedAt).toBeDefined();
    });
  });

  describe('GET /api/agents/:id', () => {
    test('returns agent by id', async () => {
      const server = await buildServer();
      const created = JSON.parse((await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'GetMe' }),
      })).body);

      const res = await server.inject({ method: 'GET', url: `/api/agents/${created.id}` });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).name).toBe('GetMe');
    });

    test('returns 404 for unknown id', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/agents/no_such_agent' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /api/agents/:id', () => {
    test('updates agent definition', async () => {
      const server = await buildServer();
      const created = JSON.parse((await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'Original' }),
      })).body);

      const res = await server.inject({
        method: 'PUT', url: `/api/agents/${created.id}`,
        payload: { ...created, name: 'Updated', description: 'New desc' },
      });
      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.body);
      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New desc');
    });

    test('returns 404 for unknown agent', async () => {
      const server = await buildServer();
      const res = await server.inject({
        method: 'PUT', url: '/api/agents/ghost',
        payload: { name: 'Ghost' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    test('deletes agent and returns 204', async () => {
      const server = await buildServer();
      const created = JSON.parse((await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'DeleteMe' }),
      })).body);

      const res = await server.inject({ method: 'DELETE', url: `/api/agents/${created.id}` });
      expect(res.statusCode).toBe(204);

      // Verify gone
      const check = await server.inject({ method: 'GET', url: `/api/agents/${created.id}` });
      expect(check.statusCode).toBe(404);
    });

    test('returns 404 for unknown agent', async () => {
      const server = await buildServer();
      const res = await server.inject({ method: 'DELETE', url: '/api/agents/no_such' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/agents/:id/memory', () => {
    test('returns empty string when no memory file exists', async () => {
      const server = await buildServer();
      const created = JSON.parse((await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'MemTest' }),
      })).body);

      const res = await server.inject({ method: 'GET', url: `/api/agents/${created.id}/memory` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content).toBe('');
    });
  });

  describe('PUT /api/agents/:id/memory', () => {
    test('writes memory content', async () => {
      const server = await buildServer();
      const created = JSON.parse((await server.inject({
        method: 'POST', url: '/api/agents',
        payload: agentPayload({ name: 'MemWrite' }),
      })).body);

      await server.inject({
        method: 'PUT', url: `/api/agents/${created.id}/memory`,
        payload: { content: '# Memory\n\nI remember things.' },
      });

      const res = await server.inject({ method: 'GET', url: `/api/agents/${created.id}/memory` });
      const body = JSON.parse(res.body);
      expect(body.content).toBe('# Memory\n\nI remember things.');
    });
  });
});
