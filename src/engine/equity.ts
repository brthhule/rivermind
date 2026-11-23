import { rng } from './cards';
import { evaluate } from './evaluator';
import type { Combo } from './range';

export interface EquityResult {
  equity: number[]; // per player, 0..1
  win: number[];
  tie: number[];
  samples: number;
  /** Equity of each hand class for player 0 (NaN when not sampled). */
  classEquity: number[];
}

/**
 * Monte Carlo equity for 2-6 players, each with a weighted combo list.
 * Combos are sampled by weight with card-removal rejection.
 */
export function monteCarloEquity(players: Combo[][], board: number[], samples = 20000, seed?: number): EquityResult {
  const rand = rng(seed);
  const n = players.length;
  const cum = players.map((cs) => {
    const a = new Float64Array(cs.length);
    let s = 0;
    cs.forEach((c, i) => { s += c.w; a[i] = s; });
    return a;
  });
  const pick = (p: number) => {
    const a = cum[p];
    const x = rand() * a[a.length - 1];
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
    return players[p][lo];
  };
  const eq = new Float64Array(n), win = new Float64Array(n), tie = new Float64Array(n);
  const clsEq = new Float64Array(169), clsN = new Float64Array(169);
  const used = new Uint8Array(52);
  const cards = new Int32Array(7);
  const scores = new Int32Array(n);
  const need = 5 - board.length;
  let done = 0, attempts = 0;
  if (players.some((p) => p.length === 0)) return { equity: [], win: [], tie: [], samples: 0, classEquity: [] };
  const chosen: Combo[] = new Array(n);
  while (done < samples && attempts < samples * 50) {
    attempts++;
    used.fill(0);
    for (const b of board) used[b] = 1;
    let ok = true;
    for (let p = 0; p < n; p++) {
      const c = pick(p);
      if (used[c.c1] || used[c.c2]) { ok = false; break; }
      used[c.c1] = used[c.c2] = 1;
      chosen[p] = c;
    }
    if (!ok) continue;
    const runout: number[] = [];
    while (runout.length < need) {
      const c = (rand() * 52) | 0;
      if (!used[c]) { used[c] = 1; runout.push(c); }
    }
    let best = -1, nBest = 0;
    for (let p = 0; p < n; p++) {
      let k = 0;
      cards[k++] = chosen[p].c1; cards[k++] = chosen[p].c2;
      for (const b of board) cards[k++] = b;
      for (const b of runout) cards[k++] = b;
      const s = evaluate(cards, 7);
      scores[p] = s;
      if (s > best) { best = s; nBest = 1; } else if (s === best) nBest++;
    }
    for (let p = 0; p < n; p++) {
      if (scores[p] === best) {
        eq[p] += 1 / nBest;
        if (nBest === 1) win[p]++; else tie[p]++;
      }
    }
    const share = scores[0] === best ? 1 / nBest : 0;
    clsEq[chosen[0].cls] += share;
    clsN[chosen[0].cls]++;
    done++;
  }
  return {
    equity: Array.from(eq, (x) => x / done),
    win: Array.from(win, (x) => x / done),
    tie: Array.from(tie, (x) => x / done),
    samples: done,
    classEquity: Array.from(clsEq, (x, i) => (clsN[i] ? x / clsN[i] : NaN)),
  };
}

/** Exact equity of one hand vs a weighted range on a given board (enumerates all runouts). */
export function handVsRangeEquity(c1: number, c2: number, villain: Combo[], board: number[], maxRunouts = 2000): number {
  const dead = new Set([c1, c2, ...board]);
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  const need = 5 - board.length;
  let total = 0, wsum = 0;
  const cards = new Int32Array(7);
  const evalBoard = (run: number[]) => {
    let k = 0;
    cards[k++] = c1; cards[k++] = c2;
    for (const b of board) { cards[k++] = b; }
    for (const b of run) { cards[k++] = b; }
    const hero = evaluate(cards, 7);
    for (const v of villain) {
      if (dead.has(v.c1) || dead.has(v.c2) || run.includes(v.c1) || run.includes(v.c2)) continue;
      cards[0] = v.c1; cards[1] = v.c2;
      const vs = evaluate(cards, 7);
      total += v.w * (hero > vs ? 1 : hero === vs ? 0.5 : 0);
      wsum += v.w;
    }
    cards[0] = c1; cards[1] = c2;
  };
  if (need === 0) evalBoard([]);
  else if (need === 1) for (const a of deck) evalBoard([a]);
  else {
    const runs: number[][] = [];
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) runs.push([deck[i], deck[j]]);
    if (need === 2 && runs.length <= maxRunouts) for (const r of runs) evalBoard(r);
    else {
      // preflop or too many: sample runouts
      const rand = rng(12345);
      for (let s = 0; s < maxRunouts; s++) {
        const r: number[] = [];
        while (r.length < need) { const c = deck[(rand() * deck.length) | 0]; if (!r.includes(c)) r.push(c); }
        evalBoard(r);
      }
    }
  }
  return wsum ? total / wsum : NaN;
}
