'use strict';

/**
 * BaseProvider — abstract interface that every AI provider must implement.
 *
 * Providers are responsible for:
 *  - Holding a session map: sessionKey → provider-native session ID
 *  - Streaming responses from the underlying AI SDK via the query() async generator
 *  - Aborting in-flight requests per sessionKey
 *  - Advertising available models
 *
 * Subclasses must override: query(), getAvailableModels(), get name()
 * Subclasses should override: dispose() if they hold external resources.
 */
class BaseProvider {
  /**
   * @param {Object} config
   * @param {string}  [config.model]          - Default model ID to use
   * @param {string}  [config.permissionMode] - Tool permission mode
   * @param {number}  [config.maxTurns]       - Default max agent turns
   */
  constructor(config = {}) {
    this.config = config;

    // Map of sessionKey → provider-native session/conversation ID.
    // Used to resume conversations across calls.
    this._sessions = new Map();

    // Active AbortControllers, keyed by sessionKey.
    this._abortControllers = new Map();

    // Current model override (may be null, fall back to config.model or provider default)
    this._model = config.model || null;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  /**
   * Human-readable provider name, e.g. 'claude', 'opencode'.
   * Must be overridden by subclass.
   * @type {string}
   */
  get name() {
    throw new Error(`${this.constructor.name} must implement get name()`);
  }

  // ---------------------------------------------------------------------------
  // Model management
  // ---------------------------------------------------------------------------

  /**
   * Return available models for this provider.
   * @returns {Array<{id: string, label: string}>}
   */
  getAvailableModels() {
    return [];
  }

  /**
   * Set the active model.
   * @param {string} modelId
   */
  setModel(modelId) {
    this._model = modelId;
  }

  /**
   * Get the currently active model (may be null if using provider default).
   * @returns {string|null}
   */
  getModel() {
    return this._model;
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the provider-native session ID for a given sessionKey, or null.
   * @param {string} sessionKey
   * @returns {string|null}
   */
  getSessionId(sessionKey) {
    return this._sessions.get(sessionKey) || null;
  }

  /**
   * Store the provider-native session ID so the next query can resume it.
   * @param {string} sessionKey
   * @param {string} id
   */
  setSessionId(sessionKey, id) {
    this._sessions.set(sessionKey, id);
  }

  // ---------------------------------------------------------------------------
  // Abort
  // ---------------------------------------------------------------------------

  /**
   * Abort an in-flight query for the given sessionKey.
   * Returns true if an active request was found and aborted, false otherwise.
   * @param {string} sessionKey
   * @returns {boolean}
   */
  abort(sessionKey) {
    const controller = this._abortControllers.get(sessionKey);
    if (controller) {
      controller.abort();
      this._abortControllers.delete(sessionKey);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Core query (must override)
  // ---------------------------------------------------------------------------

  /**
   * Execute a prompt against the AI provider and stream back chunks.
   *
   * Implementations must:
   *  - Accept an AbortController signal for cancellation
   *  - Persist the provider session ID via setSessionId() so the conversation
   *    can be resumed on the next call
   *  - Call onStep(step) for each intermediate reasoning step, tool call, and
   *    tool result so callers can update run logs in real-time
   *  - Yield { type: 'text', content: string } for streamed text tokens
   *  - Yield { type: 'complete', content: string } once when the full response
   *    is assembled (optional; base-agent collects streaming text itself)
   *  - Yield { type: 'aborted' } if the request was cancelled
   *  - Yield { type: 'error', error: string } on non-abort errors
   *  - Yield { type: 'done' } when the turn is fully finished
   *
   * @param {Object}   params
   * @param {string}   params.sessionKey   - Conversation key (potatoclaw:...)
   * @param {string|Array} params.prompt   - User message or content block array
   * @param {string}   [params.systemPrompt] - System prompt for this turn
   * @param {Object}   [params.mcpServers] - MCP server instances keyed by name
   * @param {string[]} [params.tools]      - Allowed tool names
   * @param {number}   [params.maxTurns]   - Max agent turns
   * @param {Object}   [params.image]      - Optional image {mediaType, data}
   * @param {Function} [params.onStep]     - Callback(step) for each agent step
   * @yields {{type: string, content?: string, [key: string]: any}}
   */
  async *query(params) { // eslint-disable-line require-yield
    throw new Error(`${this.constructor.name} must implement query()`);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize any external connections. Called once before first query.
   * Override if the provider needs async setup.
   * @returns {Promise<void>}
   */
  async initialize() {
    // no-op by default
  }

  /**
   * Release all resources held by this provider: close connections, flush maps.
   * @returns {Promise<void>}
   */
  async dispose() {
    // Abort any lingering in-flight requests
    for (const controller of this._abortControllers.values()) {
      try { controller.abort(); } catch (_) { /* ignore */ }
    }
    this._abortControllers.clear();
    this._sessions.clear();
  }
}

module.exports = BaseProvider;
