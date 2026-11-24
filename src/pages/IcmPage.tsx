import { useMemo, useState } from 'react';
import { icmEquity, solveIcmPushFold } from '../engine/icm';
import { RangeGrid } from '../components/RangeGrid';
import { formatRange, rangePercent } from '../engine/range';

interface Row { name: string; stack: number }

export function IcmPage() {
  const [rows, setRows] = useState<Row[]>([
    { name: 'Hero', stack: 12 }, { name: 'Villain', stack: 9 }, { name: 'Player 3', stack: 25 }, { name: 'Player 4', stack: 40 },
  ]);
  const [payoutText, setPayoutText] = useState('50, 30, 20');
  const [sb, setSb] = useState(0);
  const [bb, setBb] = useState(1);
  const [ante, setAnte] = useState(0.125);
  const [mode, setMode] = useState<'icm' | 'chips'>('icm');
  const payouts = payoutText.split(/[,\s]+/).map(parseFloat).filter((x) => x > 0);
  const stacks = rows.map((r) => Math.max(0, r.stack));
  const eq = useMemo(() => icmEquity(stacks, payouts), [stacks.join(), payouts.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const prize = payouts.reduce((s, x) => s + x, 0);
  const totalChips = stacks.reduce((s, x) => s + x, 0);
  const valid = sb !== bb && rows[sb] && rows[bb] && payouts.length > 0;
  const pf = useMemo(() => (valid ? solveIcmPushFold({ stacks, payouts, sb, bb, ante, mode }) : null), [stacks.join(), payouts.join(), sb, bb, ante, mode, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const grid = (r: number[], color: string) => (i: number) => ({ weight: 1, segments: [{ f: r[i], color }, { f: 1 - r[i], color: '#2a3547' }], sub: r[i] > 0 && r[i] < 1 ? `${Math.round(r[i] * 100)}` : undefined });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ICM tools</h1>
          <p>Tournament equity with the Independent Chip Model, and push/fold ranges that account for payouts. Under ICM, losing chips costs more than winning them gains, so callers tighten up and shovers can often widen.</p>
        </div>
      </div>
      <div className="study" style={{ gridTemplateColumns: 'minmax(320px, 520px) minmax(0, 1fr)' }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="panel col">
            <h2>Table</h2>
            <div className="tscroll"><table className="t">
              <thead><tr><th>Player</th><th>Stack (bb)</th><th>Chip %</th><th>ICM equity</th><th>SB</th><th>BB</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: 100 }} /></td>
                    <td><input type="number" value={r.stack} min={0} step={0.5} style={{ width: 80 }} onChange={(e) => set(i, { stack: Math.max(0, +e.target.value || 0) })} /></td>
                    <td>{totalChips ? ((r.stack / totalChips) * 100).toFixed(1) : 0}%</td>
                    <td><b>{eq[i].toFixed(2)}</b> <span className="muted small">({prize ? ((eq[i] / prize) * 100).toFixed(1) : 0}%)</span></td>
                    <td><input type="radio" checked={sb === i} onChange={() => setSb(i)} /></td>
                    <td><input type="radio" checked={bb === i} onChange={() => setBb(i)} /></td>
                    <td>{rows.length > 2 && <button className="ghost" onClick={() => { setRows(rows.filter((_, k) => k !== i)); setSb(0); setBb(1); }}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="row">
              {rows.length < 9 && <button onClick={() => setRows([...rows, { name: `Player ${rows.length + 1}`, stack: 20 }])}>+ Add player</button>}
              <div className="spacer" />
              <label className="field">Payouts (1st, 2nd, …)<input value={payoutText} onChange={(e) => setPayoutText(e.target.value)} style={{ width: 160 }} /></label>
              <label className="field">Ante (bb)<input type="number" step={0.025} value={ante} onChange={(e) => setAnte(Math.max(0, Math.min(10, +e.target.value || 0)))} /></label>
            </div>
          </div>
          <div className="panel col">
            <h3>Risk premium</h3>
            {pf && valid ? (
              <p className="muted small">
                {rows[bb].name} needs roughly {(() => { const p = rangePercent(pf.call); return p.toFixed(0); })()}% of hands to call a shove from {rows[sb].name} under {mode === 'icm' ? 'ICM' : 'chip EV'}. Switch the model to compare: the gap between the two is the price of tournament risk.
              </p>
            ) : <span className="muted">Pick different players for SB and BB.</span>}
            <div className="seg">
              <button className={mode === 'icm' ? 'on' : ''} onClick={() => setMode('icm')}>ICM</button>
              <button className={mode === 'chips' ? 'on' : ''} onClick={() => setMode('chips')}>Chip EV</button>
            </div>
          </div>
        </div>
        {pf && valid && (
          <div className="grid2">
            {[{ t: `${rows[sb].name} shoves (SB)`, r: pf.push, c: '#e2603f' }, { t: `${rows[bb].name} calls (BB)`, r: pf.call, c: '#3fb68b' }].map((x) => (
              <div key={x.t} className="panel col">
                <div className="row"><h2 style={{ margin: 0 }}>{x.t}</h2><div className="spacer" /><span className="chip">{rangePercent(x.r).toFixed(1)}%</span></div>
                <RangeGrid cell={grid(x.r, x.c)} />
                <div className="mono small muted">{formatRange(x.r)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
