/**
 * settings.ts
 * Centralized (but environment-dependent) defaults.
 * Anti-patterns:
 * - Defaults depend on environment variables and are not literal constants.
 * - Units are mixed (seconds vs milliseconds) and converted in different places.
 */

export const DEFAULT_TIMEOUT_MS: number = (() => {
  // Dev environment uses tiny timeout, otherwise 5s. Not obvious to a reader of downstream modules.
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'development' ? 200 : 5000;
})();

export function parseMaybeSeconds(input?: string | number): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') return input;
  const m = input.trim().toLowerCase().match(/^(\d+)(ms|s)$/);
  if (!m) return undefined;
  const v = parseInt(m[1], 10);
  return m[2] === 's' ? v * 1000 : v;
}

