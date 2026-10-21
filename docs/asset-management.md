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

`ASSET_GROUPS` (`src/core/assetGroups.ts`) names the sheets in each group. Its values
are typed `readonly SpriteKey[]`, not `string[]`, so a renamed or deleted manifest entry
fails `tsc` instead of vanishing at runtime. `LevelDef.spriteGroups` declares what a
floor loads.

**A floor's `LevelDef` does not list everything that can appear on it.** Bounty bosses,
quest creatures, companions and mid-fight summons are constructed by systems gated on a
map feature — a live bounty site, `gameMap.circusCentre`, `gameMap.spiderLabRoom`, a
hired mercenary — and are named in no spawn table. None of the five bounty bosses appears
in `level3.ts`, and they are among the largest sheets in the game.
`SYSTEM_ASSET_REQUIREMENTS` (`src/core/systemAssetRequirements.ts`) is where those get
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

## Indoor-only art is painted at the door

Some art is only ever drawn inside a floor's buildings. On floor 3 that is
`town_interior`: `ground_interior`, the rooms' floors and walls; `ground_dungeon`, which
the Sleeping Cat Inn's safe-room counter, galley and stove stand on; and the sixteen
`club_*` sheets of the Desperado Club's furniture. Painting it on the floor's arrival
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

Leaving the room releases nothing. The sheets stay resident and go idle, and the
environment cache's least-recently-drawn eviction lets them go first if the floor ever
needs the room. Releasing them on every exit would only repaint them on every entry,
behind a card that would otherwise be up for a few frames; keeping them costs 10.9 MB
that the budget has room for.

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
across groups on purpose — several bounty cues are stand-ins borrowed from a floor boss's
sample, so both owners preload them, and `preload` de-dupes against `buffers`.
Scenes preload through their `AudioScope` (`scope.preload(ids)`), which declares the ids;
when a scope is disposed, decoded buffers that no live scope declared are released, except
the `universal` group.

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
  eight tusklings blit the same eight cells; a pack costs what one of it costs. A figure
  whose appearance varies per instance cannot key on `(state, frame)` alone — where the
  variation is a closed set, each variant takes its own `FigureId`. The town's whole
  cast is the case: every citizen wears one of a closed set of human or skyfowl looks,
  and a seed only picks which.
- **A refusal paints rather than blanks.** The painter is present at runtime, so a cell
  the byte ceiling or the per-frame millisecond budget will not admit is drawn straight
  into the frame. Full means slower, never invisible. The fallback composes through an
  offscreen surface so a caller's `filter`, `globalAlpha` and shadow apply to a finished
  image exactly as they do to a blit.
- **The bake budget is milliseconds, not cell count.** Cell area spans two orders of
  magnitude across the fleet, so a cell count would let one figure spike a frame and hold
  another back for nothing.

Cells are baked supersampled and downsampled into place, matching what the deleted
offline generators did, so a cached cell is the sheet cell it replaced.

**Prewarm is the pack rule.** A painter over roughly 1 ms per cell cannot be absorbed by
the fallback, so every path that schedules such a creature calls `prewarmFigureState`
when the spawn is _scheduled_ — the level spawner's `MOB_PREWARM` map, a wave scheduler,
a boss intro, an attack telegraph — not when the mob first renders. Two things decide
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

**A crowd is pinned, not swept.** The global ceiling, `CACHE_BUDGET_MEGABYTES` (188), is
sized for a town plaza and for arriving on level 3. The crowd's pinned working set is the
largest share of it (about 83 MB on arrival in the seed-7919 town at DPR 2, measured
headless in 2026-10; the constant's JSDoc gives ~122 MB as its spread across world seeds),
and beside it sits the player's
own per-figure ceiling, `HUMAN_FIGURE_BUDGET_MEGABYTES` (67), so a town visit never leaves
Carl's new gear nowhere to bake. Pinning only the citizens within a radius of the camera
was measured and rejected: thousands of crowd draws became stand-in frames as citizens
walked into the ring cold. The ten-second idle window is a false signal for a strolling crowd:
a look worn by one or two citizens can go that long between draws of its rarer facing.
So the town pins each citizen's `idle` and `walk` rows (`pinCitizenFigure`) and warms
`talk` only when a citizen is frozen into a conversation (`prewarmAndPinCitizenTalk`).

- A pinned row is exempt from the idle sweep and from eviction.
- A sweep that meets a pinned row must `continue` past it, not stop, or the older
  unpinned rows behind it are never released.
- `TownLifeSystem.dispose` unpins on every path that rebuilds the town scene.
- A pinned row that has gone missing is re-queued urgently the next time it is drawn.

**Far from town the crowd stands down.** Briar Hollow is the town's neighbour, and a
siege wave there is a dozen distinct creatures in several facings; with the crowd's
~83 MB pinned off screen beside the party's ~45, the wave's rows evicted one another
and were painted live every frame. `TownResidency` (owned by `DungeonScene` on the
overworld) measures, for every look the crowd and the market's vendors wear, how far
a camera would have to travel before a citizen wearing it came into view, from each
crawler (a switch moves the camera to the other at once, unless it is knocked out)
and from any warp landing that is coming (a recall channel, a death screen's save
point). Past the hold distance plus a hysteresis it stands the look's rows down
(`setFigureStatePinStandby`): still pinned against the sweep, so a quiet trip costs no
re-bake, but evictable when something on screen needs the room. The hold distance is
the walk the fastest crawler (Speed Fizz with the stall's boon) covers in
`CROWD_REWARM_LEAD_SECONDS`; inside it a look is held again and any row missing is
asked for urgently, nearest look first, within the ordinary prewarm budget. Outside
it, and while no siege contests the room, missing rows are asked for speculatively, so
they fill back in as the fight's rows are swept. Only behind the death screen, which
covers the world, is the budget raised; a recall channel is played through and rewarms
its landing at the ordinary budget. A warp that still lands among cold rows comes in
behind the arrival's own loading screen (`ArrivalLoader.coverWarp`), which asks for
the rows again, forgiving any the queue gave up on, for its first
`WARP_COVER_FORGIVING_STEPS` frames, and lifts when they are warm, when the queue has
given up on them again, or after `WARP_COVER_MAX_STEPS`: a cache
that cannot make room leaves a few stand-ins rather than a screen that never lifts. Nothing changes inside the town: every
look is within the hold distance of anywhere in it. `npm run verify:town-residency`
counts the stand-ins after a walk home, a death, two recalls and a crawler switch.

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
time was spent), `figureBudget` or `cacheBudget` (still over a ceiling after eviction
found nothing out of use), `memoryHeld` (bakes paused after the browser refused a
surface) or `tooLarge`. `__perfRecorder` sums them per recording.

**A citizen draws approximately; a fight draws exactly.** `drawFigureCachedApprox` never
bakes on the render path. It borrows the nearest baked frame of the same row, then any
warm row of the figure, and it asks for the missing row urgently. Citizens draw this way;
combat rows never do.

A companion that follows the party is warmed on arrival, not per floor. The Meat Shields
hirelings are all painted (the `companion:mercenary` requirement declares no sheets), and
only the one under contract is ever warmed: its `MERCENARY_ART` entry's `prewarm` runs
when the desk signs the contract and again every time `MercenarySystem` spawns it — a
save restore, a walk out of a building — and `prewarmForFight` when it picks a fight.
Warming all seven would hold six figures nobody can see.

The cache is flushed when the render quality changes (cells are density-specific) and at
the stairs transition, beside `releaseSpritesExcept`, for the same reason sheets are
evicted there.

**Obligations when adding or changing a figure:** its states are declared in its
`FigureDef` and nowhere else; its painter must be deterministic in `(state, frame)`
alone — no randomness, no clock, no module state, and nothing that advances a counter at
paint time — must stay inside its declared cell, must not read caller `ctx` state, and
must not call back into the cache. `scripts/gates-<x>.ts` holds its art gates and
`npm run render:<x>` runs them and writes a contact sheet to `preview/`.

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

The five boss rooms on floors 1 and 2 ship no images. Each room's floor, props,
toppled and flooded states and effect frames are a sheet family in
`src/sprites/sheets/bossRooms/<room>Sheets.ts`, keyed by its asset group
(`boss_hoarder`, `boss_juicer`, `boss_krakaren`, `boss_grotesque_spider`,
`boss_colosseum`) in `bossRoomSheets.ts`. `requestEnvironmentSheetsForGroups`
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

**The sheet is one row, not two.** A building's `idle` is a single frame and its
`life` row is up to twenty-four, so a two-row sheet of the wider of those was
mostly transparent padding that still cost four bytes a pixel. Putting the idle
frame in column zero and starting the life row at column one — a `colOffset` the
loader has always understood — took the town's facades from 116 MB resident to
62 MB. `registerPaintedSprite` and the residency report both size a sheet the way
`frameOrigin` reads one, so neither can be fooled by the layout.

`overworld_main_tower` stays an authored PNG: it is not a generated facade.

## A heavy arrival goes behind a loading screen

The paced queues above are right for a floor already being played, and wrong
for its first seconds: on the town they mean buildings arriving one at a time,
a crowd drawn as stand-in poses while its rows bake, and a screenful of ground
chunks baked on the first frame; in a dungeon, Mordecai's wander and the boss
rooms' sheets painting in. Every environment covers that instead — the
tutorial, every floor and every building interior. `LevelDef.arrivalLoadingScreen`
is required, and `GameplayScene` holds an abstract `ArrivalLoader`
(`src/scenes/ArrivalLoader.ts`) that each scene begins last in its
constructor. `src/scenes/floorArrivalLoad.ts` builds the work as `LoadTask`s — the queued
environment sheets, the figure prewarm queue, the fetched sprite groups, then
the ground chunks and decoration overlay entries for the view the first frame
draws (after applying any tile marked dirty while the floor was built) — and
the loader runs them behind a `LoadingOverlay`
(`src/ui/LoadingScreen.ts`) driven by a `LoadRunner` (`src/core/LoadRunner.ts`)
a few milliseconds a frame.

The screen only drains what was queued, so what makes an arrival hitch-free is
that everything drawn from the first frame queued its rows when it was placed:
Mordecai in every view he wanders in, the goblin mother, the tutorial's
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
rebuilt scene's crowd is the same people with the same rows, still pinned; what else its
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
`allocReadableCanvas` for one read back pixel by pixel — in `src/core/canvasSurface.ts`,
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

- **Figure cells:** `CACHE_BUDGET_MEGABYTES` (188) overall, read through
  `figureCacheByteBudget()`; per figure, `FigureDef.budgetMegabytes` or the 24 MB default
  — Carl 67 (`HUMAN_FIGURE_BUDGET_MEGABYTES`), Necromancer 32, Donut 28.
- **Environment sheets:** `ENVIRONMENT_SHEET_BUDGET_MEGABYTES` (160), least recently
  drawn first. A sheet looked up within `RECENTLY_DRAWN_FRAMES` (half a minute) or still
  painting is never a candidate, so when everything resident is in use the cache stays
  over budget rather than opening a hole. A cache that bakes from a sheet and then draws
  its own copy (tile chunks, overlays) records the keys with `recordSheetLookups` and
  calls `touchEnvironmentSheets` on every cached draw, or a ground material on screen
  only through a baked chunk would look idle. Floor 3 paints about 126 MB on arrival,
  and 137 MB once its buildings have been visited; a walk around it draws most of that,
  so the whole set is its working set and the limit is a ceiling against growth, not a
  trim. `npm run verify:environment-sheet-budget` sums every floor's set, arrival plus
  indoor-only groups, from the sheet plans' dimensions without painting anything, and
  fails if one uses more than 90% of the budget.
- **Tile chunks:** `MAX_CACHED_CHUNKS` (60; a 1080p view spans 20), measured at 20–34 MB.
  **Tile overlays:** `OVERLAY_CACHE_BUDGET_MEGABYTES` (32), evicting in batches down to 24.
- **Smaller pools:** town interior props 8 MB and nursery poses 4 MB, both through the
  shared `RecentSurfaceCache` (`src/core/recentSurfaceCache.ts`: a byte budget, LRU, and
  nothing drawn within its protected frames let go); figure rims
  (`RIM_CACHE_BUDGET_MEGABYTES`, 8); Big Top props (6); held item art
  (`HELD_ART_BUDGET_MEGABYTES`, 4); title hero cells (32).

**Only half-density devices get smaller budgets.** `memoryBudgetScale()` in
`src/core/deviceMemoryBudget.ts` scales the figure and environment-sheet budgets: full
when `navigator.deviceMemory` reports 8 GB or more, or when the device does not bake at
half density (`shouldDownscaleForLowEndDevice()`); a third on a half-density device
reporting 2 GB or less; half on any other half-density device. A half-density cell holds
a quarter of the bytes, so those fractions still clear the town's peak (51 MB of cells,
35 MB of sheets). A full-density phone keeps the full budgets however little memory it
reports: every smaller budget measured in the town walk added on-screen stand-ins and
repaints. Never branch on platform; `&deviceMemory=<GB>` stands in for the browser's
report.

**What scenes hold**, tracked peak by `__perfMemory`, Chrome on an M1 Pro at DPR 2,
2026-10:

| scene                       | tracked peak | largest owners (MB)                                      |
| --------------------------- | ------------ | -------------------------------------------------------- |
| floor 1                     | ≈230 MB      | figure cells 111, sheets 45, chunks 29, lighting 24      |
| floor 2, spider lab         | ≈270 MB      | figure cells 153, sheets 47, chunks 34, lighting 25      |
| Juicer's gym                | ≈240 MB      |                                                          |
| town, Big Top, casino floor | ≈383–391 MB  | figure cells 188 (at the ceiling), sheets 139, chunks 20 |
| Briar Hollow siege          | ≈390–407 MB  | figure cells 188, sheets 139, chunks 30, main canvas 17  |
| casino table (idle)         | ≈65 MB       |                                                          |

The overworld scenes sit at the figure ceiling because the crowd's pinned rows fill it;
in the town walk the cache still serves 99.4% of cells, with one direct paint in 30 s.

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
also holds the bounty and circus groups (`FloorSfxGates`); 1.5 MB of that is the gated
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
the same figure (6.6% across every figure baked headless at 1×, Carl's 12.6% the
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
