import { RANKS, SUITS, SUIT_SYMBOLS, rankOf, suitOf } from '../engine/cards';

export function PlayingCard({ card, large }: { card?: number; large?: boolean }) {
  if (card === undefined || card < 0) return <span className={`pcard empty${large ? ' lg' : ''}`}>?</span>;
  return (
    <span className={`pcard suit-${SUITS[suitOf(card)]}${large ? ' lg' : ''}`}>
      {RANKS[rankOf(card)]}
      <small>{SUIT_SYMBOLS[suitOf(card)]}</small>
    </span>
  );
}

export function CardText({ card }: { card: number }) {
  return <span className={`ctext s-${SUITS[suitOf(card)]}`}>{RANKS[rankOf(card)]}{SUIT_SYMBOLS[suitOf(card)]}</span>;
}

export function Combo({ c1, c2 }: { c1: number; c2: number }) {
  const [a, b] = rankOf(c1) > rankOf(c2) || (rankOf(c1) === rankOf(c2) && c1 > c2) ? [c1, c2] : [c2, c1];
  return <span className="mono"><CardText card={a} /><CardText card={b} /></span>;
}

export function Board({ cards, slots = 0, large }: { cards: number[]; slots?: number; large?: boolean }) {
  const n = Math.max(slots, cards.length);
  return (
    <span className="row" style={{ gap: 4 }}>
      {Array.from({ length: n }, (_, i) => <PlayingCard key={i} card={cards[i]} large={large} />)}
    </span>
  );
}
