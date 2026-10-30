---
name: add-system
description: Add a new gameplay mechanic to Kitten Crawler World as a GameSystem class — constructor deps, update ordering, rendering, input routing, disposal. Also the recipe for standing up a whole new scene from the kits in src/systems/kits/. Use when a feature doesn't fit an existing system in src/systems/.
---

# Add a Game System

Mechanics live as plain classes in `src/systems/` implementing `GameSystem` (`src/systems/GameSystem.ts`): optional `update(ctx: SystemContext)` and `dispose()`. `SystemContext` carries per-frame shared state: `human, cat, active, inactive, activeIsMoving, roster, gameMap, bossRoom?, extraTargets?`.

`ctx.roster` is a `MobRoster` (`src/systems/kits/SceneWorld.ts`): `roster.mobs` is the list, `roster.grid` the spatial index, and `roster.add(mob)` is the **only** way a mob joins a scene — it inserts into both and hands the mob the scene's map and spell context. Never push into one without the other; a mob that misses `setSpells` walks straight through an energy shield.

First check whether an existing system already owns the domain (~30 in `src/systems/` — combat, loot, barriers, dynamite, shops, gore, minimap, ...). Extend it if so.

A boss room's props, slow ground, hazards and interactables are not a new top-level system: they are a `BossRoomDressing` in `src/systems/bossRooms/`, driven through the `BossRoomDressings` aggregator (see "Boss-room dressing" in `game-architecture`).

## Reference examples

- `DynamiteSystem` — `constructor(private readonly gameMap: GameMap)`, `update(ctx)`, `render(...)`, exposes an `explosionSoundPending` flag the scene drains.
- `TreasureChestSystem` — no ctor deps; imperative API (`addWoodenChest`, `addBandChest`, `addOpenedChest`) plus callback setters (`setOnOpen`), opened through a `ChestKit` (see "Chests and ways out").
- `StairwellSystem` — `constructor(gameMap, levelDef, onDescend)`; `update(ctx)`, world render methods, and the state its prompt reads (`menuOpen`, `descentPrompt()`, `descend()`, `closeMenu()`); the prompt itself is a `choiceModalSurface` in `src/ui/screens/dialogs/stairwellPrompt.ts`.

## Checklist

1. **Class**: `class FooSystem implements GameSystem` in `src/systems/FooSystem.ts`. Constructor takes explicit deps — typically `gameMap`, sometimes `bus`, and an `addMob` callback if it spawns mobs (pass `(mob) => world.roster.add(mob)`).
2. **Construct**: add a field on `DungeonScene` and instantiate in its constructor near the other systems.
3. **Update**: call `this.foo.update(ctx)` in `DungeonScene.updateGameplay()`. Order matters — `src/systems/GameLoopPhases.ts` documents the 9 phases; place the call next to systems in the same phase.
4. **Render**: add render calls where appropriate. World-space entities that should Y-sort go through `RenderPipeline`'s entity pass (sorted by `.y`); world text and bars use `src/ui/world/`. Menus, dialogs and HUD pieces are never drawn from a system's render call: they are surfaces, top-band entries or toasts drawn in `ui.frame` (see `add-ui`).
5. **Input**: anything on screen that takes a press is a surface mounted on the scene's `UiRoot` (see below); world taps arrive only through the scene's `handleWorldPointer`. Keyboard — a surface's `onKey` gets keys first; gameplay keys go in `GameplayInputHandler`'s action bindings and respect `isSuppressed()`.
6. **Audio**: don't hold an audio reference — set pending flags the scene drains, or emit an EventBus event `AudioManager.wireEvents` maps to a sound (see `add-sound`).
7. **Events**: communicate with other systems via `bus.emit` / `bus.on` (`src/core/EventBus.ts`); add new event names to the `GameEvents` interface with a typed payload. `bus.on` returns an unsubscribe fn; the bus is cleared on scene exit.
8. **Cleanup**: implement `dispose()` if the system holds DOM listeners or timers.
9. **Overlay**: if it can raise a panel that owns the screen, give it a `surface()` and mount it on the scene's `UiRoot` (see below) rather than a new boolean on the scene.

Finish with the `dev-workflow` gates (typecheck, lint, format).

## Senses, room works and timed interactions

General mechanisms a quest supplies data to; never fork them for one quest.

- **Mobility** (`src/map/mobility.ts`, described in full in `add-level`). A system that moves a body or asks where one may go passes that body's `mobility` to every walkability and path query — never a literal class for a body it did not make. A system that moves a climber by its own collision code also asks `body.climbing?.crossInto(body, tileX, tileY)` before each axis step and takes no step when it answers true, and takes none at all while `body.isCrossingFooting`.

- **Senses** (`src/systems/senses/SenseLayer.ts`). `SENSES` is a `Record` over `SenseId` (`'scent' | 'ward'`), each entry naming `perceivedBy` (crawler kinds), how a source is painted (painters in `src/ui/world/worldSenses.ts`, inks in `worldPalette.senses`) and its `unperceived` look. A system registers a source on the scene's layer (`DungeonScene.senses`, `BuildingInteriorScene.senses` for the current storey) with `layer.add('scent', { points, sniffAt })` or `layer.add('ward', { segments, hurts, pulse })` and keeps the handle to `remove()` it. The layer fades a sense in over a beat when the steered crawler perceives it, paints it under the bodies, and puts a perceiving cat's nose down (`sniff`) at a `sniffAt` point she stops on. Scent drifts as soft wisps; a harmless ward glows and shimmers on `pulse()`; a harmful ward is a ground warning (`paintWardWarning` through `dangerTelegraph.ts`), full and pulsing for its perceiver and a faint steady red for everyone else (the fairness rule in `docs/difficulty-fairness-rules.md`). A new sense is a `SENSE_IDS` entry, a `SenseSources` field and a `SENSES` entry; one that can hurt uses `warning_when_harmful`.
- **Room works** (`src/systems/roomMechanisms/`): knock-off props, pressure plates and plate sets, conveyors and signal fixtures. `RoomMechanisms` runs a map's set: `update(ctx)` on world ticks, `tryInteract(crawler)` in the interact chain, `renderGround`, `sortedFigures()` in the sorted pass, `renderMarkers` and `renderPrompt` over it, and `hiddenProps()` merged into the room's hidden props. The data is described in `add-level` ("Room works"). Plate, knock-off and conveyor state lasts the visit; what must outlast it belongs to the owner's own progress record. A plate set's `onSetOpened` raises `plateSetOpened` on the bus, a conveyor raises `conveyorSent` / `conveyorSignalled`; the owner writes the outcome there, and on the next build calls `plates.settleOpen(id)` for a latching set it already opened. Systems watch the room through those events and `plates.isPlateHeld(id)`, never by reaching into the room works' state.
- **Timed interactions** (`src/systems/MashInteraction.ts`): one family sharing reach, prompt, a `worldBar` progress readout and persistence when the crawler walks off. `MashInteraction` (**press**: one heave per press), `TimingInteraction` (**timing**: a press counts only while its `MashWatcher.isLooking()` is false; one under its eye reports `seen` and the owner decides the cost; the bar switches to `watchedBarStyle`; the cat plays `latch_paw`) and `ChannelInteraction` (**channel**: one press starts it, `tick(worldHalted)` each frame runs it while the crawler stands there, walking off pauses it, a hit interrupts it and knocks back `damageSetbackShare` of the work; the human loops `humanRows`, the cat replays `channel`). Restore half-done work with `pressesDone` / `framesDone`. The owner places it, ticks a channel, routes the press and draws `renderPrompt` / `renderProgress`.

---

# Standing up a new scene from the kits

`src/systems/kits/` exists so a new place gets "everything the dungeon has" by
construction rather than by transplanting the dungeon's wiring a third time. A
**kit** is a plain class whose fields are concrete system types. There is
deliberately no string-keyed registry and no `GameSystem[]` loop: `update`
signatures are not uniform (`SeismicStompEffectSystem.update()` takes nothing,
`MobUpdateLoop.update(ctx)` takes the frame), so a homogeneous loop could only
be reached through casts.

`BuildingInteriorScene` is the worked example of every step below.

## 1. Build a `SceneWorld`

One per **map**. A scene with several maps (the tower's four storeys) builds one
per map and swaps which is active; a roster ticked against another floor's grid
runs that floor's fight while the player is somewhere else.

```ts
const spells = new SpellSystem();
const world: SceneWorld = {
  gameMap,
  bus: this.bus, // one bus per SCENE, shared across its maps
  audio: this.audio,
  pm: this.pm,
  roster: new MobRoster(gameMap, spells),
};
```

**One bus per scene, cleared once in `onExit`.** Several systems subscribe in
their constructors and declare no `dispose`; `bus.clear()` at teardown is the
only thing that stops their listeners outliving the scene. Wire it to audio
exactly once with `audio.wireEvents(bus)` — after that, a cue is chosen in
`AudioManager.wireEvents` rather than hand-played at each emit site.

## 2. Construct the kits

- **`CombatKit`** — spells, mob AI, attack/death resolution, gore, floating
  numbers, the seismic stomp blast, regeneration, the death screen. Construct it
  **unconditionally**: an empty roster costs nothing per frame, and it is what
  makes Space-to-attack and the ability hotbar work at all.
- **`DestructionKit`** — smashable props, floor loot, dynamite. Loot and dynamite
  are wanted everywhere, so construct it always; a map whose props are
  architecture rather than scenery (the outdoor town's street torches and gate
  braziers) passes `breakableProps: NO_BREAKABLE_PROPS` instead of going without
  the kit.
- **`MenusKit`** — bag, gear screen, pause menu, award stack, toast strip,
  potion drinking, skill-book flow. One per scene.
- **`ChatKit`** — the chat box and the universal cheat table. One per scene.
  Pass `sceneCommands` for anything only this scene can answer.
- **`CutsceneKit`** — the cutscene director (`src/systems/cutscene/`) and the
  surfaces that hand it the party and draw its fade. Mount `surfaces(...)`, call
  `tickWorld(active, map, southAnchor)` in the movement phase and skip the
  player's own movement while it returns true, and fold `isActive` into
  anything that asks "does a script own the party". A script is a list of
  `CutsceneStep`s (walk, glide, join, hide/show, talk, Caroline's message,
  the guide teleporting out, a wait, `panCamera`/`holdCamera`/`returnCamera`,
  `shake` with a `ShakeProfileId` from `SHAKE_PROFILES`, `fade`, `sound` with
  a cue's `takes`, `playCue`/`waitForCue`, and `run` with a world action)
  given to `director.play(script, onComplete?)`; never hand-roll another party
  lock, camera pan, fade or cutscene shake. `scriptOwnsParty` folds in
  `isActive`, and that is the only lock a script needs. Its deps are the
  scene's one `Conversation`, `teleportDaveOut`, `playSound`
  (`cutsceneSoundPlayer(audio)`), `runWorldAction`, `cueClock`
  (`cutsceneCueClock(audio)`) and the HUD's `pauseButton`.
  - **Actors.** `CutsceneKit<Action, ActorId>` takes the scene's actor-id
    union too. A script names a body by id, never by reference: the active
    crawler is always `'activeCrawler'`, and anything else is registered once
    with `director.actors.register(id, () => actor | null)`. The lookup runs
    each time a step names the id, so an actor not in the world (a crawler
    away with her group, a mob not yet spawned) answers null and the step
    moves straight on. An actor is a `CutsceneActor`
    (`src/systems/cutscene/cutsceneActors.ts`); build it with `bodyActor`
    (a crawler or quest NPC, walked by `applyMovement`), `townspersonActor`
    (an occupant, held by `Townsperson.scripted`) or `stagedActor` (a body a
    system paints for its scripts alone, with no AI or roster). A
    crawler's `hold` goes to `CompanionSystem.holdForScript`, so the
    companion drive leaves the body to the script. Every actor a script moves
    is held from its first move until the script ends.
    The dungeon's ids are `DungeonActorId` (`'human' | 'cat'`, in
    `dungeonWorldActions.ts`); the interior's are `InteriorActorId` (both
    crawlers and `` `resident:${ResidentId}` `` for any resident in the room,
    in `src/scenes/interiorCutscene.ts`). A quest system adds an id to the
    union and registers its actor where it spawns it.
  - **Walks and glides.** `walkTo { who, tile, face, then }` paths with the
    actor's own mobility class. The active crawler is the player's body and is
    never teleported: a walk-up searches `WALK_UP_MAX_PATH_TILES` and gives up
    after `WALK_UP_TIMEOUT_FRAMES`, ending where they stand. Any other actor
    gets a time allowance from their path and pace
    (`SCRIPTED_WALK_TIME_SLACK`), and a walk with no path or out of time sets
    them down on the tile, so a script never hangs. `glideTo { who, to, frames,
face, then }` carries a body in a straight line in world pixels, through
    walls: a drop from above, a body thrown aside, a crawler lifted away.
    `then: 'waitForArrival'` holds the script; `'carryOn'` sets the move off
    and runs the next step at once, so several bodies move together, and
    `awaitActor { who }` joins one later. A script that ends with a move still
    under way sets it down at its end.
  - **Hiding.** `hideActor`/`showActor` take a body out of sight and back,
    past the end of the script, until a checkpoint restore. Hidden is unseen
    only: the scene's render pass leaves out every body `director.hides(body)`
    answers true for (both scenes filter crawlers and mobs, and the interior
    its occupants), and nothing else changes. A new render pass that draws
    bodies asks it too.
  - **Fade.** `fade { to, frames }` eases the kit's full-screen fade (the
    `screenFadeSurface` the prison's capture uses) to `to` and holds the
    script until it gets there. A script that ends black stays black for
    `FADE_HOLD_AFTER_SCRIPT_FRAMES`, long enough for the scene change it hands
    over to, then clears on its own; a script that stays in the scene fades
    back itself.
  - **Timed to a cue.** `playCue { cue }` starts a jingle this instant through
    `AudioManager.playNow` and starts its clock; `waitForCue { cue, atS }`
    holds the script until the cue has played `atS` seconds on the audio
    clock, so a drop lands on the recording's hit. Keep the marks as named
    constants beside the cue's id. The cue's SFX group must be decoded where
    the script plays: a cue that cannot start this instant stays silent
    rather than late, and its waits count world ticks
    (`WORLD_TICKS_PER_SECOND`) instead. A clock that stops moving (a context
    the browser suspended) lets a wait go `CUE_CLOCK_STALL_GRACE_S` past its
    mark.
  - The camera and the shake: the scene asks `director.cameraFocus(leader)` in
    its camera chain and adds `director.cameraShake` after clamping;
    `tickWorld` advances both on every world tick, cutscene or not. A script
    that ends with the camera away from the leader hands it straight back.
  - World actions are owned by the scene: `CutsceneKit<Action>` takes the
    scene's union, and a scene with none leaves it `never` and passes
    `noWorldActions`. The dungeon's is `DungeonWorldAction`
    (`src/scenes/dungeonWorldActions.ts`, e.g. `gatherParty`): a new kind is
    one entry in `DungeonWorldActionPayloads` plus its handler in the host
    object `DungeonScene` passes to `runDungeonWorldAction`. The interior's is
    `InteriorWorldAction` (`src/scenes/interiorCutscene.ts`, e.g.
    `setPartyDown`), built the same way and run by `runInteriorWorldAction`.
    A quest's own beat (spawning its creature and registering it as an actor,
    setting a prop) is one payload entry delegating to its system, as
    `floodedPumpRoom` does.
  - `verify:kits` runs every general step headless (`scripts/kitsCutsceneChecks.ts`);
    a new step gets a case there and a `--fault=` that must turn it red.
  - A death a script shows (`ScriptedDeathKind`, `SCRIPTED_DEATHS` in
    `src/systems/scriptedDeath/`) is played with
    `DungeonScene.scriptedDeaths.play(kind, victim, at)`, or on several
    crawlers at once after a lead-in cutscene with `playTogether`: it holds
    the party through a cutscene, hides the victim, paints the animation and
    decal, throws the def's gore, and kills through `Player.dieScripted`, past
    9 Lives. A new one is a kind, a def (painter, decal, gore, delay,
    `DeathCause`, cue and the frame it plays on) and its death lines.
  - A `carolineMessage` step says whether the world `runs` or `halts` under
    it. Her story messages run; her time-limit verdict halts everything.
  - A walk-up is `walkUpTo(map, speakerTile, crawlerTile)`
    (`src/systems/cutscene/walkUp.ts`); the companion follows by its own drive.
    A walk that cannot finish gives up after `WALK_UP_TIMEOUT_FRAMES` and the
    talk plays from where the crawler stands.
  - Steps start only on a world tick, so a script never opens over the pause
    menu, and a move, a wait or a fade stops while the world is halted. A talk halts the
    world itself, cannot be dismissed or walked away from, and ends its step on
    its last page. A Caroline message does not halt the world.
  - A cutscene asked for while one plays is queued, and `isActive` stays true
    until the queue is empty.
  - Story moments are not scripted by hand: `StoryDelivery`
    (`src/systems/StoryDelivery.ts`) builds Dave's walk-up talks and queues
    Caroline's messages on the director from what `StoryDirector` says is due
    (`add-quest`, `docs/world-and-story.md`).

Kit construction order matters where a kit's constructor has side effects: a
quest encounter spawns mobs and starts music the moment it is built, so build it
_after_ audio and bus wiring.

## 3. Drive the frame

The kits do not hide the frame. They collapse the orderings that are _internal_
to a kit (spells before mob AI; attacks before kills) behind phase-named methods,
and the scene still calls them in the order `src/systems/GameLoopPhases.ts`
documents:

```ts
combat.updatePlayerAttacks();
combat.updateMobs(ctx);
combat.drainMobAudioCues(audio); // before anything can leave the roster
combat.resolvePlayerAttacks({ destructibles: destruction.destructibles });
// ... anything that intercepts an ally's death must run HERE ...
combat.resolveKills();
combat.resolveSpellAftermath();
combat.playerTick.update(ctx);
combat.updatePostCombat(audio);
destruction.update(ctx);
destruction.drainAudioCues(audio);
```

A scene that skips a phase does so visibly. A scene that calls them in this order
cannot re-derive the ordering bug class.

## 4. Bind `GameplayInputHandler`

One callback object gives every scene the same meaning for `i`, `g`, `q`, Space,
Tab, Enter, `m`, `f` and 1–8. Five actions are optional — leave one out rather
than binding a handler that does nothing. Hotbar presses go through
`activateHotbarSlot` (`src/systems/kits/hotbarActions.ts`); a scene's own slots
get first refusal through `trySceneSlot`.

## 5. Mount surfaces

Each scene owns one `UiRoot` (`src/ui/core/UiRoot.ts`, built with
`createSceneUi`) and mounts every surface once. The stack — band, then open
order — is the single source of truth for "a menu is up": draw order, which
surface a press reaches, where Escape goes, `ui.worldHalted()`,
`ui.keyboardLocked()` and `surfacesOverHud(ui)` (interaction-prompt
suppression) all read it, so they cannot drift apart. Each surface declares:

- `band` — `hud`, `panel` (floats; blocks only its own area), `modal` or
  `system` (cover the screen).
- `haltsWorld` — does the world stop? False only for overlays the player must be
  able to walk during (a street conversation ends _because_ they walked off).
- `locksKeyboard` — is the rest of the keyboard locked out without halting?
- `close` — present means Escape closes it; `blocksEscape` stops Escape entirely.

A key a surface consumes is spent until it is released (`SceneManager`), so the
Space that turns a dialog's last page can never, held, reopen it in the polled
interaction chain. Gate a polled chain on `surfacesOverHud(ui).length === 0` — withhold,
don't `input.clear()`, which drops the movement keys too, and the one overlay
that reaches that line is the conversation the player has to be able to _walk
away from_.

## 6. Tear down

`onExit` must: `bus.clear()`, dispose **every** kit it built (a multi-map scene
disposes all of them — each `CombatKit` holds a `MobUpdateLoop`, whose pack-alert
grid is a module-level handle that pins the whole roster) and unbind the input
handler. `SceneManager` disposes the scene's `UiRoot`.

## 7. Give the place something to fight

Once the kits are up, a fight is _content_: the scene adds its hostiles through the
roster that room already has (`AnchorInteriorSystem`'s temple vermin are the worked
example), placed with `distinctSpawnTiles` and `inPlainViewOnTheWayIn`
(`src/systems/interiorSpawnTiles.ts`). A regenerated interior restocks whatever it
spawns from its own layout every time the door opens, so a fight that must stay
won remembers so in a record that outlives the scene (`TownMemory` or the quest's
own progress), or it becomes a farm.

### Chests and ways out

Every scene that has chests owns one `ChestKit` (`src/systems/kits/ChestKit.ts`) and
`bind`s each of its maps' `TreasureChestSystem`s to it, so a press, the lid heave, the
reward card and the fly-to-HUD are the same everywhere. `DungeonScene` and
`BuildingInteriorScene` both do; never copy that wiring into a third place. A scene
with a reward of its own (the tutorial's first chest) passes `ChestKitDeps.reward`.

Indoors, a quest fight comes to life through `BuildingInteriorScene.startEncounter(floor,
make)`, whose `make` gets the floor's `addMob` and its `InteriorEncounterFixtures`:

- `chests`, a `ChestPlacer` (`chestPlacer`): `heldByBand(tile, loot)` places a chest locked
  from the start, `postChestBand(chest, mobs)` posts the band that holds it once they
  are called out, and it unlocks when the last of them is dead; `opened(tile, type)` is a
  chest a previous visit emptied. Both block the chest's tile.
- `exits`, the floor's `InteriorExitFixtureSystem` (`src/systems/interiorExitFixtures.ts`):
  a way out that is a thing in the room (a ladder, a trapdoor, a window). A kind is one
  entry in `INTERIOR_EXIT_FIXTURES` (prompt, `departure` immediate or a fade, sound);
  `place({ id, at })` stands one in the room, and using it asks the door mat's leave
  question and runs the scene's own exit, so the party comes out at the building's door.
  A new kind is a data entry, not scene code.

`StarlightTentFinale` (`src/systems/starlightTent/`) is the worked example: a clown band
called out on first entry to the centre ring, the chest they hold, and the `rope_ladder`
exit. Its gate is `npm run verify:starlight-tent`.

## 8. Verify

`npm run verify:kits` is the headless gate over the spine and the kits: the spawn
path, roster identity across a checkpoint rewind, a kill paying out, floor loot
surviving the door, destructibles indoors, `dispose` releasing the pack-alert
grid, and a room gaining a fight from content alone. Run it after any change to
`src/systems/kits/`.

## Design debt

If this work turns up hacky code, a fragile coupling, or a design that will make the next change harder, and it is beyond your task, record it in `docs/design-debt.md` (rules and entry shape are at the top of that file). Before building on a system, check that file for entries about it and honour their **Until then** lines.
