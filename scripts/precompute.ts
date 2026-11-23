// Precomputes preflop class-vs-class equity and combo-pair counts.
// Run: node scripts/precompute.ts
import { writeFileSync } from 'node:fs';
import { HAND_CLASSES, classCombos, rng } from '../src/engine/cards.ts';
import { evaluate } from '../src/engine/evaluator.ts';

const N = 169;
const SAMPLES = 6000;
const rand = rng(2024);
const combos = HAND_CLASSES.map(classCombos);
const eq: number[] = [];
const cnt: number[] = [];
const cards = new Int32Array(7);
const used = new Uint8Array(52);
for (let i = 0; i < N; i++) {
  for (let j = i; j < N; j++) {
    const pairs: [number, number, number, number][] = [];
    for (const a of combos[i]) for (const b of combos[j]) {
      if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
      pairs.push([a[0], a[1], b[0], b[1]]);
    }
    cnt.push(pairs.length);
    if (!pairs.length) { eq.push(0.5); continue; }
    let s = 0;
    for (let t = 0; t < SAMPLES; t++) {
      const p = pairs[(rand() * pairs.length) | 0];
      used.fill(0);
      used[p[0]] = used[p[1]] = used[p[2]] = used[p[3]] = 1;
      let k = 2;
      while (k < 7) { const c = (rand() * 52) | 0; if (!used[c]) { used[c] = 1; cards[k++] = c; } }
      cards[0] = p[0]; cards[1] = p[1];
      const h = evaluate(cards, 7);
      cards[0] = p[2]; cards[1] = p[3];
      const v = evaluate(cards, 7);
      s += h > v ? 1 : h === v ? 0.5 : 0;
    }
    eq.push(Math.round((s / SAMPLES) * 1000) / 1000);
  }
}
writeFileSync('src/data/preflopEquity.json', JSON.stringify({ samples: SAMPLES, eq, cnt }));
console.log('done', eq.length);
