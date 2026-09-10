/*
 * Hazards (doc §5.4). Bruno throws two things down the scaffold:
 *
 *   barrel — a *low* hazard. Rolls one slot per tick. Jump it, or step off it.
 *   chair  — a *high* hazard. Rolls *two* slots per tick (the double-step lives
 *            in step.ts). Cannot be jumped; must be ducked. Unlocks from round 2.
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

/** Slots a chair covers per tick — the fast one (doc §5.4). */
export const HAZARD_SPEED: Record<HazardKind, 1 | 2> = {
  barrel: 1,
  chair: 2,
};

/** Chairs join the mix from this round on. */
export const CHAIR_UNLOCK_ROUND = 2;
const CHAIR_CHANCE = 0.34;

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
