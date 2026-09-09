/*
 * The printed backdrop (doc §4.3, step 2). Static vector art in the three print
 * inks, drawn behind every segment and never animated, never occluded. Reads
 * muted, the way printed ink looks through a 1982 TN panel.
 *
 * The floor-2 plate is broken at the gap (slots 4–5, doc §5.1) and the ladder
 * from floor 2 to floor 3 is drawn as two aligned halves that meet at the
 * hinge, so the climb reads as continuous across the two screens.
 */
import type { Screen } from "./types";
import type { Palette } from "./colors";
import { PANEL_W, PANEL_H, SLOT_W, slotCenterX, floorBaselineY } from "./dims";

export function drawBackdrop(ctx: CanvasRenderingContext2D, screen: Screen, pal: Palette): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  if (screen === "upper") drawUpper(ctx, pal);
  else drawLower(ctx, pal);
  ctx.restore();
}

function poles(ctx: CanvasRenderingContext2D, pal: Palette): void {
  ctx.fillStyle = pal.printRed;
  ctx.fillRect(12, 0, 4, PANEL_H);
  ctx.fillRect(PANEL_W - 16, 0, 4, PANEL_H);
  ctx.fillRect(PANEL_W / 2 - 1.5, 0, 3, PANEL_H);
}

/** A floor plate, optionally skipping one or more `[x0, x1]` spans (gaps). */
function plate(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  baselineY: number,
  gaps: ReadonlyArray<readonly [number, number]> = [],
): void {
  ctx.fillStyle = pal.printRed;
  const y = baselineY + 2;
  let x = 6;
  const end = PANEL_W - 6;
  for (const [gx0, gx1] of gaps) {
    if (gx0 > x) ctx.fillRect(x, y, gx0 - x, 3);
    x = Math.max(x, gx1);
  }
  if (end > x) ctx.fillRect(x, y, end - x, 3);
}

/** Vertical ladder centred on `slot`, spanning the two given y's (any order). */
function ladderAtSlot(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  slot: number,
  yA: number,
  yB: number,
): void {
  const x = slotCenterX(slot) - 4.5;
  const yHigh = Math.min(yA, yB);
  const yLow = Math.max(yA, yB);
  ctx.fillStyle = pal.printYellow;
  ctx.fillRect(x, yHigh, 2, yLow - yHigh);
  ctx.fillRect(x + 7, yHigh, 2, yLow - yHigh);
  for (let y = yHigh + 3; y < yLow; y += 5) ctx.fillRect(x, y, 9, 1.5);
}

function chevrons(ctx: CanvasRenderingContext2D, pal: Palette, y: number): void {
  ctx.fillStyle = pal.printYellow;
  for (let x = 4; x < PANEL_W - 10; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x + 2, y + 4);
    ctx.closePath();
    ctx.fill();
  }
}

/** X-span of the floor-2 gap (slots 4–5), for breaking the plate. */
const GAP_X: readonly [number, number] = [
  slotCenterX(4) - SLOT_W / 2,
  slotCenterX(5) + SLOT_W / 2,
];

function drawUpper(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const f3 = floorBaselineY("upper", 1);
  const f4 = floorBaselineY("upper", 0);

  ctx.fillStyle = pal.printBlue;
  ctx.fillRect(0, 0, PANEL_W, 9); // sky band
  ctx.fillRect(PANEL_W - 44, 2, 30, 9); // water tank
  poles(ctx, pal);
  plate(ctx, pal, f4);
  plate(ctx, pal, f3);
  ladderAtSlot(ctx, pal, 9, f3, f4); // floor 3 -> floor 4
  ladderAtSlot(ctx, pal, 0, f3, PANEL_H); // floor 3 down to the hinge (from floor 2)
  chevrons(ctx, pal, PANEL_H - 5);
}

function drawLower(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const f1 = floorBaselineY("lower", 1);
  const f2 = floorBaselineY("lower", 0);

  poles(ctx, pal);
  plate(ctx, pal, f1);
  plate(ctx, pal, f2, [GAP_X]); // the gap at slots 4–5
  ladderAtSlot(ctx, pal, 9, f1, f2); // floor 1 -> floor 2
  ladderAtSlot(ctx, pal, 0, f2, 0); // floor 2 up to the hinge (to floor 3)

  // the skip Bruno lands in (doc §2)
  ctx.fillStyle = pal.printBlue;
  ctx.beginPath();
  ctx.moveTo(56, PANEL_H - 3);
  ctx.lineTo(104, PANEL_H - 3);
  ctx.lineTo(98, PANEL_H - 18);
  ctx.lineTo(62, PANEL_H - 18);
  ctx.closePath();
  ctx.fill();

  // the Steward's bell, in the left margin outside the play grid (doc §5.1)
  ctx.fillStyle = pal.printYellow;
  ctx.beginPath();
  ctx.arc(6, 60, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(5, 55, 2, 3);

  chevrons(ctx, pal, f2 - 6);
}
