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

| District          | Where          | Buildings                                                                                                  |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| **Civic Terrace** | north edge     | Town Center Tower (set into the north wall, so its spire overhangs the fields)                             |
| **Garrison Row**  | north band     | The Barracks, Cartwright's Workshop, Shepherd's Cabin, Blackwood Lodge (dead-end alley — the cult hideout) |
| **Market Plaza**  | centre         | — fountain, stalls, notice board, fortune teller, benches, well                                            |
| **Plaza Ring**    | flanking plaza | Temple of the Sky, Herb & Remedy, General Store, Sleeping Cat Inn                                          |
| **Market Row**    | south of plaza | Old Hilda's Cottage, The Horned Flagon, The Rusty Anvil                                                    |
| **Low Quarter**   | south band     | The Desperado Club, Signet's Ink, The Sunken Stump Pub — plus the service alley the murder mystery needs   |
| **South Green**   | inside SE wall | Miller's Farm                                                                                              |
| **The Ruins**     | outside walls  | ruin shells, rubble, ghouls; the circus 70–90 tiles out                                                    |

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

Every facade is **generated by this repo**, by `npm run gen:buildings`
(`scripts/generate-building-sprites.ts` over the kit in `scripts/buildinggen/`). The
fifteen named buildings each own one sprite key, one spec, and one `life` animation
overlay composited over `idle` by the `SPRITE_BUILDING` path at 8 fps. The tower
(`overworld_main_tower`) is the exception: it is still authored art and the generator
preserves its manifest entry untouched.

Two things about that pipeline are load-bearing for the town rather than for the art:

- **Footprints are frozen.** A building's tile size is _derived_ —
  `ceil(frameWidth / tileScale)` — and this document's plot positions assume the current
  numbers. `scripts/buildinggen/fixtures/footprints.json` records them, the bake gates
  every building against that record, and the fixture is no longer regenerable now that
  the art it measured has been replaced.
- **The doorway comes out of the art.** The generator emits `blockedRegions` with a gap
  at the door, and `SpriteLoader` recovers the walkable opening from that gap. The bake
  asks the real loader where each door landed and rolls its own write back if the answer
  disagrees with the spec, because a mismatch there is not a wrong-looking building — it
  is a game that throws at module load.

---

## Ground rendering

Ground textures are **generated by a script in this repo**
(`npx tsx scripts/generate-ground-tileset.ts`), not drawn or prompted. The
[`add-ground-tile`](../.claude/skills/add-ground-tile/SKILL.md) skill is the working
reference for adding or tuning a material; only the load-bearing facts are repeated
here.

Fourteen materials ship: overworld (grass, verge, dirt, gravel, lane, cobble, plaza)
and dungeon (plain, flagstone, worn, mossy, wet, rubble, wall).

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
- **Sixteen corner masks** ship as one sheet and are composited at load, so any material
  can meet any other on any floor. One warp field is shared by every mask — a
  per-combination seed tears the shared edge.

On top of the tiles, all baked into `TileRenderer`'s 16-tile chunk cache:

| Pass                  | What it does                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-grid mask fringe | wanders material boundaries instead of running them dead straight                                                                                                                                                                                                                        |
| World-space tone      | one octave of value noise, ~24-tile wavelength, sampled in world space so the _patches_ don't read as blocks. Drawn as black at varying alpha — a `multiply` composite is identical arithmetic but leaves the compositor's fast path and costs more than the other four passes combined. |
| Edge scatter          | grass tufts spilling onto street, cobbles onto dirt                                                                                                                                                                                                                                      |
| Ambient occlusion     | soft darkening where ground meets walls and building bases                                                                                                                                                                                                                               |

**Nothing here may move to a per-frame pass.** The seam audit runs inside the generator
and exits non-zero above a joint-to-interior ratio of 1.15 (current worst: 1.11).

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

## Invariants

Load-bearing for quests, systems and save state. Anything that moves must be re-derived,
not hard-coded twice.

**Building names.** All 16 `buildingEntries` names and `type` values, verbatim. Quests,
dialog, interiors, mercenaries, the club, the murder mystery and the cult hideout key
off these strings across ~20 files.

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
