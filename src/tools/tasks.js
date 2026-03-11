'use strict';

/**
 * Tasks MCP Tool — create_task, create_subtask, update_task_status,
 * list_my_tasks, get_task, add_task_note.
 *
 * Export: createTasksTool(context)
 *   context = { taskManager, agentId, channelId, currentTaskId }
 */

const { z } = require('zod');

const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'failed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

/**
 * @param {{ taskManager, agentId: string, channelId: string, currentTaskId?: string }} context
 * @returns {{ name, version, tools, setContext }}
 */
function createTasksTool(context) {
  let ctx = {
    taskManager: null,
    agentId: null,
    channelId: null,
    currentTaskId: null,
    ...(context || {}),
  };

  function setContext(update) {
    ctx = { ...ctx, ...update };
  }

  const tools = [
    {
      name: 'create_task',
      description: 'Create a new task and optionally assign it to an agent.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Detailed task description'),
        agent_id: z.string().optional().describe('Agent to assign the task to (defaults to calling agent)'),
        channel_id: z.string().optional().describe('Channel associated with this task'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority (default: medium)'),
        tags: z.array(z.string()).optional().describe('Tags for the task'),
        due_date: z.string().optional().describe('ISO 8601 due date'),
      }),
      handler: async (input) => {
        const { taskManager, agentId, channelId } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };

        try {
          const task = await taskManager.create({
            title: input.title,
            description: input.description || null,
            assignedAgentId: input.agent_id || agentId,
            channelId: input.channel_id || channelId,
            priority: input.priority || 'medium',
            tags: input.tags || [],
            dueDate: input.due_date || null,
            createdBy: agentId || 'agent',
          });
          return { result: { success: true, task } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'create_subtask',
      description: 'Create a subtask under a parent task, optionally assigning it to a different agent.',
      inputSchema: z.object({
        parent_task_id: z.string().describe('ID of the parent task'),
        title: z.string().describe('Subtask title'),
        description: z.string().optional().describe('Detailed subtask description'),
        assigned_agent_id: z.string().optional().describe('Agent to assign the subtask to'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Subtask priority'),
      }),
      handler: async (input) => {
        const { taskManager, agentId, channelId } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };

        try {
          // Verify parent exists
          const parent = await taskManager.get(input.parent_task_id);
          if (!parent) {
            return { result: { success: false, error: `Parent task "${input.parent_task_id}" not found` } };
          }

          const subtask = await taskManager.create({
            title: input.title,
            description: input.description || null,
            assignedAgentId: input.assigned_agent_id || agentId,
            channelId: parent.channelId || channelId,
            priority: input.priority || parent.priority || 'medium',
            parentTaskId: input.parent_task_id,
            createdBy: agentId || 'agent',
          });
          return { result: { success: true, subtask } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'update_task_status',
      description: `Move a task through the kanban. Valid statuses: ${VALID_STATUSES.join(', ')}`,
      inputSchema: z.object({
        task_id: z.string().describe('Task ID to update'),
        status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'failed']).describe('New status'),
      }),
      handler: async (input) => {
        const { taskManager } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };

        try {
          const task = await taskManager.updateStatus(input.task_id, input.status);
          if (!task) return { result: { success: false, error: `Task "${input.task_id}" not found` } };
          return { result: { success: true, task } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'list_my_tasks',
      description: 'List tasks assigned to the calling agent, optionally filtered by status.',
      inputSchema: z.object({
        status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'failed']).optional().describe('Filter by status'),
      }),
      handler: async (input) => {
        const { taskManager, agentId } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };
        if (!agentId) return { result: { success: false, error: 'No agentId in context' } };

        try {
          const tasks = await taskManager.listByAgent(agentId, input.status);
          return { result: { success: true, tasks, count: tasks.length, agentId } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'get_task',
      description: 'Get full details of a task including notes and subtasks.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID to retrieve'),
      }),
      handler: async (input) => {
        const { taskManager } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };

        try {
          const task = await taskManager.get(input.task_id);
          if (!task) return { result: { success: false, error: `Task "${input.task_id}" not found` } };

          // Enrich with notes and subtasks if possible
          let notes = [];
          let subtasks = [];
          try { notes = await taskManager.getNotes(input.task_id); } catch {}
          try { subtasks = await taskManager.getSubtasks(input.task_id); } catch {}

          return { result: { success: true, task: { ...task, notes, subtasks } } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },

    {
      name: 'add_task_note',
      description: 'Append a note or progress update to a task.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID'),
        note: z.string().describe('Note content to append'),
      }),
      handler: async (input) => {
        const { taskManager, agentId } = ctx;
        if (!taskManager) return { result: { success: false, error: 'Task manager not available' } };

        try {
          const note = await taskManager.addNote(input.task_id, input.note, agentId);
          return { result: { success: true, note } };
        } catch (err) {
          return { result: { success: false, error: err.message } };
        }
      },
    },
  ];

  return {
    name: 'tasks',
    version: '1.0.0',
    tools,
    setContext,
  };
}

module.exports = { createTasksTool };
