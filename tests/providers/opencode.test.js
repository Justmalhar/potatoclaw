'use strict';

const OpencodeProvider = require('../../src/providers/opencode');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpencodeProvider', () => {
  describe('constructor', () => {
    test('sets name to "opencode"', () => {
      expect(new OpencodeProvider().name).toBe('opencode');
    });

    test('defaults model to opencode/big-pickle', () => {
      const p = new OpencodeProvider();
      expect(p.getModel()).toBe('opencode/big-pickle');
    });

    test('accepts custom model', () => {
      const p = new OpencodeProvider({ model: 'opencode/grok-code' });
      expect(p.getModel()).toBe('opencode/grok-code');
    });

    test('defaults hostname to 127.0.0.1', () => {
      const p = new OpencodeProvider();
      expect(p.hostname).toBe('127.0.0.1');
    });

    test('defaults port to 4099', () => {
      const p = new OpencodeProvider();
      expect(p.port).toBe(4099);
    });

    test('accepts custom hostname and port', () => {
      const p = new OpencodeProvider({ hostname: '0.0.0.0', port: 5000 });
      expect(p.hostname).toBe('0.0.0.0');
      expect(p.port).toBe(5000);
    });

    test('defaults _initialized to false', () => {
      const p = new OpencodeProvider();
      expect(p._initialized).toBe(false);
    });

    test('accepts existingServerUrl', () => {
      const url = 'http://remote:4099';
      const p = new OpencodeProvider({ existingServerUrl: url });
      expect(p.existingServerUrl).toBe(url);
    });

    test('accepts useExistingServer flag', () => {
      const p = new OpencodeProvider({ useExistingServer: true });
      expect(p.useExistingServer).toBe(true);
    });
  });

  describe('getAvailableModels', () => {
    test('returns array of model objects', () => {
      const p = new OpencodeProvider();
      const models = p.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    test('each model has id and label', () => {
      const p = new OpencodeProvider();
      for (const m of p.getAvailableModels()) {
        expect(typeof m.id).toBe('string');
        expect(typeof m.label).toBe('string');
      }
    });
  });

  describe('inherited BaseProvider behaviour', () => {
    test('session management round-trip', () => {
      const p = new OpencodeProvider();
      p.setSessionId('key:abc', 'session_xyz');
      expect(p.getSessionId('key:abc')).toBe('session_xyz');
    });

    test('abort returns false for unknown sessionKey', () => {
      const p = new OpencodeProvider();
      expect(p.abort('no:key')).toBe(false);
    });

    test('dispose clears sessions and abortControllers', async () => {
      const p = new OpencodeProvider();
      p.setSessionId('k', 'v');
      await p.dispose();
      expect(p._sessions.size).toBe(0);
    });
  });
});
