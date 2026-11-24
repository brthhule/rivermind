import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { useUserData } from './store/userData';

// Pages load on demand so the first paint only pays for the shell and home page.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const PreflopPage = page(() => import('./pages/PreflopPage'), 'PreflopPage');
const SolverPage = page(() => import('./pages/SolverPage'), 'SolverPage');
const TrainerPage = page(() => import('./pages/TrainerPage'), 'TrainerPage');
const PracticePage = page(() => import('./pages/PracticePage'), 'PracticePage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const IcmPage = page(() => import('./pages/IcmPage'), 'IcmPage');
const AnalyzerPage = page(() => import('./pages/AnalyzerPage'), 'AnalyzerPage');
const EquityPage = page(() => import('./pages/EquityPage'), 'EquityPage');
const PushFoldPage = page(() => import('./pages/PushFoldPage'), 'PushFoldPage');
const DataPage = page(() => import('./pages/DataPage'), 'DataPage');

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="rm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35c2b0" />
          <stop offset="1" stopColor="#7c6cf0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#rm)" />
      <path d="M7 20c3-4 6-4 9 0s6 4 9 0" stroke="#0e1116" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M7 13c3-4 6-4 9 0s6 4 9 0" stroke="#0e1116" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

const NAV = [
  { section: 'Study' },
  { to: '/preflop', icon: '▦', label: 'Preflop charts' },
  { to: '/solver', icon: '⚙', label: 'Postflop solver' },
  { to: '/reports', icon: '▤', label: 'Aggregate reports' },
  { to: '/pushfold', icon: '⇪', label: 'Push / fold' },
  { to: '/icm', icon: '🏆', label: 'ICM tools' },
  { section: 'Practice' },
  { to: '/practice', icon: '♠', label: 'Play hands' },
  { to: '/trainer', icon: '◎', label: 'Spot drills' },
  { section: 'Review' },
  { to: '/analyzer', icon: '☰', label: 'Hand analyzer' },
  { to: '/equity', icon: '%', label: 'Equity calculator' },
  { section: 'You' },
  { to: '/data', icon: '⤓', label: 'My data' },
] as const;

function PageBoundary({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary>;
}

export default function App() {
  const data = useUserData();
  return (
    <HashRouter>
      <div className={`app${data.settings.fourColor ? '' : ' two-color'}`}>
        <aside className="sidebar">
          <NavLink to="/" className="brand"><Logo /><span>Rivermind</span></NavLink>
          <nav className="nav">
            {NAV.map((n, i) => 'section' in n
              ? <div key={i} className="nav-section">{n.section}</div>
              : <NavLink key={n.to} to={n.to}><span style={{ width: 18, textAlign: 'center' }}>{n.icon}</span><span className="label">{n.label}</span></NavLink>)}
          </nav>
          <div className="spacer" />
          <div className="small muted label" style={{ padding: '8px 10px' }}>Runs entirely in your browser. Save your work from My data.</div>
        </aside>
        <main className="main">
          <PageBoundary>
          <Suspense fallback={<div className="muted" style={{ padding: 24 }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/preflop" element={<PreflopPage />} />
            <Route path="/solver" element={<SolverPage />} />
            <Route path="/pushfold" element={<PushFoldPage />} />
            <Route path="/trainer" element={<TrainerPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/icm" element={<IcmPage />} />
            <Route path="/analyzer" element={<AnalyzerPage />} />
            <Route path="/equity" element={<EquityPage />} />
            <Route path="/data" element={<DataPage />} />
          </Routes>
          </Suspense>
          </PageBoundary>
        </main>
      </div>
    </HashRouter>
  );
}
