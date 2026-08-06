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

~30 plain classes in `src/systems/` implementing `GameSystem` (`src/systems/GameSystem.ts`): optional `update(ctx: SystemContext)` + `dispose()`. `SystemContext` carries per-frame shared state (`human, cat, active, mobs, mobGrid, gameMap, bossRoom, ...`).

- Systems are fields on `DungeonScene`, constructed in its constructor with explicit deps (`gameMap`, `bus`, `addMob` callbacks).
- `DungeonScene.updateGameplay()` calls each system's `update(ctx)` in an explicit order; `src/systems/GameLoopPhases.ts` documents the 9 named phases.
- Rendering is layered by `src/systems/RenderPipeline.ts`: world → entities (Y-sorted by `entity.y`) → effects → visibility fog. Being in `this.mobs` is enough to get rendered — no extra registration.
- Systems don't play audio directly; they set pending flags (e.g. `explosionSoundPending`) that the scene reads and clears.

See the `add-system` skill for the recipe.

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

## EventBus

`src/core/EventBus.ts` — typed pub/sub keyed on the `GameEvents` interface (`mobKilled`, `bossDefeated`, `questStarted/Completed/Failed`, `achievementUnlocked`, `levelComplete`, `healingPotionUsed`, ...). `bus.on(event, cb)` returns an unsubscribe fn; `emit` is synchronous; `clear()` runs on scene teardown, so subscribers (e.g. `AudioManager.wireEvents`) must re-wire per scene. Prefer wiring sounds to events in `AudioManager.wireEvents` over sprinkling `audio.play` at emit sites.

## Input

`InputManager` only tracks held keys. Per-scene bindings live in `src/systems/DungeonInputHandler.ts`, bound in `DungeonScene.onEnter` via a `DungeonInputActions` callback object (Esc handler chain + action handlers, suppressed while menus are open). Mouse/touch flows `SceneManager` → scene `handleClick`, which routes to consumers in priority order; each consumer returns `boolean` and the scene early-returns on `true`.

## AI bridge (optional)

`src/ai/AIAdapter.ts` — singleton bridging to an external LLM server on `localhost:3001`; silently no-ops when disabled (`AI_ENABLED` in `.env`). Exposes game actions (`src/ai/aiActions.ts`, allowlist-guarded) and a tool vocabulary (`src/ai/aiTools.ts`); subscribes to EventBus events and streams state snapshots. AI-spawned mobs reuse the same `createMob` spawner as levels.

## Docs and plans

`docs/` holds two different kinds of file, and they have opposite lifetimes.

Durable reference — describes the shipped system, is kept and maintained:

- `docs/town.md` — how the third floor's town is generated, rendered and tuned
- `docs/over-city-reference.md` — source-material background for third-floor content
- `docs/asset-management.md` — lazy sprite/sound loading, per-floor eviction, declared coverage
- `docs/difficulty-fairness-rules.md` — the P1-P5 fairness rules and the target-feel bands

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
