// Independent Chip Model (Malmuth-Harville) and an ICM-aware heads-up push/fold solver.
import { HAND_CLASSES } from './cards';
import { classEq, classPairs } from './preflop';

/** Prize equity for each player given chip stacks and payouts (payouts[0] = 1st place). */
export function icmEquity(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const total = stacks.reduce((s, x) => s + x, 0);
  const out = new Array(n).fill(0);
  if (total <= 0) return out;
  const places = Math.min(payouts.length, n);
  // memo over (mask of players already placed) -> probability of reaching it
  const memo = new Map<number, number>();
  memo.set(0, 1);
  let frontier = [0];
  for (let place = 0; place < places; place++) {
    const next = new Map<number, number>();
    for (const mask of frontier) {
      const p = memo.get(mask)!;
      let rem = 0;
      for (let i = 0; i < n; i++) if (!(mask & (1 << i))) rem += stacks[i];
      if (rem <= 0) continue;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i) || stacks[i] <= 0) continue;
        const q = p * (stacks[i] / rem);
        out[i] += q * payouts[place];
        const m2 = mask | (1 << i);
        next.set(m2, (next.get(m2) ?? 0) + q);
      }
    }
    frontier = [...next.keys()];
    for (const [k, v] of next) memo.set(k, v);
  }
  return out;
}

export interface IcmPushFoldInput {
  stacks: number[]; // in big blinds, includes all players
  payouts: number[];
  sb: number; // index of small blind (the shover)
  bb: number; // index of big blind (the caller)
  ante: number; // per player, in bb
  mode: 'icm' | 'chips';
}
export interface IcmPushFoldResult { push: number[]; call: number[]; foldEq: number; }

/** Fictitious play over 169 classes with ICM utilities (each side maximizes its own prize equity). */
export function solveIcmPushFold(inp: IcmPushFoldInput, iterations = 300): IcmPushFoldResult {
  const N = 169;
  const { stacks, payouts, sb, bb, ante, mode } = inp;
  const antes = stacks.map((s) => Math.min(s, ante));
  const deadAntes = antes.reduce((s, x) => s + x, 0);
  const base = stacks.map((s, i) => s - antes[i]);
  const sbPost = Math.min(base[sb], 0.5), bbPost = Math.min(base[bb], 1);
  const util = (st: number[]) => (mode === 'icm' ? icmEquity(st, payouts) : st);
  const after = (f: (s: number[]) => void) => { const s = [...base]; f(s); return util(s); };
  // outcome utilities
  const pot0 = deadAntes + sbPost + bbPost;
  const uFold = after((s) => { s[sb] -= sbPost; s[bb] += pot0 - bbPost; });
  const uSteal = after((s) => { s[sb] += pot0 - sbPost; s[bb] -= bbPost; });
  const eff = Math.min(base[sb], base[bb]);
  const uSbWin = after((s) => { s[sb] += eff + deadAntes; s[bb] -= eff; });
  const uBbWin = after((s) => { s[sb] -= eff; s[bb] += eff + deadAntes; });
  // a tie splits: approximate as average of win/lose
  let push = new Array(N).fill(0.5), call = new Array(N).fill(0.5);
  for (let t = 1; t <= iterations; t++) {
    const nc = new Array(N).fill(0), np = new Array(N).fill(0);
    for (let j = 0; j < N; j++) {
      let ev = 0, w = 0;
      for (let i = 0; i < N; i++) {
        const c = classPairs(i, j) * push[i];
        if (!c) continue;
        const e = classEq(j, i);
        ev += c * (e * uBbWin[bb] + (1 - e) * uSbWin[bb]);
        w += c;
      }
      nc[j] = w > 0 && ev / w > uSteal[bb] ? 1 : 0;
    }
    for (let i = 0; i < N; i++) {
      let wAll = 0, wCall = 0, evC = 0;
      for (let j = 0; j < N; j++) {
        const k = classPairs(i, j);
        wAll += k;
        const cc = k * call[j];
        if (!cc) continue;
        wCall += cc;
        const e = classEq(i, j);
        evC += cc * (e * uSbWin[sb] + (1 - e) * uBbWin[sb]);
      }
      const pc = wAll ? wCall / wAll : 0;
      const evPush = (1 - pc) * uSteal[sb] + (wCall ? (evC / wCall) * pc : 0);
      np[i] = evPush > uFold[sb] ? 1 : 0;
    }
    const a = 1 / (t + 1);
    push = push.map((x, i) => x * (1 - a) + np[i] * a);
    call = call.map((x, i) => x * (1 - a) + nc[i] * a);
  }
  const r = (x: number) => (x > 0.97 ? 1 : x < 0.03 ? 0 : Math.round(x * 100) / 100);
  return { push: push.map(r), call: call.map(r), foldEq: uFold[sb] };
}

export const CLASS_COUNT = HAND_CLASSES.length;
