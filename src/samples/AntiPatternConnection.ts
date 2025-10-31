/**
 * AntiPatternConnection
 *
 * Docs (misleading on purpose):
 * - timeout: 10s
 * - retries: 3
 * - secure: true
 *
 * Reality (scattered across imports):
 * - timeout: from settings.DEFAULT_TIMEOUT_MS (dev: 200ms, else 5000ms)
 * - retries: from featureFlags.defaultRetries() (env RETRIES or 2)
 * - secure: derived from flagToBool(opts.secure) with fallback false
 */
import { DEFAULT_TIMEOUT_MS, parseMaybeSeconds } from './antipatterns/settings';
import { clampDelay } from './antipatterns/limits';
import { flagToBool, defaultRetries, OnOff } from './antipatterns/featureFlags';

export class AntiPatternConnection {
  private timeoutMs: number;
  private retryLimit: number;
  private secure: boolean;

  constructor(opts?: { timeout?: number | string; retries?: number | boolean; secure?: boolean | OnOff }) {
    const t = typeof opts?.timeout === 'string' ? parseMaybeSeconds(opts?.timeout) : opts?.timeout;
    const r = typeof opts?.retries === 'boolean' || typeof opts?.retries === 'number'
      ? (typeof opts?.retries === 'number' ? Math.max(0, Math.floor(opts!.retries as number)) : (opts!.retries ? 3 : 0))
      : defaultRetries();
    const s = flagToBool(opts?.secure);

    this.timeoutMs = t ?? DEFAULT_TIMEOUT_MS;
    this.retryLimit = r;
    this.secure = s ?? false;
  }

  // intentionally generic method name to trigger stability generation
  async run(endpoint: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      const ok = await this.tryOnce(endpoint);
      if (ok) return;
      const step = clampDelay(this.timeoutMs * (attempt + 1));
      await new Promise((r) => setTimeout(r, step));
    }
    throw new Error('Connection failed');
  }

  private async tryOnce(_endpoint: string): Promise<boolean> {
    const base = this.secure ? Math.floor(this.timeoutMs / 10) : Math.floor(this.timeoutMs / 20);
    const delay = clampDelay(base);
    await new Promise((r) => setTimeout(r, delay));
    return Math.random() > 0.6;
  }
}

