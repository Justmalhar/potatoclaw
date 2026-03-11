'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { CronScheduler } = require('../../src/tools/cron');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-cron-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

function makeScheduler() {
  const jobsFile = path.join(tmpDir, 'cron-jobs.json');
  const s = new CronScheduler(jobsFile);
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronScheduler', () => {
  afterEach(() => {
    // Stop any pending timers to avoid leaking into other tests
  });

  describe('scheduleDelayed', () => {
    test('returns success with jobId', () => {
      const s = makeScheduler();
      const result = s.scheduleDelayed({ channelId: 'C1', message: 'ping', delaySeconds: 3600 });
      expect(result.success).toBe(true);
      expect(typeof result.jobId).toBe('string');
      s.cancel(result.jobId);
      s.stop();
    });

    test('job appears in list()', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C1', message: 'test', delaySeconds: 3600 });
      const jobs = s.list();
      expect(jobs.some(j => j.id === jobId)).toBe(true);
      s.cancel(jobId);
      s.stop();
    });

    test('job has executeAt in ISO format', () => {
      const s = makeScheduler();
      const result = s.scheduleDelayed({ channelId: 'C1', message: 'x', delaySeconds: 3600 });
      expect(typeof result.executeAt).toBe('string');
      expect(() => new Date(result.executeAt)).not.toThrow();
      s.cancel(result.jobId);
      s.stop();
    });

    test('persists to jobs file', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C2', message: 'save me', delaySeconds: 3600 });
      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cron-jobs.json'), 'utf-8'));
      expect(saved.some(j => j.id === jobId)).toBe(true);
      s.cancel(jobId);
      s.stop();
    });
  });

  describe('scheduleRecurring', () => {
    test('returns success with jobId and intervalSeconds', () => {
      const s = makeScheduler();
      const result = s.scheduleRecurring({ channelId: 'C1', message: 'tick', intervalSeconds: 3600 });
      expect(result.success).toBe(true);
      expect(typeof result.jobId).toBe('string');
      expect(result.intervalSeconds).toBe(3600);
      s.cancel(result.jobId);
      s.stop();
    });

    test('job type is recurring', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleRecurring({ channelId: 'C1', message: 'r', intervalSeconds: 3600 });
      const jobs = s.list();
      const job = jobs.find(j => j.id === jobId);
      expect(job.type).toBe('recurring');
      s.cancel(jobId);
      s.stop();
    });
  });

  describe('scheduleCron', () => {
    test('returns success with jobId and cron expression', () => {
      const s = makeScheduler();
      const result = s.scheduleCron({ channelId: 'C1', message: 'scheduled', cron: '0 9 * * 1-5' });
      expect(result.success).toBe(true);
      expect(typeof result.jobId).toBe('string');
      s.cancel(result.jobId);
      s.stop();
    });
  });

  describe('list', () => {
    test('returns empty array initially', () => {
      const s = makeScheduler();
      const jobs = s.list();
      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs).toHaveLength(0);
      s.stop();
    });

    test('each job entry has required fields', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C5', message: 'hi', delaySeconds: 3600 });
      const [job] = s.list();
      expect(typeof job.id).toBe('string');
      expect(typeof job.type).toBe('string');
      expect(typeof job.channelId).toBe('string');
      expect(typeof job.createdAt).toBe('string');
      s.cancel(jobId);
      s.stop();
    });

    test('returns multiple jobs', () => {
      const s = makeScheduler();
      const r1 = s.scheduleDelayed({ channelId: 'C1', message: 'a', delaySeconds: 3600 });
      const r2 = s.scheduleDelayed({ channelId: 'C2', message: 'b', delaySeconds: 7200 });
      expect(s.list()).toHaveLength(2);
      s.cancel(r1.jobId);
      s.cancel(r2.jobId);
      s.stop();
    });
  });

  describe('cancel', () => {
    test('removes job from list', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C3', message: 'bye', delaySeconds: 3600 });
      s.cancel(jobId);
      expect(s.list().some(j => j.id === jobId)).toBe(false);
      s.stop();
    });

    test('returns success: true on valid cancel', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C4', message: 'x', delaySeconds: 3600 });
      const result = s.cancel(jobId);
      expect(result.success).toBe(true);
      s.stop();
    });

    test('returns success: false for unknown jobId', () => {
      const s = makeScheduler();
      const result = s.cancel('nonexistent_job_id');
      expect(result.success).toBe(false);
      s.stop();
    });

    test('removes job from persisted file', () => {
      const s = makeScheduler();
      const { jobId } = s.scheduleDelayed({ channelId: 'C6', message: 'gone', delaySeconds: 3600 });
      s.cancel(jobId);
      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cron-jobs.json'), 'utf-8'));
      expect(saved.some(j => j.id === jobId)).toBe(false);
      s.stop();
    });
  });

  describe('persistence — reloads jobs on construction', () => {
    test('new CronScheduler instance loads previously saved jobs', () => {
      const jobsFile = path.join(tmpDir, 'cron-jobs.json');
      const s1 = new CronScheduler(jobsFile);
      s1.scheduleDelayed({ channelId: 'C7', message: 'persist', delaySeconds: 9999 });
      s1.stop();

      const s2 = new CronScheduler(jobsFile);
      const jobs = s2.list();
      expect(jobs.length).toBeGreaterThan(0);
      s2.stop();
    });
  });

  describe('stop', () => {
    test('clears all timers without throwing', () => {
      const s = makeScheduler();
      s.scheduleDelayed({ channelId: 'C8', message: 'a', delaySeconds: 3600 });
      s.scheduleRecurring({ channelId: 'C9', message: 'b', intervalSeconds: 3600 });
      expect(() => s.stop()).not.toThrow();
    });
  });
});
