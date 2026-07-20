---
name: add-quest
description: Add a quest to Kitten Crawler Man — QuestManager state machine, QuestNPC, quest system class, dialog, rewards, EventBus events. Use when creating or modifying quests, quest NPCs, or quest dialog.
---

# Add a Quest

Quests are built from three pieces: a `QuestDef` in `QuestManager`, a `QuestNPC` in the world, and a dedicated system class driving the state machine. Study `src/systems/DefendQuestSystem.ts` (compact) and `src/systems/SpiderQuestSystem.ts` (rich: dialog, cutscene, boss fight, minigame).

## Building blocks

- **`QuestManager`** (`src/core/QuestManager.ts`): pure state tracker. `QuestDef { id, name, type: 'story' | 'mini', rewards: QuestRewards }`; `QuestRewards { xp, lootBoxItems?, coins? }`. Status flows `available → active → completed | failed` via `register` / `startQuest` / `completeQuest` / `failQuest`.
- **`QuestNPC`** (`src/creatures/QuestNPC.ts`): extends `Player` (so mobs can target/attack it — that's how defend quests fail), non-combatant, carries `questId` and an overhead `markerType` (`'exclamation' | 'question' | 'none'`).
- **Quest system class**: a `GameSystem` (see `add-system`) constructed with `(gameMap, bus, addMob)` in `DungeonScene` — `addMob` is the callback that pushes into both `this.mobs` and `this.mobGrid`, so wave spawns register correctly. It owns a phase union type (e.g. `'inactive' → 'npc_waiting' → 'dialog' → 'defending' → 'complete' | 'failed'`) and drives timers, waves, and dialog in `update(ctx)`.

## Conventions to follow

- Define `QUEST_ID` as a module constant; register the `QuestDef` when the system activates.
- Emit `bus.emit('questStarted' | 'questCompleted' | 'questFailed', ...)` at the transitions — `AudioManager` and the AI adapter subscribe to these, so quests get music/reactions for free.
- Dialog: use `DialogBox` (`src/ui/DialogBox.ts`) — construct with `(audio, { speakerName, revealMode, ... })`, then `show(text)` / `update()` / `render(ctx, canvas)` / `skipToEnd()`.
- Interaction surface: give the system `tryInteract()` (keyboard interact near the NPC), `handleClick(mx, my, canvas): boolean`, `dismissDialog()`, and optionally `handleKeyDown`. Wire them into `DungeonScene.handleClick`'s priority chain and `DungeonInputHandler`'s Esc/action chains.
- Gate map-specific quests on the map feature existing (e.g. SpiderQuest checks `gameMap.spiderLabRoom !== null`).
- Rewards: grant XP/items on completion via the players' XP methods and `inventory.addItem`; achievement-linked quests call `achievements.tryUnlock(...)` in the scene's quest-completion handling.

## Checklist

1. Create `src/systems/MyQuestSystem.ts` implementing `GameSystem` with a phase union, `QUEST_ID`, and `(gameMap, bus, addMob)` constructor.
2. Register the `QuestDef` with `QuestManager`; place a `QuestNPC` (or spawn via `extraSpawns`).
3. Construct the system in `DungeonScene`, call `update(ctx)` in `updateGameplay()`, add render calls, and wire `handleClick`/Esc/interact into the existing chains.
4. Emit the three quest events at transitions.

Finish with the `dev-workflow` gates (typecheck, lint, format).
