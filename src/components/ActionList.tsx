export interface ActionSummary { label: string; color: string; freq: number; combos?: number; ev?: number }
export function ActionList({ items, onPick, highlight }: { items: ActionSummary[]; onPick?: (i: number) => void; highlight?: number }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="abar">
        {items.map((a, i) => <div key={i} style={{ width: `${a.freq * 100}%`, background: a.color }} />)}
      </div>
      <div className="alist">
        {items.map((a, i) => (
          <div key={i} className="aitem" onClick={() => onPick?.(i)} style={highlight === i ? { borderColor: 'var(--accent)' } : undefined} title={onPick ? 'Take this action' : undefined}>
            <span className="dot" style={{ background: a.color }} />
            <span>{a.label}</span>
            <span className="muted small">{[a.combos !== undefined ? `${a.combos.toFixed(1)} combos` : '', a.ev !== undefined && isFinite(a.ev) ? `EV ${a.ev.toFixed(2)}` : ''].filter(Boolean).join(' · ')}</span>
            <b>{(a.freq * 100).toFixed(1)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}
