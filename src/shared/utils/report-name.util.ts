/**
 * Builds a filesystem- and HTTP-header-safe slug from a user-provided audit
 * name (the `name` field of the journey request body).
 *
 * The `name` field is free-form user input, so it MUST be sanitized before it
 * can touch a filename or a `Content-Disposition` header. This slug keeps only
 * `[a-z0-9-]`, which removes every path-traversal (`/`, `\`, `..`, NUL) and
 * header-injection (`"`, CR, LF) vector by construction.
 *
 * - diacritics are stripped for clean ASCII filenames;
 * - any run of non-alphanumeric characters collapses to a single hyphen;
 * - leading/trailing hyphens are trimmed and the length is capped;
 * - when the input is absent or sanitizes to an empty string, `fallback`
 *   is returned so the caller always gets a safe, non-empty base name.
 *
 * @param name - Raw, untrusted audit name (may be undefined).
 * @param fallback - Safe default base used when `name` is missing/empty.
 * @returns A slug safe to embed in a filename and a header.
 */
export function slugifyReportName(
  name: string | undefined,
  fallback: string,
): string {
  if (name == null) return fallback;
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any non-alphanumeric run -> single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 60) // cap length
    .replace(/-+$/g, ''); // re-trim if the slice cut mid-hyphen
  return slug === '' ? fallback : slug;
}
