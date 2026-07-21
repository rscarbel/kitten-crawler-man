# Desperado Club — Implementation Progress

Living status log for the multi-phase Desperado Club feature. See
[desperado-club-plan.md](desperado-club-plan.md) (design) and
[desperado-club-implementation.md](desperado-club-implementation.md) (step-by-step).

## Status: Phases 1–4 COMPLETE ✅ · Phase 5 not started

---

## Phase 1 — Club Shell (done)

You can walk into the Desperado Club from town: a safe, multi-room interior with
pulsing dance-floor lights, club music, cosmetic dancers + a skeleton DJ, and the
Sledge who greets you and grants free membership on the first visit. Membership
persists across the overworld↔club scene swaps.

### Files added
- `src/core/clubLayout.ts` — single source of truth for the interior geometry
  (dimensions, dance-floor rect, divider walls, station tiles, DJ/dancer tiles).
  **Both** `GameMap.generateInterior` and `DesperadoClubSystem` import from here.
- `src/core/ClubMembership.ts` — `{ hasDesperadoPass }` progress object + factory.
- `src/systems/DesperadoClubSystem.ts` — host system (Sledge greeting/membership
  gate, station proximity prompts, dance-floor light overlay, NPC rendering).
- `src/sprites/clubNpcSprite.ts` — primitive canvas figures (Sledge/Cretin,
  skeleton DJ, dancers, station staff). Placeholder art; see Phase 5.

### Files changed (the `'club'` building type threads through here)
- `src/systems/BuildingSystem.ts` — `BuildingEntry.type` union + 🔪 menu icon.
- `src/map/OverworldGenerator.ts` — `BuildingEntry` union, `placeBuilding` param,
  and the club placement (south of the square, west wall against the N-S road,
  short connector road). Constants: `CLUB_X_OFFSET/Y_OFFSET/W/H`, `ROAD_HALF`.
- `src/map/GameMap.ts` — `buildingEntries` field union, `generateInterior` param
  union + `isClub` branch (`CLUB_INTERIOR_W/H`, `CLUB_FLOOR`) + carving block
  (dance floor + divider walls).
- `src/map/tileTypes.ts` — `CLUB_FLOOR = 54`, `DANCE_FLOOR = 55` (walkable floors,
  so no `isWalkable` blocklist change needed).
- `src/map/tiles/specialFloorTiles.ts` — static renderers for both new floors.
- `src/scenes/BuildingInteriorScene.ts` — `clubMembership` ctor param, `club`
  field, construction, and wiring: `onEnter` music, update (modal early-return +
  space interact + tick), render (objects + UI), handleClick, escHandler, touch.
- `src/scenes/DungeonScene.ts` — `clubMembership` option/field/default + threaded
  into `BuildingInteriorScene` and both `DungeonScene` reconstructions.
- `src/audio/sounds.ts` — `desperado_club` SoundId (see placeholder note below).

### Deliberate scope decisions (read before Phase 2+)
- **Exterior roof:** reuses `ROOF_SLATE` (art-deco dressed-stone look). A dedicated
  neon-knife **sprite building** is the plan's Phase 5 upgrade — a new roof tile
  touches ~7 tile-system files for a cosmetic marker, so it was deferred.
- **Dance-floor animation:** the `DANCE_FLOOR` tile is a *static* dark base; the
  pulsing coloured lights are drawn as a per-frame overlay by
  `DesperadoClubSystem.renderDanceFloorLights` because the static `TileChunkCache`
  can't animate a cached floor tile.
- **Interior layout:** open floor plan with non-sealing divider walls (never boxes
  a region off) rather than a fully-walled maze — guarantees walkability. Layout
  lives entirely in `clubLayout.ts`.
- **Music:** `desperado_club` SoundId is real and wired, but its manifest path
  currently **reuses `circus_theme.mp3`** as a placeholder. Swap for a bespoke
  1920s-jazz track in Phase 5 (no code change — just the path in `sounds.ts`).
- **Persistence:** `ClubMembership` is threaded by reference across scenes exactly
  like `circus/murder/doomsdayQuestProgress`. Those objects are **not** serialized
  to the backend save (`GameProgress` only stores snapshots + levelId), so
  membership does not survive a full page reload — matching existing quest state.
  True reload persistence would require extending `GameProgress` (out of scope,
  and it would be a shared change for all quest objects).

### Stations (Phase 1 behaviour)
`CLUB_STATIONS` in `clubLayout.ts`: sledge, bar, casino, market, mercenary, vip.
Only **sledge** does anything real (greeting → grants pass, then a welcome-back
line). The other five show a themed "coming soon" flavour modal — replace those
with real UIs as each phase lands (`STATION_COMING_SOON` map in the system).

---

---

## Phase 2 — Bar & Market (done)

Walking to the **bar** opens a drinks shop; the **market** opens a gear shop.
Purchases spend `player.coins` and grant items. The village General Store is
unaffected (identical behaviour).

### Files changed
- `src/systems/ShopSystem.ts` — now **config-driven**. New optional
  `constructor(interiorWidth, config?: ShopConfig)`; exported `ShopItem` and
  `ShopConfig` types. `config` omitted reproduces the General Store exactly
  (`DEFAULT_SHOP_TITLE`, module-level `SHOP_ITEMS` fallback). Internal reads now
  use `this.title` / `this.items`.
- `src/systems/DesperadoClubSystem.ts` — owns two `ShopSystem` instances
  (`barShop`, `marketShop`) built from `BAR_SHOP_CONFIG` / `MARKET_SHOP_CONFIG`.
  `activeShop()` returns whichever panel is open; `modalOpen` widened to include
  an open shop (this is what gates scene movement/render). `handleInteract`
  opens the shop for the `bar`/`market` stations; `dismissModal`/`handleClick`/
  `renderUI`/`renderObjects` all branch on the open shop first. `update()`
  ticks both shops and plays `purchase_success` on a pending buy.
- `src/scenes/BuildingInteriorScene.ts` — two call sites forward `this.active()`
  now (`club.renderUI(ctx, canvas, active)`, `club.handleClick(mx, my, active)`).
  No other scene wiring needed: the existing `this.club?.modalOpen` guards
  (movement freeze, esc-close, touch routing, mobile-control freeze) already
  cover the shop panels through the widened getter.

### Scope decisions
- **No new items.** The bar sells the existing buff consumables
  (`speed_fizz`, `cooldown_crisp`, `jugg_juice`) — already fully wired as
  drink/buff mechanics — at premium prices. The market sells existing
  club-exclusive gear otherwise only won off dangerous foes
  (`stat_boost_potion`, `trollskin_shirt`, `enchanted_crown_sepsis_whore`).
  This satisfies the Phase 2 DoD without the large surface of brand-new
  use-behaviour (DungeonScene use logic, HUD icons, InventoryPanel art, sprites).
  All prices are named constants in `DesperadoClubSystem.ts`.
- **Shopkeeper render reuse:** the club draws its own fixed station NPC, so the
  two club `ShopSystem` instances' wandering-shopkeeper render + `isNearShopkeeper`
  are never used — only their buy panel + `tryBuy` logic. Their `update()` wander
  is invisible and harmless.
- **Purchase sound** is deferred until the panel closes (the `modalOpen`
  early-return in `update()` skips shop ticking while open) — identical to the
  existing General Store baseline, not a regression.

### Review
Independent code review (general-purpose agent) found **no substantive issues**:
backward compatible, CLAUDE.md-clean (no `as`/`!`/`any`, prices as constants),
consistent with the existing store wiring.

## Phase 3 — Casino (done)

Walking to the **casino** station opens a high-low coin-wager minigame. The
dealer shows a card (A–K); the player picks a wager tier and bets whether the
next card is **Higher** or **Lower**. A win pays 1:1; **ties pay the house**.

### Files added
- `src/systems/ClubCasinoSystem.ts` — the high-low game. Owns its own panel
  (`drawModal`/`drawButton`/`drawText`), card/wager/guess state machine, coin
  math, and click routing. Exposes `coinsWageredThisVisit` for the Phase 5
  free-security perk. Deliberately **not** a `GameSystem` — it has no per-frame
  lifecycle and is driven entirely by the club (like the two `ShopSystem`
  instances are driven by their open/close flags).

### Files changed
- `src/systems/DesperadoClubSystem.ts` — owns a `ClubCasinoSystem` instance.
  `casino` dropped from `STATION_COMING_SOON`; `promptLabel` returns `Play` for
  it. `modalOpen` now includes `casino.open`; `handleInteract` opens the table
  (`openTable(player)`); `dismissModal`/`handleClick`/`renderUI` branch on the
  casino before the flavour modal. A `coinsWageredThisVisit` getter forwards the
  casino's running total.
- No `BuildingInteriorScene` changes needed — the existing `club.modalOpen` /
  `handleClick(mx,my,active)` / `renderUI(...,active)` wiring already routes the
  casino panel through the widened `modalOpen` getter, exactly as it does the
  shops.

### Scope decisions
- **Rules as named constants:** wager tiers (`WAGER_SMALL/MEDIUM/LARGE` = 10/50/
  100), `WIN_PAYOUT_MULTIPLIER = 2` (stake back + 1:1), 13-card deck, tie-loses.
- **Per-visit reset is free:** `coinsWageredThisVisit` lives on the casino
  instance, which is reconstructed on every club entry (fresh scene → fresh
  club → fresh casino), so it resets to 0 each visit with no explicit teardown.
- **Wager persistence:** the chosen tier carries across rounds ("Deal Again"),
  stepping down only when the player can no longer afford it.
- **Feedback is a persistent string**, not a timed fade: the scene freezes
  `club.update()` while any club modal is open, so a frame-counted fade could
  never tick down. The casino instead shows a plain error line cleared on the
  next valid action.
- **Sounds:** win → `treasure_chest_reward`, loss → `powering_off`, selection/
  deal → `menu_click`. All pre-existing SoundIds.

### Review
Independent code review (general-purpose agent), two rounds. First pass found
two genuine defects — a `dealAgain` clamp that silently reset the wager to the
minimum every round, and dead timed-fade code that could never tick while the
panel was open. Both were fixed; the re-review confirmed the coin math, tie
rule, wager persistence, and all club delegation are correct with **no new
issues**.

## Phase 4 — Mercenaries Guild ("Meat Shields") (done)

Walking to the **mercenary** station opens Rosemarie's hire panel. Hiring one of
three archetypes spends `player.coins` and records the contract on a persisted
roster; back in the overworld the mercenary spawns, follows the active player,
and auto-attacks nearby hostiles (Mongo-pattern). It dies for good in combat
(clearing the roster), and is dismissed on building/floor transitions — then
respawns from the roster when you return.

### Files added
- `src/core/mercenaryTemplates.ts` — the template table (id union +
  `MercenaryTemplate`: name, title, blurb, price, hp, speed, damage) and
  `getMercenaryTemplate`. Single source of truth for merc price + stats, shared
  by the creature, the roster, and the hire panel. Three melee archetypes:
  `bruiser` (tank), `enforcer` (balanced), `berserker` (glass cannon).
- `src/core/MercenaryRoster.ts` — `{ active: HiredMercenary | null }` progress
  object + factory (one active hire at a time), threaded like `ClubMembership`.
- `src/creatures/Mercenary.ts` — a friendly `Mob` subclass (`isHostile=false`,
  no loot, `xpValue=0`). AI copied from `Mongo` (chase nearest hostile within
  aggro range of the owner, leash back) but **no recall** — it fights to the
  death. `owner` is reassigned each frame to the active player. Renders via the
  existing `drawClubNpc` (a distinct club figure per archetype).
- `src/systems/MercenarySystem.ts` — the overworld manager (modelled on
  `MongoSystem`). Lazy-spawns from the roster on the first frame, maintains
  `owner`/`allMobs`, exposes `activeMerc` for `extraTargets`, `dismiss()` for
  transitions, and `checkHealth(mobs, mobGrid)` for death (see below).
- `src/systems/MercenaryGuildSystem.ts` — Rosemarie's hire panel
  (`drawModal`/`drawButton`/`drawText`, click-routed like `ClubCasinoSystem`).
  Lists the templates; **Hire** deducts coins and sets `roster.active`; a second
  hire is blocked until the current contract is dismissed (an in-panel button).

### Files changed
- `src/systems/DesperadoClubSystem.ts` — owns a `MercenaryGuildSystem` (built
  with the roster + audio); ctor takes the roster. `mercenary` dropped from
  `STATION_COMING_SOON`; `promptLabel` returns `Hire` for it. `handleInteract`
  opens the panel; `modalOpen`/`dismissModal`/`handleClick`/`renderUI` branch on
  `guild.open` alongside the shops and casino.
- `src/scenes/BuildingInteriorScene.ts` — new `mercenaryRoster` ctor param +
  field + default, passed into `DesperadoClubSystem`.
- `src/scenes/DungeonScene.ts` — `mercenaryRoster` option/field/default; a
  `MercenarySystem` field constructed from it. Threaded into
  `BuildingInteriorScene` and every `DungeonScene` reconstruction that already
  threads `clubMembership` (building-exit + death-restart). `mercenarySystem`
  is ticked beside `mongoSystem` in the update loop, dismissed at the same two
  transition sites, its merc added to `extraTargets`, and `checkHealth` called
  right before `resolveKills`.
- `src/systems/GameLoopPhases.ts` — a `mercenary` audio-tag case plays
  `sword_attack_1` on a strike.

### Scope decisions
- **Melee-only archetypes.** All three templates are Mongo-pattern melee with
  distinct hp/speed/damage profiles. A true ranged class (bolts, projectile
  rendering, hit detection) is a much larger surface and is deferred — this
  keeps the marquee cross-scene ally lifecycle robust, as the plan advises.
- **Merc art reuses `drawClubNpc`** (a per-archetype club figure) rather than a
  bespoke walking sprite sheet — consistent with the Phase 1 placeholder-art
  deferral; a real merc sprite is Phase 5 polish.
- **Death is permanent.** Unlike Mongo (auto-recall at low HP), a merc has no
  recall: it dies in the field and clears the roster — a coin sink with stakes.
- **Roster persistence** matches `ClubMembership` exactly (threaded by
  reference, not backend-serialized). The floor-complete transition drops it
  like `clubMembership`, but that path is unreachable with a merc active (the
  club is on `level3`, an overworld with no `nextLevelId`).

### Review
Independent code review (general-purpose agent), two rounds. First pass found
one genuine defect: the merc's death was consumed by `resolveKills` as an enemy
kill (spurious human XP, a kill-stat, gore + minimap corpse, an enemy-death
sound, and an AI kill report) because nothing intercepted it before combat
resolution — Mongo avoids this via `MongoSystem.checkHealth()` running before
`resolveKills`. Fixed by adding `MercenarySystem.checkHealth(mobs, mobGrid)`
(splices the fallen merc out of `mobs` + grid and clears the roster) and calling
it immediately before `resolveKills`. The re-review traced both death paths and
the full lifecycle and confirmed the fix is correct with **no new issues**.

## Phase 5 — VIP Lounge & Polish (in progress)

### 5a. VIP Lounge (done)

Walking to the **vip** station opens the VIP Lounge — the tasteful adaptation of
the book's members-only back room (plan §3.7). Three coin sinks:

- **Full Recovery** (`VIP_HEAL_PRICE = 40`) — heals to full; disabled at full HP.
- **VIP Cocktail** (`VIP_COCKTAIL_PRICE = 60`) — applies Speed Fizz + Cooldown
  Crisp (reusing `Player.activateSpeedFizz`/`activateCooldownCrisp`); disabled
  only when **both** are already active (a partial re-buy refreshes the missing
  half — deliberate).
- **Private Escort** (`BODYGUARD_PAIR_PRICE = 500`) — hires the Sledge + Bomo as
  two **cosmetic** Cretins that lerp-follow the player around the club (no
  combat — the club is a safe zone). **Free** when
  `coinsWageredThisVisit > BODYGUARD_PAIR_PRICE` (the canon "spend enough at the
  tables and security is free" perk — strictly-greater, matching the docs).

#### Files added
- `src/systems/ClubVipLoungeSystem.ts` — the panel (drawModal/drawButton/drawText,
  click-routed like `MercenaryGuildSystem`). Owns `escortHired` + `wageredAtOpen`;
  exposes `escortActive` for the host to render the escort. Not a `GameSystem` —
  driven by the club's open/close flags, like the casino and guild.

#### Files changed
- `src/systems/DesperadoClubSystem.ts` — owns a `ClubVipLoungeSystem`; `vip`
  dropped from the (now-removed) `STATION_COMING_SOON`; `promptLabel` returns
  `Enter` for it. `handleInteract` opens the lounge with the live
  `coinsWageredThisVisit`; `modalOpen`/`dismissModal`/`handleClick`/`renderUI`
  branch on `vip.open` alongside the shops, casino, and guild. New `renderEscort`
  lazily seeds two `EscortFollower`s and eases them toward flanking offsets behind
  the active player each frame.
- `src/sprites/clubNpcSprite.ts` — new `bomo` Cretin variant (Sledge's friend).

#### Scope decisions
- **Escort is cosmetic**, per plan §3.7 — no `Mob`, no targeting, no combat; it
  only renders + follows, preserving the safe-zone invariant.
- **Per-visit reset is free**: `escortHired`/`wageredAtOpen` live on the vip
  instance and `escortFollowers` on the club, both reconstructed on every club
  entry (fresh scene → fresh club), like the casino's `coinsWageredThisVisit`.
- **`wageredAtOpen` snapshots on `openPanel`** — gambling can't happen while the
  modal is open, so the free-escort gate is stable within a panel session and
  refreshes on the next entry.

#### Review
Independent code review (general-purpose agent): **no substantive defects** —
coin math, per-visit state isolation, free-escort gate, click/modal routing, and
the safe-zone invariant all verified against the sibling systems. One actionable
item — the free-escort gate used `>=` while both docs say "exceeds"/"more than" —
was fixed to strictly-greater (`>`). The partial-cocktail re-buy was judged a
deliberate design choice, not a bug.

### 5b. Achievements (done)

Four club achievements via `AchievementManager` (`AchievementId` + defs), all
`playerType: 'both'`, each with a loot box:

- `desperado_member` "Made the Cut" — take the Desperado Pass (Bronze Adventurer).
- `merc_hired` "Hired Muscle" — first Meat Shields contract (Silver Adventurer).
- `casino_jackpot` "High Roller" — win a top-tier (`WAGER_LARGE`) casino wager
  (Silver Spicy).
- `club_bodyguards` "Personal Security" — hire the VIP escort (Bronze Adventurer).

`DesperadoClubSystem` now takes optional `humanAchievements`/`catAchievements`
managers (threaded from `BuildingInteriorScene`) and a private
`unlockAchievement(id)` that calls `tryUnlock` on **both** (mirroring how
`doomsday_contained` unlocks). Membership unlocks in `dismissModal` (greeting
grant) + the constructor (returning member). The other three fire off **pending
flags** — `casino.jackpotPending`, `guild.hirePending`, `vip.escortPending` —
set at the triggering click and consumed in `club.update()`. This matches the
existing `purchasePending` pattern: sub-panels freeze `club.update()` while open
(scene early-returns on `modalOpen`), so the flag is read the frame the panel
closes. Movement + exit are gated behind the same freeze, so a flag can never be
set-but-never-consumed before leaving. Independent review: no defects.

### 5c. GumGum hook relocation (done, optional/reversible)

`MurderMysteryQuestSystem` — GumGum's opening approach now anchors on the
Desperado Club door (`doorTileOf('The Desperado Club')` + `GUMGUM_CLUB_DOOR_OFFSET`)
instead of the pub, book-accurate to *Carl's Doomsday Scenario*. **Gated on the
pub also existing**, so the alley/body anchor and the `gumgumTile ? … : 'complete'`
viability check resolve exactly as before on a pub-less map; pub-only maps fall
back to `GUMGUM_DOOR_OFFSET`. Only his *approach* point moves — his body still
turns up in the pub alley, and HOOK_DIALOG already says "meet behind the Sunken
Stump," so it stays coherent. Reverting is one line (drop the club lookup); the
rest of the questline is untouched. Independent review: no regression.

### 5d. Remaining polish (not started)
Dev-URL jump into the club, AI-driven NPC banter, and the neon-knife sprite
building. See implementation §5.

### 5e. Visual & audio polish pass (done)

A round of look/feel fixes across the club:

- **Music is real & rotating.** The four `desperado_club_1..4.mp3` tracks are now
  registered SoundIds (`CLUB_MUSIC_TRACKS` in `audio/sounds.ts`); the placeholder
  `desperado_club` id (which reused `circus_theme`) is gone. `AudioManager` gained
  `playMusicPlaylist(ids, opts)` — a shuffled, gapless-advancing, wrapping playlist
  built on a shared `startMusicTrack` used by both `playMusic` (loop) and the
  playlist (loop=false + onended advance). `stopMusic` clears the playlist;
  `stopCurrentMusicSource` swaps tracks without doing so; suspended-context resume
  restarts the current slot. `onEnter` plays the playlist.
- **Rock-golem bouncers.** Sledge/Bomo render as cracked-granite tuxedo bruisers
  (boulder shoulders, rubble torso, glowing eyes, gold lapel/bow tie) via a
  dedicated `drawStoneGolem` path in `clubNpcSprite.ts`, not the grey humanoid.
- **Pose-driven crowd + dancing.** `clubNpcSprite.ts` is rebuilt around one
  pose-driven humanoid: arms swing, legs step, hips sway. Four dance routines are
  picked per dancer by a stable `seed`; a new `patron` variant + varied
  skin/outfit/hair pools make the crowd look distinct. `DesperadoClubSystem` seeds
  8 dancers and spawns 6 wandering patrons (`CLUB_PATRON_AREA`) that stroll the
  entrance floor.
- **Distinct, decorated areas.** New `sprites/clubDecor.ts` draws a themed rug,
  label, and props per station from `CLUB_ZONES` (bar counter + bottles + stools,
  casino felt table + chips, market awning + crates, weapon rack + banner, VIP
  velvet couch + rope stanchions). Zones are larger than the single station tile.
- **Greeting modal** height is now derived from the wrapped body (`measureTextBox`)
  so text never overflows or collides with the Continue hint.
- **Casino & VIP panels** got contrast + spacing fixes (casino wager label no
  longer overlaps the card captions; VIP is re-dressed in velvet + gold with
  higher-contrast body text).

## Validation
`npm run typecheck`, `npm run lint`, `npm run format`, `npm run build` all clean
as of the Phase 5e (visual & audio polish) completion.
