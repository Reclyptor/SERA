import { OrchestratorService } from './orchestrator.service';

const emptyAsyncIterable = {
  async *[Symbol.asyncIterator]() {
    // no stream parts
  },
};

describe('OrchestratorService', () => {
  function createService(overrides: Partial<Record<string, unknown>> = {}) {
    const redisSubscriber = {
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    };
    const deps = {
      modelRouter: {
        resolveModel: jest.fn().mockReturnValue({
          provider: 'openai',
          modelID: 'gpt-4o',
          model: {},
        }),
      },
      toolsService: { getToolSet: jest.fn().mockReturnValue({}) },
      actionsService: { getToolSet: jest.fn().mockReturnValue({}) },
      stateService: {
        getOrCreateThread: jest.fn().mockResolvedValue({}),
        startRun: jest.fn().mockResolvedValue({}),
        failRun: jest.fn().mockResolvedValue({}),
        cancelRun: jest.fn().mockResolvedValue({}),
      },
      memoryService: { getContextForQuery: jest.fn().mockResolvedValue('') },
      eventEmitter: {
        initRun: jest.fn().mockResolvedValue(undefined),
        emitEvent: jest.fn().mockResolvedValue(undefined),
        complete: jest.fn().mockResolvedValue(undefined),
      },
      chatsService: {},
      agentsService: {
        findByIDOrThrow: jest.fn().mockResolvedValue({
          modelOptions: {},
          toolPolicy: { mode: 'allow', tools: [] },
        }),
      },
      skillReview: {},
      contextCompressor: {
        compress: jest.fn().mockImplementation((messages) => messages),
      },
      promptBuilder: { build: jest.fn().mockResolvedValue('system') },
      loopDetection: {
        detect: jest.fn().mockReturnValue(undefined),
        clear: jest.fn(),
      },
      insightsService: {},
      commitmentExtractor: {},
      configService: { get: jest.fn().mockReturnValue('0') },
      moduleRef: { get: jest.fn().mockReturnValue(null) },
      attachmentMessageResolver: {
        resolve: jest.fn().mockImplementation((messages) => messages),
      },
      agentRuntime: {
        streamAttempt: jest.fn().mockReturnValue({
          fullStream: emptyAsyncIterable,
          steps: Promise.resolve([{ toolCalls: [{}] }]),
          response: Promise.resolve({}),
        }),
      },
      redis: {
        duplicate: jest.fn().mockReturnValue(redisSubscriber),
        publish: jest.fn(),
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
        deps.skillReview as never,
        deps.contextCompressor as never,
        deps.promptBuilder as never,
        deps.loopDetection as never,
        deps.insightsService as never,
        deps.commitmentExtractor as never,
        deps.configService as never,
        deps.moduleRef as never,
        deps.attachmentMessageResolver as never,
        deps.agentRuntime as never,
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

    expect(deps.stateService.failRun).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('max_iterations_exceeded'),
    );
    expect(deps.eventEmitter.emitEvent).toHaveBeenCalledWith(
      'run-1',
      'thread-1',
      'run.failed',
      expect.objectContaining({
        error: expect.stringContaining('max_iterations_exceeded'),
      }),
    );
  });
});
