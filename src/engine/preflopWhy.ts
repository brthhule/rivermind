// Short reasons for a preflop chart decision: equity against the opponent's range, the price,
// and what the hand does at the next raise level (e.g. "3-bets, but folds to a 4-bet").
import { HAND_CLASSES, comboCount } from './cards';
import { EQ_VS_RANDOM, PLAYABILITY, equityVsRange, spot, type PreflopSpot, type Pos } from './preflop';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "calls 60%, 4-bets 30%, folds 10%" for one class at a spot (largest first, tiny parts dropped). */
function mix(s: PreflopSpot, cls: number) {
  const verb = (l: string, kind: string) => (kind === 'fold' ? 'folds' : kind === 'call' ? 'calls' : kind === 'allin' ? 'goes all-in' : l.startsWith('3-bet') ? '3-bets' : l.startsWith('4-bet') ? '4-bets' : 'raises');
  return s.actions
    .map((a, k) => ({ v: verb(a.label, a.kind), f: s.strat[cls][k] }))
    .filter((x) => x.f >= 0.03)
    .sort((a, b) => b.f - a.f)
    .map((x) => (x.f >= 0.97 ? `always ${x.v}` : `${x.v} ${pct(x.f)}`))
    .join(', ');
}
const top = (s: PreflopSpot, cls: number) => s.actions[s.strat[cls].indexOf(Math.max(...s.strat[cls]))];
const share = (r: number[]) => r.reduce((t, w, i) => t + w * comboCount(HAND_CLASSES[i]), 0) / 1326;
/** share of the range (by combos) with a lower score than this class */
function rankIn(score: number[], reach: number[], cls: number) {
  let below = 0, all = 0;
  for (let i = 0; i < score.length; i++) {
    const c = reach[i] * comboCount(HAND_CLASSES[i]);
    all += c;
    if (score[i] < score[cls]) below += c;
  }
  return all ? below / all : 0;
}

export function preflopWhy(s: PreflopSpot, cls: number, chosen: number | null): string[] {
  const hand = HAND_CLASSES[cls];
  const [kind, a, b] = s.key.split(':') as [string, Pos, Pos];
  const out: string[] = [];
  const best = top(s, cls);
  if (chosen !== null && s.strat[cls][chosen] < 0.03) out.push(`The chart never takes ${s.actions[chosen].label} with ${hand} here. It ${mix(s, cls)}.`);

  if (kind === 'rfi') {
    const opens = share(s.strat.map((r, i) => r[1] * s.reach[i]));
    const rank = 1 - rankIn(PLAYABILITY, s.reach, cls);
    out.push(`${a} opens about ${pct(opens)} of hands. By raw equity (${pct(EQ_VS_RANDOM[cls])} against a random hand) plus playability (suited, connected, pairs), ${hand} is in the top ${pct(rank)} of all hands, so it ${rank <= opens ? 'makes the opening range' : 'falls outside it'}.`);
    if (best.kind === 'fold') out.push(`From ${a} there are ${5 - ['UTG', 'HJ', 'CO', 'BTN', 'SB'].indexOf(a)} players still to act, so an open needs to hold up against their strongest hands. ${hand} too often ends up dominated or out of position.`);
    if (best.kind === 'raise') {
      const v = 'BB';
      const next = spot(`vs3bet:${a}:${v}`);
      out.push(`If ${v} 3-bets, the chart ${mix(next, cls)} with it${top(next, cls).kind === 'fold' ? ': good enough to open, not strong enough to continue against a 3-bet.' : '.'}`);
    }
    return out;
  }

  const villain = s.villain!;
  const vr = s.villainRange!;
  const eq = equityVsRange(vr)[cls];
  const need = s.toCall / (s.pot + s.toCall);
  out.push(`Against ${villain}'s range here (${pct(share(vr))} of hands) ${hand} has ${pct(eq)} equity. Calling costs ${s.toCall.toFixed(1)}bb to win ${s.pot.toFixed(1)}bb, so you need ${pct(need)} before counting position and postflop play.`);

  if (kind === 'vsopen') {
    const [d, o] = [a, b];
    const eqs = equityVsRange(vr);
    const raises = s.strat.map((r) => r[2]);
    if (best.kind === 'raise') {
      const next = spot(`vs4bet:${d}:${o}`);
      const valueish = eq >= 0.5;
      out.push(`${hand} 3-bets as ${valueish ? 'a value hand: it is ahead of much of the opening range' : 'a bluff: it has good blockers and still plays well when called, but loses to most of the hands that continue'}.`);
      const t = top(next, cls).kind;
      out.push(`If ${o} 4-bets, the chart ${mix(next, cls)}. ${t === 'fold' ? `So ${hand} has value as a 3-bet but not as a hand to play for stacks.` : t === 'allin' ? `It is strong enough to get all the money in.` : `It is strong enough to call a 4-bet but not to go all-in.`}`);
    } else if (best.kind === 'call') {
      const minValue = Math.min(...eqs.filter((_, i) => raises[i] > 0.5 && eqs[i] >= 0.5));
      out.push(`${hand} is good enough to call but not to 3-bet for value${isFinite(minValue) ? ` (value 3-bets here start around ${pct(minValue)} equity)` : ''}, and it does better keeping ${o}'s weaker hands in than folding them out.`);
    } else {
      out.push(`${hand} ${eq < need ? 'does not have the equity to call' : 'has the raw equity, but too often ends up dominated, out of position or squeezed, so it cannot realize enough of it'}. It is not a good 3-bet bluff either (weak blockers, poor when called).`);
    }
    return out;
  }
  if (kind === 'vs3bet') {
    const [o, d] = [a, b];
    if (best.kind === 'raise') {
      const next = spot(`vs5bet:${o}:${d}`);
      const t = top(next, cls).kind;
      out.push(`If ${d} goes all-in over the 4-bet, the chart ${mix(next, cls)}. ${t === 'fold' ? `So ${hand} 4-bets as a bluff: it blocks the strongest hands but cannot call a jam.` : `So ${hand} 4-bets for value and is happy to get the money in.`}`);
    } else if (best.kind === 'call') out.push(`${hand} is strong enough to continue against the 3-bet but not to 4-bet: 4-bets are the very top hands plus a few blocker bluffs.`);
    else out.push(`${hand} opened profitably but is near the bottom of the opening range, so it gives up to a 3-bet.`);
    return out;
  }
  if (kind === 'vs4bet') {
    if (best.kind === 'allin') out.push(`${hand} is among the strongest 3-bets, so it goes all-in against the 4-bet.`);
    else if (best.kind === 'call') out.push(`${hand} is strong enough to call the 4-bet and see a flop, but going all-in would mostly get called by better hands.`);
    else out.push(`${hand} 3-bet but cannot continue against a 4-bet: ${eq < need ? 'its equity is below the price' : 'it is too often dominated by the 4-betting range'}.`);
    return out;
  }
  // vs5bet
  out.push(eq >= need ? `${pct(eq)} equity is more than the ${pct(need)} the call needs, so ${hand} calls the all-in.` : `${pct(eq)} equity is less than the ${pct(need)} the call needs, so ${hand} folds to the all-in.`);
  return out;
}
