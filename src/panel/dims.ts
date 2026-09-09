/*
 * Virtual panel space and the discrete grid that lives in it.
 *
 * Everything the renderer draws is expressed in a 160 x 96 space per screen and
 * scaled to device pixels at draw time (doc §4.2). Nothing here is fractional in
 * the gameplay sense — slot and floor indices are integers; the pixel geometry
 * derived from them is not a "position" (invariant 4).
 */
import type { Screen } from "./types";

export const PANEL_W = 160;
export const PANEL_H = 96;

/** Unlit segments are always drawn at this alpha (doc §3.1, `--ghost`). */
export const GHOST_ALPHA = 0.08;

/** Discrete horizontal slots per floor (doc §5.1). */
export const SLOTS = 10;

const MARGIN_X = 9;
export const SLOT_W = (PANEL_W - MARGIN_X * 2) / SLOTS;

/** Centre x of a slot in panel space. */
export function slotCenterX(slot: number): number {
  return MARGIN_X + slot * SLOT_W + SLOT_W / 2;
}

/**
 * Baseline y (where a character's feet rest) for the two floors a screen shows.
 * `local` 0 is the upper of the two floors on that screen, 1 the lower.
 *   upper screen: 0 = floor 4, 1 = floor 3
 *   lower screen: 0 = floor 2, 1 = floor 1
 */
export function floorBaselineY(screen: Screen, local: 0 | 1): number {
  if (screen === "upper") return local === 0 ? 40 : 80;
  return local === 0 ? 40 : 84;
}
