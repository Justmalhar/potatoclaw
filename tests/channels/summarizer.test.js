'use strict';

const Summarizer = require('../../src/channels/summarizer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MESSAGES = [
  { role: 'user',      content: 'What is the status of the deploy?' },
  { role: 'assistant', content: 'The deploy is 80% complete.' },
  { role: 'user',      content: 'Any blockers?' },
  { role: 'assistant', content: 'No blockers so far. ETA 10 minutes.' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Summarizer', () => {
  describe('constructor', () => {
    test('sets provider to null by default', () => {
      const s = new Summarizer();
      expect(s.provider).toBeNull();
    });

    test('accepts a provider option', () => {
      const provider = { summarize: jest.fn() };
      const s = new Summarizer({ provider });
      expect(s.provider).toBe(provider);
    });
  });

  describe('summarize — no provider', () => {
    test('returns empty string for empty messages', async () => {
      const s = new Summarizer();
      const result = await s.summarize([]);
      expect(result).toBe('');
    });

    test('returns existingSummary for empty messages', async () => {
      const s = new Summarizer();
      const result = await s.summarize([], 'Old summary');
      expect(result).toBe('Old summary');
    });

    test('returns a non-empty string for valid messages', async () => {
      const s = new Summarizer();
      const result = await s.summarize(MESSAGES);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('includes recent message content in heuristic summary', async () => {
      const s = new Summarizer();
      const result = await s.summarize(MESSAGES);
      // Heuristic summary should include snippet from messages
      expect(result).toMatch(/deploy|ETA/i);
    });

    test('incorporates existing summary when provided', async () => {
      const s = new Summarizer();
      const result = await s.summarize(MESSAGES, 'Previous: ticket created.');
      expect(result).toContain('Previous');
    });
  });

  describe('summarize — with provider', () => {
    test('calls provider.summarize when available', async () => {
      const provider = { summarize: jest.fn().mockResolvedValue('LLM summary') };
      const s = new Summarizer({ provider });
      const result = await s.summarize(MESSAGES);
      expect(provider.summarize).toHaveBeenCalledTimes(1);
      expect(result).toBe('LLM summary');
    });

    test('falls back to heuristic if provider.summarize throws', async () => {
      const provider = { summarize: jest.fn().mockRejectedValue(new Error('LLM down')) };
      const s = new Summarizer({ provider });
      const result = await s.summarize(MESSAGES);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('uses heuristic if provider has no summarize method', async () => {
      const provider = {}; // no summarize method
      const s = new Summarizer({ provider });
      const result = await s.summarize(MESSAGES);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('_heuristicSummary', () => {
    test('returns a string for valid input', () => {
      const s = new Summarizer();
      const result = s._heuristicSummary(MESSAGES, '');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('includes timestamp marker', () => {
      const s = new Summarizer();
      const result = s._heuristicSummary(MESSAGES, '');
      expect(result).toMatch(/Recent/);
    });

    test('handles large message arrays (only last 10 shown)', () => {
      const s = new Summarizer();
      const msgs = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: `msg_${i}` }));
      const result = s._heuristicSummary(msgs, '');
      expect(result).toContain('msg_49');
      expect(result).not.toContain('msg_0');
    });

    test('truncates long message content to 200 chars', () => {
      const s = new Summarizer();
      const longContent = 'x'.repeat(500);
      const result = s._heuristicSummary([{ role: 'user', content: longContent }], '');
      // Full 500-char string should not appear
      expect(result).not.toContain('x'.repeat(500));
    });
  });
});
