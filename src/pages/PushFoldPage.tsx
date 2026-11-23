import { useMemo, useState } from 'react';
import { solvePushFold } from '../engine/pushfold';
import { RangeGrid } from '../components/RangeGrid';
import { formatRange, rangePercent } from '../engine/range';
import { HAND_CLASSES } from '../engine/cards';

export function PushFoldPage() {
  const [stack, setStack] = useState(10);
  const [ante, setAnte] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const res = useMemo(() => solvePushFold(stack, ante), [stack, ante]);
  const grid = (r: number[], color: string) => (i: number) => ({ weight: 1, segments: [{ f: r[i], color }, { f: 1 - r[i], color: '#2a3547' }], sub: r[i] > 0 && r[i] < 1 ? `${Math.round(r[i] * 100)}` : undefined });
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Push / fold</h1>
          <p>Heads-up short-stack equilibrium: the small blind shoves or folds, the big blind calls or folds. Solved live with fictitious play over all 169 starting hands.</p>
        </div>
      </div>
      <div className="panel row" style={{ marginBottom: 16, gap: 24 }}>
        <label className="row" style={{ gap: 8 }}>Effective stack <input type="range" min={1} max={25} step={0.5} value={stack} onChange={(e) => setStack(+e.target.value)} /> <b>{stack}bb</b></label>
        <label className="row" style={{ gap: 8 }}>Ante <input type="range" min={0} max={0.25} step={0.0125} value={ante} onChange={(e) => setAnte(+e.target.value)} /> <b>{ante.toFixed(3)}bb</b></label>
        <div className="spacer" />
        <span className="chip">SB EV {res.sbEv >= 0 ? '+' : ''}{res.sbEv.toFixed(3)}bb per hand (folding everything: -0.5)</span>
      </div>
      <div className="grid2">
        {[{ t: 'Small blind shoves', r: res.push, c: '#e2603f' }, { t: 'Big blind calls', r: res.call, c: '#3fb68b' }].map((x) => (
          <div key={x.t} className="panel col">
            <div className="row"><h2 style={{ margin: 0 }}>{x.t}</h2><div className="spacer" /><span className="chip">{rangePercent(x.r).toFixed(1)}%</span></div>
            <RangeGrid cell={grid(x.r, x.c)} hovered={hover} onHover={setHover} />
            <div className="mono small muted">{formatRange(x.r)}</div>
          </div>
        ))}
      </div>
      {hover !== null && <div className="panel" style={{ marginTop: 12 }}><b>{HAND_CLASSES[hover]}</b>: shove {Math.round(res.push[hover] * 100)}%, call {Math.round(res.call[hover] * 100)}%</div>}
    </div>
  );
}
