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
npm run verify:ai-actions    # AI action registry: schemas vs tool definitions, fuzzed calls through the governor's fairness rules
npm run verify:residency     # a floor-3 tour of two interiors holds no more per owner at Briar Hollow than going straight there (~5.5 min)
npm run report:residency     # bytes and surfaces per owner along scripted routes, per floor; never fails (-- --floor=3|scaled-city --route=<name>)
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

`?perf` shows fps, update/render/separation ms, active vs. separated mob counts and tracked pixel memory with its three largest owners. It also publishes the measurement globals: `__perfMemory()` (bytes per surface owner), `__perfRecorder.start(label)`/`.stop()` (a numeric recording of frame intervals, timers, gauges, figure-cache hits and long frames), and for untimed runs `__perfDensity` and `__perfDuplicateCells()`. `&perfwalk=<id>` drives a scripted walk from `PERF_SCENES` (`src/dev/perfScenes.ts`), reporting progress in `__perfWalk.state`. The full procedure and its caveats (node-canvas timings, 120 Hz vsync jitter, Task Manager reconciliation) are in `docs/asset-management.md`, "Measuring any of this". `?difficulty` shows damage taken, potions consumed, dodges, deaths and per-segment HP delta, plus guard blocks per fight, kites and their length, and HP remaining in fights with vs. without a trait-bearing mob. They compose rather than replacing each other. Both live under `src/dev/`, which release builds resolve to an inert stub, so neither reaches a player. `?ai-record` records the page's AI traffic for an AI replay fixture, downloaded with F8 (see "AI replay fixtures"). `?prices` shows the pricing engine's working (base, each markup/stock/buyback step with its multiplier and running total, final) under the selected row of every item counter's Buy and Sell tabs; tap a row to select it. Service rows have no working and show none.

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

## Running with the AI (`npm run dev:ai`)

`scripts/dev-ai.ts` starts the whole AI stack from this repo. The AI server checkout is `$AI_SERVER_DIR` (default `../game-server-llm`), and its `.env` decides the provider:

- DynamoDB Local (:8000) and MinIO (:9000): reused when both ports answer, otherwise the server's `npm run infra:up` (fails early when Docker isn't running).
- `LLM_PROVIDER=openai-compat` on Ollama (base URL on :11434 or `OPENAI_COMPAT_API=ollama`): the server's `scripts/ollama-dev.sh`, which applies the tuned settings to an Ollama it starts and warms the fast model. An Ollama already serving keeps its own settings; `npm run dev:ai -- --restart-ollama` replaces it. Any other OpenAI-compatible server is only checked for an answer on `/models`.
- `LLM_PROVIDER=bedrock`: `aws sts get-caller-identity --profile $AWS_PROFILE` must pass.
- `npm run build:sdk` in the server when `packages/sdk/dist` is missing.
- Then the AI server's `npm run dev` (:3001) and this repo's `npm run dev` (:3000, a `--dev-boot` build) as child processes, output prefixed `[ai  ]` / `[game]`, each waited on until its `/.well-known/jwks.json` answers. It refuses to start when either port is taken (`npm run kill -- <port>`).

It prints the game and console URLs and `AI provider → <provider> (fast: <model>, smart: <model>) ✓`, read from the server's `.env` (the console's Settings page can override a tier at runtime; the printout does not see that). Ctrl-C stops both process groups. It warns when this repo's `.env` has `AI_ENABLED` off or no `AI_APP_ID`. One-time setup is in the README.

## AI replay fixtures

The AI server's eval harness replays recorded sessions: every message the game sent (`context_set`, `state_snapshot` full/patch, `event_log`, `player_message`, `action_result`) with `atMs` since the recording started. The format is `src/ai/replay/aiReplayFormat.ts` (`AI_REPLAY_VERSION`; bump it when a field changes meaning) and its zod schema is `scripts/aiReplaySchema.ts`, which must keep compiling against those types (`asSchemaInput`). Fixtures live in the **server** repo, `bench/replays/`, beside the generated `replay.schema.json`.

- `npm run ai:replays` acts out scripted sessions headlessly through the real `AIAdapter`, context builder, event mapping, action registry and challenge system (a fake SDK client in place of the socket, a scripted clock, so the output is deterministic) and writes `dynamite-incident.json` and `challenge-and-death.json`, validated and formatted with the target repo's Prettier config. `-- --out=<dir>` writes elsewhere. A new scenario is a new function in `scripts/record-ai-replays.ts`; `world.say(text, { kind: 'recall', mentionsAny, description })` adds a memory-recall expectation on the reply: the eval matches `mentionsAny` as whole words or phrases, case-insensitively, and the script refuses a term the question itself contains.
- In the browser, a dev build with `?ai-record` (or `?ai-record=<name>`) records from page load through `AIAdapter.setOutboundListener`, and **F8** downloads the fixture. Only what was actually sent is recorded, so the AI must be connected (signed in, `AI_ENABLED=true`, a normal boot: a `?playtest=`/`?level=` boot takes over before the adapter connects). Move the file into the server's `bench/replays/` to use it. The recorder is in `src/dev/`, wired from `devBoot.ts`, so release builds don't contain it.
- `npm run build:zip` produces the distributable; a service worker is regenerated on full builds.

## Jumping to a point in the game

```bash
npm run playtest --spider    # or: npm run playtest -- spider
npm run playtest             # lists the presets
```

Builds, serves on :3000 and opens `?playtest=<id>` — a floor, a spawn landmark
(a gateway safe room, the spider lab's field station) and a fully kitted party, so
a change can be exercised without replaying the floors above it. `spider` starts in
the station with Dr. Moult already at his terminal; `spider-hallway` starts in the
host room short of the lab hallway's mouth with him still waiting there. Presets are data in
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

`scripts/build.js` bundles `src/game.ts` (with the AI SDK, `@rscarbel/game-server-llm-sdk`, which uses the browser's own WebSocket; `ws` is marked external so it is never bundled) and injects `__AI_ENABLED__` and `__AI_SERVER_URL__` from `.env` via esbuild `define`. Only public values go there: anything defined is readable by every player.

The SDK is installed from GitHub Packages (`.npmrc` maps the `@rscarbel` scope there). Installing needs a GitHub token with `read:packages` in the user's `~/.npmrc`; CI uses the workflow's `GITHUB_TOKEN`. Unreleased SDK changes are tried with `npm link` (see the SDK's README).

## `.env`

From `.env.example`: `AI_ENABLED` (default `false` — with it off, `game.ts` skips auth/AI and boots straight into the game, which is how the static site ships), `AI_SERVER_URL` (default `http://localhost:3001`), `AI_APP_ID`, `PUBLIC_URL`, `AI_SIGNING_KEY_DIR` / `AI_SIGNING_KEY_PEM`, `JWT_SECRET`, and `AI_SYNC_CLIENT_ID` / `AI_SYNC_CLIENT_SECRET` for `npm run ai:sync`. With the AI server absent the game plays on, the panel's dot shows offline and the System answers from scripted lines.

**`npm run ai:sync`** (`scripts/ai-sync.ts`) pushes the characters, the generated tools, the world bible and the event importance hints to the AI server once per deploy, as a service account (client credentials). Each upload is one entry in its `SYNC_STEPS`; an optional one (the lore and the importance hints) is skipped with a note when the service account lacks its scope (`lore:write`) or the server answers its endpoint with a 404. A character goes up exactly as `PUT /api/characters/:name` keeps it: the server takes identity only from `personality.core` and strips unknown keys, so the role and the acting-rule notes are folded into that core (`renderCharacterCore`). `-- --dry-run` prints the payloads; `-- --snapshot=<file>` writes them all to one JSON file, formatted with the target repo's prettier config (the AI server's `bench/game/kitten-crawler-sync.json` is made this way), and sends nothing. The README says how to create the service account.

**AI player tokens.** The browser never holds an AI credential. `GET /api/ai-token` (`server/routes/aiToken.ts`, login required) signs a 10-minute ES256 token for the signed-in user (`sub` = user id, `aud` = `AI_APP_ID`, `iss` = `PUBLIC_URL`, `kid` in the header), and `GET /.well-known/jwks.json` publishes the public key for the AI server to trust. The private key comes from `AI_SIGNING_KEY_PEM`, or is generated on first run into `AI_SIGNING_KEY_DIR` (default `.keys/`, gitignored). A logged-out player gets a 401 and plays without the AI.

## Backend

`server/index.ts` — Express on :3000, serves the static root, mounts `/api/auth`, `/api/progress`, `/api/ai-token` and `/.well-known/jwks.json` (`server/routes/aiToken.ts`, key in `server/aiSigningKey.ts`). `server/db.ts` — better-sqlite3 (`data/game.db`, or `$GAME_DATA_DIR/game.db`; a `game.db` left at the repo root is moved there on first start; `users` + `progress` tables). Only allowlisted game files are served from the repo root (`server/publicFiles.ts`). JWT cookies + bcrypt in `server/routes/` and `server/middleware/`.

## Sprite generation

Most sheets are painted by the game itself and have no file at all — the ground tilesets, the town's furniture and signage, the wilderness, the props and the building facades. Their `scripts/generate-*` entry points are **review bakers**: they write PNGs into `preview/props/` (or `preview/tilesets/`), never into `src/images/`, and they run the checks a picture cannot make for itself. Most are wired up as `gen:` scripts — `gen:townscape`, `gen:trees`, `gen:rocks`, `gen:camps`, `gen:buildings`, `gen:town-art`. A handful of sheets are still fetched, and those generators do write into `src/images/`. See `add-sprite`.

## Verifying a gameplay change

Typecheck + lint alone don't prove behavior. Run `npm run serve`, open `http://localhost:8080`, and exercise the affected flow (spawn the creature's level, use the item, trigger the ability). Deploys go to GitHub Pages automatically on push to main (`.github/workflows/deploy.yml`).

## Design debt

If this work turns up hacky code, a fragile coupling, or a design that will make the next change harder, and it is beyond your task, record it in `docs/design-debt.md` (rules and entry shape are at the top of that file). Before building on a system, check that file for entries about it and honour their **Until then** lines.
