import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "../src/sim/state";
import { step, type InputAction } from "../src/sim/step";

type Act = InputAction | null;

// Movement in isolation: pin the spawn/swipe countdowns so no barrel or swipe
// ever interferes with a pure-motion assertion.
const quiet = (s: GameState): GameState => ({
  ...s,
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
});
const mstep = (s: GameState, a: Act): GameState => step(quiet(s), a);
const run = (acts: Act[], seed = 1): GameState =>
  acts.reduce((s, a) => mstep(s, a), initialState(seed));

describe("movement", () => {
  it("starts on floor 1, in the title state", () => {
    const s = initialState(1);
    expect(s.pip.floor).toBe(1);
    expect(s.pip.slot).toBe(5);
    expect(s.phase).toBe("title");
  });

  it("the first directional input starts the run and moves Pip", () => {
    const s = run(["right"]);
    expect(s.phase).toBe("playing");
    expect(s.pip.slot).toBe(6);
    expect(s.pip.pose).toBe("walk");
  });

  it("keeps every position field integral over a long mixed sequence", () => {
    const pool: Act[] = ["left", "right", "up", "down", "a", null];
    const acts: Act[] = [];
    for (let i = 0; i < 4000; i++) acts.push(pool[(i * 7 + 3) % pool.length]!);
    const s = run(acts, 42);
    expect(Number.isInteger(s.pip.floor)).toBe(true);
    expect(Number.isInteger(s.pip.slot)).toBe(true);
    expect(Number.isInteger(s.pip.airborne)).toBe(true);
    expect(s.pip.slot).toBeGreaterThanOrEqual(0);
    expect(s.pip.slot).toBeLessThanOrEqual(9);
    expect([1, 2, 3, 4]).toContain(s.pip.floor);
  });

  it("blocks at both screen edges", () => {
    let s = initialState(1);
    for (let i = 0; i < 12; i++) s = mstep(s, "left");
    expect(s.pip.slot).toBe(0);
    for (let i = 0; i < 20; i++) s = mstep(s, "right");
    expect(s.pip.slot).toBe(9);
  });

  it("traverses all four floors across both screens, no fractional motion", () => {
    let s = initialState(1);

    for (let i = 0; i < 9; i++) s = mstep(s, "right");
    expect(s.pip).toMatchObject({ floor: 1, slot: 9 });
    s = mstep(s, "up");
    expect(s.pip.floor).toBe(2);

    for (let i = 0; i < 3; i++) s = mstep(s, "left"); // 9 -> 6
    expect(s.pip.slot).toBe(6);
    s = mstep(s, "left"); // into the gap: blocked
    expect(s.pip.slot).toBe(6);
    s = mstep(s, "a"); // jump the gap, facing left -> land slot 3
    expect(s.pip.slot).toBe(3);
    s = mstep(s, null);
    s = mstep(s, null);
    expect(s.pip.pose).toBe("stand");
    for (let i = 0; i < 3; i++) s = mstep(s, "left"); // 3 -> 0
    expect(s.pip.slot).toBe(0);
    s = mstep(s, "up");
    expect(s.pip.floor).toBe(3);

    for (let i = 0; i < 9; i++) s = mstep(s, "right");
    s = mstep(s, "up");
    expect(s.pip.floor).toBe(4);
    expect(Number.isInteger(s.pip.slot)).toBe(true);
  });

  it("UP off a ladder slot does nothing", () => {
    const s = run(["up"]); // slot 5, floor 1 — no ladder here
    expect(s.pip.floor).toBe(1);
  });

  it("a no-op key press does not leave the title state (doc §9.3)", () => {
    expect(run(["up"]).phase).toBe("title");
    expect(run(["down"]).phase).toBe("title");
    expect(run(["down"]).pip.pose).toBe("duck");
  });

  it("the first real move clears the title", () => {
    expect(run(["right"]).phase).toBe("playing");
    expect(run(["left"]).phase).toBe("playing");
    expect(run(["a"]).phase).toBe("playing"); // a jump that lands elsewhere is a move
  });

  it("descends a ladder with DOWN on a down-ladder slot", () => {
    let s = initialState(1);
    for (let i = 0; i < 9; i++) s = mstep(s, "right"); // floor 1 -> slot 9
    s = mstep(s, "up");
    expect(s.pip.floor).toBe(2);
    s = mstep(s, "down"); // slot 9 is floor 2's down-ladder
    expect(s.pip).toMatchObject({ floor: 1, slot: 9, pose: "climb" });
  });

  it("DOWN off a down-ladder slot still ducks", () => {
    const s = run(["down"]); // floor 1, slot 5
    expect(s.pip.pose).toBe("duck");
    expect(s.pip.floor).toBe(1);
  });

  it("a duck lasts a single tick", () => {
    let s = run(["right"]); // playing, slot 6
    s = mstep(s, "down");
    expect(s.pip.pose).toBe("duck");
    s = mstep(s, null);
    expect(s.pip.pose).toBe("stand");
  });

  it("a jump is airborne for two ticks, then acts on landing", () => {
    let s = run(["right"]); // slot 6, facing right
    s = mstep(s, "a");
    expect(s.pip).toMatchObject({ slot: 7, pose: "jump" });
    expect(s.pip.airborne).toBeGreaterThan(0);
    s = mstep(s, null);
    expect(s.pip.pose).toBe("jump"); // second airborne tick
    s = mstep(s, "left"); // lands and the input applies the same tick
    expect(s.pip).toMatchObject({ slot: 6, pose: "walk", airborne: 0 });
  });

  it("cannot move mid-arc", () => {
    let s = run(["right"]); // slot 6
    s = mstep(s, "a"); // -> slot 7
    s = mstep(s, "right"); // locked
    expect(s.pip.slot).toBe(7);
  });

  it("a blocked jump goes straight up", () => {
    let s = initialState(1);
    for (let i = 0; i < 9; i++) s = mstep(s, "right"); // slot 9, facing right
    s = mstep(s, "a");
    expect(s.pip).toMatchObject({ slot: 9, pose: "jump" });
  });

  it("airborne agrees with the jump pose every tick of the arc", () => {
    let s = run(["right"]);
    s = mstep(s, "a");
    expect(s.pip.airborne > 0).toBe(s.pip.pose === "jump");
    s = mstep(s, null);
    expect(s.pip.airborne > 0).toBe(s.pip.pose === "jump");
    s = mstep(s, null);
    expect(s.pip.airborne > 0).toBe(s.pip.pose === "jump");
  });

  it("round-trips floor 1 -> 4 -> 1", () => {
    let s = initialState(1);
    for (let i = 0; i < 9; i++) s = mstep(s, "right");
    s = mstep(s, "up"); // floor 2, slot 9
    for (let i = 0; i < 3; i++) s = mstep(s, "left"); // -> slot 6
    s = mstep(s, "a"); // jump the gap facing left -> slot 3
    s = mstep(s, null);
    s = mstep(s, null);
    for (let i = 0; i < 3; i++) s = mstep(s, "left"); // -> slot 0
    s = mstep(s, "up"); // floor 3
    for (let i = 0; i < 9; i++) s = mstep(s, "right");
    s = mstep(s, "up"); // floor 4, slot 9
    expect(s.pip.floor).toBe(4);

    s = mstep(s, "down"); // floor 3, slot 9
    expect(s.pip.floor).toBe(3);
    for (let i = 0; i < 9; i++) s = mstep(s, "left"); // -> slot 0
    s = mstep(s, "down"); // floor 2, slot 0
    expect(s.pip.floor).toBe(2);
    for (let i = 0; i < 3; i++) s = mstep(s, "right"); // -> slot 3
    s = mstep(s, "a"); // jump the gap facing right -> slot 6
    expect(s.pip.slot).toBe(6);
    s = mstep(s, null);
    s = mstep(s, null);
    for (let i = 0; i < 3; i++) s = mstep(s, "right"); // -> slot 9
    s = mstep(s, "down"); // floor 1
    expect(s.pip).toMatchObject({ floor: 1, slot: 9 });
  });
});
