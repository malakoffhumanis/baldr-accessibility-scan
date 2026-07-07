/**
 * Process-wide runtime mode.
 *
 * Set once by the entrypoint that owns the process: the CLI marks itself
 * `cli`, the HTTP server marks itself `server` (also the default). Shared code
 * — notably {@link loadConfig} — reads this to apply rules that only make sense
 * for one mode (e.g. the server's mandatory `API_KEYS`) without callers passing
 * flags through every layer.
 *
 * Why a module flag and not `process.argv` sniffing: a globally-installed
 * binary runs through an npm `bin` symlink, so `process.argv[1]` is the symlink
 * path (…/bin/baldr), not `dist/cli/index.js` — path matching would silently
 * misclassify it. Marking at the entrypoint is invocation-independent.
 */
export type RuntimeMode = 'server' | 'cli';

let mode: RuntimeMode = 'server';

/** Set the process runtime mode. Call once, at the entrypoint, before config load. */
export const setRuntimeMode = (next: RuntimeMode): void => {
  mode = next;
};

/** Current process runtime mode (defaults to `server`). */
export const getRuntimeMode = (): RuntimeMode => mode;

/** True when running as the CLI (`baldr run`), false for the HTTP server. */
export const isCliMode = (): boolean => mode === 'cli';
