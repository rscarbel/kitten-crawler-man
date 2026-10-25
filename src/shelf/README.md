# The shelf

Finished painted characters that have no place in the game yet. Each one is a
complete figure (painter, choreography, gore and a runtime wrapper) kept here
until a role is found for it, so the work keeps compiling and stays renderable
instead of rotting in history.

## Rules

- **One folder per character**, named after the character in camelCase.
- **Nothing outside `src/shelf/` and `scripts/` may import from it.** The game
  never reaches the shelf, so a shelved character costs nothing in the bundle.
  Check with `grep -rn --include='*.ts' "shelf/" src | grep -v "^src/shelf/"`,
  which must print nothing.
- **Each character keeps its art gates and render harness** in `scripts/`
  (`gates-<name>.ts`, `render-<name>.ts`, `render:<name>` in `package.json`, both
  files in `tsconfig.scripts.json`), so it still renders and keeps compiling.
- **Each character has an entry below**: its look, its rows, the render command,
  any audio kept with it, and what it lacks to go live.

A shelved character may import shared infrastructure (`src/sprites/figure/`,
the `bipedArt` helpers, `softShade`, the gore helpers, `SpriteRenderer`'s frame
index helpers) but nothing game-side: no creature class, room, system or effect.

Bringing one into the game means moving its folder under `src/sprites/`, writing
the creature class, and wiring its audio through `src/audio/`.

## Characters

### Auntie Gorge

`src/shelf/auntieGorge/` — a towering, enormously stout woman, about fifteen feet
tall: a small head on a bell-shaped body, sloping shoulders, no neck, a bare belly
hanging between a stained vest ridden up under the bust and dark trousers pushed
down under the gut, heavy arms held off her sides, and worn slippers. Her walk is a
slow side-to-side rock with the belly arriving a beat after the hips; her heave
rears back, swells, then lunges forward with the jaw dropped and a string of
spittle off the chin.

| Row                                          | Frames       | Views             |
| -------------------------------------------- | ------------ | ----------------- |
| `walk`, `walk_side`, `walk_back`             | 12, looping  | front, side, back |
| `heave`, `heave_side`, `heave_back`          | 12, one-shot | front, side, back |
| `idle`, `idle_side`, `idle_back`             | 6, looping   | front, side, back |
| `gore_*` (head, both arms, both legs, torso) | 1 each       | —                 |

- Render: `npm run render:auntie-gorge` (gates in `scripts/gates-auntie-gorge.ts`;
  `--mode=sheet|poses|parts|gore|onion|delta|strip`, `--out=<path>`).
- Audio: `audio/auntie_gorge_hurt_1.mp3` to `audio/auntie_gorge_hurt_3.mp3`, her three hurt
  cries, not registered in `src/audio/`.
- No creature class, no role yet.

### Iron Iggy

`src/shelf/ironIggy/` — a hulking bodybuilder lizard, about 2.3 tiles tall: a small
crested skull with a blunt muzzle on a colossal frame, a trapezius climbing toward
the ears, a lat flare far wider than the pelvis, thick but plainer legs, and a heavy
banded tail carried off the floor. Olive hide over a pale belly-plate underside that
doubles as pec and ab definition, purple gym shorts and lifting wraps. He carries a
dumbbell in his right hand (drawn as an overlay from the gym painters, through hand
anchors), heaves it overhead to throw it, and rears up to drive both fists into the
floor.

| Row                                                               | Frames       | Views             |
| ----------------------------------------------------------------- | ------------ | ----------------- |
| `idle`, `idle_side`, `idle_away`                                  | 8, looping   | front, side, back |
| `walk`, `walk_side`, `walk_away`                                  | 16, looping  | front, side, back |
| `sprint`, `sprint_side`, `sprint_away`                            | 12, looping  | front, side, back |
| `throw`, `throw_side`, `throw_away`                               | 10, one-shot | front, side, back |
| `punch`, `punch_side`, `punch_away`                               | 12, one-shot | front, side, back |
| `gore_*` (head, torso, arm, forearm, thigh, shin, entrails, tail) | 1 each       | —                 |

- Render: `npm run render:iron-iggy` (gates in `scripts/gates-iron-iggy.ts`;
  `--mode=sheet|parts|gore|onion|delta|arc`, `--row=`, `--part=`, `--frame=`,
  `--scale=`, `--out=<path>`).
- Audio: `src/shelf/ironIggy/audio/iron_iggy_grunt.mp3`, his grunt, not registered
  in `src/audio/`.
- No creature class, no role yet.
