'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'potatoclaw.log');

// In-process log buffer (last 500 lines)
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];

// Expose a global emitter so logger.js can push to us
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

/**
 * Push a log line into the buffer and broadcast to SSE clients.
 * Called by the logger module or server startup code.
 * @param {string} line - Raw JSON log line from pino
 */
function ingestLogLine(line) {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  logEmitter.emit('line', line);
}

const LEVEL_NUMS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function parseLevelNum(line) {
  try {
    const obj = JSON.parse(line);
    return obj.level || 30;
  } catch {
    return 30;
  }
}

function levelAbove(levelNum, filterLevel) {
  const threshold = LEVEL_NUMS[filterLevel] || 30;
  return levelNum >= threshold;
}

/**
 * @param {import('fastify').FastifyInstance} server
 * @param {object} ctx
 */
async function register(server, ctx) {

  // GET /api/logs — SSE stream of log lines
  server.get('/api/logs', async (req, reply) => {
    const filterLevel = req.query.level || 'info';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':ok\n\n');

    // Send recent buffered lines first
    for (const line of logBuffer) {
      try {
        const lvl = parseLevelNum(line);
        if (levelAbove(lvl, filterLevel)) {
          reply.raw.write(`data: ${line}\n\n`);
        }
      } catch (_) {}
    }

    const onLine = (line) => {
      try {
        const lvl = parseLevelNum(line);
        if (!levelAbove(lvl, filterLevel)) return;
        reply.raw.write(`data: ${line}\n\n`);
      } catch (_) {}
    };

    logEmitter.on('line', onLine);

    // Heartbeat
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n'); } catch (_) {
        clearInterval(heartbeat);
        logEmitter.removeListener('line', onLine);
      }
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      logEmitter.removeListener('line', onLine);
    });

    await new Promise((resolve) => req.raw.on('close', resolve));
  });

  // GET /api/logs/history — last 500 log lines from file
  server.get('/api/logs/history', async (req) => {
    const filterLevel = req.query.level || 'info';
    const limit = parseInt(req.query.limit, 10) || 500;

    // Try in-memory buffer first
    if (logBuffer.length > 0) {
      const filtered = logBuffer
        .filter((line) => levelAbove(parseLevelNum(line), filterLevel))
        .slice(-limit);
      return { lines: filtered.map((l) => { try { return JSON.parse(l); } catch { return { msg: l }; } }) };
    }

    // Fall back to log file
    if (!fs.existsSync(LOG_FILE)) return { lines: [] };

    try {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const filtered = lines
        .filter((line) => levelAbove(parseLevelNum(line), filterLevel))
        .slice(-limit)
        .map((l) => { try { return JSON.parse(l); } catch { return { msg: l }; } });
      return { lines: filtered };
    } catch {
      return { lines: [] };
    }
  });
}

module.exports = register;
module.exports.ingestLogLine = ingestLogLine;
module.exports.logEmitter = logEmitter;
