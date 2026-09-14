import { describe, it, expect } from "vitest";
import { roundParams } from "../src/sim/rounds";

describe("round speed table (doc §6.1)", () => {
  it("matches the table for rounds 1–6", () => {
    expect(roundParams(1)).toEqual({ speed: 1.0, hazardCadence: 14, swipeCadence: 9 });
    expect(roundParams(3)).toEqual({ speed: 1.08, hazardCadence: 13, swipeCadence: 9 });
    expect(roundParams(6)).toEqual({ speed: 1.24, hazardCadence: 11, swipeCadence: 8 });
  });

  it("round 7+ speeds up 4% per round, capped at 1.8", () => {
    expect(roundParams(7).speed).toBeCloseTo(1.24 * 1.04, 5);
    expect(roundParams(8).speed).toBeCloseTo(1.24 * 1.04 ** 2, 5);
    expect(roundParams(100).speed).toBe(1.8);
  });

  it("round 7+ cadences ease off one tick every two rounds, down to their floors", () => {
    expect(roundParams(7)).toMatchObject({ hazardCadence: 11, swipeCadence: 8 });
    expect(roundParams(8)).toMatchObject({ hazardCadence: 10, swipeCadence: 7 });
    expect(roundParams(10)).toMatchObject({ hazardCadence: 9, swipeCadence: 6 });
    expect(roundParams(12)).toMatchObject({ hazardCadence: 8, swipeCadence: 6 });
    expect(roundParams(40)).toMatchObject({ hazardCadence: 8, swipeCadence: 6 });
  });

  it("speed never decreases as rounds climb", () => {
    let prev = 0;
    for (let r = 1; r <= 40; r++) {
      const s = roundParams(r).speed;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("cadences never loosen as rounds climb", () => {
    let prevHazard = Infinity;
    let prevSwipe = Infinity;
    for (let r = 1; r <= 40; r++) {
      const p = roundParams(r);
      expect(p.hazardCadence).toBeLessThanOrEqual(prevHazard);
      expect(p.swipeCadence).toBeLessThanOrEqual(prevSwipe);
      prevHazard = p.hazardCadence;
      prevSwipe = p.swipeCadence;
    }
  });
});
