# 🥔 PotatoClaw

Self-hosted autonomous multi-agent company platform. Run named AI agents that live in your Slack, Telegram, Discord, and other messaging channels — each with their own memory, task queue, and toolset. Includes a Mission Control web UI for managing everything.

## Features

- **Multi-agent registry** — N named agents, each with isolated memory, sessions, and MCP tool configuration
- **Channel-to-agent binding** — any messaging channel maps to exactly one agent
- **Task kanban** — SQLite-backed task board (backlog → todo → in_progress → review → done/blocked)
- **Run tracking** — every agent execution logged step-by-step, streamed live to the UI via SSE
- **Orchestrator** — parallel task dispatch, inter-agent subtask creation via MCP tools
- **Mission Control UI** — dark-theme SPA with kanban, agent dashboard, run timeline, memory editor, live logs
- **Platform adapters** — Slack (Socket Mode), Telegram, Discord, WhatsApp (Baileys), Signal (signal-cli), iMessage (imsg)
- **Encrypted secrets** — AES-256-GCM store for API keys at rest
- **Dockerized** — single `docker compose up` gets everything running

## Quick Start

### Docker (recommended)

```bash
cp .env.example .env
# Fill in at minimum: ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, SLACK_APP_TOKEN
docker compose -f docker/docker-compose.yml up -d
```

Open Mission Control at http://localhost:4200

### Local development

```bash
npm install
cp .env.example .env
# Edit .env
npm start
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `SLACK_BOT_TOKEN` | For Slack | Bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | For Slack | Socket Mode app token (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | For Slack | Signing secret for verification |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from @BotFather |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token from Discord Developer Portal |
| `UI_PASSWORD` | Recommended | Password for Mission Control (basic auth) |
| `LOG_LEVEL` | No | `trace`/`debug`/`info`/`warn`/`error` (default: `info`) |
| `DATA_DIR` | No | Data directory (default: `/data` in Docker, `~/.potatoclaw` locally) |
| `GATEWAY_PORT` | No | Gateway HTTP port (default: `4096`) |
| `UI_PORT` | No | Mission Control UI port (default: `4200`) |

See `.env.example` for all options with descriptions.

## Project Structure

```
potatoclaw/
├── bin/potatoclaw          # CLI entry point
├── config/
│   ├── default.js          # Config defaults
│   └── schema.js           # Zod validation schemas
├── docker/
│   ├── Dockerfile          # Multi-stage Docker build
│   ├── docker-compose.yml  # Compose config
│   └── entrypoint.sh       # Container startup script
├── docs/
│   ├── PRD.md              # Product requirements
│   ├── ARCHITECTURE.md     # Architecture overview
│   └── SYSTEM_DESIGN.md    # System design deep-dive
├── src/
│   ├── adapters/           # Platform adapters (Slack, Telegram, Discord, ...)
│   ├── agents/
│   │   ├── base-agent.js   # BaseAgent with system prompt layering
│   │   └── definitions/    # Built-in agent JSON configs
│   ├── channels/           # Channel registry, context, summarizer
│   ├── commands/           # Slash command handler
│   ├── core/
│   │   ├── app.js          # Bootstrap wiring
│   │   ├── gateway.js      # Message routing gateway
│   │   ├── orchestrator.js # Task/message dispatch
│   │   └── runner.js       # Per-agent FIFO queue
│   ├── memory/             # Per-agent memory manager
│   ├── providers/          # Claude, Opencode provider wrappers
│   ├── runs/               # Run store + tracker
│   ├── sessions/           # JSONL session manager
│   ├── tasks/              # Task store, manager, reporter
│   ├── tools/              # MCP tools (cron, filesystem, gateway, tasks, memory, applescript)
│   └── utils/              # Logger, secrets, helpers
├── ui/
│   ├── api/                # Fastify API route modules
│   ├── public/             # Static SPA (HTML/CSS/JS)
│   │   └── pages/          # Per-page JS modules
│   └── server.js           # Fastify UI server
└── tests/                  # 745 Jest tests across 42 suites
```

## Built-in Agents

Three agent definitions ship out of the box (in `src/agents/definitions/`):

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| `engineer` | claude-opus-4-6 | filesystem, cron, gateway, tasks, memory | Software development tasks |
| `researcher` | claude-sonnet-4-6 | filesystem, gateway, tasks, memory | Research and analysis |
| `assistant` | claude-sonnet-4-6 | cron, gateway, tasks, memory | General assistance |

Create custom agents via the UI or by POSTing to `/api/agents`.

## CLI

```bash
potatoclaw start          # Start the full stack
potatoclaw chat           # Interactive terminal chat
potatoclaw chat --agent researcher  # Chat with a specific agent
potatoclaw agents list    # List all agents
potatoclaw tasks list     # Show recent tasks
potatoclaw ui             # Open Mission Control in browser
potatoclaw setup          # Interactive setup wizard
```

## MCP Tools Available to Agents

| Tool module | What it provides |
|---|---|
| `filesystem` | read/write/search files in agent workspace |
| `tasks` | create/update/assign tasks, create subtasks |
| `memory` | read/write agent and channel memory |
| `gateway` | send messages across platforms, broadcast |
| `cron` | schedule delayed, recurring, or cron jobs |
| `applescript` | macOS automation (macOS only) |

## Mission Control UI Pages

- **Dashboard** — live stats, active agent queue, SSE event feed
- **Kanban** — drag-drop task board with real-time updates
- **Agents** — manage agent definitions, memory, model selection
- **Runs** — step-by-step execution timeline with tool call details
- **Channels** — bind messaging channels to agents
- **Memory** — view/edit per-agent MEMORY.md and daily logs
- **Sessions** — paginated conversation transcripts
- **Scheduler** — manage cron/delayed/recurring jobs
- **Secrets** — manage encrypted API keys
- **Logs** — live SSE log stream with level filtering
- **Settings** — runtime configuration

## Session Keys

Session continuity follows the format:
```
potatoclaw:<agentId>:<platform>:<type>:<channelId>
```

## Development

```bash
# Run tests
npm test

# Run a specific test file
npx jest tests/core/gateway.test.js

# Run with coverage
npx jest --coverage
```

All 745 tests across 42 suites should pass.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design.

Key flows:
1. Message arrives on any platform adapter
2. Gateway routes it to the bound agent via `ChannelRegistry`
3. Orchestrator enqueues it on the agent's `AgentRunner`
4. Runner drives `BaseAgent.run()` which calls the provider (Claude/Opencode)
5. Agent streams response back through the adapter
6. Steps are logged to `RunTracker` and streamed to Mission Control via SSE

## License

MIT
