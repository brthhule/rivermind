import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { HAND_CLASSES, classCombos, cardStr, comboStr } from '../engine/cards';
import { presetSpots } from '../engine/preflop';
import { rangePercent, formatRange, parseRange } from '../engine/range';
import { isAbort, solverClient } from '../solver/client';
import type { NodeInfo } from '../solver/solver';
import { defaultSetup, setSetup, toConfig, useSetup, type SizeText, type SolverSetup } from '../store/session';
import { updateData, useUserData } from '../store/userData';
import { RangeGrid } from '../components/RangeGrid';
import { RangeEditor } from '../components/RangeEditor';
import { BoardPicker, CardGridPicker } from '../components/BoardPicker';
import { ActionList } from '../components/ActionList';
import { Board, CardText, Combo } from '../components/cards';
import { actionColors, heat } from '../components/colors';
import { Modal } from '../components/Modal';
import { WhyPanel } from '../components/WhyPanel';
import { EquityHelp } from '../components/EquityHelp';
import { RangeBreakdown } from '../components/RangeBreakdown';

const STREETS = ['flop', 'turn', 'river'] as const;

export function useSolverStatus() {
  return useSyncExternalStore(solverClient.subscribe, solverClient.getStatus);
}

/** Rebuild a saved (possibly imported, possibly old) setup, keeping only fields that make sense. */
function restoreSetup(raw: unknown): SolverSetup {
  const d = defaultSetup();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const range = (v: unknown, dflt: number[]) => typeof v === 'string' ? parseRange(v)
    : Array.isArray(v) && v.length === 169 && v.every((x) => typeof x === 'number' && x >= 0 && x <= 1) ? v as number[] : dflt;
  const num = (v: unknown, dflt: number, lo: number, hi: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const board = Array.isArray(r.board) && r.board.length >= 3 && r.board.length <= 5 && r.board.every((c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < 52) && new Set(r.board).size === r.board.length ? r.board as number[] : d.board;
  const sizeText = (v: any, dflt: SizeText) => ({ bet: typeof v?.bet === 'string' ? v.bet : dflt.bet, raise: typeof v?.raise === 'string' ? v.raise : dflt.raise });
  const sizes = { ...d.sizes };
  for (const k of STREETS) { const v = r.sizes?.[k]; if (Array.isArray(v)) sizes[k] = [sizeText(v[0], d.sizes[k][0]), sizeText(v[1], d.sizes[k][1])]; }
  return {
    spotName: typeof r.spotName === 'string' ? r.spotName : d.spotName,
    oopName: typeof r.oopName === 'string' ? r.oopName : d.oopName,
    ipName: typeof r.ipName === 'string' ? r.ipName : d.ipName,
    board, oopRange: range(r.oopRange, d.oopRange), ipRange: range(r.ipRange, d.ipRange), sizes,
    pot: num(r.pot, d.pot, 0.5, 10000), stack: num(r.stack, d.stack, 1, 10000),
    maxRaises: Math.round(num(r.maxRaises, d.maxRaises, 0, 4)), allIn: typeof r.allIn === 'boolean' ? r.allIn : d.allIn,
    allInThreshold: num(r.allInThreshold, d.allInThreshold, 0, 1), depth: Math.round(num(r.depth, d.depth, 0, 2)),
    iterations: Math.round(num(r.iterations, d.iterations, 1, 100000)), targetPct: num(r.targetPct, d.targetPct, 0, 100),
    // locks point into a specific tree; they are not carried over from saved files
    locks: [],
  };
}

function SetupPanel() {
  const st = useSetup();
  const data = useUserData();
  const status = useSolverStatus();
  const [edit, setEdit] = useState<null | 0 | 1>(null);
  const [est, setEst] = useState<{ nodes: number; mb: number } | null>(null);
  const [estErr, setEstErr] = useState('');
  const [saveName, setSaveName] = useState('');
  const presets = useMemo(presetSpots, []);
  const streetIdx = st.board.length - 3;
  const maxDepth = 2 - streetIdx;
  const depth = Math.min(st.depth, maxDepth);
  const modeled = STREETS.slice(streetIdx, streetIdx + depth + 1);
  const busy = status.state === 'running' || status.state === 'building';

  useEffect(() => {
    setEst(null); setEstErr('');
    const t = setTimeout(() => {
      if (busy) return;
      let cfg;
      try { cfg = toConfig({ ...st, depth }); } catch (e) { setEstErr((e as Error).message); return; }
      solverClient.estimate(cfg).then(setEst).catch((e) => { if (!isAbort(e)) setEstErr(e.message); });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, depth, busy]);

  const setSize = (street: (typeof STREETS)[number], p: 0 | 1, k: 'bet' | 'raise', v: string) => {
    const sizes = structuredClone(st.sizes);
    sizes[street][p][k] = v;
    setSetup({ sizes });
  };
  const depthLabels = [
    ['River only'],
    ['Turn only, river checked down', 'Turn and river'],
    ['Flop only, turn and river checked down', 'Flop and turn, river checked down', 'Flop, turn and river (very large)'],
  ][2 - streetIdx];

  return (
    <div className="panel col" style={{ gap: 12 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Spot setup</h2>
        <div className="spacer" />
        <select value="" onChange={(e) => {
          const p = presets.find((x) => x.name === e.target.value);
          if (p) setSetup({ spotName: p.name, oopName: p.oop, ipName: p.ip, oopRange: p.oopRange, ipRange: p.ipRange, pot: p.pot, stack: p.stack });
        }}>
          <option value="" disabled>Load preflop spot…</option>
          {presets.map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
      </div>
      <div className="small muted">{st.spotName}</div>
      <div className="grid2">
        {([0, 1] as const).map((p) => (
          <div key={p} className="col" style={{ gap: 4 }}>
            <span className="small muted">{p === 0 ? 'OOP' : 'IP'} range · {p === 0 ? st.oopName : st.ipName}</span>
            <button onClick={() => setEdit(p)} style={{ justifyContent: 'space-between' }}>
              <span>{rangePercent(p === 0 ? st.oopRange : st.ipRange).toFixed(1)}% of hands</span><span className="muted">Edit</span>
            </button>
          </div>
        ))}
      </div>
      <label className="field">Board
        <BoardPicker value={st.board} onChange={(board) => setSetup({ board })} />
      </label>
      <div className="row">
        <label className="field">Pot (bb)<input type="number" step="0.5" value={st.pot} onChange={(e) => setSetup({ pot: Math.max(0.5, +e.target.value || 0) })} /></label>
        <label className="field">Stack (bb)<input type="number" step="1" value={st.stack} onChange={(e) => setSetup({ stack: Math.max(1, +e.target.value || 0) })} /></label>
        <label className="field">Max raises<input type="number" min={0} max={4} value={st.maxRaises} onChange={(e) => setSetup({ maxRaises: Math.max(0, Math.min(4, Math.round(+e.target.value || 0))) })} /></label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 }}>
          <input type="checkbox" checked={st.allIn} onChange={(e) => setSetup({ allIn: e.target.checked })} /> All-in option
        </label>
      </div>
      <label className="field">Streets to solve
        <select value={depth} onChange={(e) => setSetup({ depth: +e.target.value })}>
          {depthLabels.map((l, i) => <option key={i} value={i}>{l}</option>)}
        </select>
      </label>
      <table className="t">
        <thead><tr><th>Bet sizes, % of pot</th><th>OOP bet</th><th>OOP raise</th><th>IP bet</th><th>IP raise</th></tr></thead>
        <tbody>
          {modeled.map((s) => (
            <tr key={s}>
              <td style={{ textTransform: 'capitalize' }}>{s}</td>
              {([0, 1] as const).flatMap((p) => (['bet', 'raise'] as const).map((k) => (
                <td key={p + k}><input style={{ width: 74 }} value={st.sizes[s][p][k]} onChange={(e) => setSize(s, p, k, e.target.value)} /></td>
              )))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label className="field">Max iterations<input type="number" value={st.iterations} onChange={(e) => setSetup({ iterations: Math.max(1, Math.min(100000, Math.round(+e.target.value || 0))) })} /></label>
        <label className="field">Stop at exploitability (% pot)<input type="number" step="0.1" value={st.targetPct} onChange={(e) => setSetup({ targetPct: Math.max(0, +e.target.value || 0) })} /></label>
      </div>
      {(st.locks ?? []).length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small muted">Node locks (applied on the next solve)</span>
          {st.locks.map((l, i) => (
            <div key={i} className="row small" style={{ gap: 6 }}>
              <span className="chip">🔒 {l.label}</span>
              <span className="muted">{l.freqs ? l.freqs.map((f) => `${Math.round(f * 100)}%`).join(' / ') : 'fixed per hand'}</span>
              <button className="ghost" onClick={() => setSetup({ locks: st.locks.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="small muted">
        {estErr ? <span style={{ color: 'var(--danger)' }}>{estErr}</span> : est ? `Tree: ${est.nodes.toLocaleString()} nodes, about ${Math.max(1, Math.round(est.mb))} MB.` : busy ? '' : 'Estimating tree size…'}
        {depth > 0 && streetIdx === 0 && ' Multi-street flop trees are slow in the browser. Keep bet sizes to one or two per street.'}
      </div>
      <div className="row">
        {busy ? <button className="danger" onClick={() => solverClient.stop()}>■ Stop</button>
          : <button className="primary" disabled={!!estErr} onClick={() => solverClient.solve(toConfig({ ...st, depth }), st.iterations, st.targetPct)}>▶ Solve</button>}
        <div className="spacer" />
        <input placeholder="Setup name" style={{ width: 130 }} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
        <button disabled={!saveName.trim()} onClick={() => {
          const name = saveName.trim();
          const setup = { ...st, oopRange: formatRange(st.oopRange), ipRange: formatRange(st.ipRange) };
          updateData((d) => { d.solverSetups = [...d.solverSetups.filter((s) => s.name !== name), { name, setup }]; });
          setSaveName('');
        }}>Save</button>
        {data.solverSetups.length > 0 && (
          <select value="" onChange={(e) => {
            const s = data.solverSetups.find((x) => x.name === e.target.value);
            if (!s) return;
            try { setSetup(restoreSetup(s.setup)); } catch (err) { setEstErr(`Could not load "${s.name}": ${(err as Error).message}`); }
          }}>
            <option value="" disabled>Load saved…</option>
            {data.solverSetups.map((s) => <option key={s.name}>{s.name}</option>)}
          </select>
        )}
      </div>
      {edit !== null && (
        <RangeEditor
          title={`${edit === 0 ? 'OOP' : 'IP'} range`}
          value={edit === 0 ? st.oopRange : st.ipRange}
          onSave={(r) => setSetup(edit === 0 ? { oopRange: r } : { ipRange: r })}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function StatusBar() {
  const s = useSolverStatus();
  const setup = useSetup();
  if (s.state === 'idle') return null;
  const pct = Math.min(100, (s.iteration / Math.max(1, setup.iterations)) * 100);
  return (
    <div className="panel col" style={{ gap: 6 }}>
      <div className="row small">
        <b>{s.state === 'building' ? 'Building tree…' : s.state === 'running' ? 'Solving…' : s.state === 'done' ? (s.stopped ? 'Stopped' : 'Solved') : 'Error'}</b>
        <span className="muted">Iteration {s.iteration}</span>
        {isFinite(s.exploit) && <span className="muted">Exploitability {s.exploit.toFixed(2)}% of pot</span>}
        <span className="muted">{(s.elapsed / 1000).toFixed(1)}s</span>
        {s.nodes && <span className="muted">{s.nodes.toLocaleString()} nodes</span>}
      </div>
      {s.state !== 'error' && <div className="progress"><div style={{ width: `${s.state === 'done' ? 100 : pct}%` }} /></div>}
      {s.error && <div className="err small">{s.error}</div>}
    </div>
  );
}

interface Step { label: string; value: number; kind: 'action' | 'card' }

/** Aggregate per-hand data of player p into the 169 grid cells. */
function aggregate(info: NodeInfo, p: 0 | 1, hands: { cls: number; c1: number; c2: number; w: number }[]) {
  const n = hands.length;
  const A = info.player === p && info.labels ? info.labels.length : 0;
  const reach = new Float64Array(169), possible = new Float64Array(169), ev = new Float64Array(169), eq = new Float64Array(169), evW = new Float64Array(169);
  const act = Array.from({ length: A }, () => new Float64Array(169));
  for (let h = 0; h < n; h++) {
    const c = hands[h].cls;
    const r = info.reach[p][h];
    possible[c] += 1;
    if (r <= 0) continue;
    reach[c] += r;
    if (isFinite(info.ev[p][h])) { ev[c] += r * info.ev[p][h]; evW[c] += r; }
    if (isFinite(info.equity[p][h])) eq[c] += r * info.equity[p][h];
    for (let a = 0; a < A; a++) act[a][c] += r * info.strategy![a * n + h];
  }
  return { reach, possible, ev: ev.map((x, i) => (evW[i] ? x / evW[i] : NaN)), eq: eq.map((x, i) => (reach[i] ? x / reach[i] : NaN)), act: act.map((arr) => arr.map((x, i) => (reach[i] ? x / reach[i] : 0))) };
}

function Explorer() {
  const status = useSolverStatus();
  const navigate = useNavigate();
  const [path, setPath] = useState<Step[]>([]);
  const [loaded, setInfo] = useState<{ info: NodeInfo; v: number } | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'strategy' | 'ev' | 'equity'>('strategy');
  const [who, setWho] = useState<'acting' | 0 | 1>('acting');
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const [why, setWhy] = useState<number | null>(null);
  const [locking, setLocking] = useState(false);
  const setupNow = useSetup();
  const version = solverClient.version;
  const ready = status.state === 'done' && solverClient.hands;
  // never render a node from an older solve against the new solve's hands
  const info = loaded && loaded.v === version ? loaded.info : null;

  useEffect(() => { setPath([]); setInfo(null); setErr(''); setPin(null); setHover(null); }, [version]);
  useEffect(() => { setWhy(null); }, [path, version, who]);
  const whyLoad = useCallback(() => solverClient.explain(path.map((s) => s.value), why ?? 0), [path, why]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const v = version;
    solverClient.query(path.map((s) => s.value)).then((i) => { if (live) { setInfo({ info: i, v }); setErr(''); } }).catch((e) => { if (live && !isAbort(e)) setErr(e.message); });
    return () => { live = false; };
  }, [path, ready, version]);

  if (!ready) {
    return (
      <div className="panel muted" style={{ minHeight: 200 }}>
        {status.state === 'running' || status.state === 'building' ? 'The strategy appears here when the solve finishes.' : 'Set up a spot and press Solve. A river or turn spot solves in seconds; flops take longer.'}
      </div>
    );
  }
  if (!info) return err ? <div className="panel col"><div className="err">{err}</div><div><button onClick={() => setPath([])}>Back to the start of the hand</button></div></div> : <div className="panel muted">Loading…</div>;
  const cfg = solverClient.config!;
  const hands = solverClient.hands!;
  const names = [setupNow.oopName, setupNow.ipName];
  const actor = info.player ?? 0;
  const p: 0 | 1 = who === 'acting' ? actor : who;
  const agg = aggregate(info, p, hands[p]);
  const labels = info.player === p ? info.labels ?? [] : [];
  const colors = actionColors(labels);
  const totalReach = agg.reach.reduce((s, x) => s + x, 0);
  const totals = labels.map((_, a) => agg.act[a].reduce((s, x, i) => s + x * agg.reach[i], 0) / (totalReach || 1));
  const evRange = (() => { let s = 0, w = 0; for (let i = 0; i < 169; i++) if (isFinite(agg.ev[i])) { s += agg.ev[i] * agg.reach[i]; w += agg.reach[i]; } return w ? s / w : NaN; })();
  const eqRange = (() => { let s = 0, w = 0; for (let i = 0; i < 169; i++) if (isFinite(agg.eq[i])) { s += agg.eq[i] * agg.reach[i]; w += agg.reach[i]; } return w ? s / w : NaN; })();
  const actionEvTotals = labels.map((_, a) => {
    let s = 0, w = 0;
    const n = hands[p].length;
    for (let h = 0; h < n; h++) { const r = info.reach[p][h] * info.strategy![a * n + h]; const v = info.actionEv![a * n + h]; if (r > 0 && isFinite(v)) { s += r * v; w += r; } }
    return w ? s / w : NaN;
  });
  const evMin = Math.min(...agg.ev.filter(isFinite)), evMax = Math.max(...agg.ev.filter(isFinite));
  const go = (s: Step) => { setPath([...path, s]); setHover(null); setPin(null); setWho('acting'); };
  const streetName = (n: number) => (n === 3 ? 'Flop' : n === 4 ? 'Turn' : 'River');

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="panel row" style={{ gap: 6 }}>
        <button className="ghost" onClick={() => setPath([])}>{streetName(cfg.board.length)} <Board cards={cfg.board} /></button>
        {path.map((s, i) => (
          <button key={i} className="ghost" onClick={() => setPath(path.slice(0, i + 1))}>
            › {s.kind === 'card' ? <CardText card={s.value} /> : s.label}
          </button>
        ))}
        <div className="spacer" />
        <span className="chip">Pot {info.pot.toFixed(1)}bb</span>
        <span className="chip">Behind {(cfg.stack - Math.max(...info.commit)).toFixed(1)}bb</span>
      </div>
      {err && <div className="err">{err}</div>}

      {info.kind === 'chance' && (
        <div className="panel col">
          <h2>Deal the {info.board.length === 3 ? 'turn' : 'river'}</h2>
          <CardGridPicker selected={[]} disabled={Array.from({ length: 52 }, (_, i) => i).filter((c) => !info.cards!.includes(c))} onToggle={(c) => go({ kind: 'card', value: c, label: cardStr(c) })} />
          <div><button onClick={() => { const c = info.cards![(Math.random() * info.cards!.length) | 0]; go({ kind: 'card', value: c, label: cardStr(c) }); }}>🎲 Random card</button></div>
        </div>
      )}
      {info.kind === 'terminal' && (
        <div className="panel">
          <h2>{info.folder! >= 0 ? `${names[info.folder!]} folds` : 'Showdown'}</h2>
          <p className="muted">{info.folder! >= 0 ? 'The hand ends here.' : info.board.length < 5 ? 'The remaining cards are dealt with no more betting in this model.' : 'Both players reveal their hands.'} The grids show each player's range on arrival.</p>
        </div>
      )}

      <div className="study">
        <div className="col">
          <div className="row">
            <div className="seg">
              <button className={view === 'strategy' ? 'on' : ''} onClick={() => setView('strategy')} disabled={!labels.length}>Strategy</button>
              <button className={view === 'ev' ? 'on' : ''} onClick={() => setView('ev')}>EV</button>
              <button className={view === 'equity' ? 'on' : ''} onClick={() => setView('equity')}>Equity</button>
            </div>
            <div className="seg">
              {info.kind === 'action' && <button className={who === 'acting' ? 'on' : ''} onClick={() => setWho('acting')}>Acting</button>}
              <button className={who === 0 || (who === 'acting' && actor === 0 && info.kind !== 'action') ? 'on' : ''} onClick={() => setWho(0)}>OOP {names[0]}</button>
              <button className={who === 1 ? 'on' : ''} onClick={() => setWho(1)}>IP {names[1]}</button>
            </div>
          </div>
          <RangeGrid
            hovered={hover ?? pin}
            onHover={setHover}
            onClick={(i) => setPin(pin === i ? null : i)}
            cell={(i) => {
              const w = agg.possible[i] ? agg.reach[i] / agg.possible[i] : 0;
              if (view === 'equity' || (view === 'strategy' && !labels.length)) return { weight: w, segments: [], bg: w > 0.001 ? heat(agg.eq[i]) : undefined, sub: w > 0.001 ? `${Math.round(agg.eq[i] * 100)}` : undefined };
              if (view === 'ev') return { weight: w, segments: [], bg: w > 0.001 ? heat(evMax > evMin ? (agg.ev[i] - evMin) / (evMax - evMin) : 0.5) : undefined, sub: w > 0.001 ? agg.ev[i].toFixed(1) : undefined };
              return { weight: w, segments: labels.map((_, a) => ({ f: agg.act[a][i], color: colors[a] })) };
            }}
          />
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="panel col">
            <div className="row">
              <h2 style={{ margin: 0 }}>{p === 0 ? 'OOP' : 'IP'} {names[p]}{info.player === p && info.kind === 'action' ? ' to act' : ''}</h2>
              <div className="spacer" />
              <span className="chip">EV {isFinite(evRange) ? evRange.toFixed(2) : '–'}bb</span>
              <span className="chip">Equity {isFinite(eqRange) ? (eqRange * 100).toFixed(1) : '–'}% <EquityHelp /></span>
            </div>
            {labels.length > 0 && (
              <ActionList
                items={labels.map((l, a) => ({ label: l, color: colors[a], freq: totals[a], combos: totals[a] * totalReach, ev: actionEvTotals[a] }))}
                onPick={(a) => go({ kind: 'action', value: a, label: `${p === 0 ? 'OOP' : 'IP'} ${labels[a]}` })}
              />
            )}
            {info.kind === 'action' && info.player !== p && <span className="muted small">Viewing the non-acting player's range. Switch to Acting to see the strategy.</span>}
            {labels.length > 0 && <span className="muted small">Click an action to see how the hand continues.</span>}
          </div>
          <HandDetail info={info} p={p} hands={hands[p]} cls={hover ?? pin} colors={colors} labels={labels} onWhy={info.kind === 'action' && info.player === p ? (i) => { setWhy(i); setPin(hands[p][i].cls); } : undefined} />
          {why !== null && info.kind === 'action' && info.player === p && (
            <div className="panel col">
              <div className="row"><b>Why {comboStr(hands[p][why].c1, hands[p][why].c2)} plays this way</b><div className="spacer" /><button className="ghost" onClick={() => setWhy(null)}>✕</button></div>
              <WhyPanel load={whyLoad} chosen={null} opp={names[1 - p]} title="Explanation" />
            </div>
          )}
          <div className="row">
            <button onClick={() => navigate('/trainer?mode=postflop')}>◎ Drill this spot</button>
            {info.kind === 'action' && <button onClick={() => setLocking(true)}>🔒 {info.locked ? 'Edit node lock' : 'Lock this node'}</button>}
          </div>
          {locking && info.kind === 'action' && (
            <LockDialog
              labels={info.labels!}
              totals={labels.length ? totals : info.labels!.map(() => 1 / info.labels!.length)}
              perClass={Array.from({ length: 169 }, (_, c) => (labels.length ? labels.map((_, a) => agg.act[a][c]) : []))}
              where={`${actor === 0 ? 'OOP' : 'IP'} at ${path.length ? path.map((x) => x.label).join(' › ') : 'the first decision'}`}
              onClose={() => setLocking(false)}
              onLock={(lock) => {
                const pathVals = path.map((x) => x.value);
                const key = pathVals.join(',');
                setSetup({ locks: [...(setupNow.locks ?? []).filter((l) => l.path.join(',') !== key), { ...lock, path: pathVals, label: `${actor === 0 ? 'OOP' : 'IP'} · ${path.length ? path.map((x) => x.label).join(' › ') : 'root'}` }] });
                setLocking(false);
              }}
            />
          )}
        </div>
      </div>
      <RangeBreakdown info={info} p={p} hands={hands} labels={labels} colors={colors} names={[names[0], names[1]]} />
    </div>
  );
}

function HandDetail({ info, p, hands, cls, colors, labels, onWhy }: { info: NodeInfo; p: 0 | 1; hands: { cls: number; c1: number; c2: number }[]; cls: number | null; colors: string[]; labels: string[]; onWhy?: (i: number) => void }) {
  if (cls === null) return <div className="panel muted">Hover a hand to see each combo. Click it to pin it, then press ? next to a combo for an explanation.</div>;
  const n = hands.length;
  const rows = hands.map((h, i) => ({ h, i })).filter((x) => x.h.cls === cls);
  return (
    <div className="panel col">
      <h2 style={{ margin: 0 }}>{HAND_CLASSES[cls]}</h2>
      {rows.length === 0 ? <span className="muted">{classCombos(HAND_CLASSES[cls]).length ? 'Not in this range, or blocked by the board.' : ''}</span> : (
        <table className="t">
          <thead><tr><th>Combo</th><th>Weight</th>{labels.length > 0 && <th style={{ width: '28%' }}>Strategy</th>}<th>EV</th><th>Equity <EquityHelp /></th></tr></thead>
          <tbody>
            {rows.map(({ h, i }) => {
              const r = info.reach[p][i];
              return (
                <tr key={i} style={{ opacity: r > 0 ? 1 : 0.4 }}>
                  <td style={{ whiteSpace: 'nowrap', paddingRight: 0 }}><Combo c1={h.c1} c2={h.c2} />{onWhy && r > 0 && <button className="whybtn" title="Why does this combo play this way?" aria-label="Why?" onClick={() => onWhy(i)}>?</button>}</td>
                  <td>{(r * 100).toFixed(0)}%</td>
                  {labels.length > 0 && (
                    <td title={labels.map((l, a) => `${l}: ${(info.strategy![a * n + i] * 100).toFixed(1)}% (EV ${info.actionEv![a * n + i].toFixed(2)})`).join('\n')}>
                      <div className="abar">{labels.map((_, a) => <div key={a} style={{ width: `${info.strategy![a * n + i] * 100}%`, background: colors[a] }} />)}</div>
                    </td>
                  )}
                  <td>{isFinite(info.ev[p][i]) ? info.ev[p][i].toFixed(2) : '–'}</td>
                  <td>{isFinite(info.equity[p][i]) ? (info.equity[p][i] * 100).toFixed(1) + '%' : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {labels.length > 0 && rows.length > 0 && <span className="muted small">Hover a strategy bar for exact frequencies and the EV of each action.</span>}
    </div>
  );
}

export function SolverPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Postflop solver</h1>
          <p>Heads-up equilibrium strategies computed in your browser with discounted counterfactual regret minimization. EV is in big blinds and counts the starting pot as up for grabs, so folding right away is 0.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(330px, 420px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="solver-layout">
        <div className="col" style={{ gap: 14 }}>
          <SetupPanel />
          <StatusBar />
        </div>
        <Explorer />
      </div>
    </div>
  );
}

function LockDialog({ labels, totals, perClass, where, onClose, onLock }: { labels: string[]; totals: number[]; perClass: number[][]; where: string; onClose: () => void; onLock: (l: { freqs?: number[]; perClass?: number[][] }) => void }) {
  const [freqs, setFreqs] = useState(() => totals.map((x) => Math.round(x * 100)));
  const colors = actionColors(labels);
  const sum = freqs.reduce((s, x) => s + x, 0);
  return (
    <Modal title="Lock this node" onClose={onClose} width={560}>
      <div className="col">
        <p className="muted">Fix the strategy for {where}, then solve again. The other player will adjust to exploit it, which shows how to play against opponents who deviate.</p>
        {labels.map((l, a) => (
          <div key={a} className="row">
            <span className="dot" style={{ width: 12, height: 12, borderRadius: 3, background: colors[a] }} />
            <span style={{ width: 150 }}>{l}</span>
            <input type="range" min={0} max={100} value={freqs[a]} onChange={(e) => { const f = [...freqs]; f[a] = +e.target.value; setFreqs(f); }} />
            <b style={{ width: 50, textAlign: 'right' }}>{sum ? Math.round((freqs[a] / sum) * 100) : 0}%</b>
          </div>
        ))}
        <span className="small muted">Frequencies are normalized to 100% and applied to every hand in the range.</span>
        <div className="row">
          {perClass[0]?.length > 0 && <button onClick={() => onLock({ perClass })}>Lock current strategy exactly</button>}
          <div className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!sum} onClick={() => onLock({ freqs: freqs.map((x) => x / sum) })}>Lock with these frequencies</button>
        </div>
      </div>
    </Modal>
  );
}
