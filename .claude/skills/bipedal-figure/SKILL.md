---
name: bipedal-figure
description: Draw or redraw a believable two-legged character (human, goblin, clown, humanoid boss/NPC) as procedurally painted sprite art in Kitten Crawler Man — the rig/pose/view contract, the painter/figure/gate/harness pipeline, the image-review loop, and the anatomy traps that only show up in a picture. Use whenever a bipedal character needs new art, a new animation row, or a believability fix. The four-file painter pipeline it describes is the same for any creature; only the anatomy half is biped-specific. NOT for runtime-seeded townsfolk (use add-person) or for props, tiles and environment art, which are still baked PNG sheets (use add-sprite).
---

# Bipedal Figure Art

A bipedal figure is the hardest art in this codebase: the player reads a human
silhouette faster and more critically than anything else on screen, and almost
every defect that matters is invisible to `typecheck`, `lint`, and a code read.
It only shows up in a rendered image.

Follow the pipeline and read the trap catalog **before** authoring poses — most
of those traps cost multiple rounds of "it still looks wrong" to find the first
time.

**There is no creature sheet on disk.** Every character, creature and
creature-owned effect is painted by TypeScript at runtime and cached as bitmap
cells. `docs/asset-management.md` ("Creatures are painted, not loaded") is the
durable description of that architecture and the obligations it puts on a
figure; read it once before your first conversion or new figure.

> **Carl is the only figure in this game whose movement is convincing.**
> `src/sprites/art/carlArt.ts` + `src/sprites/art/humanFigure.ts` are the _sole_
> reference for gait, limb motion, weight, and pose authoring. The goblin and
> clown pipelines are cited here **only** for build structure — gate shapes,
> harness modes, prop silhouette — and their walks, idles and attacks are
> explicitly not a model to copy or measure against. If a motion question comes
> up, answer it from Carl or from `references/anatomy.md`, never by opening
> `goblinArt.ts` or `clownArt.ts`.

**Routing.** Bipedal enemies/NPCs/bosses → here, then `add-creature` for the
gameplay class. Seeded runtime townsfolk → `add-person`. Non-bipeds → the same
four-file shape applies, but their anatomy traps are not in this skill.

## The four-file pipeline

Every painted figure in this repo is the same four modules. Copy the shape; do
not invent a new one. The Juicer is the worked bipedal example end to end.

| File                           | Job                                                                                                                                                                                                         | Reference implementations                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/sprites/art/<x>Art.ts`    | **The painter.** Palette ramps, proportions in tile units, the view table, the pose interface, the IK solver, and one `draw<Name><View>` per view over one shared pose type. Knows nothing about animation. | `carlArt.ts` — the rig to copy; `juicerArt.ts`             |
| `src/sprites/art/<x>Figure.ts` | **Choreography plus the `FigureDef`.** One pose function per row, the row table, the cell geometry constants, gore-piece placement, `paintFrame(ctx, state, frame)`, and the exported `<X>_FIGURE`.         | `humanFigure.ts`, `juicerFigure.ts`                        |
| `scripts/gates-<x>.ts`         | **The art gates.** Paints cells from the `FigureDef` and measures them, plus pose-stream gates that need no pixels. Accumulates failures and exports `<x>GateFailures()`.                                   | `gates-juicer.ts` (~19 gates), `gates-goblins.ts`          |
| `scripts/render-<x>.ts`        | **The review harness.** Runs the gates **first**, then bakes a labelled contact sheet with `bakeFigureSheet` into `preview/`. This is the only way the art gets judged.                                     | `render-juicer.ts`, `render-human.ts`, `render-goblins.ts` |

`src/sprites/<x>Sprite.ts` is the runtime wrapper: it keeps its exported
signature and calls `drawFigureCached(ctx, <X>_FIGURE, state, frame, sx, sy, tileSize, opts)`.
Frame counts come from `figureFrameCount(<X>_FIGURE, state)`, never from a
sprite manifest.

Wire `"render:<x>": "tsx scripts/render-<x>.ts"` in `package.json`. There is no
`gen:` script for a creature. Add a `?<name>` preview scene in
`src/dev/devBoot.ts` for in-motion checks.

### Shared infrastructure

- `src/sprites/figure/figureDef.ts` — `FigureDef`, `FigureStateDef`,
  `figureStates(record)`, `figureFrameCount(def, state)`, `FigurePainter`.
- `src/sprites/figure/figureFrameCache.ts` — `drawFigureCached`,
  `drawFigureCachedRotatedCenter`, `prewarmFigureState`, `figureInkBounds`.
  Its `beginFigureFrame` / `flushFigureFrameCache` are already wired into
  `Scene`, render quality and the floor-change eviction; you never call them.
- `scripts/figureSheet.ts` — `paintFigureCell`, `bakeFigureCell`,
  `bakeFigureSheet`, `figureStateNames`, `frameCountOf`.
- `scripts/figureGates.ts` — `figureStructuralFailures`, `missingStateFailures`,
  `nothingMeasuredFailures`, `inkBoxOf`, `reportFigureGates`.
- `scripts/nodeGameContext.ts` — `asGameContext`, `gameContext`.
- `scripts/previewOut.ts` — `PREVIEW_DIR`, `writePreviewPng`.
- `npm run bench:figure-paint`, the `?paintbench` route and
  `src/dev/paintBenchSubjects.ts` — per-cell paint cost.
- `npm run wave:figure` (`scripts/wave-test-figure.ts`) — a spawn driven through
  the real cache; exits non-zero on a frame that overruns the bake budget.
- `npm run gates:figure-cache` — the cache's own behaviour, including a
  cached-versus-direct pixel comparison.
- `npm run review:index` — builds `preview/index.html` from every review image.

## The painter contract

`paintFrame(ctx, state, frame)` is called by the frame cache at runtime and by
every offline harness. Break one of these and the failure appears as a corrupt
cache entry or a creature that looks different in the game from the contact
sheet the reviewer approved.

- **Deterministic in `(state, frame)` alone.** No `Math.random()`, no
  `Date.now()` or `performance.now()`, no module-level mutable state, no reading
  a global — **and nothing that advances a counter at paint time.** A cell is
  painted once and reused for every instance for the rest of the session. The
  goblin gore pieces shipped calling a shared `nextSeed()` _inside_ each piece's
  paint closure, so a wound's grain depended on how many times that piece had
  already been drawn; the offline bake always painted the set in one order and
  never showed it, and only a pixel comparison caught it. Hoist anything that
  advances a counter to construction time. Seeded hashes of the frame index
  (`hash1` in `ratArt.ts`) are how variety is drawn.
- **Stays inside its declared cell.** Everything lands within `0,0`–`frameWidth,frameHeight`;
  the cache allocates exactly that and clips the rest away silently.
  `figureStructuralFailures` fails a pose that reaches the edge.
- **Reads no caller `ctx` state.** Set every fill, stroke, font, transform and
  composite mode you depend on. The one thing to _compose_ with rather than
  overwrite is alpha: read `ctx.globalAlpha` once, multiply into it, restore that
  value rather than assigning `1`, or a caller fading a severed limb gets its
  fade painted straight through.
- **Never calls back into the figure cache.** No `drawFigureCached`,
  `prewarmFigureState` or `figureInkBounds` from inside a painter — the cache is
  mid-bake when it calls you, and re-entering it stores a half-painted cell as
  finished.
- **A painter needing a scratch surface pins its own density.** Density is the
  caller's transform, so reading `ctx.getTransform()` would make the painter
  depend on caller state. Compose the whole cell at a density the painter names
  itself and blit it down once — which also composes `globalAlpha` correctly.

**Art modules under `src/sprites/art/` are typed against the DOM
`CanvasRenderingContext2D`**, never node-canvas's: declare
`type Ctx = CanvasRenderingContext2D;` locally rather than importing a type from
`canvas`. The browser hands `paintFrame` a real DOM context, so it takes it
unchanged. Offline harnesses in `scripts/` hold a node-canvas context and bridge
with `asGameContext` **at the harness boundary, once per call site** — never
inside the art module. In `scripts/bench-procedural-draw.ts` use
`figureSubject(def, state)`, which handles the bridge and takes the cell size
from the def.

Two lint rules bite modules that live under `src/`:
`@typescript-eslint/no-unnecessary-condition` (an `undefined` check on a
`Record<string, T>` index is "unnecessary" — declare the table as a
`ReadonlyMap`, which is what `figureStates` returns and for the same reason) and
`no-unused-vars`.

**Clamp a computed alpha below about `1e-6` to zero.** node-canvas drops an
`rgba()` whose alpha is in exponent notation and bakes a solid smear instead.

## Procedure

1. **Read `references/anatomy.md` first.** It is the trap catalog, organised by
   body part. Skimming it costs minutes; rediscovering it costs review rounds.
2. **Pin the proportions.** Height in tiles, heads-tall, then every joint height
   derived from those two. Carl is `FIGURE_HEIGHT = 2.03` at `HEADS_TALL = 4.8`
   in `carlArt.ts`. **Never derive a body part from the head** — a game figure's
   head is deliberately oversized, so any life-drawing ratio hung off it inflates
   (`references/anatomy.md#proportions`).
3. **Write the `ViewSpec` table before any drawing code.** Head-on and edge-on
   are not one figure with a multiplier: a profile needs _two_ lateral factors
   (`lateral` for limb roots, `girth` for torso width) plus `chestTaper`,
   `hipDepth`, `armSpread`, `crotchNotch`, and the `showsFace`/`showsBack` flags.
   See the `ViewSpec` interface and the `VIEWS` table in `carlArt.ts`.
4. **Define the pose interface as targets, not angles — with FK escape hatches.**
   Hand/foot positions the IK reaches for is the right default; but a walking arm
   _must_ be FK (`ArmAngles`), because IK from a hand target sweeps both segments
   together and the forearm flails. Both mechanisms coexist in `CarlPose`; the
   angles win for that arm when set.
5. **Author `restingPose()` and write every animation as edits to it.**
6. **Choreograph rows in `<x>Figure.ts`.** Walk rows at 16 frames, most others at
   8; more frames buy smoothness only. Pace motion with a _phase speed_ on the
   player/mob, never by scaling the frame index
   (`references/anatomy.md#timing`). Keep the row table, the frame counts and the
   impact frames in this one module and import them everywhere else — a constant
   duplicated into a runtime module is a constant that drifts.
7. **Declare the `FigureDef`**: `frameWidth`, `frameHeight`, `tileX`, `tileY`,
   `tileScale`, `states: figureStates({...})`, `paintFrame`. A gore piece is not
   a row — each piece takes its own one-frame state.

   **Anything measured offline has to be frozen as a named constant, and every
   frozen ink measurement needs a gate that re-measures it.** Nothing can measure
   ink at runtime, so cell extents, a gore recentring offset, a health-bar
   clearance are all computed once and written down. The Juicer freezes
   `GORE_RECENTRE` in `juicerFigure.ts` and `JUICER_HEAD_CLEARANCE_TILES` in
   `juicerSprite.ts`, and gates re-measure both on every render. A frozen
   measurement with no gate behind it goes quietly wrong the first time somebody
   redraws the creature, with every other gate green.

8. **Bench it.** `npm run bench:figure-paint` (not `bench:procedural-draw`,
   which draws at the wrong scale and reads three to five times too fast) and the
   `?paintbench` route. Read the offline number as a _magnitude_, never as a
   ranking — Chrome even scrambles the ordering between variants. **Regime is per
   figure, never per family.** A figure over roughly 1 ms per cell ships only
   with prewarm coverage for every state its AI can enter.
9. **Wire prewarm where the spawn is _scheduled_**, not where the mob is
   constructed and never where it first renders: `MOB_PREWARM` in
   `src/levels/spawner.ts` is the floor-wide backstop, plus the boss intro, the
   attack telegraph, the wave scheduler. Compute the lead you need
   (`rows × frames × bake_ms / PREWARM_BAKE_BUDGET_MS` in `figureFrameCache.ts`)
   rather than assuming it, and keep it inside that file's
   `IDLE_FRAMES_BEFORE_RELEASE` window or the warming is thrown away unused.
   Gore is drawn all at once with no telegraph of its own — warm it when the
   creature engages. Prove the wiring with `npm run wave:figure`, run twice, once
   with `--no-prewarm` as the control; if the control passes, the instance count
   is too low to prove anything.
10. **Gate the art.** Start from `references/gates.md`. Then run the negative
    test on every gate — see below.
11. **Review as an image, with an agent that only sees the image.** This is not
    optional and it is not one pass. See `references/review.md`.
12. **Wire it up** via `add-creature`, and re-measure the tile anchor — health
    bars and aggro markers key off it and _will_ be wrong after a redraw
    (`references/anatomy.md#anchor`).
13. **Validation gates:** `npm run typecheck`, `npm run lint`, `npm run format`,
    `npm run gates:figure-cache`, `npm run render:<x>` must all exit 0.
    `npm run format` is prettier over the whole repo — while other agents are
    mid-edit, format your own paths only and finish with
    `npx prettier --check --ignore-unknown .`.

## Writing a gate that can actually fail

This is the single biggest lesson of the move off baked sheets. **Roughly a
dozen gates across this project turned out to be structurally incapable of
failing.** Every one was found by mutation testing; none was found by reading
the code. A gate is not correct because it shipped, and it is not correct
because it looks reasonable — it is correct because you broke the art and
watched it go red.

### The negative-test discipline

- **Inject the real defect; never delete the guard.** Removing a painter's
  tiny-alpha clamp left its gate green, because nothing in those frames currently
  computes an alpha small enough to trip it. Only writing a literal `5e-17` into
  a gradient stop reddened it. Deleting a guard proves the guard is load-bearing;
  only the defect proves the gate works.
- **Copy the file aside before mutating and restore from the copy. Never
  `git checkout --` it** — that throws away everything else in the file along
  with the mutation.
- **Aim at the value the gate reads**, not the machinery around it, and pick a
  mutation the gate is uniquely about: drifting the hips reddens the leg-reach
  gate first and says nothing about the centroid gate you were testing; an
  asymmetry gate needs its mutation aimed at the side it bounds, because moving
  the art the other way _improves_ the ratio.
- **If no mutation can redden it, the gate is what is broken.** Re-express it in
  the units of the thing it is about — hand position in tiles, not a pixel-delta
  ratio against the row's own median. Do not respond by tightening a ratio: a
  high-motion row swamps a median-relative threshold at any setting.
- Say in your report which mutation you used and which gate caught it.

### There is no mechanical check for vacuity — only mutation

`npx eslint 'scripts/gates-*.ts'` reports comparisons the type system can decide
(`@typescript-eslint/no-unnecessary-condition` — "comparison is always false,
since `0.07 < 0.03` is false"), and it is tempting to read those as a list of
dead gates. **They are not.** The rule proves _static decidability_, not
vacuity: an art constant with a literal type makes a perfectly failable gate look
identical to a dead one, because the mutation that would redden it changes the
constant the linter just folded. Every one of the fourteen hits across this
project's gate modules was mutation-tested and every one was failable; acting on
that list nearly deleted a working clause.

Read those lines as a place to _look_, then break the art and watch. Mutation is
the only thing that answers this question.

### The recurring vacuous shapes

- **A frozen constant compared against something derived from itself.** Moving
  `tileY` moves the ground line _and_ the art together, so a naive anchor gate
  passes for any value. Three gates compared a measured sole line against a
  ground line derived from the constant under test. Measure against the frozen
  tile box — the thing the runtime actually hangs a health bar off — or port the
  bake's cell-sizing _arithmetic_ into the gate so the frozen numbers are
  re-derived from the art on every render.
- **A loop-seam gate with a ceiling but no floor.** Every ported loop gate
  checked only that the seam was not too _big_. Sampling at
  `frame / (frameCount - 1)` instead of `frame / frameCount` makes the last frame
  identical to the first: the seam goes to zero, the cycle spends a whole frame
  held still, and the gate stays green. Assert the seam is in a _band_. The
  floor's denominator must be the **median** step, not the narrowest — a row can
  legitimately hold two byte-identical adjacent frames, which collapses a
  narrowest-step floor into `wrap >= 0`.
- **An inherited ratio whose threshold was never re-derived.** A seam gate moved
  from "median step" to "second-largest step" kept the old 2.2× limit and
  silently became unfailable — a row running 1.8 cycles still passed. Measuring
  every loop row put the real worst at 1.27×, so the limit is 1.6×. **When you
  swap the denominator of a ratio gate, re-derive the threshold from the shipped
  art.** Relatedly, a median-relative step limit saturates on a full stride:
  re-derive walk continuity against the _largest_ step, where a real break
  separates cleanly.
- **A gate measuring a louder neighbour than its subject.** "The screech splays
  its hair" was measuring the shockwave ring that dominates the cell; "the lamps
  chase" was measuring a screen readout marching on the same counter. When a
  mutation to the obvious constant does nothing, ask what _else_ is drawn in the
  region you are measuring, and re-aim the gate. Same shape: a "does it touch the
  ground" check is answered by a mound or scorch painted on the anchor row, and
  an anchor gate measured against ordinary ink is answered by the contact shadow,
  which sits on the ground line wherever the feet are — measure **solid alpha**.
- **A filter that silently empties the loop.** Nearly every gate narrows before
  it measures — planted frames only, IK-placed arms only, one pair per row — and
  a narrowing that matches nothing leaves a loop that runs zero times and a gate
  that reports success. It arrives by accident: a foot lift returning `1e-17`
  instead of `0` empties an equality filter; an arm moved from IK to joint angles
  empties another. Count what each filtered loop examined and hand the count to
  `nothingMeasuredFailures` (the Juicer wraps it as a one-line
  `failUnlessMeasured(gateId, n, what)`). Compare floats against an epsilon,
  never for equality. Do this for every filtering loop, including the ones that
  obviously match something today.
- **An aggregate score too dominated by mass to see a small part.** A missing leg
  is about 2 % of a spider's ink: removing one moved the bilateral-symmetry score
  from 0.861 to 0.838 and the gate stayed green. To prove every limb is painted,
  walk the rig to each limb's tip and look for ink _there_; keep the aggregate
  for what it can prove and say so in its doc comment.

Three more that are not about vacuity but bite the same way:

- **A gate that cannot find its row or state must fail loudly, not skip.**
- **Assert that the state names the runtime asks for exist.** Both draw paths
  return silently on an unknown state, so a pose name built by template literal —
  `${base}_${view}` — that the figure does not paint is an invisible creature and
  no log line. Feed every table of names the runtime can reach to
  `missingStateFailures`. A "reachable states" helper must narrow **by action,
  never by state**: filtering the composed list with `figure.states.has(...)`
  makes the forward check vacuous, because a renamed row drops out of the list
  instead of being reported.
- **A blanket `edgeBleedStates` is self-defeating** — exempting every state makes
  the clipping gate examine nothing, and it correctly self-fails. Use the
  directional `bleedEdges` option, which keeps every cell counted.

## Rules that generalise past this repo

- **Art has to be reviewed as an image, by something that only looks at the
  image.** Four blind rounds on Carl caught, in order: a five-head bobblehead,
  hips wider than shoulders, mitten hands, an unreadable face, sandal-strap toes,
  a jacket darker than the floor it stands on, and a barrel silhouette. Each
  round returned numeric targets. No code review caught any of them.
- **Silhouette beats detail, always.** The war hammer lost its identity the
  moment a spike was added: at 32 px the spike is two pixels and turns a
  rectangle into a star. If a shape is misread, fix the outline, never the
  interior.
- **A fix can entrench the bug it fixed.** Re-review after every "done" — four
  separate defects in this codebase lived _inside_ a completed fix.
- **One `FigureDef` cannot carry an individual trait.** Cells are keyed on
  `(figure, state, frame)` and shared across every instance, so a painter reading
  a per-instance colour serves the first instance's clothes to every creature
  after it. "Some females pierce their tusks" painted into the Tuskling turns a
  personal choice into a species marking. Where the variation is a _closed set_,
  give each variant its own `FigureId` (the sky fowl's eight clothing palettes);
  otherwise it gets cut.
- **A big figure exceeding the per-figure cache ceiling with _every_ row warm is
  expected, not a failure.** Rows release when they stop being played, so the
  ceiling binds only on a figure holding its entire declared set at once. The
  number that decides whether it fits is the **widest state's** bytes, measured
  over every declared state, gore pieces included. Report an overrun; do not
  raise the ceiling. And the supersampled surface is scratch, not residency —
  the resident cell is the declared cell at bake scale.

## References

- `references/anatomy.md` — the trap catalog: proportions, arms, legs, hands,
  feet, head/hair, clothing, views, depth shading, anchoring.
- `references/gates.md` — the gate list, what each catches, and the ones that are
  blind to what.
- `references/review.md` — the blind image-review loop, part crops, blind naming
  tests, and the diagnostic harness modes.
