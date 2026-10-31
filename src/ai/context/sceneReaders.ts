import { TILE_SIZE } from '../../core/constants';
import { displayHp } from '../../core/party/crawlerFormulas';
import { itemAIName } from '../../core/items/defs/ItemDefs';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { mobLabel } from './eventMapping';
import type { CrawlerKind } from '../../core/skills/SkillManager';
import type { TrackerEntry } from '../../systems/questTracker';
import type { KeyRingView } from '../../core/keys/KeyRing';
import type { CrawlerState, KeyState, NearbyMobState, QuestSummary, ThreatLevel } from './types';

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
    const name = itemAIName(slot.id);
    counts[name] = (counts[name] ?? 0) + slot.quantity;
  }
  return counts;
}

function equippedNames(player: Player): Record<string, string> {
  const equipped: Record<string, string> = {};
  for (const [slotKey, itemId] of player.inventory.equipment.entries()) {
    equipped[slotKey] = itemAIName(itemId);
  }
  return equipped;
}

/** The Journal's active quests as told to the AI, each by its name for the AI where it has one. */
export function readActiveQuests(entries: ReadonlyArray<TrackerEntry>): QuestSummary[] {
  return entries
    .filter((entry) => entry.status === 'active')
    .map((entry) => ({
      id: entry.id,
      name: entry.aiName ?? entry.name,
      objective: entry.objective,
    }));
}

/** The floor's keys as told to the AI: each by name, with the fragments held of it. */
export function readKeys(view: KeyRingView): KeyState[] {
  return view.keys.map((key) => ({
    name: key.def.name,
    fragmentsHeld: key.fragments.filter((piece) => piece.held).map((piece) => piece.fragment.name),
    fragmentsNeeded: key.needed,
    forged: key.forged,
  }));
}

export function readCrawler(player: Player, kind: CrawlerKind): CrawlerState {
  const tile = tileOf(player);
  return {
    kind,
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
