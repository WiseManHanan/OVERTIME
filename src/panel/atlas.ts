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
import { slotCenterX, floorBaselineY } from "./dims";
import {
  FLOORS,
  MAX_SLOT,
  climbSlots,
  floorLocal,
  floorScreen,
  isStandable,
} from "../sim/world";
import type { PipPose } from "../sim/state";

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

const POSE_SHAPES: Record<PipPose, (cx: number, b: number) => Shape[]> = {
  stand: standShapes,
  walk: walkShapes,
  duck: duckShapes,
  jump: jumpShapes,
  climb: climbShapes,
};

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

/** Poses generated at every standable slot. Climb is added only at ladder slots. */
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
      const poses = climbHere.has(s) ? [...GRID_POSES, "climb" as const] : GRID_POSES;
      for (const pose of poses) {
        segs.push({ id: `pip.f${floor}.s${s}.${pose}`, screen, shapes: pipShapes(pose, cx, baseY) });
      }
    }
  }

  for (const s of [1, 3, 5, 7]) segs.push(boltStation(s));
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
