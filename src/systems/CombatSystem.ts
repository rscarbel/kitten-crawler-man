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

/** Shared context passed to combat resolution functions. */
export interface CombatContext {
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  gameMap: GameMap;
  safeRoom: SafeRoomSystem;
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
    x: e.x + TILE_SIZE * 0.5,
    y: e.y + TILE_SIZE * 0.5,
  });

  if (human.isAttackPeak() && !safeRoom.isEntityInSafeRoom(human)) {
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
      if (dist > TILE_SIZE * 1.0) {
        const dot = (dx / dist) * human.facingX + (dy / dist) * human.facingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
      if (!human.zeroDamage) {
        mob.takeDamageFrom(damage, human, 'melee');
        ctx.hitLanded = true;
        humanHit = true;
        if (human.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
          mob.applyStatus(makeSepsis());
        }
      }
    }
    ctx.bus.emit('humanMeleeSwing', { hit: humanHit });
  }

  if (cat.isAttackPeak() && !safeRoom.isEntityInSafeRoom(cat)) {
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
      if (dist > TILE_SIZE * 1.0) {
        const dot = (dx / dist) * cat.facingX + (dy / dist) * cat.facingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(cc.x, cc.y, mc.x, mc.y)) continue;
      if (!cat.zeroDamage) {
        mob.takeDamageFrom(damage, cat, 'melee');
        ctx.hitLanded = true;
        catHit = true;
        if (cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
          mob.applyStatus(makeSepsis());
        }
      }
    }
    ctx.bus.emit('catMeleeSwing', { hit: catHit });
  }

  // ── Smush AoE stomp ──
  if (human.isSmushPeak() && !safeRoom.isEntityInSafeRoom(human)) {
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
          mob.applyStatus(makeStun(150)); // 2.5s
        }
        // Level 14+: stun bosses at 25% chance
        if (
          isInner &&
          stats.stunBossChance > 0 &&
          mob.isBoss &&
          Math.random() < stats.stunBossChance
        ) {
          mob.applyStatus(makeStun(150));
        }
      }
    }

    // Level 10+: 20% chance to heal human for 50% of total damage dealt
    if (stats.healOnHit && totalSmushDamage > 0 && Math.random() < 0.2) {
      const healAmt = Math.round(totalSmushDamage * 0.5);
      human.hp = Math.min(human.hp + healAmt, human.maxHp);
    }

    if (ctx.hitLanded) {
      ctx.abilityManager.addUsageXp('smush');
    }
  }

  if (!safeRoom.isEntityInSafeRoom(cat)) {
    const missileLevel = cat.getMagicMissileLevel();
    const hitRadius = TILE_SIZE * 0.7;
    const splashRadius = TILE_SIZE * 1.5; // AoE splash radius at level 5+

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

            if (cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
              mob.applyStatus(makeSepsis());
            }

            // Level 5+: AoE magic splash
            if (missileLevel >= 5) {
              const splashDamage = Math.max(1, Math.round(damage * 0.4));
              const nearSplash = mobGrid.queryCircle(
                missile.x,
                missile.y,
                splashRadius + TILE_SIZE,
              );
              for (const splashMob of nearSplash) {
                if (!splashMob.isAlive || splashMob === mob) continue;
                const splashDx = splashMob.x + TILE_SIZE * 0.5 - missile.x;
                const splashDy = splashMob.y + TILE_SIZE * 0.5 - missile.y;
                if (Math.hypot(splashDx, splashDy) < splashRadius) {
                  splashMob.takeDamageFrom(splashDamage, cat, 'missile');
                }
              }
            }

            // Level 10+: queue sub-missiles from impact point (non-sub missiles only)
            if (missileLevel >= 10 && !missile.isSubMissile) {
              cat.queueSubMissileSpawn(missile.x, missile.y);
            }

            // Level 15: slow bosses and grant kill XP tracked separately in resolveKills
            if (missileLevel >= 15 && mob.isBoss) {
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
    const topXp = Math.max(1, Math.round(totalXp * 0.85));
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

      if (cat.getMagicMissileLevel() >= 15) {
        const shockwaveRadius = TILE_SIZE * 5;
        const cx = mob.x + TILE_SIZE * 0.5;
        const cy = mob.y + TILE_SIZE * 0.5;
        const nearShock = mobGrid.queryCircle(cx, cy, shockwaveRadius);
        for (const nearMob of nearShock) {
          if (!nearMob.isAlive) continue;
          const sdx = nearMob.x + TILE_SIZE * 0.5 - cx;
          const sdy = nearMob.y + TILE_SIZE * 0.5 - cy;
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
      if (spells.activeShellLevel >= 15 && spells.isInsideShell(mob.x, mob.y)) {
        spells.addChainLightningOrigin(mob.x + TILE_SIZE * 0.5, mob.y + TILE_SIZE * 0.5);
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
