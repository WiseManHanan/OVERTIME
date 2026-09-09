# OVERTIME — Design & Implementation Specification

**Model WW-52 · "Work & Watch" · Wide Screen Multi Screen**

A web reconstruction of the 1982 dual-screen LCD handheld form factor, running an original game with a labor-dispute comedy layer, real-clock awareness, and a failing-hardware endgame.

Target: a portfolio showcase demonstrating game development with zero engine dependency. Vanilla TypeScript, Vite, Canvas 2D, no framework, no Unity, no WebGL.

---

## 1. Scope and non-goals

### In scope
- A complete, replayable arcade game running in any modern browser, desktop and mobile.
- A faithful simulation of segment-based LCD rendering, not a pixel-art pastiche.
- Three comedy systems that also function as difficulty systems.
- Deterministic, seeded simulation supporting a daily challenge and shareable results.

### Explicitly not in scope
- No Nintendo characters, names, likenesses, or copied artwork. All characters, art, and naming are original. The reference point is the *hardware* — segment LCD, printed backdrop, beige clamshell — which is a public visual language.
- No physics engine, no sprite interpolation, no particle systems. Motion is discrete by design.
- No backend. No accounts. No analytics. Static hosting only.
- No 3D, no WebGL, no canvas filters that require GPU compositing.

### Definition of done
A stranger opens a URL on a phone, understands the controls within five seconds, plays a 90-second round, laughs at least once, and can tell it was not made in a game engine only because the source is on GitHub.

---

## 2. The premise

You are **PIP**, a maintenance worker on a scaffold tower, climbing four floors to reach **MARA** at the top.

**BRUNO**, the site foreman — a gorilla in a hi-vis vest — is throwing things down at you. He is not evil. He has a grievance, and it is arguably valid. He will explain it at length.

**THE STEWARD**, a small union rep with a bell and a clipboard, stands at the side of the lower screen and comments on your performance. He is bored by cautious play and says so.

Mara is at the top and is not in danger. Mara is on the phone. Mara rates your climbing attempts out of ten.

To clear a round, Pip reaches the top floor and releases the four bolts holding Bruno's platform. Bruno falls, lands in a skip, dusts himself off, and files a complaint.

---

## 3. Visual direction

The design brief here is fixed by the subject matter, so follow it exactly rather than treating any axis as free.

### 3.1 Palette

| Token | Hex | Use |
|---|---|---|
| `--shell` | `#D8D2C4` | Clamshell plastic body |
| `--shell-shadow` | `#A9A292` | Shell bevels, button wells, hinge |
| `--lcd-bg` | `#9BAE8C` | Unlit LCD panel field (the greenish-grey of a 1982 TN panel) |
| `--segment` | `#2B2E27` | Lit segment |
| `--ghost` | `#2B2E27` at `alpha 0.08` | Unlit segment — always drawn |
| `--print-red` | `#C1443A` | Printed backdrop: scaffold poles, hazard stripes |
| `--print-blue` | `#3E6C9B` | Printed backdrop: sky band, water tank |
| `--print-yellow` | `#D9A441` | Printed backdrop: warning chevrons, Steward's bell |

Two hard rules. Every unlit segment is visible at ghost alpha at all times — this single trait is what makes an LCD panel recognizable and it is the most commonly skipped detail. And no game state is ever communicated by hue alone; the panel is functionally monochrome, and printed color is decoration behind it. Everything remains legible under any color vision.

### 3.2 Type

Two faces, sharply distinct in role.

- **Shell silkscreen and console labels**: a condensed grotesque, letter-spaced, set small. This is the printed-on-plastic voice — model numbers, GAME A / GAME B / TIME, brand mark. Use `Oswald` or `Archivo Narrow` via a self-hosted woff2.
- **On-panel text** (score, messages, Steward dialogue): a segment-derived face. Do not use a webfont here. Render text using the same 7-segment and 14-segment cell renderer used for the score, so on-panel text is physically constrained to what the hardware could display. Lowercase is impossible on a 14-segment cell; embrace that. Comedy dialogue rendered in stubby 14-segment capitals is funnier than the same words in a font.

Avoid the tracked-out all-caps eyebrow label pattern in the surrounding page chrome. The console itself is the hero; the page around it needs almost nothing.

### 3.3 Layout

The page is one object on a plain background. No hero band, no feature cards, no marketing section.

```
┌──────────────────────────────────────┐
│                                      │
│        ╔══════════════════╗          │
│        ║  ┌────────────┐  ║          │   upper LCD  (floors 3–4, Bruno, Mara)
│        ║  │            │  ║          │
│        ║  └────────────┘  ║          │
│        ║  ═══ hinge ═══   ║          │
│        ║  ┌────────────┐  ║          │   lower LCD  (floors 1–2, Steward)
│        ║  │            │  ║          │
│        ║  └────────────┘  ║          │
│        ║  ⊕      ●  ●     ║          │   d-pad · A · mode
│        ║   WW-52 OVERTIME ║          │   silkscreen
│        ╚══════════════════╝          │
│                                      │
│   how to play · source · daily seed  │   one quiet line of plain links
└──────────────────────────────────────┘
```

Centered, single column, shell scales to viewport height on desktop and viewport width on mobile. Below 480px the shell fills the screen and the physical buttons become the touch targets — do not add a separate mobile control overlay.

### 3.4 Motion

There is exactly one continuous motion source: the logical tick. Nothing eases, nothing tweens, nothing fades. A segment is on or off. The only non-tick motion permitted anywhere is the shell's initial appearance on page load, and the LCD warm-up flash described in §9.1.

---

## 4. Hardware simulation model

This section is the heart of the project. Get it right and everything else reads as authentic.

### 4.1 The tick

```ts
const BASE_TICK_MS = 140;          // ~7.1 logical updates per second
tickMs = BASE_TICK_MS / speedMultiplier;
```

The render loop runs on `requestAnimationFrame` with a fixed-step accumulator, but **rendering only occurs when a tick has advanced**. There is no interpolation between ticks. If you find yourself computing a fractional position, the model is wrong.

```ts
let acc = 0, last = performance.now();
function frame(now: number) {
  acc += now - last; last = now;
  let dirty = false;
  while (acc >= tickMs) { acc -= tickMs; state = step(state, drainInput()); dirty = true; }
  if (dirty || state.forceRedraw) render(state);
  requestAnimationFrame(frame);
}
```

### 4.2 Segments

An entity is not a sprite that moves. It is a **set of pre-manufactured segments, of which some subset is lit**. Pip at floor 1 slot 3 is a different physical segment from Pip at floor 1 slot 4.

Segments are defined declaratively in `src/panel/atlas.ts` as parametric primitives — no external image assets, no artist required:

```ts
type Seg = {
  id: string;                  // "pip.f1.s3.stand"
  screen: "upper" | "lower";
  shapes: Shape[];             // composed of rect | poly | circle | arc
};
type Shape =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "poly"; pts: [number, number][] }
  | { k: "circle"; cx: number; cy: number; r: number }
  | { k: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; w: number };
```

Coordinates are in a virtual panel space of `160 × 96` per screen, scaled at draw time. Build each `Shape` into a `Path2D` once at startup and cache it; per-frame work is then only `fill()` calls.

Character segments should be built from a small vocabulary of chunky quadrilaterals with slightly angled edges — the way real segment art looks, with visible seams between limb segments and no curves under about 3 units. A Pip pose is roughly 9 shapes: helmet, head, torso, two arm segments, two leg segments, two boots.

### 4.3 Render order

Every frame, in this order, no exceptions:

1. Fill panel with `--lcd-bg`.
2. Draw the **printed backdrop** — static vector art in `--print-red` / `--print-blue` / `--print-yellow`. Scaffold poles, floor plates, ladders, the skip at the bottom, warning chevrons, a sky band on the upper screen. Never animated, never occluded.
3. Draw **every segment in the atlas** for that screen at `--ghost`.
4. Draw the **lit subset** at `--segment`.
5. Apply the battery contrast modifier (§7.3) as a global alpha reduction on step 4 only.

If a viewer can see the ghost of the pose Pip is about to be in, the effect is working.

### 4.4 Input

Cross-pad (4 directions) plus one **A** button, plus **GAME A / GAME B / TIME** mode buttons on the shell. That is the entire hardware. Any mechanic requiring a fifth input is out of scope.

Input is captured to a one-slot buffer and consumed at the next tick boundary. This produces a natural sub-140ms response lag which is *correct* — the real hardware had it, and removing it makes the game feel like a modern platformer wearing a costume.

Keyboard: arrows or WASD, Space or Z for A, keys 1/2/3 for the mode buttons. Touch: the drawn shell buttons are the hit targets, with `touch-action: none` and pointer events.

### 4.5 Audio

WebAudio, one square-wave oscillator voice, one gain node with a hard ~40ms envelope. No filters, no reverb, no samples, no polyphony. A "chord" is achieved by rapid arpeggiation, as on the original hardware. Frequencies in a narrow 400–2000Hz band.

Sound events: step, jump, near-miss (rising blip), bolt release, miss (descending three-note), round clear (six-note fanfare), Steward bell, low-battery detune (all frequencies multiplied by `0.94 + 0.06 * battery`).

Audio must be initialized on first user gesture and must respect a mute toggle persisted to localStorage.

---

## 5. Game world and mechanics

### 5.1 Grid

Both screens use discrete `(floor, slot)` addressing. Nothing exists between slots.

| Screen | Floor | Slots | Notes |
|---|---|---|---|
| Lower | 1 | 0–9 | Ground. Ladder to floor 2 at slot 9. Steward occupies the left margin, outside the play grid. |
| Lower | 2 | 0–9 | Gap at slots 4–5 that must be jumped. Ladder to floor 3 at slot 0. |
| Upper | 3 | 0–9 | Moving platform section: slots 3–6 shift one slot left/right on a 6-tick cycle. Ladder to floor 4 at slot 9. |
| Upper | 4 | 0–9 | Bolt stations at slots 1, 3, 5, 7. Bruno's platform above slots 4–8. Mara at slot 0, off-grid. |

### 5.2 Verbs

| Input | Effect |
|---|---|
| LEFT / RIGHT | Move one slot. Blocked by gaps and screen edges. |
| UP | Climb a ladder if standing on a ladder slot. Release a bolt if standing on a bolt station. |
| DOWN | On a down-ladder slot, descend one floor. Otherwise duck: same slot, immune to *high* hazards, cannot move while ducked. (Ladders run both ways; you cannot duck while standing on a down-ladder slot.) |
| A | Jump. Airborne for 2 ticks, traveling one slot in the current facing direction, immune to *low* hazards for both ticks. |

### 5.3 Collision

Slot occupancy, never geometry.

```ts
const hit = h.floor === p.floor
  && h.slot === p.slot
  && !(p.airborne && h.height === "low")
  && !(p.ducked   && h.height === "high");
```

A **near miss** is scored when a hazard occupies the slot Pip vacated on the immediately preceding tick, or passes beneath Pip while airborne. Near misses are the primary source of points, which is how the game escapes the original's problem of optimal play being slow and boring.

### 5.4 Hazards

Hazards spawn at Bruno's slot on floor 4 and descend one floor at a time, traveling along each floor at one slot per tick. Spawn cadence is set by the round speed table.

| Hazard | Height | Behavior |
|---|---|---|
| Barrel | low | Rolls straight. The baseline. |
| Coffee cup | low | Rolls, then leaves a slick slot for 8 ticks; entering it carries Pip one extra slot in his direction of travel. |
| Office chair | high | Rolls fast (2 slots/tick). Must be ducked, cannot be jumped. |
| Roomba | low | Rolls, reverses direction once at a random slot, then continues. |
| Filing cabinet | low | Occupies two adjacent slots. Jumping it requires starting from two slots away. |
| Sofa | both | Fills an entire floor's width. Only survivable by being on a ladder. Announced one tick early by a Steward bell. |

Hazard type is unlocked by round: barrels from round 1, coffee cups from 2, chairs from 3, Roomba from 4, cabinet from 5, sofa from 6 and thereafter at most once per round.

### 5.5 Bolts and round clear

Standing on a bolt station and pressing UP begins a 3-tick release animation during which Pip cannot move. Bruno swipes at floor 4 on a fixed cadence (every 9 ticks at round 1, decreasing); being swiped costs a miss and resets that bolt.

All four bolts released → Bruno's platform drops → round clear.

### 5.6 Misses and continues

Three misses ends the run. The Steward then offers a continue at a price, and the price is the joke. Each accepted continue appends an asterisk to the final score, permanently, visibly, and in the share string.

1. *"Sign here. It's nothing."*
2. *"Sign here, and here. It's mostly nothing."*
3. *"You are now technically a contractor."*

Maximum three continues.

---

## 6. Difficulty and run structure

The original's flaw is that its optimal strategy is patience. Every system below exists to punish patience.

### 6.1 Speed table

| Round | Speed multiplier | Hazard cadence (ticks) | Bruno swipe (ticks) |
|---|---|---|---|
| 1 | 1.00 | 14 | 9 |
| 2 | 1.10 | 12 | 9 |
| 3 | 1.20 | 11 | 8 |
| 4 | 1.32 | 10 | 8 |
| 5 | 1.45 | 9 | 7 |
| 6 | 1.60 | 8 | 7 |
| 7+ | ×1.10 per round, capped at 2.60 | min 6 | min 5 |

### 6.2 The boredom meter

The Steward tracks risk. The meter fills while Pip idles, stands in a slot no hazard can reach, or takes more than 20 ticks to change floor. It empties on near misses, bolt releases, and floor changes.

- Meter below 33%: score multiplier ×1.5, Steward rings his bell approvingly.
- Meter 33–66%: multiplier ×1.0.
- Meter above 66%: multiplier ×0.25, Steward visibly checks his watch.
- Meter full: Steward falls asleep. **No points are awarded at all** until it drains below 66%.

This is the single most important anti-camping mechanic and it must be tuned before anything else feels right.

### 6.3 Round modifiers

At round start, the seeded RNG draws one modifier. It is announced on the lower screen in 14-segment capitals for 12 ticks.

| Modifier | Effect |
|---|---|
| `DEAD COLUMN` | One slot column's segments never light. Pip is invisible while standing in it. |
| `CAFFEINATED` | Bruno's swipe cadence halves, hazard cadence unchanged. |
| `GREASED` | All floors behave as slick (see coffee cup). |
| `DOUBLE BOLTS` | Eight bolt stations instead of four, but round-clear points double. |
| `STICKY PAD` | Input buffer delay increases to 2 ticks. |
| `SILENT RUNNING` | Audio muted; the Steward mimes his commentary instead. |
| `NIGHT SHIFT` | Panel contrast drops 40%. Only lit segments in Pip's current floor render at full. |

### 6.4 Daily seed

The RNG is `mulberry32`, seeded from `YYYYMMDD` for daily mode or `Date.now()` for free play. Same date, same modifier sequence, same hazard pattern, worldwide.

Result string, copyable, deliberately ASCII rather than emoji so it reads as console output:

```
WW-52 OVERTIME  ·  2026-09-08
ROUND 7  ·  12,480**  ·  NEAR MISS x41
[####------]  BATTERY
```

---

## 7. The three comedy systems

Each one is simultaneously a joke and a mechanic. If a joke does not change how the game plays, cut it.

### 7.1 Clock awareness

Read the actual system clock at run start. This is the feature most likely to make a player stop and say *wait, how did it know*, and it costs almost nothing to build.

| Local time | Mode | Effect |
|---|---|---|
| 00:00–05:59 | `NIGHT` | Bruno is asleep. No hazards, but a noise meter fills when Pip moves two ticks in a row. Full meter wakes him and the round starts properly at +1 round of difficulty. Clearing before he wakes doubles the score. |
| 06:00–08:59 | `MORNING` | All barrels are coffee cups. Bruno is slow for the first 30 ticks. |
| 09:00–12:59 | `STANDARD` | Baseline. |
| 13:00–13:59 | `LUNCH` | Bruno is absent for the first 60 ticks — the upper screen just shows him eating. Mara orders delivery; a courier hazard climbs *upward* through the floors during this window. |
| 14:00–17:59 | `SLUMP` | Speed ×0.9, but the boredom meter fills 60% faster. Everyone wants this over with. |
| 18:00–23:59 | `OVERTIME` | Speed ×1.25, all points doubled, battery depletion begins two rounds earlier. |

Mode is displayed on the shell's small status strip. `TIME` mode on the console shows a real working clock with the characters idling — Bruno checks his watch, Mara scrolls, the Steward polishes his bell.

### 7.2 Grievance interludes

After rounds 2, 4, 6, and every third round after, Bruno stops mid-round, sits down on his platform, folds his arms, and the game enters a mediation screen. Play is paused. The Steward presents three concession cards; the player picks one with LEFT/RIGHT and A.

Every card is a genuine trade-off — a benefit to Pip paired with a buff to Bruno. There is no correct answer, which is both the joke and the difficulty curve.

| Concession | You gain | Bruno gains |
|---|---|---|
| Longer breaks | Bruno pauses 20 ticks each round | He throws two hazards at a time when active |
| Ergonomic assessment | Pip's jump covers two slots | Bruno's swipe reaches one slot further |
| Overtime pay | All points ×1.4 | Speed +15% |
| Safety railing | The floor-2 gap is closed | Ladders take two ticks to climb |
| Training budget | One extra miss allowed this run | Bolts take 5 ticks to release |
| Recognition programme | Near-miss bonus ×2 | Bruno gets visibly emotional and unpredictable — swipe cadence randomizes ±3 ticks |

Cards already taken are removed from the pool. Bruno's grievance text escalates in specificity across interludes and should be written as genuinely reasonable complaints delivered with total sincerity. The comedy is in his being *right*.

### 7.3 Low battery

From round 6 in standard mode, or round 4 in `OVERTIME`, the console begins to die.

```ts
battery -= 0.14;                        // per round
battery += clearedFloorWithoutMiss ? 0.05 : 0;   // capped at 1.0
```

As battery falls:
- **Below 0.75** — lit segments render at `0.85` alpha. Audio detunes.
- **Below 0.50** — one random segment per screen becomes **stuck**: permanently lit or permanently dark for the rest of the round. If it is one of Pip's, Pip is partially invisible in that pose.
- **Below 0.30** — the whole panel flickers off for a single tick roughly every 40 ticks. The simulation continues during the blackout.
- **At 0.00** — the console dies. Score stands. The shell dims. This is a legitimate way to end a run.

This is a difficulty mechanic that attacks *information* rather than reflexes, which is more interesting than raising speed again and is the correct escalation for a game about failing infrastructure.

### 7.4 Recurring bits

Small, cheap, high return:

- **Mara's ratings.** After every miss, a number 1–10 appears near her in 7-segment. She is a harsh but fair judge. A 10 is possible and rare.
- **The east lift.** From round 5, a printed lift shaft appears on the backdrop with a working call button that never arrives. On round 10, it arrives. It goes down.
- **Segment awareness.** Roughly once per 400 ticks, the wrong Pip segment lights for one tick — an arm where a leg should be. Pip's next pose includes a brief shake. Never twice within 200 ticks. This should feel like a glitch the player is not sure they saw.

---

## 8. Architecture

### 8.1 Files

```
overtime/
├─ index.html
├─ vite.config.ts                 base: '/overtime/' for GitHub Pages
├─ CLAUDE.md                      context file for Claude Code sessions
├─ src/
│  ├─ main.ts                     bootstrap, rAF loop, canvas sizing
│  ├─ sim/
│  │  ├─ state.ts                 GameState type, initial state factory
│  │  ├─ step.ts                  pure reducer: (state, input) => state
│  │  ├─ hazards.ts               spawn table, per-type movement rules
│  │  ├─ collision.ts             slot-occupancy checks, near-miss detection
│  │  ├─ scoring.ts               points, boredom meter, multipliers
│  │  ├─ rounds.ts                speed table, modifier draw, round lifecycle
│  │  ├─ grievance.ts             card pool, selection, applied effects
│  │  ├─ battery.ts               depletion, stuck segments, blackouts
│  │  ├─ clock.ts                 time-of-day mode resolution
│  │  └─ rng.ts                   mulberry32, daily seed derivation
│  ├─ panel/
│  │  ├─ atlas.ts                 segment definitions (the largest file)
│  │  ├─ backdrop.ts              printed vector art, per screen
│  │  ├─ render.ts                the five-step draw order
│  │  ├─ text.ts                  7-seg and 14-seg cell renderer
│  │  └─ paths.ts                 Shape → Path2D compilation and cache
│  ├─ shell/
│  │  ├─ shell.ts                 clamshell DOM/CSS, button hit regions
│  │  └─ input.ts                 keyboard, pointer, buffer, mode buttons
│  ├─ audio/
│  │  └─ beeper.ts                single-voice square synth
│  └─ store/
│     └─ persist.ts               localStorage: scores, asterisks, mute, daily
└─ tests/
   ├─ determinism.test.ts
   ├─ collision.test.ts
   └─ scoring.test.ts
```

### 8.2 Core invariants

These are the constraints that make the project reviewable as engineering work rather than as a toy. State them in `CLAUDE.md` and enforce them.

1. **`step()` is pure.** No `Date.now()`, no `Math.random()`, no DOM access. Clock mode and seed are resolved once at run start and passed in as fields of the state. This makes the whole simulation testable and replayable.
2. **All randomness flows through the seeded RNG in state.** A run is fully reproducible from `(seed, inputLog)`.
3. **The renderer never mutates state.** `render(state)` is read-only.
4. **No position is fractional.** Slots and floors are integers. If a float appears in a position field, it is a bug.
5. **No `setTimeout` drives gameplay.** Everything is tick-counted.

### 8.3 Determinism test

```ts
// tests/determinism.test.ts
const inputs = generateInputLog(5000, seededRng(12345));
const a = replay(initialState(777), inputs);
const b = replay(initialState(777), inputs);
expect(hash(a)).toBe(hash(b));
```

If this passes, the daily-seed feature and the share string are trustworthy.

---

## 9. Presentation details

### 9.1 Boot sequence

On first load, once: every segment on both panels lights simultaneously for 300ms, then clears — the LCD self-test every one of these devices performed at power-on. Then the title state. This is the one orchestrated motion moment on the page; nothing else animates on arrival.

### 9.2 The shell

Rendered in CSS and inline SVG, not an image. Beige body with a visible hinge line between the panels, four recessed screws, a speaker grille of small holes, the cross-pad and A button as real interactive elements with a pressed state, and three small mode buttons.

Silkscreen text on the shell: the brand mark, `WW-52`, `OVERTIME`, `MULTI SCREEN`, and a tiny `CE`-style block of unreadable regulatory text near the bottom edge that rewards zooming in.

### 9.3 Onboarding

No tutorial screen and no modal. The title state shows Pip on floor 1 with the cross-pad's LEFT and RIGHT segments blinking. First movement starts the game. Everything else is discovered.

Under the console, one line of plain links: how to play, source, today's seed. Nothing else on the page.

### 9.4 Accessibility floor

Keyboard fully playable and focus visible on all shell buttons. `prefers-reduced-motion` disables the boot flash, the low-battery flicker, and the segment-glitch bit. No mechanic depends on hue. Panel contrast has a user toggle that overrides the battery dimming for players who need it — battery difficulty then expresses itself only through stuck segments and blackouts.

---

## 10. Build phases

Sequenced so that each phase ends at something runnable and reviewable. Do not begin a phase before the previous one's checkpoint is met.

**Phase 1 — The panel.** Vite scaffold, two canvases, the shell in CSS, `Shape`/`Path2D` compilation, the five-step render order, ghost segments, the 7-seg and 14-seg text renderer.
*Checkpoint:* a static screen showing an arbitrary lit subset over a printed backdrop, with all unlit segments ghosted, that looks convincingly like a photograph of the hardware.

**Phase 2 — The tick and Pip.** Fixed-step loop, input buffering with tick-boundary consumption, Pip's full pose atlas, movement, ladders, jump, duck.
*Checkpoint:* Pip traverses all four floors across both screens with no fractional motion anywhere.

**Phase 3 — Core game.** Barrels, slot collision, misses, bolts, round clear, the speed table, score, game over.
*Checkpoint:* a complete, losable, winnable game loop.

**Phase 4 — Feel.** Audio, near-miss detection and scoring, the boredom meter and the Steward.
*Checkpoint:* playtest confirms camping is unrewarding and near-miss play is the highest-scoring strategy. Tune here before adding anything else.

**Phase 5 — Comedy systems.** Clock modes, grievance interludes, low battery, the recurring bits.
*Checkpoint:* three consecutive runs at different simulated system times play measurably differently.

**Phase 6 — Ship.** Seeded RNG and daily mode, share string, localStorage, determinism tests, mobile touch, reduced motion, contrast toggle, GitHub Pages deploy.
*Checkpoint:* a stranger plays a full run on a phone without instructions.

---

## 11. Acceptance criteria

- Loads and plays on current Chrome, Safari, and Firefox, desktop and mobile.
- Total bundle under 150KB gzipped, no runtime dependencies beyond the browser.
- Cold load to playable under 1.5s on a mid-range phone over 4G.
- Steady 60fps `rAF` with rendering occurring at most 18 times per second.
- Zero external image or audio assets. All visuals are code; all sound is synthesized.
- Determinism test passes across 5,000 ticks.
- No mechanic communicated by hue alone.
- Fully keyboard playable with visible focus.
- No third-party IP in any name, string, shape, or asset.

---

## 12. Notes for the implementing session

Put these in `CLAUDE.md` at the repo root so they survive context resets:

- The five-step render order is not negotiable and is the most commonly broken thing when adding features. Any new visual element must be classified as printed backdrop or segment, and segments must be added to the atlas so they ghost correctly.
- Resist every instinct toward smooth motion. Interpolation, easing, tweening, and sub-slot positioning all destroy the effect and are the primary risk to this project.
- `step()` purity is what makes the daily seed work. If a feature seems to need the wall clock or real randomness mid-run, resolve it at run start into state instead.
- Tune Phase 4 before building Phase 5. Comedy layered onto a game that is not fun yet will not save it, and the boredom meter is the mechanic the whole difficulty design hangs on.
- Write Bruno's grievances as sincere and reasonable. The comedy fails the moment he becomes a joke character rather than a person with a point.
