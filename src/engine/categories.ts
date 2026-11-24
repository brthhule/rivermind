// Classifies a hand on a board into study categories: what it has made, and what it is drawing to.
import { rankOf, suitOf } from './cards';
import { categoryOf, evaluate } from './evaluator';

export const MADE = [
  'Straight flush+', 'Full house', 'Flush', 'Straight', 'Set', 'Trips', 'Two pair', 'Overpair', 'Top pair',
  'Second pair', 'Pocket pair below top', 'Weak pair', 'Ace high', 'No made hand',
] as const;
export const DRAWS = ['Flush draw', 'Open-ended straight draw', 'Gutshot', 'Backdoor flush draw'] as const;
export type Made = (typeof MADE)[number];
export type Draw = (typeof DRAWS)[number];

const STRAIGHT_RUNS: number[] = [];
for (let hi = 12; hi >= 4; hi--) STRAIGHT_RUNS.push(0b11111 << (hi - 4));
STRAIGHT_RUNS.push(0b1000000001111); // wheel

/** Number of ranks that would complete a straight using at least one hole card. */
function straightOuts(mask: number, boardMask: number) {
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const m = mask | (1 << r);
    // a straight that the board alone (plus this card) would not already make
    if (STRAIGHT_RUNS.some((run) => (m & run) === run && ((boardMask | (1 << r)) & run) !== run)) outs++;
  }
  return outs;
}

export function classify(c1: number, c2: number, board: number[]): { made: Made; draws: Draw[] } {
  const all = [c1, c2, ...board];
  const cat = categoryOf(evaluate(all));
  const bRanks = board.map(rankOf).sort((a, b) => b - a);
  const h1 = rankOf(c1), h2 = rankOf(c2);
  const boardPaired = new Set(bRanks).size < bRanks.length;
  let made: Made;
  if (cat >= 7) made = 'Straight flush+';
  else if (cat === 6) made = 'Full house';
  else if (cat === 5) made = 'Flush';
  else if (cat === 4) made = 'Straight';
  else if (cat === 3) made = h1 === h2 && bRanks.includes(h1) ? 'Set' : 'Trips';
  else if (cat === 2 && !(boardPaired && (h1 === h2 || (!bRanks.includes(h1) && !bRanks.includes(h2))))) made = 'Two pair';
  else if (cat >= 1 && (h1 === h2 || bRanks.includes(h1) || bRanks.includes(h2))) {
    const uniq = [...new Set(bRanks)];
    if (h1 === h2) made = h1 > uniq[0] ? 'Overpair' : h1 > (uniq[1] ?? -1) ? 'Pocket pair below top' : 'Weak pair';
    else {
      const p = bRanks.includes(h1) ? h1 : h2;
      made = p === uniq[0] ? 'Top pair' : p === uniq[1] ? 'Second pair' : 'Weak pair';
    }
  } else made = h1 === 12 || h2 === 12 ? 'Ace high' : 'No made hand';

  const draws: Draw[] = [];
  if (board.length < 5 && cat < 4) {
    const suits = [0, 0, 0, 0];
    for (const c of all) suits[suitOf(c)]++;
    const fd = [0, 1, 2, 3].find((s) => suits[s] === 4 && (suitOf(c1) === s || suitOf(c2) === s));
    if (fd !== undefined) draws.push('Flush draw');
    else if (board.length === 3 && [0, 1, 2, 3].some((s) => suits[s] === 3 && (suitOf(c1) === s || suitOf(c2) === s))) draws.push('Backdoor flush draw');
    let mask = 0, bm = 0;
    for (const c of all) mask |= 1 << rankOf(c);
    for (const c of board) bm |= 1 << rankOf(c);
    const so = straightOuts(mask, bm);
    if (so >= 2) draws.push('Open-ended straight draw');
    else if (so === 1) draws.push('Gutshot');
  }
  return { made, draws };
}
