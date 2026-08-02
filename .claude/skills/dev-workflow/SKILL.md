---
name: dev-workflow
description: Build, run, and verify Kitten Crawler Man — npm scripts, dev server ports, validation gates (typecheck/lint/format), backend and .env notes. Use when running the game, verifying a change, or setting up the environment.
---

# Dev Workflow

## Validation gates (required before any change is "done")

```bash
npm run typecheck   # tsc --noEmit — must exit 0
npm run lint        # eslint src — must exit 0
npm run format      # prettier --write "src/**/*.ts"
```

CLAUDE.md rules that gate on these: strict types everywhere, **no `as` casts, no `!` assertions, no `any`**, no magic numbers, comments explain *why* only.

## Running the game

```bash
npm run build    # esbuild → dist/bundle.js (~5ms)
npm run serve    # dev server on http://localhost:8080 (static, no backend — fastest)
npm run server   # Express + SQLite backend on http://localhost:3000
npm run dev      # build + server (use :3000 to exercise auth/progress saving)
npm run kill     # free port 3000 (pass `-- 8080` for the serve port)
```

- `serve` rebuilds on request but has **no HMR** — refresh the browser to pick up changes.
- The game runs fully offline without the backend; auth/progress are optional.
- `npm run build:zip` produces the distributable; a service worker is regenerated on full builds.

## Jumping to a point in the game

```bash
npm run playtest --spider    # or: npm run playtest -- spider
npm run playtest             # lists the presets
```

Builds, serves on :3000 and opens `?playtest=<id>` — a floor, a spawn landmark
(a gateway safe room, the spider lab door) and a fully kitted party, so a change
can be exercised without replaying the floors above it. Presets are data in
`src/dev/playtestPresets.ts`; add one there.

**All dev-only routes are release-stripped.** `?playtest=`, `?level=`, and the
art preview routes (`?goblins`, `?tiles`, …) live in `src/dev/devBoot.ts`, which
`scripts/build.js` resolves to an inert stub unless the build passed
`--dev-boot` (`serve` implies it). Plain `npm run build` — what `build:site`
deploys — contains none of it. Put nothing a player is meant to reach in that
file, and use `npm run serve` / `dev` / `playtest` when you need those URLs.

## Build internals

`scripts/build.js` bundles `src/game.ts`, aliases `ws` to a stub, and injects `__AI_CLIENT_ID__` / `__AI_CLIENT_SECRET__` / `__AI_ENABLED__` from `.env` via esbuild `define`.

## `.env`

From `.env.example`: `AI_ENABLED` (default `false` — with it off, `game.ts` skips auth/AI and boots straight into the game), `AI_CLIENT_ID`, `AI_CLIENT_SECRET`, `JWT_SECRET`. The AI adapter expects its LLM server on `localhost:3001` and silently no-ops when absent.

## Backend

`server/index.ts` — Express on :3000, serves the static root, mounts `/api/auth` and `/api/progress`. `server/db.ts` — better-sqlite3 (`game.db`, `users` + `progress` tables). JWT cookies + bcrypt in `server/routes/` and `server/middleware/`.

## Sprite generation

Sprite sheets are generated offline: `npx tsx scripts/generate-<name>-sprite.ts` (uses the `canvas` npm package, writes PNGs into `src/images/`). Not wired into npm scripts. See `add-sprite`.

## Verifying a gameplay change

Typecheck + lint alone don't prove behavior. Run `npm run serve`, open `http://localhost:8080`, and exercise the affected flow (spawn the creature's level, use the item, trigger the ability). Deploys go to GitHub Pages automatically on push to main (`.github/workflows/deploy.yml`).
