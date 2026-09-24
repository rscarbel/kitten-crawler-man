---
name: add-level
description: Add or modify a level, map feature, or tile type in Kitten Crawler Man — LevelDef, level registry/chaining, spawn rules, tile renderers, walkability. Use for work in src/levels/ or src/map/.
---

# Add a Level or Tile

## Levels

A level is pure data: `LevelDef` (`src/levels/types.ts`) — `id, name, mapSize, roomMobs, hallwayMobs`, plus optional `bossRooms`, `nextLevelId` (chaining), `hasCollapseTimer`, `hasTreasureRoomGuards`, `numStairwells`, `isOverworld`, `hasArena`, `hasSpiderLab`, `extraSpawns`, `onMobKilledSpawns`. `MobSpawnRule`: `{ type, chance, minCount, maxCount, minLevel, maxLevel, config? }` where `type` is a fixed string union — new mob keys must be added to that union and registered in `spawner.ts` (see `add-creature`).

### Checklist

1. Create `src/levels/levelN.ts` exporting a `LevelDef` (copy `level1.ts`).
2. Register in the map in `src/levels/index.ts` (`getLevelDef` throws on unknown ids).
3. Chain it: set the previous level's `nextLevelId` to this id; omit `nextLevelId` on the terminal level.
4. Level-complete flow is automatic: `StairwellSystem` shows the descend menu (hidden when `nextLevelId` is absent), and `DungeonScene`'s `onDescend` wiring saves progress, emits `levelComplete`, shows `LevelCompleteScreen`, and does `sceneManager.replace(new DungeonScene(nextDef, ...))` carrying player snapshots, achievements, and abilities forward.

### Spawn placement

`spawnForLevel(def, map)` fills room/hallway spawn points from the generated map. `extraSpawns` place mobs relative to landmarks (`mapCenter`, `bossRoom:N`, `arena:N`) and can name a `setup` callback in `SPAWN_SETUP` (`spawner.ts`) for post-spawn init (e.g. binding a boss to its arena).

### Map generation

`src/map/GameMap.ts` orchestrates; `DungeonGenerator` (rooms + L-hallways + boss/safe rooms), `OverworldGenerator` (the third-floor Over City — used when `isOverworld`), `TutorialMap`. Special rooms (arena, spider lab) are gated by the LevelDef flags.

### The overworld town

`OverworldGenerator` owns the wilderness (circus, forests, ruins, spawn scatter) but **not** the town's layout — it consumes a declarative `TownPlan` from `src/map/town/`. Before changing anything inside the walls, read **`docs/town.md`**: it covers the painter order, why the street hierarchy is a list order rather than a priority rule, the centre-relative offsets that must be re-tuned when the layout moves, and the `OverworldData`/building-name invariants that quests key off.

Verify layout changes at **`?townmap`** (localhost) — the town is several screens wide, so no in-game screenshot can show whether one worked.

## Tiles

- Constants in `src/map/tileTypes.ts`: floor types via the `FLOOR_TYPES` array; everything else a numbered constant. A map cell is `TileContent { tileId, type, spriteKey?, decorationVariant? }`.
- Rendering: `TileRenderer.drawTile` tries category renderers in order — `terrainTiles` → `specialFloorTiles` → `buildingTiles` → `decorationTiles` → `interiorTiles` → `bossRoomTiles` (each returns `true` when handled; first match wins). `bossRoomTiles.ts` dispatches to one painter per room in `src/map/tiles/bossRooms/`.
- Ground: floor tiles delegate to `drawGroundTile` (`src/map/tiles/groundTiles.ts`), which resolves a `GroundMaterial` to a frame of the generated tileset and runs the fringe/tone/scatter/AO passes inside the chunk cache. Adding or tuning a material is the `add-ground-tile` skill, not a new `case`.
- Walkability: a **negative check** — a tile type is walkable unless listed in `NON_WALKABLE_TILE_TYPES` (`src/map/walkability.ts`), which `GameMap.isWalkable` reads via `isWalkableTileType` after its block-flag checks.
- Sight: a solid tile blocks sight unless it is in `SIGHT_TRANSPARENT_TILE_TYPES` (same file). `GameMap.hasLineOfSight` sees over those low props; code that steers a body straight at a point must ask `GameMap.hasWalkableLine`.
- Pace: ground that slows a crawler is listed in `src/map/tileSpeed.ts` and applied by `footingSpeedFactor` in `GameLoopPhases.applyMovement`.
- Boss-room tiles (`HOARD_*`, `GYM_*`, `KRAKAREN_*`, `LAB_*`, `ARENA_MUD`) are grouped in `tileTypes.ts` as `BOSS_ROOM_PROP_TILE_TYPES` (solid, Y-sorted — spread into both decoration registries in `GameMap.ts` and `TileRenderer.ts`) and `BOSS_ROOM_FLAT_TILE_TYPES` (walkable decals baked into the chunk). The rooms that stamp them are described under "Boss-room dressing" in `game-architecture`; `npm run gates:boss-rooms` checks each type walks, blocks sight and sits in the registries as declared.

### New tile type checklist

1. Add a numbered constant in `tileTypes.ts`; add it to `SHADOW_TYPES`/`NON_FLOOR_TYPES` in `src/map/tiles/helpers.ts` if opaque.
2. Add a `case` in the right `src/map/tiles/*` category renderer.
3. If it blocks movement, add it to `NON_WALKABLE_TILE_TYPES` in `src/map/walkability.ts`; walkable tiles need no change. If it is solid but low enough to see over, also add it to `SIGHT_TRANSPARENT_TILE_TYPES`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
