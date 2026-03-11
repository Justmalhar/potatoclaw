'use strict';

/**
 * Discord adapter — uses discord.js v14.
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN  – Discord bot token
 *
 * Config keys:
 *   token             {string}   – bot token (falls back to env)
 *   allowedGuilds     {string[]} – guild (server) snowflake IDs or ['*']
 *   allowedChannels   {string[]} – channel snowflake IDs or ['*']
 *   allowedUsers      {string[]} – user snowflake IDs or ['*']
 *   respondToMentions {boolean}  – guild channels: only respond when @mentioned (default: true)
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 */

const { Client, GatewayIntentBits, Partials, Events, ChannelType } = require('discord.js');
const BaseAdapter = require('./base');

const DISCORD_MAX_CHARS = 2000;

class DiscordAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this._client = null;
  }

  get name() { return 'discord'; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    const token = this.config.token || process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('[DiscordAdapter] Missing DISCORD_BOT_TOKEN');

    this._client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this._client.on(Events.Error, (err) => {
      this.log.error({ err }, 'Discord client error');
      this.emit('error', err);
    });

    this._client.on(Events.ClientReady, (client) => {
      this._connected = true;
      this.log.info({ tag: client.user.tag }, 'Discord connected');
      this.emit('connected');
    });

    this._client.on(Events.MessageCreate, async (message) => {
      try {
        await this._handleMessage(message);
      } catch (err) {
        this.log.error({ err }, 'Error handling Discord message');
        this.emit('error', err);
      }
    });

    this._client.on(Events.ShardDisconnect, (event) => {
      this._connected = false;
      this.log.warn({ code: event.code }, 'Discord shard disconnected');
      this.emit('disconnected', { reason: `shard disconnect: ${event.code}` });
    });

    await this._client.login(token);

    // login() resolves before ready — await the ready event
    await new Promise((resolve, reject) => {
      const onReady = () => { resolve(); };
      const onError = (err) => { reject(err); };
      this._client.once(Events.ClientReady, onReady);
      this._client.once(Events.Error, onError);
      // Clean up whichever fires second
      setTimeout(() => {
        this._client.off(Events.ClientReady, onReady);
        this._client.off(Events.Error, onError);
      }, 30000);
    });
  }

  async stop() {
    if (this._client) {
      try { await this._client.destroy(); } catch (_) {}
      this._client = null;
    }
    this._connected = false;
    this.log.info('Discord adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string} channelId  – Discord channel snowflake
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.replyToMessageId] – Message snowflake to reply to
   * @param {string} [opts.threadTs]         – Thread ID (Discord uses threadId)
   */
  async sendMessage(channelId, text, opts = {}) {
    if (!this._client) throw new Error('DiscordAdapter: not connected');

    // Resolve the target channel — could be a thread
    const targetId  = opts.threadTs || channelId;
    const channel   = await this._client.channels.fetch(targetId).catch(() => null);
    if (!channel) {
      throw new Error(`DiscordAdapter: channel ${targetId} not found`);
    }

    const chunks = text.length > DISCORD_MAX_CHARS
      ? this._splitMessage(text, DISCORD_MAX_CHARS)
      : [text];

    for (let i = 0; i < chunks.length; i++) {
      const msgOpts = { content: chunks[i] };
      // Only reply on the first chunk to avoid repeated reply headers
      if (i === 0 && opts.replyToMessageId) {
        msgOpts.reply = { messageReference: opts.replyToMessageId };
      }
      await channel.send(msgOpts);
    }
  }

  async sendTyping(channelId) {
    if (!this._client) return;
    try {
      const channel = await this._client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.sendTyping) {
        await channel.sendTyping();
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Internal message handler
  // ---------------------------------------------------------------------------

  async _handleMessage(message) {
    // Ignore bots (including self)
    if (message.author.bot) return;

    const isDM      = message.channel.type === ChannelType.DM;
    const channelId = message.channelId;
    const userId    = message.author.id;
    const userName  = message.member?.displayName || message.author.username;
    const guildId   = message.guildId || null;

    // Guild check
    if (guildId) {
      const allowedGuilds = this.config.allowedGuilds || ['*'];
      if (!allowedGuilds.includes('*') && !allowedGuilds.includes(guildId)) {
        this.log.debug({ guildId }, 'Discord: guild not in allowlist');
        return;
      }
    }

    // Mention check for guild channels
    const botUser      = this._client.user;
    const wasMentioned = message.mentions.has(botUser);
    const respondToMentions = this.config.respondToMentions !== false; // default true

    if (!isDM && respondToMentions && !wasMentioned) return;

    // Strip @mention tokens from text
    let text = message.content
      .replace(/<@!?[0-9]+>/g, '')
      .trim();

    // Download first image attachment, if any
    let image = null;
    for (const [, attachment] of message.attachments) {
      if (attachment.contentType && attachment.contentType.startsWith('image/')) {
        try {
          const resp = await fetch(attachment.url);
          const buf  = Buffer.from(await resp.arrayBuffer());
          image = { data: buf.toString('base64'), mediaType: attachment.contentType.split(';')[0] };
          this.log.debug({ url: attachment.url }, 'Discord image downloaded');
        } catch (err) {
          this.log.warn({ err }, 'Failed to download Discord image');
        }
        break;
      }
    }

    if (!text && !image) return;
    if (!text && image) text = '[Image]';

    const msg = {
      channelId,
      userId,
      userName,
      text,
      image,
      raw: message,
    };

    if (!this.shouldRespond(msg)) return;

    this._emitMessage(msg);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  get status() {
    return {
      connected:    this._connected,
      platform:     this.name,
      channelCount: this._channelCount,
      guilds:       this._client ? this._client.guilds.cache.size : 0,
    };
  }
}

module.exports = DiscordAdapter;
