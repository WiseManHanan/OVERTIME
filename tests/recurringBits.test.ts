import { describe, it, expect } from "vitest";
import { MARA_RATING_TICKS, rollMaraRating } from "../src/sim/mara";
import { seedRng } from "../src/sim/rng";
import { initialState, type GameState } from "../src/sim/state";
import { step } from "../src/sim/step";
import type { Hazard } from "../src/sim/hazards";

describe("Mara's ratings (doc §7.4)", () => {
  it("rollMaraRating is deterministic and always 1-10", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const [a] = rollMaraRating(seedRng(seed));
      const [b] = rollMaraRating(seedRng(seed));
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(10);
    }
  });

  it("is harsh but fair — low-mid ratings far outnumber a 10", () => {
    const counts = new Array(11).fill(0); // index by rating, 0 unused
    let rng = seedRng(1);
    for (let i = 0; i < 5000; i++) {
      const [rating, next] = rollMaraRating(rng);
      rng = next;
      counts[rating] += 1;
    }
    expect(counts[10]).toBeGreaterThan(0); // "possible"
    expect(counts[10]).toBeLessThan(counts[5]); // "rare" next to the common band
    expect(counts[1] + counts[10]).toBeLessThan(counts[4] + counts[5] + counts[6]);
  });
});

const mkBarrel = (floor: 1 | 2 | 3 | 4, slot: number, dir: -1 | 1): Hazard => ({
  kind: "barrel",
  floor,
  slot,
  dir,
});

const quietPlaying = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(1),
  phase: "playing",
  spawnCountdown: 1e9,
  swipeCountdown: 1e9,
  ...over,
});

describe("Mara's ratings reach the sim (doc §7.4)", () => {
  it("a miss rolls a fresh rating and shows it for MARA_RATING_TICKS", () => {
    let s = quietPlaying({
      hazards: [mkBarrel(1, 2, 1)],
      pip: { ...initialState(1).pip, floor: 1, slot: 3 },
    });
    expect(s.maraRating).toBeNull();
    s = step(s, null); // barrel 2 -> 3, onto Pip
    expect(s.misses).toBe(1);
    expect(s.maraRating).not.toBeNull();
    expect(s.maraRating).toBeGreaterThanOrEqual(1);
    expect(s.maraRating).toBeLessThanOrEqual(10);
    expect(s.maraRatingTicks).toBe(MARA_RATING_TICKS);
  });

  it("the rating fades a tick at a time, including through the post-hit freeze", () => {
    let s = quietPlaying({
      hazards: [mkBarrel(1, 2, 1)],
      pip: { ...initialState(1).pip, floor: 1, slot: 3 },
    });
    s = step(s, null); // the hit
    expect(s.maraRatingTicks).toBe(MARA_RATING_TICKS);
    s = step(s, null); // one frozen tick
    expect(s.maraRatingTicks).toBe(MARA_RATING_TICKS - 1);
  });

  it("a second miss replaces the fading rating with a fresh one", () => {
    let s = quietPlaying({
      hazards: [mkBarrel(1, 2, 1)],
      pip: { ...initialState(1).pip, floor: 1, slot: 3 },
    });
    s = step(s, null); // first hit
    while (s.hitFlash > 0) s = step(s, null); // let it fully recover
    expect(s.maraRatingTicks).toBeLessThan(MARA_RATING_TICKS);
    s = { ...s, hazards: [mkBarrel(1, 2, 1)], pip: { ...s.pip, floor: 1, slot: 3 } };
    s = step(s, null); // second hit
    expect(s.maraRatingTicks).toBe(MARA_RATING_TICKS); // reset, not accumulated
  });
});

describe("segment awareness (doc §7.4)", () => {
  it("never rolls while a glitch or its cooldown is still active", () => {
    let s: GameState = { ...initialState(1), phase: "playing", glitchCooldown: 5, glitchTicks: 0 };
    for (let seed = 1; seed <= 50; seed++) {
      const withSeed = { ...s, rng: seedRng(seed) };
      const next = step(withSeed, null);
      expect(next.glitchTicks).toBe(0); // cooldown blocks any new roll
      expect(next.glitchCooldown).toBe(4);
    }
  });

  it("an active glitch counts down 2 -> 1 -> 0 and starts the cooldown", () => {
    let s: GameState = {
      ...initialState(1),
      phase: "playing",
      glitchTicks: 2,
      glitchCooldown: 200,
      glitchPose: "duck",
    };
    s = step(s, null);
    expect(s.glitchTicks).toBe(1);
    expect(s.glitchCooldown).toBe(199);
    s = step(s, null);
    expect(s.glitchTicks).toBe(0);
    expect(s.glitchCooldown).toBe(198);
  });

  it("the roll can fire, and never picks Pip's actual current pose", () => {
    let fired = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const s: GameState = { ...initialState(seed), phase: "playing", pip: { ...initialState(seed).pip, pose: "stand" } };
      const next = step(s, null);
      if (next.glitchTicks > 0) {
        fired += 1;
        expect(next.glitchPose).not.toBe("stand");
        expect(next.glitchCooldown).toBe(200);
      }
    }
    // ~1/400 in expectation over 3000 tries (~7.5) — a wide, non-flaky band.
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(60);
  });
});
