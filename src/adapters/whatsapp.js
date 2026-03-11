'use strict';

/**
 * WhatsApp adapter — uses @whiskeysockets/baileys.
 *
 * No required env vars (credentials are persisted via QR scan).
 *
 * Config keys:
 *   dataDir           {string}   – Base directory for auth state (default: /data)
 *   allowedChannels   {string[]} – WhatsApp JIDs or ['*'] (default: ['*'])
 *                                  Maps to both DM JIDs and group JIDs.
 *   allowedUsers      {string[]} – Sender JIDs or ['*'] (default: ['*'])
 *   allowedGroups     {string[]} – Group JIDs or ['*'] (default: ['*'])
 *                                  Legacy alias; merged with allowedChannels.
 *   respondToMentionsOnly {boolean} – In groups, only reply when mentioned (default: false)
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 *   'qr'           qrString   – QR code string for scanning
 */

const path      = require('path');
const BaseAdapter = require('./base');

// Baileys is an ESM package; we import it dynamically so this CJS file works.
let makeWASocket, useMultiFileAuthState, DisconnectReason,
    fetchLatestBaileysVersion, downloadMediaMessage;

async function loadBaileys() {
  if (makeWASocket) return; // already loaded
  const mod = await import('@whiskeysockets/baileys');
  makeWASocket              = mod.default;
  useMultiFileAuthState     = mod.useMultiFileAuthState;
  DisconnectReason          = mod.DisconnectReason;
  fetchLatestBaileysVersion = mod.fetchLatestBaileysVersion;
  downloadMediaMessage      = mod.downloadMediaMessage;
}

class WhatsAppAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this._sock           = null;
    this._myJid          = null;
    this._myLid          = null;
    this._latestQr       = null;
    this._sentMessageIds = new Set();
    this._lidToPhone     = new Map();
    this._phoneToLid     = new Map();
    this._jidMap         = new Map();

    // Normalise allowedDMs (legacy) and allowedChannels to full JIDs
    this._allowedDMs = this._normaliseJids(
      this.config.allowedChannels || this.config.allowedDMs || ['*']
    );
    this._allowedGroups = this._normaliseJids(
      this.config.allowedGroups || ['*']
    );
  }

  get name() { return 'whatsapp'; }

  /** Latest QR code string (if not yet authenticated). */
  get latestQr() { return this._latestQr; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    await loadBaileys();

    const dataDir = this.config.dataDir || '/data';
    const authDir = path.join(dataDir, 'auth', 'auth_whatsapp');

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version }          = await fetchLatestBaileysVersion();

    // Pino logger — silence Baileys internal logs
    const { default: pino } = await import('pino');
    const logger = pino({ level: 'silent' });

    this._sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
    });

    this._sock.ev.on('connection.update', (update) => {
      this._onConnectionUpdate(update, saveCreds);
    });

    this._sock.ev.on('creds.update', saveCreds);

    // Learn LID↔phone from contact events
    const learnContacts = (contacts) => {
      for (const c of contacts) {
        if (c.id && c.lid) this._mapContact(c.id, c.lid);
      }
    };
    this._sock.ev.on('contacts.upsert', learnContacts);
    this._sock.ev.on('contacts.update', learnContacts);
    this._sock.ev.on('messaging-history.set', ({ contacts }) => {
      if (contacts?.length) learnContacts(contacts);
    });

    this._sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          await this._handleMessage(msg);
        } catch (err) {
          this.log.error({ err }, 'Error handling WhatsApp message');
          this.emit('error', err);
        }
      }
    });

    this.log.info('WhatsApp adapter starting...');
  }

  async stop() {
    if (this._sock) {
      try { this._sock.end(); } catch (_) {}
      this._sock = null;
    }
    this._connected = false;
    this.log.info('WhatsApp adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string} channelId – JID (phone@s.whatsapp.net or group@g.us)
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.replyToMessageId] – key.id of message to quote
   */
  async sendMessage(channelId, text, opts = {}) {
    if (!this._sock) throw new Error('WhatsAppAdapter: not connected');

    const targetJid = this._jidMap.get(channelId) || channelId;
    const msgContent = { text };

    if (opts.replyToMessageId) {
      // Quoted message reply
      msgContent.quoted = { key: { id: opts.replyToMessageId, remoteJid: targetJid } };
    }

    const sentMsg = await this._sock.sendMessage(targetJid, msgContent);

    // Track sent ID to suppress echo in self-DMs
    if (sentMsg?.key?.id) {
      this._sentMessageIds.add(sentMsg.key.id);
      setTimeout(() => this._sentMessageIds.delete(sentMsg.key.id), 10000);
    }
  }

  async sendTyping(channelId) {
    if (!this._sock) return;
    try {
      await this._sock.sendPresenceUpdate('composing', channelId);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Internal: connection lifecycle
  // ---------------------------------------------------------------------------

  _onConnectionUpdate(update, saveCreds) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this._latestQr = qr;
      this.emit('qr', qr);
      // Also print to terminal for convenience
      try {
        const qrcodeTerminal = require('qrcode-terminal');
        this.log.info('\n[WhatsApp] Scan QR code to connect:');
        qrcodeTerminal.generate(qr, { small: true });
      } catch (_) {}
    }

    if (connection === 'open') {
      this._latestQr = null;
      this._myJid    = this._sock.user?.id  || null;
      this._myLid    = this._sock.user?.lid || null;
      this._connected = true;
      this.log.info({ jid: this._myJid, lid: this._myLid }, 'WhatsApp connected');
      this.emit('connected');

      // Auto-allow self-DM
      if (!this._allowedDMs.includes('*')) {
        if (this._myJid) {
          const selfPhone = this._myJid.replace(/:.*@/, '@');
          if (!this._allowedDMs.includes(selfPhone)) {
            this._allowedDMs.push(selfPhone);
          }
        }
        if (this._myLid) {
          const selfLid = this._myLid.replace(/:.*@/, '@');
          if (!this._allowedDMs.includes(selfLid)) {
            this._allowedDMs.push(selfLid);
          }
        }
      }

      // Seed own LID↔phone map
      if (this._myJid && this._myLid) this._mapContact(this._myJid, this._myLid);

      // Resolve any phone numbers to LIDs
      this._resolveAllowlist();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      this.log.warn({ statusCode }, 'WhatsApp connection closed');
      this._connected = false;

      if (statusCode === DisconnectReason.loggedOut) {
        this.log.error('WhatsApp logged out — delete auth folder and restart');
        this.emit('disconnected', { reason: 'logged out' });
      } else if (this._myJid) {
        this.log.info('WhatsApp reconnecting...');
        this.emit('disconnected', { reason: `status ${statusCode}` });
        this.start().catch((err) => {
          this.log.error({ err }, 'WhatsApp reconnect failed');
          this.emit('error', err);
        });
      } else {
        this.log.warn('WhatsApp QR expired — restart to try again');
        this.emit('disconnected', { reason: 'QR expired' });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: message handler
  // ---------------------------------------------------------------------------

  async _handleMessage(msg) {
    // Skip bot's own sent messages echoing back
    if (msg.key.fromMe) {
      if (this._sentMessageIds.has(msg.key.id)) {
        this._sentMessageIds.delete(msg.key.id);
        return;
      }
      // Allow self-DMs through (user messaging themselves)
    }

    const jid      = msg.key.remoteJid;
    const isGroup  = jid?.endsWith('@g.us');
    const sender   = isGroup ? msg.key.participant : jid;

    // Allow-list checks
    if (!isGroup) {
      if (!this._isAllowedDM(jid)) return;
    } else {
      if (this._allowedGroups.length === 0) return;
      if (!this._allowedGroups.includes('*') && !this._allowedGroups.includes(jid)) return;
    }

    // Extract text
    let text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || msg.message?.videoMessage?.caption
      || '';

    // Mention detection for groups
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const myNum    = this._myJid?.split('@')[0]?.split(':')[0];
    const myLidNum = this._myLid?.split('@')[0]?.split(':')[0];
    const isMentioned = mentions.some((m) => {
      const base = m.split('@')[0]?.split(':')[0];
      return (myNum && base === myNum) || (myLidNum && base === myLidNum);
    });

    // Group mention-only gate
    if (isGroup && this.config.respondToMentionsOnly && !isMentioned) return;

    // Download image
    let image = null;
    if (msg.message?.imageMessage) {
      const buf = await this._downloadImage(msg);
      if (buf) {
        image = { data: buf.toString('base64'), mediaType: 'image/jpeg' };
        if (!text) text = '[Image]';
      }
    }

    if (!text && !image) return;

    const channelId = jid;
    const userId    = sender || jid;

    const message = {
      channelId,
      userId,
      userName: userId,
      text,
      image,
      raw: msg,
    };

    // allowedUsers check via base shouldRespond
    if (!this.shouldRespond(message)) return;

    this._emitMessage(message);
  }

  // ---------------------------------------------------------------------------
  // Internal: helpers
  // ---------------------------------------------------------------------------

  async _downloadImage(msg) {
    try {
      const { default: pino } = await import('pino');
      const buffer = await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: pino({ level: 'silent' }), reuploadRequest: this._sock.updateMediaMessage }
      );
      return buffer;
    } catch (err) {
      this.log.warn({ err }, 'WhatsApp: failed to download image');
      return null;
    }
  }

  async _resolveAllowlist() {
    const phoneEntries = this._allowedDMs.filter(e => e.endsWith('@s.whatsapp.net'));
    if (!phoneEntries.length || this._allowedDMs.includes('*')) return;

    for (const phoneJid of phoneEntries) {
      if (this._phoneToLid.has(phoneJid)) continue;
      const num = phoneJid.replace('@s.whatsapp.net', '');
      try {
        const [result] = await this._sock.onWhatsApp(num);
        if (result?.lid) {
          const lid = result.lid.replace(/:.*@/, '@');
          this._mapContact(phoneJid, lid);
          if (!this._allowedDMs.includes(lid)) this._allowedDMs.push(lid);
          this.log.debug({ num, lid }, 'WhatsApp: resolved phone → LID');
        }
      } catch (err) {
        this.log.debug({ num, err: err.message }, 'WhatsApp: could not resolve number');
      }
    }
  }

  _mapContact(phoneJid, lidJid) {
    const phone = phoneJid.replace(/:.*@/, '@');
    const lid   = lidJid.replace(/:.*@/, '@');
    this._lidToPhone.set(lid, phone);
    this._phoneToLid.set(phone, lid);
  }

  _isAllowedDM(chatId) {
    if (this._allowedDMs.includes('*')) return true;
    if (this._allowedDMs.includes(chatId)) return true;
    const alt = this._lidToPhone.get(chatId) || this._phoneToLid.get(chatId);
    if (alt && this._allowedDMs.includes(alt)) return true;
    return false;
  }

  _normaliseJids(entries) {
    return (entries || []).map(entry => {
      if (entry === '*') return entry;
      if (entry.includes('@')) return entry;
      return `${entry}@s.whatsapp.net`;
    });
  }
}

module.exports = WhatsAppAdapter;
