/*
 * `GameState` and its initial-state factory.
 *
 * Everything the simulation needs lives here as plain data. The seed and (later)
 * the clock mode are resolved once, at run start, and stored — `step()` never
 * reaches for the wall clock or `Math.random()` (invariant 1). No field that
 * names a position is ever fractional (invariant 4).
 */
import type { Floor } from "./world";
import { seedRng, type RngState } from "./rng";

export type Facing = -1 | 1;
export type PipPose = "stand" | "walk" | "climb" | "duck" | "jump";

export interface Pip {
  floor: Floor;
  /** Integer slot index, 0–9. */
  slot: number;
  /** Last horizontal direction pressed; the direction a jump travels. */
  facing: Facing;
  pose: PipPose;
  /** Air-ticks left in the current jump arc, not counting this one. 0 = grounded. */
  airborne: number;
}

export interface GameState {
  readonly seed: number;
  tick: number;
  rng: RngState;
  /** False until Pip first changes slot or floor — the title state (doc §9.3). */
  started: boolean;
  pip: Pip;
}

export const START_FLOOR: Floor = 1;
export const START_SLOT = 5;

export function initialState(seed: number): GameState {
  return {
    seed,
    tick: 0,
    rng: seedRng(seed),
    started: false,
    pip: {
      floor: START_FLOOR,
      slot: START_SLOT,
      facing: 1,
      pose: "stand",
      airborne: 0,
    },
  };
}

/** True while Pip is off the ground — the jump immunity window (doc §5.2). */
export function isAirborne(pip: Pip): boolean {
  return pip.pose === "jump";
}
