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

/** Anchor x of the platform (its west pivot) and its free (east) end. */
const PLATFORM_WEST = slotCenterX(1) - 2;
const PLATFORM_EAST = slotCenterX(9) + 2;

/** Four frames of the platform pivoting off its west anchor once the last holder
 *  is pulled — the free end swings down, Bruno slides off it and out of frame. */
function brunoFallShapes(k: number): Shape[] {
  const ax = PLATFORM_WEST;
  const ay = PLATFORM_Y;
  const len = PLATFORM_EAST - ax;
  const ang = [0.16, 0.44, 0.82, 1.2][k]!;
  const ex = ax + len * Math.cos(ang);
  const ey = ay + len * Math.sin(ang);
  const nx = Math.sin(ang);
  const ny = -Math.cos(ang);
  const th = 2.6;
  // Bruno riding the beam, sliding toward the low end and tumbling as he goes
  const t = Math.min(0.96, 0.5 + k * 0.16);
  const bx = ax + len * t * Math.cos(ang);
  const by = ay + len * t * Math.sin(ang) - 3;
  const g = k * 2;
  return [
    poly([[ax, ay], [ex, ey], [ex + nx * th, ey + ny * th], [ax + nx * th, ay + ny * th]]), // the beam
    poly([[ax - 6, ay + 3], [ax, ay - 1], [ax, ay + 5]]), // the west anchor stub, holding
    poly([[bx - 5, by - 4 - g], [bx + 5, by - 5 - g], [bx + 6, by + 2], [bx - 4, by + 3]]), // body
    poly([[bx - 6, by - 8 - g], [bx - 1, by - 9 - g], [bx, by - 4 - g], [bx - 5, by - 3 - g]]), // hat, flung
    poly([[bx + 3, by - 2], [bx + 7, by - 3], [bx + 9, by + 3 + k], [bx + 6, by + 4 + k]]), // arm out
    poly([[bx - 3, by + 3], [bx + 1, by + 3], [bx - 1, by + 9], [bx - 5, by + 8]]), // leg
  ];
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
      // west anchor: a gusset tying the beam into the wall
      poly([[w - 3, y - 1], [w + 6, y - 1], [w + 6, y + 5], [w - 3, y + 8]]),
      rect(w - 5, y - 2, 2.4, 12), // the wall post it bolts to
    ],
  };
}

/** The overhead gantry the holders hang from — a fixed hook fixture at the
 *  platform's free (east) end. Always lit while the round is live. */
function gantrySeg(): Seg {
  const cx = slotCenterX(8);
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
  const cx = slotCenterX(8) - 3 + i * 2.4;
  const yTop = 6;
  const yBot = PLATFORM_Y - 1;
  return {
    id: `holder.s${i}`,
    screen: "upper",
    shapes: [
      rect(cx - 0.7, yTop, 1.4, yBot - yTop), // the pin
      { k: "circle", cx, cy: yBot, r: 1.4 }, // the bolt-head on the beam
    ],
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
      if (!isStandable(floor, s)) continue;
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
