import { describe, it, expect } from 'vitest';
import { parseCards, HAND_CLASSES, classOf, parseCard } from './cards';
import { evaluate, categoryOf } from './evaluator';
import { parseRange, formatRange, rangeCombos, expandRange } from './range';
import { monteCarloEquity, handVsRangeEquity } from './equity';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('categorizes hands', () => {
    expect(categoryOf(ev('AsKsQsJsTs2c3d'))).toBe(8);
    expect(categoryOf(ev('As2s3s4s5s9c9d'))).toBe(8);
    expect(categoryOf(ev('AcAdAhAs2c3d4h'))).toBe(7);
    expect(categoryOf(ev('AcAdAh2s2c3d4h'))).toBe(6);
    expect(categoryOf(ev('AcAdAh2s2c2d4h'))).toBe(6);
    expect(categoryOf(ev('2h7h9hJhKh3d4c'))).toBe(5);
    expect(categoryOf(ev('Ac2d3h4s5c9dKh'))).toBe(4);
    expect(categoryOf(ev('7c7d7h2s5c9dKh'))).toBe(3);
    expect(categoryOf(ev('7c7d5h5s2c9dKh'))).toBe(2);
    expect(categoryOf(ev('7c7d5h4s2c9dKh'))).toBe(1);
    expect(categoryOf(ev('7c8d5h4s2cJdKh'))).toBe(0);
  });
  it('orders hands', () => {
    expect(ev('AsAd2c3d4h8s9c')).toBeGreaterThan(ev('KsKd2c3d4h8s9c'));
    expect(ev('6c2d3h4s5c9dKh')).toBeGreaterThan(ev('Ac2d3h4s5c9dKh'));
    expect(ev('AcKd5h5s2c9dTh')).toBeGreaterThan(ev('AcQd5h5s2c9dTh'));
    expect(ev('KcKdKh2s2c')).toBeLessThan(ev('AcAdAh2s2c'));
    expect(ev('AsKs2c3d4h8s9c')).toBe(ev('AhKd2c3d4h8s9c'));
  });
});

describe('ranges', () => {
  it('parses and formats', () => {
    const r = parseRange('TT+, AKs, A5s-A2s, KQo, 76s:0.5');
    expect(rangeCombos(r)).toBeCloseTo(30 + 4 + 16 + 12 + 2);
    const f = formatRange(r);
    expect(f).toContain('TT+');
    expect(f).toContain('A5s-A2s');
    expect(rangeCombos(parseRange(f))).toBeCloseTo(rangeCombos(r));
  });
  it('has 169 classes and 1326 combos', () => {
    expect(HAND_CLASSES.length).toBe(169);
    expect(expandRange(new Array(169).fill(1)).length).toBe(1326);
    expect(classOf(parseCard('2h'), parseCard('Ah'))).toBe('A2s');
  });
});

describe('equity', () => {
  it('AA vs KK preflop ~ 82%', () => {
    const r = monteCarloEquity([expandRange(parseRange('AA')), expandRange(parseRange('KK'))], [], 40000, 1);
    expect(r.equity[0]).toBeGreaterThan(0.79);
    expect(r.equity[0]).toBeLessThan(0.85);
  });
  it('exact river', () => {
    const e = handVsRangeEquity(parseCard('As'), parseCard('Ad'), expandRange(parseRange('KK')), parseCards('2c7d9hJs3c'));
    expect(e).toBe(1);
  });
});
