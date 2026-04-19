import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import { SpatialGrid } from '../core/SpatialGrid';
import { GameMap } from '../map/GameMap';
import { SafeRoomSystem } from './SafeRoomSystem';
import { EventBus } from '../core/EventBus';
import { makeSepsis } from '../core/StatusEffect';

/** Shared context passed to combat resolution functions. */
export interface CombatContext {
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  gameMap: GameMap;
  safeRoom: SafeRoomSystem;
  bus: EventBus;
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
      // Sepsis proc: 15% chance when Enchanted Crown is equipped
      if (human.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
        mob.applyStatus(makeSepsis());
      }
    }
  }

  if (!safeRoom.isEntityInSafeRoom(cat)) {
    const hitRadius = TILE_SIZE * 0.7;
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
          // Sepsis proc: 15% chance when Enchanted Crown is equipped
          if (cat.inventory.hasEquipped('enchanted_crown_sepsis_whore') && Math.random() < 0.15) {
            mob.applyStatus(makeSepsis());
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
  const { mobs, human, cat, mobGrid, bus } = ctx;
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
        topPlayer = p as HumanPlayer | CatPlayer;
      }
    }
    const otherPlayer = topPlayer === human ? cat : human;

    const totalXp = mob.scaledXpValue;
    const topXp = Math.max(1, Math.round(totalXp * 0.85));
    const shareXp = Math.max(1, totalXp - topXp);
    if (topPlayer) topPlayer.gainXp(topXp);
    if (otherPlayer) otherPlayer.gainXp(shareXp);

    bus.emit('mobKilled', {
      mob,
      killer: mob.killedBy as HumanPlayer | CatPlayer | null,
      killType: mob.killType,
      topDamageDealer: topPlayer,
    });
  }
}
