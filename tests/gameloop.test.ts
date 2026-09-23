import { describe, it, expect } from "vitest";
import {
  BOLT_RELEASE_TICKS,
  BRUNO_MAX_SLOT,
  BRUNO_MIN_SLOT,
  BRUNO_SLOT,
  CONSOLE_SLOT,
  HIT_FLASH_TICKS,
  MISSES_ALLOWED,
  POINTS_PER_BOLT,
  POINTS_PER_ROUND_CLEAR,
  ROUND_CLEARED_TICKS,
  START_FLOOR,
  START_SLOT,
  initialState,
  type GameState,
} from "../src/sim/state";
import { step } from "../src/sim/step";
import { CHAIR_FULL_SPEED_ROUND, CHAIR_UNLOCK_ROUND, type Hazard } from "../src/sim/hazards";
import { roundParams } from "../src/sim/rounds";

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

/** Steps through the post-hit freeze (doc-independent tuning, HIT_FLASH_TICKS)
 *  so a fatal hit's GAME OVER — deferred until the blink finishes — actually
 *  lands. */
const throughHitFlash = (s: GameState): GameState => {
  let cur = s;
  while (cur.hitFlash > 0) cur = step(cur, null);
  return cur;
};

describe("the console and round clear (doc §5.5)", () => {
  it("UP at the console starts a 3-tick haul that locks movement", () => {
    let s = at(quietPlaying(), 4, CONSOLE_SLOT);
    s = step(s, "up");
    expect(s.pip.pose).toBe("release");
    expect(s.pip.releasing).toBe(BOLT_RELEASE_TICKS);

    s = step(s, "left"); // ignored — locked
    expect(s.pip.slot).toBe(CONSOLE_SLOT);
    expect(s.pip.pose).toBe("release");

    s = step(s, null);
    s = step(s, null); // third tick completes it
    expect(s.pip.releasing).toBe(0);
    expect(s.bolts[0]).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(POINTS_PER_BOLT);
  });

  it("hauling a lever sweeps the stage clear and warps Pip to the start", () => {
    let s = at(quietPlaying({ hazards: [mkBarrel(3, 4, 1), mkBarrel(2, 7, -1)] }), 4, CONSOLE_SLOT);
    s = { ...s, pip: { ...s.pip, releasing: 1, releasingBolt: 0 } };
    s = step(s, null); // haul completes this tick
    expect(s.bolts[0]).toBe(true);
    expect(s.hazards.length).toBe(0); // stage swept
    expect(s.pip.floor).toBe(START_FLOOR); // warped home
    expect(s.pip.slot).toBe(START_SLOT);
    expect(s.pip.releasing).toBe(0);
  });

  it("hauling all four levers clears the round, then the next begins fresh", () => {
    let s = quietPlaying();
    for (let b = 0; b < 4; b++) {
      s = at(s, 4, CONSOLE_SLOT); // the haul warped Pip away — put him back
      s = step(s, "up");
      s = step(s, null);
      s = step(s, null);
      s = step(s, null);
      expect(s.bolts[b]).toBe(true);
    }
    expect(s.phase).toBe("cleared");
    // 4 levers + the clear bonus at face value; the meter drains on every haul,
    // so the boredom multiplier only ever lifts it (doc §6.2).
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
    expect(s.hitFlash).toBeGreaterThan(0); // pauses and blinks first
    expect(s.phase).toBe("playing"); // GAME OVER waits for the blink
    s = throughHitFlash(s);
    expect(s.phase).toBe("over");
    expect(s.hazards.length).toBe(0);
  });

  it("a survivable hit pauses everything but Pip's blink for HIT_FLASH_TICKS", () => {
    let s = at(
      quietPlaying({ misses: 0, hazards: [mkBarrel(1, 2, 1)], brunoSlot: BRUNO_SLOT, brunoDir: 1 }),
      1,
      3,
    );
    const beforeHit = s;
    s = step(s, null); // barrel 2 -> 3, onto Pip: a survivable miss
    expect(s.misses).toBe(1);
    expect(s.hitFlash).toBe(HIT_FLASH_TICKS);
    expect(s.phase).toBe("playing");

    // Frozen ticks: input is ignored, Bruno doesn't pace, nothing but the
    // tick counter and hitFlash itself move.
    const frozenPip = s.pip;
    const frozenBruno = s.brunoSlot;
    for (let i = 0; i < HIT_FLASH_TICKS - 1; i++) {
      s = step(s, "right");
      expect(s.pip).toEqual(frozenPip);
      expect(s.brunoSlot).toBe(frozenBruno);
    }
    expect(s.hitFlash).toBe(1);

    s = step(s, null); // the last frozen tick: hitFlash reaches 0
    expect(s.hitFlash).toBe(0);
    expect(s.phase).toBe("playing"); // survived — play resumes, no GAME OVER
    expect(s.tick).toBe(beforeHit.tick + 1 + HIT_FLASH_TICKS);
    expect(s.pip.floor).toBe(START_FLOOR); // sent back to the start, like a haul
    expect(s.pip.slot).toBe(START_SLOT);
    expect(s.pip.pose).toBe("stand");
  });

  it("a survived hit also sweeps every hazard still on the board", () => {
    // One barrel hits Pip; another, elsewhere on the board, survives the tick.
    let s = at(
      quietPlaying({ hazards: [mkBarrel(1, 2, 1), mkBarrel(3, 8, 1)] }),
      1,
      3,
    );
    s = step(s, null); // barrel 2 -> 3, onto Pip; the other barrel just rolls on
    expect(s.hitFlash).toBe(HIT_FLASH_TICKS);
    expect(s.hazards.length).toBe(1); // the survivor is still out there, frozen in place
    for (let i = 0; i < HIT_FLASH_TICKS - 1; i++) {
      s = step(s, null);
      expect(s.hazards.length).toBe(1); // untouched through the freeze
    }
    s = step(s, null); // the last frozen tick
    expect(s.hazards).toEqual([]); // swept, same as a haul
  });

  it("jumping over a barrel is not a miss", () => {
    let s = quietPlaying({ hazards: [mkBarrel(1, 5, -1)] });
    s = { ...at(s, 1, 3), pip: { ...s.pip, floor: 1, slot: 3, facing: 1 } };
    s = step(s, "a"); // Pip -> slot 4 airborne; barrel 5 -> 4
    expect(s.pip.pose).toBe("jump");
    expect(s.misses).toBe(0);
  });

  it("game over is a trap state — step only advances the tick", () => {
    let s: GameState = { ...initialState(1), phase: "over", score: 900, swipe: 2 };
    s = step(s, "right");
    expect(s.phase).toBe("over");
    expect(s.pip).toEqual(initialState(1).pip);
    expect(s.tick).toBe(1);
    expect(s.score).toBe(900); // nothing changes on the results screen
    expect(s.swipe).toBe(2);
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
  it("the swing reaches the console when Bruno has paced up to it", () => {
    let s = at(quietPlaying({ swipeCountdown: 1, brunoSlot: CONSOLE_SLOT }), 4, CONSOLE_SLOT);
    s = step(s, null);
    expect(s.misses).toBe(1);
    expect(s.swipe).toBe(2);
  });

  it("the console is safe while Bruno paces the far end", () => {
    let s = at(quietPlaying({ swipeCountdown: 1, brunoSlot: BRUNO_MIN_SLOT }), 4, CONSOLE_SLOT);
    s = step(s, null);
    expect(s.misses).toBe(0);
  });

  it("a swipe at the console knocks the last-pulled lever back up", () => {
    let s = at(
      quietPlaying({ swipeCountdown: 1, brunoSlot: CONSOLE_SLOT, bolts: [true, false, false, false] }),
      4,
      CONSOLE_SLOT,
    );
    s = step(s, null);
    expect(s.misses).toBe(1);
    expect(s.bolts[0]).toBe(false); // knocked back up
  });

  it("a swipe with Pip off the console is only a miss, no lever lost", () => {
    let s = at(
      quietPlaying({ swipeCountdown: 1, brunoSlot: BRUNO_SLOT, bolts: [true, false, false, false] }),
      4,
      BRUNO_SLOT, // in reach of the swing, but nowhere near the console
    );
    s = step(s, null);
    expect(s.misses).toBe(1);
    expect(s.bolts[0]).toBe(true);
  });

  it("interrupts a haul and the lever stays up", () => {
    // Bruno paces from slot 6 up to his max reach (one short of the console
    // itself) on the swipe tick — SWIPE_REACH still closes that last gap.
    let s = at(quietPlaying({ swipeCountdown: 2, brunoSlot: BRUNO_MAX_SLOT - 1, brunoDir: 1 }), 4, CONSOLE_SLOT);
    s = step(s, "up"); // start hauling lever 0
    expect(s.pip.releasing).toBeGreaterThan(0);
    s = step(s, null); // swipe fires mid-haul
    expect(s.misses).toBe(1);
    expect(s.pip.releasing).toBe(0);
    expect(s.bolts[0]).toBe(false);
  });

  it("leaving floor 4 before the swipe avoids it", () => {
    let s = at(quietPlaying({ swipeCountdown: 1 }), 3, BRUNO_SLOT);
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
    s = throughHitFlash(s);
    expect(s.phase).toBe("over");
  });

  it("a lever secured on the same tick as a swipe is kept, not undone", () => {
    let s = at(quietPlaying({ swipeCountdown: 1, brunoSlot: CONSOLE_SLOT }), 4, CONSOLE_SLOT);
    s = { ...s, pip: { ...s.pip, releasing: 1, releasingBolt: 0 } };
    s = step(s, null); // haul completes AND the swipe lands, same tick
    expect(s.misses).toBe(1); // still charged
    expect(s.bolts[0]).toBe(true); // ...but the lever stays down
    expect(s.score).toBeGreaterThanOrEqual(POINTS_PER_BOLT);
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

  it("Bruno stays put on the title screen", () => {
    let s = initialState(1);
    for (let i = 0; i < 20; i++) s = step(s, null);
    expect(s.brunoSlot).toBe(BRUNO_SLOT);
  });

  it("a debug startRound plays out exactly like reaching that round normally", () => {
    let s = initialState(1, "standard", 5);
    expect(s.round).toBe(5);
    s = step(s, "right"); // first move: title -> playing
    expect(s.phase).toBe("playing");
    const p = roundParams(5);
    expect(s.spawnCountdown).toBe(p.hazardCadence);
    expect(s.swipeCountdown).toBe(p.swipeCadence);
  });
});

describe("Bruno paces his girder (doc §5.5)", () => {
  it("steps along the beat, staying in bounds and reversing at the ends", () => {
    let s = quietPlaying({ brunoSlot: BRUNO_MAX_SLOT - 1, brunoDir: 1 });
    const seen = new Set<number>();
    let dir = s.brunoDir;
    let reversed = false;
    for (let i = 0; i < 40; i++) {
      s = step(s, null);
      seen.add(s.brunoSlot);
      if (s.brunoDir !== dir) reversed = true;
      dir = s.brunoDir;
      expect(s.brunoSlot).toBeGreaterThanOrEqual(BRUNO_MIN_SLOT);
      expect(s.brunoSlot).toBeLessThanOrEqual(BRUNO_MAX_SLOT);
    }
    expect(reversed).toBe(true);
    expect(seen.has(BRUNO_MAX_SLOT)).toBe(true);
    expect(seen.has(BRUNO_MIN_SLOT)).toBe(true);
  });

  it("hazards spawn from wherever Bruno currently stands", () => {
    let s = quietPlaying({ brunoSlot: 3, brunoDir: 1, spawnCountdown: 1 });
    s = step(s, null);
    const spawned = s.hazards.find((h) => h.floor === 4);
    expect(spawned).toBeDefined();
    expect(spawned?.slot).toBe(s.brunoSlot);
  });

  it("a chair covers two slots a tick once at full speed (doc §5.4)", () => {
    let s = quietPlaying({
      round: CHAIR_FULL_SPEED_ROUND,
      hazards: [{ kind: "chair", floor: 3, slot: 2, dir: 1 }],
    });
    s = step(s, null);
    expect(s.hazards[0]?.kind).toBe("chair");
    expect(s.hazards[0]?.slot).toBe(4); // 2 -> 3 -> 4
  });

  it("a chair still covers one slot a tick before it ramps up to full speed", () => {
    let s = quietPlaying({
      round: CHAIR_UNLOCK_ROUND,
      hazards: [{ kind: "chair", floor: 3, slot: 2, dir: 1 }],
    });
    s = step(s, null);
    expect(s.hazards[0]?.slot).toBe(3); // 2 -> 3, not 4
  });

  it("the platform stays whole — Bruno paces his full beat however many holders are gone", () => {
    let s = quietPlaying({ bolts: [true, true, true, false], brunoSlot: 5, brunoDir: -1 });
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      s = step(s, null);
      seen.add(s.brunoSlot);
      expect(s.brunoSlot).toBeGreaterThanOrEqual(BRUNO_MIN_SLOT);
      expect(s.brunoSlot).toBeLessThanOrEqual(BRUNO_MAX_SLOT);
    }
    expect(seen.has(BRUNO_MIN_SLOT)).toBe(true); // still reaches his west end
  });
});
