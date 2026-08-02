---
name: bipedal-figure
description: Draw or redraw a believable two-legged character (human, goblin, clown, humanoid boss/NPC) as generated sprite art in Kitten Crawler Man — the rig/pose/view contract, the choreography and bake-gate pipeline, the image-review loop, and the anatomy traps that only show up in a picture. Use whenever a bipedal character needs new art, a new animation row, or a believability fix. NOT for quadrupeds/vermin (use add-sprite) or runtime-seeded townsfolk (use add-person).
---

# Bipedal Figure Art

A bipedal figure is the hardest art in this codebase: the player reads a human
silhouette faster and more critically than anything else on screen, and almost
every defect that matters is invisible to `typecheck`, `lint`, and a code read.
It only shows up in a rendered image.

Follow the pipeline and read the trap catalog **before** authoring poses — most
of those traps cost multiple rounds of "it still looks wrong" to find the first
time.

> **Carl is the only figure in this game whose movement is convincing.**
> `carlArt.ts` + `generate-human-sprite.ts` are the *sole* reference for gait,
> limb motion, weight, and pose authoring. The goblin and clown pipelines are
> cited here **only** for build structure — bake gates, harness modes, prop
> silhouette — and their walks, idles and attacks are explicitly not a model to
> copy or measure against. If a motion question comes up, answer it from Carl or
> from `references/anatomy.md`, never by opening `goblinArt.ts` or `clownArt.ts`.

**Routing.** Bipedal enemies/NPCs/bosses that get a baked PNG sheet → here, then
`add-sprite` for the manifest/loader/draw-wrapper wiring and `add-creature` for
the gameplay class. Seeded runtime townsfolk → `add-person`. Non-bipeds → `add-sprite`.

## The four-file pipeline

Every bipedal figure in this repo is the same four modules. Copy the shape; do
not invent a new one.

| File | Job | Reference implementations |
| --- | --- | --- |
| `scripts/<name>Art.ts` | **The painter.** Palette ramps, proportions in tile units, the view table, the pose interface, the IK solver, and one `draw<Name><View>` per view over one shared pose type. Knows nothing about animation. | `carlArt.ts` — the rig to copy |
| `scripts/generate-<name>-sprite.ts` | **Choreography only.** One pose function per row, the row table, sheet geometry constants, tiles frames into the sheet, writes the PNG. Exports `ROWS`/`FRAME_W`/`FRAME_H`/`TILE_*` so nothing else can desync. | `generate-human-sprite.ts` — the **only** trustworthy motion reference |
| `scripts/generate-<name>-sprites.gates.ts` | **The bake gate** — the entry point in `package.json`, not the generator. Measures the baked pixels and the pose stream, throws on anything wrong, then writes. | `generate-goblin-sprites.gates.ts` (~20 gates) — structure only |
| `scripts/render-<name>.ts` | **The review harness.** Slices the sheet into a labelled contact sheet, plus per-part crops and an in-game-size strip. This is the only way the art gets judged. | `render-human.ts`; `render-goblins.ts` for its extra modes (`--mode=onion\|arc\|delta`) |

Wire `npm run gen:<name>` to the **gates** file. Add a `?<name>` preview scene
in `game.ts`'s `devBootScene` for in-motion checks.

## Procedure

1. **Read `references/anatomy.md` first.** It is the trap catalog, organised by
   body part. Skimming it costs minutes; rediscovering it costs review rounds.
2. **Pin the proportions.** Height in tiles, heads-tall, then every joint height
   derived from those two. Carl is `FIGURE_HEIGHT = 2.03` at `HEADS_TALL = 4.8`;
   goblins stand 0.76–0.86 tiles. **Never derive a body part from the head** — a
   game figure's head is deliberately oversized, so any life-drawing ratio hung
   off it inflates (`references/anatomy.md#proportions`).
3. **Write the `ViewSpec` table before any drawing code.** Head-on and edge-on
   are not one figure with a multiplier: a profile needs *two* lateral factors
   (`lateral` for limb roots, `girth` for torso width) plus `chestTaper`,
   `hipDepth`, `armSpread`, `crotchNotch`, and the `profile`/`showsFace`/
   `showsBack` flags. See the `ViewSpec` interface and the `VIEWS` table in
   `carlArt.ts`.
4. **Define the pose interface as targets, not angles — with FK escape hatches.**
   Hand/foot positions the IK reaches for is the right default; but a walking
   arm *must* be FK (`ArmAngles`), because IK from a hand target sweeps both
   segments together and the forearm flails. Both mechanisms coexist in
   `CarlPose`; the angles win for that arm when set.
5. **Author `restingPose()` and write every animation as edits to it.**
6. **Choreograph rows.** Walk rows at 16 frames, most others at 8; more frames
   buy smoothness only. Pace motion with a *phase speed* on the player/mob,
   never by scaling the frame index (`references/anatomy.md#timing`).
7. **Gate the bake.** Start from `references/gates.md` — the generalised gate
   list with what each one actually catches. At minimum: border-clip, anchor,
   loop closure, motion continuity, foot slide, and manifest sync.
8. **Review as an image, with an agent that only sees the image.** This is not
   optional and it is not one pass. See `references/review.md`.
9. **Wire it up** via `add-sprite` (manifest/loader/draw wrapper) and re-measure
   the tile anchor — health bars and aggro markers key off it and *will* be
   wrong after a redraw (`references/anatomy.md#anchor`).
10. **Validation gates:** `npm run typecheck`, `npm run lint`, `npm run format`.

## The three rules that generalise past this repo

- **Art has to be reviewed as an image, by something that only looks at the
  image.** Four blind rounds on Carl caught, in order: a five-head bobblehead,
  hips wider than shoulders, mitten hands, an unreadable face, sandal-strap
  toes, a jacket darker than the floor it stands on, and a barrel silhouette.
  Each round returned numeric targets. No code review caught any of them.
- **Silhouette beats detail, always.** The war hammer lost its identity the
  moment a spike was added: at 32 px the spike is two pixels and turns a
  rectangle into a star. If a shape is misread, fix the outline, never the
  interior.
- **A fix can entrench the bug it fixed.** Re-review after every "done" —
  four separate defects in this codebase lived *inside* a completed fix.

## References

- `references/anatomy.md` — the trap catalog: proportions, arms, legs, hands,
  feet, head/hair, clothing, views, depth shading, anchoring.
- `references/gates.md` — automated bake gates, what each catches, and the ones
  that are blind to what.
- `references/review.md` — the blind image-review loop, part crops, blind naming
  tests, and the diagnostic harness modes.
