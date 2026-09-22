/*
 * The printed backdrop (doc §4.3, step 2). Static vector art in the three print
 * inks, drawn behind every segment and never animated, never occluded.
 *
 * Two opacity bands, not one: the structure Pip actually stands and climbs on
 * (floor plates, ladders) prints bold and near-solid, the way a real
 * Game & Watch's girders read — thick, high-contrast, riveted. Everything
 * else (sky, water tank, the skip, warning chevrons, the Steward's bell) is
 * scenery behind that structure and stays faint, so it recedes rather than
 * competing with it.
 *
 * The floor-2 plate is broken at the gap (slots 4–5, doc §5.1) and the ladder
 * from floor 2 to floor 3 is drawn as two aligned halves that meet at the
 * hinge, so the climb reads as continuous across the two screens.
 */
import type { Screen } from "./types";
import type { Palette } from "./colors";
import { PANEL_W, PANEL_H, SLOT_W, slotCenterX, floorBaselineY } from "./dims";
import { CONSOLE_SLOT } from "../sim/state";

/** Girders and ladders — what Pip stands and climbs on. Bold, not muted. */
const STRUCTURE_ALPHA = 0.95;
/** Sky, water tank, the skip, chevrons, the bell — scenery behind the structure. */
const DECO_ALPHA = 0.45;

export function drawBackdrop(ctx: CanvasRenderingContext2D, screen: Screen, pal: Palette): void {
  ctx.save();
  if (screen === "upper") drawUpper(ctx, pal);
  else drawLower(ctx, pal);
  ctx.restore();
}

/** Every plate() ever draws the same handful of (baselineY, gaps) shapes —
 *  each floor's girder is fixed geometry, never a function of GameState. Built
 *  once per shape and reused, the same "build a Path2D once, per-frame work is
 *  only fill()/stroke()" rule the segment atlas follows (atlas.ts). */
const trussCache = new Map<string, Path2D>();

function trussPath(baselineY: number, gaps: ReadonlyArray<readonly [number, number]>): Path2D {
  const key = `${baselineY}:${gaps.map((g) => g.join(",")).join("|")}`;
  const cached = trussCache.get(key);
  if (cached !== undefined) return cached;

  const yTop = baselineY;
  const yBot = baselineY + 5;
  const railH = 1.6;
  // Full bleed to both screen edges — a girder that stops short of the bezel
  // reads as afloat, not bolted to anything.
  let x = 0;
  const end = PANEL_W;
  const spans: [number, number][] = [];
  for (const [gx0, gx1] of gaps) {
    if (gx0 > x) spans.push([x, gx0]);
    x = Math.max(x, gx1);
  }
  if (end > x) spans.push([x, end]);

  const path = new Path2D();
  for (const [sx0, sx1] of spans) {
    path.rect(sx0, yTop, sx1 - sx0, railH);
    path.rect(sx0, yBot, sx1 - sx0, railH);

    const step = 6;
    let up = true;
    for (let cx = sx0; cx < sx1; cx += step) {
      const y0 = up ? yTop : yBot;
      const y1 = up ? yBot : yTop;
      path.moveTo(cx, y0);
      path.lineTo(Math.min(cx + step, sx1), y1);
      up = !up;
    }
  }
  trussCache.set(key, path);
  return path;
}

/**
 * A floor girder: top and bottom rail with a diagonal cross-brace lattice
 * between them, the way a printed steel truss reads on the real hardware —
 * not a flat bar. Optionally skips one or more `[x0, x1]` spans (gaps); each
 * remaining span gets its own rails and bracing so the break stays clean.
 */
function plate(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  baselineY: number,
  gaps: ReadonlyArray<readonly [number, number]> = [],
): void {
  ctx.globalAlpha = STRUCTURE_ALPHA;
  ctx.fillStyle = pal.printRed;
  ctx.strokeStyle = pal.printRed;
  ctx.lineWidth = 1.4;
  const path = trussPath(baselineY, gaps);
  ctx.fill(path); // the two rails
  ctx.stroke(path); // the cross-braces (the rails' outline strokes too, invisibly — same fill colour)
}

/** Vertical ladder centred on `slot`, spanning the two given y's (any order). */
function ladderAtSlot(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  slot: number,
  yA: number,
  yB: number,
): void {
  ctx.globalAlpha = STRUCTURE_ALPHA;
  const x = slotCenterX(slot) - 4.5;
  const yHigh = Math.min(yA, yB);
  const yLow = Math.max(yA, yB);
  ctx.fillStyle = pal.printYellow;
  ctx.fillRect(x, yHigh, 2.6, yLow - yHigh);
  ctx.fillRect(x + 6.9, yHigh, 2.6, yLow - yHigh);
  for (let y = yHigh + 3; y < yLow; y += 5) ctx.fillRect(x, y, 9.5, 2);
}

/** The lever console's housing: body and readout strip, printed and fixed —
 *  only the levers themselves (atlas.ts `console.p{n}`) animate, riding on
 *  top of this at the same coordinates (doc §3.1: printed colour is
 *  decoration, never the carrier of game state). Bolted structure like the
 *  platforms it sits beside, so it prints in the same ink, at the same
 *  opaque structure alpha, not the fainter scenery band. */
function consoleHousing(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const cx = slotCenterX(CONSOLE_SLOT);
  const deck = floorBaselineY("upper", 0);
  ctx.globalAlpha = STRUCTURE_ALPHA;
  ctx.fillStyle = pal.printRed;
  ctx.fillRect(cx - 7.5, deck - 5.6, 15, 5.6); // console body
  ctx.fillRect(cx - 6.4, deck - 3.8, 12.8, 1.6); // readout strip
}

function chevrons(ctx: CanvasRenderingContext2D, pal: Palette, y: number): void {
  ctx.globalAlpha = DECO_ALPHA;
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

  ctx.globalAlpha = DECO_ALPHA;
  ctx.fillStyle = pal.printBlue;
  ctx.fillRect(0, 0, PANEL_W, 9); // sky band
  ctx.fillRect(PANEL_W - 44, 2, 30, 9); // water tank

  plate(ctx, pal, f4);
  plate(ctx, pal, f3);
  ladderAtSlot(ctx, pal, 9, f3, f4); // floor 3 -> floor 4
  ladderAtSlot(ctx, pal, 0, f3, PANEL_H); // floor 3 down to the hinge (from floor 2)
  consoleHousing(ctx, pal);
  chevrons(ctx, pal, PANEL_H - 5);
}

function drawLower(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const f1 = floorBaselineY("lower", 1);
  const f2 = floorBaselineY("lower", 0);

  plate(ctx, pal, f1);
  plate(ctx, pal, f2, [GAP_X]); // the gap at slots 4–5
  ladderAtSlot(ctx, pal, 9, f1, f2); // floor 1 -> floor 2
  ladderAtSlot(ctx, pal, 0, f2, 0); // floor 2 up to the hinge (to floor 3)

  // the skip Bruno lands in (doc §2)
  ctx.globalAlpha = DECO_ALPHA;
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
