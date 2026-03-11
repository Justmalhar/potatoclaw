'use strict';

/**
 * Memory MCP Tool — read/write agent memory and channel memory.
 *
 * Export: createMemoryTool(context)
 *   context = { memoryManager, agentId, channelId }
 *
 * memoryManager is an instance of src/memory/manager.js (MemoryManager).
 * Channel memory is accessed via MemoryManager.forChannel(channelId, dataDir).
 */

const { z } = require('zod');

/**
 * @param {{ memoryManager, agentId: string, channelId: string }} context
 * @returns {{ name, version, tools, setContext }}
 */
function createMemoryTool(context) {
  let ctx = {
    memoryManager: null,
    agentId: null,
    channelId: null,
    ...(context || {}),
  };

  function setContext(update) {
    ctx = { ...ctx, ...update };
  }

  function getChannelMemoryManager() {
    const { memoryManager, channelId } = ctx;
    if (!memoryManager) return null;
    // Use the static factory if available
    if (channelId && memoryManager.constructor && memoryManager.constructor.forChannel) {
      return memoryManager.constructor.forChannel(channelId, memoryManager.dataDir);
    }
    return null;
  }

  const tools = [
    {
      name: 'read_agent_memory',
      description: "Read the calling agent's MEMORY.md (long-term memory).",
      inputSchema: z.object({}),
      handler: async () => {
        const { memoryManager } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        try {
          const content = await memoryManager.readMemory();
          return { result: { success: true, content: content || '', isEmpty: !content } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'write_agent_memory',
      description: "Overwrite the calling agent's MEMORY.md with new content.",
      inputSchema: z.object({
        content: z.string().describe('New content to write to MEMORY.md'),
      }),
      handler: async (input) => {
        const { memoryManager } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        try {
          await memoryManager.writeMemory(input.content);
          return { result: { success: true, sizeBytes: Buffer.byteLength(input.content, 'utf-8') } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'append_agent_memory',
      description: "Append content to the calling agent's daily log (today's date file).",
      inputSchema: z.object({
        content: z.string().describe('Content to append to today\'s daily log'),
      }),
      handler: async (input) => {
        const { memoryManager } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        try {
          await memoryManager.appendDailyLog(input.content);
          return { result: { success: true } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'read_channel_memory',
      description: 'Read channel-scoped memory for the current channel.',
      inputSchema: z.object({
        channel_id: z.string().optional().describe('Channel ID override (default: current channel)'),
      }),
      handler: async (input) => {
        const { memoryManager, channelId } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        const targetChannel = input.channel_id || channelId;
        if (!targetChannel) return { result: { success: false, error: 'No channelId available' } };

        try {
          const MemoryManager = memoryManager.constructor;
          const channelMgr = MemoryManager.forChannel(targetChannel, memoryManager.dataDir);
          const content = await channelMgr.readMemory();
          return { result: { success: true, channelId: targetChannel, content: content || '', isEmpty: !content } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'write_channel_memory',
      description: 'Update channel-scoped memory for the current (or specified) channel.',
      inputSchema: z.object({
        content: z.string().describe('Content to write to channel memory'),
        channel_id: z.string().optional().describe('Channel ID override (default: current channel)'),
      }),
      handler: async (input) => {
        const { memoryManager, channelId } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        const targetChannel = input.channel_id || channelId;
        if (!targetChannel) return { result: { success: false, error: 'No channelId available' } };

        try {
          const MemoryManager = memoryManager.constructor;
          const channelMgr = MemoryManager.forChannel(targetChannel, memoryManager.dataDir);
          await channelMgr.writeMemory(input.content);
          return { result: { success: true, channelId: targetChannel, sizeBytes: Buffer.byteLength(input.content, 'utf-8') } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'search_memory',
      description: "Search across memory files. scope: 'agent' (default), 'channel', or 'all'.",
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        scope: z.enum(['agent', 'channel', 'all']).optional().describe("Search scope: 'agent', 'channel', or 'all'"),
      }),
      handler: async (input) => {
        const { memoryManager, channelId } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };
        const scope = input.scope || 'agent';
        const allResults = [];

        try {
          if (scope === 'agent' || scope === 'all') {
            const agentResults = await memoryManager.searchMemory(input.query);
            allResults.push(...agentResults.map((r) => ({ scope: 'agent', ...r })));
          }

          if ((scope === 'channel' || scope === 'all') && channelId) {
            const MemoryManager = memoryManager.constructor;
            const channelMgr = MemoryManager.forChannel(channelId, memoryManager.dataDir);
            const channelResults = await channelMgr.searchMemory(input.query);
            allResults.push(...channelResults.map((r) => ({ scope: 'channel', channelId, ...r })));
          }

          return { result: { success: true, query: input.query, scope, matches: allResults, count: allResults.length } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'list_memory_files',
      description: 'List all memory files for the current agent (and optionally the current channel).',
      inputSchema: z.object({}),
      handler: async () => {
        const { memoryManager, channelId } = ctx;
        if (!memoryManager) return { result: { success: false, error: 'Memory manager not available' } };

        try {
          const agentFiles = await memoryManager.listFiles();
          const result = { agent: agentFiles, channel: [] };

          if (channelId) {
            const MemoryManager = memoryManager.constructor;
            const channelMgr = MemoryManager.forChannel(channelId, memoryManager.dataDir);
            try {
              result.channel = await channelMgr.listFiles();
            } catch {}
          }

          return { result: { success: true, ...result } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },
  ];

  return {
    name: 'memory',
    version: '1.0.0',
    tools,
    setContext,
  };
}

module.exports = { createMemoryTool };
