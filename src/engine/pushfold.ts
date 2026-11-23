// Heads-up push/fold equilibrium (SB shoves or folds, BB calls or folds) solved with
// fictitious play over the 169 hand classes, using the precomputed class-vs-class equities.
import { HAND_CLASSES, comboCount } from './cards';
import { classEq, classPairs } from './preflop';

export interface PushFoldResult { push: number[]; call: number[]; sbEv: number; iterations: number }

export function solvePushFold(stack: number, ante = 0, iterations = 400): PushFoldResult {
  const N = 169;
  const cnt = HAND_CLASSES.map(comboCount);
  const pot0 = 1.5 + 2 * ante; // dead money
  let push = new Array(N).fill(0.5);
  let call = new Array(N).fill(0.5);
  const S = stack; // each player's total stack including blinds/antes posted
  const sbPost = 0.5 + ante, bbPost = 1 + ante;
  for (let t = 1; t <= iterations; t++) {
    // BB best response to current SB push range
    const newCall = new Array(N).fill(0);
    for (let j = 0; j < N; j++) {
      let evCall = 0, w = 0;
      for (let i = 0; i < N; i++) {
        const c = classPairs(i, j) * push[i];
        if (!c) continue;
        const eqBB = classEq(j, i);
        evCall += c * (eqBB * 2 * S - S); // net vs start of hand
        w += c;
      }
      const evFold = -bbPost;
      newCall[j] = w > 0 && evCall / w > evFold ? 1 : 0;
    }
    // SB best response to BB call range
    const newPush = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let wCall = 0, wAll = 0, evCalled = 0;
      for (let j = 0; j < N; j++) {
        const c = classPairs(i, j);
        wAll += c;
        const cc = c * call[j];
        if (!cc) continue;
        wCall += cc;
        evCalled += cc * (classEq(i, j) * 2 * S - S);
      }
      const pCall = wAll ? wCall / wAll : 0;
      const evPush = (1 - pCall) * (pot0 - sbPost) + (wCall ? (evCalled / wCall) * pCall : 0);
      newPush[i] = evPush > -sbPost ? 1 : 0;
    }
    const a = 1 / (t + 1);
    push = push.map((x, i) => x * (1 - a) + newPush[i] * a);
    call = call.map((x, i) => x * (1 - a) + newCall[i] * a);
  }
  const p = push.map((x) => (x > 0.97 ? 1 : x < 0.03 ? 0 : Math.round(x * 100) / 100));
  const c = call.map((x) => (x > 0.97 ? 1 : x < 0.03 ? 0 : Math.round(x * 100) / 100));
  // SB EV of the equilibrium
  let ev = 0, tot = 0;
  for (let i = 0; i < N; i++) {
    let wCall = 0, wAll = 0, evCalled = 0;
    for (let j = 0; j < N; j++) {
      const k = classPairs(i, j);
      wAll += k;
      wCall += k * c[j];
      evCalled += k * c[j] * (classEq(i, j) * 2 * S - S);
    }
    const pCall = wAll ? wCall / wAll : 0;
    const evPush = (1 - pCall) * (pot0 - sbPost) + (wCall ? (evCalled / wCall) * pCall : 0);
    ev += cnt[i] * (p[i] * evPush + (1 - p[i]) * -sbPost);
    tot += cnt[i];
  }
  return { push: p, call: c, sbEv: ev / tot, iterations };
}
