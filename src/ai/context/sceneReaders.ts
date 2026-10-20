import { TILE_SIZE } from '../../core/constants';
import { displayHp } from '../../core/crawlerFormulas';
import { ITEM_DEF } from '../../core/ItemDefs';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { mobLabel } from './eventMapping';
import type { CrawlerName, CrawlerState, NearbyMobState, ThreatLevel } from './types';

/** Mobs further than this from the active crawler are not "nearby" for the AI. */
export const NEARBY_MOB_RADIUS_TILES = 15;
export const NEARBY_MOB_MAX = 8;
/** Level gaps (mob minus party) that step the threat scale up. */
const TRIVIAL_LEVEL_GAP = -5;
const LOW_LEVEL_GAP = -2;
const MODERATE_LEVEL_GAP = 1;
const HIGH_LEVEL_GAP = 3;
const PERCENT = 100;
const HEALTH_POTION = 'health_potion';
const QUEST_ITEM_PREFIX = 'quest_';

export function tileOf(entity: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.floor(entity.x / TILE_SIZE), y: Math.floor(entity.y / TILE_SIZE) };
}

export function threatOf(mob: Mob, partyLevel: number): ThreatLevel {
  const gap = mob.level - partyLevel;
  if (mob.isBoss) return gap >= 0 ? 'deadly' : 'high';
  if (gap <= TRIVIAL_LEVEL_GAP) return 'trivial';
  if (gap <= LOW_LEVEL_GAP) return 'low';
  if (gap <= MODERATE_LEVEL_GAP) return 'moderate';
  if (gap <= HIGH_LEVEL_GAP) return 'high';
  return 'deadly';
}

/**
 * Items worth the AI's attention: anything with a use (consumables, gear,
 * tools) and quest items. Raw resources (wood, stone) are left out; there are
 * too many of them to matter one by one.
 */
function notableItems(player: Player): Record<string, number> {
  const counts: Record<string, number> = {};
  const slots = [...player.inventory.bag.slots, ...player.inventory.actionBar.slots];
  for (const slot of slots) {
    if (slot === null) continue;
    const notable = slot.type !== undefined || slot.id.startsWith(QUEST_ITEM_PREFIX);
    if (!notable) continue;
    counts[slot.name] = (counts[slot.name] ?? 0) + slot.quantity;
  }
  return counts;
}

function equippedNames(player: Player): Record<string, string> {
  const equipped: Record<string, string> = {};
  for (const [slotKey, itemId] of player.inventory.equipment.entries()) {
    equipped[slotKey] = ITEM_DEF[itemId].name;
  }
  return equipped;
}

export function readCrawler(player: Player, name: CrawlerName): CrawlerState {
  const tile = tileOf(player);
  return {
    name,
    hp: displayHp(player.hp),
    maxHp: player.maxHp,
    level: player.level,
    xp: player.xp,
    coins: player.coins,
    isActive: player.isActive,
    knockedOut: player.isKnockedOut,
    statusEffects: player.statusEffects.map((effect) => effect.type),
    equipped: equippedNames(player),
    notableItems: notableItems(player),
    healthPotions: player.inventory.countOf(HEALTH_POTION),
    tileX: tile.x,
    tileY: tile.y,
  };
}

/** Living hostiles near `from`, nearest first. */
export function readNearbyMobs(mobs: readonly Mob[], from: Player): NearbyMobState[] {
  const origin = tileOf(from);
  return mobs
    .filter((mob) => mob.isAlive && mob.isHostile)
    .map((mob) => {
      const tile = tileOf(mob);
      return { mob, distance: Math.hypot(tile.x - origin.x, tile.y - origin.y) };
    })
    .filter((entry) => entry.distance <= NEARBY_MOB_RADIUS_TILES)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_MOB_MAX)
    .map(({ mob, distance }) => ({
      name: mobLabel(mob),
      level: mob.level,
      isBoss: mob.isBoss,
      threat: threatOf(mob, from.level),
      hpPercent: mob.maxHp > 0 ? Math.round((displayHp(mob.hp) / mob.maxHp) * PERCENT) : 0,
      distanceTiles: Math.round(distance),
    }));
}
