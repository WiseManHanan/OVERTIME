# OVERTIME

**Model WW-52 · "Work & Watch" · Wide Screen Multi Screen**

A web reconstruction of the 1982 dual-screen LCD handheld form factor, running an
original arcade game with a labor-dispute comedy layer, real-clock awareness, and
a failing-hardware endgame.

Built with vanilla TypeScript, Vite, and Canvas 2D — no framework, no engine, no
WebGL, zero runtime dependencies.

See [`OVERTIME-design-doc.md`](./OVERTIME-design-doc.md) for the full design and
implementation specification.

## Development

Requires Node **24.15+** (see `.nvmrc`). Zero runtime dependencies; the only
dev dependencies are Vite, TypeScript, and Vitest.

```sh
npm install       # or: npm ci
npm run dev       # dev server — open the /OVERTIME/ URL it prints
npm run build     # typecheck + production build to dist/
npm run preview   # serve the built dist/
npm test          # Vitest (pure simulation tests, node env)
npm run typecheck # tsc --noEmit
```

`vite.config.ts` sets `base: '/OVERTIME/'` for GitHub Pages, so the dev server
also serves under that path — use the URL Vite prints, not bare `localhost`.

## Status

Phase 0 complete: Vite + TypeScript + Vitest scaffold, CSS palette tokens, and a
GitHub Pages deploy workflow. Game code lands in Phases 1–3 (see the design doc
§10 and `CLAUDE.md`).
