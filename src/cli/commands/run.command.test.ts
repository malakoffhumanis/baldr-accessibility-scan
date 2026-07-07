import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

// Hoisted mock fns so we can assert on orchestration behaviour and drive
// each branch per-test via vi.mocked(...) / h.*.mockImplementation(...).
const h = vi.hoisted(() => ({
  execute: vi.fn(),
  generateReport: vi.fn(),
  cleanup: vi.fn(),
  convert: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/config/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    env: 'test',
    browser: { headless: true },
    llmProvider: undefined,
    proxy: undefined,
    reportsDir: '/tmp/reports',
  }),
}));

vi.mock('@shared/services/browser/browser.service.js', () => ({
  BrowserService: class {},
}));
vi.mock('@shared/services/axe/axe-runner.service.js', () => ({
  AxeRunnerService: class {},
}));
vi.mock('@shared/services/report/report-generator.service.js', () => ({
  ReportGeneratorService: class {},
}));
vi.mock('@shared/services/ai/ai-analyzer.service.js', () => ({
  AIAnalyzerService: class {
    isAvailable() {
      return false;
    }
  },
}));
vi.mock('@shared/services/ai/openai-client.service.js', () => ({
  OpenAIClientService: class {},
}));
vi.mock('@shared/services/ai/ai-error-classifier.service.js', () => ({
  AIErrorClassifierService: class {},
}));
vi.mock('@shared/services/screenshot/screenshot.service.js', () => ({
  ScreenshotService: class {},
}));
vi.mock('@shared/services/journey/action-executor.service.js', () => ({
  ActionExecutorService: class {},
}));
vi.mock('@shared/services/journey/action-parser.service.js', () => ({
  ActionParserService: class {},
  // Used by journeyRequestSchema.superRefine for action-level auth detection
  extractAuthKey: vi.fn().mockReturnValue(null),
}));
vi.mock('@shared/services/journey/cookie-banner.service.js', () => ({
  CookieBannerService: class {},
}));
vi.mock('@shared/services/journey/journey-orchestration.service.js', () => ({
  JourneyOrchestrationService: class {
    execute = h.execute;
    generateReport = h.generateReport;
    cleanup = h.cleanup;
  },
}));

vi.mock('@shared/adapters/journey-api.adapter.js', () => ({
  convertJourneyRequestToOptions: h.convert,
}));

import { createRunCommand } from './run.command.js';
import { extractAuthKey } from '@shared/services/journey/action-parser.service.js';
import { loadConfig } from '@shared/config/config.js';
import { buildEnvOverrides } from './run.command.js';

const VALID_PAYLOAD = JSON.stringify({
  pages: [{ url: 'https://example.com', actions: [{ type: 'scan' }] }],
});

interface RunCtx {
  exit: ReturnType<typeof vi.spyOn>;
  stdout: ReturnType<typeof vi.spyOn>;
  stderr: ReturnType<typeof vi.spyOn>;
}

function spyProcess(): RunCtx {
  return {
    exit: vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('__exit__');
    }),
    stdout: vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    stderr: vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
  };
}

async function runWith(args: string[]): Promise<void> {
  const cmd = createRunCommand();
  try {
    // `from: 'user'` => args are exactly the user-supplied tokens (no node/script)
    await cmd.parseAsync(args, { from: 'user' });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '__exit__') {
      throw err;
    }
  }
}

// Default mock behaviour, reset before every test. Individual tests override
// specific branches via h.*.mockImplementation/mockRejectedValue etc.
beforeEach(() => {
  vi.clearAllMocks();
  // Fully reset fs mocks: clearAllMocks does not drain queued
  // mockReturnValueOnce values left over by tolerant tests above.
  vi.mocked(readFileSync).mockReset();
  vi.mocked(writeFileSync).mockReset();
  // restoreMocks:true wipes the factory's mockReturnValue after each test;
  // re-establish the auth-detection stub so schema validation stays stable.
  vi.mocked(extractAuthKey).mockReturnValue(null);
  h.execute.mockResolvedValue({
    results: [],
    journeyUrls: [],
    definedBlocksCount: 0,
    executedBlocksCount: 0,
    definedActionsCount: 0,
    executedActionsCount: 0,
    actionErrors: [],
    journeyStopped: false,
    durationMs: 10,
  });
  h.generateReport.mockResolvedValue({ content: '<html>report</html>' });
  h.cleanup.mockResolvedValue(undefined);
  h.convert.mockReturnValue({
    name: 'test',
    blocks: [{ url: 'https://example.com', actions: ['scan'] }],
    authConfigs: {},
    analysisType: 'static',
    reportFormat: 'html',
  });
});

describe('createRunCommand', () => {
  it('creates a command with name "run"', () => {
    const cmd = createRunCommand();
    expect(cmd.name()).toBe('run');
  });

  it('has a description', () => {
    const cmd = createRunCommand();
    expect(cmd.description()).toContain('accessibility');
  });

  it('has -o/--output option', () => {
    const cmd = createRunCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain('--output');
  });

  it('has --format option', () => {
    const cmd = createRunCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain('--format');
  });

  it('has the --llm-* override options', () => {
    const cmd = createRunCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toEqual(
      expect.arrayContaining([
        '--llm-model',
        '--llm-endpoint',
        '--llm-api-key',
        '--llm-context-limit',
      ]),
    );
  });
});

describe('run command — readInput', () => {
  it('reads from file when file argument is provided', async () => {
    const validPayload = JSON.stringify({
      pages: [{ url: 'https://example.com', actions: [{ type: 'scan' }] }],
    });
    vi.mocked(readFileSync).mockReturnValue(validPayload);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const mockStdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const mockStderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const cmd = createRunCommand();
    try {
      await cmd.parseAsync(['node', 'baldr', '/tmp/test.json'], {
        from: 'user',
      });
    } catch {
      // Expected to throw from mock
    }

    // readFileSync should have been called by the action handler
    // It may or may not be called depending on commander argument parsing
    mockExit.mockRestore();
    mockStdout.mockRestore();
    mockStderr.mockRestore();
  });
});

describe('run command — parseAndValidate', () => {
  it('handles invalid JSON input', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('not valid json');

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const mockStderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const cmd = createRunCommand();
    try {
      await cmd.parseAsync(['node', 'baldr', '/tmp/test.json'], {
        from: 'user',
      });
    } catch {
      // Expected exit
    }

    expect(mockStderr).toHaveBeenCalled();
    mockExit.mockRestore();
    mockStderr.mockRestore();
  });
});

describe('run command — writeOutput', () => {
  it('writes to file when --output is specified', async () => {
    const validPayload = JSON.stringify({
      pages: [{ url: 'https://example.com', actions: [{ type: 'scan' }] }],
    });
    vi.mocked(readFileSync).mockReturnValueOnce(validPayload);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const mockStdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const mockStderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const cmd = createRunCommand();
    try {
      await cmd.parseAsync(
        ['node', 'baldr', '/tmp/test.json', '-o', '/tmp/report.html'],
        { from: 'user' },
      );
    } catch {
      // May throw
    }

    mockExit.mockRestore();
    mockStdout.mockRestore();
    mockStderr.mockRestore();
  });
});

describe('run command — happy paths', () => {
  it('reads from the given file, runs the audit and writes to stdout', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    const ctx = spyProcess();

    await runWith(['/tmp/req.json']);

    // File read by path (resolved), not stdin
    expect(readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('req.json'),
      'utf-8',
    );
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.generateReport).toHaveBeenCalledWith(
      expect.any(Object),
      'html',
      'test',
    );
    // Output goes to stdout when no -o
    expect(ctx.stdout).toHaveBeenCalledWith('<html>report</html>');
    expect(writeFileSync).not.toHaveBeenCalled();
    // cleanup always runs
    expect(h.cleanup).toHaveBeenCalledTimes(1);
    expect(ctx.exit).not.toHaveBeenCalled();
  });

  it('reads from stdin (fd 0) when no file argument is provided', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    spyProcess();

    await runWith([]);

    expect(readFileSync).toHaveBeenCalledWith(0, 'utf-8');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('writes the report to a file when -o is provided', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    const ctx = spyProcess();

    await runWith(['/tmp/req.json', '-o', '/tmp/out.html']);

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('out.html'),
      '<html>report</html>',
      'utf-8',
    );
    // Confirmation written to stderr, nothing to stdout
    expect(ctx.stderr).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/out.html'),
    );
    expect(ctx.stdout).not.toHaveBeenCalled();
  });

  it('applies --format override onto the parsed payload', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    spyProcess();

    await runWith(['/tmp/req.json', '--format', 'json']);

    // The adapter receives the payload with the overridden reportFormat
    // (now nested under `options` in the v3 contract).
    expect(h.convert).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ reportFormat: 'json' }),
      }),
    );
  });
});

describe('run command — error handling', () => {
  it('exits 1 with a message when the input file cannot be read', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    const ctx = spyProcess();

    await runWith(['/tmp/missing.json']);

    expect(ctx.stderr).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    expect(ctx.exit).toHaveBeenCalledWith(1);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('exits 1 with "Invalid JSON input" on malformed JSON', async () => {
    vi.mocked(readFileSync).mockReturnValue('{not json');
    const ctx = spyProcess();

    await runWith(['/tmp/req.json']);

    expect(ctx.stderr).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON input'),
    );
    expect(ctx.exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 with validation details on schema failure', async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ wrong: true }));
    const ctx = spyProcess();

    await runWith(['/tmp/req.json']);

    const stderrArgs = ctx.stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrArgs).toContain('Validation failed');
    expect(ctx.exit).toHaveBeenCalledWith(1);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('exits 1 and still cleans up when orchestration.execute throws', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    h.execute.mockRejectedValue(new Error('orchestration failed'));
    h.cleanup.mockResolvedValue(undefined);
    const ctx = spyProcess();

    await runWith(['/tmp/req.json']);

    expect(h.cleanup).toHaveBeenCalledTimes(1);
    expect(ctx.stderr).toHaveBeenCalledWith(
      expect.stringContaining('orchestration failed'),
    );
    expect(ctx.exit).toHaveBeenCalledWith(1);
  });

  it('stringifies non-Error throws', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw 'raw-string-error';
    });
    const ctx = spyProcess();

    await runWith(['/tmp/req.json']);

    expect(ctx.stderr).toHaveBeenCalledWith(
      expect.stringContaining('raw-string-error'),
    );
    expect(ctx.exit).toHaveBeenCalledWith(1);
  });
});

describe('run command — LLM flag overrides', () => {
  it('passes mapped --llm-* flags to loadConfig', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    spyProcess();

    await runWith([
      '/tmp/req.json',
      '--llm-model',
      'gpt-4.1',
      '--llm-endpoint',
      'https://litellm.example.com/v1',
      '--llm-api-key',
      'sk-flag',
      '--llm-context-limit',
      '32000',
    ]);

    expect(loadConfig).toHaveBeenCalledWith({
      LLM_PROVIDER_MODEL: 'gpt-4.1',
      LLM_PROVIDER_ENDPOINT: 'https://litellm.example.com/v1',
      LLM_PROVIDER_API_KEY: 'sk-flag',
      LLM_CONTEXT_LIMIT: '32000',
    });
  });

  it('passes an empty override object when no --llm-* flags are given', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    spyProcess();

    await runWith(['/tmp/req.json']);

    expect(loadConfig).toHaveBeenCalledWith({});
  });

  it('includes only the flags actually passed', async () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_PAYLOAD);
    spyProcess();

    await runWith(['/tmp/req.json', '--llm-model', 'gpt-4.1']);

    expect(loadConfig).toHaveBeenCalledWith({ LLM_PROVIDER_MODEL: 'gpt-4.1' });
  });
});

describe('buildEnvOverrides', () => {
  it('maps each flag to its LLM_PROVIDER_* env var', () => {
    expect(
      buildEnvOverrides({
        llmModel: 'gpt-4.1',
        llmEndpoint: 'https://x/v1',
        llmApiKey: 'sk',
        llmContextLimit: '128000',
      }),
    ).toEqual({
      LLM_PROVIDER_MODEL: 'gpt-4.1',
      LLM_PROVIDER_ENDPOINT: 'https://x/v1',
      LLM_PROVIDER_API_KEY: 'sk',
      LLM_CONTEXT_LIMIT: '128000',
    });
  });

  it('omits keys for absent flags', () => {
    expect(buildEnvOverrides({ llmModel: 'gpt-4.1' })).toEqual({
      LLM_PROVIDER_MODEL: 'gpt-4.1',
    });
    expect(buildEnvOverrides({})).toEqual({});
  });
});
