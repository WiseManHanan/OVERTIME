/*
 * Mara's ratings (doc §7.4, "recurring bits"). She's at the top, on the
 * phone, and rates every miss out of ten — a harsh but fair judge. Pure and
 * seed-driven (invariant 1/2): the roll consumes the run's RNG like a hazard
 * spawn or a card draw.
 */
import { nextFloat, type RngState } from "./rng";

/** Ticks the rating stays on screen once shown. */
export const MARA_RATING_TICKS = 40;

/** Weight per rating 1..10 (index 0 = a "1"), summing to 100 so it doubles as
 *  a percentage. Centred low-mid — "harsh" — with a 10 rare but possible. */
const RATING_WEIGHTS: readonly number[] = [5, 8, 12, 15, 18, 15, 12, 8, 5, 2];

/** A rating 1..10 for the miss that just happened. */
export function rollMaraRating(rng: RngState): [number, RngState] {
  const [roll, next] = nextFloat(rng);
  const target = roll * 100;
  let acc = 0;
  for (let i = 0; i < RATING_WEIGHTS.length; i++) {
    acc += RATING_WEIGHTS[i]!;
    if (target < acc) return [i + 1, next];
  }
  return [RATING_WEIGHTS.length, next]; // unreachable — weights sum to exactly 100
}
