'use strict';

const path = require('path');
const { EventEmitter } = require('events');

/**
 * Start the Mission Control UI server.
 *
 * @param {{
 *   port?: number,
 *   agentRegistry?: object,
 *   taskManager?: object,
 *   runTracker?: object,
 *   channelRegistry?: object,
 *   memoryManager?: object,
 *   sessionManager?: object,
 *   cronScheduler?: object,
 *   secretsStore?: object,
 *   config?: object
 * }} opts
 * @returns {Promise<{ server: FastifyInstance, stop: Function }>}
 */
async function startUiServer(opts = {}) {
  const {
    port = 4200,
    agentRegistry = null,
    taskManager = null,
    runTracker = null,
    channelRegistry = null,
    memoryManager = null,
    sessionManager = null,
    cronScheduler = null,
    secretsStore = null,
    config = {},
  } = opts;

  const Fastify = require('fastify');
  const fastifyCors = require('@fastify/cors');
  const fastifyStatic = require('@fastify/static');

  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------
  await server.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // -------------------------------------------------------------------------
  // Static files — serve ui/public/
  // -------------------------------------------------------------------------
  await server.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
    decorateReply: false,
  });

  // -------------------------------------------------------------------------
  // Basic auth middleware (if UI_PASSWORD is set)
  // -------------------------------------------------------------------------
  const uiPassword = process.env.UI_PASSWORD;

  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for static assets and SSE
    const url = request.url;
    if (!uiPassword) return;
    if (url === '/' || url.startsWith('/styles') || url.startsWith('/app') || url.startsWith('/pages') || url.startsWith('/components')) {
      return;
    }
    if (!url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization || '';
    if (!authHeader.startsWith('Basic ')) {
      reply.header('WWW-Authenticate', 'Basic realm="PotatoClaw Mission Control"');
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const b64 = authHeader.slice(6);
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;

    if (password !== uiPassword) {
      reply.header('WWW-Authenticate', 'Basic realm="PotatoClaw Mission Control"');
      reply.code(401).send({ error: 'Invalid credentials' });
      return;
    }
  });

  // -------------------------------------------------------------------------
  // Shared context — passed to all API route modules
  // -------------------------------------------------------------------------
  const ctx = {
    agentRegistry,
    taskManager,
    runTracker,
    channelRegistry,
    memoryManager,
    sessionManager,
    cronScheduler,
    secretsStore,
    config,
    sseClients: new Set(),
  };

  // -------------------------------------------------------------------------
  // Forward events to SSE clients
  // -------------------------------------------------------------------------
  const eventSources = [];

  function registerEventSource(emitter, events) {
    if (!emitter || typeof emitter.on !== 'function') return;
    for (const eventName of events) {
      const handler = (data) => broadcastSSE(eventName, data);
      emitter.on(eventName, handler);
      eventSources.push({ emitter, eventName, handler });
    }
  }

  function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of ctx.sseClients) {
      try {
        client.raw.write(payload);
      } catch (_) {
        ctx.sseClients.delete(client);
      }
    }
  }

  ctx.broadcastSSE = broadcastSSE;

  if (taskManager) {
    registerEventSource(taskManager, [
      'task:created',
      'task:assigned',
      'task:status_changed',
      'task:completed',
      'task:failed',
    ]);
  }

  if (runTracker) {
    registerEventSource(runTracker, [
      'run:started',
      'run:step',
      'run:completed',
      'run:failed',
    ]);
  }

  // -------------------------------------------------------------------------
  // Core routes
  // -------------------------------------------------------------------------

  // GET / → serve index.html
  server.get('/', async (request, reply) => {
    return reply.sendFile('index.html');
  });

  // GET /api/health
  server.get('/api/health', async () => ({
    ok: true,
    version: require('../package.json').version,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  // GET /api/events → SSE stream
  server.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':ok\n\n');

    ctx.sseClients.add(reply);

    // Send heartbeat every 15 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch (_) {
        clearInterval(heartbeat);
        ctx.sseClients.delete(reply);
      }
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      ctx.sseClients.delete(reply);
    });

    // Keep the handler open
    await new Promise((resolve) => request.raw.on('close', resolve));
  });

  // -------------------------------------------------------------------------
  // API route modules
  // -------------------------------------------------------------------------
  const apiModules = [
    './api/agents',
    './api/channels',
    './api/tasks',
    './api/runs',
    './api/secrets',
    './api/memory',
    './api/sessions',
    './api/scheduler',
    './api/logs',
    './api/settings',
  ];

  for (const mod of apiModules) {
    try {
      const register = require(mod);
      await register(server, ctx);
    } catch (err) {
      server.log.warn({ mod, err: err.message }, 'Failed to load API module');
    }
  }

  // -------------------------------------------------------------------------
  // Start listening
  // -------------------------------------------------------------------------
  await server.listen({ port, host: '0.0.0.0' });
  server.log.info(`Mission Control UI running on http://0.0.0.0:${port}`);

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------
  async function stop() {
    // Detach event listeners
    for (const { emitter, eventName, handler } of eventSources) {
      emitter.removeListener(eventName, handler);
    }

    // Close all SSE connections
    for (const client of ctx.sseClients) {
      try { client.raw.end(); } catch (_) {}
    }
    ctx.sseClients.clear();

    await server.close();
  }

  return { server, stop };
}

module.exports = { startUiServer };
