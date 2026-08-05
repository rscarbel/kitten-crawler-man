# Asset Management

Sprite pixels and sound buffers are loaded on demand and released on floor change, so
resident memory scales with what a floor can actually show rather than with the total
size of the game. Four pieces make that work, and each imposes an obligation on anyone
adding a creature, a sheet or a sound.

## Sprite metadata stays eager; only pixels are lazy

`SpriteLoader` builds its derived lookup maps synchronously at import time from the
inlined manifest JSON — blocked-tile offsets, sprite extents, footprints, doorway
detection. Map generation, tile blocking and Y-sorting read those **synchronously,
before any image has loaded**.

`_manifest` and every map derived from it must therefore stay fully eager. Only `_defs`
— the `HTMLImageElement` / `HTMLCanvasElement` entries — is lazy. Any change that makes
manifest metadata conditional breaks map generation intermittently, and the failures do
not point at the cause.

A sprite miss is fail-safe by design: `getSpriteDef` records the miss, schedules that
key's load, and returns `undefined`, so the renderer draws nothing for a frame or two.
That is the same thing a genuinely missing sprite has always done, which is what makes
lazy loading safe here — and why every miss is logged once per key and dumped by the
`!assets` chat command.

## Declared coverage: what a floor can produce

`ASSET_GROUPS` (`src/core/assetGroups.ts`) names the sheets in each group. Its values
are typed `readonly SpriteKey[]`, not `string[]`, so a renamed or deleted manifest entry
fails `tsc` instead of vanishing at runtime. `LevelDef.spriteGroups` declares what a
floor loads.

**A floor's `LevelDef` does not list everything that can appear on it.** Bounty bosses,
quest creatures, companions and mid-fight summons are constructed by systems gated on a
map feature — a live bounty site, `gameMap.circusCentre`, `gameMap.spiderLabRoom`, a
hired mercenary — and are named in no spawn table. None of the five bounty bosses appears
in `level3.ts`, and they are among the largest sheets in the game.
`SYSTEM_ASSET_REQUIREMENTS` (`src/core/systemAssetRequirements.ts`) is where those get
declared, one entry per system or per bounty/quest type.

`requiredSpriteKeysForLevel(levelId, spriteGroups)` computes the union of the two. Both
the build-time check and the runtime eviction call it, so "what a floor needs" has
exactly one definition.

## Eviction is keyed on floor identity, not scene construction

`DungeonScene` calls `sceneManager.replace` at four sites, and only one of them is a
floor change: the stairwell's completion callback, which builds the scene for
`levelDef.nextLevelId`. Entering a building interior, leaving one, and the death restart
all rebuild `DungeonScene` around the _same_ floor. Evicting on scene construction would
re-download and re-decode hundreds of megabytes every time the player opened a shop door.
`releaseSpritesExcept` is called once, at the stairs transition, keyed on the new floor's
required keys.

## Sound is grouped the same way

Music tracks and ambience beds stream through `MediaElementAudioSourceNode` and are never
decoded into `buffers`. Everything else is a sound effect, preloaded per context from
`SFX_GROUPS` (`src/audio/sfxGroups.ts`): the core group at boot, a floor's groups from
`DungeonScene`'s constructor, an interior's from `BuildingInteriorScene`'s. Ids repeat
across groups on purpose — several bounty cues are stand-ins borrowed from a floor boss's
sample, so both owners preload them, and `preload` de-dupes against `buffers`.

## Resolution is not the lever

Most sheets are authored at `tileScale: 64` while `TILE_SIZE` is 32, which looks like a
4× overspend. It is not: at DPR 2 a 32px tile covers 64 device pixels, so those sheets
are exactly 1:1 on the screens most people play on. Halving the bake blurs the game.

`SpriteLoader` does keep a half-size downscale, but only past a hard
`Math.round(devicePixelRatio) >= 2` guard, checked _before_ the quality setting — DPR
wins over the `performance` preset, because the sheets were baked for DPR 2 specifically
rather than as a render-quality preference.

When that downscale runs, frame geometry is stored as the _exact_ half value and never
rounded; only the canvas's own backing-store dimensions round to whole pixels. Rounding
`frameWidth` independently makes `col * frameWidth` drift from the true scaled frame
boundary a little further with every column — invisible on frame 0, a visibly mis-cropped
frame at the end of a long animation row.

## Measuring any of this

`performance.memory` reports the JS heap only. Bitmaps and audio buffers live outside it,
which is why this looked like a non-problem for a long time. Use Chrome's Task Manager
for the per-tab total and cross-check with `ps -Ao rss,command | grep Renderer`.
Unregister the service worker first — it precaches every shipped asset and will serve a
stale bundle. A slow frame with a matching `longtask` entry is JS; a slow frame without
one is raster or GPU upload.

`npm run verify:assets` is the build-time gate: it proves every mob a floor can produce
has its sprite keys declared, so a creature can never reach a floor whose groups do not
carry its sheet.
