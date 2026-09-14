/*
 * The round speed table (doc §6.1). The whole difficulty curve is here: rounds
 * get faster, hazards spawn more often, and Bruno swipes more often. Rounds 1–6
 * are a lookup; round 7 and up follow the formula.
 *
 * `speed` is a real-time multiplier — main.ts divides the base tick interval
 * (170ms) by it. It never enters `step()`, which stays tick-counted and pure
 * (invariant 1).
 */

export interface RoundParams {
  /** Tick-rate multiplier: 1.0 is the base 170ms tick. */
  speed: number;
  /** Ticks between barrel spawns. */
  hazardCadence: number;
  /** Ticks between Bruno's swipes on floor 4. */
  swipeCadence: number;
}

// Flattened well below the original curve (round 6 used to be 1.6x / cadence
// 8-7, capping at 2.6x by round ~11) — the ramp itself was the complaint, not
// any single round's tuning, so every knob here grows at roughly half the old
// rate and settles on a much gentler asymptote.
const TABLE: readonly RoundParams[] = [
  { speed: 1.0, hazardCadence: 14, swipeCadence: 9 },
  { speed: 1.04, hazardCadence: 13, swipeCadence: 9 },
  { speed: 1.08, hazardCadence: 13, swipeCadence: 9 },
  { speed: 1.13, hazardCadence: 12, swipeCadence: 8 },
  { speed: 1.18, hazardCadence: 12, swipeCadence: 8 },
  { speed: 1.24, hazardCadence: 11, swipeCadence: 8 },
];

const SPEED_CAP = 1.8;
const MIN_HAZARD_CADENCE = 8;
const MIN_SWIPE_CADENCE = 6;

export function roundParams(round: number): RoundParams {
  const r = Math.max(1, Math.floor(round));
  if (r <= TABLE.length) return TABLE[r - 1]!;

  const over = r - TABLE.length; // rounds past 6
  const last = TABLE[TABLE.length - 1]!;
  return {
    speed: Math.min(SPEED_CAP, last.speed * Math.pow(1.04, over)),
    hazardCadence: Math.max(MIN_HAZARD_CADENCE, last.hazardCadence - Math.floor(over / 2)),
    swipeCadence: Math.max(MIN_SWIPE_CADENCE, last.swipeCadence - Math.floor(over / 2)),
  };
}
