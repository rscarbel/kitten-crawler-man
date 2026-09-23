# Art gates for a painted bipedal figure

A figure's gates live in `scripts/gates-<x>.ts` and are run by its review
harness, `npm run render:<x>` — **the gates first, before the contact sheet is
baked**. A contact sheet is a tens-of-megapixel allocation, and measuring the art
on the far side of one made the Juicer's centroid gate intermittently report a
seam at twice its true width. A gate that goes red on art nobody touched is the
one thing that teaches an agent to loosen a threshold.

There is no sheet on disk, so a pixel gate paints its own cells:
`bakeFigureCell(def, state, frame)` bakes exactly the way the runtime cache does
(supersampled, then downsampled), so what you measure is what the game blits;
`paintFigureCell(def, state, frame, density)` is the unbaked version when you
need one. `scripts/gates-juicer.ts` and `scripts/gates-goblins.ts` are the
reference implementations — grep either for `function gate`.

Accumulate failures rather than throwing one at a time, so one run reports
everything that is wrong; export `<x>GateFailures(): string[]` and let the
harness hand it to `reportFigureGates`. Give every gate an ID (`G3`, `G9c`) and
put the ID in the message. Messages carry the measured value _and_ the limit —
"the loop seam is 41.2 against a median of 12.8" is actionable; "loop seam too
large" is not.

**Read the vacuous-gate section of `SKILL.md` before writing any of these.**
Roughly a dozen gates in this project could not fail, and the shapes below are
exactly where that happened.

## The shared structural gate

`figureStructuralFailures(def, options)` in `scripts/figureGates.ts` covers what
every figure needs: states declared at all, a sane cell and `tileScale`, no ink
on a cell edge, no unexpectedly blank frame, and the widest pose filling enough
of its cell. Its options are exemptions, and each one has to be justified where
it is passed:

- `bleedEdges` — sides every state may legitimately run off. **Preferred over
  `edgeBleedStates`**, which exempts whole states: a blanket state exemption
  leaves the gate examining nothing, and it correctly self-fails.
- `sparseStates` — states exempt from the cell-fill check, e.g. one small gore
  piece in a cell sized for the whole creature.
- `blankFrames` — frames that legitimately paint nothing, declared both ways: a
  named frame that paints ink fails as loudly as an undeclared frame that paints
  none, so the exemption cannot quietly grow to cover a NaN.
- `minInkAreaShare` — a claim that the padding is bought by something (a tail
  plume, a raised limb, a swing arc).

## Pixel gates — measured on painted cells

| Gate                  | Checks                                                                        | Catches                                                   |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Border clip**       | no ink on any cell border                                                     | a pose that outgrew its cell                              |
| **Ground anchor**     | lowest **solid** pixel of every standing frame against the frozen tile box    | a figure floating off its ground line after a redraw      |
| **Loop closure**      | last→first frame delta against the median consecutive delta, as a _band_      | a walk that pops once per cycle, and one that holds still |
| **Motion continuity** | no consecutive-frame delta far above the largest ordinary step                | a snapped knee, a mid-swing draw-order flip, an IK clamp  |
| **Centroid drift**    | ink centroid step across the loop seam                                        | a figure that slides in place                             |
| **One-shot settle**   | the frames running into a one-shot's end converge on the idle it hands off to | an attack that hands off to a different pose              |
| **Rotation safety**   | the cell survives the rotations the renderer applies                          | corner clipping under rotation (gore especially)          |
| **Warm-row size**     | the **widest single state's** bytes against the cache's per-figure ceiling    | a figure whose busiest row cannot be admitted             |
| **Frozen geometry**   | re-derives the cell the way the deleted bake did and compares                 | art drifting off its own anchor; a silent scale change    |

**The anchor gate is a rewrite, not a port.** Write it as: lowest solid pixel
(not ink — a contact shadow sits on the ground line wherever the feet are) of
every idle frame, measured on a canvas **padded on all four sides** (in a tightly
padded cell every translation big enough to fail an anchor check clips first, so
the clipping gate speaks and the anchor gate is redundant), against the frozen
tile box, with **asymmetric tolerances** — a floating figure needs a tight one, a
shoe sole legitimately hanging below the line needed 17 px on one clown, and a
single combined number has to be loosened until it catches nothing. A figure that
hovers by design has no ground-line gate at all; what still has to hold there is
the _lateral_ anchor, the body over the tile the game aims at.

**The warm-row budget measures per-state cache residency, not whole-sheet size.** A painted
figure is admitted to the cache one state at a time, so the number that decides
whether it fits is the widest state's bytes, not the sum. Measure over every
state the def declares, gore pieces included — a scan of the pose rows alone
leaves the single-frame states out of the accounting entirely. The resident cell
is the declared cell at bake scale; multiplying by the supersample overstates the
footprint fourfold.

## Pose-stream gates — measured on the choreography, not the pixels

These need no pixels at all, and they are the ones worth writing for a _bipedal_
figure specifically.

| Gate                    | Checks                                                                             | Catches                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Foot slide**          | a planted foot must not move; a rolling contact must step monotonically            | the classic moonwalk, and a stride that quietly exceeds leg reach                                                     |
| **Reach headroom**      | hip→ankle distance < `THIGH + SHIN - JOINT_SLACK` on **every** frame               | the hop: one clamped frame locks the leg straight and the next tuck snaps it back                                     |
| **Arm reach**           | elbow angle in range, and an IK-placed hand within its arm's span                  | a forearm flailing where joint angles were wanted                                                                     |
| **Prop-tip arc**        | tip spacing between frames, excluding turnarounds                                  | a cornered or discontinuous swing                                                                                     |
| **Off-hand grip**       | the off fist is within that arm's length of the haft                               | a two-handed off hand painting in mid-air — identical on every frame, so invisible to every ratio and continuity gate |
| **Floor clearance**     | the prop tip stays above the floor through the swing                               | a chop that buries the head, when the weapon is over half the figure's height                                         |
| **Impact is the peak**  | the declared impact frame is the extreme of the motion                             | a timing table that drifted from the choreography                                                                     |
| **Timing table**        | row names, frame counts and impact frames agree between the figure and the runtime | a row added in one place only                                                                                         |
| **Runtime state names** | every state name the runtime can compose is one the figure paints                  | an invisible creature and no log line                                                                                 |
| **Frozen measurements** | every offline-measured constant re-measured from the art                           | a recentring offset or head clearance that went wrong on a redraw                                                     |

**Gates go blind in pairs.** The off-hand-grip gate asks whether the fist
_reaches_ the haft, which it does even when the arm has folded to a third of its
span with its elbow up behind the shoulder. If a gate answers "is it attached",
write its counterpart for "is it plausible" — span past half of reach, joint
angle within range.

A second blindness with the same shape: a geometry gate proves where a part
_would_ be, never that it was painted. An arc-trace gate follows a joint, so it
passes cleanly on a claw that bakes as an invisible hairline — which is how a
sickle claw shipped unpainted once here. Pair every arc or reach gate with an
ink-presence gate that asserts the feature's own colour actually appears. And
express a presence threshold as a share of the frame's own ink, with a hard
floor — never as an absolute pixel count: a gate tuned on an adult figure is
meaningless on a juvenile one a third the area.

A third: **an absolute physical limit on an IK-driven quantity is usually
unfailable**, because something upstream clamps and any mutation big enough to
break the threshold trips a different gate first. If the subject is the end of a
chain, assert an _ordering between rows_ — "the slam reaches lower than every
other row" — not a frozen height.

## Distinctness gates (gore pieces, prop archetypes, NPC variants)

Compare every pair as a small binary mask (16×16) and fail over a threshold IoU
(62% works). **Normalise scale away but not aspect** — stretching each piece to
fill its own bounding box maps every convex blob onto a filled square and scored
a severed head against a rib slab at 71%, i.e. it measured the normalisation
rather than the art.

Gore cells are compared **as blitted**, and each piece's frozen recentring offset
moves it — so a duplicate-piece mutation must duplicate the offset too, or it
reddens the recentring gate instead and makes the distinctness gate look
unfailable when it is not. Freeze a recentring offset in cell pixels, gate it on
its _effect_ ("the ink lands on the cell centre") rather than by re-deriving the
same arithmetic, and re-measure per variant even in a family that shares a table.

A legibility threshold does not transfer between subjects: severed limbs sit
~65 % apart, stone chunks ~19 % because they are _meant_ to look alike. Re-scope
the gate to what it can prove there rather than loosening it onto shipped art.

A distinctness gate proves the shapes are _different_, never that they are the
_right_ shapes. Pair it with a blind naming test (`review.md`).

## Escape hatches

- A declared-spike allowlist for continuity, keyed by row/frame, so a deliberate
  snap doesn't force the threshold up for every row.
- Split a motion gate **by view** rather than loosening one number onto both: an
  end-on row cannot support a per-step floor at all, so put the floor on the
  profile row and a widest-step minimum on the axial ones. The same applies to a
  row that _holds_ — take the median of the moving steps, not of all of them, or
  a row that sits still for four frames and then swings a whole leg (median 5 px,
  largest 385 px) cannot be gated at any setting.

Both should be explicit flags or tables, never a loosened threshold.

## Carl's gates (`scripts/gates-human.ts`)

`npm run render:human` runs all of them before it bakes anything, once per
outfit: the default outfit, bare, and every piece of gear at once (a named
`--gear=` gates that outfit alone). Gates that measure his body rather than his
clothes (G4, G21) measure the default outfit whatever outfit the run gates.
`PENDING_GATES` and `PENDING_ROWS` exist for a gate whose defect is known and
being fixed; both are empty, and a pending entry that goes green prints a
notice to take it out.

"Proven red" names the injected defect that was watched turning the gate red on
unchanged gates; every gate below has one, and every filtering loop in the module
fails when it examines nothing (breaking the lookup it filters on goes red, not
green).

| Gate | Asserts                                                                                                                                                                                                                                                                                                               | Proven red by                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | The shared structural gate: states declared, sane cell, no ink on the border, no blank frame, the widest pose fills its cell.                                                                                                                                                                                         | `jab_side[5]` lifted 1.6 units (border ink); NaN in its pose (blank frame)                                                                                                                                                       |
| G2   | Standing rows' lowest **solid** pixel sits on the ground line. Cannot catch a wrong `tileX`/`tileY`/`GROUND_OFFSET_IN_TILE` (paint origin and gate share one expression); only a redraw that lifts or shifts him.                                                                                                     | `idle_side` lifted 5 px; blind to the anchor constants by construction                                                                                                                                                           |
| G3   | Every loop closes in a band: no pop across the seam, no held frame.                                                                                                                                                                                                                                                   | `walk_side` sampled over 1.5 turns (pop); over `frameCount − 1` (held seam)                                                                                                                                                      |
| G4   | No silhouette step far above the row's median, no dead frame, and on loops no joint (wrist, ankle, head) jumping more than 2.2× the row's third-largest joint step. A one-shot's silhouette allowance is wide, so there it catches only a limb thrown where no frame of the row goes; one-shots have no joint clause. | `walk_side[5]` arm flung 2 rad and a skipped head-on `walk` frame (joint clause); `idle[3]` arm flung; `cross_side[2]` = frame 1 (dead frame)                                                                                    |
| G5   | Every strike row names `strike.reachLimb` (fist, foot, knee, lead shoulder) and optional `drive: 'down'`; the part is driven furthest out — or, driven down, stops coming down — exactly on the impact frame, and a punch's named fist is out on that frame. A strike naming no part fails.                           | `cross_side[4]` arm pulled back; `knee_side[5]` knee overshoots; `hammer_down[5]` fist sinks on; `barge_side[5]` shoulder overshoots; `stomp_down` lands a frame early; `hook_side` re-declared `leftHand`; `reachLimb` stripped |
| G6   | A stomp is at its apex the frame before impact and its stamping sole (probed, not the pose's planted flag) is on the floor from impact on.                                                                                                                                                                            | `stomp_down[4]` foot left at its apex with `rightFootPlanted` still true                                                                                                                                                         |
| G7   | Every `stampAnchor` sits under the stamping heel on the impact frame, across and down the screen.                                                                                                                                                                                                                     | mutation-proven (anchor x +0.1; `smush_side[3]` feet +0.15)                                                                                                                                                                      |
| G8   | Every row the runtime can name is painted, with the table's frame count, and mirrorable rows are profile rows.                                                                                                                                                                                                        | `jab_side.frameCount` 9; `idle.mirrorable`; impact frame out of range                                                                                                                                                            |
| G9   | Reports the widest warm row's bytes.                                                                                                                                                                                                                                                                                  | mutation-proven (`build` grown to 24 frames)                                                                                                                                                                                     |
| G9b  | The working set — always-drawn rows, every opener's wind-up, the busiest strike family standing and moving, the Smush set of one release window, and stand-by rows to their held frame — fits `HUMAN_FIGURE.budgetMegabytes` via `figureByteBudgetFor`.                                                               | `build` loops made always-drawn; cross/hook/jab grown to 16 frames                                                                                                                                                               |
| G10  | A foot in stance holds its ground position: the cell drift plus the floor's drift under him — the sprite's whole travel in profile, `HEAD_ON_FLOOR_FORESHORTENING` of it head-on, where the floor is drawn foreshortened.                                                                                             | mutation-proven (`walk_side` stride ×1.25; head-on floor drift at full scale)                                                                                                                                                    |
| G11  | At each profile foot contact the same-side arm is back and the other forward.                                                                                                                                                                                                                                         | mutation-proven (arms a quarter cycle late)                                                                                                                                                                                      |
| G12  | Every looping row blinks once per cycle, shut on the run's middle frame.                                                                                                                                                                                                                                              | mutation-proven (blink peaks at 0.6; a second shut frame)                                                                                                                                                                        |
| G13  | No leg chain is clamped by the IK on a frame with a foot down; the run's flight frames are exempt.                                                                                                                                                                                                                    | mutation-proven (`idle_side` foot past reach)                                                                                                                                                                                    |
| G14  | Every run has a flight phase in the Muybridge band; no walk has one; a table with no walk row fails.                                                                                                                                                                                                                  | `run_side` feet planted every frame; `walk_side[3]` airborne; every `gait: 'walk'` stripped                                                                                                                                      |
| G15  | Replayed with real `HumanPlayer`s at every facing, target kind and stride phase: the impact frame is drawn on the tick the hit scores, the stamp on the tick the blast fires, and every strike and stomp row is reachable.                                                                                            | mutation-proven (impact frame and frame count shifted)                                                                                                                                                                           |
| G16  | One facing, one view: strikes, stride, idle and Smush agree with `viewForFacing`, and a thrown blow's row and mirroring hold for the whole swing; the latch clause fails if it examined no swing ticks.                                                                                                               | front family in side facings; strike re-latched to the live facing; swings ending before their first tick                                                                                                                        |
| G17  | At the 32 px tile each thigh, calf and forearm shows luminance spread inside its own modelled width, at full and low-end bake density.                                                                                                                                                                                | mutation-proven (flat skin)                                                                                                                                                                                                      |
| G18  | Standing head-on at game size he is taller and broader than a typical townsperson at theirs.                                                                                                                                                                                                                          | mutation-proven (`HUMAN_SCALE` 0.57)                                                                                                                                                                                             |
| G19  | In the front idle no dark line separates an arm from the torso: the outline pass inks nothing inside the figure, and no part draws a line of its own.                                                                                                                                                                 | mutation-proven (dark stroke down the arm bone)                                                                                                                                                                                  |
| G20  | Every declared entry/exit foot phase matches the cycle it hands to, and the animator's replayed cuts (set off, stop, blow and Smush at every phase, guard drop) jump the ankles no more than the stride's own largest step.                                                                                           | mutation-proven (wrong entry phase; `idle_side` foot moved)                                                                                                                                                                      |
| G21  | `HUMAN_STATUS_FIGURE_BOX` still wraps his standing solid ink at the 32 px tile.                                                                                                                                                                                                                                       | `idle_away` lifted 0.05; box top and half-width constants changed                                                                                                                                                                |
| G22  | Every head-on frame puts his own right side where its view does.                                                                                                                                                                                                                                                      | mutation-proven (front `mirrored` off)                                                                                                                                                                                           |
| G23  | The composing surface holds everything painted on it: each cell repainted on a whole-cell surface matches.                                                                                                                                                                                                            | board prop reach emptied; `LAYER_MARGIN` 0.42 → 0.12                                                                                                                                                                             |
| G24  | The gauntlet is steel from the frame before a right-fisted punch lands to the frame after, then smoke; the bracer on every other frame; and each punch's impact cell painted spiked differs from the same cell painted with the bracer by at least 12 px (the smallest shipped difference is 25).                     | `SPIKED_BEFORE_IMPACT` 0 (timeline); `drawGauntlet` always painting the bracer (paint)                                                                                                                                           |
| G25  | On every upright profile frame the near arm's bones pass at least half a head radius from the eye the head painter draws: laid across the face it leaves only hair and ear, which reads as the back of his head.                                                                                                      | mutation-proven (profile elbows bending by `elbowFlare`; the Smush chamber raising the rear fist overhead)                                                                                                                       |
| G26  | On every head-on travelling frame no leg is drawn more than 10% longer than his standing leg, and no planted leg's drawn length is more than 10% of a standing leg off the length it would have with no floor depth: the legs never grow or telescope as the body runs up or down the screen.                         | the floor drawn at full scale (`HEAD_ON_FLOOR_FORESHORTENING` 1: 36% growth, 60% stretch)                                                                                                                                        |
| G27  | On every upright profile frame the head, painted alone in its own frame (hair, skull, nose and ear), is no deeper than 0.7 of the jacket's chest band painted alone along the spine: past it the head reads as big as his torso edge-on.                                                                              | a bigger head (`HEADS_TALL` 4.8, `HEAD_DEPTH_RATIO` 0.9: 0.78 on 503 frames); the back-of-crop tufts alone standing off the skull (`PROFILE_BACK_TUFT_SHARE` 1.4: 0.78)                                                          |

Outside the module: `npm run gates:figure-cache` includes a painter that throws
mid-save and asserts no later cell inherits its clip or alpha, and
`npm run bench:figure-paint` fails when Carl's slowest cell — in the default outfit or
in all his gear — bakes over the cache's per-frame bake budget (converted to node time), after
self-testing that a deliberately slow figure is caught.
