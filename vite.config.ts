// `vitest/config` re-exports Vite's `defineConfig` widened with the `test` key.
import { defineConfig } from "vitest/config";

// Repo is deployed to https://wisemanhanan.github.io/OVERTIME/ via GitHub Pages,
// so assets must be requested under that sub-path. Local `vite dev` ignores base.
export default defineConfig({
  base: "/OVERTIME/",
  build: {
    target: "es2022",
    // Keep the bundle honest against the <150KB gzipped budget (doc §11).
    assetsInlineLimit: 0,
  },
  test: {
    // The simulation is pure and DOM-free; unit tests need no browser env.
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
