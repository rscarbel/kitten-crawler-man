import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { EventBus } from '../core/EventBus';
import type { AbilityManager } from '../core/AbilityManager';
import type { SpellSystem } from './SpellSystem';
import { makeSepsis, makeMagicBurn, makeStun } from '../core/StatusEffect';
import { getSmushStats } from '../abilities/smush';

/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Sepsis proc chance per hit when enchanted crown is equipped. */
const SEPSIS_PROC_CHANCE = 0.15;
/** Melee hit cone: mobs within this range ignore the facing-dot check. */
const MELEE_POINT_BLANK_RANGE = TILE_SIZE * 1;
/** Fraction of total kill XP awarded to the top damage dealer. */
const XP_TOP_DEALER_FRACTION = 0.85;
/** Minimum missile level to trigger AoE splash damage. */
const MISSILE_SPLASH_LEVEL = 5;
/** Splash damage as a fraction of direct missile damage. */
const MISSILE_SPLASH_DAMAGE_FRACTION = 0.4;
/** Minimum missile level to spawn sub-missiles on impact. */
const MISSILE_SUB_MISSILE_LEVEL = 10;
/** Minimum missile level to slow bosses. */
const MISSILE_SLOW_BOSS_LEVEL = 15;
/** Shockwave radius in tiles for level-15 missile kill. */
const MISSILE_SHOCKWAVE_RADIUS_TILES = 5;
/** Minimum shell level for chain lightning to trigger on kill. */
const SHELL_CHAIN_LIGHTNING_LEVEL = 15;
/** Missile collision hit radius as a fraction of TILE_SIZE. */
const MISSILE_HIT_RADIUS_FRACTION = 0.7;
/** Boss stun duration in frames when smush lands in the inner blast zone. */
const SMUSH_BOSS_STUN_FRAMES = 150;
/** Smush heal-on-hit chance (10th-level+). */
const SMUSH_HEAL_CHANCE = 0.2;
/** Smush heal fraction of total damage dealt. */
const SMUSH_HEAL_FRACTION = 0.5;
/** Stun duration in frames for smush non-boss stun. */
const SMUSH_STUN_FRAMES = 150;

/** Shared context passed to combat resolution functions. */
export interface CombatContext {
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  gameMap: GameMap;
  /** Null in scenes without safe rooms (e.g. building interiors) — attacks always resolve. */
  safeRoom: Pick<SafeRoomSystem, 'isEntityInSafeRoom'> | null;
  bus: EventBus;
  abilityManager: AbilityManager;
  spells: SpellSystem;
  /** Set to true by resolvePlayerAttacks when any hit connected this frame. */
  hitLanded: boolean;
}

export function resolvePlayerAttacks(ctx: CombatContext): void {
  const { human, cat, mobGrid, gameMap, safeRoom } = ctx;
  ctx.hitLanded = false;
  const centerOf = (e: { x: number; y: number }) => ({
    x: e.x + HALF_TILE,
    y: e.y + HALF_TILE,
  });
  const inSafeRoom = (entity: HumanPlayer | CatPlayer): boolean =>
    safeRoom?.isEntityInSafeRoom(entity) ?? false;

  if (human.isAttackPeak() && !inSafeRoom(human)) {
    const hc = centerOf(human);
    const range = human.getMeleeRange();
    const damage = human.getMeleeDamage();
    const nearHuman = mobGrid.queryCircle(hc.x, hc.y, range);
    let humanHit = false;
    for (const mob of nearHuman) {
      if (!mob.isAlive || !mob.isHostile) continue;
      const mc = centerOf(mob);
      const dx = mc.x - hc.x;
      const dy = mc.y - hc.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      if (dist > MELEE_POINT_BLANK_RANGE) {
        const dot = (dx / dist) * human.facingX + (dy / dist) * human.facingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
      if (!human.zeroDamage) {
        mob.takeDamageFrom(damage, human, 'melee');
        ctx.hitLanded = true;
        humanHit = true;
        if (
          human.inventory.hasEquipped('enchanted_crown_sepsis_whore') &&
          Math.random() < SEPSIS_PROC_CHANCE
        ) {
          mob.applyStatus(makeSepsis());
        }
      }
    }
    ctx.bus.emit('humanMeleeSwing', { hit: humanHit });
  }

  if (cat.isAttackPeak() && !inSafeRoom(cat)) {
    const cc = centerOf(cat);
    const range = cat.getMeleeRange();
    const damage = cat.getMeleeDamage();
    const nearCat = mobGrid.queryCircle(cc.x, cc.y, range);
    let catHit = false;
    for (const mob of nearCat) {
      if (!mob.isAlive || !mob.isHostile) continue;
      const mc = centerOf(mob);
      const dx = mc.x - cc.x;
      const dy = mc.y - cc.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      if (dist > MELEE_POINT_BLANK_RANGE) {
        const dot = (dx / dist) * cat.facingX + (dy / dist) * cat.facingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(cc.x, cc.y, mc.x, mc.y)) continue;
      if (!cat.zeroDamage) {
        mob.takeDamageFrom(damage, cat, 'melee');
        ctx.hitLanded = true;
        catHit = true;
        if (
          cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') &&
          Math.random() < SEPSIS_PROC_CHANCE
        ) {
          mob.applyStatus(makeSepsis());
        }
      }
    }
    ctx.bus.emit('catMeleeSwing', { hit: catHit });
  }

  // ── Smush AoE stomp ──
  if (human.isSmushPeak() && !inSafeRoom(human)) {
    const smushLevel = ctx.abilityManager.getLevel('smush');
    const stats = getSmushStats(smushLevel);
    const hc = centerOf(human);
    const baseDamage = human.getMeleeDamage();
    const innerRadius = stats.innerBlastRadius * TILE_SIZE;
    const outerRadius = stats.outerBlastRadius * TILE_SIZE;

    let totalSmushDamage = 0;

    // Query both rings in one pass using the outer radius
    const nearSmush = mobGrid.queryCircle(hc.x, hc.y, outerRadius + TILE_SIZE);
    for (const mob of nearSmush) {
      if (!mob.isAlive || !mob.isHostile) continue;
      const mc = centerOf(mob);
      const dist = Math.hypot(mc.x - hc.x, mc.y - hc.y);
      if (dist > outerRadius) continue;
      if (!human.zeroDamage) {
        const isInner = dist <= innerRadius;
        const mult = isInner ? stats.damageMultiplier : stats.outerDamageMultiplier;
        const bossMult = mob.isBoss ? stats.bossDamageMultiplier : 1.0;
        const damage = Math.max(1, Math.round(baseDamage * mult * bossMult));
        mob.takeDamageFrom(damage, human, 'smush');
        ctx.hitLanded = true;
        totalSmushDamage += damage;

        // Level 5+: stun non-boss enemies
        if (isInner && stats.stunSmallEnemies && !mob.isBoss) {
          mob.applyStatus(makeStun(SMUSH_STUN_FRAMES));
        }
        // Level 14+: stun bosses at 25% chance
        if (
          isInner &&
          stats.stunBossChance > 0 &&
          mob.isBoss &&
          Math.random() < stats.stunBossChance
        ) {
          mob.applyStatus(makeStun(SMUSH_BOSS_STUN_FRAMES));
        }
      }
    }

    // Level 10+: 20% chance to heal human for 50% of total damage dealt
    if (stats.healOnHit && totalSmushDamage > 0 && Math.random() < SMUSH_HEAL_CHANCE) {
      const healAmt = Math.round(totalSmushDamage * SMUSH_HEAL_FRACTION);
      human.hp = Math.min(human.hp + healAmt, human.maxHp);
    }

    if (ctx.hitLanded) {
      ctx.abilityManager.addUsageXp('smush');
    }
  }

  if (!inSafeRoom(cat)) {
    const missileLevel = cat.getMagicMissileLevel();
    const hitRadius = TILE_SIZE * MISSILE_HIT_RADIUS_FRACTION;
    const splashRadius = TILE_SIZE + HALF_TILE; // AoE splash radius at level 5+

    for (const missile of cat.getMissiles()) {
      if (missile.state !== 'flying' || missile.hit) continue;
      const damage = cat.getMissileDamage();
      const nearMissile = mobGrid.queryCircle(missile.x, missile.y, hitRadius + TILE_SIZE);
      for (const mob of nearMissile) {
        if (!mob.isAlive) continue;
        const mc = centerOf(mob);
        const dist = Math.hypot(missile.x - mc.x, missile.y - mc.y);
        if (dist < hitRadius) {
          if (!cat.zeroDamage) {
            mob.takeDamageFrom(damage, cat, 'missile');
            ctx.hitLanded = true;
            ctx.bus.emit('missileImpact', {});

            if (
              cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') &&
              Math.random() < SEPSIS_PROC_CHANCE
            ) {
              mob.applyStatus(makeSepsis());
            }

            // Level 5+: AoE magic splash
            if (missileLevel >= MISSILE_SPLASH_LEVEL) {
              const splashDamage = Math.max(1, Math.round(damage * MISSILE_SPLASH_DAMAGE_FRACTION));
              const nearSplash = mobGrid.queryCircle(
                missile.x,
                missile.y,
                splashRadius + TILE_SIZE,
              );
              for (const splashMob of nearSplash) {
                if (!splashMob.isAlive || splashMob === mob) continue;
                const splashDx = splashMob.x + HALF_TILE - missile.x;
                const splashDy = splashMob.y + HALF_TILE - missile.y;
                if (Math.hypot(splashDx, splashDy) < splashRadius) {
                  splashMob.takeDamageFrom(splashDamage, cat, 'missile');
                }
              }
            }

            // Level 10+: queue sub-missiles from impact point (non-sub missiles only)
            if (missileLevel >= MISSILE_SUB_MISSILE_LEVEL && !missile.isSubMissile) {
              cat.queueSubMissileSpawn(missile.x, missile.y);
            }

            // Level 15: slow bosses and grant kill XP tracked separately in resolveKills
            if (missileLevel >= MISSILE_SLOW_BOSS_LEVEL && mob.isBoss) {
              mob.isSlowed = true;
            }
          }

          missile.hit = true;
          missile.state = 'exploding';
          break;
        }
      }
    }
  }
}

export function resolveKills(ctx: CombatContext): void {
  const { mobs, human, cat, mobGrid, bus, abilityManager, spells } = ctx;
  for (const mob of mobs) {
    if (!mob.justDied) continue;
    mob.justDied = false;
    mobGrid.remove(mob);

    let totalDmg = 0;
    for (const dmg of mob.damageTakenBy.values()) totalDmg += dmg;
    if (totalDmg === 0) continue;

    let topPlayer: HumanPlayer | CatPlayer | null = null;
    let maxDmg = 0;
    for (const [p, dmg] of mob.damageTakenBy) {
      if (dmg > maxDmg) {
        maxDmg = dmg;
        if (p instanceof HumanPlayer || p instanceof CatPlayer) topPlayer = p;
      }
    }
    const otherPlayer = topPlayer === human ? cat : human;

    const totalXp = mob.scaledXpValue;
    const topXp = Math.max(1, Math.round(totalXp * XP_TOP_DEALER_FRACTION));
    const shareXp = Math.max(1, totalXp - topXp);
    if (topPlayer?.gainXp(topXp)) {
      bus.emit('playerLevelUp', { player: topPlayer, newLevel: topPlayer.level });
    }
    if (otherPlayer.gainXp(shareXp)) {
      bus.emit('playerLevelUp', { player: otherPlayer, newLevel: otherPlayer.level });
    }

    const killer =
      mob.killedBy instanceof HumanPlayer || mob.killedBy instanceof CatPlayer
        ? mob.killedBy
        : null;

    // Magic missile kill XP + level-15 death shockwave
    if (mob.killType === 'missile' && killer === cat) {
      abilityManager.addKillXp('magic_missile');

      if (cat.getMagicMissileLevel() >= MISSILE_SLOW_BOSS_LEVEL) {
        const shockwaveRadius = TILE_SIZE * MISSILE_SHOCKWAVE_RADIUS_TILES;
        const cx = mob.x + HALF_TILE;
        const cy = mob.y + HALF_TILE;
        const nearShock = mobGrid.queryCircle(cx, cy, shockwaveRadius);
        for (const nearMob of nearShock) {
          if (!nearMob.isAlive) continue;
          const sdx = nearMob.x + HALF_TILE - cx;
          const sdy = nearMob.y + HALF_TILE - cy;
          if (Math.hypot(sdx, sdy) < shockwaveRadius) {
            nearMob.applyStatus(makeMagicBurn());
          }
        }
      }
    }

    // Smush kill XP + level 14 double gold
    if (mob.killType === 'smush' && killer === human) {
      abilityManager.addKillXp('smush');
      const smushLevel = abilityManager.getLevel('smush');
      if (
        getSmushStats(smushLevel).doubleGoldOnKill &&
        mob.droppedLoot !== null &&
        !mob.droppedLoot.goldDoubled
      ) {
        mob.droppedLoot.coins = Math.round(mob.droppedLoot.coins * 2);
        mob.droppedLoot.goldDoubled = true;
      }
    }

    // Protective shell kill XP + level-15 chain lightning
    if (mob.killType === 'shell' && killer === human) {
      abilityManager.addKillXp('protective_shell');

      // Level-15 chain lightning: if mob died inside the active shell, queue origin
      if (
        spells.activeShellLevel >= SHELL_CHAIN_LIGHTNING_LEVEL &&
        spells.isInsideShell(mob.x, mob.y)
      ) {
        spells.addChainLightningOrigin(mob.x + HALF_TILE, mob.y + HALF_TILE);
      }
    }

    bus.emit('mobKilled', {
      mob,
      killer,
      killType: mob.killType,
      topDamageDealer: topPlayer,
    });
  }
}
