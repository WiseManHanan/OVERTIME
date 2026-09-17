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
import type { GameState, InputAction, Pip, PipPose } from "./state";
import {
  BOLT_RELEASE_TICKS,
  BRUNO_MAX_SLOT,
  BRUNO_MIN_SLOT,
  BRUNO_PACE_TICKS,
  BRUNO_SLOT,
  CONSOLE_SLOT,
  GLITCH_CHANCE,
  GLITCH_COOLDOWN_TICKS,
  GLITCH_POSES,
  GLITCH_TICKS,
  HIT_FLASH_TICKS,
  MISSES_ALLOWED,
  POINTS_PER_BOLT,
  POINTS_PER_ROUND_CLEAR,
  ROUND_CLEARED_TICKS,
  SWIPE_REACH,
  freshPip,
  isAirborne,
} from "./state";
export type { InputAction } from "./state";
import {
  floorAbove,
  floorBelow,
  isStandable,
  jumpLanding,
  ladderDownAt,
  ladderUpAt,
  type Floor,
} from "./world";
import { advanceHazard, hazardSpeed, spawnHazard, type Hazard } from "./hazards";
import { hazardHits } from "./collision";
import { roundParams } from "./rounds";
import {
  NIGHT_NOISE_DECAY,
  NIGHT_NOISE_FILL,
  NIGHT_NOISE_MAX,
  clockParams,
  effectiveRound,
} from "./clock";
import { batteryDead, hasStuckSegment, nextBattery, pickStuckPose } from "./battery";
import {
  BOREDOM_START,
  BOREDOM_STALE_FLOOR_TICKS,
  NEAR_MISS_POINTS,
  awardPoints,
  nextAsleep,
  nextBoredom,
} from "./scoring";
import { nextFloat, nextInt } from "./rng";
import {
  drawConcessionCards,
  effectsFor,
  isGrievanceRound,
  type GrievanceEffects,
} from "./grievance";
import { MODIFIER_ANNOUNCE_TICKS, rollModifier, type Modifier } from "./modifiers";

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
    case "mediation":
      return stepMediation(state, input);
    case "over":
      // A trap state: the GAME OVER screen is a bare readout (scene.ts), so
      // nothing here matters but keeping the tick counter moving.
      return { ...state, tick: state.tick + 1 };
  }
}

/* ---- Pip -------------------------------------------------------------------- */

interface PipStep {
  pip: Pip;
  /** BOLT_SLOTS index whose release just completed this tick, or -1. */
  releasedBolt: number;
}

/**
 * Resolve one tick of Pip from `input`. Movement is locked during a bolt
 * release, a multi-tick ladder climb (Safety Railing, doc §7.2), and a jump
 * arc; otherwise LEFT/RIGHT walk, UP climbs or starts a bolt release, DOWN
 * descends or ducks, A jumps (doc §5.2). `effects` folds in whatever
 * concessions are in play — jump span, the gap, bolt/climb ticks — so a run
 * with none behaves exactly as before (`effectsFor([])` is the neutral case).
 */
function movePip(
  p: Pip,
  input: InputAction | null,
  bolts: readonly boolean[],
  effects: GrievanceEffects,
  modifier: Modifier | null,
): PipStep {
  let { floor, slot, facing, airborne, releasing, releasingBolt, climbing, climbTo } = p;
  let pose: PipPose = "stand";
  let releasedBolt = -1;
  const boltTicks = effects.boltReleaseTicks ?? BOLT_RELEASE_TICKS;
  // One place that reads the current bindings into a PipStep — every exit
  // below calls this instead of re-listing all nine Pip fields itself, so a
  // future field can't be threaded into three branches and missed in a fourth.
  const result = (): PipStep => ({
    pip: { floor, slot, facing, pose, airborne, releasing, releasingBolt, climbing, climbTo },
    releasedBolt,
  });

  if (releasing > 0) {
    releasing -= 1;
    if (releasing === 0) {
      pose = "stand";
      releasedBolt = releasingBolt;
      releasingBolt = -1;
    } else {
      pose = "release";
    }
    return result();
  }

  if (climbing > 0) {
    climbing -= 1;
    if (climbing === 0) {
      floor = climbTo ?? floor;
      climbTo = null;
      pose = "stand";
    } else {
      pose = "climb";
    }
    return result();
  }

  if (airborne > 0) {
    airborne -= 1;
    if (airborne > 0) {
      // still mid-arc — locked
      pose = "jump";
      return result();
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
      if (isStandable(floor, target, effects.gapClosed)) {
        slot = target;
        pose = "walk";
        // GREASED (doc §6.3): every floor is a coffee-cup slick — a step
        // carries an extra slot the same direction, falling back to just
        // the one step if the far side isn't somewhere Pip could stand.
        if (modifier === "greased") {
          const slideTo = slot + dir;
          if (isStandable(floor, slideTo, effects.gapClosed)) slot = slideTo;
        }
      }
      break;
    }
    case "up": {
      if (ladderUpAt(floor, slot)) {
        const up = floorAbove(floor);
        if (up !== null) {
          if (effects.ladderClimbTicks <= 1) {
            floor = up; // instant — the ordinary case
            pose = "climb";
          } else {
            climbing = effects.ladderClimbTicks;
            climbTo = up;
            pose = "climb";
          }
        }
      } else if (floor === 4 && slot === CONSOLE_SLOT) {
        // Haul the next lever that is still up (levers pull left to right).
        const nextLever = bolts.findIndex((b) => b !== true);
        if (nextLever >= 0) {
          releasing = boltTicks;
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
          if (effects.ladderClimbTicks <= 1) {
            floor = down;
            pose = "climb";
          } else {
            climbing = effects.ladderClimbTicks;
            climbTo = down;
            pose = "climb";
          }
        }
      } else {
        pose = "duck";
      }
      break;
    }
    case "a": {
      const land = jumpLanding(floor, slot, facing, effects.jumpSpan, effects.gapClosed);
      airborne = JUMP_AIR_TICKS; // > 0 for both airborne ticks; hits 0 on landing
      pose = "jump";
      if (land !== null) slot = land;
      break;
    }
    case null:
      break;
  }

  return result();
}

/* ---- phases --------------------------------------------------------------- */

function stepTitle(state: GameState, input: InputAction | null): GameState {
  const { pip } = movePip(state.pip, input, state.bolts, effectsFor(state.concessions), null);
  const moved = pip.floor !== state.pip.floor || pip.slot !== state.pip.slot;
  if (!moved) {
    return { ...state, tick: state.tick + 1, pip };
  }
  const params = roundParams(state.round);
  const roll = rollModifier(state.rng, state.forcedModifier); // round 1's modifier (doc §6.3)
  return {
    ...state,
    tick: state.tick + 1,
    phase: "playing",
    pip,
    rng: roll.rng,
    modifier: roll.modifier,
    modifierAnnounceTicks: MODIFIER_ANNOUNCE_TICKS,
    deadColumn: roll.deadColumn,
    spawnCountdown: params.hazardCadence,
    swipeCountdown: params.swipeCadence,
    playingSince: state.tick + 1, // round 1 clock windows start now
    roundClean: true,
  };
}

function stepPlaying(state: GameState, input: InputAction | null): GameState {
  // A hit freezes everything else — Bruno, hazards, scoring, input — while
  // Pip blinks (scene.ts reads hitFlash for that). The tick this reaches 0 is
  // also where a fatal hit's GAME OVER actually lands, so the blink always
  // finishes playing before the results screen cuts in; a survived hit sends
  // Pip back to the start and sweeps the stage once it's done, same reset a
  // successful bolt haul gets.
  if (state.hitFlash > 0) {
    const hitFlash = state.hitFlash - 1;
    const effects0 = effectsFor(state.concessions);
    const missesAllowed0 = MISSES_ALLOWED + effects0.extraMisses;
    if (hitFlash === 0) {
      if (state.misses >= missesAllowed0) {
        return { ...state, tick: state.tick + 1, hitFlash, phase: "over" };
      }
      // Same reset a haul gets (doc §5.5): the stage is swept clear too, not
      // just Pip — everything Bruno had thrown goes with him back to zero.
      // STICKY PAD's queue goes with it too — the frozen branches above never
      // touch it, so whatever was queued right before the hit would otherwise
      // replay against the freshly reset Pip next tick, several ticks stale.
      return {
        ...state,
        tick: state.tick + 1,
        hitFlash,
        pip: freshPip(),
        hazards: [],
        queuedInput: null,
      };
    }
    return {
      ...state,
      tick: state.tick + 1,
      hitFlash,
      swipe: Math.max(0, state.swipe - 1), // let a mid-swing arm settle, as stepCleared does
    };
  }

  const cp = clockParams(state.clock); // time-of-day mode (doc §7.1)
  const effects = effectsFor(state.concessions); // concessions taken so far (doc §7.2)
  const roundTick = state.tick - state.playingSince; // ticks into *this* round
  // NIGHT: asleep until the noise meter fills (state.nightWoken, set last tick —
  // see below), then he's here at a round's worth of extra difficulty. Longer
  // Breaks adds its own pause on top, whatever the clock mode.
  const nightAwake = state.clock === "night" && state.nightWoken;
  const brunoHere = roundTick >= cp.brunoAwayUntil + effects.brunoPauseTicks || nightAwake;
  const effRound = effectiveRound(state.round, state.clock, state.nightWoken);
  const params = roundParams(effRound);
  // CAFFEINATED (doc §6.3): Bruno swipes twice as often; hazard cadence is
  // untouched (params.hazardCadence is read directly, unmodified, below).
  const swipeCadence =
    state.modifier === "caffeinated" ? Math.max(1, Math.round(params.swipeCadence / 2)) : params.swipeCadence;
  // STICKY PAD (doc §6.3): the buffer's usual one-tick delay doubles to two —
  // this tick acts on last tick's input, and this tick's own input waits one
  // more tick behind it.
  const effectiveInput = state.modifier === "stickyPad" ? state.queuedInput : input;
  const queuedInput = state.modifier === "stickyPad" ? input : null;
  const pipFrom = state.pip;
  let rng = state.rng;
  let misses = state.misses;
  // Points accrue raw this tick and are scaled once, at the end, by the boredom
  // multiplier (doc §6.2) — so "no points while the Steward sleeps" is exact.
  let rawPoints = 0;

  // 0 — Bruno paces his beat on the platform (whole and intact until the last
  //     holder goes), reversing at the ends. He throws from, and swings from,
  //     wherever he now stands (doc §5.5). MORNING he shuffles at half rate;
  //     LUNCH / NIGHT he is not on the platform at all.
  let brunoSlot = state.brunoSlot;
  let brunoDir = state.brunoDir;
  const paceEvery = roundTick < cp.brunoSlowUntil ? BRUNO_PACE_TICKS * 2 : BRUNO_PACE_TICKS;
  if (brunoHere && (state.tick + 1) % paceEvery === 0) {
    if (brunoSlot + brunoDir < BRUNO_MIN_SLOT || brunoSlot + brunoDir > BRUNO_MAX_SLOT) {
      brunoDir = -brunoDir as -1 | 1;
    }
    brunoSlot += brunoDir;
  }

  // 1 — Pip
  const outcome = movePip(state.pip, effectiveInput, state.bolts, effects, state.modifier);
  let pip = outcome.pip;
  let bolts = state.bolts;
  let boltProgress = state.boltProgress;
  const hauled = outcome.releasedBolt >= 0; // a lever came down this tick
  if (hauled) {
    // DOUBLE BOLTS (doc §6.3): each lever needs two hauls, not one, before it
    // actually flips to released — the console still only ever shows real
    // completions, so no new art for the extra pull.
    const bi = outcome.releasedBolt;
    const needed = state.modifier === "doubleBolts" ? 2 : 1;
    const progress = (boltProgress[bi] ?? 0) + 1;
    boltProgress = boltProgress.map((p, i) => (i === bi ? progress : p));
    if (progress >= needed) {
      bolts = bolts.map((b, i) => (i === bi ? true : b));
    }
    rawPoints += POINTS_PER_BOLT;
  }

  // 2 — Bruno's swipe (doc §5.5). The swing arm shows one tick early (the windup
  //     frame) so the hit is telegraphed, like the hazards. It costs a miss and
  //     knocks a lever back up — the one Pip is hauling, or the last one pulled
  //     if he is loitering at the console — but never one secured this same tick.
  //     Resolved before the haul warps Pip away, so the swing still lands.
  // While Bruno is away the countdown is held at full, so on his return there is
  // always a fresh cadence — including the windup — before the first swing.
  let swipeCountdown = brunoHere ? state.swipeCountdown - 1 : swipeCadence;
  let swipe = Math.max(0, state.swipe - 1);
  if (brunoHere && swipeCountdown === 1) {
    swipe = 2; // windup: arm out, no hit yet
  }
  if (swipeCountdown <= 0) {
    // Recognition Programme: he's "visibly emotional and unpredictable" —
    // each fresh cadence jitters ±3 ticks around the table value (doc §7.2).
    let cadence = swipeCadence;
    if (effects.swipeJitter) {
      const [j, r2] = nextInt(rng, 7); // 0..6 -> -3..+3
      rng = r2;
      cadence = Math.max(1, cadence + (j - 3));
    }
    swipeCountdown = cadence;
    swipe = brunoHere ? 2 : 0;
    const inReach =
      brunoHere &&
      pip.floor === 4 &&
      Math.abs(pip.slot - brunoSlot) <= SWIPE_REACH + effects.swipeReachBonus &&
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
        if (bi >= 0) {
          bolts = bolts.map((b, i) => (i === bi ? false : b));
          boltProgress = boltProgress.map((p, i) => (i === bi ? 0 : p)); // DOUBLE BOLTS: starts over
        }
      }
    }
  }

  // The haul's reward: the stage is swept clear of hazards and Pip drops back to
  // the start for the next climb (doc §5.5).
  if (hauled) pip = freshPip();
  const pipMoved = pip.slot !== pipFrom.slot || pip.floor !== pipFrom.floor;

  // NIGHT only: Bruno is asleep, and stays that way as long as Pip moves
  // carefully. Two moves in a row builds noise; standing still (or ducking)
  // lets it settle. A full meter wakes him for the rest of the round, at a
  // round's worth of extra difficulty (doc §7.1) — brunoHere above already
  // reflects *last* tick's wake state, so the bump lands one tick after the
  // meter actually fills, like a telegraph.
  const moveStreak = pipMoved ? state.moveStreak + 1 : 0;
  let nightNoise = state.nightNoise;
  let nightWoken = state.nightWoken;
  if (state.clock === "night" && !nightWoken) {
    nightNoise =
      moveStreak >= 2
        ? Math.min(NIGHT_NOISE_MAX, nightNoise + NIGHT_NOISE_FILL)
        : Math.max(0, nightNoise - NIGHT_NOISE_DECAY);
    if (nightNoise >= NIGHT_NOISE_MAX) nightWoken = true;
  }

  // 3 — hazards roll, and are checked against Pip on every slot they pass
  //     through. A barrel covers one slot a tick; a chair up to two (ramping in
  //     by round, see hazardSpeed), sub-stepped so its floor-descent and
  //     end-reversal stay right (doc §5.4). A hazard that hits (ends on Pip's
  //     slot, or crosses straight through him) is a miss and is gone; otherwise
  //     it survives at its final slot. A survivor that landed on the slot Pip
  //     just vacated, or passed beneath his jump, is a near miss — the primary
  //     source of points (doc §5.3).
  const survivors: Hazard[] = [];
  let nearMisses = 0;
  for (const h of hauled ? [] : state.hazards) {
    let cur: Hazard | null = h;
    let hit = false;
    for (let i = 0; i < hazardSpeed(h.kind, effRound) && cur !== null; i++) {
      const from = cur;
      const next = advanceHazard(from, effects.gapClosed);
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
  rawPoints += nearMisses * NEAR_MISS_POINTS * effects.nearMissMult;

  // 4 — spawn: the new hazard appears now but is checked only from next tick, so
  //     every one gets at least a tick of telegraph (doc §5.4). A haul tick
  //     spawns nothing — the stage just went quiet — and resets the cadence; and
  //     nothing is thrown while Bruno is away (LUNCH / NIGHT). Longer Breaks
  //     trades the pause above for a second hazard riding with the first once
  //     he's back (doc §7.2).
  let spawnCountdown = hauled ? params.hazardCadence : state.spawnCountdown - 1;
  if (brunoHere && !hauled && spawnCountdown <= 0) {
    const [hazard, next] = spawnHazard(brunoSlot, state.round, rng);
    rng = next;
    survivors.push(hazard);
    if (effects.doubleThrow) {
      const [hazard2, next2] = spawnHazard(brunoSlot, state.round, rng);
      rng = next2;
      // Forced opposite to the first, not independently rolled: both start
      // from Bruno's slot, so a same-direction roll would leave them exactly
      // coincident — one sprite doing the work (and collision damage) of
      // two — for their whole lifetime, not just the untelegraphed spawn tick.
      survivors.push({ ...hazard2, dir: (-hazard.dir) as -1 | 1 });
    }
    spawnCountdown = params.hazardCadence;
  }

  // 5b — segment awareness (doc §7.4): roughly once per 400 ticks the wrong
  //      Pip segment lights for one tick, then a one-slot "shake" the next.
  //      Never twice within 200 ticks, so the roll only happens once both the
  //      previous glitch and its cooldown have fully run out.
  let glitchTicks = state.glitchTicks > 0 ? state.glitchTicks - 1 : 0;
  let glitchCooldown = state.glitchCooldown > 0 ? state.glitchCooldown - 1 : 0;
  let glitchPose = state.glitchPose;
  if (state.glitchTicks === 0 && state.glitchCooldown === 0) {
    const [roll, r2] = nextFloat(rng);
    rng = r2;
    if (roll < GLITCH_CHANCE) {
      // Excludes Pip's actual current pose — showing the same pose "wrong"
      // wouldn't read as a glitch at all.
      const candidates = GLITCH_POSES.filter((gp) => gp !== pip.pose);
      const [poseIdx, r3] = nextInt(rng, candidates.length);
      rng = r3;
      glitchTicks = GLITCH_TICKS;
      glitchCooldown = GLITCH_COOLDOWN_TICKS;
      glitchPose = candidates[poseIdx]!;
    }
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
  const boredom = nextBoredom(
    state.boredom,
    {
      engaged,
      floorChanged,
      underThreat: survivors.some((h) => h.floor === pip.floor),
      staleFloor: ticksSinceFloorChange > BOREDOM_STALE_FLOOR_TICKS,
      nearMisses,
      boltReleased: outcome.releasedBolt >= 0,
    },
    cp.boredomRate,
  );
  const stewardAsleep = nextAsleep(state.stewardAsleep, boredom);

  // 7 — resolve the round. Training Budget raises the miss ceiling itself
  //     (doc §7.2); everything downstream (the clamp, the game-over check)
  //     reads that effective ceiling, not the base constant.
  const missesAllowed = MISSES_ALLOWED + effects.extraMisses;
  const tookMiss = misses > state.misses; // any miss this tick (pre-clamp)
  misses = Math.min(misses, missesAllowed); // two hits in one tick still ends it
  let phase = state.phase;
  let clearedCountdown = state.clearedCountdown;
  let hitFlash = 0;
  if (tookMiss) {
    // Pause and blink first (doc-independent tuning, see HIT_FLASH_TICKS) —
    // phase stays "playing" even if this was the hit that ends the run; the
    // frozen branch at the top turns it "over" once the flash finishes, so
    // GAME OVER never cuts in mid-blink. A round-clear on this same tick (if
    // any) is deferred the same way — bolts stay released, so the next
    // unfrozen tick catches it.
    hitFlash = HIT_FLASH_TICKS;
  } else if (bolts.every((b) => b)) {
    // The platform still falls the ordinary way (doc §5.5) — a grievance
    // interlude, if this round earns one, waits for that to finish (stepCleared).
    phase = "cleared";
    clearedCountdown = ROUND_CLEARED_TICKS;
    // NIGHT pays double here, but only if Bruno never woke up (doc §7.1).
    const clearMult = state.clock === "night" && nightWoken ? 1 : cp.clearMult;
    // DOUBLE BOLTS doubles the clear bonus too, not just the haul count.
    const modMult = state.modifier === "doubleBolts" ? 2 : 1;
    rawPoints += POINTS_PER_ROUND_CLEAR * clearMult * modMult;
  }

  const score =
    state.score +
    awardPoints(rawPoints, boredom, stewardAsleep, cp.points * effects.pointsMult);

  const modifierAnnounceTicks = Math.max(0, state.modifierAnnounceTicks - 1);

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
    boltProgress,
    brunoSlot,
    brunoDir,
    spawnCountdown,
    swipeCountdown,
    swipe,
    clearedCountdown,
    hitFlash,
    glitchTicks,
    glitchCooldown,
    glitchPose,
    modifierAnnounceTicks,
    queuedInput,
    moveStreak,
    nightNoise,
    nightWoken,
    boredom,
    stewardAsleep,
    nearMisses: state.nearMisses + nearMisses,
    ticksSinceFloorChange,
    roundClean: state.roundClean && !tookMiss,
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

  // The platform has finished falling. Every third clear opens a grievance
  // interlude here, once that's fully played out — not before (doc §7.2) —
  // unless the pool of concessions is already spent, in which case the round
  // just begins the ordinary way.
  if (isGrievanceRound(state.round)) {
    const [cards, rng] = drawConcessionCards(state.concessions, state.rng);
    if (cards.length > 0) {
      return {
        ...state,
        tick: state.tick + 1,
        phase: "mediation",
        rng,
        mediationCards: cards.map((c) => c.id),
        mediationSelected: 0,
      };
    }
  }
  return beginNextRound(state);
}

/**
 * Play is paused (doc §7.2): LEFT/RIGHT cycles the offered card, A picks it —
 * the choice is appended to `concessions` (its effects apply from the very
 * next round on) and the run hands off into the next round exactly as an
 * ordinary ROUND CLEAR would. Anything else this tick is a no-op; nothing
 * else moves while Bruno has stopped to talk.
 */
function stepMediation(state: GameState, input: InputAction | null): GameState {
  const n = state.mediationCards.length;
  if (n === 0) return { ...state, tick: state.tick + 1 }; // nothing offered — hold, don't divide by zero
  if (input === "a") {
    const chosen = state.mediationCards[state.mediationSelected]!;
    return beginNextRound({
      ...state,
      concessions: [...state.concessions, chosen],
      mediationCards: [],
      mediationSelected: 0,
    });
  }
  let mediationSelected = state.mediationSelected;
  if (input === "left") mediationSelected = (mediationSelected - 1 + n) % n;
  else if (input === "right") mediationSelected = (mediationSelected + 1) % n;
  return { ...state, tick: state.tick + 1, mediationSelected };
}

/** The battery/round bookkeeping shared by an ordinary ROUND CLEAR and a
 *  resolved grievance interlude (doc §7.2 and §7.3) — both hand off into the
 *  next round identically once the round is truly behind Pip. */
function beginNextRound(state: GameState): GameState {
  // The battery drains between rounds once it has started failing (doc §7.3).
  const battery = nextBattery(
    state.battery,
    state.round,
    state.clock,
    state.roundClean,
  );
  if (batteryDead(battery)) {
    // A flat console is a legitimate end to the run — the score stands.
    return { ...state, tick: state.tick + 1, phase: "over", battery: 0 };
  }

  const round = state.round + 1;
  const params = roundParams(round);

  // A stuck pose (dark) and a phantom (lit) are re-rolled for the new round.
  let rng = state.rng;
  let stuckDark = null;
  let stuckLit = null;
  if (hasStuckSegment(battery)) {
    const [d, r1] = pickStuckPose(rng);
    const [l, r2] = pickStuckPose(r1);
    rng = r2;
    stuckDark = d;
    stuckLit = l;
  }

  // A fresh modifier every round (doc §6.3) — repeats across rounds allowed.
  const roll = rollModifier(rng, state.forcedModifier);
  rng = roll.rng;

  return {
    ...state,
    tick: state.tick + 1,
    phase: "playing",
    round,
    rng,
    battery,
    roundClean: true,
    stuckDark,
    stuckLit,
    pip: freshPip(),
    hazards: [],
    bolts: state.bolts.map(() => false),
    boltProgress: state.boltProgress.map(() => 0),
    brunoSlot: BRUNO_SLOT,
    brunoDir: 1,
    spawnCountdown: params.hazardCadence,
    swipeCountdown: params.swipeCadence,
    swipe: 0,
    clearedCountdown: 0,
    hitFlash: 0,
    mediationCards: [],
    mediationSelected: 0,
    boredom: BOREDOM_START, // a fresh round starts back in the neutral band
    stewardAsleep: false,
    ticksSinceFloorChange: 0,
    playingSince: state.tick + 1, // this round's clock windows start now
    moveStreak: 0,
    nightNoise: 0,
    nightWoken: false, // a fresh round is a fresh chance to sneak past him
    modifier: roll.modifier,
    modifierAnnounceTicks: MODIFIER_ANNOUNCE_TICKS,
    deadColumn: roll.deadColumn,
    queuedInput: null,
  };
}
