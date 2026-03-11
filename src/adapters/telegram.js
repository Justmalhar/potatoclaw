'use strict';

/**
 * Telegram adapter — uses node-telegram-bot-api with long-polling.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN  – token from @BotFather
 *
 * Config keys:
 *   token           {string}   – bot token (falls back to env)
 *   allowedChannels {string[]} – Telegram chat IDs (as strings) or ['*']
 *   allowedUsers    {string[]} – Telegram user IDs (as strings) or ['*']
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 */

const TelegramBot = require('node-telegram-bot-api');
const BaseAdapter = require('./base');

const TELEGRAM_MAX_CHARS = 4096;

class TelegramAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this._bot     = null;
    this._botInfo = null;
  }

  get name() { return 'telegram'; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    const token = this.config.token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('[TelegramAdapter] Missing TELEGRAM_BOT_TOKEN');

    this._bot = new TelegramBot(token, { polling: true });

    this._botInfo = await this._bot.getMe();
    this.log.info({ username: this._botInfo.username }, 'Telegram connected');

    this._bot.on('message', async (msg) => {
      try {
        await this._handleMessage(msg);
      } catch (err) {
        this.log.error({ err }, 'Error handling Telegram message');
        this.emit('error', err);
      }
    });

    this._bot.on('polling_error', (err) => {
      this.log.error({ err }, 'Telegram polling error');
      this.emit('error', err);
    });

    this._connected = true;
    this.emit('connected');
  }

  async stop() {
    if (this._bot) {
      try { await this._bot.stopPolling(); } catch (_) {}
      this._bot = null;
    }
    this._connected = false;
    this.log.info('Telegram adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string|number} channelId – Telegram chat ID
   * @param {string} text
   * @param {object} [opts]
   * @param {number|string} [opts.replyToMessageId] – message_id to reply to
   */
  async sendMessage(channelId, text, opts = {}) {
    if (!this._bot) throw new Error('TelegramAdapter: not connected');

    const sendOpts = {};
    if (opts.replyToMessageId) {
      sendOpts.reply_to_message_id = opts.replyToMessageId;
    }

    const chunks = text.length > TELEGRAM_MAX_CHARS
      ? this._splitMessage(text, TELEGRAM_MAX_CHARS)
      : [text];

    for (const chunk of chunks) {
      await this._bot.sendMessage(channelId, chunk, sendOpts);
    }
  }

  async sendTyping(channelId) {
    if (!this._bot) return;
    try {
      await this._bot.sendChatAction(channelId, 'typing');
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Internal message handler
  // ---------------------------------------------------------------------------

  async _handleMessage(msg) {
    if (!msg.text && !msg.photo && !msg.caption) return;

    const channelId = msg.chat.id.toString();
    const userId    = msg.from?.id?.toString() || channelId;
    const userName  = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
                      || msg.from?.username
                      || userId;
    const isGroup   = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    let text = msg.text || msg.caption || '';

    // Check for @mention
    const botUsername = this._botInfo?.username;
    let wasMentioned  = false;
    if (botUsername && text.includes(`@${botUsername}`)) {
      wasMentioned = true;
      text = text.replace(`@${botUsername}`, '').trim();
    }

    // In groups: only respond when @mentioned (unless allowedChannels forces it)
    if (isGroup && !wasMentioned) {
      // Respect channel-level override if the channel is in allowedChannels explicitly
      const allowedChannels = this.config.allowedChannels || ['*'];
      if (!allowedChannels.includes('*')) {
        // Channel is explicitly listed — allow regardless of mention
        // (operator opted in this channel fully)
      } else {
        // Wildcard — still require mention in groups
        return;
      }
    }

    // Download image (use largest size)
    let image = null;
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      try {
        const fileLink = await this._bot.getFileLink(photo.file_id);
        const resp     = await fetch(fileLink);
        const buf      = Buffer.from(await resp.arrayBuffer());
        image = { data: buf.toString('base64'), mediaType: 'image/jpeg' };
        this.log.debug({ bytes: buf.length }, 'Telegram image downloaded');
      } catch (err) {
        this.log.warn({ err }, 'Failed to download Telegram image');
      }
      if (!text) text = '[Image]';
    }

    if (!text && !image) return;

    const message = {
      channelId,
      userId,
      userName,
      text,
      image,
      raw: msg,
    };

    if (!this.shouldRespond(message)) return;

    this._emitMessage(message);
  }
}

module.exports = TelegramAdapter;
