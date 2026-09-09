/*
 * The segment atlas (doc §4.2) — the catalogue of every physically distinct
 * segment on the glass. Nothing here moves; movement is a different subset of
 * these lighting up.
 *
 * Phase 1 registers just enough to prove the effect: Pip's standing pose at
 * every slot of one floor per screen (so the ghost of every pose he could be in
 * is always visible), plus the four bolt stations. The full pose vocabulary and
 * parametric generation land in Phase 2.
 */
import type { Screen, Seg, Shape } from "./types";
import { SLOTS, slotCenterX, floorBaselineY } from "./dims";

const rect = (x: number, y: number, w: number, h: number): Shape => ({ k: "rect", x, y, w, h });
const poly = (pts: [number, number][]): Shape => ({ k: "poly", pts });

/**
 * Pip's neutral standing pose: chunky quads with a hair of green glass left
 * between them, so the seams between limb segments read the way real segment art
 * does (doc §4.2). Feet rest at (cx, baseY); the pose is ~24 tall, ~13 wide.
 */
export function pipStand(screen: Screen, tag: string, cx: number, baseY: number): Seg {
  return {
    id: `pip.${tag}.stand`,
    screen,
    shapes: [
      // hard hat: dome + brim as one 6-point cap, sitting above the head
      poly([
        [cx - 3, baseY - 24],
        [cx + 3, baseY - 24],
        [cx + 4, baseY - 21],
        [cx + 4.6, baseY - 20],
        [cx - 4.6, baseY - 20],
        [cx - 4, baseY - 21],
      ]),
      rect(cx - 2.4, baseY - 19, 4.8, 4), // head
      poly([
        [cx - 3.8, baseY - 14.5],
        [cx + 3.8, baseY - 14.5],
        [cx + 3.2, baseY - 7.8],
        [cx - 3.2, baseY - 7.8],
      ]), // torso
      poly([[cx - 6, baseY - 14], [cx - 4.6, baseY - 14], [cx - 4, baseY - 7], [cx - 5.4, baseY - 7]]), // left arm
      poly([[cx + 4.6, baseY - 14], [cx + 6, baseY - 14], [cx + 5.4, baseY - 7], [cx + 4, baseY - 7]]), // right arm
      rect(cx - 3.3, baseY - 6.8, 2.4, 4.8), // left leg
      rect(cx + 0.9, baseY - 6.8, 2.4, 4.8), // right leg
      poly([[cx - 4.4, baseY - 2], [cx - 0.6, baseY - 2], [cx - 0.6, baseY], [cx - 5.2, baseY]]), // left boot
      poly([[cx + 0.6, baseY - 2], [cx + 4.4, baseY - 2], [cx + 5.2, baseY], [cx + 0.6, baseY]]), // right boot
    ],
  };
}

/** A bolt station on floor 4: a rivet ring with a cross-slot (doc §5.5). */
export function boltStation(slot: number): Seg {
  const cx = slotCenterX(slot);
  const cy = floorBaselineY("upper", 0) - 7;
  return {
    id: `bolt.s${slot}`,
    screen: "upper",
    shapes: [
      { k: "arc", cx, cy, r: 3.6, a0: 0, a1: Math.PI * 2, w: 2.2 }, // ring
      rect(cx - 1.7, cy - 0.9, 3.4, 1.8), // slot
    ],
  };
}

function build(): Seg[] {
  const segs: Seg[] = [];
  for (let s = 0; s < SLOTS; s++) {
    segs.push(pipStand("lower", `f1.s${s}`, slotCenterX(s), floorBaselineY("lower", 1)));
    segs.push(pipStand("upper", `f4.s${s}`, slotCenterX(s), floorBaselineY("upper", 0)));
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
