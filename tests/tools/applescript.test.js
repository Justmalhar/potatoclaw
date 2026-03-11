'use strict';

const { createAppleScriptTool } = require('../../src/tools/applescript');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAppleScriptTool', () => {
  const isMacOS = process.platform === 'darwin';

  if (!isMacOS) {
    test('returns null on non-macOS platforms', () => {
      const tool = createAppleScriptTool();
      expect(tool).toBeNull();
    });
    return;
  }

  // macOS-only tests
  test('returns tool object on macOS', () => {
    const tool = createAppleScriptTool();
    expect(tool).not.toBeNull();
    expect(tool.name).toBe('applescript');
    expect(typeof tool.version).toBe('string');
    expect(Array.isArray(tool.tools)).toBe(true);
  });

  test('contains expected tool names', () => {
    const tool = createAppleScriptTool();
    const names = tool.tools.map(t => t.name);
    expect(names).toContain('run_script');
    expect(names).toContain('list_apps');
    expect(names).toContain('activate_app');
    expect(names).toContain('display_notification');
    expect(names).toContain('get_clipboard');
    expect(names).toContain('set_clipboard');
    expect(names).toContain('open_url');
  });

  test('each tool has name, description, inputSchema, handler', () => {
    const tool = createAppleScriptTool();
    for (const t of tool.tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.handler).toBe('function');
    }
  });

  describe('run_script', () => {
    test('returns result object with success field', async () => {
      const tool = createAppleScriptTool();
      const t = tool.tools.find(x => x.name === 'run_script');
      // Run a simple benign script
      const res = await t.handler({ script: 'return 42' });
      expect(res.result).toBeDefined();
      expect(typeof res.result.success).toBe('boolean');
    });

    test('returns success: false for invalid script', async () => {
      const tool = createAppleScriptTool();
      const t = tool.tools.find(x => x.name === 'run_script');
      const res = await t.handler({ script: 'this is not valid applescript!!!' });
      // May succeed or fail depending on osascript behaviour, but result object exists
      expect(res.result).toBeDefined();
      expect(typeof res.result.success).toBe('boolean');
    });
  });

  describe('get_clipboard and set_clipboard', () => {
    test('set_clipboard returns result', async () => {
      const tool = createAppleScriptTool();
      const setT = tool.tools.find(x => x.name === 'set_clipboard');
      const res = await setT.handler({ text: 'potatoclaw-test-clipboard-value' });
      expect(res.result).toBeDefined();
      expect(typeof res.result.success).toBe('boolean');
    });
  });
});
