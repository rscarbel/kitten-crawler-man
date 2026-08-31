---
name: add-ground-tile
description: Add or tune a procedurally generated ground/floor material for any floor of Kitten Crawler Man — seamless tiles, multi-tile patches, corner transition masks, the ?tiles review route. Use for terrain, floors, paving, walls-as-texture, or any new tileset. NOT for creature/item/prop art (use add-sprite).
---

# Add a Ground Material

Ground and floor textures are **painted by code in this repo**, not drawn or
prompted — and the shipped game paints them for itself at runtime rather than
loading a PNG. `npx tsx scripts/generate-ground-tileset.ts [artSeed]` runs the
same painters offline and writes review sheets to `preview/tilesets/`.

> **Why generated:** tileability is a _mathematical_ property — the pixels at
> x = 63 must be the neighbours of the pixels at x = 0. Image models have no
> mechanism to satisfy that, which is why the previous ChatGPT-generated
> `overworld_tileset.png` needed hand-repair per tile and still didn't wrap
> (measured: 6–11 mean edge error where seamless is 0–3; only 6 of its 132 tiles
> were ever usable). Sampling noise on a torus makes it true by construction.
> See `docs/town.md` for how the generated ground is wired into the town.

## Pipeline

```
src/map/tilegen/noise.ts        NoiseField — value/fbm/worley/warp, all wrapped
src/map/tilegen/raster.ts       Surface + wrapping primitives (disc, stroke, chunk)
src/map/tilegen/palette.ts      Ramps, sampled from art that already works
src/map/tilegen/materials.ts    ← the painters. Almost all work happens here
src/map/tilegen/masks.ts        16 corner transition masks
src/map/tilegen/patchSlice.ts   patch slicing + the wrap-seam measurement
src/map/tilegen/sheetConfigs.ts which materials sit on which sheet, and their seeds
src/map/ground/runtimeGroundSheets.ts  paints a sheet for the live game
src/map/environmentArtCache.ts  the paced queue every runtime sheet arrives through
scripts/tilegen/sheet.ts        node-canvas + fs: the review baker only
scripts/generate-ground-tileset.ts   the review baker's entry point
```

The painters are pure `Float64Array` maths with no canvas and no filesystem,
which is what lets the game and the offline harnesses run the identical code.

The sheets are `ground_overworld`, `ground_floor1`, `ground_floor2`,
`ground_interior` (town building interiors), `ground_dungeon` (the shared Bopca
station set) and `ground_masks`. Their manifest entries still live in
`src/images/environment/tilesets/manifest.json` — a row's `frameCount`,
`patchTiles` and label are what every draw site and every material union is
written against — but the entries declare **no `path`**, which is what marks a
sheet as painted rather than fetched.

A sheet config pins a `seedSlotBase`. Slots decide a material's structure seed, so
reordering or adding sheets must never shift an existing material's slot — that
regenerates art that has already been reviewed.

## The floor art seed

Each generation of a floor paints its ground under its own art seed, so two
playthroughs of the same floor differ in grain and joint layout while staying
inside the reviewed envelope. `GameMap` draws the seed in its constructor and
keeps it for the life of the object, so art changes exactly when layout changes —
a checkpoint restore rewinds the same map and keeps its art. Painters read it
through `floorArtSubSeed(SOME_SALT)` in `src/map/ground/floorArtSeed.ts`, never
raw, so a new consumer cannot perturb an existing one's stream.

**The seed space is enumerated, not sampled.** `drawFloorArtSeed` picks from
`src/map/ground/artSeedAlphabet.ts`, a generated list every member of which has
been painted offline and measured. Regenerate it with
`npm run gen:floor-art-seeds` and re-verify with `npm run verify:floor-sweep`
**whenever you change a painter, a ramp or a sheet config** — a material's
behaviour across the seed space is not something the reviewed seed can tell you.
Seeds that fail are simply never admitted.

What may vary per floor: material structure and detail seeds, the renderer's
world-space tone fields, and which variant lands on which patch. What must not:
contrast and busyness parameters, material assignment, palette identity, mask
geometry, and the luminance separation between a wall and the floor in front of
it.

## Adding a material

1. **Write the painter** in `src/map/tilegen/materials.ts`:

```ts
const myFloor: Material = {
  id: 'my_floor',
  label: 'Shown in the ?tiles route',
  patchTiles: 4, // 1 | 2 | 4
  variants: 2,
  paint: (ctx) => {
    paintNoiseGround(ctx, MY_RAMP, { patchPeriod: 8, patchWeight: 0.45, contrast: 0.8 });
    paintMineralGrain(ctx, MY_RAMP, ctx.detail + 24);
  },
};
```

2. Add it to the `MATERIALS` array.
3. Name it in a sheet's `materials` list in `src/map/tilegen/sheetConfigs.ts`
   (or add a new sheet config for a new floor). Append, never insert.
4. Add its row to that sheet's manifest entry, and its blend order, measured
   fallback colour and spill to the palette that owns it.
5. Run the review baker. It **fails** if any patch develops a seam.
6. Rebuild the seed alphabet (`npm run gen:floor-art-seeds`) and sweep it
   (`npm run verify:floor-sweep`) — the new material has to hold across every
   seed the game can draw, not just the one you looked at.
7. Review at `localhost:8080/?tiles` (click toggles materials/transitions;
   right-click rerolls the art seed).

## The four rules

**1. Sample only through `ctx.noise`.** Those functions wrap at the patch size.
A hand-rolled `Math.floor(x / n)` or `%` against a warped coordinate tears the
joint — JavaScript's `%` goes negative and flips pattern parity exactly at the
edge. Use `positiveMod` when you need modular arithmetic.

**2. Geometry from `ctx.structure`, detail from `ctx.detail`.**
Wrapping makes a patch seamless against _itself_, **not** against a
differently-seeded sibling. Two variants of a paved material whose stones were
laid by different seeds will not line up where they meet, and the mismatch reads
as a grid. Share the structure seed across a material's variants so the stonework
stays continuous; let tints, wear and scatter vary per variant.

**3. Joint contrast is a budget.** At `TILE_SIZE = 32` a dark joint every half
tile is a hard line every 16 screen pixels, and a whole floor of that is
exhausting. Prefer large units, soft joints (`jointStrength` well below 1), a
narrow bevel band, and always ship a **calm** jointless material (see
`f1_flagstone`, `f2_concrete`) that can hold a long stretch of ground without
incident. Use the
jointed variants for edges, thresholds and accents.

**4. Keep large-scale tone out of the tile.** A low `patchPeriod` puts one big
light-to-dark sweep inside each patch, so patches read as tonal blocks even when
their pixels match perfectly at the joints. Broad variation belongs in the
renderer's world-space noise layer. Keep `patchPeriod` at 8 or higher unless a
dense detail pass (grass blades, gravel chips) covers it.

## Patch size

A patch is `patchTiles × patchTiles` game tiles generated as **one** wrapped field
and sliced afterwards, so the repeat period is the patch, not the tile. That is
what lets a flagstone span more than one tile and what stops paving from
repeating every 64 px.

| patchTiles | Use for                                                 | Frames per variant |
| ---------- | ------------------------------------------------------- | ------------------ |
| 1          | nothing, really — kept for masks                        | 1                  |
| 2          | fine stochastic materials (grass, dirt, rubble)         | 4                  |
| 4          | anything with visible units (paving, slabs, calm stone) | 16                 |

Frames are ordered **variant-major, then row-major within the patch**. The frame
for map tile `(tx, ty)` is:

```ts
variant * patchTiles ** 2 + positiveMod(ty, patchTiles) * patchTiles + positiveMod(tx, patchTiles);
```

with `variant` hashed from the _patch_ coordinates (`floor(tx / n)`,
`floor(ty / n)`) so a whole patch keeps one variant. `TilePreviewScene.frameIndex`
is the reference implementation — keep the renderer identical to it.

## Transitions between materials

Sixteen corner masks on the `ground_masks` sheet, indexed by which of a tile's four
**corners** belong to the upper material (`NW=1, NE=2, SE=4, SW=8`).

Corners rather than edges is what buys diagonals: a tile with only its NW corner
set draws a curved wedge, not an axis-aligned half. Any region the map can
describe by marking corners is drawable, at whatever angle the region has.

The masks are **not** baked per material pair — baking would need a row per pair
_per patch phase_, and would fix at build time which pairs may blend. Composite at
load instead:

```ts
// base material, then overlay clipped to the mask's alpha
drawTile(layerCtx, over, tx, ty);
layerCtx.globalCompositeOperation = 'destination-in';
layerCtx.drawImage(maskSheet, bits * 64, 0, 64, 64, 0, 0, size, size);
ctx.drawImage(layer, 0, 0);
```

**The mask seed must depend only on `bits`, never on tile position** — two
neighbouring tiles have to perturb their shared boundary identically or the edge
tears. `buildMaskSet` handles this; don't reseed per tile.

Bake composited tiles into the chunk cache (`src/map/TileRenderer.ts`), never
per frame.

## Verifying

- `npx tsx scripts/generate-ground-tileset.ts [artSeed]` — writes review sheets to
  `preview/tilesets/` and prints a joint-to-interior ratio per material. It
  **exits non-zero** when a joint reads as a seam. That ratio compares each
  patch's wrap joints to its own strongest internal edges; absolute difference is
  the wrong yardstick because a slab material legitimately contains hard lines.
  `patchTears` in `patchSlice.ts` is the single definition of a tear, shared by
  the baker and the sweep — read its comment before touching either limit.
- `npm run verify:floor-sweep` — re-measures **every** art seed the game can
  draw, in every domain that carries one: the ground for seams, brightness drift,
  texture energy, wall-to-floor separation and the honesty of each palette's
  declared `fallbackColor`; the seeded prop families for art clipped by its own
  cell; the facades for their silhouette and their pixel gates. It carries its own
  deliberately-torn-patch and moved-silhouette self tests, so those gates are
  proved able to go red. `--only=ground` while iterating; `--seeds=N` for a
  shorter run.
- `npm run gates:environment-art` — the runtime cache: that a floor's sheets
  arrive, arrive paced, publish with their ready rows actually inked, are released
  with their `SpriteLoader` defs at a floor change, survive a painter that throws,
  and repaint when a floor draws a new seed without releasing anything.
- `npx tsx scripts/render-dungeon.ts --level=1 --art-seed=N` and
  `scripts/render-town.ts --art-seed=N` — the floor at map scale under a chosen
  look. Wall/floor read and fringe behaviour only show at map scale.
- `npx tsx scripts/tilegen-debug.ts materials | transitions | blob` — writes
  contact sheets under `preview/` without a browser. `blob` is the real test: an
  irregular region composited from corner data alone.
- `localhost:8080/?tiles` — in-game review, resolving frames exactly as the
  renderer will.

## Palettes

`src/map/tilegen/palette.ts`. Anchor new ramps to colours sampled from art that
already works so generated ground doesn't clash with the buildings
standing on it, then **widen the range** — the original grass spanned only 91→110 red
across its 5th–95th percentile, which is precisely why it read as flat colour.

## Related

- `add-level` — wiring a new tile type into `tileTypes.ts`, walkability, renderers
- `add-sprite` — creature/item/prop art (a different pipeline; not generated)
- `docs/town.md` — how the overworld town consumes these materials
