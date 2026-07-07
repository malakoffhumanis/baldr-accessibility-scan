import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('llm-record-replay');

/**
 * Recorded LLM call entry stored on disk.
 */
interface IRecordedCall {
  timestamp: string;
  hash: string;
  messages: unknown[];
  generationParams: Record<string, unknown>;
  response: {
    response: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    model: string;
  };
}

/**
 * Response shape from OpenAI client (duplicated to avoid circular import).
 */
interface ILLMResponse {
  response: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

export type RecordReplayMode = 'record' | 'replay' | 'off';

/**
 * Service to record and replay LLM calls for deterministic testing
 * and debugging.
 *
 * - BALDR_LLM_RECORD=true → records all LLM calls to disk
 * - BALDR_LLM_REPLAY=<run_id> → replays from recorded session
 *
 * Recordings are stored in: <baseDir>/<runId>/<hash>.json
 * Hash is computed from messages + generationParams (deterministic key).
 */
export class LLMRecordReplayService {
  private readonly mode: RecordReplayMode;
  private readonly baseDir: string;
  private readonly runId: string;
  private readonly sessionDir: string;
  private callIndex = 0;

  constructor(options?: { baseDir?: string; runId?: string }) {
    const replayId = process.env['BALDR_LLM_REPLAY'];
    const recordEnabled = process.env['BALDR_LLM_RECORD'] === 'true';

    if (replayId !== undefined && replayId !== '') {
      this.mode = 'replay';
      this.runId = replayId;
    } else if (recordEnabled) {
      this.mode = 'record';
      this.runId =
        options?.runId ?? `run_${String(Date.now())}_${randomSuffix()}`;
    } else {
      this.mode = 'off';
      this.runId = '';
    }

    this.baseDir =
      options?.baseDir ?? join(process.cwd(), '.baldr', 'llm-sessions');
    this.sessionDir = join(this.baseDir, this.runId);

    if (this.mode === 'record') {
      mkdirSync(this.sessionDir, { recursive: true });
      logger.info(
        { runId: this.runId, dir: this.sessionDir },
        'LLM Record mode enabled',
      );
    } else if (this.mode === 'replay') {
      if (!existsSync(this.sessionDir)) {
        throw new Error(
          `LLM Replay: session directory not found: ${this.sessionDir}`,
        );
      }
      logger.info(
        { runId: this.runId, dir: this.sessionDir },
        'LLM Replay mode enabled',
      );
    }
  }

  getMode(): RecordReplayMode {
    return this.mode;
  }

  getRunId(): string {
    return this.runId;
  }

  /**
   * Compute a deterministic hash for an LLM call based on its inputs.
   */
  computeHash(
    messages: unknown[],
    generationParams: Record<string, unknown>,
  ): string {
    const payload = JSON.stringify({ messages, generationParams });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Record an LLM call response to disk.
   */
  record(
    messages: unknown[],
    generationParams: Record<string, unknown>,
    response: ILLMResponse,
  ): void {
    if (this.mode !== 'record') return;

    const hash = this.computeHash(messages, generationParams);
    const index = String(this.callIndex++).padStart(4, '0');
    const filename = `${index}_${hash}.json`;
    const filepath = join(this.sessionDir, filename);

    const entry: IRecordedCall = {
      timestamp: new Date().toISOString(),
      hash,
      messages,
      generationParams,
      response,
    };

    writeFileSync(filepath, JSON.stringify(entry, null, 2), 'utf-8');
    logger.debug({ filename, hash }, 'LLM call recorded');
  }

  /**
   * Attempt to replay an LLM call from the recorded session.
   * Returns null if no matching recording found.
   */
  replay(
    messages: unknown[],
    generationParams: Record<string, unknown>,
  ): ILLMResponse | null {
    if (this.mode !== 'replay') return null;

    const hash = this.computeHash(messages, generationParams);

    // Search for a file matching this hash in the session directory
    const indexFile = join(
      this.sessionDir,
      `${String(this.callIndex).padStart(4, '0')}_${hash}.json`,
    );

    // Try sequential match first (same order)
    if (existsSync(indexFile)) {
      const entry = JSON.parse(
        readFileSync(indexFile, 'utf-8'),
      ) as IRecordedCall;
      this.callIndex++;
      logger.debug({ hash, file: indexFile }, 'LLM call replayed (sequential)');
      return entry.response;
    }

    // Fallback: search by hash in any file
    const files = readdirSyncSafe(this.sessionDir);
    for (const file of files) {
      if (file.includes(hash) && file.endsWith('.json')) {
        const filepath = join(this.sessionDir, file);
        const entry = JSON.parse(
          readFileSync(filepath, 'utf-8'),
        ) as IRecordedCall;
        this.callIndex++;
        logger.debug({ hash, file }, 'LLM call replayed (hash match)');
        return entry.response;
      }
    }

    logger.warn({ hash }, 'LLM replay miss — no matching recording found');
    return null;
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir, 'utf-8');
  } catch {
    return [];
  }
}
