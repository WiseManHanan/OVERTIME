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
import { PANEL_W, SLOT_W, slotCenterX, floorBaselineY } from "./dims";
import {
  BOLT_SLOTS,
  FLOORS,
  MAX_SLOT,
  climbSlots,
  floorLocal,
  floorScreen,
  isStandable,
} from "../sim/world";
import {
  BRUNO_MAX_SLOT,
  BRUNO_MIN_SLOT,
  BRUNO_SLOT,
  CONSOLE_SLOT,
  SWIPE_REACH,
  type PipPose,
} from "../sim/state";

const rect = (x: number, y: number, w: number, h: number): Shape => ({ k: "rect", x, y, w, h });
const poly = (pts: [number, number][]): Shape => ({ k: "poly", pts });

/*
 * Pip: an original blocky site worker in right-facing profile — a hard hat with
 * a forward brim, a nose, an eye notch cut into the jaw. Chunky quads with a
 * hair of green glass between them (doc §4.2). Feet rest at (cx, b); standing is
 * ~24 tall, ~13 wide. The left-facing artwork is this set mirrored about `cx`
 * (see `mirror`), so `facing` now steers the whole silhouette, not just the
 * jump. `walk` has two stride frames, alternating by slot parity, so discrete
 * steps still read as a walk cycle.
 */

/** Reflect a shape set left↔right about x = cx (the left-facing variant). */
function mirror(shapes: Shape[], cx: number): Shape[] {
  const fx = (x: number): number => 2 * cx - x;
  return shapes.map((s): Shape => {
    switch (s.k) {
      case "rect":
        return { k: "rect", x: fx(s.x + s.w), y: s.y, w: s.w, h: s.h };
      case "poly":
        return { k: "poly", pts: s.pts.map(([x, y]) => [fx(x), y] as [number, number]) };
      case "circle":
        return { k: "circle", cx: fx(s.cx), cy: s.cy, r: s.r };
      case "arc":
        return {
          k: "arc",
          cx: fx(s.cx),
          cy: s.cy,
          r: s.r,
          a0: Math.PI - s.a1,
          a1: Math.PI - s.a0,
          w: s.w,
        };
    }
  });
}

/** Hard hat + profile face, right-facing, hat crown near y. ~9 tall. */
function pipHead(cx: number, y: number): Shape[] {
  return [
    // hard hat: low dome, brim jutting forward over the brow
    poly([
      [cx - 3.4, y + 3.7],
      [cx - 2.5, y + 0.9],
      [cx - 0.3, y - 0.6],
      [cx + 2, y - 0.2],
      [cx + 3.1, y + 1.7],
      [cx + 4.9, y + 3.5],
      [cx + 3.6, y + 4.2],
      [cx - 3.2, y + 4.3],
    ]),
    // profile face: forehead, brow, eye notch, nose, chin, jaw
    poly([
      [cx - 2.4, y + 5],
      [cx + 1.5, y + 4.9],
      [cx + 2.3, y + 5.9],
      [cx + 1.6, y + 6.5],
      [cx + 3.3, y + 7.1],
      [cx + 1.8, y + 7.8],
      [cx + 2.4, y + 8.7],
      [cx - 2.2, y + 8.8],
      [cx - 2.9, y + 6.3],
    ]),
  ];
}

/** Compact tucked head for the crouch, ~6 tall. */
function pipDuckHead(cx: number, y: number): Shape[] {
  return [
    poly([
      [cx - 2.8, y + 2.6],
      [cx - 2, y + 0.6],
      [cx + 1.6, y - 0.2],
      [cx + 3.6, y + 2],
      [cx + 2.8, y + 2.7],
      [cx - 2.6, y + 2.8],
    ]),
    poly([
      [cx - 2, y + 3.2],
      [cx + 1.4, y + 3.1],
      [cx + 2.8, y + 4.2],
      [cx + 1.4, y + 5],
      [cx + 1.8, y + 5.8],
      [cx - 1.8, y + 5.9],
      [cx - 2.2, y + 4],
    ]),
  ];
}

/** Back (far-side) arm — shorter, reads as behind the torso. */
const backArm = (cx: number, b: number, dx: number, y0: number, y1: number): Shape =>
  poly([
    [cx - 5.2 + dx, b - y0],
    [cx - 4 + dx, b - y0],
    [cx - 3.6 + dx, b - y1],
    [cx - 4.8 + dx, b - y1],
  ]);

function standShapes(cx: number, b: number): Shape[] {
  return [
    ...pipHead(cx, b - 24),
    poly([[cx - 3.6, b - 14.5], [cx + 3.8, b - 14.5], [cx + 3.3, b - 7.8], [cx - 3, b - 7.8]]), // torso
    backArm(cx, b, 0.4, 14, 8.5),
    poly([[cx + 3.6, b - 14.2], [cx + 5, b - 14.2], [cx + 4.6, b - 6.6], [cx + 3.3, b - 6.6]]), // front arm, hanging
    rect(cx - 3.1, b - 6.8, 2.3, 4.8), // back leg
    rect(cx + 1, b - 6.8, 2.3, 4.8), // front leg
    poly([[cx - 4.2, b - 2], [cx - 0.7, b - 2], [cx - 0.7, b], [cx - 4.8, b]]), // back boot
    poly([[cx + 0.7, b - 2], [cx + 4.6, b - 2], [cx + 5.4, b], [cx + 0.7, b]]), // front boot, toe forward
  ];
}

/** Mid-stride. `s` picks the frame: 0 = lead leg forward and planted, front arm
 *  swung back; 1 = lead leg gathered, trailing leg pushing off, arm forward. */
function walkShapes(cx: number, b: number, s = 0): Shape[] {
  const hd = pipHead(cx, b - 24);
  const torso = poly([[cx - 3.6, b - 14.5], [cx + 3.8, b - 14.5], [cx + 3.3, b - 7.8], [cx - 3, b - 7.8]]);
  if (s === 0) {
    return [
      ...hd,
      torso,
      poly([[cx + 3.4, b - 14], [cx + 4.8, b - 13.4], [cx + 4, b - 7], [cx + 2.8, b - 7.6]]), // front arm swung back
      backArm(cx, b, 1.4, 13.6, 8),
      poly([[cx + 0.6, b - 6.8], [cx + 3, b - 6.8], [cx + 2.6, b - 2], [cx + 0.2, b - 2]]), // lead leg forward
      poly([[cx - 3.4, b - 6.8], [cx - 1.2, b - 6.8], [cx - 2, b - 3.2], [cx - 4, b - 3.2]]), // trailing leg lifted
      poly([[cx + 0.2, b - 2], [cx + 4, b - 2], [cx + 4.4, b], [cx + 0, b]]), // lead boot planted
      poly([[cx - 4.6, b - 3.8], [cx - 1.4, b - 3.8], [cx - 1.4, b - 2], [cx - 5, b - 2]]), // trailing boot, off the deck
    ];
  }
  return [
    ...hd,
    torso,
    poly([[cx + 3.4, b - 14], [cx + 5, b - 14.4], [cx + 5, b - 8], [cx + 3.6, b - 7.6]]), // front arm swung forward
    backArm(cx, b, -0.6, 14, 8.6),
    rect(cx - 1.4, b - 6.8, 2.4, 4.8), // lead leg gathered under the hip
    poly([[cx + 1.6, b - 6.6], [cx + 3.8, b - 6.6], [cx + 5, b - 2.6], [cx + 3, b - 2.6]]), // trailing leg pushing off
    poly([[cx - 2, b - 2], [cx + 1.4, b - 2], [cx + 1.4, b], [cx - 2, b]]), // planted boot
    poly([[cx + 3, b - 2.6], [cx + 5.6, b - 2.6], [cx + 6, b - 0.8], [cx + 3.2, b - 0.8]]), // push-off boot, toe down
  ];
}

/** Compressed crouch, ~12 tall: immune to high hazards, cannot move (doc §5.2).
 *  Head pulled down between the shoulders, wide low stance, arm wrapped front. */
function duckShapes(cx: number, b: number): Shape[] {
  return [
    ...pipDuckHead(cx + 1.4, b - 11.5),
    poly([[cx - 4.2, b - 7.5], [cx + 4.6, b - 7.5], [cx + 4, b - 4], [cx - 3.6, b - 4]]), // hunched wide torso
    poly([[cx + 2.8, b - 7], [cx + 4.8, b - 7], [cx + 4.2, b - 4], [cx + 2.2, b - 4]]), // arm wrapped to the front
    poly([[cx - 4.2, b - 4], [cx - 0.8, b - 4], [cx - 1.4, b], [cx - 5, b]]), // wide bent legs
    poly([[cx + 0.8, b - 4], [cx + 4.2, b - 4], [cx + 5, b], [cx + 1.4, b]]),
    poly([[cx - 5.6, b - 1.6], [cx - 0.8, b - 1.6], [cx - 0.8, b], [cx - 6, b]]), // wide boots
    poly([[cx + 0.8, b - 1.6], [cx + 5.6, b - 1.6], [cx + 6, b], [cx + 0.8, b]]),
  ];
}

/** Tuck: body lifted ~3 off the deck, compact, both arms thrown up past the
 *  hat, knees driven forward — the shape reads even overlapping a hazard. */
function jumpShapes(cx: number, base: number): Shape[] {
  const b = base - 3;
  return [
    ...pipHead(cx + 0.6, b - 22),
    poly([[cx - 3.2, b - 13.5], [cx + 3.8, b - 13.5], [cx + 3.2, b - 7.5], [cx - 2.6, b - 7.5]]), // compact torso
    poly([[cx - 4.4, b - 13], [cx - 3.2, b - 13.4], [cx - 1.8, b - 24], [cx - 3, b - 24.4]]), // back arm up past the hat
    poly([[cx + 3, b - 13], [cx + 4.2, b - 12.6], [cx + 5.8, b - 23], [cx + 4.6, b - 23.6]]), // front arm up-and-forward
    poly([[cx - 2.4, b - 7], [cx - 0.2, b - 7], [cx + 1, b - 2.6], [cx - 1.2, b - 2.6]]), // knees driven forward
    poly([[cx + 1.6, b - 7], [cx + 3.8, b - 7], [cx + 3.2, b - 2.6], [cx + 1, b - 2.6]]),
    poly([[cx - 2.2, b - 2.6], [cx + 1, b - 2.6], [cx + 1.2, b - 1], [cx - 2.6, b - 1]]), // tucked boots, clear of the deck
    poly([[cx + 1, b - 2.6], [cx + 4, b - 2.6], [cx + 4.4, b - 1], [cx + 1, b - 1]]),
  ];
}

/** On the ladder, near profile: the lead arm high on a rung, the other mid,
 *  legs staggered. Mirrors cleanly for the other facing. */
function climbShapes(cx: number, b: number): Shape[] {
  return [
    ...pipHead(cx, b - 24),
    poly([[cx - 2.8, b - 15], [cx + 3, b - 15], [cx + 2.6, b - 6], [cx - 2.4, b - 6]]), // narrow torso
    poly([[cx - 3, b - 15], [cx - 1.8, b - 15], [cx - 1.4, b - 21], [cx - 2.6, b - 21]]), // trailing arm, mid-rung
    poly([[cx + 1.8, b - 15], [cx + 3, b - 15], [cx + 3.4, b - 24], [cx + 2.2, b - 24]]), // lead arm, high on a rung
    poly([[cx - 3, b - 6], [cx - 0.8, b - 6], [cx - 1.2, b - 11.5], [cx - 3.4, b - 11.5]]), // trailing leg, knee up
    rect(cx + 1, b - 6, 2.2, 6), // lead leg, planted low
    poly([[cx - 3.8, b - 6], [cx - 0.6, b - 6], [cx - 0.6, b - 4.4], [cx - 4, b - 4.4]]),
    poly([[cx + 0.8, b - 2], [cx + 4, b - 2], [cx + 4, b], [cx + 0.8, b]]),
  ];
}

/** Bent over the bolt at his feet, both hands down on the wrench — the release
 *  lock. The pose the round clear hinges on, so it reads big. */
function releaseShapes(cx: number, b: number): Shape[] {
  return [
    ...pipHead(cx + 1.5, b - 20),
    poly([[cx - 3.4, b - 11], [cx + 3.8, b - 11], [cx + 4.4, b - 5.5], [cx - 2.6, b - 5.5]]), // stooped torso, back arched
    poly([[cx + 3.4, b - 10.5], [cx + 4.8, b - 10], [cx + 3, b - 4], [cx + 1.6, b - 4.6]]), // arms reaching down and forward
    poly([[cx + 1.4, b - 5], [cx + 3, b - 4.4], [cx + 2.4, b - 1.6], [cx + 0.8, b - 2.2]]), // hands on the wrench at the bolt
    rect(cx - 3, b - 5.2, 2.3, 3.4), // legs braced
    rect(cx + 0.4, b - 5.2, 2.3, 3.4),
    poly([[cx - 4, b - 2], [cx - 0.5, b - 2], [cx - 0.5, b], [cx - 4.6, b]]),
    poly([[cx + 0.4, b - 2], [cx + 4, b - 2], [cx + 4.6, b], [cx + 0.4, b]]),
  ];
}

const POSE_SHAPES: Record<PipPose, (cx: number, b: number, s?: number) => Shape[]> = {
  stand: standShapes,
  walk: walkShapes,
  duck: duckShapes,
  jump: jumpShapes,
  climb: climbShapes,
  release: releaseShapes,
};

/** A rolling barrel: a low hazard on the floor line, ~5 tall. Bulging staves,
 *  two iron hoops, a visible end-cap; `roll` (0/1) shifts the hoops so a row of
 *  them reads as tumbling (doc §5.4). */
function barrelShapes(cx: number, b: number, roll = 0): Shape[] {
  const cy = b - 3.4;
  const hoopDx = roll === 0 ? -0.5 : 0.5;
  return [
    poly([ // barrel body, staved — wider at the belly
      [cx - 2.4, b - 6.4],
      [cx + 2.4, b - 6.4],
      [cx + 3.4, cy],
      [cx + 2.4, b - 0.4],
      [cx - 2.4, b - 0.4],
      [cx - 3.4, cy],
    ]),
    { k: "circle", cx: cx + 2.2, cy, r: 1.5 }, // near end-cap
    rect(cx - 3.5 + hoopDx, b - 5.4, 7, 0.9), // top hoop
    rect(cx - 3.7 + hoopDx, b - 1.9, 7.4, 0.9), // bottom hoop
    rect(cx - 3.2 - hoopDx, cy - 0.5, 6.4, 0.9), // belly hoop, counter-shifted
  ];
}

/** An office chair: a *high* hazard — cannot be jumped, only ducked (doc §5.4).
 *  Seat, backrest, gas post, a splayed base on casters. `roll` (0/1) leans the
 *  backrest so it reads as spinning end over end down the scaffold. */
function chairShapes(cx: number, b: number, roll = 0): Shape[] {
  const lean = roll === 0 ? -1.4 : 1.4;
  return [
    // backrest, tipped by the spin
    poly([
      [cx - 2 + lean, b - 12],
      [cx + 2 + lean, b - 12.6],
      [cx + 2.4 + lean * 1.4, b - 7],
      [cx - 1.6 + lean * 1.4, b - 6.6],
    ]),
    rect(cx - 3, b - 6.4, 6, 2), // seat
    rect(cx - 0.9, b - 4.6, 1.8, 2.4), // gas post
    poly([[cx - 4.2, b - 2.2], [cx + 4.2, b - 2.2], [cx + 3, b - 0.8], [cx - 3, b - 0.8]]), // base
    { k: "circle", cx: cx - 3.6, cy: b - 0.4, r: 1 }, // casters
    { k: "circle", cx: cx + 3.6, cy: b - 0.4, r: 1 },
    { k: "circle", cx, cy: b - 0.2, r: 1 },
  ];
}

/** Bruno's boots ride here — on a platform well above the floor-4 deck, so the
 *  worker on the deck reaches up for the holders (doc §5.5 / the DK reference). */
const PLATFORM_Y = floorBaselineY("upper", 0) - 16;

/*
 * Bruno the foreman, pacing his platform above floor 4 in profile — he watches
 * the work and the worker on it. Heavy brow, blunt nose, set jaw: written to
 * read as a man with a grievance, not a joke (CLAUDE.md notes). Drawn
 * left-facing; `mirror` makes the right. `pace` = arms folded, shuffling his
 * beat; `swipe` = the near arm thrown down off the platform (the hit-test range,
 * doc §5.5); `fall` = the payoff — the last holder is pulled and the platform
 * pivots off its west anchor, dumping him down and off the panel.
 */
function brunoBody(cx: number): { cx: number; b: number; base: Shape[] } {
  const b = PLATFORM_Y; // boots, on the platform
  return {
    cx,
    b,
    // Head/hat, chest and legs are separate blocks with a hair of glass between
    // them; the arms are added per pose so the fold reads.
    base: [
      // supervisor's hard hat: flat wide crown, deep brim jutting left
      poly([
        [cx + 5, b - 18.6],
        [cx + 4.4, b - 20.6],
        [cx + 1.6, b - 21.4],
        [cx - 3.6, b - 21],
        [cx - 5.4, b - 19.8],
        [cx - 7, b - 18.4],
        [cx - 7, b - 17.4],
        [cx - 5, b - 17],
        [cx + 4.8, b - 17.2],
      ]),
      // profile head: brow shelf, deep eye notch, blunt nose, heavy jowl
      poly([
        [cx + 3.4, b - 16.6],
        [cx - 3.2, b - 16.6],
        [cx - 5, b - 15.4],
        [cx - 3.2, b - 14.4],
        [cx - 5, b - 13.4],
        [cx - 3, b - 12.2],
        [cx - 3.8, b - 10.2],
        [cx + 3.2, b - 10.4],
      ]),
      // lower torso / belly — its own block, sitting below the arms with a gap
      poly([[cx - 5, b - 6.4], [cx + 5, b - 6.4], [cx + 4.6, b - 3.4], [cx - 4.6, b - 3.4]]),
      // planted wide stance, boots turned out
      poly([[cx - 5.4, b - 3.4], [cx - 1.6, b - 3.4], [cx - 1, b], [cx - 6, b]]),
      poly([[cx + 1.6, b - 3.4], [cx + 5.4, b - 3.4], [cx + 6, b], [cx + 1, b]]),
    ],
  };
}

/** Bruno pacing his beat, arms folded, with a slight bob keyed off `roll`. */
function brunoPaceShapes(cx: number, roll = 0): Shape[] {
  const { b, base } = brunoBody(cx);
  const bob = roll === 0 ? 0 : -0.6;
  return [
    ...base,
    // folded arms carry the upper-body mass, set off from the head above and the
    // belly below by a hair of glass, with a V-notch where the forearms cross
    poly([[cx - 5.4, b - 9.4 + bob], [cx - 0.7, b - 8.9 + bob], [cx - 0.5, b - 7 + bob], [cx - 5.2, b - 7.4 + bob]]),
    poly([[cx + 0.4, b - 9.7 + bob], [cx + 5.4, b - 9.2 + bob], [cx + 5.2, b - 7.2 + bob], [cx + 0.2, b - 7.5 + bob]]),
    rect(cx - 6.4, b - 9.4 + bob, 1.9, 3), // near fist
    rect(cx + 4.6, b - 9.6 + bob, 1.9, 3), // far fist
  ];
}

/** Bruno mid-swing: the near arm thrown down and across, reaching `SWIPE_REACH`
 *  slots to his left (the hit range, doc §5.5). */
function brunoSwipeShapes(cx: number): Shape[] {
  const { b, base } = brunoBody(cx);
  const sweepY = floorBaselineY("upper", 0) - 3;
  const elbowX = cx - 3;
  const elbowY = sweepY - 4;
  const reachX = cx - (SWIPE_REACH + 1.4) * SLOT_W;
  return [
    ...base,
    // upper torso squared off — the fold is gone, the arm is out
    poly([[cx - 4.6, b - 9.6], [cx + 5, b - 9.6], [cx + 4.6, b - 6.6], [cx - 4.4, b - 6.6]]),
    // upper arm: shoulder to elbow
    poly([
      [cx - 0.6, b - 9.2],
      [cx - 2.8, b - 9.6],
      [elbowX - 1.4, elbowY],
      [elbowX + 0.8, elbowY - 0.6],
    ]),
    // forearm: a bar swept down and across
    poly([
      [elbowX - 1.6, elbowY - 0.4],
      [elbowX + 0.6, elbowY - 1.2],
      [cx + 3.4, sweepY - 0.6],
      [cx + 3.8, sweepY + 1.4],
      [reachX, sweepY + 1.8],
      [reachX - 0.6, sweepY - 0.2],
    ]),
  ];
}

/** Anchor x of the platform (its west pivot, bolted to the side of the screen)
 *  and its free (east) end. */
const PLATFORM_WEST = 3;
const PLATFORM_EAST = slotCenterX(9) + 2;

/** A point (lx,ly) in a body-local frame rotated by `rot` and placed at (cx,cy). */
function rot(cx: number, cy: number, lx: number, ly: number, r: number): [number, number] {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [cx + lx * c - ly * s, cy + lx * s + ly * c];
}
/** A rectangle of half-extents (hw,hh) centred at (cx,cy), rotated by `r`. */
function rotRect(cx: number, cy: number, hw: number, hh: number, r: number): Shape {
  return poly([
    rot(cx, cy, -hw, -hh, r),
    rot(cx, cy, hw, -hh, r),
    rot(cx, cy, hw, hh, r),
    rot(cx, cy, -hw, hh, r),
  ]);
}

/** Bruno tumbling free of the wreck — a recognisable figure (hard hat, blocky
 *  limbs) rotated by `r`, arms and legs flung out by `spread` (0..1). Feet-down
 *  in its own frame, centred at (cx,cy). */
function brunoTumbleShapes(cx: number, cy: number, r: number, spread: number): Shape[] {
  const a = spread;
  const q = (
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number,
  ): Shape =>
    poly([rot(cx, cy, x0, y0, r), rot(cx, cy, x1, y1, r), rot(cx, cy, x2, y2, r), rot(cx, cy, x3, y3, r)]);
  return [
    q(-3.2, -9.6, 3.2, -9.6, 3.2, -5.4, -3.2, -5.4), // head
    q(-4.4, -12.6, 4.4, -13.2, 5, -9.6, -5, -9), // hard hat, brim flared
    q(-3.8, -5.4, 3.8, -5.4, 3.2, 3.4, -3.2, 3.4), // torso
    q(-3.6, -4.6, -7 - a * 4, -7.5 - a * 3.5, -8.6 - a * 4, -5.2 - a * 3.5, -5, -2.4), // near arm, windmilling
    q(3.6, -4.6, 7 + a * 4, -8.5 - a * 3, 8.6 + a * 4, -6.2 - a * 3, 5, -2.4), // far arm
    q(-3.2, 3.2, -5.6 - a * 3, 8.6 + a * 2.5, -3.4 - a * 3, 10 + a * 2.5, -1, 4), // near leg, kicking
    q(1.2, 4, 3.6 + a * 3, 9 + a * 2.5, 5.6 + a * 3, 10.6 + a * 2.5, 3.2, 3.2), // far leg
  ];
}

/** Four frames of the collapse (k = 0..3): the girder shears off its west
 *  anchor and tips (0), then breaks into pieces that spin away (1..3), while
 *  Bruno tumbles down his own arc, losing the hat on the way. */
function brunoFallShapes(k: number): Shape[] {
  const ax = PLATFORM_WEST;
  const ay = PLATFORM_Y;
  const len = PLATFORM_EAST - ax;
  const ang = [0.22, 0.6, 1.05, 1.55][k]!;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const th = 1.6;

  const shapes: Shape[] = [rect(0, ay - 6, 3.4, 15)]; // the wall plate, still bolted

  if (k === 0) {
    // still one piece — sheared off the anchor and tipping, with a first crack
    const ex = ax + len * c;
    const ey = ay + len * s;
    shapes.push(poly([[ax, ay], [ex, ey], [ex + s * th * 2, ey - c * th * 2], [ax + s * th * 2, ay - c * th * 2]]));
    const cd = (f: number, dy: number): [number, number] => [ax + len * f * c, ay + len * f * s + dy];
    shapes.push(poly([cd(0.34, 0), cd(0.42, 2.6), cd(0.3, 2.6)]));
  } else {
    // broken into four sections, each drifting and spinning further each frame
    const N = 4;
    for (let i = 0; i < N; i++) {
      const d = ((i + 0.5) / N) * len;
      const chaos = k * k;
      const hx = ax + d * c + chaos * (i - 1) * 1.6;
      const hy = ay + d * s + chaos * (i + 1) * 2.2;
      const spin = ang + k * 0.6 * (i % 2 ? 1 : -1) * ((i + 1) / N);
      const hw = Math.max(3, len / N / 2 - 2 - k);
      shapes.push(rotRect(hx, hy, hw, th, spin));
      shapes.push(poly([
        rot(hx, hy, -hw * 0.3, th, spin),
        rot(hx, hy, hw * 0.3, th, spin),
        rot(hx, hy, 0, th + 2.6, spin),
      ])); // a broken lattice tooth
    }
  }

  // Bruno on his own arc — starts at the platform's east end, falls and spins
  // ~270deg across the four frames, hat off from frame 1.
  const bx = PLATFORM_EAST - 16 + k * 4;
  const by = PLATFORM_Y + 4 + [0, 17, 40, 66][k]!;
  const brot = 0.25 + k * 1.4;
  const spread = Math.min(1, 0.3 + k * 0.28);
  shapes.push(...brunoTumbleShapes(bx, by, brot, spread));
  if (k >= 1) {
    shapes.push(rotRect(bx + 8 + k * 3, by - 10 - k * 2.5, 4.6, 1.7, brot * 1.4 + 1.2)); // the flung hat
  }
  return shapes;
}

/** Bruno's platform: one beam, west end fixed to the wall by an anchor bracket,
 *  east end held up by the four holders. It stays whole all round (doc §5.5). */
function brunoPlatformSeg(): Seg {
  const w = PLATFORM_WEST;
  const e = PLATFORM_EAST;
  const y = PLATFORM_Y;
  const step = (e - w - 8) / 6;
  return {
    id: "bruno.platform",
    screen: "upper",
    shapes: [
      rect(w, y - 0.5, e - w, 2.6), // the deck of the beam
      // lattice underside
      ...[0, 1, 2, 3, 4, 5].map(
        (i): Shape =>
          poly([
            [w + 4 + i * step, y + 2.1],
            [w + 8 + i * step, y + 2.1],
            [w + 6 + i * step, y + 4],
          ]),
      ),
      // west anchor: a plate bolted flat to the panel edge (x 0 by design), a
      // gusset bridging it to the beam at `w`, and a couple of rivets
      rect(0, y - 6, 3.4, 15),
      poly([[0, y - 4], [w + 8, y - 1], [w + 8, y + 4], [0, y + 9]]),
      { k: "circle", cx: 1.7, cy: y - 3, r: 1 },
      { k: "circle", cx: 1.7, cy: y + 6, r: 1 },
    ],
  };
}

/** Centred past Bruno's pacing reach (BRUNO_MAX_SLOT/CONSOLE_SLOT are both
 *  slot 8) so the gantry and its holders read as their own fixture at the
 *  platform's true east end, not just wherever Bruno happens to be standing. */
const GANTRY_CX = slotCenterX(8) + 12;

/** The overhead gantry the holders hang from — a fixed hook fixture at the
 *  platform's free (east) end. Always lit while the round is live. */
function gantrySeg(): Seg {
  const cx = GANTRY_CX;
  const top = 3;
  return {
    id: "gantry",
    screen: "upper",
    shapes: [
      rect(cx - 6, top, 24, 2.4), // the beam
      rect(cx + 15, top, 2.4, 5), // a leg to the wall
      poly([[cx - 4, top + 2.4], [cx - 1, top + 2.4], [cx - 2.5, top + 6]]), // a hook
    ],
  };
}

/** One of the four holders: a pin from the gantry down to the platform's free
 *  end. Lit until Pip pulls it at the console; all four out and the platform
 *  pivots off its anchor — Bruno falls (doc §5.5). */
function holderSeg(i: number): Seg {
  const cx = GANTRY_CX - 3 + i * 2.4;
  const yTop = 6;
  const yBot = PLATFORM_Y - 1;
  const span = yBot - yTop;
  const linkR = 1.1;
  // Three round links down the pin's length, each a hair wider than the
  // connecting bar so they read as beads on a chain, not just a thick line.
  const bead = (t: number): number => yTop + span * t;
  const beadYs = [bead(0.22), bead(0.52), bead(0.82)];
  const shapes: Shape[] = [];
  let cursor = yTop;
  for (const by of beadYs) {
    shapes.push(rect(cx - 0.7, cursor, 1.4, by - linkR - cursor)); // bar up to the link
    shapes.push({ k: "circle", cx, cy: by, r: linkR }); // a link
    cursor = by + linkR;
  }
  shapes.push(rect(cx - 0.7, cursor, 1.4, yBot - cursor)); // bar down to the bolt-head
  shapes.push({ k: "circle", cx, cy: yBot, r: 1.4 }); // the bolt-head on the beam
  return {
    id: `holder.s${i}`,
    screen: "upper",
    shapes,
  };
}

/** The one control console on the floor-4 deck by the holders: a bank of four
 *  levers. `pulled` (0..4) levers are hauled — their sockets sit empty, left to
 *  right, one per holder cut loose; the rest stand upright (doc §5.5). */
function consoleSeg(pulled: number): Seg {
  const cx = slotCenterX(CONSOLE_SLOT);
  const deck = floorBaselineY("upper", 0);
  const shapes: Shape[] = [
    rect(cx - 7.5, deck - 5.6, 15, 5.6), // console body
    rect(cx - 6.4, deck - 3.8, 12.8, 1.6), // readout strip
  ];
  for (let i = 0; i < 4; i++) {
    const lx = cx - 5.4 + i * 3.6;
    if (i < pulled) {
      shapes.push(rect(lx - 1, deck - 6, 2.2, 1.3)); // empty socket
    } else {
      shapes.push(
        poly([[lx - 0.8, deck - 5.6], [lx + 0.6, deck - 5.6], [lx + 1.2, deck - 11], [lx - 0.2, deck - 11]]), // lever
        rect(lx, deck - 12.2, 1.6, 1.6), // knob
      );
    }
  }
  return { id: `console.p${pulled}`, screen: "upper", shapes };
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

/** Mara, tucked above Bruno's platform in the upper panel's left margin,
 *  outside the play grid — "at slot 0, off-grid" (doc §5.1). Sat this high
 *  (not at floor 4's own baseline) to clear the platform's west anchor
 *  bracket just below her. She's at the top and never in danger; a phone,
 *  held to her ear, is the whole character (doc §2, §7.4). */
function maraShapes(): Shape[] {
  const cx = 7;
  const b = 17;
  return [
    poly([[cx - 1.8, b - 16.5], [cx + 2, b - 16.5], [cx + 2, b - 12.8], [cx - 1.8, b - 12.8]]), // head
    poly([[cx - 2.6, b - 12.2], [cx + 2.8, b - 12.2], [cx + 2.2, b - 3], [cx - 2.2, b - 3]]), // torso
    rect(cx - 2.2, b - 3, 2, 3), // legs
    rect(cx + 0.2, b - 3, 2, 3),
    // arm up, phone to her ear
    poly([[cx + 2, b - 12], [cx + 3.6, b - 12.6], [cx + 4.4, b - 15.8], [cx + 2.8, b - 15.2]]),
    rect(cx + 3.4, b - 16.6, 1.8, 2.4), // the phone
  ];
}

/** The Steward, in the lower panel's left margin, outside the play grid (doc
 *  §5.1). His whole job is to react to the boredom meter: `bell` rings it
 *  approvingly, `watch` checks the time, `asleep` is out cold (doc §6.2). */
function stewardShapes(mood: "idle" | "bell" | "watch" | "asleep"): Shape[] {
  const cx = 7;
  const b = floorBaselineY("lower", 1); // floor-1 baseline
  if (mood === "asleep") {
    return [
      poly([[cx - 1.8, b - 12], [cx + 2.4, b - 11.4], [cx + 1.8, b - 8.4], [cx - 2.2, b - 9]]), // head lolled forward
      poly([[cx - 3, b - 9], [cx + 3.4, b - 9.6], [cx + 3, b - 2], [cx - 2.6, b - 2]]), // slumped coat
      rect(cx - 2.6, b - 2, 5.4, 2), // sat down on the job
      poly([[cx + 3, b - 17], [cx + 5.6, b - 16.4], [cx + 5.4, b - 15.4], [cx + 2.8, b - 16]]), // sleep marks
      poly([[cx + 3.4, b - 14.8], [cx + 5.2, b - 14.3], [cx + 5, b - 13.5], [cx + 3.2, b - 14]]),
    ];
  }
  const base: Shape[] = [
    // head, with a small nose to the right — he faces the play area
    poly([
      [cx - 2, b - 16.5],
      [cx + 1.8, b - 16.5],
      [cx + 1.8, b - 14.7],
      [cx + 2.9, b - 14],
      [cx + 1.8, b - 13.3],
      [cx + 1.8, b - 13],
      [cx - 2, b - 13],
    ]),
    poly([[cx - 3, b - 12.6], [cx + 3, b - 12.6], [cx + 2.4, b - 3], [cx - 2.4, b - 3]]), // long coat
    rect(cx - 2.4, b - 3, 2, 3), // legs
    rect(cx + 0.4, b - 3, 2, 3),
  ];
  if (mood === "bell") {
    base.push(
      poly([[cx + 2.2, b - 11], [cx + 3.8, b - 12], [cx + 5.2, b - 15.4], [cx + 3.8, b - 16.4]]), // arm up
      { k: "circle", cx: cx + 5.6, cy: b - 17, r: 2 }, // handbell
      rect(cx + 5.2, b - 15, 0.9, 1.6), // handle
      poly([[cx + 8, b - 18.4], [cx + 9.4, b - 17.9], [cx + 8.5, b - 17.3]]), // ring marks
      poly([[cx + 8.2, b - 15.8], [cx + 9.6, b - 15.8], [cx + 8.7, b - 15]]),
    );
  } else if (mood === "watch") {
    base.push(
      poly([[cx + 2.2, b - 11.5], [cx + 3.4, b - 11], [cx + 2.8, b - 15.4], [cx + 1.4, b - 15]]), // forearm up to eye level
      rect(cx + 1, b - 16, 2.4, 1.6), // checking the time
    );
  } else {
    base.push(rect(cx + 2, b - 11, 1.6, 7)); // arm at his side
  }
  return base;
}

export function pipShapes(pose: PipPose, cx: number, baseY: number, stride = 0): Shape[] {
  return POSE_SHAPES[pose](cx, baseY, stride);
}

/** Poses generated at every standable slot. Climb is added at ladder slots,
 *  release (the lever haul) at the floor-4 console slots. */
const GRID_POSES: readonly PipPose[] = ["stand", "walk", "duck", "jump"];

function build(): Seg[] {
  const segs: Seg[] = [];

  for (const floor of FLOORS) {
    const screen: Screen = floorScreen(floor);
    const baseY = floorBaselineY(screen, floorLocal(floor));
    const climbHere = new Set(climbSlots(floor));

    for (let s = 0; s <= MAX_SLOT; s++) {
      // Built as if the floor-2 gap were always closed: the atlas is static,
      // built once before any GameState exists, but Safety Railing (doc §7.2)
      // can close that gap at runtime. Without this, Pip or a hazard standing
      // on slot 4/5 there would have no segment to light at all.
      if (!isStandable(floor, s, true)) continue;
      const cx = slotCenterX(s);

      const poses: PipPose[] = [...GRID_POSES];
      if (climbHere.has(s)) poses.push("climb");
      if (floor === 4 && s === CONSOLE_SLOT) poses.push("release");
      for (const pose of poses) {
        // Right-facing artwork plus its left-facing mirror — both ghost, so the
        // glass carries every pose Pip could take facing either way (doc §4.3).
        const right = pipShapes(pose, cx, baseY, s % 2);
        segs.push({ id: `pip.f${floor}.s${s}.${pose}.r`, screen, shapes: right });
        segs.push({ id: `pip.f${floor}.s${s}.${pose}.l`, screen, shapes: mirror(right, cx) });
      }

      // Either hazard can roll through any standable slot on any floor; the roll
      // frame is baked from slot parity so a row of them reads as tumbling.
      segs.push({ id: `barrel.f${floor}.s${s}`, screen, shapes: barrelShapes(cx, baseY, s % 2) });
      segs.push({ id: `chair.f${floor}.s${s}`, screen, shapes: chairShapes(cx, baseY, s % 2) });
    }
  }

  // Bruno's platform: one beam on a west anchor, its free end on the gantry by
  // four holders. Console: one bank of levers, in its five states (0..4 pulled).
  segs.push(brunoPlatformSeg());
  segs.push(gantrySeg());
  for (let i = 0; i < BOLT_SLOTS.length; i++) segs.push(holderSeg(i));
  for (let n = 0; n <= 4; n++) segs.push(consoleSeg(n));

  // Bruno paces slots BRUNO_MIN_SLOT..BRUNO_MAX_SLOT, facing his direction of
  // travel. Pace poses ghost; the transient swing does not (see Seg.noGhost).
  for (let s = BRUNO_MIN_SLOT; s <= BRUNO_MAX_SLOT; s++) {
    const cx = slotCenterX(s);
    const paceL = brunoPaceShapes(cx, s % 2);
    const swipeL = brunoSwipeShapes(cx);
    segs.push({ id: `bruno.pace.s${s}.l`, screen: "upper", shapes: paceL });
    segs.push({ id: `bruno.pace.s${s}.r`, screen: "upper", shapes: mirror(paceL, cx) });
    segs.push({ id: `bruno.swipe.s${s}.l`, screen: "upper", shapes: swipeL, noGhost: true });
    segs.push({ id: `bruno.swipe.s${s}.r`, screen: "upper", shapes: mirror(swipeL, cx), noGhost: true });
  }
  for (let k = 0; k < 4; k++) {
    segs.push({
      id: `bruno.fall.f${k}`,
      screen: "upper",
      shapes: brunoFallShapes(k),
      noGhost: true,
    });
  }
  for (let i = 0; i < 3; i++) segs.push(missPipSeg(i));

  for (let i = 0; i < 10; i++) segs.push(boredomPipSeg(i));
  for (const mood of ["idle", "bell", "watch", "asleep"] as const) {
    segs.push({ id: `steward.${mood}`, screen: "lower", shapes: stewardShapes(mood) });
  }
  segs.push({ id: "mara", screen: "upper", shapes: maraShapes() });
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
