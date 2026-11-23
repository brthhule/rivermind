import { useRef, useState } from 'react';
import { downloadText, getData, importData, serialize, updateData, useUserData, defaultData, deserialize } from '../store/userData';
import { parseRange, rangePercent } from '../engine/range';

export function DataPage() {
  const d = useUserData();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [paste, setPaste] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = (text: string) => {
    try {
      const incoming = deserialize(text);
      importData(text, mode);
      setMsg({ ok: true, text: `Imported ${incoming.savedRanges.length} ranges, ${incoming.solverSetups.length} solver setups and ${incoming.stats.preflop.attempts + incoming.stats.postflop.attempts} drill results (${mode}).` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>My data</h1>
          <p>Rivermind has no accounts. Your ranges, drill settings, practice stats and saved solver setups are kept in this browser and can be saved to a text file. Upload that file later, on any device, to get everything back.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="panel col">
          <h2>Export</h2>
          <p className="muted">Downloads a plain text file with all of your data.</p>
          <div><button className="primary" onClick={() => downloadText(`rivermind-data-${stamp}.txt`, serialize(getData()))}>⤓ Download my data</button></div>
          <span className="small muted">Last change {new Date(d.updated).toLocaleString()}</span>
        </div>
        <div className="panel col">
          <h2>Import</h2>
          <div className="seg">
            <button className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>Merge with current</button>
            <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Replace current</button>
          </div>
          <div className="row">
            <button onClick={() => fileRef.current?.click()}>⤒ Upload data file</button>
            <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(doImport); e.target.value = ''; }} />
          </div>
          <textarea rows={3} className="mono small" placeholder="…or paste the file contents here" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div><button disabled={!paste.trim()} onClick={() => { doImport(paste); setPaste(''); }}>Import pasted text</button></div>
          {msg && <div className={msg.ok ? 'notice' : 'err'} style={msg.ok ? { borderColor: 'var(--good)', background: '#15261f', color: '#bfe8d5' } : undefined}>{msg.text}</div>}
        </div>
      </div>

      <div className="panel col" style={{ marginTop: 16 }}>
        <h2>Saved ranges ({d.savedRanges.length})</h2>
        {d.savedRanges.length === 0 ? <span className="muted">Save ranges from any range editor (solver, equity calculator) and they will show up here.</span> : (
          <table className="t">
            <thead><tr><th>Name</th><th>Size</th><th>Range</th><th /></tr></thead>
            <tbody>
              {d.savedRanges.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{(() => { try { return rangePercent(parseRange(r.range)).toFixed(1) + '%'; } catch { return '?'; } })()}</td>
                  <td className="mono small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.range}</td>
                  <td><button className="ghost danger" onClick={() => updateData((x) => { x.savedRanges = x.savedRanges.filter((y) => y.name !== r.name); })}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel col" style={{ marginTop: 16 }}>
        <h2>Saved solver setups ({d.solverSetups.length})</h2>
        {d.solverSetups.length === 0 ? <span className="muted">Name and save a setup on the solver page to reuse it.</span> : (
          <div className="row">{d.solverSetups.map((s) => (
            <span key={s.name} className="chip">{s.name} <button className="ghost" style={{ padding: '0 4px' }} onClick={() => updateData((x) => { x.solverSetups = x.solverSetups.filter((y) => y.name !== s.name); })}>✕</button></span>
          ))}</div>
        )}
      </div>

      <div className="panel col" style={{ marginTop: 16 }}>
        <h2>Settings</h2>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={d.settings.fourColor} onChange={(e) => updateData((x) => { x.settings.fourColor = e.target.checked; })} /> Four-color deck
        </label>
        <div className="row">
          <button className="danger" onClick={() => { if (confirm('Reset all practice stats? Ranges and setups are kept.')) updateData((x) => { x.stats = defaultData().stats; }); }}>Reset practice stats</button>
          <button className="danger" onClick={() => { if (confirm('Erase all Rivermind data in this browser? Export first if you want a copy.')) updateData(() => defaultData()); }}>Erase everything</button>
        </div>
      </div>
    </div>
  );
}
