# Town Redesign — Progress Tracker

Working tracker for [town-redesign.md](town-redesign.md). Update the status column as
work lands; add dated notes under each phase. Keep the metrics table current — it is
the fastest way to tell whether the redesign is actually working.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⊘ dropped (say why)

**Overall status:** ◐ In progress — Phases 0–4 done; Phase 5's tiers 1 and 2 and Phase 6
landed 2026-07-26 and are through their first review round. The town now draws from the
generated tileset with blended material boundaries, world-space tone and ambient
occlusion; it is a walled market village laid out street-first; and it is furnished —
fifteen hanging shop signs, lit lamps down the main streets and both alleys, carts,
crates, troughs and yard gear, washing across the alleys, and someone standing at every
well, forge and club door. Remaining: Phase 5 tier 3 (wayfinding), and Phase 7.

---

## Live metrics

Re-measure after each phase (Phase 0 gives you the tooling to do it in one command).

| Metric                              | Baseline      | Target      | Current                                             |
| ----------------------------------- | ------------- | ----------- | --------------------------------------------------- |
| Town bounding box (tiles)           | 74 × 73       | 55 × 40     | **55 × 41**                                         |
| Town area (tiles)                   | 5402          | 2200        | **2255**                                            |
| Built density                       | 16.5%         | 40.5%       | **33.9%** — see the Phase 3 accounting note         |
| Farthest building door from plaza   | 42.6          | ⊘ retired   | **33.4** — target was geometrically unreachable; see Phase 3 |
| Ground materials used in town       | 2             | 7           | **6** (the ceiling — see Phase 3)                   |
| Ground materials available          | 2 usable      | 14          | **14**                                              |
| Worst joint-to-interior ratio       | never wrapped | ≤1.15       | **1.11**                                            |
| Tiles before a visible repeat       | 1             | 4+          | **4–7 (patch); variant choice has no period to 96** |
| Distinct outdoor prop types         | 3             | 15+         | **30** — 5 tile props, the 4 it already had, 15 clutter pieces, sign, lamp, laundry line, signpost, gateway, bunting (the sign carries 15 devices) |
| Town safe radius (tiles)            | 55            | ~40         | **40**                                              |
| Overworld frame time                | unchanged     | no regress. | **8.3ms mean / 9.8ms max in the plaza**             |
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

## Phase 3 — Compaction & street plan ◐

- [x] Wall ring (55 × 43 inside) with south / west / east gates
- [x] King's Road (4 wide, south gate → Market Street)
- [x] Market Street (4 wide, west gate ↔ east gate)
- [x] Upper Lane, Cross Lane, Low Street (3 wide)
- [x] West Lane, East Lane (3 wide)
- [x] Alleys (2 wide): west dead-end at Blackwood Lodge, club service alley, murder alley
- [x] Market Plaza (17 × 16 flagstone) + civic terrace from the tower foot into the plaza
- [x] **Tower moved into the north wall** — its two blocking rows are the wall row and the
      row below it, and the other 21 rows of spire overhang the fields outside the town
- [x] All 16 buildings re-anchored; zero overlaps, asserted at generation time
- [x] Cap or evict `overlayCache` in `groundTiles.ts` — now a `SurfaceCache` (LRU, 12k
      masked quarters / 4k stencils) shared by both surface caches
- [x] Re-tune `market/vendorDefs.ts` stall offsets (±8 → −7 and +6, symmetric on the 17-wide plaza)
- [x] Re-tune `TownPropSystem` board / bench / fortune-teller offsets
- [x] Re-tune `TOWN_SAFE_RADIUS_TILES` (55 → 40) and verify circus + ruins buffers
- [x] ~~Move `TownPlan.approachRoadStopOffset` down to `Math.floor(mainRoadWidth / 2)`~~ —
      **superseded, and the prescription would still have been wrong.** See the note below.
- [x] `startTile`, `townSquareCentre`, `fountainCentre`, `doomsdayEscapeTile` all re-derived
      from the plan; `mainTowerAnchor` was already
- [x] Grep every building name; confirm no quest hard-codes a position — two did, both fixed
- [x] typecheck / lint / format clean
- [x] Independent review round 1
- [x] Independent review round 2
- [x] Independent review round 3
- [x] Independent review round 4
- [x] Independent review round 5
- [x] Independent review round 6 — **no high-severity findings**
- [x] Independent review round 3
- [x] Independent review round 4
- [x] Independent review round 5
- [x] Independent review round 6 — **no code defects found**

**Notes:**

2026-07-25 — the town is now a walled market village. `?townmap` is the fastest way to see
it; the numbers below come from a headless `generateOverworld(280)`.

**The layout, north to south.** Interior 55 × 43 inside a wall ring at ±28 / −19 / +25 from
the plaza centre. Bands, each bounded below by the street its buildings' doors open onto:
Garrison Row (−18…−12), Upper Lane (−11…−9), Plaza Ring (−8…−2), Cross Lane (−1…+1), Market
Row (+2…+7), Market Street (+8…+11), Low Quarter (+12…+21), Low Street (+22…+24). East and
west of the 17-wide plaza each band is cut as an 8-tile plot, a 3-tile lane, and another
8-tile plot, which is exactly what the widest sprites need.

**The per-building road stub is gone, not re-tuned.** Every building is bottom-aligned to its
band, so the row below its door _is_ the band's street — there is nothing to connect. The old
`connectDoorToStreet`, its `DOOR_STREET_MAX_WIDTH` clamp and its frontage-turn branch were
all consequences of buildings being dropped on a lawn. What replaced it is `paintDoorApron`,
which paves the doorway across its full width: the sprite leaves a four-tile gap in The Horned
Flagon's facade and a three-tile gap in the General Store's, and the old code paved only the
centre tile of each, so two of the town's doors were a single flagstone in a lawn.

**The plan states plots, not anchors.** `PlannedBuilding` carries a west column and a front
row; `placeSpriteBuilding` derives the anchor by aligning the manifest footprint to them. The
plan therefore never restates a sprite's size, and re-scaling a building keeps its frontage on
the street and grows it northward into its own plot. `assertTownPlotsDoNotOverlap` fails
generation if two plots collide or one leaves the wall — overlapping art is invisible in a
screenshot (the later sprite just draws over the earlier one) and what you notice weeks later
is a door opening into a wall.

**Bypass routing no longer runs over the town.** It fires on a structure with paving on both
its north and south sides, which under a street plan is _every_ town building by design — it
would have detoured around all fifteen, paving a column through the gardens and lanes the plan
just laid out. It still runs over the circus, whose tents are scattered at generation time and
whose approach road is painted afterwards, so a tent there genuinely can sever the road.

**The Phase 3 prescription this tracker carried for four review rounds is now moot, and it
was still wrong.** The mechanism it wanted to adjust — `approachRoadStopOffset` — does not
exist any more: the circus routes to the nearest **gate exit**, a tile the gate's own highway
paves, so the joint cannot miss. But the prescription also assumed the fix was a smaller
target on the same crossroads, and the crossroads is gone. Worth recording as one more
instance of the lesson at the end of Phase 1: a prescription is a claim about code that does
not exist yet.

**Two quest anchors were genuinely broken by the move, and were caught by testing tiles rather
than by reading.** `MurderMysteryQuestSystem`'s `ALLEY_DOOR_OFFSET` put GumGum's body four
tiles west of The Sunken Stump Pub's door — and the pub now stands _against_ the west wall, so
that resolved outside the town, to be nudged somewhere arbitrary by the 6-tile walkable
search. It is anchored to the Desperado Club's murder alley now, which is where §4 and the
Phase 7 checklist both say it belongs. `TownPropSystem`'s notice board sat due south of centre
on the rationale that "the tower fills the north" — which stopped being true the moment the
tower moved, and due south is now the arrival sightline from the south gate; it is in the
plaza's north-west quadrant. The benches no longer carry a copy of the fountain's plan offsets
at all: they derive from `gameMap.fountainCentre`.

**Verified as tiles, not reasoned about.** Every system anchor that was a hard-coded offset
was checked against the generated grid: notice board, fortune teller, both benches, all four
stall tiles and their vendor row, GumGum's hook and body, the roost clue, the cat's spawn, the
Doomsday escape tile, and the well the murder quest picks (the south-west one, 6.40 tiles from
centre against the north-east one's 7.07 — no tie to break). All 16 doors are reachable from
the plaza centre over paved tiles by flood fill, the circus with them, and every door's
`doorTile + (0, +1)` — the tile `DungeonScene` returns you to on leaving a building — is
street.

**Where the metrics landed, including where they did not.**

| Metric                   | Target  | Actual  | Note                                                                                                                   |
| ------------------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bounding box             | 55 × 40 | 55 × 41 | The 15 sprite buildings are exactly 55 × 40; the extra row is the tower's base course, which stands _on_ the wall line |
| Area                     | 2200    | 2255    |                                                                                                                        |
| Built density            | 40.5%   | 33.9%   | **See below — this is an accounting difference, not a layout shortfall**                                               |
| Farthest door            | ~28     | 33.4    | **Not reachable in a 55 × 40 town — see below**                                                                        |
| Ground materials in town | 7       | 6       | Six is the ceiling: the metric samples inside the walls, and `grass` exists only outside them by design                |

The **density** gap is entirely how the tower is counted, and the arithmetic is worth stating
carefully because it is easy to quote a number no code would print. The 15 sprite buildings
occupy 752 tiles either way. The plan's target of 890 built tiles counted the tower's whole
6 × 23 art (752 + 138 = 890), which was right when the tower stood in the middle of town and is
not now that 21 of those rows hang over the fields north of the wall. `townMetrics` counts its
6 × 2 base instead: **764 tiles in a 55 × 41 box = 33.9%**. Counting the spire is not an alternative
reading that yields 40.5%: it moves the numerator _and_ the denominator, because the bounding box
grows to 55 × 61 = 3355 — so it reads **26.5%**. The 40.5% figure is 890 / 2200, the plan's own
_target_ area, which no measurement of this layout produces. The honest summary is that the same
fifteen buildings are packed as tightly as the plan intended and the tower's overhang is not
ground; there is no accounting under which this town prints 40.5%.
`BuildingPlot` now carries both rects (`rect` = occupied ground, `artRect` = the sprite), and
`?townmap` outlines the overhang faintly so the spire is still visible in the plan view.

The **farthest door** target of ~28 was arithmetically impossible and should be retired. The
corner of a 55 × 40 rectangle is 34 tiles from its centre, so _any_ building on a corner plot
is a long way out. The bands are not symmetric about the plaza either — the interior runs 18
rows north of it against 24 south — so it is the two _south_ corners that are far: measured, the
corner-plot doors are Cartwright's Workshop 25.9, Blackwood Lodge 26.8, Miller's Farm 31.1 and
The Sunken Stump Pub 33.4. §4's own reference layout puts the pub's door at about 30.
33.4 is the pub in the south-west corner, down from 42.6. The walk-time criterion this note
originally leaned on has since been dropped from §9 — Ryan does not care about it — so the
farthest-door number stands on its own: a corner plot is far from the centre because that is
what a corner is, and there is no target left for it to miss.

**The Blackwood Lodge alley is a real dead end.** Doors face south, always, so a building can
only front whatever lies south of its band — which means an alley frontage has to be made by
turning _that_ row into an alley, not by setting the building back. The Upper Lane therefore
starts at x = −16; west of the West Lane its place is taken by a two-row alley that runs to
the west wall and stops, and the Lodge's door is the last thing on it.

**Frame time, standing in the plaza.** 180 consecutive `requestAnimationFrame` deltas with
the full crowd, both stalls, the fountain and four buildings on screen: mean **8.33 ms**,
median 8.30, p95 9.40, **max 9.80** — no frame over 10 ms, so nothing in the five new
materials or the wall costs anything per frame, which is the point of baking them into the
chunk cache. Measured in-page rather than under node-canvas; the chunks in view were already
baked, so this is steady-state cost, not first-sight cost. Cold-bake cost still wants
measuring while panning into new chunks (Phase 7).

**Review round 1 (independent), fixes applied:**

- **A road was paved straight through the middle of the town, and the circus was left with
  none.** There is no north gate, so a circus north of the walls routes to a _side_ gate,
  whose exit sits beside Market Street — 9 rows below the centre line, well inside the town's
  north-south extent. `connectSiteToNearestGate` turned along the circus's own column first,
  which paved 3 tiles of packed earth from the circus down through the Civic Terrace, the
  plaza and Market Street's cobble; `TOWN_WALL` being solid then cut the run at the wall, so
  the circus finished with no road connection at all. Measured over 300 seeds: **10% of maps
  had the slash, 13% had the circus disconnected, and every one of them had the circus to the
  north.** The fix runs along the gate's outward axis _first_, so the corner lands on the
  gate's standoff line one tile outside the wall and the perpendicular segment travels along
  that line, outside the town by construction. Re-measured over **400 seeds: zero track tiles
  added inside the wall, zero disconnected circuses**, quadrants uniform (N 107 / S 100 /
  E 99 / W 94), so the northern cases that used to break are well represented.
- **This is the third time a wilderness pass has damaged the town's paving**, counting the two
  `approachRoadStopOffset` rounds, so it now has a standing check rather than another comment:
  `assertNoTracksInsideTown` counts packed-earth tiles inside the wall before the wilderness
  passes and after, and warns if the number moved. (Round 2 replaced it with the broader
  `assertTownInteriorIsIntact`; the name survives here only as the record of what round 1 did.) It warns rather than throws because the
  circus's position is random. `connectSiteToNearestGate` also takes a keep-out rectangle, so
  a wrong route would leave a gap rather than a scar.
- `assertTownPlanIsSane` was added for a mistake made _while writing this phase_: every
  surface is `span(west, north, east, south)` over inclusive edges, which reads well and
  silently yields a degenerate rectangle if two edges are given the wrong way round. A
  zero-width surface paints nothing and shows whatever was underneath it — invisible
  afterwards. It also asserts every surface stays inside the wall, which is what makes "bare
  grass exists only outside the walls" a property of the plan.
- **The wall's parapet rule was wrong in two places.** `facesNorth = !isWall(tx, ty - 1)`
  reads plausibly and is not the same thing as "in an east-west run": the **south-west and
  south-east corner tiles** have the last tile of a vertical run directly above them, so they
  lost their battlement in the middle of an otherwise crenellated south face, and the tile
  **directly below each side gate** has the gate's cobble above it, so it grew a battlement
  mid-flank — the exact case the rule exists to prevent. It now tests for a wall to the east
  or west. Verified against the grid: **188 wall tiles, zero rule violations**, and both
  previously-wrong cases confirmed flipped.
- The east market stall was at `+7`, so its outer tile was the plaza's last column with the
  Cross Lane beyond it, while the comment claimed a tile of slab outside both stalls. `+6`
  makes the pair symmetric about the centre and the claim true.
- `PLAZA_RADIUS_TILES` was 11 with a comment saying 11 reaches the plaza's corners. They are
  at (±8, −8) and (±8, +7), i.e. `hypot(8, 8) = 11.31`, and `withinRadius` is a strict
  circular test — so all four corners of the crowd's own plaza fell outside it. Now 12.
- Two yards were **named for buildings they do not adjoin**: the gravel at columns 15..16
  flanks the Barracks, not Cartwright's Workshop across the East Lane, and the band at 20..27
  is three tiles and a lane away from The Rusty Anvil. Renamed to what they are, and the
  second carries a note that §3.3's smithy yard _cannot_ be satisfied in this band — the
  Anvil fills 9..16 and the lane separates it — so Phase 4/5 must either put the forge's props
  on its own Market Street frontage or re-cut the block, not drop an anvil in the wrong yard.
- Removed `PlannedBuilding.district` and the `TownDistrict` union. Their JSDoc claimed the
  minimap and a review tool read them; nothing did, and the minimap's district labels are a
  Phase 6 item — they come back with their consumer. `PlannedSurface.name` and
  `PlannedGate.name` stayed but now earn their keep: they are what `assertTownPlanIsSane`
  names, and their docs say they are labels rather than claiming render-path consumers.
- Four more claims corrected: the bounding box is **41** rows, not 40 (the tower's base course
  stands _on_ the wall line — the sprite buildings alone are exactly 55 × 40), and the three
  interior rows no building occupies are Low Street's, not "the wall verge and the Low Street";
  the farthest wall corner is 37.5 tiles out, not 38.3; "Garrison Row has no lane crossing it"
  is true of the West Lane only, since the East Lane runs the town's full height; and two
  separate doc blocks said "the town's five street materials" over sets holding four and three
  of them, one of them contradicting itself two lines later.
- `?townmap` drew the wall in a tan within 20 levels of the lanes, in the one view whose job
  is to make the layout legible. It is dark stone there now, unrelated to the in-game colour.
- Also: an orphaned JSDoc block in `tileTypes.ts` documented nothing (same defect class Phase 2
  round 4 recorded); the bare `1`s and `2`s in `drawTownWallTile` are named constants; and
  `STREET_TILE_TYPES` no longer sits between two import blocks.

**Review round 2 (independent), fixes applied.** Round 1's fixes were re-tested and none
regressed: 20,000 synthetic circus positions on the 70–90 ring touch the town interior **0**
times under the new route order against **11.7%** under the old one, which substantiates the
~10% figure recorded above from a different measurement; 188 wall tiles, 110 parapet / 78 flank,
**0** disagreements with the geometric rule; both stalls and both vendor rows on flagstone and
symmetric; all four plaza corners inside the 12-tile radius; no orphaned consumer of the removed
`district` field. Three genuine defects remained:

- **Weeds scattered onto the verge rendered as field grass.** `GRASSY_WEED` reports `grass` as
  the material beneath its tufts — correctly, since that is what it is scattered on outdoors —
  so on a verge it drew the wrong sheet row, and being the _softest_ material in the blend order
  it also became an island the surrounding verge bled into through the corner masks, eroding the
  tuft the tile exists to show. About **4 tiles per generation** inside the walls, and it
  falsified the redesign's third principle in the only place that counts, which is what is
  drawn. The scatter is gone: the verge material already depicts grass invaded by stone and
  weeds, so nothing is lost, and planting inside the walls is Phase 4/5's job with a decoration
  of its own that maps to `verge`.
- **`assertTownPlanIsSane`'s doc claimed a guarantee it does not give.** It checks that no
  surface _escapes_ the interior, and the note said that was what made "everything inside the
  walls is a made surface" a property of the plan. Containment is not coverage: delete the plan's
  one `town interior` entry and the check still passes while the whole interior reverts to the
  grid's bare grass. That property is now actually held, by `assertTownInteriorIsIntact` over the
  finished grid — every interior tile must be one of the town's six surfaces, a worn patch, or
  something standing on them, so field grass, `GRASSY_WEED`, `TREE`, `RUBBLE` and `RUINED_WALL`
  are all faults. It subsumes the round-1 track tripwire and runs _after_ the scatter pass,
  because the scatter pass is itself something that put the wrong material inside the walls.
  **The tripwire was tested by re-introducing the verge scatter**: it reported "6 tiles inside
  the town wall are not a town surface — first type 22", and is silent once reverted. A standing
  check nobody has seen fire is not a check.
- **The plaza's two south-corner torches drew cobble ground.** `inferFloorType` scans cardinals
  south first, and the slab's last row has Market Street below it, so a prop on the corner took
  the street's material into the middle of the flagstone and dragged its neighbours' blend with
  it. Moved one row in. All 14 town props were then checked individually; the other 12 infer
  their own material correctly.

Round 2's nits were taken too, since this file's whole purpose is to not accumulate plausible
falsehoods: the tower's base is a 6 × 2 _rectangle_ of which the manifest blocks 8 tiles, not
"stands on 12"; `DIRT_PATCH` is scattered on the track and never on a lane, so the comment's
example was of a case that does not occur; the frontage radius does _not_ separate every pair of
doors — Blackwood Lodge's and Shepherd's Cabin's bubbles overlap on two tiles of lane, which is
now stated rather than implied away; "every offset in §6 re-tuned" overstated it, since the
fountain radius, forest distance and ruins bands were already right at the new scale; the
"890 / 40.5%" figure is the plan's target area, not this layout's, and no code would print it;
and `?townmap` now compares the whole rect rather than just its size when deciding whether a
sprite has overhang. `assertTownPlanIsSane` also checks that a gate opens _through_ the ring and
that its apron lies _outside_ it, and the Doomsday escape guard now sees props and the tower
anchor rather than only solid tile types.

**Review round 3 (independent), fixes applied.** Round 2's other fixes all re-verified — the
verge weed count is 0, `TOWN_INTERIOR_TILE_TYPES` is complete against a full interior census
(`VERGE_GRASS` 980, `LANE_STREET` 554, `PLAZA_STONE` 372, `COBBLE_STREET` 272, `YARD_GRAVEL` 92,
road 52, `SPRITE_BUILDING` 15, `TORCH` 12, `FOUNTAIN` 9, `DIRT_PATCH` 4, `WELL` 2, `MAIN_TOWER`
1, nothing else) with 0 false positives over 400 seeds, and both new gate checks throw when
fault-injected. Four things were still wrong, and the first was introduced by round 2:

- **Round 2's widened Doomsday escape guard could not fire.** It tests the tile against `TORCH`,
  `WELL` and `FOUNTAIN` — and `paintTownProps`, the only pass that writes any of them inside the
  town, ran _after_ it. All three branches were dead code, and round 2's note here claimed the
  guard "now sees props". Proved by moving a well onto the escape tile: generation **succeeded**
  with the finale's stairwell on a non-walkable well. The guard is now a named function running
  after the prop pass, and the same injection makes it throw `Doomsday escape tile at 139,127 is
blocked (tile type 21)`. Two rounds running, a check was added and not watched fire; that is
  now the standing habit for this phase — inject the fault, see the message, revert.
- **"40.5% counting the tower's spire" is arithmetic that no code produces**, and it was in the
  metrics table, in the plan doc, and contradicted by this file's own detailed note 900 lines
  down. Counting the spire moves the _denominator_ too: the bounding box grows to 55 × 61 = 3355,
  so it reads **26.5%**. 40.5% is 890 / 2200 — the plan's target area. Corrected everywhere.
- **"~8 s of headroom" on the 12-second walk criterion was the travel time misread as the
  margin.** Measured by shortest path over the real blocking set: worst door **8.31 s**
  eight-directionally, **10.45 s** four-directionally, so the headroom is **1.6–3.7 s**. The
  criterion passes; the margin is thin enough that Phase 4's plots should not lengthen a route.
- **The frontage-overlap claim round 2 added was false in both its material and its
  consequence.** It said Blackwood Lodge's and Shepherd's Cabin's bubbles share two tiles of
  lane. The two tiles are `VERGE_GRASS` under the buildings' own facade rows and are **not
  walkable**, so `gatherFrontageTiles` discards them: measured across all 16 pairwise
  combinations, **no pair of doors in the town shares a single frontage tile.** The comment now
  says that.

Round 3's nits were taken as well. `structures` and `circusStructures` had become the same array
written twice, with a comment claiming the town pushed into one of them when it pushed into
neither — one array now, named for what it holds. `TownPlan` exports its `interior` rect instead
of four separate hand-derived `wall.x + 1` / `wall.w - 2` pairs. `assertTownPlotsDoNotOverlap`
takes named plots and now includes the tower's base, which is what its doc always claimed; the
gate apron is checked against the _wall_ rather than the interior, since an apron is painted
after the stone and one overlapping the ring would punch a gravel hole in it; the track warning
is phrased as a change rather than an addition, because its baseline predates the prop pass;
`DISTRICT_RADIUS_TILES` went 34 → 36, since 34 left 0.58 tiles before `districtDoors` would
silently drop the farthest building out of the town's life; and `TownLifeSystem` stopped
recomputing the town centre as `gridSize / 2` — it reads `townSquareCentre` now, and holds it as
a point rather than as one number that quietly assumed the centre sits on the map's diagonal.
(This note originally called that the "third and last" such site. Round 4 found four more; see
its note below.)

**Review round 4 (independent), fixes applied.** Round 3's other fixes verified: the escape
guard fires on every branch, the collapsed structure list is behaviourally identical (over
200,000 synthetic circus placements the closest any tent comes to any town building is **17 tiles
on its nearer axis**, against a `TENT_CLEARANCE` of 1, so the town could never have been seen by
that test — an earlier draft of this line said 14, which is the gap to the _wall rectangle_
rather than to a building, and the wall was never in that list), the
`interior` field has exactly four consumers and all agree, and both gate injections throw. Two
real defects, one of them introduced by round 3, plus a false alarm worth recording.

- **Round 3's own fix silently disabled the containment check for all sixteen plots.** Admitting
  the tower's base — which legitimately stands _on_ the wall line — was written as "inside the
  interior **or** inside the wall ring". The interior is the ring inset by one, so it _implies_
  the ring: the disjunction reduced to the loose test, and a sprite building whose art landed on
  the stone passed. One tile from mattering — `village_house_2` growing a single row would put
  Blackwood Lodge's back wall on the wall line. Each plot now carries the rectangle it must fit
  inside, and only the tower is given the ring. Verified by injection: pushing a plot onto the
  wall now throws `Town plot 'Blackwood Lodge' at 112,123 7x6 does not stand on the town's
interior` (round 5 reworded that message), where before it generated cleanly with 8 non-wall
  tiles on the west wall line.
- **A comment named a standing check that does not exist.** `paintStreets.ts` still pointed at
  `assertNoTracksInsideTown`, which round 2 replaced with `assertTownInteriorIsIntact` — the
  documented defect class of this project, in a comment about a check.
- **"`TownLifeSystem` was the third and last place recomputing the town centre as
  `gridSize / 2`" was false.** Four more sites. Two are on the overworld and are now fixed:
  `GameMap.isInTownSafeZone`, which decides where hostiles spawn and where they deaggro, and
  `MurderMysteryQuestSystem.findWellTile`, which decides which of the two wells hosts a clue. The
  other two — `CultHideoutSystem` and `QuillConfrontationSystem` — run on _interior_ floor maps
  that have no `townSquareCentre`, so `gridSize / 2` is the right centre there and they are left
  alone.

**One finding was a false positive, and checking it was worth the five minutes.** Round 4
reported that Phase 3's fountain had landed on the Miss Quill encounter's spawn anchors, with a
measurement showing `REMEX 144 143 FOUNTAIN walkable false`. Those offsets are relative to the
**tower's interior floor map**, not the overworld: `BuildingInteriorScene` passes `floorMap` into
`QuillConfrontationSystem`, and the interior is 20 × 16 with its own centre at 10,8. Generated
it and checked all four anchors — every one is walkable carpet, and there is **not one FOUNTAIN
tile anywhere in that map**. An agent's measurement can be real, reproducible and still against
the wrong object.

Round 4's nits taken: the escape guard now also rejects the tower's own base rectangle (only its
anchor carries the `MAIN_TOWER` type, so a tile one column over reads as flagstone while being
blocked); the cache bound is the computed 176 × 144 × 4 = 101,376 rather than "near
99,000"; the two counts of the paved-surface set inside `tileGrid.ts` now agree; and
the Lodge's door is the _only building_ on its alley rather than "the last thing on it" — the
alley runs three tiles further west to the wall.

**Review round 5 (independent), fixes applied.** Round 4's three fixes all verified under
injection, including that the tower's base is now compared against sprite plots (moving the tower
12 columns east throws `Town plots 'Town Center Tower' and 'The Barracks' overlap at 147,123`),
that the `underTower` branch is not dead code, and that every consumer of `isInTownSafeZone`
passes world pixels so the centre change is behaviour-neutral. One code defect and four false
statements:

- **The tower's containment bound was vacuous — the same defect as round 3's, scoped smaller.**
  `'wall ring'` was implemented as "inside `plan.wall`", and `plan.wall` is the wall's whole
  _bounding rectangle_, which contains the interior. So the one plot advertised as "the only plot
  allowed on the ring" was not constrained to the ring at all: with the tower's base moved 15
  rows into the middle of the town, containment passed and only the overlap half objected. A ring
  plot now has to be inside the wall rectangle **and** touch one of its four lines. Verified:
  moving the base two rows off the ring throws `Town plot 'Town Center Tower' at 137,123 6x2 does
not stand on the town's wall ring`. Twice now the bug has been a bound that reads tighter than
  it is, which is worth naming as a pattern rather than fixing a third time by luck.
- **`isInTownSafeZone`'s new comment claimed it decides where hostiles spawn.** It has exactly
  three consumers — the ruins ghoul's and the krasue's deaggro, and the overworld music's
  town/wilderness zone. Spawn _placement_ is `scatterRuinsSpawnPoints`, which filters against
  `plan.centre` at generation time and never calls it.
- **A fix this file claimed round 4 had made was never applied.** The note said "any corner
  plot's door is ≥ 30 tiles out" had been corrected to 28–34. The original text was still in both
  documents, and _both_ figures were wrong. The cause is a wrong premise rather than a wrong
  measurement: the "corner of a 55 × 40 box is 34 from its centre" argument assumes the plaza is
  the box's centre, and it is not — the interior runs 18 rows north of it against 24 south, so the
  north corners are much closer. Measured, the corner-plot doors are Cartwright's Workshop 25.9,
  Blackwood Lodge 26.8, Miller's Farm 31.1, The Sunken Stump Pub 33.4. Both documents now say
  that, and `townPlan`'s wall comment states the asymmetry so the next person does not re-derive
  the wrong premise.
- **"Minimum gap between any tent and any town plot is 14 tiles" was not reproducible**, and
  round 5 measured 17. Re-measured both ways: against the town's _buildings_ — which is what the
  tent-overlap list actually held — the closest approach over 200,000 placements is **17 tiles on
  the nearer axis**; the 14 was the gap to the **wall rectangle**, which was never in that list.
  The conclusion is unaffected (17 ≫ a clearance of 1) but the number was measuring a different
  object, which is the third time in this phase a real measurement has been taken against the
  wrong thing.
- **A sentence in `townPlan`'s wall comment contradicted itself.** It said buildings abut the
  wall's inner face "on both the north and the south" one clause after saying the three
  unoccupied interior rows are Low Street's. True on the north, false on the south.

Round 5's nits taken: "one pass over fifteen rectangles" is sixteen; "checking is a dozen
rectangles" is 17 surfaces plus each gate's opening and apron; and `PlannedGate.apron`'s doc now
says what the apron actually ends up as — flanks of gravel either side of the track, because
`paintGateHighways` paves through its middle afterwards.

**Review round 6 (independent) — the code came back clean.** Round 5's containment fix verified
under three injections; every number in round 5's note reproduced exactly (the corner-plot doors,
"18 rows north against 24 south", the 17-tile tent separation against buildings, the 17 surfaces,
the injection strings, and the apron's gravel fraction — deterministically 50% per apron, and
"roughly a third to a half" holds for 98.7% of the sampled ones). Also confirmed independently:
zero `assertTownInteriorIsIntact` warnings over 300 consecutive generations, and all five
plan-sanity guards firing under injection. What it did find:

- **A stray debug edit in the working tree that was not part of this phase.** `PostSignupScene`'s
  "Skip to Level 1" had been repointed at `level3` — a shortcut for looking at the town in-game,
  left behind by one of the review agents rather than by the phase. It would have shipped new
  players into the overworld. Reverted; the change set is 25 files again.
- **One of _my own_ round-5 verification claims did not reproduce.** The note said moving the
  tower 12 columns east throws an overlap against The Barracks. It generates cleanly: the tower's
  base is rows 121–122 and the Barracks is rows 123–128, so they cannot overlap at any `dx`. The
  only Garrison Row plot reaching row 122 is Cartwright's Workshop, so the real injection is
  `dx = 23` — which does throw, `Town plots 'Town Center Tower' and 'Cartwright's Workshop'
overlap at 160,122`. I had quoted the previous round's report instead of running it, which is
  the failure this tracker exists to stop; the claim is now the one I ran.
- Two contradictory counts in one JSDoc ("sixteen rectangles" and "fifteen rectangles" a few lines
  apart — it is sixteen), and round 4's quoted error string, which round 5's rewording had made
  stale.

Round 6's tightening nit was worth taking, because it is **the same defect a third time**:
`touchesWallRing` admitted a plot with one column on the _west_ wall and its base sitting in the
Cross Lane — verified, `dx −25 / dy 1` passed. Every comment and §3.2 mean the _north_ wall, so
that is now what the check says: a ring plot's own north edge must be on the wall's north line.
Re-verified over four injections — the real layout generates cleanly, and the Cross Lane
placement, the off-the-ring row and the overlap case all throw.

**One tooling gap closed.** `?tiles` previewed `grass↔lane`, `grass↔dirt`, `lane↔cobble` and
`dirt↔gravel` — none of which are the joints the new street plan actually draws most of. The
route now previews `verge↔lane` (every frontage and wall base), `verge↔plaza` (the ring around
the market square), `lane↔plaza` (every lane mouth) and `gravel↔lane` (every workyard edge), so
the acceptance route for ground work covers the ground the town is made of.

**Signed off deliberately, not overlooked.** §6 says "tower base must stay adjacent to the
plaza". Its base is now 10 rows from the plaza's north edge rather than on it. §3.2 and the
decision log both mandate the north-edge move, and what the invariant protects — the
magistrate's office and the tower stairs being reachable from the square — holds: the tower
door opens onto an unbroken flagstone terrace that runs into the plaza, and the walk is 10
tiles. Recorded here rather than left as a silent deviation.

**`groundTypeCount` can never read 7**, which the target row implies it should.
`measureTown` samples the building bounding box, which is inside the walls, and the street
plan puts a made surface on every tile in the ring — field grass exists only outside it, which
is design principle 3 rather than a gap. Six is the ceiling; the metric's label and JSDoc now
say so.

**Open questions closed.** Miller's Farm is inside the south-east wall (plan §4's compact
option) with its crop rows in front of it. The plaza came out 17 × 16 rather than 19 × 13 —
still worth reassessing once the stalls, board, fountain and crowd are in place, which is the
Phase 4/5 review, but it is 272 tiles against the old square's 484.

---

## Phase 4 — Plots & frontage ◐

- [x] Door aprons (2 rows, one tile wider than the doorway either side)
- [x] Contact shadows under every building's base row
- [x] Party lines for neighbours ≤1 tile apart — **as a standing check, not new art**;
      see the note below for why there is nothing to draw
- [x] Fenced yards (`YARD_GRAVEL` + fence); props are Phase 5
- [x] Back gardens in block interiors, reached from lanes and alleys
- [x] Street kerbs / gutter lips along every street edge
- [x] Ground scatter suppressed across whole plots, not just sprite footprints
- [x] typecheck / lint / format clean
- [x] Independent review round 1
- [x] Independent review round 2
- [x] Independent review round 3
- [x] Independent review round 4
- [x] Independent review round 5 — **no defect that changes a pixel or a tile**
- [x] Independent review round 6 — **confirmation pass, code clean**
- [x] Independent review round 7 — **ready**; three refinements to the new assertion
- [x] Independent review round 8 — **done**; two figures in the new docstring corrected
- [ ] Screenshot review in-game (the headless render harness stands in for it — see round 1)

**Notes:**

2026-07-26 — two new tile types, `FENCE` (62) and `GARDEN_PLANTING` (63), one new
plan concept (`PlannedYard`), one new painter (`src/map/town/paintYards.ts`), and two
new passes in the ground renderer.

**Measured first, designed second.** The Phase 4 checklist reads as seven independent
items; three of them turned out to have no site in this town and one had a site the
checklist did not mention. Dumping the interior as ASCII and listing every plot gap
took ten minutes and changed what got built:

- **No two buildings are 3+ tiles apart without a street between them.** Every gap in
  the same band is 0 (Blackwood Lodge ↔ Shepherd's Cabin), 3 (a lane), 5 (a lane plus a
  yard) or wider (the plaza). So "fenced yards for gaps ≥3 tiles" has **zero** sites as
  written. What the town does have is *block interiors* — 268 tiles of verge no building
  stands on — and that is what got fenced.
- **"Party lines for neighbours ≤1 tile apart" has one site and needs no art**: the two
  Garrison cottages abut at gap 0, and two facades meeting *is* the party line. What was
  worth adding is the rule the checklist implies but does not state — that nothing may
  land **between** the two cases. `assertNoUnusableSlivers` fails generation on a gap of
  exactly 2: too narrow to furnish, too wide to read as a shared wall, and on the map a
  dead-end corridor that looks exactly like the lane it is not. Every width comes from a
  sprite's manifest footprint, so this is a failure an *art* change causes without
  touching the plan — the kind that otherwise ships. Verified by injection rather than
  by reading: moving `INNER_WEST_PLOT` from −16 to −17 puts Herb & Remedy two tiles from
  the Temple and throws `Town plots 'Temple of the Sky' and 'Herb & Remedy' are 2 tiles
apart — too wide for a party line and too narrow for a yard`. The same injection at −18
  (gap 1) passes the sliver check, as it must, and is caught instead by
  `assertYardsStandOnTheirOwnSurface`, because it also drags Signet's Ink's plot into the
  West Lane: `Town yard 'Signet's back garden' is a garden but stands on tile type 59 at
122,153 — it needs 57`. Both checks were watched firing; neither was assumed to.

**The door apron is two rows now, and the second row is the visible one.** The doorway
row was already paved in Phase 3. Measurement showed the tiles flanking a doorway in
that row are all under the facade's own art, so widening sideways there is invisible by
construction — the apron reaches a tile either side anyway, so a re-cut facade that
widens its opening still lands on paving. The row that shows is the street below: it
lays `LANE_STREET` across the front of each door, which is setts in front of the mead
hall's four-tile opening where Market Street is cobble, and a stone doorstep in front of
Blackwood Lodge where its alley is packed earth. §3.4 asks for exactly that; a doorstep
is a different surface from the roadway or it is not a doorstep. `setPaved` rather than
`set`, because The Sunken Stump Pub's opening starts on the interior's westmost column
and its widened apron's edge lands on the town wall.

**Contact shadows needed the manifest, not the tile grid.** `GROUND_OCCLUDER_TYPES` is a
set of tile types, and **a town building is one anchor tile** — every other tile under a
facade keeps whatever surface the plan painted there. So all 15 sprite buildings and the
tower were invisible to the occlusion pass and the ground in front of a facade was shaded
by nothing at all, which is precisely the "stickers on a lawn" complaint of §1.4 that
Phase 2 thought it had answered. `occluderAt` now also consults a per-map index built
from `getBlockedTileOffsetsByKey` — the footprint **minus** the doorway, so a threshold
takes the north band from the facade above it rather than being treated as facade. 16
anchors, 735 tiles under art, and **369 interior ground tiles gain a contact shadow they
had none of**, with 0 door tiles wrongly inside the art set. The index is built once per
map and not revalidated; that assumption is stated in its doc, and it is the same one
`GameMap` makes for `extraBlockedTiles`.

**Kerbs are restricted to made street ↔ soft ground, which is narrower than it looks.**
The obvious rule — "kerb the harder side of any boundary" — would ring every door apron
in kerbstone (a lane patch inside a cobble street) and grow one around every gate apron
out in open country. `KERBED_MATERIALS` is lane/cobble/plaza and `KERB_SOFT_MATERIALS` is
grass/verge/dirt/gravel, so a street gets a lip where it meets ground and nowhere else.
The lip is drawn on the tile's own edge rather than on the fringe's wandering contour;
that is a few pixels off, in the direction the fringe already bleeds the harder material,
so the lip lands on paving. The scatter pass makes the same trade for the same reason,
and the kerb runs **before** the scatter so tufts spill over it rather than under it.

**Yards and gardens.** Five fenced enclosures and eight planted strips:

| Yard                      | Where                          | Reached from        |
| ------------------------- | ------------------------------ | ------------------- |
| Garrison Green            | −13…−7 × −17…−12 (7 × 6)       | Upper Lane, cart gate |
| Sunken Stump back garden  | −27…−20 × 13…16                | West Lane           |
| Signet's back garden      | −16…−4 × 13…21 (an L)          | West Lane, Low Street |
| Miller's kitchen garden   | 20…27 × 12…14                  | East Lane           |
| Market Row east workyard  | 20…27 × 2…7 (gravel)           | East Lane, cart gate |

The fence painter takes the building art rather than reading tile types alone, for the
same reason the occlusion pass does. Two tests decide each perimeter tile: *can it take a
post* (only the yard's own surface, which rules out the two side-gate torches and any
street a perimeter runs along), and *is this side worth fencing* (a side whose outward
neighbour is solid gets none, so nothing doubles the town wall or a neighbour's facade).
Corners take a post if **either** of their two sides is open, so an enclosure turning from
an open side into a walled one still closes. That is what lets Signet's garden and the
drying green beside it be stated as **one** L-shaped block with Signet's own facade
closing the middle, rather than as two plots fenced back to back along a line nobody can
walk.

`South Green crop rows` changed from `YARD_GRAVEL` to `VERGE_GRASS`. It is a kitchen
garden, and planting reports the material it is drawn *over* — on gravel the beds would
have drawn verge tufts on a gravel row and been eroded by the surrounding gravel through
the corner masks. That is the Phase 2 round-2 defect, and `assertYardsStandOnTheirOwnSurface`
now makes it a generation failure rather than a thing to notice later: it checks against
the **painted grid**, not the plan's rectangles, because surfaces are painted in order and
a later one can take a tile a yard was written for.

**A fence sealed off fourteen tiles, and the check caught it before a screenshot could.**
The Garrison Green was first stated across its band's full height. The row above it is a
single-tile strip pinned between the north wall and the two cottages' back walls, whose
only lateral exit is east past the green — so the green's north-west corner post landed
in exactly that gap and stranded **14 walkable tiles**, reachable in the Phase 3 town and
dead in this one. Nothing about the finished map looks wrong. The green now starts one row
lower and that row is a back lane running from the west wall to the civic terrace. The
check is `.tmp`-free: a flood fill from the plaza asserting every door, every door's exit
tile, the Doomsday escape tile and **every walkable tile inside the walls** is reachable,
plus that each fenced yard's interior is fully reachable through its gates. 20/20
generations clean after the fix, 20/20 failing before it.

**Ground scatter is suppressed over whole plots now**, which needed `PlannedBuilding.plotTop`
— the band's first row — so a plot is `west … west + sprite width` by `plotTop … frontRow`
rather than just the art. Nothing visible changes today (the interior has no field grass
for the weed scatter and no track for the worn-patch scatter outside the alleys), so this is
an intent fix rather than a visual one: shrinking a building's art now leaves garden behind
it rather than a strip of scattered weed nobody planted.

**Nothing regressed.** Metrics identical to Phase 3 — 55 × 41, 764 built tiles, 33.9%,
farthest door 33.4 (The Sunken Stump Pub), 6 ground materials, 16 buildings.
`assertTownInteriorIsIntact` is silent over **100 consecutive generations** with the two
new tile types admitted to `TOWN_INTERIOR_TILE_TYPES`.

**Review round 1 (independent), fixes applied.** The round's own contribution was to
build the thing this phase was missing: a **headless render harness**
(`node-canvas` + the real sprite sheets + `renderCanvas`), which turns "verified as data"
into "verified as pixels". Both high-severity findings were things no amount of tile-level
measurement could have caught, and both were visible in the first image rendered.

- **A north-south fence run drew as a plank with a rung every tile.** Two defects in
  `drawFence`, and the second explains the first. The ground shadow was drawn
  unconditionally as a full-tile-width bar — right for a run seen side-on, and a dark
  crossbar at 84% of every tile down a run seen end-on. And the vertical branch sat inside
  the rail loop without reading the loop variable, so it drew the identical `fillRect`
  twice and a north-south run got *one* rail where an east-west run got two. The same
  enclosure read as a post-and-rail fence along its top and as a ladder down its side. The
  two axes are now drawn as what they are: side-on shows two rails between its posts,
  end-on is foreshortened to a single line of timber with its shadow under the timber
  rather than across the tile.
- **The kerb pass outlined building plots and door aprons instead of street edges** —
  the exact failure this file claimed the narrowed material sets prevented. Two causes:
  - `KERB_SOFT_MATERIALS` held `dirt` and `gravel`, and both are **made surfaces**: `dirt`
    is `FloorTypeValue.road`, which the plan calls the lowest rung of the street hierarchy
    and `TileGrid` counts as paving, and `gravel` is the workyards and gate aprons. So
    Blackwood Lodge's three-tile doorstep — an island of setts in a packed-earth alley —
    got a closed pale rectangle drawn around it, and every gate apron grew a lip out in
    open country. The set is now `verge` alone, which is what a street verge *is*.
  - The ground under a facade keeps whatever the plan painted there, usually verge, so
    classifying by tile type alone laid kerbstone along building base rows — a pale lip
    against a wall, sitting inside the contact-shadow band this same phase added two passes
    later. `drawKerb` asks `occluderAt` now, which is the question the occlusion pass
    already answers.

  Measured with a replica of `drawKerb`'s two tests over the real grid
  (`old rule: 388 kerb edges, 226 against a tile under building art` →
  `new rule: 96 edges, 0 against building art`), and confirmed in the rendered image:
  Blackwood's doorstep is a patch of setts blending into its alley instead of a floating
  stone tray, and The Rusty Anvil's plot no longer has a hard pale outline on all four
  sides.

- **`assertYardsStandOnTheirOwnSurface` ran before the passes that can still write into a
  yard**, which made its own justification false — it checked the painted grid "because a
  later pass can take a tile", while running before both later passes that reach a yard. It
  missed the east side-gate torch standing inside Miller's kitchen garden. The yard passes
  now run last, after the props, and the check exempts **planned prop tiles** as well as
  building art: the torch reads as a garden lantern and doubles as the enclosure's corner
  post, but it is exempted by being *in the plan*, not by a tile-type allowlist, so
  anything that reaches a yard without being planned still fails.
- `buildFootprintIndex` packed positions as `y * width + x` with no column bound, so an
  offset reaching past a row's end would have wrapped onto the next row and put a phantom
  contact shadow elsewhere on the map. Unreachable today; the offsets come from sprite
  manifests and this is a shared renderer.
- **A claim in these notes was false.** It said The Sunken Stump Pub's widened apron lands
  on the town wall, and that this is why `paintDoorApron` uses `setPaved`. Measured across
  all fifteen buildings, **no apron tile lands on the wall**: the pub's doorway starts on
  the interior's *second* column, so its apron reaches the westmost interior column and
  stops one short of the stone. `setPaved` stays — the apron's width comes from a sprite's
  facade, so a re-cut door one column further out would reach the ring — but it is a guard,
  not a fix for a live case, and the doc now says so.
- Also: unnamed hash and geometry constants in `drawGardenPlanting` and `drawFence` are
  named; the plot height was `centre.y + frontRow - (centre.y + plotTop) + 1`.
- **Pre-existing, fixed in passing:** `WELL` was missing from `isWalkableTileType`'s
  exclusion list while `TORCH` and `FOUNTAIN` were in it, so both town wells were walkable
  and the player could stand inside one. Every consumer that cares about a well — the murder
  quest's clue, the drink heal — measures distance to the tile rather than standing on it,
  and the reachability check already treated wells as solid, so this only removes the
  discrepancy.

**What round 1 verified and found clean**, which is worth recording because it closes the
"not measured yet" item this section previously carried:

- **Chunk cache vs direct render: 0 differing channel samples of 12,582,912, max delta 0**,
  over a 64 × 48-tile view of the whole town. That is Phase 2's cheapest regression test,
  and it passes with three new passes in the ground renderer.
- **Containment:** of 2,565 town tiles drawn in isolation, only the pre-existing overhang
  types paint outside their own rect (`SPRITE_BUILDING`, `TORCH`, `WELL`, `MAIN_TOWER`,
  `FOUNTAIN`). `FENCE`, `GARDEN_PLANTING` and the kerb pass paint **zero** pixels outside
  their tile.
- **Cost:** the footprint index is 1.98 ms once per map; `occluderAt`'s up-to-13 lookups
  per tile cost 40 ms across a whole-map bake of 1321 ms — about 3%, and chunks bake lazily.
- **Aprons:** all 15 doors are `LANE_STREET` across both rows; the whole footprint change is
  46 tiles (30 verge under facades, 13 cobble doorsteps on Market Street, 3 in Blackwood's
  alley) and touches no prop, gate, wall, plaza tile or other building's ground.
- **Anchors:** notice board, fortune teller, both stalls and vendor rows, the Doomsday escape
  tile, the krasue roost, GumGum's perch and the club alley all land on walkable non-fence
  tiles. `TownLifeSystem` frontage components are unchanged for every door — one door gained
  a component, none lost one.
- Every tile-type registry checked for both new types; `townMetrics` and `DECORATION_TYPES`
  correctly *exclude* them.

**Review round 2 (independent), fixes applied.** Round 1's fixes all held under attack —
the kerb sets, the reordering, the prop exemption, the bounds guard and the `WELL` change
were each re-verified, several by injection. What round 2 found was that **round 1's fence
fix was half a fix, and that it had exposed a deeper defect underneath it.**

- **A fence lost the surface it was driven into, and 17 of 75 tiles rendered as the street
  outside their own yard.** `grid.set(x, y, FENCE)` overwrites the tile's type, `FENCE`
  deliberately has no material of its own, and `groundMaterialUnder` therefore fell through
  to `inferFloorType` — which takes the **first cardinal neighbour**, and that probe starts
  to the *south*. Every fence on a yard's southern perimeter took the street beyond it:
  the Market Row workyard's entire south row drew **cobble**, the Garrison Green's drew
  **lane setts**, and the yard's own surface stopped a row short. The corner masks blended
  it, so it read as deliberate. This is the `GRASSY_WEED`-on-the-verge defect one level up:
  a thing that stands on ground reporting the wrong ground.

  The fix is to stop inferring where the answer is known. `TileContent.groundType` records
  the surface a prop replaced, `TileGrid.setStanding` writes it, and both
  `groundMaterialUnder` and `inferFloorType` prefer it over the probe. Measured after:
  **verge→verge ×57, gravel→gravel ×18, 0 fence tiles resolving to a non-yard material.**
  The field is optional and only fences set it today, but it is the general answer — a
  torch or a well on a region's south edge has the same problem waiting.

- **That defect was also feeding the kerb pass**, which is why round 1's kerb census was
  wrong. Those fence tiles classified as `lane`/`cobble` are in `KERBED_MATERIALS`, and
  their yard-side neighbour is verge, so a pale lip was drawn along the top of the fence
  row **inside** the garden. `occluderAt` does not skip a fence. The round-1 note's
  "96 kerb edges" was an undercount for a reason worth naming: the replica script
  classified neighbours with `groundMaterialForTileType`, while the renderer uses
  `groundMaterialUnder`, so the replica could not see any tile the renderer *infers* a
  material for. **A replica that diverges from the function it replicates is the
  "measurements that ran but still lied" trap in its purest form.** The census now mirrors
  all three branches (direct, recorded, inferred), and reported 0 lips drawn by a fence
  tile. Its other figures were wrong for a reason round 3 found — see that round.

- **Rails were drawn edge to edge, so 34 of 75 fence tiles hung half a tile of timber into
  open ground** at every run end and corner. Every measurement in `drawFence` now runs from
  the post *outwards*, only towards sides that actually have a fence neighbour; two tiles
  either side of a joint each draw their own half, so a run still looks continuous. A lone
  tile draws its post alone, which is what a gate cheek is.
- **The north-south ground shadow broke 3 px at every tile boundary** — a light rung every
  tile, the mirror of the dark rung round 1 removed, because the shadow's *thickness* was
  subtracted from a vertical *extent*. And the tall upright drawn on an end-on run spans
  only 24%–84% of its tile, so the run read as a dashed string. An end-on run now draws a
  post cap rather than an upright; a corner still gets the upright, because it has an
  east-west rail to carry.
- The comment claiming the yard passes run "after every pass that can still write into one"
  was wider than the truth: `scatterGroundCover` runs after them and *is* such a pass, held
  off only by the `yardPlots(plan)` suppression argument. Stated as what it is.

**Review round 3 (independent), fixes applied.** Round 2's `groundType` fix held —
verified by *pixels* rather than by re-deriving the rule, each fence tile's ground rendered
and matched byte-for-byte against the same tile forced to each candidate material. What
round 3 found is that **the fix had been applied to fences only, and a torch on the map was
live proof it was needed elsewhere.**

- **The west side-gate torch stood on verge and drew cobble.** `paintTownProps` still wrote
  props with `set`, so the same inference ran: the probe skipped the fence south of it and
  the wall west of it and took **Market Street's cobble to the north**, putting a full tile
  of cobble jutting down into the verge strip inside the wall. Its mirror at the east gate
  has the identical neighbourhood and drew verge — only because the tile south of it
  happened to be planted that generation, which `floorTypeAt`'s new `GARDEN_PLANTING` case
  rescued. **Two identical props, opposite results, decided by a dice roll in
  `plantGardens`.** Every prop is written with `setStanding` now — torches, wells, the
  fountain, and the circus's torches — and `floorTypeAt` consults a neighbour's recorded
  ground rather than skipping past it. Re-measured with the same probe: **every in-town prop
  draws the surface the plan painted.**
- **The kerb census in these notes was wrong, and wrong in a way that hid that torch.** The
  replica this file quoted said 145 lips / 7 by wall tiles / "5 by torch tiles standing on
  lane". Round 3 instrumented the **real** `drawKerb` — the lip colour is filled by nothing
  else in the pipeline — and measured **139 / 1 / 3 on plaza and 2 on cobble, none on lane**.
  The replica omitted `GROUND_OCCLUDER_TYPES`, which `occluderAt` tests *first*, so it
  counted six lips the renderer skips. **That is the same failure round 2 diagnosed, in the
  script round 2 wrote to replace the one it condemned** — and the sentence "which is
  correct — the ground under a torch really is lane" was asserting correctness for the very
  tile that was wrong. The instrumented figure is now what this file quotes, re-run after
  the prop fix: **139 lips, 0 straddling a tile boundary, 3 drawn by plaza torches, 2 by
  wall tiles whose ground fill is covered by opaque stone.** The two at the side gates are
  gone, because those torches now resolve to verge.
- **The fence's ground shadow broke at every corner** — the east-west bar sits at 24–26 px
  and the north-south band stopped at 15 px, leaving an 8 px nick at each of the town's six
  corners — and the two overlapped to 0.39 alpha against 0.22 where they crossed. The band
  now reaches down to the bar, and both layers are drawn as one union per colour so a corner
  composites once. The kerb had the mirror of the same defect and gets the same treatment,
  written as non-overlapping rectangles rather than as a path so that an instrumented render
  can still count every stroke — which is a property this phase has now needed three times.
- **A rail could only terminate at another fence**, so a run stopped at the centre of its
  last tile wherever the thing closing the enclosure was not itself a fence. Miller's kitchen
  garden closed against the side-gate torch and the note claimed the torch "doubles as the
  enclosure's corner post" — which was not what rendered: the rail ended a tile and a half
  short of it. Rails now terminate into anything solid enough to nail one to, which closes
  that corner and every abutment against the town wall.
- `assertYardsStandOnTheirOwnSurface` is scoped to yard *interiors*, so it was structurally
  incapable of seeing the torch, which sits one row outside every yard bound. Stated as
  scope rather than left reading as coverage.

Round 3 also independently confirmed what rounds 1–2 claimed and this file had not re-run:
`groundType` has exactly three call sites, no code in `src/` clones, spreads, serialises or
diffs a `TileContent`, `GameMap` never copies tiles, the memo in `groundMaterialUnder` cannot
go stale on it (the recorded branch returns before the memo is consulted), interiors never
carry one, and 0 non-fence tiles carried one before this round's change. Fence topology was
censused rather than assumed: 40 straight east-west, 11 straight north-south, 6 corners, 14
ends, 4 isolated — and all four isolated tiles verified individually against their yard's
own gate rectangles, so "a perimeter is never one tile long" is measured, not asserted.

**Review round 4 (independent), fixes applied.** Round 4 attacked round 3's prop change and
found it sound — every in-town prop draws the surface the plan painted, `groundType` has five
write sites and all are on the overworld, dungeons and interiors never carry one, and of the
61 tiles whose floor inference changed, the 18 any renderer consults are exactly the ones the
fix targeted. What it found instead was that **round 3's rail-anchor fix was measuring the
wrong thing, and its two live effects were both harmful.**

- **`SPRITE_BUILDING` is one anchor tile, and that tile is the top-left of the art rect —
  transparent sky above the roof.** `paintYardFences` already knows this and asks the *art
  rects*; `drawFence` asked *tile types*. So the anchor set fired on exactly two tiles in the
  town, both gate cheeks that happened to sit above an anchor, and hung a rail off into open
  verge with the roof half a tile below (Miller's) and **1.84 tiles** below (Signet's) —
  measured by alpha-scanning the rendered art, not by looking. Worse, it demoted both from a
  post to an 8 px cap, so a tile whose own docstring says a gate cheek "draws its post alone"
  drew no post. Meanwhile the **43 sides that genuinely abut a facade were untouched**,
  because a facade tile carries the plan's surface type. Round 3's claim that the change
  "closes every abutment against the town wall" was true only of the wall. Both building
  types are out of the set now, with the reason recorded next to it: closing the 43 needs the
  sprite footprints, and a footprint is not opacity either — it contains the very transparent
  rows that produced the two bad anchors. That is Phase 5 work alongside the signage.
- **A stale `groundType` outlived its prop.** `TileGrid.set` preserved the record, and the
  circus torches are written before `paintForests`, so a `TREE` landing on one inherited it
  and became a forest tree recording the circus's packed earth — ~2 per generation. Inert
  today, because nothing consults a record on a tile that has a material of its own, but the
  invariant "only props carry a record" was enforced by nothing. `set` clears it now: a plain
  write replaces the thing that recorded it. Re-measured over 40 generations, every carrier
  is a prop and there are no oddities.
- A lone gate cheek had lost its ground shadow when the rails became directional. It has one
  again.
- **Round 3's own topology census was stale**, because it defined adjacency as `type ===
  FENCE` while round 3's fix had changed the renderer to `FENCE_ANCHOR_TYPES` — the same
  divergence round 3 diagnosed, one level up, in the same round that diagnosed it. The set is
  exported now so a census imports it instead of restating it, and the settled figures under
  the renderer's own rule are: **75 tiles — 43 straight east-west, 11 straight north-south,
  6 corners, 10 ends, 1 T-junction, 4 isolated**, the four isolated being the gate cheeks.

Corrected rather than fixed:

- **The kerb corner rewrite has no live site.** Instrumented, all 139 lips are on tiles that
  kerb exactly one side, so the non-overlap logic is never exercised and there was no visible
  double-composited corner to repair. It is correct by construction and stays — a street tile
  with two verge neighbours is one plot edit away — but the round-3 note read as if something
  had been fixed, and nothing had.
- Three of the four symmetric plaza-corner torches draw a kerb and the fourth does not: its
  verge neighbour is under building art, which `occluderAt` suppresses. Cosmetic asymmetry,
  now stated.

Known and accepted from round 2, with reasons:

- **Making `WELL` solid also blocks line of sight and projectiles**, since `hasLineOfSight`
  samples `isWalkable`. The two plaza wells now give cover in ranged combat. That matches
  `FOUNTAIN`, which has always behaved this way, and a stone well giving cover is right —
  but it is a gameplay change, not only a tidy-up, and saying otherwise would be the same
  kind of too-wide claim as the one above.
- **`paintYardFences` is order-dependent**: `isClosed` asks `grid.isSolid`, and `FENCE` is
  solid, so a yard painted later would decline to fence against an earlier yard's fence. No
  two yards adjoin today — the closest pair is three tiles apart — so it is latent.
- Four isolated fence tiles exist and all four are genuinely gate cheeks, which is what the
  "a perimeter is never one tile long" comment claims.

**Review round 5 (independent) — the change set came back clean.** Every one of rounds 1–4's
fixes held under attack, and every quantitative claim in this section was re-derived and
reproduced. Highlights of what was confirmed rather than asserted: the `SPRITE_BUILDING`
anchor removal differs on **exactly the two tiles** round 4 named and both are gate cheeks;
the shadow pass makes **88 fills for 75 fence tiles + 13 strip-boundary redraws — one
composite per tile**, so nothing double-darkens; `assertNoUnusableSlivers` is **not vacuous**
(21 building pairs clear its row-overlap gate, with a gap histogram of `0:1 3:4 5:2 11:1 …`,
so one tile of art growth on any of four pairs trips it); the dev routes were **run, not
read**, and `?townmap` prints this file's metrics from the running app; and the whole-map
bake costs **+6% against a `HEAD` worktree** (1177 ms vs 1111 ms) for all three new ground
passes plus the footprint index, entirely at bake time.

Round 5's three findings were a dead branch, a latent hole and a naming contradiction, all
taken:

- `FENCE` in `NON_FLOOR_TYPES` carried a comment saying a probe "must look straight past one",
  which is the opposite of what now happens — `floorTypeAt` answers from the fence's recorded
  ground and returns before that set is consulted. The entry stays as defence in depth; the
  comment says what it is.
- **`setSprite` did not clear `groundType` while `set` does**, which left one hole in the
  invariant round 4 established. Unreachable today (its one caller runs before every
  `setStanding` site, and 0 tiles carry both a sprite key and a record), but `floorTypeAt`
  consults a record *before* rejecting non-floor types, so a record surviving under a building
  anchor would make that anchor answer "floor" to every neighbouring probe — the stale-`TREE`
  defect one tile type up.
- The `Garrison back strip` was named "back lane" in the round-1 note while being planted as a
  garden. It is both — the buildings' back yard *and* the only route out of the strip behind
  the cottages — so the name is now the one the plan uses and the note says walkable.

Round 5 also corrected two of this file's own numbers by measuring them differently: the
apron's "46 tiles" is the **Phase-4 delta** (110 `setPaved` calls, 56 tiles differing from an
un-aproned grid, of which 46 are new), and "369 interior tiles gain a contact shadow" holds
under "gained at least one occluding side" — under the stricter "had none at all" reading it
is 331. Both figures are right; the second's wording was looser than its measurement.

**Review round 6 (independent) — confirmation, and one gap worth closing.** Round 5's three
fixes were verified to break nothing, by instrumenting the real prototype methods: over 25
generations, **375 `setSprite` calls cleared 0 records**, and `set`'s clear does exactly the
work round 4 claimed and only that — all 49 clears are `TORCH recording road → TREE`. Every
required check reproduced: chunk-vs-direct 0 of 12,582,912; containment over 23,085 tile
renders; **50/50** reachability generations; 100 generations with every assertion silent;
metrics identical. Two speculative failures were chased down and cleared — no townsperson can
be stranded in a fenced yard (**0 frontage tiles fall inside one**, and the aprons actually
*removed* one pre-existing split, 10 split doors → 9), and entities never draw behind a fence
in a way that matters, because a fence paints nothing outside its own tile and blocks
movement, so the only figures overlapping it stand south of it.

**The one finding was that this phase's best catch was not in the shipped code.** Six
generation-time assertions live in `src/`; the flood fill lived only in a scratch script, so it
ran when someone remembered to run it — and this file said "the check is `.tmp`-free", which
was simply false. That matters more than it sounds: the Garrison Green defect stranded 14
walkable tiles, *nothing about the finished map looked wrong*, and none of the other six
assertions can see it, because connectivity is a property of all of them together.
`assertTownIsFullyReachable` now runs over the finished grid, and it throws rather than warns
because everything that blocks movement inside the walls is plan-derived. Round 7 then
sharpened all three of those words — see below.

**Writing it found a bug in itself, which is the point.** The first draft took the blocking set
from the art rects the generator already has, and failed immediately with `The door of
'Blackwood Lodge' cannot be reached from the plaza` — a doorway is inside its building's art
and is the one tile of it that is not blocked. It rebuilds `GameMap`'s set the way `GameMap`
does instead, from the anchors through `getBlockedTileOffsetsByKey`. A connectivity check that
disagrees with the collision model is worse than none. Watched firing on the real defect:
restoring the Garrison Green to its band's top throws `Tile -27,-18 inside the town wall is
walkable but cannot be reached from the plaza`.

Round 6's two documentation corrections, both taken: the containment note named five bleeding
types and there are **six** — `DIRT_PATCH` also overhangs, 1 tile in 10–21 by up to 7 px at
alpha 57, pre-existing art this diff does not touch, missed because round 1 swept a single
generation and the placement is random. And **`FENCE` blocks line of sight** exactly as `WELL`
now does — `hasLineOfSight` samples `isWalkable`, so fences affect auto-target, projectiles and
the cat's pounce. Round 2 recorded that consequence carefully for wells and this file did not
record it for fences; it is the same class of change and gets the same sentence.

**Review round 7 (independent) — ready, and three refinements to the new assertion.** Round 7
attacked `assertTownIsFullyReachable` specifically and found that its first shipped form was
looser than its own docstring in three ways, none of which could produce a false pass on the
real map but each of which was a claim wider than the code:

- **Its blocking set did not match `GameMap`'s.** `GameMap.buildExtraBlockedTiles` calls
  `getBlockedTileOffsets(tile.type)` for *every* type; this named `MAIN_TOWER` explicitly. Two
  types carry type-keyed offsets, and the other is `WELL` — so the two tiles north of each
  plaza well were blocked in the game and walkable to the check, 4 tiles a generation. Always
  in the permissive direction, so it could only ever mask a disconnection, and it masked none
  (a flood fill through the real `GameMap.isWalkable` over 30 generations found nothing
  stranded). The branch is `getBlockedTileOffsets(tile.type)` now, which makes "rebuilt the way
  `GameMap` rebuilds it" true rather than nearly true.
- **Throwing was not safe for the Big Top.** The door loop included it, and it stands outside
  the walls at a random distance: measured, **about half of all generations at map size 120 and
  half at 150** would have crashed overworld generation with `The door of 'Big Top' cannot be
  reached from the plaza`, because the circus's distance does not scale with the map and the
  tent gets clipped by the void border. (Round 7 quoted 14/20 and 9/20 from single
  20-samples; over 100 runs each it is ~53% and 50%, and two 20-samples order the two sizes
  oppositely — so the rate is a coin toss at both and no ordering between them holds.) Never at 280, the only size the game uses — but an
  assertion whose trigger is a dice roll must not crash generation. The check is about the
  *town*, so it now skips any door outside the wall.
- **It cost 8.79 ms a generation, 21% of `generateOverworld`**, because a permissive fill from
  the plaza floods the entire wilderness. Both the fill and the anchor scan are confined to the
  wall's interior now, which is also a **stricter** property: getting from one part of the town
  to another must not require leaving it and walking round the outside. `generateOverworld`
  went from 41.0 ms to **18.6 ms** a generation — faster than before the assertion was added,
  because the anchor scan no longer sweeps 78,400 tiles.

The size limit that remains is stated in the code rather than left to be discovered: the town
is 55 x 43 and `FOREST_MIN_DIST_TILES` is 65, so below about size 150 the forests land inside
the walls. **100/100 generations pass at 150, 200 and 280** with zero warnings at any of them; roughly
5 in 6 at 120, where `assertTownInteriorIsIntact` is already warning about trees in the town.

Round 7 verified both of round 6's documentation corrections by measurement — six bleeding
types with `DIRT_PATCH` at 7 of 78 tiles and ≤7 px, and `FENCE` blocking line of sight through
the real API against a verge control — and re-confirmed the standing set, including watching
the new assertion fire on the injected Garrison Green defect with the message this file
records, byte for byte.

**Review round 8 (independent) — signed off.** The item most likely to have gone wrong was
confining the assertion's fill and anchor scan to the interior: a bound that reads tighter
than it is has been this redesign's recurring bug, three separate times in Phase 3. It was
attacked structurally rather than sampled. Only three things in the whole manifest declare
blocked offsets — sprite buildings by key, and `WELL` and `MAIN_TOWER` by type — all three are
placed from the fixed plan, and a whole-map sweep over 30 generations finds **no
offset-declaring anchor outside the interior at all**. The tower is the interesting case and it
is safe for the right reason: its anchor sits at row 123, inside the interior, while 4 of its 8
blocked tiles land on the wall row and are correctly discarded by the bound rather than missed
by it. The blocking set and `GameMap.isWalkable` were compared tile by tile over **80
generations at four map sizes: 0 divergences**, and the check still fires — the injected
Garrison Green defect throws 10/10 with the recorded message.

Round 8's two findings were both in the new docstring, and both are the pattern Phase 1's
lesson names — a reasoned number where a measured one belongs:

- "the circus stays **56 tiles clear of the interior**" is `CIRCUS_MIN_DIST − CIRCUS_RADIUS`,
  which is clearance from the town *centre*. Measured, the nearest a tent comes to the
  interior rect is **23 tiles**. The argument is untouched — 23 is still enormous — but the
  number was arithmetic nobody had run against the thing it names.
- "14 of 20 at size 120 and 9 of 20 at 150" were single 20-samples quoted as rates, and the
  ordering they imply does not survive: over 100 runs each it is ~53% and 50%, and a second
  pair of 20-samples reverses them. Both now say "about half", which is what was measured.

Also confirmed: `generateOverworld` at **18.5 ms** interleaved, against ~44 ms for the
unconfined form — the old fill reached **71,769 tiles per generation** against 55 × 43 now.
All 16 town doors are checked and exactly one is skipped, the Big Top.

**Judgement calls, recorded rather than fixed.** Two survive to the Phase 4/5 screenshot
review. **Lone gate cheeks read as stray fenceposts** — Miller's and Signet's each draw a
single post in open grass with no rail either side. Both are correct by the rule, and the
reason they look orphaned is the 43 facade abutments round 4 deferred: closing those turns each
cheek into a real gate jamb, which is why it pairs with the signage work. And **planting reads
as scratchy horizontal dashes** at 1x, closer to lines of text than to crop rows — noted by two
rounds now, and recorded here as surviving the fence fix rather than having been caused by it.

Round 1 also reported that planting reads
as scattered fragments rather than continuous beds at density 0.55. Rendered at 6× after the
fence fix, the beds read as rows of a slightly untidy kitchen garden, which is what they are
meant to be — a good deal of the "fragmented" impression came from the fence defect in the
same images. Left alone rather than tuned by opinion; it is a screenshot judgement for the
Phase 4/5 review, along with the observation that a building's plot shows as a green pad
where its art does not cover the plot, which §3.4's frontage treatment may want to address
in Phase 5.

---

## Phase 5 — Props & signage ◐

**Tier 1 — sells "town" immediately**

- [x] Hanging shop signs on brackets over all 15 named doors
- [x] Fences in three types (picket / post-and-rail / wattle), stated per yard
- [x] Lampposts, lit, on Market Street, Low Street, King's Road and both alleys
- [x] ~~Street kerbs~~ — landed in Phase 4
- [x] Gates as art — arches and gatehouses over all three, in Tier 3 below. (The
      four *yard* gate cheeks are still lone posts; that is a different gate.)

**Tier 2 — clutter and life**

- [x] Handcart, leaning wagon wheel
- [x] Crate / barrel stacks, sacks, hay bales
- [x] Laundry lines across both Low Quarter alleys
- [x] Planters; herb beds and vegetable rows redrawn (see below)
- [x] Water trough, hitching post, chicken coop
- [x] Smithy gear: anvil, coal pile, quench barrel, tool rack
- [x] Garden pumps
- [ ] Window boxes (they need a facade to hang on, which is sprite art)

**Tier 3 — wayfinding**

- [x] Fingerposts inside all three gates
- [x] Gate arches over all three gates
- [x] Bunting on the civic terrace and across the plaza's Market Street frontage

- [x] typecheck / lint / format clean
- [x] Independent review round 1
- [x] Independent review round 2

**Notes:**

2026-07-26 — four new sprite modules (`shopSign.ts`, `streetLamp.ts`,
`townClutter.ts`, `townWayfinding.ts`), one new system (`TownDecorSystem`), and
**a committed headless render harness** (`scripts/render-town.ts`).

**68 decorative props.** Measured over 30 generations with every system's blocks
in place — market, props, decor: walkable 1477, reachable 1477, **0 stranded
tiles**, every building's exit tile reachable and all three gates still passable.

**The harness is the important part.** Phase 4's review round 1 built one, found
two defects with the first image it rendered, and left it in a scratch file —
which this file then recorded as a lesson and promptly repeated. It is
`scripts/render-town.ts` now: node-canvas plus the real sprite sheets, the real
`renderCanvas`, the real decoration overlay and the real `TownPropRenderable`s
from the real systems, Y-sorted the way `RenderPipeline` sorts them. Every defect
below was found by looking at its output.

**Signs.** `ShopSignEmblem` is a required field on `PlannedBuilding`, so a
fifteenth building without a device is a compile error in the plan, and
`EMBLEM_PAINTERS` is a `Record` over the same union, so a device without art is a
compile error in the sprite. The board hangs off a wrought bracket projecting
**west** of the doorway. Four emblems were redrawn after the first contact sheet:
the moon rendered as an eclipse (even-odd over two discs fills the symmetric
difference, which is *both* limbs — a crescent is a subtraction and needs a clip),
the anvil and the scales both read as the letter T, and the quill read as a ruler.

**Doorways are not all one tile wide**, which the sign geometry originally
assumed. Measured over the thirteen sprites: six openings are one tile, five are
two, the General Store is three and The Horned Flagon is four. `computeDoorway`
reports the *centre*, so on a four-tile front the tile west of `doorTile` is still
doorway and the sign hung across the opening. `BuildingEntry.doorwayWidth` carries
the width and `signWestShiftTiles` turns it into a shift, which gives every
building the same geometry relative to its opening's **west edge**.

**Lamps block their tile, and a prop system blocks tiles *after* generation** —
where none of the generator's seven standing assertions can see it.
`assertTownIsFullyReachable` exists because one well-meant fence post stranded
fourteen walkable tiles with nothing about the map looking wrong, so every lamp
and every piece of clutter is checked against the same property before it is
placed: `leavesTownConnected` flood-fills the wall's interior with the candidate
blocked and requires the reachable count to drop by exactly one. The measurement is
recorded once, at the top of these notes, rather than twice — an earlier draft
quoted 1480 here and 1477 twenty lines above, both framed as "with every system's
blocks in place". 1480 was the pre-signpost figure; review round 2 caught it.

**Planting was redrawn, and it was a real defect.** Two Phase 4 review rounds
independently reported that the gardens read as lines of text at 1x. The cause was
that the ruled soil bars carried the silhouette and the greenery did not — three
full-width dark furrows a tile with twelve 2x5 px ticks standing on them. It is
two furrows at half the contrast now, with three wide two-tone clumps each drawn
*over* the furrow. The fixed furrow heights stay: they are what makes a run of
planted tiles read as one bed rather than as scattered tufts, which was the
failure the original design was avoiding.

**The `TownPlan` is now on `OverworldData` and `GameMap`.** Systems need the
town's geometry — which streets are streets, where the yards are — and every one
that has re-derived a coordinate instead has drifted from it eventually: the
murder quest anchored a body four tiles west of a door that later stood against
the west wall, and the notice board sat due south of centre on a rationale about a
tower that had moved.

**Review round 1 (independent), fixes applied.** Round 1 found six genuine
defects. The high-severity one is worth recording in full, because it is the Phase
1 lesson in all three of its kinds at once:

- **The fence-abutment fix was reverted.** Phase 4's round 4 deferred closing "the
  43 fence sides that genuinely abut a facade" to Phase 5, and said the fix needed
  the sprite footprints. It does not: `SpriteLoader` derives a footprint from the
  frame's whole width and height and blocks all of it bar the doorway, so
  transparent sky and transparent side columns are "blocked" exactly as solid wall
  is. Routing `anchorsRailAt` through it gained **6** anchored sides, not 43
  (133 → 139 over the real grid) — and alpha-scanning the art at those six found
  three anchoring into pixels **0.0%, 0.0% and 1.1% opaque**, which is verbatim the
  rail-into-open-verge defect that Phase 4 round 4 measured and rejected. The count
  was written from reasoning, the mechanism was explained from reasoning, and the
  result reintroduced the defect its own comment claimed to avoid. Reverted to the
  tile-type set; the comment now records the measurement and states what closing
  those sides would actually need (a per-tile opacity index built from the loaded
  images) and what it would buy (three fence tiles).
- **Three doc claims were measured and wrong, and are now measured and right.**
  The sign's clearance ("a tile and a half above the street, over the player's
  head" — the board's lowest ink is 10 px above the anchor), the eaves range ("one
  tile up, the smithy" — the minimum is four, shared by five sprites), and the
  lamp's reach ("about 2.3 tiles" — 2.63, because the flame's halo is a
  `shadowBlur` and blur is not in the geometry). Every figure in these modules is
  now a number the harness printed. Two of the *corrections* were themselves wrong
  on the first pass and were caught by running the measurement rather than by
  re-reading it: the sign reaches 1.03 tiles west, not 1.53, and the lamp a
  quarter of a tile past each side, not 1.28.
- **The sway phase stride was a lie of the kind that is true and useless.**
  "Irrational relative to 2π, so no two signs land in phase" — nine steps of 0.7 rad
  come within 0.017 rad of a full turn, so signs 0 and 9 differ by **0.03 px** of
  board travel and render identically. It is the golden angle now (`GOLDEN_ANGLE_RAD`
  in `utils.ts`, shared with the lamps' flicker): closest pair of fifteen **3.44%**
  of a period apart, against 0.27%.
- `FenceStyle` moved from `tiles/decorationTiles.ts` to `tileTypes.ts`. A leaf data
  module type-depending on a renderer is backwards, even at zero runtime cost.
- The picket rail thickness was a bare `2` among named constants.

Round 1 also verified clean, by measurement: the lamp connectivity check's
baseline/candidate comparison (an unreachable candidate and a blocked plaza centre
both fail safe); no runtime import cycle — every new edge is `import type`; and
200/200 generations passing all seven standing assertions.

Two of its sign-offs did **not** survive later rounds, and are recorded here struck
rather than left standing, because a stale clean bill is worse than none:

- ~~"No new prop can pop at the screen edge, the worst overhang being 2.63 tiles
  against a 4-tile cull margin."~~ True of the props that existed when it was
  written; **round 2 measured 16.5 tiles** on a bunting span added afterwards.
- ~~"Nothing blocks tiles after this system on the overworld … `SpiderQuestSystem`
  is constructed before the town systems."~~ The conclusion holds; the mechanism
  does not. **Round 5** found it is gated on a null lab room, not on construction
  order — see the round-5 note.

**Review round 2 (independent), fixes applied.** Round 2 verified all four of round
1's fixes correct by measurement — the `anchorsRailAt` revert is byte-identical to
`HEAD`, `signWestShiftTiles` is provably exact (it is literally the same expression
`computeDoorway` uses, so `doorTile − shift == the opening's west edge` for all 15
buildings), and both golden-angle figures reproduce. It then found fourteen defects
in the parts round 1 had not seen. The two that mattered:

- **Two of the three gate arches were rotated 90°, with a stone pier standing in
  the carriageway.** `drawGateArch` only ever drew face-on, west pier to east pier.
  The south gate is a four-tile opening in an **east–west** wall, so that is right;
  the side gates are four-tile openings in **north–south** walls, and `max(w, h)`
  happily returned 4 for those too — so their arches were drawn spanning four tiles
  *along Market Street*, covering one row of a four-row opening, with the vault
  arcing across The Horned Flagon's facade and over its shop sign. The fix is not a
  rotation: the wall renderer itself draws east–west runs face-on and north–south
  runs top-down (`drawTownWallTile` only crenellates a run's exposed north face), so
  a gateway has to match the wall it is cut into. `across` is the arch you look
  through; `along` is a gatehouse seen from above — piers beyond each end of the
  opening and the gate's own roof over the wall's single column of paving.
- **Culling is on the anchor alone, and three prop types reach far past it.**
  `PROP_CULL_MARGIN_TILES` is 4; measured east reach is **16.5 tiles** for the
  longest bunting span, 11.5 for the other two and 4.69 for a gateway. Walking five
  tiles east of a bunting anchor made the whole sixteen-tile string vanish in one
  frame. This also falsified round 1's own sign-off — "no new prop can pop at the
  screen edge, the worst overhang being 2.63 tiles" — which was true of the props
  that existed when it was written and not of the ones added afterwards.
  `TownPropRenderable` carries an optional `cullMarginTiles` now, so a prop that
  spans real distance declares it. Re-measured over all 68: **0 that pop**, and the
  tightest is the long bunting at 16.50 against its declared 17.

The rest, each measured:

- **The two fountain children never spawned.** The fountain is a solid 3 × 3 and
  the anchor bubble was a radius-1 circle, which admits the centre and four
  cardinals — all five of them fountain. The bubble came back empty and
  `addAnchoredCitizen` silently returned. The radius is per-anchor now and the
  fountain's is 2, which is where its first walkable ring is. Townsfolk 60 → 62.
- **Four painters leaked canvas state into the same render pass.** Props render
  back to back with no reset between them, and `strokeRound` leaves
  `lineCap='round'`, `lineJoin='round'` and `lineWidth=2` behind — inherited by the
  clutter on the same building's frontage, which sorts immediately after its sign.
  `drawSignpost` also leaked `ctx.font`, and hand-reset `textAlign` to `'left'` when
  the canvas default is `'start'`. Every new painter is wrapped in `save`/`restore`.
- **Five district labels cannot fit on the expanded minimap.** It draws one pixel
  per tile, so the whole 55-tile town is 55 px across — and a 9 px caption is 48–55
  px wide on its own. Two labels cannot share a row at any readable size, and at 11
  px of line height only four fit in the town's 43 rows. Market Row lost its label
  to that arithmetic. Re-measured: **no overlapping pairs**.
- **The anvil emblem still read as a capital T**, which round 1's redraw had
  claimed to fix. A symmetric face over a symmetric base is a T whatever happens in
  between, and a horn drawn as a bulge off the face's own line disappears into it.
  It is a separate tapering beak below the face line with a splayed foot now — the
  silhouette is lopsided, which is the only cue that survives at 26 px.
- `WHEEL_DIAMETER_COUNT` — the loop strokes full diameters, so `6` was twelve
  spokes, not six. Renamed rather than halved; twelve looks right.
- Four false claims in comments and in this file: "a **pair** drawing water at each
  well" (it is one), the district anchors "chosen to sit on open ground" (three of
  five sat inside a sprite footprint), "§3.5's **two** named sites" over a table of
  three spans, and **1480 vs 1477** for the same measurement in two paragraphs of
  this section — 1480 was the pre-signpost figure. The settled numbers are **68
  props, walkable 1477, reachable 1477, 0 stranded over 30 generations**.
- Also: the golden-angle JSDoc had been inserted between `clamp`'s docstring and
  `clamp`, so the clamp doc was documenting a radicand.

Round 2 verified clean: `findFreeTile`'s per-candidate connectivity check (correct,
fails safe, **69 ms once** at map load over 90 fills and 134,794 tile visits); all
68 prop positions (no clutter or signpost on a door apron — minimum Chebyshev
distance to any door is **3** — none in a gate throat, none outside the town); the
four doorstep anchor names all matching `buildingEntries`; no anchor able to spawn
on a tile a prop later blocks (`TownDecorSystem` is constructed before
`TownLifeSystem` and blocks permanently); labels unable to run off the minimap
(`renderDistrictLabels` is inside its `ctx.clip()`); no `as`/`!`/`any`; balanced
`save`/`restore` on every path; and no per-frame allocation in any prop's `render`.

**Review round 3 (independent), fixes applied.** Round 3 was pointed at round 2's
own fixes, because round 2 had found two high-severity defects and this file's
history says a fix is where the next defect hides. It found seven, two of them
high — and **both were in round 2's fixes**:

- **`drawLaundryLine` had an unbalanced `ctx.save()`.** Round 2's note says "every
  new painter is wrapped in `save`/`restore`" and its clean list says "balanced
  `save`/`restore` on every path". The `save` went in; the matching `restore` did
  not. Two consequences, both real: every prop sorting after a laundry line
  inherited its `lineWidth` and `strokeStyle` — the exact defect round 2 was
  fixing — and, worse, four lines × 60 fps pushed **240 un-popped saves a second**
  onto the canvas state stack for as long as the player stayed on the overworld.
  Nothing in `RenderPipeline` or `Scene` restores at frame scope.
- **The top-down gatehouse was drawn on the road, one tile off the wall.** The
  inset that puts a face-on arch *in front of* the rampart moves a top-down roof
  *off* it. Measured at the west gate: the roof covered (113, 148…151) — four tiles
  of walkable `COBBLE_STREET` — while the gate's own column at x = 112 was left
  bare and the piers came down on a verge tile and a torch. Its own JSDoc said the
  opposite. The inset is per-form now (`ARCH_INSET_BY_AXIS`), and re-measured: both
  piers land on `TOWN_WALL` at both side gates and the roof covers the gate column.

The rest:

- **The anvil emblem read as a capital T at 32 px** — still, after two redraws, one
  of which this file claimed had fixed it. **The scales did too**, which round 1 had
  also claimed to fix and round 2 had not re-checked. Both claims were made from
  renders at 6×; at the size the game actually draws them, a beam over a stem is a
  T no matter what is between them, and every line of a balance scale is two pixels
  wide. Rather than a third iteration on the same two motifs, they became a
  **hammer** and a **barrel** — one bold asymmetric mass each, which is the only
  thing that survives an 18 px emblem box. Verified by rendering all fifteen at
  `ts = 32` and magnifying nearest-neighbour, which is what they look like in play.
- Three prop docstrings described the world before round 2's own cull-margin fix,
  crediting the 4-tile default that the same change had overridden — and quoted 2.7
  and 4.69 tiles where the measurement is 2.84 and 4.72/4.81.
- The golden-angle JSDoc, which round 2 recorded *fixing*, had been moved onto
  `GOLDEN_RATIO_RADICAND` instead of onto `GOLDEN_ANGLE_RAD`. Fixed properly.
- Per-frame `[-1, 1]` array literals in six painters, against round 2's "no
  per-frame allocation in any prop's `render`". Hoisted.
- Four more numbers that did not reproduce: the sign's lowest ink is **9 px** above
  its anchor, not 10; a 9 px minimap caption's ink box is **62–68 px** wide, not
  48–55 (which strengthens the point — it is wider than the whole town); "townsfolk
  60 → 62" quoted a stochastic crowd size as if it were fixed; and the second
  bunting span sat **five rows inside the plaza** rather than on the civic terrace
  it was documented as crossing. Also `PlannedYard.fenced` still said "post-and-rail"
  after the same change set gave every yard a `fence` style.

Round 3 verified clean by measurement: the cull margins in **all four directions**
(round 2 had only checked eastward) — 0 of 74 props pop, tightest is the long
bunting; the fountain children now spawning on walkable plaza stone with the well
and doorstep anchors untouched; the four district labels colliding on **0 pixels**
through the real text path; `WHEEL_DIAMETER_COUNT` and the laundry `controlY`
renames inert; and 40 generations with all seven standing assertions passing, 68
props, walkable 1477, reachable 1477, 0 stranded. (Its `TownDecorSystem`
construction figure was corrected by round 4 — see below; the cost is not paid
once.)

**Post-fix re-verification**, since three of these fixes were to fixes: a
state-leak and save-depth audit over all 68 props — **0 leaks, 0 unbalanced
saves**; gateway piers on `TOWN_WALL` at both side gates; **0 of 74 props pop**;
and all fifteen emblems legible at the game's own tile size.

**Review round 4 (independent), fixes applied.** Round 4 was pointed at round 3's
fixes, for the reason round 3 existed: two rounds running, the new defect had been
*in the previous round's fix*. It happened a third time. Both high-severity
findings were in code round 3 had touched, and both were missed the same way —
**the fix was verified as data and never executed**.

- **Every street lamp vanished after the player left a building, and the blocked
  set grew without bound.** `canStandOn` asks `isWalkableIgnoringPermanent`, and
  its comment explains exactly why: `DungeonScene` hands the *same* `GameMap` back
  on exit, `permanentBlockedTiles` only grows, and a prop that honoured it would
  drift to a new tile every trip. The connectivity fill added in round 1 asked
  plain `isWalkable` — so on the second visit it saw the first visit's props as
  walls, every lamp candidate was already unreachable, the count came out equal
  instead of one less, and the check rejected all twelve. Measured on one reused
  map: **12 lamps on the first visit, 0 on every visit after**, their tiles left
  behind as invisible walls on the lit kerbs, and construction climbing **68 ms →
  307 ms by the fifth trip**. The guard was written on one of the two paths that
  needed it. The fill now reconstructs the blocked set from `occupied` and
  `claimedElsewhere` instead, which makes the whole placement idempotent:
  **5 consecutive constructions on one map, byte-identical prop sets, 35–43 ms and
  not growing.** The baseline is memoised too — it only changes when a tile is
  reserved, and recomputing it per candidate was half the system's cost.
- **The top-down gatehouse painted opaque stone over all four walkable gate tiles.**
  Round 3 was right about everything it measured — piers on `TOWN_WALL`, roof over
  the gate column — and wrong about the thing it never rendered: the roof *is* the
  gate column, so the west gate read as an unbroken six-tile grey slab with no
  visible opening and a lantern floating in it. It also sorted two ways at once, a
  player on the roof's anchor row hidden under it and one row south drawn over it.
  The face-on form states the rule this broke in its own docstring — an arch that
  narrows its opening is a wall with a hole in it. The `along` form is two piers
  and their lanterns now, and nothing crosses the throat.

The rest:

- **The face-on arch's one-tile inset was justified by a mechanism that does not
  exist** — "it would sort behind the rampart's own art". `TOWN_WALL` is a ground
  tile baked into the chunk cache; a prop in the Y-sorted pass is over it whatever
  its anchor row. The inset bought nothing and cost the two south-gate torches,
  whose tiles the piers landed on and occluded almost completely. Both forms anchor
  on the wall now, and all six piers land on `TOWN_WALL`.
- **"68 ms once at load" was wrong in kind, not just in value.** A `DungeonScene` is
  built on every building exit, so it is paid on every exit — which is what made the
  growth above a freeze rather than a curiosity.
- **"No clutter on a door apron" was a true number with a false conclusion.**
  Minimum Chebyshev distance from a door *centre* is 3, and The Horned Flagon's
  doorway is four tiles wide — a fact recorded two sections above in this same
  file — so its apron reaches three tiles east of centre and a barrel stack stood on
  the last tile of its own doorstep in 40/40 generations. Moved to +4; re-measured
  against every apron rectangle rather than against door centres: **0 blocking props
  on any apron**.
- **The laundry lines' docstring claimed the alleys are narrow enough that a line
  reads as crossing them rather than trailing off** — measured, all eight ends land
  on verge or street with the nearest building about three tiles away.
  `drawLaundryLine` stands its own poles now, so the claim is true by construction
  instead of by assertion.
- Also: `drawSignpost` rebuilt its font string and allocated a closure per arm per
  frame; a comment still named the retired `anvil` emblem; `PlannedDistrict` was
  exported with no importer; `fenceStyleAt`'s fallback carried a false rationale;
  and both the Phase 6 note and `MiniMapSystem` still said "five labels" after the
  count became four.

Round 4 verified clean by measurement, and more thoroughly than round 3 had: the
save/restore audit extended from 74 props to **194 painter cases** — every clutter
kind, every emblem across every doorway shift and sway frame, both gate axes, the
market stalls and the pre-existing props — **0 leaks, 0 unbalanced**. Every figure
round 3 wrote reproduced: gateway reaches 2.84 / 4.72 / 4.81, sign clearance 9 px,
0 of 74 props pop in all four directions, caption ink boxes 61.4–67.5 px against
the stated 62–68, and 40 generations byte-identical at 68 props / 1477 walkable /
1477 reachable / 0 stranded. The emblem swap is consistent across all three places
that must agree, with no orphaned painters or constants. The `PLANTING_CROP_HEAD_FURROW`
rename turned out to be load-bearing rather than cosmetic — the furrow list went
from three entries to two in the same change, so index 1 moved from 0.5 to 0.68 and
"middle" had become a lie about a two-element array.

**Review round 6 (independent) — the pattern broke.** Round 6 was pointed at round
5's fixes and told to render rather than read, and for the first time in five rounds
the highest-severity finding was **not** a defect introduced by the previous round's
fix. All five of round 5's fixes verified correct by execution: the torches
pixel-diff to **0 px of overpaint** against a no-gateway baseline (they were ~88% of
their own ink before), all six signpost arms fit their planks with margin and reach
1.94 tiles against a 4-tile margin, the state audit over 74 props × 3 frames tracking
15 context properties *and the transform* comes back **0 leaks, 0 unbalanced**, and
the laundry poles are arithmetically identical to the loop they replaced. Every other
figure in the round-5 note reproduced.

Its five findings were all low-severity, and the first is the one worth recording:

- **A stale round-1 sign-off had drifted to the end of the round-5 block and read as
  a round-5 conclusion** — reinstating two claims this same document disproves 200
  lines above ("no new prop can pop … worst overhang 2.63 tiles", which round 2
  measured at 16.5; and "`SpiderQuestSystem` is constructed before the town
  systems", which the paragraph immediately above it corrects). Five rounds of
  prepending each new note had pushed it there. It is back inside round 1 now, with
  both claims struck and pointed at the rounds that disproved them. **This is the
  Phase 1 lesson's third failure mode**, the one its own round 8 caught: a rewrite
  resurrecting something already shown to be false.
- The overpaint figures round 5 recorded, 69.6% and 71.9%, were tile-*area* coverage
  reported as ink coverage; measured against the torch's own ink it is ~88% both
  ways. The conclusion and the fix were right, the magnitude was not.
- "Four of the six anchors stand on a doorstep" — there are **seven** anchor sites
  and eight citizens; neither number was six.
- `scripts/render-town.ts` claimed three shims and installs two: a `performance`
  field was declared and never assigned, and nothing failed because Node provides
  `performance` as a global already.
- Six signpost arms over five distinct labels, described as five in one place and six
  in another.

Round 6's own closing measurement: 1477 walkable / 1477 reachable / 0 stranded at map
sizes 200, 240, 280 and 320; 43 reservations with the memo invariant recomputed after
each and **0 violations**; five constructions on one reused map, byte-identical, 33–37
ms; 0 of 74 props popping.

**Review round 5 (independent), fixes applied.** The pattern held a fourth time:
the top finding was again in the previous round's fix, and again it had been
verified as coordinates and never rendered.

- **Moving the arch's anchor did not save the south-gate torches — it occluded
  them slightly more.** Round 4 removed the one-tile inset on the grounds that it
  "cost the two south-gate torches, whose tiles the arch's piers landed on". The
  premise was right and the remedy was not: a pier is 3.35 tiles tall and 0.7 wide,
  so it covers the outer 70% of the first column either side of the opening
  *whatever row its foot is on*. Measured by rendering both anchor rows against a
  no-gateway baseline and diffing the torch's own ink against the pier's:
  **87.5%/88.9% overpainted at inset 1, 88.9%/88.8% at inset 0** — round 5 first
  recorded 69.6% and 71.9%, which is the pier's *width* as a fraction of a tile
  column reported as if it were ink coverage, and round 6 re-measured it. The fix
  belongs at the torch end. `SOUTH_GATE_TORCH_WEST/EAST` are two
  columns clear of King's Road now instead of one, and both torches burn in the
  open beside the arch.
- **Every signpost label overflowed its arm.** At a 32 px tile the arm's board is
  24.3 px and the labels measured 26.7 to **55.4 px** — "The Desperado Club" put a
  full tile of text out past the end of the plank. Nothing clamped, wrapped or
  sized to fit, and four review rounds had looked at the fingerposts without
  measuring one. The arm's length now comes from `measureText` on the label, with
  the old fixed length as a floor, and the longest label was shortened to
  "The Club". Re-measured: all six arms fit their planks with margin — six arms
  over five distinct strings, since "Market Plaza" is signed from both side gates.
- **"194 painter cases, 0 leaks, 0 unbalanced" was false on the leak half**, and
  false about exactly the props it named. `StallProp`, `NoticeBoardProp` and
  `BenchProp` contain no `save`/`restore` at all, and `FortuneTellerProp` leaks
  `lineWidth`, `lineCap` and both styles — which is verbatim the defect class
  rounds 2 and 3 fixed for the new props. It was latent before this phase and is
  not now: `DungeonScene` concatenates the decor into the same sorted list, so the
  seer's `lineWidth` reaches the cart shafts, wheel spokes and laundry ropes drawn
  after her. All four are wrapped. Re-audited over **74 props: 0 leaks, 0
  unbalanced.**
- A comment described a fourth signpost at the Market Street / King's Road junction
  that does not exist; round 4's "five labels" doc fix had been applied by grepping
  the phrase rather than the count, so two more instances survived; the end-poles
  round 4 added to `drawLaundryLine` reintroduced the per-frame array literal round
  3 had hoisted out of six painters; and two JSDoc blocks had been mangled by
  earlier edits.

Round 5 verified clean, and went further than round 4 had: the memo invariant was
checked by recomputing the true baseline after **each of the 43 reservations —
0 violations** — and on every branch (rejected candidate, drifted candidate,
candidate equal to the plaza centre, undefined centre, all fail safe); the new
fill's answer was compared against a ground-truth flood fill through the real
`GameMap.isWalkable` and agrees exactly (1477 / 1477 / 0 stranded); idempotence
reproduced at 34.6–41.0 ms over five constructions; and the seven standing
assertions passed over **200 generations at four map sizes**, with 68 props / 1477
walkable / 1477 reachable / 0 stranded at *every* size — so those are properties of
the town, not of one map size.

It also recorded something worth keeping: the fill's blindness to
`permanentBlockedTiles` is safe today **by accident**. `SpiderQuestSystem`'s blocks
are gated on a null lab room rather than on the construction order round 4 credited,
and the boss and treasure blocks run after the town systems over empty arrays. The
equivalence rests on an unstated invariant, and the next system that blocks a town
tile outside `claimedElsewhere` breaks it silently.

---

## Phase 6 — Life & navigation ◐

- [x] `TownLifeSystem` radii — landed with Phase 3's compaction, not here: 12 and 36,
      each with a stated reason (the plaza's corners are 11.31 tiles out, and the
      farthest door is 33.4)
- [x] Wander targets biased to street tiles — also landed in Phase 3, `isPaved`
- [x] Activity anchors: a drawer at each well, children on the fountain, and the
      smith, the bouncer, the innkeeper and the priest on their own doorsteps
- [x] Ambient audio radii — already tuned to the compact town (square 12, city
      chatter tracking the 40-tile safe radius)
- [x] District labels on the minimap (`MiniMapSystem`), expanded view only
- [x] typecheck / lint / format clean
- [ ] Independent review

**Notes:**

2026-07-26 — three of the six items were already done, having landed alongside
Phase 3's compaction with the reasoning recorded in the constants themselves. The
checklist had never been ticked. Verified rather than assumed: `PLAZA_RADIUS_TILES`
is 12, `DISTRICT_RADIUS_TILES` 36, `TOWN_SQUARE_AMBIENT_RADIUS_TILES` 12 and the
city-chatter emitter tracks `gameMap.townSafeRadius`.

**Activity anchors** are a fourth cohort in `TownLifeSystem`: a one-tile wander
bubble and the longest pauses of any cohort, so a figure shuffles at a fixture
rather than standing frozen — a motionless citizen would also be pushed off its
spot by the separation pass with nothing to bring it back. Wells are found by tile
type and the four doorstep anchors by building name through `buildingEntries`,
never by copied offsets: both of those coordinates have moved once already in this
redesign, and the two systems that had copied them are exactly what broke.

**District labels** brought back `PlannedDistrict` with its consumer, which is
what the Phase 3 review said would happen when `PlannedBuilding.district` and the
`TownDistrict` union were removed for having none. It is a name and a label anchor
and nothing else. The four anchors are placed by hand rather than computed as band
centres: three of the bands are centred on the plaza's own column, so computed
anchors would stack within a few pixels of each other at the minimap's one pixel
per tile. Expanded view only — at the normal size the map is two pixels a tile
over 160 and the captions would cover most of it.

---

## Phase 7 — Polish & validation ☐

**Acceptance criteria (from plan §9)**

- [x] ~~South gate frames the tower, Market Street and the plaza in one view~~ —
      **measured impossible, reworded**; see the note below
- [ ] The arrival view from the south gate frames the gate arch, King's Road and the
      Low Quarter
- [ ] No two buildings separated by bare grass
- [ ] No visible tile grid on large ground areas at 1× zoom
- [ ] Every named building identifiable without walking to its door
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

2026-07-26 — **the first acceptance criterion was measured rather than argued about,
and it is unreachable.** `DungeonScene` centres the camera on the player
(`camX = targetX + TILE_SIZE / 2 - canvas.width / 2`) and the canvas is the window,
so at 1920 x 1080 the view is 60 x 33.75 tiles and spans 16.9 rows either side of
the player. Standing in the south gate at row 165 that is rows **148 to 182**. The
plaza's *south* edge is row 147 and the tower's base course is row 123 — and the
spire rises above its base, not below, so "the tower" under the generous reading is
further off screen still, not nearer. Rendered at exactly that framing through
`scripts/render-town.ts --x=108 --y=148 --w=60 --h=34`: the shot contains the wall,
the gate arch, King's Road, all four Low Quarter buildings, the bunting, the washing
and two fingerposts, and the first row of Market Street at the very top edge. No
plaza, no tower.

No layout change can fix it — 42 rows is 1344 px against a 1080 px window — so the
criterion is reworded to describe the arrival shot the town actually has. The tower
is instead visible from the north half of the town: from Garrison Row at row 128 the
view spans rows 111–145, and the spire occupies roughly 101–124.

---

## Open questions

- [x] ~~Should Miller's Farm sit inside the SE wall or outside the south gate?~~ **Inside**,
      per plan §4's compact option, with its crop rows filling the band in front of it.
- [ ] Is the plaza too large? It came out **17 × 16** (272 tiles, against the old square's
      484). Reassess with the stalls, fountain, board and crowd in place — that is the
      Phase 4/5 review, and shrinking it is still cheap.
- [x] ~~**§9's first acceptance criterion looks geometrically unreachable.**~~ **Confirmed
      unreachable and reworded 2026-07-26** — see the Phase 7 note. The spire reading does not
      rescue it: a spire rises *above* its base, which is the wrong direction. Retired in favour
      of a criterion describing the arrival view the town actually has.
- [ ] Do the town walls need real art (§7)? Phase 3 shipped them procedural —
      `drawTownWallTile` in `buildingTiles.ts`: coursed ashlar with a crenellated parapet on
      any run's exposed north face, phased off the tile's world-pixel column so the
      battlement is continuous. Judge it from a screenshot before commissioning anything.
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
| 2026-07-25 | One tile type per ground material, not one road type              | A street's material becomes a property of the map rather than something the renderer infers. `FloorTypeValue.road` stays the generic packed-earth track — alleys, and everything outside the walls — so no separate alley type is needed, and the five new types make lane, main street, plaza, yard and verge all distinguishable to walkability, the minimap, `?townmap` and the townsfolk's wander bias.                                                                                                                                                                                                      |
| 2026-07-25 | Surfaces are painted in plan order, later ones winning            | The street hierarchy is then the _order of a list_, not a priority number or a junction-fillet pass: the Upper and Cross Lanes are stated as full-width bands and vanish where the plaza takes over, and a lane meeting a main street takes the main street's material with no special case.                                                                                                                                                                                                                                                                                                                     |
| 2026-07-25 | The wall is painted after the streets, then its gates re-cut      | Lets every street be a plain rectangle spanning the interior, with nothing able to pave over the wall. Clipping each street to the interior instead would put the wall's geometry into every street's definition.                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-25 | The plan states plots (west column, front row), not anchors       | Heights and widths come from the sprite manifest, so the plan never repeats a sprite's size and a re-scaled building keeps its frontage on the street. `assertTownPlotsDoNotOverlap` covers what that gives up: overlapping art is invisible in a screenshot, because the later sprite simply draws over the earlier one.                                                                                                                                                                                                                                                                                        |
| 2026-07-25 | Bypass routing runs over the circus only, not the town            | It fires on a structure with paving north _and_ south, which under a street plan is every town building by design; it would have paved a detour column through the gardens and lanes the plan just laid out.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-25 | The circus routes to the nearest **gate**, not the town centre    | A gate exit is a tile the gate's own highway paves, so the joint cannot miss. This retires the four-round `approachRoadStopOffset` saga rather than adjusting it.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-26 | Dropped the "plaza → any door in under 12 s" acceptance criterion      | Ryan does not care about it. It was also the last consumer of the farthest-door metric, whose own target of ~28 the Phase 3 review had already shown to be geometrically unreachable in a 55 × 40 town — the corner of that rectangle is 34 tiles from its centre. Both are retired rather than left failing.                                                                                                                                                                                          |
| 2026-07-25 | `townMetrics` counts the tower by its base, not its whole art     | 21 of the spire's 23 rows now overhang the fields north of the wall. Counting them would report a town measured at 55 × 40 as 61 tall and attribute 138 tiles of ground to a building standing on 12. Both rects are kept (`rect` / `artRect`) and `?townmap` draws the overhang faintly.                                                                                                                                                                                                                                                                                                                        |
| 2026-07-25 | `DIRT_PATCH` renders as `lane`, not as the `dirt` material        | It is a decoration drawn over a road. As its own material the surrounding lane wins all four corners and the mask erases it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-25 | Dropped `overworld_tileset` from the manifest                     | Nothing draws it once the four call sites move to the generated sheet, and it was a 1 MB image loaded at every startup. The PNG stays on disk — the generated palettes were sampled from it.                                                                                                                                                                                                                                                                                                                                                                                                                     |
