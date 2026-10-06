---
name: add-level
description: Add or modify a level, map feature, or tile type in Kitten Crawler Man — LevelDef, level registry/chaining, spawn rules, tile renderers, walkability. Use for work in src/levels/ or src/map/.
---

# Add a Level or Tile

## Levels

A level is pure data: `LevelDef` (`src/levels/types.ts`) — `id, name, mapSize, roomMobs, hallwayMobs`, plus optional `bossRooms`, `nextLevelId` (chaining), `arrivalLoadingScreen`, `hasCollapseTimer`, `hasTreasureRoomGuards`, `numStairwells`, `isOverworld`, `hasArena`, `hasSpiderLab`, `extraSpawns`, `onMobKilledSpawns`. `MobSpawnRule`: `{ type, chance, minCount, maxCount, minLevel, maxLevel, config? }` where `type` is a fixed string union — new mob keys must be added to that union and registered in `spawner.ts` (see `add-creature`).

### Checklist

1. Create `src/levels/levelN.ts` exporting a `LevelDef` (copy `level1.ts`), including its `arrivalLoadingScreen` tips.
2. Register in the map in `src/levels/index.ts` (`getLevelDef` throws on unknown ids).
3. Chain it: set the previous level's `nextLevelId` to this id; omit `nextLevelId` on the terminal level.
4. Level-complete flow is automatic: `StairwellSystem` shows the descend menu (hidden when `nextLevelId` is absent), and `DungeonScene`'s `onDescend` wiring saves progress, emits `levelComplete`, shows `LevelCompleteScreen`, and does `sceneManager.replace(new DungeonScene(nextDef, ...))` carrying player snapshots, achievements, and abilities forward.

### Arrival loading screen

Every environment arrives behind a loading screen; nothing opts in. `LevelDef.arrivalLoadingScreen: { tips }` is required (a non-empty tuple), so a new level without tips does not typecheck, and building interiors show their floor's tips. The screen is an `ArrivalLoader` (`src/scenes/ArrivalLoader.ts`), which `GameplayScene` declares abstract: each scene `begin`s it last in its constructor (after everything that queues art or figures has queued it), mounts `arrivalLoading.surfaces()`, returns from `update` and `render` on it first, fades it out after its UI and `dispose`s it on exit. `SceneManager.replace` calls `assertReadyToEnter`, so a scene entered without `begin` throws on its first entry. Anything that announces the arrival (the floor's `level_begins` sting, its music, a room's playlist) is started through `arrivalLoading.whenClosed(...)`, never under the screen. Harnesses wait on the public `arrivalLoadingOpen` (`scripts/settleArrival.ts`). A non-floor environment sets `arrivalLoadingScreen.kicker` (the tutorial does). It goes up only when `floorArrivalOwesWork` says the arrival owes real work, so a walk out of a building, or into one already warm, goes straight to play. The work is `floorArrivalLoadTasks` in `src/scenes/floorArrivalLoad.ts` (painted environment art, the figure prewarm queue, the fetched sprite groups, then the ground chunks and decorations for the first view), run by a `LoadRunner` behind a `LoadingOverlay`.

What makes an arrival hitch-free is the content's own prewarm, not the screen: anything drawn from the first frame (a creature, an NPC, a machine that animates on its own) must call its `prewarm…` when it is placed, so the figure task drains it. `docs/asset-management.md` ("A heavy arrival goes behind a loading screen") has the rest. Gates: `npm run verify:arrival-load` (every environment: the screen goes up, nothing announcing the arrival starts under it, then zero render-path bakes, stand-ins, direct paints, chunk bakes and env steps in the first frames of play), `verify:loading-screen` (runner pacing, and every `GameplayScene` wired to its loader), `verify:town-arrival-load`, `verify:town-soak`.

### Where the party is set down

Every arrival — a floor, a door, a stair, a building exit — places both crawlers with `findPartyArrivalTiles` (`src/map/findWalkableTile.ts`), never at a fixed offset such as `startTile.x + 1`. That tile can be a prop, a wall or a fence, and a crawler set down inside one cannot take a step.

### Spawn placement

`spawnForLevel(def, map)` fills room/hallway spawn points from the generated map. `extraSpawns` place mobs relative to landmarks (`mapCenter`, `bossRoom:N`, `arena:N`) and can name a `setup` callback in `SPAWN_SETUP` (`spawner.ts`) for post-spawn init (e.g. binding a boss to its arena).

### Map generation

`src/map/GameMap.ts` orchestrates; `DungeonGenerator` (rooms + L-hallways + boss/safe rooms), `OverworldGenerator` (the third-floor Over City — used when `isOverworld`), `TutorialMap`. Special rooms (arena, spider lab) are gated by the LevelDef flags.

### The overworld town

`OverworldGenerator` owns the wilderness (circus, forests, ruins, spawn scatter) but **not** the town's layout — it consumes a declarative `TownPlan` from `src/map/town/`. Before changing anything inside the walls, read **`docs/town.md`**: it covers the painter order, why the street hierarchy is a list order rather than a priority rule, the centre-relative offsets that must be re-tuned when the layout moves, and the `OverworldData`/building-name invariants that quests key off.

Building interiors are data too: one layout file per building in `src/map/town/interiors/` (props from `TOWN_INTERIOR_PROPS`, anchored at the footprint's north-west tile), applied by `GameMap.generateInterior`. The "Interiors" section of `docs/town.md` has the prop contract, occupant anchoring, breakables and the density rule. Gates: `npm run gates:town-interior-props`, `verify:interiors`, `verify:interior-interactions`, `verify:interior-payout`, `verify:interior-density`.

Verify layout changes at **`?townmap`** (localhost) — the town is several screens wide, so no in-game screenshot can show whether one worked.

### Briar Hollow and keep-outs

Every floor-3 world also has **Briar Hollow**, the ratkin village east of the town: sited by `src/map/overworld/briarHollowSite.ts`, laid out from the authored template in `briarHollowLayout.ts`, stamped by `paintBriarHollow.ts`, and checked by `briarHollowChecks.ts`. Its record is `gameMap.briarHollow` (null on every other map). The durable description — siting, layout contract, roofless walls, palisade segmentation (a save-format contract), the hostile-only gate, the siege flow field and persistence — is the "Briar Hollow" section of **`docs/town.md`**. `?townmap` cycles town → world → Briar Hollow.

Any wilderness pass that places something (rivers, forests, ruins, camps, cliffs, spawn scatter, bounty sites, boulders, fairies) must stay off the landmarks laid out before it by asking one `KeepOut` (`src/map/overworld/keepOut.ts`, disc and rect shapes with `contains(x, y)`), never by restating a geometry test. A new landmark is a new shape added to the keep-out, not an edit to every pass. `npm run verify:briar-hollow-site` proves the village over 200 seeds.

Village tile types (`tileTypes.ts`): `HOLLOW_WALL` (roofless, neighbour-aware, Y-sorted), `HOLLOW_THRESHOLD`, `HOLLOW_PLANK_FLOOR`, `HOLLOW_PROP_LOW` (solid, sight-transparent) / `HOLLOW_PROP_TALL` (solid, blocks sight) — which prop is keyed by `spriteKey` (`hollow:<propId>` on the drawing tile, `hollow_part:<dx>,<dy>` on the rest of the footprint) — `HOLLOW_DECAL`, `HOLLOW_PALISADE` / `HOLLOW_PALISADE_GAP`, `HOLLOW_GATE` (walkable by type; hostiles are turned away by the `BLOCK_HOSTILE_ONLY` runtime flag, which `GameMap.isWalkableForHostile` reads), `ROCK_DEPOSIT`, `PASTURE_GRASS`, `CROP_FIELD`. Tile painters are handed the grid, not the map, so village painters read the site through `hollowSiteRegistry.ts`.

### Circus grounds and the Big Top

Grimaldi's grounds use the same pattern. `circusGroundsLayout.ts` is the authored template, and `paintCircusGrounds.ts` stamps it. The seed never reaches geometry, and blocking dressing only goes on the r12–14.5 rim. The site record is `gameMap.circusGrounds`, and painters reach it through `circusSiteRegistry.ts`. Tile types: `CIRCUS_LOT` (walkable ground), `CIRCUS_STRUCTURE_TALL` (blocks sight) and `CIRCUS_STRUCTURE_LOW` (seen past). Both structure types are keyed `circus:<id>` on the drawing tile and `circus_part:<dx>,<dy>` on the rest. The "Circus grounds" section of **`docs/town.md`** lists every registry a Y-sorted multi-tile solid must join; use it as the checklist for the next one. The "Big Top" section covers the maze interior's drapes, floor marks, lighting, its fairness render order, and the Act III hall of mirrors (the generated light-puzzle board in `src/map/bigTop/`, one per world seed × difficulty). Gates: `npm run verify:circus-grounds`, `gates:circus-art`, `verify:bigtop`, `verify:mirror-board`, `verify:difficulty-guard`, `gates:bigtop-art`.

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
4. If it is drawn in the Y-sorted pass (anything that stands up), it also needs the decoration registries in `TileRenderer.ts` and `GameMap.ts`, and the minimap colours. A missed entry renders bare floor and still typechecks. The full list is under "Tile types and registries" in the "Circus grounds" section of `docs/town.md`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
