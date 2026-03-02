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

/** Pick a mob type from a weighted rule list. Weights need not sum to 1. */
function pickType(rules: MobSpawnRule[]): string {
  const total = rules.reduce((sum, r) => sum + r.chance, 0);
  let roll = Math.random() * total;
  for (const rule of rules) {
    roll -= rule.chance;
    if (roll <= 0) return rule.type;
  }
  return rules[rules.length - 1].type;
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

  for (const { x, y } of map.mobSpawnPoints) {
    mobs.push(createMob(pickType(def.roomMobs), x, y, map));
  }

  for (const { x, y } of map.hallwaySpawnPoints) {
    mobs.push(createMob(pickType(def.hallwayMobs), x, y, map));
  }

  // Spawn boss in the boss room (rooms[2])
  if (def.bossRoom && map.bossRoomCentre) {
    mobs.push(
      createMob(
        def.bossRoom.type,
        map.bossRoomCentre.x,
        map.bossRoomCentre.y,
        map,
      ),
    );
  }

  return mobs;
}
