import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { ITEM_DEF } from '../core/ItemDefs';
import { ALL_STATS, type Player } from '../Player';
import { AbilityManager, isAbilityId, type AbilityId } from '../core/AbilityManager';
import { isSkillId, type SkillId, type SkillState } from '../core/SkillManager';
import { snapPlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { MAGIC_MISSILE_DEF } from '../abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from '../abilities/protectiveShell';
import { SMUSH_DEF } from '../abilities/smush';
import { getLevelDef, type LevelDef } from '../levels/index';
import type { GameMap } from '../map/GameMap';
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
}

/** Tile a preset's crawlers start on before the real spawn point is resolved. */
const SCRATCH_TILE = 0;

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
  player.xp = loadout.xp;
  player.coins = loadout.coins;
  player.unspentPoints = 0;
  player.skills.restoreStates(skillStatesFor(loadout.skillLevels));

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
  for (const [id, level] of Object.entries(levels)) {
    if (!isAbilityId(id)) continue;
    manager.setLevel(id, level);
  }
  return manager;
}

export function buildPlaytestBoot(preset: PlaytestPreset): PlaytestBoot {
  return {
    levelDef: getLevelDef(preset.levelId),
    humanSnap: humanSnapshotFor(preset),
    catSnap: catSnapshotFor(preset),
    abilityManager: abilityManagerFor(preset.abilityLevels),
    spawn: preset.spawn,
  };
}

/** Tiles between the spider lab's doorway and the corridor tile outside it. */
const LAB_DOORWAY_STEP_TILES = 1;

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
 * The tile a preset's spawn names, or null when this map has no such landmark —
 * in which case the caller falls back to the floor's own start tile.
 */
export function resolvePlaytestSpawn(
  spawn: PlaytestSpawn,
  gameMap: GameMap,
): { x: number; y: number } | null {
  switch (spawn.kind) {
    case 'mapStart':
      return null;
    case 'safeRoomBefore':
      return (
        gameMap.safeRooms.find((room) => room.guardsBossType === spawn.bossType)?.centre ?? null
      );
    case 'spiderLabEntrance':
      return spiderLabApproachTile(gameMap);
  }
}
