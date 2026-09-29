---
name: add-person
description: Townsfolk and citizens in Kitten Crawler Man — the Over City's closed cast of human and skyfowl looks, the species axis, citizen figures and their cadence and cache rules, plus the seeded person genome and skeleton painter (children, the ?people gallery). Use for any townsperson, crowd, resident or citizen work. NOT for creatures or bosses (use add-creature/add-sprite), and see bipedal-figure for painting on Carl's rig.
---

# Townsfolk and Procedural People

Two things live here:

- **The town's citizens.** A closed cast of authored human and skyfowl looks, chosen per
  citizen by seed. Every street and interior citizen is one of these. See "The town's
  citizens are a closed cast" below.
- **The person genome.** A seed becomes an appearance genome, drawn over a
  forward-kinematics skeleton with a real walk cycle. It paints the cast's two child
  looks and the lab scientist, and it drives the `?people` gallery. It is not how an
  adult citizen is drawn.

**Routing:** use `add-creature` and `add-sprite` for enemies, bosses and animals. A new
adult look on Carl's rig also follows the `bipedal-figure` skill.

Module: `src/sprites/person/`

- `rng.ts` — mulberry32 PRNG + `range`/`rangeInt`/`pick`/`chance`/`centered`/`subSeed`.
- `color.ts` — palette pools (`SKIN_TONES`, `HAIR_COLORS`, `EYE_COLORS`, `TOP_COLORS`, …) + `shade`/`tint`.
- `PersonAppearance.ts` — `generatePersonAppearance(seed)`: the genome (body/head/face/hair/outfit/gait) + all tunable `*_MIN/*_MAX` ranges. Also `TownRole`, the job taxonomy.
- `skeleton.ts` — `buildSkeleton(app, pose, facing, cx, sy, s)`; FK so limbs always connect.
- `gait.ts` — `poseForMotion(app, facing, phase, moving)`: contralateral walk + idle; also
  `walkCycleDistance(appearance, drawSize)` and `gaitSpeedFactor(appearance)`.
- `drawPerson.ts` — `drawPerson(ctx, sx, sy, size, app, phase, facing, moving)`.
- `townCastLooks.ts`, `townCastPaint.ts`, `townCastPoses.ts` — the human cast's looks and
  the child painter's wrapper.

Preview: on localhost open `?people` (`PersonPreviewScene`): a gallery of seeded people,
and a crowd mode of real `Townsperson`s showing the cache's hit rate.

## Recipe: add a genome variant (hairstyle / clothing / facial feature / body trait)

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

## The town's citizens are a closed cast, not seeds

The Over City's people are **not** drawn from a per-person genome. A cached cell is
keyed on figure, state and frame, so a per-instance colour serves the first citizen's
look to everyone. Every citizen wears one of a closed set of authored looks, and its seed
only picks which. `docs/town.md` ("Who lives here") covers the cast, the species ratio
and why the crowd is rolled from the world seed.

- **Species is its own axis.** `TownSpecies` (`src/systems/townSpecies.ts`) is carried
  by `ResidentDef`, `OccupantSpec` and `Townsperson`. `TownRole` is only a job: services
  are keyed by role, so never add a species to it.
- **One dispatch point.** `pickCitizenFigure(seed, role, species)`
  (`src/creatures/citizenFigure.ts`) returns a `CitizenFigure`. `drawCitizenSprite`,
  `citizenWalkCyclePx`, `prewarmCitizenFigure`, `pinCitizenFigure` and
  `prewarmAndPinCitizenTalk` dispatch on it. `Townsperson` never reads a look directly.
  A third species is a case here.
- **Humans:** the looks are `TOWN_CAST_LOOKS` in `src/sprites/person/townCastLooks.ts`,
  picked by `pickTownCastLook(seed, role)`, and each is painted as one `FigureDef` by
  `src/sprites/art/townCastFigure.ts`.
  - Adults paint on **Carl's rig** in his gear plus a role accessory
    (`src/sprites/art/human/townAccessories.ts`).
  - Children paint on the person skeleton below, because Carl's rig is one adult's
    proportions and a shrunken adult reads as a doll.
  - Build width scales x only (`buildWidthScale`). Scaling height breaks the
    adult-versus-child height gate.
  - A cut's legwear comes from `GARMENT_LEGWEAR`. A new long cut must map to `'none'`,
    or the trousers paint over the hem.
  - Carl's palette, torso cut and expression are live module state
    (`setCarlSkinHairRamp`, `setCarlTorsoCut`, `setCarlExpression`). A look must set them
    and reset them in `finally`. A constant computed at import time from Carl's palette
    misses the swap.
- **Skyfowl:** the rig, painter, outfits, rows and gait are in `src/sprites/art/skyfowl/`,
  assembled in `skyfowlCastFigure.ts`. `SKYFOWL_CIVILIAN_LOOKS` is the only pool the
  street picks from. Resident, dancer and street-tough looks are kept out of it.
  - The leg is solved by IK from the foot. The body rides the hip, so `bob` and `crouch`
    must never translate the whole figure, which would lift the feet off the ground.
  - A skyfowl dancer needs wing `flare` to get a wing above its head.
- **Named residents** each wear a fixed look from `src/creatures/residentFigures.ts`,
  which throws on a missing entry. Resident looks are never offered to the street
  picker.
- **Citizens are never `Mob`s.** `npm run verify:citizens-not-targetable` fails a
  target-picking system that mentions `Townsperson`. The fightable `SkyFowl` mobs wear
  the street-tough looks only.

### Cadence

A walk row is paced by distance, never by time: advance it with `gaitCyclesForDistance`
(`src/sprites/gaitCadence.ts`) over the look's cycle length (`citizenWalkCyclePx`). One
cycle must cover exactly the ground the planted foot sweeps, or the foot skates.
`gaitCyclesForDistance` caps the turn at one frame of the row per tick, so a shove or a
knockback never strobes the legs. Dance rows are opt-in per look (`TownCastLook.hasDance`,
`SkyfowlLook.dances`) and fall back to idle elsewhere.

### Cache

Citizens draw through the shared figure frame cache with `approx` on: a missing cell
borrows a nearby baked one instead of baking on the render path. The town pins its
crowd's `idle` and `walk` rows and warms `talk` only when a conversation starts. The rules
are in `docs/asset-management.md` ("A crowd is pinned, not swept").

### Review and gates

- `npm run render:human-cast` / `gates:human-cast` for the human cast.
- `npm run render:skyfowl-cast` / `gates:skyfowl-cast` for the skyfowl cast.
- `npm run render:residents` for the named residents.
- `npm run render:cast-motion` / `gates:cast-motion` check foot lock, cadence and dance
  energy.
- `npm run verify:plaza-perf` checks the plaza crowd's cache behaviour. It is headless
  and wall-clock sensitive.

`npm run render:townsfolk` gates the person-skeleton painter (cell bounds, stance plant,
cadence and more). Confirm the gate list in `scripts/render-townsfolk.ts` before stating
one.

Finish with the `dev-workflow` gates: `npm run typecheck`, `npm run lint`, `npm run format`.
