import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { ITEM_DEF, QUEST_SLOT_IDX } from '../core/ItemDefs';
import { ALL_STATS, type Player } from '../Player';
import { AbilityManager, isAbilityId, type AbilityId } from '../core/AbilityManager';
import { isSkillId, type SkillId, type SkillState } from '../core/SkillManager';
import { snapPlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { MAGIC_MISSILE_DEF } from '../abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from '../abilities/protectiveShell';
import { SMUSH_DEF } from '../abilities/smush';
import { MONGO_DEF } from '../abilities/mongo';
import { getLevelDef, type LevelDef } from '../levels/index';
import type { GameMap } from '../map/GameMap';
import type { MobSpawnRule } from '../levels/types';
import type { VillageBuildingId } from '../map/overworld/briarHollowLayout';
import type { TownBuildingName } from '../map/town/townPlan';
import type { PlaytestLoadout, PlaytestPreset, PlaytestSpawn } from './playtestPresets';

/**
 * Turns a {@link PlaytestPreset} into the scene inputs that describe it: two
 * player snapshots, an ability manager, and the floor to open.
 *
 * Loadouts are built by mutating throwaway crawlers rather than by hand-writing
 * snapshot JSON, so a preset inherits every derivation the real game does —
 * equipment stat bonuses, max HP from constitution, species stat floors.
 */
export interface PlaytestBoot {
  levelDef: LevelDef;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  abilityManager: AbilityManager;
  spawn: PlaytestSpawn;
  preDefeatedBossTypes: readonly MobSpawnRule['type'][];
  doomsdayStage: PlaytestPreset['doomsdayStage'];
}

/** Tile a preset's crawlers start on before the real spawn point is resolved. */
const SCRATCH_TILE = 0;

/**
 * Mongo's pet-ability level a level-3 preset starts at when it doesn't name
 * one of its own: high enough that a floor-3 playtest sees his grown stats
 * and sheet rather than the early-game pet, without hand-editing every preset.
 */
const LEVEL3_DEFAULT_MONGO_LEVEL = 10;

function skillStatesFor(levels: Partial<Record<SkillId, number>>): SkillState[] {
  const states: SkillState[] = [];
  for (const [id, level] of Object.entries(levels)) {
    if (!isSkillId(id)) continue;
    states.push({ id, level, usesTowardNext: 0 });
  }
  return states;
}

function applyLoadout(player: Player, loadout: PlaytestLoadout): void {
  player.inventory.bag.slots.fill(null);
  player.inventory.actionBar.slots.fill(null);
  player.inventory.equipment.clear();

  loadout.hotbar.forEach((stack, slotIdx) => {
    player.inventory.actionBar.slots[slotIdx] = { ...ITEM_DEF[stack.id], quantity: stack.quantity };
  });
  loadout.bag.forEach((stack, slotIdx) => {
    player.inventory.bag.slots[slotIdx] = { ...ITEM_DEF[stack.id], quantity: stack.quantity };
  });
  if (loadout.questSlot !== undefined) {
    const { id, quantity } = loadout.questSlot;
    player.inventory.actionBar.slots[QUEST_SLOT_IDX] = { ...ITEM_DEF[id], quantity };
  }
  for (const stack of [...loadout.hotbar, ...loadout.bag]) {
    if (stack.equipped === true) player.inventory.equipment.equipById(stack.id);
  }

  // Equipment first: stat getters — and therefore max HP — read from it.
  player.onEquipmentChanged();
  for (const stat of ALL_STATS) {
    const value = loadout.baseStats[stat];
    if (value !== undefined) player.setBaseStat(stat, value);
  }

  player.level = loadout.level;
  player.xp = Math.round(loadout.xpProgress * player.xpNeededForNextLevel);
  player.coins = loadout.coins;
  player.unspentPoints = 0;
  player.skills.restoreStates(skillStatesFor(loadout.skillLevels));
  if (loadout.resourcingLevel !== undefined) {
    const crafts = player.craftSkills.snapshot();
    player.craftSkills.restore({
      ...crafts,
      resourcing: { learned: true, level: loadout.resourcingLevel, xp: 0 },
    });
  }
  if (loadout.constructionLevel !== undefined) {
    player.craftSkills.restore({
      ...player.craftSkills.snapshot(),
      construction: { learned: true, level: loadout.constructionLevel, xp: 0 },
    });
  }

  player.syncHpToMaxHp();
  player.hp = player.maxHp;
}

function humanSnapshotFor(preset: PlaytestPreset): PlayerSnapshot {
  const human = new HumanPlayer(SCRATCH_TILE, SCRATCH_TILE, TILE_SIZE);
  applyLoadout(human, preset.human);
  const { explosivesHandling } = preset.human;
  if (explosivesHandling !== undefined) human.explosivesHandling = explosivesHandling;
  // Both crawlers snapshot their own `isActive`, so leaving these at the
  // constructor's default would restore a party with nobody driving.
  human.isActive = true;
  return snapPlayer(human);
}

function catSnapshotFor(preset: PlaytestPreset): PlayerSnapshot {
  const cat = new CatPlayer(SCRATCH_TILE, SCRATCH_TILE, TILE_SIZE);
  applyLoadout(cat, preset.cat);
  cat.isActive = false;
  return snapPlayer(cat);
}

function abilityManagerFor(levels: Partial<Record<AbilityId, number>>): AbilityManager {
  const manager = new AbilityManager();
  manager.register(MAGIC_MISSILE_DEF);
  manager.register(PROTECTIVE_SHELL_DEF);
  manager.register(SMUSH_DEF);
  manager.register(MONGO_DEF);
  for (const [id, level] of Object.entries(levels)) {
    if (!isAbilityId(id)) continue;
    manager.setLevel(id, level);
  }
  return manager;
}

export function buildPlaytestBoot(preset: PlaytestPreset): PlaytestBoot {
  const abilityManager = abilityManagerFor(preset.abilityLevels);
  if (preset.levelId === 'level3' && preset.abilityLevels.mongo === undefined) {
    abilityManager.setLevel('mongo', LEVEL3_DEFAULT_MONGO_LEVEL);
  }
  return {
    levelDef: getLevelDef(preset.levelId),
    humanSnap: humanSnapshotFor(preset),
    catSnap: catSnapshotFor(preset),
    abilityManager,
    spawn: preset.spawn,
    preDefeatedBossTypes: preset.preDefeatedBossTypes ?? [],
    doomsdayStage: preset.doomsdayStage,
  };
}

/** Tiles between the spider lab's doorway and the corridor tile outside it. */
const LAB_DOORWAY_STEP_TILES = 1;
/** How far inside its own doorway the nursery preset stands the party. */
const QUEST_DOORWAY_STEP_TILES = 2;

/**
 * The corridor tile just outside the spider lab, so the preset opens on the
 * scientist's door rather than inside the room with the egg.
 *
 * The generator records which tile the corridor broke through but not which wall
 * it broke through, so the outward direction is re-derived from which edge of the
 * room's bounds the doorway sits on.
 */
function spiderLabApproachTile(gameMap: GameMap): { x: number; y: number } | null {
  const lab = gameMap.spiderLabRoom;
  if (lab === null) return null;

  const { bounds, entranceTile } = lab;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;

  let outwardX = 0;
  let outwardY = 0;
  if (entranceTile.y === bounds.y) outwardY = -LAB_DOORWAY_STEP_TILES;
  else if (entranceTile.y === lastY) outwardY = LAB_DOORWAY_STEP_TILES;
  else if (entranceTile.x === bounds.x) outwardX = -LAB_DOORWAY_STEP_TILES;
  else if (entranceTile.x === lastX) outwardX = LAB_DOORWAY_STEP_TILES;

  const outside = { x: entranceTile.x + outwardX, y: entranceTile.y + outwardY };
  return gameMap.isWalkable(outside.x, outside.y) ? outside : entranceTile;
}

/**
 * A tile just inside the quest room's own doorway, or null on a floor with no
 * quest room.
 *
 * Inside rather than outside, unlike the lab's approach tile: the lab is a room
 * you decide whether to enter, so the interesting view is from the corridor,
 * while the nursery is a room the route runs through and what has to be seen is
 * the goblin mother and the grates around her.
 */
function questRoomApproachTile(gameMap: GameMap): { x: number; y: number } | null {
  if (gameMap.questRooms.length === 0) return null;
  const { bounds, entranceTile } = gameMap.questRooms[0];
  const inwardX =
    entranceTile.x === bounds.x
      ? QUEST_DOORWAY_STEP_TILES
      : entranceTile.x === bounds.x + bounds.w - 1
        ? -QUEST_DOORWAY_STEP_TILES
        : 0;
  const inwardY =
    entranceTile.y === bounds.y
      ? QUEST_DOORWAY_STEP_TILES
      : entranceTile.y === bounds.y + bounds.h - 1
        ? -QUEST_DOORWAY_STEP_TILES
        : 0;
  const inside = { x: entranceTile.x + inwardX, y: entranceTile.y + inwardY };
  return gameMap.isWalkable(inside.x, inside.y) ? inside : entranceTile;
}

/** How far inside its own doorway the bathroom preset stands the party. */
const BATHROOM_DOORWAY_STEP_TILES = 1;

/**
 * A tile just inside the first bathroom's way in, or null on a floor with none.
 * One step in rather than the nursery's two: the line keeps clear of the
 * entrance by only a couple of tiles, and the party should land on open floor.
 */
function bathroomApproachTile(gameMap: GameMap): { x: number; y: number } | null {
  if (gameMap.bathroomRooms.length === 0) return null;
  const { bounds, entranceTile } = gameMap.bathroomRooms[0];
  const inwardX =
    entranceTile.x === bounds.x
      ? BATHROOM_DOORWAY_STEP_TILES
      : entranceTile.x === bounds.x + bounds.w - 1
        ? -BATHROOM_DOORWAY_STEP_TILES
        : 0;
  const inwardY =
    entranceTile.y === bounds.y
      ? BATHROOM_DOORWAY_STEP_TILES
      : entranceTile.y === bounds.y + bounds.h - 1
        ? -BATHROOM_DOORWAY_STEP_TILES
        : 0;
  const inside = { x: entranceTile.x + inwardX, y: entranceTile.y + inwardY };
  return gameMap.isWalkable(inside.x, inside.y) ? inside : entranceTile;
}

/**
 * A tile the gate guard is talked to from, so the preset opens face to face
 * with him; the room's centre when none of them is open.
 */
function stealthGateGuardFront(gameMap: GameMap): { x: number; y: number } | null {
  const room = gameMap.stealthGateRoom;
  if (room === null) return null;
  const talkTile = room.guardTalkTiles.find((tile) => gameMap.isWalkable(tile.x, tile.y));
  return talkTile === undefined ? room.centre : { x: talkTile.x, y: talkTile.y };
}

/** Rows south of a town door the party stands, clear of the door itself so arriving never walks in. */
const TOWN_DOORSTEP_ROWS_SOUTH = 1;

function townBuildingDoorstep(
  gameMap: GameMap,
  buildingName: TownBuildingName,
): { x: number; y: number } | null {
  const entry = gameMap.buildingEntries.find((candidate) => candidate.name === buildingName);
  if (entry === undefined) return null;
  const doorstep = { x: entry.doorTile.x, y: entry.doorTile.y + TOWN_DOORSTEP_ROWS_SOUTH };
  return gameMap.isWalkable(doorstep.x, doorstep.y) ? doorstep : null;
}

function briarHollowThreshold(
  gameMap: GameMap,
  buildingId: VillageBuildingId,
): { x: number; y: number } | null {
  const building = gameMap.briarHollow?.buildings.find((candidate) => candidate.id === buildingId);
  const threshold = building?.doorways.find((tile) => gameMap.isWalkable(tile.x, tile.y));
  return threshold === undefined ? null : { x: threshold.x, y: threshold.y };
}

const PLAYTEST_FLOOD_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/** Whether `tile` can be walked to from the floor's start, stepping only where `walkable` allows. */
function reachableFromStart(
  gameMap: GameMap,
  tile: { x: number; y: number },
  walkable: (x: number, y: number) => boolean,
): boolean {
  const width = gameMap.structure[0]?.length ?? 0;
  const keyOf = (x: number, y: number): number => y * width + x;
  const start = gameMap.startTile;
  if (!walkable(start.x, start.y)) return false;
  const seen = new Set<number>([keyOf(start.x, start.y)]);
  const queue = [start];
  // The iterator re-reads `length`, so tiles pushed below are visited by this loop.
  for (const current of queue) {
    if (current.x === tile.x && current.y === tile.y) return true;
    for (const step of PLAYTEST_FLOOD_STEPS) {
      const x = current.x + step.dx;
      const y = current.y + step.dy;
      if (seen.has(keyOf(x, y)) || !walkable(x, y)) continue;
      seen.add(keyOf(x, y));
      queue.push({ x, y });
    }
  }
  return false;
}

/**
 * The tile a preset's spawn names, or null when this map has no such landmark —
 * in which case the caller falls back to the floor's own start tile.
 */
export function resolvePlaytestSpawn(
  spawn: PlaytestSpawn,
  gameMap: GameMap,
): { x: number; y: number } | null {
  return resolveSpawnLandmark(spawn, gameMap);
}

/**
 * Whether a preset drops the party past the clogged bathrooms: then the floor
 * starts with them solved, or the way back to the start would be shut behind a
 * queue the party never met. Asked of the map as generated, plumbing broken.
 */
export function playtestStartsPastBathroom(spawn: PlaytestSpawn, gameMap: GameMap): boolean {
  if (gameMap.bathroomRooms.length === 0) return false;
  const tile = resolveSpawnLandmark(spawn, gameMap);
  return tile !== null && !reachableFromStart(gameMap, tile, (x, y) => gameMap.isWalkable(x, y));
}

/**
 * Whether a preset drops the party past floor 2's stealth gate: then the floor
 * starts with the gate open and the quest `opened`, or the way back would be
 * shut behind a gate whose guard the party never met. Asked of the map as
 * generated, gate locked; the bathrooms are ignored, since a start past them
 * is answered by {@link playtestStartsPastBathroom}.
 */
export function playtestStartsPastStealthGate(spawn: PlaytestSpawn, gameMap: GameMap): boolean {
  if (gameMap.stealthGateRoom === null) return false;
  const tile = resolveSpawnLandmark(spawn, gameMap);
  return (
    tile !== null &&
    !reachableFromStart(gameMap, tile, (x, y) => gameMap.isWalkableIgnoringBathroomQueue(x, y))
  );
}

function resolveSpawnLandmark(
  spawn: PlaytestSpawn,
  gameMap: GameMap,
): { x: number; y: number } | null {
  switch (spawn.kind) {
    case 'mapStart':
      return null;
    case 'safeRoomBefore':
      return gameMap.safeRoomGuarding(spawn.bossType)?.centre ?? null;
    case 'spiderLabEntrance':
      return spiderLabApproachTile(gameMap);
    case 'questRoomEntrance':
      return questRoomApproachTile(gameMap);
    case 'bathroomEntrance':
      return bathroomApproachTile(gameMap);
    case 'stealthGateRoom':
      return stealthGateGuardFront(gameMap);
    case 'briarHollowGate':
      return gameMap.briarHollow?.gate.inside ?? null;
    case 'townBuildingDoor':
      return townBuildingDoorstep(gameMap, spawn.buildingName);
    case 'briarHollowBuilding':
      return briarHollowThreshold(gameMap, spawn.buildingId);
  }
}
