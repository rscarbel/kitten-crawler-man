import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import { SpatialGrid } from '../core/SpatialGrid';
import { GameMap } from '../map/GameMap';
import { SafeRoomSystem } from './SafeRoomSystem';
import { MiniMapSystem } from './MiniMapSystem';
import { LootSystem } from './LootSystem';
import { AchievementManager } from '../core/AchievementManager';
import { makeSepsis } from '../core/StatusEffect';

export function resolvePlayerAttacks(
  human: HumanPlayer,
  cat: CatPlayer,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
  safeRoom: SafeRoomSystem,
): void {
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

export function resolveKills(
  mobs: Mob[],
  human: HumanPlayer,
  cat: CatPlayer,
  mobGrid: SpatialGrid<Mob>,
  miniMap: MiniMapSystem,
  loot: LootSystem,
  humanAchievements: AchievementManager,
  catAchievements: AchievementManager,
): void {
  for (const mob of mobs) {
    if (!mob.justDied) continue;
    mob.justDied = false;
    mobGrid.remove(mob);
    miniMap.addCorpseMarker(mob.x + TILE_SIZE * 0.5, mob.y + TILE_SIZE * 0.5);

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

    // Achievement checks
    if (mob.killedBy === human) humanAchievements.tryUnlock('first_blood');
    if (mob.killedBy === cat) catAchievements.tryUnlock('first_blood');
    if (mob.isBoss) {
      if (!humanAchievements.tryUnlock('boss_slayer')) {
        humanAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }
      if (!catAchievements.tryUnlock('boss_slayer')) {
        catAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }
    }
    if (mob.killedBy === human && mob.killType === 'melee' && human.nextType === 'punch') {
      humanAchievements.tryUnlock('smush');
    }
    if (mob.killedBy === cat && mob.killType === 'missile') {
      catAchievements.tryUnlock('magic_touch');
    }

    if (mob.droppedLoot && topPlayer) {
      loot.addLoot(
        mob.x + TILE_SIZE * 0.5,
        mob.y + TILE_SIZE * 0.5,
        mob.droppedLoot,
        topPlayer,
        mob.isBoss,
      );
      mob.droppedLoot = null;
    }
  }
}
