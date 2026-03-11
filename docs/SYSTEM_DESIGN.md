# PotatoClaw — System Design

**Version:** 2.0
**Date:** 2026-03-12

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Docker Container                                  │
│                                                                              │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Slack      │  │ Telegram │  │ Discord  │  │WhatsApp  │  │ Signal   │   │
│  │  Adapter    │  │ Adapter  │  │ Adapter  │  │ Adapter  │  │ Adapter  │   │
│  └──────┬──────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│         └──────────────┴─────────────┴──────────────┴─────────────┘         │
│                                       │                                      │
│                         ┌─────────────▼──────────────┐                      │
│                         │          Gateway            │                      │
│                         │  - Security filter          │                      │
│                         │  - Channel → Agent lookup   │                      │
│                         │  - Slash command dispatch   │                      │
│                         └─────────────┬──────────────┘                      │
│                                       │                                      │
│                         ┌─────────────▼──────────────┐                      │
│                         │        Orchestrator         │                      │
│                         │  - Task queue management    │                      │
│                         │  - Agent dispatch           │                      │
│                         │  - Parallel execution       │                      │
│                         │  - Inter-agent handoffs     │                      │
│                         │  - Run lifecycle tracking   │                      │
│                         └─────────────┬──────────────┘                      │
│                                       │                                      │
│         ┌──────────────────┬──────────┴──────────┬───────────────────┐      │
│         │                  │                      │                   │      │
│  ┌──────▼──────┐   ┌───────▼──────┐   ┌──────────▼────┐   ┌─────────▼──┐   │
│  │  Agent:     │   │  Agent:      │   │  Agent:        │   │  Agent:    │   │
│  │  engineer   │   │  researcher  │   │  marketer      │   │  analyst   │   │
│  │             │   │              │   │                │   │            │   │
│  │ ┌─────────┐ │   │ ┌──────────┐ │   │ ┌────────────┐ │   │ ┌────────┐ │   │
│  │ │ Runner  │ │   │ │  Runner  │ │   │ │   Runner   │ │   │ │ Runner │ │   │
│  │ │ (queue) │ │   │ │  (queue) │ │   │ │   (queue)  │ │   │ │(queue) │ │   │
│  │ └────┬────┘ │   │ └────┬─────┘ │   │ └─────┬──────┘ │   │ └───┬───┘ │   │
│  │      │      │   │      │       │   │        │        │   │     │     │   │
│  │ ┌────▼────┐ │   │ ┌────▼─────┐ │   │ ┌──────▼─────┐ │   │ ┌───▼───┐ │   │
│  │ │ClaudeAg.│ │   │ │ClaudeAg. │ │   │ │  ClaudeAg. │ │   │ │Claude │ │   │
│  │ │ Opus    │ │   │ │ Sonnet   │ │   │ │  Haiku     │ │   │ │ Opus  │ │   │
│  │ └────┬────┘ │   │ └──────────┘ │   │ └────────────┘ │   │ └───────┘ │   │
│  │      │      │   │              │   │                │   │           │   │
│  │ memory/     │   │ memory/      │   │ memory/        │   │ memory/   │   │
│  │ engineer/   │   │ researcher/  │   │ marketer/      │   │ analyst/  │   │
│  │ workspace/  │   │ workspace/   │   │ workspace/     │   │ workspace/│   │
│  │ engineer/   │   │ researcher/  │   │ marketer/      │   │ analyst/  │   │
│  └─────────────┘   └──────────────┘   └────────────────┘   └───────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                   MCP Tools (shared + per-agent)                     │    │
│  │  cron | gateway | filesystem | tasks | memory | composio | custom   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                Mission Control UI  (port 4200)                       │    │
│  │  Dashboard | Kanban | Agents | Channels | Runs | Memory | Secrets   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  HTTP :4096  ← Gateway health check + WhatsApp QR                           │
│  HTTP :4200  ← Mission Control UI + REST API + SSE                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Layout

```
potatoclaw/
│
├── bin/
│   └── potatoclaw                    # CLI entry point (executable)
│
├── src/
│   ├── core/
│   │   ├── gateway.js                # Inbound message router, security filter
│   │   ├── orchestrator.js           # Task dispatch, parallel execution, run lifecycle
│   │   ├── agent-registry.js         # Load, cache, and manage agent definitions
│   │   └── runner.js                 # Per-agent FIFO queue executor
│   │
│   ├── agents/
│   │   ├── base-agent.js             # Claude agent: memory, MCP wiring, system prompt builder
│   │   └── definitions/              # JSON/JS agent definition files (user-created via UI)
│   │       ├── engineer.json
│   │       ├── researcher.json
│   │       └── ...
│   │
│   ├── channels/
│   │   ├── registry.js               # Channel → agent binding store
│   │   ├── context.js                # Per-channel: summary, recent msgs, memory, prompt override
│   │   └── summarizer.js             # LLM-based rolling summary generator
│   │
│   ├── tasks/
│   │   ├── store.js                  # Persistent task storage (JSON/SQLite)
│   │   ├── manager.js                # CRUD, status transitions, dependency graph
│   │   └── reporter.js               # Post run summaries to Slack channels
│   │
│   ├── runs/
│   │   ├── store.js                  # Persist run records + step logs
│   │   └── tracker.js                # Real-time run state (SSE events to UI)
│   │
│   ├── adapters/
│   │   ├── base.js                   # BaseAdapter interface
│   │   ├── slack.js                  # Bolt SDK; channel → agent lookup
│   │   ├── telegram.js
│   │   ├── discord.js
│   │   ├── whatsapp.js
│   │   ├── signal.js
│   │   └── imessage.js
│   │
│   ├── providers/
│   │   ├── base.js                   # BaseProvider interface
│   │   ├── claude.js                 # Anthropic Claude Agent SDK
│   │   ├── opencode.js               # Opencode SDK
│   │   └── index.js                  # Registry + caching
│   │
│   ├── tools/
│   │   ├── cron.js                   # MCP: scheduling
│   │   ├── gateway.js                # MCP: send_message, broadcast
│   │   ├── filesystem.js             # MCP: read/write/search agent workspace
│   │   ├── tasks.js                  # MCP: create_task, update_status, create_subtask
│   │   ├── memory.js                 # MCP: read/write agent + channel memory
│   │   └── applescript.js            # MCP: macOS automation (optional)
│   │
│   ├── memory/
│   │   └── manager.js                # Per-agent MEMORY.md + daily logs
│   │
│   ├── sessions/
│   │   └── manager.js                # Per-channel JSONL transcript storage
│   │
│   ├── commands/
│   │   └── handler.js                # Slash command dispatch
│   │
│   └── utils/
│       ├── logger.js                 # pino structured logger
│       ├── secrets.js                # AES-256-GCM encrypted secret store
│       └── helpers.js
│
├── config/
│   ├── default.js                    # Default config values
│   └── schema.js                     # Zod schema validation
│
├── ui/
│   ├── server.js                     # Fastify server: REST API + SSE + static files
│   ├── api/
│   │   ├── agents.js                 # CRUD agent definitions
│   │   ├── channels.js               # Channel binding CRUD + context viewer
│   │   ├── tasks.js                  # Task CRUD + status transitions
│   │   ├── runs.js                   # Run history + live step stream
│   │   ├── secrets.js                # Encrypted secret store CRUD
│   │   ├── memory.js                 # Per-agent memory read/write
│   │   ├── sessions.js               # Transcript viewer
│   │   ├── scheduler.js              # Cron job management
│   │   ├── logs.js                   # SSE live log stream
│   │   └── settings.js               # Global config read/write
│   └── public/
│       ├── index.html                # SPA shell
│       ├── pages/
│       │   ├── dashboard.js          # Live system overview
│       │   ├── kanban.js             # Task board (drag-drop)
│       │   ├── agents.js             # Agent list + editor
│       │   ├── channels.js           # Channel binding manager
│       │   ├── runs.js               # Run history + step viewer
│       │   ├── memory.js             # Memory browser + editor
│       │   ├── sessions.js           # Transcript viewer
│       │   ├── scheduler.js          # Cron job manager
│       │   ├── secrets.js            # Secret manager
│       │   ├── skills.js             # MCP registration
│       │   ├── logs.js               # Live log viewer
│       │   └── settings.js           # Global settings
│       ├── components/
│       │   ├── kanban-board.js       # Kanban board component
│       │   ├── run-detail.js         # Step-by-step run viewer
│       │   ├── agent-card.js         # Agent status card
│       │   ├── sidebar.js            # Navigation
│       │   └── sse-stream.js         # SSE client helper
│       └── styles.css
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── entrypoint.sh
│
└── docs/
    ├── PRD.md
    ├── SYSTEM_DESIGN.md
    └── ARCHITECTURE.md
```

---

## 3. Data Models

### 3.1 Agent Definition

```json
{
  "id": "engineer",
  "name": "Software Engineer",
  "description": "Full-stack coding agent",
  "avatar": "💻",
  "model": "claude-opus-4-6",
  "provider": "claude",
  "systemPrompt": "You are a senior software engineer...",
  "tools": ["filesystem", "cron", "gateway", "tasks", "memory", "composio:github", "composio:linear"],
  "maxTurns": 100,
  "permissionMode": "bypassPermissions",
  "workspacePath": "/data/workspaces/engineer",
  "createdAt": "2026-03-12T00:00:00Z",
  "updatedAt": "2026-03-12T00:00:00Z"
}
```

### 3.2 Channel Binding

```json
{
  "id": "slack:C01234567",
  "platform": "slack",
  "channelId": "C01234567",
  "channelName": "#engineering",
  "agentId": "engineer",
  "systemPromptOverride": "Focus on the auth module refactor this sprint.",
  "toolOverrides": {
    "add": ["composio:github"],
    "remove": []
  },
  "recentMessageWindow": 20,
  "summaryEnabled": true,
  "summaryIntervalMessages": 50,
  "memory": "/data/channel-memory/slack-C01234567.md",
  "createdAt": "2026-03-12T00:00:00Z"
}
```

### 3.3 Task

```json
{
  "id": "task_abc123",
  "title": "Refactor auth module",
  "description": "Extract JWT logic into a standalone service...",
  "status": "in_progress",
  "priority": "high",
  "assignedAgentId": "engineer",
  "channelId": "slack:C01234567",
  "tags": ["backend", "auth", "refactor"],
  "dueDate": "2026-03-20T00:00:00Z",
  "parentTaskId": null,
  "subtaskIds": ["task_def456"],
  "dependencies": [],
  "runHistory": ["run_xyz789"],
  "createdBy": "user",
  "createdAt": "2026-03-12T00:00:00Z",
  "updatedAt": "2026-03-12T10:00:00Z"
}
```

### 3.4 Run

```json
{
  "id": "run_xyz789",
  "taskId": "task_abc123",
  "agentId": "engineer",
  "channelId": "slack:C01234567",
  "status": "completed",
  "startedAt": "2026-03-12T10:00:00Z",
  "completedAt": "2026-03-12T10:05:32Z",
  "durationMs": 332000,
  "tokensUsed": 24800,
  "steps": [
    {"type": "thought", "content": "Let me read the auth module first...", "timestamp": "..."},
    {"type": "tool_call", "tool": "filesystem.read_file", "input": {"path": "src/auth/index.js"}, "timestamp": "..."},
    {"type": "tool_result", "content": "// auth module...", "timestamp": "..."},
    {"type": "message", "content": "I've refactored the auth module...", "timestamp": "..."}
  ],
  "output": "I've refactored the auth module into a standalone JWT service...",
  "error": null
}
```

---

## 4. Data Flow

### 4.1 Channel Message → Agent Response

```
[User sends message in #engineering on Slack]
          │
          ▼
SlackAdapter.onMessage(event)
          │
          ├─ shouldRespond()? ──No──▶ drop
          │
          ▼
Gateway.handleMessage(platform, channelId, userId, text, image)
          │
          ├─ slash command?     ──Yes──▶ CommandHandler.handle()
          ├─ pendingApproval?   ──Yes──▶ resolveApproval()
          │
          ▼
ChannelRegistry.getBinding(platform, channelId)
          │ → { agentId: 'engineer', systemPromptOverride, recentMessageWindow, ... }
          │
          ▼
ChannelContext.buildContext(channelId)
          │ → { summary, recentMessages, channelMemory, promptOverride }
          │
          ▼
Orchestrator.enqueueChannelMessage(agentId, {
  sessionKey, text, image, adapter, chatId, channelContext
})
          │
          ▼
AgentRunner[engineer].enqueue(item)    ← per-agent FIFO queue
          │
          ▼
ClaudeAgent[engineer].run(sessionKey, text, channelContext)
          │
          ├─ buildSystemPrompt(agent.systemPrompt + channelContext.promptOverride)
          ├─ loadMemory(agent.memoryPath + channelContext.memory)
          ├─ loadRecentMessages(channelContext.recentMessages)
          ├─ provider.query() with agent's tools (MCP servers)
          │   └─ tool calls, thoughts, responses streamed
          │
          ▼
Collect response + steps
          │
          ▼
adapter.sendMessage(channelId, response)
          │
          ▼
[Response appears in #engineering]

          │ (async, non-blocking)
          ▼
ChannelContext.appendMessage(channelId, {role, content})
          │
          ▼
if (messageCount % summaryInterval === 0):
  Summarizer.updateSummary(channelId)
```

### 4.2 Task → Agent Run → Slack Report

```
[Operator creates task in Mission Control UI]
          │
          ▼
POST /api/tasks  { title, agentId, channelId, priority, ... }
          │
          ▼
TaskManager.create(task)  ──▶  stored in /data/tasks.db
          │
          ▼
Orchestrator.onTaskAssigned(task)
          │
          ├─ task.status = 'in_progress'
          ├─ RunTracker.createRun(taskId, agentId)
          │
          ▼
AgentRunner[agentId].enqueue({
  type: 'task',
  task,
  sessionKey: `potatoclaw:task:${task.id}`
})
          │
          ▼
ClaudeAgent[agentId].run(sessionKey, task.description)
          │
          ├─ Each step emitted → RunTracker.appendStep(runId, step)
          │   └─ SSE event → Mission Control UI (live run viewer)
          │
          ▼
Run completes
          │
          ├─ TaskManager.updateStatus(taskId, 'done')
          ├─ RunTracker.completeRun(runId, output)
          │
          ▼
TaskReporter.postToSlack(channelId, run)
          │
          └─ Posts threaded summary in bound Slack channel
             "✅ Run completed in 5m32s — 3 files modified, tests passing"
```

### 4.3 Inter-Agent Task Creation

```
Agent: researcher is running, finds actionable code issue
          │
          ▼
MCP tool call: tasks.create_subtask({
  title: "Fix XSS vulnerability in template engine",
  description: "...",
  assignedAgentId: "engineer",
  priority: "critical",
  parentTaskId: currentTaskId
})
          │
          ▼
TaskManager.create(subtask)
          │
          ▼
Orchestrator.onTaskAssigned(subtask) → AgentRunner[engineer].enqueue(...)
          │
          ▼
[engineer agent starts working on it in parallel]
```

---

## 5. Storage Layout (`/data` volume)

```
/data/
├── secrets.enc                       # AES-256-GCM encrypted secrets
├── tasks.db                          # SQLite task store (or tasks.json)
├── cron-jobs.json                    # Persisted cron job definitions
│
├── agents/
│   ├── engineer.json                 # Agent definition
│   ├── researcher.json
│   └── ...
│
├── channels/
│   ├── slack-C01234567.json          # Channel binding config
│   ├── slack-C01234567-memory.md     # Channel-scoped memory
│   ├── slack-C01234567-summary.md    # Rolling conversation summary
│   └── ...
│
├── memory/
│   ├── engineer/
│   │   ├── MEMORY.md                 # Agent long-term memory
│   │   └── 2026-03-12.md            # Daily log
│   ├── researcher/
│   │   └── ...
│   └── ...
│
├── sessions/
│   ├── engineer/
│   │   └── potatoclaw:engineer:slack:channel:C01234567.jsonl
│   └── ...
│
├── runs/
│   ├── run_xyz789.json               # Full run record with steps
│   └── ...
│
├── workspaces/
│   ├── engineer/                     # Agent filesystem workspace
│   ├── researcher/
│   └── ...
│
├── auth/
│   ├── auth_whatsapp/               # Baileys session
│   └── ...
│
└── logs/
    └── potatoclaw.log               # Rotating log file
```

---

## 6. Mission Control UI — Page Specs

### Dashboard
```
┌─────────────────────────────────────────────────────────┐
│  🥔 PotatoClaw Mission Control                          │
├──────────────┬──────────────┬──────────────┬────────────┤
│  4 Agents    │  12 Tasks    │  3 Running   │  2 Queued  │
│  Active      │  Today       │  Now         │  Up Next   │
├─────────────────────────────┬───────────────────────────┤
│  Active Agents              │  Recent Events            │
│  ┌─────────────────────┐    │  10:05 engineer ✅ task   │
│  │ 💻 engineer  BUSY   │    │  10:03 researcher 🔄 run  │
│  │  Refactor auth...   │    │  10:01 marketer  ✅ task  │
│  │  ████░░░░░  3m 12s  │    │  09:58 analyst   ⚠️ error │
│  └─────────────────────┘    │                           │
│  ┌─────────────────────┐    │  Queue Depth              │
│  │ 🔬 researcher  BUSY │    │  engineer:    2 pending   │
│  │  Analyze Q1 data... │    │  researcher:  0 pending   │
│  └─────────────────────┘    │  marketer:    1 pending   │
└─────────────────────────────┴───────────────────────────┘
```

### Kanban Board
```
┌──────────────────────────────────────────────────────────────────────┐
│  Kanban Board                    [+ New Task]  Filter: All Agents ▼  │
├────────────┬────────────┬─────────────┬────────────┬─────────────────┤
│  Backlog   │   Todo     │ In Progress │  Review    │    Done         │
│  (5)       │   (3)      │   (4)       │   (2)      │    (12)         │
│            │            │             │            │                 │
│ ┌────────┐ │ ┌────────┐ │ ┌─────────┐ │ ┌────────┐ │ ┌─────────┐   │
│ │Migrate │ │ │Write   │ │ │Refactor │ │ │Review  │ │ │Setup CI │   │
│ │database│ │ │Q1 rept.│ │ │auth mod.│ │ │PR #142 │ │ │pipeline │   │
│ │        │ │ │        │ │ │         │ │ │        │ │ │         │   │
│ │🔬 med  │ │ │🔬 high │ │ │💻 high  │ │ │💻 med  │ │ │💻 done  │   │
│ └────────┘ │ └────────┘ │ └─────────┘ │ └────────┘ │ └─────────┘   │
│            │            │ ┌─────────┐ │            │                 │
│            │            │ │Analyze  │ │            │                 │
│            │            │ │Q1 data  │ │            │                 │
│            │            │ │🔬 crit  │ │            │                 │
│            │            │ └─────────┘ │            │                 │
└────────────┴────────────┴─────────────┴────────────┴─────────────────┘
```

### Run Detail Viewer
```
┌─────────────────────────────────────────────────────────┐
│  Run: run_xyz789  │  Task: Refactor auth module          │
│  Agent: 💻 engineer  │  Status: ✅ Completed  │  5m 32s  │
├─────────────────────────────────────────────────────────┤
│  10:00:01  💭 Let me first read the existing auth module │
│  10:00:02  🔧 filesystem.read_file("src/auth/index.js") │
│  10:00:03  📄 [1247 chars returned]                      │
│  10:00:05  💭 I see the JWT logic is tightly coupled...  │
│  10:00:06  🔧 filesystem.read_file("src/auth/jwt.js")   │
│  10:00:07  📄 [843 chars returned]                       │
│  10:00:15  🔧 filesystem.write_file("src/auth/jwt-     │
│               service.js", ...)                          │
│  10:00:16  ✅ File written                               │
│  10:05:32  💬 I've extracted the JWT logic into a        │
│               standalone JwtService class. The new       │
│               service handles token generation,          │
│               validation, and refresh...                 │
├─────────────────────────────────────────────────────────┤
│  Tokens: 24,800  │  Files modified: 3  │  Tools called: 8│
└─────────────────────────────────────────────────────────┘
```

---

## 7. MCP Tool Manifest

### tasks (new)
| Tool | Inputs | Description |
|------|--------|-------------|
| `create_task` | title, description, agentId, channelId, priority | Create new task |
| `update_task_status` | taskId, status | Move task through kanban |
| `create_subtask` | parentTaskId, title, description, agentId | Spawn subtask for another agent |
| `list_my_tasks` | status? | List tasks assigned to calling agent |
| `get_task` | taskId | Get task details |
| `add_task_note` | taskId, note | Append note to task |

### memory (new)
| Tool | Inputs | Description |
|------|--------|-------------|
| `read_agent_memory` | — | Read calling agent's MEMORY.md |
| `write_agent_memory` | content | Update calling agent's MEMORY.md |
| `read_channel_memory` | channelId | Read channel-scoped memory |
| `write_channel_memory` | channelId, content | Update channel-scoped memory |
| `search_memory` | query, scope? | Search memory files |

### filesystem
| Tool | Inputs | Description |
|------|--------|-------------|
| `read_file` | path | Read file from agent workspace |
| `write_file` | path, content | Write file to agent workspace |
| `list_directory` | path | List directory |
| `delete_file` | path | Delete file |
| `search_files` | query, path? | Full-text search in workspace |

### gateway
| Tool | Inputs | Description |
|------|--------|-------------|
| `send_message` | platform, channelId, message | Send to channel |
| `broadcast_message` | message, channels? | Send to multiple channels |
| `list_platforms` | — | Connected adapters |
| `get_queue_status` | — | Queue depth per agent |
| `get_current_context` | — | Current platform/channel/session |

### cron
| Tool | Inputs | Description |
|------|--------|-------------|
| `schedule_delayed` | delaySeconds, message, channelId, invokeAgent | One-off reminder |
| `schedule_recurring` | intervalSeconds, message, channelId, invokeAgent | Recurring |
| `schedule_cron` | expression, message, channelId, invokeAgent | Cron expression |
| `list_scheduled` | — | All jobs |
| `cancel_scheduled` | jobId | Cancel job |

---

## 8. Session Key Format

```
potatoclaw:<agentId>:<platform>:<type>:<channelId>

Examples:
  potatoclaw:engineer:slack:channel:C01234567
  potatoclaw:researcher:telegram:group:-100123456789
  potatoclaw:engineer:task:run:task_abc123
  potatoclaw:default:terminal:chat:local
```

---

## 9. Docker Design

### Ports

| Port | Service |
|------|---------|
| `4096` | Gateway HTTP (health check + WhatsApp QR) |
| `4200` | Mission Control UI + REST API |

### docker-compose.yml

```yaml
services:
  potatoclaw:
    build: ./docker
    ports:
      - "4096:4096"
      - "4200:4200"
    volumes:
      - potatoclaw_data:/data
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - COMPOSIO_API_KEY=${COMPOSIO_API_KEY}
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - UI_PASSWORD=${UI_PASSWORD}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    restart: unless-stopped

volumes:
  potatoclaw_data:
    driver: local
```

---

## 10. Technology Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| Runtime | Node.js 20 | Claude SDK is JS-native |
| HTTP / API server | Fastify | Fast, schema-based, SSE support |
| UI | Vanilla JS SPA | Zero build step; runs in container without build tools |
| Real-time UI updates | SSE (Server-Sent Events) | No WebSocket complexity for one-way updates |
| Logging | pino | Structured JSON logs; low overhead |
| Config validation | zod | Runtime schema validation |
| Task storage | SQLite (better-sqlite3) | Relational queries, zero infra |
| Secrets encryption | Node.js `crypto` (AES-256-GCM) | No extra deps |
| Slack | `@slack/bolt` | Official Bolt SDK; Socket Mode for container use |
| Telegram | `node-telegram-bot-api` | Simple, reliable |
| Discord | `discord.js` | Official Discord SDK |
| WhatsApp | `@whiskeysockets/baileys` | Battle-tested |
| AI (primary) | `@anthropic-ai/claude-agent-sdk` | Claude is the main model |
| AI (alternate) | `@opencode-ai/sdk` | OSS fallback |
| Integrations | `@composio/core` | 500+ app integrations |
