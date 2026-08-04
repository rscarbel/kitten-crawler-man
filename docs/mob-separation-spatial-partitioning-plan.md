# Mob Separation: O(k²) → ~O(k) Plan

Goal: replace the all-pairs mob separation pass with a grid-neighbor query so
frame cost scales with local density instead of the square of active-mob
count, enabling meaningfully larger concurrent mob counts (e.g. the 2x-spawn
idea from the difficulty discussion) without a framerate cliff in dense
clusters.

Non-goals: this plan does **not** touch combat/projectile collision
(`CombatSystem.ts`) or interactable-scenery lookup (chests, props, quest
NPCs) — investigation below shows both are already cheap enough that
converting them would not produce a measurable win. Those are covered in
§6/§7 as "why not," not "how."

---

## 1. What's actually O(N²) today (measured from the code)

The codebase already uses `src/core/SpatialGrid.ts` (a cell-hashed
`Map<number, Set<T>>`) extensively — 20+ call sites across `CombatSystem.ts`,
`SpellSystem.ts`, `CompanionSystem.ts`, `MiniMapSystem.ts`,
`RenderPipeline.ts`, etc. all resolve "nearby entities" via
`mobGrid.queryCircle(...)`, bounded by a small radius. **Only one place in
the whole simulation does a genuine all-pairs scan**, and the code's own
comment already flags it:

`src/systems/MobUpdateLoop.ts:171-175,240-291` — `runSeparationPass`:

```ts
for (let i = 0; i < seps.length; i++) {
  for (let j = i + 1; j < seps.length; j++) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= SEP_DIST_SQ) continue;   // SEP_DIST = TILE_SIZE (1 tile)
    ...
  }
}
```

Called twice per frame (`MobUpdateLoop.ts:176-193`): once over ground mobs,
once over flying mobs. `seps` is drawn from `activeMobs`, which is already
spatially filtered to mobs within `AI_RADIUS_TILES = 22` of either player
(`MobUpdateLoop.ts:97-98`) — so this isn't O(all mobs in the level)², it's
O(k)² where k = active-mob count near a player. That's still the dominant
cost of doubling spawn density, because doubling k quadruples this specific
pass while every other system in the frame stays linear.

**One more, much smaller, instance of the same pattern**:
`src/systems/BossRoomSystem.ts:837-847` (`tickCockroachTTLs`) loops the full
boss-room mob list inside a loop over the full boss-room mob list, to find
and clean up dead Cockroaches. N here is a single boss encounter's roster
(small, bounded), so this is a correctness/tidiness fix, not a performance
target — see §8.

**Confirmed NOT a problem** (so the plan doesn't waste effort here):

- `CombatSystem.ts` melee/AoE/missile hit-tests all call
  `mobGrid.queryCircle(origin, radius)` — bounded by attack/blast/hit radius,
  not mob count (lines 99, 140, 196, 301, 322, 440).
- Per-creature projectile systems (skeleton arrows, spider spit, Juicer
  throw, Hoarder vomit) target only the 2 players, never scan mobs — O(1)
  per projectile.
- `ClownGasSystem`/`LavaBallSystem`/`RockThrowSystem`/`SkeletonProjectileSystem`'s
  `collect*` passes are O(N) linear scans of the full mob list once per
  frame (not pairwise) — cheap even at high mob counts.

---

## 2. Why a naive "reuse `mobGrid`" doesn't work

`mobGrid`'s cell size is `TILE_SIZE * SPATIAL_GRID_CELL_SIZE_MULTIPLIER`
(`DungeonScene.ts:470`, `BuildingInteriorScene.ts:177`), and the multiplier
is `4` — so cells are **4 tiles** wide. The separation force radius
(`SEP_DIST`) is **1 tile** (`MobUpdateLoop.ts:20`). If separation queried
`mobGrid` directly with `queryCircle(x, y, SEP_DIST)`, the grid would still
only scan the ~1-2 cells overlapping that small radius — so it wouldn't be
_wrong_, but each of those 4-tile cells can contain far more mobs than are
actually within 1 tile, so the win over brute force would be modest, not the
full O(k) we want. `mobGrid`'s cell size is tuned for its dominant use case
— the `AI_RADIUS = 22`-tile activation query, run twice a frame regardless
of mob count — and shrinking it globally to 1 tile to suit separation would
make _that_ query iterate ~16x more (smaller) cells, trading one hot path's
cost for another's.

**Conclusion: separation needs its own grid, sized to its own radius.**

---

## 3. Design

### 3.1 A second, fine-grained grid

Add one (or two — see flying/ground split below) additional
`SpatialGrid<Mob>` instance(s) dedicated to separation, with **cell size =
`SEP_DIST` (1 tile)**, alongside the existing `mobGrid`. This is a small
addition, not a rewrite of `SpatialGrid` itself:

- No new method is needed on `SpatialGrid`. `queryCircle(x, y, SEP_DIST)`
  against a grid whose cell size equals `SEP_DIST` naturally scans "own cell
  - up to 8 neighbors" — that's exactly what `queryCircle`'s existing
    min/max-cell bounding-box loop does (`SpatialGrid.ts:62-81`) when radius ≈
    cell size. The earlier framing of "we need a neighbor-iteration method"
    turned out to be unnecessary once the grid is sized correctly; the
    mismatch was the cell size, not the API.
- Ground and flying mobs already get separated into two pools before the
  existing pairwise pass (`MobUpdateLoop.ts:176-193`, so they don't push
  each other). Keep that split: either two grid instances
  (`separationGridGround`, `separationGridFlying`) or one grid with a
  post-query type filter. Two instances is simpler to reason about and
  avoids filtering candidates that were never going to interact; recommend
  two instances since insert/remove/move cost is already paid once per mob
  regardless.

### 3.2 Bookkeeping cost this adds

Every mob already gets `mobGrid.move()` called on it once per frame when its
position changed (`MobUpdateLoop.ts:168,224`). This plan adds a second
`separationGrid.move()` call at the same call sites (or a small wrapper that
updates both grids together, to avoid a second place values can drift out of
sync — see §5 gotcha). That's an extra `Map` bucket removal + insertion per
moving mob per frame: cheap (O(1) amortized), but not free, and it's the
honest cost side of this plan's ledger — see §9 for when it's _not_ worth
paying.

Spawn/despawn sites (`DungeonScene.ts` — ~10 `insert` call sites,
`CombatSystem.ts`/`MobUpdateLoop.ts` removal on death) need the same
mirrored `insert`/`remove` treatment. Because `mobGrid` insert/remove is
already threaded through every spawn/death path, the mechanical work here is
"call the second grid's method next to the first," not "find every place a
mob's lifecycle changes" from scratch.

### 3.3 The query replacing the pairwise loop

Per active mob `a`:

```ts
const neighbors = separationGrid.queryCircle(a.x, a.y, SEP_DIST, scratchSet);
for (const b of neighbors) {
  if (b === a) continue;
  // same distSq / force math as today, applied to `a` only
}
```

This computes `a`'s net separation force from its own local neighbors. Doing
this independently per mob (rather than the current "compute once per pair,
apply to both" shape) means the same pair gets evaluated from both sides —
each of `a`'s and `b`'s perspectives once — which is 2x redundant force-math
versus today's dedup'd pair loop, but that 2x constant factor is trivial
compared to going from O(k²) to O(k·d) where d = local density (typically
small — a handful of mobs can physically occupy a 1-tile neighborhood before
collision/pushback already spreads them out). Reuse a scratch `Set` (the
`out` param `SpatialGrid.queryCircle` already supports) to avoid an
allocation per mob per frame — this pattern is already used elsewhere in the
codebase (`this._querySet` etc.), so it's consistent with existing style.

If exact pair-dedup (no 2x redundant math) is wanted instead: keep a
stable numeric id per mob and only apply force to `a` when `a.id < b.id`,
skipping otherwise. Optional — worth trying the simple symmetric version
first and only adding this if profiling shows the redundant math matters,
since it adds a comparison per neighbor for a constant-factor saving.

### 3.4 Complexity result

- Before: O(k²/2) per pass, k = active mobs.
- After: O(k · d), d = average mobs within 1 tile of a given mob — bounded
  by physical crowding, not by k. In a 40-mob dense cluster today that's
  ~780 pair evaluations; with d≈4-5 (a generous crowding estimate) that's
  ~160-200 — a 4-5x reduction at that density, and the gap **grows** as k
  grows, since d saturates (physical space + existing push-apart force caps
  how many mobs can occupy one tile-radius) while k² doesn't.

---

## 4. Migration steps

1. Add `SEPARATION_GRID_CELL_SIZE = TILE_SIZE` and instantiate
   `separationGridGround`/`separationGridFlying` alongside `mobGrid` in
   `DungeonScene.ts` and `BuildingInteriorScene.ts` (same construction sites
   as `mobGrid`, `DungeonScene.ts:942,2767`, `BuildingInteriorScene.ts:584`).
2. Thread insert/remove/move calls next to every existing `mobGrid`
   call — grep `mobGrid.insert`, `mobGrid.remove`, `mobGrid.move` for the
   full call-site list (roughly a dozen spawn sites in `DungeonScene.ts`,
   plus `MobUpdateLoop.ts:168,224` for moves, plus death/despawn cleanup in
   `CombatSystem.ts`/`MobUpdateLoop.ts`). Route ground vs flying mobs to the
   matching grid instance (the existing `isFlying` filter used at
   `MobUpdateLoop.ts:176-184` tells you which).
3. Rewrite `runSeparationPass` (`MobUpdateLoop.ts:240-291`) to query the
   separation grid per mob instead of the pairwise loop, per §3.3.
4. Consider a single shared helper (e.g. `moveMobInGrids(mob, oldX, oldY)`)
   that updates both `mobGrid` and the relevant separation grid together, so
   the two never drift out of sync from a missed call site — this is worth
   doing regardless of micro-perf, as a correctness safeguard (see gotcha in
   §5).
5. Add temporary instrumentation (see §9) to measure before/after at a
   controlled mob density, then remove or gate it behind a debug flag.
6. Playtest a dense scenario (many active mobs in one room/camp) — `[HUMAN]`
   gate, since frame-pacing feel isn't verifiable from code alone.

---

## 5. Correctness gotchas to watch for

- **`SpatialGrid`'s cell-key packing doesn't support negative coordinates**
  (`SpatialGrid.ts:2,15-17`, packs as `cx * MAX_CELL_COORD + cy` with no
  offset/bias). Confirm mob world coordinates are always non-negative in
  this codebase (tile-indexed from 0, which appears to hold today) before
  relying on a second grid instance — this isn't new risk introduced by this
  plan, `mobGrid` already has the same limitation, but it's worth a one-line
  sanity check since a new grid is new surface area for the same bug class.
- **Grid drift**: two grids tracking the same mob's position must both be
  updated on every move/spawn/despawn. A missed call site produces a mob
  that separation logic can't see (or sees a stale position for) while
  `mobGrid`-based systems (AI activation, combat targeting) still work fine
  — a subtle, hard-to-notice bug. This is exactly why §4 step 4 (a shared
  move/insert/remove helper) is worth the small refactor.
- **Boundary quantization**: `queryCircle`'s cell-span math already handles
  radius vs. cell size correctly (it computes the cell bounding box from
  `cx - radius` to `cx + radius`, not just the mob's own cell), so a mob
  near a cell edge still finds neighbors in the adjacent cell — verify this
  behavior explicitly in a unit test for the separation grid specifically,
  since a regression here would silently under-count neighbors near cell
  boundaries rather than throwing.
- **Force-application symmetry change**: today's pairwise loop applies a
  single mass-weighted force computation to both `a` and `b` from one
  distance calculation. The per-mob-independent version (§3.3) computes it
  twice (once from each side) — verify the resulting motion is
  visually/numerically equivalent (same mass-weighting formula, evaluated
  from both perspectives, should net out the same), not just "compiles."

---

## 6. Why NOT extend this to combat/projectile collision

Investigated and explicitly ruled out — not because it's a bad idea in the
abstract, but because it's already done:

- Every melee/AoE/missile hit-test in `CombatSystem.ts` already calls
  `mobGrid.queryCircle(origin, attackRadius)` — bounded by the attack's own
  radius, independent of total mob count. There's no O(N) or O(N²) scan to
  fix there.
- The one loop-shaped construct (`CombatSystem.ts:256`, iterating in-flight
  missiles) scales with missile count × a small bounded query per missile,
  not missile count × mob count. Missile count itself has no hard cap
  (bounded implicitly by fire cooldown), but doubling mob count doesn't
  multiply this cost — doubling _missile_ count would, and that's a
  separate, unasked-for lever.

---

## 7. Why NOT extend this to interactable-scenery detection

The idea (bonus efficiency for "what can the player interact with nearby")
was worth checking, but the numbers don't support it as a priority:

- `TreasureChestSystem.tryInteract` (`TreasureChestSystem.ts:183-220`),
  `TownPropSystem`, and each quest system's `tryInteract` all do a flat
  linear scan over their own small per-level list (chests, props, quest
  objects — typically dozens, not hundreds).
- All of them run **on Space-press**, not every frame — so even at current
  O(M) cost, this is a one-time-per-keypress scan, not a per-frame
  simulation cost. Converting it to a grid query would save microseconds on
  an input that already happens at most a few times a second.
- The one interactable-style lookup that already **is** grid-accelerated is
  `TownLifeSystem.findTalkTarget` (`TownLifeSystem.ts:306-310`), which reuses
  a dedicated `SpatialGrid<Townsperson>` — this is the existing precedent to
  follow _if_ prop/chest counts per level ever grow into the hundreds, but
  there's no evidence that's the case today.

**Recommendation**: skip this for now. If a future level design pushes
interactable counts much higher (e.g. a town square with 100+ clickable
props), revisit using the same `SEP_DIST`-style dedicated grid pattern
established here — the infrastructure this plan adds (a second lightweight
`SpatialGrid` alongside `mobGrid`) is a template, not a one-off.

---

## 8. Small, separate fix: `BossRoomSystem` cockroach O(N²)

`BossRoomSystem.ts:837-847` (`tickCockroachTTLs`) nests a full mob-list loop
inside a full mob-list loop to find dead `Cockroach` instances. N is a
single boss encounter's roster (small, bounded by
`spawnHoarderCockroaches`), so this is not a performance target — but it's
a one-line correctness/clarity fix (filter to `Cockroach` instances once,
outside the loop, instead of re-scanning `mobs` for each `mob`) worth doing
in the same pass since it's the same code smell. Track separately from the
main separation-grid work so it doesn't block on playtesting.

---

## 9. Measuring the win (no existing instrumentation)

**There is currently no FPS counter, frame-time overlay, or profiling
instrumentation anywhere in the codebase** (confirmed by search — only a
cached `frameTime` clock at `src/utils.ts:106-111` for animation phase math,
not measurement). This plan needs its own before/after evidence:

1. Add a temporary `performance.now()` wrap around `runSeparationPass`'s two
   calls (`MobUpdateLoop.ts:176,185`), logging total ms/frame spent there,
   gated behind a debug query param (matching the existing `?tiles`/`?bopca`
   debug-route convention in this codebase).
2. Measure at a few controlled active-mob counts (e.g. 10, 25, 50 — spawn
   density can be forced via a debug boot path, similar to
   `src/dev/devBoot.ts`/`playtestBoot.ts`) to get a real before/after curve,
   not just a single anecdotal number.
3. **Important honesty check**: at low active-mob counts (roughly under
   ~15, based on the `d` estimate in §3.4), the brute-force O(k²) pass is
   already cheap in absolute terms, and the grid version pays its own
   constant-factor cost (hash-map bucket lookups, `Set` iteration) that a
   plain array double-loop doesn't. **The win is concentrated in dense
   clusters, not a flat improvement "at fairly low numbers too."** If
   measurement shows the grid version is actually slower below some
   threshold, the cleanest fix is a size-gated dispatch: brute-force for
   `seps.length` under a threshold, grid-based above it — cheap to add,
   avoids regressing the common case to "optimize" the rare one.
4. Once validated, decide whether to keep the debug instrumentation behind
   a permanent flag (useful for future spawn-density tuning) or strip it —
   lean toward keeping a minimal on-screen frame-time overlay gated by a
   debug route, since this codebase has no perf visibility at all today and
   the difficulty-rebalance work in flight (`docs/difficulty-plan.md`) will
   likely want it again.

---

## 10. Summary

| Item                                            | Verdict                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mob separation pass (`MobUpdateLoop.ts`)        | **The real target.** Dedicated fine-grained `SpatialGrid<Mob>` sized to `SEP_DIST`, existing `queryCircle` API is sufficient, no new `SpatialGrid` method needed.                                                                                 |
| Combat/projectile collision (`CombatSystem.ts`) | Already grid-accelerated — no work needed.                                                                                                                                                                                                        |
| Interactable scenery (chests/props/quests)      | Flat O(M) scans, but M small and event-driven (Space-press), not per-frame — skip unless prop counts grow substantially.                                                                                                                          |
| `BossRoomSystem` cockroach TTL loop             | Small separate O(N²), tiny N — one-line fix, unrelated priority.                                                                                                                                                                                  |
| Expected win                                    | Large in dense clusters (grows with k), negligible-to-slightly-negative at low active-mob counts — needs the size-gated fallback in §9 to avoid regressing the common case.                                                                       |
| Cost                                            | One more `SpatialGrid` instance (or two, ground/flying) + mirrored insert/remove/move calls at every existing `mobGrid` call site; risk is mostly "a call site gets missed and two grids drift," mitigated by a shared move/insert/remove helper. |
| Instrumentation                                 | None exists; must be added temporarily to validate this plan at all, and is worth keeping given the difficulty-rebalance work already in flight.                                                                                                  |
