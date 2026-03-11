'use strict';

const BaseProvider = require('./base');
const { createLogger } = require('../utils/logger');

const log = createLogger('opencode-provider');

/**
 * Available models exposed by the Opencode provider.
 */
const AVAILABLE_MODELS = [
  { id: 'opencode/big-pickle',       label: 'Big Pickle (reasoning)' },
  { id: 'opencode/gpt-5-nano',       label: 'GPT-5 Nano' },
  { id: 'opencode/glm-4.7-free',     label: 'GLM-4.7 (free)' },
  { id: 'opencode/grok-code',        label: 'Grok Code Fast' },
  { id: 'opencode/minimax-m2.1-free', label: 'MiniMax M2.1 (free)' },
];

const DEFAULT_MODEL = 'opencode/big-pickle';

/**
 * OpencodeProvider — wraps the @opencode-ai/sdk client.
 *
 * The Opencode SDK exposes a REST API backed by a local or remote server.
 * This provider:
 *  - Lazily initializes the SDK client (or starts an embedded server)
 *  - Creates/resumes Opencode sessions for each sessionKey
 *  - Streams events via the event SSE bus and normalizes them to the
 *    same yield shape as ClaudeProvider
 *  - Calls onStep() for each intermediate step so BaseAgent can track runs
 *  - Supports abort via AbortController
 *
 * NOTE: MCP servers with type 'http'/'remote' can be registered dynamically
 * via the SDK API; in-process MCP server objects are not supported by the
 * Opencode SDK — they require a URL endpoint.
 */
class OpencodeProvider extends BaseProvider {
  /**
   * @param {Object} config
   * @param {string}  [config.model]               - Default model ID
   * @param {string}  [config.hostname='127.0.0.1'] - Server hostname
   * @param {number}  [config.port=4099]             - Server port
   * @param {string}  [config.existingServerUrl]     - Use a pre-running server
   * @param {boolean} [config.useExistingServer]     - Skip server start attempt
   */
  constructor(config = {}) {
    super(config);
    this._model = config.model || DEFAULT_MODEL;
    this.hostname = config.hostname || '127.0.0.1';
    this.port = config.port || 4099; // avoid clash with gateway port 4096
    this.existingServerUrl = config.existingServerUrl || null;
    this.useExistingServer = config.useExistingServer || false;

    // SDK client and optional embedded server
    this._client = null;
    this._serverInstance = null;
    this._initialized = false;
    this._mcpRegistered = false;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  get name() { return 'opencode'; }

  getAvailableModels() {
    return AVAILABLE_MODELS.slice();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Lazily initialize the Opencode SDK client.
   * Tries connecting to an existing server first; if unavailable, starts one.
   */
  async initialize() {
    if (this._initialized) return;
    this._initialized = true;

    // Dynamically require so the SDK is optional at startup
    let createOpencode, createOpencodeClient;
    try {
      ({ createOpencode, createOpencodeClient } = require('@opencode-ai/sdk'));
    } catch (err) {
      throw new Error(
        '[OpencodeProvider] @opencode-ai/sdk is not installed. ' +
        'Run: npm install @opencode-ai/sdk'
      );
    }

    const baseUrl = this.existingServerUrl || `http://${this.hostname}:${this.port}`;

    // Try an existing server first
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status < 500) {
        log.info({ baseUrl }, 'Connected to existing Opencode server');
        this._client = createOpencodeClient({ baseUrl });
        return;
      }
    } catch (_) {
      // Not running — fall through
    }

    if (this.useExistingServer) {
      throw new Error(`[OpencodeProvider] No Opencode server found at ${baseUrl}`);
    }

    // Start embedded server
    log.info({ hostname: this.hostname, port: this.port }, 'Starting embedded Opencode server');
    try {
      const { client, server } = await createOpencode({
        hostname: this.hostname,
        port: this.port,
      });
      this._client = client;
      this._serverInstance = server;
      log.info('Embedded Opencode server started');
    } catch (err) {
      log.error({ err }, 'Failed to start Opencode server');
      throw err;
    }
  }

  /**
   * Register HTTP/remote MCP servers via the Opencode SDK API.
   * In-process MCP server objects are not supported by Opencode —
   * only servers that expose a URL can be registered here.
   *
   * @param {Object} mcpServers - keyed by server name
   */
  async _registerMcpServers(mcpServers) {
    if (this._mcpRegistered || !mcpServers) return;

    for (const [name, cfg] of Object.entries(mcpServers)) {
      if (cfg && (cfg.type === 'http' || cfg.type === 'remote') && cfg.url) {
        try {
          await this._client.mcp.add({
            body: {
              name,
              config: { type: 'remote', url: cfg.url, headers: cfg.headers || {} },
            },
          });
          await this._client.mcp.connect({ path: { name } });
          log.debug({ name, url: cfg.url }, 'Registered remote MCP server');
        } catch (err) {
          log.warn({ name, err: err.message }, 'Failed to register MCP server');
        }
      }
    }

    this._mcpRegistered = true;
  }

  async dispose() {
    await super.dispose();
    if (this._serverInstance) {
      try { await this._serverInstance.close(); } catch (_) { /* ignore */ }
      this._serverInstance = null;
    }
    this._client = null;
    this._initialized = false;
    this._mcpRegistered = false;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Run a query against the Opencode server.
   *
   * Yields the same shape as ClaudeProvider:
   *  { type: 'text',     content }
   *  { type: 'complete', content }
   *  { type: 'aborted' }
   *  { type: 'error',    error }
   *  { type: 'done' }
   *
   * @param {Object}   params
   * @param {string}   params.sessionKey
   * @param {string|AsyncGenerator} params.prompt
   * @param {string}   [params.systemPrompt]
   * @param {Object}   [params.mcpServers={}]
   * @param {number}   [params.maxTurns]
   * @param {Object}   [params.image]
   * @param {Function} [params.onStep]
   * @yields {Object}
   */
  async *query(params) {
    const {
      sessionKey,
      prompt,
      systemPrompt = null,
      mcpServers = {},
      image = null,
      onStep = null,
    } = params;

    const modelToUse = this._model || DEFAULT_MODEL;

    await this.initialize();

    // Register any remote MCP servers on first query
    if (!this._mcpRegistered && Object.keys(mcpServers).length > 0) {
      await this._registerMcpServers(mcpServers);
    }

    // Create or resume an Opencode session
    let sessionId = this.getSessionId(sessionKey);

    const abortController = new AbortController();
    this._abortControllers.set(sessionKey, abortController);

    try {
      if (!sessionId) {
        const sessionConfig = { model: modelToUse };
        if (systemPrompt) sessionConfig.systemPrompt = systemPrompt;

        const result = await this._client.session.create({ body: { config: sessionConfig } });
        sessionId = result.data?.id || result.id;
        if (sessionId) {
          this.setSessionId(sessionKey, sessionId);
          log.debug({ sessionKey, sessionId }, 'Created new Opencode session');
        }
      }

      // Extract plain text from prompt (may be an async generator of message objects)
      const promptText = await this._extractPromptText(prompt, image);

      // Parse "provider/model" format expected by the SDK
      const [providerID, ...modelParts] = modelToUse.split('/');
      const modelID = modelParts.join('/');

      // Build message parts; on first message include system prompt inline if not
      // accepted by session config (Opencode does not always honour sessionConfig.systemPrompt)
      const parts = [];
      const sysKey = sessionKey + ':sysSent';
      if (systemPrompt && !this.getSessionId(sysKey)) {
        parts.push({
          type: 'text',
          text: `[System Instructions]\n${systemPrompt}\n\n[User Message]\n${promptText}`,
        });
        this.setSessionId(sysKey, 'true');
      } else {
        parts.push({ type: 'text', text: promptText });
      }

      // Subscribe to event stream before sending the prompt
      const events = await this._client.event.subscribe();

      // Send the prompt
      await this._client.session.promptAsync({
        path: { id: sessionId },
        body: { model: { providerID, modelID }, parts },
      });

      // Stream events
      let fullText = '';
      let userMessageId = null;
      const lastYieldedLength = new Map();
      const yieldedToolCalls = new Set();

      for await (const event of events.stream) {
        if (abortController.signal.aborted) break;

        const props = event.properties || {};
        const part = props.part || props;
        const eventSessionId = props.sessionID || part?.sessionID || props.session?.id;

        // Filter to events belonging to our session
        if (eventSessionId && eventSessionId !== sessionId) continue;

        if (event.type === 'message.part.updated') {
          const messageId = part?.messageID;
          const partId = part?.id;

          // Detect and skip the user's own message (first text part)
          if (!userMessageId && part?.type === 'text') {
            userMessageId = messageId;
            continue;
          }
          if (messageId === userMessageId) continue;

          // ── Streaming text ───────────────────────────────────────────────
          if (part?.type === 'text' && part?.text) {
            const prevLen = lastYieldedLength.get(partId) || 0;
            const delta = part.text.slice(prevLen);
            if (delta) {
              fullText += delta;
              lastYieldedLength.set(partId, part.text.length);
              if (onStep) onStep({ type: 'thought', content: delta });
              yield { type: 'text', content: delta };
            }
          }
          // ── Reasoning text ───────────────────────────────────────────────
          else if (part?.type === 'reasoning') {
            const reasonText = part.reasoning || part.text || '';
            const prevLen = lastYieldedLength.get(partId) || 0;
            const delta = reasonText.slice(prevLen);
            if (delta) {
              lastYieldedLength.set(partId, reasonText.length);
              if (onStep) onStep({ type: 'thought', content: delta });
              yield { type: 'text', content: delta };
            }
          }
          // ── Tool invocation ──────────────────────────────────────────────
          else if (
            part?.type === 'tool-invocation' ||
            part?.type === 'tool_invocation' ||
            part?.type === 'tool'
          ) {
            const toolId = part.toolInvocationId || part.callID || part.id;
            if (yieldedToolCalls.has(toolId)) continue;
            if (part.state?.status === 'pending') continue;

            const toolName  = part.toolName || part.tool || part.name;
            const toolInput = part.state?.input || part.args || part.input || {};

            yieldedToolCalls.add(toolId);
            if (onStep) onStep({ type: 'tool_call', tool: toolName, input: toolInput });
          }
          // ── Tool result ──────────────────────────────────────────────────
          else if (part?.type === 'tool-result' || part?.type === 'tool_result') {
            const resultData = part.result || part.output || part.content;
            if (onStep) onStep({ type: 'tool_result', content: String(resultData || '').slice(0, 2000) });
          }

        } else if (event.type === 'session.idle') {
          break;
        } else if (event.type === 'session.error') {
          log.warn({ sessionKey, error: props.message }, 'Opencode session error');
          yield { type: 'error', error: props.message || 'Session error' };
          return;
        }
      }

      if (abortController.signal.aborted) {
        log.debug({ sessionKey }, 'Opencode query aborted');
        yield { type: 'aborted' };
        return;
      }

      if (fullText && onStep) onStep({ type: 'message', content: fullText });

      log.debug({ sessionKey, chars: fullText.length }, 'Opencode query complete');
      yield { type: 'complete', content: fullText };
      yield { type: 'done' };

    } catch (err) {
      if (err.name === 'AbortError') {
        log.debug({ sessionKey }, 'Opencode query aborted via AbortController');
        yield { type: 'aborted' };
      } else {
        log.error({ sessionKey, err }, 'Opencode query error');
        yield { type: 'error', error: err.message };
      }
    } finally {
      this._abortControllers.delete(sessionKey);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Flatten a prompt (string, array of content blocks, or async generator of
   * message objects) into a plain text string. Optionally appends image notice.
   *
   * @param {string|Array|AsyncGenerator} prompt
   * @param {Object|null} image
   * @returns {Promise<string>}
   * @private
   */
  async _extractPromptText(prompt, image) {
    let text = '';

    if (typeof prompt === 'string') {
      text = prompt;
    } else if (Array.isArray(prompt)) {
      for (const block of prompt) {
        if (block.type === 'text') text += block.text;
      }
    } else if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
      for await (const msg of prompt) {
        const content = msg?.message?.content;
        if (typeof content === 'string') {
          text += content;
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === 'text') text += part.text;
          }
        }
      }
    }

    if (image) {
      text += '\n\n[An image was attached. Image processing is not supported by this provider.]';
    }

    return text;
  }
}

module.exports = OpencodeProvider;
