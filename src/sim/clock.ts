/*
 * Clock awareness (doc §7.1). The real system clock is read once, at run start,
 * and resolved to a `ClockMode` that is stored as a field of `GameState` —
 * `step()` never reads the wall clock itself (invariant 1). Same time of day,
 * same mode, every run.
 *
 * Each mode bends the run: tick speed, the score multiplier, how fast the
 * boredom meter fills, and when Bruno turns up for work.
 */

export type ClockMode = "night" | "morning" | "standard" | "lunch" | "slump" | "overtime";

/** Which mode `now` falls in (doc §7.1). Pure — pass a fixed Date to test it. */
export function resolveClock(now: Date): ClockMode {
  const h = now.getHours();
  if (h < 6) return "night";
  if (h < 9) return "morning";
  if (h < 13) return "standard";
  if (h < 14) return "lunch";
  if (h < 18) return "slump";
  return "overtime";
}

export interface ClockParams {
  /** Shown on the shell's status strip. */
  label: string;
  /** Real-time tick multiplier — stacks with the round speed table (doc §6.1). */
  speed: number;
  /** Score multiplier on every point awarded (OVERTIME: all points doubled). */
  points: number;
  /** Extra multiplier on the round-clear bonus only (NIGHT: clearing before he
   *  wakes doubles the payout — here, all round, since he never wakes). */
  clearMult: number;
  /** Boredom-fill multiplier (SLUMP: everyone wants it over with). */
  boredomRate: number;
  /** Ticks into the round for which Bruno is off the platform — no pacing, no
   *  swipe, no throws (LUNCH: out to lunch; NIGHT: asleep all round). */
  brunoAwayUntil: number;
  /** Ticks into the round Bruno paces at half rate (MORNING: not a morning
   *  person). */
  brunoSlowUntil: number;
}

const AWAY_ALL_ROUND = 1_000_000;

const PARAMS: Record<ClockMode, ClockParams> = {
  night: { label: "NIGHT", speed: 1.0, points: 1.0, clearMult: 2.0, boredomRate: 1.0, brunoAwayUntil: AWAY_ALL_ROUND, brunoSlowUntil: 0 },
  morning: { label: "MORNING", speed: 1.0, points: 1.0, clearMult: 1.0, boredomRate: 1.0, brunoAwayUntil: 0, brunoSlowUntil: 30 },
  standard: { label: "STANDARD", speed: 1.0, points: 1.0, clearMult: 1.0, boredomRate: 1.0, brunoAwayUntil: 0, brunoSlowUntil: 0 },
  lunch: { label: "LUNCH", speed: 1.0, points: 1.0, clearMult: 1.0, boredomRate: 1.0, brunoAwayUntil: 60, brunoSlowUntil: 0 },
  slump: { label: "SLUMP", speed: 0.9, points: 1.0, clearMult: 1.0, boredomRate: 1.6, brunoAwayUntil: 0, brunoSlowUntil: 0 },
  overtime: { label: "OVERTIME", speed: 1.25, points: 2.0, clearMult: 1.0, boredomRate: 1.0, brunoAwayUntil: 0, brunoSlowUntil: 0 },
};

export function clockParams(mode: ClockMode): ClockParams {
  return PARAMS[mode];
}
