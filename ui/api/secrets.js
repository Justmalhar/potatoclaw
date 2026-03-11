'use strict';

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ secretsStore }} ctx
 */
async function register(server, ctx) {
  function getStore() {
    return ctx.secretsStore;
  }

  function maskValue(value) {
    if (!value || typeof value !== 'string') return '****';
    if (value.length <= 4) return '****';
    return value.slice(0, 4) + '****';
  }

  // GET /api/secrets — list keys with masked values
  server.get('/api/secrets', async (req, reply) => {
    const store = getStore();
    if (!store) return reply.code(503).send({ error: 'Secrets store not available' });

    try {
      const keys = await store.list();
      const secrets = [];
      for (const key of keys) {
        const value = await store.get(key);
        secrets.push({ key, maskedValue: maskValue(value) });
      }
      return { secrets };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/secrets — set key/value
  server.post('/api/secrets', async (req, reply) => {
    const store = getStore();
    if (!store) return reply.code(503).send({ error: 'Secrets store not available' });

    const { key, value } = req.body || {};
    if (!key) return reply.code(400).send({ error: 'key is required' });
    if (value === undefined || value === null) return reply.code(400).send({ error: 'value is required' });

    try {
      await store.set(key, value);
      return { ok: true, key, maskedValue: maskValue(value) };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/secrets/:key
  server.delete('/api/secrets/:key', async (req, reply) => {
    const store = getStore();
    if (!store) return reply.code(503).send({ error: 'Secrets store not available' });

    try {
      await store.delete(req.params.key);
      reply.code(204).send();
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/secrets/test/:key — test if secret is set
  server.post('/api/secrets/test/:key', async (req, reply) => {
    const store = getStore();
    if (!store) return reply.code(503).send({ error: 'Secrets store not available' });

    try {
      const value = await store.get(req.params.key);
      return { key: req.params.key, isSet: value !== undefined && value !== null && value !== '' };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = register;
