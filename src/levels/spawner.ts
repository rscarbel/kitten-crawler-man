import { GameMap } from '../map/GameMap';
import { Mob } from '../creatures/Mob';
import { Goblin } from '../creatures/Goblin';
import { Llama } from '../creatures/Llama';
import { Rat } from '../creatures/Rat';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import { TILE_SIZE } from '../core/constants';
import type { MobSpawnRule, LevelDef } from './types';

// ── Goblin variant data (moved from game.ts) ──────────────────────────────────

type GoblinVariant = { weapon: 'club' | 'hammer'; skin: string; eye: string };

export const GOBLIN_VARIANTS: GoblinVariant[] = [
  { weapon: 'club', skin: '#3d6b32', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#4f8a3e', eye: '#fbbf24' },
  { weapon: 'club', skin: '#7ab86a', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#3d6b32', eye: '#fbbf24' },
];

// ── Weighted random selection ─────────────────────────────────────────────────

/** Pick a rule from a weighted list. Weights need not sum to 1. */
function pickRule(rules: MobSpawnRule[]): MobSpawnRule {
  const total = rules.reduce((sum, r) => sum + r.chance, 0);
  let roll = Math.random() * total;
  for (const rule of rules) {
    roll -= rule.chance;
    if (roll <= 0) return rule;
  }
  return rules[rules.length - 1];
}

// ── Mob factory ───────────────────────────────────────────────────────────────

export function createMob(
  type: string,
  tileX: number,
  tileY: number,
  map: GameMap,
): Mob {
  let mob: Mob;
  if (type === 'llama') {
    mob = new Llama(tileX, tileY, TILE_SIZE);
  } else if (type === 'rat') {
    mob = new Rat(tileX, tileY, TILE_SIZE);
  } else if (type === 'the_hoarder') {
    mob = new TheHoarder(tileX, tileY, TILE_SIZE);
  } else if (type === 'cockroach') {
    mob = new Cockroach(tileX, tileY, TILE_SIZE);
  } else {
    // default: goblin
    const v =
      GOBLIN_VARIANTS[Math.floor(Math.random() * GOBLIN_VARIANTS.length)];
    mob = new Goblin(tileX, tileY, TILE_SIZE, v.weapon, v.skin, v.eye);
  }
  mob.setMap(map);
  return mob;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Instantiate all mobs for a level. Room spawn points draw from
 * `def.roomMobs`; hallway points draw from `def.hallwayMobs`.
 * If `def.bossRoom` is set and the map has a boss room centre, spawns the boss there.
 */
export function spawnForLevel(def: LevelDef, map: GameMap): Mob[] {
  const mobs: Mob[] = [];

  if (def.roomMobs.length > 0) {
    for (const { x, y } of map.mobSpawnPoints) {
      const rule = pickRule(def.roomMobs);
      const min = rule.minCount ?? 1;
      const max = rule.maxCount ?? 1;
      const count = min + Math.floor(Math.random() * (max - min + 1));
      for (let i = 0; i < count; i++) {
        mobs.push(createMob(rule.type, x, y, map));
      }
    }
  }

  if (def.hallwayMobs.length > 0) {
    for (const { x, y } of map.hallwaySpawnPoints) {
      const rule = pickRule(def.hallwayMobs);
      mobs.push(createMob(rule.type, x, y, map));
    }
  }

  // Spawn one boss per boss room
  for (let i = 0; i < (def.bossRooms?.length ?? 0); i++) {
    const bossEntry = def.bossRooms![i];
    const brData = map.bossRooms[i];
    if (brData) {
      mobs.push(
        createMob(bossEntry.type, brData.centre.x, brData.centre.y, map),
      );
    }
  }

  return mobs;
}
