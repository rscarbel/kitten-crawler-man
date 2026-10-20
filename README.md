# Kitten Crawler Man

A browser-based dungeon crawler built with TypeScript and HTML5 Canvas. Control a human and cat companion as they explore procedurally generated dungeons, fight bosses, collect loot, complete quests, and venture into an overworld town — all rendered with hand-drawn canvas sprites.

**[Play it here](https://rscarbel.github.io/kitten-crawler-man/)**

---

## Running Locally

`npm install` pulls the AI SDK from GitHub Packages, so it needs a GitHub
token first, even if you never turn the AI on. See
[Playtesting](#playtesting) for the one-time setup.

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

### Playtesting

**Just playing:** use the [live build](https://rscarbel.github.io/kitten-crawler-man/)
(also at ryanscarbel.com/kitten-crawler-man). Nothing to install. The AI is
off there; the System and Mordecai use their scripted lines.

**From source, or with the AI.** The owner grants, once per playtester:

1. **The SDK package** (needed even with the AI off). Open the package
   `game-server-llm-sdk` on GitHub → **Package settings** → **Manage access**.
   - If that page shows access inherited from `game-server-llm`, every
     collaborator on that repository can already install it; step 2 is enough.
   - Otherwise, or for a playtester who won't get the server repository,
     invite their username there with the **Read** role.
   - Nothing is needed if the package is public.
2. **The AI server** (only for playing with the AI). Add them to the private
   `game-server-llm` repository (**Settings** → **Collaborators** → **Add
   people**). Collaborators on a personal-account repository can push as well
   as read.

The playtester, once:

1. Accepts the invitations from the owner (in the email from GitHub or at
   github.com/notifications). No access works until they do.
2. Creates a **classic** personal access token (GitHub → **Settings** →
   **Developer settings** → **Personal access tokens** → **Tokens (classic)**)
   with only the `read:packages` scope. GitHub Packages' npm registry doesn't
   accept fine-grained tokens.
3. Adds it to their user `~/.npmrc`, never to a file in the repository:

   ```ini
   //npm.pkg.github.com/:_authToken=<the token>
   ```

4. Clones this repository and runs `npm install`. That's enough to play from
   source (see [Running Locally](#running-locally)).
5. For the AI: signs git in to GitHub with access to private repositories
   (for example `gh auth login`, or an SSH key added to their account); the
   `read:packages` token can't clone. Then clones `game-server-llm` next to
   this repository (both folders in the same parent directory) and follows the
   one-time steps in [The System AI](#the-system-ai-optional) below. That
   needs Docker, Ollama 0.40.6 or newer, and a Mac with Apple Silicon and
   32 GB of memory or more; the default models are about a 10 GB download.

To revoke access later, remove the playtester from the repository's
collaborators and, if they were invited there, from the package's **Manage
access** list. Access inherited from the repository ends with the first.

### The System AI (optional)

With `AI_ENABLED=true`, the System and Mordecai are played by an LLM on the
[game-server-llm](../game-server-llm) server. The game talks to it through
that repo's SDK (`@rscarbel/game-server-llm-sdk`), installed from GitHub Packages.
`dev:ai` runs the server from a checkout beside this one (or `AI_SERVER_DIR`).

`npm install` needs the GitHub token described under
[Playtesting](#playtesting); this repo's `.npmrc` already points the
`@rscarbel` scope at GitHub Packages.

The deploy and checks workflows can only install the SDK while its package is
public or grants this repository read access ("Manage Actions access" in the
package's settings on GitHub).

**One time:**

```bash
# the AI server
cd ../game-server-llm
cp .env.example .env            # defaults: local Ollama + local DynamoDB/MinIO
npm install && npm run build:sdk
npm run infra:up && npm run setup  # DynamoDB/MinIO, then tables, bucket, keys, console owner and the
                                   # "kitten-crawler" app trusting this game's JWKS
npm run ollama:dev              # start Ollama with the tuned settings
npm run models:pull             # the fast, smart and embedding models in .env

# the game
cd ../kitten-crawler-man
cp .env.example .env            # then set AI_ENABLED=true, AI_SERVER_URL=http://localhost:3001, AI_APP_ID=kitten-crawler
npm install                     # needs the ~/.npmrc token (Playtesting)
npm run ai:sync                 # pushes characters, tools and lore; needs a service account (below)
```

**Every day**, from this repo:

```bash
npm run dev:ai
```

It checks Docker and starts DynamoDB Local (:8000) and MinIO (:9000) with the
server's `npm run infra:up` if they aren't up; starts Ollama with the tuned
settings and warms the fast model (the server's `scripts/ollama-dev.sh`;
`npm run dev:ai -- --restart-ollama` replaces an Ollama that was already
running with untuned settings), or with `LLM_PROVIDER=bedrock` in the server's
`.env` checks `aws sts get-caller-identity --profile <AWS_PROFILE>` instead;
builds the SDK if it isn't built; then runs the AI server (:3001) and the game
(:3000) with their output prefixed, waits until both answer, and prints:

```
  Game        → http://localhost:3000
  Console     → http://localhost:3001/console
  AI provider → ollama (fast: gemma4:e4b, smart: gemma4:26b) ✓
```

Ctrl-C stops everything. Sign in at the game to get the AI: a signed-out
player plays without it.

The browser never holds an AI credential: a signed-in player's page fetches a
ten-minute token from this game's server (`GET /api/ai-token`) and connects
over the WebSocket. A signed-out player, or an unreachable AI server, just
plays without it.

**Syncing the AI setup.** Characters, the tools generated from the action
registry, the world bible (lore) and the event importance hints are pushed
once per deploy, not on page load:

```bash
npm run ai:sync              # needs AI_APP_ID, AI_SYNC_CLIENT_ID, AI_SYNC_CLIENT_SECRET in .env
npm run ai:sync -- --dry-run # print what would be sent
```

It signs in as a service account on the app (client credentials,
`POST /oauth/token`) holding the `characters:write` and `tools:write` scopes,
plus `lore:write` for the lore and importance hints (without it those two
steps are skipped with a note).
Create one in the AI server's console (`http://localhost:3001/console`, the
app's credentials) or with its API, signed in as a console user (the token
from `POST /v1/auth/login`; a new owner changes the one-time password first
with `POST /v1/auth/password`):

```bash
curl -X POST http://localhost:3001/v1/apps/kitten-crawler/service-accounts \
  -H "Authorization: Bearer <console session token>" -H "Content-Type: application/json" \
  -d '{"name": "ai-sync", "scopes": ["characters:write", "tools:write", "lore:write"]}'
# → the id and a secret shown once: AI_SYNC_CLIENT_ID / AI_SYNC_CLIENT_SECRET
```

An upload the server has no endpoint for (an older server without lore or
importance hints) is skipped with a note rather than failing the sync.

**AI replay fixtures.** The AI server's `npm run eval` replays recorded play
sessions against a real model and checks the replies. A fixture
is a JSON file holding every message the game sent the server, in order:

```jsonc
{
  "format": "kitten-crawler/ai-replay",
  "version": 1,                 // bumped when a field changes meaning
  "id": "dynamite-incident",
  "title": "…", "description": "…",
  "source": "scripted",         // or "browser"
  "recordedAt": "2026-10-19T20:00:00.000Z",
  "startedAtEpochMs": 1792440000000, // event ts values are epoch ms; rebase from this
  "durationMs": 88000,
  "client": { "sdk": "kitten-crawler", "protocol": 2 },
  "messages": [
    // atMs = ms since the recording started; type and payload are the protocol v2 message
    { "atMs": 0, "type": "context_set", "payload": { "context": {…}, "flags": {…}, "policyMultiplier": 1 } },
    { "atMs": 0, "type": "state_snapshot", "payload": { "full": {…} } },        // later ones carry "patch" (RFC 7386)
    { "atMs": 9000, "type": "event_log", "payload": { "events": [ { "ts": …, "type": "dynamiteUsed", … } ] } },
    { "atMs": 18000, "type": "action_result", "payload": { "actionId": "…", "ok": true, "detail": "…" },
      "answers": { "characterName": "System", "type": "announce", "params": {…} } }, // the ai_action it answered (not sent on the wire)
    { "atMs": 82000, "type": "player_message", "payload": { "characterName": "System", "text": "Hey System. Remember the dynamite?" } }
  ],
  "expectations": [
    // the reply to messages[messageIndex] should contain one of these as a whole word or phrase,
    // case-insensitively; none of them is in the question, so an echo never passes
    { "kind": "recall", "messageIndex": 33, "characterName": "System", "mentionsAny": ["Donut", "knocked", "friendly fire"], "description": "…" }
  ]
}
```

The types are `src/ai/replay/aiReplayFormat.ts`; the zod schema is
`scripts/aiReplaySchema.ts`, and the JSON Schema generated from it is written
beside the fixtures. Fixtures live in the server repo, under
`../game-server-llm/bench/replays/`.

- `npm run ai:replays` writes the scripted ones there: short sessions acted
  out headlessly through the real AI adapter and context builder with a
  scripted clock, so they are the same on every run. `dynamite-incident` is a
  goblin fight Carl ends with dynamite that also knocks Donut out, the Hoarder
  boss kill, then "Remember the dynamite?"; `challenge-and-death` is an
  accepted and won challenge, a death, then a question about the challenge.
  `-- --out=<dir>` writes elsewhere.
- To record a real session, open a dev build (`npm run dev:ai` or
  `npm run dev`) with `?ai-record` (or `?ai-record=<name>`) on a normal boot,
  sign in, play, and press **F8** to download the fixture; move it into
  `bench/replays/`. Only what was actually sent is recorded, so the AI has to
  be connected. Release builds don't contain the recorder.

**Building from a clean checkout (CI).** The deploy and checks workflows
install the SDK from GitHub Packages with the workflow's own `GITHUB_TOKEN`
(`packages: read`), so they need no secret of their own. To try unreleased SDK
changes locally, see "Developing against a local checkout" in the SDK's
README.

**In game.** The System's messages type out in a panel under the unit frames
as they stream in, with "The System is typing…" while it thinks, reply
buttons when it asks something (a button sends its label as the player's
message, with the choice id as `replyTo`), and a flash when its opinion of you
changes. A dot there shows the AI online, degraded (throttled, resting or on a
fallback model) or offline; offline, the System answers from its scripted
lines. Settings → System AI sets the intensity (Off, Commentary, Classic,
Chaotic) and whether the "intervened" line is shown. Every action the AI asks
for is answered to the server with whether it ran, so it learns what the game
refused.

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
| N                 | Mute / unmute all audio         |
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

Walk up to a building door in the overworld to enter. Interiors include houses, a tower, and a restaurant that doubles as a safe room with Mordecai the NPC and a shop (potions, dynamite, fog scrolls).

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

### Music & Sound

Every song unlocks when its place or activity first plays it, and its title and credit show the first time it is heard. The pause menu's Music page lists the library by area (locked songs hint where they are found) and plays area music, shuffles unlocked songs, repeats one or plays one once; it also holds the credits for all music. Settings has Master, Music, Effects and Ambience volume, mute all, mono audio, keep playing in the background, and sound captions for audio-only cues.

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
│   ├── SafeRoomSystem.ts      ← save point, Mordecai NPC
│   ├── BossRoomSystem.ts      ← boss room state, cockroach spawning
│   ├── ArenaSystem.ts         ← Ball of Swine arena encounters
│   ├── DynamiteSystem.ts      ← charge, throw, bounce, explode
│   ├── SpellSystem.ts         ← protective shell, confusing fog
│   ├── DestructiblePropSystem.ts ← smashable barrels/crates, splinters, coin drops
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
├── sprites/                   ← sprite renderers: PNG-sheet wrappers + procedural Canvas 2D drawing
├── images/                    ← PNG sheets, one manifest.json per leaf folder
│   ├── bosses/, characters/, effects/, enemies/, npcs/
│   └── environment/
│       ├── buildings/, circus/, club/, nature/, props/, tilesets/, walls_roofs/
│       ├── townscape/         ← town art REUSABLE by any town or later floor
│       │                        (shop signs, street lamps, clutter, gateways,
│       │                        bunting, laundry lines, market stalls, benches)
│       └── towns/
│           └── over_city/     ← art only correct in THIS town (fingerposts whose
│                                arms name its streets, its named seer)
├── audio/
│   ├── AudioManager.ts        ← centralized audio playback
│   ├── sounds.ts              ← sound registry: music, jingle and effect ids
│   ├── music/                 ← every credited song, file named by its id;
│   │                            catalog.ts holds titles and attributions
│   ├── jingles/               ← uncredited musical clips and loops
│   ├── music/MusicDirector.ts ← plays the winning music claim; scenes claim, never play
│   └── ambient/, bosses/, casino/, characters/, combat/, enemies/, effects/, events/, menu/
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

**No framework** — everything is Canvas 2D API calls. No DOM manipulation beyond mounting the canvas.

**Art is drawn in code, then baked to PNG.** Sprites and props are authored as Canvas 2D painters under `src/sprites/`, but the ones that would otherwise be replayed every frame are rasterised offline by a `scripts/generate-*.ts` script into a sheet under `src/images/`, described by that folder's `manifest.json`. The game then blits a frame instead of replaying the drawing. The painters stay the source of truth — the generators import them rather than reimplementing the art — so a change to a painter is picked up by re-running its generator.

**Where a new town asset goes.** `src/images/environment/townscape/` if another town or a later floor could hang the same thing (a lamp, a bench, a crate); `src/images/environment/towns/<town>/` if the picture is only correct in that town (a signpost whose arms name its streets). Keeping the two apart is what stops `townscape/` from becoming the place every town's one-off signage accumulates. Regenerate with `npm run gen:town-art`.

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
- **@rscarbel/game-server-llm-sdk** — optional AI connection (from GitHub Packages)
- **Prettier / ESLint** — formatting and linting
- **GitHub Pages** — auto-deploy on push to main

### Audio

Songs live in `src/audio/music/` (file named by its id, with a title and credit in `catalog.ts`), uncredited musical clips in `src/audio/jingles/`, sound effects in the category folders beside them. `npm run lint` includes `npm run check:audio`, which checks the registry, folders, catalogue and loudness table agree. After adding or replacing any audio file run `npm run measure:audio` (needs `ffmpeg` and `ffprobe`) to regenerate the loudness table. `npm run verify:audio` is the headless behaviour gate for music and mixing. See the `add-sound` skill.

### Build output

`npm run build` produces a minified `dist/bundle.js` and regenerates `sw.js`.

`npm run build:site` assembles the deployable `_site/` directory (what the
Pages workflow uploads); `npm run build:zip` packages the offline edition.
Both take their asset list from `scripts/shipped-assets.js`, which ships only
files the game actually references — sprite manifests are inlined into the
bundle, and generator scripts, source art, and `.ts` modules living under
`src/images` / `src/audio` are left out. Anything skipped is printed during the
build, so an asset that silently stops being referenced is visible rather than
quietly shipped.
