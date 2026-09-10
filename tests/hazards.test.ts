import { describe, it, expect } from "vitest";
import {
  CHAIR_UNLOCK_ROUND,
  HAZARD_HEIGHT,
  HAZARD_SPEED,
  advanceHazard,
  spawnHazard,
  type Hazard,
} from "../src/sim/hazards";
import { seedRng } from "../src/sim/rng";

const barrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

describe("hazards (doc §5.4)", () => {
  it("spawn at Bruno's slot on floor 4, rolling one way or the other", () => {
    const [h, next] = spawnHazard(6, 1, seedRng(1));
    expect(h).toMatchObject({ floor: 4, slot: 6 });
    expect([-1, 1]).toContain(h.dir);
    expect(next).not.toBe(seedRng(1)); // the RNG advanced
  });

  it("spawn kind and direction are fully determined by the seed", () => {
    const a = spawnHazard(4, 3, seedRng(99))[0];
    const b = spawnHazard(4, 3, seedRng(99))[0];
    expect(a).toEqual(b);
  });

  it("round 1 only ever throws barrels; chairs unlock later (doc §5.4)", () => {
    for (let s = 1; s < 400; s++) {
      expect(spawnHazard(6, 1, seedRng(s))[0].kind).toBe("barrel");
    }
    const kinds = new Set<string>();
    for (let s = 1; s < 400; s++) {
      kinds.add(spawnHazard(6, CHAIR_UNLOCK_ROUND, seedRng(s))[0].kind);
    }
    expect(kinds).toContain("barrel");
    expect(kinds).toContain("chair");
  });

  it("a barrel rolls low, a chair rolls high and fast (doc §5.4)", () => {
    expect(HAZARD_HEIGHT.barrel).toBe("low");
    expect(HAZARD_HEIGHT.chair).toBe("high");
    expect(HAZARD_SPEED.barrel).toBe(1);
    expect(HAZARD_SPEED.chair).toBe(2);
  });

  it("rolls one slot per sub-step in its direction", () => {
    expect(advanceHazard(barrel(3, 4, 1))).toMatchObject({ floor: 3, slot: 5, dir: 1 });
    expect(advanceHazard(barrel(3, 4, -1))).toMatchObject({ floor: 3, slot: 3, dir: -1 });
    expect(advanceHazard({ kind: "chair", floor: 3, slot: 4, dir: 1 })).toMatchObject({
      floor: 3,
      slot: 5,
    });
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
