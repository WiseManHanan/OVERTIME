import { describe, it, expect } from "vitest";
import {
  BOREDOM_MAX,
  BOREDOM_START,
  NEAR_MISS_POINTS,
  awardPoints,
  boredomMultiplier,
  nextAsleep,
  nextBoredom,
  stewardMood,
} from "../src/sim/scoring";
import { initialState, type GameState } from "../src/sim/state";
import { step } from "../src/sim/step";
import type { Hazard } from "../src/sim/hazards";

const barrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

/** A playing state with nothing spawning or swiping unless a test asks. */
const playing = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(1),
  phase: "playing",
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
  ...over,
});
const at = (s: GameState, floor: 1 | 2 | 3 | 4, slot: number): GameState => ({
  ...s,
  pip: { ...s.pip, floor, slot },
});

describe("boredom multiplier bands (doc §6.2)", () => {
  it("below 33% pays ×1.5, the 33–66% band ×1.0, above 66% ×0.25", () => {
    expect(boredomMultiplier(0, false)).toBe(1.5);
    expect(boredomMultiplier(32, false)).toBe(1.5);
    expect(boredomMultiplier(33, false)).toBe(1); // exactly 33% is in-band
    expect(boredomMultiplier(50, false)).toBe(1);
    expect(boredomMultiplier(66, false)).toBe(1); // exactly 66% is in-band
    expect(boredomMultiplier(67, false)).toBe(0.25);
    expect(boredomMultiplier(100, false)).toBe(0.25);
  });

  it("a sleeping Steward pays nothing regardless of the meter", () => {
    expect(boredomMultiplier(0, true)).toBe(0);
    expect(awardPoints(1000, 0, true)).toBe(0);
  });
});

describe("the asleep latch (doc §6.2)", () => {
  it("engages at a full meter and only releases below BOREDOM_WAKE", () => {
    expect(nextAsleep(false, BOREDOM_MAX)).toBe(true);
    expect(nextAsleep(true, 80)).toBe(true); // still above the wake line
    expect(nextAsleep(true, 66)).toBe(true); // wake is strict — 66 is not below
    expect(nextAsleep(true, 65)).toBe(false);
    expect(nextAsleep(false, 50)).toBe(false);
  });
});

describe("the meter fills on passivity, drains on skilled play (doc §6.2)", () => {
  const flat = {
    engaged: false,
    floorChanged: false,
    underThreat: false,
    staleFloor: false,
    nearMisses: 0,
    boltReleased: false,
  };

  it("standing safe and idle raises it; standing under threat raises it less", () => {
    const safe = nextBoredom(50, flat);
    const tense = nextBoredom(50, { ...flat, underThreat: true });
    expect(safe).toBeGreaterThan(50);
    expect(tense).toBeGreaterThan(50);
    expect(safe).toBeGreaterThan(tense);
  });

  it("engaging (moving, jumping, releasing) stops the fill", () => {
    expect(nextBoredom(50, { ...flat, engaged: true })).toBe(50);
  });

  it("a stale floor keeps filling even while engaged", () => {
    expect(nextBoredom(50, { ...flat, engaged: true, staleFloor: true })).toBeGreaterThan(50);
  });

  it("near misses, floor changes and bolt releases each drain it", () => {
    expect(nextBoredom(80, { ...flat, engaged: true, nearMisses: 1 })).toBeLessThan(80);
    expect(nextBoredom(80, { ...flat, engaged: true, floorChanged: true })).toBeLessThan(80);
    expect(nextBoredom(80, { ...flat, engaged: true, boltReleased: true })).toBeLessThan(80);
  });

  it("clamps to 0..BOREDOM_MAX and stays integral", () => {
    const lo = nextBoredom(5, { ...flat, engaged: true, nearMisses: 9 });
    const hi = nextBoredom(99, { ...flat, staleFloor: true });
    expect(lo).toBe(0);
    expect(hi).toBe(BOREDOM_MAX);
    expect(Number.isInteger(nextBoredom(50, flat))).toBe(true);
  });
});

describe("stewardMood (doc §6.2)", () => {
  it("maps the meter to what the Steward is doing", () => {
    expect(stewardMood(20, false)).toBe("bell");
    expect(stewardMood(50, false)).toBe("idle");
    expect(stewardMood(80, false)).toBe("watch");
    expect(stewardMood(80, true)).toBe("asleep");
  });
});

describe("near-miss detection through step() (doc §5.3)", () => {
  it("a barrel rolling onto the slot Pip just vacated is a near miss, and it pays", () => {
    let s = at(playing({ hazards: [barrel(1, 3, 1)] }), 1, 4);
    s = step(s, "right"); // Pip 4->5; barrel 3->4, onto the vacated slot
    expect(s.nearMisses).toBe(1);
    expect(s.misses).toBe(0);
    expect(s.score).toBeGreaterThan(0);
    expect(s.boredom).toBeLessThan(BOREDOM_START); // the dodge drained the meter
  });

  it("a low barrel passing beneath a jump is a near miss", () => {
    let s = at(playing({ hazards: [barrel(1, 5, -1)] }), 1, 4);
    s = { ...s, pip: { ...s.pip, facing: 1 } };
    s = step(s, "a"); // Pip 4->5 airborne; barrel 5->4... then next tick it's under him
    // land: Pip stays at slot 5 for the arc; roll the barrel to slot 5 beneath him
    s = { ...s, hazards: [barrel(1, 4, 1)] };
    s = step(s, null); // barrel 4->5, beneath airborne Pip
    expect(s.pip.pose).toBe("jump");
    expect(s.nearMisses).toBeGreaterThanOrEqual(1);
    expect(s.misses).toBe(0);
  });

  it("standing still next to a passing barrel is neither a hit nor a near miss", () => {
    let s = at(playing({ hazards: [barrel(1, 1, 1)] }), 1, 4);
    s = step(s, null); // barrel 1->2, nowhere near Pip, Pip did not move
    expect(s.nearMisses).toBe(0);
    expect(s.misses).toBe(0);
  });
});

describe("camping is unrewarding (Phase 4 checkpoint)", () => {
  it("idling drives the meter to full and then pays nothing", () => {
    let s = playing();
    const startScore = s.score;
    for (let i = 0; i < 40; i++) s = step(s, null);
    expect(s.boredom).toBe(BOREDOM_MAX);
    expect(s.stewardAsleep).toBe(true);
    expect(s.score).toBe(startScore);
  });

  it("even a near miss pays nothing while the Steward sleeps, but still wakes him", () => {
    let s = at(
      playing({ boredom: BOREDOM_MAX, stewardAsleep: true, hazards: [barrel(1, 3, 1)] }),
      1,
      4,
    );
    s = step(s, "right"); // a near miss
    expect(s.nearMisses).toBe(1);
    expect(s.score).toBe(0); // asleep — no points
    expect(s.boredom).toBeLessThan(BOREDOM_MAX); // ...but the meter drained
  });

  it("near-miss play outscores an equal number of idle ticks by a wide margin", () => {
    const N = 8;

    // N ticks of camping earns nothing.
    let camp = playing();
    for (let i = 0; i < N; i++) camp = step(camp, null);

    // N ticks of walking right, each time out of a slot a barrel rolls into from
    // behind — a near miss on every tick (doc §5.3).
    let run = at(playing(), 1, 1);
    for (let i = 0; i < N; i++) {
      run = { ...run, hazards: [barrel(1, run.pip.slot - 1, 1)] };
      run = step(run, "right");
      expect(run.misses).toBe(0);
    }

    expect(camp.score).toBe(0);
    expect(run.nearMisses).toBe(N);
    expect(run.score).toBeGreaterThan(NEAR_MISS_POINTS * 3);
  });
});
