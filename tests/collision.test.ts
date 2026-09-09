import { describe, it, expect } from "vitest";
import { hazardHits } from "../src/sim/collision";
import { freshPip, type Pip } from "../src/sim/state";
import type { Hazard } from "../src/sim/hazards";

const pipAt = (over: Partial<Pip>): Pip => ({ ...freshPip(), floor: 1, slot: 3, ...over });
const barrel: Hazard = { kind: "barrel", floor: 1, slot: 3, dir: 1 };

describe("collision (doc §5.3)", () => {
  it("hits when hazard and Pip share a floor and slot", () => {
    expect(hazardHits(pipAt({}), barrel)).toBe(true);
  });

  it("misses on a different slot or floor", () => {
    expect(hazardHits(pipAt({ slot: 4 }), barrel)).toBe(false);
    expect(hazardHits(pipAt({ floor: 2 }), barrel)).toBe(false);
  });

  it("a jump clears a low hazard", () => {
    expect(hazardHits(pipAt({ pose: "jump" }), barrel)).toBe(false);
  });

  it("a duck does not clear a low hazard", () => {
    expect(hazardHits(pipAt({ pose: "duck" }), barrel)).toBe(true);
  });
});
