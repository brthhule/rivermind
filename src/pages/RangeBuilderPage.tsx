import { useMemo, useState } from 'react';
import { HAND_CLASSES, comboCount } from '../engine/cards';
import { POSITIONS, spot, type PreflopSpot } from '../engine/preflop';
import { RangeGrid } from '../components/RangeGrid';
import { actionColors } from '../components/colors';
import { updateData, useUserData } from '../store/userData';

const KINDS = [
  { id: 'rfi', label: 'Opening (first in)' },
  { id: 'vsopen', label: 'Facing an open' },
  { id: 'vs3bet', label: 'Facing a 3-bet' },
  { id: 'vs4bet', label: 'Facing a 4-bet' },
] as const;
type Kind = (typeof KINDS)[number]['id'];

/** Every preflop spot key of a kind. */
function keysOf(kind: Kind): string[] {
  const out: string[] = [];
  POSITIONS.forEach((o, oi) => {
    if (o === 'BB') return;
    if (kind === 'rfi') { out.push(`rfi:${o}`); return; }
    POSITIONS.slice(oi + 1).forEach((d) => {
      if (kind === 'vsopen') out.push(`vsopen:${d}:${o}`);
      else if (kind === 'vs3bet') out.push(`vs3bet:${o}:${d}`);
      else out.push(`vs4bet:${d}:${o}`);
    });
  });
  return out;
}
const combos = (i: number) => comboCount(HAND_CLASSES[i]);

/** Combo-weighted overlap between the painted strategy and the chart, 0..1. */
function scoreOf(s: PreflopSpot, mine: number[]) {
  let hit = 0, all = 0;
  for (let i = 0; i < 169; i++) {
    const w = s.reach[i] * combos(i);
    if (w <= 0) continue;
    all += w;
    hit += w * s.strat[i][mine[i]];
  }
  return all ? hit / all : 0;
}

export function RangeBuilderPage() {
  const data = useUserData();
  const [kinds, setKinds] = useState<Kind[]>(['rfi', 'vsopen']);
  const [key, setKey] = useState(() => keysOf('rfi')[0]);
  const s = useMemo(() => spot(key), [key]);
  const fresh = () => s.reach.map(() => s.actions.findIndex((a) => a.kind === 'fold'));
  const [mine, setMine] = useState<number[]>(fresh);
  const [brush, setBrush] = useState(1);
  const [checked, setChecked] = useState(false);
  const labels = s.actions.map((a) => a.label);
  const colors = actionColors(labels);
  const fold = s.actions.findIndex((a) => a.kind === 'fold');

  const next = () => {
    const pool = (kinds.length ? kinds : (['rfi'] as Kind[])).flatMap(keysOf).filter((k) => k !== key);
    const k = pool[Math.floor(Math.random() * pool.length)];
    const ns = spot(k);
    setKey(k);
    setMine(ns.reach.map(() => ns.actions.findIndex((a) => a.kind === 'fold')));
    setBrush(Math.min(1, ns.actions.length - 1));
    setChecked(false);
  };
  const paint = (i: number) => {
    if (checked || s.reach[i] <= 0) return;
    setMine((m) => { const c = [...m]; c[i] = brush; return c; });
  };
  const score = checked ? scoreOf(s, mine) : 0;
  const check = () => {
    setChecked(true);
    const sc = scoreOf(s, mine);
    updateData((d) => {
      d.builder.attempts++;
      d.builder.scoreSum += sc;
      d.builder.history = [...d.builder.history, { t: Date.now(), spot: key, score: Math.round(sc * 1000) / 1000 }].slice(-300);
    });
  };

  // biggest misses, by combos times how wrong the painted action is
  const misses = checked
    ? HAND_CLASSES.map((h, i) => ({ h, i, w: s.reach[i] * combos(i) * (1 - s.strat[i][mine[i]]) }))
        .filter((x) => x.w > 0.05)
        .sort((a, b) => b.w - a.w)
        .slice(0, 10)
    : [];
  const mixText = (i: number) => labels.map((l, a) => ({ l, f: s.strat[i][a] })).filter((x) => x.f >= 0.03).map((x) => `${x.l} ${Math.round(x.f * 100)}%`).join(', ');
  const painted = labels.map((_, a) => mine.reduce((t, m, i) => t + (m === a ? s.reach[i] * combos(i) : 0), 0));
  const inRange = s.reach.reduce((t, r, i) => t + r * combos(i), 0);
  const b = data.builder;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Range builder</h1>
          <p>Paint the whole strategy for a preflop spot from memory, then compare it with the chart. Your score is the share of combos you assigned to an action the chart takes, weighted by how often it takes it.</p>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}><span className="muted small">Ranges built</span><b>{b.attempts}</b></div>
          <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}><span className="muted small">Average score</span><b>{b.attempts ? `${Math.round((b.scoreSum / b.attempts) * 100)}%` : '–'}</b></div>
        </div>
      </div>

      <div className="panel row" style={{ marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <span className="muted small">Spots to practice:</span>
        {KINDS.map((k) => (
          <label key={k.id} className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={kinds.includes(k.id)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k.id] : kinds.filter((x) => x !== k.id))} /> {k.label}
          </label>
        ))}
        <div className="spacer" />
        <button onClick={next}>New spot ›</button>
      </div>

      <div className="builder">
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          <div className="panel col" style={{ gap: 10 }}>
            <div className="row">
              <h2 style={{ margin: 0 }}>{s.title}</h2>
              <div className="spacer" />
              <span className="chip">Pot {s.pot.toFixed(1)}bb</span>
              {s.toCall > 0 && <span className="chip">To call {s.toCall.toFixed(1)}bb</span>}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="muted small">Brush:</span>
              {labels.map((l, a) => (
                <button key={a} className={brush === a ? 'primary' : ''} disabled={checked} onClick={() => setBrush(a)}>
                  <span className="dot" style={{ background: colors[a] }} /> {l} <span className="muted small">{((painted[a] / (inRange || 1)) * 100).toFixed(0)}%</span>
                </button>
              ))}
              <div className="spacer" />
              <button className="ghost" disabled={checked} onClick={() => setMine(fresh())}>Clear</button>
              {!checked ? <button className="primary" onClick={check}>Check my range</button> : <button className="primary" onClick={next}>Next spot ›</button>}
            </div>
            <RangeGrid
              onPaint={(i) => paint(i)}
              cell={(i) => ({ weight: s.reach[i], segments: s.reach[i] > 0 ? [{ f: 1, color: colors[mine[i]] }] : [], sub: checked && s.strat[i][mine[i]] < 0.5 && s.reach[i] > 0 ? '✕' : undefined })}
            />
            <span className="muted small">Click or drag across hands to paint them with the selected action. Hands start as {labels[fold]}. Dim cells are not in range at this point.{checked ? ' ✕ marks hands where the chart takes your action less than half the time.' : ''}</span>
          </div>
        </div>
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          {checked ? (
            <>
              <div className="panel col" style={{ gap: 8 }}>
                <div className="row"><h2 style={{ margin: 0 }}>Score {Math.round(score * 100)}%</h2><div className="spacer" /><span className={`tag ${score >= 0.9 ? 'good' : score >= 0.75 ? 'ok' : score >= 0.6 ? 'inaccuracy' : 'mistake'}`}>{score >= 0.9 ? 'Excellent' : score >= 0.75 ? 'Good' : score >= 0.6 ? 'Close' : 'Keep practicing'}</span></div>
                <span className="muted small">The chart:</span>
                <RangeGrid cell={(i) => ({ weight: s.reach[i], segments: labels.map((_, a) => ({ f: s.strat[i][a], color: colors[a] })) })} />
                <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
                  {labels.map((l, a) => <span key={a}><span className="dot" style={{ background: colors[a] }} />{l} {((s.strat.reduce((t, r, i) => t + r[a] * s.reach[i] * combos(i), 0) / (inRange || 1)) * 100).toFixed(0)}%</span>)}
                </div>
              </div>
              {misses.length > 0 && (
                <div className="panel col">
                  <h3 style={{ margin: 0 }}>Biggest misses</h3>
                  <table className="t">
                    <thead><tr><th>Hand</th><th>You</th><th>Chart</th></tr></thead>
                    <tbody>{misses.map((x) => <tr key={x.i}><td><b>{x.h}</b></td><td>{labels[mine[x.i]]}</td><td>{mixText(x.i)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="panel col muted">
              <span>Build the full range for <b>{s.hero}</b>, then press Check my range.</span>
              <span className="small">Tip: paint the strongest action first (raises), then calls. Everything you leave alone counts as {labels[fold]}.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
