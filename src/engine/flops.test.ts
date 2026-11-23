import { it, expect } from 'vitest';
import { allFlops, flopSubset } from './flops';
it('1755 distinct flops', () => {
  const f = allFlops();
  expect(f.length).toBe(1755);
  expect(f.reduce((s, x) => s + x.weight, 0)).toBe(22100);
  const s = flopSubset(25);
  expect(s.length).toBeGreaterThan(20);
  expect(s.reduce((a, x) => a + x.weight, 0)).toBe(22100);
});
