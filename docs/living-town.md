# Living Town Plan — Making the Over City Feel Alive

**Goal:** the third-floor town should feel like an inhabited, active settlement — characters moving around, buildings that look used, citizens worth talking to, and things to do — instead of an empty stage. This is a _separate workstream_ from the third-floor questlines (circus / murder mystery / doomsday), which are already implemented — see [over-city-reference.md](over-city-reference.md) for source-material background on that content. This doc is purely about **ambient life, interior richness, and town interactivity**.

This document is both the design and the step-by-step tracker. Each phase is independently shippable and leaves the game playable. Check boxes off as steps land. Validation gates (`npm run typecheck`, `npm run lint`, `npm run format`) apply after **every** step.

---

## Part 1 — Where we are today

**What exists and works:**

- **A procedural people generator** — `src/sprites/person/`: `generatePersonAppearance(seed)` produces a seeded genome (skin, hair, top style, colors, face), and `drawPerson(ctx, cx, sy, size, appearance, phase, facing, moving)` renders a 4-facing skeletal walk. **Today it is only used by `PersonPreviewScene` (the `?people` dev harness) — it is not in gameplay at all.**
- **A working wandering-NPC AI** — `DesperadoClubSystem`'s `Patron` model (`src/systems/DesperadoClubSystem.ts`, ~lines 46–120, 261–300): pick a random point, walk to it at a per-agent speed, pause, repeat, tracking `facingX` and a walk phase. This is the pattern to generalize — but note the club draws patrons with `clubNpcSprite`, **not** the procedural generator.
- **A reusable dialog box** — `src/ui/DialogBox.ts`: speaker + typewriter body text, sound-synced, space/click to advance. Used by quests and the club.
- **Rich static interiors** — `GameMap.generateInterior()` (`src/map/GameMap.ts:340`) hand-crafts furnished layouts for 10 named buildings (Rusty Anvil, Sleeping Cat Inn, Shepherd's Cabin, Herb & Remedy, Sunken Stump Pub, etc.) plus the restaurant/store/club/tower. Furniture tile types exist: `TABLE`, `CHAIR`, `BARREL`, `BED`, `FIREPLACE`, `BOOKSHELF`, `RUG`, `CRATE` (`src/map/tileTypes.ts`).
- **Town geography** — `OverworldGenerator.ts` exports `OverworldData` with `buildingEntries`, `townSafeRadiusTiles`, town square, fountain, wells, torches, roads. `BuildingSystem` maps building footprints to enterable `BuildingEntry`s (`type: 'house' | 'tower' | 'restaurant' | 'store' | 'club'`).
- **The AI bridge** — `AIAdapter` already generates dynamic dialog for Mordecai with a scripted fallback (`SafeRoomSystem` + `aiAdapter.chatWithMordecai`); the same pattern can power citizen chatter.

**What's dead (the gap this plan closes):**

1. **The streets are empty.** Only 12 passive `sky_fowl` drift around the map centre. No people walking the square, no crowds, no sense of a populace.
2. **Interiors are museums.** Every named-building interior is furniture with nobody in it. A forge with no smith, an inn with no patrons, a farm with no farmer. No reason to walk in.
3. **Nobody to talk to.** `NonCombatantNPC` is a one-line stub. There's no generic "walk up to a citizen, press Space, get a varied line" system. Dialog only exists for quest-critical NPCs.
4. **Nothing to do in town** beyond the shop, the safe-room bed, and the club. No notice board, market stalls, street activities, or ambient interactions.
5. **The procedural generator is unused** — the single biggest lever for variety is sitting on the shelf.

---

## Part 2 — Target architecture

Five new/extended pieces of tech, built once and reused across streets and interiors:

### 2.1 `Townsperson` entity — `src/creatures/Townsperson.ts`

A lightweight non-combatant citizen. **Not** a `Mob` (no aggro/pathfinding/loot) and **not** a `Player`. Fields:

- `appearance: PersonAppearance` (from a seed) and `phase` / `facing` / `moving` for `drawPerson`.
- Position (`x`, `y` in world pixels), `speed`, wander/schedule state.
- `role: TownRole` (see 2.4) — drives appearance bias, dialog, and behavior.
- `homeBuilding?` / `workStation?` anchors for schedules (Phase 5).
- `render(ctx, camX, camY, tileSize)` → `drawPerson(...)` + optional overhead marker (a `…` speech tick or `?` for quest hooks).
- `interactRadius` and a `talk()` hook returning the next dialog line(s).

Generalize the club's `Patron` wander logic into a shared helper `src/creatures/townWander.ts` (`stepWander(agent, isWalkable, dt)`) so both `Townsperson` and the club's patrons can use it (refactor the club to consume it — removes duplication).

### 2.2 `TownLifeSystem` (overworld) — `src/systems/TownLifeSystem.ts`

A `GameSystem` owned by `DungeonScene`, active only on overworld/town levels. Responsibilities:

- Spawn N townsfolk seeded from level config; place them on walkable street/square tiles inside `townSafeRadiusTiles`, avoiding building footprints, roads-as-needed, and the player.
- Each frame: advance wander/schedules via the shared helper; keep them on walkable tiles (query `GameMap` walkability); cull/de-spawn far from the player for perf, respawn to maintain density near the plaza.
- Register townsfolk into the scene's **Y-sorted entity render pass** (`RenderPipeline`) so they sort correctly against the player, buildings, and mobs. Being renderable is enough — mirror how entities are drawn in `RenderPipeline.ts`.
- Proximity interaction: when the active player is within `interactRadius` and presses Space (routed through `DungeonInputHandler`), open a citizen `DialogBox` (Phase 3). Must yield priority to combat/quest interactions (see `DungeonScene` ~line 1879 "Allies must not force attack-priority over talking").
- Danger reactions (Phase 5): when hostile mobs breach the town or the doomsday escape begins, townsfolk flee toward the stairwell / scatter.

### 2.3 `InteriorOccupantSystem` — `src/systems/InteriorOccupantSystem.ts`

The interior analog, owned by `BuildingInteriorScene`. Populates a building's interior with role-appropriate occupants who perform **stationed activities** rather than free wander:

- A data table keyed by building name/type → occupant list with `{ role, activity, anchorTile }`. Activities: `tend_counter`, `sit_at_table`, `sleep_in_bed`, `sweep`, `work_forge`, `browse_shelf`, `idle`.
- Occupants mostly stay near their anchor with small idle motion (face-turns, occasional short steps); some (patrons, kids) wander a bounded area.
- Reuse `Townsperson` + `drawPerson`; render in the interior's entity pass (the scene already Y-sorts entities in `render()`).
- Interaction: Space near an occupant → interior `DialogBox` line. The forge smith / innkeeper / shopkeeper can double as flavor or hooks.
- **Do not** add occupants to the live quest-encounter interiors (Big Top boss, Blackwood Barracks cult, tower confrontation) while those encounters are active — gate on the same progress flags `initEntryEncounter` checks.

### 2.4 Citizen roles & dialog — `src/systems/townDialog.ts` (+ `TownRole`)

- `TownRole` enum/union: `guard`, `merchant`, `farmer`, `smith`, `innkeeper`, `priest`, `child`, `drunk`, `noble`, `beggar`, `laborer`, `skyfowl` (bird-folk citizen), `commoner`.
- Extend the person genome (`add-person` skill) so a role can **bias** appearance (guard → helmet/uniform palette, farmer → drab tones + hat, child → smaller scale, noble → rich colors). Keep it a bias over the existing seeded genome, not a rewrite.
- A **dialog table**: `Record<TownRole, string[]>` of ambient lines, plus **context-tagged** lines keyed by game state (quest progress, recent events from `AchievementManager.getTopRecentEvents`, time-of-day, whether the ruins are dangerous). Lines rotate so repeat talks vary.
- **Rumor/gossip layer**: a pool of lines that react to `EventBus` events and quest flags — e.g. after the circus quest, citizens mention the freed performers; during the murder mystery, nervous whispers about the killings; if a boss is undefeated, warnings about the ruins. Pull live flags from `CircusQuestProgress` / `MurderQuestProgress` / `DoomsdayProgress`.
- **Optional AI dialog**: for a subset of citizens, call `AIAdapter` (as Mordecai does) for a dynamic line, with the scripted table as the guaranteed fallback when AI is disabled/slow. Keep it opt-in and cheap.

### 2.5 Interactive town props — extend `BuildingSystem` / a new `TownPropSystem`

Small interactable world objects with a proximity prompt (`drawText` prompt, like existing interaction prompts) and a Space action:

- **Notice / bounty board** in the square: opens a panel summarizing active/available quests and "bounties" (flavor wrappers around existing content) — gives a _reason_ to read the town state.
- **Market stalls** flanking the square: buy flavor snacks/consumables (reuse `ShopSystem` with a small stock), or just barks from the vendor.
- **Wells / fountain**: flavor interaction (drink → tiny heal or just a line); already-placed props (`OverworldGenerator` lines ~810–843).
- **Benches / campfires**: sit animations / rest.
- Reuse existing prompt + click-routing patterns; don't invent new input plumbing.

---

## Part 3 — Phased implementation

### Phase 0 — Foundations (enabling tech, no visible content yet)

Build the reusable spine so later phases are data, not plumbing.

- [ ] **0.1** Create `src/creatures/Townsperson.ts`: holds `PersonAppearance`, position, `facing`, `phase`, `moving`, `role`, `speed`; `render()` delegates to `drawPerson`; `update(dt, isWalkable)` advances walk phase and position. No dialog yet. (Skill: `add-person`, `add-creature` for the entity shape.)
- [ ] **0.2** Extract the club's patron wander into `src/creatures/townWander.ts` (`stepWander`), and refactor `DesperadoClubSystem` to use it — verify no visual regression in the club. (Skill: `add-system`.)
- [ ] **0.3** Add a `TownRole` union + a role→appearance bias helper in `src/sprites/person/PersonAppearance.ts` (e.g. `generatePersonAppearance(seed, role?)`). Keep existing callers working (role optional). (Skill: `add-person`.)
- [ ] **0.4** Add a minimal generic dialog surface: a `CitizenDialog` wrapper around `DialogBox` that takes a line array and cycles. (Skill: `add-ui`.)
- [ ] **DoD:** typecheck/lint clean; `?people` preview still works; club patrons still wander; nothing else visibly changed.

### Phase 1 — Living streets

Fill the town square and streets with moving citizens.

- [ ] **1.1** Create `src/systems/TownLifeSystem.ts` (a `GameSystem`). Constructor takes the `GameMap`, town centre + `townSafeRadiusTiles`, a walkability predicate, and a target population. Spawn townsfolk on walkable non-building tiles, denser near the plaza.
- [ ] **1.2** Wire it into `DungeonScene`: construct it for the overworld (guard on level being the town/overworld), `update()` it in the gameplay loop (see `GameLoopPhases` ordering), and render townsfolk in the Y-sorted entity pass (`RenderPipeline`). Add distance culling + respawn to hold density.
- [ ] **1.3** Recast the 12 `sky_fowl` as bird-folk _citizens_ (role `skyfowl`) integrated into the crowd, or keep them as ambient fauna and layer humans on top — pick one and make the mix read as a populace.
- [ ] **1.4** Ambient motion polish: varied speeds, natural pausing, face-turns, avoid clumping, keep off building doors so entrances stay usable.
- [ ] **1.5** Minimap: show townsfolk as faint dots (`MiniMapSystem`) — optional.
- [ ] **DoD:** the square visibly bustles; citizens never walk through walls/buildings or block doors; no perf drop with the crowd; typecheck/lint clean.

### Phase 2 — Lived-in interiors

Put occupants and activity inside buildings.

- [ ] **2.1** Create `src/systems/InteriorOccupantSystem.ts` and a per-building occupant data table (building name → occupants with role + activity + anchor tile derived from the hand-crafted layouts in `GameMap.generateInterior`).
- [ ] **2.2** Wire it into `BuildingInteriorScene` for non-encounter interiors (skip when a live quest encounter occupies the building). Render occupants in the interior entity pass; update stationed/idle motion each frame.
- [ ] **2.3** Author occupants for the marquee buildings first: Rusty Anvil (smith at the forge), Sleeping Cat Inn / Wanderer's Rest (innkeeper + patrons at tables), Sunken Stump Pub (barkeep + drinkers), Miller's Farm (farmer), Herb & Remedy (apothecary), Shepherd's Cabin (shepherd). Give the restaurant/store their existing NPCs company where it fits.
- [ ] **2.4** Make more houses enterable and occupied so wandering in is rewarded (extend `BuildingSystem` entries / `generateInterior` for generic occupied homes). Add lived-in props/ambience (lit fireplaces, clutter) where cheap — reuse existing furniture tiles.
- [ ] **2.5** Interior ambient audio per building type (forge clangs, tavern murmur, hearth crackle) via `add-sound` / `AudioManager`.
- [ ] **DoD:** every named building has believable occupants doing role-appropriate things; encounters unaffected; entering buildings feels rewarding; typecheck/lint clean.

### Phase 3 — Citizen dialog variety

Make talking to people worthwhile and varied.

- [ ] **3.1** Build `src/systems/townDialog.ts`: role-keyed ambient line pools + context-tagged lines (time-of-day, danger state, quest flags). Rotation so repeats vary.
- [ ] **3.2** Rumor/gossip layer reacting to `EventBus` events and quest progress (`CircusQuestProgress`, `MurderQuestProgress`, `DoomsdayProgress`, recent `AchievementManager` events) — citizens comment on what the player has actually done.
- [ ] **3.3** Wire Space-to-talk in both `TownLifeSystem` and `InteriorOccupantSystem` (proximity + prompt + `CitizenDialog`), yielding priority to combat/quest interactions.
- [ ] **3.4** Passing "barks" — occasional short overhead one-liners as the player walks near a citizen (no interaction needed), throttled so it's flavor not spam.
- [ ] **3.5** Optional AI-generated lines for a subset of citizens via `AIAdapter`, with the scripted table as guaranteed fallback (mirror `chatWithMordecai`).
- [ ] **DoD:** citizens across roles/buildings give distinct, context-aware lines; dialog reflects quest progress; no repetition fatigue in a normal play session; typecheck/lint clean.

### Phase 4 — Things to do in town

Give the player reasons to linger and interact.

- [ ] **4.1** Notice / bounty board in the square (`TownPropSystem` + a panel via `add-ui`): surfaces active/available quests and bounties, pulling from `QuestManager` and quest-progress state.
- [ ] **4.2** Market stalls flanking the square: small `ShopSystem` stocks (snacks/flavor consumables) and vendor barks. (Skill: `add-item` for any new consumables, `add-system`.)
- [ ] **4.3** Fountain / well / bench interactions (drink, rest, small flavor or micro-heal). Reuse placed props from `OverworldGenerator`.
- [ ] **4.4** At least one light activity/minigame beyond the existing club casino — e.g. a street performer to tip, a fortune teller, or a tavern dice game. Keep scope small; one polished activity beats three stubs.
- [ ] **4.5** Interior activities where they fit (buy a drink at the pub for a short buff, listen to a bard for a rumor).
- [ ] **DoD:** a player with no active quest still has 3–4 meaningful things to interact with in town; each is discoverable via prompts; typecheck/lint clean.

### Phase 5 — Polish & reactivity

- [ ] **5.1** Day/night or floor-timer-driven schedules: citizens move between home/work/square over the floor's timeline; density and behavior shift with time.
- [ ] **5.2** Danger reactions: when hostile mobs breach the town-safe radius or the doomsday escape begins, townsfolk flee toward the stairwell / scatter and panic-bark (ties into `DoomsdayEscapeSystem`).
- [ ] **5.3** Reputation/progress reactions: citizens greet the player differently as quests complete (hero welcome after the circus, gratitude/fear during the murders).
- [ ] **5.4** Ambient town soundscape layer (crowd murmur, market, distant clangs) mixed under `OverworldMusicSystem`.
- [ ] **5.5** Performance pass: cull/pool townsfolk, cap on-screen count, profile the crowd + interiors.
- [ ] **DoD:** the town's life visibly responds to time and player actions; the doomsday evacuation is populated by fleeing citizens; frame rate holds with a full crowd.

---

## Part 4 — Progress tracker

| Phase | Title                                                                | Status        |
| ----- | -------------------------------------------------------------------- | ------------- |
| 0     | Foundations (Townsperson, wander helper, role genome, CitizenDialog) | ☐ Not started |
| 1     | Living streets                                                       | ☐ Not started |
| 2     | Lived-in interiors                                                   | ☐ Not started |
| 3     | Citizen dialog variety                                               | ☐ Not started |
| 4     | Things to do in town                                                 | ☐ Not started |
| 5     | Polish & reactivity                                                  | ☐ Not started |

Update the box and status as work lands. Within a phase, the step checkboxes above are the fine-grained tracker.

---

## Part 5 — Sequencing, dependencies & risks

- **Order:** 0 → 1 → 2 can proceed in sequence; **3 depends on 0–2** (needs entities to talk to); **4 is largely independent** of 1–3 (props/activities) and can be parallelized; **5 depends on everything**.
- **Parallelizable:** Phase 4's props/activities and Phase 2's interior authoring are independent enough to split across agents.
- **Reuse over invention** — the biggest wins reuse existing tech: the club `Patron` wander (→ shared helper), `drawPerson`, `DialogBox`, `ShopSystem`, `AIAdapter`'s Mordecai pattern, and the furniture tiles. Avoid new input/render plumbing.
- **Risks to prototype early inside their phase:**
  1. **Walkability + non-clumping crowd AI** (1.1–1.4) — townsfolk must respect walls, building footprints, and doors; get the walkability query and separation right first.
  2. **Render-order integration** — townsfolk must Y-sort correctly against the player/mobs/buildings in both `RenderPipeline` (overworld) and the interior scene's entity pass; verify no draw-order glitches.
  3. **Interaction priority** — Space-to-talk must not steal input from combat, shops, safe-room, stairs, or quest interactions; route through the existing priority chain, don't bypass it.
  4. **Performance** — a populated town + interiors adds many draw calls; budget culling/pooling from Phase 1, not as an afterthought.
  5. **Encounter safety** — never spawn ambient occupants into an active boss/cult/confrontation interior; gate on the same quest-progress flags `BuildingInteriorScene.initEntryEncounter` uses.

## Part 6 — Skills to use

`add-person` (Townsperson + role genome), `add-creature` (entity shape), `add-system` (TownLifeSystem / InteriorOccupantSystem / TownPropSystem), `add-ui` (CitizenDialog, notice board panel), `add-sound` (interior + town ambience), `add-item` (market consumables), `add-level` (any tile/prop additions). `game-architecture` for orientation, `dev-workflow` for run/verify.
