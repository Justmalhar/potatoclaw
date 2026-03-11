'use strict';

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');

/**
 * Priority order (lower number = higher priority).
 * Items with a lower priority number jump ahead in the queue.
 */
const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

function priorityValue(p) {
  return PRIORITY_ORDER[p] !== undefined ? PRIORITY_ORDER[p] : PRIORITY_ORDER.normal;
}

/**
 * AgentRunner — per-agent FIFO queue executor.
 *
 * One AgentRunner instance exists per agent. It holds a single queue of work
 * items (messages and tasks) and processes them one at a time so that each
 * agent is never asked to handle two conversations simultaneously — which would
 * break multi-turn conversation state.
 *
 * Higher-priority items (critical/high) are inserted ahead of normal/low items
 * already waiting in the queue. Items of equal priority preserve arrival order.
 *
 * Events emitted:
 *   'queued'     { item, position }               — item added to queue
 *   'processing' { item, queueDepth }             — item processing started
 *   'completed'  { item, durationMs, response }   — item finished successfully
 *   'failed'     { item, error, durationMs }      — item processing threw
 *   'drained'    {}                               — queue became empty
 */
class AgentRunner extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {import('../agents/base-agent')} opts.agent - The BaseAgent to drive
   */
  constructor(optsOrAgentId, agentArg) {
    super();

    // Support: new AgentRunner({ agent }) and new AgentRunner(agentId, agentInstance)
    let agent;
    if (optsOrAgentId && typeof optsOrAgentId === 'object' && optsOrAgentId.agent) {
      agent = optsOrAgentId.agent;
    } else {
      agent = agentArg || optsOrAgentId;
    }

    if (!agent) throw new Error('AgentRunner requires an agent instance');

    this._agent = agent;
    this._queue = [];          // waiting items (sorted by priority)
    this._processing = false;  // true while an item is being executed
    this._current = null;      // the item currently being processed
    this._log = createLogger(`runner:${agent.id || 'unknown'}`);

    // Counters for stats
    this._stats = {
      totalQueued:    0,
      totalProcessed: 0,
      totalFailed:    0,
    };

    // Forward agent events upward so orchestrators can observe them
    this._agent.on('step',     (step) => this.emit('agent:step',     { agentId: agent.id, step }));
    this._agent.on('complete', (data) => this.emit('agent:complete', { agentId: agent.id, ...data }));
    this._agent.on('error',    (data) => this.emit('agent:error',    { agentId: agent.id, ...data }));
    this._agent.on('aborted',  (data) => this.emit('agent:aborted',  { agentId: agent.id, ...data }));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add an item to the queue.
   *
   * The item shape is flexible; the runner passes it as-is to _executeItem().
   * Callers (Orchestrator) are responsible for setting all required fields.
   *
   * Required fields:
   *   id         {string}   - Unique item ID (e.g. "msg_xyz")
   *   type       {string}   - 'message' | 'task'
   *   sessionKey {string}   - Conversation key (potatoclaw:...)
   *   text       {string}   - Message text or task description
   *
   * Optional fields:
   *   image          {Object}   - {mediaType, data} base64 image
   *   adapter        {Object}   - Platform adapter (for sending responses)
   *   chatId         {string}   - Platform chat ID for responses
   *   channelContext {Object}   - ChannelContext object
   *   taskContext    {Object}   - Task metadata
   *   runId          {string}   - Associated run ID
   *   priority       {string}   - 'critical'|'high'|'normal'|'low' (default: 'normal')
   *
   * @param {Object} item
   * @returns {number} Queue position (0 = will be processed next)
   */
  enqueue(item) {
    if (!item.sessionKey) throw new Error('enqueue: item.sessionKey is required');
    if (!item.text)       throw new Error('enqueue: item.text is required');

    item.id        = item.id        || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    item.priority  = item.priority  || 'normal';
    item.queuedAt  = Date.now();

    // Insert in priority order; equal priority preserves insertion order (stable)
    const incomingPrio = priorityValue(item.priority);
    let insertIndex = this._queue.length;

    for (let i = 0; i < this._queue.length; i++) {
      if (priorityValue(this._queue[i].priority) > incomingPrio) {
        insertIndex = i;
        break;
      }
    }

    this._queue.splice(insertIndex, 0, item);
    this._stats.totalQueued++;

    const position = insertIndex + (this._processing ? 1 : 0);

    this._log.debug({ itemId: item.id, type: item.type, priority: item.priority, position },
      'Item enqueued');

    this.emit('queued', { item, position });

    // Kick off processing if not already running
    this._processQueue();

    return position;
  }

  /**
   * Abort the in-flight query for a session key.
   * Does not remove the session's waiting items from the queue.
   *
   * @param {string} sessionKey
   * @returns {boolean}
   */
  abort(sessionKey) {
    return this._agent.abort(sessionKey);
  }

  /**
   * Number of items waiting in the queue (not counting the currently processing item).
   * @type {number}
   */
  get queueDepth() {
    return this._queue.length;
  }

  /**
   * True while an item is actively being processed.
   * @type {boolean}
   */
  get isProcessing() {
    return this._processing;
  }

  /**
   * The item currently being processed, or null.
   * @type {Object|null}
   */
  get currentItem() {
    return this._current;
  }

  /**
   * Aggregate stats for this runner.
   * @returns {{ totalQueued: number, totalProcessed: number, totalFailed: number }}
   */
  get stats() {
    return { ...this._stats };
  }

  /**
   * Gracefully drain the queue:
   * - Reject all waiting items with a shutdown error
   * - Abort any in-flight request
   * @returns {Promise<void>}
   */
  async stop() {
    this._log.info('Stopping runner — draining queue');

    // Cancel in-flight request (best-effort)
    if (this._current) {
      this._agent.abort(this._current.sessionKey);
    }

    // Reject all waiting items
    for (const item of this._queue) {
      if (typeof item._reject === 'function') {
        item._reject(new Error('AgentRunner stopped'));
      }
    }
    this._queue.length = 0;
    this._processing = false;
    this._current = null;
  }

  // ---------------------------------------------------------------------------
  // Internal processing loop
  // ---------------------------------------------------------------------------

  /**
   * Main loop: take the next item off the queue and execute it.
   * Calls itself recursively (via setImmediate) until the queue is empty.
   * @private
   */
  async _processQueue() {
    if (this._processing || this._queue.length === 0) return;

    this._processing = true;
    const item = this._queue.shift();
    this._current = item;

    const waitMs = Date.now() - item.queuedAt;
    this._log.debug({ itemId: item.id, waitMs, remainingInQueue: this._queue.length },
      'Processing item');

    this.emit('processing', { item, queueDepth: this._queue.length });

    const startedAt = Date.now();

    try {
      const response = await this._executeItem(item);
      const durationMs = Date.now() - startedAt;

      this._stats.totalProcessed++;
      this._log.debug({ itemId: item.id, durationMs }, 'Item completed');
      this.emit('completed', { item, durationMs, response });

      if (typeof item._resolve === 'function') item._resolve(response);

    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this._stats.totalFailed++;
      this._log.error({ itemId: item.id, durationMs, err }, 'Item failed');
      this.emit('failed', { item, error: err, durationMs });

      if (typeof item._reject === 'function') item._reject(err);

    } finally {
      this._processing = false;
      this._current = null;

      if (this._queue.length === 0) {
        this.emit('drained', {});
      } else {
        // Use setImmediate so we don't blow the call stack on large queues
        setImmediate(() => this._processQueue());
      }
    }
  }

  /**
   * Execute a single queue item by driving the agent's run() generator.
   * Collects the full streamed text, delivers it via the adapter, and returns it.
   *
   * @param {Object} item
   * @returns {Promise<string>} Full response text
   * @private
   */
  async _executeItem(item) {
    const {
      sessionKey,
      text,
      image        = null,
      adapter      = null,
      chatId       = null,
      channelContext = {},
      taskContext  = null,
      runId        = null,
    } = item;

    let fullText   = '';
    let pendingText = ''; // accumulated since last tool call

    for await (const chunk of this._agent.run({
      sessionKey,
      text,
      image,
      channelContext,
      taskContext,
      runId,
    })) {
      if (chunk.type === 'text') {
        pendingText += chunk.content;
        fullText    += chunk.content;
        continue;
      }

      // Tool call — flush any accumulated text to the adapter first
      if (chunk.type === 'tool_use' || chunk.type === 'tool_call') {
        if (adapter && chatId && pendingText.trim()) {
          await this._sendSafe(adapter, chatId, pendingText.trim());
          pendingText = '';
        }
        continue;
      }

      if (chunk.type === 'done') break;

      if (chunk.type === 'aborted') {
        this._log.info({ sessionKey }, 'Item aborted mid-run');
        break;
      }

      if (chunk.type === 'error') {
        throw new Error(chunk.error || 'Agent run error');
      }
    }

    // Flush any remaining text
    if (adapter && chatId && pendingText.trim()) {
      await this._sendSafe(adapter, chatId, pendingText.trim());
    }

    return fullText;
  }

  /**
   * Send a message via the adapter, swallowing errors so a send failure does
   * not abort the run.
   *
   * @param {Object} adapter
   * @param {string} chatId
   * @param {string} text
   * @private
   */
  async _sendSafe(adapter, chatId, text) {
    try {
      await adapter.sendMessage(chatId, text);
    } catch (err) {
      this._log.warn({ chatId, err: err.message }, 'Failed to send message via adapter');
    }
  }
}

module.exports = AgentRunner;
