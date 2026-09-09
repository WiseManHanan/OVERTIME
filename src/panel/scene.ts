/*
 * The bridge from simulation state to what each panel lights (doc §4.3, step 4).
 * Read-only with respect to `GameState` (invariant 3): it derives lit-segment
 * ids and on-panel text, nothing more.
 */
import type { GameState } from "../sim/state";
import { BOLT_SLOTS, floorScreen } from "../sim/world";
import type { Screen } from "./types";
import type { TextSpec } from "./text";
import { PANEL_W } from "./dims";

export interface Scene {
  lit: ReadonlySet<string>;
  texts: readonly TextSpec[];
}

const TITLE_TEXTS: readonly TextSpec[] = [
  { text: "OVERTIME", x: PANEL_W / 2, y: 7, cell: 13, kind: "seg14", align: "center" },
  { text: "MOVE TO START", x: PANEL_W / 2, y: 29, cell: 7, kind: "seg14", align: "center" },
];

export function sceneFor(state: GameState, screen: Screen): Scene {
  const lit = new Set<string>();
  const texts: TextSpec[] = [];
  const p = state.pip;

  if (floorScreen(p.floor) === screen) {
    lit.add(`pip.f${p.floor}.s${p.slot}.${p.pose}`);
  }

  for (const h of state.hazards) {
    if (floorScreen(h.floor) === screen) lit.add(`barrel.f${h.floor}.s${h.slot}`);
  }

  if (screen === "upper") {
    lit.add(state.swipe > 0 ? "bruno.swipe" : "bruno.idle");

    BOLT_SLOTS.forEach((slot, i) => {
      const releasing =
        p.releasing > 0 && p.releasingBolt === i && state.tick % 2 === 0;
      if (state.bolts[i] === true || releasing) lit.add(`bolt.s${slot}`);
    });

    for (let i = 0; i < Math.min(state.misses, 3); i++) lit.add(`miss.p${i}`);

    if (state.phase !== "title") {
      texts.push({ text: String(state.score), x: PANEL_W - 4, y: 2, cell: 8, kind: "seg7", align: "right" });
      texts.push({ text: String(state.round), x: 4, y: 2, cell: 8, kind: "seg7", align: "left" });
    }
  }

  if (screen === "lower") {
    if (state.phase === "title") {
      texts.push(...TITLE_TEXTS);
    } else if (state.phase === "cleared") {
      texts.push({ text: "ROUND CLEAR", x: PANEL_W / 2, y: 14, cell: 9, kind: "seg14", align: "center" });
    } else if (state.phase === "over") {
      texts.push({ text: "GAME OVER", x: PANEL_W / 2, y: 8, cell: 11, kind: "seg14", align: "center" });
      texts.push({ text: "PRESS A", x: PANEL_W / 2, y: 30, cell: 8, kind: "seg14", align: "center" });
    }
  }

  return { lit, texts };
}
