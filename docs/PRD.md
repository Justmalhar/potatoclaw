# PotatoClaw — Product Requirements Document

**Version:** 2.0
**Date:** 2026-03-12
**Status:** Draft

---

## 1. Vision

PotatoClaw is a self-hosted, Dockerized **autonomous multi-agent company** — a platform where you define specialized AI agents, bind them to messaging channels, assign them tasks, and let them operate in parallel with full observability from a web-based Mission Control.

It is a ground-up rewrite of [secure-openclaw](https://github.com/ComposioHQ/secure-openclaw) extended with:
- A multi-agent registry (each agent has its own identity, system prompt, memory, and tools)
- Channel-agent binding (each Slack/Telegram/Discord channel = isolated agent context)
- A task management system (Jira/Trello-style kanban, create tasks → assign to agents)
- A Mission Control web UI (kanban board, live run details, agent status panel)
- An orchestrator that coordinates parallel execution and inter-agent handoffs

---

## 2. Problem Statement

Managing multiple AI workflows requires:

- **Context isolation** — a coding agent and a marketing agent should not share memory or system prompts
- **Task tracking** — knowing what each agent is working on, what it completed, and what failed
- **Observability** — seeing tool calls, decisions, and outputs without SSH-ing into a server
- **Coordination** — decomposing large goals into subtasks and routing them to the right agent
- **Communication** — having agents report progress in the right Slack channel automatically

None of this exists in secure-openclaw. It has one global agent with shared memory and no task system.

---

## 3. Core Concepts

### 3.1 Agent
A named, configured AI worker with its own:
- **Identity** — id, name, avatar, description
- **System prompt** — role-specific instructions (e.g. "You are a senior software engineer...")
- **Model** — which LLM to use (Claude Opus, Sonnet, Haiku, etc.)
- **Tools** — which MCP tools are available (e.g. coding agent gets filesystem + GitHub; marketing agent gets Gmail + Google Sheets)
- **Memory namespace** — isolated long-term memory and daily logs
- **Channel bindings** — which platform channels this agent listens to

### 3.2 Channel
A messaging channel (Slack #channel, Telegram group, Discord channel) bound to exactly one agent.

Each channel has its own:
- **Agent binding** — which agent handles messages here
- **System prompt override** — additional instructions specific to this channel
- **Memory** — channel-scoped notes separate from agent global memory
- **Summary** — rolling LLM-generated summary of the conversation history
- **Recent messages** — sliding window (last N messages) passed as context
- **Tools** — can restrict or extend the bound agent's tool set per channel

### 3.3 Task
A unit of work with Jira-like structure:
- **id, title, description**
- **status**: `backlog → todo → in_progress → review → done | blocked`
- **priority**: `critical | high | medium | low`
- **assignedAgentId** — which agent owns it
- **channelId** — which Slack channel receives run updates
- **runHistory** — list of agent execution runs for this task
- **tags, due date, dependencies** (links to other tasks)

### 3.4 Run
A single agent execution event attached to a task:
- **id, taskId, agentId**
- **status**: `queued → running → completed | failed`
- **startedAt, completedAt**
- **steps** — array of `{type: 'thought'|'tool_call'|'tool_result'|'message', content, timestamp}`
- **output** — final response text
- **tokensUsed, durationMs**

Run details are posted as a thread in the task's bound Slack channel.

### 3.5 Orchestrator
The top-level coordinator that:
- Watches the task queue for new/assigned tasks
- Routes tasks to the correct agent runner
- Manages parallel execution (multiple agents running concurrently)
- Handles inter-agent handoffs (Agent A creates a subtask for Agent B)
- Posts run summaries to Slack channels

---

## 4. Goals

| # | Goal |
|---|------|
| G1 | Single `docker compose up` deployment |
| G2 | Define unlimited named agents via UI — each isolated identity, prompt, tools, memory |
| G3 | Bind any messaging channel to any agent — channel-scoped context, summary, memory |
| G4 | Slack as primary work platform — each #channel = agent workspace |
| G5 | Task kanban in Mission Control UI — create, assign, track across all agents |
| G6 | Live run details — every tool call, thought, and output visible in UI and posted to Slack |
| G7 | Parallel execution — multiple agents run concurrently without blocking each other |
| G8 | Inter-agent tasks — Agent A can spawn subtasks for Agent B |
| G9 | Secrets + MCP management in UI — no config file editing required |
| G10 | Full audit trail — every run is persisted and searchable |

---

## 5. Non-Goals

- Building a new LLM or inference engine
- Mobile native apps
- Multi-tenant SaaS (single-user homelab tool)
- Real-time voice/video

---

## 6. User Stories

**As the operator, I want to:**
- Define a "Software Engineer" agent with Claude Opus, filesystem + GitHub tools, and a coding system prompt — and bind it to #engineering in Slack
- Define a "Research" agent with web search + Google Sheets tools — and bind it to #research
- Create a task "Refactor auth module" in the kanban, assign to the Engineer agent, and watch it run
- See a live feed of every tool call the agent makes in the Mission Control UI
- Get a Slack thread in #engineering with the run summary when it completes
- Have the Research agent create a subtask for the Engineer agent when it finds something actionable
- Manage all API keys from the Secrets page without touching `.env` files
- Add a custom MCP server (e.g. a company internal API) from the Skills page

---

## 7. Features

### 7.1 Agent Registry

| Feature | Description |
|---------|-------------|
| Create/edit/delete agents | Via UI — name, description, system prompt, model, tools, avatar |
| Isolated memory | Each agent has `memory/<agentId>/MEMORY.md` + daily logs |
| Isolated sessions | Transcripts namespaced under `sessions/<agentId>/` |
| Model selection per agent | Different agents can use different Claude models |
| Tool allowlist per agent | Fine-grained MCP tool access control |
| Agent status | idle / busy / error — visible in Mission Control |

### 7.2 Channel Bindings

| Feature | Description |
|---------|-------------|
| Bind channel to agent | Any platform channel → any agent |
| Channel system prompt | Overrides or appends to agent's base system prompt |
| Rolling summary | Auto-generated conversation summary updated every N messages |
| Recent message window | Last N messages always included in context |
| Channel memory | Separate from agent global memory; channel-specific notes |
| Per-channel tool override | Add or restrict tools for a specific channel |

### 7.3 Messaging Adapters

| Adapter | Priority | Notes |
|---------|----------|-------|
| Slack | **Primary** | Bolt SDK; each #channel = agent binding; slash commands |
| Telegram | High | Per-group and per-DM agent binding |
| Discord | High | discord.js; per-channel agent binding |
| WhatsApp | Medium | QR auth via Baileys |
| Signal | Low | signal-cli subprocess |
| iMessage | Optional | macOS only |

### 7.4 Task Management

| Feature | Description |
|---------|-------------|
| Kanban board | Columns: Backlog, Todo, In Progress, Review, Done, Blocked |
| Create task | Title, description, priority, agent, channel, due date, tags |
| Assign to agent | Task enters agent's work queue |
| Task dependencies | Block task B until task A is done |
| Subtasks | Nested tasks; agents can create subtasks via tools |
| Run history | Every agent execution run linked to task |
| Slack reporting | Run start/end posted as thread in task's channel |

### 7.5 Orchestrator

| Feature | Description |
|---------|-------------|
| Task dispatch | Route assigned tasks to correct agent runner |
| Parallel execution | Multiple agent runners active simultaneously |
| Inter-agent handoff | Agent A spawns task for Agent B via MCP tool |
| Priority queue | Higher-priority tasks run first within each agent's queue |
| Failure handling | Failed runs flagged, optional auto-retry |

### 7.6 Mission Control UI (Web Dashboard)

| Page | Description |
|------|-------------|
| **Dashboard** | Live: active agents, running tasks, queue depth, recent events |
| **Kanban** | Full task board; drag-drop status changes; click card → run details |
| **Agents** | List all agents; create/edit/delete; view current status and active task |
| **Channels** | List all channel bindings; configure per-channel context and tools |
| **Runs** | All run history; filter by agent/task/status; full step-by-step log viewer |
| **Memory** | Per-agent MEMORY.md editor + daily log browser + search |
| **Sessions** | Transcript viewer per channel/session |
| **Scheduler** | Cron job management; create/cancel; execution history |
| **Skills / MCPs** | Register custom MCP servers; toggle Composio |
| **Secrets** | Encrypted key/value store; add/edit/delete API keys |
| **Logs** | Live SSE log stream with level filter |
| **Settings** | Global config (default model, provider, maxTurns, etc.) |

### 7.7 MCP Tools Available to Agents

**Built-in:**
- `cron` — scheduling (delayed, recurring, cron expression)
- `gateway` — send_message, broadcast, list_platforms
- `filesystem` — read/write/search files in agent workspace
- `tasks` — create_task, update_task_status, create_subtask, list_my_tasks
- `memory` — read/write agent memory + channel memory
- `applescript` — macOS automation (optional)

**External:**
- Composio — 500+ app integrations (Gmail, GitHub, Google Sheets, Notion, Slack, etc.)
- Custom MCPs — any HTTP MCP server registered via UI

### 7.8 CLI

```
potatoclaw                      # Interactive menu
potatoclaw start                # Start gateway + orchestrator + UI
potatoclaw chat [--agent <id>]  # Terminal chat with specific agent
potatoclaw setup                # Adapter setup wizard
potatoclaw ui                   # Open Mission Control in browser
potatoclaw agents list          # List all agents
potatoclaw tasks list           # List all tasks
```

---

## 8. Slack Integration (Primary Platform)

Slack is the primary work surface:

- Each `#channel` maps to one agent via the Channels page in UI
- Agents respond in-channel to messages
- Task run summaries are posted as threaded replies
- Slash commands: `/new`, `/status`, `/task create <title>`, `/assign <@agent>`, `/runs`
- Agent can use Composio Slack tools to post proactively to any channel

---

## 9. Security

| Concern | Approach |
|---------|----------|
| Secrets | AES-256-GCM encrypted in `/data/secrets.enc` |
| Container | Non-root user `claw` |
| Adapter access | Per-adapter allowlists (users + channels) |
| Agent sandboxing | Each agent has its own filesystem workspace under `/data/workspaces/<agentId>/` |
| UI auth | HTTP Basic Auth or session-based password (configurable) |
| Agent tool permissions | Per-agent tool allowlist; no cross-agent workspace access by default |

---

## 10. Milestones

| # | Milestone | Deliverables |
|---|-----------|-------------|
| M0 | **Scaffold + Docs** | Repo structure, Docker skeleton, docs |
| M1 | **Core Gateway + Single Agent** | Gateway, Claude provider, memory, sessions, Slack adapter |
| M2 | **Agent Registry** | Multi-agent registry, per-agent memory/workspace, channel bindings |
| M3 | **Task System** | Task store, kanban data model, orchestrator, task MCP tools |
| M4 | **Mission Control UI** | Dashboard, Kanban, Agents, Runs, Channels pages |
| M5 | **More Adapters** | Telegram, Discord, WhatsApp adapters |
| M6 | **Full UI** | Secrets, Skills, Memory, Sessions, Scheduler, Logs, Settings pages |
| M7 | **Polish** | Inter-agent tasks, auto-summaries, priority queuing, CI/CD, README |
