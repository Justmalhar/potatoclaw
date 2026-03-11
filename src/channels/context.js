'use strict';

/**
 * ChannelContext — assembles per-channel context before each agent run.
 *
 * Depends on:
 *   - ChannelRegistry  (src/channels/registry.js)
 *   - MemoryManager    (src/memory/manager.js)
 *   - SessionManager   (src/sessions/manager.js)
 */

const fs = require('fs');
const path = require('path');

class ChannelContext {
  /**
   * @param {{ channelRegistry, memoryManager?, sessionManager?, dataDir: string }} opts
   *
   * memoryManager here is a factory: (agentId) => MemoryManager instance.
   * If not provided, channel memory and summaries are read from flat files.
   */
  constructor({ channelRegistry, memoryManager, sessionManager, dataDir }) {
    this.channelRegistry = channelRegistry;
    this.memoryManager = memoryManager || null;     // (agentId) => MemoryManager
    this.sessionManager = sessionManager || null;   // (agentId) => SessionManager
    this.dataDir = dataDir || process.env.DATA_DIR || '/data';
    this._messageCounts = new Map();  // key → message count since last summary
  }

  // ---------------------------------------------------------------------------
  // Main context builder
  // ---------------------------------------------------------------------------

  /**
   * Build the full context object for an agent run.
   *
   * @param {string} platform
   * @param {string} channelId
   * @returns {Promise<Object>}
   */
  async buildContext(platform, channelId) {
    const binding = this.channelRegistry.get(platform, channelId);
    if (!binding) {
      return {
        agentId: null,
        systemPromptOverride: null,
        toolOverrides: null,
        summary: '',
        recentMessages: [],
        channelMemory: '',
      };
    }

    const {
      agentId,
      systemPromptOverride = null,
      toolOverrides = null,
      recentMessageWindow = 20,
      summaryEnabled = true,
    } = binding;

    const canonicalKey = `${platform}:${channelId}`;

    // Load summary
    let summary = '';
    if (summaryEnabled) {
      summary = this._readFileSafe(this.getSummaryPath(channelId)) || '';
    }

    // Load recent messages from session transcript
    let recentMessages = [];
    if (this.sessionManager) {
      try {
        const sessionKey = `potatoclaw:${agentId}:${platform}:channel:${channelId}`;
        const mgr = typeof this.sessionManager === 'function'
          ? this.sessionManager(agentId)
          : this.sessionManager;
        recentMessages = await mgr.getTranscript(sessionKey, recentMessageWindow);
      } catch (err) {
        console.error('[ChannelContext] Failed to load recent messages:', err.message);
      }
    }

    // Load channel memory
    const channelMemory = this._readFileSafe(this.getMemoryPath(channelId)) || '';

    return {
      agentId,
      systemPromptOverride,
      toolOverrides,
      summary,
      recentMessages,
      channelMemory,
    };
  }

  // ---------------------------------------------------------------------------
  // Message appending + summary trigger
  // ---------------------------------------------------------------------------

  /**
   * Append a message to the session transcript and check if a summary update is needed.
   *
   * @param {string} platform
   * @param {string} channelId
   * @param {{ role: string, content: string }} message
   */
  async appendMessage(platform, channelId, { role, content }) {
    const binding = this.channelRegistry.get(platform, channelId);
    if (!binding) return;

    const { agentId, summaryEnabled = true, summaryIntervalMessages = 50 } = binding;

    // Append to session transcript
    if (this.sessionManager) {
      try {
        const sessionKey = `potatoclaw:${agentId}:${platform}:channel:${channelId}`;
        const mgr = typeof this.sessionManager === 'function'
          ? this.sessionManager(agentId)
          : this.sessionManager;
        await mgr.appendTranscript(sessionKey, { role, content, timestamp: Date.now() });
      } catch (err) {
        console.error('[ChannelContext] Failed to append to transcript:', err.message);
      }
    }

    // Track message count for summary triggering
    if (summaryEnabled) {
      const countKey = `${platform}:${channelId}`;
      const count = (this._messageCounts.get(countKey) || 0) + 1;
      this._messageCounts.set(countKey, count);

      if (count % summaryIntervalMessages === 0) {
        // Async — don't block message handling
        this.updateSummary(platform, channelId).catch((err) => {
          console.error('[ChannelContext] Summary update failed:', err.message);
        });
      }
    }
  }

  /**
   * Generate a rolling summary for the channel by reading recent messages
   * and appending them to the existing summary.
   *
   * @param {string} platform
   * @param {string} channelId
   */
  async updateSummary(platform, channelId) {
    const binding = this.channelRegistry.get(platform, channelId);
    if (!binding) return;

    const { agentId } = binding;
    const summaryPath = this.getSummaryPath(channelId);
    const existingSummary = this._readFileSafe(summaryPath) || '';

    let recentMessages = [];
    if (this.sessionManager) {
      try {
        const sessionKey = `potatoclaw:${agentId}:${platform}:channel:${channelId}`;
        const mgr = typeof this.sessionManager === 'function'
          ? this.sessionManager(agentId)
          : this.sessionManager;
        recentMessages = await mgr.getTranscript(sessionKey, 50);
      } catch {}
    }

    if (recentMessages.length === 0) return;

    // Simple heuristic summary: keep existing summary + last N message snippets
    const lines = [
      existingSummary ? `Previous summary:\n${existingSummary.trim()}` : null,
      `\nRecent conversation (${new Date().toISOString()}):`,
      ...recentMessages.slice(-20).map((m) => `  [${m.role}]: ${String(m.content || '').substring(0, 200)}`),
    ].filter(Boolean);

    const newSummary = lines.join('\n');

    // Ensure directory
    const dir = path.dirname(summaryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(summaryPath, newSummary, 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  /**
   * Path to the summary file for a channel.
   * @param {string} channelId
   * @returns {string}
   */
  getSummaryPath(channelId) {
    const safeId = channelId.replace(/[^a-zA-Z0-9_-]/g, '-');
    return path.join(this.dataDir, 'channels', `${safeId}-summary.md`);
  }

  /**
   * Path to the channel memory file.
   * @param {string} channelId
   * @returns {string}
   */
  getMemoryPath(channelId) {
    const safeId = channelId.replace(/[^a-zA-Z0-9_-]/g, '-');
    return path.join(this.dataDir, 'channels', `${safeId}-memory.md`);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _readFileSafe(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf-8');
      }
    } catch {}
    return null;
  }
}

module.exports = ChannelContext;
