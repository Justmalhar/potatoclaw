'use strict';

const { EventEmitter } = require('events');

/**
 * Real-time run state tracking. Emits events consumed by the SSE endpoint.
 *
 * Events emitted (all include the full run object):
 *   'run:started'    { run }
 *   'run:step'       { run, step }
 *   'run:completed'  { run }
 *   'run:failed'     { run }
 */
class RunTracker extends EventEmitter {
  /**
   * @param {import('./store')} runStore
   */
  constructor(runStore) {
    super();
    this.store = runStore;

    /**
     * In-memory map of currently active (non-terminal) runs.
     * @type {Map<string, Object>}
     */
    this._activeRuns = new Map();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a run record and mark it as started.
   * @param {string} runId
   * @param {string} taskId
   * @param {string} agentId
   * @param {string} channelId
   * @returns {Promise<Object>}
   */
  async startRun(runId, taskId, agentId, channelId) {
    // Create the persisted record
    const run = await this.store.create({ id: runId, taskId, agentId, channelId });

    // Immediately mark as running
    const startedAt = new Date().toISOString();
    const started = await this.store.update(runId, { status: 'running', startedAt });

    this._activeRuns.set(runId, started);
    this.emit('run:started', { run: started });
    return started;
  }

  /**
   * Persist a step and emit 'run:step' so SSE clients receive it.
   * @param {string} runId
   * @param {{ type: string, content?: string, tool?: string, input?: any, durationMs?: number }} step
   * @returns {Promise<Object>} The persisted step record
   */
  async addStep(runId, step) {
    const persistedStep = await this.store.appendStep(runId, step);

    // Keep the in-memory copy current
    const run = await this.store.get(runId);
    if (run) {
      this._activeRuns.set(runId, run);
      this.emit('run:step', { run, step: persistedStep });
    }

    return persistedStep;
  }

  /**
   * Mark a run as completed and remove it from the active map.
   * @param {string} runId
   * @param {string} output
   * @param {number} [tokensUsed]
   * @returns {Promise<Object>}
   */
  async completeRun(runId, output, tokensUsed = 0) {
    const run = await this.store.complete(runId, output, tokensUsed);

    this._activeRuns.delete(runId);
    this.emit('run:completed', { run });
    return run;
  }

  /**
   * Mark a run as failed and remove it from the active map.
   * @param {string} runId
   * @param {string|Error} error
   * @returns {Promise<Object>}
   */
  async failRun(runId, error) {
    const run = await this.store.fail(runId, error);

    this._activeRuns.delete(runId);
    this.emit('run:failed', { run });
    return run;
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Return the in-memory active runs map.
   * Only includes runs that have been started but not yet completed or failed.
   * @returns {Map<string, Object>}
   */
  getActiveRuns() {
    return this._activeRuns;
  }

  /**
   * Get the current run state: from memory if active, otherwise load from store.
   * @param {string} runId
   * @returns {Promise<Object|null>}
   */
  async getRunState(runId) {
    if (this._activeRuns.has(runId)) {
      return this._activeRuns.get(runId);
    }
    return this.store.get(runId);
  }

  /**
   * Load a run from persistent store.
   * @param {string} runId
   * @returns {Promise<Object|null>}
   */
  async getRun(runId) {
    return this.store.get(runId);
  }
}

module.exports = RunTracker;
