# Overworld fast travel

Give the floor-3 overworld a fast way home and a fast way back out, with
mechanics a player cannot misread and an introduction they cannot miss.

## 1. What is wrong today

The overworld is 280×280 tiles (the `mapSize: 280` field on `level3` in
`src/levels/level3.ts`) at 32 px per tile (`TILE_SIZE` in
`src/core/constants.ts`) — an 8 960×8 960 px map. The player walks at
`PLAYER_SPEED = 2.5` px/frame (`src/core/constants.ts`), applied in
`applyMovement` in `src/systems/GameLoopPhases.ts`, i.e. 150 px/s ≈ **4.7 tiles
per second**. Everything worth visiting is far from everything else:

- The circus is placed 70–90 tiles from the town centre
  (`CIRCUS_MIN_DIST = 70`, `CIRCUS_DIST_VARIANCE = 20` in
  `src/map/OverworldGenerator.ts`) — 15–19 s each way in a straight
  line that does not exist: forests, rivers and cliffs make real routes longer.
- Bounty sites scatter out to a 16-tile edge margin
  (`BOUNTY_EDGE_MARGIN` in `src/map/OverworldGenerator.ts`) — up to ~124 tiles
  from centre, ~26 s each way at best.
- Rivers cut everything at `WADE_SPEED_FACTOR = 0.36`
  (`src/core/constants.ts`) unless the player detours to a bridge — which is
  the point of bridges, and also why cross-country trips crawl.

Every shop restock, quest turn-in, checkpoint touch and "I should sell this"
impulse is a round trip to town. That round trip is pure walking. Playtesters
asked for a teleport-to-town item or a faster mount.

The one traversal tool that already exists — **Speed Fizz**, 2× speed for 25 s
(`SPEED_FIZZ_MULTIPLIER = 2` in `src/Player.ts`; 1 500 ticks, `makeSpeedFizz`
in `src/core/StatusEffect.ts`), sold by the tinker for 12c (`SPEED_FIZZ_PRICE`
and the `speed_fizz` entry in `TINKER.items`, `src/systems/market/vendorDefs.ts`)
— is evidently not being
discovered, or 2×-for-25 s is not enough. Either way it is telling that the
feedback asked for things the game half-has.

## 2. What the codebase already supports (survey)

**Teleporting the party is a solved problem here.** Three shipped mechanisms
write player positions directly:

- The AI Chaos `teleport_player` action (the `case 'teleport_player':` block in
  `executeAIAction`, `src/ai/aiActions.ts`): vetoes during boss fights
  (`isBossFightActive` → `this.bossRoom.anyLocked`, implemented in
  `createAISceneContext` in `src/scenes/DungeonScene.ts`), snaps to
  `nearestWalkableTile`, writes `player.x/y`, then drags the companion to an
  adjacent walkable tile.
- The `!bounty go` chat cheat (`runBountyWarpCheat` in
  `src/scenes/DungeonScene.ts`) warps both crawlers, with
  `findWarpLandingTile` doing an expanding ring search through
  `hasRoomToMove` (`src/map/findWalkableTile.ts`) — the landing-tile idiom to
  copy, per the walkable-is-not-spawnable trap.
- Checkpoint respawn (the `this.human.x = cp.respawnX` / `this.cat.x = ...`
  writes in `restoreFromCheckpoint`, `src/scenes/DungeonScene.ts`) writes both
  crawlers' positions and proves the fixup surface is small.

**The invariants after a player teleport are already benign, verified:**

- The player is **not** in `mobGrid` — it is `SpatialGrid<Mob>` (the
  `private mobGrid!: SpatialGrid<Mob>` field on `DungeonScene`), so the
  teleporting-a-mob gotcha (`move` on `SpatialGrid`, `src/core/SpatialGrid.ts`)
  does not apply to the crawlers themselves. It **does** apply to anything
  else we move.
- Camera is derived per frame from the active player (the private `camera()`
  method on `DungeonScene`) — nothing to fix.
- Minimap fog reveals from the player's tile per frame (`revealMinimap` in
  `src/systems/GameLoopPhases.ts`) — a teleport just reveals the new area next
  frame.
- Water waders are keyed by entity identity and pruned when unreported (the
  `waders` map and `beginFrame` on `WaterAnimationSystem`,
  `src/systems/WaterAnimationSystem.ts`) — worst case one spurious splash.
- The companion never self-teleports — `CompanionSystem` gives up beyond its
  96-tile path budget (`COMPANION_MAX_PATH_DISTANCE_TILES` and the
  path-search-failure early return in `companionFollow`,
  `src/systems/CompanionSystem.ts`) — so the teleport **must** carry the
  companion, as both existing warps do. Mongo and mercenaries are dismissed on
  building entry (the `mongoSystem.dismiss` / `mercenarySystem.dismiss` calls
  in the `BuildingSystem` entry callback wired up in `DungeonScene`'s
  constructor) and on checkpoint restore (the same two calls in
  `restoreFromCheckpoint`); fast travel should do the same.

**Combat gating signals exist:** `hasNearbyEnemy(player, range)` (the private
method on `DungeonScene`, already used to gate interactions in
`renderPropPrompt`, `renderCitizenPrompt` and `triggerSpaceAction`),
`bossRoom.anyLocked` (the `anyLocked` getter on `BossRoomSystem`,
`src/systems/BossRoomSystem.ts`), and damage recency via `framesSinceDamaged` /
`isRegenSuppressed` (the `isRegenSuppressed` getter on `Player`,
`src/Player.ts`).

**Item, shop, cooldown and announcement plumbing all exist:**

- Item pattern: `ItemId` union + `ITEM_DEF` (`src/core/ItemDefs.ts`), hotbar
  branch in `triggerHotbarActivation` (`src/scenes/DungeonScene.ts` — the
  `slot?.id === 'scroll_of_confusing_fog'` branch is the shape to copy), icon
  branch in `InventoryPanel.renderItemIcon` (`src/ui/InventoryPanel.ts`).
- Cooldown display: `drawCooldownOverlay` (`src/ui/CooldownOverlay.ts`) is
  already shared by hotbar ability slots (the ability-cooldown-overlay block
  in `InventoryPanel.renderSlot`, fed per frame from the
  `this.inventoryPanel.abilityCooldowns.set(...)` calls in `DungeonScene.render`)
  and Mongo's Summon button.
- Shop: the Over City market is pure data — one entry in `MARKET_VENDORS`
  (`src/systems/market/vendorDefs.ts`) puts an item on a stall;
  `PricedMenuPanel` charges `active.coins` (the `tryBuy` method on
  `PricedMenuPanel`, `src/ui/PricedMenuPanel.ts`; coins at the `coins` field on
  `Player`, `src/Player.ts`).
- Discoverability surfaces: `SystemAnnouncer.announce`
  (`src/ui/SystemAnnouncer.ts`), `HotbarToast` (the `hotbarToast` field on
  `DungeonScene`), Mordecai's floor advice (the `AdviceObjective` interface in
  `src/systems/mordecaiAdvice.ts` — objectives with `{direction}` bearings),
  the `rewardGranted` bus event + dialog (`bus.emit('rewardGranted', ...)` and
  `RewardGrantedDialog`/`ChestRewardDialog` in `DungeonScene`), and
  `drawArrowAbovePlayer` (`src/ui/WorldArrow.ts`).
- Town arrival is safe by construction: `GameMap.isInTownSafeZone`
  (`src/map/GameMap.ts`), radius 40 tiles (`TOWN_SAFE_RADIUS_TILES` in
  `src/map/town/townPlan.ts`) — hostiles break off inside it.

**What does not exist at all:** any mount/rider machinery. A codebase-wide
search for ride/rider/mount finds only prose in comments. There is no rider
composition in any sprite pipeline, no mounted state on `Player`, and no art.

## 3. Teleport item vs mount — evaluation and recommendation

|                     | Teleport item                                                                 | Mount                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solves              | Return-to-hub (the actual complaint: round trips)                             | Raw traversal speed                                                                                                                                                                                         |
| Engine support      | Complete — three shipped teleports, landing search, combat gates, cooldown UI | None — zero rider machinery                                                                                                                                                                                 |
| Art cost            | One inventory icon (procedural, like every potion)                            | New creature sheet + rider variants for **two** crawlers × 3 views × walk/idle rows, against a sprite budget already at ~1.3 GB                                                                             |
| Mechanics cost      | One system, ~4 gates                                                          | Mount/dismount state machine; combat, wading, interiors, building entry, camp leashes all interact; companion tops out at `FOLLOWER_SPEED = 3.5` (`src/core/constants.ts`) so a fast mount yo-yos the party |
| Animation risk      | None                                                                          | High — sprite cadence at 2×+ speed hits the known undersampling/aliasing traps (gait cadence vs speed; Nyquist)                                                                                             |
| Clarity for players | "Use stone → you are in town" — self-explaining                               | Where is it allowed? What happens when hit? Why did I dismount?                                                                                                                                             |

**Recommendation: build the teleport item, and make it two-way so it also
covers most of the traversal half.** A one-way recall solves "get me home" but
leaves the player walking back out — so the stone keeps a **trail anchor**: it
remembers where you recalled from, and using it in town returns you there.
That converts every town round trip (sell, restock, checkpoint, turn-in) from
two long walks into zero, which is the bulk of the reported pain, for roughly
one system and one item.

The mount is **deferred, not rejected** — §9 records what it would take. Raw
exploration speed in the wilderness is meanwhile served by making Speed Fizz
discoverable (Phase 4): the mechanic players asked for at 2× already exists,
priced at pocket change, and nobody is finding it.

## 4. Design — Wayfinder's Anchor

One permanent item, `wayfinders_anchor`, display name **"Wayfinder's
Anchor"**. Non-stackable, `canHotlist: true`, `canDrop: false` (like the tomes,
e.g. the `magic_missile_tome` entry in `ITEM_DEF`, `src/core/ItemDefs.ts` — a
fast-travel key you can lose is a support ticket). It is **not** granted on
arrival: the party assembles it from three shards during the questline in §5,
and on assembly one is placed in **each** crawler's inventory so it sits on both
hotbars.

Two modes, chosen automatically by where you stand
(`gameMap.isInTownSafeZone`, `src/map/GameMap.ts`):

- **In the wilderness** — channel, then teleport the party to the town square
  (`gameMap.townSquareCentre`, `src/map/GameMap.ts`), and **record the
  departure tile as the trail anchor**.
- **In town** — if a trail anchor exists, channel, then teleport the party back
  to it and clear it. If none exists, refuse with a toast ("The stone has no
  trail to follow.").

Mechanics, all as named constants in the new system:

- `RECALL_CHANNEL_FRAMES = 180` (3 s). Channeling shows a progress bar and is
  cancelled by moving, by taking damage (watch `framesSinceDamaged` dip below
  the frames-into-channel, the `isRegenSuppressed` getter on `Player`,
  `src/Player.ts`), or by pressing the hotbar key again. A cancelled channel
  costs nothing.
- `RECALL_COOLDOWN_FRAMES = 3600` (60 s), shared across both modes and both
  crawlers, started only on a **successful** teleport. Long enough that it is a
  travel tool, not a combat escape.
- Start refusals (each with `error_taking_action` + a `HotbarToast` naming the
  reason, the refusal idiom from `drinkPotion` in `src/scenes/DungeonScene.ts`):
  - not on an overworld floor (`levelDef.isOverworld`, the `isOverworld: true`
    field on `level3` in `src/levels/level3.ts`) — "The stone is inert
    underground."
  - `bossRoom.anyLocked` (the existing teleport veto,
    `if (ctx.isBossFightActive()) break;` in the `teleport_player` case of
    `executeAIAction`, `src/ai/aiActions.ts`)
  - hostiles within `RECALL_ENEMY_BLOCK_RADIUS_TILES = 7` via `hasNearbyEnemy`
    (the private method on `DungeonScene`) — "Too dangerous — enemies nearby."
  - cooldown still running (the overlay already says how long)
- Teleport execution copies the shipped warp, in this order:
  1. Dismiss Mongo and mercenaries (`mongoSystem.dismiss` /
     `mercenarySystem.dismiss`, the building-entry precedent in the
     `BuildingSystem` entry callback wired up in `DungeonScene`'s constructor)
     — their dismissal already handles `mobs`/`mobGrid` bookkeeping, which is
     where the `mobGrid.move` gotcha would otherwise bite.
  2. Find the landing tile with the `findWarpLandingTile` ring-search idiom
     (`src/scenes/DungeonScene.ts`) over `hasRoomToMove` — for recall, rings
     around `townSquareCentre`; for return, around the anchor.
  3. Write `human.x/y`, place the cat on an adjacent walkable tile via
     `nearestWalkableTile` (the companion-placement pattern in the
     `teleport_player` case of `executeAIAction`, `src/ai/aiActions.ts`).
  4. Nothing else: camera, fog, waders and companion pathing self-heal (§2).
- The trail anchor is per-scene state (a floor change or checkpoint restore
  discards it) — a stale anchor into a regenerated map is a bug, not a feature.
- The whole party teleports regardless of who pressed the key; the item acts
  through `active()` like every hotbar item (the start of
  `triggerHotbarActivation` in `src/scenes/DungeonScene.ts`).

## 5. Unlock — the questline "The Anchor is Broken"

The stone is **earned, not handed over**. The player starts floor 3 owning
nothing of it. A short town questline — three shards from three townsfolk, then
an assembly fee — walks the plaza ring once, deliberately, so that the trip the
stone abolishes is a trip the player has actually made.

Quest id `anchor_shards`, `type: 'mini'`, registered on a `QuestManager`
(`src/core/QuestManager.ts`) owned privately by the new quest system — the same
arrangement three of the five shipped questlines already use (see the header of
`src/systems/questTracker.ts` for why there is no global manager).

### 5.1 Progress lives outside both scenes

The questline spans two scenes: the plaza and the market stall are
`DungeonScene`, Hilda's cottage and the temple are `BuildingInteriorScene`, and
an interior is **constructed fresh on every entry** — its systems, its
`Townsperson`s and its whole tile grid are rebuilt each time a door opens (the
header of `src/core/TownMemory.ts` states this and why). So the questline's
record cannot live on either scene.

Add `src/core/AnchorQuestProgress.ts`, a plain mutable record threaded by
reference through both scene constructors, exactly as `MurderQuestProgress`
(`src/core/MurderQuestProgress.ts`), `CircusQuestProgress` and `TownMemory`
already are:

- the quest's `QuestStatus`,
- per-shard step state for the three givers (`offered` / `in progress` /
  `shard owed` / `done`),
- how many of Hilda's furnishings are repaired,
- how many temple vermin remain.

**Shard ownership is read from inventory, not mirrored in the record.** The two
crawlers carry separate inventories (`inventory` on `Player`), so "do we have
all three?" is a sum over _both_ — `human.inventory.countOf(id) +
cat.inventory.countOf(id)` — for each shard id. Duplicating ownership into the
progress record would give it two sources of truth that a checkpoint restore can
desync; the record tracks only what inventory cannot say.

### 5.2 The offer, at the plaza fortune teller

Madame Voss reads the Anchor's ruin off her cards. She is a **prop**, not an
NPC: `TownPropSystem` owns her tile (its `fortuneTile` field) and floats the
`Consult` prompt, and `DungeonScene.openFortuneTeller` opens
`FortuneTellerPanel` on `PLAZA_SEER` (`src/ui/FortuneTellerPanel.ts`). The quest
intercepts **before** that panel: while the questline has anything to say, the
Consult prompt opens the quest's `QuestDialog` instead of the card reading, and
the reading is what you get when it does not.

The offer's last page carries a decline button (the `declineButton` field on
`DialogPage`, `src/ui/QuestDialog.ts`) and a **reward preview** — Ryan's
requirement that a player can see what they are agreeing to work for:

- Add an optional `reward` field to `DialogPage`: the reward item's id, its
  display name, a one-or-two-line plain statement of what it does ("Anywhere in
  the Over City: returns you to the town square. In the square: returns you to
  where you left."), and the XP figure.
- `QuestDialog` renders it as a `drawBox` strip below the body lines
  (`BOX_PRESETS.panel`) with `drawText`, sized into the dialog's existing height
  arithmetic (`DIALOG_BASE_HEIGHT` and friends) rather than overlapping it.
- Draw the item's icon in the strip. `InventoryPanel.renderItemIcon`
  (`src/ui/InventoryPanel.ts`) is the only place that knows how to draw an item;
  extract its body to a free `drawItemIcon(ctx, item, x, y, size)` exported from
  that module and have the panel and the strip both call it. No second icon
  switch — a duplicate would drift the first time an icon changes.

Declining leaves the quest `available` and Voss keeps the offer. Accepting
starts it, emits `questStarted`, and her tile gains a quest marker (§5.6).

### 5.3 Shard one — the tinker (coins)

The tinker sold it for scrap and still has it. One extra `PricedOption` on the
`TINKER` entry in `MARKET_VENDORS` (`src/systems/market/vendorDefs.ts`),
present only while the quest is active and the shard is unowned; once bought,
the row is gone. Price `ANCHOR_SHARD_PRICE_COINS = 20`.

`PricedMenuPanel` already refuses an unaffordable row and calls `onBlocked`
(the `unavailable` field on `PricedOption` and the `tryBuy` method,
`src/ui/PricedMenuPanel.ts`), so a broke player gets the existing refusal, not a
new one. Buying grants `anchor_shard_tinker`.

This step is deliberately the trivial one: it is the shape of the quest stated
in ten seconds, so the other two read as variations rather than as surprises.

### 5.4 Shard two — Old Hilda (repair her furniture)

**Her cottage is a wreck from the first time you walk in**, before the quest
exists and whether or not you ever take it. A room that becomes broken the
moment a quest tells it to reads as a stage flat; a room that was always broken
reads as a hedge-witch who cannot afford a carpenter.

- **Broken furnishings are real tile types.** Add `BROKEN_TABLE`,
  `BROKEN_CHAIR` and `BROKEN_BOOKSHELF` to `src/map/tiles/interiorTiles.ts`
  beside the intact ones they splinter, and register each in **both**
  registries — `DECORATION_TYPES` in `src/map/TileRenderer.ts` and
  `DECORATION_OVERLAY_TYPES` in `src/map/GameMap.ts`. A Y-sorted decoration
  missing from either one renders as bare floor.
- **Three of them**, `HILDA_REPAIRS_REQUIRED = 3`: her worktable, its chair, and
  one wall shelf — the pieces the `case "Old Hilda's Cottage":` block in
  `GameMap.generateInterior` already places (`TABLE`, `CHAIR`, `BOOKSHELF`).
  The quest system rewrites those three tiles to their broken types on interior
  entry for as many as the progress record says are unrepaired, rather than
  `generateInterior` growing a quest parameter — hostiles are placed the same
  way (`src/systems/interiorHostiles.ts`, whose header states the principle: a
  room gains content by having content put in it, not by the generator learning
  about quests).
- **Talk to her first, and it is obvious.** `Townsperson`
  (`src/creatures/Townsperson.ts`) has no marker today — every marker in the
  game hangs off `QuestNPC`, `Shady`, `Signet` or `GumGum`. Add a
  `markerType: NPCMarkerType` field to `Townsperson`, defaulting to `'none'`,
  and draw the glyph with the shared `questMarkerColorFor` helper the four
  existing markers already share (the `markerType` branches in
  `src/creatures/QuestNPC.ts` are the drawing to copy). Follow the shipped
  convention — **`'exclamation'` offers, `'question'` turns in** — so Hilda
  wears an exclamation before you have spoken to her and a question once the
  last repair is done. Her residency is already fixed: `residentId:
'old_hilda'` in the `"Old Hilda's Cottage"` roster in
  `src/systems/InteriorOccupantSystem.ts`. The quest dialog intercepts her
  `reading` service (`src/systems/townServices.ts`) exactly as it intercepts
  Voss's.
- **The wood pile does not exist until she asks.** Only after that conversation
  does a pile appear in the cottage. Reuse the defend quest's wholesale: the
  same `quest_wood_board` item (`src/core/ItemDefs.ts` — it already exists and
  its description will need a second sentence), the same `drawWoodPileSprite`
  drawn by the system rather than baked into a tile, the same walk-over pickup
  (`tickWoodPile` on `DefendQuestSystem`) and the same respawn cadence, so a
  player who somehow wastes boards can never soft-lock. `BOARDS_PER_REPAIR = 2`.
- **A repairable piece glows only when you can repair it.** Holding
  `BOARDS_PER_REPAIR` or more, each unrepaired tile draws a pulsing highlight
  ring from the quest system plus `drawInteractionPrompt` with the defend
  quest's `'R'` key override (the build/repair prompt block in
  `DefendQuestSystem.render` is the pattern, prompt label `Repair`). Holding
  nothing, the furniture still reads broken but does not glow, and the pile gets
  the pointer instead — the highlight always answers "what can I do _now_".
- Repairing writes the tile back to its intact type, consumes the boards, and
  increments the count in `AnchorQuestProgress` so a re-entered cottage stays
  fixed. All three → her marker turns to `'question'` → talk → `anchor_shard_hilda`.

### 5.5 Shard three — the temple (clear the vermin)

Deacon Aviel is already the Temple of the Sky's altar occupant (`residentId:
'deacon_aviel'` in the temple roster in `src/systems/InteriorOccupantSystem.ts`,
selling blessings through `buildBlessingMenu` in `src/systems/townTemple.ts`).
He gets the same `markerType` treatment as Hilda, and the same dialog intercept
ahead of his blessing menu.

- **The vermin appear when he asks, not before.** `TEMPLE_VERMIN_COUNT = 3`
  spawn in the nave on the step starting — placed off the aisle through
  `findNearbyWalkableTile` (`src/map/findWalkableTile.ts`) like every other
  interior spawn, and joining the room's existing `MobRoster` so the room's
  shipped `CombatKit` and `DestructionKit` fight and gore them with no new
  combat code (the principle stated in the header of
  `src/systems/interiorHostiles.ts`).
- **They run away.** New `ShrineVermin extends Rat` (`src/creatures/Rat.ts`)
  overriding `update` to flee: no aggro, no bite, no contact damage — it moves
  _away_ from the nearer crawler at rat speed via `moveWithCollision`
  (`src/creatures/Mob.ts`), and cowers when a wall leaves it nowhere to go. Rats
  die in one or two hits (`RAT_HP = 3`), so the step is a chase, not a fight.
  Two traps sit exactly here:
  - `followTargetCollide` writes facing only when it actually walks — a fleeing
    mob that stops must set its own facing or it keeps the direction it last
    walked (the mobs-stop-facing-nothing gotcha). Flight computes its own
    heading anyway; write it explicitly.
  - The interior is 18×18 (`INTERIOR_BY_NAME` in `src/map/GameMap.ts`), so
    flight must clamp to walkable tiles or a vermin presses into a pew forever.
- Any kill counts — either crawler, the companion, a mercenary, a status effect.
  Read deaths off the roster the room already prunes rather than off a
  player-kill event, or a cat-killed rat will not count.
- Progress is the questline's record, not `TownMemory.clearedRooms`: the room's
  ordinary occupants are unaffected and the vermin are not a room feature. Leave
  the `roomKey` set alone.
- Last one dead → Aviel's marker turns to `'question'` → talk → `anchor_shard_temple`.

### 5.6 Assembly, and what the player is told

Back to Voss with all three. She charges `ANCHOR_ASSEMBLY_FEE_COINS = 25` —
small enough to be a joke about seers rather than a wall, and refused with a
`HotbarToast` naming the price if the party is short. On payment:

- remove the three shards from whichever inventories hold them,
- add `wayfinders_anchor` to **both** crawlers and auto-place it on a free
  hotbar slot each,
- `bus.emit('rewardGranted', …)` into `RewardGrantedDialog`
  (`src/ui/RewardGrantedDialog.ts`) so the stone is presented, not just
  deposited, plus `SystemAnnouncer.announce` (`src/ui/SystemAnnouncer.ts`) and a
  `HotbarToast`,
- `questManager.completeQuest('anchor_shards')` and the XP in `QuestRewards`.

Everything else that teaches the stone still applies:

1. **The Journal carries the questline.** Implement `TrackerSource`
   (`src/systems/questTracker.ts`) on the new system: one entry per live step,
   with an `objective` line and a `target` tile — the fortune tile, the tinker's
   stall, Hilda's door and the temple door (`doorTileOf` on
   `MurderMysteryQuestSystem` is the idiom for a door tile). That is what makes
   a three-stop errand followable without a wiki, and it feeds the world arrow.
2. **Mordecai points at the questline first.** An advice objective in
   `src/systems/mordecaiAdvice.ts` (the `AdviceObjective` interface) sending the
   player to the plaza seer with a `{direction}` bearing, `complete` once the
   quest is accepted; then a second objective, after the stone exists, that
   restates the two modes and completes on first use.
3. **The item explains itself.** The `ITEM_DEF` description states both modes
   and the cooldown in one paragraph — descriptions render in the inventory
   panel where players actually read them. Each shard's description says which
   townsperson it came from and that Madame Voss can join them.
4. **Speed Fizz signposting (the traversal half).** Same advice mechanism: an
   objective pointing at the market stalls ("The tinker sells Speed Fizz —
   twice your speed for 25 seconds — {direction}") with a bearing to
   `townSquareCentre`, complete once a fizz has been bought or drunk. No new
   mechanics; pure discoverability for what already exists (the `speed_fizz`
   entry in `TINKER.items`, `src/systems/market/vendorDefs.ts`).

## 6. UI and feedback (all via `src/ui/` utilities)

- **Hotbar icon**: new branch in `InventoryPanel.renderItemIcon`
  (`src/ui/InventoryPanel.ts`) — a rune-marked stone, procedural like the
  potion flasks (the `item.id === 'health_potion'` branch, with its shared
  `HP_POTION_*` geometry constants, shows the idiom).
- **Cooldown on the slot**: reuse the ability-cooldown overlay. The lookup in
  `InventoryPanel.renderSlot` keys off `item.abilityId`; widen it to
  `item.abilityId ?? item.id` so plain items can carry cooldowns, and set
  `inventoryPanel.abilityCooldowns.set('town_recall_stone', …)` per frame from
  the system, exactly as the three abilities do (the
  `this.inventoryPanel.abilityCooldowns.set(...)` calls in
  `DungeonScene.render`). Players already read this overlay (the doc comment
  on `drawCooldownOverlay`, `src/ui/CooldownOverlay.ts`, documents that as its
  purpose).
- **Channel bar**: `drawProgressBar` with a `PROGRESS_PRESETS` entry
  (`src/ui/Box.ts`) drawn over the channeling crawler, plus a `drawText` label
  — "Recalling to the Over City…" / "Returning to your trail…" — so the
  destination is stated before the screen changes.
- **Mode legibility at a glance**: while in town with a live anchor, draw
  `drawArrowAbovePlayer` toward the anchor for a few seconds after entering the
  safe zone (`src/ui/WorldArrow.ts`) — the stone visibly "points back".
- **Refusals**: `HotbarToast` + `error_taking_action`, one reason per refusal
  (§4). Never a silent no-op.
- **Sound**: reuse existing SFX (`confusing_fog` for the warp, `speed_fizz`
  fizz for the channel start) to keep asset scope at zero; swap for bespoke
  sounds later via the add-sound pipeline if Ryan wants (`src/audio/sounds.ts`).
- **Mobile**: the stone is a hotbar item, so tap-activation comes free with the
  existing hotbar tap path (the `hotbarActivation` handler passed to
  `this.inputHandler.bind(...)` in `DungeonScene.onEnter`).

## 7. Implementation phases

Type-safety rules apply throughout: no `as`, no `!`, no `any`; every number
above becomes a named constant.

### Phase 1 — Items and the progress record

- `src/core/ItemDefs.ts` — add `'wayfinders_anchor'` and the three
  `'anchor_shard_*'` ids to the `ItemId` union; add the `ITEM_DEF` entries. The
  stone is non-stackable, `canHotlist: true`, `canDrop: false`,
  `type: 'consumable'`, described per §5.6.3; each shard is
  `isQuestItem: true`, `canDrop: false`, non-stackable. Extend the
  `quest_wood_board` description to cover Hilda's repairs as well as the
  barricades.
- `src/ui/InventoryPanel.ts` — icon for the stone and one shared shard icon;
  extract `renderItemIcon`'s body to an exported `drawItemIcon` (§5.2) so the
  quest dialog's reward strip can draw the same art.
- `src/core/AnchorQuestProgress.ts` — the record per §5.1, threaded through the
  `DungeonScene` and `BuildingInteriorScene` constructors alongside `TownMemory`
  and the other questline records.
- `src/dev/playtestPresets.ts` — a floor-3 preset carrying all three shards
  (quest mid-flight) and one carrying the finished stone (idiom: the
  `hotbar`/`bag` array literals on a `PlaytestPreset` such as `HOARDER`), so
  `?playtest` can drop into either half without playing the other.

### Phase 2 — The offer and the assembly (fortune teller)

- `src/ui/QuestDialog.ts` — the optional `reward` field on `DialogPage` and its
  strip, folded into the dialog's height arithmetic (§5.2).
- New `src/systems/AnchorQuestSystem.ts` implementing `GameSystem`
  (`src/systems/GameSystem.ts`) and `TrackerSource`
  (`src/systems/questTracker.ts`): owns the `QuestManager`, the dialog, the
  marker states and the assembly transaction.
- Intercept the Consult prompt in `DungeonScene` ahead of `openFortuneTeller`;
  quest marker over `TownPropSystem`'s `fortuneTile`.
- Assembly: shard removal across both inventories, dual grant, auto-hotbar,
  `rewardGranted` + announcer + toast, `completeQuest`.

### Phase 3 — Shard one, the tinker

- The gated `PricedOption` on `TINKER` in
  `src/systems/market/vendorDefs.ts` and its purchase hook (§5.3).

### Phase 4 — Shard two, Hilda's repairs

- `src/map/tiles/interiorTiles.ts` — the three `BROKEN_*` tile types, plus
  registration in **both** `DECORATION_TYPES` (`src/map/TileRenderer.ts`) and
  `DECORATION_OVERLAY_TYPES` (`src/map/GameMap.ts`).
- `src/creatures/Townsperson.ts` — the `markerType` field and its glyph, drawn
  through the shared `questMarkerColorFor` helper.
- Interior-side half of `AnchorQuestSystem` (or a sibling system constructed by
  `BuildingInteriorScene`): tile rewrite on entry, Hilda's dialog intercept
  ahead of her `reading` service, the wood pile, the highlight, the `R` repair
  interaction, the repaired count.

### Phase 5 — Shard three, the temple vermin

- `src/creatures/ShrineVermin.ts` — the fleeing `Rat` subclass (§5.5),
  including the explicit facing write and the walkable clamp.
- Spawn on step start into the room's existing `MobRoster`; count deaths off
  the roster; Aviel's marker and dialog intercept ahead of the blessing menu.

### Phase 6 — RecallSystem

- New `src/systems/RecallSystem.ts` implementing `GameSystem`
  (`src/systems/GameSystem.ts`): owns channel state (frames, mode, caster),
  cooldown frames, and the trail anchor. Constructed with `gameMap`, the gate
  callbacks (`hasNearbyEnemy`, `bossRoom.anyLocked` access) and a
  party-teleport callback owned by the scene — the scene keeps the position
  writes and the Mongo/merc dismissal, since it owns those objects (per the
  add-system dependency style).
- Update order: with the other pre-movement gameplay systems in
  `DungeonScene.updateGameplay` — channel progress must tick before movement so
  a move-cancel is read the same frame.
- Hotbar branch in `triggerHotbarActivation` (`src/scenes/DungeonScene.ts`),
  after the `scroll_of_confusing_fog` branch: toggle start/cancel.
- Checkpoint contract: `captureCheckpoint`/`restoreCheckpoint` like
  `StairwellSystem` (`src/systems/StairwellSystem.ts`), wired into the
  world-checkpoint set (`captureWorldCheckpoint`/`restoreWorldCheckpoint` in
  `src/scenes/DungeonScene.ts` / the `WorldCheckpoint` interface in
  `src/core/WorldCheckpoint.ts`). Restore clears any live channel and the
  anchor; cooldown restores to its captured value (respawn already teleports
  you — a free cooldown reset would be a death-powered shortcut).

### Phase 7 — Teleport execution and feedback

- Party-warp helper in `DungeonScene` refactored out of the `!bounty go` block
  (`runBountyWarpCheat` and `findWarpLandingTile` in
  `src/scenes/DungeonScene.ts`) so cheat and stone share one landing-search +
  position-write path instead of a copy.
- Mongo/merc dismissal calls (precedent: the `BuildingSystem` entry callback),
  cooldown wiring into `abilityCooldowns` (the calls in `DungeonScene.render`
  - the `item.abilityId` lookup widening in `InventoryPanel.renderSlot`),
    channel bar + labels + arrow + sounds per §6.
- Emit a bus event (`src/core/EventBus.ts` `GameEvents`) such as
  `fastTravelUsed` for the AI adapter and future achievements.

### Phase 8 — Discovery content

- Mordecai advice objectives for the questline, for the stone and for Speed Fizz
  (`src/systems/mordecaiAdvice.ts`), completion flags fed from the scene's
  snapshot builder.
- Quest dialog copy for all four conversations; `ITEM_DEF` description final
  wording for the stone and the shards.

### Phase 9 — Verification

- `npm run typecheck`, `npm run lint`, `npm run format` — both gates must exit 0.
- Headless sanity via `?playtest` floor-3 presets. Questline: accept at the
  seer → assert three tracker entries; buy the tinker's shard → assert its row
  disappears; enter the cottage → assert three `BROKEN_*` tiles, repair one →
  assert it is intact on re-entry; enter the temple → assert three vermin spawn
  and that each one's distance from the player is non-decreasing while it lives.
  Stone: use in wilderness → assert player tile ≈ `townSquareCentre`; use again
  in town → assert back at anchor; assert cooldown refusal in between. (Browser
  automation can drive input; only timing feel needs a human.)
- Confirm the service worker is unregistered before any browser check (stale
  bundle trap).

## 8. Known traps this plan already routes around

- **`mobGrid.move`** — never move a `Mob` without it; the plan moves no mobs
  (Mongo/mercs are dismissed through their own systems, which do the grid
  bookkeeping). The crawlers are not in `mobGrid` at all.
- **Walkable is not spawnable** — all landing tiles go through
  `hasRoomToMove` ring search, never bare `isWalkable`.
- **Checkpoint restore runs on the living** — RecallSystem's restore only
  touches its own state; the anchor is deliberately dropped.
- **Scene.loop runs two updates per callback** — channel timing counts frames
  in `update`, renders read state; no per-render timers.
- **Canvas size reads** — all UI geometry via `viewportWidth()`/
  `viewportHeight()` like `StairwellSystem` (`src/systems/StairwellSystem.ts`).
- **Two decoration registries** — the `BROKEN_*` tiles go in `DECORATION_TYPES`
  **and** `DECORATION_OVERLAY_TYPES`, or they render as bare floor.
- **Interiors are rebuilt on every entry** — nothing about the questline may
  live on `BuildingInteriorScene` or on a `Townsperson`; it lives in
  `AnchorQuestProgress` (§5.1).
- **Mobs stop facing nothing** — a fleeing vermin that stops must write its own
  facing.
- **Decoration art must fit its blocked tiles** — a splintered table that
  overhangs its tile lets the player stand inside it; the broken art stays
  inside the intact piece's footprint.
- **Two inventories, one party** — every shard check sums human and cat.

## 9. Deferred: the mount (what it would actually take)

If playtests still want raw overland speed after the stone ships: (a) art —
a rideable creature sheet plus rider-composited rows for human and cat, 3
views each, on the generated-sprite pipeline, with the gait-cadence and
animation-Nyquist traps audited at the target speed; (b) a mounted state on
`Player` feeding a third factor into the `speedMultiplier` getter
(`src/Player.ts`) so it composes with Speed Fizz instead of fighting it; (c)
rules for combat, wading (`WADE_SPEED_FACTOR`), building entry, and the town
safe zone; (d) companion speed — `FOLLOWER_SPEED = 3.5`
(`src/core/constants.ts`) must scale or the party splits. None of this is
prohibitive, but every line of it is new, and none of it shortens the town
round trip as much as the stone does.

## 10. Notes for Ryan's playtest

- Is the questline the right length — three stops before fast travel, or one
  stop too many when you are impatient to explore?
- Are `ANCHOR_SHARD_PRICE_COINS = 20` and `ANCHOR_ASSEMBLY_FEE_COINS = 25`
  pocket change at the point a player reaches floor 3, or a real wall?
- Does the reward strip on the offer page make the stone worth the errand
  before the errand starts?
- Is the broken furniture legible as broken at 32 px without the glow, and does
  the glow read as "you can fix this now" rather than as loot?
- Do fleeing vermin feel like a chore in an 18×18 room? Tune their speed, or
  give them a panic burst when struck.
- Does Hilda's exclamation-then-question marker actually stop players from
  walking straight past her to the wood pile?
- Does the 60 s cooldown / 3 s channel feel like a travel tool rather
  than a combat escape? Tune `RECALL_COOLDOWN_FRAMES` /
  `RECALL_CHANNEL_FRAMES`.
- Is the two-mode behaviour instantly clear from the grant dialog and
  the channel labels, without reading the item description?
- Return-leg danger: landing on your trail anchor can put you next to
  wandered mobs. Fair surprise or needs a landing-safety search radius?
- Does dismissing Mongo/mercenaries on fast travel feel acceptable, or
  should they re-summon free on arrival?
- Downed-companion case: the party teleports with the companion still
  downed — confirm that reads correctly at the destination.
- Is the 7-tile enemies-nearby block too strict or too lax on a camp's
  edge?
- After the stone ships, is overland traversal still slow enough to
  justify the §9 mount (or a cheaper road-speed bonus)?
- Do the reused sounds (`confusing_fog`, `speed_fizz`) carry the warp,
  or does it need bespoke audio?

## 11. Progress log

_(empty — filled in as phases land)_
