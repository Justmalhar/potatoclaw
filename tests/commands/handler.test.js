'use strict';

const CommandHandler = require('../../src/commands/handler');

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeChannelRegistry(bindings = {}) {
  return {
    get: (platform, channelId) => bindings[`${platform}:${channelId}`] || null,
    list: () => Object.entries(bindings).map(([id, b]) => ({ id, ...b })),
  };
}

function makeAgentRegistry(agents = {}) {
  return {
    get: (agentId) => agents[agentId] || null,
    list: () => Object.values(agents).map(({ definition, agent, runner }) => ({
      id: definition.id,
      queueDepth: runner.queueDepth,
      isProcessing: runner.isProcessing,
    })),
  };
}

function makeAgent(id = 'engineer', opts = {}) {
  const definition = { id, name: 'Engineer', model: 'claude-sonnet-4-6', provider: 'claude', tools: ['filesystem'], ...opts.definition };
  const agent = { status: 'idle', memoryManager: opts.memoryManager || null };
  const runner = {
    queueDepth: opts.queueDepth || 0,
    isProcessing: opts.isProcessing || false,
    stats: { totalQueued: 0, totalProcessed: 5, totalFailed: 0 },
    abort: jest.fn().mockReturnValue(opts.abortResult !== undefined ? opts.abortResult : false),
  };
  return { definition, agent, runner };
}

function makeTaskManager(tasks = []) {
  return {
    create: jest.fn().mockResolvedValue({ id: 'task_001', title: 'Test Task', status: 'todo', priority: 'medium' }),
    listByAgent: jest.fn().mockResolvedValue(tasks),
  };
}

function makeHandler(opts = {}) {
  const binding = opts.binding || null;
  const agentEntry = opts.agentEntry || makeAgent();

  const channelRegistry = opts.channelRegistry || (binding
    ? makeChannelRegistry({ 'slack:C1': binding })
    : makeChannelRegistry());

  const agentRegistry = opts.agentRegistry || (binding
    ? makeAgentRegistry({ [binding.agentId]: agentEntry })
    : makeAgentRegistry());

  const taskManager = opts.taskManager || makeTaskManager();
  const runStore = opts.runStore || { list: jest.fn().mockResolvedValue([]) };
  const sessionManager = opts.sessionManager || { clearSession: jest.fn().mockResolvedValue(undefined) };

  const handler = new CommandHandler({ agentRegistry, channelRegistry, taskManager, runStore, sessionManager });
  return handler;
}

const CTX = { platform: 'slack', channelId: 'C1', userId: 'U123', adapter: {} };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandHandler', () => {
  describe('isCommand', () => {
    test('returns true for slash commands', () => {
      const h = makeHandler();
      expect(h.isCommand('/help')).toBe(true);
      expect(h.isCommand('/status')).toBe(true);
    });

    test('returns false for non-commands', () => {
      const h = makeHandler();
      expect(h.isCommand('hello')).toBe(false);
      expect(h.isCommand('')).toBe(false);
      expect(h.isCommand(null)).toBe(false);
    });
  });

  describe('_parse', () => {
    test('extracts command and empty args', () => {
      const h = makeHandler();
      const { command, args } = h._parse('/help');
      expect(command).toBe('help');
      expect(args).toBe('');
    });

    test('extracts command and args', () => {
      const h = makeHandler();
      const { command, args } = h._parse('/task create Fix bug');
      expect(command).toBe('task');
      expect(args).toBe('create Fix bug');
    });

    test('lowercases the command', () => {
      const h = makeHandler();
      const { command } = h._parse('/STATUS');
      expect(command).toBe('status');
    });
  });

  describe('handle', () => {
    test('returns null for non-command text', async () => {
      const h = makeHandler();
      const result = await h.handle('hello world', CTX);
      expect(result).toBeNull();
    });

    test('returns null for unknown command (passes through to agent)', async () => {
      const h = makeHandler();
      const result = await h.handle('/unknownXYZ', CTX);
      expect(result).toBeNull();
    });
  });

  describe('/help', () => {
    test('returns help text with command list', async () => {
      const h = makeHandler();
      const result = await h.handle('/help', CTX);
      expect(typeof result).toBe('string');
      expect(result).toContain('/new');
      expect(result).toContain('/status');
      expect(result).toContain('/memory');
    });
  });

  describe('/reset and /new', () => {
    test('returns reset message for unbound channel', async () => {
      const h = makeHandler();
      const result = await h.handle('/reset', CTX);
      expect(result).toContain('Session reset');
    });

    test('/new behaves same as /reset', async () => {
      const h = makeHandler();
      const r1 = await h.handle('/reset', CTX);
      const r2 = await h.handle('/new', CTX);
      expect(r1).toBe(r2);
    });

    test('clears session for bound channel', async () => {
      const sessionManager = { clearSession: jest.fn().mockResolvedValue(undefined) };
      const binding = { agentId: 'engineer', platform: 'slack', channelId: 'C1' };
      const h = makeHandler({ binding, sessionManager });
      const result = await h.handle('/reset', CTX);
      expect(result).toContain('Session reset');
      expect(sessionManager.clearSession).toHaveBeenCalled();
    });
  });

  describe('/status', () => {
    test('returns "no agent" message for unbound channel', async () => {
      const h = makeHandler();
      const result = await h.handle('/status', CTX);
      expect(result).toContain('No agent bound');
    });

    test('returns agent status for bound channel', async () => {
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding });
      const result = await h.handle('/status', CTX);
      expect(result).toContain('engineer');
      expect(result).toContain('Status');
    });
  });

  describe('/queue', () => {
    test('returns queue status with agent entries', async () => {
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding });
      const result = await h.handle('/queue', CTX);
      expect(result).toContain('Queue Status');
    });

    test('returns "no agents" when registry is empty', async () => {
      const h = new CommandHandler({
        agentRegistry: { list: () => [] },
        channelRegistry: makeChannelRegistry(),
        taskManager: makeTaskManager(),
        runStore: { list: jest.fn().mockResolvedValue([]) },
        sessionManager: {},
      });
      const result = await h.handle('/queue', CTX);
      expect(result).toContain('No agents');
    });
  });

  describe('/stop', () => {
    test('returns "no agent bound" for unbound channel', async () => {
      const h = makeHandler();
      const result = await h.handle('/stop', CTX);
      expect(result).toContain('No agent bound');
    });

    test('returns stopped confirmation when abort returns true', async () => {
      const agentEntry = makeAgent('engineer', { abortResult: true });
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding, agentEntry });
      const result = await h.handle('/stop', CTX);
      expect(result).toContain('Stopped');
    });

    test('returns "nothing to stop" when abort returns false', async () => {
      const agentEntry = makeAgent('engineer', { abortResult: false });
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding, agentEntry });
      const result = await h.handle('/stop', CTX);
      expect(result).toContain('Nothing to stop');
    });
  });

  describe('/model and /provider', () => {
    test('/model returns UI redirect message', async () => {
      const h = makeHandler();
      const result = await h.handle('/model', CTX);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('/provider returns UI redirect message', async () => {
      const h = makeHandler();
      const result = await h.handle('/provider', CTX);
      expect(typeof result).toBe('string');
    });
  });

  describe('/task', () => {
    test('/task create <title> creates and returns task info', async () => {
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding });
      const result = await h.handle('/task create Fix the login bug', CTX);
      expect(result).toContain('Task created');
      expect(result).toContain('task_001');
    });

    test('/task create with no title returns usage error', async () => {
      const binding = { agentId: 'engineer' };
      const h = makeHandler({ binding });
      const result = await h.handle('/task create', CTX);
      expect(result).toContain('Usage');
    });

    test('/task list with bound agent returns task list', async () => {
      const binding = { agentId: 'engineer' };
      const tasks = [
        { id: 't1', title: 'First', status: 'todo', priority: 'high' },
        { id: 't2', title: 'Second', status: 'done', priority: 'low' },
      ];
      const taskManager = makeTaskManager(tasks);
      const h = makeHandler({ binding, taskManager });
      const result = await h.handle('/task list', CTX);
      expect(result).toContain('engineer');
      expect(taskManager.listByAgent).toHaveBeenCalledWith('engineer');
    });

    test('/task list without binding returns "no agent" message', async () => {
      const h = makeHandler();
      const result = await h.handle('/task list', CTX);
      expect(result).toContain('No agent bound');
    });

    test('/task without manager returns error', async () => {
      const h = new CommandHandler({
        agentRegistry: makeAgentRegistry(),
        channelRegistry: makeChannelRegistry(),
        taskManager: null,
        runStore: { list: jest.fn().mockResolvedValue([]) },
        sessionManager: {},
      });
      const result = await h.handle('/task create foo', CTX);
      expect(result).toContain('not available');
    });
  });

  describe('/agent', () => {
    test('returns "no agent bound" for unbound channel', async () => {
      const h = makeHandler();
      const result = await h.handle('/agent', CTX);
      expect(result).toContain('No agent bound');
    });

    test('returns agent details for bound channel', async () => {
      const binding = { agentId: 'engineer', systemPromptOverride: null };
      const h = makeHandler({ binding });
      const result = await h.handle('/agent', CTX);
      expect(result).toContain('engineer');
      expect(result).toContain('Model');
    });
  });

  describe('/channels', () => {
    test('returns "no bindings" when empty', async () => {
      const h = makeHandler();
      const result = await h.handle('/channels', CTX);
      expect(result).toContain('No channel bindings');
    });

    test('lists channel bindings', async () => {
      const binding = { agentId: 'engineer', platform: 'slack', channelId: 'C1' };
      const h = makeHandler({ binding });
      const result = await h.handle('/channels', CTX);
      expect(result).toContain('Channel Bindings');
      expect(result).toContain('engineer');
    });
  });

  describe('/runs', () => {
    test('returns "no recent runs" for empty store', async () => {
      const h = makeHandler();
      const result = await h.handle('/runs', CTX);
      expect(result).toContain('No recent runs');
    });

    test('lists runs when store has entries', async () => {
      const runStore = {
        list: jest.fn().mockResolvedValue([
          { id: 'run_001', agentId: 'engineer', status: 'completed', durationMs: 2000 },
        ]),
      };
      const h = makeHandler({ runStore });
      const result = await h.handle('/runs', CTX);
      expect(result).toContain('run_001');
    });
  });
});
