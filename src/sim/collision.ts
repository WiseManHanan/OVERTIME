/*
 * Slot-occupancy collision (doc §5.3). Never geometry: a hazard hits Pip only
 * when they share a floor and a slot, modified by state —
 *   - a jump clears a *low* hazard (both airborne ticks)
 *   - a duck slips under a *high* hazard
 *   - a ladder is a refuge: nothing hits Pip on the climb tick (doc §5.4)
 */
import type { Pip } from "./state";
import { isAirborne } from "./state";
import type { Hazard } from "./hazards";
import { HAZARD_HEIGHT } from "./hazards";

export function hazardHits(pip: Pip, h: Hazard): boolean {
  if (h.floor !== pip.floor || h.slot !== pip.slot) return false;
  if (pip.pose === "climb") return false;
  const height = HAZARD_HEIGHT[h.kind];
  if (isAirborne(pip) && height === "low") return false;
  if (pip.pose === "duck" && height === "high") return false;
  return true;
}
