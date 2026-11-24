// Heads-up postflop solver: vectorized Discounted CFR over a betting tree with
// chance nodes for turn/river cards. Showdowns use an O(n) sorted sweep with
// card-removal correction, averaged over every runout of the board when the
// tree stops betting before the river ("check down" the remaining streets).
import { evaluate } from '../engine/evaluator';
import { cardStr } from '../engine/cards';
import { expandRange, type Range } from '../engine/range';

export interface StreetSizes { bet: number[]; raise: number[] }
export interface SolverConfig {
  board: number[];
  pot: number;
  stack: number; // effective stack behind at the start of the solve
  ranges: [Range, Range]; // 0 = OOP, 1 = IP
  sizes: Record<'flop' | 'turn' | 'river', [StreetSizes, StreetSizes]>;
  maxRaises: number;
  allIn: boolean; // always offer an all-in option
  allInThreshold: number; // a bet using this fraction of the stack or more becomes all-in
  lastStreet: 3 | 4 | 5; // board size of the last street with betting
  /** Optional exact starting weight per combo (indexed by comboId 0..1325); overrides ranges. */
  weights?: [number[] | null, number[] | null];
  /** Node locks: fix a player's strategy at a node (path as in query()). */
  locks?: NodeLock[];
}

export interface NodeLock {
  path: number[];
  /** Same frequencies for every hand, one per action. */
  freqs?: number[];
  /** Or a strategy per hand class: perClass[class][action]. */
  perClass?: number[][];
}

export interface Hand { c1: number; c2: number; cls: number; w: number }

interface ActionNode {
  k: 0; player: 0 | 1; labels: string[]; amounts: number[]; children: TNode[];
  regret: Float32Array; ssum: Float32Array; n: number;
  board: number[]; commit: [number, number];
  locked?: Float32Array;
}
interface ChanceNode { k: 1; board: number[]; cards: number[]; children: TNode[]; commit: [number, number] }
interface TermNode { k: 2; folder: -1 | 0 | 1; board: number[]; commit: [number, number] }
type TNode = ActionNode | ChanceNode | TermNode;

// packed: per sorted position k, [idx, strength, c1, c2] at 4k..4k+3 (sequential access in sweeps)
interface BoardData { str: [Int32Array, Int32Array]; sorted: [Int32Array, Int32Array]; packed: [Int32Array, Int32Array] }

export interface NodeInfo {
  kind: 'action' | 'chance' | 'terminal';
  player?: 0 | 1;
  labels?: string[];
  amounts?: number[];
  board: number[];
  pot: number;
  commit: [number, number];
  cards?: number[];
  folder?: number;
  reach: [Float32Array, Float32Array];
  equity: [Float32Array, Float32Array];
  /** action node: strategy[a*n + h] for the acting player */
  strategy?: Float32Array;
  /** action node: EV of each action per hand of the acting player, in bb */
  actionEv?: Float32Array;
  /** EV per hand for each player, in bb (NaN where unreachable) */
  ev: [Float32Array, Float32Array];
  locked?: boolean;
}

/** How the opponent answers one of the acting player's actions (weights account for the hero's own cards). */
export interface ActionInsight {
  label: string;
  /** chips this action puts in, beyond what the player already had in this street */
  add: number;
  /** EV of this action for the explained hand (bb) */
  ev: number;
  /** how often the explained hand takes it */
  freq: number;
  /** how often the whole range takes it */
  rangeFreq: number;
  /** opponent reply, if the opponent acts next: labels and range-weighted frequencies */
  reply?: { labels: string[]; freqs: number[] };
  /** hand's equity against the opponent hands that do not fold to it */
  eqVsContinue?: number;
  /** hand's equity against the opponent hands that fold to it */
  eqVsFold?: number;
  /** share of the range taking this action that is strong (equity >= 75%) and weak (< 35%) */
  strongShare?: number;
  weakShare?: number;
}
export interface Explanation {
  player: 0 | 1;
  pot: number;
  toCall: number;
  board: number[];
  street: 'flop' | 'turn' | 'river';
  hand: [number, number];
  /** hand's equity against the opponent's whole range */
  handEq: number;
  /** share of the player's own range (by weight) with lower equity than this hand */
  handPercentile: number;
  /** average equity of each range against the other, [actor, opponent] */
  rangeEq: [number, number];
  /** share of each range with equity >= 75% ("very strong"), [actor, opponent] */
  strongShare: [number, number];
  actions: ActionInsight[];
}

export const MAX_NODES = 1_500_000;
const r2 = (x: number) => Math.round(x * 100) / 100;

export class Solver {
  cfg: SolverConfig;
  hands: [Hand[], Hand[]];
  root!: TNode;
  nodes = 0;
  floats = 0;
  iteration = 0;
  private c1: [Int32Array, Int32Array];
  private c2: [Int32Array, Int32Array];
  private same: [Int32Array, Int32Array];
  private boardCache = new Map<string, BoardData>();
  private compCache = new Map<string, { list: BoardData[]; denom: number }>();
  private cs = new Float64Array(52);

  constructor(cfg: SolverConfig) {
    this.cfg = cfg;
    const mk = (p: 0 | 1) => {
      const wts = cfg.weights?.[p];
      if (wts) {
        const all = expandRange(new Array(169).fill(1), cfg.board);
        return all.filter((c) => wts[c.id] > 0).map((c) => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: wts[c.id] }));
      }
      return expandRange(cfg.ranges[p], cfg.board).map((c) => ({ c1: c.c1, c2: c.c2, cls: c.cls, w: c.w }));
    };
    const h0 = mk(0), h1 = mk(1);
    if (!h0.length || !h1.length) throw new Error('Both ranges need at least one hand that does not conflict with the board.');
    this.hands = [h0, h1];
    this.c1 = [Int32Array.from(h0, (h) => h.c1), Int32Array.from(h1, (h) => h.c1)];
    this.c2 = [Int32Array.from(h0, (h) => h.c2), Int32Array.from(h1, (h) => h.c2)];
    const key = (a: number, b: number) => (a < b ? a * 52 + b : b * 52 + a);
    const idx = [new Map<number, number>(), new Map<number, number>()];
    h0.forEach((h, i) => idx[0].set(key(h.c1, h.c2), i));
    h1.forEach((h, i) => idx[1].set(key(h.c1, h.c2), i));
    this.same = [
      Int32Array.from(h0, (h) => idx[1].get(key(h.c1, h.c2)) ?? -1),
      Int32Array.from(h1, (h) => idx[0].get(key(h.c1, h.c2)) ?? -1),
    ];
  }

  // ---------- tree ----------
  build(allocate = true) {
    this.nodes = 0;
    this.floats = 0;
    this.root = this.buildAction(0, this.cfg.board, [0, 0], 0, false, allocate);
    for (const lock of this.cfg.locks ?? []) this.applyLock(lock);
  }

  private nodeAt(path: number[]): TNode {
    let node = this.root;
    for (const step of path) {
      if (node.k === 0) node = node.children[step];
      else if (node.k === 1) { const i = node.cards.indexOf(step); if (i < 0) throw new Error('Locked path not found'); node = node.children[i]; }
      else throw new Error('Locked path not found');
      if (!node) throw new Error('Locked path not found');
    }
    return node;
  }

  private applyLock(lock: NodeLock) {
    const node = this.nodeAt(lock.path);
    if (node.k !== 0) throw new Error('Only decision points can be locked');
    const A = node.labels.length, n = node.n;
    const st = new Float32Array(A * n);
    const hs = this.hands[node.player];
    for (let h = 0; h < n; h++) {
      const row = lock.perClass ? lock.perClass[hs[h].cls] : lock.freqs;
      let tot = 0;
      for (let a = 0; a < A; a++) tot += Math.max(0, row?.[a] ?? 0);
      for (let a = 0; a < A; a++) st[a * n + h] = tot > 0 ? Math.max(0, row![a]) / tot : 1 / A;
    }
    node.locked = st;
  }

  private streetName(board: number[]) {
    return board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river';
  }

  private buildAction(p: 0 | 1, board: number[], commit: [number, number], raises: number, oopChecked: boolean, alloc: boolean): TNode {
    if (++this.nodes > MAX_NODES) throw new Error(`Tree too large (over ${MAX_NODES.toLocaleString()} nodes). Use fewer bet sizes, fewer raises, or fewer streets.`);
    const { stack, pot: P0 } = this.cfg;
    const q = (1 - p) as 0 | 1;
    const pot = P0 + commit[0] + commit[1];
    const toCall = commit[q] - commit[p];
    const sizes = this.cfg.sizes[this.streetName(board)][p];
    const labels: string[] = [];
    const amounts: number[] = [];
    const kids: (() => TNode)[] = [];
    const addBet = (newCommit: number, verb: string) => {
      if (newCommit >= stack * this.cfg.allInThreshold) newCommit = stack;
      newCommit = Math.min(stack, r2(newCommit));
      if (newCommit <= commit[q] || amounts.includes(newCommit)) return;
      amounts.push(newCommit);
      const add = r2(newCommit - commit[p]);
      const pct = Math.round(((newCommit - commit[q]) / (pot + toCall)) * 100);
      labels.push(newCommit >= stack ? `All-in ${add}` : `${verb} ${add} (${pct}%)`);
      const nc: [number, number] = [commit[0], commit[1]];
      nc[p] = newCommit;
      kids.push(() => this.buildAction(q, board, nc, raises + (toCall > 0 ? 1 : 0), false, alloc));
    };
    if (toCall === 0) {
      labels.push('Check'); amounts.push(commit[p]);
      kids.push(() => (p === 0 && !oopChecked ? this.buildAction(1, board, commit, raises, true, alloc) : this.endStreet(board, commit, alloc)));
      if (commit[p] < stack) {
        for (const f of sizes.bet) addBet(commit[q] + f * pot, 'Bet');
        if (this.cfg.allIn) addBet(stack, 'Bet');
      }
    } else {
      labels.push('Fold'); amounts.push(commit[p]);
      kids.push(() => ({ k: 2, folder: p, board, commit }));
      labels.push('Call'); amounts.push(commit[q]);
      const nc: [number, number] = [commit[q], commit[q]];
      kids.push(() => this.endStreet(board, nc, alloc));
      if (commit[q] < stack && raises < this.cfg.maxRaises) {
        for (const f of sizes.raise) addBet(commit[q] + f * (pot + toCall), 'Raise');
        if (this.cfg.allIn) addBet(stack, 'Raise');
      }
    }
    const n = this.hands[p].length;
    const A = labels.length;
    const node: ActionNode = {
      k: 0, player: p, labels, amounts, children: [], board, commit, n,
      regret: alloc ? new Float32Array(A * n) : new Float32Array(0),
      ssum: alloc ? new Float32Array(A * n) : new Float32Array(0),
    };
    this.floats += 2 * A * n;
    node.children = kids.map((f) => f());
    return node;
  }

  private endStreet(board: number[], commit: [number, number], alloc: boolean): TNode {
    const allin = commit[0] >= this.cfg.stack || commit[1] >= this.cfg.stack;
    if (allin || board.length >= this.cfg.lastStreet || board.length === 5) return { k: 2, folder: -1, board, commit };
    const used = new Set(board);
    const cards: number[] = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) cards.push(c);
    this.nodes++;
    const node: ChanceNode = { k: 1, board, cards, children: [], commit };
    node.children = cards.map((c) => this.buildAction(0, [...board, c], commit, 0, false, alloc));
    return node;
  }

  /** Approximate memory in MB (regrets + strategy sums) */
  estimateMB() {
    return (this.floats * 4) / 1e6;
  }

  // ---------- showdown data ----------
  private boardData(b: number[]): BoardData {
    const key = [...b].sort((x, y) => x - y).join(',');
    let d = this.boardCache.get(key);
    if (d) return d;
    const mk = (p: 0 | 1) => {
      const hs = this.hands[p];
      const str = new Int32Array(hs.length);
      const cards = new Int32Array(7);
      for (let i = 0; i < 5; i++) cards[i + 2] = b[i];
      const valid: number[] = [];
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i];
        if (b.includes(h.c1) || b.includes(h.c2)) { str[i] = -1; continue; }
        cards[0] = h.c1; cards[1] = h.c2;
        str[i] = evaluate(cards, 7);
        valid.push(i);
      }
      valid.sort((x, y) => str[x] - str[y]);
      const packed = new Int32Array(valid.length * 4);
      for (let k = 0; k < valid.length; k++) {
        const i = valid[k];
        packed[4 * k] = i; packed[4 * k + 1] = str[i]; packed[4 * k + 2] = hs[i].c1; packed[4 * k + 3] = hs[i].c2;
      }
      return { str, sorted: Int32Array.from(valid), packed };
    };
    const a = mk(0), c = mk(1);
    d = { str: [a.str, c.str], sorted: [a.sorted, c.sorted], packed: [a.packed, c.packed] };
    this.boardCache.set(key, d);
    return d;
  }

  /** All 5-card completions of a board, and the number of completions valid for any one matchup. */
  private completions(b: number[]) {
    const key = b.join(',');
    let c = this.compCache.get(key);
    if (c) return c;
    const used = new Set(b);
    const rest: number[] = [];
    for (let x = 0; x < 52; x++) if (!used.has(x)) rest.push(x);
    const list: BoardData[] = [];
    const need = 5 - b.length;
    let denom = 1;
    if (need === 0) list.push(this.boardData(b));
    else if (need === 1) { for (const x of rest) list.push(this.boardData([...b, x])); denom = rest.length - 4; }
    else {
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) list.push(this.boardData([...b, rest[i], rest[j]]));
      const m = rest.length - 4;
      denom = (m * (m - 1)) / 2;
    }
    c = { list, denom };
    this.compCache.set(key, c);
    return c;
  }

  /** out[h] += scale * (wins - losses) for player p against opp reach (one 5-card board). */
  private sweep(bd: BoardData, p: 0 | 1, reachO: Float32Array, out: Float32Array, scale: number, loseOut?: Float32Array) {
    const q = (1 - p) as 0 | 1;
    const H = bd.packed[p], O = bd.packed[q];
    const hn = H.length, on = O.length;
    const cs = this.cs;
    cs.fill(0);
    let sum = 0, j = 0;
    for (let i = 0; i < hn; i += 4) {
      const s = H[i + 1];
      while (j < on && O[j + 1] < s) {
        const r = reachO[O[j]];
        if (r) { sum += r; cs[O[j + 2]] += r; cs[O[j + 3]] += r; }
        j += 4;
      }
      out[H[i]] += scale * (sum - cs[H[i + 2]] - cs[H[i + 3]]);
    }
    cs.fill(0);
    sum = 0; j = on - 4;
    const lo = loseOut ?? out, ls = loseOut ? scale : -scale;
    for (let i = hn - 4; i >= 0; i -= 4) {
      const s = H[i + 1];
      while (j >= 0 && O[j + 1] > s) {
        const r = reachO[O[j]];
        if (r) { sum += r; cs[O[j + 2]] += r; cs[O[j + 3]] += r; }
        j -= 4;
      }
      lo[H[i]] += ls * (sum - cs[H[i + 2]] - cs[H[i + 3]]);
    }
  }

  /** Sum of opp reach compatible with each hero hand (card removal). */
  private blocked(p: 0 | 1, reachO: Float32Array, out: Float32Array, scale: number) {
    const q = (1 - p) as 0 | 1;
    const cs = this.cs;
    cs.fill(0);
    let tot = 0;
    const oc1 = this.c1[q], oc2 = this.c2[q];
    const m = this.hands[q].length;
    for (let o = 0; o < m; o++) {
      const r = reachO[o];
      if (r) { tot += r; cs[oc1[o]] += r; cs[oc2[o]] += r; }
    }
    const hc1 = this.c1[p], hc2 = this.c2[p], same = this.same[p];
    const n = this.hands[p].length;
    for (let h = 0; h < n; h++) {
      const s = same[h];
      out[h] += scale * (tot - cs[hc1[h]] - cs[hc2[h]] + (s >= 0 ? reachO[s] : 0));
    }
  }

  /** Showdown matrix M[h*n1+o] in [-1,1] (win minus loss share over runouts), used when cheaper than sweeps. */
  private matrices = new Map<string, Float32Array>();
  forceSweep = false;
  private useMatrix(board: number[]) {
    const n0 = this.hands[0].length, n1 = this.hands[1].length;
    const { list } = this.completions(board);
    return this.forceSweep ? false : list.length * (n0 + n1) * 2 > n0 * n1 * 1.5;
  }
  private matrix(board: number[]): Float32Array {
    const key = board.join(',');
    let M = this.matrices.get(key);
    if (M) return M;
    const n0 = this.hands[0].length, n1 = this.hands[1].length;
    M = new Float32Array(n0 * n1);
    const { list, denom } = this.completions(board);
    for (const bd of list) {
      const s0 = bd.str[0], s1 = bd.str[1], v0 = bd.sorted[0], v1 = bd.sorted[1];
      for (let i = 0; i < v0.length; i++) {
        const h = v0[i], sh = s0[h], row = h * n1;
        for (let j = 0; j < v1.length; j++) {
          const o = v1[j], so = s1[o];
          if (sh > so) M[row + o] += 1; else if (sh < so) M[row + o] -= 1;
        }
      }
    }
    const a1 = this.c1[0], a2 = this.c2[0], b1 = this.c1[1], b2 = this.c2[1];
    for (let h = 0; h < n0; h++) for (let o = 0; o < n1; o++) {
      const i = h * n1 + o;
      if (a1[h] === b1[o] || a1[h] === b2[o] || a2[h] === b1[o] || a2[h] === b2[o]) M[i] = 0; else M[i] /= denom;
    }
    this.matrices.set(key, M);
    return M;
  }

  private terminal(node: TermNode, p: 0 | 1, reachO: Float32Array, out: Float32Array) {
    const n = this.hands[p].length;
    out.fill(0, 0, n);
    const half = this.cfg.pot / 2;
    if (node.folder >= 0) {
      const f = node.folder;
      const payoff = f === p ? -(half + node.commit[p]) : half + node.commit[1 - p];
      this.blocked(p, reachO, out, payoff);
      return;
    }
    const payoff = half + node.commit[p];
    if (node.board.length < 5 && this.useMatrix(node.board)) {
      const M = this.matrix(node.board);
      const n0 = this.hands[0].length, n1 = this.hands[1].length;
      if (p === 0) {
        for (let h = 0; h < n0; h++) {
          let s = 0;
          const row = h * n1;
          for (let o = 0; o < n1; o++) s += M[row + o] * reachO[o];
          out[h] = s * payoff;
        }
      } else {
        for (let h = 0; h < n0; h++) {
          const r = reachO[h];
          if (!r) continue;
          const row = h * n1, k = -r * payoff;
          for (let o = 0; o < n1; o++) out[o] += M[row + o] * k;
        }
      }
      return;
    }
    const { list, denom } = this.completions(node.board);
    const scale = payoff / denom;
    for (const bd of list) this.sweep(bd, p, reachO, out, scale);
  }

  // ---------- CFR ----------
  private strategyInto(node: ActionNode, avg: boolean, s: Float32Array) {
    const A = node.labels.length, n = node.n;
    if (node.locked) { s.set(node.locked); return s; }
    const R = node.regret, S = node.ssum, u = 1 / A;
    for (let h = 0; h < n; h++) {
      // average strategy; hands never reached (own reach 0) fall back to the current regret-matching strategy
      if (avg) {
        let tot = 0;
        for (let i = h; i < A * n; i += n) { const v = S[i]; if (v > 0) tot += v; }
        if (tot > 0) {
          const k = 1 / tot;
          for (let i = h; i < A * n; i += n) { const v = S[i]; s[i] = v > 0 ? v * k : 0; }
          continue;
        }
      }
      let tot = 0;
      for (let i = h; i < A * n; i += n) { const v = R[i]; if (v > 0) tot += v; }
      if (tot > 0) {
        const k = 1 / tot;
        for (let i = h; i < A * n; i += n) { const v = R[i]; s[i] = v > 0 ? v * k : 0; }
      } else for (let i = h; i < A * n; i += n) s[i] = u;
    }
    return s;
  }
  private strategy(node: ActionNode, avg = false): Float32Array {
    return this.strategyInto(node, avg, new Float32Array(node.labels.length * node.n));
  }

  private chanceReach(reach: Float32Array, p: 0 | 1, card: number, dst?: Float32Array) {
    const n = this.hands[p].length;
    const r = dst ?? new Float32Array(n);
    const a = this.c1[p], b = this.c2[p];
    for (let h = 0; h < n; h++) r[h] = a[h] === card || b[h] === card ? 0 : reach[h];
    return r;
  }

  /** Discounted CFR parameters. */
  params = { alpha: 1.5, beta: -Infinity, gamma: 3 };
  private dPos = 1; private dNeg = 0.5; private dStrat = 1;

  // per-depth scratch buffers (one node per depth is active at a time)
  private bufs: { out: Float32Array; sig: Float32Array; vals: Float32Array; r1: Float32Array; r2: Float32Array }[] = [];
  private buf(d: number) {
    let b = this.bufs[d];
    if (!b) {
      const nm = Math.max(this.hands[0].length, this.hands[1].length);
      const am = 12;
      b = { out: new Float32Array(nm), sig: new Float32Array(am * nm), vals: new Float32Array(am * nm), r1: new Float32Array(nm), r2: new Float32Array(nm) };
      this.bufs[d] = b;
    }
    return b;
  }

  /** Returns counterfactual values for player p's hands (a scratch buffer valid until the next call at depth d). */
  private cfr(node: TNode, p: 0 | 1, reachP: Float32Array, reachO: Float32Array, mode: 0 | 1 | 2, d = 0): Float32Array {
    // mode 0 = train, 1 = best response for p, 2 = evaluate average strategies
    const B = this.buf(d);
    const out = B.out;
    if (node.k === 2) { this.terminal(node, p, reachO, out); return out; }
    const n = this.hands[p].length;
    if (node.k === 1) {
      out.fill(0, 0, n);
      const scale = 1 / (52 - node.board.length - 4);
      const q = (1 - p) as 0 | 1;
      const a1 = this.c1[p], a2 = this.c2[p];
      for (let i = 0; i < node.cards.length; i++) {
        const c = node.cards[i];
        const rp = this.chanceReach(reachP, p, c, B.r1);
        const ro = this.chanceReach(reachO, q, c, B.r2);
        const v = this.cfr(node.children[i], p, rp, ro, mode, d + 1);
        for (let h = 0; h < n; h++) if (a1[h] !== c && a2[h] !== c) out[h] += v[h] * scale;
      }
      return out;
    }
    const A = node.labels.length;
    const sig = B.sig;
    if (node.player === p) {
      this.strategyInto(node, mode === 2, sig);
      const vals = B.vals;
      const rp = B.r1;
      for (let a = 0; a < A; a++) {
        for (let h = 0; h < n; h++) rp[h] = reachP[h] * sig[a * n + h];
        const v = this.cfr(node.children[a], p, rp, reachO, mode, d + 1);
        vals.set(v.subarray(0, n), a * n);
      }
      if (mode === 1 && !node.locked) {
        for (let h = 0; h < n; h++) { let m = -Infinity; for (let a = 0; a < A; a++) m = Math.max(m, vals[a * n + h]); out[h] = m; }
        return out;
      }
      out.fill(0, 0, n);
      for (let a = 0; a < A; a++) for (let h = 0; h < n; h++) out[h] += sig[a * n + h] * vals[a * n + h];
      if (mode === 0 && !node.locked) {
        const R = node.regret, S = node.ssum, dp = this.dPos, dn = this.dNeg, ds = this.dStrat;
        for (let a = 0; a < A; a++) {
          for (let h = 0; h < n; h++) {
            const i = a * n + h;
            const r = R[i];
            R[i] = (r > 0 ? r * dp : r * dn) + vals[i] - out[h];
            S[i] = S[i] * ds + reachP[h] * sig[i];
          }
        }
      }
      return out;
    }
    this.strategyInto(node, mode !== 0, sig);
    const m = node.n;
    const acc = B.vals; // accumulate here, copy to out at end
    acc.fill(0, 0, n);
    const ro = B.r2;
    for (let a = 0; a < A; a++) {
      let any = false;
      for (let h = 0; h < m; h++) { const x = reachO[h] * sig[a * m + h]; ro[h] = x; if (x) any = true; }
      if (!any) {
        // Opponent never takes this action right now: values below are all zero, so skip the
        // showdown work and only keep the traverser's average strategy up to date.
        if (mode === 0) this.sumOnly(node.children[a], p, reachP, d + 1);
        continue;
      }
      const v = this.cfr(node.children[a], p, reachP, ro, mode, d + 1);
      for (let h = 0; h < n; h++) acc[h] += v[h];
    }
    out.set(acc.subarray(0, n));
    return out;
  }

  /** Training pass for a subtree the opponent cannot reach: discount regrets and add to strategy sums. */
  private sumOnly(node: TNode, p: 0 | 1, reachP: Float32Array, d: number) {
    if (node.k === 2) return;
    const n = this.hands[p].length;
    let any = false;
    for (let h = 0; h < n; h++) if (reachP[h]) { any = true; break; }
    if (!any) return;
    const B = this.buf(d);
    if (node.k === 1) {
      for (let i = 0; i < node.cards.length; i++) this.sumOnly(node.children[i], p, this.chanceReach(reachP, p, node.cards[i], B.r1), d + 1);
      return;
    }
    const A = node.labels.length;
    if (node.player !== p) {
      for (let a = 0; a < A; a++) this.sumOnly(node.children[a], p, reachP, d + 1);
      return;
    }
    const sig = this.strategyInto(node, false, B.sig);
    const rp = B.r1;
    for (let a = 0; a < A; a++) {
      for (let h = 0; h < n; h++) rp[h] = reachP[h] * sig[a * n + h];
      this.sumOnly(node.children[a], p, rp, d + 1);
    }
    if (node.locked) return;
    const R = node.regret, S = node.ssum, dp = this.dPos, dn = this.dNeg, ds = this.dStrat;
    for (let i = 0; i < A * n; i++) {
      const r = R[i];
      R[i] = r > 0 ? r * dp : r * dn;
      S[i] = S[i] * ds + reachP[i % n] * sig[i];
    }
  }

  private initReach(p: 0 | 1) {
    return Float32Array.from(this.hands[p], (h) => h.w);
  }

  /** Run one DCFR iteration (both players). */
  iterate() {
    const t = ++this.iteration;
    const { alpha, beta, gamma } = this.params;
    const ta = Math.pow(t, alpha);
    this.dPos = ta / (ta + 1);
    const tb = Math.pow(t, beta);
    this.dNeg = beta === -Infinity ? 0 : tb / (tb + 1);
    this.dStrat = Math.pow(t / (t + 1), gamma);
    for (const p of [0, 1] as const) this.cfr(this.root, p, this.initReach(p), this.initReach((1 - p) as 0 | 1), 0);
  }

  private matchupWeight() {
    const r0 = this.initReach(0), r1 = this.initReach(1);
    const out = new Float32Array(r0.length);
    this.blocked(0, r1, out, 1);
    let s = 0;
    for (let h = 0; h < r0.length; h++) s += r0[h] * out[h];
    return s;
  }

  /** Exploitability in bb and as % of the starting pot. */
  exploitability() {
    const W = this.matchupWeight();
    let total = 0;
    for (const p of [0, 1] as const) {
      const rp = this.initReach(p);
      const v = this.cfr(this.root, p, rp, this.initReach((1 - p) as 0 | 1), 1).slice(0, rp.length);
      let s = 0;
      for (let h = 0; h < v.length; h++) s += rp[h] * v[h];
      total += s / W;
    }
    const bb = total / 2;
    return { bb, pctPot: (bb / this.cfg.pot) * 100 };
  }

  // ---------- queries ----------
  private walk(path: number[]) {
    let node = this.root;
    const reach: [Float32Array, Float32Array] = [this.initReach(0), this.initReach(1)];
    for (const step of path) {
      if (node.k === 0) {
        const sig = this.strategy(node, true);
        const pl = node.player, n = node.n;
        for (let h = 0; h < n; h++) reach[pl][h] *= sig[step * n + h];
        node = node.children[step];
      } else if (node.k === 1) {
        const i = node.cards.indexOf(step);
        if (i < 0) throw new Error('Card not available');
        reach[0] = this.chanceReach(reach[0], 0, step);
        reach[1] = this.chanceReach(reach[1], 1, step);
        node = node.children[i];
      } else break;
    }
    return { node, reach };
  }

  private equityVec(board: number[], p: 0 | 1, reachO: Float32Array) {
    const n = this.hands[p].length;
    const q = (1 - p) as 0 | 1;
    const win = new Float32Array(n), lose = new Float32Array(n), tot = new Float32Array(n);
    const { list } = this.completions(board);
    const cs = new Float64Array(52);
    const hc1 = this.c1[p], hc2 = this.c2[p], oc1 = this.c1[q], oc2 = this.c2[q], same = this.same[p];
    for (const bd of list) {
      this.sweep(bd, p, reachO, win, 1, lose);
      cs.fill(0);
      let all = 0;
      for (const o of bd.sorted[q]) { const r = reachO[o]; if (r) { all += r; cs[oc1[o]] += r; cs[oc2[o]] += r; } }
      for (const h of bd.sorted[p]) {
        const sm = same[h];
        tot[h] += all - cs[hc1[h]] - cs[hc2[h]] + (sm >= 0 && bd.str[q][sm] >= 0 ? reachO[sm] : 0);
      }
    }
    const eq = new Float32Array(n);
    for (let h = 0; h < n; h++) {
      eq[h] = tot[h] > 1e-9 ? (win[h] + (tot[h] - win[h] - lose[h]) / 2) / tot[h] : NaN;
    }
    return eq;
  }

  query(path: number[]): NodeInfo {
    const { node, reach } = this.walk(path);
    const pot = this.cfg.pot + node.commit[0] + node.commit[1];
    const board = node.board;
    const equity: [Float32Array, Float32Array] = [this.equityVec(board, 0, reach[1]), this.equityVec(board, 1, reach[0])];
    const ev: [Float32Array, Float32Array] = [new Float32Array(0), new Float32Array(0)];
    const half = this.cfg.pot / 2;
    const norm = (p: 0 | 1, v: Float32Array) => {
      const b = new Float32Array(v.length);
      this.blocked(p, reach[1 - p], b, 1);
      return v.map((x, h) => (b[h] > 0 ? x / b[h] + half : NaN));
    };
    for (const p of [0, 1] as const) ev[p] = norm(p, this.cfr(node, p, reach[p], reach[1 - p], 2).slice(0, this.hands[p].length));
    const info: NodeInfo = { kind: node.k === 0 ? 'action' : node.k === 1 ? 'chance' : 'terminal', board, pot, commit: node.commit, reach, equity, ev };
    if (node.k === 0) {
      const p = node.player, n = node.n;
      info.player = p;
      info.labels = node.labels;
      info.amounts = node.amounts;
      info.strategy = this.strategy(node, true);
      const aev = new Float32Array(node.labels.length * n);
      node.children.forEach((child, a) => {
        const v = norm(p, this.cfr(child, p, reach[p], reach[1 - p], 2).slice(0, n));
        aev.set(v, a * n);
      });
      info.actionEv = aev;
      info.locked = !!node.locked;
    } else if (node.k === 1) info.cards = node.cards;
    else info.folder = node.folder;
    return info;
  }

  /** Equity of one hand of player p against an opponent reach vector, over all runouts. */
  private handEquity(board: number[], p: 0 | 1, h: number, reachO: Float32Array) {
    const q = (1 - p) as 0 | 1;
    const a = this.c1[p][h], b = this.c2[p][h];
    const oc1 = this.c1[q], oc2 = this.c2[q];
    let win = 0, tot = 0;
    for (const bd of this.completions(board).list) {
      const sh = bd.str[p][h];
      if (sh < 0) continue;
      const so = bd.str[q];
      for (let o = 0; o < so.length; o++) {
        const r = reachO[o];
        if (!r || so[o] < 0 || oc1[o] === a || oc1[o] === b || oc2[o] === a || oc2[o] === b) continue;
        tot += r;
        win += sh > so[o] ? r : sh === so[o] ? r / 2 : 0;
      }
    }
    return tot > 1e-12 ? win / tot : NaN;
  }

  /** Data behind a decision: range strength, the hand's standing, and how the opponent answers each action. */
  explain(path: number[], h: number): Explanation {
    const { node, reach } = this.walk(path);
    if (node.k !== 0) throw new Error('Not a decision');
    const p = node.player, q = (1 - p) as 0 | 1;
    const hand = this.hands[p][h];
    // opponent reach given the hero's own two cards
    const oppR = this.chanceReach(this.chanceReach(reach[q], q, hand.c1), q, hand.c2);
    const eqP = this.equityVec(node.board, p, reach[q]), eqQ = this.equityVec(node.board, q, reach[p]);
    const avg = (eq: Float32Array, r: Float32Array, pred?: (x: number) => boolean) => {
      let s = 0, w = 0;
      for (let i = 0; i < eq.length; i++) {
        if (!r[i] || !isFinite(eq[i])) continue;
        w += r[i];
        s += pred ? (pred(eq[i]) ? r[i] : 0) : eq[i] * r[i];
      }
      return w > 0 ? s / w : NaN;
    };
    const handEq = this.handEquity(node.board, p, h, oppR);
    let below = 0, all = 0;
    for (let i = 0; i < eqP.length; i++) if (reach[p][i] && isFinite(eqP[i])) { all += reach[p][i]; if (eqP[i] < eqP[h]) below += reach[p][i]; }
    const sig = this.strategy(node, true);
    const n = node.n;
    const strong = (x: number) => x >= 0.75, weak = (x: number) => x < 0.35;
    const toCall = node.commit[q] - node.commit[p];
    // action EVs for the hand (same normalisation as query)
    const half = this.cfg.pot / 2;
    const blk = new Float32Array(n);
    this.blocked(p, reach[q], blk, 1);
    const actions: ActionInsight[] = node.children.map((child, a) => {
      const v = this.cfr(child, p, reach[p], reach[q], 2);
      const ra = Float32Array.from(reach[p], (x, i) => x * sig[a * n + i]);
      let rs = 0, rt = 0;
      for (let i = 0; i < n; i++) { rs += ra[i]; rt += reach[p][i]; }
      const ins: ActionInsight = {
        label: node.labels[a], add: r2(node.amounts[a] - node.commit[p]),
        ev: blk[h] > 0 ? v[h] / blk[h] + half : NaN, freq: sig[a * n + h], rangeFreq: rt > 0 ? rs / rt : 0,
        strongShare: avg(eqP, ra, strong), weakShare: avg(eqP, ra, weak),
      };
      if (child.k === 0 && child.player === q) {
        const cs = this.strategy(child, true), m = child.n;
        const freqs = child.labels.map((_, b) => { let s = 0, w = 0; for (let o = 0; o < m; o++) { w += oppR[o]; s += oppR[o] * cs[b * m + o]; } return w > 0 ? s / w : 0; });
        ins.reply = { labels: child.labels, freqs };
        const fi = child.labels.indexOf('Fold');
        if (fi >= 0) {
          const cont = Float32Array.from(oppR, (x, o) => x * (1 - cs[fi * m + o]));
          const fold = Float32Array.from(oppR, (x, o) => x * cs[fi * m + o]);
          ins.eqVsContinue = this.handEquity(node.board, p, h, cont);
          ins.eqVsFold = this.handEquity(node.board, p, h, fold);
        }
      }
      return ins;
    });
    const nb = node.board.length;
    return {
      player: p, pot: this.cfg.pot + node.commit[0] + node.commit[1], toCall: r2(toCall), board: node.board,
      street: nb === 3 ? 'flop' : nb === 4 ? 'turn' : 'river', hand: [hand.c1, hand.c2],
      handEq, handPercentile: all > 0 ? below / all : NaN,
      rangeEq: [avg(eqP, reach[p]), avg(eqQ, reach[q])],
      strongShare: [avg(eqP, reach[p], strong), avg(eqQ, reach[q], strong)],
      actions,
    };
  }

  describe() {
    return `${this.cfg.board.map(cardStr).join(' ')} pot ${this.cfg.pot} stack ${this.cfg.stack}`;
  }
}

export function defaultSizes(): SolverConfig['sizes'] {
  const s = (bet: number[], raise: number[]): StreetSizes => ({ bet, raise });
  return {
    flop: [s([0.33, 0.75], [0.6]), s([0.33, 0.75], [0.6])],
    turn: [s([0.66], [0.6]), s([0.66], [0.6])],
    river: [s([0.75], [0.6]), s([0.75], [0.6])],
  };
}
