// Full-hand practice: deal a hand, play preflop against the preflop model, then
// play each postflop street against a strategy that is re-solved for that street
// from both players' actual ranges at that point (depth-limited re-solving).
import { HAND_CLASSES, classCombos, classOf, comboId, comboStr, CLASS_INDEX, rng as mkRng } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { POSITIONS, type Pos, type HistItem, stateAfter, presetSpots } from '../engine/preflop';
import type { Range } from '../engine/range';
import { SolverClient } from '../solver/client';
import type { NodeInfo, SolverConfig } from '../solver/solver';
import type { PlayPrefs, PlayRecord } from '../store/userData';

export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export const GRADE_LABEL: Record<Grade, string> = { best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };
export const GRADE_TAG: Record<Grade, string> = { best: 'good', good: 'ok', inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'mistake' };

export interface LogEntry { street: string; who: string; text: string; grade?: Grade; evLoss?: number }
export interface StrategyGrid { labels: string[]; strat: number[][]; reach: number[]; heroClass: number }
export interface PendingDecision { labels: string[]; freqs: number[]; evs?: number[]; pot: number; rng: number; street: string; grid?: StrategyGrid }
export interface SeatState { folded: boolean; action: string; bet: number; stack: number }
export interface ReplaySeed { seed: number; prefs: PlayPrefs }
export interface Feedback extends PendingDecision { chosen: number; grade: Grade; evLoss: number; rngPick: number }

const STREET = (n: number) => (n === 0 ? 'Preflop' : n === 3 ? 'Flop' : n === 4 ? 'Turn' : 'River');
const BLIND: Partial<Record<Pos, number>> = { SB: 0.5, BB: 1 };

function sizesFor(mode: PlayPrefs['sizing']): SolverConfig['sizes'] {
  const s = (bet: number[], raise: number[]) => ({ bet, raise });
  if (mode === 'simple') {
    return { flop: [s([0.33], [0.75]), s([0.33], [0.75])], turn: [s([0.66], [0.75]), s([0.66], [0.75])], river: [s([0.75], [0.75]), s([0.75], [0.75])] };
  }
  return {
    flop: [s([0.33, 0.75], [0.6]), s([0.33, 0.75], [0.6])],
    turn: [s([0.5, 1], [0.6]), s([0.5, 1], [0.6])],
    river: [s([0.5, 1], [0.6]), s([0.5, 1], [0.6])],
  };
}

function rangeToWeights(r: Range): number[] {
  const w = new Array(1326).fill(0);
  r.forEach((x, i) => { if (x > 0) for (const [a, b] of classCombos(HAND_CLASSES[i])) w[comboId(a, b)] = x; });
  return w;
}

function pickFromRange(r: Range, dead: number[], rand: () => number): [number, number] {
  const opts: { c: [number, number]; w: number }[] = [];
  r.forEach((x, i) => { if (x > 0) for (const c of classCombos(HAND_CLASSES[i])) if (!dead.includes(c[0]) && !dead.includes(c[1])) opts.push({ c, w: x }); });
  let t = rand() * opts.reduce((s, o) => s + o.w, 0);
  for (const o of opts) { t -= o.w; if (t <= 0) return o.c; }
  return opts[opts.length - 1].c;
}

export function gradeFor(evLoss: number, pot: number, freq: number): Grade {
  const rel = evLoss / Math.max(1, pot);
  if (evLoss < 0.01 || freq >= 0.5) return 'best';
  if (rel < 0.02 || freq >= 0.15) return 'good';
  if (rel < 0.06) return 'inaccuracy';
  if (rel < 0.15) return 'mistake';
  return 'blunder';
}

export class PlayHand {
  status: 'solving' | 'hero' | 'feedback' | 'done' | 'error' = 'solving';
  statusText = 'Dealing…';
  error = '';
  log: LogEntry[] = [];
  pending: PendingDecision | null = null;
  feedback: Feedback | null = null;
  heroPos: Pos = 'BTN';
  villainPos: Pos | null = null;
  holes = new Map<Pos, [number, number]>();
  runout: number[] = [];
  boardShown = 0;
  pot = 0;
  contrib = new Map<Pos, number>();
  result: { net: number; text: string; showdown: boolean } | null = null;
  spotName = '';
  evLoss = 0;
  decisions = 0;
  bestCount = 0;
  readonly seed: number;
  private rand: () => number;
  seats = new Map<Pos, SeatState>();
  private hist: HistItem[] = [];
  private resolve: ((a: number) => void) | null = null;
  // postflop state
  private heroSide: 0 | 1 = 0;
  private stack = 100;
  private path: number[] = [];
  private onChange: () => void;
  private client: SolverClient;
  private prefs: PlayPrefs;

  constructor(prefs: PlayPrefs, client: SolverClient, onChange: () => void, seed?: number) {
    this.seed = seed ?? ((Math.random() * 2 ** 31) | 0);
    this.rand = mkRng(this.seed);
    for (const p of POSITIONS) this.seats.set(p, { folded: false, action: '', bet: BLIND[p] ?? 0, stack: 100 - (BLIND[p] ?? 0) });
    this.prefs = { ...prefs };
    this.client = client;
    this.onChange = onChange;
  }

  get heroCards() { return this.holes.get(this.heroPos)!; }
  get villainCards() { return this.villainPos ? this.holes.get(this.villainPos) : undefined; }
  get board() { return this.runout.slice(0, this.boardShown); }

  private changed() { this.onChange(); }
  private add(e: LogEntry) { this.log.push(e); this.changed(); }
  private seat(p: Pos, patch: Partial<SeatState>) { this.seats.set(p, { ...this.seats.get(p)!, ...patch }); }
  get settings() { return this.prefs; }

  private dealAll(fixed: Partial<Record<Pos, [number, number]>> = {}) {
    const used = new Set<number>();
    for (const c of Object.values(fixed)) { used.add(c![0]); used.add(c![1]); }
    const draw = () => { let c: number; do { c = (this.rand() * 52) | 0; } while (used.has(c)); used.add(c); return c; };
    for (const p of POSITIONS) this.holes.set(p, fixed[p] ?? [draw(), draw()]);
    this.runout = [draw(), draw(), draw(), draw(), draw()];
  }

  /** Waits for the hero's choice (or auto-plays obvious ones). */
  private async heroDecision(d: PendingDecision): Promise<number> {
    const max = Math.max(...d.freqs);
    if (this.prefs.autoObvious && max >= 0.95) {
      const a = d.freqs.indexOf(max);
      this.add({ street: d.street, who: 'You', text: `${d.labels[a]} (auto, ${Math.round(max * 100)}% play)` });
      return a;
    }
    this.pending = d;
    this.status = 'hero';
    this.changed();
    const a = await new Promise<number>((r) => { this.resolve = r; });
    return a;
  }

  /** Called by the UI when the hero picks an action. */
  choose(a: number) {
    const d = this.pending;
    if (!d || this.status !== 'hero') return;
    const best = d.evs ? Math.max(...d.evs.filter(isFinite)) : 0;
    const evLoss = d.evs && isFinite(d.evs[a]) ? Math.max(0, best - d.evs[a]) : 0;
    const maxF = Math.max(...d.freqs);
    // Preflop has no EVs: grade by how often the model takes the action
    const grade = d.evs ? gradeFor(evLoss, d.pot, d.freqs[a]) : d.freqs[a] >= maxF - 1e-6 || d.freqs[a] >= 0.5 ? 'best' : d.freqs[a] >= 0.15 ? 'good' : d.freqs[a] >= 0.04 ? 'inaccuracy' : d.freqs[a] > 0 ? 'mistake' : 'blunder';
    let acc = 0, rngPick = d.freqs.length - 1;
    for (let k = 0; k < d.freqs.length; k++) { acc += d.freqs[k] * 100; if (d.rng <= acc) { rngPick = k; break; } }
    this.feedback = { ...d, chosen: a, grade, evLoss, rngPick };
    this.decisions++;
    this.evLoss += evLoss;
    if (grade === 'best') this.bestCount++;
    this.add({ street: d.street, who: 'You', text: d.labels[a], grade, evLoss });
    this.pending = null;
    this.status = 'feedback';
    this.changed();
  }

  /** Called by the UI after reading feedback. */
  proceed() {
    if (this.status !== 'feedback' || !this.resolve || !this.feedback) return;
    const r = this.resolve;
    this.resolve = null;
    const a = this.feedback.chosen;
    this.feedback = null;
    this.status = 'solving';
    this.changed();
    r(a);
  }

  async run() {
    try {
      const p = this.prefs;
      if (p.start === 'preflop') await this.playPreflop();
      else await this.startFromPreset(p.start);
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
      this.changed();
    }
  }

  // ---------- preflop ----------
  private async playPreflop() {
    const p = this.prefs;
    this.heroPos = (p.heroPos !== 'random' && POSITIONS.includes(p.heroPos as Pos) ? p.heroPos : POSITIONS[(this.rand() * 6) | 0]) as Pos;
    this.dealAll();
    this.spotName = `6-max from preflop, you are ${this.heroPos}`;
    for (const pos of POSITIONS) this.contrib.set(pos, BLIND[pos] ?? 0);
    this.add({ street: 'Preflop', who: 'Dealer', text: `You are ${this.heroPos} with ${comboStr(...this.heroCards)}` });
    for (;;) {
      const st = stateAfter(this.hist);
      if (st.kind === 'end') {
        if (!st.flop) return this.finishPreflop(st.summary);
        if (st.flop.oop !== this.heroPos && st.flop.ip !== this.heroPos) return this.finishPreflop(st.summary);
        this.villainPos = st.flop.oop === this.heroPos ? st.flop.ip : st.flop.oop;
        for (const pos of POSITIONS) if (pos !== this.heroPos && pos !== this.villainPos) this.seat(pos, { folded: true });
        this.heroSide = st.flop.oop === this.heroPos ? 0 : 1;
        this.pot = st.flop.pot;
        this.stack = st.flop.stack;
        const w: [number[], number[]] = [rangeToWeights(st.flop.oopRange), rangeToWeights(st.flop.ipRange)];
        return this.playPostflop(w, 3);
      }
      const sp = st.spot;
      const cards = this.holes.get(sp.hero)!;
      const cls = CLASS_INDEX.get(classOf(cards[0], cards[1]))!;
      const freqs = sp.strat[cls];
      let a: number;
      if (sp.hero === this.heroPos) {
        const potNow = [...this.contrib.values()].reduce((s, x) => s + x, 0);
        a = await this.heroDecision({ labels: sp.actions.map((x) => x.label), freqs, pot: potNow, rng: 1 + Math.floor(this.rand() * 100), street: 'Preflop', grid: { labels: sp.actions.map((x) => x.label), strat: sp.strat, reach: sp.reach, heroClass: cls } });
      } else {
        a = this.sample(freqs);
        if (sp.actions[a].kind !== 'fold' || this.hist.some((h) => h.action > 0)) this.add({ street: 'Preflop', who: sp.hero, text: sp.actions[a].label });
      }
      const act = sp.actions[a];
      if (act.kind !== 'fold') this.contrib.set(sp.hero, act.amount);
      this.seat(sp.hero, act.kind === 'fold' ? { folded: true, action: 'Fold' } : { action: act.label, bet: act.amount, stack: 100 - act.amount });
      this.hist.push({ pos: sp.hero, action: a, label: act.label });
      if (act.kind === 'fold' && sp.hero === this.heroPos) return this.finishPreflop('You fold.');
    }
  }

  private finishPreflop(summary: string) {
    const pot = [...this.contrib.values()].reduce((s, x) => s + x, 0);
    const heroIn = this.contrib.get(this.heroPos) ?? 0;
    // all-in and called preflop: run it out
    const allin = this.hist.filter((h) => /All-in/.test(h.label)).length > 0 && /All-in and called/.test(summary);
    if (allin) {
      const players = POSITIONS.filter((p) => (this.contrib.get(p) ?? 0) >= 100);
      this.boardShown = 5;
      const scores = players.map((p) => evaluate([...this.holes.get(p)!, ...this.runout]));
      const best = Math.max(...scores);
      const winners = players.filter((_, i) => scores[i] === best);
      this.villainPos = players.find((p) => p !== this.heroPos) ?? null;
      const won = winners.includes(this.heroPos) ? pot / winners.length : 0;
      return this.end(won - heroIn, `${summary} ${winners.includes(this.heroPos) ? (winners.length > 1 ? 'Split pot.' : 'You win.') : 'You lose.'}`, true);
    }
    const opener = this.hist.find((h) => h.action > 0);
    const heroWon = summary.includes(`${this.heroPos} wins`) || (/Everyone folds/.test(summary) && opener?.pos === this.heroPos) || (/BB wins the blinds/.test(summary) && this.heroPos === 'BB');
    return this.end((heroWon ? pot : 0) - heroIn, summary, false);
  }

  private sample(freqs: ArrayLike<number>) {
    let x = this.rand();
    for (let k = 0; k < freqs.length - 1; k++) { x -= freqs[k]; if (x <= 0) return k; }
    return freqs.length - 1;
  }

  // ---------- presets ----------
  private async startFromPreset(name: string) {
    const ps = presetSpots().find((s) => s.name === name) ?? presetSpots()[0];
    this.spotName = ps.name;
    const side: 0 | 1 = this.prefs.heroSide === 'oop' ? 0 : this.prefs.heroSide === 'ip' ? 1 : this.rand() < 0.5 ? 0 : 1;
    this.heroSide = side;
    this.heroPos = side === 0 ? ps.oop : ps.ip;
    this.villainPos = side === 0 ? ps.ip : ps.oop;
    const heroC = pickFromRange(side === 0 ? ps.oopRange : ps.ipRange, [], this.rand);
    const villC = pickFromRange(side === 0 ? ps.ipRange : ps.oopRange, heroC, this.rand);
    this.dealAll({ [this.heroPos]: heroC, [this.villainPos]: villC });
    this.pot = ps.pot;
    this.stack = ps.stack;
    const inv = (100 - ps.stack);
    for (const pos of POSITIONS) {
      this.contrib.set(pos, pos === this.heroPos || pos === this.villainPos ? inv : BLIND[pos] ?? 0);
      const inHand = pos === this.heroPos || pos === this.villainPos;
      this.seat(pos, { folded: !inHand, action: inHand ? '' : 'Fold', bet: 0, stack: 100 - (inHand ? inv : BLIND[pos] ?? 0) });
    }
    this.add({ street: 'Preflop', who: 'Dealer', text: `${ps.name}. You are ${this.heroPos} with ${comboStr(...heroC)}` });
    await this.playPostflop([rangeToWeights(ps.oopRange), rangeToWeights(ps.ipRange)], 3);
  }

  // ---------- postflop ----------
  private async playPostflop(w: [number[], number[]], n: 3 | 4 | 5): Promise<void> {
    const hero = this.heroSide, vill = (1 - hero) as 0 | 1;
    const hc = this.heroCards, vc = this.villainCards!;
    // the hero's actual hand is always kept in their range, even after an off-strategy play
    const hid = comboId(hc[0], hc[1]);
    w[hero][hid] = Math.max(w[hero][hid], 0.002);
    w[vill][comboId(vc[0], vc[1])] = Math.max(w[vill][comboId(vc[0], vc[1])], 0.002);
    this.boardShown = n;
    const board = this.runout.slice(0, n);
    const streetStack = this.stack;
    for (const pos of [this.heroPos, this.villainPos!]) this.seat(pos, { bet: 0, action: '', stack: streetStack });
    this.add({ street: STREET(n), who: 'Dealer', text: `${STREET(n)} dealt. Pot ${this.pot.toFixed(1)}bb, ${this.stack.toFixed(1)}bb behind.` });
    const cfg: SolverConfig = {
      board, pot: this.pot, stack: this.stack, ranges: [new Array(169).fill(0), new Array(169).fill(0)], weights: w,
      sizes: sizesFor(this.prefs.sizing), maxRaises: this.prefs.sizing === 'simple' ? 1 : 2, allIn: true, allInThreshold: 0.67, lastStreet: n,
    };
    this.status = 'solving';
    this.statusText = `Solving the ${STREET(n).toLowerCase()}…`;
    this.changed();
    const fast = this.prefs.accuracy === 'fast';
    await this.client.solveAsync(cfg, fast ? 120 : 300, fast ? 1.5 : 0.6);
    const hands = this.client.hands!;
    const find = (p: 0 | 1, c: [number, number]) => hands[p].findIndex((h) => (h.c1 === c[0] && h.c2 === c[1]) || (h.c1 === c[1] && h.c2 === c[0]));
    const hi = find(hero, hc), vi = find(vill, vc);
    if (hi < 0 || vi < 0) throw new Error('Hand missing from range');
    this.path = [];
    const names = [hero === 0 ? 'You' : this.villainPos!, hero === 1 ? 'You' : this.villainPos!];
    for (;;) {
      const info: NodeInfo = await this.client.query(this.path);
      if (info.kind === 'terminal') {
        const commit = info.commit;
        const heroCommit = commit[hero];
        this.contrib.set(this.heroPos, (this.contrib.get(this.heroPos) ?? 0) + heroCommit);
        this.contrib.set(this.villainPos!, (this.contrib.get(this.villainPos!) ?? 0) + commit[vill]);
        const totalPot = this.pot + commit[0] + commit[1];
        const heroIn = this.contrib.get(this.heroPos)!;
        if (info.folder! >= 0) {
          const heroWon = info.folder !== hero;
          const uncalled = Math.abs(commit[0] - commit[1]);
          return this.end((heroWon ? totalPot : 0) - heroIn, heroWon ? `${this.villainPos} folds. You win a ${(totalPot - uncalled).toFixed(1)}bb pot.` : 'You fold.', false);
        }
        const allin = Math.max(...commit) >= this.stack - 1e-6;
        if (allin || n === 5) {
          this.boardShown = 5;
          const hs = evaluate([...hc, ...this.runout]), vs = evaluate([...vc, ...this.runout]);
          const share = hs > vs ? 1 : hs === vs ? 0.5 : 0;
          return this.end(share * totalPot - heroIn, `Showdown: ${share === 1 ? 'you win' : share === 0 ? 'you lose' : 'split pot'} (${totalPot.toFixed(1)}bb pot).`, true);
        }
        // next street: carry both players' ranges forward exactly
        const next: [number[], number[]] = [new Array(1326).fill(0), new Array(1326).fill(0)];
        for (const p of [0, 1] as const) hands[p].forEach((h, i) => { next[p][comboId(h.c1, h.c2)] = info.reach[p][i]; });
        this.pot = totalPot;
        this.stack -= commit[0];
        return this.playPostflop(next, (n + 1) as 4 | 5);
      }
      if (info.kind !== 'action') throw new Error('Unexpected node');
      const pl = info.player!;
      const nn = hands[pl].length;
      const idx = pl === hero ? hi : vi;
      const freqs = info.labels!.map((_, a) => info.strategy![a * nn + idx]);
      let a: number;
      if (pl === hero) {
        const evs = info.labels!.map((_, k) => info.actionEv![k * nn + idx]);
        a = await this.heroDecision({ labels: info.labels!, freqs, evs, pot: info.pot, rng: 1 + Math.floor(this.rand() * 100), street: STREET(n), grid: gridFrom(info, hands[pl], hc) });
      } else {
        a = this.sample(freqs);
        this.add({ street: STREET(n), who: names[pl], text: info.labels![a] });
      }
      const pos = pl === hero ? this.heroPos : this.villainPos!;
      const amt = info.amounts![a];
      this.seat(pos, { action: info.labels![a].replace(/ \(\d+%\)/, ''), bet: amt, stack: streetStack - amt, folded: info.labels![a] === 'Fold' });
      this.path.push(a);
    }
  }

  private end(net: number, text: string, showdown: boolean) {
    this.result = { net: Math.round(net * 100) / 100, text, showdown };
    this.status = 'done';
    this.pending = null;
    this.add({ street: 'Result', who: 'Dealer', text });
  }

  record(): PlayRecord {
    return {
      t: Date.now(), spot: this.spotName, hero: this.heroPos, heroCards: [...this.heroCards], villainCards: this.villainCards ? [...this.villainCards] : [],
      board: this.board, runout: [...this.runout], seed: this.seed, prefs: { ...this.prefs }, net: this.result?.net ?? 0, evLoss: Math.round(this.evLoss * 100) / 100, decisions: this.decisions, log: this.log.map((l) => ({ ...l })),
    };
  }
}


/** Reach-weighted strategy per hand class for the acting player at a solver node. */
function gridFrom(info: NodeInfo, hands: { c1: number; c2: number; cls: number }[], hero: [number, number]): StrategyGrid {
  const p = info.player!, n = hands.length, A = info.labels!.length;
  const reach = new Array(169).fill(0), possible = new Array(169).fill(0);
  const strat = Array.from({ length: 169 }, () => new Array(A).fill(0));
  for (let h = 0; h < n; h++) {
    const c = hands[h].cls, r = info.reach[p][h];
    possible[c]++;
    if (r <= 0) continue;
    reach[c] += r;
    for (let a = 0; a < A; a++) strat[c][a] += r * info.strategy![a * n + h];
  }
  for (let c = 0; c < 169; c++) if (reach[c] > 0) for (let a = 0; a < A; a++) strat[c][a] /= reach[c];
  return { labels: info.labels!, strat, reach: reach.map((r, c) => (possible[c] ? Math.min(1, r / possible[c]) : 0)), heroClass: CLASS_INDEX.get(classOf(hero[0], hero[1]))! };
}
