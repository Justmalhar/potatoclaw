'use strict';

const { EventEmitter } = require('events');
const Gateway = require('../../src/core/gateway');

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeChannelRegistry(binding = null) {
  return {
    get: jest.fn().mockReturnValue(binding),
  };
}

function makeOrchestrator() {
  return {
    enqueueChannelMessage: jest.fn(),
  };
}

function makeCommandHandler(response = null) {
  return {
    isCommand: jest.fn().mockReturnValue(false),
    handle: jest.fn().mockResolvedValue(response),
  };
}

function makeChannelContext() {
  return {
    buildContext: jest.fn().mockResolvedValue({ agentId: 'eng', recentMessages: [], summary: '', channelMemory: '' }),
    appendMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAdapter(shouldRespond = true) {
  const a = Object.assign(new EventEmitter(), {
    name: 'test',
    shouldRespond: jest.fn().mockReturnValue(shouldRespond),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    isConnected: false,
  });
  return a;
}

function makeGateway(opts = {}) {
  return new Gateway({
    config: opts.config || {},
    agentRegistry: opts.agentRegistry || {},
    channelRegistry: opts.channelRegistry || makeChannelRegistry(),
    channelContext: opts.channelContext || makeChannelContext(),
    orchestrator: opts.orchestrator || makeOrchestrator(),
    commandHandler: opts.commandHandler || makeCommandHandler(),
    cronScheduler: opts.cronScheduler || null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gateway', () => {
  describe('constructor', () => {
    test('initializes adapters as empty Map', () => {
      const gw = makeGateway();
      expect(gw.adapters).toBeInstanceOf(Map);
      expect(gw.adapters.size).toBe(0);
    });

    test('stores injected dependencies', () => {
      const orchestrator = makeOrchestrator();
      const gw = makeGateway({ orchestrator });
      expect(gw.orchestrator).toBe(orchestrator);
    });
  });

  describe('getAdapter', () => {
    test('returns null for unknown platform', () => {
      const gw = makeGateway();
      expect(gw.getAdapter('slack')).toBeNull();
    });

    test('returns registered adapter', () => {
      const gw = makeGateway();
      const adapter = makeAdapter();
      gw.adapters.set('slack', adapter);
      expect(gw.getAdapter('slack')).toBe(adapter);
    });
  });

  describe('getAdapterStatus', () => {
    test('returns empty array when no adapters', () => {
      const gw = makeGateway();
      expect(gw.getAdapterStatus()).toEqual([]);
    });

    test('returns entry per adapter', () => {
      const gw = makeGateway();
      gw.adapters.set('slack', makeAdapter());
      gw.adapters.set('telegram', makeAdapter());
      const status = gw.getAdapterStatus();
      expect(status).toHaveLength(2);
      const platforms = status.map(s => s.platform);
      expect(platforms).toContain('slack');
      expect(platforms).toContain('telegram');
    });

    test('each entry has platform and connected fields', () => {
      const gw = makeGateway();
      gw.adapters.set('slack', makeAdapter());
      const [entry] = gw.getAdapterStatus();
      expect(typeof entry.platform).toBe('string');
      expect(typeof entry.connected).toBe('boolean');
    });
  });

  describe('handleMessage', () => {
    test('does nothing when shouldRespond returns false', async () => {
      const orchestrator = makeOrchestrator();
      const gw = makeGateway({ orchestrator });
      const adapter = makeAdapter(false);
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C1', userId: 'U1', text: 'hello' });
      expect(orchestrator.enqueueChannelMessage).not.toHaveBeenCalled();
    });

    test('handles slash commands via commandHandler', async () => {
      const commandHandler = {
        isCommand: jest.fn().mockReturnValue(true),
        handle: jest.fn().mockResolvedValue('✅ Done'),
      };
      const adapter = makeAdapter(true);
      const gw = makeGateway({ commandHandler });
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C1', userId: 'U1', text: '/status' });
      expect(commandHandler.handle).toHaveBeenCalled();
      expect(adapter.sendMessage).toHaveBeenCalledWith('C1', '✅ Done');
    });

    test('does not send when commandHandler returns null', async () => {
      const commandHandler = {
        isCommand: jest.fn().mockReturnValue(true),
        handle: jest.fn().mockResolvedValue(null),
      };
      const adapter = makeAdapter(true);
      const gw = makeGateway({ commandHandler });
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C1', userId: 'U1', text: '/unknown' });
      expect(adapter.sendMessage).not.toHaveBeenCalled();
    });

    test('drops message when no binding and no defaultAgentId', async () => {
      const orchestrator = makeOrchestrator();
      const channelRegistry = makeChannelRegistry(null); // no binding
      const gw = makeGateway({ orchestrator, channelRegistry, config: {} });
      const adapter = makeAdapter(true);
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C_UNBOUND', userId: 'U1', text: 'hello' });
      expect(orchestrator.enqueueChannelMessage).not.toHaveBeenCalled();
    });

    test('uses defaultAgentId when no binding found', async () => {
      const orchestrator = makeOrchestrator();
      const channelRegistry = makeChannelRegistry(null);
      const gw = makeGateway({ orchestrator, channelRegistry, config: { defaultAgentId: 'engineer' } });
      const adapter = makeAdapter(true);
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C_DEFAULT', userId: 'U1', text: 'hello' });
      expect(orchestrator.enqueueChannelMessage).toHaveBeenCalledWith(
        'engineer',
        expect.objectContaining({ text: 'hello' })
      );
    });

    test('enqueues message for bound agent', async () => {
      const orchestrator = makeOrchestrator();
      const channelRegistry = makeChannelRegistry({ agentId: 'researcher' });
      const gw = makeGateway({ orchestrator, channelRegistry });
      const adapter = makeAdapter(true);
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C99', userId: 'U1', text: 'research this' });
      expect(orchestrator.enqueueChannelMessage).toHaveBeenCalledWith(
        'researcher',
        expect.objectContaining({ text: 'research this', platform: 'slack', channelId: 'C99' })
      );
    });

    test('appends message to transcript for bound channel', async () => {
      const channelContext = makeChannelContext();
      const channelRegistry = makeChannelRegistry({ agentId: 'eng' });
      const gw = makeGateway({ channelContext, channelRegistry });
      const adapter = makeAdapter(true);
      await gw.handleMessage(adapter, { platform: 'slack', channelId: 'C1', userId: 'U1', text: 'log this' });
      // appendMessage is called async; give it a tick
      await new Promise(r => setImmediate(r));
      expect(channelContext.appendMessage).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    test('does not throw when no adapters or http server', async () => {
      const gw = makeGateway();
      await expect(gw.stop()).resolves.not.toThrow();
    });

    test('calls stop() on registered adapters', async () => {
      const gw = makeGateway();
      const adapter = Object.assign(makeAdapter(), { stop: jest.fn().mockResolvedValue(undefined) });
      gw.adapters.set('test', adapter);
      await gw.stop();
      expect(adapter.stop).toHaveBeenCalled();
    });
  });
});
