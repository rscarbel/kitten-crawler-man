# Town Redesign — Progress Tracker

Working tracker for [town-redesign.md](town-redesign.md). Update the status column as
work lands; add dated notes under each phase. Keep the metrics table current — it is
the fastest way to tell whether the redesign is actually working.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⊘ dropped (say why)

**Overall status:** ◐ In progress — Phases 0, 1 and 2 done 2026-07-25. The town now
draws from the generated tileset with blended material boundaries, world-space tone and
ambient occlusion. Next up is Phase 3, compaction and the street plan.

---

## Live metrics

Re-measure after each phase (Phase 0 gives you the tooling to do it in one command).

| Metric                              | Baseline      | Target      | Current                                             |
| ----------------------------------- | ------------- | ----------- | --------------------------------------------------- |
| Town bounding box (tiles)           | 74 × 73       | 55 × 40     | 74 × 73                                             |
| Town area (tiles)                   | 5402          | 2200        | 5402                                                |
| Built density                       | 16.5%         | 40.5%       | 16.5%                                               |
| Farthest building door from plaza   | 42.6          | ~28         | 42.6                                                |
| Ground materials used in town       | 2             | 7           | 2                                                   |
| Ground materials available          | 2 usable      | 14          | **14**                                              |
| Worst joint-to-interior ratio       | never wrapped | ≤1.15       | **1.11**                                            |
| Tiles before a visible repeat       | 1             | 4+          | **4–7 (patch); variant choice has no period to 96** |
| Distinct outdoor prop types         | 3             | 15+         | 3                                                   |
| Town safe radius (tiles)            | 55            | ~40         | 55                                                  |
| Overworld frame time                | unchanged     | no regress. | **unchanged**                                       |
| Chunk bake (256 tiles, node-canvas) | 1.13ms        | no hitch    | **2.26ms**                                          |
| Tile-grid amplitude on open ground  | n/a           | invisible   | **1.4/255**                                         |

---

## Phase 0 — Instrumentation ☑

Makes every later phase reviewable from one screenshot.

- [x] `?townmap` dev route in `src/game.ts` (localhost-only, alongside `?people`)
- [x] Renders the full overworld grid to a single canvas — `src/scenes/TownMapScene.ts`,
      two framings (town / whole world), scroll to zoom, drag to pan
- [x] Overlays building footprints + names, door tiles, safe radius, circus radius,
      start tile and the Doomsday escape tile
- [x] Prints density / bounding box / farthest-door metrics to the console _and_ to an
      on-screen panel — `src/map/town/townMetrics.ts`
- [x] `?tiles` dev route — `src/scenes/TilePreviewScene.ts`, materials + live-composited
      transitions, resolving frames exactly as the renderer will (done 2026-07-25)

**Notes:**

- 2026-07-25 — `?townmap` landed. Metrics are computed in `townMetrics.ts` rather than in
  the scene so the same numbers can be produced headlessly (`generateOverworld` +
  `collectBuildingPlots` + `measureTown` run fine under `npx tsx`).
- Building footprints are re-derived from the grid — sprite anchors carry their manifest
  key, the tower is the one `MAIN_TOWER` tile — so nothing dev-only had to be added to
  `OverworldData`, and the scene keeps working across the Phase 1 refactor.
- First run reproduces the plan's measured baseline exactly: **74 × 73**, area **5402**,
  **890** built tiles, **16.5%** density, 16 named buildings, 2 ground materials.
- Farthest door measures **42.6** tiles (Miller's Farm), not the ~48 quoted in the plan —
  the plan's figure was an estimate; 42.6 is the straight-line door-to-plaza-centre
  distance and is what the tracker now records.

---

## Phase 1 — Layout module extraction ☑

Pure refactor. Zero visual change — the generated grid must be identical to today's.

- [x] `src/map/town/townPlan.ts` — `TownPlan` types + `createTownPlan(size)`: centre,
      main-road width, square, tower plot, 15 building plots, prop slots, ground-cover
      densities, safe radius, Doomsday escape tile
- [x] `src/map/town/tileGrid.ts` — bounds-checked grid writes and the one definition of
      what counts as solid (added; not in the original plan, but every painter needed it)
- [x] `src/map/town/paintStreets.ts` — main crossroads, plaza slab, per-door street stubs,
      building bypass routing
- [x] `src/map/town/paintPlots.ts` — sprite-building placement, tower plot reservation
- [x] `src/map/town/paintGround.ts` — void border, weed/dirt scatter with plot suppression
- [x] `src/map/town/townProps.ts` — fountain / torch / well painting from the plan's prop
      list (added; the plan's Phase 5 `townProps.ts`, seeded with today's three props)
- [ ] `src/map/town/groundMaterials.ts` — **deferred to Phase 2**; it is a renderer
      concern (material → sheet row/frame) and there is nothing for it to hold until the
      `GroundMaterial` enum exists
- [x] `generateOverworld` consumes a `TownPlan` reproducing the current layout exactly
- [x] `OverworldData` contract unchanged apart from `fountainCentre`, widened to optional in
      review round 1; circus / forests / ruins / spawns untouched
- [x] Output verified identical, not just "looks the same" — see note below
- [x] typecheck / lint / format clean

**Notes:**

- 2026-07-25 — `generateOverworld` went from a single **709-line** function (lines 60–768 of
  a 768-line file) to an **83-line** orchestrator over `src/map/town/`, plus named helpers
  for the circus, forests, ruins and spawn scatter it still owns. The file is 449 lines.
- **Proof the refactor is a no-op:** `Math.random` was replaced with a seeded mulberry32,
  then the pre-refactor generator and the refactored one were run over the same RNG stream
  and their whole output hashed — grid types, sprite keys, and every `OverworldData` field.
  **160/160 runs identical** across map sizes 200/240/280/320 × 40 seeds each. The circus,
  forests, ruins and scatter come out tile-for-tile identical, not merely statistically
  similar, which means the ordering of every RNG-consuming pass was preserved exactly.
- `BuildingEntry.type` is now the named `BuildingKind` union from `townPlan.ts` rather than
  an inline string union — same shape, one source of truth.
- The tower still writes no tiles. Its plot is reserved only so street routing detours
  around the spire; ground scatter deliberately still runs beneath it, exactly as before.

**Review round 1 (independent), fixes applied:**

- `placeSpriteBuilding` now throws on an off-map anchor. The extraction had quietly turned
  the original's unchecked write into a no-op, so a building pushed off the grid by Phase 3
  compaction would still register a quest anchor and a street stub with no art on the map.
- The road far-side offset was one constant in the original and had become two `4`s in two
  modules. It became one `TownPlan` field derived from `mainRoadWidth` (superseded in round
  2, which split it into `approachRoadStopOffset` and `frontageTurnThreshold`), and the
  circus approach roads moved into `paintStreets.connectSiteToMainRoads`.
- `townMetrics` matched art to named entries by _containment_, which works today and breaks
  exactly when compaction puts one door inside a neighbour's footprint — double-counting
  area and corrupting the density metric in the phase it exists to validate. Matching is now
  exact (`anchor + manifest doorway`, tower by entry kind), each entry can be claimed once,
  and unmatched art warns instead of vanishing.
- `?townmap`: the browser fires `click` after every press/release, so every pan ended by
  toggling the view and re-framing. Panning now needs to exceed a 4 px threshold to be a
  pan, the origin is clamped so the map cannot be dragged off-screen, and the safe-radius
  and circus circles were centred on a tile _corner_ while the markers used tile centres —
  a 12 px error at full zoom, when the point of the circle is judging what falls inside it.
- `fountainCentre` fell back to the town centre when no fountain existed, which would play
  water from a dry plaza. It returns `undefined`; consumers already treat it as optional.
- `TileRect`/`TilePoint` were declared twice inside `src/map/town/`, and `GameMap` still
  hand-rolled the building-kind union. Both now come from `townPlan.ts`.
- `townMetrics` no longer imports `OverworldData`, which had made `town/` both define the
  generator's inputs and consume its outputs. It takes a structural `MeasurableOverworld`.

Declined, with reasons:

- _Add a `never` default to the prop switch._ The premise — that a new prop kind would
  "compile clean and paint nothing" — is wrong: `@typescript-eslint/switch-exhaustiveness-check`
  is an error in this repo, and adding a fourth `PlannedProp` kind fails `npm run lint`
  (verified). A runtime guard would duplicate a gate that already blocks the commit.
- _Rename `src/map/town/` to `src/map/overworld/`._ Plan §5 names the directory; renaming it
  is a plan change, not a review fix.

All fixes re-verified: still **160/160 identical** generator output, metrics unchanged.

**Review round 2 (independent), fixes applied:**

- **Found a real pre-existing layout defect.** Round 1's unification of the road far-side
  offset was right that it should be one plan-owned value, but wrong that both call sites
  wanted the same _quantity_, and the rationale written for it was fiction. The E-W road
  band ends at `centre.y + 2`; approach roads start at `centre.y + 4`. **Row `centre.y + 3`
  is never paved** (and likewise column `centre.x + 3` eastward), so an approach taking the
  far-side branch stops a tile short of the junction — reproduced on seed 8 / size 280,
  circus at (186, 209), row 143 grass between road and approach. Scope corrected in round 5:
  the near-side branch targets a tile _on_ the band and never gaps, so the circus is only
  actually cut off when it lies south **and** east — roughly 45% of the seeds in that
  quadrant, ~11% of all seeds, and zero in the other three quadrants, over 2000 seeds and
  reproduced independently. Pre-existing and byte-identical,
  so it was left in place, but it is now documented as a defect rather than dressed up as a
  design choice. **Phase 3 should set
  the approach target to `Math.floor(mainRoadWidth / 2)`** so approaches actually reach the
  junction — it is a loop bound, so a fractional value throws rather than paving.
- The one constant is now two — `approachRoadStopOffset` (a target a road is paved to) and
  `frontageTurnThreshold` (a threshold on a building's position). Equal today, derived from
  `mainRoadWidth`, but they are not the same thing and Phase 3 will move only one of them.
- Two more hand-rolled copies of the building-kind union survived round 1's dedup, in
  `BuildingSystem.BuildingEntry` and `GameMap.generateInterior`. Both now use `BuildingKind`.
- `?townmap`: `handleWheel`'s comment claimed cursor-anchored zoom the scene cannot do
  (`Scene.handleWheel` gets only a delta); corrected. `clampOrigin` now also runs from
  `update`, since shrinking the window could leave the origin outside its bounds until the
  next pan.

Re-verified after round 2: **160/160 identical**, metrics unchanged, all gates clean.

**Review round 3 (independent), fixes applied:**

- **The Phase 3 fix this tracker prescribed would have crashed.** `mainRoadWidth / 2` is
  2.5, and the value is used directly as a loop bound; `TileGrid.inBounds` range-checks but
  does not require integers, so a fractional coordinate passes the guard and then throws on
  the row lookup. Every occurrence now says `Math.floor(mainRoadWidth / 2)`, and
  `approachRoadStopOffset`'s docs say why it must stay integral.
- A claimed "second dead zone" around `frontageTurnThreshold` was written up here and in
  two JSDoc blocks. **It was wrong, and round 4 caught it** — see that round's note. It has
  been removed everywhere.
- **A claim in these notes was false and is now true.** Round 2 recorded that pointing
  `GameMap.generateInterior` at `BuildingKind` meant a sixth building kind could no longer
  ship with a house interior. It did not: the function was three nested ternary chains with
  a house fallback, so widening the parameter type added no enforcement at all — only
  `BUILDING_TYPE_ICONS` failed. The chains are now one exhaustive
  `Record<BuildingKind, { w, h, floorType }>` (plus the Big Top's by-name override, since it
  is registered as a `house`). Verified by adding a sixth kind: both `GameMap` and
  `BuildingSystem` now fail to compile, where before only `BuildingSystem` did.

Re-verified after round 3: **160/160 identical**, metrics unchanged, all gates clean.

**Review round 4 (independent), fixes applied:**

- **Round 3's "second dead zone" was not real, and has been removed everywhere.** The claim
  was that a building whose front row lands on `centre.y + 3` or `+ 4` gets neither the E-W
  branch nor the frontage turn. It cannot happen: `SpriteLoader.computeDoorway` pins every
  doorway to the row above the sprite's front row, and `connectDoorToStreet` paves that row
  and the front row contiguously — so a front row at `+3` paves the band row `+2` itself,
  and one at `+4` paves `+3`, which abuts it. Verified by flood-filling road tiles from a
  probe building's door at every front row from `+0` to `+8`: connected in all nine cases.
  The real round-2 defect is different in kind, and round 5 corrected this explanation too:
  both runs are contiguous, but they aim at different places. `connectDoorToStreet`'s
  non-turning branch targets `centre.y − floor(mainRoadWidth / 2)`, a tile _on_ the band;
  `connectSiteToMainRoads`' far-side branch targets `centre.y + approachRoadStopOffset`, two
  tiles _past_ the band's far kerb. That target, not the contiguity, is what leaves the gap.
- Worse than the wrong claim was its consequence: the Phase 3 checklist told a future
  implementer to move `frontageTurnThreshold` alongside `approachRoadStopOffset`, which
  would have started firing frontage turns for buildings that already front the main street
  — a gratuitous layout change to fix a bug that never existed. The checklist item now moves
  only `approachRoadStopOffset`.
- `OverworldData` contract: the checklist said "unchanged" while a note twenty lines below
  recorded `fountainCentre` being widened to optional. Corrected.
- The round-1 note still named `mainRoadFarSideOffset`, a field round 2 replaced. Marked
  superseded.

Re-verified after round 4: **160/160 identical**, metrics unchanged, all gates clean.

**Review round 5 (independent), fixes applied:**

- The round-2 defect was real but its **scope was overstated** in both the `TownPlan` JSDoc
  and the round-2 note: "severed on every seed where the circus lies south or east". Only
  the far-side branch gaps; the near-side branch targets a tile on the band, so a south-west
  or north-east circus always connects. Measured over 300 seeds at size 280 by flood-filling
  the paved network from the circus grounds to the plaza: **every cut-off seed is south _and_
  east**, with none in the other three quadrants. The rates quoted in this note initially
  came out low; round 7 traced that to the seeding (see below) and the settled figures are
  ~45% of the south-east quadrant and ~11% of all seeds. Both places now state the scope and
  a rounded rate rather than raw counts, which are stream-dependent.
- Round 4's explanation of _why_ the door stub does not have the same bug was also wrong —
  it blamed contiguity, when both runs are contiguous. The difference is the target: one
  aims at a tile on the band, the other two tiles past its far kerb. Corrected.

Re-verified after round 5: **160/160 identical**, metrics unchanged, all gates clean.

**Review round 6 (independent), fixes applied:**

- **The `PlannedTower.plot` JSDoc claimed the plot "keeps roads and scatter out from under
  the spire". It keeps out neither.** The N-S road band spans `cx − 2 … cx + 2` and the plot
  spans `cx − 3 … cx + 2`, so the main road runs straight through it — 98 of its 126 tiles
  are road — and `scatterGroundCover` is only passed the sprite footprints, so weeds and
  dirt land under the spire too, ~7 tiles per generation (measured over 200 seeds). The
  field's only real job is giving `paintBuildingBypassRoutes` a rectangle to route around,
  which is what `paintPlots.towerPlot` and the generator's own comments already said
  correctly. Dangerous because Phase 3 moves the tower and might have trusted the contract.
- Round 5's connectivity counts didn't reproduce: "56 of 300 seeds" in the south-east
  quadrant is 18.7%, but the circus angle is uniform so a quadrant must be ~25%. The scope
  conclusion survives every re-measurement — each cut-off seed is south _and_ east, none in
  the other three quadrants — so the docs now state the scope and a rounded rate instead of
  raw counts.
- **One of the two "measurement traps" in the lesson below was itself false.** Flood-filling
  from the circus centre does work: `placeTileBuilding` puts the big top's two-tile door gap
  at exactly `(centre.x − 1, centre.y)` and `(centre.x, centre.y)`, so the circus centre is
  one of its own door tiles and is paved in 200/200 seeds. The real trap was only the
  `DIRT_PATCH` one.
- `DOOR_STREET_MAX_WIDTH`'s comment said "the mead hall's five-tile front". The Horned
  Flagon's doorway is **four** tiles (and is the only town doorway the clamp touches).
  Carried verbatim from the pre-refactor comment, so pre-existing — corrected in passing.

Re-verified after round 6: **160/160 identical**, metrics unchanged, all gates clean.

**Review rounds 7 and 8 (independent) — no code findings in either.** Both confirmed the
byte-for-byte equivalence independently, and round 8 additionally hashed
`GameMap.generateInterior`'s output over 5 kinds × 18 building names × 4 tower floors
(360/360 identical old vs new). The remaining fixes were to this file:

- The south-east-quadrant rate was low because of how the _seeds_ were generated, not the
  measurement: `mulberry32(i * 2654435761)` over consecutive `i` is an arithmetic
  progression whose first draw is not uniform, giving 18.3% at n=300 and 22.6% at n=1000
  when a uniform circus angle guarantees ~25%. Mixing the counter through an integer hash
  first gives 25.3–25.6%, matching two independent reviewers. Settled figures, stable across
  map sizes and seed families: **~45% of the south-east quadrant, ~11% of all seeds, zero in
  the other three.**
- The closing lesson had two false claims of its own — an undercount whose scope did not
  match its own record, and "every claim that was executed before being written held up",
  which the paragraph after it refuted. Rewritten to give no tally and to classify the
  failures by kind. Round 8 then caught that the rewrite had _reinstated_ a trap round 6
  disproved (flood-filling from the circus centre, which is one of the big top's own door
  tiles and is always paved) — corrected again.
- The refactor's own line counts were wrong: `generateOverworld` was 709 lines, not 768
  (that is the file), and the orchestrator that replaced it is 83 lines, not 200.

Re-verified after rounds 7 and 8: **160/160 identical**, metrics unchanged, all gates clean.

**Lesson worth keeping.** Seven review rounds turned up roughly a dozen false statements in
this file and in the new modules' JSDoc — the exact tally depends on whether you count
mis-measurements and bad prescriptions alongside plain wrong explanations, and two attempts
at pinning down a number here were themselves corrected, so no number is given. Most of them
were mine. They fall into three kinds, and the third is the one worth remembering.

**Explanations written from reasoning.** Round 1's invented rationale for the road offset,
round 3's "second dead zone", round 4's contiguity explanation, the tower plot's "keeps
roads and scatter out", the checklist's "`OverworldData` contract unchanged", round 2's
`generateInterior` enforcement claim. Every one of these was plausible, and every one was
disproved in minutes by a script. None of them had been run before being written.

**Prescriptions written from reasoning.** The Phase 3 fix this tracker told a future
implementer to apply would have thrown a `TypeError` (a fractional loop bound), and an
earlier version of it would have made a gratuitous layout change to fix a defect that did
not exist. A prescription is a claim about code that does not exist yet, which makes it the
easiest kind to get wrong and the hardest to notice.

**Measurements that ran but still lied.** This is the trap, because running something feels
like verifying it. The circus-connectivity figure was measured three times before it
settled: first treating `DIRT_PATCH` as unpaved, when ground scatter converts ~6% of road
tiles to it — which is also the only reason a flood fill seeded on the single circus-centre
tile failed, since that tile is one of the big top's own door tiles and is always paved;
then over a sample too small for the quantity claimed; then — the subtle one — over seeds
as `i * 2654435761`, an arithmetic progression whose first `Math.random()` draw is _not_
uniform, which quietly pushed the south-east quadrant to 22.6% when a uniform angle
guarantees ~25%. Mixing the counter properly gave 25.3–25.6% immediately.

So: claims about this generator are cheap to test headlessly, and untested ones have been
wrong far more often than not. Test them — then check the test against something you know
must be true independently (a quadrant is a quarter; the paved set includes `DIRT_PATCH`),
and prefer a stated scope to an exact count that depends on which seeds you happened to draw.

---

## Phase 2 — New ground tileset + rendering ☑

Highest visual payoff, lowest layout risk, and the foundation everything else sits on.
Do this before touching the layout. See plan §7 for the method and the proof.

**Generation — ☑ done 2026-07-25**

- [x] `scripts/tilegen/` library — `NoiseField` (value/fbm/worley/warp, all torus-wrapped),
      `Surface` + wrapping primitives, palettes, materials, masks, sheet packing
- [x] `scripts/generate-ground-tileset.ts` entry point
- [x] Palettes anchored to the tiles that already work (row 0 c0, row 3 c0), then widened
- [x] Feature painters: blades, setts, slabs, gravel chip, mineral grain, debris chunks,
      puddles, moss, coursed masonry
- [x] **Multi-tile patches** (2×2 / 4×4) generated as one wrapped field and sliced, so
      pattern period is decoupled from tile size
- [x] **Structure/detail seed split** — geometry shared across a material's variants so
      paved variants line up where they meet
- [x] 14 materials, exact 64 px integer grid, sheet dims exact multiples
- [x] Script emits the manifest entry too (fixes the 63.909-vs-64 row-pitch bug) and
      records `patchTiles` so the renderer can resolve frames
- [x] Seeds are fixed constants in the entry script — reproducible, not a mystery binary
- [x] **Seam audit in the build** — joint-to-interior ratio per material, exits non-zero
      above 1.15. Current worst 1.11.
- [x] Corner transition masks shipped as one shared sheet, composited at load
- [x] A **calm, jointless** material (`dungeon_plain`) so a floor can hold a long stretch
      without becoming a grid
- [x] `add-ground-tile` skill documenting the pipeline and its four rules

**Rendering — ☑ done 2026-07-25**

- [x] `GroundMaterial` enum + material→row mapping — `src/map/town/groundMaterials.ts`
      (the module Phase 1 deferred). The type _is_ the sheet's state union, so a
      material that is not in the manifest is a compile error.
- [x] Frame resolution shared with `TilePreviewScene` rather than duplicated —
      `groundFrameIndex`, so the `?tiles` route cannot drift from the game
- [x] Transition compositing baked into the chunk cache
- [x] `overworldRotation` deleted, along with `overworldFrame` and
      `drawOverworldSprite` — nothing drew the old sheet afterwards, so its manifest
      entry went too (the PNG stays on disk; the generator's palettes were sampled
      from it)
- [x] Per-tile variant pick by hash, per patch
- [x] Edge fringe pass — the dual cell's material stack, composited through the shared
      corner masks (see the review-round note; the first attempt classified on the tile
      grid and dilated every harder material by ~0.4 tile)
- [x] Scatter pass — tufts and grit from the _softer_ neighbour only; the harder one
      already reaches across through the masks
- [x] **World-space** low-frequency tone — two fields at coprime periods, so the
      pattern repeats after 864 tiles — fourteen screens; ~10% peak-to-peak per
      screen, bounded at 12%
- [x] Ambient occlusion on ground adjacent to walls / buildings / ruins (not trees —
      see review round 2)
- [x] All of the above baked into the 16-tile chunk cache, nothing per frame
- [x] Screenshot review: **the grid is gone at 1× zoom** — measured, not just eyeballed
- [x] typecheck / lint / format clean

**Notes:**

- 2026-07-25 — the ground pass is five ordered passes in `src/map/tiles/groundTiles.ts`:
  base frame, fringe, scatter, world tone, occlusion. `terrainTiles` (grass, road),
  `decorationTiles` (weeds, dirt patches, rubble) and `buildingTiles` (ruined walls) all
  call the one entry point, so every outdoor tile blends the same way.
- **Only `grass` and `lane` are produced today**, which is Phase 3's job to change. The
  renderer blends all seven, and the fringe already fires everywhere town meets street.
- `DIRT_PATCH` deliberately maps to `lane`, not `dirt`. It is a worn patch _drawn on_ a
  road: as its own material the surrounding lane would win all four of its corners and
  the mask would cover it completely, deleting the decoration.

**Found and fixed: the corner masks tore at every boundary that changed shape.**

`buildMaskSet` seeded each mask `seedBase + bits`. The module's own doc says two
neighbouring tiles must perturb their shared boundary identically — but neighbours
across a boundary usually hold _different_ corner combinations (a straight edge that
turns a corner puts a half mask beside a wedge), so a per-combination seed is exactly
what breaks it. Measured over all 64 adjacent combination pairs: worst mismatch on a
shared edge **1.000 of full alpha** — one tile solid where its neighbour is bare.

- One shared warp field drops it to a step _smaller_ than the masks' own strongest
  internal step — see review round 2, which replaced this absolute figure with the
  joint-to-interior ratio the material patches are already audited against.
- `DIAGONAL_SEPARATION_BIAS` was the other tear: a flat −0.18 over the two diagonal
  masks put their whole field below a neighbour that shared their corners (mismatch
  1.000). It is now multiplied by an `interiorWindow` that is 1 at the tile centre and
  0 all round the border, so it still separates the wedges but cannot move an edge a
  neighbour has to agree with. Re-measured after the amplitude change below, the worst shared-edge step
  involving a diagonal mask is **0.230**, which is also the whole set's worst — and
  well under the masks' own internal steps, which is the measure that matters.
- With continuity structural rather than accidental, `BOUNDARY_WARP_AMPLITUDE` went
  0.34 → 0.65. At 0.34 the four half masks wobbled 1.3–2.4px of 64 — at 32px on screen,
  a straight line, and a road's north edge was dead flat (±2px over 300px of frontage).
  The ceiling is `2 * (0.5 - EDGE_FEATHER)`; past it the warp punches holes in a tile
  that should be entirely covered.
- Only `ground_masks.png` changed. The other two sheets regenerate byte-identical,
  which is the seeds doing what they were committed for.

**Performance.** The tone layer was 65% of the whole ground pass as a `multiply`
composite (386ms → 1107ms per 324 chunk bakes). Stored as black at varying alpha and
blended with the default operator it lands on the same `dest * (1 - alpha)` without
leaving the compositor's fast path: **1010ms → 452ms**, i.e. 1.39ms per 256-tile chunk
against a 1.08ms baseline for 4 extra passes. Fringe, scatter and occlusion together
cost 40ms of that 324-chunk run. Measured under node-canvas, which is slower than a
browser; the ratio is what matters.

**Is the grid gone?** Measured, because "looks fine" is not an answer for a 0.5% signal.
A 40 × 24 field of one material, FFT of the row and column means: the component at the
32px tile pitch has an amplitude of **1.2–1.4 of 255** on grass and **0.8–1.5** on lane,
against a standard deviation of those same series of **1.9–2.5** and **5.5–6.9**. So the
tile pitch is at or below the material's own variation, on both axes, for both
materials. A first pass at this used the peak's ratio to the noise floor and read
300–700, which said nothing — the floor is tiny because the signal is a smooth average.
Amplitude against the material's own variation is the honest form.

**Every tile draws inside its own rect, verified** — of the _ground_ passes. Note for
whoever runs that comparison next: on a real map it also picks up `RUINED_WALL`, whose
rebar is drawn 5px above its own tile (`RUIN_REBAR_OVERHANG` in `buildingTiles.ts`) and
is therefore clipped when a ruin lands on a chunk's top row. Pre-existing, unrelated to
this phase, and worth knowing before chasing it: exclude ruins, or the test reports a
ghost.

Scatter marks were positioned by
their centre, so a tuft near an edge overhung its tile — clipped at a chunk boundary,
and painted over inside a chunk by whichever neighbour the bake reached next. Rendering
the same 48 × 48 grid through the chunk cache and through the direct path differed in
**181 subpixels** (worst delta 84); with the mark clamped to its own tile, **0**. That
equality is now the cheapest regression test there is for this pass.

**Also fixed in passing.** `TilePreviewScene.compositeTransition` cached composites by
patch _phase_, so two tiles at the same phase in patches the variant hash sent to
different variants shared a cached tile and mismatched their stonework. Keyed on the
resolved frames now.

**Review round 1 (independent), fixes applied:**

- **The variant hash had no avalanche step, so variant selection was a lattice.**
  `variant` reads the low bits of `patchX*A ^ patchY*B`, and those bits are a linear
  function of the coordinates: with an even variant count the choice collapsed into a
  Latin square. Grass (4 variants, 2x2 patches) repeated **exactly every 8 tiles** —
  verified at pixel level, mean per-channel difference between tiles 8 apart 2.85/255
  (all of it the tone layer) against 12.7 for any other offset — and every 2-variant
  material was a literal checkerboard. Shipping 48 frames of lane and then laying them
  out periodically is the whole feature defeated. One finalising mix (the same one
  `latticeValue` in this module already used) gives no period out to 96 patches on
  either axis at 2, 3, 4 or 8 variants, and an even distribution.
- **The fringe was classified on the tile grid, which dilated every harder material by
  ~0.4 tile.** A tile-grid corner has to take the hardest of the four tiles touching it,
  so a tile whose _neighbour_ is paved has both corners on that side set and the mask's
  contour lands in its own middle. Measured: the last grass tile before a road rendered
  **37% paved**; a one-tile-wide softer strip was **erased outright** (all four corners
  resolve to the harder material, and the `CORNER_ALL` case then painted over it) — 33
  such tiles in a real generated town, and Phase 3's 1-tile `verge` would have been
  invisible everywhere; and the scatter pass, anchored to the tile edge, laid its tufts
  **15px inside the paving**, reading as a dashed lane marking. Now classified on the
  **dual grid**: cells offset half a tile, each corner one whole tile's material, so the
  contour falls on the tile edge. Each tile draws four quarter-tile pieces, and two tiles
  sharing an edge take their touching quadrants from the same cell, so the joint still
  cannot tear. Re-measured: last grass tile **98% grass**, first road tile 3.7% grass
  (the contour wandering back), 1-tile grass column **93%** where it was 0%, lone grass
  tile 61% where it was 0%.
- A tile draws the cell's whole material **stack**, not just the materials harder than
  its own. Two tiles either side of a joint are looking at one contour from opposite
  sides, so both have to be able to draw either material or the wander is one-sided. It
  is also exact where three materials meet at one cell, which an overlay rule is not.
- **The mask warp was biased, which the dual grid then exposed.** `fbm` averages 0.5
  over many realisations but not over one 64px tile — the shipped seed averaged 0.303,
  displacing every boundary in every mask the same way: the half mask's contour sat at
  x = 40 where the geometry puts it at 32, a systematic 13% erosion rather than a wander.
  The warp field is now centred on its own mean (one number, shared by all sixteen masks,
  so no seam), and `BOUNDARY_WARP_OCTAVES`/`BASE_PERIOD` went 3/2 → 4/3 after sweeping
  five configurations: contour mean **30.8–32.9 of 32** against an ideal 32, the largest
  wobble of any configuration tried (sd 2.8–6.8px, excursions 19–42), half-mask coverage
  48–51%, `bits=15` still fully opaque and `bits=0` fully clear.
- **Ambient occlusion put a grid of hard dark rectangles across every forest.** `TREE`
  was in the shadow set, and a tree is a lone tile: its band has two ends and nothing to
  continue them. Verified by rendering a 25%-density forest — an unmistakable tile grid,
  in the phase whose acceptance criterion is that the grid is gone. Trees are out of the
  outdoor occluder set (they carry their shade in their own art), which leaves it
  architectural solids only, and bands now **taper at any end no neighbouring band
  continues** — pre-rendered per side and taper combination, because fading on two axes
  at once is not something one gradient can do. The dungeon's `drawWallShadow` is
  untouched.
- Restored the frame clamp the deleted `drawOverworldSprite` had. No shipped material
  can overrun its row, but a row with fewer frames than one patch would blit a slice of
  the next material.

Cost of the round: chunk bake 1.39ms → 1.60ms per 256 tiles (1.79ms after round 3's
inference), the dual grid being four quarter-blits where there was one. Chunk-cached and direct render paths still differ by
**0 subpixels**.

**Review round 2 (independent), fixes applied:**

- **A missing `ground_masks.png` ate the roads instead of disabling the fringe.** A
  quadrant paints its softest layer unmasked and composites the harder ones back on
  top, and the mask check sat in the _second_ step — so with the sheet absent the lawn
  went down and the paving never came back: **24.9% of a road rendered as grass**, baked
  into the chunk cache, with the scatter tufts stranded in the middle of it. `loadSprites`
  resolves happily on a missing file by design, so this was one deleted asset away. The
  check is hoisted to the top of `drawFringe` now; verified by deleting the sheet from a
  copy of `src/images` and re-rendering — 3.0%, which is the tufts alone.
- **The grass scatter colour was the retired tileset's.** `#4a8f57` is hue 131°; the
  generated grass averages hue **73°**, so every tuft read as a saturated teal dash on an
  olive lawn — the most visible thing in any render of the pass. Sampled from the sheet
  instead. The same palette rot had `GRASSY_WEED`'s two blade colours at hue 145°/155°;
  those are retuned too. `dirt` and `gravel` grit were already within 2° of their
  materials and are unchanged.
- **Material boundaries repeated exactly at the tile pitch.** Every mask is
  position-independent, so a straight road edge drew the _identical_ 64px contour on
  every tile: measured 57.5% of rows matching at a 32px lag, a ruled line with a
  repeating scallop. This is the trap the tileset's own first rule warns about — wrap at
  one tile and every feature is smaller than a tile — applied to the masks rather than
  the materials. The warp now wraps over a **3x3 tile patch** and is sliced by the dual
  cell's position, so the sheet carries 16 combinations x 9 phases = 144 frames. Match
  rate at a 32px lag fell to **5%** and moved to 96px (3 tiles) at 63%, and the wander
  grew from sd 1.99px to **2.93px** over a 19px range.
- **The seam claim was measured on one axis and stated in the wrong units.** Both axes
  now, and against the masks' own internal steps rather than in absolute alpha — the
  yardstick plan §7 already argues for, because a mask legitimately contains hard lines
  and its joint may land on one. **Joint-to-interior 0.77** (0.65 when this was first
  measured with a denominator that mixed the two axes — see round 4): the joint is
  softer than the hardest line inside a mask. The original per-combination seeding
  scores far above 1 on the same measure. `auditMaskSeams` is part of the generator now and throws above 1.0,
  so the number is reproduced by running the build rather than quoted from a note.
- **`BOUNDARY_WARP_BASE_PERIOD` violated `NoiseField`'s stated precondition.** Periods
  must divide the patch; 3 does not divide 64. It is 4 against a 192px patch, where 4,
  8, 16 and 32 all divide cleanly.
- The warp-centring comment justified itself with figures that did not reproduce at any
  configuration. It no longer quotes any: the fix is right because it removes a
  dependence on the realised mean, not because of a particular seed's mean. The
  amplitude ceiling was likewise derived on an assumption of symmetry the mean-centred
  field breaks, so `buildMaskSet` now _asserts_ that the solid mask is solid and the
  empty one empty instead of claiming a bound.
- **The `?tiles` transitions view was still compositing on the tile grid** — the scheme
  round 1 replaced — while this file and two doc comments claimed it showed what the
  renderer draws. Since the phase's acceptance method is "review it at `?tiles`", the
  fringe is now shared code: `drawFringe` takes a material lookup rather than the tile
  grid, and the preview passes its own. That is also what lets the route preview dungeon
  materials and pairs the map never produces.
- `drawGroundTile` no longer takes the material from its caller. It was the same lookup
  the fringe already does for every neighbour, with nothing enforcing that the two
  agreed.

**Review round 3 (independent), fixes applied:**

- **Round 2's own tidy-up blanked the ground under 18.7% of the overworld.** Removing
  `drawGroundTile`'s material parameter looked like it removed a divergence risk. It
  removed a load-bearing argument: seven call sites pass an _inferred_ floor because
  the tile's own type is not a floor — `TREE`, `TORCH`, `WELL`, `FOUNTAIN`, `BRAZIER`,
  `MAIN_TOWER`, `SPRITE_BUILDING`, `MODERN_DECORATION` — and deriving the material from
  the tile type gave `undefined` for every one of them, so they drew nothing at all onto
  a canvas that is never cleared. Measured on `generateOverworld(280)`: **14,657 tiles**
  with no ground, trees floating over transparent black, a hole where the fountain
  stands. Verified by rendering each type and measuring mean alpha: **0.0**, against
  255.0 before the change.
- The fix keeps the single-lookup property rather than reverting to a caller argument:
  `groundMaterialUnder` answers directly for tiles that _are_ ground and infers from the
  surroundings for tiles that _stand on_ it, memoised per map because `inferFloorType`
  walks outward and the fringe asks sixteen times per tile. `TREE` is mapped directly
  instead — it is outdoors-only, and it is the one type inference cannot resolve, since
  a tree in a forest has nothing but trees for three rings around it. Mean alpha back to
  **255.0** for all eight types, and 0.000% transparent subpixels over a 100x100 window
  of the real town.
- **A corner with no material punched a hole in the fringe field.** Dropping it made it
  behave as the _softest_ material present, so one quadrant painted that material
  unmasked while the neighbouring cell — which does not touch the hole — painted
  nothing, meeting in a full-alpha cut down the tile's own centre line. Reproduced with
  flat colours: worst internal coverage step **255** at exactly x=15 of 32. A cornerless
  corner now counts as belonging to every layer, which both cells sharing it apply
  identically, so they still agree along their shared edge: worst step **117**, below
  the **134** a legitimate clean boundary produces. The inference fix removes every
  case reachable on today's maps; this makes the remaining ones well-defined.
- Neither failure was reachable from `?tiles`, which renders two materials with every
  tile classified and no holes. Worth remembering the next time a route is called an
  acceptance test.

**Review round 4 (independent), fixes applied:**

- **The mint tufts were still on `RUBBLE`** — 2365 tiles a map against `GRASSY_WEED`'s
  747, and four lines below a line round 2 changed. Same palette rot, same fix. Chasing
  the rest of it found two more: `buildingTiles`' base fill under every wall and roof
  was the retired sheet's `#6de89d`, and `helpers.inferGroundColor` — dead code, no
  callers — was a whole function of it. The fill now draws the real ground with a flat
  backstop underneath for a tile buried too deep in a building to resolve one; the dead
  function is gone. That in turn exposed a lattice of occlusion bands across every
  building footprint, one per tile, since a roof tile shades its neighbours: a tile that
  is itself a solid now takes no occlusion, because its ground is _under_ the structure
  rather than beside it.
- **The round-3 "a cornerless corner belongs to every layer" rule still tore**, and so
  did the next two things I tried. The tear-free argument runs through the material
  _orders_ at the two corners an edge is interpolated from — a layer only one of two
  cells holds is always covered, along their shared edge, by a harder layer both hold —
  and a corner with no order at all cannot take part in it. Setting every bit lets one
  cell draw a layer its neighbour has nothing to cover with; _skipping the cell_ fails
  the same way, because the tear is between a cell that touches the hole and one that
  does not, and only one of them skips. Both measured at a full **255** step at exactly
  x=15 of 32 — the tile's own centre line.
- The fix is to make the failure unrepresentable rather than absent: `materialAt` is now
  **total**. Every position answers with a material, the caller picks the stand-in for
  positions that have none, and since the stand-in is a function of position both cells
  sharing a corner get the same one. Verified by splitting the worst coverage step by
  _where it lands_, over four configurations including a hole beside a boundary and
  three materials meeting a hole: centre-line **45–91**, tile-edge **82–128**, against
  **116–155** for the mask's own ramp. The centre line is never the worst place; the
  broken versions put a 255 there.
- `auditMaskSeams` measured its interior steps on the horizontal axis only while
  measuring joints on both, which flattered whichever axis was smoother. Per axis now,
  and the honest figure is 0.77 rather than 0.65.
- Also: the `?tiles` preview resolved frames without the clamp the renderer applies, so
  "cannot drift from the game" had one hole in it; an orphaned JSDoc block documented
  nothing after a round-3 edit; `CORNER_ALL` was exported and unused; and the two
  generator scripts were not prettier-clean, which `npm run format` cannot catch because
  it only globs `src/**`.

**Review round 5 (independent) — no tearing, holes or blanked tiles found.** 72
configurations of 2–7 materials at nine tile sizes, plus the whole 280-tile overworld:
worst centre-line step never exceeded the mask's own ramp, and the map rendered with
zero non-opaque subpixels. The remaining fixes were to claims and to two review tools:

- **The stand-in's rationale was wrong.** `inferFloorType` never comes up empty — it
  falls back to `concrete` — so the stand-in fires for _any_ floor that is not an
  outdoor material, which can sit one tile from visible ground, not only three rings
  deep inside a wall. Unreachable today (`drawGroundTile` runs on the overworld alone,
  and every void tile within reach of ground infers real ground), but it is what a
  Phase 3 author would have trusted while adding the wall ring.
- **`GROUND_FALLBACK_COLOR` was guessed, and guessed the retired palette** — mint where
  the lawn is olive, up to 60 levels too bright. Sampled from each material's row now.
  Fifth round, same defect class: a colour written from memory of the old art.
- **The new mask gate ran after `writeMaskSheet`**, so a failing audit would have left a
  torn PNG on disk beside a stale manifest — the opposite of what the gate is for. It
  now runs before anything is written, and is spelled `!(ratio <= limit)` so a NaN
  ratio fails instead of slipping through.
- `scripts/tilegen-debug.ts` still composited with a per-combination seed and no patch
  phase — the exact scheme measured at a full-alpha tear — so the offline review tool
  would have shown tearing the game does not have. Fixed, and its header now says what
  it does and does not judge, since its blob view classifies on the tile grid where the
  renderer uses the dual grid.
- The `?tiles` base pass resolved frames without the clamp its fringe had; the plan's §7
  still said "sixteen 64x64 frames" (144 now), its phase table still listed Phase 2's
  work as remaining, and its risk table said ground transitions read the
  4-neighbourhood when the fringe and occlusion both read the 8-neighbourhood.

**Review round 6 (independent), fixes applied:**

- **Compositing the stack with plain alpha blending is wrong once a cell holds three
  blend orders.** Painting each layer at its own coverage and letting the next cover it
  leaves layer _k_ weighing `m_k * (1 - m_k+1)` where it should weigh `m_k - m_k+1`. The
  two agree only where the masks are hard, differ most at half coverage — the middle of
  the blend, on the tile's own centre line — and the difference is a _discontinuity_:
  two cells either side of that line agree on `m_k == m_k+1` for a layer only one of
  them holds, so the differenced weight vanishes there and the product weight does not.
  Measured on the real palette at **28 of 255** for lane meeting cobble meeting plaza,
  which is Market Street meeting the plaza — Phase 3's first junction. Latent today,
  since only two materials are placed, and invisible from `?tiles`, which previews
  exactly two materials per pair. The claim that the stack was "exact when three
  materials meet" was mine and was wrong.
- Layers with anything above them are now painted through a **weight stencil**,
  `(m_k - m_k+1) / (1 - m_k+1)`, which telescopes so that painting the stack in order
  lands on the differenced weights exactly. Verified: a random three-order field renders
  centre-line 44, tile-edge 75, elsewhere 88 — the centre line is the _least_ bad place,
  where the old form put it at 144 against 118 elsewhere. Colours stay in gamut
  (0..255 exactly), every pixel fully opaque, 86% of them sitting exactly on a material.
- **The masks do not nest, which the differencing assumed.** The diagonal separation
  bias lifts a sub-mask above its superset by as much as **104 of 255**, which would
  have made a weight negative. A running maximum down the stack restores nesting before
  the differences are taken.
- **My first cut of the stencil sampler was 3000x too slow**, and the reason was a real
  bug: the sheet origin was added to the block bounds _and_ to the index, so each output
  pixel averaged a run stretching to the far side of a 9216px sheet. A 24x24 three-order
  field took **40 seconds** to bake; it takes **41 ms** now. Worth recording because the
  cost is what exposed it — the output was also wrong, and quietly so.
- Stencils are cached apart from the material, keyed only by the mask stack, quadrant
  and tile size: the weights never depend on which materials are stacked, and keying
  them per material frame would have multiplied a few thousand entries into a few
  hundred thousand.
- Two premises in the comment above the layer loop were false — the tile's own corner
  bit does _not_ stay clear, and its material can be strictly harder than a layer above
  it. The conclusions hold for different reasons, now stated, and the unreachable
  `bits === 0` guard is gone.
- Also: the **material** seam gate still ran after its sheets and the manifest were
  written (round 5 fixed only the mask one); `GROUND_SPILL`'s JSDoc claimed all four
  colours were sampled between their material's mean and its dark end when dirt and
  gravel sit at the 90th percentile; the generator's header still said "16 masks"; and
  the plan's risk table said transitions read the 8-neighbourhood when `inferFloorType`
  reaches three rings out.

**Review round 7 (independent) — the weighted stack verified clean.** An independent
reimplementation of the differenced weights, compared pixel for pixel against
`drawFringe` over 2, 3 and 4 blend orders, agreed to **1.5 of 255** — pure rounding. 240
configurations of 2–7 orders at four tile sizes put the tile centre line as the _least_
bad place every time. The running maximum was checked where it actually matters: on the
frame border, the pixels a neighbouring cell must agree with, the worst nesting
violation is **7 of 255** against 104 strictly inside, so it only ever rewrites
interiors. Fixes were to one metric and three claims:

- **`gravel` shipped 3 variants**, which by the generator's own `patchTiles * sqrt(variants)`
  is 3.5 tiles before the eye finds a repeat — under the 4 this tracker holds the town's
  ground to, on a yard material Phase 3 lays in stretches. Four variants now, so every
  overworld material is at 4.0 or better. `dungeon_wall` is 2.8 and stays there: the
  dungeon still draws from its old sheet, and re-cutting it is the open question below.
  The metrics row said 4–7 and now says what the generator prints.
- The module header still said "three caches" after round 6 added a fourth, and
  `overlayCache`'s one-line doc described its key as the corner bits when it is the mask
  _frame_, which carries the corner bits and the warp-patch phase together. That path
  also keyed on the whole mask stack while reading only the first frame of it, so on the
  fallback path one surface could be stored under several keys — which quietly weakens
  the bound the Phase 3 cache-capping item rests on.
- `scripts/tilegen/materials.ts` was the generator file round 4 missed; `npm run format`
  globs `src/**` only, so nothing catches it.

**Review round 8 (independent), fixes applied:**

- **The world-space tone ran at half the amplitude three places claimed**, plus a flat
  darkening of everything outdoors. A weighted sum of hashed octaves does not reach 0
  and 1 on its own — the coarsest carries 0.62 of the weight but has four lattice nodes
  for the whole period, so it can only span whatever those four happen to be. Measured:
  the field spanned **0.000–0.508** where the mapping assumed 0–1, giving 5.9–12.0%
  darkening — a 6.1% peak-to-peak against the stated 12%, with an 8.2% flat loss on
  every outdoor tile. The field is now normalised to its own range, which makes the
  stated amplitude true by construction rather than by luck, exactly as centring does
  for the mask warp. Verified end to end: phase-averaged tile luminance now spans
  91.1–105.7.
- **The lattice hash had a fixed point at the origin**: `imul(0, A) ^ imul(0, B)` is 0
  and stays 0 through every mix, and index 0 is a node of _all three_ octaves — so the
  field's minimum was pinned to tile (0, 0) and to every 32-tile multiple of it rather
  than falling where the noise put it. With an offset mixed in first, the minimum moves
  to (16, 16) and the raw span widens from 0.000–0.508 to 0.088–0.744.
- The fallback fill now takes the tone layer too, since the fallback colours are the
  sheet's means and everything drawn _from_ the sheet is darkened by it.
- **`overworld_tileset` was still in the manifest.** It had been removed, and a
  `git checkout` of the tileset directory — mine, while testing that the seam gate
  leaves no artefacts behind — silently put it back. Three places in these docs said it
  was gone. The 1 MB PNG was still being fetched and decoded at every startup. Removed
  again, and this time verified by loading the manifest and asserting the key is absent.

**Review round 9 (independent), fixes applied:**

- **The tone layer repeated inside a screen and a half** — the thing it exists to
  prevent. Its period is 32 tiles, which at 32px a tile is 1024px against a 1920px
  window, and the comment claiming the period was "well past a screen wide" was simply
  arithmetic nobody had done. Measured: the column-mean brightness profile 32 tiles
  apart differed by **0.15 of 255** where every other lag differed by ~1.4, a repeat an
  order of magnitude above the noise. Round 8's amplitude fix had doubled how visible it
  was.
- The tone is now the sum of **two fields with coprime periods**, 32 and 27 tiles, so
  the pattern only repeats after their least common multiple — 864 tiles, which
  at 32px a tile is fourteen screens across a 1920px window. One field cannot do this affordably: it is stored at one pixel per screen
  pixel, because drawing a sub-rectangle of a smaller field scaled up clamps its
  filtering at the rectangle's edge and puts a seam on every tile boundary, so a longer
  period means a proportionally larger canvas. Two fields multiply the period for an
  added one. Re-measured: lag 32 now differs by **0.74** against a median of 1.44 across
  lags — the residual of the _other_ field, exactly as it should be, and no longer a
  distinguished lag.
- Each field carries its own seed. At equal octave counts they would otherwise have been
  the same pattern at two scales, which correlates rather than decorrelates.
- The second field costs a second blit per ground tile: the bake went from 1.77ms to
  **2.26ms** per 256 tiles against a 1.13ms baseline, still entirely at bake time.
- Realised contrast is **~10% peak-to-peak** rather than the 12% `NOISE_DEPTH` bounds,
  because two decorrelated fields rarely reach their extremes at the same tile. That is
  a property of summing them, not a defect, and it is stated rather than tuned away.
- `buildNoiseField`'s rewrite in round 8 had inlined the `4` and `3` of RGBA indexing
  that two neighbouring functions had already named; they are shared constants now.
- The "is the grid gone" note quoted a denominator measured before round 8 doubled the
  tone's amplitude, and called it a "spread" when it was a standard deviation. Both
  re-measured and named.

Known and accepted, with reasons:

- **Decorations drawn over ground escape the tone and occlusion layers.** Weed tufts,
  dirt blotches, rubble and ruin stones paint after `drawGroundTile` returns, so a
  rubble stone inside an occlusion band renders at full brightness. Fixing it means
  splitting the ground pass so callers can interleave, which is a worse trade than the
  artifact.
- **`MODERN_DECORATION` replays its tile every frame.** It is in `DECORATION_TYPES` but
  not `CACHEABLE_OVERLAY_TYPES`, so its ground now costs five passes per frame instead
  of one `drawImage`. Pre-existing, and no level places one — but it is a live trap for
  whoever does.
- **`overlayCache` has no eviction.** It is bounded, not a leak — content-addressed by
  material frame, mask frame, quadrant and tile size — and measured at **3636 entries,
  ~3.6 MB** after baking the whole 280-tile overworld with the two materials in play
  today. The bound with all seven materials is ~99k quarter-surfaces, so Phase 3 should
  cap it; there is a checklist item for that.
- **Scatter marks are anchored to the tile edge, not to the contour.** On a straight
  boundary the two are within a pixel or two and 5.7% of blade pixels land on the softer
  side; around an isolated tile of the harder material the contour retreats inside it and
  some blades sit on open ground. The dual grid shrank this from the half-tile error it
  was, and anchoring to the contour would mean sampling the mask per mark.

---

## Phase 3 — Compaction & street plan ☐

- [ ] Wall ring (~55 × 40 inside) with south / west / east gates
- [ ] King's Road (4 wide, south gate → Market Street)
- [ ] Market Street (4 wide, west gate ↔ east gate)
- [ ] Upper Lane, Cross Lane, Low Street (3 wide)
- [ ] West Lane, East Lane (3 wide)
- [ ] Alleys (2 wide): west dead-end at Blackwood Lodge, club service alley, murder alley
- [ ] Market Plaza (flagstone) + civic terrace at the tower foot
- [ ] **Tower moved to the town's north edge** — verify nothing sits under the spire
- [ ] All 16 buildings re-anchored per plan §4; verify zero overlaps
- [ ] Cap or evict `overlayCache` in `groundTiles.ts` before placing the other five
      materials — it is content-addressed and never evicted, which is 3.6 MB with two
      materials and roughly 97 MB of pixel data at full spread
- [ ] Re-tune `market/vendorDefs.ts` stall offsets
- [ ] Re-tune `TownPropSystem` board / bench / fortune-teller offsets
- [ ] Re-tune `TOWN_SAFE_RADIUS_TILES` (55 → ~40) and verify circus + ruins buffers
- [ ] Move `TownPlan.approachRoadStopOffset` down to `Math.floor(mainRoadWidth / 2)` — the
      kerb row — so the circus approach roads actually reach the crossroads instead of
      stopping a tile short of them. The value must stay an integer: it is a loop bound, and
      `mainRoadWidth / 2` is 2.5, which passes `TileGrid.inBounds` and then throws. Leave
      `frontageTurnThreshold` alone; it is a separate quantity (found in Phase 1, see notes).
- [ ] `startTile`, `townSquareCentre`, `fountainCentre`, `mainTowerAnchor`,
      `doomsdayEscapeTile` all re-derived from the plan
- [ ] Grep every building name; confirm no quest hard-codes a position
- [ ] typecheck / lint / format clean

**Notes:**

---

## Phase 4 — Plots & frontage ☐

- [ ] Door aprons (1–2 rows, wider than the doorway)
- [ ] Contact shadows under every building's base row
- [ ] Party lines for neighbours ≤1 tile apart
- [ ] Fenced yards for gaps ≥3 tiles (`YARD_GRAVEL` + props)
- [ ] Back gardens in block interiors, reached from alleys
- [ ] Street kerbs / gutter lips along every street edge
- [ ] Ground scatter suppressed across whole plots, not just sprite footprints
- [ ] typecheck / lint / format clean

**Notes:**

---

## Phase 5 — Props & signage ☐

**Tier 1 — sells "town" immediately**

- [ ] Hanging shop signs on brackets over all 15 named doors
- [ ] Fences and gates (picket / post-and-rail / wattle)
- [ ] Lampposts and hanging lanterns (Market Street + Low Quarter), lit
- [ ] Street kerbs (if not already landed in Phase 4)

**Tier 2 — clutter and life**

- [ ] Handcarts, wagons, leaning wagon wheels
- [ ] Crate / barrel stacks, sacks, hay bales
- [ ] Laundry lines across alleys
- [ ] Planters, window boxes, herb beds, vegetable rows
- [ ] Water trough, hitching post, chicken coop
- [ ] Smithy yard: anvil, coal pile, quench barrel, tool rack
- [ ] Garden wells / pumps

**Tier 3 — wayfinding**

- [ ] Signposts at gates and junctions with district names
- [ ] Gate arches
- [ ] Banners / bunting on the civic terrace and Market Street

**Notes:**

---

## Phase 6 — Life & navigation ☐

- [ ] `TownLifeSystem`: `PLAZA_RADIUS_TILES` 20 → ~11, `DISTRICT_RADIUS_TILES` 48 → ~26
- [ ] Wander targets biased to street tiles (no more drifting across gardens)
- [ ] Activity anchors: well-drawer, smith, hawker, fountain kids, club bouncer
- [ ] Ambient audio radii re-tuned in `DungeonScene.buildTownAmbientEmitters`
- [ ] District labels on the minimap (`MiniMapSystem`)
- [ ] typecheck / lint / format clean

**Notes:**

---

## Phase 7 — Polish & validation ☐

**Acceptance criteria (from plan §9)**

- [ ] South gate frames the tower, Market Street and the plaza in one view
- [ ] No two buildings separated by bare grass
- [ ] No visible tile grid on large ground areas at 1× zoom
- [ ] Every named building identifiable without walking to its door
- [ ] Plaza → any door in under 12 seconds at `PLAYER_SPEED`
- [ ] Before/after screenshots captured

**Regression sweep**

- [ ] All 16 buildings enterable, correct interiors
- [ ] Circus questline (all stages via `?level=level3&quest=…`)
- [ ] Murder mystery incl. GumGum's body in the club alley
- [ ] Cult hideout (Blackwood Lodge)
- [ ] Desperado Club: casino, VIP lounge, achievements
- [ ] Market stalls + shop + mercenary guild
- [ ] Doomsday finale: soul crystal, Quill confrontation, escape stairwell
- [ ] Safe zone: no hostile spawns or aggro inside the walls
- [ ] Ruins band + circus still correctly placed and populated
- [ ] Overworld frame time within noise of baseline
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run format` clean

**Notes:**

---

## Open questions

- [ ] Should Miller's Farm sit **inside** the SE wall (compact, per plan §4) or
      **outside** the south gate with real crop fields (better story beat, +8 tiles of
      bounding box)? Decide before Phase 3.
- [ ] Is the 19 × 13 plaza too large once compacted? Reassess after Phase 3 with the
      stalls, fountain, board and crowd in place; shrinking it is cheap.
- [ ] Do the town walls need real art (§7), or can they be procedural like the ruined
      wall tiles? Decide after Phase 3's first screenshot.
- [ ] Switch the **dungeon** over to `ground_dungeon.png`? The seven dungeon materials
      are generated, audited and reviewable at `?tiles`, but nothing draws them: Phase 2
      wired the overworld only, and `dungeon_tileset.png` (same ChatGPT provenance, never
      audited for wrap error) still renders every dungeon floor. The renderer is material-
      agnostic, so this is now a small job — but it is a different floor and a different
      workstream, so it stays out of the town redesign unless Ryan says otherwise.
- [ ] Night lighting: the Low Quarter lanterns imply a day/night tint. In scope, or a
      separate workstream?

## Decision log

| Date       | Decision                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-25 | ~~Keep the existing overworld tileset; fix usage before new art~~ | **REVERSED same day** — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-25 | **Replace the ground tileset; generate it with a script**         | Ryan: the sheet is ChatGPT-generated and was never built for tiling; the only tiles that work are ones he hand-repaired. Verified: only r0c0–c2 and r3c0–c2 are free of a baked-in dark frame (all other tiles score −10 to −60 border-vs-interior); rows 4–10 are unusable including col 0; and even the repaired tiles don't wrap (6–11 vs 0–3 for a seamless tile). Streets wrap vertically (0.2) but not horizontally (~10), which is exactly why you get squares without rotation and crosses with it. A torus-sampled generator PoC produced grass with **no visible seam** across a 6 × 6 shuffled patch. |
| 2026-07-25 | World-space ground noise promoted from polish to required         | The PoC's dirt showed faint per-tile tonal blocking even with perfect edges — per-tile seamlessness doesn't solve large-scale repetition, so the world-space layer must ship with the tileset.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-25 | Move the tower to the town's north edge                           | Its 22-tile spire overhang sterilises a 6 × 22 corridor wherever it stands; at the edge it hides nothing and becomes a skyline landmark.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-25 | Ground rendering (Phase 2) ships before compaction (Phase 3)      | Highest visual payoff, zero layout risk, and it de-risks the "do we need new art?" decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-25 | Refactor into `src/map/town/` before changing the layout          | `generateOverworld` is one 709-line function; adding a street plan in place would be unmaintainable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-25 | Generate **multi-tile patches**, not single tiles                 | Wrapping at one tile caps every feature below tile size — that is what produced a hard joint every 16 screen pixels and a dizzying brick grid. Patches decouple pattern period from tile size.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-25 | Geometry from a shared `structure` seed, detail per variant       | Torus wrapping makes a patch seamless against _itself_, not against a differently-seeded sibling; shuffled variants of paved materials misaligned their stonework and read as a grid.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-25 | Ship corner masks as one sheet, composite at load                 | Baking transitions per material pair needs a row per pair _per patch phase_, and fixes at build time which pairs may blend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-07-25 | Always ship a calm jointless material per floor                   | Every material in the first dungeon draft had hard joints, so nothing could hold a stretch of floor. `dungeon_plain` is the default; jointed variants are accents.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-25 | Verify Phase 1 with a seeded hash, not by eye                     | "Zero visual change" is untestable by screenshot when the map's wilderness is random. Seeding `Math.random` and hashing the whole grid turns the claim into a check that either passes or fails.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-07-25 | `?townmap` derives footprints from the grid, not `OverworldData`  | A dev-only field on the data contract would need re-deriving every time the layout changes; reading sprite anchors back off the grid survives the refactor untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-25 | `groundMaterials.ts` deferred from Phase 1 to Phase 2             | It maps a `GroundMaterial` to a sheet row and frame — a renderer concern with nothing to hold until the enum exists. Creating it empty in Phase 1 would have been a stub, not a module.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-25 | One warp seed for all 16 corner masks                             | Neighbouring tiles across a boundary usually hold different corner combinations, so a per-combination seed tears the shared edge by the full alpha range (measured 1.000 → 0.094).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-25 | Ground tone is black-at-varying-alpha, not a `multiply` grey      | Identical arithmetic, but `multiply` leaves the compositor's fast path and cost more than the other four ground passes put together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-25 | `DIRT_PATCH` renders as `lane`, not as the `dirt` material        | It is a decoration drawn over a road. As its own material the surrounding lane wins all four corners and the mask erases it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-25 | Dropped `overworld_tileset` from the manifest                     | Nothing draws it once the four call sites move to the generated sheet, and it was a 1 MB image loaded at every startup. The PNG stays on disk — the generated palettes were sampled from it.                                                                                                                                                                                                                                                                                                                                                                                                                     |
