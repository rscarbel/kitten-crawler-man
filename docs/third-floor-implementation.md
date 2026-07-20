# Third Floor Implementation Steps

Companion to [third-floor-plan.md](third-floor-plan.md). Each phase is independently shippable; within a phase, steps are ordered by dependency. File references reflect the codebase as of writing.

Relevant project skills: `add-creature`, `add-quest`, `add-level`, `add-item`, `add-sprite`, `add-sound`, `add-system`, `add-ui` — use them when executing these steps. Validation gates (`npm run typecheck`, `npm run lint`, `npm run format`) apply after every step.

---

## Phase 1 — Dangerous Ruins

Goal: the overworld outside town becomes hostile, ruined, and visibly part of a destroyed city.

### 1.1 Zone-based safety

- Extend `LevelDef` (`src/levels/types.ts`) with an overworld zone concept, e.g. `safeZone: 'town'` semantics — simplest form: a `townSafeRadius` (tiles from map center) inside which no hostile mobs spawn and mobs deaggro/turn back.
- `src/map/OverworldGenerator.ts` already computes town bounds; export the town rect/radius in `OverworldData` so systems can query "is this tile in town".
- Flip `level3.isSafeLevel` to `false` once spawning works, and gate whatever `isSafeLevel` currently suppresses (timer, spawns) appropriately for overworld levels — check usages in `src/scenes/DungeonScene.ts` (`~line 508`).

### 1.2 Ruins decoration

- In `OverworldGenerator`, scatter ruined-building shells (broken wall rectangles, rubble floor patches, dead trees) in the space between town and the map border, avoiding roads, forests, and the circus footprint. Reuse the existing building-stamping helpers; new tile types (e.g. `RUBBLE`, `RUINED_WALL`) go in `src/map/tileTypes.ts` with renderers in `src/map/tiles/` (see `add-level` skill).

### 1.3 New ambient mobs

Use the `add-creature` skill for each; register in `src/levels/spawner.ts` (`registerMob`) and add the type string to `MobSpawnRule['type']` in `src/levels/types.ts`.

- **`ruins_ghoul`** — melee shambler, modelled on `Troglodyte`/`Goblin`. Levels 5–8.
- **`krasue`** — flying head; erratic sine-drift movement like `SkyFowl` but hostile and faster; low HP, high contact damage. Levels 6–9. (Built now, reused heavily in Phase 3.)

### 1.4 Wire spawns into `level3.ts`

- Populate `roomMobs`/`hallwayMobs` (the overworld generator already emits `mobSpawnPoints`/`hallwaySpawnPoints`) with `ruins_ghoul` (common) and `krasue` (uncommon), with the spawner filtered by the town-safe zone from 1.1.
- Keep the 12 ambient `sky_fowl` — recast via config as neutral town fauna if needed.

**Definition of done:** leaving town is dangerous; town interior is safe; ruins visually read as a destroyed city; typecheck/lint clean.

---

## Phase 2 — "Vengeance of the Daughter" (Circus Questline)

Goal: the decorative circus becomes the floor's marquee quest with Signet and the Grimaldi city-boss fight.

### 2.1 Circus mobs

Via `add-creature`, quest-gated (no ambient spawn rules):

- **`circus_lemur`** — small fast swarmer (pattern: `SmallSpider`).
- **`stilt_clown`** — tall sprite (2-tile), slow stalk + long-reach lunge.
- **`fat_clown`** — tanky, slow; on-death confetti burst AoE (gore hookup via `BodyPartGoreSystem`/`GoreSystem`).
- **`mold_lion`** — bruiser with a poison aura (reuse `StatusEffect` poison if present, else add one).
- **`terror_the_clown`** — mini-boss variant of stilt/fat clown with boss intro (`BossIntroSystem`).
- **`ringmaster_grimaldi`** — city boss, stationary Pestiferous Vine core:
  - Phase mechanic: 3–4 destructible **vine tendril** sub-entities; while any tendril lives, slain performers **resurrect** after ~6 s (the book's gimmick).
  - Once tendrils are down, the core is vulnerable; killing it ends resurrection permanently.

### 2.2 Signet NPC

- New `src/creatures/Signet.ts` — non-combatant quest NPC pattern (`QuestNPC` / `NonCombatantNPC`) that upgrades to ally combatant during fights; as a Summoner she periodically spawns a short-lived friendly minion (spawn logic mirrors `spawnExtraMobs`; ally targeting mirrors `MongoSystem`/`CompanionSystem`).
- New sprite via `add-sprite` (tattooed elf; tattoo shimmer can be a simple palette-cycling effect later).

### 2.3 Circus map support

- `OverworldGenerator`: export the circus center/bounds in `OverworldData` (currently local variables around lines 437–510). Make the big top **enterable** — either a real interior via `BuildingInteriorScene` (preferred; boss arena as an interior room) or a gated open-air arena like `ArenaSystem`.
- Add minimap markers for the circus (`MiniMapSystem`).

### 2.4 Quest system: `CircusQuestSystem`

Via `add-quest`, modelled on `DefendQuestSystem`'s state machine. States:

1. `inactive` → player within ~20 tiles of circus → **Signet ambush cutscene** (DialogBox: caught spying; Signet takes Mongo; quest `vengeance_of_the_daughter` becomes active). If the player has no Mongo, fall back to a threat-on-your-life framing (book-accurate for Carl).
2. `sideshows` — three side tents each spawn a themed wave (lemurs / clowns+mold lions / Terror the Clown). Tent completion tracked via `EventBus` `mobKilled`.
3. `bigtop` — entry unlocked; Grimaldi fight with Signet as ally.
4. `resolution` — post-fight dialog (freeing the family), Mongo returned, rewards granted (`QuestManager.completeQuest`, XP + loot box via `QuestRewards`), achievement.

- `QuestManager` currently tracks only a single status per quest — either encode sub-steps in the system's own state machine (how `DefendQuestSystem` does it) or add an optional `step` field to `QuestState`. Prefer the former; it needs no core change.

### 2.5 Audio/UI

- Circus music cue + clown/boss sounds via `add-sound`.
- Quest banner/objective text via existing quest UI patterns (`drawText`, `TEXT_PRESETS`).

**Definition of done:** full chain playable start-to-finish: ambush → tents → Grimaldi (resurrection mechanic works) → rewards; Mongo kidnap and return function; no regressions in town.

---

## Phase 3 — "The Krasue Murders" (Town Questline)

Goal: dialog-driven murder mystery inside the town, escalating to combat.

### 3.1 NPCs

- **`GumGum`** — street NPC (pattern: `NonCombatantNPC`) with hook dialog; later replaced by a corpse prop + investigation marker in an alley.
- **`Miss Quill`** — town NPC (schoolteacher/clerk demeanor) who is visibly friendly pre-reveal; becomes the questline boss (caster: soul bolts, krasue summons).
- **`Remex`** — static objective entity in the final fight (destructible "capacitor").
- **`city_elf_cultist`** — hostile ranged caster mob (via `add-creature`).
- Optional flavor: **Magistrate Featherfall** in the tower, oblivious.

### 3.2 Quest system: `MurderMysteryQuestSystem`

State machine (via `add-quest`):

1. `hook` — GumGum pleads; Mordecai (existing NPC/dialog surface) warns against it.
2. `body_found` — next time the player passes the alley: corpse discovery, quest `krasue_murders` active.
3. `investigation` — 3–4 interactable clue points around town (alley, well, victim's home interior via `BuildingInteriorScene`); each advances dialog. Clue interaction pattern: `drawInteractionPrompt` + proximity check, as in `DefendQuestSystem`.
4. `night_attack` — scripted krasue swarm in the town streets (spawns bypass the town-safe rule via the quest system, not the ambient spawner).
5. `cult_hideout` — a designated building interior repopulated with `city_elf_cultist` mobs; final clue names Quill.
6. `confrontation` — magistrate's office at the main tower (`TowerStairSystem` already gives the tower an interior path): Miss Quill boss + Remex objective. Quill death → immediately chains into Phase 4's finale.

### 3.3 Supporting work

- Corpse/clue props: simple sprite props + interaction rects (no new entity class needed if a lightweight prop pattern exists; otherwise add one to the quest system itself).
- Krasue night-attack sound/music sting.

**Definition of done:** questline completable; town safety intact outside scripted beats; Quill fight works in the tower interior.

---

## Phase 4 — "Doomsday Scenario" (Finale)

Goal: the soul-crystal crisis, the signature item, and a timed escape off the floor.

### 4.1 Soul crystal event

- New `DoomsdayQuestSystem` auto-activated by Quill's death:
  1. Soul crystal appears/reveals in the tower (glowing prop, screen shake, warning UI — `drawOverlay` + `TEXT_PRESETS.danger`).
  2. **Containment countdown (~7 min real time)**: player must reach and interact with the crystal. Interaction consumes the countdown beat and grants the item.
  3. On containment: award **`doomsday_scenario`** item via `add-item` — legendary trophy, non-consumable (usable-weapon version explicitly deferred).
  4. **Escape countdown (~5 min)**: reach any stairwell (`StairwellSystem`) before it expires. NPC flee ambience optional polish.
  5. Timer expiry = death by city-levelling explosion (`DeathCauseSystem` entry: "You were standing next to a city-sized bomb.").

### 4.2 Floor timer

- With the finale in place, give `level3` the standard floor countdown other levels use (book: the AI shortens the floor timer). Confirm how `isSafeLevel` gates the timer in `DungeonScene` and introduce an explicit `hasFloorTimer`/duration knob on `LevelDef` if needed rather than overloading `isSafeLevel`.

### 4.3 Achievements

- `AchievementManager` entries: completing each questline, containing the crystal ("Doomsday Scenario"), escaping the floor.

**Definition of done:** Quill's death flows into containment → item → escape → stairwell descent; failing either timer kills the player with a bespoke death cause.

---

## Phase 5 — Polish / Stretch

- **Desperado Club**: enterable club interior (marked door in town) — music, the Sledge bouncer NPC, club-exclusive `ShopSystem` stock; relocate GumGum's hook here.
- **Zone music**: distinct tracks for town / ruins / circus (`add-sound`, AudioManager music behavior).
- **Elite flavor**: Syndicate-show framing text when Signet's quest starts ("You are now an extra in *Vengeance of the Daughter*").
- **Minimap**: markers for circus, quest objectives, soul crystal, stairwells during escape.
- **AI dialog**: wire Signet/Quill dialog through the existing `AIAdapter` LLM bridge for dynamic lines, with scripted fallbacks.

---

## Sequencing notes

- Phase 1 before Phase 2: the circus quest assumes hostile overworld travel to reach it.
- Phase 3 depends only on Phase 1 (krasue mob) — Phases 2 and 3 are parallelizable.
- Phase 4 hard-depends on Phase 3 (Quill). Phase 5 items are independent.
- Biggest technical risks, worth prototyping first inside their phases:
  1. Town-safe-zone spawning/deaggro (1.1) — touches the spawner and mob AI.
  2. Big-top interior as a boss arena (2.3) — `BuildingInteriorScene` wasn't built for boss fights.
  3. Grimaldi resurrection mechanic (2.1) — cross-mob lifecycle coordination via `EventBus`.
