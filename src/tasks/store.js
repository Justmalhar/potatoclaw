'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * SQLite-backed task persistence using better-sqlite3.
 *
 * Tables:
 *   tasks        — main task records
 *   task_notes   — notes attached to tasks
 */
class TaskStore {
  /**
   * @param {string} [dataDir]
   */
  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'tasks.db');
    this.db = null;
  }

  // ---------------------------------------------------------------------------
  // Schema & migrations
  // ---------------------------------------------------------------------------

  /**
   * Open the database and create tables if they don't exist.
   * Safe to call multiple times (idempotent).
   */
  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        description     TEXT,
        status          TEXT NOT NULL DEFAULT 'backlog',
        priority        TEXT NOT NULL DEFAULT 'medium',
        assignedAgentId TEXT,
        channelId       TEXT,
        tags            TEXT DEFAULT '[]',
        dueDate         TEXT,
        parentTaskId    TEXT,
        dependencies    TEXT DEFAULT '[]',
        createdBy       TEXT,
        createdAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id        TEXT PRIMARY KEY,
        taskId    TEXT NOT NULL,
        note      TEXT NOT NULL,
        createdBy TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignedAgentId ON tasks(assignedAgentId);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority       ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_parentTaskId   ON tasks(parentTaskId);
      CREATE INDEX IF NOT EXISTS idx_task_notes_taskId    ON task_notes(taskId);
    `);

    return this;
  }

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  _generateId(prefix = 'task') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 7);
    return `${prefix}_${ts}${rand}`;
  }

  // ---------------------------------------------------------------------------
  // Row ↔ object conversion
  // ---------------------------------------------------------------------------

  _deserialize(row) {
    if (!row) return null;
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      dependencies: JSON.parse(row.dependencies || '[]'),
    };
  }

  _serialize(task) {
    return {
      ...task,
      tags: JSON.stringify(task.tags || []),
      dependencies: JSON.stringify(task.dependencies || []),
    };
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Insert a new task. Returns the full task object with generated id + timestamps.
   * @param {Object} task
   * @returns {Object}
   */
  create(task) {
    const now = new Date().toISOString();
    const record = {
      id: task.id || this._generateId('task'),
      title: task.title,
      description: task.description || null,
      status: task.status || 'backlog',
      priority: task.priority || 'medium',
      assignedAgentId: task.assignedAgentId || null,
      channelId: task.channelId || null,
      tags: JSON.stringify(task.tags || []),
      dueDate: task.dueDate || null,
      parentTaskId: task.parentTaskId || null,
      dependencies: JSON.stringify(task.dependencies || []),
      createdBy: task.createdBy || null,
      createdAt: task.createdAt || now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks
        (id, title, description, status, priority, assignedAgentId, channelId,
         tags, dueDate, parentTaskId, dependencies, createdBy, createdAt, updatedAt)
      VALUES
        (@id, @title, @description, @status, @priority, @assignedAgentId, @channelId,
         @tags, @dueDate, @parentTaskId, @dependencies, @createdBy, @createdAt, @updatedAt)
    `);

    stmt.run(record);
    return this._deserialize(record);
  }

  /**
   * Get a task by id. Returns null if not found.
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return this._deserialize(row);
  }

  /**
   * Partial update — only provided fields are changed.
   * Returns the updated task, or null if not found.
   * @param {string} id
   * @param {Object} fields
   * @returns {Object|null}
   */
  update(id, fields) {
    const existing = this.get(id);
    if (!existing) return null;

    const allowed = [
      'title', 'description', 'status', 'priority', 'assignedAgentId',
      'channelId', 'tags', 'dueDate', 'parentTaskId', 'dependencies', 'createdBy',
    ];

    const sets = [];
    const params = {};

    for (const key of allowed) {
      if (key in fields) {
        let val = fields[key];
        if (key === 'tags' || key === 'dependencies') {
          val = JSON.stringify(Array.isArray(val) ? val : []);
        }
        sets.push(`${key} = @${key}`);
        params[key] = val;
      }
    }

    if (sets.length === 0) return existing;

    sets.push('updatedAt = @updatedAt');
    params.updatedAt = new Date().toISOString();
    params.id = id;

    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.get(id);
  }

  /**
   * Delete a task (and its notes via cascade).
   * @param {string} id
   */
  delete(id) {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  /**
   * List tasks with optional filters and pagination.
   * @param {{ status?: string, agentId?: string, priority?: string, limit?: number, offset?: number }} opts
   * @returns {{ tasks: Object[], total: number }}
   */
  list({ status, agentId, priority, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = {};

    if (status) {
      conditions.push('status = @status');
      params.status = status;
    }
    if (agentId) {
      conditions.push('assignedAgentId = @agentId');
      params.agentId = agentId;
    }
    if (priority) {
      conditions.push('priority = @priority');
      params.priority = priority;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = this.db.prepare(`SELECT COUNT(*) AS cnt FROM tasks ${where}`).get(params);
    const rows = this.db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY createdAt DESC LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset });

    return {
      tasks: rows.map((r) => this._deserialize(r)),
      total: countRow.cnt,
    };
  }

  /**
   * List tasks assigned to a specific agent, optionally filtered by status.
   * @param {string} agentId
   * @param {string} [status]
   * @returns {Object[]}
   */
  listByAgent(agentId, status) {
    if (status) {
      const rows = this.db.prepare(
        'SELECT * FROM tasks WHERE assignedAgentId = ? AND status = ? ORDER BY createdAt DESC'
      ).all(agentId, status);
      return rows.map((r) => this._deserialize(r));
    }
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE assignedAgentId = ? ORDER BY createdAt DESC'
    ).all(agentId);
    return rows.map((r) => this._deserialize(r));
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  /**
   * Add a note to a task.
   * @param {string} taskId
   * @param {string} note
   * @param {string} [createdBy]
   * @returns {Object}
   */
  addNote(taskId, note, createdBy) {
    const record = {
      id: this._generateId('note'),
      taskId,
      note,
      createdBy: createdBy || null,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO task_notes (id, taskId, note, createdBy, createdAt)
      VALUES (@id, @taskId, @note, @createdBy, @createdAt)
    `).run(record);
    return record;
  }

  /**
   * Get all notes for a task.
   * @param {string} taskId
   * @returns {Object[]}
   */
  getNotes(taskId) {
    return this.db.prepare(
      'SELECT * FROM task_notes WHERE taskId = ? ORDER BY createdAt ASC'
    ).all(taskId);
  }

  // ---------------------------------------------------------------------------
  // Subtasks
  // ---------------------------------------------------------------------------

  /**
   * Get all direct children of a parent task.
   * @param {string} parentTaskId
   * @returns {Object[]}
   */
  getSubtasks(parentTaskId) {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE parentTaskId = ? ORDER BY createdAt ASC'
    ).all(parentTaskId);
    return rows.map((r) => this._deserialize(r));
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /**
   * Return aggregate statistics.
   * @returns {{ total: number, byStatus: Object, byAgent: Object, byPriority: Object }}
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) AS cnt FROM tasks').get().cnt;

    const byStatus = {};
    for (const row of this.db.prepare(
      'SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status'
    ).all()) {
      byStatus[row.status] = row.cnt;
    }

    const byAgent = {};
    for (const row of this.db.prepare(
      "SELECT assignedAgentId, COUNT(*) AS cnt FROM tasks WHERE assignedAgentId IS NOT NULL GROUP BY assignedAgentId"
    ).all()) {
      byAgent[row.assignedAgentId] = row.cnt;
    }

    const byPriority = {};
    for (const row of this.db.prepare(
      'SELECT priority, COUNT(*) AS cnt FROM tasks GROUP BY priority'
    ).all()) {
      byPriority[row.priority] = row.cnt;
    }

    return { total, byStatus, byAgent, byPriority };
  }
}

module.exports = TaskStore;
