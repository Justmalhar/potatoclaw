'use strict';

/**
 * BaseAdapter — abstract base class for all messaging platform adapters.
 *
 * Subclasses MUST implement:
 *   - start()
 *   - stop()
 *   - sendMessage(channelId, text, opts)
 *
 * Subclasses SHOULD override:
 *   - sendTyping(channelId)
 *   - get name()
 *
 * Events emitted on `this`:
 *   'message'      { platform, channelId, userId, userName, text, image, raw }
 *   'connected'    {}
 *   'disconnected' { reason }
 *   'error'        Error
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class BaseAdapter extends EventEmitter {
  /**
   * @param {object} config
   * @param {string[]} [config.allowedUsers]    - User IDs or ['*'] for all
   * @param {string[]} [config.allowedChannels] - Channel IDs or ['*'] for all
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this._connected = false;
    this._channelCount = 0;
    this.log = logger.child({ adapter: this.name });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — must be implemented by subclass
  // ---------------------------------------------------------------------------

  /** Connect to the platform and begin listening. */
  async start() {
    throw new Error(`${this.constructor.name}.start() must be implemented`);
  }

  /** Disconnect gracefully. */
  async stop() {
    throw new Error(`${this.constructor.name}.stop() must be implemented`);
  }

  // ---------------------------------------------------------------------------
  // Messaging — must be implemented by subclass
  // ---------------------------------------------------------------------------

  /**
   * Send a text message to a channel.
   * @param {string} channelId
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.replyToMessageId]  - Platform message ID to reply to
   * @param {string} [opts.threadTs]          - Thread timestamp (Slack)
   */
  async sendMessage(channelId, text, opts = {}) {
    throw new Error(`${this.constructor.name}.sendMessage() must be implemented`);
  }

  /** Send a typing indicator where the platform supports it. No-op by default. */
  async sendTyping(channelId) {
    // Optional; subclasses override
  }

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  /** Platform identifier string, e.g. 'slack', 'telegram'. Override in subclass. */
  get name() {
    return 'base';
  }

  get isConnected() {
    return this._connected;
  }

  get status() {
    return {
      connected: this._connected,
      platform: this.name,
      channelCount: this._channelCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Allow-list gating
  // ---------------------------------------------------------------------------

  /**
   * Check whether we should respond to an inbound message based on the
   * configured allowedUsers and allowedChannels lists.
   *
   * Both lists support the '*' wildcard meaning "allow all".
   *
   * @param {object} message
   * @param {string} message.channelId
   * @param {string} message.userId
   * @returns {boolean}
   */
  shouldRespond(message) {
    const { channelId, userId } = message;
    const allowedChannels = this.config.allowedChannels || ['*'];
    const allowedUsers    = this.config.allowedUsers    || ['*'];

    // Channel check
    if (!allowedChannels.includes('*') && !allowedChannels.includes(channelId)) {
      this.log.debug({ channelId }, 'Blocked: channel not in allowlist');
      return false;
    }

    // User check
    if (!allowedUsers.includes('*') && !allowedUsers.includes(userId)) {
      this.log.debug({ userId }, 'Blocked: user not in allowlist');
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Helpers for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Emit a normalised inbound message event.
   * @param {object} msg
   * @param {string} msg.channelId
   * @param {string} msg.userId
   * @param {string} [msg.userName]
   * @param {string} [msg.text]
   * @param {object} [msg.image]   - { data: base64, mediaType }
   * @param {*}      [msg.raw]     - platform-native event object
   */
  _emitMessage(msg) {
    this.emit('message', {
      platform:  this.name,
      channelId: msg.channelId,
      userId:    msg.userId,
      userName:  msg.userName || msg.userId,
      text:      msg.text     || '',
      image:     msg.image    || null,
      raw:       msg.raw      || null,
    });
  }

  /**
   * Split a long string into chunks no longer than `maxLen` characters,
   * breaking at newlines or spaces where possible.
   * @param {string} text
   * @param {number} maxLen
   * @returns {string[]}
   */
  _splitMessage(text, maxLen) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let breakPoint = remaining.lastIndexOf('\n', maxLen);
      if (breakPoint === -1 || breakPoint < maxLen / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLen);
      }
      if (breakPoint === -1 || breakPoint < maxLen / 2) {
        breakPoint = maxLen;
      }
      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }
    return chunks;
  }

  /**
   * Exponential-backoff delay helper.
   * @param {number} attempt  - 0-based attempt index
   * @param {number} [base]   - base ms (default 1000)
   * @param {number} [cap]    - ceiling ms (default 60000)
   * @returns {Promise<void>}
   */
  _backoff(attempt, base = 1000, cap = 60000) {
    const ms = Math.min(cap, base * 2 ** attempt);
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseAdapter;
