import { describe, expect, it } from 'vitest';
import { formatRange, parseRange, rangeCombos } from './range';

describe('parseRange', () => {
  it('parses common shorthand', () => {
    expect(rangeCombos(parseRange('AA'))).toBe(6);
    expect(rangeCombos(parseRange('TT+'))).toBe(30);
    expect(rangeCombos(parseRange('A5s-A2s'))).toBe(16);
    expect(rangeCombos(parseRange('KQo+'))).toBe(12);
    expect(rangeCombos(parseRange('AK'))).toBe(16);
    expect(rangeCombos(parseRange('76s:0.5'))).toBe(2);
    expect(rangeCombos(parseRange('76s:50%'))).toBe(2);
    expect(rangeCombos(parseRange('ka s'.replace(' ', '')))).toBe(4);
  });
  it('rejects junk instead of silently ignoring it', () => {
    for (const bad of ['A', 'AKx', 'AKs:abc', 'AAs', 'AK-QJ', 'A5s-K2s', 'ZZ', 'AKs:200']) expect(() => parseRange(bad), bad).toThrow();
  });
  it('round-trips through formatRange', () => {
    const r = parseRange('22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+, 65s:0.25');
    expect(parseRange(formatRange(r))).toEqual(r);
  });
});
