/** Colors for strategy actions. Fold and passive actions are fixed; bets get warmer as they get bigger. */
export function actionColors(labels: string[]): string[] {
  const betShades = ['#f2b33d', '#ec8a3a', '#e2603f', '#cf3f55', '#b0305e'];
  const bets = labels.map((l, i) => ({ l, i })).filter((x) => /^(Bet|Raise|3-bet|4-bet)/.test(x.l));
  const out: string[] = labels.map((l) => {
    if (/^Fold/.test(l)) return '#5577aa';
    if (/^(Check|Call)/.test(l)) return '#3fb68b';
    if (/^All-in/.test(l)) return '#8e2d6e';
    return '#e2603f';
  });
  bets.forEach((b, k) => {
    const idx = bets.length === 1 ? 2 : Math.round((k / (bets.length - 1)) * (betShades.length - 1));
    out[b.i] = betShades[idx];
  });
  return out;
}

/** Diverging scale for EV/equity heatmaps: 0 = red, 0.5 = gray, 1 = green. */
export function heat(t: number): string {
  if (!isFinite(t)) return '#11161e';
  const x = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
  const [r1, g1, b1] = x < 0.5 ? [201, 56, 62] : [58, 66, 80];
  const [r2, g2, b2] = x < 0.5 ? [58, 66, 80] : [47, 170, 120];
  const u = x < 0.5 ? x * 2 : (x - 0.5) * 2;
  return `rgb(${lerp(r1, r2, u)},${lerp(g1, g2, u)},${lerp(b1, b2, u)})`;
}
