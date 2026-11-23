import { it, expect } from 'vitest';
import { splitHands, parseHand, reviewHand, SAMPLE_HH } from './handHistory';
it('parses sample hands', () => {
  const hs = splitHands(SAMPLE_HH);
  expect(hs.length).toBe(2);
  for (const raw of hs) {
    const h = parseHand(raw);
    const r = reviewHand(h);
    console.log(h.id, r.heroPos, r.heroClass, 'net', h.heroNet, JSON.stringify(r.decisions.map((d) => [d.street, d.description, d.heroAction, d.grade, d.freq, d.equity?.toFixed(2), d.potOdds?.toFixed(2), d.note]), null, 0));
  }
});
