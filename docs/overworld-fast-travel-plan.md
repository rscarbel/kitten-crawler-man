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

## 4. Design — Mordecai's Return Stone

One permanent item, `town_recall_stone`, display name **"Mordecai's Return
Stone"**. Non-stackable, `canHotlist: true`, `canDrop: false` (like the tomes,
e.g. the `magic_missile_tome` entry in `ITEM_DEF`, `src/core/ItemDefs.ts` — a
fast-travel key you can lose is a support ticket). Granted once to **each**
crawler so it sits on both hotbars.

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

## 5. Discovery and unlock

Nobody should stumble onto this; it is handed over, named, and pointed at.

1. **Granted on first arrival on floor 3.** In `DungeonScene` setup when
   `levelDef.isOverworld` and neither crawler owns the stone: add one to each
   crawler's inventory and auto-place it on a free hotbar slot. Frame it as
   Mordecai's gift: a `DialogBox` page in his voice ("Take this — the Over City
   is bigger than your legs. Squeeze it anywhere and it brings you to the
   square; squeeze it in the square and it puts you back on your trail."),
   plus `SystemAnnouncer.announce('New item: Mordecai's Return Stone')`
   (`src/ui/SystemAnnouncer.ts`) and a `HotbarToast`. Granting on arrival — not
   from a shop, not from a drop — is what guarantees discovery.
2. **Mordecai keeps teaching it.** Add an advice objective to the floor-3 set
   in `src/systems/mordecaiAdvice.ts` (shape: the `AdviceObjective` interface),
   `complete` once the stone has been used at least once, with pages that
   restate the two modes.
3. **The item explains itself.** The `ITEM_DEF` description states both modes
   and the cooldown in one paragraph — descriptions render in the inventory
   panel where players actually read them.
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

### Phase 1 — Item definition and grant

- `src/core/ItemDefs.ts` — add `'town_recall_stone'` to the `ItemId` union;
  add the `ITEM_DEF` entry (non-stackable, `canHotlist: true`,
  `canDrop: false`, `type: 'consumable'`, description per §5.3).
- `src/ui/InventoryPanel.ts` — icon branch in `renderItemIcon`.
- Grant flow in `DungeonScene` setup (near the level-init blocks in the
  constructor, around the boss-chest/treasure-room setup): overworld floor +
  not owned → grant to both crawlers, auto-hotbar, queue the Mordecai dialog +
  announcer + toast. Ownership check is `inventory.countOf` on both crawlers —
  the item is undroppable, so presence is a reliable "already granted" flag
  that survives save/restore via `PlayerSnapshot`
  (`src/core/PlayerSnapshot.ts`) with no new persistence.
- `src/dev/playtestPresets.ts` — add the stone to the floor-3 presets (idiom:
  the `hotbar`/`bag` array literals on a `PlaytestPreset` such as `HOARDER`) so
  `?playtest` drop-ins can exercise it.

### Phase 2 — RecallSystem

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

### Phase 3 — Teleport execution and feedback

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

### Phase 4 — Discovery content

- Mordecai advice objectives for the stone and for Speed Fizz
  (`src/systems/mordecaiAdvice.ts`), completion flags fed from the scene's
  snapshot builder.
- Grant dialog copy; `ITEM_DEF` description final wording.

### Phase 5 — Verification

- `npm run typecheck`, `npm run lint`, `npm run format` — both gates must exit 0.
- Headless sanity via `?playtest` floor-3 preset: use stone in wilderness →
  assert player tile ≈ `townSquareCentre`; use again in town → assert back at
  anchor; assert cooldown refusal in between. (Browser automation can drive
  input; only timing feel needs a human.)
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
