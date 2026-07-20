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

`coinDropMin/Max`, `displayName`, `description`, `audioTag`, `bodyPartKey`, `mass` (heavier = displaced less in separation), `isFlying`, `isBoss`, `isHostile`, `requiresEvasion`, `rollLootItems(killer)` for creature-specific drops.

## Do not reimplement — inherited helpers

`dealDamage(target, base)` (**use this, not `target.takeDamage()`** — it scales with mob level and sets `attackSoundPending`), `takeDamageFrom` (handles damage tracking, kill credit, loot roll), `followTargetAStar`, `followTargetCollide`, `moveWithCollision` (respects walls), `hasLOS`, `doWander`, `applyMobLevel`, `applyStatus`/`hasStatus`. `setMap()` is injected by the spawner.

## Registration (all required for spawnable mobs)

1. `src/levels/spawner.ts` — import the class and add `registerMob('my_mob', (x, y) => new MyMob(x, y, TILE_SIZE))`. Unknown keys silently fall back to goblin, so don't skip this.
2. `src/levels/types.ts` — add `'my_mob'` to the `MobSpawnRule['type']` string union.
3. Reference it in a level def (`src/levels/level*.ts`): `roomMobs`/`hallwayMobs` (`{ type, chance, minCount, maxCount, minLevel, maxLevel }`), `bossRooms: [{ type }]`, `extraSpawns` (landmark-relative, optional `setup` callback in `SPAWN_SETUP` for post-spawn init like arena binding), or `onMobKilledSpawns`.

## Runtime spawning

Any mob added mid-game must go into both collections: `this.mobs.push(mob)` **and** `this.mobGrid.insert(mob)` (see `DungeonScene`). AI only runs within `AI_RADIUS` of players via `mobGrid.queryCircle` unless `requiresEvasion` is set. `CombatSystem.resolveKills` removes dead mobs from the grid.

## Don't forget

- **Sprite**: see the `add-sprite` skill — you need a sprite sheet + manifest entry + `src/sprites/myMobSprite.ts` draw wrapper.
- **Loot**: automatic via `coinDropMin/Max` + `rollLootItems()`; override the latter for custom drops.
- **XP/kills**: automatic if you use `dealDamage`/`takeDamageFrom` — `CombatSystem.resolveKills` splits XP and emits `mobKilled`.
- **Gore**: blood is automatic. Body-part gore is opt-in: set `bodyPartKey`, add a config in `BODY_PART_REGISTRY` (`src/systems/BodyPartGoreSystem.ts`), and add matching `gore_*` states to the sprite manifest.
- **Sounds**: set `audioTag`, then add a `case` for it in the audio switch in `DungeonScene` (search `audioTag` there). Set `projectileSoundPending` yourself for ranged attacks. See `add-sound`.
- **Y-sort rendering**: free — `RenderPipeline` sorts by `mob.y`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
