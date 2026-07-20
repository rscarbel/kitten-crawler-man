---
name: add-system
description: Add a new gameplay mechanic to Kitten Crawler Man as a GameSystem class — constructor deps, update ordering, rendering, input routing, disposal. Use when a feature doesn't fit an existing system in src/systems/.
---

# Add a Game System

Mechanics live as plain classes in `src/systems/` implementing `GameSystem` (`src/systems/GameSystem.ts`): optional `update(ctx: SystemContext)` and `dispose()`. `SystemContext` carries per-frame shared state: `human, cat, active, inactive, activeIsMoving, mobs, mobGrid, gameMap, bossRoom, extraTargets?`.

First check whether an existing system already owns the domain (~30 in `src/systems/` — combat, loot, barriers, dynamite, shops, gore, minimap, ...). Extend it if so.

## Reference examples

- `DynamiteSystem` — `constructor(private readonly gameMap: GameMap)`, `update(ctx)`, `render(...)`, exposes an `explosionSoundPending` flag the scene drains.
- `TreasureChestSystem` — no ctor deps; imperative API (`addWoodenChest`) plus callback setters (`onChestOpened`).
- `StairwellSystem` — `constructor(gameMap, levelDef, onDescend)`; `update(ctx)`, `handleClick(mx, my, canvas): boolean`, separate render methods for world vs. menu.

## Checklist

1. **Class**: `class FooSystem implements GameSystem` in `src/systems/FooSystem.ts`. Constructor takes explicit deps — typically `gameMap`, sometimes `bus`, and an `addMob` callback if it spawns mobs (the scene's `addMob` inserts into both `this.mobs` and `this.mobGrid`; never push into one without the other).
2. **Construct**: add a field on `DungeonScene` and instantiate in its constructor near the other systems.
3. **Update**: call `this.foo.update(ctx)` in `DungeonScene.updateGameplay()`. Order matters — `src/systems/GameLoopPhases.ts` documents the 9 phases; place the call next to systems in the same phase.
4. **Render**: add render calls where appropriate. World-space entities that should Y-sort go through `RenderPipeline`'s entity pass (sorted by `.y`); overlays/menus render after the pipeline.
5. **Input**: mouse — add a `handleClick(...): boolean` and insert it into `DungeonScene.handleClick`'s priority chain (return `true` to consume; order in that chain is the UI stacking order). Keyboard — add to `DungeonInputHandler`'s action bindings and Esc chain; respect `isSuppressed()`.
6. **Audio**: don't hold an audio reference — set pending flags the scene drains, or emit an EventBus event `AudioManager.wireEvents` maps to a sound (see `add-sound`).
7. **Events**: communicate with other systems via `bus.emit` / `bus.on` (`src/core/EventBus.ts`); add new event names to the `GameEvents` interface with a typed payload. `bus.on` returns an unsubscribe fn; the bus is cleared on scene exit.
8. **Cleanup**: implement `dispose()` if the system holds DOM listeners or timers.

Finish with the `dev-workflow` gates (typecheck, lint, format).
