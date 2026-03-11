'use strict';

const { createLogger } = require('../../src/utils/logger');

describe('createLogger', () => {
  test('returns a logger object', () => {
    const log = createLogger('test');
    expect(log).toBeDefined();
  });

  test('logger has standard log-level methods', () => {
    const log = createLogger('test');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  test('calling log.info does not throw', () => {
    const log = createLogger('test');
    expect(() => log.info({ key: 'val' }, 'Test message')).not.toThrow();
  });

  test('calling log.error does not throw', () => {
    const log = createLogger('test');
    expect(() => log.error({ err: new Error('test') }, 'Error occurred')).not.toThrow();
  });

  test('calling log.warn does not throw', () => {
    const log = createLogger('test');
    expect(() => log.warn('Warning message')).not.toThrow();
  });

  test('calling log.debug does not throw', () => {
    const log = createLogger('test');
    expect(() => log.debug({ detail: 'x' }, 'Debug info')).not.toThrow();
  });

  test('creates child loggers with different names independently', () => {
    const log1 = createLogger('module-a');
    const log2 = createLogger('module-b');
    expect(log1).toBeDefined();
    expect(log2).toBeDefined();
    // They should be separate objects
    expect(log1).not.toBe(log2);
  });
});
