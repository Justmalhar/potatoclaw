'use strict';

const ChannelContext  = require('../../src/channels/context');
const ChannelRegistry = require('../../src/channels/registry');
const MemoryManager   = require('../../src/memory/manager');
const SessionManager  = require('../../src/sessions/manager');

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-chanctx-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

function makeContext() {
  const registry = new ChannelRegistry(tmpDir);
  const memory   = new MemoryManager('default', tmpDir);
  const sessions = new SessionManager('default', tmpDir);
  const ctx = new ChannelContext({ channelRegistry: registry, memoryManager: memory, sessionManager: sessions, dataDir: tmpDir });
  return { ctx, registry };
}

describe('ChannelContext', () => {
  describe('buildContext', () => {
    test('returns context object with required fields for unbound channel', async () => {
      const { ctx } = makeContext();
      const result = await ctx.buildContext('slack', 'C999');
      expect(result).toBeDefined();
      expect(typeof result.summary).toBe('string');
      expect(Array.isArray(result.recentMessages)).toBe(true);
      expect(typeof result.channelMemory).toBe('string');
    });

    test('includes agentId from bound channel', async () => {
      const { ctx, registry } = makeContext();
      registry.bind('slack', 'C123', 'engineer');
      const result = await ctx.buildContext('slack', 'C123');
      expect(result.agentId).toBe('engineer');
    });

    test('includes systemPromptOverride from binding', async () => {
      const { ctx, registry } = makeContext();
      registry.bind('slack', 'C456', 'engineer', { systemPromptOverride: 'Focus on tests.' });
      const result = await ctx.buildContext('slack', 'C456');
      expect(result.systemPromptOverride).toBe('Focus on tests.');
    });
  });

  describe('appendMessage', () => {
    test('does not throw for valid message', async () => {
      const { ctx } = makeContext();
      await expect(
        ctx.appendMessage('slack', 'C123', { role: 'user', content: 'hello' })
      ).resolves.not.toThrow();
    });

    test('message appears in recentMessages after appending', async () => {
      const { ctx, registry } = makeContext();
      registry.bind('slack', 'C789', 'engineer');
      await ctx.appendMessage('slack', 'C789', { role: 'user', content: 'test message' });
      const result = await ctx.buildContext('slack', 'C789');
      // Recent messages loaded from transcript
      const found = result.recentMessages.some(m => m.content === 'test message');
      expect(found).toBe(true);
    });
  });

  describe('getSummaryPath', () => {
    test('returns a path string', () => {
      const { ctx } = makeContext();
      const p = ctx.getSummaryPath('slack:C123');
      expect(typeof p).toBe('string');
      expect(p).toContain('slack');
    });
  });

  describe('getMemoryPath', () => {
    test('returns a path string', () => {
      const { ctx } = makeContext();
      const p = ctx.getMemoryPath('slack:C123');
      expect(typeof p).toBe('string');
    });
  });
});
