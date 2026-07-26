# Performance Optimization Plan

This plan is the result of a full performance audit of the codebase, focused on the
level 3 overworld town (280×280 map, ~60–110 townsfolk, up to ~220 mobs) where lag is
worst. It is written to be implemented incrementally by an agent (or human) working
phase by phase.

**Companion file:** `docs/performance-optimization-checklist.md` — check items off as
you complete them. Do not consider a phase done until its checklist section is fully
checked and the validation gates pass.

---

## How to use this plan

- **Work in phase order.** Phases are ordered by impact-per-risk. Each phase is
  independently shippable — the game must build, typecheck, lint, and play correctly
  after every phase.
- **Line numbers are approximate.** They were accurate at audit time but will drift as
  you edit. Always locate code by symbol name (function/class/constant), not by line.
- **Validation gates after every task:** `npm run typecheck` and `npm run lint` must
  exit 0, then `npm run format`. Never skip these.
- **Readability is non-negotiable.** Every optimization here was chosen because it can
  be expressed as clear, well-named code. If an implementation is drifting toward
  cleverness (bit tricks without named constants, inlined math without named
  variables, duplicated logic), stop and restructure. Follow CLAUDE.md: no casts, no
  non-null assertions, no `any`, no magic numbers.
- **Do not "optimize" beyond this plan.** Several subsystems are already well
  optimized (see "Already correct — do not touch" below). Speculative extra changes
  add risk without measured benefit.

## Audit summary — answers to the guiding questions

1. **Is partitioning done well?** The mob `SpatialGrid` (`src/core/SpatialGrid.ts`)
   is well built (packed integer keys, incremental updates) and correctly used by
   combat, spells, and the AI activation radius. However, roughly a dozen per-frame
   code paths bypass it and scan the full mobs array instead, and **townsfolk have no
   spatial structure at all** — their separation pass is O(N²) over the whole town.
2. **Are we making more checks than necessary?** Mostly small stuff (building-door
   detection scans ~17 entries per frame — fine), but several dungeon-only systems
   scan all ~220 mobs every frame on the overworld _before_ their early-return
   guards, and most aggro'd mobs compute line-of-sight twice per frame.
3. **Is procedural generation expensive at draw time?** Ground tiles are already
   baked into chunk canvases (good). The gaps: **townsfolk (~200 canvas ops each,
   every frame), town props (clutter/signs/lamps, one lamp per 9 street tiles, some
   using `shadowBlur`), and large sprite buildings (rescaled from full-res sheets
   every frame)** are all drawn procedurally per frame. Also, cold chunk bakes cause
   40–100 ms hitches and the chunk cache is unbounded (~340 MB fully explored).
4. **Is collision checking effective?** The single hottest function in the game is
   `GameMap.isWalkable`, which allocates 2–3 template strings (`` `${x},${y}` ``) and
   does string-keyed Set lookups **per call** — and it is the innermost function of
   movement, pathfinding, LOS, and townsfolk wander. Thousands of transient strings
   per frame.
5. **Would bitmasking help?** Yes — exactly here. A `Uint8Array` blocked-tile mask
   indexed `ty * gridSize + tx` turns `isWalkable` into one array read (Phase 1).
6. **Is pathfinding optimized?** No. The A\* open set is a Map scanned linearly for
   the min-f node each expansion (up to ~600k iterations for one path on open
   terrain), unreachable goals burn the full 2,000-expansion budget every repath,
   repaths are unstaggered so mob packs spike on the same frame, and every call
   allocates node objects and a fresh directions array.
7. **Any unnecessary code running?** Yes: per-entity `Array.filter` allocations on
   empty status-effect lists every frame, dungeon-only mob scans on the overworld,
   a fixed-timestep catch-up policy that amplifies slow frames into slower ones,
   per-frame full-screen radial gradient creation, uncapped/unculled gore particles,
   and re-running two full 78,400-tile scans every time the player exits a shop.

## Already correct — do not touch

These were audited and found well-designed. Leave them as they are:

- `TileChunkCache` chunk baking design and its `invalidateTile` flow (we only _add_
  an LRU cap and bake budget in Phase 5 — the design stays).
- The fountain composition cache (`src/sprites/fountainSprite.ts`,
  `compositionFrames`) — the model this plan copies for other caches.
- Torch/brazier single-`drawImage` tile animation (`src/map/tiles/decorationTiles.ts`).
- The minimap 1px-per-tile offscreen cache and `Uint8Array` fog of war
  (`src/systems/MiniMapSystem.ts`).
- `RenderPipeline`'s `DrawEntry` pool and mob/townsfolk/prop viewport culling.
- `SpatialGrid` itself (`src/core/SpatialGrid.ts`) — including its squared-distance
  `queryCircle`, which is the model for Phase 6 distance-check fixes.
- Mordecai's wander (`SafeRoomSystem.updateWander`) — a single counter, already free.
- `GoreSystem`'s swap-pop removal loop — the model for Phase 6 in-place filtering.
- The overworld generator's one-time BFS/flood-fills (generation-time only).

---

## Phase 0 — Near-zero-risk quick wins

Small, isolated fixes. Land these first to get a clean baseline.

### 0.1 Move the `JuicerRoomSystem` early-return above its mob scan

`src/systems/JuicerRoomSystem.ts`, in `update()`: the line
`const juicer = mobs.find((m) => m instanceof Juicer) ?? null;` runs _before_ the
`if (this.roomOriginX === ROOM_NOT_FOUND_POS) return;` guard. On the overworld there
is no juicer room, so this scans ~220 mobs per frame for nothing. Move the guard to
the first line of `update()`.

### 0.2 Guard `CircusQuestSystem`'s per-frame mob scan by phase

`src/systems/CircusQuestSystem.ts`, in `update()`: the `for (const mob of ctx.mobs)`
loop assigning `mob.allMobs` (and the `this.signet` assignment above it) runs even
when the quest is inactive. Add a phase guard above them, using the same idiom
`SpiderQuestSystem.update()` already uses. Apply the same treatment to the matching
scan in `src/systems/BigTopBossSystem.ts` if it lacks a guard.

### 0.3 `BarrierSystem`: stop clearing `isSlowed` on all mobs every frame

`src/systems/BarrierSystem.ts`, `update()`: `for (const mob of mobs) mob.isSlowed = false;`
runs unconditionally. Replace with a `private slowedLastFrame: Mob[] = []` field:
clear only the mobs in that list, empty it (`length = 0`), and push each mob you set
`isSlowed = true` on. When there are no barriers and nothing pending, this makes the
whole update a no-op. Apply the identical pattern to `SpellSystem`'s per-frame
`mob.isConfused = false` sweep (`src/systems/SpellSystem.ts`).

### 0.4 Cap fixed-timestep catch-up and drop the debt

`src/core/Scene.ts`, the accumulator loop: the current cap allows up to 5 catch-up
`update()` calls per rAF, so when updates are already slow the game does _more_ work
per frame — a spiral that turns spikes into visible stutter. Change to:

```ts
const MAX_CATCHUP_UPDATES = 2;
let steps = 0;
while (this.accumulator >= this.FIXED_DT && steps < MAX_CATCHUP_UPDATES) {
  this.current?.update();
  this.accumulator -= this.FIXED_DT;
  steps++;
}
// If still behind budget, drop the debt rather than compounding it next frame.
if (this.accumulator >= this.FIXED_DT) this.accumulator = 0;
```

Keep the existing elapsed-time clamp; name the new constant clearly.

### 0.5 Skip fog reveal when the player hasn't changed tile

`src/systems/MiniMapSystem.ts`, `revealAround()`: runs a 21×21 tile loop every frame.
Store the last revealed tile coords as fields and return immediately when unchanged.

### 0.6 Hoist the A\* directions array to module scope

`src/map/GameMap.ts`, `findPath()`: the 8-element `dirs` array of object literals is
rebuilt per call. Hoist it to a module-level `const` (this is superseded by the Phase
2 rewrite, but it's a one-minute fix worth taking immediately).

### 0.7 Fix the spider walk-loop audio start/stop churn

`src/scenes/DungeonScene.ts`, the grotesque-spider audio block: the start/stop
decision is made _inside_ the per-spider loop, so with one near and one far spider the
Web Audio loop is created and torn down every frame (2 orphaned audio nodes/frame).
Compute a single `anySpiderWalkingNear` boolean across all spiders, then call
start/stop once after the loop — mirroring how the player walk loop is handled a few
lines above. (Not a level 3 cost, but a real bug found during the audit.)

---

## Phase 1 — Walkability bitmask (biggest single win)

**Problem.** `GameMap.isWalkable` / `isWalkableIgnoringPermanent`
(`src/map/GameMap.ts`) do up to three `` `${tileX},${tileY}` `` template-string
allocations and three `Set<string>` lookups per call, then evaluate a ~25-term `!==`
chain in `isWalkableTileType`. `isStairwellTile` adds a fourth string. Call sites per
frame include: every moving mob (up to 8–16 string allocs each), every townsperson
wander step and separation nudge, every LOS ray sample (2 per tile), every A\* neighbor
expansion (up to 3), and player movement. This is the dominant GC producer in the game
and also the reason level-3 load hitches (`buildExtraBlockedTiles` builds ~100k+
strings while sweeping all 78,400 tiles).

**Fix.** One `Uint8Array` mask per `GameMap`, sized `gridSize * gridSize`, indexed
`ty * gridSize + tx`, with named bit flags:

```ts
/** Bit flags for blockedMask. A tile with any relevant bit set is not walkable. */
const BLOCK_EXTRA = 1; // extraBlockedTiles (multi-tile sprite footprints)
const BLOCK_PERMANENT = 2; // permanentBlockedTiles (runtime permanent blocks)
const BLOCK_ARENA_DOOR = 4; // arenaDoorTileSet (only while arenaDoorLocked)
const BLOCK_STAIRWELL = 8; // stairwellBlockedSet (for isStairwellTile)
```

Plus a second small lookup, `WALKABLE_BY_TILE_TYPE: Uint8Array`, built once at module
scope from the existing list of non-walkable tile types, so `isWalkableTileType`
becomes one indexed read instead of the 25-term chain. Keep `isWalkableTileType` as a
named method that reads the table — callers don't change.

Implementation rules:

1. **The existing `Set<string>` fields remain the write-side API.** Every method that
   mutates them (`buildExtraBlockedTiles`, `blockTilePermanently`,
   `unlockArenaStairwell`, `markTileDirty`, and any other mutator you find by
   searching for `.add(` / `.delete(` on these sets) must also set/clear the
   corresponding bit in `blockedMask`. These methods are the existing choke points —
   do not add new ones.
2. `isWalkable(tx, ty)` becomes: bounds check → read `blockedMask[ty * gridSize + tx]`
   → reject on `BLOCK_PERMANENT | BLOCK_EXTRA` → reject on `BLOCK_ARENA_DOOR` only
   when `this.arenaDoorLocked` → return `isWalkableTileType(structure[ty][tx])`.
3. `isStairwellTile(tx, ty)` becomes a bounds check + one bit test.
4. `buildExtraBlockedTiles` should populate the mask directly as it discovers blocked
   offsets, _without_ building the intermediate strings for the hot path (it may still
   maintain the string sets for compatibility, but compute each offset's numeric index
   once). This removes the level-load hitch.
5. Semantics must be **identical** to today, including the negative/out-of-bounds
   behavior (out-of-bounds is not walkable).

**Also in this phase:** `TownLifeSystem`'s `doorTiles` set and its `tileKey()` helper
(`src/systems/TownLifeSystem.ts`) are string-keyed and hit per townsperson per frame.
Convert `doorTiles` to `Set<number>` keyed `ty * gridSize + tx`. Add a shared
`tileIndex(x, y, gridSize)` helper next to the existing `src/systems/tileKey.ts` (or
convert that helper) so the packing convention is written in exactly one place.
Cold-path callers of the string `tileKey` (placement-time systems) may stay as-is.

**Acceptance:** no template-string construction remains in `isWalkable`,
`isWalkableIgnoringPermanent`, `isStairwellTile`, or `TownLifeSystem.isWalkableSpot`.
Walk into blocked tiles, locked arena doors (level with arena), stairwell tiles, and
building walls to confirm behavior is unchanged.

---

## Phase 2 — Pathfinding overhaul

All in `src/map/GameMap.ts` (`findPath`) and `src/creatures/Mob.ts`
(`followTargetAStar`), plus `src/systems/CompanionSystem.ts`.

### 2.1 Binary min-heap + typed-array scratch for A\*

The open set is currently a `Map` scanned linearly for the lowest-f node on every
expansion — O(open) per pop, ~10⁵–10⁶ wasted iterations per path on open terrain.

- Create `src/core/MinHeap.ts`: a small, JSDoc'd binary min-heap over numeric
  priorities (store node indices, prioritize by f-score). Keep it generic enough to
  read clearly; ~40 lines.
- In `GameMap`, keep **reusable scratch arrays** allocated once per map and reused
  across `findPath` calls: `gScore: Float64Array(gridSize²)`,
  `cameFrom: Int32Array(gridSize²)`, and a generation-stamped
  `visitedStamp: Int32Array(gridSize²)` with a `searchGeneration` counter so nothing
  needs clearing between calls (a cell is "seen this search" iff its stamp equals the
  current generation).
- Node identity is the packed index `ty * gridSize + tx` — no node objects at all.
- Rebuild the path with `push` + `reverse()` (the current `unshift` loop is O(n²)).
- Keep the existing `ASTAR_MAX_NODE_EXPANSIONS` cap and the diagonal
  corner-cutting rule exactly as-is (cache the two cardinal `isWalkable` results per
  expansion instead of recomputing them per diagonal).

### 2.2 Bound the search by distance and fail fast

A walkable-but-unreachable goal currently burns the full 2,000-expansion budget on
_every_ repath. In `findPath`, before searching:

- If the Chebyshev distance from start to goal exceeds a named constant
  (`MAX_PATH_DISTANCE_TILES = 24` — just beyond the AI activation radius of 22),
  return `[]` immediately.
- Scale the expansion cap to the request:
  `maxNodes = Math.min(ASTAR_MAX_NODE_EXPANSIONS, BASE_EXPANSIONS + chebyshev² * EXPANSIONS_PER_TILE²)`
  with named constants — a short path should never be allowed to flood a 25-tile
  radius of open grass.

### 2.3 Smarter repath policy for mobs

In `Mob` (`followTargetAStar` and the constructor):

- **Stagger:** initialize a per-mob `astarStagger` in the constructor (random 0–15,
  same idiom as the existing wander-timer stagger) and add it to the refresh interval,
  so a freshly-aggroed pack doesn't all pathfind on the same frame.
- **Failure backoff:** when `findPath` returns `[]`, set `astarTimer` to a new
  `ASTAR_FAILURE_BACKOFF_FRAMES = 120` instead of the normal 30, so unreachable
  targets aren't retried 2×/second.
- **Repath on goal movement:** track the goal's tile (`astarGoalTX/TY`); recompute
  when the timer expires _or_ the goal tile changed — but see 2.4's minimum gap.
- **Global per-frame budget:** add a per-frame counter (reset in `MobUpdateLoop`)
  allowing at most `MAX_PATHFINDS_PER_FRAME = 3` `findPath` calls; a mob over budget
  keeps following its stale path (or direct-chase fallback) one more frame. This
  converts residual spikes into smooth cost.

### 2.4 Companion repath thrash

`CompanionSystem.companionFollow` already repaths on goal-tile change, but a
diagonally moving player crosses tile boundaries so often that the 30-frame throttle
is effectively bypassed. Enforce a minimum gap between repaths (e.g.
`MIN_REPATH_GAP_FRAMES = 8`): honor the goal-change trigger only if at least that
many frames have passed since the last computation.

**Acceptance:** mobs still chase, flank, and give up the same as before; walking into
a pack of ghouls on level 3 produces no visible hitch; companion still follows through
doorways.

---

## Phase 3 — Line-of-sight caching

`src/map/GameMap.ts` (`hasLineOfSight`) and `src/creatures/Mob.ts`
(`hasLOS` / `updateLastKnown`).

1. **Dedupe the double call.** `updateLastKnown` computes LOS every frame, and most
   creatures' `updateAI` call `hasLOS` a second time for their attack gate. Cache the
   result on the mob for the current frame (e.g. `losCachedResult` invalidated in
   `tickTimers()`), so each mob computes LOS at most once per frame.
2. **Throttle.** Refresh a chasing mob's LOS every `LOS_REFRESH_FRAMES = 3` frames
   instead of every frame (LOS to a moving player is not a per-frame-accurate
   quantity; nothing visible changes).
3. **Walk tiles, not samples.** Replace the half-tile float sampling loop with an
   integer DDA/Bresenham grid traversal that visits each crossed tile exactly once
   (~7 tile checks for a 7-tile ray instead of 14 samples). Keep the function
   signature and semantics; add a short JSDoc explaining the traversal.
4. Early-return `true` when start and end are within one tile.

**Acceptance:** mobs still lose sight of players behind buildings/walls identically
(spot-check with a ghoul and a house on level 3).

---

## Phase 4 — Townsfolk update: spatial grid + LOD

`src/systems/TownLifeSystem.ts`, `src/creatures/townWander.ts`,
`src/creatures/townInteraction.ts`.

1. **Give townsfolk a `SpatialGrid`.** `SpatialGrid` is generic over `{x, y}`, so
   `Townsperson` fits without changes. Create it in `TownLifeSystem`, insert on
   spawn, and call `grid.move(person)` as part of the per-person update.
2. **Local separation.** `separate()` is currently O(N²) over the whole crowd
   (~5–11k pair tests/frame, pairing citizens 200 tiles apart). Rewrite it to query
   the grid for neighbors within `SEPARATION_DIST` per person. Preserve the exact
   push-apart behavior and the walkability gate.
3. **Distance-based update LOD.** Tick every citizen within ~30 tiles of the player
   at full rate; tick the rest 1-in-4 frames using a per-person phase offset
   (`if ((frameCounter + person.updatePhase) % DISTANT_TICK_INTERVAL !== 0) continue;`).
   Distant citizens still drift and are in plausible positions when the player
   arrives; nobody can see the coarser stepping. Name the constants
   (`FULL_UPDATE_RADIUS_TILES`, `DISTANT_TICK_INTERVAL`).
4. **`findNearestTownsperson`** (`townInteraction.ts`) is a linear scan with
   `Math.hypot` over all citizens, called from the render path every frame for the
   talk prompt. Query the grid with the talk radius and compare squared distances.
5. **`stepWander` allocation.** It returns a fresh `{dx, dy, moving}` object per
   person per frame. Change it to write into a caller-provided `out` parameter (the
   `SpatialGrid.queryRect(..., out)` convention already in the codebase).

**Acceptance:** plaza crowd looks and flows the same; talking to citizens works;
no townsperson walks through walls or stacks on another.

---

## Phase 5 — Rendering caches

The audit found the base tile layer already chunk-cached; the remaining render cost is
people, props, big building sprites, the decoration scan, chunk-bake hitches, and the
fog gradient. The in-repo model for every cache in this phase is
`fountainSprite.ts`'s `compositionFrames` memo — copy that structure.

### 5.1 Townsfolk frame cache (highest render win)

`src/sprites/person/drawPerson.ts`, `src/creatures/Townsperson.ts`.

Each visible townsperson is ~200 canvas path ops per frame; with 30–50 visible in the
plaza that dwarfs the entire tile layer. `drawPerson` output is deterministic in
`(appearance, facing, quantized walk phase, moving, size)`.

- **Step A (do first, trivial):** precompute the `shade()`/`tint()` derived colors
  into `PersonAppearance` at generation time (the pattern already exists —
  `face.skinShadow`). Removes ~500 string allocations/frame from `color.ts`.
- **Step B:** add a `personFrameCache` module beside `drawPerson`: for a given
  appearance, lazily render each needed cell (4 facings × 8 quantized walk phases ×
  moving/idle) into a small offscreen canvas via the _unchanged_ `drawPerson`, then
  blit with one `drawImage`. Hold the canvases in an LRU capped by a named constant
  (e.g. `MAX_CACHED_PEOPLE = 40`, ~64×64 cells → low tens of MB). `Townsperson.render`
  (and the market vendors, which render through the same path) call the cache instead
  of `drawPerson` directly.
- Quantize phase with a named constant `WALK_PHASE_BUCKETS = 8` — visually invisible.
- Keep `drawPerson` itself untouched as the builder; the genome art stays readable.

### 5.2 Town prop caches + kill `shadowBlur`

`src/systems/TownDecorSystem.ts`, `src/sprites/town/*` (clutter, shop signs, street
lamps, gate arch).

- `ClutterProp` painters are deterministic in `(kind, tileSize)` — bake each kind
  once into an offscreen canvas at construction; `render` becomes one `drawImage`.
- `StreetLampProp` and `ShopSignProp` animate — quantize (e.g. 8 flicker levels,
  12 sway steps, named constants) and cache one canvas per step, shared across all
  props of the same kind/emblem.
- Replace the lamp's `ctx.shadowBlur` halo (and the gate-arch glow in
  `townWayfinding.ts`) with a pre-baked radial-gradient sprite drawn with
  `globalCompositeOperation = 'lighter'`. `shadowBlur` is the single most expensive
  2D canvas operation and lamps line every lit street.

### 5.3 Cache large sprite buildings

`src/map/TileRenderer.ts` (`OverlayTileCache`, `CACHEABLE_OVERLAY_TYPES`).

`SPRITE_BUILDING` and `MAIN_TOWER` are excluded from the overlay cache and re-drawn
as large _scaled_ `drawImage` calls from full-res sheets every frame (the tower
overhangs 688 px). Add them to the overlay cache keyed by
`(type, tx, ty, animationFrame)` so the scale/resample happens once per frame variant.
Extend the cache's overhead computation to cover the sprite's full above-tile extent.

### 5.4 Decoration scan: per-type extents + static list

`src/map/GameMap.ts` (`getVisibleDecorationTiles`), `src/core/SpriteLoader.ts`
(`getMapSpriteExtentsPx`), `src/systems/RenderPipeline.ts`.

The scan widens the viewport by the **global worst-case** sprite extent (21.5 tiles
up, 10 right) for _every_ tile type → ~2.4–3× overscan, hundreds of fresh object
literals per frame, and off-screen `drawImage` calls that paint zero pixels.

- Build the decoration tile list **once per map** (it is static except for
  `damageStage` on destructibles — handle those via the existing dirty-tile flow),
  sorted/bucketed by tile row.
- Per frame, iterate only the buckets intersecting the viewport widened by a
  **per-tile-type extent** (trees/torches/wells need ~1 tile; only the tower, club,
  and Big Top need the huge margins — keep those few in a small always-checked list).
- Emit results into the caller's pooled `DrawEntry` mechanism (or a reused `out`
  array) instead of allocating a fresh array of fresh objects.
- While here: change `OverlayTileCache`'s per-frame `` `${type}_${tx}_${ty}` `` string
  key to a numeric key, and add `OverlayTileCache.invalidateTile` wired into the
  existing `_dirtyTiles` loop in `GameMap.renderCanvas` (today only the chunk cache is
  invalidated — a latent bug for destructible walls).

### 5.5 Chunk cache: bake budget + LRU cap

`src/map/TileRenderer.ts` (`TileChunkCache`).

- **Bake budget:** in `renderVisible`, bake at most **one** cold chunk per frame; for
  other cold chunks, fall back to the direct per-tile draw path that already exists in
  `renderCanvas`. Optionally pre-bake one ring of off-screen chunks (one per frame)
  so scrolling rarely meets a cold chunk.
- **LRU cap:** evict chunks farthest from the viewport beyond a named cap (e.g.
  `MAX_CACHED_CHUNKS = 60`); a fully explored 280×280 town currently retains ~324
  chunks ≈ 340 MB of canvas backing store.

### 5.6 Visibility fog without per-frame gradient

`src/systems/RenderPipeline.ts` (`renderVisibilityFog`): bake the radial-gradient
disc to an offscreen canvas once (it depends only on the two radii), then per frame
draw it centered on the player and fill the four rectangles outside it with solid
black. Same visual, one blit + four fills instead of a full-canvas gradient fill.

### 5.7 Y-sort: merge pre-sorted statics

`src/systems/RenderPipeline.ts` (`renderEntities`): the full entry list (dominated by
static decorations, 1–2.5k entries) is re-sorted every frame. Once 5.4's static
decoration list exists (already in row order = sorted by `sortY`), merge it with the
small dynamic list (mobs + people + props, usually < 100, sorted separately) instead
of sorting everything. Also cull treasure chests with the same rect test mobs use
(they are currently pushed unculled).

**Acceptance for Phase 5:** the plaza at 1080p renders with no visible difference
(people, lamps, signs, fountain, tower, fog edge), and scrolling across town produces
no chunk-bake hitches.

---

## Phase 6 — Allocation churn and per-frame sweep cleanup

Individually small; together they remove most steady-state GC pressure. Use in-place
mutation patterns that already exist in the codebase (GoreSystem's swap-pop,
RenderPipeline's pools) so the style stays consistent.

### 6.1 Status effects and temp stat mods

`src/Player.ts`: `tickStatusEffects` and `tickTempStatMods` call `.filter(...)`
every frame per entity — 2 array + 2 closure allocations each, almost always over an
empty list, for every active mob and player. Add an early return on empty, and filter
in place with a reverse-index loop. Rewrite `hasStatus` as a plain `for` loop (it
currently allocates a closure via `.some` and is called several times per entity per
frame).

### 6.2 Typed mob sub-lists instead of full-list `instanceof` sweeps

Maintain small arrays built at spawn/death (the pattern already exists —
`DungeonScene`'s `grotesqueSpiders`):

- `MobUpdateLoop`: BrindleGrub evolution pre-pass and `requiresEvasion` sweep.
- `DungeonScene`'s audio-flag block (four chained `instanceof` checks per mob for
  Hoarder/Juicer/BallOfSwine/KrakarenClone) and `playMobAudioCues` in
  `GameLoopPhases.ts`: replace the per-frame full-list walks with a
  `pendingAudioMobs` list mobs push themselves onto when they set a sound flag, or
  fold the checks into the existing `audioTag` switch — one walk, no `instanceof`.
- `CircusQuestSystem` / `BigTopBossSystem`: cache `inkMarauders` at spawn and assign
  `allMobs` once, not per frame (partially covered by 0.2's guard).

### 6.3 Route remaining proximity scans through the mob grid

Each of these currently scans **all** mobs with `Math.hypot` per frame; each should
use `mobGrid.queryCircle` (grid is already available in their contexts) and compare
squared distances:

- `CatPlayer.updateMissiles` missile homing (per missile × all mobs — worst offender
  while missiles fly).
- `CompanionSystem`: the "mob targeting a player" finds and `fleeFromAvoidMobs`.
- `MiniMapSystem` mob radar dots.
- `BarrierSystem` slow-zone application (barrier × all mobs).
- `DungeonUIRenderer` hover-tooltip mob lookup.

### 6.4 Squared-distance comparisons

Where the audit found `Math.hypot` used purely for threshold compares, gate on
`dx*dx + dy*dy < r*r` first (compute the sqrt only when actually needed for a
direction/magnitude): `MobUpdateLoop` separation and player push, `TownLifeSystem`
separation, `LootSystem` pickup/render checks. Follow `SpatialGrid.queryCircle`'s
existing style.

### 6.5 Reusable per-frame scratch

- `MobUpdateLoop`: promote `playerTargets`, the separation arrays (`seps`,
  `sepSeen`, `preX`, `preY`), and the per-retaliation `[...playerTargets, mob]`
  array to persistent fields cleared per frame; reuse an `out` Set for
  `queryCircle`.
- `DungeonScene`: build the `SystemContext` once per frame into a persistent mutable
  object (it is currently built twice, each with a closure-allocated
  `extraTargets` array); same for the combat context and `RenderContext`; replace the
  per-frame `[[human, 'Human'], [cat, 'Cat']]` tuple array and the quest-marker
  spread `[...a, ...b, ...c]` with persistent reused arrays.
- `LootSystem`: merge the pickup and TTL passes into one loop, compact in place
  (swap-pop) instead of the per-frame `.filter()`, and hoist the `party` array out
  of the per-loot loop.
- `AmbientSoundSystem`: hoist the per-frame `new Map()` to a field cleared each
  frame.

### 6.6 Gore caps and culling

`src/systems/GoreSystem.ts`: add `MAX_PARTICLES` / `MAX_PUDDLES` caps that drop the
oldest on overflow (mirroring the existing `MAX_SETTLED_PARTS`), and skip
`drawImage` for particles/puddles outside the camera rect.

### 6.7 Misc cheap fixes

- `BuildingSystem`: replace the per-frame `findIndex` over door entries with a
  `Map<number, entryIndex>` keyed by packed tile index, built in the constructor.
- `StairwellSystem`: reuse `GameMap.isStairwellTile` (Phase 1 bitmask) instead of its
  own linear scan.
- Creature renderers: 27 creatures assign `ctx.filter = 'none'` unconditionally every
  frame; set/reset `filter` only inside the damage-flash branch.
- `drawText` (`src/ui/TextBox.ts`): memoize the built font string (≈10 distinct
  combinations exist), skip the `split('\n')` when the text has no newline, and skip
  the `ctx.font` assignment when unchanged from the last call (track it in a module
  variable). Do **not** attempt the full offscreen-HUD rewrite — it's not worth the
  churn yet.

### 6.8 Shop-exit hitch: cache town derivations on the map

Exiting a building reconstructs `TownLifeSystem` / `TownPropSystem` /
`TownDecorSystem`, which re-run two full 78,400-tile scans (`findTilesOfType(WELL)`,
prop placement sweep) → a ~200 ms hitch at every shop door. The `GameMap` instance
survives the round-trip (`existingMap`), so cache the derived tile lists on it
(compute once, reuse on reconstruction). Keep the cache fields clearly named (e.g.
`cachedWellTiles`) and document on them why they exist.

---

## Phase 7 — Verification

1. All gates: `npm run typecheck`, `npm run lint`, `npm run format`.
2. Manual smoke test on level 3: walk from spawn through the plaza to the market,
   enter and exit a shop, aggro a ghoul pack near the ruins, talk to a citizen, check
   the minimap expanded/collapsed, and confirm the fountain/torches/lamps/signs look
   unchanged.
3. Manual smoke test on level 1: melee + missile combat, boss room lock/unlock,
   dynamite throw, loot pickup, stairwell descent.
4. Profile before/after in Chrome DevTools Performance panel (10 s standing in the
   plaza, 10 s walking through town): scripting time, GC events, and dropped frames
   should all be visibly reduced. Record the numbers in the checklist file.

---

## Expected impact summary

| Change                          | Kind of win                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phase 1 walkability bitmask     | Removes the game's dominant GC source; speeds movement, A\*, LOS, townsfolk simultaneously; kills level-load hitch |
| Phase 2 A\* overhaul            | Removes the visible frame spikes (mob packs, unreachable targets)                                                  |
| Phase 0.4 catch-up cap          | Stops spikes compounding into multi-update death spirals                                                           |
| Phase 5.1/5.2/5.3 render caches | Recovers the majority of plaza frame time (people + props + buildings)                                             |
| Phase 5.5 chunk budget/LRU      | Removes scrolling hitches and ~300 MB memory                                                                       |
| Phases 4 & 6                    | Removes steady-state churn: O(N²) crowd pass, all-mob sweeps, per-frame allocations                                |
