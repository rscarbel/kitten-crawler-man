import { type GameMap } from '../map/GameMap';
import { type Mob } from '../creatures/Mob';
import type { TreasureRoomData } from '../map/DungeonGenerator';
import { Goblin } from '../creatures/Goblin';
import { Llama } from '../creatures/Llama';
import { Rat } from '../creatures/Rat';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import { Juicer } from '../creatures/Juicer';
import { Troglodyte } from '../creatures/Troglodyte';
import { Tuskling } from '../creatures/Tuskling';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { SkyFowl } from '../creatures/SkyFowl';
import { KrakarenClone } from '../creatures/KrakarenClone';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { Bugaboo } from '../creatures/Bugaboo';
import { GrotesqueSpider } from '../creatures/GrotesqueSpider';
import { SmallSpider } from '../creatures/SmallSpider';
import { RuinsGhoul } from '../creatures/RuinsGhoul';
import { Krasue } from '../creatures/Krasue';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { MoldLion } from '../creatures/MoldLion';
import { TerrorTheClown } from '../creatures/TerrorTheClown';
import { RingmasterGrimaldi } from '../creatures/RingmasterGrimaldi';
import { randomFromArray, randomInt } from '../utils';
import { TILE_SIZE } from '../core/constants';
import type { MobSpawnRule, LevelDef } from './types';

type GoblinVariant = { weapon: 'club' | 'hammer'; skin: string; eye: string };

/** Maximum attempts to find a walkable spawn position. */
const MAX_SPAWN_ATTEMPTS = 20;

/** Extra mobs spawned in treasure rooms for difficulty. */
const TREASURE_ROOM_EXTRA_MOBS = 3;

/** Treasure room mob level boost. */
const TREASURE_ROOM_LEVEL_BOOST = 1;

/** Maximum mob level cap. */
const MAX_MOB_LEVEL = 20;

/** Room boundary inset (1 tile from wall). */
const ROOM_BOUNDARY_INSET = 1;

/** Room max bounds offset. */
const ROOM_BOUNDS_OFFSET = 3;

export const GOBLIN_VARIANTS: GoblinVariant[] = [
  { weapon: 'club', skin: '#3d6b32', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#4f8a3e', eye: '#fbbf24' },
  { weapon: 'club', skin: '#7ab86a', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#3d6b32', eye: '#fbbf24' },
];

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

/** Roll a random mob level from a spawn rule's min/max range. */
function rollMobLevel(rule: MobSpawnRule): number {
  const min = rule.minLevel ?? 1;
  const max = rule.maxLevel ?? min;
  return randomInt(min, max);
}

type MobFactory = (tileX: number, tileY: number) => Mob;

const MOB_REGISTRY = new Map<string, MobFactory>();

/** Register a mob type so it can be spawned by name. */
export function registerMob(type: string, factory: MobFactory): void {
  MOB_REGISTRY.set(type, factory);
}

registerMob('llama', (x, y) => new Llama(x, y, TILE_SIZE));
registerMob('rat', (x, y) => new Rat(x, y, TILE_SIZE));
registerMob('the_hoarder', (x, y) => new TheHoarder(x, y, TILE_SIZE));
registerMob('cockroach', (x, y) => new Cockroach(x, y, TILE_SIZE));
registerMob('juicer', (x, y) => new Juicer(x, y, TILE_SIZE));
registerMob('troglodyte', (x, y) => new Troglodyte(x, y, TILE_SIZE));
registerMob('tuskling', (x, y) => new Tuskling(x, y, TILE_SIZE));
registerMob('sky_fowl', (x, y) => new SkyFowl(x, y, TILE_SIZE));
registerMob('ball_of_swine', (x, y) => new BallOfSwine(x, y, TILE_SIZE));
registerMob('krakaren_clone', (x, y) => new KrakarenClone(x, y, TILE_SIZE));
registerMob('brindle_grub', (x, y) => new BrindleGrub(x, y, TILE_SIZE));
registerMob('bugaboo', (x, y) => new Bugaboo(x, y, TILE_SIZE));
registerMob('grotesque_spider', (x, y) => new GrotesqueSpider(x, y, TILE_SIZE));
registerMob('small_spider', (x, y) => new SmallSpider(x, y, TILE_SIZE));
registerMob('ruins_ghoul', (x, y) => new RuinsGhoul(x, y, TILE_SIZE));
registerMob('krasue', (x, y) => new Krasue(x, y, TILE_SIZE));
registerMob('circus_lemur', (x, y) => new CircusLemur(x, y, TILE_SIZE));
registerMob('stilt_clown', (x, y) => new StiltClown(x, y, TILE_SIZE));
registerMob('fat_clown', (x, y) => new FatClown(x, y, TILE_SIZE));
registerMob('mold_lion', (x, y) => new MoldLion(x, y, TILE_SIZE));
registerMob('terror_the_clown', (x, y) => new TerrorTheClown(x, y, TILE_SIZE));
registerMob('ringmaster_grimaldi', (x, y) => new RingmasterGrimaldi(x, y, TILE_SIZE));
registerMob('goblin', (x, y) => {
  const v = randomFromArray(GOBLIN_VARIANTS);
  return new Goblin(x, y, TILE_SIZE, v.weapon, v.skin, v.eye);
});

export function createMob(type: string, tileX: number, tileY: number, map: GameMap): Mob {
  const factory = MOB_REGISTRY.get(type) ?? MOB_REGISTRY.get('goblin');
  if (!factory) throw new Error(`Unknown mob type: ${type}`);
  const mob = factory(tileX, tileY);
  mob.setMap(map);
  return mob;
}

/** Resolve an ExtraSpawnRule origin string to a tile coordinate, or null if the landmark doesn't exist. */
function resolveOrigin(
  origin: string,
  map: GameMap,
  def: LevelDef,
): { x: number; y: number } | null {
  if (origin === 'mapCenter') {
    const half = Math.floor(def.mapSize / 2);
    return { x: half, y: half };
  }
  const bossMatch = /^bossRoom:(\d+)$/.exec(origin);
  if (bossMatch) {
    const idx = parseInt(bossMatch[1], 10);
    if (idx < 0 || idx >= map.bossRooms.length) return null;
    return map.bossRooms[idx].centre;
  }
  const arenaMatch = /^arena:(\d+)$/.exec(origin);
  if (arenaMatch) {
    const idx = parseInt(arenaMatch[1], 10);
    if (idx < 0 || idx >= map.arenaExteriors.length) return null;
    return map.arenaExteriors[idx].centre;
  }
  return null;
}

/**
 * Post-spawn setup callbacks for mobs that need special initialization
 * beyond what `createMob` provides (e.g. BallOfSwine needs arena binding).
 */
const SPAWN_SETUP: Partial<
  Record<string, (mob: Mob, map: GameMap, origin: { x: number; y: number }) => void>
> = {
  setupBallOfSwine(mob, map, origin) {
    if (mob instanceof BallOfSwine) {
      mob.setArena(origin.x, origin.y);
      mob.setMap(map);
    }
  },
};

/**
 * Spawn mobs described by `def.extraSpawns` — position-relative spawns
 * that are tied to map landmarks rather than generic spawn points.
 */
export function spawnExtraMobs(def: LevelDef, map: GameMap): Mob[] {
  const mobs: Mob[] = [];
  if (!def.extraSpawns) return mobs;

  for (const rule of def.extraSpawns) {
    const origin = resolveOrigin(rule.origin, map, def);
    if (!origin) continue;

    for (const [dx, dy] of rule.offsets) {
      const mob = createMob(rule.type, origin.x + dx, origin.y + dy, map);
      if (rule.setup) {
        SPAWN_SETUP[rule.setup]?.(mob, map, origin);
      }
      mobs.push(mob);
    }
  }

  return mobs;
}

/**
 * Instantiate all mobs for a level. Room spawn points draw from
 * `def.roomMobs`; hallway points draw from `def.hallwayMobs`.
 * If `def.bossRoom` is set and the map has a boss room centre, spawns the boss there.
 */
export function spawnForLevel(def: LevelDef, map: GameMap): Mob[] {
  const mobs: Mob[] = [];

  if (def.roomMobs.length > 0) {
    for (const { x, y, w, h } of map.mobSpawnPoints) {
      const rule = pickRule(def.roomMobs);
      const min = rule.minCount ?? 1;
      const max = rule.maxCount ?? 1;
      const count = randomInt(min, max);
      // Interior tile range: 1-tile inset from walls on each side
      const minTX = x - Math.floor(w / 2) + ROOM_BOUNDARY_INSET;
      const minTY = y - Math.floor(h / 2) + ROOM_BOUNDARY_INSET;
      const maxTX = minTX + w - ROOM_BOUNDS_OFFSET;
      const maxTY = minTY + h - ROOM_BOUNDS_OFFSET;
      for (let i = 0; i < count; i++) {
        let tx = x;
        let ty = y;
        for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
          const cx = randomInt(minTX, maxTX);
          const cy = randomInt(minTY, maxTY);
          if (map.isWalkable(cx, cy)) {
            tx = cx;
            ty = cy;
            break;
          }
        }
        const mob = createMob(rule.type, tx, ty, map);
        mob.applyMobLevel(rollMobLevel(rule));
        mobs.push(mob);
      }
    }
  }

  if (def.hallwayMobs.length > 0) {
    for (const { x, y } of map.hallwaySpawnPoints) {
      const rule = pickRule(def.hallwayMobs);
      const mob = createMob(rule.type, x, y, map);
      mob.applyMobLevel(rollMobLevel(rule));
      mobs.push(mob);
    }
  }

  const bossRooms = def.bossRooms ?? [];
  for (let i = 0; i < bossRooms.length; i++) {
    const bossEntry = bossRooms[i];
    if (i >= map.bossRooms.length) continue;
    const brData = map.bossRooms[i];
    mobs.push(createMob(bossEntry.type, brData.centre.x, brData.centre.y, map));
  }

  return mobs;
}

/**
 * Spawn extra mobs for rooms that contain a treasure chest.
 * These rooms have slightly more enemies (3 extra) at a higher level to make the chest feel earned.
 */
export function spawnTreasureRoomMobs(
  treasureRooms: TreasureRoomData[],
  def: LevelDef,
  map: GameMap,
): Mob[] {
  const mobs: Mob[] = [];
  if (def.roomMobs.length === 0) return mobs;

  for (const room of treasureRooms) {
    const { x, y, w, h } = room.bounds;
    const minTX = x + ROOM_BOUNDARY_INSET;
    const minTY = y + ROOM_BOUNDARY_INSET;
    const maxTX = x + w - 2;
    const maxTY = y + h - 2;

    for (let i = 0; i < TREASURE_ROOM_EXTRA_MOBS; i++) {
      const rule = pickRule(def.roomMobs);
      let tx = room.centre.x;
      let ty = room.centre.y;
      for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const cx = randomInt(minTX, maxTX);
        const cy = randomInt(minTY, maxTY);
        if (map.isWalkable(cx, cy)) {
          tx = cx;
          ty = cy;
          break;
        }
      }
      const mob = createMob(rule.type, tx, ty, map);
      const maxLevel = rule.maxLevel ?? rule.minLevel ?? 1;
      mob.applyMobLevel(Math.min(maxLevel + TREASURE_ROOM_LEVEL_BOOST, MAX_MOB_LEVEL));
      mobs.push(mob);
    }
  }

  return mobs;
}
