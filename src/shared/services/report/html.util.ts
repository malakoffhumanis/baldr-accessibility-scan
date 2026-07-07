import { getAccessibilityLevel } from './accessibility-score.util.js';

/**
 * CSS class carrying a score's level colour (`--level-color`).
 *
 * This is a PRESENTATION concern, kept in the HTML layer rather than in the
 * scoring util: it lets the markup stay free of inline `style` attributes
 * (RGAA 10.x) by attaching a `.lvl-*` class instead. The class name mirrors the
 * level label from {@link getAccessibilityLevel} (Excellent → `lvl-excellent`,
 * Bon → `lvl-bon`, …), so the score thresholds stay defined in a single place.
 */
export function levelClass(score: number): string {
  return `lvl-${getAccessibilityLevel(score).label.toLowerCase()}`;
}

/**
 * Escapes special HTML characters to prevent injection.
 * Returns an empty string for `null` or `undefined`.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates a stable DOM identifier for a page from its URL or name.
 * Format: `page-<slug-kebab-ascii>`. Used as an HTML anchor in reports.
 */
export function generatePageId(url: string, name?: string): string {
  const baseId = name ?? url;
  return `page-${baseId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}`;
}
