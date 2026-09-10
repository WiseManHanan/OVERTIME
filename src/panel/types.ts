/*
 * Shared vocabulary for the panel layer.
 *
 * An entity is never a sprite that moves. It is a set of pre-manufactured
 * segments, of which some subset is lit (doc §4.2). Coordinates are in a virtual
 * panel space of 160 x 96 per screen, scaled at draw time.
 */

export type Screen = "upper" | "lower";

/** A primitive that a segment is composed of. No curves under ~3 units (doc §4.2). */
export type Shape =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "poly"; pts: [number, number][] }
  | { k: "circle"; cx: number; cy: number; r: number }
  | { k: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; w: number };

/**
 * One physically distinct segment on the glass. Pip at floor 1 slot 3 is a
 * different `Seg` from Pip at floor 1 slot 4 — same shape vocabulary, different
 * `id`, and ghosted every frame (doc §4.3 step 3) unless `noGhost` is set.
 *
 * `noGhost` is a narrow exception for Bruno's transient swing and tumble frames:
 * they are one-off action art, not a pose a viewer reads ahead for, and stacking
 * four overlapping tumble frames into the ghost layer just smears the panel.
 * Every gameplay pose — both facings — still ghosts.
 */
export interface Seg {
  id: string; // e.g. "pip.f1.s3.stand.r"
  screen: Screen;
  shapes: Shape[];
  noGhost?: boolean;
}
