/**
 * featureFlags.ts
 * Anti-patterns:
 * - String-based flags ('on'/'off') mapped to booleans inconsistently.
 * - Fallbacks depend on process.env, introducing hidden defaults.
 */

export type OnOff = 'on' | 'off';

export function flagToBool(flag?: OnOff | boolean): boolean | undefined {
  if (typeof flag === 'boolean') return flag;
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  return undefined;
}

export function defaultRetries(): number {
  // Hidden default: RETRIES env overrides, else 2 (not documented in modules that import this).
  const raw = process.env.RETRIES;
  if (raw && /^\d+$/.test(raw)) return Math.max(0, parseInt(raw, 10));
  return 2;
}

