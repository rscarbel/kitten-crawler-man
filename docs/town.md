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

| District          | Where          | Buildings                                                                                                                                |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Civic Terrace** | north edge     | Town Center Tower (set into the north wall, so its spire overhangs the fields)                                                           |
| **Garrison Row**  | north band     | The Barracks (the garrison), Cartwright's Workshop, Plumbline Farm (Wendell's home), Blackwood Lodge (dead-end alley — the cult hideout) |
| **Market Plaza**  | centre         | — fountain, stalls, notice board, fortune teller, benches, well                                                                          |
| **Plaza Ring**    | flanking plaza | Temple of the Sky, Herb & Remedy, General Store, The Sleeping Cat Inn (the town's safe room)                                             |
| **Market Row**    | south of plaza | Old Hilda's Cottage, The Horned Flagon, The Rusty Anvil                                                                                  |
| **Low Quarter**   | south band     | The Desperado Club, The Quiet Needle, The Sunken Stump Pub — plus the service alley the murder mystery needs                             |
| **South Green**   | inside SE wall | Miller's Farm                                                                                                                            |
| **The Ruins**     | outside walls  | ruin shells, rubble, ghouls; the circus 70–90 tiles out                                                                                  |

---

## Who lives here

The town is a skyfowl city with a human minority. That ratio carries the story: Quill's
doomsday spell is built to kill every non-skyfowl inhabitant, which only means something
if there are visibly some.

**Species is not a job.** `TownSpecies` (`src/systems/townSpecies.ts`, `'human' |
'skyfowl'`) is its own axis, carried by `ResidentDef.species`, `OccupantSpec.species` and
every `Townsperson`. `TownRole` is only ever a job. Services are keyed by role
(`interiorServiceForRole`), so a resident can change species without touching the counter
they run, and a species in the role union would sell or bark as a job.

**The named cast** is `RESIDENT_DEFS` in `src/systems/townResidents.ts`: sixteen residents,
ten skyfowl and six human. The humans are Wendell (Plumbline Farm), Old Hilda, Marta
Miller, Apothecary Fen, Innkeep Marlow and Wick, the General Store's clerk. Keeper Brenna
Kestrel runs the General Store: she is the counter occupant `ShopSystem.setKeeper` points
the shop at. The club's cast (Clarabelle, Rosemarie, Mordecai and the rest) is fixed by
the books and sits outside the ratio.

**The crowd.** `TownLifeSystem` rolls each street cohort's species at its own share:
`PLAZA_SKYFOWL_SHARE` and `ANCHOR_SKYFOWL_SHARE` two thirds, `TRAVELER_SKYFOWL_SHARE` one
half (the roads bring outsiders in). A door's loiterers lean toward its resident's species
(`frontageSkyfowlShare`), and each doorstep anchor's species is fixed with its post
(`DOORSTEP_ANCHOR_ROLES`). Interior occupants state theirs per spec. A named occupant
always takes the species of its `ResidentDef`.

**The same town is the same people.** Roles, species and loiterer counts come from
`mulberry32(subSeed(worldSeed, CAST_SEED_SALT))`; only positions and speeds stay random.
Every door rebuilds the town scene, and a crowd re-rolled on each exit asked the figure
cache for a new set of looks while the last crowd's rows still filled it. Walking in and
out of buildings then slowed the game to a crawl. `npm run verify:town-soak` walks twenty
doors to hold that flat.

**Figures come from a closed set of looks.** A cached cell is keyed on figure, state and
frame, so a per-instance colour would serve the first citizen's look to everyone. A seed
only _picks_ a look. `pickCitizenFigure` (`src/creatures/citizenFigure.ts`) is the one
place species chooses a cast:

- **Humans:** `src/sprites/person/townCastLooks.ts` and `src/sprites/art/townCastFigure.ts`.
  Adults are painted on Carl's rig in his gear plus a role accessory. The two child looks
  use the person skeleton, because Carl's rig is one adult's proportions.
- **Skyfowl:** `src/sprites/art/skyfowl/` and `skyfowlCastFigure.ts`.
- **Named residents:** each wears a fixed look from `src/creatures/residentFigures.ts`,
  which throws on a resident with no entry.

The twelve fightable `SkyFowl` mobs (`extraSpawns` in `level3.ts`) are combat creatures,
not citizens. They wear the four street-tough looks: rust and plum leathers and a hunched
posture that no citizen wears, so a player never mistakes a citizen for a target. A
citizen is never a `Mob`, and `npm run verify:citizens-not-targetable` fails any
target-picking system that mentions `Townsperson`.

### Wendell, Plumbline Farm and Garrison Green

Wendell trained as an architect, never found work as one, spent years building houses,
and then tried farming; every cow he owned died. He keeps Fenna's blueprints, and
Briar Hollow's side quest "The Borrowed Blueprints" runs through his house and his
pasture (see [The Borrowed Blueprints](#the-borrowed-blueprints)).

**His look** is `resident_wendell` in `src/sprites/person/townCastLooks.ts`, on Carl's rig:
a lean, greying human with a slight stoop from the drafting table (`wendellPosture`), a
brown waistcoat over rolled linen shirtsleeves, spectacles and a carpenter's pencil
behind his ear (`WENDELL_ATTACHMENTS`, `src/sprites/art/human/wendellAttachments.ts`),
the `builderRule` at his belt and mud on his boots. The spectacles and pencil are painted
inside the figure from the solved skeleton rather than laid over the finished figure,
because an overlay at fixed figure-space points leaves them hanging beside a head that
bobs or turns.

**The room tells three lives** (`buildPlumblineFarmLayout`,
`src/map/town/interiors/plumblineFarm.ts`; painters in
`src/sprites/art/townInterior/rooms/plumblineFarm.ts`):

- **The architect:** the drafting table under the window with a real drawing pinned to
  it, the framed elevation of a hall nobody built, the T-square and set square on pegs,
  the plan chest and a bin of rolled drawings.
- **The builder:** the tool wall with every tool over its painted outline, a door on
  trestles as a bench, the timber stack and offcut box, and shelves built as a flight of
  stairs.
- **The failed farmer:** the dairy wall with a slate of cows' names struck through,
  scoured churns, stacked empty pails, full feed sacks, and a cowbell on the peg post by
  the door.

The drafting table, plan chest and roll bin carry no `interaction` and must never gain
one: the drawings are Wendell's to talk about, not the room's. His anchor is the hearth,
and the two door columns stay clear from the door to the hearth rug.

**The quest swaps props, not layouts.** Four placed props have stable ids
(`PLUMBLINE_FARM_SWAPPED_PROP_IDS`) and change variant with the quest
(`plumblineFarmPropVariants`): the plan chest shows the blueprints while they are in
Wendell's keeping, and from `midge_delivered` on the churn stand is in use, the cowbell
is gone from its nail (Midge wears it) and the boot tray by the door gains a milk pail.
`PlumblineFarmRoomSync` (`src/systems/briarHollow/blueprints/plumblineFarmRoom.ts`)
re-derives that every frame the room is open, because the hand-over happens mid-visit and
an eviction can send the blueprints home at any time, and touches the props only when
the derived state changes. `plumblineFarmExamineLine` gives the churn and the dairy wall
their live lines once a cow is back.

**Garrison Green** is his pasture: the fenced `pasture` yard in `PLANNED_YARDS`
(`townPlan.ts`), standing against the farm's east wall (nothing fits behind the Garrison
cottages but the one-row back lane), fenced in his over-built `garrison` style, with a
two-tile cart gate onto the Upper Lane. `TownDecorSystem` dresses it for a herd he does
not have: the milking shed in the north-east corner, a feed bin, hay racks and a bale
along the north fence, two troughs down the east fence, full sacks against his wall, and
a gate fixture over the cart gate that blocks nothing. `PASTURE_KEEP_CLEAR` keeps the middle of
the green and the tiles inside the gate open, so a cow can be walked in and has ground
to stand on. From `midge_delivered` on, Midge lives there for good (`WendellsMidge`).

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
`preview/`; nothing offline writes into `src/images/`.

A facade is the most expensive picture the game makes, so it is painted in stages
across frames rather than in one step, and the town's facades are painted outward
from wherever the party arrives — see `docs/asset-management.md` for that machinery
and what it measured.

Three things about the pipeline are load-bearing for the town rather than for the art:

- **Footprints are frozen.** A building's tile size is _derived_ —
  `ceil(frameWidth / tileScale)` — and this document's plot positions assume the current
  numbers. `scripts/buildinggen/fixtures/footprints.json` records them, the gates hold
  every building to that record, and the fixture cannot be regenerated: the art
  it measured is not what the game paints.
- **The doorway comes out of the art.** The manifest's `blockedRegions` leave a gap at
  the door, and `SpriteLoader` recovers the walkable opening from that gap. A mismatch
  there is not a wrong-looking building — it is a game that throws at module load, so
  the gates check where each painted door actually lands.
- **The art seed may not move any of that.** A floor's seed reaches texture grain,
  weathering and lighting jitter only; the projection, the footprint, the doorway and
  every component's position come from the spec's tile counts and are the same at every
  seed. That is what keeps a floor's collision and its art agreeing.

### One art vocabulary

Facades, street props and interior furniture paint through one shared vocabulary,
`src/sprites/art/town/`, the town's counterpart of Briar Hollow's `villageArt.ts`:

- `townPalette.ts` holds the ramps (`TOWN_RAMPS`, `getTownRamp`).
- `townMaterials.ts` holds the material painters (plaster wash, timber framing, stone
  and roof courses, iron straps, awning cloth, glazing).
- `townArt.ts` holds the frame contract (footprint bottom-left, ink inside the
  footprint's width and bottom edge), the outline and the contact shadow.

The town is the village's other half: lighter and cooler plaster, timber and dressed
stone, iron hardware rather than brass. Whatever the village is built from, the town is
not. What the town shares with the village is the finish: clean shapes, flat-ish planes
with a clear lit and shaded side, and almost no high-frequency noise.

- **Scale.** Facades bake at `BUILDING_TILE_SCALE` 48. Props, interior furniture and
  figures bake at `TOWN_TILE_SCALE` 64. Moving facades to 64 would nearly double the
  facade group's residency. The painters are scale-independent, so the two read as one.
- **Light** is upper-left for the whole game (`LIGHT_DIR_X/Y` in `buildinggen/ramps.ts`),
  with the plane-shade ladder in `buildinggen/lighting.ts`.
- **Outline.** One pass round the silhouette only, never along an internal seam, one
  screen pixel wide (`bakeScale / 32` bake pixels), in warm near-black ink, never pure
  black. `paintInteriorInk`'s threshold stays at 92 or above. Below that it inks the
  surface grain.
- **Facade materials are cel-shaded.**
  - Stone blocks are flat fills in `BLOCK_TONE_STEPS` tones with a one-pixel lit and shaded
    edge.
  - Roof tiles are quantized to `TILE_TONE_STEPS`.
  - Plaster is a flat base with a few polygon wash patches.
  - Weathering is a handful of drawn shapes: `applyWeatherPatches`, `applyMossPatches` and
    `applyStreaks` in `texture.ts`. These three passes are the only ones the floor's art
    seed reaches.
  - No per-pixel noise pass may come back: that is what read as blurry and speckled.
- **Crispness comes from the painters, not the sampler.** Every sprite is drawn down from
  a 48 or 64 px bake to a 32 px tile. Nearest-neighbour sampling there drops pixels
  unevenly and shimmers in motion, so `imageSmoothingEnabled` stays at the default on the
  sprite path. node-canvas previews at a fractional scale do not show this either way.
- **Detail below 1.5 screen pixels is noise.** Merge it into one tonal band per element
  rather than drawing it at full density. Judge every picture at 32 px per tile.
- **Texture richness.** `gates:town-art` holds each material to between 50% and 115% of
  the plaza's local contrast. `verify:buildings` holds each facade above its own floor
  (`TEXTURE_RICHNESS_FLOOR_FRACTION`). Fix a failing margin with real contrast on the
  largest surface, never by relaxing the constant.
- **Where a new cue goes.** Anything that changes a building's footprint, collision or
  silhouette is facade geometry. Anything a citizen could stand on, sit on or move is a
  Y-sorted prop. Anything that moves by itself is a `life` overlay (`roof_perch`,
  `weathervane_swing`). A life cell gets no shared silhouette pass, so it carries its own
  outline. Nothing is painted in two of these at once.

After any painter or ramp change, run `npm run gen:floor-art-seeds`, then
`npm run verify:floor-sweep -- --only=facades`, then `npm run verify:buildings`. A sweep
against the old seed alphabet is a false green. `npm run render:buildings -- --compare`
prints each building's richness against its floor. `npm run render:town-art` renders the
material board. `npm run parity:buildings` compares against the hand-painted sprites the
kit replaced, so it is expected to differ.

### Street dressing

The plaza fixtures come from `TownPropSystem`, the market stalls from `MarketSystem`, and
the yard, lot and doorstep dressing from `TownDecorSystem` (`CLUTTER_PLACEMENTS`,
`FIXTURE_PLACEMENTS`). Placements are read from `TownPlan` data, so they draw nothing
from the world RNG.

- **`TOWN_CLUTTER_KINDS` is append-only.** A kind's position in the list is its frame in
  the `town_clutter` sheet.
- **A placement that would cut the town apart is dropped silently.** Every placement goes
  through `findFreeTile` and `leavesTownConnected`. Check the render after adding one.
- **Doors are kept clear by rule, not by connectivity.** A door tile is a dead end, so a
  prop standing on it strands no _other_ tile, and the connectivity check passes while
  the building can no longer be entered. `doorwayKeepClearTiles`
  (`src/systems/doorwayKeepClear.ts`) is every doorway tile plus every tile one cardinal
  step from it. `TownPropSystem`, `TownDecorSystem` and `MarketSystem` all refuse those
  tiles. `npm run verify:town-doors` builds the systems in `DungeonScene`'s order and
  walks into every door from the start tile.
- **A yard's `kind` paints no ground.** A lot also needs a `PLANNED_SURFACES` entry in
  `townPlan.ts`.

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

`npm run verify:town` is the gate for the door and gate geometry these rely on.

---

## Interiors

A door on the street opens a `BuildingInteriorScene` over a room built by
`GameMap.generateInterior(kind, floor, name, hasSafeRoom)`. The room is regenerated on
every entry, so it keeps no state of its own; anything a room must remember lives in
`TownMemory` (see [Remembered between visits](#remembered-between-visits)). A room's
contents are data: one layout file per building in `src/map/town/interiors/`, listed in
`NAMED_INTERIOR_LAYOUTS` (`index.ts`), each a pure function of the shell's size that
returns layout entries. `generateInterior` holds no per-building logic.

Only the Desperado Club's rooms and stations are fixed by the source material. Every other
room's shell and layout may change freely, as long as its function holds: quest beats,
services, the safe room, the murder mystery's alley and cellar, the cult hideout, and the
gates below. A room's layout follows from what the building is, and every room should
look occupied. Four things about the shell are worth knowing before changing one.

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

`npm run verify:interiors` is the gate for all of it, including that every door opens onto
clear floor two tiles deep.

### Furniture is placed props

A layout entry is either a `'tile'` (walls, doorway gaps, floor overrides, and the few
bespoke fixtures with no painted prop) or a `'prop'`: an instance from
`TOWN_INTERIOR_PROPS` (`src/sprites/art/townInterior/townInteriorProps.ts`). Room-specific
painters live in `src/sprites/art/townInterior/rooms/`, one file per building plus a shared
`tavernKit.ts`. A prop is multi-tile furniture, the model the Desperado Club's
`clubProps.ts` established:

- **A prop entry's `(x, y)` is the footprint's north-west tile.** The footprint runs east
  across its width and south across its height. Blocking, drawing and sorting all read it
  that way. (The painter-local `TownPropFrame` is anchored bottom-left; that is a different
  contract.)
- **Collision is the footprint.** Every footprint tile of a standing prop is blocked. Its
  art rises into the rows behind without blocking them, and it sorts at its southmost row
  (`townInteriorPropSortY`).
- **Ink stays inside the footprint's width.** `withFootprintClip` silently shears anything
  past it, so pull fringes and overhangs inward. `npm run gates:town-interior-props` checks
  every prop and variant, and that block, draw and sort agree on the anchor.
- **Walkable props are a ground layer.** A `walkable: true` def (rugs, the forge floor, the
  temple dais, a trapdoor) is drawn by `drawTownInteriorGroundProps` after the floor and
  under every figure. Only standing props join the Y-sort, through
  `townInteriorPropFigures`. Use the sized rugs (`rug_runner*`, `rug_small`, `rug_medium`,
  `rug_large`, `rug_ring`), never a row of 1×1 `rug`s.
- **Wall finish is per building.** `WALL_MATERIAL_BY_BUILDING_NAME`
  (`src/map/town/interiorWallMaterial.ts`) picks plaster, stone or timber.
  `interiorWallFace.ts` paints the face.
- **Some systems still scan raw tile types.** `ANCHOR_TILE_TYPES`, Old Hilda's repairable
  wreck (`TABLE`, `CHAIR`, `BOOKSHELF`) and the temple's nave spawns (`RUG` tiles) read
  tile types. A `'prop'` entry never writes one, so converting those tiles to props
  empties those scans without an error.
- **A packed row seals a pocket.** A solid run of furniture across a row, plus one more
  blocker inside that span, strands the floor behind it. That never shows in a render;
  only the reachability check in `verify:interiors` catches it.
- **Safe-room decor stamps around props.** `stampSafeRoomDecor` (`safeRoomDecorLayout.ts`)
  reads `placedInteriorPropFootprintTiles()`. Anything that reads "is this floor free"
  must do the same, because the grid under a prop is still floor.

**Occupants anchor to furniture.** `scanInteriorFurniture` merges the tile scan with each
placed prop's `anchors`. A prop contributes **one** anchor tile per instance, its
north-west tile, so replacing two 1×1 tables with one 2×1 table drops an occupant. The
`post` hint orders the group, and `findStandTile` picks the first walkable tile round the
anchor. A layout steers where someone stands by blocking the tiles it doesn't want them
on. An occupant whose group matches nothing is dropped silently; `verify:interiors` names
the room and anchor for each roster entry. `InteriorReadableSystem` has its own scan, which
must stay in step.

**Every room is lived in.** `npm run verify:interior-density` fails a room with a square of
undressed floor bigger than `MAX_EMPTY_SQUARE_TILES` (4×4). A walkable prop counts as
dressed, and a one-tile ring round the entrance is exempt. It bounds a square, so a long
empty strip still passes.

### Examine, search, use, break

A prop def may carry an `interaction` (`{ kind: 'examine' | 'search' | 'use', id }`) and a
`destructible` spec.

- **Interactions** run in `InteriorPropInteractionSystem`, through the scene's one
  `Conversation`. Their text is in `src/dialog/scripts/interiorObjects.ts` (`EXAMINE_LINES`,
  `SEARCH_TABLES`, `USE_LINES`), each typed `satisfies Record<id, …>` so a missing line is
  a compile error. A search pays out the first time only. Paged documents (ledgers,
  letters, price boards) stay in `InteriorReadableSystem`.
- **Breaking** is `TownInteriorPropDestructionSystem`. It is separate from the tile-keyed
  `DestructiblePropSystem` and wired through melee and stomp (`CombatKit`), projectiles
  and dynamite.
  - A multi-tile prop is one HP pool. It breaks whole: one cue, one loot pile at the
    footprint's centre, and every footprint tile opened.
  - **Broken debris never blocks.**
  - Beds, bunks, cabinets and wall racks are deliberately unbreakable.
  - An occupant reacts with a timed bark (`InteriorBreakReactionBarks`), never a
    conversation.
- **Loot.** A layout entry's `dropsLoot` overrides the def's `dropsLootByDefault`. Shop
  merchandise is `dropsLoot: false`, so breaking stock is never a way to steal it. Loot
  always drops, lands and then flies to the HUD.

### Remembered between visits

`TownMemory` (`src/core/TownMemory.ts`) is threaded by reference through `DungeonScene`
and `BuildingInteriorScene`. It holds resident talk counts, Fen's poultice batch,
`clearedRooms`, `clearedCamps` and `paidOutInteriorProps`.

- **A prop pays out once, ever.** `paidOutInteriorProps` is keyed by
  `interiorPropPayoutKey`: the room key plus the prop's stable id, which defaults to
  `propId@x,y` and never comes from scan order.
- **The payout is marked before the roll.** An empty roll or a merchandise break still
  spends it, so re-entering and re-breaking pays nothing. Broken _state_ is not saved: the
  room stands again on the next visit.
- **A rewind can pay again.** A checkpoint restore rewinds the record with the rest of the
  world, so a death can pay a prop out a second time.
- **The gate.** `npm run verify:interior-payout` reads the first destructible in each
  layout. Keep a coin-carrying, non-merchandise breakable first in each file.

### Camera and HUD indoors

A room is framed by `src/scenes/interiorCamera.ts` through `GameplayScene`'s camera hooks
(`cameraWorldBounds`, `cameraClearView`, `cameraFocusRange`). Every building interior uses
it, as do the tower storeys, the club and the Big Top.

- **Bounds are visual, not the grid.** Prop art rising above row 0 is measured from the
  baked frame (`townInteriorPropArtRiseTiles`) and grown by `INTERIOR_CAMERA_MARGIN_PX`.
- **The HUD is an occluder.** `interiorHudLayout` (`src/scenes/interiorHudLayout.ts`)
  places every piece of indoor chrome: the HUD panel, the room-name plate, the minimap
  column, and the phone's buttons. `interiorHudOccluders` feeds `hudClearView`, which
  pushes the view off each occluder that could cover reachable floor, keeping at least
  four tiles clear. Otherwise a rat or the cat stands under the Bag button on a phone.
- **The name plate** (`drawInteriorNameplate`) sits between the HUD panel and the minimap
  when there is room, and under the panel when there is not.

`npm run verify:interior-camera` checks every reachable floor tile, with the party on it,
at desktop and phone sizes with each HUD variant. `npm run render:interior-hud` renders
review shots.

### Arriving

Wherever the party is set down (through a door, off a stair, out of a building, onto a
floor), `findPartyArrivalTiles` (`src/map/findWalkableTile.ts`) chooses both tiles. The
tile east of a landing is often a candle stand, a pew or a fence, and a crawler set down
inside a prop cannot take a step. The search wants room to move, stays off stairwells and
doors, and requires the follower to be able to walk to the leader.
`npm run verify:companions-indoors` enters every room through the real path.

A floor whose art is still owed is covered by the loading screen (`arrivalLoadingScreen`
on the `LevelDef`). A walk out of a building shows it only when environment art is still
owed. See `docs/asset-management.md`.

---

## Talking to people

Every conversation goes through the scene's one `Conversation` (`src/dialog/`).

**Space goes on; Escape is the way out.** Space takes a row's default:

- a confirm row's accept side;
- on a choices row, `defaultChoiceIndex`: a `Choice` marked `keyboard: 'default'`, else
  the first quest choice, else the first normal one;
- an exit choice only when it is all the row holds.

A choice that spends, wagers or commits irreversibly is marked `keyboard: 'never'`. A
confirm row like that sets `keyboardDefault: 'none'`, so a player holding Space to read
through is never taken as agreeing. Voss's paid shard assembly and Briar Hollow's "I'm
ready" are the examples. `npm run verify:dialog-accept` walks every row with Space alone.

**Walking away ends a conversation at one rule** (`src/dialog/walkAway.ts`). A surface
opened from within `talkRangeTiles` closes at `walkAwayRangeTiles`, that range plus one
tile. The margin is the hysteresis: shuffling while reading never closes it, and a step
that really leaves does. Between the two ranges the box stays up to be read, but an
interact press is handed to whoever the player has walked up to (`Conversation.handOff`),
so turning from one speaker to the next never lets a stale box take the key. In the safe
room the Bopca and Mordecai's ranges overlap. `safeRoomSpeakerFor`
(`src/systems/safeRoomSpeaker.ts`) gives a press to the nearer of the two.
`npm run verify:walk-away` holds the rule.

**Voice.** People talk about their own lives, and the world reaches the player through
them. A person gives at most one fact about the wider world per conversation, and only
one they would plausibly know. Residents mention each other. Skyfowl call anyone who does
not fly "groundfolk". Avoid these:

- the aphorism-then-reversal ("It is not X. It is Y.");
- summing-up closers ("That is the whole of me.");
- stock fantasy barks ("Move along", "Finest wares this side of…");
- more than two or three people in town noticing the floating cameras;
- a townsperson narrating a game mechanic in the game's own terms.

Clue lines, safe-room guidance and service explanations are load-bearing. Reword them,
never drop them. Two passages are written by hand by the user and are never reworded:
Wendell's `RESIDENT_LINES` entries and all of `src/dialog/scripts/scenes/anchor.ts`.

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

**A rename needs a save migration.** `clearedRooms` and `paidOutInteriorProps` are keyed
by building name, so a save from before a rename would forget every room cleared or
searched there. `RENAMED_BUILDINGS` in `TownMemory.ts` maps each old name to the current
one, and `migrateRoomKey` rewrites both sets when a save is parsed. Entries are never
removed, because a save can sit unloaded for any length of time. Wendell's home was
"Shepherd's Cabin" and is now **Plumbline Farm** (facade `plumbline_farm`).
`verify:town-save` covers the migration.

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

### The Borrowed Blueprints

Fenna's side quest. She wants the saw and the rope walk upgraded to Tikka's design, but
she lent the blueprints to Wendell at Plumbline Farm in the Over City. Wendell will lend
them back for a dairy cow. Merrit parts with one, Midge, once the party has rebuilt her
pasture fence and brought in a hundred grain. The party walks Midge across the wilds to
Wendell's pasture while the road's dead go for her, brings the blueprints home, and
builds the two upgraded stations. The stations are the whole reward.

`BlueprintsQuestSystem` (`src/systems/briarHollow/BlueprintsQuestSystem.ts`) is built by
`BriarHollowKit` after the Plea's system. It owns the phase, guidance, journal row,
minimap pips and villager seams (journal id `borrowed_blueprints`). Each hands-on part is
a class in `src/systems/briarHollow/blueprints/` that the system and the kit route input
and render passes to: `FennaBlueprintsLines`, `MerritBlueprintsLines`,
`PastureFenceWork`, `GrainHarvest`, `MidgeEscort` and `StationUpgrades`. Wendell lives
indoors, where the kit does not run, so his side is `WendellBlueprintsHook`, one of
`BuildingInteriorScene`'s resident quest hooks. Phase moves go through
`moveBlueprintsPhase` (`blueprintsProgress.ts`) in both scenes, which emits
`blueprintsQuestPhaseChanged`, `questStarted` on acceptance (so the journal pins it) and
`questCompleted` at the end. Its lines are in `blueprintsDialog.ts`, `fenna.ts` and
`merrit.ts` under `src/dialog/scripts/briarHollow/`, and `src/dialog/scripts/wendellBlueprints.ts`.

**The steps** (`BlueprintsQuestPhase`, `src/core/blueprintsQuestPhase.ts`):

| Phase             | Entered when                                      | Guided to                                                                                                                   |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `unoffered`       | default                                           | — Fenna shows `!` once `constructionUnlocked`                                                                               |
| `declined`        | "Not right now" on Fenna's offer                  | — an "About those work stations" topic on Fenna re-offers; no pip                                                           |
| `ask_wendell`     | "We'll help"                                      | Plumbline Farm's door, then Wendell (`?`)                                                                                   |
| `ask_merrit`      | Wendell's first-visit conversation read through   | Merrit (`?`)                                                                                                                |
| `build_fence`     | Merrit's ask read through                         | the nearest unbuilt fence section, or the shortfall                                                                         |
| `report_fence`    | the tenth section built                           | Merrit (`?`), after a "Fence rebuilt!" banner                                                                               |
| `harvest_grain`   | Merrit's fence report read through                | the scythe on the barn wall if nobody holds it, else the grain field                                                        |
| `deliver_grain`   | grain reaches 100                                 | Merrit (`?`), after a "Harvest complete!" banner; Midge (`!`) once Merrit calls her                                         |
| `escort_midge`    | Merrit's "There she is" conversation read through | the next waypoint on Midge's road, then Garrison Green; Midge (`!`) at the start and while out of lead range or at the gate |
| `midge_delivered` | Midge is led into Garrison Green                  | Plumbline Farm and Wendell (`?`)                                                                                            |
| `build_stations`  | Wendell's hand-over read through                  | the nearest station still to upgrade, or the shortfall; Wendell if nobody holds them                                        |
| `complete`        | the second station upgraded                       | —                                                                                                                           |

The steps the world finishes (last fence section, hundredth grain, second station) are
polled in `BlueprintsQuestSystem.update`. The rest move on Fenna's answer or once a
conversation's last page is read, so a beat left early plays again next time.

**Between the steps** (`BlueprintsStepMoments`, told of every move through
`BlueprintsQuestSystem.setPhase`). The last fence section and the hundredth grain each put
up a banner under the quest counter's slot for `STEP_BANNER_SECONDS` — "Fence rebuilt!" /
"Tell Merrit the fence is finished", "Harvest complete!" / "Bring the grain to Merrit" —
and emit `objectiveComplete` (`blueprints_fence_rebuilt`, `blueprints_grain_harvested`),
which plays `objective_complete`. The escort opens with "Midge is yours to lead". A kit
rebuilt mid-step shows no banner for a step it did not see finish. Midge wears a `!` and a
beacon (`Cow.questMarker`, drawn by her own render) while she answers Merrit's call, for
the escort's first `MIDGE_INTRO_SECONDS` captioned "Lead Midge to Wendell's pasture", and
whenever she is out of lead range or waiting at the gate, captioned "Midge is waiting for
you". While she answers the call the journal points at her instead of Merrit.

**Who does what.**

- **Fenna** (`FennaBlueprintsLines`) makes the offer as a `confirm` opening while the
  phase is `unoffered` and Construction is open: `constructionUnlocked`
  (`villageUnlocks.ts`), the same rule the Build button reads, so the `!` and the button
  can never disagree. The Plea registers its quest-line provider first, so wherever the
  Plea still needs Fenna its opening and marker win. Her line naming where Wendell lives
  computes the town's bearing from the village (`skyfowlTownWhereabouts`, falling back to
  "the skyfowl town past the road"). While the quest is under way she opens with "Any
  luck with those blueprints?", and at the end she barks the completion line.
- **Wendell** (`WendellBlueprintsHook`) plays the first visit at `ask_wendell` and the
  hand-over at `midge_delivered`, ahead of his usual resident flow. Between them he says
  his waiting line once per visit and is then his usual self, because his bed must stay
  reachable. In `build_stations` with neither crawler holding the blueprints, talking to
  him hands them back. Both hand-overs go into the steered crawler's quest slot. Every
  beat waits while the other crawler lies knocked out in the room: he falls back to his
  usual lines and the step stays put.
- **Merrit** (`MerritBlueprintsLines`) has an opening for each of her steps and a `?` in
  `ask_merrit`, `report_fence` and `deliver_grain`. Her ask reads whether the Plea is won.
  Handing in the grain spends the counter, takes the scythe back to its pegs, raises the
  whistle cue and barks "HERE MIDGE! COME HERE GIRL!" with `force`. When Midge reaches
  the party she opens "There she is" herself: an auto-opener that waits for the shared box
  to be free, owns its beat through the handle, and cannot be dismissed. Between the
  hand-in and that conversation closing she has no line and no marker, so the grain
  cannot be handed in twice.

**The fence.** `pastureFenceSections(site)` (beside the layout in `briarHollowLayout.ts`)
walks Merrit's pasture ring clockwise from the tile after the gate and cuts it into
`PASTURE_FENCE_SECTION_COUNT` (10) contiguous runs whose lengths differ by at most one.
It is deterministic and unseeded, and a run's index is what
`blueprints.fenceSectionsBuilt` saves, so changing the cut changes which sections a save
has built. The ring is painted as the `'rickety'` `FenceStyle` (`drawRicketyFence`,
`decorationTiles.ts`); `PastureFenceWork` restyles each built section to
`post_and_rail`, and every step from `report_fence` on counts them all built. A restyled
tile dirties its eight neighbours as well, because rails join toward them. In
`build_fence` only, the unbuilt section with a tile within `FENCE_REACH_TILES` glows;
Space, or a single tap on it, starts a `FENCE_SECTION_WORK_SECONDS` hammering channel
that moving cancels. The `FENCE_SECTION_COST` (two boards) is counted again and spent when
the channel ends; short, the party hears "Not enough materials." and guidance switches to
`shortfallGuidance`. In the Space chain the fence comes first, ahead of the wall build.

**The scythe and the grain.** `scythe_pegs` hangs on the barn's north wall and shows the
scythe whenever no crawler holds `quest_scythe` (`TileContent.scytheTaken`). In
`harvest_grain`, Space or a tap in reach puts it in the active crawler's quest slot.
`GRAIN_FIELD`, the field south of the scarecrow (`briarHollowLayout.ts`), is always grain;
its stands are left out of the chunk bake and drawn each frame from a cached four-stage
set (`full`, `thinned`, `sparse`, `stubble`). A press next to a stand (the faced one first)
starts a `SCYTHE_SWING_SECONDS` (1.5 s) swing, drawn on Carl's chop row paced to the swing
with the scythe as his working tool; Donut swipes as the grain falls. The swing shows a
screen-wide timing bar in the HUD pass (`ScytheSwingBar`): a needle crossing a track with
the good and perfect bands marked, laid out below the crawler and pushed in sideways or
up off the HUD panel, minimap, hotbar and a phone's buttons (compact under 520 px tall).
The one timed second press is the attack key (Space) or, on a phone, any tap while the
swing claims world taps:

| Second press lands in                            | Grain                |
| ------------------------------------------------ | -------------------- |
| `SCYTHE_PERFECT_WINDOW` (0.66–0.74 of the swing) | `GRAIN_PER_PERFECT`  |
| `SCYTHE_GOOD_WINDOW` (0.55–0.85)                 | `GRAIN_PER_GOOD`     |
| nowhere, too early or too late, or never         | `GRAIN_PER_MISS` (1) |

The press is judged the moment it is made: "PERFECT!" or "Clean cut!" with the hit band
flashing white, rays out of the press mark and the screen edges glowing, or "Miss!" with
the track flashing red, the bar shaking and a cross at the press mark. A swing that runs
out unpressed is judged a miss as it lands. A miss still lands like any swing — its one
grain, a `+1 Grain` float, the gather sound and a cut on the stand — and the bar shows a
dimmed "+1 grain" beside the red "Miss!". Each verdict raises its cue once
(`scytheTimingPerfect`, `scytheTimingGood`, `scytheMiss`), and the bar stays up with it for
`SWING_VERDICT_LINGER_SECONDS` (0.7 s) after the swing unless the next swing starts first.
Only the first second press counts; repeats and later presses are swallowed so they
reach neither the grade nor the attack. The press is graded by the input event's own
`e.timeStamp` (a tap by its touchstart), never the handler's clock, and time spent with
the world halted is added to the swing's start. The grain lands when the swing ends, with a
`+N Grain` float, and the stand takes a cut. Moving, attacking, being struck or a hostile in
attack range ends an unjudged or missed swing with nothing, but lands a swing whose press
was already judged a hit at once, its verdict lingering as usual. Going down, losing the
scythe or the step moving on drops the swing whatever its verdict. Three cuts leave stubble, which
regrows over `GRAIN_REGROW_SECONDS` (30 s), passing back through `sparse` and `thinned`
in its last third. Cuts live in `GrainHarvest` only, so a reload regrows the field. Grain
is quest progress (`blueprints.grain`), never a party resource; overshoot past 100 is
kept, and the counter shows "N/100 grain".

**Midge.** `LivestockSystem` names two of Merrit's adults by slot, not by seed: Midge is
the last dairy cow with no calf (`MIDGE_SLOT`), and Bramblewick is the first other
holstein, for Merrit's joke. Neither is the soldier Midge Candleear, who is a villager.
Merrit's call releases Midge from the herd (`releaseMidge`), and an ordinary cow of her
coat comes out of the barn in her place, so the herd is never one short. She walks to the
party and is snapped beside them if that takes longer than `MIDGE_CALL_TIMEOUT_SECONDS`.

- **Led.** She follows whichever crawler is being steered, in a latched band
  (`MIDGE_LEAD_BAND`: sets off past `MIDGE_FOLLOW_START_TILES`, stops inside
  `MIDGE_FOLLOW_STOP_TILES`), at `MIDGE_LED_SPEED`, on A* with a widened path budget. Left
  past `MIDGE_LEAD_BREAK_TILES` she stops, faces the party and lows every
  `MIDGE_LONELY_MOO_SECONDS` until they are back inside `MIDGE_LEAD_RESUME_TILES`. She
  never flees while led; a blow makes her flinch where she stands. Her cowbell cue ticks
  while she walks.
- **Targetable.** While led on the escort she is pushed into the scene's target list
  (`BriarHollowKit.pushEscortTargets`), never as a defend target, which every hostile
  refuses. She is hardened to `MIDGE_ESCORT_HP`, tuned by playtest, and wears a small
  health bar.
- **The road.** The guidance never points straight at Garrison Green, which would aim
  the arrow across forest, ruins and the town wall. `escortRoute.ts`
  (`src/systems/briarHollow/blueprints/`) plans one walk per map, remembered with the
  `GameMap`: A* from Merrit's gate (`merritGateTile`) to any tile of the green's cart
  gate, over the tiles Midge's own steps accept (`isWalkable`, no stairwell, never a
  building doorway, which would carry the party indoors), four-connected, with a road
  step (any paved surface, a bridge deck or the village gate) far cheaper than open
  ground, river water dearer still, and a small toll beside a blocked tile so it keeps
  to the middle of the road. It is cut into waypoints: from each, the furthest tile on
  that is at most `ESCORT_WAYPOINT_MAX_SPACING_TILES` away, stays within a tile and a
  half of the straight line, and has a `hasWalkableLine` to it — so every bend gets a
  waypoint and the arrow never points through anything. The last waypoint is the gate.
  `EscortRouteProgress` (owned by `BlueprintsQuestSystem`, ticked every update in
  `escort_midge`) counts how far along the route Midge and the party have got: forward
  freely, back only when Midge is carried well back (a scare home) or led well off the
  road, where it is picked afresh from her tile; a waypoint within
  `ESCORT_WAYPOINT_ARRIVAL_TILES` of the steered crawler is reached. The guidance is
  `escort_waypoint` — the tracker arrow and minimap pip point at the waypoint, and
  `VillageQuestGuide` draws its highlight, a bouncing arrow and "Lead Midge along the
  road", a dotted trail along the road on through the next waypoint
  (`escortRouteMarkers.ts`), the next two waypoints and the pasture in the quieter
  pending voice. Past the gate it is `pasture`, as it is on a map with no route; left
  behind, Midge is pointed at (`lead_midge`) as before.
- **The ambushes.** `EscortAmbushSystem` springs `ESCORT_WAVE_COUNT` (3) waves at
  `ESCORT_WAVE_PROGRESS`. Progress is walked: a breadth-first field of every open tile's
  steps to the inside of the town wall, running from the village gate nearest the town
  (0) to `WAVE_SANCTUARY_CLEARANCE_TILES` short of the wall (1), so the first wave springs
  as she clears the palisade, two more come on the road, and none springs so near the
  wall that it could not reach her before she is through it. A wave springs only while
  the road is clear of ambushers still in the fight — from any wave, or from an attempt a
  scare cut short — and only once it has been clear for `ESCORT_WAVE_MIN_GAP_SECONDS`, a
  breather. An ambusher is out of the fight, and holds nothing back, when it is further
  than the let-go distance from everyone (past the furthest a body can come up), or has
  come no nearer for a few seconds while still out of a bow's reach (stuck behind
  something); one a snare turns stops being the road's at once. Each wave is
  `ESCORT_WAVE_MIN_BODIES`–`ESCORT_WAVE_MAX_BODIES` (9) bodies — three to each crawler and
  three for the cow — drawn from `ESCORT_AMBUSH_KINDS` within `ESCORT_KIND_CAPS` (three
  ruins ghouls at most), levelled like the siege and fielded as lesser dead at
  `ESCORT_BODY_HEALTH_SHARE` of their kind's health (`fieldAsLesserDead`); both that and
  `MIDGE_ESCORT_HP` are tuned by playtest. `verify:difficulty-curve` prices a wave a third
  at a time, the thirds that reach the party back to back. They come up one after
  another behind Midge, on one bearing per wave swung up to forty degrees off straight
  behind her, each at the first spot along it the party cannot see, so just past the
  screen's edge whichever way the road runs (`offscreenSpawns.ts`, the siege's rules);
  a body that finds nowhere out of sight there widens its search round her over
  `SPAWN_WIDEN_SECONDS`, so a wave is never held to a side the palisade or a lake fills.
  Never inside the palisade or the town wall, and never once the escort is over. The
  first body of each wave announces its side ("Ambush! The dead come for Midge from the
  east!"), and while any ambusher still in the fight is off screen a red chevron at the
  screen's edge points at it (`renderIncoming`, drawn over the fog from the kit's HUD
  pass). They `forceAggro` and fixate on Midge while she is led (`Mob.fixatedTarget`):
  they track her by more than sight, and turn on a crawler only one that steps right in
  their way. **The road's sanctuary is the town wall, not the safe zone:** the safe zone's
  forty-tile circle reaches out past the wall to within twenty-odd tiles of the palisade,
  so while Midge and the whole party are outside the wall the ambushers
  `ignoresTownSafeZone`, and the moment any of them is through it they keep the safe zone
  again and break off. One out of the fight, or left on the road after the delivery, is
  let go once nobody can see it. Each wave plays the ambush sting, and
  `defense_quest_music` takes over from the zone music while any ambusher lives on the
  escort, handed back the moment she is delivered. `verify:midge-escort` walks the road
  with a party that leads her on at a wide window without stopping for what it cannot
  see, and holds that every wave comes up near her on ground that walks to her, comes on
  screen, and reaches her or the party within `WAVE_ARRIVAL_SECONDS_MAX`.
- **The Plea's siege.** While Briar Hollow is under siege (`isVillageUnderSiege`) the
  escort holds: Midge stands where she is, off the lead and out of every hostile's
  target list, and no wave springs or comes up until the siege is over. A wave that was
  still coming up keeps its bodies and finishes after the siege.
- **Scared home.** She cannot be killed on the road (`cannotBeKilled`). Beaten down —
  under `MIDGE_BEATEN_BELOW_HP`, since a blow stopped a point short is scaled again by
  the difficulty and can shave her last point in ever smaller fractions — she
  plays no death, drops nothing and runs no respawn: she is at once back at Merrit's
  pasture gate, full health, off the lead; ambushers targeting her lose her; all three
  waves re-arm; and a narrator box says "Midge got scared and ran back home". The phase
  stays `escort_midge`, and she is led again when the party comes within
  `MIDGE_FOLLOW_START_TILES`. The tracker says "Midge is waiting at Merrit's gate."
- **Delivered.** With the steered crawler inside Garrison Green and Midge within
  `MIDGE_LEAD_BREAK_TILES`, the phase moves to `midge_delivered` at once, her settled
  moo plays, and she is Wendell's: she walks in through the cart gate by herself into a
  pen built from the yard (`CowPen.forYard`), and is set down inside if the walk takes
  too long. A door visit mid-walk finds her already there.
- **Doors and rewinds.** Every door rebuilds the overworld and throws its roster away, so
  `MidgeEscortCarry` (`src/core/midgeEscortCarry.ts`), handed by reference from scene to
  scene like `BountyProgress`, carries her position and health while she is led on the
  escort, and the count of waves already sprung. The next scene raises her there, still
  led. It is never saved or checkpointed: after a load or a death rewind in
  `escort_midge` she stands at Merrit's gate, whole and waiting, with every wave armed.
- **At Wendell's.** From `midge_delivered` on, `WendellsMidge` raises her in Garrison
  Green on every scene built after she arrived. She has the herd's routine inside her own
  pen and the herd's respawn (`LivestockRespawner`, `RESPAWN_SECONDS`, the same
  `clearRespawnTile` check), always in her pasture and never in Briar Hollow. She lows in
  one voice, `cow_ambient_moo_1`, on her own `WENDELL_COW_MOO_MIN_SECONDS` to
  `WENDELL_COW_MOO_MAX_SECONDS` timer, and only with a crawler in earshot. A rewind
  stands her back in her pasture (`Cow.setHomeTile`), never in Merrit's paddock, and a
  herd raised before the quest said she had gone gives up her name
  (`retireMidgeName`), so there is only ever one Midge.

**The stations.** In `build_stations`, while either crawler holds `quest_blueprints`, the
active crawler within `PROCESSING_REACH_TILES` of a machine not yet upgraded can upgrade
it. On desktop X (`quickLoad`) asks `StationUpgrades.tryUpgrade` first and only falls
through to `repairOrLoad` when no station applies. On a phone a double tap on the machine
asks first, ahead of `ConstructionKit.handleDoubleTap`; `tryUpgrade` refuses on mobile so
no single gesture starts an upgrade the prompt never offered. Starting an upgrade drops
any sawmill cut under way there, which has spent nothing yet. The costs are fixed and
ignore the Construction discount, so the number the player was told stays true:

| Station   | Constant                 | Cost                         |
| --------- | ------------------------ | ---------------------------- |
| Saw       | `SAW_UPGRADE_COST`       | 30 boards, 15 rope, 20 stone |
| Rope walk | `ROPE_WALK_UPGRADE_COST` | 12 boards, 20 rope, 10 stone |

Short, the party hears "Not enough materials." and guidance switches to the shortfall.
Otherwise a `STATION_UPGRADE_SECONDS` (4 s) channel runs, cancelled by moving; at its end
the cost is spent, `stationsUpgraded` set, the machine's art swapped through
`TileContent.stationUpgraded` (the placed prop id never changes), a callout floats — and
while it does, the machine's own prompt stays off it for a crawler still standing in reach
of that machine, while anywhere else the prompt slot is everyone else's as usual — and
the worker earns `STATION_UPGRADE_CONSTRUCTION_XP`. An upgraded station works
`UPGRADED_WOOD_PER_PRESS` (4) wood per press in the same `MANUAL_PROCESS_SECONDS`, or
whatever wood the party has if less (`SawmillService.woodPerPress`); manual-processing XP
stays per wood, and the lumber foreman's bulk service is unaffected. When the second
station finishes, Fenna barks, the blueprints are taken off whoever holds them, and the
quest completes.

**The quest-complete screen.** The quest shows the shared quest-complete screen
(`QuestRewardScreen` in `src/ui/questReward/`, one per scene on `MenusKit`, raised through
the `questRewardShown` bus event). `BlueprintsQuestSystem` asks for it once the quest stands
`complete`, the last upgrade's callout has played out and the Plea's siege is not on; the
screen itself then waits until no conversation is open and nothing else halts the world.
Its spec (`blueprintsRewardSpec`) holds the quest's name, a line from Fenna, and one
"Permanent upgrades" unlocks section — the upgraded saw and rope walk, each with its intake
and output per press against a plain station's — and a footnote giving the press time and
the multiplier. Every figure is worded from `UPGRADED_WOOD_PER_PRESS`,
`PLAIN_WOOD_PER_PRESS`, `BOARDS_PER_WOOD`, `ROPE_PER_WOOD` and `MANUAL_PROCESS_SECONDS`
(`blueprintsStationRewards`), so the screen cannot drift from the sawmill. Narrated quest
lines wait behind the screen. Continue (focus ring primary: Space / Enter, tap, click) or a
fresh Escape dismisses it; a press before the reveal settles finishes the reveal instead.
Dismissal sets `blueprints.completionScreenSeen`, so a door visit, a reload or a rewind
never raises it again; a completion whose screen was never dismissed raises it again on the
next kit. A save from before the flag existed reads as seen when the quest was already
complete.

Every station still to upgrade stays marked for the whole of `build_stations` while the
blueprints are held — including while guidance has sent the party off to chop, mine or
process for a shortfall (`StationUpgrades.renderGround` / `renderAbove`). Each gets an
area highlight over its footprint with corner brackets round its whole art, gold and
solid when the party can pay for it, orange and dashed while short, and a caption panel
over it whenever it is on screen: "Upgrade saw" over one line per material
(`RequirementRow`), green with a tick once held and red while short, the title and border
turning gold when every line is met. In reach of a machine the party can pay for, the
caption adds "Press X to upgrade" and `StationUpgrades.renderPrompt` claims the prompt
slot without drawing; short, it leaves the slot to the sawmill's own process prompt. The
village guide draws no highlight, arrow or caption of its own over a machine the quest is
marking (`VillageQuestGuideDeps.questMarksStation`). The fence prompt's cost line is the
same requirement row.

**Highlights.** `VillageQuestGuide` marks what a step points at with
`drawAreaHighlightGround` / `drawAreaHighlightFrame` (`src/ui/AreaHighlight.ts`), sized to
the thing's whole footprint: the grain field, the pasture, a fence run's bounding box, a
station, the trebuchet, the bell tower, and a single tree (one and a half tiles, centred)
or rock. The ground half — an edge wash clear in the middle, a glowing rounded outline
with two sparks lapping it, rising motes — is drawn under every body; the frame half,
corner brackets, over every body, so a tall sprite still reads as marked. A zone for a new
trebuchet is the same highlight in green, `pending`. Because the guide marks the field and
the pasture itself, their tracker targets are `wearsOwnMarker`, and the scene's objective
beam does not stand on them.

**The quest slot.** The scythe and the blueprints are quest items, and neither is
recorded in `BlueprintsQuestState`: every reader looks at both crawlers' inventories
(`holderOf`, `isHeld`), so a lost item cannot desync the quest. Every quest item goes
through `Inventory.replaceQuestSlot`, which evicts a different quest item already in the
slot and reports it; the running scene forwards that onto its bus as `questItemEvicted`
(`forwardQuestItemEvictions`). Carrying one quest's item therefore costs another's, by
design, and each quest recovers from the derived state:

- If the scythe is evicted, the pegs show it again and guidance points back to the barn
  wall. If the blueprints are evicted in `build_stations`, they are back in Wendell's plan
  chest and guidance points to him. Fence sections, grain and upgraded stations are all
  in state, so nothing is lost. The crawler whose slot it was barks "We left the scythe
  behind." or "We left the blueprints behind." (their partner, if they are knocked out),
  through `barkWhenBlueprintsItemEvicted`. Swapping one of this quest's items for the
  other, and the quest taking its own items away, stay quiet.
- The Anchor's wood pile (Hilda's cottage) gives its boards to whichever crawler walks
  onto it, evicting any other quest item in their slot — the blueprints go back to
  Wendell exactly as above. Only when both crawlers are in reach on the same frame does
  the one whose slot is empty or already holds boards take them. The boards respawn
  after `WOOD_PILE_RESPAWN_SECONDS`.
- `Inventory.clearQuestItem(id)` retires only its own item, so a quest ending never
  empties a slot another quest is using.

**The siege.** While the Plea is `imminent` or in `assault` this quest stands down:
Fenna's offer and topic are withdrawn, Merrit and Fenna have no quest lines (so the
grain hand-in waits and Merrit will not call Midge out while the herd shelters),
guidance is null, the counter is hidden, and every open journal row reads "Briar Hollow
is under attack." (`BLUEPRINTS_SIEGE_HINT`).

**Downed partners and doors.** No building anywhere opens while the crawler not being
driven is knocked out: `downedPartnerEntryRefusal` (`BuildingSystem.ts`) refuses with
"{Name} is down. Help them up before going inside." through
`DungeonScene.sealedBuildingMessage`. A crawler can still go down indoors
(`companionDownIndoors`), which is why Wendell's beats check for it themselves.

**The HUD.** `QuestCounterHud` draws "N/10 fence sections" in `build_fence` and "N/100
grain" in `harvest_grain`, under the resource strip's slot, stepping aside to the nearest
clear spot where that lands on phone buttons, the minimap, the HUD panel or the hotbar.

**Sound.** Every play site raises a cue from `BLUEPRINTS_CUES`
(`blueprintsSoundCues.ts`), never a raw id; each cue's JSDoc names the recording it
waits for, and until it lands the cue borrows the nearest existing sound or is an empty
list and stays silent. Every id a cue names must be preloaded in the `briarHollow` or
`universal` SFX group, which `verify:borrowed-blueprints` checks.

### Persistence

Village state is split by who owns it:

| What                                                                | Where                                                                     | Scope         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| Quest phase, structures, soldier orders, merchant stock, once-flags | `BriarHollowState` → `PersistedWorldState` / `WorldCheckpoint`            | per floor     |
| Tool tiers, explainers seen                                         | `PartyCraftsState` → `GameProgress.crafts` / `LevelCheckpoint`            | party         |
| Resourcing and Construction levels and XP                           | `Player.craftSkills` → `PlayerSnapshot`                                   | per crawler   |
| Harvest-node capacity and regrowth                                  | threaded `BriarHollowState`, checkpointed by `GatheringKit`, not saved    | page lifetime |
| Villager memory                                                     | threaded `BriarHollowState`, neither checkpointed nor saved               | page lifetime |
| The Borrowed Blueprints: phase, fence sections, grain, stations     | `BriarHollowState.blueprints` → `PersistedWorldState` / `WorldCheckpoint` | per floor     |
| Midge's place and health mid-escort, ambush waves sprung            | `MidgeEscortCarry`, handed scene to scene, never saved or checkpointed    | door visits   |
| Grain stands cut                                                    | `GrainHarvest`, not saved                                                 | scene         |
| Session harvest tallies, thrall cooldowns                           | module state                                                              | page lifetime |

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
- `?playtest=blueprints-offer`, `blueprints-fence`, `blueprints-harvest`,
  `blueprints-escort` and `blueprints-stations` place the party at each step of The
  Borrowed Blueprints with what that step needs: the Plea won and Construction learned;
  the boards for the fence; the scythe in hand; Midge waiting at Merrit's gate; the
  blueprints in hand with the materials for both upgrades. The village state is seeded
  before the scene is built (`blueprintsPlaytestState`), so the herd is raised knowing
  whether Midge has left it.
- `npm run verify:borrowed-blueprints` is the quest's headless gate: the phase order and
  every transition, persistence (an old save with no `blueprints` included), provider
  order, quest-slot eviction and recovery with its barks, markers and journal rows,
  Merrit's and Wendell's beats (hand-over and hand-back included), the fence (only in
  `build_fence`, taps, cancel, refusal), grain grading and regrowth, the X precedence,
  station costs, refusals and four wood a press, that every cue's ids are preloaded, and
  Midge's road: on forty generated maps it runs from Merrit's gate to the green's gate,
  every step walkable for her and out of doorways, at least 85% road, every waypoint a
  straight walk from the last; a scripted walk moves the waypoint only forward, holds it
  through a jostle, takes it home with a scared Midge and re-picks it off the road; and
  in a live rig the guidance, pin and pip name the same waypoint. Its sections live in
  `scripts/borrowed-blueprints/`.
- `npm run verify:midge-escort` stages the escort on real floor-3 maps through the siege
  harness: Merrit's call, the follow band without oscillation, stand-and-moo past the
  break distance,
  waves only outside the safe zone and off screen, a door keeping her place, a rewind and
  a scare putting her at the gate, her life at Wendell's, and a seeded many-stream sim in which a sensible
  defence delivers her in most runs **and** she is hurt in most runs, so the gate tests
  danger as well as survival. Her escort health is tuned against it.

---

## Circus grounds

Grimaldi's circus is a disc of `CIRCUS_RADIUS_TILES` (14) about 70–90 tiles from the
map centre, sited after Briar Hollow and clear of it. The quest's waves
(`RITUAL_WAVES`, `ASSAULT_WAVES` in `CircusQuestSystem`) name their spawns as offsets
from the same centre the grounds are laid out from, so the grounds are authored,
not scattered.

```
src/map/overworld/
  circusGroundsLayout.ts  the authored template: footprints, placements, keep-clear
                          bands, rim anchors, bunting/festoon spans, decals, the arch
  paintCircusGrounds.ts   stamps it: lot, tents, approach road, arch, lamps, rim props
src/map/tiles/
  circusStructureTiles.ts draws a structure from its drawing tile
  circusDecalTiles.ts     the lot's ground decals
  circusSiteRegistry.ts   structure grid → site record, for painters handed only a grid
src/sprites/sheets/circusSheets.ts   PropSheetPlans, one sheet per footprint shape
src/sprites/art/circusArt.ts         the structure painters
src/sprites/art/circusArchArt.ts     the arch's crossbar, sign and marionette
src/sprites/art/circusLettering.ts   brush-painted capitals for the marquee and boards
src/sprites/art/circusOverlayAnchors.ts  where live dressing meets baked art
src/systems/circus/CircusGroundsAmbience.ts  everything on the grounds that moves
```

`paintCircusGrounds` decides nothing: every footprint, door, bearing and band comes
from the layout, and it only writes them down at one centre and bends the rim round
the one road. The result, `CircusGroundsSite`, rides out on `OverworldData.circusGrounds`
and `GameMap.circusGrounds`, so gates, minimap and ambience read the grounds off the
map instead of re-deriving them. **The world seed never reaches geometry.** It only
picks paint variants: litter, how a vine wanders, which pennant is torn.

### Layout

- **Fixed:** the 12 × 5 Big Top stands north of the centre with its two-tile door
  facing south on the centre row, because the interior is entered from the south. Its
  plan is an ellipse, so the rectangle's four corner tiles stay walkable. The three
  3 × 2 side-show pavilions stand north-west, north-east and north, behind the door
  line, which leaves the south field open for the fat clowns and mold lions.
- **The approach road** (`circusApproachCentreLine`) starts on the doorstep, runs out
  along the forecourt row and on to the nearest town gate at any angle. A road that
  must leave northward first runs along the forecourt to a flank column
  (`CIRCUS_ROAD_FLANK_COLUMNS`) between the Big Top and a pavilion, so it always
  delivers the party to the door. It is paved after the tents, so it stops at their
  walls instead of running under them.
- **Gate highways stay paved.** The lot pass skips any paved tile, so a town highway
  crossing the disc runs on through the lot, and every later placement test refuses
  paving.
- **The entry arch** (`entryArchFor`) stands where the road's centre line first reaches
  the rim: one `arch_post` either side, 2–4 tiles off the centre line on the first
  unpaved tile. The crossbar spans 4–8 tiles across or up the screen, so it cannot be a
  sheet frame. `CircusGroundsAmbience` paints it once per site from `circusArchArt.ts`
  and swings the marionette live.
- **Keep-clear bands** (`CIRCUS_KEEP_CLEAR_BANDS`): forecourt, lemur field, stilt
  field, door plus two rows, and Signet's lookout. The road is kept clear by measuring
  the road itself.
- **Forest keep-out:** the generator adds a disc of radius + `CIRCUS_FOREST_CLEARANCE_TILES`
  (3) to the `KeepOut` handed to `paintForests`, because the rim props stand half a tile
  past the rim and a canopy climbs two tiles up the screen.

### The rim rule

Anything that blocks goes on the rim, where nothing fights: `CircusQuestSystem` holds
mobs inside r13. The field the waves fight over gets decals only.

- The six flame lamps sit at r13 on fixed bearings (`CIRCUS_TORCH_BEARINGS_DEG`). The
  wagons, booths, high striker and crate stack (`CIRCUS_RIM_PROPS`) take a fixed bearing
  or a fixed turn beside the arch (the ticket booth greets whoever comes up the road).
- Every tile of a rim footprint lies in **r12–r14.5**. The outermost fit wins, and the
  resolver walks `CIRCUS_RIM_BEARING_NUDGES_DEG` round the ring when a bearing is taken.
- A rim tile must be on the map, unpaved, outside every keep-clear band, not touching
  another structure, more than 2 tiles (Chebyshev) from an arch post and more than 3
  from Terror's spawn behind the Big Top. `leavesRimConnected` refuses a prop that would
  seal a pocket or cut the rim path.
- A prop with no legal footprint on its arc is left out, never jammed in.

### Tile types and registries

| Type                    | Walkable | Sight     | Drawn by                                          |
| ----------------------- | -------- | --------- | ------------------------------------------------- |
| `CIRCUS_LOT`            | yes      | —         | chunk bake: `circus_lot` ground material + decals |
| `CIRCUS_STRUCTURE_TALL` | no       | blocks    | Y-sorted pass: Big Top, pavilions, crate stack    |
| `CIRCUS_STRUCTURE_LOW`  | no       | seen past | Y-sorted pass: arch posts, lamps, wagons, booths  |

Structures use the Briar Hollow anchor pattern: the drawing tile, always in the
footprint's bottom row, is keyed `circus:<structure>` and draws the whole structure;
every other blocked tile is keyed `circus_part:<dx>,<dy>` and only blocks. Each is
written with `setStandingSprite`, so it records the lot it stands on and the lot's
decals run on under the tent's transparent margins. A missing registry entry renders
bare floor and still typechecks, so both structure types are in all of these:

- `NON_WALKABLE_TILE_TYPES` (`walkability.ts`); `LOW` alone in `SIGHT_TRANSPARENT_TILE_TYPES`;
- `DECORATION_TYPES` and `CACHEABLE_OVERLAY_TYPES` (`TileRenderer.ts`), plus the extents
  branch there; `DECORATION_OVERLAY_TYPES` and the draws-at filter (`GameMap.ts`);
- the `baseOnly` and draw switches of `drawDecorationTile` (`decorationTiles.ts`);
- `NON_FLOOR_TYPES` (`tiles/helpers.ts`) and `SOLID_TILE_TYPES` (`town/tileGrid.ts`);
- the minimap colours in `MiniMapSystem.ts`, `MobileHUDSystem.ts` and `TownMapScene.ts`.

They are deliberately **absent** from `GROUND_OCCLUDER_TYPES`: a tent is round and
paints its own contact shadow, and a band along its rectangle draws a dark box on the
lot. `CIRCUS_LOT` is absent from `NON_WALKABLE_TILE_TYPES`, since it is the ground every
circus fight is fought on. `gates:circus-art` checks the registry membership.

### The art

The circus sheet family is six `PropSheetPlan`s (`circusSheets.ts`): one sheet per
footprint envelope, one row per structure, one frame per variant. A structure's frame is
exactly as wide as its footprint and anchored on its drawing tile, with headroom above.
The family is registered in `environmentSheets.ts` with the level-3 wilderness group,
**unseeded**, so a tent survives the stairs. Structure seeds hash the structure id, not
the row, so adding a structure re-rolls nothing else.

The painters are on the town vocabulary ([One art vocabulary](#one-art-vocabulary)) with
their own ramps, `CIRCUS_RAMPS` / `getCircusRamp` in `townPalette.ts`: dried-blood and
bone stripes, bruise, tarnished brass, slate navy, mildew and vine. A tent is modelled
and then projected: stripe panels run from the eave to a king pole's peak and are warped
onto their quads with `drawPlane`, so they converge instead of reading as striped
wallpaper. Frame contract: ink stays inside the blocked columns and no lower than each
column's lowest blocked tile, except over a doorway and for soft shadow.

### Overhead dressing and decals

Bunting and festoon strings (`CIRCUS_BUNTING_SPANS`, `CIRCUS_FESTOON_SPANS`, tied to
king poles, pavilion peaks and lamps by name), pennants, balloons and the marionette are
overhead: they block nothing and are not tiles.

Decals (`circusDecalTiles.ts`) are the chalk ring, sawdust trodden out of the doors,
wagon ruts, litter, clown shoe prints, a stain by the cage wagon, and vine runners from
under the Big Top's skirt. Each decal is one shape in map tiles, compiled once per site.
Every tile draws the shapes crossing it, clipped to itself, so there are no seams and no
tile reads its neighbours. They stay low-contrast and sparse, because every telegraph is
read against the lot.

### Live ambience

`CircusGroundsAmbience` draws the moving parts over the baked frames: lamp fires, strings
stirring, guttering festoon bulbs, the marquee bulbs, the door's light, the marionette,
balloons and the caravan's curtain. Baked rows would cost a full frame per cell. Each
piece is a pure function of the clock and the quest stage, so a checkpoint has nothing
to capture. Positions come from the shared anchors (`circusOverlayAnchors.ts`, the
marquee bulbs and door mouth in `circusArt.ts`, the king poles and arch height in the
layout), so the painted and live halves cannot drift apart.

- `renderEntities()` joins the scene's Y-sorted entity pass.
- `renderGround()` draws the **door spill**. `RenderPipeline` calls it straight after
  `gameMap.renderCanvas`, before gore and every telegraph: the spill is additive and
  would wash out anything beneath it.
- `renderAbove()` draws the loose balloon over everything.

**Redeemed.** Once the quest reaches a resolved stage, every surviving bulb lights, the
door light warms, and the vine runners die back. That last change reaches the chunk
bake: `circusSiteRegistry.ts` holds a `vinesWithered` flag beside the site, and the
ambience flips it and calls `markTileDirty` on only the tiles the runners cross.

### Gates

- `npm run verify:circus-grounds` sweeps generated floors and holds several budgets:
  - blocked tiles in the r14 disc, a ratchet baseline (`BLOCKED_TILES_BASELINE`) under a
    fixed `BLOCKED_TILES_CEILING` of 95, which the baseline may never pass;
  - zero blocked tiles in every keep-clear band and the road, and zero sealed rim
    pockets;
  - every wave spawn within one tile of where it is authored (no exceptions are
    listed), and able to walk to the door, lookout and forecourt;
  - rim props in the band, off the road and highways, clear of the arch, each stood on
    at least 75% of seeds;
  - a headless assault whose stall-rescue lifts stay under `STALL_LIFTS_BASELINE`,
    which measures wedging.

  `--fault=` forecourt-solid, blocked-count, spawn-wall, pocket, rim-prop, rim-arch,
  cut-lookout, wedge or highway-prop must each turn it red. `--measure` prints every
  reading.

- `npm run gates:circus-art` checks the frame contract and the footprint ink, canvas
  convergence, the texture band against the lot, the registries, the arch and marionette
  surfaces, and a 6 MB sheet budget. Faults: wide-prop, flat-canvas, sheet-budget,
  loose-crossbar.
- `npm run render:circus-grounds` renders the real floor with Carl, Donut and the
  quest's cast (`--stage=`, `--seeds=`, `--time=`, `--label=`) into `preview/`.
- Dev: `?level=level3&spawn=circus`, `?level=level3&quest=<CircusQuestStage>`, the
  `circus-hire` playtest preset.

---

## Big Top

The tent's interior is a `BuildingInteriorScene` room. When the quest is `bigtop_ready`
it is the three-act maze run by `BigTopMazeSystem` (`src/map/bigTopMazeLayout.ts`:
fire walk, menagerie, hall of mirrors, the finale ring, and paired curtain rooms
between acts). Otherwise it is a plain ring whose curb and king pole `GameMap` lays out.
The maze is built from a `BigTopMazePlan` (`planBigTopMaze(worldSeed, difficulty)`),
which deals the hall of mirrors its board and writes it into `BIG_TOP_MAZE_ROWS`
before `GameMap.generateBigTopMaze` lays the tiles. Everything else built from the
plan — tiles, floor marks, chunk bake, the lighting mask — is built once from what it
says. `GameMap.generateInterior` calls `setBigTopDecorLayout` on every entry. It is module
state, like the wall finish, because nothing between the chunk bake and a tile painter
knows which room is live.

### Shell and floor

- **Walls** use the `'canvas'` finish (`WALL_MATERIAL_BY_BUILDING_NAME`). A wall tile
  facing no floor is the dark backstage mass, the `bigtop_backstage` material of the
  interior ground sheet, with dim clutter at least `BACKSTAGE_CLUTTER_CLEARANCE_TILES`
  (2) from any floor. A wall facing floor hangs a striped drape (`bigTopWallFace`).
  **A drape takes the act of the floor it faces, never the wall's own row**, because a
  dividing row belongs to the act below while its face is the south edge of the room
  above. Styles are `firewalk`, `menagerie`, `mirrors` and `ring`; the curtain rooms and
  the plain ring hang the house's `ring` drapes.
- **Floor** is `bigtop_sawdust` (`SAWDUST_FLOOR`, `CIRCUS_RING_EDGE` and `TENT_POLE` all
  resolve to it).
- **Floor marks** (`bigTopMazeDecor.ts` data, `bigTopFloorArt.ts` painters) are baked
  into the chunk per act: scorch and iron plates round the vents, straw drifts and paw
  trails in the menagerie, the harlequin cloth and stanchions in the mirror halls, the
  ring curb, spot mark and guy shadows in the finale, hold marks in the interval rooms.
  Each is one feature in tile units, painted whole and clipped per tile, stacked by
  `FLOOR_FEATURE_LAYER`. All are tonal shifts that can never pass for a telegraph.
- **Dressing density:** no act leaves a fully walkable 4 × 4 (`UNDRESSED_SQUARE_TILES`)
  without a mark. After the authored marks, a greedy fill drops one small scatter mark
  of the right act into each bare square. The index is built from the authored layout
  alone, so it does not depend on the live system existing.
- **The king pole** is a `TENT_POLE` block drawn in the Y-sorted pass from its
  bottom-left tile (`tentPoleTiles.ts`). A crawler north of it walks behind the mast,
  and one south of it in front. A pole 2 × 2 or larger is the king pole and also carries
  the trapeze. Its foot and shadow are baked into the floor, and it is in the same
  decoration and overlay-cache registries as the circus structures.

### Act III: the hall of mirrors

Act III is a light puzzle. The pure model lives in `src/map/bigTop/`:
`mirrorBoard.ts` holds the board type, the light walk, the solver, the simulated players,
the acceptance contract and the tiers. `mirrorBoardGenerator.ts` builds boards and
`mirrorBoardFallback.ts` holds one committed board per tier. At runtime,
`src/systems/bigTop/MirrorHall.ts` watches the light, and `BigTopMazeSystem` stands the
mirrors up, opens the barriers and plays the cues.

**The one rule: light every star at once.** A star shows only the light on it right
now. Take the light away and it goes dark. When every required star is lit at the same
moment, the board is solved: `MirrorHall.refresh` latches `solved` for **the whole
board, never a single star**, and all four `MAZE_HALL_EXITS` open (each lane's gate `<`
`>` on the hall's top wall and its door `[` `]` two rows above). The mirrors stay
turnable, and the exits stay open whatever is turned afterwards. A burned crawler's act
reset moves the party back to the act's marks but leaves every mirror where it was
turned, and a solved board stays solved. The rule sits in one seam,
`MirrorHall.settleStars`, which the gate swaps out to prove it (`--fault=latch-stars`).
The act card (`BIGTOP_ACT_THREE_CARD`) states the rule and the colours, and there is no
hint system.

#### The frame

The board is 36 × 14 tiles (`MIRROR_BOARD_WIDTH`, `MIRROR_BOARD_HEIGHT`) with board
`(0, 0)` on tent tile `MIRROR_BOARD_TENT_ORIGIN` (4, 19), so `boardTileToTent` is one
addition. Its top row is the wall the exit gates are cut into, its twelve floor rows are
`MIRROR_BOARD_ROWS` (tent rows 20–31), and its bottom row is the wall holding each lane's
doorway from the teaching strip (`MAZE_TEACHING_DOORWAYS`). The teaching strip's four
floor rows (`TEACHING_STRIP_ROWS`, tent rows 33–36) sit below that, and
`MIRROR_HALL_ROWS` spans both. `MIRROR_BOARD_DIVIDER_X` is the dividing wall: Carl's lane
is west, Donut's east. Each lane walks in at `MIRROR_BOARD_ENTRIES` and leaves by
`MIRROR_BOARD_EXITS`.

`BIG_TOP_MAZE_ROWS` leaves the hall's floor rows bare. `writeBoardIntoRows` writes each
board's limelights (`P` `Q`), stars (`*`), windows (`|`) and pillars (`o`) in, and
`tentMirrorsOf` stands the mirrors up as `MazeMirrorTarget` props.

#### The pieces

- **Limelights.** One per lane in the lane's outer wall, on a row the generator picks.
  Carl's throws **blue** east, Donut's throws **red** west. The span from the lens to
  the first optic is the **hot span**, the hall's only hazard: it burns, and it never
  moves. `boardHotSpan` walks it with every mirror's facing unknown, so no turn can
  change it. `hotSpanProblems` holds it fair. The first optic on each ray is a mirror
  within `FIRST_MIRROR_MAX_TILES` (5) of the lens, the fire stays in its own lane, and it
  never covers an entry or exit tile. The reachable row walks every lane with the hot
  span solid.
- **Pivot mirror** (Carl's). One-sided glass that turns a quarter per blow through all
  four facings (`PIVOT_CYCLE`). Light that hits its back stops.
- **Swivel mirror** (Donut's). One-sided glass that snaps between **two** facings, which
  vary per mirror. The art shows the current facing as glass and the other as a ghost
  mark (`drawSwivelMirrorWithGhost`). A mirror's owner is always the lane its tile is
  in.
- **Splitter.** A fixed half-silvered diagonal (`slash` or `backslash`). Light carries
  straight on **and** reflects, from either side. It is the only way one light reaches
  two stars.
- **Window.** A glass tile in the divider. Light passes and crawlers do not.
- **Stars**, set in wall tiles. **Blue** wants Carl's light and **red** wants Donut's.
  The **twin** sits in the divider, is hit from both faces, and wants both lights at
  once. The **encore** is gold and wants either light. A star reads `dark`, `lit`,
  `half` (a twin with one light) or `fizzle` (a coloured star with only the wrong light,
  drawn grey with sparks, so wrong light is never silently eaten). Every coloured star
  sits in the **other** crawler's lane, so each light crosses the divider by a window
  and is turned by the other crawler's glass. No star sits on
  `WALL_TILES_ABOVE_TEACHING_GLASS`, where the teaching glass's frames would hide it.
- **The encore** is optional and opens nothing. The generator puts it where some
  arrangement lights it but the constructed solution does not. It can be lit any time,
  including after the solve. It pays `MAZE_ENCORE_REWARD_COINS` (75) at its foot
  (`starFootTile`) **once per run**. `bigTopEncorePaid` lives on `CircusQuestProgress`
  and is persisted, because a party sent back in gets a fresh tent with every star dark.
- **Pillars** block light and movement. They are decoys.

Glass is furniture: every mirror and splitter tile is `blockTilePermanently`, because
the board was proven reachable with every pane solid. Splitters draw in the scene's
Y-sorted pass (`MirrorHall.sortedFigures`). While the hall is on stage, each lane's
teaching mirror pulses until its doorway opens, and then the hall's glass pulses until
the board is solved.

#### The teaching strip

`TEACHING_STRIP_BOARD` is an authored `MirrorBoard` under the same rule, so the one walk
decides it too. In each lane, a footlight lamp throws light at the crawler's own mirror,
which turns it onto a splitter. The splitter sends it on to a star in the curtain wall
and aside to a star in the lane's outer wall. One blow lights both stars, and another
puts them out. Lighting both of a lane's stars at once opens that lane's doorway into
the hall. That opening is latched per lane. The lamps are harmless: the strip has no
hot span.

#### The marquee

`hallMarquees.ts` places the marquees for both the maze, which draws them, and the
lighting, which pools under them. The hall's marquee (`hallMarqueePlacement`) hangs on
the wall one row above the gates, centred on the divider. It has one star-shaped bulb
per star in `marqueeStarOrder` (required stars first, the encore last). Each bulb is lit
**exactly while its star is lit**, and shows half for a twin with one light. When the
board solves, the rim chases and the board spells BRAVO for `BRAVO_SHOW_FRAMES`; the
bulbs then come back under a rim that keeps chasing while the board stays solved, so an
encore lit after the solve still shows on its bulb. Each teaching lane has a
two-bulb marquee beside its doorway (`teachingMarqueePlacement`), on whichever side is
clear of the hall's stars.

#### One trace

`traceBoard` is **the only function that decides where light goes**. The live beams,
the stars, the bulbs, the hot span (`boardHotSpan`), the turn preview
(`traceBoardAfterBlow`), the solver, the simulated players and the gate all call it. A
second walk would let the preview disagree with the blow. The light changes only when a
mirror turns, so `MirrorHall.refresh` re-walks both boards then and the frame only reads
the result. The hall's light is on only while its act is on stage and the tent is still
performing (`hallLightOn`). Before and after that, the stars read dark.

**Turn preview.** The acting crawler's nearest own mirror in reach shows its whole
board's light one blow on. Only the light the blow would **add** is dotted: light that
stays is already drawn solid, and the hot span is left out. A ring marks each star the
blow would newly light. Splitter branches are included. The preview answers "what does
this mirror do", never "where should the light go".

#### Board generation

`planBigTopMaze` deals the board when the tent is built, inside the door's loading fade.
Everything built from the plan needs the board first, and an attempt costs about a
millisecond. `generateBoardNow` runs the generation to completion. A sliced
`createBoardGeneration` also exists, doing half an attempt per `step()`.

- **Seed.** `mirrorBoardSeed(worldSeed, difficulty)`: floor 3's `GameMap.worldSeed`
  (passed into `BuildingInteriorScene`) mixed with the active difficulty. Each attempt
  has its own sub-seed (`attemptSeed`). Every draw comes from the generator's own
  xorshift stream (`seededStream`), never from `Math.random` or the world's stream. The
  same world on the same difficulty always deals the same board, including its scrambled
  start. A new world or another difficulty deals another board.
- **Constructive.** Random placement never yields a solvable board, so
  `buildBoardAttempt` builds each board backwards from its answer. It picks the geometry
  (lens rows, twin row, window rows spaced by `WINDOW_SPACING_MIN`, wall stars) and
  routes each light to its stars one straight run at a time, with at most the tier's
  `maxTurnsPerLeg` mirrors per leg. A light with two stars is routed to the twin, then
  split. New mirrors never sit on committed light. It then gives each pivot its four
  facings and each swivel its answer plus one other, and adds the tier's decoys and
  pillars. It places the encore, then scrambles every answer mirror off its answer. The
  route search has a hard node cap (`ROUTE_NODE_BUDGET`).
- **Acceptance contract.** `assessBoard` checks `CONTRACT_ROWS` in order. The generator
  stops at the first failure, and the gate assesses in full:

  | Row                    | Rule                                                                                                                                           |
  | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | `legible`              | no glass orthogonally touching glass, a star or a lens; no glass boxed into a lane corner; no star on a tile reserved above the teaching glass |
  | `fairHotSpan`          | `hotSpanProblems` is empty                                                                                                                     |
  | `notPreSolved`         | no star lit in the starting arrangement                                                                                                        |
  | `reachable`            | each crawler walks from entry to exit and to a floor tile beside every own mirror, with glass, pillars and the hot span solid                  |
  | `solvable`             | the solver finds an arrangement lighting every required star, within `SOLVER_NODE_BUDGET`                                                      |
  | `longEnough`           | fewest blows ≥ the tier's `minBlows`                                                                                                           |
  | `nearUnique`           | solving arrangements ÷ all arrangements ≤ the tier's `solvingShareMax`                                                                         |
  | `windowsLoadBearing`   | removing any one window makes the board unsolvable                                                                                             |
  | `splittersLoadBearing` | removing any one splitter makes the board unsolvable                                                                                           |
  | `encore`               | some arrangement lights the encore, and the constructed solution solves the board without lighting it                                          |
  | `needsThought`         | the "tune each mirror" player wins at most the tier's `tuneWinsAllowed` of `TUNE_PLAYER_RUNS` (20) seeded runs                                 |

  An exhausted solver search fails every row that leans on it rather than read as an
  answer. The solver is exact: every mirror cycles independently, so every arrangement
  is reachable, and fewest blows is the sum of each mirror's cyclic distance to its
  answer.

- **Fallback.** After `GENERATION_ATTEMPTS_MAX` (60) rejected attempts, the hall takes
  its tier's `MIRROR_BOARD_FALLBACKS` board. These were produced by the generator from
  `MIRROR_BOARD_FALLBACK_WORLD_SEED` and frozen as data. The cut-off counts attempts,
  never time, so a slow device deals the same board as a fast one.

#### Difficulty tiers

`MIRROR_BOARD_TIERS`, keyed by `MirrorBoardDifficulty` (the same union as `Difficulty`,
proved in the gate):

|                               | **Kitten** (`easy`) | **Crawler** (`normal`) | **Nightmare** (`hard`) |
| ----------------------------- | ------------------- | ---------------------- | ---------------------- |
| Required stars                | blue + red          | twin + blue            | twin + blue + red      |
| Splitters (follow from stars) | 0                   | 1 (blue)               | 2 (one per light)      |
| Windows (follow from stars)   | 2                   | 1                      | 2                      |
| `maxTurnsPerLeg`              | 3                   | 2                      | 3                      |
| `decoyMirrorsPerLane`         | 0                   | 1                      | 2                      |
| `pillars`                     | 0                   | 2                      | 3                      |
| `minBlows`                    | 4                   | 6                      | 10                     |
| `solvingShareMax`             | 0.02                | 0.005                  | 0.002                  |
| `tuneWinsAllowed` (of 20)     | 10                  | 0                      | 0                      |

Every tier also has the encore. A light needs a splitter for each second star, and a
window for each coloured star in the other lane.

#### Changing difficulty mid-show

The board's tier is fixed for the life of a `BigTopMazeSystem`: it holds its `plan`
and never reads the live difficulty. `src/core/difficultyChangeGuard.ts` holds one guard
at a time (`registerDifficultyChangeGuard` returns a handle, and
`clearDifficultyChangeGuard` with a stale handle is a no-op). `BigTopMazeSystem`
registers the guard last in its constructor (`holdDifficulty`). It releases the guard in
`dispose`, and when the last conversation with Grimaldi begins, because a restart then
would throw the finale away.

The Settings tab reads `activeDifficultyChangeGuard()` at click time, never when the tab
is built. While a guard is active, picking a different tier opens **Restart the
Big Top?** ("Keep playing", the primary action, or "Change and restart") instead of
applying it. Confirming hands the tier to the guard, which calls `settings.setDifficulty`
and restarts through `restartBigTopTent` (`src/systems/bigTop/bigTopTent.ts`). That
function deals the new plan, closes any open notice, disposes the old maze and its mobs,
rebuilds the map in place with `generateBigTopMaze`, raises a new maze and puts the party
back at the flaps in Act I. If the guard was released while the prompt was up, the pick
applies as an ordinary change. `settings.setDifficultyForSession` (dev presets) bypasses
the guard.

### Lighting

`src/systems/bigTop/bigTopLighting.ts`: the tent is dark and the act on stage is lit.

- **The mask** is painted once for the whole tent at quarter resolution
  (`BIG_TOP_MASK_SCALE`), with a padded border so a stretched blit never samples the
  edge. Each act has its own tint of dark (`ACT_DARK`), and every fixture cuts a soft
  pool (`POOL_SPECS`): footlights, arch posts, interval lamps, limelights, act boards,
  hall lamps, marquees and the ring wash. The limelights and marquees move with the
  dealt board, so `layoutLightFixtures(plan)` bakes from the plan, never from the fixed
  floor plan. `lighting.prewarm()` bakes it while the door loads.
- **The house board** lays a feathered translucent fill per band that is not on stage.
  The next act comes up over `LIGHTS_UP_FRAMES` (60) when its curtain rises. The act
  behind dims to `STRUCK_ACT_LEVEL` (0.4), and acts ahead stay dark. Once Grimaldi is
  freed, the house lights come up over 120 frames to 30% of the mask.
- **Live light** is additive: vent flare, lantern pools, the hall's light, lit stars,
  spill through an opened curtain, and the follow-spot on Grimaldi. The follow-spot
  cross-fades from sick green to warm white as the cure runs, through
  `FOLLOW_SPOT_TINT_STEPS` (12) baked glows.

**The fairness contract.** `BigTopMazeSystem.renderWorld` draws in one order:
`renderProps` (dressing, act boards, shut barriers, and the hall's limelight housings,
teaching lamps and windows via `MirrorHall.renderPieces`) → `renderLighting` (mask,
live light, follow-spot cones, reflections) → `renderTelegraphs`. The last draws the
ropes, vent grilles and their warnings, lantern rings and clear marks, opened ways, and
the hall's readouts (`MirrorHall.renderReadouts`: stars, marquees, coloured light and
the turn preview). The hot span's fire and the flares where light meets glass
(`MirrorHall.renderEffects`) draw over the crawlers, since a crawler stands in the span,
not behind it. Everything a player reads to stay alive or find the way is drawn
**above** the mask at full strength. Never move a warning or a hall readout into
`renderProps`.

### Props

The act props live in `src/sprites/art/bigTop/`:

- one module per act (`fireWalkProps`, `menagerieProps`, `mirrorHallProps`,
  `curtainProps`, `finaleProps`);
- the hall's puzzle pieces in `mirrorPuzzleProps` (splitters, windows, stars, the
  marquee, the coloured light and the teaching lamps) and its turn preview in
  `turnPreviewProps`;
- the shared hand in `bigTopPropKit.ts` and `stagePropKit.ts`;
- the shell in `bigTopShellArt.ts`.

Each is baked once per `(prop, state, frame)` into `bigTopPropCache.ts`. Frames bake at
device resolution, snapped to a step. The cache is capped at
`BIG_TOP_PROP_CACHE_BUDGET_BYTES` (6 MB) and evicts least-recently drawn. An animated
prop quantises its motion to at least four frames a cycle. `BigTopMazeSystem.dispose`
clears the cache and the reflection scratch when the party leaves. While either crawler
stands in an interval room, `queueNextActWarm` bakes the next act's props one
screen-sized window a frame, so the curtain does not hitch. The draws that change every
frame (fire, opened ways, act gates, lantern warnings, name chips) stay live in
`src/sprites/bigTopMazeProps.ts`. The hall's moving parts are drawn live over their
baked frames: a red beam's marching dashes, a blue beam's glints, a star's sparks, the
marquee chase and the turn preview's dots.

- **Ownership colours are load-bearing** for the two-crawler split. Donut's props are
  stage red and bone stripes with gilt trim and a gilt hoop. Carl's are ringmaster blue
  and brass on timber with brass strike chevrons. A player must name prop and owner from
  colour alone at 32 px under the stage lights. The owner's pulse and hit flash are live
  overlays over the cached frame.
- **Every hall colour has a shape twin**, so the puzzle reads in greyscale. Blue light
  is a solid band with a gilt spine and red light is dashes. Where both cross a tile,
  each is drawn whole. The blue star carries brass chevrons, the red star bone stripes,
  the twin is split down the middle, and the encore is spotted gold. Splitter branches
  draw at full strength.
- **Reflections:** crawlers within `REFLECTION_RANGE_TILES` of a mirror-hall pane appear
  in it. They are drawn over the dark, since a reflection is as bright as the crawler.

### Sound

Every Big Top play site raises a cue from `src/systems/bigTop/bigTopSoundCues.ts`
(`BIG_TOP_CUES`, `BIG_TOP_BLOCK_CLEARED_CUES`), never a raw id. A cue is a list of takes
rotated by the system's cue queue. Until each recording lands, a cue either borrows a
stand-in or is an empty list, which is silent.
Each cue's JSDoc names the file it waits for. To swap one in:

1. Register the id in `src/audio/sounds.ts`.
2. Add it to the `circusQuest` group in `src/audio/sfxGroups.ts`. `AudioManager.play` is
   silent on an unpreloaded buffer, and `verify:bigtop` fails on any cue id missing from
   the group.
3. Replace the cue's list.

The hall raises `mirrorTurn` per blow, and each settle of the light raises at most one
of each: `starLights`, `starWrongFizzle` (which takes precedence over `starDims`), and
on a solve `starLatch`, `marqueeChase` and `starOpensWay` (`BigTopMazeSystem.answerHall`).
`starLights`, `starDims`, `starWrongFizzle` and `marqueeChase` are silent until their
recordings land.

The ambience bed goes in `STREAMING_SOUND_IDS` and `BIG_TOP_AMBIENT_BED`, which is
`null` until it lands.

### Gates

Each negative test (`--fault=`) must turn its own check red, and every fault asserts
that it was actually applied, so a fault that silently misses cannot pass as green.

- `npm run verify:mirror-board`: the board-level checks (`scripts/bigTopMirrorBoardChecks.ts`),
  pure and fast. They cover the board's frame in the tent, the light walk against brute
  force, every fallback against its tier's full contract, and a 500-attempt sweep per
  tier (`SWEEP_ATTEMPTS`, `--attempts=` to change it). A tier fails below a 10% pass
  rate (`SWEEP_PASS_RATE_MIN`). The tiers must stay ordered: Kitten boards have no twin
  and no splitter, every Crawler and Nightmare board has both, and Nightmare's median
  fewest blows and median touched glass are above Crawler's. Determinism is checked too:
  the same world and difficulty give the same board byte for byte, and two difficulties
  give different ones. Faults:
  - `drop-solution-mirror` turns `solvable` red;
  - `current-hall` (a hall of three independently latched stars, each judged on its own)
    turns `needsThought` and `nearUnique` red;
  - `decorative-window` turns `windowsLoadBearing` red;
  - `hot-span-blocks-glass` turns `reachable` red;
  - `misplaced-limelight` turns `fairHotSpan` red;
  - `star-over-teaching-glass` turns `legible` red;
  - `kitten-twin` turns the tier ordering red.
- `npm run verify:bigtop`: timing feasibility at `MAZE_TIMING_MARGIN`, bell solvability,
  resets, the door gate, and more. It runs the board-level checks too. On the live hall
  it:
  - lights the teaching strip through real blows;
  - solves the dealt board through the real hit path (`MazeMirrorTarget`), asserting it
    solves on the final blow and not before, that all four exits open, that later blows
    never shut one, that the bulbs track the stars, and that an act reset after the
    solve keeps every mirror and the latch;
  - holds rather than latches (`--fault=latch-stars`);
  - walks the hall on the live `GameMap`, where barriers are runtime block flags;
  - checks every turn preview against the blow that follows it;
  - checks the encore pays once and is not needed for the exits;
  - checks that a difficulty change mid-show is held behind the prompt and restarts
    the tent at Act I on the new board (`--fault=unguarded-difficulty`).

  On the art side it checks that no dressing hangs over walkable ground, that every
  drape matches the act of the floor it faces, that floor marks sit on walkable ground,
  the density rule, and that every cue is audible.

- `npm run verify:difficulty-guard` drives the real pause menu's Settings tab. It checks
  that an unguarded pick applies at once, that a guarded pick raises the prompt, that
  Keep playing and closing the menu both cancel, that Change and restart hands the tier
  to the guard, and that `setDifficultyForSession` is not held. Its fault is
  `--fault=unguarded-difficulty`.
- `npm run gates:bigtop-art` measures the real tent through `bigTopInteriorHarness`:
  - **Hazards:** every forced hazard state (including the hall's `beam-hot`) keeps its
    full-bright contrast and salience, and its own pixels keep at least 0.85 of their
    full-bright colour (0.7 for a hazard over its own pool). That is the fidelity
    measure.
  - **Floor and mass:** the stage floor stays above a luminance floor, and the mass
    stays darker and calmer than the floor.
  - **The show:** the lights follow the show.
  - **Budgets:** `drawImage` count, lighting memory and node pass time.
  - **Act props:** every catalogued frame (the hall's catalogues included), painted at
    both scales on a strict canvas, stays inside its box. The frames the acts draw,
    including a solved hall's marquee through its chase, fit the cache without
    evicting.

  `--fault=dark-telegraph` draws the lights over the warnings and must turn every hazard
  state red. `--fault=ink-overrun` must turn the act-prop section red. Browser cost is
  the `lighting` row of `?perf`.

- `npm run render:bigtop-interior` renders one frame per act, a curtain room and every
  forced hazard state, at 32 and 64 px, into `preview/bigtop-interior/<label>/` with
  `fairness.json`. It also renders the dealt hall for five worlds across the tiers,
  unsolved and solved. `--lighting=lit|fullBright|darkTelegraph`, `--only=`,
  `--label=`.
- `npm run render:bigtop` renders the prop contact sheet and smoke-runs every maze draw
  function. It also writes a puzzle-piece sheet in colour and in greyscale
  (`bigtop-mirror-puzzle-*.png`), where the shape twin of every colour cue is checked
  by eye.

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

Review harnesses for the town's art, each writing into `preview/`:

- `npm run render:town-interiors -- --only=<name> --probes` renders every room, with Carl
  standing at a counter, a table and the door for scale.
- `npm run render:buildings -- --only=<id>` renders the facades.
- `npm run render:residents`, `render:human-cast` and `render:skyfowl-cast` render the
  cast.
- `npm run render:cast-motion` renders gait and dance; its gates are
  `npm run gates:cast-motion`.
- `npm run verify:plaza-perf` measures the plaza crowd's cache behaviour. It is headless
  and wall-clock sensitive, so run it on an idle machine.

`townMetrics.ts` computes the numbers without a canvas, so
`generateOverworld` + `collectBuildingPlots` + `measureTown` run headlessly under
`npx tsx` — the fastest way to tell whether a layout change moved anything.

Current measurements: 55 × 41 bounding box, 2255 tiles, 33.9% built density, 6 ground
materials in use, 30 distinct outdoor prop types, 40-tile safe radius, 8.3 ms mean frame
time in the plaza. The tower is counted by its base rather than its art — 21 of the
spire's 23 rows overhang the fields north of the wall, and counting them would report a
55 × 40 town as 61 tall.
