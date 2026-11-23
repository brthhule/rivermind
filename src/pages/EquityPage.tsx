import { useState } from 'react';
import { expandRange, formatRange, parseRange, rangePercent, type Range } from '../engine/range';
import { monteCarloEquity, type EquityResult } from '../engine/equity';
import { parseCards } from '../engine/cards';
import { RangeEditor } from '../components/RangeEditor';
import { BoardPicker } from '../components/BoardPicker';
import { RangeGrid } from '../components/RangeGrid';
import { heat } from '../components/colors';

interface Player { text: string; range: Range }
const COLORS = ['#35c2b0', '#f2b33d', '#7c6cf0', '#e2603f'];

export function EquityPage() {
  const [players, setPlayers] = useState<Player[]>([
    { text: 'AKs, AKo, QQ+', range: parseRange('AKs, AKo, QQ+') },
    { text: '22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+', range: parseRange('22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+') },
  ]);
  const [board, setBoard] = useState<number[]>([]);
  const [res, setRes] = useState<EquityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const setText = (i: number, text: string) => {
    const next = [...players];
    next[i] = { ...next[i], text };
    // exact hands like "AhKd" are accepted too
    try {
      if (/^([2-9TJQKA][cdhs]){2}$/i.test(text.trim())) {
        const [a, b] = parseCards(text.trim());
        next[i].range = new Array(169).fill(0);
        (next[i] as Player & { exact?: [number, number] }).exact = [a, b];
      } else if (/^\s*(random|any|100%?)\s*$/i.test(text)) { next[i].range = new Array(169).fill(1); delete (next[i] as Player & { exact?: unknown }).exact; }
      else { next[i].range = parseRange(text); delete (next[i] as Player & { exact?: unknown }).exact; }
      setErr('');
    } catch (e) { setErr((e as Error).message); }
    setPlayers(next);
  };
  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const combos = players.map((p) => {
        const ex = (p as Player & { exact?: [number, number] }).exact;
        return ex ? [{ c1: ex[0], c2: ex[1], id: 0, cls: 0, w: 1 }] : expandRange(p.range, board);
      });
      if (combos.some((c) => !c.length)) { setErr('Every player needs at least one hand.'); setBusy(false); return; }
      setRes(monteCarloEquity(combos, board, 60000));
      setBusy(false);
    }, 10);
  };
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Equity calculator</h1>
          <p>Range against range, or exact hands, for two to four players. Results use 60,000 Monte Carlo samples with card removal.</p>
        </div>
      </div>
      <div className="study">
        <div className="col">
          {players.map((p, i) => (
            <div key={i} className="panel col" style={{ borderLeft: `3px solid ${COLORS[i]}` }}>
              <div className="row">
                <b>Player {i + 1}</b>
                <span className="muted small">{(p as Player & { exact?: unknown }).exact ? 'exact hand' : `${rangePercent(p.range).toFixed(1)}% of hands`}</span>
                <div className="spacer" />
                {res && res.samples > 0 && <b style={{ fontSize: 18 }}>{(res.equity[i] * 100).toFixed(2)}%</b>}
                <button onClick={() => setEdit(i)}>Grid</button>
                {players.length > 2 && <button className="ghost" onClick={() => setPlayers(players.filter((_, k) => k !== i))}>✕</button>}
              </div>
              <input className="mono" value={p.text} onChange={(e) => setText(i, e.target.value)} />
              {res && res.samples > 0 && <div className="small muted">Win {(res.win[i] * 100).toFixed(1)}% · Tie {(res.tie[i] * 100).toFixed(1)}%</div>}
            </div>
          ))}
          <div className="row">
            {players.length < 4 && <button onClick={() => setPlayers([...players, { text: 'random', range: new Array(169).fill(1) }])}>+ Add player</button>}
            <div className="spacer" />
            <BoardPicker value={board} onChange={setBoard} min={0} />
            {board.length > 0 && <button className="ghost" onClick={() => setBoard([])}>Clear board</button>}
          </div>
          <div className="row">
            <button className="primary" onClick={run} disabled={busy || !!err}>{busy ? 'Calculating…' : 'Calculate'}</button>
            {err && <span className="err small">{err}</span>}
          </div>
        </div>
        <div className="panel col">
          <h3>Player 1 equity by hand</h3>
          {res && res.samples > 0 && !(players[0] as Player & { exact?: unknown }).exact ? (
            <RangeGrid cell={(i) => {
              const w = players[0].range[i];
              const e = res.classEquity[i];
              return { weight: w, segments: [], bg: w > 0 && isFinite(e) ? heat(e) : undefined, sub: w > 0 && isFinite(e) ? `${Math.round(e * 100)}` : undefined };
            }} />
          ) : <span className="muted">Calculate with a range for player 1 to see a heatmap.</span>}
        </div>
      </div>
      {edit !== null && (
        <RangeEditor title={`Player ${edit + 1} range`} value={players[edit].range} onClose={() => setEdit(null)} onSave={(r) => {
          const next = [...players];
          next[edit] = { text: formatRange(r), range: r };
          setPlayers(next);
        }} />
      )}
    </div>
  );
}
