import { DEFAULT_LLM_MODEL } from '@shared/config/llm-defaults.js';
import type { IAIAnalysisError } from '@shared/types/audit.types.js';

/**
 * AI error classification service for detailed diagnostics.
 * Reused by the audit and journey orchestrators.
 */
export class AIErrorClassifierService {
  /**
   * Categorizes an AI error into a type, details and actionable suggestions.
   */
  classify(errorMessage: string): IAIAnalysisError {
    const msg = errorMessage.toLowerCase();
    const { type, details, suggestions } = this.categorize(msg, errorMessage);

    return {
      message: errorMessage,
      type,
      details,
      suggestions,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Returns a standard configuration error (no API key / endpoint).
   */
  buildConfigurationError(): IAIAnalysisError {
    return {
      message: 'AI service unavailable (LLM Provider variables missing)',
      type: 'CONFIGURATION',
      details:
        'LLM Provider not configured. Check LLM_PROVIDER_API_KEY and LLM_PROVIDER_ENDPOINT.',
      suggestions: [
        'Ensure LLM_PROVIDER_API_KEY is injected (Vault/secrets)',
        'Ensure LLM_PROVIDER_ENDPOINT is injected',
        'Use GET /api/v1/health to diagnose the configuration',
      ],
      timestamp: new Date().toISOString(),
    };
  }

  private categorize(
    msg: string,
    original: string,
  ): {
    type: IAIAnalysisError['type'];
    details: string;
    suggestions: string[];
  } {
    // Matchers accept both English and French keywords so that errors thrown
    // anywhere in the stack (including legacy French messages) are classified.
    if (
      msg.includes('non configuré') ||
      msg.includes('manquant') ||
      msg.includes('not configured')
    ) {
      return {
        type: 'CONFIGURATION',
        details: `LLM Provider environment variables missing or invalid. Message: ${original}`,
        suggestions: [
          'Ensure LLM_PROVIDER_API_KEY is injected (Vault/secrets)',
          'Ensure LLM_PROVIDER_ENDPOINT is injected',
          'Ensure LLM_PROVIDER_MODEL is correct (optional)',
          'Use GET /api/v1/health to validate the configuration',
        ],
      };
    }

    if (
      msg.includes('enotfound') ||
      msg.includes('econnrefused') ||
      msg.includes('network') ||
      msg.includes('getaddrinfo')
    ) {
      return {
        type: 'CONNECTIVITY',
        details: `Cannot reach the LLM Provider from the deployment environment. Message: ${original}`,
        suggestions: [
          'Configure HTTPS_PROXY if you are behind a corporate proxy',
          'Ensure outbound network access to the LLM Provider endpoint is open',
          'Check DNS resolution of the LLM Provider endpoint',
          'Contact the network team to open the flow if needed',
        ],
      };
    }

    if (msg.includes('proxy') || msg.includes('tunneling socket')) {
      return {
        type: 'PROXY',
        details: `Proxy error while calling the LLM Provider. Message: ${original}`,
        suggestions: [
          'Check the HTTPS_PROXY value (format: http://proxy:port)',
          'Ensure the proxy allows connections to the LLM Provider endpoint',
          'Test connectivity: curl -x $HTTPS_PROXY $LLM_PROVIDER_ENDPOINT',
        ],
      };
    }

    if (
      msg.includes('401') ||
      msg.includes('authentification') ||
      msg.includes('unauthorized') ||
      msg.includes('api key')
    ) {
      return {
        type: 'AUTHENTICATION',
        details: `Invalid or expired LLM Provider API key. Message: ${original}`,
        suggestions: [
          'Check the LLM_PROVIDER_API_KEY API key',
          'Ensure the injected key matches the configured endpoint',
          'Contact the platform team to validate access',
        ],
      };
    }

    if (
      msg.includes('timeout') ||
      msg.includes('econnaborted') ||
      msg.includes('aborted')
    ) {
      return {
        type: 'TIMEOUT',
        details: `The LLM Provider call timed out. Message: ${original}`,
        suggestions: [
          'The network may be too slow, or a proxy is blocking long connections',
          'Increase the timeout in the configuration',
          'Check the availability of the LLM Provider service',
        ],
      };
    }

    if (
      msg.includes('404') ||
      msg.includes('introuvable') ||
      msg.includes('not found')
    ) {
      return {
        type: 'DEPLOYMENT',
        details: `The specified LLM model was not found on the LLM Provider. Message: ${original}`,
        suggestions: [
          `Check LLM_PROVIDER_MODEL (optional, default: ${DEFAULT_LLM_MODEL})`,
          'Ensure the model is available on the LiteLLM provider',
          'The model name is case-sensitive',
        ],
      };
    }

    if (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('quota')
    ) {
      return {
        type: 'RATE_LIMIT',
        details: `Azure OpenAI request limit reached. Message: ${original}`,
        suggestions: [
          'Wait a few minutes and retry',
          'Increase the quota in the Azure portal',
          'Reduce the number of RGAA rules analyzed simultaneously',
        ],
      };
    }

    return {
      type: 'UNKNOWN',
      details: `Unexpected error during AI analysis. Message: ${original}`,
      suggestions: [
        'Check the server logs for more details',
        'Use GET /api/v1/health to diagnose',
        'Check the full LLM Provider configuration',
      ],
    };
  }
}
