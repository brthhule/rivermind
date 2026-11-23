// Preflop model for 6-max cash games at 100bb.
// Strategies are produced by Rivermind's own heuristic model: hands are ordered by
// equity against the opponent's range (value) and by playability (calls / bluffs),
// with soft boundaries so marginal hands mix. They are study baselines, not solver output.
import { HAND_CLASSES, GRID_RANKS, comboCount } from './cards';
import type { Range } from './range';
import data from '../data/preflopEquity.json';

export const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Pos = (typeof POSITIONS)[number];

// ---- class vs class equity ----
const N = 169;
const EQ = new Float32Array(N * N);
const CNT = new Float32Array(N * N);
{
  let k = 0;
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
    EQ[i * N + j] = data.eq[k];
    EQ[j * N + i] = 1 - data.eq[k];
    CNT[i * N + j] = CNT[j * N + i] = data.cnt[k];
    k++;
  }
  for (let i = 0; i < N; i++) EQ[i * N + i] = 0.5;
}
export const classEq = (i: number, j: number) => EQ[i * N + j];
export const classPairs = (i: number, j: number) => CNT[i * N + j];

/** Equity of each class against a range (with class-level card removal). */
export function equityVsRange(r: Range): number[] {
  const out = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let s = 0, w = 0;
    for (let j = 0; j < N; j++) {
      if (r[j] <= 0) continue;
      const c = CNT[i * N + j] * r[j];
      s += EQ[i * N + j] * c;
      w += c;
    }
    out[i] = w ? s / w : NaN;
  }
  return out;
}

/** Equity of range A vs range B, combo weighted. */
export function rangeVsRangeEq(a: Range, b: Range): number {
  let s = 0, w = 0;
  for (let i = 0; i < N; i++) {
    if (a[i] <= 0) continue;
    for (let j = 0; j < N; j++) {
      if (b[j] <= 0) continue;
      const c = CNT[i * N + j] * a[i] * b[j];
      s += EQ[i * N + j] * c;
      w += c;
    }
  }
  return w ? s / w : NaN;
}

const FULL: Range = new Array(N).fill(1);
export const EQ_VS_RANDOM = equityVsRange(FULL);

// ---- hand features ----
const RANKV = (ch: string) => 12 - GRID_RANKS.indexOf(ch); // 2=0 .. A=12
const feat = HAND_CLASSES.map((h) => {
  const hi = RANKV(h[0]), lo = RANKV(h[1]);
  const pair = h.length === 2, suited = h[2] === 's';
  const gap = hi - lo;
  return { hi, lo, pair, suited, gap };
});

/** Playability: raw equity plus bonuses for suitedness, connectedness and pairs (implied odds). */
export const PLAYABILITY = HAND_CLASSES.map((_, i) => {
  const f = feat[i];
  let s = EQ_VS_RANDOM[i];
  if (f.suited) s += 0.035;
  if (!f.pair) {
    if (f.gap === 1) s += 0.02; else if (f.gap === 2) s += 0.01; else if (f.gap >= 5 && f.hi < 12) s -= 0.02;
    if (f.hi === 12 && f.suited) s += 0.01;
  } else s += 0.015;
  return s;
});

/** Bluff suitability (for 3bet/4bet bluffs): blockers + playability when called. */
const BLUFF = HAND_CLASSES.map((_, i) => {
  const f = feat[i];
  if (f.pair) return 0.05;
  let s = 0;
  if (f.suited) {
    if (f.hi === 12 && f.lo <= 3) s = 1.0; // A5s-A2s
    else if (f.hi === 12) s = 0.75;
    else if (f.hi === 11) s = f.lo >= 5 ? 0.6 : 0.3;
    else if (f.gap <= 2 && f.lo >= 3) s = 0.6;
    else s = 0.25;
  } else {
    if (f.hi === 12 && f.lo >= 7) s = 0.45;
    else if (f.hi === 11 && f.lo >= 8) s = 0.3;
    else s = 0.02;
  }
  return s;
});

// ---- soft allocation ----
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Give action probability to the best `targetCombos` combos (by `score`, higher first) from the
 * available weight `avail` (per class, 0..1). Boundary is softened over `width` combos.
 * Returns per-class probability mass assigned (<= avail).
 */
function takeTop(score: number[], avail: number[], targetCombos: number, width = 10, eligible?: (i: number) => boolean): number[] {
  const idx = [...Array(N).keys()].filter((i) => avail[i] > 1e-6 && (!eligible || eligible(i))).sort((a, b) => score[b] - score[a]);
  const out = new Array(N).fill(0);
  if (targetCombos <= 0) return out;
  let cum = 0;
  for (const i of idx) {
    const c = comboCount(HAND_CLASSES[i]) * avail[i];
    const mid = cum + c / 2;
    cum += c;
    const p = sigmoid((targetCombos - mid) / Math.max(1, width / 4));
    out[i] = avail[i] * (p > 0.985 ? 1 : p < 0.015 ? 0 : p);
  }
  return out;
}

const combosOf = (r: Range) => r.reduce((s, w, i) => s + w * comboCount(HAND_CLASSES[i]), 0);
const sub = (a: number[], b: number[]) => a.map((x, i) => Math.max(0, x - b[i]));
const round = (x: number) => Math.round(x * 1000) / 1000;

// ---- spots ----
export type ActionKind = 'fold' | 'call' | 'raise' | 'allin';
export interface PreflopAction { label: string; kind: ActionKind; amount: number }
export interface PreflopSpot {
  key: string;
  hero: Pos;
  villain?: Pos;
  title: string;
  actions: PreflopAction[];
  /** strat[class][action] = frequency (sums to 1 where reach > 0) */
  strat: number[][];
  reach: Range;
  villainRange?: Range;
  pot: number;
  toCall: number;
}

const STACK = 100;
const openSize = (p: Pos) => (p === 'SB' ? 3 : 2.5);
const isBlind = (p: Pos) => p === 'SB' || p === 'BB';
const posIdx = (p: Pos) => POSITIONS.indexOf(p);
/** true if a is in position vs b postflop */
export const inPositionVs = (a: Pos, b: Pos) => {
  const order = (p: Pos) => (p === 'SB' ? -2 : p === 'BB' ? -1 : posIdx(p));
  return order(a) > order(b);
};
const blindPost = (p: Pos) => (p === 'SB' ? 0.5 : p === 'BB' ? 1 : 0);
const threeBetSize = (d: Pos, o: Pos) => Math.round((inPositionVs(d, o) ? 3 : 4.2) * openSize(o) * 2) / 2;
const fourBetSize = (o: Pos, d: Pos) => Math.round((inPositionVs(o, d) ? 2.2 : 2.5) * threeBetSize(d, o) * 2) / 2;

function finish(key: string, hero: Pos, title: string, actions: PreflopAction[], parts: number[][], reach: Range, pot: number, toCall: number, villain?: Pos, villainRange?: Range): PreflopSpot {
  // parts[a][class] = mass; fold gets the remainder (action 0 is always fold when present)
  const strat = HAND_CLASSES.map((_, i) => {
    const row = actions.map((_a, k) => parts[k]?.[i] ?? 0);
    const tot = reach[i];
    if (tot <= 0) return actions.map((a) => (a.kind === 'fold' ? 1 : 0));
    const used = row.reduce((s, x) => s + x, 0);
    const foldIdx = actions.findIndex((a) => a.kind === 'fold');
    if (foldIdx >= 0) row[foldIdx] += Math.max(0, tot - used);
    return row.map((x) => round(x / tot));
  });
  return { key, hero, villain, title, actions, strat, reach, villainRange, pot, toCall };
}

const RFI_PCT: Record<string, number> = { UTG: 17, HJ: 21, CO: 28, BTN: 45, SB: 44 };

function rfi(p: Pos): PreflopSpot {
  const target = (RFI_PCT[p] / 100) * 1326;
  const raise = takeTop(PLAYABILITY, FULL, target, 18);
  const size = openSize(p);
  const pot = 1.5 + 0; // blinds only
  return finish(`rfi:${p}`, p, `${p} first in`, [
    { label: 'Fold', kind: 'fold', amount: 0 },
    { label: `Raise ${size}`, kind: 'raise', amount: size },
  ], [[], raise], FULL, pot, p === 'SB' ? 0.5 : 1);
}

function vsOpen(d: Pos, o: Pos): PreflopSpot {
  const oRange = rangeOf(spot(`rfi:${o}`), 1);
  const oPct = (combosOf(oRange) / 1326) * 100;
  let threeBet: number, call: number;
  if (d === 'BB') {
    threeBet = o === 'SB' ? 14 : 4 + oPct * 0.16;
    call = (o === 'SB' ? 62 : 30 + oPct * 0.55) - threeBet;
  } else if (d === 'SB') {
    threeBet = 3 + oPct * 0.2;
    call = oPct > 35 ? 0 : 1.5;
  } else {
    threeBet = 2 + oPct * 0.15;
    call = 2 + oPct * 0.2;
  }
  const eq = equityVsRange(oRange);
  const valueCombos = (threeBet * 0.62 / 100) * 1326;
  const bluffCombos = (threeBet * 0.38 / 100) * 1326;
  const value = takeTop(eq, FULL, valueCombos, 8);
  let rest = sub(FULL, value);
  const callScore = PLAYABILITY.map((p, i) => p * 0.5 + eq[i] * 0.5);
  const bluffScore = BLUFF.map((b, i) => b + eq[i] * 0.5);
  const bluff = takeTop(bluffScore, rest, bluffCombos, 14, (i) => BLUFF[i] >= 0.25 && callScore[i] > 0.42);
  rest = sub(rest, bluff);
  const calls = takeTop(callScore, rest, (call / 100) * 1326, 20);
  const raise = value.map((v, i) => v + bluff[i]);
  const size = threeBetSize(d, o);
  const pot = 1.5 + openSize(o) - blindPost(o);
  return finish(`vsopen:${d}:${o}`, d, `${d} vs ${o} open`, [
    { label: 'Fold', kind: 'fold', amount: 0 },
    { label: 'Call', kind: 'call', amount: openSize(o) },
    { label: `3-bet ${size}`, kind: 'raise', amount: size },
  ], [[], calls, raise], FULL, pot, openSize(o) - blindPost(d), o, oRange);
}

function vs3bet(o: Pos, d: Pos): PreflopSpot {
  const reach = rangeOf(spot(`rfi:${o}`), 1);
  const dRange = rangeOf(spot(`vsopen:${d}:${o}`), 2);
  const n = combosOf(reach);
  const ip = inPositionVs(o, d);
  const eq = equityVsRange(dRange);
  const fourValue = takeTop(eq, reach, n * 0.075, 5);
  let rest = sub(reach, fourValue);
  const callScore = PLAYABILITY.map((p, i) => p * 0.4 + eq[i] * 0.6);
  const bluff = takeTop(BLUFF.map((b, i) => b + eq[i]), rest, n * 0.045, 6, (i) => BLUFF[i] >= 0.6);
  rest = sub(rest, bluff);
  const calls = takeTop(callScore, rest, n * (ip ? 0.34 : 0.26), 12);
  const size = fourBetSize(o, d);
  const pot = 1.5 + openSize(o) + threeBetSize(d, o) - blindPost(o) - blindPost(d);
  return finish(`vs3bet:${o}:${d}`, o, `${o} open, facing ${d} 3-bet`, [
    { label: 'Fold', kind: 'fold', amount: 0 },
    { label: 'Call', kind: 'call', amount: threeBetSize(d, o) },
    { label: `4-bet ${size}`, kind: 'raise', amount: size },
  ], [[], calls, fourValue.map((v, i) => v + bluff[i])], reach, pot, threeBetSize(d, o) - openSize(o), d, dRange);
}

function vs4bet(d: Pos, o: Pos): PreflopSpot {
  const reach = rangeOf(spot(`vsopen:${d}:${o}`), 2);
  const oRange = rangeOf(spot(`vs3bet:${o}:${d}`), 2);
  const n = combosOf(reach);
  const eq = equityVsRange(oRange);
  const jam = takeTop(eq, reach, n * 0.16, 4);
  const rest = sub(reach, jam);
  const calls = takeTop(eq.map((e, i) => e + PLAYABILITY[i] * 0.3), rest, n * 0.2, 6);
  const pot = 1.5 + threeBetSize(d, o) + fourBetSize(o, d) - blindPost(o) - blindPost(d);
  return finish(`vs4bet:${d}:${o}`, d, `${d} 3-bet, facing ${o} 4-bet`, [
    { label: 'Fold', kind: 'fold', amount: 0 },
    { label: 'Call', kind: 'call', amount: fourBetSize(o, d) },
    { label: `All-in ${STACK}`, kind: 'allin', amount: STACK },
  ], [[], calls, jam], reach, pot, fourBetSize(o, d) - threeBetSize(d, o), o, oRange);
}

function vs5bet(o: Pos, d: Pos): PreflopSpot {
  const reach = rangeOf(spot(`vs3bet:${o}:${d}`), 2);
  const jamRange = rangeOf(spot(`vs4bet:${d}:${o}`), 2);
  const eq = equityVsRange(jamRange);
  const toCall = STACK - fourBetSize(o, d);
  const finalPot = 2 * STACK + 1.5 - blindPost(o) - blindPost(d);
  const need = toCall / finalPot;
  const call = HAND_CLASSES.map((_, i) => {
    if (reach[i] <= 0) return 0;
    const p = sigmoid((eq[i] - need) * 80);
    return reach[i] * (p > 0.97 ? 1 : p < 0.03 ? 0 : p);
  });
  const pot = STACK + fourBetSize(o, d) + 1.5 - blindPost(o) - blindPost(d);
  return finish(`vs5bet:${o}:${d}`, o, `${o} 4-bet, facing ${d} all-in`, [
    { label: 'Fold', kind: 'fold', amount: 0 },
    { label: 'Call', kind: 'call', amount: STACK },
  ], [[], call], reach, pot, toCall, d, jamRange);
}

const cache = new Map<string, PreflopSpot>();
export function spot(key: string): PreflopSpot {
  let s = cache.get(key);
  if (s) return s;
  const [kind, a, b] = key.split(':') as [string, Pos, Pos];
  if (kind === 'rfi') s = rfi(a);
  else if (kind === 'vsopen') s = vsOpen(a, b);
  else if (kind === 'vs3bet') s = vs3bet(a, b);
  else if (kind === 'vs4bet') s = vs4bet(a, b);
  else if (kind === 'vs5bet') s = vs5bet(a, b);
  else throw new Error('Unknown spot ' + key);
  cache.set(key, s);
  return s;
}

/** Range (class weights) of hands taking action `a` at the spot, including reach. */
export function rangeOf(s: PreflopSpot, a: number): Range {
  return s.strat.map((row, i) => round(row[a] * s.reach[i]));
}

/** Combo-weighted frequency of each action at a spot. */
export function actionTotals(s: PreflopSpot): number[] {
  const tot = s.actions.map(() => 0);
  let all = 0;
  s.strat.forEach((row, i) => {
    const c = comboCount(HAND_CLASSES[i]) * s.reach[i];
    all += c;
    row.forEach((f, a) => (tot[a] += f * c));
  });
  return tot.map((x) => (all ? x / all : 0));
}

// ---- action-sequence navigation ----
export interface HistItem { pos: Pos; action: number; label: string }
export type PreflopState =
  | { kind: 'decision'; spot: PreflopSpot }
  | { kind: 'end'; summary: string; flop?: { oop: Pos; ip: Pos; oopRange: Range; ipRange: Range; pot: number; stack: number } };

/** Given an action history, return the next decision (or end of hand). */
export function stateAfter(hist: HistItem[]): PreflopState {
  let opener: Pos | null = null;
  let threeBettor: Pos | null = null;
  let phase: 'rfi' | 'vsopen' | 'vs3bet' | 'vs4bet' | 'vs5bet' = 'rfi';
  let nextPos = 0;
  for (const h of hist) {
    const st = stateFor();
    if (st.kind !== 'decision') break;
    const act = st.spot.actions[h.action];
    if (phase === 'rfi') {
      if (act.kind === 'raise') { opener = h.pos; phase = 'vsopen'; nextPos = posIdx(h.pos) + 1; }
      else nextPos++;
    } else if (phase === 'vsopen') {
      if (act.kind === 'raise') { threeBettor = h.pos; phase = 'vs3bet'; }
      else if (act.kind === 'call') return endCall(opener!, h.pos, spot(`rfi:${opener}`), 1, st.spot, 1, openSize(opener!));
      else nextPos++;
    } else if (phase === 'vs3bet') {
      if (act.kind === 'raise') phase = 'vs4bet';
      else if (act.kind === 'call') return endCall(opener!, threeBettor!, st.spot, 1, spot(`vsopen:${threeBettor}:${opener}`), 2, threeBetSize(threeBettor!, opener!));
      else return { kind: 'end', summary: `${opener} folds. ${threeBettor} wins the pot.` };
    } else if (phase === 'vs4bet') {
      if (act.kind === 'allin') phase = 'vs5bet';
      else if (act.kind === 'call') return endCall(opener!, threeBettor!, spot(`vs3bet:${opener}:${threeBettor}`), 2, st.spot, 1, fourBetSize(opener!, threeBettor!));
      else return { kind: 'end', summary: `${threeBettor} folds. ${opener} wins the pot.` };
    } else if (phase === 'vs5bet') {
      return { kind: 'end', summary: act.kind === 'call' ? 'All-in and called. Hands go to showdown.' : `${opener} folds to the all-in.` };
    }
  }
  return stateFor();

  function stateFor(): PreflopState {
    if (phase === 'rfi') {
      if (nextPos >= 5) return { kind: 'end', summary: 'Folded to the big blind. BB wins the blinds.' };
      return { kind: 'decision', spot: spot(`rfi:${POSITIONS[nextPos]}`) };
    }
    if (phase === 'vsopen') {
      if (nextPos >= 6) return { kind: 'end', summary: `Everyone folds. ${opener} wins the blinds.` };
      return { kind: 'decision', spot: spot(`vsopen:${POSITIONS[nextPos]}:${opener}`) };
    }
    if (phase === 'vs3bet') return { kind: 'decision', spot: spot(`vs3bet:${opener}:${threeBettor}`) };
    if (phase === 'vs4bet') return { kind: 'decision', spot: spot(`vs4bet:${threeBettor}:${opener}`) };
    return { kind: 'decision', spot: spot(`vs5bet:${opener}:${threeBettor}`) };
  }
  function endCall(a: Pos, b: Pos, sa: PreflopSpot, aa: number, sb: PreflopSpot, ab: number, invested: number): PreflopState {
    const ra = rangeOf(sa, aa), rb = rangeOf(sb, ab);
    const aIP = inPositionVs(a, b);
    const dead = 1.5 - (isBlind(a) ? blindPost(a) : 0) - (isBlind(b) ? blindPost(b) : 0);
    const pot = Math.round((invested * 2 + dead) * 10) / 10;
    return {
      kind: 'end',
      summary: `${aIP ? b : a} vs ${aIP ? a : b}, ${pot}bb pot heading to the flop.`,
      flop: {
        oop: aIP ? b : a, ip: aIP ? a : b,
        oopRange: aIP ? rb : ra, ipRange: aIP ? ra : rb,
        pot, stack: STACK - invested,
      },
    };
  }
}

/** Common postflop starting points derived from the preflop model. */
export function presetSpots() {
  const mk = (name: string, hist: [Pos, number][]) => {
    const h: HistItem[] = [];
    for (const [pos, action] of hist) h.push({ pos, action, label: '' });
    const st = stateAfter(h);
    return st.kind === 'end' && st.flop ? { name, ...st.flop } : null;
  };
  const folds = (upto: Pos): [Pos, number][] => POSITIONS.slice(0, posIdx(upto)).map((p) => [p, 0]);
  return [
    mk('BTN open, BB call (single raised)', [...folds('BTN'), ['BTN', 1], ['SB', 0], ['BB', 1]]),
    mk('CO open, BTN call (single raised)', [...folds('CO'), ['CO', 1], ['BTN', 1]]),
    mk('UTG open, BB call (single raised)', [['UTG', 1], ['HJ', 0], ['CO', 0], ['BTN', 0], ['SB', 0], ['BB', 1]]),
    mk('SB open, BB call (single raised)', [...folds('SB'), ['SB', 1], ['BB', 1]]),
    mk('BTN open, BB 3-bet, BTN call (3-bet pot)', [...folds('BTN'), ['BTN', 1], ['SB', 0], ['BB', 2], ['BTN', 1]]),
    mk('CO open, BTN 3-bet, CO call (3-bet pot)', [...folds('CO'), ['CO', 1], ['BTN', 2], ['CO', 1]]),
  ].filter((x): x is NonNullable<typeof x> => !!x);
}
