'use strict';

const RunStore = require('../../src/runs/store');

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-runstore-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

function makeStore() { return new RunStore(tmpDir); }

describe('RunStore', () => {
  describe('create', () => {
    test('returns run with correct default fields', async () => {
      const store = makeStore();
      const run = await store.create({ id: 'run_a', agentId: 'eng', taskId: 'task_1', channelId: 'slack:C1' });
      expect(run.id).toBe('run_a');
      expect(run.agentId).toBe('eng');
      expect(run.status).toBe('queued');
      expect(run.steps).toEqual([]);
      expect(run.output).toBeNull();
    });
  });

  describe('get', () => {
    test('returns run by id', async () => {
      const store = makeStore();
      await store.create({ id: 'run_b', agentId: 'eng' });
      const run = await store.get('run_b');
      expect(run.id).toBe('run_b');
    });

    test('returns null for unknown id', async () => {
      const store = makeStore();
      const run = await store.get('nope');
      expect(run).toBeNull();
    });
  });

  describe('update', () => {
    test('partial update merges fields', async () => {
      const store = makeStore();
      await store.create({ id: 'run_c', agentId: 'eng', status: 'queued' });
      const updated = await store.update('run_c', { status: 'running', startedAt: '2026-01-01T00:00:00Z' });
      expect(updated.status).toBe('running');
      expect(updated.startedAt).toBe('2026-01-01T00:00:00Z');
      expect(updated.agentId).toBe('eng'); // unchanged field preserved
    });
  });

  describe('appendStep', () => {
    test('step is persisted in run', async () => {
      const store = makeStore();
      await store.create({ id: 'run_d', agentId: 'eng' });
      const step = { type: 'tool_call', tool: 'cron.schedule_delayed', timestamp: new Date().toISOString() };
      await store.appendStep('run_d', step);
      const run = await store.get('run_d');
      expect(run.steps).toHaveLength(1);
      expect(run.steps[0].tool).toBe('cron.schedule_delayed');
    });

    test('multiple steps accumulate in order', async () => {
      const store = makeStore();
      await store.create({ id: 'run_e', agentId: 'eng' });
      await store.appendStep('run_e', { type: 'thought', content: 'thinking', timestamp: '1' });
      await store.appendStep('run_e', { type: 'message', content: 'done', timestamp: '2' });
      const run = await store.get('run_e');
      expect(run.steps).toHaveLength(2);
      expect(run.steps[0].type).toBe('thought');
      expect(run.steps[1].type).toBe('message');
    });
  });

  describe('complete', () => {
    test('sets status completed and output', async () => {
      const store = makeStore();
      await store.create({ id: 'run_f', agentId: 'eng', status: 'running' });
      const run = await store.complete('run_f', 'all done', 500);
      expect(run.status).toBe('completed');
      expect(run.output).toBe('all done');
      expect(run.tokensUsed).toBe(500);
      expect(run.completedAt).toBeDefined();
    });
  });

  describe('fail', () => {
    test('sets status failed and error', async () => {
      const store = makeStore();
      await store.create({ id: 'run_g', agentId: 'eng', status: 'running' });
      const run = await store.fail('run_g', 'network timeout');
      expect(run.status).toBe('failed');
      expect(run.error).toBe('network timeout');
      expect(run.completedAt).toBeDefined();
    });
  });

  describe('list', () => {
    test('returns runs matching agentId filter', async () => {
      const store = makeStore();
      await store.create({ id: 'run_h1', agentId: 'engineer' });
      await store.create({ id: 'run_h2', agentId: 'researcher' });
      await store.create({ id: 'run_h3', agentId: 'engineer' });
      const runs = await store.list({ agentId: 'engineer' });
      expect(runs.every(r => r.agentId === 'engineer')).toBe(true);
      expect(runs).toHaveLength(2);
    });

    test('returns all runs when no filter', async () => {
      const store = makeStore();
      await store.create({ id: 'run_i1', agentId: 'a' });
      await store.create({ id: 'run_i2', agentId: 'b' });
      const runs = await store.list({});
      expect(runs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getStats', () => {
    test('returns stats object with totals', async () => {
      const store = makeStore();
      await store.create({ id: 'run_j1', agentId: 'a' });
      await store.create({ id: 'run_j2', agentId: 'a' });
      await store.complete('run_j1', 'ok', 100);
      const stats = await store.getStats();
      expect(typeof stats.total).toBe('number');
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });
  });
});
