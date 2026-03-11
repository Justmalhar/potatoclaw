'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const MemoryManager       = require('../../src/memory/manager');
const { createMemoryTool } = require('../../src/tools/memory');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-memtool-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

async function makeTool(channelId = 'C_default') {
  const memoryManager = new MemoryManager('test-agent', tmpDir);
  await memoryManager.ensureDirs();
  const tool = createMemoryTool({ memoryManager, agentId: 'test-agent', channelId });
  return { tool, memoryManager };
}

function getTool(tool, name) {
  return tool.tools.find(t => t.name === name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('memory MCP tool', () => {
  test('exports name, version, tools, setContext', async () => {
    const { tool } = await makeTool();
    expect(tool.name).toBe('memory');
    expect(typeof tool.version).toBe('string');
    expect(Array.isArray(tool.tools)).toBe(true);
    expect(typeof tool.setContext).toBe('function');
  });

  test('contains all 7 expected tool names', async () => {
    const { tool } = await makeTool();
    const names = tool.tools.map(t => t.name);
    for (const expected of [
      'read_agent_memory', 'write_agent_memory', 'append_agent_memory',
      'read_channel_memory', 'write_channel_memory', 'search_memory',
      'list_memory_files',
    ]) {
      expect(names).toContain(expected);
    }
  });

  // -------------------------------------------------------------------------

  describe('read_agent_memory', () => {
    test('returns success with empty string when no MEMORY.md exists', async () => {
      const { tool } = await makeTool();
      const res = await getTool(tool, 'read_agent_memory').handler({});
      expect(res.result.success).toBe(true);
      expect(typeof res.result.content).toBe('string');
    });
  });

  describe('write_agent_memory', () => {
    test('returns success and sizeBytes', async () => {
      const { tool } = await makeTool();
      const res = await getTool(tool, 'write_agent_memory').handler({ content: 'hi' });
      expect(res.result.success).toBe(true);
      expect(typeof res.result.sizeBytes).toBe('number');
    });
  });

  describe('write_agent_memory → read_agent_memory round-trip', () => {
    test('written content is returned by read', async () => {
      const { tool } = await makeTool();
      await getTool(tool, 'write_agent_memory').handler({ content: 'Persistent data!' });
      const res = await getTool(tool, 'read_agent_memory').handler({});
      expect(res.result.content).toBe('Persistent data!');
    });
  });

  describe('append_agent_memory', () => {
    test('does not throw and returns success', async () => {
      const { tool } = await makeTool();
      const res = await getTool(tool, 'append_agent_memory').handler({ content: 'Daily note.' });
      expect(res.result.success).toBe(true);
    });
  });

  describe('write_channel_memory', () => {
    test('returns success', async () => {
      const { tool } = await makeTool('CHAN_001');
      const res = await getTool(tool, 'write_channel_memory').handler({ content: 'Channel info.' });
      expect(res.result.success).toBe(true);
    });
  });

  describe('read_channel_memory', () => {
    test('returns empty string before any write', async () => {
      const { tool } = await makeTool('CHAN_002');
      const res = await getTool(tool, 'read_channel_memory').handler({});
      expect(res.result.success).toBe(true);
      expect(typeof res.result.content).toBe('string');
    });

    test('round-trip: written content is returned', async () => {
      const { tool } = await makeTool('CHAN_003');
      await getTool(tool, 'write_channel_memory').handler({ content: 'Channel memory data.' });
      const res = await getTool(tool, 'read_channel_memory').handler({});
      expect(res.result.success).toBe(true);
      expect(res.result.content).toBe('Channel memory data.');
    });

    test('errors gracefully when no channelId in context', async () => {
      const memoryManager = new MemoryManager('test-agent', tmpDir);
      await memoryManager.ensureDirs();
      const tool = createMemoryTool({ memoryManager, agentId: 'test-agent', channelId: null });
      const res = await getTool(tool, 'read_channel_memory').handler({});
      expect(res.result.success).toBe(false);
    });
  });

  describe('search_memory', () => {
    test('returns empty matches before any write', async () => {
      const { tool } = await makeTool();
      const res = await getTool(tool, 'search_memory').handler({ query: 'anything', scope: 'agent' });
      expect(res.result.success).toBe(true);
      expect(Array.isArray(res.result.matches)).toBe(true);
    });

    test('finds content after write', async () => {
      const { tool } = await makeTool();
      await getTool(tool, 'write_agent_memory').handler({ content: 'The quick brown fox' });
      const res = await getTool(tool, 'search_memory').handler({ query: 'fox', scope: 'agent' });
      expect(res.result.success).toBe(true);
      expect(res.result.count).toBeGreaterThan(0);
    });
  });

  describe('list_memory_files', () => {
    test('returns agent and channel arrays', async () => {
      const { tool } = await makeTool('CHAN_LIST');
      const res = await getTool(tool, 'list_memory_files').handler({});
      expect(res.result.success).toBe(true);
      expect(Array.isArray(res.result.agent)).toBe(true);
      expect(Array.isArray(res.result.channel)).toBe(true);
    });
  });

  describe('setContext', () => {
    test('can be called without throwing', async () => {
      const { tool } = await makeTool();
      expect(() => tool.setContext({ agentId: 'other', channelId: 'OTHER_CHAN' })).not.toThrow();
    });
  });

  describe('error handling — no memoryManager', () => {
    test('read_agent_memory returns error result', async () => {
      const tool = createMemoryTool({ memoryManager: null, agentId: 'a', channelId: 'C' });
      const res = await getTool(tool, 'read_agent_memory').handler({});
      expect(res.result.success).toBe(false);
      expect(typeof res.result.error).toBe('string');
    });
  });
});
