/*
 * `GameState` and its initial-state factory.
 *
 * Everything the simulation needs lives here as plain data. The seed is resolved
 * once, at run start, and stored — `step()` never reaches for the wall clock or
 * `Math.random()` (invariant 1). No field that names a position is ever
 * fractional (invariant 4).
 */
import type { Floor } from "./world";
import { BOLT_SLOTS } from "./world";
import { seedRng, type RngState } from "./rng";
import { roundParams } from "./rounds";
import { BOREDOM_START } from "./scoring";
import type { ClockMode } from "./clock";
import type { StuckPose } from "./battery";
import type { Hazard } from "./hazards";
import type { ConcessionId } from "./grievance";

export type Facing = -1 | 1;
export type PipPose = "stand" | "walk" | "climb" | "duck" | "jump" | "release";

/** The run's overall state machine. `mediation` is the grievance interlude
 *  (doc §7.2) — play is paused while the Steward presents concession cards. */
export type RunPhase = "title" | "playing" | "cleared" | "over" | "mediation";

export interface Pip {
  floor: Floor;
  /** Integer slot index, 0–9. */
  slot: number;
  /** Last horizontal direction pressed; the direction a jump travels. */
  facing: Facing;
  pose: PipPose;
  /** Ticks of jump arc remaining. `> 0` means airborne (immune to low hazards);
   *  `0` means grounded. Stays in step with `isAirborne` / the "jump" pose. */
  airborne: number;
  /** Ticks left in a bolt release. Pip is movement-locked while this is > 0. */
  releasing: number;
  /** Index into BOLT_SLOTS currently being released, or -1. */
  releasingBolt: number;
  /** Ticks left in a ladder climb. Normally 0 — a climb is instant — but the
   *  Safety Railing concession (doc §7.2) makes it take two, movement-locked
   *  like a bolt release. `>0` means locked; `climbTo` is the floor it lands on. */
  climbing: number;
  climbTo: Floor | null;
}

export interface GameState {
  readonly seed: number;
  /** Time-of-day mode, resolved from the real clock once at run start (§7.1). */
  readonly clock: ClockMode;
  tick: number;
  rng: RngState;
  phase: RunPhase;
  /** 1-based. Drives the speed table (doc §6.1). */
  round: number;
  score: number;
  misses: number;
  pip: Pip;
  hazards: readonly Hazard[];
  /** One flag per holder, pulled in order. Each pull drops one of the four
   *  holders at the platform's free end; all four out and the platform pivots
   *  off its anchor — Bruno goes down, the round clears (doc §5.5). */
  bolts: readonly boolean[];
  /** The slot Bruno is pacing over on his girder (doc §5.5). */
  brunoSlot: number;
  /** Which way Bruno is pacing; flips at the ends of his beat. */
  brunoDir: -1 | 1;
  /** Ticks until the next hazard spawns. */
  spawnCountdown: number;
  /** Ticks until Bruno's next swipe. */
  swipeCountdown: number;
  /** Ticks of swipe animation left (2 on the swing, then 1, 0). */
  swipe: number;
  /** Ticks left on the ROUND CLEAR screen before the next round begins. */
  clearedCountdown: number;
  /** Boredom meter, 0..BOREDOM_MAX (doc §6.2). Scales every point awarded. */
  boredom: number;
  /** Latched at a full meter, released below BOREDOM_WAKE — no points while true. */
  stewardAsleep: boolean;
  /** Near misses this run — the primary score driver, shown in the share string. */
  nearMisses: number;
  /** Ticks since Pip last changed floor; feeds the boredom meter. */
  ticksSinceFloorChange: number;
  /** `tick` value when the current playing stretch began — so a mode's
   *  "first N ticks of the round" window (doc §7.1) is measured from the round,
   *  not from run start. */
  playingSince: number;
  /** Console charge, 1..0 (doc §7.3). Drains from round 6 (4 in OVERTIME);
   *  at 0 the run ends. */
  battery: number;
  /** No miss taken so far this round — feeds the battery's clean-round bonus. */
  roundClean: boolean;
  /** While the battery is low: a Pip pose that won't light (he vanishes in it)
   *  and a phantom pose that stays lit. Re-rolled each round; null otherwise. */
  stuckDark: StuckPose | null;
  stuckLit: StuckPose | null;
  /** Consecutive ticks Pip has moved (any floor/slot change); 0 the instant he
   *  stops. Feeds NIGHT's noise meter. */
  moveStreak: number;
  /** NIGHT only (doc §7.1): fills while Pip moves two ticks running, settles
   *  while he holds still. Meaningless once `nightWoken`. */
  nightNoise: number;
  /** NIGHT only: the meter filled and Bruno is up for the rest of the round. */
  nightWoken: boolean;
  /** Concession cards taken so far, in pick order — persists the whole run
   *  (doc §7.2). Drives both the effects in play and which cards remain in
   *  the pool for the next interlude. */
  concessions: readonly ConcessionId[];
  /** The (up to three) cards on offer during a `mediation` phase. Empty
   *  outside one. */
  mediationCards: readonly ConcessionId[];
  /** Index into `mediationCards` the picker is currently on. */
  mediationSelected: number;
  /** Ticks left in the post-hit freeze: counts down from HIT_FLASH_TICKS to 0.
   *  `> 0` pauses everything else in `stepPlaying` (Bruno, hazards, scoring —
   *  a bare tick/countdown decrement) while Pip blinks; 0 is normal play. */
  hitFlash: number;
}

export const START_FLOOR: Floor = 1;
export const START_SLOT = 5;
export const MISSES_ALLOWED = 3;
export const BOLT_RELEASE_TICKS = 3;
export const ROUND_CLEARED_TICKS = 18;
/** The one control console, on the floor-4 deck at the east end by the holders
 *  and the climb-up ladder. Hauling a lever pulls a holder, sweeps the stage and
 *  drops Pip back to the start; all four holders out and the platform pivots off
 *  its west anchor — Bruno goes down with it (doc §5.5). */
export const CONSOLE_SLOT = 8;
/** Bruno starts here and paces between BRUNO_MIN_SLOT and BRUNO_MAX_SLOT. */
export const BRUNO_SLOT = 6;
export const BRUNO_MIN_SLOT = 2;
export const BRUNO_MAX_SLOT = 8;
/** Ticks between Bruno's pacing steps. */
export const BRUNO_PACE_TICKS = 2;
/** Slots either side of Bruno his swipe reaches, matching the drawn arc. */
export const SWIPE_REACH = 1;
export const POINTS_PER_BOLT = 100;
/** Dropping Bruno is the point of the round — pays well (doc §5.5). */
export const POINTS_PER_ROUND_CLEAR = 750;
/** Ticks the post-hit freeze holds for — three blinks at a 2-tick half-period
 *  (hidden, visible, hidden, visible, hidden, visible), ending visible. */
export const HIT_FLASH_TICKS = 12;
/** Ticks per on/off half-cycle of the post-hit blink (scene.ts reads this). */
export const HIT_BLINK_HALF_PERIOD = 2;

export function freshPip(): Pip {
  return {
    floor: START_FLOOR,
    slot: START_SLOT,
    facing: 1,
    pose: "stand",
    airborne: 0,
    releasing: 0,
    releasingBolt: -1,
    climbing: 0,
    climbTo: null,
  };
}

/** `startRound` is a debug/cheat entry point (`?round=N` in main.ts) for
 *  playtesting a specific round's tuning without climbing there first. Play
 *  from title still goes through the normal round-speed lookup (stepTitle
 *  reads `state.round`), so a cheat start behaves exactly like reaching that
 *  round the ordinary way. */
export function initialState(
  seed: number,
  clock: ClockMode = "standard",
  startRound = 1,
): GameState {
  const first = roundParams(startRound);
  return {
    seed,
    clock,
    tick: 0,
    rng: seedRng(seed),
    phase: "title",
    round: startRound,
    score: 0,
    misses: 0,
    pip: freshPip(),
    hazards: [],
    bolts: BOLT_SLOTS.map(() => false),
    brunoSlot: BRUNO_SLOT,
    brunoDir: 1,
    spawnCountdown: first.hazardCadence,
    swipeCountdown: first.swipeCadence,
    swipe: 0,
    clearedCountdown: 0,
    boredom: BOREDOM_START,
    stewardAsleep: false,
    nearMisses: 0,
    ticksSinceFloorChange: 0,
    playingSince: 0,
    battery: 1,
    roundClean: true,
    stuckDark: null,
    stuckLit: null,
    moveStreak: 0,
    nightNoise: 0,
    nightWoken: false,
    concessions: [],
    mediationCards: [],
    mediationSelected: 0,
    hitFlash: 0,
  };
}

/** True while Pip is off the ground — the jump immunity window (doc §5.2). */
export function isAirborne(pip: Pip): boolean {
  return pip.pose === "jump";
}
