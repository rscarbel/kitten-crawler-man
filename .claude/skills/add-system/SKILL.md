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
  surface that hands it the party. Mount `surface()`, call
  `tickWorld(active, map, southAnchor)` in the movement phase and skip the
  player's own movement while it returns true, and fold `isActive` into
  anything that asks "does a script own the party". A script is a list of
  `CutsceneStep`s (walk-up, talk, Caroline's message, the guide teleporting
  out, a wait) given to `director.play(script, onComplete?)`; never hand-roll
  another party lock. Its deps are the scene's one `Conversation`,
  `teleportDaveOut` and the HUD's `pauseButton`.
  - A walk-up is `walkUpTo(map, speakerTile, crawlerTile)`
    (`src/systems/cutscene/walkUp.ts`); the companion follows by its own drive.
    A walk that cannot finish gives up after `WALK_UP_TIMEOUT_FRAMES` and the
    talk plays from where the crawler stands.
  - Steps start only on a world tick, so a script never opens over the pause
    menu, and a walk or a wait stops while the world is halted. A talk halts the
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

Once the kits are up, a fight is _content_. `src/systems/interiorHostiles.ts` is
the worked example: a table says which room holds what, the scene adds them
through the roster that room already has, and `TownMemory.clearedRooms` remembers
that the room was cleared — without which a regenerated interior restocks its
guards every time the door opens, turning a fight into a farm.

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
