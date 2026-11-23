import { describe, it, expect } from 'vitest';
import { spot, actionTotals, presetSpots, POSITIONS } from './preflop';
import { formatRange, rangePercent } from './range';
import { rangeOf } from './preflop';

describe('preflop model', () => {
  it('rfi sizes are sane', () => {
    for (const p of POSITIONS.slice(0, 5)) {
      const s = spot(`rfi:${p}`);
      const t = actionTotals(s);
      console.log(p, (t[1] * 100).toFixed(1), formatRange(rangeOf(s, 1)).slice(0, 200));
      expect(t[1]).toBeGreaterThan(0.1);
    }
  });
  it('defense', () => {
    for (const k of ['vsopen:BB:BTN', 'vsopen:BTN:CO', 'vsopen:SB:BTN', 'vs3bet:BTN:BB', 'vs4bet:BB:BTN', 'vs5bet:BTN:BB']) {
      const s = spot(k);
      console.log(k, actionTotals(s).map((x) => (x * 100).toFixed(1)).join(' / '), s.actions.map((a) => a.label).join(','), rangePercent(s.reach).toFixed(1));
      console.log('   raise:', formatRange(rangeOf(s, s.actions.length - 1)).slice(0, 250));
    }
    const ps = presetSpots();
    console.log(ps.map((p) => `${p.name} pot=${p.pot} stack=${p.stack} oop=${p.oop} ${rangePercent(p.oopRange).toFixed(1)} ip=${p.ip} ${rangePercent(p.ipRange).toFixed(1)}`).join('\n'));
    expect(ps.length).toBe(6);
  });
});
