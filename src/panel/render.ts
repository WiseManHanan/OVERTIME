/*
 * The five-step draw order (doc §4.3). Not negotiable, and the most commonly
 * broken thing when adding features. Every frame, in this order, no exceptions:
 *
 *   1. fill the panel with --lcd-bg
 *   2. draw the printed backdrop
 *   3. draw EVERY segment in the atlas at --ghost
 *   4. draw the lit subset at --segment
 *   5. apply the battery contrast modifier to step 4 only
 *
 * `renderPanel` is read-only with respect to game state (invariant 3).
 */
import type { Screen } from "./types";
import type { Palette } from "./colors";
import { PANEL_W, PANEL_H } from "./dims";
import { atlasFor } from "./atlas";
import { pathForSeg } from "./paths";
import { drawBackdrop } from "./backdrop";
import { drawTextLayer, type TextSpec } from "./text";

export interface PanelView {
  screen: Screen;
  /** Segment ids currently lit. */
  lit: ReadonlySet<string>;
  /** On-panel text regions (score, messages), each drawn ghost-then-lit. */
  texts: readonly TextSpec[];
  /** Battery contrast modifier (doc §7.3). 1 = full; applied to the lit segment pass only. */
  contrast: number;
  /** A battery blackout tick (doc §7.3): the lit pass is skipped for this one
   *  frame — the panel drops to the printed backdrop while the sim runs on. */
  blackout?: boolean;
  /** Power-on self-test: light every segment regardless of `lit` (doc §9.1). */
  selfTest?: boolean;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function renderPanel(
  ctx: CanvasRenderingContext2D,
  view: PanelView,
  pal: Palette,
): void {
  const segs = atlasFor(view.screen);
  const selfTest = view.selfTest === true;

  // 1 — the unlit LCD field
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.lcdBg;
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);

  // 2 — the printed backdrop
  drawBackdrop(ctx, view.screen, pal);

  // 3 — every segment in the atlas, ghosted (--ghost carries its own alpha).
  // `noGhost` segments (mirrored left-facing poses, Bruno's transient frames)
  // are skipped: they carry no silhouette a viewer needs to see coming, and
  // ghosting them doubles the layer into a smear (see Seg).
  ctx.fillStyle = pal.ghost;
  ctx.globalAlpha = 1;
  for (const seg of segs) {
    if (seg.noGhost !== true) ctx.fill(pathForSeg(seg));
  }
  for (const spec of view.texts) drawTextLayer(ctx, spec, false);

  // 4 + 5 — the lit subset at --segment, with the battery contrast modifier
  // riding this pass only (doc §4.3 step 5). A blackout tick skips it entirely.
  const blackout = view.blackout === true && !selfTest;
  if (!blackout) {
    ctx.fillStyle = pal.segment;
    ctx.globalAlpha = selfTest ? 1 : clamp01(view.contrast);
    for (const seg of segs) {
      if (selfTest || view.lit.has(seg.id)) ctx.fill(pathForSeg(seg));
    }
  }

  // On-panel text (score, messages, Steward dialogue) is not an atlas segment;
  // step 5 dims step 4 only, so the readout holds full contrast as battery falls.
  ctx.globalAlpha = 1;
  if (!blackout) for (const spec of view.texts) drawTextLayer(ctx, spec, !selfTest);
}
