'use strict';

/**
 * Gateway — main message router and adapter orchestrator.
 *
 * Responsibilities:
 *   - Load and start all enabled adapters
 *   - Wire inbound message events to the orchestrator
 *   - Dispatch slash commands to CommandHandler
 *   - Resolve channel → agent binding via ChannelRegistry
 *   - Serve a lightweight HTTP server (health + WhatsApp QR)
 */

const http = require('http');
const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4096', 10);

class Gateway extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object}  opts.config           - Application config
   * @param {import('../core/agent-registry')} opts.agentRegistry
   * @param {import('../channels/registry')}   opts.channelRegistry
   * @param {import('../channels/context')}    opts.channelContext
   * @param {import('./orchestrator')}         opts.orchestrator
   * @param {import('../commands/handler')}    opts.commandHandler
   * @param {import('../tools/cron').CronScheduler} [opts.cronScheduler]
   */
  constructor({ config, agentRegistry, channelRegistry, channelContext, orchestrator, commandHandler, cronScheduler }) {
    super();

    this.config = config || {};
    this.agentRegistry = agentRegistry;
    this.channelRegistry = channelRegistry;
    this.channelContext = channelContext;
    this.orchestrator = orchestrator;
    this.commandHandler = commandHandler;
    this.cronScheduler = cronScheduler || null;

    /** @type {Map<string, Object>} platform → adapter */
    this.adapters = new Map();

    this._httpServer = null;
    this._log = createLogger('gateway');
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  async start() {
    this._log.info('Gateway starting');

    await this._loadAdapters();
    this._startHttpServer();

    if (this.cronScheduler) {
      this.cronScheduler.on('execute', (event) => this._handleCronExecute(event));
    }

    this._log.info({ port: GATEWAY_PORT }, 'Gateway ready');
    this.emit('ready');
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async stop() {
    this._log.info('Gateway stopping');

    if (this.cronScheduler) this.cronScheduler.stop();

    for (const [platform, adapter] of this.adapters) {
      try {
        if (typeof adapter.stop === 'function') await adapter.stop();
      } catch (err) {
        this._log.warn({ platform, err: err.message }, 'Error stopping adapter');
      }
    }

    if (this._httpServer) {
      await new Promise((resolve) => this._httpServer.close(resolve));
    }

    this._log.info('Gateway stopped');
  }

  // ---------------------------------------------------------------------------
  // Adapter status / lookup
  // ---------------------------------------------------------------------------

  getAdapterStatus() {
    const result = [];
    for (const [platform, adapter] of this.adapters) {
      result.push({
        platform,
        connected: !!(adapter.connected || adapter.sock || adapter.bot || adapter.client),
        ...('getStatus' in adapter ? adapter.getStatus() : {}),
      });
    }
    return result;
  }

  getAdapter(platform) {
    return this.adapters.get(platform) || null;
  }

  // ---------------------------------------------------------------------------
  // Inbound message handler
  // ---------------------------------------------------------------------------

  /**
   * Called by each adapter's onMessage callback.
   * @param {Object} adapter   - Adapter instance
   * @param {Object} event     - { platform, channelId, userId, text, image?, raw? }
   */
  async handleMessage(adapter, event) {
    const { platform, channelId, userId, text, image } = event;

    this._log.debug({ platform, channelId, userId, textLen: text && text.length }, 'Inbound message');

    // 1. Check shouldRespond (adapter-level filter)
    if (typeof adapter.shouldRespond === 'function' && !adapter.shouldRespond(event)) {
      this._log.debug({ platform, channelId }, 'shouldRespond returned false — dropping');
      return;
    }

    // 2. Slash command?
    if (this.commandHandler && this.commandHandler.isCommand(text)) {
      try {
        const response = await this.commandHandler.handle(text, { platform, channelId, userId, adapter });
        if (response) {
          await this._sendSafe(adapter, channelId, response);
        }
      } catch (err) {
        this._log.error({ err: err.message }, 'Command handler error');
        await this._sendSafe(adapter, channelId, `Error: ${err.message}`);
      }
      return;
    }

    // 3. Look up channel binding → agentId
    let binding = this.channelRegistry.get(platform, channelId);

    // 4. Fall back to default agent if configured and no binding
    if (!binding) {
      const defaultAgentId = this.config.defaultAgentId || null;
      if (!defaultAgentId) {
        this._log.debug({ platform, channelId }, 'No binding and no default agent — dropping message');
        return;
      }
      binding = { agentId: defaultAgentId };
    }

    const { agentId } = binding;

    // 5. Build channel context
    let ctx = {};
    if (this.channelContext) {
      try {
        ctx = await this.channelContext.buildContext(platform, channelId);
      } catch (err) {
        this._log.warn({ err: err.message }, 'Failed to build channel context');
      }
    }

    // 6. Session key
    const sessionKey = `potatoclaw:${agentId}:${platform}:channel:${channelId}`;

    // 7. Enqueue for processing
    this.orchestrator.enqueueChannelMessage(agentId, {
      sessionKey,
      text: text || '',
      image: image || null,
      adapter,
      channelId,
      platform,
      channelContext: ctx,
    });

    // 8. Async: append message to transcript
    if (this.channelContext && text) {
      this.channelContext
        .appendMessage(platform, channelId, { role: 'user', content: text })
        .catch((err) => this._log.warn({ err: err.message }, 'appendMessage failed'));
    }
  }

  // ---------------------------------------------------------------------------
  // Cron execution handler
  // ---------------------------------------------------------------------------

  async _handleCronExecute({ jobId, channelId, agentId, message, invokeAgent }) {
    this._log.info({ jobId, channelId, invokeAgent }, 'Cron job firing');

    if (!channelId) {
      this._log.warn({ jobId }, 'Cron job has no channelId — skipping');
      return;
    }

    const { platform, channelId: rawChannelId } = this._parseChannelId(channelId);
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      this._log.warn({ jobId, platform }, 'No adapter for cron job platform');
      return;
    }

    if (invokeAgent) {
      // Determine the agent for this channel
      const binding = this.channelRegistry.get(platform, rawChannelId);
      const targetAgentId = agentId || (binding && binding.agentId);
      if (!targetAgentId) {
        this._log.warn({ jobId, channelId }, 'Cannot invoke agent — no agentId resolved for cron job');
        return;
      }

      const sessionKey = `potatoclaw:${targetAgentId}:cron:job:${jobId}`;
      this.orchestrator.enqueueChannelMessage(targetAgentId, {
        sessionKey,
        text: message,
        image: null,
        adapter,
        channelId: rawChannelId,
        platform,
        channelContext: {},
      });
    } else {
      await this._sendSafe(adapter, rawChannelId, message);
    }
  }

  // ---------------------------------------------------------------------------
  // Adapter loading
  // ---------------------------------------------------------------------------

  async _loadAdapters() {
    const platformConfigs = {
      slack: () => this._loadSlack(),
      telegram: () => this._loadTelegram(),
      discord: () => this._loadDiscord(),
      whatsapp: () => this._loadWhatsApp(),
      signal: () => this._loadSignal(),
      imessage: () => this._loadiMessage(),
    };

    for (const [platform, loader] of Object.entries(platformConfigs)) {
      const cfg = this.config[platform];
      if (!cfg || !cfg.enabled) {
        this._log.debug({ platform }, 'Platform disabled — skipping');
        continue;
      }
      try {
        await loader();
        this._log.info({ platform }, 'Adapter started');
      } catch (err) {
        this._log.error({ platform, err: err.message }, 'Failed to start adapter');
      }
    }
  }

  async _loadSlack() {
    const SlackAdapter = require('../adapters/slack');
    const adapter = new SlackAdapter(this.config.slack);
    this._wireAdapter(adapter, 'slack');
    this.adapters.set('slack', adapter);
    await adapter.start();
  }

  async _loadTelegram() {
    const TelegramAdapter = require('../adapters/telegram');
    const adapter = new TelegramAdapter(this.config.telegram);
    this._wireAdapter(adapter, 'telegram');
    this.adapters.set('telegram', adapter);
    await adapter.start();
  }

  async _loadDiscord() {
    const DiscordAdapter = require('../adapters/discord');
    const adapter = new DiscordAdapter(this.config.discord);
    this._wireAdapter(adapter, 'discord');
    this.adapters.set('discord', adapter);
    await adapter.start();
  }

  async _loadWhatsApp() {
    const WhatsAppAdapter = require('../adapters/whatsapp');
    const adapter = new WhatsAppAdapter(this.config.whatsapp);
    this._wireAdapter(adapter, 'whatsapp');
    this.adapters.set('whatsapp', adapter);
    await adapter.start();
  }

  async _loadSignal() {
    const SignalAdapter = require('../adapters/signal');
    const adapter = new SignalAdapter(this.config.signal);
    this._wireAdapter(adapter, 'signal');
    this.adapters.set('signal', adapter);
    await adapter.start();
  }

  async _loadiMessage() {
    const iMessageAdapter = require('../adapters/imessage');
    const adapter = new iMessageAdapter(this.config.imessage);
    this._wireAdapter(adapter, 'imessage');
    this.adapters.set('imessage', adapter);
    await adapter.start();
  }

  /**
   * Wire an adapter's onMessage callback into this.handleMessage.
   */
  _wireAdapter(adapter, platform) {
    if (typeof adapter.onMessage !== 'function') {
      this._log.warn({ platform }, 'Adapter has no onMessage method');
      return;
    }

    adapter.onMessage(async (event) => {
      // Normalize event to include platform
      const normalized = { platform, channelId: event.chatId || event.channelId, ...event };
      await this.handleMessage(adapter, normalized).catch((err) => {
        this._log.error({ platform, err: err.message }, 'handleMessage error');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP server (health + QR)
  // ---------------------------------------------------------------------------

  _startHttpServer() {
    this._httpServer = http.createServer(async (req, res) => {
      if (req.url === '/qr' || req.url === '/qr/') {
        await this._handleQrRoute(res);
        return;
      }

      // Default: health check
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        ts: new Date().toISOString(),
        adapters: this.getAdapterStatus(),
        agents: this.agentRegistry ? this.agentRegistry.list().map((a) => ({
          id: a.id,
          status: a.status,
          queueDepth: a.queueDepth,
        })) : [],
      }, null, 2));
    });

    this._httpServer.listen(GATEWAY_PORT, () => {
      this._log.info({ port: GATEWAY_PORT }, `HTTP server listening (QR at /qr)`);
    });

    this._httpServer.on('error', (err) => {
      this._log.error({ err: err.message }, 'HTTP server error');
    });
  }

  async _handleQrRoute(res) {
    const wa = this.adapters.get('whatsapp');

    const html = (body) => `<!DOCTYPE html><html><head>
      <meta charset="utf-8"><meta http-equiv="refresh" content="10">
      <title>WhatsApp QR — PotatoClaw</title>
      <style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;
        justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}
        img{border-radius:12px;margin-top:16px}</style>
    </head><body>${body}</body></html>`;

    if (!wa) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html('<p>WhatsApp adapter not enabled.</p>'));
      return;
    }

    if (wa.myJid) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html('<p>✅ WhatsApp is connected.</p>'));
      return;
    }

    if (!wa.latestQr) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html('<p>⏳ Waiting for WhatsApp QR code...</p>'));
      return;
    }

    try {
      const QRCode = require('qrcode');
      const qrDataUrl = await QRCode.toDataURL(wa.latestQr, { width: 400, margin: 2 });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html(`<h2>Scan with WhatsApp</h2><img src="${qrDataUrl}" alt="QR Code"/><p>Page auto-refreshes.</p>`));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to generate QR: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _parseChannelId(channelId) {
    const colonIdx = (channelId || '').indexOf(':');
    if (colonIdx === -1) return { platform: 'unknown', channelId };
    return { platform: channelId.slice(0, colonIdx), channelId: channelId.slice(colonIdx + 1) };
  }

  async _sendSafe(adapter, channelId, text) {
    try {
      await adapter.sendMessage(channelId, text);
    } catch (err) {
      this._log.warn({ channelId, err: err.message }, 'Failed to send message');
    }
  }
}

module.exports = Gateway;
