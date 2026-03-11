'use strict';

/**
 * Summarizer — LLM-based rolling summary generator.
 *
 * Uses the configured provider (Claude by default) to generate a concise
 * rolling summary from recent messages plus an existing summary.
 * Falls back to a simple heuristic if the provider is unavailable.
 */

class Summarizer {
  /**
   * @param {{ provider?: Object }} opts
   *   provider: an instance with a method like query(messages, opts) → string
   *             (compatible with src/providers/claude.js or opencode.js)
   */
  constructor({ provider } = {}) {
    this.provider = provider || null;
  }

  /**
   * Generate or update a rolling summary.
   *
   * @param {Array<{ role: string, content: string }>} messages  - Recent messages
   * @param {string} [existingSummary]                           - Previous summary (may be empty)
   * @returns {Promise<string>}
   */
  async summarize(messages, existingSummary = '') {
    if (!messages || messages.length === 0) return existingSummary || '';

    // Attempt LLM summarization if provider is available
    if (this.provider && typeof this.provider.summarize === 'function') {
      try {
        return await this.provider.summarize(messages, existingSummary);
      } catch (err) {
        console.error('[Summarizer] LLM summarization failed, falling back:', err.message);
      }
    }

    // Try direct Anthropic API call if ANTHROPIC_API_KEY is set
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        return await this._anthropicSummarize(messages, existingSummary);
      } catch (err) {
        console.error('[Summarizer] Anthropic API call failed, falling back:', err.message);
      }
    }

    // Fallback: heuristic summary (last N messages concatenated)
    return this._heuristicSummary(messages, existingSummary);
  }

  // ---------------------------------------------------------------------------
  // Internal: Anthropic direct call
  // ---------------------------------------------------------------------------

  async _anthropicSummarize(messages, existingSummary) {
    // Lazy-require to avoid hard dependency at module load time
    let Anthropic;
    try {
      Anthropic = require('@anthropic-ai/sdk');
    } catch {
      throw new Error('Anthropic SDK not available');
    }

    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

    const transcript = messages
      .slice(-30)
      .map((m) => `[${m.role}]: ${String(m.content || '').substring(0, 500)}`)
      .join('\n');

    const systemPrompt = [
      'You are a concise summarization assistant.',
      'Given a conversation transcript and an optional previous summary, produce a short rolling summary (max 300 words).',
      'Focus on key topics discussed, decisions made, and action items.',
      'Do not include pleasantries or filler.',
    ].join(' ');

    const userContent = [
      existingSummary ? `Previous summary:\n${existingSummary.trim()}\n\n` : '',
      `New messages:\n${transcript}`,
      '\n\nProvide an updated concise summary:',
    ].join('');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content.find((c) => c.type === 'text');
    return text ? text.text.trim() : this._heuristicSummary(messages, existingSummary);
  }

  // ---------------------------------------------------------------------------
  // Fallback: heuristic summary
  // ---------------------------------------------------------------------------

  _heuristicSummary(messages, existingSummary) {
    const recentLines = messages
      .slice(-10)
      .map((m) => `[${m.role}]: ${String(m.content || '').substring(0, 200)}`);

    const parts = [];
    if (existingSummary) {
      // Keep a trimmed version of the existing summary
      parts.push(`Previous context:\n${existingSummary.trim().split('\n').slice(0, 10).join('\n')}`);
    }

    parts.push(`Recent (${new Date().toISOString()}):\n${recentLines.join('\n')}`);

    return parts.join('\n\n---\n\n');
  }
}

module.exports = Summarizer;
