/*
 * The bridge from simulation state to what each panel lights (doc §4.3, step 4).
 * Read-only with respect to `GameState` (invariant 3): it derives lit-segment
 * ids and on-panel text, nothing more.
 */
import type { GameState } from "../sim/state";
import { GLITCH_TICKS, HIT_BLINK_HALF_PERIOD, ROUND_CLEARED_TICKS } from "../sim/state";
import { sameCell } from "../sim/battery";
import { BOLT_SLOTS, floorScreen, isStandable } from "../sim/world";
import { BOREDOM_MAX, stewardMood } from "../sim/scoring";
import { CONCESSION_CARDS } from "../sim/grievance";
import { MODIFIER_LABEL } from "../sim/modifiers";
import type { Screen } from "./types";
import type { TextSpec } from "./text";
import { PANEL_W } from "./dims";

export interface Scene {
  lit: ReadonlySet<string>;
  texts: readonly TextSpec[];
}

const CARD_BY_ID = new Map(CONCESSION_CARDS.map((c) => [c.id, c]));

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
  // Mediation is text-only, top to bottom (doc §7.2): every art asset on
  // either screen — Pip, Bruno, the platform, hazards, the console, the
  // Steward — steps aside, and only the card copy remains.
  const showArt = live && state.phase !== "mediation";

  // A hit blinks Pip 3 times before settling (step.ts's post-hit freeze) —
  // hidden on odd half-periods of the countdown, visible on even ones and
  // once it reaches 0.
  const blinkedOut =
    state.hitFlash > 0 && Math.floor((state.hitFlash - 1) / HIT_BLINK_HALF_PERIOD) % 2 === 1;

  // DEAD COLUMN (doc §6.3): "Pip is invisible while standing in it" — scoped
  // to Pip only. A hazard sharing that slot still lights normally: a
  // camouflage perk, not a source of invisible, untelegraphed hits.
  const inDeadColumn = state.deadColumn !== null && p.slot === state.deadColumn;

  if (showArt && !blinkedOut && !inDeadColumn && floorScreen(p.floor) === screen) {
    // A low battery can leave this exact pose-cell stuck dark — Pip vanishes.
    if (!sameCell(state.stuckDark, p.floor, p.slot, p.pose)) {
      const face = p.facing === 1 ? "r" : "l";
      if (state.glitchTicks === GLITCH_TICKS && state.glitchPose) {
        // Segment awareness (doc §7.4): the wrong pose lights for this one
        // tick — "an arm where a leg should be," at our whole-pose grain.
        lit.add(`pip.f${p.floor}.s${p.slot}.${state.glitchPose}.${face}`);
      } else if (state.glitchTicks === 1) {
        // ...then a one-slot "shake" on his next, correct pose. Falls back
        // to no shake if the neighbouring slot isn't one Pip could stand in.
        const jitterSlot = p.slot - p.facing;
        const shakeSlot = isStandable(p.floor, jitterSlot, true) ? jitterSlot : p.slot;
        lit.add(`pip.f${p.floor}.s${shakeSlot}.${p.pose}.${face}`);
      } else {
        lit.add(`pip.f${p.floor}.s${p.slot}.${p.pose}.${face}`);
      }
    }
  }
  // ...and a phantom pose stuck lit where nobody is (doc §7.3).
  if (showArt && state.stuckLit && floorScreen(state.stuckLit.f) === screen) {
    const g = state.stuckLit;
    lit.add(`pip.f${g.f}.s${g.s}.${g.pose}.r`);
  }

  if (showArt) {
    for (const h of state.hazards) {
      if (floorScreen(h.floor) === screen) lit.add(`${h.kind}.f${h.floor}.s${h.slot}`);
    }
  }

  if (screen === "upper" && showArt) {
    if (state.phase === "cleared") {
      // Last holder pulled: the platform pivots off its anchor and takes Bruno
      // with it, across the ROUND CLEARED window (doc §5.5). 2 ticks/frame —
      // quick, now that the base tick itself runs slower than it used to.
      const elapsed = ROUND_CLEARED_TICKS - state.clearedCountdown;
      lit.add(`bruno.fall.f${Math.max(0, Math.min(3, Math.floor(elapsed / 2)))}`);
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
  }

  if (screen === "upper" && live) {
    if (state.phase !== "title") {
      // One line across the very top-left: above Pip's tallest reach on floor 4
      // (y ~13), and clear of the miss pips (top-centre) and gantry (top-right).
      texts.push({ text: "R" + state.round, x: 3, y: 2, cell: 6, kind: "seg14", align: "left" });
      texts.push({ text: String(state.score), x: 22, y: 2, cell: 6, kind: "seg7", align: "left" });
    }

    if (state.phase === "mediation") {
      // Bruno's sincere, specific complaint behind the card currently
      // highlighted — "the comedy is in his being right" (doc §7.2).
      const chosen = state.mediationCards[state.mediationSelected];
      const card = chosen ? CARD_BY_ID.get(chosen) : undefined;
      if (card) {
        // Dead centre of the screen — with Bruno and the platform out of the
        // way above, there's nothing left to compete with it. Two short
        // pre-broken lines (grievance.ts) hold a legible cell size without
        // either one clipping the panel's edge.
        const [line1, line2] = card.grievance;
        texts.push({ text: line1, x: PANEL_W / 2, y: 36, cell: 7, kind: "seg14", align: "center" });
        if (line2) {
          texts.push({ text: line2, x: PANEL_W / 2, y: 50, cell: 7, kind: "seg14", align: "center" });
        }
      }
    }
  }

  if (screen === "lower") {
    // The Steward is always on his mark, pose tracking the boredom meter —
    // except during mediation, where the card text stands alone and every
    // character steps aside for it.
    if (state.phase !== "mediation") {
      lit.add(`steward.${stewardMood(state.boredom, state.stewardAsleep)}`);
    }

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

    // The round's modifier (doc §6.3) announces itself for a beat at the top
    // of the round, then gets out of the way — same slot ROUND CLEAR uses.
    if (state.phase === "playing" && state.modifier && state.modifierAnnounceTicks > 0) {
      texts.push({
        text: MODIFIER_LABEL[state.modifier],
        x: PANEL_W / 2,
        y: 14,
        cell: 8,
        kind: "seg14",
        align: "center",
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
    } else if (state.phase === "mediation") {
      // The Steward presents up to three concession cards; LEFT/RIGHT cycles
      // the highlight (the bigger cell), A picks it (doc §7.2).
      texts.push({ text: "MEDIATION", x: PANEL_W / 2, y: 4, cell: 7, kind: "seg14", align: "center" });
      state.mediationCards.forEach((id, i) => {
        const card = CARD_BY_ID.get(id);
        if (!card) return;
        const on = i === state.mediationSelected;
        texts.push({
          text: card.title,
          x: 6,
          y: 18 + i * 12,
          cell: on ? 7 : 5,
          kind: "seg14",
          align: "left",
        });
      });
      const chosen = state.mediationCards[state.mediationSelected];
      const card = chosen ? CARD_BY_ID.get(chosen) : undefined;
      if (card) {
        // Cell 7 — the same size as GAME OVER's "PRESS A" — so the trade-off
        // itself reads at a glance, not just the card's name above it.
        texts.push({ text: card.youGain, x: 6, y: 58, cell: 7, kind: "seg14", align: "left" });
        texts.push({ text: card.brunoGains, x: 6, y: 71, cell: 7, kind: "seg14", align: "left" });
      }
      texts.push({ text: "LEFT RIGHT A", x: PANEL_W / 2, y: 86, cell: 5, kind: "seg14", align: "center" });
    }
  }

  return { lit, texts };
}
