import type { IAxeResult } from '@shared/types/audit.types.js';

const CSV_HEADER: readonly string[] = [
  'URL',
  'Violation ID',
  'Impact',
  'Titre',
  'Description',
  'Sélecteur',
  'HTML',
  'Help URL',
  'Tags',
];

/**
 * Formats an audit result as CSV. One line per violation × node:
 * a violation impacting 3 DOM elements produces 3 lines. Cells are
 * always wrapped in double quotes and inner double quotes are doubled
 * (RFC 4180).
 */
export function formatAsCSV(result: IAxeResult): string {
  const csvRows: (string | null)[][] = [[...CSV_HEADER]];

  result.violations.forEach((violation) => {
    violation.nodes.forEach((node) => {
      const targetStr = Array.isArray(node.target)
        ? node.target.join(', ')
        : node.target;

      csvRows.push([
        result.url,
        violation.id,
        violation.impact,
        violation.help,
        violation.description,
        targetStr,
        node.html,
        violation.helpUrl,
        violation.tags.join(', '),
      ]);
    });
  });

  return csvRows
    .map((row) =>
      row.map((cell) => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
}
