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

/** `gapClosed` is the Safety Railing concession (doc §7.2) — the floor-2 gap
 *  becomes ordinary floor for the rest of the run, Pip and hazards alike. */
export function isGap(floor: Floor, slot: number, gapClosed = false): boolean {
  return !gapClosed && (GAP_SLOTS[floor] ?? []).includes(slot);
}

/** A slot Pip can stand in: on the grid, and floored. */
export function isStandable(floor: Floor, slot: number, gapClosed = false): boolean {
  return slotInRange(slot) && !isGap(floor, slot, gapClosed);
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

/** Bolt stations on floor 4 (doc §5.1). Releasing all four clears the round. */
export const BOLT_SLOTS: readonly number[] = [1, 3, 5, 7];

/** Index into `BOLT_SLOTS` for a slot on floor 4, or -1 if it is not a station. */
export function boltIndexAt(slot: number): number {
  return BOLT_SLOTS.indexOf(slot);
}

/**
 * Where a jump from `(floor, slot)` in direction `dir` lands, or `null` if it is
 * blocked (screen edge, or a gap too wide to clear from here).
 *
 * A `span`-slot step (1 normally, 2 with the Ergonomic Assessment concession,
 * doc §7.2) into a standable slot is an ordinary hop. A step into a gap clears
 * that one contiguous run of gap slots and lands on the far lip — this is the
 * "gap that must be jumped" from §5.1. You must be standing within `span` of
 * the lip for it to work; from further back the jump is just an ordinary hop.
 */
export function jumpLanding(
  floor: Floor,
  slot: number,
  dir: -1 | 1,
  span: 1 | 2 = 1,
  gapClosed = false,
): number | null {
  // A span-2 hop that overshoots the board falls back to span 1 — Ergonomic
  // Assessment (doc §7.2) is strictly a buff, so it must never turn a jump
  // that would otherwise land safely (e.g. slot 8 -> 9 at the east edge)
  // into one that instead sails off the edge and fails.
  for (let s = span; s >= 1; s--) {
    const t0 = slot + dir * s;
    if (isStandable(floor, t0, gapClosed)) return t0;
    if (!slotInRange(t0)) continue; // this span walks off the edge — try shorter
    let t = t0;
    while (slotInRange(t) && isGap(floor, t, gapClosed)) t += dir;
    if (isStandable(floor, t, gapClosed)) return t;
  }
  return null;
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
