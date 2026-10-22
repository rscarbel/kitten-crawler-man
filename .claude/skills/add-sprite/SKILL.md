---
name: add-sprite
description: Add or modify a sprite in Kitten Crawler Man — sprite sheets (PNG or runtime-painted), JSON manifests, SpriteLoader/SpriteRenderer, offline generator scripts. Use when a creature, item, prop or effect needs new art or animation states. For a weapon, tool or garment Carl or Donut holds or wears, use add-gear.
---

# Add a Sprite

> **Townsfolk, residents and citizens are NOT sprite sheets** — they are a closed cast of painted human and skyfowl looks, picked per citizen by seed. Use the `add-person` skill for those, not this pipeline.
>
> **Bipedal characters (humans, goblins, clowns, humanoid bosses) need the `bipedal-figure` skill first** — the rig/pose/view contract, gait authoring, bake gates and the image-review loop live there. Come back here for the manifest / loader / draw-wrapper wiring.
>
> **Ground and floor textures are NOT sprite sheets either** — they're painted at
> runtime by `src/map/tilegen/materials.ts` from wrapped noise. Use the
> `add-ground-tile` skill for terrain, paving, floors and tilesets.
>
> **Neither is the environment.** The town's street furniture and signage, the
> forest, the boulders and the goblin camps are painted at floor load from plans
> in `src/sprites/sheets/`. See "Environment art is painted, not fetched" below
> before adding or changing any of it.

Runtime rendering uses **sprite sheets described by JSON manifests** under `src/images/<category>/` (`enemies/`, `bosses/`, `characters/`, `npcs/`, `effects/`, `environment/`). Most are PNGs, produced offline by procedural generator scripts in `scripts/` or hand-drawn; the environment ones are painted by the game itself and have no file at all.

## Environment art is painted, not fetched

A manifest entry with **no `path`** is painted at runtime rather than loaded.
`SpriteLoader` refuses to fetch it and waits for `registerPaintedSprite`. The
entry stays in the manifest either way, because its rows, frame counts,
`patchTiles`, `tileTypeId` and `blockedRegions` are what every draw site and
every material union is written against — what it no longer carries is a file.

Such a sheet is described once, in `src/sprites/sheets/`, as a `PropSheetPlan`:
the frame envelope, which state is which row, and one painter per frame. The game
turns that plan into paced work through `src/map/environmentArtCache.ts`, and
`scripts/propSheetBake.ts` turns the same plan into a review PNG under
`preview/props/`. One description, so the sheet the game paints and the sheet you
look at cannot be different art.

**Obligations when adding or changing one:**

- The plan must agree with the manifest entry. `propSheetPlanMismatches` proves
  it and `npm run gates:environment-art` runs that over every family; a
  disagreement throws at request time rather than landing the art an inch out
  forever.
- No painter may draw outside its own cell. Every frame is clipped to its cell
  wherever it is painted, so art that overruns is sheared off along a straight
  line — invisible in a typecheck, permanent in the picture. `bakePropFamily`
  checks the border pixels of every frame.
- Register the family in `src/sprites/sheets/environmentSheets.ts` against the
  `AssetGroup` the floor declares, and say whether it varies with the floor's art
  seed. Seeded art is repainted whenever a floor's layout changes; unseeded art
  survives the stairs and is released with its asset group.
  Art drawn only inside buildings goes in a group the floor names in
  `LevelDef.interiorSpriteGroups`, not `spriteGroups` (the town's is
  `town_interior`: the rooms' ground and the Desperado Club's furniture), so it
  is painted behind a building's loading card instead of on the floor's
  arrival. See "Indoor-only art is painted at the door" in
  `docs/asset-management.md`. `npm run verify:environment-sheet-budget` checks
  that the largest set any position on a floor needs resident (floor-wide
  sheets plus the facades within `EnvironmentSheetResidentSet`'s ring) fits
  the sheet cache's budget; a floor's total may exceed it. Sheets nothing
  draws for `RECENTLY_DRAWN_FRAMES` of idle time are let go by the idle sweep.
  Art placed in the world whose memory should follow the party registers a
  resident set with the scene's `WorldResidency`: a family in a floor's
  `spriteGroups` is placed over the whole map and held for the visit by
  `environmentSheetPlacements` with no extra code, and a building's facade
  sheets are placed over each building that wears them. A new kind of art with
  positions of its own, too large to hold floor-wide, needs placements from
  where it is laid out (see "Memory follows the party within a floor" in
  `docs/asset-management.md`).
  Boss-room families are the exception to registering one by one: each room's
  plans live in `src/sprites/sheets/bossRooms/<room>Sheets.ts`, keyed by its
  asset group (`boss_trash_gremlin`, `boss_big_rooster`, `boss_krakaren`,
  `boss_grotesque_spider`, `boss_colosseum`) in `bossRoomSheets.ts`, and
  `requestEnvironmentSheetsForGroups` paints every declared one in a single
  loop. `npm run gates:boss-rooms` checks those sheets against the manifest.
- A multi-tile structure (a tent, a wagon, a village prop) is drawn whole from
  one **drawing tile** in its footprint's bottom row, so it sorts on its foot.
  The rest of the footprint only blocks. Give it one sheet per footprint
  envelope, one row per structure and one frame per variant, and make each frame
  exactly as wide as the footprint so a gate can catch ink running sideways onto
  walkable ground. Split tall (blocks sight) from low (seen past) by tile type,
  not by sheet. Examples: `villageSheets.ts` and `circusSheets.ts` (the tile
  side is in the "Circus grounds" section of `docs/town.md`). Anything that moves
  (flames, strings, balloons) is a live overlay read off shared anchors
  (`circusOverlayAnchors.ts`), not an extra sheet row. `gates:circus-art` is the
  model gate.
- When converting an existing PNG family, prove the port changed nothing:
  snapshot the sheets from git and run
  `npm run parity:props -- --family=<name> --ref=<dir>`. Every sheet must come
  through identical, or — for a difference you have understood and can justify —
  carry an entry in that script's `PARITY_BUDGETS` saying how large it is and
  why. The budget is a ceiling, so the check goes red again if it grows.

## Pipeline

1. **The painter and its layout.** For environment art this is a `PropSheetPlan` in `src/sprites/sheets/`, and the game paints it — see "Environment art is painted, not fetched" above; the `scripts/generate-*` entry points bake the same plans into `preview/props/` for review and never write into `src/images/`. For the remaining fetched sheets, a generator script under `scripts/` uses the `canvas` package (`createCanvas`) to draw each frame, tiles them into a grid (one row per state) and writes a PNG into `src/images/<category>/`. Either way the geometry constants — `FRAME_W`, `FRAME_H`, `TILE_SCALE`, `TILE_X`, `TILE_Y` — **must match the manifest entry**, and for a plan that agreement is proved by `propSheetPlanMismatches` rather than trusted.
2. **Manifest entry** in that category's `manifest.json`. Shape (`SpriteManifestEntry` in `src/core/SpriteLoader.ts`):
   - `path`, `frameWidth`, `frameHeight`
   - `tileX`/`tileY` — top-left of the logical tile within each frame (anchor offset)
   - `tileScale` — tile size the art was drawn at (runtime scales by `tileSize / tileScale`)
   - `states: { <name>: { row, colOffset?, frameCount } }` — standard state names: `walk`, `idle`, `attack`, plus `gore_*` colOffset states for body-part gore
   - optional `tileTypeId`/`blockedRegions` for environment collision
3. **Loader**: `src/core/SpriteLoader.ts` imports every category `manifest.json` and merges them; `SpriteKey` and `SpriteStates` are **compile-time types derived from the JSON**, so a new manifest key is immediately type-safe. A brand-new manifest _file_ (new category, or a boss with its own manifest) must be added to the import list at the top of `SpriteLoader.ts`. `loadSprites()` preloads everything; missing files are skipped silently — a blank sprite at runtime usually means a path typo.
4. **Draw wrapper**: `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite(...)`. It picks a state from animation flags and calls `drawSpriteKey(ctx, key, state, frame, sx, sy, tileSize, { flipX, alpha, rotation })` from `src/core/SpriteRenderer.ts`. Frame helpers: `walkFrameIndex(walkFrame, count)`, `progressFrameIndex(progress, count)`, `timeFrameIndex(...)`.

## Conventions

- Manifest keys are `snake_case` (`rat`, `goblin_base`); sprite modules are `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite`.
- Multi-layer sprites (e.g. goblin body + weapon overlay): separate manifest keys drawn at the same frame — see `src/sprites/goblinSprite.ts`.
- **Every off-screen surface has an owner.** Allocate with `allocCanvas(owner, w, h)` (or `allocReadableCanvas` for one read back with `getImageData`) from `src/core/canvasSurface.ts`, naming the specific `SurfaceOwner` the pixels belong to (add one to `SURFACE_OWNERS` for a new pool). Resize with `resizeSurface`, never by assigning `width`/`height`, and call `releaseSurface` on every eviction and drop path so the pixels go back at once. A new cache gets a byte budget; `RecentSurfaceCache` (`src/core/recentSurfaceCache.ts`) is the ready-made LRU that never lets go of what was just drawn. The owners, their limits and how to measure them are in `docs/asset-management.md`.
- Reference shape (`src/sprites/ratSprite.ts`): attack anim → `attack` state via `progressFrameIndex`; moving → `walk` via `walkFrameIndex`; else `idle` frame 0. `flipX = facingX < 0`.

## Painted figures and the frame cache

Creatures are not sheets at all: each is a `FigureDef` (`src/sprites/figure/figureDef.ts`) whose `paintFrame` is baked into cells on demand by `src/sprites/figure/figureFrameCache.ts` (`drawFigureCached`). The `bipedal-figure` skill owns the painter pipeline; these are the cache contracts a figure opts into or must respect:

- **Per-figure budget.** Every figure's cells are held to a 24 MB default under a global ceiling (`CACHE_BUDGET_MEGABYTES`, 188 MB, sized for a town plaza's pinned crowd plus the player, and for level 3's arrival warming the crowd, the fairies and both crawlers at once). `FigureDef.budgetMegabytes` replaces the default for one figure, and is legitimate only for a figure on screen almost every frame whose rows that must stay warm _together_ (locomotion, idle, whatever it is doing now) outgrow the default on their own. It never raises the global ceiling, so the room comes out of every other figure's share. Anything that checks a figure's bytes — admission, gates — goes through `figureByteBudgetFor(def)`, never `FIGURE_BYTE_BUDGET`, which only the cache's own gates read. Carl declares one (`HUMAN_FIGURE_BUDGET_MEGABYTES` in `humanFigure.ts`, 67 MB), and so do Donut (`CAT_FIGURE_BUDGET_MEGABYTES` in `catFigure.ts`, 28 MB) and the Necromancer. Carl's is gated by G9b per motion set in his hand (bare 55.55 MB, 57.3 MB carrying with front layers; light one-hander 64.1 / 66.2 MB; heavy 49.2 / 52.3 MB; two-hander 35.6 / 37.8 MB): the light one-hander's blow family is the largest working set he has, and it sized the number.
- **`skipSupersample`.** Cells are normally painted at twice the density and downsampled. A figure that composes itself on a scratch surface at whatever density it is painted at, with whole-pixel effects (a one-pixel outline, a two-pixel cast shadow), sets this: its edges are already antialiased, and supersampling would compose four times the pixels only to smear those effects into half-pixel blurs.
- **Two-layer cells (`FigureDef.heldLayers`).** A frame that holds a runtime-chosen item is painted in one pass into the whole cell and a front layer (what lies in front of the item), and the cache stores the front cropped to its ink beside the cell; `drawFigureCached(..., between)` draws cell, the item, then the front. The crop is charged to the row's bytes. Measured cost: a front crop is usually a fist's worth of pixels (Carl's largest is 58×104 px); over Carl's whole working set the crops add 1.7–2.1 MB (about 3–4%), over Donut's tool rows about 0.1 MB. A scripted prop (hammer, dynamite, crate…) is baked between the two layers at bake time through the same `compositeHeldItem` (`src/sprites/held/heldComposite.ts`) the runtime uses, so a cell with a prop painted into it needs no front layer at draw time. Carl's front crops and his carrying working set are measured by G9b (see `bipedal-figure/references/gates.md`).
- **Outfit variants and `releaseFigure`.** A cell is keyed on `(figure, state, frame)` and shared by every draw, so a closed set of looks is a set of figures, each with its own id and the same rows. Only the variant on screen should be resident: `releaseFigure(def)` drops every cell and queued prewarm of a replaced figure at once, instead of waiting out `IDLE_FRAMES_BEFORE_RELEASE` with two working sets side by side. `setOutfit` (`src/sprites/outfits.ts`) releases a crawler's old outfit and prewarms the new one; anything that queued rows for the old outfit must ask again.
- **Attachments on Carl's rig.** A humanoid built on Carl's rig grows extra anatomy or clothing (wings, a tail, horns, trousers) through `CarlAttachments` (`carl/figure.ts`, passed as `CarlComposeOptions.attachments`), so the parts share his silhouette outline and cast shadows instead of reading as stickers. The Incubus (`incubusArt.ts`, `incubusFigure.ts`) is the worked example; see the `bipedal-figure` skill.
- **`prewarmFigureState(def, state, frameLimit?)`.** `frameLimit` warms only a row's first frames — a blow's wind-up up to its impact frame — so the rest can bake while those play. Repeated requests for the same row merge to the larger limit.
- **The cache caps are tunable numbers, not platform limits.** `CACHE_BUDGET_MEGABYTES` (188), the 24 MB per-figure default, Carl's 67, Donut's 28 and the held-art cache's `HELD_ART_BUDGET_MEGABYTES` (4) were chosen to catch leaks and to stay far below the old sprite-sheet era (about 800 MB decoded). None is a device ceiling. When a figure genuinely needs more room, measure the need (G9b for Carl, cat G9 and `bench:turn-residency` for Donut), raise its number to that measurement with a little slack, and say why in the constant's JSDoc — never raise one to make a red gate pass without the measurement.
- **Held item art has its own cache.** A held visual (`src/sprites/held/`) is not part of any figure: `drawHeldVisual` in `heldVisualCache.ts` draws it at a socket transform from pictures keyed by look id × on-screen angle step (`AXIS_ANGLE_STEPS`, 32) × foreshortening step (`FORESHORTENING_STEPS`, 4) × flat/edge-on × mirrored × reversed × lit/shaded × phase. Each picture is painted already turned to its step (so the key light falls correctly for that angle) and cropped to its ink; the blit turns and stretches only the residue, so a swing never visibly snaps. Least-recently-drawn pictures go first past `HELD_ART_BUDGET_MEGABYTES`; it survives a canvas recovery. Measured: the Fury of Taranis in every look it has (3072 pictures, three crackle phases) is 5.4 MB at cell density, 0.5 s to paint in node; the common subset (lit, flat, one handedness) about 0.67 MB. Painting at twice the cell density measured 20.9 MB with no visible difference at the tile, so `HELD_ART_SUPERSAMPLE` is 1. `measureHeldVisualSet(def)` reports one look's whole set; `heldVisualCacheBytes()` / `heldVisualCacheCount()` what is resident. `paintHeldVisual` (`heldPaint.ts`) is the uncached path, used at bake time and for icons.
- **The crawlers hold every view warm.** Carl and Donut are drawn through one facing model (`src/sprites/facingView.ts`: eight 45° sectors, five views, a hysteresis margin), and each holds the rows a turn changes warm in every view they are drawn in, for as long as they are on screen: Carl's `residentViewSpans(set)` in `humanSprite.ts` for the motion set in his hand (every always-drawn row whole, every opening blow to its impact frame; a weapon out swaps the bare-handed rows for its own) and Donut's `RESIDENT_VIEW_ROWS` in `catSprite.ts` (walk, idle, swipe and cast in every view). Both are held by a `ResidentRows` (`src/sprites/figure/residentRows.ts`) from the crawler's own draw function, on the cache's clock: every draw touches each held row and re-queues any that is cold. It runs from the draw path, not a tick, because a world halted under a menu keeps drawing but stops ticking, and a tick-paced re-ask let the sweep take the far views during a long menu; it also notices a flushed cache on the next draw. Without it the idle sweep releases a view he has not faced for its release window, and the turn back into it bakes on the render path. Only the view faced and its two neighbours was tried and rejected: a keyboard turns a crawler a quarter or a half turn in one tick, and a half turn from head-on lands on the away view, which is never a neighbour. Measured headlessly by `npm run bench:turn-residency` (real cache, node bakes, about three times Chrome's cost) after a 12 s run one way and a snap turn, at 60 Hz:

  | Carl, full bake                | nothing held            | view and neighbours held | every view held |
  | ------------------------------ | ----------------------- | ------------------------ | --------------- |
  | run east, snap a quarter north | 7 cold frames, 3 direct | 0                        | 0               |
  | run east, snap a quarter south | 7, 3 direct             | 7, 3 direct              | 0               |
  | run south, snap a half north   | 7, 3 direct             | 7, 3 direct              | 0               |
  | run north, snap a quarter east | 7, 3 direct             | 7, 3 direct              | 0               |
  | stand north, snap a half south | 8, 0 direct             | 1, 0 direct              | 0               |
  | Carl resident at the end       | 3.7–12.9 MB             | 16.5–22.1 MB             | 18.4–25.5 MB    |

  The low-end bake scale gives the same pattern at a quarter of the bytes, and a fast circle-strafe (a turn a second) is clean under all three, because every view is visited inside the window. Holding every view adds nothing to the budget: those spans are the always-warm core `G9b` already sizes (55.55 MB of Carl's 67 MB bare-handed). With a weapon out, his resident spans are that motion set's own rows (`residentViewSpans(set)`); `bench:turn-residency` runs every scenario with each set out too, all with no cold frame, peaking at about 40 MB bare, 67 MB light, 49 MB heavy and 31 MB two-handed at full bake scale. Each of Carl's views costs about 5.7 MB of always-drawn rows plus 1.4–2.1 MB of opening wind-ups at full scale, so every view he gains raises that working set by roughly 7 MB, and his `budgetMegabytes` with it. Donut's turning rows are 12.5 MB at full scale (all 38 of her rows warm at once would be 31.25 MB); with what else she holds warm, her own 28 MB ceiling is sized in "What Donut holds" below. Her idle breaks are in no view's resident set, so the animator queues the next break's row a lead ahead of playing it.

- **A throwing painter cannot poison later cells.** When a painter throws mid-bake, the cache discards the scratch surface it was painting on (a `save()` of the painter's own may still hold a clip and an alpha under the cache's restore) and rethrows; the next cell gets a fresh surface. `gates:figure-cache` asserts it. Painters should still restore their own state in `try/finally` — `withClip` in `src/sprites/art/softShade.ts` does.

## Animation cadence

A sprite row is sampled by however many game ticks the motion driving it lasts.
Past one sprite frame per tick the row is undersampled, not played — frames are
skipped, the legs jump between non-adjacent poses, and it reads as vibration or
a freeze. Nothing in typecheck, lint, the sheet, or a contact sheet shows it; it
is only visible in motion, at the real speed. This has bitten three separate
creatures here, in three disguises:

- A small fast creature on a distance-driven walk phase. A juvenile raptor's
  stride is 0.31 tiles, so covering the speed its AI asks for needs twelve
  strides a second — ninety-odd frames a second out of an eight-frame row.
  Neither the art nor the constant can fix it: a stride long enough to sync
  would step further than the leg extends and the reach gate rejects it. Cap
  the cadence with a ceiling derived from the fastest real locomotion
  (`MONGO_UNDERSAMPLING_FRAME_LIMIT` in `mongoSprite.ts` and
  `MAX_WALK_FRAMES_PER_TICK` in `Mongo.ts` are the pattern), so raising the
  sprint speeds the legs up with it instead of clamping to a stale number.
- A creature that changes speed for one state. A charging Tuskling sampled at
  the walk cadence skipped frames and read as vibrating rather than sprinting;
  the charge run needs its own frame counter at its own hold, not `walkFrame`.
- The dominant unbounded displacement is usually not the creature. The mob
  separation pass shoves an overlapped mob a large fraction of the overlap —
  several times its own per-frame step — so a distance-driven gait re-opens
  the strobe simply because the player stood next to it. Measure cadence from
  pixels actually covered and put a ceiling on it.

Two related traps: a preview scene that plays a row at a different fps than the
game does hides all of this (five rounds of art review missed a strobe because
the harness ran at 12 fps against a shipping 30) — derive the harness's
playback from the shared timing constant. And when a runtime frame count and a
bake gate must agree, put both on one shared timing module imported by the
generator and the runtime; a gate that parses frame counts out of source with a
regex silently passes the moment those literals become named constants.

## Views for a horizontal-bodied animal

Head-on and away views of a long, low animal are not a geometric projection of
the profile. A depth-ordered true projection of a raptor was measured to be
correct and was unreadable: the head could not be found at 32 px, the axial
views came out a third shorter than the profile, and the bite punched through
the floor. This game's convention — set by the rat's walk row — is head at the
top with any crest above it, body below, tail swept off the centreline. Follow
it.

## Donut: views, west twins, and why she has no three-quarter view

Donut (`src/sprites/art/catArt.ts`, `catFigure.ts`, `src/sprites/catSprite.ts`)
has hand-authored rows head-on, in profile and from behind. Her tortoiseshell
coat is not symmetric, so **no row of hers is mirrored at runtime**: every
profile row has a `_west` twin, the same pose painted by `drawCatSide` mirrored
with her left flank's coat (`LEFT_FLANK`: black, a ginger saddle over the
shoulder, a black face with a ginger cheek by the muzzle). Facing east she
shows her right flank, facing west her left, and her patches never swap sides
as she turns. The light falls from the upper right in the west twins, as it did
when the profile was flipped. The twins cost 40 cells (3.9 MB); walk, idle, swipe and cast
twins are in the resident set, while `knocked_out_west`, like `knocked_out`, is not; `catCellFor` always returns `flipX: false`.

A facing with no rows of its own is drawn through `CAT_VIEW_FALLBACK` in
`src/sprites/catViews.ts` (`catRowViewOf`): both three-quarter facings draw her profile, east or west.
`OWN_ROWS` is typed against that table, so removing a fallback entry is a
compile error until that view's rows are named.

**Three-quarter views were built and rejected by blind review.** Walk and idle
were authored once in her own body space (forward, left, up): ellipsoid parts
(barrel, chest ruff, belly, haunches, skull, cheek ruffs, muzzle) each placed
by its own per-frame position, so the trunk turns its chest and hips with the
pose; legs solved by a two-bone IK in the plane of her spine; the tail as a
chain bent in body space; every coat patch a direction on a part's surface,
projected and foreshortened by how squarely it faces the camera. They were
projected through a camera yaw of ±45° and ±135° at a 26° downward pitch and
painted by the same fur engine. Within a row nothing turned or popped (the
turntable failure Carl's attempt had, recorded in `bipedal-figure`'s
`references/carl.md`, did not happen), and reviewers named every row's view
correctly. It failed on what her coat does at 32 px:

- **Away from the camera** (two review rounds plus scouts): the back and rump
  are her most patched surfaces, and from behind at 45° they break into "a
  jumbled patchwork", "a lump with a tail"; a ginger patch over the shoulders
  read as "a hump or backpack", and the back of the head merged into the back.
- **Toward the camera, facing west**: her left cheek is black, so the turned
  face is a dark block with one green eye a pixel or two wide that comes and
  goes as the head bobs across the pixel grid ("a dark helmet, not a face"). It
  passed one round and failed the confirming one.

Fixes tried: ginger patches on the back and the back of the head (cured "a
different, black cat from behind", caused the hump); cheek ruffs tucked
behind the skull from behind, ears painted over the skull from behind, a
deeper shadow at the nape (the head became a dome with two ears and still
merged at 32 px); the tail carried higher and hooked so it did not drag
toward the camera; eyes painted 1.35× larger and the head held steady against
the spine's sway. A future attempt needs fewer, larger patches on the surfaces
a three-quarter view shows (her back, rump and left cheek), a coat decision,
not a projection one. Reviewers on the same strips also judged the shipped
cardinal rows harshly ("stubby nubs" for legs, a tail "like a stick"), so
weigh a complaint by whether it is specific to the new view.

Renders and the whole attempt as a patch (against commit `68d506c`) are
kept locally under `preview/donut-diagonal/` (the preview folder is not
committed): `round1-strip32.png`, `round2-strip32.png`,
`front-diagonal-confirm-strip32.png`, `back-diagonal-zoom.png`,
`front-diagonal-zoom.png`, `cardinal-calibration-strip32.png`,
`west-profile-strip32.png`, `donut-diagonal-spike.patch`. Measured cost had it
shipped: eight walk and idle rows in the toward and away views each way, 64
cells, 6.25 MB; all of her rows warm would have been 25 MB, over the 24 MB
default.

## Donut's garments

Everything Donut wears is a `GarmentDef` (`src/sprites/garments/`): her coat
(`cat_coat`, the base garment that paints every piece of her fur), the Eyes of
Splatter, the crown, the kettle helm, the slate butterfly talisman, the fae
scale crupper and the bracelet of DEX. Her anatomy (`catArt.ts`) never paints
fur itself: it hands each piece to a `CatDressing` with a part frame
(`catParts.ts`), and every garment covering that part paints there, so later
pieces cover it like fur. `setOutfit('cat', garments)` (`src/sprites/outfits.ts`)
dresses her sprite; the figure id is `cat` bare, else `cat:<sorted garment ids>`.
An item's `look` in `ItemDefs.ts` names the garment. Gate:
`npm run gates:equipment -- --item=<item or garment id>` (E5, the envelope).

What review found at the 32 px tile, after four rounds of fresh blind
reviewers (renders kept locally in `preview/donut-garments/`):

- **Every garment is named and placed right**: crown on her head, helm on her
  head with the ears hidden, a charm at her throat, scale armour over her rump,
  a gold band on her right foreleg. Each stays on her own side facing west.
- **The talisman reads as a bow, not a butterfly.** The charm is about 5×3 px
  head-on. Tried: larger wings, a dark body line, splayed antennae, a brighter
  slate; at that size two wing lobes and a pinch are all a butterfly can be.
- **The bracelet is about 3×2 px** on a leg 2–3 px wide. Tried: a wider and
  taller band, a paler gold, a dark rim line, moving it onto the paw head-on.
  Reviewers name it, side and leg correctly, but call it small.
- **The crupper reads as cloth from far off**: the scales are one or two
  pixels. Tried: larger scales, darker scale edges. Head-on only her hips show
  it; a full head-on skirt read as a cushion she sits on.
- **The kettle helm's ear pockets read as "a hat with ears"** to a reviewer who
  is not told it is made for a cat. They are the cat-shaped part of the brief;
  they were lowered and widened once.
- **Lying down**, both hats are turned back against her head's tilt
  (`lyingTipBack`): turned with her head they covered her face.

## What Donut holds: sockets, her tool swing and her jaws

Donut holds two kinds of thing (`src/sprites/held/gripArchetypes.ts`):
`pawTool`, the axes, picks and the scythe Carl swings two-handed, held with
both forepaws on the haft; and `mouthCarry`, a small thing across her jaws.
`catGripOf(look)` (`src/sprites/art/catSockets.ts`) maps a held visual to the
grip she uses, so the tool tiers need no second definition.

- **Sockets** (`catSockets.ts`, `donutSocketsAt(figureId, row, frame)`,
  memoised per figure, row and frame): `mouth`, `forePaw` (under the pad of
  the paw on the haft's butt: screen-left head-on and from behind, the near
  paw in profile) and `back` (over her spine; nothing occupies it yet). Each
  comes from the placement functions the painter itself places her with
  (`catForepawFront/Side/Back`, `catMouthFront/Side`, `catSaddle` in
  `catArt.ts`), so a socket cannot disagree with the picture. A pose's
  `grip` (`CatGrip`) carries the haft's angle and depth and which slab it
  lies under. West twins are painted, not flipped, so their sockets come off
  the west painter's geometry: positions and axes reflected, and the pads'
  facing turned so the held picture is reflected rather than rotated.
- **Two layers.** Her painters lay her down slab by slab through `CatLayers`
  (`shadow`, `body`, `forepaws`, `head`); every slab from the held thing's
  cut onward is painted a second time into the cell's front layer. A tool
  lies under her forepaws (the pad, toe beans and hooked claws of a paw
  closed on a haft are drawn over the handle) and, when it is raised past
  her head, under her head too; from behind, a tool down in front of her lies
  under all of her. A carried thing lies over her head-on and in profile and
  under her head from behind. `FigureDef.heldLayers` on every outfit figure
  bakes them; `drawCatSprite(..., cell, held)` composites the thing between.
  Nothing of hers held is drawn at a hand-computed placement.
- **Rows.** `chop` and `mine` (a two-paw chop at wood, a two-paw pick at
  stone) in every view and west twin, played over `CAT_SWIPE_FRAMES`, the
  length of her swipe; the bite is `WORK_IMPACT_FRAME` (frame 4, from the
  ninth tick). A harvest's strike sound and effect fire on the tick the swing
  starts, not on the bite. Standing between swings with a tool out she holds
  it ready in her swing's opening frame; walking, the tool is not drawn (a
  harvest ends when she walks off). Putting the tool away mid-swing stops the
  swing. `carry_walk` and `carry_idle` in every view: jaws a little open, head up,
  ears forward. `CatPlayer.playWorkSwing` plays her tool's swing (a pick at
  stone, a chop at anything else, the swipe bare-pawed); a thing in her jaws
  comes from `setMouthCarry` or from her `Mouth:Held` item when its look is a
  `mouthCarry` one — no item of that kind exists yet, so `?donut`'s carry
  control shows the rows with `carried_wrench`.
- **Memory and warmth.** Those 16 rows are not in `PREWARMED_ROWS`:
  `HELD_ROWS` in `catSprite.ts` is warmed when the hold begins, the view she
  faces first, and while she holds something her resident set swaps
  (`RESIDENT_VIEW_ROWS_HOLDING`). Empty-pawed she also holds the opening
  frame of every swing in every view and both swings whole in the view she
  faces (`FACED_SWINGS`): her first swing comes 30 ticks after the tool, and
  seven layered cells bake slower than that from cold (8 cold frames at a
  harvest start were measured before it). Carrying, she keeps her own walk
  and idle too, so putting the thing down draws nothing cold. Her idle break
  is asked for ahead of the queue, since the faced swings queue as she turns.
  Measured at full scale: about 13 MB bare plus the faced swings (19–21 MB
  at a turn's peak), 15.75 MB of turning and swing rows with a tool out,
  18.75 MB carrying. Carrying peaked at the 24 MB default and its evictions
  drew cold cells, so she has `budgetMegabytes` 28. `bench:turn-residency`
  has a harvest start after a long stand in every facing, and a long carry
  put down and walked off.
- **Gates.** `npm run gates:equipment` runs E1–E4 and E7 on her
  (`scripts/gates-equipment-donut.ts`): socket under the butt paw's front
  ink and the haft through her second paw, a carried thing in the lower half
  of her face; nothing on the cell border or in the floor except a tool's
  head on its bite; no tool over her face unless a paw is there; a pad over
  the haft with the haft showing past both paws; west sockets the reflection
  of the east ones while the west cell is not the reflected east cell.
  `render:cat` G8 counts `HELD_ROWS` as warmed.

What review found at the 32 px tile (two fresh blind reviewers in a row,
renders kept locally in `preview/donut-hold/`):

- **The chop and the pick read in every view**: both reviewers named a calico
  cat chopping with an axe and swinging a pickaxe, facing the camera, side-on
  each way and from behind, with nothing major. Minors left: from behind the
  tool is out of sight on her first and last frames; the forepaws on the
  haft cannot be told apart at the tile (a paw is about 3 px, cream on her
  cream bib), so the haft can read as coming from her chest; a pick held
  straight up from behind reads as a T.
- **A thing across her jaws head-on reads as a muzzle or a gag.** Seen from
  the side it hangs from her mouth and reads as carried; from behind only its
  end shows past her head. Head-on her face is about 10 px wide and anything
  across her mouth covers its lower third. Tried: a larger thing (the potion
  bottle first, a red blob read as lips; then the wrench at Carl's size, then
  1.3×), cocking it off level, and seating it on her lower jaw below the
  mouth line. Each made the thing more visible and none stopped the face
  reading as strapped. Crosswise is the archetype's definition; a thing
  carried by one end, hanging from her jaws as the profile shows it, is what
  would read, and that is a different archetype.

## Checklist for a new creature sprite

1. Write the painter. Environment art: a `PropSheetPlan` in `src/sprites/sheets/`, baked for review into `preview/props/`. Everything else: a generator script writing a PNG into `src/images/<category>/`.
2. Add the manifest entry with matching geometry.
3. (Only if new manifest file) import it in `SpriteLoader.ts`.
4. Write the `src/sprites/*Sprite.ts` wrapper; call it from the creature's `render()`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
