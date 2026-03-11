'use strict';

/**
 * CommandHandler — slash command dispatcher.
 *
 * Supported commands:
 *   /new | /reset          - Reset session
 *   /status                - Session and queue status
 *   /memory [list|search]  - Memory viewer
 *   /queue                 - Queue depth across all agents
 *   /help                  - Command list
 *   /stop                  - Abort current operation
 *   /model [name]          - Switch model (not yet wired to agents, future)
 *   /provider [name]       - Switch provider (future)
 *   /task create <title>   - Create a task for the current agent
 *   /task list             - List tasks for the current agent
 *   /agent                 - Show current agent info
 *   /channels              - List all channel bindings
 *   /runs                  - List recent runs for this channel
 */

class CommandHandler {
  /**
   * @param {Object} opts
   * @param {import('../core/agent-registry')} opts.agentRegistry
   * @param {import('../channels/registry')}  opts.channelRegistry
   * @param {import('../tasks/manager')}      opts.taskManager
   * @param {Object}                          opts.runStore
   * @param {Object}                          opts.sessionManager - (agentId) => SessionManager or a single SessionManager
   */
  constructor({ agentRegistry, channelRegistry, taskManager, runStore, sessionManager }) {
    this.agentRegistry = agentRegistry;
    this.channelRegistry = channelRegistry;
    this.taskManager = taskManager;
    this.runStore = runStore;
    this.sessionManager = sessionManager;

    this._pendingModelSelect = new Map();    // chatId → resolve
    this._pendingProviderSelect = new Map(); // chatId → resolve
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * @param {string} text
   * @returns {boolean}
   */
  isCommand(text) {
    return typeof text === 'string' && text.trim().startsWith('/');
  }

  /**
   * Handle a slash command.
   *
   * @param {string} text
   * @param {{ platform: string, channelId: string, userId?: string, adapter: Object }} context
   * @returns {Promise<string|null>}  Response string to send back, or null if not handled
   */
  async handle(text, { platform, channelId, userId, adapter }) {
    if (!this.isCommand(text)) return null;

    const { command, args } = this._parse(text);

    try {
      switch (command) {
        case 'new':
        case 'reset':
          return await this._handleReset(platform, channelId);

        case 'status':
          return this._handleStatus(platform, channelId);

        case 'memory':
          return await this._handleMemory(platform, channelId, args);

        case 'queue':
          return this._handleQueue();

        case 'help':
          return this._handleHelp();

        case 'stop':
          return this._handleStop(platform, channelId);

        case 'model':
          return this._handleModel(args, channelId, adapter);

        case 'provider':
          return this._handleProvider(args, channelId, adapter);

        case 'task':
          return await this._handleTask(args, platform, channelId, userId);

        case 'agent':
          return this._handleAgent(platform, channelId);

        case 'channels':
          return this._handleChannels();

        case 'runs':
          return await this._handleRuns(platform, channelId);

        default:
          // Unknown command — pass through to the agent
          return null;
      }
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Command handlers
  // ---------------------------------------------------------------------------

  async _handleReset(platform, channelId) {
    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    const agentId = binding && binding.agentId;

    if (agentId && this.sessionManager) {
      const sessionKey = `potatoclaw:${agentId}:${platform}:channel:${channelId}`;
      const mgr = typeof this.sessionManager === 'function'
        ? this.sessionManager(agentId)
        : this.sessionManager;
      try {
        await mgr.clearSession(sessionKey);
      } catch {}
    }

    return '🔄 Session reset. Starting fresh!';
  }

  _handleStatus(platform, channelId) {
    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    if (!binding) {
      return `📊 No agent bound to this channel.\nUse the Mission Control UI to bind an agent.`;
    }

    const { agentId } = binding;
    const entry = this.agentRegistry && this.agentRegistry.get(agentId);
    if (!entry) {
      return `📊 Agent "${agentId}" not found in registry.`;
    }

    const { runner, agent } = entry;
    const lines = [
      `📊 *Status*`,
      ``,
      `*Agent:* ${agentId}`,
      `*Status:* ${agent.status || 'idle'}`,
      `*Queue depth:* ${runner.queueDepth}`,
      `*Processing:* ${runner.isProcessing ? 'yes' : 'no'}`,
      ``,
      `*Stats:*`,
      `  Queued:    ${runner.stats.totalQueued}`,
      `  Processed: ${runner.stats.totalProcessed}`,
      `  Failed:    ${runner.stats.totalFailed}`,
    ];

    return lines.join('\n');
  }

  async _handleMemory(platform, channelId, args) {
    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    const agentId = binding && binding.agentId;

    if (!agentId) return '🧠 No agent bound to this channel.';

    const entry = this.agentRegistry && this.agentRegistry.get(agentId);
    const memoryManager = entry && entry.agent && entry.agent.memoryManager;

    if (!memoryManager) return '🧠 Memory manager not available.';

    if (args === 'list') {
      const files = await memoryManager.listFiles();
      const lines = [`📝 *Memory Files for ${agentId}*`, ''];
      const mem = await memoryManager.readMemory();
      lines.push(`*MEMORY.md:* ${mem ? 'exists' : 'empty'}`);
      lines.push('', '*Daily logs:*');
      for (const f of files.slice(0, 10)) {
        lines.push(`  • ${f}`);
      }
      if (files.length > 10) lines.push(`  ... and ${files.length - 10} more`);
      return lines.join('\n');
    }

    if (args.startsWith('search ')) {
      const query = args.slice(7).trim();
      const results = await memoryManager.searchMemory(query);
      if (results.length === 0) return `🔍 No results for "${query}"`;
      const lines = [`🔍 *Search: "${query}"*`, ''];
      for (const result of results.slice(0, 5)) {
        lines.push(`*${result.file}:*`);
        for (const match of (result.matches || []).slice(0, 2)) {
          lines.push(`  Line ${match.line}: ${String(match.context || '').substring(0, 100)}`);
        }
      }
      return lines.join('\n');
    }

    // Default: show summary
    const longTerm = await memoryManager.readMemory();
    const lines = [
      `🧠 *Memory — ${agentId}*`,
      '',
      '*Long-term (MEMORY.md):*',
      longTerm ? longTerm.substring(0, 500) + (longTerm.length > 500 ? '...' : '') : 'Empty',
    ];
    return lines.join('\n');
  }

  _handleQueue() {
    if (!this.agentRegistry) return '📋 Agent registry not available.';

    const agents = this.agentRegistry.list();
    const lines = ['📋 *Queue Status*', ''];

    for (const a of agents) {
      const statusEmoji = a.isProcessing ? '⚙️' : (a.queueDepth > 0 ? '⏳' : '✅');
      lines.push(`${statusEmoji} *${a.id}*: ${a.queueDepth} queued${a.isProcessing ? ' (busy)' : ''}`);
    }

    if (agents.length === 0) lines.push('No agents loaded.');
    return lines.join('\n');
  }

  _handleStop(platform, channelId) {
    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    if (!binding) return '⏹️ No agent bound to this channel.';

    const entry = this.agentRegistry && this.agentRegistry.get(binding.agentId);
    if (!entry) return '⏹️ Agent not found.';

    const sessionKey = `potatoclaw:${binding.agentId}:${platform}:channel:${channelId}`;
    const aborted = entry.runner.abort(sessionKey);
    return aborted ? '⏹️ Stopped current operation.' : '⏹️ Nothing to stop.';
  }

  _handleModel(args) {
    // Placeholder — full provider/model switching requires agent live-update logic
    if (args) {
      return `ℹ️ Model selection via command not yet implemented. Use Mission Control UI to update the agent.`;
    }
    return [
      '🤖 *Model Selection*',
      '',
      'To switch models, use the Mission Control UI → Agents page.',
    ].join('\n');
  }

  _handleProvider(args) {
    return [
      '🔌 *Provider Selection*',
      '',
      'To switch providers, use the Mission Control UI → Agents page.',
    ].join('\n');
  }

  async _handleTask(args, platform, channelId, userId) {
    if (!this.taskManager) return '📋 Task manager not available.';

    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    const agentId = binding && binding.agentId;

    const subArgs = args.trim();

    if (subArgs.startsWith('create ')) {
      const title = subArgs.slice(7).trim();
      if (!title) return '❌ Usage: /task create <title>';

      const task = await this.taskManager.create({
        title,
        assignedAgentId: agentId || null,
        channelId: channelId ? `${platform}:${channelId}` : null,
        createdBy: userId || 'user',
        priority: 'medium',
        status: 'todo',
      });

      return [
        `✅ Task created: \`${task.id}\``,
        `*Title:* ${task.title}`,
        agentId ? `*Agent:* ${agentId}` : '*Agent:* (unassigned)',
        `*Status:* ${task.status}`,
        `*Priority:* ${task.priority}`,
      ].join('\n');
    }

    if (subArgs === 'list' || subArgs === '') {
      if (!agentId) return '📋 No agent bound to this channel — cannot list tasks.';
      const tasks = await this.taskManager.listByAgent(agentId);
      if (tasks.length === 0) return `📋 No tasks for agent *${agentId}*.`;

      const lines = [`📋 *Tasks for ${agentId}* (${tasks.length})`, ''];
      for (const t of tasks.slice(0, 15)) {
        const emoji = { backlog: '⏺️', todo: '🔵', in_progress: '🟡', review: '🟠', done: '✅', blocked: '🔴', failed: '❌' }[t.status] || '•';
        lines.push(`${emoji} \`${t.id}\` ${t.title} [${t.priority}]`);
      }
      if (tasks.length > 15) lines.push(`...and ${tasks.length - 15} more`);
      return lines.join('\n');
    }

    return '❌ Usage: /task create <title> | /task list';
  }

  _handleAgent(platform, channelId) {
    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    if (!binding) {
      return '🤖 No agent bound to this channel.\nUse the Mission Control UI to bind an agent.';
    }

    const { agentId } = binding;
    const entry = this.agentRegistry && this.agentRegistry.get(agentId);
    if (!entry) return `🤖 Agent "${agentId}" is configured but not loaded.`;

    const { definition, agent, runner } = entry;
    const lines = [
      `🤖 *Agent: ${definition.name || agentId}*`,
      ``,
      `*ID:* ${definition.id}`,
      definition.description ? `*Description:* ${definition.description}` : null,
      definition.avatar ? `*Avatar:* ${definition.avatar}` : null,
      `*Model:* ${definition.model || 'default'}`,
      `*Provider:* ${definition.provider || 'claude'}`,
      `*Status:* ${agent.status || 'idle'}`,
      `*Queue depth:* ${runner.queueDepth}`,
      `*Max turns:* ${definition.maxTurns || 'default'}`,
      definition.tools && definition.tools.length
        ? `*Tools:* ${definition.tools.join(', ')}`
        : null,
      binding.systemPromptOverride
        ? `\n*Prompt override:* ${binding.systemPromptOverride.substring(0, 100)}`
        : null,
    ].filter(Boolean);

    return lines.join('\n');
  }

  _handleChannels() {
    if (!this.channelRegistry) return '📡 Channel registry not available.';
    const bindings = this.channelRegistry.list();

    if (bindings.length === 0) return '📡 No channel bindings configured.';

    const lines = [`📡 *Channel Bindings* (${bindings.length})`, ''];
    for (const b of bindings) {
      lines.push(`• *${b.id}* → agent: \`${b.agentId}\` (${b.platform})`);
    }
    return lines.join('\n');
  }

  async _handleRuns(platform, channelId) {
    if (!this.runStore) return '🏃 Run store not available.';

    const binding = this.channelRegistry && this.channelRegistry.get(platform, channelId);
    const channelKey = `${platform}:${channelId}`;

    try {
      let runs;
      if (typeof this.runStore.listByChannel === 'function') {
        runs = await this.runStore.listByChannel(channelKey, 10);
      } else if (typeof this.runStore.list === 'function') {
        const result = await this.runStore.list({ channelId: channelKey, limit: 10 });
        runs = result.runs || result;
      } else {
        return '🏃 Run listing not supported by current run store.';
      }

      if (!runs || runs.length === 0) return '🏃 No recent runs for this channel.';

      const lines = [`🏃 *Recent Runs* (${channelKey})`, ''];
      for (const r of runs) {
        const statusEmoji = { completed: '✅', running: '🔄', failed: '❌', pending: '⏳' }[r.status] || '•';
        const duration = r.durationMs ? ` ${Math.round(r.durationMs / 1000)}s` : '';
        lines.push(`${statusEmoji} \`${r.id}\` ${r.agentId}${duration} — ${r.status}`);
      }
      return lines.join('\n');
    } catch (err) {
      return `❌ Failed to load runs: ${err.message}`;
    }
  }

  _handleHelp() {
    return [
      '📖 *Commands*',
      '',
      '`/new` or `/reset` — Start fresh session',
      '`/status` — Show agent and queue status',
      '`/memory` — Show agent memory',
      '`/memory list` — List memory files',
      '`/memory search <query>` — Search memories',
      '`/queue` — Show queue status across all agents',
      '`/stop` — Stop current operation',
      '`/task create <title>` — Create a task',
      '`/task list` — List tasks for this channel\'s agent',
      '`/agent` — Show current agent info',
      '`/channels` — List all channel bindings',
      '`/runs` — List recent runs for this channel',
      '`/help` — Show this help',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _parse(text) {
    const trimmed = text.trim();
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      return { command: trimmed.slice(1).toLowerCase(), args: '' };
    }
    return {
      command: trimmed.slice(1, spaceIndex).toLowerCase(),
      args: trimmed.slice(spaceIndex + 1).trim(),
    };
  }
}

module.exports = CommandHandler;
