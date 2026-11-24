import { describe, expect, it } from 'vitest';
import { parseCards } from './cards';
import { classify } from './categories';

const c = (h: string, b: string) => { const [x, y] = parseCards(h); return classify(x, y, parseCards(b)); };
describe('hand categories', () => {
  it('names made hands', () => {
    expect(c('AsKd', 'Kh7c2d').made).toBe('Top pair');
    expect(c('QsQd', 'Jh7c2d').made).toBe('Overpair');
    expect(c('7s7d', 'Kh7c2d').made).toBe('Set');
    expect(c('Ks7d', 'Kh7c2d').made).toBe('Two pair');
    expect(c('8s7d', 'Kh7c2d').made).toBe('Second pair');
    expect(c('AsQd', 'Kh7c2d').made).toBe('Ace high');
    expect(c('KsKd', '7h7c2d').made).toBe('Overpair');
    expect(c('5s4d', 'Kh7c3d6s').made).toBe('Straight');
  });
  it('names draws', () => {
    expect(c('AhQh', 'Kh7h2d').draws).toContain('Flush draw');
    expect(c('9s8d', 'Th7c2d').draws).toContain('Open-ended straight draw');
    expect(c('9s6d', 'Th7c2d').draws).toContain('Gutshot');
    expect(c('AsQd', 'Kh7c2d').draws).toEqual([]);
  });
});
