/**
 * AntiPatternFacade
 *
 * Anti-patterns:
 * - Facade method mutates options after constructing inner impl (order-dependent defaults).
 * - Mixed units (strings like 'auto') and implicit mapping in inner.
 */
import { InnerImpl, ImplOptions } from './antipatterns/impl/InnerImpl';

export class AntiPatternFacade {
  private impl: InnerImpl;
  private opts: ImplOptions;
  constructor(opts?: ImplOptions) {
    this.opts = { ...(opts || {}) };
    // Create with initial opts
    this.impl = new InnerImpl(this.opts);
    // Then mutate opts (order dependency makes defaults hard to track)
    if (this.opts.maxConcurrent == null) {
      this.opts.maxConcurrent = 'auto';
    }
  }

  // generic method name
  execute(): number {
    // The inner impl still holds the old value; facade reports a different interpretation
    const reported = this.opts.maxConcurrent === 'auto' ? 4 : typeof this.opts.maxConcurrent === 'number' ? this.opts.maxConcurrent : 1;
    // Discrepancy between inner and facade can confuse analyses
    return Math.max(reported, this.impl.getMax());
  }
}

