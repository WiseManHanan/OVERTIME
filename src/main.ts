/*
 * Bootstrap: build the shell, size the two canvases, run the power-on self-test
 * once, then hand off to the fixed-step loop (doc §4.1).
 *
 * The loop is a requestAnimationFrame accumulator. It advances the simulation in
 * whole ticks and renders only when a tick actually landed — there is no
 * interpolation between ticks, ever (invariant 5). Motion is discrete by design.
 */
import { buildShell } from "./shell/shell";
import { createInput } from "./shell/input";
import { readPalette } from "./panel/colors";
import { PANEL_W, PANEL_H } from "./panel/dims";
import { renderPanel, type PanelView } from "./panel/render";
import { sceneFor } from "./panel/scene";
import { initialState } from "./sim/state";
import { step } from "./sim/step";
import type { Screen } from "./panel/types";

const BASE_TICK_MS = 140; // doc §4.1; Phase 2 has no speed table, multiplier = 1
const BOOT_MS = 300;
const MAX_DPR = 3;
const MAX_CATCHUP_TICKS = 8; // don't replay a backgrounded tab's worth of ticks

const mount = document.querySelector<HTMLElement>("#app");
if (mount === null) throw new Error("#app mount point missing from index.html");

const shell = buildShell(mount);
const pal = readPalette();
const input = createInput(shell);

let state = initialState(Date.now() >>> 0);

// Blink the cross-pad's LEFT/RIGHT until the first move (doc §9.3).
shell.dpad.left.classList.add("hint");
shell.dpad.right.classList.add("hint");
function clearHints(): void {
  shell.dpad.left.classList.remove("hint");
  shell.dpad.right.classList.remove("hint");
}

// Canvas size only changes on resize, so the layout read and the transform are
// done in `measureAll()` — at startup and on resize — never in the render path.
const ctxByCanvas = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();

function measure(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const rect = canvas.getBoundingClientRect();
  const pw = Math.max(1, Math.round(rect.width * dpr));
  const ph = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");
  ctx.setTransform(pw / PANEL_W, 0, 0, ph / PANEL_H, 0, 0);
  ctxByCanvas.set(canvas, ctx);
}

function measureAll(): void {
  measure(shell.upper);
  measure(shell.lower);
}

function ctxFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = ctxByCanvas.get(canvas);
  if (ctx === undefined) throw new Error("canvas painted before it was measured");
  return ctx;
}

function viewFor(screen: Screen): PanelView {
  const scene = sceneFor(state, screen);
  return { screen, lit: scene.lit, texts: scene.texts, contrast: 1 };
}

function paint(): void {
  renderPanel(ctxFor(shell.upper), viewFor("upper"), pal);
  renderPanel(ctxFor(shell.lower), viewFor("lower"), pal);
}

function paintSelfTest(): void {
  const test = (screen: Screen): PanelView => ({
    screen,
    lit: new Set(),
    texts: [],
    contrast: 1,
    selfTest: true,
  });
  renderPanel(ctxFor(shell.upper), test("upper"), pal);
  renderPanel(ctxFor(shell.lower), test("lower"), pal);
}

function startLoop(): void {
  let acc = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    acc += now - last;
    last = now;
    if (acc > BASE_TICK_MS * MAX_CATCHUP_TICKS) acc = BASE_TICK_MS * MAX_CATCHUP_TICKS;

    let dirty = false;
    while (acc >= BASE_TICK_MS) {
      acc -= BASE_TICK_MS;
      state = step(state, input.drain());
      dirty = true;
    }
    if (dirty) {
      if (state.started) clearHints();
      paint();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Power-on self-test: every segment on both panels lit for a beat, then the
// title state, then the loop. The one orchestrated motion moment (doc §9.1),
// skipped entirely under prefers-reduced-motion (doc §9.4).
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  requestAnimationFrame(() => {
    measureAll();
    paint();
    startLoop();
  });
} else {
  let start = 0;
  const boot = (now: number): void => {
    if (start === 0) {
      start = now;
      measureAll();
    }
    if (now - start < BOOT_MS) {
      paintSelfTest();
      requestAnimationFrame(boot);
    } else {
      paint();
      startLoop();
    }
  };
  requestAnimationFrame(boot);
}

let queued = 0;
window.addEventListener("resize", () => {
  window.cancelAnimationFrame(queued);
  queued = window.requestAnimationFrame(() => {
    measureAll();
    paint();
  });
});
