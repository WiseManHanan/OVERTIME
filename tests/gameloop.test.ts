import { describe, it, expect } from "vitest";
import {
  BOLT_RELEASE_TICKS,
  BRUNO_SLOT,
  MISSES_ALLOWED,
  POINTS_PER_BOLT,
  POINTS_PER_ROUND_CLEAR,
  ROUND_CLEARED_TICKS,
  initialState,
  type GameState,
} from "../src/sim/state";
import { step } from "../src/sim/step";
import { BOLT_SLOTS } from "../src/sim/world";
import type { Hazard } from "../src/sim/hazards";

type Floor = 1 | 2 | 3 | 4;
const mkBarrel = (floor: Floor, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

/** A playing state with nothing spawning or swiping unless a test asks. */
const quietPlaying = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(1),
  phase: "playing",
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
  ...over,
});

const at = (s: GameState, floor: Floor, slot: number): GameState => ({
  ...s,
  pip: { ...s.pip, floor, slot },
});

describe("bolts and round clear (doc §5.5)", () => {
  it("UP on a bolt station starts a 3-tick release that locks movement", () => {
    let s = at(quietPlaying(), 4, BOLT_SLOTS[0]!);
    s = step(s, "up");
    expect(s.pip.pose).toBe("release");
    expect(s.pip.releasing).toBe(BOLT_RELEASE_TICKS);

    const slot = s.pip.slot;
    s = step(s, "left"); // ignored — locked
    expect(s.pip.slot).toBe(slot);
    expect(s.pip.pose).toBe("release");

    s = step(s, null);
    s = step(s, null); // third tick completes it
    expect(s.pip.releasing).toBe(0);
    expect(s.bolts[0]).toBe(true);
    expect(s.score).toBe(POINTS_PER_BOLT);
  });

  it("releasing all four bolts clears the round, then the next begins fresh", () => {
    let s = quietPlaying();
    for (let b = 0; b < BOLT_SLOTS.length; b++) {
      s = at(s, 4, BOLT_SLOTS[b]!);
      s = step(s, "up");
      s = step(s, null);
      s = step(s, null);
      s = step(s, null);
      expect(s.bolts[b]).toBe(true);
    }
    expect(s.phase).toBe("cleared");
    // Face value is 4 bolts + the clear bonus; the boredom multiplier can only
    // lift it here, since a run of releases keeps the meter draining (doc §6.2).
    expect(s.score).toBeGreaterThanOrEqual(POINTS_PER_BOLT * 4 + POINTS_PER_ROUND_CLEAR);

    for (let i = 0; i < ROUND_CLEARED_TICKS; i++) s = step(s, null);
    expect(s.phase).toBe("playing");
    expect(s.round).toBe(2);
    expect(s.bolts.every((x) => x === false)).toBe(true);
    expect(s.pip.floor).toBe(1);
  });
});

describe("misses and game over (doc §5.6)", () => {
  it("a barrel rolling onto Pip's slot is a miss, and it shatters", () => {
    let s = at(quietPlaying({ misses: 2, hazards: [mkBarrel(1, 2, 1)] }), 1, 3);
    s = step(s, null); // barrel 2 -> 3, onto Pip
    expect(s.misses).toBe(3);
    expect(s.phase).toBe("over");
    expect(s.hazards.length).toBe(0);
  });

  it("jumping over a barrel is not a miss", () => {
    let s = quietPlaying({ hazards: [mkBarrel(1, 5, -1)] });
    s = { ...at(s, 1, 3), pip: { ...s.pip, floor: 1, slot: 3, facing: 1 } };
    s = step(s, "a"); // Pip -> slot 4 airborne; barrel 5 -> 4
    expect(s.pip.pose).toBe("jump");
    expect(s.misses).toBe(0);
  });

  it("game over is a trap state — step only advances the tick", () => {
    const base = { ...initialState(1), phase: "over" as const, score: 900 };
    const s = step(base, "right");
    expect(s.phase).toBe("over");
    expect(s.pip).toEqual(initialState(1).pip);
    expect(s.tick).toBe(base.tick + 1);
  });

  it("a swing that ended the run still falls on the GAME OVER screen", () => {
    let s: GameState = { ...initialState(1), phase: "over", swipe: 2 };
    s = step(s, null);
    expect(s.swipe).toBe(1);
    s = step(s, null);
    expect(s.swipe).toBe(0);
    s = step(s, null);
    expect(s.swipe).toBe(0); // and it stays down
  });

  it("Bruno is not frozen mid-swing through the ROUND CLEAR countdown", () => {
    let s = quietPlaying({ phase: "cleared", clearedCountdown: ROUND_CLEARED_TICKS, swipe: 2 });
    s = step(s, null);
    expect(s.swipe).toBe(1);
    s = step(s, null);
    expect(s.swipe).toBe(0);
  });
});

describe("Bruno's swipe (doc §5.5)", () => {
  it("swiping Pip on his released station costs a miss and knocks that bolt out", () => {
    // slot 5 is bolt index 2, one slot from Bruno — in reach.
    let s = at(
      quietPlaying({ swipeCountdown: 1, bolts: [true, false, true, false] }),
      4,
      5,
    );
    s = step(s, null);
    expect(s.misses).toBe(1);
    expect(s.bolts[2]).toBe(false); // Pip's own station
    expect(s.bolts[0]).toBe(true); // a far, secured bolt is untouched
    expect(s.swipe).toBe(2);
  });

  it("a swipe with Pip between stations is only a miss, no bolt lost", () => {
    let s = at(
      quietPlaying({ swipeCountdown: 1, bolts: [true, false, false, false] }),
      4,
      BRUNO_SLOT, // slot 6 — in reach, but not a station
    );
    s = step(s, null);
    expect(s.misses).toBe(1);
    expect(s.bolts[0]).toBe(true);
  });

  it("interrupts an in-progress release and the bolt stays out", () => {
    let s = at(quietPlaying({ swipeCountdown: 2 }), 4, BOLT_SLOTS[3]!); // slot 7, in reach
    s = step(s, "up"); // start releasing bolt 3
    expect(s.pip.releasing).toBeGreaterThan(0);
    s = step(s, null); // swipe fires mid-release
    expect(s.misses).toBe(1);
    expect(s.pip.releasing).toBe(0);
    expect(s.bolts[3]).toBe(false);
  });

  it("leaving floor 4 before the swipe avoids it", () => {
    let s = at(quietPlaying({ swipeCountdown: 1 }), 3, BRUNO_SLOT);
    s = step(s, null);
    expect(s.misses).toBe(0);
  });

  it("bolts out of swipe reach are safe", () => {
    let s = at(quietPlaying({ swipeCountdown: 1 }), 4, BOLT_SLOTS[0]!); // slot 1, far from Bruno
    s = step(s, null);
    expect(s.misses).toBe(0);
  });
});

describe("hazard fairness", () => {
  it("a barrel crossing straight through Pip in one tick still hits (no tunneling)", () => {
    // Pip at slot 4, barrel at slot 5 rolling left; Pip walks right into it.
    let s = at(quietPlaying({ hazards: [mkBarrel(1, 5, -1)] }), 1, 4);
    s = step(s, "right"); // Pip 4->5, barrel 5->4: they swap
    expect(s.misses).toBe(1);
  });

  it("jumping a crossing barrel is still safe", () => {
    let s = { ...at(quietPlaying({ hazards: [mkBarrel(1, 5, -1)] }), 1, 4) };
    s = { ...s, pip: { ...s.pip, facing: 1 } };
    s = step(s, "a"); // Pip 4->5 airborne, barrel 5->4
    expect(s.misses).toBe(0);
  });

  it("a freshly spawned barrel is not lethal on its spawn tick", () => {
    let s = at(quietPlaying({ spawnCountdown: 1 }), 4, BRUNO_SLOT);
    s = step(s, null); // barrel spawns at (4, BRUNO_SLOT), Pip's slot
    expect(s.misses).toBe(0);
    expect(s.hazards.length).toBe(1);
  });
});

describe("edge cases the review turned up", () => {
  it("two hits in one tick still end the run at exactly MISSES_ALLOWED", () => {
    let s = at(
      quietPlaying({
        misses: MISSES_ALLOWED - 1,
        swipeCountdown: 1,
        bolts: [false, false, true, false],
        hazards: [mkBarrel(4, 4, 1)], // rolls onto slot 5 this tick
      }),
      4,
      5, // in swipe reach and in the barrel's path
    );
    s = step(s, null);
    expect(s.misses).toBe(MISSES_ALLOWED);
    expect(s.phase).toBe("over");
  });

  it("a bolt secured on the same tick as a swipe is kept, not undone", () => {
    let s = at(quietPlaying({ swipeCountdown: 1 }), 4, BOLT_SLOTS[3]!); // slot 7
    s = { ...s, pip: { ...s.pip, releasing: 1, releasingBolt: 3 } };
    s = step(s, null); // release completes AND the swipe lands, same tick
    expect(s.misses).toBe(1); // still charged
    expect(s.bolts[3]).toBe(true); // ...but the bolt stands
    expect(s.score).toBe(POINTS_PER_BOLT);
  });

  it("the swipe telegraphs a tick before it lands", () => {
    let s = at(quietPlaying({ swipeCountdown: 2 }), 4, BRUNO_SLOT);
    s = step(s, null);
    expect(s.swipe).toBeGreaterThan(0); // windup frame: arm is out
    expect(s.misses).toBe(0); // no hit yet
    s = step(s, null);
    expect(s.misses).toBe(1); // hit lands the next tick
  });

  it("a barrel cannot hit Pip on the climb tick — the ladder is a refuge", () => {
    let s = at(quietPlaying({ hazards: [mkBarrel(2, 8, 1)] }), 1, 9);
    s = step(s, "up"); // Pip climbs to floor 2 slot 9; barrel rolls to floor 2 slot 9
    expect(s.pip).toMatchObject({ floor: 2, slot: 9, pose: "climb" });
    expect(s.misses).toBe(0);
  });
});

describe("the title state holds", () => {
  it("nothing spawns until Pip moves", () => {
    let s = initialState(1);
    for (let i = 0; i < 60; i++) s = step(s, null);
    expect(s.phase).toBe("title");
    expect(s.hazards.length).toBe(0);
  });
});
