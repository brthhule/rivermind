import { useState } from 'react';
import { RANKS, SUITS, SUIT_SYMBOLS, parseCards, cardStr } from '../engine/cards';
import { Modal } from './Modal';
import { Board } from './cards';

const ORDER = [...RANKS].reverse();

export function CardGridPicker({ selected, onToggle, disabled = [] }: { selected: number[]; onToggle: (c: number) => void; disabled?: number[] }) {
  return (
    <div className="cardpick">
      {[3, 2, 1, 0].map((s) => ORDER.map((r) => {
        const c = RANKS.indexOf(r) * 4 + s;
        const on = selected.includes(c);
        const used = disabled.includes(c);
        return (
          <button key={c} className={`suit-${SUITS[s]}${on ? ' on' : ''}${used ? ' used' : ''}`} disabled={used} onClick={() => onToggle(c)}>
            {r}{SUIT_SYMBOLS[s]}
          </button>
        );
      }))}
    </div>
  );
}

export function BoardPicker({ value, onChange, min = 3, max = 5, dead = [] }: { value: number[]; onChange: (b: number[]) => void; min?: number; max?: number; dead?: number[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(value);
  const [text, setText] = useState(value.map(cardStr).join(''));
  const [err, setErr] = useState('');
  const randomize = (n: number) => {
    const pool = Array.from({ length: 52 }, (_, i) => i).filter((c) => !dead.includes(c));
    const out: number[] = [];
    while (out.length < n) { const c = pool[(Math.random() * pool.length) | 0]; if (!out.includes(c)) out.push(c); }
    return out;
  };
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ cursor: 'pointer' }} onClick={() => { setDraft(value); setText(value.map(cardStr).join('')); setOpen(true); }}>
          <Board cards={value} slots={min} />
        </span>
        <button onClick={() => { setDraft(value); setText(value.map(cardStr).join('')); setOpen(true); }}>Edit board</button>
        <button className="ghost" title="Random flop" onClick={() => onChange(randomize(value.length >= 3 ? value.length : 3))}>🎲 Random</button>
      </div>
      {open && (
        <Modal title="Choose board" onClose={() => setOpen(false)} width={640}>
          <div className="col">
            <div className="row">
              <input value={text} placeholder="e.g. Ah8d3c" onChange={(e) => {
                setText(e.target.value);
                try { const cs = parseCards(e.target.value); if (cs.length <= max) { setDraft(cs); setErr(''); } } catch (er) { setErr((er as Error).message); }
              }} />
              <Board cards={draft} slots={min} />
              {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
            </div>
            <CardGridPicker selected={draft} disabled={dead} onToggle={(c) => {
              const next = draft.includes(c) ? draft.filter((x) => x !== c) : draft.length < max ? [...draft, c] : draft;
              setDraft(next); setText(next.map(cardStr).join(''));
            }} />
            <div className="row">
              <button onClick={() => { const b = randomize(3); setDraft(b); setText(b.map(cardStr).join('')); }}>Random flop</button>
              <button onClick={() => { const b = randomize(4); setDraft(b); setText(b.map(cardStr).join('')); }}>Random turn</button>
              <button onClick={() => { const b = randomize(5); setDraft(b); setText(b.map(cardStr).join('')); }}>Random river</button>
              <div className="spacer" />
              <span className="muted small">{draft.length < min ? `Pick at least ${min} cards` : ''}</span>
              <button className="primary" disabled={draft.length < min} onClick={() => { onChange(draft); setOpen(false); }}>Use board</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
