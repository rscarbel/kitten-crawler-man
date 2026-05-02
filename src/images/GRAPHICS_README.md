# Sprite Sheet Graphics

Sprite sheets are created manually (drawn using traditional graphics tools or generated with AI) and placed in this directory. The manifest (`manifest.json`) is maintained by hand to describe the layout and frame information for each sprite sheet.

---

## How the Sprite System Works

The game uses three key pieces:

1. **Manifest (`manifest.json`)** — A JSON file that describes the layout of each PNG sprite sheet:
   - `frameWidth`, `frameHeight` — dimensions of a single animation frame in pixels
   - `tileX`, `tileY` — pixel offsets from the frame's top-left to the tile origin (the point that aligns with world coordinates)
   - `tileScale` — the scale factor used when the sprite was drawn (typically `32` or `64`)
   - `states` — object mapping state names (e.g., `"walk"`, `"idle"`) to `{ row, frameCount }`

2. **`SpriteLoader.ts`** (`src/core/SpriteLoader.ts`) — Loads all sprites at startup:
   - Parses `manifest.json` to get metadata for each sprite sheet
   - Loads PNG files listed in the manifest
   - Infers TypeScript types (`SpriteKey`, `SpriteStates`) from the manifest so rendering code gets compile-time safety
   - Stores loaded images and metadata in memory for fast access

3. **`SpriteRenderer.ts`** (`src/core/SpriteRenderer.ts`) — Draws sprites on demand:
   - `drawSprite()` extracts a frame from a sprite sheet and scales it to the current game tile size
   - `drawSpriteKey()` looks up a sprite by name and draws it
   - Handles flipping, rotation (for directional effects like missiles), and alpha blending
   - Applies the manifest's `tileX`, `tileY` offsets to position sprites correctly

**Rendering pipeline:**
1. Code calls `drawSpriteKey(ctx, 'goblin_base', 'walk', frameNumber, x, y, tileSize)`
2. `SpriteRenderer` fetches the `goblin_base` manifest entry and PNG
3. Calculates source rect: `srcX = frameNumber * frameWidth`, `srcY = row * frameHeight`
4. Draws the frame scaled from `tileScale` (manifest) to `tileSize` (in-game)
5. Uses `tileX`, `tileY` to offset the sprite so its anchor aligns with `(x, y)`

---

## Sheet Layout

Every PNG is a grid where **rows = animation states** and **columns = frames**.

```
 col0   col1   col2  ...
┌──────┬──────┬──────┐  ← row 0  (e.g. "walk")
│frame0│frame1│frame2│
├──────┼──────┼──────┤  ← row 1  (e.g. "idle")
│frame0│      │      │
└──────┴──────┴──────┘
```

Each cell is `frameWidth × frameHeight` pixels. The manifest tells you where each state lives:

```json
"walk": { "row": 0, "frameCount": 8 }
```

To get the pixel rect of frame `f` in state `row`:

```
srcX = f * frameWidth
srcY = row * frameHeight
srcW = frameWidth
srcH = frameHeight
```

---

## Coordinate System

All sheets are rendered at `tileScale = 64` (2× the in-game tile size of 32 px).

`tileX` and `tileY` are the pixel offsets from the top-left corner of each frame cell to the **tile origin** — the point that maps to `(sx, sy)` in the original drawing code. Most sprites extend beyond the tile bounds in at least one direction (head above, shadow below, wide bosses), so the frame is padded to fit.

To place a sprite so its tile origin aligns with a world position `(wx, wy)` on a canvas scaled to `tileScale`:

```
drawX = wx * tileScale - tileX
drawY = wy * tileScale - tileY
```

---

## Special Assets

### Human — body/attack split

Like the goblin, the human attack limbs are separate pixel-aligned compositing layers:

| Key | File | Contents |
|---|---|---|
| `human` | `characters/human.png` | Body — all non-attack states plus `kick_body` |
| `human_punch_arm` | `characters/human_punch_arm.png` | Punching sleeve + knuckled fist only |
| `human_kick_leg` | `characters/human_kick_leg.png` | Kicking leg + shoe only |

All three sheets share `tileX = 16`, `tileY = 16`. `human.png` is 96 px wide; the attack sheets are 128 px wide to accommodate the limb reach.

**States in `human.png`:**

| State | Frames | Description |
|---|---|---|
| `walk` | 8 | Forward-facing walk cycle |
| `idle` | 1 | Standing still |
| `walk_away` | 8 | Walking away (back view) |
| `kick_body` | 1 | Body with right leg hidden — overlay `kick` from `human_kick_leg` on top |

**Rendering a punch:**
```
1. Draw human idle at tile position.
2. Overlay human_punch_arm at the SAME tile position (tileX=16, tileY=16).
   Frame = attack progress (0=wind-up, 2-3=peak extension, 5=retracted).
```

**Rendering a kick:**
```
1. Draw human kick_body at tile position (right leg is absent).
2. Overlay human_kick_leg at the SAME tile position.
   Frame = attack progress (0=chambered, 2-3=full extension, 5=retracted).
```

Both attack sheets use `sweepRow` semantics: frame `f` of 6 maps to `t = f/5` (0→1), and the limb extension follows `sin(t·π)`, peaking at frame 2–3.

---

### Goblin — body/weapon split

The goblin sprite is split into three pixel-aligned sheets that share the same `frameWidth`, `frameHeight`, `tileX`, and `tileY`:

| Key | File | Contents |
|---|---|---|
| `goblin_base` | `enemies/goblin_base.png` | Body, arms, head — no weapon |
| `goblin_weapon_club` | `enemies/goblin_weapon_club.png` | Club only, at its correct per-frame position |
| `goblin_weapon_hammer` | `enemies/goblin_weapon_hammer.png` | Hammer only, at its correct per-frame position |

**Rendering a goblin:**

Because all three sheets share the same tile origin, compositing is trivial:

```
1. Draw goblin_base at the tile position.
2. Draw goblin_weapon_club OR goblin_weapon_hammer at the exact same tile position.
```

The weapon sprites are transparent except for the weapon geometry, so standard `source-over` compositing works.

**Attack animation:** The `attack` state has **10 frames** (vs 6 for other enemies). The animation phases:

| Frames | Phase | Description |
|---|---|---|
| 0–3 | Windup | Arm rises overhead, goblin squints |
| 4–6 | Strike | Fast downswing; weapon passes below neutral at peak |
| 7–9 | Recovery | Arm returns to resting position |

---

### Troglodyte Tongue — `enemies/troglodyte_tongue.png`

The tongue is a **separate, rotatable asset** — it is not baked into `troglodyte.png`.

- The sheet has one row (`extend`) with 6 frames representing tongue extension from 0% to 100%.
- The tongue is drawn pointing **rightward (+X)** in each frame.
- `tileX = 8`, `tileY = 20` — the anchor point is the base of the tongue (where it exits the mouth), not the tip.

To render the tongue in-game:

1. Compute the angle from the troglodyte's mouth position to the target.
2. Translate to the mouth position, rotate by that angle.
3. Draw the tongue frame at offset `(-tileX, -tileY)` from the origin (so the base sits on the mouth).

The troglodyte body (`troglodyte.png`) has a `mouth_open` state (6 frames) that should play in sync with the tongue extension frames.

---

### Sky Fowl — tint-mask compositing

Sky Fowl NPCs come in 8 clothing palettes, so instead of pre-rendering every variant the body and clothing regions are stored as **separate layers**:

| Key | File | Contents |
|---|---|---|
| `sky_fowl_body` | `npcs/sky_fowl_body.png` | Feathers, beak, talons — no clothing |
| `sky_fowl_pants_mask` | `npcs/sky_fowl_pants_mask.png` | Pants region in white on transparent |
| `sky_fowl_vest_mask` | `npcs/sky_fowl_vest_mask.png` | Vest shape in white on transparent |
| `sky_fowl_trim_mask` | `npcs/sky_fowl_trim_mask.png` | Vest collar + buttons in white on transparent |
| `sky_fowl_hat_mask` | `npcs/sky_fowl_hat_mask.png` | Hat crown + hat band in white on transparent |

All five sheets share the same frame dimensions, row layout, and frame count — they are pixel-aligned.

**Rendering a tinted Sky Fowl:**

For each clothing region you want to colorize, use `destination-in` (or equivalent) compositing:

```
1. Draw sky_fowl_body at the correct frame position.
2. For each region (pants, vest, trim, and optionally hat):
   a. On a temporary offscreen canvas, fill a solid rect with the desired color.
   b. Set globalCompositeOperation = 'destination-in'
   c. Draw the corresponding mask frame onto the offscreen canvas.
      (The solid color is now clipped to the mask shape.)
   d. Set globalCompositeOperation = 'source-over'
   e. Composite the offscreen canvas onto the main canvas.
```

**Hat note:** Not all Sky Fowl have hats — three of the eight palettes have `hat: null`. Skip step 2 for the hat layer when the NPC's palette has no hat.

The trim mask covers only the vest collar and buttons. The hat band is included in the hat mask, not the trim mask, because the band is only present when a hat exists.

---

### Magic Missile — `effects/magic_missile_projectile.png`

All projectiles are drawn **flying rightward (+X)**; the trail extends to the left.

`tileX = 140`, `tileY = 40` — the anchor is the **missile head** (leading tip), not the center. Rotate around this anchor to aim in any direction.

Three states, each 3 frames of trail-fill progression (0%, 50%, 100% trail):

| State | Description |
|---|---|
| `standard` | Purple missile, full-size glow |
| `sub_missile` | Purple missile, smaller (sub-projectiles from level-10 split) |
| `full_power` | Orange beam with blazing glow (level 15+) |

Explosions are in `effects/magic_missile_explosion.png` — two states (`standard` / `full_power`), 8 frames each, expanding outward from frame 0 to 7. The anchor (`tileX = tileY = 112`) is the explosion center.

---

### Ball of Swine — `bosses/ball_of_swine.png`

The frames are very large (384×384 px each) because the `burst` animation scales the sprite up to **2.8×** at peak. The tile origin sits at `(160, 160)` — well inside the frame — to give the burst room to expand in all directions.

The `orbit` and `stopped` states both loop; the `burst` state plays once (6 frames) and the boss dies. During `burst`, frames fade to transparent, so the last visible content is around frame 4.

---

### Incubus — `npcs/incubus.png`

The frame is wider than most (160 px vs the standard 96 px) because the wing tips extend ~42% of a tile beyond both the left and right edges of the tile cell. `tileX = 32` (wider left margin).

---

### Juicer — `bosses/juicer.png`

The Juicer is 1.6× the standard tile size and holds dumbbells overhead, so frames are 208×224 px with `tileX = 72`.

Enraged variants (`walk_enraged`, `idle_enraged`) are identical in frame layout to their non-enraged counterparts — only the coloring differs. Use the enraged rows once the Juicer crosses the 40% HP threshold.

---

### Krakaren — `bosses/krakaren.png`

Visually occupies a 3×3 tile area. Frames are 320×320 px with the tile origin at `(128, 128)`.

---

### Protective Shell — three effect sheets

The shell effect is split into three sheets, all generated at **`tileScale = 32`** (native game scale, not 2×). All three are **center-anchored**: `tileX = frameWidth / 2`, `tileY = frameHeight / 2`, meaning the recorded tile origin is the center of the effect, not a corner. Draw position formula:

```
drawX = playerCenterX - tileX
drawY = playerCenterY - tileY
```

#### `effects/protective_shell.png`

Five animation states (main shell, 400×400 px frames):

| State | Frames | Description |
|---|---|---|
| `active` | 8 | Standard blue shell, one full pulse cycle (phase 0→1) |
| `full_power` | 8 | Orange shell (level 15+), same pulse cycle |
| `appear` | 8 | Shell expanding from ~10% radius to full size, fading in |
| `appear_full_power` | 8 | As above, orange |
| `expire` | 8 | Standard blue shell fading out to transparent |

The shell radius baked into these frames is **5 game tiles** (160 px at game scale). For levels 1-2 (3-tile radius) and 3-7 (4-tile radius), the game scales the drawn sprite down to match.

#### `effects/protective_shell_mini.png`

Single state, 192×192 px frames:

| State | Frames | Description |
|---|---|---|
| `active` | 8 | Purple cat mini-shield (level 14+), one full pulse cycle |

Baked radius is **2 game tiles** (64 px).

#### `effects/protective_shell_shockwave.png`

Single state, 480×480 px frames:

| State | Frames | Description |
|---|---|---|
| `expand` | 8 | Orange ring expanding from 2.5-tile to 7-tile radius, fading as it grows |

Frame 0 = ring just started expanding (near the shell boundary). Frame 7 = ring at max radius, nearly transparent. This fires on level-15 shell expiry only.

**Note:** Chain lightning (level 15 kill bonus) is procedurally rendered with random jitter and is not represented as a sprite sheet.

---

### Gore — `effects/blood_particle.png` and `effects/blood_puddle.png`

Both sheets are generated at **`tileScale = 32`** (game native scale). All anchors are centered: `tileX = frameWidth / 2`, `tileY = frameHeight / 2`.

#### `effects/blood_particle.png`

Frame size: **24×24 px**. Two animation states:

| State | Frames | Description |
|---|---|---|
| `drop` | 6 | Round drops — frame 0 (smallest, r≈2 px) → frame 5 (largest, r≈7 px) |
| `tear` | 6 | Teardrop drops with upward tail — same size progression as `drop` |

Pick the frame whose radius closest matches the particle's `radius` field. The drop anchor (tileX=12, tileY=12) sits at the centroid of the round head; for teardrops the tail extends above that point.

#### `effects/blood_puddle.png`

Frame size: **72×48 px**. One animation state:

| State | Frames | Description |
|---|---|---|
| `puddle` | 6 | Organic blob puddles — frame 0 (small oval, rx≈10 px) → frame 5 (large with 8 drip tendrils, rx≈20 px) |

Pick a frame randomly or based on the puddle's `rx` value. The anchor (tileX=36, tileY=24) is the center of the blob.

---

## Environment Tiles — `environment/`

All tiles are generated at `tileScale = 64` (2× game scale). Drawing origin `(sx, sy)` is the tile top-left corner (`tileX = tileY = 0` for flat tiles; larger `tileY` for tiles that extend above their cell).

### Dungeon Tileset — `environment/dungeon_tileset.png`

Single sprite sheet covering all dungeon floor and wall variants. Every frame is `64×64 px`, `tileX = tileY = 0`, `tileScale = 64`.
Generated by `scripts/generateDungeonTileset.ts` (run with `tsx scripts/generateDungeonTileset.ts`).

| State | Row | Variants | Used for |
|---|---|---|---|
| `floor_plain`   | 0 | 8 | Standard flagstone — 48% of dungeon tiles |
| `floor_worn`    | 1 | 6 | Smooth, worn stone — 24% |
| `floor_cracked` | 2 | 6 | Cracked flagstone — 11% |
| `floor_mossy`   | 3 | 6 | Moss-covered stone — 8% |
| `floor_wet`     | 4 | 4 | Wet/damp stone — 4% |
| `floor_dark`    | 5 | 4 | Dark deep-dungeon stone — 3% |
| `floor_ornate`  | 6 | 4 | Decorated/carved stone — rare |
| `wall_plain`    | 7 | 8 | Standard stone brick wall — 62% of walls |
| `wall_cracked`  | 8 | 6 | Cracked wall — 20% |
| `wall_mossy`    | 9 | 4 | Mossy damp wall — 12% |
| `wall_dark`     | 10 | 4 | Deep dungeon dark wall — 6% |

The renderer (`src/map/tiles/terrainTiles.ts`) picks state and variant deterministically from `(tx, ty)` using an XOR hash, so each tile's appearance is stable across sessions.

### Wall sheets

Each wall sheet has rows for the three visual states a `BUILDING_WALL` tile can be in:

| Row label | When to use |
|---|---|
| `facade_window` | South-facing wall tile; flanked by wall tiles east and west on odd `tx` |
| `facade_plain` | South-facing wall tile; corner or narrow (no window fits) |
| `back_gable` | North-facing tile (roof interior to the south); gable triangle drawn above |

Circus wall sheets (`wall_circus_red/blue/purple`) have only `facade` and `back_gable` rows.

| Sheet | Style | Gable roof type |
|---|---|---|
| `wall_cottage` | Half-timber plaster | thatch |
| `wall_tower` | Dressed cut stone | slate |
| `wall_merchant` | Ochre painted plaster + flower box | terracotta/red |
| `wall_stone` | Rough-hewn stone | green/moss |
| `wall_circus_red/blue/purple` | Bold striped canvas | circus matching colour |
| `wall_metal` | Riveted dark steel (single `default` row, `frameH=64`) | — |

**Back-gable frame size:** `frameW=64, frameH=192, tileX=0, tileY=128`. This gives 128 px above the tile origin for the gable triangle. The facade rows occupy only the lower 64 px of the frame (the tile area); the space above is transparent.

### Roof sheets

Each roof sheet has three rows: `eaves` (front/south), `middle` (ridge), `back` (north slope).
All roof sheets: `frameW=64, frameH=64, tileX=0, tileY=0`.

| Sheet | Style |
|---|---|
| `roof_thatch` | Golden straw bands, fringe drips, chimney in middle row |
| `roof_slate` | Staggered blue-grey slate tiles, lead flashing, brick chimney |
| `roof_red` | Curved terracotta tiles, warm glow, clay chimney |
| `roof_green` | Mossy living roof, hanging fringe, organic patches |
| `roof_circus_red/blue/purple` | Bold stripes, gold scalloped fringe (eaves), tent-pole finial (middle) |

### Decoration tiles

| Sheet | Category | Frame size | `tileX/tileY` | Notes |
|---|---|---|---|---|
| `tree` | environment | 64×160 | 0/96 | Static; canopy extends 96 px above tile origin |
| `torch` | environment | 64×128 | 0/64 | 6-frame animated flame; sconce extends 64 px above |
| `well` | environment | 64×96 | 0/32 | Static; crossbeam extends 32 px above |
| `fountain` | environment | 64×96 | 0/32 | 8-frame animated ripple + jet |
| `grassy_weed` | environment | 64×64 | 0/0 | 2 variants as rows (`variant_a`, `variant_b`) |
| `dirt_patch` | environment | 64×64 | 0/0 | 2 variants as rows; wagon-rut grooves |

**Drawing tiles that extend above their cell:** use the standard formula with the manifest `tileX/tileY`:
```
drawX = wx * tileScale - tileX   // tileX=0 for all environment tiles
drawY = wy * tileScale - tileY   // tileY>0 pulls the sprite upward
```

---

## Maintaining Sprites and the Manifest

When adding or updating sprites:

1. **Draw or generate the PNG** using your preferred tool (Aseprite, AI image generator, etc.)
2. **Place it in the appropriate subdirectory** (`characters/`, `enemies/`, `bosses/`, `effects/`, `npcs/`, `environment/`)
3. **Add an entry to `manifest.json`** with the sprite's metadata:
   ```json
   "my_sprite": {
     "path": "enemies/my_sprite.png",
     "frameWidth": 96,
     "frameHeight": 96,
     "tileX": 16,
     "tileY": 16,
     "tileScale": 64,
     "states": {
       "walk": { "row": 0, "frameCount": 8 },
       "idle": { "row": 1, "frameCount": 1 },
       "attack": { "row": 2, "frameCount": 6 }
     }
   }
   ```

The game will automatically detect the new sprite in the manifest on the next reload (or rebuild if bundled). No regeneration script is needed.
