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

- **Where:** `Mob`'s `noticeStagger` and `astarStagger` field initialisers (`src/creatures/Mob.ts`, through `randomInt`, which reads `worldRandom`), and creature field initialisers that call `Math.random` while being built (`EvilClown`'s `idlePhaseOffsetSeconds`, `Cockroach`'s `skitterPhase`, `NecroFairy`'s `effectSeed`, and others in `src/creatures/`).
- **Problem:** each kind's `create` on `MOB_KINDS` (`src/levels/mobKinds.ts`) receives the `SpawnContext`'s `random`, but only `Necromancer` keeps it; the base class and the other creatures roll from other streams while being built.
- **Cost:** a harness passing a seeded stream through the funnel still gets unseeded per-mob staggers and phases unless it also replaces `Math.random`, so a gate depending on them is not reproducible from the context alone.
- **Better shape:** hand the `create` stream to the `Mob` constructor and let the base class and every creature draw their construction rolls from it.
- **Until then:** don't add new `Math.random` rolls to a creature for anything a gate needs to reproduce; take the `random` its `create` is given.
- **Size:** M
- **Found:** 2026-10-21, spawn funnel work.

### Big Rooster and his gym talk through public mailbox fields

- **Where:** `BigRooster` (`src/creatures/BigRooster.ts`) fields the gym writes every frame (`nearestDumbbellPos`, `loadedSquatRacks`, `confinedTo`, `musicPlaying`, `kettlebellRackStands`, `restingExerciseBalls`, `flockLosses`, `flockView`) and the requests he leaves for it to clear (`requestDumbbellAt`, `plateTakenFrom`, `heaveRequest`, `ballKickRequest`); `RoosterMinion.flockView`; `GymRoomSystem.update` and `publishFlock` (`src/systems/GymRoomSystem.ts`).
- **Problem:** the boss and the room share state through a dozen mutable public fields, each with its own unwritten rule about who sets it, who clears it and on which frame. Every new gym mechanic adds one in each direction.
- **Cost:** a field the room forgets to set leaves him acting on a stale value, and a request nobody clears fires twice; a harness that drives him without the room has to fake each field by hand.
- **Better shape:** one typed `GymView` the room hands his AI each frame, and one typed list of `GymRequest`s (a discriminated union) the room drains from him, so the contract is two types instead of a field per mechanic.
- **Until then:** don't add another one-off field for a new mechanic; if one is unavoidable, document who writes and who clears it beside the field.
- **Size:** M
- **Found:** 2026-10-28, Big Rooster's kettlebell rain and fury.

## Creature art

### The Deinonychus is drawn as separately outlined pieces, so every join shows a dividing line

- **Where:** `src/sprites/art/deinonychusArt.ts`: `drawDeinonychusSide` paints the tail (`drawTailSide`), body (`drawBodySide`), thigh (`drawThighSide`), neck (`drawNeckSide`), head (`drawHeadSide`) and limbs (`drawLimb`) one after another, each closing with its own `fillAndOutline` stroke. The head-on and away views (`drawDeinonychusAxial`) use `paintUnion` for some shapes but not every join.
- **Problem:** each segment is filled and outlined on its own, so where one overlaps the next its outline is painted across the animal's body. In game the Deinonychus reads as plates laid on top of each other, with a clearly visible line at the neck, hips, thigh and tail base, rather than as one continuous animal.
- **Cost:** the pet looks assembled rather than alive, and each art pass that tunes a segment's shape moves the seams instead of removing them.
- **Better shape:** draw the body masses that should read as one surface (tail, torso, thigh, neck, head) as one silhouette with one outside outline, as `paintUnion` does: stroke every shape first and fill them all over the strokes, then paint shading and feathers inside the union with `insideUnion`. Keep separate outlines only where one part truly passes in front of another, such as the near wing or near leg over the flank.
- **Until then:** don't add another body segment with its own `fillAndOutline`; join new masses into a union.
- **Size:** M
- **Found:** 2026-10-28, owner review of the Deinonychus sprite.

### Each slam's travelling wave has its own painter

- **Where:** `drawSlamShockwave` (`src/sprites/slamShockwave.ts`, Big Rooster's fist slam) and `drawSlamWave` (`src/sprites/electricGoblinTelegraphs.ts`, the Current Goblin's slam).
- **Problem:** both draw a front of force running over the floor, but `slamShockwave.ts` is radial through and through: its scuff, compression lens, chalk ring, plumes, debris and haze are all arcs and angles about one centre, with its tints as inline `'r, g, b'` strings. The Current Goblin's wave is a straight band running down a lane, which none of that geometry can express, so it has a separate small painter coloured from `worldPalette.electricGoblin`.
- **Cost:** a third slam (another boss, a crawler ability) gets a third painter, and a fix to how a front reads (the two-band refraction lens, fade, thinning) lands in one of them only.
- **Better shape:** one travelling-front painter that takes the front's shape (a ring about a point or a band across a lane) and a palette from `worldInk`, with the per-floor dressing (chalk, matting, sparks) as optional layers the caller picks.
- **Until then:** don't add another slam or shockwave painter; build the next one as that shared painter and move these two onto it.
- **Size:** M
- **Found:** 2026-10-28, review of the Current Goblin's slam telegraphs.

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

### The slowest gates still take minutes each

- **Where:** `gates:equipment` (about 8 minutes across four child processes, about 33 CPU-minutes, most of it E5 in `scripts/gates-equipment-garments.ts`), `gates:boss-rooms` (about 5.5 minutes, bounded by the Trash Gremlin's per-floor gates and its fight sims in `scripts/bossRooms/trashGremlinGates.ts`), and the `--slow` gates `verify:town-residency` (about 18 minutes), `verify:residency` (about 13) and `verify:town-soak` (about 6.5).
- **Problem:** E5 repaints the whole human figure, body and all, for every cell of every row once per outfit pass (about twenty passes per look, five looks), only to read the garment ink and envelopes its dressing callbacks route to surfaces of their own. Every boss-room floor and every staged sim fight generates a dungeon from scratch, about a second each, most of it `planCrawlerSigns`. `verify:town-residency` and `verify:town-soak` render the whole `DungeonScene` at a Retina ratio for thousands of frames, HUD glass panels included, and their waves and trips are sized to idle windows (a stand-in wave evicts the crowd only after about 600 frames), so they cannot simply be shortened. `verify:residency` runs its two routes one after the other because figure bakes are paced by the wall clock. `equipmentGateFailures`, the in-process path `render:equipment` uses, grows to tens of gigabytes of native canvas memory over a full run, where the gate itself runs each unit in a process that exits.
- **Cost:** a `verify:affected` over a large change still waits on `gates:equipment`, and a `--slow` sign-off takes most of an hour. A heavy run competes with a browser playtest and can change its results: it contributed to the 2026-10-21 canvas losses.
- **Better shape:** let E5 measure garment ink without compositing the body under it; let the sims stage a fresh copy of a generated floor rather than regenerating it; drive the residency gates' bake pacing from a simulated clock, as `verify:town-residency` already does, so their routes can run side by side.
- **Until then:** split a new heavy gate into units that share nothing and run them with `runUnitsInChildren` (`scripts/childUnits.ts`); never shorten a soak, a wave or a sweep without a seeded regression showing the shorter run still fails.
- **Size:** M
- **Found:** 2026-10-21, perf and memory batch.

### Harnesses reach node-canvas through a double cast

- **Where:** `asGameContext` and `asNodeCanvas` in `scripts/nodeGameContext.ts`, each an `as unknown as` cast behind an `eslint-disable-next-line @typescript-eslint/consistent-type-assertions`; every harness that paints with a game painter offline goes through them.
- **Problem:** the game's painters take the DOM's `CanvasRenderingContext2D` and `CanvasImageSource`, which node-canvas's context and `Canvas` do not satisfy structurally, so the bridge tells the compiler they are the same thing.
- **Cost:** it breaks the codebase's no-cast rule, and a painter that starts using a context member node-canvas lacks (such as `filter` or `createConicGradient`) compiles cleanly and fails only when a harness runs it.
- **Better shape:** have painters take a narrower drawing-surface type (the members they actually call, picked from `CanvasRenderingContext2D`) that both the DOM context and node-canvas's context satisfy, so neither side needs a cast.
- **Until then:** never write a new cast to bridge node-canvas; call `asGameContext` / `asNodeCanvas`, and when drawing a node `Canvas` into another, use the node context's own `drawImage`.
- **Size:** M
- **Found:** 2026-10-30, bringing every script under typechecking.

### Figures freeze ink measurements the runtime already measures

- **Where:** the `GORE_RECENTRE` tables and their lookups in `src/sprites/art/darkKnightFigure.ts`, `mantidFigure.ts`, `rockGolemFigure.ts`, `lichFigure.ts`, `acidLlamaFigure.ts`, `krakenFigure.ts`, `wereboarFigure.ts`, `goblinFigure.ts`, `goblinBomberFigure.ts`, `skeletonFigure.ts`, `giantWaspFigure.ts`, `ratFigure.ts`, `cockroachFigure.ts`, `lizardmanFigure.ts`, and on the shelf `src/shelf/auntieGorge/auntieGorgeFigure.ts` and `src/shelf/ironIggy/ironIggyFigure.ts`; `GORE_CENTRE_CORRECTION` in `src/sprites/art/cowGore.ts` (gated by `scripts/gates-cow.ts`); frozen head clearances `DEINONYCHUS_HEAD_CLEARANCE_TILES` (`deinonychusSprite.ts`), `IRON_IGGY_HEAD_CLEARANCE_TILES` (`src/shelf/ironIggy/ironIggySprite.ts`), `MAGNUM_STAGE_TOP_ABOVE_TILE_TILES` (`src/sprites/magnumSprite.ts`) and `HUMAN_SPRITE_TOP_ABOVE_TILE` (`src/creatures/HumanPlayer.ts`, gate G21 in `scripts/gates-human.ts`); and the gates that re-measure them (`scripts/gates-*.ts`, `scripts/goblinSubjects.ts`).
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
- **Problem:** row poses are look-independent, so a rolling foot is planted by the rig's heel and toe. A look with a shorter foot (`LimbBuild.footLength`, the male crawler build's 0.82) is painted stretched across the picture after the pitch, which keeps the ends' heights but moves them along the floor; measured on its own sole, that foot slides about 1.2 in-game px through the stance of the run-strike rows (`jab_run_side_*`). G10 measures the rig's sole, so it does not see this. Stretching along the pitched foot instead lifts the planted end off the floor on every rolling contact.
- **Cost:** a planted foot on a look with its own foot size is held to a sole it does not have; the probe's sole landmarks are the rig's, not the painted foot's.
- **Better shape:** let the row's pose solve the rolling contact against the look's own sole (`withLookBuild` carrying the foot size into the stance solve), then scale the foot along its pitched axis and measure the look's own sole in `probeLeg`.
- **Until then:** don't give a look a foot size much further from the rig's than the male crawler build's without re-measuring the slide on its own sole.
- **Size:** M
- **Found:** 2026-10-24, threading look foot size through the human figure's contacts and probe.

### A gap that closes by a hairline flickers between outlined and cleared

- **Where:** `clearOutlineInHoles` in `src/sprites/art/figureCompose.ts`, called from `src/sprites/art/biped/figure.ts`; `WING_HEAD_ON`'s `claw` in `src/sprites/art/demonLiaisonArt.ts`.
- **Problem:** the outline is cleared inside a gap only when the gap is fully enclosed by the silhouette. When a gap's mouth is about one pixel wide, rounding opens it on some frames and shuts it on others, so a block of outline ink comes and goes from frame to frame. The Demon Liaison's wing claw is held a few pixels clear of his horns for this reason. Closing the silhouette by the outline's width before the reachability test fixes that case, but it flips the male crawler's `build_side` hand pocket between frames and fails G3.
- **Cost:** any figure whose limbs or props nearly touch can gain an idle or loop flicker that only shows up as a stillness or seam failure, and the fix has to be made in that figure's art.
- **Better shape:** decide whether a gap is enclosed once per row (for example from the rest frame or a majority of frames) rather than per frame, so every frame of a loop treats the same pocket the same way.
- **Until then:** keep painted parts either clearly touching or a few pixels apart in every frame of a row; don't tune a gate threshold to absorb the flicker.
- **Size:** M
- **Found:** 2026-10-24, Demon Liaison idle stillness on the shared biped painter.

### A base belt stacks over every worn shirt-slot garment

- **Where:** `LEATHER_BELT` in `src/sprites/garments/human/chinos.ts` (layer `outer`), `GARMENT_LAYERS` in `src/sprites/garments/garmentDef.ts`, the id tie-break in `outfitOf` (`src/sprites/garments/outfit.ts`).
- **Problem:** the belt has to paint over the chinos on the `over` layer, and a same-layer tie is settled by id spelling, so it sits on `outer`. Every shirt-slot garment (apron, vest, quilted vest) is also `outer`, and `human_*` sorts before `leather_belt`, so the belt paints over their hips skirts.
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

### A look's seat fullness reaches only the trousers built by `trouserPainters`

- **Where:** `HumanLook.seatFullness` (`src/sprites/looks/humanLook.ts`), read only in `trouserPainters` (`src/sprites/garments/human/chinos.ts`), which the chinos and the tapered trousers are built from; `TOWNSFOLK_TROUSERS` (`src/sprites/garments/human/townsfolkLegwear.ts`) and every other garment painted over the hips call `paintTrouserSeat` or paint their own seat without it.
- **Problem:** a body's seat is a fact about the look, but only one trouser painter scales its `SeatFit` by it. A female crawler put in the townsfolk trousers, or any hips garment not built by `trouserPainters`, gets the slim man's seat.
- **Cost:** each new hips garment has to remember to read `seatFullness` itself, and one that forgets fits every look but the female ones wrongly with every gate green.
- **Better shape:** apply the look's seat fullness where the seat is painted (`paintTrouserSeat`, or the hips frame handing garments a seat already fitted to the body), so no garment can leave it out.
- **Until then:** a new trouser or skirt over the hips goes through `trouserPainters` or scales its seat by `frame.look.seatFullness` itself.
- **Size:** S.
- **Found:** 2026-10-28, reviewing the female crawler looks.

### The human gates never paint a garment another garment covers

- **Where:** `gatedOutfits` in `scripts/render-human.ts` (the default outfit, bare, and `outfitOf(look, WEARABLE)`); `outfitOf` in `src/sprites/garments/outfit.ts`, which leaves off every garment `coversOver` hides; `HEARTHGUARD_QUILTED_VEST` (`src/sprites/garments/human/hearthguardQuiltedVest.ts`).
- **Problem:** the only outfit that wears item garments is all of them at once, and `outfitOf` drops whatever another garment covers, so seven garments are never painted under any gate: `human_hearthguard_quilted_vest` and the six rings (`human_lucky_penny_ring`, `human_fang_ring`, `human_frostward_ring`, `human_emberward_ring`, `human_fae_iron_ring`, `human_hourglass_ring`). Worn alone, the quilted vest fails G17 on Dave, `male_dark` and both female looks (worst 20.9 levels against 30, the female left forearm at `walk_side[0]`, full bake).
- **Cost:** a player who wears the vest without a coat over it sees a forearm that reads flat at the tile, and nothing catches a defect in a covered garment, including one added later.
- **Better shape:** gate each item garment in at least one outfit where it shows, for example each one alone, or the fewest outfits that between them leave every garment showing.
- **Until then:** gate a new garment that something can cover by wearing it alone (`npm run render:human -- --gear=<id>`), and don't treat a green all-garments run as covering it.
- **Size:** M
- **Found:** 2026-10-30, tracing a G17 failure on Dave in all item garments.

## UI

### The dialog box lays itself out outside the UI layout

- **Where:** `DialogBox` (`src/ui/DialogBox.ts`): `layoutBudget`, `dialogWidth`, `_computeRect` and the `HOTBAR_SLOT_SIZE` / `HOTBAR_BOTTOM_MARGIN` copies; `Conversation.renderSurface`, which draws it under `ctx.scale(1 / scale)`.
- **Problem:** the box sizes and places itself in canvas CSS pixels from `viewportWidth()` / `viewportHeight()` and its own copy of the hotbar's size, not from `ui.viewport`, `ui.size` or `hudLayout`. It is not a `panel`, so it never becomes a bottom sheet on a phone, and it vanishes the frame its surface closes, so Caroline's frame unfolds as her conversation opens but cannot fold shut as it closes.
- **Cost:** a phone layout or a close animation for speech has to be special-cased inside the box, and a change to the hotbar's size silently drifts the box's gap above it.
- **Better shape:** lay the box out in UI units from `ui.viewport` and the HUD geometry inside `Conversation`'s surface, branching on `ui.size` like a panel; give `Conversation` a closing state the surface stays open through.
- **Until then:** don't add more hard-coded HUD measurements to `DialogBox`; read them from `hudLayout` when one is needed.
- **Size:** M
- **Found:** 2026-10-27, Caroline's message frame.

## Combat

## Audio

### Loops cannot be placed in the world

- **Where:** `AudioScope.startAmbientLoop` / `setAmbientLoopVolume` (`src/audio/AudioScope.ts`); `FloodedPumpRoomSystem.updateLoops` and `DungeonScene.setFloodedRoomLoopVolume`.
- **Problem:** one-shots have `playAt` (distance falloff and pan from the listener), but a loop is one voice per id at a flat level. The flooded pump room's pour and shark-chase loops fake placement by setting the level from the distance to the nearest running pump every frame, with no pan, and three pumps share one voice.
- **Cost:** every positional loop (a pump, a generator rig, a charged puddle) re-derives its own falloff, none pans, and two sources of one id cannot both be heard.
- **Better shape:** a scope loop keyed by owner and placed at a world point, mixed through the same listener falloff and pan `playAt` uses.
- **Until then:** keep any hand-rolled falloff inside the system that owns the source, as the pump room does, rather than adding another scene-level volume helper.
- **Size:** M
- **Found:** 2026-10-28, the Kraken's flooded pump room.

### Music stems are filed as jingles

- **Where:** `src/audio/jingles/the_kraken_flooded_2pumps.ogg`, `the_kraken_flooded_1pump.ogg`; their ids in `JINGLE_IDS` (`src/audio/sounds.ts`); `MUSIC_STEM_SETS` (`src/audio/music/stemSets.ts`).
- **Problem:** a stem set's reduced stems are registered as jingles because they need no credit or music-page row, but they are not stings: they are layers of one catalogued song, only ever played through a `stems` claim.
- **Cost:** `jingles/` mixes one-shot stings with fight-music layers, `JingleId` admits a stem anywhere a sting is expected, and the next stem set adds more files to the wrong folder.
- **Better shape:** a `MUSIC_STEM_IDS` tuple and its own folder, `src/audio/music/stems/`, with `check:audio` holding the folder, the tuple and `MUSIC_STEM_SETS` to each other.
- **Until then:** a new stem set's reduced stems may go in `jingles/` like the Kraken's, but nothing should play a stem except through a `stems` claim.
- **Size:** S
- **Found:** 2026-10-28, review of the floor-two bosses work.

### The teleport's sounds are named for Dave

- **Where:** `TELEPORT_SOUNDS` (`src/sprites/teleportEffect.ts`), the ids `dave_teleport_in` and `dave_teleport_out` in `src/audio/sounds.ts` and their files.
- **Problem:** the teleport is shared — Dave's arrivals and departures and a companion brought into a safe room by `SafeRoomRegroupSystem` — but its sound ids name one character.
- **Cost:** breaks the rule that ids never name characters, and reads as Dave's cue at every other play site.
- **Better shape:** rename the ids and files to `teleport_in` / `teleport_out` and re-run the audio measurement.
- **Until then:** play the teleport through `TELEPORT_SOUNDS`, never by the raw ids.
- **Size:** S
- **Found:** 2026-10-29, safe-room companion regroup.

## Cutscenes

### The spider lab's opening runs its own camera pan and shake outside the cutscene director

- **Where:** `SpiderQuestSystem`'s `_cutsceneCamFromX`/`_cutsceneCamFromY`/`_cutsceneCamLerpProgress`, `cameraTargetOverride`, `_screenShakeIntensity` and `_applyShakeJitter`, driven off its own frame clock (`CS_CAMERA_PAN_FRAME`, `CS_PAN_END_FRAME`, `CS_RUMBLE_FRAME`); read in `DungeonScene.camera()` ahead of the director's `cameraFocus`.
- **Problem:** the cutscene director has `panCamera`, `holdCamera`, `returnCamera` and `shake` steps, but the spider lab's opening pans with a linear lerp from the player to the egg, follows its spit projectile and impact point, and ramps a random-jitter shake down mid-pan, all keyed to frame numbers inside one timeline. None of that maps onto the director's steps without changing how it looks and times, so the camera has two cutscene owners.
- **Cost:** two places decide where a scripted camera points and how a scripted shake feels, and the scene's camera chain has to rank them by hand.
- **Better shape:** play the lab's opening as a director script: a `panCamera` to the egg, a world action that fires the spit, a camera step that follows a moving point, and a shake profile that decays across the pan; then delete the system's own camera fields.
- **Until then:** don't add camera or shake moves to another system's private timeline; script them through the director's steps.
- **Size:** M
- **Found:** 2026-10-28, cutscene camera and world steps.

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
