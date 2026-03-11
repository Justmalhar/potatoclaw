'use strict';

// ---------------------------------------------------------------------------
// tasks/manager.test.js — unit tests for src/tasks/manager.js (TaskManager)
// Mocks TaskStore so this test suite is purely about business logic.
// ---------------------------------------------------------------------------

const TaskManager = require('../../src/tasks/manager');

// ---------------------------------------------------------------------------
// Mock TaskStore factory
// Creates a fresh in-memory store mock per test
// ---------------------------------------------------------------------------

function makeStoreMock(overrides = {}) {
  const tasks = new Map();
  const notes = new Map();
  let idCounter = 0;

  const store = {
    create: jest.fn((data) => {
      const id = data.id || `task_${++idCounter}`;
      const task = {
        id,
        title: data.title,
        description: data.description || null,
        status: data.status || 'backlog',
        priority: data.priority || 'medium',
        assignedAgentId: data.assignedAgentId || null,
        channelId: data.channelId || null,
        tags: data.tags || [],
        dueDate: data.dueDate || null,
        parentTaskId: data.parentTaskId || null,
        dependencies: data.dependencies || [],
        createdBy: data.createdBy || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tasks.set(id, task);
      return { ...task };
    }),

    get: jest.fn((id) => {
      const t = tasks.get(id);
      return t ? { ...t } : null;
    }),

    update: jest.fn((id, fields) => {
      const t = tasks.get(id);
      if (!t) return null;
      Object.assign(t, fields, { updatedAt: new Date().toISOString() });
      tasks.set(id, t);
      return { ...t };
    }),

    list: jest.fn(({ status, agentId, priority, limit = 50, offset = 0 } = {}) => {
      let result = [...tasks.values()];
      if (status) result = result.filter((t) => t.status === status);
      if (agentId) result = result.filter((t) => t.assignedAgentId === agentId);
      if (priority) result = result.filter((t) => t.priority === priority);
      return { tasks: result.slice(offset, offset + limit), total: result.length };
    }),

    listByAgent: jest.fn((agentId, status) => {
      let result = [...tasks.values()].filter((t) => t.assignedAgentId === agentId);
      if (status) result = result.filter((t) => t.status === status);
      return result;
    }),

    addNote: jest.fn((taskId, note, createdBy) => {
      const noteRecord = { id: `note_${++idCounter}`, taskId, note, createdBy, createdAt: new Date().toISOString() };
      if (!notes.has(taskId)) notes.set(taskId, []);
      notes.get(taskId).push(noteRecord);
      return noteRecord;
    }),

    getNotes: jest.fn((taskId) => notes.get(taskId) || []),

    getSubtasks: jest.fn((parentTaskId) =>
      [...tasks.values()].filter((t) => t.parentTaskId === parentTaskId)
    ),

    ...overrides,
  };

  return store;
}

describe('TaskManager', () => {
  let store;
  let manager;

  beforeEach(() => {
    store = makeStoreMock();
    manager = new TaskManager(store);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    test('creates a task and emits task:created', async () => {
      const listener = jest.fn();
      manager.on('task:created', listener);

      const task = await manager.create({ title: 'New Task' });
      expect(task).toBeDefined();
      expect(task.title).toBe('New Task');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveProperty('task');
      expect(listener.mock.calls[0][0].task.title).toBe('New Task');
    });

    test('throws when title is missing', async () => {
      await expect(manager.create({ description: 'No title' })).rejects.toThrow('title is required');
    });

    test('throws when title is blank whitespace', async () => {
      await expect(manager.create({ title: '   ' })).rejects.toThrow('title is required');
    });

    test('throws for invalid priority', async () => {
      await expect(manager.create({ title: 'Bad Priority', priority: 'urgent' })).rejects.toThrow(
        /Invalid priority/
      );
    });

    test('throws for invalid status', async () => {
      await expect(manager.create({ title: 'Bad Status', status: 'flying' })).rejects.toThrow(
        /Invalid status/
      );
    });

    test('defaults to backlog status', async () => {
      const task = await manager.create({ title: 'Default Status' });
      expect(task.status).toBe('backlog');
    });

    test('stores the task via store.create', async () => {
      await manager.create({ title: 'Store Check' });
      expect(store.create).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // assign
  // -------------------------------------------------------------------------

  describe('assign', () => {
    test('changes status to todo and emits task:assigned', async () => {
      const task = await manager.create({ title: 'Assignable Task' });
      const listener = jest.fn();
      manager.on('task:assigned', listener);

      const assigned = await manager.assign(task.id, 'engineer');
      expect(assigned.status).toBe('todo');
      expect(assigned.assignedAgentId).toBe('engineer');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].agentId).toBe('engineer');
    });

    test('throws when task does not exist', async () => {
      await expect(manager.assign('nonexistent_id', 'engineer')).rejects.toThrow('Task not found');
    });
  });

  // -------------------------------------------------------------------------
  // transition — valid / invalid
  // -------------------------------------------------------------------------

  describe('transition', () => {
    test('valid transition backlog → todo succeeds', async () => {
      const task = await manager.create({ title: 'Transition Test' });
      const result = await manager.transition(task.id, 'todo');
      expect(result.status).toBe('todo');
    });

    test('valid chain: backlog → todo → in_progress', async () => {
      const task = await manager.create({ title: 'Chain Test' });
      await manager.transition(task.id, 'todo');
      const result = await manager.transition(task.id, 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    test('emits task:status_changed with previous and new status', async () => {
      const task = await manager.create({ title: 'Status Event Test' });
      const listener = jest.fn();
      manager.on('task:status_changed', listener);

      await manager.transition(task.id, 'todo');
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousStatus).toBe('backlog');
      expect(event.newStatus).toBe('todo');
    });

    test('invalid transition throws an error', async () => {
      const task = await manager.create({ title: 'Invalid Transition' });
      // backlog → done is not allowed
      await expect(manager.transition(task.id, 'done')).rejects.toThrow(/Invalid transition/);
    });

    test('invalid transition: todo → done throws', async () => {
      const task = await manager.create({ title: 'Todo to Done' });
      await manager.transition(task.id, 'todo');
      await expect(manager.transition(task.id, 'done')).rejects.toThrow(/Invalid transition/);
    });

    test('transition on nonexistent task throws', async () => {
      await expect(manager.transition('bad_id', 'todo')).rejects.toThrow('Task not found');
    });
  });

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------

  describe('complete', () => {
    test('sets status to done and emits task:completed', async () => {
      const task = await manager.create({ title: 'Completable Task' });
      // Move to in_progress: backlog → todo → in_progress
      await manager.transition(task.id, 'todo');
      await manager.transition(task.id, 'in_progress');

      const completedListener = jest.fn();
      manager.on('task:completed', completedListener);

      const done = await manager.complete(task.id, 'All done!');
      expect(done.status).toBe('done');
      expect(completedListener).toHaveBeenCalledTimes(1);
      expect(completedListener.mock.calls[0][0].output).toBe('All done!');
    });

    test('emits task:status_changed when completing', async () => {
      const task = await manager.create({ title: 'Status Change on Complete' });
      await manager.transition(task.id, 'todo');
      await manager.transition(task.id, 'in_progress');

      const statusListener = jest.fn();
      manager.on('task:status_changed', statusListener);

      await manager.complete(task.id);
      const lastCall = statusListener.mock.calls[statusListener.mock.calls.length - 1][0];
      expect(lastCall.newStatus).toBe('done');
    });

    test('completing from review status succeeds', async () => {
      const task = await manager.create({ title: 'Review Complete' });
      await manager.transition(task.id, 'todo');
      await manager.transition(task.id, 'in_progress');
      await manager.transition(task.id, 'review');
      const done = await manager.complete(task.id);
      expect(done.status).toBe('done');
    });

    test('completing from backlog throws', async () => {
      const task = await manager.create({ title: 'Backlog Complete' });
      await expect(manager.complete(task.id)).rejects.toThrow(/Cannot complete task from status/);
    });
  });

  // -------------------------------------------------------------------------
  // createSubtask
  // -------------------------------------------------------------------------

  describe('createSubtask', () => {
    test('creates a subtask with the correct parentTaskId', async () => {
      const parent = await manager.create({ title: 'Parent Task' });
      const sub = await manager.createSubtask(parent.id, { title: 'Subtask' });
      expect(sub.parentTaskId).toBe(parent.id);
    });

    test('emits task:created for the subtask', async () => {
      const parent = await manager.create({ title: 'Parent' });
      const listener = jest.fn();
      manager.on('task:created', listener);
      await manager.createSubtask(parent.id, { title: 'Child' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('throws when parent task does not exist', async () => {
      await expect(
        manager.createSubtask('nonexistent_parent', { title: 'Orphan' })
      ).rejects.toThrow('Task not found');
    });

    test('subtask inherits given assignedAgentId', async () => {
      const parent = await manager.create({ title: 'Parent' });
      const sub = await manager.createSubtask(parent.id, {
        title: 'Subtask',
        assignedAgentId: 'engineer',
      });
      expect(sub.assignedAgentId).toBe('engineer');
    });
  });

  // -------------------------------------------------------------------------
  // getAgentQueue
  // -------------------------------------------------------------------------

  describe('getAgentQueue', () => {
    test('returns todo and in_progress tasks for the agent', async () => {
      await manager.create({ title: 'Backlog', status: 'backlog', assignedAgentId: 'engineer' });
      // Manually inject tasks with specific statuses using store mock
      const t1 = store.create({ title: 'Todo Medium', status: 'todo', priority: 'medium', assignedAgentId: 'engineer' });
      const t2 = store.create({ title: 'InProgress High', status: 'in_progress', priority: 'high', assignedAgentId: 'engineer' });
      const t3 = store.create({ title: 'Done', status: 'done', priority: 'medium', assignedAgentId: 'engineer' });

      const queue = await manager.getAgentQueue('engineer');
      const ids = queue.map((t) => t.id);
      expect(ids).toContain(t1.id);
      expect(ids).toContain(t2.id);
      expect(ids).not.toContain(t3.id);
    });

    test('orders by priority: critical first', async () => {
      store.create({ title: 'Low Pri', status: 'todo', priority: 'low', assignedAgentId: 'eng' });
      store.create({ title: 'Critical Pri', status: 'todo', priority: 'critical', assignedAgentId: 'eng' });
      store.create({ title: 'Medium Pri', status: 'todo', priority: 'medium', assignedAgentId: 'eng' });

      const queue = await manager.getAgentQueue('eng');
      expect(queue[0].priority).toBe('critical');
    });

    test('returns empty array for agent with no active tasks', async () => {
      const queue = await manager.getAgentQueue('idle-agent');
      expect(queue).toEqual([]);
    });

    test('in_progress tasks appear before same-priority todo tasks (comes first in combined)', async () => {
      store.create({ title: 'Todo High', status: 'todo', priority: 'high', assignedAgentId: 'eng' });
      store.create({ title: 'InProgress High', status: 'in_progress', priority: 'high', assignedAgentId: 'eng' });

      const queue = await manager.getAgentQueue('eng');
      // Both are high priority; in_progress is prepended so should come first
      expect(queue[0].status).toBe('in_progress');
    });
  });
});
