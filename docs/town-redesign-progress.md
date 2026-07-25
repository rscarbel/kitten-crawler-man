# Town Redesign — Progress Tracker

Working tracker for [town-redesign.md](town-redesign.md). Update the status column as
work lands; add dated notes under each phase. Keep the metrics table current — it is
the fastest way to tell whether the redesign is actually working.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⊘ dropped (say why)

**Overall status:** ◐ In progress — Phase 2's generator landed 2026-07-25; renderer
integration and everything else still to do.

---

## Live metrics

Re-measure after each phase (Phase 0 gives you the tooling to do it in one command).

| Metric                            | Baseline  | Target      | Current |
| --------------------------------- | --------- | ----------- | ------- |
| Town bounding box (tiles)         | 74 × 73   | 55 × 40     | 74 × 73 |
| Town area (tiles)                 | 5402      | 2200        | 5402    |
| Built density                     | 16.5%     | 40.5%       | 16.5%   |
| Farthest building door from plaza | ~48       | ~28         | ~48     |
| Ground materials used in town     | 2         | 7           | 2       |
| Ground materials available        | 2 usable  | 14          | **14**  |
| Worst joint-to-interior ratio     | never wrapped | ≤1.15   | **1.11** |
| Tiles before a visible repeat     | 1         | 4+          | **4–7** |
| Distinct outdoor prop types       | 3         | 15+         | 3       |
| Town safe radius (tiles)          | 55        | ~40         | 55      |
| Overworld frame time              | _measure_ | no regress. | —       |

---

## Phase 0 — Instrumentation ☐

Makes every later phase reviewable from one screenshot.

- [ ] `?townmap` dev route in `src/game.ts` (localhost-only, alongside `?people`)
- [ ] Renders the full overworld grid to a single canvas at a fixed small tile size
- [ ] Overlays building footprints + names, street materials, safe radius, gates
- [ ] Prints density / bounding box / farthest-door metrics to the console
- [x] `?tiles` dev route — `src/scenes/TilePreviewScene.ts`, materials + live-composited
      transitions, resolving frames exactly as the renderer will (done 2026-07-25)
- [ ] Baseline screenshots captured and committed to `docs/images/` for before/after

**Notes:**

---

## Phase 1 — Layout module extraction ☐

Pure refactor. Zero visual change — the generated grid must be identical to today's.

- [ ] `src/map/town/townPlan.ts` — `TownPlan` types (districts, street polylines, plots, prop slots)
- [ ] `src/map/town/paintStreets.ts`
- [ ] `src/map/town/paintPlots.ts`
- [ ] `src/map/town/paintGround.ts`
- [ ] `src/map/town/groundMaterials.ts`
- [ ] `generateOverworld` consumes a `TownPlan` reproducing the current layout exactly
- [ ] `OverworldData` contract unchanged; circus / forests / ruins / spawns untouched
- [ ] `?townmap` output matches the Phase 0 baseline pixel for pixel
- [ ] typecheck / lint / format clean

**Notes:**

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

| Date       | Decision                                                        | Rationale                                                                 |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2026-07-25 | ~~Keep the existing overworld tileset; fix usage before new art~~ | **REVERSED same day** — see below. |
| 2026-07-25 | **Replace the ground tileset; generate it with a script**        | Ryan: the sheet is ChatGPT-generated and was never built for tiling; the only tiles that work are ones he hand-repaired. Verified: only r0c0–c2 and r3c0–c2 are free of a baked-in dark frame (all other tiles score −10 to −60 border-vs-interior); rows 4–10 are unusable including col 0; and even the repaired tiles don't wrap (6–11 vs 0–3 for a seamless tile). Streets wrap vertically (0.2) but not horizontally (~10), which is exactly why you get squares without rotation and crosses with it. A torus-sampled generator PoC produced grass with **no visible seam** across a 6 × 6 shuffled patch. |
| 2026-07-25 | World-space ground noise promoted from polish to required        | The PoC's dirt showed faint per-tile tonal blocking even with perfect edges — per-tile seamlessness doesn't solve large-scale repetition, so the world-space layer must ship with the tileset. |
| 2026-07-25 | Move the tower to the town's north edge                          | Its 22-tile spire overhang sterilises a 6 × 22 corridor wherever it stands; at the edge it hides nothing and becomes a skyline landmark. |
| 2026-07-25 | Ground rendering (Phase 2) ships before compaction (Phase 3)     | Highest visual payoff, zero layout risk, and it de-risks the "do we need new art?" decision. |
| 2026-07-25 | Refactor into `src/map/town/` before changing the layout         | `generateOverworld` is one 768-line function; adding a street plan in place would be unmaintainable. |
| 2026-07-25 | Generate **multi-tile patches**, not single tiles                | Wrapping at one tile caps every feature below tile size — that is what produced a hard joint every 16 screen pixels and a dizzying brick grid. Patches decouple pattern period from tile size. |
| 2026-07-25 | Geometry from a shared `structure` seed, detail per variant      | Torus wrapping makes a patch seamless against *itself*, not against a differently-seeded sibling; shuffled variants of paved materials misaligned their stonework and read as a grid. |
| 2026-07-25 | Ship corner masks as one sheet, composite at load                | Baking transitions per material pair needs a row per pair *per patch phase*, and fixes at build time which pairs may blend. |
| 2026-07-25 | Always ship a calm jointless material per floor                  | Every material in the first dungeon draft had hard joints, so nothing could hold a stretch of floor. `dungeon_plain` is the default; jointed variants are accents. |
