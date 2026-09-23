import { describe, it, expect } from "vitest";
import { nextFloat, seedRng } from "../src/sim/rng";
import { MAX_SLOT, MIN_SLOT, climbSlots, type Floor } from "../src/sim/world";
import { MODIFIER_UNLOCK_ROUND, rollGreaseSpill, rollModifier } from "../src/sim/modifiers";
import { CONSOLE_SLOT, initialState, type GameState } from "../src/sim/state";
import { POINTS_PER_BOLT, POINTS_PER_ROUND_CLEAR } from "../src/sim/state";
import { step } from "../src/sim/step";

// A state with the round already in progress, spawn/swipe held off so nothing
// but the modifier under test can move a number (same trick movement.test.ts
// and recurringBits.test.ts both use).
function playing(overrides: Partial<GameState> = {}): GameState {
  return {
    ...initialState(1),
    phase: "playing",
    spawnCountdown: 1e9,
    swipeCountdown: 1e9,
    ...overrides,
  };
}

describe("rollModifier (doc §6.3)", () => {
  it("draws one of the 7 modifiers; only deadColumn/greased carry a slot", () => {
    const seen = new Set<string>();
    let rng = seedRng(1);
    for (let i = 0; i < 500; i++) {
      const roll = rollModifier(rng, MODIFIER_UNLOCK_ROUND);
      rng = roll.rng;
      expect(roll.modifier).not.toBeNull(); // round is at the unlock, always draws
      seen.add(roll.modifier!);
      if (roll.modifier === "deadColumn") {
        expect(roll.deadColumn).not.toBeNull();
        expect(roll.deadColumn!).toBeGreaterThanOrEqual(MIN_SLOT);
        expect(roll.deadColumn!).toBeLessThanOrEqual(MAX_SLOT);
        expect(roll.greaseFloor).toBeNull();
        expect(roll.greaseSlot).toBeNull();
      } else if (roll.modifier === "greased") {
        expect(roll.deadColumn).toBeNull();
        expect(roll.greaseFloor).not.toBeNull();
        expect(roll.greaseFloor).not.toBe(1); // never the start floor
        expect(roll.greaseFloor).not.toBe(4); // never Bruno's deck
        expect(roll.greaseSlot).not.toBeNull();
        expect(roll.greaseSlot!).toBeGreaterThanOrEqual(MIN_SLOT);
        expect(roll.greaseSlot!).toBeLessThanOrEqual(MAX_SLOT);
        // Floor 2's gap is slots 4-5 (world.ts) — its lip slots, 3 and 6,
        // are where the slide would always whiff into the gap. Never those.
        if (roll.greaseFloor === 2) {
          expect(roll.greaseSlot).not.toBe(3);
          expect(roll.greaseSlot).not.toBe(6);
        }
        // Never a ladder slot either — landing the queued slide there would
        // hijack the next UP/DOWN press into a sideways shove instead.
        expect(climbSlots(roll.greaseFloor as Floor)).not.toContain(roll.greaseSlot);
      } else {
        expect(roll.deadColumn).toBeNull();
        expect(roll.greaseFloor).toBeNull();
        expect(roll.greaseSlot).toBeNull();
      }
    }
    // 500 draws across 7 uniform options — every option should show up.
    expect(seen.size).toBe(7);
  });

  it("a forced modifier always wins, even below the unlock round, and deadColumn/greased still roll their slot", () => {
    let rng = seedRng(1);
    for (let i = 0; i < 20; i++) {
      const roll = rollModifier(rng, 1, "nightShift"); // round 1 — below MODIFIER_UNLOCK_ROUND
      rng = roll.rng;
      expect(roll.modifier).toBe("nightShift");
      expect(roll.deadColumn).toBeNull();
      expect(roll.greaseFloor).toBeNull();
    }
    const slots = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const roll = rollModifier(rng, 1, "deadColumn");
      rng = roll.rng;
      expect(roll.modifier).toBe("deadColumn");
      expect(roll.deadColumn).not.toBeNull();
      slots.add(roll.deadColumn!);
    }
    expect(slots.size).toBeGreaterThan(1); // still varies, not pinned to one column

    const floors = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const roll = rollModifier(rng, 1, "greased");
      rng = roll.rng;
      expect(roll.modifier).toBe("greased");
      expect(roll.greaseFloor).not.toBeNull();
      expect(roll.greaseFloor).not.toBe(1);
      expect(roll.greaseFloor).not.toBe(4);
      floors.add(roll.greaseFloor!);
    }
    expect(floors.size).toBeGreaterThan(1); // still varies, not pinned to one floor
  });

  it("no modifier before the unlock round, and the RNG stream is left untouched", () => {
    const rng = seedRng(1);
    const roll1 = rollModifier(rng, 1);
    expect(roll1.modifier).toBeNull();
    expect(roll1.deadColumn).toBeNull();
    expect(roll1.greaseFloor).toBeNull();
    expect(roll1.rng).toEqual(rng); // no draw — the stream doesn't move

    const roll2 = rollModifier(rng, MODIFIER_UNLOCK_ROUND - 1);
    expect(roll2.modifier).toBeNull();
    expect(roll2.rng).toEqual(rng);

    const roll3 = rollModifier(rng, MODIFIER_UNLOCK_ROUND);
    expect(roll3.modifier).not.toBeNull(); // unlocked — draws normally
  });
});

describe("GREASED (doc §6.3)", () => {
  it("stepping onto the spill lands Pip there first — no skipping over it", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 2,
      greaseSlot: 6,
      pip: { ...initialState(1).pip, floor: 2, slot: 5 },
    });
    const onSpill = step(s, "right"); // steps onto slot 6 — the spill itself
    expect(onSpill.pip.slot).toBe(6); // visibly standing on it, not slot 7
    expect(onSpill.pip.slideQueued).toBe(1); // the extra slide is queued...
    const after = step(onSpill, null); // ...and resolves next tick, input or not
    expect(after.pip.slot).toBe(7);
    expect(after.pip.slideQueued).toBeNull();
  });

  it("the queued slide fires even if a different key is pressed that tick", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 2,
      greaseSlot: 6,
      pip: { ...initialState(1).pip, floor: 2, slot: 5 },
    });
    const onSpill = step(s, "right");
    const after = step(onSpill, "left"); // locked against input, like a climb
    expect(after.pip.slot).toBe(7); // still slides forward, not left
  });

  it("an ordinary step elsewhere on the same floor is unaffected", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 2,
      greaseSlot: 6,
      pip: { ...initialState(1).pip, floor: 2, slot: 1 },
    });
    const next = step(s, "right"); // nowhere near slot 6
    expect(next.pip.slot).toBe(2);
    expect(next.pip.slideQueued).toBeNull();
  });

  it("the spill doesn't reach across floors, even at the same slot number", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 3, // not floor 2
      greaseSlot: 6,
      pip: { ...initialState(1).pip, floor: 2, slot: 5 },
    });
    const next = step(s, "right");
    expect(next.pip.slot).toBe(6); // an ordinary step, no slide queued
    expect(next.pip.slideQueued).toBeNull();
  });

  it("falls back to a single step when the extra slot isn't standable", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 2,
      greaseSlot: MAX_SLOT,
      pip: { ...initialState(1).pip, floor: 2, slot: MAX_SLOT - 1 },
    });
    const onSpill = step(s, "right"); // steps onto the spill, right at the edge
    expect(onSpill.pip.slot).toBe(MAX_SLOT);
    const after = step(onSpill, null);
    expect(after.pip.slot).toBe(MAX_SLOT); // no further — the edge holds
  });

  it("an ordinary round (no spill this round) takes just the one step", () => {
    const s = playing({
      modifier: "caffeinated", // anything but greased; greaseFloor/Slot stay null
      pip: { ...initialState(1).pip, floor: 1, slot: 5 },
    });
    const next = step(s, "right");
    expect(next.pip.slot).toBe(6);
  });

  // A jump can land square on the spill exactly like a walk can — it should
  // queue the same slide, not just walking onto it (floor 3 here, not 2:
  // no gap to complicate which slots are open on either side).
  const jumpLandedOnSpill = (): GameState =>
    playing({
      modifier: "greased",
      greaseFloor: 3,
      greaseSlot: 5,
      pip: { ...initialState(1).pip, floor: 3, slot: 5, facing: 1, pose: "jump", airborne: 1 },
    });

  it("a jump landing on the spill also queues the slide", () => {
    let s = jumpLandedOnSpill();
    s = step(s, null); // airborne 1 -> 0: the lock releases, landing on the spill
    expect(s.pip.airborne).toBe(0);
    expect(s.pip.slot).toBe(5); // still visibly on the spill
    expect(s.pip.slideQueued).toBe(1);
    s = step(s, null);
    expect(s.pip.slot).toBe(6); // slides forward next tick, same as a walked landing
  });

  it("walking away the same tick a jump lands on the spill cancels the queued slide", () => {
    let s = jumpLandedOnSpill();
    s = step(s, "left"); // the landing tick, but a fresh "left" is already buffered
    expect(s.pip.slot).toBe(4); // walked off the spill this same tick
    expect(s.pip.slideQueued).toBeNull(); // not left pointing at slot 5
    s = step(s, null);
    expect(s.pip.slot).toBe(4); // nothing more happens
  });

  it("a fresh jump the same tick supersedes a queued slide from the landing", () => {
    let s = jumpLandedOnSpill();
    s = step(s, "a"); // lands on the spill and immediately jumps again, same tick
    expect(s.pip.airborne).toBe(2); // a brand-new jump arc
    expect(s.pip.slideQueued).toBeNull(); // not left pointing at the old spot
  });

  it("relocates to a fresh spot the tick Pip takes a hit", () => {
    const rngBeforeHit = seedRng(99);
    // The segment-awareness roll (doc §7.4) draws first, every ordinary tick
    // (glitchTicks/glitchCooldown both start at 0) — the grease reroll comes
    // after it in step order, so the expected draw has to follow the same one.
    const [, rngAfterGlitchRoll] = nextFloat(rngBeforeHit);
    const [expectFloor, expectSlot] = rollGreaseSpill(rngAfterGlitchRoll);
    const s = playing({
      modifier: "greased",
      greaseFloor: 3,
      greaseSlot: 0,
      rng: rngBeforeHit,
      pip: { ...initialState(1).pip, floor: 2, slot: 3 },
      // A barrel one slot upstream lands square on Pip this tick — a hit.
      hazards: [{ kind: "barrel", floor: 2, slot: 2, dir: 1 }],
    });
    const next = step(s, null);
    expect(next.hitFlash).toBeGreaterThan(0); // confirms the hit actually landed
    expect(next.greaseFloor).toBe(expectFloor);
    expect(next.greaseSlot).toBe(expectSlot);
  });

  it("doesn't move on an ordinary tick with no hit", () => {
    const s = playing({
      modifier: "greased",
      greaseFloor: 3,
      greaseSlot: 0,
      pip: { ...initialState(1).pip, floor: 2, slot: 3 },
    });
    const next = step(s, null);
    expect(next.hitFlash).toBe(0);
    expect(next.greaseFloor).toBe(3);
    expect(next.greaseSlot).toBe(0);
  });
});

describe("DOUBLE BOLTS (doc §6.3)", () => {
  const haulingPip = (releasingBolt: number): GameState["pip"] => ({
    ...initialState(1).pip,
    floor: 4,
    slot: CONSOLE_SLOT,
    pose: "release",
    releasing: 1, // one tick from completing
    releasingBolt,
  });

  it("the first pull banks progress but doesn't release the holder", () => {
    const s = playing({
      modifier: "doubleBolts",
      pip: haulingPip(0),
      boltProgress: [0, 0, 0, 0],
    });
    const next = step(s, null);
    expect(next.boltProgress[0]).toBe(1);
    expect(next.bolts[0]).toBe(false);
  });

  it("the second pull actually releases it", () => {
    const s = playing({
      modifier: "doubleBolts",
      pip: haulingPip(0),
      boltProgress: [1, 0, 0, 0],
    });
    const next = step(s, null);
    expect(next.boltProgress[0]).toBe(2);
    expect(next.bolts[0]).toBe(true);
  });

  it("an ordinary round releases on the first pull", () => {
    const s = playing({
      modifier: null,
      pip: haulingPip(0),
      boltProgress: [0, 0, 0, 0],
    });
    const next = step(s, null);
    expect(next.bolts[0]).toBe(true);
  });

  it("doubles the round-clear bonus on top of the doubled haul count", () => {
    const base = {
      pip: haulingPip(3),
      bolts: [true, true, true, false],
    };
    const plain = step(playing({ ...base, boltProgress: [0, 0, 0, 0] }), null);
    const doubled = step(
      playing({ ...base, modifier: "doubleBolts", boltProgress: [0, 0, 0, 1] }),
      null,
    );
    expect(plain.phase).toBe("cleared");
    expect(doubled.phase).toBe("cleared");
    // The haul itself (floor reset + bolt release) drains the boredom meter
    // from its BOREDOM_START band into the <0.33 one, earning the ×1.5
    // bonus (doc §6.2) in both runs identically — so the raw totals scale up
    // by that same 1.5 on top of whichever clear bonus applies.
    expect(plain.score).toBe(Math.round((POINTS_PER_BOLT + POINTS_PER_ROUND_CLEAR) * 1.5));
    expect(doubled.score).toBe(Math.round((POINTS_PER_BOLT + POINTS_PER_ROUND_CLEAR * 2) * 1.5));
  });
});

describe("CAFFEINATED (doc §6.3)", () => {
  it("halves the swipe cadence when a fresh one is drawn", () => {
    const s = playing({ modifier: "caffeinated", swipeCountdown: 1 });
    const next = step(s, null);
    // round 1's swipeCadence is 9 (rounds.ts) -> halved and rounded is 5.
    expect(next.swipeCountdown).toBe(5);
  });

  it("leaves hazard cadence alone", () => {
    const s = playing({ modifier: "caffeinated", spawnCountdown: 1 });
    const next = step(s, null);
    expect(next.spawnCountdown).toBe(14); // round 1's hazardCadence, untouched
  });

  it("the round's very first swipe cadence is already halved, not just re-arms", () => {
    // Forced onto round 1 title -> playing: the modifier and the initial
    // swipeCountdown are set in the same return, and must agree from tick one.
    let s = initialState(7, "standard", 1, "caffeinated");
    s = step(s, "right"); // title -> playing
    expect(s.modifier).toBe("caffeinated");
    expect(s.swipeCountdown).toBe(5); // round 1's 9, halved — not the base 9
  });

  it("a fresh round's first swipe cadence is halved too", () => {
    let s: GameState = {
      ...initialState(7, "standard", 1, "caffeinated"),
      phase: "cleared",
      clearedCountdown: 1,
      bolts: [true, true, true, true],
      modifier: "caffeinated",
    };
    s = step(s, null); // clearedCountdown -> 0, hands off to round 2
    expect(s.round).toBe(2);
    expect(s.modifier).toBe("caffeinated");
    expect(s.swipeCountdown).toBe(5); // round 2's base is still 9 (rounds.ts)
  });
});

describe("STICKY PAD (doc §6.3)", () => {
  it("doubles the input buffer's delay to two ticks", () => {
    let s = playing({
      modifier: "stickyPad",
      pip: { ...initialState(1).pip, floor: 1, slot: 5 },
    });
    s = step(s, "right"); // queued, not yet acted on
    expect(s.pip.slot).toBe(5);
    expect(s.queuedInput).toBe("right");
    s = step(s, null); // last tick's "right" lands now
    expect(s.pip.slot).toBe(6);
  });

  it("a hit clears the queued input, so it can't replay against the reset Pip", () => {
    let s = playing({
      modifier: "stickyPad",
      pip: { ...initialState(1).pip, floor: 1, slot: 7 },
    });
    s = step(s, "right"); // queued
    expect(s.queuedInput).toBe("right");
    // Bruno's swipe lands before that queued "right" is ever acted on.
    s = { ...s, hitFlash: 1 };
    s = step(s, null); // hitFlash 1 -> 0: survived-hit reset (pip, hazards)
    expect(s.pip.slot).toBe(5); // freshPip's start slot — the reset landed
    expect(s.queuedInput).toBeNull();
    s = step(s, null); // first fully unfrozen tick
    expect(s.pip.slot).toBe(5); // the stale "right" never gets replayed
  });
});

describe("forcedModifier (?modifier=, doc §6.3 playtest hook)", () => {
  it("round 1 draws the forced modifier instead of rolling one", () => {
    let s = initialState(7, "standard", 1, "nightShift");
    s = step(s, "right"); // title -> playing
    expect(s.phase).toBe("playing");
    expect(s.modifier).toBe("nightShift");
  });

  it("every following round keeps drawing it too", () => {
    // Round 1, cleared instantly: all four bolts already down.
    let s: GameState = {
      ...initialState(7, "standard", 1, "silentRunning"),
      phase: "cleared",
      clearedCountdown: 1,
      bolts: [true, true, true, true],
      modifier: "silentRunning",
    };
    s = step(s, null); // clearedCountdown -> 0, hands off to round 2
    expect(s.round).toBe(2);
    expect(s.modifier).toBe("silentRunning");
  });

  it("?modifier=greased reaches an actual spill location, not just the label", () => {
    let s = initialState(7, "standard", 1, "greased");
    s = step(s, "right"); // title -> playing
    expect(s.modifier).toBe("greased");
    expect(s.greaseFloor).not.toBeNull();
    expect(s.greaseFloor).not.toBe(1);
    expect(s.greaseFloor).not.toBe(4);
    expect(s.greaseSlot).not.toBeNull();
  });
});

describe("modifier round gate (doc §6.3)", () => {
  it("rounds 1 and 2 draw no modifier; round 3 unlocks the draw", () => {
    let s = initialState(1, "standard", 1);
    s = step(s, "right"); // title -> playing, round 1
    expect(s.round).toBe(1);
    expect(s.modifier).toBeNull();

    s = { ...s, phase: "cleared", clearedCountdown: 1, bolts: [true, true, true, true] };
    s = step(s, null); // -> round 2
    expect(s.round).toBe(2);
    expect(s.modifier).toBeNull();

    s = { ...s, phase: "cleared", clearedCountdown: 1, bolts: [true, true, true, true] };
    s = step(s, null); // round 2 is a grievance round (grievance.ts) — mediation first
    expect(s.phase).toBe("mediation");
    s = step(s, "a"); // pick the offered card -> round 3
    expect(s.round).toBe(3);
    expect(s.modifier).not.toBeNull(); // unlocked — draws for real now
  });
});
