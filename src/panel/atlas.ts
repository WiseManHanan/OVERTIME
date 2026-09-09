/*
 * The segment atlas (doc §4.2) — the catalogue of every physically distinct
 * segment on the glass. Nothing here moves; movement is a different subset of
 * these lighting up, and every unlit one is still ghosted every frame.
 *
 * Phase 2 generates Pip's full pose vocabulary parametrically: stand / walk /
 * duck / jump at every standable slot on all four floors, plus climb at the
 * ladder slots. So the ghost of every pose Pip could be in — including the one
 * he is about to take — is always on the glass.
 */
import type { Screen, Seg, Shape } from "./types";
import { PANEL_W, slotCenterX, floorBaselineY } from "./dims";
import {
  BOLT_SLOTS,
  FLOORS,
  MAX_SLOT,
  boltIndexAt,
  climbSlots,
  floorLocal,
  floorScreen,
  isStandable,
} from "../sim/world";
import { BRUNO_SLOT, type PipPose } from "../sim/state";

const rect = (x: number, y: number, w: number, h: number): Shape => ({ k: "rect", x, y, w, h });
const poly = (pts: [number, number][]): Shape => ({ k: "poly", pts });

/*
 * Pip is drawn from a small vocabulary of chunky quads with a hair of green
 * glass left between them, so the seams read the way real segment art does
 * (doc §4.2). Feet rest at (cx, baseY); the standing pose is ~24 tall, ~13 wide.
 * The silhouette is symmetric — `facing` steers the jump, not the artwork.
 */

const hardHat = (cx: number, y: number): Shape =>
  poly([
    [cx - 3, y],
    [cx + 3, y],
    [cx + 4, y + 3],
    [cx + 4.6, y + 4],
    [cx - 4.6, y + 4],
    [cx - 4, y + 3],
  ]);

const head = (cx: number, y: number): Shape => rect(cx - 2.4, y, 4.8, 4);

function standShapes(cx: number, b: number): Shape[] {
  return [
    hardHat(cx, b - 24),
    head(cx, b - 19),
    poly([[cx - 3.8, b - 14.5], [cx + 3.8, b - 14.5], [cx + 3.2, b - 7.8], [cx - 3.2, b - 7.8]]),
    poly([[cx - 6, b - 14], [cx - 4.6, b - 14], [cx - 4, b - 7], [cx - 5.4, b - 7]]),
    poly([[cx + 4.6, b - 14], [cx + 6, b - 14], [cx + 5.4, b - 7], [cx + 4, b - 7]]),
    rect(cx - 3.3, b - 6.8, 2.4, 4.8),
    rect(cx + 0.9, b - 6.8, 2.4, 4.8),
    poly([[cx - 4.4, b - 2], [cx - 0.6, b - 2], [cx - 0.6, b], [cx - 5.2, b]]),
    poly([[cx + 0.6, b - 2], [cx + 4.4, b - 2], [cx + 5.2, b], [cx + 0.6, b]]),
  ];
}

/** Mid-stride: one leg forward, one trailing and lifted; arms counter-swung. */
function walkShapes(cx: number, b: number): Shape[] {
  return [
    hardHat(cx, b - 24),
    head(cx, b - 19),
    poly([[cx - 3.8, b - 14.5], [cx + 3.8, b - 14.5], [cx + 3.2, b - 7.8], [cx - 3.2, b - 7.8]]),
    poly([[cx - 6.4, b - 13.5], [cx - 5, b - 14], [cx - 3.6, b - 8], [cx - 5, b - 7.5]]), // trailing arm, swung back
    poly([[cx + 4, b - 14], [cx + 5.6, b - 13], [cx + 5.4, b - 6], [cx + 4, b - 7]]), // lead arm, swung forward
    poly([[cx + 0.4, b - 6.8], [cx + 2.8, b - 6.8], [cx + 2.4, b - 2], [cx + 0, b - 2]]), // lead leg forward
    poly([[cx - 3.4, b - 6.8], [cx - 1.2, b - 6.8], [cx - 2, b - 3], [cx - 4, b - 3]]), // trailing leg lifted
    poly([[cx + 0, b - 2], [cx + 3.6, b - 2], [cx + 3.6, b], [cx - 0.4, b]]), // lead boot, planted
    poly([[cx - 4.6, b - 3.6], [cx - 1.4, b - 3.6], [cx - 1.4, b - 1.8], [cx - 5, b - 1.8]]), // trailing boot, off the deck
  ];
}

/** Compressed crouch, ~15 tall: immune to high hazards, cannot move (doc §5.2). */
function duckShapes(cx: number, b: number): Shape[] {
  return [
    hardHat(cx, b - 15),
    head(cx, b - 11),
    poly([[cx - 4.4, b - 8.5], [cx + 4.4, b - 8.5], [cx + 3.8, b - 4.5], [cx - 3.8, b - 4.5]]), // hunched torso
    poly([[cx - 6, b - 8], [cx - 4.4, b - 8.5], [cx - 4, b - 5], [cx - 5.6, b - 4.5]]), // tucked arms
    poly([[cx + 4.4, b - 8.5], [cx + 6, b - 8], [cx + 5.6, b - 4.5], [cx + 4, b - 5]]),
    poly([[cx - 4, b - 4.5], [cx - 1, b - 4.5], [cx - 1.4, b], [cx - 4.8, b]]), // splayed bent legs
    poly([[cx + 1, b - 4.5], [cx + 4, b - 4.5], [cx + 4.8, b], [cx + 1.4, b]]),
    poly([[cx - 5.6, b - 1.8], [cx - 1, b - 1.8], [cx - 1, b], [cx - 6, b]]), // wide boots
    poly([[cx + 1, b - 1.8], [cx + 5.6, b - 1.8], [cx + 6, b], [cx + 1, b]]),
  ];
}

/** Tuck: whole body lifted ~3 off the deck, knees up, arms raised. */
function jumpShapes(cx: number, base: number): Shape[] {
  const b = base - 3;
  return [
    hardHat(cx, b - 24),
    head(cx, b - 19),
    poly([[cx - 3.8, b - 14.5], [cx + 3.8, b - 14.5], [cx + 3.2, b - 7.8], [cx - 3.2, b - 7.8]]),
    poly([[cx - 5.6, b - 14], [cx - 4.4, b - 14], [cx - 3.2, b - 19.5], [cx - 4.6, b - 19.5]]), // arms up-and-out
    poly([[cx + 4.4, b - 14], [cx + 5.6, b - 14], [cx + 4.6, b - 19.5], [cx + 3.2, b - 19.5]]),
    poly([[cx - 3.2, b - 7.4], [cx - 1, b - 7.4], [cx - 0.4, b - 3], [cx - 2.6, b - 3]]), // knees up
    poly([[cx + 1, b - 7.4], [cx + 3.2, b - 7.4], [cx + 2.6, b - 3], [cx + 0.4, b - 3]]),
    poly([[cx - 3.6, b - 3], [cx - 0.4, b - 3], [cx - 0.4, b - 1.4], [cx - 4, b - 1.4]]), // tucked boots, clear of the deck
    poly([[cx + 0.4, b - 3], [cx + 3.6, b - 3], [cx + 4, b - 1.4], [cx + 0.4, b - 1.4]]),
  ];
}

/** On the ladder: narrow, both arms reaching above the hat, legs on the rungs. */
function climbShapes(cx: number, b: number): Shape[] {
  return [
    hardHat(cx, b - 24),
    head(cx, b - 19),
    poly([[cx - 3, b - 15], [cx + 3, b - 15], [cx + 2.6, b - 6], [cx - 2.6, b - 6]]), // narrower torso
    poly([[cx - 3.4, b - 15], [cx - 2.2, b - 15], [cx - 1.8, b - 23], [cx - 3, b - 23]]), // left arm up a rung
    poly([[cx + 2.2, b - 15], [cx + 3.4, b - 15], [cx + 3, b - 23], [cx + 1.8, b - 23]]), // right arm up a rung
    poly([[cx - 3.2, b - 6], [cx - 1, b - 6], [cx - 1.4, b - 11], [cx - 3.6, b - 11]]), // near leg, knee up
    rect(cx + 0.9, b - 6, 2.2, 6), // far leg, planted on a lower rung
    poly([[cx - 4, b - 6], [cx - 0.8, b - 6], [cx - 0.8, b - 4.4], [cx - 4.2, b - 4.4]]), // near boot
    poly([[cx + 0.6, b - 2], [cx + 3.8, b - 2], [cx + 3.8, b], [cx + 0.6, b]]), // far boot
  ];
}

/** Crouched over the bolt, both arms down on the wrench — the release lock. */
function releaseShapes(cx: number, b: number): Shape[] {
  return [
    hardHat(cx, b - 20),
    head(cx, b - 15),
    poly([[cx - 3.6, b - 11], [cx + 3.6, b - 11], [cx + 3, b - 5.5], [cx - 3, b - 5.5]]), // stooped torso
    poly([[cx - 5.4, b - 10.5], [cx - 3.8, b - 11], [cx - 1.6, b - 6.5], [cx - 3.2, b - 5.8]]), // both arms
    poly([[cx + 1.6, b - 6.5], [cx + 3.8, b - 11], [cx + 5.4, b - 10.5], [cx + 3.2, b - 5.8]]), // reaching down
    rect(cx - 3.1, b - 5.2, 2.3, 3.4),
    rect(cx + 0.8, b - 5.2, 2.3, 3.4),
    poly([[cx - 4.2, b - 2], [cx - 0.6, b - 2], [cx - 0.6, b], [cx - 5, b]]),
    poly([[cx + 0.6, b - 2], [cx + 4.2, b - 2], [cx + 5, b], [cx + 0.6, b]]),
  ];
}

const POSE_SHAPES: Record<PipPose, (cx: number, b: number) => Shape[]> = {
  stand: standShapes,
  walk: walkShapes,
  duck: duckShapes,
  jump: jumpShapes,
  climb: climbShapes,
  release: releaseShapes,
};

/** A rolling barrel: a low hazard, resting on the floor line (doc §5.4). */
function barrelShapes(cx: number, b: number): Shape[] {
  return [
    { k: "circle", cx, cy: b - 2.7, r: 2.7 },
    rect(cx - 2.3, b - 3.6, 4.6, 0.9),
    rect(cx - 2.3, b - 1.9, 4.6, 0.9),
  ];
}

/** Bruno the foreman, on his platform above floor 4. Idle = arms folded; swipe =
 *  the arm thrown down in a low arc across bolt stations 5–7 — the slots the hit
 *  test covers (doc §5.5). */
function brunoShapes(swiping: boolean): Shape[] {
  const cx = slotCenterX(BRUNO_SLOT);
  const b = floorBaselineY("upper", 0) - 6; // his boots, above the floor-4 plate
  const sweepY = floorBaselineY("upper", 0) - 3; // bolt-station height
  const arms: Shape = swiping
    ? poly([
        [cx - 2, b - 16],
        [cx + 2, b - 16],
        [slotCenterX(7) + 1, sweepY - 2],
        [slotCenterX(7) + 2, sweepY + 1],
        [slotCenterX(5) - 2, sweepY + 1],
        [slotCenterX(5) - 2, sweepY - 2],
      ])
    : rect(cx - 6.5, b - 13, 13, 2.6); // folded across the chest
  return [
    poly([[cx - 5, b - 22], [cx + 5, b - 22], [cx + 6.5, b - 18], [cx - 6.5, b - 18]]), // wide hard hat
    rect(cx - 3.4, b - 17.5, 6.8, 5), // head
    poly([[cx - 6, b - 12], [cx + 6, b - 12], [cx + 5, b - 3], [cx - 5, b - 3]]), // barrel chest
    arms,
    rect(cx - 4.4, b - 3, 3.6, 3),
    rect(cx + 0.8, b - 3, 3.6, 3),
  ];
}

/** The three miss pips across the top of the upper panel. */
function missPipSeg(i: number): Seg {
  const x = PANEL_W / 2 - 8 + i * 6;
  return { id: `miss.p${i}`, screen: "upper", shapes: [{ k: "rect", x, y: 2, w: 4, h: 4 }] };
}

/** The boredom meter (doc §6.2): ten pips along the top-left of the lower panel,
 *  a lit prefix showing how bored the Steward is. */
function boredomPipSeg(i: number): Seg {
  return { id: `boredom.p${i}`, screen: "lower", shapes: [rect(6 + i * 3.2, 3, 2, 3)] };
}

/** The Steward, in the lower panel's left margin, outside the play grid (doc
 *  §5.1). His whole job is to react to the boredom meter: `bell` rings it
 *  approvingly, `watch` checks the time, `asleep` is out cold (doc §6.2). */
function stewardShapes(mood: "idle" | "bell" | "watch" | "asleep"): Shape[] {
  const cx = 7;
  const b = floorBaselineY("lower", 1); // floor-1 baseline
  if (mood === "asleep") {
    return [
      rect(cx - 1, b - 12, 4, 3.2), // head, tipped forward
      poly([[cx - 3, b - 9], [cx + 3.4, b - 9.6], [cx + 3, b - 2], [cx - 2.6, b - 2]]), // slumped coat
      rect(cx - 2.4, b - 2, 5, 2), // sat down
      poly([[cx + 3, b - 15], [cx + 5, b - 15.6], [cx + 5, b - 14], [cx + 3, b - 13.4]]), // a "Z" tick above
    ];
  }
  const base: Shape[] = [
    rect(cx - 2, b - 16, 4, 3.5), // head
    poly([[cx - 3, b - 12], [cx + 3, b - 12], [cx + 2.4, b - 3], [cx - 2.4, b - 3]]), // long coat
    rect(cx - 2.4, b - 3, 2, 3), // legs
    rect(cx + 0.4, b - 3, 2, 3),
  ];
  if (mood === "bell") {
    base.push(
      poly([[cx + 2.4, b - 11], [cx + 4, b - 12], [cx + 5.6, b - 15], [cx + 4.4, b - 16]]), // raised arm
      { k: "circle", cx: cx + 6, cy: b - 16.4, r: 1.9 }, // the bell
    );
  } else if (mood === "watch") {
    base.push(
      poly([[cx + 2.4, b - 11], [cx + 3.4, b - 8.6], [cx + 1.4, b - 7], [cx + 0.6, b - 9]]), // arm bent to the wrist
    );
  } else {
    base.push(rect(cx + 2, b - 11, 1.6, 7)); // arm at his side
  }
  return base;
}

export function pipShapes(pose: PipPose, cx: number, baseY: number): Shape[] {
  return POSE_SHAPES[pose](cx, baseY);
}

/** A bolt station on floor 4: a rivet ring with a cross-slot (doc §5.5). */
export function boltStation(slot: number): Seg {
  const cx = slotCenterX(slot);
  const cy = floorBaselineY("upper", 0) - 7;
  return {
    id: `bolt.s${slot}`,
    screen: "upper",
    shapes: [
      { k: "arc", cx, cy, r: 3.6, a0: 0, a1: Math.PI * 2, w: 2.2 },
      rect(cx - 1.7, cy - 0.9, 3.4, 1.8),
    ],
  };
}

/** Poses generated at every standable slot. Climb is added at ladder slots,
 *  release at the floor-4 bolt stations. */
const GRID_POSES: readonly PipPose[] = ["stand", "walk", "duck", "jump"];

function build(): Seg[] {
  const segs: Seg[] = [];

  for (const floor of FLOORS) {
    const screen: Screen = floorScreen(floor);
    const baseY = floorBaselineY(screen, floorLocal(floor));
    const climbHere = new Set(climbSlots(floor));

    for (let s = 0; s <= MAX_SLOT; s++) {
      if (!isStandable(floor, s)) continue;
      const cx = slotCenterX(s);

      const poses: PipPose[] = [...GRID_POSES];
      if (climbHere.has(s)) poses.push("climb");
      if (floor === 4 && boltIndexAt(s) >= 0) poses.push("release");
      for (const pose of poses) {
        segs.push({ id: `pip.f${floor}.s${s}.${pose}`, screen, shapes: pipShapes(pose, cx, baseY) });
      }

      // A barrel can roll through any standable slot on any floor.
      segs.push({ id: `barrel.f${floor}.s${s}`, screen, shapes: barrelShapes(cx, baseY) });
    }
  }

  for (const slot of BOLT_SLOTS) segs.push(boltStation(slot));
  segs.push({ id: "bruno.idle", screen: "upper", shapes: brunoShapes(false) });
  segs.push({ id: "bruno.swipe", screen: "upper", shapes: brunoShapes(true) });
  for (let i = 0; i < 3; i++) segs.push(missPipSeg(i));

  for (let i = 0; i < 10; i++) segs.push(boredomPipSeg(i));
  for (const mood of ["idle", "bell", "watch", "asleep"] as const) {
    segs.push({ id: `steward.${mood}`, screen: "lower", shapes: stewardShapes(mood) });
  }
  return segs;
}

const ATLAS: readonly Seg[] = build();

const BY_SCREEN: Record<Screen, readonly Seg[]> = {
  upper: ATLAS.filter((s) => s.screen === "upper"),
  lower: ATLAS.filter((s) => s.screen === "lower"),
};

export function atlasFor(screen: Screen): readonly Seg[] {
  return BY_SCREEN[screen];
}
