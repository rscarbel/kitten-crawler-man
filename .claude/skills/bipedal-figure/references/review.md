# Reviewing a bipedal figure

**Art has to be reviewed as an image, by something that only looks at the
image.** Every defect that has ever mattered on a figure in this project was
invisible to `typecheck`, `lint`, and reading the drawing code, and visible
within seconds in a render.

## The blind review loop

1. Render a contact sheet: `npx tsx scripts/render-<name>.ts --out=review.png --scale=2`.
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
across all frames, in frame pixels:

```
head:  { x: 62, y: 62,  w: 68,  h: 68 }
torso: { x: 40, y: 60,  w: 112, h: 80 }
hands: { x: 32, y: 90,  w: 128, h: 60 }
legs:  { x: 40, y: 120, w: 112, h: 72 }
feet:  { x: 40, y: 150, w: 112, h: 42 }
```

Any new figure's harness gets its own equivalent table. The hands and the face
are where the review always finds the most.

## Judge at in-game size too

The harness must blit the same frames at the real tile size (`TILE_SIZE = 32`;
sheets are drawn at 2×). A silhouette that reads at 4× and dissolves at 32 px is
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

From `render-goblins.ts` — these are build-tooling patterns, independent of that
figure's (unconvincing) motion:

- **onion** — consecutive frames overlaid at low alpha. Shows a snap or a pop as
  a doubled edge.
- **delta** — per-frame difference against the previous frame. Locates _where_ a
  continuity gate fired.
- **arc** — traces a point (weapon tip, hand, ankle) across a row. A believable
  swing is a smooth arc; a cornered one is a rig bug.
- **parts** — the crop table above.

## In-motion checks a still cannot cover

Add a `?<name>` preview scene in `game.ts`'s `devBootScene`. Browser automation
_can_ drive this game (rAF, keyboard, synthetic canvas mouse events all work),
but rAF stalls to ~1 fps when the window is occluded — so **anything about
timing or feel needs a human**. Flag these explicitly rather than claiming them:

- gait speed and whether the figure floats or plants
- health-bar and aggro-marker placement on the new anchor
- several instances of the same figure not breathing in lockstep
- death/gore tumble
