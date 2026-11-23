# Rivermind

Game theory study tools for No Limit Hold'em that run entirely in the browser. No accounts and no server:
the production build is a static site, and all user data can be exported to a text file and imported later.

## Features

| Area | What it does |
| --- | --- |
| Preflop charts | 6-max cash, 100bb. Navigate opens, 3-bets, 4-bets and all-ins hand by hand. Strategy grid, action totals, per-hand equity vs the villain range. |
| Postflop solver | Heads-up Discounted CFR solver in a Web Worker. Any flop, turn or river; custom ranges, pot, stack, bet and raise sizes per street and player, raise cap, all-in threshold. Explore the tree (actions and dealt cards), with strategy, EV and equity views and a per-combo table. |
| Push / fold | Heads-up SB shove / BB call equilibrium for 1 to 25bb, with antes. |
| Trainer | Preflop drills over chosen spot types and positions, graded by strategy frequency. Postflop drills that play the last solved spot against the solver, graded by EV loss. |
| Hand analyzer | Parses PokerStars hand histories. Grades preflop decisions against the model and shows equity vs the opponent's modeled range and pot odds on later streets. |
| Equity calculator | 2 to 4 players, ranges or exact hands, any board, per-hand heatmap. |
| My data | Export / import (merge or replace) of saved ranges, solver setups, drill preferences and stats as a `.txt` file. Data also autosaves in the browser. |

## Running

```bash
npm install
npm run dev        # development server
npm test           # unit tests (evaluator, ranges, equity, preflop model, solver, parser)
npm run build      # static site in dist/
npx vite preview   # serve the built site locally
```

`dist/` can be uploaded to any static host (GitHub Pages, Netlify, S3). It uses hash routing and relative
asset paths, so it works from a subfolder. Opening `dist/index.html` straight from disk will not run the
solver, because browsers block Web Workers on `file://` pages.

## How it works

- `src/engine/evaluator.ts`: bitmask 5 to 7 card hand evaluator.
- `src/engine/preflop.ts`: preflop model. Class-vs-class equities (`src/data/preflopEquity.json`,
  regenerate with `npm run precompute`) drive heuristic value / bluff / call allocation with soft
  boundaries. These charts are study baselines, not solver output.
- `src/solver/solver.ts`: vectorized DCFR over a betting tree with chance nodes. Showdowns use a sorted
  O(n) sweep with card-removal correction; when the tree stops before the river, remaining runouts are
  averaged (a precomputed matrix is used when that is cheaper). Exploitability is measured with a best
  response pass.
- `src/store/userData.ts`: the export file is a header line followed by JSON.

## Known limits

- Postflop solving is heads-up only. Multi-street flop trees are slow in JavaScript; the default flop mode
  solves the flop and checks down the turn and river, which overstates equity realization.
- No suit isomorphism or pre-solved solution library yet.
- Preflop charts are from a heuristic model, not a full preflop solve.
