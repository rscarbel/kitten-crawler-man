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

## Entity hierarchy

`Player` (`src/Player.ts`, abstract: position, HP, stats, status effects, walk animation) → `HumanPlayer`, `CatPlayer`, and `Mob` (`src/creatures/Mob.ts`, abstract: aggro, A* pathfinding, LOS, health bar, loot). All enemies extend `Mob`. See the `add-creature` skill.

## EventBus

`src/core/EventBus.ts` — typed pub/sub keyed on the `GameEvents` interface (`mobKilled`, `bossDefeated`, `questStarted/Completed/Failed`, `achievementUnlocked`, `levelComplete`, `healingPotionUsed`, ...). `bus.on(event, cb)` returns an unsubscribe fn; `emit` is synchronous; `clear()` runs on scene teardown, so subscribers (e.g. `AudioManager.wireEvents`) must re-wire per scene. Prefer wiring sounds to events in `AudioManager.wireEvents` over sprinkling `audio.play` at emit sites.

## Input

`InputManager` only tracks held keys. Per-scene bindings live in `src/systems/DungeonInputHandler.ts`, bound in `DungeonScene.onEnter` via a `DungeonInputActions` callback object (Esc handler chain + action handlers, suppressed while menus are open). Mouse/touch flows `SceneManager` → scene `handleClick`, which routes to consumers in priority order; each consumer returns `boolean` and the scene early-returns on `true`.

## AI bridge (optional)

`src/ai/AIAdapter.ts` — singleton bridging to an external LLM server on `localhost:3001`; silently no-ops when disabled (`AI_ENABLED` in `.env`). Exposes game actions (`src/ai/aiActions.ts`, allowlist-guarded) and a tool vocabulary (`src/ai/aiTools.ts`); subscribes to EventBus events and streams state snapshots. AI-spawned mobs reuse the same `createMob` spawner as levels.

## Where does my change go?

| Change | Skill |
|---|---|
| New enemy / NPC | `add-creature` |
| New sprite / animation | `add-sprite` |
| New item / loot / shop stock | `add-item` |
| New ability / spell | `add-ability` |
| New level / tile type | `add-level` |
| New quest | `add-quest` |
| New sound / music | `add-sound` |
| New gameplay mechanic | `add-system` |
| New menu / dialog / HUD element | `add-ui` |
| Running & verifying | `dev-workflow` |
