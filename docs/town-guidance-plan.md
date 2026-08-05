# Town guidance & wayfinding

Playtesters get to floor 3 and stall: they don't know what to do, can't find the
people who would tell them, can't see their goals once a quest is running, walk
into building doors that refuse to open unless approached from the left, and
keep trying to leave north past the tower where there is no gate. Five fixes,
ordered so the pure bug fix lands first and the UI that depends on new data
lands last.

## 1. What is wrong today

**Doors reject the right-hand side of their own opening.** This is one shared
system bug, not per-building data — the manifests are fine. Two defects stack:

1. **Entry triggers on exactly one tile.** `BuildingSystem` keys its
   door-lookup map on the single `entry.doorTile` (the `entryIndexByDoorTile`
   construction in `BuildingSystem`'s constructor, `src/systems/BuildingSystem.ts`)
   and the per-frame check is one lookup of the player's tile against that map
   (`BuildingSystem`'s `detect` method). Doorways are 1-4 tiles wide (the
   `doorwayWidth` field's doc comment on the `BuildingEntry` interface in
   `src/map/OverworldGenerator.ts`), the full width is walkable (the
   `_spriteKeyBlockedOffsets` doorway loop in `src/core/SpriteLoader.ts` leaves
   every doorway column unblocked) and the street apron is painted across the
   full width plus overhang (`paintDoorApron` in
   `src/map/town/paintStreets.ts`) — so the approach path _looks_
   as wide as the door, but only one tile of it opens the menu.
2. **That one tile is biased left of the visual door.**
   `computeDoorway` (`src/core/SpriteLoader.ts`) picks
   `dx = bestStart + Math.floor((bestLength - 1) / 2)` — for an even-width
   tile gap that floor is the _left_-of-centre tile. Worse, the tile gap
   itself is derived through the half-tile-area threshold in
   `computeBlockedOffsetsFromRegions` (`src/core/SpriteLoader.ts`; the
   `overlapX * overlapY >= halfTileArea` check is the threshold): a tile up to
   49% covered by wall art still counts as "doorway", so the tile-space gap is
   routinely wider on the left than the pixel gap the art actually shows.

   Measured against `src/images/environment/buildings/manifest.json`
   (blocked-region pixel gap centre vs the derived trigger tile, both as
   anchor-relative tile columns):

   | Sprite                                     | Doorway tiles (dx0, width) | Trigger tile dx | Visual centre dx     | Off?                    |
   | ------------------------------------------ | -------------------------- | --------------- | -------------------- | ----------------------- |
   | small_inn (Sleeping Cat Inn)               | 2, w2                      | 2               | 3                    | **1 left**              |
   | tavern_1 (Sunken Stump Pub)                | 1, w2                      | 1               | 2                    | **1 left**              |
   | tavern_2 (Horned Flagon)                   | 2, w4                      | 3               | 4                    | **1 left**              |
   | desperado_club                             | 4, w2                      | 4               | 5                    | **1 left**              |
   | overworld_main_tower                       | −1, w2                     | −1              | door straddles −1..0 | **left tile only**      |
   | blacksmith, barracks, shop, temple, houses | —                          | =               | =                    | ok (odd width or lucky) |

   So on five entrances the _only_ tile that works is the extreme left edge of
   the visible opening, and on every even-width door the right half is dead.
   The tower repeats it by hand: the plan states its door as the left tile
   (`TOWER_DOOR_WEST_OFFSET` in `src/map/town/townPlan.ts`, still `1`) and the
   entry is registered without a width (the tower's `buildingEntries.push(...)`
   call inside `generateOverworld` in `src/map/OverworldGenerator.ts`).
   The circus Big Top clears two door tiles (`placeTileBuilding`, same file)
   but registers only the left one (the Big Top's
   `buildingEntries.push({ doorTile: bigTopPlacement.doorTile, ... })` call
   inside `paintCircus`).
   The pulsing ▶ hint and the name label are also drawn over `doorTile`
   (`renderDoorHints` in `BuildingSystem`), so the game literally points
   players at the wrong tile.

**Quest givers are invisible.** Every world marker is a small overhead `!`/`?`
glyph from `drawQuestMarker` (`src/sprites/questNPCSprite.ts`), called by
`QuestNPC` (its `drawSelf` method, `src/creatures/QuestNPC.ts`), Shady (its
`renderMarker` method, `src/creatures/Shady.ts`) and GumGum (its
`renderQuestMarker` method, `src/creatures/GumGum.ts`). It is one head tall and
vanishes into the town's visual noise.

**There is no quest tracker.** No quest log, tracker, or objective HUD exists
anywhere in `src/`. `QuestManager` (`src/core/QuestManager.ts`) is instantiated
_privately per quest system_ — in the constructors of `DefendQuestSystem`,
`CircusQuestSystem` and `MurderMysteryQuestSystem` — so nothing can answer
"what is active right now". Two questlines don't register with any manager at
all: the spider quest emits events only (the `bus.emit('questStarted', ...)`
and `bus.emit('questCompleted', ...)` calls in `SpiderQuestSystem`,
`src/systems/SpiderQuestSystem.ts`) and bounties track their own
`BountyProgress` phases (the `BountyProgress` interface,
`src/core/BountyProgress.ts`, imported by `src/systems/BountySystem.ts`). The
closest precedents are the minimap-marker aggregation (the `collectQuestMarkers`
method in `src/scenes/DungeonScene.ts`) and Mordecai's advice objectives
(the `AdviceObjective` interface, `src/systems/mordecaiAdvice.ts`), whose floor
list is _empty_ for floor 3 (`DungeonScene`'s `floorObjectives` method,
`src/scenes/DungeonScene.ts` — still `default: return []`).

**No onboarding.** First arrival in town drops the player at the plaza with no
statement of what the town is for.

**No north exit.** The town has exactly three gates — south, west, east
(the `GATE_TEMPLATES` array in `src/map/town/townPlan.ts`). The tower stands
_in_ the north wall (the JSDoc above the `PlannedTower` interface in
`src/map/town/townPlan.ts`) and players keep walking at
the wall left of it. Everything downstream of a gate is already data-driven
from `plan.gates`: the wall painter cuts every gate open
(`paintWallRing` in `src/map/town/paintStreets.ts`), the outbound highway is
paved per gate (`paintGateHighways`, same file), the stone arch prop is
placed per gate (`placeGateArches` in `src/systems/TownDecorSystem.ts`), the
fingerposts look gates up by name (`placeSignposts`, same file), the circus
routes to the _nearest_ gate (`connectSiteToNearestGate` in
`src/map/town/paintStreets.ts`), and the generator sanity-checks every
gate (the gate-checking loop inside `assertTownPlanIsSane` in
`src/map/OverworldGenerator.ts`). Adding a gate is nearly pure
plan data.

Conventions for all phases (CLAUDE.md): strict types — no `as`, no `!`, no
`any`; every numeric literal a named constant; all screen text/panels/buttons
through `drawText`/the `TEXT_PRESETS` const (`src/ui/TextBox.ts`),
`drawBox`/the `BOX_PRESETS` const (`src/ui/Box.ts`),
`drawButton`/the `BUTTON_PRESETS` const/`addButton` (`src/ui/Button.ts`) —
new visuals become new presets, not inline styles.

## 2. Phase 1 — Door / entryway alignment fix

The fix has three parts; all buildings are cured at once because the bug is in
the shared derivation, not the data.

1. **Anchor `doorTile` on the pixel gap, not the tile gap.** Extend
   `computeDoorway` (`src/core/SpriteLoader.ts`) to also receive the
   manifest entry's `blockedRegions` + `tileX`/`tileScale` (its one caller —
   the module-level loop building `_spriteKeyDoorways`/`_spriteKeyBlockedOffsets`
   — sits inside the loop over `_spriteKeyRegionBlockedOffsets` (the
   module-level loop populating it from `_manifest` entries), which has the
   entry in hand — plumb the entry through rather
   than re-looking it up). Compute the base-row gap in _pixels_: take the
   regions reaching the deepest `y2`, sort by `x1`, take the widest horizontal
   gap between successive regions; `doorCentrePx = (gapLeft + gapRight) / 2`;
   `dx = Math.floor((doorCentrePx - tileX) / tileScale)`, clamped into
   `[dx0, dx0 + width - 1]`. Keep `dx0`/`width` from the existing tile-gap scan
   — they feed walkability and the apron and are correct. If no pixel gap is
   found (a sprite whose door is a gap at the edge of a single region), fall
   back to the current centre formula. This moves the trigger/hint tile onto
   the visual door for tavern_1, tavern_2, small_inn and desperado_club.
2. **Trigger on the whole doorway, not one tile.**
   - Add `doorwayX0?: number` beside `doorwayWidth?` on the `BuildingEntry`
     interface (`src/map/OverworldGenerator.ts`); the `SpritePlacement`
     interface already carries both (`doorwayX`, `doorwayWidth`, in
     `src/map/town/paintPlots.ts`). Populate it where entries are pushed (the
     per-building `buildingEntries.push(...)` call inside the `plan.buildings`
     loop in `generateOverworld`).
   - Tower: register its true two-tile doorway. The manifest gap (px 63..121,
     centre 92 = the anchor boundary) spans anchor-relative tiles −1..0, i.e.
     `doorwayX0 = doorTile.x`, `doorwayWidth = 2` on the tower's
     `buildingEntries.push(...)` call inside `generateOverworld` (source the
     width from `getSpriteDoorwayByKey('overworld_main_tower')` rather than a
     literal, so re-drawn tower art keeps it honest).
   - Big Top: `placeTileBuilding` clears two tiles; return and register
     `doorwayX0 = doorX`, `doorwayWidth = 2` on the Big Top's
     `buildingEntries.push({ doorTile: bigTopPlacement.doorTile, ... })` call
     inside `paintCircus`.
   - In `BuildingSystem`'s constructor
     register _every_ tile of `doorwayX0 .. doorwayX0 + doorwayWidth - 1` (at
     `doorTile.y`) in `entryIndexByDoorTile`, defaulting to the single
     `doorTile` when the width fields are absent. `detect` needs
     no change — the map just has more keys.
3. **Point the hint at the door.** In `renderDoorHints`
   (`BuildingSystem`), centre the ▶ and the name label
   on the doorway span — `(doorwayX0 + doorwayWidth / 2) * TILE_SIZE` — falling
   back to the `doorTile` centre when width is absent.

Follow-ups in the same phase:

- `MurderMysteryQuestSystem` derives GumGum's tile and the hideout door from
  `buildingEntries` doors (the `this.gumgumTile = hookDoor ? this.findSpawnTile(...) : null`
  assignment and the `this.hideoutDoorTile = this.doorTileOf('Blackwood Lodge')`
  assignment, both in `MurderMysteryQuestSystem`'s constructor); the
  pixel-centre fix can move a `doorTile` by one column. Re-run the
  murder-quest anchors visually (`?townmap` / a quest smoke run) after the
  change.
- Verify the interior exit return tile (`BuildingInteriorScene` →
  `DungeonScene` `spawnAt`) still lands on a walkable doorway tile for the
  five corrected buildings.

**Gate for this phase:** a small assertion where doorways are derived — the
final `doorTile.dx` must lie inside `[dx0, dx0 + width)` for every manifest key
with a doorway, and `generateOverworld`'s existing door-reachability checks
(the door-reachability loop inside `assertTownIsFullyReachable` in
`src/map/OverworldGenerator.ts`) must still pass over repeated
generations.

## 3. Phase 2 — North gate, left of the tower

Add a fourth `PlannedGate` to the `GATE_TEMPLATES` array
(`src/map/town/townPlan.ts`) in the north wall immediately west of the
tower base.

**Geometry.** The tower's blocking base spans anchor-relative columns −3..+2
(manifest: `tileX 92`, `tileScale 32`, `frameWidth 183.8` →
`towerBasePlot` in `src/map/town/paintPlots.ts`). The Civic Terrace runs
columns −6..5 from the wall row down to the Upper Lane (the `'Civic Terrace'`
surface entry, `span(TERRACE_WEST, GARRISON_TOP, TERRACE_EAST, UPPER_LANE_BOTTOM)`,
in the `surfaces` array in `src/map/town/townPlan.ts`), so a gate at
**columns −6..−4, wall row −19** (`WALL_NORTH` in `src/map/town/townPlan.ts`)
opens straight onto existing flagstone that leads
south past the tower's foot into the plaza — no new interior street needed.
Named constants: `NORTH_GATE_WEST = TERRACE_WEST`, `NORTH_GATE_EAST = -4`
(derive −4 as `TOWER_BASE_WEST - 1` style expressions, not bare literals).
Template fields mirror the south gate (the `'south gate'` entry in
`GATE_TEMPLATES`): bounds one row of
`WALL_NORTH`, apron `span(west−2, WALL_NORTH−3, east+2, WALL_NORTH−1)` via
`GATE_APRON_DEPTH`/`GATE_APRON_OVERHANG` (both in `src/map/town/townPlan.ts`),
`exit` at the gate centre one tile outside, `outward = { dx: 0, dy: -1 }`.

Two standing torches sit inside the corridor: the terrace-mouth torch at
(−6, −9) and the tower's west torch at (−4, −16) (`planProps` in
`src/map/town/townPlan.ts`). Neither can seal a 3-wide
gate (two free columns remain at each row), but walk the route in-game; if the
funnel feels pinched, shift the terrace-mouth torch one column west in
`planProps` rather than narrowing the gate.

Everything downstream is generic — verify, don't rewrite:

- Wall cut + apron: `paintWallRing`/gate re-cut and `paintGateHighways`
  (both in `src/map/town/paintStreets.ts`)
  iterate `plan.gates`; the highway will run north to the map border, and
  rivers bridge any track they cross later in the pass order — `paintGateHighways`
  and `carveRivers` are both called inside `generateOverworld` in
  `src/map/OverworldGenerator.ts`, with the bridging pass, `paintRiverCrossings`,
  running after both.
- Gate sanity: the gate-checking loop inside `assertTownPlanIsSane` in
  `src/map/OverworldGenerator.ts` (on-ring, apron
  outside) applies automatically.
- Arch: `placeGateArches` derives axis from bounds shape
  (`src/systems/TownDecorSystem.ts`) — w3 × h1 → `across`, the face-on
  form, correct for an east–west wall run. The arch sheets are baked per
  `(axis, span)` _derived from the plan_ (the `gateForms` function in
  `scripts/generate-townscape-sprites.ts`), and span 3 is a new frame:
  **re-run `npm run gen:townscape`** (the `gen:townscape` script in
  `package.json`) and commit the sheet + manifest.
- Circus routing: nearest-gate selection (`connectSiteToNearestGate` in
  `src/map/town/paintStreets.ts`)
  now has a north option, which _removes_ the documented pathology of a
  northern circus routing to a side gate — update the stale "There is no north
  gate" comment (in the JSDoc above `connectSiteToNearestGate`, same file)
  and the "three gates" claim in `docs/town.md`'s "What the town is" section
  ("a wall ring roughly 55 × 41 tiles inside, three gates, a street hierarchy,
  and sixteen buildings...").
- Fingerpost: add a `PLANNED_SIGNPOSTS` entry keyed `'north gate'`
  (the array is defined in `src/systems/townDecorPlan.ts` and consumed by
  `placeSignposts` in `src/systems/TownDecorSystem.ts`) pointing at
  the circus/wilds, and bake its board via the townscape generator alongside
  the arch.
- The tower spire's transparent overhang covers columns −3..+2 north of the
  wall, so the new highway at −6..−4 stays out from under the art.

**Interaction with the doomsday finale:** the `doomsdayEscapeTile` field sits
on the terrace at (−1, −13) (set in the `createTownPlan` function's return
object in `src/map/town/townPlan.ts`) — east of the gate
corridor, untouched.

**Gate for this phase:** generate a batch of maps headless and assert (a) the
existing gate sanity checks pass, (b) `Reachability` reaches the north gate
exit tile from the plaza, (c) `assertTownInteriorIsIntact` still passes.
Generation is unseeded (`Math.random()` throughout), so run hundreds of maps,
not five.

## 4. Phase 3 — Quest-giver beacon (glowing column)

A vertical column of light over every NPC who currently has a marker, visible
across the plaza where the little `!` glyph is not.

**Where it renders — deliberately _not_ a decoration tile.** The
`DECORATION_TYPES` (`src/map/TileRenderer.ts`) + `DECORATION_OVERLAY_TYPES`
(`src/map/GameMap.ts`) registry pair (a Y-sorted tile must be in **both** or it
renders as bare floor) only applies to map tiles, and a tile-based beacon could
not follow Signet, who moves (her live tile is recomputed each time by the
`signetTile` method, `src/systems/CircusQuestSystem.ts`). Instead the beacon is
drawn inside each creature's own `render`, _before_ the body paint, so it sits
behind the figure and inherits the entity pass's Y-sorting for free
(`RenderPipeline.renderEntities` assigns each drawable's `sortY` and sorts on
it before drawing, `src/systems/RenderPipeline.ts`).

1. **New `src/sprites/questBeacon.ts`** exporting
   `drawQuestBeacon(ctx, sx, sy, timeMs, color)`:
   - a base glow using the shared baked-texture helper `drawRadialGlow`
     (`src/sprites/radialGlow.ts`) — its file header explains why per-frame
     `createRadialGradient` is the wrong move (a `CanvasGradient` bakes its
     coordinates in, so a glow that follows the camera would have to be
     reallocated every frame for every light; baking the falloff into a
     texture instead makes it position-free); quantize the pulse alpha the way
     `LootSystem` does (the `pulseStep` local in its boss-loot glow rendering,
     `src/systems/LootSystem.ts`) so the texture cache stays bounded;
   - a tapering vertical beam ~2.5–3 tiles tall (named constants:
     `BEACON_HEIGHT_TILES`, `BEACON_BASE_WIDTH_FRACTION`,
     `BEACON_PULSE_PERIOD_MS`…) via one `createLinearGradient` from transparent
     top to the marker colour at the base — a linear gradient per frame is
     cheap; only radial falloffs need baking;
   - colours from the existing marker palette: `QUEST_MARKER_GOLD` for
     available (`!`), `QUEST_MARKER_GREEN` for turn-in (`?`)
     (`src/sprites/questNPCSprite.ts`).
2. **Call sites, gated on the exact state that already drives the glyphs** so
   beacon and glyph can never disagree:
   - `QuestNPC.drawSelf` on `markerType` (its `NPCMarkerType` field, glyph
     drawn via `drawQuestMarker` in the same method, `src/creatures/QuestNPC.ts`);
   - `Shady.renderMarker` on `ShadyMarker` from `SHADY_MARKER_BY_PHASE`
     (the `ShadyMarker` type in `src/creatures/Shady.ts`; `SHADY_MARKER_BY_PHASE`
     and the `syncShady` method that applies it both live in
     `src/systems/BountySystem.ts`);
   - `GumGum.renderQuestMarker` (`src/creatures/GumGum.ts`);
   - Signet while `hasPendingDialog()` (the private method in
     `src/systems/CircusQuestSystem.ts`).
3. Distance behaviour: full alpha far away, fade the beam down within ~2 tiles
   of the player so it never obscures the dialog interaction (named
   `BEACON_NEAR_FADE_TILES`).

## 5. Phase 4 — Quest tracker HUD (reusable, not floor-3-only)

A collapsible "Journal" panel listing active/available/completed quests with an
objective line, a hint, and a where-to-go pointer. Built floor-agnostic: the
defend quest (floors 1–2) and spider quest (floor 2) feed it exactly like the
town quests.

1. **The data seam.** Don't globalize `QuestManager` — two questlines don't use
   it at all (§1). Instead define in a new `src/systems/questTracker.ts`:

   ```ts
   interface TrackerEntry {
     readonly id: string;
     readonly name: string;
     readonly status: 'available' | 'active' | 'completed' | 'failed';
     readonly objective: string; // "Defend the goblin mother (2 waves left)"
     readonly hint?: string; // "Shady lurks by the notice board"
     readonly target?: { x: number; y: number }; // tile, for the pointer
   }
   ```

   Each quest system gains a `trackerEntries(): ReadonlyArray<TrackerEntry>`
   getter, exactly parallel to the existing `questMarkers` getters
   (`DefendQuestSystem`, `CircusQuestSystem`, `MurderMysteryQuestSystem` and
   `BountySystem` each already have one), sourcing status from each system's
   own `QuestManager`/phase machine. The scene
   aggregates them the way the `collectQuestMarkers` method already does
   (`src/scenes/DungeonScene.ts`, reusing its `_questMarkers` field).
   `BuildingInteriorScene` can pass the same aggregation later; out of scope
   here.

2. **The panel** — new `src/ui/QuestTrackerPanel.ts`, screen-space, drawn in
   `DungeonScene.render`'s HUD block, right after the minimap is drawn
   (`this.miniMap.render(...)`), anchored under the minimap + pause button
   (`MiniMapSystem.NORMAL_SIZE` (160) and `MINIMAP_MARGIN` (8), both in
   `src/systems/MiniMapSystem.ts`; pause button rect from
   `DungeonUIRenderer.pauseButtonRect`). Collapsed
   state: a small badge with the active-quest count. Expanded: `drawBox` with
   `BOX_PRESETS.panel`, headings via `TEXT_PRESETS.heading`, entries via
   `label`/`muted`/`success`/`danger` per status, and per-entry rows via
   `addButton` with a **new `BUTTON_PRESETS.trackerRow` preset** (per CLAUDE.md,
   a preset, not an inline style). Completed quests collapse into a
   "Completed" section.
3. **Where to go next.** Each entry with a `target` shows a direction chevron +
   tile distance computed from the active player. Clicking an entry pins it:
   the pinned target reuses the bounty arrow — `drawArrowAbovePlayer`
   (`src/ui/WorldArrow.ts`, called today from `BountySystem.renderArrow` for
   bounties and, separately, by `TutorialController` for goblin-guidance and
   generic waypoint arrows — no longer bounty-only) — and feeds one extra
   marker into the minimap array. Note the minimap fog gate (the fog check
   inside `MiniMapSystem`'s `render` method) hides markers on unexplored
   tiles; the tracker's text row and the world arrow are the unfogged
   channel, which is the point.
4. **Input + click routing.** Toggle key `j` (free — taken today: space, Enter,
   Tab, q, i, g, f, m, r, 1-8; the `actionHandler` key-switch built inside
   `DungeonInputHandler.bind` in `src/systems/DungeonInputHandler.ts`):
   add a `toggleQuestTracker` action to the `DungeonInputActions` interface
   (`src/systems/DungeonInputHandler.ts`) modelled on the minimap's
   `m`/`M` branch in that same switch, bound in the scene's
   `this.inputHandler.bind({...})` call in `DungeonScene`'s constructor.
   Mouse: the badge/panel hit-test goes in the follow-button /
   mongo-summon-button / achievement-icon / skill-banner block of
   `DungeonScene.handleClick`; call `playButtonSound` from the
   handler per the Button.ts contract.
5. **Checkpoint.** Pinned-entry id joins the `WorldCheckpoint` interface
   (`src/core/WorldCheckpoint.ts`) alongside the existing per-system
   quest snapshots so a checkpoint restore doesn't leave the arrow pointing at
   a rewound objective.

## 6. Phase 5 — Town onboarding

Smallest set that answers "what do I do here", reusing Phase 4's surface:

1. **Arrival moment.** On first town entry, show a quest banner
   (`drawQuestBanner` in `src/ui/QuestBanners.ts`) — "Welcome to <town>. Press
   J: Journal" — and auto-expand the tracker once. Persist `townGuideSeen` as a
   Settings boolean using the documented four-edit pattern in
   `src/core/Settings.ts` (the `SettingsData` interface shape, the `DEFAULTS`
   const, the guarded reader in `load()`, and a setter such as `setQuality`
   calling `persist()`; storage key `kittenCrawler.settings.v1`, near the top
   of the file). Settings is deliberately device-local — right for a "seen it" flag.
2. **A "Town Guide" tracker section.** Until the player has touched each one,
   the tracker's floor-3 list is seeded with `available`-status pointers at the
   town's own furniture: the notice board (bounties; `bountyNotice` and
   `buildTownNotices` in `src/systems/townNotices.ts`), Shady beside it
   (`placeShady` in `src/systems/BountySystem.ts`, tile from
   `townProps.claimBountyGiverTile()` called in `DungeonScene`'s constructor),
   GumGum, the General Store, Mordecai's Kitchen, and the circus road. These
   are `TrackerEntry` rows with targets — no new system, just seed data with
   per-item "visited" latches (checkpointed with the tracker state).
3. **Mordecai joins in.** Fill the empty floor-3 branch of `DungeonScene`'s
   `floorObjectives` method (`src/scenes/DungeonScene.ts`) with the same
   objectives via the `adviceObjective` function
   (`src/systems/mordecaiAdvice.ts`) so asking Mordecai
   in his kitchen gives directions consistent with the tracker.

## 7. Validation

Every phase: `npm run typecheck`, `npm run lint`, `npm run format` — all must
exit 0. Phase 1 adds the doorway-bounds assertion; Phase 2 adds the headless
multi-map generation check and the `gen:townscape` re-bake; the service worker
serves stale bundles, so unregister it before trusting any browser check.

## 8. Notes for Ryan's playtest

- Walk at every town building door from the right-hand side, the
  centre, and the left — the menu must open anywhere across the visible
  opening, and the ▶ hint must sit over the actual door (tower, Big Top, and
  the four corrected shops especially: Sleeping Cat Inn, Sunken Stump Pub,
  Horned Flagon, Desperado Club).
- Murder-quest anchors after the door shift: GumGum's spot, the alley
  body and the Blackwood Lodge hideout door still make sense on the map.
- North gate: leave and re-enter through it on foot; does the corridor
  past the tower torches feel walkable or pinched? Does the arch read as a gate
  from both sides? Does the highway north meet the wilderness convincingly
  (river bridge if one crosses it)?
- Doomsday escape sequence still stages correctly on the terrace with
  the new gate open.
- Beacon readability: is the column visible across the plaza at normal
  zoom, on both desktop and phone? Does it distract during dialog or combat?
- Tracker layout on mobile — it shares the right edge with the minimap,
  pause button and boss bar stack (the mobile-only HUD stacking block in
  `DungeonScene.render`); check nothing overlaps at phone widths.
- Journal contents during a full run: floor 1 defend quest, floor 2
  spider lab, floor 3 circus + murder + a bounty — statuses, hints and arrows
  correct at each stage, including after dying and checkpoint-restoring
  mid-quest.
- First-arrival flow: banner timing, auto-expanded tracker, and that it
  never re-fires on a second visit (and that a fresh browser profile sees it
  again).
- Frame time with beacons + tracker open (`?perf`) on the town map.
