// Parser for PokerStars-style No Limit Hold'em cash hand histories, plus a review of the
// hero's decisions against Rivermind's preflop model and equity on later streets.
import { parseCards, classOf, CLASS_INDEX } from './cards';
import { POSITIONS, type Pos, spot, stateAfter, type HistItem, rangeOf } from './preflop';
import { expandRange, type Range } from './range';
import { handVsRangeEquity } from './equity';

export interface HHAction { street: 'preflop' | 'flop' | 'turn' | 'river'; player: string; kind: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount: number; to: number; allIn: boolean }
export interface ParsedHand {
  id: string;
  bb: number;
  players: { name: string; seat: number; stack: number; pos: Pos }[];
  hero: string;
  heroCards: number[];
  board: number[];
  actions: HHAction[];
  heroNet?: number;
  raw: string;
}

const money = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ''));

function positionsFor(n: number): Pos[] {
  // in seat order starting with the small blind
  const map: Record<number, Pos[]> = {
    2: ['SB', 'BB'],
    3: ['SB', 'BB', 'BTN'],
    4: ['SB', 'BB', 'CO', 'BTN'],
    5: ['SB', 'BB', 'HJ', 'CO', 'BTN'],
    6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
  };
  return map[Math.min(6, Math.max(2, n))];
}

export function splitHands(text: string): string[] {
  return text.split(/\n\s*\n\s*\n|(?=PokerStars Hand #)|(?=PokerStars Zoom Hand #)/).map((s) => s.trim()).filter((s) => /Hand #/.test(s));
}

export function parseHand(raw: string): ParsedHand {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const id = raw.match(/Hand #(\d+)/)?.[1] ?? '?';
  const blinds = raw.match(/\(\s*[$€£]?([0-9.]+)\s*\/\s*[$€£]?([0-9.]+)/);
  const bb = blinds ? parseFloat(blinds[2]) : 1;
  const button = parseInt(raw.match(/Seat #(\d+) is the button/)?.[1] ?? '0', 10);
  const seats: { name: string; seat: number; stack: number }[] = [];
  for (const l of lines) {
    const m = l.match(/^Seat (\d+): (.+?) \(([$€£]?[0-9.,]+) in chips/);
    if (m && !/SUMMARY/.test(l)) seats.push({ seat: +m[1], name: m[2], stack: money(m[3]) / bb });
    if (/\*\*\* SUMMARY/.test(l)) break;
  }
  // order seats starting after the button
  seats.sort((a, b) => a.seat - b.seat);
  const bi = seats.findIndex((s) => s.seat === button);
  const ordered = [...seats.slice(bi + 1), ...seats.slice(0, bi + 1)];
  if (seats.length === 2) ordered.reverse(); // heads-up: button is the small blind
  const pos = positionsFor(ordered.length);
  const players = ordered.map((s, i) => ({ ...s, pos: pos[i] }));
  const dealt = raw.match(/Dealt to (.+?) \[(.+?)\]/);
  const hero = dealt?.[1] ?? '';
  const heroCards = dealt ? parseCards(dealt[2]) : [];
  let street: HHAction['street'] = 'preflop';
  const board: number[] = [];
  const actions: HHAction[] = [];
  const committed = new Map<string, number>();
  let heroNet: number | undefined;
  let heroInvested = 0;
  for (const l of lines) {
    const sm = l.match(/^\*\*\* (FLOP|TURN|RIVER) \*\*\*.*\[([^\]]+)\]\s*$/);
    if (sm) {
      street = sm[1].toLowerCase() as HHAction['street'];
      const cards = parseCards(sm[2]);
      for (const c of cards) if (!board.includes(c)) board.push(c);
      committed.clear();
      continue;
    }
    if (/^\*\*\* SUMMARY/.test(l)) break;
    const post = l.match(/^(.+?): posts (?:small|big) blind [$€£]?([0-9.]+)/);
    if (post) {
      committed.set(post[1], money(post[2]) / bb);
      if (post[1] === hero) heroInvested += money(post[2]) / bb;
      continue;
    }
    const am = l.match(/^(.+?): (folds|checks|calls|bets|raises)\s*([$€£]?[0-9.]+)?(?: to [$€£]?([0-9.]+))?(.*all-in)?/);
    if (am) {
      const player = am[1];
      const verb = am[2];
      const kind = (verb === 'folds' ? 'fold' : verb === 'checks' ? 'check' : verb === 'calls' ? 'call' : verb === 'bets' ? 'bet' : 'raise') as HHAction['kind'];
      const amt = am[3] ? money(am[3]) / bb : 0;
      const prev = committed.get(player) ?? 0;
      const to = kind === 'raise' && am[4] ? money(am[4]) / bb : kind === 'call' || kind === 'bet' ? prev + amt : prev;
      if (player === hero) heroInvested += to - prev;
      committed.set(player, to);
      actions.push({ street, player, kind, amount: amt, to, allIn: !!am[5] });
      continue;
    }
    const ret = l.match(/^Uncalled bet \(([$€£]?[0-9.]+)\) returned to (.+)$/);
    if (ret && ret[2] === hero) heroInvested -= money(ret[1]) / bb;
    const col = l.match(/^(.+?) collected [$€£]?([0-9.]+)/);
    if (col && col[1] === hero) heroNet = (heroNet ?? 0) + money(col[2]) / bb;
  }
  heroNet = (heroNet ?? 0) - heroInvested;
  return { id, bb, players, hero, heroCards, board, actions, heroNet: Math.round(heroNet * 100) / 100, raw };
}

export interface Decision {
  street: HHAction['street'];
  description: string;
  heroAction: string;
  /** For preflop: model frequency of the action hero took. */
  freq?: number;
  best?: string;
  equity?: number;
  potOdds?: number;
  grade: 'good' | 'ok' | 'inaccuracy' | 'mistake' | 'info';
  note: string;
}

export interface HandReview { hand: ParsedHand; heroPos?: Pos; heroClass?: string; decisions: Decision[]; covered: boolean }

const gradeOf = (f: number): Decision['grade'] => (f >= 0.5 ? 'good' : f >= 0.15 ? 'ok' : f >= 0.04 ? 'inaccuracy' : 'mistake');

export function reviewHand(h: ParsedHand): HandReview {
  const decisions: Decision[] = [];
  const heroP = h.players.find((p) => p.name === h.hero);
  if (!heroP || h.heroCards.length !== 2) return { hand: h, decisions, covered: false };
  const cls = classOf(h.heroCards[0], h.heroCards[1]);
  const ci = CLASS_INDEX.get(cls)!;
  const posOf = (name: string) => h.players.find((p) => p.name === name)?.pos;
  // Map preflop actions onto the model tree
  const hist: HistItem[] = [];
  let covered = h.players.length === 6;
  let villainRange: Range | null = null;
  let villain: string | null = null;
  const pre = h.actions.filter((a) => a.street === 'preflop');
  for (const a of pre) {
    const st = stateAfter(hist);
    const p = posOf(a.player)!;
    if (st.kind === 'end' && a.kind === 'fold') continue;
    if (st.kind !== 'decision' || st.spot.hero !== p) {
      covered = false;
      break;
    }
    const s = st.spot;
    const want = a.kind === 'fold' ? 'fold' : a.kind === 'call' ? 'call' : a.allIn || a.to >= 90 ? (s.actions.some((x) => x.kind === 'allin') ? 'allin' : 'raise') : 'raise';
    let idx = s.actions.findIndex((x) => x.kind === want);
    if (idx < 0 && want === 'allin') idx = s.actions.findIndex((x) => x.kind === 'raise');
    if (idx < 0 && want === 'raise') idx = s.actions.findIndex((x) => x.kind === 'allin');
    if (idx < 0) { covered = false; break; }
    if (a.player === h.hero) {
      const row = s.strat[ci];
      const f = row[idx];
      const bestIdx = row.indexOf(Math.max(...row));
      decisions.push({
        street: 'preflop',
        description: s.title,
        heroAction: s.actions[idx].label,
        freq: f,
        best: s.actions.map((x, k) => `${x.label} ${Math.round(row[k] * 100)}%`).join(', '),
        grade: gradeOf(f),
        note: f >= 0.5 ? 'Matches the model\'s main play.' : f >= 0.15 ? 'A mixed play in the model.' : `The model prefers ${s.actions[bestIdx].label}.`,
      });
    } else if (a.kind !== 'fold') {
      villain = a.player;
      villainRange = rangeOf(s, idx);
    }
    hist.push({ pos: p, action: idx, label: s.actions[idx].label });
  }
  if (!covered && decisions.length === 0) {
    decisions.push({ street: 'preflop', description: 'Preflop line', heroAction: '-', grade: 'info', note: 'This preflop line (limps, multiway pots, or a non 6-max table) is outside the 6-max model, so it was not graded.' });
  }
  // Postflop: equity vs villain's modeled range when hero faces a bet or bets
  const st = stateAfter(hist);
  if (st.kind === 'end' && st.flop && villain) {
    const vr = st.flop.oop === posOf(villain) ? st.flop.oopRange : st.flop.ipRange;
    villainRange = vr;
  }
  if (villainRange && h.board.length >= 3) {
    const commits = new Map<string, number>();
    for (const a of pre) commits.set(a.player, Math.max(commits.get(a.player) ?? 0, a.to));
    let pot = [...commits.values()].reduce((s, x) => s + x, 0);
    const vCombos = expandRange(villainRange, [...h.heroCards]);
    for (const street of ['flop', 'turn', 'river'] as const) {
      const n = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
      if (h.board.length < n) break;
      const board = h.board.slice(0, n);
      const acts = h.actions.filter((a) => a.street === street);
      if (!acts.length) continue;
      const eq = handVsRangeEquity(h.heroCards[0], h.heroCards[1], vCombos.filter((c) => !board.includes(c.c1) && !board.includes(c.c2)), board, 800);
      const sc = new Map<string, number>();
      let maxBet = 0;
      for (const a of acts) {
        if (a.player === h.hero && (a.kind === 'call' || a.kind === 'fold')) {
          const toCall = maxBet - (sc.get(h.hero) ?? 0);
          const curPot = pot + [...sc.values()].reduce((s, x) => s + x, 0);
          const odds = toCall / (curPot + toCall);
          const short = eq < odds;
          decisions.push({
            street, description: `Facing ${toCall.toFixed(1)}bb into ${curPot.toFixed(1)}bb`, heroAction: a.kind === 'call' ? 'Call' : 'Fold',
            equity: eq, potOdds: odds,
            grade: a.kind === 'call' ? (short && eq < odds - 0.1 ? 'inaccuracy' : 'info') : !short && eq > odds + 0.15 ? 'inaccuracy' : 'info',
            note: a.kind === 'call'
              ? short ? `Raw equity ${(eq * 100).toFixed(0)}% is below the ${(odds * 100).toFixed(0)}% the price needs. The call relies on improving or on future bluffs.` : `Equity ${(eq * 100).toFixed(0)}% covers the ${(odds * 100).toFixed(0)}% needed.`
              : !short ? `Folded with ${(eq * 100).toFixed(0)}% equity when ${(odds * 100).toFixed(0)}% was enough. Check whether the opponent's range is really this strong.` : `Fold is consistent: ${(eq * 100).toFixed(0)}% equity vs ${(odds * 100).toFixed(0)}% needed.`,
          });
        } else if (a.player === h.hero) {
          decisions.push({ street, description: `${street[0].toUpperCase() + street.slice(1)} action`, heroAction: a.kind[0].toUpperCase() + a.kind.slice(1) + (a.to ? ` ${a.to.toFixed(1)}` : ''), equity: eq, grade: 'info', note: `Equity vs the modeled range: ${(eq * 100).toFixed(0)}%.` });
        }
        if (a.kind === 'bet' || a.kind === 'raise' || a.kind === 'call') sc.set(a.player, a.to);
        maxBet = Math.max(maxBet, a.to);
      }
      pot += [...sc.values()].reduce((s, x) => s + x, 0);
    }
  }
  return { hand: h, heroPos: heroP.pos, heroClass: cls, decisions, covered };
}

export const POSITIONS_LIST = POSITIONS;
export { spot };

export const SAMPLE_HH = `PokerStars Hand #250000000001:  Hold'em No Limit ($0.50/$1.00 USD) - 2026/11/20 20:15:01 ET
Table 'Practice I' 6-max Seat #4 is the button
Seat 1: Villain1 ($100 in chips)
Seat 2: Villain2 ($100 in chips)
Seat 3: Villain3 ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: Villain5 ($100 in chips)
Seat 6: Villain6 ($100 in chips)
Villain5: posts small blind $0.50
Villain6: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Jh]
Villain1: folds
Villain2: folds
Villain3: folds
Hero: raises $1.50 to $2.50
Villain5: folds
Villain6: calls $1.50
*** FLOP *** [Kh 7h 2c]
Villain6: checks
Hero: bets $2
Villain6: raises $5 to $7
Hero: calls $5
*** TURN *** [Kh 7h 2c] [9s]
Villain6: bets $11
Hero: calls $11
*** RIVER *** [Kh 7h 2c 9s] [4d]
Villain6: bets $30
Hero: folds
Uncalled bet ($30) returned to Villain6
Villain6 collected $41.50 from pot
*** SUMMARY ***
Total pot $41.50 | Rake $0
Board [Kh 7h 2c 9s 4d]

PokerStars Hand #250000000002:  Hold'em No Limit ($0.50/$1.00 USD) - 2026/11/20 20:16:12 ET
Table 'Practice I' 6-max Seat #5 is the button
Seat 1: Villain1 ($100 in chips)
Seat 2: Villain2 ($100 in chips)
Seat 3: Villain3 ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: Villain5 ($100 in chips)
Seat 6: Villain6 ($100 in chips)
Villain6: posts small blind $0.50
Villain1: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Kd 9c]
Villain2: raises $1.50 to $2.50
Villain3: folds
Hero: calls $2.50
Villain5: folds
Villain6: folds
Villain1: folds
*** FLOP *** [Qs 8d 3c]
Villain2: bets $3
Hero: folds
Uncalled bet ($3) returned to Villain2
Villain2 collected $6.50 from pot
*** SUMMARY ***
Total pot $6.50 | Rake $0
`;
