'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// sanitizeKey
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary string into a safe filename / storage key.
 * Replaces any character that is not alphanumeric, dash, underscore, or dot
 * with an underscore, then collapses consecutive underscores.
 *
 * @param {string} str
 * @returns {string}
 *
 * @example
 * sanitizeKey('potatoclaw:engineer:slack:channel:C01234') // 'potatoclaw_engineer_slack_channel_C01234'
 */
function sanitizeKey(str) {
  if (typeof str !== 'string') str = String(str);
  return str
    .replace(/[^a-zA-Z0-9\-_.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param {number} ms
 * @returns {string}
 *
 * @example
 * formatDuration(332000) // '5m 32s'
 * formatDuration(500)    // '500ms'
 * formatDuration(61500)  // '1m 1s'
 */
function formatDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '0ms';

  const totalSeconds = Math.floor(ms / 1000);
  const remainingMs = ms % 1000;

  if (totalSeconds === 0) {
    return `${remainingMs}ms`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

/**
 * Safely truncate a string to a maximum length, appending '...' if cut.
 *
 * @param {string} str
 * @param {number} len - Maximum length (including ellipsis)
 * @returns {string}
 *
 * @example
 * truncate('Hello, World!', 8) // 'Hello...'
 */
function truncate(str, len) {
  if (typeof str !== 'string') str = String(str);
  if (len <= 0) return '';
  if (str.length <= len) return str;
  if (len <= 3) return '...'.slice(0, len);
  return str.slice(0, len - 3) + '...';
}

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

/**
 * Await a pause for the given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 *
 * @example
 * await sleep(1000); // pause for 1 second
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

/**
 * Retry an async function with exponential backoff.
 * Throws the last error if all attempts fail.
 *
 * @param {Function} fn - Async function to retry (called with no args)
 * @param {number} [attempts=3] - Maximum number of attempts
 * @param {number} [delayMs=500] - Initial delay in ms (doubles each retry)
 * @returns {Promise<any>}
 *
 * @example
 * const result = await retry(() => fetchData(), 3, 1000);
 */
async function retry(fn, attempts = 3, delayMs = 500) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const wait = delayMs * Math.pow(2, i);
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

/**
 * Generate a short collision-resistant ID with an optional prefix.
 * Uses 9 random bytes → 18 hex chars → trimmed to 12 chars for readability.
 *
 * @param {string} [prefix=''] - e.g. 'run', 'task', 'agent'
 * @returns {string}
 *
 * @example
 * generateId('run')   // 'run_a3f9c2e1b7d4'
 * generateId('task')  // 'task_8b2d1f3a9c5e'
 * generateId()        // 'a3f9c2e1b7d4'
 */
function generateId(prefix) {
  const hex = crypto.randomBytes(9).toString('hex'); // 18 chars
  const id = hex.slice(0, 12);
  return prefix ? `${prefix}_${id}` : id;
}

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

/**
 * Create a directory (and all parents) if it does not already exist.
 * Equivalent to `mkdir -p`. Synchronous — safe to call on startup.
 *
 * @param {string} dirPath
 * @returns {void}
 *
 * @example
 * ensureDir('/data/memory/engineer');
 */
function ensureDir(dirPath) {
  if (!dirPath) throw new Error('ensureDir: dirPath is required');
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

/**
 * Deep-merge two plain objects. The second object's values take precedence.
 * Arrays in `overrides` replace (not append to) arrays in `base`.
 *
 * @param {object} base
 * @param {object} overrides
 * @returns {object}
 */
function deepMerge(base, overrides) {
  const result = Object.assign({}, base);
  for (const key of Object.keys(overrides)) {
    const bVal = base[key];
    const oVal = overrides[key];
    if (
      oVal !== null &&
      typeof oVal === 'object' &&
      !Array.isArray(oVal) &&
      bVal !== null &&
      typeof bVal === 'object' &&
      !Array.isArray(bVal)
    ) {
      result[key] = deepMerge(bVal, oVal);
    } else {
      result[key] = oVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// jsonSafeStringify
// ---------------------------------------------------------------------------

/**
 * JSON.stringify with circular-reference safety.
 * Circular refs are replaced with '[Circular]'.
 *
 * @param {any} obj
 * @param {number} [indent=0]
 * @returns {string}
 */
function jsonSafeStringify(obj, indent = 0) {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    },
    indent
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  sanitizeKey,
  formatDuration,
  truncate,
  sleep,
  retry,
  generateId,
  ensureDir,
  deepMerge,
  jsonSafeStringify,
};
