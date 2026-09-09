/*
 * Scoring and the boredom meter (doc §6.2) — the anti-camping core of Phase 4.
 *
 * Pure: everything here is called from `step()` and must stay free of
 * `Date.now()`, `Math.random()` and the DOM (invariant 1). The meter lives in
 * `GameState` as an integer 0..BOREDOM_MAX.
 *
 * The design problem this solves: the original's optimal strategy is patience.
 * So points are the reward for *near-miss* play, not for survival — the meter
 * fills whenever Pip is passive and drains on the moves that read as skilled
 * (near misses, bolt releases, floor changes), and it scales every point
 * awarded: ×1.5 while low, ×0.25 while high, ×0 once the Steward is asleep.
 */

export const BOREDOM_MAX = 100;
/** Where the meter sits at the start of a round — mid-band, ×1.0. The ×1.5
 *  bonus is earned by playing dangerously, never handed out for free. */
export const BOREDOM_START = 50;
/** The asleep latch releases only once the meter falls back below this. */
export const BOREDOM_WAKE = 66;
/** Staying on one floor longer than this starts adding to the meter (doc §6.2). */
export const BOREDOM_STALE_FLOOR_TICKS = 20;

const FILL_SAFE = 4; // idle, and no hazard shares Pip's floor
const FILL_IDLE = 2; // idle, but something is on the floor with him
const FILL_STALE_FLOOR = 2; // per tick, once past BOREDOM_STALE_FLOOR_TICKS
const DRAIN_FLOOR = 20;
const DRAIN_NEAR_MISS = 28;
const DRAIN_BOLT = 15;

/** A near miss is the primary source of points (doc §5.3). */
export const NEAR_MISS_POINTS = 50;

export interface BoredomEvent {
  /** Pip moved, climbed, jumped, ducked, released a bolt, or scored a near miss. */
  engaged: boolean;
  floorChanged: boolean;
  /** A hazard shares Pip's floor — idling here is at least tense. */
  underThreat: boolean;
  /** More than BOREDOM_STALE_FLOOR_TICKS since the last floor change. */
  staleFloor: boolean;
  nearMisses: number;
  boltReleased: boolean;
}

export function clampBoredom(n: number): number {
  return n < 0 ? 0 : n > BOREDOM_MAX ? BOREDOM_MAX : Math.round(n);
}

export function nextBoredom(prev: number, ev: BoredomEvent): number {
  let d = 0;
  if (!ev.engaged) d += ev.underThreat ? FILL_IDLE : FILL_SAFE;
  if (ev.staleFloor) d += FILL_STALE_FLOOR;
  if (ev.floorChanged) d -= DRAIN_FLOOR;
  d -= ev.nearMisses * DRAIN_NEAR_MISS;
  if (ev.boltReleased) d -= DRAIN_BOLT;
  return clampBoredom(prev + d);
}

/** Asleep is a latch: it engages at a full meter and only releases once the
 *  meter has drained back below BOREDOM_WAKE (doc §6.2). */
export function nextAsleep(prev: boolean, boredom: number): boolean {
  if (boredom >= BOREDOM_MAX) return true;
  if (boredom < BOREDOM_WAKE) return false;
  return prev;
}

/** Score multiplier for the current meter (doc §6.2). Exactly 33% and 66% sit
 *  in the ×1.0 band. */
export function boredomMultiplier(boredom: number, asleep: boolean): number {
  if (asleep) return 0;
  const pct = boredom / BOREDOM_MAX;
  if (pct < 0.33) return 1.5;
  if (pct > 0.66) return 0.25;
  return 1;
}

export function awardPoints(raw: number, boredom: number, asleep: boolean): number {
  return Math.round(raw * boredomMultiplier(boredom, asleep));
}

export type StewardMood = "idle" | "bell" | "watch" | "asleep";

/** What the Steward is doing, derived from the meter. `bell` = rings it
 *  approvingly, `watch` = checks his watch, `asleep` = out cold (doc §6.2). */
export function stewardMood(boredom: number, asleep: boolean): StewardMood {
  if (asleep) return "asleep";
  const pct = boredom / BOREDOM_MAX;
  if (pct > 0.66) return "watch";
  if (pct < 0.33) return "bell";
  return "idle";
}
