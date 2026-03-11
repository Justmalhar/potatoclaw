'use strict';

const { EventEmitter } = require('events');
const Orchestrator = require('../../src/core/orchestrator');

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeAgentEntry(agentId) {
  const definition = { id: agentId, name: agentId, model: 'claude-sonnet-4-6' };

  const agent = Object.assign(new EventEmitter(), {
    id: agentId,
    status: 'idle',
    definition,
  });

  // Minimal runner mock
  const runner = Object.assign(new EventEmitter(), {
    _orchestratorWired: false,
    queueDepth: 0,
    isProcessing: false,
    currentItem: null,
    stats: { totalQueued: 0, totalProcessed: 0, totalFailed: 0 },
    enqueue: jest.fn((item) => { runner.queueDepth++; return 0; }),
  });

  return { agent, runner, definition };
}

function makeAgentRegistry(agentIds = ['engineer']) {
  const entries = new Map();
  for (const id of agentIds) entries.set(id, makeAgentEntry(id));

  return Object.assign(new EventEmitter(), {
    get: (id) => entries.get(id) || null,
    getAll: () => entries,
    _entries: entries,
  });
}

function makeTaskManager() {
  const tm = Object.assign(new EventEmitter(), {
    get: jest.fn().mockResolvedValue(null),
    transition: jest.fn().mockResolvedValue({}),
    complete: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'task_001', assignedAgentId: 'engineer' }),
  });
  return tm;
}

function makeRunTracker() {
  const rt = Object.assign(new EventEmitter(), {
    startRun: jest.fn().mockResolvedValue({ id: 'run_001', status: 'running' }),
    addStep: jest.fn().mockResolvedValue({}),
    completeRun: jest.fn().mockResolvedValue({}),
    failRun: jest.fn().mockResolvedValue({}),
    getRun: jest.fn().mockResolvedValue({ id: 'run_001', status: 'completed', steps: [] }),
  });
  return rt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator', () => {
  let agentRegistry, taskManager, runTracker, orchestrator;

  beforeEach(() => {
    agentRegistry = makeAgentRegistry(['engineer', 'researcher']);
    taskManager   = makeTaskManager();
    runTracker    = makeRunTracker();

    orchestrator = new Orchestrator({ agentRegistry, taskManager, runTracker });
  });

  describe('enqueueChannelMessage', () => {
    test('enqueues item to the correct agent runner', () => {
      const entry = agentRegistry.get('engineer');
      orchestrator.enqueueChannelMessage('engineer', {
        sessionKey: 'potatoclaw:engineer:slack:channel:C1',
        text: 'hello',
        adapter: {},
        channelId: 'C1',
        platform: 'slack',
      });
      expect(entry.runner.enqueue).toHaveBeenCalledTimes(1);
      const item = entry.runner.enqueue.mock.calls[0][0];
      expect(item.type).toBe('message');
      expect(item.text).toBe('hello');
    });

    test('does nothing for unknown agent', () => {
      // Should not throw
      expect(() => {
        orchestrator.enqueueChannelMessage('nonexistent', { text: 'hi', sessionKey: 'x' });
      }).not.toThrow();
    });
  });

  describe('enqueueTask', () => {
    test('calls runTracker.startRun', async () => {
      await orchestrator.enqueueTask({
        id: 'task_abc',
        title: 'Do something',
        description: 'Details here',
        assignedAgentId: 'engineer',
        channelId: 'slack:C123',
        priority: 'high',
      });
      expect(runTracker.startRun).toHaveBeenCalledTimes(1);
    });

    test('enqueues a task-type item on the runner', async () => {
      const entry = agentRegistry.get('engineer');
      await orchestrator.enqueueTask({
        id: 'task_def',
        title: 'Fix bug',
        description: '',
        assignedAgentId: 'engineer',
        priority: 'normal',
      });
      expect(entry.runner.enqueue).toHaveBeenCalledTimes(1);
      const item = entry.runner.enqueue.mock.calls[0][0];
      expect(item.type).toBe('task');
    });

    test('does nothing for task with no assignedAgentId', async () => {
      await expect(
        orchestrator.enqueueTask({ id: 'task_xyz', title: 'Unassigned' })
      ).resolves.not.toThrow();
      expect(runTracker.startRun).not.toHaveBeenCalled();
    });
  });

  describe('getQueueStatus', () => {
    test('returns array with entry per agent', () => {
      const status = orchestrator.getQueueStatus();
      expect(Array.isArray(status)).toBe(true);
      expect(status.length).toBe(2); // engineer + researcher
      const agentIds = status.map(s => s.agentId);
      expect(agentIds).toContain('engineer');
      expect(agentIds).toContain('researcher');
    });

    test('each entry has required fields', () => {
      const [entry] = orchestrator.getQueueStatus();
      expect(typeof entry.queueDepth).toBe('number');
      expect(typeof entry.isProcessing).toBe('boolean');
    });
  });

  describe('queue:updated event', () => {
    test('emits queue:updated after enqueueChannelMessage', (done) => {
      orchestrator.once('queue:updated', (e) => {
        expect(e.agentId).toBe('engineer');
        expect(typeof e.queueDepth).toBe('number');
        done();
      });
      orchestrator.enqueueChannelMessage('engineer', {
        sessionKey: 'potatoclaw:engineer:slack:channel:C1',
        text: 'hi',
        adapter: {},
        channelId: 'C1',
        platform: 'slack',
      });
    });
  });
});
