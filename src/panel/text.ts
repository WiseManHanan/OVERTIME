/*
 * The 7-segment and 14-segment cell renderer (doc §3.2).
 *
 * All on-panel text — score, timer, Steward dialogue, round modifiers — is drawn
 * through here, so it is physically constrained to what the hardware could show.
 * Lowercase is impossible on a 14-segment cell; input is upper-cased. Every cell
 * draws its full set of segments as a ghost and then the lit subset, matching
 * the atlas's render behaviour (doc §4.3, steps 3 and 4).
 */

export type CellKind = "seg7" | "seg14";

export interface TextSpec {
  text: string;
  /** Anchor x in panel space; meaning depends on `align`. */
  x: number;
  /** Top of the first cell in panel space. */
  y: number;
  /** Cell height in panel units. */
  cell: number;
  kind: CellKind;
  align?: "left" | "center" | "right";
}

type Pt = [number, number];

function polyPath(pts: readonly Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  p.closePath();
  return p;
}

// A horizontal bar as a stretched hexagon (45-degree bevelled ends).
function hbar(y: number, x0: number, x1: number, hh: number, bev: number): Pt[] {
  return [
    [x0, y],
    [x0 + bev, y - hh],
    [x1 - bev, y - hh],
    [x1, y],
    [x1 - bev, y + hh],
    [x0 + bev, y + hh],
  ];
}

function vbar(x: number, y0: number, y1: number, hh: number, bev: number): Pt[] {
  return [
    [x, y0],
    [x + hh, y0 + bev],
    [x + hh, y1 - bev],
    [x, y1],
    [x - hh, y1 - bev],
    [x - hh, y0 + bev],
  ];
}

// A thin quad between two points, pulled in from the endpoints so diagonals
// don't overshoot where they meet the bars.
function diagBar(p0: Pt, p1: Pt, hh: number): Pt[] {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const a: Pt = [p0[0] + ux * hh, p0[1] + uy * hh];
  const b: Pt = [p1[0] - ux * hh, p1[1] - uy * hh];
  return [
    [a[0] + nx * hh, a[1] + ny * hh],
    [b[0] + nx * hh, b[1] + ny * hh],
    [b[0] - nx * hh, b[1] - ny * hh],
    [a[0] - nx * hh, a[1] - ny * hh],
  ];
}

const cellCache = new Map<string, Map<string, Path2D>>();

/** Every segment path for a cell of the given kind and size, built once. */
function cellSegments(kind: CellKind, w: number, h: number): Map<string, Path2D> {
  const key = `${kind}:${w.toFixed(2)}:${h.toFixed(2)}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;

  const segs = new Map<string, Path2D>();
  const t = Math.max(1.3, Math.min(w, h) * 0.15);
  const hh = t / 2;
  const bev = hh;
  const top = hh;
  const bot = h - hh;
  const midY = h / 2;
  const left = hh;
  const right = w - hh;
  const midX = w / 2;
  const put = (name: string, pts: Pt[]): void => void segs.set(name, polyPath(pts));

  put("a", hbar(top, left, right, hh, bev));
  put("d", hbar(bot, left, right, hh, bev));
  put("f", vbar(left, top, midY, hh, bev));
  put("b", vbar(right, top, midY, hh, bev));
  put("e", vbar(left, midY, bot, hh, bev));
  put("c", vbar(right, midY, bot, hh, bev));

  if (kind === "seg7") {
    put("g", hbar(midY, left, right, hh, bev));
  } else {
    put("g1", hbar(midY, left, midX + hh * 0.2, hh, bev));
    put("g2", hbar(midY, midX - hh * 0.2, right, hh, bev));
    put("i", vbar(midX, top, midY, hh, bev));
    put("l", vbar(midX, midY, bot, hh, bev));
    put("h", diagBar([left, top], [midX, midY], hh));
    put("j", diagBar([right, top], [midX, midY], hh));
    put("k", diagBar([left, bot], [midX, midY], hh));
    put("m", diagBar([right, bot], [midX, midY], hh));
  }

  cellCache.set(key, segs);
  return segs;
}

const SEG7: Record<string, readonly string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "d", "c"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
  "-": ["g"],
  " ": [],
};

const SEG14: Record<string, readonly string[]> = {
  A: ["a", "b", "c", "e", "f", "g1", "g2"],
  B: ["a", "b", "c", "d", "g2", "i", "l"],
  C: ["a", "d", "e", "f"],
  D: ["a", "b", "c", "d", "i", "l"],
  E: ["a", "d", "e", "f", "g1"],
  F: ["a", "e", "f", "g1"],
  G: ["a", "c", "d", "e", "f", "g2"],
  H: ["b", "c", "e", "f", "g1", "g2"],
  I: ["a", "d", "i", "l"],
  J: ["b", "c", "d", "e"],
  K: ["e", "f", "g1", "j", "m"],
  L: ["d", "e", "f"],
  M: ["b", "c", "e", "f", "h", "j"],
  N: ["b", "c", "e", "f", "h", "m"],
  O: ["a", "b", "c", "d", "e", "f"],
  P: ["a", "b", "e", "f", "g1", "g2"],
  Q: ["a", "b", "c", "d", "e", "f", "m"],
  R: ["a", "b", "e", "f", "g1", "g2", "m"],
  S: ["a", "c", "d", "f", "g1", "g2"],
  T: ["a", "i", "l"],
  U: ["b", "c", "d", "e", "f"],
  V: ["e", "f", "k", "j"],
  W: ["b", "c", "e", "f", "k", "m"],
  X: ["h", "j", "k", "m"],
  Y: ["h", "j", "l"],
  Z: ["a", "d", "j", "k"],
  "0": ["a", "b", "c", "d", "e", "f", "j", "k"],
  "1": ["b", "c"],
  "2": ["a", "b", "d", "e", "g1", "g2"],
  "3": ["a", "b", "c", "d", "g2"],
  "4": ["b", "c", "f", "g1", "g2"],
  "5": ["a", "c", "d", "f", "g1", "g2"],
  "6": ["a", "c", "d", "e", "f", "g1", "g2"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g1", "g2"],
  "9": ["a", "b", "c", "d", "f", "g1", "g2"],
  " ": [],
  "-": ["g1", "g2"],
  "'": ["f"],
  "!": ["b", "c"],
  "?": ["a", "b", "g2", "l"],
  "*": ["g1", "g2", "h", "i", "j", "k", "l", "m"],
  "/": ["j", "k"],
  ".": ["l"],
  ":": ["g1", "g2"],
};

function cellWidth(kind: CellKind, h: number): number {
  return h * (kind === "seg7" ? 0.6 : 0.66);
}

/**
 * Draw one layer of a text spec. `onlyLit: false` fills every segment of every
 * cell (the ghost pass); `onlyLit: true` fills just the glyph segments. The
 * caller sets `fillStyle` and `globalAlpha` before calling.
 */
export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  spec: TextSpec,
  onlyLit: boolean,
): void {
  const h = spec.cell;
  const w = cellWidth(spec.kind, h);
  const gap = h * 0.26;
  const advance = w + gap;
  const chars = [...spec.text.toUpperCase()];
  const totalW = chars.length * advance - gap;

  let ox = spec.x;
  if (spec.align === "center") ox -= totalW / 2;
  else if (spec.align === "right") ox -= totalW;

  const table = spec.kind === "seg7" ? SEG7 : SEG14;
  const segs = cellSegments(spec.kind, w, h);

  for (const ch of chars) {
    ctx.save();
    ctx.translate(ox, spec.y);
    if (onlyLit) {
      const on = table[ch];
      if (on !== undefined) {
        for (const name of on) {
          const path = segs.get(name);
          if (path !== undefined) ctx.fill(path);
        }
      }
    } else {
      for (const path of segs.values()) ctx.fill(path);
    }
    ctx.restore();
    ox += advance;
  }
}
