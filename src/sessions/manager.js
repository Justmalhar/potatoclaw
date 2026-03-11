'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * Per-session transcript management, namespaced per agent.
 *
 * Files: ${dataDir}/sessions/${agentId}/${sanitizedKey}.jsonl
 * sanitizedKey: non-alphanumeric chars replaced with '-'
 */
class SessionManager {
  /**
   * @param {string} agentId   - Agent identifier
   * @param {string} [dataDir] - Root data directory
   */
  constructor(agentId, dataDir = DEFAULT_DATA_DIR) {
    this.agentId = agentId;
    this.dataDir = dataDir;
    this.sessionsDir = path.join(dataDir, 'sessions', agentId);

    /** @type {Map<string, SessionState>} in-memory sessions */
    this._sessions = new Map();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async _ensureDir() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Key / path helpers
  // ---------------------------------------------------------------------------

  _sanitize(key) {
    return key.replace(/[^a-zA-Z0-9]/g, '-');
  }

  _filePath(key) {
    return path.join(this.sessionsDir, `${this._sanitize(key)}.jsonl`);
  }

  _archivePath(key) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.sessionsDir, `${this._sanitize(key)}.${ts}.archive.jsonl`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get or create an in-memory session object.
   * Does NOT load the transcript from disk — call getTranscript() for that.
   * @param {string} key
   * @returns {{ key: string, lastRunId: string|null, lastActivity: number, messageCount: number, transcript: Array }}
   */
  getSession(key) {
    if (!this._sessions.has(key)) {
      this._sessions.set(key, {
        key,
        lastRunId: null,
        lastActivity: Date.now(),
        messageCount: 0,
        transcript: [],
      });
    }
    const session = this._sessions.get(key);
    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Append a message to both the in-memory transcript and the JSONL file.
   * @param {string} key
   * @param {{ role: string, content: string, timestamp?: number }} entry
   * @returns {Promise<void>}
   */
  async appendTranscript(key, entry) {
    await this._ensureDir();
    const session = this.getSession(key);

    const record = {
      role: entry.role,
      content: entry.content,
      timestamp: entry.timestamp || Date.now(),
    };

    session.transcript.push(record);
    session.messageCount = (session.messageCount || 0) + 1;
    session.lastActivity = Date.now();

    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this._filePath(key), line, 'utf-8');
  }

  /**
   * Return the last `limit` transcript entries for a session.
   * Loads from disk if the in-memory transcript is empty.
   * @param {string} key
   * @param {number} [limit=100]
   * @returns {Promise<Array>}
   */
  async getTranscript(key, limit = 100) {
    const session = this.getSession(key);

    // Hydrate from disk when memory is cold
    if (session.transcript.length === 0) {
      const filepath = this._filePath(key);
      if (fs.existsSync(filepath)) {
        try {
          const raw = fs.readFileSync(filepath, 'utf-8');
          const lines = raw.trim().split('\n').filter(Boolean);
          session.transcript = lines.map((l) => JSON.parse(l));
          session.messageCount = session.transcript.length;
        } catch (err) {
          // Corrupted file — start fresh
          session.transcript = [];
        }
      }
    }

    return session.transcript.slice(-limit);
  }

  /**
   * Clear the in-memory session and rename the JSONL file to an archive.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async clearSession(key) {
    await this._ensureDir();
    const filepath = this._filePath(key);
    if (fs.existsSync(filepath)) {
      fs.renameSync(filepath, this._archivePath(key));
    }
    this._sessions.delete(key);
  }

  /**
   * List all sessions for this agent with metadata.
   * @returns {Promise<Array<{ key: string, lastActivity: number, messageCount: number, fileSizeBytes: number }>>}
   */
  async listSessions() {
    await this._ensureDir();
    const result = [];

    let files = [];
    try {
      files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.jsonl') && !f.includes('.archive.'));
    } catch (_) {
      return result;
    }

    for (const file of files) {
      const filepath = path.join(this.sessionsDir, file);
      let stat;
      try {
        stat = fs.statSync(filepath);
      } catch (_) {
        continue;
      }

      // Reconstruct the original key from the filename (best-effort)
      const sanitizedKey = file.replace(/\.jsonl$/, '');

      // Try to get session from memory first, then count lines in file
      let messageCount = 0;
      let lastActivity = stat.mtimeMs;

      if (this._sessions.has(sanitizedKey)) {
        const s = this._sessions.get(sanitizedKey);
        messageCount = s.messageCount || s.transcript.length;
        lastActivity = s.lastActivity;
      } else {
        try {
          const raw = fs.readFileSync(filepath, 'utf-8');
          messageCount = raw.trim().split('\n').filter(Boolean).length;
        } catch (_) {
          messageCount = 0;
        }
      }

      result.push({
        key: sanitizedKey,
        lastActivity,
        messageCount,
        fileSizeBytes: stat.size,
      });
    }

    return result.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * Permanently delete a session from memory and disk.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async deleteSession(key) {
    await this._ensureDir();
    const filepath = this._filePath(key);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    this._sessions.delete(key);
  }

  /**
   * Return aggregate statistics for all sessions.
   * @returns {Promise<{ totalSessions: number, totalMessages: number }>}
   */
  async getStats() {
    const sessions = await this.listSessions();
    const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
    return {
      totalSessions: sessions.length,
      totalMessages,
    };
  }

  /**
   * Set the last run ID for a session (in-memory only).
   * @param {string} key
   * @param {string} runId
   */
  setLastRunId(key, runId) {
    const session = this.getSession(key);
    session.lastRunId = runId;
  }

  /**
   * Get the last run ID for a session.
   * @param {string} key
   * @returns {string|null}
   */
  getLastRunId(key) {
    const session = this.getSession(key);
    return session.lastRunId;
  }
}

module.exports = SessionManager;
