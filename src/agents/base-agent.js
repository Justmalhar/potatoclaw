'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const os   = require('os');
const { getProvider } = require('../providers');
const MemoryManager   = require('../memory/manager');
const { createLogger } = require('../utils/logger');

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * Tool name → MCP server factory module path.
 * When a tool name appears in agent definition's `tools` array we require the
 * corresponding module and call its factory to obtain an MCP server object
 * that the provider can use.
 *
 * Composio tools are handled separately: any tool prefixed with "composio"
 * (e.g. "composio:github") is wired via @composio/core.
 */
const TOOL_MODULE_MAP = {
  cron:        '../tools/cron',
  gateway:     '../tools/gateway',
  filesystem:  '../tools/filesystem',
  tasks:       '../tools/tasks',
  memory:      '../tools/memory',
  applescript: '../tools/applescript',
};

/**
 * BaseAgent — the core agent execution unit.
 *
 * One BaseAgent instance exists per agent definition. It:
 *  1. Assembles the system prompt from definition + channel context + memory
 *  2. Wires up MCP server instances from the definition's `tools` list
 *  3. Delegates to the configured provider's query() async generator
 *  4. Emits EventEmitter events for every significant lifecycle moment
 *  5. Yields text chunks so the runner can stream them to adapters
 *
 * Events emitted:
 *  'step'     { step }        — each intermediate reasoning/tool step
 *  'complete' { sessionKey, response, runId } — run finished successfully
 *  'error'    { sessionKey, error, runId }    — run failed
 *  'aborted'  { sessionKey, runId }           — run cancelled
 */
class BaseAgent extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object}        opts.definition      - Agent JSON definition
   * @param {MemoryManager} opts.memoryManager   - Pre-constructed memory manager
   * @param {Object}        [opts.sessionManager] - Sessions JSONL store (optional)
   * @param {Object}        [opts.runTracker]    - RunTracker for step logging
   * @param {Object}        [opts.mcpTools]      - Pre-wired MCP server map (overrides auto-wire)
   * @param {Object}        [opts.provider]      - Pre-constructed provider (overrides registry)
   */
  constructor({ definition, memoryManager, sessionManager, runTracker, mcpTools, provider } = {}) {
    super();

    if (!definition || !definition.id) {
      throw new Error('BaseAgent requires a definition with an id field');
    }

    this._definition    = definition;
    this._memoryManager = memoryManager || new MemoryManager(definition.id, DATA_DIR);
    this._sessionManager = sessionManager || null;
    this._runTracker    = runTracker || null;

    // Status tracking
    this._status      = 'idle';
    this._currentTask = null;

    // Logger must be created before _wireMcpServers which uses this._log
    this._log = createLogger(`agent:${definition.id}`);

    // Wire MCP servers: prefer injected map, then auto-wire from definition.tools
    if (mcpTools) {
      this._mcpServers = mcpTools;
    } else {
      this._mcpServers = this._wireMcpServers(definition.tools || []);
    }

    // Provider: prefer injected instance, else get from registry with agent config
    this._provider = provider || getProvider(definition.provider || 'claude', {
      model:          definition.model,
      permissionMode: definition.permissionMode || 'bypassPermissions',
      maxTurns:       definition.maxTurns || 50,
    });

    // Allow the provider's model to follow the definition
    if (definition.model) {
      this._provider.setModel(definition.model);
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  /** @returns {Object} The raw agent definition JSON */
  get definition() { return this._definition; }

  /** @returns {string} Agent ID */
  get id() { return this._definition.id; }

  /** @returns {'idle'|'busy'} Current status */
  get status() { return this._status; }

  /** @returns {string|null} Current task description, or null if idle */
  get currentTask() { return this._currentTask; }

  // ---------------------------------------------------------------------------
  // System prompt assembly
  // ---------------------------------------------------------------------------

  /**
   * Build the full system prompt for a run by layering:
   *   1. Agent's base system prompt (from definition)
   *   2. Channel-specific prompt override
   *   3. Channel memory (shared #channel notes)
   *   4. Conversation summary (rolling LLM summary)
   *   5. Agent long-term memory (MEMORY.md + today's log)
   *
   * The channelContext object comes from ChannelContext.buildContext().
   *
   * @param {Object} opts
   * @param {Object} [opts.channelContext={}] - Channel-scoped context object
   * @param {string} [opts.agentMemoryContext=''] - Pre-loaded memory string
   * @returns {string}
   */
  buildSystemPrompt({ channelContext = {}, agentMemoryContext = '' } = {}) {
    const parts = [];

    // 1. Base system prompt
    if (this._definition.systemPrompt) {
      parts.push(this._definition.systemPrompt.trim());
    }

    // 2. Channel-specific override
    if (channelContext.systemPromptOverride) {
      parts.push(`## Channel Context\n${channelContext.systemPromptOverride.trim()}`);
    }

    // 3. Channel memory
    if (channelContext.channelMemory) {
      parts.push(`## Channel Memory\n${channelContext.channelMemory.trim()}`);
    }

    // 4. Conversation summary
    if (channelContext.summary) {
      parts.push(`## Conversation Summary\n${channelContext.summary.trim()}`);
    }

    // 5. Agent long-term memory + today's log
    if (agentMemoryContext) {
      parts.push(`## Agent Memory\n${agentMemoryContext.trim()}`);
    }

    return parts.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Core run
  // ---------------------------------------------------------------------------

  /**
   * Run the agent against a message / task.
   *
   * Yields { type: 'text', content } chunks as the model streams its response.
   * Emits 'step', 'complete', 'error', and 'aborted' EventEmitter events.
   *
   * @param {Object} opts
   * @param {string}   opts.sessionKey      - Conversation key (potatoclaw:...)
   * @param {string}   opts.text            - User message or task description
   * @param {Object}   [opts.image]         - Optional image {mediaType, data}
   * @param {Object}   [opts.channelContext={}] - Channel context from ChannelContext
   * @param {Object}   [opts.taskContext]   - Task metadata (id, title, priority)
   * @param {string}   [opts.runId]         - Associated run ID for step logging
   * @yields {{ type: 'text', content: string }}
   */
  async *run({ sessionKey, text, image, channelContext = {}, taskContext = null, runId = null }) {
    if (!sessionKey) throw new Error('sessionKey is required');
    if (!text)       throw new Error('text is required');

    this._status      = 'busy';
    this._currentTask = taskContext?.title || text.slice(0, 80);

    this._log.info({ sessionKey, runId, task: this._currentTask }, 'Run started');

    let agentMemoryContext = '';
    try {
      agentMemoryContext = await this._memoryManager.getMemoryContext();
    } catch (err) {
      this._log.warn({ err }, 'Failed to load memory context — continuing without it');
    }

    const systemPrompt = this.buildSystemPrompt({ channelContext, agentMemoryContext });

    // Build the prompt payload (string or content block array with image)
    const prompt = this._buildPrompt(text, image);

    // Per-step callback: emit event + log to RunTracker
    const onStep = (step) => {
      const enriched = { ...step, timestamp: new Date().toISOString() };
      this.emit('step', enriched);
      if (runId && this._runTracker) {
        try {
          this._runTracker.addStep(runId, enriched);
        } catch (_) { /* non-fatal */ }
      }
    };

    let fullText   = '';
    let didComplete = false;

    try {
      for await (const chunk of this._provider.query({
        sessionKey,
        prompt,
        systemPrompt,
        mcpServers: this._mcpServers,
        tools:      this._buildAllowedTools(),
        maxTurns:   this._definition.maxTurns || 50,
        image,
        onStep,
      })) {
        if (chunk.type === 'text') {
          fullText += chunk.content;
          yield { type: 'text', content: chunk.content };
          continue;
        }

        if (chunk.type === 'complete') {
          // Provider assembled the full response; use it if we haven't streamed
          if (!fullText) fullText = chunk.content || '';
          continue;
        }

        if (chunk.type === 'done') {
          didComplete = true;
          break;
        }

        if (chunk.type === 'aborted') {
          this._log.info({ sessionKey, runId }, 'Run aborted');
          this.emit('aborted', { sessionKey, runId });
          return;
        }

        if (chunk.type === 'error') {
          throw new Error(chunk.error || 'Provider error');
        }
      }

      if (didComplete || fullText) {
        this._log.info({ sessionKey, runId, chars: fullText.length }, 'Run complete');
        this.emit('complete', { sessionKey, runId, response: fullText });

        // Append a summary entry to the daily log (best-effort)
        if (fullText) {
          this._memoryManager.appendDailyLog(
            `## Run ${runId || sessionKey}\n${fullText.slice(0, 500)}`
          ).catch(() => {});
        }
      }

    } catch (err) {
      this._log.error({ sessionKey, runId, err }, 'Run failed');
      this.emit('error', { sessionKey, runId, error: err });
      throw err;
    } finally {
      this._status      = 'idle';
      this._currentTask = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Abort
  // ---------------------------------------------------------------------------

  /**
   * Abort any in-flight query for the given sessionKey.
   * @param {string} sessionKey
   * @returns {boolean}
   */
  abort(sessionKey) {
    return this._provider.abort(sessionKey);
  }

  // ---------------------------------------------------------------------------
  // MCP server wiring
  // ---------------------------------------------------------------------------

  /**
   * Auto-wire MCP servers from the agent definition's `tools` array.
   * Each tool name maps to a module; we try to require it and call a factory.
   * Unknown or unavailable tools are silently skipped (logged at debug).
   *
   * Composio tools (e.g. "composio:github") are handled separately.
   *
   * @param {string[]} tools
   * @returns {Object} Map of serverName → MCP server instance
   * @private
   */
  _wireMcpServers(tools) {
    const servers = {};

    for (const tool of tools) {
      // ── Composio tools ──────────────────────────────────────────────────
      if (tool.startsWith('composio')) {
        if (!process.env.COMPOSIO_API_KEY) {
          this._log.debug({ tool }, 'COMPOSIO_API_KEY not set — skipping composio tool');
          continue;
        }
        // Composio is registered as a single MCP server regardless of how many
        // composio:xyz tools are listed; we set it up once.
        if (!servers.composio) {
          try {
            const { getComposioMcpServer } = require('@composio/core');
            servers.composio = getComposioMcpServer(process.env.COMPOSIO_API_KEY);
            this._log.debug('Wired composio MCP server');
          } catch (err) {
            this._log.warn({ err: err.message }, 'Failed to wire composio — @composio/core may not be installed');
          }
        }
        continue;
      }

      // ── Built-in tools ───────────────────────────────────────────────────
      const modulePath = TOOL_MODULE_MAP[tool];
      if (!modulePath) {
        this._log.debug({ tool }, 'Unknown tool name — skipping');
        continue;
      }

      try {
        const mod = require(modulePath);
        // Modules may export a factory function or an object directly.
        // Common pattern: module exports { createXxxMcpServer }
        const factory =
          mod.createMcpServer ||
          mod[`create${this._capitalize(tool)}McpServer`] ||
          (typeof mod === 'function' ? mod : null);

        if (factory) {
          servers[tool] = factory({ agentId: this._definition.id, dataDir: DATA_DIR });
        } else if (typeof mod === 'object' && mod !== null) {
          // Module might export the server object directly
          servers[tool] = mod;
        }
        this._log.debug({ tool }, 'Wired MCP server');
      } catch (err) {
        this._log.debug({ tool, err: err.message }, 'Could not load tool module — skipping');
      }
    }

    return servers;
  }

  /**
   * Build the allowed tools list by gathering MCP tool names from wired servers.
   * Falls back to an empty array (let the provider decide) if servers are empty.
   *
   * @returns {string[]}
   * @private
   */
  _buildAllowedTools() {
    // The Claude Agent SDK accepts the special '*' wildcard to allow all tools
    // registered against the provided MCP servers. We return undefined/[] here
    // and let the provider decide — most providers default to allowing all tools
    // when allowedTools is empty.
    return [];
  }

  /**
   * Build the prompt payload. When an image is present we return a content
   * block array so the provider can pass it to the model directly.
   *
   * @param {string}      text
   * @param {Object|null} image  {mediaType, data}
   * @returns {string|Array}
   * @private
   */
  _buildPrompt(text, image) {
    if (!image) return text;

    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType || 'image/jpeg',
          data: image.data,
        },
      },
      { type: 'text', text },
    ];
  }

  /**
   * Capitalize the first letter of a string.
   * @param {string} str
   * @returns {string}
   * @private
   */
  _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

module.exports = BaseAgent;
