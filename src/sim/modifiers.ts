/*
 * Round modifiers (doc §6.3). One is drawn at every round's start and holds
 * for the whole round — a different twist on the same climb each time.
 * Pure and seed-driven throughout (invariant 1/2): the draw (and DEAD
 * COLUMN's/GREASED's extra slot rolls) consumes the run's RNG like a hazard
 * spawn.
 */
import { nextInt, type RngState } from "./rng";
import { FLOORS, MAX_SLOT, MIN_SLOT, climbSlots, isGap, isStandable, type Floor } from "./world";

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

/** GREASED never spills on floor 1 (the start, right under the round's first
 *  few steps) or floor 4 (Bruno's deck, the console and holders) — floors 2
 *  and 3 only. */
const GREASE_FLOORS: readonly Floor[] = FLOORS.filter((f) => f !== 1 && f !== 4);

/** Type guard for `?modifier=` (main.ts) — any other string is ignored. */
export function isModifier(x: string): x is Modifier {
  return (MODIFIERS as readonly string[]).includes(x);
}

export interface ModifierRoll {
  modifier: Modifier;
  /** Only meaningful when `modifier` is "deadColumn" — the one slot, every
   *  floor, that never lights this round. */
  deadColumn: number | null;
  /** GREASED's spill (doc §6.3): the one floor/slot cell — never floor 4 —
   *  that carries Pip one extra slot when he steps onto it. Both null or
   *  both set together; only meaningful when `modifier` is "greased". */
  greaseFloor: Floor | null;
  greaseSlot: number | null;
  rng: RngState;
}

/** Slots GREASED may spill on, on `floor` — standable, not bordering a gap
 *  (doc §5.1), and not a ladder connection either:
 *  - a gap's lip is only ever walked onto from its one open side, and the
 *    slide always continues that same direction — straight into the gap,
 *    where it can't land. Crossing a gap takes a jump regardless, so a spill
 *    there would never do anything.
 *  - a ladder slot is how Pip changes floors — landing the queued slide
 *    there would hijack the very next input (UP or DOWN to climb) into a
 *    forced sideways shove instead, for no reason a player could read. */
function greaseSlots(floor: Floor): number[] {
  const ladders = new Set(climbSlots(floor));
  const out: number[] = [];
  for (let s = MIN_SLOT; s <= MAX_SLOT; s++) {
    if (isStandable(floor, s) && !isGap(floor, s - 1) && !isGap(floor, s + 1) && !ladders.has(s)) {
      out.push(s);
    }
  }
  return out;
}

/** GREASED's spill relocates after every hit (doc §6.3) — step.ts calls this
 *  directly, same draw the initial roll above uses. */
export function rollGreaseSpill(rng: RngState): [Floor, number, RngState] {
  const [fi, r1] = nextInt(rng, GREASE_FLOORS.length);
  const floor = GREASE_FLOORS[fi]!;
  const slots = greaseSlots(floor);
  const [si, r2] = nextInt(r1, slots.length);
  return [floor, slots[si]!, r2];
}

const NO_SPILL = { deadColumn: null, greaseFloor: null, greaseSlot: null } as const;

/** One modifier, drawn uniformly (doc doesn't call for weighting, unlike
 *  Mara's old ratings) — repeats across rounds are allowed.
 *
 *  `force`, when given, skips the draw and always returns that modifier —
 *  `GameState.forcedModifier`, a debug/playtest override (`?modifier=` in
 *  main.ts) for playing a specific one on demand. DEAD COLUMN and GREASED
 *  still roll their slot off the RNG either way, so a forced run isn't
 *  stuck on one column or one spill. */
export function rollModifier(rng: RngState, force: Modifier | null = null): ModifierRoll {
  const [modifier, r1] =
    force !== null ? [force, rng] : (() => {
      const [i, r] = nextInt(rng, MODIFIERS.length);
      return [MODIFIERS[i]!, r] as const;
    })();

  if (modifier === "deadColumn") {
    const [slot, r2] = nextInt(r1, MAX_SLOT - MIN_SLOT + 1);
    return { modifier, ...NO_SPILL, deadColumn: MIN_SLOT + slot, rng: r2 };
  }
  if (modifier === "greased") {
    const [greaseFloor, greaseSlot, r2] = rollGreaseSpill(r1);
    return { modifier, ...NO_SPILL, greaseFloor, greaseSlot, rng: r2 };
  }
  return { modifier, ...NO_SPILL, rng: r1 };
}
