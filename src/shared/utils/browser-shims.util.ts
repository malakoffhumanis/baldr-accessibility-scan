import type { Page } from 'puppeteer';

/**
 * Injects a no-op `__name` shim into the browser page context.
 *
 * tsx (TypeScript Execute, dev mode) wraps serialised functions with
 * `__name(fn, "label")` which doesn't exist in the browser. Without
 * this shim, any `page.evaluate()` that contains a named function
 * throws a ReferenceError in the Puppeteer browser context.
 */
export async function shimTsxName(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as { __name?: <T>(fn: T, _label?: string) => T };
    if (typeof g.__name !== 'function') {
      g.__name = <T>(fn: T): T => fn;
    }
  });
}
