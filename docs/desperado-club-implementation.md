# The Desperado Club — Implementation Steps

Companion to [desperado-club-plan.md](desperado-club-plan.md). Each phase is independently shippable; within a phase, steps are ordered by dependency. File references reflect the codebase at time of writing — **verify line numbers before editing**, as they drift.

**Relevant project skills** (invoke them when executing the matching step): `add-system`, `add-ui`, `add-creature`, `add-item`, `add-sprite`, `add-sound`, `add-level`, `game-architecture`, `dev-workflow`.

**Validation gates — run after every step, all must pass:**
```
npm run typecheck   # exit 0, no errors
npm run lint        # exit 0, no errors
npm run format      # apply formatting
```
Honor `CLAUDE.md`: **no `as` casts, no `!` non-null assertions, no `any`, no magic numbers** (extract named constants), comments explain *why* not *what*, and use the `src/ui/` helpers (`drawText`/`drawBox`/`drawButton`) instead of raw `ctx` for all UI chrome.

---

## Orientation: the seams you will touch

Before Phase 1, read these so the edits below make sense:

- **`BuildingEntry.type` is a string union declared in three places that must stay in sync:**
  1. `src/systems/BuildingSystem.ts` — `export type BuildingEntry = { …; type: 'house' | 'tower' | 'restaurant' | 'store' }` (~line 7–11).
  2. `src/map/OverworldGenerator.ts` — `export interface BuildingEntry` (~line 29) **and** the `type` parameter of the local `placeBuilding` closure (~line 245).
  3. `src/map/GameMap.ts` — the inline building-entries field type (~line 166) **and** the `buildingType` parameter of `generateInterior(...)` (~line 333).
  Every one of these gets `| 'club'` added.
- **`BuildingInteriorScene`** (`src/scenes/BuildingInteriorScene.ts`) constructs helper systems by `entry.type` in its constructor (`this.safeRoom = entry.type === 'restaurant' ? … : null`, `this.shop = entry.type === 'store' ? … : null`). The club attaches the same way: `this.club = entry.type === 'club' ? new DesperadoClubSystem(...) : null`, then it gets ticked in `update()`, drawn in `render()`, and routed in `handleClick()` / the space-interact block — mirror the `this.shop?.…` call sites exactly.
- **`GameMap.generateInterior`** (`src/map/GameMap.ts` ~line 332) picks interior width/height/floor-tile by type and then carves furniture. The club adds an `isClub` branch with `CLUB_INTERIOR_W/H` and a room-carving block.
- **Progress objects** (`src/core/CircusQuestProgress.ts`, `MurderQuestProgress.ts`, `DoomsdayProgress.ts`) are plain factory-made mutable objects threaded through `DungeonScene` → `BuildingInteriorScene` constructors and back, and persisted by the save hook. `ClubMembership` and `MercenaryRoster` follow this exact pattern.
- **`MongoSystem`** (`src/systems/MongoSystem.ts`) is the reference lifecycle for a friendly `Mob`: spawn near a player, follow, auto-attack, recall at low HP, `dismiss()` on transition. The `Mercenary` ally copies this.

---

## Phase 1 — Club Shell

Goal: the Desperado Club exists as an enterable, safe, multi-room interior with dance-floor ambiance, music, the Sledge's greeting, and a persisted membership flag.

### 1.1 Add the `club` building type

Add `| 'club'` to the `BuildingEntry.type` union in **all three** locations listed under Orientation. Then update the two consumers that `switch`/branch on the union so TypeScript's exhaustiveness stays honest:

- `src/systems/BuildingSystem.ts` `renderMenu()` icon selector (~lines 198–205): add a club icon (use `'🔪'` — the neon knife, or `'🎭'`).
- `src/map/GameMap.ts` `generateInterior()` (~line 337): add `const isClub = buildingType === 'club';`.

**DoD:** project typechecks with the new union member referenced but not yet used anywhere structurally.

### 1.2 Place the club in town + neon-knife marker

In `src/map/OverworldGenerator.ts`, alongside the restaurant/store placements (~lines 277–302), place the club with the existing `placeBuilding(...)` helper:

- Position it prominently — south of the town square, mirroring how the restaurant/store sit east/west (pick a footprint like `20×6`). Register it as `placeBuilding(clubX, clubY, clubW, clubH, 'club', 'The Desperado Club', <roofTile>)` and draw a road stub from its door to the E-W or N-S main road exactly as the restaurant does (~lines 284–289).
- Extract every literal (offsets, width, height) into named constants next to the existing `REST_X_OFFSET` / `STORE_X_OFFSET` constants — **no magic numbers**.
- **Neon-knife marker:** simplest faithful first pass — give the club roof a distinct tile color/type so it stands out. A nicer version (optional, or defer to Phase 5) is a `SPRITE_BUILDING` via `placeSpriteBuilding` (~lines 304–322) with an art-deco tower sprite and an animated neon-knife overlay. For Phase 1, the distinct roof + the door-hint label ("The Desperado Club") from `BuildingSystem.renderDoorHints` is enough.

**DoD:** the club building is visible in town and shows an "Enter this building?" prompt on its door (it will enter an empty room until 1.3).

### 1.3 Carve the club interior layout

In `src/map/GameMap.ts`:

1. Add interior-size constants near `BIGTOP_INTERIOR_W`/`TOWER_INTERIOR_W` etc.: `CLUB_INTERIOR_W = 24`, `CLUB_INTERIOR_H = 18` (tune later).
2. Add a `CLUB_FLOOR` tile (or reuse an existing dark floor) and a `DANCE_FLOOR` animated tile type (see 1.5). Register new tile ids in `src/map/tileTypes.ts` with renderers in `src/map/tiles/` per the **`add-level`** skill.
3. In `generateInterior`, extend the `w`/`h`/`floorType` ternaries to handle `isClub` (`CLUB_INTERIOR_W/H`, `CLUB_FLOOR`).
4. Add an `if (isClub) { … }` carving block (model it on the `isRestaurant` block, ~lines 410–461). Carve interior **rooms** by stamping short `WALL_TILE` runs to divide the grid, leaving 2-tile doorways between:
   - **Vestibule** near the entrance/exit tile (the Sledge stands here).
   - **Dance floor** in the center: fill a rectangular region with `DANCE_FLOOR` tiles.
   - **Bar** (counter = a `WALL_TILE` run, like the store/restaurant counter), **Casino**, **Market**, **Mercenaries Guild desk**, **VIP Lounge** — each a small room off the dance floor.
   - Extract every row/col literal into `clubXxx` named constants (follow the `restaurantXxx` / `barracksXxx` naming already in this function).
   - Ensure the entrance/exit tile handling matches other interiors (the function already sets `_interiorExitTiles`; keep the club's single south exit consistent with how `restaurant`/`store` get theirs).

**DoD:** entering the club drops you into a walled multi-room space with a visible dance floor; you can walk every room and exit via the door prompt.

### 1.4 `ClubMembership` progress object + threading

1. New `src/core/ClubMembership.ts` mirroring `src/core/DoomsdayProgress.ts`:
   ```ts
   export interface ClubMembership {
     hasDesperadoPass: boolean;
   }
   export function createClubMembership(): ClubMembership {
     return { hasDesperadoPass: false };
   }
   ```
2. Thread it through the scene boundary exactly like `doomsdayQuestProgress`:
   - Add a `clubMembership` field + constructor option to `DungeonScene` (grep for every place `doomsdayQuestProgress` is declared, defaulted, passed to `BuildingInteriorScene`, and passed back into the re-created `DungeonScene` on interior exit — ~`DungeonScene.ts` lines 760–773 and the options interface — and add `clubMembership` beside each).
   - Add a `clubMembership` constructor param to `BuildingInteriorScene` (beside `murderQuestProgress` ~line 166).
3. Persist it: find where the save hook serializes the other progress objects (grep `saveProgress` / the save payload) and include `hasDesperadoPass`.

**DoD:** membership state survives entering/leaving the club and a reload.

### 1.5 `DesperadoClubSystem` (the host system)

Use the **`add-system`** skill. New `src/systems/DesperadoClubSystem.ts` implementing `GameSystem`, constructed only for `entry.type === 'club'` — the analog of `SafeRoomSystem`/`ShopSystem`.

Responsibilities for Phase 1 (later phases extend it):
- Hold the interior width/height and the fixed tile positions of each **station** (Sledge, DJ, bartender, casino dealer, market vendor, Rosemarie, VIP host). Represent stations as a typed array:
  ```ts
  interface ClubStation {
    id: 'sledge' | 'bar' | 'casino' | 'market' | 'mercenary' | 'vip';
    tile: { x: number; y: number };
    label: string;          // interaction prompt text
  }
  ```
- `update()` — advance any station-NPC wander/idle animation timers and the dance-floor light phase.
- `renderObjects(ctx, camX, camY, active)` — draw each station NPC sprite, the DJ, cosmetic dancers, and (via `drawInteractionPrompt`) the "Talk"/"Shop"/etc. prompt when the active player is within range of a station. Reuse `ShopSystem.isNearShopkeeper`'s distance approach (`SHOPKEEPER_INTERACT_RANGE`) as a shared `isNear(station, player)` helper.
- Dance-floor lights: in the `DANCE_FLOOR` tile renderer (1.3), cycle color from a `Date.now()`-derived phase so the floor pulses. Keep the palette + period as named constants.
- **The Sledge greeting / membership gate:** track a `greetingOpen` boolean + the dialog lines. On first entry (when `!membership.hasDesperadoPass`), auto-open the greeting; on dismiss, set `membership.hasDesperadoPass = true`. Render the greeting with `drawModal`/`drawText`. On later visits the Sledge just offers a one-line flavor prompt.
- Provide `handleInteract(player): void` (called from the scene's space handler) that checks proximity to each station and opens the right sub-UI. In Phase 1 only the Sledge does anything; the others show a "Coming soon"/flavor line until their phase lands.

Wire it into `BuildingInteriorScene` mirroring the `shop` wiring:
- Field `private readonly club: DesperadoClubSystem | null`; construct in the constructor (`entry.type === 'club' ? new DesperadoClubSystem(this.map, this.mapW, clubMembership, this.audio) : null`).
- In `update()`: early-return guard when a club modal is open (like `if (this.shop?.shopOpen) return;`), tick `this.club?.update(...)`, and in the space-key block call `this.club?.handleInteract(this.active())`.
- In `render()`: call `this.club?.renderObjects(...)` and `this.club?.renderUI(...)` in the same spots the shop's render calls sit (~lines 727–729, 794–797).
- In `handleClick()`: route clicks to any open club modal before the exit-menu handling (like the `this.shop?.shopOpen` branch ~line 638).
- In the `escHandler` (`onEnter`, ~lines 390–407): add a branch to close an open club modal on `Escape`, before `this.pauseMenu.toggle()`.
- **Touch parity (mobile):** replicate the space-equivalent tap handling that `handleTouchEnd` does for the shop (~lines 1080–1084) for club station interaction, and route taps to open club modals in `handleTouchStart`'s modal-routing block (~lines 934–943).

### 1.6 Club music

Use the **`add-sound`** skill. Add a `desperado_club` track to the sound manifest; start it when the club interior is entered and restore the overworld music on exit. Follow how `OverworldMusicSystem` / the interior `audio` handle already manage music across the building transition (grep `musicPersistsAcrossExit` in `DungeonScene`).

**Phase 1 DoD:** you can enter the Desperado Club from town; it's a lively, safe, multi-room space with pulsing dance-floor lights and club music; the Sledge greets you and grants membership on first visit; membership persists; typecheck/lint/format clean. No combat occurs inside.

---

## Phase 2 — Bar & Market (Vendors)

Goal: two working club-exclusive shops.

### 2.1 Generalize `ShopSystem` (backward-compatible)

`src/systems/ShopSystem.ts` currently hardcodes `SHOP_ITEMS`, the title `'General Store'`, and a single wandering shopkeeper. Make it **config-driven without changing existing behavior**:

- Add an optional constructor config: `constructor(interiorWidth: number, config?: ShopConfig)` where
  ```ts
  interface ShopConfig {
    title: string;
    items: ReadonlyArray<{ id: ItemId; label: string; price: number; desc: string }>;
    shopkeeperTileY?: number;
    shopkeeperSprite?: 'default' | 'bartender' | 'merchant';
  }
  ```
- Default (`config` omitted) reproduces today's General Store exactly — the existing `new ShopSystem(this.mapW)` call in `BuildingInteriorScene` must be unchanged in behavior.
- Replace the module-level `SHOP_ITEMS` reads and the `'General Store'` title string with `this.config.items` / `this.config.title`.
- Keep `drawShopkeeper`; if `shopkeeperSprite` is set, branch to an alternate sprite (add via **`add-sprite`** if you want distinct bartender/merchant art — otherwise reuse `drawShopkeeper` for Phase 2 and defer art).

**DoD:** General Store still works identically; `ShopSystem` can be instantiated with a custom title + item list.

### 2.2 Club-exclusive items

Use **`add-item`** for any new consumables/gear. Define two item lists:
- **Bar (drinks):** temporary-buff consumables (e.g. a drink granting a short speed or damage buff, a "liquid courage" temp-HP drink). Model buff application on the existing status/potion mechanics (grep how `health_potion` / status effects are applied).
- **Market (gear):** 2–4 club-exclusive items priced above village-store gear.
Keep all prices as named constants (as `ShopSystem` already does with `HEALTH_POTION_PRICE` etc.).

### 2.3 Wire the two vendors into the club

In `DesperadoClubSystem`, the `bar` and `market` stations each own a `ShopSystem` instance built with the respective config, positioned at that station's room. `handleInteract` opens the corresponding shop panel; the club system delegates `update`/`renderShopPanel`/`handleClick` to whichever shop is open (the interior scene already knows how to drive one `ShopSystem` — have the club expose the currently-open shop, or forward the calls).

**Phase 2 DoD:** walking to the bar opens a drinks shop; the market opens a gear shop; purchases spend coins and grant items; the village General Store is unaffected.

---

## Phase 3 — Casino

Goal: a simple coin-wager minigame plus the free-security perk hook.

### 3.1 `ClubCasinoSystem`

Use **`add-system`** (or fold into `DesperadoClubSystem` if small). One minigame — **high-low**:
- Player sets a wager (buttons: 10 / 50 / 100 coins, clamped to `player.coins`).
- A "card" value 1–13 is shown; player picks **Higher** or **Lower**; a second value is drawn; win pays 1:1 (ties lose or push — pick one and keep it a named constant).
- Deduct/award via `player.coins`. All payouts/wager tiers are named constants.
- Track `coinsWageredThisVisit` (accumulates each wager). Reset on club exit.
- Build the panel with `drawModal`/`drawButton`/`drawText` (**`add-ui`**).

### 3.2 Free-security perk hook

Expose `coinsWageredThisVisit` from the club system so the VIP Lounge (Phase 5) can offer free bodyguard hire when it exceeds the bodyguard price — the canon "spend enough at the tables" rule.

**Phase 3 DoD:** the casino dealer opens a working high-low game that moves coins; big spenders accumulate wager credit toward the free-security perk.

---

## Phase 4 — Mercenaries Guild ("Meat Shields")

Goal: hire a mercenary at the club who follows you into the overworld and fights. **Highest risk — prototype the ally lifecycle first.**

### 4.1 `MercenaryRoster` persisted state

New `src/core/MercenaryRoster.ts` (pattern: `ClubMembership` from 1.4):
```ts
export interface HiredMercenary {
  id: string;        // template id, e.g. 'bruiser'
  name: string;
}
export interface MercenaryRoster {
  active: HiredMercenary | null;   // one at a time for the first pass
}
export function createMercenaryRoster(): MercenaryRoster { return { active: null }; }
```
Thread + persist it through `DungeonScene` ↔ `BuildingInteriorScene` exactly like `ClubMembership` (1.4).

### 4.2 `Mercenary` creature (Mongo-pattern ally)

Use **`add-creature`**. New `src/creatures/Mercenary.ts` — a `Mob` subclass that is **friendly**: follows a player and auto-attacks nearby *hostile* mobs, never targets the players. Copy the targeting/follow/attack structure from `src/creatures/Mongo.ts` (its AI is driven by `allMobs` set each frame). Give it stats derived from the template (`bruiser` = tanky melee, `archer` = ranged, etc.). Add sprite art via **`add-sprite`** (a tuxedoed/merc look) or reuse an existing humanoid sprite for the first pass.

### 4.3 Overworld ally system

New `src/systems/MercenarySystem.ts` — the overworld manager, modeled on `MongoSystem`:
- On overworld entry, if `roster.active !== null`, spawn the `Mercenary` near the player, insert into `mobs` + `mobGrid`, follow/attack each frame.
- `dismiss(mobs, mobGrid)` on interior transitions (call it wherever `mongoSystem.dismiss(...)` is called — grep in `DungeonScene`, ~line 735 in the building-enter callback).
- Re-spawn on return to the overworld (the roster survives; the mob is recreated).
- On mercenary death: despawn and clear `roster.active` (mercs don't come back — a coin sink with stakes), or set a cooldown — pick one and document it. Keep it distinct from Mongo's auto-recall unless you want mercs to persist.
- Wire into `DungeonScene`'s system update/render/dismiss loops beside `mongoSystem` (grep every `mongoSystem` call site and add the parallel `mercenarySystem` call).

### 4.4 `MercenaryGuildSystem` (the hire panel)

The Rosemarie station in the club. A panel (via **`add-ui`**) listing 2–4 mercenary templates (name, class blurb, price, one-line stats). "Hire" deducts coins and sets `roster.active` (block/replace if one is already active — show "dismiss current merc first" or offer to replace). Extract prices/stats into named constants or a template table.

**Phase 4 DoD:** hire a mercenary at Rosemarie's desk → exit to town → the mercenary walks with you and kills ruins mobs; it's dismissed when you enter a building and returns when you leave; death clears the roster; coins are spent correctly.

---

## Phase 5 — VIP Lounge & Polish

- **VIP Lounge:** a paid back room. Interacting offers: **full heal** (fixed coin cost), a **short buff**, and **bodyguard hire** (the Sledge + Bomo as cosmetic in-club escorts — 300/crawler or 500/pair, **free** if `coinsWageredThisVisit` exceeds the price, per §3.4). Bodyguards are pure ambiance: two Cretin sprites that follow you around the club interior; no combat (the club is safe). Prices as named constants.
- **Achievements:** via `AchievementManager` — first Desperado membership, first mercenary hired, a casino jackpot, hiring the bodyguards. (Grep how existing achievements like `doomsday_contained` are registered/unlocked.)
- **Dev-URL jump:** add a query-param shortcut to teleport straight into the club interior for testing, matching the existing circus-quest dev URLs (see the `circus-quest-dev-urls` memory and how `?level`/`?quest`/`?spawn` params are parsed). Document the new param in that memory / the README.
- **AI banter:** route the Sledge / Rosemarie / bartender lines through `aiAdapter` (as `SafeRoomSystem` does with `chatWithMordecai`) with scripted fallbacks, so NPCs riff on recent events.
- **Neon-knife sprite building:** upgrade the Phase 1 roof marker to a proper art-deco sprite building with an animated spinning neon knife (`add-sprite`).
- **Optional — GumGum relocation:** move the murder-mystery hook into the club (book-accurate) **without regressing the working questline** — make it a clearly reversible, isolated change, gated so the pub fallback still functions. Test the full murder questline afterward.

**Phase 5 DoD:** the club offers a paid VIP heal/buff and bodyguard escort; achievements fire; a dev URL jumps straight in; NPCs have dynamic banter; the neon knife spins over the club in town.

---

## Global "Definition of Done"

- Every phase leaves `npm run typecheck`, `npm run lint` clean and `npm run format` applied.
- The club is a **safe zone** — no hostile combat ever runs inside `BuildingInteriorScene` for `entry.type === 'club'`.
- Membership, the mercenary roster, and any coin spends persist correctly across the overworld↔club scene swaps and a reload.
- No regressions to the General Store, the safe room, the tower, or the three existing third-floor questlines.
- Verify end-to-end with the **`verify`** / **`dev-workflow`** skills: enter club → membership → buy a drink → gamble → hire a merc → exit → merc fights in the ruins → re-enter → VIP heal.
</content>
