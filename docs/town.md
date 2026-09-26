# The Overworld Town

How the third floor's town is generated, rendered and tuned. This is reference for
anyone changing the town's layout, ground, props or the systems anchored to it.

> Source-material background on the Over City: [over-city-reference.md](over-city-reference.md)

---

## What the town is

A **walled market village**, not a crossroads: a wall ring roughly 55 × 41 tiles
inside, four gates, a street hierarchy, and sixteen buildings standing shoulder to
shoulder on plots that front a street. Outside the wall are the ruins, the forests and
the circus.

The layout follows a few rules. They are worth keeping when adding to the town:

1. **Streets first, buildings second.** Buildings hang off street frontage; nothing is
   placed in open space. This is why no building needs a road stub — a stub only exists
   to reconnect something dropped in a field.
2. **Every surface is a decision.** Plaza flagstone, main-street cobble, lane, alley
   dirt, yard gravel, verge. Bare grass exists only outside the walls.
3. **Negative space is designed too.** Block interiors are gardens, workyards and
   drying greens, not leftover lawn.
4. **Names are load-bearing.** See [Invariants](#invariants) — a rename breaks quests.

The wall itself is drawn procedurally by `drawTownWallTile` (`src/map/tiles/buildingTiles.ts`):
coursed ashlar, with a crenellated parapet on any run's exposed north face, phased off the
tile's world-pixel column so the battlement runs continuous across tile boundaries.

### Districts

| District          | Where          | Buildings                                                                                                                 |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Civic Terrace** | north edge     | Town Center Tower (set into the north wall, so its spire overhangs the fields)                                            |
| **Garrison Row**  | north band     | The Barracks (the garrison), Cartwright's Workshop, Shepherd's Cabin, Blackwood Lodge (dead-end alley — the cult hideout) |
| **Market Plaza**  | centre         | — fountain, stalls, notice board, fortune teller, benches, well                                                           |
| **Plaza Ring**    | flanking plaza | Temple of the Sky, Herb & Remedy, General Store, The Sleeping Cat Inn (the town's safe room)                              |
| **Market Row**    | south of plaza | Old Hilda's Cottage, The Horned Flagon, The Rusty Anvil                                                                   |
| **Low Quarter**   | south band     | The Desperado Club, The Quiet Needle, The Sunken Stump Pub — plus the service alley the murder mystery needs              |
| **South Green**   | inside SE wall | Miller's Farm                                                                                                             |
| **The Ruins**     | outside walls  | ruin shells, rubble, ghouls; the circus 70–90 tiles out                                                                   |

---

## Generation

`OverworldGenerator.generateOverworld(size)` owns the wilderness (circus, forests,
ruins, spawn scatter) and returns `OverworldData`. It does **not** hold the town's
layout — it consumes a `TownPlan`.

```
src/map/town/
  townPlan.ts        TownPlan data: wall, gates, ordered surfaces, plots, yards, props
  tileGrid.ts        bounds-checked writes + the rules about what may be overwritten
  paintStreets.ts    surfaces → tiles; wall + gates; gate highways; door aprons
  paintPlots.ts      sprite buildings onto their plots
  paintYards.ts      fences, then planting inside them
  townProps.ts       fountain / torches / wells (tile types, drawn procedurally)
  paintGround.ts     void border + ground scatter (runs last)
  groundMaterials.ts material → sheet row/frame; transition + scatter rules
  townMetrics.ts     headless measurement of a generated map
```

Pass order matters and each module's header says why. In short: streets → wall → gates
→ buildings → yards → props → scatter. Scatter is last so it can be suppressed over
reserved plots; yards run after buildings so a fence knows what art it would run
through.

### The street hierarchy is a list order, not a priority number

`plan.surfaces` is painted in order and **later surfaces win**. A lane meeting a main
street simply takes the main street's material, with no junction-fillet pass and no
special case. The Upper and Cross Lanes are stated as full-width bands and vanish where
the plaza takes over. If you want to change which street wins somewhere, reorder the
list — don't add a rule to `paintStreets.ts`.

The wall is painted **after** the streets and its gates are then re-cut, which lets
every street be a plain rectangle spanning the interior.

The four gates are south (King's Road), west and east (Market Street), and north.
The north one is a **postern**, two tiles wide against the others' four: it is cut
into the Civic Terrace's own frontage west of the tower's foot, which is the only
stretch of north wall the tower's blocking base does not stand on, and the width is
what that stretch holds once the terrace's west column and the tower's pier
clearance are accounted for. It opens onto flagstone that already runs south past
the tower into the plaza, so it needs no interior street of its own.
`assertTownPlanIsSane` compares each gate — grown by a pier either side, since a
gateway stands its piers on the wall beyond its opening — against `towerBasePlot`,
so a re-drawn tower cannot grow over it silently.

### Plots are stated as frontage, not anchors

The plan gives a building its west column and front row; width and height come from the
sprite manifest. A re-scaled building therefore keeps its frontage on the street.
`assertTownPlotsDoNotOverlap` guards the case a screenshot can't show you — overlapping
art is invisible, because the later sprite just draws over the earlier one.

### Where the building art comes from

Every facade is **painted by the game itself**, from the kit in
`src/sprites/buildinggen/` and under the floor's own art seed. The fifteen named
buildings each own one sprite key, one spec, and one `life` animation overlay
composited over `idle` by the `SPRITE_BUILDING` path at 8 fps. The tower
(`overworld_main_tower`) is the exception: it is still authored art and still ships
as a file. `npm run gen:buildings` bakes review copies of the same art into
`preview/`; nothing offline writes into `src/images/` any more.

A facade is the most expensive picture the game makes, so it is painted in stages
across frames rather than in one step, and the town's facades are painted outward
from wherever the party arrives — see `docs/asset-management.md` for that machinery
and what it measured.

Three things about the pipeline are load-bearing for the town rather than for the art:

- **Footprints are frozen.** A building's tile size is _derived_ —
  `ceil(frameWidth / tileScale)` — and this document's plot positions assume the current
  numbers. `scripts/buildinggen/fixtures/footprints.json` records them, the gates hold
  every building to that record, and the fixture is no longer regenerable now that
  the art it measured has been replaced.
- **The doorway comes out of the art.** The manifest's `blockedRegions` leave a gap at
  the door, and `SpriteLoader` recovers the walkable opening from that gap. A mismatch
  there is not a wrong-looking building — it is a game that throws at module load, so
  the gates check where each painted door actually lands.
- **The art seed may not move any of that.** A floor's seed reaches texture grain,
  weathering and lighting jitter only; the projection, the footprint, the doorway and
  every component's position come from the spec's tile counts and are the same at every
  seed. That is what keeps a floor's collision and its art agreeing.

---

## Ground rendering

Ground textures are **painted by code in this repo**
(`src/map/tilegen/materials.ts`), and the shipped game paints them for itself at
runtime under the floor's own art seed rather than loading a PNG. Not drawn or
prompted. The
[`add-ground-tile`](../.claude/skills/add-ground-tile/SKILL.md) skill is the working
reference for adding or tuning a material; only the load-bearing facts are repeated
here.

Thirty-one materials ship across five sheets, listed in
`src/map/tilegen/sheetConfigs.ts`: the overworld's ten (grass through scree), the two
dungeon floors' five each, the Bopca station's three, and eight for the town's building
interiors.

Four properties the renderer depends on:

- **Torus sampling** makes seamlessness true by construction, so a tile picks its frame
  from a hash instead of from an adjacency table.
- **Materials are generated as multi-tile patches**, not tiles, so the pattern's repeat
  period is the patch rather than 32 px. Frames are packed variant-major then row-major
  within a patch, and a tile must draw the frame matching its position _inside_ the
  patch. `groundFrameIndex` is the only place that ordering is decoded.
- **Geometry comes from a `structure` seed shared across a material's variants**; only
  tint, wear and scatter use the per-variant `detail` seed. Wrapping makes a patch
  seamless against itself, not against a differently-seeded sibling.
- **Sixteen corner masks** are painted as one sheet and composited at draw time, so any
  material can meet any other on any floor. One warp field is shared by every mask — a
  per-combination seed tears the shared edge. They carry no floor art seed: mask
  geometry is what makes two materials meet without a visible edge, and it is proved
  safe as a set rather than per floor.

On top of the tiles, all baked into `TileRenderer`'s 16-tile chunk cache:

| Pass                  | What it does                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-grid mask fringe | wanders material boundaries instead of running them dead straight                                                                                                                                                                                                                        |
| World-space tone      | one octave of value noise, ~24-tile wavelength, sampled in world space so the _patches_ don't read as blocks. Drawn as black at varying alpha — a `multiply` composite is identical arithmetic but leaves the compositor's fast path and costs more than the other four passes combined. |
| Edge scatter          | grass tufts spilling onto street, cobbles onto dirt                                                                                                                                                                                                                                      |
| Ambient occlusion     | soft darkening where ground meets walls and building bases                                                                                                                                                                                                                               |

**Nothing here may move to a per-frame pass.** The seam audit runs in the review baker
and in `npm run verify:floor-sweep`, and fails when a patch's wrap joint reads as a seam
— which is not simply a ratio, because a material whose hard lines are a sparse grid
legitimately puts one along the joint. `patchTears` in `src/map/tilegen/patchSlice.ts` is
the single definition; read its comment before touching either limit.

`DIRT_PATCH` renders as `lane`, not as its own material — it is a decoration drawn over
a road, and as a material the surrounding lane would win all four corners and the mask
would erase it.

---

## Wayfinding

The town is the floor a player is most likely to stall on: sixteen doors, three
questlines and a market, and nothing that says what any of it is for. Four things answer
that, and each answers a different half of "I don't know what to do":

- **The Quest Journal** (`src/ui/pause/JournalTab.ts`) — a pause-menu tab, reached from
  the compass button under the achievement chip, from the `toggleQuestTracker` binding, or
  from the Game tab. It lists whatever the floor's quest systems say is outstanding: an
  objective line, a hint, a compass chevron and a tile distance per row, and clicking one
  pins it — which puts a world arrow over the player and an extra marker on the minimap.
  It lives behind a pause rather than on the HUD because it has to be able to show
  _everything_: a corner panel had to cap its rows and squeeze its text, and a "+N more"
  line the player cannot open is worse than a menu they have to press a button for. Only
  floors from `JOURNAL_FIRST_FLOOR` up offer it, which is where more than one thread runs
  at once.
- **The tracker seam** (`src/systems/questTracker.ts`) — every quest system grows a
  `trackerEntries()` getter beside its existing `questMarkers` one, rebuilt from its own
  phase machine each frame. Deliberately _not_ a global `QuestManager`: two of the five
  questlines do not use one at all.
- **Quest beacons** (`src/sprites/questBeacon.ts`) — a column of light over anyone
  wearing a `!`/`?`, drawn by the creature before its own body paint so it Y-sorts with
  the figure. Gated on the exact state that drives the glyph, so the two cannot disagree.
- **The Town Guide** (`src/systems/TownGuideSystem.ts`) — Journal rows pointing at the
  town's own furniture (notice board, General Store, the safe room) until the player has
  stood near each. Deliberately none of the quest givers and not the circus: all four
  already have rows from their own systems, and two rows sending the player to one place
  under two different names is worse guidance than one.

`npm run verify:town` is the gate for the door and gate geometry these rely on.

---

## Interiors

A door on the street opens a `BuildingInteriorScene` over a room built by
`GameMap.generateInterior(kind, floor, name, hasSafeRoom)`. Four things about that room
are worth knowing before changing one.

**The shell is per building, not per kind.** `INTERIOR_BY_NAME` in `GameMap.ts` states
each building's width, height and floor material, and `INTERIOR_BY_KIND` is only the
fallback for anything absent from it. A kind is a category, and a category cannot say how
big a mead hall is or what a garrison's drill floor is made of. Four interior floor
materials ride the `ground_interior` sheet alongside the boards and stone —
rushes, packed earth, flagstone and ink-blotched boards — and new materials are
**appended** to that sheet's list, never inserted: a material's noise seed is its index,
so inserting one re-rolls the art of every material after it.

**Every walkable tile must be reachable from `startTile`.** A partition wall that seals a
wing produces no error, no log and no symptom except a room the player can see across and
never enter. `verify:interiors` flood-fills every interior — all fifteen walk-ins, the Big
Top and all four tower storeys — and the only tiles it excuses are the Bopca's galley
strip, which the counter's own side returns seal on purpose.

**The safe room is the inn's taproom.** `hasSafeRoom` on the planned building is what
puts Mordecai, the Bopca's counter and the lantern light in a room, and the bounds it
uses are name-addressable, so the inn registers the taproom band rather than its whole
floor. `planSafeRoomCounters` lays the counter run against the **north wall of those
bounds** — which is why the taproom's archways to the landing are deliberately off-centre
and why the middle of the taproom's top rows carry no authored furniture. A run laid
across an archway would wall off the entire guest wing.

**A building may run more than one counter.** `interiorServicesFor(name)` returns every
service a building offers and `interiorServiceForRole(name, role)` picks the one the
NPC the player walked up to provides, so the two services must never share a role — the
talk router would have no way to tell the counters apart and one would be silently
unreachable. The Barracks uses both: a quartermaster's armoury and a drill yard selling
permanent stat points up to `DRILL_TRAINING_CAP` at an escalating price. The inn's three
guest rooms are the timed counterpart — a full mend plus one time-bounded stat boon, and
granting one cures the other two so the choice stays a choice. Occupants carry a `post`
hint that decides which piece of their anchor group they take; without one they are placed
in raw scan order, which is row-major from the north-west and put every shopkeeper in town
in the same corner.

`npm run verify:interiors` is the gate for all of it.

---

## Invariants

Load-bearing for quests, systems and save state. Anything that moves must be re-derived,
not hard-coded twice.

**Building names.** All 16 `buildingEntries` names and `type` values, verbatim. Quests,
dialog, interiors, mercenaries, the club, the murder mystery and the cult hideout key
off these strings across ~20 files. The tattoo parlour is **The Quiet Needle**
(sprite key `quiet_needle`); Tsarina Signet is a character, not a building, and the
facade's `replaces: 'tattoo_parlor'` stays as it is — the frozen footprint fixture the
building gates measure against is keyed by `replaces`, not by the sprite key.

A misspelled key is invisible from both directions: the building reports no service and
the service names no building, so nothing throws and nothing logs. `verify:interiors`
walks both sides for exactly that reason.

**Safe-room-ness is `hasSafeRoom` on the planned building**, not a `BuildingKind`.
`BuildingKind` is `'house' | 'tower' | 'store' | 'club'` — there is no `restaurant`
member, and reintroducing one to mean "safe room" is what forced The Barracks to be
registered as a restaurant for as long as it held the safe room. Exactly one building
carries the flag, and `verify:interiors` asserts that.

**`OverworldData` fields.** `startTile`, `buildingEntries`, `mainTowerAnchor`,
`doomsdayEscapeTile`, `townSquareCentre`, `fountainCentre`, `circusCentre`,
`circusRadiusTiles`, `townSafeRadiusTiles`, `hallwaySpawnPoints`.

**Story geometry.**

- The tower base stays adjacent to the plaza (magistrate's office, tower stairs).
- `doomsdayEscapeTile` stays just south of the tower door and out of `stairwellTiles`.
- The circus stays 70–90 tiles from centre, outside the safe radius, with a ruins buffer.
  Its road routes to the nearest **gate**, not the town centre — a gate exit is a tile
  the gate's own highway paves, so the joint cannot miss.
- Miller's Farm, Blackwood Lodge and the club alley each stay reachable and thematically
  placed.

**Centre-relative offsets.** These are tuned to the current town extents. Move the
layout and they must be re-tuned, not left stale:

| Consumer               | Constants                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `market/vendorDefs.ts` | `WEST_STALL_DX`, `EAST_STALL_DX`, `STALL_ROW_DY`                                         |
| `TownPropSystem`       | `BOARD_SOUTH_OFFSET`, `FOUNTAIN_FLANK_ROW_OFFSET`, `BENCH_*_COL_OFFSET`, `FORTUNE_DX/DY` |
| `TownLifeSystem`       | `PLAZA_RADIUS_TILES`, `DISTRICT_RADIUS_TILES`, `FRONTAGE_RADIUS_TILES`                   |
| `DungeonScene`         | `FOUNTAIN_AMBIENT_RADIUS_TILES`, `TOWN_SQUARE_AMBIENT_RADIUS_TILES`, `CITY_CROWD_*`      |
| `OverworldGenerator`   | `TOWN_SAFE_RADIUS_TILES`, `RUINS_*`, `FOREST_MIN_DIST_TILES`                             |

A stale offset drops a stall, bench or notice board into a wall. `?townmap` shows it
instantly.

---

## Briar Hollow

A small, wooden ratkin farming village in the eastern wilderness of every floor-3
world. It is **not** a safe zone and has **no autosave**: nothing in the village calls
`captureSavePoint`, adds a safe room or extends `isInTownSafeZone`, and
`isInsideTownWall` is false on every village tile (it tests `townPlan.interior` only).
Ambient hostiles may wander in; they only never **spawn** inside the palisade bounds
plus `SPAWN_EXCLUSION_MARGIN_TILES` (6).

The site record is `BriarHollowSite` (`src/map/overworld/briarHollowSite.ts`), carried
on `OverworldData.briarHollow` and `GameMap.briarHollow`. It is derived entirely from
the world seed, so it is never saved. Map queries: `isInBriarHollow`,
`briarHollowDistrictAt` (null outside every district rect, and always off the overworld),
`isNearPalisade`, `isTileInBriarHollowSpawnExclusion`.

```
src/map/overworld/
  briarHollowSite.ts     siting, the site record, palisade path + segmentation, keep-out
  briarHollowLayout.ts   the authored template, site-relative: buildings, districts, props
  paintBriarHollow.ts    stamps the template into the TileGrid
  briarHollowChecks.ts   check* (returns sentences) / assert* (throws) — intact + reachable
  keepOut.ts             the one shape every wilderness pass stays off
src/map/tiles/
  hollowWallTiles.ts     roofless building walls
  hollowPalisadeTiles.ts palisade tiers, damage stages, breach/gap, the gate
  hollowSiteRegistry.ts  structure grid → site, for painters that are handed only a grid
src/systems/briarHollow/ everything that lives in the village (BriarHollowKit owns it)
```

### Siting and keep-outs

`pickBriarHollowSite` samples centres **68–80 tiles** from the map centre within
**±60° of due east**, falling back to ±90° and then 64–84 tiles. It rejects a footprint
that crosses the void border (with a margin, including the ruins disc), touches a town
wall or gate-highway tile, or puts any palisade tile within the town safe radius plus 2. It scores flatness with its own band weights (lowland 1, meadow 0.7, highland 0.2).

The site is **picked early** (right after the `ElevationField`, which then flattens it
through `ElevationField.flatten(zone)` alongside the town) and **painted late** (after
`paintCamps`), so every pass in between can avoid it and anything that slips through is
cleared. Rivers do not exist when the site is picked, so `carveRivers` is steered by
the village keep-out rather than the site avoiding water.

A `KeepOut` (`keepOut.ts`) holds disc and rect shapes and answers `contains(x, y)`.
Rivers, forests, ruins, camps, spawn scatter, bounty sites, boulders, cliffs, ground
cover and the fairy spawner all consult it; no pass restates the village's geometry.
The circus is sited after the village and avoids it and its approach road. The road to
town is routed (`paveRoadToTown`, a cost-weighted Dijkstra that rides existing roads
and never crosses the palisade, quarry, ruins or town wall), not an L-shaped stub,
because an L would cut through the palisade for many sites.

### Layout contract

The village is an authored template, not a scatter; the seed varies only dressing
(crop kinds, the laundry home, clutter, household colours), never geometry.

- The palisade bounds are **70 × 52** with **chamfered corners**. The **gate is on the
  south wall**, 3 tiles wide, west of centre. The main street runs north from it to the
  square (bell tower, wells, notice board).
- Districts: **lumber yard** NW (grove, sawmill), **farm and pasture** NE (farmhouse,
  barn whose open side faces the pasture gate, crop fields), **workshops** (forge,
  guardhouse beside the gate, engineer's workshop, cookhouse, store, infirmary),
  **homes** along the south side, mostly south-east (Wicker's to the west). Outside: the **quarry** to the SE (deposits,
  Garn's hut, dressed-stone stubs) and the **ruins** disc beyond it, whose clear centre
  is the necromancer's arrival point. `site.assaultLanes` holds a spawn/approach pair
  for each side: east (spawning in the ruins), south (down the road), and north and
  west (out in the wilderness, down corridors the village's keep-out holds clear; the
  assault raises bodies on the nearest open ground with a flow-field route in, within
  `ASSAULT_LANE_SPAWN_SEARCH_TILES`).
- District rects never include palisade tiles. Every building doorway is a gap in
  `HOLLOW_WALL` filled with `HOLLOW_THRESHOLD`, never a `buildingEntries` door, so the
  village never triggers `BuildingSystem`. There is a 1-tile walkway round every
  building and 2 tiles in front of every doorway; no furniture sits on a doorway's inner
  tile.

`npm run verify:briar-hollow-site` holds all of this over 200 seeds, running the intact
and reachable checks both before and after the generator's repair passes (a repair pass
must never be what makes them pass).

### Roofless walls

Village buildings have no roofs: you walk through the doorway and see the whole room.
In the 3/4 projection that only works with the walls nearest the camera cut down
(`hollowWallTiles.ts`):

- The **north** wall stands full height (`HOLLOW_WALL_FACE_TILES` 1.1), its inner face
  hanging below its cap into the row above — outside the building, so nothing it hides
  matters.
- The **south** wall is a cutaway, `HOLLOW_WALL_CUTAWAY_TILES` **0.35** tall. At full
  height it would hide the room and everyone in it; at 0.35 it still reads as a wall and
  its cap covers the feet of anyone standing right behind it, which is what sells
  "inside".
- The **east and west** walls are cut to the same 0.35. A full-height side wall's cap
  sits a whole tile north of the ground it stands on, so every side doorway would appear
  a tile north of where it is walkable, and a crawler standing in it would vanish.
- **Y-sort:** every wall sorts at its own tile's foot. A crawler inside, south of the
  north wall, draws in front of it; a crawler one tile north of the south wall draws
  behind the cutaway, which overlaps their feet.
- Every wall is half a tile thick on the inner half of its tile, on a fieldstone footing
  that fills the outer half, so a blocked tile never shows walkable-looking ground. Which
  side is indoors comes from the building rect via `hollowSiteRegistry`, never a per-tile
  flag. Wall looks are cached per wall piece (not through `OverlayTileCache`, which keys
  on position). Open-sided buildings (forge, sawmill, barn) get posts only — a rail
  across a walkable opening reads as a barrier.

Props (`HOLLOW_PROP_LOW` is sight-transparent, `HOLLOW_PROP_TALL` blocks sight) draw
from their footprint's bottom-left tile so they sort on their foot; the other footprint
tiles carry a `hollow_part:` key and block without drawing. Their sheets are painted at
runtime with the overworld group (`villageSheets.ts`), about 4.3 MB decoded.

### The palisade

The palisade is `HOLLOW_PALISADE` tiles cut into **segments**, the unit you upgrade
(fence → wood → stone → fortified), damage and repair. A segment at 0 HP becomes
`HOLLOW_PALISADE_GAP` (a walkable breach that remembers its tier; a broken fence is a
plain gap). An untouched segment has no record at all: it is a 1-HP fence.

**The segmentation is a save-format contract** (`segmentLengths`, `palisadeSegmentId`).
Persisted wall state is keyed by segment id, and an id is only its index
(`palisade_<index>`). The path starts at the tile east of the gate and walks east along
the south wall; it is cut into as many runs of `SEGMENT_TILES` (12) as the path divides
into evenly, with any leftover tiles spread one apiece across the runs starting from the
gate's east post, so every run is `SEGMENT_TILES` or one tile longer. Changing that rule,
the ring's shape or where the path starts orphans every saved wall — `briarHollowState`'s
segment-scheme version exists for exactly that. The current ring is 20 segments, 17 of 12
tiles and 3 of 11.

The palisade and the gate are **sight-transparent**, so enemies outside are visible and
trebuchets aim over the walls. A crawler just behind a tall wall is redrawn at half
opacity over it (`occludedCrawlers.ts`).

### The hostile-only gate

The gate is indestructible and swings open for friendly bodies, but that swing is
visual only (`VillageGate.ts`). What actually stops hostiles is `GameMap`'s
`BLOCK_HOSTILE_ONLY` flag, set on the gate tiles whenever the overworld loads, with or
without the village kit. `isWalkable` ignores it; `isWalkableForHostile`,
`isWalkableFor(x, y, forHostile)`, `hasHostileWalkableLine` and
`findPath(..., forHostile)` honour it. Every **movement** test for a hostile mob uses
the hostile variant — `Mob.stepThroughWalls` on both axes (which covers chasing,
wandering, separation and knockback), A* in `followTargetAStar`, the tactics frame's
standability and walk lines, and the fairies' hover goals — so a hostile knocked into
the gate stops at its face. Line-of-sight, projectile and spawn checks keep plain
`isWalkable`. Crawlers, companions, soldiers, cows and villagers pass freely.

Trebuchet footprints use a separate flag, `BLOCK_STRUCTURE`
(`blockStructureTile` / `unblockStructureTile`), carried in the map checkpoint.

### The siege flow field

The assault's undead navigate with `SiegeFlowField`, not A*. The ring is closed and the
gate is shut to hostiles, so a plain search from outside to the bell **fails**, and a
failed search latches (`astarSearchFailed` holds a mob off pathing for a while), dropping
it to straight-line movement that scrapes along the wall. One Dijkstra outward from the
Hollow Bell, over the palisade bounds plus `FLOW_MARGIN_TILES` (32), prices open ground
at 1, a standing structure at `1 + (remaining HP + spikes HP) / SIEGE_DPS_ESTIMATE_PER_TILE` (so a mob
detours to a weaker section but never walks the whole ring), a visible snare at +2, and
the gate as impassable (it reads `isWalkableForHostile`). It is recomputed when a tier,
a breach or a quarter-band of a structure's health changes, debounced to 0.5 s. Mobs
choose among neighbours within 5% of the cheapest by their own seed, so a wave spreads
across a breach instead of walking single file. `Mob.siegeDirective` is consulted by
`MobUpdateLoop` before `updateAI`.

### The assault

`VillageAssaultSystem` runs four waves after a 45 s countdown, each up one side of the
village. When the bell rings it draws a `SiegeCampaign`: the order of the four sides,
four of the five bounty marks (`siegeBountyMarks.ts`), and the order of the four
regular fairy kinds. It is keyed by the `BriarHollowState` object, so a door visit
mid-countdown keeps the side that was announced. An "Attack coming from the …" banner
names the side at the countdown and at each lull, and the militia's battle posts line
that side's wall (`battlePostByLane`).

Each wave (`ASSAULT_WAVES`) raises all its undead at once, never fewer than
`MIN_UNDEAD_PER_WAVE`. Every other regular hostile of the crawl comes along across the
four waves; spiders, grubs and bosses are the exceptions, and rock golems come with
the last. The bounty mark comes levelled to the siege, with a share of its health and
an `outgoingDamageScale`. The wave's fairy comes too, along with every earlier wave's
fairy that has fallen since. Fairies are not enlisted: they fly with the wave and leave
when the siege ends.

Vordrick leads every wave. In the first three he comes with a share of his health and
`cannotBeKilled`: beaten to 1 HP, or still standing when the lull begins, he fades away
(`Necromancer.beginFadingAway`) and is released with nothing paid. His death in the
fourth wave wins the siege.

In a siege, each of his raises calls up `NECRO_SIEGE_RAISE_BATCH` bodies: raised ratkin,
skeleton warriors and skeleton archers (`SIEGE_RAISE_KIND_WEIGHTS`). Up to
`NECRO_INNER_RAISES` of their sigils open **inside the palisade**, near the bell and clear
of every defender, so the walls do not keep the whole fight outside. His raises of every
kind count against his escort cap (`RisingSkeleton.raisedByNecromancer`). His home zone
only takes tiles with room to move, and the assault only spawns bodies on such tiles
(`hasRoomToMove`), because a gap between trunks is walkable but inescapable. A walk to his
post that makes no headway for `NECRO_STUCK_BLINK_FRAMES` ends in a blink to open ground
there.

`ASSAULT_TUNING` holds what each difficulty does on top of
the waves as authored: normal is as written, nightmare turns it up, and easy eases it
off. That includes `wallDamageScale`, which multiplies every attacker's blow on a
structure, because a creature's own blow is sized for the open floor.

Only the flow's front row would ever swing if the wave followed the flow alone: the
field sends everyone at the one cheapest segment. So `trySiegeStrike` also lets an
attacker outside the ring strike a standing segment right beside it, unless an opening
is within `WALL_SWARM_OPENING_TILES`. An attacker weighs a trebuchet only on its own
side of the ring. The palisade does not block sight, so an engine just inside would
otherwise hold the whole wave against the stone. Spike thorns are capped at
`SPIKES_THORNS_MAX_SHARE` of the attacker's health per blow.

The assault gives one attacker **the siege's voice**. It is the one nearest the active
crawler, held for `SIEGE_VOICE_HOLD_SECONDS`. The system installs a hearing rule with
`AudioManager.setCreatureHearing`. `playMobAudioCues`, the `mobKilled` death sounds, the
golems' landing thuds (`RockThrowSystem.landedThrowers`), and the blow sounds on walls,
spikes and the gate all ask `hearsCreature`, so every other attacker is silent. Structure
breaks, the bell and the village's own cues are not creatures and always play.

Over a hurt or breached wall, the build key (Space) and a double tap repair it
(`ConstructionSystem.repairOrUpgrade`); they only upgrade a wall that is whole. A breach
stands back up at the tier it fell from, at its full repair cost, and that tier's
Construction-menu row repairs it too. The repair key (`quickLoad`, X by default) mends the
nearest hurt structure in reach, walls and trebuchets alike, and only Quick Loads a
trebuchet when nothing needs mending.

### Persistence

Village state is split by who owns it:

| What                                                                | Where                                                                  | Scope         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| Quest phase, structures, soldier orders, merchant stock, once-flags | `BriarHollowState` → `PersistedWorldState` / `WorldCheckpoint`         | per floor     |
| Tool tiers, explainers seen                                         | `PartyCraftsState` → `GameProgress.crafts` / `LevelCheckpoint`         | party         |
| Resourcing and Construction levels and XP                           | `Player.craftSkills` → `PlayerSnapshot`                                | per crawler   |
| Harvest-node capacity and regrowth                                  | threaded `BriarHollowState`, checkpointed by `GatheringKit`, not saved | page lifetime |
| Villager memory                                                     | threaded `BriarHollowState`, neither checkpointed nor saved            | page lifetime |
| Session harvest tallies, thrall cooldowns                           | module state                                                           | page lifetime |

`BriarHollowState` is threaded by reference through `DungeonScene` and
`BuildingInteriorScene`, like `TownMemory`, because both scenes are rebuilt on every
door visit; systems read from it and never hold their own copy.

**`imminent` and `assault` are never persisted.** `captureBriarHollowState`, which both
the save and the checkpoint go through, records a siege under way as `fortifying` with
the bell at full health (and `parse` reads a stray siege phase the same way). A death or
a reload during the siege therefore rewinds to before it, and no half-fought wave can be
resumed — a death always returns to the last save, and the last save cannot have been
taken mid-wave. The village has no autosave, so a death also loses anything built or
damaged since the party last saved in town.

### Harnesses

- `?townmap` cycles town → whole world → Briar Hollow (building outlines, the ruins
  disc, district labels).
- `npm run render:briar-hollow` renders the village with the real art, Y-sorted like
  `RenderPipeline`, including three Carl-at-a-wall probes; `--labels=off` for blind
  review, `--frame=world` for the whole map.
- `npm run render:village-siege` renders siege states (bell struck, cracked, poster).
- `?playtest=briar-hollow-kit`, `briar-hollow-village`, `briar-hollow-builders`,
  `briar-hollow-siege` and `briar-hollow-assault` are playtest presets; the `!village`
  chat cheat warps the party inside the gate. `briar-hollow-assault` starts with the
  questline at `fortifying`, the whole ring at a tier and loaded trebuchets inside it:
  `npm run playtest -- briar-hollow-assault --walls=fence|wood|stone|fortified
--trebuchets=N` (walls also take 1–4).

---

## Dev routes

Both are localhost-only, registered in `src/game.ts`.

- **`?townmap`** — `TownMapScene`. The whole overworld on one canvas, two framings
  (town / world), scroll to zoom, drag to pan. Overlays building footprints and names,
  door tiles, safe radius, circus radius, start tile and the Doomsday escape tile, plus
  a metrics panel. Footprints are re-derived from the grid rather than from
  `OverworldData`, so the overlay survives layout changes untouched.
- **`?tiles`** — `TilePreviewScene`. Every ground material, plus live-composited
  transitions, resolving frames through `groundFrameIndex` exactly as the renderer does,
  so the review route cannot drift from what the game draws.
- **`?people`** — townsfolk appearance preview (see the `add-person` skill).

`scripts/render-town.ts` renders the town to a PNG headlessly. It exists because
`?townmap` draws one flat colour per tile type and cannot see props at all — those are
created by systems in `DungeonScene`, not by the generator — so a schematic can look
correct while the pixels are wrong.

`townMetrics.ts` computes the numbers without a canvas, so
`generateOverworld` + `collectBuildingPlots` + `measureTown` run headlessly under
`npx tsx` — the fastest way to tell whether a layout change moved anything.

Current measurements: 55 × 41 bounding box, 2255 tiles, 33.9% built density, 6 ground
materials in use, 30 distinct outdoor prop types, 40-tile safe radius, 8.3 ms mean frame
time in the plaza. The tower is counted by its base rather than its art — 21 of the
spire's 23 rows overhang the fields north of the wall, and counting them would report a
55 × 40 town as 61 tall.
