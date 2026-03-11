'use strict';

// Mock the ESM Claude SDK before any require chain loads it
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

// The provider index caches instances in a module-level Map.
// We need to clear that cache between tests.
let providers;

beforeEach(() => {
  // Re-require fresh module (clears the module-level _cache Map)
  jest.isolateModules(() => {
    providers = require('../../src/providers/index');
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('providers/index', () => {
  describe('listProviders', () => {
    test('returns array of provider names', () => {
      const list = providers.listProviders();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toContain('claude');
      expect(list).toContain('opencode');
    });
  });

  describe('getProvider', () => {
    test('returns a provider instance for "claude"', () => {
      const p = providers.getProvider('claude');
      expect(p).toBeDefined();
      expect(typeof p.query).toBe('function');
    });

    test('returns a provider instance for "opencode"', () => {
      const p = providers.getProvider('opencode');
      expect(p).toBeDefined();
    });

    test('is case-insensitive', () => {
      const p1 = providers.getProvider('Claude');
      const p2 = providers.getProvider('CLAUDE');
      expect(p1).toBe(p2); // same cached instance
    });

    test('returns same instance for same name+config (cache hit)', () => {
      const p1 = providers.getProvider('claude', { model: 'same' });
      const p2 = providers.getProvider('claude', { model: 'same' });
      expect(p1).toBe(p2);
    });

    test('returns different instances for different configs', () => {
      const p1 = providers.getProvider('claude', { model: 'model-a' });
      const p2 = providers.getProvider('claude', { model: 'model-b' });
      expect(p1).not.toBe(p2);
    });

    test('throws for unknown provider name', () => {
      expect(() => providers.getProvider('unknown_xyz')).toThrow(/Unknown provider/);
    });

    test('defaults to "claude" when name is null/undefined', () => {
      const p = providers.getProvider(null);
      expect(p).toBeDefined();
    });
  });

  describe('disposeProvider', () => {
    test('disposes and removes instance from cache', async () => {
      // Get an instance first
      const p = providers.getProvider('claude', { model: 'dispose-test' });
      const disposeSpy = jest.spyOn(p, 'dispose').mockResolvedValue(undefined);

      await providers.disposeProvider('claude', { model: 'dispose-test' });

      expect(disposeSpy).toHaveBeenCalledTimes(1);

      // After dispose, a new call should create a fresh instance
      const p2 = providers.getProvider('claude', { model: 'dispose-test' });
      expect(p2).not.toBe(p);
    });

    test('does not throw for unknown/non-cached provider', async () => {
      await expect(
        providers.disposeProvider('claude', { model: 'never-created' })
      ).resolves.not.toThrow();
    });
  });

  describe('disposeAll', () => {
    test('disposes all cached instances without throwing', async () => {
      providers.getProvider('claude', { model: 'a' });
      providers.getProvider('opencode', { model: 'b' });
      await expect(providers.disposeAll()).resolves.not.toThrow();
    });
  });

  describe('exported classes', () => {
    test('ClaudeProvider is exported', () => {
      expect(typeof providers.ClaudeProvider).toBe('function');
    });

    test('OpencodeProvider is exported', () => {
      expect(typeof providers.OpencodeProvider).toBe('function');
    });
  });
});
