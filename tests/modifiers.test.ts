import { describe, it, expect } from "vitest";
import { seedRng } from "../src/sim/rng";
import { MAX_SLOT, MIN_SLOT } from "../src/sim/world";
import { rollModifier } from "../src/sim/modifiers";
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
  it("draws one of the 7 modifiers, and only deadColumn carries a slot", () => {
    const seen = new Set<string>();
    let rng = seedRng(1);
    for (let i = 0; i < 500; i++) {
      const roll = rollModifier(rng);
      rng = roll.rng;
      seen.add(roll.modifier);
      if (roll.modifier === "deadColumn") {
        expect(roll.deadColumn).not.toBeNull();
        expect(roll.deadColumn!).toBeGreaterThanOrEqual(MIN_SLOT);
        expect(roll.deadColumn!).toBeLessThanOrEqual(MAX_SLOT);
      } else {
        expect(roll.deadColumn).toBeNull();
      }
    }
    // 500 draws across 7 uniform options — every option should show up.
    expect(seen.size).toBe(7);
  });

  it("a forced modifier always wins, but deadColumn still rolls its slot", () => {
    let rng = seedRng(1);
    for (let i = 0; i < 20; i++) {
      const roll = rollModifier(rng, "nightShift");
      rng = roll.rng;
      expect(roll.modifier).toBe("nightShift");
      expect(roll.deadColumn).toBeNull();
    }
    const slots = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const roll = rollModifier(rng, "deadColumn");
      rng = roll.rng;
      expect(roll.modifier).toBe("deadColumn");
      expect(roll.deadColumn).not.toBeNull();
      slots.add(roll.deadColumn!);
    }
    expect(slots.size).toBeGreaterThan(1); // still varies, not pinned to one column
  });
});

describe("GREASED (doc §6.3)", () => {
  it("carries Pip one extra slot the same direction", () => {
    const s = playing({
      modifier: "greased",
      pip: { ...initialState(1).pip, floor: 1, slot: 5 },
    });
    const next = step(s, "right");
    expect(next.pip.slot).toBe(7); // one ordinary step, plus the slick's extra
  });

  it("falls back to a single step when the extra slot isn't standable", () => {
    const s = playing({
      modifier: "greased",
      pip: { ...initialState(1).pip, floor: 1, slot: MAX_SLOT - 1 },
    });
    const next = step(s, "right");
    expect(next.pip.slot).toBe(MAX_SLOT); // slid to the edge, no further
  });

  it("an ordinary round takes just the one step", () => {
    const s = playing({
      modifier: "caffeinated", // anything but greased
      pip: { ...initialState(1).pip, floor: 1, slot: 5 },
    });
    const next = step(s, "right");
    expect(next.pip.slot).toBe(6);
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
});
