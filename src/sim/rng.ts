/*
 * mulberry32 — a tiny deterministic PRNG (doc §6.4). The entire run is
 * reproducible from `(seed, inputLog)` (invariant 2), so the generator state is
 * a single uint32 carried in `GameState` and advanced functionally: `nextFloat`
 * returns the value *and* the next state rather than mutating, which keeps
 * `step()` pure (invariant 1).
 *
 * Nothing in Phase 2 draws from the RNG yet — Pip's motion is fully determined
 * by the input log. The seed is threaded through now so the state shape is
 * honest from the start.
 */

export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Advance the generator; returns `[value in [0,1), nextState]`. */
export function nextFloat(state: RngState): [number, RngState] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

/** Integer in `[0, n)`. */
export function nextInt(state: RngState, n: number): [number, RngState] {
  const [f, next] = nextFloat(state);
  return [Math.floor(f * n), next];
}

/** Daily-mode seed derived from a calendar date as `YYYYMMDD` (doc §6.4). */
export function dailySeed(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
