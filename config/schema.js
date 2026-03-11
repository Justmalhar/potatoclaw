'use strict';

const { z } = require('zod');

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const GatewaySchema = z.object({
  port: z.number().int().min(1).max(65535).default(4096),
  host: z.string().default('0.0.0.0'),
});

const UiAuthSchema = z.object({
  enabled: z.boolean().default(true),
});

const UiSchema = z.object({
  port: z.number().int().min(1).max(65535).default(4200),
  host: z.string().default('0.0.0.0'),
  auth: UiAuthSchema.default({}),
});

const AgentSchema = z.object({
  defaultModel: z.string().default('claude-opus-4-6'),
  defaultProvider: z.enum(['claude', 'opencode']).default('claude'),
  maxTurns: z.number().int().positive().default(100),
  permissionMode: z
    .enum(['bypassPermissions', 'acceptEdits', 'default'])
    .default('bypassPermissions'),
});

const SlackAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  socketMode: z.boolean().default(true),
  botToken: z.string().default(''),
  appToken: z.string().default(''),
  signingSecret: z.string().default(''),
});

const TelegramAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
});

const DiscordAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
});

const SimpleAdapterSchema = z.object({
  enabled: z.boolean().default(false),
});

const AdaptersSchema = z.object({
  slack: SlackAdapterSchema.default({}),
  telegram: TelegramAdapterSchema.default({}),
  discord: DiscordAdapterSchema.default({}),
  whatsapp: SimpleAdapterSchema.default({}),
  signal: SimpleAdapterSchema.default({}),
  imessage: SimpleAdapterSchema.default({}),
});

const LogSchema = z.object({
  level: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  agentId: z.string().min(1).default('potatoclaw'),
  dataDir: z.string().min(1),
  gateway: GatewaySchema.default({}),
  ui: UiSchema.default({}),
  agent: AgentSchema.default({}),
  adapters: AdaptersSchema.default({}),
  log: LogSchema.default({}),
});

// ---------------------------------------------------------------------------
// Agent definition schema (for /data/agents/*.json)
// ---------------------------------------------------------------------------

const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  avatar: z.string().default('🤖'),
  model: z.string().default('claude-opus-4-6'),
  provider: z.enum(['claude', 'opencode']).default('claude'),
  systemPrompt: z.string().default(''),
  tools: z.array(z.string()).default([]),
  maxTurns: z.number().int().positive().default(100),
  permissionMode: z
    .enum(['bypassPermissions', 'acceptEdits', 'default'])
    .default('bypassPermissions'),
  workspacePath: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Channel binding schema
// ---------------------------------------------------------------------------

const ChannelBindingSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(['slack', 'telegram', 'discord', 'whatsapp', 'signal', 'imessage', 'terminal']),
  channelId: z.string().min(1),
  channelName: z.string().default(''),
  agentId: z.string().min(1),
  systemPromptOverride: z.string().default(''),
  toolOverrides: z
    .object({
      add: z.array(z.string()).default([]),
      remove: z.array(z.string()).default([]),
    })
    .default({}),
  recentMessageWindow: z.number().int().positive().default(20),
  summaryEnabled: z.boolean().default(true),
  summaryIntervalMessages: z.number().int().positive().default(50),
  memory: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Task schema
// ---------------------------------------------------------------------------

const TaskStatusValues = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked', 'failed'];
const TaskPriorityValues = ['critical', 'high', 'medium', 'low'];

const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(TaskStatusValues).default('backlog'),
  priority: z.enum(TaskPriorityValues).default('medium'),
  assignedAgentId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().datetime().nullable().default(null),
  parentTaskId: z.string().nullable().default(null),
  subtaskIds: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  runHistory: z.array(z.string()).default([]),
  createdBy: z.string().default('user'),
  notes: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Run schema
// ---------------------------------------------------------------------------

const RunStepSchema = z.object({
  type: z.enum(['thought', 'tool_call', 'tool_result', 'message', 'error', 'approval_request', 'approval_response']),
  content: z.any(),
  tool: z.string().optional(),
  input: z.any().optional(),
  timestamp: z.string().datetime(),
});

const RunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().nullable().default(null),
  agentId: z.string().min(1),
  channelId: z.string().nullable().default(null),
  sessionKey: z.string().default(''),
  status: z.enum(['queued', 'running', 'completed', 'failed']).default('queued'),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  durationMs: z.number().nullable().default(null),
  tokensUsed: z.number().default(0),
  steps: z.array(RunStepSchema).default([]),
  output: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Validate the top-level application config.
 * Throws a ZodError with detailed messages if validation fails.
 *
 * @param {object} config - Raw config object (typically from config/default.js)
 * @returns {object} Parsed and defaulted config
 */
function validateConfig(config) {
  return ConfigSchema.parse(config);
}

/**
 * Validate an agent definition (safe parse — returns { success, data, error }).
 */
function validateAgentDefinition(def) {
  return AgentDefinitionSchema.safeParse(def);
}

/**
 * Validate a channel binding.
 */
function validateChannelBinding(binding) {
  return ChannelBindingSchema.safeParse(binding);
}

/**
 * Validate a task.
 */
function validateTask(task) {
  return TaskSchema.safeParse(task);
}

/**
 * Validate a run record.
 */
function validateRun(run) {
  return RunSchema.safeParse(run);
}

module.exports = {
  ConfigSchema,
  AgentDefinitionSchema,
  ChannelBindingSchema,
  TaskSchema,
  RunSchema,
  RunStepSchema,
  TaskStatusValues,
  TaskPriorityValues,
  validateConfig,
  validateAgentDefinition,
  validateChannelBinding,
  validateTask,
  validateRun,
};
