import { describe, it, expect } from "vitest";
import { advanceHazard, spawnBarrel, type Hazard } from "../src/sim/hazards";
import { seedRng } from "../src/sim/rng";

const barrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

describe("barrels (doc §5.4)", () => {
  it("spawns at Bruno's slot on floor 4, rolling one way or the other", () => {
    const [h, next] = spawnBarrel(6, seedRng(1));
    expect(h).toMatchObject({ kind: "barrel", floor: 4, slot: 6 });
    expect([-1, 1]).toContain(h.dir);
    expect(next).not.toBe(seedRng(1)); // the RNG advanced
  });

  it("spawn direction is fully determined by the seed", () => {
    expect(spawnBarrel(6, seedRng(99))[0].dir).toBe(spawnBarrel(6, seedRng(99))[0].dir);
  });

  it("rolls one slot per tick in its direction", () => {
    expect(advanceHazard(barrel(3, 4, 1))).toMatchObject({ floor: 3, slot: 5, dir: 1 });
    expect(advanceHazard(barrel(3, 4, -1))).toMatchObject({ floor: 3, slot: 3, dir: -1 });
  });

  it("descends a floor and reverses at a floor's end", () => {
    expect(advanceHazard(barrel(3, 9, 1))).toMatchObject({ floor: 2, slot: 9, dir: -1 });
    expect(advanceHazard(barrel(4, 0, -1))).toMatchObject({ floor: 3, slot: 0, dir: 1 });
  });

  it("drops straight through the floor-2 gap", () => {
    expect(advanceHazard(barrel(2, 3, 1))).toMatchObject({ floor: 1, slot: 4, dir: 1 });
    expect(advanceHazard(barrel(2, 6, -1))).toMatchObject({ floor: 1, slot: 5, dir: -1 });
  });

  it("rolls off the bottom floor and is gone", () => {
    expect(advanceHazard(barrel(1, 9, 1))).toBeNull();
    expect(advanceHazard(barrel(1, 0, -1))).toBeNull();
  });
});
