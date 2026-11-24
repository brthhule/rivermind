import { describe, expect, it } from 'vitest';
import { defaultData, deserialize, getData, importData, serialize, updateData } from './userData';

const withPlay = () => {
  const d = defaultData();
  d.savedRanges.push({ name: 'wide', range: '22+, A2s+' });
  d.stats.preflop = { attempts: 2, score: 1.5, history: [{ t: 1, spot: 'rfi:BTN', hand: 'AKs', chosen: 'Raise', grade: 'good' }, { t: 2, spot: 'rfi:CO', hand: '72o', chosen: 'Fold', grade: 'good' }] };
  d.play.stats = { hands: 1, decisions: 3, evLoss: 0.4, best: 2, net: 5 };
  d.play.history = [{ t: 10, spot: 's', hero: 'BTN', heroCards: [0, 5], villainCards: [9, 13], board: [20, 21, 22], net: 5, evLoss: 0.4, decisions: 3, log: [], seed: 7, prefs: d.play.prefs }];
  return d;
};

describe('user data files', () => {
  it('round-trips export and import', () => {
    const d = withPlay();
    expect(deserialize(serialize(d))).toEqual({ ...d, updated: d.updated });
  });

  it('rejects files that are not exports, and damaged ones, with a clear message', () => {
    expect(() => deserialize('hello')).toThrow(/not a Rivermind/);
    expect(() => deserialize('RIVERMIND-USER-DATA v1\n{oops')).toThrow(/damaged/);
  });

  it('cleans up malformed or hand-edited data instead of crashing later', () => {
    const bad = {
      savedRanges: [{ name: 'ok', range: 'AA' }, { name: 3 }, null],
      drills: { preflopKinds: 'rfi', positions: [1, 'BTN'], postflopSide: 'sideways' },
      stats: { preflop: { attempts: '5', score: null, history: [null, { t: 'x', hand: 4 }] }, postflop: 7 },
      solverSetups: [{ name: 'x' }, { name: 'y', setup: {} }],
      settings: { fourColor: 'yes' },
      play: { prefs: { sizing: 'huge', autoObvious: 1 }, stats: { hands: 'many', net: Infinity }, history: [{ heroCards: [1] }, { heroCards: [0, 99] }, 'x'] },
      reports: [{ name: 'r', rows: [{ flop: [1, 2], oop: {} }, { flop: [1, 2, 3], oop: { labels: ['Check'], freqs: ['a'] }, ev: [null, 1] }] }, { rows: [] }],
    };
    const d = deserialize(`RIVERMIND-USER-DATA v1\n${JSON.stringify(bad)}`);
    expect(d.savedRanges).toEqual([{ name: 'ok', range: 'AA' }]);
    expect(d.drills.preflopKinds).toEqual(defaultData().drills.preflopKinds);
    expect(d.drills.positions).toEqual(['BTN']);
    expect(d.drills.postflopSide).toBe('random');
    expect(d.stats.preflop.attempts).toBe(0);
    expect(d.stats.preflop.history).toHaveLength(1);
    expect(d.stats.postflop.attempts).toBe(0);
    expect(d.solverSetups.map((s) => s.name)).toEqual(['y']);
    expect(d.settings.fourColor).toBe(true);
    expect(d.play.prefs.sizing).toBe('simple');
    expect(d.play.stats.hands).toBe(0);
    expect(d.play.stats.net).toBe(0);
    expect(d.play.history).toEqual([]);
    expect(d.reports).toHaveLength(1);
    expect(d.reports[0].rows).toHaveLength(1);
    expect(d.reports[0].rows[0].oop.freqs).toEqual([0]);
  });

  it('merging the same file twice does not double count', () => {
    updateData(() => defaultData());
    const text = serialize(withPlay());
    importData(text, 'merge');
    importData(text, 'merge');
    const d = getData();
    expect(d.stats.preflop.attempts).toBe(2);
    expect(d.stats.preflop.history).toHaveLength(2);
    expect(d.play.stats.hands).toBe(1);
    expect(d.play.history).toHaveLength(1);
    expect(d.savedRanges).toHaveLength(1);
  });
});
