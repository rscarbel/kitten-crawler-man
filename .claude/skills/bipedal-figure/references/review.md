# Reviewing a bipedal figure

**Art has to be reviewed as an image, by something that only looks at the
image.** Every defect that has ever mattered on a figure in this project was
invisible to `typecheck`, `lint`, and reading the drawing code, and visible
within seconds in a render.

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

From `render-goblins.ts` and `render-juicer.ts` — these are build-tooling
patterns, independent of the goblins' (unconvincing) motion:

- **onion** — consecutive frames overlaid at low alpha. Shows a snap or a pop as
  a doubled edge.
- **delta** — per-frame difference against the previous frame. Locates _where_ a
  continuity gate fired.
- **arc** — traces a point (weapon tip, hand, ankle) across a row. A believable
  swing is a smooth arc; a cornered one is a rig bug.
- **parts** — the crop table above.

## In-motion checks a still cannot cover

Add a `?<name>` preview scene in `src/dev/devBoot.ts`. Browser automation _can_
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
