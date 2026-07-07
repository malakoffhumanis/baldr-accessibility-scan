import client from 'prom-client';

/**
 * Application metrics using prom-client (Prometheus format).
 * Exposes counters, histograms, and gauges for observability.
 */

// Collect default Node.js metrics (event loop lag, heap, GC, etc.)
client.collectDefaultMetrics({ prefix: 'baldr_' });

/** Total LLM calls made */
export const llmCallsTotal = new client.Counter({
  name: 'baldr_llm_calls_total',
  help: 'Total number of LLM API calls',
  labelNames: ['model', 'status'] as const,
});

/** LLM call duration in seconds */
export const llmCallDuration = new client.Histogram({
  name: 'baldr_llm_call_duration_seconds',
  help: 'Duration of LLM API calls in seconds',
  labelNames: ['model'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 180],
});

/** Total tokens consumed */
export const llmTokensTotal = new client.Counter({
  name: 'baldr_llm_tokens_total',
  help: 'Total tokens consumed by LLM calls',
  labelNames: ['model', 'type'] as const,
});

/** LLM cache hits */
export const llmCacheHits = new client.Counter({
  name: 'baldr_llm_cache_hits_total',
  help: 'Number of LLM cache hits (LRU or replay)',
  labelNames: ['source'] as const,
});

/** Audit requests */
export const auditRequestsTotal = new client.Counter({
  name: 'baldr_audit_requests_total',
  help: 'Total audit requests',
  // `apiKey` is the configured key id (or "anonymous"); bounded cardinality.
  labelNames: ['status', 'apiKey'] as const,
});

/** Audit duration */
export const auditDuration = new client.Histogram({
  name: 'baldr_audit_duration_seconds',
  help: 'Duration of full audit requests in seconds',
  buckets: [5, 10, 30, 60, 120, 300, 600],
});

/** Active audits gauge */
export const activeAudits = new client.Gauge({
  name: 'baldr_active_audits',
  help: 'Number of currently running audits',
});

/**
 * Returns all metrics in Prometheus text format.
 */
export async function getMetrics(): Promise<string> {
  return client.register.metrics();
}

/**
 * Returns the content type for the metrics response.
 */
export function getMetricsContentType(): string {
  return client.register.contentType;
}
