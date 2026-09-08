# CLAUDE.md — OVERTIME

Context for Claude Code sessions. The full spec is `OVERTIME-design-doc.md`; this
file is the short list of things that break silently when ignored.

## What this is

A web reconstruction of a 1982 dual-screen LCD handheld, running an original
arcade game (climb a scaffold, dodge what the foreman throws, release four bolts)
with a labor-dispute comedy layer, real-clock awareness, and a failing-hardware
endgame. Portfolio showcase: **vanilla TypeScript, Vite, Canvas 2D. No framework,
no engine, no WebGL, zero runtime dependencies.**

## Core invariants — enforce these

1. **`step()` is pure.** No `Date.now()`, no `Math.random()`, no DOM access.
   Clock mode and seed are resolved once at run start and stored as fields of
   `GameState`. This is what makes the daily seed and share string trustworthy.
2. **All randomness flows through the seeded RNG in state** (`mulberry32`). A run
   is fully reproducible from `(seed, inputLog)`.
3. **The renderer never mutates state.** `render(state)` is read-only.
4. **No position is fractional.** Slots and floors are integers. A float in a
   position field is a bug.
5. **No `setTimeout` drives gameplay.** Everything is tick-counted. The only
   loop is the `requestAnimationFrame` fixed-step accumulator; rendering happens
   only when a tick advanced, with no interpolation between ticks.
6. **The five-step render order (doc §4.3) is fixed:** (1) fill `--lcd-bg`,
   (2) printed backdrop, (3) *every* segment in the atlas at `--ghost`,
   (4) the lit subset at `--segment`, (5) battery contrast modifier on step 4
   only. Any new visual element is classified as **printed backdrop** or
   **segment** — segments must be added to the atlas so they ghost correctly.

## Notes for the implementing session (doc §12)

- The five-step render order is the most commonly broken thing when adding
  features. If a viewer can see the ghost of the pose Pip is about to be in, the
  effect is working.
- Resist every instinct toward smooth motion. Interpolation, easing, tweening,
  and sub-slot positioning all destroy the effect and are the primary risk to
  this project. Motion is discrete by design.
- `step()` purity is what makes the daily seed work. If a feature seems to need
  the wall clock or real randomness mid-run, resolve it at run start into state.
- Tune Phase 4 (boredom meter, near-miss scoring) before building Phase 5
  (comedy systems). Comedy layered onto a game that is not fun yet will not save
  it, and the boredom meter is the mechanic the whole difficulty design hangs on.
- Write Bruno's grievances as sincere and reasonable. The comedy fails the
  moment he becomes a joke character rather than a person with a point.

## No third-party IP

No Nintendo characters, names, likenesses, or copied artwork. The reference point
is the *hardware* — segment LCD, printed backdrop, beige clamshell — which is a
public visual language. All characters, art, and naming are original.

## Layout

```
overtime/
├─ index.html
├─ vite.config.ts          base: '/OVERTIME/' for GitHub Pages
├─ src/
│  ├─ main.ts              bootstrap, rAF loop, canvas sizing
│  ├─ sim/                 pure simulation: state, step, hazards, collision,
│  │                       scoring, rounds, grievance, battery, clock, rng
│  ├─ panel/               atlas, backdrop, render, text (7/14-seg), paths
│  ├─ shell/               clamshell DOM/CSS, input (keyboard/pointer/buffer)
│  ├─ audio/               single-voice square synth
│  └─ store/               localStorage: scores, asterisks, mute, daily
└─ tests/                  determinism, collision, scoring
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run preview` | serve the built `dist/` |
| `npm test` | Vitest run (pure sim tests, node env) |
| `npm run test:watch` | Vitest watch |
| `npm run typecheck` | `tsc --noEmit` |

## Build phases

1. **The panel** — scaffold, two canvases, CSS shell, `Shape`→`Path2D`, the
   five-step render order, ghost segments, 7/14-seg text renderer.
2. **The tick and Pip** — fixed-step loop, input buffering at tick boundaries,
   Pip's pose atlas, movement, ladders, jump, duck.
3. **Core game** — barrels, slot collision, misses, bolts, round clear, speed
   table, score, game over.
4. **Feel** — audio, near-miss scoring, boredom meter, the Steward. *Tune here.*
5. **Comedy systems** — clock modes, grievance interludes, low battery, bits.
6. **Ship** — seeded RNG + daily mode, share string, localStorage, determinism
   tests, mobile touch, reduced motion, contrast toggle, Pages deploy.

Do not begin a phase before the previous one's checkpoint is met.
