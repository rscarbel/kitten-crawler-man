# Bake gates for a bipedal sheet

The gate module is the `package.json` entry point, **not** the generator — a
sheet that fails a gate must never reach disk. `generate-goblin-sprites.gates.ts`
is the reference implementation — grep it for `function gate` to see the full
set. It bakes into memory,
measures the pixels and the pose stream, throws with a numeric message, and only
then writes.

Give every gate an ID (`G3`, `G9c`) and put the ID in the message. Messages
carry the measured value *and* the limit — "the loop seam is 41.２ against a
median of 12.8" is actionable; "loop seam too large" is not.

## Pixel gates — measured on the baked sheet

| Gate | Checks | Catches |
| --- | --- | --- |
| **Border clip** | no ink on any cell border | a pose that outgrew its frame; the trap `generate-tree-sprites.ts` found first |
| **Anchor** | the figure's ink sits where `TILE_X`/`TILE_Y` claim | a redraw that silently moved the tile anchor |
| **Loop closure** | last→first frame delta vs. the median consecutive delta | a walk that pops once per cycle |
| **Motion continuity** | no consecutive-frame delta far above the median (with a declared-spike allowlist) | a snapped knee, a mid-swing draw-order flip, an IK clamp |
| **Centroid drift** | ink centroid step across the loop seam | a figure that slides in place |
| **One-shot settle** | last frame of an attack row vs. frame 0 of idle | an attack that hands off to a different pose |
| **Rotation safety** | the frame survives the rotations the renderer applies | corner clipping under rotation |
| **Texture size** | sheet dimensions against the asset budget | quiet asset bloat; report it even when it passes |

## Pose-stream gates — measured on the choreography, not the pixels

These are the ones worth writing for a *bipedal* figure specifically.

| Gate | Checks | Catches |
| --- | --- | --- |
| **Foot slide** | a planted foot must not move; a rolling contact must step monotonically | the classic moonwalk, and a stride that quietly exceeds leg reach |
| **Reach headroom** | hip→ankle distance < `THIGH + SHIN - JOINT_SLACK` on **every** frame | the hop: one clamped frame locks the leg straight and the next tuck snaps it back |
| **Prop-tip arc** | tip spacing between frames, excluding turnarounds | a cornered or discontinuous swing |
| **Off-hand grip** | the off fist is within that arm's length of the haft | a two-handed off hand painting in mid-air — identical on every frame, so invisible to every ratio and continuity gate |
| **Floor clearance** | the prop tip stays above the floor through the swing | a chop that buries the head, when the weapon is over half the figure's height |
| **Impact is the peak** | the declared impact frame is the extreme of the motion | a timing table that drifted from the choreography |
| **Timing table** | row names, frame counts and impact frames agree across generator, sheet and runtime | a row added in one place only |
| **Manifest sync** | the JSON manifest entry matches the measured geometry | the single most common wiring bug after a redraw |

**Gates go blind in pairs.** The off-hand-grip gate asks whether the fist
*reaches* the haft, which it does even when the arm has folded to a third of its
span with its elbow up behind the shoulder. If a gate answers "is it attached",
write its counterpart for "is it plausible" — span past half of reach, joint
angle within range.

## Distinctness gates (gore pieces, prop archetypes, NPC variants)

Compare every pair as a small binary mask (16×16) and fail over a threshold IoU
(62% works). **Normalise scale away but not aspect** — stretching each piece to
fill its own bounding box maps every convex blob onto a filled square and scored
a severed head against a rib slab at 71%, i.e. it measured the normalisation
rather than the art.

A distinctness gate proves the shapes are *different*, never that they are the
*right* shapes. Pair it with a blind naming test (`review.md`).

## Escape hatches

- `--skip-manifest-gate` for the measure→paste→re-run loop after a pose change.
- A declared-spike allowlist for continuity, keyed by archetype/row/frame, so a
  deliberate snap doesn't force the threshold up for every row.

Both should be explicit flags or tables, never a loosened threshold.
