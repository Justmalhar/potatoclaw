'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const log = createLogger('secrets');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;        // 256 bits
const SALT_LEN = 32;       // 256-bit salt for scrypt
const IV_LEN = 16;         // 128-bit IV for AES-GCM
const AUTH_TAG_LEN = 16;   // 128-bit GCM auth tag
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// Fallback dev password — used when UI_PASSWORD is not set.
// A warning is printed on every access when this is active.
const DEV_PASSWORD = 'potatoclaw-dev-insecure-key-do-not-use-in-prod';

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit encryption key from a password + salt using scrypt.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Promise<Buffer>}
 */
function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// ---------------------------------------------------------------------------
// File format
// ---------------------------------------------------------------------------
//
// The .enc file is a JSON object:
// {
//   "v": 1,
//   "salt": "<hex>",
//   "entries": {
//     "<key>": {
//       "iv": "<hex>",
//       "tag": "<hex>",
//       "data": "<hex>"      // encrypted JSON string value
//     }
//   }
// }
//
// The salt is generated once on first write and reused for all entries.
// Each entry uses a fresh random IV.
// ---------------------------------------------------------------------------

/**
 * SecretsStore — AES-256-GCM encrypted key/value store.
 *
 * Values are stored per-key with individual IVs so that adding/removing
 * one secret does not re-encrypt all others (the file is still re-written
 * atomically, but each entry's ciphertext is independent).
 *
 * Usage:
 *   const store = new SecretsStore(dataDir);
 *   await store.set('SLACK_BOT_TOKEN', 'xoxb-...');
 *   const token = await store.get('SLACK_BOT_TOKEN');
 */
class SecretsStore {
  /**
   * @param {string} dataDir - Directory where secrets.enc lives
   */
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'secrets.enc');
    this._password = null;  // resolved lazily
    this._keyCache = null;  // { salt: Buffer, key: Buffer }
    this._fileCache = null; // parsed file contents
  }

  // -------------------------------------------------------------------------
  // Password resolution
  // -------------------------------------------------------------------------

  _getPassword() {
    if (this._password) return this._password;

    const pw = process.env.UI_PASSWORD;
    if (!pw) {
      log.warn(
        'UI_PASSWORD is not set — using insecure dev key for secrets encryption. ' +
        'Set UI_PASSWORD before deploying to production!'
      );
      this._password = DEV_PASSWORD;
    } else {
      this._password = pw;
    }
    return this._password;
  }

  // -------------------------------------------------------------------------
  // File I/O
  // -------------------------------------------------------------------------

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadFile() {
    if (!fs.existsSync(this.filePath)) {
      return { v: 1, salt: null, entries: {} };
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      log.error({ err }, 'Failed to parse secrets file — treating as empty');
      return { v: 1, salt: null, entries: {} };
    }
  }

  _saveFile(fileData) {
    this._ensureDir();
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(fileData, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    this._fileCache = fileData;
  }

  async _getOrCreateKey(fileData) {
    let salt;
    if (fileData.salt) {
      salt = Buffer.from(fileData.salt, 'hex');
    } else {
      salt = crypto.randomBytes(SALT_LEN);
      fileData.salt = salt.toString('hex');
    }

    // Check cache to avoid re-deriving on every operation
    if (
      this._keyCache &&
      this._keyCache.salt.equals(salt) &&
      this._keyCache.password === this._getPassword()
    ) {
      return this._keyCache.key;
    }

    const key = await deriveKey(this._getPassword(), salt);
    this._keyCache = { salt, key, password: this._getPassword() };
    return key;
  }

  // -------------------------------------------------------------------------
  // Encrypt / Decrypt
  // -------------------------------------------------------------------------

  _encrypt(key, value) {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  _decrypt(key, entry) {
    const iv = Buffer.from(entry.iv, 'hex');
    const tag = Buffer.from(entry.tag, 'hex');
    const data = Buffer.from(entry.data, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get a secret by key.
   * Returns undefined if the key does not exist.
   *
   * @param {string} key
   * @returns {Promise<string|undefined>}
   */
  async get(key) {
    const fileData = this._loadFile();
    const entry = fileData.entries[key];
    if (!entry) return undefined;

    const encKey = await this._getOrCreateKey(fileData);
    try {
      return this._decrypt(encKey, entry);
    } catch (err) {
      log.error({ err, key }, 'Failed to decrypt secret — wrong password or corrupted entry');
      return undefined;
    }
  }

  /**
   * Set (create or update) a secret.
   *
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    const fileData = this._loadFile();
    const encKey = await this._getOrCreateKey(fileData);
    fileData.entries[key] = this._encrypt(encKey, value);
    this._saveFile(fileData);
    log.debug({ key }, 'Secret stored');
  }

  /**
   * Delete a secret by key.
   *
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    const fileData = this._loadFile();
    if (!fileData.entries[key]) return;
    delete fileData.entries[key];
    this._saveFile(fileData);
    log.debug({ key }, 'Secret deleted');
  }

  /**
   * List all stored secret keys (values are not returned).
   *
   * @returns {Promise<string[]>}
   */
  async list() {
    const fileData = this._loadFile();
    return Object.keys(fileData.entries);
  }

  /**
   * Decrypt and return all stored secrets as a plain object.
   * Then overlay them on top of process.env — secrets take precedence.
   *
   * This is the primary way to get all runtime credentials.
   *
   * @returns {Promise<Record<string, string>>} Merged env + secrets
   */
  async getAll() {
    const fileData = this._loadFile();
    const keys = Object.keys(fileData.entries);
    if (keys.length === 0) {
      return { ...process.env };
    }

    const encKey = await this._getOrCreateKey(fileData);
    const decrypted = {};

    for (const key of keys) {
      try {
        decrypted[key] = this._decrypt(encKey, fileData.entries[key]);
      } catch (err) {
        log.warn({ key, err }, 'Could not decrypt secret entry — skipping');
      }
    }

    // Merge: process.env first, then secrets overlay (secrets win)
    return { ...process.env, ...decrypted };
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton factory
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Get or create the singleton SecretsStore for the current dataDir.
 *
 * @param {string} [dataDir] - Defaults to config dataDir or ~/.potatoclaw
 * @returns {SecretsStore}
 */
function getStore(dataDir) {
  if (!_instance) {
    const dir = dataDir || process.env.DATA_DIR || require('path').join(require('os').homedir(), '.potatoclaw');
    _instance = new SecretsStore(dir);
  }
  return _instance;
}

module.exports = SecretsStore;
module.exports.getStore = getStore;
