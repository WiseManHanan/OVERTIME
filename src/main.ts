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
import { initInfoPanel } from "./shell/infoPanel";
import { readPalette } from "./panel/colors";
import { PANEL_W, PANEL_H } from "./panel/dims";
import { renderPanel, type PanelView } from "./panel/render";
import { sceneFor } from "./panel/scene";
import { initialState, type GameState } from "./sim/state";
import { step } from "./sim/step";
import { roundParams } from "./sim/rounds";
import { clockParams, effectiveRound, resolveClock } from "./sim/clock";
import { batteryContrast, batteryDetune, isBlackoutTick } from "./sim/battery";
import { effectsFor } from "./sim/grievance";
import { stewardMood } from "./sim/scoring";
import { createBeeper, type Cue } from "./audio/beeper";
import { loadMute, saveMute } from "./store/persist";
import type { Screen } from "./panel/types";

// Base tick at round-1 speed (~5.9 logical updates/sec). The round speed table
// (doc §6.1) divides this; nothing else sets the pace.
const BASE_TICK_MS = 170;
const BOOT_MS = 300;
const MAX_DPR = 3;
const MAX_CATCHUP_TICKS = 8; // don't replay a backgrounded tab's worth of ticks

const mount = document.querySelector<HTMLElement>("#app");
if (mount === null) throw new Error("#app mount point missing from index.html");

const shell = buildShell(mount);
const pal = readPalette();
const input = createInput(shell);
initInfoPanel(); // the "how to play" link, below the shell (doc §3.3)

// Audio (doc §4.5). The simulation stays silent; sound is main.ts diffing one
// GameState against the next and firing the matching cue on the single voice.
const beeper = createBeeper(loadMute());
shell.root.classList.toggle("muted", beeper.muted);

// WebAudio must be unlocked by a user gesture; the first key or pointer does it.
const unlock = (): void => beeper.resume();
window.addEventListener("keydown", unlock, { once: true });
window.addEventListener("pointerdown", unlock, { once: true });

// Mute toggle, persisted to localStorage (doc §4.5). M, or the speaker grille.
function toggleMute(): void {
  const next = !beeper.muted;
  beeper.setMuted(next);
  saveMute(next);
  shell.root.classList.toggle("muted", next);
}
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") toggleMute();
});
shell.root.querySelector(".speaker")?.addEventListener("pointerdown", toggleMute);

// Cues worth hearing, most urgent first — the monophonic voice plays one a tick.
const CUE_PRIORITY: readonly Cue[] = [
  "miss",
  "roundClear",
  "bolt",
  "nearMiss",
  "bell",
  "jump",
  "step",
];

function cuesBetween(prev: GameState, next: GameState): Set<Cue> {
  const c = new Set<Cue>();
  if (next.pip.pose === "jump" && prev.pip.pose !== "jump") c.add("jump");
  else if (next.pip.pose === "walk" && next.pip.slot !== prev.pip.slot) c.add("step");
  if (next.nearMisses > prev.nearMisses) c.add("nearMiss");
  if (next.misses > prev.misses) c.add("miss");
  if (next.bolts.some((b, i) => b && prev.bolts[i] !== true)) c.add("bolt");
  if (next.phase === "cleared" && prev.phase !== "cleared") c.add("roundClear");
  const mood = (s: GameState): string => stewardMood(s.boredom, s.stewardAsleep);
  if (mood(next) === "bell" && mood(prev) !== "bell") c.add("bell");
  return c;
}

// The monophonic voice plays one cue per rendered frame — the most urgent thing
// that happened across however many ticks the frame advanced. A refocused tab
// catching up eight ticks still gets a single beep, not a burst.
function playFirst(cues: ReadonlySet<Cue>): void {
  for (const cue of CUE_PRIORITY) {
    if (cues.has(cue)) {
      beeper.play(cue);
      return;
    }
  }
}

// Cheat: ?round=N starts play at round N instead of round 1 — for playtesting
// a specific round's tuning without climbing there first (e.g. chairs' speed
// ramp, or the battery, both round-gated). Any junk or missing value is round 1.
function debugStartRound(): number {
  const raw = new URLSearchParams(window.location.search).get("round");
  const n = raw === null ? 1 : Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// A run starts with the wall clock read once (doc §7.1) — resolved here, never
// inside step().
function freshRun(): GameState {
  return initialState(Date.now() >>> 0, resolveClock(new Date()), debugStartRound());
}
let state = freshRun();

// Blink the cross-pad's LEFT/RIGHT in the title state (doc §9.3). Driven by the
// phase, so it comes back on a restart after GAME OVER.
function syncHints(): void {
  const inTitle = state.phase === "title";
  shell.dpad.left.classList.toggle("hint", inTitle);
  shell.dpad.right.classList.toggle("hint", inTitle);
  // NIGHT: the strip is the only readout of the noise meter, so it has to say
  // whether sneaking is still working (doc §7.1).
  const label = clockParams(state.clock).label;
  shell.statusStrip.textContent =
    state.clock === "night" && state.phase === "playing"
      ? `${label} · ${state.nightWoken ? "AWAKE" : "QUIET"}`
      : label;
}
syncHints();

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
  // GAME OVER is a bare readout (scene.ts) — the "over" trap state keeps
  // ticking forever with no input, so a blackout tick must never land on it
  // and hide the final score.
  const blackout = state.phase !== "over" && isBlackoutTick(state.battery, state.tick);
  return {
    screen,
    lit: scene.lit,
    texts: scene.texts,
    contrast: batteryContrast(state.battery),
    blackout,
    hideBackdrop: state.phase === "mediation",
  };
}

function paint(): void {
  // The failing console tints the whole shell as it sags (doc §7.3).
  shell.root.classList.toggle("dying", state.battery > 0 && state.battery < 0.3);
  shell.root.classList.toggle("dead", state.phase === "over" && state.battery <= 0);
  beeper.setDetune(batteryDetune(state.battery));
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

    // The round speed table (doc §6.1), the time-of-day mode (doc §7.1), and
    // Overtime Pay's speed concession (doc §7.2) all scale the tick rate, not
    // the sim. Once NIGHT's noise meter has woken Bruno, effectiveRound reads
    // the same "one round harder" the hazard and swipe cadences already do
    // (step.ts), so the whole round speeds up too.
    const round = effectiveRound(state.round, state.clock, state.nightWoken);
    const tickMs =
      BASE_TICK_MS /
      (roundParams(round).speed *
        clockParams(state.clock).speed *
        effectsFor(state.concessions).speedMult);
    if (acc > tickMs * MAX_CATCHUP_TICKS) acc = tickMs * MAX_CATCHUP_TICKS;

    let dirty = false;
    const cues = new Set<Cue>();
    while (acc >= tickMs) {
      acc -= tickMs;
      const action = input.drain();
      const buttonA = input.consumeButtonA();
      const prev = state;
      if (state.phase === "over" && buttonA) {
        state = freshRun(); // a fresh seeded run, clock re-read
      } else {
        state = step(state, action);
        for (const c of cuesBetween(prev, state)) cues.add(c);
      }
      dirty = true;
    }
    if (dirty) {
      playFirst(cues);
      syncHints();
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
