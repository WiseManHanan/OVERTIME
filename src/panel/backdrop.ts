/*
 * The printed backdrop (doc §4.3, step 2). Static vector art in the three print
 * inks, drawn behind every segment and never animated, never occluded. Reads
 * muted, the way printed ink looks through a 1982 TN panel.
 */
import type { Screen } from "./types";
import type { Palette } from "./colors";
import { PANEL_W, PANEL_H, floorBaselineY } from "./dims";

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

function plate(ctx: CanvasRenderingContext2D, pal: Palette, baselineY: number): void {
  ctx.fillStyle = pal.printRed;
  ctx.fillRect(6, baselineY + 2, PANEL_W - 12, 3);
}

function ladder(ctx: CanvasRenderingContext2D, pal: Palette, x: number, yLow: number, yHigh: number): void {
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

function drawUpper(ctx: CanvasRenderingContext2D, pal: Palette): void {
  ctx.fillStyle = pal.printBlue;
  ctx.fillRect(0, 0, PANEL_W, 9); // sky band
  ctx.fillRect(PANEL_W - 44, 2, 30, 9); // water tank
  poles(ctx, pal);
  plate(ctx, pal, floorBaselineY("upper", 0));
  plate(ctx, pal, floorBaselineY("upper", 1));
  ladder(ctx, pal, PANEL_W - 26, floorBaselineY("upper", 1), floorBaselineY("upper", 0));
  chevrons(ctx, pal, PANEL_H - 5);
}

function drawLower(ctx: CanvasRenderingContext2D, pal: Palette): void {
  poles(ctx, pal);
  plate(ctx, pal, floorBaselineY("lower", 0));
  plate(ctx, pal, floorBaselineY("lower", 1));
  ladder(ctx, pal, PANEL_W - 26, floorBaselineY("lower", 1), floorBaselineY("lower", 0));

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

  chevrons(ctx, pal, floorBaselineY("lower", 0) - 6);
}
