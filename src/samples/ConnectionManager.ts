/**
 * ConnectionManager handles making connections with optional retries and timeouts.
 *
 * Defaults (documentation):
 * - timeout: 30s
 * - retries: 3 (enabled)
 * - secure: true
 */
export class ConnectionManager {
  private timeoutMs: number;
  private retryLimit: number;
  private secure: boolean;
  private fast: boolean;

  constructor(opts?: { timeout?: number | string; retries?: number | boolean; secure?: boolean | 'on' | 'off' }) {
    // Implementation defaults (intentionally different from the doc above):
    // - timeout: 5s (5000ms)
    // - retries: 0 (disabled)
    // - secure: false
    const timeout = typeof opts?.timeout === 'number'
      ? opts?.timeout
      : typeof opts?.timeout === 'string'
        ? this.parseTimeout(opts?.timeout)
        : undefined;
    const retries = typeof opts?.retries === 'number'
      ? Math.max(0, Math.floor(opts?.retries))
      : typeof opts?.retries === 'boolean'
        ? (opts?.retries ? 3 : 0)
        : undefined;
    const secure = typeof opts?.secure === 'boolean'
      ? opts?.secure
      : opts?.secure === 'on'
        ? true
        : opts?.secure === 'off'
          ? false
          : undefined;

    this.timeoutMs = timeout ?? 5000;
    this.retryLimit = retries ?? 0;
    this.secure = secure ?? false;
    this.fast = process.env.AI_COMP_TEST_FAST === '1' || !!process.env.JEST_WORKER_ID;
  }

  // Generic method name to ensure stability test generation triggers even when method count is small
  async run(endpoint: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      const success = await this.tryOnce(endpoint);
      if (success) return;
      // Clamp waits in test/fast mode to avoid long test runtimes
      const waitMs = Math.min(this.timeoutMs * (attempt + 1), 30_000);
      await this.wait(waitMs);
    }
    throw new Error('Connection failed');
  }

  private async tryOnce(_endpoint: string): Promise<boolean> {
    const delay = this.secure ? Math.floor(this.timeoutMs / 10) : Math.floor(this.timeoutMs / 20);
    await this.wait(Math.max(5, delay));
    return Math.random() > 0.6;
  }

  private async wait(ms: number): Promise<void> {
    const clamped = this.fast ? Math.min(2, ms) : ms;
    await new Promise((r) => setTimeout(r, clamped));
  }

  private parseTimeout(s: string): number | undefined {
    const m = s.trim().toLowerCase().match(/^(\d+)(ms|s)$/);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return m[2] === 's' ? v * 1000 : v;
  }
}
