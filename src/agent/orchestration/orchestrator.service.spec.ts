import { describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from './orchestrator.service';

const emptyAsyncIterable = {
  async *[Symbol.asyncIterator]() {
    // no stream parts
  },
};

describe('OrchestratorService', () => {
  function createService(overrides: Partial<Record<string, unknown>> = {}) {
    const redisSubscriber = {
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn().mockResolvedValue(1),
    };
    const deps = {
      modelRouter: {
        resolveModel: vi.fn().mockReturnValue({
          provider: 'openai',
          modelID: 'gpt-4o',
          model: {},
        }),
      },
      toolsService: { getToolSet: vi.fn().mockReturnValue({}) },
      actionsService: { getToolSet: vi.fn().mockReturnValue({}) },
      stateService: {
        getOrCreateThread: vi.fn().mockResolvedValue({}),
        startRun: vi.fn().mockResolvedValue({}),
        getCustomState: vi.fn().mockResolvedValue(undefined),
        setCustomState: vi.fn().mockResolvedValue(undefined),
      },
      memoryService: { getContextForQuery: vi.fn().mockResolvedValue('') },
      eventEmitter: {
        initRun: vi.fn().mockResolvedValue(undefined),
        emitEvent: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
      },
      chatsService: {},
      agentsService: {
        findByIDOrThrow: vi.fn().mockResolvedValue({
          modelOptions: {},
          toolPolicy: { mode: 'allow', tools: [] },
        }),
      },
      contextOrchestration: {
        prepare: vi.fn().mockImplementation(({ messages }) =>
          Promise.resolve({
            messages,
            decision: 'noop',
            stats: {
              beforeTokens: 0,
              afterTokens: 0,
              pruned: { duplicates: 0, images: 0, toolArgs: 0, toolResults: 0 },
            },
            summaryUpdated: false,
          }),
        ),
      },
      promptBuilder: { build: vi.fn().mockResolvedValue('system') },
      loopDetection: {
        detect: vi.fn().mockReturnValue(undefined),
        clear: vi.fn(),
      },
      configService: { get: vi.fn().mockReturnValue('0') },
      attachmentMessageResolver: {
        resolve: vi.fn().mockImplementation((messages) => messages),
      },
      agentRuntime: {
        streamAttempt: vi.fn().mockReturnValue({
          fullStream: emptyAsyncIterable,
          steps: Promise.resolve([{ toolCalls: [{}] }]),
          response: Promise.resolve({}),
        }),
      },
      lifecycle: {
        failRun: vi.fn().mockResolvedValue(undefined),
        cancelRun: vi.fn().mockResolvedValue(undefined),
        completeRun: vi.fn().mockResolvedValue(undefined),
      },
      streamReducer: {
        reduce: vi.fn().mockResolvedValue({
          accumulatedReasoning: '',
          accumulatedText: '',
          lastThinkingDuration: undefined,
          yieldRequested: false,
          toolCallBlocks: [],
        }),
      },
      breakerHandler: {
        forceFinalAnswer: vi.fn().mockResolvedValue(''),
      },
      pluginLoader: {
        runHooks: vi.fn().mockResolvedValue(undefined),
      },
      redis: {
        duplicate: vi.fn().mockReturnValue(redisSubscriber),
        publish: vi.fn(),
      },
      ...overrides,
    };

    return {
      service: new OrchestratorService(
        deps.modelRouter as never,
        deps.toolsService as never,
        deps.actionsService as never,
        deps.stateService as never,
        deps.memoryService as never,
        deps.eventEmitter as never,
        deps.chatsService as never,
        deps.agentsService as never,
        deps.contextOrchestration as never,
        deps.promptBuilder as never,
        deps.loopDetection as never,
        deps.configService as never,
        deps.attachmentMessageResolver as never,
        deps.agentRuntime as never,
        deps.lifecycle as never,
        deps.streamReducer as never,
        deps.breakerHandler as never,
        deps.pluginLoader as never,
        deps.redis as never,
      ),
      deps,
    };
  }

  it('fails runs that hit maxIterations without final text', async () => {
    const { service, deps } = createService();

    await service.executeGoal(
      {
        threadID: 'thread-1',
        runID: 'run-1',
        userID: 'user-1',
        agentID: 'agent-1',
        userMessage: 'work',
        conversationHistory: [],
      },
      { maxIterations: 1, maxSteps: 1, wallClockTimeoutMs: 0 },
    );

    expect(deps.lifecycle.failRun).toHaveBeenCalledWith(
      'run-1',
      'thread-1',
      expect.stringContaining('max_iterations_exceeded'),
    );
  });
});
