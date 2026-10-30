import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { loadConfig } from '@shared/config/config.js';
import { createLogger } from '@shared/utils/logger.js';
import { journeyRequestSchema } from '@shared/validation/schemas.js';
import { BrowserService } from '@shared/services/browser/browser.service.js';
import { AxeRunnerService } from '@shared/services/axe/axe-runner.service.js';
import { ReportGeneratorService } from '@shared/services/report/report-generator.service.js';
import { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import { AIErrorClassifierService } from '@shared/services/ai/ai-error-classifier.service.js';
import { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';
import { ActionExecutorService } from '@shared/services/journey/action-executor.service.js';
import { ActionParserService } from '@shared/services/journey/action-parser.service.js';
import { CookieBannerService } from '@shared/services/journey/cookie-banner.service.js';
import { JourneyOrchestrationService } from '@shared/services/journey/journey-orchestration.service.js';
import { convertJourneyRequestToOptions } from '@shared/adapters/journey-api.adapter.js';
import type {
  IJourneyReport,
  JourneyReports,
} from '@shared/services/journey/journey-orchestration.types.js';
import type { ValidatedJourneyRequest } from '@shared/validation/schemas.js';

const logger = createLogger('cli');

/**
 * Extended help appended after the auto-generated options list. Documents the
 * v3 JSON request, the call variants (file/stdin, output, format), the adaptive
 * authentication modes and the LLM provider configuration.
 */
const RUN_HELP = `
Input & output:
  The request is read from <file>, or from stdin when <file> is omitted.
  The report goes to <path> with -o (a confirmation line is printed on stderr),
  otherwise to stdout — so it can be piped or redirected. --format overrides
  options.reportFormat from the file for this run.
  Asking for several formats (e.g. ["html", "json"]) produces one report per
  format: they are always written to files (never stdout), -o giving the base
  path — "-o report.html" yields report.html and report.json; without -o the
  audit name is used.

JSON request (v3) — only "pages" is required:
  {
    "name": "Customer Area Audit",          // report title + output filename   (optional)
    "options": {
      "analysisType": "full",               // static | intel | full            (default full)
      "reportFormat": "html",               // html | json | csv, or a list     (default html)
                                            //   e.g. ["html", "json"] -> 2 files
      "rules": ["1.1", "3.1"],              // restrict to RGAA rule ids         (all by default)
      "viewport": { "width": 1920, "height": 1080 }    // width >= 320, height >= 240
    },
    "auth": { "username": "jdoe", "password": "secret" },   // audited-site login (optional)
    //  ... or manual (interactive) login, local only:
    //  "auth": { "type": "manual" },                        // 2FA/MFA by hand  (optional)
    "pages": [                              // ordered list, 1..30               (REQUIRED)
      {
        "url": "https://www.wikipedia.org", // http(s), SSRF-validated           (REQUIRED)
        "auth": { "username": "...", "password": "..." },   // overrides root     (optional)
        "actions": [                        // run in order, max 50              (optional)
          { "type": "acceptCookies" },
          { "type": "wait", "ms": 1500 },
          { "type": "scan" }                // a page with no actions = one scan
        ]
      }
    ]
  }

  Minimal:  { "pages": [ { "url": "https://www.wikipedia.org" } ] }

Actions ("type" field):
  Without AI (no LLM key needed):
    scan                          run the accessibility audit + screenshot
    acceptCookies                 accept the cookie banner (Didomi, OneTrust, Tarteaucitron...)
    wait        { ms }            fixed pause, 1..60000 ms
  With AI (LLM key required — the selector is inferred from "target"):
    click       { target }        click the described element
    hover       { target }        hover the described element
    fill        { target, value } type "value" into the described field
    select      { target, value } pick "value" in the described list
    ai          { instruction }   free-form natural-language step
  "target" / "instruction": natural-language description, max 500 chars.

Authentication (credentials of the AUDITED SITE — not the LLM key):
  Set "auth" at the root (applied to every page) and/or per page (overrides the
  root). Omit it for public pages. Two modes, discriminated by "type":

  auto (default when "type" is omitted) — automated, adapts to the site:
    - Native HTTP popup (Basic / NTLM) — answered silently from username/password.
    - HTML login form — fields located by heuristics, filled and submitted;
      two-step forms (e.g. ADFS: username first, then password) are supported.
    - loginUrl (optional) — visited first when the login page differs from the
      audited URL (auto-detected otherwise); the run then returns to the page URL.
    Fields:  username (REQUIRED) - password (REQUIRED) - loginUrl (optional)
    Not supported: transparent domain SSO (Kerberos / Negotiate with no prompt).

  manual (interactive — CLI / LOCAL USE ONLY) — for 2FA / MFA / SSO you log in by hand:
    Baldr opens a VISIBLE browser and pauses. Authenticate yourself (including any
    2FA/MFA), then reach the URL you want to audit. Baldr resumes when the browser
    stays on that URL (debounced), or immediately when you press Enter in the terminal.
    A visible browser is forced automatically (no PUPPETEER_HEADFUL needed). Available
    only via the CLI in a non-production environment (rejected on the HTTP server and
    when NODE_ENV=production).
    For heavy multi-redirect SSO (Microsoft 365 / SharePoint) set
    "waitForManualConfirm": true and press Enter once the page is fully rendered — the
    URL bar shows the target before the SPA content is ready, so URL auto-resume can
    otherwise scan a half-loaded page.
    IMPORTANT: the Enter key needs a real interactive terminal. On Windows run in
    PowerShell or cmd (NOT Git Bash / MinTTY), and pass the request as a FILE argument
    (not piped via stdin) — otherwise Enter is unavailable and Baldr falls back to URL
    auto-detection.
    Fields:  type: "manual" (REQUIRED) - loginUrl (optional) -
             timeoutMs (optional, default 300000 = 5 min, range 10000..1800000) -
             waitForManualConfirm (optional bool; Enter-only resume)

  A successful session is cached (~30 min) and reused across pages, so with a
  single root-level "auth" you authenticate only once for the whole journey.

LLM provider (intel/full analysis + click/hover/fill/select/ai actions):
  Configure once in your environment (presence of the API key enables AI):
    LLM_PROVIDER_API_KEY=sk-...                      # presence enables AI (none -> Axe-only)
    LLM_PROVIDER_ENDPOINT=https://api.openai.com/v1  # default
    LLM_PROVIDER_MODEL=gpt-4o                         # default
    LLM_CONTEXT_LIMIT=128000                          # optional (auto-detected otherwise)
  ... or per run with --llm-api-key / --llm-endpoint / --llm-model /
  --llm-context-limit (these take precedence over .env).
  No LLM key -> use analysisType "static" and only scan / acceptCookies / wait.

Examples:
  # Public page, HTML report to stdout
  $ baldr run request.json

  # Write the report to a file (path echoed on stderr)
  $ baldr run request.json -o report.html

  # Read the request from stdin (pipe or redirect)
  $ cat request.json | baldr run
  $ baldr run < request.json

  # Force the report format regardless of options.reportFormat in the file
  $ baldr run request.json --format json -o report.json

  # Several formats in a single run -> report.html + report.json
  $ baldr run request.json --format html,json -o report.html

  # Enable AI for this run only and pick the model
  $ baldr run request.json -o report.html --llm-api-key sk-xxxx --llm-model gpt-4o

  # Point at an internal OpenAI-compatible endpoint
  $ baldr run request.json -o report.html \\
      --llm-endpoint https://llm.internal.example.com/v1 \\
      --llm-api-key sk-xxxx --llm-context-limit 128000

  # Manual auth (2FA/MFA): a visible browser opens, you log in by hand, then
  # Baldr resumes. Pass the request as a FILE so the terminal stays interactive.
  # request.json → { "auth": { "type": "manual" }, "pages": [ { "url": "..." } ] }
  $ baldr run request.json -o report.html

  # Microsoft 365 / SharePoint (Windows): run in PowerShell/cmd, Enter-only resume.
  # request.json → { "auth": { "type": "manual", "waitForManualConfirm": true }, ... }
  # Log in, wait for the page to fully render, then press Enter in the terminal.
  PS> baldr run request.json -o report.html
`;

/** Subset of `run` options carrying LLM provider overrides. */
export interface LlmCliOptions {
  llmModel?: string;
  llmEndpoint?: string;
  llmApiKey?: string;
  llmContextLimit?: string;
}

/**
 * Maps `--llm-*` CLI flags to their `LLM_PROVIDER_*` env-var names. Only keys
 * for flags actually passed are included, so an absent flag leaves the env
 * value (or default) untouched. Values stay strings — loadConfig's Zod schema
 * coerces `LLM_CONTEXT_LIMIT` to a number.
 */
export function buildEnvOverrides(
  options: LlmCliOptions,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  if (options.llmModel != null)
    overrides['LLM_PROVIDER_MODEL'] = options.llmModel;
  if (options.llmEndpoint != null)
    overrides['LLM_PROVIDER_ENDPOINT'] = options.llmEndpoint;
  if (options.llmApiKey != null)
    overrides['LLM_PROVIDER_API_KEY'] = options.llmApiKey;
  if (options.llmContextLimit != null)
    overrides['LLM_CONTEXT_LIMIT'] = options.llmContextLimit;
  return overrides;
}

/**
 * Creates the `run` command that executes a journey from a JSON file or stdin.
 */
export function createRunCommand(): Command {
  return new Command('run')
    .description('Execute an accessibility audit journey')
    .argument('[file]', 'Path to a JSON request file (omit to read from stdin)')
    .option('-o, --output <path>', 'Write report to file instead of stdout')
    .option(
      '--format <formats>',
      'Override reportFormat: html|json|csv, comma-separated for several (html,json)',
    )
    .option('--llm-model <model>', 'Override LLM_PROVIDER_MODEL for this run')
    .option(
      '--llm-endpoint <url>',
      'Override LLM_PROVIDER_ENDPOINT (full OpenAI-compatible base URL incl. /v1)',
    )
    .option(
      '--llm-api-key <key>',
      'Override LLM_PROVIDER_API_KEY (its presence enables the LLM provider)',
    )
    .option(
      '--llm-context-limit <tokens>',
      'Override LLM_CONTEXT_LIMIT (model context window, in tokens)',
    )
    .addHelpText('after', RUN_HELP)
    .action(
      async (
        file: string | undefined,
        options: { output?: string; format?: string } & LlmCliOptions,
      ) => {
        try {
          const input = readInput(file);
          const payload = parseAndValidate(input, options.format);
          const reports = await executeAudit(
            payload,
            buildEnvOverrides(options),
          );
          writeOutput(reports, options.output);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: err }, message);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      },
    );
}

function readInput(file: string | undefined): string {
  if (file != null && file !== '') {
    return readFileSync(resolve(file), 'utf-8');
  }
  return readFileSync(0, 'utf-8');
}

function parseAndValidate(
  input: string,
  formatOverride?: string,
): ValidatedJourneyRequest {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error('Invalid JSON input');
  }

  if (
    formatOverride != null &&
    formatOverride !== '' &&
    typeof payload === 'object' &&
    payload !== null
  ) {
    // reportFormat lives under `options` in the v3 contract; "html,json" asks
    // for one report per format.
    const formats = formatOverride.split(',').map((f) => f.trim());
    const p = payload as Record<string, unknown>;
    const opts =
      typeof p['options'] === 'object' && p['options'] !== null
        ? (p['options'] as Record<string, unknown>)
        : {};
    opts['reportFormat'] = formats.length > 1 ? formats : formats[0];
    p['options'] = opts;
  }

  const result = journeyRequestSchema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Validation failed:\n${issues}`);
  }

  return result.data;
}

async function executeAudit(
  payload: ValidatedJourneyRequest,
  envOverrides: Record<string, string> = {},
): Promise<JourneyReports> {
  const config = loadConfig(envOverrides);

  const browserService = new BrowserService({
    browser: config.browser,
    env: config.env,
  });
  const axeRunner = new AxeRunnerService();
  const reportGenerator = new ReportGeneratorService();
  const aiErrorClassifier = new AIErrorClassifierService();
  const screenshotService = new ScreenshotService();
  // Single OpenAI client shared by the analyzer and the journey orchestration
  // so they share one LRU cache (no duplicate clients).
  const openaiClient = new OpenAIClientService({
    llmProvider: config.llmProvider,
    proxy: config.proxy,
    env: config.env,
  });
  const aiAnalyzer = new AIAnalyzerService({
    openaiClient,
    screenshotService,
    contextLimit: config.llmProvider?.contextLimit,
  });
  const actionParser = new ActionParserService(
    openaiClient,
    screenshotService,
    undefined,
    config.businessSelectors,
  );
  const actionExecutor = new ActionExecutorService();
  const cookieBanner = new CookieBannerService();

  const orchestration = new JourneyOrchestrationService(
    browserService,
    axeRunner,
    aiAnalyzer,
    aiErrorClassifier,
    reportGenerator,
    screenshotService,
    actionExecutor,
    actionParser,
    cookieBanner,
    openaiClient,
  );

  try {
    const options = convertJourneyRequestToOptions(payload);
    const execResult = await orchestration.execute(options);
    return await orchestration.generateReports(
      execResult,
      options.reportFormats,
      options.name,
    );
  } finally {
    await orchestration.cleanup();
  }
}

/** Report extensions the CLI may swap when a run produces several files. */
const REPORT_EXTENSIONS = new Set(['.html', '.json', '.csv']);

/**
 * Target path of one report. A single report honours `-o` as given; a
 * multi-format run treats `-o` as a base path whose extension is swapped
 * (`-o report.html` -> report.html + report.json).
 */
function targetPathFor(
  report: IJourneyReport,
  outputPath: string | undefined,
  multiple: boolean,
): string {
  const filename = report.filename ?? 'rapport-journey.html';
  if (outputPath == null || outputPath === '') return filename;
  if (!multiple) return outputPath;

  const currentExt = extname(outputPath).toLowerCase();
  const stem = REPORT_EXTENSIONS.has(currentExt)
    ? outputPath.slice(0, -currentExt.length)
    : outputPath;
  return `${stem}${extname(filename)}`;
}

function writeOutput(reports: JourneyReports, outputPath?: string): void {
  const hasOutput = outputPath != null && outputPath !== '';
  const multiple = reports.length > 1;

  for (const report of reports) {
    // stdout carries a single payload: a multi-format run always writes files.
    if (!hasOutput && !multiple) {
      process.stdout.write(report.content);
      continue;
    }
    const path = targetPathFor(report, outputPath, multiple);
    writeFileSync(resolve(path), report.content, 'utf-8');
    process.stderr.write(`Report written to ${path}\n`);
  }
}
