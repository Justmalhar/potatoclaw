'use strict';

/**
 * Signal adapter — uses the system `signal-cli` binary in JSON-RPC mode.
 *
 * Prerequisites:
 *   signal-cli installed and registered: https://github.com/AsamK/signal-cli
 *   signal-cli register -u +15551234567
 *   signal-cli verify -u +15551234567 --code 123456
 *
 * Config keys:
 *   phoneNumber     {string}   – REQUIRED. Registered phone number (e.g. +15551234567)
 *   signalCliPath   {string}   – Path to signal-cli binary (default: 'signal-cli')
 *   allowedChannels {string[]} – Phone numbers or group.<base64id> or ['*']
 *   allowedUsers    {string[]} – Sender phone numbers or ['*']
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 */

const { spawn }         = require('child_process');
const { createInterface } = require('readline');
const BaseAdapter       = require('./base');

class SignalAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this._process      = null;
    this._phoneNumber  = config.phoneNumber  || process.env.SIGNAL_PHONE_NUMBER;
    this._cliPath      = config.signalCliPath || process.env.SIGNAL_CLI_PATH || 'signal-cli';
  }

  get name() { return 'signal'; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    if (!this._phoneNumber) {
      throw new Error('[SignalAdapter] phoneNumber is required (e.g. +15551234567)');
    }

    this.log.info({ phoneNumber: this._phoneNumber }, 'Starting signal-cli daemon');

    this._process = spawn(this._cliPath, ['-u', this._phoneNumber, 'jsonRpc'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this._process.stdout });

    rl.on('line', async (line) => {
      let data;
      try { data = JSON.parse(line); } catch (_) { return; }
      if (data.method === 'receive') {
        try {
          await this._handleMessage(data.params);
        } catch (err) {
          this.log.error({ err }, 'Error handling Signal message');
          this.emit('error', err);
        }
      }
    });

    this._process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('DEBUG')) {
        this.log.debug({ stderr: msg }, 'signal-cli stderr');
      }
    });

    this._process.on('error', (err) => {
      this.log.error({ err }, 'signal-cli process error');
      this.emit('error', err);
    });

    this._process.on('close', (code) => {
      this.log.warn({ code }, 'signal-cli process exited');
      this._process   = null;
      this._connected = false;
      this.emit('disconnected', { reason: `process exited with code ${code}` });
    });

    this._connected = true;
    this.log.info({ phoneNumber: this._phoneNumber }, 'Signal adapter started');
    this.emit('connected');
  }

  async stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
    this._connected = false;
    this.log.info('Signal adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string} channelId – Phone number (+15551234567) or "group.<base64id>"
   * @param {string} text
   * @param {object} [opts]   – unused for Signal
   */
  async sendMessage(channelId, text, opts = {}) {
    return new Promise((resolve, reject) => {
      const isGroup = channelId.startsWith('group.');
      const args = ['-u', this._phoneNumber, 'send', '-m', text];

      if (isGroup) {
        args.push('-g', channelId.replace('group.', ''));
      } else {
        args.push(channelId);
      }

      const proc = spawn(this._cliPath, args);

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`signal-cli send exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on('error', reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal message handler
  // ---------------------------------------------------------------------------

  async _handleMessage(params) {
    const envelope = params?.envelope;
    if (!envelope) return;

    // Skip own messages
    if (envelope.source === this._phoneNumber) return;

    const dataMessage = envelope.dataMessage;
    if (!dataMessage) return;

    const text = dataMessage.message || '';
    if (!text) return;

    const isGroup = !!dataMessage.groupInfo;
    const channelId = isGroup
      ? `group.${dataMessage.groupInfo.groupId}`
      : envelope.source;

    const userId   = envelope.source;
    const userName = envelope.sourceNumber || envelope.sourceName || userId;

    // Mention detection
    const mentions    = dataMessage.mentions || [];
    const isMentioned = mentions.some(m => m.number === this._phoneNumber);

    const message = {
      channelId,
      userId,
      userName,
      text,
      image: null, // TODO: attachment download via signal-cli 'receive' --output-dir
      isMentioned,
      raw: envelope,
    };

    if (!this.shouldRespond(message)) return;

    this._emitMessage(message);
  }
}

module.exports = SignalAdapter;
