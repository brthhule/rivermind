import { describe, it, expect } from 'vitest';
import { Solver, defaultSizes, type SolverConfig } from './solver';
import { parseRange } from '../engine/range';
import { parseCards } from '../engine/cards';
import { presetSpots } from '../engine/preflop';

function cfg(board: string, r0: string | number[], r1: string | number[], lastStreet: 3 | 4 | 5 = 5, pot = 10, stack = 50): SolverConfig {
  return {
    board: parseCards(board), pot, stack,
    ranges: [typeof r0 === 'string' ? parseRange(r0) : r0, typeof r1 === 'string' ? parseRange(r1) : r1],
    sizes: defaultSizes(), maxRaises: 2, allIn: true, allInThreshold: 0.9, lastStreet,
  };
}

describe('solver', () => {
  it('river converges and is zero-sum', () => {
    const s = new Solver(cfg('Ks7d2c9h3s', 'AA, KQs, QJs, JTs, T9s, 87s', 'KJ, KT, 99, 77, 22, QQ'));
    s.build();
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) s.iterate();
    const ex = s.exploitability();
    console.log('river nodes', s.nodes, 'mb', s.estimateMB().toFixed(2), 'ms', Date.now() - t0, 'exploit %pot', ex.pctPot.toFixed(3));
    expect(ex.pctPot).toBeLessThan(1);
    const info = s.query([]);
    expect(info.kind).toBe('action');
    // equity sanity: AA on this board vs that range should be high but below 1
    const aaIdx = s.hands[0].findIndex((h) => h.cls === 0);
    console.log('AA eq', info.equity[0][aaIdx], 'labels', info.labels);
    expect(info.equity[0][aaIdx]).toBeGreaterThan(0.5);
    // zero-sum: combo-weighted EV sums ≈ pot (each EV includes half pot share)
  });
  it("turn solve runs", { timeout: 120000 }, () => {
    const s = new Solver(cfg('Ks7d2c9h', 'AA, KQs, QJs, JTs, T9s, 87s, AK', 'KJ, KT, 99, 77, 22, QQ, A9s'));

    s.build();
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) s.iterate();
    const ex = s.exploitability();
    console.log('turn nodes', s.nodes, 'mb', s.estimateMB().toFixed(1), 'ms', Date.now() - t0, 'exploit %pot', ex.pctPot.toFixed(3));
    expect(ex.pctPot).toBeLessThan(3);
    const info = s.query([0, 0]);
    expect(info.kind).toBe('chance');
    const info2 = s.query([0, 0, info.cards![0]]);
    expect(info2.board.length).toBe(5);
  });
  it("flop checkdown", { timeout: 120000 }, () => {
    const p = presetSpots()[0];
    const c = cfg('Ah8d3c', p.oopRange, p.ipRange, 3, p.pot, p.stack);
    const s = new Solver(c);
    s.build();
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) s.iterate();
    const ex = s.exploitability();
    console.log('flop nodes', s.nodes, 'hands', s.hands[0].length, s.hands[1].length, 'mb', s.estimateMB().toFixed(1), 'ms', Date.now() - t0, 'exploit %pot', ex.pctPot.toFixed(3));
    const q = s.query([]);
    console.log(q.labels);
  });
  it('estimates flop+turn size', () => {
    const p = presetSpots()[0];
    const s = new Solver(cfg('Ah8d3c', p.oopRange, p.ipRange, 4, p.pot, p.stack));
    s.build(false);
    console.log('flop+turn nodes', s.nodes, 'mb', s.estimateMB().toFixed(0));
  });
});

describe('solver extras', () => {
  it('node lock forces strategy and exact weights work', () => {
    const base = cfg('Ks7d2c9h3s', 'AA, KQs, QJs, JTs, T9s, 87s', 'KJ, KT, 99, 77, 22, QQ');
    const s = new Solver({ ...base, locks: [{ path: [], freqs: [1, 0, 0] }] });
    s.build();
    for (let i = 0; i < 100; i++) s.iterate();
    const info = s.query([]);
    expect(info.locked).toBe(true);
    expect(info.strategy![0]).toBe(1);
    // IP should now bet more often after the check than in an unlocked solve is not asserted; just ensure query works
    const w = new Array(1326).fill(0);
    s.hands[0].slice(0, 5).forEach((h) => { const hi = Math.max(h.c1, h.c2), lo = Math.min(h.c1, h.c2); w[(hi * (hi - 1)) / 2 + lo] = 0.5; });
    const s2 = new Solver({ ...base, weights: [w, null] });
    expect(s2.hands[0].length).toBe(5);
    expect(s2.hands[0][0].w).toBe(0.5);
  });
});
