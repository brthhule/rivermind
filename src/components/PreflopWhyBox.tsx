import { useState } from 'react';
import type { PreflopSpot } from '../engine/preflop';
import { preflopSummary, preflopWhy } from '../engine/preflopWhy';
import { EquityHelp } from './EquityHelp';

/** Preflop "Why?": a plain summary, with the detailed reasons one click away. */
export function PreflopWhyBox({ sp, cls, chosen, note }: { sp: PreflopSpot; cls: number; chosen: number; note?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="why col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}><div className="why-title">Why?</div><div className="spacer" /><EquityHelp text /></div>
      <div className="why-summary">{preflopSummary(sp, cls)}</div>
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen((x) => !x)}>{open ? 'Hide details' : 'Show details'}</button>
      {open && <ul className="why-list">{preflopWhy(sp, cls, chosen).map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}
