/*
 * The clamshell (doc §9.2). Rendered in DOM + CSS, not an image: beige body,
 * visible hinge line between the panels, four recessed screws, a speaker grille,
 * the cross-pad and A button as real interactive elements, three mode buttons,
 * silkscreen text, and a block of unreadable regulatory print near the edge.
 *
 * Phase 1 only builds it and hands back element references. Wiring the buttons
 * to an input buffer is Phase 2 (src/shell/input.ts).
 */

export interface ShellRefs {
  root: HTMLElement;
  upper: HTMLCanvasElement;
  lower: HTMLCanvasElement;
  dpad: Record<"up" | "down" | "left" | "right", HTMLButtonElement>;
  a: HTMLButtonElement;
  modes: Record<"gameA" | "gameB" | "time", HTMLButtonElement>;
  statusStrip: HTMLElement;
}

const TEMPLATE = `
<div class="shell">
  <div class="screens">
    <div class="bezel"><canvas class="lcd" data-screen="upper" width="640" height="384"></canvas></div>
    <div class="hinge"><span class="hinge-label">MULTI SCREEN</span></div>
    <div class="bezel"><canvas class="lcd" data-screen="lower" width="640" height="384"></canvas></div>
  </div>

  <div class="status-strip" role="status" aria-live="polite">STANDARD</div>

  <div class="deck">
    <div class="dpad" role="group" aria-label="Direction pad">
      <button class="pad pad-up" type="button" aria-label="Up"></button>
      <button class="pad pad-left" type="button" aria-label="Left"></button>
      <span class="pad-hub" aria-hidden="true"></span>
      <button class="pad pad-right" type="button" aria-label="Right"></button>
      <button class="pad pad-down" type="button" aria-label="Down"></button>
    </div>
    <button class="btn-a" type="button" aria-label="A button">A</button>
  </div>

  <div class="mode-row" role="group" aria-label="Mode">
    <button class="mode" type="button" data-mode="gameA">GAME A</button>
    <button class="mode" type="button" data-mode="gameB">GAME B</button>
    <button class="mode" type="button" data-mode="time">TIME</button>
  </div>

  <div class="silkscreen">
    <span class="mark">WORK &amp; WATCH</span>
    <span class="model">WW-52</span>
    <span class="wordmark">OVERTIME</span>
  </div>

  <p class="regulatory">WW-52 MULTI SCREEN LCD &middot; DC 3V 2&times;LR44 &middot; CONTAINS NO USER-SERVICEABLE GRIEVANCES &middot; NOT RATED FOR SUBMERSION OR ARBITRATION &middot; FOREMAN SOLD SEPARATELY &middot; TESTED TO PART 15 OF NOTHING IN PARTICULAR &middot; N&ordm; 000482</p>

  <i class="screw screw-tl"></i><i class="screw screw-tr"></i>
  <i class="screw screw-bl"></i><i class="screw screw-br"></i>
  <div class="speaker" aria-hidden="true"></div>
</div>
`;

export function buildShell(mount: HTMLElement): ShellRefs {
  mount.replaceChildren();
  mount.insertAdjacentHTML("beforeend", TEMPLATE);

  const need = <T extends Element>(sel: string): T => {
    const el = mount.querySelector<T>(sel);
    if (el === null) throw new Error(`shell: element not found for "${sel}"`);
    return el;
  };

  return {
    root: need<HTMLElement>(".shell"),
    upper: need<HTMLCanvasElement>('canvas[data-screen="upper"]'),
    lower: need<HTMLCanvasElement>('canvas[data-screen="lower"]'),
    dpad: {
      up: need<HTMLButtonElement>(".pad-up"),
      down: need<HTMLButtonElement>(".pad-down"),
      left: need<HTMLButtonElement>(".pad-left"),
      right: need<HTMLButtonElement>(".pad-right"),
    },
    a: need<HTMLButtonElement>(".btn-a"),
    modes: {
      gameA: need<HTMLButtonElement>('[data-mode="gameA"]'),
      gameB: need<HTMLButtonElement>('[data-mode="gameB"]'),
      time: need<HTMLButtonElement>('[data-mode="time"]'),
    },
    statusStrip: need<HTMLElement>(".status-strip"),
  };
}
