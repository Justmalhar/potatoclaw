'use strict';

// ---------------------------------------------------------------------------
// helpers.test.js — unit tests for src/utils/helpers.js
// ---------------------------------------------------------------------------

const {
  sanitizeKey,
  formatDuration,
  truncate,
  generateId,
  retry,
  ensureDir,
  deepMerge,
  jsonSafeStringify,
} = require('../../src/utils/helpers');

const os = require('os');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// sanitizeKey
// ---------------------------------------------------------------------------

describe('sanitizeKey', () => {
  test('replaces colons with underscores', () => {
    expect(sanitizeKey('potatoclaw:engineer:slack:channel:C01234'))
      .toBe('potatoclaw_engineer_slack_channel_C01234');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeKey('hello world')).toBe('hello_world');
  });

  test('collapses consecutive special chars into single underscore', () => {
    expect(sanitizeKey('a:::b')).toBe('a_b');
    expect(sanitizeKey('a   b')).toBe('a_b');
  });

  test('strips leading and trailing underscores', () => {
    expect(sanitizeKey(':leading')).toBe('leading');
    expect(sanitizeKey('trailing:')).toBe('trailing');
    expect(sanitizeKey(':::both:::')).toBe('both');
  });

  test('leaves alphanumeric, dash, underscore, and dot intact', () => {
    expect(sanitizeKey('abc-def_ghi.jkl')).toBe('abc-def_ghi.jkl');
  });

  test('handles empty string', () => {
    expect(sanitizeKey('')).toBe('');
  });

  test('converts non-string input to string first', () => {
    expect(sanitizeKey(42)).toBe('42');
    expect(sanitizeKey(null)).toBe('null');
  });

  test('handles slashes (path traversal chars)', () => {
    expect(sanitizeKey('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  test('handles at-sign and hash', () => {
    expect(sanitizeKey('user@example.com#tag')).toBe('user_example.com_tag');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  test('0ms returns "0ms"', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  test('sub-second returns ms', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  test('exactly 1000ms returns "1s"', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  test('65000ms returns "1m 5s"', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  test('3661000ms returns "1h 1m 1s"', () => {
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
  });

  test('exactly 1 minute returns "1m"', () => {
    expect(formatDuration(60000)).toBe('1m');
  });

  test('exactly 1 hour returns "1h"', () => {
    expect(formatDuration(3600000)).toBe('1h');
  });

  test('332000ms (5m 32s) formats correctly', () => {
    expect(formatDuration(332000)).toBe('5m 32s');
  });

  test('negative ms returns "0ms"', () => {
    expect(formatDuration(-1)).toBe('0ms');
  });

  test('NaN returns "0ms"', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });

  test('non-number returns "0ms"', () => {
    expect(formatDuration('abc')).toBe('0ms');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  test('short string unchanged', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });

  test('string exactly at limit is not truncated', () => {
    expect(truncate('Hello', 5)).toBe('Hello');
  });

  test('string over limit is truncated with ellipsis', () => {
    expect(truncate('Hello, World!', 8)).toBe('Hello...');
  });

  test('len of 0 returns empty string', () => {
    expect(truncate('Hello', 0)).toBe('');
  });

  test('len of 1 returns "."', () => {
    expect(truncate('Hello', 1)).toBe('.');
  });

  test('len of 3 returns "..."', () => {
    expect(truncate('Hello, World!', 3)).toBe('...');
  });

  test('len of 4 returns first char + "..."', () => {
    expect(truncate('Hello', 4)).toBe('H...');
  });

  test('converts non-string to string', () => {
    expect(truncate(12345, 3)).toBe('...');
    expect(truncate(12345, 6)).toBe('12345');
  });
});

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  test('without prefix returns 12-char hex string', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  test('with prefix returns prefix_<12-char hex>', () => {
    const id = generateId('run');
    expect(id).toMatch(/^run_[0-9a-f]{12}$/);
  });

  test('with task prefix', () => {
    const id = generateId('task');
    expect(id).toMatch(/^task_[0-9a-f]{12}$/);
  });

  test('successive calls produce different IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId('x')));
    // All 50 should be unique — chance of collision is negligible
    expect(ids.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

describe('retry', () => {
  // Use delayMs=0 to avoid any actual sleeping in these tests.
  // The real retry() calls sleep(0) which still yields to the event loop,
  // but Promise.resolve() plus async/await handles that fine without fake timers.

  test('succeeds on first try without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retry(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('succeeds on the Nth try', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error(`attempt ${calls} failed`));
      return Promise.resolve('success');
    });

    const result = await retry(fn, 3, 0);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws last error after max attempts', async () => {
    const err = new Error('always fails');
    const fn = jest.fn().mockRejectedValue(err);

    await expect(retry(fn, 3, 0)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('default attempts is 3', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(retry(fn, undefined, 0)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('returns value from successful call', async () => {
    const fn = jest.fn().mockResolvedValue({ data: 42 });
    const result = await retry(fn, 1, 0);
    expect(result).toEqual({ data: 42 });
  });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe('ensureDir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-helpers-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates a new directory', () => {
    const target = path.join(tmpDir, 'new-dir');
    expect(fs.existsSync(target)).toBe(false);
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  test('creates nested directories (mkdir -p behaviour)', () => {
    const target = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  test('is idempotent — calling twice does not throw', () => {
    const target = path.join(tmpDir, 'idempotent');
    ensureDir(target);
    expect(() => ensureDir(target)).not.toThrow();
  });

  test('throws when dirPath is empty', () => {
    expect(() => ensureDir('')).toThrow('ensureDir: dirPath is required');
  });
});

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe('deepMerge', () => {
  test('shallow override', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 9 })).toEqual({ a: 1, b: 9 });
  });

  test('deep nested merge', () => {
    expect(
      deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 9 } })
    ).toEqual({ a: { x: 1, y: 9 } });
  });

  test('arrays in overrides replace base arrays', () => {
    expect(
      deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] })
    ).toEqual({ arr: [4, 5] });
  });

  test('new keys in overrides are added', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test('does not mutate base object', () => {
    const base = { a: 1 };
    deepMerge(base, { b: 2 });
    expect(base).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// jsonSafeStringify
// ---------------------------------------------------------------------------

describe('jsonSafeStringify', () => {
  test('serialises normal objects', () => {
    expect(jsonSafeStringify({ a: 1 })).toBe('{"a":1}');
  });

  test('handles circular references', () => {
    const obj = { a: 1 };
    obj.self = obj;
    expect(() => jsonSafeStringify(obj)).not.toThrow();
    expect(jsonSafeStringify(obj)).toContain('[Circular]');
  });

  test('respects indent argument', () => {
    const result = jsonSafeStringify({ a: 1 }, 2);
    expect(result).toContain('\n');
  });
});
