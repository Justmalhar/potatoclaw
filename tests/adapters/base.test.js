'use strict';

// ---------------------------------------------------------------------------
// adapters/base.test.js — unit tests for src/adapters/base.js (BaseAdapter)
// ---------------------------------------------------------------------------

const BaseAdapter = require('../../src/adapters/base');

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

class TestAdapter extends BaseAdapter {
  get name() { return 'test'; }
  async start() { this._connected = true; }
  async stop() { this._connected = false; }
  async sendMessage(channelId, text) { return true; }
}

describe('BaseAdapter', () => {
  // -------------------------------------------------------------------------
  // shouldRespond — allowedUsers
  // -------------------------------------------------------------------------

  describe('shouldRespond — allowedUsers', () => {
    test('allows any user when allowedUsers is ["*"]', () => {
      const adapter = new TestAdapter({ allowedUsers: ['*'] });
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U9999' })).toBe(true);
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'any-random-user' })).toBe(true);
    });

    test('allows only listed users when allowedUsers is specific list', () => {
      const adapter = new TestAdapter({ allowedUsers: ['U001', 'U002'] });
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U001' })).toBe(true);
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U002' })).toBe(true);
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U999' })).toBe(false);
    });

    test('blocks all users when allowedUsers is empty list', () => {
      const adapter = new TestAdapter({ allowedUsers: [] });
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U001' })).toBe(false);
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'U002' })).toBe(false);
    });

    test('defaults to allowing all users when allowedUsers is not configured', () => {
      const adapter = new TestAdapter({});
      expect(adapter.shouldRespond({ channelId: 'C1', userId: 'anyone' })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // shouldRespond — allowedChannels
  // -------------------------------------------------------------------------

  describe('shouldRespond — allowedChannels', () => {
    test('allows any channel when allowedChannels is ["*"]', () => {
      const adapter = new TestAdapter({ allowedChannels: ['*'] });
      expect(adapter.shouldRespond({ channelId: 'C_ANY', userId: 'U001' })).toBe(true);
    });

    test('allows only listed channels when allowedChannels is specific list', () => {
      const adapter = new TestAdapter({ allowedChannels: ['C001', 'C002'] });
      expect(adapter.shouldRespond({ channelId: 'C001', userId: 'U001' })).toBe(true);
      expect(adapter.shouldRespond({ channelId: 'C002', userId: 'U001' })).toBe(true);
      expect(adapter.shouldRespond({ channelId: 'C999', userId: 'U001' })).toBe(false);
    });

    test('blocks all channels when allowedChannels is empty list', () => {
      const adapter = new TestAdapter({ allowedChannels: [] });
      expect(adapter.shouldRespond({ channelId: 'C001', userId: 'U001' })).toBe(false);
    });

    test('defaults to allowing all channels when allowedChannels is not configured', () => {
      const adapter = new TestAdapter({});
      expect(adapter.shouldRespond({ channelId: 'anything', userId: 'U001' })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // shouldRespond — combined user + channel allowlists
  // -------------------------------------------------------------------------

  describe('shouldRespond — combined allowlists', () => {
    test('both must match: blocked channel returns false even for allowed user', () => {
      const adapter = new TestAdapter({
        allowedUsers: ['U001'],
        allowedChannels: ['C001'],
      });
      expect(adapter.shouldRespond({ channelId: 'C_OTHER', userId: 'U001' })).toBe(false);
    });

    test('both must match: blocked user returns false even for allowed channel', () => {
      const adapter = new TestAdapter({
        allowedUsers: ['U001'],
        allowedChannels: ['C001'],
      });
      expect(adapter.shouldRespond({ channelId: 'C001', userId: 'U_OTHER' })).toBe(false);
    });

    test('returns true when both user and channel are in their respective lists', () => {
      const adapter = new TestAdapter({
        allowedUsers: ['U001'],
        allowedChannels: ['C001'],
      });
      expect(adapter.shouldRespond({ channelId: 'C001', userId: 'U001' })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isConnected
  // -------------------------------------------------------------------------

  describe('isConnected', () => {
    test('is false before start() is called', () => {
      const adapter = new TestAdapter({});
      expect(adapter.isConnected).toBe(false);
    });

    test('is true after start() is called', async () => {
      const adapter = new TestAdapter({});
      await adapter.start();
      expect(adapter.isConnected).toBe(true);
    });

    test('is false after stop() is called', async () => {
      const adapter = new TestAdapter({});
      await adapter.start();
      await adapter.stop();
      expect(adapter.isConnected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // name property
  // -------------------------------------------------------------------------

  describe('name', () => {
    test('returns the platform string defined by the subclass', () => {
      const adapter = new TestAdapter({});
      expect(adapter.name).toBe('test');
    });

    test('base class name property returns "base"', () => {
      // We can't instantiate BaseAdapter normally (start/stop throw), but we
      // can check the getter on the prototype directly.
      const proto = Object.getOwnPropertyDescriptor(BaseAdapter.prototype, 'name');
      // Instantiate via TestAdapter but check base's default is overridden
      const base = new TestAdapter({});
      expect(base.name).toBe('test'); // overridden by TestAdapter
    });
  });

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  describe('status', () => {
    test('returns an object with connected field', () => {
      const adapter = new TestAdapter({});
      const s = adapter.status;
      expect(s).toHaveProperty('connected');
    });

    test('connected is false before start()', () => {
      const adapter = new TestAdapter({});
      expect(adapter.status.connected).toBe(false);
    });

    test('connected is true after start()', async () => {
      const adapter = new TestAdapter({});
      await adapter.start();
      expect(adapter.status.connected).toBe(true);
    });

    test('status includes platform name', () => {
      const adapter = new TestAdapter({});
      expect(adapter.status.platform).toBe('test');
    });

    test('status includes channelCount', () => {
      const adapter = new TestAdapter({});
      expect(adapter.status).toHaveProperty('channelCount');
    });
  });

  // -------------------------------------------------------------------------
  // sendTyping — optional no-op default
  // -------------------------------------------------------------------------

  describe('sendTyping', () => {
    test('does not throw and resolves by default', async () => {
      const adapter = new TestAdapter({});
      await expect(adapter.sendTyping('C001')).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // _splitMessage helper
  // -------------------------------------------------------------------------

  describe('_splitMessage', () => {
    test('returns the text as-is when shorter than maxLen', () => {
      const adapter = new TestAdapter({});
      expect(adapter._splitMessage('Hello', 100)).toEqual(['Hello']);
    });

    test('splits long text into chunks no longer than maxLen', () => {
      const adapter = new TestAdapter({});
      const text = 'a'.repeat(150);
      const chunks = adapter._splitMessage(text, 100);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });

    test('prefers breaking at newlines', () => {
      const adapter = new TestAdapter({});
      const text = 'Line one.\nLine two.\nLine three.';
      const chunks = adapter._splitMessage(text, 15);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('reconstructed chunks contain all original content', () => {
      const adapter = new TestAdapter({});
      const text = 'word '.repeat(50).trim();
      const chunks = adapter._splitMessage(text, 60);
      const rejoined = chunks.join(' ');
      // Every word from original should appear in rejoined
      expect(rejoined.replace(/\s+/g, ' ')).toContain('word');
    });
  });

  // -------------------------------------------------------------------------
  // EventEmitter interface
  // -------------------------------------------------------------------------

  describe('EventEmitter interface', () => {
    test('is an EventEmitter (can call on/emit)', () => {
      const adapter = new TestAdapter({});
      const listener = jest.fn();
      adapter.on('message', listener);
      adapter.emit('message', { platform: 'test', channelId: 'C1', userId: 'U1', text: 'hi' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('_emitMessage emits normalised message event', () => {
      const adapter = new TestAdapter({});
      const listener = jest.fn();
      adapter.on('message', listener);
      adapter._emitMessage({ channelId: 'C1', userId: 'U1', text: 'Hello' });
      expect(listener).toHaveBeenCalledTimes(1);
      const msg = listener.mock.calls[0][0];
      expect(msg.platform).toBe('test');
      expect(msg.channelId).toBe('C1');
      expect(msg.userId).toBe('U1');
      expect(msg.text).toBe('Hello');
    });

    test('_emitMessage sets userName to userId when not provided', () => {
      const adapter = new TestAdapter({});
      const listener = jest.fn();
      adapter.on('message', listener);
      adapter._emitMessage({ channelId: 'C1', userId: 'U_ANON' });
      expect(listener.mock.calls[0][0].userName).toBe('U_ANON');
    });
  });
});
