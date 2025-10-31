/**
 * limits.ts
 * Anti-patterns:
 * - Limits (min/max) defined by helpers, making direct literal discovery harder.
 */

export function clampDelay(ms: number): number {
  // Implicit min 5ms, max 30_000ms
  const min = 5;
  const max = 30_000;
  return Math.max(min, Math.min(max, ms));
}

