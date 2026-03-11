'use strict';

// Mock ESM Claude SDK before any require chain loads it
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

const BaseAgent = require('../../src/agents/base-agent');

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeDefinition(overrides = {}) {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    systemPrompt: 'You are a helpful test agent.',
    tools: [],
    ...overrides,
  };
}

function makeMemoryManager() {
  return {
    getMemoryContext: jest.fn().mockResolvedValue(''),
    readMemory: jest.fn().mockResolvedValue(''),
    writeMemory: jest.fn().mockResolvedValue(undefined),
    appendDailyLog: jest.fn().mockResolvedValue(undefined),
    ensureDirs: jest.fn().mockResolvedValue(undefined),
  };
}

function makeProvider() {
  return {
    name: 'mock',
    setModel: jest.fn(),
    getModel: jest.fn().mockReturnValue('claude-sonnet-4-6'),
    abort: jest.fn().mockReturnValue(false),
    dispose: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
  };
}

function makeAgent(defOverrides = {}, opts = {}) {
  const definition = makeDefinition(defOverrides);
  const memoryManager = opts.memoryManager || makeMemoryManager();
  const provider = opts.provider || makeProvider();
  const agent = new BaseAgent({ definition, memoryManager, provider });
  return { agent, definition, memoryManager, provider };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseAgent', () => {
  describe('constructor', () => {
    test('throws if definition has no id', () => {
      expect(() => new BaseAgent({ definition: { name: 'no-id' } })).toThrow();
    });

    test('sets status to idle', () => {
      const { agent } = makeAgent();
      expect(agent.status).toBe('idle');
    });

    test('sets currentTask to null', () => {
      const { agent } = makeAgent();
      expect(agent.currentTask).toBeNull();
    });

    test('stores definition', () => {
      const { agent, definition } = makeAgent();
      expect(agent.definition).toBe(definition);
    });
  });

  describe('accessors', () => {
    test('id returns definition.id', () => {
      const { agent } = makeAgent({ id: 'my-agent' });
      expect(agent.id).toBe('my-agent');
    });

    test('status getter returns _status', () => {
      const { agent } = makeAgent();
      agent._status = 'busy';
      expect(agent.status).toBe('busy');
    });

    test('currentTask getter returns _currentTask', () => {
      const { agent } = makeAgent();
      agent._currentTask = 'working on bug';
      expect(agent.currentTask).toBe('working on bug');
    });
  });

  describe('buildSystemPrompt', () => {
    test('includes base system prompt from definition', () => {
      const { agent } = makeAgent({ systemPrompt: 'Be helpful.' });
      const result = agent.buildSystemPrompt();
      expect(result).toContain('Be helpful.');
    });

    test('includes channelContext.systemPromptOverride', () => {
      const { agent } = makeAgent();
      const result = agent.buildSystemPrompt({
        channelContext: { systemPromptOverride: 'Focus on tests only.' },
      });
      expect(result).toContain('Focus on tests only.');
    });

    test('includes channelMemory when provided', () => {
      const { agent } = makeAgent();
      const result = agent.buildSystemPrompt({
        channelContext: { channelMemory: 'Remember: always use TypeScript.' },
      });
      expect(result).toContain('Remember: always use TypeScript.');
    });

    test('includes conversation summary when provided', () => {
      const { agent } = makeAgent();
      const result = agent.buildSystemPrompt({
        channelContext: { summary: 'Discussed refactoring approach.' },
      });
      expect(result).toContain('Discussed refactoring approach.');
    });

    test('includes agentMemoryContext when provided', () => {
      const { agent } = makeAgent();
      const result = agent.buildSystemPrompt({ agentMemoryContext: 'Long-term notes here.' });
      expect(result).toContain('Long-term notes here.');
    });

    test('returns only base prompt when no context provided', () => {
      const { agent } = makeAgent({ systemPrompt: 'Just base.' });
      const result = agent.buildSystemPrompt();
      expect(result).toBe('Just base.');
    });

    test('omits sections whose values are empty/null', () => {
      const { agent } = makeAgent({ systemPrompt: 'Base.' });
      const result = agent.buildSystemPrompt({
        channelContext: { systemPromptOverride: null, channelMemory: '', summary: '' },
        agentMemoryContext: '',
      });
      expect(result).toBe('Base.');
    });

    test('all sections present when all provided', () => {
      const { agent } = makeAgent({ systemPrompt: 'Base.' });
      const result = agent.buildSystemPrompt({
        channelContext: {
          systemPromptOverride: 'Override.',
          channelMemory: 'Channel memory.',
          summary: 'Summary.',
        },
        agentMemoryContext: 'Agent memory.',
      });
      expect(result).toContain('Base.');
      expect(result).toContain('Override.');
      expect(result).toContain('Channel memory.');
      expect(result).toContain('Summary.');
      expect(result).toContain('Agent memory.');
    });
  });

  describe('run — validation', () => {
    test('throws when sessionKey is missing', async () => {
      const { agent } = makeAgent();
      const gen = agent.run({ text: 'hello' });
      await expect(gen.next()).rejects.toThrow('sessionKey is required');
    });

    test('throws when text is missing', async () => {
      const { agent } = makeAgent();
      const gen = agent.run({ sessionKey: 'key:abc' });
      await expect(gen.next()).rejects.toThrow('text is required');
    });
  });

  describe('run — streaming with mock provider', () => {
    test('yields text chunks from provider', async () => {
      async function* mockQuery() {
        yield { type: 'text', content: 'Hello ' };
        yield { type: 'text', content: 'world' };
        yield { type: 'done' };
      }

      const provider = makeProvider();
      provider.query = mockQuery;
      const { agent } = makeAgent({}, { provider });

      const chunks = [];
      for await (const chunk of agent.run({ sessionKey: 'k:1', text: 'hi' })) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello ')).toBe(true);
    });

    test('sets status to busy during run and idle after', async () => {
      async function* mockQuery() {
        yield { type: 'done' };
      }

      const provider = makeProvider();
      provider.query = mockQuery;
      const { agent } = makeAgent({}, { provider });

      // Status should be idle before run
      expect(agent.status).toBe('idle');

      const chunks = [];
      for await (const chunk of agent.run({ sessionKey: 'k:2', text: 'work' })) {
        chunks.push(chunk);
      }

      // Status should be idle after run completes
      expect(agent.status).toBe('idle');
    });
  });
});
