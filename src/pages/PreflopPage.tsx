import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HAND_CLASSES, comboCount, classCombos } from '../engine/cards';
import { POSITIONS, type Pos, type HistItem, stateAfter, actionTotals, equityVsRange } from '../engine/preflop';
import { RangeGrid } from '../components/RangeGrid';
import { ActionList } from '../components/ActionList';
import { actionColors, heat } from '../components/colors';
import { Combo } from '../components/cards';
import { setSetup } from '../store/session';
import { rangePercent } from '../engine/range';

export function PreflopPage() {
  const [hist, setHist] = useState<HistItem[]>([]);
  const [view, setView] = useState<'strategy' | 'equity'>('strategy');
  const [hover, setHover] = useState<number | null>(null);
  const navigate = useNavigate();
  const state = useMemo(() => stateAfter(hist), [hist]);
  const sp = state.kind === 'decision' ? state.spot : null;
  const colors = sp ? actionColors(sp.actions.map((a) => a.label)) : [];
  const totals = sp ? actionTotals(sp) : [];
  const eq = useMemo(() => (sp?.villainRange ? equityVsRange(sp.villainRange) : null), [sp]);
  const reachCombos = sp ? sp.reach.reduce((s, w, i) => s + w * comboCount(HAND_CLASSES[i]), 0) : 0;

  const act = (a: number) => sp && setHist([...hist, { pos: sp.hero, action: a, label: sp.actions[a].label }]);
  const jumpTo = (p: Pos) => {
    // In the opening round, clicking a later seat folds everyone before it.
    const idx = hist.findIndex((h) => h.pos === p);
    if (idx >= 0) { setHist(hist.slice(0, idx)); return; }
    if (state.kind !== 'decision' || hist.some((h) => h.action > 0)) return;
    const pi = POSITIONS.indexOf(p);
    const start = POSITIONS.indexOf(state.spot.hero);
    if (pi <= start || p === 'BB') return;
    setHist([...hist, ...POSITIONS.slice(start, pi).map((pos) => ({ pos, action: 0, label: 'Fold' }))]);
  };

  const hv = hover !== null && sp ? hover : null;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Preflop charts</h1>
          <p>6-max cash, 100bb deep. Click an action to move through the hand, or click a seat to jump to it. Strategies come from Rivermind's own preflop model, built as study baselines.</p>
        </div>
        <div className="seg">
          <button className={view === 'strategy' ? 'on' : ''} onClick={() => setView('strategy')}>Strategy</button>
          <button className={view === 'equity' ? 'on' : ''} onClick={() => setView('equity')} disabled={!eq}>Equity vs villain</button>
        </div>
      </div>

      <div className="line">
        {POSITIONS.map((p) => {
          const h = [...hist].reverse().find((x) => x.pos === p);
          const cur = sp?.hero === p;
          const cls = h ? (h.label === 'Fold' ? 'fold' : h.label === 'Call' ? 'pas' : 'agg') : '';
          return (
            <div key={p} className={`seat ${cls}${cur ? ' cur' : ''}`} onClick={() => jumpTo(p)}>
              <div className="p">{p}</div>
              <div className="a">{cur ? 'To act' : h ? h.label : p === 'SB' ? '0.5bb' : p === 'BB' ? '1bb' : '·'}</div>
            </div>
          );
        })}
        <div className="spacer" />
        <button className="ghost" disabled={!hist.length} onClick={() => setHist(hist.slice(0, -1))}>↶ Back</button>
        <button className="ghost" disabled={!hist.length} onClick={() => setHist([])}>Reset</button>
      </div>

      {state.kind === 'end' && (
        <div className="panel col" style={{ maxWidth: 640 }}>
          <h2>{state.summary}</h2>
          {state.flop && (
            <>
              <p className="muted">
                {state.flop.oop} (out of position) has {rangePercent(state.flop.oopRange).toFixed(1)}% of hands, {state.flop.ip} (in position) has {rangePercent(state.flop.ipRange).toFixed(1)}%.
                Effective stack {state.flop.stack}bb.
              </p>
              <div className="row">
                <button className="primary" onClick={() => {
                  const f = state.flop!;
                  setSetup({ spotName: hist.filter((h) => h.action > 0).map((h) => `${h.pos} ${h.label}`).join(', '), oopName: f.oop, ipName: f.ip, oopRange: f.oopRange, ipRange: f.ipRange, pot: f.pot, stack: f.stack });
                  navigate('/solver');
                }}>Solve this spot postflop →</button>
              </div>
            </>
          )}
          <div><button onClick={() => setHist(hist.slice(0, -1))}>↶ Back</button></div>
        </div>
      )}

      {sp && (
        <div className="study">
          <div>
            <RangeGrid
              hovered={hover}
              onHover={setHover}
              cell={(i) => {
                const w = sp.reach[i];
                if (view === 'equity' && eq) return { weight: w, segments: [], bg: w > 0 ? heat(eq[i]) : undefined, sub: w > 0 ? `${Math.round(eq[i] * 100)}` : undefined };
                return { weight: w, segments: sp.strat[i].map((f, k) => ({ f, color: colors[k] })) };
              }}
            />
          </div>
          <div className="col" style={{ gap: 14 }}>
            <div className="panel col">
              <div className="row">
                <h2 style={{ margin: 0 }}>{sp.title}</h2>
                <div className="spacer" />
                <span className="chip">Pot {sp.pot.toFixed(1)}bb</span>
                <span className="chip">{reachCombos.toFixed(0)} combos</span>
              </div>
              <ActionList
                items={sp.actions.map((a, k) => ({ label: a.label, color: colors[k], freq: totals[k], combos: totals[k] * reachCombos }))}
                onPick={act}
              />
              <span className="muted small">Click an action to continue the hand.</span>
            </div>
            <div className="panel">
              {hv === null ? (
                <span className="muted">Hover a hand to see its strategy{eq ? ' and equity against the villain range' : ''}.</span>
              ) : (
                <div className="col">
                  <div className="row">
                    <h2 style={{ margin: 0 }}>{HAND_CLASSES[hv]}</h2>
                    <span className="muted">{(sp.reach[hv] * comboCount(HAND_CLASSES[hv])).toFixed(1)} combos in range</span>
                    <div className="spacer" />
                    {eq && <span className="chip">Equity {(eq[hv] * 100).toFixed(1)}%</span>}
                  </div>
                  {sp.reach[hv] > 0 ? (
                    <ActionList items={sp.actions.map((a, k) => ({ label: a.label, color: colors[k], freq: sp.strat[hv][k] }))} />
                  ) : <span className="muted">Not in this range.</span>}
                  <div className="row small muted" style={{ gap: 6 }}>
                    {classCombos(HAND_CLASSES[hv]).map(([a, b]) => <Combo key={`${a}-${b}`} c1={a} c2={b} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
