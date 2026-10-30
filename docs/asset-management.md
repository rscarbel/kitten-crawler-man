# Asset Management

Sprite pixels and sound buffers are loaded on demand and released on floor change, so
resident memory scales with what a floor can actually show rather than with the total
size of the game. Four pieces make that work, and each imposes an obligation on anyone
adding a creature, a sheet or a sound.

Creatures take no part in any of it. Every character, creature and
creature-owned effect is painted by TypeScript at runtime and cached as bitmap cells —
and so is every piece of environment art: the ground tilesets, the town's
furniture and signage, the wilderness, the props and the building facades. What is
still fetched is a short list of icons, splash images, room dressing and two authored
buildings. See "Creatures are painted, not loaded", "The ground is painted too", "So
are the props" and "Facades are painted in stages".

## Sprite metadata stays eager; only pixels are lazy

`SpriteLoader` builds its derived lookup maps synchronously at import time from the
inlined manifest JSON — blocked-tile offsets, sprite extents, footprints, doorway
detection. Map generation, tile blocking and Y-sorting read those **synchronously,
before any image has loaded**.

`_manifest` and every map derived from it must therefore stay fully eager. Only `_defs`
— the `HTMLImageElement` / `HTMLCanvasElement` entries — is lazy. Any change that makes
manifest metadata conditional breaks map generation intermittently, and the failures do
not point at the cause.

A sprite miss is fail-safe by design: `getSpriteDef` records the miss, schedules that
key's load, and returns `undefined`, so the renderer draws nothing for a frame or two.
That is the same thing a genuinely missing sprite has always done, which is what makes
lazy loading safe here — and why every miss is logged once per key and dumped by the
`!assets` chat command.

## Declared coverage: what a floor can produce

`ASSET_GROUPS` (`src/core/spriteAssets/assetGroups.ts`) names the sheets in each group. Its values
are typed `readonly SpriteKey[]`, not `string[]`, so a renamed or deleted manifest entry
fails `tsc` instead of vanishing at runtime. `LevelDef.spriteGroups` declares what a
floor loads.

**A floor's `LevelDef` does not list everything that can appear on it.** Bounty bosses,
quest creatures, companions and mid-fight summons are constructed by systems gated on a
map feature — a live bounty site, `gameMap.circusCentre`, `gameMap.spiderLabRoom`, a
hired mercenary — and are named in no spawn table. None of the five bounty bosses appears
in `level3.ts`, and they are among the largest sheets in the game.
`SYSTEM_ASSET_REQUIREMENTS` (`src/core/spriteAssets/systemAssetRequirements.ts`) is where those get
declared, one entry per system or per bounty/quest type.

`requiredSpriteKeysForLevel(levelId, spriteGroups)` computes the union of the two. Both
the build-time check and the runtime eviction call it, so "what a floor needs" has
exactly one definition.

## Eviction is keyed on floor identity, not scene construction

`DungeonScene` calls `sceneManager.replace` at four sites, and only one of them is a
floor change: the stairwell's completion callback, which builds the scene for
`levelDef.nextLevelId`. Entering a building interior, leaving one, and the death restart
all rebuild `DungeonScene` around the _same_ floor. Evicting on scene construction would
re-download and re-decode hundreds of megabytes every time the player opened a shop door.
`releaseSpritesExcept` is called once, at the stairs transition, keyed on the new floor's
required keys.

Art a scene bakes for its own map is the exception: it is released when that scene exits,
because no other scene will draw it. `GameMap.releaseTileArt` gives back a map's tile
chunks and overlay entries at once, rather than whenever the browser collects the
canvases. `BuildingInteriorScene.onExit` releases every storey's map, and
`DungeonScene.onExit` releases its map and minimap (`releaseFloorArt`) unless a building
visit holds them. `enterBuilding` is the only writer of that hold
(`floorArtHeldByBuildingVisit`), because the overworld hands its map to the scene rebuilt
at the door (`existingMap`) and any other floor hands it back through
`holdFloorForInterior`. Every other exit abandons the map: the stairs, a respawn, a
restart, the title screen. A defeat indoors that respawns from the save releases the held
map there, since nothing takes it over. The prison's own ground and lighting are released
by `GoblinPrisonSystem.dispose`. `npm run verify:chunk-cache` checks that `releaseTileArt`
returns every chunk.

## Memory follows the party within a floor

The stairs are not the only release. While the party stays on a floor, what each cache
holds follows where the party is and what has been drawn lately, not how much of the
floor it has seen. **The rule for every resident cache:** it gives memory back while the
party stays on a floor, by idle time, by distance or by budget, never only at the stairs;
and anything placed in the world whose art should follow the party registers as a
resident set with `WorldResidency`. On a phone, memory that only grows with how much of a
floor has been seen is what tips the tab into canvas loss.

**Idle release.** Each cache lets go of what nothing has drawn for its window:

- environment sheets: `releaseIdleSheets` in `environmentArtCache.ts`, after
  `RECENTLY_DRAWN_FRAMES` (half a minute) without a lookup or a touch;
- figure rows: the figure cache's idle sweep, after `IDLE_FRAMES_BEFORE_RELEASE`, except
  pinned rows;
- tile chunks: each map's `TileChunkCache` drops a chunk undrawn for
  `CHUNK_IDLE_RELEASE_FRAMES` (half a minute) of that map's own frames, however far below
  `MAX_CACHED_CHUNKS` it is;
- town interior props: their `RecentSurfaceCache` is built with an idle window
  (`PROP_FRAME_IDLE_RELEASE_FRAMES`, half a minute), swept every frame by
  `releaseIdleRecentSurfaces`.

The sheet and prop windows count `idleFrameNumber()` (`src/core/rendering/renderFrameClock.ts`):
render frames, less those spent while something holds the idle clock
(`holdIdleClock`/`releaseIdleClock`, counted, so holds nest). `ArrivalLoader` holds it
while its screen is up, beside `holdFigureIdleSweep`, and `BuildingInteriorScene` holds it
from `onEnter` to `onExit`. Time behind a loading screen or inside a shop is waiting, not
abandonment, so it never ages the floor outside, and furniture is let go only after half a
minute back outdoors. Chunks count their own map's frames, so a map not being drawn ages
nothing. Eviction over a byte budget counts render frames for sheets and
`RecentSurfaceCache` (`renderFrameNumber()`), and the chunk cache's own frames for chunks.

**Distance.** `WorldResidency` (`src/systems/WorldResidency.ts`) decides what stays
resident by distance from the party, for every resident set registered with it. Nothing
in it names a floor, a town or a siege. `DungeonScene` owns one on every floor
(`residency`). It decides every `RESIDENCY_CHECK_INTERVAL_UPDATES` (10) updates, building
the outlook only when a decision is due, and decides at once (`settleNow`) where the
party is set down: on arrival, before the arrival loader measures what is owed, and after
a warp.

- **The outlook** (`ResidencyOutlook`) lists the points the next frames may be drawn
  around: the active crawler, the other one unless knocked out (a switch moves the camera
  to it at once), and a coming warp's landing, flagged `landing` (a recall channel's tile,
  or the death screen's checkpoint respawn, which also sets `covered`). For each entry the
  decision takes `tilesUntilInView`, how far a camera centred on the nearest focus must
  travel before any of the entry's area is in view.
- **The rings** come from each set's own repaint lead. The hold ring is the set's
  `leadSeconds` times `FASTEST_WALK_TILES_PER_SECOND` (Speed Fizz on top of the stall's
  boon); the release ring is that plus its `releaseHysteresisTiles`. Within the hold ring
  an entry is held and anything it is missing is asked for urgently, nearest first. Past
  the release ring it is released. In between it keeps whichever it was, so a party
  standing on the edge does not flip it every few steps.
- **A resident set** implements `ResidentSet<Entry>`: `leadSeconds`,
  `releaseHysteresisTiles`, `entriesStartHeld`, `keyOf`, `placements()` (each entry with a
  tile `area`; placements sharing a key are one entry, as near as its nearest), `hold` and
  `release` (called only on a change), `warm(entry, urgency)` (on every decision:
  `urgent` inside the hold ring, `speculative` outside it, `forgiving` under a warp's
  loading screen), `warmth`, and optionally `hurryWhileCovered`, `hurryWhileApproached`
  and `bakeFor`. `WorldResidency` keeps each key's held or released state. A key no longer
  placed anywhere is released and forgotten at the next decision. What holding, warming
  and releasing mean is the set's business, so cache specifics stay in the set.
- **Warps.** `isWarmAround`, `forgiveAndWarmAround`, `warmthAround` and `bakeFor` run over
  every set. A warp that would land among cold entries goes behind the arrival's loading
  screen (`coverWarpIfLandingCold`), whose "Waking the world" task asks again, forgiving
  what the caches gave up on, for its first `WARP_COVER_FORGIVING_STEPS` frames, splits its
  budget evenly over the sets that bake, and lifts when the landing is warm, when nothing
  missing is still queued, or after `WARP_COVER_MAX_STEPS`.

The sets the game registers:

| Set                                               | Entries and where they are placed                                                                       | Lead / hysteresis | Hold                                        | Release                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `EnvironmentSheetResidentSet`, `FACADE_RING`      | each building's still frame over its art; every other sheet the floor's groups paint over the whole map | 2 s / 10 tiles    | touched each decision, repainted if missing | `releaseEnvironmentSheet`: gone after `RELEASED_GRACE_FRAMES` |
| `EnvironmentSheetResidentSet`, `FACADE_LIFE_RING` | each building's `<facade>_life` row over its art                                                        | 0 s / 3 tiles     | the same                                    | the same                                                      |
| `CrowdResidentSet` (where `TownLifeSystem` runs)  | each look the street crowd and the market's vendors wear, placed at every wearer                        | 5 s / 12 tiles    | pins its `idle` and `walk` rows             | unpins them for the idle sweep                                |

Both kinds of set leave `entriesStartHeld` false: nothing is held until a decision
reaches it. Ground materials and indoor-only sheets are in no set. Chunks touch the
materials they draw, and a room asks for its sheets again behind its loading screen, so
the idle sweep alone is right for them. Sheets placed over the whole map are held for the
whole visit.

**Who releases what.**

- `WorldResidency.releaseAll()`, wherever a `DungeonScene` gives up its world: the
  stairs, an overworld building exit, a respawn from a save, a restart, the title screen.
  The rebuilt scene's first decision takes back what it needs, within the sheets' release
  grace and long before the figure sweep would run.
- The scene that baked a map's tile art, on exit (see above).
- The caches' own idle release and byte budgets, all the time.
- The stairs: `releaseSpritesExcept`, `releaseEnvironmentArt` and
  `flushFigureFrameCache`, which also discard seeded art of a floor that no longer exists.

**Measuring it.** `npm run report:residency` drives the real scenes headless over named
routes per floor (`RESIDENCY_FLOORS` in `scripts/residencyRoutes.ts`): floor 3's `tour`
(the streets and a dozen interiors, then Briar Hollow) and `direct` (straight there), and
the scaled city's `walk` (across a grid of floor-3 towns from `scripts/scaledCity.ts`) and
`arrive` (a cold arrival at its far edge). Each route runs in its own process, and the
report prints each owner's bytes and surfaces at every milestone, as they stand and after
forced collections, plus any scene or map still reachable after the route left it, and the
difference between the pair. `npm run verify:residency` runs `tour` (two interiors) and
`direct`, one after the other, each in its own process, and fails when:

- any owner but `figureCells` holds more than `OWNER_TOLERANCE_MEGABYTES` more after the
  tour, as the tallies stand or after forced collections;
- a figure first drawn indoors (one that gained cells at an interior milestone and that
  the street crowd cannot wear) still holds cells at the village, unless the direct
  route holds it too;
- a scene or map either route left is still reachable after collection;
- either route reads nothing for an owner every route holds (`OWNERS_ALWAYS_HELD`:
  environment sheets, tile chunks, figure cells), or the direct route reads no surfaces at
  all, since every comparison would then pass on zeros;
- the routes end at different milestones, a route does not finish, or a route leaves a
  note (a door that would not open, a frame that threw).

It compares the two routes with each other, never with stored megabytes, and takes about
five minutes. `npm run verify:town-residency` covers the crowd's release.

## Indoor-only art is painted at the door

Some art is only ever drawn inside a floor's buildings. On floor 3 that is
`town_interior`: `ground_interior`, the rooms' floors and walls; `ground_dungeon`, which
the Sleeping Cat Inn's safe-room counter, galley and stove stand on; and the sixteen
`club_*` sheets of the Cloak & Dagger's furniture. Painting it on the floor's arrival
would hold 10.9 MB the street never shows. Such a group is declared in
`LevelDef.interiorSpriteGroups` and never in `spriteGroups`: `verify:assets` fails on a
group listed in both, because there it would be painted on arrival anyway. Nothing on
the floor asks for it; `requiredSpriteKeysForLevel` leaves it out, so the stairs release
it like any art the next floor does not name.

`interiorArt` (`src/scenes/interiorFloorContext.ts`) builds what a room is painted from:
the outdoor groups it shares with the street, plus the floor's indoor-only groups, with
the ground sheets among them. `BuildingInteriorScene` requests all of it before its
`ArrivalLoader` begins, and the loader's first task does not finish while any sheet is
owed. That ordering is the whole guarantee that a room never shows missing art: on a
first visit the sheets are painted behind the card (about a quarter of a second more,
headless, on the first building entered), and on a later visit each one is either still
resident, so the request costs nothing, or was let go by the cache, so it is queued again
and the card waits for it.

Leaving the room does not release them on the spot: a door stepped out of and straight
back into finds them resident. They go idle, and the idle sweep lets them go once nothing
has drawn them for `RECENTLY_DRAWN_FRAMES` of idle frames, which do not pass while the
party is indoors. A later visit's request for a sheet let go answers `owedOnDemand`: its
repaint is queued among the waiting repaints, which the arrival's loading screen counts as
owed (`environmentRepaintsWaiting` in `floorArrivalLoad.ts`), so the card stays up until it
lands. The same holds for a room's furniture: `townInteriorProps` lets its frames go after
half a minute of idle frames back outdoors, and they bake again as the room draws them.

To add another indoor-only set: declare an `AssetGroup` in `ASSET_GROUPS`, list it in
the floor's `interiorSpriteGroups`, and, if its sheets are painted, register their
family in `environmentSheets.ts` under that group. A ground sheet in the group is found
by `groundSheetKeysAmong` and needs no registration. `npm run verify:arrival-load`'s
interior environments (a shop, and the inn for its safe room) fail on any sprite a room
draws unpainted that the floor outside does not hold — a ground sheet included, since a
material falling back to its flat colour is a lookup miss — which is what goes red if a
room stops asking for its group.

## Sound is grouped the same way

Music tracks and ambience beds stream through `MediaElementAudioSourceNode` and are never
decoded into `buffers`. Everything else is a sound effect, preloaded per context from
`SFX_GROUPS` (`src/audio/sfxGroups.ts`): the core group at boot, a floor's groups from
`DungeonScene`'s constructor, an interior's from `BuildingInteriorScene`'s. Ids repeat
across groups on purpose — several bounty cues are stand-ins borrowed from a boss's
sample, so both owners preload them, and `preload` de-dupes against `buffers`.
Scenes preload through their `AudioScope` (`scope.preload(ids)`), which declares the ids;
when a scope is disposed, decoded buffers that no live scope declared are released, except
the `universal` group.

Recordings live under `src/audio/`, one folder per family and then per owner:
`characters/deinonychus/` holds the pet Deinonychus's calls, `effects/caroline/` holds
`caroline_message_chime`, which plays with each of Caroline's message boxes. A recording
belongs to the folder of whoever or whatever makes the sound, never to the floor or the
scene that first played it, so an owner's sounds move together when the owner does.

## Creatures are painted, not loaded

There is no creature sheet on disk. Each figure's art lives in `src/sprites/art/` as a
painter plus a `FigureDef` — cell size, the tile anchor, and one entry per animation
state — and `src/sprites/figure/figureFrameCache.ts` bakes a `(figure, state, frame)`
into an offscreen cell the first time it is asked for and blits it thereafter. The
steady-state cost per draw is the `drawImage` the sheet path already paid; what changes
is that the resident set is the rows actually being played rather than every row a floor
could show.

Four decisions carry that, and each is load-bearing:

- **Rows, not sheets, are the unit of memory.** Admission, eviction and the idle sweep
  all work on one animation row of one figure, because a fight is a walk row and an
  attack row, not a sheet.
- **Cells are shared across instances.** Mobs animate on discrete frame indices, so
  eight wereboars blit the same eight cells; a pack costs what one of it costs. A figure
  whose appearance varies per instance cannot key on `(state, frame)` alone — where the
  variation is a closed set, each variant takes its own `FigureId`. The town's whole
  cast is the case: every citizen wears one of a closed set of human or Hawkfolk looks,
  and a seed only picks which.
- **A refusal paints rather than blanks.** The painter is present at runtime, so a cell
  the byte ceiling or the per-frame millisecond budget will not admit is drawn straight
  into the frame. Full means slower, never invisible. The fallback composes through an
  offscreen surface so a caller's `filter`, `globalAlpha` and shadow apply to a finished
  image exactly as they do to a blit.
- **The bake budget is milliseconds, not cell count.** Cell area spans two orders of
  magnitude across the fleet, so a cell count would let one figure spike a frame and hold
  another back for nothing.

**Cats are a figure per look, bounded by row tier.** Every cat drawn owns a
`CatAppearance` (`src/sprites/catSprite.ts`): her look, her outfit, the figure
`catFigureFor(look, outfit)` memoises for the pair, and her own resident rows. Any number
of cats share the cache at once; what bounds them is the rows each may bake, set by her
`CatRowTier` in `CAT_ROW_TIERS`: `crawler` (every row, only the playable cat), `companion`
(walk, idle, swipe, knocked out and the idle breaks) and `ambient` (idle, walk, sit, the
idle breaks and the bolt). An ambient cat warms only `idle` and `sit` on arrival and her
bolt on her owner's cue (`prewarmCued`), and holds no rows resident beyond the one drawn,
so a room of them costs little more than the cells on screen. Measured at a 1× pixel
ratio, the worst live case (the crawler, a companion and seven ambient cats, each warmed)
is 4.65 MB: 2.14 MB for the crawler, 1.45 MB for the companion and 0.12–0.17 MB per
ambient cat. The budget is bytes, not looks: when it tightens, an ambient tier sheds rows
before any cat is refused.

Cells are baked supersampled and downsampled into place, matching what the deleted
offline generators did, so a cached cell is the sheet cell it replaced.

**A cell is stored as its ink, at the density it is drawn.** Two more decisions keep the
bytes down to what is on screen:

- **Crop to ink.** A cell is sized for the figure's widest pose, so most of any one pose's
  cell is transparent margin. Each baked frame (and each layered frame's front layer) is
  kept as its ink box padded by `CELL_CROP_PADDING_PX` (2) transparent pixels, with where
  it sat in the cell, and blitted back to that place. At one cell pixel per device pixel
  the blit is pixel-identical to the whole cell's at any sub-pixel offset, in Chrome's
  GPU and software canvases alike; one pixel of padding was not enough on the GPU path.
  A frame's crop is only known once painted, so a bake is admitted at the whole cell (twice
  that for a layered frame) and charged its crop. Every byte count — a row's, a figure's,
  the budgets, `figureFrameStoredBytes`, G9b — is the crop's.
- **Bake at the drawn density.** A figure bakes at the device pixels per cell pixel its
  world tile lands at — `SceneManager` reports the render scale through
  `setFigureWorldPixelRatio`, and the world has no zoom of its own — rounded up to one of
  `BAKE_LEVELS` (0.5, 0.75, 1). The level never exceeds the declared cell (1) and never
  goes below the low-end density (0.5); a low-end device (`shouldDownscaleForLowEndDevice`)
  stays at 0.5. A draw that lands denser than the world's level (an over-size boss, a
  portrait) raises its figure for `RAISED_LEVEL_HOLD_FRAMES`, the idle window, so an
  occasional large draw does not rebake it down and back up. At the default view on a
  DPR-2 screen a tile-scale-64 figure bakes its full cell; at render
  scale 1 on that screen (the `performance` preset, or `auto` after a lag rung) it bakes
  at half density, a quarter of the bytes. A harness with no renderer bakes full cells.
- **A level change never flickers.** A row is drawn at one level throughout. When its
  figure's level moves, the row goes on being drawn from its old cells, scaled, while the
  rebake is asked for urgently and baked within the ordinary budgets; the rebaked cells
  replace the old ones together once they hold every frame the old set did. A frame the old
  row lacks meanwhile is baked at the old level, so an animation never alternates soft and
  sharp frames.

**Prewarm is the pack rule.** A painter over roughly 1 ms per cell cannot be absorbed by
the fallback, so every path that schedules such a creature calls `prewarmFigureState`
when the spawn is _scheduled_, not when the mob first renders. Each kind's `prewarm` on its
`MOB_KINDS` entry (`src/levels/mobKinds.ts`) is the backstop: `spawnMob`
(`src/levels/spawnFunnel.ts`) runs it for the look each body wears as the body is built.
A wave scheduler, a boss intro or an attack telegraph that knows a kind is coming before
any body exists warms it earlier: the kind's `warm(tier)` on its `MOB_KINDS` entry runs
its `prewarm` for every look a spawn can wear at that variety tier; its
`approachRows(tier, view)` lists the walk rows and then the opening attack rows a spawn
at that tier walks up to a fight in, facing `view`, for a lead-in to warm in that order;
`prewarmFigureState` warms particular rows. Two things decide
where that hook goes: the lead must exceed
`rows x frames x bake_ms / PREWARM_BAKE_BUDGET_MS`, and it must sit inside the cache's
idle-release window or the warming is thrown away before it is used.

**A speculative prewarm only takes free room.** A request made by something about to
draw the row (`prewarmFigureState(..., urgent = true)`, and a pinned row that went
missing) may evict any row not drawn this frame, as a render-path bake may. Every other
request is a guess, and may only evict a row idle as long as the sweep's own
`IDLE_FRAMES_BEFORE_RELEASE`: otherwise a queue drained while nothing is drawn — behind a
loading screen, after a scene rebuild — reads every row as unused and evicts the party's
own, which the first frames of play then re-bake on the render path.

**A crowd is pinned, not swept.** The ten-second idle window is a false signal for a
strolling crowd: a look worn by one or two citizens can go that long between draws of its
rarer facing. So a crowd look near the party has its `idle` and `walk` rows pinned
(`pinCitizenFigure`), and `talk` is warmed and pinned only while a citizen is frozen into a
conversation (`prewarmAndPinCitizenTalk`, undone by `unpinCitizenTalk` when the
conversation ends).

- A pinned row is exempt from the idle sweep and from eviction.
- A sweep that meets a pinned row must `continue` past it, not stop, or the older
  unpinned rows behind it are never released.
- A pinned row that has gone missing is re-queued urgently the next time it is drawn.

**The pins follow the party, in a city and out of one.** The one owner of crowd pins is
the crowd's resident set (`CrowdResidentSet`), registered with `DungeonScene`'s
`WorldResidency` wherever `TownLifeSystem` is built, over the street crowd and the
market's vendors. Nothing pins or queues a crowd look on construction. A look is held
while any citizen wearing it is within the hold ring, the walk the fastest crawler covers
in `CROWD_REWARM_LEAD_SECONDS` (5), and released once every wearer is past it by
`CROWD_RELEASE_HYSTERESIS_TILES` (12): released, its rows are unpinned
(`unpinCitizenFigure`) and the idle sweep returns them. Inside the hold ring any missing
row is asked for urgently, nearest look first. A look still held just outside it is baked
back speculatively, unless the cache has run short of room overall within
`IDLE_FRAMES_BEFORE_RELEASE` (`figureCacheRoomContested`), when the row would only be
dropped again. A released look is never asked for. A purged recovery's new look is held
by the set's next decision.

Holding by distance is what leaves room for a fight elsewhere: a siege wave at Briar
Hollow is a dozen distinct creatures in several facings, and with the whole crowd pinned
off screen beside the party its rows evicted one another and were painted live every
frame. Measured headless on floor 3, the crowd pins 20.3 MB on arrival in the plaza and
about 13–14 MB at Briar Hollow (13.1 MB in the run in "What scenes hold"), where a few
looks still have wearers within reach of the village. The figure varies by a few megabytes between
runs because it follows where the town's wanderers happen to stand when the party
arrives. A street cast is a closed set of looks, so inside a city most looks have a
wearer within reach of any point, and crowd memory follows distinct looks, not
population.

When looks the cache gave back are owed within the hold ring, the set raises the figure
prewarm to `OWED_REWARM_BUDGET_MS` a frame, renewed on each decision: behind the death
screen (`hurryWhileCovered`), and when a crawler, not only a landing, is near them
(`hurryWhileApproached`), so a party walking back to a cold crowd meets it warm. A recall
channel's landing alone never raises it. A warp that still lands among cold rows comes in
behind the arrival's loading screen (see "Memory follows the party within a floor"): a
cache that cannot make room leaves a few stand-ins rather than a screen that never lifts.
`npm run verify:town-residency` counts the stand-ins after a walk home, a death, the
recalls, a crawler switch, and a full-speed walk across a city of three by three towns
from a cold arrival.

The global ceiling, `CACHE_BUDGET_MEGABYTES` (80), is sized for arriving on level 3, the
tightest moment measured: the crowd, the fairies and both crawlers warmed together ask
for 53.1 MB of ink crops. Beside the crowd sits the player's own per-figure ceiling,
`HUMAN_FIGURE_BUDGET_MEGABYTES` (28, against a heaviest measured working set of 22.0 MB),
so a town visit never leaves the human's new gear nowhere to bake.

**A row nothing has room for is abandoned for a while.** After
`PREWARM_CAPACITY_RETRIES` refusals the queue gives the row up and refuses it for
`IDLE_FRAMES_BEFORE_RELEASE`. That is the window in which the rows crowding it out are
released if nothing draws them. Taken back at once, the row would reach the front of the
queue every frame, be refused there every frame, and spend the allowance the rows behind
it are waiting on. It is still drawn meanwhile, painted directly.

**A frame's prewarm runs in a fixed order.** Urgent rows drain first, then the queued
row ink measurements (`figureRowInkTop`, which places markers over a figure), then the
speculative rows — all from one `PREWARM_BAKE_BUDGET_MS` (3 ms, a mean; an overrun is
repaid out of later frames) inside the frame's `FRAME_BAKE_BUDGET_MS` (4). Ink first
would let a crowd walking into view spend the whole budget for tens of seconds while
every figure that missed was painted live. A cell that is painted directly records why
(`FIGURE_DIRECT_DRAW_CAUSES` in `figureCacheStats.ts`): `frameAllowance` (the frame's
time was spent and the figure had nothing baked to borrow), `figureBudget` or `cacheBudget` (still over a ceiling after eviction
found nothing out of use), `memoryHeld` (bakes paused after the browser refused a
surface) or `tooLarge`. `__perfRecorder` sums them per recording.

**A citizen draws approximately; a fight draws exactly.** `drawFigureCachedApprox` never
bakes on the render path. It borrows the nearest baked frame of the same row, then any
warm row of the figure, and it asks for the missing row urgently. Citizens draw this way.
`drawFigureCached` bakes a miss while the frame's allowance lasts and borrows the same
way only once it is spent: a crowd of combatants arriving together (a siege wave) misses
far more cells than a frame can bake, and painting each of them live, every frame, cost
the siege most of its frame time. A borrowed frame lasts until its row lands from the
urgent queue, a few frames later.

A companion that follows the party is warmed on arrival, not per floor. The Barracks
Mercenaries' hirelings are all painted (the `companion:mercenary` requirement declares
no sheets), and only the one under contract is ever warmed: its `MERCENARY_ART` entry's `prewarm` runs
when the desk signs the contract and again every time `MercenarySystem` spawns it — a
save restore, a walk out of a building — and `prewarmForFight` when it picks a fight.
Warming all five would hold four figures nobody can see.

The cache is flushed at the stairs transition, beside `releaseSpritesExcept`, for the same
reason sheets are evicted there, and on a canvas recovery. A render-scale change does not
flush it: each figure moves to its new level as above.

**Obligations when adding or changing a figure:** its states are declared in its
`FigureDef` and nowhere else; its painter must be deterministic in `(state, frame)`
alone — no randomness, no clock, no module state, and nothing that advances a counter at
paint time — must stay inside its declared cell, must not read caller `ctx` state, and
must not call back into the cache. `scripts/gates-<x>.ts` holds its art gates and
`npm run render:<x>` runs them and writes a contact sheet to `preview/`.

**A finished figure with no role lives on the shelf.** `src/shelf/` keeps painted
characters out of the game until they have a place in it, one folder per character.
Nothing outside `src/shelf/` and `scripts/` may import from it, so a shelved figure is
never in the bundle and never in the cache. Each keeps its art gates and render harness,
so it still compiles and renders, and each has an entry in `src/shelf/README.md`.

**A finished figure with a dev route is an unplaced asset, not a shelved one.** The Demon
Liaison (`DEMON_LIAISON_FIGURE` in `src/sprites/art/demonLiaisonFigure.ts`, his parts in
`demonLiaisonArt.ts`, drawn through `drawDemonLiaisonSprite` in
`src/sprites/demonLiaisonSprite.ts`) is a complete horned, winged figure on the human rig
that nothing in play spawns. His readers are the `?demonliaison` preview
(`DemonLiaisonPreviewScene`) and `npm run render:demon-liaison`, which runs his gates
and renders him beside the human and the residents; `npm run gates:idle-stillness` holds
his idle. A dev route is bundled code, which the shelf forbids, so he sits beside the live
figures. He costs bundle bytes but no cache memory, since nothing bakes him outside the
preview.

**Each character's harness is named for it.** `npm run render:deinonychus` (gates in
`scripts/gates-deinonychus.ts`) and `render:deinonychus-explainer` draw the pet at each
growth stage and its explainer; `render:energy-shield` (gates in
`scripts/gates-energy-shield.ts`) and `render:seismic-stomp-blast` draw the two
abilities' runtime effects; `render:dave-teleport` draws every frame of Dave's teleport in
and out and every row he walks, stands and talks in, through `drawDaveSprite`.

## The ground is painted too

The generated ground tilesets — `ground_overworld`, `ground_dungeon`,
`ground_floor1`, `ground_floor2`, `ground_interior` and the shared corner masks
`ground_masks` — do not ship as PNGs. They still have manifest entries, because a
row's `frameCount`, `patchTiles` and label are what every draw site and every
material union is written against; what they do not carry is a `path`, and a
manifest entry with no path means "painted at runtime". `SpriteLoader` refuses to
fetch one and waits for `registerPaintedSprite` instead.

`src/map/environmentArtCache.ts` owns the painting. A sheet is requested as a
plan — its geometry plus an ordered list of steps, one per material variant — and
the cache drains a few milliseconds of steps per render frame, using the same
mean-not-ceiling budget and cost-before-work check as the figure cache. Nothing
is published until a sheet's last step lands, so a half-painted sheet is never
drawn: until then the renderer falls back to each material's
`GroundPalette.fallbackColor`, exactly as it does for a sheet still in flight over
the network. Sheets are released at a floor change beside `releaseSpritesExcept`
and with the same keep set.

**A floor's look is fixed when its layout is.** `GameMap` draws an art seed in its
constructor and keeps it for the life of the object, and the scene pushes it into
`src/map/ground/floorArtSeed.ts` before any sheet or tile chunk is baked. A
checkpoint restore rewinds the same map object and so keeps the same art; a
genuine descent or restart builds a new map and earns a new look. Every consumer
forks its own stream with `floorArtSubSeed(SOME_SALT)` rather than reading the
raw value, so adding a consumer cannot perturb an existing one.

**The seed space is enumerated, not sampled.** The game draws from
`src/map/ground/artSeedAlphabet.ts`, a generated list of seeds every one of which
has been painted offline and measured against the reviewed art — wrap seams,
mean-luminance drift, texture energy, and wall-to-floor luminance separation per
floor theme. `npm run gen:floor-art-seeds` builds the list;
`npm run verify:floor-sweep` re-measures all of it and carries its own
deliberately-torn-patch self test, so the seam gate is proved able to go red. A
seed that fails simply never enters the alphabet — with only a few Worley cells to
a patch, some genuinely land a mortar line along the joint.

`npx tsx scripts/generate-ground-tileset.ts [artSeed]` still bakes the sheets, now
into `preview/tilesets/` for review rather than into `src/images/`. The `?tiles`
route paints them live and rerolls the art seed on a right-click.

## So are the props

The same conversion, one layer up: the town's street furniture and signage, the
forest, the boulders and the goblin camps are painted at floor load rather than
fetched. What each sheet carries — its frame envelope, which state is which row,
how many frames a row holds — lives in `src/sprites/sheets/`, so the sheet the
game paints and the sheet a review bake writes are one description rather than
two. `src/sprites/sheets/environmentSheets.ts` turns a floor's declared
`AssetGroup`s into painted families, which is the same vocabulary `prewarmGroups`
already speaks.

Three rules hold this together, and each has a gate behind it:

- **A plan must agree with the manifest entry it is painted under.**
  `registerPaintedSprite` checks the sheet's own dimensions and
  `propSheetPlanMismatches` checks every row and frame count;
  `npm run gates:environment-art` runs the latter over every family, and a plan
  that disagrees throws at request time rather than landing its art an inch out
  on every frame forever.
- **No painter may draw outside its own cell.** A frame is clipped to its cell
  wherever it is painted, so art that reaches past the envelope is sheared off
  along a straight line — which the forest bake caught three times and which no
  typecheck can see. `bakePropFamily` checks the border pixels of every frame of
  every family.
- **The port changed nothing.** `npm run parity:props -- --ref=<dir>` paints each
  plan and compares it channel for channel against the PNG it replaced,
  recoverable from git for as long as anyone needs it. Sixty-six sheets and 138
  facade cells came through identical, and the one that did not — the brazier —
  carries a written budget saying by how much and why, so it goes red again if
  the difference ever grows.

A sheet is published as soon as its _ready_ rows have landed, not when the last
step has. A tree's idle and damaged stances are what a floor shows the moment it
opens; its burning and felling rows are twenty-four frames per tree that most
trees never play, and they fill in behind the wood the player is already walking
through.

Street furniture carries no floor art seed — a lamp is the same lamp wherever it
is hung — so it survives the stairs and is released with its asset group. The
wilderness does carry one, so a floor's trees, rocks and camps are repainted when
its layout is.

## Boss rooms are painted and baked

The boss rooms on floors 1 and 2 ship no images. Each room's floor, props,
toppled and flooded states and effect frames are a sheet family in
`src/sprites/sheets/bossRooms/<room>Sheets.ts`, keyed by its asset group
(`boss_trash_gremlin`, `boss_big_rooster`, `boss_power_lab`, `boss_flooded_pump_room`, `boss_grotesque_spider`)
in `bossRoomSheets.ts`. `requestEnvironmentSheetsForGroups`
paints them at floor load under `BOSS_ROOM_SALT`, so a room's art variation is
repainted with its floor, while its collidable layout comes from doorway-relative
templates that no seed reaches. Seal time warms only the boss figure.

Static art stays out of the frame. Floors, stains and blocking props are tile
types (`BOSS_ROOM_PROP_TILE_TYPES`, `BOSS_ROOM_FLAT_TILE_TYPES`) painted by
`src/map/tiles/bossRooms/` into the tile chunk cache; only live objects — a
wobbling tower, a cracking vat, a rattling cage — are drawn each frame, by the
room's `BossRoomDressing` (`src/systems/bossRooms/`), as blits of pre-painted
frames. A room's darkness is the one full-room image, baked at quarter
resolution when the room seals and scaled up in a single blit.

`npm run gates:boss-rooms` holds the line on real generated floors: no pixel of
placeholder magenta, no reference to a deleted image key, each room's sheets
under 6 MB decoded, and no more than 120 dressing `drawImage` calls in a room's
heaviest frame, counted on a wrapped context.

## Facades are painted in stages

A building facade is the most expensive picture the game makes — around a
seventh of a second each in a browser, two seconds for the town's fifteen — so
it is the one family that cannot be painted as a sheet in one step.
`planBuildingPaint` in `src/sprites/buildinggen/paint.ts` breaks a facade into
the passes it was always composed of (each plane's material, its weathering
layers, its shade, the composite, the props, the ink) and hands them back as
stages sharing one canvas. `runtimeBuildingSheets.ts` feeds those stages to the
same paced queue everything else uses, and publishes a building the moment its
own facade is done — its lit windows and forge glow fill in behind it.

Two measurements decided that shape, and both are worth keeping:

- **Declaring a plane read-heavy is worth more than any of the splitting.** Every
  texture and lighting pass reads a plane's whole buffer back and writes it
  again, half a dozen times before the plane is drawn once, and a GPU-backed
  surface pays a full synchronisation for each read. `allocReadableCanvas` cut
  the town's facades from 4.6 s to 2.1 s in Chrome — more than a factor of two,
  for one flag.
- **node-canvas and Chrome disagree by three times in opposite directions.** Node
  paints a thatched roof in 204 ms against Chrome's 40, and Chrome reads a plane
  back far more slowly than node does. Chrome's worst single stage is 64 ms.
  `npm run gates:environment-art` therefore measures node and says so: its
  worst-frame limit exists to catch a pass that has grown to swallow its whole
  family, not to certify a frame time.

**A building wears two sheets.** `<facade>` is its single idle frame (0.4–1.1 MB), and
`<facade>_life` is its life row of 6–26 frames (lit windows, smoke, glow), each frame
cropped to the rectangle the row inks and offset by a negative `tileX`/`tileY`
(`lifeInkCrop` in `scripts/buildinggen/bake.ts`, checked by `gen:buildings`). The life
rows are most of a building's bytes, and the crop takes floor 3's from 59.4 MB to 24 MB.
The crop is aligned to multiples of `LIFE_CROP_ALIGNMENT_PX` (6), so a facade painted at
48 px per tile and drawn at 32 resamples identically; `gates:environment-art` checks that
every life row draws pixel-identical to its whole frames. The two are held by separate
rings (see "Memory follows the party within a floor"): the still frame well ahead of the
camera, because a facade let go and walked back to is a building missing for the frames
its repaint takes, and the life row only while in view, since a building whose row has
not landed only stands still for the 1–3 frames it takes to paint.
`drawDecorationLifeLayer` draws the life row only when both sheets are resident, asking
`hasEnvironmentSheet` first so no miss is recorded. Every landing of a building's sheet is
announced by key (`environmentSheetsRepaintedSince`), so the overlay cache drops only that
building's entries and the tile chunks are left alone.

`overworld_main_tower` stays an authored PNG: it is not a generated facade.

## A heavy arrival goes behind a loading screen

The paced queues above are right for a floor already being played, and wrong
for its first seconds: on the town they mean buildings arriving one at a time,
a crowd drawn as stand-in poses while its rows bake, and a screenful of ground
chunks baked on the first frame; in a dungeon, Dave's wander and the boss
rooms' sheets painting in. Every environment covers that instead — the
tutorial, every floor and every building interior. `LevelDef.arrivalLoadingScreen`
is required, and `GameplayScene` holds an abstract `ArrivalLoader`
(`src/scenes/ArrivalLoader.ts`) that each scene begins last in its
constructor. `src/scenes/floorArrivalLoad.ts` builds the work as `LoadTask`s — the queued
environment sheets, the figure prewarm queue, the fetched sprite groups, then
the ground chunks and decoration overlay entries for the view the first frame
draws (after applying any tile marked dirty while the floor was built) — and
the loader runs them behind a `LoadingOverlay`
(`src/ui/LoadingScreen.ts`) driven by a `LoadRunner` (`src/core/perf/LoadRunner.ts`)
a few milliseconds a frame.

The screen only drains what was queued, so what makes an arrival hitch-free is
that everything drawn from the first frame queued its rows when it was placed:
Dave in every view he wanders in, whenever the run left him standing in the room
the party arrives in (`DaveGuideSystem` warms him again on each safe-room entry, since his
teleport may come long after the scene was built), the goblin mother, the tutorial's
goblins, the spider lab's self-cycling life machines, the town's recruiter
(urgently, since the crowd has filled the cache by then).
`npm run verify:arrival-load` runs the real scene for each environment and
fails on any render-path bake, stand-in, direct paint, chunk bake or
environment step in its first frames of play. The world neither updates nor draws while it is
up; the render-quality probe and the figure cache's idle sweep are both held
for its duration, since its frames are neither play nor a sign that anything
went unused.

The decision is made on every construction of the scene, not at the call sites
that build it, and only when the arrival owes real work
(`floorArrivalOwesWork`): a walk out of a building goes straight to play unless
environment art is still owed. The town's crowd is rolled from the world seed, so the
rebuilt scene's crowd is the same people with the same rows, held again by its arrival
decision before the idle sweep could take them; what else its
figure queue owes is the respawned wild mobs' speculative rows, which the paced queue
takes over the next seconds. `npm run verify:town-soak` walks through twenty doors on
the real scenes and holds that: no loading screen on an exit, and frame cost, pins,
prewarm backlog, cache bytes, listeners and reachable scenes flat across the trips. `npm run verify:town-arrival-load`
holds the result — zero render-path bakes, stand-ins, direct paints, chunk
bakes and environment steps from the first frame of play — and
`npm run verify:loading-screen` holds the runner's pacing.

## What the conversion cost and bought

Across every domain, measured with `npx tsx scripts/report-asset-residency.ts`:
shipped image bytes went from 15.6 MB to 6.0 MB, and the resident decoded total
from 191 MB to 146 MB — with the remaining runtime-painted share now arriving
per floor and released with it rather than sitting in memory whenever its group
is loaded. The whole town's art — ground, street furniture, signage, wilderness,
club, facades — is 718 paint steps, which the queue drains in a few seconds of
a floor's fade-in while everything that has landed is already drawn.

## Every surface has an owner

Every off-screen canvas comes from `allocCanvas(owner, w, h)` — or
`allocReadableCanvas` for one read back pixel by pixel — in `src/core/rendering/canvasSurface.ts`,
against a `SurfaceOwner` from `SURFACE_OWNERS`. The module keeps a live count of
surfaces and backing-store bytes per owner; decoded `SpriteLoader` images (and their
half-size copies) count under `spriteSheets`, and the main canvas, the one canvas made
elsewhere, is reported as `mainCanvas`. `resizeSurface` changes a surface's size and its
tally together. `releaseSurface` zero-sizes a dropped surface so its pixels go back at
once rather than at the next collection; a `FinalizationRegistry` takes a surface
collected without release off the tally, so the count is what is held, not everything
ever allocated.

**Obligations for new code:** pick the specific owner the pixels belong to (add one to
`SURFACE_OWNERS` for a new pool rather than reaching for `misc`), call `releaseSurface`
on every eviction and drop path, and never assign `width`/`height` directly. Dropped
surfaces left to the collector are what that costs: measured in the town, they hold
486 MB tracked against 383 with every drop released — 89 MB of it in 2461 throwaway
scratch surfaces.

## Byte limits by owner

Every large owner is bounded, and each limit sits above the busiest scene's on-screen
working set, so it stops growth without ever evicting something visible:

- **Figure cells:** `CACHE_BUDGET_MEGABYTES` (80) overall, read through
  `figureCacheByteBudget()`; per figure, `FigureDef.budgetMegabytes` or the 24 MB default
  — the human 28 (`HUMAN_FIGURE_BUDGET_MEGABYTES`), Necromancer 32, the cat 28
  (`CAT_FIGURE_BUDGET_MEGABYTES`). Every count is of stored ink crops; the default and the
  cat's and the Necromancer's were sized from whole cells and are loose upper bounds.
- **Environment sheets:** `ENVIRONMENT_SHEET_BUDGET_MEGABYTES` (160), least recently
  drawn first. A sheet looked up within `RECENTLY_DRAWN_FRAMES` (half a minute) or still
  painting is never a candidate, so when everything resident is in use the cache stays
  over budget rather than opening a hole. A cache that bakes from a sheet and then draws
  its own copy (tile chunks, overlays) records the keys with `recordSheetLookups` and
  calls `touchEnvironmentSheets` on every cached draw, or a ground material on screen
  only through a baked chunk would look idle. The budget bounds the working set around
  the party, not the floor: the idle sweep and the facade resident sets keep resident
  only the floor-wide sheets plus the buildings near the party, so a floor may paint more
  than the budget in all. `npm run verify:environment-sheet-budget` measures, from the
  sheet plans' dimensions and without painting anything, the largest set any position on
  each floor needs at 1080p: every floor-wide sheet (ground, masks, the sheets placed over
  the whole map, and the floor's indoor-only groups, since a visit indoors keeps the
  floor outside resident), each building's still frame within the facade release ring
  and its life row within the life release ring, each widened by the walk
  `RELEASED_GRACE_FRAMES` allows. It fails if one uses more than 90% of the budget. It
  measures the scaled city (`scripts/scaledCity.ts`) too, as painted and with every
  block's facades its own, which is what a bigger floor brings. Measured 2026-10: floor 3
  needs 102.5 MB, the per-block city 137.9 MB.
- **Tile chunks:** `MAX_CACHED_CHUNKS` (60; a 1080p view spans 20), measured at 20–34 MB,
  and each chunk let go after half a minute undrawn.
  **Tile overlays:** `OVERLAY_CACHE_BUDGET_MEGABYTES` (32), evicting in batches down to 24.
- **Smaller pools:** town interior props 8 MB and nursery poses 4 MB, both through the
  shared `RecentSurfaceCache` (`src/core/rendering/recentSurfaceCache.ts`: a byte budget, LRU,
  nothing drawn within its protected frames let go, and optionally an idle window, which
  the town interior props use); figure rims
  (`RIM_CACHE_BUDGET_MEGABYTES`, 8); Starlight Tent props (6); held item art
  (`HELD_ART_BUDGET_MEGABYTES`, 4); title hero cells (32).

**Only half-density devices get smaller budgets.** `memoryBudgetScale()` in
`src/core/perf/deviceMemoryBudget.ts` scales the figure and environment-sheet budgets: full
when `navigator.deviceMemory` reports 8 GB or more, or when the device does not bake at
half density (`shouldDownscaleForLowEndDevice()`); a third on a half-density device
reporting 2 GB or less; half on any other half-density device. A half-density cell holds
a quarter of the bytes, so those fractions still clear the town's peak (51 MB of cells,
35 MB of sheets). A full-density phone keeps the full budgets however little memory it
reports: every smaller budget measured in the town walk added on-screen stand-ins and
repaints. Never branch on platform; `&deviceMemory=<GB>` stands in for the browser's
report. The only other cut is the last resort of repeated canvas purges at the lowest
variety tier, which halves the scale for the rest of the session ("Variety tiers").

**What scenes hold.** On floor 3 and the scaled city, measured headless with
`npm run report:residency` (node-canvas at DPR 2, 1280×720, world seed 1, `normal`,
`sharp`; surface tallies, not Chrome's tracked peak), 2026-10. The first two rows are
measured with cells stored as their ink crops; the rest, and the Chrome table below,
count whole cells:

| scene                                    | resident | largest owners (MB)                                                        |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------- |
| floor 3, plaza on arrival                | 178.1 MB | figure cells 53.1 (20.3 pinned), sheets 86.8                               |
| Briar Hollow, straight from the plaza    | 132.1 MB | figure cells 26.7 (13.1 pinned), sheets 59.9, ground parts 12.2, chunks 6  |
| Briar Hollow, after twelve interiors     | 246.5 MB | figure cells 139.7 (63.4 pinned), sheets 59.9, ground parts 13.5, chunks 6 |
| scaled city 3×3, west edge on arrival    | 215.3 MB | figure cells 107.0 (all pinned), sheets 91.6                               |
| scaled city 3×3, east edge after walk    | 123.8 MB | figure cells 107.0 (all pinned), sheets 0 (the fixture draws no facades)   |
| scaled city 5×5, east edge after walk    | 123.8 MB | figure cells 107.0 (all pinned)                                            |
| scaled city 5×5, east edge, cold arrival | 113.3 MB | figure cells 96.5 (all pinned)                                             |

Briar Hollow after the tour holds 5.8 MB more than straight from the plaza, the same
before and after forced collections, and no scene or map the tour left is still
reachable. What remains is bounded: a look whose wanderers stood nearer the village when
the longer route arrived, the rooms' floor-material parts (`groundTileParts`, capped by
entry count and keyed by material, cleared at the stairs), and scratch canvases grown to
the largest figure painted indoors. Tile chunks, environment sheets and town interior
props come out equal. Walking across the 5×5 city holds 10.5 MB more than arriving cold
at its far edge, all of it the crowd's release hysteresis; walking across the 3×3 city
holds exactly what arriving at its far edge does.

Elsewhere, tracked peak by `__perfMemory`, Chrome on an M1 Pro at DPR 2, 2026-10:

| scene               | tracked peak | largest owners (MB)                                 |
| ------------------- | ------------ | --------------------------------------------------- |
| floor 1             | ≈230 MB      | figure cells 111, sheets 45, chunks 29, lighting 24 |
| floor 2, spider lab | ≈270 MB      | figure cells 153, sheets 47, chunks 34, lighting 25 |
| Big Rooster's gym   | not measured | figure cells, offline: see below                    |
| casino table (idle) | ≈65 MB       |                                                     |

The gym has no Chrome measurement yet. Offline, G9 in `scripts/gates-rooster.ts` sums
every declared state's cells at tile scale 32: Big Rooster's whole runtime set is
23.1 MB of the 24 MB per-figure budget, Little Rooster's 2.1 MB and Slightly Bent
Rooster's 3.7 MB.

## Variety tiers

When a device cannot keep up — it lags, or the browser drops canvases — the game spends
**variety** before it spends smoothness: fewer distinct enemy and townsfolk looks, so
fewer figures to paint and cache. Fights stay as hard as they were. The tier is one global
value, `varietyTier()` in `src/core/perf/varietyTier.ts`, read when something spawns or a
citizen picks its look:

| tier | name         | enemies                                      | street crowd (human / Hawkfolk)               |
| ---- | ------------ | -------------------------------------------- | --------------------------------------------- |
| 0    | Full         | every look                                   | every look / all 16                           |
| 1    | Shared looks | each variant family wears its canonical look | one commoner, one child, other roles all / 8  |
| 2    | Trimmed      | the same, plus each ladder's tier-2 rows     | five role groups / 4                          |
| 3    | Lean         | plus the tier-3 rows                         | three groups: guard, child, everyone else / 2 |
| 4    | Minimal      | plus the tier-4 rows                         | as tier 3 / 1                                 |

**Rules.**

- High memory is acceptable; lag is not. The cache budgets in "Byte limits by owner" stay
  as they are; variety goes first, and only the last resort below cuts a budget.
- A mob on screen never changes kind. A mob's or citizen's look changes only right after
  a purged canvas recovery, when the screen has just been blanked and every figure
  repaints anyway, so nobody sees it swap. A tier step from lag alone re-dresses no one;
  what spawns after it wears the new tier.
- Bosses, bounty marks, the Necromancer, quest-critical mobs and boss adds are never
  substituted — the Trash Gremlin's cockroaches stay cockroaches. That is the kind's
  `protected` field on its `MOB_KINDS` entry (`src/levels/mobKinds.ts`), and
  `standInFor` (`src/levels/ladder.ts`) honours it whatever a ladder says.
- A stand-in must already be part of the same encounter at that tier, so a substitution
  never brings in a new look.
- Tiers only go down during a session. Nothing raises the tier back up, so a device that
  struggled once is never asked to carry the fuller set again.

**What moves the tier.**

- **Starting tier:** `startingVarietyTier` in `src/core/perf/RenderQuality.ts` — `0` with full
  cache budgets, `1` when `memoryBudgetScale()` is half, `2` below that. The
  `performance` preset starts at `PERFORMANCE_PRESET_VARIETY_TIER` (2).
- **Lag:** `RenderQualityController`'s safety net watches play in `SAFETY_NET_WINDOW_MS`
  windows and takes one rung per breached window, opening a fresh window after each, so
  a device still slow after a rung takes the next. A window is **paint-bound** when its
  mean bake time is at least `PAINT_BOUND_SHARE` (a third) of its mean frame interval;
  bake time is figure bakes, environment sheet paints and ground chunk bakes, split out
  of every frame by `src/core/perf/frameCost.ts` in release builds too (`lastFrameCost()`,
  also shown by `?perf`). A paint-bound window takes a variety rung first; any other
  takes a render rung first (`auto` only: render scale, then scenery detail). When the
  preferred kind is used up the other is taken. Hidden-tab and loading-cover frames
  never count. `sharp` never gives up variety for lag; `performance` gives up only
  variety.
- **Canvas loss:** `src/core/rendering/canvasRecovery.ts`. A `contextlost` holds every purge check
  and recovery until `contextrestored`, or `CONTEXT_RESTORE_TIMEOUT_MS` if it never
  comes, then repaints. Each loss lowers demand at most once: its first repaint steps
  the tier down one (or, at the minimal tier, counts toward the budget cut). The pending
  recovery owes a count of these purge steps, so two losses restored before one frame
  step twice. A repaint for pixels only suspected lost asks for no less: a loss begun while the page was
  hidden, a purge found by the first check after returning to the foreground, and a
  page thawed from the back-forward cache. After a timeout, a late `contextrestored`,
  or a sentinel that holds its pixels again, repaints once more without stepping; a
  sentinel the browser refuses while the restore is overdue closes the loss too, since
  it says memory is short, not that the context is still lost. That close is
  unconfirmed (its own phase, `closedUnconfirmed`): until a sentinel holds, a restore
  arrives or a new loss begins, a purge found reopens the same loss as overdue instead
  of stepping the tier again, and backs the check interval off like any repeated purge,
  so a sentinel refused at every check does not repaint at every other one. A
  `'memoryPressure'` request (a surface that could not be allocated) steps the tier once
  and never counts toward the budget cut, even when it rides on one of those repaints
  that ask for no less; it steps nothing when requested while a loss that is answered
  or began hidden is open (judged when requested, however the loss later ends), and is
  spaced out by `MEMORY_PRESSURE_RECOVERY_SPACING_MS`. A memory-pressure request never
  holds off the purge check. These steps apply whatever the preset, `sharp` included:
  a dropped canvas is worse than fewer looks. After a purge only the
  environment sheets drawn within `ON_SCREEN_FRAMES` (a second of render frames) and
  those still owed are repainted at once; the rest repaint when next wanted, so a recovery does not climb straight back to the peak that was
  just lost.
- **Last resort:** once `PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT` purges have been
  answered at tier 4, `cutMemoryBudgetsForSession()` (`src/core/perf/deviceMemoryBudget.ts`)
  halves what `memoryBudgetScale()` returns for the rest of the session. It is the only
  path that lowers a cache budget below the device's own share.
- **Dev:** `?variety=<0-4>` pins the tier (`pinVarietyTier`, from `src/dev/devBoot.ts`):
  lag and the starting tier leave it there, a canvas recovery still steps it.
  `npm run playtest -- briar-hollow-assault --variety=<n>` passes it through.

**Look sharing versus kind substitution.** Look sharing keeps the kind, its stats and its
behaviour and changes only which figure it is drawn as; it applies everywhere from the
tier its family names. Kind substitution spawns a different kind in place of the authored
one, in a threat-preserving number, and applies only inside an encounter that declares a
ladder. Fairy, clown, skeleton and bomber kinds are separate kinds rather than looks of
one kind, because their look tells the player what they will do; they are only ever
reduced through a ladder.

**Threat.** Every kind's `threat` on its `MOB_KINDS` entry rates it as a multiple of a
melee goblin. The method is in the JSDoc on `MobKindEntry` (`src/levels/mobKinds.ts`);
rate a new kind by it, not by feel, since every substitution count is a ratio of two
threats.

**Adding a variant family.** A kind with several looks declares a `MobVariantFamily`
(`src/core/mobs/mobVariantFamily.ts`) beside its class — `weightedVariantFamily` or
`uniformVariantFamily` — with its `canonical` look and the `sharedFromTier` from which
every spawn wears it; `GOBLIN_MELEE_FAMILY` (`Goblin.ts`), `HAWKFOLK_TOUGH_FAMILY` and
`RAISED_RATKIN_FAMILY` are the examples. Register the kind with `lookKind` and an
`applyVariant`. The class takes its look as a constructor argument, never picks one
itself, draws the figure its look names, and takes any look-coupled parameter (a goblin
weapon's swing timing) from the look. When the looks change the fight, the canonical one
is the closest to the family's average, as the goblin's axe is. `spawnMob` (`src/levels/spawnFunnel.ts`) resolves the look,
warms it and, after a purged recovery, re-dresses live mobs through `applyVariant`; no
tier code changes for a new family.

**Encounters that always share looks.** An encounter that fields so many bodies at once
that every device should wear one look per kind sets a floor in
`ENCOUNTER_LOOK_TIER_FLOORS` (`src/levels/encounters.ts`); `lookTierFor` gives the tier
its looks resolve at. The Briar Hollow siege and the necromancer's raises sit at
`SHARED_LOOKS_TIER`, so each kind there wears its canonical look whatever the variety
tier, while the siege's ladder still reads the real tier. Anything that warms an
encounter's looks ahead (the siege lead-in in `assaultPrewarm.ts`) asks `lookTierFor` too.

**Adding a ladder.** A ladder is an encounter's ordered list of `LadderRow`s
(`{ tier, kind, standIn }`): from `tier` on, `kind` spawns as `standIn`. It is data
beside the encounter's own spawn table — `BRIAR_HOLLOW_SIEGE_LADDER` sits beside
`ASSAULT_WAVES` in `src/systems/briarHollow/assaultWaves.ts` — registered under the
encounter's `EncounterId` in `ENCOUNTER_LADDERS` (`src/levels/encounters.ts`). An encounter
with no ladder gets look sharing only. The encounter plans each roster through
`planEncounterRoster` before spawning it (the siege does so per mini-wave, in
`planAssaultRoster`), and then spawns the planned kinds through `spawnMob`; `spawnMob`
itself never substitutes. `resolveLadderRoster` pools replaced bodies per stand-in and
converts them by `threat(kind) / threat(standIn)`, rounded once per stand-in and never
below one body. Rows resolve transitively, so a stand-in a later tier removes resolves
through its own row. A row whose two threats are further apart than
`ONE_FOR_ONE_THREAT_BAND` must change the body count; `validateLadder` and
`substitutionRespectsBand` hold this. A new mob in an encounter that has a ladder gets a
row in it; only the kinds the encounter falls back on at tier 4 go without one. A kind's `approach`
rows are what a lead-in warms for it, so warming always follows the kinds actually
planned at the tier.

**Town crowd.** `pickCitizenFigure` (`src/creatures/citizenFigure.ts`) reads the tier for
street citizens, interior occupants and market vendors alike. Humans follow
`TOWN_CAST_TIER_PLANS` (`src/sprites/person/townCastLooks.ts`): role groups that wear
their first-listed role's looks, and how many of those looks each keeps. Guards and
children always keep a look of their own. Hawkfolk keep the first
`hawkfolkStreetLookAllowance(tier)` civilian looks, one per street role first while there
is room. A citizen keeps its role, and with it its behaviour and services. Named
residents keep their own looks at every tier, and a citizen in a conversation keeps the
face being talked to; any other `Townsperson` re-picks only after a purged recovery.

**Gates.**

- `npm run check:spawn-funnel` (part of `lint` and `check`) — every hostile is built
  through `spawnMob`; a `new` of a hostile class outside `src/levels/mobKinds.ts` fails.
- `npm run verify:canvas-recovery` — one loss runs one recovery and one tier step, a
  second loss steps again, the restore timeout recovers once, memory pressure steps
  except inside an answered loss, a lag step never changes a live look, and only
  repeated purges at tier 4 cut the budgets. A purge re-dresses a live mob in its
  shared look, same kind and health, and repaints only the sheets drawn lately.
- `npm run verify:render-quality` — synthetic windows walk the lag ladder in order,
  paint-bound windows take variety rungs, `sharp` never steps on lag, and the starting
  tier follows the memory scale and preset.
- `npm run gates:assault-residency` (A4) — every declared ladder passes `validateLadder`;
  at every tier and difficulty no planned mini-wave brings a removed kind, every
  stand-in is already in the siege, every substitution keeps its threat, and the
  lead-in warms exactly the planned kinds.
- `npm run gates:human-cast` (H9, H10) and `npm run gates:hawkfolk-cast` (G9) — the street
  never wears more distinct looks than its tier allows; a citizen of either cast changes
  look only at a purged recovery, and named residents and citizens in a conversation keep
  theirs at every tier.

**Measuring at a tier.** Serve the game and open
`?playtest=briar-hollow-assault&assaultNow&perf&variety=<n>` for each tier, then read,
at wave 2: figure-cache bytes and surfaces from `__perfMemory()`, the p95 frame interval
from `__perfRecorder` (see "Measuring any of this"), and the tab's total from Chrome's
Task Manager. The game's own tally misses GPU-side and browser memory — it read about
725 MB against Chrome's 1.2 GB in the siege — so the Task Manager number is the one that
says whether a tier holds. Run it with no gate suites or other game tabs open; they
compete for the same GPU.

## Ground chunks bake on a budget

`TileRenderer` bakes the ground into chunk canvases from one per-frame budget,
`CHUNK_BAKE_BUDGET_MS` (4). A visible chunk owed a patch is patched before it is drawn,
and the first cold visible chunk always bakes so the cache cannot stall; a cold chunk
the budget refuses is painted tile by tile, which costs a bake every frame it happens,
so the cheapest cold chunk is one baked before it scrolls in. Leftover time goes to one
bake **sliced across frames**, in the bake's own row-major tile order into a fresh
canvas, while the old picture stays on screen: a visible stale chunk's re-bake (a sheet
it was baked from was repainted) first, else the next cold chunk one ring ahead of the
camera's motion, the corner included on a diagonal. Work for ground not yet on screen
is held to `CHUNK_SPECULATIVE_BUDGET_MS` (1), since it runs on every frame of a walk;
the camera takes about 200 frames at walking pace to cross a chunk, so that lead is
ample. A tile edit marks a **patch** (widened by `CHUNK_REPAINT_MARGIN_TILES`, since a
neighbour's painter reads it) on every chunk it touches instead of a re-bake; off-screen
patches are painted in speculative time. A map's very first frame is unbounded.

## Resolution is not the lever

Most sheets are authored at `tileScale: 64` while `TILE_SIZE` is 32, which looks like a
4× overspend. It is not: at DPR 2 a 32px tile covers 64 device pixels, so those sheets
are exactly 1:1 on the screens most people play on. Halving the bake blurs the game.

`SpriteLoader` does keep a half-size downscale, but only past a hard
`Math.round(devicePixelRatio) >= 2` guard, checked _before_ the quality setting — DPR
wins over the `performance` preset, because the sheets were baked for DPR 2 specifically
rather than as a render-quality preference.

When that downscale runs, frame geometry is stored as the _exact_ half value and never
rounded; only the canvas's own backing-store dimensions round to whole pixels. Rounding
`frameWidth` independently makes `col * frameWidth` drift from the true scaled frame
boundary a little further with every column — invisible on frame 0, a visibly mis-cropped
frame at the end of a long animation row.

## Measuring any of this

`performance.memory` reports the JS heap only. Bitmaps and audio buffers live outside it,
which is why this looked like a non-problem for a long time. `__perfMemory` adds both
beside the surfaces: `audioBuffers` is every decoded sound effect's float samples plus the
compressed files `ON_DEMAND_SOUND_IDS` keep, and `jsHeap` is `usedJSHeapSize` where
Chrome reports it. Decoded audio is resampled to the context's rate, so a 16 kHz effect
costs as much as a 48 kHz one. At a 44.1 kHz context the floor-3 overworld holds about
161 MB with nothing under way, 176 MB near Briar Hollow and 203 MB in a siege, which
also holds the bounty group (`FloorSfxGates`); 1.5 MB of that is the gated
groups' compressed files, kept so a cue whose group was let go still plays. Use Chrome's Task Manager
for the per-tab total and cross-check with `ps -Ao rss,command | grep Renderer`.
Unregister the service worker first — it precaches every shipped asset and will serve a
stale bundle. A slow frame with a matching `longtask` entry is JS; a slow frame without
one is raster or GPU upload.

**Timing and per-owner bytes in Chrome.** The repeatable scenes are `PERF_SCENES` in
`src/dev/perfScenes.ts`: each is a dev query pinned to one world seed under `!tough`,
plus a scripted walk.

1. `npm run serve`, then open `http://localhost:8080/?<scene query>&perf&perfwalk=<id>`
   in a **visible, focused** tab. `&perfwalkDelay=<s>` (default 10) and
   `&perfwalkSeconds=<s>` (default 30) set the warm-up and the walk's length;
   `&assaultNow` rings the Briar Hollow bell on arrival; `&deviceMemory=<GB>` measures
   another device's budgets.
2. Press a real key so intro banners clear and rAF runs at full rate.
3. Wait for `__perfWalk.state === 'walking'` (the warm-up lets the JIT and caches
   settle), call `__perfRecorder.start(label)`, wait for `'done'`, then
   `__perfRecorder.stop()`. The recording holds real rAF frame intervals (p50/p95/p99,
   max, frames over 20 and 33 ms), every perf timer and gauge, the figure cache's hit
   rate and direct-draw causes over the whole run, long animation frames, and
   `__perfMemory` sampled each second.
4. Three runs per scene; keep the median, since a first run's JIT warm-up over-reports.
   Write results under `preview/perf/<label>/`.

Never call `getImageData` or `toDataURL` on the main canvas during a timing run: it
moves the canvas to software rendering for good. `__perfMemory()` returns per-owner
surfaces and bytes at any moment. The density check (`__perfDensity.start()` /
`.report()`: pixels a cache paints per tile against pixels it is drawn at, from a probe
on every `drawImage`) and `__perfDuplicateCells()`, which reads every cell back, both
slow the frame, so they belong in a separate, untimed run;
`npm run report:duplicate-cells` bakes every figure headless and counts the same way.

**Caveats.** node-canvas draws about five times slower than Chrome and reads pixels back
very differently, so headless numbers are counts and ratios, never frame times.
`__perfMemory` counts canvases, decoded images, decoded audio and the JS heap; it misses
the browser's own GPU textures, compositor tiles and decode caches, so reconciling the tracked total with Task Manager's memory footprint and GPU
memory is a human's job, as is any phone measurement (open the same route with `&perf`
and read the overlay). On a 120 Hz display about 1% of frames read 20–25 ms from vsync
jitter even when nothing is happening, so judge hitches by frames over 33 ms and by the
timers and gauges, not by the over-20 ms count alone.

**Findings that stand (2026-10).** Every large owner's density ratio is at most 1.0
(figure cells and props 1.0, sheets and chunks 0.5), so there is no density to cut
without visible loss. About 4% of live figure cells are byte-identical to another cell of
the same figure (6.6% across every figure baked headless at 1×, the human's 12.6% the
highest); the saving does not justify reference-counted sharing of cell surfaces.

`npm run verify:assets` is the build-time gate: it proves every mob a floor can produce
has its sprite keys declared, so a creature can never reach a floor whose groups do not
carry its sheet — and that every manifest key belongs to some group, so a sheet cannot
sit in the union with nothing loading it and pop in on first draw.

`npx tsx scripts/report-asset-residency.ts` prints disk and decoded bytes per asset
group, which is the number that matters: a PNG is compressed on disk and four bytes per
pixel once decoded. `npm run gates:figure-cache` covers the frame cache's own behaviour,
including a cached-versus-direct pixel comparison — the one thing that proves the
fallback path draws what the blit draws.
