import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LLMRecordReplayService } from './llm-record-replay.service.js';

describe('LLMRecordReplayService', () => {
  const testBaseDir = join(tmpdir(), 'baldr-test-record-replay');

  beforeEach(() => {
    mkdirSync(testBaseDir, { recursive: true });
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('mode detection', () => {
    it('should be off by default', () => {
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      expect(service.getMode()).toBe('off');
    });

    it('should activate record mode when BALDR_LLM_RECORD=true', () => {
      vi.stubEnv('BALDR_LLM_RECORD', 'true');
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      expect(service.getMode()).toBe('record');
      expect(service.getRunId()).toMatch(/^run_\d+_/);
    });

    it('should activate replay mode when BALDR_LLM_REPLAY is set', () => {
      // Create the session dir first
      const runId = 'test-run-123';
      mkdirSync(join(testBaseDir, runId), { recursive: true });

      vi.stubEnv('BALDR_LLM_REPLAY', runId);
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      expect(service.getMode()).toBe('replay');
      expect(service.getRunId()).toBe(runId);
    });

    it('should throw if replay session dir does not exist', () => {
      vi.stubEnv('BALDR_LLM_REPLAY', 'nonexistent-run');
      expect(
        () => new LLMRecordReplayService({ baseDir: testBaseDir }),
      ).toThrow(/session directory not found/);
    });

    it('should prefer replay over record when both set', () => {
      const runId = 'dual-mode-run';
      mkdirSync(join(testBaseDir, runId), { recursive: true });
      vi.stubEnv('BALDR_LLM_RECORD', 'true');
      vi.stubEnv('BALDR_LLM_REPLAY', runId);
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      expect(service.getMode()).toBe('replay');
    });
  });

  describe('record', () => {
    it('should save LLM call to disk', () => {
      vi.stubEnv('BALDR_LLM_RECORD', 'true');
      const service = new LLMRecordReplayService({
        baseDir: testBaseDir,
        runId: 'record-test',
      });

      const messages = [{ role: 'user', content: 'Hello' }];
      const params = { temperature: 0 };
      const response = {
        response: 'Hi there',
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        model: 'gpt-4o',
      };

      service.record(messages, params, response);

      const sessionDir = join(testBaseDir, 'record-test');
      const files = readdirSync(sessionDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^0000_[a-f0-9]+\.json$/);
    });

    it('should do nothing in off mode', () => {
      const service = new LLMRecordReplayService({
        baseDir: testBaseDir,
        runId: 'off-test',
      });

      service.record(
        [{ role: 'user', content: 'test' }],
        {},
        { response: 'ok', model: 'gpt-4o' },
      );

      // No directory created for off-mode
      expect(existsSync(join(testBaseDir, 'off-test'))).toBe(false);
    });
  });

  describe('replay', () => {
    it('should replay a previously recorded call', () => {
      vi.stubEnv('BALDR_LLM_RECORD', 'true');
      const runId = 'replay-round-trip';
      const recorder = new LLMRecordReplayService({
        baseDir: testBaseDir,
        runId,
      });

      const messages = [{ role: 'system', content: 'You are a helper' }];
      const params = { temperature: 0, max_tokens: 100 };
      const response = {
        response: 'I can help!',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      };

      recorder.record(messages, params, response);
      vi.unstubAllEnvs();

      // Now replay
      vi.stubEnv('BALDR_LLM_REPLAY', runId);
      const replayer = new LLMRecordReplayService({ baseDir: testBaseDir });
      const result = replayer.replay(messages, params);

      expect(result).toEqual(response);
    });

    it('should return null for unrecorded call', () => {
      const runId = 'empty-session';
      mkdirSync(join(testBaseDir, runId), { recursive: true });

      vi.stubEnv('BALDR_LLM_REPLAY', runId);
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      const result = service.replay([{ role: 'user', content: 'unknown' }], {});
      expect(result).toBeNull();
    });

    it('should return null in off mode', () => {
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      const result = service.replay([{ role: 'user', content: 'test' }], {});
      expect(result).toBeNull();
    });
  });

  describe('computeHash', () => {
    it('should produce consistent hashes for same input', () => {
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      const messages = [{ role: 'user', content: 'Hello' }];
      const params = { temperature: 0 };

      const hash1 = service.computeHash(messages, params);
      const hash2 = service.computeHash(messages, params);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it('should produce different hashes for different inputs', () => {
      const service = new LLMRecordReplayService({ baseDir: testBaseDir });
      const hash1 = service.computeHash([{ role: 'user', content: 'A' }], {});
      const hash2 = service.computeHash([{ role: 'user', content: 'B' }], {});
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('LLMRecordReplayService — extra coverage', () => {
  const testBaseDir = join(tmpdir(), 'baldr-test-record-replay-extra');

  beforeEach(() => {
    mkdirSync(testBaseDir, { recursive: true });
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Hash-match fallback (lines 180-190): the recording sits at a NON-sequential
  // index, so the sequential lookup misses and the hash scan must find it.
  // ---------------------------------------------------------------------------
  it('replays via the hash-match fallback when the sequential index does not match', () => {
    const runId = 'hash-fallback-run';
    const sessionDir = join(testBaseDir, runId);
    mkdirSync(sessionDir, { recursive: true });

    const messages = [{ role: 'user', content: 'Need hash match' }];
    const params = { temperature: 0 };

    // Compute the hash the same way the service does (off-mode instance is fine).
    const hashHelper = new LLMRecordReplayService({ baseDir: testBaseDir });
    const hash = hashHelper.computeHash(messages, params);

    const response = {
      response: 'matched by hash',
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      model: 'gpt-4o',
    };

    // Write the recording at a non-zero index so the `0000_<hash>.json`
    // sequential lookup misses but the hash-scan fallback finds it.
    writeFileSync(
      join(sessionDir, `0007_${hash}.json`),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        hash,
        messages,
        generationParams: params,
        response,
      }),
      'utf-8',
    );

    vi.stubEnv('BALDR_LLM_REPLAY', runId);
    const replayer = new LLMRecordReplayService({ baseDir: testBaseDir });

    const result = replayer.replay(messages, params);
    expect(result).toEqual(response);
  });

  it('ignores non-matching files during the hash-scan fallback', () => {
    const runId = 'hash-fallback-noise';
    const sessionDir = join(testBaseDir, runId);
    mkdirSync(sessionDir, { recursive: true });

    const messages = [{ role: 'user', content: 'target' }];
    const params = {};

    const hashHelper = new LLMRecordReplayService({ baseDir: testBaseDir });
    const hash = hashHelper.computeHash(messages, params);

    // Noise files: a non-json file and a json with a different hash.
    writeFileSync(join(sessionDir, `0001_deadbeef.json`), '{}', 'utf-8');
    writeFileSync(join(sessionDir, `notes_${hash}.txt`), 'ignore me', 'utf-8');

    const response = { response: 'found', model: 'gpt-4o' };
    writeFileSync(
      join(sessionDir, `0009_${hash}.json`),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        hash,
        messages,
        generationParams: params,
        response,
      }),
      'utf-8',
    );

    vi.stubEnv('BALDR_LLM_REPLAY', runId);
    const replayer = new LLMRecordReplayService({ baseDir: testBaseDir });

    expect(replayer.replay(messages, params)).toEqual(response);
  });

  // ---------------------------------------------------------------------------
  // readdirSyncSafe catch (line ~206): session dir removed after construction.
  // The sequential file is absent and readdir throws → safe [] → replay miss.
  // ---------------------------------------------------------------------------
  it('returns null (replay miss) when the session directory becomes unreadable', () => {
    const runId = 'vanishing-session';
    const sessionDir = join(testBaseDir, runId);
    mkdirSync(sessionDir, { recursive: true });

    vi.stubEnv('BALDR_LLM_REPLAY', runId);
    const replayer = new LLMRecordReplayService({ baseDir: testBaseDir });

    // Remove the directory after the service validated its existence.
    rmSync(sessionDir, { recursive: true, force: true });

    const result = replayer.replay([{ role: 'user', content: 'gone' }], {
      temperature: 0,
    });
    expect(result).toBeNull();
  });
});
