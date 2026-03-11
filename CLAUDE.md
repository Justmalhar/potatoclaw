# PotatoClaw — Claude Code Context

## What this project is

Self-hosted autonomous multi-agent company platform. N named agents connect to Slack/Telegram/Discord/WhatsApp/Signal/iMessage. Each agent has isolated memory, sessions, and MCP tools. A Mission Control web UI (Fastify + vanilla JS SPA) manages everything. All CommonJS, no TypeScript.

## Architecture in one sentence

`Gateway` receives messages → routes via `ChannelRegistry` → `Orchestrator` enqueues on agent's `AgentRunner` → `BaseAgent.run()` drives provider (Claude or Opencode) → streams response back through the adapter.

## Key conventions

- **All CommonJS** — `require()`/`module.exports` everywhere. No ESM except `@anthropic-ai/claude-agent-sdk` (ESM, must be `jest.mock()`'d in tests).
- **Data directory** — resolved in order: `DATA_DIR` env → `/data` (if exists) → `~/.potatoclaw`
- **Session keys** — `potatoclaw:<agentId>:<platform>:<type>:<channelId>`
- **Task status machine** — `backlog → todo → in_progress → review → done | blocked`
- **Run steps** — types: `thought`, `tool_call`, `tool_result`, `message`, `error`
- **Provider interface** — `query()` is an async generator yielding `{ type, content, tool?, input? }`

## Project structure

```
src/
  adapters/     platform adapters (Slack, Telegram, Discord, WhatsApp, Signal, iMessage)
  agents/       BaseAgent + JSON definitions
  channels/     ChannelRegistry, ChannelContext, Summarizer
  commands/     13 slash commands (/status, /task, /memory, etc.)
  core/         Gateway, Orchestrator, AgentRunner, AgentRegistry
  memory/       MemoryManager (MEMORY.md + daily logs per agent)
  providers/    ClaudeProvider, OpencodeProvider, BaseProvider, registry
  runs/         RunStore (file-based), RunTracker (EventEmitter)
  sessions/     SessionManager (JSONL per agent/key)
  tasks/        TaskStore (SQLite), TaskManager (EventEmitter), TaskReporter
  tools/        MCP tools: cron, filesystem, gateway, tasks, memory, applescript
  utils/        logger (pino), secrets (AES-256-GCM), helpers
ui/
  api/          Fastify route modules (agents, channels, tasks, runs, secrets, ...)
  public/       Static SPA — index.html, styles.css, app.js, pages/
  server.js     Fastify server with SSE /api/events
config/
  default.js    Config defaults
  schema.js     Zod schemas
```

## Testing

```bash
npm test                          # all 745 tests
npx jest tests/core/gateway.test.js   # single file
npx jest --runInBand              # sequential (required — default)
```

- Jest config is in `jest.config.js` (not in package.json)
- `--runInBand` is set in the config; SQLite and temp-dir tests require sequential execution
- ESM modules (`@anthropic-ai/claude-agent-sdk`, `@slack/bolt`, `discord.js`) must be mocked at the top of test files
- `better-sqlite3` tests monkey-patch the module to use `:memory:` databases
- UI API tests use Fastify's `server.inject()` — no real HTTP needed

## Important gotchas

- `AgentRunner` constructor accepts both `{ agent }` object and `(agentId, agent)` positional args
- `ChannelRegistry.bind()` accepts string shorthand: `bind(platform, channelId, 'agentId')` or object
- `RunStore.list()` and `TaskStore.list()` return arrays directly (not `{ runs, total }`)
- `AgentRegistry._writeDefinition()` uses a module-level `USER_AGENTS_DIR` constant, not `this._dataDir`
- `ui/api/channels.js`, `runs.js`, `sessions.js`, `memory.js`, `settings.js` all read `DATA_DIR` at module load time — set `process.env.DATA_DIR` before `require()`ing them in tests

## Dependencies to be aware of

- `@anthropic-ai/claude-agent-sdk` — ESM, the primary AI provider
- `@anthropic-ai/sdk` — optional, used as fallback in summarizer and CLI chat
- `@opencode-ai/sdk` — optional, for Opencode provider support
- `better-sqlite3` — native bindings, requires Node ≥ 20 with matching native module
- `@slack/bolt` — Slack Socket Mode adapter
- `@whiskeysockets/baileys` — WhatsApp via unofficial API (QR auth)
