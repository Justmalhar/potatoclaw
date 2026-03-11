'use strict';

const TaskReporter = require('../../src/tasks/reporter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter() {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function makeReporter(platforms = ['slack']) {
  const adapters = new Map();
  const adapterInstances = {};
  for (const p of platforms) {
    const a = makeAdapter();
    adapters.set(p, a);
    adapterInstances[p] = a;
  }
  const reporter = new TaskReporter(adapters);
  return { reporter, adapters, adapterInstances };
}

const BASE_RUN = {
  id: 'run_001',
  agentId: 'engineer',
  status: 'completed',
  steps: [],
  output: 'Task completed successfully.',
  tokensUsed: 1234,
  durationMs: 5000,
};

const BASE_TASK = {
  id: 'task_001',
  title: 'Fix the bug',
  channelId: 'slack:C01234',
  priority: 'high',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskReporter', () => {
  describe('postToChannel', () => {
    test('routes to the correct adapter by platform prefix', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.postToChannel('slack:C99', 'Hello from reporter');
      expect(adapterInstances.slack.sendMessage).toHaveBeenCalledWith('C99', 'Hello from reporter');
    });

    test('does nothing for null channelId', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.postToChannel(null, 'ignored');
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });

    test('does nothing for channelId with no colon (no platform)', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.postToChannel('noplatformhere', 'msg');
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });

    test('does nothing for unknown platform', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.postToChannel('telegram:C1', 'msg');
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });

    test('does not throw when adapter.sendMessage rejects', async () => {
      const adapters = new Map();
      adapters.set('slack', { sendMessage: jest.fn().mockRejectedValue(new Error('net err')) });
      const reporter = new TaskReporter(adapters);
      await expect(reporter.postToChannel('slack:C1', 'msg')).resolves.not.toThrow();
    });
  });

  describe('reportRunStart', () => {
    test('calls adapter with run start message', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunStart(BASE_RUN, BASE_TASK);
      expect(adapterInstances.slack.sendMessage).toHaveBeenCalledTimes(1);
      const msg = adapterInstances.slack.sendMessage.mock.calls[0][1];
      expect(msg).toContain('run_001');
      expect(msg).toContain('Fix the bug');
    });

    test('does nothing when task has no channelId', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunStart(BASE_RUN, { ...BASE_TASK, channelId: null });
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('reportRunComplete', () => {
    test('calls adapter with completion message', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunComplete(BASE_RUN, BASE_TASK);
      expect(adapterInstances.slack.sendMessage).toHaveBeenCalledTimes(1);
      const msg = adapterInstances.slack.sendMessage.mock.calls[0][1];
      expect(msg).toContain('completed');
      expect(msg).toContain('run_001');
    });

    test('does nothing when task has no channelId', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunComplete(BASE_RUN, { ...BASE_TASK, channelId: null });
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('reportRunFailed', () => {
    test('calls adapter with failure message including error text', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunFailed(BASE_RUN, BASE_TASK, 'Connection timeout');
      expect(adapterInstances.slack.sendMessage).toHaveBeenCalledTimes(1);
      const msg = adapterInstances.slack.sendMessage.mock.calls[0][1];
      expect(msg).toContain('Connection timeout');
      expect(msg).toContain('failed');
    });

    test('accepts Error objects', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunFailed(BASE_RUN, BASE_TASK, new Error('boom'));
      const msg = adapterInstances.slack.sendMessage.mock.calls[0][1];
      expect(msg).toContain('boom');
    });

    test('does nothing when task has no channelId', async () => {
      const { reporter, adapterInstances } = makeReporter(['slack']);
      await reporter.reportRunFailed(BASE_RUN, { ...BASE_TASK, channelId: null }, 'err');
      expect(adapterInstances.slack.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('formatRunSummary', () => {
    test('includes duration and token count', () => {
      const { reporter } = makeReporter();
      const summary = reporter.formatRunSummary(BASE_RUN);
      expect(summary).toContain('1,234');  // tokensUsed formatted
      expect(summary).toContain('5s');     // durationMs → 5s
    });

    test('includes step breakdown when steps exist', () => {
      const { reporter } = makeReporter();
      const run = {
        ...BASE_RUN,
        steps: [
          { type: 'tool_call' },
          { type: 'tool_call' },
          { type: 'thought' },
          { type: 'message' },
        ],
      };
      const summary = reporter.formatRunSummary(run);
      expect(summary).toContain('4 total');
      expect(summary).toContain('2 tool calls');
    });

    test('includes truncated output preview', () => {
      const { reporter } = makeReporter();
      const summary = reporter.formatRunSummary(BASE_RUN);
      expect(summary).toContain('Task completed successfully');
    });

    test('truncates output longer than 500 chars', () => {
      const { reporter } = makeReporter();
      const run = { ...BASE_RUN, output: 'a'.repeat(600) };
      const summary = reporter.formatRunSummary(run);
      expect(summary).toContain('…');
      expect(summary).not.toContain('a'.repeat(600));
    });

    test('handles zero duration gracefully', () => {
      const { reporter } = makeReporter();
      const summary = reporter.formatRunSummary({ ...BASE_RUN, durationMs: 0 });
      expect(summary).toContain('0ms');
    });
  });

  describe('_formatDuration', () => {
    test('formats milliseconds under 1000', () => {
      const { reporter } = makeReporter();
      expect(reporter._formatDuration(500)).toBe('500ms');
    });

    test('formats seconds', () => {
      const { reporter } = makeReporter();
      expect(reporter._formatDuration(5000)).toBe('5s');
    });

    test('formats minutes and seconds', () => {
      const { reporter } = makeReporter();
      expect(reporter._formatDuration(90000)).toBe('1m 30s');
    });

    test('handles zero', () => {
      const { reporter } = makeReporter();
      expect(reporter._formatDuration(0)).toBe('0ms');
    });
  });
});
