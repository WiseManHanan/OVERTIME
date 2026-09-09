/*
 * Shape -> Path2D compilation and cache.
 *
 * Each segment's shapes are compiled into a single Path2D once, keyed by segment
 * id. Per-frame work is then only `ctx.fill(path)` — no geometry rebuilt, no
 * allocation (doc §4.2).
 */
import type { Seg, Shape } from "./types";

function tracePoly(path: Path2D, pts: readonly [number, number][]): void {
  pts.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
}

export function shapeToPath(shape: Shape): Path2D {
  const p = new Path2D();
  switch (shape.k) {
    case "rect":
      p.rect(shape.x, shape.y, shape.w, shape.h);
      break;
    case "poly":
      tracePoly(p, shape.pts);
      break;
    case "circle":
      p.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      break;
    case "arc": {
      // Annular sector: out along the outer radius, back along the inner.
      const ro = shape.r + shape.w / 2;
      const ri = Math.max(0, shape.r - shape.w / 2);
      p.arc(shape.cx, shape.cy, ro, shape.a0, shape.a1);
      p.arc(shape.cx, shape.cy, ri, shape.a1, shape.a0, true);
      p.closePath();
      break;
    }
  }
  return p;
}

const cache = new Map<string, Path2D>();

/** Compiled union of a segment's shapes, built once and reused. */
export function pathForSeg(seg: Seg): Path2D {
  let path = cache.get(seg.id);
  if (path === undefined) {
    path = new Path2D();
    for (const shape of seg.shapes) path.addPath(shapeToPath(shape));
    cache.set(seg.id, path);
  }
  return path;
}

/** Drop compiled paths — call when the atlas is rebuilt (tests, hot reload). */
export function clearPathCache(): void {
  cache.clear();
}
