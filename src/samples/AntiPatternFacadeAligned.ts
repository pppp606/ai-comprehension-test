/**
 * AntiPatternFacadeAligned
 *
 * Readable version with single source of truth:
 * - 'auto' maps to 4 consistently.
 * - Options are normalized before constructing Inner.
 * - No post-construction mutation of options.
 */

interface ImplOptionsAligned {
  maxConcurrent?: number | 'auto';
}

class InnerImplAligned {
  private maxConcurrent: number;
  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }
  getMax(): number { return this.maxConcurrent; }
}

export class AntiPatternFacadeAligned {
  private impl: InnerImplAligned;
  private normalizedMax: number;

  constructor(opts?: ImplOptionsAligned) {
    this.normalizedMax = this.normalizeMax(opts?.maxConcurrent) ?? 1;
    this.impl = new InnerImplAligned(this.normalizedMax);
  }

  // generic method name
  execute(): number {
    // Single source of truth; facade and inner agree
    return this.impl.getMax();
  }

  private normalizeMax(v?: number | 'auto'): number | undefined {
    if (v === 'auto') return 4;
    if (typeof v === 'number') return Math.max(1, Math.floor(v));
    return undefined;
  }
}

