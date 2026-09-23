# Reviewing a bipedal figure

**Art has to be reviewed as an image, by something that only looks at the
image.** Every defect that has ever mattered on a figure in this project was
invisible to `typecheck`, `lint`, and reading the drawing code, and visible
within seconds in a render.

## Look at it yourself first, every iteration

A blind reviewer is the second pass, not the first. Every change to a figure's
pixels goes round this loop, and an iteration whose images you did not open did
not happen:

1. **Render** to a scratchpad path, never the repo: the part crops you changed
   at 6× or more, the whole frame at 3–4×, and the row at the in-game 32 px on
   the dungeon floor. For motion, add the onion, delta and trails modes.
2. **Open every image with the Read tool.** Never judge from constants, code or
   a gate's numbers, and never reason "I changed X, so it now looks like Y".
3. **Write the critique before touching code**, as a viewer who has never seen
   the code: which part, which frame, what it looks like ("the calf is the same
   width from knee to ankle — a tube"), never "could be better". Walk
   silhouette, proportions, landmarks, value structure (light side, a
   terminator that follows the form's axis, shadow side; nothing airbrushed,
   muddy or flat), contact shadows, materials, face, grounding; and for motion,
   planted feet (a dot on the trails image), weight over the support foot,
   smooth arcs, easing, the kinetic chain foot→hip→shoulder→hand, overlap
   settling without seam pops, and whether the action can be named from the
   32 px strip alone.
4. **Compare, don't judge in isolation**: against the previous iteration
   (`--mode=compare`), against a real reference for the same pose (`--ref`),
   and against Signet at the same scale for form shading only.
5. **Fix the single worst defect first**, structure before detail. Every real
   fix on these figures has been structural — silhouette, terminator placement,
   joint phase — never another shading pass.
6. **Re-render and check the fix in the picture**, and that nothing else got
   worse. A fix that does not show up is reverted, not kept on faith.
7. **Log it** in the scratchpad: iteration, image paths, defects, change,
   verdict (better / same / worse).

**References are required, not optional.** Eadweard Muybridge's _Animal
Locomotion_ plates are public domain and photograph athletic men walking,
running, boxing, kicking, hammering, lifting, throwing, stooping, falling and
getting up — timing, contact frames, arm phase and flight share should match
them, not intuition. Public-domain anatomy plates cover the muscle landmarks.
Character likeness is judged against a text description of the source art;
never download cover art into the repo or hand it to a subagent as a file.
References live in the scratchpad and are never committed.

**When to stop.** Not when it "looks fine" and not when the gates pass. Stop when
the last few logged iterations were each marginal or sideways in the compare
view, two consecutive fresh blind reviewers name the figure and every action
from the 32 px strip and raise nothing major, and every remaining flaw has a
written ceiling statement: the flaw and the image showing it, at least two fixes
actually tried and their results, and the specific tooling limit that stops it
("a two-bone IK cannot foreshorten a knee pointed at the camera"; "detail under
about two pixels at 32 px is noise"). A flaw with no tried fixes is not at the
ceiling.

## The blind review loop

1. Render a contact sheet: `npm run render:<name>`, or
   `npx tsx scripts/render-<name>.ts --scale=2` for a flag. It goes to
   `preview/`, and the harness runs the art gates before it bakes anything.
   `npm run review:index` gathers every image in `preview/` into
   `preview/index.html`, which is how a human scans a batch of them.
2. Hand **only the PNG** to a fresh agent, with a target description (for Carl,
   the Dungeon Crawler Carl cover) and no access to the source. Ask for
   **numeric** findings: pixel measurements, ratios, and target values — not
   adjectives.
3. Apply the numbers. Re-render. Repeat.
4. **Run one more round after it looks right.** Four separate defects in this
   codebase have lived _inside_ a completed fix.
5. **Use a new reviewer every round.** One that has seen earlier versions grades
   on improvement, not on realism. Ask it to name the figure and the action, and
   for the three least realistic things and why.
6. **Reproduce every complaint in the image yourself before acting on it**, and
   every compliment before trusting it — a reviewer that delegates can
   fabricate. Where you disagree, its image-based complaint wins unless you can
   point at the pixels that refute it.

Four rounds on Carl produced, in order: a five-head bobblehead, hips wider than
shoulders, mitten hands, an unreadable face, sandal-strap toes, a jacket darker
than the dungeon floor it stands on, and a barrel silhouette.

## Part crops are what make the review possible

A whole-figure contact sheet hides exactly the defects that matter most at these
sizes. `render-human.ts --part=head|torso|hands|legs|feet` crops one body part
across all frames. Express the window as **fractions of the frame**, not in
pixels, so the table survives the figure re-deriving its own cell size — see the
`PARTS` tables in `render-human.ts` and `render-juicer.ts`, the latter of which
adds `arms` and `tail`.

Any new figure's harness gets its own equivalent table. The hands and the face
are where the review always finds the most.

## Judge at in-game size too

The harness must blit the same frames at the real tile size (`TILE_SIZE = 32`;
figures are painted at `tileScale: 64`). A silhouette that reads at 4× and dissolves at 32 px is
a failure — and this strip is where "detail does not rescue a wrong outline"
gets caught before it ships.

## The blind naming test

For anything that has to be _identified_ — a carried prop, a gore piece, a
distinct archetype — show the shape alone with no context and ask what it is.
The axe failed three attempts running (shovel, spade, boot, bucket) while two
redraws of its cutting edge changed nothing; the real faults were carry angle,
aspect, position along the haft, and flare.

A distinctness gate proves shapes are _different_. Only a naming test proves
they are the _right_ shapes.

## Diagnostic harness modes worth having

`scripts/render-human.ts` has the full set; its header lists the invocations.

- **sheet** (default) — every row, or `--row=` / `--frame=` / `--part=`, at
  `--scale=`.
- **onion**, **delta** — below.
- **trails** — per-frame paths of both ankles, both wrists, the pelvis, the head
  and the stamp anchor over a faint onion, with the ground line. Travelling rows
  add a ground-plane panel: a planted foot is a dot there, a skating one a
  smear.
- **strip32** — the row (or every row) at the in-game 32 px on the dungeon
  floor, with a 2× nearest-neighbour copy underneath. The primary realism
  judgement: review-scale beauty that dies at 32 px counts for nothing.
- **compare** `--against=<png>` — the current render beside a previous one or a
  reference, scaled to equal figure height and top-aligned.
- **`--ref=<png>`** with `--row` and `--frame` — a reference plate beside that
  frame, scaled to his head-to-ground height.
- **`--gear=<flags>`** (flags joined by `+`, or `bare`) — paints and gates that
  outfit alone; without it the gates run the default, bare and all-gear
  outfits.
- A run with no `--row` paginates the tall modes: `--out=foo.png` becomes
  `foo-p1.png`, `foo-p2.png`, … when one canvas cannot hold every row.

The same patterns in `render-goblins.ts` and `render-juicer.ts` are
build-tooling, independent of the goblins' (unconvincing) motion:

- **onion** — consecutive frames overlaid at low alpha. Shows a snap or a pop as
  a doubled edge.
- **delta** — per-frame difference against the previous frame. Locates _where_ a
  continuity gate fired.
- **arc** — traces a point (weapon tip, hand, ankle) across a row. A believable
  swing is a smooth arc; a cornered one is a rig bug.
- **parts** — the crop table above.

## In-motion checks a still cannot cover

Add a `?<name>` preview scene in `src/dev/devBoot.ts`. Carl's is `?human`
(`?human=<row>` opens on a row): one row looped at 128, 64 and 32 px at the
game's real pacing, and a live `HumanPlayer` driven through a fixed script so
the animator's hand-offs show rather than any one row. Browser automation _can_
drive this game (rAF, keyboard, synthetic canvas mouse events all work), but a
backgrounded tab freezes rAF entirely, so the loop does not run and every
frame-cost reading is a fiction — so **anything about timing or feel needs a
human**. Unregister the service worker first; it serves a stale bundle. Flag
these explicitly rather than claiming them:

- gait speed and whether the figure floats or plants
- health-bar and aggro-marker placement on the new anchor
- several instances of the same figure not breathing in lockstep
- death/gore tumble

What the browser _is_ worth doing, on the `?<name>` route with `?perf`:
confirming the figure renders through the frame cache at all, and reading the
figure-cache rows (hit %, MB/rows, bakes/direct-draws) as a sanity check.
`?paintbench` is where the per-cell paint cost that decides the prewarm regime
lives — the offline benches are node-canvas's software rasteriser and are a
magnitude, not a ranking.

## Where a picture is the only answer

A number is not enough whenever the figure cannot be compared pixel-for-pixel
against something known good. Produce a side-by-side of the two cells for every
state, an amplified per-pixel difference for any row that is not identical, and
the figure at in-game tile size next to its reference. A defect invisible at 4×
is often obvious at 1×, and the reverse. If the figure is parameterised — a
palette, a variant — review more than one: a change can look right in the
default and wrong in every other.
