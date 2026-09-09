/*
 * The bridge from simulation state to what each panel lights (doc §4.3, step 4).
 * Read-only with respect to `GameState` (invariant 3): it derives lit-segment
 * ids and on-panel text, nothing more.
 */
import type { GameState } from "../sim/state";
import { floorScreen } from "../sim/world";
import type { Screen } from "./types";
import type { TextSpec } from "./text";
import { PANEL_W } from "./dims";

export interface Scene {
  lit: ReadonlySet<string>;
  texts: readonly TextSpec[];
}

/** Title state until the first move (doc §9.3). Shown on the lower panel. */
const TITLE_TEXTS: readonly TextSpec[] = [
  { text: "OVERTIME", x: PANEL_W / 2, y: 7, cell: 13, kind: "seg14", align: "center" },
  { text: "MOVE TO START", x: PANEL_W / 2, y: 29, cell: 7, kind: "seg14", align: "center" },
];

const NO_TEXT: readonly TextSpec[] = [];

export function sceneFor(state: GameState, screen: Screen): Scene {
  const lit = new Set<string>();

  const p = state.pip;
  if (floorScreen(p.floor) === screen) {
    lit.add(`pip.f${p.floor}.s${p.slot}.${p.pose}`);
  }

  const texts = !state.started && screen === "lower" ? TITLE_TEXTS : NO_TEXT;
  return { lit, texts };
}
