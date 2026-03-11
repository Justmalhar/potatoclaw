'use strict';

/**
 * Application bootstrap — wires all components together and starts the system.
 *
 * This is the single place where every module is instantiated and cross-wired.
 * bin/potatoclaw delegates to this module for the 'start' command.
 */

const path = require('path');
const os   = require('os');
const { createLogger } = require('./utils/logger');

const log = createLogger('app');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * Bootstrap and start the complete PotatoClaw system.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.uiOnly=false]  Start only the UI server (no gateway/adapters)
 * @param {boolean} [opts.noUi=false]    Start gateway without UI server
 * @returns {Promise<{ stop: Function }>}
 */
async function start(opts = {}) {
  const { uiOnly = false, noUi = false } = opts;

  log.info({ dataDir: DATA_DIR }, 'PotatoClaw starting');

  // Ensure data directories exist
  const { ensureDir } = require('./utils/helpers');
  const dirs = ['agents', 'channels', 'memory', 'sessions', 'runs', 'workspaces', 'auth', 'logs'];
  for (const d of dirs) await ensureDir(path.join(DATA_DIR, d));

  // -------------------------------------------------------------------------
  // 1. Storage layer
  // -------------------------------------------------------------------------
  const SecretsStore = require('./utils/secrets');
  const secretsStore = new SecretsStore(DATA_DIR);

  const TaskStore = require('./tasks/store');
  const taskStore = new TaskStore(DATA_DIR);
  taskStore.init();

  const RunStore = require('./runs/store');
  const runStore = new RunStore(DATA_DIR);

  // -------------------------------------------------------------------------
  // 2. Business logic layer
  // -------------------------------------------------------------------------
  const TaskManager = require('./tasks/manager');
  const taskManager = new TaskManager(taskStore);

  const RunTracker = require('./runs/tracker');
  const runTracker = new RunTracker(runStore);

  const MemoryManager = require('./memory/manager');
  // Global/default memory manager — per-agent ones are created by AgentRegistry
  const defaultMemory = new MemoryManager('default', DATA_DIR);

  const SessionManager = require('./sessions/manager');
  const defaultSession = new SessionManager('default', DATA_DIR);

  // -------------------------------------------------------------------------
  // 3. Channel layer
  // -------------------------------------------------------------------------
  const ChannelRegistry = require('./channels/registry');
  const channelRegistry = new ChannelRegistry(DATA_DIR);
  await channelRegistry.load().catch(() => {}); // safe — already loads in constructor

  // -------------------------------------------------------------------------
  // 4. Agent registry (loads agent definitions, creates runners)
  // -------------------------------------------------------------------------
  const AgentRegistry = require('./core/agent-registry');
  const agentRegistry = new AgentRegistry({ dataDir: DATA_DIR, runTracker, taskManager });
  await agentRegistry.loadAll();

  // -------------------------------------------------------------------------
  // 5. Task reporter (posts Slack run summaries — needs adapters map; we wire
  //    it after gateway starts so it has access to the adapter instances)
  // -------------------------------------------------------------------------
  const TaskReporter = require('./tasks/reporter');
  const taskReporter = new TaskReporter(new Map()); // adapters added after gateway init

  // -------------------------------------------------------------------------
  // 6. Channel context assembler
  // -------------------------------------------------------------------------
  const ChannelContext = require('./channels/context');
  const channelContext = new ChannelContext({
    channelRegistry,
    memoryManager: defaultMemory,
    sessionManager: defaultSession,
    dataDir: DATA_DIR,
  });

  // -------------------------------------------------------------------------
  // 7. Orchestrator
  // -------------------------------------------------------------------------
  const Orchestrator = require('./core/orchestrator');
  const orchestrator = new Orchestrator({
    agentRegistry,
    taskManager,
    runTracker,
    taskReporter,
    channelContext,
  });

  // Wire all already-loaded runners to orchestrator
  for (const [agentId] of agentRegistry.getAll()) {
    orchestrator._wireRunner(agentId);
  }

  // -------------------------------------------------------------------------
  // 8. Cron scheduler
  // -------------------------------------------------------------------------
  const { CronScheduler } = require('./tools/cron');
  const cronScheduler = new CronScheduler({ dataDir: DATA_DIR });
  await cronScheduler.load();

  // -------------------------------------------------------------------------
  // 9. Command handler
  // -------------------------------------------------------------------------
  const CommandHandler = require('./commands/handler');
  const commandHandler = new CommandHandler({
    agentRegistry,
    channelRegistry,
    taskManager,
    runStore,
    sessionManager: defaultSession,
  });

  // -------------------------------------------------------------------------
  // 10. UI server
  // -------------------------------------------------------------------------
  let uiStop = async () => {};
  if (!noUi) {
    const { startUiServer } = require('../ui/server');
    const uiPort = parseInt(process.env.UI_PORT || '4200', 10);
    const uiResult = await startUiServer({
      port: uiPort,
      agentRegistry,
      taskManager,
      runTracker,
      channelRegistry,
      memoryManager: defaultMemory,
      sessionManager: defaultSession,
      cronScheduler,
      secretsStore,
      config: require('../config/default'),
    });
    uiStop = uiResult.stop;
    log.info({ port: uiPort }, 'Mission Control UI started');
  }

  if (uiOnly) {
    log.info('UI-only mode — gateway not started');
    return buildShutdown({ uiStop });
  }

  // -------------------------------------------------------------------------
  // 11. Gateway (adapters + HTTP server)
  // -------------------------------------------------------------------------
  const Gateway = require('./core/gateway');
  const config = require('../config/default');

  const gateway = new Gateway({
    config,
    agentRegistry,
    channelRegistry,
    channelContext,
    orchestrator,
    commandHandler,
    cronScheduler,
  });

  await gateway.start();

  // Give TaskReporter access to gateway adapters for Slack posting
  taskReporter._adapters = gateway.adapters;

  log.info('PotatoClaw is running');
  log.info(`  Gateway:     http://localhost:${process.env.GATEWAY_PORT || 4096}`);
  if (!noUi) {
    log.info(`  Mission Control: http://localhost:${process.env.UI_PORT || 4200}`);
  }

  return buildShutdown({ uiStop, gateway, cronScheduler, agentRegistry });
}

function buildShutdown({ uiStop, gateway, cronScheduler, agentRegistry }) {
  return {
    async stop() {
      log.info('Shutting down PotatoClaw...');
      try { if (cronScheduler) cronScheduler.stopAll?.(); } catch (_) {}
      try { if (agentRegistry) await agentRegistry.stopAll(); } catch (_) {}
      try { if (gateway) await gateway.stop(); } catch (_) {}
      try { await uiStop(); } catch (_) {}
      log.info('Shutdown complete');
    },
  };
}

module.exports = { start };
