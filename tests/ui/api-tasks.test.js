'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const Fastify = require('fastify');
const register = require('../../ui/api/tasks');

const TaskStore   = require('../../src/tasks/store');
const TaskManager = require('../../src/tasks/manager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-uitasks-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

async function buildServer() {
  const store   = new TaskStore(tmpDir);
  store.init();
  const manager = new TaskManager(store);

  const server = Fastify({ logger: false });
  await register(server, { taskManager: manager });
  await server.ready();
  return { server, manager, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/tasks', () => {
  describe('GET /api/tasks', () => {
    test('returns empty tasks array initially', async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/tasks' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(body.tasks).toHaveLength(0);
    });

    test('returns created tasks', async () => {
      const { server, manager } = await buildServer();
      await manager.create({ title: 'Alpha', priority: 'high', status: 'todo' });
      await manager.create({ title: 'Beta',  priority: 'low',  status: 'backlog' });
      const res = await server.inject({ method: 'GET', url: '/api/tasks' });
      const body = JSON.parse(res.body);
      expect(body.tasks.length).toBeGreaterThanOrEqual(2);
    });

    test('filters by status', async () => {
      const { server, manager } = await buildServer();
      await manager.create({ title: 'T1', status: 'todo' });
      await manager.create({ title: 'T2', status: 'done' });
      const res = await server.inject({ method: 'GET', url: '/api/tasks?status=todo' });
      const body = JSON.parse(res.body);
      expect(body.tasks.every(t => t.status === 'todo')).toBe(true);
    });
  });

  describe('POST /api/tasks', () => {
    test('creates a task and returns 201', async () => {
      const { server } = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/tasks',
        payload: { title: 'Fix the bug', priority: 'high' },
      });
      expect(res.statusCode).toBe(201);
      const task = JSON.parse(res.body);
      expect(task.title).toBe('Fix the bug');
      expect(task.id).toBeDefined();
    });

    test('returns 400 when title is missing', async () => {
      const { server } = await buildServer();
      const res = await server.inject({
        method: 'POST', url: '/api/tasks',
        payload: { priority: 'low' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/tasks/:id', () => {
    test('returns task by id', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'Get me', priority: 'medium' });
      const res = await server.inject({ method: 'GET', url: `/api/tasks/${task.id}` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Get me');
    });

    test('returns 404 for unknown id', async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: 'GET', url: '/api/tasks/nonexistent_id' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/tasks/:id/transition', () => {
    test('transitions task status', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'Do work', status: 'todo' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/transition`,
        payload: { status: 'in_progress' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('in_progress');
    });

    test('returns 400 when status is missing', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'T', status: 'todo' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/transition`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    test('deletes task and returns 204', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'Delete me' });
      const res = await server.inject({ method: 'DELETE', url: `/api/tasks/${task.id}` });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/tasks/stats', () => {
    test('returns stats object', async () => {
      const { server, manager } = await buildServer();
      await manager.create({ title: 'S1' });
      await manager.create({ title: 'S2' });
      const res = await server.inject({ method: 'GET', url: '/api/tasks/stats' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.total).toBe('number');
    });
  });

  describe('POST /api/tasks/:id/assign', () => {
    test('assigns agent to task', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'Assign me' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/assign`,
        payload: { agentId: 'engineer' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.assignedAgentId).toBe('engineer');
    });

    test('returns 400 when agentId missing', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'T' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/assign`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/tasks/:id/notes', () => {
    test('adds note to task', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'Noted' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/notes`,
        payload: { note: 'This is a note.' },
      });
      expect(res.statusCode).toBe(201);
    });

    test('returns 400 when note is missing', async () => {
      const { server, manager } = await buildServer();
      const task = await manager.create({ title: 'T' });
      const res = await server.inject({
        method: 'POST', url: `/api/tasks/${task.id}/notes`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('no task manager', () => {
    test('GET /api/tasks returns empty list when manager unavailable', async () => {
      const server = Fastify({ logger: false });
      await register(server, { taskManager: null });
      await server.ready();
      const res = await server.inject({ method: 'GET', url: '/api/tasks' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.tasks)).toBe(true);
    });

    test('POST /api/tasks returns 503 when manager unavailable', async () => {
      const server = Fastify({ logger: false });
      await register(server, { taskManager: null });
      await server.ready();
      const res = await server.inject({
        method: 'POST', url: '/api/tasks',
        payload: { title: 'T' },
      });
      expect(res.statusCode).toBe(503);
    });
  });
});
