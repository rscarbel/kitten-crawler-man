# Universal scene systems

Playtest feedback on building interiors: almost nothing works. Players can't
allocate skill points, can't attack, destructible objects don't behave, and
it's unclear what does and doesn't function. Players want buildings to support
the same things the dungeon does: combat, destructible materials, all menus,
and chat.

The root cause is structural, not a list of missing `if`s: `DungeonScene`
hand-constructs ~60 systems as private fields and hand-orders their updates,
and `BuildingInteriorScene` re-implements a small, divergent subset by hand.
Every facility a building lacks is a facility someone would have had to
re-wire a third way. This plan restructures the wiring so a scene opts into
**typed system bundles ("kits")** — combat, destruction, input/menus, chat —
and a new environment gets "everything the dungeon has" by constructing kits
rather than by transplanting five thousand lines.

Ground rules from CLAUDE.md apply throughout: no `as` casts, no `!`, no
`any`, no magic numbers, no backward-compat shims — call sites are updated
directly when a function moves.

---

## 1. How scenes wire systems today (measured from the code)

### 1.1 The dungeon side

- `DungeonScene` (`src/scenes/DungeonScene.ts`, 5,923 lines) declares every
  system as a private field (the block running from the `miniMap` field
  through the `tutorial` field) and constructs them with explicit deps in its
  constructor. Overworld-only systems are nullable fields built behind
  `levelDef.isOverworld` (the `destructibles`/`trees`/`water` assignments,
  and the town-only block in the constructor that builds `building`,
  `townProps`, `townDecor`, `townLife`, and `bounty`).
- All EventBus wiring (gore, loot routing, achievements, checkpoint capture)
  lives in the `wireEventBus` method, called once from the constructor; the
  scene owns one bus (the `bus` field) and clears it on exit (the
  `this.bus.clear()` call in `onExit`).
- Keyboard input is bound in `onEnter` through the
  `this.inputHandler.bind({...})` call (handler class: `DungeonInputHandler`
  in `src/systems/DungeonInputHandler.ts`), which owns Esc-chain, Tab, Space,
  `q`, `i`, `g`, `f`, `m`, `r`, Enter (chat), and hotbar keys 1–8 (all inside
  `DungeonInputHandler.bind`'s `actionHandler`).
- Frame order is explicit in `updateGameplay()`, documented as 9 named phases
  in the JSDoc above `src/systems/GameLoopPhases.ts` (`readMovement` →
  `applyMovement` → `updateSafeRoom` → `updateSystems` → `updateMobAI` →
  `resolveCombat` → `postCombat` → `tickTimers` → `checkDeath`). The
  per-frame `SystemContext` is a reused field refreshed by
  `buildSystemContext()`.
- Rendering goes through the `RenderPipeline` class
  (`src/systems/RenderPipeline.ts`) fed by the `RenderContext` type (same
  file) that names ~25 live system instances (the `rc: RenderContext` object
  literal built in `DungeonScene.render`).
- Click routing is a hand-ordered early-return chain in `handleClick`, and
  Space/keyboard suppression reads a declarative **overlay claim registry**
  (the `overlayClaims` getter) — the one piece of this scene that is already
  the right shape for reuse.

### 1.2 The building side

`BuildingInteriorScene` (`src/scenes/BuildingInteriorScene.ts`, 2,131 lines)
builds its own world per entry: a fresh interior `GameMap` per building (and
per tower floor) in the constructor's tower/single-map branch, players
restored from `PlayerSnapshot`s (the `restorePlayer(this.human, humanSnap)` /
`restorePlayer(this.cat, catSnap)` calls in the constructor), and
per-building-type systems:

- `SafeRoomSystem`/`BopcaSystem` only in restaurants (the
  `entry.type === 'restaurant'` branches in the constructor), `ShopSystem`
  only in stores (the `this.shop = entry.type === 'store' ? ... : null`
  assignment), `DesperadoClubSystem` only in the club (the
  `this.club = entry.type === 'club' ? ... : null` assignment),
  `TowerStairSystem` in towers (the `if (isTower)` block constructing
  `this.towerStairs`), `InteriorOccupantSystem`/`AmbientSoundSystem`/
  `PricedMenuPanel` (the `occupants`/`ambientSound`/`servicePanel`
  assignments at the end of the constructor).
- **Combat exists only as a quest-encounter special case**: the `InteriorCombat`
  interface is built by `createCombatStack` and only for the Big Top fight,
  the cult hideout (both via `initEntryEncounter`), and the tower-top
  confrontation (`maybeStartTowerConfrontation`). Everywhere else `this.combat`
  is null, and `updateCombat()` — the only place Space triggers an attack (its
  `if (this.input.has(' ')) { ...; triggerPlayerAttack(...) }` block) — never
  runs.
- It owns **three** EventBuses: `skillBus` (a field, wired to audio via
  `this.audio?.wireEvents(this.skillBus)` in the constructor), `bopcaBus` (a
  field, wired to audio in the restaurant branch of the constructor), and the
  combat stack's own bus (`const bus = new EventBus()` in
  `createCombatStack`), versus the dungeon's one.
- Input is a bespoke `escHandler` (assigned in `onEnter`) handling only Tab,
  `m`, `f`, and the Escape chain. Click routing (`handleClick`) knows only
  the interior's own modals and then **stops** — by design it "never routes
  clicks to the inventory panel" (per the comment in `handleTouchStart`
  about the mobile long-press context menu).

### 1.3 The gap, symptom by symptom

| Playtest symptom            | Dungeon wiring                                                                                                                                                                                                                                                                                                                                                                                     | Building wiring                                                                                                                                                                                                                                                                                                       | Why it fails indoors                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Can't attack                | Space → `triggerSpaceAction` → the `triggerPlayerAttack` call in `triggerSpaceAction` (`DungeonScene.ts`)                                                                                                                                                                                                                                                                                          | Attack only inside `updateCombat` (`BuildingInteriorScene.ts`), gated on `this.currentFloor === this.combat?.floor`                                                                                                                                                                                                   | `initEntryEncounter` returns null for every non-quest building             |
| Can't allocate skill points | Unspent-points banner click opens `pauseMenu.openToSpend()` (in `handleClick`); `toggleGear` toggles gear (in `inputHandler.bind`'s callbacks); pause menu rendered with achievements, gameStats, abilityManager, mouse (the `this.pauseMenu.render(...)` call in `render`)                                                                                                                        | `renderHUD` sets `_hudSkillBannerRect` (`GameplayScene.ts`) but no click path ever tests it; `handleClick` has no banner/gear/inventory routing; pause menu rendered as `render(ctx, human, cat)` only (there is no equivalent call site — `BuildingInteriorScene` has no `InventoryPanel`/`GearPanel` fields at all) | The spend entry points don't exist, and the pause menu is a stripped shell |
| Destructibles don't behave  | `DestructiblePropSystem` built per floor (the `this.destructibles = levelDef.isOverworld ? null : new DestructiblePropSystem(...)` assignment in the constructor), threaded into melee via `CombatContext.destructibles` (the `destructibles` field of the `combatCtx: CombatContext` object literal in `updateGameplay`) and ticked (the `this.destructibles?.update()` call in `updateGameplay`) | Interiors **do** place `BARREL`/`CRATE` tiles (in `GameMap.generateInterior`, e.g. the store branch and the barracks branch) but no `DestructiblePropSystem` is ever constructed                                                                                                                                      | Props render as scenery with no HP, no wreckage, no loot                   |
| No chat                     | `PlayerChatSystem` field (`playerChat` on `DungeonScene`), the `openChat` binding in `inputHandler.bind`, the `this.playerChat.update()` call in `update`, the `this.playerChat.renderBubble(...)` call in `render`                                                                                                                                                                                | Absent entirely                                                                                                                                                                                                                                                                                                       | —                                                                          |
| Menus/hotbar unclear        | 1–8, `q`, `i`, `g` keys (`DungeonInputHandler.bind`'s `actionHandler`); hotbar abilities incl. shell/missile/smush (`triggerHotbarActivation` on `DungeonScene`)                                                                                                                                                                                                                                   | `triggerHotbarActivation` on `BuildingInteriorScene` handles only health potions and skill books, reachable only from mobile taps; no number keys, no `q`, no ability triggers (no `SpellSystem` outside encounters)                                                                                                  | Desktop players have no working hotbar at all indoors                      |
| Loot                        | `LootSystem` + floor drops + pickup click (the `this.loot` field, the `this.loot.update(ctx)` call in `updateGameplay`, and the `this.loot.tryCollectLootAt(...)` call in `handleClick`)                                                                                                                                                                                                           | Kill loot routed straight into the killer's purse (in `createCombatStack`'s `mobKilled` handler); no ground loot                                                                                                                                                                                                      | Works, but by a third code path                                            |

Supporting systems that exist in both scenes today are _near_-duplicates, not
shared: gore/body-part gore wiring (the `spawnGore`/`mobKilled` handlers in
`DungeonScene.wireEventBus` vs the same handlers in
`BuildingInteriorScene.createCombatStack`), skill-book flow hosts
(`skillBookFlowHost` on `DungeonScene` vs `skillBookFlowHost` on
`BuildingInteriorScene`), death screens, follower menus (the
`followerMenu.onFollowMe`/`onDoNotMove`/`onSetAggressive`/`onSetPassive`
callbacks assigned in the `DungeonScene` constructor vs the same callbacks
assigned in `BuildingInteriorScene.wireFollowerMenu`), Mongo regen (the
`tickMongoRegen` call in `BuildingInteriorScene.update`, whose neighboring
comment notes that `DungeonScene` runs its own regen inside
`updateGameplay`). Each pair has already drifted.

---

## 2. The dependency graph

From a full sweep of `src/systems/` (constructor signatures verified per
file):

**Tier 0 — no constructor deps** (safe anywhere): `SpellSystem`,
`GoreSystem`, `MobUpdateLoop`, `PlayerTickSystem`, `FloatingCombatTextSystem`,
`SmushEffectSystem`, `PlayerChatSystem` (though `open()` needs the canvas —
`open(canvas, onSubmit)`), `TreasureChestSystem`, `MobileHUDSystem`,
`BossIntroSystem`.

**Tier 1 — GameMap only**: `BodyPartGoreSystem`, `LootSystem`, all six
projectile/hazard systems (`LavaBallSystem`, `RockThrowSystem`,
`SkeletonProjectileSystem`, `GoblinArrowSystem`, `KnightMissileSystem`,
`ClownGasSystem`), `BarrierSystem`, `WaterAnimationSystem`, `MiniMapSystem`
(its constructor allocates an `OffscreenCanvas` and throws without a 2D
context), `TownLifeSystem`, `CompanionSystem` (map + spawn tile + stance).

**Tier 2 — GameMap + another system**: `DestructiblePropSystem` needs
`LootSystem`; `TreeSystem` needs `LootSystem` plus a minimap-invalidation
callback; `DynamiteSystem` needs destructibles and trees, both nullable;
`BossRoomSystem` needs `MiniMapSystem`.

**Tier 3 — bus + `addMob` spawn callback**: `SkeletonSummonSystem`,
`DefendQuestSystem`, `SpiderQuestSystem`, `CircusQuestSystem`,
`MurderMysteryQuestSystem`, `BountySystem`, `ArenaSystem` (bus + getMobs +
addMob + `BossRoomSystem`), and the interior encounters `BigTopBossSystem`,
`CultHideoutSystem`, `QuillConfrontationSystem`.

**Cross-cutting facts the design must respect:**

1. `CombatSystem` is not a class — `resolvePlayerAttacks`/`resolveKills` are
   pure functions over the `CombatContext` type (all in
   `src/systems/CombatSystem.ts`) that names `safeRoom | null`, `bus`,
   `abilityManager`, `spells`, and optional `destructibles`/`trees`/`smushFx`.
   Both scenes already build one (the `combatCtx: CombatContext` object
   literal in `DungeonScene.updateGameplay`, and the same in
   `BuildingInteriorScene.updateCombat`).
2. The `addMob` closure `{ mobs.push; mobGrid.insert; mob.setSpells }` is
   duplicated eight times in the dungeon constructor alone (passed to `new
DefendQuestSystem`, `new SpiderQuestSystem`, `new ArenaSystem`, `new
SkeletonSummonSystem`, `new BountySystem`, `new CircusQuestSystem`, and
   `new MurderMysteryQuestSystem`, plus the `spawnMob` closure in
   `createAISceneContext`; that eighth one is called from the constructor via
   `aiAdapter.bindScene(this.createAISceneContext(), this.bus)` but omits
   `mob.setSpells`); plus the interior's own `addMob` closure in
   `BuildingInteriorScene.createCombatStack`.
3. Update signatures are not uniform: `TreasureChestSystem.update(mobs)`,
   `DesperadoClubSystem.update(active, companion)`, `MongoSystem.update(ctx):
boolean`, `SoulCrystalSystem.update(human, cat, active, isOnCrystalFloor)`,
   zero-arg updates on GoreSystem and friends. A homogeneous `GameSystem[]`
   loop would need casts — so the design must not be one.
4. Constructor side effects exist: `BigTopBossSystem` spawns mobs, emits
   `bossFightInitiated`, and starts music in its constructor;
   `QuillConfrontationSystem` and `CultHideoutSystem` likewise;
   `ArenaSystem` subscribes to the bus in its constructor (the
   `this.wireEvents()` call) with **no dispose** (the class declares no
   `dispose` method at all) and is only safe because the owning scene clears
   the whole bus on exit (`this.bus.clear()` in `DungeonScene.onExit`).
5. Module-level mutable state: `MobUpdateLoop`'s pack-alert grid must be
   dropped on teardown (the `setPackAlertGrid(null)` call in
   `MobUpdateLoop.dispose`; both scenes do — `DungeonScene.onExit`'s
   `this.mobLoop.dispose()` call, `BuildingInteriorScene.onExit`'s
   `this.combat?.mobLoop.dispose()` call); `DefendQuestSystem` and
   `SpiderQuestSystem` hold cross-scene tutorial latches; the
   `cachedVignette`/`cachedVignetteWidth`/`cachedVignetteHeight` module-level
   variables in `src/systems/DungeonUIRenderer.ts` cache a vignette; the
   Button module holds cursor state cleared per scene (the
   `clearButtonMouseState()` calls in `BuildingInteriorScene.onExit` and
   `DungeonScene.handleMouseLeave`).

---

## 3. The kit architecture

New directory `src/systems/kits/`. A **kit** is a plain class (or interface +
factory) whose fields are the concrete system types — no registry keyed by
strings, no `GameSystem[]` soup, no casts. Optionality is expressed at the
scene level as `SomeKit | null`, exactly as `destructibles: … | null` is
today, never as optional members inside a kit.

### 3.1 `SceneWorld` + `MobRoster` — the shared spine

```ts
// src/systems/kits/SceneWorld.ts
export class MobRoster {
  readonly mobs: Mob[] = [];
  readonly grid: SpatialGrid<Mob>;
  constructor(
    private readonly map: GameMap,
    readonly spells: SpellSystem,
  ) {
    this.grid = new SpatialGrid(MOB_GRID_CELL_SIZE);
  }
  /** The one true spawn path: list + grid + spells + map, atomically. */
  add(mob: Mob): void {
    this.mobs.push(mob);
    this.grid.insert(mob);
    mob.setSpells(this.spells);
    mob.setMap(this.map);
  }
}

export interface SceneWorld {
  readonly gameMap: GameMap;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly roster: MobRoster;
}
```

`roster.add` replaces all nine hand-rolled `addMob` closures. (`setMap` is
already called by the level spawners the dungeon uses and by the interior
closure's `mob.setMap(map)` call in `BuildingInteriorScene.createCombatStack`;
calling it uniformly is idempotent and removes the class of bug the
SpiderQuest closure comments about in the `DungeonScene` constructor — the
comment above `if (mob instanceof GrotesqueSpider) this.grotesqueSpiders.push(mob);`
in the `new SpiderQuestSystem(...)` addMob closure.)

**One bus per scene.** `BuildingInteriorScene`'s `skillBus` field and
`bopcaBus` field exist only because the scene had no shared bus outside a
combat stack. With a `SceneWorld` the interior gets a single bus, wired to
audio once (`audio.wireEvents(bus)`, `AudioManager.wireEvents`) and cleared
once in `onExit` — the same contract the dungeon already follows
(`this.bus.clear()` in `DungeonScene.onExit`).

### 3.2 `CombatKit` — combat everywhere

```ts
// src/systems/kits/CombatKit.ts
export interface CombatKitDeps {
  readonly world: SceneWorld;
  readonly abilityManager: AbilityManager;
  /** Narrowed exactly as CombatContext already narrows it (the `safeRoom` field of `CombatContext` in `CombatSystem.ts`). */
  readonly safeRoom: Pick<SafeRoomSystem, 'isEntityInSafeRoom'> | null;
  readonly xpDiminishingTiers: LevelDef['xpDiminishingTiers'];
}

export class CombatKit {
  readonly spells: SpellSystem;
  readonly mobLoop: MobUpdateLoop;
  readonly gore: GoreSystem;
  readonly bodyPartGore: BodyPartGoreSystem;
  readonly floatingText: FloatingCombatTextSystem;
  readonly playerTick: PlayerTickSystem;
  readonly smushFx: SmushEffectSystem;
  readonly deathScreen: DeathScreen;
  // constructor wires bus.on('spawnGore') / the gore half of 'mobKilled'
  // (today duplicated between DungeonScene.wireEventBus and
  // BuildingInteriorScene.createCombatStack)

  /** Phase 4–5 of GameLoopPhases: spells → mobLoop, in that order (the `this.spells.update(ctx)` / `this.mobLoop.update(ctx)` calls in `DungeonScene.updateGameplay`). */
  updateMobs(ctx: SystemContext): void;
  /** Phase 6: builds the CombatContext, runs resolvePlayerAttacks + flushPendingSubMissiles + resolveKills (the `combatCtx` block in `DungeonScene.updateGameplay`). */
  resolveCombat(deps: CombatResolutionExtras): CombatOutcome;
  /** Phase 7: gore, bodyPartGore, smushFx ticks (the `this.gore.update()` through `this.smushFx.update()` calls in `DungeonScene.updateGameplay`). */
  updatePostCombat(): void;
  /** playMobAudioCues + kit-owned pending flags (the `playMobAudioCues` function in `GameLoopPhases.ts`). */
  drainAudioCues(audio: AudioManager | null): void;
  /** Ground layer (puddles, settled parts) and air layer (particles, flying parts, spell overlays) — the two call groups in the `combatOnThisFloor` branch of `BuildingInteriorScene.render`. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number, cat: CatPlayer): void;
  resetForCheckpoint(): void; // fans out to the members' existing resets
  dispose(): void; // floatingText.dispose + mobLoop.dispose (the module grid)
}
```

`CombatOutcome` carries `hitLanded` out so the dungeon's combat-started
telemetry (the `combatCtx.hitLanded` / `combatStarted` block in
`DungeonScene.updateGameplay`) stays in the scene. Interiors construct a
`CombatKit` **unconditionally** — an empty roster costs nothing per frame
(every member is a no-op over empty arrays), and it is what makes
Space-to-attack, ability hotbar slots, and destructible melee work in every
building. The existing `InteriorCombat` interface (in
`BuildingInteriorScene.ts`) dissolves into it; the encounter itself
(`InteriorEncounter`, same file) stays a scene concern handed `world.bus` and
`world.roster.add`.

### 3.3 `DestructionKit` — props, loot, dynamite

```ts
export class DestructionKit {
  readonly loot: LootSystem;
  readonly destructibles: DestructiblePropSystem;
  readonly dynamite: DynamiteSystem;
  constructor(world: SceneWorld, floorNumber: number, trees: TreeSystem | null);
  update(ctx: SystemContext): void;      // loot.update, destructibles.update, dynamite.update (the `this.loot.update(ctx)`, `this.destructibles?.update()`, `this.dynamite.update(ctx)` calls in `DungeonScene.updateGameplay`)
  drainAudioCues(audio: AudioManager | null): void; // smash/pickup/explosion drains (the `drainSmashes` block, the `drainPickups` block, and the `dynamite.explosionSoundPending` block in `DungeonScene.updateGameplay`)
  renderGround/renderEffects(...): void; // wreckage, loot, charge bar
  captureCheckpoint()/restoreCheckpoint(); // delegates to loot + destructibles (existing methods, `LootSystem.captureCheckpoint`/`restoreCheckpoint`, `DestructiblePropSystem.captureCheckpoint`/`restoreCheckpoint`)
}
```

The interior policy difference is one option, not a fork: today interior
kills pay loot straight into the killer's purse (the loot-to-purse block in
`BuildingInteriorScene.createCombatStack`'s `mobKilled` handler) because
nothing indoors can own floor loot. With a real `LootSystem` indoors, smashed
barrels and kills drop normally; `doExit` gains one sweep that pays any
uncollected floor loot into the purse before snapshotting, so leaving a
building can never destroy earned drops (the scene is replaced on exit, the
`this.sceneManager.replace(new BuildingInteriorScene(...))` call in the
`BuildingSystem` entry callback inside the `DungeonScene` constructor).

Note the dungeon currently sets `destructibles = null` **on the overworld**
(the `this.destructibles = levelDef.isOverworld ? null : new
DestructiblePropSystem(...)` assignment in the constructor — "town barrels
and crates are not smashable"). That stays: `DestructionKit` is constructed
by dungeon floors and by interiors, not by the outdoor town.

### 3.4 `MenusKit` + shared input — the "all menus" fix

- **Rename/extend `DungeonInputHandler` → `GameplayInputHandler`** (file move
  within `src/systems/`, call sites updated). It already is scene-agnostic —
  a callback interface (`DungeonInputActions` in `DungeonInputHandler.ts`)
  with zero dungeon imports (the file imports nothing at all).
  `BuildingInteriorScene` replaces its bespoke `escHandler` (assigned in
  `onEnter`) with a `bind()` of the same actions interface, so `i`, `g`, `q`,
  1–8, Enter, Space, Tab, `f`, `m` mean the same thing everywhere. The
  interior's extra Escape targets (exit menu, tower stairs, service panel,
  club modals) become entries in its `dismissDialog` chain.
- **Move the overlay claim registry** (the `OverlayInputClaim` type and the
  `overlayClaims` getter in `DungeonScene.ts`) into
  `src/systems/kits/OverlayClaims.ts`. Each scene contributes its claims;
  `isSuppressed`, `advanceDialog`, and `focusedOverlay` become shared helpers
  over the claim list instead of two hand-maintained boolean chains (the
  interior's is `canOpenFollowerMenu`, plus the early-return ladder at the
  top of `update()`).
- **`MenusKit`** owns what the interior is missing: `InventoryPanel`,
  `GearPanel`, the pause-menu render call with its full argument list
  (achievements, gameStats, abilityManager, mouse — the
  `this.pauseMenu.render(...)` call in `DungeonScene.render`), the
  unspent-points banner hit test (the banner-click block in
  `DungeonScene.handleClick`, tested against `GameplayScene._hudSkillBannerRect`),
  the skill-book/level-up/reward overlays both scenes already duplicate, and
  the shared hotbar activation (potions, skill books, magic missile,
  protective shell, smush — `DungeonScene.triggerHotbarActivation`; abilities
  need `CombatKit.spells`, which is why interiors construct CombatKit first).
  Mobile: interiors keep `MobileHUDSystem` as the container, but its gear and
  bag panels route through the same MenusKit click handlers the dungeon uses
  — that deletes the "this scene never routes clicks to the inventory panel"
  carve-out (the comment in `BuildingInteriorScene.handleTouchStart`).

### 3.5 `ChatKit`

`PlayerChatSystem` plus the command interpreter, extracted from
`triggerOpenChat` (on `DungeonScene`) into a typed command table:

```ts
export interface ChatCommandHost {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly active: () => HumanPlayer | CatPlayer;
  readonly godModeState: GodModeState;
  /** Commands the scene cannot honor are simply not in its table — no stubs. */
}
```

Universal commands (`!god`, `!tough`, `!payday`, `!levelup`) live in the
shared table; dungeon-only ones (`!bounty go`) stay where the systems they
touch live. Enter opens chat in both scenes via `GameplayInputHandler`; the
bubble render call (the `this.playerChat.renderBubble(...)` call in
`DungeonScene.render`) moves into both scenes' render paths.

### 3.6 What stays scene-owned

- **Floor structure**: `BossRoomSystem`, `StairwellSystem`, `BarrierSystem`,
  `JuicerRoomSystem`, `ArenaRoomSystem`, `ArenaSystem`, `MiniMapSystem`,
  quest systems, town systems, `TreeSystem`/`WaterAnimationSystem`. These are
  properties of the dungeon/overworld floor, not of "a place with gameplay".
  They may later be grouped into a `FloorKit` for tidiness, but nothing in the
  playtest feedback needs them indoors, and several carry heavy assumptions
  (`BossRoomSystem`'s constructor indexes `gameMap.bossRooms`).
- **RenderPipeline**: the `RenderContext` type names ~25 systems and is the
  single heaviest coupling point. Interiors keep their Y-sorted
  `renderSortedEntities`, now bracketed by `CombatKit.renderGround`/
  `renderEffects` and `DestructionKit` layers. Unifying the two render paths
  is explicitly **out of scope** (§7).
- **Update ordering** stays explicit in each scene. The kits do not hide the
  frame; they collapse the parts of the frame whose order is _internal to the
  kit_ (spells before mobLoop; summons before shots — the
  `skeletonSummons.update`/`skeletonShots.update` ordering comment in
  `DungeonScene.updateGameplay`; attacks before kills) behind phase-named
  methods, and the phase list documented on `GameLoopPhases.ts` remains the
  canonical order those method names map onto. A scene that calls
  `updateMobs → resolveCombat → updatePostCombat` cannot re-derive the
  ordering bug class; a scene that skips a phase does so visibly.

---

## 4. Per-scene state threading

- **Construction-time state.** Every kit takes `SceneWorld` (map, bus,
  roster, audio) at construction. Interiors build one `SceneWorld` per map —
  for towers, per floor, generalizing today's `InteriorCombat.floor` guard
  (the `floor` field of `InteriorCombat`, checked via the
  `this.currentFloor === this.combat?.floor` guard before `updateCombat()`):
  `changeFloor` swaps the active `SceneWorld`+kits the same way it already
  swaps `this.map`. This respects `BodyPartGoreSystem`'s and the projectile
  systems' constructor-bound map.
- **Run-scoped state** keeps flowing exactly as the `DungeonSceneOptions`
  interface documents: `PlayerSnapshot`s across scene swaps
  (`snapPlayer`/`restorePlayer`, interior use in the constructor's
  `restorePlayer` calls and in `doExit`'s `snapPlayer` calls), and
  threaded-by-reference objects (quest progress, club membership, mercenary
  roster, mongo pet state, god mode, companion stance). Kits receive these as
  constructor params; nothing becomes a global.
- **Checkpoints do not change shape.** The safe-room checkpoint is captured
  by the dungeon in the `safeRoomEntered` handler inside `wireEventBus`,
  restored in place by `restoreFromCheckpoint`, and aggregates roughly thirty
  owners through the `WorldCheckpoint` interface (per its own doc comment)
  plus per-mob flags (the `presentAtCheckpoint`/`aliveAtCheckpoint` fields on
  `Mob`). Buildings deliberately drop the checkpoint on entry (the
  `checkpoint: undefined` field, with the rationale in the neighboring
  comment, in the `BuildingSystem` entry callback inside the `DungeonScene`
  constructor), and the restaurant safe room indoors never captures one.
  **Rule for the kits: interior kit instances are ephemeral and never join
  `WorldCheckpoint`.** Everything that must survive a building trip already
  travels in the snapshots and run-scoped refs. Consequence to accept and
  verify: barrels smashed inside a building re-stand on re-entry, because the
  interior map is regenerated per entry (the tower/single-map generation
  branch in the `BuildingInteriorScene` constructor) — consistent with
  occupants and furniture, and cheaper than inventing interior persistence.

---

## 5. Risk register

1. **Update-order coupling.** The dungeon's frame has documented load-bearing
   orderings (summons before shots; world-checkpoint restore last — the
   comment above the `this.restoreWorldCheckpoint(cp.world)` call in
   `restoreFromCheckpoint`; spells before mobLoop). Mitigation: kit phase
   methods encode intra-kit order once; the dungeon migration (Phase 5) is a
   pure re-grouping diffed against the current call sequence line by line.
2. **Bus lifetime.** `ArenaSystem` (its `this.wireEvents()` constructor call)
   and `BountySystem` (its `bus.on('mobKilled', ...)` constructor
   subscription) subscribe in their constructors; safety today is
   `bus.clear()` at scene teardown. The one-bus-per-scene rule must keep that
   invariant — kits never share a bus across scenes, and `SceneWorld`
   teardown clears it exactly once.
3. **Module-level state.** `MobUpdateLoop`'s pack-alert grid pins the whole
   roster if not disposed (the `setPackAlertGrid(null)` call in
   `MobUpdateLoop.dispose`); `CombatKit.dispose` owns that call so no scene
   can forget it. Button cursor state and the `DungeonUIRenderer` vignette
   cache (the `cachedVignette`/`cachedVignetteWidth`/`cachedVignetteHeight`
   module-level variables) are per-frame/size-keyed and safe, but the
   interior's `clearButtonMouseState()` on exit (in
   `BuildingInteriorScene.onExit`) must survive the refactor.
4. **Status-effect kills leaking the roster** (pre-existing) was originally
   flagged here as fixed only for the Ball of Swine. It has since been fixed
   generally, in `resolveKills` (`CombatSystem.ts`): a mob with an empty
   damage ledger (killed by burn/poison/sepsis, or killed outright by another
   system) no longer skips its `mobKilled` event, gore, and corpse marker —
   only the XP split is conditioned on somebody having dealt damage. This
   item is resolved; bringing full combat indoors no longer widens exposure
   to it. (See `Mob.takeDamage` and `resolveKills` for the two-sided fix.)
5. **Companion combat indoors.** Buildings currently use `CompanionSystem`
   as a state store only — its combat/pathing update is deliberately never
   ticked (per the comment above the `this.companion = new
CompanionSystem(...)` assignment in the `BuildingInteriorScene`
   constructor). Turning on universal combat raises the question of the
   companion fighting indoors. Phase 2 keeps the simple follow
   (`applyCompanionFollow` on `GameplayScene`) and does _not_ tick
   `CompanionSystem.update` indoors; the companion defends itself via the
   same attack triggers as today's encounter interiors. Revisit only if the
   [HUMAN] playtest wants aggressive-stance companions in buildings.
6. **Non-uniform `update` signatures** (§2 fact 3) — the design avoids a
   homogeneous loop entirely; any reviewer seeing a proposed
   `systems: GameSystem[]` in implementation should treat it as a design
   violation, because it can only be reached through casts.
7. **Constructor side effects** (`BigTopBossSystem`'s constructor and peers)
   mean kit construction order in interiors must keep encounter construction
   _after_ audio and bus wiring, as `createCombatStack` does today.
8. **`SystemContext.bossRoom` is optional** (in `GameSystem.ts`, documented
   "absent in scenes without boss rooms (e.g. building interiors)") and
   `MobUpdateLoop` already handles its absence — interiors keep omitting it.
   No new optionals should be added to `SystemContext` without the same
   "absent in scenes without X" doc contract.
9. **Small-room AI.** `requiresEvasion` bypasses `AI_RADIUS_TILES` and runs
   AI from load; in a 18×14 interior every mob is always in radius anyway, so
   spawned encounter mobs are unaffected — but any future ambient hostile
   indoors ticks its AI every frame from entry. Acceptable at interior mob
   counts; noted so nobody "optimizes" it blind.
10. **Memory.** Kits add no sprite residency (sheets load per creature
    spawned, and interiors already prewarm only the `town` group, via the
    `void prewarmGroups(['town']).then(...)` call in the
    `BuildingInteriorScene` constructor), which matters against the ~1.3 GB
    renderer footprint.

---

## 6. Phases

Buildings adopt the kits first; the dungeon migrates last, as a re-grouping
with no behavior change. Every phase ends green on `npm run typecheck` and
`npm run lint`, plus `npm run format`.

### Phase 1 — Spine: `SceneWorld` + `MobRoster` + one bus per scene

- [ ] Add `src/systems/kits/SceneWorld.ts` (`MobRoster`, `SceneWorld`).
- [ ] Replace the nine `addMob` closures (the ones passed to `new
DefendQuestSystem`, `new SpiderQuestSystem`, `new ArenaSystem`, `new
SkeletonSummonSystem`, `new BountySystem`, `new CircusQuestSystem`, and
      `new MurderMysteryQuestSystem` in the `DungeonScene` constructor, plus
      the addMob closure in `BuildingInteriorScene.createCombatStack`) with
      `world.roster.add` — call sites updated directly, no wrapper shims.
- [ ] Collapse `BuildingInteriorScene`'s `skillBus`/`bopcaBus` fields into
      one scene bus, wired to audio once and cleared in `onExit` (mirroring
      `DungeonScene.onExit`'s `this.bus.clear()`).
- [ ] Verification: gates green; grep proves no remaining
      `mobs.push(...)` outside `MobRoster` and spawn helpers.
- [ ] `[HUMAN]` 10-minute dungeon sanity run (spawns, quest spawns, bounty
      spawn, checkpoint restore) — this phase touches the dungeon's spawn
      plumbing and must show zero behavior change.

### Phase 2 — `CombatKit`: combat in every building

- [ ] Build `CombatKit` per §3.2 by extraction from the dungeon's wiring
      (gore bus handlers, mob/combat/post-combat phases, audio drains,
      death screen).
- [ ] `BuildingInteriorScene` constructs it unconditionally; delete the
      `InteriorCombat` interface and `createCombatStack`; encounters
      (`BigTop`, `CultHideout`, `Quill`) attach to the scene's `SceneWorld`.
- [ ] Space triggers `triggerPlayerAttack` in all interiors (today only
      inside `updateCombat`'s `if (this.input.has(' '))` block,
      encounter-only); mobile tap attack path included.
- [ ] Fix the status-kill roster leak at the `resolveKills` level (risk §5.4)
      so indoor fire/poison kills resolve rewards and removal. (Per the
      updated risk note, this general fix has already shipped — this phase
      only needs to confirm indoor combat exercises the fixed path, not
      re-implement it.)
- [ ] Verification: gates green; `npm run playtest -- swine`-style headless
      check if feasible for one interior encounter (Big Top) proving the
      refactored stack still kills/loots/gores identically.
- [ ] `[HUMAN]` Big Top fight, cult hideout, and tower confrontation each
      replayed end to end — no regressions in the three encounters that
      already worked.
- [ ] `[HUMAN]` In a plain house/tavern: attack swings work, hitting nothing
      feels harmless, no stray HP bars or projectile artifacts.

### Phase 3 — `DestructionKit`: barrels, crates, loot, dynamite indoors

- [ ] Build `DestructionKit` per §3.3; interiors construct it (dungeon floors
      migrate in Phase 5; outdoor town stays without one, per the
      `this.destructibles = levelDef.isOverworld ? null : ...` assignment).
- [ ] Thread `destructibles` into the interior `CombatContext` (the
      `combatCtx` object literal in `BuildingInteriorScene.updateCombat`
      today omits it) and into hotbar dynamite.
- [ ] `doExit` loot sweep: uncollected floor loot pays into the active
      player's purse before `snapPlayer`.
- [ ] Loot pickup click routing indoors (mirror the
      `this.loot.tryCollectLootAt(...)` call in `DungeonScene.handleClick`).
- [ ] Verification: gates green.
- [ ] `[HUMAN]` Smash the store's barrels (placed in the store branch of
      `GameMap.generateInterior`): HP, wreckage, drops, pickup, smash audio
      all present; exit and re-enter — props re-stand (accepted §4 behavior)
      and no loot is lost on exit.
- [ ] `[HUMAN]` Dynamite indoors: blast radius respects interior walls, no
      crash where the map has no trees.

### Phase 4 — Input + `MenusKit`: keys, panels, skill points

- [ ] Rename `DungeonInputHandler` → `GameplayInputHandler`; call sites
      updated (the `inputHandler` field, the `this.inputHandler.bind({...})`
      call in `onEnter`, and the `this.inputHandler.unbind()` call in
      `onExit`).
- [ ] `BuildingInteriorScene` deletes its `escHandler` (assigned in
      `onEnter`) and binds the shared handler; its extra dismiss targets
      (exit menu, tower stairs, club modals, service panel) join its
      `dismissDialog` chain.
- [ ] Extract `OverlayClaims` (from the `overlayClaims` getter in
      `DungeonScene.ts`); both scenes compose claim lists; interior's boolean
      ladders (`canOpenFollowerMenu` and the early-return ladder at the top
      of `update()`) are rebuilt on top of it.
- [ ] `MenusKit`: inventory + gear panels with full desktop click/drag
      routing indoors, pause menu rendered with its full argument list
      (parity with the `this.pauseMenu.render(...)` call in
      `DungeonScene.render`), unspent-points banner hit test wired (parity
      with the banner-click block in `DungeonScene.handleClick`), shared
      `triggerHotbarActivation` covering potions, skill books, and abilities
      (parity with `DungeonScene.triggerHotbarActivation`); interior's
      stripped copy (`BuildingInteriorScene.triggerHotbarActivation`)
      deleted.
- [ ] Verification: gates green.
- [ ] `[HUMAN]` Inside a tavern: press `g`, spend a skill point; press `i`,
      drag an item to the hotbar; press `3` to drink a potion; Esc chain
      closes things in the right order; nothing double-fires under the
      service panel.
- [ ] `[HUMAN]` Mobile: bag/gear panels open, drag works, skill badge tap
      opens Spend — in a building.

### Phase 5 — `ChatKit` + dungeon migration

- [ ] Extract the chat command table from `triggerOpenChat` (on
      `DungeonScene`); Enter opens chat in interiors; bubble renders in the
      interior render path.
- [ ] Migrate `DungeonScene` onto `CombatKit`/`DestructionKit`/`MenusKit`/
      `ChatKit`: `updateGameplay` calls kit phase methods; the duplicated
      wiring blocks (gore bus handlers in `wireEventBus`, combat resolution
      in `updateGameplay`, audio drains, skill-book host
      `skillBookFlowHost`) are deleted, not shadowed.
- [ ] `restoreFromCheckpoint`'s reset fan-out (the `resetForCheckpoint()`
      calls between `rewindMobsToCheckpoint()` and `restoreWorldCheckpoint`)
      routes through `CombatKit.resetForCheckpoint`/`DestructionKit`
      equivalents; `WorldCheckpoint` field list is unchanged.
- [ ] Verification: gates green; `npm run verify:progression`,
      `verify:bounty`, `verify:difficulty`, `verify:separation`,
      `verify:assets` all pass; diff review confirms `updateGameplay`'s call
      order is the same sequence re-grouped.
- [ ] `[HUMAN]` Full dungeon regression pass: floor 1 clear incl. Hoarder,
      a safe-room checkpoint death-restore (mobs revive, chests re-lock,
      loot rewinds), stairwell transition, dynamite + destructibles on
      floor 1, chat commands.
- [ ] `[HUMAN]` Overworld pass: town systems, building enter/exit round trip
      (snapshots, music persistence via the `this.musicPersistsAcrossExit =
true` assignment in the `BuildingSystem` entry callback, knocked-out
      companion left outside per the `knockedOutCompanionAt` handling in the
      constructor), bounty flow.

### Phase 6 — New-environment proof

The point of the architecture: show a scene gets "everything" by
construction.

- [ ] Pick one currently-inert interior type (e.g. barracks, which already
      generates crates in the barracks branch of `GameMap.generateInterior`)
      and give it an optional hostile spawn via `world.roster.add` — no new
      wiring, only content.
- [ ] Write `docs/`-level doc comment (or extend the `add-system` skill) with
      the recipe: build `SceneWorld`, construct kits, bind
      `GameplayInputHandler`, compose overlay claims — the checklist a future
      scene follows.
- [ ] `[HUMAN]` Fight in that interior with skill spending, hotbar, loot,
      destructibles, and chat all exercised in one session — the original
      playtest complaint, replayed to green.

---

## 7. Deliberately not doing

- **RenderPipeline unification.** The `RenderContext` type wants ~25 systems;
  interiors need four render layers. Forcing interiors through it would mean
  nullable-everything or fake systems — worse typing, not better. Revisit
  only if interiors grow fog-of-war or minimap parity.
- **Checkpoint capture inside buildings.** The dungeon comment on the
  `checkpoint: undefined` field (in the `BuildingSystem` entry callback
  inside the `DungeonScene` constructor) explains why a checkpoint cannot
  cross a scene rebuild that reuses the map: its mob and player references
  belong to the destroyed scene. Interior persistence is a separate design
  (seeded interiors or interior-state snapshots) and nothing in the feedback
  needs it.
- **A generic system registry / plugin loader.** String-keyed registries and
  `GameSystem[]` loops trade the type system away (§2 fact 3). The kit
  fields stay concrete types forever.
- **Merging `InteriorOccupantSystem` with `TownLifeSystem`**, and moving
  floor-structure systems (boss rooms, stairwells, arenas) into a kit —
  possible later tidiness, zero playtest value now.
