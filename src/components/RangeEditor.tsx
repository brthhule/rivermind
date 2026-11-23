import { useMemo, useState } from 'react';
import { RangeGrid } from './RangeGrid';
import { Modal } from './Modal';
import { emptyRange, formatRange, parseRange, rangeCombos, rangePercent, type Range } from '../engine/range';
import { POSITIONS, rangeOf, spot } from '../engine/preflop';
import { updateData, useUserData } from '../store/userData';

/** Preset ranges taken from the preflop model, for quick loading. */
export function modelPresets(): { name: string; range: Range }[] {
  const out: { name: string; range: Range }[] = [];
  for (const p of POSITIONS.slice(0, 5)) out.push({ name: `${p} open`, range: rangeOf(spot(`rfi:${p}`), 1) });
  const pairs: [string, string][] = [['BB', 'BTN'], ['BB', 'CO'], ['BB', 'UTG'], ['BB', 'SB'], ['BTN', 'CO'], ['SB', 'BTN']];
  for (const [d, o] of pairs) {
    const s = spot(`vsopen:${d}:${o}`);
    out.push({ name: `${d} call vs ${o}`, range: rangeOf(s, 1) });
    out.push({ name: `${d} 3-bet vs ${o}`, range: rangeOf(s, 2) });
  }
  return out;
}

export function RangeEditor({ title, value, onSave, onClose }: { title: string; value: Range; onSave: (r: Range) => void; onClose: () => void }) {
  const [range, setRange] = useState<Range>(() => [...value]);
  const [brush, setBrush] = useState(100);
  const [text, setText] = useState(() => formatRange(value));
  const [err, setErr] = useState('');
  const [paintTo, setPaintTo] = useState<number>(1);
  const [hover, setHover] = useState<number | null>(null);
  const [saveName, setSaveName] = useState('');
  const data = useUserData();
  const presets = useMemo(modelPresets, []);
  const apply = (r: Range) => { setRange(r); setText(formatRange(r)); setErr(''); };
  return (
    <Modal title={title} onClose={onClose} width={1000}>
      <div className="study" style={{ gridTemplateColumns: 'minmax(320px, 520px) 1fr' }}>
        <div>
          <RangeGrid
            hovered={hover}
            onHover={setHover}
            cell={(i) => ({ weight: range[i] > 0 ? 1 : 0, segments: range[i] > 0 ? [{ f: range[i], color: '#35c2b0' }] : [], sub: range[i] > 0 && range[i] < 1 ? `${Math.round(range[i] * 100)}` : undefined })}
            onPaint={(i, first) => {
              const w = brush / 100;
              let target = paintTo;
              if (first) { target = Math.abs(range[i] - w) < 1e-6 ? 0 : w; setPaintTo(target); }
              const r = [...range]; r[i] = target; apply(r);
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted">Brush weight</span>
            <input type="range" min={5} max={100} step={5} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            <b>{brush}%</b>
            <div className="spacer" />
            <span className="chip">{rangeCombos(range).toFixed(0)} combos · {rangePercent(range).toFixed(1)}%</span>
          </div>
        </div>
        <div className="col">
          <label className="field">Range text (e.g. <span className="mono">TT+, AQs+, A5s-A2s, KQo, 76s:0.5</span>)
            <textarea rows={5} className="mono" value={text} onChange={(e) => {
              setText(e.target.value);
              try { setRange(parseRange(e.target.value)); setErr(''); } catch (er) { setErr((er as Error).message); }
            }} />
          </label>
          {err && <div className="err small">{err}</div>}
          <div className="row">
            <button onClick={() => apply(emptyRange())}>Clear</button>
            <button onClick={() => apply(new Array(169).fill(1))}>All hands</button>
            <button onClick={() => apply(range.map((w) => (w > 0 ? 1 : 0)))}>Round to 100%</button>
          </div>
          <h3 style={{ marginTop: 6 }}>Load preset</h3>
          <select onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) apply(p.range); e.target.value = ''; }} defaultValue="">
            <option value="" disabled>Model ranges (6-max, 100bb)…</option>
            {presets.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
          {data.savedRanges.length > 0 && (
            <select onChange={(e) => { const p = data.savedRanges.find((x) => x.name === e.target.value); if (p) apply(parseRange(p.range)); e.target.value = ''; }} defaultValue="">
              <option value="" disabled>My saved ranges…</option>
              {data.savedRanges.map((p) => <option key={p.name}>{p.name}</option>)}
            </select>
          )}
          <h3 style={{ marginTop: 6 }}>Save to my ranges</h3>
          <div className="row">
            <input placeholder="Name" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <button disabled={!saveName.trim()} onClick={() => {
              const name = saveName.trim();
              updateData((d) => { d.savedRanges = [...d.savedRanges.filter((r) => r.name !== name), { name, range: formatRange(range) }]; });
              setSaveName('');
            }}>Save</button>
          </div>
          <div className="spacer" />
          <div className="row">
            <div className="spacer" />
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={() => { onSave(range); onClose(); }}>Use this range</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
