'use strict';

// Mock ESM Claude Agent SDK before any require
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

const ClaudeProvider = require('../../src/providers/claude');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeProvider', () => {
  describe('constructor', () => {
    test('sets name to "claude"', () => {
      expect(new ClaudeProvider().name).toBe('claude');
    });

    test('defaults model to claude-sonnet-4-6', () => {
      const p = new ClaudeProvider();
      expect(p.getModel()).toBe('claude-sonnet-4-6');
    });

    test('accepts custom model from config', () => {
      const p = new ClaudeProvider({ model: 'claude-opus-4-6' });
      expect(p.getModel()).toBe('claude-opus-4-6');
    });

    test('defaults permissionMode to bypassPermissions', () => {
      const p = new ClaudeProvider();
      expect(p.permissionMode).toBe('bypassPermissions');
    });

    test('accepts custom permissionMode', () => {
      const p = new ClaudeProvider({ permissionMode: 'default' });
      expect(p.permissionMode).toBe('default');
    });

    test('defaults maxTurns to 50', () => {
      const p = new ClaudeProvider();
      expect(p.defaultMaxTurns).toBe(50);
    });

    test('accepts custom maxTurns', () => {
      const p = new ClaudeProvider({ maxTurns: 10 });
      expect(p.defaultMaxTurns).toBe(10);
    });
  });

  describe('getAvailableModels', () => {
    test('returns array of model objects', () => {
      const p = new ClaudeProvider();
      const models = p.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    test('each model has id and label', () => {
      const p = new ClaudeProvider();
      for (const m of p.getAvailableModels()) {
        expect(typeof m.id).toBe('string');
        expect(typeof m.label).toBe('string');
      }
    });

    test('includes claude-sonnet-4-6', () => {
      const p = new ClaudeProvider();
      const ids = p.getAvailableModels().map(m => m.id);
      expect(ids).toContain('claude-sonnet-4-6');
    });

    test('returns a defensive copy (not the internal array)', () => {
      const p = new ClaudeProvider();
      const a = p.getAvailableModels();
      const b = p.getAvailableModels();
      expect(a).not.toBe(b);
    });
  });

  describe('inherited BaseProvider behaviour', () => {
    test('session management round-trip', () => {
      const p = new ClaudeProvider();
      p.setSessionId('key:abc', 'session_xyz');
      expect(p.getSessionId('key:abc')).toBe('session_xyz');
    });

    test('getSessionId returns null for unknown key', () => {
      const p = new ClaudeProvider();
      expect(p.getSessionId('no:such:key')).toBeNull();
    });

    test('abort returns false for unknown sessionKey', () => {
      const p = new ClaudeProvider();
      expect(p.abort('no:key')).toBe(false);
    });

    test('setModel / getModel round-trip', () => {
      const p = new ClaudeProvider();
      p.setModel('claude-haiku-4-5');
      expect(p.getModel()).toBe('claude-haiku-4-5');
    });

    test('dispose clears sessions', async () => {
      const p = new ClaudeProvider();
      p.setSessionId('k', 'v');
      await p.dispose();
      expect(p._sessions.size).toBe(0);
    });
  });
});
