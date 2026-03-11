'use strict';

// ---------------------------------------------------------------------------
// sessions/manager.test.js — unit tests for src/sessions/manager.js
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');
const SessionManager = require('../../src/sessions/manager');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-sessions-test-'));
}

const SESSION_KEY = 'potatoclaw:engineer:slack:channel:C01234567';

describe('SessionManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    manager = new SessionManager('engineer', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getSession — creates session if not exists
  // -------------------------------------------------------------------------

  describe('getSession', () => {
    test('creates a new session object when key is first seen', () => {
      const session = manager.getSession(SESSION_KEY);
      expect(session).toBeDefined();
      expect(session.key).toBe(SESSION_KEY);
      expect(session.lastRunId).toBeNull();
      expect(session.messageCount).toBe(0);
      expect(Array.isArray(session.transcript)).toBe(true);
    });

    test('returns the same session on subsequent calls', () => {
      const s1 = manager.getSession(SESSION_KEY);
      const s2 = manager.getSession(SESSION_KEY);
      expect(s1).toBe(s2); // same object reference
    });

    test('different keys produce different session objects', () => {
      const s1 = manager.getSession('key-a');
      const s2 = manager.getSession('key-b');
      expect(s1).not.toBe(s2);
      expect(s1.key).toBe('key-a');
      expect(s2.key).toBe('key-b');
    });

    test('updates lastActivity timestamp on access', () => {
      const before = Date.now();
      const session = manager.getSession(SESSION_KEY);
      expect(session.lastActivity).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // appendTranscript + getTranscript round trip
  // -------------------------------------------------------------------------

  describe('appendTranscript + getTranscript', () => {
    test('appended message is returned by getTranscript', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Hello!' });
      const transcript = await manager.getTranscript(SESSION_KEY);
      expect(transcript).toHaveLength(1);
      expect(transcript[0].role).toBe('user');
      expect(transcript[0].content).toBe('Hello!');
    });

    test('multiple messages are returned in order', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Message 1' });
      await manager.appendTranscript(SESSION_KEY, { role: 'assistant', content: 'Reply 1' });
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Message 2' });

      const transcript = await manager.getTranscript(SESSION_KEY);
      expect(transcript).toHaveLength(3);
      expect(transcript[0].content).toBe('Message 1');
      expect(transcript[1].content).toBe('Reply 1');
      expect(transcript[2].content).toBe('Message 2');
    });

    test('transcript is persisted to a .jsonl file', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Persisted!' });
      const sanitized = SESSION_KEY.replace(/[^a-zA-Z0-9]/g, '-');
      const filePath = path.join(tmpDir, 'sessions', 'engineer', `${sanitized}.jsonl`);
      expect(fs.existsSync(filePath)).toBe(true);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.content).toBe('Persisted!');
    });

    test('entries include a timestamp', async () => {
      const before = Date.now();
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Timestamped.' });
      const transcript = await manager.getTranscript(SESSION_KEY);
      expect(transcript[0].timestamp).toBeGreaterThanOrEqual(before);
    });

    test('custom timestamp is preserved', async () => {
      const customTs = 1700000000000;
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Custom ts.', timestamp: customTs });
      const transcript = await manager.getTranscript(SESSION_KEY);
      expect(transcript[0].timestamp).toBe(customTs);
    });
  });

  // -------------------------------------------------------------------------
  // getTranscript — respects limit
  // -------------------------------------------------------------------------

  describe('getTranscript limit', () => {
    test('returns last N messages when limit is set', async () => {
      for (let i = 1; i <= 5; i++) {
        await manager.appendTranscript(SESSION_KEY, { role: 'user', content: `Message ${i}` });
      }

      const transcript = await manager.getTranscript(SESSION_KEY, 3);
      expect(transcript).toHaveLength(3);
      expect(transcript[0].content).toBe('Message 3');
      expect(transcript[1].content).toBe('Message 4');
      expect(transcript[2].content).toBe('Message 5');
    });

    test('limit larger than transcript returns all messages', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Only one.' });
      const transcript = await manager.getTranscript(SESSION_KEY, 100);
      expect(transcript).toHaveLength(1);
    });

    test('hydrates from disk when in-memory transcript is empty', async () => {
      // Write directly to disk, bypassing the in-memory path
      const sanitized = SESSION_KEY.replace(/[^a-zA-Z0-9]/g, '-');
      const dir = path.join(tmpDir, 'sessions', 'engineer');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${sanitized}.jsonl`);
      const entry = { role: 'user', content: 'From disk.', timestamp: Date.now() };
      fs.writeFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

      // New manager instance — cold memory
      const freshManager = new SessionManager('engineer', tmpDir);
      const transcript = await freshManager.getTranscript(SESSION_KEY);
      expect(transcript).toHaveLength(1);
      expect(transcript[0].content).toBe('From disk.');
    });
  });

  // -------------------------------------------------------------------------
  // clearSession — removes from memory, archives file
  // -------------------------------------------------------------------------

  describe('clearSession', () => {
    test('removes the session from in-memory map', async () => {
      manager.getSession(SESSION_KEY); // create it
      await manager.clearSession(SESSION_KEY);
      // After clear, getSession creates a brand new one
      const fresh = manager.getSession(SESSION_KEY);
      expect(fresh.messageCount).toBe(0);
    });

    test('renames the .jsonl file to an archive file', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Before clear.' });
      const sanitized = SESSION_KEY.replace(/[^a-zA-Z0-9]/g, '-');
      const originalPath = path.join(tmpDir, 'sessions', 'engineer', `${sanitized}.jsonl`);
      expect(fs.existsSync(originalPath)).toBe(true);

      await manager.clearSession(SESSION_KEY);
      expect(fs.existsSync(originalPath)).toBe(false);

      // Archive file should exist
      const dir = path.join(tmpDir, 'sessions', 'engineer');
      const archives = fs.readdirSync(dir).filter((f) => f.includes('.archive.jsonl'));
      expect(archives.length).toBeGreaterThan(0);
    });

    test('clearSession on non-existent session does not throw', async () => {
      await expect(manager.clearSession('nonexistent-key')).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // listSessions — returns all
  // -------------------------------------------------------------------------

  describe('listSessions', () => {
    test('returns empty array when no sessions exist', async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    test('lists all active session files', async () => {
      await manager.appendTranscript('session-a', { role: 'user', content: 'A' });
      await manager.appendTranscript('session-b', { role: 'user', content: 'B' });

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(2);
    });

    test('each entry has key, lastActivity, messageCount, fileSizeBytes', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Hello.' });
      const sessions = await manager.listSessions();
      const s = sessions[0];
      expect(s).toHaveProperty('key');
      expect(s).toHaveProperty('lastActivity');
      expect(s).toHaveProperty('messageCount');
      expect(s).toHaveProperty('fileSizeBytes');
    });

    test('archived sessions are excluded', async () => {
      await manager.appendTranscript(SESSION_KEY, { role: 'user', content: 'Before archive.' });
      await manager.clearSession(SESSION_KEY);
      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // setLastRunId / getLastRunId
  // -------------------------------------------------------------------------

  describe('setLastRunId / getLastRunId', () => {
    test('initially null', () => {
      const runId = manager.getLastRunId(SESSION_KEY);
      expect(runId).toBeNull();
    });

    test('set then get returns the run ID', () => {
      manager.setLastRunId(SESSION_KEY, 'run_abc123');
      expect(manager.getLastRunId(SESSION_KEY)).toBe('run_abc123');
    });

    test('can be overwritten', () => {
      manager.setLastRunId(SESSION_KEY, 'run_first');
      manager.setLastRunId(SESSION_KEY, 'run_second');
      expect(manager.getLastRunId(SESSION_KEY)).toBe('run_second');
    });

    test('different sessions have independent run IDs', () => {
      manager.setLastRunId('key-a', 'run_a');
      manager.setLastRunId('key-b', 'run_b');
      expect(manager.getLastRunId('key-a')).toBe('run_a');
      expect(manager.getLastRunId('key-b')).toBe('run_b');
    });
  });
});
