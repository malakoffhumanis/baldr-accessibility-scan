import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AIAnalyzerService } from './ai-analyzer.service.js';
import { OpenAIClientService } from './openai-client.service.js';
import { PromptBuilderService } from './prompt-builder.service.js';
import { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';
import type {
  IRGAARule,
  IAIRuleAnalysis,
} from '@shared/types/rgaa-rules.types.js';
import type {
  IAxeResult,
  IAIEnrichedResult,
} from '@shared/types/audit.types.js';

// Mock dependencies
vi.mock('./openai-client.service.js');
vi.mock('../screenshot/screenshot.service.js');
vi.mock('./prompt-builder.service.js');

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers: mock data factories
// ---------------------------------------------------------------------------

function createMockRule(overrides: Partial<IRGAARule> = {}): IRGAARule {
  return {
    id: '1.1',
    ruleId: 'image-alt',
    title: "Images porteuses d'information",
    description:
      "Chaque image porteuse d'information a-t-elle une alternative textuelle ?",
    rgaaReference: 'Critère 1.1',
    wcagReference: '1.1.1',
    theme: 'Images',
    level: 'A',
    applicability: {
      description: 'Images avec attribut src',
      signals: { selectors: ['img[src]'], minimumCount: 1 },
      nonApplicableCases: ['Pages sans images'],
    },
    testScenarios: {},
    aiAnalysisConfig: {
      enabled: true,
      systemRole: 'Expert accessibilité',
      inputs: { dom: true, screenshots: true, ruleMetadata: true },
      analysisPrompt: {
        tasks: [
          "Vérifier la présence d'attribut alt sur chaque image",
          "Vérifier la pertinence de l'alternative textuelle",
        ],
        outputFormat: {
          structure: { ruleId: 'string', compliant: 'boolean' },
          findingsFormat: { type: 'string', issue: 'string' },
          important: ['Retourner du JSON valide uniquement'],
        },
      },
    },
    automatedChecks: ['image-alt'],
    manualChecks: ['Vérifier la pertinence des alt'],
    commonErrors: [
      {
        error: 'Alt manquant',
        example: '<img src="photo.jpg">',
        correction: '<img src="photo.jpg" alt="Description">',
        explanation: "L'attribut alt est obligatoire",
      },
    ],
    resources: ['https://rgaa.net/critere-1-1'],
    ...overrides,
  };
}

function createMockRuleWithTheme(
  theme: string,
  ruleId: string,
  id: string,
): IRGAARule {
  return createMockRule({
    id,
    ruleId,
    theme,
    title: `Règle ${id} - ${theme}`,
  });
}

function createMockAxeResults(overrides: Partial<IAxeResult> = {}): IAxeResult {
  return {
    url: 'https://example.com',
    timestamp: '2026-03-30T10:00:00.000Z',
    testInfo: {
      userAgent: 'Mozilla/5.0',
      viewport: { width: 1920, height: 1080 },
      title: 'Page de test',
    },
    summary: {
      violations: 2,
      passes: 10,
      incomplete: 1,
      inapplicable: 3,
    },
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/image-alt',
        tags: ['wcag2a', 'wcag111'],
        nodes: [
          {
            html: '<img src="logo.png">',
            target: ['img[src="logo.png"]'],
            failureSummary:
              'Fix any of the following: Element does not have an alt attribute',
          },
        ],
      },
    ],
    passes: [],
    incomplete: [],
    inapplicable: [],
    ...overrides,
  };
}

function createMockPage(): Record<string, unknown> {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    content: vi
      .fn()
      .mockResolvedValue('<html><body><img src="test.jpg"></body></html>'),
    screenshot: vi.fn().mockResolvedValue('base64screenshot'),
    $: vi.fn(),
    $$eval: vi.fn(),
    evaluate: vi.fn(),
    goto: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIAnalyzerService', () => {
  let service: AIAnalyzerService;
  let mockOpenAIClient: {
    chatCompletion: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };
  let mockPromptBuilder: {
    buildBatchSystemPrompt: ReturnType<typeof vi.fn>;
    buildBatchUserPrompt: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
  };
  let mockScreenshotService: {
    captureFullPage: ReturnType<typeof vi.fn>;
    extractDOM: ReturnType<typeof vi.fn>;
    captureRegion: ReturnType<typeof vi.fn>;
    extractElements: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubEnv('LLM_PROVIDER_API_KEY', 'sk-test-key');
    vi.stubEnv('LLM_PROVIDER_ENDPOINT', 'https://test.example.com');
    vi.stubEnv('LLM_PROVIDER_MODEL', 'gpt-4o');

    // Configure mocks on the prototype so constructor wiring picks them up
    mockOpenAIClient = {
      chatCompletion: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getModel: vi.fn().mockReturnValue('gpt-4o'),
      testConnection: vi.fn(),
    };

    mockPromptBuilder = {
      buildBatchSystemPrompt: vi.fn().mockReturnValue('system prompt'),
      buildBatchUserPrompt: vi.fn().mockReturnValue('user prompt'),
      buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
    };

    mockScreenshotService = {
      captureFullPage: vi.fn().mockResolvedValue('base64screenshotdata'),
      extractDOM: vi
        .fn()
        .mockResolvedValue('<html><body><img src="test.jpg"></body></html>'),
      captureRegion: vi.fn(),
      extractElements: vi.fn(),
    };

    // Apply mocks to constructors. Vitest 4 invokes class mocks with `new`,
    // so we use a `function` (constructor-callable) that copies the prepared
    // mock's properties onto `this`. Arrow functions and `mockReturnValue`
    // both throw when called with `new` in Vitest 4.
    vi.mocked(OpenAIClientService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockOpenAIClient);
    } as unknown as new () => OpenAIClientService);
    vi.mocked(PromptBuilderService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockPromptBuilder);
    } as unknown as new () => PromptBuilderService);
    vi.mocked(ScreenshotService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockScreenshotService);
    } as unknown as new () => ScreenshotService);

    service = new AIAnalyzerService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Dependency injection
  // ---------------------------------------------------------------------------
  describe('dependency injection', () => {
    it('uses the injected OpenAI client and screenshot service instead of creating new ones', async () => {
      vi.mocked(OpenAIClientService).mockClear();
      vi.mocked(ScreenshotService).mockClear();

      const injectedClient = {
        chatCompletion: vi.fn().mockResolvedValue({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'image-alt',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        }),
        isReady: vi.fn().mockReturnValue(true),
        getModel: vi.fn().mockReturnValue('gpt-4o'),
        testConnection: vi.fn(),
      };
      const injectedScreenshot = {
        captureFullPage: vi.fn().mockResolvedValue('injected-shot'),
        extractDOM: vi.fn().mockResolvedValue('<html></html>'),
        captureRegion: vi.fn(),
        extractElements: vi.fn(),
      };

      const injected = new AIAnalyzerService({
        env: 'test',
        openaiClient: injectedClient as unknown as OpenAIClientService,
        screenshotService: injectedScreenshot as unknown as ScreenshotService,
      });

      // No new client/screenshot instances were constructed.
      expect(vi.mocked(OpenAIClientService)).not.toHaveBeenCalled();
      expect(vi.mocked(ScreenshotService)).not.toHaveBeenCalled();

      const result = await injected.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [createMockRule()],
      );

      // The injected instances are the ones actually used.
      expect(injectedClient.chatCompletion).toHaveBeenCalledTimes(1);
      expect(injectedScreenshot.extractDOM).toHaveBeenCalledTimes(1);
      expect(result.screenshot).toBe('injected-shot');
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable
  // ---------------------------------------------------------------------------
  describe('isAvailable()', () => {
    it('should return true when OpenAI client is ready', () => {
      mockOpenAIClient.isReady.mockReturnValue(true);
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when OpenAI client is not ready', () => {
      mockOpenAIClient.isReady.mockReturnValue(false);
      expect(service.isAvailable()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // groupRulesByTheme (tested indirectly via analyzeWithAI)
  // ---------------------------------------------------------------------------
  describe('groupRulesByTheme()', () => {
    it('should group rules by their theme property', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Images', 'image-decorative', '1.2'),
        createMockRuleWithTheme('Couleurs', 'color-contrast', '3.1'),
        createMockRuleWithTheme('Formulaires', 'label-present', '11.1'),
      ];

      // Mock successful LLM responses per theme batch
      mockOpenAIClient.chatCompletion
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'image-alt',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
              {
                ruleId: 'image-decorative',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'color-contrast',
                compliant: false,
                severity: 'serious',
                summary: 'Low contrast',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'label-present',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        });

      const page = createMockPage();
      const result = await service.analyzeWithAI(
        page as never,
        createMockAxeResults(),
        rules,
      );

      // 3 themes = 3 calls to chatCompletion
      expect(mockOpenAIClient.chatCompletion).toHaveBeenCalledTimes(3);
      // Verify buildBatchSystemPrompt was called with the right themes
      const systemPromptCalls =
        mockPromptBuilder.buildBatchSystemPrompt.mock.calls;
      const themes = systemPromptCalls.map(
        (call: unknown[]) => call[1] as string,
      );
      expect(themes).toContain('Images');
      expect(themes).toContain('Couleurs');
      expect(themes).toContain('Formulaires');

      // 4 total rule analyses
      expect(result.ruleAnalyses).toHaveLength(4);
      expect(result.totalRulesAnalyzed).toBe(4);
    });

    it('should handle single-theme grouping', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Images', 'image-decorative', '1.2'),
      ];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
            {
              ruleId: 'image-decorative',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // Only 1 batch call for single theme
      expect(mockOpenAIClient.chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.ruleAnalyses).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeWithAI
  // ---------------------------------------------------------------------------
  describe('analyzeWithAI()', () => {
    it('should return a complete enriched result on success', async () => {
      const rules = [createMockRule()];
      const axeResults = createMockAxeResults();
      const page = createMockPage();

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: false,
              severity: 'critical',
              summary: '2 images sans attribut alt',
              totalElements: 5,
              findings: [
                {
                  type: 'violation',
                  element: 'img[src="logo.png"]',
                  issue: 'Image sans alt',
                  recommendation: 'Ajouter alt="Logo"',
                  wcagReference: '1.1.1',
                },
              ],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        page as never,
        axeResults,
        rules,
      );

      expect(result.totalRulesAnalyzed).toBe(1);
      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.compliant).toBe(false);
      expect(result.ruleAnalyses[0]?.severity).toBe('critical');
      expect(result.ruleAnalyses[0]?.findings).toHaveLength(1);
      // Findings are enriched with the deterministic RGAA reference of their rule.
      expect(result.ruleAnalyses[0]?.findings[0]?.rgaaReference).toBe(
        'Critère 1.1',
      );
      expect(result.summary.violations).toBe(1);
      expect(result.summary.compliant).toBe(0);
      expect(result.metadata.model).toBe('gpt-4o');
      expect(result.metadata.analysisType).toBe('full');
      expect(result.screenshot).toBe('base64screenshotdata');
      expect(result.extractedDOM).toContain('<html>');
    });

    it('should extract DOM and capture screenshot', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const page = createMockPage();
      await service.analyzeWithAI(page as never, createMockAxeResults(), rules);

      expect(mockScreenshotService.extractDOM).toHaveBeenCalledWith(page);
      expect(mockScreenshotService.captureFullPage).toHaveBeenCalledWith(page);
    });

    it('should throw when IA service is not available', async () => {
      vi.stubEnv('LLM_PROVIDER_API_KEY', '');
      mockOpenAIClient.isReady.mockReturnValue(false);

      await expect(
        service.analyzeWithAI(
          createMockPage() as never,
          createMockAxeResults(),
          [createMockRule()],
        ),
      ).rejects.toThrow('AI service not configured');
    });

    it('should skip rules with disabled AI analysis config', async () => {
      const enabledRule = createMockRule({ ruleId: 'image-alt', id: '1.1' });
      const disabledRule = createMockRule({
        ruleId: 'image-decorative',
        id: '1.2',
        aiAnalysisConfig: {
          enabled: false,
        },
      });

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [enabledRule, disabledRule],
      );

      // Only the enabled rule should be analyzed
      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.ruleId).toBe('image-alt');
    });

    it('should skip rules with empty tasks in analysisPrompt', async () => {
      const ruleNoTasks = createMockRule({
        ruleId: 'no-tasks-rule',
        id: '1.3',
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: [],
          },
        },
      });
      const validRule = createMockRule();

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [ruleNoTasks, validRule],
      );

      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.ruleId).toBe('image-alt');
    });

    it('should skip rules with null analysisPrompt', async () => {
      const ruleNoPrompt = createMockRule({
        ruleId: 'no-prompt-rule',
        id: '1.4',
        aiAnalysisConfig: {
          enabled: true,
          // No analysisPrompt at all
        },
      });
      const validRule = createMockRule();

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [ruleNoPrompt, validRule],
      );

      expect(result.ruleAnalyses).toHaveLength(1);
    });

    it('should calculate summary statistics correctly', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Images', 'image-decorative', '1.2'),
        createMockRuleWithTheme('Images', 'image-svg', '1.3'),
      ];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: false,
              severity: 'critical',
              summary: 'Non conforme',
              findings: [],
            },
            {
              ruleId: 'image-decorative',
              compliant: true,
              severity: 'minor',
              summary: 'Conforme',
              findings: [],
            },
            {
              ruleId: 'image-svg',
              compliant: false,
              severity: 'serious',
              summary: 'Erreur',
              findings: [],
              error: 'Parse error',
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // violations: non-compliant WITHOUT error
      expect(result.summary.violations).toBe(1);
      // compliant
      expect(result.summary.compliant).toBe(1);
      // errors: entries with error field
      expect(result.summary.errors).toBe(1);
      expect(result.summary.notApplicable).toBe(0);
    });

    it('should include metadata with timestamp and model', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.metadata.model).toBe('gpt-4o');
      expect(result.metadata.analysisType).toBe('full');
      expect(result.metadata.timestamp).toBeDefined();
      // Verify timestamp is a valid ISO string
      expect(new Date(result.metadata.timestamp).toISOString()).toBe(
        result.metadata.timestamp,
      );
    });

    it('should wrap unexpected errors in a descriptive message', async () => {
      const rules = [createMockRule()];

      mockScreenshotService.extractDOM.mockRejectedValueOnce(
        new Error('Page crashed'),
      );

      await expect(
        service.analyzeWithAI(
          createMockPage() as never,
          createMockAxeResults(),
          rules,
        ),
      ).rejects.toThrow('AI analysis failed: Page crashed');
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeRulesBatch (tested indirectly via analyzeWithAI)
  // ---------------------------------------------------------------------------
  describe('analyzeRulesBatch()', () => {
    it('should send multimodal message with screenshot when available', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // Verify the user message contains image_url content
      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const messages = chatArgs?.[0] as {
        role: string;
        content: string | { type: string; image_url?: { url: string } }[];
      }[];

      // System message
      expect(messages[0]?.role).toBe('system');

      // User message should be multimodal (array content)
      const userMsg = messages[1];
      expect(userMsg?.role).toBe('user');
      expect(Array.isArray(userMsg?.content)).toBe(true);

      const contentArray = userMsg?.content as {
        type: string;
        image_url?: { url: string };
      }[];
      expect(contentArray[0]?.type).toBe('text');
      expect(contentArray[1]?.type).toBe('image_url');
      expect(contentArray[1]?.image_url?.url).toContain(
        'data:image/jpeg;base64,',
      );
    });

    it('should send plain text message when screenshot is absent', async () => {
      // Screenshot service returns undefined
      mockScreenshotService.captureFullPage.mockResolvedValueOnce(undefined);

      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const messages = chatArgs?.[0] as {
        role: string;
        content: string | unknown[];
      }[];

      // User message should be plain string (not multimodal)
      const userMsg = messages[1];
      expect(typeof userMsg?.content).toBe('string');
    });

    it('should add response_format for OpenAI models (gpt-*)', async () => {
      mockOpenAIClient.getModel.mockReturnValue('gpt-4o');

      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const generationParams = chatArgs?.[1] as Record<string, unknown>;
      expect(generationParams?.response_format).toEqual({
        type: 'json_schema',
        json_schema: expect.objectContaining({ name: 'rule_analyses_batch' }),
      });
    });

    it('should add response_format for gpt-* prefixed models', async () => {
      mockOpenAIClient.getModel.mockReturnValue('gpt-4-turbo');

      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4-turbo',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const generationParams = chatArgs?.[1] as Record<string, unknown>;
      expect(generationParams?.response_format).toEqual({
        type: 'json_schema',
        json_schema: expect.objectContaining({ name: 'rule_analyses_batch' }),
      });
    });

    it('should NOT add response_format for Claude models', async () => {
      mockOpenAIClient.getModel.mockReturnValue('claude-3-sonnet-20240229');

      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'claude-3-sonnet-20240229',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const generationParams = chatArgs?.[1] as Record<string, unknown>;
      expect(generationParams?.response_format).toBeUndefined();
    });

    it('should use 180s timeout for batch analysis', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const options = chatArgs?.[2] as { timeout: number };
      expect(options?.timeout).toBe(180000);
    });

    it('should strip markdown code fences from response before parsing', async () => {
      const rules = [createMockRule()];

      // Response wrapped in markdown code fences
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response:
          '```json\n{"analyses": [{"ruleId": "image-alt", "compliant": true, "severity": "minor", "summary": "OK", "findings": []}]}\n```',
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.compliant).toBe(true);
    });

    it('should normalize "conclusion" field to "compliant"', async () => {
      const rules = [createMockRule()];

      // Response uses "conclusion" instead of "compliant"
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              conclusion: 'conforme',
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses[0]?.compliant).toBe(true);
    });

    it('should keep compliant=false when conclusion is not "conforme"', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              conclusion: 'non-conforme',
              severity: 'critical',
              summary: 'Problèmes détectés',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses[0]?.compliant).toBe(false);
    });

    it('should add default entries for rules missing from LLM response', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Images', 'image-decorative', '1.2'),
      ];

      // LLM only responds for one rule
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(2);

      const missingRule = result.ruleAnalyses.find(
        (a) => a.ruleId === 'image-decorative',
      );
      expect(missingRule).toBeDefined();
      expect(missingRule?.compliant).toBe(false);
      expect(missingRule?.severity).toBe('critical');
      expect(missingRule?.summary).toBe(
        'Rule not returned by LLM model — requires manual review',
      );
      expect(missingRule?.error).toBe('not_returned_by_model');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('should create fallback entries when a theme batch fails', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Couleurs', 'color-contrast', '3.1'),
      ];

      // Images batch succeeds, Couleurs batch fails
      mockOpenAIClient.chatCompletion
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'image-alt',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        })
        .mockRejectedValueOnce(new Error('LLM service unavailable'));

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(2);

      const successRule = result.ruleAnalyses.find(
        (a) => a.ruleId === 'image-alt',
      );
      expect(successRule?.compliant).toBe(true);

      const failedRule = result.ruleAnalyses.find(
        (a) => a.ruleId === 'color-contrast',
      );
      expect(failedRule?.compliant).toBe(false);
      expect(failedRule?.severity).toBe('critical');
      expect(failedRule?.error).toBe('LLM service unavailable');
      expect(failedRule?.summary).toContain('Erreur analyse IA batch');
    });

    it('should handle invalid JSON response from LLM', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: 'This is not JSON at all!',
        model: 'gpt-4o',
      });

      // JSON.parse failure will be caught by the theme batch error handler
      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // Should get a fallback entry with error
      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.compliant).toBe(false);
      expect(result.ruleAnalyses[0]?.error).toBeDefined();
    });

    it('should handle response with missing "analyses" field', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({ result: 'something unexpected' }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // Should have fallback entry because analyses was invalid
      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.compliant).toBe(false);
      expect(result.ruleAnalyses[0]?.error).toContain('analyses');
    });

    it('should handle screenshot capture failure', async () => {
      mockScreenshotService.captureFullPage.mockRejectedValueOnce(
        new Error('Screenshot failed'),
      );

      const rules = [createMockRule()];

      await expect(
        service.analyzeWithAI(
          createMockPage() as never,
          createMockAxeResults(),
          rules,
        ),
      ).rejects.toThrow('AI analysis failed: Screenshot failed');
    });

    it('should handle DOM extraction failure', async () => {
      mockScreenshotService.extractDOM.mockRejectedValueOnce(
        new Error('DOM extraction failed'),
      );

      const rules = [createMockRule()];

      await expect(
        service.analyzeWithAI(
          createMockPage() as never,
          createMockAxeResults(),
          rules,
        ),
      ).rejects.toThrow('AI analysis failed: DOM extraction failed');
    });

    it('should handle all theme batches failing', async () => {
      const rules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Couleurs', 'color-contrast', '3.1'),
      ];

      mockOpenAIClient.chatCompletion
        .mockRejectedValueOnce(new Error('Batch 1 failed'))
        .mockRejectedValueOnce(new Error('Batch 2 failed'));

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // All rules should have error entries
      expect(result.ruleAnalyses).toHaveLength(2);
      expect(result.ruleAnalyses.every((a) => a.error != null)).toBe(true);
      expect(result.ruleAnalyses.every((a) => !a.compliant)).toBe(true);
    });

    it('should handle non-Error rejection from LLM', async () => {
      const rules = [createMockRule()];

      // Reject with a string instead of Error
      mockOpenAIClient.chatCompletion.mockRejectedValueOnce(
        'something went wrong',
      );

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.error).toBe('Erreur inconnue');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle empty rules array', async () => {
      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [],
      );

      expect(result.ruleAnalyses).toHaveLength(0);
      expect(result.totalRulesAnalyzed).toBe(0);
      expect(mockOpenAIClient.chatCompletion).not.toHaveBeenCalled();
    });

    it('should handle all rules having disabled AI config', async () => {
      const rules = [
        createMockRule({
          ruleId: 'disabled-1',
          aiAnalysisConfig: { enabled: false },
        }),
        createMockRule({
          ruleId: 'disabled-2',
          aiAnalysisConfig: { enabled: false },
        }),
      ];

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(0);
      expect(mockOpenAIClient.chatCompletion).not.toHaveBeenCalled();
    });

    it('should pass axeResults to prompt builder', async () => {
      const rules = [createMockRule()];
      const axeResults = createMockAxeResults();

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(createMockPage() as never, axeResults, rules);

      expect(mockPromptBuilder.buildBatchUserPrompt).toHaveBeenCalledWith(
        rules,
        expect.any(String),
        axeResults,
        'base64screenshotdata',
      );
    });

    it('should pass correct rules to prompt builder per theme', async () => {
      const imagesRules = [
        createMockRuleWithTheme('Images', 'image-alt', '1.1'),
        createMockRuleWithTheme('Images', 'image-decorative', '1.2'),
      ];
      const colorsRules = [
        createMockRuleWithTheme('Couleurs', 'color-contrast', '3.1'),
      ];
      const allRules = [...imagesRules, ...colorsRules];

      mockOpenAIClient.chatCompletion
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'image-alt',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
              {
                ruleId: 'image-decorative',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'color-contrast',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
        });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        allRules,
      );

      // buildBatchSystemPrompt should be called once per theme
      expect(mockPromptBuilder.buildBatchSystemPrompt).toHaveBeenCalledTimes(2);

      // Verify rules passed to each theme batch
      const call1Rules = mockPromptBuilder.buildBatchSystemPrompt.mock
        .calls[0]?.[0] as IRGAARule[];
      const call1Theme = mockPromptBuilder.buildBatchSystemPrompt.mock
        .calls[0]?.[1] as string;
      const call2Rules = mockPromptBuilder.buildBatchSystemPrompt.mock
        .calls[1]?.[0] as IRGAARule[];
      const call2Theme = mockPromptBuilder.buildBatchSystemPrompt.mock
        .calls[1]?.[1] as string;

      // Identify which call is which theme
      if (call1Theme === 'Images') {
        expect(call1Rules).toHaveLength(2);
        expect(call2Theme).toBe('Couleurs');
        expect(call2Rules).toHaveLength(1);
      } else {
        expect(call1Theme).toBe('Couleurs');
        expect(call1Rules).toHaveLength(1);
        expect(call2Theme).toBe('Images');
        expect(call2Rules).toHaveLength(2);
      }
    });

    it('should handle response with extra whitespace and code fences', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response:
          '  \n```\n{"analyses": [{"ruleId": "image-alt", "compliant": true, "severity": "minor", "summary": "OK", "findings": []}]}\n```  \n',
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(result.ruleAnalyses).toHaveLength(1);
      expect(result.ruleAnalyses[0]?.compliant).toBe(true);
    });

    it('should handle LLM returning findings with full details', async () => {
      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: false,
              severity: 'critical',
              summary: 'Plusieurs images sans attribut alt',
              totalElements: 10,
              findings: [
                {
                  type: 'violation',
                  element: 'img.hero-image',
                  issue: 'Image hero sans alternative textuelle',
                  recommendation: 'Ajouter alt="Description de l\'image hero"',
                  wcagReference: '1.1.1',
                },
                {
                  type: 'warning',
                  element: 'img.decorative',
                  issue: 'Image possiblement décorative avec alt non vide',
                  recommendation:
                    'Si décorative, utiliser alt="" et role="presentation"',
                  wcagReference: '1.1.1',
                },
                {
                  type: 'recommendation',
                  issue: 'Certains SVG inline manquent de titre accessible',
                  recommendation: 'Ajouter un élément <title> dans les SVG',
                },
              ],
              intelligentAnalysis: {
                contextualInsights:
                  'Le site est un e-commerce avec beaucoup de visuels produit',
                semanticRelevance:
                  "Les images produit nécessitent des alt descriptifs pour le SEO et l'accessibilité",
                userImpact:
                  "Impact majeur : les utilisateurs de lecteurs d'écran ne peuvent pas identifier les produits",
              },
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const analysis = result.ruleAnalyses[0];
      expect(analysis?.findings).toHaveLength(3);
      expect(analysis?.findings[0]?.type).toBe('violation');
      expect(analysis?.findings[1]?.type).toBe('warning');
      expect(analysis?.findings[2]?.type).toBe('recommendation');
      expect(analysis?.totalElements).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Token budget and detail:low
  // ---------------------------------------------------------------------------
  describe('token budget and image detail', () => {
    /** Extracts the screenshot detail from the first chatCompletion call. */
    const getSentImageDetail = (): string | undefined => {
      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const messages = chatArgs?.[0] as {
        role: string;
        content:
          | string
          | { type: string; image_url?: { url: string; detail: string } }[];
      }[];
      const userMsg = messages[1];
      const contentArray = userMsg?.content as {
        type: string;
        image_url?: { url: string; detail: string };
      }[];
      return contentArray[1]?.image_url?.detail;
    };

    it('should send image with detail: high for the Images theme', async () => {
      const rules = [createMockRule()]; // theme: 'Images'

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      // The Images verdict depends on seeing small images, so it uses high
      // fidelity (the other themes keep low detail to contain token cost).
      expect(getSentImageDetail()).toBe('high');
    });

    it('should send image with detail: low for non-Images themes', async () => {
      const rules = [
        createMockRuleWithTheme('Couleurs', 'color-contrast', '3.2'),
      ];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'color-contrast',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      expect(getSentImageDetail()).toBe('low');
    });

    it('should use adaptive max_tokens based on model context limit', async () => {
      mockOpenAIClient.getModel.mockReturnValue('gpt-4o');

      const rules = [createMockRule()];

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        rules,
      );

      const chatArgs = mockOpenAIClient.chatCompletion.mock.calls[0];
      const generationParams = chatArgs?.[1] as Record<string, unknown>;
      // For gpt-4o (128000 context), max_tokens = min(8192, floor(128000 * 0.06)) = min(8192, 7680) = 7680
      expect(generationParams?.max_tokens).toBe(7680);
    });
  });

  // ---------------------------------------------------------------------------
  // Decorative-doubt safeguard (Images theme)
  // ---------------------------------------------------------------------------
  describe('decorative-doubt safeguard (Images theme)', () => {
    const imagesDom =
      '<html><body>' +
      '<img class="hero" src="hero.jpg" alt="">' +
      '<a href="/cart"><img class="link-img" src="cart.svg" alt=""></a>' +
      '<img class="noalt" src="chart.png">' +
      '<img class="hidden" src="bg.png" aria-hidden="true">' +
      '</body></html>';

    /** Runs an Images-theme analysis with the given findings; returns the image-alt analysis. */
    const runWithFindings = async (
      findings: {
        type: string;
        element: string;
        issue: string;
        recommendation: string;
      }[],
    ): Promise<IAIRuleAnalysis | undefined> => {
      mockScreenshotService.extractDOM.mockResolvedValueOnce(imagesDom);
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: false,
              severity: 'critical',
              summary: 'Images analysées',
              findings,
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [createMockRule()],
      );
      return result.ruleAnalyses.find((a) => a.ruleId === 'image-alt');
    };

    it('downgrades a violation on an explicitly-decorative image (alt="") to a warning', async () => {
      const analysis = await runWithFindings([
        {
          type: 'violation',
          element: 'img.hero',
          issue: 'Image hero sans alternative',
          recommendation: 'Ajouter alt',
        },
      ]);

      const finding = analysis?.findings[0];
      expect(finding?.type).toBe('warning');
      expect(finding?.issue.startsWith('[À vérifier manuellement] ')).toBe(
        true,
      );
      // No confirmed violation remains -> rule recomputed as compliant.
      expect(analysis?.compliant).toBe(true);
    });

    it('downgrades a violation on an aria-hidden image to a warning', async () => {
      const analysis = await runWithFindings([
        {
          type: 'violation',
          element: 'img.hidden',
          issue: 'Image masquée signalée',
          recommendation: 'Vérifier',
        },
      ]);
      expect(analysis?.findings[0]?.type).toBe('warning');
    });

    it('keeps a violation on a functional image-link (img inside <a>) even with alt=""', async () => {
      const analysis = await runWithFindings([
        {
          type: 'violation',
          element: 'img.link-img',
          issue: 'Lien image sans intitulé',
          recommendation: 'Ajouter alt décrivant la destination',
        },
      ]);
      expect(analysis?.findings[0]?.type).toBe('violation');
      expect(analysis?.compliant).toBe(false);
    });

    it('keeps a violation on an image with no alt attribute', async () => {
      const analysis = await runWithFindings([
        {
          type: 'violation',
          element: 'img.noalt',
          issue: 'Attribut alt absent',
          recommendation: 'Ajouter un attribut alt',
        },
      ]);
      expect(analysis?.findings[0]?.type).toBe('violation');
    });

    it('stays non-compliant when only some findings are downgraded', async () => {
      const analysis = await runWithFindings([
        {
          type: 'violation',
          element: 'img.hero',
          issue: 'ambiance',
          recommendation: 'alt=""',
        },
        {
          type: 'violation',
          element: 'img.noalt',
          issue: 'alt absent',
          recommendation: 'add alt',
        },
      ]);
      const hero = analysis?.findings.find((f) => f.issue.includes('ambiance'));
      const noalt = analysis?.findings.find((f) =>
        f.issue.includes('alt absent'),
      );
      expect(hero?.type).toBe('warning');
      expect(noalt?.type).toBe('violation');
      expect(analysis?.compliant).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Strict warning promotion (non-Images themes)
  // ---------------------------------------------------------------------------
  describe('strict warning promotion (non-Images themes)', () => {
    const runTheme = async (
      theme: string,
      ruleId: string,
      id: string,
      findings: {
        type: string;
        element: string;
        issue: string;
        recommendation: string;
      }[],
    ): Promise<IAIRuleAnalysis | undefined> => {
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId,
              compliant: true,
              severity: 'minor',
              summary: 'x',
              findings,
            },
          ],
        }),
        model: 'gpt-4o',
      });
      const result = await service.analyzeWithAI(
        createMockPage() as never,
        createMockAxeResults(),
        [createMockRuleWithTheme(theme, ruleId, id)],
      );
      return result.ruleAnalyses.find((a) => a.ruleId === ruleId);
    };

    it('promotes a warning to a violation for a non-Images theme and marks it non-compliant', async () => {
      const analysis = await runTheme('Couleurs', 'color-contrast', '3.2', [
        {
          type: 'warning',
          element: '.x',
          issue: 'doute contraste',
          recommendation: 'vérifier',
        },
      ]);
      expect(analysis?.findings[0]?.type).toBe('violation');
      expect(analysis?.compliant).toBe(false);
    });

    it('keeps a warning as a warning for the Images theme', async () => {
      const analysis = await runTheme('Images', 'image-alt', '1.1', [
        {
          type: 'warning',
          element: 'img.hero',
          issue: 'doute',
          recommendation: 'vérifier',
        },
      ]);
      // Images does not promote warnings (it only downgrades doubtful violations).
      expect(analysis?.findings[0]?.type).toBe('warning');
    });
  });
});

describe('AIAnalyzerService — extra coverage', () => {
  // Extra-coverage-specific factories (kept local to avoid clashing with the
  // module-level helpers used by the primary suite above).
  function createMockRuleExtra(overrides: Partial<IRGAARule> = {}): IRGAARule {
    return {
      id: '1.1',
      ruleId: 'image-alt',
      title: 'Images',
      description: 'desc',
      rgaaReference: 'Critère 1.1',
      wcagReference: '1.1.1',
      theme: 'Images',
      level: 'A',
      applicability: {
        description: 'Images',
        signals: { selectors: ['img[src]'], minimumCount: 1 },
        nonApplicableCases: [],
      },
      testScenarios: {},
      aiAnalysisConfig: {
        enabled: true,
        systemRole: 'Expert',
        inputs: { dom: true, screenshots: true, ruleMetadata: true },
        analysisPrompt: {
          tasks: ['t1'],
          outputFormat: {
            structure: { ruleId: 'string', compliant: 'boolean' },
            findingsFormat: { type: 'string', issue: 'string' },
            important: ['JSON'],
          },
        },
      },
      automatedChecks: ['image-alt'],
      manualChecks: [],
      commonErrors: [],
      resources: [],
      ...overrides,
    };
  }

  function createAxeViolation(
    id: string,
    overrides: Partial<IAxeResult['violations'][number]> = {},
  ): IAxeResult['violations'][number] {
    return {
      id,
      impact: 'serious',
      description: `desc ${id}`,
      help: `help ${id}`,
      helpUrl: `https://deque/${id}`,
      tags: ['wcag2a', 'wcag111', 'RGAA-1.1'],
      nodes: [
        {
          html: '<img>',
          target: ['img'],
          failureSummary: 'fix',
        },
      ],
      ...overrides,
    };
  }

  function createMockAxeResultsExtra(
    overrides: Partial<IAxeResult> = {},
  ): IAxeResult {
    return {
      url: 'https://example.com',
      timestamp: '2026-03-30T10:00:00.000Z',
      testInfo: {
        userAgent: 'UA',
        viewport: { width: 1920, height: 1080 },
        title: 'Page',
      },
      summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      violations: [createAxeViolation('image-alt')],
      passes: [],
      incomplete: [],
      inapplicable: [],
      ...overrides,
    };
  }

  function createEnrichedResult(
    ruleAnalyses: IAIEnrichedResult['ruleAnalyses'],
  ): IAIEnrichedResult {
    return {
      ruleAnalyses,
      totalRulesAnalyzed: ruleAnalyses.length,
      summary: {
        violations: ruleAnalyses.filter((r) => !r.compliant).length,
        compliant: ruleAnalyses.filter((r) => r.compliant).length,
        notApplicable: 0,
        errors: 0,
      },
      metadata: {
        model: 'gpt-4o',
        timestamp: '2026-03-30T10:00:00.000Z',
        analysisType: 'full',
      },
    };
  }

  function createMockPageExtra(): Record<string, unknown> {
    return {
      url: vi.fn().mockReturnValue('https://example.com'),
      content: vi.fn().mockResolvedValue('<html></html>'),
    };
  }

  let service: AIAnalyzerService;
  let mockOpenAIClient: {
    chatCompletion: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };
  let mockPromptBuilder: {
    buildBatchSystemPrompt: ReturnType<typeof vi.fn>;
    buildBatchUserPrompt: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
  };
  let mockScreenshotService: {
    captureFullPage: ReturnType<typeof vi.fn>;
    extractDOM: ReturnType<typeof vi.fn>;
    captureRegion: ReturnType<typeof vi.fn>;
    extractElements: ReturnType<typeof vi.fn>;
  };

  function buildService(config?: { contextLimit?: number }): AIAnalyzerService {
    return new AIAnalyzerService({
      env: 'test',
      llmProvider: {
        apiKey: 'sk-test',
        endpoint: 'https://test',
        model: 'gpt-4o',
      },
      ...config,
    });
  }

  beforeEach(() => {
    mockOpenAIClient = {
      chatCompletion: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getModel: vi.fn().mockReturnValue('gpt-4o'),
      testConnection: vi.fn(),
    };
    mockPromptBuilder = {
      buildBatchSystemPrompt: vi.fn().mockReturnValue('system prompt'),
      buildBatchUserPrompt: vi.fn().mockReturnValue('user prompt'),
      buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
    };
    mockScreenshotService = {
      captureFullPage: vi.fn().mockResolvedValue('screenshotdata'),
      extractDOM: vi.fn().mockResolvedValue('<html></html>'),
      captureRegion: vi.fn(),
      extractElements: vi.fn(),
    };

    vi.mocked(OpenAIClientService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockOpenAIClient);
    } as unknown as new () => OpenAIClientService);
    vi.mocked(PromptBuilderService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockPromptBuilder);
    } as unknown as new () => PromptBuilderService);
    vi.mocked(ScreenshotService).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      Object.assign(this, mockScreenshotService);
    } as unknown as new () => ScreenshotService);

    service = buildService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Token usage aggregation (lines 192-194)
  // ---------------------------------------------------------------------------
  describe('analyzeWithAI() token usage aggregation', () => {
    it('aggregates token usage across multiple theme batches', async () => {
      const rules = [
        createMockRuleExtra({
          id: '1.1',
          ruleId: 'image-alt',
          theme: 'Images',
        }),
        createMockRuleExtra({
          id: '3.1',
          ruleId: 'color-contrast',
          theme: 'Couleurs',
        }),
      ];

      mockOpenAIClient.chatCompletion
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'image-alt',
                compliant: true,
                severity: 'minor',
                summary: 'OK',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            total_tokens: 140,
          },
        })
        .mockResolvedValueOnce({
          response: JSON.stringify({
            analyses: [
              {
                ruleId: 'color-contrast',
                compliant: false,
                severity: 'serious',
                summary: 'KO',
                findings: [],
              },
            ],
          }),
          model: 'gpt-4o',
          usage: {
            prompt_tokens: 60,
            completion_tokens: 20,
            total_tokens: 80,
          },
        });

      const result = await service.analyzeWithAI(
        createMockPageExtra() as never,
        createMockAxeResultsExtra(),
        rules,
      );

      expect(result.metadata.tokenUsage).toEqual({
        promptTokens: 160,
        completionTokens: 60,
        totalTokens: 220,
      });
    });

    it('wraps a non-Error thrown during analysis as "Unknown error"', async () => {
      mockScreenshotService.extractDOM.mockRejectedValueOnce('boom-string');

      await expect(
        service.analyzeWithAI(
          createMockPageExtra() as never,
          createMockAxeResultsExtra(),
          [createMockRuleExtra()],
        ),
      ).rejects.toThrow('AI analysis failed: Unknown error');
    });

    it('omits tokenUsage when no usage is reported', async () => {
      const rules = [createMockRuleExtra()];
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
        // no usage field
      });

      const result = await service.analyzeWithAI(
        createMockPageExtra() as never,
        createMockAxeResultsExtra(),
        rules,
      );

      expect(result.metadata.tokenUsage).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Token budget reduction path (lines 331-362) + contextLimitOverride (454)
  // ---------------------------------------------------------------------------
  describe('analyzeRulesBatch() token budget reduction', () => {
    it('rebuilds the user prompt with reduced limits when over budget', async () => {
      // Tiny context limit forces the budget-reduction branch.
      service = buildService({ contextLimit: 1000 });

      // A long prompt that easily exceeds 0.9 * availableForInput.
      const longPrompt = 'x'.repeat(40000);
      mockPromptBuilder.buildBatchUserPrompt.mockReturnValue(longPrompt);
      mockPromptBuilder.buildBatchSystemPrompt.mockReturnValue(
        'y'.repeat(4000),
      );

      const rules = [createMockRuleExtra()];
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPageExtra() as never,
        createMockAxeResultsExtra(),
        rules,
      );

      // First call: no options. Second call: reduced { domLimit, axeLimit }.
      expect(mockPromptBuilder.buildBatchUserPrompt).toHaveBeenCalledTimes(2);
      const secondCallOpts =
        mockPromptBuilder.buildBatchUserPrompt.mock.calls[1]?.[4];
      expect(secondCallOpts).toMatchObject({
        domLimit: expect.any(Number),
        axeLimit: expect.any(Number),
      });
      // Reduced limits respect the hard floors (>=2000 dom, >=1000 axe).
      const opts = secondCallOpts as { domLimit: number; axeLimit: number };
      expect(opts.domLimit).toBeGreaterThanOrEqual(2000);
      expect(opts.axeLimit).toBeGreaterThanOrEqual(1000);
    });

    it('does not reduce the prompt when within budget (single build call)', async () => {
      service = buildService({ contextLimit: 128000 });
      mockPromptBuilder.buildBatchUserPrompt.mockReturnValue('short prompt');
      mockPromptBuilder.buildBatchSystemPrompt.mockReturnValue('short system');

      const rules = [createMockRuleExtra()];
      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          analyses: [
            {
              ruleId: 'image-alt',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        }),
        model: 'gpt-4o',
      });

      await service.analyzeWithAI(
        createMockPageExtra() as never,
        createMockAxeResultsExtra(),
        rules,
      );

      expect(mockPromptBuilder.buildBatchUserPrompt).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeCommonProblems (lines 509-754)
  // ---------------------------------------------------------------------------
  describe('analyzeCommonProblems()', () => {
    it('returns an error when fewer than 2 pages are supplied', async () => {
      const result = await service.analyzeCommonProblems([
        createMockAxeResultsExtra(),
      ]);

      expect(result.problems).toEqual([]);
      expect(result.basedOnPages).toBe(1);
      expect(result.error).toContain('Au moins 2 pages');
      expect(mockOpenAIClient.chatCompletion).not.toHaveBeenCalled();
    });

    it('returns empty problems (no error) when nothing recurs on >= 2 pages', async () => {
      // Two pages but each violates a DIFFERENT rule → no rule on >=2 pages.
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('color-contrast')],
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(result.problems).toEqual([]);
      expect(result.error).toBeUndefined();
      expect(result.basedOnPages).toBe(2);
      expect(mockOpenAIClient.chatCompletion).not.toHaveBeenCalled();
    });

    it('returns the deterministic baseline when AI is not available', async () => {
      mockOpenAIClient.isReady.mockReturnValue(false);

      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(result.problems.length).toBeGreaterThan(0);
      // Catalog entry for image-alt.
      expect(result.problems[0]?.title).toContain('alternative textuelle');
      // Pages prefix injected.
      expect(result.problems[0]?.description).toContain('2 / 2 pages');
      expect(mockOpenAIClient.chatCompletion).not.toHaveBeenCalled();
    });

    it('aggregates recurring AI rule analyses across pages', async () => {
      const enriched = createEnrichedResult([
        {
          ruleId: 'image-alt',
          compliant: false,
          severity: 'critical',
          summary: 'AI: images sans alt',
          findings: [
            {
              type: 'violation',
              issue: 'image hero sans alt',
              recommendation: 'ajouter alt',
            },
          ],
        },
        {
          // Compliant rules are ignored in the AI aggregation.
          ruleId: 'color-contrast',
          compliant: true,
          severity: 'minor',
          summary: 'OK',
          findings: [],
        },
      ]);

      const page1 = createMockAxeResultsExtra({
        violations: [],
        aiEnrichedResult: enriched,
      });
      const page2 = createMockAxeResultsExtra({
        violations: [],
        aiEnrichedResult: enriched,
      });

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          enriched: [
            {
              index: 0,
              description: 'Description enrichie par IA.',
              recommendation: 'Recommandation IA.',
              codeExample: '<img alt="x">',
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(mockOpenAIClient.chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]?.description).toBe(
        'Description enrichie par IA.',
      );
      expect(result.problems[0]?.recommendation).toBe('Recommandation IA.');
      expect(result.problems[0]?.codeExample).toBe('<img alt="x">');
    });

    it('keeps baseline fields when AI returns blank enrichment values', async () => {
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({
          enriched: [
            {
              index: 0,
              description: '   ',
              recommendation: '',
              // no codeExample → falls back to base (catalog has one)
            },
          ],
        }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      // Blank AI values → baseline description/recommendation are preserved.
      expect(result.problems[0]?.description).toContain('2 / 2 pages');
      expect(result.problems[0]?.recommendation).toContain('Pour chaque image');
      // codeExample falls back to the catalog example (image-alt).
      expect(result.problems[0]?.codeExample).toContain('<img');
    });

    it('falls back to baseline when AI response has no JSON object', async () => {
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: 'Désolé, je ne peux pas produire de JSON ici.',
        model: 'gpt-4o',
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(result.problems.length).toBeGreaterThan(0);
      // No enrichment merged → baseline catalog description prefixed by pages.
      expect(result.problems[0]?.description).toContain('2 / 2 pages');
    });

    it('only aggregates AI findings of type "violation" with a non-empty issue', async () => {
      mockOpenAIClient.isReady.mockReturnValue(false);

      const enriched = createEnrichedResult([
        {
          ruleId: 'image-alt',
          compliant: false,
          severity: 'critical',
          summary: 'mix of findings',
          findings: [
            { type: 'violation', issue: 'real violation', recommendation: 'x' },
            // warning → must be ignored by the issue aggregation
            { type: 'warning', issue: 'just a warning', recommendation: 'x' },
            // violation with empty issue → must be ignored
            { type: 'violation', issue: '', recommendation: 'x' },
          ],
        },
      ]);

      const page1 = createMockAxeResultsExtra({
        violations: [],
        aiEnrichedResult: enriched,
      });
      const page2 = createMockAxeResultsExtra({
        violations: [],
        aiEnrichedResult: enriched,
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      // image-alt recurs on 2 pages → present in the baseline.
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.problems[0]?.title).toContain('alternative textuelle');
    });

    it('falls back to baseline when AI call rejects with a non-Error value', async () => {
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      // Reject with a string instead of an Error → String(err) branch.
      mockOpenAIClient.chatCompletion.mockRejectedValueOnce(
        'plain string error',
      );

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.basedOnPages).toBe(2);
    });

    it('falls back to baseline when AI call throws', async () => {
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      mockOpenAIClient.chatCompletion.mockRejectedValueOnce(
        new Error('provider down'),
      );

      const result = await service.analyzeCommonProblems([page1, page2]);

      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.basedOnPages).toBe(2);
    });

    it('falls back to baseline when enriched is not an array', async () => {
      const page1 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });
      const page2 = createMockAxeResultsExtra({
        violations: [createAxeViolation('image-alt')],
      });

      mockOpenAIClient.chatCompletion.mockResolvedValueOnce({
        response: JSON.stringify({ enriched: 'not-an-array' }),
        model: 'gpt-4o',
      });

      const result = await service.analyzeCommonProblems([page1, page2]);

      // enriched coerced to [] → no merge, baseline preserved.
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.problems[0]?.description).toContain('2 / 2 pages');
    });

    it('sorts recurring AI rules by descending page count', async () => {
      mockOpenAIClient.isReady.mockReturnValue(false);

      // Two distinct AI rules, both recurring; "label" on 3 pages,
      // "image-alt" on 2 pages → exercises the recurringAi sort comparator.
      const makeEnriched = (ids: string[]): IAIEnrichedResult =>
        createEnrichedResult(
          ids.map((ruleId) => ({
            ruleId,
            compliant: false,
            severity: 'serious',
            summary: `AI ${ruleId}`,
            findings: [
              {
                type: 'violation',
                issue: `${ruleId} issue`,
                recommendation: 'x',
              },
            ],
          })),
        );

      const pages: IAxeResult[] = [
        createMockAxeResultsExtra({
          violations: [],
          aiEnrichedResult: makeEnriched(['form-labels', 'image-alt']),
        }),
        createMockAxeResultsExtra({
          violations: [],
          aiEnrichedResult: makeEnriched(['form-labels', 'image-alt']),
        }),
        createMockAxeResultsExtra({
          violations: [],
          aiEnrichedResult: makeEnriched(['form-labels']),
        }),
      ];

      const result = await service.analyzeCommonProblems(pages);

      // form-labels (3 pages) maps to the "label" catalog entry and ranks first.
      expect(result.problems[0]?.title).toContain('étiquette');
      expect(result.problems.length).toBeGreaterThanOrEqual(2);
    });

    it('sorts and limits recurring axe rules by page count', async () => {
      mockOpenAIClient.isReady.mockReturnValue(false);

      // Rule "color-contrast" on 3 pages, "image-alt" on 2 pages.
      const pages: IAxeResult[] = [
        createMockAxeResultsExtra({
          violations: [
            createAxeViolation('color-contrast'),
            createAxeViolation('image-alt'),
          ],
        }),
        createMockAxeResultsExtra({
          violations: [
            createAxeViolation('color-contrast'),
            createAxeViolation('image-alt'),
          ],
        }),
        createMockAxeResultsExtra({
          violations: [createAxeViolation('color-contrast')],
        }),
      ];

      const result = await service.analyzeCommonProblems(pages);

      // Most recurrent first.
      expect(result.problems[0]?.title).toContain('Contraste');
      expect(result.basedOnPages).toBe(3);
    });
  });
});
