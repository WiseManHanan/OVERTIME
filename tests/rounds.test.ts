import { describe, it, expect } from "vitest";
import { roundParams } from "../src/sim/rounds";

describe("round speed table (doc §6.1)", () => {
  it("matches the table for rounds 1–6", () => {
    expect(roundParams(1)).toEqual({ speed: 1.0, hazardCadence: 14, swipeCadence: 9 });
    expect(roundParams(3)).toEqual({ speed: 1.2, hazardCadence: 11, swipeCadence: 8 });
    expect(roundParams(6)).toEqual({ speed: 1.6, hazardCadence: 8, swipeCadence: 7 });
  });

  it("round 7+ speeds up 10% per round, capped at 2.6", () => {
    expect(roundParams(7).speed).toBeCloseTo(1.76, 5);
    expect(roundParams(8).speed).toBeCloseTo(1.936, 5);
    expect(roundParams(50).speed).toBe(2.6);
  });

  it("round 7+ cadences tighten to their floors", () => {
    expect(roundParams(7)).toMatchObject({ hazardCadence: 7, swipeCadence: 6 });
    expect(roundParams(8)).toMatchObject({ hazardCadence: 6, swipeCadence: 5 });
    expect(roundParams(30)).toMatchObject({ hazardCadence: 6, swipeCadence: 5 });
  });

  it("speed never decreases as rounds climb", () => {
    let prev = 0;
    for (let r = 1; r <= 40; r++) {
      const s = roundParams(r).speed;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});
