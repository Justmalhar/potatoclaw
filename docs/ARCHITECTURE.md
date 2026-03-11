# PotatoClaw — Architecture Reference

**Version:** 2.0
**Date:** 2026-03-12

---

## Module Dependency Graph

```
bin/potatoclaw
    │
    ├── src/core/gateway.js              ← inbound message router
    │       ├── src/adapters/*           ← transport layer (Slack, TG, Discord, WA...)
    │       ├── src/channels/registry.js ← channel → agent lookup
    │       ├── src/channels/context.js  ← per-channel state builder
    │       ├── src/commands/handler.js  ← slash commands
    │       └── src/core/orchestrator.js ← task dispatch + run lifecycle
    │               ├── src/core/agent-registry.js  ← agent definitions
    │               ├── src/core/runner.js           ← per-agent FIFO queue
    │               │       └── src/agents/base-agent.js  ← LLM execution
    │               │               ├── src/providers/*    ← LLM backends
    │               │               ├── src/memory/manager.js
    │               │               ├── src/sessions/manager.js
    │               │               └── src/tools/*        ← MCP servers
    │               ├── src/tasks/manager.js         ← task CRUD + transitions
    │               ├── src/tasks/reporter.js        ← post run summaries to Slack
    │               └── src/runs/tracker.js          ← real-time run state
    │
    └── ui/server.js                     ← Mission Control (Fastify :4200)
            ├── ui/api/agents.js
            ├── ui/api/channels.js
            ├── ui/api/tasks.js
            ├── ui/api/runs.js
            ├── ui/api/secrets.js
            ├── ui/api/memory.js
            ├── ui/api/sessions.js
            ├── ui/api/scheduler.js
            ├── ui/api/logs.js
            └── ui/api/settings.js
```

---

## Agent Lifecycle

```
[Startup]
AgentRegistry.loadAll()          ← reads /data/agents/*.json
    │
    ▼
for each agent definition:
    AgentRunner.init(agentId)    ← creates FIFO queue + agent instance
    ClaudeAgent.init(agentId)    ← loads memory, wires MCP tools

[Runtime — Channel Message]
Message → Gateway → ChannelRegistry.lookup(channelId) → agentId
    → Orchestrator.enqueueChannelMessage(agentId, item)
    → AgentRunner[agentId].enqueue(item)
    → ClaudeAgent[agentId].run(sessionKey, text, channelContext)
    → adapter.sendMessage(channelId, response)

[Runtime — Task Assignment]
Task created/assigned → Orchestrator.onTaskAssigned(task)
    → AgentRunner[agentId].enqueue({type:'task', task})
    → ClaudeAgent[agentId].run(taskSessionKey, task.description)
    → RunTracker.stream(runId, steps) → SSE → UI
    → TaskReporter.postToSlack(channelId, runSummary)

[Shutdown]
AgentRegistry.stopAll()
    → for each runner: flush queue, complete current run, disconnect
```

---

## Channel Context Assembly

Every inbound message builds a context object before the agent runs:

```javascript
{
  // From ChannelRegistry
  agentId: 'engineer',
  systemPromptOverride: 'Focus on the auth module this sprint.',
  toolOverrides: { add: ['composio:github'], remove: [] },

  // From ChannelContext
  summary: '...rolling summary of last 50 messages...',
  recentMessages: [
    { role: 'user', content: '...', timestamp: '...' },
    // last 20 messages
  ],
  channelMemory: '# #engineering Channel Notes\n...',

  // Session
  sessionKey: 'potatoclaw:engineer:slack:channel:C01234567',
  lastRunId: 'run_xyz789'
}
```

The agent's final system prompt is assembled as:
```
[agent.systemPrompt]

## Channel Context
[channelBinding.systemPromptOverride]

## Channel Memory
[channelMemory]

## Conversation Summary
[summary]

## Agent Memory
[MEMORY.md content]

## Today's Log
[YYYY-MM-DD.md content]
```

---

## Task Status Machine

```
          ┌──────────┐
          │ backlog  │
          └────┬─────┘
               │ (operator assigns)
          ┌────▼─────┐
          │   todo   │
          └────┬─────┘
               │ (orchestrator picks up)
          ┌────▼──────────┐
          │  in_progress  │◄──────────────┐
          └────┬──────────┘               │ (retry)
               │                          │
       ┌───────┴──────────┐               │
       │                  │               │
  ┌────▼─────┐      ┌─────▼────┐    ┌────┴─────┐
  │  review  │      │  blocked │    │  failed  │
  └────┬─────┘      └─────┬────┘    └──────────┘
       │                  │ (unblocked)
  ┌────▼─────┐            │
  │   done   │◄───────────┘
  └──────────┘
```

Transitions emitted as events → SSE to UI → kanban card updates in real-time.

---

## Run Step Types

Each step in a run's `steps` array has one of these types:

| Type | Description | Displayed as |
|------|-------------|-------------|
| `thought` | Agent reasoning (pre-tool) | 💭 italic text |
| `tool_call` | MCP tool invocation | 🔧 tool name + inputs |
| `tool_result` | MCP tool response | 📄 collapsed (expandable) |
| `message` | Final text output | 💬 response bubble |
| `error` | Tool or agent error | ⚠️ red error box |
| `approval_request` | Tool approval needed | ⏸️ awaiting approval |
| `approval_response` | User approved/denied | ✅ / ❌ |

---

## Slack Adapter Architecture

Slack is unique because it uses **Socket Mode** (WebSocket-based, no public URL needed) via `@slack/bolt`:

```
Slack API ←──WebSocket──→ SlackAdapter (Bolt app)
                                │
                     ┌──────────┴───────────┐
                     │  Event handlers:      │
                     │  - app.message()      │  ← channel messages
                     │  - app.mention()      │  ← @bot mentions
                     │  - app.command()      │  ← slash commands
                     │  - app.action()       │  ← button clicks
                     └──────────┬───────────┘
                                │
                     ChannelRegistry.lookup(channelId)
                                │
                     Gateway.handleMessage(...)
```

**Socket Mode** means PotatoClaw works behind NAT/firewall with no inbound port requirements — critical for homelab deployments.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `COMPOSIO_API_KEY` | No | Composio integrations |
| `SLACK_BOT_TOKEN` | No | `xoxb-...` from Slack app settings |
| `SLACK_APP_TOKEN` | No | `xapp-...` for Socket Mode |
| `TELEGRAM_BOT_TOKEN` | No | @BotFather token |
| `DISCORD_BOT_TOKEN` | No | Discord developer portal |
| `UI_PASSWORD` | Recommended | UI auth + secrets encryption key |
| `LOG_LEVEL` | No | `info` (default) |
| `DATA_DIR` | No | `/data` (default) |
| `GATEWAY_PORT` | No | `4096` (default) |
| `UI_PORT` | No | `4200` (default) |

All runtime secrets (adapter tokens, API keys) can also be managed via the Secrets page in Mission Control — they are stored encrypted and loaded at runtime, overriding env vars.

---

## Key Design Principles

1. **One file per adapter** — add a new messaging platform by dropping a file in `src/adapters/`
2. **One JSON per agent** — add a new agent by creating a file in `/data/agents/`
3. **One binding per channel** — any channel maps to exactly one agent (no ambiguity)
4. **Per-agent isolation** — memory, workspace, and sessions are fully namespaced by agentId
5. **Task-first** — every significant agent action should be traceable to a task and a run
6. **UI reflects live state** — SSE ensures the kanban, run viewer, and agent status are always current
7. **No secrets in source** — `.env.example` only; all real secrets go through the encrypted store

---

## Comparison: secure-openclaw → potatoclaw

| Aspect | secure-openclaw | potatoclaw |
|--------|----------------|------------|
| Agents | 1 global | N named agents, each isolated |
| Memory | 1 global MEMORY.md | Per-agent + per-channel memory |
| Session keys | `agent:<id>:<platform>:<type>:<chatId>` | `potatoclaw:<agentId>:<platform>:<type>:<channelId>` |
| Channel routing | All messages → single agent | Channel → agent lookup via registry |
| Task system | None | Jira-style kanban with run tracking |
| Orchestrator | None | Parallel multi-agent task dispatch |
| Inter-agent | Not possible | Agent A can spawn tasks for Agent B |
| Slack support | Via Composio tools only | Native Bolt SDK; each #channel = agent |
| Discord support | None | discord.js adapter |
| Web UI | None | Full Mission Control (kanban, runs, memory, secrets, ...) |
| Run visibility | Terminal only | Live step viewer in UI + Slack thread |
| Secrets | Plain `.env` | AES-256-GCM encrypted in Docker volume |
| Config | `config.js` (hardcoded) | `/data/agents/*.json` (UI-editable) |
| Source layout | Flat root | `src/` layered by concern |
| Storage base | `~/secure-openclaw` | `/data` (Docker volume) |
| Ports | 4096 only | 4096 (gateway) + 4200 (UI) |
