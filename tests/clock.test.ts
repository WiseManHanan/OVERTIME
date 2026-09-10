import { describe, it, expect } from "vitest";
import { clockParams, resolveClock, type ClockMode } from "../src/sim/clock";
import { initialState, type GameState } from "../src/sim/state";
import { step } from "../src/sim/step";
import type { Hazard } from "../src/sim/hazards";

const at = (h: number): Date => new Date(2026, 8, 10, h, 30, 0);

describe("clock mode resolution (doc §7.1)", () => {
  it("maps each time-of-day window to its mode", () => {
    expect(resolveClock(at(0))).toBe("night");
    expect(resolveClock(at(5))).toBe("night");
    expect(resolveClock(at(6))).toBe("morning");
    expect(resolveClock(at(8))).toBe("morning");
    expect(resolveClock(at(9))).toBe("standard");
    expect(resolveClock(at(12))).toBe("standard");
    expect(resolveClock(at(13))).toBe("lunch");
    expect(resolveClock(at(14))).toBe("slump");
    expect(resolveClock(at(17))).toBe("slump");
    expect(resolveClock(at(18))).toBe("overtime");
    expect(resolveClock(at(23))).toBe("overtime");
  });

  it("STANDARD is neutral — every knob at its default", () => {
    const p = clockParams("standard");
    expect(p).toMatchObject({ speed: 1, points: 1, boredomRate: 1, brunoAwayUntil: 0, brunoSlowUntil: 0 });
  });

  it("SLUMP is slower but more tedious; OVERTIME faster and richer", () => {
    expect(clockParams("slump").speed).toBeLessThan(1);
    expect(clockParams("slump").boredomRate).toBeGreaterThan(1);
    expect(clockParams("overtime").speed).toBeGreaterThan(1);
    expect(clockParams("overtime").points).toBe(2);
  });
});

const quiet = (clock: ClockMode, over: Partial<GameState> = {}): GameState => ({
  ...initialState(1, clock),
  phase: "playing",
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
  ...over,
});
const mkBarrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

describe("clock modes bend the run (doc §7.1)", () => {
  it("SLUMP fills the boredom meter faster than STANDARD", () => {
    const idle = (clock: ClockMode): number => {
      let s = quiet(clock);
      for (let i = 0; i < 5; i++) s = step(s, null);
      return s.boredom;
    };
    expect(idle("slump")).toBeGreaterThan(idle("standard"));
  });

  it("OVERTIME doubles the points a near miss pays", () => {
    const nm = (clock: ClockMode): number => {
      let s: GameState = quiet(clock, { hazards: [mkBarrel(1, 3, 1)] });
      s = { ...s, pip: { ...s.pip, floor: 1, slot: 4 } };
      s = step(s, "right"); // Pip 4->5, barrel 3->4: a near miss on the vacated slot
      return s.score;
    };
    expect(nm("overtime")).toBe(nm("standard") * 2);
    expect(nm("standard")).toBeGreaterThan(0);
  });

  it("LUNCH keeps Bruno off the platform — nothing is thrown before he's back", () => {
    let s = quiet("lunch", { spawnCountdown: 1 });
    for (let i = 0; i < 40; i++) s = step(s, null); // well within the 60-tick window
    expect(s.hazards.length).toBe(0);
  });

  it("NIGHT: Bruno stays away all round; ordinary points are NOT doubled", () => {
    let s = quiet("night", { spawnCountdown: 1, hazards: [mkBarrel(1, 3, 1)] });
    s = { ...s, pip: { ...s.pip, floor: 1, slot: 4 } };
    s = step(s, "right");
    expect(s.hazards.filter((h) => h.floor === 4).length).toBe(0); // nothing thrown
    expect(s.score).toBe(50 * 1.5); // near miss * boredom (×1.5 draining), no NIGHT ×2
  });

  it("NIGHT: only the round-clear bonus is doubled (doc §7.1)", () => {
    const clearScore = (clock: ClockMode): number => {
      let s = quiet(clock, {
        bolts: [true, true, true, false],
        boredom: 70, // stays in the ×1.0 band after the haul's drains
        pip: { ...quiet(clock).pip, floor: 4, slot: 8, releasing: 1, releasingBolt: 3 },
      });
      s = step(s, null); // completes the 4th holder -> round clears
      expect(s.phase).toBe("cleared");
      return s.score;
    };
    expect(clearScore("night") - clearScore("standard")).toBe(750); // one extra clear bonus
  });

  it("a clock window is measured per round, not from run start", () => {
    // Bruno is 'away' for the first 60 ticks of every round in LUNCH — including
    // rounds reached long after run start.
    let s = quiet("lunch", { round: 3, tick: 5000, playingSince: 5000, spawnCountdown: 1 });
    for (let i = 0; i < 30; i++) s = step(s, null);
    expect(s.hazards.length).toBe(0); // still within this round's 60-tick window
  });
});
