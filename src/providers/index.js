'use strict';

const ClaudeProvider   = require('./claude');
const OpencodeProvider = require('./opencode');
const { createLogger } = require('../utils/logger');

const log = createLogger('providers');

/**
 * Provider registry: name → constructor
 */
const PROVIDER_CLASSES = {
  claude:   ClaudeProvider,
  opencode: OpencodeProvider,
};

/**
 * Instance cache: cacheKey → provider instance.
 *
 * The cache key is "providerName:SHA-like-hash-of-config" so that two calls
 * with identical configs share the same instance, but differing configs
 * (e.g. different models or permissionModes) get separate instances.
 */
const _cache = new Map();

/**
 * Produce a stable, lightweight cache key for a config object.
 * We JSON-serialize the sorted keys so {a:1,b:2} and {b:2,a:1} hash equally.
 *
 * @param {Object} config
 * @returns {string}
 */
function _configHash(config) {
  if (!config || Object.keys(config).length === 0) return 'default';
  const sorted = Object.fromEntries(
    Object.entries(config).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify(sorted);
}

/**
 * Get (or create and cache) a provider instance.
 *
 * Instances are reused across calls with identical name+config. This means
 * the session map and abort-controller map inside the provider persist for
 * the lifetime of the process — which is exactly what we want for multi-turn
 * conversation resumption.
 *
 * @param {string} name   - 'claude' | 'opencode'
 * @param {Object} [config={}]
 * @returns {ClaudeProvider|OpencodeProvider}
 * @throws {Error} if name is unknown
 */
function getProvider(name, config = {}) {
  const providerName = (name || 'claude').toLowerCase();

  if (!PROVIDER_CLASSES[providerName]) {
    throw new Error(
      `Unknown provider: "${providerName}". ` +
      `Available: ${Object.keys(PROVIDER_CLASSES).join(', ')}`
    );
  }

  const cacheKey = `${providerName}:${_configHash(config)}`;

  if (_cache.has(cacheKey)) {
    return _cache.get(cacheKey);
  }

  log.debug({ providerName, cacheKey }, 'Creating new provider instance');

  const ProviderClass = PROVIDER_CLASSES[providerName];
  const instance = new ProviderClass(config);
  _cache.set(cacheKey, instance);

  return instance;
}

/**
 * Dispose a specific provider instance and remove it from the cache.
 * Calls dispose() on the instance if the method exists.
 *
 * @param {string} name     - provider name
 * @param {Object} [config] - must match the config used when creating
 * @returns {Promise<void>}
 */
async function disposeProvider(name, config = {}) {
  const providerName = (name || 'claude').toLowerCase();
  const cacheKey = `${providerName}:${_configHash(config)}`;

  const instance = _cache.get(cacheKey);
  if (instance) {
    if (typeof instance.dispose === 'function') {
      await instance.dispose();
    }
    _cache.delete(cacheKey);
    log.debug({ providerName, cacheKey }, 'Provider instance disposed');
  }
}

/**
 * Dispose all cached provider instances and clear the cache.
 * Called during graceful shutdown.
 * @returns {Promise<void>}
 */
async function disposeAll() {
  const promises = [];
  for (const instance of _cache.values()) {
    if (typeof instance.dispose === 'function') {
      promises.push(instance.dispose().catch(() => {}));
    }
  }
  await Promise.all(promises);
  _cache.clear();
  log.info('All provider instances disposed');
}

/**
 * Return the list of registered provider names.
 * @returns {string[]}
 */
function listProviders() {
  return Object.keys(PROVIDER_CLASSES);
}

module.exports = {
  getProvider,
  disposeProvider,
  disposeAll,
  listProviders,
  // Re-export classes for consumers that want direct instantiation
  ClaudeProvider,
  OpencodeProvider,
};
