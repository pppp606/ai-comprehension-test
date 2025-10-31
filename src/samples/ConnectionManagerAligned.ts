/**
 * ConnectionManagerAligned handles making connections with optional retries and timeouts.
 *
 * Defaults (documentation & implementation are aligned):
 * - timeout: 30s
 * - retries: 3 (enabled)
 * - secure: true
 */
export class ConnectionManagerAligned {
  private timeoutMs: number;
  private retryLimit: number;
  private secure: boolean;

  constructor(opts?: { timeout?: number | string; retries?: number | boolean; secure?: boolean | 'on' | 'off' }) {
    // Implementation defaults (aligned with docs):
    // - timeout: 30s (30000ms)
    // - retries: 3 (enabled)
    // - secure: true
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

    this.timeoutMs = timeout ?? 30_000;
    this.retryLimit = retries ?? 3;
    this.secure = secure ?? true;
  }

  // Generic method name to ensure stability test generation triggers
  async run(endpoint: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      const success = await this.tryOnce(endpoint);
      if (success) return;
      await new Promise((r) => setTimeout(r, Math.min(this.timeoutMs * (attempt + 1), 30_000)));
    }
    throw new Error('Connection failed');
  }

  private async tryOnce(_endpoint: string): Promise<boolean> {
    const delay = this.secure ? Math.floor(this.timeoutMs / 10) : Math.floor(this.timeoutMs / 20);
    await new Promise((r) => setTimeout(r, Math.max(5, delay)));
    return Math.random() > 0.6;
  }

  private parseTimeout(s: string): number | undefined {
    const m = s.trim().toLowerCase().match(/^(\d+)(ms|s)$/);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return m[2] === 's' ? v * 1000 : v;
  }
}

