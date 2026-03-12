'use strict';

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {object} ctx
 */
async function register(server, ctx) {
  // GET /api/system/status
  server.get('/api/system/status', async () => ({
    ok: true,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    version: require('../../package.json').version,
    timestamp: new Date().toISOString(),
  }));

  // POST /api/system/restart — exits the process; Docker restart policy revives it
  server.post('/api/system/restart', async (req, reply) => {
    reply.code(202).send({ ok: true, message: 'Restarting...' });
    // Give the response time to flush before exiting
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
}

module.exports = register;
