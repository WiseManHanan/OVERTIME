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

const TABLE: readonly RoundParams[] = [
  { speed: 1.0, hazardCadence: 14, swipeCadence: 9 },
  { speed: 1.1, hazardCadence: 12, swipeCadence: 9 },
  { speed: 1.2, hazardCadence: 11, swipeCadence: 8 },
  { speed: 1.32, hazardCadence: 10, swipeCadence: 8 },
  { speed: 1.45, hazardCadence: 9, swipeCadence: 7 },
  { speed: 1.6, hazardCadence: 8, swipeCadence: 7 },
];

const SPEED_CAP = 2.6;
const MIN_HAZARD_CADENCE = 6;
const MIN_SWIPE_CADENCE = 5;

export function roundParams(round: number): RoundParams {
  const r = Math.max(1, Math.floor(round));
  if (r <= TABLE.length) return TABLE[r - 1]!;

  const over = r - TABLE.length; // rounds past 6
  return {
    speed: Math.min(SPEED_CAP, 1.6 * Math.pow(1.1, over)),
    hazardCadence: Math.max(MIN_HAZARD_CADENCE, 8 - over),
    swipeCadence: Math.max(MIN_SWIPE_CADENCE, 7 - over),
  };
}
