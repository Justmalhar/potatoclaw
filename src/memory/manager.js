'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.potatoclaw');

/**
 * Per-agent memory management.
 * Handles MEMORY.md (long-term), daily logs, and channel-scoped memory.
 *
 * Directory layout:
 *   ${dataDir}/memory/${agentId}/MEMORY.md
 *   ${dataDir}/memory/${agentId}/${YYYY-MM-DD}.md
 *   ${dataDir}/channels/${channelId}-memory.md
 */
class MemoryManager {
  /**
   * @param {string} agentId   - Agent identifier (e.g. 'engineer')
   * @param {string} [dataDir] - Root data directory
   */
  constructor(agentId, dataDir = DEFAULT_DATA_DIR) {
    this.agentId = agentId;
    this.dataDir = dataDir;

    // Per-agent memory directory
    this.memoryDir = path.join(dataDir, 'memory', agentId);
    this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');

    // Channel memory directory (shared, not per-agent)
    this.channelsDir = path.join(dataDir, 'channels');
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Create necessary directories if they do not exist.
   */
  async ensureDirs() {
    for (const dir of [this.memoryDir, this.channelsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------

  _today() {
    return new Date().toISOString().split('T')[0];
  }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  _dailyPath(date) {
    return path.join(this.memoryDir, `${date}.md`);
  }

  // ---------------------------------------------------------------------------
  // Low-level file helpers
  // ---------------------------------------------------------------------------

  _readFileSafe(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf-8');
      }
    } catch (err) {
      // Return null if unreadable
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns a combined context string: MEMORY.md + yesterday's log + today's log.
   * Suitable for injecting into the agent system prompt.
   * @returns {Promise<string>}
   */
  async getMemoryContext() {
    await this.ensureDirs();
    const parts = [];

    const longTerm = this._readFileSafe(this.memoryFile);
    if (longTerm) {
      parts.push(`## Agent Memory (MEMORY.md)\n${longTerm.trim()}`);
    }

    const yesterday = this._readFileSafe(this._dailyPath(this._yesterday()));
    if (yesterday) {
      parts.push(`## Yesterday's Log (${this._yesterday()})\n${yesterday.trim()}`);
    }

    const today = this._readFileSafe(this._dailyPath(this._today()));
    if (today) {
      parts.push(`## Today's Log (${this._today()})\n${today.trim()}`);
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Append a timestamped entry to today's daily log file.
   * @param {string} entry - Markdown text to append
   * @returns {Promise<void>}
   */
  async appendDailyLog(entry) {
    await this.ensureDirs();
    const filepath = this._dailyPath(this._today());
    const timestamp = new Date().toISOString();
    const block = `\n## ${timestamp}\n${entry}\n`;
    fs.appendFileSync(filepath, block, 'utf-8');
  }

  /**
   * Read the raw content of MEMORY.md.
   * @returns {Promise<string>}
   */
  async readMemory() {
    await this.ensureDirs();
    return this._readFileSafe(this.memoryFile) || '';
  }

  /**
   * Overwrite MEMORY.md with new content.
   * @param {string} content
   * @returns {Promise<void>}
   */
  async writeMemory(content) {
    await this.ensureDirs();
    fs.writeFileSync(this.memoryFile, content, 'utf-8');
  }

  /**
   * Search the last N days of memory files (plus MEMORY.md) for a query string.
   * Returns an array of { file, matches } objects.
   * @param {string} query
   * @param {number} [days=30]
   * @returns {Promise<Array<{file: string, matches: Array<{line: number, context: string}>}>>}
   */
  async searchMemory(query, days = 30) {
    await this.ensureDirs();
    const results = [];
    const queryLower = query.toLowerCase();

    // Search MEMORY.md
    const longTerm = this._readFileSafe(this.memoryFile);
    if (longTerm && longTerm.toLowerCase().includes(queryLower)) {
      results.push({
        file: 'MEMORY.md',
        matches: this._extractMatches(longTerm, query),
      });
    }

    // Enumerate daily files, newest first
    let dailyFiles = [];
    try {
      dailyFiles = fs.readdirSync(this.memoryDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, days);
    } catch (_) {
      // Directory unreadable or empty
    }

    for (const file of dailyFiles) {
      const content = this._readFileSafe(path.join(this.memoryDir, file));
      if (content && content.toLowerCase().includes(queryLower)) {
        results.push({
          file: `memory/${this.agentId}/${file}`,
          matches: this._extractMatches(content, query),
        });
      }
    }

    return results;
  }

  /**
   * List all memory files for this agent (MEMORY.md + daily logs).
   * @returns {Promise<string[]>} Absolute file paths, sorted newest first.
   */
  async listFiles() {
    await this.ensureDirs();
    const files = [];

    if (fs.existsSync(this.memoryFile)) {
      files.push(this.memoryFile);
    }

    try {
      const daily = fs.readdirSync(this.memoryDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .map((f) => path.join(this.memoryDir, f));
      files.push(...daily);
    } catch (_) {
      // Ignore
    }

    return files;
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * Create a MemoryManager scoped to a channel instead of an agent.
   * Uses ${dataDir}/channels/${channelId}-memory.md as the "MEMORY.md".
   *
   * The returned manager has agentId set to the channelId and its memoryDir
   * mapped into the channels directory so daily logs land under channels/ too.
   *
   * @param {string} channelId  - Channel identifier (e.g. 'slack:C01234567')
   * @param {string} [dataDir]
   * @returns {MemoryManager}
   */
  static forChannel(channelId, dataDir = DEFAULT_DATA_DIR) {
    // Sanitize channelId for filesystem use
    const safeId = channelId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const mgr = new MemoryManager(safeId, dataDir);

    // Override memoryFile to the canonical channel-memory path
    mgr.memoryFile = path.join(dataDir, 'channels', `${safeId}-memory.md`);
    // Daily logs for channel go under channels directory
    mgr.memoryDir = path.join(dataDir, 'channels');

    return mgr;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _extractMatches(content, query) {
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();
    const matches = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        matches.push({
          line: i + 1,
          context: lines.slice(start, end).join('\n'),
        });
      }
    }

    return matches.slice(0, 5); // cap at 5 matches per file
  }
}

module.exports = MemoryManager;
