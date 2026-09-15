import { describe, it, expect } from "vitest";
import {
  CONCESSION_CARDS,
  drawConcessionCards,
  effectsFor,
  isGrievanceRound,
  type ConcessionId,
} from "../src/sim/grievance";
import { seedRng } from "../src/sim/rng";
import { isStandable, jumpLanding } from "../src/sim/world";
import {
  BOLT_RELEASE_TICKS,
  BRUNO_SLOT,
  CONSOLE_SLOT,
  MISSES_ALLOWED,
  SWIPE_REACH,
  initialState,
  type GameState,
} from "../src/sim/state";
import { step } from "../src/sim/step";
import type { Hazard } from "../src/sim/hazards";

describe("isGrievanceRound (doc §7.2)", () => {
  it("fires after rounds 2, 4, 6, then every third round on", () => {
    for (const r of [2, 4, 6, 9, 12, 15, 18]) expect(isGrievanceRound(r)).toBe(true);
    for (const r of [1, 3, 5, 7, 8, 10, 11, 13, 14]) expect(isGrievanceRound(r)).toBe(false);
  });
});

describe("concession effects fold cleanly (doc §7.2)", () => {
  it("no concessions taken is the neutral case", () => {
    expect(effectsFor([])).toEqual({
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
    });
  });

  it("each card only ever touches its own pair of fields", () => {
    expect(effectsFor(["longerBreaks"])).toMatchObject({ brunoPauseTicks: 20, doubleThrow: true });
    expect(effectsFor(["ergonomicAssessment"])).toMatchObject({ jumpSpan: 2, swipeReachBonus: 1 });
    expect(effectsFor(["overtimePay"])).toMatchObject({ pointsMult: 1.4, speedMult: 1.15 });
    expect(effectsFor(["safetyRailing"])).toMatchObject({ gapClosed: true, ladderClimbTicks: 2 });
    expect(effectsFor(["trainingBudget"])).toMatchObject({ extraMisses: 1, boltReleaseTicks: 5 });
    expect(effectsFor(["recognitionProgramme"])).toMatchObject({ nearMissMult: 2, swipeJitter: true });
  });

  it("taking several stacks independently — no field is ever touched twice", () => {
    const all = CONCESSION_CARDS.map((c) => c.id);
    const e = effectsFor(all);
    expect(e).toEqual({
      brunoPauseTicks: 20,
      doubleThrow: true,
      jumpSpan: 2,
      swipeReachBonus: 1,
      pointsMult: 1.4,
      speedMult: 1.15,
      gapClosed: true,
      ladderClimbTicks: 2,
      extraMisses: 1,
      boltReleaseTicks: 5,
      nearMissMult: 2,
      swipeJitter: true,
    });
  });
});

describe("drawConcessionCards (doc §7.2)", () => {
  it("is deterministic from the seed", () => {
    const [a] = drawConcessionCards([], seedRng(7));
    const [b] = drawConcessionCards([], seedRng(7));
    expect(a).toEqual(b);
  });

  it("never offers more than 3, and never one already taken", () => {
    const taken: ConcessionId[] = ["longerBreaks", "overtimePay"];
    const [cards] = drawConcessionCards(taken, seedRng(3));
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(cards.some((c) => taken.includes(c.id))).toBe(false);
  });

  it("is empty once every card is spent", () => {
    const all = CONCESSION_CARDS.map((c) => c.id);
    const [cards] = drawConcessionCards(all, seedRng(1));
    expect(cards).toEqual([]);
  });

  it("offers whatever's left when the pool drops below 3", () => {
    const taken = CONCESSION_CARDS.slice(0, 4).map((c) => c.id);
    const [cards] = drawConcessionCards(taken, seedRng(1));
    expect(cards.length).toBe(2);
  });
});

/* ---- integration: the mediation phase through step() ---------------------- */

const mkBarrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

/** A playing state one tick from clearing `round`, at a chosen seed so the
 *  card draw is pinned. */
const almostCleared = (round: number, seed = 1): GameState => ({
  ...initialState(seed),
  phase: "playing",
  round,
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
  bolts: [true, true, true, false],
  boredom: 70, // stays clear of the sleep/×1.5 bands after the haul's drains
  pip: { ...initialState(seed).pip, floor: 4, slot: CONSOLE_SLOT, releasing: 1, releasingBolt: 3 },
});

/** Steps a just-cleared state through the whole ROUND CLEARED countdown —
 *  the platform falls the ordinary way (doc §5.5) before a grievance
 *  interlude, if this round earns one, ever appears (doc §7.2). */
const throughRoundClear = (s: GameState): GameState => {
  let cur = s;
  while (cur.phase === "cleared") cur = step(cur, null);
  return cur;
};

describe("the mediation phase (doc §7.2)", () => {
  it("clearing the round always falls the ordinary way first", () => {
    const s = step(almostCleared(2), null);
    expect(s.phase).toBe("cleared"); // not mediation yet — the fall plays first
    expect(s.mediationCards).toEqual([]);
  });

  it("mediation opens with up to three cards, paused, once the fall finishes", () => {
    const s = throughRoundClear(step(almostCleared(2), null));
    expect(s.phase).toBe("mediation");
    expect(s.mediationCards.length).toBeGreaterThan(0);
    expect(s.mediationCards.length).toBeLessThanOrEqual(3);
    expect(s.mediationSelected).toBe(0);
    expect(s.round).toBe(2); // not yet advanced — that waits for a pick
  });

  it("clearing a non-grievance round skips it entirely", () => {
    const s = throughRoundClear(step(almostCleared(1), null));
    expect(s.phase).toBe("playing"); // straight into round 2, no interlude
    expect(s.mediationCards).toEqual([]);
  });

  it("LEFT/RIGHT cycles the selection, wrapping at the ends", () => {
    let s = throughRoundClear(step(almostCleared(2), null));
    const n = s.mediationCards.length;
    s = step(s, "left"); // wraps back from 0
    expect(s.mediationSelected).toBe(n - 1);
    s = step(s, "right");
    s = step(s, "right");
    expect(s.mediationSelected).toBe(1 % n);
  });

  it("A picks the highlighted card and hands off into the next round", () => {
    let s = throughRoundClear(step(almostCleared(2), null));
    const chosen = s.mediationCards[s.mediationSelected]!;
    s = step(s, "a");
    expect(s.phase).toBe("playing");
    expect(s.round).toBe(3);
    expect(s.concessions).toEqual([chosen]);
    expect(s.mediationCards).toEqual([]);
    expect(s.pip.floor).toBe(1); // beginNextRound ran, same as an ordinary clear
    expect(s.bolts.every((b) => b === false)).toBe(true);
  });

  it("nothing advances while paused — only LEFT/RIGHT/A do anything", () => {
    let s = throughRoundClear(step(almostCleared(2), null));
    const before = s;
    s = step(s, "up"); // not a picker input
    expect(s.mediationSelected).toBe(before.mediationSelected);
    expect(s.phase).toBe("mediation");
    expect(s.tick).toBe(before.tick + 1); // the clock still ticks
  });

  it("the pool empties after all six are taken — later interludes are skipped", () => {
    const s: GameState = { ...almostCleared(9, 1), concessions: CONCESSION_CARDS.map((c) => c.id) };
    const cleared = throughRoundClear(step(s, null));
    expect(cleared.phase).toBe("playing"); // nothing left to offer
  });
});

/* ---- integration: each concession's effect actually applies --------------- */

describe("concession effects reach the sim (doc §7.2)", () => {
  const playingWith = (ids: ConcessionId[], over: Partial<GameState> = {}): GameState => ({
    ...initialState(1),
    phase: "playing",
    spawnCountdown: 1e9,
    swipeCountdown: 1e9,
    concessions: ids,
    ...over,
  });

  it("Ergonomic Assessment: a jump clears two slots instead of one", () => {
    expect(jumpLanding(1, 3, 1, 2)).toBe(5);
  });

  it("Ergonomic Assessment: the swipe reach grows by one slot", () => {
    let s = playingWith(["ergonomicAssessment"], {
      swipeCountdown: 1,
      brunoSlot: BRUNO_SLOT,
      round: 1,
    });
    s = {
      ...s,
      pip: { ...s.pip, floor: 4, slot: BRUNO_SLOT + SWIPE_REACH + 1 },
    };
    s = step(s, null);
    expect(s.misses).toBe(1); // out of base SWIPE_REACH, but within the +1 bonus
  });

  it("Safety Railing: the floor-2 gap becomes ordinary floor", () => {
    expect(isStandable(2, 4, true)).toBe(true);
    expect(isStandable(2, 4, false)).toBe(false);
  });

  it("Safety Railing: a ladder climb takes two locked ticks instead of one", () => {
    let s = playingWith(["safetyRailing"], { pip: { ...initialState(1).pip, floor: 1, slot: 9 } });
    s = step(s, "up"); // slot 9 on floor 1 is the up-ladder
    expect(s.pip.floor).toBe(1); // not there yet — locked in the climb
    expect(s.pip.pose).toBe("climb");
    s = step(s, "left"); // ignored — movement-locked
    expect(s.pip.floor).toBe(1);
    s = step(s, null);
    expect(s.pip.floor).toBe(2); // completes on the second tick
  });

  it("Training Budget: one extra miss is allowed before the run ends", () => {
    let s = playingWith(["trainingBudget"], {
      misses: 3,
      hazards: [mkBarrel(1, 2, 1)],
      pip: { ...initialState(1).pip, floor: 1, slot: 3 },
    });
    s = step(s, null); // barrel 2 -> 3, onto Pip: the 4th miss
    expect(s.misses).toBe(4);
    expect(s.phase).toBe("over");
  });

  it("Training Budget: a bolt release takes five ticks instead of three", () => {
    let s = playingWith(["trainingBudget"], {
      pip: { ...initialState(1).pip, floor: 4, slot: CONSOLE_SLOT },
    });
    s = step(s, "up");
    expect(s.pip.releasing).toBe(5);
    expect(BOLT_RELEASE_TICKS).toBe(3); // the base constant is untouched
  });

  it("Recognition Programme: a near miss pays double", () => {
    const nearMissScore = (ids: ConcessionId[]): number => {
      let s = playingWith(ids, { hazards: [mkBarrel(1, 3, 1)] });
      s = { ...s, pip: { ...s.pip, floor: 1, slot: 4 } };
      return step(s, "right").score; // Pip 4->5, barrel 3->4: a near miss
    };
    expect(nearMissScore(["recognitionProgramme"])).toBe(nearMissScore([]) * 2);
  });

  it("Overtime Pay: every point earned pays 1.4x", () => {
    const boltScore = (ids: ConcessionId[]): number => {
      let s = playingWith(ids, {
        pip: { ...initialState(1).pip, floor: 4, slot: CONSOLE_SLOT, releasing: 1, releasingBolt: 0 },
      });
      return step(s, null).score;
    };
    expect(boltScore(["overtimePay"])).toBeCloseTo(boltScore([]) * 1.4, 5);
  });

  it("Longer Breaks: Bruno is away for his usual window plus the extra pause", () => {
    let s = playingWith(["longerBreaks"], { spawnCountdown: 1, round: 1, tick: 19 });
    s = step(s, null); // roundTick 20 -> still short of 0 (base) + 20 (pause)
    expect(s.hazards.length).toBe(0);
  });

  it("Longer Breaks: once back, he throws two hazards at once", () => {
    let s = playingWith(["longerBreaks"], { spawnCountdown: 1, round: 1, tick: 20 });
    s = step(s, null); // roundTick 21 -> past the 20-tick pause
    expect(s.hazards.filter((h) => h.floor === 4).length).toBe(2); // both landed at spawn
  });
});
