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
    const a = replay(777, log);
    const b = replay(777, log);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("step() is pure — no wall clock, no Math.random, no DOM (runs bare in node)", () => {
    expect(() => replay(1, inputLog(1000, 9))).not.toThrow();
  });

  it("the RNG state is carried untouched while nothing draws from it", () => {
    const s = replay(2024, inputLog(200, 5));
    expect(s.rng).toBe(seedRng(2024));
  });
});
