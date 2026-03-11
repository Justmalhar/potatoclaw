'use strict';

const { EventEmitter } = require('events');

/**
 * Valid status transitions for the task state machine.
 */
const TRANSITIONS = {
  backlog: ['todo'],
  todo: ['in_progress'],
  in_progress: ['review', 'blocked'],
  review: ['done', 'in_progress'],
  blocked: ['todo', 'in_progress'],
  done: [],
  failed: [],
};

/**
 * Priority ordering for queue sorting (lower number = higher priority).
 */
const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Business logic layer on top of TaskStore. Emits events for SSE and UI updates.
 *
 * Events emitted:
 *   'task:created'        { task }
 *   'task:assigned'       { task, agentId }
 *   'task:status_changed' { task, previousStatus, newStatus }
 *   'task:completed'      { task, output }
 *   'task:failed'         { task, error }
 */
class TaskManager extends EventEmitter {
  /**
   * @param {import('./store')} taskStore
   */
  constructor(taskStore) {
    super();
    this.store = taskStore;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Validate and create a new task.
   * @param {Object} taskData
   * @returns {Promise<Object>} The created task
   */
  async create(taskData) {
    if (!taskData.title || !taskData.title.trim()) {
      throw new Error('Task title is required');
    }

    if (taskData.priority && !(taskData.priority in PRIORITY_ORDER)) {
      throw new Error(`Invalid priority: ${taskData.priority}. Must be one of: ${Object.keys(PRIORITY_ORDER).join(', ')}`);
    }

    if (taskData.status && !(taskData.status in TRANSITIONS)) {
      throw new Error(`Invalid status: ${taskData.status}`);
    }

    const task = this.store.create({
      ...taskData,
      status: taskData.status || 'backlog',
      priority: taskData.priority || 'medium',
    });

    this.emit('task:created', { task });
    return task;
  }

  // ---------------------------------------------------------------------------
  // Assignment
  // ---------------------------------------------------------------------------

  /**
   * Assign a task to an agent and move it to 'todo' status.
   * @param {string} taskId
   * @param {string} agentId
   * @returns {Promise<Object>}
   */
  async assign(taskId, agentId) {
    const task = this._requireTask(taskId);
    const updated = this.store.update(taskId, {
      assignedAgentId: agentId,
      status: 'todo',
    });
    this.emit('task:assigned', { task: updated, agentId });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  /**
   * Transition a task to a new status, validating the state machine.
   * @param {string} taskId
   * @param {string} newStatus
   * @returns {Promise<Object>}
   */
  async transition(taskId, newStatus) {
    const task = this._requireTask(taskId);
    const allowed = TRANSITIONS[task.status] || [];

    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${task.status} → ${newStatus}. ` +
        `Allowed: ${allowed.join(', ') || 'none'}`
      );
    }

    const previousStatus = task.status;
    const updated = this.store.update(taskId, { status: newStatus });
    this.emit('task:status_changed', { task: updated, previousStatus, newStatus });
    return updated;
  }

  /**
   * Mark a task as completed and emit the relevant events.
   * @param {string} taskId
   * @param {string} [output] - Optional output text from the run
   * @returns {Promise<Object>}
   */
  async complete(taskId, output) {
    const task = this._requireTask(taskId);

    // Allow completing from review or in_progress states
    const validFrom = ['in_progress', 'review', 'todo'];
    if (!validFrom.includes(task.status)) {
      throw new Error(`Cannot complete task from status: ${task.status}`);
    }

    const updated = this.store.update(taskId, { status: 'done' });
    this.emit('task:status_changed', { task: updated, previousStatus: task.status, newStatus: 'done' });
    this.emit('task:completed', { task: updated, output: output || null });
    return updated;
  }

  /**
   * Mark a task as failed/blocked.
   * Per spec, fail() uses 'blocked' status.
   * @param {string} taskId
   * @param {string|Error} error
   * @returns {Promise<Object>}
   */
  async fail(taskId, error) {
    const task = this._requireTask(taskId);
    const errorMessage = error instanceof Error ? error.message : String(error);

    const updated = this.store.update(taskId, { status: 'blocked' });
    this.emit('task:status_changed', { task: updated, previousStatus: task.status, newStatus: 'blocked' });
    this.emit('task:failed', { task: updated, error: errorMessage });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  /**
   * @param {string} taskId
   * @param {string} note
   * @param {string} [createdBy]
   * @returns {Promise<Object>}
   */
  async addNote(taskId, note, createdBy) {
    this._requireTask(taskId);
    return this.store.addNote(taskId, note, createdBy);
  }

  // ---------------------------------------------------------------------------
  // Subtasks
  // ---------------------------------------------------------------------------

  /**
   * Create a subtask under a parent task.
   * @param {string} parentTaskId
   * @param {Object} subtaskData
   * @returns {Promise<Object>}
   */
  async createSubtask(parentTaskId, subtaskData) {
    this._requireTask(parentTaskId);
    return this.create({ ...subtaskData, parentTaskId });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Get a task with its notes and subtasks attached.
   * @param {string} taskId
   * @returns {Promise<Object>}
   */
  async get(taskId) {
    const task = this._requireTask(taskId);
    const notes = this.store.getNotes(taskId);
    const subtasks = this.store.getSubtasks(taskId);
    return { ...task, notes, subtasks };
  }

  /**
   * List tasks with filters and pagination.
   * @param {Object} filters
   * @returns {Promise<{ tasks: Object[], total: number }>}
   */
  async list(filters = {}) {
    return this.store.list(filters);
  }

  /**
   * Get the active work queue for an agent: todo + in_progress tasks,
   * ordered by priority (critical first), then creation date.
   * @param {string} agentId
   * @returns {Promise<Object[]>}
   */
  async getAgentQueue(agentId) {
    const todo = this.store.listByAgent(agentId, 'todo');
    const inProgress = this.store.listByAgent(agentId, 'in_progress');
    const combined = [...inProgress, ...todo];

    return combined.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _requireTask(taskId) {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}

module.exports = TaskManager;
