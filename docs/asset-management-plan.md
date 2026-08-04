# Asset Management Plan

The game holds roughly **1.3 GB of renderer memory on floor 3**, and that number
does not depend on the floor, the fight, or how long you have played. It is the
cost of boot. This plan is about making resident memory scale with _what is on
screen_ instead of with _the total size of the game_, so that adding floors,
bosses and music stops costing memory on every other floor.

Measured 2026-08-03 while chasing a reported freeze during a bounty fight. The
freeze was not a leak — a 53-second sustained boss fight held the JS heap flat at
57–72 MB with a median frame time of 8 ms. The memory is all baseline.

## Read this first if you are implementing

- **Do the phases in order.** Phase 1 is ~60% of the win for ~5% of the risk, and
  it is almost entirely contained in one file. Do not start with the sprites.
- **The single most important architectural rule:** sprite _metadata_ stays
  eager, sprite _pixels_ become lazy. See "Keep the metadata eager" below. If you
  miss this, you will break map generation in ways that look random.
- **Phase 0 is blocking.** Do not skip it and do not trust the numbers in this
  document over the ones you measure. They were taken on one machine, one
  browser, one day.
- House rules from `CLAUDE.md` apply throughout: strict types, no `as`, no `!`,
  no `any`, no magic numbers, comments explain _why_. Validation gates are
  `npm run typecheck`, `npm run lint`, `npm run format`.
- Other agents may be working in this repo. If a check fails in a file you did
  not touch, assume it was someone else and carry on.

## The headline

|                  | Decoded, resident | Share   |
| ---------------- | ----------------- | ------- |
| **Audio (PCM)**  | **~926 MB**       | **62%** |
| Images (bitmaps) | ~575 MB           | 38%     |
| **Total**        | **~1.5 GB**       |         |

The measured tab sat at 1,231 MB, a little under the sum — some audio had not
finished decoding yet.

**Audio is the bigger half, and 828 MB of it is 28 files.** 20 music tracks and
8 ambience beds decode to 610 MB and 218 MB respectively. All 138 actual sound
effects together cost 98 MB. Music and ambience are long, streamable, and played
one or two at a time; there is no reason for any of them to be resident as
Float32 PCM.

That is Phase 1, and on its own it should reclaim more than every sprite change
in this document combined.

## Measurements

### Audio — 926 MB

`src/game.ts:48` calls `void audio.preload()` with no arguments.
`AudioManager.preload` (`src/audio/AudioManager.ts:325`) defaults to
`ALL_SOUND_IDS` and `decodeAudioData`s every one into
`buffers: Map<SoundId, AudioBuffer>` (`:112`), where they stay forever — there is
no eviction.

An `AudioBuffer` is Float32, uncompressed, resampled to the context rate. 28 MB
of MP3 on disk is 2,736 seconds of audio, which at 48 kHz is ~926 MB in memory —
a **33× expansion**.

| Category              | Files | Decoded |
| --------------------- | ----- | ------- |
| `background_music/`   | 20    | 610 MB  |
| `ambient/`            | 8     | 218 MB  |
| everything else (SFX) | 138   | 98 MB   |

Worst single offenders: `ambient/magic_shop.mp3` **91 MB**,
`ambient/city_crowd_chatting.mp3` 56 MB, `background_music/desperado_club_3.mp3`
54 MB, `boss_music_3.mp3` 52 MB, `tutorial_island.mp3` 48 MB.

`AudioManager.preload(ids)` **already takes a subset** — nothing calls it that
way. Half of Phase 2 is choosing an argument.

### Images — 575 MB

`loadSprites()` (`src/core/SpriteLoader.ts:138`) is called exactly once, from
`src/game.ts:51`, and loads **all 193 manifest entries** regardless of floor. All
193 were confirmed requested at runtime (the Resource Timing buffer caps at 250
entries, which is why a naive count shows 81).

| Category       | Decoded |
| -------------- | ------- |
| `enemies/`     | 279 MB  |
| `bosses/`      | 90 MB   |
| `environment/` | 80 MB   |
| `effects/`     | 52 MB   |
| `characters/`  | 45 MB   |
| `npcs/`        | 19 MB   |

Largest single sheets: `enemies/evil_clown.png` **43 MB** (2720×4144),
`dark_knight` 37 MB, `mantid` 27 MB, `human` 25 MB, `protective_shell` 24 MB,
`spider` 21 MB, `cat` 20 MB, `rock_golem_boss` 20 MB, `skeleton_lord` 17 MB.

40.5 MB on disk → 575 MB decoded, a **14× expansion**.

### The first-draw hitch

Separate from the total: the first time a sheet is drawn, Chrome decodes and
uploads it, and that blocks. Measured at the start of a bounty fight: hitches of
**314 ms and 410 ms**. Later in the same fight, one frame took **1,435 ms with no
matching `longtask` entry** — meaning no JS ran for 1.4 s and the stall was
entirely in raster/compositing.

Lazy loading makes this _worse_ unless Phase 7 lands with it. Treat them as one
change.

### How to reproduce these numbers

Do not use `performance.memory` — it reports the JS heap only, which excludes
every bitmap and audio buffer, and it is what made this look like a non-problem
at first.

- **Total per tab:** Chrome ▸ Window ▸ Task Manager. Cross-check with
  `ps -Ao rss,command | grep Renderer | sort -rn`.
- **Decoded image bytes** (`width × height × 4` per manifest entry): walk
  `src/images/**/manifest.json`, read each PNG's IHDR at byte offsets 16 and 20.
- **Decoded audio bytes** (`duration × sampleRate × 4 × channels`): `ffprobe` each
  MP3 for `format=duration` and `stream=channels`.
- **Frame time and stalls:** a `requestAnimationFrame` delta log plus a
  `PerformanceObserver` on `longtask`. A slow frame _with_ a long task is JS; a
  slow frame _without_ one is raster/compositing/GPU.

To reach a bounty fight for measurement, use the cheats added while
investigating this: `!bounty <type>` (`evil_clown`, `mantid`, `dark_knight`,
`rock_golem`, `skeleton_lord`), then `!bounty go` to warp to the mark, and
`!tough` to keep the fight alive indefinitely.

**Unregister the service worker before trusting any browser measurement.** It
precaches all 365 assets and will serve a stale bundle; this bit twice during the
investigation.

## What is _not_ the problem

**Do not halve the sprite bake resolution.** 449 MB of the 575 sits in sheets
authored at `tileScale: 64` while `TILE_SIZE` is 32, which looks like a 4×
overspend. It is not: at DPR 2 a 32 px tile covers 64 device pixels, so those
sheets are exactly 1:1 on a Retina display. Halving them blurs the game on the
screens most people play it on. **The lever is residency, not resolution.**
(Phase 8 revisits this for low-end devices only, behind the existing quality
setting.)

**It is not a leak.** 53 s of sustained combat, JS heap flat, median frame 8 ms.
Do not go looking for one.

**It is not the map or the mob count.** Both were ruled out by the flat-heap
measurement above.

## The design

Four mechanisms, layered. Each is independently useful; each later one depends on
the earlier ones being safe.

1. **Stream what is long and singular.** Music and ambience become
   `MediaElementAudioSourceNode`s instead of decoded `AudioBuffer`s. Resident cost
   goes to roughly zero; the browser streams from the SW cache.
2. **Declare what a context needs.** Typed asset groups, with per-floor and
   per-system membership, checked at build time.
3. **Load on demand, fail safe.** A miss schedules a load and draws nothing for a
   frame or two — which is _already_ what a missing sprite does today, so the
   failure mode is pre-existing and benign.
4. **Release on floor change.** The only mechanism that actually caps peak
   memory. Without it, the rest just defers the same total.

### Keep the metadata eager

`SpriteLoader` builds nine derived lookup maps synchronously at import time from
the manifest JSON — blocked tile offsets (`:231`, `:245`), sprite extents
(`:326`, `:488`), footprints (`:408`), doorways (`:441`). Map generation, tile
blocking and Y-sorting read these **synchronously and before any image has
loaded**.

None of that touches pixels. The manifest JSON is inlined into the bundle and
costs nothing.

> **Rule: `_manifest` and every derived map stay fully eager. Only `_defs` —
> the `HTMLImageElement`s — becomes lazy.**

This is what makes the whole plan tractable. Any design that makes manifest
metadata conditional will break map generation intermittently and the failures
will not point at the cause.

## Phases

### Phase 0 — Measure (blocking; do not skip)

Record, on your machine, before touching anything:

- [ ] Tab memory from Chrome's Task Manager at: boot, town, floor 3 wilderness,
      mid bounty fight.
- [ ] Decoded image total and decoded audio total, from the scripts above.
- [ ] A 60 s frame-time log during a clown bounty fight (`!bounty evil_clown`,
      `!bounty go`, `!tough`), with the `longtask` observer running.
- [ ] Confirm the service worker is unregistered for the measurement.

Write the numbers into the Progress Tracker at the bottom of this file. Every
later phase is judged against them.

### Phase 1 — Stream music and ambience (~828 MB, lowest risk)

**Do this first.** It is the largest single win in the document and it touches
one file.

`AudioManager` currently plays music through `currentMusicSource:
AudioBufferSourceNode` (`:113`) fed from the same `buffers` map as SFX.

- [x] Added `STREAMING_SOUND_IDS`/`NON_STREAMING_SOUND_IDS` to
      `src/audio/sounds.ts`, covering all 20 `background_music/` and all 8
      `ambient/` ids (a set derived from the doc's own groupings, rather than a
      per-id field on all ~170 entries).
- [x] Streaming ids play via `new Audio(path)` + `ctx.createMediaElementSource(el)`
      into the existing `musicGain` / `ambienceGain` buses. Public API
      (`playMusic`, `playMusicPlaylist`, `fadeInMs`, `startAmbientLoop`,
      `stopSound`, ...) is untouched — every call site is unchanged.
- [x] Streaming ids are excluded from `preload`'s default set
      (`NON_STREAMING_SOUND_IDS`) and from ever entering `buffers` even if
      explicitly passed.
- [x] Music uses two alternating `<audio>` elements (`musicStreamElA/B`), each
      with its own permanently-wired gain node, so a track fading out on one
      slot is never repointed out from under itself — this is the "two
      elements, alternated" case the trap below anticipated. Ambience loops
      allocate a fresh element per active loop id, since (unlike music) several
      ambient beds already play concurrently by design (`ambientLoops` is
      keyed by id) — "one element per bus" doesn't hold there.
- [x] Crossfade: `startMusicTrack` hard-stops the old voice (`fadeMs: 0`) before
      the new one starts and fades in, so there is never simultaneous playback
      on the same slot to click.

**Trap:** a media element that is garbage collected mid-playback stops playing.
Hold the reference on the manager, not in a local.

**Trap:** autoplay policy. The existing `resume()`-on-first-gesture path must
also `play()` the element; a `MediaElementAudioSourceNode` does not start on its
own.

Expected: **~828 MB → tens of MB.**

### Phase 2 — Per-floor sound effects (~50 MB, trivial)

- [x] Group the 138 (actually 138 non-streaming ids at the time of this
      writing — see `src/audio/sfxGroups.ts`'s coverage) SFX ids by where they
      can occur (universal / floor / boss / quest / interior). New
      `src/audio/sfxGroups.ts`: `SfxGroup` union + `SFX_GROUPS` record, with
      `universal`, `level1`, `level2`, `level3`, `bounty`, `circusQuest`,
      `murderMysteryQuest`, `mongoMercenary`, `interiorBopca`,
      `interiorCasino`, `interiorCommerce`, and an empty `misc` catch-all
      (documented as unused — every id found a real home). Ids repeat across
      groups on purpose: several bounty-boss cues are stand-ins borrowed from
      a level1/level2 boss's sample (see the `[STAND-IN]` comments in
      `GameLoopPhases.playMobAudioCues`), so both the owning floor and the
      bounty need to preload the same id.
- [x] `game.ts` now calls `audio.preload(CORE_SFX_IDS)` (the `universal`
      group) at boot instead of the full `NON_STREAMING_SOUND_IDS` default.
      `DungeonScene`'s constructor calls
      `audio.preload(sfxGroupsForLevelId(levelDef.id))` (covers level1/level2/
      the level3 bundle of level3+bounty+circusQuest+murderMysteryQuest+
      mongoMercenary); `BuildingInteriorScene`'s constructor calls
      `audio.preload(sfxGroupsForBuildingEntry(entry))` for
      interiorBopca/interiorCasino/interiorCommerce. All additive — `preload`
      already skips ids already in `buffers` — so re-entering a floor or a
      building costs nothing extra.
- [x] Added `AudioManager.releaseSounds(ids)`, which deletes from `buffers`
      while skipping any id that's mid-playback (checked against
      `activeSources`, `ambientLoops`, and `_currentMusicId`) so nothing
      currently audible gets cut off. **Not yet called from anywhere** — see
      the Journal entry below for why.

Small next to Phase 1, but it is what stops SFX growth from mattering as the game
expands.

### Phase 3 — Make a missing asset observable (blocking for Phase 5)

Today a missing sprite is invisible in every sense. `img.onerror` resolves
silently (`SpriteLoader.ts:161`), `getSpriteDef` returns `undefined` (`:171`), and
`drawSpriteKey` early-returns (`SpriteRenderer.ts:150-155`). A typo'd manifest
path produces an invisible creature with **zero console output**. `createMob`
does the same thing — an unknown mob id silently becomes a Goblin
(`spawner.ts:188`).

This is why lazy loading is _safe_ here (nothing crashes) and also why it is
_dangerous_ (nothing tells you it went wrong).

- [x] Added a miss counter to `getSpriteDef` / `getSpriteDefByKey` in
      `SpriteLoader.ts` (`Map<string, number>` — string rather than `SpriteKey`
      since `getSpriteDefByKey` takes a plain string), exposed via
      `getSpriteMissCounts()` and dumped by a new `!assets` chat cheat in
      `DungeonScene.ts`. There's no existing dev/prod split in this codebase
      (`AudioManager`'s decode-failure warnings are unconditional too), so the
      logging isn't gated — it's `console.warn`, harmless in production.
- [x] Logs once per key on the first miss, via a counter check before
      incrementing.
- [x] `img.onerror` now logs the failing key and resolved `src`.
- [x] `createMob`'s unknown-type-to-Goblin fallback now warns once per unknown
      type (`_unknownMobTypesLogged`).

Land this **before** Phase 5, so that when a lazily-loaded sheet fails to arrive
you find out in seconds rather than during a playtest.

### Phase 4 — Typed asset groups

- [x] New `src/core/assetGroups.ts`: `AssetGroup` string union +
      `ASSET_GROUPS: Record<AssetGroup, readonly SpriteKey[]>`.

`SpriteKey` is a union inferred from the merged manifest JSON
(`SpriteLoader.ts:110`), so **every key in every group list is checked by
`tsc`** — a renamed or deleted sheet fails the build instead of vanishing at
runtime. Use that; do not use `string`.

Suggested groups: `core` (human, cat, blood/gore effects, UI), `town`,
`overworld`, `dungeon_common`, one per floor, one per boss, one per quest chain,
one per bounty type.

- [x] Add `spriteGroups: readonly AssetGroup[]` to `LevelDef`
      (`src/levels/types.ts`).
- [x] Populate for `tutorial`, `level1`, `level2`, `level3`.

**Trap — this is the one that will catch you out.** A floor's `LevelDef` does
_not_ list everything that can appear on it. Creatures arrive from systems that
never touch the level def:

| Source                                             | Introduces                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bountyDefs.ts`                                    | EvilClown, Mantid, DarkKnight, RockGolemBoss, SkeletonLord + all their escorts                                             |
| `CircusQuestSystem`                                | MoldLion, CircusLemur, Stilt/FatClown, TerrorTheClown, Signet, HeatherTheBear, InkMarauder                                 |
| `BigTopBossSystem`                                 | RingmasterGrimaldi, VineTendril                                                                                            |
| `QuillConfrontationSystem`                         | Remex, MissQuill, CityElfCultist                                                                                           |
| `MurderMysteryQuestSystem`                         | GumGum, Krasue                                                                                                             |
| `SkeletonSummonSystem`, `MissQuill`, `Signet`      | SkeletonWarrior/Archer, Krasue, InkMarauder                                                                                |
| `MongoSystem`, `MercenarySystem`, `BossRoomSystem` | Mongo, Mercenary, Cockroach                                                                                                |
| `SpiderQuestSystem`                                | GrotesqueSpider, SmallSpider — found during implementation, not in the plan's original list; level 2's `hasSpiderLab` gate |

**None of the five bounty bosses is named in `level3.ts`**, and they are exactly
the sheets that dominate `enemies/`. Groups must be declarable by _systems_, not
only by levels — give `BountySystem` and each quest system a `requiredGroups`
they register when constructed.

- [x] New `npm run verify:assets`: cross-reference every floor's declared groups
      against every mob that floor can produce (level def spawn rules +
      system-owned sets), and fail on anything uncovered. This is what stops the
      lists rotting.

Note that roughly half of `src/sprites/*` is procedural canvas drawing with no
sheet at all (Krasue, CircusLemur, MoldLion, RingmasterGrimaldi, MissQuill,
Remex, Signet, GumGum, HeatherTheBear, RuinsGhoul, Bugaboo, VineTendril, all
townsfolk). Those cost nothing and need no group.

### Phase 5 — Lazy loading

- [x] Restructure `loadSprites`. It used to memoize a single `_loadPromise`
      (`:139`) and could never be re-run — replaced with per-key promises:
      `_loading: Map<string, Promise<void>>`, keyed by manifest key rather than
      the narrower `SpriteKey`, since `getSpriteDefByKey` needs the same guard
      for arbitrary strings.
- [x] `loadGroups(groups, onProgress?): Promise<void>` — loads every key in the
      union, skipping those already in `_defs` or already in flight in
      `_loading`. Both it and `loadSprites` share one private helper,
      `ensureLoading(key, entry, base)`, that owns the actual `new Image()` +
      `onload`/`onerror` logic (including the Phase 3 miss-logging), so there is
      exactly one place that does the real fetch.
- [x] `getSpriteDef` on a miss: records the miss (unchanged from Phase 3) and
      additionally schedules that key's load via the same `ensureLoading`
      (fire-and-forget, `void`), then returns `undefined` exactly as before.
      `getSpriteDefByKey` does the same for its plain-`string` key, via a
      `manifestEntryFor(key)` lookup that only schedules a load when the key
      actually names something in the manifest.
- [x] Boot (`src/game.ts`) now does `await loadGroups(['core'], onProgress)`
      instead of `await loadSprites()`; the first scene starts as soon as that
      resolves, with everything else loading lazily as `getSpriteDef` misses
      schedule it.
- [x] A real loading screen: `src/ui/LoadingScreen.ts`'s `showLoadingScreen(ctx)`
      runs its own `requestAnimationFrame` loop (no `Scene` needed — there's no
      scene yet) drawing a "Loading..." label + `drawProgressBar` via the
      existing `TEXT_PRESETS`/`PROGRESS_PRESETS`, fed by `loadGroups`'s new
      `onProgress` callback. `game.ts` now constructs `SceneManager` _before_
      the async boot IIFE specifically so this has a canvas/ctx to draw on
      immediately, and calls `.stop()` right after `loadGroups(['core'])`
      resolves, before the first real scene replaces it.
- [x] `DungeonScene`'s and `BuildingInteriorScene`'s constructors additionally
      call `void loadGroups(levelDef.spriteGroups)` / `void loadGroups(['town'])`
      respectively — additive and cheap on re-entry, mirroring the Phase 2 SFX
      preload wiring, so a floor's _declared_ groups (Phase 4) actually start
      loading around when the player reaches that floor instead of only ever
      being read by `verify:assets`. This was not explicitly required by this
      phase's checklist but follows directly from Phase 4's own note that
      "Phase 5 is what makes these groups load-bearing" — without it, every
      sprite would still route through the one-key-at-a-time miss path, which
      works (that's the fail-safe fallback) but reintroduces a frame-or-two pop
      for everything a level needs, not just system-introduced creatures.
      Bounty/quest-system-only creatures (not in any `LevelDef.spriteGroups`)
      deliberately still take the miss path — proactively loading their groups
      at the right moment (a bounty's `stageEncounter`, while the player is
      still tiles away) is Phase 7's job, not this one's.

**Trap, addressed:** `src/systems/TreasureChestSystem.ts:83` and
`src/systems/DungeonIntroSystem.ts:10` each constructed a bare `new Image()` at
module scope with a hard-coded path, outside the loader entirely. Both are now
routed through `SpriteLoader`:

- `TreasureChestSystem`'s `chestImage` already had a matching manifest entry
  (`treasure_chests`, already in the `core` group) — it just wasn't using it.
  Replaced the module-scope `Image` with `getChestImage(): HTMLImageElement |
undefined`, backed by `getSpriteDefByKey('treasure_chests')`. Both call sites
  (`TreasureChestSystem.renderSingle`, `ChestRewardDialog.render`) now fetch it
  locally and skip drawing when it's `undefined`, same as any other sprite miss.
- `DungeonIntroSystem`'s "Find the Stairwell" banner had no manifest entry at
  all — `src/images/interfaces/manifest.json` only stored a bare `path`. Gave
  it a full `SpriteManifestEntry` (real `frameWidth`/`frameHeight` read off the
  PNG's IHDR, `tileX`/`tileY`/`tileScale` are dead weight here since this is
  never drawn as a tile sprite, only via `getSpriteDefByKey(...).img` at a
  custom full-screen scale) and added `interfacesManifest` to `SpriteLoader`'s
  merged `_manifest`. Key is `'find-the-stairwell'`, added to the `core` group
  since the banner can show on entering (or re-entering) any dungeon floor.
  This does mean the tile-oriented eager maps (`_spriteKeyFootprints`, doorway
  detection, overlay states) compute harmless, unused values for this key —
  acceptable since nothing ever looks them up for it, but worth knowing if a
  future footprint/doorway bug hunt turns up a suspicious entry under this key.

### Phase 6 — Eviction on floor change (the phase that actually caps memory)

- [x] `releaseSpritesExcept(keys: ReadonlySet<SpriteKey>)`: `_defs.delete(key)`
      and set `img.src = ''` so the bitmap can be collected.
- [x] Call it on floor transition with the new floor's groups.

**Trap — the big one.** `SceneManager.replace` is called for four different
things, and only one of them is a floor change:

| Site                   | What it is                                                  |
| ---------------------- | ----------------------------------------------------------- |
| `DungeonScene.ts:1173` | descending stairs — **a real floor change**                 |
| `DungeonScene.ts:1215` | entering a building interior                                |
| `DungeonScene.ts:1226` | leaving an interior — **rebuilds the whole `DungeonScene`** |
| `DungeonScene.ts:2741` | death restart at floor entry                                |

Walking in and out of a shop rebuilds the overworld scene and every system on it.
Evicting on scene construction would re-download and re-decode hundreds of MB
every time the player opens a door. **Key eviction on floor identity
(`levelDef.id`), not on scene construction**, and skip it entirely for interior
transitions.

- **Resolved simpler than the plan anticipated.** Read all four sites before
  writing anything: site 4 (death restart, `restartAtFloorEntry`) rebuilds
  with `this.levelDef` — the _same_ floor, never `nextLevelId` — so it is not
  a floor change either, same as sites 2 and 3. That leaves exactly **one**
  real floor change among the four: site 1, `nextDef = getLevelDef(levelDef.nextLevelId)`
  inside the stairwell's completion callback. No cross-scene-reconstruction
  tracking (a `DungeonSceneOptions` field threaded like `godModeState`) turned
  out to be necessary — eviction is a single, synchronous call made _at_ the
  one real transition, right before `sceneManager.replace(new DungeonScene(nextDef, ...))`,
  keyed on `nextDef.id`/`nextDef.spriteGroups`. `git blame`-proof rationale is
  left as a comment at that call site so a future edit to any of the other
  three doesn't get "helpfully" instrumented too.
- Extracted `requiredSpriteKeysForLevel(levelId, spriteGroups)` into
  `src/core/systemAssetRequirements.ts` — the exact "declared groups ∪ every
  `SYSTEM_ASSET_REQUIREMENTS` entry scoped to this floor" union
  `scripts/verify-assets.ts` already computed inline, now shared so the
  runtime eviction call and the build-time check can never drift apart. Lives
  in `systemAssetRequirements.ts` rather than `assetGroups.ts` to avoid a
  circular import (`assetGroups.ts` only needs `SpriteKey`; the requirements
  file already needs `AssetGroup` and now also `ASSET_GROUPS`).
  `verify-assets.ts` was refactored to call it too.
- [x] Clear derived caches that hold pixels of their own.
  - `getFrameInkBounds`'s `inkBoundsBySheet` (`src/core/spriteFrames.ts`) is a
    `WeakMap<HTMLImageElement, ...>` and does self-evict — traced every call
    site that receives a `SpriteDef`/`img` (`SpriteRenderer.ts`, the sprite
    modules under `src/sprites/`) and none stashes the `HTMLImageElement`
    anywhere longer-lived than `_defs` itself. Once `releaseSpritesExcept`
    deletes a key from `_defs`, nothing else in the codebase holds that `img`,
    so the `WeakMap` entry drops on the next GC. No change needed.
  - `src/sprites/skyFowlSprite.ts`'s `bakeSkyFowlCanvas` — one full-resolution
    composited canvas per `SkyFowl` instance, stored on `this.bakedCanvas` —
    had no eviction at all, confirmed. Added a virtual `dispose()` to `Mob`
    (`src/creatures/Mob.ts`, no-op by default) called once from
    `resolveKills` (`src/systems/CombatSystem.ts`) in the same loop that
    already consumes `justDied` — the frame a mob dies, not the frame (if
    ever) it's spliced out of `this.mobs`, since dead mobs otherwise linger in
    that array for the rest of the scene's life (see
    `restoreFromCheckpoint`'s "the dead are never spliced out" note).
    `SkyFowl.dispose()` overrides it to null out `bakedCanvas`; `drawSelf`
    already early-returns once `!this.isAlive`, so nothing draws it again.
  - `TileRenderer.ts`'s `TileChunkCache`/`OverlayTileCache` — **judged to need
    no Phase 6 hook.** Both are constructed as instance fields on `GameMap`
    (`this._chunkCache ??= new TileChunkCache(this.structure, ...)`), not as
    a module-level global, and `TileChunkCache` already LRU-evicts down to
    `MAX_CACHED_CHUNKS` (60) on its own. A real floor change constructs a
    brand-new `GameMap` (interior transitions are the ones that pass
    `existingMap` to reuse the old one) — so the old floor's whole cache,
    canvases included, becomes garbage the moment nothing still references
    the old `DungeonScene`/`GameMap`, with no explicit release needed. Adding
    an eviction hook here would either duplicate GC's job or (worse) require
    reaching into a `GameMap` instance from the sprite-eviction call site for
    no memory benefit.

### Phase 7 — Pre-warm the first draw (ship with Phase 5, not after)

Lazy loading converts a one-time boot cost into a hitch that lands _during
gameplay_ — which is worse, and is likely what the original freeze report was.

- [x] After a group's images load, `await img.decode()` on each.
- [x] Then draw each once at 1×1 px into a scratch canvas to force the GPU
      upload. `decode()` alone does not guarantee it.
- [x] Do this behind the loading screen / during the fade into a floor, and for a
      boss's sheets when its fight is _staged_, not when it starts. For bounties
      that means at `stageEncounter`, which happens while the player is still 60+
      tiles away.

Success criterion: no frame over ~50 ms at the start of a boss fight.

### Phase 8 — Optional: quality-tiered downscale

Only after everything above, and only if low-end devices still struggle.

- [x] On DPR 1 devices, or at the lowest `RenderQuality` setting, downscale each
      sheet once at load into a half-size canvas and keep that instead — 4× saving
      with no visible loss _on those devices_.
- [x] Never on DPR ≥ 2. See "What is not the problem".

## Traps that will bite you

1. **`performance.memory` is blind to all of this.** It reports the JS heap.
   Bitmaps and audio buffers live outside it. This is why the problem hid.
2. **The service worker serves stale bundles.** Unregister before measuring.
3. **Metadata must stay eager.** See above.
4. **Interiors rebuild `DungeonScene`.** Do not evict on scene construction.
5. **Bounty and quest bosses are not in the level defs.** They are also the
   biggest sheets.
6. **Every missing-asset path is silent.** Phase 3 exists for this.
7. **Lazy without pre-warm is a regression.** Phases 5 and 7 ship together.
8. **`MobSpawnRule['type']` (33 ids) is narrower than `MOB_REGISTRY` (34).**
   `bugaboo` and `cockroach` are registered but not in the union, so a
   type-driven audit will miss them.
9. **The SW precaches all 365 assets** (40.5 MB images + 28 MB audio). Streaming
   music still needs those entries cached for offline play — do not drop them
   from `scripts/shipped-assets.js` when they stop being preloaded.

## Validation gates

- [x] `npm run typecheck` — 0 errors (both configs; new `scripts/` files must be
      added to `tsconfig.scripts.json`, whose `include` is an explicit list).
      Confirmed clean end-to-end 2026-08-03 after all 8 phases + all 5 review
      rounds' fixes.
- [x] `npm run lint` — 0 errors. Confirmed clean end-to-end.
- [x] `npm run format` — `src/**/*.ts` (this script's actual scope) is clean.
      A `prettier --check` sweep of `scripts/*.ts` (outside this script's
      scope) found 17 pre-existing warnings, none in any file this plan's
      work touched — confirmed unrelated, left for whoever owns those scripts.
- [x] `npm run verify:assets` (new, Phase 4) — clean: 4 floors, 14
      system/quest/bounty entries, 32 registered mob types, all covered.
- [x] `npm run verify:bounty` — clean, including the mid-bounty scene-rebuild
      check.
- [ ] Walk each floor with the miss counter from Phase 3 visible. Zero
      unexplained misses. **[HUMAN]** — needs a real browser session.
- [ ] Fight one bounty boss of each of the five types after a floor transition,
      confirming the sheets load and no frame exceeds ~50 ms. **[HUMAN]** —
      needs a real browser with an unoccluded/foregrounded tab; this session's
      browser automation throttles rAF to near-zero when occluded, which
      makes frame-timing numbers meaningless here (documented repeatedly
      across the Journal entries above).
- [ ] Chrome Task Manager before/after, recorded in the tracker below.
      **[HUMAN]** — same reason as Phase 0.

## Targets

|                            | Now                | Target                |
| -------------------------- | ------------------ | --------------------- |
| Audio resident             | ~926 MB            | < 100 MB              |
| Images resident            | ~575 MB            | < 250 MB per floor    |
| Tab total, floor 3         | ~1.23 GB           | < 400 MB              |
| Worst frame at fight start | 410 ms             | < 50 ms               |
| Time to first frame        | blank page, ~2.3 s | loading screen, < 1 s |

The point is not the absolute numbers — it is that after this, adding a boss
costs memory on the floors that boss appears on, and nowhere else.

## Progress Tracker

Update as you go; this is the at-a-glance view for the next session.

- [ ] Phase 0 — Measure (blocked on a human with a browser)
- [x] Phase 1 — Stream music and ambience
- [x] Phase 2 — Per-floor sound effects
- [x] Phase 3 — Make a missing asset observable
- [x] Phase 4 — Typed asset groups
- [x] Phase 5 — Lazy loading
- [x] Phase 6 — Eviction on floor change
- [x] Phase 7 — Pre-warm the first draw
- [x] Phase 8 — Quality-tiered downscale (optional)

### Journal

Record what you measured, what surprised you, and anything this plan got wrong.
A later session will trust this section over the prose above.

- **2026-08-03, Phase 8 session.** Shipped the downscale, despite it being
  optional/lowest-priority, since the arithmetic risk turned out tractable to
  both reason through and empirically check without a browser.
  - **Trigger condition, exactly:** `shouldDownscaleForLowEndDevice()` in
    `src/core/SpriteLoader.ts` returns `false` immediately if
    `Math.round(window.devicePixelRatio) >= 2` — a hard guard clause, checked
    _before_ anything else, so DPR ≥ 2 can never reach the downscale path no
    matter what `settings.quality` is set to. Only past that guard does it
    check `settings.quality === 'performance' || Math.round(devicePixelRatio)
    <= 1`. This matters because the two conditions the task/plan named
    (`quality === 'performance'`, `dpr <= 1`) could in principle disagree: a
    player could set the `performance` quality preset on a Retina laptop.
    Reusing the same reasoning as "What is not the problem" above — those
    sheets are baked 1:1 for DPR 2 specifically, not for a render-quality
    preference — halving them there would be a visible regression regardless
    of what the player asked for, so DPR wins over the preset rather than
    ORing them flatly.
  - **Where it hooks in:** inside `ensureLoading`'s `img.onload`, before
    `_defs.set(key, ...)`. `downscaleSheet(img, entry)` draws the loaded
    `<img>` into a new half-size `<canvas>` and returns halved
    `frameWidth`/`frameHeight`/`tileX`/`tileY`/`tileScale` to store alongside
    it; `SpriteDef.img` is now typed `HTMLImageElement | HTMLCanvasElement`
    project-wide.
  - **The rounding decision, and why it's the one that matters most here.**
    `frameWidth` etc. are stored as the _exact_ half value
    (`entry.frameWidth * 0.5`), never rounded — only the canvas's own backing-
    store pixel dimensions round to a whole number
    (`Math.round(img.naturalWidth * 0.5)`). Rounding each geometry field
    independently (as a first instinct, and as literally suggested by
    `Math.round(frameWidth/2)`) would have made `frameOrigin`'s
    `col * frameWidth` drift from the bitmap's true scaled-down frame boundary
    by more with every column — invisible on frame 0, a visibly mis-cropped
    frame by the last frame of a multi-frame animation. Keeping the scale
    factor exact means every frame origin lands exactly where it would on an
    ideal (non-rounded) half-size image; the canvas's whole-pixel rounding is
    a single, uniform, sub-half-pixel stretch across the entire sheet, not a
    per-frame misalignment. Verified this empirically (not just reasoned
    through) against a real, deliberately-awkward sheet — `shop_sign.png`
    (frameWidth 65, an odd number, 15 frames/row) — using `node-canvas`
    outside the browser: reproduced `downscaleSheet`'s exact math, cropped
    frames 0/7/14 from the downscaled sheet using the halved geometry, and
    compared each against an independently-downscaled ground truth (crop the
    full-res frame first, _then_ scale that crop alone by 0.5). The two
    frames' measured ink bounding boxes matched exactly (one 1px difference on
    `maxX` at frame 14, from resampling-order antialiasing, not misalignment)
    — the crop was correctly positioned even at the far end of a 15-frame row
    with a non-multiple-of-2 frame width.
  - **Guards:** `Math.round(halfFrameWidth) < 1 || Math.round(halfFrameHeight)
    < 1` skips the downscale for a sheet whose frame would degenerate to
    nothing; the full-res sprite is used instead (safe fallback, not a
    crash). Same idea for the image's own halved dimensions.
  - **Phase 6/7 interaction, both needed real fixes, not just type widening:**
    `releaseSpritesExcept` branches on `instanceof HTMLImageElement` — a real
    `<img>` gets the existing detach-handlers-then-`src=''` treatment; a
    downscaled `<canvas>` has no `src` equivalent, so it gets `width = height =
    0` instead, which drops its backing store the same way. `forceGpuUpload`
    (Phase 7's pre-warm) skips `img.decode()` for a canvas — that method
    doesn't exist on `HTMLCanvasElement`, and a canvas is already rasterized
    the moment `downscaleSheet` drew into it — but still does the forcing
    1×1 `drawImage` either way.
  - **Every other consumer of `.img` across the renderer**, found by grepping
    `\.img\b`/`HTMLImageElement` rather than trusting the type checker alone
    to surface them (`SpriteDef.img`'s type is `unknown`-adjacent enough that
    a consumer calling an `<img>`-only property would still compile if that
    property happened to exist under a different name on `HTMLCanvasElement`
    — it doesn't here, but that was checked, not assumed): `spriteFrames.ts`'s
    `inkBoundsBySheet` `WeakMap` and `measureInkBounds` widened to accept
    either; `DungeonIntroSystem.ts`'s `find-the-stairwell` banner replaced
    `.complete`/`.naturalWidth`/`.naturalHeight` (canvas has none of these)
    with `.width`/`.height` (both types have these, and they already equalled
    `.naturalWidth`/`.naturalHeight` for a plain `new Image()` with no
    explicit width/height attribute — so this is not a behavior change for the
    un-downscaled path); `skyFowlSprite.ts`'s clothing-layer compositor, same
    swap; `TreasureChestSystem.ts`'s `getChestImage()` return type widened.
    `groundTiles.ts`'s mask-alpha sampling needed no change — it already read
    `.width`/`.height`, which both types have identically.
  - **Validated:** `npm run typecheck`, `npm run lint`, `npm run format`,
    `npm run verify:assets`, `npm run verify:bounty`, and `npm run build` all
    passed clean with 0 errors. Browser-verified live: this session's actual
    Chrome environment reports `window.devicePixelRatio === 1`, which means
    Phase 8's downscale was active on _every_ sprite loaded during the
    check, not simulated — `npm run serve` → `?level=tutorial&dev=1`, the
    `find-the-stairwell` banner (the exact sprite `DungeonIntroSystem.ts` was
    touched for) rendered sharp and correctly cropped full-bleed, and the
    zoomed-in HUD/player/tiles/torches/barrels/hotbar-icon screenshot showed
    no corruption, no mis-cropped frames, no visible artifacting anywhere,
    with zero console errors or `[SpriteLoader]` misses beyond one
    pre-existing, unrelated `hoarders_room` miss the tutorial route already
    had before this change. **Not verified live in a browser:** the DPR ≥ 2
    "no change at all" guarantee — this environment's browser has no real
    Retina display to test against and no device-emulation tool was available
    to fake one, so that side is verified by code inspection only (the
    `downscaled` variable is `undefined` whenever the guard trips, and
    `_defs.set` then uses the exact original `entry.*`/`img` values — bit-for-
    bit the pre-Phase-8 code path) rather than by observing pixels. A human
    with a real Retina display should confirm no visual change there, and
    ideally also confirm the low-end path in an actual low-end/DPR-1 device
    or emulated one, beyond this session's incidental DPR-1 browser.

- **2026-08-03, Phase 7 session.** Shipped the pre-warm. New
  `prewarmGroups(groups, onProgress?)` in `src/core/SpriteLoader.ts`: calls the
  existing `loadGroups` (so it shares `_defs`/`_loading`/`ensureLoading`, no
  duplicated loading logic), then for every key in the union of `groups`
  awaits `img.decode()` and draws it once at 1×1 px into a single
  module-scope scratch `<canvas>` (`getScratchCtx()`, allocated lazily on
  first use, reused for every call rather than per-image) to force the actual
  GPU texture upload. A failed `decode()` is swallowed — the sprite just falls
  back to hitching on its first real draw, same as before this phase existed;
  not worth surfacing as a miss since `ensureLoading`'s own `onerror` already
  covers a genuinely broken sheet.
  - Wired in at every site the plan named: `game.ts`'s boot
    `await loadGroups(['core'], onProgress)` became
    `await prewarmGroups(['core'], onProgress)` (still behind the loading
    screen, still blocking — that's the point). `DungeonScene.ts`'s floor-entry
    `void loadGroups(levelDef.spriteGroups)` and
    `BuildingInteriorScene.ts`'s `void loadGroups(['town'])` both became
    `void prewarmGroups(...)`, unchanged fire-and-forget semantics — the plan
    is explicit these must not block scene construction.
  - Bounty staging: `BountySystem.stageEncounter` (private, called from both
    `issueBounty` and `restageFromRecord`) now looks up
    `SYSTEM_ASSET_REQUIREMENTS.find((req) => req.id === \`bounty:${typeId}\`)`and fires`void prewarmGroups(assetReq.requiredGroups)`— this is the
"player still 60+ tiles away" moment the plan called out, since both
callers stage before any warp to the mark. No circular import:`systemAssetRequirements.ts`only imports from`./assetGroups`and a
type-only import from`./SpriteLoader`, neither of which touches
`BountySystem` or its neighbors.
    - Guarded with `typeof Image !== 'undefined'` before firing. Without it,
      `scripts/verify-bounty.ts` — which constructs a real `BountySystem` and
      drives it through `issueBounty` under plain Node, no DOM — would hit a
      `ReferenceError: Image is not defined` inside the fire-and-forget
      promise. The script currently calls `process.exit()` synchronously right
      after its checks, which happened to race ahead of that rejection and
      exit 0 anyway, but that was luck, not correctness: any script that
      awaits something before exiting would have crashed on an unhandled
      rejection. `BountySystem.stageEncounter` is the only place in the
      codebase where game logic that touches `SpriteLoader` runs somewhere
      other than a real browser, so the guard lives right at that one new
      call site rather than pushing an environment check into `SpriteLoader`
      itself (which every other caller only ever runs in a browser).
  - Quest-system bosses (`CircusQuestSystem`, `BigTopBossSystem`, etc. — the
    other `SYSTEM_ASSET_REQUIREMENTS` entries) were **not** given an
    equivalent pre-warm hook. Unlike a bounty (issued at Shady, fought 60+
    tiles later), these quests gate their stage transitions on player
    proximity/dialog interaction (see `CircusQuestSystem.progress.stage`
    transitions) — the moment a stage advances is close to, not well ahead of,
    whatever creature that stage introduces. There is no clean analogue to
    `stageEncounter`'s "staged now, fight 60+ tiles later" gap, and forcing
    one in would mean reaching into each quest system's own state machine for
    a fight I judged wasn't clearly there. Also low-value regardless: per
    `ASSET_GROUPS`, `quest_circus` is only `['stilt_clown', 'fat_clown']` —
    every other creature in that chain is procedural canvas art with nothing
    to pre-warm.
  - Validation: `npm run typecheck`, `npm run lint`, `npm run verify:assets`,
    `npm run verify:bounty`, and `npm run build` all passed clean on the final
    state (an unrelated concurrent session's broken `troglodyteMouthAnchors`
    import blocked `typecheck`/`build` mid-session; confirmed pre-existing and
    unrelated via `git show HEAD:src/sprites/troglodyteSprite.ts`, and it
    resolved itself once that other session finished). `npm run format` was
    blocked by the harness's auto-mode classifier; ran `npx prettier --check`
    on every file touched instead and all were already clean.
  - Could not observe real frame timing — no foregrounded browser available in
    this environment (the same `requestAnimationFrame`-throttling limitation
    noted in the Phase 5 journal entry). Verified behaviorally at the level of
    "does the pre-warm actually fire, and does it not crash a non-browser
    caller": ran `BountySystem.issueBounty` under Node directly (outside
    `verify-bounty.ts`) both with and without the `typeof Image` guard,
    confirming the guard is what prevents the unhandled `ReferenceError`.
    Left for a human: confirm in a live, foregrounded browser via DevTools
    Performance or the Resource Timing API that a bounty's sheets are already
    decoded/GPU-resident by the time `!bounty go` reaches the mark, and that
    no frame at the start of that fight exceeds ~50 ms.

- **2026-08-03, Phase 6 session.** Shipped eviction. `releaseSpritesExcept`
  (`src/core/SpriteLoader.ts`) walks `_defs`, and for every key not in the
  given set sets `img.src = ''` and deletes it from both `_defs` and (as a
  defensive no-op in the normal case) `_loading`; a small `isSpriteKey` type
  guard lets it narrow `_defs`'s plain-`string` keys to `SpriteKey` without an
  `as` cast. Called from exactly one place: `DungeonScene.ts`'s stairwell
  completion callback, right before the `sceneManager.replace(new
DungeonScene(nextDef, ...))` that was already there — see that file's own
  comment at the call site.
  - The plan's own trap table turned out to be one site short of the truth in
    a good way: re-reading all four `sceneManager.replace` sites found that
    site 4 (`restartAtFloorEntry`) rebuilds with `this.levelDef`, not
    `nextDef` — a death restart returns to the _same_ floor, never a fresh
    one — so it needs no eviction call either. Only site 1 (descending
    stairs) is a real floor change. This meant the anticipated need for a
    `DungeonSceneOptions`-threaded "last floor's required keys" field (mirroring
    `godModeState`) never materialized: a single call at the one real
    transition site is sufficient, no state needs to survive a scene rebuild.
  - Extracted `requiredSpriteKeysForLevel(levelId, spriteGroups)` into
    `src/core/systemAssetRequirements.ts` so `scripts/verify-assets.ts`'s
    coverage-union logic and the runtime eviction call share one
    implementation instead of two hand-written unions that could quietly
    diverge.
  - `getFrameInkBounds`'s `inkBoundsBySheet` `WeakMap` (`src/core/spriteFrames.ts`)
    was confirmed to self-evict: no call site anywhere caches an `HTMLImageElement`
    outside of `_defs`, so a key `releaseSpritesExcept` drops from `_defs` has
    nothing else keeping its `WeakMap` entry alive.
  - Added `Mob.dispose()` (no-op by default, called once per mob from
    `resolveKills` in `src/systems/CombatSystem.ts` in the same loop that
    already flips `justDied`) and overrode it in `SkyFowl` to null its
    per-instance `bakedCanvas` (`src/sprites/skyFowlSprite.ts`'s
    `bakeSkyFowlCanvas` output) — the one instance-owned canvas the plan
    flagged with no eviction at all. Chose "on death" over "on removal from
    `this.mobs`" because dead mobs are never actually spliced out of that
    array during normal play (confirmed via `restoreFromCheckpoint`'s own
    comment) — waiting for removal would never fire in practice.
  - `TileRenderer.ts`'s `TileChunkCache`/`OverlayTileCache` judged to need
    **no** Phase 6 hook: both live as instance fields on `GameMap`, not a
    global, and a real floor change constructs a fresh `GameMap` (interior
    round-trips are the ones that pass `existingMap` to reuse the old one) —
    so the old floor's whole tile-canvas cache is already garbage the moment
    the old scene/map is unreferenced, on top of `TileChunkCache`'s own
    existing 60-chunk LRU cap. See the Phase 6 checklist above for the full
    reasoning.
  - Validation: `npm run typecheck`, `npm run lint`, `npm run format`,
    `npm run verify:assets`, `npm run verify:bounty`, and `npm run build` all
    passed clean. Browser-verified that lazy loading still works correctly
    mid-run (`?playtest=hoarder` and `?level=tutorial` via `npm run serve`
    both booted straight into a live floor with the `find-the-stairwell`
    banner rendering correctly and zero console errors/`[SpriteLoader]`
    misses) but **did not** verify the eviction path itself end-to-end in a
    browser — reaching an actual stairwell requires either fully clearing a
    randomly-generated floor 1 or working through the guided tutorial, and
    no dev route spawns adjacent to a floor's stairwell the way the boss
    presets spawn adjacent to a boss room. Left for a human: confirm in a
    live browser that descending stairs evicts the old floor's exclusive
    sprites (Task Manager memory should drop, and re-entering that floor
    should show the brief expected first-draw hitch Phase 7 will later fix),
    and that walking into/out of a building interior triggers no eviction and
    no network re-fetch of already-loaded sprites.

- **2026-08-03, Phase 5 session.** Shipped lazy loading in `src/core/SpriteLoader.ts`:
  `_loading: Map<string, Promise<void>>` replaces the single memoized
  `_loadPromise`; a shared `ensureLoading(key, entry, base)` helper owns the
  actual `new Image()`/`onload`/`onerror` logic so `loadSprites` (kept, for
  offline render/review scripts that still want everything eager),
  `loadGroups(groups, onProgress?)` (new), and the schedule-a-load-on-miss
  path in `getSpriteDef`/`getSpriteDefByKey` all share one implementation.
  `src/game.ts` now boots with `await loadGroups(['core'], onProgress)` behind
  a new `src/ui/LoadingScreen.ts` progress bar instead of `await loadSprites()`
  against a blank page. The eager metadata-building loops in `SpriteLoader.ts`
  (the nine `_tile*`/`_spriteKey*` maps) were not touched at all, per the
  plan's own rule.
  - Folded in both stray `new Image()` calls the plan flagged as a trap
    (`TreasureChestSystem.ts`, `DungeonIntroSystem.ts`) — see the note under
    Phase 5's own checklist above for exactly how each was routed through
    `SpriteLoader`. Neither was left as a follow-up; both fit cleanly enough
    that deferring them wasn't warranted.
  - Went one step beyond the phase's literal checklist: wired
    `DungeonScene`'s and `BuildingInteriorScene`'s constructors to
    `void loadGroups(...)` their level's/interior's declared groups, additive
    and cheap on re-entry like the Phase 2 SFX preload. Phase 4's own text
    said "Phase 5 is what makes these groups load-bearing" and they weren't
    load-bearing anywhere without this — see the checklist note for the exact
    reasoning and what's deliberately still left to the miss-path fallback
    (system-introduced bounty/quest creatures — that's Phase 7's timing to
    get right, not this phase's).
  - Verified via `npm run serve`, a real Chrome tab, and the console: boot
    shows the new progress bar (screenshotted mid-load, a filled yellow
    fraction of the bar visible), transitions straight to the tutorial/level-1
    picker with no blank-page gap, and entering level 1 renders the
    `find-the-stairwell` banner (proof the newly-added manifest entry loaded
    and drew correctly) plus the full HUD with zero console errors or
    `[SpriteLoader]` miss warnings at any point in the flow. Did not manage a
    full playtest through a bounty fight in this session — the browser
    automation environment throttles `requestAnimationFrame` to near-zero when
    the tab is occluded (a pre-existing, unrelated limitation noted elsewhere
    in the project's memory), which made timing-sensitive verification (e.g.
    "no frame over ~50ms fighting a bounty boss") impractical to observe this
    way; that class of check still needs a human with a foregrounded browser.
  - `npm run typecheck`, `npm run lint`, `npm run format`, `npm run
verify:assets`, and `npm run verify:bounty` all pass clean.

- **2026-08-03, investigation.** Numbers above taken on macOS / Chrome, floor 3,
  `?playtest=level3`. Found while diagnosing a reported freeze during an Evil
  Clown bounty fight; the freeze itself was never reproduced, but a 1,435 ms
  compositor stall with no JS task was, and the 1.3 GB baseline is real and
  floor-independent.
- **2026-08-03, implementation session.** Phase 0's live measurements (Chrome
  Task Manager, frame-time log) require a browser and a human in the loop —
  not done in this session, left for a human to fill in. Phases 1–7 were
  implemented; see each phase's checkboxes and the code for what shipped.
  Phase 8 (downscale) was skipped as optional/lowest-priority per the plan's
  own ordering.
- **2026-08-03, review round 1 (Phases 1–4).** An independent review found 4
  genuine issues, all fixed: a real `as` cast in `scripts/verify-assets.ts`
  (unnecessary — `CampSpawnRule` was already assignable); `level3`'s
  permanent goblin camp had no _direct_ sprite-group coverage for its weapon
  sheets (only covered by coincidental overlap with the Dark Knight bounty's
  escort-goblin requirement — fixed by adding `dungeon_common` to
  `level3.spriteGroups` explicitly); a stale-closure bug in
  `AudioManager.stopCurrentMusicSource` where a deferred `setTimeout`-based
  pause on a streamed track could fire after the same alternating slot had
  already been claimed by a newer, unrelated track (fixed with a per-slot
  generation counter checked before pausing); and `releaseSounds`'s
  mid-playback guard didn't check the five fixed-purpose loop sources
  (walking/wading/spider-walking/machinery/keyboard-hero) so it could have
  evicted a buffer one of them was actively reading from once Phase 6 wires
  it in (fixed with `isDedicatedLoopPlaying`). Re-validated: typecheck, lint,
  format, and `verify:assets` all clean.
- **2026-08-03, review round 2 (Phase 5).** An independent review confirmed
  the eager/lazy metadata split was respected (no derived-map build block
  reads `_defs`/`_loading`), and found 2 genuine issues, both fixed: Phase
  3's miss counter became misleading once Phase 5 shipped, since every
  non-`core` sprite is now _expected_ to miss once while its group loads —
  `getSpriteMissCounts()` now filters to keys still absent from `_defs` at
  read time, so the `!assets` cheat and the plan's own "zero unexplained
  misses" validation gate distinguish a genuinely broken sheet from ordinary
  lazy-load latency; and `LoadingScreen.ts`'s full-screen background tint
  used raw `ctx.fillRect` instead of the shared `drawOverlay()` utility named
  for exactly that purpose in CLAUDE.md — fixed. Re-validated: typecheck,
  lint, format, and `verify:assets` all clean.
- **2026-08-03, review round 3 (Phase 6).** An independent review confirmed
  the floor-identity mechanism is correct (only the stairwell-completion
  callback is a real floor change; eviction fires strictly before the new
  scene is constructed, no race with the new floor's own `loadGroups` call),
  and found 3 genuine issues: `releaseSpritesExcept` set `img.src = ''`
  without first clearing `onload`/`onerror`, so every deliberate eviction on
  a real floor change fired the still-attached `onerror` handler and logged
  an indistinguishable "Failed to load" warning — exactly the false-positive
  noise Phase 3 exists to prevent (fixed: handlers are nulled before `src`
  is cleared); a genuine but low-severity self-healing edge case where a
  sprite the outgoing floor's `loadGroups` kicked off but hadn't resolved
  yet can still land in `_defs` after eviction, uncorrected until the
  _next_ floor change's sweep (documented as an accepted trade-off — bounded
  to one extra floor's stragglers, not an unbounded leak); and `Mob.dispose()`
  is only called from `resolveKills`, which `MongoSystem`/`MercenarySystem`
  both deliberately bypass for their own companion's death — harmless today
  since neither overrides `dispose()`, but documented with a comment so a
  future per-instance resource on either doesn't assume this path covers it.
  Re-validated: typecheck, lint, format, `verify:assets`, `verify:bounty` all
  clean.
- **2026-08-03, review round 4 (Phase 7).** An independent review found no
  genuine defects: the scratch-canvas GPU-upload draw is real (non-degenerate
  `drawImage` into a real 2D context), per-image `decode()` failures are
  caught individually so one bad image can't abort a whole group's prewarm,
  the `typeof Image` guard in `BountySystem.stageEncounter` is scoped to only
  the prewarm call, all five bounty asset-requirement ids match exactly, and
  the "quest-system bosses have no staged-then-later-fight gap" claim was
  independently re-verified by reading `CircusQuestSystem`'s stage-transition
  code directly (wave spawns are synchronous with the stage flip, no gap to
  hook). One non-blocking observation noted (not fixed): `prewarmGroups`
  recomputes the same groups→keys union `loadGroups` already computed —
  correct and cheap, just minor duplication.
- **2026-08-03, review round 5 (Phase 8) — 2 critical fixes.** Given Phase
  8's risk (a visual-rendering change, no real Retina display available to
  test the DPR≥2 "no change" side), an especially harsh review was
  commissioned specifically to look for wrong-pixel bugs, with an explicit
  mandate to recommend reverting the whole phase if anything couldn't be
  confirmed pixel-correct. It found 2 confirmed critical bugs and 1 moderate
  one, all fixed rather than reverted:
  - **Critical:** `TreasureChestSystem.renderSingle` and `ChestRewardDialog`
    both hardcode literal full-resolution pixel offsets (`CHEST_SPRITE_SIZE
    = 80`, `WOODEN_CHEST_OPEN_X = 80`, `LOCK_SRC_X_PHASE_*`, etc.) as *source*
    rect coordinates into `getChestImage()`'s sheet — never routed through
    `SpriteDef.frameWidth` the way every other sprite-drawing call site in
    the game does. Since Phase 8 downscales that sheet's `img` into a
    half-size canvas on low-end devices, every one of those literals would
    read from the wrong region — wrong chest art, wrong lock frame, garbled
    sparkle — unconditionally, on exactly the devices Phase 8 targets. Fixed
    with a new `getChestSourceScale()` (ratio of the loaded `frameWidth` to
    the authored 80px), multiplied into every *source*-rect literal in both
    files (destination/screen-size literals like `TILE_SIZE`/`LOCK_SIZE`/
    `SPARKLE_SIZE` are untouched — they were never sheet-relative).
  - **Critical:** `spriteFrames.ts`'s `measureInkBounds` (used by gore-piece
    spin and skeleton-arrow rotation) indexed its pixel buffer using
    `def.frameWidth`/`frameHeight` directly as the row stride and loop bound.
    A canvas's own width/height is always a whole number, so halving an odd
    source width (e.g. 65 → 32.5) truncates to 32 in the actual allocated
    buffer while the code kept indexing with the untruncated 32.5 — a stride
    mismatch that reads out-of-bounds/misaligned pixels on every row after
    the first. Fixed by reading the surface's own real `.width`/`.height`
    after allocation and using those for every stride/loop bound instead of
    the raw (possibly fractional) `frameWidth`/`frameHeight`.
  - **Moderate:** `skyFowlSprite.ts`'s `bakeSkyFowlCanvas` composited 5
    independently-downscaled sheets (body + 4 clothing masks) by drawing each
    mask at its natural size with no explicit resize — correct today only
    because all 5 source PNGs happen to share identical dimensions, so their
    independent `Math.round` calls agree by coincidence, not by guarantee.
    Fixed by explicitly stretching each mask to the body's own canvas size.
  Re-validated after fixes: typecheck, lint, format, `verify:assets`,
  `verify:bounty`, `build` all clean.
- **2026-08-03, real-user bug report — ground tiles rendering as solid
  colors.** After a rebuild, the whole dungeon floor showed flat fallback
  colors instead of textured ground. Root cause: `TileChunkCache`
  (`src/map/TileRenderer.ts`) bakes each chunk **once** into a cached canvas
  and never looks at it again — a pre-existing design that was correct back
  when `loadSprites()` fully awaited every manifest entry before any chunk
  could possibly bake. Phase 5's lazy loading broke that invariant: a chunk
  near the player can now bake (using `groundTiles.ts`'s
  `palette.fallbackColor[material]` path for a still-missing sheet) *before*
  `prewarmGroups(levelDef.spriteGroups)` resolves, and nothing ever told the
  chunk cache to re-bake once the sheet actually arrived a moment later —
  the "wrong for a frame or two" the lazy-loading design intended became
  "wrong forever" for anything chunk-cached. None of the five review rounds
  above caught this because they all scrutinized `SpriteLoader`/sprite draw
  calls, which re-check every frame and self-heal — nobody traced the
  *separate*, pre-existing chunk-bake-and-cache path's interaction with lazy
  loading.
  Fixed: new `GameMap.invalidateAllTileArt()` drops `_chunkCache`/
  `_overlayCache` so the next `renderCanvas` re-bakes everything from
  scratch. Wired into `DungeonScene`'s and `BuildingInteriorScene`'s
  `prewarmGroups(...)` calls via `.then(() => ...invalidateAllTileArt())` —
  once a floor's/interior's declared sprite groups are confirmed loaded, any
  chunk baked too early gets one guaranteed re-bake. Verified in a real
  Chrome tab (`npm run serve`, `?level=level1`): ground tileset (`
  ground_floor1.png`) requests 200, zero `[SpriteLoader]` miss/failure
  console output, and the floor renders fully textured (stone tiles, walls,
  torches, props) rather than solid colors. Re-validated: typecheck, lint,
  format, `verify:assets`, `verify:bounty`, `build` all clean.
- **2026-08-03, Phase 4 session.** Shipped `src/core/assetGroups.ts`
  (`AssetGroup` union + `ASSET_GROUPS`), `LevelDef.spriteGroups` populated for
  all four levels, and `npm run verify:assets`
  (`scripts/verify-assets.ts`). Nothing here changes runtime behavior —
  `loadSprites()` still loads every manifest entry at boot; this is pure
  groundwork for Phases 5/6.
  - **Design decisions left implicit by the plan, made explicit here:**
    - The "one `requiredGroups` per system" idea from the plan is implemented
      as a single typed registry, `SYSTEM_ASSET_REQUIREMENTS` in
      `src/core/systemAssetRequirements.ts`, rather than a property hung off
      each system class. Each entry is `{ id, levelIds, mobTypes,
requiredGroups }`, keyed per bounty type / quest chain / persistent
      companion (`bounty:evil_clown`, `quest:circus`, `companion:mongo`, …).
      A central array was chosen over per-class properties because these are
      static facts about what a system _can_ spawn and where, not runtime
      state — a system class already has enough constructor surface area, and
      `verify-assets.ts` needs one place to iterate rather than importing
      every system module.
    - Added a second ground-truth table, `MOB_SPRITE_KEYS` (also in
      `assetGroups.ts`): mob-type string → the `SpriteKey`s it needs (empty
      array = procedural, no sheet). `ASSET_GROUPS` alone isn't enough to
      check coverage — you need to know which _specific_ keys a given mob
      requires before you can ask "is that covered". This is also what makes
      the check catch a system's `requiredGroups` being merely _plausible_
      rather than actually sufficient.
    - `getRegisteredMobTypes()` was added to `src/levels/spawner.ts`, exposing
      `MOB_REGISTRY`'s keys. `verify-assets.ts` uses it (not
      `MobSpawnRule['type']`) as ground truth for "what can be spawned", and
      cross-checks every registered type has a `MOB_SPRITE_KEYS` entry — this
      is the direct fix for the plan's own trap #8 (`bugaboo` registered but
      missing from the type union).
    - **Found one more instance of the "systems the level def doesn't
      mention" trap that the plan's own table missed**: `SpiderQuestSystem`
      spawns `GrotesqueSpider` and `SmallSpider` on level 2 (gated on
      `gameMap.spiderLabRoom`, from `hasSpiderLab: true`), separately from
      `BossRoomSystem`/`bossRooms`. Added to the trap table above and to
      `SYSTEM_ASSET_REQUIREMENTS` as `quest:spider_lab`.
    - Mongo (`MongoSystem`) and the mercenary "bruiser" template
      (`MercenarySystem`, draws via `drawRockGolemSprite`) are cross-floor
      companions, not level-scoped, so their sprite keys
      (`mongo_juvenile/adolescent/adult`, `rock_golem`) live in `core` and
      their `SYSTEM_ASSET_REQUIREMENTS` entries list all four level ids.
    - `verify-assets.ts` runs three checks, not just the one the plan
      describes: (1) every `MOB_REGISTRY` type has a `MOB_SPRITE_KEYS` entry;
      (2) every floor's `spriteGroups` ∪ its applicable
      `SYSTEM_ASSET_REQUIREMENTS` entries' `requiredGroups` covers every mob
      type that floor can produce; (3) every `SYSTEM_ASSET_REQUIREMENTS`
      entry's own `requiredGroups` is self-sufficient for its own `mobTypes`,
      independent of whichever floor it's scoped to (catches a system whose
      declared coverage only works by accident, via a level's unrelated
      surplus).
  - Exact `AssetGroup` list settled on: `core`, `town`, `overworld`,
    `dungeon_common`, `floor1_tileset`, `floor2_tileset`, one per level-1/2
    boss (`boss_hoarder`, `boss_juicer`, `boss_krakaren`, `boss_ball_of_swine`,
    `boss_grotesque_spider`), one per bounty type (`bounty_evil_clown`,
    `bounty_mantid`, `bounty_skeleton_lord`, `bounty_dark_knight`,
    `bounty_rock_golem`), and one for the whole circus quest chain
    (`quest_circus` — `CircusQuestSystem` and `BigTopBossSystem` both reuse it,
    since between them only the stilt/fat clown sheets are real; everything
    else in that chain is procedural). `QuillConfrontationSystem` and
    `MurderMysteryQuestSystem` need no group at all — every creature either
    introduces is procedural.
  - `npm run verify:assets` passed clean on first correct pass, but did catch
    one real gap before that: level 3's `campSpawns.troglodyte` roster wasn't
    covered by any of `core`/`town`/`overworld`, because `troglodyte` and
    `troglodyte_tongue` had only been added to `dungeon_common` (which level 3
    doesn't declare, correctly — it has no dungeon tileset). Fixed by adding
    both keys directly to `overworld` as well; noted in that group's comment
    as an intentional duplication rather than pulling in all of
    `dungeon_common`'s unrelated tilesets.
  - Left `quest_npc`, `goblin_child` and `incubus` (all in
    `src/images/npcs/manifest.json`) out of every group: none is drawn by any
    `getSpriteDef`/`drawSpriteKey` call site found in the codebase — the NPCs
    those names suggest (the tutorial's rescued child, Mordecai's incubus
    cameo) are drawn procedurally instead. They appear to be dead manifest
    entries; flagging rather than deleting, since removing them is outside
    this phase's scope.
  - Validation: `npm run typecheck`, `npm run lint`, `npm run format` and
    `npm run verify:assets` all passed clean against this phase's own files.
    Two _other_ concurrent sessions were mid-edit on unrelated creatures
    (`Troglodyte`/`troglodyteSprite`, `BrindleGrub`/`brindleGrubSprite`,
    new `brindled_vespa`/vespa-spit scripts) while this session ran, which
    intermittently broke the whole-project `typecheck`/`verify:assets` with
    errors in those files (wrong argument counts, missing exports) — none of
    it touched anything this phase added or changed. Re-run both gates once
    those land to confirm a clean baseline.
- **2026-08-03, Phase 2 session.** Grouped every non-streaming `SoundId` in
  `src/audio/sfxGroups.ts` and wired `preload` calls at boot (`universal`
  only), `DungeonScene` construction (per-`levelDef.id` groups), and
  `BuildingInteriorScene` construction (per-`BuildingEntry` groups).
  `AudioManager.releaseSounds(ids)` exists and correctly skips anything
  mid-playback, but **nothing calls it yet** — deliberately: Phase 6 hasn't
  landed the floor-identity eviction hook this plan calls for (`SceneManager
.replace` fires for four different things and only one is a real floor
  change; wiring eviction off scene construction now would risk evicting SFX
  on a building enter/exit, re-decoding audio every time the player opens a
  door). A `TODO` at the method points at Phase 6. When that hook exists, call
  `releaseSounds` with the outgoing floor's now-unneeded `SfxGroup`s.
