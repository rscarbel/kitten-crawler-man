---
name: add-person
description: Townsfolk and citizens in Kitten Crawler Man — Taloncrest's closed cast of human and Hawkfolk looks, the species axis, citizen figures and their cadence and cache rules, interior occupants as data (placement, territory, bespoke-figure residents, routines such as mopping and target practice, services), plus the seeded person genome and skeleton painter (children, the ?people gallery). Use for any townsperson, crowd, resident or citizen work. NOT for creatures or bosses (use add-creature/add-sprite), and see bipedal-figure for painting on the human rig.
---

# Townsfolk and Procedural People

Two things live here:

- **The town's citizens.** A closed cast of authored human and Hawkfolk looks, chosen per
  citizen by seed. Every street and interior citizen is one of these. See "The town's
  citizens are a closed cast" below.
- **The person genome.** A seed becomes an appearance genome, drawn over a
  forward-kinematics skeleton with a real walk cycle. It paints the cast's two child
  looks and drives the `?people` gallery. It is not how an
  adult citizen is drawn.

**Routing:** use `add-creature` and `add-sprite` for enemies, bosses and animals. A new
adult look on the human rig also follows the `bipedal-figure` skill.

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
- **FK foreshortening:** `ARM_FRONTAL_X_SCALE` in `skeleton.ts` squashes an arm's horizontal
  swing for `down`/`up` so an elbow bend lifts the hand instead of splaying sideways; legs are
  solved by IK (`ikLeg`). If a front-facing arm swings out to the side, that constant (or the
  gait's arm amplitude) is why.
- All proportions are **fractions of draw size**, never pixels — a person looks identical at
  any `size`.
- These are game-world figures, so **raw `ctx` is correct here** — the `src/ui/*` helpers are
  for chrome only.
- **`heightScale` scales one axis.** It scales head height, leg, torso, arm and neck lengths, but
  not `shoulderWidth`, `hipWidth` or `FOOT_LEN`, which are flat fractions of draw size. A child
  therefore has an adult's shoulders and an adult's shoes. The head was corrected specifically;
  the rest is an open art decision, not a bug to fix in passing.

## The town's citizens are a closed cast, not seeds

Taloncrest's people are **not** drawn from a per-person genome. A cached cell is
keyed on figure, state and frame, so a per-instance colour serves the first citizen's
look to everyone. Every citizen wears one of a closed set of authored looks, and its seed
only picks which. `docs/town.md` ("Who lives here") covers the cast, the species ratio
and why the crowd is rolled from the world seed.

- **Species is its own axis.** `TownSpecies` (`src/systems/townSpecies.ts`) is carried
  by `ResidentDef`, `OccupantSpec` and `Townsperson`. `TownRole` is only a job, so never
  add a species to it. A service belongs to the occupant who keeps it
  (`OccupantSpec.service`), not to a role.
- **One dispatch point.** `pickCitizenFigure(seed, role, species, tier?)`
  (`src/creatures/citizenFigure.ts`) returns a `CitizenFigure`. `drawCitizenSprite`,
  `citizenWalkCyclePx`, `citizenFigureRows`, `prewarmCitizenFigure` and
  `prewarmAndPinCitizenTalk` dispatch on it. `Townsperson` never reads a look directly.
  A third species is a case here.
- **Room occupants are data.** An interior's people are `OccupantSpec`s in
  `BUILDING_OCCUPANTS` (`src/systems/buildingOccupants.ts`), run by
  `InteriorOccupantSystem`. A spec is five independent parts, each a discriminated union
  with a default:
  - `placement`: `anchor` (beside the first scanned furniture piece of a kind, the
    default shape), `prop` (on a `side` of a placed `TownInteriorPropId`, centred on its
    footprint, with optional `offset`/`distance`/`post`), `mark` (one authored tile and
    facing, for a hand-laid room such as the Cloak & Dagger's) or `roam`.
  - `territory`: `radius`, `rect` (whole tiles from the stand tile, so it always holds
    it) or `room`; absent, the activity's radius from `ACTIVITY_BEHAVIOR`.
  - `figure`: `citizen` (the default) or `bespoke`, below.
  - `routine` (`OccupantRoutine`, `src/systems/occupantRoutines.ts`): `mop` (the
    janitors, Puddles and Grout) or `target_practice` with a `targetProp` (Steve
    Cartwright, who holds fire while any crawler, companion or hireling crosses the line
    to the target; the bolt is cosmetic). A routine owns its timers, the pose the figure
    paints (`Townsperson.routinePose`) and its positional sounds
    (`occupantRoutineCues.ts`). A new routine is a union member plus a case in
    `startOccupantRoutine`, whose switch fails to compile until it is handled.
  - `service` (`OccupantService`, `src/systems/townServices.ts`): a `menu` counter, a
    fortune `reading` or a `desk` screen, with its prompt verb. Talk is routed to the
    occupant who keeps it, so one building can hold two people of the same role who
    both offer something.

  `npm run verify:interiors` checks every `prop` placement lands on a walkable,
  unreserved tile, every territory holds its stand tile, and every service resolves.
  `npm run render:town-interiors` shows where everyone stands.

- **Bespoke residents.** A resident drawn by a painter of their own (Sydney and the
  janitors on the crocodilian painter, Steve the otter, Old Lori, Brandon) is an entry
  in `BESPOKE_RESIDENT_FIGURES` (`src/creatures/bespokeResidentFigures.ts`) adapting that
  painter to the citizen draw state, mapping citizen actions and routine poses onto its
  rows, plus `figure: { kind: 'bespoke', id }` on their `OccupantSpec`. Nothing in
  `Townsperson` or the occupant system changes. `Townsperson.body` is the
  `TownspersonBody` union, and `townspersonBody.ts` dispatches draw, prewarm, cadence and
  voice on it.
- **Variety tiers trim the street's looks, never its roles.** The pick reads the
  variety tier (`src/core/perf/varietyTier.ts`): humans by `TOWN_CAST_TIER_PLANS` (role
  groups wearing their first role's looks), Hawkfolk by `hawkfolkStreetLookAllowance`.
  A `Townsperson` re-picks only after a purged canvas recovery, never while `frozen`
  in a conversation, and a named resident never. A `Townsperson` warms and pins nothing
  itself: its owner does, so a re-picked look is held by whoever holds the old one.
  `gates:human-cast` (H9,
  H10) and `gates:hawkfolk-cast` (G9) hold this. A new look joins the tier plans by where
  it sits: a group, and a role trimmed to one look, wear only the lead role's
  **first-listed** looks in `TOWN_CAST_LOOKS`, and Hawkfolk keep each street role's first
  civilian look before any other. So list a role's most representative look first; a
  human look that is first for none of its roles shows only at tier 0. A new `TownRole` joins a tier-2 group in
  `TOWN_CAST_TIER_PLANS`, or it keeps a look of its own there. Background:
  `docs/asset-management.md` ("Variety tiers").
- **Humans:** the looks are `TOWN_CAST_LOOKS` in `src/sprites/person/townCastLooks.ts`,
  picked by `pickTownCastLook(seed, role, tier)`, and each is painted as one `FigureDef` by
  `src/sprites/art/townCastFigure.ts`.
  - Adults paint on **the human rig** for his movement, never in his look.
    `castHumanLook` builds each one's `HumanLook` from `RIG_LOOK` (the rig's own build in
    Dave's colours, `looks/humans/rig.ts`), with the look's own skin, hair, garment ramp
    and cut (`RIG_GARMENT_CUT` spread and overridden), expression and build. Its
    `baseGarments` keep only his jacket, so his boxers are gone, and its
    hairstyle paints nothing, so his crop is gone; `castAttachments` in
    `townCastFigure.ts` paints the trouser seat (`human/legwear.ts`), the look's
    own hairstyle and facial hair (`human/castHead.ts`) and any hat or hood on
    the solved skeleton. The legs and feet are the cast-only `townsfolk_trousers`
    and `townsfolk_shoes` garments (`garments/human/townsfolkLegwear.ts`), sized
    off the rig's own leg contour and coloured per look with
    `setTownsfolkLegwear` (reset in `finally`). The player looks' item garments are
    `humanItemGarments()`, not every human garment. A role accessory
    comes from `src/sprites/art/human/townAccessories.ts`. No look uses Dave's
    skin or hair ramp, and no hairstyle is his crop.
  - Children paint on the person skeleton below, because the human rig is one adult's
    proportions and a shrunken adult reads as a doll.
  - Build width scales x only (`buildWidthScale`).
  - A cut's legwear comes from `GARMENT_LEGWEAR`: trousers under a short cut,
    stockings under a long hem. Both paint under the hem, inside the figure.
  - The look reaches the rig only as `BipedComposeOptions.look`, and every rig
    painter and attachment is handed it. A painter that imports a player look's palette
    instead of reading its `look` argument paints that look's colours on every
    citizen. Each look's `id` names its figures (`human:<lookId>…`), so two
    looks never share a cached cell.
- **Hawkfolk:** the rig, painter, outfits, rows and gait are in `src/sprites/art/hawkfolk/`,
  assembled in `hawkfolkCastFigure.ts`. `HAWKFOLK_CIVILIAN_LOOKS` is the only pool the
  street picks from. Resident, dancer and street-tough looks are kept out of it.
  - The leg is solved by IK from the foot. The body rides the hip, so `bob` and `crouch`
    must never translate the whole figure, which would lift the feet off the ground.
  - A Hawkfolk dancer needs wing `flare` to get a wing above its head.
- **Named residents** each wear a fixed look from `src/creatures/residentFigures.ts`,
  which throws on a missing entry. Resident looks are never offered to the street
  picker.
- **Citizens are never `Mob`s.** `npm run verify:citizens-not-targetable` fails a
  target-picking system that mentions `Townsperson`. The fightable `Hawkfolk` mobs wear
  the street-tough looks only.

### Cadence

A walk row is paced by distance, never by time: advance it with `gaitCyclesForDistance`
(`src/sprites/gaitCadence.ts`) over the look's cycle length (`citizenWalkCyclePx`). One
cycle must cover exactly the ground the planted foot sweeps, or the foot skates.
`gaitCyclesForDistance` caps the turn at one frame of the row per tick, so a shove or a
knockback never strobes the legs. Dance rows are opt-in per look (`TownCastLook.hasDance`,
`HawkfolkLook.dances`) and fall back to idle elsewhere.

### Cache

Citizens draw through the shared figure frame cache with `approx` on: a missing cell
borrows a nearby baked one instead of baking on the render path. A street crowd's
`idle` and `walk` rows are pinned by distance through its resident set
(`CrowdResidentSet`, registered with the scene's `WorldResidency`): a look is held
while any citizen wearing it is within reach of the party and released to the idle
sweep once all of them are well past it, in a city or out of one. Nothing pins or
queues a crowd look on construction. An owner that holds its citizens some other
way (a room's occupants) calls `prewarmTownspersonBody` itself. `talk` is warmed and
pinned only while a conversation is open (`prewarmAndPinCitizenTalk`, undone by
`unpinCitizenTalk`). The rules
are in `docs/asset-management.md` ("A crowd is pinned, not swept").

### Review and gates

- `npm run render:human-cast` / `gates:human-cast` for the human cast.
- `npm run render:hawkfolk-cast` / `gates:hawkfolk-cast` for the Hawkfolk cast.
- `npm run render:residents` for the named residents.
- `npm run render:cast-motion` / `gates:cast-motion` check foot lock, cadence and dance
  energy.
- `npm run verify:plaza-perf` checks the plaza crowd's cache behaviour. It is headless,
  fails only on cache counts, and paces bakes on a simulated clock, so machine load
  cannot change its verdict.

`npm run render:townsfolk` gates the person-skeleton painter (cell bounds, stance plant,
cadence and more). Confirm the gate list in `scripts/render-townsfolk.ts` before stating
one.

Finish with the `dev-workflow` gates: `npm run typecheck`, `npm run lint`, `npm run format`.
