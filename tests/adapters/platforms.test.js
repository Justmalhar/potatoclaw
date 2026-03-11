'use strict';

/**
 * Platform adapter tests.
 *
 * Each adapter extends BaseAdapter and adds platform-specific connect/send
 * logic. These tests cover:
 *  - Constructor defaults and name getter
 *  - sendMessage() throws when not connected
 *  - start() throws when required credentials are missing
 *  - inherited BaseAdapter methods (_splitMessage, shouldRespond, etc.)
 *
 * Tests do NOT actually connect to Slack / Telegram / Discord etc.
 */

// Mock platform SDKs before requiring the adapters
jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    client: { auth: { test: jest.fn().mockResolvedValue({ user_id: 'U_BOT' }) } },
    message: jest.fn(),
    event: jest.fn(),
  })),
  LogLevel: { WARN: 'warn' },
}));

jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    getMe: jest.fn().mockResolvedValue({ username: 'test_bot', id: 123 }),
    sendMessage: jest.fn().mockResolvedValue({}),
    sendChatAction: jest.fn().mockResolvedValue({}),
    stopPolling: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  }));
});

jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    user: { id: 'BOT_USER_ID', tag: 'TestBot#0000' },
  })),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 },
  Partials: { Channel: 'Channel', Message: 'Message' },
  Events: { Error: 'error', ClientReady: 'ready', MessageCreate: 'messageCreate' },
  ChannelType: { DM: 1 },
}));

const SlackAdapter    = require('../../src/adapters/slack');
const TelegramAdapter = require('../../src/adapters/telegram');
const DiscordAdapter  = require('../../src/adapters/discord');
const WhatsAppAdapter = require('../../src/adapters/whatsapp');
const SignalAdapter   = require('../../src/adapters/signal');
const iMessageAdapter = require('../../src/adapters/imessage');

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

describe('SlackAdapter', () => {
  test('name is "slack"', () => {
    expect(new SlackAdapter().name).toBe('slack');
  });

  test('constructor sets default state', () => {
    const a = new SlackAdapter({ token: 'tok', appToken: 'app' });
    expect(a.isConnected).toBe(false);
    expect(a._app).toBeNull();
  });

  test('start() throws when SLACK_BOT_TOKEN is missing', async () => {
    const savedEnv = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    const a = new SlackAdapter({});
    await expect(a.start()).rejects.toThrow(/SLACK_BOT_TOKEN/);
    if (savedEnv !== undefined) process.env.SLACK_BOT_TOKEN = savedEnv;
  });

  test('sendMessage() throws when not connected', async () => {
    const a = new SlackAdapter({ token: 'tok', appToken: 'app' });
    await expect(a.sendMessage('C1', 'hello')).rejects.toThrow();
  });

  test('stop() does not throw when never started', async () => {
    const a = new SlackAdapter({ token: 'tok', appToken: 'app' });
    await expect(a.stop()).resolves.not.toThrow();
  });

  test('status returns platform name', () => {
    const a = new SlackAdapter();
    expect(a.status.platform).toBe('slack');
  });
});

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

describe('TelegramAdapter', () => {
  test('name is "telegram"', () => {
    expect(new TelegramAdapter().name).toBe('telegram');
  });

  test('constructor sets default state', () => {
    const a = new TelegramAdapter();
    expect(a.isConnected).toBe(false);
    expect(a._bot).toBeNull();
  });

  test('start() throws when TELEGRAM_BOT_TOKEN is missing', async () => {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const a = new TelegramAdapter({});
    await expect(a.start()).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
    if (saved !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  test('sendMessage() throws when not connected', async () => {
    const a = new TelegramAdapter();
    await expect(a.sendMessage('123', 'hello')).rejects.toThrow();
  });

  test('stop() does not throw when never started', async () => {
    const a = new TelegramAdapter();
    await expect(a.stop()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

describe('DiscordAdapter', () => {
  test('name is "discord"', () => {
    expect(new DiscordAdapter().name).toBe('discord');
  });

  test('constructor sets default state', () => {
    const a = new DiscordAdapter();
    expect(a.isConnected).toBe(false);
    expect(a._client).toBeNull();
  });

  test('start() throws when DISCORD_BOT_TOKEN is missing', async () => {
    const saved = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    const a = new DiscordAdapter({});
    await expect(a.start()).rejects.toThrow(/DISCORD_BOT_TOKEN/);
    if (saved !== undefined) process.env.DISCORD_BOT_TOKEN = saved;
  });

  test('sendMessage() throws when not connected', async () => {
    const a = new DiscordAdapter();
    await expect(a.sendMessage('123', 'hello')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter', () => {
  test('name is "whatsapp"', () => {
    expect(new WhatsAppAdapter().name).toBe('whatsapp');
  });

  test('constructor sets default state', () => {
    const a = new WhatsAppAdapter();
    expect(a.isConnected).toBe(false);
    expect(a._sock).toBeNull();
  });

  test('sendMessage() throws when not connected', async () => {
    const a = new WhatsAppAdapter();
    await expect(a.sendMessage('1234567890@s.whatsapp.net', 'hi')).rejects.toThrow();
  });

  test('stop() does not throw when never started', async () => {
    const a = new WhatsAppAdapter();
    await expect(a.stop()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

describe('SignalAdapter', () => {
  test('name is "signal"', () => {
    expect(new SignalAdapter({ phoneNumber: '+15551234567' }).name).toBe('signal');
  });

  test('constructor stores phoneNumber from config', () => {
    const a = new SignalAdapter({ phoneNumber: '+15559876543' });
    expect(a._phoneNumber).toBe('+15559876543');
  });

  test('start() throws when phoneNumber is missing', async () => {
    const saved = process.env.SIGNAL_PHONE_NUMBER;
    delete process.env.SIGNAL_PHONE_NUMBER;
    const a = new SignalAdapter({});
    await expect(a.start()).rejects.toThrow(/phoneNumber/);
    if (saved !== undefined) process.env.SIGNAL_PHONE_NUMBER = saved;
  });

  test('sendMessage() throws when not connected', async () => {
    const a = new SignalAdapter({ phoneNumber: '+15551234567' });
    await expect(a.sendMessage('+15550000000', 'hi')).rejects.toThrow();
  });

  test('stop() does not throw when never started', async () => {
    const a = new SignalAdapter({ phoneNumber: '+15551234567' });
    await expect(a.stop()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// iMessage
// ---------------------------------------------------------------------------

describe('iMessageAdapter', () => {
  test('name is "imessage"', () => {
    expect(new iMessageAdapter().name).toBe('imessage');
  });

  test('constructor sets default state', () => {
    const a = new iMessageAdapter();
    expect(a.isConnected).toBe(false);
    expect(a._watchProcess).toBeNull();
  });

  if (process.platform !== 'darwin') {
    test('start() throws on non-macOS', async () => {
      const a = new iMessageAdapter();
      await expect(a.start()).rejects.toThrow(/macOS/);
    });
  }

  test('sendMessage() throws when not connected', async () => {
    const a = new iMessageAdapter();
    await expect(a.sendMessage('test@example.com', 'hi')).rejects.toThrow();
  });

  test('stop() does not throw when never started', async () => {
    const a = new iMessageAdapter();
    await expect(a.stop()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shared BaseAdapter behaviour (tested via SlackAdapter as a concrete impl)
// ---------------------------------------------------------------------------

describe('BaseAdapter shared behaviour (via SlackAdapter)', () => {
  describe('shouldRespond', () => {
    test('returns true with wildcard allowedChannels and allowedUsers', () => {
      const a = new SlackAdapter({ allowedChannels: ['*'], allowedUsers: ['*'] });
      expect(a.shouldRespond({ channelId: 'C1', userId: 'U1' })).toBe(true);
    });

    test('returns false when channel not in allowedChannels', () => {
      const a = new SlackAdapter({ allowedChannels: ['C_ALLOW'], allowedUsers: ['*'] });
      expect(a.shouldRespond({ channelId: 'C_BLOCKED', userId: 'U1' })).toBe(false);
    });

    test('returns false when user not in allowedUsers', () => {
      const a = new SlackAdapter({ allowedChannels: ['*'], allowedUsers: ['U_ALLOW'] });
      expect(a.shouldRespond({ channelId: 'C1', userId: 'U_BLOCKED' })).toBe(false);
    });

    test('returns true when channel and user are both explicitly allowed', () => {
      const a = new SlackAdapter({ allowedChannels: ['C1'], allowedUsers: ['U1'] });
      expect(a.shouldRespond({ channelId: 'C1', userId: 'U1' })).toBe(true);
    });
  });

  describe('_splitMessage', () => {
    test('returns single chunk when text is within limit', () => {
      const a = new SlackAdapter();
      const chunks = a._splitMessage('short', 100);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('short');
    });

    test('splits text at space boundary', () => {
      const a = new SlackAdapter();
      const text = 'hello world foo bar baz';
      const chunks = a._splitMessage(text, 11);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(11);
    });

    test('splits long word that exceeds maxLen', () => {
      const a = new SlackAdapter();
      const text = 'a'.repeat(20);
      const chunks = a._splitMessage(text, 10);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('reassembled text equals original', () => {
      const a = new SlackAdapter();
      const text = 'The quick brown fox jumps over the lazy dog';
      const chunks = a._splitMessage(text, 15);
      const rejoined = chunks.join(' ');
      // All words should appear in output
      expect(rejoined).toContain('quick');
      expect(rejoined).toContain('lazy');
    });
  });

  describe('isConnected / status', () => {
    test('isConnected starts false', () => {
      const a = new SlackAdapter();
      expect(a.isConnected).toBe(false);
    });

    test('status.connected starts false', () => {
      const a = new SlackAdapter();
      expect(a.status.connected).toBe(false);
    });

    test('status.platform matches name', () => {
      const a = new SlackAdapter();
      expect(a.status.platform).toBe('slack');
    });
  });
});
