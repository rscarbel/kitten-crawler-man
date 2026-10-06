---
name: game-architecture
description: Orientation map for the Kitten Crawler Man codebase — scenes, game loop, systems, EventBus, render pipeline, AI bridge. Read before making any nontrivial gameplay change or when unsure where code should live.
---

# Game Architecture

Browser dungeon crawler: TypeScript + one HTML5 Canvas, no framework, bundled by esbuild (`scripts/build.js` → `dist/bundle.js`). Optional Express+SQLite backend (`server/`) for auth/progress. The README's "Project Structure" section is accurate — skim it first.

## Core loop

- Entry: `src/game.ts` → creates `InputManager` + `SceneManager`.
- `SceneManager` (`src/core/Scene.ts`) owns the canvas, attaches all DOM listeners once, and runs a fixed-timestep loop: 60 Hz `update()` via accumulator, `render()` once per rAF. `replace(scene)` calls `onExit`/`onEnter`.
- Scenes: `DungeonScene` (main orchestrator, ~3k lines), `BuildingInteriorScene`, `GameplayScene` (shared camera/HUD/companion logic), `PostSignupScene`. A `Scene` implements `update()` + `render(ctx)` and takes input through its `ui: UiRoot` (see Input). Localhost review scenes extend `PreviewScene`.

## Systems

~30 plain classes in `src/systems/` implementing `GameSystem` (`src/systems/GameSystem.ts`): optional `update(ctx: SystemContext)` + `dispose()`. `SystemContext` carries per-frame shared state (`human, cat, active, roster, gameMap, bossRoom, ...`), where `roster` is the scene's `MobRoster` — `roster.mobs`, `roster.grid`, and `roster.add(mob)` as the one spawn path.

- Systems are fields on `DungeonScene`, constructed in its constructor with explicit deps (`gameMap`, `bus`, `addMob` callbacks).
- `DungeonScene.updateGameplay()` calls each system's `update(ctx)` in an explicit order; `src/systems/GameLoopPhases.ts` documents the 9 named phases.
- Rendering is layered by `src/systems/RenderPipeline.ts`: world → entities (Y-sorted by `entity.y`) → effects → visibility fog. Being in the roster's spatial grid is what gets a mob rendered (`RenderPipeline` draws from `roster.grid.queryRect`), and `roster.add` puts it there — no extra registration. A dead mob leaves the grid unless it declares `rendersWhenDead`.
- Systems don't play audio directly; they set pending flags (e.g. `explosionSoundPending`) that the scene reads and clears.

See the `add-system` skill for the recipe.

### Scene kits

`src/systems/kits/` groups the systems that make a _place_ rather than a _floor_, so a new environment gets them by construction instead of by hand-wiring:

- `SceneWorld.ts` — `MobRoster` (list + spatial grid + the one `add` path) and the `SceneWorld` record (`gameMap`, `bus`, `audio`, `pm`, `roster`). One world per **map**; one bus per **scene**.
- `CombatKit` — spells, mob AI, attack/death resolution, gore, floating numbers, smush, regen, death screen.
- `DestructionKit` — smashable props, floor loot, dynamite.
- `MenusKit` — inventory screen, pause screen, award stack, toasts, potions, skill books; `menus.surfaces(...)` lists the surfaces it mounts.
- `ChatKit` — chat box plus the universal cheat table.
- `hotbarActions.ts` — what pressing slots 1–8 does, for every scene that has them.

Kit fields stay concrete types: `update` signatures are not uniform, so a `GameSystem[]` loop could only be reached through casts. `npm run verify:kits` gates the spine.

`DestructionKit` also owns `GroundPickupSystem` (`src/systems/GroundPickupSystem.ts`): visible world pickups such as a dead cow's burgers, collected all at once by one Space press, carried through door visits and death rewinds.

**Floor-3 kits.** Two more kits hang off `DungeonScene` as one field each, with one-line call sites:

- `GatheringKit` (`src/systems/briarHollow/GatheringKit.ts`) — harvesting any tree or boulder, thralls, the resource HUD and the village's node regrowth. Built on every overworld floor, village or not. It owns exactly one link in the Space chain, after citizen and village talk.
- `BriarHollowKit` (`src/systems/briarHollow/BriarHollowKit.ts`) — Briar Hollow: villagers, the herd, services (`VillageServices`), construction and the siege engines (`ConstructionKit`, held as `defences`), soldiers, the Plea (`VillageQuestSystem`) and its assault, and Fenna's side quest The Borrowed Blueprints (`BlueprintsQuestSystem`, whose parts live in `src/systems/briarHollow/blueprints/`; see `docs/town.md`). Built only when `gameMap.briarHollow` is non-null (every floor-3 world). It is rebuilt on every door visit, so its systems keep nothing durable themselves: they read and write the `BriarHollowState` threaded by reference through both scenes (`src/core/briarHollowState.ts`), the same way `TownMemory` is. Its render hooks (`renderGround`, `renderEntities` merged into the Y-sort, `renderAbove`, `renderHud`), `topBandEntries()`, `surfaces(camera)`, `tryInteract`, quest markers and tracker entries follow the boss-room dressing slots below.

`EmoteEffectSystem` (`src/systems/EmoteEffectSystem.ts`) draws floating emotes (a petted cow's hearts) and is built to take other emote kinds.

### The town

The floor-3 town's systems, and where each rule lives. The durable description is `docs/town.md`.

- **Street:** `TownLifeSystem` runs the crowd, rolled from the world seed and pinned in the figure cache. `TownPropSystem` places the plaza fixtures, `TownDecorSystem` the yard and doorstep dressing, and `MarketSystem` the stalls. All three refuse `doorwayKeepClearTiles` (`src/systems/doorwayKeepClear.ts`), because a connectivity check cannot see a door being sealed. Citizens dispatch by species through `src/creatures/citizenFigure.ts`.
- **Interiors:** layouts are data in `src/map/town/interiors/`, with props from `TOWN_INTERIOR_PROPS`.
  - `InteriorOccupantSystem` seats the room's people.
  - `InteriorPropInteractionSystem` runs examine, search and use; `InteriorReadableSystem` runs paged documents.
  - `TownInteriorPropDestructionSystem` breaks placed props, and `InteriorBreakReactionBarks` voices the reactions.
  - `townInteriorPropFigures.ts` splits walkable ground props from Y-sorted ones.
  - `src/scenes/interiorCamera.ts` frames the room clear of the HUD: `interiorHudOccluders` (`src/scenes/interiorHud.ts`) turns the shared HUD layout (`liveHudLayout`) into occluders for `hudClearView`.
- **Memory:** `TownMemory` (`src/core/TownMemory.ts`) is threaded by reference through both scenes, like `BriarHollowState`: resident talks, cleared rooms and camps, and props that have paid out. `RENAMED_BUILDINGS` migrates old building names in saves.
- **Talk:** `src/dialog/walkAway.ts` is the one walk-away rule. `src/systems/safeRoomSpeaker.ts` decides whether a press in the safe room is for the Bopca or Mordecai.
- **Arrival:** `findPartyArrivalTiles` (`src/map/findWalkableTile.ts`) sets the party down on every arrival. Every gameplay scene, on every floor, arrives behind an `ArrivalLoader` (`src/scenes/ArrivalLoader.ts`, abstract on `GameplayScene`); `src/scenes/floorArrivalLoad.ts` builds its tasks, run by `LoadRunner` (`src/core/LoadRunner.ts`). See `add-level`.

### Boss-room dressing

Each boss room's props, slow ground, hazards and interactables belong to a dressing in `src/systems/bossRooms/`, separate from the boss and from the fight owner (`BossRoomSystem`, `SpiderQuestSystem`, `ArenaSystem`): `HoarderRoomSystem`, `JuicerRoomSystem` (in `src/systems/`), `KrakarenRoomSystem`, `SpiderLabDressing` (owned by `SpiderQuestSystem.labDressing`) and `ColosseumDressingSystem`.

- **Contract** — `BossRoomDressing.ts`: `update`, `renderGround`, `renderEntities`, `renderAbove`, `resetForCheckpoint`, `tryInteract`, the `BossFightHooks` (`onSeal`, `onBossDefeated`, `onFightAborted`), `GroundHazardSource.getHazardEscapeVector`, and `CheckpointedDressing` (`captureCheckpoint`/`restoreCheckpoint`, typed per room). Extend `InertBossRoomDressing` and override only the hooks the room uses.
- **Aggregator** — `BossRoomDressings` holds all five as named fields (not a list, so each checkpoint keeps its type). `buildGauntletRoomDressings` finds gauntlet rooms by boss type, never by index into `gameMap.bossRooms`; `buildColosseumDressing` takes the first arena. It is `BossRoomSystem.fightListener` and one hazard source for companions and mob tactics.
- **Death path** — the scene calls `resetForCheckpoint` then `restoreCheckpoint` (from `WorldCheckpoint.bossRoomDressing`); the restore has the last word. A death is never an `onFightAborted`, which means only "fight ended, party still playing, boss healed".
- **Idempotent defeat** — `replayDefeats` re-sends `onBossDefeated` after every build and load for bosses already dead, so the hook must tolerate repeats.
- **Render slots** (`RenderPipeline`) — `renderGround` right after `bossRoom.renderObjects`; `renderEntities` merged into the Y-sorted pass as prop entries; `renderAbove` in the effects pass, over every body.
- **Ground and sight** — slow ground is a tile type in `src/map/tileSpeed.ts`, applied by `footingSpeedFactor` in `GameLoopPhases.applyMovement`. Low props are in `SIGHT_TRANSPARENT_TILE_TYPES` (`walkability.ts`): `GameMap.hasLineOfSight` sees over them, so steering straight at a point must ask `GameMap.hasWalkableLine` instead. Room hazards that kill carry their own `DamageSource` (`hoarderAvalanche`, `krakarenLiveWire`, `krakarenTankBurst`).
- **Layout** — `bossRoomLayout.ts`: doorway-relative templates (`rotateTemplate`, `stampProps`) and the keep-clear sets `approachLaneTiles` / `spawnClearTiles`.
- **Gates** — `npm run gates:boss-rooms` (`scripts/gates-boss-rooms.ts`, per-room modules in `scripts/bossRooms/`, shared `harness.ts`) checks the tile contract, sheets, and every seed's approach/spawn/reachability, then each room's own gates; `--room=<name>` narrows it and `--fault=<name>` must turn it red. `npm run render:boss-rooms` bakes review images.

### Cross-cutting getters

Two seams cut across the quest systems instead of living in one owner, because
three of the five questlines keep a `QuestManager` privately and the other two have
none at all — centralising the state would mean rewriting all five.

- `questMarkers` — minimap pips, gathered by `DungeonScene.collectQuestMarkers()`.
- `trackerEntries()` — Quest Journal rows, the `TrackerSource` interface in
  `src/systems/questTracker.ts`, gathered by `DungeonScene.collectTrackerEntries()`.

Both are rebuilt from the system's own phase machine every frame and stored
nowhere, so neither can go stale. See `add-quest`.

## Entity hierarchy

`Player` (`src/Player.ts`, abstract: position, HP, stats, status effects, walk animation) → `HumanPlayer`, `CatPlayer`, and `Mob` (`src/creatures/Mob.ts`, abstract: aggro, A* pathfinding, LOS, health bar, loot). All enemies extend `Mob`. See the `add-creature` skill.

**Crawler progress.** Combat skills live in `SkillManager` and spells in `AbilityManager`. The craft skills (Resourcing, Construction) are per crawler: `Player.craftSkills` (`src/core/CraftSkills.ts`), saved in `PlayerSnapshot`; `teachBoth` teaches both crawlers at once, and every perk reads the acting crawler's own level. Tool tiers are shared: `PartyTools` (`src/core/PartyTools.ts`) swaps both crawlers' tool items in place, and it lives with the explainer flags in `partyCrafts` (`GameProgress.crafts`). `src/core/partyResources.ts` counts and spends a resource across both inventories.

### Companions and hirelings

Mongo (`MongoSystem`) and the Meat Shields hirelings (`MercenarySystem`) are `Mob`s on the party's side, handed to hostiles through `ctx.extraTargets` and crediting their kills to their owner. A hireling is a shell (`Mercenary`) plus a kit (`src/creatures/mercenaries/`), drawn through `MERCENARY_ART` and voiced through `MERCENARY_VOICES`; its shots fly in `RockThrowSystem` and `HirelingBoltSystem`. Both companions follow the party everywhere, including indoors: `BuildingInteriorScene` owns its own `MongoSystem` and `MercenarySystem` instances the same way `DungeonScene` does. No door opens while the crawler not being driven is knocked out (`downedPartnerEntryRefusal` in `BuildingSystem.ts`, read by `DungeonScene.sealedBuildingMessage`), so a crawler is never left bleeding out outside; one can still go down indoors. A door dismisses whichever companions are out and the scene on the far side rebuilds them fresh — a hire from the roster's saved HP, Mongo via `mongoWasOut` into `MongoSystem.carryIn`. `src/systems/companionCarry.ts` is narrower: it moves companions that are already out between rosters of the same building, on a tower's `changeFloor` and when a script resets the party to its marks, beside the crawler they follow. See the `add-creature` skill.

### Carl's animation

`HumanPlayer` never chooses a row itself; four modules do, and systems never draw him.

- **`HumanAnimator`** (`src/sprites/humanAnimator.ts`) owns which row he is drawn in and how far through it. `HumanPlayer` feeds it once a tick — ground actually covered (measured from position, not `isMoving`), facing, knockout, the strike and Smush timers — and `spriteSelection()` returns the row, frame and mirroring `drawSelf` paints. It is tick-driven and seeded, so the art gates replay it exactly. It owns:
  - **Row choice from metadata**, never names: the view comes from `viewForFacing` (`src/sprites/humanSprite.ts`), a strike family is "the strikes in this view", chosen by target (low, tall, downed, far) and combo slot within `COMBO_WINDOW_TICKS`.
  - **The gait**: walk or run by smoothed measured speed, phase advanced by radians per pixel covered, starts and stops cut only where the legs already agree (a stride settles to the frame its stop begins from).
  - **Moving strikes**: on the move it never throws a standing blow; it picks the travelling version whose legs begin nearest the stride on screen, and a Smush becomes a hop.
  - **Latched facing**: a blow or Smush latches its facing and row for the whole swing; `latchedFacing` feeds `HumanPlayer.strikeFacingX/Y`, and the hit is resolved along it, so the damage goes where the drawn fist goes however the stick is steered mid-swing.
  - **Standing**: the guard held after any blow given or taken, its drop to the idle, fidgets after 6–12 s of quiet (suppressed after damage), the level-up gestures.
  - **Scripted rows**: `playAction` / `playReaction` / `stopAction` / `stopReaction` (exposed on `HumanPlayer`), with `loop`, `holdLastFrame`, `faceX/Y`, `cancelOnMove`, `progress`, `onFrame` (callbacks on the tick a frame is first drawn — pass the row's `eventFrames`, never copied numbers) and `onEnd(reason)`. Priority, highest first: a reaction flagged `overridesBlows` (knockdown, death); a blow or Smush; a reaction; an action; standing and moving. An action is refused mid-blow, mid-reaction or knocked out, and by default ends the tick he moves.
  - **Warming** the rows it is about to need through `warmRow`.
- **`HumanPlayer`** exposes `handWorldPosition(side)` (the hand tip read off the solved rig of the cell being drawn, so a thrown thing leaves the drawn hand), `smushStampTile()`, `standBy(reason, spans)` for rows that must be warm before a moment that can come on any tick, and `syncAppearance()`.
- **`HumanReactionDirector`** (`src/sprites/humanReactions.ts`) reads the player's state once a tick and asks for the matching reaction row — death over going down and lying out cold, over getting up, over the stumble (paced by how far the shove carried him), over the flinch (front or behind), over the struggle. It never draws him and never changes what happens to him.
- **`humanGestures`** (`src/creatures/humanGestures.ts`) is how systems ask for a gesture outside a fight — shell cast, drink, pickup, chest open, talk (`HumanTalkDriver`). Systems tell the player what is happening; they never draw him. Where gameplay waits on a gesture (the dome on the palm's landing, the chest's contents once the lid is up) the wait is only as long as the picture, and a refused or interrupted gesture runs the gameplay at once. Systems with their own rows (barricade building, dynamite, repair, placing gym kit) call `human.playAction` directly with the view's row from the tables in `humanFigure.ts`.
- **Appearance**: what he wears is read off his equipment and applied through `setHumanAppearance` in `humanSprite.ts`, which swaps the active outfit figure and releases the old one's cells. The slingshot carried while wielded is a runtime overlay (`src/sprites/slingshotCarrySprite.ts`), because the cells are shared by every state, wielding or not.
- **`?human`** (`src/scenes/HumanPreviewScene.ts`, `?human=<row>`) plays one row at the game's real pacing at three sizes, beside a live `HumanPlayer` driven through a fixed script.

The painter, the row table and the gates are in the `bipedal-figure` skill (`references/carl.md`).

### Mob levels and tactics

A mob is levelled once, at spawn: `applyMobLevel` multiplies its stats through the curves in `src/creatures/mobLevelScaling.ts` (the only place level math lives), then `applySpawnDifficulty` (`src/core/difficultyProfiles.ts`) stamps the profile's reward scale and rolls its tactics traits. Every spawn site calls both, in that order. The curves are held to an HP-share-per-fight target by `verify:difficulty-curve`; the reference crawler it measures against is `src/core/referenceCrawler.ts`.

Traits (`src/creatures/tactics/`) are opt-in per creature via `Mob.tacticsEligibility` (default none) and owned by `Mob.tactics` (`MobTactics`). `block` is resolved in `Mob.takeDamageFrom` for every creature; movement traits are queried from the creature's own `updateAI` (`chooseMove` / `disengage` / `claimRiposte`), with `Goblin` as the reference. Tactics read the world through two per-frame publications from `MobUpdateLoop` — the mob grid (`setPackAlertGrid` in `packAlert.ts`) and marked hazard ground (`tactics/markedGround.ts`) — rather than holding a world reference. `verify:tactics` gates them; the rules are P6 in `docs/difficulty-fairness-rules.md`.

## Dialog

`src/dialog/` is where every spoken line in the game lives, and the one place any of it gets rendered from.

- `line.ts` — a `DialogLine` is a value (speaker + paragraphs + advance label), built once per property by a speaker's `LineBuilder` (`speakerLines(id)` for a fixed cast member, `transientSpeaker(name, style)` for one named at runtime) and referenced by every reader — never looked up by a string key.
- `speakers.ts` — `SPEAKERS` (fixed cast, keyed by `SpeakerId`) and `TRANSIENT_STYLES` (voice/reveal/case presets for a runtime-named speaker); `resolveSpeaker` turns either into what the box draws.
- `roles.ts` — role interfaces (`VillagerLines`, `SoldierLines`, `ShopkeeperLines`, `MercenaryLines`, `ResidentLines`) that a script's export `satisfies`, so a missing line is a compile error where the script is written, not a runtime `undefined`.
- `request.ts` — `ConversationRequest` (lines, a reward preview, `ending`, `dismiss`, `haltsWorld`, `anchor`) and `Ending`/`DismissPolicy`/`Choice`/`ConversationTopic`, the data a `Conversation` runs.
- `paginate.ts` — pure, canvas-free page-breaking (paragraph → sentence → word → character), shared by `DialogBox` and unit-tested by `verify:dialog-pagination`.
- `Conversation.ts` — the one conversation panel a scene owns; see `add-ui`.
- `topics.ts` — turns a speaker's `ConversationTopic[]` into a choice row (`topicMenu`).
- `walkAway.ts` — the one rule for when a walk-off surface closes: its talk range plus `WALK_AWAY_MARGIN_TILES`.
- `villagerRegistry.ts` — `VILLAGER_SCRIPTS`/`SOLDIER_SCRIPTS`/`SHOPKEEPER_SCRIPTS`, the role-typed lookup tables generic Briar Hollow code reads a villager through.
- `scripts/` — one file per speaker or scene (`scripts/tikka.ts`, `scripts/scenes/defend.ts`, …), each exporting the lines and pools that speaker or scene needs. `verify:dialog-lines` walks every export here and fails on a line nothing ever reads.

`DungeonScene` and `BuildingInteriorScene` each own exactly one `Conversation`: constructed once, ticked once per frame with the player's position, and mounted once on the scene's `UiRoot` through `conversation.surface()`. A system that needs to talk takes that `Conversation` through its constructor deps rather than building a second one. See `add-ui` for the API and `add-quest` for how a quest's dialog is structured.

## EventBus

`src/core/EventBus.ts` — typed pub/sub keyed on the `GameEvents` interface (`mobKilled`, `bossDefeated`, `questStarted/Completed/Failed`, `achievementUnlocked`, `levelComplete`, `healingPotionUsed`, ...). `bus.on(event, cb)` returns an unsubscribe fn; `emit` is synchronous; `clear()` runs on scene teardown, so subscribers (e.g. `AudioManager.wireEvents`) must re-wire per scene. Prefer wiring sounds to events in `AudioManager.wireEvents` over sprinkling `audio.play` at emit sites.

## Input

`InputManager` only tracks held keys. Every scene with on-canvas UI owns one `UiRoot` (`src/ui/core/UiRoot.ts`; gameplay scenes build it with `createSceneUi` from `src/ui/core/sceneUi.ts`) and exposes it as `scene.ui`. `SceneManager` (`src/core/Scene.ts`) feeds it every pointer gesture through `PointerInput` (`src/ui/core/pointer.ts`, which turns mouse and touch into `down`/`move`/`up`/`cancel`/`wheel` in UI units), offers it every keydown before any gameplay listener, and disposes it when the scene exits. The browser's `click` event is never used.

- **Surfaces.** Each menu, dialog, prompt layer and the HUD is a `Surface` mounted once (`DungeonScene.surfaces()`, and the interior's equivalent). Its band (`world`, `hud`, `panel`, `modal`, `toast`, `system`) and open order make one stack, from which draw order, pointer order, Escape, keyboard focus, `ui.worldHalted()` and `ui.keyboardLocked()` all derive. A scene never keeps its own list of overlays.
- **Pointer.** The topmost region under a press owns the whole gesture and taps on release; a press on no region goes to the scene's `handleWorldPointer(gesture)` — tap-to-move, attack, loot and chest taps, NPC taps, Briar Hollow taps. Nothing else in a scene hit-tests.
- **Keys.** `ui.key` runs key hooks, then the topmost surface's `onKey`, then focus navigation, then Escape. A key no surface consumed reaches `src/systems/GameplayInputHandler.ts`, bound in each scene's `onEnter` via a `GameplayInputActions` callback object; an unclaimed Escape toggles pause, and `isSuppressed` reads `ui.keyboardLocked()`. `SceneManager` marks a key a surface consumed as spent until it is released, and tells `UiRoot` which keys were already held when a new menu appeared (`predatesSurface`).
- **Interaction prompts** are withheld while `surfacesOverHud(ui)` is non-empty.

The full contract is in the `add-ui` skill.

## Render pipeline and UI

A gameplay scene's `render` draws, in order:

1. The world through `src/systems/RenderPipeline.ts` (ground, Y-sorted entities, effects, fog), then the screen-space world effects in `src/systems/worldEffects.ts` (health vignette, level-up and stat-boost flashes) and world-anchored markers. World text, bars and plates use the painters in `src/ui/world/`; interaction prompts raised here with `drawInteractionPrompt` are only queued.
2. `ui.frame(ctx)`: every open surface bottom to top inside one `ctx.scale(uiScale)` — the `world`-band prompt surface (draws the queued prompts above darkness and fog), the `HudSurface` built from the scene's `HudModel` (unit frames, coin pill, minimap, dock, top band, hotbar), panels, modals, the HUD's `toast`-band overlay (toasts, and the top band when lifted over a scene panel), then system surfaces. The hit regions they register are what the next press is tested against.
3. A few reporters drawn over everything (the reward fly-in to the HUD), and the entity hover tooltip while `!ui.pointerOverUi()`.

Notices go to the toast stack (`MenusKit.toasts.post`), top-of-screen bars to `HudModel.topBand` entries, HUD buttons to `HudModel.dock`. `hudLayout` (`src/ui/hud/hudLayout.ts`) places every HUD piece the same way in the dungeon and indoors, so walking through a door moves nothing.

## AI bridge (optional)

`src/ai/AIAdapter.ts` — singleton bridging to an external LLM server on `localhost:3001`; silently no-ops when disabled (`AI_ENABLED` in `.env`). Exposes game actions (`src/ai/aiActions.ts`, allowlist-guarded) and a tool vocabulary (`src/ai/aiTools.ts`); subscribes to EventBus events and streams state snapshots. AI-spawned mobs reuse the same `createMob` spawner as levels.

## Docs and plans

`docs/` holds two different kinds of file, and they have opposite lifetimes.

Durable reference — describes the shipped system, is kept and maintained:

- `docs/town.md` — how the third floor's town is generated, rendered and tuned
- `docs/over-city-reference.md` — source-material background for third-floor content
- `docs/asset-management.md` — lazy sprite/sound loading, per-floor eviction, declared coverage
- `docs/difficulty-fairness-rules.md` — the P1-P6 fairness rules (curves, telegraphs, tactics) and the target-feel bands

Every other file in `docs/` is an implementation plan — usually named
`*-plan.md`, occasionally not — meaning scaffolding written for an agent to
execute, and DELETED once the work ships. Never cite a
plan, a plan phase, or a plan section number from code or from a skill — the
pointer is guaranteed to rot.

Never cite a source line number either — not from code, and not from a plan.
It rots on the next edit to that file, and a plan is read by an agent that will
trust it, so a stale `Foo.ts:317` sends that agent to the wrong code. Point at a
file, a function, a class, a constant, or a distinctive quoted fragment; those
survive edits and can be found by grep. When writing a plan, cite symbols for the
same reason.

## Where does my change go?

| Change                          | Skill             |
| ------------------------------- | ----------------- |
| New enemy / NPC                 | `add-creature`    |
| New sprite / animation          | `add-sprite`      |
| New item / loot / shop stock    | `add-item`        |
| New ability / spell             | `add-ability`     |
| New level / tile type           | `add-level`       |
| New ground/floor texture        | `add-ground-tile` |
| New quest                       | `add-quest`       |
| New sound / music               | `add-sound`       |
| New gameplay mechanic           | `add-system`      |
| New menu / dialog / HUD element | `add-ui`          |
| Running & verifying             | `dev-workflow`    |
