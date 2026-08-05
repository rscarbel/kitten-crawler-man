---
name: add-sprite
description: Add or modify a sprite in Kitten Crawler Man — PNG sprite sheets, JSON manifests, SpriteLoader/SpriteRenderer, offline generator scripts. Use when a creature, item, or effect needs new art or animation states.
---

# Add a Sprite

> **Human NPCs / townsfolk / crowds are NOT sprite sheets** — they're drawn procedurally at runtime from a seed. Use the `add-person` skill for those, not this pipeline.
>
> **Bipedal characters (humans, goblins, clowns, humanoid bosses) need the `bipedal-figure` skill first** — the rig/pose/view contract, gait authoring, bake gates and the image-review loop live there. Come back here for the manifest / loader / draw-wrapper wiring.
>
> **Ground and floor textures are NOT sprite sheets either** — they're generated
> by `scripts/generate-ground-tileset.ts` from wrapped noise. Use the
> `add-ground-tile` skill for terrain, paving, floors and tilesets.

Runtime rendering uses **PNG sprite sheets described by JSON manifests** under `src/images/<category>/` (`enemies/`, `bosses/`, `characters/`, `npcs/`, `effects/`, `environment/`). The sheets themselves are produced offline by procedural generator scripts in `scripts/` — though many are hand-drawn image assets.

## Pipeline

1. **Generator script** (`scripts/generate-<name>-sprite.ts`, run manually with `npx tsx scripts/generate-<name>-sprite.ts`): uses the `canvas` npm package (`createCanvas`) to draw each animation frame with 2D-canvas calls, tiles frames into a sheet grid (one row per state), and writes PNG(s) into `src/images/<category>/`. Top-of-file constants define the geometry: `FRAME_W`, `FRAME_H`, `TILE_SCALE`, `TILE_X`, `TILE_Y` — these **must match the manifest entry**. Existing scripts print them at the end for copy-paste. Model a new one on `scripts/generate-grotesque-spider-sprite.ts`.
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

1. Write + run the generator script → PNG in `src/images/<category>/`.
2. Add the manifest entry with matching geometry.
3. (Only if new manifest file) import it in `SpriteLoader.ts`.
4. Write the `src/sprites/*Sprite.ts` wrapper; call it from the creature's `render()`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
