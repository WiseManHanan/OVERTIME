/*
 * The static scaffold (doc §5.1). Pure gameplay geometry — floors, slots, gaps,
 * ladders — with no pixels in it. `src/panel/dims.ts` owns the pixel mapping;
 * this file owns what is walkable.
 *
 * Addressing is discrete `(floor, slot)`. Nothing exists between slots and no
 * position is ever fractional (invariant 4).
 */
import type { Screen } from "../panel/types";

export type Floor = 1 | 2 | 3 | 4;
export const FLOORS: readonly Floor[] = [1, 2, 3, 4];

/** The machine's grid width — ten slots per floor, indices 0–9. dims.ts derives
 *  its pixel pitch from this same constant, so the pose atlas and the on-screen
 *  grid stay locked together. */
export const SLOT_COUNT = 10;
export const MIN_SLOT = 0;
export const MAX_SLOT = SLOT_COUNT - 1;

/** Slots with no floor plate — they must be jumped (doc §5.1). */
const GAP_SLOTS: Partial<Record<Floor, readonly number[]>> = {
  2: [4, 5],
};

/** Slot on `floor` from which UP climbs to the next floor. `null` = no way up. */
const LADDER_UP: Record<Floor, number | null> = { 1: 9, 2: 0, 3: 9, 4: null };

/** Slot on `floor` from which DOWN descends one floor — the same physical ladder
 *  as `LADDER_UP[floor - 1]`. `null` = no way down (the ground). */
const LADDER_DOWN: Record<Floor, number | null> = { 1: null, 2: 9, 3: 0, 4: 9 };

export function slotInRange(slot: number): boolean {
  return Number.isInteger(slot) && slot >= MIN_SLOT && slot <= MAX_SLOT;
}

export function isGap(floor: Floor, slot: number): boolean {
  return (GAP_SLOTS[floor] ?? []).includes(slot);
}

/** A slot Pip can stand in: on the grid, and floored. */
export function isStandable(floor: Floor, slot: number): boolean {
  return slotInRange(slot) && !isGap(floor, slot);
}

export function ladderUpAt(floor: Floor, slot: number): boolean {
  return LADDER_UP[floor] === slot;
}

export function ladderDownAt(floor: Floor, slot: number): boolean {
  return LADDER_DOWN[floor] === slot;
}

export function floorAbove(floor: Floor): Floor | null {
  return floor < 4 ? ((floor + 1) as Floor) : null;
}

export function floorBelow(floor: Floor): Floor | null {
  return floor > 1 ? ((floor - 1) as Floor) : null;
}

/** Ladder slots on this floor, either end — where the climb pose can appear. */
export function climbSlots(floor: Floor): readonly number[] {
  const out: number[] = [];
  if (LADDER_UP[floor] !== null) out.push(LADDER_UP[floor] as number);
  if (LADDER_DOWN[floor] !== null) out.push(LADDER_DOWN[floor] as number);
  return out;
}

/**
 * Where a jump from `(floor, slot)` in direction `dir` lands, or `null` if it is
 * blocked (screen edge, or a gap too wide to clear from here).
 *
 * A single step into a standable slot is an ordinary hop. A step into a gap
 * clears that one contiguous run of gap slots and lands on the far lip — this is
 * the "gap that must be jumped" from §5.1. You must be standing on the lip for
 * it to work; from further back the jump is just an ordinary hop.
 */
export function jumpLanding(floor: Floor, slot: number, dir: -1 | 1): number | null {
  let t = slot + dir;
  if (isStandable(floor, t)) return t;
  if (!slotInRange(t)) return null; // walked off the edge
  while (slotInRange(t) && isGap(floor, t)) t += dir;
  return isStandable(floor, t) ? t : null;
}

/* ---- placement on the two physical screens (doc §5.1) ---------------------- */

/** Upper screen shows floors 3–4, lower shows floors 1–2. */
export function floorScreen(floor: Floor): Screen {
  return floor >= 3 ? "upper" : "lower";
}

/** Which of a screen's two rows a floor occupies: 0 = upper row, 1 = lower row.
 *  (upper screen: 4→0, 3→1;  lower screen: 2→0, 1→1) */
export function floorLocal(floor: Floor): 0 | 1 {
  return floor === 4 || floor === 2 ? 0 : 1;
}
