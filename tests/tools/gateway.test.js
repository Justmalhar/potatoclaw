'use strict';

const { createGatewayTool } = require('../../src/tools/gateway');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(connected = true) {
  return {
    connected,
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function makeTool(opts = {}) {
  const adapters = new Map();
  if (opts.adapters) {
    for (const [k, v] of Object.entries(opts.adapters)) {
      adapters.set(k, v);
    }
  }
  const tool = createGatewayTool({
    adapters,
    agentRegistry: opts.agentRegistry || null,
    sessionKey: opts.sessionKey || 'potatoclaw:eng:slack:channel:C1',
    platform: opts.platform || 'slack',
    channelId: opts.channelId || 'C1',
  });
  return { tool, adapters };
}

function getTool(tool, name) {
  return tool.tools.find(t => t.name === name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gateway MCP tool', () => {
  test('exports name, version, tools, setContext', () => {
    const { tool } = makeTool();
    expect(tool.name).toBe('gateway');
    expect(typeof tool.version).toBe('string');
    expect(Array.isArray(tool.tools)).toBe(true);
    expect(typeof tool.setContext).toBe('function');
  });

  test('contains expected tool names', () => {
    const { tool } = makeTool();
    const names = tool.tools.map(t => t.name);
    expect(names).toContain('send_message');
    expect(names).toContain('broadcast_message');
    expect(names).toContain('list_platforms');
    expect(names).toContain('get_queue_status');
    expect(names).toContain('get_current_context');
    expect(names).toContain('list_sessions');
  });

  // -------------------------------------------------------------------------

  describe('send_message', () => {
    test('sends to correct adapter and returns success', async () => {
      const slack = makeAdapter();
      const { tool } = makeTool({ adapters: { slack } });
      const res = await getTool(tool, 'send_message').handler({
        channel_id: 'slack:C99',
        message: 'Hello!',
      });
      expect(res.result.success).toBe(true);
      expect(slack.sendMessage).toHaveBeenCalledWith('C99', 'Hello!');
    });

    test('returns error for unknown platform', async () => {
      const { tool } = makeTool({ adapters: {} });
      const res = await getTool(tool, 'send_message').handler({
        channel_id: 'telegram:chat123',
        message: 'Hi',
      });
      expect(res.result.success).toBe(false);
      expect(res.result.error).toMatch(/not connected/i);
    });

    test('returns error when adapter.sendMessage throws', async () => {
      const slack = { sendMessage: jest.fn().mockRejectedValue(new Error('API down')) };
      const { tool } = makeTool({ adapters: { slack } });
      const res = await getTool(tool, 'send_message').handler({
        channel_id: 'slack:C1',
        message: 'fail',
      });
      expect(res.result.success).toBe(false);
    });

    test('includes messageLength in success result', async () => {
      const slack = makeAdapter();
      const { tool } = makeTool({ adapters: { slack } });
      const res = await getTool(tool, 'send_message').handler({
        channel_id: 'slack:C1',
        message: 'twelve chars',
      });
      expect(typeof res.result.messageLength).toBe('number');
    });
  });

  describe('broadcast_message', () => {
    test('sends to multiple channels', async () => {
      const slack = makeAdapter();
      const { tool } = makeTool({ adapters: { slack } });
      const res = await getTool(tool, 'broadcast_message').handler({
        message: 'Broadcast!',
        channels: ['slack:C1', 'slack:C2'],
      });
      expect(res.result.success).toBe(true);
      expect(res.result.sent).toBe(2);
      expect(res.result.failed).toBe(0);
    });

    test('tracks failures per channel', async () => {
      const slack = { sendMessage: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('err'))
      };
      const { tool } = makeTool({ adapters: { slack } });
      const res = await getTool(tool, 'broadcast_message').handler({
        message: 'partial',
        channels: ['slack:C1', 'slack:C2'],
      });
      expect(res.result.sent).toBe(1);
      expect(res.result.failed).toBe(1);
    });

    test('returns error when no channels provided', async () => {
      const { tool } = makeTool();
      const res = await getTool(tool, 'broadcast_message').handler({
        message: 'nobody',
        channels: [],
      });
      expect(res.result.success).toBe(false);
    });
  });

  describe('list_platforms', () => {
    test('returns array of platform entries', async () => {
      const slack = makeAdapter(true);
      const telegram = makeAdapter(false);
      const { tool } = makeTool({ adapters: { slack, telegram } });
      const res = await getTool(tool, 'list_platforms').handler({});
      expect(res.result.count).toBe(2);
      const names = res.result.platforms.map(p => p.name);
      expect(names).toContain('slack');
      expect(names).toContain('telegram');
    });

    test('returns empty array for no adapters', async () => {
      const { tool } = makeTool({ adapters: {} });
      const res = await getTool(tool, 'list_platforms').handler({});
      expect(res.result.count).toBe(0);
      expect(res.result.platforms).toEqual([]);
    });
  });

  describe('get_current_context', () => {
    test('returns platform, channelId, and sessionKey from context', async () => {
      const { tool } = makeTool({
        platform: 'slack',
        channelId: 'C42',
        sessionKey: 'potatoclaw:eng:slack:channel:C42',
      });
      const res = await getTool(tool, 'get_current_context').handler({});
      expect(res.result.success).toBe(true);
      expect(res.result.platform).toBe('slack');
      expect(res.result.channelId).toBe('C42');
      expect(res.result.sessionKey).toBe('potatoclaw:eng:slack:channel:C42');
    });
  });

  describe('get_queue_status', () => {
    test('returns error when no agentRegistry', async () => {
      const { tool } = makeTool({ agentRegistry: null });
      const res = await getTool(tool, 'get_queue_status').handler({});
      expect(res.result.success).toBe(false);
    });
  });

  describe('list_sessions', () => {
    test('returns error when no agentRegistry', async () => {
      const { tool } = makeTool({ agentRegistry: null });
      const res = await getTool(tool, 'list_sessions').handler({});
      expect(res.result.success).toBe(false);
    });
  });

  describe('setContext', () => {
    test('updates context for subsequent handlers', async () => {
      const discord = makeAdapter();
      const { tool } = makeTool({ adapters: {} });
      // Add discord adapter and update context
      const newAdapters = new Map();
      newAdapters.set('discord', discord);
      tool.setContext({ adapters: newAdapters, platform: 'discord', channelId: 'D1' });

      const res = await getTool(tool, 'get_current_context').handler({});
      expect(res.result.platform).toBe('discord');
    });
  });
});
