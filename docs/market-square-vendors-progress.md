# Market Square Vendors — Progress

Companion log to `market-square-vendors.md`. One entry per phase, recording what
landed, what deviated from the plan, and why.

## Phase 1 — Vendor data model ✅

- `src/systems/market/vendorDefs.ts` — `VendorDef` / `VendorStockLine` /
  `StallStyle` / `GoodsMotif`, plus `MARKET_VENDORS`. Both existing stalls ported
  verbatim (same items, same named price constants), each given a vendor name
  (Bess Ottoline, Orlo Pemberwick), a role, a fixed appearance seed, and three
  rotating barks. Placement offsets (`WEST_STALL_DX` −8 / `EAST_STALL_DX` +8,
  `STALL_ROW_DY` 0) reproduce the old `STALL_FLANK_OFFSET` layout, resolved
  against `Math.floor(gridSize / 2)`.
- `src/systems/market/MarketStock.ts` — `createMarketStock`, `stockKey`,
  `remainingFor` (`null` ⇒ unlimited), `consumeStock`. Every shipped line is
  unlimited; the counting plumbing is there for future rare goods.
- `MarketStock` threaded through `DungeonSceneOptions` and re-passed on the
  building round-trip and the death restart, exactly where `clubMembership` is.

**Deviation:** the plan also asked to thread `MarketStock` through
`BuildingInteriorScene`'s constructor. Nothing inside an interior touches market
stock, and the interior never constructs a `DungeonScene` — it calls the
`onExitCallback` the town scene handed it, whose closure already re-passes the
same `MarketStock` object by reference. The parameter would have been dead, so it
was left out; the round-trip invariant the plan wanted is still satisfied.

## Phase 2 — `MarketSystem` ✅

- `src/systems/market/MarketSystem.ts` — 2×1 counter footprints via
  `findFreeSpan` (spiral search requiring two horizontally adjacent tiles, tested
  with `isWalkableIgnoringPermanent` so placement stays idempotent across
  building round-trips), both tiles blocked permanently, one stationed
  `Townsperson` per stall standing a tile north of the counter mid-point facing
  `down`, `Browse` interaction at the same 1.6-tile reach against either tile.
- `TownPropRenderable` moved to `src/systems/townPropRenderable.ts`; `tileKey`
  moved to `src/systems/tileKey.ts`. `TownPropSystem` lost `StallProp`, `Stall`,
  `placeStalls`, `nearestStall`, `onBrowseStall`, the stall interact/prompt
  branches and every `STALL_*` constant, and now takes the market's
  `reservedTiles` as a "claimed elsewhere" set consulted by `findFreeTile`.
- `DungeonScene`: market built before `TownPropSystem` (so props dodge the stall
  footprints) and before `TownLifeSystem` (so citizens don't spawn in them). The
  `marketStall` field is now `marketPanel: PricedMenuPanel`; every one of the
  ~13 `marketStall?.isOpen` sites was updated. Props from both systems are merged
  into one Y-sort list (`townPropRenderables`), built once.
- Vendor idle: `speed: 0` with a `pickTarget` returning the vendor's own spot.
  `stepWander` handles the zero-distance target cleanly — it reports "arrived",
  re-pauses, and never moves, so the figure holds its post with idle animation.
- On browse the vendor is frozen facing the player; `update()` clears `frozen`
  whenever the panel isn't open, so any dismissal path (Space, Esc, tap-outside)
  releases them.

**Extra:** `RenderPipeline`'s town-prop cull margin went from one tile to four
(`PROP_CULL_MARGIN`). A stall is two tiles wide and its canopy rises three tiles
above its Y-sort anchor, so the old margin popped it off at the screen edge while
it was still partly visible.

## Phase 3 — Stall art and vendor scale ✅

- `src/sprites/marketStall.ts` — `drawStallBack` / `drawStallFront` /
  `drawStallCanopy`, one `STALL_PALETTES` table for all four styles, every measure
  a named fraction of the tile size. Canopy is a trapezoid (narrow ridge, wide
  hem) so stripes fan with the slope, with a shaded underside, scalloped hem, a
  ridge cap highlight and a cast shadow on the counter slab. Counter is a false-
  perspective top slab + lip + planked front face, with a wavy apron and legs.
  Goods are motif-keyed (produce/bottles/meat/trinkets), 7 per stall in a fixed
  irregular jitter pattern. Plus a hanging sign carrying the motif glyph, strung
  wares off the frame beam, a rolled spare awning on the west post, and a contact
  shadow ellipse.
- Idle motion: one only — the hem scallops ripple off a per-stall `phase`
  advanced in `MarketSystem.update()` (not in `render`, so off-screen stalls stay
  in step).
- `WOOD` / `WOOD_DARK` / `PARCHMENT` moved to `src/sprites/townPalette.ts`
  (plus a new `WOOD_LIGHT` for the counter slab) and imported by both
  `TownPropSystem` and `marketStall.ts`.
- Vendor scale is fixed for free: the vendor is a real `Townsperson`, so it draws
  through `drawPerson` at `scaleHumanoidBox(..., tileSize)` — the same ~45 px as
  every citizen, verified against a rendered side-by-side.

**Deviation:** the plan said to copy the palette/banding of the `BARREL_SIDE` /
`CRATE` tile cases because they were "inline case bodies". They are not — both
draw real PNG sprites via `drawSpriteKey`. The stall's crate/barrel clutter calls
those same sprites instead, which matches the town more exactly than a copy would.

## Phase 4 — One priced-menu panel ✅

- `ServiceMenuPanel` → `src/ui/PricedMenuPanel.ts` with `PricedMenu`,
  `PricedOption`, `PricedPurchaseHandler`, `PricedMenuBuilder`.
  `MarketStallPanel` and `townMarket.ts` deleted.
- Call sites renamed mechanically: `townPub`, `townTemple`, `townTattooParlor`,
  `BuildingInteriorScene`.
- **Behaviour change (as the plan called for):** a purchase handler now returns
  `{ ok, line }` and the panel deducts coins *only* on `ok`. The inventory-full
  guard from `MarketStallPanel` survives inside the vendor handler, so a player
  with no room is no longer charged. Service handlers return `ok: false` for their
  "shouldn't happen" fallbacks (unknown drink/design), which also stops them
  charging for nothing.
- `src/systems/market/vendorMenu.ts` — `buildVendorMenu` (title, rotated bark,
  one row per line, `unavailable: 'Sold out'` when `remainingFor` is 0) and
  `createVendorPurchase` (bound to a vendor because the sale books stock and plays
  the market's own sounds).

## Phase 5 — Sounds ✅

- `coin_pouch` plays layered under `purchase_success` at `COIN_POUCH_VOLUME`
  (0.55) on a confirmed market purchase only — from `createVendorPurchase`, after
  the inventory-full guard passes, so the tavern/temple/tattooist never inherit
  it and a blocked buy never plays it.
- A blocked buy (inventory full, sold out) plays `error_taking_action` from the
  same handler. Insufficient coins keeps the existing behaviour: the Buy button is
  disabled and the click is a no-op.
- No new audio assets; nothing registered.

## Review round 1 — fixes applied

An independent review of the working diff raised four items; all four were real
and all four are fixed.

1. **Y-sort anchor double-counted the pipeline's foot offset.** `StallProp.y`
   returned the counter's south edge, but `RenderPipeline` already adds a whole
   tile to a prop's `y` for the sort key — so the stall sorted a tile further
   south than its ground line and drew its legs, apron, clutter and shadow over
   any player or citizen standing in front of it. Now returns the footprint's
   top-left like every other prop.
2. **`vendorName` was dead data.** Documented as shown in the panel header but
   never rendered. `PricedMenu` gained an optional `byline`, drawn small at the
   header's left opposite the coin count; `buildVendorMenu` fills it with the
   vendor's name. The room-is-the-seller menus (tavern, temple, parlour) omit it
   and are unchanged.
3. **The vendor's standing tile was neither validated nor claimed.** A future
   `placement` whose north neighbour was a wall would have stood the vendor
   inside it, and citizens walked through the vendor. `findFreeSpan` now requires
   the vendor row to be free too, and both vendor tiles are blocked and reserved
   alongside the counter. **Deviation from the plan:** the blocked footprint is
   therefore 2×2, not the 2×1 the plan specified — a vendor is a fixture, and
   walking through a person looked worse than losing two plaza tiles.
4. **The sold-out `error_taking_action` was unreachable and blocked buys were
   silent.** A disabled button is never registered for a click sound anywhere in
   this codebase, so nothing played. `PricedMenuPanel.open` now takes an optional
   `onBlocked` callback fired when a click lands on a row it refuses; the market
   passes one that plays `error_taking_action`, so Phase 5's sound table holds for
   can't-afford and sold-out as well as inventory-full. Services pass nothing and
   stay silent as before. The handler's sold-out branch keeps its guard (it is the
   stock invariant's last line of defence) minus the sound that could never fire.

## Review round 2 — fixes applied

No correctness bugs found. Three low-severity items, all addressed:

1. **The byline had ~2px of clearance from the centred title.** Left-aligning a
   variable-length name beside a variable-length centred title at a fixed 400px
   width overlaps silently for plausible future pairings (a 15-char name under an
   18-char stall name overlaps by ~13px). The byline now takes its own line under
   the bark, centred and width-bounded, and `HEADER_HEIGHT` grows by one line only
   when a byline is present — so the three service menus keep their exact previous
   layout.
2. `PHASE_STEP`'s comment said "per render" when the phase is advanced in
   `update()`. That distinction is deliberate (off-screen stalls stay in step), so
   the comment now says so instead of contradicting it.
3. `findFreeSpan` hardcoded the second tile as `west.x + 1` while the art and the
   prompt derive their width from `STALL_WIDTH_TILES`. It now derives from the
   constant too, with a comment tying the tuple's arity to it.

## Review round 3 — fix applied

One real bug, in round two's own byline fix. `drawText` treats `x` as the box's
*left edge* whenever `width` is set and centres within that box, so passing
`centerX` **and** a width shifted the byline half a panel right — both shipped
vendor names rendered past the modal's right border onto the overlay. Now anchored
at the padding edge, which keeps the wrap bound (the reserved header line only
budgets for one line) and centres correctly. Verified by rendering both vendor
panels and a tavern panel through node-canvas.

## Review round 4 — clean

No findings. The byline fix verified by measurement (both names centre on the
same `centerX` the title uses, ~130px clearance each side, wrapping unreachable
below a ~53-character name), and every other `drawText` call in the panel checked
for the same anchor/width mismatch — all correct.

Noted and deliberately left alone, because it predates this work and applies
equally to the tavern/temple/parlour: the panel lays out from the `PANEL_WIDTH`
constant while `drawModal` clamps the drawn width to the canvas, so on a canvas
narrower than 400px the right-edge prices and Buy buttons would sit past the
clamped modal. Worth its own fix someday; not this change's to make.

## Validation

`npm run typecheck`, `npm run lint`, `npm run format` all clean.

Art verified by rendering all four stall styles beside two citizens through
node-canvas (scratch script, not committed) — vendor height matches a passer-by,
the counter crosses the vendor's hips, the canopy clears their head.

Panel layout verified by rendering both vendor menus and a tavern menu through
node-canvas (scratch script, not committed): the byline centres inside the modal
under the bark, the first option row clears it, the Close button sits inside the
footer, and the no-byline tavern menu is unchanged.

Placement verified against a real generated overworld (scratch script, not
committed): on a 280-tile map (centre 140) the stalls take `132–133,140` and
`148–149,140` with vendor rows on `139`, re-place to exactly those tiles when the
market is rebuilt on the same map instance (the idempotence invariant), and the
four `TownPropSystem` props land clear of all eight claimed tiles.

The rest of the plan's in-game QA checklist — occlusion from all four sides, the
buy/blocked/full-inventory paths, Space/Esc/tap dismissal, mobile taps, and the
tavern/temple regression — still wants a pass on a running build.
