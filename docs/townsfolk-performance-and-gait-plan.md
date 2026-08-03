# Townsfolk: Performance and Gait Plan

Two problems, one cast of characters. The Over City crowd is the slowest thing in
the game, and its walk is the least convincing animation in the game. This
document diagnoses both, ranks the routes, and lays out a phased fix.

**Scope:** `src/sprites/person/*`, `src/creatures/Townsperson.ts`,
`src/creatures/townWander.ts`, `src/systems/TownLifeSystem.ts`, and the
`personFrameCache`. The town's _map_ rendering (chunk cache, decoration overlay,
Y-sort) is already optimized and is explicitly **not** the target — see
[Measurements](#measurements) for why.

---

## Read this first if you are implementing

- **Progress lives in [Progress Tracker](#progress-tracker) at the bottom of this
  file.** Update it as you go — it is the only handoff between sessions.
- **Other agents are running against this repo at the same time.** See
  [Working alongside other agents](#working-alongside-other-agents). The short
  version: never `git stash`, never revert files you did not touch, re-read a
  file immediately before editing it, and keep your edits inside this plan's
  scope files.

---

## Measurements

Taken 2026-08-02 with `node-canvas` at the real draw size
(`TILE_SIZE 32 × HUMANOID_NPC_SCALE 1.4 = 44.8 px`). node-canvas is not Skia, so
treat the absolute milliseconds as an order of magnitude and the **ratios** as
solid.

| Measurement                       | Result                              |
| --------------------------------- | ----------------------------------- |
| One `drawPerson` call             | **0.093 ms**                        |
| One cached cell blit              | **0.0063 ms** (**14.7× cheaper**)   |
| 40 people, every one a cache miss | **3.7 ms/frame** at 1× device scale |
| 40 people, every one a cache hit  | **0.25 ms/frame**                   |

A cell is 57 × 61 CSS px at the current padding fractions. Its cost in cache
memory, and what a full 64-cell set per person implies:

| Device scale | One cell | 64 cells (one person) | 40 people  |
| ------------ | -------- | --------------------- | ---------- |
| 1×           | 13.6 KB  | 0.85 MB               | **34 MB**  |
| 2× (retina)  | 54.3 KB  | 3.40 MB               | **136 MB** |
| 3×           | 122 KB   | 7.64 MB               | 306 MB     |

`CACHE_BYTE_BUDGET` is **24 MB** (`personFrameCache.ts:45`).

### What that means

The cache budget is 24 MB. A retina display with 40 townsfolk on screen wants
somewhere between 65 MB (a realistic ~30 cells used per person) and 136 MB
(every cell). **The working set is 3–6× the budget.**

Eviction is plain LRU, re-inserted on every draw (`framesFor` deletes and
re-sets on each call). When the working set exceeds the budget, LRU is the
worst possible policy: the person evicted to make room is the one drawn earliest
this frame, who will be drawn again next frame and rebuild everything. Hit rate
collapses toward zero and **every visible citizen pays close to the full
`drawPerson` price every frame** — plus the allocation churn of continuously
creating and discarding `OffscreenCanvas` objects, which feeds the GC.

That is the lag. The population makes it worse: `TownLifeSystem` seeds 18 plaza
citizens, 12 travelers, 1–2 loiterers per building door, and ~7 activity
anchors, and `MarketSystem` adds stationed vendors on the same map — comfortably
past the `MAX_CACHED_PEOPLE = 40` head-count cap on its own, before the byte cap
is even reached.

One amplifier worth naming: `Scene.loop` runs two `update()` calls per rAF
callback when it is catching up. Once the town drops below target frame rate, the
crowd's update cost doubles, which is a feedback loop into the same stall.

### Why the map is not the suspect

Checked and cleared: `GameMap` has a chunk-baked ground cache, an overlay cache,
a memoized `tilesOfType`, a reused visible-decoration array, and reused A\*
scratch buffers. `RenderPipeline` uses a pooled `DrawEntry` list with no
per-frame closures and viewport-culls townsfolk before they cost a sort entry.
`TownDecorSystem.update()` increments a frame counter and nothing else. There is
no `shadowBlur`, `ctx.filter`, or per-frame gradient construction anywhere in
the town render path.

Phase 0 still measures before anything is built, because this reasoning is
analytic and a real profile can always surprise you.

---

## Verdict on the sprite-sheet idea

> _"I was wondering if making spritemaps for them and then coloring in the
> details would work."_

Right instinct, slightly wrong target — and the good version of it is better
than the original idea.

**Why the plain version does not help.** You already have a runtime spritesheet:
`personFrameCache` bakes each person's frames into offscreen cells and blits
them. Baking those cells offline into a PNG instead would remove the _bake_
cost, but the bake cost is not what is hurting — the _memory_ is, and it would
be identical. Worse, finished figures cannot be shared: the genome crosses ~10
hair styles × 5 facial-hair × 5 tops × 3 bottoms × 4 hats ≈ 3,000 style
combinations before body proportions and colors, so a sheet of finished people
is not a sheet you can bake.

**Why the layered version is very good.** Bake each _region_ independently as a
shape mask — limbs/skin, top, bottom, hair, hat, shoes — and colorize at
composite time. Layers combine **additively** instead of combinatorially: 10
hair masks plus 5 top masks, not 50 combined cells. Color variety stays
unlimited because color is applied at runtime, and shape variety collapses to a
handful of body archetypes, which is the only thing you actually trade away.

The payoff is not a faster steady state — a cache hit is already one `drawImage`
and cannot be beaten. The payoff is that **a cache miss becomes ~6 blits instead
of ~100 path operations**, measured at roughly 15× cheaper. That makes the
memory ceiling stop mattering: you can run a small cache, evict freely, and
cache misses cost almost nothing.

So: yes to sheets, as **layer masks**, not finished figures — and as Phase 3,
because Phase 1 gets most of the frame time back for a fraction of the work.
Bake them at runtime into memory first; only ship them as offline PNGs (Phase 3b)
if Phase 0's re-measure says the startup bake is too slow.

---

## Performance routes

### Route 1 — Make the cache fit (recommended, do this first)

Shrink the per-person footprint until 45 people fit in budget, and replace the
thrashing eviction policy.

| Change                                                                                                                                                                                                                                    | Saving                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **1a. Bake 3 facings, mirror `left` at blit time.** `drawPerson` already treats `left` as a mirror of `right` (`drawPerson.ts:612`); the cache re-bakes it as its own cell for nothing. Blit with a `scale(-1, 1)`.                       | −25% cells                  |
| **1b. Idle needs 2 buckets, not 8.** `IDLE_BOB_AMP` is 0.01 of draw size — 0.45 px of travel across the whole idle cycle, stored as 8 near-identical cells.                                                                               | −38% of the remaining cells |
| **1c. Per-appearance cell bounds.** `CELL_TOP_FRACTION = 0.28` exists for a mohawk on a tall genome, and every bald citizen pays it. Derive the box from the genome (hair style, hat, `heightScale`) instead of worst-casing all of them. | ~−40% area                  |
| **1d. Cap the bake scale at 1.5×.** These are background figures; a 45 px person sampled at 1.5× is 67 px of detail. Needs an eyeball check against 2× before committing.                                                                 | −44% bytes vs 2×            |
| **1e. Admission-stop instead of LRU-evict.** When over budget, stop _admitting_ new cells and keep the cache intact, drawing the overflow directly.                                                                                       | Removes the cliff           |

1a–1d together take a person from 64 cells × 3,477 px to ~30 cells × ~2,000 px —
about **3.7× smaller** — and 1d takes another 44% off at retina. Estimated 40
people at ~21 MB, inside the existing budget.

**1e matters even alone.** Today, when the working set overflows, _everyone_
degrades. With admission-stop, a stable subset keeps blitting at 0.006 ms and
only the overflow pays 0.093 ms. A cliff becomes a slope.

Expected result: 40 townsfolk go from ~4 ms/frame (1×) or ~10 ms/frame (2×) to
~0.3 ms/frame.

### Route 2 — Population and LOD (small, do the cheap parts)

Rendering is already viewport-culled, and every citizen is the same size, so
distance LOD buys little. Two things are still worth doing:

- Cap the number of _newly baked_ people per frame, so a camera sweep into a
  crowded plaza amortizes its bakes over several frames instead of spiking one.
- `Townsperson.phase` grows without bound (`phase += 1` forever, never wrapped).
  Wrap it to the person's own cycle length. Minor, but it degrades `Math.sin`
  precision and `quantizePhase`'s modulo over a long session.

### Route 3 — Layered region masks (the good sprite-sheet idea)

As argued above. Bake per-archetype region masks once, composite per person with
`source-in` tinting into the person's cached cell. Cache miss drops ~15×.
Phase 3.

### Route 4 — Not recommended

- **Shipping finished-figure PNG sheets.** Combinatorial explosion; see above.
- **Reducing the crowd size.** The crowd is the feature. Fix the cost, not the
  content.
- **Raising `CACHE_BYTE_BUDGET` alone.** 136 MB of canvas memory gets a mobile
  tab killed, which is exactly what the existing comment says. It also does not
  fix the thrash, only moves it.

---

## The gait diagnosis

The player character is the reference. `scripts/generate-human-sprite.ts` drives
Carl's legs by **IK to a foot target**: `gaitFootSide` places the foot in world
space and the solver finds the knee (`ankleFor`, "pulls the knee back onto the
hip→ankle line"). Townsfolk do the structural opposite — **FK from the hip** with
a sinusoidal swing (`skeleton.ts:fkLimb`, `gait.ts:walkPose`). That single
difference is why Carl's walk is the only convincing one in the game: you cannot
plant a foot you do not control the position of.

Nine concrete defects, roughly in order of how much each one is costing you.

**G1 — Cadence is decoupled from speed.** `Townsperson.update()` does
`this.phase += PHASE_STEP` unconditionally, where `PHASE_STEP = 1`. Speeds range
from `ANCHOR_SPEED_MIN` 0.2 to `TRAVELER_SPEED_MAX` 1.0 px/frame — a **5× spread
at one identical leg cadence**. Anchors and loiterers moonwalk; travelers take
mincing steps. _Fix:_ advance phase by distance travelled, not by time —
`phase += distanceMoved / strideLength`. Two lines, and the single biggest
believability win available.

**G2 — No stance phase; the planted foot is not planted.** Both legs are pure
`±sin` swings, so the "planted" foot slides backward at a rate with no relation
to the body's forward speed. That is the skating read. _Fix:_ port
`gaitFootSide`'s structure — during stance the foot is world-locked and
translates linearly at exactly `−bodySpeed`; during swing it tucks, passes under
the hip, and reaches. Needs 2-bone IK to a foot target, or keyed swing/bend
tables per bucket (cheaper, and it fits the frame cache, which only ever
evaluates a fixed set of poses anyway).

**G3 — The body bob is inverted.** `gait.ts:72` is
`bob: Math.abs(swing) * BOB_AMP`, and `skeleton.ts:126` _subtracts_ bob from y.
The body is therefore **highest at maximum leg swing** (double support) and
**lowest at midstance** — the exact opposite of a real pelvis, which peaks over
the straight stance leg and troughs at contact. Carl gets this right and says so
at `generate-human-sprite.ts:408`. _Fix:_ invert it. **Verify the corrected sign
in a picture, not in your head** — this is the same class of error as
`carl-arm-swing-is-90-degrees-out-of-phase`, and it is easy to fix an inversion
into a different inversion.

**G4 — The knee curve is a rectified sine.**
`bend: KNEE_BASE + kneeAmp * Math.max(0, swing)` gives a derivative
discontinuity at every zero crossing (a visible hitch twice per stride), zero
knee flex during stance, and a bend that peaks at mid-swing. Real gait peaks the
swing knee shortly _after_ toe-off and extends it to near-straight before heel
strike, and dips the stance knee slightly at loading. _Fix:_ keyed curves, as
`keyed()` does in the Carl generator.

**G5 — There is no ankle, and the foot never rotates.** `drawFoot` paints an
axis-aligned ellipse and never pitches it. Its offset term is
`facing === 'right' ? 1 : facing === 'up' ? 0 : 0` — a ternary that can only
produce 1 or 0 and is 0 in every case but one. No heel strike, no toe-off roll.
Carl has `HEEL_STRIKE_PITCH`, `TOE_OFF_PITCH`, and `SWING_PITCH`, and the rat-kin
notes call the toe-off roll the thing that sold that walk. _Fix:_ a foot pitch
angle on the limb and a rotated foot.

**G6 — Arms are effectively dead in the front and back views.**
`ARM_SWING_FRONT` is 0.16 rad, then `FRONTAL_X_SCALE` (0.32) squashes it to
about 0.05 rad of visible travel. Head-on is most of what the player sees.
Carl's answer (`facingArmSwing`, `FACING_SHOULDER_TWIST`) is to sell the swing
through the shoulder and let the arm cross the body silhouette. _Fix:_ raise
front-view arm travel and add shoulder twist; do **not** simply raise
`FRONTAL_X_SCALE`, which is what stops the legs splaying sideways.

**G7 — Facing flickers.** `FACING_DEADZONE` is 0.05 px against citizens moving
0.2–1.0 px/frame. On a near-diagonal heading `|dx|` and `|dy|` trade places
frame to frame and the figure strobes between two views. _Fix:_ hysteresis — the
new axis must beat the current one by a margin — plus a minimum dwell time in a
facing.

**G8 — Eight phase buckets is 10.7 fps of leg animation.** The cycle is
`2π / (0.14 × strideScale)` ≈ 45 frames; 8 buckets is a pose change every 5.6
frames. Carl's walk is `WALK_FRAMES = 16`. _Fix:_ raise walk buckets to 12–16 —
but **only after Phase 1**, since buckets are exactly what the memory budget
buys.

**G9 — Every citizen shares one gait shape.** `strideScale`, `bounceScale`,
`armSwingScale`, `postureLean`, and `phaseOffset` are scalar jitter on a single
curve. Distinct gait _archetypes_ keyed off the `TownRole` that already exists —
a purposeful stride, a laden trudge, a child's quick trot, a drunk's stagger, a
beggar's shuffle — would do far more for crowd believability than scalar
variation, and cost nothing at runtime.

### Ordering constraint

G1 and G2 must land together. Distance-driven cadence (G1) without a locked
stance foot (G2) still skates; a locked stance foot without distance-driven
cadence locks it to the wrong velocity. They are one change.

---

## Phases

Each phase ends with the gates: `npm run typecheck`, `npm run lint`,
`npm run format`, all exit 0.

### Phase 0 — Measure (blocking; do not skip)

Confirm the analytic diagnosis with a real profile before building anything.

- [x] Add a dev-only counter to `personFrameCache`: cache hits, misses, bakes,
      evictions, and live bytes per frame. Surface it behind an existing dev
      flag; do not leave it on in production.
      → `src/sprites/person/personCacheStats.ts`. Recording is off until a dev
      harness calls `setPersonCacheStatsRecording(true)`; `PersonPreviewScene`
      is the only caller.
- [x] Add a `?people` harness mode, or extend `PersonPreviewScene`, that draws N
      distinct people and reports ms/frame — so the crowd can be exercised
      without walking to the plaza.
      → `?people` now has two modes. **Crowd stress** spawns real `Townsperson`
      instances (10–200, adjustable on screen) wandering a pen through the frame
      cache, and prints ms/frame, hit rate, bakes, direct draws, evictions,
      people cached and live MB.
- [ ] **[HUMAN]** Stand in the Over City plaza with ~35–40 citizens visible.
      Record: cache hit rate, evictions/frame, live cache bytes, `devicePixelRatio`,
      and a Chrome performance profile. Note whether `Scene.loop` is running two
      updates per callback.
      → Still outstanding. Everything a headless run can establish is in
      [Measured baselines](#measured-baselines); the browser profile is not one
      of them (an occluded tab stalls rAF to ~1 fps, so the timing needs a human
      at the keyboard).
- [x] Record the numbers in [Measured baselines](#measured-baselines) below.

**Gate:** if the hit rate is high and evictions are near zero, this whole
diagnosis is wrong — stop and re-profile before touching Phase 1.
→ The gate could not be closed in a browser, but it did not need to be: the
working set exceeding the budget is arithmetic, not a hypothesis. 64 cells of
3,477 px at a 2× device ratio is 3.40 MB per person against a 24 MB budget, so
eight citizens fill it and the ninth starts the treadmill. Phase 1 proceeded.

### Phase 1 — Make the cache fit

- [x] **1e first** (admission-stop eviction). It is the smallest change and the
      one that removes the cliff; landing it first makes every later phase
      measurable against a stable baseline.
      → `evictStale()` only reclaims people who were _not_ drawn this frame;
      when the budget still will not fit, `cellFor` returns `null` and
      `drawPersonCached` falls through to a direct `drawPerson`.
- [x] 1a — three baked facings, `left` mirrored at blit time.
- [x] 1b — idle drops to 2 buckets. Separate the bucket count for walk and idle
      rather than sharing `WALK_PHASE_BUCKETS`.
- [x] 1c — per-appearance cell bounds derived from the genome.
      → `personCellBounds.ts`. The limbs are measured by sampling the skeleton
      over the cycle rather than by algebra on the pose curves, and
      `scripts/render-townsfolk.ts` gates the result by rasterizing every pose
      into a padded canvas and measuring the overspill. **63 % less cell area.**
- [x] 1d — cap bake scale at 1.5×. **[HUMAN]** eyeball against 2× before keeping.
      → Capped. The eyeball check is still outstanding; the cap is one constant
      (`MAX_BAKE_SCALE` in `personFrameCache.ts`) if it reads soft.
- [x] Re-measure against Phase 0's baseline. Record the result.

### Phase 2 — Fix the walk

Order matters: G1+G2 are the foundation, everything else refines it.

- [x] G1 + G2 — distance-driven cadence and a world-locked stance foot. One
      change. Port `gaitFootSide`'s stance/swing structure from
      `scripts/generate-human-sprite.ts`.
      → `phase` is now measured in strides, and `Townsperson.update` advances it
      by `distance / walkCycleDistance`. `skeleton.ts` solves the knee by IK to
      a foot target. Gated: worst planted-foot drift over 220 genomes × 400
      frames is **0.0006 px**.
- [x] G3 — invert the body bob. **Verify in a rendered picture.**
      → `hipDrop` peaks at contact and is zero over the straight stance leg.
      Verified in `townsfolk-review.png` against a drawn ground line, and gated
      numerically so it cannot be re-inverted.
- [x] G4 — keyed knee curves replacing the rectified sine.
      → Delivered by G2 rather than by a separate curve: the knee is now a
      consequence of a keyed foot path, so it peaks after toe-off and extends
      before heel strike for free, and the pelvic drop at contact bends the
      stance knee at loading — which is the actual mechanism.
- [x] G5 — foot pitch: heel strike, flat midstance, toe-off roll.
- [x] G6 — front/back arm swing carried by shoulder twist.
      → Arms got their own frontal scale (0.6, against the legs' 0.32) and more
      than double the head-on amplitude, plus a shoulder-line _roll_. Roll rather
      than twist: rotating a flat figure about its spine foreshortens both
      shoulders symmetrically and reads as nothing, while a vertical differential
      survives.
- [x] G7 — facing hysteresis and dwell time.
- [x] G8 — raise walk buckets to 12–16 (only after Phase 1 lands).
      → 16, matching the player character's own walk row.
- [x] G9 — per-role gait archetypes.
      → Six: amble, purposeful, trudge, trot, stagger, shuffle, mapped from
      `TownRole` in `PersonAppearance.ts` and parameterized in `gait.ts`.
- [x] Route 2 cleanups: wrap `phase`, cap bakes-per-frame.
- [ ] **[HUMAN]** Walk the plaza and confirm the crowd reads as people walking.
      Check all four facings and the walk/idle transition specifically.
      → All four facings and the idle row are in `townsfolk-review.png`
      (`npm run render:townsfolk`), which is as far as a still goes. The plaza
      itself needs a human. **Ryan walked the town on 2026-08-02: the crowd reads
      well, except that children were moving their limbs wildly fast** — the
      cadence trap described below, now fixed and gated. Two things a still
      still cannot show, worth looking for on a re-check:
      **(a)** the walk→idle snap — the feet jump from a stride apart to together
      in one frame, which is inherent to switching pose functions and was not in
      the plan's scope to blend; **(b)** the idle twitch, which is two poses under
      a pixel apart alternating about once a second (see `IDLE_PHASE_BUCKETS`).

### Phase 3 — Layered region masks (optional; gate on Phase 1's numbers)

Only build this if Phase 1 leaves cache misses expensive enough to matter — e.g.
a camera sweep into the plaza still spikes, or mobile still evicts.

**Not built — the gate did not open.** A full 40-person crowd with _every_ cell
baked is now 23.2 MB against the 24 MB budget, and that figure no longer scales
with `devicePixelRatio` because the bake density is capped. A crowd left running
for a minute in Chrome settles at 11.2 MB with a 100 % hit rate and no evictions,
so mobile does not evict. The camera sweep is handled by
`MAX_NEW_PEOPLE_PER_FRAME`, which turns the spike into a two-or-three-frame slope
of direct draws.

Revisit if any of these becomes true:

- the plaza population grows enough that the byte budget binds in steady state
  (watch `direct draws` in the `?people` readout — it should be zero once the
  crowd is warm);
- the draw size grows, since cell bytes scale with its square;
- a profile shows the direct-draw fallback firing every frame rather than only
  while the cache warms.

The original steps, if it is ever needed:

- [ ] Split `drawPerson` into per-region painters emitting shape masks.
- [ ] Quantize the genome into body archetypes; pick the count by eye at
      `?people`, since this is the one thing the approach actually costs you.
- [ ] Runtime-bake region masks per archetype into memory; composite per person
      with `source-in` tinting into the existing per-person cell cache.
- [ ] Re-measure the cache-miss cost against the ~0.093 ms baseline.
- [ ] 3b, only if the startup bake is too slow: move the mask bake offline into a
      `scripts/generate-*.ts` PNG pipeline, following the existing generator
      convention and its bake gates.

---

## Measured baselines

Fill in as phases land. Always record `devicePixelRatio` and the visible citizen
count alongside any frame time, or the number means nothing.

| Date       | Phase                                                   | DPR   | Visible | Hit rate  | Evict/frame | Cache MB                    | ms/frame (crowd)                | ms/frame (total) |
| ---------- | ------------------------------------------------------- | ----- | ------- | --------- | ----------- | --------------------------- | ------------------------------- | ---------------- |
| 2026-08-02 | analytic (node-canvas, no profile)                      | 1     | 40      | —         | —           | —                           | 3.7 (all miss) / 0.25 (all hit) | —                |
| 2026-08-02 | after 1+2 (headless, `npm run render:townsfolk`)        | any   | 40      | —         | —           | **23.2 (every cell baked)** | —                               | —                |
| 2026-08-02 | after 1+2 (Chrome, `?people` crowd stress, ~1 min warm) | **2** | 40      | **100 %** | **0**       | **11.2**                    | 0.14 submit                     | —                |

The Chrome row is the real thing — 40 live `Townsperson` instances wandering and
drawing through the cache on a `devicePixelRatio` 2 display. Every lookup hits,
nothing is evicted, nothing falls through to a direct draw. Before the change the
same crowd wanted an estimated 65–136 MB against the same 24 MB budget.

**Watch the cache size as it warms, not once.** It reads 0.4 MB after a few
seconds and climbs to 11.2 MB after a minute, as each citizen gradually walks
every direction and fills in the buckets they had not needed yet. 11.2 MB is
about half the 23.2 MB every-cell ceiling, so a long session in a busy plaza will
run at roughly half the budget — comfortable, but not the order of magnitude of
slack the mid-warm figure suggests. If the plaza population grows, the byte cap
is what binds (at about 41 fully-baked people), not `MAX_CACHED_PEOPLE`.

**The ms/frame figure is submission, not raster, and is labelled as such on
screen.** It brackets the `drawImage` calls, which a GPU-backed canvas merely
queues. 0.14 ms for 40 blits is in line with the 0.0063 ms/blit measured
headlessly, but a real frame cost needs a Chrome performance profile — the
outstanding **[HUMAN]** item. The window also has to be focused: an occluded tab
throttles `requestAnimationFrame` to about 1 fps, which is enough to watch the
cache warm but useless for timing.

### Per-person cache footprint, before and after

Measured over 220 genomes across all twelve roles at the real draw size
(`TILE_SIZE 32 × HUMANOID_NPC_SCALE 1.4 = 44.8 px`). The "after" column is
independent of `devicePixelRatio` because 1d caps the bake density.

|                       | Before                                 | After                               |
| --------------------- | -------------------------------------- | ----------------------------------- |
| Cells per person      | 64 (4 facings × 2 motions × 8 buckets) | 54 (3 facings × (16 walk + 2 idle)) |
| Cell area             | one fixed box for everybody            | **63 % smaller**, per genome        |
| Bake density          | `devicePixelRatio`                     | capped at 1.5×                      |
| Bytes per person      | 0.85 MB at 1×, 3.40 MB at 2×           | **0.58 MB, any DPR**                |
| 40 people, every cell | 34 MB at 1×, 136 MB at 2×              | **23.2 MB**                         |
| Budget                | 24 MB                                  | 24 MB                               |

The working set was 1.4× the budget at 1× and 5.7× at 2×; it is now inside it at
either. That is what makes the eviction policy stop mattering in normal play.

### Gait, measured

From the same run. Every figure is 220 genomes × the whole cycle unless noted.

| Check                                      | Result                                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planted-foot drift (400 frames of walking) | **0.0006 px** — the skate is gone                                                                                                                                                                     |
| Pelvic bob phase                           | troughs at contact, peaks over the stance leg, on every genome                                                                                                                                        |
| Foot roll                                  | heel strike and toe-off present on every genome                                                                                                                                                       |
| IK reach shortfall                         | 0.019 px — the solver's extension epsilon at mid-stance, where the leg is genuinely straight. The clamp never binds at contact, which is where it would cost stride.                                  |
| Cell bounds                                | no genome's ink leaves its cell                                                                                                                                                                       |
| Arm phase                                  | each arm is furthest back as its own leg reaches forward                                                                                                                                              |
| Stride                                     | 11.5–38.2 px per cycle — a shuffling beggar and a striding guard are 3× apart                                                                                                                         |
| Cadence                                    | **3.5–6.1 steps/s** across the whole crowd at full cohort speed. Previously 45 frames per cycle for every citizen at every speed; briefly, mid-rework, **4 steps/s for an adult and 14 for a child.** |

### The cadence trap, and why `gaitSpeedFactor` exists

Tying cadence to distance travelled (G1) has a consequence the plan did not
name: **cadence is `speed / cycleDistance`, so handing every citizen the same
speed range while their strides differ four-fold hands them a four-fold spread
of step rates.** A child is 62 % of an adult's height, so their stride is 62 % as
long, and `TownLifeSystem` had them walking a plaza at an adult's pace — which
can only be done by moving the legs at fourteen steps a second. It was the first
thing a human noticed in the town.

The fix is `gaitSpeedFactor` in `gait.ts`: the same terms that shorten a stride
also slow the person down, because that is what being small, laden or shuffling
actually means. Three quarters of the difference moves into speed
(`STRIDE_SPEED_SHARE`), so a child still takes visibly quicker steps than the
adult beside them without windmilling. `gateCadence` in the harness fails the
build below one stride per sixteen frames — the point at which the cache's
sixteen baked poses cannot all be shown and the legs alias.

---

## Progress Tracker

Append an entry per working session. Newest at the bottom. Keep it factual —
what landed, what is half-done, what the next session should pick up.

**Status: phases 0–2 implemented; Phase 3 assessed and declined. Three
[HUMAN] checks outstanding.**

| Date       | Session         | Phase   | What landed                                                                                                                                                                                                      | What is unfinished / next                                                                                          |
| ---------- | --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-08-02 | plan authored   | —       | This document. Diagnosis, measurements, phases.                                                                                                                                                                  | Phase 0 — measure before building.                                                                                 |
| 2026-08-02 | implementation  | 0, 1, 2 | Everything in the phase lists above, plus `scripts/render-townsfolk.ts` (contact sheet + eight gates) and the `?people` crowd-stress mode. Four review rounds; the defects they found are recorded in the gates. | The three **[HUMAN]** items: a browser profile in the plaza, the 1.5× vs 2× bake eyeball, and a playtest re-check. |
| 2026-08-02 | Ryan's playtest | 2       | Report: the town reads well but children's limbs moved wildly fast. Diagnosed as the cadence trap (see Measured baselines), fixed with `gaitSpeedFactor` and gated by `gateCadence`.                             | A re-check that children now read right.                                                                           |
|            |                 |         |                                                                                                                                                                                                                  |                                                                                                                    |

### What a later session should know

- **`scripts/render-townsfolk.ts` is the review path.** `npm run render:townsfolk`
  writes a contact sheet — every facing, every phase, a ground line to judge the
  bob against, and one row per gait archetype — and runs eight gates that fail the
  build. `--only=<label substring>` and `--scale=9` narrow it to one row when a
  detail needs a close look.
- **Two gates guard defects this code has actually had.** The cell-bounds gate
  rasterizes every pose into a padded canvas and measures how far the ink lands
  outside the cell, because a hat that clips does so on one hairstyle in ten. The
  stance-plant gate walks a figure 400 frames and watches its planted ankle,
  because a skate of a fraction of a pixel per frame is invisible in a still and
  obvious in motion.
- **`phase` changed units.** It is strides now, not frames, wrapped to `[0, 1)`.
  Anything that feeds `drawPerson` has to divide distance by
  `walkCycleDistance(appearance, drawSize)` — a raw frame counter will animate,
  but at a cadence unrelated to how fast the figure is moving.
- **The pelvic drop is derived, not tuned.** `hipDropAmplitude` computes the drop
  the stride geometrically demands and adds the person's own bounce on top.
  Raising `STRIDE_PER_LEG_LENGTH` without it would make the IK clamp bind, and a
  clamped leg locks straight with its foot hanging above the floor.

### Known, deliberately not fixed

**A short citizen is short in one axis only.** `heightScale` scales the head's
height, the leg, torso, arm and neck lengths — but not `shoulderWidth`,
`hipWidth` or `FOOT_LEN`, which are fractions of draw size applied flat. So a
child has an adult's shoulders and an adult's shoes on a 62 %-height body. The
head was the worst of these (its _height_ scaled while its _width_ did not, so a
child came out squat and wide-headed) and was fixed here, because it is the
largest shape on the figure and children were the thing under review. The rest
is a genuine art decision about what a child in this game should look like, it
touches every citizen's silhouette, and it is not a gait or a performance
problem — so it is left for whoever makes that call.

### Open questions

- Is `devicePixelRatio` 2 on the machine where the lag was observed? The whole
  memory argument scales with its square, and the fix priority changes if it is 1.
  → **Moot now.** 1d caps the bake density at 1.5×, so the footprint is the same
  at any DPR. Worth confirming anyway if the 1.5× cap gets reverted.
- Does the interaction with `RenderQuality` / `getRenderScale()` already clamp
  the bake scale somewhere? Phase 1d should not fight an existing clamp.
  → It does not. `RenderQuality` sets the render scale and flushes the person
  cache when it changes; `drawPersonCached` now takes `min(getRenderScale(), 1.5)`
  on top, which composes cleanly — a quality drop still lowers the bake density,
  a quality raise stops at 1.5.
- How many townsfolk exist in total (all four cohorts plus market vendors)?
  Phase 0 should print the count rather than leave it estimated.
  → Still estimated: the count depends on the generated map (one loiterer or two
  per building door, wells and fountains found by tile type), so it needs a
  running game. The `?people` crowd mode takes the count as a dial instead, which
  answers the question the count was being asked for.

---

## Working alongside other agents

Other Claude sessions will very likely be editing this repo while you work.

- **Never run `git stash`.** It destroys other agents' in-progress work. This has
  bitten this project before.
- **Never revert, reformat, or "clean up" a file outside this plan's scope**, even
  if it looks broken. It is probably mid-edit by someone else.
- **Re-read a file immediately before editing it.** Your context may hold a stale
  copy of something another agent changed thirty seconds ago.
- **If `npm run typecheck` or `npm run lint` fails in a file you did not touch,
  do not fix it.** Note it in your Progress Tracker entry and confirm your own
  files are clean. Someone else's half-landed change is not your bug.
- **Keep commits scoped** to this plan's files, and say which phase they belong to.
- **Update the Progress Tracker before you finish**, even for a partial session.
  It is the only durable handoff.

### Scope files

```
src/sprites/person/personFrameCache.ts
src/sprites/person/gait.ts
src/sprites/person/skeleton.ts
src/sprites/person/drawPerson.ts
src/sprites/person/PersonAppearance.ts
src/creatures/Townsperson.ts
src/creatures/townWander.ts
src/systems/TownLifeSystem.ts
src/scenes/PersonPreviewScene.ts
```

Reference only — read, do not edit: `scripts/generate-human-sprite.ts`,
`scripts/carlArt.ts`.

### House rules that apply here

From `CLAUDE.md`, and worth restating because this work touches all of them:

- No `as` casts, no `!`, no `any`.
- No magic numbers — name every constant after what it _means_
  (`TOE_OFF_PITCH`, not `PITCH_13`).
- Comments explain _why_, never _what_.
- These are game-world figures, so raw `ctx` calls are correct here. The
  `src/ui/*` helpers are for interface chrome only.
- Run `npm run typecheck`, `npm run lint`, and `npm run format` before calling
  anything done.
