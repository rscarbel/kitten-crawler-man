# Destructible Crates & Barrels — Implementation Plan

Two deliverables, in this order:

1. **Art** — redraw `barrel`, `barrel_side`, `crate` as new PNG sprite sheets that include damage and shatter frames.
2. **Gameplay** — a `DestructiblePropSystem` that lets a melee swing break them, plays a rotating `wood_smashing_*` cue, throws splinter debris, leaves a wreckage decal, opens the tile up, and drops floor-scaled coins.

Everything below is grounded in files that exist today. Line numbers are from the current `main` (`f6e4b56`).

---

## 0. What exists right now

| Concern | Where |
| --- | --- |
| Tile ids | `src/map/tileTypes.ts:67` `BARREL = 36`, `:75` `BARREL_SIDE = 40`, `:77` `CRATE = 41` |
| Barrel render | `src/map/tiles/interiorTiles.ts:293` — floor underneath, then `drawSpriteKey(ctx, 'barrel', 'idle', 0, …)` |
| Barrel-side / crate render | `src/map/tiles/decorationTiles.ts:622` and `:632` — same shape |
| Sprite sheets | `src/images/environment/props/{barrel,barrel_side,crate}.png`, all 64×64 single-frame |
| Manifest | `src/images/environment/props/manifest.json` — keys `barrel` (:53), `barrel_side` (:67), `crate` (:81) |
| Walkability | `src/map/GameMap.ts:1609/1611/1612` — all three block movement |
| Floor inference | `src/map/tiles/helpers.ts:152` `inferFloorType()`; reads `TileContent.groundType` first (`src/map/tileTypes.ts:253`) |
| Dungeon placement | `src/map/DungeonGenerator.ts` — `VIGNETTES` (:218–330) and the per-room decoration cycles (:1045–1178) |
| Melee resolution | `src/systems/CombatSystem.ts:61` `resolvePlayerAttacks()` |
| Loot drop | `src/systems/LootSystem.ts:121` `addLoot(x, y, loot, owner, isBossLoot?)` |
| Debris VFX model | `src/systems/GoreSystem.ts` — self-contained particle array, gravity, life |
| Sound rotation precedent | `src/scenes/DungeonScene.ts:3310–3315` — `woodBreakSoundPending` drained, index round-robins |
| Sounds ready to use | `wood_smashing_1`, `wood_smashing_2` — registered in `src/audio/sounds.ts:147–148` / `:310–311`, **currently played nowhere** |

Two facts that shape the design:

- `OverlayTileCache` (`src/map/TileRenderer.ts:261`) only caches `BUILDING_WALL` and the `ROOF_*` types (`CACHEABLE_OVERLAY_TYPES`, :62). Crates and barrels are **not** cached, so a per-tile damage stage can drive the sprite state directly with no invalidation work.
- `resolvePlayerAttacks` already skips swings made inside a safe room (`inSafeRoom(attacker)`, `CombatSystem.ts:68`). Safe-room props are therefore protected for free.

---

## 1. Art — redraw the three props

### 1a. What's wrong with the current art

Open the three PNGs before starting; the specific problems to fix:

- **`crate.png`** — reads as a flat top-down square with an X across it. No volume, no perspective, one flat brown fill, and a hard near-black outline that makes it look like a UI icon rather than a prop. It does not match the 3/4 view of `well.png` or `brazier.png` beside it.
- **`barrel.png`** — muddy and low-contrast. The lid is drawn as alternating stripes that read as visual noise at 32 px, and the staves have no rim-light so the cylinder doesn't round.
- **`barrel_side.png`** — closest to acceptable, but flatter than the others and with no contact shadow, so it floats.

### 1b. Target art direction

Match the existing prop set (`well`, `brazier`, `torch`):

- **View**: 3/4, camera slightly above. The top face of a crate and the lid of a barrel are visible as a shallow ellipse/parallelogram, not a full square.
- **Wood palette**, 5-value warm oak ramp — roughly `#3a2413` (deep shadow) → `#5a3a1e` → `#7a5028` → `#9a6a38` → `#c09050` (rim light). Do **not** outline in pure black; the darkest edge is `#2a1a0d`.
- **Iron hoops / crate corner brackets**: cool grey-blue (`#4a5058` → `#6b7480`) with a single 1 px specular highlight along the upper-left arc, so the metal reads as a different material from the wood.
- **Light direction**: upper-left, consistent across all three (and consistent with the rest of the prop set).
- **Contact shadow**: a soft dark ellipse baked into the bottom of every frame, ~70 % of tile width, `rgba(0,0,0,0.35)`. This is what stops them floating.
- **Plank seams**: 1 px `#3a2413` lines, subtly varied in spacing — do not make them evenly striped.
- Keep silhouettes readable at 32 px. Detail that vanishes at that size is wasted.

### 1c. Sheet geometry

Give each prop **one PNG with four state rows**. Frames grow from 64×64 to **96×96** with the logical tile inset by 16 px on all sides, so shatter debris can fly outside the tile footprint without being clipped. The tile footprint itself is unchanged, so nothing about placement or collision shifts.

```
FRAME_W = 96
FRAME_H = 96
TILE_X  = 16
TILE_Y  = 16
TILE_SCALE = 64
```

Rows (one per state, per the `add-sprite` convention):

| Row | State | Frames | Content |
| --- | --- | --- | --- |
| 0 | `idle` | 1 | Intact prop. |
| 1 | `damaged` | 1 | Visibly hurt but standing — a sprung hoop, one cracked stave, a split plank, a few chips missing from a corner. Same silhouette so the swap doesn't pop. |
| 2 | `shatter` | 6 | The break. Frames 0–1 burst outward fast, 2–3 the pieces separate and tumble, 4–5 they fall and fade. Include a light dust puff behind the wood in frames 1–3. |
| 3 | `remains` | 1 | Flat wreckage lying on the floor — broken planks, a bent hoop, splinters, sawdust. Drawn with no vertical volume so the player reads the tile as walkable. |

Sheet size: 6 cols × 4 rows × 96 px = **576 × 384**.

### 1d. Generator script

Create `scripts/generate-destructible-props-sprite.ts`, modelled on `scripts/generate-grotesque-spider-sprite.ts`:

- Uses `createCanvas` from the `canvas` npm package.
- Top-of-file constants exactly as in §1c, printed at the end for copy-paste into the manifest (existing generators do this).
- One `renderRows(rowGroups: FrameSpec[][])` helper that allocates `cols*FRAME_W × rows*FRAME_H` and draws each frame at `(col*FRAME_W + TILE_X, row*FRAME_H + TILE_Y)`.
- Emits three PNGs over the existing paths: `src/images/environment/props/barrel.png`, `barrel_side.png`, `crate.png`.
- Run it with `npx tsx scripts/generate-destructible-props-sprite.ts`. It is not wired into `package.json` — generators are ad hoc.

Share the wood-drawing primitives (plank fill, seam, hoop arc, contact shadow) as local helper functions rather than repeating gradients three times.

### 1e. Manifest update

Replace the three entries in `src/images/environment/props/manifest.json` with the new geometry, e.g.:

```json
"crate": {
  "path": "environment/props/crate.png",
  "frameWidth": 96, "frameHeight": 96,
  "tileX": 16, "tileY": 16, "tileScale": 64,
  "states": {
    "idle":     { "row": 0, "frameCount": 1 },
    "damaged":  { "row": 1, "frameCount": 1 },
    "shatter":  { "row": 2, "frameCount": 6 },
    "remains":  { "row": 3, "frameCount": 1 }
  }
}
```

`SpriteKey` / `SpriteStates` are compile-time types derived from this JSON (`src/core/SpriteLoader.ts:89–94`), so the new state names become type-safe immediately and any typo in a `drawSpriteKey` call is a compile error. No `SpriteLoader.ts` import change is needed — `props/manifest.json` is already imported.

> Watch out: `loadSprites()` swallows 404s silently (`SpriteLoader.ts:140`). A blank prop at runtime means a path typo, not a code bug.

### 1f. Existing consumers to re-check

`src/sprites/marketStall.ts:618` and `:621` reuse the `'crate'` and `'barrel'` keys for market-stall clutter. They pass `'idle'`, so they keep working — but eyeball a market stall after the redraw to confirm the new art still reads at stall scale.

---

## 2. Record the floor under every prop

Breaking a prop must restore the floor that was there. `TileContent.groundType` (`src/map/tileTypes.ts:253`) already exists for exactly this, and `inferFloorType()` reads it first — but the dungeon generator writes prop tiles with a bare `grid[y][x].type = BARREL` and never records it.

Add a small helper in `src/map/DungeonGenerator.ts` and route **every** `BARREL` / `BARREL_SIDE` / `CRATE` write through it:

```ts
/** Stamps a prop over a floor tile, remembering the surface it replaced so the
 *  prop can be smashed back down to it. */
function placeProp(tile: TileContent, propType: number): void {
  tile.groundType = tile.type;
  tile.type = propType;
}
```

Call sites to convert: the `stampVignette()` path (`:359`, which writes from the `VIGNETTES` tables at `:218–330`) and the per-room decoration cycles at `:1054`, `:1082`, `:1093`, `:1106`, `:1109`, `:1133–1135`, `:1168–1173`. Do the same for the interior writes in `src/map/GameMap.ts` (`:410–412`, `:418–419`, `:483–487`, `:550–558`, `:598–602`, `:632–637`, and the cartwright block) — interiors aren't smashable today, but leaving half the writes inconsistent invites a future bug.

The break path still falls back to `inferFloorType(structure, tx, ty)` when `groundType` is absent, so a missed call site degrades to the old inference rather than crashing.

---

## 3. Floor number on `LevelDef`

The coin formula needs a numeric depth. There is none today — code compares `levelDef.id` strings (see `src/creatures/Mongo.ts:40`). Don't parse the id; add the field.

- `src/levels/types.ts` — add to `LevelDef`:
  ```ts
  /** Dungeon depth, 1-based. Drives depth-scaled rewards such as smashed-prop coins. */
  floorNumber: number;
  ```
  Make it **required** so the compiler forces every level to declare one.
- `src/levels/tutorial.ts` → `floorNumber: 1`
- `src/levels/level1.ts` → `floorNumber: 1`
- `src/levels/level2.ts` → `floorNumber: 2`
- `src/levels/level3.ts` → `floorNumber: 3` (the overworld — it never uses this, see §5, but the field is required)

---

## 4. Tile damage stage

Add one optional field to `TileContent` in `src/map/tileTypes.ts`:

```ts
/**
 * Set on destructible prop tiles (BARREL, BARREL_SIDE, CRATE): 0 = intact,
 * 1 = cracked. Carried on the tile rather than held only in the system so the
 * tile renderer can pick its sprite state without a back-reference into
 * gameplay code — the same reason `spriteKey` and `groundType` live here.
 */
damageStage?: number;
```

Then in the three render cases, pick the state from it:

- `src/map/tiles/interiorTiles.ts:298` and `src/map/tiles/decorationTiles.ts:627/637` become:
  ```ts
  const propState = tile.damageStage === PROP_DAMAGE_STAGE_CRACKED ? 'damaged' : 'idle';
  drawSpriteKey(ctx, 'crate', propState, 0, sx, sy, ts);
  ```
  with `PROP_DAMAGE_STAGE_INTACT = 0` / `PROP_DAMAGE_STAGE_CRACKED = 1` exported from the new system module (§5) — no bare literals.

No cache invalidation is needed: these types are outside `CACHEABLE_OVERLAY_TYPES`.

---

## 5. `DestructiblePropSystem`

New file `src/systems/DestructiblePropSystem.ts`, implementing `GameSystem` (`src/systems/GameSystem.ts`).

### 5a. State

```ts
export type DestructiblePropKind = 'barrel' | 'barrel_side' | 'crate';

interface PropHealth { hp: number; hitFlashFrames: number; }

interface ShatterBurst {
  tileX: number; tileY: number;
  kind: DestructiblePropKind;
  frames: number;          // counts up to SHATTER_TOTAL_FRAMES
}

interface Wreckage {
  tileX: number; tileY: number;
  kind: DestructiblePropKind;
  life: number;            // counts down from WRECKAGE_LIFETIME_FRAMES
}

interface Splinter {
  x: number; y: number; vx: number; vy: number;
  angle: number; spin: number;
  length: number; shade: number;   // index into a small wood-tone palette
  life: number; maxLife: number;
}
```

- `private readonly health = new Map<string, PropHealth>()` keyed with `tileKey(tx, ty)` from `src/systems/tileKey.ts` — reuse it, do not hand-roll a second key format.
- Health entries are created **lazily on first hit**, so there is no map scan at construction and levels with thousands of props cost nothing until the player swings.
- `smashCount` — a public counter the scene drains for audio (§6).

### 5b. Named constants (no magic numbers)

```ts
const BARREL_HP = 6;
const BARREL_SIDE_HP = 5;
const CRATE_HP = 6;
const PROP_CRACK_HP_FRACTION = 0.5;     // below this, swap to the `damaged` sprite
const HIT_FLASH_FRAMES = 6;

const SHATTER_FRAME_COUNT = 6;
const SHATTER_FRAMES_PER_STEP = 5;      // 6 × 5 = 30 frames ≈ 0.5 s
const SHATTER_TOTAL_FRAMES = SHATTER_FRAME_COUNT * SHATTER_FRAMES_PER_STEP;

const WRECKAGE_LIFETIME_FRAMES = 3600;  // 60 s
const WRECKAGE_FADE_FRAMES = 240;
const MAX_WRECKAGE = 60;                // oldest is dropped past this

const SPLINTER_COUNT_MIN = 10;
const SPLINTER_COUNT_MAX = 16;
const SPLINTER_SPEED_MIN = 1.2;
const SPLINTER_SPEED_MAX = 3.0;
const SPLINTER_GRAVITY = 0.09;
const SPLINTER_DRAG = 0.94;
const SPLINTER_LIFETIME_MIN = 30;
const SPLINTER_LIFETIME_MAX = 50;
const SPLINTER_FORWARD_CONE_BIAS = 0.7; // fraction thrown away from the puncher
```

Player melee damage is `1 + strength + drunkDamageBonus` (`HumanPlayer.ts:98`), so an early-game punch is ~4 and a 6 HP crate takes two hits — one crack, one break. That is the intended feel; tune the HP constants, not the damage.

### 5c. Public API

```ts
constructor(
  private readonly gameMap: GameMap,
  private readonly loot: LootSystem,
  private readonly floorNumber: number,
)

/** Resolve a melee swing against nearby props. Returns true if anything was hit. */
tryMeleeHit(attacker: HumanPlayer | CatPlayer, range: number, damage: number): boolean

update(ctx: SystemContext): void
renderWreckage(ctx: CanvasRenderingContext2D, camX: number, camY: number): void
renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void

/** Smashes drained by DungeonScene to fire the rotating wood_smashing cue. */
drainSmashes(): number
```

### 5d. `tryMeleeHit` — mirror the mob filter chain

Match `resolvePlayerAttacks` (`CombatSystem.ts:77–100`) so props and mobs feel identical to hit:

1. Attacker centre = `attacker.x + HALF_TILE`, `attacker.y + HALF_TILE`.
2. Scan tiles in the square `ceil(range / TILE_SIZE) + 1` around the attacker's tile — a handful of tiles, no spatial index needed.
3. Skip tiles whose type is not one of the three destructible types.
4. Tile centre = `(tx + 0.5) * TILE_SIZE`, `(ty + 0.5) * TILE_SIZE`. Reject if `dist > range`.
5. Facing cone: if `dist > MELEE_POINT_BLANK_RANGE`, require `dot > 0` against `attacker.facingX/facingY` — same 180° forward hemisphere as mobs. Export `MELEE_POINT_BLANK_RANGE` from `CombatSystem.ts` (it is currently module-private at `:19`) rather than redeclaring the value.
6. Apply damage to the lazily-created `PropHealth`. Set `hitFlashFrames`.
7. If `hp` drops below `PROP_CRACK_HP_FRACTION` of max and the tile is still intact, set `tile.damageStage = PROP_DAMAGE_STAGE_CRACKED`.
8. If `hp <= 0`, run the break (§5e).

A single swing may hit more than one prop — that is fine and desirable for a crate stack.

### 5e. The break

In order:

1. **Open the tile**: `tile.type = tile.groundType ?? inferFloorType(this.gameMap.structure, tx, ty)`, then clear `damageStage` and `groundType`. The tile is now walkable via the existing `isWalkableTileType` (`GameMap.ts:1579`) with no extra bookkeeping, and mob pathfinding picks it up on the next query.
2. **Shatter burst**: push a `ShatterBurst`. `update()` advances `frames`; `renderEffects` draws `drawSpriteKey(ctx, kind, 'shatter', progressFrameIndex(frames / SHATTER_TOTAL_FRAMES, SHATTER_FRAME_COUNT), …)` and drops the entry when `frames >= SHATTER_TOTAL_FRAMES`.
3. **Splinters**: spawn `SPLINTER_COUNT_MIN..MAX`, biased into a forward cone away from the attacker (`GoreSystem.spawnGore`, `src/systems/GoreSystem.ts:68`, is the model — clone the structure, not the blood specifics). Integrate `vx/vy` with `SPLINTER_GRAVITY` and `SPLINTER_DRAG`, spin each shard, fade over the last third of its life. Draw as short rotated rectangles in the §1b wood palette — a sprite sheet for the shards is not worth it at this size.
4. **Wreckage decal**: push a `Wreckage` entry rendered with the `remains` state, fading out over `WRECKAGE_FADE_FRAMES` at the end of its life. Cap at `MAX_WRECKAGE`, dropping the oldest.
5. **Coins**: see §5f.
6. **Sound**: `this.smashCount++`. The system never touches `AudioManager` directly — same contract as `DefendQuestSystem.woodBreakSoundPending` and `DynamiteSystem.explosionSoundPending`.
7. Delete the `health` entry.

### 5f. Coin drop — shared between both players

```ts
const coins = randomInt(this.floorNumber, this.floorNumber + 1);
this.loot.addLoot(
  (tileX + 0.5) * TILE_SIZE,
  (tileY + 0.5) * TILE_SIZE,
  { coins, items: [] },
  attacker,
  false,          // isBossLoot
  true,           // sharedCoins — both players are paid, see below
);
```

Floor 1 → 1–2 coins, floor 2 → 2–3, floor 3 → 3–4, and so on. `randomInt` is from `src/utils.ts` (inclusive on both ends — confirm before relying on it).

**Both players get the coins, each receiving the full rolled amount** — not a split. A split is not an option here: floor 1 can roll a single coin, and halving that pays one player nothing. `LootSystem` today credits only `loot.owner` (`src/systems/LootSystem.ts:191`), so it needs a small extension:

1. Add `sharedCoins?: boolean` to the `PendingLoot` interface and a trailing `sharedCoins = false` parameter to `addLoot` (`:121–137`). Every existing call site keeps working unchanged.
2. In `update()`, at the crediting branch (`:190–196`), when `sharedCoins` is set, pay both party members the full amount instead of only the owner. Both are already in hand as `ctx.active` and `ctx.inactive` — pay each of them once, and keep the item loop crediting `loot.owner` alone (prop drops carry no items today, but the field is there).
3. In `render()` (`:244`), where the label is built from `` `\u{1FA99}${loot.loot.coins}` `` (`:250`), append a marker such as `(shared)` — or a second coin glyph — when `sharedCoins` is set, so the player can see the drop pays twice. Use `drawText`/`TEXT_PRESETS` per `CLAUDE.md`, not raw `ctx.fillText`.

Everything else — the pickup radius, the floating label box, the TTL fade — is already handled by `LootSystem`.

### 5g. Rendering

- `renderWreckage` — called from `RenderPipeline.renderWorld` (`src/systems/RenderPipeline.ts:145`) right after `gore.renderPuddles` / `bodyPartGore.renderSettled` (:166–167), so debris sits on the floor beneath everything.
- `renderEffects` (shatter frames + flying splinters) — called from `RenderPipeline.renderEffects` (:318), next to `gore.renderParticles`.

Add a `destructibles: DestructiblePropSystem | null` field to `RenderContext` (:89+) and null-guard both calls, since building interiors and the overworld construct the pipeline without one.

---

## 6. Wiring into `DungeonScene`

`src/scenes/DungeonScene.ts`:

1. **Construct** alongside the other map-dependent systems (near `this.loot = new LootSystem(this.gameMap)` at :786), gated so town props stay intact:
   ```ts
   this.destructibles = this.levelDef.isOverworld
     ? null
     : new DestructiblePropSystem(this.gameMap, this.loot, this.levelDef.floorNumber);
   ```
   Declare the field as `DestructiblePropSystem | null`.
2. **Update** — call `this.destructibles?.update(ctx)` in the post-combat block, next to `gore.update()` / `bodyPartGore.update()` around :3577.
3. **Combat hook** — add `destructibles?: DestructiblePropSystem` to `CombatContext` (`CombatSystem.ts:45–59`) and, inside `resolvePlayerAttacks`, after each attacker's mob loop and **before** the `bus.emit(...MeleeSwing…)` call:
   ```ts
   const propHit = ctx.destructibles?.tryMeleeHit(human, range, damage) ?? false;
   ```
   OR it into `humanHit` / `catHit` so a swing that connects only with a crate still plays the solid punch sound rather than `human_punch_weak`. Do the same in the cat block. Being inside the existing `!inSafeRoom(attacker)` guard is what keeps safe-room props intact.
4. **Sound** — in the same block that drains the other pending flags (:3306–3319), following the established rotation pattern:
   ```ts
   const smashes = this.destructibles?.drainSmashes() ?? 0;
   for (let i = 0; i < smashes; i++) {
     const sounds = ['wood_smashing_1', 'wood_smashing_2'] as const;
     this.audio?.play(sounds[this.woodSmashSoundIdx % sounds.length]);
     this.woodSmashSoundIdx++;
   }
   ```
   Add `private woodSmashSoundIdx = 0;` beside the existing `woodBreakSoundIdx`. Rotation, not `playRandom` — the user asked for alternation. If more than one prop breaks in a frame, consider playing only the first to avoid a stacked blast; if so, still advance the index once and note why.
5. **Render** — pass `destructibles` through `RenderContext` at the four `RenderPipeline` call sites (:2825, :2837, :2851, :2855) as described in §5g.
6. **Dispose** — nothing to release. `onExit` (:1598) needs no change; the system holds no listeners or timers.

`BuildingInteriorScene` is untouched: interiors get no destructibles, so shop and cabin barrels stay put.

---

## 7. Checklist

Work top to bottom — each stage compiles and is verifiable on its own. Tick items off as you go.

### Stage 1 — Art (§1)

- [ ] Open the three current PNGs and read §1a so you know what you're fixing.
- [ ] Write `scripts/generate-destructible-props-sprite.ts`, modelled on `scripts/generate-grotesque-spider-sprite.ts`.
- [ ] Declare the geometry constants at the top: `FRAME_W = 96`, `FRAME_H = 96`, `TILE_X = 16`, `TILE_Y = 16`, `TILE_SCALE = 64`.
- [ ] Factor the shared wood primitives (plank fill, seam, iron hoop arc, contact shadow) into local helpers instead of repeating gradients three times.
- [ ] Draw row 0 `idle` for all three props, to the §1b art direction.
- [ ] Draw row 1 `damaged` — same silhouette as `idle` so the swap doesn't pop.
- [ ] Draw row 2 `shatter`, 6 frames, with a dust puff behind the wood in frames 1–3.
- [ ] Draw row 3 `remains` — flat, no vertical volume, so the tile reads as walkable.
- [ ] Run `npx tsx scripts/generate-destructible-props-sprite.ts`; confirm three 576×384 PNGs land in `src/images/environment/props/`.
- [ ] Update the `barrel`, `barrel_side` and `crate` entries in `src/images/environment/props/manifest.json` to the new geometry and four states.
- [ ] **Check in-game**: props still render intact and correctly positioned at their old footprint (a blank prop means a path typo — `loadSprites` swallows 404s).
- [ ] **Check in-game**: a market stall still reads correctly (`src/sprites/marketStall.ts:618`, `:621` reuse these keys).

### Stage 2 — Groundwork (§2, §3)

- [ ] Add the `placeProp(tile, propType)` helper to `src/map/DungeonGenerator.ts`.
- [ ] Route the `stampVignette()` prop writes through it (`:359`, driven by `VIGNETTES` at `:218–330`).
- [ ] Route the per-room decoration-cycle writes through it: `:1054`, `:1082`, `:1093`, `:1106`, `:1109`, `:1133–1135`, `:1168–1173`.
- [ ] Do the same for the interior writes in `src/map/GameMap.ts`: `:410–412`, `:418–419`, `:483–487`, `:550–558`, `:598–602`, `:632–637`, and the cartwright block.
- [ ] Add required `floorNumber: number` to `LevelDef` in `src/levels/types.ts`, with a JSDoc line.
- [ ] Set it on all four levels: `tutorial` → 1, `level1` → 1, `level2` → 2, `level3` → 3. The compiler will list any you miss.
- [ ] `npm run typecheck` passes.

### Stage 3 — Damage stage on the tile (§4)

- [ ] Add optional `damageStage?: number` to `TileContent` in `src/map/tileTypes.ts`, with the *why* comment.
- [ ] Export `PROP_DAMAGE_STAGE_INTACT` / `PROP_DAMAGE_STAGE_CRACKED` from the new system module (create the file as a stub now if it doesn't exist yet) — no bare literals in the renderers.
- [ ] Switch the sprite state from `damageStage` in `src/map/tiles/interiorTiles.ts:298` (barrel).
- [ ] Same in `src/map/tiles/decorationTiles.ts:627` (barrel_side) and `:637` (crate).
- [ ] **Check in-game**: temporarily force `damageStage = 1` on a tile and confirm the cracked art appears; revert the hack.

### Stage 4 — `DestructiblePropSystem` (§5)

- [ ] Create `src/systems/DestructiblePropSystem.ts` implementing `GameSystem`.
- [ ] Declare every constant from §5b up front — no magic numbers anywhere in the file.
- [ ] Define `PropHealth`, `ShatterBurst`, `Wreckage`, `Splinter`; key the health map with `tileKey()` from `src/systems/tileKey.ts` (do not hand-roll a second key format).
- [ ] Implement `tryMeleeHit()` mirroring the mob filter chain in `CombatSystem.ts:77–100` — distance, then facing cone, then damage.
- [ ] Export `MELEE_POINT_BLANK_RANGE` from `src/systems/CombatSystem.ts:19` (currently module-private) and import it; don't redeclare the value.
- [ ] Set `damageStage` to cracked when HP falls below `PROP_CRACK_HP_FRACTION`.
- [ ] Implement the break: open the tile via `tile.groundType ?? inferFloorType(...)`, clear `damageStage`/`groundType`.
- [ ] Push the `ShatterBurst`; advance it in `update()`; draw it with `progressFrameIndex` in `renderEffects`.
- [ ] Spawn splinters in a forward cone away from the attacker; integrate gravity + drag + spin; fade over the last third of life.
- [ ] Push the `Wreckage` decal; fade it over `WRECKAGE_FADE_FRAMES`; cap at `MAX_WRECKAGE`, dropping the oldest.
- [ ] Increment `smashCount`; expose `drainSmashes()`. The system must never call `AudioManager` directly.
- [ ] Delete the health entry after the break.
- [ ] Implement `renderWreckage()` and `renderEffects()`.

### Stage 5 — Shared coin drop (§5f)

- [ ] Add `sharedCoins?: boolean` to `PendingLoot` and a trailing `sharedCoins = false` param to `LootSystem.addLoot` (`src/systems/LootSystem.ts:121–137`). Existing call sites must stay untouched.
- [ ] In `LootSystem.update()` (`:190–196`), pay **both** party members the full coin amount when `sharedCoins` is set; keep the item loop crediting `loot.owner` alone.
- [ ] In `LootSystem.render()` (`:250`), mark shared drops in the label. Use `drawText`/`TEXT_PRESETS`, not raw `ctx.fillText`.
- [ ] Drop `randomInt(floorNumber, floorNumber + 1)` coins at the tile centre on break, with `sharedCoins: true`.
- [ ] Confirm `randomInt` in `src/utils.ts` is inclusive on both ends before relying on it.

### Stage 6 — Wiring (§6)

- [ ] Add the `destructibles: DestructiblePropSystem | null` field to `DungeonScene` and construct it near `:786`, gated on `!this.levelDef.isOverworld`.
- [ ] Call `this.destructibles?.update(ctx)` in the post-combat block near `:3577`.
- [ ] Add `destructibles?: DestructiblePropSystem` to `CombatContext` (`CombatSystem.ts:45–59`).
- [ ] Call `tryMeleeHit` in both the human and cat branches of `resolvePlayerAttacks`, **before** the `bus.emit(...MeleeSwing…)` call, OR-ing the result into `humanHit` / `catHit` so a crate-only swing still plays the solid punch sound.
- [ ] Add `private woodSmashSoundIdx = 0;` beside the existing `woodBreakSoundIdx`.
- [ ] Drain `drainSmashes()` in the pending-flag block (`:3306–3319`) and **alternate** `wood_smashing_1` / `wood_smashing_2` — rotation, not `playRandom`.
- [ ] Add `destructibles` to `RenderContext` (`RenderPipeline.ts:89+`) and pass it at all four call sites (`DungeonScene.ts:2825`, `:2837`, `:2851`, `:2855`).
- [ ] Null-guard `renderWreckage()` in `renderWorld` after `bodyPartGore.renderSettled` (`:167`).
- [ ] Null-guard `renderEffects()` in `renderEffects` next to `gore.renderParticles` (`:326`).

### Stage 7 — Verification (§8)

- [ ] Every manual check in §8 passes.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run format` run.

## 8. Verification

Manual, in-game (`npm run dev`, see the `dev-workflow` skill):

- [ ] Punch a crate on floor 1 — one hit cracks it, the second shatters it, splinters fly away from the player, wreckage stays on the floor, 1–2 coins drop and can be walked over.
- [ ] Confirm **both** the human and the cat gain the full coin amount from one pickup: note each player's coin count in the inventory panel before and after (the HUD total at `src/ui/HUD.ts:201` is pooled, so it can't tell you this on its own).
- [ ] Walk through the broken tile; confirm a mob will path through it too.
- [ ] Break two props back to back and confirm the sound **alternates** `wood_smashing_1` → `wood_smashing_2` → `wood_smashing_1`.
- [ ] Load `?level=level2` and confirm the drop is 2–3 coins.
- [ ] Enter a safe room and swing at a barrel — nothing should break.
- [ ] Walk through the overworld town (`?level=level3`) and confirm street barrels and crates are still indestructible.
- [ ] Look at a market stall to confirm the redrawn art still reads there (`src/sprites/marketStall.ts:618`).

Then the gates from `CLAUDE.md`, all three must pass:

```
npm run typecheck
npm run lint
npm run format
```

## 9. Explicitly out of scope

- Dynamite breaking props. It is a natural follow-up (`DynamiteSystem` already has an AoE pass) but is not requested here; if added later it would call the same `tryMeleeHit`-adjacent entry point with an area query.
- Mobs breaking props.
- Items other than coins dropping from props.
- Making interior or town props destructible.
