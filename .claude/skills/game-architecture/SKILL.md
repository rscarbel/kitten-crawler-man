---
name: game-architecture
description: Orientation map for the Kitten Crawler Man codebase — scenes, game loop, systems, EventBus, render pipeline, AI bridge. Read before making any nontrivial gameplay change or when unsure where code should live.
---

# Game Architecture

Browser dungeon crawler: TypeScript + one HTML5 Canvas, no framework, bundled by esbuild (`scripts/build.js` → `dist/bundle.js`). Optional Express+SQLite backend (`server/`) for auth/progress. The README's "Project Structure" section is accurate — skim it first.

## Core loop

- Entry: `src/game.ts` → creates `InputManager` + `SceneManager`.
- `SceneManager` (`src/core/Scene.ts`) owns the canvas, attaches all DOM listeners once, and runs a fixed-timestep loop: 60 Hz `update()` via accumulator, `render()` once per rAF. `replace(scene)` calls `onExit`/`onEnter`.
- Scenes: `DungeonScene` (main orchestrator, ~3k lines), `BuildingInteriorScene`, `GameplayScene` (shared camera/HUD/companion logic), `PostSignupScene`. A `Scene` implements `update()` + `render(ctx)` and optional input hooks (`handleClick`, `handleKeyDown`, touch, etc.).

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
- `MenusKit` — bag, gear, pause menu, award stack, toasts, potions, skill books.
- `ChatKit` — chat box plus the universal cheat table.
- `OverlayClaims.ts` — the one ordered list of "what owns the screen", read by the keyboard gate, the Space chain, the mobile tap route and the world-halt test.
- `hotbarActions.ts` — what pressing slots 1–8 does, for every scene that has them.

Kit fields stay concrete types: `update` signatures are not uniform, so a `GameSystem[]` loop could only be reached through casts. `npm run verify:kits` gates the spine.

### Cross-cutting getters

Two seams cut across the quest systems instead of living in one owner, because
three of the five questlines keep a `QuestManager` privately and the other two have
none at all — centralising the state would mean rewriting all five.

- `questMarkers` — minimap pips, gathered by `DungeonScene.collectQuestMarkers()`.
- `trackerEntries()` — Quest Journal rows, the `TrackerSource` interface in
  `src/systems/questTracker.ts`, gathered by `DungeonScene.collectTrackerEntries()`.

Both are rebuilt from the system's own phase machine every frame and stored
nowhere, so neither can go stale. `TownGuideSystem` is a `TrackerSource` with no
quest behind it at all — it points at the town's own furniture. See `add-quest`.

## Entity hierarchy

`Player` (`src/Player.ts`, abstract: position, HP, stats, status effects, walk animation) → `HumanPlayer`, `CatPlayer`, and `Mob` (`src/creatures/Mob.ts`, abstract: aggro, A* pathfinding, LOS, health bar, loot). All enemies extend `Mob`. See the `add-creature` skill.

### Companions and hirelings

Mongo (`MongoSystem`) and the Meat Shields hirelings (`MercenarySystem`) are `Mob`s on the party's side, handed to hostiles through `ctx.extraTargets` and crediting their kills to their owner. A hireling is a shell (`Mercenary`) plus a kit (`src/creatures/mercenaries/`), drawn through `MERCENARY_ART` and voiced through `MERCENARY_VOICES`; its shots fly in `RockThrowSystem` and `HirelingBoltSystem`. Both companions follow the party everywhere, including indoors: `BuildingInteriorScene` owns its own `MongoSystem` and `MercenarySystem` instances the same way `DungeonScene` does. A door dismisses whichever companions are out and the scene on the far side rebuilds them fresh — a hire from the roster's saved HP, Mongo via `mongoWasOut` into `MongoSystem.carryIn`. `src/systems/companionCarry.ts` is narrower: it moves companions that are already out between rosters of the same building, on a tower's `changeFloor` and when a script resets the party to its marks, beside the crawler they follow. See the `add-creature` skill.

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

## EventBus

`src/core/EventBus.ts` — typed pub/sub keyed on the `GameEvents` interface (`mobKilled`, `bossDefeated`, `questStarted/Completed/Failed`, `achievementUnlocked`, `levelComplete`, `healingPotionUsed`, ...). `bus.on(event, cb)` returns an unsubscribe fn; `emit` is synchronous; `clear()` runs on scene teardown, so subscribers (e.g. `AudioManager.wireEvents`) must re-wire per scene. Prefer wiring sounds to events in `AudioManager.wireEvents` over sprinkling `audio.play` at emit sites.

## Input

`InputManager` only tracks held keys. Per-scene bindings live in `src/systems/GameplayInputHandler.ts`, bound in each scene's `onEnter` via a `GameplayInputActions` callback object (Esc handler chain + action handlers, suppressed while menus are open — the suppression reads `overlayClaims`). Mouse/touch flows `SceneManager` → scene `handleClick`, which routes to consumers in priority order; each consumer returns `boolean` and the scene early-returns on `true`.

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
