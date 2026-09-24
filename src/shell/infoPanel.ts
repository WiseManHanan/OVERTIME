/*
 * The "how to play" link's target (doc §3.3's one quiet line of page links,
 * already reserved for this). A native <dialog> — free focus trap, backdrop,
 * and Escape-to-close, no framework needed.
 *
 * This is page chrome, not the shell: it never reads or touches GameState,
 * and isn't part of the doc §4.4 hardware (cross-pad, A, three mode buttons
 * — "the entire hardware"). It's the printed instruction card, not a control.
 */
import { MISSES_ALLOWED } from "../sim/state";

const TEMPLATE = `
<dialog class="info-dialog" aria-labelledby="info-title">
  <form method="dialog">
    <h2 id="info-title">How to play</h2>
    <p class="info-premise">
      You're <strong>PIP</strong>. Climb four floors, dodge what
      <strong>BRUNO</strong> throws, and release the four bolts holding his
      platform to clear the round.
    </p>
    <ul class="info-controls">
      <li><span class="key">◀ ▶</span>Move</li>
      <li><span class="key">▲</span>Climb a ladder, or release a bolt at the console</li>
      <li><span class="key">▼</span>Duck &mdash; or climb down, on a down-ladder slot</li>
      <li><span class="key">A</span>Jump</li>
    </ul>
    <p class="info-console">
      The lever panel is on floor 4, at the far right past Bruno. Stand on it
      and hold <strong>▲</strong> &mdash; each haul takes two ticks, and you
      can't move while it releases. Pull it four times to drop all four
      holders and clear the round, but linger too long and his swipe can
      knock it back up.
    </p>
    <ul class="info-hazards">
      <li><strong>Barrels</strong> roll low &mdash; jump them.</li>
      <li><strong>Chairs</strong> roll high and fast &mdash; duck them, they can't be jumped.</li>
    </ul>
    <p class="info-misses">${MISSES_ALLOWED} misses ends the run.</p>
    <p class="info-steward">
      Watch <strong>THE STEWARD</strong>'s bar, bottom-left of the lower screen
      &mdash; it's a boredom meter, not decoration. Play it safe and it fills,
      dropping your score multiplier and eventually zeroing it while he
      dozes off. Near misses, bolts, and changing floors drain it and pay
      better &mdash; caution is the losing move.
    </p>
    <button class="info-close" type="submit">Got it</button>
  </form>
</dialog>
`;

export function initInfoPanel(): void {
  const link = document.querySelector<HTMLAnchorElement>('#page-links a[href="#how-to-play"]');
  if (link === null) return;

  document.body.insertAdjacentHTML("beforeend", TEMPLATE);
  const dialog = document.querySelector<HTMLDialogElement>(".info-dialog");
  if (dialog === null) return;

  link.addEventListener("click", (e) => {
    e.preventDefault();
    dialog.showModal();
  });
}
