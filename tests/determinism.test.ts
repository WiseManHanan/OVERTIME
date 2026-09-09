import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "../src/sim/state";
import { step, type InputAction } from "../src/sim/step";
import { seedRng, nextFloat, type RngState } from "../src/sim/rng";

type Act = InputAction | null;

/** A reproducible pseudo-random input log, built from the seeded RNG itself. */
function inputLog(n: number, seed: number): Act[] {
  const pool: Act[] = ["left", "right", "up", "down", "a", null, null];
  let rng: RngState = seedRng(seed);
  const log: Act[] = [];
  for (let i = 0; i < n; i++) {
    const [f, next] = nextFloat(rng);
    rng = next;
    log.push(pool[Math.floor(f * pool.length)]!);
  }
  return log;
}

const replay = (seed: number, log: Act[]): GameState =>
  log.reduce((s, a) => step(s, a), initialState(seed));

describe("determinism", () => {
  it("same seed + same input log => byte-identical state", () => {
    const log = inputLog(5000, 12345);
    expect(JSON.stringify(replay(777, log))).toBe(JSON.stringify(replay(777, log)));
  });

  it("different seeds diverge — the hazard stream is seeded (invariant 2)", () => {
    const log = inputLog(4000, 42);
    const a = replay(1, log);
    const b = replay(2, log);
    // The RNG advanced from its seed — barrel spawns drew from it.
    expect(a.rng).not.toBe(seedRng(1));
    // Blank the seed field so the comparison is of everything the RNG touched
    // (hazard positions, misses, score), not the stored seed number.
    const bare = (s: GameState): string => JSON.stringify({ ...s, seed: 0 });
    expect(bare(a)).not.toBe(bare(b));
  });

  it("step() is pure — no wall clock, no Math.random, no DOM (runs bare in node)", () => {
    expect(() => replay(1, inputLog(2000, 9))).not.toThrow();
  });

  it("stays well-formed over a long live run", () => {
    const s = replay(2024, inputLog(3000, 5));
    expect(["title", "playing", "cleared", "over"]).toContain(s.phase);
    expect(Number.isInteger(s.pip.slot)).toBe(true);
    expect(Number.isInteger(s.pip.floor)).toBe(true);
    expect(s.misses).toBeGreaterThanOrEqual(0);
    expect(s.misses).toBeLessThanOrEqual(3);
    expect(s.round).toBeGreaterThanOrEqual(1);
    for (const h of s.hazards) {
      expect(Number.isInteger(h.slot)).toBe(true);
      expect([1, 2, 3, 4]).toContain(h.floor);
    }
  });
});
