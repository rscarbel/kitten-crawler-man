---
name: add-quest
description: Add a quest to Kitten Crawler World — QuestManager state machine, QuestNPC, quest system class, dialog, rewards, EventBus events. Use when creating or modifying quests, quest NPCs, or quest dialog.
---

# Add a Quest

Quests are built from three pieces: a `QuestDef` in `QuestManager`, a `QuestNPC` in the world, and a dedicated system class driving the state machine. Study `src/systems/DefendQuestSystem.ts` (compact) and `src/systems/SpiderQuestSystem.ts` (rich: dialog, cutscene, boss fight, minigame).

## Building blocks

- **`QuestManager`** (`src/core/quests/QuestManager.ts`): pure state tracker. `QuestDef { id, name, type: 'story' | 'mini', rewards: QuestRewards }`; `QuestRewards { xp, coins? }` (the quest's completion function pays any items itself; see Rewards below). Status flows `available → active → completed | failed` via `register` / `startQuest` / `completeQuest` / `failQuest`.
- **`QuestNPC`** (`src/creatures/QuestNPC.ts`): extends `Player` (so mobs can target/attack it — that's how defend quests fail), non-combatant, carries `questId` and an overhead `markerType` (an `NpcQuestMarker`; see the rule below).
- **Quest system class**: a `GameSystem` (see `add-system`) constructed with `(gameMap, bus, addMob)` in `DungeonScene` — `addMob` is the callback the scene supplies as `(mob) => world.roster.add(mob)` — the one spawn path, which also hands the mob its map and spell context, so wave spawns register correctly. It owns a phase union type (e.g. `'inactive' → 'npc_waiting' → 'dialog' → 'defending' → 'complete' | 'failed'`) and drives timers, waves, and dialog in `update(ctx)`.

## Conventions to follow

- Define `QUEST_ID` as a module constant; register the `QuestDef` when the system activates.
- `objectiveComplete` carries its `questId`; whether it plays the objective chime is the quest's `QUEST_TRAITS` entry (`src/core/quests/QuestManager.ts`), a `Record` over `QuestId`, so a new quest must say.
- Emit `bus.emit('questStarted' | 'questCompleted' | 'questFailed', ...)` at the transitions — `AudioManager` and the AI adapter subscribe to these, so quests get music/reactions for free.
- Dialog: a quest's dialog is a scene script file under `src/dialog/scripts/scenes/` (e.g. `defend.ts`, `spider.ts`, `cloggedBathroom.ts`) exporting `DialogLine`s built from a speaker's `LineBuilder` (`speakerLines`/`transientSpeaker`, `src/dialog/line.ts`), plus the `ConversationRequest`s the quest system plays through the scene's shared `Conversation` (`src/dialog/Conversation.ts` — construct dep-injected, never build a second one). A beat's side effects — granting the reward, advancing the phase — go on its `ending`: `{ kind: 'close', onClosed() }` runs them once the pages are actually read; `{ kind: 'choices', choices }` offers a branch; `{ kind: 'confirm', accept, decline, keyboardDefault: 'accept' }` is how a quest offers to decline (`Ending.confirm`) instead of hand-rolling a yes/no — Space takes the accept side and Escape declines, so a player reading through with Space takes the quest (`verify:dialog-accept` walks every row with Space alone). An offer that spends, wagers or cannot be undone sets `keyboardDefault: 'none'` (or marks the choice `keyboard: 'never'`) so the player has to aim at it. A `reward` on the request is a **preview** only — grant the real item/XP in `onClosed` or the accepting `Choice.run`, never when the request is built. A load-bearing scene (the player must not walk away or Esc mid-beat) sets `dismiss: { kind: 'blocked' }`; one the player can walk away from sets `dismiss: { kind: 'allowed', onDismissed() }` with an `anchor` naming the speaker's position and talk range (the walk-away distance derives from it; see `add-ui`). **Never hand-roll a dialog panel or construct a `DialogBox` directly** — `Conversation` already gives you the sound cue, pagination, focus and phone layout for free (see `add-ui`).
- Lore: quest dialog that reveals anything about the world, Caroline or Dave's past goes through a story beat in `STORY_BEATS` (`src/story/storyBeats.ts`), never into the quest's own script; see `docs/world-and-story.md`, which also holds both characters' voice rules. A beat is data: a `speaker` (`'dave'` or `'caroline'`), a `trigger` (a `DaveTrigger` such as `safeRoomArrival` with an optional `afterBossDefeated`, or a `CarolineTrigger` such as `bossDefeated` or `afterBeat`), the beats it `requires`, and Dave's `lines` (at most four pages) or Caroline's `message` (`carolineLines.message('…')`, her text only). `StoryDirector` decides what is due, `StoryDelivery` plays it (Dave as a walk-up cutscene at a safe room, Caroline at a calm moment), and seen beats are saved at once outside the checkpoint. Preview any beat with `?story=<beatId>`; `npm run verify:dave-guide` drives the delivery headless.
- Objectives: a boss or quest Dave should advise on is an `AdviceObjectiveId` (`src/systems/daveAdvice.ts`). Its entry in `DAVE_ADVICE` (`src/dialog/scripts/dave.ts`, his tactics) and `CAROLINE_OBJECTIVE_INTEL` (`src/dialog/scripts/caroline.ts`, where it is, what it is, whether it is optional) are `Record`s over that union, so the objective does not compile until both have a line; a boss with a debrief also needs its `DAVE_DEBRIEF_CONGRATS` entry. Tactics are Dave's, intel is Caroline's: never give Dave a boss's location.
- Interaction surface: give the system `tryInteract()` (keyboard interact near the NPC) and `dismissDialog()`. Lines go through the scene's shared `Conversation` (its surface's `dismiss`/`wantsEscape` hooks decide Escape). A screen of the quest's own (a tutorial, a confirm, a banner) is a surface built from the system's state — usually `choiceModalSurface` or `pagedOverlaySurface` — mounted once on the scene's `UiRoot`; its widgets' `onTap`, its `onKey` and its `close` call into the system. A top-of-screen counter or bar is a `TopBandEntry`, a notice a toast (see `add-ui`).
- Gate map-specific quests on the map feature existing (e.g. SpiderQuest checks `gameMap.spiderLabRoom !== null`).
- Rewards: the quest's own completion function pays everything — XP to both crawlers in full through `awardPartyXp(human, cat, amount, bus)` (`src/core/progression/awardXp.ts`; keep its return, each crawler's figure is what landed on that bar), coins through `earnCoins`, items through `inventory.addItem` — then emits `questCompleted` and `questRewardShown` with a `QuestRewardSpec` (`src/ui/questReward/types.ts`) built from what was actually paid. Never draw a quest-complete overlay of your own: the scene's one `QuestRewardScreen` (on `MenusKit`) queues the spec, waits out any conversation or halt, plays the fanfare, and flies coins and `itemId` lines to the HUD when dismissed. Sections are optional (`xp`, `coins`, `items`, `unlocks` with `RewardUnlockCard`s and an optional muted `condition`); the screen fixes their order. Build the XP lines with `partyXpSections` (one per crawler, naming who) and items with `bagItemRewardLine`, both in `src/ui/questReward/rewardLines.ts`. A quest system needs both crawlers at its completion step, so take them from `SystemContext` or the scene's call site, never just the active one. A quest that pays before a save and asks for the screen after it records a seen flag in `onDismissed` (Borrowed Blueprints' `completionScreenSeen`). Only the scene's own stock (the achievement it pays through `AchievementAwards`, quest-slot cleanup) stays in the scene's `questCompleted` handler. `npm run verify:quest-reward` checks every quest; `npm run render:quest-reward` renders review shots.
- A quest can issue a fragment of its floor's Golden Key, the key that opens the floor's sealed stairwells: give the fragment a `{ kind: 'questCompleted', questId }` source in the floor's `FLOOR_KEYS` entry (`src/core/keys/floorKeys.ts`), with its id in `FRAGMENT_HOMES` (see `add-level`), plus Caroline's `issueLine` and a `hint` that names the deed, never a place. `questId` is a `QuestId`, so a renamed quest breaks the table at compile time. The quest itself does nothing more: `KeyFragmentSystem` runs in both `DungeonScene` and `BuildingInteriorScene` and hears the `questCompleted` the quest already emits, wherever it completes. Its ceremony waits for the quest's reward plaque to go up and come down first. A quest the run carried in already complete (the Wayfinder's Anchor on a new game) issues its fragment live, with `carriedIssueLine`, the first time that floor's ring is built; any later rebuild claims it silently.

## Questlines that talk through someone else's NPCs

Two worked examples stand a quest on people another system owns, instead of on a `QuestNPC`:

- **Briar Hollow's villagers.** A questline implements `QuestLineProvider`
  (`src/systems/briarHollow/villagerCircumstances.ts`: `lineFor`, `markerFor`) and registers with
  `VillagerSystem.addQuestLineProvider()`, optionally `addTopicProvider()` for extra rows, and
  `removeQuestLineProvider()` on dispose. Providers are an ordered list: the first with an opening
  (or a marker other than `'none'`) for a villager speaks, so registration order is priority. The
  Plea (`VillageQuestSystem`) registers first and "The Borrowed Blueprints"
  (`BlueprintsQuestSystem`) second, so a side quest never talks over the main questline. A
  provider that speaks only briefly and must not be talked over registers with
  `addQuestLineProvider(this, { first: true })`: Wendell's construction contracts
  (`ConstructionContractSystem`) do, because they answer only while a client owes a payment, and
  behind the Plea the Mayor's lines would take every talk and the payment could never be made.
  Never add a special case for one questline to `VillagerSystem` or `openingLine`.
- **Town residents indoors.** `BuildingInteriorScene` holds an ordered list of `ResidentQuestHook`s
  (`src/systems/residentQuestHooks.ts`): `ContractContactHook` first, then the Anchor's
  (`AnchorInteriorSystem`), `WendellBlueprintsHook` and `WendellContractsHook`. The contract's
  client goes first because it answers only while a payment is owed; behind the Anchor, its terms
  for Aviel or Lori would take every talk. Each hook gets first refusal on talking to a resident
  (`tryOpenDialog`) and a say in the glyph over their head (`markerFor`, folded by
  `firstResidentMarker` in `applyResidentQuestMarkers`; a resident no hook claims wears none). A
  marked resident in reach is talked to ahead of the shop counter or safe room they stand at
  (`questResidentInReach`). A new indoor questline is one more entry in that list. A quest
  whose state lives in the village is threaded into the interior by reference (the way
  `BriarHollowState` is) and moves its phase through the same helper as the overworld, so the
  same events fire on both sides of the door.

## Quest items

`isQuestItem` items share one reserved quest slot per crawler (see `add-item`). Granting one
evicts whatever other quest item was there, reported as `questItemEvicted`. So:

- read whether an item is held off both crawlers' inventories every time, never a flag in the
  quest's state, and let guidance send the player back for it;
- give it a place to be got back from once nobody holds it (a prop that shows it again, a pile
  that respawns, an NPC who hands it back);
- retire it with `clearQuestItem(id)` or `removeItems`, which touch only your own item.

`docs/town.md` (The Borrowed Blueprints) describes one quest built end to end on these rules;
its Construction contracts section describes a repeatable job on the same seams.

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
  Every entry declares its `kind`: `'single'` for a quest's only row,
  `'header'` over several live steps, `'step'` (with its `parentId`) under
  one. A header must say what a pin on it leads to: `pinLeadsTo:
'nearest_step'` for steps done in any order (the anchor shards), `'header'`
  for a header that already names the step the story is on, so a closer house
  never overrules the lead (the missing-cats investigation).
- **Quest beacons** — a column of light over anyone wearing a quest marker, drawn by
  the _creature_ with `drawOverheadIconBeacon` (`src/sprites/overheadIcon.ts`) before
  its own body paint, so it Y-sorts with the figure. It and `drawOverheadIcon` read
  the same marker value, so the beam and the glyph cannot disagree.

Two traps worth knowing before you wire any of these:

- A marker state read only in `update()` **freezes while a dialog is open**, because
  `updateGameplay` does not run then. If your beacon or glyph must go quiet during
  the conversation it belongs to, expose a `syncMarkers()` the scene calls above its
  `gameplayHalted` early return — that is what `CloggedBathroomSystem` and
  `StealthKeySnatchSystem` do.
- A `failed` or `completed` entry that still carries a `target` cannot be pinned:
  `resolvePinnedEntry` requires `isOutstanding(status)` as well as a target. Drop
  the target when the thread stops being somewhere to go, or the row offers a pin
  that quietly does nothing.

The Journal itself is a pause-screen section (`src/ui/screens/pause/journalSection.ts`) offered from the
Taloncrest up — see `add-ui`. Quests on floors below it still implement
`trackerEntries()`; the gate is `DungeonScene.hasQuestJournal`, not the system.

## Rule: what a quest NPC wears

Every person or animal the party talks to for a quest wears an `NpcQuestMarker`
(`src/sprites/npcQuestMarker.ts`), worked out from the quest's own state:

- `'available'` — gold beacon and `!`: the quest is on offer and **not started**.
- `'inProgress'` — green beacon and `?`: the party is **partway through** this quest
  and talking to this NPC moves it on. Never a `!` mid-quest.
- `'turnIn'` — green beacon, `?` and a **present** beside it: talking now **pays a
  reward or unlocks something** (coins, XP, a skill, a station, a gate, a shard).
  A quest item handed over only to carry to the next step (Wendell's blueprints)
  is `'inProgress'`.
- `'none'` — nothing to say.

While any quest is `active` (a quest line with status `active`, asked of the floor's
quest systems whether or not it keeps a Journal), every `'available'` beacon burns at
a third of its strength (`AVAILABLE_BEACON_STRENGTH_WHILE_ON_A_QUEST` in
`npcQuestMarker.ts`); the gameplay scenes set this at the top of `render` with
`setPartyOnAQuest`, and a frame that does not set it reads "no quest". Nothing per
quest is needed.

Write the marker as a table over the quest's phase union — `{ … } as const satisfies
Record<MyPhase, NpcQuestMarker>` (see `MOTHER_MARKER_BY_PHASE` in
`DefendQuestSystem`, `PLEA_MARKERS_BY_PHASE` in `VillageQuestSystem`,
`PLUMBER_MARKER_BY_PHASE` in `CloggedBathroomSystem`) — so a new phase cannot compile
until it says what its NPC wears. Derive the minimap pip with `minimapMarkerFor`.
A person's icon is an `NpcOverheadIcon` (`src/sprites/overheadIcon.ts`, from
`overheadIconFor`), so a person cannot wear an object's marker. Objects (a notice
board, a terminal, a crystal) are not NPCs: they wear an `ObjectOverheadIcon` built
from the plain `ObjectQuestMarker` `!`/`?` (`src/sprites/questNPCSprite.ts`) and never
take a present. Dave's story beats and tactics are not quests: he wears the
`NpcMarker` `'news'`, a gold `!` that never quiets, since what he says is usually
about the quest in hand. No quest uses `'news'`.
`drawOverheadIcon` takes an `IconAnchor`, never a bare y: build it with
`IconAnchor.ofRow(drawnRow, sy, tileSize)` for a figure (null, and no icon, until the
row is measured, so the icon never hops onto the wearer) or `IconAnchor.ofFixedArt`
for art whose top is final on its first frame (baked sheet ink, fixed head geometry).

## Checklist

1. Create `src/systems/MyQuestSystem.ts` implementing `GameSystem` with a phase union, `QUEST_ID`, and `(gameMap, bus, addMob)` constructor.
2. Register the `QuestDef` with `QuestManager`; place a `QuestNPC` (or spawn via `extraSpawns`).
3. Construct the system in `DungeonScene`, call `update(ctx)` in `updateGameplay()`, add world render calls, add its surfaces to the scene's mounted list and its top-band entries to the `HudModel`, and wire interact into the Space chain.
4. Emit the three quest events at transitions.
5. Add `questMarkers` and `trackerEntries()`, and register the system in the scene's two collectors.
6. Give every NPC of the quest its `NpcQuestMarker` from a `Record` over the phase union, following the rule above.

Finish with the `dev-workflow` gates (typecheck, lint, format).
