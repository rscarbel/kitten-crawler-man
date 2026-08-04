# Tuskling redraw

The shipped `src/images/enemies/tuskling.png` was a legacy hand-made sheet: a
green teddy bear with one facing, no attack animation and no gore. It is
replaced wholesale by generated art on the `bipedal-figure` pipeline.

## Source description

> Tusklings are pink-skinned orcs with wide warthog-like heads that sit too close
> to their shoulders and wide torsos about 1.5 times larger than a human's, but
> are comically stubby from the waist down; they stand roughly 4'6" tall. Their
> faces are marked by black eyes and four crossed tusks: two long, curved tusks
> at the front, and a second pair further back. Some female Tusklings choose to
> pierce their tusks. Tusklings do not wear shoes on their hoofed feet.

**Deliberately omitted:** the tusk piercings. One sheet cannot carry "some
females"; baking a ring onto every Tuskling would make an individual trait a
species one. If per-instance variation is wanted later it needs a second sheet
or a runtime overlay, the way `troglodyte_tongue` is a second sheet.

## Read targets (what the silhouette must say at 32 px)

1. **Squat and wide** — the outline is wider than it is tall through the chest.
2. **No neck** — the head's jaw overlaps the shoulder line.
3. **Tusks break the head outline** on both sides; the front pair is the long
   one, sweeping up and out, and the rear pair scissors down across it.
4. **Stubby legs** — the hip sits at under a third of the standing height.
5. **Hooves, not feet** — a blunt cleft wedge, no toes.

## Proportions (tile units, origin between the hooves, +Y down)

4'6" against a 6'0" human is 0.75, so the figure stands `1.55` tiles and bakes
at `FIGURE_SCALE = 0.71`. Everything else derives from that height; nothing
derives from the head.

- `FIGURE_HEIGHT = 1.55`, `HEADS_TALL = 3.4`
- `HIP_Y = -0.4` — 26% of the standing height, which is the "stubby" spec
- `SHOULDER_HALF = FIGURE_HEIGHT * 0.138 * TORSO_BREADTH_MULTIPLE` — a human's
  shoulder share of its own height, times the source's torso multiple. Three
  blind image reviews pushed that multiple up in stages; the chest ends up about
  0.7 of the figure's height across, which is what actually reads as a hog.
- `KNEE_BEND_SLACK = 1.06` — the bones are longer than the column they stand in,
  so the creature stands with visibly bent knees *and* the IK has headroom to
  take a stride without clamping

## Files

| File | Job |
| --- | --- |
| `scripts/tusklingArt.ts` | the painter: palette, views, pose, IK, per-view draw |
| `scripts/tusklingGore.ts` | the eight severed pieces |
| `scripts/generate-tuskling-sprite.ts` | choreography, row table, bake, manifest check |
| `scripts/generate-tuskling-sprite.gates.ts` | 16 bake gates; the `npm run gen:tuskling` entry point |
| `scripts/render-tuskling.ts` | contact-sheet / part-crop / onion review harness |
| `src/sprites/tusklingAttackTiming.ts` | the one place the row lengths and impact frame live |
| `src/sprites/tusklingSprite.ts` | view selection, row priority, gore part list |
| `src/scenes/TusklingPreviewScene.ts` | `?tuskling` in-motion harness |

## Rows

16 rows. The cell size, the sheet size and the tile anchor are **measured at
bake time, never authored** — the generator prints the manifest entry it needs
and the gate verifies it rather than rewriting a file other agents also edit.

| Row | Frames | Views | Purpose |
| --- | --- | --- | --- |
| `idle` / `idle_side` / `idle_away` | 8 | all three | breathing, blink, nostril flare |
| `walk` / `walk_side` / `walk_away` | 16 | all three | locomotion |
| `hook` / `hook_side` / `hook_away` | 10 | all three | the melee tusk strike |
| `snort` / `snort_side` / `snort_away` | 12 | all three | charge wind-up, hoof rake |
| `charge` / `charge_side` / `charge_away` | 8 | all three | head-down sprint |
| `gore` | 8 | — | one severed piece per column |

Gore pieces, in spawn order: head, torso, arm, leg, ribcage, entrails, tusk,
jaw.

## Gameplay changes that came with the art

- The melee hit was previously dealt the instant the range check passed, with
  nothing on screen. It now plays the `hook` row and lands its damage on the
  frame the shared timing module names, so what the player sees and what hits
  them are the same event.
- The charging run is driven off its own frame counter at
  `TUSKLING_CHARGE_FRAME_HOLD`, not off `walkFrame`. A creature moving at
  `CHARGE_SPEED = 5` sampled at the walk cadence skips frames and reads as
  vibrating rather than sprinting.
- `bodyPartKey` is set, so a Tuskling now comes apart on death.
- The melee's cadence changed as a side effect: see the outstanding note below.
- A daze clears the action state; a hook interrupted by the Ball of Swine's
  stun no longer resumes mid-swing ten seconds later.

## Outstanding

- **[HUMAN]** In-game playtest via `?tuskling` and a real dungeon run: gait
  speed, whether the wind-up reads as a warning in the time available, whether
  the charge reads as speed rather than strobing, health-bar placement on the
  new tile anchor, and the death tumble.
- **[HUMAN]** The melee is now slower in DPS terms. Damage used to land the
  instant the range check passed; it now costs the 30 game frames of the hook
  *plus* the existing 70-frame cooldown, so a Tuskling in melee hits roughly 30%
  less often. That is the price of the blow being a visible event, but it is a
  balance change and wants a playtest rather than an assumption.
