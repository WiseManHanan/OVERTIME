import { describe, it, expect } from "vitest";
import {
  BATTERY_CLEAN_BONUS,
  BATTERY_DEPLETE,
  batteryContrast,
  batteryDead,
  batteryDetune,
  batteryFailsFrom,
  hasStuckSegment,
  isBlackoutTick,
  nextBattery,
  pickStuckPose,
} from "../src/sim/battery";
import { seedRng } from "../src/sim/rng";
import { isStandable } from "../src/sim/world";
import { initialState, type GameState } from "../src/sim/state";
import { step } from "../src/sim/step";

describe("battery drain (doc §7.3)", () => {
  it("holds full until the failing round — 6 standard, 4 in OVERTIME", () => {
    expect(batteryFailsFrom("standard")).toBe(6);
    expect(batteryFailsFrom("overtime")).toBe(4);
    expect(nextBattery(1, 4, "standard", false)).toBe(1); // finishing round 4 -> round 5: full
    expect(nextBattery(1, 2, "overtime", false)).toBe(1); // -> round 3: still full
    // the drain lands on the transition into the failing round:
    expect(nextBattery(1, 5, "standard", false)).toBeLessThan(1); // -> round 6
    expect(nextBattery(1, 3, "overtime", false)).toBeLessThan(1); // -> round 4
  });

  it("drains one step per round once it starts, and a clean round claws some back", () => {
    expect(nextBattery(1, 5, "standard", false)).toBeCloseTo(1 - BATTERY_DEPLETE, 5);
    expect(nextBattery(0.6, 8, "standard", true)).toBeCloseTo(
      0.6 - BATTERY_DEPLETE + BATTERY_CLEAN_BONUS,
      5,
    );
    expect(nextBattery(0.98, 9, "standard", true)).toBeLessThanOrEqual(1); // capped
    expect(nextBattery(0.05, 9, "standard", false)).toBe(0); // clamped at empty
  });

  it("thresholds: dim, stuck segment, blackout, dead", () => {
    expect(batteryContrast(0.8)).toBe(1);
    expect(batteryContrast(0.6)).toBe(0.85);
    expect(batteryContrast(0.2)).toBeLessThan(0.85);
    expect(hasStuckSegment(0.6)).toBe(false);
    expect(hasStuckSegment(0.4)).toBe(true);
    expect(hasStuckSegment(0)).toBe(false);
    expect(isBlackoutTick(0.2, 40)).toBe(true);
    expect(isBlackoutTick(0.2, 41)).toBe(false);
    expect(isBlackoutTick(0.4, 40)).toBe(false); // not low enough
    expect(batteryDead(0)).toBe(true);
    expect(batteryDead(0.01)).toBe(false);
  });

  it("the audio detune tracks the charge", () => {
    expect(batteryDetune(1)).toBeCloseTo(1, 5);
    expect(batteryDetune(0)).toBeCloseTo(0.94, 5);
    expect(batteryDetune(0.5)).toBeGreaterThan(batteryDetune(0.2));
  });

  it("pickStuckPose is deterministic and lands on a real pose-cell", () => {
    const [a] = pickStuckPose(seedRng(42));
    const [b] = pickStuckPose(seedRng(42));
    expect(a).toEqual(b);
    expect([1, 2, 3, 4]).toContain(a.f);
    expect(isStandable(a.f, a.s)).toBe(true);
    expect(["stand", "walk", "duck", "jump"]).toContain(a.pose);
  });
});

const cleared = (over: Partial<GameState>): GameState => ({
  ...initialState(1),
  phase: "cleared",
  clearedCountdown: 1,
  ...over,
});

describe("battery through the round machine (doc §7.3)", () => {
  it("a fresh round before round 6 leaves the battery full", () => {
    const s = step(cleared({ round: 3, battery: 1 }), null);
    expect(s.phase).toBe("playing");
    expect(s.round).toBe(4);
    expect(s.battery).toBe(1);
  });

  it("clearing round 6+ drains the battery and, once low, sticks a segment", () => {
    const s = step(cleared({ round: 6, battery: 0.5, roundClean: true }), null);
    expect(s.round).toBe(7);
    expect(s.battery).toBeCloseTo(0.41, 5);
    expect(s.stuckDark).not.toBeNull();
    expect(s.stuckLit).not.toBeNull();
  });

  it("a flat battery ends the run — the score stands", () => {
    const s = step(cleared({ round: 8, battery: 0.1, roundClean: false, score: 7200 }), null);
    expect(s.phase).toBe("over");
    expect(s.battery).toBe(0);
    expect(s.score).toBe(7200);
  });

  it("taking a miss clears the round-clean flag for the battery bonus", () => {
    let s: GameState = {
      ...initialState(1),
      phase: "playing",
      spawnCountdown: 1e9,
      swipeCountdown: 1e9,
      misses: 1,
      hazards: [{ kind: "barrel", floor: 1, slot: 2, dir: 1 }],
      pip: { ...initialState(1).pip, floor: 1, slot: 3 },
    };
    expect(s.roundClean).toBe(true);
    s = step(s, null); // barrel rolls onto Pip: a miss
    expect(s.misses).toBe(2);
    expect(s.roundClean).toBe(false);
  });
});
