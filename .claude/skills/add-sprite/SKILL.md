---
name: add-sprite
description: Add or modify a sprite in Kitten Crawler Man — PNG sprite sheets, JSON manifests, SpriteLoader/SpriteRenderer, offline generator scripts. Use when a creature, item, or effect needs new art or animation states.
---

# Add a Sprite

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

## Checklist for a new creature sprite

1. Write + run the generator script → PNG in `src/images/<category>/`.
2. Add the manifest entry with matching geometry.
3. (Only if new manifest file) import it in `SpriteLoader.ts`.
4. Write the `src/sprites/*Sprite.ts` wrapper; call it from the creature's `render()`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
