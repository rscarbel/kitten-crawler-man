# Design Debt

Places where the code is hacky, fragile, breaks a common industry practice, or will make later work harder. This is a long-lived register: entries come and go, and the file stays. An entry that matters gets its own plan; once that ships, the entry is deleted.

## Adding an entry

- Record what you find while doing other work, even if you can't fix it. Small fixes that are in scope for your task (a CLAUDE.md type-safety violation, a magic number in a file you're editing) are still fixed, not logged.
- Search this file first. If the problem is already here, extend that entry; don't add a second one.
- Describe the code as it is now. Point at files, functions, classes, constants or a quoted fragment — never line numbers, never a plan doc, never a conversation or task.
- Put the entry under the closest area heading. Add a heading if none fits.
- Delete the entry when the problem is gone. Don't mark it done.
- Never cite this file from code.

Entry shape:

```markdown
### <short name of the problem>

- **Where:** files, functions, constants.
- **Problem:** what is wrong, as a fact about the code now.
- **Cost:** what it makes harder or riskier, or which standard it breaks.
- **Better shape:** the direction a fix should take, in a sentence or two. Not a plan.
- **Until then:** what to avoid so it doesn't get worse. Omit if nothing.
- **Size:** S (an hour), M (a day), L (several days or a cross-cutting change).
- **Found:** YYYY-MM-DD, and the work that surfaced it.
```

---

## Creatures and spawning

### Mob construction rolls bypass the spawn context's random stream

- **Where:** `Mob`'s `noticeStagger` and `astarStagger` field initialisers (`src/creatures/Mob.ts`, through `randomInt`, which reads `worldRandom`), and creature field initialisers that call `Math.random` while being built (`EvilClown`'s `idlePhaseOffsetSeconds`, `BallOfSwine`'s `heading`, `Cockroach`'s `skitterPhase`, `NecroFairy`'s `effectSeed`, and others in `src/creatures/`).
- **Problem:** each kind's `create` on `MOB_KINDS` (`src/levels/mobKinds.ts`) receives the `SpawnContext`'s `random`, but only `Necromancer` keeps it; the base class and the other creatures roll from other streams while being built.
- **Cost:** a harness passing a seeded stream through the funnel still gets unseeded per-mob staggers and phases unless it also replaces `Math.random`, so a gate depending on them is not reproducible from the context alone.
- **Better shape:** hand the `create` stream to the `Mob` constructor and let the base class and every creature draw their construction rolls from it.
- **Until then:** don't add new `Math.random` rolls to a creature for anything a gate needs to reproduce; take the `random` its `create` is given.
- **Size:** M
- **Found:** 2026-10-21, spawn funnel work.

### A status effect does not remember whether a spell laid it

- **Where:** `Player.chillGrip` and `Player.magicResistedFrames` (`src/Player.ts`), `applyIceHit`'s `magic` option (`src/core/combat/frostStatus.ts`), `magicResistedBurn` (`src/systems/FairyFireballSystem.ts`), the grasping hands' `makeStuck` in `SkeletonLord` and `TheLich`.
- **Problem:** magic resistance shortens a magic status where it is applied, but the slow a chill exerts is read live off the status type, so `chillGrip` weakens every chill on a crawler on the grounds that only ice fairies chill one today. A `StatusEffect` carries no record of having come from a spell.
- **Cost:** a non-magic chill added later (a frost trap, an ice-mob bite) would be wrongly weakened by magic resistance, and each new magic status site must remember to shorten its own duration.
- **Better shape:** stamp the share that survived resistance on the `StatusEffect` when it is applied (saved with it), and have every status reader scale its grip by that share.
- **Until then:** a new chill source on a crawler that is not a spell must not ship without that stamp; a new magic status applier goes through `magicResistedFrames`.
- **Size:** M
- **Found:** 2026-10-27, stat sheet and magic resistance work.

## Creature art

### The Deinonychus is drawn as separately outlined pieces, so every join shows a dividing line

- **Where:** `src/sprites/art/deinonychusArt.ts`: `drawDeinonychusSide` paints the tail (`drawTailSide`), body (`drawBodySide`), thigh (`drawThighSide`), neck (`drawNeckSide`), head (`drawHeadSide`) and limbs (`drawLimb`) one after another, each closing with its own `fillAndOutline` stroke. The head-on and away views (`drawDeinonychusAxial`) use `paintUnion` for some shapes but not every join.
- **Problem:** each segment is filled and outlined on its own, so where one overlaps the next its outline is painted across the animal's body. In game the Deinonychus reads as plates laid on top of each other, with a clearly visible line at the neck, hips, thigh and tail base, rather than as one continuous animal.
- **Cost:** the pet looks assembled rather than alive, and each art pass that tunes a segment's shape moves the seams instead of removing them.
- **Better shape:** draw the body masses that should read as one surface (tail, torso, thigh, neck, head) as one silhouette with one outside outline, as `paintUnion` does: stroke every shape first and fill them all over the strokes, then paint shading and feathers inside the union with `insideUnion`. Keep separate outlines only where one part truly passes in front of another, such as the near wing or near leg over the flank.
- **Until then:** don't add another body segment with its own `fillAndOutline`; join new masses into a union.
- **Size:** M
- **Found:** 2026-10-28, owner review of the Deinonychus sprite.

## Townsfolk

### Two Hawkfolk civilian looks are painted and gated but never worn

- **Where:** `HAWKFOLK_CIVILIAN_LOOKS` (`src/sprites/art/hawkfolk/cast.ts`), `HAWKFOLK_ROLE_FOR_TOWN_ROLE` (`src/creatures/citizenFigure.ts`).
- **Problem:** the two `clerk` looks are in the civilian pool, but no `TownRole` maps to the Hawkfolk `clerk` role, so the street wears only 14 of the 16 civilian looks. The art and cast-motion gates still paint and check both.
- **Cost:** gate time and review effort spent on looks no player sees, and a "16 looks" count that overstates the street's real variety.
- **Better shape:** map a town role (`commoner` or `priest`) onto `clerk`, or move the clerk looks out of the civilian pool to wherever they are meant to be used.
- **Size:** S
- **Found:** 2026-10-21, town crowd variety tiers.

### Townsfolk legwear colours are module state swapped round each bake

- **Where:** `setTownsfolkLegwear` / `resetTownsfolkLegwear` and the `worn` binding in `src/sprites/garments/human/townsfolkLegwear.ts`, read only by the two cast garments `TOWNSFOLK_TROUSERS` and `TOWNSFOLK_SHOES`; callers `buildBipedFigure` (`src/sprites/art/townCastFigure.ts`) and `paintDemonLiaisonFrame` (`src/sprites/art/demonLiaisonFigure.ts`).
- **Problem:** the leg painters (`paintLegCloth`, the shoe painter) take their colours as arguments, but the two cast garments are shared by every cast look, so they pass the colours a module-level binding holds, which each bake sets in a `try` and resets in `finally`, while every other part of a figure on the biped rig reads its look from the compose options.
- **Cost:** two figures cannot be baked interleaved, a throwing painter between set and reset would leak colours into the next figure, and the two garments' paint depends on hidden call order rather than their inputs.
- **Better shape:** carry the legwear on the look (or build the two garments per look, as `DAVE_TROUSERS` is built on a fixed denim) so the painters read it from their frame, as the torso garment reads `frame.look`.
- **Until then:** don't add another setter of this kind for a garment; put new per-look garment data on `HumanLook`, or give the look a garment of its own that passes its colours to the painter.
- **Size:** S
- **Found:** 2026-10-23, moving the biped rig's look into `HumanLook`.

## Town and interiors

### Interior prop art heights are a string-keyed table read by fallback

- **Where:** `PROP_ART_HEIGHT_TILES`, `frameHeightFor` and `frameHeadroomTilesFor` in `src/sprites/art/townInterior/townInteriorProps.ts`; `paintHearth`, which reads `frameHeightFor('hearth')`.
- **Problem:** the table is a `Record<string, number>` read with `?? 1`, because the prop ids are themselves derived from `TOWN_INTERIOR_PROPS`, whose `def` calls read it. `paintHearth` asks for `'hearth'`, which is no prop id and has no row, so the generic hearth's chimney breast is one tile tall by the fallback while the `hearth_wide` row it was meant to read says 1.6.
- **Cost:** a misspelled or renamed id compiles and silently paints and frames its prop at the one-tile default; nothing ties a row to a prop.
- **Better shape:** the art height as a field each `def` passes in, so the table and the lookup by name go away.
- **Until then:** read a prop's height through its own id, never a shared name like `'hearth'`; add a row for every new prop taller than a tile.
- **Size:** S
- **Found:** 2026-10-26, interior fire props.

### An interior holds each scripted encounter by its own type beside `encounter`

- **Where:** `BuildingInteriorScene`'s `starlightTentMaze`, `towerConfrontation` and `prison` fields, each also stored in `encounter`; the reads of them in `scriptOwnsParty`, the `update` dialog returns, the Space and tap chains, `cameraFocus`, the sorted render pass and `mountSurfaces`.
- **Problem:** `InteriorEncounter` covers update, drawing and teardown, but whether an encounter locks the party, owns a conversation, takes a press, moves the camera or adds figures is asked of each concrete system by name, so the scene grows a branch per encounter.
- **Cost:** a new scripted room means editing every one of those sites in the scene; missing one (a tap chain that does not know the new encounter locks the party) compiles.
- **Better shape:** optional members on `InteriorEncounter` for each of those questions (`playerLocked`, `isDialogOpen`, `tryInteract`, `sortedFigures`, `cameraTarget`, `surfaces`), asked through `activeEncounter`, so the typed handles go away.
- **Until then:** give a new encounter what it needs through `InteriorEncounter` and the fixtures `startEncounter` hands it (the storey's chest placer and exit fixtures) rather than another typed field on the scene. A new scripted walk or talk is a `CutsceneStep` list played on the scene's `CutsceneKit`, never another `playerLocked` flag beside the tower's and the prison's.
- **Size:** M
- **Found:** 2026-10-26, interior chests and exit fixtures; extended 2026-10-27, cutscene director.

### Readables keep their own copy of the occupant furniture scan

- **Where:** `scanFurniture` and `pickTile` in `src/systems/InteriorReadableSystem.ts`, beside `scanInteriorFurniture` in `src/systems/InteriorOccupantSystem.ts`; the `occupiedFurniture` set the occupant system hands the readables.
- **Problem:** the readable system re-walks the grid and the placed props itself, filtered to its own anchor kinds, and seats a readable on a prop's north-west tile, while occupants scan whole footprints. The two agree only because each piece is keyed by its north-west tile in both.
- **Cost:** a change to how furniture is scanned (a new source, a footprint rule) has to be made twice, and a readable on a wide prop sits on its end rather than its middle.
- **Better shape:** one furniture scan returning footprint pieces, read by both systems, with the readable seated at the piece's centre.
- **Until then:** don't add a third scan; key claimed furniture by the piece's north-west tile so the two keep agreeing.
- **Size:** S
- **Found:** 2026-10-26, footprint-aware occupant placement.

### The club's counter staff are hand-built figures, not occupants

- **Where:** `buildFixtureFigures`, `castFigure`, `donaldFigure` and `dealerFigure` in `src/systems/CloakAndDaggerSystem.ts`; the club's stations in `CLUB_STATIONS` (`src/core/club/clubLayout.ts`), which the club routes talk through itself.
- **Problem:** the club's host (Brandon) is a rostered occupant placed on a `mark`, but the bartender, the market vendor, Deuce and Donald are still `InteriorFigure` closures on fixed tiles, and their counters open through the club's own station routing rather than as occupant services. The club's shops are `ShopSystem`s, which the occupant `service` union has no member for.
- **Cost:** those four can't take a territory, routine or service the way any other resident can, and every change to how residents are drawn or talked to has a second path in the club.
- **Better shape:** give `OccupantService` a member for a `ShopSystem` counter (and one for the casino's game picker), roster the four as occupants on `mark` placements, and keep `InteriorFigure` for furniture, stages and seated gamblers.
- **Until then:** stand any person the club adds through the club's occupant roster in `BUILDING_OCCUPANTS`, not as a new direct painter call in `CloakAndDaggerSystem`.
- **Size:** M
- **Found:** 2026-10-26, interior cast placement and figures.

### An exit fixture's art is drawn by whatever stands behind it, not by the fixture

- **Where:** `INTERIOR_EXIT_FIXTURES` and `InteriorExitFixtureSystem` (`src/systems/interiorExitFixtures.ts`), which own a fixture's prompt, departure and sound but draw nothing; the Starlight Tent's rope ladder and roof flap, painted by `drawTentPoleTile` (`src/map/tiles/tentPoleTiles.ts`) on every pole 2 × 2 or larger through `paintRopeLadder` / `paintRoofFlap`; the fixture placed separately by `StarlightTentFinale` at `MAZE_RING_CENTRE_TILE`.
- **Problem:** the ladder you see and the ladder you use are two pieces of data that agree only because the king pole happens to stand just north of `MAZE_RING_CENTRE_TILE`. Any 2 × 2 pole in another room would grow a ladder with no fixture under it.
- **Cost:** moving the pole, the tile or adding a second big pole breaks the match silently; a second exit fixture kind (a trapdoor, a window) has nowhere to put its art.
- **Better shape:** an art field on each `INTERIOR_EXIT_FIXTURES` entry (a painter and its anchor), drawn by the fixture system in the Y-sorted pass at the placed tile, with the pole drawing only the mast.
- **Until then:** place the rope ladder only under a king pole's south face, and give any new fixture kind its art through the fixture, not through the tile under it.
- **Size:** S
- **Found:** 2026-10-27, Starlight Tent finale.

## Rendering and memory

### The game's memory tally misses about 40% of what Chrome counts

- **Where:** `surfaceTallies()` in `src/core/rendering/canvasSurface.ts`, `src/dev/perfMemory.ts`.
- **Problem:** the tally counts canvas pixels the game allocated, decoded audio and the JS heap. It doesn't count GPU-side copies, the compositor or decoded images held by the browser.
- **Cost:** in the siege the tally read about 725 MB while Chrome reported 1.2 GB for the tab. Budgets tuned against the tally leave less headroom than they appear to.
- **Better shape:** keep the tally, but tune budgets against measured browser totals: Chrome's Task Manager, and `performance.measureUserAgentSpecificMemory` where it is available.
- **Size:** S
- **Found:** 2026-10-21, siege blackout.

## Testing and gates

### The cat's loop-seam gate counts noise on a near-still row

- **Where:** `gateLoopClosure` in `scripts/gates-cat.ts` (G3, `LOOP_SEAM_CEILING`), on the idle rows from `idleFront` in `src/sprites/art/catFigure.ts` as Belle's look paints them.
- **Problem:** the seam ceiling is a ratio of ink pixels that toggle between frames. Belle's short, smooth coat makes her idle from behind change only 11–31 px a frame, so the seam's count sits within a pixel or two of the ceiling and flips pass/fail on unrelated proportion changes (a barrel 0.005 tiles wider). `idleFront`'s head tilt runs at half the cycle's rate (`Math.sin(angle * 0.5)`), which is what moves most at the seam.
- **Cost:** the gate fails and passes on noise for a quiet row, so a real seam pop on it would be hard to tell from a jitter, and tuning a look to the gate is tempting.
- **Better shape:** give the seam test a pixel floor below which a step counts as still (as the floor test already has a share), and make the idle's head tilt a whole-cycle wave once Pumpkin's idle may change pixels.
- **Until then:** don't tune a look's proportions to land under the ceiling; look at the seam with `scripts/render-cat.ts --mode=delta` first.
- **Size:** S
- **Found:** 2026-10-23, Belle's art.

### Creature byte gates count whole cells, not what the figure cache stores

- **Where:** the warm-row gates (`gateWarmRowSize` and its kin) in `scripts/gates-*.ts` for every creature but the human, which multiply `frameWidth * frameHeight * BYTES_PER_PIXEL` by frame counts; the fleet default `FIGURE_BUDGET_MEGABYTES` and the global `CACHE_BUDGET_MEGABYTES` in `src/sprites/figure/figureFrameCache.ts`, and the `budgetMegabytes` of the cat, the Necromancer and the Trash Gremlin, all sized from whole-cell arithmetic.
- **Problem:** the cache stores each frame cropped to its ink (`CELL_CROP_PADDING_PX`), typically a fifth to a sixth of the whole cell, so these gates and budgets are upper bounds several times what is held. Only the human's G9b measures what is stored (`storedRowBytes` in `scripts/figureGates.ts`).
- **Cost:** a budget several times its need cannot catch a leak or a runaway working set until it is that many times worse; a whole-cell gate fails a long row whose crops would fit easily.
- **Better shape:** measure each figure's working set through `storedRowBytes` (the human's G9b is the pattern), then size each budget from that measure.
- **Until then:** don't size a new budget from whole-cell arithmetic without saying it is an upper bound; don't lower a budget below a whole-cell gate's sum without moving that gate to stored bytes first.
- **Size:** M
- **Found:** 2026-10-24, cropping the figure cache's cells to their ink.

### No gate runs in a real browser

- **Where:** every `verify:*` / `gates:*` script; they run headless on canvas stand-ins.
- **Problem:** canvas context loss, GPU memory pressure and what the screen actually shows are never exercised.
- **Cost:** on 2026-10-21 every gate was green while the siege repeatedly blanked and repainted in Chrome. A class of regression the player sees first is invisible to the gates.
- **Better shape:** a small headless-Chrome smoke suite for the heaviest scenes (the siege at wave 2, a town arrival) that counts canvas recoveries and long frames. It would count events, never milliseconds.
- **Size:** M
- **Found:** 2026-10-21, siege blackout.

### The slowest gates make full verification a 16-minute wait

- **Where:** `verify:town-residency` (about 10 minutes per run), `verify:plaza-perf`, `verify:town-soak`, `verify:floor-sweep`, and `verify:affected` over a large change (146 gates, about 16 minutes).
- **Problem:** a handful of gates dominate the wall clock, and running them in parallel loads the machine heavily.
- **Cost:** a fix-and-confirm loop takes most of an hour. A heavy run competes with a browser playtest and can change its results: it contributed to the 2026-10-21 canvas losses.
- **Better shape:** profile the slow gates. Most of their time is probably repeated scene setup or soak length that a smaller sample would cover just as well.
- **Size:** M
- **Found:** 2026-10-21, perf and memory batch.

### Many scripts are never typechecked

- **Where:** `tsconfig.scripts.json`, whose `include` lists harnesses one by one (its own comment says "The older scripts/ harnesses predate this and are not covered"); `typecheck:scripts` in `scripts/check.ts`. Typechecking all of `scripts/**/*.ts` against that config gives 18 errors, in `verify-town-residency.ts`, `verify-preview-scene.ts`, `render-equipment.ts`, `verify-held-visuals.ts`, `verify-arrival-load.ts`, `verify-residency.ts` and `verify-player-snapshot.ts`: an `unknown` read without narrowing, an implicit `any`, a `Canvas` passed where `CanvasImageSource` is expected, members that no longer exist (`arrivalLoading`, `LIVE_SCRIPT_LAP_TICKS`), and `Array.prototype.at` against the configured lib.
- **Problem:** a script outside the list runs through `tsx`, which strips types without checking them, so neither `npm run check` nor `check:full` ever sees its type errors. Several of the failing files are live gates.
- **Cost:** a rename or a type change in `src/` silently breaks an unlisted harness, and the breakage surfaces only as a confusing runtime failure, or not at all when the bad branch never runs. The game's strict type rules don't hold for a large part of the tooling.
- **Better shape:** include `scripts/**/*.ts` in `tsconfig.scripts.json`, fix the existing errors, and delete the per-file list, so a new script is covered by default.
- **Until then:** add every new script to the `include` list, and when changing a type that scripts use, typecheck all of `scripts/` once with a temporary config that includes `scripts/**/*.ts`.
- **Size:** S
- **Found:** 2026-10-27, building ids replacing display names.

### Figures freeze ink measurements the runtime already measures

- **Where:** the `GORE_RECENTRE` tables and their lookups in `src/sprites/art/darkKnightFigure.ts`, `mantidFigure.ts`, `rockGolemFigure.ts`, `lichFigure.ts`, `llamaFigure.ts`, `krakarenFigure.ts`, `tusklingFigure.ts`, `goblinFigure.ts`, `goblinBomberFigure.ts`, `skeletonFigure.ts`, `brindledVespaFigure.ts`, `ratFigure.ts`, `cockroachFigure.ts`, `troglodyteFigure.ts`, and on the shelf `src/shelf/auntieGorge/auntieGorgeFigure.ts` and `src/shelf/ironIggy/ironIggyFigure.ts`; `GORE_CENTRE_CORRECTION` in `src/sprites/art/cowGore.ts` (gated by `scripts/gates-cow.ts`); frozen head clearances `DEINONYCHUS_HEAD_CLEARANCE_TILES` (`deinonychusSprite.ts`), `IRON_IGGY_HEAD_CLEARANCE_TILES` (`src/shelf/ironIggy/ironIggySprite.ts`), `MAGNUM_STAGE_TOP_ABOVE_TILE_TILES` (`src/sprites/magnumSprite.ts`) and `HUMAN_SPRITE_TOP_ABOVE_TILE` (`src/creatures/HumanPlayer.ts`, gate G21 in `scripts/gates-human.ts`); and the gates that re-measure them (`scripts/gates-*.ts`, `scripts/goblinSubjects.ts`).
- **Problem:** each figure nudges every gore piece by an offset measured offline so its ink sits on the cell's centre, or freezes how far its art stands above its tile, and a gate re-measures the number on every render. But `figureFrameCache.ts` measures both at runtime: `drawFigureCachedRotatedCenter` spins a piece about `figureInkBounds(...)`, so where the ink sits in its cell does not change how it tumbles, and `figureRowInkTop` gives a drawn row's top.
- **Cost:** every redraw means re-pasting measured numbers to keep gates green, for values the runtime could read itself. Their doc comments say only an offline pass can measure ink, which the runtime contradicts.
- **Better shape:** paint each gore piece about the cell's centre with clearance from the edges and hang overhead chrome off `figureRowInkTop`; then delete the tables, the constants, their lookups and the gates that re-measure them. The structural gate's edge check is what still matters.
- **Until then:** don't add a new frozen recentring table or head clearance, or a gate for one; paint new gore pieces about the cell's centre and measure a row's top at runtime.
- **Size:** M
- **Found:** 2026-10-22, code review of a new boss figure.

## Human figure

### The bow archetype has rows but no motion set

- **Where:** `bow` in `GRIP_ARCHETYPES` (`src/sprites/held/gripArchetypes.ts`), absent from `WEAPON_GRIP_ARCHETYPES` and `ARMED_MOTION_SETS` (`src/sprites/art/human/motionSets.ts`); the shot and the carry in `src/sprites/art/human/actionsBow.ts` (`bowShotFront` / `bowShotSide` / `bowShotBack`, `carryBow`, `bowGoingDown`); `prop_longbow` (`SCRIPTED_PROP_HELD`, `src/sprites/held/art/scriptedPropHeld.ts`).
- **Problem:** the bow's rows exist only as pose functions a figure of its own composes (Ivy Ashgrove's, `src/sprites/art/ivyAshgroveFigure.ts`); the human row table has no `bow` rows, no `motionSet`, and the longbow is a row prop baked into the cell rather than an equipment-chosen item composited at the off-hand socket. A bow in a weapon archetype would need a set in `ARMED_MOTION_SETS`, which every set-keyed table (`CARRY_HOLDS`, `SWING_SHARES`, `ARMED_STRIKES`, holster keys, `CARRY_STYLE`, the residency tables) and G9b/G15/G16 in `scripts/gates-human.ts` (which require a weapon item playing every set) then demand.
- **Cost:** a player bow item cannot be added as data; the gates:equipment checks (E1–E4, E7) do not reach the bow rows, which are held only by the release gate in `scripts/render-ivy-ashgrove.ts` and its review renders.
- **Better shape:** add `bow` as an armed set whose stance holds the off hand (a `Hold` for the left fist in `armedHold.ts`) and whose one strike is the shot, put the `actionsBow` poses in `armedRows.ts`, and draw the longbow as an equipment-chosen off-hand item so E1–E7 gate it, when the first bow item ships.
- **Until then:** build any other bow-carrying figure from `actionsBow.ts` and `prop_longbow`, never a second bow painter or a bow painted into a sprite.
- **Size:** L
- **Found:** 2026-10-27, Ivy Ashgrove's longbow.

### The rows roll every look's foot on the rig's sole

- **Where:** `soleOffsets` in `src/sprites/art/human/gaitShared.ts`, `probeLeg` in `src/sprites/art/human/probe.ts`, `scaleFootByBuild` in `src/sprites/art/biped/limbs.ts`.
- **Problem:** row poses are look-independent, so a rolling foot is planted by the rig's heel and toe. A look with a shorter foot (`LimbBuild.footLength`, Ryan's 0.82) is painted stretched across the picture after the pitch, which keeps the ends' heights but moves them along the floor; measured on his own sole, his foot slides about 1.2 in-game px through the stance of the run-strike rows (`jab_run_side_*`). G10 measures the rig's sole, so it does not see this. Stretching along the pitched foot instead lifts the planted end off the floor on every rolling contact.
- **Cost:** a planted foot on a look with its own foot size is held to a sole it does not have; the probe's sole landmarks are the rig's, not the painted foot's.
- **Better shape:** let the row's pose solve the rolling contact against the look's own sole (`withLookBuild` carrying the foot size into the stance solve), then scale the foot along its pitched axis and measure the look's own sole in `probeLeg`.
- **Until then:** don't give a look a foot size much further from the rig's than Ryan's without re-measuring the slide on its own sole.
- **Size:** M
- **Found:** 2026-10-24, threading look foot size through the human figure's contacts and probe.

### A gap that closes by a hairline flickers between outlined and cleared

- **Where:** `clearOutlineInHoles` in `src/sprites/art/figureCompose.ts`, called from `src/sprites/art/biped/figure.ts`; `WING_HEAD_ON`'s `claw` in `src/sprites/art/demonLiaisonArt.ts`.
- **Problem:** the outline is cleared inside a gap only when the gap is fully enclosed by the silhouette. When a gap's mouth is about one pixel wide, rounding opens it on some frames and shuts it on others, so a block of outline ink comes and goes from frame to frame. The Demon Liaison's wing claw is held a few pixels clear of his horns for this reason. Closing the silhouette by the outline's width before the reachability test fixes that case, but it flips Ryan's `build_side` hand pocket between frames and fails G3.
- **Cost:** any figure whose limbs or props nearly touch can gain an idle or loop flicker that only shows up as a stillness or seam failure, and the fix has to be made in that figure's art.
- **Better shape:** decide whether a gap is enclosed once per row (for example from the rest frame or a majority of frames) rather than per frame, so every frame of a loop treats the same pocket the same way.
- **Until then:** keep painted parts either clearly touching or a few pixels apart in every frame of a row; don't tune a gate threshold to absorb the flicker.
- **Size:** M
- **Found:** 2026-10-24, Demon Liaison idle stillness on the shared biped painter.

### A base belt stacks over every worn shirt-slot garment

- **Where:** `RYAN_BELT` in `src/sprites/garments/human/ryanChinos.ts` (layer `outer`), `GARMENT_LAYERS` in `src/sprites/garments/garmentDef.ts`, the id tie-break in `outfitOf` (`src/sprites/garments/outfit.ts`).
- **Problem:** the belt has to paint over his chinos, which share its `over` layer and sort after it by id, so it sits on `outer`. Every shirt-slot garment (apron, vest, quilted vest) is also `outer`, and `human_*` sorts before `ryan_belt`, so his belt paints over their hips skirts.
- **Cost:** stacking within a layer is decided by id spelling, so a garment's place in the outfit depends on its name; a belted coat today is an accident.
- **Better shape:** let a base garment order its own pieces (or give fastenings their own layer between `over` and `outer`) so stacking never falls to the id tie-break between garments that overlap.
- **Until then:** don't rename garment ids to win a tie-break.
- **Size:** S.
- **Found:** 2026-10-26, painting the human's shirt-slot gear.

### G17 reads a sleeved far forearm through the sleeve roll's darkness

- **Where:** the G17 limb-form check run by `scripts/render-human.ts`; `withDeepShade` in `src/sprites/garments/human/torsoCover.ts`; the sleeve roll painted from `sleevesOf` in `src/sprites/garments/outfit.ts`.
- **Problem:** at the 32 px tile, the cross-sections of the far forearm nearest the elbow blend in pixels from the pushed-up sleeve roll. Dave's far forearm under a sleeved coat clears the threshold only because the roll is dark: the Lucky Hoodie reads 30.0 and the Sequin Tailcoat 30.4 against a bar of 30, and `withDeepShade` darkens coat ramps toward the jacket crevice partly to keep that margin.
- **Cost:** a new sleeved garment in a lighter cloth on Dave is likely to fail G17 for a reason that has nothing to do with the forearm's own shading, and the easy response is to darken cloth that should not be dark.
- **Better shape:** have G17 sample the forearm's form clear of the sleeve roll (excluding the roll's footprint, or measuring from the wrist to a set share below the elbow) so the reading belongs to the limb.
- **Until then:** don't lower the G17 bar or exempt garments; if a sleeved garment fails on Dave's far forearm, check the roll's contribution before reshading the cloth.
- **Size:** S.
- **Found:** 2026-10-26, painting the human's sleeved coats.

### Rows only a hireling plays live in the crawler's row table

- **Where:** `twohand_channel*` and `twohand_brace*` in `ARMED_ROW_NAMES` / `ARMED_ROW_TABLE` (`src/sprites/art/human/armedRows.ts`), posed by `src/sprites/art/human/staffRows.ts`; played only by `BROTHER_ANSELM_ART` (`src/sprites/brotherAnselmSprite.ts`), which draws the human figure through `humanFigureFor` and `drawHumanFigureSelection`.
- **Problem:** a figure built on the human rig that holds an equipment item has no row table of its own: the held-layer and socket plumbing (`humanHeldLayers`, `humanSocketsAt`, `heldSocketOf`) only knows `HUMAN_ROW_TABLE`. So a hireling's own actions become rows of the player's figure, with no role so his animator never plays them.
- **Cost:** every hireling action on the rig grows the crawler's table, and the crawler's gates (G1–G27, E1–E7 for every two-hander) pay for rows he never plays; the row table stops describing what the crawler does.
- **Better shape:** let `HumanFigurePainting` carry its own row table (the crawler's, or one extended per figure) and key sockets and held layers on it, so a figure built on the rig declares its extra rows beside its look.
- **Until then:** give such rows no `role`, keep them generic to their motion set rather than named after one character, and add them to the motion set they hold an item in so the equipment gates cover them. A stride row of this kind (`twohand_amble`, `twohand_hurry`) declares `gait: 'walk'` so G10 paces it, and is kept out of the crawler's stride only by being declared after his set's own walk, which `cycleRow` finds first; never declare one ahead of it.
- **Size:** M.
- **Found:** 2026-10-27, painting Brother Anselm on the human rig.

## UI

### The dialog box lays itself out outside the UI layout

- **Where:** `DialogBox` (`src/ui/DialogBox.ts`): `layoutBudget`, `dialogWidth`, `_computeRect` and the `HOTBAR_SLOT_SIZE` / `HOTBAR_BOTTOM_MARGIN` copies; `Conversation.renderSurface`, which draws it under `ctx.scale(1 / scale)`.
- **Problem:** the box sizes and places itself in canvas CSS pixels from `viewportWidth()` / `viewportHeight()` and its own copy of the hotbar's size, not from `ui.viewport`, `ui.size` or `hudLayout`. It is not a `panel`, so it never becomes a bottom sheet on a phone, and it vanishes the frame its surface closes, so Caroline's frame unfolds as her conversation opens but cannot fold shut as it closes.
- **Cost:** a phone layout or a close animation for speech has to be special-cased inside the box, and a change to the hotbar's size silently drifts the box's gap above it.
- **Better shape:** lay the box out in UI units from `ui.viewport` and the HUD geometry inside `Conversation`'s surface, branching on `ui.size` like a panel; give `Conversation` a closing state the surface stays open through.
- **Until then:** don't add more hard-coded HUD measurements to `DialogBox`; read them from `hudLayout` when one is needed.
- **Size:** M
- **Found:** 2026-10-27, Caroline's message frame.

### A cutscene's surface can stack over the talk it opened

- **Where:** `CutsceneKit.surface()` (`src/systems/kits/CutsceneKit.ts`), `Conversation.surface()` (`src/dialog/Conversation.ts`) and `UiRoot.refreshStack` (`src/ui/core/UiRoot.ts`).
- **Problem:** both surfaces sit in the `panel` band for a talk that does not halt the world (every Caroline message), so which one takes a key is decided by open order. Open order is only noticed when the stack is refreshed, which a drawn frame does; when both open between two refreshes, mount order decides, the cutscene surface lands on top, and it swallows the advance key meant for the message under it.
- **Cost:** correct in the running game only because every frame is drawn; a headless harness that updates without drawing must refresh the stack by hand (`verify:dave-guide` does, through `ui.focusSurfaceId()`), and any future path that opens both inside one frame would leave the player unable to page a message with the keyboard.
- **Better shape:** make the order explicit: let a surface name the surface it must sit beneath, or have the cutscene surface hand the advance key to the conversation it owns.
- **Until then:** don't open a cutscene and its talk inside the same update without a draw between them.
- **Size:** S
- **Found:** 2026-10-28, Dave's safe-room talks and Caroline's queued messages.

## Combat

### A crawler's hit is scaled in two places, and each hit site wires the second by hand

- **Where:** the per-delivery blow formulas (`bareFistDamage`, `bareClawDamage`, `slingDamage` in `src/core/party/crawlerFormulas.ts`, the missile and dynamite damage functions), and every call of `outgoingHitDamageOn` (`src/core/combat/outgoingHit.ts`) in `CombatSystem`, `StormcallerStrikeSystem`, `CombatKit`, `SpellSystem` and `DynamiteSystem`. Gear-thrown strikes (`gearStrike` in `src/gear/traits.ts`, `GearSystem`'s relic bolts and slash waves) and Seismic Stomp do not pass through it.
- **Problem:** the stat a delivery grows with is folded into the blow by its own formula, then the hit site separately hands the result and its `DamageTags` to the outgoing-hit door for the proficiency skills. Nothing makes a new hit site do the second step.
- **Cost:** a crawler hit added without the door silently ignores every proficiency skill and trains none; the stat scaling and the skill scaling can drift apart because no one value describes a hit.
- **Better shape:** a hit record (dealer, delivery, base blow, tags) built once per hit and resolved by the door, which applies `DELIVERY_STAT` and the skills together, so a hit site cannot reach `takeDamageFrom` without it.
- **Until then:** route every new crawler hit through `outgoingHitDamageOn` with its tags; don't add a skill bonus anywhere else.
- **Size:** M
- **Found:** 2026-10-27, proficiency skills.

## Shared types

### Tile geometry types are declared five times, and the shared one lives in the town plan

- **Where:** `TileRect` in `src/map/town/townPlan.ts`, `src/map/pastSafeRoom.ts`, `src/systems/briarHollow/questGuidance.ts`, `src/creatures/fairies/fairyRefuge.ts` and `src/systems/bossRooms/bossRoomLayout.ts`; `TilePoint` in `townPlan.ts`, `bossRoomLayout.ts`, `src/map/starlightTentMazeDecor.ts`, `src/systems/dungeon/dungeonEmitters.ts`, `src/core/save/SavedWorld.ts`, `src/ai/actions/world.ts` and `src/dev/perfWalk.ts`.
- **Problem:** the same tile rectangle and point are redeclared per feature, and code with nothing to do with a town (`WorldResidency`, and dozens of files under `src/` and `scripts/`) imports them from the town plan because it is the most complete copy.
- **Cost:** a floor-agnostic system depends on the town generator's module, and the copies can drift (some fields are `readonly`, some not).
- **Better shape:** one `src/map/tileGeometry.ts` holding `TilePoint` and `TileRect`, imported everywhere; the feature modules drop their copies.
- **Until then:** import `TileRect`/`TilePoint` from `townPlan.ts` rather than declaring another copy.
- **Size:** S
- **Found:** 2026-10-22, floor-wide residency system.

### The event bus's 'Human' / 'Cat' label is mapped from a crawler by hand in many places

- **Where:** `crawlerLabel` in `src/systems/AchievementAwards.ts` (exported, also used by `src/systems/kits/hotbarActions.ts`), and inline `? 'Human' : 'Cat'` mappings in `src/ai/actions/interactions.ts`, `src/scenes/DungeonScene.ts`, `src/systems/AIChallengeSystem.ts`, `src/systems/LootSystem.ts` and `src/systems/kits/MenusKit.ts`; the `'Human' | 'Cat'` union is redeclared as `CrawlerSide` in `src/core/combat/hpThresholds.ts` and `src/systems/AIChallengeSystem.ts`.
- **Problem:** events name a crawler with a capitalised label while everything else uses `CrawlerKind`, and each emitter converts on its own, some from `crawlerKind`, some by comparing against `pm.human` or `instanceof HumanPlayer`.
- **Cost:** a new emitter copies whichever form it finds; the identity checks silently mislabel a crawler that is neither instance the scene holds.
- **Better shape:** events carry `CrawlerKind`; the few places that print a label derive it once from a single shared function.
- **Until then:** use `crawlerLabel` rather than adding another inline mapping.
- **Size:** S
- **Found:** 2026-10-27, the cat throwing explosives.
