import { describe, it, expect, vi } from 'vitest';

import { shimTsxName } from './browser-shims.util.js';

/**
 * Page mock whose `evaluate` actually runs the injected callback in Node,
 * so the body of the shim is executed (and covered) rather than stubbed.
 */
function createExecutingPage() {
  return {
    evaluate: vi.fn(
      async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) =>
        typeof fn === 'function' ? await fn(...args) : undefined,
    ),
  };
}

describe('shimTsxName', () => {
  it('calls page.evaluate to inject the shim', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    };
    await shimTsxName(page as never);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(typeof page.evaluate.mock.calls[0][0]).toBe('function');
  });

  it('installs a no-op __name function on globalThis when absent', async () => {
    const g = globalThis as { __name?: <T>(fn: T, label?: string) => T };
    const saved = g.__name;
    delete g.__name;
    try {
      const page = createExecutingPage();
      await shimTsxName(page as never);

      expect(typeof g.__name).toBe('function');
      const original = (x: number) => x * 2;
      // The shim must return the function untouched, ignoring the label.
      const returned = g.__name!(original, 'label');
      expect(returned).toBe(original);
      expect(returned(21)).toBe(42);
    } finally {
      if (saved === undefined) delete g.__name;
      else g.__name = saved;
    }
  });

  it('does not overwrite an existing __name function', async () => {
    const g = globalThis as { __name?: <T>(fn: T) => T };
    const saved = g.__name;
    const existing = <T>(fn: T): T => fn;
    g.__name = existing;
    try {
      const page = createExecutingPage();
      await shimTsxName(page as never);
      // The branch `typeof g.__name !== 'function'` is false → no reassignment.
      expect(g.__name).toBe(existing);
    } finally {
      if (saved === undefined) delete g.__name;
      else g.__name = saved;
    }
  });
});
