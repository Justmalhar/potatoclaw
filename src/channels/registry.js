'use strict';

/**
 * ChannelRegistry — channel-to-agent binding store.
 * Persisted to ${dataDir}/channels/registry.json
 *
 * Binding shape:
 * {
 *   agentId: string,
 *   channelName?: string,
 *   systemPromptOverride?: string,
 *   toolOverrides?: { add: string[], remove: string[] },
 *   recentMessageWindow?: number,
 *   summaryEnabled?: boolean,
 *   summaryIntervalMessages?: number,
 *   createdAt: string,
 *   updatedAt: string,
 * }
 */

const fs = require('fs');
const path = require('path');

class ChannelRegistry {
  /**
   * @param {string} dataDir - Root data directory
   */
  constructor(dataDir) {
    this.dataDir = dataDir || process.env.DATA_DIR || '/data';
    this.registryFile = path.join(this.dataDir, 'channels', 'registry.json');
    /** @type {Map<string, Object>} key → binding */
    this._bindings = new Map();
    // Eagerly load from disk so a newly constructed instance reflects persisted state
    this._loadSync();
  }

  _loadSync() {
    if (!fs.existsSync(this.registryFile)) return;
    try {
      const raw = fs.readFileSync(this.registryFile, 'utf-8');
      const data = JSON.parse(raw);
      for (const [key, binding] of Object.entries(data)) {
        this._bindings.set(key, binding);
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async load() {
    const dir = path.dirname(this.registryFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.registryFile)) {
      try {
        const raw = fs.readFileSync(this.registryFile, 'utf-8');
        const data = JSON.parse(raw);
        this._bindings.clear();
        for (const [key, binding] of Object.entries(data)) {
          this._bindings.set(key, binding);
        }
        console.log(`[ChannelRegistry] Loaded ${this._bindings.size} bindings`);
      } catch (err) {
        console.error('[ChannelRegistry] Failed to load registry:', err.message);
      }
    }
  }

  async save() { this._saveSync(); }

  _saveSync() {
    const dir = path.dirname(this.registryFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {};
    for (const [key, binding] of this._bindings) { data[key] = binding; }
    fs.writeFileSync(this.registryFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Bind a channel to an agent.
   * @param {string} platform
   * @param {string} channelId
   * @param {Object} binding
   */
  bind(platform, channelId, binding, options) {
    // Accept: bind(p, c, 'agentId') or bind(p, c, 'agentId', {opts}) or bind(p, c, {agentId,...})
    let bindingObj;
    if (typeof binding === 'string') {
      bindingObj = { agentId: binding, ...(options || {}) };
    } else {
      bindingObj = binding;
    }
    const key = ChannelRegistry.channelKey(platform, channelId);
    const now = new Date().toISOString();
    const existing = this._bindings.get(key) || {};
    this._bindings.set(key, {
      ...existing,
      ...bindingObj,
      platform,
      channelId,
      id: key,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });
    this._saveSync();
    return this._bindings.get(key);
  }

  /**
   * Remove a channel binding.
   * @param {string} platform
   * @param {string} channelId
   */
  unbind(platform, channelId) {
    const key = ChannelRegistry.channelKey(platform, channelId);
    const existed = this._bindings.has(key);
    this._bindings.delete(key);
    if (existed) {
      this._saveSync();
    }
    return existed;
  }

  /**
   * Get binding for a channel, or null.
   * @param {string} platform
   * @param {string} channelId
   * @returns {Object|null}
   */
  get(platform, channelId) {
    const key = ChannelRegistry.channelKey(platform, channelId);
    return this._bindings.get(key) || null;
  }

  /**
   * Get binding by canonical key directly.
   * @param {string} key  e.g. "slack:C01234567"
   * @returns {Object|null}
   */
  getByKey(key) {
    return this._bindings.get(key) || null;
  }

  /**
   * List all bindings.
   * @returns {Object[]}
   */
  list() {
    return Array.from(this._bindings.values());
  }

  /**
   * Update specific fields of an existing binding.
   * @param {string} platform
   * @param {string} channelId
   * @param {Object} fields
   * @returns {Object|null}
   */
  update(platform, channelId, fields) {
    const existing = this.get(platform, channelId);
    if (!existing) return null;
    return this.bind(platform, channelId, { ...existing, ...fields });
  }

  /**
   * Find all channels bound to a specific agent.
   * @param {string} agentId
   * @returns {Object[]}
   */
  listByAgent(agentId) {
    return Array.from(this._bindings.values()).filter((b) => b.agentId === agentId);
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate the canonical channel key string.
   * @param {string} platform
   * @param {string} channelId
   * @returns {string}  e.g. "slack:C01234567"
   */
  static channelKey(platform, channelId) {
    return `${platform}:${channelId}`;
  }

  /**
   * Parse a canonical key back into { platform, channelId }.
   * @param {string} key
   * @returns {{ platform: string, channelId: string }}
   */
  static parseKey(key) {
    const colonIdx = key.indexOf(':');
    if (colonIdx === -1) return { platform: 'unknown', channelId: key };
    return { platform: key.slice(0, colonIdx), channelId: key.slice(colonIdx + 1) };
  }
}

module.exports = ChannelRegistry;
