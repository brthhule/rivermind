// Hand evaluator for 5-7 cards. Returns an integer where larger is better.
// Layout: category << 20 | five 4-bit kicker ranks.
export const CATEGORY_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

// STRAIGHT_HIGH[mask] = high rank of best straight in 13-bit mask, or -1
const STRAIGHT_HIGH = new Int8Array(8192).fill(-1);
for (let m = 0; m < 8192; m++) {
  for (let hi = 12; hi >= 4; hi--) {
    const run = 0b11111 << (hi - 4);
    if ((m & run) === run) { STRAIGHT_HIGH[m] = hi; break; }
  }
  // wheel A-2-3-4-5 (high card 5 = rank 3)
  if (STRAIGHT_HIGH[m] === -1 && (m & 0b1000000001111) === 0b1000000001111) STRAIGHT_HIGH[m] = 3;
}

const POPCOUNT = new Uint8Array(8192);
for (let m = 1; m < 8192; m++) POPCOUNT[m] = POPCOUNT[m >> 1] + (m & 1);

function topBits(mask: number, n: number): number {
  let out = 0, got = 0;
  for (let r = 12; r >= 0 && got < n; r--) {
    if (mask & (1 << r)) { out = (out << 4) | r; got++; }
  }
  while (got < 5) { out <<= 4; got++; }
  return out;
}

const counts = new Uint8Array(13);
const suitMask = new Uint16Array(4);

export function evaluate(cards: ArrayLike<number>, n = cards.length): number {
  counts.fill(0);
  suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
  let all = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    counts[r]++;
    suitMask[c & 3] |= 1 << r;
    all |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    const m = suitMask[s];
    if (POPCOUNT[m] >= 5) {
      const sh = STRAIGHT_HIGH[m];
      if (sh >= 0) return (8 << 20) | (sh << 16);
      return (5 << 20) | topBits(m, 5);
    }
  }
  let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
    else if (k === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
  }
  if (quad >= 0) {
    const kick = topBits(all & ~(1 << quad), 1) >> 16;
    return (7 << 20) | (quad << 16) | (kick << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const p = Math.max(trip2, pair1);
    return (6 << 20) | (trip1 << 16) | (p << 12);
  }
  const sh = STRAIGHT_HIGH[all];
  if (sh >= 0) return (4 << 20) | (sh << 16);
  if (trip1 >= 0) {
    const k = topBits(all & ~(1 << trip1), 2) >> 12;
    return (3 << 20) | (trip1 << 16) | (k << 8);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const k = topBits(all & ~(1 << pair1) & ~(1 << pair2), 1) >> 16;
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (k << 8);
  }
  if (pair1 >= 0) {
    const k = topBits(all & ~(1 << pair1), 3) >> 8;
    return (1 << 20) | (pair1 << 16) | (k << 4);
  }
  return topBits(all, 5);
}

export function categoryOf(score: number): number {
  return score >> 20;
}

export function describe(score: number): string {
  return CATEGORY_NAMES[categoryOf(score)];
}
