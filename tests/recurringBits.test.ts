import { describe, it, expect } from "vitest";
import { seedRng } from "../src/sim/rng";
import { initialState, type GameState } from "../src/sim/state";
import { step } from "../src/sim/step";

describe("segment awareness (doc §7.4)", () => {
  it("never rolls while a glitch or its cooldown is still active", () => {
    const s: GameState = { ...initialState(1), phase: "playing", glitchCooldown: 5, glitchTicks: 0 };
    for (let seed = 1; seed <= 50; seed++) {
      const withSeed = { ...s, rng: seedRng(seed) };
      const next = step(withSeed, null);
      expect(next.glitchTicks).toBe(0); // cooldown blocks any new roll
      expect(next.glitchCooldown).toBe(4);
    }
  });

  it("an active glitch counts down 2 -> 1 -> 0 and starts the cooldown", () => {
    let s: GameState = {
      ...initialState(1),
      phase: "playing",
      glitchTicks: 2,
      glitchCooldown: 200,
      glitchPose: "duck",
    };
    s = step(s, null);
    expect(s.glitchTicks).toBe(1);
    expect(s.glitchCooldown).toBe(199);
    s = step(s, null);
    expect(s.glitchTicks).toBe(0);
    expect(s.glitchCooldown).toBe(198);
  });

  it("the roll can fire, and never picks Pip's actual current pose", () => {
    let fired = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const s: GameState = {
        ...initialState(seed),
        phase: "playing",
        pip: { ...initialState(seed).pip, pose: "stand" },
      };
      const next = step(s, null);
      if (next.glitchTicks > 0) {
        fired += 1;
        expect(next.glitchPose).not.toBe("stand");
        expect(next.glitchCooldown).toBe(200);
      }
    }
    // ~1/400 in expectation over 3000 tries (~7.5) — a wide, non-flaky band.
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(60);
  });
});
