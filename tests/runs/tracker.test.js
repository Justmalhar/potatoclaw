'use strict';

const RunTracker = require('../../src/runs/tracker');
const RunStore   = require('../../src/runs/store');

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-runtracker-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

function makeTracker() {
  const store   = new RunStore(tmpDir);
  const tracker = new RunTracker(store);
  return { store, tracker };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunTracker', () => {
  describe('startRun', () => {
    test('creates a run record and emits run:started', async () => {
      const { tracker } = makeTracker();
      const events = [];
      tracker.on('run:started', (e) => events.push(e));

      const run = await tracker.startRun('run_001', 'task_001', 'engineer', 'slack:C123');

      expect(run.id).toBe('run_001');
      expect(run.status).toBe('running');
      expect(run.agentId).toBe('engineer');
      expect(run.taskId).toBe('task_001');
      expect(run.channelId).toBe('slack:C123');
      expect(run.startedAt).toBeDefined();

      expect(events).toHaveLength(1);
      expect(events[0].run.id).toBe('run_001');
    });

    test('adds run to activeRuns map', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_002', null, 'researcher', null);
      expect(tracker.getActiveRuns().has('run_002')).toBe(true);
    });
  });

  describe('addStep', () => {
    test('persists step and emits run:step', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_003', null, 'engineer', null);

      const steps = [];
      tracker.on('run:step', (e) => steps.push(e));

      const step = { type: 'tool_call', tool: 'filesystem.read_file', input: { path: 'foo.js' }, timestamp: new Date().toISOString() };
      await tracker.addStep('run_003', step);

      expect(steps).toHaveLength(1);
      expect(steps[0].step.type).toBe('tool_call');
      expect(steps[0].run.id).toBe('run_003');
    });
  });

  describe('completeRun', () => {
    test('removes from activeRuns and emits run:completed', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_004', null, 'engineer', null);

      const completed = [];
      tracker.on('run:completed', (e) => completed.push(e));

      await tracker.completeRun('run_004', 'Done!', 1000);

      expect(tracker.getActiveRuns().has('run_004')).toBe(false);
      expect(completed).toHaveLength(1);
      expect(completed[0].run.status).toBe('completed');
      expect(completed[0].run.output).toBe('Done!');
      expect(completed[0].run.tokensUsed).toBe(1000);
    });
  });

  describe('failRun', () => {
    test('removes from activeRuns and emits run:failed', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_005', null, 'engineer', null);

      const failed = [];
      tracker.on('run:failed', (e) => failed.push(e));

      await tracker.failRun('run_005', 'Something exploded');

      expect(tracker.getActiveRuns().has('run_005')).toBe(false);
      expect(failed).toHaveLength(1);
      expect(failed[0].run.status).toBe('failed');
      expect(failed[0].run.error).toBe('Something exploded');
    });
  });

  describe('getRun', () => {
    test('returns persisted run by id', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_006', 'task_xyz', 'researcher', null);
      const run = await tracker.getRun('run_006');
      expect(run.id).toBe('run_006');
      expect(run.taskId).toBe('task_xyz');
    });

    test('returns null for unknown runId', async () => {
      const { tracker } = makeTracker();
      const run = await tracker.getRun('nonexistent');
      expect(run).toBeNull();
    });
  });

  describe('getRunState', () => {
    test('returns active run from memory without disk read', async () => {
      const { tracker } = makeTracker();
      await tracker.startRun('run_007', null, 'engineer', null);
      const run = await tracker.getRunState('run_007');
      expect(run.id).toBe('run_007');
    });
  });
});
