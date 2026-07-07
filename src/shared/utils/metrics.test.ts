import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock prom-client before importing metrics
vi.mock('prom-client', () => {
  class Counter {
    inc = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class Histogram {
    observe = vi.fn();
    startTimer = vi.fn().mockReturnValue(vi.fn());
    labels = vi.fn().mockReturnThis();
  }
  class Gauge {
    inc = vi.fn();
    dec = vi.fn();
    set = vi.fn();
  }
  return {
    default: {
      collectDefaultMetrics: vi.fn(),
      Counter,
      Histogram,
      Gauge,
      register: {
        metrics: vi.fn().mockResolvedValue('# HELP baldr_test\n'),
        contentType: 'text/plain; version=0.0.4',
      },
    },
  };
});

import {
  llmCallsTotal,
  llmCallDuration,
  llmTokensTotal,
  llmCacheHits,
  auditRequestsTotal,
  auditDuration,
  activeAudits,
  getMetrics,
  getMetricsContentType,
} from './metrics.js';

describe('metrics', () => {
  it('exports all metric instances', () => {
    expect(llmCallsTotal).toBeDefined();
    expect(llmCallDuration).toBeDefined();
    expect(llmTokensTotal).toBeDefined();
    expect(llmCacheHits).toBeDefined();
    expect(auditRequestsTotal).toBeDefined();
    expect(auditDuration).toBeDefined();
    expect(activeAudits).toBeDefined();
  });

  it('getMetrics returns prometheus text format', async () => {
    const metrics = await getMetrics();
    expect(typeof metrics).toBe('string');
  });

  it('getMetricsContentType returns correct mime type', () => {
    const contentType = getMetricsContentType();
    expect(contentType).toContain('text/plain');
  });
});
