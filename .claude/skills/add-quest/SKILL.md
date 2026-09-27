---
name: add-quest
description: Add a quest to Kitten Crawler Man — QuestManager state machine, QuestNPC, quest system class, dialog, rewards, EventBus events. Use when creating or modifying quests, quest NPCs, or quest dialog.
---

# Add a Quest

Quests are built from three pieces: a `QuestDef` in `QuestManager`, a `QuestNPC` in the world, and a dedicated system class driving the state machine. Study `src/systems/DefendQuestSystem.ts` (compact) and `src/systems/SpiderQuestSystem.ts` (rich: dialog, cutscene, boss fight, minigame).

## Building blocks

- **`QuestManager`** (`src/core/QuestManager.ts`): pure state tracker. `QuestDef { id, name, type: 'story' | 'mini', rewards: QuestRewards }`; `QuestRewards { xp, lootBoxItems?, coins? }`. Status flows `available → active → completed | failed` via `register` / `startQuest` / `completeQuest` / `failQuest`.
- **`QuestNPC`** (`src/creatures/QuestNPC.ts`): extends `Player` (so mobs can target/attack it — that's how defend quests fail), non-combatant, carries `questId` and an overhead `markerType` (`'exclamation' | 'question' | 'none'`).
- **Quest system class**: a `GameSystem` (see `add-system`) constructed with `(gameMap, bus, addMob)` in `DungeonScene` — `addMob` is the callback the scene supplies as `(mob) => world.roster.add(mob)` — the one spawn path, which also hands the mob its map and spell context, so wave spawns register correctly. It owns a phase union type (e.g. `'inactive' → 'npc_waiting' → 'dialog' → 'defending' → 'complete' | 'failed'`) and drives timers, waves, and dialog in `update(ctx)`.

## Conventions to follow

- Define `QUEST_ID` as a module constant; register the `QuestDef` when the system activates.
- Emit `bus.emit('questStarted' | 'questCompleted' | 'questFailed', ...)` at the transitions — `AudioManager` and the AI adapter subscribe to these, so quests get music/reactions for free.
- Dialog: a quest's dialog is a scene script file under `src/dialog/scripts/scenes/` (e.g. `defend.ts`, `spider.ts`, `murder.ts`) exporting `DialogLine`s built from a speaker's `LineBuilder` (`speakerLines`/`transientSpeaker`, `src/dialog/line.ts`), plus the `ConversationRequest`s the quest system plays through the scene's shared `Conversation` (`src/dialog/Conversation.ts` — construct dep-injected, never build a second one). A beat's side effects — granting the reward, advancing the phase — go on its `ending`: `{ kind: 'close', onClosed() }` runs them once the pages are actually read; `{ kind: 'choices', choices }` offers a branch; `{ kind: 'confirm', accept, decline }` is how a quest offers to decline (`Ending.confirm`) instead of hand-rolling a yes/no. A `reward` on the request is a **preview** only — grant the real item/XP in `onClosed` or the accepting `Choice.run`, never when the request is built. A load-bearing scene (the player must not walk away or Esc mid-beat) sets `dismiss: { kind: 'blocked' }`; one the player can walk away from sets `dismiss: { kind: 'allowed', onDismissed() }` with an `anchor` for the walk-away radius. **Never hand-roll dialog rendering with raw `drawModal`/`drawText` calls or construct a `DialogBox` directly** — `Conversation` already gives you the sound cue, pagination and the mobile-safe width clamp for free (see `add-ui`).
- Interaction surface: give the system `tryInteract()` (keyboard interact near the NPC), `handleClick(mx, my, canvas): boolean`, `dismissDialog()`, and optionally `handleKeyDown`. Wire them into the scene's `handleClick` priority chain and `GameplayInputHandler`'s Esc/action chains, and add an `overlayClaims` entry for any dialog that owns the screen.
- Gate map-specific quests on the map feature existing (e.g. SpiderQuest checks `gameMap.spiderLabRoom !== null`).
- Rewards: grant XP/items on completion via the players' XP methods and `inventory.addItem`; achievement-linked quests call `achievements.tryUnlock(...)` in the scene's quest-completion handling.

## Telling the player where to go

Three separate surfaces answer "where is this quest", and a quest system feeds all
of them from its own phase machine. None of them stores anything — each is rebuilt
from the current phase every frame, so nothing here can go stale.

- **Minimap markers** — a `questMarkers` getter returning `{ x, y, type }` tiles.
  `DungeonScene.collectQuestMarkers()` concatenates every system's.
- **Journal rows** — a `trackerEntries()` getter, the `TrackerSource` interface in
  `src/systems/questTracker.ts`. Return one `TrackerEntry` per thread:
  `{ id, name, status, objective, hint?, target? }`. `id` must be stable across
  frames — it is what a pin is remembered by. `objective` is one line of what to do
  next; use `secondsLabel(frames)` for any countdown so every quest phrases one the
  same way. `target` is the tile the compass chevron, the distance and the pinned
  world arrow all point at, so omit it when the quest genuinely has no destination.
  Add the getter next to `questMarkers` and add the system to the list
  `DungeonScene.collectTrackerEntries()` passes to `collectTrackerEntries`.
- **Quest beacons** — `drawQuestBeacon` (`src/sprites/questBeacon.ts`), a column of
  light over anyone wearing a `!`/`?`. Called by the _creature_, before its own body
  paint, so it Y-sorts with the figure. Gate it on the exact state that drives the
  overhead glyph — `questMarkerColorFor` in `src/sprites/questNPCSprite.ts` is the
  one place that mapping lives, so the two cannot disagree.

Two traps worth knowing before you wire any of these:

- A marker state read only in `update()` **freezes while a dialog is open**, because
  `updateGameplay` does not run then. If your beacon or glyph must go quiet during
  the conversation it belongs to, expose a `syncMarkers()` the scene calls above its
  `gameplayHalted` early return — that is what `CircusQuestSystem` and
  `MurderMysteryQuestSystem` do.
- A `failed` or `completed` entry that still carries a `target` cannot be pinned:
  `resolvePinnedEntry` requires `isOutstanding(status)` as well as a target. Drop
  the target when the thread stops being somewhere to go, or the row offers a pin
  that quietly does nothing.

The Journal itself is a pause tab (`src/ui/pause/JournalTab.ts`) offered from the
Over City up — see `add-ui`. Quests on floors below it still implement
`trackerEntries()`; the gate is `DungeonScene.hasQuestJournal`, not the system.

## Checklist

1. Create `src/systems/MyQuestSystem.ts` implementing `GameSystem` with a phase union, `QUEST_ID`, and `(gameMap, bus, addMob)` constructor.
2. Register the `QuestDef` with `QuestManager`; place a `QuestNPC` (or spawn via `extraSpawns`).
3. Construct the system in `DungeonScene`, call `update(ctx)` in `updateGameplay()`, add render calls, and wire `handleClick`/Esc/interact into the existing chains.
4. Emit the three quest events at transitions.
5. Add `questMarkers` and `trackerEntries()`, and register the system in the scene's two collectors.

Finish with the `dev-workflow` gates (typecheck, lint, format).
