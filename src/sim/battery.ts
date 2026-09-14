/*
 * The failing console (doc §7.3). From round 6 in standard time — round 4 in
 * OVERTIME — the battery starts to drain, and as it falls the panel attacks
 * *information* rather than reflexes: it dims, one of Pip's poses sticks
 * (dark, so he vanishes in it) while a phantom one sticks lit, the whole panel
 * blacks out for a tick now and then, and at zero the run simply ends.
 *
 * Everything here is pure (invariant 1). The drain and the stuck-pose picks
 * flow through the seeded RNG (invariant 2).
 */
import type { ClockMode } from "./clock";
import { nextInt, type RngState } from "./rng";
import type { Floor } from "./world";
import { FLOORS, SLOT_COUNT, isStandable } from "./world";

export const BATTERY_DEPLETE = 0.14; // per round, once it starts
export const BATTERY_CLEAN_BONUS = 0.05; // a round cleared with no miss claws some back

const FAILS_FROM_STD = 6;
const FAILS_FROM_OVERTIME = 4;
const DIM_BELOW = 0.75;
const STUCK_BELOW = 0.5;
const BLACKOUT_BELOW = 0.3;
const BLACKOUT_EVERY = 40; // ticks

/** The round the console starts to die on (doc §7.3). */
export function batteryFailsFrom(clock: ClockMode): number {
  return clock === "overtime" ? FAILS_FROM_OVERTIME : FAILS_FROM_STD;
}

/** Battery after finishing `roundJustFinished` (about to start the next). */
export function nextBattery(
  prev: number,
  roundJustFinished: number,
  clock: ClockMode,
  roundClean: boolean,
): number {
  if (roundJustFinished + 1 < batteryFailsFrom(clock)) return prev;
  const b = prev - BATTERY_DEPLETE + (roundClean ? BATTERY_CLEAN_BONUS : 0);
  return Math.min(1, Math.max(0, b));
}

/** Global alpha for the lit-segment pass (doc §4.3 step 5 / §7.3). */
export function batteryContrast(b: number): number {
  if (b >= DIM_BELOW) return 1;
  if (b >= BLACKOUT_BELOW) return 0.85;
  return 0.68;
}

/** Audio frequency multiplier — the voice detunes as the battery sags (§4.5). */
export function batteryDetune(b: number): number {
  return 0.94 + 0.06 * Math.max(0, Math.min(1, b));
}

export function batteryDead(b: number): boolean {
  return b <= 0;
}

/** Below this, one Pip pose sticks dark and one phantom sticks lit for the round. */
export function hasStuckSegment(b: number): boolean {
  return b > 0 && b < STUCK_BELOW;
}

/** True on the single tick the whole panel drops (the sim keeps running). */
export function isBlackoutTick(b: number, tick: number): boolean {
  return b > 0 && b < BLACKOUT_BELOW && tick % BLACKOUT_EVERY === 0;
}

export type StuckPose = {
  f: Floor;
  s: number;
  pose: "stand" | "walk" | "duck" | "jump";
};

const STUCK_POSES: StuckPose["pose"][] = ["stand", "walk", "duck", "jump"];

/** Pick a random standable pose-cell for a stuck segment. Deterministic. */
export function pickStuckPose(rng: RngState): [StuckPose, RngState] {
  let r = rng;
  let f: Floor = 1;
  let s = 0;
  for (let tries = 0; tries < 8; tries++) {
    const [fi, r1] = nextInt(r, FLOORS.length);
    const [si, r2] = nextInt(r1, SLOT_COUNT);
    r = r2;
    f = FLOORS[fi]!;
    s = si;
    if (isStandable(f, s)) break;
  }
  const [pi, r3] = nextInt(r, STUCK_POSES.length);
  return [{ f, s, pose: STUCK_POSES[pi]! }, r3];
}

export function sameCell(a: StuckPose | null, f: number, s: number, pose: string): boolean {
  return a !== null && a.f === f && a.s === s && a.pose === pose;
}
