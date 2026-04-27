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

---

## Controls

| Key               | Action                               |
| ----------------- | ------------------------------------ |
| WASD / Arrow Keys | Move                                 |
| Tab               | Switch between Human and Cat         |
| Space             | Attack (melee or magic missile)      |
| Q                 | Drink a health potion                |
| G                 | Open gear (equipment) panel          |
| I                 | Open inventory (bag) panel           |
| M                 | Expand / collapse minimap            |
| Esc               | Pause / menu                         |

Mobile: touch controls with on-screen buttons for all actions.

---

## Features

### Two Playable Characters
- **Human** — melee fighter, strength-based damage, can throw dynamite
- **Cat** — ranged magic missiles, intelligence-based damage, auto-kites enemies

Switch between them with Tab. The inactive character auto-follows and auto-fights.

### Three Levels

**Level 1: The Dungeon** — Procedurally generated rooms and hallways. Goblins, rats, and lava-spitting llamas roam the corridors. Two boss rooms await: TheHoarder and the Juicer.

**Level 2: Safe Haven** — A larger dungeon with tougher enemies (troglodytes, llamas, goblins). Features the Krakaren Clone boss and an arena with the Ball of Swine. Brindle Grubs spawn on mob kills.

**Level 3: The Overworld** — An outdoor town with grass, roads, forests, a town square, and enterable buildings (houses, a tower, and Mordecai's Kitchen restaurant). Sky Fowl roam the outskirts.

### Bosses
- **TheHoarder** — Melee boss, drops the Trollskin Shirt
- **Juicer** — Throws dumbbells, enrages at 40% HP, drops the Enchanted Crown of the Sepsis Whore
- **Krakaren Clone** — Arena boss encounter
- **Ball of Swine** — Orbiting arena boss (280 HP), contact kills while moving, vulnerable when stopped by barriers. Spawns 8 dazed Tusklings on death

### Combat & Stats

Three stats — STR (melee damage), INT (missile damage), CON (+2 max HP per point). Kill enemies for XP (85% to top damage dealer, 15% to the other character). Level up to earn skill points, allocated in the pause menu.

Status effects: Burn, Poison (from troglodytes), Sepsis (from the Enchanted Crown).

### Equipment & Items
- **Trollskin Shirt** — 2.5x health regen, negates melee debuffs, +3 CON
- **Enchanted Crown** — +5 INT, 15% chance to inflict permanent Sepsis on hit
- **Goblin Dynamite** — Throwable AoE (3-tile radius, 8 dmg, friendly fire). Hold to charge, release to throw
- **Gym Equipment** — Dumbbells, bench presses, treadmills. Place them to create barrier zones that slow enemies to 35% speed
- **Scroll of Confusing Fog** — Blinds enemies for INT x 5 seconds
- **Health Potions** — Restore HP

### Buildings & Interiors
Walk up to a building door in the overworld to enter. Interiors include houses, a tower, and a restaurant that doubles as a safe room with Mordecai the NPC, a bed for sleeping, and a shop.

### Quests
Quest system with NPC interactions. Includes the Defend Quest — protect an NPC from waves of enemies.

### Achievements & Loot Boxes
Six achievements (First Blood, Boss Slayer, Smush, Safe Haven, Magic Touch, Guardian Angel) that award loot boxes. Boxes can only be opened in safe rooms and contain potions, coins, and bonus items.

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
│   ├── Inventory.ts           ← item management, hotbar, equipment
│   ├── ItemDefs.ts            ← item database with stat bonuses
│   ├── StatusEffect.ts        ← Burn, Poison, Sepsis effects
│   ├── AchievementManager.ts  ← achievement tracking + loot box rewards
│   ├── QuestManager.ts        ← quest state machine
│   ├── EventBus.ts            ← decoupled system communication
│   ├── PlayerSnapshot.ts      ← serializes player state for scene transitions
│   └── SpatialGrid.ts         ← spatial partitioning for collision checks
├── scenes/
│   ├── DungeonScene.ts        ← main gameplay orchestrator (~1,400 lines)
│   ├── BuildingInteriorScene.ts ← interior exploration when entering buildings
│   └── GameplayScene.ts       ← shared gameplay logic
├── systems/                   ← ~30 modular game systems
│   ├── CombatSystem.ts        ← damage resolution, sepsis proc
│   ├── CompanionSystem.ts     ← cat AI: kiting, following, auto-attack
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
│   ├── GoreSystem.ts          ← blood/death effects
│   ├── RenderPipeline.ts      ← draw ordering
│   ├── MobileHUDSystem.ts     ← mobile-specific UI buttons
│   └── ...
├── levels/
│   ├── types.ts               ← LevelDef and MobSpawnRule interfaces
│   ├── level1.ts              ← "The Dungeon" (goblins, llamas, rats)
│   ├── level2.ts              ← "Safe Haven" (troglodytes, Krakaren, Ball of Swine)
│   ├── level3.ts              ← "The Overworld" (outdoor town, buildings)
│   ├── spawner.ts             ← mob factory: LevelDef + map → Mob[]
│   └── index.ts               ← level registry
├── map/
│   └── GameMap.ts             ← dungeon/overworld generation, A* pathfinding, tile rendering
├── creatures/
│   ├── HumanPlayer.ts         ← melee fighter
│   ├── CatPlayer.ts           ← ranged magic cat
│   ├── Mob.ts                 ← enemy AI base (aggro, pathfinding, LOS)
│   ├── Goblin.ts, Rat.ts, Llama.ts
│   ├── TheHoarder.ts, Juicer.ts
│   ├── Troglodyte.ts          ← poison tongue attack
│   ├── BallOfSwine.ts         ← orbiting arena boss
│   ├── Tuskling.ts, Cockroach.ts
│   ├── KrakarenClone.ts, BrindleGrub.ts
│   ├── SkyFowl.ts, Bugaboo.ts, Mongo.ts
│   ├── QuestNPC.ts, NonCombatantNPC.ts
│   └── ...
├── sprites/                   ← ~21 sprite renderers (all Canvas 2D drawing)
│   ├── humanSprite.ts, catSprite.ts
│   ├── goblinSprite.ts, llamaSprite.ts, ratSprite.ts
│   ├── hoarderSprite.ts, juicerSprite.ts
│   ├── ballOfSwineSprite.ts, troglodyteSprite.ts
│   ├── dynamiteSprite.ts, gymEquipmentSprite.ts
│   └── ...
├── ui/
│   ├── HUD.ts                 ← HP/XP bars, control hints
│   ├── PauseMenu.ts           ← pause overlay with tabs
│   ├── DeathScreen.ts         ← game over screen
│   ├── AchievementNotification.ts ← achievement unlock overlay
│   ├── LootBoxOpener.ts       ← animated loot reveal
│   ├── InteractionPrompt.ts   ← "Press X" hints
│   └── pause/                 ← GearPanel, InventoryPanel
└── utils.ts
dist/
  bundle.js                    ← compiled output
index.html                     ← loads canvas + bundle.js
```

---

## Architecture

**No framework** — everything is Canvas 2D API calls. No DOM manipulation, no images, no external assets.

**Game loop**: `SceneManager` runs `update()` + `render()` at 60 FPS via `requestAnimationFrame`. The active `Scene` (usually `DungeonScene`) orchestrates all gameplay.

**Entity hierarchy**:
```
Player (base: position, HP, stats, walk animation)
├── HumanPlayer
├── CatPlayer
└── Mob (AI: aggro, pathfinding, LOS, health bar)
    ├── Goblin, Rat, Llama, Troglodyte, ...
    ├── TheHoarder, Juicer (bosses)
    └── BallOfSwine, KrakarenClone (arena bosses)
```

**Modular systems**: ~30 independent `GameSystem` subclasses plugged into `DungeonScene` via composition. Each system owns its own state and rendering. Systems communicate through an `EventBus`.

**Map generation**: procedural dungeon rooms + L-shaped hallways, boss rooms, safe rooms, arenas, and an overworld with roads, buildings, and forests.

**Pathfinding**: A* with cached paths (recalculated every ~30 frames). Line-of-sight checks for attack validation.

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

---

## Tech Stack

- **TypeScript** — strict mode, ES2020 target
- **esbuild** — bundler (~5ms builds)
- **Prettier** — code formatting
- **GitHub Pages** — auto-deploy on push to main
