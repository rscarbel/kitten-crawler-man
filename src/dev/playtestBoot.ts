import { ABILITY_DEFS } from '../abilities/abilityDefs';
import { TILE_SIZE } from '../core/constants';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { ITEM_DEF, QUEST_SLOT_IDX } from '../core/items/defs/ItemDefs';
import { type Player } from '../Player';
import { ALL_STATS } from '../core/party/stats';
import { AbilityManager, isAbilityId, type AbilityId } from '../core/skills/AbilityManager';
import { isSkillId, type SkillId, type SkillState } from '../core/skills/SkillManager';
import { snapPlayer } from '../core/save/PlayerSnapshot';
import type { PlayerSnapshot } from '../core/save/playerSnapshotFormat';
import { getLevelDef, type LevelDef } from '../levels/index';
import type { GameMap } from '../map/GameMap';
import type { GauntletBossType } from '../map/bossRoomSizes';
import type { TownBuildingId, BriarHollowBuildingId, STORM_DRAIN_ID } from '../map/buildingIds';
import type { AchievementManager } from '../core/progression/AchievementManager';
import type { StoryDirector } from '../story/StoryDirector';
import type { DaveDebriefCheckpoint } from '../systems/daveDebrief';
import type { PlaytestLoadout, PlaytestPreset, PlaytestSpawn } from './playtestPresets';
import { RUN_PROGRESS } from './playtestProgress';
import { debriefsHeard, playRunHistory } from './playtestRunHistory';

/** Deinonychus not yet earned, earned but waiting on a summon, or already out. */
export type PlaytestDeinonychus = 'locked' | 'unlocked' | 'out';

/**
 * Turns a {@link PlaytestPreset} into the scene inputs that describe it: two
 * player snapshots, an ability manager, the floor to open, and the run behind
 * it — achievements, story heard, bosses down, Dave's debriefs and the gear
 * the run paid out (see `playtestRunHistory.ts`).
 *
 * Loadouts are built by mutating throwaway crawlers rather than by hand-writing
 * snapshot JSON, so a preset inherits every derivation the real game does —
 * equipment stat bonuses, max HP from health, species stat floors.
 */
export interface PlaytestBoot {
  levelDef: LevelDef;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  abilityManager: AbilityManager;
  spawn: PlaytestSpawn;
  preDefeatedBossTypes: readonly GauntletBossType[];
  spiderQuestAwaitingHacking: boolean;
  deinonychus: PlaytestDeinonychus;
  humanAchievements: AchievementManager;
  catAchievements: AchievementManager;
  storyDirector: StoryDirector;
  daveDebrief: DaveDebriefCheckpoint;
}

/** Tile a preset's crawlers start on before the real spawn point is resolved. */
const SCRATCH_TILE = 0;

/**
 * Deinonychus's pet-ability level a level-3 preset starts at when it doesn't name
 * one of its own: high enough that a floor-3 playtest sees his grown stats
 * and sheet rather than the early-game pet, without hand-editing every preset.
 */
const LEVEL3_DEFAULT_DEINONYCHUS_LEVEL = 10;

function skillStatesFor(levels: Partial<Record<SkillId, number>>): SkillState[] {
  const states: SkillState[] = [];
  for (const [id, level] of Object.entries(levels)) {
    if (!isSkillId(id)) continue;
    states.push({ id, level, usesTowardNext: 0 });
  }
  return states;
}

/** Hotbar, bag, quest slot and worn pieces, before the run's history pays its gear on top. */
function placeLoadoutItems(player: Player, loadout: PlaytestLoadout): void {
  if (loadout.hotbar.length > QUEST_SLOT_IDX) {
    throw new Error('a playtest hotbar reaches the reserved quest slot');
  }
  player.inventory.actionBar.slots.fill(null);
  player.inventory.equipment.clear();

  loadout.hotbar.forEach((stack, slotIdx) => {
    player.inventory.actionBar.slots[slotIdx] = { ...ITEM_DEF[stack.id], quantity: stack.quantity };
  });
  player.inventory.bag.replaceAll(
    loadout.bag.map((stack) => ({ ...ITEM_DEF[stack.id], quantity: stack.quantity })),
  );
  if (loadout.questSlot !== undefined) {
    const { id, quantity } = loadout.questSlot;
    player.inventory.actionBar.slots[QUEST_SLOT_IDX] = { ...ITEM_DEF[id], quantity };
  }
  for (const stack of [...loadout.hotbar, ...loadout.bag]) {
    if (stack.equipped === true) player.inventory.equipment.equipById(stack.id);
  }
}

/** Stats, level, skills and a full health bar, once every worn piece is on. */
function settleLoadoutStats(player: Player, loadout: PlaytestLoadout): void {
  // Equipment first: stat getters — and therefore max HP — read from it.
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

function abilityManagerFor(levels: Partial<Record<AbilityId, number>>): AbilityManager {
  const manager = new AbilityManager();
  for (const def of Object.values(ABILITY_DEFS)) manager.register(def);
  for (const [id, level] of Object.entries(levels)) {
    if (!isAbilityId(id)) continue;
    manager.setLevel(id, level);
  }
  return manager;
}

function deinonychusFor(preset: PlaytestPreset, earned: boolean): PlaytestDeinonychus {
  if (preset.deinonychusOut === true) return 'out';
  return earned ? 'unlocked' : 'locked';
}

export function buildPlaytestBoot(preset: PlaytestPreset): PlaytestBoot {
  const progress = RUN_PROGRESS[preset.progress];
  const levelDef = getLevelDef(progress.levelId);
  const abilityManager = abilityManagerFor(preset.abilityLevels);
  if (progress.levelId === 'level3' && preset.abilityLevels.deinonychus === undefined) {
    abilityManager.setLevel('deinonychus', LEVEL3_DEFAULT_DEINONYCHUS_LEVEL);
  }

  const human = new HumanPlayer(SCRATCH_TILE, SCRATCH_TILE, TILE_SIZE);
  const cat = new CatPlayer(SCRATCH_TILE, SCRATCH_TILE, TILE_SIZE);
  const party = { human, cat };
  placeLoadoutItems(human, preset.human);
  placeLoadoutItems(cat, preset.cat);
  const history = playRunHistory(preset, progress, party);
  settleLoadoutStats(human, preset.human);
  settleLoadoutStats(cat, preset.cat);
  // Both crawlers snapshot their own `isActive`, so leaving these at the
  // constructor's default would restore a party with nobody driving.
  human.isActive = true;
  cat.isActive = false;

  const floorBossTypes = levelDef.bossRooms?.map((room) => room.type) ?? [];
  const preDefeatedBossTypes = progress.bossesDefeated.filter((boss) =>
    floorBossTypes.some((type) => type === boss),
  );
  return {
    levelDef,
    humanSnap: snapPlayer(human),
    catSnap: snapPlayer(cat),
    abilityManager,
    spawn: preset.spawn,
    preDefeatedBossTypes,
    spiderQuestAwaitingHacking: preset.spiderQuestAwaitingHacking ?? false,
    deinonychus: deinonychusFor(preset, history.deinonychusEarned),
    humanAchievements: history.humanAchievements,
    catAchievements: history.catAchievements,
    storyDirector: history.storyDirector,
    daveDebrief: debriefsHeard(preDefeatedBossTypes, party),
  };
}

/** How far inside its own doorway the nursery preset stands the party. */
const QUEST_DOORWAY_STEP_TILES = 2;

/**
 * The open floor tile nearest the middle of the spider lab's field station, or
 * null on a floor with no lab. Nearest rather than the middle itself, because
 * the station's cot or barricade may stand there.
 */
function spiderLabStationTile(gameMap: GameMap): { x: number; y: number } | null {
  const lab = gameMap.spiderLabRoom;
  if (lab === null) return null;
  const { stationBounds } = lab;
  const middle = {
    x: stationBounds.x + Math.floor(stationBounds.w / 2),
    y: stationBounds.y + Math.floor(stationBounds.h / 2),
  };
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let y = stationBounds.y; y < stationBounds.y + stationBounds.h; y++) {
    for (let x = stationBounds.x; x < stationBounds.x + stationBounds.w; x++) {
      if (!gameMap.isWalkable(x, y, 'walker')) continue;
      const distance = Math.hypot(x - middle.x, y - middle.y);
      if (distance >= bestDistance) continue;
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best ?? middle;
}

/** How far short of the lab hallway's mouth the hallway preset stands the party, in tiles. */
const SPIDER_HALLWAY_STANDOFF_TILES = 4;

/**
 * A tile in the host room a few steps back from the lab hallway's mouth, along
 * the way Dr. Moult faces at his post, so the preset opens with him and the
 * opening both in view and the call-out still to come.
 */
function spiderHallwayHostTile(gameMap: GameMap): { x: number; y: number } | null {
  const lab = gameMap.spiderLabRoom;
  if (lab === null) return null;
  const { hallwayMouthTile, hallwayPostFacing, hostBounds } = lab;
  for (let standoff = SPIDER_HALLWAY_STANDOFF_TILES; standoff > 0; standoff--) {
    const x = hallwayMouthTile.x + hallwayPostFacing.x * standoff;
    const y = hallwayMouthTile.y + hallwayPostFacing.y * standoff;
    const insideHost =
      x >= hostBounds.x &&
      y >= hostBounds.y &&
      x < hostBounds.x + hostBounds.w &&
      y < hostBounds.y + hostBounds.h;
    if (insideHost && gameMap.isWalkable(x, y, 'walker')) return { x, y };
  }
  return hallwayMouthTile;
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
  return gameMap.isWalkable(inside.x, inside.y, 'walker') ? inside : entranceTile;
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
  return gameMap.isWalkable(inside.x, inside.y, 'walker') ? inside : entranceTile;
}

/**
 * A tile the gate guard is talked to from, so the preset opens face to face
 * with him; the room's centre when none of them is open.
 */
function stealthGateGuardFront(gameMap: GameMap): { x: number; y: number } | null {
  const room = gameMap.stealthGateRoom;
  if (room === null) return null;
  const talkTile = room.guardTalkTiles.find((tile) => gameMap.isWalkable(tile.x, tile.y, 'walker'));
  return talkTile === undefined ? room.centre : { x: talkTile.x, y: talkTile.y };
}

/** Rows south of a town door the party stands, clear of the door itself so arriving never walks in. */
const TOWN_DOORSTEP_ROWS_SOUTH = 1;

function townBuildingDoorstep(
  gameMap: GameMap,
  buildingId: TownBuildingId | typeof STORM_DRAIN_ID,
): { x: number; y: number } | null {
  const entry = gameMap.buildingEntries.find((candidate) => candidate.id === buildingId);
  if (entry === undefined) return null;
  const doorstep = { x: entry.doorTile.x, y: entry.doorTile.y + TOWN_DOORSTEP_ROWS_SOUTH };
  return gameMap.isWalkable(doorstep.x, doorstep.y, 'walker') ? doorstep : null;
}

function briarHollowThreshold(
  gameMap: GameMap,
  buildingId: BriarHollowBuildingId,
): { x: number; y: number } | null {
  const building = gameMap.briarHollow?.buildings.find((candidate) => candidate.id === buildingId);
  const threshold = building?.doorways.find((tile) => gameMap.isWalkable(tile.x, tile.y, 'walker'));
  return threshold === undefined ? null : { x: threshold.x, y: threshold.y };
}

/**
 * How far outside the stairwell's own footprint the approach spawn stands the
 * party: far enough that the descend prompt waits for a step onto the stairs.
 */
const STAIRWELL_APPROACH_STANDOFF_TILES = 2;
/** The widest ring searched around a stairwell for ground that is not the stairs. */
const STAIRWELL_APPROACH_MAX_RING = 12;

/** Walkable, off the stairs and inside `roomIndex` (any room when it is `-1`). */
function isApproachTile(gameMap: GameMap, x: number, y: number, roomIndex: number): boolean {
  if (!gameMap.isWalkable(x, y, 'walker') || gameMap.isStairwellTile(x, y)) return false;
  return roomIndex === -1 || gameMap.roomIndexAt(x, y) === roomIndex;
}

/** The first approach tile on the Chebyshev ring `ring` around `centre`, in scan order. */
function approachTileOnRing(
  gameMap: GameMap,
  centre: { x: number; y: number },
  ring: number,
  roomIndex: number,
): { x: number; y: number } | null {
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = centre.x + dx;
      const y = centre.y + dy;
      if (isApproachTile(gameMap, x, y, roomIndex)) return { x, y };
    }
  }
  return null;
}

function stairwellApproachTile(gameMap: GameMap): { x: number; y: number } | null {
  const stairwell = gameMap.stairwellTiles.length > 0 ? gameMap.stairwellTiles[0] : null;
  if (stairwell === null) return null;
  const roomIndex = gameMap.roomIndexAt(stairwell.x, stairwell.y);
  for (let ring = 1; ring <= STAIRWELL_APPROACH_MAX_RING; ring++) {
    const edge = approachTileOnRing(gameMap, stairwell, ring, roomIndex);
    if (edge === null) continue;
    const standoffRing = ring + STAIRWELL_APPROACH_STANDOFF_TILES;
    return approachTileOnRing(gameMap, stairwell, standoffRing, roomIndex) ?? edge;
  }
  return null;
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
  return (
    tile !== null &&
    !reachableFromStart(gameMap, tile, (x, y) => gameMap.isWalkable(x, y, 'walker'))
  );
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
    !reachableFromStart(gameMap, tile, (x, y) =>
      gameMap.isWalkableIgnoringBathroomQueue(x, y, 'walker'),
    )
  );
}

/**
 * Whether a preset drops the party past the floor's nursery: the route as built
 * runs through it, so a party standing beyond it walked through, and the floor
 * starts with the goblin mother's wave already held. Standing inside the
 * nursery itself is not past it.
 */
export function playtestStartsPastNursery(spawn: PlaytestSpawn, gameMap: GameMap): boolean {
  if (gameMap.questRooms.length === 0) return false;
  const tile = resolveSpawnLandmark(spawn, gameMap);
  if (tile === null) return false;
  const { bounds } = gameMap.questRooms[0];
  const insideNursery = (x: number, y: number): boolean =>
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
  if (insideNursery(tile.x, tile.y)) return false;
  return !reachableFromStart(
    gameMap,
    tile,
    (x, y) => !insideNursery(x, y) && gameMap.isWalkableIgnoringPuzzleChokes(x, y, 'walker'),
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
    case 'spiderLabStation':
      return spiderLabStationTile(gameMap);
    case 'spiderHallwayHost':
      return spiderHallwayHostTile(gameMap);
    case 'stairwellApproach':
      return stairwellApproachTile(gameMap);
    case 'questRoomEntrance':
      return questRoomApproachTile(gameMap);
    case 'bathroomEntrance':
      return bathroomApproachTile(gameMap);
    case 'stealthGateRoom':
      return stealthGateGuardFront(gameMap);
    case 'briarHollowGate':
      return gameMap.briarHollow?.gate.inside ?? null;
    case 'townBuildingDoor':
      return townBuildingDoorstep(gameMap, spawn.buildingId);
    case 'briarHollowBuilding':
      return briarHollowThreshold(gameMap, spawn.buildingId);
  }
}
