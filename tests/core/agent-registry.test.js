'use strict';

// Mock the ESM Claude SDK before any require chain loads it
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { EventEmitter } = require('events');

const AgentRegistry = require('../../src/core/agent-registry');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-agentreg-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

/**
 * Return a registry with _initAgent stubbed so we don't need real providers.
 */
function makeRegistry() {
  const registry = new AgentRegistry({ dataDir: tmpDir });

  registry._initAgent = async (definition) => {
    const agent = Object.assign(new EventEmitter(), {
      id: definition.id,
      status: 'idle',
      currentTask: null,
      definition,
    });
    const runner = Object.assign(new EventEmitter(), {
      queueDepth: 0,
      isProcessing: false,
      stats: { totalQueued: 0, totalProcessed: 0, totalFailed: 0 },
      stop: jest.fn().mockResolvedValue(undefined),
    });
    registry._agents.set(definition.id, { agent, runner, definition });
  };

  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentRegistry', () => {
  describe('get', () => {
    test('returns null for unknown agentId', () => {
      const registry = makeRegistry();
      expect(registry.get('nobody')).toBeNull();
    });

    test('returns entry after create', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'eng', name: 'Engineer', model: 'claude-sonnet-4-6' });
      const entry = registry.get('eng');
      expect(entry).not.toBeNull();
      expect(entry.definition.id).toBe('eng');
    });
  });

  describe('list', () => {
    test('returns empty array when no agents loaded', () => {
      const registry = makeRegistry();
      expect(registry.list()).toEqual([]);
    });

    test('returns one entry per created agent', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'a1', name: 'A1', model: 'claude-sonnet-4-6' });
      await registry.create({ id: 'a2', name: 'A2', model: 'claude-sonnet-4-6' });
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map(e => e.id)).toContain('a1');
      expect(list.map(e => e.id)).toContain('a2');
    });

    test('each entry has required fields', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'x', name: 'X', model: 'claude-sonnet-4-6' });
      const [entry] = registry.list();
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.status).toBe('string');
      expect(typeof entry.queueDepth).toBe('number');
      expect(typeof entry.isProcessing).toBe('boolean');
    });
  });

  describe('getAll', () => {
    test('returns the internal agents Map', () => {
      const registry = makeRegistry();
      expect(registry.getAll()).toBeInstanceOf(Map);
    });
  });

  describe('create', () => {
    test('creates agent and emits created event', async () => {
      const registry = makeRegistry();
      const events = [];
      registry.on('created', (e) => events.push(e));
      await registry.create({ id: 'new-agent', name: 'New', model: 'claude-sonnet-4-6' });
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('new-agent');
    });

    test('persists definition — entry is retrievable and has timestamps', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'persist-me', name: 'P', model: 'claude-sonnet-4-6' });
      const entry = registry.get('persist-me');
      expect(entry).not.toBeNull();
      expect(entry.definition.createdAt).toBeDefined();
      expect(entry.definition.updatedAt).toBeDefined();
    });

    test('throws if agent with same id already exists', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'dup', name: 'A', model: 'claude-sonnet-4-6' });
      await expect(
        registry.create({ id: 'dup', name: 'B', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();
    });

    test('throws if definition has no id', async () => {
      const registry = makeRegistry();
      await expect(
        registry.create({ name: 'No ID' })
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('updates definition and emits updated event', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'upd', name: 'Old', model: 'claude-sonnet-4-6' });

      const events = [];
      registry.on('updated', (e) => events.push(e));
      await registry.update('upd', { id: 'upd', name: 'New Name', model: 'claude-sonnet-4-6' });

      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('upd');
      expect(registry.get('upd').definition.name).toBe('New Name');
    });

    test('throws for unknown agentId', async () => {
      const registry = makeRegistry();
      await expect(
        registry.update('nope', { id: 'nope', name: 'X' })
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('removes agent from registry', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'del', name: 'Del', model: 'claude-sonnet-4-6' });
      await registry.delete('del');
      expect(registry.get('del')).toBeNull();
    });

    test('emits deleted event', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 'del2', name: 'D', model: 'claude-sonnet-4-6' });
      const events = [];
      registry.on('deleted', (e) => events.push(e));
      await registry.delete('del2');
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('del2');
    });

    test('throws for unknown agentId', async () => {
      const registry = makeRegistry();
      await expect(registry.delete('ghost')).rejects.toThrow();
    });
  });

  describe('stopAll', () => {
    test('calls stop on all runners', async () => {
      const registry = makeRegistry();
      await registry.create({ id: 's1', name: 'S1', model: 'claude-sonnet-4-6' });
      await registry.create({ id: 's2', name: 'S2', model: 'claude-sonnet-4-6' });
      await registry.stopAll();
      // Runners are mocked with jest.fn() stop — they should have been called
      for (const { runner } of registry.getAll().values()) {
        expect(runner.stop).toHaveBeenCalled();
      }
    });
  });

  describe('_readDefinitionsFromDir', () => {
    test('reads valid JSON files with id field', () => {
      const registry = makeRegistry();
      const dir = path.join(tmpDir, 'defs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', name: 'A' }));
      fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ id: 'b', name: 'B' }));

      const defs = registry._readDefinitionsFromDir(dir, 'test');
      expect(defs).toHaveLength(2);
      expect(defs.map(d => d.id).sort()).toEqual(['a', 'b']);
    });

    test('skips files missing id', () => {
      const registry = makeRegistry();
      const dir = path.join(tmpDir, 'defs2');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'noid.json'), JSON.stringify({ name: 'No ID' }));

      const defs = registry._readDefinitionsFromDir(dir, 'test');
      expect(defs).toHaveLength(0);
    });

    test('skips non-JSON files', () => {
      const registry = makeRegistry();
      const dir = path.join(tmpDir, 'defs3');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'readme.txt'), 'not json');
      fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({ id: 'ok' }));

      const defs = registry._readDefinitionsFromDir(dir, 'test');
      expect(defs).toHaveLength(1);
    });

    test('returns empty array for nonexistent directory', () => {
      const registry = makeRegistry();
      const defs = registry._readDefinitionsFromDir('/nonexistent/absolutely', 'test');
      expect(defs).toEqual([]);
    });
  });
});
