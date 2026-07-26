# Performance Optimization Checklist

Progress tracker for `docs/performance-optimization-plan.md`. Read the plan section
for a task before starting it — this file is only the tracker.

**Rules for implementing agents:**

- Work top to bottom, phase by phase. Do not start a phase until the previous phase's
  gate line is checked.
- Check items off (`[x]`) as you complete them. If you intentionally skip or defer an
  item, mark it `[~]` and add a one-line note under it saying why.
- After every task: `npm run typecheck` and `npm run lint` must exit 0, then run
  `npm run format`.
- Locate code by symbol name, not by the plan's line numbers (they drift).
- Behavior must be identical after every task unless the plan explicitly says
  otherwise (e.g. quantized animation phases). When in doubt, preserve behavior.

---

## Phase 0 — Quick wins

- [x] 0.1 `JuicerRoomSystem.update`: move the `roomOriginX` guard above the `mobs.find` scan
- [x] 0.2 `CircusQuestSystem.update`: phase guard above the signet/InkMarauder mob loop (and same check in `BigTopBossSystem` if unguarded)
- [x] 0.3 `BarrierSystem`: `slowedLastFrame` list instead of clearing `isSlowed` on all mobs; same pattern for `SpellSystem`'s `isConfused` sweep
- [x] 0.4 `Scene.ts`: catch-up cap of 2 updates + drop remaining accumulator debt (named constant)
- [x] 0.5 `MiniMapSystem.revealAround`: early-out when player tile unchanged
- [x] 0.6 `GameMap.findPath`: hoist the 8-direction array to module scope
- [x] 0.7 `DungeonScene` spider audio: single start/stop decision after the loop, not per spider
- [x] **Phase 0 gate:** typecheck + lint + format pass; quick play test on level 1 and level 3

## Phase 1 — Walkability bitmask

- [x] 1.1 Add `blockedMask: Uint8Array` to `GameMap` with named bit-flag constants (`BLOCK_EXTRA`, `BLOCK_PERMANENT`, `BLOCK_ARENA_DOOR`, `BLOCK_STAIRWELL`)
- [x] 1.2 Populate the mask in `buildExtraBlockedTiles` (no per-tile string building on this path) and in every mutator of the four sets (`blockTilePermanently`, `unlockArenaStairwell`, `markTileDirty`, plus any other `.add`/`.delete` call sites found by search)
- [x] 1.3 Rewrite `isWalkable` / `isWalkableIgnoringPermanent` to bounds-check + mask read (arena-door bit only when `arenaDoorLocked`); rewrite `isStairwellTile` as one bit test
- [x] 1.4 Add module-scope `WALKABLE_BY_TILE_TYPE` lookup table; `isWalkableTileType` reads it instead of the `!==` chain
- [x] 1.5 Shared packed-index helper (`tileIndex(x, y, gridSize)`) defined in exactly one place; `TownLifeSystem.doorTiles` converted to `Set<number>` and `isWalkableSpot` allocation-free
- [x] 1.6 Verify: no template strings remain in the walkability hot path (grep for `` `${tileX},${tileY}` `` and `` `${tx},${ty}` `` in `GameMap.ts` hot functions)
- [x] **Phase 1 gate:** typecheck + lint + format pass; play test — blocked tiles, building walls, stairwell tiles, and (on an arena level) the locked arena door all behave exactly as before

## Phase 2 — Pathfinding

- [x] 2.1 `src/core/MinHeap.ts` created (JSDoc'd binary min-heap over numeric priorities)
- [x] 2.2 `findPath` rewritten: heap open set, packed-index nodes, reusable `gScore`/`cameFrom`/`visitedStamp` typed arrays with generation stamping, `push`+`reverse` path build, cached cardinal walkability for diagonal checks; semantics (diagonal corner rule, expansion cap) unchanged
- [x] 2.3 Distance guard: `MAX_PATH_DISTANCE_TILES` early-out + expansion cap scaled to request distance (named constants)
- [x] 2.4 `Mob`: per-mob `astarStagger` (constructor, wander-stagger idiom) added to refresh interval
- [x] 2.5 `Mob`: `ASTAR_FAILURE_BACKOFF_FRAMES = 120` on empty path result
- [x] 2.6 `Mob`: repath when goal tile changes (tracked `astarGoalTX/TY`)
- [x] 2.7 `MobUpdateLoop`: global `MAX_PATHFINDS_PER_FRAME` budget, reset each frame; over-budget mobs keep stale path this frame
- [x] 2.8 `CompanionSystem`: minimum repath gap (`MIN_REPATH_GAP_FRAMES`) on goal-tile-change trigger
- [x] **Phase 2 gate:** typecheck + lint + format pass; play test — mobs chase/flank normally, aggroing a ghoul pack on level 3 causes no hitch, companion follows through doorways

## Phase 3 — Line of sight

- [x] 3.1 Per-mob per-frame LOS cache; creatures' attack gates reuse `updateLastKnown`'s result (no second raycast)
- [x] 3.2 LOS refresh throttled to every `LOS_REFRESH_FRAMES = 3` frames for chasing mobs
- [x] 3.3 `hasLineOfSight` rewritten as integer DDA/Bresenham tile walk (one check per crossed tile), JSDoc'd; early `true` within one tile
- [x] **Phase 3 gate:** typecheck + lint + format pass; play test — mobs lose sight behind buildings/walls same as before

## Phase 4 — Townsfolk update

- [x] 4.1 `TownLifeSystem` owns a `SpatialGrid<Townsperson>`; inserted on spawn, moved on update
- [x] 4.2 `separate()` queries grid neighbors within `SEPARATION_DIST` (behavior preserved)
- [x] 4.3 Distance LOD: full-rate updates within `FULL_UPDATE_RADIUS_TILES`; distant citizens tick 1-in-`DISTANT_TICK_INTERVAL` frames via per-person phase
- [x] 4.4 `findNearestTownsperson` uses the grid + squared distance
- [x] 4.5 `stepWander` writes into an `out` parameter (no per-person object per frame)
- [x] **Phase 4 gate:** typecheck + lint + format pass; play test — plaza crowd flows the same, citizen talk prompt and dialog work, no stacking/wall-clipping

## Phase 5 — Rendering caches

- [x] 5.1a Person colors: `shade`/`tint` results precomputed into `PersonAppearance` at generation time
- [x] 5.1b Person frame cache: facings × `WALK_PHASE_BUCKETS = 8` cells rendered lazily via unchanged `drawPerson`, LRU-capped (`MAX_CACHED_PEOPLE`), used by `Townsperson.render` and market vendors
- [x] 5.2a Static clutter props baked once per kind (one `drawImage` per render)
- [x] 5.2b Lamp/sign animation quantized to named step counts and cached per step; `shadowBlur` removed from `streetLamp` and gate-arch glow (pre-baked halo sprite + `lighter` compositing)
- [x] 5.3 `SPRITE_BUILDING` / `MAIN_TOWER` added to `OverlayTileCache` keyed `(type, tx, ty, animFrame)`; overhead computation extended for full sprite extent
- [x] 5.4a Static per-map decoration list, row-bucketed, built once; per-frame iteration uses per-tile-type cull extents (oversized anchors — tower/club/Big Top — kept in a small always-checked list)
- [x] 5.4b Decoration results emitted into pooled/reused storage (no per-frame object array); destructible `damageStage` still updates via dirty-tile flow
- [x] 5.4c `OverlayTileCache`: numeric keys + `invalidateTile` wired into the `_dirtyTiles` loop
- [x] 5.5 `TileChunkCache`: ≤1 cold bake per frame with direct-draw fallback; `MAX_CACHED_CHUNKS` LRU eviction; optional 1-ring pre-bake
- [x] 5.6 Visibility fog: gradient disc baked once, per-frame blit + 4 solid rects
- [~] 5.7 Y-sort: treasure chests are now viewport-culled; the pre-sorted merge was **not** done
      Reason: the static decoration list is only in row (ty) order, but `sortY` is
      `ty * TILE_SIZE + sortYAnchorPx` — and `sortYAnchorPx` varies per sprite within a row,
      while trees use a wholly different formula (`ty - TREE_SORT_DEPTH_OFFSET`). The list is
      therefore not sorted by `sortY`, so merging it as if it were would reorder the draw
      pass and change depth. Left as a single sort.
- [x] **Phase 5 gate:** typecheck + lint + format pass; visual diff pass on level 3 (people, lamps, signs, fountain, tower, fog edge look identical); scrolling across town has no bake hitches

## Phase 6 — Allocation churn & sweeps

- [x] 6.1 `Player.tickStatusEffects` / `tickTempStatMods`: early return on empty + in-place reverse-index filtering; `hasStatus` as plain loop
- [~] 6.2 Audio flags now drain through the shared `audioTag` switch (one walk, no `instanceof` chain — `Mob.specialSoundPending` replaces the four per-subclass flags); InkMarauder `allMobs` assigned at spawn (done in 0.2)
      Skipped: typed sub-lists for BrindleGrub evolution and `requiresEvasion`. Both are cheap
      per-mob checks, and `this.mobs` is mutated by push/splice from ~10 call sites at runtime,
      so a cached list needs a choke point that does not exist. A length-keyed cache would go
      stale on a same-frame splice+push and silently stop a grub evolving — bad trade for
      two O(n) predicate walks.
- [x] 6.3 Grid-backed proximity: missile homing (`CatPlayer.updateMissiles`), `CompanionSystem` scans, minimap radar, `BarrierSystem` slow zones, hover tooltip
- [x] 6.4 Squared-distance pre-checks where `hypot` was threshold-only (`MobUpdateLoop` separation/push, `TownLifeSystem` separation, `LootSystem`)
- [x] 6.5 Per-frame scratch reuse: `MobUpdateLoop` arrays, single `SystemContext` build per frame, combat/render contexts, player-pair tuples, quest-marker array, `LootSystem` single-pass swap-pop compaction, `AmbientSoundSystem` map hoist
- [x] 6.6 `GoreSystem`: `MAX_PARTICLES`/`MAX_PUDDLES` caps + camera-rect culling in both render loops
- [x] 6.7 Misc: `BuildingSystem` door `Map` lookup; `StairwellSystem` uses `isStairwellTile`; `ctx.filter` only touched in damage-flash branch (all 27 creatures); `drawText` font-string memo + newline fast path
      Note: the "skip the `ctx.font` assignment when unchanged" part was **not** done — `drawText`
      wraps its body in `ctx.save()`/`ctx.restore()`, which resets the font, so a module-level
      "last font set" variable would go out of step with the context and draw at the wrong size.
- [x] 6.8 Town derivations cached on `GameMap` so shop exit doesn't re-run full-map scans (well tiles, prop placement sweeps)
- [x] **Phase 6 gate:** typecheck + lint + format pass; play test level 1 and level 3

## Phase 7 — Verification

- [x] 7.1 All validation gates green on the final state (`npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`)
- [~] 7.2 Level 3: verified the level generates and the world renders — plaza paving, buildings,
      torches, bunting, street lamps, market stalls, townsfolk and the minimap all draw correctly
      through the new caches. The interactive half (shop enter/exit, ghoul-pack aggro, citizen
      dialog, minimap expand/collapse) was **not** exercised — see the note below.
- [~] 7.3 Level 1 smoke test — not run; same blocker.
- [~] 7.4 Before/after profile — not captured; same blocker.

### Verification note

The remaining smoke tests need a human at the keyboard. Driving the game from automation does not
work here: Chrome reports the automated tab as `document.visibilityState === 'hidden'`, so
`AudioManager` keeps its `AudioContext` suspended, `DungeonScene.onEnter`'s `onRunning(startIntro)`
never fires, and the level-intro banner never clears to hand over input. The same visibility state
stops `requestAnimationFrame` from running, which is what makes frame-timing measurement impossible
rather than merely awkward. Both are properties of the harness, not of the game — the game boots,
generates, and renders correctly in the same tab.

To finish these by hand: `npm run serve`, open `http://localhost:8080/?level=level3`, and walk the
list in 7.2 and 7.3. For before/after numbers, a baseline of the pre-optimization commit can be
served alongside with `git worktree add <dir> <commit>` and its dev-server port changed.

### Profiling notes (fill in)

| Scenario                   | Before (ms scripting / GC events / dropped frames) | After |
| -------------------------- | -------------------------------------------------- | ----- |
| Standing in plaza, 10 s    | not captured — see verification note                | —     |
| Walking through town, 10 s | not captured — see verification note                | —     |
| Aggro ghoul pack, 10 s     | not captured — see verification note                | —     |
