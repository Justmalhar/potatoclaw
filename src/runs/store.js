'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * File-based run persistence.
 *
 * Each run is stored as: ${dataDir}/runs/${runId}.json
 * An index file at:      ${dataDir}/runs/index.json  tracks lightweight metadata.
 */
class RunStore {
  /**
   * @param {string} [dataDir]
   */
  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.runsDir = path.join(dataDir, 'runs');
    this.indexPath = path.join(this.runsDir, 'index.json');
    this._index = null; // lazy-loaded
  }

  // ---------------------------------------------------------------------------
  // Directory / index helpers
  // ---------------------------------------------------------------------------

  async _ensureDir() {
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
  }

  _runPath(runId) {
    return path.join(this.runsDir, `${runId}.json`);
  }

  /**
   * Load the index from disk (or return empty object if not yet created).
   * @returns {{ [runId: string]: IndexEntry }}
   */
  _loadIndex() {
    if (this._index !== null) return this._index;

    try {
      if (fs.existsSync(this.indexPath)) {
        this._index = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      } else {
        this._index = {};
      }
    } catch (_) {
      this._index = {};
    }

    return this._index;
  }

  _saveIndex() {
    fs.writeFileSync(this.indexPath, JSON.stringify(this._index, null, 2), 'utf-8');
  }

  _updateIndex(runId, fields) {
    const idx = this._loadIndex();
    idx[runId] = { ...(idx[runId] || {}), ...fields };
    this._saveIndex();
  }

  _removeFromIndex(runId) {
    const idx = this._loadIndex();
    delete idx[runId];
    this._saveIndex();
  }

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  _generateId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 7);
    return `run_${ts}${rand}`;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new run record on disk and in the index.
   * @param {Object} runData - { taskId, agentId, channelId, ... }
   * @returns {Promise<Object>}
   */
  async create(runData) {
    await this._ensureDir();

    const run = {
      id: runData.id || this._generateId(),
      taskId: runData.taskId || null,
      agentId: runData.agentId || null,
      channelId: runData.channelId || null,
      status: 'queued',
      startedAt: null,
      completedAt: null,
      steps: [],
      output: null,
      error: null,
      tokensUsed: 0,
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(this._runPath(run.id), JSON.stringify(run, null, 2), 'utf-8');

    this._updateIndex(run.id, {
      id: run.id,
      taskId: run.taskId,
      agentId: run.agentId,
      channelId: run.channelId,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: null,
      completedAt: null,
    });

    return run;
  }

  /**
   * Get a run by ID. Returns null if not found.
   * @param {string} runId
   * @returns {Promise<Object|null>}
   */
  async get(runId) {
    const filepath = this._runPath(runId);
    if (!fs.existsSync(filepath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  /**
   * Partial update of a run record.
   * @param {string} runId
   * @param {Object} fields
   * @returns {Promise<Object|null>}
   */
  async update(runId, fields) {
    const run = await this.get(runId);
    if (!run) return null;

    const { steps, ...rest } = fields; // steps must use appendStep
    const updated = { ...run, ...rest };
    fs.writeFileSync(this._runPath(runId), JSON.stringify(updated, null, 2), 'utf-8');

    // Sync index for filterable fields
    const indexFields = {};
    for (const key of ['status', 'agentId', 'taskId', 'channelId', 'startedAt', 'completedAt']) {
      if (key in updated) indexFields[key] = updated[key];
    }
    this._updateIndex(runId, indexFields);

    return updated;
  }

  /**
   * Append a step to the run's steps array.
   * @param {string} runId
   * @param {{ type: string, content?: string, tool?: string, input?: any, durationMs?: number }} step
   * @returns {Promise<Object>} The appended step with timestamp
   */
  async appendStep(runId, step) {
    const run = await this.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const record = {
      ...step,
      timestamp: step.timestamp || new Date().toISOString(),
    };

    run.steps.push(record);
    fs.writeFileSync(this._runPath(runId), JSON.stringify(run, null, 2), 'utf-8');

    return record;
  }

  /**
   * Mark a run as completed.
   * @param {string} runId
   * @param {string} output       - Agent final output text
   * @param {number} [tokensUsed]
   * @returns {Promise<Object>}
   */
  async complete(runId, output, tokensUsed = 0) {
    const run = await this.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const completedAt = new Date().toISOString();
    const durationMs = run.startedAt
      ? new Date(completedAt) - new Date(run.startedAt)
      : 0;

    return this.update(runId, {
      status: 'completed',
      completedAt,
      output,
      tokensUsed,
      durationMs,
    });
  }

  /**
   * Mark a run as failed.
   * @param {string} runId
   * @param {string|Error} error
   * @returns {Promise<Object>}
   */
  async fail(runId, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const run = await this.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const completedAt = new Date().toISOString();
    const durationMs = run.startedAt
      ? new Date(completedAt) - new Date(run.startedAt)
      : 0;

    return this.update(runId, {
      status: 'failed',
      completedAt,
      error: errorMessage,
      durationMs,
    });
  }

  /**
   * List runs from the index with optional filters and pagination.
   * @param {{ agentId?: string, taskId?: string, status?: string, limit?: number, offset?: number }} opts
   * @returns {Promise<{ runs: Object[], total: number }>}
   */
  async list({ agentId, taskId, status, limit = 50, offset = 0 } = {}) {
    await this._ensureDir();
    const idx = this._loadIndex();

    let entries = Object.values(idx);

    if (agentId) entries = entries.filter((e) => e.agentId === agentId);
    if (taskId) entries = entries.filter((e) => e.taskId === taskId);
    if (status) entries = entries.filter((e) => e.status === status);

    // Newest first
    entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);

    return page;
  }

  /**
   * Delete run files older than N days.
   * @param {number} [olderThanDays=90]
   * @returns {Promise<number>} Number of runs deleted
   */
  async deleteOld(olderThanDays = 90) {
    await this._ensureDir();
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const idx = this._loadIndex();
    let deleted = 0;

    for (const [runId, entry] of Object.entries(idx)) {
      const createdAt = new Date(entry.createdAt || 0).getTime();
      if (createdAt < cutoff) {
        const filepath = this._runPath(runId);
        if (fs.existsSync(filepath)) {
          try {
            fs.unlinkSync(filepath);
          } catch (_) {
            // Best effort
          }
        }
        this._removeFromIndex(runId);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Return aggregate statistics from the index.
   * @returns {Promise<{ total: number, byStatus: Object, avgDuration: number, totalTokens: number }>}
   */
  async getStats() {
    await this._ensureDir();
    const idx = this._loadIndex();
    const entries = Object.values(idx);

    const byStatus = {};
    let totalDuration = 0;
    let completedCount = 0;
    let totalTokens = 0;

    for (const entry of entries) {
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    }

    // For duration/token stats we need the full run files
    for (const entry of entries) {
      const run = await this.get(entry.id);
      if (!run) continue;
      if (run.durationMs) { totalDuration += run.durationMs; completedCount++; }
      if (run.tokensUsed) totalTokens += run.tokensUsed;
    }

    return {
      total: entries.length,
      byStatus,
      avgDuration: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
      totalTokens,
    };
  }
}

module.exports = RunStore;
