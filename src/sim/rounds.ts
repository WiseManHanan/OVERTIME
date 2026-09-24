/*
 * The round speed table (doc §6.1). The whole difficulty curve is here: rounds
 * get faster, hazards spawn more often, and Bruno swipes more often.
 *
 * `speed` and cadence are tuned independently. Cadence (ticks between hazard
 * spawns / Bruno's swipes) is a lookup for rounds 1–6, then eases off one
 * tick every two rounds from round 7 on, down to a floor. `speed` is just
 * rounds 1 and 2's fixed, cached values, then a flat 7.5% compounding
 * increase every round after that — one continuous ramp rather than a
 * lookup-then-formula split.
 *
 * `speed` is a real-time multiplier — main.ts divides the base tick interval
 * (250ms, BASE_TICK_MS) by it. It never enters `step()`, which stays
 * tick-counted and pure (invariant 1).
 */

export interface RoundParams {
  /** Tick-rate multiplier: 1.0 is the base 250ms tick. */
  speed: number;
  /** Ticks between barrel spawns. */
  hazardCadence: number;
  /** Ticks between Bruno's swipes on floor 4. */
  swipeCadence: number;
}

// Flattened well below the original curve (round 6 used to be cadence 8/7,
// easing to a floor by round ~11) — the ramp itself was the complaint, not
// any single round's tuning, so cadence here eases at roughly half the old
// rate and settles on a much gentler floor.
const CADENCE_TABLE: readonly { hazardCadence: number; swipeCadence: number }[] = [
  { hazardCadence: 14, swipeCadence: 9 }, // round 1
  { hazardCadence: 13, swipeCadence: 9 }, // round 2
  { hazardCadence: 13, swipeCadence: 9 }, // round 3
  { hazardCadence: 12, swipeCadence: 8 }, // round 4
  { hazardCadence: 12, swipeCadence: 8 }, // round 5
  { hazardCadence: 11, swipeCadence: 8 }, // round 6
];

// Rounds 1 and 2 are fixed, cached values — cut a flat 35% below the
// original table's own pace (1.0 -> 0.65, 1.04 -> 0.676): a first 20% cut
// still played too fast for a first climb. Every round after that compounds
// SPEED_GROWTH_PER_ROUND off round 2's own cached value, not a separate
// hand-tuned lookup through round 6 and a different formula from round 7 —
// one consistent ramp for every round past the opening two.
const OPENING_SPEED: readonly [number, number] = [0.65, 0.676];
const SPEED_GROWTH_PER_ROUND = 1.075;
const SPEED_CAP = 1.3;

const MIN_HAZARD_CADENCE = 8;
const MIN_SWIPE_CADENCE = 6;

export function roundParams(round: number): RoundParams {
  const r = Math.max(1, Math.floor(round));

  const speed =
    r <= 2
      ? OPENING_SPEED[r - 1]!
      : Math.min(SPEED_CAP, OPENING_SPEED[1] * SPEED_GROWTH_PER_ROUND ** (r - 2));

  if (r <= CADENCE_TABLE.length) {
    const { hazardCadence, swipeCadence } = CADENCE_TABLE[r - 1]!;
    return { speed, hazardCadence, swipeCadence };
  }

  const over = r - CADENCE_TABLE.length; // rounds past 6
  const last = CADENCE_TABLE[CADENCE_TABLE.length - 1]!;
  return {
    speed,
    hazardCadence: Math.max(MIN_HAZARD_CADENCE, last.hazardCadence - Math.floor(over / 2)),
    swipeCadence: Math.max(MIN_SWIPE_CADENCE, last.swipeCadence - Math.floor(over / 2)),
  };
}
