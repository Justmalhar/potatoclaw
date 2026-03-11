'use strict';

const { EventEmitter } = require('events');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BaseAgent    = require('../agents/base-agent');
const AgentRunner  = require('./runner');
const MemoryManager = require('../memory/manager');
const { createLogger } = require('../utils/logger');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * Directory inside dataDir where user-created agent definitions live at runtime.
 * Built-in definitions are read from src/agents/definitions/ at startup.
 */
const USER_AGENTS_DIR    = path.join(DATA_DIR, 'agents');
const BUILTIN_AGENTS_DIR = path.join(__dirname, '..', 'agents', 'definitions');

/**
 * AgentRegistry — loads, caches, and manages all agent instances.
 *
 * At startup AgentRegistry.loadAll() reads:
 *   1. Built-in JSON definitions from src/agents/definitions/
 *   2. User-created JSON definitions from ${dataDir}/agents/
 *   (User definitions with the same ID as a built-in override the built-in.)
 *
 * For each definition it creates:
 *   - A MemoryManager scoped to that agent
 *   - A BaseAgent instance
 *   - An AgentRunner wrapping the agent
 *
 * These are cached in the `_agents` Map keyed by agentId.
 *
 * Events emitted:
 *   'loaded'  { agentId, definition }  — agent successfully loaded
 *   'created' { agentId, definition }  — agent created at runtime
 *   'updated' { agentId, definition }  — agent definition updated
 *   'deleted' { agentId }             — agent removed
 *   'error'   { agentId, error }       — load/init error (non-fatal)
 */
class AgentRegistry extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string}  [opts.dataDir]       - Override the default data directory
   * @param {Object}  [opts.runTracker]    - RunTracker instance (passed to agents)
   * @param {Object}  [opts.taskManager]   - TaskManager instance (passed to agents)
   * @param {Object}  [opts.sessionManager] - SessionManager instance (passed to agents)
   */
  constructor({ dataDir, runTracker, taskManager, sessionManager } = {}) {
    super();

    this._dataDir        = dataDir || DATA_DIR;
    this._runTracker     = runTracker     || null;
    this._taskManager    = taskManager    || null;
    this._sessionManager = sessionManager || null;

    /**
     * Map<agentId, { agent: BaseAgent, runner: AgentRunner, definition: Object }>
     */
    this._agents = new Map();

    this._log = createLogger('agent-registry');
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  /**
   * Load all agent definitions and initialise agent + runner instances.
   *
   * Safe to call multiple times — existing entries are replaced with freshly
   * initialised instances.
   *
   * @returns {Promise<void>}
   */
  async loadAll() {
    this._log.info({ dataDir: this._dataDir }, 'Loading agent definitions');

    // Collect all definitions; user definitions override built-ins with same ID
    const definitionMap = new Map();

    // 1. Built-in definitions
    for (const def of this._readDefinitionsFromDir(BUILTIN_AGENTS_DIR, 'built-in')) {
      definitionMap.set(def.id, def);
    }

    // 2. User definitions (override built-ins)
    this._ensureDir(USER_AGENTS_DIR);
    for (const def of this._readDefinitionsFromDir(USER_AGENTS_DIR, 'user')) {
      definitionMap.set(def.id, def);
    }

    this._log.info({ count: definitionMap.size }, 'Definitions collected');

    // Initialise agents
    for (const definition of definitionMap.values()) {
      try {
        await this._initAgent(definition);
        this.emit('loaded', { agentId: definition.id, definition });
      } catch (err) {
        this._log.error({ agentId: definition.id, err }, 'Failed to initialise agent');
        this.emit('error', { agentId: definition.id, error: err });
      }
    }

    this._log.info({ count: this._agents.size }, 'Agent registry ready');
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /**
   * Get the agent and runner for a given agent ID.
   *
   * @param {string} agentId
   * @returns {{ agent: BaseAgent, runner: AgentRunner, definition: Object }|null}
   */
  get(agentId) {
    return this._agents.get(agentId) || null;
  }

  /**
   * Return an array of status objects for all loaded agents.
   * Suitable for REST API responses and the dashboard.
   *
   * @returns {Array<Object>}
   */
  list() {
    const results = [];
    for (const { agent, runner, definition } of this._agents.values()) {
      results.push({
        id:          definition.id,
        name:        definition.name,
        description: definition.description,
        avatar:      definition.avatar,
        model:       definition.model,
        provider:    definition.provider,
        tools:       definition.tools || [],
        status:      agent.status,
        currentTask: agent.currentTask,
        queueDepth:  runner.queueDepth,
        isProcessing: runner.isProcessing,
        stats:       runner.stats,
      });
    }
    return results;
  }

  /**
   * Return the raw agents Map for consumers that need direct iteration.
   * @returns {Map}
   */
  getAll() {
    return this._agents;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new agent from a definition object.
   * Persists the definition to ${dataDir}/agents/${id}.json and initialises
   * the agent + runner.
   *
   * @param {Object} definition
   * @returns {Promise<{ agent: BaseAgent, runner: AgentRunner }>}
   */
  async create(definition) {
    if (!definition.id) throw new Error('Agent definition must have an id');
    if (this._agents.has(definition.id)) {
      throw new Error(`Agent "${definition.id}" already exists. Use update() instead.`);
    }

    // Stamp timestamps
    const now = new Date().toISOString();
    definition = { ...definition, createdAt: now, updatedAt: now };

    // Persist to disk
    this._ensureDir(USER_AGENTS_DIR);
    this._writeDefinition(definition);

    // Initialise
    await this._initAgent(definition);
    this.emit('created', { agentId: definition.id, definition });

    this._log.info({ agentId: definition.id }, 'Agent created');
    return this._agents.get(definition.id);
  }

  /**
   * Update an existing agent's definition.
   * Stops the old runner, persists the new definition, and reinitialises.
   *
   * @param {string} agentId
   * @param {Object} definition
   * @returns {Promise<{ agent: BaseAgent, runner: AgentRunner }>}
   */
  async update(agentId, definition) {
    if (!this._agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    // Gracefully stop the old runner
    const existing = this._agents.get(agentId);
    if (existing && existing.runner) {
      await existing.runner.stop().catch(() => {});
    }

    const now = new Date().toISOString();
    definition = { ...definition, id: agentId, updatedAt: now };

    // Persist
    this._ensureDir(USER_AGENTS_DIR);
    this._writeDefinition(definition);

    // Reinitialise
    this._agents.delete(agentId);
    await this._initAgent(definition);
    this.emit('updated', { agentId, definition });

    this._log.info({ agentId }, 'Agent updated');
    return this._agents.get(agentId);
  }

  /**
   * Delete an agent: stop its runner, remove from the map, and delete the file
   * (if it is a user-created agent; built-ins cannot be deleted from disk).
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async delete(agentId) {
    const entry = this._agents.get(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);

    // Stop the runner
    if (entry.runner) {
      await entry.runner.stop().catch(() => {});
    }

    // Remove from cache
    this._agents.delete(agentId);

    // Delete from user agents dir (may not exist if it was a built-in)
    const filePath = path.join(USER_AGENTS_DIR, `${agentId}.json`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      this._log.warn({ agentId, err: err.message }, 'Could not delete agent definition file');
    }

    this.emit('deleted', { agentId });
    this._log.info({ agentId }, 'Agent deleted');
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  /**
   * Gracefully stop all runners.
   * @returns {Promise<void>}
   */
  async stopAll() {
    this._log.info('Stopping all agent runners');
    const promises = [];
    for (const { runner } of this._agents.values()) {
      if (runner) promises.push(runner.stop().catch(() => {}));
    }
    await Promise.all(promises);
    this._log.info('All runners stopped');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Initialise a BaseAgent and AgentRunner from a definition and store them.
   *
   * @param {Object} definition
   * @returns {Promise<void>}
   * @private
   */
  async _initAgent(definition) {
    const memoryManager = new MemoryManager(definition.id, this._dataDir);
    await memoryManager.ensureDirs();

    const agent = new BaseAgent({
      definition,
      memoryManager,
      sessionManager: this._sessionManager,
      runTracker:     this._runTracker,
    });

    const runner = new AgentRunner({ agent });

    // Forward runner events upward
    runner.on('queued',     (data) => this.emit('runner:queued',     { agentId: definition.id, ...data }));
    runner.on('processing', (data) => this.emit('runner:processing', { agentId: definition.id, ...data }));
    runner.on('completed',  (data) => this.emit('runner:completed',  { agentId: definition.id, ...data }));
    runner.on('failed',     (data) => this.emit('runner:failed',     { agentId: definition.id, ...data }));
    runner.on('drained',    ()     => this.emit('runner:drained',    { agentId: definition.id }));

    this._agents.set(definition.id, { agent, runner, definition });

    this._log.debug({ agentId: definition.id, provider: definition.provider, model: definition.model },
      'Agent initialised');
  }

  /**
   * Read all valid JSON definition files from a directory.
   * Skips non-JSON files and files that fail to parse.
   *
   * @param {string} dir
   * @param {string} label - Used in log messages
   * @returns {Object[]}
   * @private
   */
  _readDefinitionsFromDir(dir, label) {
    const definitions = [];

    if (!fs.existsSync(dir)) {
      this._log.debug({ dir, label }, 'Definition directory not found — skipping');
      return definitions;
    }

    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      this._log.warn({ dir, label, err: err.message }, 'Could not read definition directory');
      return definitions;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw);
        if (!def.id) {
          this._log.warn({ filePath }, 'Definition missing "id" field — skipping');
          continue;
        }
        definitions.push(def);
        this._log.debug({ agentId: def.id, filePath, label }, 'Read definition');
      } catch (err) {
        this._log.warn({ filePath, label, err: err.message }, 'Failed to parse definition file');
      }
    }

    return definitions;
  }

  /**
   * Persist a definition to the user agents directory.
   * @param {Object} definition
   * @private
   */
  _writeDefinition(definition) {
    const filePath = path.join(USER_AGENTS_DIR, `${definition.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(definition, null, 2), 'utf-8');
    this._log.debug({ agentId: definition.id, filePath }, 'Definition persisted');
  }

  /**
   * Create a directory if it does not yet exist.
   * @param {string} dir
   * @private
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = AgentRegistry;
