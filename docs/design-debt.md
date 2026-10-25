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

## Townsfolk

### Two skyfowl civilian looks are painted and gated but never worn

- **Where:** `SKYFOWL_CIVILIAN_LOOKS` (`src/sprites/art/skyfowl/cast.ts`), `SKYFOWL_ROLE_FOR_TOWN_ROLE` (`src/creatures/citizenFigure.ts`).
- **Problem:** the two `clerk` looks are in the civilian pool, but no `TownRole` maps to the skyfowl `clerk` role, so the street wears only 14 of the 16 civilian looks. The art and cast-motion gates still paint and check both.
- **Cost:** gate time and review effort spent on looks no player sees, and a "16 looks" count that overstates the street's real variety.
- **Better shape:** map a town role (`commoner` or `priest`) onto `clerk`, or move the clerk looks out of the civilian pool to wherever they are meant to be used.
- **Size:** S
- **Found:** 2026-10-21, town crowd variety tiers.

### Townsfolk legwear colours are module state swapped round each bake

- **Where:** `setTownsfolkLegwear` / `resetTownsfolkLegwear` and the `worn` binding in `src/sprites/garments/human/townsfolkLegwear.ts`, read only by the two cast garments `TOWNSFOLK_TROUSERS` and `TOWNSFOLK_SHOES`; callers `buildBipedFigure` (`src/sprites/art/townCastFigure.ts`) and `paintIncubusFrame` (`src/sprites/art/incubusFigure.ts`).
- **Problem:** the leg painters (`paintLegCloth`, the shoe painter) take their colours as arguments, but the two cast garments are shared by every cast look, so they pass the colours a module-level binding holds, which each bake sets in a `try` and resets in `finally`, while every other part of a figure on the biped rig reads its look from the compose options.
- **Cost:** two figures cannot be baked interleaved, a throwing painter between set and reset would leak colours into the next figure, and the two garments' paint depends on hidden call order rather than their inputs.
- **Better shape:** carry the legwear on the look (or build the two garments per look, as `DAVE_TROUSERS` is built on a fixed denim) so the painters read it from their frame, as the torso garment reads `frame.look`.
- **Until then:** don't add another setter of this kind for a garment; put new per-look garment data on `HumanLook`, or give the look a garment of its own that passes its colours to the painter.
- **Size:** S
- **Found:** 2026-10-23, moving the biped rig's look into `HumanLook`.

## Rendering and memory

### The game's memory tally misses about 40% of what Chrome counts

- **Where:** `surfaceTallies()` in `src/core/canvasSurface.ts`, `src/dev/perfMemory.ts`.
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

### Figures freeze ink measurements the runtime already measures

- **Where:** the `GORE_RECENTRE` tables and their lookups in `src/sprites/art/darkKnightFigure.ts`, `mantidFigure.ts`, `rockGolemFigure.ts`, `lichFigure.ts`, `llamaFigure.ts`, `krakarenFigure.ts`, `tusklingFigure.ts`, `goblinFigure.ts`, `goblinBomberFigure.ts`, `skeletonFigure.ts`, `brindledVespaFigure.ts`, `ratFigure.ts`, `cockroachFigure.ts`, `troglodyteFigure.ts`, and on the shelf `src/shelf/auntieGorge/auntieGorgeFigure.ts` and `src/shelf/ironIggy/ironIggyFigure.ts`; `GORE_CENTRE_CORRECTION` in `src/sprites/art/cowGore.ts` (gated by `scripts/gates-cow.ts`); frozen head clearances `MONGO_HEAD_CLEARANCE_TILES` (`mongoSprite.ts`), `IRON_IGGY_HEAD_CLEARANCE_TILES` (`src/shelf/ironIggy/ironIggySprite.ts`), `GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES` (`src/sprites/gluteusMaxxSprite.ts`), `SPLASH_ZONE_STANDING_TOP_ABOVE_TILE` (`src/sprites/art/splashZoneFigure.ts`) and `HUMAN_SPRITE_TOP_ABOVE_TILE` (`src/creatures/HumanPlayer.ts`, gate G21 in `scripts/gates-human.ts`); and the gates that re-measure them (`scripts/gates-*.ts`, `scripts/goblinSubjects.ts`).
- **Problem:** each figure nudges every gore piece by an offset measured offline so its ink sits on the cell's centre, or freezes how far its art stands above its tile, and a gate re-measures the number on every render. But `figureFrameCache.ts` measures both at runtime: `drawFigureCachedRotatedCenter` spins a piece about `figureInkBounds(...)`, so where the ink sits in its cell does not change how it tumbles, and `figureRowInkTop` gives a drawn row's top.
- **Cost:** every redraw means re-pasting measured numbers to keep gates green, for values the runtime could read itself. Their doc comments say only an offline pass can measure ink, which the runtime contradicts.
- **Better shape:** paint each gore piece about the cell's centre with clearance from the edges and hang overhead chrome off `figureRowInkTop`; then delete the tables, the constants, their lookups and the gates that re-measure them. The structural gate's edge check is what still matters.
- **Until then:** don't add a new frozen recentring table or head clearance, or a gate for one; paint new gore pieces about the cell's centre and measure a row's top at runtime.
- **Size:** M
- **Found:** 2026-10-22, code review of a new boss figure.

## Human figure

### The rows roll every look's foot on the rig's sole

- **Where:** `soleOffsets` in `src/sprites/art/human/gaitShared.ts`, `probeLeg` in `src/sprites/art/human/probe.ts`, `scaleFootByBuild` in `src/sprites/art/biped/limbs.ts`.
- **Problem:** row poses are look-independent, so a rolling foot is planted by the rig's heel and toe. A look with a shorter foot (`LimbBuild.footLength`, Ryan's 0.82) is painted stretched across the picture after the pitch, which keeps the ends' heights but moves them along the floor; measured on his own sole, his foot slides about 1.2 in-game px through the stance of the run-strike rows (`jab_run_side_*`). G10 measures the rig's sole, so it does not see this. Stretching along the pitched foot instead lifts the planted end off the floor on every rolling contact.
- **Cost:** a planted foot on a look with its own foot size is held to a sole it does not have; the probe's sole landmarks are the rig's, not the painted foot's.
- **Better shape:** let the row's pose solve the rolling contact against the look's own sole (`withLookBuild` carrying the foot size into the stance solve), then scale the foot along its pitched axis and measure the look's own sole in `probeLeg`.
- **Until then:** don't give a look a foot size much further from the rig's than Ryan's without re-measuring the slide on its own sole.
- **Size:** M
- **Found:** 2026-10-24, threading look foot size through the human figure's contacts and probe.

### A gap that closes by a hairline flickers between outlined and cleared

- **Where:** `clearOutlineInHoles` in `src/sprites/art/figureCompose.ts`, called from `src/sprites/art/biped/figure.ts`; `WING_HEAD_ON`'s `claw` in `src/sprites/art/incubusArt.ts`.
- **Problem:** the outline is cleared inside a gap only when the gap is fully enclosed by the silhouette. When a gap's mouth is about one pixel wide, rounding opens it on some frames and shuts it on others, so a block of outline ink comes and goes from frame to frame. The incubus's wing claw is held a few pixels clear of his horns for this reason. Closing the silhouette by the outline's width before the reachability test fixes that case, but it flips Ryan's `build_side` hand pocket between frames and fails G3.
- **Cost:** any figure whose limbs or props nearly touch can gain an idle or loop flicker that only shows up as a stillness or seam failure, and the fix has to be made in that figure's art.
- **Better shape:** decide whether a gap is enclosed once per row (for example from the rest frame or a majority of frames) rather than per frame, so every frame of a loop treats the same pocket the same way.
- **Until then:** keep painted parts either clearly touching or a few pixels apart in every frame of a row; don't tune a gate threshold to absorb the flicker.
- **Size:** M
- **Found:** 2026-10-24, incubus idle stillness on the shared biped painter.

## Shared types

### Tile geometry types are declared five times, and the shared one lives in the town plan

- **Where:** `TileRect` in `src/map/town/townPlan.ts`, `src/map/pastSafeRoom.ts`, `src/systems/briarHollow/questGuidance.ts`, `src/creatures/fairies/fairyRefuge.ts` and `src/systems/bossRooms/bossRoomLayout.ts`; `TilePoint` in `townPlan.ts`, `bossRoomLayout.ts`, `src/map/bigTopMazeDecor.ts`, `src/systems/dungeon/dungeonEmitters.ts`, `src/core/SavedWorld.ts`, `src/ai/actions/world.ts` and `src/dev/perfWalk.ts`.
- **Problem:** the same tile rectangle and point are redeclared per feature, and code with nothing to do with a town (`WorldResidency`, and dozens of files under `src/` and `scripts/`) imports them from the town plan because it is the most complete copy.
- **Cost:** a floor-agnostic system depends on the town generator's module, and the copies can drift (some fields are `readonly`, some not).
- **Better shape:** one `src/map/tileGeometry.ts` holding `TilePoint` and `TileRect`, imported everywhere; the feature modules drop their copies.
- **Until then:** import `TileRect`/`TilePoint` from `townPlan.ts` rather than declaring another copy.
- **Size:** S
- **Found:** 2026-10-22, floor-wide residency system.
