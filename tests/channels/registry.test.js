'use strict';

// ---------------------------------------------------------------------------
// channels/registry.test.js — unit tests for src/channels/registry.js
//
// The registry module does NOT exist yet; we test against its interface
// contract as described in the architecture docs.  When the file is
// created, these tests should pass without modification.
//
// Interface contract (from docs):
//   new ChannelRegistry(dataDir)
//   bind(platform, channelId, agentId, options)  → binding object
//   get(platform, channelId)                     → binding | null
//   unbind(platform, channelId)                  → void
//   list()                                       → binding[]
//   static channelKey(platform, channelId)       → string
//   Persistence: save() writes JSON, reload works after new instance
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Conditional require — if the module doesn't exist yet, create a minimal
// stub so the test file can at least be loaded.  Tests against the stub
// will fail (not error), which is the desired "tests fail until source
// is written" behaviour.
// ---------------------------------------------------------------------------
let ChannelRegistry;
try {
  ChannelRegistry = require('../../src/channels/registry');
} catch (_) {
  // Stub so describe blocks are visible and tests fail correctly
  ChannelRegistry = class ChannelRegistry {
    constructor() {}
    bind() { throw new Error('ChannelRegistry not implemented'); }
    get() { throw new Error('ChannelRegistry not implemented'); }
    unbind() { throw new Error('ChannelRegistry not implemented'); }
    list() { throw new Error('ChannelRegistry not implemented'); }
    static channelKey() { throw new Error('ChannelRegistry not implemented'); }
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-registry-test-'));
}

describe('ChannelRegistry', () => {
  let tmpDir;
  let registry;

  beforeEach(() => {
    tmpDir = makeTempDir();
    registry = new ChannelRegistry(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // channelKey static method
  // -------------------------------------------------------------------------

  describe('channelKey (static)', () => {
    test('formats as platform:channelId', () => {
      expect(ChannelRegistry.channelKey('slack', 'C01234567')).toBe('slack:C01234567');
    });

    test('formats telegram channel key', () => {
      expect(ChannelRegistry.channelKey('telegram', '-100123456789')).toBe('telegram:-100123456789');
    });

    test('formats discord channel key', () => {
      expect(ChannelRegistry.channelKey('discord', '987654321098765432')).toBe(
        'discord:987654321098765432'
      );
    });
  });

  // -------------------------------------------------------------------------
  // bind + get round trip
  // -------------------------------------------------------------------------

  describe('bind + get', () => {
    test('binds a channel and retrieves it', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      const binding = registry.get('slack', 'C01234567');
      expect(binding).toBeDefined();
      expect(binding).not.toBeNull();
      expect(binding.agentId).toBe('engineer');
    });

    test('binding includes platform and channelId', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      const binding = registry.get('slack', 'C01234567');
      expect(binding.platform).toBe('slack');
      expect(binding.channelId).toBe('C01234567');
    });

    test('binding includes createdAt timestamp', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      const binding = registry.get('slack', 'C01234567');
      expect(binding.createdAt).toBeDefined();
    });

    test('optional options are stored in the binding', () => {
      registry.bind('slack', 'C01234567', 'engineer', {
        systemPromptOverride: 'Focus on auth.',
        recentMessageWindow: 10,
      });
      const binding = registry.get('slack', 'C01234567');
      expect(binding.systemPromptOverride).toBe('Focus on auth.');
      expect(binding.recentMessageWindow).toBe(10);
    });

    test('rebinding overwrites the previous binding', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('slack', 'C01234567', 'researcher');
      const binding = registry.get('slack', 'C01234567');
      expect(binding.agentId).toBe('researcher');
    });

    test('different platforms with the same channel ID are independent', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('discord', 'C01234567', 'researcher');
      expect(registry.get('slack', 'C01234567').agentId).toBe('engineer');
      expect(registry.get('discord', 'C01234567').agentId).toBe('researcher');
    });
  });

  // -------------------------------------------------------------------------
  // unbind
  // -------------------------------------------------------------------------

  describe('unbind', () => {
    test('removes a binding so get returns null', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.unbind('slack', 'C01234567');
      expect(registry.get('slack', 'C01234567')).toBeNull();
    });

    test('unbinding a non-existent binding does not throw', () => {
      expect(() => registry.unbind('slack', 'NOTEXIST')).not.toThrow();
    });

    test('unbinding one channel does not affect others', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('slack', 'C07654321', 'researcher');
      registry.unbind('slack', 'C01234567');
      expect(registry.get('slack', 'C07654321')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // get — returns null for unbound channel
  // -------------------------------------------------------------------------

  describe('get unbound', () => {
    test('returns null for a channel that was never bound', () => {
      expect(registry.get('slack', 'UNBOUND')).toBeNull();
    });

    test('returns null for an unrecognised platform', () => {
      expect(registry.get('myspace', 'C01234567')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    test('returns empty array when no bindings exist', () => {
      expect(registry.list()).toEqual([]);
    });

    test('returns all bindings', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('telegram', '-100123', 'researcher');
      const bindings = registry.list();
      expect(bindings).toHaveLength(2);
    });

    test('each binding in the list has required fields', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      const [binding] = registry.list();
      expect(binding.agentId).toBe('engineer');
      expect(binding.platform).toBe('slack');
      expect(binding.channelId).toBe('C01234567');
    });

    test('reflects unbind operations', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('slack', 'C07654321', 'researcher');
      registry.unbind('slack', 'C01234567');
      expect(registry.list()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Persistence — save + reload
  // -------------------------------------------------------------------------

  describe('persistence', () => {
    test('bindings survive a new instance pointing at the same dataDir', () => {
      registry.bind('slack', 'C01234567', 'engineer');

      // Simulate restart: create a new registry instance
      const registry2 = new ChannelRegistry(tmpDir);
      const binding = registry2.get('slack', 'C01234567');
      expect(binding).not.toBeNull();
      expect(binding.agentId).toBe('engineer');
    });

    test('unbind is persisted', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.unbind('slack', 'C01234567');

      const registry2 = new ChannelRegistry(tmpDir);
      expect(registry2.get('slack', 'C01234567')).toBeNull();
    });

    test('all bindings are present after reload', () => {
      registry.bind('slack', 'C01234567', 'engineer');
      registry.bind('telegram', '-100123', 'researcher');

      const registry2 = new ChannelRegistry(tmpDir);
      expect(registry2.list()).toHaveLength(2);
    });
  });
});
