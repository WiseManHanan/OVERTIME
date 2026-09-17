/*
 * Round modifiers (doc §6.3). One is drawn at every round's start and holds
 * for the whole round — a different twist on the same climb each time.
 * Pure and seed-driven throughout (invariant 1/2): the draw (and DEAD
 * COLUMN's extra slot roll) consumes the run's RNG like a hazard spawn.
 */
import { nextInt, type RngState } from "./rng";
import { MAX_SLOT, MIN_SLOT } from "./world";

export type Modifier =
  | "deadColumn"
  | "caffeinated"
  | "greased"
  | "doubleBolts"
  | "stickyPad"
  | "silentRunning"
  | "nightShift";

/** Ticks the 14-segment announcement holds on the lower screen. */
export const MODIFIER_ANNOUNCE_TICKS = 12;

/** Silkscreen-short label for the announcement (14-seg capitals). */
export const MODIFIER_LABEL: Record<Modifier, string> = {
  deadColumn: "DEAD COLUMN",
  caffeinated: "CAFFEINATED",
  greased: "GREASED",
  doubleBolts: "DOUBLE BOLTS",
  stickyPad: "STICKY PAD",
  silentRunning: "SILENT RUNNING",
  nightShift: "NIGHT SHIFT",
};

const MODIFIERS: readonly Modifier[] = [
  "deadColumn",
  "caffeinated",
  "greased",
  "doubleBolts",
  "stickyPad",
  "silentRunning",
  "nightShift",
];

/** Type guard for `?modifier=` (main.ts) — any other string is ignored. */
export function isModifier(x: string): x is Modifier {
  return (MODIFIERS as readonly string[]).includes(x);
}

export interface ModifierRoll {
  modifier: Modifier;
  /** Only meaningful when `modifier` is "deadColumn" — the one slot, every
   *  floor, that never lights this round. */
  deadColumn: number | null;
  rng: RngState;
}

/** One modifier, drawn uniformly (doc doesn't call for weighting, unlike
 *  Mara's old ratings) — repeats across rounds are allowed.
 *
 *  `force`, when given, skips the draw and always returns that modifier —
 *  `GameState.forcedModifier`, a debug/playtest override (`?modifier=` in
 *  main.ts) for playing a specific one on demand. DEAD COLUMN still rolls
 *  its slot off the RNG either way, so a forced run isn't stuck on one column. */
export function rollModifier(rng: RngState, force: Modifier | null = null): ModifierRoll {
  if (force !== null) {
    if (force !== "deadColumn") return { modifier: force, deadColumn: null, rng };
    const [slot, r1] = nextInt(rng, MAX_SLOT - MIN_SLOT + 1);
    return { modifier: force, deadColumn: MIN_SLOT + slot, rng: r1 };
  }
  const [i, r1] = nextInt(rng, MODIFIERS.length);
  const modifier = MODIFIERS[i]!;
  if (modifier !== "deadColumn") return { modifier, deadColumn: null, rng: r1 };
  const [slot, r2] = nextInt(r1, MAX_SLOT - MIN_SLOT + 1);
  return { modifier, deadColumn: MIN_SLOT + slot, rng: r2 };
}
