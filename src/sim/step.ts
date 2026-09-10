/*
 * The pure reducer: `(state, input) => state` (invariant 1).
 *
 * One call is one logical tick. `input` is the single action drained from the
 * one-slot buffer at this tick boundary (doc §4.4), or `null` for an idle tick.
 * No `Date.now()`, no `Math.random()`, no DOM — testable in a bare node process
 * and replayable frame-for-frame from `(seed, inputLog)` (invariant 2).
 *
 * The run is a small state machine: title -> playing -> cleared -> playing ...
 * with `over` as a trap state (main.ts turns an A press there into a fresh run).
 */
import type { GameState, Pip, PipPose } from "./state";
import {
  BOLT_RELEASE_TICKS,
  BRUNO_MAX_SLOT,
  BRUNO_MIN_SLOT,
  BRUNO_PACE_TICKS,
  BRUNO_SLOT,
  CONSOLE_SLOT,
  MISSES_ALLOWED,
  POINTS_PER_BOLT,
  POINTS_PER_ROUND_CLEAR,
  ROUND_CLEARED_TICKS,
  SWIPE_REACH,
  freshPip,
  isAirborne,
} from "./state";
import {
  floorAbove,
  floorBelow,
  isStandable,
  jumpLanding,
  ladderDownAt,
  ladderUpAt,
  type Floor,
} from "./world";
import { HAZARD_SPEED, advanceHazard, spawnHazard, type Hazard } from "./hazards";
import { hazardHits } from "./collision";
import { roundParams } from "./rounds";
import {
  BOREDOM_START,
  BOREDOM_STALE_FLOOR_TICKS,
  NEAR_MISS_POINTS,
  awardPoints,
  nextAsleep,
  nextBoredom,
} from "./scoring";

export type InputAction = "left" | "right" | "up" | "down" | "a";

/** Air-ticks a jump lasts in total (doc §5.2: "airborne for 2 ticks"). */
const JUMP_AIR_TICKS = 2;

export function step(state: GameState, input: InputAction | null): GameState {
  switch (state.phase) {
    case "title":
      return stepTitle(state, input);
    case "playing":
      return stepPlaying(state, input);
    case "cleared":
      return stepCleared(state);
    case "over":
      // A trap state, but the swing that ended the run still needs to fall (the
      // GAME OVER screen shows the upper panel — a frozen Bruno reads as a bug).
      return { ...state, tick: state.tick + 1, swipe: Math.max(0, state.swipe - 1) };
  }
}

/* ---- Pip -------------------------------------------------------------------- */

interface PipStep {
  pip: Pip;
  /** BOLT_SLOTS index whose release just completed this tick, or -1. */
  releasedBolt: number;
}

/**
 * Resolve one tick of Pip from `input`. Movement is locked during a bolt release
 * and during a jump arc; otherwise LEFT/RIGHT walk, UP climbs or starts a bolt
 * release, DOWN descends or ducks, A jumps (doc §5.2).
 */
function movePip(p: Pip, input: InputAction | null, bolts: readonly boolean[]): PipStep {
  let { floor, slot, facing, airborne, releasing, releasingBolt } = p;
  let pose: PipPose = "stand";
  let releasedBolt = -1;

  if (releasing > 0) {
    releasing -= 1;
    if (releasing === 0) {
      pose = "stand";
      releasedBolt = releasingBolt;
      releasingBolt = -1;
    } else {
      pose = "release";
    }
    return { pip: { floor, slot, facing, pose, airborne, releasing, releasingBolt }, releasedBolt };
  }

  if (airborne > 0) {
    airborne -= 1;
    if (airborne > 0) {
      // still mid-arc — locked
      pose = "jump";
      return { pip: { floor, slot, facing, pose, airborne, releasing, releasingBolt }, releasedBolt };
    }
    // landed this tick: `airborne` is 0 and matches "grounded", and this tick's
    // input applies immediately — fall through to the movement switch.
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
      } else if (floor === 4 && slot === CONSOLE_SLOT) {
        // Haul the next lever that is still up (levers pull left to right).
        const nextLever = bolts.findIndex((b) => b !== true);
        if (nextLever >= 0) {
          releasing = BOLT_RELEASE_TICKS;
          releasingBolt = nextLever;
          pose = "release";
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
      airborne = JUMP_AIR_TICKS; // > 0 for both airborne ticks; hits 0 on landing
      pose = "jump";
      if (land !== null) slot = land;
      break;
    }
    case null:
      break;
  }

  return { pip: { floor, slot, facing, pose, airborne, releasing, releasingBolt }, releasedBolt };
}

/* ---- phases --------------------------------------------------------------- */

function stepTitle(state: GameState, input: InputAction | null): GameState {
  const { pip } = movePip(state.pip, input, state.bolts);
  const moved = pip.floor !== state.pip.floor || pip.slot !== state.pip.slot;
  if (!moved) {
    return { ...state, tick: state.tick + 1, pip };
  }
  const params = roundParams(state.round);
  return {
    ...state,
    tick: state.tick + 1,
    phase: "playing",
    pip,
    spawnCountdown: params.hazardCadence,
    swipeCountdown: params.swipeCadence,
  };
}

function stepPlaying(state: GameState, input: InputAction | null): GameState {
  const params = roundParams(state.round);
  const pipFrom = state.pip;
  let rng = state.rng;
  let misses = state.misses;
  // Points accrue raw this tick and are scaled once, at the end, by the boredom
  // multiplier (doc §6.2) — so "no points while the Steward sleeps" is exact.
  let rawPoints = 0;

  // 0 — Bruno paces his beat on the platform (whole and intact until the last
  //     holder goes), reversing at the ends. He throws from, and swings from,
  //     wherever he now stands (doc §5.5).
  let brunoSlot = state.brunoSlot;
  let brunoDir = state.brunoDir;
  if ((state.tick + 1) % BRUNO_PACE_TICKS === 0) {
    if (brunoSlot + brunoDir < BRUNO_MIN_SLOT || brunoSlot + brunoDir > BRUNO_MAX_SLOT) {
      brunoDir = -brunoDir as -1 | 1;
    }
    brunoSlot += brunoDir;
  }

  // 1 — Pip
  const outcome = movePip(state.pip, input, state.bolts);
  let pip = outcome.pip;
  let bolts = state.bolts;
  const hauled = outcome.releasedBolt >= 0; // a lever came down this tick
  if (hauled) {
    bolts = bolts.map((b, i) => (i === outcome.releasedBolt ? true : b));
    rawPoints += POINTS_PER_BOLT;
  }

  // 2 — Bruno's swipe (doc §5.5). The swing arm shows one tick early (the windup
  //     frame) so the hit is telegraphed, like the hazards. It costs a miss and
  //     knocks a lever back up — the one Pip is hauling, or the last one pulled
  //     if he is loitering at the console — but never one secured this same tick.
  //     Resolved before the haul warps Pip away, so the swing still lands.
  let swipeCountdown = state.swipeCountdown - 1;
  let swipe = Math.max(0, state.swipe - 1);
  if (swipeCountdown === 1) {
    swipe = 2; // windup: arm out, no hit yet
  }
  if (swipeCountdown <= 0) {
    swipeCountdown = params.swipeCadence;
    swipe = 2;
    const inReach =
      pip.floor === 4 &&
      Math.abs(pip.slot - brunoSlot) <= SWIPE_REACH &&
      pip.pose !== "jump" &&
      pip.pose !== "climb";
    if (inReach) {
      misses += 1;
      if (pip.releasing > 0) {
        const bi = pip.releasingBolt;
        pip = { ...pip, releasing: 0, releasingBolt: -1, pose: "stand" };
        if (bi >= 0) bolts = bolts.map((b, i) => (i === bi ? false : b));
      } else if (pip.slot === CONSOLE_SLOT) {
        // knock the last-pulled lever back up (not one secured this tick)
        const bi = bolts.reduce(
          (last, b, i) => (b === true && i !== outcome.releasedBolt ? i : last),
          -1,
        );
        if (bi >= 0) bolts = bolts.map((b, i) => (i === bi ? false : b));
      }
    }
  }

  // The haul's reward: the stage is swept clear of hazards and Pip drops back to
  // the start for the next climb (doc §5.5).
  if (hauled) pip = freshPip();
  const pipMoved = pip.slot !== pipFrom.slot || pip.floor !== pipFrom.floor;

  // 3 — hazards roll, and are checked against Pip on every slot they pass
  //     through. A barrel covers one slot a tick; a chair two, sub-stepped so
  //     its floor-descent and end-reversal stay right (doc §5.4). A hazard that
  //     hits (ends on Pip's slot, or crosses straight through him) is a miss and
  //     is gone; otherwise it survives at its final slot. A survivor that landed
  //     on the slot Pip just vacated, or passed beneath his jump, is a near miss
  //     — the primary source of points (doc §5.3).
  const survivors: Hazard[] = [];
  let nearMisses = 0;
  for (const h of hauled ? [] : state.hazards) {
    let cur: Hazard | null = h;
    let hit = false;
    for (let i = 0; i < HAZARD_SPEED[h.kind] && cur !== null; i++) {
      const from = cur;
      const next = advanceHazard(from);
      if (next === null) {
        cur = null; // rolled off the board
        break;
      }
      const crossed =
        !isAirborne(pip) &&
        pip.floor === pipFrom.floor &&
        next.floor === pip.floor &&
        from.floor === pip.floor &&
        from.slot === pip.slot &&
        next.slot === pipFrom.slot;
      if (hazardHits(pip, next) || crossed) {
        hit = true;
        break;
      }
      cur = next;
    }
    if (hit) {
      misses += 1;
      continue;
    }
    if (cur === null) continue;
    survivors.push(cur);
    const vacated =
      pipMoved && cur.floor === pipFrom.floor && cur.slot === pipFrom.slot;
    const beneath =
      isAirborne(pip) && cur.floor === pip.floor && cur.slot === pip.slot;
    if (vacated || beneath) nearMisses += 1;
  }
  rawPoints += nearMisses * NEAR_MISS_POINTS;

  // 4 — spawn: the new hazard appears now but is checked only from next tick, so
  //     every one gets at least a tick of telegraph (doc §5.4). A haul tick
  //     spawns nothing — the stage just went quiet — and resets the cadence.
  let spawnCountdown = hauled ? params.hazardCadence : state.spawnCountdown - 1;
  if (!hauled && spawnCountdown <= 0) {
    const [hazard, next] = spawnHazard(brunoSlot, state.round, rng);
    rng = next;
    survivors.push(hazard);
    spawnCountdown = params.hazardCadence;
  }

  // 6 — the boredom meter (doc §6.2). It fills while Pip is passive and drains
  //     on the plays that read as skilled; nothing here touches the wall clock.
  let ticksSinceFloorChange = state.ticksSinceFloorChange + 1;
  const floorChanged = pip.floor !== pipFrom.floor;
  if (floorChanged) ticksSinceFloorChange = 0;
  const engaged =
    floorChanged ||
    pipMoved ||
    pip.releasing > 0 ||
    outcome.releasedBolt >= 0 ||
    pip.pose === "jump" ||
    pip.pose === "duck" ||
    nearMisses > 0;
  const boredom = nextBoredom(state.boredom, {
    engaged,
    floorChanged,
    underThreat: survivors.some((h) => h.floor === pip.floor),
    staleFloor: ticksSinceFloorChange > BOREDOM_STALE_FLOOR_TICKS,
    nearMisses,
    boltReleased: outcome.releasedBolt >= 0,
  });
  const stewardAsleep = nextAsleep(state.stewardAsleep, boredom);

  // 7 — resolve the round
  misses = Math.min(misses, MISSES_ALLOWED); // two hits in one tick still ends at 3
  let phase = state.phase;
  let clearedCountdown = state.clearedCountdown;
  if (misses >= MISSES_ALLOWED) {
    phase = "over";
  } else if (bolts.every((b) => b)) {
    phase = "cleared";
    clearedCountdown = ROUND_CLEARED_TICKS;
    rawPoints += POINTS_PER_ROUND_CLEAR;
  }

  const score = state.score + awardPoints(rawPoints, boredom, stewardAsleep);

  return {
    ...state,
    tick: state.tick + 1,
    rng,
    phase,
    score,
    misses,
    pip,
    hazards: survivors,
    bolts,
    brunoSlot,
    brunoDir,
    spawnCountdown,
    swipeCountdown,
    swipe,
    clearedCountdown,
    boredom,
    stewardAsleep,
    nearMisses: state.nearMisses + nearMisses,
    ticksSinceFloorChange,
  };
}

function stepCleared(state: GameState): GameState {
  const n = state.clearedCountdown - 1;
  if (n > 0) {
    // Let a mid-swing Bruno settle during the countdown, as stepPlaying would.
    return {
      ...state,
      tick: state.tick + 1,
      clearedCountdown: n,
      swipe: Math.max(0, state.swipe - 1),
    };
  }
  const round = state.round + 1;
  const params = roundParams(round);
  return {
    ...state,
    tick: state.tick + 1,
    phase: "playing",
    round,
    pip: freshPip(),
    hazards: [],
    bolts: state.bolts.map(() => false),
    brunoSlot: BRUNO_SLOT,
    brunoDir: 1,
    spawnCountdown: params.hazardCadence,
    swipeCountdown: params.swipeCadence,
    swipe: 0,
    clearedCountdown: 0,
    boredom: BOREDOM_START, // a fresh round starts back in the neutral band
    stewardAsleep: false,
    ticksSinceFloorChange: 0,
  };
}
