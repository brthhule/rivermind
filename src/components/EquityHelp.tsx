import { useState } from 'react';
import { Modal } from './Modal';

/** Small "?" button that opens a beginner explanation of equity and pot odds. */
export function EquityHelp({ label = 'What is equity?', text = false }: { label?: string; text?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'equity' | 'outs'>('equity');
  return (
    <>
      {text
        ? <button type="button" className="link small helplink" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><span className="whybtn helpbtn" aria-hidden>?</span> {label}</button>
        : <button type="button" className="whybtn helpbtn" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>?</button>}
      {open && (
        <Modal title={tab === 'outs' ? 'Counting outs' : 'What is equity?'} onClose={() => setOpen(false)} width={560}>
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={tab === 'equity' ? 'on' : ''} onClick={() => setTab('equity')}>What is equity?</button>
            <button className={tab === 'outs' ? 'on' : ''} onClick={() => setTab('outs')}>Counting outs</button>
          </div>
          {tab === 'outs' ? <OutsGuide /> : <div className="col help-body" style={{ gap: 12 }}>
            <p><b>Equity is your share of the pot if all the cards were dealt out right now with no more betting.</b> It is the same as your chance of winning, with ties counted as half a win.</p>
            <div className="help-ex">
              <b>Example</b>
              <p>You have A♥K♥ and your opponent has 8♣8♦ before the flop. If you dealt out the five board cards thousands of times, A♥K♥ would win (or tie its share) about 48% of the time and the eights about 52%. So your equity is about 48%.</p>
            </div>
            <p><b>Against a range.</b> You rarely know your opponent's exact cards. Equity against a range is your average equity against every hand they could have, weighted by how often they would play each one. That is the number the Why? box and the solver show.</p>
            <p><b>Equity and pot odds.</b> When you face a bet, compare your equity with the share of the final pot you have to put in:</p>
            <div className="help-ex">
              <p>The pot is 10bb and your opponent bets 5bb. The pot is now 15bb and calling costs 5bb, so the final pot is 20bb.</p>
              <p>You need <b>5 ÷ 20 = 25%</b> equity to break even on the call. With 30% equity, calling makes money over time. With 20%, it loses unless you win extra on later streets.</p>
            </div>
            <p><b>Equity is not everything.</b> Hands with the same equity can play very differently. Being in position, being able to win more on later streets, or getting the opponent to fold all change what a hand is worth. That is why the solver sometimes calls with less equity than the pot odds need, or folds with more.</p>
          </div>}
        </Modal>
      )}
    </>
  );
}

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
/** chance of hitting at least one of `outs` cards in the next card(s), from the flop (47 unseen) or turn (46) */
const hitTurn = (o: number) => o / 47;
const hitRiver = (o: number) => o / 46;
const hitBoth = (o: number) => 1 - ((47 - o) * (46 - o)) / (47 * 46);

const EXAMPLES: { name: string; outs: number; hand: string; board: string; how: string }[] = [
  { name: 'Pocket pair to a set', outs: 2, hand: '5♣5♦', board: 'K♠ 9♥ 2♣', how: 'Against a king, only the two remaining fives help you.' },
  { name: 'Gutshot straight draw', outs: 4, hand: 'J♣9♦', board: 'Q♠ 8♥ 3♦', how: 'Any of the four tens makes 8-9-10-J-Q.' },
  { name: 'Two overcards', outs: 6, hand: 'A♥Q♣', board: '9♠ 6♦ 2♥', how: 'Against a pair of nines like 9♣8♣, three aces and three queens give you a better pair.' },
  { name: 'Open-ended straight draw', outs: 8, hand: '9♣8♣', board: '10♦ 7♠ 2♥', how: 'Four sixes and four jacks each complete a straight.' },
  { name: 'Flush draw', outs: 9, hand: 'A♥5♥', board: 'K♥ 9♥ 3♣', how: '13 hearts minus the 4 you can see leaves 9.' },
  { name: 'Flush draw plus gutshot', outs: 12, hand: 'A♠J♠', board: 'K♠ 10♦ 4♠', how: '9 spades, plus the 3 queens that are not spades.' },
  { name: 'Flush draw plus open-ended straight draw', outs: 15, hand: 'J♥10♥', board: '9♥ 8♥ 2♣', how: '9 hearts, plus the 6 queens and sevens that are not hearts. Count each card once.' },
];

/** Worked examples: count outs, then turn them into equity. */
function OutsGuide() {
  return (
    <div className="col help-body" style={{ gap: 12 }}>
      <p><b>An out is an unseen card that turns your losing hand into the winner.</b> Count your outs, then turn them into a percentage. That percentage is roughly your equity when you are behind now and win only if you hit.</p>
      <div className="help-ex">
        <b>Quick rule of 2 and 4</b>
        <p>On the <b>turn</b> with one card to come, multiply outs by <b>2</b>. On the <b>flop</b>, when you will see both the turn and river (usually only when all-in), multiply by <b>4</b>. Above 8 outs, the ×4 rule runs high: subtract one point for each out over 8.</p>
        <p>Example: 9 outs on the flop is about 9 × 4 − 1 = 35%. The exact number is {pc(hitBoth(9))}.</p>
      </div>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Draw</th><th>Outs</th><th>Next card</th><th>Turn and river</th></tr></thead>
          <tbody>
            {EXAMPLES.map((x) => (
              <tr key={x.name}><td>{x.name}</td><td>{x.outs}</td><td>{pc(hitTurn(x.outs))} / {pc(hitRiver(x.outs))}</td><td>{pc(hitBoth(x.outs))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="muted small">"Next card" is from the flop (47 unseen cards) / from the turn (46 unseen cards). "Turn and river" is the chance to hit at least once by the river, from the flop.</span>
      {EXAMPLES.map((x) => (
        <div key={x.name} className="help-ex">
          <b>{x.name}: {x.outs} outs</b>
          <p>You hold <b>{x.hand}</b> on <b>{x.board}</b>. {x.how}</p>
          <p>On the flop: about {pc(hitTurn(x.outs))} to hit on the turn, {pc(hitBoth(x.outs))} by the river. On the turn: about {pc(hitRiver(x.outs))} on the river.</p>
        </div>
      ))}
      <div className="help-ex">
        <b>Putting it together with pot odds</b>
        <p>On the turn you have a flush draw (9 outs, about {pc(hitRiver(9))}). Your opponent bets 5bb into 10bb, so you need 25% equity to call. 19.6% is short, so a call needs extra winnings on the river when you hit, or a cheaper price.</p>
      </div>
      <div className="help-ex">
        <b>Dirty outs: count carefully</b>
        <p>Some outs do not really win. If you have a flush draw and your opponent has a set, any card that pairs the board gives them a full house, so some of your flush cards are worthless. A straight card that also completes someone else's flush is "dirty" too. Discount outs like these. Count only cards that give you the best hand.</p>
        <p>Your hand can also already be ahead, like a pair against a draw. Then your equity is high and the outs that matter are your opponent's. The solver and the equity calculator count all of this exactly.</p>
      </div>
    </div>
  );
}
