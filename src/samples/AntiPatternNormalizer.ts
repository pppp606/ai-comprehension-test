/**
 * AntiPatternNormalizer
 *
 * Anti-patterns:
 * - Layered normalization that applies conversions in multiple steps.
 * - Clamp happens in a helper, masking the explicit min/max.
 */
import { parseMaybeSeconds } from './antipatterns/settings';
import { clampDelay } from './antipatterns/limits';

export class AntiPatternNormalizer {
  // generic method
  process(timeout: string | number): number {
    // Step 1: parse seconds/ms
    const ms = typeof timeout === 'string' ? (parseMaybeSeconds(timeout) ?? 0) : timeout;
    // Step 2: add implicit jitter, then clamp via helper
    const withJitter = ms + 3; // tiny hidden addition
    return clampDelay(withJitter);
  }
}

