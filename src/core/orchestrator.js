'use strict';

/**
 * Orchestrator — parallel task dispatcher and run lifecycle manager.
 *
 * Responsibilities:
 *   - Receive channel messages and route them to the correct AgentRunner
 *   - Receive task assignments and create run records via RunTracker
 *   - Wire agent/runner events to RunTracker + TaskReporter + SSE
 *
 * Events emitted (for SSE / UI):
 *   'run:started'    { run, task?, agentId }
 *   'run:step'       { run, step, agentId }
 *   'run:completed'  { run, task?, agentId }
 *   'run:failed'     { run, task?, agentId, error }
 *   'queue:updated'  { agentId, queueDepth, isProcessing }
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');

class Orchestrator extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {import('./agent-registry')}    opts.agentRegistry
   * @param {import('../tasks/manager')}    opts.taskManager
   * @param {import('../runs/tracker')}     opts.runTracker
   * @param {import('../tasks/reporter')}   opts.taskReporter
   * @param {import('../channels/context')} opts.channelContext
   */
  constructor({ agentRegistry, taskManager, runTracker, taskReporter, channelContext }) {
    super();

    this.agentRegistry = agentRegistry;
    this.taskManager = taskManager;
    this.runTracker = runTracker;
    this.taskReporter = taskReporter;
    this.channelContext = channelContext;

    this._log = createLogger('orchestrator');

    // Wire agent registry runner events → our tracking
    if (this.agentRegistry) {
      this._wireRegistryEvents();
    }
  }

  // ---------------------------------------------------------------------------
  // Channel message dispatch
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a channel message for processing by the specified agent.
   *
   * @param {string} agentId
   * @param {{ sessionKey, text, image?, adapter, channelId, platform, channelContext }} item
   */
  enqueueChannelMessage(agentId, item) {
    const entry = this.agentRegistry.get(agentId);
    if (!entry) {
      this._log.warn({ agentId }, 'enqueueChannelMessage: agent not found');
      return;
    }

    const { runner } = entry;

    const queueItem = {
      type: 'message',
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionKey: item.sessionKey,
      text: item.text,
      image: item.image || null,
      adapter: item.adapter || null,
      chatId: item.channelId || null,
      channelContext: item.channelContext || {},
      priority: 'normal',
    };

    runner.enqueue(queueItem);

    this.emit('queue:updated', {
      agentId,
      queueDepth: runner.queueDepth,
      isProcessing: runner.isProcessing,
    });
  }

  // ---------------------------------------------------------------------------
  // Task dispatch
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a task run for an agent. Creates a run record via RunTracker.
   *
   * @param {Object} task - Full task object from TaskManager
   * @returns {Promise<Object>} The created run record
   */
  async enqueueTask(task) {
    const agentId = task.assignedAgentId;
    if (!agentId) {
      this._log.warn({ taskId: task.id }, 'enqueueTask: task has no assignedAgentId');
      return null;
    }

    const entry = this.agentRegistry.get(agentId);
    if (!entry) {
      this._log.warn({ agentId, taskId: task.id }, 'enqueueTask: agent not found');
      return null;
    }

    // Create a run record
    const runId = `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const channelId = task.channelId || null;

    let run = null;
    if (this.runTracker) {
      try {
        run = await this.runTracker.startRun(runId, task.id, agentId, channelId);
      } catch (err) {
        this._log.error({ err: err.message, taskId: task.id }, 'Failed to create run record');
      }
    }

    // Update task status to in_progress
    if (this.taskManager) {
      try {
        await this.taskManager.update(task.id, { status: 'in_progress' });
      } catch {}
    }

    // Notify task reporter of run start
    if (this.taskReporter && run) {
      this.taskReporter.reportRunStart(run, task).catch(() => {});
    }

    // Build session key for task runs
    const sessionKey = `potatoclaw:${agentId}:task:run:${task.id}`;

    const queueItem = {
      type: 'task',
      id: runId,
      sessionKey,
      text: [task.title, task.description].filter(Boolean).join('\n\n'),
      image: null,
      adapter: null,
      chatId: null,
      channelContext: {},
      taskContext: { taskId: task.id, runId, task },
      runId,
      priority: task.priority === 'critical' ? 'critical' : (task.priority === 'high' ? 'high' : 'normal'),
    };

    entry.runner.enqueue(queueItem);

    this.emit('queue:updated', {
      agentId,
      queueDepth: entry.runner.queueDepth,
      isProcessing: entry.runner.isProcessing,
    });

    return run;
  }

  /**
   * Called by TaskManager when a task is assigned (via 'task:assigned' event).
   * @param {Object} task
   */
  onTaskAssigned(task) {
    this._log.info({ taskId: task.id, agentId: task.assignedAgentId }, 'Task assigned — enqueuing');
    this.enqueueTask(task).catch((err) => {
      this._log.error({ err: err.message, taskId: task.id }, 'Failed to enqueue task');
    });
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Get queue status across all registered agents.
   * @returns {Array<{ agentId, queueDepth, isProcessing, currentItem }>}
   */
  getQueueStatus() {
    const result = [];
    for (const { runner, definition } of this.agentRegistry.getAll().values()) {
      result.push({
        agentId: definition.id,
        queueDepth: runner.queueDepth,
        isProcessing: runner.isProcessing,
        currentItem: runner.currentItem ? {
          id: runner.currentItem.id,
          type: runner.currentItem.type,
          sessionKey: runner.currentItem.sessionKey,
        } : null,
        stats: runner.stats,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal: wire AgentRegistry events → RunTracker + TaskReporter
  // ---------------------------------------------------------------------------

  _wireRegistryEvents() {
    // runner:completed fires after _executeItem resolves (the whole conversation turn)
    this.agentRegistry.on('runner:completed', async ({ agentId, item, durationMs, response }) => {
      this._log.debug({ agentId, itemId: item && item.id, durationMs }, 'Runner item completed');

      if (item && item.type === 'task' && item.runId && this.runTracker) {
        try {
          const run = await this.runTracker.completeRun(item.runId, response || '', 0);
          if (run && run.taskId && this.taskManager) {
            const task = await this.taskManager.get(run.taskId).catch(() => null);
            if (task) {
              await this.taskManager.update(run.taskId, { status: 'done' }).catch(() => {});
              if (this.taskReporter) {
                await this.taskReporter.reportRunComplete(run, task).catch(() => {});
              }
            }
          }
          this.emit('run:completed', { run, agentId });
        } catch (err) {
          this._log.error({ err: err.message, runId: item.runId }, 'Failed to complete run record');
        }
      }

      // Append agent response to channel transcript
      if (item && item.type === 'message' && this.channelContext && response) {
        const platform = item.channelContext && item.channelContext.platform;
        const channelId = item.chatId;
        if (platform && channelId) {
          this.channelContext
            .appendMessage(platform, channelId, { role: 'assistant', content: response })
            .catch(() => {});
        }
      }

      this.emit('queue:updated', { agentId });
    });

    this.agentRegistry.on('runner:failed', async ({ agentId, item, error, durationMs }) => {
      this._log.warn({ agentId, itemId: item && item.id, err: error && error.message }, 'Runner item failed');

      if (item && item.type === 'task' && item.runId && this.runTracker) {
        try {
          const run = await this.runTracker.failRun(item.runId, error || 'Unknown error');
          if (run && run.taskId && this.taskManager) {
            const task = await this.taskManager.get(run.taskId).catch(() => null);
            if (task) {
              await this.taskManager.update(run.taskId, { status: 'failed' }).catch(() => {});
              if (this.taskReporter) {
                await this.taskReporter.reportRunFailed(run, task, error || 'Unknown error').catch(() => {});
              }
            }
          }
          this.emit('run:failed', { run, agentId, error });
        } catch (err) {
          this._log.error({ err: err.message, runId: item && item.runId }, 'Failed to fail run record');
        }
      }

      this.emit('queue:updated', { agentId });
    });

    this.agentRegistry.on('runner:queued', ({ agentId, item, position }) => {
      this.emit('queue:updated', { agentId });
    });

    this.agentRegistry.on('runner:processing', ({ agentId }) => {
      this.emit('queue:updated', { agentId });
    });
  }

  /**
   * Wire a specific AgentRunner's events to the orchestrator.
   * Called when a new agent is added dynamically.
   *
   * @param {string} agentId
   * @param {import('./runner')} runner
   */
  wireAgentEvents(agentId, runner) {
    runner.on('agent:step', ({ step }) => {
      this.emit('run:step', { agentId, step });

      // Forward step to RunTracker if we can determine the runId
      const current = runner.currentItem;
      if (current && current.runId && this.runTracker) {
        this.runTracker.addStep(current.runId, step).catch(() => {});
      }
    });
  }
}

module.exports = Orchestrator;
