# Kitten Crawler Man

A browser-based dungeon crawler built with TypeScript and HTML5 Canvas. Control a human and cat companion as they explore procedurally generated dungeons, fight bosses, collect loot, complete quests, and venture into an overworld town — all rendered with hand-drawn canvas sprites.

**[Play it here](https://rscarbel.github.io/kitten-crawler-man/)**

---

## Running Locally

```bash
npm install      # first time only
npm run build    # compiles TypeScript → dist/bundle.js (~5ms)
```

Open `index.html` in a browser. No server needed.

For live rebuilds during development:

```bash
npm run serve    # watch mode with dev server
```

To run the optional backend (progress saving, authentication):

```bash
npm run server   # Express + SQLite on localhost
```

---

## Controls

| Key               | Action                          |
| ----------------- | ------------------------------- |
| WASD / Arrow Keys | Move                            |
| Tab               | Switch between Human and Cat    |
| Space             | Attack (melee or magic missile) |
| Q                 | Drink a health potion           |
| 1–8               | Use hotbar item                 |
| G                 | Open gear (equipment) panel     |
| I                 | Open inventory (bag) panel      |
| M                 | Expand / collapse minimap       |
| Esc               | Pause / menu                    |

Mobile: touch controls with on-screen buttons for all actions.

---

## Features

### Two Playable Characters

- **Human** — melee fighter, strength-based damage, can throw dynamite, has Protective Shell ability
- **Cat** — ranged magic missiles, intelligence-based damage, auto-kites enemies

Switch between them with Tab. The inactive character auto-follows and auto-fights.

### Three Levels

**Level 1: The Dungeon** — Procedurally generated rooms and hallways. Goblins, rats, and lava-spitting llamas roam the corridors. Two boss rooms await: TheHoarder and the Juicer. Troglodytes guard the boss wing.

**Level 2: Safe Haven** — A larger dungeon with tougher enemies (troglodytes, llamas, goblins, brindle grubs). Features the Krakaren Clone boss, an arena with the Ball of Swine and Grotesque Spider, and Bugaboos that spawn from floor grates.

**Level 3: The Overworld** — An outdoor town with grass, roads, forests, a town square, and enterable buildings (houses, a tower, and Mordecai's Kitchen restaurant). Sky Fowl roam the outskirts.

### Bosses

- **TheHoarder** — Flees while spawning cockroaches and spitting acid bile. Drops the Trollskin Shirt
- **Juicer** — Throws dumbbells, enrages at 40% HP. Drops the Enchanted Crown of the Sepsis Whore
- **Krakaren Clone** — Immobile 20-ft octopus with human-mouthed tentacles, arena encounter in Level 2
- **Ball of Swine** — Orbiting arena boss (280 HP), contact-kills while moving, only vulnerable when stopped by barriers. Spawns 8 dazed Tusklings on death
- **Grotesque Spider** — Spits venom that applies Stuck and Spit Venom status, immobilizing targets for 4 seconds

### Companion: Mongo

Defeat the Krakaren Clone to unlock Mongo — a blue velociraptor with pink feathers who joins the party. Mongo targets hostile mobs within a 12-tile radius, scales in size with your floor, and stays leashed near the party.

### Combat & Stats

Three stats — STR (melee damage), INT (missile damage), CON (+2 max HP per point). Kill enemies for XP (85% to top damage dealer, 15% to the other). Level up to earn skill points, allocated in the pause menu.

**Status effects:** Burn, Poison (troglodyte tongue lash — 30s, 1 dmg/2 sec), Sepsis (Enchanted Crown — permanent, 1 dmg/2 sec), Spit Venom (Grotesque Spider — 4s immobilization + acid), Electrified (slow + damage), Stuck (immobilized).

**Revive:** If a character goes down, the other can revive them by staying close for 90 seconds.

### Ability Leveling

Both abilities level independently through gameplay, unlocking new perks at each tier (15 levels each):

**Magic Missile** (Cat) — Starts as a basic INT-scaling projectile. Higher levels add AoE splash on impact, sub-missiles spawned from the explosion, homing in a forward cone, and at max level: infinite range, no cooldown, an orange beam, boss slow, and a death shockwave.

**Protective Shell** (Human) — Creates an expanding shield (3–5 tile radius, 20s duration). Higher levels add damage to enemies caught in the expansion, faster ally healing inside the shell, continuous boundary damage, and at max level: instant ally heal, magic immunity, chain lightning on kills, and an electric shockwave on expiry.

### Equipment & Items

- **Trollskin Shirt** — 2.5× health regen, negates melee debuffs (stun, knockback, disarm), +3 CON
- **Enchanted Crown of the Sepsis Whore** — +5 INT, 15% chance to inflict permanent Sepsis on hit
- **Enchanted BigBoi Boxers** — +2 CON, grants the Protective Shell ability; pre-equipped on Human
- **Goblin Dynamite** — Throwable AoE (3-tile radius, 8 dmg, friendly fire). Hold to charge throw distance, tap to drop at feet, hold too long and it explodes in hand
- **Gym Equipment** — Dumbbells, bench presses, treadmills. Place them to create barrier zones that slow enemies to 35% speed
- **Scroll of Confusing Fog** — Blinds nearby enemies for INT × 5 seconds
- **Health Potions** — Restore HP

### Buildings & Interiors

Walk up to a building door in the overworld to enter. Interiors include houses, a tower, and a restaurant that doubles as a safe room with Mordecai the NPC, a bed for sleeping, and a shop (potions, dynamite, fog scrolls).

### Quests

Quest system with NPC interactions. Includes the Defend Quest — protect a goblin mother from waves of Bugaboos. Build barriers from gym equipment to hold them off. Completing it earns the Guardian Angel achievement.

### Achievements & Loot Boxes

Six achievements that award loot boxes. Boxes can only be opened in safe rooms and contain potions, coins, and bonus items. Five box tiers: Bronze → Silver → Gold → Legendary → Celestial.

| Achievement    | Condition                     | Box type   |
| -------------- | ----------------------------- | ---------- |
| First Blood    | Get first kill                | Adventurer |
| Boss Slayer    | Kill a boss                   | Boss       |
| Smush          | Human kills enemy bare-handed | Spicy      |
| Safe Haven     | First safe room entry         | Adventurer |
| Magic Touch    | Cat kills enemy with missile  | Adventurer |
| Guardian Angel | Complete the defend quest     | Adventurer |

### Minimap

Fog of war that reveals as you explore. Shows corpse markers, NPC positions, boss rooms, and stairwells. Expandable with M key or tap on mobile.

---

## Project Structure

```
src/
├── game.ts                    ← entry point: InputManager + SceneManager + DungeonScene
├── Player.ts                  ← base class for all entities (players + enemies)
├── core/
│   ├── constants.ts           ← TILE_SIZE=32, speeds, combat parameters
│   ├── InputManager.ts        ← raw keyboard state
│   ├── Scene.ts               ← Scene base class + SceneManager (canvas, rAF loop)
│   ├── Inventory.ts           ← item management, hotbar, equipment slots
│   ├── ItemDefs.ts            ← item database with stat bonuses
│   ├── StatusEffect.ts        ← Burn, Poison, Sepsis, Electrified, Stuck, Spit Venom
│   ├── AchievementManager.ts  ← achievement tracking + loot box rewards
│   ├── QuestManager.ts        ← quest state machine
│   ├── AbilityManager.ts      ← Magic Missile & Protective Shell leveling (15 levels)
│   ├── EventBus.ts            ← decoupled system communication
│   ├── PlayerSnapshot.ts      ← serializes player state for scene transitions
│   └── SpatialGrid.ts         ← spatial partitioning for collision checks
├── scenes/
│   ├── DungeonScene.ts        ← main gameplay orchestrator (~1,400 lines)
│   ├── BuildingInteriorScene.ts ← interior exploration when entering buildings
│   └── GameplayScene.ts       ← shared gameplay logic (camera, HUD, companion follow)
├── systems/                   ← ~30 modular game systems
│   ├── CombatSystem.ts        ← damage resolution, sepsis proc
│   ├── CompanionSystem.ts     ← cat AI: kiting, following, auto-attack
│   ├── PlayerMovementSystem.ts ← input → movement, wall collision
│   ├── PlayerTickSystem.ts    ← status effect ticks, HP regen
│   ├── MobUpdateLoop.ts       ← mob AI update and pathfinding
│   ├── MiniMapSystem.ts       ← fog of war, corpse markers
│   ├── SafeRoomSystem.ts      ← rest, sleep, Mordecai NPC
│   ├── BossRoomSystem.ts      ← boss room state, cockroach spawning
│   ├── ArenaSystem.ts         ← Ball of Swine arena encounters
│   ├── DynamiteSystem.ts      ← charge, throw, bounce, explode
│   ├── SpellSystem.ts         ← protective shell, confusing fog
│   ├── BarrierSystem.ts       ← gym item placement, mob slow zones
│   ├── JuicerRoomSystem.ts    ← gym equipment spawns + Juicer coordination
│   ├── LootSystem.ts          ← item drops, TTL, auto-collect
│   ├── StairwellSystem.ts     ← level transitions
│   ├── BuildingSystem.ts      ← door detection, entry prompts
│   ├── ShopSystem.ts          ← buying/selling items
│   ├── DefendQuestSystem.ts   ← defense quest with NPC protection
│   ├── MongoSystem.ts         ← Mongo companion spawning & management
│   ├── GoreSystem.ts          ← blood/death effects
│   ├── BodyPartGoreSystem.ts  ← detailed body part damage visuals
│   ├── BossIntroSystem.ts     ← boss encounter intro screen
│   ├── DungeonIntroSystem.ts  ← level intro screen
│   ├── RenderPipeline.ts      ← draw ordering
│   ├── MobileHUDSystem.ts     ← mobile-specific UI buttons
│   └── ...
├── levels/
│   ├── types.ts               ← LevelDef and MobSpawnRule interfaces
│   ├── level1.ts              ← "The Dungeon" (goblins, llamas, rats, 2 bosses)
│   ├── level2.ts              ← "Safe Haven" (troglodytes, Krakaren, Ball of Swine)
│   ├── level3.ts              ← "The Overworld" (outdoor town, buildings)
│   ├── spawner.ts             ← mob factory: LevelDef + map → Mob[]
│   └── index.ts               ← level registry
├── map/
│   └── GameMap.ts             ← dungeon/overworld generation, A* pathfinding, tile rendering
├── creatures/
│   ├── HumanPlayer.ts, CatPlayer.ts
│   ├── Mob.ts                 ← enemy AI base (aggro, pathfinding, LOS, health bar)
│   ├── Goblin.ts, Rat.ts, Llama.ts, Troglodyte.ts
│   ├── Tuskling.ts, Cockroach.ts, Bugaboo.ts, BrindleGrub.ts
│   ├── TheHoarder.ts, Juicer.ts
│   ├── KrakarenClone.ts, BallOfSwine.ts, GrotesqueSpider.ts
│   ├── SkyFowl.ts
│   ├── Mongo.ts               ← raptor companion
│   ├── QuestNPC.ts, NonCombatantNPC.ts
│   └── ...
├── abilities/
│   ├── magicMissile.ts        ← 15-level ability tree with perk unlocks
│   └── protectiveShell.ts     ← 15-level ability tree with perk unlocks
├── sprites/                   ← ~21 sprite renderers (all Canvas 2D drawing)
├── audio/
│   ├── AudioManager.ts        ← centralized audio playback
│   ├── sounds.ts              ← sound effect registry
│   └── background_music/, bosses/, characters/, enemies/, effects/, events/, menu/
├── auth/
│   ├── AuthClient.ts          ← backend communication
│   └── LoginUI.ts             ← login/register screen
├── ui/
│   ├── HUD.ts                 ← HP/XP bars, hotbar, control hints
│   ├── PauseMenu.ts           ← pause overlay with tabs (Stats, Inventory, Abilities, Achievements, Settings)
│   ├── GearPanel.ts, InventoryPanel.ts
│   ├── DeathScreen.ts         ← game over screen
│   ├── LevelCompleteScreen.ts ← floor transition screen
│   ├── AchievementNotification.ts ← achievement unlock overlay
│   ├── LootBoxOpener.ts       ← animated loot reveal
│   ├── AbilityLevelUpDialog.ts ← ability level-up notification
│   └── TextBox.ts, Box.ts     ← shared canvas UI utilities
└── utils.ts
server/
├── index.ts                   ← Express server
├── db.ts                      ← SQLite database
└── routes/auth.ts, progress.ts ← login/register + save/load endpoints
dist/
  bundle.js                    ← compiled output
index.html                     ← loads canvas + bundle.js
```

---

## Architecture

**No framework** — everything is Canvas 2D API calls. No DOM manipulation beyond mounting the canvas. All sprites are drawn in code; no image files.

**Game loop**: `SceneManager` runs `update()` + `render()` at 60 FPS via `requestAnimationFrame`. The active `Scene` (usually `DungeonScene`) orchestrates all gameplay.

**Entity hierarchy**:

```
Player (base: position, HP, stats, walk animation)
├── HumanPlayer
├── CatPlayer
└── Mob (AI: aggro, pathfinding, LOS, health bar)
    ├── Goblin, Rat, Llama, Troglodyte, Tuskling, Bugaboo, BrindleGrub, ...
    ├── TheHoarder, Juicer (bosses)
    └── BallOfSwine, KrakarenClone, GrotesqueSpider (arena bosses)
```

**Modular systems**: ~30 independent `GameSystem` subclasses plugged into `DungeonScene` via composition. Each system owns its own state and rendering. Systems communicate through an `EventBus`.

**Map generation**: procedural dungeon rooms + L-shaped hallways, boss rooms, safe rooms, arenas, and an overworld with roads, buildings, and forests.

**Pathfinding**: A\* with cached paths (recalculated every ~30 frames). Line-of-sight checks for attack validation.

**Backend** (optional): Express + SQLite server handles login/registration and persists game progress. The game runs fully offline without it.

---

## Adding Content

### New Enemy

1. Create sprite: `src/sprites/myEnemySprite.ts`
2. Create class: `src/creatures/MyEnemy.ts` extending `Mob`, implement `updateAI()` and `render()`
3. Register in `src/levels/spawner.ts` and add the type to `src/levels/types.ts`
4. Add to a level definition in `src/levels/`

### New Level

1. Create `src/levels/levelN.ts` with a `LevelDef`
2. Register in `src/levels/index.ts`
3. Transition via `sceneManager.replace(new DungeonScene(...))`

### New Item

1. Add to `ItemId` union and `ITEM_DEF` record in `src/core/Inventory.ts`
2. Add mob loot drop in the creature's `rollLootItems()`
3. Add hotbar activation in `DungeonScene.onEnter()`
4. Add inventory icon in `InventoryPanel.renderItemIcon()`

### New Achievement

1. Add ID to `AchievementId` union in `src/core/AchievementManager.ts`
2. Add entry to `ACHIEVEMENT_DEFS`
3. Call `this.achievements.tryUnlock('id')` + `this.maybeStartAchievementNotif()` in `DungeonScene`

---

## Tech Stack

- **TypeScript** — strict mode, ES2020 target
- **esbuild** — bundler (~5ms builds)
- **Express + SQLite** — optional backend for auth and progress saving
- **Prettier / ESLint** — formatting and linting
- **GitHub Pages** — auto-deploy on push to main
