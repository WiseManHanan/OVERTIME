/*
 * Grievance interludes (doc §7.2). After rounds 2, 4, 6, and every third round
 * after, Bruno stops pacing, sits down on his platform, and the Steward
 * presents concession cards. Every card is a genuine trade-off — a benefit to
 * Pip paired with a buff to Bruno, "no correct answer" by design.
 *
 * Pure and seed-driven throughout (invariant 1/2): the card draw consumes the
 * run's RNG like a hazard spawn, and which cards remain is folded from
 * `GameState.concessions` — a plain list of ids, nothing more, so replay from
 * `(seed, inputLog)` still holds.
 */
import { nextInt, type RngState } from "./rng";

export type ConcessionId =
  | "longerBreaks"
  | "ergonomicAssessment"
  | "overtimePay"
  | "safetyRailing"
  | "trainingBudget"
  | "recognitionProgramme";

export interface ConcessionCard {
  id: ConcessionId;
  /** Silkscreen-short label for the picker (14-seg capitals). */
  title: string;
  /** What Pip gets, one line. */
  youGain: string;
  /** What Bruno gets in return, one line. */
  brunoGains: string;
  /** Bruno's sincere, specific complaint behind this card (doc §7.2: "the
   *  comedy is in his being right" — never a punchline at his expense).
   *  Pre-broken into two short lines — each one comfortably fits the panel
   *  at a legible cell size; a single line long enough to need one would
   *  either clip or force the text down to unreadable. The second line is
   *  `""` where the whole complaint already fits on one. */
  grievance: readonly [string, string];
}

export const CONCESSION_CARDS: readonly ConcessionCard[] = [
  {
    id: "longerBreaks",
    title: "LONGER BREAKS",
    youGain: "BRUNO OFF 20T EACH ROUND",
    brunoGains: "THROWS 2X WHEN ACTIVE",
    grievance: ["TWO BREAKS ISN'T A", "LUNCH HOUR"],
  },
  {
    id: "ergonomicAssessment",
    title: "ERGONOMICS",
    youGain: "JUMP CLEARS 2 SLOTS",
    brunoGains: "SWIPE REACHES 1 FARTHER",
    grievance: ["MY SHOULDER FILED", "ITS OWN GRIEVANCE"],
  },
  {
    id: "overtimePay",
    title: "OVERTIME PAY",
    youGain: "ALL POINTS PAY 1.4X",
    brunoGains: "HE MOVES AT 1.15X",
    grievance: ["NO WEEKEND", "SINCE MARCH"],
  },
  {
    id: "safetyRailing",
    title: "SAFETY RAILING",
    youGain: "FLOOR 2 GAP CLOSES",
    brunoGains: "LADDERS TAKE 2 TICKS",
    grievance: ["THAT GAP MADE THE", "REPORT TWICE"],
  },
  {
    id: "trainingBudget",
    title: "TRAINING BUDGET",
    youGain: "1 EXTRA MISS ALLOWED",
    brunoGains: "BOLTS TAKE 5 TICKS",
    grievance: ["NOBODY SHOWED ME", "THE BOLTS EITHER"],
  },
  {
    id: "recognitionProgramme",
    title: "RECOGNITION",
    youGain: "NEAR MISS PAYS 2X",
    brunoGains: "HIS SWIPE TIMING WOBBLES",
    grievance: ["TWENTY YEARS.", "NOT ONE PLAQUE."],
  },
];

/** After rounds 2, 4, 6, and every third round after (doc §7.2). Read as "the
 *  round just cleared" — the interlude sits between it and the next. */
export function isGrievanceRound(roundJustCleared: number): boolean {
  if (roundJustCleared === 2 || roundJustCleared === 4 || roundJustCleared === 6) return true;
  return roundJustCleared > 6 && (roundJustCleared - 6) % 3 === 0;
}

/** Every knob a concession can touch, folded from the cards taken so far.
 *  Each card owns a disjoint subset of fields, so folding in pick order (or
 *  any order) gives the same result — there is no stacking to resolve. */
export interface GrievanceEffects {
  /** Longer breaks: extra ticks Bruno is off the platform, each round. */
  brunoPauseTicks: number;
  /** Longer breaks: two hazards spawn together once he's back. */
  doubleThrow: boolean;
  /** Ergonomic assessment: slots a jump covers (1 normally). */
  jumpSpan: 1 | 2;
  /** Ergonomic assessment: extra slots on Bruno's swipe reach. */
  swipeReachBonus: number;
  /** Overtime pay: multiplier stacked on every point awarded. */
  pointsMult: number;
  /** Overtime pay: multiplier on the round's tick speed. */
  speedMult: number;
  /** Safety railing: the floor-2 gap becomes ordinary floor. */
  gapClosed: boolean;
  /** Safety railing: ticks a ladder climb takes (1 normally = instant). */
  ladderClimbTicks: number;
  /** Training budget: extra misses allowed before the run ends. */
  extraMisses: number;
  /** Training budget: ticks a bolt release takes, or `null` for the base
   *  value (`BOLT_RELEASE_TICKS`, state.ts — kept out of this module to avoid
   *  a state.ts <-> grievance.ts import cycle). */
  boltReleaseTicks: number | null;
  /** Recognition programme: multiplier on near-miss points specifically. */
  nearMissMult: number;
  /** Recognition programme: swipe cadence jitters ±3 ticks once reset. */
  swipeJitter: boolean;
}

const NEUTRAL_EFFECTS: GrievanceEffects = {
  brunoPauseTicks: 0,
  doubleThrow: false,
  jumpSpan: 1,
  swipeReachBonus: 0,
  pointsMult: 1,
  speedMult: 1,
  gapClosed: false,
  ladderClimbTicks: 1,
  extraMisses: 0,
  boltReleaseTicks: null,
  nearMissMult: 1,
  swipeJitter: false,
};

const CARD_EFFECTS: Record<ConcessionId, Partial<GrievanceEffects>> = {
  longerBreaks: { brunoPauseTicks: 20, doubleThrow: true },
  ergonomicAssessment: { jumpSpan: 2, swipeReachBonus: 1 },
  overtimePay: { pointsMult: 1.4, speedMult: 1.15 },
  safetyRailing: { gapClosed: true, ladderClimbTicks: 2 },
  trainingBudget: { extraMisses: 1, boltReleaseTicks: 5 },
  recognitionProgramme: { nearMissMult: 2, swipeJitter: true },
};

export function effectsFor(taken: readonly ConcessionId[]): GrievanceEffects {
  let e = NEUTRAL_EFFECTS;
  for (const id of taken) e = { ...e, ...CARD_EFFECTS[id] };
  return e;
}

/** Deterministic shuffle-and-take-3 of whatever's left in the pool (doc §7.2:
 *  "cards already taken are removed from the pool"). Fewer than 3 remain once
 *  the pool is nearly spent; empty once all six are gone — the caller treats
 *  that as "no interlude this time," the labor dispute having run its course. */
export function drawConcessionCards(
  taken: readonly ConcessionId[],
  rng: RngState,
): [readonly ConcessionCard[], RngState] {
  const pool = CONCESSION_CARDS.filter((c) => !taken.includes(c.id));
  let r = rng;
  for (let i = pool.length - 1; i > 0; i--) {
    const [j, next] = nextInt(r, i + 1);
    r = next;
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return [pool.slice(0, 3), r];
}
