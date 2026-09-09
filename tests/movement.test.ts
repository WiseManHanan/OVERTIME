import { describe, it, expect } from "vitest";
import { initialState } from "../src/sim/state";
import { step, type InputAction } from "../src/sim/step";

type Act = InputAction | null;

const run = (acts: Act[], seed = 1) =>
  acts.reduce((s, a) => step(s, a), initialState(seed));

describe("movement — Phase 2 checkpoint", () => {
  it("starts on floor 1, in the title state", () => {
    const s = initialState(1);
    expect(s.pip.floor).toBe(1);
    expect(s.pip.slot).toBe(5);
    expect(s.started).toBe(false);
  });

  it("the first directional input starts the run and moves Pip", () => {
    const s = run(["right"]);
    expect(s.started).toBe(true);
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
    for (let i = 0; i < 12; i++) s = step(s, "left");
    expect(s.pip.slot).toBe(0);
    for (let i = 0; i < 20; i++) s = step(s, "right");
    expect(s.pip.slot).toBe(9);
  });

  it("traverses all four floors across both screens, no fractional motion", () => {
    let s = initialState(1);

    // floor 1: ladder up at slot 9
    for (let i = 0; i < 9; i++) s = step(s, "right");
    expect(s.pip).toMatchObject({ floor: 1, slot: 9 });
    s = step(s, "up");
    expect(s.pip.floor).toBe(2);

    // floor 2: gap at slots 4–5, ladder up at slot 0
    for (let i = 0; i < 3; i++) s = step(s, "left"); // 9 -> 6
    expect(s.pip.slot).toBe(6);
    s = step(s, "left"); // into the gap: blocked
    expect(s.pip.slot).toBe(6);
    s = step(s, "a"); // jump the gap, facing left -> land slot 3
    expect(s.pip.slot).toBe(3);
    s = step(s, null); // drain the arc
    s = step(s, null);
    expect(s.pip.pose).toBe("stand");
    for (let i = 0; i < 3; i++) s = step(s, "left"); // 3 -> 0
    expect(s.pip.slot).toBe(0);
    s = step(s, "up");
    expect(s.pip.floor).toBe(3);

    // floor 3: ladder up at slot 9
    for (let i = 0; i < 9; i++) s = step(s, "right");
    s = step(s, "up");
    expect(s.pip.floor).toBe(4);
    expect(Number.isInteger(s.pip.slot)).toBe(true);
  });

  it("UP off a ladder slot does nothing", () => {
    const s = run(["up"]); // slot 5, floor 1 — no ladder here
    expect(s.pip.floor).toBe(1);
  });

  it("a no-op key press does not leave the title state (doc §9.3)", () => {
    // UP with no ladder here, and DOWN as a plain duck, move Pip nowhere — so
    // the title and the LEFT/RIGHT hint must stay up.
    expect(run(["up"]).started).toBe(false);
    expect(run(["down"]).started).toBe(false);
    expect(run(["down"]).pip.pose).toBe("duck");
  });

  it("the first real move clears the title", () => {
    expect(run(["right"]).started).toBe(true);
    expect(run(["left"]).started).toBe(true);
    // a jump that lands on a new slot counts as a move
    expect(run(["a"]).started).toBe(true);
  });

  it("descends a ladder with DOWN on a down-ladder slot", () => {
    let s = initialState(1);
    for (let i = 0; i < 9; i++) s = step(s, "right"); // floor 1 -> slot 9
    s = step(s, "up");
    expect(s.pip.floor).toBe(2);
    s = step(s, "down"); // slot 9 is floor 2's down-ladder
    expect(s.pip).toMatchObject({ floor: 1, slot: 9, pose: "climb" });
  });

  it("DOWN off a down-ladder slot still ducks", () => {
    const s = run(["down"]); // floor 1, slot 5
    expect(s.pip.pose).toBe("duck");
    expect(s.pip.floor).toBe(1);
  });

  it("round-trips floor 1 -> 4 -> 1", () => {
    let s = initialState(1);
    // up
    for (let i = 0; i < 9; i++) s = step(s, "right");
    s = step(s, "up"); // floor 2, slot 9
    for (let i = 0; i < 3; i++) s = step(s, "left"); // -> slot 6
    s = step(s, "a"); // jump the gap facing left -> slot 3
    s = step(s, null);
    s = step(s, null);
    for (let i = 0; i < 3; i++) s = step(s, "left"); // -> slot 0
    s = step(s, "up"); // floor 3
    for (let i = 0; i < 9; i++) s = step(s, "right");
    s = step(s, "up"); // floor 4, slot 9
    expect(s.pip.floor).toBe(4);
    // down
    s = step(s, "down"); // floor 3, slot 9
    expect(s.pip.floor).toBe(3);
    for (let i = 0; i < 9; i++) s = step(s, "left"); // -> slot 0
    s = step(s, "down"); // floor 2, slot 0
    expect(s.pip.floor).toBe(2);
    for (let i = 0; i < 3; i++) s = step(s, "right"); // -> slot 3
    s = step(s, "a"); // jump the gap facing right -> slot 6
    expect(s.pip.slot).toBe(6);
    s = step(s, null);
    s = step(s, null);
    for (let i = 0; i < 3; i++) s = step(s, "right"); // -> slot 9
    s = step(s, "down"); // floor 1
    expect(s.pip).toMatchObject({ floor: 1, slot: 9 });
  });

  it("a jump is airborne for two ticks, then grounded", () => {
    let s = run(["right"]); // slot 6, facing right, started
    s = step(s, "a");
    expect(s.pip.pose).toBe("jump");
    expect(s.pip.slot).toBe(7); // ordinary hop, resolved at takeoff
    s = step(s, null);
    expect(s.pip.pose).toBe("jump"); // arc tick
    s = step(s, null);
    expect(s.pip.pose).toBe("stand"); // landed
    expect(s.pip.airborne).toBe(0);
  });

  it("cannot act mid-arc", () => {
    let s = run(["right"]); // slot 6
    s = step(s, "a"); // -> slot 7, airborne
    s = step(s, "right"); // ignored
    expect(s.pip.slot).toBe(7);
  });

  it("a blocked jump goes straight up", () => {
    let s = initialState(1);
    for (let i = 0; i < 9; i++) s = step(s, "right"); // slot 9, facing right
    s = step(s, "a"); // nothing to the right
    expect(s.pip.slot).toBe(9);
    expect(s.pip.pose).toBe("jump");
  });

  it("duck lasts a single tick and locks movement", () => {
    let s = run(["down"]);
    expect(s.pip.pose).toBe("duck");
    s = step(s, null);
    expect(s.pip.pose).toBe("stand");
  });
});
