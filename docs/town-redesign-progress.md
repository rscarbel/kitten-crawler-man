# Town Redesign — Progress Tracker

Working tracker for [town-redesign.md](town-redesign.md). Update the status column as
work lands; add dated notes under each phase. Keep the metrics table current — it is
the fastest way to tell whether the redesign is actually working.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⊘ dropped (say why)

**Overall status:** ◐ In progress — Phases 0 and 1 done 2026-07-25, and Phase 2's
tileset generator with them. Next up is Phase 2's renderer integration, then compaction.

---

## Live metrics

Re-measure after each phase (Phase 0 gives you the tooling to do it in one command).

| Metric                            | Baseline      | Target      | Current  |
| --------------------------------- | ------------- | ----------- | -------- |
| Town bounding box (tiles)         | 74 × 73       | 55 × 40     | 74 × 73  |
| Town area (tiles)                 | 5402          | 2200        | 5402     |
| Built density                     | 16.5%         | 40.5%       | 16.5%    |
| Farthest building door from plaza | 42.6          | ~28         | 42.6     |
| Ground materials used in town     | 2             | 7           | 2        |
| Ground materials available        | 2 usable      | 14          | **14**   |
| Worst joint-to-interior ratio     | never wrapped | ≤1.15       | **1.11** |
| Tiles before a visible repeat     | 1             | 4+          | **4–7**  |
| Distinct outdoor prop types       | 3             | 15+         | 3        |
| Town safe radius (tiles)          | 55            | ~40         | 55       |
| Overworld frame time              | _measure_     | no regress. | —        |

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
- `townMetrics` matched art to named entries by *containment*, which works today and breaks
  exactly when compaction puts one door inside a neighbour's footprint — double-counting
  area and corrupting the density metric in the phase it exists to validate. Matching is now
  exact (`anchor + manifest doorway`, tower by entry kind), each entry can be claimed once,
  and unmatched art warns instead of vanishing.
- `?townmap`: the browser fires `click` after every press/release, so every pan ended by
  toggling the view and re-framing. Panning now needs to exceed a 4 px threshold to be a
  pan, the origin is clamped so the map cannot be dragged off-screen, and the safe-radius
  and circus circles were centred on a tile *corner* while the markers used tile centres —
  a 12 px error at full zoom, when the point of the circle is judging what falls inside it.
- `fountainCentre` fell back to the town centre when no fountain existed, which would play
  water from a dry plaza. It returns `undefined`; consumers already treat it as optional.
- `TileRect`/`TilePoint` were declared twice inside `src/map/town/`, and `GameMap` still
  hand-rolled the building-kind union. Both now come from `townPlan.ts`.
- `townMetrics` no longer imports `OverworldData`, which had made `town/` both define the
  generator's inputs and consume its outputs. It takes a structural `MeasurableOverworld`.

Declined, with reasons:

- *Add a `never` default to the prop switch.* The premise — that a new prop kind would
  "compile clean and paint nothing" — is wrong: `@typescript-eslint/switch-exhaustiveness-check`
  is an error in this repo, and adding a fourth `PlannedProp` kind fails `npm run lint`
  (verified). A runtime guard would duplicate a gate that already blocks the commit.
- *Rename `src/map/town/` to `src/map/overworld/`.* Plan §5 names the directory; renaming it
  is a plan change, not a review fix.

All fixes re-verified: still **160/160 identical** generator output, metrics unchanged.

**Review round 2 (independent), fixes applied:**

- **Found a real pre-existing layout defect.** Round 1's unification of the road far-side
  offset was right that it should be one plan-owned value, but wrong that both call sites
  wanted the same *quantity*, and the rationale written for it was fiction. The E-W road
  band ends at `centre.y + 2`; approach roads start at `centre.y + 4`. **Row `centre.y + 3`
  is never paved** (and likewise column `centre.x + 3` eastward), so an approach taking the
  far-side branch stops a tile short of the junction — reproduced on seed 8 / size 280,
  circus at (186, 209), row 143 grass between road and approach. Scope corrected in round 5:
  the near-side branch targets a tile *on* the band and never gaps, so the circus is only
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
  non-turning branch targets `centre.y − floor(mainRoadWidth / 2)`, a tile *on* the band;
  `connectSiteToMainRoads`' far-side branch targets `centre.y + approachRoadStopOffset`, two
  tiles *past* the band's far kerb. That target, not the contiguity, is what leaves the gap.
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
  the paved network from the circus grounds to the plaza: **every cut-off seed is south *and*
  east**, with none in the other three quadrants. The rates quoted in this note initially
  came out low; round 7 traced that to the seeding (see below) and the settled figures are
  ~45% of the south-east quadrant and ~11% of all seeds. Both places now state the scope and
  a rounded rate rather than raw counts, which are stream-dependent.
- Round 4's explanation of *why* the door stub does not have the same bug was also wrong —
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
  conclusion survives every re-measurement — each cut-off seed is south *and* east, none in
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

- The south-east-quadrant rate was low because of how the *seeds* were generated, not the
  measurement: `mulberry32(i * 2654435761)` over consecutive `i` is an arithmetic
  progression whose first draw is not uniform, giving 18.3% at n=300 and 22.6% at n=1000
  when a uniform circus angle guarantees ~25%. Mixing the counter through an integer hash
  first gives 25.3–25.6%, matching two independent reviewers. Settled figures, stable across
  map sizes and seed families: **~45% of the south-east quadrant, ~11% of all seeds, zero in
  the other three.**
- The closing lesson had two false claims of its own — an undercount whose scope did not
  match its own record, and "every claim that was executed before being written held up",
  which the paragraph after it refuted. Rewritten to give no tally and to classify the
  failures by kind. Round 8 then caught that the rewrite had *reinstated* a trap round 6
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
as `i * 2654435761`, an arithmetic progression whose first `Math.random()` draw is *not*
uniform, which quietly pushed the south-east quadrant to 22.6% when a uniform angle
guarantees ~25%. Mixing the counter properly gave 25.3–25.6% immediately.

So: claims about this generator are cheap to test headlessly, and untested ones have been
wrong far more often than not. Test them — then check the test against something you know
must be true independently (a quadrant is a quarter; the paved set includes `DIRT_PATCH`),
and prefer a stated scope to an exact count that depends on which seeds you happened to draw.

---

## Phase 2 — New ground tileset + rendering ☐

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

**Rendering**

- [ ] `GroundMaterial` enum + material→row mapping (plan §3.1C)
- [ ] Frame resolution in the renderer, identical to `TilePreviewScene.frameIndex`
- [ ] Transition compositing baked into the chunk cache
- [ ] Delete `overworldRotation` — wrapping tiles don't need it and it can only hurt
- [ ] Per-tile variant pick by hash (any shuffle is valid once tiles wrap)
- [ ] Edge fringe pass — noise-masked material bleed across 4-neighbour boundaries
- [ ] Scatter pass — grass tufts onto adjacent street, cobbles onto adjacent dirt
- [ ] **World-space** low-frequency noise (~24-tile wavelength, ±6%) — required, this is
      what kills the per-tile tonal blocking the PoC still showed on dirt
- [ ] Ambient occlusion on ground adjacent to walls / buildings / wall ring
- [ ] All of the above baked into the 16-tile chunk cache, nothing per frame
- [ ] Screenshot review: **is the grid gone at 1× zoom?**
- [ ] typecheck / lint / format clean

**Notes:**

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
- [ ] Once the generator exists, is it worth regenerating the **dungeon** tileset too?
      `dungeon_tileset.png` has the same provenance and has not been audited for wrap
      error. Out of scope for this workstream — but cheap once the tooling is built.
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
| 2026-07-25 | Verify Phase 1 with a seeded hash, not by eye                     | "Zero visual change" is untestable by screenshot when the map's wilderness is random. Seeding `Math.random` and hashing the whole grid turns the claim into a check that either passes or fails. |
| 2026-07-25 | `?townmap` derives footprints from the grid, not `OverworldData`  | A dev-only field on the data contract would need re-deriving every time the layout changes; reading sprite anchors back off the grid survives the refactor untouched. |
| 2026-07-25 | `groundMaterials.ts` deferred from Phase 1 to Phase 2             | It maps a `GroundMaterial` to a sheet row and frame — a renderer concern with nothing to hold until the enum exists. Creating it empty in Phase 1 would have been a stub, not a module. |
