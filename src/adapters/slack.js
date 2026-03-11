'use strict';

/**
 * Slack adapter — uses @slack/bolt with Socket Mode.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN  – xoxb-…
 *   SLACK_APP_TOKEN  – xapp-…  (Socket Mode app-level token)
 *
 * Config keys (all optional unless noted):
 *   token             {string}   – SLACK_BOT_TOKEN (falls back to env)
 *   appToken          {string}   – SLACK_APP_TOKEN (falls back to env)
 *   allowedChannels   {string[]} – Slack channel IDs or ['*']  (default: ['*'])
 *   allowedUsers      {string[]} – Slack user IDs  or ['*']  (default: ['*'])
 *   respondToMentions {boolean}  – In channels, only respond when @mentioned (default: true)
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 */

const { App, LogLevel } = require('@slack/bolt');
const BaseAdapter = require('./base');

const SLACK_MAX_CHARS = 3000;

class SlackAdapter extends BaseAdapter {
  /**
   * @param {object} config
   */
  constructor(config = {}) {
    super(config);
    this._app         = null;
    this._botUserId   = null;
    this._retryCount  = 0;
  }

  get name() { return 'slack'; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    const token    = this.config.token    || process.env.SLACK_BOT_TOKEN;
    const appToken = this.config.appToken || process.env.SLACK_APP_TOKEN;

    if (!token)    throw new Error('[SlackAdapter] Missing SLACK_BOT_TOKEN');
    if (!appToken) throw new Error('[SlackAdapter] Missing SLACK_APP_TOKEN');

    this._app = new App({
      token,
      appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    this._registerHandlers();

    try {
      await this._app.start();
      const auth = await this._app.client.auth.test();
      this._botUserId = auth.user_id;
      this._connected = true;
      this._retryCount = 0;
      this.log.info({ botUserId: this._botUserId }, 'Slack connected');
      this.emit('connected');
    } catch (err) {
      this.log.error({ err }, 'Slack connection failed');
      this.emit('error', err);
      await this._reconnect();
    }
  }

  async stop() {
    if (this._app) {
      try { await this._app.stop(); } catch (_) {}
      this._app = null;
    }
    this._connected = false;
    this.log.info('Slack adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string} channelId
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.threadTs]        – reply in this thread
   * @param {string} [opts.replyToMessageId]
   */
  async sendMessage(channelId, text, opts = {}) {
    if (!this._app) throw new Error('SlackAdapter: not connected');

    const chunks = text.length > SLACK_MAX_CHARS
      ? this._splitMessage(text, SLACK_MAX_CHARS)
      : [text];

    for (const chunk of chunks) {
      const params = {
        channel: channelId,
        text:    chunk,
      };
      if (opts.threadTs) {
        params.thread_ts = opts.threadTs;
      }
      await this._app.client.chat.postMessage(params);
    }
  }

  /** Slack doesn't have a native typing indicator over Socket Mode, so we skip it. */
  async sendTyping(_channelId) {
    // No-op — Slack socket mode doesn't expose the typing indicator API
  }

  // ---------------------------------------------------------------------------
  // Internal: event registration
  // ---------------------------------------------------------------------------

  _registerHandlers() {
    // 1. app_mention — bot is @mentioned in any channel
    this._app.event('app_mention', async ({ event, client, say }) => {
      try {
        await this._handleSlackEvent(event, client, { wasMentioned: true });
      } catch (err) {
        this.log.error({ err, event }, 'Error handling app_mention');
        this.emit('error', err);
      }
    });

    // 2. Direct messages (channel type = 'im') — always respond
    this._app.message(async ({ message, client }) => {
      try {
        if (!message.subtype) { // ignore bot messages, edits, etc.
          await this._handleSlackEvent(message, client, { wasMentioned: false });
        }
      } catch (err) {
        this.log.error({ err, message }, 'Error handling message');
        this.emit('error', err);
      }
    });

    // 3. Optional slash command: /potatoclaw
    try {
      this._app.command('/potatoclaw', async ({ command, ack, client }) => {
        await ack();
        try {
          const syntheticEvent = {
            channel:       command.channel_id,
            user:          command.user_id,
            text:          command.text,
            ts:            command.trigger_id,
            thread_ts:     null,
            channel_type:  'channel',
          };
          await this._handleSlackEvent(syntheticEvent, client, { wasMentioned: true, isCommand: true });
        } catch (err) {
          this.log.error({ err }, 'Error handling /potatoclaw command');
        }
      });
    } catch (_) {
      // Commands are optional; if the app token doesn't have the scope, ignore.
    }

    // Error handler
    this._app.error(async (err) => {
      this.log.error({ err }, 'Slack Bolt error');
      this.emit('error', err);
      if (!this._connected) return;
      this._connected = false;
      this.emit('disconnected', { reason: err.message });
      await this._reconnect();
    });
  }

  /**
   * Central message processor for Slack events.
   * @param {object} event  – Slack event payload
   * @param {object} client – Slack WebClient instance
   * @param {object} meta
   * @param {boolean} meta.wasMentioned
   * @param {boolean} [meta.isCommand]
   */
  async _handleSlackEvent(event, client, meta = {}) {
    const channelId   = event.channel;
    const userId      = event.user;
    const isDM        = event.channel_type === 'im';
    const threadTs    = event.thread_ts || null;
    const respondToMentions = this.config.respondToMentions !== false; // default true

    // In non-DM channels: only respond to @mentions unless respondToMentions is disabled
    if (!isDM && respondToMentions && !meta.wasMentioned && !meta.isCommand) {
      return;
    }

    // Skip bot's own messages
    if (userId === this._botUserId) return;

    // Strip the @mention text so the agent doesn't see "<@U12345>"
    let text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

    // Download image if present (file_share subtype or files array)
    let image = null;
    const files = event.files || [];
    for (const file of files) {
      if (file.mimetype && file.mimetype.startsWith('image/')) {
        try {
          const resp = await fetch(file.url_private, {
            headers: { Authorization: `Bearer ${this._app.client.token}` },
          });
          const buf = Buffer.from(await resp.arrayBuffer());
          image = { data: buf.toString('base64'), mediaType: file.mimetype };
          this.log.debug({ fileId: file.id }, 'Image downloaded from Slack');
        } catch (err) {
          this.log.warn({ err, fileId: file.id }, 'Failed to download Slack image');
        }
        break; // only first image
      }
    }

    if (!text && !image) return;
    if (!text && image) text = '[Image]';

    // Look up user's display name
    let userName = userId;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || userId;
    } catch (_) {}

    const message = {
      channelId,
      userId,
      userName,
      text,
      image,
      threadTs,  // pass through so gateway can use it for replies
      raw: event,
    };

    if (!this.shouldRespond(message)) return;

    this._emitMessage(message);
  }

  // ---------------------------------------------------------------------------
  // Internal: reconnect with exponential backoff
  // ---------------------------------------------------------------------------

  async _reconnect() {
    this._retryCount++;
    this.log.info({ attempt: this._retryCount }, 'Slack: scheduling reconnect...');
    await this._backoff(this._retryCount - 1);
    this.log.info('Slack: attempting reconnect...');
    try {
      await this.start();
    } catch (err) {
      this.log.error({ err }, 'Slack reconnect failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  get status() {
    return {
      connected:    this._connected,
      platform:     this.name,
      channelCount: this._channelCount,
      botUserId:    this._botUserId,
    };
  }
}

module.exports = SlackAdapter;
