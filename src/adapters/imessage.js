'use strict';

/**
 * iMessage adapter — uses the `imsg` CLI tool.
 *
 * macOS ONLY. Requires:
 *   - imsg installed (https://github.com/nicowillis/imsg or similar)
 *   - Full Disk Access granted to the terminal / Node process
 *     (System Settings → Privacy & Security → Full Disk Access)
 *
 * Config keys:
 *   imsgPath        {string}   – Path to imsg binary (env IMSG_PATH or ~/bin/imsg)
 *   allowedChannels {string[]} – iMessage chat identifiers or ['*']
 *   allowedUsers    {string[]} – Sender identifiers (phone/email) or ['*']
 *
 * Events emitted:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'
 *   'disconnected' { reason }
 *   'error'        Error
 */

const { spawn, execFile } = require('child_process');
const path   = require('path');
const os     = require('os');
const BaseAdapter = require('./base');

const DEFAULT_IMSG_PATH = process.env.IMSG_PATH
  || path.join(os.homedir(), 'bin', 'imsg');

class iMessageAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this._watchProcess = null;
    this._buffer       = '';
    this._imsgPath     = config.imsgPath || DEFAULT_IMSG_PATH;
  }

  get name() { return 'imessage'; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    if (process.platform !== 'darwin') {
      throw new Error('[iMessageAdapter] iMessage is macOS only');
    }

    return new Promise((resolve, reject) => {
      this._watchProcess = spawn(this._imsgPath, ['watch', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this._watchProcess.on('error', (err) => {
        this.log.error({ err, path: this._imsgPath }, 'Failed to start imsg watch');
        this.log.error('Ensure imsg is installed and Full Disk Access is granted');
        reject(err);
      });

      this._watchProcess.stdout.on('data', (data) => {
        this._handleData(data.toString());
      });

      this._watchProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) this.log.debug({ stderr: msg }, 'imsg stderr');
      });

      this._watchProcess.on('close', (code) => {
        this.log.warn({ code }, 'imsg watch process exited');
        this._watchProcess = null;
        this._connected    = false;
        this.emit('disconnected', { reason: `imsg exited with code ${code}` });
      });

      // Give the process a moment to start before resolving
      setTimeout(() => {
        if (this._watchProcess && !this._watchProcess.killed) {
          this._connected = true;
          this.log.info({ path: this._imsgPath }, 'iMessage adapter started');
          this.emit('connected');
          resolve();
        } else {
          reject(new Error('imsg watch process died immediately'));
        }
      }, 1500);
    });
  }

  async stop() {
    if (this._watchProcess) {
      this._watchProcess.kill('SIGTERM');
      this._watchProcess = null;
    }
    this._connected = false;
    this.log.info('iMessage adapter stopped');
    this.emit('disconnected', { reason: 'stop() called' });
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @param {string} channelId – iMessage chat identifier (chat_id from imsg)
   * @param {string} text
   * @param {object} [opts]   – unused for iMessage
   */
  async sendMessage(channelId, text, opts = {}) {
    return new Promise((resolve, reject) => {
      const args = ['send', '--chat-id', channelId.toString(), '--text', text];
      execFile(this._imsgPath, args, (err, stdout, stderr) => {
        if (err) {
          this.log.error({ err, stderr }, 'iMessage: failed to send message');
          return reject(err);
        }
        this.log.debug('iMessage: message sent');
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: parse streaming JSON output
  // ---------------------------------------------------------------------------

  _handleData(data) {
    this._buffer += data;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop(); // keep partial last line

    for (const line of lines) {
      if (!line.trim()) continue;
      let json;
      try {
        json = JSON.parse(line);
      } catch (_) {
        // Likely a log/status line — ignore
        if (!line.startsWith('[') && !line.includes('watching')) {
          this.log.debug({ line }, 'iMessage: non-JSON output');
        }
        continue;
      }
      this._handleMessage(json);
    }
  }

  _handleMessage(msg) {
    // imsg fields: rowid, guid, chat_id, chat_identifier, handle_id,
    //              sender, text, date, is_from_me, attachments, participants
    if (msg.is_from_me) return;

    const rawChatId   = msg.chat_id?.toString() || msg.chat_identifier;
    const text        = msg.text;
    const sender      = msg.sender || msg.handle_id;

    if (!rawChatId || !text) return;

    // channel identifier: prefer chat_identifier (e.g. email/phone) over numeric id
    const channelId = msg.chat_identifier || rawChatId;
    const userId    = sender || channelId;
    const userName  = sender || userId;

    const isGroup = !!(
      (msg.chat_identifier && msg.chat_identifier.includes(',')) ||
      (msg.participants && msg.participants.length > 2)
    );

    this.log.debug(
      { channelId, sender, text: text.substring(0, 60) },
      'iMessage: received message'
    );

    const message = {
      channelId,
      userId,
      userName,
      text,
      image: null,
      isGroup,
      raw: msg,
    };

    if (!this.shouldRespond(message)) {
      this.log.debug({ channelId, userId }, 'iMessage: skipped (not in allowlist)');
      return;
    }

    this._emitMessage(message);
  }
}

module.exports = iMessageAdapter;
