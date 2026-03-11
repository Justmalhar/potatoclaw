'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Fields that can be updated via the UI
const SAFE_FIELDS = [
  'defaultModel',
  'defaultProvider',
  'maxTurns',
  'logLevel',
  'dataDir',
];

function loadSettings(config) {
  let persisted = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      persisted = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (_) {}

  // Merge: config defaults first, then persisted overrides
  return {
    defaultModel: (config && config.defaultModel) || 'claude-opus-4-6',
    defaultProvider: (config && config.defaultProvider) || 'claude',
    maxTurns: (config && config.maxTurns) || 100,
    logLevel: process.env.LOG_LEVEL || (config && config.logLevel) || 'info',
    dataDir: DATA_DIR,
    ...persisted,
  };
}

function saveSettings(settings) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const safe = {};
  for (const key of SAFE_FIELDS) {
    if (key in settings) safe[key] = settings[key];
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2), 'utf-8');
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {{ config }} ctx
 */
async function register(server, ctx) {
  // GET /api/settings
  server.get('/api/settings', async () => {
    return loadSettings(ctx.config);
  });

  // PUT /api/settings — update safe fields only
  server.put('/api/settings', async (req, reply) => {
    const body = req.body || {};
    const current = loadSettings(ctx.config);
    const updated = { ...current };

    for (const key of SAFE_FIELDS) {
      if (key in body && key !== 'dataDir') { // dataDir is read-only
        updated[key] = body[key];
      }
    }

    saveSettings(updated);

    // Update live config object if available
    if (ctx.config) {
      for (const key of SAFE_FIELDS) {
        if (key in updated) ctx.config[key] = updated[key];
      }
    }

    return updated;
  });
}

module.exports = register;
