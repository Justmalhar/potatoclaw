'use strict';

const Fastify = require('fastify');
const register = require('../../ui/api/secrets');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(data = {}) {
  const store = { ...data };
  return {
    list: jest.fn().mockResolvedValue(Object.keys(store)),
    get: jest.fn().mockImplementation(async (key) => store[key]),
    set: jest.fn().mockImplementation(async (key, value) => { store[key] = value; }),
    delete: jest.fn().mockImplementation(async (key) => { delete store[key]; }),
    _data: store,
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

describe('UI API /api/secrets', () => {
  describe('GET /api/secrets', () => {
    test('returns 503 when store not available', async () => {
      const server = await buildServer({ secretsStore: null });
      const res = await server.inject({ method: 'GET', url: '/api/secrets' });
      expect(res.statusCode).toBe(503);
    });

    test('returns masked secrets list', async () => {
      const store = makeStore({ SLACK_TOKEN: 'xoxb-secret-value', SHORT: 'abc' });
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({ method: 'GET', url: '/api/secrets' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.secrets)).toBe(true);
      const slack = body.secrets.find((s) => s.key === 'SLACK_TOKEN');
      expect(slack).toBeDefined();
      expect(slack.maskedValue).toMatch(/xoxb\*+/);
    });

    test('masks short values as ****', async () => {
      const store = makeStore({ TINY: 'ab' });
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({ method: 'GET', url: '/api/secrets' });
      const body = JSON.parse(res.body);
      const tiny = body.secrets.find((s) => s.key === 'TINY');
      expect(tiny.maskedValue).toBe('****');
    });
  });

  describe('POST /api/secrets', () => {
    test('returns 503 when store not available', async () => {
      const server = await buildServer({ secretsStore: null });
      const res = await server.inject({
        method: 'POST', url: '/api/secrets',
        payload: { key: 'FOO', value: 'bar' },
      });
      expect(res.statusCode).toBe(503);
    });

    test('returns 400 when key is missing', async () => {
      const server = await buildServer({ secretsStore: makeStore() });
      const res = await server.inject({
        method: 'POST', url: '/api/secrets',
        payload: { value: 'bar' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when value is missing', async () => {
      const server = await buildServer({ secretsStore: makeStore() });
      const res = await server.inject({
        method: 'POST', url: '/api/secrets',
        payload: { key: 'FOO' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('sets secret and returns masked value', async () => {
      const store = makeStore();
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({
        method: 'POST', url: '/api/secrets',
        payload: { key: 'MY_SECRET', value: 'supersecret' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.key).toBe('MY_SECRET');
      expect(body.maskedValue).toMatch(/supe\*+/);
      expect(store.set).toHaveBeenCalledWith('MY_SECRET', 'supersecret');
    });
  });

  describe('DELETE /api/secrets/:key', () => {
    test('returns 503 when store not available', async () => {
      const server = await buildServer({ secretsStore: null });
      const res = await server.inject({ method: 'DELETE', url: '/api/secrets/FOO' });
      expect(res.statusCode).toBe(503);
    });

    test('deletes secret and returns 204', async () => {
      const store = makeStore({ DELME: 'value' });
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({ method: 'DELETE', url: '/api/secrets/DELME' });
      expect(res.statusCode).toBe(204);
      expect(store.delete).toHaveBeenCalledWith('DELME');
    });
  });

  describe('POST /api/secrets/test/:key', () => {
    test('returns 503 when store not available', async () => {
      const server = await buildServer({ secretsStore: null });
      const res = await server.inject({ method: 'POST', url: '/api/secrets/test/MY_KEY' });
      expect(res.statusCode).toBe(503);
    });

    test('returns isSet true when secret exists', async () => {
      const store = makeStore({ EXISTING: 'value' });
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({ method: 'POST', url: '/api/secrets/test/EXISTING' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.isSet).toBe(true);
    });

    test('returns isSet false when secret not set', async () => {
      const store = makeStore({});
      const server = await buildServer({ secretsStore: store });
      const res = await server.inject({ method: 'POST', url: '/api/secrets/test/MISSING' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.isSet).toBe(false);
    });
  });
});
