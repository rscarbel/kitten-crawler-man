# Bake gates for a bipedal sheet

The gate module is the `package.json` entry point, **not** the generator — a
sheet that fails a gate must never reach disk. `generate-goblin-sprites.gates.ts`
is the reference implementation — grep it for `function gate` to see the full
set. It bakes into memory,
measures the pixels and the pose stream, throws with a numeric message, and only
then writes.

Give every gate an ID (`G3`, `G9c`) and put the ID in the message. Messages
carry the measured value _and_ the limit — "the loop seam is 41.２ against a
median of 12.8" is actionable; "loop seam too large" is not.

## Pixel gates — measured on the baked sheet

| Gate                  | Checks                                                                            | Catches                                                                        |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Border clip**       | no ink on any cell border                                                         | a pose that outgrew its frame; the trap `generate-tree-sprites.ts` found first |
| **Anchor**            | the figure's ink sits where `TILE_X`/`TILE_Y` claim                               | a redraw that silently moved the tile anchor                                   |
| **Loop closure**      | last→first frame delta vs. the median consecutive delta                           | a walk that pops once per cycle                                                |
| **Motion continuity** | no consecutive-frame delta far above the median (with a declared-spike allowlist) | a snapped knee, a mid-swing draw-order flip, an IK clamp                       |
| **Centroid drift**    | ink centroid step across the loop seam                                            | a figure that slides in place                                                  |
| **One-shot settle**   | last frame of an attack row vs. frame 0 of idle                                   | an attack that hands off to a different pose                                   |
| **Rotation safety**   | the frame survives the rotations the renderer applies                             | corner clipping under rotation                                                 |
| **Texture size**      | sheet dimensions against the asset budget                                         | quiet asset bloat; report it even when it passes                               |

## Pose-stream gates — measured on the choreography, not the pixels

These are the ones worth writing for a _bipedal_ figure specifically.

| Gate                   | Checks                                                                              | Catches                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Foot slide**         | a planted foot must not move; a rolling contact must step monotonically             | the classic moonwalk, and a stride that quietly exceeds leg reach                                                     |
| **Reach headroom**     | hip→ankle distance < `THIGH + SHIN - JOINT_SLACK` on **every** frame                | the hop: one clamped frame locks the leg straight and the next tuck snaps it back                                     |
| **Prop-tip arc**       | tip spacing between frames, excluding turnarounds                                   | a cornered or discontinuous swing                                                                                     |
| **Off-hand grip**      | the off fist is within that arm's length of the haft                                | a two-handed off hand painting in mid-air — identical on every frame, so invisible to every ratio and continuity gate |
| **Floor clearance**    | the prop tip stays above the floor through the swing                                | a chop that buries the head, when the weapon is over half the figure's height                                         |
| **Impact is the peak** | the declared impact frame is the extreme of the motion                              | a timing table that drifted from the choreography                                                                     |
| **Timing table**       | row names, frame counts and impact frames agree across generator, sheet and runtime | a row added in one place only                                                                                         |
| **Manifest sync**      | the JSON manifest entry matches the measured geometry                               | the single most common wiring bug after a redraw                                                                      |

**Gates go blind in pairs.** The off-hand-grip gate asks whether the fist
_reaches_ the haft, which it does even when the arm has folded to a third of its
span with its elbow up behind the shoulder. If a gate answers "is it attached",
write its counterpart for "is it plausible" — span past half of reach, joint
angle within range.

A second blindness with the same shape: a geometry gate proves where a part
_would_ be, never that it was painted. An arc-trace gate follows a joint, so it
passes cleanly on a claw that bakes as an invisible hairline — which is how a
sickle claw shipped unpainted once here. Pair every arc or reach gate with an
ink-presence gate that asserts the feature's own colour actually appears in the
frame. And express a presence threshold as a share of the frame's own ink, with
a hard floor — never as an absolute pixel count: a gate tuned on an adult sheet
is meaningless on a juvenile one a third the area, and one tuned on the juvenile
passes anything on the adult.

## Distinctness gates (gore pieces, prop archetypes, NPC variants)

Compare every pair as a small binary mask (16×16) and fail over a threshold IoU
(62% works). **Normalise scale away but not aspect** — stretching each piece to
fill its own bounding box maps every convex blob onto a filled square and scored
a severed head against a rib slab at 71%, i.e. it measured the normalisation
rather than the art.

A distinctness gate proves the shapes are _different_, never that they are the
_right_ shapes. Pair it with a blind naming test (`review.md`).

## Escape hatches

- `--skip-manifest-gate` for the measure→paste→re-run loop after a pose change.
- A declared-spike allowlist for continuity, keyed by archetype/row/frame, so a
  deliberate snap doesn't force the threshold up for every row.

Both should be explicit flags or tables, never a loosened threshold.
