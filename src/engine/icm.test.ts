import { it, expect } from 'vitest';
import { icmEquity, solveIcmPushFold } from './icm';
import { rangePercent } from './range';
it('icm basics', () => {
  const e = icmEquity([50, 30, 20], [50, 30, 20]);
  expect(e.reduce((s, x) => s + x, 0)).toBeCloseTo(100);
  expect(e[0]).toBeGreaterThan(e[1]);
  expect(e[0]).toBeLessThan(50); // ICM compresses chip lead
  const eq = icmEquity([10, 10], [1]);
  expect(eq[0]).toBeCloseTo(0.5);
});
it('icm push/fold is tighter than chip ev', () => {
  const base = { stacks: [10, 10, 30, 30], payouts: [50, 30, 20], sb: 0, bb: 1, ante: 0 };
  const chips = solveIcmPushFold({ ...base, mode: 'chips' });
  const icm = solveIcmPushFold({ ...base, mode: 'icm' });
  console.log('chips push', rangePercent(chips.push).toFixed(1), 'call', rangePercent(chips.call).toFixed(1), 'icm push', rangePercent(icm.push).toFixed(1), 'call', rangePercent(icm.call).toFixed(1));
  expect(rangePercent(icm.call)).toBeLessThan(rangePercent(chips.call));
});
