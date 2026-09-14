/*
 * Input capture (doc §4.4). Every source — keyboard, the drawn shell buttons —
 * funnels into a one-slot buffer that `step()` drains once per tick. A discrete
 * press always wins; if the buffer is empty, a held direction repeats so
 * walking and ducking work on hold. Either way `drain()` yields at most one
 * action per tick, so an input log still replays a run exactly.
 *
 * `A` is edge-triggered only — one press, one jump. Mode buttons are Phase 5.
 */
import type { ShellRefs } from "./shell";
import type { InputAction } from "../sim/step";

export interface InputSource {
  /** The action for this tick boundary, or `null` for an idle tick. */
  drain(): InputAction | null;
  /** Whether the drawn A button — pointer/touch only, no keyboard — was
   *  pressed since the last call. For the GAME OVER screen's restart, which is
   *  meant to answer only the physical A button, not any of its in-game
   *  keyboard stand-ins (Space, Z). */
  consumeButtonA(): boolean;
  dispose(): void;
}

const KEYMAP: Record<string, InputAction> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "a",
  KeyZ: "a",
};

/** Directions that repeat while held. `A` is deliberately absent. */
const HOLD_REPEAT: readonly InputAction[] = ["left", "right", "up", "down"];

export function createInput(shell: ShellRefs): InputSource {
  let buffered: InputAction | null = null;
  const held = new Set<InputAction>();
  let buttonAPressed = false;

  const press = (a: InputAction): void => {
    buffered = a;
    if (HOLD_REPEAT.includes(a)) held.add(a); // A is edge-triggered only
  };
  const release = (a: InputAction): void => {
    held.delete(a);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const a = KEYMAP[e.code];
    if (a === undefined) return;
    e.preventDefault();
    if (e.repeat) return; // OS key-repeat; hold logic covers continuous input
    press(a);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const a = KEYMAP[e.code];
    if (a !== undefined) release(a);
  };
  // A key held across a focus or tab change never delivers its keyup here, which
  // would leave it stuck in `held` and auto-walk Pip. Drop everything held when
  // the window loses focus or the tab is hidden.
  const dropHeld = (): void => held.clear();
  const onVisibility = (): void => {
    if (document.hidden) held.clear();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", dropHeld);
  document.addEventListener("visibilitychange", onVisibility);

  const unbinders: Array<() => void> = [];
  const bindButton = (el: HTMLElement, a: InputAction): void => {
    const down = (e: Event): void => {
      e.preventDefault();
      press(a);
    };
    const up = (): void => release(a);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
    unbinders.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", up);
      el.removeEventListener("pointercancel", up);
    });
  };

  bindButton(shell.dpad.left, "left");
  bindButton(shell.dpad.right, "right");
  bindButton(shell.dpad.up, "up");
  bindButton(shell.dpad.down, "down");
  bindButton(shell.a, "a");

  // The drawn A button, and only it, also sets a dedicated flag — separate
  // from the shared "a" buffer keyboard stand-ins feed too.
  const onButtonADown = (): void => {
    buttonAPressed = true;
  };
  shell.a.addEventListener("pointerdown", onButtonADown);
  unbinders.push(() => shell.a.removeEventListener("pointerdown", onButtonADown));

  return {
    drain(): InputAction | null {
      if (buffered !== null) {
        const b = buffered;
        buffered = null;
        return b;
      }
      for (const a of HOLD_REPEAT) {
        if (held.has(a)) return a;
      }
      return null;
    },
    consumeButtonA(): boolean {
      const p = buttonAPressed;
      buttonAPressed = false;
      return p;
    },
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", dropHeld);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const off of unbinders) off();
    },
  };
}
