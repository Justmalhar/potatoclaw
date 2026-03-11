'use strict';

const { query } = require('@anthropic-ai/claude-agent-sdk');
const BaseProvider = require('./base');
const { createLogger } = require('../utils/logger');

const log = createLogger('claude-provider');

/**
 * Available Claude models for potatoclaw.
 * Model IDs match what the Anthropic Claude Agent SDK accepts.
 */
const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6 (most capable)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (fastest)' },
];

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * ClaudeProvider — wraps the @anthropic-ai/claude-agent-sdk `query()` function.
 *
 * Key responsibilities:
 *  - Maintain a per-sessionKey SDK session ID for conversation resumption
 *  - Build the prompt (with optional base64 image blocks)
 *  - Stream response chunks and forward intermediate steps via onStep()
 *  - Support abort per sessionKey via AbortController
 *  - Normalize all chunk types to the shape expected by BaseAgent
 */
class ClaudeProvider extends BaseProvider {
  /**
   * @param {Object} config
   * @param {string}   [config.model='claude-sonnet-4-6'] - Default model
   * @param {string}   [config.permissionMode='bypassPermissions']
   * @param {number}   [config.maxTurns=50]
   * @param {string[]} [config.allowedTools]
   */
  constructor(config = {}) {
    super(config);
    this._model = config.model || DEFAULT_MODEL;
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    this.defaultMaxTurns = config.maxTurns || 50;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  get name() { return 'claude'; }

  getAvailableModels() {
    return AVAILABLE_MODELS.slice(); // defensive copy
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Run an agent query with Claude.
   *
   * Yields:
   *  { type: 'text',     content: string }        — streamed text token
   *  { type: 'complete', content: string }         — full response assembled
   *  { type: 'aborted' }                           — query was cancelled
   *  { type: 'error',    error: string }           — non-abort error
   *  { type: 'done' }                              — run finished
   *
   * The onStep callback receives step objects of the form:
   *  { type: 'thought',     content: string }
   *  { type: 'tool_call',   tool: string, input: Object }
   *  { type: 'tool_result', content: string }
   *  { type: 'message',     content: string }
   *
   * @param {Object}   params
   * @param {string}   params.sessionKey
   * @param {string|Array} params.prompt
   * @param {string}   [params.systemPrompt]
   * @param {Object}   [params.mcpServers={}]
   * @param {string[]} [params.tools]
   * @param {number}   [params.maxTurns]
   * @param {Object}   [params.image]          {mediaType, data} base64 image
   * @param {Function} [params.onStep]         step callback
   * @yields {Object}
   */
  async *query(params) {
    const {
      sessionKey,
      prompt,
      systemPrompt = null,
      mcpServers = {},
      tools = [],
      maxTurns = this.defaultMaxTurns,
      image = null,
      onStep = null,
    } = params;

    // Build the SDK query options
    const queryOptions = {
      mcpServers,
      maxTurns,
      permissionMode: this.permissionMode,
      includePartialMessages: true,
    };

    if (tools && tools.length > 0) {
      queryOptions.allowedTools = tools;
    }

    if (this._model) {
      queryOptions.model = this._model;
    }

    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    // Resume existing session if available
    const existingSessionId = this.getSessionId(sessionKey);
    if (existingSessionId) {
      queryOptions.resume = existingSessionId;
      log.debug({ sessionKey, existingSessionId }, 'Resuming existing session');
    }

    // Build the prompt payload; wrap with image content blocks if needed
    const promptPayload = this._buildPrompt(prompt, image);

    // Register an AbortController for this session so abort() can cancel it
    const abortController = new AbortController();
    this._abortControllers.set(sessionKey, abortController);

    log.debug({ sessionKey, model: this._model, hasMcp: Object.keys(mcpServers).length > 0 },
      'Starting Claude query');

    try {
      let fullText = '';
      let hasStreamedText = false;

      for await (const chunk of query({
        prompt: promptPayload,
        options: queryOptions,
        abortSignal: abortController.signal,
      })) {
        // ── System / init ────────────────────────────────────────────────────
        if (chunk.type === 'system' && chunk.subtype === 'init') {
          const newSessionId = chunk.session_id || chunk.data?.session_id;
          if (newSessionId) {
            this.setSessionId(sessionKey, newSessionId);
            log.debug({ sessionKey, newSessionId }, 'Session ID stored');
          }
          continue;
        }

        // Skip other system events
        if (chunk.type === 'system') continue;

        // ── Streaming partial messages (token-level) ─────────────────────────
        if (chunk.type === 'stream_event' && chunk.event) {
          const event = chunk.event;

          // Text delta — individual tokens
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const token = event.delta.text;
            if (token) {
              hasStreamedText = true;
              fullText += token;
              const step = { type: 'thought', content: token };
              if (onStep) onStep(step);
              yield { type: 'text', content: token };
            }
          }
          // Tool-use block opened
          else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const block = event.content_block;
            const step = { type: 'tool_call', tool: block.name, input: block.input || {} };
            if (onStep) onStep(step);
          }
          continue;
        }

        // ── Complete assistant message (when streaming not active) ───────────
        if (chunk.type === 'assistant' && chunk.message?.content) {
          for (const block of chunk.message.content) {
            if (block.type === 'text' && block.text) {
              if (!hasStreamedText) {
                fullText += block.text;
                const step = { type: 'thought', content: block.text };
                if (onStep) onStep(step);
                yield { type: 'text', content: block.text };
              }
            } else if (block.type === 'tool_use' && !hasStreamedText) {
              const step = { type: 'tool_call', tool: block.name, input: block.input || {} };
              if (onStep) onStep(step);
            }
          }
          continue;
        }

        // ── Tool results ─────────────────────────────────────────────────────
        if (chunk.type === 'tool_result' || chunk.type === 'result') {
          const resultContent = chunk.result || chunk.content || '';
          const step = { type: 'tool_result', content: String(resultContent).slice(0, 2000) };
          if (onStep) onStep(step);
          continue;
        }

        // ── Terminal events ───────────────────────────────────────────────────
        if (chunk.type === 'done') break;

        if (chunk.type === 'aborted') {
          log.debug({ sessionKey }, 'Query aborted by SDK');
          yield { type: 'aborted' };
          return;
        }

        if (chunk.type === 'error') {
          log.warn({ sessionKey, error: chunk.error }, 'SDK error chunk');
          yield { type: 'error', error: chunk.error };
          return;
        }
      }

      // Emit the complete message step for run tracking
      if (fullText && onStep) {
        onStep({ type: 'message', content: fullText });
      }

      log.debug({ sessionKey, chars: fullText.length }, 'Claude query complete');
      yield { type: 'complete', content: fullText };
      yield { type: 'done' };

    } catch (err) {
      if (err.name === 'AbortError') {
        log.debug({ sessionKey }, 'Query aborted via AbortController');
        yield { type: 'aborted' };
      } else {
        log.error({ sessionKey, err }, 'Claude query error');
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
   * Build the prompt payload accepted by the Claude Agent SDK.
   * When an image is attached we return an array of content blocks;
   * otherwise we return the prompt string/array as-is.
   *
   * @param {string|Array} prompt
   * @param {Object|null}  image  {mediaType: string, data: string (base64)}
   * @returns {string|Array}
   * @private
   */
  _buildPrompt(prompt, image) {
    if (!image) return prompt;

    // If prompt is already an array of content blocks, prepend the image block
    const textBlocks = Array.isArray(prompt)
      ? prompt
      : [{ type: 'text', text: String(prompt) }];

    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType || 'image/jpeg',
          data: image.data,
        },
      },
      ...textBlocks,
    ];
  }
}

module.exports = ClaudeProvider;
