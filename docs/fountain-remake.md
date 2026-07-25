# Town Square Fountain — Visual Rewrite Plan

The 3×3 fountain in the town square (`FOUNTAIN`, tile type 19, placed at `(cx+4, cy+4)` by
`OverworldGenerator`) reads as a modern square object dropped into a warm, painterly medieval
town. This plan replaces its renderer with a single continuous, tiered stone fountain that
matches the town's art direction, without touching the tile footprint, collision, audio, or the
"Drink" interaction.

Decisions already made: **tiered village fountain** motif (round basin, carved column, upper bowl
overflowing into the pool), **3×3 footprint kept**.

---

## 1. Why it looks wrong today

Everything below is a property of the current implementation, not an opinion about taste. Each
one is addressed by a numbered fix later in the plan.

Current code: `src/map/tiles/decorationTiles.ts:115-344` (the `case FOUNTAIN:` block).

| # | Defect | Cause in code |
| --- | --- | --- |
| D1 | **The whole thing is a square.** | Each of the 9 tiles paints its own full-tile `fillRect`. The rim tiles are opaque 32×32 stone squares (`decorationTiles.ts:258`), so the silhouette is exactly the 3×3 block. Nothing is ever round. |
| D2 | **The water has sharp square lines in it.** | The centre tile fills its whole tile with `#155f8f` (`:129`) and the 8 rim tiles paint a separate 3 px "water surface glimpse" strip (`#1a5f8a`, `:290`) against a `#506878` inner face. Three different blues meet on hard tile boundaries — the water is literally 9 disconnected rectangles. |
| D3 | **Ripples only in the middle.** | Ripple rings are drawn *and clipped to the centre tile* (`ctx.rect(sx, sy, ts, ts); ctx.clip()`, `:143-145`), and the per-tile overlay cache only animates the centre tile (`OverlayTileCache.currentFrame` returns `0` for every non-centre fountain tile, `TileRenderer.ts:300-308`). The outer 8 tiles are frozen stills. |
| D4 | **It looks modern.** | Flat, unmodulated fills with hard 3 px bevel strips (`#8a8272` face, `#b0a890` top light, `#686058` shadow) plus a cold blue-grey palette. The neighbouring props (`well.png`, `village-house-*.png`, `torch.png`) are soft-shaded, warm-brown, painterly art. |
| D5 | **A hard rectangular shadow band frames it.** | `FOUNTAIN` is in `SHADOW_TYPES` (`src/map/tiles/helpers.ts:66`), so every plaza tile south of the block gets a full-width `rgba(0,0,0,0.40)` strip and every tile east gets a side strip — a 3-tile-long straight black edge that reinforces the square read even before the fountain is drawn. |
| D6 | **Corner posts read as bollards.** | Rim tiles with ≤2 fountain neighbours draw a grey disc with a ring (`:322-341`) — four detached circles at the corners of a square. |
| D7 | **The animation pops.** | The overlay cache bakes 30 frames as `t = frame/30`, but the effects use non-integer harmonics of `t` (`sin(t * 4.2)`, `t * 1.4`, `t * 1.0`), so frame 29 → frame 0 is a discontinuity. |
| D8 | **Dead duplicate.** | `drawFountain()` (`src/sprites/environmentSprites.ts:1959`) plus 13 `FOUNTAIN_*` constants (`:418-431`) draw a *different*, round fountain and are called from nowhere. `src/images/environment/fountain.png` (8 ripple frames) is also registered in the manifest and used nowhere. |

Additional trap found while reading (must be handled, currently invisible):

- **D9 — the ground under the block is `concrete`, not plaza.** `inferFloorType`
  (`src/map/tiles/helpers.ts`) treats `FOUNTAIN` as a non-floor type, and the centre tile is
  surrounded by fountain tiles on all 4 cardinals *and* all 4 diagonals, so it falls through to
  `FloorTypeValue.concrete`. Today that grey square is hidden under the opaque blue fill. The
  moment the new silhouette is round, the corners become transparent and a grey concrete patch
  would show through.

---

## 2. Art direction to match

Sampled directly from the assets that sit next to the fountain.

| Source | Dominant colours |
| --- | --- |
| `overworld_tileset.png` row 3 (`village_streets`, the plaza floor) | `#8a7559` `#927c5d` `#988365` `#826d53` |
| `overworld_tileset.png` row 0 (`grass`) | `#667433` `#5b692d` `#616e31` |
| `well.png` (nearest prop, 7 tiles away) | `#68482a` `#785533` `#573b23` `#382516` |
| `village-house-1.png` | warm thatch/timber browns, soft AO under every eave |

Observations that the new fountain must honour:

- **Warm, low-saturation, brown-biased.** There is no cold grey anywhere in the square. The
  current `#8a8272`/`#506878` stone is the single most out-of-place colour.
- **Light comes from the upper-left**, and falls off softly — the PNG props have gradient
  shading and an ambient-occlusion darkening where a form meets the ground, never a 3 px hard
  bevel.
- **Props are authored at 64 px per tile and drawn at `TILE_SIZE/tileScale = 32/64 = 0.5`.**
  (`well.png` is 114×125 art shown at ~57×62 px.) So every neighbouring prop is a *downscaled*
  image — edges are anti-aliased and slightly soft. Hard 1 px canvas strokes at 1× read as
  "different medium" next to them. The new fountain is therefore authored at 2× and downscaled
  once (see §4).
- **Props are 3/4 view, not straight top-down.** The well shows its front wall and roof
  underside. The fountain must show the front face of its basin wall and an *elliptical* pool,
  not a top-down circle.

**Proposed palette** (warm limestone + a teal-leaning water that stays in the town's warmth):

```
Stone highlight (lit lip)   #e3d8bd
Stone light   (top-left)    #cdbfa0
Stone mid     (body)        #a8987c
Stone shade   (right/below) #6f6350
Stone deep    (mortar, AO)  #4b4136
Wet stone     (waterline)   #7a6d55
Moss light                  #5c6b34   (ties to grass #667433)
Moss dark                   #465228
Water deep    (under rim)   #1f4a63
Water body                  #2f6f8c
Water shallow (near rim)    #58a0b4
Water glint                 #cfe9f2
Foam / spray                #eef7f9
Ground contact shadow       rgba(38,26,14,0.34)
```

---

## 3. The composition (what gets drawn)

One continuous image, authored in **fountain-local coordinates** spanning the whole 3×3 block
plus headroom above it — never per tile. All geometry expressed in tile units (`u = TILE_SIZE`)
so it stays resolution-independent; every literal below becomes a named constant.

```
Composition canvas:  W = 3u,  H = HEADROOM + 3u,  HEADROOM = 1.5u
Pool centre:         (1.5u, HEADROOM + 1.8u)          — pushed low; the column occupies the top
Outer basin ellipse: rx = 1.42u, ry = 0.95u           — 0.67 squash = the 3/4 view
Coping ring width:   0.17u
Inner water ellipse: rx = 1.25u, ry = 0.78u
Front wall height:   0.36u                             — extrusion below the front arc
Plinth ellipse:      rx = 0.50u, ry = 0.20u
Column shaft:        w 0.34u → 0.28u (taper), h 0.75u
Upper bowl ellipse:  rx = 0.62u, ry = 0.22u
Jet:                 w 0.09u, h 0.85u above the bowl
```

Draw order (each layer is a small named function in the new module):

1. **Ground contact shadow** — soft ellipse (`rx 1.5u`, `ry 1.0u`) offset down-right by
   `(0.06u, 0.10u)`, drawn with a radial-gradient falloff to transparent. Replaces D5's hard
   band. Stays inside the 3×3 block so it needs no extra bleed.
2. **Basin outer wall (front face)** — the region between the front half of the outer ellipse
   and the same arc translated down by the front-wall height, filled with a vertical gradient
   `#a8987c → #6f6350`, then **curved masonry**: 14–16 blocks laid around the arc, each nudged
   ±1 px in size/tone from a deterministic hash so no two match, mortar joints as thin
   `#4b4136` arcs *following the ellipse* (this is what kills D1 — the joints curve, so the eye
   reads a cylinder).
3. **Coping ring (the top lip)** — the ellipse ring between outer and inner, filled
   `#cdbfa0`, with the upper-left third brightened to `#e3d8bd` and the lower-right third
   darkened to `#8a7c66`. One chipped block on the SE lip and a hairline crack on the S lip.
4. **Inner basin wall** — thin band just inside the coping, in shade (`#6f6350` → `#4b4136`)
   with a subtle occlusion gradient, so the water sits *below* the lip instead of flush with it.
5. **Water body** — one ellipse, filled with a two-stop radial gradient
   (`#2f6f8c` centre → `#1f4a63` at the rim), plus a `#58a0b4` crescent along the far (north)
   inner edge where sky reflects. **This single fill is the fix for D2** — there is exactly one
   water shape in the whole fountain.
6. **Submerged detail** — 5–7 wish coins and pebbles as tiny warm ellipses at 35 % alpha under
   the water, deterministic positions, slightly wobbled by the animation phase.
7. **Ripples (continuous, full-pool)** — three concentric *ellipses* (same 0.67 squash as the
   pool, so they lie on the water plane) expanding from the column base out to the rim, alpha
   fading to 0 as they approach it, clipped to the water ellipse — **not** to a tile. Fix for D3.
8. **Column** — plinth ellipse with an AO ring where it meets the water; tapered shaft with a
   left-lit gradient, two carved rings, and a wet/darker band at the waterline; a moss streak
   on the N face.
9. **Upper bowl** — shallow bowl ellipse, lit rim, dark interior, water surface inside it.
10. **Overflow sheets** — four thin translucent water sheets spilling over the bowl lip at
    NE/NW/SE/SW, drawn as tapered quads with a `#eef7f9` leading edge, landing in the pool.
11. **Jet** — narrow tapering column of water from the bowl centre, brightest at the tip, with
    a soft additive glow; a handful of droplets peeling off the top.
12. **Impact rings + foam** — a small circular ripple set and a foam smudge at each of the four
    sheet landing points, on the water surface.
13. **Surface glints** — 4–6 small elongated highlights drifting across the pool.
14. **Moss & wear at the base** — three moss tufts where the basin meets the plaza (SW, S, E),
    plus faint water stains running down the front wall. This is what makes it read as *old*.

**Silhouette check:** the block's four corners are now empty plaza, the outline is an ellipse,
and the tallest element (jet tip) reaches `HEADROOM` above the block. D1 and D6 are gone —
there are no corner posts at all.

---

## 4. Rendering architecture

### 4.1 New module: `src/sprites/fountainSprite.ts`

Exports a single entry point used by the tile renderer:

```ts
/** Blits this fountain tile's slice of the shared, pre-rendered fountain composition. */
export function drawFountainTileSlice(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, ts: number,
  blockX: number, blockY: number,   // 0..2 offset of this tile within the 3×3 block
  time: number,
): void;
```

Internals:

- `FOUNTAIN_LOOP_FRAMES = 24` pre-rendered composition canvases, built lazily and cached in a
  module-level `Map` keyed by `` `${ts}_${frame}` `` (tile size is fixed at 32 today, but keying
  on it keeps the module honest).
- Each frame is drawn **at 2× into a reusable scratch canvas** (`6u × (2·HEADROOM + 6u)`), then
  downscaled **once** into the final `3u × (HEADROOM + 3u)` frame canvas. Two reasons: it
  matches the neighbouring props' authored-at-64px-per-tile softness (§2), and downscaling once
  into a final canvas means per-tile slicing is an exact integer pixel copy — **no resampling at
  tile boundaries, so no seams**. Naively slicing from a 2× canvas would reintroduce D2 as
  faint edge artefacts.
- Memory: 24 × 96 × 144 × 4 B ≈ **1.3 MB**, built once, lazily, only when the fountain is first
  on screen. (Today's cache is 30 centre frames + up to 32 rim variants, so this is comparable.)
- The module takes a plain `CanvasRenderingContext2D` and no DOM/game imports, so an offline
  script can rasterise preview PNGs with the `canvas` devDependency (§7).

Slice geometry per tile — top-row tiles blit the headroom band too:

```
srcX = blockX * ts
srcY = blockY === 0 ? 0                    : HEADROOM + blockY * ts
srcH = blockY === 0 ? HEADROOM + ts        : ts
dstY = blockY === 0 ? sy - HEADROOM        : sy
```

Loop-safe animation (fix for D7): every effect is driven by `p = frame / FOUNTAIN_LOOP_FRAMES`
through `sin/cos(2π · k · p)` with **integer** `k`, and every cycling counter uses
`(i/N + k·p) % 1` with integer `k`. Frame 23 → 0 is then continuous by construction. A named
constant per effect (`RIPPLE_CYCLES = 2`, `JET_PULSE_CYCLES = 2`, `GLINT_DRIFT_CYCLES = 1`, …).

### 4.2 `src/map/tiles/decorationTiles.ts`

Replace the entire 230-line `case FOUNTAIN:` body with block-offset resolution plus one call:

```ts
case FOUNTAIN: {
  let blockX = 0;
  while (structure[ty]?.[tx - blockX - 1]?.type === FOUNTAIN) blockX++;
  let blockY = 0;
  while (structure[ty - blockY - 1]?.[tx]?.type === FOUNTAIN) blockY++;
  drawFountainTileSlice(ctx, sx, sy, ts, blockX, blockY, tileTime ?? frameTime);
  return true;
}
```

(Walking to the block origin rather than testing the 4 neighbours also means the renderer no
longer silently mis-draws if a fountain is ever placed at a different size — it clamps to the
authored 3×3 composition.)

### 4.3 `src/map/TileRenderer.ts` — delete fountain special-casing

Because a slice blit is already a single `drawImage`, the per-tile overlay cache buys nothing
for the fountain. Remove `FOUNTAIN` from `CACHEABLE_OVERLAY_TYPES` (keep it in
`DECORATION_TYPES` — it still draws in the Y-sorted overlay pass), and delete:

- `FOUNTAIN_ANIM_FRAMES`, `FOUNTAIN_OVERHEAD_SCALE`
- the `FOUNTAIN` branches in `OverlayTileCache.currentFrame`, `cacheKey`, and `computeOverhead`
- the `tileTime = type === FOUNTAIN ? … : undefined` line in `renderEntry`

`OverlayTileCache` is then free of any per-tile-type knowledge except `BUILDING_WALL` gables —
a net simplification of shared code, and it removes the machinery behind D3 and D7.

Depth sorting is unchanged: each fountain tile still sorts on its own row, so a citizen north of
the block draws behind it and one south of it draws in front, exactly as today.

### 4.4 `src/map/tiles/helpers.ts` — two fixes

1. **Remove `FOUNTAIN` from `SHADOW_TYPES`** (fix D5). The fountain now carries its own soft
   elliptical contact shadow (layer 1). `SHADOW_TYPES`' own comment already says decorations are
   excluded to avoid "ugly rectangular gray bands" — the fountain is the exception that proves it.
2. **Make the block's ground resolve to plaza, not concrete** (fix D9). `inferFloorType` gives
   up after the diagonal ring; the centre tile is enclosed by fountain tiles in all 8 directions.
   Fix by widening the fallback: after the diagonal pass, scan outward ring-by-ring (radius 2,
   then 3) for the first floor type instead of returning `FloorTypeValue.concrete`. That is a
   general improvement — any 3×3-or-larger decoration blob hits the same bug today.
   The base pass then paints `village_streets` under the whole block, and the plaza shows
   through the fountain's round corners.

### 4.5 `src/sprites/environmentSprites.ts` — delete dead code

Remove `drawFountain()` (`:1959`) and the 13 `FOUNTAIN_*` constants (`:418-431`). Nothing calls
them. Check whether `FOUNTAIN_RIM_STONE_*` constants are shared by other functions before
deleting (grep says they are not) and whether removing them orphans any import.

Leave `fountain.png` / its manifest entry alone for now — it is unused today and deleting an
asset is a separate call; note it in the summary. (If the runtime renderer is later swapped for
painted art, that manifest entry is the natural place for it.)

### 4.6 Untouched by design

`OverworldGenerator` placement, `fountainCentre` metadata, `TownPropSystem` "Drink" heal spot
and the flanking benches, `DungeonScene`'s `ambient_fountain` positional emitter, walkability,
and the minimap. The tile footprint does not change, so none of these can regress.

---

## 5. Constants & code-quality rules for this work

Per `CLAUDE.md`:

- Every literal in §3's geometry table becomes a named constant expressing *meaning*
  (`BASIN_OUTER_RX_TILES`, `COPING_RING_WIDTH_TILES`, `FRONT_WALL_HEIGHT_TILES`,
  `WATER_SQUASH`, `RIPPLE_RING_COUNT`, `OVERFLOW_SPOUT_COUNT`, `JET_PULSE_CYCLES`, …), grouped
  by layer with a short header comment per group.
- No `as`, no `!`, no `any`. The scratch/frame canvases use the existing `allocCanvas` pattern;
  note that `TileRenderer.allocCanvas` currently needs an eslint-disabled cast for
  `OffscreenCanvas.getContext` — the new module should **reuse** that helper (export it from
  `TileRenderer.ts` or lift it to a small shared module) rather than duplicating the cast.
- Comments explain *why* only: the squash ratio (3/4 view), the single-downscale rule (seams),
  the integer-harmonic rule (loop continuity), the SHADOW_TYPES removal.
- Prefer named intermediates over dense one-liners in the bezier/ellipse maths.

---

## 6. Phased task list

| Phase | Work | Done when |
| --- | --- | --- |
| **1** | `fountainSprite.ts` skeleton: constants, frame cache, 2×-scratch → 1× downscale, slice blit. Stone only (layers 1–4, 8), no water. | Offline preview PNG shows a round, warm, tiered stone basin. |
| **2** | Water: layers 5–7 + 12–13. Verify ripples cross tile boundaries seamlessly. | Preview strip of all 24 frames loops with no pop and no seams. |
| **3** | Column, bowl, overflow sheets, jet (layers 8–11) + wear/moss (14). | Preview matches §3. |
| **4** | Wire-up: `decorationTiles.ts` case, `TileRenderer` de-special-casing, `helpers.ts` shadow + floor-inference fixes, dead-code deletion. | In-game at `?level=level3`; nothing else in the square changed. |
| **5** | In-game visual pass at real scale next to the well/houses; tune palette/contrast against the actual plaza. Perf sanity: first-frame build cost and steady-state. | Screenshots before/after; `npm run typecheck`, `npm run lint`, `npm run format` all clean. |

Phases 1–3 are pure rendering iterations against the offline preview; only phase 4 touches
shared code.

---

## 7. Verification

- **Offline preview (primary loop).** A scratch script (not committed, or committed under
  `scripts/` alongside the existing sprite generators if it proves useful) imports
  `fountainSprite.ts`, renders all `FOUNTAIN_LOOP_FRAMES` with the `canvas` devDependency, and
  writes a contact sheet PNG plus a 3× zoom of frame 0. This is how the composition gets judged
  without a browser, and it is why the module must stay DOM-free.
- **In-game.** `npm run dev`, then `http://localhost:<port>/?level=level3` spawns at the town
  square centre; the fountain is 4 tiles SE. Check: round silhouette against plaza cobbles, no
  black band on the south/east tiles, plaza (not grey) visible in the block's corners, ripples
  continuous across the whole pool, no pop at the loop point, correct sorting when the player
  and townsfolk walk north and south of it, and the "Drink" prompt still appears.
- **Gates.** `npm run typecheck`, `npm run lint`, `npm run format` — all must pass (CLAUDE.md).

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Removing `FOUNTAIN` from `SHADOW_TYPES` changes tiles owned by other systems | It only affects `drawWallShadow`'s two `fillRect`s on neighbouring floor tiles; those tiles are in the chunk cache built at map load, so no stale-cache issue. |
| Widening `inferFloorType`'s fallback affects other maps | It only changes cases that reach the current `concrete` fallback — i.e. tiles that are already wrong. Worth a quick scan of interiors for tiles that *want* concrete before landing. |
| 1.3 MB frame cache / first-visit build hitch | 24 compositions built lazily on first draw. If a hitch is measurable, build frame 0 eagerly on overworld load and the rest across the next frames; measure before optimising. |
| Painterly runtime canvas still won't perfectly match the AI-painted PNG props | The 2× authoring + gradient/AO discipline closes most of the gap. The renderer is isolated in one module, so a future painted `fountain.png` can replace it behind the same call site without touching tiles, cache, or helpers. |
