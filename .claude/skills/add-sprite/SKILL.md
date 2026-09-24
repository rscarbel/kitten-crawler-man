---
name: add-sprite
description: Add or modify a sprite in Kitten Crawler Man — sprite sheets (PNG or runtime-painted), JSON manifests, SpriteLoader/SpriteRenderer, offline generator scripts. Use when a creature, item, prop or effect needs new art or animation states.
---

# Add a Sprite

> **Human NPCs / townsfolk / crowds are NOT sprite sheets** — they're drawn procedurally at runtime from a seed. Use the `add-person` skill for those, not this pipeline.
>
> **Bipedal characters (humans, goblins, clowns, humanoid bosses) need the `bipedal-figure` skill first** — the rig/pose/view contract, gait authoring, bake gates and the image-review loop live there. Come back here for the manifest / loader / draw-wrapper wiring.
>
> **Ground and floor textures are NOT sprite sheets either** — they're painted at
> runtime by `src/map/tilegen/materials.ts` from wrapped noise. Use the
> `add-ground-tile` skill for terrain, paving, floors and tilesets.
>
> **Neither is the environment.** The town's street furniture and signage, the
> forest, the boulders and the goblin camps are painted at floor load from plans
> in `src/sprites/sheets/`. See "Environment art is painted, not fetched" below
> before adding or changing any of it.

Runtime rendering uses **sprite sheets described by JSON manifests** under `src/images/<category>/` (`enemies/`, `bosses/`, `characters/`, `npcs/`, `effects/`, `environment/`). Most are PNGs, produced offline by procedural generator scripts in `scripts/` or hand-drawn; the environment ones are painted by the game itself and have no file at all.

## Environment art is painted, not fetched

A manifest entry with **no `path`** is painted at runtime rather than loaded.
`SpriteLoader` refuses to fetch it and waits for `registerPaintedSprite`. The
entry stays in the manifest either way, because its rows, frame counts,
`patchTiles`, `tileTypeId` and `blockedRegions` are what every draw site and
every material union is written against — what it no longer carries is a file.

Such a sheet is described once, in `src/sprites/sheets/`, as a `PropSheetPlan`:
the frame envelope, which state is which row, and one painter per frame. The game
turns that plan into paced work through `src/map/environmentArtCache.ts`, and
`scripts/propSheetBake.ts` turns the same plan into a review PNG under
`preview/props/`. One description, so the sheet the game paints and the sheet you
look at cannot be different art.

**Obligations when adding or changing one:**

- The plan must agree with the manifest entry. `propSheetPlanMismatches` proves
  it and `npm run gates:environment-art` runs that over every family; a
  disagreement throws at request time rather than landing the art an inch out
  forever.
- No painter may draw outside its own cell. Every frame is clipped to its cell
  wherever it is painted, so art that overruns is sheared off along a straight
  line — invisible in a typecheck, permanent in the picture. `bakePropFamily`
  checks the border pixels of every frame.
- Register the family in `src/sprites/sheets/environmentSheets.ts` against the
  `AssetGroup` the floor declares, and say whether it varies with the floor's art
  seed. Seeded art is repainted whenever a floor's layout changes; unseeded art
  survives the stairs and is released with its asset group.
  Boss-room families are the exception to registering one by one: each room's
  plans live in `src/sprites/sheets/bossRooms/<room>Sheets.ts`, keyed by its
  asset group (`boss_hoarder`, `boss_juicer`, `boss_krakaren`,
  `boss_grotesque_spider`, `boss_colosseum`) in `bossRoomSheets.ts`, and
  `requestEnvironmentSheetsForGroups` paints every declared one in a single
  loop. `npm run gates:boss-rooms` checks those sheets against the manifest.
- When converting an existing PNG family, prove the port changed nothing:
  snapshot the sheets from git and run
  `npm run parity:props -- --family=<name> --ref=<dir>`. Every sheet must come
  through identical, or — for a difference you have understood and can justify —
  carry an entry in that script's `PARITY_BUDGETS` saying how large it is and
  why. The budget is a ceiling, so the check goes red again if it grows.

## Pipeline

1. **The painter and its layout.** For environment art this is a `PropSheetPlan` in `src/sprites/sheets/`, and the game paints it — see "Environment art is painted, not fetched" above; the `scripts/generate-*` entry points bake the same plans into `preview/props/` for review and never write into `src/images/`. For the remaining fetched sheets, a generator script under `scripts/` uses the `canvas` package (`createCanvas`) to draw each frame, tiles them into a grid (one row per state) and writes a PNG into `src/images/<category>/`. Either way the geometry constants — `FRAME_W`, `FRAME_H`, `TILE_SCALE`, `TILE_X`, `TILE_Y` — **must match the manifest entry**, and for a plan that agreement is proved by `propSheetPlanMismatches` rather than trusted.
2. **Manifest entry** in that category's `manifest.json`. Shape (`SpriteManifestEntry` in `src/core/SpriteLoader.ts`):
   - `path`, `frameWidth`, `frameHeight`
   - `tileX`/`tileY` — top-left of the logical tile within each frame (anchor offset)
   - `tileScale` — tile size the art was drawn at (runtime scales by `tileSize / tileScale`)
   - `states: { <name>: { row, colOffset?, frameCount } }` — standard state names: `walk`, `idle`, `attack`, plus `gore_*` colOffset states for body-part gore
   - optional `tileTypeId`/`blockedRegions` for environment collision
3. **Loader**: `src/core/SpriteLoader.ts` imports every category `manifest.json` and merges them; `SpriteKey` and `SpriteStates` are **compile-time types derived from the JSON**, so a new manifest key is immediately type-safe. A brand-new manifest _file_ (new category, or a boss with its own manifest) must be added to the import list at the top of `SpriteLoader.ts`. `loadSprites()` preloads everything; missing files are skipped silently — a blank sprite at runtime usually means a path typo.
4. **Draw wrapper**: `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite(...)`. It picks a state from animation flags and calls `drawSpriteKey(ctx, key, state, frame, sx, sy, tileSize, { flipX, alpha, rotation })` from `src/core/SpriteRenderer.ts`. Frame helpers: `walkFrameIndex(walkFrame, count)`, `progressFrameIndex(progress, count)`, `timeFrameIndex(...)`.

## Conventions

- Manifest keys are `snake_case` (`rat`, `goblin_base`); sprite modules are `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite`.
- Multi-layer sprites (e.g. goblin body + weapon overlay): separate manifest keys drawn at the same frame — see `src/sprites/goblinSprite.ts`.
- Reference shape (`src/sprites/ratSprite.ts`): attack anim → `attack` state via `progressFrameIndex`; moving → `walk` via `walkFrameIndex`; else `idle` frame 0. `flipX = facingX < 0`.

## Painted figures and the frame cache

Creatures are not sheets at all: each is a `FigureDef` (`src/sprites/figure/figureDef.ts`) whose `paintFrame` is baked into cells on demand by `src/sprites/figure/figureFrameCache.ts` (`drawFigureCached`). The `bipedal-figure` skill owns the painter pipeline; these are the cache contracts a figure opts into or must respect:

- **Per-figure budget.** Every figure's cells are held to a 24 MB default under a 96 MB global ceiling. `FigureDef.budgetMegabytes` replaces the default for one figure, and is legitimate only for a figure on screen almost every frame whose rows that must stay warm _together_ (locomotion, idle, whatever it is doing now) outgrow the default on their own. It never raises the global ceiling, so the room comes out of every other figure's share. Anything that checks a figure's bytes — admission, gates — goes through `figureByteBudgetFor(def)`, never `FIGURE_BYTE_BUDGET`, which only the cache's own gates read. Carl is the one figure that declares one (56 MB), gated by G9b.
- **`skipSupersample`.** Cells are normally painted at twice the density and downsampled. A figure that composes itself on a scratch surface at whatever density it is painted at, with whole-pixel effects (a one-pixel outline, a two-pixel cast shadow), sets this: its edges are already antialiased, and supersampling would compose four times the pixels only to smear those effects into half-pixel blurs.
- **Outfit variants and `releaseFigure`.** A cell is keyed on `(figure, state, frame)` and shared by every draw, so a closed set of looks is a set of figures, each with its own id and the same rows. Only the variant on screen should be resident: `releaseFigure(def)` drops every cell and queued prewarm of a replaced figure at once, instead of waiting out `IDLE_FRAMES_BEFORE_RELEASE` with two working sets side by side. Carl's `setHumanAppearance` releases the old outfit and prewarms the new one; anything that queued rows for the old outfit must ask again.
- **`prewarmFigureState(def, state, frameLimit?)`.** `frameLimit` warms only a row's first frames — a blow's wind-up up to its impact frame — so the rest can bake while those play. Repeated requests for the same row merge to the larger limit.
- **A throwing painter cannot poison later cells.** When a painter throws mid-bake, the cache discards the scratch surface it was painting on (a `save()` of the painter's own may still hold a clip and an alpha under the cache's restore) and rethrows; the next cell gets a fresh surface. `gates:figure-cache` asserts it. Painters should still restore their own state in `try/finally` — `withClip` in `src/sprites/art/softShade.ts` does.

## Animation cadence

A sprite row is sampled by however many game ticks the motion driving it lasts.
Past one sprite frame per tick the row is undersampled, not played — frames are
skipped, the legs jump between non-adjacent poses, and it reads as vibration or
a freeze. Nothing in typecheck, lint, the sheet, or a contact sheet shows it; it
is only visible in motion, at the real speed. This has bitten three separate
creatures here, in three disguises:

- A small fast creature on a distance-driven walk phase. A juvenile raptor's
  stride is 0.31 tiles, so covering the speed its AI asks for needs twelve
  strides a second — ninety-odd frames a second out of an eight-frame row.
  Neither the art nor the constant can fix it: a stride long enough to sync
  would step further than the leg extends and the reach gate rejects it. Cap
  the cadence with a ceiling derived from the fastest real locomotion
  (`MONGO_UNDERSAMPLING_FRAME_LIMIT` in `mongoSprite.ts` and
  `MAX_WALK_FRAMES_PER_TICK` in `Mongo.ts` are the pattern), so raising the
  sprint speeds the legs up with it instead of clamping to a stale number.
- A creature that changes speed for one state. A charging Tuskling sampled at
  the walk cadence skipped frames and read as vibrating rather than sprinting;
  the charge run needs its own frame counter at its own hold, not `walkFrame`.
- The dominant unbounded displacement is usually not the creature. The mob
  separation pass shoves an overlapped mob a large fraction of the overlap —
  several times its own per-frame step — so a distance-driven gait re-opens
  the strobe simply because the player stood next to it. Measure cadence from
  pixels actually covered and put a ceiling on it.

Two related traps: a preview scene that plays a row at a different fps than the
game does hides all of this (five rounds of art review missed a strobe because
the harness ran at 12 fps against a shipping 30) — derive the harness's
playback from the shared timing constant. And when a runtime frame count and a
bake gate must agree, put both on one shared timing module imported by the
generator and the runtime; a gate that parses frame counts out of source with a
regex silently passes the moment those literals become named constants.

## Views for a horizontal-bodied animal

Head-on and away views of a long, low animal are not a geometric projection of
the profile. A depth-ordered true projection of a raptor was measured to be
correct and was unreadable: the head could not be found at 32 px, the axial
views came out a third shorter than the profile, and the bite punched through
the floor. This game's convention — set by the rat's walk row — is head at the
top with any crest above it, body below, tail swept off the centreline. Follow
it.

## Checklist for a new creature sprite

1. Write the painter. Environment art: a `PropSheetPlan` in `src/sprites/sheets/`, baked for review into `preview/props/`. Everything else: a generator script writing a PNG into `src/images/<category>/`.
2. Add the manifest entry with matching geometry.
3. (Only if new manifest file) import it in `SpriteLoader.ts`.
4. Write the `src/sprites/*Sprite.ts` wrapper; call it from the creature's `render()`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
