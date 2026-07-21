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
- `gait.ts` — `poseForMotion(app, facing, phase, moving)`: contralateral walk + idle.
- `drawPerson.ts` — `drawPerson(ctx, sx, sy, size, app, phase, facing, moving)`.

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

## Populating the world (future)

No town scene exists yet. To spawn wandering people, add a `GameSystem` (see `add-system`)
that holds `{ x, y, facing, phase, appearance, seed }` per person, advances `phase`, moves +
picks `facing` from velocity, and calls `drawPerson` Y-sorted into the render pipeline.

Finish with the `dev-workflow` gates: `npm run typecheck`, `npm run lint`, `npm run format`.
