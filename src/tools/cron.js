'use strict';

/**
 * Cron MCP Tool — schedule_delayed, schedule_recurring, schedule_cron,
 * list_scheduled, cancel_scheduled.
 *
 * Export:
 *   createCronTool(context)  — context = { dataDir, onExecute }
 *   CronScheduler            — class for direct use
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { z } = require('zod');

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

class CronScheduler extends EventEmitter {
  /**
   * @param {string} jobsFile  - Path to cron-jobs.json
   */
  constructor(jobsFile) {
    super();
    this.jobsFile = jobsFile;
    this.jobs = new Map();
    this.timers = new Map();
    this._ensureDir();
    this._loadJobs();
  }

  _ensureDir() {
    const dir = path.dirname(this.jobsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadJobs() {
    try {
      if (fs.existsSync(this.jobsFile)) {
        const data = JSON.parse(fs.readFileSync(this.jobsFile, 'utf-8'));
        for (const job of data) {
          this.jobs.set(job.id, job);
          this._scheduleJob(job);
        }
        console.log(`[Cron] Loaded ${this.jobs.size} jobs`);
      }
    } catch (err) {
      console.error('[Cron] Failed to load jobs:', err.message);
    }
  }

  _saveJobs() {
    try {
      const data = Array.from(this.jobs.values());
      fs.writeFileSync(this.jobsFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Cron] Failed to save jobs:', err.message);
    }
  }

  _generateId() {
    return `cron_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ---------------------------------------------------------------------------
  // Public scheduling methods
  // ---------------------------------------------------------------------------

  scheduleDelayed({ channelId, message, delaySeconds, description, invokeAgent, agentId }) {
    const id = this._generateId();
    const executeAt = Date.now() + delaySeconds * 1000;

    const job = {
      id,
      type: 'delayed',
      channelId,
      agentId: agentId || null,
      message,
      executeAt,
      description: description || `Send in ${delaySeconds}s`,
      invokeAgent: invokeAgent || false,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this._saveJobs();
    this._scheduleJob(job);

    return { success: true, jobId: id, executeAt: new Date(executeAt).toISOString() };
  }

  scheduleRecurring({ channelId, message, intervalSeconds, description, invokeAgent, agentId }) {
    const id = this._generateId();

    const job = {
      id,
      type: 'recurring',
      channelId,
      agentId: agentId || null,
      message,
      intervalMs: intervalSeconds * 1000,
      description: description || `Every ${intervalSeconds}s`,
      invokeAgent: invokeAgent || false,
      createdAt: Date.now(),
      lastRun: null,
      runCount: 0,
    };

    this.jobs.set(id, job);
    this._saveJobs();
    this._scheduleJob(job);

    return { success: true, jobId: id, intervalSeconds };
  }

  scheduleCron({ channelId, message, cron, description, invokeAgent, agentId }) {
    const id = this._generateId();

    const job = {
      id,
      type: 'cron',
      channelId,
      agentId: agentId || null,
      message,
      cron,
      description: description || `Cron: ${cron}`,
      invokeAgent: invokeAgent || false,
      createdAt: Date.now(),
      lastRun: null,
      runCount: 0,
    };

    this.jobs.set(id, job);
    this._saveJobs();
    this._scheduleJob(job);

    const nextRun = this._getNextCronRun(cron);
    return { success: true, jobId: id, cron, nextRun: nextRun ? nextRun.toISOString() : null };
  }

  list() {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      type: job.type,
      channelId: job.channelId,
      agentId: job.agentId,
      description: job.description,
      invokeAgent: job.invokeAgent,
      createdAt: new Date(job.createdAt).toISOString(),
      lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
      runCount: job.runCount || 0,
      ...(job.type === 'delayed' && { executeAt: new Date(job.executeAt).toISOString() }),
      ...(job.type === 'recurring' && { intervalSeconds: job.intervalMs / 1000 }),
      ...(job.type === 'cron' && { cron: job.cron }),
    }));
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { success: false, error: 'Job not found' };

    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(jobId);
    }

    this.jobs.delete(jobId);
    this._saveJobs();
    return { success: true, message: `Cancelled job ${jobId}` };
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal scheduling
  // ---------------------------------------------------------------------------

  _scheduleJob(job) {
    // Clear any existing timer for this job
    if (this.timers.has(job.id)) {
      clearTimeout(this.timers.get(job.id));
      clearInterval(this.timers.get(job.id));
    }

    if (job.type === 'delayed') {
      const delay = job.executeAt - Date.now();
      if (delay > 0) {
        this.timers.set(job.id, setTimeout(() => this._executeJob(job), delay));
      } else {
        // Already past — execute immediately on next tick
        setImmediate(() => this._executeJob(job));
      }
    } else if (job.type === 'recurring') {
      this.timers.set(job.id, setInterval(() => this._executeJob(job), job.intervalMs));
    } else if (job.type === 'cron') {
      this._scheduleCronRun(job);
    }
  }

  _scheduleCronRun(job) {
    const nextRun = this._getNextCronRun(job.cron);
    if (!nextRun) return;

    const delay = nextRun.getTime() - Date.now();
    if (delay > 0) {
      this.timers.set(
        job.id,
        setTimeout(() => {
          this._executeJob(job);
          // Re-schedule for next occurrence
          const freshJob = this.jobs.get(job.id);
          if (freshJob) this._scheduleCronRun(freshJob);
        }, delay)
      );
    }
  }

  _getNextCronRun(cronExpr) {
    try {
      const parts = cronExpr.trim().split(/\s+/);
      if (parts.length !== 5) return null;

      const [minute, hour] = parts;
      const now = new Date();
      const next = new Date(now);

      next.setSeconds(0);
      next.setMilliseconds(0);
      next.setMinutes(minute === '*' ? now.getMinutes() : parseInt(minute, 10));
      next.setHours(hour === '*' ? now.getHours() : parseInt(hour, 10));

      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    } catch {
      return null;
    }
  }

  _executeJob(job) {
    console.log(`[Cron] Executing job ${job.id}: ${job.description}`);
    job.lastRun = Date.now();
    job.runCount = (job.runCount || 0) + 1;
    this._saveJobs();

    this.emit('execute', {
      jobId: job.id,
      channelId: job.channelId,
      agentId: job.agentId,
      message: job.message,
      invokeAgent: job.invokeAgent || false,
    });

    if (job.type === 'delayed') {
      this.cancel(job.id);
    }
  }
}

// ---------------------------------------------------------------------------
// MCP tool factory
// ---------------------------------------------------------------------------

/**
 * Create the Cron MCP server config.
 *
 * @param {{ dataDir: string, onExecute?: Function }} context
 * @returns {{ name, version, tools, scheduler }}
 */
function createCronTool(context) {
  const { dataDir, onExecute } = context || {};
  const cronJobsFile = path.join(dataDir || '/data', 'cron-jobs.json');
  const scheduler = new CronScheduler(cronJobsFile);

  if (typeof onExecute === 'function') {
    scheduler.on('execute', onExecute);
  }

  // Current context injected per-run by the agent runner
  let currentContext = { channelId: null, agentId: null };

  function setContext(ctx) {
    currentContext = { ...currentContext, ...ctx };
  }

  const tools = [
    {
      name: 'schedule_delayed',
      description:
        'Schedule a one-time task after a delay. Use for reminders. Set invoke_agent=true to have the agent process the message and respond.',
      inputSchema: z.object({
        message: z.string().describe('Message to send, or task for the agent if invoke_agent is true'),
        delay_seconds: z.number().positive().describe('Delay in seconds before sending'),
        channel_id: z.string().optional().describe('Override target channelId (e.g. "slack:C01234567")'),
        description: z.string().optional().describe('Human-readable description'),
        invoke_agent: z.boolean().optional().describe('If true, agent will process the message and respond'),
      }),
      handler: async (input) => {
        const result = scheduler.scheduleDelayed({
          channelId: input.channel_id || currentContext.channelId,
          agentId: currentContext.agentId,
          message: input.message,
          delaySeconds: input.delay_seconds,
          description: input.description,
          invokeAgent: input.invoke_agent,
        });
        return { result };
      },
    },
    {
      name: 'schedule_recurring',
      description:
        'Schedule a recurring task at regular intervals. Set invoke_agent=true to have the agent process and respond each time.',
      inputSchema: z.object({
        message: z.string().describe('Message to send, or task for the agent if invoke_agent is true'),
        interval_seconds: z.number().positive().describe('Interval in seconds between executions'),
        channel_id: z.string().optional().describe('Override target channelId'),
        description: z.string().optional().describe('Human-readable description'),
        invoke_agent: z.boolean().optional().describe('If true, agent will process each time'),
      }),
      handler: async (input) => {
        const result = scheduler.scheduleRecurring({
          channelId: input.channel_id || currentContext.channelId,
          agentId: currentContext.agentId,
          message: input.message,
          intervalSeconds: input.interval_seconds,
          description: input.description,
          invokeAgent: input.invoke_agent,
        });
        return { result };
      },
    },
    {
      name: 'schedule_cron',
      description:
        'Schedule a task using a cron expression (minute hour day month weekday). E.g. "0 9 * * *" for 9am daily.',
      inputSchema: z.object({
        message: z.string().describe('Message to send, or task for the agent if invoke_agent is true'),
        cron: z.string().describe('Cron expression: "minute hour day month weekday"'),
        channel_id: z.string().optional().describe('Override target channelId'),
        description: z.string().optional().describe('Human-readable description'),
        invoke_agent: z.boolean().optional().describe('If true, agent will process each time'),
      }),
      handler: async (input) => {
        const result = scheduler.scheduleCron({
          channelId: input.channel_id || currentContext.channelId,
          agentId: currentContext.agentId,
          message: input.message,
          cron: input.cron,
          description: input.description,
          invokeAgent: input.invoke_agent,
        });
        return { result };
      },
    },
    {
      name: 'list_scheduled',
      description: 'List all scheduled jobs (reminders, recurring messages, cron jobs).',
      inputSchema: z.object({}),
      handler: async () => {
        const jobs = scheduler.list();
        return { result: { jobs, count: jobs.length } };
      },
    },
    {
      name: 'cancel_scheduled',
      description: 'Cancel a scheduled job by its ID.',
      inputSchema: z.object({
        job_id: z.string().describe('The job ID to cancel'),
      }),
      handler: async (input) => {
        const result = scheduler.cancel(input.job_id);
        return { result };
      },
    },
  ];

  return {
    name: 'cron',
    version: '1.0.0',
    tools,
    scheduler,
    setContext,
  };
}

module.exports = { createCronTool, CronScheduler };
