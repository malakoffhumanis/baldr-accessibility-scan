/**
 * Validates a URL
 * @param url - URL to validate
 * @returns true if the URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObject = new URL(url);
    return urlObject.protocol === 'http:' || urlObject.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes a URL
 * @param url - URL to normalize
 * @returns Normalized URL
 * @throws Error if the URL is invalid
 */
export function validateAndNormalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    throw new Error(
      `Invalid URL: ${trimmedUrl}. URL must start with http:// or https://`,
    );
  }

  return trimmedUrl;
}

/**
 * Extracts the domain from a URL
 * @param url - Source URL
 * @returns Domain name
 */
export function extractDomain(url: string): string {
  try {
    const urlObject = new URL(url);
    return urlObject.hostname;
  } catch {
    return '';
  }
}
