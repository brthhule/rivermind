import { Link } from 'react-router-dom';
import { Logo } from '../App';
import { useUserData } from '../store/userData';

const CARDS = [
  { to: '/preflop', icon: '▦', title: 'Preflop charts', text: 'Browse 6-max 100bb strategies for every open, 3-bet, 4-bet and all-in spot, hand by hand.' },
  { to: '/solver', icon: '⚙', title: 'Postflop solver', text: 'Solve any flop, turn or river spot with your own ranges and bet sizes, lock nodes, and explore the strategy tree.' },
  { to: '/practice', icon: '♠', title: 'Play hands', text: 'Play full hands from preflop to river against a strategy that re-solves every street. Every decision is scored by EV lost.' },
  { to: '/reports', icon: '▤', title: 'Aggregate reports', text: 'Solve a spot across dozens of representative flops and compare bet frequencies, equity and EV by texture.' },
  { to: '/trainer', icon: '◎', title: 'Spot drills', text: 'Rapid-fire preflop decisions, or replay your latest solved spot against the solver.' },
  { to: '/builder', icon: '✎', title: 'Range builder', text: 'Paint a full preflop range from memory and get scored against the chart, with your biggest misses.' },
  { to: '/icm', icon: '🏆', title: 'ICM tools', text: 'Tournament equity for any stacks and payouts, plus push/fold ranges that account for ICM.' },
  { to: '/analyzer', icon: '☰', title: 'Hand analyzer', text: 'Upload hand histories to grade your preflop play, check equity on each street, and replay hands.' },
  { to: '/equity', icon: '%', title: 'Equity calculator', text: 'Range vs range equity for up to four players on any board, with a hand-by-hand heatmap.' },
  { to: '/pushfold', icon: '⇪', title: 'Push / fold', text: 'Short-stack shove and call ranges, solved to equilibrium for any stack depth.' },
];

export function HomePage() {
  const d = useUserData();
  const pf = d.stats.preflop, po = d.stats.postflop;
  return (
    <div className="col" style={{ gap: 20, maxWidth: 1100 }}>
      <div className="row" style={{ gap: 14 }}>
        <Logo size={44} />
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Rivermind</h1>
          <p className="muted" style={{ margin: 0 }}>Game theory study tools for No Limit Hold'em. Everything runs on your machine, with no account needed.</p>
        </div>
      </div>
      <div className="home-cards">
        {CARDS.map((c) => (
          <Link key={c.to} to={c.to} className="home-card">
            <h2><span style={{ color: 'var(--accent)' }}>{c.icon}</span>{c.title}</h2>
            <p>{c.text}</p>
          </Link>
        ))}
      </div>
      <div className="panel row" style={{ gap: 32 }}>
        <div className="stat"><span className="muted small">Preflop drills</span><b>{pf.attempts}</b></div>
        <div className="stat"><span className="muted small">Preflop score</span><b>{pf.attempts ? Math.round((pf.score / pf.attempts) * 100) : 0}%</b></div>
        <div className="stat"><span className="muted small">Postflop drills</span><b>{po.attempts}</b></div>
        <div className="stat"><span className="muted small">Hands played</span><b>{d.play.stats.hands}</b></div>
        <div className="stat"><span className="muted small">Saved ranges</span><b>{d.savedRanges.length}</b></div>
        <div className="spacer" />
        <Link to="/data"><button>Export or import my data</button></Link>
      </div>
    </div>
  );
}
