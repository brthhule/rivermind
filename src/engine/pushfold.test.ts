import { it, expect } from 'vitest';
import { solvePushFold } from './pushfold';
import { rangePercent, formatRange } from './range';
it('push/fold 10bb', () => {
  const r = solvePushFold(10);
  const pp = rangePercent(r.push), cp = rangePercent(r.call);
  console.log('push', pp.toFixed(1), 'call', cp.toFixed(1), 'ev', r.sbEv.toFixed(3), formatRange(r.call));
  expect(pp).toBeGreaterThan(45); expect(pp).toBeLessThan(70);
  expect(cp).toBeGreaterThan(28); expect(cp).toBeLessThan(45);
});
