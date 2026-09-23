---
name: add-creature
description: Add a new enemy, boss, or NPC to Kitten Crawler Man — Mob subclass, AI, spawning, loot, gore, and audio hookup. Use when creating or modifying any creature in src/creatures/.
---

# Add a Creature

A mob is a `Player` with AI: `Mob` (`src/creatures/Mob.ts`) extends `Player` (`src/Player.ts`). Copy `src/creatures/Rat.ts` as the simplest template; `Goblin.ts` shows config-driven variants + custom loot.

## Required in the subclass

- `readonly xpValue: number` (abstract).
- `updateAI(targets: Player[]): void` (abstract) — called each frame by `MobUpdateLoop`. Pattern: guard `if (!this.isAlive) return` → tick cooldowns → find nearest living target in aggro range → `updateLastKnown(target)` + `followTargetAStar(...)` → attack in range via `this.dealDamage(target, base)` → else `doWander()`.
- `render(ctx, camX, camY, tileSize)` (abstract from `Player`) — compute `sx = this.x - camX`, `sy = this.y - camY`, call your sprite draw fn, then `renderMobHealthBar` + `renderDamageFlash` (and `renderAggroIndicator` if aggro'd).
- Constructor: `constructor(tileX, tileY, tileSize) { super(tileX, tileY, tileSize, MAX_HP, SPEED); }` — extract HP/speed/ranges into named module-level constants (CLAUDE.md: no magic numbers).

## Optional overrides (all have base defaults)

`coinDropMin/Max`, `displayName`, `description`, `audioTag`, `bodyPartKey`, `mass` (heavier = displaced less in separation), `isFlying`, `isBoss`, `isHostile`, `requiresEvasion`, `rollLootItems(killer)` for creature-specific drops, `tacticsEligibility` (see below).

## Do not reimplement — inherited helpers

`dealDamage(target, base)` (**use this, not `target.takeDamage()`** — it scales with mob level and sets `attackSoundPending`), `takeDamageFrom` (handles damage tracking, kill credit, loot roll), `followTargetAStar`, `followTargetCollide`, `moveWithCollision` (respects walls), `hasLOS`, `doWander`, `applyMobLevel`, `applyStatus`/`hasStatus`. `setMap()` is injected by the spawner.

Level math goes through `src/creatures/mobLevelScaling.ts` (`hpScaleForLevel`, `damageScaleForLevel`, `scaledCooldownFramesForLevel`, ...). Never write `1 + x * (level - 1)` in a creature, boss or system — `npm run verify:difficulty-curve` prices every regular creature, boss and bounty escort through those curves, and it fails (rather than skips) a creature it cannot build headlessly, kill or measure damage from.

## Tactics traits

Levelled mobs can learn `flank`, `block`, `kite`, `regroup` and `riposte` (`src/creatures/tactics/`; rules are P6 in `docs/difficulty-fairness-rules.md`). A creature opts in by overriding `protected get tacticsEligibility(): readonly TacticsTrait[]`. The default is none, and it **stays none** for bosses, quest NPCs, summons, maze targets, non-combatants, mercenaries and rooted creatures (a rooted mob cannot flank or kite). When a boss or system conjures a creature that is eligible on its own (Miss Quill's krasues), set `mob.isSummon = true` before `applySpawnDifficulty` and it rolls nothing. List only traits your `updateAI` actually acts on — a rolled trait with no behaviour behind it is a promise the fight never keeps.

- Which bodies suit which traits: melee brawlers take `flank`, `block`, `regroup`, `riposte`; pack skirmishers add `kite`; ranged creatures take `kite` (with a `KiteAim` that keeps a friend between them and the player) and `regroup`, never `block`; tiny swarmers take `flank` only.
- `block` needs no creature code — `Mob.takeDamageFrom` rolls the guard and shoves the mob. But while a guard's shove runs, `Mob.moveWithCollision` refuses the mob's own movement. A charger that reads a refused move as a wall hit (and stuns itself, ends its charge, bounces) will misfire on every guard; handle that before listing `block`.
- Movement traits are wired into `updateAI`. `Goblin` is the reference: each frame with a target, call `this.tactics.chooseMove(frame)` (a `TacticalFrame` with `canBreakOff` false mid-swing), walk a `breaksOff` move instead of fighting, walk a flank move as the chase goal, and keep facing the target on arrival. A creature that chases its last sighting with `followTargetAStar` does all of that through two `Mob` helpers: `chooseTacticalStep(target, attackRangePx, canBreakOff, kiteAim?)` (builds the frame, drops the cached route when the answer changes kind) and `walkTacticalStep(move, target)` (walks it, caps a retreat at `TACTICAL_RETREAT_MAX_SPEED` so a fast creature stays catchable, faces the target on stopping) — `RuinsGhoul` is the shortest example. Call `this.tactics.disengage()` when the target is lost. For `riposte`, `if (this.tactics.claimRiposte()) this.attackCooldown = riposteCooldown(this.attackCooldown, swingFramesLeft)` — it cuts only the wait between attacks, never the windup.
- A creature whose body changes mid-life can make `tacticsEligibility` read its current form (`BrindleGrub` flanks as a grub, learns nothing as a Vespa). Traits are still rolled once, at spawn; one the new body is not eligible for goes dormant — dropped from `activeTacticsTraits`, which the rank mark, notices and telemetry read — rather than stripped. Stop asking for tactical moves in that form and call `this.tactics.disengage()` when it changes.
- Traits are rolled at spawn by `applySpawnDifficulty` (`src/core/difficultyProfiles.ts`), which every spawn site must call straight after `applyMobLevel`. A system that levels a mob itself (a summon, a quest wave) calls it too.
- Run `npm run verify:tactics` after opting a creature in.

## Registration (all required for spawnable mobs)

1. `src/levels/spawner.ts` — import the class and add `registerMob('my_mob', (x, y) => new MyMob(x, y, TILE_SIZE))`. Unknown keys silently fall back to goblin, so don't skip this.
2. `src/levels/types.ts` — add `'my_mob'` to the `MobSpawnRule['type']` string union.
3. Reference it in a level def (`src/levels/level*.ts`): `roomMobs`/`hallwayMobs` (`{ type, chance, minCount, maxCount, minLevel, maxLevel }`), `bossRooms: [{ type }]`, `extraSpawns` (landmark-relative, optional `setup` callback in `SPAWN_SETUP` for post-spawn init like arena binding), or `onMobKilledSpawns`.
4. `src/core/assetGroups.ts` — add the mob type to `MOB_SPRITE_KEYS`, listing the sprite keys it needs (an empty array if it draws procedurally with no sheet). `npm run verify:assets` hard-fails on any registered mob type with no entry, so this is not optional.
5. If the sheet is new, add its key to whichever `AssetGroup` covers the context the creature appears in, and make sure every floor that can produce it declares that group — via `LevelDef.spriteGroups` for a spawn-table mob, or via a `SYSTEM_ASSET_REQUIREMENTS` entry (`src/core/systemAssetRequirements.ts`) for anything a _system_ constructs: a bounty escort, a quest wave, a companion, a mid-fight summon. A creature reachable only through a system is named in no `LevelDef`, so nothing else declares it and its sheet would never be grouped. Background: `docs/asset-management.md`.

## Runtime spawning

Any mob added mid-game joins through the scene's roster: `world.roster.add(mob)` (or `ctx.roster.add(mob)` inside a system). That is the only spawn path — it inserts into the list _and_ the spatial grid _and_ hands the mob the scene's map and spell context, and a mob that misses the last of those walks straight through a protective shell. AI only runs within `AI_RADIUS` of players via `roster.grid.queryCircle` unless `requiresEvasion` is set. `CombatSystem.resolveKills` removes dead mobs from the grid.

## Don't forget

- **Sprite**: see the `add-sprite` skill — you need a sprite sheet + manifest entry + `src/sprites/myMobSprite.ts` draw wrapper.
- **Loot**: automatic via `coinDropMin/Max` + `rollLootItems()`; override the latter for custom drops.
- **XP/kills**: automatic if you use `dealDamage`/`takeDamageFrom` — `CombatSystem.resolveKills` splits XP and emits `mobKilled`.
- **Gore**: blood is automatic. Body-part gore is opt-in: set `bodyPartKey`, add a config in `BODY_PART_REGISTRY` (`src/systems/BodyPartGoreSystem.ts`), and add matching `gore_*` states to the sprite manifest.
- **Sounds**: set `audioTag`, then add a `case` for it in the audio switch in `DungeonScene` (search `audioTag` there). Set `projectileSoundPending` yourself for ranged attacks. See `add-sound`.
- **Y-sort rendering**: free — `RenderPipeline` sorts by `mob.y`.
- **Telegraphed attacks**: a new telegraphed attack must satisfy the P2 fairness invariants in `docs/difficulty-fairness-rules.md`, and is gated by `npm run verify:difficulty`.

## Companions and pets

A player-owned creature is a `Mob` with three contracts the base class does not give you. `Mongo` (`src/creatures/Mongo.ts` + `src/systems/MongoSystem.ts` + `src/core/MongoPetState.ts`) is the worked example; read those three together before building another.

**Attribution.** A pet must deal damage in its own name — pass itself as the attacker and set `target.retaliateMob = this` — or the mobs it mauls come after the owner standing behind it. Kill credit is then redirected by `Player.xpCreditTarget` (defaults to `this`; a pet returns its owner), which `CombatSystem.resolveKills` maps damage entries through, so the owner keeps the XP exactly as before. `Mob.killedByDealer` holds the literal dealer alongside the credited one, because killer-keyed loot rolls and achievements must still see the pet. Any `takeDamageFrom` override in a boss subclass has to preserve this mapping or it silently drops pet credit.

**Targeting.** `Mob.isPetAttackable` (default `isHostile`) is the pet's target predicate, not `isHostile` directly — it lets a calm creature opt into being prey without becoming hostile to the player. A pet's acquisition must still pass `canNotice`; it is easy to write the one targeting path in the codebase with no perception gate, and a pet that beelines at enemies through walls is what that looks like.

**State outlives the creature object.** A pet that is summoned and dismissed is a new instance every time, so HP, regeneration, level-scaling and any recovery lock live in a plain state object threaded through scene options — never on the `Mob`. Two consequences worth knowing in advance: the accessor a save path or a UI bar reads must distinguish stored HP from live HP (a spent pet is pinned at 1 HP so it can walk home, and an autosave mid-retreat would otherwise record that 1 as health it does not have); and a pet that despawns leaves every mob it provoked holding a `retaliateMob` reference to a creature that never dies, so those references must be cleared both when the retreat starts and when it finishes.

**Summoning onto a tile.** Derive the owner's tile from her centre, not `floor(x / TILE_SIZE)` — that is the tile under the sprite's top-left corner, which in a corridor is masonry. Ring-search for a nearby walkable tile, require line of sight from the owner (or the search "solves" a blocked corridor by placing the pet in the room through the wall), and exclude stairwell tiles: `isWalkable` admits them while `Mob.moveWithCollision` refuses to enter one, so the spawn contract has to match the movement contract or the creature lands somewhere it cannot leave. If no tile qualifies, refuse the summon with a message — there is no valid "just use the owner's tile" fallback, because the only way to reach that case is the owner herself standing somewhere unwalkable.

**Leash bands are not self-guaranteeing.** Ordering an engage-persist radius inside a leash-break radius does not prevent yo-yoing: persist is straight-line, the leash is route length, so a mob four tiles away behind a nine-tile detour is simultaneously inside persist and past break. What stops it is dropping the target and holding it off in a ban map with an expiry. Likewise a follow band needs a latched flag, not two thresholds — re-deciding from raw distance each frame stops the pet the instant it crosses the line, the owner's next step pushes it back over, and the sprite vibrates at her shoulder. And a stall detector must measure pixels actually covered, never `isMoving`, which is true for a mob grinding into a wall.

Finish with the `dev-workflow` gates (typecheck, lint, format), plus `npm run verify:assets`, `npm run verify:difficulty-curve`, and `npm run verify:tactics` if the creature is tactics-eligible.
