import { scoreStability } from '../stability-scorer';

const mrIdentical = JSON.stringify({
  primaryPurpose: 'Compute total price with tax',
  inputs: ['items', 'taxRate'],
  outputs: ['total'],
  sideEffects: ['none'],
  keyBehaviors: ['sum item prices', 'apply tax'],
  invariants: ['non-negative total'],
});

const mrVariantMinor = JSON.stringify({
  primaryPurpose: 'calculate total cost including tax',
  inputs: ['cartItems', 'taxRate'],
  outputs: ['grandTotal'],
  sideEffects: [],
  keyBehaviors: ['sum prices', 'apply tax percentage'],
  invariants: ['total >= 0'],
});

const mrConflicting = JSON.stringify({
  primaryPurpose: 'Parses CSV file into JSON',
  inputs: ['csvString'],
  outputs: ['records'],
  sideEffects: [],
  keyBehaviors: ['split lines', 'map fields'],
  invariants: ['well-formed rows'],
});

describe('stability-scorer', () => {
  it('scores identical responses as HIGH and ~100', () => {
    const res = scoreStability([mrIdentical, mrIdentical, mrIdentical]);
    expect(res.consistencyLevel).toBe('HIGH');
    expect(res.consistencyScore).toBeGreaterThanOrEqual(95);
    expect(res.codeClarity).toBe('CLEAR');
    expect(res.mainIdea.toLowerCase()).toContain('total');
  });

  it('scores mildly different responses as MEDIUM or HIGH', () => {
    const res = scoreStability([mrIdentical, mrVariantMinor, mrVariantMinor]);
    expect(['HIGH', 'MEDIUM']).toContain(res.consistencyLevel);
    expect(res.consistencyScore).toBeGreaterThanOrEqual(50);
    expect(res.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('scores conflicting responses as LOW', () => {
    const res = scoreStability([mrIdentical, mrConflicting, mrConflicting]);
    expect(res.consistencyLevel).toBe('LOW');
    expect(res.consistencyScore).toBeLessThan(50);
    expect(['AMBIGUOUS', 'MISLEADING']).toContain(res.codeClarity);
  });
});

