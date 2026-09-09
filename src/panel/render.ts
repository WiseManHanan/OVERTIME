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
import { PANEL_W, PANEL_H, GHOST_ALPHA } from "./dims";
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
  /** Battery contrast modifier (doc §7.3). 1 = full; applied to the lit pass only. */
  contrast: number;
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

  // 3 — every segment in the atlas, ghosted
  ctx.fillStyle = pal.segment;
  ctx.globalAlpha = GHOST_ALPHA;
  for (const seg of segs) ctx.fill(pathForSeg(seg));
  for (const spec of view.texts) drawTextLayer(ctx, spec, false);

  // 4 + 5 — the lit subset, with the battery contrast modifier riding this pass
  ctx.globalAlpha = selfTest ? 1 : clamp01(view.contrast);
  for (const seg of segs) {
    if (selfTest || view.lit.has(seg.id)) ctx.fill(pathForSeg(seg));
  }
  for (const spec of view.texts) drawTextLayer(ctx, spec, !selfTest);

  ctx.globalAlpha = 1;
}
