'use strict';

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ cronScheduler }} ctx
 */
async function register(server, ctx) {
  function getScheduler() {
    return ctx.cronScheduler;
  }

  // GET /api/scheduler — list all cron jobs
  server.get('/api/scheduler', async (req, reply) => {
    const scheduler = getScheduler();
    if (!scheduler) return { jobs: [] };
    try {
      const jobs = scheduler.list ? scheduler.list() : [];
      return { jobs };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/scheduler — create job
  server.post('/api/scheduler', async (req, reply) => {
    const scheduler = getScheduler();
    if (!scheduler) return reply.code(503).send({ error: 'Scheduler not available' });

    const body = req.body || {};
    if (!body.type) return reply.code(400).send({ error: 'type is required (delayed|recurring|cron)' });
    if (!body.message) return reply.code(400).send({ error: 'message is required' });

    try {
      let result;
      if (body.type === 'delayed') {
        if (!body.delaySeconds) return reply.code(400).send({ error: 'delaySeconds is required for delayed jobs' });
        result = scheduler.scheduleDelayed({
          channelId: body.channelId || null,
          agentId: body.agentId || null,
          message: body.message,
          delaySeconds: body.delaySeconds,
          description: body.description,
          invokeAgent: body.invokeAgent || false,
        });
      } else if (body.type === 'recurring') {
        if (!body.intervalSeconds) return reply.code(400).send({ error: 'intervalSeconds is required for recurring jobs' });
        result = scheduler.scheduleRecurring({
          channelId: body.channelId || null,
          agentId: body.agentId || null,
          message: body.message,
          intervalSeconds: body.intervalSeconds,
          description: body.description,
          invokeAgent: body.invokeAgent || false,
        });
      } else if (body.type === 'cron') {
        if (!body.cron) return reply.code(400).send({ error: 'cron expression is required for cron jobs' });
        result = scheduler.scheduleCron({
          channelId: body.channelId || null,
          agentId: body.agentId || null,
          message: body.message,
          cron: body.cron,
          description: body.description,
          invokeAgent: body.invokeAgent || false,
        });
      } else {
        return reply.code(400).send({ error: `Unknown job type: ${body.type}` });
      }

      reply.code(201).send(result);
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // DELETE /api/scheduler/:id — cancel job
  server.delete('/api/scheduler/:id', async (req, reply) => {
    const scheduler = getScheduler();
    if (!scheduler) return reply.code(503).send({ error: 'Scheduler not available' });

    try {
      const result = scheduler.cancel(req.params.id);
      if (!result.success) return reply.code(404).send({ error: result.error || 'Job not found' });
      reply.code(204).send();
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = register;
