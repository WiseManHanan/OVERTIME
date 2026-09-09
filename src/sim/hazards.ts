/*
 * Hazards (doc §5.4). Phase 3 has one kind: the barrel. It spawns at Bruno's
 * slot on floor 4 and rolls — one slot per tick — descending a floor whenever it
 * reaches a floor's end (down the ladder, reversing) or rolls over the floor-2
 * gap (straight through). It despawns rolling off the ground floor.
 *
 * Everything here is pure and integer (invariant 4). Spawn direction is the
 * first draw from the seeded RNG (invariant 2).
 */
import type { Floor } from "./world";
import { MAX_SLOT, MIN_SLOT, isGap } from "./world";
import { nextFloat, type RngState } from "./rng";

export type HazardKind = "barrel";

export interface Hazard {
  kind: HazardKind;
  floor: Floor;
  slot: number;
  dir: -1 | 1;
}

/** A barrel is a *low* hazard: a jump clears it, a duck does not (doc §5.4). */
export const HAZARD_HEIGHT: Record<HazardKind, "low" | "high"> = {
  barrel: "low",
};

/** Spawn a barrel at Bruno's slot, rolling a seeded-random way. */
export function spawnBarrel(brunoSlot: number, rng: RngState): [Hazard, RngState] {
  const [r, next] = nextFloat(rng);
  const dir: -1 | 1 = r < 0.5 ? -1 : 1;
  return [{ kind: "barrel", floor: 4, slot: brunoSlot, dir }, next];
}

/**
 * Advance one hazard by a tick. Returns the moved hazard, or `null` if it left
 * the board off the ground floor.
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
