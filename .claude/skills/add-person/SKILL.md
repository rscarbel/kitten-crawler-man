---
name: add-person
description: Generate or extend procedural humans in Kitten Crawler Man — the seeded appearance genome, skeletal 4-facing walk renderer, and townsfolk. Use for any human NPC/crowd/townsperson work, or to add hair/clothing/face/body variety. NOT for creatures or bosses (use add-creature/add-sprite).
---

# Add / Extend a Procedural Person

Humans are **drawn procedurally at runtime from a seed** — not PNG sprite sheets. Every
person is derived from one integer seed into an appearance "genome", then drawn over a
forward-kinematics skeleton with a real walk cycle. This exists so the world can spawn
unlimited unique people. **Routing:** use this for townsfolk / human crowds / human NPCs;
use `add-creature` + `add-sprite` for enemies, bosses, and non-human NPCs (PNG-sheet pipeline).

Module: `src/sprites/person/`

- `rng.ts` — mulberry32 PRNG + `range`/`rangeInt`/`pick`/`chance`/`centered`/`subSeed`.
- `color.ts` — palette pools (`SKIN_TONES`, `HAIR_COLORS`, `EYE_COLORS`, `TOP_COLORS`, …) + `shade`/`tint`.
- `PersonAppearance.ts` — `generatePersonAppearance(seed)`: the genome (body/head/face/hair/outfit/gait) + all tunable `*_MIN/*_MAX` ranges.
- `skeleton.ts` — `buildSkeleton(app, pose, facing, cx, sy, s)`; FK so limbs always connect.
- `gait.ts` — `poseForMotion(app, facing, phase, moving)`: contralateral walk + idle; also
  `walkCycleDistance(appearance, drawSize)` and `gaitSpeedFactor(appearance)` (see below).
- `drawPerson.ts` — `drawPerson(ctx, sx, sy, size, app, phase, facing, moving)`.
- `personFrameCache.ts` — `drawPersonCached(...)`: the cache most callers should actually use (see below).

Preview: on localhost open `?people` (`PersonPreviewScene`, hooked in `game.ts` `devBootScene`).

## Recipe: add a variant (hairstyle / clothing / facial feature / body trait)

1. **Genome** (`PersonAppearance.ts`): add the value to the enum (e.g. `HairStyle`) or pool,
   add it to the `*_STYLES` list / color pool it's picked from, and if continuous add a named
   `*_MIN/*_MAX` pair and draw it in the matching `generate*` helper. No magic numbers.
2. **Render** (`drawPerson.ts`): draw it in the relevant `case`/branch. **Handle all three
   views** — front (`down` → `drawFrontFace`/`drawHair(...,false)`), profile (`drawProfileHead`),
   and back (`up` → `drawHair(...,true)` / `drawBackHairMass`). Back view has no face.
3. **Verify** by eye at `?people` (reroll = click). Confirm the variant appears, limbs still
   connect, and it looks right in every facing.

## Gotchas

- **Facings:** only `down`/`up`/`right` are built; `left` is a mirror of `right` (flip in
  `drawPerson`). Never special-case `left` in the skeleton.
- **FK foreshortening:** `FRONTAL_X_SCALE` in `skeleton.ts` squashes the horizontal swing for
  `down`/`up` so a knee/elbow bend lifts the foot/hand instead of splaying sideways. If a
  front-facing limb kicks out to the side, that constant (or the gait bend amplitude) is why.
- All proportions are **fractions of draw size**, never pixels — a person looks identical at
  any `size`.
- These are game-world figures, so **raw `ctx` is correct here** — the `src/ui/*` helpers are
  for chrome only.
- **`heightScale` scales one axis.** It scales head height, leg, torso, arm and neck lengths, but
  not `shoulderWidth`, `hipWidth` or `FOOT_LEN`, which are flat fractions of draw size. A child
  therefore has an adult's shoulders and an adult's shoes. The head was corrected specifically;
  the rest is an open art decision, not a bug to fix in passing.

## Populating the world

`TownLifeSystem` already crowds the Over City and is the model to copy. It seeds four
cohorts so life spreads across the village instead of pooling in the square: the **plaza
crowd**, **frontage loiterers** anchored to a building's door, **travelers** walking long
hops between distant street tiles, and **activity anchors** standing at a named fixture
(a well, the smithy door, the club door). All four share one wander helper that respects
walls, biases toward street tiles and keeps clear of doorways, and all four are exposed
as a single crowd for the scene's Y-sorted render pass.

Its wander radii (`PLAZA_RADIUS_TILES`, `DISTRICT_RADIUS_TILES`, `FRONTAGE_RADIUS_TILES`)
are tuned to the town's extents — see the invariants table in `docs/town.md` before
changing the layout under it.

For a crowd somewhere else, add a `GameSystem` (see `add-system`) holding
`{ x, y, facing, phase, appearance, seed }` per person, move + pick `facing` from
velocity, advance `phase` per the cadence contract below, and call `drawPersonCached`
Y-sorted into the render pipeline.

## The cadence and cache contract

`phase` is measured in strides, not frames, and wraps to `[0, 1)`. Advance it by
`distanceMoved / walkCycleDistance(appearance, drawSize)` — never by a fixed step.
A raw frame counter still animates, at a cadence unrelated to how fast the figure
is moving, which is what made anchors moonwalk and travelers mince.

Distance-driven cadence makes speed and stride one decision. Cadence is
`speed / cycleDistance`, so handing every cohort the same speed range while their
strides differ four-fold hands them a four-fold spread of step rates: a child is
62% of an adult's height and so has 62% of the stride, and walking a plaza at an
adult's pace could only be done at fourteen steps a second. `gaitSpeedFactor` in
`gait.ts` is the fix — the same terms that shorten a stride also slow the person
down, with `STRIDE_SPEED_SHARE` of the difference moving into speed so a child
still visibly out-steps the adult beside them. Multiply a cohort's speed by it
when you spawn a person. `gateCadence` (in `render-townsfolk.ts`) fails the build
below one stride per `WALK_PHASE_BUCKETS` (16) frames, the point at which the
cache's baked poses cannot all be shown and the legs alias.

People are drawn through `drawPersonCached`, not `drawPerson`. The cache bakes
each genome's cells and blits them instead of redrawing every frame. Its eviction
is admission-stop, not LRU, and that distinction is the whole performance story:
when the working set exceeds the byte budget, LRU evicts the person drawn
earliest this frame, who is drawn again next frame and rebuilds everything, so
the hit rate collapses and every citizen pays the full draw price. Admission-stop
instead keeps the cache intact, refuses new cells, and lets the overflow fall
through to a direct `drawPerson` — a cliff becomes a slope. Anything that grows
the per-person footprint (more phase buckets, a taller cell box, a higher
`MAX_BAKE_SCALE`) spends against a byte budget that a forty-person plaza already
nearly fills — `personFrameCache.ts` currently sets that budget at 24 MB
(`CACHE_BUDGET_MEGABYTES`) with a 48-person head-count cap (`MAX_CACHED_PEOPLE`)
as the looser of the two bounds. Confirm both constants before quoting numbers —
they are tuning knobs, not fixed facts.

`npm run render:townsfolk` is the review path, and it is a gate, not just a
picture. It writes a contact sheet — every facing, every phase, a ground line to
judge the pelvic bob against, one row per gait archetype — and runs 8 gates that
fail the build. `--only=<label substring>` and `--scale=9` narrow it to one row.
Two of those gates guard defects this code has actually shipped: `gateCellBounds`
rasterizes every pose into a padded canvas and measures overspill, because a hat
clips on one hairstyle in ten; `gateStancePlant` walks a figure across many
frames watching its planted ankle, because a skate of a fraction of a pixel per
frame is invisible in a still and obvious in motion. Confirm the gate list in
`scripts/render-townsfolk.ts` before stating one.

Finish with the `dev-workflow` gates: `npm run typecheck`, `npm run lint`, `npm run format`.
