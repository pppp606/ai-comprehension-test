/**
 * Inner implementation with hidden overrides.
 */
export interface ImplOptions {
  maxConcurrent?: number | string; // can be 'auto'
}

export class InnerImpl {
  private maxConcurrent: number;
  constructor(opts?: ImplOptions) {
    // Hidden rule: 'auto' -> 4, undefined -> 1
    const raw = opts?.maxConcurrent;
    if (raw === 'auto') this.maxConcurrent = 4;
    else if (typeof raw === 'number') this.maxConcurrent = Math.max(1, Math.floor(raw));
    else this.maxConcurrent = 1;
  }
  getMax(): number { return this.maxConcurrent; }
}

