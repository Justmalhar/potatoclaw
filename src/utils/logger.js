'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Build the pino transport config.
 * In development (non-production) we use pino-pretty for human-readable output.
 * In production we emit raw JSON to stdout for log aggregators.
 */
function buildTransport() {
  if (isDev) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat: '[{component}] {msg}',
      },
    };
  }
  return undefined;
}

const transport = buildTransport();

const pinoOptions = {
  level: logLevel,
  base: {
    pid: process.pid,
  },
};

if (transport) {
  pinoOptions.transport = transport;
}

/**
 * Root logger instance.
 * Use this directly for application-level logs, or call createLogger() for
 * component-scoped child loggers.
 */
const logger = pino(pinoOptions);

/**
 * Create a child logger scoped to a named component.
 * The `component` field will appear in every log line from this logger.
 *
 * @param {string} component - e.g. 'gateway', 'slack-adapter', 'orchestrator'
 * @returns {import('pino').Logger}
 *
 * @example
 * const log = createLogger('gateway');
 * log.info({ channelId }, 'Received message');
 */
function createLogger(component) {
  return logger.child({ component });
}

module.exports = logger;
module.exports.createLogger = createLogger;
module.exports.logger = logger;
