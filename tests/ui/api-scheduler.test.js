'use strict';

const Fastify = require('fastify');
const register = require('../../ui/api/scheduler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let jobCounter = 0;

function makeScheduler(opts = {}) {
  const jobs = [];
  return {
    list: jest.fn().mockReturnValue(jobs),
    scheduleDelayed: jest.fn().mockImplementation((params) => {
      const job = { success: true, jobId: `delayed-${++jobCounter}`, ...params };
      jobs.push(job);
      return job;
    }),
    scheduleRecurring: jest.fn().mockImplementation((params) => {
      const job = { success: true, jobId: `recurring-${++jobCounter}`, ...params };
      jobs.push(job);
      return job;
    }),
    scheduleCron: jest.fn().mockImplementation((params) => {
      const job = { success: true, jobId: `cron-${++jobCounter}`, ...params };
      jobs.push(job);
      return job;
    }),
    cancel: jest.fn().mockImplementation((id) => {
      const idx = jobs.findIndex((j) => j.jobId === id);
      if (idx === -1) return { success: false, error: 'Job not found' };
      jobs.splice(idx, 1);
      return { success: true };
    }),
    ...opts,
  };
}

async function buildServer(ctx = {}) {
  const server = Fastify({ logger: false });
  await register(server, ctx);
  await server.ready();
  return server;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI API /api/scheduler', () => {
  describe('GET /api/scheduler', () => {
    test('returns empty jobs when no scheduler', async () => {
      const server = await buildServer({ cronScheduler: null });
      const res = await server.inject({ method: 'GET', url: '/api/scheduler' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs).toHaveLength(0);
    });

    test('returns job list from scheduler', async () => {
      const scheduler = makeScheduler();
      scheduler.scheduleDelayed({ message: 'hello', delaySeconds: 60 });
      const server = await buildServer({ cronScheduler: scheduler });
      const res = await server.inject({ method: 'GET', url: '/api/scheduler' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/scheduler', () => {
    test('returns 503 when no scheduler', async () => {
      const server = await buildServer({ cronScheduler: null });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'delayed', message: 'hi', delaySeconds: 10 },
      });
      expect(res.statusCode).toBe(503);
    });

    test('returns 400 when type is missing', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { message: 'hi' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when message is missing', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'delayed', delaySeconds: 10 },
      });
      expect(res.statusCode).toBe(400);
    });

    test('creates delayed job', async () => {
      const scheduler = makeScheduler();
      const server = await buildServer({ cronScheduler: scheduler });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'delayed', message: 'run after delay', delaySeconds: 30 },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(scheduler.scheduleDelayed).toHaveBeenCalled();
    });

    test('returns 400 for delayed job missing delaySeconds', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'delayed', message: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('creates recurring job', async () => {
      const scheduler = makeScheduler();
      const server = await buildServer({ cronScheduler: scheduler });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'recurring', message: 'repeat', intervalSeconds: 60 },
      });
      expect(res.statusCode).toBe(201);
      expect(scheduler.scheduleRecurring).toHaveBeenCalled();
    });

    test('returns 400 for recurring job missing intervalSeconds', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'recurring', message: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('creates cron job', async () => {
      const scheduler = makeScheduler();
      const server = await buildServer({ cronScheduler: scheduler });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'cron', message: 'daily', cron: '0 9 * * *' },
      });
      expect(res.statusCode).toBe(201);
      expect(scheduler.scheduleCron).toHaveBeenCalled();
    });

    test('returns 400 for cron job missing cron expression', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'cron', message: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for unknown type', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({
        method: 'POST', url: '/api/scheduler',
        payload: { type: 'invalid', message: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/scheduler/:id', () => {
    test('returns 503 when no scheduler', async () => {
      const server = await buildServer({ cronScheduler: null });
      const res = await server.inject({ method: 'DELETE', url: '/api/scheduler/job-1' });
      expect(res.statusCode).toBe(503);
    });

    test('cancels job and returns 204', async () => {
      const scheduler = makeScheduler();
      const job = scheduler.scheduleDelayed({ message: 'cancel me', delaySeconds: 10 });
      const server = await buildServer({ cronScheduler: scheduler });
      const res = await server.inject({ method: 'DELETE', url: `/api/scheduler/${job.jobId}` });
      expect(res.statusCode).toBe(204);
    });

    test('returns 404 when job not found', async () => {
      const server = await buildServer({ cronScheduler: makeScheduler() });
      const res = await server.inject({ method: 'DELETE', url: '/api/scheduler/no-such-job' });
      expect(res.statusCode).toBe(404);
    });
  });
});
