---
name: add-system
description: Add a new gameplay mechanic to Kitten Crawler Man as a GameSystem class — constructor deps, update ordering, rendering, input routing, disposal. Also the recipe for standing up a whole new scene from the kits in src/systems/kits/. Use when a feature doesn't fit an existing system in src/systems/.
---

# Add a Game System

Mechanics live as plain classes in `src/systems/` implementing `GameSystem` (`src/systems/GameSystem.ts`): optional `update(ctx: SystemContext)` and `dispose()`. `SystemContext` carries per-frame shared state: `human, cat, active, inactive, activeIsMoving, roster, gameMap, bossRoom?, extraTargets?`.

`ctx.roster` is a `MobRoster` (`src/systems/kits/SceneWorld.ts`): `roster.mobs` is the list, `roster.grid` the spatial index, and `roster.add(mob)` is the **only** way a mob joins a scene — it inserts into both and hands the mob the scene's map and spell context. Never push into one without the other; a mob that misses `setSpells` walks straight through a protective shell.

First check whether an existing system already owns the domain (~30 in `src/systems/` — combat, loot, barriers, dynamite, shops, gore, minimap, ...). Extend it if so.

## Reference examples

- `DynamiteSystem` — `constructor(private readonly gameMap: GameMap)`, `update(ctx)`, `render(...)`, exposes an `explosionSoundPending` flag the scene drains.
- `TreasureChestSystem` — no ctor deps; imperative API (`addWoodenChest`) plus callback setters (`onChestOpened`).
- `StairwellSystem` — `constructor(gameMap, levelDef, onDescend)`; `update(ctx)`, `handleClick(mx, my, canvas): boolean`, separate render methods for world vs. menu.

## Checklist

1. **Class**: `class FooSystem implements GameSystem` in `src/systems/FooSystem.ts`. Constructor takes explicit deps — typically `gameMap`, sometimes `bus`, and an `addMob` callback if it spawns mobs (pass `(mob) => world.roster.add(mob)`).
2. **Construct**: add a field on `DungeonScene` and instantiate in its constructor near the other systems.
3. **Update**: call `this.foo.update(ctx)` in `DungeonScene.updateGameplay()`. Order matters — `src/systems/GameLoopPhases.ts` documents the 9 phases; place the call next to systems in the same phase.
4. **Render**: add render calls where appropriate. World-space entities that should Y-sort go through `RenderPipeline`'s entity pass (sorted by `.y`); overlays/menus render after the pipeline.
5. **Input**: mouse — add a `handleClick(...): boolean` and insert it into the scene's `handleClick` priority chain (return `true` to consume; order in that chain is the UI stacking order). Keyboard — add to `GameplayInputHandler`'s action bindings and Esc chain; respect `isSuppressed()`.
6. **Audio**: don't hold an audio reference — set pending flags the scene drains, or emit an EventBus event `AudioManager.wireEvents` maps to a sound (see `add-sound`).
7. **Events**: communicate with other systems via `bus.emit` / `bus.on` (`src/core/EventBus.ts`); add new event names to the `GameEvents` interface with a typed payload. `bus.on` returns an unsubscribe fn; the bus is cleared on scene exit.
8. **Cleanup**: implement `dispose()` if the system holds DOM listeners or timers.
9. **Overlay**: if it can raise a panel that owns the screen, add a claim to the scene's `overlayClaims` getter (see below) rather than a new boolean on the scene.

Finish with the `dev-workflow` gates (typecheck, lint, format).

---

# Standing up a new scene from the kits

`src/systems/kits/` exists so a new place gets "everything the dungeon has" by
construction rather than by transplanting the dungeon's wiring a third time. A
**kit** is a plain class whose fields are concrete system types. There is
deliberately no string-keyed registry and no `GameSystem[]` loop: `update`
signatures are not uniform (`SmushEffectSystem.update()` takes nothing,
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
  numbers, the smush blast, regeneration, the death screen. Construct it
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

## 5. Compose overlay claims

`overlayClaims` is one ordered list of everything that can own the screen, and it
is the single source of truth for "a menu is up". `keyboardSuppressed`,
`focusedOverlay`, `advanceFocusedOverlay` and `worldHalted`
(`src/systems/kits/OverlayClaims.ts`) all read it, so the keyboard gate, the
Space chain, the mobile tap route and the "is the world paused" test cannot drift
apart. Each claim declares:

- `locksKeyboard` — is the rest of the keyboard locked out?
- `haltsWorld` — does the world stop? False only for overlays the player must be
  able to walk during (a street conversation ends _because_ they walked off).
- `space` — `advance` (with the call), `swallow`, or `passThrough` (the chat box
  alone, whose DOM input needs the space character itself).

Whatever owns the screen has already had the press by the time a scene's own
_polled_ interaction chain runs, so that chain has to be told. Two rules, both
learned the hard way:

- Withhold, don't clear. A scene that polls gates its chain on
  `focusedOverlay(claims) === null`; calling `this.input.clear()` there drops the
  movement keys too, and the one overlay that reaches that line is the
  conversation the player has to be able to _walk away from_.
- Mark the press spent the moment it is taken. `advanceFocusedOverlay` reports
  `'advanced' | 'swallowed' | 'ignored'`; anything but `'ignored'` means the
  press is gone, and the scene has to remember that, because a page turn that
  closes the last page leaves no claim behind and the polled chain would read the
  same press as "start that conversation again". Remember it in a flag re-armed
  from the key _events_ (`interactPressStarted` / `interactReleased`), never from
  `input.clear()` or the held-key set — a scene cannot tell its own clear apart
  from a finger coming off the key.

## 6. Tear down

`onExit` must: `bus.clear()`, dispose **every** kit it built (a multi-map scene
disposes all of them — each `CombatKit` holds a `MobUpdateLoop`, whose pack-alert
grid is a module-level handle that pins the whole roster), `clearButtonMouseState()`,
and unbind the input handler.

## 7. Give the place something to fight

Once the kits are up, a fight is _content_. `src/systems/interiorHostiles.ts` is
the worked example: a table says which room holds what, the scene adds them
through the roster that room already has, and `TownMemory.clearedRooms` remembers
that the room was cleared — without which a regenerated interior restocks its
guards every time the door opens, turning a fight into a farm.

## 8. Verify

`npm run verify:kits` is the headless gate over the spine and the kits: the spawn
path, roster identity across a checkpoint rewind, a kill paying out, floor loot
surviving the door, destructibles indoors, `dispose` releasing the pack-alert
grid, and a room gaining a fight from content alone. Run it after any change to
`src/systems/kits/`.
