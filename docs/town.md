# The Overworld Town

How the third floor's town, **Taloncrest**, is generated, rendered and tuned. This is reference for
anyone changing the town's layout, ground, props or the systems anchored to it.

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
4. **Ids are load-bearing, names are not.** See [Building ids](#building-ids) and [Invariants](#invariants).

The wall itself is drawn procedurally by `drawTownWallTile` (`src/map/tiles/buildingTiles.ts`):
coursed ashlar, with a crenellated parapet on any run's exposed north face, phased off the
tile's world-pixel column so the battlement runs continuous across tile boundaries.
Its ground is baked into the chunk cache; the stone stands in the Y-sorted pass and
sorts on the tile's south edge, so it covers the lower body of anyone standing north of
it. Yard fences (`FENCE`) and the ruins' `RUINED_WALL` are split the same way.

### Districts

| District          | Where          | Buildings                                                                                                                                                    |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Civic Terrace** | north edge     | Town Center Tower (set into the north wall, so its spire overhangs the fields)                                                                               |
| **Garrison Row**  | north band     | The Barracks (the garrison), Cartwright's Workshop, Plumbline Farm (Wendell's home), Blackwood Lodge (dead-end alley — the garrison's watch post)            |
| **Market Plaza**  | centre         | — fountain, stalls, notice board, fortune teller, benches, well                                                                                              |
| **Plaza Ring**    | flanking plaza | Temple of the Sky, Herb & Remedy, General Store, The Sleeping Cat Inn (the town's safe room)                                                                 |
| **Market Row**    | south of plaza | Old Lori's Cottage, The Horned Flagon, The Rusty Anvil                                                                                                       |
| **Low Quarter**   | south band     | The Cloak & Dagger, The Quiet Needle (Shady loiters on Low Street outside it), The Sunken Stump Pub — plus the two lamp-lit service alleys through the block |
| **South Green**   | inside SE wall | Miller's Farm                                                                                                                                                |
| **The Ruins**     | outside walls  | ruin shells, rubble, ghouls; the circus 70–90 tiles out                                                                                                      |

### Building ids

Every building is keyed by a `BuildingId` (`src/map/buildingIds.ts`), never by the name
on its sign. An id is `<location>_<slug>`: the location is a `TownId` (`taloncrest`,
`briar_hollow`) or the `LevelId` of the dungeon floor the door stands on (`level2`), and
the slug says what the building is, never who runs it, so a repainted sign or a renamed
character leaves it alone (`taloncrest_old_lady_cottage`, not Lori's;
`taloncrest_crafting_house`, not Cartwright's; `briar_hollow_seamstress_cottage`, not
Nella's). The Starlight Tent is `taloncrest_circus_tent`, the tower `taloncrest_tower`
(`TOWN_TOWER_ID`), and floor 2's prison `level2_goblin_prison`. The id union is built from
the per-location slug lists, so a new building is a new slug and a new town is a new key;
one location's ids have their own union (`BriarHollowBuildingId`). Shop and service-counter ids follow the same rule
(`crafting_house`, `mill_farm`, `mill_kitchen`, `hayloft`), and a shop that is its
building's own counter is titled through its `building`, never a restated name.

Every building-keyed table (layouts, shells, occupants, services, readables, music, decor
anchors, contract sites), every saved key and every dev route uses the id. The sign's text
is `buildingDisplayName(id)`, read only where the player sees it: the street label, the
door prompt, the room banner, the loading screen, readable titles and contract text. A
stored id is narrowed with `isBuildingId`; a save holding anything else fails validation
and is discarded. Briar Hollow's buildings are drawn roofless in the village rather than
entered through `buildingEntries`, but share the one id union and display-name table.

---

## Who lives here

The town is a Hawkfolk city with a human minority.

**Species is not a job.** `TownSpecies` (`src/systems/townSpecies.ts`: human, Hawkfolk,
dwarf, otter, crocodilian, orc, elf) is its own axis, carried by `ResidentDef.species`,
`OccupantSpec.species` and every `Townsperson`. It is what a person is, not what they are
drawn as: only a `CrowdSpecies` (human, Hawkfolk) has an authored citizen cast, so only
those are rolled into the crowd or wear a cast look; anyone else is drawn by a bespoke
painter, and `TownspersonFigureOptions`, `OccupantIdentity` and `RESIDENT_LOOKS` refuse to
compile one without it. Orcs have no crowd cast: Baggi is the town's only orc, and she is
drawn on her own figure. Elves have none either: the cellar elf is the only one living
inside the wall, drawn on the cult's elf figure (`drawElfSprite`). Each species has its own danger barks (`DANGER_LINES` in
`src/dialog/scripts/townsfolk.ts`), and `AMBIENT_VOICE_OF` names the ambient pool its
unnamed citizens talk from. `TownRole` is only ever a job: it picks barks and a citizen's look,
and a species in the role union would bark as a job. A counter belongs to the person who
keeps it (`OccupantSpec.service`), so neither species nor role touches it.

**The named cast** is `RESIDENT_DEFS` in `src/systems/townResidents.ts`: twenty-two residents,
nine Hawkfolk, six humans, a dwarf, an otter, three crocodilians, an orc and an elf. The humans are Wendell
(Plumbline Farm), Marta Miller, Apothecary Fen, Innkeep Marlow, Wick, the General Store's
clerk, and Brandon at the Cloak & Dagger's front desk. Old Lori (a dwarf), Steve Cartwright
(an otter), the pub janitors Puddles and Grout and Sydney at the Barracks Mercenaries' desk
(crocodilians), Baggi (an orc, Apothecary Fen's assistant at Herb & Remedy,
`taloncrest_apothecary_assistant`), the cellar elf (`taloncrest_lodge_cellar_elf`, at
Blackwood Lodge once its cellar has held) and Brandon are drawn by bespoke painters. Every
resident's figure is their entry in `RESIDENT_LOOKS` (`src/creatures/residentFigures.ts`): a look from their own
species' cast, which the compiler checks against their `ResidentDef`, or a bespoke painter. Each building a resident lives in
names its keeper in `BUILDING_KEEPERS`, which the compiler holds to one entry per such
building and to someone who lives there. Keeper Brenna
Kestrel runs the General Store: she is the counter occupant `ShopSystem.setKeeper` points
the shop at. The club's counter staff (the bartender, the vendor, Deuce and Donald) belong
to `CloakAndDaggerSystem`, and Dave to `DaveGuideSystem` (stood in the room by
`SafeRoomSystem`); both sit outside the ratio.

**The crowd.** `TownLifeSystem` rolls each street cohort's species at its own share:
`PLAZA_HAWKFOLK_SHARE` and `ANCHOR_HAWKFOLK_SHARE` two thirds, `TRAVELER_HAWKFOLK_SHARE` one
half (the roads bring outsiders in). A door's loiterers lean toward its keeper's species
(`FRONTAGE_HAWKFOLK_SHARE_BY_KEEPER`): a Hawkfolk keeper's door rolls three quarters
Hawkfolk, and every keeper without wings (human, dwarf, otter or crocodilian) leans it the
groundfolk way, one quarter Hawkfolk. A building with no keeper rolls at the plaza's ratio,
and each doorstep anchor's species is fixed with its post
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
  Adults are painted on the biped rig (`src/sprites/art/biped/`), each dressed and groomed
  as itself plus a role accessory. The two child looks use the person skeleton, because
  the biped rig is one fixed adult build.
- **Hawkfolk:** `src/sprites/art/hawkfolk/` and `hawkfolkCastFigure.ts`.
- **Named residents:** each wears a fixed look from `src/creatures/residentFigures.ts`,
  which throws on a resident with no entry.

The twelve fightable `Hawkfolk` mobs (`extraSpawns` in `level3.ts`) are combat creatures,
not citizens. They wear the four street-tough looks: rust and plum leathers and a hunched
posture that no citizen wears, so a player never mistakes a citizen for a target. A
citizen is never a `Mob`, and `npm run verify:citizens-not-targetable` fails any
target-picking system that mentions `Townsperson`.

### Wendell, Plumbline Farm and Garrison Green

Wendell trained as an architect, never found work as one, spent years building houses,
and then tried farming; every cow he owned died. He keeps Fenna's blueprints, and
Briar Hollow's side quest "The Borrowed Blueprints" runs through his house and his
pasture (see [The Borrowed Blueprints](#the-borrowed-blueprints)).

**His look** is `resident_wendell` in `src/sprites/person/townCastLooks.ts`, on the biped rig:
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
buildings each own one spec and two sheets: the still `idle` frame under the building's
sprite key, and its `life` animation as a sheet of its own, `<key>_life`, composited over
`idle` by the `SPRITE_BUILDING` path at 8 fps. The tower
(`overworld_main_tower`) is the exception: it is still authored art and still ships
as a file. `npm run gen:buildings` bakes review copies of the same art into
`preview/`; nothing offline writes into `src/images/`.

A facade is the most expensive picture the game makes, so it is painted in stages
across frames rather than in one step. Each building's sheets are a resident set held
by distance from the party: the still frame is asked for, nearest first, about two
seconds of fastest walk before the building comes into view and let go once the party
is well past it, and the life row is held only while the building is in view. See
`docs/asset-management.md` ("Memory follows the party within a floor") for that machinery
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
- **A crawler may stand behind the roof.** The top rows of a facade's footprint are
  roof the 3/4 view lifts into the air, so `SpriteLoader` leaves up to
  `ROOF_WALK_BEHIND_ROWS` (2) of them walkable, never reaching the wall band its
  `blockedRegions` start. The Y-sort draws a crawler there under the roof. On most
  facades the human's head clears the ridge, but the Cloak & Dagger's ridge sits
  about 1.2 rows down and the cat is about 0.6 tiles tall, so the roof can hide a
  crawler whole; `drawCrawlersBehindRoofs` (`src/systems/occludedCrawlers.ts`)
  redraws any crawler on a walk-behind tile faintly over the roof. The anchor tile
  is the frame's top-left, so it is walkable too (`isSpriteAnchorWalkable`).
  Citizens are kept out of those rows (`TownLifeSystem.isCitizenGround`), and
  runtime street clutter (market stalls, `TownPropSystem`, `TownDecorSystem`) is
  placed only on `GameMap.isOpenStreetGround`: anything standing there would be
  hidden under the roof.
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

Thirty materials ship across five sheets, listed in
`src/map/tilegen/sheetConfigs.ts`: the overworld's ten (grass through scree), the two
dungeon floors' five each, the safe room's two, and eight for the town's building
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

- **The Quest Journal** (`src/ui/screens/pause/journalSection.ts`) — a pause-screen page, reached from
  the compass button under the achievement chip, from the `toggleQuestTracker` binding, or
  from the pause screen's menu. It lists whatever the floor's quest systems say is outstanding: an
  objective line, a hint, a compass chevron and a tile distance per row, and clicking one
  pins it — which puts a world arrow over the player and an extra marker on the minimap.
  It lives behind a pause rather than on the HUD because it has to be able to show
  _everything_: a corner panel had to cap its rows and squeeze its text, and a "+N more"
  line the player cannot open is worse than a menu they have to press a button for. Only
  floors from `OVERWORLD_FLOOR_THREE` up offer it (outside the tutorial), which is where more than one thread runs
  at once.
- **The tracker seam** (`src/systems/questTracker.ts`) — every quest system grows a
  `trackerEntries()` getter beside its existing `questMarkers` one, rebuilt from its own
  phase machine each frame. Deliberately _not_ a global `QuestManager`: two of the five
  questlines do not use one at all.
- **Quest beacons** (`src/sprites/questBeacon.ts`) — a column of light over anyone
  wearing a `!`/`?`, drawn by the creature before its own body paint so it Y-sorts with
  the figure. Gated on the exact state that drives the glyph, so the two cannot disagree.
- **The quest route** (`src/systems/questRoute/`) — the pinned arrow's bearing and a
  dotted ground trail. `QuestRouteGuide` keeps one Dijkstra field (`routeField.ts`) out
  from the pinned target's goal tiles, built `QUEST_ROUTE_EXPANSIONS_PER_FRAME` tiles a
  tick into a spare buffer and rebuilt on a new target, a new map, a blocked route and
  every `QUEST_ROUTE_REFRESH_FRAMES`. Each tile the player steps onto, it walks downhill:
  the first town or palisade gate on the way (`routePortals.ts`) is where the arrow
  points, otherwise the target itself; with no route yet it points straight. Roads are
  cheap, open ground twice as dear, wading dearer still; stairwells and other buildings'
  doorways are never stepped on. Whether the arrow shows is still decided by the
  target (`OBJECTIVE_ARROW_SUPPRESS_TILES`, `hidesArrowOnScreen`). The trail is the first
  `QUEST_TRAIL_MAX_TILES` of the route cut into straight runs and painted by `worldTrail`,
  and the `questRouteTrail` setting turns it off. A target flagged `drawsOwnRoute` (the
  Midge escort's waypoints) gets neither. Indoors the same guide routes to the exit, or to
  a tower storey's stairs down, while the pin is somewhere else (`PINNED_EXIT`); a pin on
  the building the party is in shows nothing.

`npm run verify:town` is the gate for the door and gate geometry these rely on, and for
the route guide's first aim from the plaza and from outside Briar Hollow.

---

## Interiors

A door on the street opens a `BuildingInteriorScene` over a room built by
`GameMap.generateInterior(kind, floor, buildingId, hasSafeRoom)`. The room is regenerated on
every entry, so it keeps no state of its own; anything a room must remember lives in
`TownMemory` (see [Remembered between visits](#remembered-between-visits)). A room's
contents are data: one layout file per building in `src/map/town/interiors/`, listed in
`INTERIOR_LAYOUTS_BY_BUILDING` (`index.ts`), each a pure function of the shell's size that
returns layout entries. `generateInterior` holds no per-building logic.

Only the Cloak & Dagger's rooms and stations are fixed. Every other
room's shell and layout may change freely, as long as its function holds: quest beats,
services, the safe room and the gates below. A room's layout follows from what the building
is, and every room should look occupied. Four things about the shell are worth knowing before changing one.

**The shell is per building, not per kind.** `INTERIOR_BY_BUILDING` in `GameMap.ts` states
each building's width, height and floor material, and `INTERIOR_BY_KIND` is only the
fallback for anything absent from it. A kind is a category, and a category cannot say how
big a mead hall is or what a garrison's drill floor is made of. Four interior floor
materials ride the `ground_interior` sheet alongside the boards and stone —
rushes, packed earth, flagstone and ink-blotched boards — and new materials are
**appended** to that sheet's list, never inserted: a material's noise seed is its index,
so inserting one re-rolls the art of every material after it.

**Every walkable tile must be reachable from `startTile`.** A partition wall that seals a
wing produces no error, no log and no symptom except a room the player can see across and
never enter. `verify:interiors` flood-fills every interior — all fifteen walk-ins, the Starlight
Tent, all six tower storeys in every state the questline leaves them in, and the sewer's
sections — and it excuses none.

**The safe room is the inn's taproom.** `hasSafeRoom` on the planned building is what
puts Dave, the doctor's corner and the lantern light in a room, and the bounds it
uses are name-addressable, so the inn registers the taproom band rather than its whole
floor. `planSafeRoomClinics` lays the doctor's medicine cabinet against the **north wall
of those bounds**, on a span free of doorways and furniture — which is why the taproom's
archways to the landing are deliberately off-centre. A cabinet laid across an archway
would wall off the entire guest wing.

**Dave teleports into the taproom.** He is not a resident and never stands in an empty
inn: the building's `DaveGuideSystem` brings him in `DAVE_ARRIVAL_DELAY_FRAMES` after the
party walks in, on the arrival tile `SafeRoomSystem.guidePlacement` gives him, unless the
run left him there (`DaveWhereabouts`, threaded between the dungeon and the interior by
`InteriorPartyRun`). On arrival the inn's `StoryDelivery` plays a floor-3 safe-room beat if
one is due, as a walk-up cutscene, then Caroline's intel for the current objective. Her
bearings, and Dave's tactics, are about the floor outside, measured from the building's
door. Caroline speaks only while nothing hostile is fighting the party and no box is open
(`carolineMaySpeak`). With nothing due he wanders the taproom and wears his `!` until he
has given his tactics for the current objective. `docs/world-and-story.md` is the
reference for the beats and both voices.

**A building may run more than one counter.** A service is declared on the occupant who
keeps it (`OccupantSpec.service` in `BUILDING_OCCUPANTS`, `src/systems/buildingOccupants.ts`),
and the talk router asks `InteriorOccupantSystem.serviceOf` for the service of the exact
person the player walked up to, so any number of counters may stand in one room whatever
roles their keepers hold. A priced counter names its menu (`ServiceCounter`), which
`openServiceMenu` switches on exhaustively. A desk with a screen of its own names its
desk instead (`ServiceDesk`, `{ surface: 'desk' }`), and the scene builds the system behind
it only in a room whose roster keeps one (`interiorKeepsDesk`), so no system names the
building it lives in. The Barracks runs three: a quartermaster's armoury, a drill yard
selling permanent stat points up to `DRILL_TRAINING_CAP` at an escalating price, and The
Barracks Mercenaries' hire desk (`MercenaryGuildSystem`), kept by Sydney at the `merc_desk`
in the east of the muster hall, clear of the cracked flags the `muster_floor` contract
marks. A contract signed there stands the hire up in the room at once:
`BuildingInteriorScene` follows the roster's live contract. The inn's three
guest rooms are the timed counterpart — a full mend plus one time-bounded stat boon, and
granting one cures the other two so the choice stays a choice. Occupants carry a `post`
hint that decides which piece of their anchor group they take; without one they are placed
in raw scan order, which is row-major from the north-west and put every shopkeeper in town
in the same corner.

**The tower is laid out per storey.** Its six storeys, bottom up, are the `TowerStoreyId`
union in `src/map/town/interiors/townCenterTower.ts`; a storey's index is its place in that
list, and its label, plan, furnisher and reserved zones are tables keyed by it, so a storey
cannot ship without any of them.

| #   | Storey      | What stands there                                                                                                                                                                                                                                                                      |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | cistern     | Sewer brick and water, entered up the sewer's cistern culvert (at `TOWER_CISTERN_ARRIVAL_TILE`) and left back down it from the culvert in its west wall. The ward conduit runs from its sluice in the north wall to the drain; the basin is deep; the overflow is ankle deep.          |
| 1   | gatehouse   | The guard hall behind the front door (`TOWER_ENTRANCE_STOREY`), the only storey with a door. The cellar stair down, the stair up in the south-east, and the tower guards' watch.                                                                                                       |
| 2   | kitchen     | Hearth, worktable, the walled larder in the south-east behind a locked door, the portcullis chain on the larder's east wall, the dumbwaiter's foot and bell on the west wall, and the stair up under a portcullis.                                                                     |
| 3   | bell storey | The open shaft the two bells hang in across the middle, three cat beams over it, the ringers' walk down the east wall barred by a grate, and south of the shaft the counterweight between its two plates.                                                                              |
| 4   | archive     | Two rooms either side of a filing wall joined by a doorway at each end, ward lines across both doorways and across the west room, a hole through the west room's boards, shelf tops (cat ledges) with things to knock off, and the dumbwaiter's upper hatch and bell on the east wall. |
| 5   | cattery     | Cages down both side walls, the ritual circle under the observatory window, the binding pillars round it. The Warden's arena.                                                                                                                                                          |

Each storey is a plan of rows (walls, floor, stairs, door, water) plus furniture placed by
code; `GameMap.generateTowerStorey` builds it before laying the stairs, so each stair block
records its storey's own floor. A storey's stairs can stand anywhere on its plan: the party
always arrives on the landing below the stair it came by. Every storey keeps its stair blocks
and the two landing rows below each clear, joins both stairs to every walkable tile, and keeps
each of its `TOWER_MECHANIC_ZONES` open floor with nothing standing in it: that is where the
cats' ledges, plates, bells, dumbwaiter and wards stand beside. Plans write a cat ledge
(`CAT_LEDGE`) as `L` and a hole through the floor (`FLOOR_DROP`) as `_`: nobody stands on a
drop, but a thing knocked off flies across one, and the tiles a toppled board lies across become
`FLOOR_DROP_SPANNED`: still painted as the hole, with the board drawn over them, but stood on
like floor.

**Storeys are built from the quest.** The tower interior builds every storey at the door, as
`towerConditionsFor(progress)` says the questline leaves it: the conduit running or shut, the
portcullis down or raised, the larder locked or open, the archive's wards solid, pulsing,
sweeping or spent, its hole open or bridged and its key ring on the shelf or gone, which cages
stand open, which cats are bound and whether the ritual is lit. A storey is never changed
across phases on a built map; the next entry builds it again. Two things change while the
party is in the room, as a valve does in the sewer: winding the sluice shut repaints it, runs
the conduit down to wading depth and sets the quest's `conduitShut`. Each storey also names
the dungeon theme it is drawn under (the cistern the sewer's, the rest the default), and the
scene sets it as the storey comes on show, so no storey is drawn in the materials of the one
before.

**The gatehouse watch** (`src/systems/tower/`) reuses the prison's stealth whole: guard
scripts in the prison's language compiled by `compileStealthFloor`, cones cast against a grid
read from the storey's own layout (walls are walls, every blocking prop is cover), suspicion,
touch, and `respondToNoise` for a guard struck unseen. The guards (`TowerGuard`, a reserved
human cast look in the tower's livery) carry no light and look from just ahead of their
faces. Their tuning is `GATEHOUSE_TUNING`, in the prison's shape. Being caught does no harm:
the screen goes dark and the party is set down on the cellar stair's landing.
`npm run verify:prison-stealth` proves the gatehouse can be crossed unseen at every
difficulty and that the straight walk is caught from normal up. Only the crawlers are watched
for; a hire is never what a guard is looking for.

**The storeys' works** (`src/systems/tower/*Works.ts`, one object per storey, ticked and drawn
only while its storey is on show by the tower's encounter). The tower's encounter keeps the
room's own fittings (`keepsRoomFittings`), so every storey's furniture can still be read,
searched, broken and knocked off; each storey has its own readables, prop interactions and
breakables. Every lasting outcome is written to the questline's progress as it happens, and
the next build of any storey reads it: plates, knock-offs and ward states that are not written
there start again on the next visit, and are always there to be done again. Each step a
chapter hangs on is raised as a `towerMoment` on the scene's bus (`towerMoments.ts`).

- **Cattery** (before the Warden knows). Every shut cage opens by a timing interaction: the
  cat jostles its latch, and a jostle counts only while the keeper, a krasue, has its back
  turned. Its round reads three ways: where it floats (among the cages, or up by the window),
  which way its look washes the floor, and the latch bar's colour. A jostle under its eye is
  seen; it shrieks and stares on a while. Its look is a fan cast against the room's tall
  things (`catteryKeeper.ts`): Belle out of her cage and in it long enough is caught, and
  wakes shut in her own cage with its latch to work again; inside her own cage, open or shut,
  she is never caught. Heaps of feed sacks and casks
  stand on the floor while the keeper is on watch (`keeper` in `TowerConditions`) so she has
  shadows to wait in; they are gone before the Warden's fight. Belle wakes in her cage to a
  talk with Pumpkin in the next one (`cellmateMet`), and is held in it until her
  own latch gives (`crawlerCatUncaged`). A freed town cat joins `catsFreed` and bolts for the
  stair; the freed cellmate (`cellmateFreed`) comes out as the scene's `CatAllySystem` and joins
  Belle's group. The cage is the placed prop; a caged cat is drawn sitting inside it.
- **Archive.** Ward lines go into the storey's `SenseLayer`. Solid wards bar their tiles.
  Pulsing (once the conduit is shut): the doorway ward bites on a rhythm the cat can read, the
  west ward goes out for good the first time its plate is weighed down (nothing past it can
  reach the plate, so it never lights again behind a cat), the north door's stays solid.
  Sweeping (once the Warden knows): each ward sweeps a band, fed by a ward stone; the cat
  standing by a stone finds it (a paw badge marks it), and only the human can break a found
  stone. A bite does a little damage and puts the crawler back on its last clear tile. The
  shelf tops hold a heavy jar over the ward plate (`pressPlate`) and the archivist's key ring
  over the hatch (`deliver`, which sets `keyRingSent`), both batted off and lobbed; beside the
  hole stands a long shelf board that is pushed over instead (`ToppledKnockOff`): it falls
  along its placement's `toward`, which its painter is handed too, and every hole tile it comes
  to lie across becomes `FLOOR_DROP_SPANNED`, crossable on the board and only there. Before the
  Warden knows, krasue wardens drift on rounds and do not fight; one that sees a crawler at all
  (an `on_sight` notice) has the party caught at a glance and set down at the cattery stair's
  landing, and one that sees a companion only goes on orange alert. The warden is the archive's keeper and the dumbwaiter's bell calls it: rung from
  the archive, it turns to the sound, leaves its room by the south doorway
  (`ARCHIVE_WARDEN_BELL_PATH`), peers into the hatch with its back to the room for a while,
  then drifts back. That is the room's way through: ring, keep clear, slip through the
  doorway while it peers, bat the board across the hole, bat the jar onto the plate, take the
  stair. Each thing that can be worked wears the same quiet tell (`interestGlint.ts`): a
  sheen on what can be batted or rung, a pool of light on the plate. Once it knows, krasue rise
  to fight.
- **Kitchen.** The human's chapter is one value, `MissingCatsProgress.kitchen`
  (`KitchenStage`): take the key ring from the dumbwaiter's foot, unlock the larder with it,
  ring the dumbwaiter's bell, take the paw-printed note that comes down, buy tuna at the
  General Store, send it up, where Pumpkin eats it as it arrives (`ClaimedItemEnd.sendTaken`),
  so nothing is left at the archive's hatch. The tin may be in either bag of a crawler in the
  kitchen; one in the bag of a crawler away upstairs does not count, for the hatch or the
  Journal alike (`tunaHolder`). The dumbwaiter accepts nothing sent from a bag at its
  unclaimed head, so no tin can come down to strand at the claimed foot. `KitchenWorks` claims the dumbwaiter's foot and bell pull from the
  room's conveyors (`ConveyorSystem.claimItemEnd` / `claimSignalEnd`) and offers a deed only at
  the step in hand, one step per deed; a press out of turn says what comes first. Where the key
  ring and note are follows the stage: each arrival and each step puts them in the hatch, the
  human's bag or nowhere, as the stage says. The Journal (`kitchenStep` in
  `kitchenSequence.ts`) points at the same fitting the deed is offered at, and the human says
  what he does next at every step. The larder is locked until the key ring and never relocks.
  The portcullis chain will not give until the counterweight has fallen. When it falls the
  kitchen's portcullis rises at once, even on a storey built shut.
- **Bell storey.** The bells swing together, a full swing every two bars of the tower's music
  (96 BPM in 4/4: `TOWER_SPLIT_BEAT_S` and `TOWER_SPLIT_BAR_S`, beside the `tower_split` stem
  set), on the playing stem's clock when one plays and the same tempo on the storey's own clock
  when none does. Each bell rings live as it reaches a beam on a bar's downbeat. A bell crossing
  a beam sweeps whoever stands on its span to the beam's nearer end; the strike is warned in red
  for two beats first (`drawDangerRegion`). The counterweight is a latching plate set over two
  plates; the cellmate holds whichever one Belle is not on, but only once she has been fed. Its
  fall hauls the ringers' grate clear and sets `portcullisRaised`; a storey built after that is
  built with the weight down (`PressurePlateSystem.settleOpen`).

**The door.** Two tower guards stand either side of the tower's door for the whole floor
(`TownPlan.towerGuardPosts`, kept off the door's approach, the storm-drain grate, the torches
and every doorway). They cannot be fought and never leave. The front door never opens
(`towerDoorRefusal`); a guard turns the party away in a line or two, and once the Warden is
gone the answer is that the tower is closed by order, though nobody can say whose. A party
inside can still walk out of it: while the door is barred, the human coming out past the
guards is stopped once each time (`TOWER_DOOR_WALK_OUT`), asked how he got in, and talks his
way past with a tale about an extra order of tuna.

**The top storey is the Lich's arena.** The Lich anchors at the north wall and sweeps the
room south with walls of fire, each wave born on the first row from which every column runs
clear to the south wall. So everything that blocks there is a cage against a side wall, the
hearth against the north wall, or a binding pillar in the top three rows at the Lich's end:
two beside the observatory window and the rest flanking the ritual circle's north edge, none
touching another, so each has open floor to be worked from. The pillars level with the
circle's top row start the waves one row below it, which leaves ten rows of travel to the
south wall, deep enough for two walls to be in flight at once. Pillars any lower push the
waves' first row south until only one wall is ever live. The floor from that row to the south
wall is open, and a prop placed in it leaves a wave nobody can pass. The pillars stand there for every
state of the quest, lit or dark, so the room the waves are planned across never changes. The
Lich is the Warden, the tower's master, and keeps its grinning mask.

**The Warden's ritual** (`TowerRitualSystem`, `src/systems/tower/`, one per tower visit,
answering for the cattery through `TowerStoreysSystem`). The last flight from the archive asks
whether the party is ready (`TowerStairSystem`'s finale panel) while the questline is at
`ascent` or `ritual`. The first time the party comes up together the Warden waits masked in
the lit circle, the questline moves to `ritual`, and the Warden says what the circle is for: it
did not cause the Fraying, it means to pull the old city and everyone it lost back through the
seam, and nine creatures that always come back hold the seam open. It lifts the mask, there is
nothing under it, and the fight starts (`wardenReveal`, `src/dialog/scripts/scenes/towerRitual.ts`).
A party turned out by the fight finds the Warden waiting again and fights without the reveal.
The fight is `LichBattleSystem` with its rules in `lichBattleRules`:

- **The binding.** Every town cat nobody let out of its cage is bound to its pillar
  (`TowerConditions.boundCats`), so freeing cats in the cattery makes the circle smaller, and a
  circle with none opens straight on the onslaught. While any pillar is lit the Lich cannot be
  hurt. The cat unbinds a pillar by standing beside it and holding interact for four seconds
  (`ChannelInteraction`; a hit knocks some of it back, walking off pauses it). The human holds
  the Lich off: the Lich leaves the cat at a pillar alone while anybody else stands to be fought
  (`bindingSparesCrawler`). With the human steered, the cat goes to the nearest lit pillar on her
  own and works it; her channel spot is scored by the same danger field her hazard escape reads,
  and once it has been threatened she is kept off it until it has stayed clear for
  `CHANNEL_RETURN_CLEAR_FRAMES` (`ChannelReturnGate`), so the order and the flee rule never trade
  her across the edge of a cone. Fifteen seconds in, the carrier the party's choice sent (Aviel
  if his secret was kept, a High Roost hawk if he was exposed) comes in through the observatory
  window and carries one cat out, never the one being worked (`BindingCircle`). A dark pillar
  stays standing, so the firewall's room never changes.
- **Then the four phases** the fight always had: the onslaught, the firewall, the tantrum and
  the reckoning, with the Warden's barks between them (`src/dialog/scripts/scenes/lich.ts`).
- **Music.** The `warden_ritual` stem set under owner `tower_finale` on the boss layer: the
  stem without the cat theme (`warden_ritual_battle_bound`) while any cat is bound, the full mix
  once the circle is broken. Its decoded stems (`wardenRitualMusic`) are held only from the
  archive up while the ritual is ahead.
- **The fall.** The mask cracks, every pillar goes dark, the questline moves to `aftermath`, and
  the ritual's `onWardenFallen` hook runs; everything after it belongs to the aftermath.

`npm run verify:lich` plays the whole fight on the built cattery from the questline at
`ritual`, binding included, over several streams, beside the pure rules; each binding check
has a `--fault=` that turns it red.

`npm run render:tower-storeys` writes every storey in every state it has to
`preview/missing-cats/tower/`, with its mechanic zones outlined and the gatehouse guards'
looks drawn.

`npm run verify:interiors` is the gate for all of it, including that every door opens onto
clear floor two tiles deep.

### Furniture is placed props

A layout entry is either a `'tile'` (walls, doorway gaps, floor overrides, and the few
bespoke fixtures with no painted prop) or a `'prop'`: an instance from
`TOWN_INTERIOR_PROPS` (`src/sprites/art/townInterior/townInteriorProps.ts`). Room-specific
painters live in `src/sprites/art/townInterior/rooms/`, one file per building plus a shared
`tavernKit.ts`. A prop is multi-tile furniture, the model the Cloak & Dagger's
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
  `townInteriorPropFigures`. The exception is a walkable prop declared `standsUp`:
  the taverns' `bar_stool`s, a seat on legs a crawler steps between and the counter,
  which sort with the figures so they cover the legs of anyone north of them
  (`townInteriorPropLiesFlat` is the split). Use the sized rugs (`rug_runner*`, `rug_small`, `rug_medium`,
  `rug_large`, `rug_ring`), never a row of 1×1 `rug`s.
- **A fire is declared, not painted.** A prop body is baked once and cannot move, so a
  hearth, stove, brazier, forge or torchère paints its firebox, coals and logs without
  flames and lists `flames` sites (`PropFlameSite` in `propFlames.ts`: prop-local `x` and
  `rise` in tiles, a `size`, a `PropFlameStyle`). `drawPropFlames` draws them over the body
  every frame from a short baked loop, offset per site by world position. A prop that makes
  a sound declares `ambientSound` (`{ cue, radiusTiles, maxVolume }`, cues from
  `INTERIOR_AMBIENCE_CUES`); `townInteriorPropEmitters` gives the scene one emitter per
  standing instance at its footprint centre, and a smashed or contract-hidden instance
  falls silent. Keep every fire under the tavern crowd bed. Interiors have no dynamic
  light, so a fire's glow is part of its own art.
- **Wall finish is per building.** `WALL_MATERIAL_BY_BUILDING`
  (`src/map/town/interiorWallMaterial.ts`) picks plaster, stone or timber.
  `interiorWallFace.ts` paints the face.
- **Some systems still scan raw tile types.** `ANCHOR_TILE_TYPES`, Old Lori's repairable
  wreck (`TABLE`, `CHAIR`, `BOOKSHELF`) and the temple's nave spawns (`RUG` tiles) read
  tile types. A `'prop'` entry never writes one, so converting those tiles to props
  empties those scans without an error.
- **A packed row seals a pocket.** A solid run of furniture across a row, plus one more
  blocker inside that span, strands the floor behind it. That never shows in a render;
  only the reachability check in `verify:interiors` catches it.
- **Safe-room decor stamps around props.** `stampSafeRoomDecor` (`safeRoomDecorLayout.ts`)
  reads `placedInteriorPropFootprintTiles()`. Anything that reads "is this floor free"
  must do the same, because the grid under a prop is still floor.

**Occupants stand by furniture.** An `OccupantSpec` has five parts: `placement`,
`territory`, who they are (`OccupantIdentity`), `routine` and `service`
(`src/systems/buildingOccupants.ts`).

- **`anchor` placement.** `scanInteriorFurniture` merges the tile scan with each placed
  prop's `anchors`. A prop is **one** piece per instance, with its whole footprint, so
  replacing two 1×1 tables with one 2×1 table drops an occupant. The `post` hint orders
  the pieces by their centres, and `findStandTile` takes the first free tile in rings
  round the piece's north-west tile, then slides it along that side of the piece to the
  side's middle, so nobody keeps a long counter from its end or its corner.
- **`prop` placement.** Stands on one side of a named prop, centred on its footprint
  (`offset` shifts it along the side, `distance` steps it further out, `post` picks among
  several of that prop). Prop placements are made before anchors and claim their piece, so
  an anchored extra can't take it. The Quiet Needle's Nim, the temple's Deacon Aviel and
  Steve Cartwright (four tiles west of his target board) are placed this way.
- **`mark` placement.** Stands on one authored tile, facing a given way, for a room
  laid out by hand whose furniture the scan can't see (the Cloak & Dagger's host). Marks
  are placed first; a mark on a solid or reserved tile drops the occupant.
- **`territory`.** A radius, a rect of tiles round the stand, or the room's open floor.
  It defaults to the activity's radius, or the room for a `roam` placement.
- **Who they are.** A `residentId`, whose species and figure come from their own records,
  or an unnamed occupant: a crowd `species` (default human) wearing a cast look, or any
  species with a `bespokeFigure` from `BESPOKE_RESIDENT_FIGURES`
  (`src/creatures/bespokeResidentFigures.ts`). Either is drawn through `Townsperson`.
- **`presentWhen`.** Whether the story has put them in the room, read over the
  `TownDialogContext` each time the room is built; absent, they are always there.
  `InteriorOccupantSystem.forBuilding` takes the context and stands only
  `presentOccupants(roster, town)`, so a character the story brings in later is one
  roster entry, never a case in the system. The cellar elf is the one today.
- **`routine`.** An optional behaviour on top of idle and wander (`occupantRoutines.ts`).
  It sets `Townsperson.routinePose`, which a bespoke figure maps onto rows of its own and
  a cast look draws as its `work` loop; the figure owns each pose's length and the beats
  its sounds land on (`routinePoses`), and the routine raises `OCCUPANT_ROUTINE_CUES`
  through the scene. `mop` (the pub janitors) works a few strokes and a wring wherever a
  stroll ends. `target_practice` (Steve) aims, shoots a cosmetic bolt that sticks in the
  target, and reloads; it holds fire while any crawler, companion or hireling box crosses
  the line from the crossbow to the target, and waits a beat after it clears.

A layout steers where someone stands by blocking the tiles it doesn't want them on. An
occupant whose placement finds nothing is dropped silently; `verify:interiors` names the
room and anchor for each roster entry, and checks that every prop placement lands on free
floor beside its prop and that every territory holds its stand. `InteriorReadableSystem`
has its own scan, which must stay in step.

**Every room is lived in.** `npm run verify:interior-density` fails a room with a square of
undressed floor bigger than `MAX_EMPTY_SQUARE_TILES` (4×4). A walkable prop counts as
dressed, and a one-tile ring round the entrance is exempt. It bounds a square, so a long
empty strip still passes.

### The Cloak & Dagger

The club is not built from a layout file: its rooms, stations, stages, seats and
gatherings are fixed in `src/core/club/clubLayout.ts` and its furniture in
`src/core/club/clubProps.ts` (`CLUB_PROPS`, with `CLUB_FURNITURE_TILES` derived from it).
Club props block their footprint **and** the rows their art rises into, so a crawler can
never stand where a counter is painted over them. The shell is 28 × 20 tiles.

- **West:** the bar (north-west) and the market (south-west), each walled from the
  corridor on its east side (`CLUB_DIVIDER_WALLS`).
- **Middle:** the dance floor (`CLUB_DANCE_FLOOR`) with its cast dancers, and a raised
  stage either side of it (`CLUB_PERFORMER_POSTS`): Angel on the west, Magnum on the east.
  A stage blocks its whole 3 × 3 footprint; two open rows run above and below each one.
  The act is drawn at the pole, lifted by the stage's riser (`CLUB_STAGE_RISER_TILES`), and
  each act (`CLUB_PERFORMER_ACTS`) plants its pole on the socket painted at the stage's
  centre.
- **The casino** is the whole north wing (`CLUB_ZONES`, no painted label): two facing
  rows of slot cabinets with an aisle between them (the south row drawn from behind),
  the poker table, the blackjack table with Deuce, and the Wheel of Fortune in the
  north-east corner with Donald's counter at its foot (`CLUB_DONALD_POST`). Every game
  has a "Play" station, and each opens the same game picker.
- **Gamblers** sit on the casino's stools (`CLUB_CASINO_SEATS`, run by
  `ClubGamblerSystem`) in the cast's seated rows. Poker stools are indexed by the poker
  screen's seat numbers, so while the player is at the table its stools hold exactly the
  regulars the screen deals; the player's own stool stays empty. Blackjack's stools
  empty while that table is open.
- **The open floor** east of Magnum's stage holds the high-top tables.
- **The crowd** (`ClubCrowdSystem`) never strolls for its own sake. Each patron stands
  with a gathering (`CLUB_GATHERINGS`: the ring round a high-top table, or an open circle
  of friends) facing its middle and talking in turn, or watches a stage, and after a while
  moves on to another.
- **Brandon** greets the door from behind his host stand. He is the club's one rostered
  occupant (`BUILDING_OCCUPANTS`), stood on `CLUB_HOST_MARK` by a `mark` placement.
- Every slot cabinet plays the slot floor from where it stands; the emitters follow the
  cabinets the room places, not the building's name. The wheel and the slot fronts carry
  chasing-bulb overlays (`ClubPropLights`) on their own sheets.

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
  - An occupant reacts with a HUD caption pointing at them (`InteriorBreakReactions`),
    never a conversation or a speech bubble.
- **Loot.** A layout entry's `dropsLoot` overrides the def's `dropsLootByDefault`. Shop
  merchandise is `dropsLoot: false`, so breaking stock is never a way to steal it. Loot
  always drops, lands and then flies to the HUD.

### Remembered between visits

`TownMemory` (`src/core/state/TownMemory.ts`) is threaded by reference through `DungeonScene`
and `BuildingInteriorScene`. It holds resident talk counts, Fen's poultice batch,
`clearedCamps`, `paidOutInteriorProps` and the places visited.

- **A prop pays out once, ever.** `paidOutInteriorProps` is keyed by
  `interiorPropPayoutKey`: the room key plus the id the layout gives the prop. Every prop
  a save remembers (a breakable, a searched container: `StatefulTownInteriorPropId`,
  derived from the prop table) must be placed with `statefulProp(x, y, propId, id)`, and
  `prop()` refuses those ids at compile time, so moving a prop keeps its payout. An id is
  unique within its room; one placed in a loop carries the loop's index
  (`` `pew_${rank}_west_${i}` ``), and `applyTownInteriorLayout` throws on a repeat. A prop
  with nothing saved needs no id and is named by its tile.
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
it, as do the tower storeys, the club and the Starlight Tent.

- **Bounds are visual, not the grid.** Prop art rising above row 0 is measured from the
  baked frame (`townInteriorPropArtRiseTiles`) and grown by `INTERIOR_CAMERA_MARGIN_PX`.
- **The HUD is an occluder.** Indoors the HUD is the same `HudSurface` as outside, laid
  out by the shared `hudLayout`; `liveHudLayout` answers for the live screen without
  drawing. `interiorHudOccluders` (`src/scenes/interiorHud.ts`) turns that layout's unit
  frames, minimap, room-name slot and shown buttons into occluders for `hudClearView`,
  which pushes the view off each occluder that could cover reachable floor, keeping at
  least four tiles clear. Otherwise a rat or the cat stands under the Bag button on a phone.
- **The room name** is a top-band entry (`roomNameEntry`), placed with the rest of the band
  between the unit frames and the minimap, and under the frames on a compact screen.

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

## History and belief

Every line about the town's past and its faiths agrees with this section. A resident
still gives at most one of these facts per conversation (see [Talking to people](#talking-to-people)).

**The Fraying.** Taloncrest was once a city ten times its size. In "the bad year" the
world came apart at a seam under the old city, and its streets unravelled into rubble
overnight. The people caught inside the fray did not die: they came back wrong and
wandered out into what became the ruins. Ruins ghouls and krasue are what the Fraying
made of the citizens. The survivors walled the hill that was left. The seam never fully
closed, the ground there still does not sit right, and on stormy nights the edge of the
ruins shifts.

- Nobody knows why it happened. Caroline has never said, and no creature or person
  caused it. No line invents a culprit.
- It was never a poison, a gas or a sickness in the water, and no line describes it as one.
- The temple calls it the Fraying. Old people call it the bad year.

**A cat always comes back.** The town's cats walked through the Fraying and came back
whole, where the people caught in it came back wrong. No Taloncrest cat can be shut in
for long: a bolted stockroom finds her on the roof by morning. "A cat always comes back"
is what the town says of anything that turns up again. Nobody explains why it is true.
No line does, and Caroline never says.

**The Hawkfolk and the Carrying.** During the Fraying the Hawkfolk flew the old city's
people over the fray to the hill, along with whatever could be lifted. The smith's anvil
came in on a sledge; the people came in on wings. Their faith grew from that: a wing is
owed.

- Every Hawkfolk who can fly owes carries to those who cannot. "Nest-debt" is the
  everyday word for it. A Hawkfolk who refuses a carry is "clipped": shunned.
- The temple's tract is _On the Carrying_: carry what the ground cannot; set it down
  gently; never take a fee for the first carry; remember every name you could not lift.
  The temple reads those names every seventh day.
- The Hawkfolk council is the High Roost. It meets on the temple dome and answers to no
  official of the town, the Warden included. It resents the tower.
- Hawkfolk are not angels and nobody worships them. They are a proud, dutiful majority
  who carried the city once and have never quite let the groundfolk forget it.

**The tower and the Warden.** The Town Center Tower was the seat of the old city's
Warden. The Warden died in the bad year and did not stay dead. There is no magistracy and
no council of the town: civic authority is the Warden, absent and feared, and the tower
guards who keep the tower. The guards are living, ordinary and loyal; some have served
decades and seen only a masked figure at the top of the stairs. Nobody else in town has
seen the Warden at all. Proclamations still come down in the Warden's unchanging hand,
and people fear the tower more than they obey it. The player-facing name is "the Warden";
it has no personal name, and no line before the tower itself says what the Warden is.

**The cult's elves.** Elves who would not be carried went down instead of up during the
Fraying, into the cellars, the old cisterns and the storm drains under the hill. They
came back knowing every pipe under the town, and certain the Fraying was Caroline's own
hand.

- Their creed: Caroline chooses whom she speaks to, and she can be made to choose.
  Offerings get her attention.
- They burn offerings as a signal to be noticed: candles, trinkets, a lock of hair and,
  in the worst of them, blood. Never souls.
- Their mark is an open eye over a cupped hand, an offering held up to be seen, which
  nods to Caroline's floating eyes.
- They call the Hawkfolk "carriers of dead weight".
- Their own cats went missing with the town's. They left locks of their cats' fur at the
  Blackwood Lodge cellar lid as offerings, asking Caroline to notice them and bring the
  cats home. The town found the fur and blamed the elves for the thefts.
- They know the drains under the tower and do not go in there.

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
room the doctor's and Dave's ranges can overlap. `safeRoomSpeakerFor`
(`src/systems/safeRoomSpeaker.ts`) gives a press to the nearer of the two.
`npm run verify:walk-away` holds the rule.

**Voice.** People talk about their own lives, and the world reaches the player through
them. A person gives at most one fact about the wider world per conversation, and only
one they would plausibly know. Residents mention each other. Hawkfolk call anyone who does
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

## A Cat Always Comes Back

Taloncrest's questline. Someone is stealing the town's cats, the town blames the elves,
and the thief turns out to be the temple's own deacon, carrying the cats to the tower for
the Warden. Its state is one `MissingCatsProgress` (`src/core/quests/missingCatsProgress.ts`),
made by the overworld scene and threaded by reference through every scene that builds a
room of it. Every phase is entry-idempotent: a scene built at any phase stands that phase
up from the record, so a door, a death or a reload resumes a phase from its start. The
record is saved with the run's checkpoint (`captureMissingCatsProgress`,
`parseMissingCatsProgressCheckpoint`). What a crawler carries for it (the feather) lives
in the bags and is never mirrored in the record. The systems are in
`src/systems/missingCats/`, and the quest's own lines in
`src/dialog/scripts/scenes/missingCats.ts`.

The town's seven cats (`TOWN_CATS`, `src/systems/critters/TownCats.ts`) each have a home
and an owner: Biscuit at the Sleeping Cat Inn (Innkeep Ossie), Thimble at Old Lori's
Cottage, Sage at Herb & Remedy (Baggi), Barrel at the Horned Flagon (Innkeep Brend),
Chaff at Miller's Farm (Marta Miller), Cinder at the Rusty Anvil (Smith Varga) and Penny
at the General Store (Keeper Brenna Kestrel). Which are missing is derived from the phase
alone (`missingTownCats`): every cat but Penny from the start, Penny too from the chase,
and none once they walk home. A cat who is not missing lives indoors, never on the
street: on her home's ground floor she keeps a spot by the furniture her `restsBeside`
names (Biscuit's cat stool, Thimble's armchair, a hearth or a rug) and wanders a little
round it (`HomeCats`, built with the room; `townCatIndoors`). The one exception is Penny
through `stakeout`, out on the store's step as the thief's bait. Either crawler can pet
a cat at home, as they pet a cow: she sits and washes, hearts float up, and the run's
`townCatPets` tally counts it, shown in the pause menu's Stats tab.

**The steps** (`MissingCatsPhase`), in order:

1. **`not_started`.** A regular sits on a street bench against the Sleeping Cat Inn's front
   wall beside its doorway (`InnWallSitter`, `innWallSitter.ts`), on a tile the town map
   reserves for the map's lifetime (`reserveInnWallSitterTile`) so no prop or crowd lands
   on it. Until the party has talked to them, and while nobody has asked at the inn, they
   wear `!`; a word with them says the innkeeper's cat is missing, sets
   `innWallSitterHeard` and follows the questline in the Journal, which points the party at
   the inn. Once the cats are home they say Biscuit is back. Inside, Innkeep Ossie wears
   `!`. She tells the party Biscuit is gone; Dave adds that a cat always comes back,
   usually.
2. **`posters_up`.** A missing-cat notice for each missing cat hangs on the Market Plaza
   notice board. Reading the board starts the investigation.
3. **`investigating`.** Four sites, in any order (`MISSING_CATS_CLUE_SITES`,
   `CLUE_SITE_CLUES`). At each house the owner wears `!` until heard, and then a `?`
   clue spot stands in the room:
   - Old Lori's back window, set into the north wall between her hearth and drying beam
     (`window_dressing` on the wall row, so the chimney step under it stays bare floor).
     The cottage is one storey and the window looks over her back garden. Its iron latch
     lies on the floor under it, sawn through from outside, and Lori has found no
     footprint, trodden leaf or bent stem in the garden under it: nobody walked up to the
     window. The town reads it as an elf that crept through the garden.
   - Herb & Remedy's dish of tuna on the back-room floor under the window by the potting
     bench, which nobody in the house bought; then the General Store's order book, whose
     first entry is the tower's standing weekly tuna order, collected by a tower guard
     after closing: two tins a week for years, twelve this month, against a tin a month
     over the counter for the rest of town.
   - Miller's Farm's millstones, where Chaff slept: a single large grey feather lies on the
     floor beside them. Everyone dismisses it, because Hawkfolk feathers are everywhere. It
     goes into the human's quest slot. Whenever nobody is carrying it before the
     confession, it lies beside the millstones again.
   - Outside the Sleeping Cat Inn, a scent trail only Belle can see. It leads across the
     plaza and stops in open ground.

   Reading the board plays the party's reading of it (`NOTICES_READ`): which three
   notices say something odd. It names no next step itself; the lead to the first clue
   the story points at follows it. Every clue found moves the questline to `blame`, and
   the last one, wherever it was, plays the party's summing-up (`INVESTIGATION_SOLVED`):
   the thief came from the sky, so why do the soldiers blame elves? That is what sends the
   party to the Lodge.

   **Leads onward** (`src/core/quests/missingCatsLeads.ts`). The clue the story points at
   next is `nextInvestigationClue`: one still waiting at the site the party last found
   something at, then one at a site they started and left, then the next untouched site in
   the order the board names them. Each clue's place is declared once (`CLUE_PLACES`), and
   both the party's lines and the Journal's arrow read it, so the two never name different
   doors. When a find moves the story to another building (`leadMovesOn`), the party says
   where in that clue's line from `LEADS_ONWARD` (`leadOnwardLines`); while the next clue
   is in the same building they say nothing. The Journal's investigation row points at the
   next clue's door, or at the start of the scent trail for the inn's, and nowhere while
   Belle is steered with the trail on her screen, since the scent is then the way.

4. **`blame`.** At Blackwood Lodge, Sgt. Kessler shows the locks of cat fur found tied
   under the cellar lid and puts the town's blame on the elves, who live in the drains
   under the town; Belle smells that what is under the lid is not elves. In a cutscene
   Kessler walks to the hatch, works the hasp and heaves the lid up on its north hinge
   (`LodgeCellarHatch`, painted by `cellarHatch.ts`), and steps aside. The lid had kept
   the deep cistern shut, and ruins ghouls and krasue out of the old ruins under the hill
   climb the shaft's iron rungs and out over the lip one at a time, through
   `LODGE_CELLAR_WAVE_COUNT` waves (three). A little after the first is out, three elves
   run in at the lodge's front door: the ghouls fill the ladder, so they came round by the
   alley drain. They say so, and hold the lid beside the party, unkillable. While the lid
   is up its well's tiles are blocked. The record keeps `cellarWavesHeld`, so a rebuilt
   room resumes at the next wave with the lid open and the elves already at the hole.
   Once it holds the elves drop the lid shut, and the cellar elf explains: the elves keep
   the ghouls back in the drains and the lid kept them out of the town, the elves' own
   cats are gone too, and the fur tied under the lid was their offering. The elf becomes an ally
   and offers help if the party ever needs it; Belle and the human then work out that
   Penny is the last cat left, so the thief comes for her next, and the questline moves
   to `stakeout`.
5. **`stakeout`.** Only Penny is left in town, sat on the General Store's step. Dusk falls
   over Taloncrest (`DuskGrade`): a contrast grade under the shared lighting cap, with warm
   pools round every street torch and a light on each crawler, never an obstruction. When
   the party comes near the store the thief arrives and circles it on a fixed loop built
   from the prison guards' patrol segments, looking in toward the step with a sight cone
   cast against the buildings (`castCone`, `lightSeesBody`). Its gaze shows on the street
   as a faint wash of light, not a warning, because it hurts nobody. A crawler stood in one
   of the dashed hiding rings is never seen; one in the open inside the cone makes it
   circle away and come back after a while. The first time it sees the party, they talk it
   through (`THIEF_FIRST_SPOTTED`, recorded as `thiefSpottedParty`): they scared it off, and
   must watch from a hiding spot. Every later sighting is only a bark over the steered
   crawler (`THIEF_SPOTTED_AGAIN`), which the world does not stop for. Left unseen for a
   little over a loop it swoops
   and takes Penny, and the questline moves to `chase`. The stakeout claims the
   `rooftop_chase` stem set at its reduced stem (`rooftop_chase_stakeout`, owner
   `missing_cats`, layer `activity`), and the swoop moves the claim to the full mix.
6. **`chase`.** The winged shape flies a fixed route over the roofs, perch to perch, to the
   dome of the Temple of the Sky (`planRooftopRoute`). Whenever the steered crawler falls
   more than `CHASE_LEASH_TILES` behind it settles on its next perch and waits, so the
   party can lose sight of it but never lose it. It lands on the temple: `confession`,
   and the party remarks that its grey wings match the mill's feather and that Deacon
   Aviel, who keeps the temple, is Hawkfolk (`THIEF_LANDED_REMARK`). A
   rebuild during the chase starts it again from the store's roof.
7. **`confession` and `choice`.** The party presents the feather to Deacon Aviel, and a
   second feather on the altar dais matches it. He confesses. His confession assumes the
   player knows no history: it says in plain words that the old city fell to ruin in one
   night and the Hawkfolk flew out whoever they could, without naming the Fraying. He could
   not lift everyone, and his faith tells him to remember every name he could not lift; the
   Warden promised to bring those names back, and he carried the cats up to the spire
   without asking why. The cats are up there still and the Warden waits for one more: the
   chosen one's cat. He speaks as he does everywhere, with "thou", but every line reads
   clearly on first pass. The party
   then chooses (`AvielChoice`): expose him to the High Roost, who clip him and ground
   him at the temple until a High Roost hawk takes his place, or keep his secret, for
   which he owes the party a carry. The answer is stored as `avielChoice` and read by
   every later act.
8. **`bait`.** In the safe room the party tells Dave the plan, and in the same talk he
   tells them how he lost Pumpkin in the tower (see [Dave](world-and-story.md)) and begs
   them not to put Belle in its hands, and Belle volunteers anyway before it closes. The
   talk opens on his arrival in the safe room while it is owed, or on a word with him.
   Then dusk comes down again. She waits on the plaza fountain at dusk, and the carrier
   pretends to take her so that the party can follow the real hand-over.
9. **`captured`.** Whichever crawler is steered, reaching the fountain
   (`FOUNTAIN_REACH_TILES`) with Belle present, on her feet and within
   `BELLE_JOINS_BAIT_WITHIN_TILES` of it lays the bait: the player is never asked to switch
   to Belle. A Belle not already on the rim strolls onto the open tile within its reach
   nearest her (`baitSeat`); a Belle left further off has to be brought. Then the capture
   plays as a cutscene (`captureCutscene.ts`), timed to the `capture_at_dusk` jingle's own clock
   (`CAPTURE_KRASUE_LANDS_AT_S`, `CAPTURE_LIFT_OFF_AT_S`, `CAPTURE_CUE_FADED_BY_S` beside
   `CAPTURE_CUE`). The carrier (Aviel if his secret was kept, a High Roost hawk if he was
   exposed) settles on the rim and the pretence starts. The jingle starts as the camera
   pans, so its lead-in plays under the pretence, and the krasue fall out of the dark onto
   Belle at the drop's mark or a beat after the pretence closes, whichever is later; the carrier is thrown aside and says they were expected; at the
   lift-off Belle is carried toward the spire while Caroline tells her the Warden planned
   for this before she did; the screen goes black as the cue fades. The krasue and the
   carrier are painted bodies (`CaptureStaging`) lent to the script as actors, not
   creatures of the street. The jingle's group (`missingCatsCapture`) is held from the
   moment the bait is agreed. When the scene ends the party splits
   (`beginCaptivity`, `missingCatsSplit.ts`): Belle alone in her own cage on the
   cattery storey, the human (and their hire, if any) on the street where they stood.
   Any scene, street or room, that finds the party whole while the questline stands
   anywhere in the split (`missingCatsSplitUnderWay`) forms that phase's split
   (`splitWholePartyIfOwed`): the chapter's side live, Belle where her chapter opens or
   her last one left her, the human on the street or where their chapter opens.
10. **`cattery`.** The split's first chapter is Belle's, in the cage (see the tower's
    chapters below). When it ends the questline moves on to `seeking_entry` and play is
    handed down to the human.
11. **`seeking_entry`.** The tower door's two guards still refuse. The cellar elf at
    Blackwood Lodge wears `!`; asked, it says the drains run under the tower and that it
    will wait at the storm-drain grate on the Civic Terrace (`elfWaitsAtGrate`). From
    then until the party is whole again inside the tower, Sydney's desk at the Barracks
    lends one hire at no fee to a party without one (`towerLoanOffered`), once a run
    (`towerLoanSigned`). While the elf waits at the grate for a human with nobody to bring,
    Sydney wears `!` (`hireOwedForTheDrain`); talking to her opens the desk as always. A hire
    signed while the party is split joins the live group (`SplitDirector.joinLiveGroup`). A
    hire walking the tower errand with the party (`towerErrandLeg`: `cat_taken` while Belle
    is held, `party_whole` from `ascent` until the aftermath) chatters from that leg's own
    lines in their voice (`towerErrand`) in place of their usual ones. At the
    grate the elf (`GrateMeeting`) turns a human with nobody beside them away, and opens
    the grate for one with a partner: `sewer`, with a save at its mouth. Dave's tactics
    (`missing_cats_tower_door`, `missing_cats_drain`) say the guards do not hit, they
    throw you out, and to stay behind the elf; Caroline's intel says Belle is alive at the
    top and that the Warden knows the party is coming.

**The tower's chapters** (`MISSING_CATS_CHAPTERS` in `missingCatsSplit.ts`, played by
`SplitDirector.runChapters`; the ends are noticed by `TowerChapters`, `towerChapters.ts`,
which only the tower builds). The two sides take turns, and each chapter ends on what it
leaves for the other: a chapter's end moves the questline on to the phase the next chapter
plays in, which is what the table's `endsWhen` reads, and the director then saves and hands
play over behind a "Meanwhile…" card. Each end is held a moment first, so what caused it is
seen to happen.

| Phase                                 | Side                                    | Where                                                   | Ends when                                                                                              | Leaves for the other side                     |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `cattery`                             | Belle (+ cellmate)                      | cattery, from her cage                                  | she comes down into the archive while its wards burn solid; she and the cellmate hide (one short talk) | —                                             |
| `seeking_entry` → `sewer` → `cistern` | human (+ hire, + elf through the drain) | the street where they were left, the sewer, the cistern | the sluice is shut (`conduitShut`)                                                                     | the archive's wards pulse                     |
| `archive`                             | Belle                                   | the archive landing she hid on                          | she comes down onto the bell storey with the key ring sent (`keyRingSent`)                             | the key ring at the kitchen's dumbwaiter foot |
| `gatehouse`                           | human                                   | the gatehouse's cellar stair landing                    | the tuna has gone up (`tuna_sent`)                                                                     | the cellmate is fed and will sit on a plate   |
| `bell_storey`                         | Belle                                   | the bell storey landing she came down onto              | the counterweight falls (`portcullisRaised`)                                                           | the kitchen's portcullis is up                |

`sewer` becomes `cistern` when the human first stands in the cistern. While split, a stair
that leads off the playing side refuses with a toast (`TowerChapters.stairRefusal`, through
`TowerStairSystem`'s refusals): the cistern's stair up until the sluice is shut, the
archive's stair down until the key ring is sent, and the bell storey's stair down, which ends
at the portcullis. Every hand-over rebuilds the tower from the questline's progress, so each
storey is built as the other side left it.

A save cannot resume indoors, so a save taken in a tower chapter resumes at the tower's
doorstep, and the overworld moves the party straight back to where the save recorded the
live group (`resumeLocationFor`, `src/systems/partySplit/splitResume.ts`): the chapter's
opening place for the save a hand-over writes, so a death or a reload in a chapter starts
that chapter again. Every save records the live group where it was written
(`recordLiveGroupForSave`), and only a save written inside a building owes that move; a
save the human writes on the street mid-split (out for the tuna) resumes on the street.

**The reunion.** When the bell storey's chapter ends the party is put back together
(`SplitDirector.regroup`) at the head of the kitchen stair, behind its own card. Whenever the
party stands on the bell storey together at `bell_storey` with the portcullis up, the
reunion plays: Belle steps back from the stair, `reunion_jingle` sounds, the human comes up
it and walks over, and one conversation (`REUNION`) says what the climb is now. Its end moves
the questline to `ascent`, saves, and rebuilds the tower, since the archive and the cattery
are built differently for a party climbing together. The cellmate stays at Belle's side as
the scene's cat ally until the aftermath.

**Up together** (`ascent`, `ritual`). The archive's wards sweep and only Belle sees them; the
stones that feed them are hers to find and the human's to break, and the krasue fight. The
first arrival on the cattery at `ascent` opens the Warden's fight (`TowerRitualSystem`) and
moves the questline to `ritual`. A save written in the tower after the reunion resumes
where `missingCatsTowerResume` (`towerResume.ts`) stands the whole party: the reunion's
landing at `bell_storey` and `ascent`, the foot of the cattery stair at `ritual`, the
cattery at `aftermath`. From the street, every tower step of the Journal points at the storm
drain, the only way in.

**The tower's music.** Inside the tower from Belle's cage until the Warden is gone,
`TowerChapters` claims the `tower_split` stems (owner `tower_split`, layer `activity`):
`tower_split_descent` while Belle's side plays, `tower_split_ascent` while the human's does
(and `stealth_music` on the gatehouse during its chapter), and `tower_split_full` once the
party is together. Their decoded group, `towerSplitMusic`, is held only inside the tower in
those phases, and `missingCatsReunion` while the questline is at `bell_storey`. The Warden's
fight claims over it on the boss layer. Before Belle is taken and after the Warden, the
tower plays its own `TOWER_MUSIC_TRACKS`; the sewer plays `storm_drain`
(`SEWER_MUSIC_TRACKS`). A tower guard that half sees a crawler from off the screen is
captioned; the keeper's shriek is captioned off screen by its own sound.

**The aftermath** (`aftermath` → `complete`). When the Warden falls the mask cracks, the
circle goes dark, and every town cat still bound to it gets up and runs for the stair
down (`CatsWalkOut`) while the room watches; then a save. From `aftermath` on every cat
is home (`townCatsHome`), derived from the phase and never stored: each keeps to her spot
inside her building's ground floor, the inn's Biscuit included.
The tower's door guards, while the cats are walking home, say the bells have stopped and
that nobody has told them to stand down; after `complete` the tower is closed by an order
nobody can trace. In the Sleeping Cat Inn's taproom, the first time Dave and the party
are there together, Pumpkin noses the door open and walks to him on `reunion_jingle`
(group `missingCatsReunion`, held near the inn and inside it during the aftermath), and
their conversation plays over `old_friends`, claimed for that talk alone. Its end
completes the questline (`completeMissingCats`): XP to both crawlers, coins, and the
Hushed Bell (`hushed_bell`, granted to the cat), shown on the quest-reward screen. The
grinning mask is not the questline's: it rolls from the floor-3 gear pool. Nothing opens and nothing ends; the party
keeps playing the floor. From then on Pumpkin lives in the taproom by Dave's spot
(`pumpkinLivesAtTheInn`, read off the phase), sits, grooms and ambles, and answers a talk
in her own voice, whether Dave is in or teleported out. Aviel's lines after the aftermath
follow the choice: clipped and walking, or still owing the carry. The town's playlist
gains `taloncrest_cats_home`.

**Dev routes.** `npm run playtest -- <id>` opens the questline at the start of a step:
`missing_cats_hook`, `missing_cats_investigation`, `missing_cats_cellar`,
`missing_cats_stakeout`, `missing_cats_chase`, `missing_cats_temple` (the feather in
the human's quest slot) and `missing_cats_bait`; `sewer` opens it at `sewer`. A preset's
`missingCatsPhase` builds the record with everything an earlier step leaves behind
(`missingCatsProgressAt`).

**Dave and Caroline.** Each step with a safe-room objective has an `AdviceObjectiveId`
(`missing_cats_notices`, `missing_cats_owners`, `missing_cats_cellar`,
`missing_cats_stakeout`, `missing_cats_temple`, `missing_cats_bait`): Caroline's intel
says where and what, and Dave's tactics say how. Dave's tactics for `missing_cats_bait`
are his story and his plea to find another way, and Belle's offer follows it.

**Blackwood Lodge.** Kessler's post sits on the cellar lid (`cellar_trapdoor`), the mouth
of the drainage under Garrison Row and of the old cistern below it. The lid defence is
fought in the Lodge itself. Once the lid has held (`lodgeCellarHeld`), the cellar elf
(`taloncrest_lodge_cellar_elf`, named "Cellar elf") lives in the Lodge for good, standing
by the lid. Its roster entry is present only from then (`presentWhen`, see
[Furniture is placed props](#furniture-is-placed-props)). It is the same elf that guides
the party through the sewer later (`SewerGuide`), and it speaks in the same voice:
plain, unhurried and without contractions. Kessler's own talk changes once the lid has
held; he strikes the elves out of his log.

**The temple.** Deacon Aviel keeps the Temple of the Sky and reads the names the parish
could not lift every seventh day. Before the chase he has added the missing cats to them.
After the choice, his talk follows `avielChoice`: clipped and walking where he used to fly,
or quietly in the party's debt.

**How the town reacts.** Through the same `TownDialogContext` every speaker reads
(`missingCats`: phase, clues, cellar waves and Aviel's choice):

- Every owner (`RESIDENT_LINES[*].reactive`, `src/dialog/scripts/residents.ts`) leads
  with their own cat while she is gone, and with her return once every cat is home.
  Some owners also react to the clue found in their house.
- Street citizens (`buildCitizenConversation`, `src/systems/townDialog.ts`) lead every
  other talk (`REACTIVE_LEAD_MODULUS`) with a `REPUTATION_GREETINGS` line for how far
  the party has come (`ReputationTier`: asking after the cats, held the cellar, lost
  their cat, brought the cats home), or with the street's `GOSSIP_LINES` on one of those
  talks in `GOSSIP_OVER_GREETING_MODULUS`. Before the investigation there is no
  reputation and the lead is gossip. The modulus is coprime to the three lines every
  greeting pool holds (`ReputationGreetings`), so every greeting is still seen.
- Madame Voss's and Old Lori's readings (`src/dialog/scripts/fortuneTeller.ts`) draw a
  reactive reading about half the time one applies.

---

## Invariants

Load-bearing for quests, systems and save state. Anything that moves must be re-derived,
not hard-coded twice.

**Building ids.** Every `buildingEntries` id and `type` value. Quests, dialog, interiors,
mercenaries, the club and saves key off the ids
(see [Building ids](#building-ids)); a misspelled one fails to compile, and a renamed one
discards saves that hold it. The tattoo parlour is `taloncrest_tattoo_parlor` (sign
**The Quiet Needle**, sprite key `quiet_needle`), and the facade's
`replaces: 'tattoo_parlor'` stays as it is — the frozen footprint fixture the building
gates measure against is keyed by `replaces`, not by the sprite key.

A building with no entry in a partial table is invisible from both directions: the
building reports no service and the service names no building, so nothing throws and
nothing logs. `verify:interiors` walks both sides for exactly that reason.

**A sign can be renamed freely.** `paidOutInteriorProps` is keyed by
building id (`InteriorPropPayoutKey` in `TownMemory.ts`), so changing a
building's display name keeps everything the town remembers there. Changing an id is a
save break like any other: the save fails validation and is discarded. Wendell's home is
**Plumbline Farm** (`taloncrest_builder_farm`, facade `plumbline_farm`).

**Safe-room-ness is `hasSafeRoom` on the planned building**, not a `BuildingKind`.
`BuildingKind` is `'house' | 'tower' | 'store' | 'club'` — there is no `restaurant`
member, and reintroducing one to mean "safe room" is what forced The Barracks to be
registered as a restaurant for as long as it held the safe room. Exactly one building
carries the flag, and `verify:interiors` asserts that.

**`OverworldData` fields.** `startTile`, `buildingEntries`, `mainTowerAnchor`,
`townSquareCentre`, `fountainCentre`, `circusCentre`,
`circusRadiusTiles`, `townSafeRadiusTiles`, `hallwaySpawnPoints`.

**Story geometry.**

- The tower base stays adjacent to the plaza (the tower stairs).
- Floor 3 has no exit. `level3` is the last floor and has no stairwell, and nothing ends
  the run there yet.
- The circus stays 70–90 tiles from centre, outside the safe radius, with a ruins buffer.
  Its road routes to the nearest **gate**, not the town centre — a gate exit is a tile
  the gate's own highway paves, so the joint cannot miss.
- Miller's Farm, Blackwood Lodge and the club alley each stay reachable and thematically
  placed.

**Centre-relative offsets.** These are tuned to the current town extents. Move the
layout and they must be re-tuned, not left stale:

| Consumer               | Constants                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `market/vendorDefs.ts` | `WEST_STALL_DX`, `EAST_STALL_DX`, `STALL_ROW_DY`                                    |
| `TownPropSystem`       | `BOARD_OFFSET`, `FORTUNE_OFFSET`                                                    |
| `TownLifeSystem`       | `PLAZA_RADIUS_TILES`, `DISTRICT_RADIUS_TILES`, `FRONTAGE_RADIUS_TILES`              |
| `DungeonScene`         | `FOUNTAIN_AMBIENT_RADIUS_TILES`, `TOWN_SQUARE_AMBIENT_RADIUS_TILES`, `CITY_CROWD_*` |
| `OverworldGenerator`   | `TOWN_SAFE_RADIUS_TILES`, `RUINS_*`, `FOREST_MIN_DIST_TILES`                        |

A stale offset drops a stall, bench or notice board into a wall. `?townmap` shows it
instantly.

---

## Briar Hollow

A small, wooden ratkin farming village in the eastern wilderness of every floor-3
world. It is **not** a safe zone: nothing in the village adds a safe room or extends
`isInTownSafeZone`, and `isInsideTownWall` is false on every village tile (it tests
`townPlan.interior` only).

**Saving is entry-based**, like the walled town's gate. `DungeonScene.isInBriarHollowSaveZone`
is the village square district always and, once the Plea's rewards have been granted
(`isVillageSavePoint`, which reads `quest.rewardsGranted`), the whole palisade interior
(`GameMap.isInBriarHollow`). The frame the active crawler crosses into that zone,
`onBriarHollowSaveZoneEntered` calls `captureSavePoint`; stepping out of a building door
inside the zone counts as crossing in. `canSaveInBriarHollow` refuses the save while a
revive is pending, a hostile inside the palisade is fighting the party, a boss fight is
on, or the bell tower is broken. A refused entry is not retried; the next save is the next
real entry. The Plea's quest-complete screen carries a "NEW SAVE POINT" card saying so.
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
four waves; spiders, gravedigger beetles and bosses are the exceptions, and rock golems come with
the last. The bounty mark comes levelled to the siege, with a share of its health and
an `outgoingDamageScale`. The wave's fairy comes too, along with every earlier wave's
fairy that has fallen since. Fairies are not enlisted: they fly with the wave and leave
when the siege ends.

The waves and the siege's kind ladder (`BRIAR_HOLLOW_SIEGE_LADDER`) live in
`assaultWaves.ts`. Each mini-wave's roster is planned once, when it rises
(`planAssaultRoster`): counts scaled for the difficulty, then resolved through the ladder
at the variety tier in force, so a device that has given up variety fields fewer kinds,
pooled by threat into more or fewer bodies of a kind the siege already fields. The
leaders and the undead are never substituted. Every kind in the siege, the raised ratkin
included, wears its one shared look on every device (`ENCOUNTER_LOOK_TIER_FLOORS`). The countdown and each mini-wave's lead-in
warm exactly the planned kinds (`AssaultWavePrewarm`), from the rows each kind declares
on its `MOB_KINDS` entry (`approach`).

Vordrick leads every wave. In the first three he comes with a share of his health and
`cannotBeKilled`: beaten to 1 HP, or still standing when the lull begins, he fades away
(`Necromancer.beginFadingAway`) and is released with nothing paid. His death in the
fourth wave wins the siege.

In a siege, each of his raises calls up `NECRO_SIEGE_TROOPS_PER_RAISE` bodies: raised ratkin,
skeleton warriors and skeleton archers (`SIEGE_RAISE_KIND_WEIGHTS`). Up to
`NECRO_INNER_RAISES` of their sigils open **inside the palisade**, so the walls do not keep
the whole fight outside. They open in a band just inside the wall, between
`NECRO_INNER_RAISE_MIN_WALL_DEPTH_TILES` and `NECRO_INNER_RAISE_MAX_WALL_DEPTH_TILES`
deep (`PalisadeDistanceField.insideDepthAt`), at least `NECRO_INNER_RAISE_MIN_TOWER_TILES`
from the bell tower, clear of every defender and construction, and preferably within
`NECRO_INNER_RAISE_SIDE_TILES` of Vordrick, on the side he is attacking. The inner dead
carry `INNER_RAISE_DIRECTIVE`: they hunt the nearest defender within
`INNER_RAISE_DEFENDER_LEASH_TILES` (or a strictly nearer trebuchet inside the wall) and only
march on the bell once nobody is left to fight. His raises of every
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
she lent the blueprints to Wendell at Plumbline Farm in Taloncrest. Wendell will lend
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

**The steps** (`BlueprintsQuestPhase`, `src/core/quests/blueprintsQuestPhase.ts`):

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
| `show_fenna`      | Wendell's hand-over read through                  | Fenna (`?`), whose briefing names both upgrade costs; Wendell if nobody holds the blueprints                                |
| `build_stations`  | Fenna's briefing closed                           | the nearest station still to upgrade, or the shortfall; Wendell if nobody holds them                                        |
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
  computes the town's bearing from the village (`taloncrestWhereabouts`, falling back to
  "Taloncrest, past the road"). In `show_fenna`, while a crawler holds the
  blueprints, she wears a `?` and opens with a briefing that names both upgrade costs
  (`stationUpgradeCost`); closing it moves the phase to `build_stations`. At every other step while the quest is under way she opens
  with "Any luck with those blueprints?", and at the end she barks the completion line.
- **Wendell** (`WendellBlueprintsHook`) plays the first visit at `ask_wendell` and the
  hand-over at `midge_delivered`, ahead of his usual resident flow. Between them he says
  his waiting line once per visit and is then his usual self, because his bed must stay
  reachable. In `show_fenna` or `build_stations` with neither crawler holding the
  blueprints, talking to him hands them back. Both hand-overs go into the steered crawler's quest slot. Every
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
starts a `SCYTHE_SWING_SECONDS` (1.5 s) swing, drawn on the human's chop row paced to the swing
with the scythe as his working tool; the cat swipes as the grain falls. The swing shows a
screen-wide timing bar in the HUD pass (`ScytheSwingBar`): a needle crossing a track with
the good and perfect bands marked, laid out below the crawler and pushed in sideways or
up off the unit frames, minimap, hotbar and a phone's buttons (compact under 520 px tall).
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
the rest of the swing, which lasts `SCYTHE_SWING_SECONDS` in all.
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
  (`worldTrail` in `src/ui/world/worldTrail.ts`), the next two waypoints and the pasture in the quieter
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
  `MIDGE_ESCORT_HP` are tuned by playtest. They come up one after
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
  `brace_for_the_horde` takes over from the zone music, from its loop point past the
  intro (`skipIntro`), while any ambusher lives on the escort, handed back the moment she is delivered. `verify:midge-escort` walks the road
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
  `MidgeEscortCarry` (`src/core/quests/midgeEscortCarry.ts`), handed by reference from scene to
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
- The Anchor's wood pile (Lori's cottage) gives its boards to whichever crawler walks
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

**The HUD.** `QuestCounterHud` shows "N/10 fence sections" in `build_fence` and "N/100
grain" in `harvest_grain` as a card in the HUD's top band (`questCounterEntry`), stacked
with the resource strip and any fight bars by the band's own priorities.

**Sound.** Every play site raises a cue from `BLUEPRINTS_CUES`
(`blueprintsSoundCues.ts`), never a raw id; each cue's JSDoc names the recording it
waits for, and until it lands the cue borrows the nearest existing sound or is an empty
list and stays silent. Every id a cue names must be preloaded in the `briarHollow` or
`universal` SFX group, which `verify:borrowed-blueprints` checks.

### Construction contracts

Wendell's repeatable jobs, opened by finishing The Borrowed Blueprints
(`contractsUnlocked`: `blueprints.phase === 'complete'`; the reward screen's unlock card
"Construction contracts from Wendell" is in `blueprintsRewardSpec`). Each contract sends the
party to one building in Taloncrest or Briar Hollow with 4–6 marked spots to repair or
rebuild. When every spot is done the building's contact pays out, and Wendell sends a note
asking them back. One contract is active at a time. Nothing in the world stays broken
between contracts: damage and build sites exist only while their contract does.

Code lives in `src/systems/constructionContracts/`; the Journal id and quest id is
`construction_contract` (`CONSTRUCTION_CONTRACT_QUEST_ID`). There is no `QuestManager`.

**State.** `BriarHollowState.contracts` (`ConstructionContractsState`,
`src/core/quests/briarHollowState.ts`): `introSeen`, `contractsIssued`, `contractsCompleted`,
`active` (`ActiveContract`: a `ContractSiteKey`, `spotIds`, a parallel `spotsDone`),
`lastSiteKey` and `lastSpotSetBySite`. "Ready to collect" is derived (`isContractReady`),
never stored. The parser defaults the whole record for a save without it, and drops any
saved site or spot id the catalogue no longer has; an active contract left with no spots
reads as none, and Wendell re-offers.

**The catalogue** (`contractCatalog.ts`, pure data). `CONTRACT_SITES` holds every
enterable building in both towns, 13 in Taloncrest and 15 in Briar Hollow, except
`CONTRACT_EXCLUDED_TOWN_BUILDINGS` (Town Center Tower, The Cloak & Dagger, Plumbline Farm),
which the `ContractTownBuildingId` type rules out at compile time. Each site is keyed by
its building id (`ContractSiteBuildingId`, unique across both towns), and has a contact (a `ResidentId` in Taloncrest, a `VillagerId`
in Briar Hollow; the name is read from the contact's own record by `contractContactName`)
and a pool of `ContractSpotDef`s: `kind`, `label`, `cost` in `wood_board` / `rope` /
`stone`, `material` (`wood`, `stone`, `rope`, `plaster`; picks the art and the sounds) and
a `target`. Spot kinds:

- `repair` draws a damage overlay over something that still draws and still blocks: a
  prop, a floor rect, a wall run, a doorway or an open side.
- `rebuild` hides a prop and draws a stripped build site in its footprint, which stays
  blocked; finishing the spot brings the prop back.

The catalogue holds no coordinates. A prop spot names the placed prop whose explicit id is
`contract:<building id>:<spot>` (`contractPropId`, `src/map/contractAreas.ts`): Taloncrest
layouts give it through `contractTarget` / `contractTargetId(buildingId, spot)` in
`src/map/town/interiors/*`, Briar
Hollow's `PropTemplate`s through `contractSpotId` in `briarHollowLayout.ts`. An area spot
names a `ContractArea` (`floor`, `wall`, `doorway`, `open_side`) exported beside the
layout: each Taloncrest interior's `build<Building>ContractAreas(w, h)`, gathered in
`INTERIOR_CONTRACT_AREAS_BY_BUILDING` (`src/map/town/interiors/index.ts`; the General Store's
`buildGeneralStoreContractAreas` is looked up by kind), in the interior's own grid; and
`BRIAR_HOLLOW_CONTRACT_AREAS`, relative to the building rect's north-west corner (an area
may lie just outside it, as the quarry hut's step does). `contractTargets.ts`
(`taloncrestSpotFootprint`, `briarHollowSpotFootprint`) resolves both against the built map.

Rules for picking targets, to keep when tuning a pool:

- **One spot per target.** No two spots share a prop, rect or wall run.
- **Never a quest or encounter piece:** Merrit's `scythe_pegs`; the sawmill's
  `sawmill_machine` and `rope_walk` (they have quest upgrade variants); Blackwood Lodge's
  `cellar_trapdoor` and `kessler_footlocker`; the Sunken Stump's `bolted_door`; Old
  Lori's raw `TABLE` / `CHAIR` / `BOOKSHELF` tiles (`LORI_REPAIRABLE_TYPES`, the
  anchor-quest wreck); the Inn's safe-room counters and Dave.
- **Temple floor spots never touch `RUG` tiles**: `AnchorInteriorSystem.naveSpawnAnchors`
  scans for them to spread the vermin down the nave.
- **Wall runs sit where the wall face shows**: the north wall's face in Taloncrest; in
  Briar Hollow the full-height north wall plus the cut-down south, east and west walls.
  Wall runs stay off corner posts and doorways; floor rects stay off furniture, rugs and
  threshold tiles.
- **Every spot is workable from walkable floor.** Some tile the party can walk to from the
  way in must sit within `CONTRACT_REACH_TILES` of the spot's footprint (`tilesToFootprint`,
  the work channel's own measure, from a tile's centre). Movement collides one axis at a
  time, so the walk is orthogonal and never squeezes between two blocked corners. A wall
  run behind wall-to-wall furniture is out of reach from the row in front of it (two
  tiles), so the Taloncrest rooms leave a bare north-wall tile beside each wall spot
  (Blackwood Lodge, the General Store, Herb & Remedy, the Horned Flagon, Old Lori's,
  the Sunken Stump, the Quiet Needle), and the Cartwright's wall spot is the foot of the
  timber bay's partition. Villagers and occupants never block the party (movement tests
  map tiles only), so a contact pinned indoors cannot wall off a spot.

**The generator** (`contractGenerator.ts`). A contract is a 4–6 spot subset
(`CONTRACT_MIN_SPOTS`, `CONTRACT_MAX_SPOTS`) of one site's pool whose totals land in every
band of `CONTRACT_MATERIAL_BANDS`: 15–20 boards, 3–5 rope, 15–25 stone. `validSpotSets`
enumerates every such subset (pools are small); every pool must offer at least
`CONTRACT_MIN_DISTINCT_SETS` (8). `pickContract` picks a site uniformly from the eligible
ones, never `lastSiteKey`, then a set uniformly from that site's, never its last
(`lastSpotSetBySite`). The draw comes from `contractRng(worldSeed, contractsIssued)`, a
stream of its own salted off the world seed, so a save reproduces its next contract and a
headless check is deterministic; never `Math.random` or a shared stream. The payout is
always derived, `contractPayout` = `CONTRACT_COINS_PER_MATERIAL` (7) × every board, rope
and stone in the contract, never stored. `issueContract`, `completeContract` (clears
`active` before anything else, so a re-entrant settle pays nothing) and `dropContract`
(recorded like a finished one, so the next offer is a different building) are the only
writers.

**Eligibility and story ownership** (`contractEligibility.ts`, read through
`buildContractWorld` in `contractQuest.ts`). `contractSiteEligible` is asked only when a
contract is issued; a contract already held waits out whatever blocks it.
`contractSiteOwnedByStory` defers to `interiorRoomOwnedByStory`
(`src/systems/interiorStoryOwnership.ts`), the same rule `BuildingInteriorScene` uses to
decide who stands in a room: the Temple while the anchor quest's vermin are loose. Every Briar Hollow site is owned while
`isVillageUnderSiege`. Old Lori's Cottage is eligible only once `lorisWreckMended`. No
contact is ever written out of the world by a story flag, so a contact is absent only when
their room is owned. While a held contract's site is owned its spots go inert, its contact
does not pay, the guide stands down, and the Journal hint reads "Wait out the siege." or
"Come back once things settle down."

**Wendell** (`WendellContractsHook`, `BuildingInteriorScene`'s resident quest hook after
`WendellBlueprintsHook`, which returns false once the quest is `complete`). Once contracts
are unlocked it takes every talk with him; lines are in
`src/dialog/scripts/wendellContracts.ts` (`WENDELL_CONTRACTS`). His `!` shows while
contracts are unlocked and none is held. Branches, first match wins:

| State           | Opens with                             | Ending                                                                                                                          |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `!introSeen`    | the intro                              | confirm: "I'll take a contract" (keyboard default) issues one, or names the held one; "Not right now" closes; both set the flag |
| none held       | `reOffer` (none issued yet) or `idle`  | Take another contract (Space default) · Rest in the hayloft · Chat · Leave                                                      |
| held, not ready | the site and its remaining spot labels | Take another contract · Drop this contract · Rest in the hayloft · Chat · Leave                                                 |
| held, ready     | go and see the contact                 | the same, without Drop                                                                                                          |

"Take another contract" issues on one press with none held and plays the issue line (site,
contact and `formatCost` of the bill) in the same box, then emits `questStarted` (the
Journal pins it) and plays `contractSigned`. With a contract held it says to finish or
drop it first (or to collect, when ready). Drop is never the keyboard default and asks to
confirm; spent materials stay spent. When no site is eligible he says so and issues
nothing. The hayloft row opens his rest service (`openWendellHayloft`); Chat plays his
ordinary resident line.

**Work orders on the notice boards.** Both notice boards, the Market Plaza's and Briar
Hollow's (beside the village square, read through `BriarHollowKit`'s Space chain after the
village services and yielding to a nearer villager), post Wendell's work order. Its text
comes from `workOrderStateFor` (`contractIssue.ts`): `locked` before the unlock (tone
`upcoming`, shown as SOON), `open` with none held, `held` with the remaining spots, `ready`
when the contact owes the pay. While it is `open`, `DungeonScene.workOrderAction` puts a
"Tear off a work order" button on the board's footer beside Close; Close stays the
keyboard default, so taking a job is a deliberate press. Taking one issues through
`issueNextContract`, the same call Wendell makes, from the same `gameMap.worldSeed` stream
the interior receives as `circus.worldSeed`, so the two sources never diverge. It reads the
strip aloud (`WORK_ORDERS`, `src/dialog/scripts/workOrders.ts`), emits `questStarted`,
plays `contractSigned` and sets `introSeen`, so Wendell skips a pitch he could no longer
honour. A held contract can still only be dropped at Wendell's. Briar Hollow's board adds a
"TO ARMS" posting during the siege (`buildVillageNotices`).

**Working a spot** (`ContractSiteWork`, shared by both scenes, on the `WorkChannel`).
Reach is `CONTRACT_REACH_TILES` (1.5) to the nearest tile of the spot's whole footprint.
Every unfinished spot wears the shared area highlight (`AreaHighlight`, as the Blueprints
station upgrades use it): the ground outline under every body, plus corner brackets over
every body for standing spots (props and walls), gold `ready` while the spot could be worked
and orange `pending` while it would refuse (materials short, or the siege). The spot a press
would work also gets the pulsing reach glow, and the spot in reach shows its label and cost
row. Space or a tap on the footprint starts the channel: `CONTRACT_SPOT_BASE_SECONDS` +
`CONTRACT_SECONDS_PER_MATERIAL` × the spot's materials, scaled by the builder's
Construction level; the human loops `REPAIR_ROWS`. A short party is told
`CONTRACT_SHORT_MESSAGE` ("Not enough materials."), and a spot that would only refuse
steps aside for any competing press target (a person, a machine). Nothing is spent on
accept: the finish re-counts and `spend`s the spot's cost all or nothing, marks it done,
floats "Repaired" / "Rebuilt", and grants Construction XP (`CONTRACT_XP_PER_MATERIAL` per
material). The last spot toasts "<site> is done. See <contact>." The top band shows
"Repairs N/M" (`contractCounterEntry`) in both scenes while spots remain.

- **Taloncrest:** `ContractInteriorSite.forBuilding` in `BuildingInteriorScene`, only
  on the ground floor of the building holding the active contract and never while an
  encounter owns the room. Its Space handling runs before examine/search/use, a nearer
  occupant still wins the talk, and taps arrive through `handleWorldPointer`. Rebuild
  props are filtered out of the room's prop draw lists (`hiddenProps`), and
  `TownInteriorPropDestructionSystem.protectedIds` keeps every targeted prop standing.
- **Briar Hollow:** `ConstructionContractSystem`, owned by `BriarHollowKit` after
  `BlueprintsQuestSystem` and routed through the kit's `tryInteract` / `handleTap`. Under
  siege every spot refuses with `CONTRACT_SIEGE_LINE` ("Not while the village is under
  siege."). Rebuild props are held out of the Y-sorted pass through
  `GameMap.hiddenDecorationTiles` (the tile is never edited), and overlays are a dynamic
  layer, never baked into a chunk cache.

**Payout** (`ContractSettlement`). The contact wears the green `?` while the contract is
ready: `ContractContactHook` indoors, and `ConstructionContractSystem` as a
`QuestLineProvider` in the village (withheld under siege). Both go **first**: the hook
heads `BuildingInteriorScene`'s resident hook list and the provider registers with
`addQuestLineProvider(this, { first: true })`. They answer only while a payment is owed,
so they never talk over anything else; behind the others, the Anchor's terms for Aviel or
Lori and the Mayor's lines after the Plea would take every talk and the payment could
never be made. A press in reach of a client owed a payment reaches them ahead of a shop
counter or safe room indoors and of the recruiter or a nearer soldier in the village, but
never ahead of a nearer sawmill machine or a cut in progress. Their thanks
(`src/dialog/scripts/contractThanks.ts`, two lines per contact in their own voice, typed
against every contact id) names the amount; closing or dismissing it pays. `settle` pays
the talker `earnCoins`, flies the coins to the HUD, plays `payout` and `payoutFanfare`,
and emits `questCompleted`. No `QuestRewardScreen`: a repeatable job stays quick. Wendell's
follow-up (`wendellFollowUp`, rotating lines naming the building) opens once the
conversation box is free, as a non-halting, unanchored box under his name, with the
`wendellNote` cue. His `!` and the Journal's "available" row return as soon as the
contract is settled.

**The contact stays home** (`contractContactPin.ts`). While a Briar Hollow contract is
held, worked or ready, its contact waits inside the building instead of living their
routine: `contractContactPin` picks the building's occupant anchor, or the interior tile
nearest it that is standable and not another villager's post. Tiers, first that yields a
tile: off every spot's footprint and off any tile that would take the press from every
place some spot can be worked from (within `VILLAGER_TALK_RANGE_TILES` and nearer than the
spot); off every footprint; then both again with floor patches allowed (the quarry hut's
`floor` spot covers the whole room). Independently, `BriarHollowKit.competingTiles`
leaves the pinned contact out of the press competition until the contract is ready, so
Space beside a spot always works it; once ready the contact competes again and Space
beside them opens the payout. Merrit is held in whichever of the farmhouse or the barn the contract is at. A civilian's pin is
`Villager.pin`, and `Villager.station` (the pin, else the post) is where `VillagerSystem`
sends them home, after a talk, a shop, or the siege; a pinned villager never strolls, and
plays idle rather than their work loop when the pin is not their own post. Sedge, the
guardhouse's contact, gets a `stand` duty on his pin in place of his wall beat from
`SoldierSystem.dutyFor`; a standing order (follow, hold, patrol) still outranks it, and
"Return to your post" sends him to the guardhouse. Nothing is stored: both systems
re-derive the pin from `contracts.active` and the Plea's phase, so a payout, a drop, a
load or a rewind releases or restores it, and a rebuilt scene places the contact on it at
once (a live change walks them). The siege wins: under siege there is no pin, villagers
shelter and the militia man the walls, and the pin returns when it ends. No story script
moves a villager (Midge in the escort is a cow), so nothing else contends for the contact.

**Journal and guidance.** `ConstructionContractSystem` is the `TrackerSource` (after the
Plea and the Blueprints in `BriarHollowKit.trackerEntries`); indoors the row arrives
through `InteriorJournalSource`. There is no indoor arrow; the spot highlights do that job.
Plumbline Farm's door carries `litOnlyWhenPinned`: no beam while the idle row is merely on
offer (Wendell wears his own `!` and glow indoors), a beam once the player pins it; the
minimap `!` shows either way. Because the offer reuses the contract's tracker id, both
scenes call `releaseContractAutoPinOnEnd` (`contractQuest.ts`): on `questCompleted` (payout)
or `questAbandoned` (Wendell's drop) for the contract, an `auto` pin is cleared; a `player`
pin survives and keeps lighting the door. A village site's doorway target turns `wearsOwnMarker` while
the active crawler stands inside the building's rect, so the pinned beam goes and the
spots' highlights take over; the minimap pip stays. `objectiveBeamTargets`
(`questTracker.ts`) is the one beam selection the scene and the gate both call.

| State   | Status      | Objective                                                   | Hint                                                     | Target                                                    |
| ------- | ----------- | ----------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| locked  | (no row)    |                                                             |                                                          |                                                           |
| idle    | `available` | Take a construction contract from Wendell or a notice board | notice boards in both towns carry his work orders        | Plumbline Farm's door                                     |
| working | `active`    | Repairs at <site>: N/M done                                 | unfinished spots with their costs, then "Still short: …" | the town door, or the tile outside a village doorway      |
| ready   | `active`    | Collect payment from <contact>                              | —                                                        | the town door, or the village contact (`characterTarget`) |

For the forge, sawmill and barn the village target is the middle of the open side. The
village guide falls back to `ConstructionContractSystem.guidance()` after the Plea and the
Blueprints: `shortfallGuidance` while the party is short of the remaining bill, else the
site; null while the site is story-owned or the contract is ready.

**Sound.** Every play site raises a cue from `CONTRACT_CUES` (`src/audio/contractSoundCues.ts`);
`contractMaterialCues` (`contractMaterialSounds.ts`) picks a spot's work loop, start and finish. Cues that wait on a
recording name it in their JSDoc and borrow a stand-in or stay silent. The ids preload through the `constructionContracts`
SFX group, which both the floor-3 overworld and every interior load.

**Art** (`src/sprites/art/constructionContracts/`, runtime-painted, nothing baked).
`contractDamageArt.ts` has one painter per material for each target shape (props; floors
as a low-contrast tonal read; walls on the visible face, darkening into the cap's shadow;
doorways and open sides with a broken member across), clipped to the footprint and seeded
per spot. `contractBuildSiteArt.ts` draws the rebuild site (chalk outline, a stack of the
material, loose nails). `contractPalette.ts` resolves each settlement's ramps from the art
it sits on; `contractEffectsArt.ts` draws the reach glow (on the spot in reach only) and the finish puff and sheen.
`contractArtCache.ts` caches per spot and `releaseContractArt` drops it all. Damage on
walls and standing props sorts with what it marks, so Briar Hollow's full-height north
wall covers it the way it covers the prop.

### Persistence

Village state is split by who owns it:

| What                                                                    | Where                                                                     | Scope         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| Quest phase, structures, soldier orders, merchant stock, once-flags     | `BriarHollowState` → `PersistedWorldState` / `WorldCheckpoint`            | per floor     |
| Tool tiers, explainers seen                                             | `PartyCraftsState` → `GameProgress.crafts` / `LevelCheckpoint`            | party         |
| Resourcing and Construction levels and XP                               | `Player.craftSkills` → `PlayerSnapshot`                                   | per crawler   |
| Harvest-node capacity and regrowth                                      | threaded `BriarHollowState`, checkpointed by `GatheringKit`, not saved    | page lifetime |
| Villager memory                                                         | threaded `BriarHollowState`, neither checkpointed nor saved               | page lifetime |
| The Borrowed Blueprints: phase, fence sections, grain, stations         | `BriarHollowState.blueprints` → `PersistedWorldState` / `WorldCheckpoint` | per floor     |
| Construction contracts: the active contract, counts, last site and sets | `BriarHollowState.contracts` → `PersistedWorldState` / `WorldCheckpoint`  | per floor     |
| Midge's place and health mid-escort, ambush waves sprung                | `MidgeEscortCarry`, handed scene to scene, never saved or checkpointed    | door visits   |
| Grain stands cut                                                        | `GrainHarvest`, not saved                                                 | scene         |
| Session harvest tallies, thrall cooldowns                               | module state                                                              | page lifetime |

`BriarHollowState` is threaded by reference through `DungeonScene` and
`BuildingInteriorScene`, like `TownMemory`, because both scenes are rebuilt on every
door visit; systems read from it and never hold their own copy.

**`imminent` and `assault` are never persisted.** `captureBriarHollowState`, which both
the save and the checkpoint go through, records a siege under way as `fortifying` with
the bell at full health (and `parse` reads a stray siege phase the same way). A death or
a reload during the siege therefore rewinds to before it, and no half-fought wave can be
resumed — a death always returns to the last save, and the last save cannot have been
taken mid-wave. Nothing in the village saves during a siege, so a death also loses
anything built or damaged since the party last saved.

### Harnesses

- `?townmap` cycles town → whole world → Briar Hollow (building outlines, the ruins
  disc, district labels).
- `npm run render:briar-hollow` renders the village with the real art, Y-sorted like
  `RenderPipeline`, including three human-at-a-wall probes; `--labels=off` for blind
  review, `--frame=world` for the whole map.
- `npm run render:village-siege` renders siege states (bell struck, cracked, poster).
- `?playtest=briar-hollow-kit`, `briar-hollow-village`, `briar-hollow-builders`,
  `briar-hollow-siege` and `briar-hollow-assault` are playtest presets; the `!village`
  chat cheat warps the party inside the gate. `briar-hollow-assault` starts with the
  questline at `fortifying`, the whole ring at a tier and loaded trebuchets inside it:
  `npm run playtest -- briar-hollow-assault --walls=fence|wood|stone|fortified
--trebuchets=N` (walls also take 1–4).
- `?playtest=blueprints-offer`, `blueprints-fence`, `blueprints-harvest`,
  `blueprints-escort`, `blueprints-show-fenna` and `blueprints-stations` place the party
  at each step of The Borrowed Blueprints with what that step needs: the Plea won and
  Construction learned; the boards for the fence; the scythe in hand; Midge waiting at
  Merrit's gate; the blueprints fresh from Wendell, for Fenna's briefing; the blueprints
  in hand with the materials for both upgrades. The village state is seeded
  before the scene is built (`blueprintsPlaytestState`), so the herd is raised knowing
  whether Midge has left it.
- `?playtest=contracts` stands the party outside Plumbline Farm with The Borrowed
  Blueprints finished, so Wendell offers construction contracts, and 40 boards, 10 rope
  and 50 stone to work one. The Plea is complete and the human's hotbar key 7 holds the
  Wayfinder's Anchor (his treadmills moved to the bag), so the stone travels to Briar
  Hollow. `contracts-last-spot` adds a contract already issued at the
  Mayor's Hall with every spot done but one, the party on the hall's threshold; both
  seed the village state before the scene is built (`contractsPlaytestState`).
- `npm run render:construction-contracts` renders every material's damage on every target
  kind, a rebuild site per material, the reach glow and the finish puff, then every spot
  of one Taloncrest and one Briar Hollow pool, highlights included, on the real room (`--taloncrest=<buildingId>`,
  `--briar_hollow=<buildingId>`), each at 1x, 1x zoomed and 2x.
- `npm run verify:construction-contracts` is the contracts' headless gate: every catalogue
  target resolves in its built layout and no two spots share one, no excluded building
  appears, every pool offers `CONTRACT_MIN_DISTINCT_SETS`, the generator stays in the
  bands with payout 7 × materials and no back-to-back site or set, save round-trip and
  old-save parsing, and an issue-work-payout flow through the real finish path. Its
  reachability pass floods the walkable tiles of every site (Taloncrest rooms from their
  spawn and exit tiles, Briar Hollow from the main gate, every prop spot's footprint
  blocked) on four world seeds and names every spot of every pool no reached tile can
  work; a negative check walls one spot in and proves it is named.
- `npm run verify:borrowed-blueprints` is the quest's headless gate: the phase order and
  every transition, persistence (a save missing or malforming `blueprints` is refused), provider
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

The circus is a disc of `CIRCUS_RADIUS_TILES` (14) about 70–90 tiles from the map
centre, sited after Briar Hollow and clear of it. The grounds are authored, not
scattered. They field no enemies: the generator's floor spawns keep off them
(`RUINS_CIRCUS_BUFFER`), and nothing spawns there of its own. The party's first step
onto them binds the Wayfinder's Anchor to the circus (`recordCircusGroundsVisit`,
`TownMemory.visitedPlaces`).

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
picks paint variants: litter, which pennant is torn.

### Layout

- **Fixed:** the 12 × 5 Starlight Tent stands north of the centre with its two-tile door
  facing south on the centre row, because the interior is entered from the south. Its
  plan is an ellipse, so the rectangle's four corner tiles stay walkable. The three
  3 × 2 side-show pavilions stand north-west, north-east and north, behind the door
  line, which leaves the south field open. The north pavilion's board bills the
  Amazing Tightrope Twins (`pavilion_tightrope`); the Starlight Tent's marquee reads STARLIGHT TENT.
- **The approach road** (`circusApproachCentreLine`) starts on the doorstep, runs out
  along the forecourt row and on to the nearest town gate at any angle. A road that
  must leave northward first runs along the forecourt to a flank column
  (`CIRCUS_ROAD_FLANK_COLUMNS`) between the Starlight Tent and a pavilion, so it always
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
- **Keep-clear bands** (`CIRCUS_KEEP_CLEAR_BANDS`): the forecourt, and the door plus
  two rows. The road is kept clear by measuring the road itself.
- **Forest keep-out:** the generator adds a disc of radius + `CIRCUS_FOREST_CLEARANCE_TILES`
  (3) to the `KeepOut` handed to `paintForests`, because the rim props stand half a tile
  past the rim and a canopy climbs two tiles up the screen.

### The rim rule

Anything that blocks goes on the rim. The open field gets decals only.

- The six flame lamps sit at r13 on fixed bearings (`CIRCUS_TORCH_BEARINGS_DEG`). The
  wagons, booths, high striker and crate stack (`CIRCUS_RIM_PROPS`) take a fixed bearing
  or a fixed turn beside the arch (the ticket booth greets whoever comes up the road).
- Every tile of a rim footprint lies in **r12–r14.5**. The outermost fit wins, and the
  resolver walks `CIRCUS_RIM_BEARING_NUDGES_DEG` round the ring when a bearing is taken.
- A rim tile must be on the map, unpaved, outside every keep-clear band, not touching
  another structure and more than 2 tiles (Chebyshev) from an arch post. `leavesRimConnected` refuses a prop that would
  seal a pocket or cut the rim path.
- A prop with no legal footprint on its arc is left out, never jammed in.

### Tile types and registries

| Type                    | Walkable | Sight     | Drawn by                                              |
| ----------------------- | -------- | --------- | ----------------------------------------------------- |
| `CIRCUS_LOT`            | yes      | —         | chunk bake: `circus_lot` ground material + decals     |
| `CIRCUS_STRUCTURE_TALL` | no       | blocks    | Y-sorted pass: Starlight Tent, pavilions, crate stack |
| `CIRCUS_STRUCTURE_LOW`  | no       | seen past | Y-sorted pass: arch posts, lamps, wagons, booths      |

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
- the minimap colours in `minimapTileColor` (`src/ui/theme/minimapColors.ts`) and the
  town map's `TOWN_MAP_INK.tiles` (`src/ui/theme/townMapInk.ts`, read by `TownMapScene.ts`).

They are deliberately **absent** from `GROUND_OCCLUDER_TYPES`: a tent is round and
paints its own contact shadow, and a band along its rectangle draws a dark box on the
lot. `CIRCUS_LOT` is absent from `NON_WALKABLE_TILE_TYPES`, since it is the ground the
party walks. `gates:circus-art` checks the registry membership.

### The art

The circus sheet family is six `PropSheetPlan`s (`circusSheets.ts`): one sheet per
footprint envelope, one row per structure, one frame per variant. A structure's frame is
exactly as wide as its footprint and anchored on its drawing tile, with headroom above.
The family is registered in `environmentSheets.ts` with the level-3 wilderness group,
**unseeded**, so a tent survives the stairs. Structure seeds hash the structure id, not
the row, so adding a structure re-rolls nothing else.

The painters are on the town vocabulary ([One art vocabulary](#one-art-vocabulary)) with
their own ramps, `CIRCUS_RAMPS` / `getCircusRamp` in `townPalette.ts`: dried-blood and
bone stripes, bruise, tarnished brass, slate navy and mildew. A tent is modelled
and then projected: stripe panels run from the eave to a king pole's peak and are warped
onto their quads with `drawPlane`, so they converge instead of reading as striped
wallpaper. Frame contract: ink stays inside the blocked columns and no lower than each
column's lowest blocked tile, except over a doorway and for soft shadow.

### Overhead dressing and decals

Bunting and festoon strings (`CIRCUS_BUNTING_SPANS`, `CIRCUS_FESTOON_SPANS`, tied to
king poles, pavilion peaks and lamps by name), pennants, balloons and the marionette are
overhead: they block nothing and are not tiles.

Decals (`circusDecalTiles.ts`) are the chalk ring, sawdust trodden out of the doors,
wagon ruts, litter, clown shoe prints and a stain by the cage wagon. Each decal is one shape in map tiles, compiled once per site.
Every tile draws the shapes crossing it, clipped to itself, so there are no seams and no
tile reads its neighbours. They stay low-contrast and sparse, because every telegraph is
read against the lot.

### Live ambience

`CircusGroundsAmbience` draws the moving parts over the baked frames: lamp fires, strings
stirring, the festoon bulbs, the marquee bulbs, the door's warm light, the marionette,
balloons and the caravan's curtain. Every bulb on the grounds is lit. Baked rows would
cost a full frame per cell. Each piece is a pure function of the clock, so a checkpoint
has nothing to capture. Positions come from the shared anchors (`circusOverlayAnchors.ts`, the
marquee bulbs and door mouth in `circusArt.ts`, the king poles and arch height in the
layout), so the painted and live halves cannot drift apart.

- `renderEntities()` joins the scene's Y-sorted entity pass.
- `renderGround()` draws the **door spill**. `RenderPipeline` calls it straight after
  `gameMap.renderCanvas`, before gore and every telegraph: the spill is additive and
  would wash out anything beneath it.
- `renderAbove()` draws the loose balloon over everything.

### Gates

- `npm run verify:circus-grounds` sweeps generated floors and holds several budgets:
  - blocked tiles in the r14 disc, a ratchet baseline (`BLOCKED_TILES_BASELINE`) under a
    fixed `BLOCKED_TILES_CEILING` of 95, which the baseline may never pass;
  - zero blocked tiles in every keep-clear band and the road, and zero sealed rim
    pockets: every walkable tile, the door included, reaches the forecourt;
  - rim props in the band, off the road and highways, clear of the arch, each stood on
    at least 75% of seeds.

  `--fault=` forecourt-solid, blocked-count, pocket, rim-prop, rim-arch or highway-prop
  must each turn it red. `--measure` prints every
  reading.

- `npm run gates:circus-art` checks the frame contract and the footprint ink, canvas
  convergence, the texture band against the lot, the registries, the arch and marionette
  surfaces, and a 6 MB sheet budget. Faults: wide-prop, flat-canvas, sheet-budget,
  loose-crossbar.
- `npm run render:circus-grounds` renders the real floor with both crawlers
  (`--seeds=`, `--time=`, `--label=`) into `preview/`.
- Dev: `?level=level3&spawn=circus`, the `starlight-tent` playtest preset.

---

## The Starlight Tent

The tent's interior is a `BuildingInteriorScene` room, and it is always the three-act
maze run by `StarlightTentMazeSystem` (`src/map/starlightTentMazeLayout.ts`: fire walk, menagerie,
hall of mirrors, the finale ring, and paired curtain rooms between acts). The door is
open from the start. The acts cost no health: a crawler caught by a hazard is sent back
to the act's marks. The finale ring is the tent's one fight (see
[The finale ring](#the-finale-ring)). What the tent must remember between performances lives on
`StarlightTentProgress` (`src/core/state/StarlightTentProgress.ts`), which is persisted with the
world state, and its first entry is recorded in `TownMemory.visitedPlaces` (it unlocks
`circus_battle` in the music library).
The maze is built from a `StarlightTentMazePlan` (`planStarlightTentMaze(worldSeed, difficulty)`),
which deals the hall of mirrors its board and writes it into `STARLIGHT_TENT_MAZE_ROWS`
before `GameMap.generateStarlightTentMaze` lays the tiles. Everything else built from the
plan — tiles, floor marks, chunk bake, the lighting mask — is built once from what it
says. `GameMap.generateInterior` calls `setStarlightTentDecorPlan` on every entry. It is module
state, like the wall finish, because nothing between the chunk bake and a tile painter
knows which room is live.

### Shell and floor

- **Walls** use the `'canvas'` finish (`WALL_MATERIAL_BY_BUILDING`). A wall tile
  facing no floor is the dark backstage mass, the `starlight_tent_backstage` material of the
  interior ground sheet, with dim clutter at least `BACKSTAGE_CLUTTER_CLEARANCE_TILES`
  (2) from any floor. A wall facing floor hangs a striped drape (`starlightTentWallFace`).
  **A drape takes the act of the floor it faces, never the wall's own row**, because a
  dividing row belongs to the act below while its face is the south edge of the room
  above. Styles are `firewalk`, `menagerie`, `mirrors` and `ring`; the curtain rooms
  hang the house's `ring` drapes.
- **Floor** is `starlight_tent_sawdust` (`SAWDUST_FLOOR` and `TENT_POLE` both resolve to it).
- **Floor marks** (`starlightTentMazeDecor.ts` data, `starlightTentFloorArt.ts` painters) are baked
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
  the trapeze, the flap cut in the roof where it passes through (painted before the
  mast) and the rope ladder down its south face (painted after it), all from
  `finaleProps.ts`. Its foot and shadow are baked into the floor, and it is in the same
  decoration and overlay-cache registries as the circus structures.

### The finale ring

`StarlightTentFinale` (`src/systems/starlightTent/StarlightTentFinale.ts`) is built once per visit inside the
maze's encounter, from the fixtures `startEncounter` hands it, and carried across a
difficulty restart so the ring never gets a second chest or ladder.

- **Chest:** a wooden chest at `MAZE_RING_CHEST_TILE`, just east of the mast
  (straight north of it the mast would hide it), placed through the interior `ChestKit`
  (`src/systems/kits/ChestKit.ts`) with `ChestPlacer.heldByBand`. It pays every piece whose
  `GEAR_SOURCES` entry is `{ kind: 'starlightTentChest' }` (`starlightTentChestGear`) plus
  the chest kit's floor-3 roll.
- **Guards:** `RING_GUARD_POSTS` (two Tall, two Fat, one Massive Clown) are spawned
  through `spawnMob` under `quest:starlight-tent-maze` the first frame a crawler stands in
  `MAZE_FINAL_CHAMBER` with the finale act on stage, levelled by `questMobLevel` and forced
  aggro. `postChestBand` hands the chest to the guards themselves rather than to an area,
  so the last clown chasing the party out through the curtains still holds it; the chest
  unlocks when the last falls. This is the Massive Clown's only spawn.
- **Claim:** the frame the chest is opened, `StarlightTentProgress.chestClaimed` is set. Every
  later visit places the chest already open and calls no guards.
- **Ladder:** a `rope_ladder` exit fixture (`InteriorExitFixtureSystem`,
  `src/systems/interiorExitFixtures.ts`) at `MAZE_RING_CENTRE_TILE`, always usable.
  Like every exit fixture it asks the door mat's leave question first (the exit menu,
  whose frame warns about a downed hire), then fades out and takes the room's own exit
  to the Starlight Tent door. The two entry flaps stay exits too.
- **Death** in the ring is any interior death: back to the last save.

### Act III: the hall of mirrors

Act III is a light puzzle. The pure model lives in `src/map/starlightTent/`:
`mirrorBoard.ts` holds the board type, the light walk, the solver, the simulated players,
the acceptance contract and the tiers. `mirrorBoardGenerator.ts` builds boards and
`mirrorBoardFallback.ts` holds one committed board per tier. At runtime,
`src/systems/starlightTent/MirrorHall.ts` watches the light, and `StarlightTentMazeSystem` stands the
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
The act card (`STARLIGHT_TENT_ACT_THREE_CARD`) states the rule and the colours, and there is no
hint system.

#### The frame

The board is 36 × 14 tiles (`MIRROR_BOARD_WIDTH`, `MIRROR_BOARD_HEIGHT`) with board
`(0, 0)` on tent tile `MIRROR_BOARD_TENT_ORIGIN` (4, 19), so `boardTileToTent` is one
addition. Its top row is the wall the exit gates are cut into, its twelve floor rows are
`MIRROR_BOARD_ROWS` (tent rows 20–31), and its bottom row is the wall holding each lane's
doorway from the teaching strip (`MAZE_TEACHING_DOORWAYS`). The teaching strip's four
floor rows (`TEACHING_STRIP_ROWS`, tent rows 33–36) sit below that, and
`MIRROR_HALL_ROWS` spans both. `MIRROR_BOARD_DIVIDER_X` is the dividing wall: the human's lane
is west, the cat's east. Each lane walks in at `MIRROR_BOARD_ENTRIES` and leaves by
`MIRROR_BOARD_EXITS`.

`STARLIGHT_TENT_MAZE_ROWS` leaves the hall's floor rows bare. `writeBoardIntoRows` writes each
board's limelights (`P` `Q`), stars (`*`), windows (`|`) and pillars (`o`) in, and
`tentMirrorsOf` stands the mirrors up as `MazeMirrorTarget` props.

#### The pieces

- **Limelights.** One per lane in the lane's outer wall, on a row the generator picks.
  The human's throws **blue** east, the cat's throws **red** west. The span from the lens to
  the first optic is the **hot span**, the hall's only hazard: it burns, and it never
  moves. `boardHotSpan` walks it with every mirror's facing unknown, so no turn can
  change it. `hotSpanProblems` holds it fair. The first optic on each ray is a mirror
  within `FIRST_MIRROR_MAX_TILES` (5) of the lens, the fire stays in its own lane, and it
  never covers an entry or exit tile. The reachable row walks every lane with the hot
  span solid.
- **Pivot mirror** (the human's). One-sided glass that turns a quarter per blow through all
  four facings (`PIVOT_CYCLE`). Light that hits its back stops.
- **Swivel mirror** (the cat's). One-sided glass that snaps between **two** facings, which
  vary per mirror. The art shows the current facing as glass and the other as a ghost
  mark (`drawSwivelMirrorWithGhost`). A mirror's owner is always the lane its tile is
  in.
- **Splitter.** A fixed half-silvered diagonal (`slash` or `backslash`). Light carries
  straight on **and** reflects, from either side. It is the only way one light reaches
  two stars.
- **Window.** A glass tile in the divider. Light passes and crawlers do not.
- **Stars**, set in wall tiles. **Blue** wants the human's light and **red** wants the cat's.
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
  (`starFootTile`) **once per run**. `StarlightTentProgress.encorePaid` records it
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

`planStarlightTentMaze` deals the board when the tent is built, inside the door's loading fade.
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

The board's tier is fixed for the life of a `StarlightTentMazeSystem`: it holds its `plan`
and never reads the live difficulty. `src/core/difficulty/difficultyChangeGuard.ts` holds one guard
at a time (`registerDifficultyChangeGuard` returns a handle, and
`clearDifficultyChangeGuard` with a stale handle is a no-op). `StarlightTentMazeSystem`
registers the guard last in its constructor (`holdDifficulty`). It releases the guard in
`dispose`.

The Settings tab reads `activeDifficultyChangeGuard()` at click time, never when the tab
is built. While a guard is active, picking a different tier opens **Restart the
Starlight Tent?** ("Keep playing", the primary action, or "Change and restart") instead of
applying it. Confirming hands the tier to the guard, which calls `settings.setDifficulty`
and restarts through `restartStarlightTent` (`src/systems/starlightTent/starlightTentRestart.ts`). That
function deals the new plan, closes any open notice, disposes the old maze and its mobs,
rebuilds the map in place with `generateStarlightTentMaze`, raises a new maze and puts the party
back at the flaps in Act I. If the guard was released while the prompt was up, the pick
applies as an ordinary change. `settings.setDifficultyForSession` (dev presets) bypasses
the guard.

### Lighting

`src/systems/starlightTent/starlightTentLighting.ts`: the tent is dark and the act on stage is lit.

- **The mask** is painted once for the whole tent at quarter resolution
  (`STARLIGHT_TENT_MASK_SCALE`), with a padded border so a stretched blit never samples the
  edge. Each act has its own tint of dark (`ACT_DARK`), and every fixture cuts a soft
  pool (`POOL_SPECS`): footlights, arch posts, interval lamps, limelights, act boards,
  hall lamps, marquees and the ring wash. The limelights and marquees move with the
  dealt board, so `layoutLightFixtures(plan)` bakes from the plan, never from the fixed
  floor plan. `lighting.prewarm()` bakes it while the door loads.
- **The house board** lays a feathered translucent fill per band that is not on stage.
  The next act comes up over `LIGHTS_UP_FRAMES` (60) when its curtain rises. The act
  behind dims to `STRUCK_ACT_LEVEL` (0.4), and acts ahead stay dark.
- **Live light** is additive: vent flare, lantern pools, the hall's light, lit stars,
  and spill through an opened curtain.

**The fairness contract.** `StarlightTentMazeSystem.renderWorld` draws in one order:
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

The act props live in `src/sprites/art/starlightTent/`:

- one module per act (`fireWalkProps`, `menagerieProps`, `mirrorHallProps`,
  `curtainProps`, `finaleProps`);
- the hall's puzzle pieces in `mirrorPuzzleProps` (splitters, windows, stars, the
  marquee, the coloured light and the teaching lamps) and its turn preview in
  `turnPreviewProps`;
- the shared hand in `starlightTentPropKit.ts` and `stagePropKit.ts`;
- the shell in `starlightTentShellArt.ts`.

Each is baked once per `(prop, state, frame)` into `starlightTentPropCache.ts`. Frames bake at
device resolution, snapped to a step. The cache is capped at
`STARLIGHT_TENT_PROP_CACHE_BUDGET_BYTES` (6 MB) and evicts least-recently drawn. An animated
prop quantises its motion to at least four frames a cycle. `StarlightTentMazeSystem.dispose`
clears the cache and the reflection scratch when the party leaves. While either crawler
stands in an interval room, `queueNextActWarm` bakes the next act's props one
screen-sized window a frame, so the curtain does not hitch. The draws that change every
frame (fire, opened ways, act gates, lantern warnings, name chips) stay live in
`src/sprites/starlightTentMazeProps.ts`. The hall's moving parts are drawn live over their
baked frames: a red beam's marching dashes, a blue beam's glints, a star's sparks, the
marquee chase and the turn preview's dots.

- **Ownership colours are load-bearing** for the two-crawler split. The cat's props are
  stage red and bone stripes with gilt trim and a gilt hoop. The human's are royal blue
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

Every Starlight Tent play site raises a cue from `src/audio/starlightTentSoundCues.ts`
(`STARLIGHT_TENT_CUES`, `STARLIGHT_TENT_BLOCK_CLEARED_CUES`), never a raw id. A cue is a list of takes
rotated by the system's cue queue. Until each recording lands, a cue either borrows a
stand-in or is an empty list, which is silent.
Each cue's JSDoc names the file it waits for. To swap one in:

1. Register the id in `src/audio/sounds.ts`.
2. Replace the cue's list. The `starlightTent` group in `src/audio/sfxGroups.ts` is built from
   this table, so the new id is preloaded with the tent.

The hall raises `mirrorTurn` per blow, and each settle of the light raises at most one
of each: `starLights`, `starWrongFizzle` (which takes precedence over `starDims`), and
on a solve `starLatch`, `marqueeChase` and `starOpensWay` (`StarlightTentMazeSystem.answerHall`).
`starLights`, `starDims`, `starWrongFizzle` and `marqueeChase` are silent until their
recordings land.

The ambience bed goes in `STREAMING_SOUND_IDS` and `STARLIGHT_TENT_AMBIENT_BED`, which is
`null` until it lands.

### Gates

Each negative test (`--fault=`) must turn its own check red, and every fault asserts
that it was actually applied, so a fault that silently misses cannot pass as green.

- `npm run verify:mirror-board`: the board-level checks (`scripts/starlightTentMirrorBoardChecks.ts`),
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
- `npm run verify:starlight-tent`: timing feasibility at `MAZE_TIMING_MARGIN`, bell solvability,
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
- `npm run gates:starlight-tent-art` measures the real tent through `starlightTentInteriorHarness`:
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

- `npm run render:starlight-tent-interior` renders one frame per act, a curtain room and every
  forced hazard state, at 32 and 64 px, into `preview/starlight-tent-interior/<label>/` with
  `fairness.json`. It also renders the dealt hall for five worlds across the tiers,
  unsolved and solved. `--lighting=lit|fullBright|darkTelegraph`, `--only=`,
  `--label=`.
- `npm run render:starlight-tent` renders the prop contact sheet and smoke-runs every maze draw
  function. It also writes a puzzle-piece sheet in colour and in greyscale
  (`starlight-tent-mirror-puzzle-*.png`), where the shape twin of every colour cue is checked
  by eye.

---

## The sewer

Under the town runs the sewer. The way down is the **storm-drain grate** on the
Civic Terrace, south-east of the tower door (`TownPlan.stormDrainGrate`, a
`STORM_DRAIN_GRATE` tile two wide laid into the terrace flagstone). It is a
hand-built `BuildingEntry` (`taloncrest_storm_drain`, kind `'house'`) added by
`placeStormDrainGrate` in `OverworldGenerator`, after every pass that writes
town ground. `assertStormDrainGrateIsClear` throws if the grate stands off the
terrace flagstone, on the tower base, on the tower door's approach, in or
beside any doorway (`doorwayKeepClearTiles`), or within a tile of a torch. The
art is `src/map/tiles/stormDrainGrateTile.ts`.

**Entry.** `DungeonScene.sealedBuildingMessage` asks `stormDrainRefusal`
(`src/systems/sewer/stormDrainGrate.ts`) with `DungeonScene.stormDrainOpen()`:
the grate is bolted from below until something opens it, and stays open after.
`DungeonScene.sewerIsGuided()` decides whether the cellar elf is down there to
guide the visit; it reaches the interior as `BuildingInteriorWorldContext.sewerGuided`.

**The space.** The interior is the `{ kind: 'sewer', plan }` `InteriorVariant`.
The sewer is a set of named sections (`SewerSectionId`), each an authored
layout in `src/map/sewer/sewerLayouts.ts`, parsed by `parseSewerSection` /
`planSewer` (`sewerPlan.ts`) and built by `GameMap.generateSewer`. The scene
builds one map per section and keeps them as it keeps a tower's storeys, so a
culvert between sections is a storey change. Sections join by connections:
`street_grate` (the ladder up, out through the storm drain's own door),
`culvert` (into another section) and `tower_cistern` (straight into the tower
at `TOWER_CISTERN_STOREY`). Only the tower drain is authored; a new section is
a layout plus its connections. Glyphs: `#` brick, `.` walkway, `~` the main
channel at full flow, `=` the spillway, `o` the nest basin, `n` the rat nest,
`@` the ladder, `^` a street grate overhead, `C` the cistern culvert, `P` an
outlet pipe in the wall, `A`, `B`, `D` valves, `r`/`g` fight spawns, `1`–`9` the guide's stops.

**Look.** The sewer is drawn through the dungeon pipeline as the `'sewer'`
`DungeonFloorThemeId` (`src/map/dungeon/sewerMaterials.ts`; walls fade into
black like floors 1 and 2). Its materials (`sewer_brick`, `sewer_walkway`,
`sewer_channel`) are the last rows of the `ground_interior` sheet, so they are
indoor-only art in level 3's `interiorSpriteGroups`. `GeneratedFloorThemeId`
keeps any level from declaring itself a sewer. Lighting is
`SewerLighting` (`src/systems/sewer/sewerLighting.ts`): a baked mask at the
dark ambient, daylight pools under every street grate, a light cut round
each crawler, and a faint glint breathing on the section's tick clock over
every wheel or sluice that would take a press (the cistern's sluice uses the
same lighting), drawn through `InteriorEncounter.renderDarkness`.

**Play.** `SewerSectionSystem` (`src/systems/sewer/`) runs each section as the
`InteriorEncounter` on its storey. Water is the river model (`GameMap.floodWater`,
`drainWater`): every section is rebuilt on each visit from
`TownMemory.settledSewerWorks`, because map water is never saved. That record
holds sluices lowered, fights won and nests washed out (`SewerWorkId`), never
an outlet pipe's wheels. Nobody walks through sewer water: `syncHolds` reads
the map's own water every tick and holds shut every channel tile that is wet,
at any depth, and every tile the rat nest still chokes, so a drain under way
keeps every body out until its last tile is dry; a body standing where water
arrives is set down on the nearest walkable tile within four tiles
(`FLOOD_RESCUE_SEARCH_TILES`), one with room to move round it where there is one.

Valve wheels are `MashInteraction` presses, and each takes a press only while
turning it would change something. A `lower` wheel (a `SewerSluiceValveDef`)
runs its channel down to a walkable bed for good. An outlet pipe in the wall
(`SewerOutletDef`: the channel it pours into and the depth it fills it to) is
worked by two wheels (`SewerOutletValveDef`): `open_outlet` sets it pouring,
which floods its channel and, held long enough, washes out the section's nest
(`SewerNestDef`, the `n` tiles and the channel that clears them);
`shut_outlet` stops it, and the channel drains. While the nest stands, the
opening wheel is handed back once the channel is dry again, so the pipe can
be opened and shut until the nest is gone; after that the opening wheel stays
spent, since a flood would only shut the way on. A pipe is found shut whenever
the section is built, so a party arriving from either end is never cut off. Fights spawn
through the spawn funnel (`quest:storm-drain`) unless already won.

The cellar elf is a `SewerGuide` (`src/creatures/SewerGuide.ts`): it cannot be
killed, leads from stop to stop in a latched band, and holds at a stop until
its `SewerGuideHold` is met — `work` until a fight is won or a sluice lowered,
`crossable` until every tile of a channel can be walked (run dry, and nothing
left choking it). It says its lines from
`src/dialog/scripts/scenes/sewerGuide.ts`. The cistern culvert is a
`tower_culvert` exit fixture whose destination is a `PartyTransferRequest`;
the floor's `DungeonScene` hands the party from the sewer straight into the
tower (`handOverBetweenInteriors`) behind the tower's own loading screen.
Sounds are `SEWER_CUES`, preloaded as the `stormDrain` group.

**Dev and gates.** `npm run playtest -- sewer` drops a party with a hire
straight down the grate (`devEnterSewerAtStart`). `npm run render:sewer` writes
`preview/missing-cats/sewer/`. `verify:interiors` checks every section's
geometry, `verify:arrival-load -- --env=sewer` and `--env=cistern` the arrival
into the sewer and the hand-over into the tower, and
`verify:environment-sheet-budget` that the sewer's sheet is counted with floor 3.

## Dev routes

Both are localhost-only, registered in `src/game.ts`.

- **`?townmap`** — `TownMapScene`. The whole overworld on one canvas, two framings
  (town / world), scroll to zoom, drag to pan. Overlays building footprints and names,
  door tiles, safe radius, circus radius and start tile, plus
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

- `npm run render:town-interiors -- --only=<name> --probes` renders every room, with the human
  standing at a counter, a table and the door for scale.
- `npm run render:buildings -- --only=<id>` renders the facades.
- `npm run render:residents`, `render:human-cast` and `render:hawkfolk-cast` render the
  cast.
- `npm run render:cast-motion` renders gait and dance; its gates are
  `npm run gates:cast-motion`.
- `npm run verify:plaza-perf` measures the plaza crowd's cache behaviour. It is headless,
  fails only on cache counts, and paces bakes on a simulated clock, so machine load
  cannot change its verdict.

`townMetrics.ts` computes the numbers without a canvas, so
`generateOverworld` + `collectBuildingPlots` + `measureTown` run headlessly under
`npx tsx` — the fastest way to tell whether a layout change moved anything.

Current measurements: 55 × 41 bounding box, 2255 tiles, 33.9% built density, 6 ground
materials in use, 30 distinct outdoor prop types, 40-tile safe radius, 8.3 ms mean frame
time in the plaza. The tower is counted by its base rather than its art — 21 of the
spire's 23 rows overhang the fields north of the wall, and counting them would report a
55 × 40 town as 61 tall.
