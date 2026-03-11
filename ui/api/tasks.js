'use strict';

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ taskManager }} ctx
 */
async function register(server, ctx) {
  function getManager() {
    return ctx.taskManager;
  }

  // GET /api/tasks/stats — must be registered before /:id to avoid conflict
  server.get('/api/tasks/stats', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });
    try {
      const stats = mgr.store ? mgr.store.getStats() : {};
      return stats;
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/tasks
  server.get('/api/tasks', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return { tasks: [], total: 0 };

    const { status, agentId, priority, limit = '50', offset = '0' } = req.query;
    try {
      const result = await mgr.list({
        status: status || undefined,
        agentId: agentId || undefined,
        priority: priority || undefined,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
      return result;
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/tasks
  server.post('/api/tasks', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    const body = req.body || {};
    if (!body.title) return reply.code(400).send({ error: 'title is required' });

    try {
      const task = await mgr.create(body);
      reply.code(201).send(task);
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // GET /api/tasks/:id
  server.get('/api/tasks/:id', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    try {
      const task = await mgr.get(req.params.id);
      return task;
    } catch (err) {
      reply.code(404).send({ error: err.message });
    }
  });

  // PUT /api/tasks/:id
  server.put('/api/tasks/:id', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    try {
      const updated = mgr.store.update(req.params.id, req.body || {});
      if (!updated) return reply.code(404).send({ error: 'Task not found' });
      return updated;
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // DELETE /api/tasks/:id
  server.delete('/api/tasks/:id', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    try {
      mgr.store.delete(req.params.id);
      reply.code(204).send();
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // POST /api/tasks/:id/assign
  server.post('/api/tasks/:id/assign', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    const { agentId } = req.body || {};
    if (!agentId) return reply.code(400).send({ error: 'agentId is required' });

    try {
      const task = await mgr.assign(req.params.id, agentId);
      return task;
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // POST /api/tasks/:id/transition
  server.post('/api/tasks/:id/transition', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    const { status } = req.body || {};
    if (!status) return reply.code(400).send({ error: 'status is required' });

    try {
      const task = await mgr.transition(req.params.id, status);
      return task;
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // POST /api/tasks/:id/notes
  server.post('/api/tasks/:id/notes', async (req, reply) => {
    const mgr = getManager();
    if (!mgr) return reply.code(503).send({ error: 'Task manager not available' });

    const { note } = req.body || {};
    if (!note) return reply.code(400).send({ error: 'note is required' });

    try {
      const result = await mgr.addNote(req.params.id, note, 'ui');
      reply.code(201).send(result);
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });
}

module.exports = register;
