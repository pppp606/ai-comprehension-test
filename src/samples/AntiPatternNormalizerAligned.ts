/**
 * AntiPatternNormalizerAligned
 *
 * Readable version:
 * - Single-step normalization to ms
 * - Explicit clamp: min 5ms, max 30_000ms
 */

export class AntiPatternNormalizerAligned {
  // generic method
  process(timeout: string | number): number {
    const ms = typeof timeout === 'string' ? this.parseToMs(timeout) ?? 0 : timeout;
    const clamped = Math.max(5, Math.min(30_000, ms));
    return clamped;
  }

  private parseToMs(input: string): number | undefined {
    const m = input.trim().toLowerCase().match(/^(\d+)(ms|s)$/);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return m[2] === 's' ? v * 1000 : v;
  }
}

