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
- **Do not** add occupants to the live quest-encounter interiors (Big Top boss, Blackwood Lodge cult, tower confrontation) while those encounters are active — gate on the same progress flags `initEntryEncounter` checks.

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

- [x] **0.1** Create `src/creatures/Townsperson.ts`: holds `PersonAppearance`, position, `facing`, `phase`, `moving`, `role`, `speed`; `render()` delegates to `drawPerson`; `update(dt, isWalkable)` advances walk phase and position. No dialog yet. (Skill: `add-person`, `add-creature` for the entity shape.)
- [x] **0.2** Extract the club's patron wander into `src/creatures/townWander.ts` (`stepWander`), and refactor `DesperadoClubSystem` to use it — verify no visual regression in the club. (Skill: `add-system`.)
- [x] **0.3** Add a `TownRole` union + a role→appearance bias helper in `src/sprites/person/PersonAppearance.ts` (e.g. `generatePersonAppearance(seed, role?)`). Keep existing callers working (role optional). (Skill: `add-person`.)
- [x] **0.4** Add a minimal generic dialog surface: a `CitizenDialog` wrapper around `DialogBox` that takes a line array and cycles. (Skill: `add-ui`.)
- [x] **DoD:** typecheck/lint clean; `?people` preview still works; club patrons still wander; nothing else visibly changed.

### Phase 1 — Living streets

Fill the town square and streets with moving citizens.

- [x] **1.1** Create `src/systems/TownLifeSystem.ts` (a `GameSystem`). Constructor takes the `GameMap`, town centre + `townSafeRadiusTiles`, a walkability predicate, and a target population. Spawn townsfolk on walkable non-building tiles, denser near the plaza.
- [x] **1.2** Wire it into `DungeonScene`: construct it for the overworld (guard on level being the town/overworld), `update()` it in the gameplay loop (see `GameLoopPhases` ordering), and render townsfolk in the Y-sorted entity pass (`RenderPipeline`). Add distance culling + respawn to hold density.
- [x] **1.3** Recast the 12 `sky_fowl` as bird-folk _citizens_ (role `skyfowl`) integrated into the crowd, or keep them as ambient fauna and layer humans on top — pick one and make the mix read as a populace. — _Chose: keep the 12 `sky_fowl` as ambient fauna and layer ~28 procedural humans on top._
- [x] **1.4** Ambient motion polish: varied speeds, natural pausing, face-turns, avoid clumping, keep off building doors so entrances stay usable.
- [ ] **1.5** Minimap: show townsfolk as faint dots (`MiniMapSystem`) — optional. _(deferred — optional)_
- [x] **DoD:** the square visibly bustles; citizens never walk through walls/buildings or block doors; no perf drop with the crowd; typecheck/lint clean.

**Notes:** Render culls off-screen townsfolk in `RenderPipeline.renderEntities` (camera-rect test) so only visible citizens draw; the full crowd is a fixed population within a capped 20-tile "life radius" around the square (the 55-tile safe radius is too wide to read as busy). Distance-cull/respawn was unnecessary given the bounded population + render culling.

**Deferred follow-ups (from Phase 1 independent review — non-blocking):**

- _Crowd reshuffles on building entry/exit_ — `DungeonScene` is fully reconstructed on each building round-trip, so `TownLifeSystem` re-seeds citizen positions. Persisting the crowd across the scene rebuild (via `DungeonSceneOptions`, like quest progress) belongs with **Phase 5.1** (schedules/persistence).
- _Perfectly-overlapping spawns_ — two citizens can spawn on the same tile and stay stacked while both idle (separation's `dist === 0` branch skips them). Self-resolves once either moves; a tiny deterministic jitter would make it belt-and-suspenders. Minor.

### Phase 2 — Lived-in interiors

Put occupants and activity inside buildings.

- [x] **2.1** Create `src/systems/InteriorOccupantSystem.ts` and a per-building occupant data table (building name → occupants with role + activity + anchor tile derived from the hand-crafted layouts in `GameMap.generateInterior`).
- [x] **2.2** Wire it into `BuildingInteriorScene` for non-encounter interiors (skip when a live quest encounter occupies the building). Render occupants in the interior entity pass; update stationed/idle motion each frame.
- [x] **2.3** Author occupants for the marquee buildings first: Rusty Anvil (smith at the forge), Sleeping Cat Inn / The Horned Flagon (formerly The Wanderer's Rest) (innkeeper + patrons at tables), Sunken Stump Pub (barkeep + drinkers), Miller's Farm (farmer), Herb & Remedy (apothecary), Shepherd's Cabin (shepherd). Give the restaurant/store their existing NPCs company where it fits.
- [ ] **2.4** Make more houses enterable and occupied so wandering in is rewarded (extend `BuildingSystem` entries / `generateInterior` for generic occupied homes). Add lived-in props/ambience (lit fireplaces, clutter) where cheap — reuse existing furniture tiles.
- [x] **2.5** Interior ambient audio per building type (forge clangs, tavern murmur, hearth crackle) — **superseded and delivered by [town-remake.md](town-remake.md) Phase 2**: `AmbientSoundSystem` emits `ambient_fire_crackling` from every `FIREPLACE`/`BRAZIER` tile in a generated interior, plus constant `ambient_bar_crowd` / `ambient_magic_shop` beds per building.
- [ ] **DoD:** every named building has believable occupants doing role-appropriate things; encounters unaffected; entering buildings feels rewarding; typecheck/lint clean.

**Notes:** Occupant anchors are _derived_ by scanning the finished interior grid for furniture (`InteriorOccupantSystem.scanFurniture`) rather than hard-coding the layout constants in `generateInterior` — rooms and occupants stay in sync if furniture moves. Each occupant is a `Townsperson` given a bounded wander around a stand-tile beside its furniture (small radius + long pauses for stationed roles, wider for roamers), reusing the shared `stepWander` helper. The scene builds the system only when `combat === null`, so it never spawns into an active Big Top / cult / tower encounter; towers, the club, and the Big Top are excluded outright. Occupants Y-sort with the players in the interior's non-combat entity pass. Verified headlessly: every marquee building spawns its roster and no occupant leaves a walkable tile over 600 frames. **2.4 (more enterable/occupied homes) deferred** as a larger follow-up; **2.5 (interior ambient audio) was picked up by [town-remake.md](town-remake.md) Phase 2**. Note that town-remake also renamed two buildings: "Blackwood Barracks" → "Blackwood Lodge" (the safe room is now "The Barracks") and "The Wanderer's Rest" → "The Horned Flagon".

### Phase 3 — Citizen dialog variety

Make talking to people worthwhile and varied.

- [x] **3.1** Build `src/systems/townDialog.ts`: role-keyed ambient line pools + context-tagged lines (danger state, quest flags). Rotation so repeats vary.
- [x] **3.2** Rumor/gossip layer reacting to quest progress (`CircusQuestProgress`, `MurderQuestProgress`, `DoomsdayProgress`) — citizens comment on what the player has actually done.
- [x] **3.3** Wire Space-to-talk in both `TownLifeSystem` and `InteriorOccupantSystem` (proximity + prompt + `CitizenDialog`), yielding priority to combat/quest interactions.
- [ ] **3.4** Passing "barks" — occasional short overhead one-liners as the player walks near a citizen (no interaction needed), throttled so it's flavor not spam. _(deferred)_
- [ ] **3.5** Optional AI-generated lines for a subset of citizens via `AIAdapter`, with the scripted table as guaranteed fallback (mirror `chatWithMordecai`). _(deferred — optional)_
- [x] **DoD:** citizens across roles/buildings give distinct, context-aware lines; dialog reflects quest progress; no repetition fatigue in a normal play session; typecheck/lint clean.

**Notes:** Dialog content and selection live in `src/systems/townDialog.ts` (pure data — no rendering/audio/scene coupling). Two layers stack: a role-keyed **ambient** pool rotated per-citizen by `appearance.seed + conversationCount` so repeat talks vary, and a **reactive** gossip/alarm layer gated on the live `CircusQuestStage` / `MurderQuestStage` / `DoomsdayStage` flags threaded through both scenes. When the town is imperilled (doomsday countdown, circus assault/ritual, murder night-attack) every citizen drops to a single role-flavoured panic line. Proximity + Space is wired through the existing interaction-priority chains in `DungeonScene.triggerSpaceAction` (streets) and `BuildingInteriorScene.update` (interiors), yielding to combat/quests/shops/safe-room and reusing `CitizenDialog` + `drawInteractionPrompt`. Shared `findNearestTownsperson` (`src/creatures/townInteraction.ts`) picks the talk target for both systems. **3.4 (passing barks) and 3.5 (AI lines) deferred** as optional follow-ups. The restaurant safe-room Space handler was tightened to only consume the key when it actually sleeps/opens Mordecai, so a press can fall through to an ambient occupant sharing the room.

### Phase 4 — Things to do in town

Give the player reasons to linger and interact.

- [x] **4.1** Notice / bounty board in the square (`TownPropSystem` + `NoticeBoardPanel` via `add-ui`): surfaces active/available quests and bounties, pulling from the live `CircusQuestProgress` / `MurderQuestProgress` / `DoomsdayProgress` flags via `townNotices.ts`.
- [x] **4.2** Market stalls flanking the square: two `TownPropSystem`-planted stalls (west/east) each sell existing snack-buff consumables (`townMarket.ts`) via a mobile-correct `MarketStallPanel` (Buy/Close buttons, tap-outside-to-close). No new items needed — the snack buffs (`speed_fizz`, `cooldown_crisp`, `jugg_juice`) + a health potion already exist, so the stalls just give an in-town place to buy them; each stall has a vendor bark.
- [x] **4.3** Fountain / well / bench interactions (drink, rest, small flavor or micro-heal). Fountain + wells are a "Drink" (small heal, short cooldown); two `TownPropSystem`-planted benches flanking the fountain are a "Rest" (bigger heal, longer cooldown). Reuses the placed fountain/well tiles.
- [x] **4.4** A **fortune teller** in the square (Madame Voss): a `TownPropSystem` prop + `FortuneTellerPanel` — pay 3 coins, tap one of three face-down cards to reveal a fortune (`townFortunes.ts`), then Draw Again / Close. Fortunes are quest-reactive (omens about the circus, murders, doomsday) mixed with whimsical general readings. Mobile-correct (tappable cards/buttons, tap-outside-to-close).
- [x] **4.5** Interior activities: talking to an **innkeeper** behind the bar buys a drink — a few coins for an immediate Speed Fizz buff (served on the spot, `townPub.ts` + `BuildingInteriorScene.tryServeDrink`), while they still chat. The "listen to a bard for a rumor" beat is already covered by the reactive occupant dialog (gossip/reputation from Phase 3.3 + 5.1). This also fixed a pre-existing gap: interior occupant conversations had **no mobile touch trigger** at all — the talk logic is now shared (`tryTalkToOccupant`) and wired into both the desktop Space path and the mobile tap path (guarded against close-then-reopen and shop/club conflicts), so occupants are talkable on touch.
- [x] **DoD:** a player with no active quest has well over 3–4 things to interact with in town — notice board, fountain/wells + benches, two market stalls, the fortune teller, plus interior barkeeps and occupants — each discoverable via a floating prompt; typecheck/lint clean.

**Notes (4.1 + 4.3):** `TownPropSystem` (`src/systems/TownPropSystem.ts`) owns the square's interactive props on the overworld only. The board is a physical prop rendered in the scene's Y-sorted entity pass (`RenderPipeline` gained a culled `townProps` pass) and blocks its tile. Prop placement is deterministic across scene reconstructions that reuse the overworld `GameMap` (building round-trips): it uses `GameMap.isWalkableIgnoringPermanent` (a refactor of `isWalkable` that ignores only the ever-growing permanent-block set, keeping `isWalkable` behavior-identical) + an `occupied` set, so re-placement re-selects the same tiles instead of drifting and leaking a blocked tile each trip. Interaction routes through `DungeonScene.triggerSpaceAction` after combat/quests/pickups and before citizen talk; the board panel is wired into every desktop **and touch** input-priority gate (`isSuppressed`, `dismissDialog`, `advanceDialog`, the update pause-gate, `handleClick`, and the `handleTouchStart` blocking-dialog gate — the last was essential so a mobile tap dismisses the board instead of closing-then-reopening it). Notice content lives in `townNotices.ts` (pure data). Verified headlessly: fountain/well spots gather, board+benches place on open plaza and stay put across 4 simulated round-trips.

### Phase 5 — Polish & reactivity

- [x] **5.1** Reputation/progress reactions: `townDialog.ts` gained a reputation-greeting layer — as quests resolve, citizens greet the player directly by their deeds (hero welcome after the circus/murders, savior after doomsday, wary hope while the killer's still loose), mixed with ambient gossip for variety. Pure extension of the existing reactive layer (no scene changes).
- [x] **5.2** Ambient town soundscape layer — **superseded and delivered by [town-remake.md](town-remake.md) Phase 2**: distance-attenuated `ambient_fountain`, `ambient_town_square_crowd` and `ambient_fire_crackling` (the Rusty Anvil's forges) emitters, mixed under `OverworldMusicSystem` via `AudioManager`'s ambient-loop bus.
- [x] **5.3** Performance pass — audited; satisfied by the existing design rather than new code. The street crowd is a fixed, bounded population (28) confined to a capped life radius; `RenderPipeline.renderEntities` camera-culls off-screen townsfolk **and** the new town props before drawing; the per-frame cost is a cheap walk-step per citizen plus an O(n²) separation over 28 agents (~800 trivial distance checks). Interior occupant rosters are tiny (≤~5/building). All three new UI panels (`NoticeBoardPanel`/`MarketStallPanel`/`FortuneTellerPanel`) early-return in `render()` when closed, so they cost nothing while inactive, and props only draw when on-screen. No per-frame hotspot exists; adding pooling/on-screen caps would be unwarranted complexity at these counts. (If the population is ever raised substantially, add update-culling by camera distance.)
- [x] **DoD:** the town's life responds to player actions (reputation greetings, quest-reactive gossip/board/fortunes) and frame rate holds with the full crowd.

---

## Part 4 — Progress tracker

| Phase | Title                                                                | Status                                         |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------- |
| 0     | Foundations (Townsperson, wander helper, role genome, CitizenDialog) | ☑ Done                                         |
| 1     | Living streets                                                       | ☑ Done                                         |
| 2     | Lived-in interiors                                                   | ◑ 2.1–2.3 done; 2.5 delivered by town-remake; 2.4 deferred |
| 3     | Citizen dialog variety                                               | ◑ In progress (3.1–3.3 done; 3.4–3.5 deferred) |
| 4     | Things to do in town                                                 | ☑ Done                                         |
| 5     | Polish & reactivity                                                  | ✅ 5.1 + 5.3 done; 5.2 delivered by town-remake |

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
