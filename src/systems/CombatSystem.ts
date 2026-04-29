import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { EventBus } from '../core/EventBus';
import type { AbilityManager } from '../core/AbilityManager';
import { makeSepsis, makeMagicBurn } from '../core/StatusEffect';

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
      mob.takeDamageFrom(damage, human, 'melee');
      ctx.hitLanded = true;
      if (human.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
        mob.applyStatus(makeSepsis());
      }
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
          mob.takeDamageFrom(damage, cat, 'missile');
          ctx.hitLanded = true;

          if (cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
            mob.applyStatus(makeSepsis());
          }

          // Level 5+: AoE magic splash
          if (missileLevel >= 5) {
            const splashDamage = Math.max(1, Math.round(damage * 0.4));
            const nearSplash = mobGrid.queryCircle(missile.x, missile.y, splashRadius + TILE_SIZE);
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

          missile.hit = true;
          missile.state = 'exploding';
          break;
        }
      }
    }
  }
}

export function resolveKills(ctx: CombatContext): void {
  const { mobs, human, cat, mobGrid, bus, abilityManager } = ctx;
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

    bus.emit('mobKilled', {
      mob,
      killer,
      killType: mob.killType,
      topDamageDealer: topPlayer,
    });
  }
}
