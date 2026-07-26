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

- [ ] 0.1 `JuicerRoomSystem.update`: move the `roomOriginX` guard above the `mobs.find` scan
- [ ] 0.2 `CircusQuestSystem.update`: phase guard above the signet/InkMarauder mob loop (and same check in `BigTopBossSystem` if unguarded)
- [ ] 0.3 `BarrierSystem`: `slowedLastFrame` list instead of clearing `isSlowed` on all mobs; same pattern for `SpellSystem`'s `isConfused` sweep
- [ ] 0.4 `Scene.ts`: catch-up cap of 2 updates + drop remaining accumulator debt (named constant)
- [ ] 0.5 `MiniMapSystem.revealAround`: early-out when player tile unchanged
- [ ] 0.6 `GameMap.findPath`: hoist the 8-direction array to module scope
- [ ] 0.7 `DungeonScene` spider audio: single start/stop decision after the loop, not per spider
- [ ] **Phase 0 gate:** typecheck + lint + format pass; quick play test on level 1 and level 3

## Phase 1 — Walkability bitmask

- [ ] 1.1 Add `blockedMask: Uint8Array` to `GameMap` with named bit-flag constants (`BLOCK_EXTRA`, `BLOCK_PERMANENT`, `BLOCK_ARENA_DOOR`, `BLOCK_STAIRWELL`)
- [ ] 1.2 Populate the mask in `buildExtraBlockedTiles` (no per-tile string building on this path) and in every mutator of the four sets (`blockTilePermanently`, `unlockArenaStairwell`, `markTileDirty`, plus any other `.add`/`.delete` call sites found by search)
- [ ] 1.3 Rewrite `isWalkable` / `isWalkableIgnoringPermanent` to bounds-check + mask read (arena-door bit only when `arenaDoorLocked`); rewrite `isStairwellTile` as one bit test
- [ ] 1.4 Add module-scope `WALKABLE_BY_TILE_TYPE` lookup table; `isWalkableTileType` reads it instead of the `!==` chain
- [ ] 1.5 Shared packed-index helper (`tileIndex(x, y, gridSize)`) defined in exactly one place; `TownLifeSystem.doorTiles` converted to `Set<number>` and `isWalkableSpot` allocation-free
- [ ] 1.6 Verify: no template strings remain in the walkability hot path (grep for `` `${tileX},${tileY}` `` and `` `${tx},${ty}` `` in `GameMap.ts` hot functions)
- [ ] **Phase 1 gate:** typecheck + lint + format pass; play test — blocked tiles, building walls, stairwell tiles, and (on an arena level) the locked arena door all behave exactly as before

## Phase 2 — Pathfinding

- [ ] 2.1 `src/core/MinHeap.ts` created (JSDoc'd binary min-heap over numeric priorities)
- [ ] 2.2 `findPath` rewritten: heap open set, packed-index nodes, reusable `gScore`/`cameFrom`/`visitedStamp` typed arrays with generation stamping, `push`+`reverse` path build, cached cardinal walkability for diagonal checks; semantics (diagonal corner rule, expansion cap) unchanged
- [ ] 2.3 Distance guard: `MAX_PATH_DISTANCE_TILES` early-out + expansion cap scaled to request distance (named constants)
- [ ] 2.4 `Mob`: per-mob `astarStagger` (constructor, wander-stagger idiom) added to refresh interval
- [ ] 2.5 `Mob`: `ASTAR_FAILURE_BACKOFF_FRAMES = 120` on empty path result
- [ ] 2.6 `Mob`: repath when goal tile changes (tracked `astarGoalTX/TY`)
- [ ] 2.7 `MobUpdateLoop`: global `MAX_PATHFINDS_PER_FRAME` budget, reset each frame; over-budget mobs keep stale path this frame
- [ ] 2.8 `CompanionSystem`: minimum repath gap (`MIN_REPATH_GAP_FRAMES`) on goal-tile-change trigger
- [ ] **Phase 2 gate:** typecheck + lint + format pass; play test — mobs chase/flank normally, aggroing a ghoul pack on level 3 causes no hitch, companion follows through doorways

## Phase 3 — Line of sight

- [ ] 3.1 Per-mob per-frame LOS cache; creatures' attack gates reuse `updateLastKnown`'s result (no second raycast)
- [ ] 3.2 LOS refresh throttled to every `LOS_REFRESH_FRAMES = 3` frames for chasing mobs
- [ ] 3.3 `hasLineOfSight` rewritten as integer DDA/Bresenham tile walk (one check per crossed tile), JSDoc'd; early `true` within one tile
- [ ] **Phase 3 gate:** typecheck + lint + format pass; play test — mobs lose sight behind buildings/walls same as before

## Phase 4 — Townsfolk update

- [ ] 4.1 `TownLifeSystem` owns a `SpatialGrid<Townsperson>`; inserted on spawn, moved on update
- [ ] 4.2 `separate()` queries grid neighbors within `SEPARATION_DIST` (behavior preserved)
- [ ] 4.3 Distance LOD: full-rate updates within `FULL_UPDATE_RADIUS_TILES`; distant citizens tick 1-in-`DISTANT_TICK_INTERVAL` frames via per-person phase
- [ ] 4.4 `findNearestTownsperson` uses the grid + squared distance
- [ ] 4.5 `stepWander` writes into an `out` parameter (no per-person object per frame)
- [ ] **Phase 4 gate:** typecheck + lint + format pass; play test — plaza crowd flows the same, citizen talk prompt and dialog work, no stacking/wall-clipping

## Phase 5 — Rendering caches

- [ ] 5.1a Person colors: `shade`/`tint` results precomputed into `PersonAppearance` at generation time
- [ ] 5.1b Person frame cache: facings × `WALK_PHASE_BUCKETS = 8` cells rendered lazily via unchanged `drawPerson`, LRU-capped (`MAX_CACHED_PEOPLE`), used by `Townsperson.render` and market vendors
- [ ] 5.2a Static clutter props baked once per kind (one `drawImage` per render)
- [ ] 5.2b Lamp/sign animation quantized to named step counts and cached per step; `shadowBlur` removed from `streetLamp` and gate-arch glow (pre-baked halo sprite + `lighter` compositing)
- [ ] 5.3 `SPRITE_BUILDING` / `MAIN_TOWER` added to `OverlayTileCache` keyed `(type, tx, ty, animFrame)`; overhead computation extended for full sprite extent
- [ ] 5.4a Static per-map decoration list, row-bucketed, built once; per-frame iteration uses per-tile-type cull extents (oversized anchors — tower/club/Big Top — kept in a small always-checked list)
- [ ] 5.4b Decoration results emitted into pooled/reused storage (no per-frame object array); destructible `damageStage` still updates via dirty-tile flow
- [ ] 5.4c `OverlayTileCache`: numeric keys + `invalidateTile` wired into the `_dirtyTiles` loop
- [ ] 5.5 `TileChunkCache`: ≤1 cold bake per frame with direct-draw fallback; `MAX_CACHED_CHUNKS` LRU eviction; optional 1-ring pre-bake
- [ ] 5.6 Visibility fog: gradient disc baked once, per-frame blit + 4 solid rects
- [ ] 5.7 Y-sort: pre-sorted static decoration list merged with separately-sorted dynamic list; treasure chests viewport-culled
- [ ] **Phase 5 gate:** typecheck + lint + format pass; visual diff pass on level 3 (people, lamps, signs, fountain, tower, fog edge look identical); scrolling across town has no bake hitches

## Phase 6 — Allocation churn & sweeps

- [ ] 6.1 `Player.tickStatusEffects` / `tickTempStatMods`: early return on empty + in-place reverse-index filtering; `hasStatus` as plain loop
- [ ] 6.2 Typed sub-lists replace full-mob `instanceof` sweeps (grubs, evasion mobs); audio flag drains via pending list or `audioTag` switch (one walk, no `instanceof` chains); InkMarauder list cached at spawn
- [ ] 6.3 Grid-backed proximity: missile homing (`CatPlayer.updateMissiles`), `CompanionSystem` scans, minimap radar, `BarrierSystem` slow zones, hover tooltip
- [ ] 6.4 Squared-distance pre-checks where `hypot` was threshold-only (`MobUpdateLoop` separation/push, `TownLifeSystem` separation, `LootSystem`)
- [ ] 6.5 Per-frame scratch reuse: `MobUpdateLoop` arrays, single `SystemContext` build per frame, combat/render contexts, player-pair tuples, quest-marker array, `LootSystem` single-pass swap-pop compaction, `AmbientSoundSystem` map hoist
- [ ] 6.6 `GoreSystem`: `MAX_PARTICLES`/`MAX_PUDDLES` caps + camera-rect culling in both render loops
- [ ] 6.7 Misc: `BuildingSystem` door `Map` lookup; `StairwellSystem` uses `isStairwellTile`; `ctx.filter` only touched in damage-flash branch (all 27 creatures); `drawText` font-string memo + newline fast path + skip redundant `ctx.font` assignment
- [ ] 6.8 Town derivations cached on `GameMap` so shop exit doesn't re-run full-map scans (well tiles, prop placement sweeps)
- [ ] **Phase 6 gate:** typecheck + lint + format pass; play test level 1 and level 3

## Phase 7 — Verification

- [ ] 7.1 All validation gates green on the final state
- [ ] 7.2 Level 3 smoke test: spawn → plaza → market, shop enter/exit, ghoul-pack aggro, citizen dialog, minimap expand/collapse, animated tiles look right
- [ ] 7.3 Level 1 smoke test: melee + missile combat, boss room lock/unlock, dynamite, loot pickup, stairwell descent
- [ ] 7.4 Before/after Chrome DevTools profile recorded below

### Profiling notes (fill in)

| Scenario                   | Before (ms scripting / GC events / dropped frames) | After |
| -------------------------- | -------------------------------------------------- | ----- |
| Standing in plaza, 10 s    |                                                    |       |
| Walking through town, 10 s |                                                    |       |
| Aggro ghoul pack, 10 s     |                                                    |       |
