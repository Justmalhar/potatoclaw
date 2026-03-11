'use strict';

// ---------------------------------------------------------------------------
// tools/filesystem.test.js — unit tests for src/tools/filesystem.js
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');
const { createFilesystemTool } = require('../../src/tools/filesystem');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-fs-test-'));
}

// Helper: find a tool by name from the tools array
function getTool(tools, name) {
  return tools.find((t) => t.name === name);
}

describe('createFilesystemTool', () => {
  let tmpDir;
  let tool;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tool = createFilesystemTool({ workspacePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Module shape
  // -------------------------------------------------------------------------

  describe('module shape', () => {
    test('returns object with name, version, tools, and workspacePath', () => {
      expect(tool.name).toBe('filesystem');
      expect(tool.version).toBeDefined();
      expect(Array.isArray(tool.tools)).toBe(true);
      expect(tool.workspacePath).toBe(tmpDir);
    });

    test('exposes read_file, write_file, list_directory, delete_file, search_files tools', () => {
      const names = tool.tools.map((t) => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('write_file');
      expect(names).toContain('list_directory');
      expect(names).toContain('delete_file');
      expect(names).toContain('search_files');
    });
  });

  // -------------------------------------------------------------------------
  // read_file
  // -------------------------------------------------------------------------

  describe('read_file', () => {
    test('reads an existing file from the workspace', async () => {
      const filePath = path.join(tmpDir, 'hello.txt');
      fs.writeFileSync(filePath, 'Hello, world!', 'utf-8');

      const readFile = getTool(tool.tools, 'read_file');
      const { result } = await readFile.handler({ path: 'hello.txt' });
      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello, world!');
    });

    test('returns success:false for a non-existent file', async () => {
      const readFile = getTool(tool.tools, 'read_file');
      const { result } = await readFile.handler({ path: 'no-such-file.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('returns success:false when path points to a directory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'mydir'));
      const readFile = getTool(tool.tools, 'read_file');
      const { result } = await readFile.handler({ path: 'mydir' });
      expect(result.success).toBe(false);
    });

    test('result includes path and sizeBytes on success', async () => {
      fs.writeFileSync(path.join(tmpDir, 'sized.txt'), 'abc', 'utf-8');
      const readFile = getTool(tool.tools, 'read_file');
      const { result } = await readFile.handler({ path: 'sized.txt' });
      expect(result.path).toBe('sized.txt');
      expect(result.sizeBytes).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // write_file
  // -------------------------------------------------------------------------

  describe('write_file', () => {
    test('creates a file with the given content', async () => {
      const writeFile = getTool(tool.tools, 'write_file');
      const { result } = await writeFile.handler({ path: 'output.txt', content: 'Created!' });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'output.txt'), 'utf-8')).toBe('Created!');
    });

    test('creates nested directories as needed', async () => {
      const writeFile = getTool(tool.tools, 'write_file');
      const { result } = await writeFile.handler({
        path: 'deep/nested/dir/file.txt',
        content: 'Nested content',
      });
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'deep', 'nested', 'dir', 'file.txt'))).toBe(true);
    });

    test('overwrites an existing file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'overwrite.txt'), 'old content', 'utf-8');
      const writeFile = getTool(tool.tools, 'write_file');
      await writeFile.handler({ path: 'overwrite.txt', content: 'new content' });
      expect(fs.readFileSync(path.join(tmpDir, 'overwrite.txt'), 'utf-8')).toBe('new content');
    });

    test('result includes sizeBytes on success', async () => {
      const writeFile = getTool(tool.tools, 'write_file');
      const { result } = await writeFile.handler({ path: 'sized.txt', content: 'hello' });
      expect(result.sizeBytes).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Path traversal protection
  // -------------------------------------------------------------------------

  describe('path traversal protection', () => {
    test('read_file with "../../../etc/passwd" returns error (no throw)', async () => {
      const readFile = getTool(tool.tools, 'read_file');
      const { result } = await readFile.handler({ path: '../../../etc/passwd' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace/i);
    });

    test('write_file with traversal path returns error', async () => {
      const writeFile = getTool(tool.tools, 'write_file');
      const { result } = await writeFile.handler({
        path: '../../evil.txt',
        content: 'pwned',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace/i);
    });

    test('list_directory with traversal path returns error', async () => {
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({ path: '../..' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace/i);
    });

    test('delete_file with traversal path returns error', async () => {
      const deleteFile = getTool(tool.tools, 'delete_file');
      const { result } = await deleteFile.handler({ path: '../../../tmp/target.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace/i);
    });
  });

  // -------------------------------------------------------------------------
  // list_directory
  // -------------------------------------------------------------------------

  describe('list_directory', () => {
    test('lists files and directories in the workspace root', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
      fs.mkdirSync(path.join(tmpDir, 'subdir'));

      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({});
      expect(result.success).toBe(true);
      const names = result.entries.map((e) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('subdir');
    });

    test('each entry has name, type, size, modified fields', async () => {
      fs.writeFileSync(path.join(tmpDir, 'entry.txt'), 'content');
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({});
      const entry = result.entries.find((e) => e.name === 'entry.txt');
      expect(entry).toBeDefined();
      expect(entry.type).toBe('file');
      expect(entry.size).toBeGreaterThan(0);
      expect(entry.modified).toBeTruthy();
    });

    test('directory entries have type "directory"', async () => {
      fs.mkdirSync(path.join(tmpDir, 'mysubdir'));
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({});
      const dirEntry = result.entries.find((e) => e.name === 'mysubdir');
      expect(dirEntry.type).toBe('directory');
    });

    test('lists a subdirectory when path is provided', async () => {
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'inner.txt'), 'inner');
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({ path: 'sub' });
      expect(result.success).toBe(true);
      expect(result.entries.some((e) => e.name === 'inner.txt')).toBe(true);
    });

    test('returns error for non-existent directory', async () => {
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({ path: 'no-such-dir' });
      expect(result.success).toBe(false);
    });

    test('returns count equal to entries length', async () => {
      fs.writeFileSync(path.join(tmpDir, 'f1.txt'), '1');
      fs.writeFileSync(path.join(tmpDir, 'f2.txt'), '2');
      const listDir = getTool(tool.tools, 'list_directory');
      const { result } = await listDir.handler({});
      expect(result.count).toBe(result.entries.length);
    });
  });

  // -------------------------------------------------------------------------
  // delete_file
  // -------------------------------------------------------------------------

  describe('delete_file', () => {
    test('deletes an existing file', async () => {
      const filePath = path.join(tmpDir, 'to-delete.txt');
      fs.writeFileSync(filePath, 'bye');
      const deleteFile = getTool(tool.tools, 'delete_file');
      const { result } = await deleteFile.handler({ path: 'to-delete.txt' });
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('returns error when file does not exist', async () => {
      const deleteFile = getTool(tool.tools, 'delete_file');
      const { result } = await deleteFile.handler({ path: 'ghost.txt' });
      expect(result.success).toBe(false);
    });

    test('returns error when path is a directory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'adir'));
      const deleteFile = getTool(tool.tools, 'delete_file');
      const { result } = await deleteFile.handler({ path: 'adir' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // search_files
  // -------------------------------------------------------------------------

  describe('search_files', () => {
    test('finds files containing the search query', async () => {
      fs.writeFileSync(path.join(tmpDir, 'match.txt'), 'The secret phrase is here.');
      fs.writeFileSync(path.join(tmpDir, 'nomatch.txt'), 'Nothing relevant.');
      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'secret phrase' });
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.file.includes('match.txt'))).toBe(true);
      expect(result.matches.every((m) => !m.file.includes('nomatch.txt'))).toBe(true);
    });

    test('search is case-insensitive', async () => {
      fs.writeFileSync(path.join(tmpDir, 'case.txt'), 'CaseSensitive test line.');
      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'casesensitive' });
      expect(result.count).toBeGreaterThan(0);
    });

    test('each match has file, line number, and content', async () => {
      fs.writeFileSync(path.join(tmpDir, 'info.txt'), 'line one\nfind this line\nline three');
      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'find this' });
      expect(result.matches.length).toBeGreaterThan(0);
      const match = result.matches[0];
      expect(match).toHaveProperty('file');
      expect(match).toHaveProperty('line');
      expect(match).toHaveProperty('content');
      expect(typeof match.line).toBe('number');
    });

    test('returns empty matches when query does not match anything', async () => {
      fs.writeFileSync(path.join(tmpDir, 'nothing.txt'), 'no match here at all');
      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'xyz-unique-noexist-xyz' });
      expect(result.count).toBe(0);
      expect(result.matches).toEqual([]);
    });

    test('searches recursively into subdirectories', async () => {
      fs.mkdirSync(path.join(tmpDir, 'deep'));
      fs.writeFileSync(path.join(tmpDir, 'deep', 'nested.txt'), 'deep search target here');
      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'deep search target' });
      expect(result.count).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.file.includes('nested.txt'))).toBe(true);
    });

    test('can be scoped to a subdirectory path', async () => {
      fs.writeFileSync(path.join(tmpDir, 'root-level.txt'), 'match in root');
      fs.mkdirSync(path.join(tmpDir, 'scope'));
      fs.writeFileSync(path.join(tmpDir, 'scope', 'scoped.txt'), 'match in scope');

      const searchFiles = getTool(tool.tools, 'search_files');
      const { result } = await searchFiles.handler({ query: 'match', path: 'scope' });
      expect(result.success).toBe(true);
      // Should only find the file in the scope directory
      expect(result.matches.every((m) => !m.file.includes('root-level.txt'))).toBe(true);
    });
  });
});
