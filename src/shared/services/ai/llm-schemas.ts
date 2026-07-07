/**
 * JSON Schema definitions for structured output (OpenAI json_schema mode).
 * These schemas enforce strict response formats from the LLM, eliminating
 * most JSON parsing errors.
 */

/**
 * Schema for the action planner LLM response.
 * Describes a single browser action to execute.
 */
export const ACTION_NAVIGATION_SCHEMA = {
  name: 'action_navigation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'click',
          'type',
          'select',
          'scroll',
          'navigate',
          'wait',
          'auth',
          'scan',
          'cookies',
          'hover',
          'press',
          'check',
          'uncheck',
        ],
        description: 'The type of browser action to perform',
      },
      selector: {
        type: 'string',
        description:
          'CSS selector targeting the element. Must match exactly one element.',
      },
      value: {
        type: ['string', 'null'],
        description:
          'Value for type/select actions, URL for navigate, key for press',
      },
    },
    required: ['type', 'selector', 'value'],
    additionalProperties: false,
  },
} as const;

/**
 * Schema for the replan LLM response.
 * Returns a corrected action after a failed attempt.
 */
export const REPLAN_ACTION_SCHEMA = {
  name: 'replan_action',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'click',
          'type',
          'select',
          'scroll',
          'navigate',
          'wait',
          'hover',
          'press',
          'check',
          'uncheck',
        ],
        description: 'The corrected action type',
      },
      selector: {
        type: 'string',
        description: 'Corrected CSS selector',
      },
      value: {
        type: ['string', 'null'],
        description: 'Corrected value if applicable',
      },
    },
    required: ['type', 'selector', 'value'],
    additionalProperties: false,
  },
} as const;

/**
 * Schema for a single rule analysis in the AI analyzer batch response.
 * Note: OpenAI json_schema requires all fields to be required with explicit
 * nullable types for optional fields.
 */
export const RULE_ANALYSIS_SCHEMA = {
  name: 'rule_analyses_batch',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      analyses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ruleId: { type: 'string', description: 'RGAA rule identifier' },
            compliant: {
              type: 'boolean',
              description: 'Whether the page is compliant with this rule',
            },
            severity: {
              type: 'string',
              enum: ['critical', 'major', 'minor', 'info'],
            },
            summary: {
              type: 'string',
              description: 'Brief summary of the analysis result',
            },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  element: { type: 'string' },
                  issue: { type: 'string' },
                  recommendation: { type: 'string' },
                },
                required: ['element', 'issue', 'recommendation'],
                additionalProperties: false,
              },
              description: 'Detailed findings for non-compliant rules',
            },
          },
          required: ['ruleId', 'compliant', 'severity', 'summary', 'findings'],
          additionalProperties: false,
        },
      },
    },
    required: ['analyses'],
    additionalProperties: false,
  },
} as const;
