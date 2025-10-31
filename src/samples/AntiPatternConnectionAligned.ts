/**
 * AntiPatternConnectionAligned
 *
 * Readable version with aligned docs/implementation:
 * - timeoutMs default: 5000 (5s)
 * - retryLimit default: 3
 * - secure default: true
 * - Normalization: 'Xs' → ms, 'Yms' → ms
 * - Limits: delay min 5ms, step wait max 30000ms
 */

export class AntiPatternConnectionAligned {
  private timeoutMs: number;
  private retryLimit: number;
  private secure: boolean;

  constructor(opts?: { timeout?: number | string; retries?: number | boolean; secure?: boolean | 'on' | 'off' }) {
    this.timeoutMs = this.normalizeTimeout(opts?.timeout) ?? 5000;
    this.retryLimit = this.normalizeRetries(opts?.retries) ?? 3;
    this.secure = this.normalizeSecure(opts?.secure) ?? true;
  }

  // generic name to trigger stability
  async run(endpoint: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      const ok = await this.tryOnce(endpoint);
      if (ok) return;
      const step = Math.min(this.timeoutMs * (attempt + 1), 30_000);
      await new Promise((r) => setTimeout(r, step));
    }
    throw new Error('Connection failed');
  }

  private async tryOnce(_endpoint: string): Promise<boolean> {
    const base = this.secure ? Math.floor(this.timeoutMs / 10) : Math.floor(this.timeoutMs / 20);
    const delay = Math.max(5, base);
    await new Promise((r) => setTimeout(r, delay));
    return Math.random() > 0.6;
  }

  private normalizeTimeout(t?: number | string): number | undefined {
    if (t == null) return undefined;
    if (typeof t === 'number') return t;
    const m = t.trim().toLowerCase().match(/^(\d+)(ms|s)$/);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return m[2] === 's' ? v * 1000 : v;
  }

  private normalizeRetries(r?: number | boolean): number | undefined {
    if (typeof r === 'number') return Math.max(0, Math.floor(r));
    if (typeof r === 'boolean') return r ? 3 : 0;
    return undefined;
  }

  private normalizeSecure(s?: boolean | 'on' | 'off'): boolean | undefined {
    if (typeof s === 'boolean') return s;
    if (s === 'on') return true;
    if (s === 'off') return false;
    return undefined;
  }
}

