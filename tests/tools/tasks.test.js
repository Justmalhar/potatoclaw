'use strict';

// ---------------------------------------------------------------------------
// tools/tasks.test.js — unit tests for src/tools/tasks.js
// ---------------------------------------------------------------------------

const { createTasksTool } = require('../../src/tools/tasks');

// ---------------------------------------------------------------------------
// Mock task manager factory
// ---------------------------------------------------------------------------

function makeMockTaskManager(overrides = {}) {
  return {
    create: jest.fn(async (data) => ({ id: 'task_001', ...data, status: data.status || 'backlog' })),
    get: jest.fn(async (id) => ({ id, title: 'Mock Task', status: 'backlog', channelId: null, priority: 'medium', notes: [], subtasks: [] })),
    updateStatus: jest.fn(async (id, status) => ({ id, status })),
    transition: jest.fn(async (id, newStatus) => ({ id, status: newStatus })),
    listByAgent: jest.fn(async (agentId, status) => {
      const tasks = [
        { id: 'task_a', title: 'Task A', assignedAgentId: agentId, status: status || 'todo' },
      ];
      return tasks;
    }),
    addNote: jest.fn(async (taskId, note, createdBy) => ({
      id: 'note_001',
      taskId,
      note,
      createdBy,
      createdAt: new Date().toISOString(),
    })),
    getNotes: jest.fn(async () => []),
    getSubtasks: jest.fn(async () => []),
    ...overrides,
  };
}

// Helper: find tool by name
function getTool(toolModule, name) {
  return toolModule.tools.find((t) => t.name === name);
}

describe('createTasksTool', () => {
  let taskManager;
  let toolModule;

  beforeEach(() => {
    taskManager = makeMockTaskManager();
    toolModule = createTasksTool({
      taskManager,
      agentId: 'engineer',
      channelId: 'slack:C01234567',
    });
  });

  // -------------------------------------------------------------------------
  // Module shape
  // -------------------------------------------------------------------------

  describe('module shape', () => {
    test('returns name, version, tools, setContext', () => {
      expect(toolModule.name).toBe('tasks');
      expect(toolModule.version).toBeDefined();
      expect(Array.isArray(toolModule.tools)).toBe(true);
      expect(typeof toolModule.setContext).toBe('function');
    });

    test('exposes create_task, create_subtask, update_task_status, list_my_tasks, get_task', () => {
      const names = toolModule.tools.map((t) => t.name);
      expect(names).toContain('create_task');
      expect(names).toContain('create_subtask');
      expect(names).toContain('update_task_status');
      expect(names).toContain('list_my_tasks');
      expect(names).toContain('get_task');
    });
  });

  // -------------------------------------------------------------------------
  // create_task
  // -------------------------------------------------------------------------

  describe('create_task', () => {
    test('calls taskManager.create with title and defaults', async () => {
      const createTask = getTool(toolModule, 'create_task');
      const { result } = await createTask.handler({ title: 'Build feature X' });
      expect(result.success).toBe(true);
      expect(taskManager.create).toHaveBeenCalledTimes(1);
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.title).toBe('Build feature X');
    });

    test('passes agentId from context as assignedAgentId when agent_id not provided', async () => {
      const createTask = getTool(toolModule, 'create_task');
      await createTask.handler({ title: 'My task' });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.assignedAgentId).toBe('engineer');
    });

    test('uses provided agent_id over context agentId', async () => {
      const createTask = getTool(toolModule, 'create_task');
      await createTask.handler({ title: 'Delegated task', agent_id: 'researcher' });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.assignedAgentId).toBe('researcher');
    });

    test('passes channelId from context when channel_id not provided', async () => {
      const createTask = getTool(toolModule, 'create_task');
      await createTask.handler({ title: 'Channel task' });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.channelId).toBe('slack:C01234567');
    });

    test('passes priority when provided', async () => {
      const createTask = getTool(toolModule, 'create_task');
      await createTask.handler({ title: 'High priority task', priority: 'high' });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.priority).toBe('high');
    });

    test('defaults priority to "medium" when not provided', async () => {
      const createTask = getTool(toolModule, 'create_task');
      await createTask.handler({ title: 'Default priority task' });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.priority).toBe('medium');
    });

    test('returns error when taskManager is not available', async () => {
      const noMgrTool = createTasksTool({ agentId: 'engineer', channelId: 'C1' });
      const createTask = getTool(noMgrTool, 'create_task');
      const { result } = await createTask.handler({ title: 'Task without manager' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('returns error when taskManager.create throws', async () => {
      taskManager.create.mockRejectedValueOnce(new Error('DB error'));
      const createTask = getTool(toolModule, 'create_task');
      const { result } = await createTask.handler({ title: 'Failing task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  // -------------------------------------------------------------------------
  // create_subtask
  // -------------------------------------------------------------------------

  describe('create_subtask', () => {
    test('calls taskManager.get to verify parent exists, then taskManager.create with parentTaskId', async () => {
      const createSubtask = getTool(toolModule, 'create_subtask');
      const { result } = await createSubtask.handler({
        parent_task_id: 'task_parent_001',
        title: 'Child task',
      });
      expect(result.success).toBe(true);
      expect(taskManager.get).toHaveBeenCalledWith('task_parent_001');
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.parentTaskId).toBe('task_parent_001');
    });

    test('passes assigned_agent_id to the subtask', async () => {
      const createSubtask = getTool(toolModule, 'create_subtask');
      await createSubtask.handler({
        parent_task_id: 'task_parent_001',
        title: 'Child task',
        assigned_agent_id: 'researcher',
      });
      const callArg = taskManager.create.mock.calls[0][0];
      expect(callArg.assignedAgentId).toBe('researcher');
    });

    test('returns error when parent task is not found', async () => {
      taskManager.get.mockResolvedValueOnce(null);
      const createSubtask = getTool(toolModule, 'create_subtask');
      const { result } = await createSubtask.handler({
        parent_task_id: 'nonexistent_parent',
        title: 'Orphan child',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent_parent');
    });

    test('returns error when taskManager is not available', async () => {
      const noMgrTool = createTasksTool({ agentId: 'engineer' });
      const createSubtask = getTool(noMgrTool, 'create_subtask');
      const { result } = await createSubtask.handler({
        parent_task_id: 'p1',
        title: 'Child',
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // update_task_status
  // -------------------------------------------------------------------------

  describe('update_task_status', () => {
    test('calls taskManager.updateStatus with taskId and new status', async () => {
      const updateStatus = getTool(toolModule, 'update_task_status');
      const { result } = await updateStatus.handler({
        task_id: 'task_001',
        status: 'in_progress',
      });
      expect(result.success).toBe(true);
      expect(taskManager.updateStatus).toHaveBeenCalledWith('task_001', 'in_progress');
    });

    test('returns the updated task on success', async () => {
      const updateStatus = getTool(toolModule, 'update_task_status');
      const { result } = await updateStatus.handler({
        task_id: 'task_001',
        status: 'done',
      });
      expect(result.task).toBeDefined();
      expect(result.task.status).toBe('done');
    });

    test('returns error when taskManager.updateStatus returns null', async () => {
      taskManager.updateStatus.mockResolvedValueOnce(null);
      const updateStatus = getTool(toolModule, 'update_task_status');
      const { result } = await updateStatus.handler({
        task_id: 'nonexistent',
        status: 'done',
      });
      expect(result.success).toBe(false);
    });

    test('returns error when taskManager.updateStatus throws', async () => {
      taskManager.updateStatus.mockRejectedValueOnce(new Error('Invalid transition'));
      const updateStatus = getTool(toolModule, 'update_task_status');
      const { result } = await updateStatus.handler({
        task_id: 'task_001',
        status: 'done',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    test('returns error when taskManager is not available', async () => {
      const noMgrTool = createTasksTool({ agentId: 'eng' });
      const updateStatus = getTool(noMgrTool, 'update_task_status');
      const { result } = await updateStatus.handler({ task_id: 't1', status: 'done' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // list_my_tasks
  // -------------------------------------------------------------------------

  describe('list_my_tasks', () => {
    test('calls taskManager.listByAgent with the context agentId', async () => {
      const listMyTasks = getTool(toolModule, 'list_my_tasks');
      const { result } = await listMyTasks.handler({});
      expect(result.success).toBe(true);
      expect(taskManager.listByAgent).toHaveBeenCalledWith('engineer', undefined);
    });

    test('passes status filter when provided', async () => {
      const listMyTasks = getTool(toolModule, 'list_my_tasks');
      await listMyTasks.handler({ status: 'in_progress' });
      expect(taskManager.listByAgent).toHaveBeenCalledWith('engineer', 'in_progress');
    });

    test('result includes tasks array, count, and agentId', async () => {
      const listMyTasks = getTool(toolModule, 'list_my_tasks');
      const { result } = await listMyTasks.handler({});
      expect(result).toHaveProperty('tasks');
      expect(result).toHaveProperty('count');
      expect(result.agentId).toBe('engineer');
    });

    test('returns error when agentId is not in context', async () => {
      const noAgentTool = createTasksTool({ taskManager, channelId: 'C1' });
      const listMyTasks = getTool(noAgentTool, 'list_my_tasks');
      const { result } = await listMyTasks.handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('returns error when taskManager is not available', async () => {
      const noMgrTool = createTasksTool({ agentId: 'engineer' });
      const listMyTasks = getTool(noMgrTool, 'list_my_tasks');
      const { result } = await listMyTasks.handler({});
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_task
  // -------------------------------------------------------------------------

  describe('get_task', () => {
    test('calls taskManager.get with the task_id', async () => {
      const getTask = getTool(toolModule, 'get_task');
      const { result } = await getTask.handler({ task_id: 'task_abc' });
      expect(result.success).toBe(true);
      expect(taskManager.get).toHaveBeenCalledWith('task_abc');
    });

    test('result includes the task object', async () => {
      const getTask = getTool(toolModule, 'get_task');
      const { result } = await getTask.handler({ task_id: 'task_abc' });
      expect(result.task).toBeDefined();
      expect(result.task.id).toBe('task_abc');
    });

    test('returns error when task is not found', async () => {
      taskManager.get.mockResolvedValueOnce(null);
      const getTask = getTool(toolModule, 'get_task');
      const { result } = await getTask.handler({ task_id: 'no_such_task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no_such_task');
    });

    test('returns error when taskManager is not available', async () => {
      const noMgrTool = createTasksTool({ agentId: 'engineer' });
      const getTask = getTool(noMgrTool, 'get_task');
      const { result } = await getTask.handler({ task_id: 'task_abc' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // setContext
  // -------------------------------------------------------------------------

  describe('setContext', () => {
    test('updates the context used by handlers', async () => {
      const freshTool = createTasksTool({});
      freshTool.setContext({ taskManager, agentId: 'new-agent', channelId: 'C_NEW' });

      const listMyTasks = getTool(freshTool, 'list_my_tasks');
      const { result } = await listMyTasks.handler({});
      expect(result.success).toBe(true);
      expect(result.agentId).toBe('new-agent');
    });
  });
});
