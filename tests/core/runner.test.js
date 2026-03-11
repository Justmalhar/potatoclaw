'use strict';

// ---------------------------------------------------------------------------
// core/runner.test.js — unit tests for src/core/runner.js (AgentRunner)
//
// AgentRunner API (from the source):
//   new AgentRunner({ agent })
//   runner.enqueue(item)    → number (0-based queue position)
//   runner.queueDepth       → number of waiting items
//   runner.isProcessing     → boolean
//   runner.abort(sessionKey) → boolean
//   runner.stop()           → Promise<void>
//
//   Required item fields: sessionKey, text
//
//   Events: 'queued'     { item, position }
//           'processing' { item, queueDepth }
//           'completed'  { item, durationMs, response }
//           'failed'     { item, error, durationMs }
//           'drained'    {}
// ---------------------------------------------------------------------------

const { EventEmitter } = require('events');
const AgentRunner = require('../../src/core/runner');

// ---------------------------------------------------------------------------
// Mock agent factory
// The real agent.run() is an async generator; we mock it accordingly.
// ---------------------------------------------------------------------------

function makeAgent(opts = {}) {
  const {
    response = 'ok',
    delay = 0,
    shouldThrow = false,
  } = opts;

  const agent = new EventEmitter();
  agent.id = 'test-agent';

  // run() is an async generator that yields a text chunk then a done chunk
  agent.run = jest.fn(async function* () {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    if (shouldThrow) {
      throw new Error('agent run error');
    }
    yield { type: 'text', content: response };
    yield { type: 'done' };
  });

  agent.abort = jest.fn(() => true);

  return agent;
}

// Helper: flush all microtasks and one round of macrotasks
async function flushAll() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// Minimal valid item shape required by AgentRunner.enqueue()
function makeItem(overrides = {}) {
  return {
    sessionKey: 'potatoclaw:test:slack:channel:C001',
    text: 'hello',
    ...overrides,
  };
}

describe('AgentRunner', () => {
  let agent;
  let runner;

  beforeEach(() => {
    agent = makeAgent();
    runner = new AgentRunner({ agent });
  });

  // -------------------------------------------------------------------------
  // enqueue returns queue position
  // -------------------------------------------------------------------------

  describe('enqueue', () => {
    test('returns 0 for the first item enqueued', () => {
      const pos = runner.enqueue(makeItem({ text: 'first' }));
      expect(pos).toBe(0);
    });

    test('throws when item is missing sessionKey', () => {
      expect(() => runner.enqueue({ text: 'no session key' })).toThrow(/sessionKey/);
    });

    test('throws when item is missing text', () => {
      expect(() => runner.enqueue({ sessionKey: 'key' })).toThrow(/text/);
    });

    test('assigns an id to items that do not have one', () => {
      const item = makeItem();
      runner.enqueue(item);
      expect(item.id).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // FIFO processing order
  // -------------------------------------------------------------------------

  describe('FIFO order', () => {
    test('processes items in the order they were enqueued', async () => {
      const processed = [];

      agent.run = jest.fn(async function* (opts) {
        processed.push(opts.text);
        yield { type: 'text', content: 'reply' };
        yield { type: 'done' };
      });

      runner.enqueue(makeItem({ text: 'msg-1' }));
      runner.enqueue(makeItem({ text: 'msg-2' }));
      runner.enqueue(makeItem({ text: 'msg-3' }));

      // Wait for all items to complete
      await new Promise((resolve) => {
        let count = 0;
        runner.on('completed', () => { if (++count === 3) resolve(); });
      });

      expect(processed[0]).toBe('msg-1');
      expect(processed[1]).toBe('msg-2');
      expect(processed[2]).toBe('msg-3');
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Events: queued, processing, completed
  // -------------------------------------------------------------------------

  describe('events', () => {
    test('emits "queued" when an item is enqueued', () => {
      const listener = jest.fn();
      runner.on('queued', listener);
      runner.enqueue(makeItem());
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveProperty('item');
      expect(listener.mock.calls[0][0]).toHaveProperty('position');
    });

    test('emits "processing" when item starts executing', async () => {
      const listener = jest.fn();
      runner.on('processing', listener);
      runner.enqueue(makeItem());
      await flushAll();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveProperty('item');
    });

    test('emits "completed" after agent.run() finishes', async () => {
      const listener = jest.fn();
      runner.on('completed', listener);
      runner.enqueue(makeItem());
      await new Promise((resolve) => runner.on('completed', resolve));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveProperty('response');
      expect(listener.mock.calls[0][0]).toHaveProperty('durationMs');
    });

    test('emits "drained" when queue becomes empty', async () => {
      const drainListener = jest.fn();
      runner.on('drained', drainListener);
      runner.enqueue(makeItem());
      await new Promise((resolve) => runner.on('drained', resolve));
      expect(drainListener).toHaveBeenCalledTimes(1);
    });

    test('emits "failed" when agent.run() throws', async () => {
      const failAgent = makeAgent({ shouldThrow: true });
      const failRunner = new AgentRunner({ agent: failAgent });
      const failListener = jest.fn();
      failRunner.on('failed', failListener);
      failRunner.enqueue(makeItem());
      await new Promise((resolve) => failRunner.on('failed', resolve));
      expect(failListener).toHaveBeenCalledTimes(1);
      expect(failListener.mock.calls[0][0]).toHaveProperty('error');
    });
  });

  // -------------------------------------------------------------------------
  // queueDepth decreases as items are processed
  // -------------------------------------------------------------------------

  describe('queueDepth', () => {
    test('starts at 0', () => {
      expect(runner.queueDepth).toBe(0);
    });

    test('is 0 after all items have been processed', async () => {
      runner.enqueue(makeItem({ text: 'item1' }));
      runner.enqueue(makeItem({ text: 'item2' }));

      await new Promise((resolve) => {
        let done = 0;
        runner.on('drained', () => { if (++done >= 2 || runner.queueDepth === 0) resolve(); });
        runner.on('completed', () => { if (runner.queueDepth === 0 && !runner.isProcessing) resolve(); });
      });

      expect(runner.queueDepth).toBe(0);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // isProcessing
  // -------------------------------------------------------------------------

  describe('isProcessing', () => {
    test('is false before any items are enqueued', () => {
      expect(runner.isProcessing).toBe(false);
    });

    test('becomes false after all items are completed', async () => {
      runner.enqueue(makeItem());
      await new Promise((resolve) => runner.on('drained', resolve));
      expect(runner.isProcessing).toBe(false);
    });

    test('is true while an item is being processed', async () => {
      // Use a slow agent to observe mid-processing state.
      // We set up the listener BEFORE enqueueing to avoid a race.
      let runResolve;
      const slowAgent = new EventEmitter();
      slowAgent.id = 'slow';
      slowAgent.run = jest.fn(async function* () {
        await new Promise((r) => { runResolve = r; });
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      });
      slowAgent.abort = jest.fn();

      const slowRunner = new AgentRunner({ agent: slowAgent });

      // Attach listener before enqueue so we don't miss the event
      const processingStarted = new Promise((resolve) => slowRunner.once('processing', resolve));
      slowRunner.enqueue(makeItem());

      await processingStarted;
      expect(slowRunner.isProcessing).toBe(true);

      // Release the agent run
      runResolve();
      await new Promise((resolve) => slowRunner.once('completed', resolve));
      expect(slowRunner.isProcessing).toBe(false);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // abort
  // -------------------------------------------------------------------------

  describe('abort', () => {
    test('calls agent.abort() with the session key', () => {
      const sessionKey = 'potatoclaw:test:slack:channel:C001';
      runner.abort(sessionKey);
      expect(agent.abort).toHaveBeenCalledWith(sessionKey);
    });

    test('does not throw when called on an idle runner', () => {
      expect(() => runner.abort('any-session-key')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  describe('stop', () => {
    test('resolves without error when queue is empty', async () => {
      await expect(runner.stop()).resolves.not.toThrow();
    });

    test('sets isProcessing to false after stop()', async () => {
      await runner.stop();
      expect(runner.isProcessing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Priority ordering
  // -------------------------------------------------------------------------

  describe('priority ordering', () => {
    test('higher-priority items are processed before lower-priority items in the waiting queue', async () => {
      const processed = [];

      // Use a slow agent so first item is being processed while we enqueue others
      let firstDone;
      const slowAgent = new EventEmitter();
      slowAgent.id = 'priority-test';
      let callCount = 0;
      slowAgent.run = jest.fn(async function* (opts) {
        callCount++;
        if (callCount === 1) {
          // First call: pause so queue can fill
          await new Promise((r) => { firstDone = r; });
        }
        processed.push(opts.text);
        yield { type: 'text', content: 'reply' };
        yield { type: 'done' };
      });
      slowAgent.abort = jest.fn();

      const priRunner = new AgentRunner({ agent: slowAgent });

      // Enqueue first item (will start processing immediately)
      priRunner.enqueue(makeItem({ text: 'first' }));
      await flushAll(); // let runner pick it up

      // Enqueue low-priority, then critical while first is processing
      priRunner.enqueue(makeItem({ text: 'low', priority: 'low' }));
      priRunner.enqueue(makeItem({ text: 'critical', priority: 'critical' }));

      // Release first item
      firstDone();

      // Wait for all 3 to complete
      await new Promise((resolve) => {
        let done = 0;
        priRunner.on('completed', () => { if (++done === 3) resolve(); });
      });

      // 'critical' should be processed before 'low' after 'first'
      expect(processed[0]).toBe('first');
      expect(processed[1]).toBe('critical');
      expect(processed[2]).toBe('low');
    }, 10000);
  });
});
