/*
 * Bootstrap for Phase 1: build the shell, size the two canvases, run the
 * power-on self-test once, and draw a single static "title" frame.
 *
 * There is no simulation yet. Phase 2 replaces the static draw with the
 * fixed-step accumulator loop (doc §4.1): render only when a tick has advanced,
 * never interpolate.
 */
import { buildShell } from "./shell/shell";
import { readPalette } from "./panel/colors";
import { PANEL_W, PANEL_H } from "./panel/dims";
import { renderPanel, type PanelView } from "./panel/render";
import type { TextSpec } from "./panel/text";

const BOOT_MS = 300;
const MAX_DPR = 3;

const mount = document.querySelector<HTMLElement>("#app");
if (mount === null) throw new Error("#app mount point missing from index.html");

const shell = buildShell(mount);
const pal = readPalette();

// Fixed stand-in state until the simulation exists.
const litUpper: ReadonlySet<string> = new Set(["bolt.s1", "bolt.s5", "pip.f4.s6.stand"]);
const litLower: ReadonlySet<string> = new Set(["pip.f1.s3.stand"]);

const upperTexts: readonly TextSpec[] = [
  { text: "0", x: PANEL_W - 10, y: 14, cell: 11, kind: "seg7", align: "right" },
];
const lowerTexts: readonly TextSpec[] = [
  { text: "OVERTIME", x: PANEL_W / 2, y: 7, cell: 13, kind: "seg14", align: "center" },
  { text: "MOVE TO START", x: PANEL_W / 2, y: 29, cell: 7, kind: "seg14", align: "center" },
];

function viewFor(screen: "upper" | "lower", selfTest: boolean): PanelView {
  return screen === "upper"
    ? { screen, lit: litUpper, texts: upperTexts, contrast: 1, selfTest }
    : { screen, lit: litLower, texts: lowerTexts, contrast: 1, selfTest };
}

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const rect = canvas.getBoundingClientRect();
  const pw = Math.max(1, Math.round(rect.width * dpr));
  const ph = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");
  ctx.setTransform(pw / PANEL_W, 0, 0, ph / PANEL_H, 0, 0);
  return ctx;
}

function paint(selfTest: boolean): void {
  renderPanel(contextFor(shell.upper), viewFor("upper", selfTest), pal);
  renderPanel(contextFor(shell.lower), viewFor("lower", selfTest), pal);
}

// Power-on self-test: every segment on both panels lit briefly, then the title
// (doc §9.1). The one orchestrated motion moment on the page (doc §3.4). The
// first paint is deferred a frame so canvas layout is settled before measuring.
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  requestAnimationFrame(() => paint(false));
} else {
  let start = 0;
  const step = (now: number): void => {
    if (start === 0) start = now;
    const testing = now - start < BOOT_MS;
    paint(testing);
    if (testing) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let queued = 0;
window.addEventListener("resize", () => {
  window.cancelAnimationFrame(queued);
  queued = window.requestAnimationFrame(() => paint(false));
});
