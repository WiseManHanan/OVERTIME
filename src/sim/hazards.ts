/*
 * Hazards (doc §5.4). Bruno throws two things down the scaffold:
 *
 *   barrel — a *low* hazard. Rolls one slot per tick. Jump it, or step off it.
 *   chair  — a *high* hazard. Cannot be jumped; must be ducked. Unlocks from
 *            round 3 and ramps up to its full two-slots-per-tick roll (the
 *            double-step lives in step.ts) by CHAIR_FULL_SPEED_ROUND.
 *
 * Either one descends a floor whenever it reaches a floor's end (down the
 * ladder, reversing) or rolls over the floor-2 gap (straight through), and
 * despawns rolling off the ground floor.
 *
 * Everything here is pure and integer (invariant 4). Kind and direction are
 * draws from the seeded RNG (invariant 2).
 */
import type { Floor } from "./world";
import { MAX_SLOT, MIN_SLOT, isGap } from "./world";
import { nextFloat, type RngState } from "./rng";

export type HazardKind = "barrel" | "chair";

export interface Hazard {
  kind: HazardKind;
  floor: Floor;
  slot: number;
  dir: -1 | 1;
}

/** Barrels roll low (jump them); chairs roll high (duck them) — doc §5.4. */
export const HAZARD_HEIGHT: Record<HazardKind, "low" | "high"> = {
  barrel: "low",
  chair: "high",
};

/** Slots a chair covers per tick at full speed — the fast one (doc §5.4). */
export const HAZARD_SPEED: Record<HazardKind, 1 | 2> = {
  barrel: 1,
  chair: 2,
};

/** Chairs join the mix from this round on (doc §5.4: "chairs from 3" — round 2
 *  is a barrel-only breather, standing in for the coffee cup this build
 *  doesn't have yet, before the duck-only, double-speed hazard shows up). */
export const CHAIR_UNLOCK_ROUND = 3;
const CHAIR_CHANCE = 0.34;

/** From this round on, a chair hits its full doc-spec speed. Before it, a chair
 *  still moves at 1 slot/tick — same pace as a barrel, distinguished only by
 *  being duck-only — so the round it unlocks isn't also the round a player
 *  first has to react to a hazard that can close two slots inside a single
 *  tick. Full speed is still the steady-state identity; this only softens
 *  the introduction. */
export const CHAIR_FULL_SPEED_ROUND = 5;

/** The speed a hazard actually rolls at this round — barrels are always 1;
 *  chairs ramp from 1 up to their full HAZARD_SPEED.chair (doc §5.4). */
export function hazardSpeed(kind: HazardKind, round: number): 1 | 2 {
  if (kind === "barrel") return HAZARD_SPEED.barrel;
  return round >= CHAIR_FULL_SPEED_ROUND ? HAZARD_SPEED.chair : 1;
}

/**
 * Spawn a hazard at Bruno's current slot, rolling a seeded-random way. Once
 * chairs are unlocked, roughly a third of throws are chairs.
 */
export function spawnHazard(
  fromSlot: number,
  round: number,
  rng: RngState,
): [Hazard, RngState] {
  const [k, r1] = nextFloat(rng);
  const kind: HazardKind =
    round >= CHAIR_UNLOCK_ROUND && k < CHAIR_CHANCE ? "chair" : "barrel";
  const [d, r2] = nextFloat(r1);
  const dir: -1 | 1 = d < 0.5 ? -1 : 1;
  return [{ kind, floor: 4, slot: fromSlot, dir }, r2];
}

/**
 * Advance one hazard by a single slot. Returns the moved hazard, or `null` if it
 * left the board off the ground floor. A chair calls this twice per tick
 * (step.ts) so its floor-descent and end-reversal stay correct mid-sweep.
 */
export function advanceHazard(h: Hazard): Hazard | null {
  const next = h.slot + h.dir;

  if (next < MIN_SLOT || next > MAX_SLOT) {
    if (h.floor === 1) return null; // rolled off the ground
    return { ...h, floor: (h.floor - 1) as Floor, dir: (-h.dir) as -1 | 1 };
  }

  if (isGap(h.floor, next)) {
    // Only floor 2 has a gap, so `floor - 1` here is always a real floor.
    return { ...h, floor: (h.floor - 1) as Floor, slot: next };
  }

  return { ...h, slot: next };
}
