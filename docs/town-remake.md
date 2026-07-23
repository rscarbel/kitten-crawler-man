# Town Remake Plan — New Building Art, Positional Ambience, Busy Taverns

**Goal:** remake the third-floor town using the newly staged building sprites and ambient audio so the town — and especially building interiors — feels alive and real. Four headline outcomes:

1. The staged building PNGs replace the current facades; **the barracks becomes the safe room**.
2. **Positional ambient audio**: the fountain gets louder as you approach it; the blacksmith's fire crackles louder the closer you are; the square murmurs with crowd noise.
3. **Interiors feel like the places they are** — a forge that roars, a temple that hushes, an inn that bustles.
4. **Taverns are busy, look like bars, and the player can drink** (with a real drunk status effect).

This world is based on **Dungeon Crawler Carl** (see [over-city-reference.md](over-city-reference.md)); flavor choices below lean into that. This plan builds on the completed town-life workstream ([living-town.md](living-town.md)) and **supersedes its deferred items 2.5 and 5.2** (interior/town ambient audio) — tick those off there when Phase 2 here lands.

Validation gates (`npm run typecheck`, `npm run lint`, `npm run format`) apply after **every** step. Each phase is independently shippable.

---

## Part 0 — What is already staged (do not redo)

The staged commit already contains everything asset-side. **No new assets are needed; every step below is wiring.**

**Sprites** — 9 new entries in `src/images/environment/manifest.json`, each with pixel-space `blockedRegions` (collision) already authored:

| Manifest key | Image | Footprint (px → tiles @32) | Notes |
| --- | --- | --- | --- |
| `barracks` | Blue-roofed stone guardhouse, crossed-swords crest | 322×255 → ~10×8 | **The new safe room** |
| `blacksmith` | Thatched smithy, two open glowing forges | 200×122/frame → ~6.3×3.8 | **Animated**: `flame` state, 5 frames, `colsPerRow: 3` |
| `desperado_club` | Huge multi-story stone/timber club | 500×437 → ~15.6×13.7 | Replaces the club's procedural facade |
| `shop` | "SHOP" sign general store | 346×204 → ~10.8×6.4 | Replaces the General Store facade |
| `small_inn` | "INN" sign thatched inn | 346×269 → ~10.8×8.4 | The Sleeping Cat Inn |
| `tattoo_parlor` | "TATTOOS" skull-sign parlor | 330×218 → ~10.3×6.8 | **New building** (DCC: Signet's living tattoos) |
| `tavern_1` | "TAVERN" sign, red roof | 348×211 → ~10.9×6.6 | The Sunken Stump Pub |
| `tavern_2` | Antler-crested mead hall, beer-mug banners | 357×208 → ~11.2×6.5 | Second tavern (re-theme The Wanderer's Rest) |
| `temple` | Domed stone temple, glowing flame emblem | 323×282 → ~10×8.8 | **New building** |

**Sounds** — 6 ids registered in `src/audio/sounds.ts` (`SOUND_IDS_TUPLE` + `SOUND_MANIFEST`) but **currently played nowhere**: `ambient_fountain`, `ambient_fire_crackling`, `ambient_town_square_crowd`, `ambient_bar_crowd`, `ambient_magic_shop`, `ambient_pouring_a_drink`.

**Engine support** — `SpriteStateDef.colsPerRow` (frames wrapping onto subsequent sheet rows) is already implemented in `src/core/SpriteLoader.ts` / `src/core/SpriteRenderer.ts` (`frameOrigin`). `sw.js` precache is updated.

**Blacksmith sheet layout (important):** frame (0,0) is the full building (`idle`); the 5 `flame` frames (cols 1–2 of row 0, cols 0–2 of row 1) contain **only the flames on transparency**, positioned in frame-local coordinates over the forge mouths. So the render is: draw `idle`, then draw the current `flame` frame **on top at the same anchor** — not instead of.

---

## Part 1 — Where the relevant tech lives today

- **Sprite buildings**: tile `SPRITE_BUILDING` (id 45, `src/map/tileTypes.ts:88`) with `tile.spriteKey`; placed by `placeSpriteBuilding` (`src/map/OverworldGenerator.ts:330`) — currently hardcoded to a 5×4 footprint with the door at anchor-relative (2,3), used by the `village_house_1..4` houses.
- **Collision from art**: `blockedRegions` → tile offsets at module load (`computeBlockedOffsetsFromRegions`, `src/core/SpriteLoader.ts:138`, ≥50 % tile-overlap threshold) → `GameMap.buildExtraBlockedTiles()` (`src/map/GameMap.ts:1389`) → `extraBlockedTiles` → `isWalkable`. **This pipeline needs no changes** — the new manifest entries flow through it automatically once a tile carries their `spriteKey`.
- **Sprite building rendering**: `GameMap.ts:1607` in the Y-sorted decoration pass via `getSpriteDefByKey`; sort anchor from `getSortYAnchorPx`; viewport culling already accounts for overhang via `getMapSpriteExtentsPx()`.
- **Town geometry**: all in `src/map/OverworldGenerator.ts` — square is 22×22 at centre `(cx, cy)`; fountain 3×3 at `(cx+4, cy+4)`; wells at `(cx∓7, cy±7)`; current facades: "Safe Room" (`restaurant`, 14×5 at `cx+14, cy-16`), "General Store" (`store`, 14×5 at `cx-28, cy-16`), "The Desperado Club" (`club`, 16×6 at `cx+3, cy+19`), plus 10 named `house` sprite buildings (constants at lines 94–131).
- **Interiors**: `GameMap.generateInterior(type, towerFloor, buildingName)` (`src/map/GameMap.ts:341`) — `switch(buildingName)` at ~line 508 for named-house layouts; furniture is tiles (`TABLE`, `CHAIR`, `BED`, `BARREL`, `FIREPLACE`, `BRAZIER`, `BOOKSHELF`, `CRATE`, `RUG`).
- **Occupants**: `InteriorOccupantSystem.forBuilding(map, type, name)` (`src/systems/InteriorOccupantSystem.ts:190`) — rosters in `BUILDING_OCCUPANTS` (keyed by name) / `TYPE_OCCUPANTS` (keyed by type); anchors **derived by scanning furniture tiles**, so new layouts feed it automatically.
- **Audio**: `src/audio/AudioManager.ts` is Web Audio (`masterGain → sfxGain/musicGain`). Looping SFX use dedicated private start/stop methods with a fixed-volume `GainNode` (`startMachineryLoop` at L467 is the template). **No live per-sound volume control exists yet** — that is the one AudioManager extension this plan needs. The closest precedent for distance-driven audio is the binary spider-loop gate at `src/scenes/DungeonScene.ts:3278`.
- **Drinks today**: `BuildingInteriorScene.tryServeDrink` (~line 900) — innkeepers auto-serve a Speed Fizz for coins (`townPub.ts`). The club bar is a `ShopSystem` (`BAR_SHOP_CONFIG`, `src/systems/DesperadoClubSystem.ts`). Status effects live in `src/core/StatusEffect.ts` + `Player.tickStatusEffects()`; HUD pills in `src/ui/HUD.ts:485`.

---

## Part 2 — Building assignment map

| Sprite | Building (name / entry type) | What changes |
| --- | --- | --- |
| `barracks` | **"The Barracks"** — the safe room, entry type stays `restaurant` | Replaces the procedural "Safe Room" facade; interior remade as a guild bunkhouse (Phase 3). Mordecai lives here (DCC: his floor-3 guildhall). |
| `shop` | General Store (`store`) | Facade swap only; `ShopSystem` interior untouched. |
| `desperado_club` | The Desperado Club (`club`) | Facade swap only; club interior untouched. |
| `blacksmith` | The Rusty Anvil (`house`) | Facade swap + animated flame overlay + fire ambience. |
| `small_inn` | The Sleeping Cat Inn (`house`) | Facade swap; interior gets busier (Phase 4). |
| `tavern_1` | The Sunken Stump Pub (`house`) | Facade swap; becomes tavern #1 (Phase 4). |
| `tavern_2` | The Wanderer's Rest (`house`) → re-theme as a mead-hall tavern; suggest renaming to **"The Horned Flagon"** | Facade swap; becomes tavern #2 (Phase 4). If renaming, update its `BUILDING_OCCUPANTS` key and `generateInterior` name list. |
| `temple` | **New**: "Temple of the Sky" (`house`) | New placement + new interior + priest blessing (Phase 5). DCC nod: the city-elf cult venerates the skyfowl as angels. |
| `tattoo_parlor` | **New**: "Signet's Ink" (`house`) | New placement + new interior + tattooist (Phase 5). DCC nod: Tsarina Signet's living tattoos. |

**Name collision to resolve:** "Blackwood Barracks" (the murder-mystery cult hideout, `CultHideoutSystem`) already exists. With the safe room named "The Barracks" this is confusing. **Recommended:** rename the cult hideout to **"Blackwood Lodge"** — grep the exact string `Blackwood Barracks` and update every site consistently: the `placeSpriteBuilding` call in `OverworldGenerator.ts`, the `generateInterior` switch case, `BuildingInteriorScene`'s encounter gating, `CultHideoutSystem`, `murderQuestDialogs.ts`, and any quest-stage/notice/dialog text that names it. If that grep turns up risky quest coupling, the fallback is naming the safe room "Guild Barracks" and leaving Blackwood alone.

Buildings keeping their current `village_house_*` sprites: Shepherd's Cabin, Old Hilda's Cottage, Cartwright's Workshop, Miller's Farm, Herb & Remedy, Blackwood Lodge.

**Ambient sound assignment:**

| Sound | Where | How |
| --- | --- | --- |
| `ambient_fountain` | Overworld, 3×3 fountain centre `(cx+5, cy+5)` | Distance-attenuated loop |
| `ambient_fire_crackling` | Overworld at the Rusty Anvil forges; **and inside any interior**, emitted from `FIREPLACE`/`BRAZIER` tiles | Distance-attenuated loop |
| `ambient_town_square_crowd` | Overworld, square centre `(cx, cy)`, wide radius | Distance-attenuated loop |
| `ambient_bar_crowd` | Inside both taverns, the inn common room, and the club (layered under `CLUB_MUSIC_TRACKS`) | Constant interior loop |
| `ambient_magic_shop` | Inside Herb & Remedy (the apothecary is the town's "magic shop") | Constant interior loop |
| `ambient_pouring_a_drink` | One-shot whenever a drink is served (tavern serve + club bar purchase) | `audio.play()` |

---

## Part 3 — Phased implementation

### Phase 0 — Generalize sprite-building tech

The new sprites are 6–16 tiles wide; `placeSpriteBuilding` assumes 5×4. Build the general machinery first so Phases 1/3/5 are data.

- [x] **0.1** Parameterize `placeSpriteBuilding(spriteKey, x, y, name, type)` in `OverworldGenerator.ts`: derive the footprint from `getBlockedTileOffsetsByKey(spriteKey)` (`src/core/SpriteLoader.ts:242`) instead of the hardcoded 5×4; derive the **door tile** from the gap the `blockedRegions` leave in the base row. Rule: find the bottom-most blocked row, take the x-range *not* covered by any region, and use its centre tile. Worked example — `barracks`: base regions cover px x 1–128 and 200–321 at y 178–255, so the gap is px 128–200 → tiles dx 4–5 of row dy 7; door tile = anchor + (5, 7). Keep `type` a parameter (the barracks needs `restaurant`, new buildings `house`).
- [x] **0.2** Reserve the footprint tiles (mark grass/no-build under the sprite so weeds, props, and townsfolk spawns avoid it — the blocked offsets handle walkability; check `TownLifeSystem.isSpawnableTile` and `TownPropSystem` placement also exclude these tiles) and call the existing `connectToRoad(doorX, doorY + 1)` from the tile in front of the door.
- [x] **0.3** Animated sprite-building states: in the `SPRITE_BUILDING` render branch (`GameMap.ts:1607`), after drawing `idle`, check the def for a `flame` state and overlay it with a `performance.now()`-driven frame index (the same clock pattern the fountain/torch tiles use; ~8 fps, named constant). Generic ("any extra animated state"), not blacksmith-specific.
- [x] **0.4** Headless placement check: a scratch script (scratchpad, not committed) that builds `generateOverworld(280)` and asserts for every `buildingEntries` entry that the door tile and the tile south of it are walkable, no two sprite footprints overlap, and no main road is severed. Rerun it after every placement change in Phase 1/5.
- [ ] **DoD:** village houses still place and render identically (they can migrate to the derived-footprint path or keep their constants — either, as long as behavior is unchanged); typecheck/lint clean.

Skills: `add-level` (tiles/generator), `add-sprite` (renderer), `game-architecture`.

### Phase 1 — Exterior swap

Replace facades with the new art. Larger footprints mean placements shift — keep the town readable: tower north, safe room NE, store NW, club south, taverns and temple around the square.

- [x] **1.1** "The Barracks" (safe room): remove the procedural "Safe Room" `placeBuilding` call; `placeSpriteBuilding('barracks', …, 'The Barracks', 'restaurant')` in the same NE quadrant (near `cx+14, cy-16`, adjusted so the ~10×8 footprint clears the square and the E-W road). The `restaurant` type keeps `SafeRoomSystem`, snapshots, and the safe-room music/achievement wiring intact with zero scene changes.
- [x] **1.2** General Store → `shop` sprite; Desperado Club → `desperado_club` sprite (its ~16×14 footprint is much deeper than the old 16×6 facade — nudge it south so the door still opens onto the road stub, and rerun the road-bypass check).
- [x] **1.3** Swap the four house facades: Rusty Anvil → `blacksmith` (delete its non-enterable companion forge shed — the art now has forges), Sleeping Cat Inn → `small_inn`, Sunken Stump Pub → `tavern_1`, Wanderer's Rest → `tavern_2` (+ optional rename, see Part 2). Respace neighbors so the bigger footprints don't collide; keep every door reachable from a road.
- [x] **1.4** Place the two new buildings: temple on the square's west side (facing the plaza), tattoo parlor near the club (south "nightlife" district). Register both as `house` entries so name-keyed interiors/occupants work. Interiors are Phase 5 — a bare interior in the meantime is fine and shippable.
- [x] **1.5** Blackwood rename (decision in Part 2) if the grep confirms it's safe.
- [x] **1.6** Entry-menu polish: `BuildingSystem`'s icon-by-type map should show ⚔️ for "The Barracks" instead of 🍽 (name-keyed override; keep the type-keyed default).
- [ ] **DoD:** every building renders with its new art, Y-sorts correctly against players/townsfolk, has working collision (walk the perimeter), and is enterable at its door; the headless check passes; minimap/fog unaffected; typecheck/lint clean.

Skills: `add-level`. Risk to check early: the club's 437 px-tall sprite overhangs far above its anchor — confirm `getMapSpriteExtentsPx` culling keeps it visible when the anchor is off-screen.

### Phase 2 — Positional ambient audio

The one engine extension plus a small system; everything else is emitter data.

- [x] **2.1** `AudioManager` ambient-loop API (follow the `startMachineryLoop` pattern at `AudioManager.ts:467`, but keep the `GainNode` addressable): `startAmbientLoop(id: SoundId, volume: number)`, `setAmbientLoopVolume(id, volume)` (smooth with `linearRampToValueAtTime`, ~100 ms — a named constant), `stopAmbientLoop(id)`, `stopAllAmbientLoops()`. Track loops in a `Map<SoundId, { source, gain }>`; route through `sfxGain`; make `muteForBackground`/`dispose` stop them like the existing loops.
- [x] **2.2** `src/systems/AmbientSoundSystem.ts` (a `GameSystem`, modeled on `OverworldMusicSystem`'s read-player-position-each-update shape): constructed with `AudioManager` and a list of emitters `{ soundId, x, y, radiusTiles, maxVolume }` (tile coords). Each `update()`: for each sound id, gain = max over its emitters of `maxVolume * clamp01(1 - dist/radius)` (multiple fireplaces sharing one loop take the loudest, never stack). Start a loop lazily when its gain first exceeds ~0.01, `setAmbientLoopVolume` while audible, stop after it stays at 0 for ~2 s (hysteresis constants, named). `dispose()` stops everything — and wire `stopAllAmbientLoops()` into both scenes' `onExit` (note `DungeonScene.onExit`'s `musicPersistsAcrossExit` special case at L1522 only covers music — ambient loops must stop unconditionally on scene swap).
- [x] **2.3** Overworld emitters (wired in `DungeonScene` where `TownLifeSystem` is built, ~line 846): fountain (`ambient_fountain`, centre of the 3×3 at `cx+5, cy+5`, radius ~10 tiles), Rusty Anvil forges (`ambient_fire_crackling`, at the placed blacksmith's forge mouths, radius ~8), town square (`ambient_town_square_crowd`, at `(cx, cy)`, radius ~18, modest maxVolume so it's a bed, not a wall). Tune radii/volumes by ear; keep them named constants.
- [x] **2.4** Interior emitters (wired in `BuildingInteriorScene`): scan the generated interior grid for `FIREPLACE`/`BRAZIER` tiles and emit `ambient_fire_crackling` from each (radius ~7) — this makes *every* hearth in town crackle, including the Rusty Anvil's interior forges, for free. Add per-building constant loops: `ambient_bar_crowd` in the two taverns, the inn, and the club (start at a fixed low volume under the club playlist); `ambient_magic_shop` in Herb & Remedy.
- [x] **2.5** Respect the pause menu and sleep overlay: either pause ambient updates (loops ramp to 0) while paused, or leave them running — pick one and match what music does today.
- [ ] **DoD:** walking toward the fountain/forge audibly swells and fades smoothly (no zipper noise, no pops on start/stop); leaving a building or level kills all loops; mobile gesture-unlock still works (loops must not try to start before `AudioContext` is running — gate on `isRunning`/`onRunning` like existing code); typecheck/lint clean.

Skills: `add-sound`, `add-system`.

### Phase 3 — The Barracks safe-room interior

Make the inside read as a crawler guild bunkhouse, not a restaurant.

- [x] **3.1** Rework the `restaurant` branch of `generateInterior`: keep `SAFE_ROOM_FLOOR` + the `safeRooms`/`safeRoomBounds`/`safeRoomCentre` registration (that contract is what `SafeRoomSystem` and level-2 both consume — **do not break the dungeon safe rooms**; if divergence is needed, branch on `buildingName === 'The Barracks'` inside the restaurant case). Layout: rows of `BED` bunks along the east/west walls, a `FIREPLACE` on the north wall, a long mess table (`TABLE`+`CHAIR` row), `CRATE`/`BARREL` supply stacks, a `RUG` at the entry. Verify `SafeRoomSystem`'s bed/Mordecai anchors land sensibly in the new layout (it derives them from the safe-room bounds/centre — adjust its anchor picks if they end up inside furniture).
- [x] **3.2** Rename user-facing "Safe Room" strings for this building to "The Barracks" (building entry name is 1.1; grep for other display references — minimap labels, notices, dialogs).
- [x] **3.3** Occupants: add a `BUILDING_OCCUPANTS` roster keyed `'The Barracks'` (a guard at `tend_counter` by the door, an off-duty guard at the mess table, a `commoner` refugee) so Mordecai has company. `TYPE_OCCUPANTS` for `restaurant` currently adds a commoner+noble — make sure the name-keyed roster *replaces* rather than stacks oddly.
- [x] **3.4** Sleep flow regression pass: enter → prompt → sleep → full heal → timer deduction → exit, on desktop and touch.
- [ ] **DoD:** the safe room looks like a barracks, sleep/Mordecai/achievement wiring all still work, level-2 dungeon safe rooms unchanged; typecheck/lint clean.

Skills: `add-level` (interior), `add-person` (roster).

### Phase 4 — Busy taverns + drinking

The centerpiece. Both taverns (and the inn, lightly) become crowded bars where the player can drink.

- [x] **4.1** Tavern interior layouts (`generateInterior` name cases for The Sunken Stump Pub and The Wanderer's Rest/Horned Flagon): a proper **bar counter** — an L of blocked counter tiles along the north wall with a walkable barkeep alley behind it (reuse `TABLE` tiles as counter, or add a `BAR_COUNTER` tile type via `add-level` if `TABLE` reads wrong), `CHAIR` stools along its front, 4–5 `TABLE`+`CHAIR` clusters, `BARREL`/`BARREL_SIDE` stacks, a `FIREPLACE`, a `RUG`. The two taverns should differ (Sunken Stump: cramped, dark, more barrels; mead hall: long central feast table, antler-flavored symmetry).
- [x] **4.2** Crowds: expand `BUILDING_OCCUPANTS` for both taverns to ~7–9 occupants — barkeep (`innkeeper` @ `tend_counter`), 3–4 `drunk`/`laborer`/`commoner` patrons at tables (`sit_at_table`), a `noble` slumming it, one roamer (`wander`). Watch `findStandTile`'s radius-2 search — dense furniture needs enough walkable stand tiles or occupants silently drop; verify every roster member actually spawns (the Phase-2 headless technique from living-town works here).
- [x] **4.3** Drunk status: `makeDrunk()` in `src/core/StatusEffect.ts` (~30 s / 1800 ticks). Effects, all via existing hooks: a gentle sinusoidal **camera sway** while active (small px amplitude, named constants — apply where the camera offset is computed, gated on `active.hasStatus('drunk')`), a mild movement wobble (small perpendicular drift in the movement step), and a +liquid-courage perk so it's not purely a debuff (e.g. small damage bonus or slow HP regen while drunk — pick one, keep it modest). HUD pill (`drawStatusIcon`, `src/ui/HUD.ts:485`): label `DRNK`, amber. Optional world-space visual in `Player.renderStatusEffects()` (drifting bubbles). `applyStatus` refreshes duration on re-drink — that's the intended "keep drinking to stay drunk" loop.
- [x] **4.4** Serving drinks: extend the innkeeper interaction. Replace the silent auto-Speed-Fizz in `tryServeDrink` (`BuildingInteriorScene.ts:900`) with a small **drink menu** (pattern-match `MarketStallPanel` — Buy/Close, tap-outside-to-close, mobile-correct): "Mug of Ale" (cheap → `makeDrunk`), "Boozy Milk" (mid → drunk + small heal; the Dungeon Crawler Carl nod), "Speed Fizz" (keeps today's offering). On purchase: deduct coins, play `ambient_pouring_a_drink` as a one-shot, then `purchase_success`, apply the effect immediately (served, not inventoried). Data table in `src/systems/townPub.ts`. Also fire the pour one-shot from the club bar's `tryBuy` for its drink items.
- [x] **4.5** Tavern audio: `ambient_bar_crowd` (Phase 2.4) + hearth crackle emitters should make both rooms audibly busy the moment you walk in.
- [x] **4.6** Interaction-priority check: the drink menu must slot into `BuildingInteriorScene`'s existing suppression/Esc-cascade/touch-guard chains exactly like `MarketStallPanel` does in `DungeonScene` (the living-town notes at Phase 4.1 list every gate — `isSuppressed`, Esc cascade, `handleClick`, `handleTouchStart` blocking-dialog guard).
- [ ] **DoD:** walking into a tavern shows a crowded, furnished bar with audible murmur; buying a drink pours, costs coins, and visibly makes the player tipsy (sway + pill); repeat drinking refreshes; all of it works on touch; encounter interiors and quest flows untouched; typecheck/lint clean.

Skills: `add-ui` (drink menu), `add-item`/`add-person`/`add-level` as touched, `add-sound`.

### Phase 5 — Temple and tattoo parlor interiors

New places worth entering. Keep both light — flavor first, one small mechanic each.

- [x] **5.1** Temple interior (`generateInterior` case "Temple of the Sky"): stone floor, `CHAIR` pew rows facing a north altar (`TABLE` + flanking `BRAZIER`s), `RUG` aisle, `BOOKSHELF` scripture nook. Occupants: `priest` @ counter/altar, 1–2 `commoner` worshippers at pews. Interaction: talk to the priest → **Blessing** — donate a few coins for a full heal of both party members + a short grace line (reuse the drink-menu panel pattern or a simple confirm; cooldown so it's not spammable). Quiet inside: brazier crackle emitters only, no crowd loop.
- [x] **5.2** Tattoo parlor interior ("Signet's Ink"): `CHAIR` + `TABLE` work station, `BOOKSHELF` flash-art wall, `CRATE`/`BARREL` supplies, `BRAZIER` for the needle fire. Occupants: a tattooist (`merchant` role bias; a dedicated `tattooist` role in `ROLE_BIASES` is a nice-to-have) + one waiting `commoner`. Interaction: buy a tattoo — **one per player, permanent, expensive** (e.g. 100 coins, +1 to a chosen stat via the existing statBonus/level-up plumbing — mirror however `stat_boost_potion` grants stats). Gate re-purchase with a flag on the player snapshot so it survives building round-trips. Dialog references Signet's moving tattoos for the DCC flavor.
- [x] **5.3** `townDialog.ts`: add ambient lines for `priest` (already a role) and the tattooist, plus a couple of square-crowd lines that mention the new landmarks ("Have you seen the new temple?").
- [ ] **DoD:** both buildings are enterable, furnished, occupied, and offer one working interaction each, desktop + touch; typecheck/lint clean.

Skills: `add-level`, `add-person`, `add-ui`, `add-quest` only if the tattoo/blessing warrants event wiring.

### Phase 6 — Polish & verification sweep

- [x] **6.1** Full-town walkthrough (use `run` skill / dev server): circle every building exterior for collision gaps, enter/exit every building, verify Y-sorting when townsfolk walk behind/in front of the new sprites, confirm the blacksmith flames animate, and do an audio walk: square → fountain → blacksmith → tavern → barracks.
- [ ] **6.2** Mobile pass: door prompts, drink menu, blessing/tattoo panels, and exit menus all tap-correct.
- [x] **6.3** Perf sanity: the new sprites are large images in the decoration pass — confirm no frame drops panning across town (they're single draws each; expected fine, but check).
- [x] **6.4** Update `docs/living-town.md`: mark 2.5/5.2 superseded-by-this-doc; note the building renames in its notes so the two docs don't contradict.
- [x] **6.5** `npm run typecheck && npm run lint && npm run format` — final gates.

---

## Part 4 — Progress tracker

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Generalize sprite-building tech | ✅ |
| 1 | Exterior swap (all 9 sprites placed) | ✅ |
| 2 | Positional ambient audio | ✅ |
| 3 | Barracks safe-room interior | ✅ |
| 4 | Busy taverns + drinking | ✅ |
| 5 | Temple & tattoo parlor | ✅ |
| 6 | Polish & verification | ◑ 6.1/6.3–6.5 done; 6.2 (touch device) unverified |

---

## Part 4b — Where the implementation departed from this plan

- **Sprite collision is the whole footprint, not just `blockedRegions`.** The manifest's regions only cover each building's ground band, but the art is opaque across the entire frame, so anything left walkable under it became an invisible pocket the player and townsfolk could vanish into (688 tiles across the town). `SpriteLoader.getBlockedTileOffsetsByKey` now returns *footprint minus doorway*; the regions are used only to derive where the doorway is.
- **Doorways sit on the sprite's visual foot, not its bottom blocked row.** Decorations Y-sort on `tileY * TILE_SIZE + frameHeight` while players sort on `y + TILE_SIZE`, so a door tile above the art's foot drew the player *behind* the facade — the temple occluded the player completely. `computeDoorway` pushes the door row down to `ceil(frameHeight / tileScale) - 1`.
- **Minimap.** Only a sprite building's anchor tile carries `SPRITE_BUILDING`, so the store/barracks/club had shrunk to one pixel each. `GameMap.isSpriteBuildingTile` exposes the covered footprint and `MiniMapSystem` paints it as masonry.
- **`connectToRoad` was replaced by `connectDoorToRoad`.** The old helper drew a full vertical column through the building it was serving. The new one leaves the doorway southward until it clears the art, then either continues to the E-W road or turns along the frontage to reach the N-S road.
- **One panel for all three services.** `ServiceMenuPanel` (generic priced-service modal) backs the drink menu, the temple blessing and the tattoo parlor rather than each getting a bespoke panel; the per-service data lives in `townPub.ts` / `townTemple.ts` / `townTattooParlor.ts`.
- **The blessing has no cooldown.** A scene-local timer would have reset every time the player stepped out of the temple and back in. Instead the blessing is simply unavailable while the whole party is at full HP, which is a gate that can't be walked around.
- **`PlayerSnapshot` now carries status effects.** Without it the new Drunk status (and Speed Fizz, and poison) evaporated the moment the player walked out of the tavern door, since every scene transition rebuilds the players from a snapshot. Jugg Juice's max-HP loan is carried alongside so it is still repaid on expiry.
- **The Rusty Anvil's forge shed was deleted** (the new art has its own forges) and the inn gained a reception bar so its innkeeper has a counter to work — the occupant system stations `tend_counter` roles at interior wall runs.

---

### Phase 6 verification notes

Walked the town in the browser at `?level=level3`: every new facade renders and Y-sorts, footprint collision holds (you route around a building to reach its south-facing door), the entry menu shows the right name and per-building icon, and the Temple and Sunken Stump interiors are furnished, occupied and fully connected. Confirmed the drink menu and the blessing panel open from their NPCs, with disabled rows reading `Coins: 0` and `Unhurt` respectively.

Two checks were done outside the browser because they're hard to observe by hand:

- **Blacksmith flames.** An offline read of `blacksmith.png` confirms the `colsPerRow` wrapping resolves to the authored frames — `idle` is the full 200×122 building, and all five `flame` frames are small non-empty sprites clustered over the forge mouths at frame-local x≈55–95, y≈63–98. The renderer draws `idle` then the current flame frame at the same anchor.
- **Town geometry.** `check-town` (the Phase 0.4 headless script) asserts, over 8 generated maps, that every door tile and the tile south of it is walkable and reachable from the town square, no two sprite footprints overlap, no in-town main road is severed, no footprint leaves a walkable pocket under the art, and every doorway row sorts in front of its own facade.

**6.2 (touch pass) is the one item not verified** — the service menu, entry menus and exit menus are all built on the shared `Button` hit-rects with platform-aware hints, and the panel is wired into `handleTouchStart`'s modal routing and close-then-reopen guard, but none of it has been exercised on a real touch device.

---

## Part 5 — Sequencing, dependencies & risks

**Order:** 0 → 1 are strictly sequential. 2 (audio) is independent of 1 and can run in parallel with it. 3/4/5 depend on 1 (and 4/5 lightly on 2 for their ambience steps); 3, 4, 5 are independent of each other and parallelizable across agents. 6 last.

**Risks to prototype early:**

1. **Placement collisions (Phase 1)** — the new footprints are 4–10× larger than the village houses. The road-bypass routing (`OverworldGenerator` §9) and building spacing were tuned for the old sizes; expect to iterate. The Phase 0.4 headless check is the safety net — keep it green.
2. **Door derivation** — a wrong door tile makes a building unenterable. Assert every entry's door in the headless check, and hand-verify the club (its base gap is only ~2 tiles of a 16-tile-wide base).
3. **Quest coupling** — Blackwood Barracks (cult hideout), the Big Top, and the tower have live encounters. Never touch their entry gating; the occupant system's `forBuilding` null-gates already protect them — keep new rosters out of those names.
4. **Safe-room contract** — `safeRooms`/`safeRoomBounds`/`safeRoomCentre` are shared with the level-1/2 dungeon safe rooms. Phase 3 must only change the *overworld restaurant layout*, not the contract.
5. **Web Audio lifecycle** — loops started before the mobile gesture-unlock, or leaked across scene swaps, are the classic bugs. Gate on `isRunning`, stop everything in `onExit`/`dispose`, and test backgrounding the tab.
6. **Sonnet reminder:** CLAUDE.md rules apply throughout — no `as` casts, no `!`, no `any`, no magic numbers (every radius/volume/frame-rate above becomes a named constant), and run all three gates after every step.

## Part 6 — Skills to use

`add-level` (generator, tiles, interiors), `add-sprite` (animated overlay state), `add-sound` (ambient API + wiring), `add-system` (AmbientSoundSystem), `add-ui` (drink menu, blessing/tattoo panels), `add-person` (rosters, roles), `game-architecture` for orientation, `dev-workflow`/`run` for verification. Sub-agents: Phases 3, 4, 5 parallelize cleanly once 1 lands.
