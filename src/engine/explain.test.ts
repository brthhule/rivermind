import { describe, expect, it } from 'vitest';
import { Solver } from '../solver/solver';
import { parseCards } from './cards';
import { presetSpots } from './preflop';
import { explainDecision } from './explain';

describe('decision explanations', () => {
  it('builds reasons from solver data on a river spot', () => {
    const ps = presetSpots()[0];
    const s1 = (bet: number[], raise: number[]) => ({ bet, raise });
    const sizes = { flop: [s1([0.5], [1]), s1([0.5], [1])], turn: [s1([0.5], [1]), s1([0.5], [1])], river: [s1([0.33, 0.75], [1]), s1([0.33, 0.75], [1])] };
    const s = new Solver({ board: parseCards('Ks7d2c9h4s'), pot: ps.pot, stack: ps.stack, ranges: [ps.oopRange, ps.ipRange], sizes, maxRaises: 1, allIn: false, allInThreshold: 1 });
    s.build();
    for (let i = 0; i < 60; i++) s.iterate();
    const e = s.explain([], 0);
    expect(e.actions.map((a) => a.label)[0]).toBe('Check');
    expect(e.actions.every((a) => isFinite(a.ev))).toBe(true);
    const bet = e.actions[1];
    expect(bet.reply?.labels).toContain('Fold');
    expect(bet.reply!.freqs.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 3);
    expect(e.handEq).toBeGreaterThanOrEqual(0);
    expect(e.handEq).toBeLessThanOrEqual(1);
    const w = explainDecision(e, 2, 'BB');
    expect(w.headline).toMatch(/highest EV/);
    expect(w.points.length).toBeGreaterThan(1);
    expect(w.details).toHaveLength(e.actions.length);
  });
});
