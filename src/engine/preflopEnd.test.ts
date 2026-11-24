import { describe, expect, it } from 'vitest';
import { POSITIONS, spot, stateAfter, type HistItem } from './preflop';

describe('preflop hand endings', () => {
  it('names the winner when the opener folds to a 5-bet shove', () => {
    // CO opens, BTN 3-bets, CO 4-bets, BTN shoves, CO folds
    const h: HistItem[] = [];
    const push = (pos: (typeof POSITIONS)[number], kind: string) => {
      const st = stateAfter(h);
      if (st.kind !== 'decision') throw new Error('hand ended early');
      expect(st.spot.hero).toBe(pos);
      const a = st.spot.actions.findIndex((x) => x.kind === kind);
      h.push({ pos, action: a, label: st.spot.actions[a].label });
    };
    push('UTG', 'fold'); push('HJ', 'fold'); push('CO', 'raise'); push('BTN', 'raise');
    push('CO', 'raise'); push('BTN', 'allin'); push('CO', 'fold');
    const end = stateAfter(h);
    expect(end.kind).toBe('end');
    expect(end.kind === 'end' && end.summary).toContain('BTN wins');
    expect(spot('vs5bet:CO:BTN').actions.some((a) => a.kind === 'call')).toBe(true);
  });
});
