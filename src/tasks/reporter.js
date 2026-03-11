'use strict';

/**
 * Posts run summaries to the appropriate messaging channel when tasks complete.
 *
 * channelId format: "<platform>:<platformChannelId>"
 * e.g. "slack:C01234567", "telegram:-100123456789", "discord:987654321"
 */
class TaskReporter {
  /**
   * @param {Map<string, import('../adapters/base')>} adapterRegistry
   *   Map of platform name → adapter instance (from Gateway)
   */
  constructor(adapterRegistry) {
    this.adapters = adapterRegistry;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Post a "run starting" notice to the task's bound channel.
   * @param {Object} run  - Run record
   * @param {Object} task - Task record
   * @returns {Promise<void>}
   */
  async reportRunStart(run, task) {
    if (!task.channelId) return;

    const agentLabel = run.agentId || 'agent';
    const message =
      `🏃 Starting run \`${run.id}\`\n` +
      `*Task:* ${task.title}\n` +
      `*Agent:* ${agentLabel}\n` +
      `*Priority:* ${task.priority || 'medium'}`;

    await this.postToChannel(task.channelId, message);
  }

  /**
   * Post a detailed summary to the task's bound channel after a run completes.
   * @param {Object} run
   * @param {Object} task
   * @returns {Promise<void>}
   */
  async reportRunComplete(run, task) {
    if (!task.channelId) return;

    const summary = this.formatRunSummary(run);
    const message =
      `✅ Run completed — \`${run.id}\`\n` +
      `*Task:* ${task.title}\n\n` +
      summary;

    await this.postToChannel(task.channelId, message);
  }

  /**
   * Post a failure notice to the task's bound channel.
   * @param {Object} run
   * @param {Object} task
   * @param {string|Error} error
   * @returns {Promise<void>}
   */
  async reportRunFailed(run, task, error) {
    if (!task.channelId) return;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationStr = this._formatDuration(run.durationMs || 0);

    const message =
      `❌ Run failed — \`${run.id}\`\n` +
      `*Task:* ${task.title}\n` +
      `*Agent:* ${run.agentId || 'unknown'}\n` +
      `*Duration:* ${durationStr}\n` +
      `*Error:* ${errorMessage}`;

    await this.postToChannel(task.channelId, message);
  }

  /**
   * Format a run into a readable markdown summary.
   * @param {Object} run
   * @returns {string}
   */
  formatRunSummary(run) {
    const lines = [];
    const durationStr = this._formatDuration(run.durationMs || 0);

    lines.push(`*Duration:* ${durationStr}`);
    lines.push(`*Tokens used:* ${(run.tokensUsed || 0).toLocaleString()}`);

    if (run.steps && run.steps.length > 0) {
      const toolCalls = run.steps.filter((s) => s.type === 'tool_call').length;
      const thoughts = run.steps.filter((s) => s.type === 'thought').length;
      const errors = run.steps.filter((s) => s.type === 'error').length;

      lines.push(`*Steps:* ${run.steps.length} total (${toolCalls} tool calls, ${thoughts} thoughts${errors ? `, ${errors} errors` : ''})`);
    }

    if (run.output) {
      const preview = run.output.length > 500
        ? run.output.slice(0, 500) + '…'
        : run.output;
      lines.push(`\n*Output:*\n${preview}`);
    }

    return lines.join('\n');
  }

  /**
   * Route a message to the correct adapter based on the channelId prefix.
   * @param {string} channelId  - e.g. "slack:C01234567"
   * @param {string} message    - Markdown / plain text message
   * @returns {Promise<void>}
   */
  async postToChannel(channelId, message) {
    if (!channelId) return;

    const colonIdx = channelId.indexOf(':');
    if (colonIdx === -1) {
      console.warn(`[TaskReporter] Cannot parse channelId: ${channelId}`);
      return;
    }

    const platform = channelId.slice(0, colonIdx);
    const platformChannelId = channelId.slice(colonIdx + 1);

    const adapter = this.adapters.get(platform);
    if (!adapter) {
      console.warn(`[TaskReporter] No adapter registered for platform: ${platform}`);
      return;
    }

    try {
      await adapter.sendMessage(platformChannelId, message);
    } catch (err) {
      console.error(`[TaskReporter] Failed to post to ${channelId}:`, err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _formatDuration(ms) {
    if (!ms || ms < 1000) return `${ms || 0}ms`;
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }
}

module.exports = TaskReporter;
