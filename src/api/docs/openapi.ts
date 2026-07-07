/**
 * OpenAPI 3.0 specification generated from Zod schemas.
 *
 * Uses @asteasolutions/zod-to-openapi to derive request/response schemas
 * from the same Zod objects used for runtime validation.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Patches Zod with `.openapi()` (must be imported before the schemas are used)
import '@shared/validation/zod-openapi.setup.js';
import { journeyRequestSchema } from '@shared/validation/schemas.js';

// ─── Registry ────────────────────────────────────────────────────────────────
const registry = new OpenAPIRegistry();

// ─── Error schemas ─────────────────────────────────────────────────────────
const errorDetailSchema = z
  .object({
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    message: z.string().openapi({ example: 'A URL is required' }),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('ErrorDetail');

const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: errorDetailSchema,
    durationMs: z.number().optional(),
  })
  .openapi('ErrorResponse');

// ─── Health schemas (match HealthController.check) ──────────────────────────
const healthResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.string().openapi({ example: 'healthy' }),
      uptime: z
        .number()
        .openapi({ description: 'Process uptime in seconds', example: 123.45 }),
    }),
    metadata: z.object({
      timestamp: z.iso.datetime(),
      version: z.string().openapi({ example: '1.0.0' }),
    }),
  })
  .openapi('HealthResponse');

// ─── Diagnostic schema (match HealthController.diagnostic) ──────────────────
const diagnosticResponseSchema = z
  .object({
    service: z.string().openapi({ example: 'baldr-api' }),
    status: z.enum(['healthy', 'degraded']).openapi({
      description:
        '"degraded" when the LLM Provider is unreachable/misconfigured',
    }),
    timestamp: z.iso.datetime(),
    version: z.string().openapi({ example: '1.0.0' }),
    environment: z.string().openapi({ example: 'production' }),
    uptime: z
      .number()
      .openapi({ description: 'Process uptime in seconds', example: 123.45 }),
    checks: z.object({}).loose().openapi({
      description:
        'Per-check results (LLM Provider configuration, proxy, connectivity, general configuration).',
    }),
  })
  .openapi('DiagnosticResponse');

// ─── Register reusable components ────────────────────────────────────────────
registry.register(
  'JourneyRequest',
  journeyRequestSchema.openapi('JourneyRequest'),
);
registry.register('ErrorResponse', errorResponseSchema);
registry.register('HealthResponse', healthResponseSchema);
registry.register('DiagnosticResponse', diagnosticResponseSchema);

// API-key security scheme (enforced only when the server has API_KEYS set).
const apiKeyAuthScheme = registry.registerComponent(
  'securitySchemes',
  'ApiKeyAuth',
  {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'API key authentication. Required only when the server is configured ' +
      'with API_KEYS; otherwise the endpoint is open. Send one of the ' +
      'configured keys in the X-API-Key header.',
  },
);

// ─── POST /api/v1/journey ────────────────────────────────────────────────────
registry.registerPath({
  method: 'post',
  path: '/api/v1/journey',
  summary: 'Run a multi-page accessibility journey',
  description:
    'Runs a sequence of pages, each with typed actions (scan, acceptCookies, ' +
    'wait, click, hover, fill, select) plus an `ai` escape hatch for free-form ' +
    'navigation. A page without actions defaults to a single scan. Returns the ' +
    'generated report in the requested format (`options.reportFormat`: html, ' +
    'json or csv).',
  tags: ['Journey'],
  security: [{ [apiKeyAuthScheme.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: journeyRequestSchema.openapi('JourneyRequest'),
          examples: {
            publicPage: {
              summary: "Audit simple d'une page publique",
              description:
                'Une page sans `actions` est auditée par défaut (chargement + scan).',
              value: {
                name: "Audit page d'accueil",
                options: { analysisType: 'static', reportFormat: 'json' },
                pages: [{ url: 'https://www.wikipedia.org' }],
              },
            },
            typedActions: {
              summary: 'Parcours avec actions typées et trappe IA',
              value: {
                name: 'Parcours formulaire de contact',
                options: { analysisType: 'full', reportFormat: 'html' },
                pages: [
                  {
                    url: 'https://en.wikipedia.org/wiki/Wikipedia:Contact_us',
                    actions: [
                      { type: 'acceptCookies' },
                      {
                        type: 'fill',
                        target: 'le champ email',
                        value: 'user@example.com',
                      },
                      { type: 'click', target: 'le bouton Envoyer' },
                      { type: 'wait', ms: 1500 },
                      {
                        type: 'ai',
                        instruction: 'ouvrir le sous-menu Fondation',
                      },
                      { type: 'scan' },
                    ],
                  },
                ],
              },
            },
            authenticatedMultiPage: {
              summary: 'Parcours authentifié multi-pages',
              description:
                "L'`auth` racine (identifiant + mot de passe) s'applique par défaut à toutes les pages.",
              value: {
                name: 'Audit pages protégées',
                options: { analysisType: 'full', reportFormat: 'html' },
                auth: {
                  username: 'jdoe',
                  password: 'secret',
                  loginUrl: 'https://en.wikipedia.org/wiki/Special:UserLogin',
                },
                pages: [
                  { url: 'https://en.wikipedia.org/wiki/Special:Watchlist' },
                  { url: 'https://en.wikipedia.org/wiki/Special:Preferences' },
                ],
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description:
        'Generated journey report (HTML, JSON or CSV depending on `reportFormat`).',
      content: {
        'text/html': {
          schema: z
            .string()
            .openapi({ description: 'Interactive HTML report' }),
        },
        'application/json': {
          schema: z
            .object({})
            .loose()
            .openapi({ description: 'Structured JSON report' }),
        },
        'text/csv': {
          schema: z.string().openapi({ description: 'CSV export' }),
        },
      },
    },
    400: {
      description: 'Request validation error',
      content: {
        'application/json': { schema: errorResponseSchema },
      },
    },
    401: {
      description: 'Missing or invalid API key (when API_KEYS is configured)',
      content: {
        'application/json': { schema: errorResponseSchema },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': { schema: errorResponseSchema },
      },
    },
  },
});

// ─── GET /api/v1/health ──────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Liveness health check',
  description:
    'Returns a healthy status and process uptime if the server is up.',
  tags: ['Infrastructure'],
  responses: {
    200: {
      description: 'Server operational',
      content: {
        'application/json': { schema: healthResponseSchema },
      },
    },
  },
});

// ─── GET /api/v1/health/diagnostic ───────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/v1/health/diagnostic',
  summary: 'Full readiness diagnostic',
  description:
    'Runs deep checks including a real connectivity test against the LLM ' +
    'LLM Provider. Responds 200 when healthy, 503 when degraded.',
  tags: ['Infrastructure'],
  responses: {
    200: {
      description: 'All checks healthy',
      content: {
        'application/json': { schema: diagnosticResponseSchema },
      },
    },
    503: {
      description: 'Service degraded (a dependency check failed)',
      content: {
        'application/json': { schema: diagnosticResponseSchema },
      },
    },
  },
});

// ─── GET /metrics ────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/metrics',
  summary: 'Prometheus metrics',
  description:
    'Prometheus exposition-format metrics. Served at the root path, outside ' +
    '`/api/v1` and not rate-limited.',
  tags: ['Infrastructure'],
  responses: {
    200: {
      description: 'Metrics in Prometheus text exposition format',
      content: {
        'text/plain': {
          schema: z.string().openapi({ description: 'Prometheus metrics' }),
        },
      },
    },
  },
});

// ─── Generate document ───────────────────────────────────────────────────────
const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'BALDR API — Accessibility audit',
    version: '1.0.0',
    description:
      'Automated web accessibility audit API using Axe-Core and AI (LLM Provider). ' +
      'Supports static audits, AI analysis, and multi-page navigation journeys.',
    contact: {
      name: 'BALDR Team',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local development',
    },
  ],
  tags: [
    {
      name: 'Journey',
      description: 'Multi-block accessibility journey endpoints',
    },
    {
      name: 'Infrastructure',
      description: 'Health checks, diagnostics and metrics',
    },
  ],
});
