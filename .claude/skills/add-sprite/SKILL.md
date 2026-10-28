---
name: add-sprite
description: Add or modify a sprite in Kitten Crawler World — sprite sheets (PNG or runtime-painted), JSON manifests, SpriteLoader/SpriteRenderer, offline generator scripts. Use when a creature, item, prop or effect needs new art or animation states. For a weapon, tool or garment the human or the cat holds or wears, use add-gear.
---

# Add a Sprite

> **Townsfolk, residents and citizens are NOT sprite sheets** — they are a closed cast of painted human and Hawkfolk looks, picked per citizen by seed. Use the `add-person` skill for those, not this pipeline.
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

Runtime rendering uses **sprite sheets described by JSON manifests** under `src/images/<category>/` (`effects/`, `environment/`, `interfaces/`, `website/`). Most are PNGs, produced offline by procedural generator scripts in `scripts/` or hand-drawn; the environment ones are painted by the game itself and have no file at all.

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
  `town_interior`: the rooms' ground and the Cloak & Dagger's furniture), so it
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
2. **Manifest entry** in that category's `manifest.json`. Shape (`SpriteManifestEntry` in `src/core/spriteAssets/SpriteLoader.ts`):
   - `path`, `frameWidth`, `frameHeight`
   - `tileX`/`tileY` — top-left of the logical tile within each frame (anchor offset)
   - `tileScale` — tile size the art was drawn at (runtime scales by `tileSize / tileScale`)
   - `states: { <name>: { row, colOffset?, frameCount } }` — standard state names: `walk`, `idle`, `attack`, plus `gore_*` colOffset states for body-part gore
   - optional `tileTypeId`/`blockedRegions` for environment collision
3. **Loader**: `src/core/spriteAssets/SpriteLoader.ts` imports every category `manifest.json` and merges them; `SpriteKey` and `SpriteStates` are **compile-time types derived from the JSON**, so a new manifest key is immediately type-safe. A brand-new manifest _file_ (new category, or a boss with its own manifest) must be added to the import list at the top of `SpriteLoader.ts`. `loadSprites()` preloads everything; missing files are skipped silently — a blank sprite at runtime usually means a path typo.
4. **Draw wrapper**: `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite(...)`. It picks a state from animation flags and calls `drawSpriteKey(ctx, key, state, frame, sx, sy, tileSize, { flipX, alpha, rotation })` from `src/core/spriteAssets/SpriteRenderer.ts`. Frame helpers: `walkFrameIndex(walkFrame, count)`, `progressFrameIndex(progress, count)`, `timeFrameIndex(...)`.

## Conventions

- Manifest keys are `snake_case` (`goblin_tent_a`); sprite modules are `src/sprites/<camelName>Sprite.ts` exporting `draw<PascalName>Sprite`.
- Multi-layer sprites (e.g. goblin body + weapon overlay): separate manifest keys drawn at the same frame — see `src/sprites/goblinSprite.ts`.
- **Every off-screen surface has an owner.** Allocate with `allocCanvas(owner, w, h)` (or `allocReadableCanvas` for one read back with `getImageData`) from `src/core/rendering/canvasSurface.ts`, naming the specific `SurfaceOwner` the pixels belong to (add one to `SURFACE_OWNERS` for a new pool). Resize with `resizeSurface`, never by assigning `width`/`height`, and call `releaseSurface` on every eviction and drop path so the pixels go back at once. A new cache gets a byte budget; `RecentSurfaceCache` (`src/core/rendering/recentSurfaceCache.ts`) is the ready-made LRU that never lets go of what was just drawn. The owners, their limits and how to measure them are in `docs/asset-management.md`.
- Reference shape (`src/sprites/ratSprite.ts`): attack anim → `attack` state via `progressFrameIndex`; moving → `walk` via `walkFrameIndex`; else `idle` frame 0. `flipX = facingX < 0`.

## Painted figures and the frame cache

Creatures are not sheets at all: each is a `FigureDef` (`src/sprites/figure/figureDef.ts`) whose `paintFrame` is baked into cells on demand by `src/sprites/figure/figureFrameCache.ts` (`drawFigureCached`). The `bipedal-figure` skill owns the painter pipeline; these are the cache contracts a figure opts into or must respect:

- **Per-figure budget.** Every figure's cells are held to a 24 MB default under a global ceiling (`CACHE_BUDGET_MEGABYTES`, 80 MB, sized for level 3's arrival warming the crowd, the fairies and both crawlers at once, 53.1 MB of stored ink crops). `FigureDef.budgetMegabytes` replaces the default for one figure, and is legitimate only for a figure on screen almost every frame whose rows that must stay warm _together_ (locomotion, idle, whatever it is doing now) outgrow the default on their own. It never raises the global ceiling, so the room comes out of every other figure's share. Anything that checks a figure's bytes — admission, gates — goes through `figureByteBudgetFor(def)`, never `FIGURE_BYTE_BUDGET`, which only the cache's own gates read. The human figure declares one (`HUMAN_FIGURE_BUDGET_MEGABYTES` in `humanFigure.ts`, 28 MB), and so do the cat's (`CAT_FIGURE_BUDGET_MEGABYTES` in `catFigure.ts`, 28 MB) and the Necromancer's. Bytes are what the cache stores: each frame cropped to its padded ink box, at the density it is drawn (see `docs/asset-management.md`). The human's is gated by G9b per motion set in his hand, baked through the cache and measured as stored (Ryan: bare 11.4 MB, 13.7 carrying; light one-hander 16.4 / 17.1; heavy 12.2 / 12.9; two-hander 9.9 / 10.6; Dave fully geared peaks at 22.0 carrying the light set): the light one-hander's blow family is the largest working set he has, and it sized the number. The cat's and the Necromancer's, and the 24 MB default, were sized from whole cells and are loose upper bounds.
- **`skipSupersample`.** Cells are normally painted at twice the density and downsampled. A figure that composes itself on a scratch surface at whatever density it is painted at, with whole-pixel effects (a one-pixel outline, a two-pixel cast shadow), sets this: its edges are already antialiased, and supersampling would compose four times the pixels only to smear those effects into half-pixel blurs.
- **Two-layer cells (`FigureDef.heldLayers`).** A frame that holds a runtime-chosen item is painted in one pass into the whole cell and a front layer (what lies in front of the item), and the cache stores the front cropped to its ink beside the cell; `drawFigureCached(..., between)` draws cell, the item, then the front. The crop is charged to the row's bytes. Measured cost: a front crop is usually a fist's worth of pixels (the human's largest is 58×104 px); over the human's whole working set the crops add 1.7–2.1 MB (about 3–4%), over the cat's tool rows about 0.1 MB. A scripted prop (hammer, dynamite, crate…) is baked between the two layers at bake time through the same `compositeHeldItem` (`src/sprites/held/heldComposite.ts`) the runtime uses, so a cell with a prop painted into it needs no front layer at draw time. The human's front crops and his carrying working set are measured by G9b (see `bipedal-figure/references/gates.md`).
- **Outfit variants and `releaseFigure`.** A cell is keyed on `(figure, state, frame)` and shared by every draw, so a closed set of looks is a set of figures, each with its own id and the same rows. Only the variant on screen should be resident: `releaseFigure(def)` drops every cell and queued prewarm of a replaced figure at once, instead of waiting out `IDLE_FRAMES_BEFORE_RELEASE` with two working sets side by side. `setOutfit` (`src/sprites/outfits.ts`) releases a crawler's old outfit and prewarms the new one; anything that queued rows for the old outfit must ask again.
- **Attachments on the human rig.** A humanoid built on the human rig grows extra anatomy or clothing (wings, a tail, horns, trousers) through `BipedAttachments` (`biped/figure.ts`, passed as `BipedComposeOptions.attachments`), so the parts share his silhouette outline and cast shadows instead of reading as stickers. The Demon Liaison (`demonLiaisonArt.ts`, `demonLiaisonFigure.ts`) is the worked example; see the `bipedal-figure` skill.
- **An effect laid out of figure cells.** Dave's teleport (`drawDaveSprite` in `src/sprites/daveSprite.ts`) builds every frame of the column of light, the band-by-band resolve and the edge flash from three cells of the shared cache (his standing cell, that cell in the light's colour, and its ring), indexed by frame alone, so it stores no frames of its own. Colours come from `worldInk.daveTeleport` (`src/ui/theme/worldInk.ts`). Reach for this before painting a one-off effect sheet for a figure; `npm run render:dave-teleport` reviews every frame at the 32 px tile.
- **`prewarmFigureState(def, state, frameLimit?)`.** `frameLimit` warms only a row's first frames — a blow's wind-up up to its impact frame — so the rest can bake while those play. Repeated requests for the same row merge to the larger limit.
- **The cache caps are tunable numbers, not platform limits.** `CACHE_BUDGET_MEGABYTES` (80), the 24 MB per-figure default, the human's 28, the cat's 28 and the held-art cache's `HELD_ART_BUDGET_MEGABYTES` (4) were chosen to catch leaks and to stay far below the old sprite-sheet era (about 800 MB decoded). None is a device ceiling. When a figure genuinely needs more room, measure the need (G9b for the human, cat G9 and `bench:turn-residency` for the cat), raise its number to that measurement with a little slack, and say why in the constant's JSDoc — never raise one to make a red gate pass without the measurement.
- **Held item art has its own cache.** A held visual (`src/sprites/held/`) is not part of any figure: `drawHeldVisual` in `heldVisualCache.ts` draws it at a socket transform from pictures keyed by look id × on-screen angle step (`AXIS_ANGLE_STEPS`, 32) × foreshortening step (`FORESHORTENING_STEPS`, 4) × flat/edge-on × mirrored × reversed × lit/shaded × phase. Each picture is painted already turned to its step (so the key light falls correctly for that angle) and cropped to its ink; the blit turns and stretches only the residue, so a swing never visibly snaps. Least-recently-drawn pictures go first past `HELD_ART_BUDGET_MEGABYTES`; it survives a canvas recovery. Measured: the Stormcaller in every look it has (3072 pictures, three crackle phases) is 6.7 MB at cell density, about 2 s to paint in node; only the looks actually drawn are ever baked. Painting at twice the cell density measured 20.9 MB with no visible difference at the tile, so `HELD_ART_SUPERSAMPLE` is 1. `measureHeldVisualSet(def)` reports one look's whole set; `heldVisualCacheBytes()` / `heldVisualCacheCount()` what is resident. `paintHeldVisual` (`heldPaint.ts`) is the uncached path, used at bake time and for icons.
- **The crawlers hold every view warm.** The human and the cat are drawn through one facing model (`src/sprites/facingView.ts`: eight 45° sectors, five views, a hysteresis margin), and each holds the rows a turn changes warm in every view they are drawn in, for as long as they are on screen: the human's `residentViewSpans(set)` in `humanSprite.ts` for the motion set in his hand (every always-drawn row whole, every opening blow to its impact frame; a weapon out swaps the bare-handed rows for its own) and the cat's `RESIDENT_VIEW_ROWS` in `catSprite.ts` (walk, idle, swipe and cast in every view). Both are held by a `ResidentRows` (`src/sprites/figure/residentRows.ts`) from the crawler's own draw function, on the cache's clock: every draw touches each held row and re-queues any that is cold. It runs from the draw path, not a tick, because a world halted under a menu keeps drawing but stops ticking, and a tick-paced re-ask let the sweep take the far views during a long menu; it also notices a flushed cache on the next draw. Without it the idle sweep releases a view he has not faced for its release window, and the turn back into it bakes on the render path. Only the view faced and its two neighbours was tried and rejected: a keyboard turns a crawler a quarter or a half turn in one tick, and a half turn from head-on lands on the away view, which is never a neighbour. Measured headlessly by `npm run bench:turn-residency` (real cache, node bakes, about three times Chrome's cost) after a 12 s run one way and a snap turn, at 60 Hz:

  | the human, full bake           | nothing held            | view and neighbours held | every view held |
  | ------------------------------ | ----------------------- | ------------------------ | --------------- |
  | run east, snap a quarter north | 7 cold frames, 3 direct | 0                        | 0               |
  | run east, snap a quarter south | 7, 3 direct             | 7, 3 direct              | 0               |
  | run south, snap a half north   | 7, 3 direct             | 7, 3 direct              | 0               |
  | run north, snap a quarter east | 7, 3 direct             | 7, 3 direct              | 0               |
  | stand north, snap a half south | 8, 0 direct             | 1, 0 direct              | 0               |
  | the human resident at the end  | 3.7–12.9 MB             | 16.5–22.1 MB             | 18.4–25.5 MB    |

  The low-end bake scale gives the same pattern at a quarter of the bytes, and a fast circle-strafe (a turn a second) is clean under all three, because every view is visited inside the window. Holding every view adds nothing to the budget: those spans are the always-warm core `G9b` already sizes. With a weapon out, his resident spans are that motion set's own rows (`residentViewSpans(set)`); `bench:turn-residency` runs every scenario with each set out too, all with no cold frame. Every view he gains adds its always-drawn rows and opening wind-ups to that working set, and his `budgetMegabytes` with it; re-measure with G9b. The cat's turning rows were 12.5 MB at full scale as whole cells (all 38 of her rows warm at once 31.25 MB); with what else she holds warm, her own 28 MB ceiling is sized in "What the cat holds" below. Her idle breaks are in no view's resident set, so the animator queues the next break's row a lead ahead of playing it.

- **A throwing painter cannot poison later cells.** When a painter throws mid-bake, the cache discards the scratch surface it was painting on (a `save()` of the painter's own may still hold a clip and an alpha under the cache's restore) and rethrows; the next cell gets a fresh surface. `gates:figure-cache` asserts it. Painters should still restore their own state in `try/finally` — `withClip` in `src/sprites/art/softShade.ts` does.

## Animation cadence

A sprite row is sampled by however many game ticks the motion driving it lasts.
Past one sprite frame per tick the row is undersampled, not played — frames are
skipped, the legs jump between non-adjacent poses, and it reads as vibration or
a freeze. Nothing in typecheck, lint, the sheet, or a contact sheet shows it; it
is only visible in motion, at the real speed. This has bitten three separate
creatures here, in three disguises:

- A small fast creature on a distance-driven walk phase. A juvenile Deinonychus's
  stride is 0.31 tiles, so covering the speed its AI asks for needs twelve
  strides a second — ninety-odd frames a second out of an eight-frame row.
  Neither the art nor the constant can fix it: a stride long enough to sync
  would step further than the leg extends and the reach gate rejects it. Cap
  the cadence with a ceiling derived from the fastest real locomotion
  (`DEINONYCHUS_UNDERSAMPLING_FRAME_LIMIT` in `deinonychusSprite.ts` is the pattern), so raising the
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
the profile. A depth-ordered true projection of the Deinonychus was measured to be
correct and was unreadable: the head could not be found at 32 px, the axial
views came out a third shorter than the profile, and the bite punched through
the floor. This game's convention — set by the rat's walk row — is head at the
top with any crest above it, body below, tail swept off the centreline. Follow
it.

## The cat: views, west twins, and why she has no three-quarter view

The cat (`src/sprites/art/catArt.ts`, `catFigure.ts`, `src/sprites/catSprite.ts`)
has hand-authored rows head-on, in profile and from behind.

**A cat's appearance is data.** Everything that makes a cat herself — her coat
tones and patch layouts per view and flank, face and eye colours, toe beans,
proportions (body, head, ear, ruff, cheek, leg bones, tail) and fur switches
(fringe scale, hair length, ruff, cheek ruffs, tail puff), her stance
(`legLift`, `neckDrop`, `profileLength`, haunch and chest radii, limb width,
paw size, `earSpread` across the skull), how she reads from behind
(`backView`: head size and height, ear height and inset, the `nape` share
that grows her neck down into her shoulders instead of leaving the skull a
disc on the body, `tailOverNape`, which paints a raised tail over her
nape — from behind it is the nearest part of her), her hind legs in profile
(`hindHock`: thigh width and the hock bone's share of the lower leg, drawn as
thigh, shank and hock bone; null keeps two bones like the forelegs), a faint
cool `coat.nearLegRim` inside the near legs' outline so a black coat's steps
survive a dark floor at the tile, her face (eye size and spacing as `eyeScale` /
`eyeSpread`, eye roundness, brow-whisker length and `browWhiskerAlpha`, how far the pale
inside of her ears reaches (`innerEar.reach`), `muzzleWidth` head-on, and
the optional marks: a `blaze` with its `bend` between the eyes, a mottled
nose, a `tooth` showing over her lip on one side, alternate whisker colour),
how deep her far legs sit in shadow in profile (`coat.profile.farLimbShade`,
which a dark coat needs more of to tell the pairs apart), and her `gait` —
plus the base garments every outfit of hers starts from — is a `CatLook`
(`src/sprites/looks/catLook.ts`). A look's neutral values (lift 0, scales 1,
no nape, no blaze or tooth) leave the engine's pixels exactly as they were,
which is how Pumpkin stays pixel-identical while Belle
(`looks/cats/belle.ts`) differs. Row poses take the look, and two kinds of row
differ by it: the tool swings, whose paws rise with her stance, and the walk —
`trot` is Pumpkin's, `lateralWalk` (`catLateralWalk.ts`) is Belle's
lateral-sequence walk; its timing (footfalls, the toward/away rows
sampled between footfalls so no two frames mirror) lives in that module,
not in the look. Her tooth (`drawFang`) is drawn slim in a warm off-white
and grows only to one surface pixel, which the 2× supersample softens to a
faint light pixel at the 32 px tile; `render:cat --mode=strip32` paints at
the in-game size the way the cache does, so it shows what the game draws.
G1's cell-fill floor is per look (`MIN_CELL_FILL_BY_LOOK` in
`scripts/gates-cat.ts`): a new look measures its widest pose's fill and
takes a floor a margin under it.
Pumpkin's is `PUMPKIN_LOOK` (`src/sprites/looks/cats/pumpkin.ts`), registered as
`CHARACTERS.pumpkin.look`; the player cat's is `PLAYER_CAT_LOOK` in
`catFigure.ts`. The engine names no tone: a `CoatBlob`'s `tone` is a
`CoatTone` colour triple the look declares, so a new coat is a new look file.
Every painter, `paintCatCell`/`paintCatPose`, `catFigureFor(look, outfit)` and
`catSocketsAt(look, row, frame)` take the look; nothing reads a module
constant for her colours or proportions. A figure id carries the look:
`cat:<look id>` bare, else `cat:<look id>:<sorted garment ids>`.

A tortoiseshell coat is not symmetric, so **no cat row is mirrored at
runtime**: every profile row has a `_west` twin, the same pose painted by
`drawCatSide` mirrored with the look's `coat.profile.flanks.left`. Pumpkin's
left flank is black with broad ginger patches over the shoulder and back, a
cream bib and a ginger cheek by the muzzle; Belle's carries a denser ginger
streak over the shoulder than her right, and her blaze and speckled tan
muzzle are on that side. Facing east a cat shows her right flank, facing west
her left, and her patches never swap sides as she turns. In the west twins the light falls from the upper right. The twins cost 40 cells (3.9 MB); walk, idle, swipe and cast
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
turntable failure the human's attempt had, recorded in `bipedal-figure`'s
`references/human.md`, did not happen), and reviewers named every row's view
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
kept locally under `preview/cat-diagonal/` (the preview folder is not
committed): `round1-strip32.png`, `round2-strip32.png`,
`front-diagonal-confirm-strip32.png`, `back-diagonal-zoom.png`,
`front-diagonal-zoom.png`, `cardinal-calibration-strip32.png`,
`west-profile-strip32.png`, `cat-diagonal-spike.patch`. Measured cost had it
shipped: eight walk and idle rows in the toward and away views each way, 64
cells, 6.25 MB; all of her rows warm would have been 25 MB, over the 24 MB
default.

## The cat's garments

Everything the cat wears is a `GarmentDef` (`src/sprites/garments/cat/`): her
coat (`cat_coat`, the base garment that paints every piece of her fur) and
whatever she puts on over it, registered as a `CatWornGarmentId` (none is
painted yet, so that union is empty). Her anatomy (`catArt.ts`) never
paints fur itself: it hands each piece to a `CatDressing` with a part frame
(`catParts.ts`), and every garment covering that part paints there, so later
pieces cover it like fur. `setOutfit('cat', garments)` (`src/sprites/outfits.ts`)
dresses her sprite; the figure id is `cat:<look id>` bare, else `cat:<look id>:<sorted garment ids>`.
An item's `look` in `ItemDefs.ts` names the garment. Gate:
`npm run gates:equipment -- --item=<item or garment id>` (E5, the envelope).
At the 32 px tile a garment is a patch of a few pixels on her: it reads by a
clean colour against her coat and a darker edge where it ends, and it stays on
her own side facing west.

## What the cat holds: sockets, her tool swing and her jaws

The cat holds two kinds of thing (`src/sprites/held/gripArchetypes.ts`):
`pawTool`, the axes, picks and the scythe the human swings two-handed, held with
both forepaws on the haft; and `mouthCarry`, a small thing across her jaws.
`catGripOf(look)` (`src/sprites/art/catSockets.ts`) maps a held visual to the
grip she uses, so the tool tiers need no second definition.

- **Sockets** (`catSockets.ts`, `catSocketsAt(look, row, frame)`,
  memoised per look, row and frame): `mouth`, `forePaw` (under the pad of
  the paw on the haft's butt: screen-left head-on and from behind, the near
  paw in profile) and `back` (over her spine, where a stowed party tool
  rides: behind her head-on, over her back in profile and from behind). Each
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
  comes from `setMouthCarry`, or from the quest item in her quest slot when it
  names `carriedInJaws` (the prison key, Tikka's blueprints). She has no mouth
  equipment slot.
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
- **Gates.** `npm run gates:equipment` runs E1–E4 and E7 on every cat look
  (`scripts/gates-equipment-cat.ts`, also runnable alone with `npx tsx` and
  an optional `--item=`): socket under the butt paw's front
  ink and the haft through her second paw, a carried thing in the lower half
  of her face; nothing on the cell border or in the floor except a tool's
  head on its bite; no tool over her face unless a paw is there; a pad over
  the haft with the haft showing past both paws; west sockets the reflection
  of the east ones while the west cell is not the reflected east cell.
  `render:cat` G8 counts `HELD_ROWS` as warmed.

How the holds read at the 32 px tile (renders in `preview/cat-hold/`):

- **The chop and the pick read in every view**, facing the camera, side-on
  each way and from behind. Their limits, on Pumpkin: from behind the tool is
  out of sight on the first and last frames; her forepaws on the haft cannot
  be told apart at the tile (a paw is about 3 px, cream on her cream bib), so
  the haft can read as coming from her chest; a pick held straight up from
  behind reads as a T.
- **A thing across the jaws head-on reads as a muzzle or a gag.** Seen from
  the side it hangs from the mouth and reads as carried; from behind only its
  end shows past the head. Head-on a cat's face is about 10 px wide and
  anything across the mouth covers its lower third. A larger thing, a thing
  cocked off level and a thing seated on the lower jaw below the mouth line
  each show more and still leave the face reading as strapped. Crosswise is
  the archetype's definition; a thing carried by one end, hanging from the
  jaws as the profile shows it, is what would read, and that is a different
  archetype.

## Belle: what her art depends on, and its limits

Belle's look (`looks/cats/belle.ts`) is a cute stylised dark tortoiseshell:
a round full-cheeked head, large dark ears leaning out (`ear.lean`,
`ear.straightEdges`), round aqua eyes with a big soft pupil and a forehead
above them (`face.eyeDrop`, `face.pupilHeight`), a small nose and gentle
mouth with no fang, short faint whiskers (`face.whiskerLength` /
`whiskerAlpha`), soft feathered coat patches, and a lateral-sequence walk of
her own. Cute outranks photo likeness: matched closely to the owner's photos
she read as uncanny. Her head is the same height head-on, from behind and in
profile (`head.ry` matches `profileHead.ry`, `legLift` and `neckDrop` put it
at the same height), so she reads as one size in every view. A light
`outline` round her whole silhouette keeps her shape on dark floors.

- **A walk is judged in motion.** Stills of a lateral-sequence walk look
  broken; a GIF or flipbook at game speed tells a walk from a bound. In
  profile the painter turns the legs with the body's `lean`, so more than a
  degree or two of rock lifts a planted pair off the floor together and the
  walk becomes a bound.
- **Toward and away at the tile** read as walking when the paws lift about
  two pixels and the row is sampled off the footfalls
  (`AXIAL_PHASE_OFFSET`); sampled on them, neighbouring frames mirror and the
  row stutters.
- **Legibility is a question of the floor.** A black cat's legs vanish on a
  plain dark background no level has. Over the floor tiles in
  `preview/tilesets/` they read on stone, concrete, grass and paving and
  fade only on the darkest bricks, which is what `nearLegRim` is for; a
  stronger rim turns her legs grey.
- **Head width against chest width is not a useful measure** of her
  likeness: it swings by ±15% with where a ruler is laid on a 20 px head.
- **Her coat is a few soft clouds, not brindle.** Many small crisp flecks
  read as scraggly speckle at 32 px. Her patches are large and feathered
  (`CoatBlob.feather`), and hair strokes take a feathered patch's colour as
  softly as it is painted, so the edges stay soft.
- **A black tail toward or away from the camera** only reads where it
  clears her body. Walking, it swishes out past her flank once a stride
  (`swishedTail` in `catLateralWalk.ts`), and standing from behind it leans
  out to one side. Drawn upright behind her head it reads as a horn or a
  third ear, and over her back as a flat paddle.
- **Her idle from behind sits at G3's noise floor**; see the design-debt
  register's entry on the cat's loop-seam gate before tuning her to it.

## Checklist for a new creature sprite

1. Write the painter. Environment art: a `PropSheetPlan` in `src/sprites/sheets/`, baked for review into `preview/props/`. Everything else: a generator script writing a PNG into `src/images/<category>/`.
2. Add the manifest entry with matching geometry.
3. (Only if new manifest file) import it in `SpriteLoader.ts`.
4. Write the `src/sprites/*Sprite.ts` wrapper; call it from the creature's `render()`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
