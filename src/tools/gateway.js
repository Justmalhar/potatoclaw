'use strict';

/**
 * Gateway MCP Tool — send_message, broadcast_message, list_platforms,
 * get_queue_status, get_current_context, list_sessions.
 *
 * Export: createGatewayTool(context)
 *   context = {
 *     adapters: Map<string, adapter>,
 *     agentRegistry,          // optional — for queue status
 *     sessionKey: string,     // current session key
 *     platform: string,       // current platform
 *     channelId: string,      // current channelId
 *   }
 */

const { z } = require('zod');

/**
 * Parse a compound channelId like "slack:C01234567" into { platform, channelId }.
 * Falls back to using the raw value as channelId on the given platform.
 */
function parseChannelId(rawChannelId, defaultPlatform) {
  if (!rawChannelId) return { platform: defaultPlatform, channelId: null };
  const colonIdx = rawChannelId.indexOf(':');
  if (colonIdx === -1) return { platform: defaultPlatform, channelId: rawChannelId };
  return {
    platform: rawChannelId.slice(0, colonIdx),
    channelId: rawChannelId.slice(colonIdx + 1),
  };
}

/**
 * @param {Object} context
 * @returns {{ name, version, tools, setContext }}
 */
function createGatewayTool(context) {
  // Allow context to be mutated per-run
  let ctx = { adapters: new Map(), agentRegistry: null, sessionKey: null, platform: null, channelId: null, ...(context || {}) };

  function setContext(update) {
    ctx = { ...ctx, ...update };
  }

  const tools = [
    {
      name: 'send_message',
      description:
        'Send a message to a specific channel on any connected platform. channel_id can be "platform:id" (e.g. "slack:C01234567") or just an id.',
      inputSchema: z.object({
        channel_id: z.string().describe('Target channelId, optionally prefixed with "platform:" (e.g. slack:C01234567)'),
        message: z.string().describe('Message text to send'),
        platform: z.string().optional().describe('Platform override (slack, telegram, discord, whatsapp, signal, imessage)'),
      }),
      handler: async (input) => {
        const { adapters } = ctx;
        const parsed = parseChannelId(input.channel_id, input.platform || ctx.platform);

        const adapter = adapters.get(parsed.platform);
        if (!adapter) {
          return { result: { success: false, error: `Platform "${parsed.platform}" not connected` } };
        }

        try {
          await adapter.sendMessage(parsed.channelId, input.message);
          return { result: { success: true, platform: parsed.platform, channelId: parsed.channelId, messageLength: input.message.length } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'broadcast_message',
      description: 'Send a message to multiple channels across platforms.',
      inputSchema: z.object({
        message: z.string().describe('The message to broadcast'),
        channels: z
          .array(z.string())
          .optional()
          .describe('Array of channelIds to send to (e.g. ["slack:C01234567", "telegram:-100123"]). Omit to send to all known channels.'),
      }),
      handler: async (input) => {
        const { adapters, agentRegistry } = ctx;
        let targets = input.channels;

        // If no channels provided and agentRegistry available, derive from channel bindings
        if (!targets || targets.length === 0) {
          return { result: { success: false, error: 'No channels specified for broadcast' } };
        }

        const results = [];
        for (const rawChannelId of targets) {
          const parsed = parseChannelId(rawChannelId, ctx.platform);
          const adapter = adapters.get(parsed.platform);
          if (!adapter) {
            results.push({ channelId: rawChannelId, success: false, error: `Platform "${parsed.platform}" not connected` });
            continue;
          }
          try {
            await adapter.sendMessage(parsed.channelId, input.message);
            results.push({ channelId: rawChannelId, success: true });
          } catch (err) {
            results.push({ channelId: rawChannelId, success: false, error: err.message });
          }
        }

        const sent = results.filter((r) => r.success).length;
        return { result: { success: true, sent, failed: results.length - sent, results } };
      },
    },

    {
      name: 'list_platforms',
      description: 'List all connected messaging platforms and their connection status.',
      inputSchema: z.object({}),
      handler: async () => {
        const { adapters } = ctx;
        const platforms = [];
        for (const [name, adapter] of adapters) {
          platforms.push({
            name,
            connected: !!(adapter.connected || adapter.sock || adapter.bot || adapter.client || adapter.process),
          });
        }
        return { result: { platforms, count: platforms.length } };
      },
    },

    {
      name: 'get_queue_status',
      description: 'Get the queue depth and processing status across all agents.',
      inputSchema: z.object({
        agent_id: z.string().optional().describe('Specific agentId to check'),
      }),
      handler: async (input) => {
        const { agentRegistry } = ctx;
        if (!agentRegistry) {
          return { result: { success: false, error: 'Agent registry not available' } };
        }

        try {
          if (input.agent_id) {
            const runner = agentRegistry.getRunner && agentRegistry.getRunner(input.agent_id);
            if (!runner) return { result: { success: false, error: `Agent "${input.agent_id}" not found` } };
            return { result: runner.getStatus() };
          }

          // Global status across all agents
          const statuses = agentRegistry.getAllRunners
            ? agentRegistry.getAllRunners().map((r) => r.getStatus())
            : [];
          return { result: { agents: statuses } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'get_current_context',
      description: 'Get information about the current conversation context (platform, channelId, sessionKey).',
      inputSchema: z.object({}),
      handler: async () => {
        return {
          result: {
            success: true,
            platform: ctx.platform,
            channelId: ctx.channelId,
            sessionKey: ctx.sessionKey,
          },
        };
      },
    },

    {
      name: 'list_sessions',
      description: 'List all active sessions with metadata (last activity, message count).',
      inputSchema: z.object({}),
      handler: async () => {
        const { agentRegistry } = ctx;
        if (!agentRegistry) {
          return { result: { success: false, error: 'Agent registry not available' } };
        }

        try {
          const sessions = [];
          const runners = agentRegistry.getAllRunners ? agentRegistry.getAllRunners() : [];
          for (const runner of runners) {
            if (runner.sessionManager) {
              const list = await runner.sessionManager.listSessions();
              for (const s of list) {
                sessions.push({ agentId: runner.agentId, ...s });
              }
            }
          }
          return { result: { sessions, count: sessions.length } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },
  ];

  return {
    name: 'gateway',
    version: '1.0.0',
    tools,
    setContext,
  };
}

module.exports = { createGatewayTool };
