/*
 * The bridge from simulation state to what each panel lights (doc §4.3, step 4).
 * Read-only with respect to `GameState` (invariant 3): it derives lit-segment
 * ids and on-panel text, nothing more.
 */
import type { GameState } from "../sim/state";
import { ROUND_CLEARED_TICKS } from "../sim/state";
import { BOLT_SLOTS, floorScreen } from "../sim/world";
import { BOREDOM_MAX, stewardMood } from "../sim/scoring";
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
  // GAME OVER is a results screen — the scaffold clears to just the readout.
  const live = state.phase !== "over";

  if (live && floorScreen(p.floor) === screen) {
    lit.add(`pip.f${p.floor}.s${p.slot}.${p.pose}.${p.facing === 1 ? "r" : "l"}`);
  }

  if (live) {
    for (const h of state.hazards) {
      if (floorScreen(h.floor) === screen) lit.add(`${h.kind}.f${h.floor}.s${h.slot}`);
    }
  }

  if (screen === "upper" && live) {
    if (state.phase === "cleared") {
      // Last holder pulled: the platform pivots off its anchor and takes Bruno
      // with it, across the ROUND CLEARED window (doc §5.5).
      const elapsed = ROUND_CLEARED_TICKS - state.clearedCountdown;
      lit.add(`bruno.fall.f${Math.max(0, Math.min(3, Math.floor(elapsed / 5)))}`);
    } else {
      const face = state.brunoDir === 1 ? "r" : "l";
      const pose = state.swipe > 0 ? "swipe" : "pace";
      lit.add(`bruno.${pose}.s${state.brunoSlot}.${face}`);
      lit.add("bruno.platform");
      lit.add("gantry");
      // Each holder stands until Pip pulls its lever at the console.
      BOLT_SLOTS.forEach((_, i) => {
        if (state.bolts[i] !== true) lit.add(`holder.s${i}`);
      });
    }

    // The one console: as many levers down as holders cut, plus a flicker to the
    // next while Pip is hauling it (doc §5.5).
    const down = state.bolts.filter(Boolean).length;
    const hauling = p.releasing > 0 && state.tick % 2 === 0;
    lit.add(`console.p${Math.min(4, hauling ? down + 1 : down)}`);

    for (let i = 0; i < Math.min(state.misses, 3); i++) lit.add(`miss.p${i}`);

    if (state.phase !== "title") {
      // One line across the very top-left: above Pip's tallest reach on floor 4
      // (y ~13), and clear of the miss pips (top-centre) and gantry (top-right).
      texts.push({ text: "R" + state.round, x: 3, y: 2, cell: 6, kind: "seg14", align: "left" });
      texts.push({ text: String(state.score), x: 22, y: 2, cell: 6, kind: "seg7", align: "left" });
    }
  }

  if (screen === "lower") {
    // The Steward is always on his mark; his pose tracks the boredom meter.
    lit.add(`steward.${stewardMood(state.boredom, state.stewardAsleep)}`);

    if (state.phase === "playing" || state.phase === "cleared") {
      const filled = Math.round((state.boredom / BOREDOM_MAX) * 10);
      for (let i = 0; i < filled; i++) lit.add(`boredom.p${i}`);
      texts.push({
        text: String(state.nearMisses),
        x: PANEL_W - 4,
        y: 2,
        cell: 7,
        kind: "seg7",
        align: "right",
      });
    }

    if (state.phase === "title") {
      texts.push(...TITLE_TEXTS);
    } else if (state.phase === "cleared") {
      texts.push({ text: "ROUND CLEAR", x: PANEL_W / 2, y: 14, cell: 9, kind: "seg14", align: "center" });
    } else if (state.phase === "over") {
      // Holds here until the A button — nothing else dismisses it (main.ts).
      texts.push({ text: "GAME OVER", x: PANEL_W / 2, y: 12, cell: 11, kind: "seg14", align: "center" });
      texts.push({ text: "SCORE", x: PANEL_W / 2, y: 34, cell: 6, kind: "seg14", align: "center" });
      texts.push({ text: String(state.score), x: PANEL_W / 2, y: 44, cell: 14, kind: "seg7", align: "center" });
      texts.push({ text: "PRESS A", x: PANEL_W / 2, y: 68, cell: 7, kind: "seg14", align: "center" });
    }
  }

  return { lit, texts };
}
