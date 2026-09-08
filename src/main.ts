/*
 * Bootstrap. Phase 0: prove the toolchain end-to-end with a minimal mount.
 *
 * Phase 1 replaces the placeholder below with:
 *   - the CSS/SVG clamshell (src/shell/shell.ts)
 *   - two canvases sized to a 160x96 virtual panel space per screen
 *   - the LCD self-test boot flash (doc §9.1)
 *   - one static render pass (src/panel/render.ts)
 *
 * Phase 2 replaces that static pass with the fixed-step accumulator loop
 * (doc §4.1): render only when a tick has advanced, never interpolate.
 */

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app mount point missing from index.html");

// Placeholder marker so the empty-state CSS in styles.css renders the shell box.
// Removed as soon as shell.ts owns this element in Phase 1.
app.dataset.phase = "0";

export {};
