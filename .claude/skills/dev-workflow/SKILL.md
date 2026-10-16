---
name: dev-workflow
description: Build, run, and verify Kitten Crawler Man — npm scripts, dev server ports, validation gates (typecheck/lint/format), backend and .env notes. Use when running the game, verifying a change, or setting up the environment.
---

# Dev Workflow

## Validation gates (required before any change is "done")

```bash
npm run check        # iterate: format + typecheck + lint + ui-style + audio, cached, in parallel
npm run check:full   # sign-off: stable tsc, uncached lint — must exit 0 before work is done
npm run verify:affected -- <changed files>   # every verify/gates script whose imports reach them
```

`check` lints with ESLint's content cache (`node_modules/.cache/eslint/`) and typechecks with `tsgo` (the `@typescript/native-preview` package) when it is installed, falling back to incremental `tsc`. The cache can't see that a type change in one file broke a type-aware rule in an untouched one, so `check:full` deletes it and lints everything with stable `tsc`. `check:ci` is `check:full` with `prettier --check` instead of `--write`; `.github/workflows/checks.yml` runs it and `verify:affected --base=<previous push>` on every push. The single commands (`typecheck`, `lint`, `format`) still exist, but `check` replaces chaining them.

CLAUDE.md rules that gate on these: strict types everywhere, **no `as` casts, no `!` assertions, no `any`**, no magic numbers, comments explain _why_ only.

### How gate output works

Every `verify:*` and `gates:*` npm script runs through `scripts/gate.ts`:

- **Pass:** one line, `✓ name (time)`.
- **Failure:** the lines carrying a failure marker, then the last 25 lines.
- **Always:** the whole output is written to `.gate-logs/<name>.log`. Read that rather than re-running.
- `GATE_VERBOSE=1 npm run verify:x` streams everything live.
- A pass that still printed `FAIL`, `✗` or `MISSED` is flagged, because a script that reports a failure without exiting non-zero would otherwise vanish.

A new gate must exit non-zero on any failed check, must be invoked as `tsx scripts/<file>.ts` (several entry guards compare `process.argv[1]` with the module's own path), and is wired as `"verify:x": "tsx scripts/gate.ts tsx scripts/verify-x.ts"`.

`verify:affected` traces each gate's imports with esbuild, so it needs no mapping table. Files read from disk rather than imported are not in any graph; `RUNTIME_ASSET_GATES` in `scripts/verify-affected.ts` maps those path prefixes to gates. Sweeps that take minutes (`SLOW_GATES`) run only with `--slow`. Gates run longest-first across half the cores, using the timings each run records in `node_modules/.cache/gates/`.

## Headless verification harnesses

Typecheck and lint don't prove behavior. Several invariants have their own scripts, each running against the game's own exported functions and constants rather than a copy, so a retuned formula either still satisfies the rule or fails the script. Run the one that covers what you touched, or let `verify:affected` pick:

```bash
npm run verify:difficulty    # the P2 and P5 fairness rules (docs/difficulty-fairness-rules.md)
npm run verify:difficulty-curve # P1: HP share per fight across party levels, every spawnable creature
npm run verify:tactics       # P6: tactics trait rolls, guard, kite, flank, riposte bounds
npm run verify:progression   # 50 generated maps per floor: reachability and bypass invariants
npm run verify:quest-choke   # the defense quest's room, on the live GameMap
npm run verify:stealth-gate  # floor 2's stealth gate room: S7 placement plus the live gate (prison gates are in add-level)
npm run verify:bounty        # bounty registry, encounters, state machine, site scatter
npm run verify:separation    # mob push-apart force math and strategy equivalence
npm run verify:assets        # every mob a floor can produce vs. its declared sprite groups
npm run verify:dialog-pagination # paginate's break rules, plus every dialog script's lines fit the real DialogBox
npm run verify:dialog-lines  # every exported line under src/dialog/scripts/ is read by something
npm run gates:environment-art # the runtime art queue: sheets arrive, arrive paced, are released
npm run verify:floor-sweep   # every shippable floor art seed, in every domain that carries one
npm run bench:separation     # measures the separation strategy crossover
npm run verify:slots         # slot engine: paylines, wilds, scatters, jackpot pool, free spins, money invariants
npm run verify:wheel         # Wheel of Fortune: board red share, bet upgrades, retired prizes, landings, the wipe's save latch
npm run verify:audio         # music director, library and credits, voices, ramped stops, scopes, captions, mute/mono/background
npm run report:slots-rtp     # slot RTP / hit-rate / win-tier report for tuning; never fails (-- --spins=N --seed=S --bet=B)
npm run bench:slots          # times the slots MEGA WIN celebration on a phone-sized canvas (-- idle for the resting machine)
```

- `verify:difficulty` covers the cadence curve, telegraph floors, projectile speed caps, the regen curve, spawn-count caps, spawn and boss level bands, progression regions, and that nothing calls `applyMobLevel` twice.
- `verify:progression` regenerates 50 maps per floor; a rare layout failure needs that volume to show up at all. Bump `VERIFY_RUN_COUNT` locally for a sign-off run and leave the committed value alone.
- `verify:quest-choke` is the runtime half of that: the nursery is a room the route runs _through_, and the wave inside it is optional, so the live map has to show both — a party that never speaks to the goblin mother gets past, and a party that goes around the room does not. `verify:progression` cannot answer either, since the grid is walkable by tile type and passage is governed by a block flag the quest raises at runtime. It also covers the three states her encounter puts the doorway through (clear, barred for the length of a wave, smashed once it ends), the tile-art swaps, and the checkpoint that must not re-board a doorway a finished wave already opened.
- `verify:assets` proves every mob a floor can produce has its sprite keys declared — see `docs/asset-management.md`.
- `verify:dialog-pagination` and `verify:dialog-lines` gate `src/dialog/`: the first proves a paragraph always fits the real `DialogBox` it's drawn in, the second proves every line written under `src/dialog/scripts/` is actually read by something (by name or through a role interface it `satisfies`). Run both after touching a dialog script, a role interface, or `paginate.ts`.
- The environment art is painted at runtime rather than loaded, so it has gates of its own. `gates:environment-art` is the cheap one and belongs in any run that touched `src/map/environmentArtCache.ts` or a sheet plan. `verify:floor-sweep` takes minutes and is for art changes: it re-measures **every** seed the game can draw, across the ground materials, the seeded prop families and the building facades, which is what makes it exhaustive rather than a sample. `--only=ground|props|facades` narrows it while iterating. Re-run `npm run gen:floor-art-seeds` whenever any seeded painter, ramp or sheet config changes — the alphabet is otherwise a list of seeds verified against art that no longer exists.
- `verify:bounty`'s map checks are a random sample, not a deterministic gate: overworld generation runs on unseeded `Math.random()` on purpose, because a fixed seed only ever proves the one map it encodes. Run it more than once when something looks marginal.
- `verify:separation` checks force math, cell-boundary coverage, and that the grid and all-pairs strategies agree to floating-point rounding across 200 random layouts plus degenerate ones. It also pins `SpatialGrid`'s key-packing assumptions: negative coordinates are safe, and a bucket collision can only cost work rather than produce a wrong answer, because every query re-tests its candidates.
- `bench:separation` is what makes `SEPARATION_GRID_MIN_MOBS` a measured number rather than a guess. It sweeps roster sizes against three crowding levels and carries a max-force-delta column beside the timings, so a faster shape that quietly computed _different_ forces fails loudly. Treat the crossover as the result and the absolute microseconds as scenery — they are wall-clock on whatever machine runs them.
- `verify:slots` and `verify:wheel` check behaviour only; payout balance is read from `report:slots-rtp` and tuned by playtest. Their review renders are `npm run render:slot-symbols` (`preview/slots/symbols.png`), `npm run render:tito` (Tito's busts and his corner of the club, `preview/tito/`) and `npm run render:equipment -- --item=fury_of_taranis` (the Fury of Taranis in Carl's hand).
- `npm run lint` also runs `check:audio`, which fails on a file added or swapped without a re-measure: run `npm run measure:audio` (needs ffmpeg and ffprobe) after any audio file change. See `add-sound`.
- These scripts exist because browser `requestAnimationFrame` throttles to roughly one frame a second when the tab is occluded, so nothing about timing or motion can be honestly claimed from browser automation. Everything that could be made deterministic was moved into them; the rest is left to a human.
- A new script must be listed by name in `tsconfig.scripts.json`'s `include`. Scripts typecheck is opt-in — an unregistered script is never checked and the gate still passes.

## Crawler figures and equipment

Carl's and Donut's art, what they hold and what they wear have their own gates and review renders. The rules behind them are in `bipedal-figure` (figures), `add-gear` (weapons, tools, props, garments) and `add-sprite` (the figure cache):

```bash
npm run render:human          # Carl's sheet + G1–G27 (G9b sizes his working set per motion set)
npm run render:cat            # Donut's sheet + her figure gates
npm run gates:equipment       # E1–E7 for everything held or worn by either crawler (-- --item=<item or garment id>)
npm run render:equipment      # Carl's held items on their rows, large and at the 32 px tile; runs the equipment gates first
                              # (-- --item=<id>; -- --part=hands for the grip roll at 6x; -- --out=<png>)
npx tsx scripts/render-garments.ts --wear=<garment id>[,<id>] [--compare] [--rows=<row>:<frame>,…] [--out=<png>]
                              # one garment on either crawler across rows and views at 32 px; no gates
npm run render:held-visuals   # every held visual beside the art it reproduces (-- --item=<id>, -- --measure)
npm run verify:held-visuals   # held-visual registry, archetype ranges, weapon looks vs wearer
npm run verify:player-snapshot # save shape and migrations: held slots, drawn bit, old saves
npm run bench:turn-residency  # no cold frame on a turn, a menu, a flush, a harvest or a carry (-- --scenario=<name>)
npm run gates:figure-cache    # the figure cache's own contracts
npm run bench:figure-paint    # per-cell paint cost
npm run verify:preview-scene  # the ?human and ?donut preview routes
```

`?human` (`?human=<row>`) and `?donut` (`?donut=<row>`) are the live preview routes for Carl and Donut: a row at three sizes, live crawlers on a script, and pickers for weapons, outfits and tools.

## Dev overlays

`?perf` shows fps, update/render/separation ms, and active vs. separated mob counts — the game's only profiling. `?difficulty` shows damage taken, potions consumed, dodges, deaths and per-segment HP delta, plus guard blocks per fight, kites and their length, and HP remaining in fights with vs. without a trait-bearing mob. They compose rather than replacing each other. Both live under `src/dev/`, which release builds resolve to an inert stub, so neither reaches a player.

## Chat cheats

Typed into the in-game chat box. The universal table is in `ChatKit` (`src/systems/kits/ChatKit.ts`): `!god`, `!tough`, `!payday`, `!levelup`, `!give <item_id> [quantity]` (any item, one by default, into the active crawler's bag, or the wearer's for a crawler-specific item; a non-stackable item takes a slot per copy, so only as many as fit are given) and `!vomit` (blood vomiting, its first bout almost due). `DungeonScene` adds scene cheats, among them `!cow` (grants Carl the attack cow).

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

A `?playtest=` or `?level=` boot never writes the real saved game, so it can't
clobber your own run. Add `&save` (e.g. `?playtest=spider&save`) to persist its
saves. Without it, saves still happen in memory, so a death still respawns at the
last save point.

**All dev-only routes are release-stripped.** `?playtest=`, `?level=`, and the
art preview routes (`?goblins`, `?tiles`, `?human`, `?donut`, `?slots` and `?wheel` for the casino's slot machine and Wheel of Fortune harnesses, …) and `?prison=<layout>&difficulty=<d>` (straight into the Goblin High Security Prison) live in `src/dev/devBoot.ts`, which
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

Most sheets are painted by the game itself and have no file at all — the ground tilesets, the town's furniture and signage, the wilderness, the props and the building facades. Their `scripts/generate-*` entry points are **review bakers**: they write PNGs into `preview/props/` (or `preview/tilesets/`), never into `src/images/`, and they run the checks a picture cannot make for itself. Most are wired up as `gen:` scripts — `gen:townscape`, `gen:trees`, `gen:rocks`, `gen:camps`, `gen:buildings`, `gen:town-art`. A handful of sheets are still fetched, and those generators do write into `src/images/`. See `add-sprite`.

## Verifying a gameplay change

Typecheck + lint alone don't prove behavior. Run `npm run serve`, open `http://localhost:8080`, and exercise the affected flow (spawn the creature's level, use the item, trigger the ability). Deploys go to GitHub Pages automatically on push to main (`.github/workflows/deploy.yml`).
