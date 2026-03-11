'use strict';

const BaseProvider = require('../../src/providers/base');

// ---------------------------------------------------------------------------
// Concrete subclass for testing
// ---------------------------------------------------------------------------

class TestProvider extends BaseProvider {
  get name() { return 'test'; }

  async *query() {
    yield { type: 'text', content: 'hello' };
    yield { type: 'done' };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseProvider', () => {
  describe('constructor', () => {
    test('stores config', () => {
      const p = new TestProvider({ model: 'test-model', maxTurns: 5 });
      expect(p.config.model).toBe('test-model');
      expect(p.config.maxTurns).toBe(5);
    });

    test('initializes empty session and abort-controller maps', () => {
      const p = new TestProvider();
      expect(p._sessions.size).toBe(0);
      expect(p._abortControllers.size).toBe(0);
    });

    test('sets _model from config', () => {
      const p = new TestProvider({ model: 'claude-haiku-4-5' });
      expect(p._model).toBe('claude-haiku-4-5');
    });

    test('_model is null when not provided', () => {
      const p = new TestProvider();
      expect(p._model).toBeNull();
    });
  });

  describe('get name()', () => {
    test('concrete subclass returns its name', () => {
      expect(new TestProvider().name).toBe('test');
    });

    test('throws when called on BaseProvider directly', () => {
      const p = new BaseProvider();
      expect(() => p.name).toThrow();
    });
  });

  describe('setModel / getModel', () => {
    test('setModel updates _model', () => {
      const p = new TestProvider();
      p.setModel('claude-opus-4-6');
      expect(p.getModel()).toBe('claude-opus-4-6');
    });

    test('getModel returns null before any setModel call', () => {
      const p = new TestProvider();
      expect(p.getModel()).toBeNull();
    });
  });

  describe('getAvailableModels', () => {
    test('returns empty array by default', () => {
      const p = new TestProvider();
      expect(p.getAvailableModels()).toEqual([]);
    });
  });

  describe('session management', () => {
    test('getSessionId returns null for unknown key', () => {
      const p = new TestProvider();
      expect(p.getSessionId('no:such:key')).toBeNull();
    });

    test('setSessionId + getSessionId round-trip', () => {
      const p = new TestProvider();
      p.setSessionId('key:abc', 'session_123');
      expect(p.getSessionId('key:abc')).toBe('session_123');
    });

    test('multiple session keys are isolated', () => {
      const p = new TestProvider();
      p.setSessionId('key:a', 'sess_a');
      p.setSessionId('key:b', 'sess_b');
      expect(p.getSessionId('key:a')).toBe('sess_a');
      expect(p.getSessionId('key:b')).toBe('sess_b');
    });
  });

  describe('abort', () => {
    test('returns false for unknown sessionKey', () => {
      const p = new TestProvider();
      expect(p.abort('nonexistent')).toBe(false);
    });

    test('returns true and clears controller for known key', () => {
      const p = new TestProvider();
      const controller = new AbortController();
      p._abortControllers.set('my:key', controller);
      const result = p.abort('my:key');
      expect(result).toBe(true);
      expect(p._abortControllers.has('my:key')).toBe(false);
    });

    test('aborts the controller signal', () => {
      const p = new TestProvider();
      const controller = new AbortController();
      p._abortControllers.set('my:key2', controller);
      p.abort('my:key2');
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('initialize', () => {
    test('resolves without throwing', async () => {
      const p = new TestProvider();
      await expect(p.initialize()).resolves.not.toThrow();
    });
  });

  describe('dispose', () => {
    test('clears sessions and abortControllers', async () => {
      const p = new TestProvider();
      p.setSessionId('k1', 's1');
      const controller = new AbortController();
      p._abortControllers.set('k2', controller);

      await p.dispose();

      expect(p._sessions.size).toBe(0);
      expect(p._abortControllers.size).toBe(0);
    });

    test('aborts in-flight controllers during dispose', async () => {
      const p = new TestProvider();
      const controller = new AbortController();
      p._abortControllers.set('live:key', controller);
      await p.dispose();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('query', () => {
    test('base class query() throws', async () => {
      const p = new BaseProvider();
      const gen = p.query({});
      await expect(gen.next()).rejects.toThrow('must implement query');
    });

    test('subclass query() yields expected chunks', async () => {
      const p = new TestProvider();
      const chunks = [];
      for await (const chunk of p.query({})) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toEqual({ type: 'text', content: 'hello' });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    });
  });
});
