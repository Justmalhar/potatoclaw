'use strict';

// ---------------------------------------------------------------------------
// memory/manager.test.js — unit tests for src/memory/manager.js
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');
const MemoryManager = require('../../src/memory/manager');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-memory-test-'));
}

describe('MemoryManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    manager = new MemoryManager('engineer', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getMemoryContext — no files → empty string
  // -------------------------------------------------------------------------

  describe('getMemoryContext', () => {
    test('returns empty string when no memory files exist', async () => {
      const ctx = await manager.getMemoryContext();
      expect(ctx).toBe('');
    });

    test('includes MEMORY.md content when it exists', async () => {
      await manager.writeMemory('# Important notes\nRemember this.');
      const ctx = await manager.getMemoryContext();
      expect(ctx).toContain('Important notes');
      expect(ctx).toContain('Remember this.');
      expect(ctx).toContain('Agent Memory (MEMORY.md)');
    });

    test("includes today's log when it exists", async () => {
      await manager.appendDailyLog('Did some work today.');
      const ctx = await manager.getMemoryContext();
      expect(ctx).toContain("Today's Log");
      expect(ctx).toContain('Did some work today.');
    });

    test('combines MEMORY.md and daily log with separator', async () => {
      await manager.writeMemory('Long term memory.');
      await manager.appendDailyLog('Today log entry.');
      const ctx = await manager.getMemoryContext();
      expect(ctx).toContain('Long term memory.');
      expect(ctx).toContain('Today log entry.');
      // Sections should be separated
      expect(ctx).toContain('---');
    });
  });

  // -------------------------------------------------------------------------
  // appendDailyLog — creates file, appends with timestamp
  // -------------------------------------------------------------------------

  describe('appendDailyLog', () => {
    test('creates the daily log file on first call', async () => {
      const today = new Date().toISOString().split('T')[0];
      const expectedPath = path.join(tmpDir, 'memory', 'engineer', `${today}.md`);

      expect(fs.existsSync(expectedPath)).toBe(false);
      await manager.appendDailyLog('First log entry.');
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    test('file contains the entry text', async () => {
      await manager.appendDailyLog('My important log entry.');
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(tmpDir, 'memory', 'engineer', `${today}.md`);
      const contents = fs.readFileSync(logPath, 'utf-8');
      expect(contents).toContain('My important log entry.');
    });

    test('file includes an ISO timestamp header', async () => {
      await manager.appendDailyLog('Entry with timestamp.');
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(tmpDir, 'memory', 'engineer', `${today}.md`);
      const contents = fs.readFileSync(logPath, 'utf-8');
      // Should start with ## <ISO timestamp>
      expect(contents).toMatch(/## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('appends multiple entries to the same file', async () => {
      await manager.appendDailyLog('First entry.');
      await manager.appendDailyLog('Second entry.');
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(tmpDir, 'memory', 'engineer', `${today}.md`);
      const contents = fs.readFileSync(logPath, 'utf-8');
      expect(contents).toContain('First entry.');
      expect(contents).toContain('Second entry.');
    });
  });

  // -------------------------------------------------------------------------
  // readMemory / writeMemory round trip
  // -------------------------------------------------------------------------

  describe('readMemory / writeMemory', () => {
    test('readMemory returns empty string when MEMORY.md does not exist', async () => {
      const result = await manager.readMemory();
      expect(result).toBe('');
    });

    test('writeMemory creates MEMORY.md with the given content', async () => {
      await manager.writeMemory('# My Memory\nSome facts.');
      const memFile = path.join(tmpDir, 'memory', 'engineer', 'MEMORY.md');
      expect(fs.existsSync(memFile)).toBe(true);
      expect(fs.readFileSync(memFile, 'utf-8')).toBe('# My Memory\nSome facts.');
    });

    test('readMemory returns what was written', async () => {
      const content = '# Engineer Memory\nI know about the auth module.';
      await manager.writeMemory(content);
      const result = await manager.readMemory();
      expect(result).toBe(content);
    });

    test('writeMemory overwrites previous content', async () => {
      await manager.writeMemory('Old content.');
      await manager.writeMemory('New content.');
      expect(await manager.readMemory()).toBe('New content.');
    });
  });

  // -------------------------------------------------------------------------
  // searchMemory — searches across multiple files
  // -------------------------------------------------------------------------

  describe('searchMemory', () => {
    test('returns empty array when no files exist', async () => {
      const results = await manager.searchMemory('anything');
      expect(results).toEqual([]);
    });

    test('finds a match in MEMORY.md', async () => {
      await manager.writeMemory('The auth module uses JWT tokens.');
      const results = await manager.searchMemory('JWT');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file).toBe('MEMORY.md');
      expect(results[0].matches.length).toBeGreaterThan(0);
    });

    test('search is case-insensitive', async () => {
      await manager.writeMemory('The auth module uses jwt tokens.');
      const results = await manager.searchMemory('JWT');
      expect(results.length).toBeGreaterThan(0);
    });

    test('finds matches in daily log files', async () => {
      // Manually create a dated log file to simulate a multi-day scenario
      const memoryDir = path.join(tmpDir, 'memory', 'engineer');
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(
        path.join(memoryDir, '2026-03-10.md'),
        '## Entry\nRefactored the database layer.'
      );

      const results = await manager.searchMemory('database');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matches[0].context).toContain('database');
    });

    test('returns no results when query does not match', async () => {
      await manager.writeMemory('Nothing interesting here.');
      const results = await manager.searchMemory('xyz-no-match-xyz');
      expect(results).toEqual([]);
    });

    test('finds matches across MEMORY.md and multiple daily files', async () => {
      const memoryDir = path.join(tmpDir, 'memory', 'engineer');
      fs.mkdirSync(memoryDir, { recursive: true });

      // Write MEMORY.md with the query term
      await manager.writeMemory('Search term appears here.');
      // Write two daily files
      fs.writeFileSync(path.join(memoryDir, '2026-03-10.md'), 'Search term day 1.');
      fs.writeFileSync(path.join(memoryDir, '2026-03-11.md'), 'No match here.');

      const results = await manager.searchMemory('Search term');
      // Should find matches in MEMORY.md and the 2026-03-10.md file
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    test('each result has file and matches array', async () => {
      await manager.writeMemory('Engineers work on code.');
      const results = await manager.searchMemory('Engineers');
      expect(results[0]).toHaveProperty('file');
      expect(results[0]).toHaveProperty('matches');
      expect(Array.isArray(results[0].matches)).toBe(true);
    });

    test('each match has line number and context', async () => {
      await manager.writeMemory('Line one.\nSearch term here.\nLine three.');
      const results = await manager.searchMemory('Search term');
      const match = results[0].matches[0];
      expect(match).toHaveProperty('line');
      expect(match).toHaveProperty('context');
      expect(typeof match.line).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // listFiles
  // -------------------------------------------------------------------------

  describe('listFiles', () => {
    test('returns empty array when no files exist', async () => {
      const files = await manager.listFiles();
      expect(files).toEqual([]);
    });

    test('includes MEMORY.md when it exists', async () => {
      await manager.writeMemory('some memory');
      const files = await manager.listFiles();
      expect(files.some((f) => f.endsWith('MEMORY.md'))).toBe(true);
    });

    test('includes daily log files', async () => {
      const memoryDir = path.join(tmpDir, 'memory', 'engineer');
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, '2026-03-10.md'), 'log content');

      const files = await manager.listFiles();
      expect(files.some((f) => f.endsWith('2026-03-10.md'))).toBe(true);
    });

    test('returns absolute file paths', async () => {
      await manager.writeMemory('content');
      const files = await manager.listFiles();
      for (const f of files) {
        expect(path.isAbsolute(f)).toBe(true);
      }
    });

    test('daily logs are sorted newest first', async () => {
      const memoryDir = path.join(tmpDir, 'memory', 'engineer');
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, '2026-01-01.md'), 'older');
      fs.writeFileSync(path.join(memoryDir, '2026-03-01.md'), 'newer');

      const files = await manager.listFiles();
      const dateFiles = files.filter((f) => /\d{4}-\d{2}-\d{2}\.md$/.test(f));
      expect(dateFiles[0]).toContain('2026-03-01');
      expect(dateFiles[1]).toContain('2026-01-01');
    });
  });

  // -------------------------------------------------------------------------
  // forChannel — static factory
  // -------------------------------------------------------------------------

  describe('MemoryManager.forChannel', () => {
    test('creates a manager scoped to the channel', () => {
      const mgr = MemoryManager.forChannel('slack:C01234567', tmpDir);
      expect(mgr).toBeInstanceOf(MemoryManager);
    });

    test('memory file path uses sanitized channel id', () => {
      const mgr = MemoryManager.forChannel('slack:C01234567', tmpDir);
      expect(mgr.memoryFile).toContain('slack-C01234567-memory.md');
      expect(mgr.memoryFile).toContain('channels');
    });

    test('agentId is set to sanitized channel id', () => {
      const mgr = MemoryManager.forChannel('telegram:-100123456789', tmpDir);
      expect(mgr.agentId).toBe('telegram--100123456789');
    });

    test('channel manager can write and read memory', async () => {
      const mgr = MemoryManager.forChannel('slack:C01234567', tmpDir);
      await mgr.writeMemory('# Channel Notes\nImportant context.');
      const content = await mgr.readMemory();
      expect(content).toBe('# Channel Notes\nImportant context.');
    });

    test('channel manager does not share memory with agent manager', async () => {
      const channelMgr = MemoryManager.forChannel('slack:C01234567', tmpDir);
      const agentMgr = new MemoryManager('engineer', tmpDir);

      await channelMgr.writeMemory('Channel memory content.');
      await agentMgr.writeMemory('Agent memory content.');

      expect(await channelMgr.readMemory()).toBe('Channel memory content.');
      expect(await agentMgr.readMemory()).toBe('Agent memory content.');
    });
  });
});
