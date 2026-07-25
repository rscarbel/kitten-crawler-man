# Market Square Vendors — Refactor Plan

**Status:** implemented — see `market-square-vendors-progress.md` for what landed and where it deviated
**Audience:** implementing agent (Sonnet). Read `CLAUDE.md` first — every rule there applies (no `as`, no `!`, no `any`, no magic numbers, `src/ui/*` helpers for chrome, comments explain *why*).
**Skills worth loading:** `game-architecture`, `add-person`, `add-ui`, `add-sound`, `add-system`.

## Goals

1. **Vendors are people, not thumbnails.** A market vendor should read at the same scale as every other human in the town square.
2. **Stalls look like stalls.** A convincing market cart with depth, a canopy, produce/goods, crates, and a sign — not four flat rectangles.
3. **Stalls are a manageable system.** One data file defines any number of vendors with their own identity, inventory, and art variant; adding a vendor is a data edit, not a code edit.
4. **One clean purchase interface** shared with the tavern/temple/tattooist menus instead of two near-identical panels.
5. **Audio is settled — don't add to it.** Every sound is already on disk and registered; the new `coin_pouch` just needs a `play` call ([Phase 5](#phase-5--sounds)). Do not request, source, or invent further audio for this feature, and never register a `SoundId` whose file doesn't exist.

## What's wrong today (evidence)

| Problem | Where |
| --- | --- |
| Vendor figure is ~13 px tall (3 px head radius + 8×7 px body) inside a 32 px tile | `src/systems/TownPropSystem.ts:497-499`, drawn at `:541-558` |
| Citizens draw at 32 px × `HUMANOID_NPC_SCALE` (1.4) ≈ 45 px, so a vendor is ~29 % of a passer-by's height | `src/creatures/Townsperson.ts:20`, `src/sprites/humanoidScale.ts:11` |
| Stall art is 2 posts + an 8 px flat striped band + a 6 px counter + three 3 px squares, all flat fills, no shading or perspective | `src/systems/TownPropSystem.ts:487-583` |
| The awning is painted *last*, over the posts and vendor, so layering reads wrong | `src/systems/TownPropSystem.ts:572-581` |
| Stall footprint is a single 32 px tile — too small to read as a market cart | `src/systems/TownPropSystem.ts:239-253` |
| Vendors have no name, appearance, dialog, or facing; the awning colour is the only per-stall variation, keyed off array index | `StallProp(tile, i)` at `:251`, `variant` at `:513` |
| Stock is a hardcoded pair with no notion of quantity, sold-out, or restock | `src/systems/townMarket.ts:69` |
| `MarketStallPanel` (247 lines) duplicates `ServiceMenuPanel` (286 lines) almost constant-for-constant | `src/ui/MarketStallPanel.ts` vs `src/ui/ServiceMenuPanel.ts` |
| Stall placement/interaction is tangled into `TownPropSystem`, which also owns the notice board, benches, wells and the fortune teller (762 lines) | `src/systems/TownPropSystem.ts` |

## Target shape

**New files**

| File | Responsibility |
| --- | --- |
| `src/systems/market/vendorDefs.ts` | Pure data: every vendor's identity, art variant, inventory, placement hint, barks. The only file you edit to add a vendor. |
| `src/systems/market/MarketSystem.ts` | `GameSystem`: places stalls, owns stall state + stationed vendor NPCs, handles interact/prompt, exposes renderables. |
| `src/systems/market/MarketStock.ts` | Cross-scene stock state (the `ClubMembership` pattern — see `src/core/ClubMembership.ts`). |
| `src/sprites/marketStall.ts` | All stall art, drawn in named layers so the vendor sits *between* back and front. |

**Changed files**

| File | Change |
| --- | --- |
| `src/systems/TownPropSystem.ts` | Delete `StallProp`, `Stall`, `placeStalls`, `nearestStall`, the `onBrowseStall` constructor param, the stall branches of `tryInteract`/`renderPrompt`, and `STALL_*` constants. Keep board/benches/heal spots. |
| `src/systems/townMarket.ts` | Deleted; its content moves into `vendorDefs.ts`. |
| `src/ui/ServiceMenuPanel.ts` | Generalised into the single priced-menu panel (see Phase 4). |
| `src/ui/MarketStallPanel.ts` | Deleted. |
| `src/scenes/DungeonScene.ts` | Construct `MarketSystem`, route input/render/prompt to it, thread `MarketStock`. |
| `src/scenes/BuildingInteriorScene.ts` | Thread `MarketStock` through the constructor alongside `clubMembership` so it survives building round-trips. |
| `src/audio/sounds.ts` | **Already done** — `coin_pouch` is registered. No further edits needed. |

Do the phases in order; each one should end with `npm run typecheck && npm run lint && npm run format` passing.

---

## Phase 1 — Vendor data model

Create `src/systems/market/vendorDefs.ts`. This is the "manageable inventory" ask: one array, one entry per vendor.

```ts
import type { ItemId } from '../../core/ItemDefs';
import type { TownRole } from '../../sprites/person/PersonAppearance';

/** Which stall silhouette and palette `src/sprites/marketStall.ts` draws. */
export type StallStyle = 'produce_cart' | 'tinker_bench' | 'butcher_block' | 'cloth_awning';

/** Drives the little goods drawn on the counter, so a stall looks like what it sells. */
export type GoodsMotif = 'produce' | 'bottles' | 'meat' | 'trinkets';

export interface VendorStockLine {
  id: ItemId;
  label: string;
  price: number;
  desc: string;
  /** Units available per restock. Omit for an unlimited line. */
  stock?: number;
}

export interface VendorDef {
  /** Stable key — used for stock state and for the appearance seed. Never reuse. */
  id: string;
  /** Vendor's own name, e.g. 'Bess Ottoline'. Shown in the panel header. */
  vendorName: string;
  /** Stall name, e.g. "Greengrocer's Cart". Shown as the panel title. */
  stallName: string;
  role: TownRole;
  /** Seed for `generatePersonAppearance`; fixed so a vendor looks the same every visit. */
  appearanceSeed: number;
  style: StallStyle;
  motif: GoodsMotif;
  /** Rotated greeting lines, indexed by how many times the player has browsed. */
  barks: ReadonlyArray<string>;
  items: ReadonlyArray<VendorStockLine>;
  /** Offset in tiles from the square centre for the stall's west tile. */
  placement: { dx: number; dy: number };
}
```

Requirements:

- Port the two existing stalls (`Greengrocer's Cart`, `Tinker's Stall`) verbatim in items and price constants — those come from `src/systems/townMarket.ts:25-66`. Keep the named price constants; do not inline the numbers.
- Give each a `vendorName`, a `role` (`farmer` for the greengrocer, `merchant` for the tinker), a fixed `appearanceSeed`, and **three** barks so the greeting rotates like `pubServeLine` in `src/systems/townPub.ts:47-53`.
- `placement` replaces `STALL_FLANK_OFFSET`: greengrocer `{ dx: -8, dy: 0 }`, tinker `{ dx: 8, dy: 0 }` reproduces today's layout. Name the offsets as constants. Resolve them against `Math.floor(gameMap.gridSize / 2)`, which is what every other prop placement uses (`src/systems/TownPropSystem.ts:231`, `:240`, `:263`, `:272`) — **not** `gameMap.townSquareCentre`, which is `| undefined` and would force a fallback branch for no benefit.
- Export `export const MARKET_VENDORS: ReadonlyArray<VendorDef>`.
- Add a module JSDoc stating the invariant: **`items` must reference existing `ItemId`s** — this file adds no new items, it only gives the player a place in town to buy them.

Create `src/systems/market/MarketStock.ts` following `src/core/ClubMembership.ts` exactly in spirit:

```ts
/** Remaining units per vendor line, keyed `${vendorId}:${itemId}`. Absent ⇒ never bought / unlimited. */
export interface MarketStock {
  remaining: Map<string, number>;
}

export function createMarketStock(): MarketStock;
export function stockKey(vendorId: string, itemId: ItemId): string;
/** Units left for a line, or `null` when the line is unlimited. */
export function remainingFor(stock: MarketStock, vendorId: string, line: VendorStockLine): number | null;
export function consumeStock(stock: MarketStock, vendorId: string, line: VendorStockLine): void;
```

`remainingFor` returns `null` for unlimited so callers narrow explicitly instead of using a sentinel number. **Ship every current line as unlimited** (no `stock` field) — the plumbing exists for future rare goods, but don't gate today's consumables behind counts. Note that in a comment on `VendorStockLine.stock`.

Thread `MarketStock` through `DungeonScene` and `BuildingInteriorScene` constructors the same way `clubMembership` is threaded (`src/scenes/BuildingInteriorScene.ts:269-280`, `:333`) — optional param, `?? createMarketStock()`. Without this, stock resets on every shop-then-leave trip because the town scene is rebuilt on each building round-trip.

---

## Phase 2 — `MarketSystem`

Create `src/systems/market/MarketSystem.ts` implementing `GameSystem`. Lift the stall half of `TownPropSystem` into it.

**State per stall:**

```ts
interface MarketStall {
  def: VendorDef;
  /** West and east tiles of the 2×1 counter footprint. */
  tiles: readonly [TileXY, TileXY];
  /** The stationed vendor, drawn by the stall so occlusion is correct. */
  vendor: Townsperson;
  /** How many times the player has browsed — rotates `def.barks`. */
  visits: number;
}
```

**Placement.** Stalls become **2 tiles wide × 1 deep**; a 32 px cart is too small to read. Add a `findFreeSpan(preferred: TileXY): readonly [TileXY, TileXY] | null` that spirals outward like `TownPropSystem.findFreeTile` (`src/systems/TownPropSystem.ts:308-321`) but requires *two horizontally adjacent* free tiles. Reuse the same predicate — `isWalkableIgnoringPermanent`, not `isWalkable` — and preserve the idempotence comment at `:299-307`; it is load-bearing (the overworld map instance is reused across building round-trips, so a placement that consults its own permanent block drifts a tile per trip and leaks blocked tiles).

Block both tiles via `gameMap.blockTilePermanently`. Construct the `MarketSystem` **before** `TownLifeSystem` for the same reason the comment at `src/scenes/DungeonScene.ts:855-856` gives: blocked prop tiles must be excluded from citizen spawn candidates.

**Occupied-tile coordination.** `TownPropSystem` keeps a private `occupied` set so props don't stack. Once stalls live elsewhere, that set no longer sees them — but `blockTilePermanently` + `isWalkableIgnoringPermanent` will *not* catch it either. Fix: have `MarketSystem` expose `get reservedTiles(): ReadonlySet<string>` and pass it into `TownPropSystem`'s constructor as an extra "already taken" set consulted by `findFreeTile`. Keep `tileKey` in one place — move it to a small shared helper (`src/systems/tileKey.ts`) rather than duplicating it.

**Vendor NPC.** Each stall constructs a `Townsperson` (`src/creatures/Townsperson.ts`) with:

- `x`/`y` one tile **north** of the counter's west-east midpoint, so the vendor stands behind it.
- `role` and `seed` from the def, `initialFacing: 'down'` so they face the customer side (the same trick `InteriorOccupantSystem` uses for stationed occupants).
- `speed: 0` and a `WanderParams` whose destination source always returns the vendor's own tile — a vendor should sway/idle, not walk off. Confirm `stepWander` tolerates a zero-distance target without jitter; if it doesn't, skip `vendor.update()` entirely and drive `phase` yourself for the idle bob.
- On browse, call `vendor.faceToward(player.x, player.y)` and set `frozen = true`; clear on close. `Townsperson` already supports both (`:87-90`, `:60-61`).

**Interaction.** Expose `tryInteract(active: Player): boolean` and `renderPrompt(ctx, camX, camY, active)` with the same `INTERACT_RADIUS_TILES = 1.6` reach as today, tested against **either** counter tile so the player can stand in front of either half. Prompt label: `'Browse'`.

**Renderables.** Expose `get props(): ReadonlyArray<TownPropRenderable>` — one renderable per stall (not one per tile, and *not* a separate entry for the vendor; see Phase 3 on why). Move the `TownPropRenderable` interface out of `TownPropSystem.ts` into `src/systems/townPropRenderable.ts` so both systems import it without a circular dependency. Y-sort anchor is the counter's front (south) edge.

**Scene wiring.** In `DungeonScene`, replace the `onBrowseStall` callback param of `TownPropSystem` with a `MarketSystem` constructed alongside it, and have `openMarketStall` take the stall's built menu. Every place that currently checks `this.marketStall?.isOpen` (lines 1400, 1422, 1474, 2091, 2151, 2386, 2688, 2693, 2999, 3717-3723, 3836) must be updated to the new panel field — grep for `marketStall` and fix all of them; missing one silently breaks the Space/Esc input-priority chain or leaves the modal unrendered.

---

## Phase 3 — Stall art and vendor scale

Create `src/sprites/marketStall.ts`. Raw `ctx` calls are correct here (game-world sprite, not UI chrome) — see the note at the top of `src/sprites/person/drawPerson.ts:10-11`.

**The scale fix.** The vendor is now a real `Townsperson`, so it draws through `drawPerson` at `scaleHumanoidBox(..., tileSize)` → 45 px, matching every citizen in the square. Nothing else is needed for goal #1 — but the stall geometry must be rebuilt around a 45 px figure. Concretely: the counter top sits near the figure's waist (~55 % of its height above the ground line) and the canopy clears its head, so the canopy ridge lands roughly **1.8 tiles** above the footprint. Today's canopy is at 0.75 tiles (`STALL_AWNING_TOP_FRACTION`) — far too low; the vendor's head would punch through it.

**Layered draw order.** Export three functions so `MarketSystem`'s renderable can sandwich the vendor:

```ts
export function drawStallBack(ctx, sx, sy, s, style, motif): void;   // canopy posts, back wall/sign, hanging wares
export function drawStallFront(ctx, sx, sy, s, style, motif): void;  // counter, counter goods, crates, apron cloth
export function drawStallCanopy(ctx, sx, sy, s, style): void;        // the canopy itself, above everything
```

The stall renderable's `render` then calls back → `vendor.render(...)` → front → canopy. This is why the vendor must **not** be its own Y-sort entry: the sort key is a single Y value, so it cannot place a figure both behind the counter and in front of the back wall. One renderable owning three layers is the only way to get it right.

**What makes it convincing** (each measure a fraction of `s`, each fraction a named constant):

- **Canopy with depth, not a band.** A sloped front face plus a darker underside so it reads as fabric over a frame; scalloped or wavy front hem; a soft shadow cast on the counter and the ground under it. Stripes run *with* the slope, not as a flat repeating band.
- **Counter with a top surface.** A lighter parallelogram top plus a darker front face and a visible edge lip — that alone converts a flat rect into a 3-D box. Plank seams on the front face.
- **Goods keyed to `motif`.** Produce: stacked round fruit/veg in a shallow crate, two colours plus a highlight dot each. Bottles: corked silhouettes with a glass highlight stripe. Meat: hanging cuts from the canopy frame. Trinkets: small mixed shapes on a cloth. Draw 5-9 items in a slightly irregular arrangement — perfectly even spacing is what makes today's three squares read as programmer art.
- **Supporting clutter.** A stacked crate or barrel at one end and a rolled awning strap on a post. Match the crate/barrel look already established at `src/map/tiles/decorationTiles.ts:146-165` (`BARREL_SIDE`, `CRATE`) so the market reads as the same town — those are inline `case` bodies, so copy the palette and banding rather than trying to call them.
- **A hanging sign** with the stall's initial or a motif glyph — cheap, and it's what sells "shop" at a glance.
- **Contact shadow.** An ellipse under the footprint, like other props, or the stall floats.
- **Per-style palettes.** One `STALL_PALETTES: Record<StallStyle, StallPalette>` table with canopy, canopy-shade, wood, wood-dark, and accent. The greengrocer's green-and-cream and the tinker's red-and-cream come from here — no more `variant % colors.length` indexing off an array position.

Add a per-stall `phase` advanced each frame and use it for one small idle motion (canopy hem ripple or a swaying hanging sign). One is enough; more starts to look busy.

**Wood colours.** `WOOD` / `WOOD_DARK` / `PARCHMENT` currently live as module constants in `TownPropSystem.ts:356-359` and are shared by the board, bench, and seer table. Move them into a shared palette module (`src/sprites/townPalette.ts`) and import from both files rather than redefining them in `marketStall.ts`.

---

## Phase 4 — One priced-menu panel

`MarketStallPanel` and `ServiceMenuPanel` are the same panel twice: identical `PANEL_WIDTH`, `PANEL_PADDING`, `TITLE_SIZE`, `BARK_SIZE`, `HEADER_HEIGHT`, `ROW_HEIGHT`, `FOOTER_HEIGHT`, `BUY_BTN_*`, `CLOSE_BTN_*`, `FEEDBACK_*`, `PANEL_RADIUS`, `OVERLAY_ALPHA`, and near-identical render/click/feedback logic. Collapse them.

**Approach (recommended):** generalise `ServiceMenuPanel` into the single panel, delete `MarketStallPanel`, and express a stall purchase as a menu whose handler adds to the inventory.

`ServiceOption` already has everything a stall row needs, including `unavailable?: string` for a **"Sold out"** row — which `MarketStallPanel` cannot express today. `ServiceMenuBuilder` (rebuild after each purchase so availability stays honest) is exactly the restock/stock-count hook.

Steps:

1. Rename the module to `src/ui/PricedMenuPanel.ts` with types `PricedMenu`, `PricedOption`, `PricedPurchaseHandler`, `PricedMenuBuilder`. Keep `ServiceMenuPanel`-era JSDoc intact; update the `MarketStallPanel` cross-reference in it.
2. Update the four call sites to the new names — `src/systems/townPub.ts`, `src/systems/townTemple.ts`, `src/systems/townTattooParlor.ts`, and `src/scenes/BuildingInteriorScene.ts` (`:63`, `:240`, `:365`, `:1065-1094`). Mechanical rename; no behaviour change.
3. Add `buildVendorMenu(def: VendorDef, stock: MarketStock, visits: number): PricedMenu` in `src/systems/market/vendorMenu.ts`, mirroring `buildTavernMenu` (`src/systems/townPub.ts:69-81`): title `def.stallName`, bark rotated from `def.barks` by `visits`, one option per line with `unavailable: 'Sold out'` when `remainingFor` returns `0`.
4. Add `purchaseFromVendor: PricedPurchaseHandler` mirroring `serveDrink` (`:84-90`): find the line by `key`, `addItem`, verify the count actually rose (the inventory-full guard at `src/ui/MarketStallPanel.ts:223-228` **must** survive the move — without it the player is charged for an item they don't receive), `consumeStock`, return the confirmation line.
5. Coin deduction lives in the panel for services but in `tryBuy` for stalls today. Pick one — **the panel deducts, the handler performs** — and make the vendor handler not touch coins. If `addItem` fails on a full inventory the handler must be able to reject *before* the deduction: give `PricedPurchaseHandler` a return of `{ ok: boolean; line: string }` and have the panel only deduct on `ok`. This is the one genuine behaviour change in the phase; call it out in the commit.
6. Delete `src/ui/MarketStallPanel.ts` and `src/systems/townMarket.ts`.

**Fallback if this feels too wide:** keep `MarketStallPanel`, add stock/sold-out support to it, and leave the duplication. Say so explicitly in the commit message if you take this path — it leaves goal #4 unmet.

---

## Phase 5 — Sounds

Every sound this feature needs is already on disk and registered. **No new audio assets are to be requested or added** — the only new one, the coin pouch, is done.

| Moment | `SoundId` | Status |
| --- | --- | --- |
| Panel opens | `menu_open` | Already played by `openMarketStall` (`src/scenes/DungeonScene.ts:2072-2077`) |
| Successful purchase | `purchase_success` | Existing |
| Successful purchase, layered under the above | `coin_pouch` | **New — registered, needs wiring** |
| Buy blocked (can't afford / sold out / inventory full) | `error_taking_action` | Existing |
| Buy button click | — | Handled by `playButtonSound` per `CLAUDE.md`; do not add per-button `play` calls |

### Wiring `coin_pouch`

`src/audio/effects/coin_pouch.mp3` — a short purse jingle, drier and cheaper-sounding than `purchase_success`. Already registered in `SOUND_IDS_TUPLE` and `SOUND_MANIFEST` (`src/audio/sounds.ts`), so `preload` picks it up automatically. All that's left is to play it.

Play it **layered under `purchase_success`** on a successful market-stall purchase, so buying from a stall feels physically different from buying at the general store. Both fire on the same frame; give `coin_pouch` a named sub-unity volume constant (e.g. `COIN_POUCH_VOLUME`) via `audio.play('coin_pouch', { volume: COIN_POUCH_VOLUME })` so it reads as a texture layer rather than competing with the sting.

Two constraints:

- It fires **only** on a confirmed purchase — after the inventory-full guard and the coin deduction both pass. A blocked buy plays `error_taking_action` and no pouch.
- It is market-stall-only. Do not add it to the shared `PricedMenuPanel` purchase path, or the tavern/temple/tattooist inherit it too. The panel's purchase handler is the right seam: play it from `purchaseFromVendor` (Phase 4, step 4), not from the panel.

Nothing else in this phase is structural — no ambient emitters, no proximity cooldowns, no `MarketSystem.ambientEmitters`. If a market ambience bed is wanted later it can be added on its own; the `AmbientSoundSystem` emitter pattern (`src/systems/AmbientSoundSystem.ts`, and `DungeonScene.buildTownAmbientEmitters` at `:1563-1597`) is ready for it.

**Hard rule if that ever happens:** a `SoundId` registered with no file on disk makes `preload` warn on every load attempt (`src/audio/AudioManager.ts:269-270`). Never register an id before its file exists.

---

## Validation

Gates (from `CLAUDE.md`) — all three must pass before the work is done:

```
npm run typecheck
npm run lint
npm run format
```

Manual QA in the running town (see the `dev-workflow` and `run` skills):

1. Stand a vendor next to a wandering citizen — **heights should match.** This is the headline fix; screenshot it.
2. Walk around a stall from all four sides: the vendor is occluded by the counter from the south, and never drawn over the canopy.
3. Walk *behind* the stall — the stall should not be drawn over the player when the player is further south, and should be when further north (Y-sort sanity).
4. Both stalls block movement across both of their tiles; no citizen spawns inside one.
5. Enter a building and come back out: stalls are in the **same tiles** (the idempotent-placement invariant), and any consumed stock is still consumed.
6. Buy every line: coins deducted once, item in inventory, feedback line shows, sold-out row disables if you added a limited line for testing.
7. Buy with a full inventory: **not charged**, feedback says inventory is full.
8. Buy with insufficient coins: Buy button disabled, price shown in the red tone.
9. Space and Esc both close the panel; a tap outside closes it; a tap inside near a button does not.
10. On mobile/touch: the close hint reads `Close`, and every button responds to tap.
11. Tavern drinks and the temple blessing still work after the panel rename (Phase 4 regression check).

## Non-goals

- No new items — vendors stock existing `ItemId`s only.
- No new buildings, tiles, or map generation changes.
- No vendor questlines or full `DialogBox` conversations; the rotating bark in the panel header is the whole dialog surface.
- No selling *to* vendors. If that's wanted later, `PricedMenuPanel` is the wrong shape for it — plan it separately.
- No change to the general store (`ShopSystem`) or the club vendors, beyond the mechanical rename in Phase 4.
