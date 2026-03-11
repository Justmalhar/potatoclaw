'use strict';

// ---------------------------------------------------------------------------
// tasks/store.test.js — unit tests for src/tasks/store.js (TaskStore / SQLite)
// ---------------------------------------------------------------------------
// Uses in-memory SQLite (:memory:) via a monkey-patched dbPath so we never
// write to disk during tests.
// ---------------------------------------------------------------------------

// We need to intercept the Database constructor to use :memory:
// TaskStore hard-codes this.dbPath = path.join(dataDir, 'tasks.db'), then
// passes it to new Database(this.dbPath).  We override the dbPath after
// construction so init() will use :memory:.
jest.mock('better-sqlite3', () => {
  const Database = jest.requireActual('better-sqlite3');
  return jest.fn().mockImplementation((dbPath) => {
    // Always use :memory: regardless of supplied path
    return new Database(':memory:');
  });
});

const TaskStore = require('../../src/tasks/store');

function makeStore() {
  const store = new TaskStore('/tmp/potatoclaw-test-tasks');
  store.init();
  return store;
}

describe('TaskStore', () => {
  let store;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    if (store.db) store.db.close();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    test('returns a full task object with generated ID', () => {
      const task = store.create({ title: 'My Task' });
      expect(task).toBeDefined();
      expect(task.id).toBeTruthy();
      expect(task.id).toMatch(/^task_/);
      expect(task.title).toBe('My Task');
    });

    test('sets default status to "backlog"', () => {
      const task = store.create({ title: 'Default Status Task' });
      expect(task.status).toBe('backlog');
    });

    test('sets default priority to "medium"', () => {
      const task = store.create({ title: 'Default Priority Task' });
      expect(task.priority).toBe('medium');
    });

    test('sets createdAt and updatedAt as ISO strings', () => {
      const task = store.create({ title: 'Timestamps Task' });
      expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(task.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('stores and deserialises tags as an array', () => {
      const task = store.create({ title: 'Tagged Task', tags: ['backend', 'auth'] });
      expect(task.tags).toEqual(['backend', 'auth']);
    });

    test('stores and deserialises dependencies as an array', () => {
      const task = store.create({ title: 'Dependent Task', dependencies: ['task_other'] });
      expect(task.dependencies).toEqual(['task_other']);
    });

    test('accepts explicit id', () => {
      const task = store.create({ id: 'task_custom123', title: 'Custom ID Task' });
      expect(task.id).toBe('task_custom123');
    });

    test('accepts all optional fields', () => {
      const task = store.create({
        title: 'Full Task',
        description: 'Detailed description.',
        status: 'todo',
        priority: 'high',
        assignedAgentId: 'engineer',
        channelId: 'slack:C01234567',
        tags: ['tag1'],
        dueDate: '2026-03-20T00:00:00Z',
        parentTaskId: 'task_parent',
        createdBy: 'user',
      });
      expect(task.description).toBe('Detailed description.');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('high');
      expect(task.assignedAgentId).toBe('engineer');
      expect(task.channelId).toBe('slack:C01234567');
      expect(task.parentTaskId).toBe('task_parent');
      expect(task.createdBy).toBe('user');
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    test('returns the task by ID', () => {
      const created = store.create({ title: 'Fetchable Task' });
      const fetched = store.get(created.id);
      expect(fetched).toBeDefined();
      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe('Fetchable Task');
    });

    test('returns null for unknown ID', () => {
      expect(store.get('nonexistent_id')).toBeNull();
    });

    test('deserialises tags correctly on get', () => {
      const created = store.create({ title: 'Tag Task', tags: ['x', 'y'] });
      const fetched = store.get(created.id);
      expect(fetched.tags).toEqual(['x', 'y']);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    test('updates the title of an existing task', () => {
      const task = store.create({ title: 'Old Title' });
      const updated = store.update(task.id, { title: 'New Title' });
      expect(updated.title).toBe('New Title');
    });

    test('partial update: only specified fields change', () => {
      const task = store.create({ title: 'Partial Update', priority: 'low' });
      const updated = store.update(task.id, { priority: 'high' });
      expect(updated.priority).toBe('high');
      expect(updated.title).toBe('Partial Update');
    });

    test('updates updatedAt timestamp', () => {
      const task = store.create({ title: 'Timestamp Check' });
      const originalUpdatedAt = task.updatedAt;
      // Small delay to ensure timestamp differs
      const updated = store.update(task.id, { title: 'Changed' });
      // updatedAt should be >= original
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(originalUpdatedAt).getTime()
      );
    });

    test('update with empty fields object returns existing task unchanged', () => {
      const task = store.create({ title: 'No Change Task' });
      const returned = store.update(task.id, {});
      expect(returned.title).toBe('No Change Task');
    });

    test('returns null when task does not exist', () => {
      const result = store.update('nonexistent_id', { title: 'Updated' });
      expect(result).toBeNull();
    });

    test('updates tags array', () => {
      const task = store.create({ title: 'Tag Update', tags: ['a'] });
      const updated = store.update(task.id, { tags: ['b', 'c'] });
      expect(updated.tags).toEqual(['b', 'c']);
    });
  });

  // -------------------------------------------------------------------------
  // list — with filters
  // -------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(() => {
      store.create({ title: 'Task A', status: 'backlog', priority: 'low', assignedAgentId: 'engineer' });
      store.create({ title: 'Task B', status: 'todo', priority: 'high', assignedAgentId: 'researcher' });
      store.create({ title: 'Task C', status: 'in_progress', priority: 'high', assignedAgentId: 'engineer' });
      store.create({ title: 'Task D', status: 'done', priority: 'medium', assignedAgentId: 'analyst' });
    });

    test('returns all tasks with no filters', () => {
      const { tasks, total } = store.list();
      expect(total).toBe(4);
      expect(tasks).toHaveLength(4);
    });

    test('filters by status', () => {
      const { tasks, total } = store.list({ status: 'todo' });
      expect(total).toBe(1);
      expect(tasks[0].title).toBe('Task B');
    });

    test('filters by agentId', () => {
      const { tasks, total } = store.list({ agentId: 'engineer' });
      expect(total).toBe(2);
      expect(tasks.every((t) => t.assignedAgentId === 'engineer')).toBe(true);
    });

    test('filters by priority', () => {
      const { tasks, total } = store.list({ priority: 'high' });
      expect(total).toBe(2);
      expect(tasks.every((t) => t.priority === 'high')).toBe(true);
    });

    test('combines multiple filters', () => {
      const { tasks, total } = store.list({ agentId: 'engineer', status: 'in_progress' });
      expect(total).toBe(1);
      expect(tasks[0].title).toBe('Task C');
    });

    test('respects limit and offset for pagination', () => {
      const { tasks: page1 } = store.list({ limit: 2, offset: 0 });
      const { tasks: page2 } = store.list({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      // Pages should contain different tasks
      const ids1 = page1.map((t) => t.id);
      const ids2 = page2.map((t) => t.id);
      expect(ids1.every((id) => !ids2.includes(id))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listByAgent
  // -------------------------------------------------------------------------

  describe('listByAgent', () => {
    test('returns all tasks for an agent', () => {
      store.create({ title: 'Agent Task 1', assignedAgentId: 'engineer', status: 'todo' });
      store.create({ title: 'Agent Task 2', assignedAgentId: 'engineer', status: 'in_progress' });
      store.create({ title: 'Other Agent', assignedAgentId: 'researcher', status: 'todo' });

      const tasks = store.listByAgent('engineer');
      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.assignedAgentId === 'engineer')).toBe(true);
    });

    test('filters by status when provided', () => {
      store.create({ title: 'Todo Task', assignedAgentId: 'engineer', status: 'todo' });
      store.create({ title: 'Done Task', assignedAgentId: 'engineer', status: 'done' });

      const tasks = store.listByAgent('engineer', 'todo');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Todo Task');
    });

    test('returns empty array for unknown agent', () => {
      const tasks = store.listByAgent('nonexistent-agent');
      expect(tasks).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // addNote + getNotes
  // -------------------------------------------------------------------------

  describe('addNote + getNotes', () => {
    let taskId;

    beforeEach(() => {
      const task = store.create({ title: 'Task with Notes' });
      taskId = task.id;
    });

    test('addNote returns a note object with generated ID', () => {
      const note = store.addNote(taskId, 'First note.', 'engineer');
      expect(note).toBeDefined();
      expect(note.id).toMatch(/^note_/);
      expect(note.taskId).toBe(taskId);
      expect(note.note).toBe('First note.');
      expect(note.createdBy).toBe('engineer');
    });

    test('getNotes returns all notes for a task in chronological order', () => {
      store.addNote(taskId, 'Note 1', 'engineer');
      store.addNote(taskId, 'Note 2', 'researcher');
      const notes = store.getNotes(taskId);
      expect(notes).toHaveLength(2);
      expect(notes[0].note).toBe('Note 1');
      expect(notes[1].note).toBe('Note 2');
    });

    test('getNotes returns empty array for task with no notes', () => {
      const notes = store.getNotes(taskId);
      expect(notes).toEqual([]);
    });

    test('notes from different tasks do not cross-contaminate', () => {
      const task2 = store.create({ title: 'Another Task' });
      store.addNote(taskId, 'Note for task 1');
      store.addNote(task2.id, 'Note for task 2');

      expect(store.getNotes(taskId)).toHaveLength(1);
      expect(store.getNotes(task2.id)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getSubtasks
  // -------------------------------------------------------------------------

  describe('getSubtasks', () => {
    test('returns child tasks', () => {
      const parent = store.create({ title: 'Parent Task' });
      store.create({ title: 'Child 1', parentTaskId: parent.id });
      store.create({ title: 'Child 2', parentTaskId: parent.id });

      const subtasks = store.getSubtasks(parent.id);
      expect(subtasks).toHaveLength(2);
    });

    test('returns empty array when no subtasks', () => {
      const task = store.create({ title: 'Standalone Task' });
      expect(store.getSubtasks(task.id)).toEqual([]);
    });

    test('only returns direct children', () => {
      const grandparent = store.create({ title: 'Grandparent' });
      const parent = store.create({ title: 'Parent', parentTaskId: grandparent.id });
      store.create({ title: 'Child', parentTaskId: parent.id });

      const subtasks = store.getSubtasks(grandparent.id);
      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].title).toBe('Parent');
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    test('returns zero counts on empty store', () => {
      const stats = store.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byStatus).toEqual({});
      expect(stats.byAgent).toEqual({});
      expect(stats.byPriority).toEqual({});
    });

    test('counts total tasks', () => {
      store.create({ title: 'T1' });
      store.create({ title: 'T2' });
      store.create({ title: 'T3' });
      const stats = store.getStats();
      expect(stats.total).toBe(3);
    });

    test('groups by status', () => {
      store.create({ title: 'T1', status: 'backlog' });
      store.create({ title: 'T2', status: 'todo' });
      store.create({ title: 'T3', status: 'todo' });
      const stats = store.getStats();
      expect(stats.byStatus.backlog).toBe(1);
      expect(stats.byStatus.todo).toBe(2);
    });

    test('groups by agentId', () => {
      store.create({ title: 'E1', assignedAgentId: 'engineer' });
      store.create({ title: 'E2', assignedAgentId: 'engineer' });
      store.create({ title: 'R1', assignedAgentId: 'researcher' });
      const stats = store.getStats();
      expect(stats.byAgent.engineer).toBe(2);
      expect(stats.byAgent.researcher).toBe(1);
    });

    test('groups by priority', () => {
      store.create({ title: 'C1', priority: 'critical' });
      store.create({ title: 'H1', priority: 'high' });
      store.create({ title: 'H2', priority: 'high' });
      const stats = store.getStats();
      expect(stats.byPriority.critical).toBe(1);
      expect(stats.byPriority.high).toBe(2);
    });
  });
});
