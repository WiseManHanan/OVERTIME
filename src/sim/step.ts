/*
 * The pure reducer: `(state, input) => state` (invariant 1).
 *
 * One call is one logical tick. `input` is the single action drained from the
 * one-slot buffer at this tick boundary (doc §4.4), or `null` for an idle tick.
 * No `Date.now()`, no `Math.random()`, no DOM — this file is testable in a bare
 * node process and replayable frame-for-frame.
 */
import type { GameState, Pip, PipPose } from "./state";
import {
  floorAbove,
  floorBelow,
  isStandable,
  jumpLanding,
  ladderDownAt,
  ladderUpAt,
} from "./world";

export type InputAction = "left" | "right" | "up" | "down" | "a";

/** Air-ticks a jump lasts in total (doc §5.2: "airborne for 2 ticks"). */
const JUMP_AIR_TICKS = 2;

export function step(state: GameState, input: InputAction | null): GameState {
  const p = state.pip;
  let { floor, slot, facing, airborne } = p;
  let pose: PipPose = "stand";

  if (airborne > 0) {
    // Mid-arc. The tick is spent flying; the landing slot was fixed at takeoff
    // and no new action is accepted until Pip is grounded.
    airborne -= 1;
    pose = "jump";
    return advance(state, { floor, slot, facing, pose, airborne }, state.started);
  }

  switch (input) {
    case "left":
    case "right": {
      const dir = input === "left" ? -1 : 1;
      facing = dir;
      const target = slot + dir;
      if (isStandable(floor, target)) {
        slot = target;
        pose = "walk";
      }
      break;
    }
    case "up": {
      if (ladderUpAt(floor, slot)) {
        const up = floorAbove(floor);
        if (up !== null) {
          floor = up;
          pose = "climb";
        }
      }
      break;
    }
    case "down": {
      if (ladderDownAt(floor, slot)) {
        const down = floorBelow(floor);
        if (down !== null) {
          floor = down;
          pose = "climb";
        }
      } else {
        pose = "duck";
      }
      break;
    }
    case "a": {
      const land = jumpLanding(floor, slot, facing);
      airborne = JUMP_AIR_TICKS - 1;
      pose = "jump";
      if (land !== null) slot = land;
      break;
    }
    case null:
      break;
  }

  // The title state clears on Pip's first actual move, not on a no-op key
  // press (doc §9.3, "First movement starts the game").
  const started = state.started || floor !== p.floor || slot !== p.slot;
  return advance(state, { floor, slot, facing, pose, airborne }, started);
}

function advance(
  prev: GameState,
  pip: Pip,
  started: boolean,
): GameState {
  return { ...prev, tick: prev.tick + 1, started, pip };
}
