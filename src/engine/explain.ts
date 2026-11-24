// Turns solver data about one decision into plain-language reasons.
// Every sentence is built from numbers the solver computed for this exact spot.
import type { ActionInsight, Explanation } from '../solver/solver';
import { cardStr } from './cards';

export interface WhyText {
  /** one or two plain sentences: the play and the main reason */
  summary: string;
  /** the one-paragraph answer to "why is the best play best (and why not mine)" */
  headline: string;
  /** supporting facts, most important first */
  points: string[];
  /** per-action details for the expandable table */
  details: { label: string; lines: string[] }[];
}

const pct = (x: number) => (isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a');
const bb = (x: number) => `${x.toFixed(2)}bb`;
const isAggro = (l: string) => /^(Bet|Raise|All-in)/.test(l);
const short = (l: string) => l.replace(/^Bet [\d.]+ \((\d+)%\)$/, 'Bet $1%').replace(/^Raise [\d.]+ \((\d+)%\)$/, 'Raise $1%').replace(/^All-in .*/, 'All-in');

function replyText(a: ActionInsight, opp: string) {
  if (!a.reply) return '';
  const name = (l: string) => (/^(Raise|All-in)/.test(l) && a.reply!.labels.includes('Fold') ? 'raise' : l === 'Fold' ? 'fold' : l === 'Call' ? 'call' : l === 'Check' ? 'check' : /^All-in/.test(l) ? 'shove' : `bet ${short(l).replace('Bet ', '')} pot`);
  // merge all raises into one bucket for readability
  const m = new Map<string, number>();
  a.reply.labels.forEach((l, i) => { const k = name(l); m.set(k, (m.get(k) ?? 0) + a.reply!.freqs[i]); });
  return `${opp} will ${[...m].filter(([, f]) => f >= 0.005).map(([k, f]) => `${k} (${pct(f)})`).join(', ')}.`;
}

function foldFreq(a: ActionInsight) {
  if (!a.reply) return NaN;
  const i = a.reply.labels.indexOf('Fold');
  return i >= 0 ? a.reply.freqs[i] : 0;
}

/** Reasons one aggressive action beats another (both have opponent replies). */
function compareBets(win: ActionInsight, lose: ActionInsight, e: Explanation, opp: string): string[] {
  const out: string[] = [];
  const fw = foldFreq(win), fl = foldFreq(lose);
  const cw = win.eqVsContinue ?? NaN, cl = lose.eqVsContinue ?? NaN;
  const bigger = lose.add > win.add ? lose : win;
  const smaller = bigger === lose ? win : lose;
  const winIsSmall = win === smaller;
  const cBig = bigger.eqVsContinue ?? NaN, cSmall = smaller.eqVsContinue ?? NaN;
  const fBig = foldFreq(bigger), fSmall = foldFreq(smaller);
  if (winIsSmall) {
    if (isFinite(cBig) && isFinite(cSmall) && cSmall - cBig >= 0.04)
      out.push(`The bigger bet only gets continued against by stronger hands. When ${opp} calls or raises ${short(bigger.label)}, your hand has ${pct(cBig)} equity, compared with ${pct(cSmall)} against the hands that continue versus ${short(smaller.label)}.`);
    if (isFinite(bigger.eqVsFold ?? NaN) && (bigger.eqVsFold ?? 0) >= 0.55)
      out.push(`The extra folds from the bigger bet are mostly hands you already beat (you have ${pct(bigger.eqVsFold!)} equity against the hands that fold to it), so they would have paid you off or given up later anyway.`);
    if (isFinite(fBig) && isFinite(fSmall) && fBig - fSmall < 0.12)
      out.push(`Betting bigger only adds ${pct(Math.max(0, fBig - fSmall))} more folds (${pct(fSmall)} to ${pct(fBig)}) while risking ${bb(bigger.add - smaller.add)} more.`);
    if (e.handEq < 0.7 && e.handEq > 0.4)
      out.push(`Your hand is medium strength (${pct(e.handEq)} against ${opp}'s range), which wants a cheap bet: it gets value from worse hands and protection, without building a big pot against better ones.`);
  } else {
    if (isFinite(fBig) && isFinite(fSmall) && fBig - fSmall >= 0.08 && e.handEq < 0.5)
      out.push(`The bigger bet folds out ${pct(fBig)} of ${opp}'s range instead of ${pct(fSmall)}.`);
    if (isFinite(cBig) && cBig >= 0.55)
      out.push(`Even against the hands that continue versus ${short(bigger.label)} you have ${pct(cBig)} equity, so a bigger pot is good for you.`);
    if (isFinite(smaller.eqVsFold ?? NaN) && (smaller.eqVsFold ?? 1) < 0.45 && fBig > fSmall)
      out.push(`The hands that fold are ones that beat you or have good equity (you have only ${pct(smaller.eqVsFold!)} against them), so more pressure gains more.`);
    if (e.handEq >= 0.75)
      out.push(`Your hand is very strong (${pct(e.handEq)} against ${opp}'s range), so you want as much money in as ${opp}'s calling range allows.`);
    if (e.handEq < 0.35)
      out.push(`Your hand is weak (${pct(e.handEq)} against ${opp}'s range): it mainly wins when ${opp} folds, so the size that folds out more hands wins.`);
  }
  if (!out.length && isFinite(cw) && isFinite(cl) && isFinite(fw) && isFinite(fl))
    out.push(`With ${short(win.label)} ${opp} folds ${pct(fw)} and you have ${pct(cw)} equity when they continue. With ${short(lose.label)} they fold ${pct(fl)} and you have ${pct(cl)}.`);
  return out;
}

export function explainDecision(e: Explanation, chosen: number | null, opp = 'Villain'): WhyText {
  const A = e.actions;
  const valid = A.map((a, i) => ({ a, i })).filter((x) => isFinite(x.a.ev));
  const best = valid.reduce((m, x) => (x.a.ev > m.a.ev ? x : m), valid[0]);
  const hand = `${cardStr(e.hand[0])}${cardStr(e.hand[1])}`;
  const points: string[] = [];
  const target = chosen !== null && chosen !== best.i ? A[chosen] : null;
  // the best alternative to compare with: the chosen action, or the next-best action
  const other = target ?? valid.filter((x) => x.i !== best.i).sort((x, y) => y.a.ev - x.a.ev)[0]?.a;
  const gap = other ? best.a.ev - other.ev : 0;
  const tiny = gap < Math.max(0.05, e.pot * 0.01);

  let headline = `${short(best.a.label)} has the highest EV with ${hand} (${bb(best.a.ev)})`;
  if (other) headline += `, ${bb(gap)} more than ${short(other.label)} (${bb(other.ev)})`;
  headline += '.';
  if (other && tiny) headline += ' That gap is tiny, so both plays are close to equally good and the solver can mix them.';

  // facing a bet: price first
  if (e.toCall > 0) {
    const need = e.toCall / (e.pot + e.toCall);
    points.push(`You need ${pct(need)} equity to call ${bb(e.toCall)} into ${bb(e.pot)}. Against ${opp}'s betting range your hand has ${pct(e.handEq)}${e.handEq >= need ? ', enough on raw equity' : ', so calling has to make up the rest with future bets you can win (implied odds) or folds'}.`);
  }

  // the core comparison
  const ba = best.a;
  if (other) {
    if (isAggro(ba.label) && isAggro(other.label) && ba.reply && other.reply) points.push(...compareBets(ba, other, e, opp));
    else if (isAggro(ba.label) && !isAggro(other.label)) {
      const f = foldFreq(ba);
      if (isFinite(f) && ba.eqVsFold !== undefined && ba.eqVsFold < 0.5 && f > 0.25) points.push(`${short(ba.label)} makes ${opp} fold ${pct(f)}, including hands that have ${pct(1 - ba.eqVsFold)} equity against you. Checking would let them see the next card for free.`);
      else if (ba.eqVsContinue !== undefined && ba.eqVsContinue >= 0.5) points.push(`${short(ba.label)} gets called or raised by hands you still beat (you have ${pct(ba.eqVsContinue)} equity against them), so betting wins more than checking.`);
      else if (isFinite(f)) points.push(`${short(ba.label)} wins the pot right away ${pct(f)} of the time, and you keep ${pct(ba.eqVsContinue ?? NaN)} equity when ${opp} continues.`);
      if (other.label === 'Check' && other.reply) points.push(`If you check, ${replyText(other, opp)}`);
    } else if (!isAggro(ba.label) && isAggro(other.label)) {
      const c = other.eqVsContinue, f = foldFreq(other);
      if (c !== undefined && isFinite(c) && c < 0.45) points.push(`If you ${short(other.label).toLowerCase()}, ${opp} continues with hands that leave you only ${pct(c)} equity${isFinite(f) ? `, and folds just ${pct(f)}` : ''}.`);
      if (other.eqVsFold !== undefined && other.eqVsFold > 0.6) points.push(`The hands that would fold are mostly hands you already beat (${pct(other.eqVsFold)} equity against them), so betting folds out exactly the hands you want to keep in.`);
      if (ba.label === 'Check' && ba.reply) points.push(`If you check, ${replyText(ba, opp)} Checking keeps their bluffs and weaker hands in the pot.`);
      if (ba.label === 'Call') points.push(`Calling keeps ${opp}'s bluffs in their range, where raising would fold them out and get called by better hands.`);
      if (ba.label === 'Fold') points.push(`Your hand does not have the equity or the fold equity to continue profitably.`);
    }
  }

  // a bet was chosen but a different size was better: explain the sizing too
  if (target && isAggro(target.label) && target.reply) {
    const better = valid.map((x) => x.a).filter((a) => a !== target && isAggro(a.label) && a.reply && a.ev > target.ev).sort((x, y) => y.ev - x.ev)[0];
    if (better && better !== ba) {
      const why = compareBets(better, target, e, opp);
      if (why.length) points.push(`If you bet, ${short(better.label)} is better than ${short(target.label)} (${bb(better.ev)} against ${bb(target.ev)}). ${why.join(' ')}`);
    }
  }

  // hand and range context
  points.push(`${hand} has ${pct(e.handEq)} equity against ${opp}'s range and is stronger than ${pct(e.handPercentile)} of your own range here.`);
  const edge = e.rangeEq[0] - 0.5;
  const nutsDiff = e.strongShare[0] - e.strongShare[1];
  let rangeLine = `On this ${e.street}, your range has ${pct(e.rangeEq[0])} equity against ${opp}'s ${pct(e.rangeEq[1])}. ${pct(e.strongShare[0])} of your range is very strong (75%+ equity), against ${pct(e.strongShare[1])} of theirs.`;
  const aggro = A.filter((a) => isAggro(a.label) && a.rangeFreq > 0.02);
  if (aggro.length >= 2) {
    const small = aggro.reduce((m, a) => (a.add < m.add ? a : m)), big = aggro.reduce((m, a) => (a.add > m.add ? a : m));
    if (edge > 0.03 && nutsDiff < 0.05) rangeLine += ' A range edge without many more very strong hands is the classic setup for small bets: a cheap bet with most of the range.';
    else if (nutsDiff >= 0.05) rangeLine += ' Having more very strong hands lets you use big bets, because your big-bet range can be polarized (very strong hands plus bluffs).';
    rangeLine += ` Your range picks ${short(small.label)} ${pct(small.rangeFreq)} of the time (${pct(small.strongShare ?? NaN)} very strong, ${pct(small.weakShare ?? NaN)} weak) and ${short(big.label)} ${pct(big.rangeFreq)} (${pct(big.strongShare ?? NaN)} very strong, ${pct(big.weakShare ?? NaN)} weak).`;
  }
  points.push(rangeLine);

  const details = A.map((a) => {
    const lines = [`EV ${bb(a.ev)} with your hand. You take it ${pct(a.freq)}; your range takes it ${pct(a.rangeFreq)}.`];
    if (a.reply) lines.push(replyText(a, opp));
    if (a.eqVsContinue !== undefined && isFinite(a.eqVsContinue)) lines.push(`Your equity when ${opp} continues: ${pct(a.eqVsContinue)}. Against the hands that fold: ${pct(a.eqVsFold ?? NaN)}.`);
    if (isAggro(a.label) && a.add > 0) lines.push(`As a pure bluff it needs ${pct(a.add / (e.pot + a.add))} folds to break even.`);
    return { label: a.label, lines };
  });
  return { summary: summarize(e, best.a, other, tiny, opp), headline, points, details };
}

const strength = (eq: number) => (eq >= 0.75 ? 'a very strong hand' : eq >= 0.55 ? 'a good hand' : eq >= 0.42 ? 'a medium-strength hand' : eq >= 0.28 ? 'a weak hand' : 'a hand that is usually behind');
const sizeWord = (l: string) => (/^All-in/.test(l) ? 'All-in' : short(l));

/** One or two sentences in poker terms: what to do and the single biggest reason. */
function summarize(e: Explanation, b: ActionInsight, other: ActionInsight | undefined, tiny: boolean, opp: string): string {
  const eq = e.handEq;
  const f = foldFreq(b);
  const cont = b.eqVsContinue ?? NaN;
  const be = b.add > 0 ? b.add / (e.pot + b.add) : 0;
  let s: string;
  if (b.label === 'Fold') {
    const need = e.toCall / (e.pot + e.toCall);
    s = `Fold: you need ${pct(need)} equity to call but have only ${pct(eq)} against ${opp}'s bets, and raising doesn't get enough folds.`;
  } else if (b.label === 'Call') {
    const need = e.toCall / (e.pot + e.toCall);
    const raise = e.actions.find((a) => isAggro(a.label) && a.eqVsContinue !== undefined);
    s = `Call: ${eq >= need ? `you have ${pct(eq)} against ${opp}'s bets and only need ${pct(need)}` : `you are short on raw equity but your hand plays well on later streets`}.`;
    if (raise && (raise.eqVsContinue ?? 1) < 0.45) s += ` Raising folds out ${opp}'s bluffs and only gets called by better hands.`;
  } else if (b.label === 'Check') {
    if (eq >= 0.55) s = `Check: you have ${strength(eq)}, but betting mostly folds out worse hands. Checking keeps ${opp}'s bluffs and weaker hands in.`;
    else if (eq >= 0.4) s = `Check: ${strength(eq)} that wants to reach showdown cheaply. Betting gets called by better hands and folds out worse ones.`;
    else s = `Check: your hand is too weak to bet for value and not a good bluff, so ${e.board.length === 5 ? 'check and give up or see a cheap showdown' : 'take the free card'}.`;
  } else {
    const verb = sizeWord(b.label);
    if (isFinite(cont) && cont >= 0.5) s = `${verb} for value: worse hands still call, and you have ${pct(cont)} against the hands that continue.`;
    else if (isFinite(f) && f >= be && eq < 0.4) s = `${verb} as a bluff: ${opp} folds ${pct(f)}, more than the ${pct(be)} this bet needs to profit.`;
    else if (isFinite(f)) s = `${verb}: you win the pot right away ${pct(f)} of the time and still have ${pct(cont)} when called.`;
    else s = `${verb}: it earns the most with ${strength(eq)}.`;
    // sizing: why this size and not the other one
    if (other && isAggro(other.label) && other.reply && b.reply) {
      const smaller = b.add < other.add;
      const co = other.eqVsContinue ?? NaN;
      if (smaller && isFinite(co) && isFinite(cont) && cont - co >= 0.04) s += ` Smaller beats ${sizeWord(other.label)} because a big bet only gets called by hands that beat you.`;
      else if (smaller) s += ` A smaller size keeps more worse hands in than ${sizeWord(other.label)}.`;
      else if (eq >= 0.7) s += ` Bigger beats ${sizeWord(other.label)} because your hand wants to build the pot.`;
      else s += ` Bigger beats ${sizeWord(other.label)} because it folds out more hands.`;
    }
  }
  if (tiny && other) s += ` ${sizeWord(other.label)} is almost as good.`;
  return s;
}
