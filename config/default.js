'use strict';

const os = require('os');
const path = require('path');

/**
 * Resolve dataDir:
 *   1. DATA_DIR env var (set in Docker via docker-compose)
 *   2. /data  if it exists (Docker default)
 *   3. ~/.potatoclaw for local development
 */
function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  // Docker default
  try {
    const fs = require('fs');
    if (fs.existsSync('/data')) {
      return '/data';
    }
  } catch (_) {
    // ignore
  }
  return path.join(os.homedir(), '.potatoclaw');
}

const config = {
  agentId: 'potatoclaw',

  dataDir: resolveDataDir(),

  gateway: {
    port: parseInt(process.env.GATEWAY_PORT, 10) || 4096,
    host: '0.0.0.0',
  },

  ui: {
    port: parseInt(process.env.UI_PORT, 10) || 4200,
    host: '0.0.0.0',
    auth: {
      enabled: true,
      // Password is resolved at runtime from secrets store or UI_PASSWORD env var
    },
  },

  agent: {
    defaultModel: 'claude-opus-4-6',
    defaultProvider: 'claude',
    maxTurns: 100,
    permissionMode: 'bypassPermissions',
  },

  adapters: {
    slack: {
      enabled: !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN),
      socketMode: true,
      botToken: process.env.SLACK_BOT_TOKEN || '',
      appToken: process.env.SLACK_APP_TOKEN || '',
      signingSecret: process.env.SLACK_SIGNING_SECRET || '',
    },
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      token: process.env.TELEGRAM_BOT_TOKEN || '',
    },
    discord: {
      enabled: !!process.env.DISCORD_BOT_TOKEN,
      token: process.env.DISCORD_BOT_TOKEN || '',
    },
    whatsapp: {
      enabled: false,
    },
    signal: {
      enabled: false,
    },
    imessage: {
      enabled: false,
    },
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
