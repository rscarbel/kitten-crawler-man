import type { BossRoomCheckpoint } from '../systems/BossRoomSystem';
import {
  parseBossRoomDressingCheckpoint,
  type BossRoomDressingCheckpoint,
} from '../systems/bossRooms/bossRoomDressingCheckpoint';
import type { ArenaCheckpoint } from '../systems/ArenaSystem';
import type {
  TreasureChest,
  TreasureChestCheckpoint,
  TreasureChestProgressSnapshot,
} from '../systems/TreasureChestSystem';
import type { DefendQuestCheckpoint } from '../systems/DefendQuestSystem';
import type { MurderMysteryQuestCheckpoint } from '../systems/MurderMysteryQuestSystem';
import type { SpiderQuestCheckpoint } from '../systems/SpiderQuestSystem';
import type { CircusQuestCheckpoint } from '../systems/CircusQuestSystem';
import type { BountyCheckpoint } from '../systems/BountySystem';
import type { ClubMembershipCheckpoint } from './ClubMembership';
import {
  hirelingStartingHp,
  type HiredMercenary,
  type MercenaryRosterCheckpoint,
} from './MercenaryRoster';
import type { MongoPetStateCheckpoint } from './MongoPetState';
import type { TownMemoryCheckpoint } from './TownMemory';
import type { JournalProgressCheckpoint } from './JournalProgress';
import { TACTICS_TRAITS, type TacticsTrait } from '../creatures/tactics/tacticsTraits';
import type { MarketStockCheckpoint } from '../systems/market/MarketStock';
import type { CircusQuestProgressCheckpoint } from './CircusQuestProgress';
import type { AnchorQuestProgressCheckpoint } from './AnchorQuestProgress';
import type { MurderQuestProgressCheckpoint } from './MurderQuestProgress';
import type { BountyProgressCheckpoint } from './BountyProgress';
import type { LootDrop } from '../creatures/Mob';
import { ITEM_DEF, type ItemId } from './ItemDefs';
import type { QuestStatus } from './QuestManager';
import type { QuestMarkerType } from '../systems/MiniMapSystem';
import { SUITS, RANKS, type ShoeState } from '../systems/casino/Deck';
import type { WoodBarrier, PendingBuild } from '../systems/DefendQuestSystem';
import type { LifeMachine } from '../systems/SpiderQuestSystem';
import { allResidents } from '../systems/townResidents';
import { MERCENARY_TEMPLATE_IDS } from './mercenaryTemplates';
import { isRecord } from './guards';
import { parsePersistedDoomsday, type PersistedDoomsdayProgress } from './DoomsdayProgress';
import {
  debriefBossType,
  type DebriefMemory,
  type MordecaiDebriefCheckpoint,
} from '../systems/mordecaiDebrief';

/**
 * The subset of `WorldCheckpoint` that survives a page reload.
 *
 * It is loaded into a scene built from scratch, where no mob from the last
 * session exists, so every reference to a live creature is dropped. A fight in
 * progress resumes from its phase and flags, not from the creatures on screen.
 * Anything the seeds regenerate is left out, and so is damage to the world
 * itself: smashed props and felled trees stand again after a reload.
 */
export interface PersistedWorldState {
  bossRoom: BossRoomCheckpoint;
  arena: PersistedArenaCheckpoint;
  treasureChests: PersistedTreasureChestCheckpoint;
  defendQuest: PersistedDefendQuestCheckpoint;
  spiderQuest: PersistedSpiderQuestCheckpoint;
  circusQuest: PersistedCircusQuestCheckpoint;
  murderQuest: PersistedMurderMysteryQuestCheckpoint;

  bounty: PersistedBountyCheckpoint | null;

  circusQuestProgress: CircusQuestProgressCheckpoint;
  anchorQuestProgress: AnchorQuestProgressCheckpoint;
  murderQuestProgress: MurderQuestProgressCheckpoint;
  journal: JournalProgressCheckpoint;
  bountyProgress: BountyProgressCheckpoint;
  clubMembership: ClubMembershipCheckpoint;
  marketStock: PersistedMarketStockCheckpoint;
  townMemory: TownMemoryCheckpoint;
  mercenaryRoster: MercenaryRosterCheckpoint;
  mongoPetState: MongoPetStateCheckpoint;
  /** Optional: an older save costs one repeated congratulation, not a failed load. */
  mordecaiDebrief?: MordecaiDebriefCheckpoint;
  /**
   * Tactics traits the party has already been told enemies have learned,
   * for the whole run. Optional for the same reason `mordecaiDebrief` is: an older save
   * without it just costs a repeated System notice, not a failed load.
   */
  tacticsNoticesSeen?: readonly TacticsTrait[];
  /**
   * The doomsday finale's stage and the time left on its countdown. Optional:
   * a save without it loads as a finale that has not started.
   */
  doomsday?: PersistedDoomsdayProgress;
  /**
   * What each boss room's props and ground looked like. Optional: a save
   * without it loads every room as it was generated.
   */
  bossRoomDressing?: BossRoomDressingCheckpoint;

  krakarenKilled: boolean;
  krakarenBossRoomIdx: number;
  juicerKilled: boolean;
  juicerBossRoomIdx: number;
}

export type PersistedArenaCheckpoint = Omit<ArenaCheckpoint, 'arenaLiveTusklings'>;

export function toPersistedArenaCheckpoint(cp: ArenaCheckpoint): PersistedArenaCheckpoint {
  return {
    arenaLocked: cp.arenaLocked,
    arenaPhase2Active: cp.arenaPhase2Active,
    arenaStairwellUnlocked: cp.arenaStairwellUnlocked,
    entryWindowTimer: cp.entryWindowTimer,
    humanIsInsider: cp.humanIsInsider,
    catIsInsider: cp.catIsInsider,
  };
}

export function fromPersistedArenaCheckpoint(persisted: PersistedArenaCheckpoint): ArenaCheckpoint {
  return { ...persisted, arenaLiveTusklings: [] };
}

/** One chest's state, keyed by its tile rather than by the chest object. */
export type PersistedTreasureChestEntry = Omit<TreasureChestProgressSnapshot, 'chest'> & {
  readonly tileX: number;
  readonly tileY: number;
};

export interface PersistedTreasureChestCheckpoint {
  readonly chests: readonly PersistedTreasureChestEntry[];
}

export function toPersistedTreasureChestCheckpoint(
  cp: TreasureChestCheckpoint,
): PersistedTreasureChestCheckpoint {
  return {
    chests: cp.chests.map((entry) => ({
      tileX: entry.chest.tileX,
      tileY: entry.chest.tileY,
      state: entry.state,
      loot: entry.loot,
      unlockFrame: entry.unlockFrame,
      tryLockedTimer: entry.tryLockedTimer,
      hadMobs: entry.hadMobs,
    })),
  };
}

/**
 * Matches each saved entry to the chest the regenerated floor put on the same
 * tile. An entry with no chest there is dropped.
 */
export function fromPersistedTreasureChestCheckpoint(
  persisted: PersistedTreasureChestCheckpoint,
  liveChests: readonly TreasureChest[],
): TreasureChestCheckpoint {
  const chests: TreasureChestProgressSnapshot[] = [];
  const matched = new Set<TreasureChest>();
  for (const entry of persisted.chests) {
    const chest = liveChests.find((c) => c.tileX === entry.tileX && c.tileY === entry.tileY);
    if (chest === undefined) continue;
    matched.add(chest);
    chests.push({
      chest,
      state: entry.state,
      loot: entry.loot,
      unlockFrame: entry.unlockFrame,
      tryLockedTimer: entry.tryLockedTimer,
      hadMobs: entry.hadMobs,
    });
  }
  // `restoreCheckpoint` replaces the whole chest list, so a chest the save
  // does not know about has to be listed as it is or it disappears.
  for (const chest of liveChests) {
    if (matched.has(chest)) continue;
    chests.push({
      chest,
      state: chest.state,
      loot: chest.loot,
      unlockFrame: chest.unlockFrame,
      tryLockedTimer: chest.tryLockedTimer,
      hadMobs: chest.hadMobs,
    });
  }
  return { chests };
}

export type PersistedDefendQuestCheckpoint = Omit<DefendQuestCheckpoint, 'questMobs'>;

export function toPersistedDefendQuestCheckpoint(
  cp: DefendQuestCheckpoint,
): PersistedDefendQuestCheckpoint {
  return {
    questStatuses: cp.questStatuses,
    phase: cp.phase,
    approachTimer: cp.approachTimer,
    defenseTimer: cp.defenseTimer,
    spawnTimer: cp.spawnTimer,
    woodRespawnTimer: cp.woodRespawnTimer,
    woodPileAvailable: cp.woodPileAvailable,
    barriers: cp.barriers,
    pendingBuild: cp.pendingBuild,
    audienceAbsenceFrames: cp.audienceAbsenceFrames,
    encounterAborted: cp.encounterAborted,
    npcHp: cp.npcHp,
    npcMarkerType: cp.npcMarkerType,
  };
}

export function fromPersistedDefendQuestCheckpoint(
  persisted: PersistedDefendQuestCheckpoint,
): DefendQuestCheckpoint {
  return { ...persisted, questMobs: [] };
}

export type PersistedMurderMysteryQuestCheckpoint = Omit<
  MurderMysteryQuestCheckpoint,
  'swarm' | 'gumgum' | 'swarmSpawnGrace'
>;

export function toPersistedMurderMysteryQuestCheckpoint(
  cp: MurderMysteryQuestCheckpoint,
): PersistedMurderMysteryQuestCheckpoint {
  return {
    questStatuses: cp.questStatuses,
    phase: cp.phase,
    swarmCleared: cp.swarmCleared,
    swarmStarted: cp.swarmStarted,
    swarmDefeatedBaseline: cp.swarmDefeatedBaseline,
    swarmSpawnQueue: cp.swarmSpawnQueue,
  };
}

export function fromPersistedMurderMysteryQuestCheckpoint(
  persisted: PersistedMurderMysteryQuestCheckpoint,
): MurderMysteryQuestCheckpoint {
  return { ...persisted, swarm: [], swarmSpawnGrace: [], gumgum: null };
}

export type PersistedSpiderQuestCheckpoint = Omit<
  SpiderQuestCheckpoint,
  'grotesqueSpider' | 'smallSpiders'
>;

export function toPersistedSpiderQuestCheckpoint(
  cp: SpiderQuestCheckpoint,
): PersistedSpiderQuestCheckpoint {
  return {
    phase: cp.phase,
    spiderEggOpened: cp.spiderEggOpened,
    scientistDead: cp.scientistDead,
    hackingDone: cp.hackingDone,
    hackStarting: cp.hackStarting,
    hackStartTimer: cp.hackStartTimer,
    machineryForcedOff: cp.machineryForcedOff,
    playerLocked: cp.playerLocked,
    roomLocked: cp.roomLocked,
    fightAborted: cp.fightAborted,
    entryWindowTimer: cp.entryWindowTimer,
    humanIsInsider: cp.humanIsInsider,
    catIsInsider: cp.catIsInsider,
    lifeMachines: cp.lifeMachines,
    keyboardHero: cp.keyboardHero,
  };
}

export function fromPersistedSpiderQuestCheckpoint(
  persisted: PersistedSpiderQuestCheckpoint,
): SpiderQuestCheckpoint {
  return { ...persisted, grotesqueSpider: null, smallSpiders: [] };
}

export type PersistedCircusQuestCheckpoint = Omit<
  CircusQuestCheckpoint,
  'waveMobs' | 'signet' | 'heather'
>;

export function toPersistedCircusQuestCheckpoint(
  cp: CircusQuestCheckpoint,
): PersistedCircusQuestCheckpoint {
  return {
    questStatuses: cp.questStatuses,
    phase: cp.phase,
    waveIndex: cp.waveIndex,
  };
}

export function fromPersistedCircusQuestCheckpoint(
  persisted: PersistedCircusQuestCheckpoint,
): CircusQuestCheckpoint {
  return { ...persisted, waveMobs: [], signet: null, heather: null };
}

export type PersistedBountyCheckpoint = Omit<BountyCheckpoint, 'boss' | 'encounter' | 'shady'>;

export function toPersistedBountyCheckpoint(cp: BountyCheckpoint): PersistedBountyCheckpoint {
  return {
    aggroReleased: cp.aggroReleased,
    // A mark still at large has no mob to point at after a reload, so it is
    // re-staged the same way a pending respawn is.
    respawnPending: cp.respawnPending || cp.boss !== null,
    markers: cp.markers,
    collectPointWorld: cp.collectPointWorld,
  };
}

export function fromPersistedBountyCheckpoint(
  persisted: PersistedBountyCheckpoint,
): BountyCheckpoint {
  return { ...persisted, boss: null, encounter: [], shady: null };
}

export interface PersistedMarketStockCheckpoint {
  readonly remaining: ReadonlyArray<readonly [string, number]>;
}

export function toPersistedMarketStockCheckpoint(
  cp: MarketStockCheckpoint,
): PersistedMarketStockCheckpoint {
  return { remaining: [...cp.remaining] };
}

export function fromPersistedMarketStockCheckpoint(
  persisted: PersistedMarketStockCheckpoint,
): MarketStockCheckpoint {
  return { remaining: new Map(persisted.remaining) };
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every(isBoolean);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && value in ITEM_DEF;
}

function stringUnion<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.find((candidate) => candidate === value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!isUnknownArray(value)) return undefined;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

function parseStringKeyedTuple<T>(
  value: unknown,
  parseValue: (item: unknown) => T | undefined,
): readonly [string, T] | undefined {
  if (!isUnknownArray(value) || value.length !== 2) return undefined;
  const key = value[0];
  if (!isString(key)) return undefined;
  const parsedValue = parseValue(value[1]);
  if (parsedValue === undefined) return undefined;
  return [key, parsedValue];
}

export function parsePoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (!isNumber(x) || !isNumber(y)) return undefined;
  return { x, y };
}

function parseItemStack(value: unknown): { id: ItemId; quantity: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { id, quantity } = value;
  if (!isItemId(id) || !isNumber(quantity)) return undefined;
  return { id, quantity };
}

function parseLootDrop(value: unknown): LootDrop | undefined {
  if (!isRecord(value)) return undefined;
  const { coins, items, goldDoubled } = value;
  if (!isNumber(coins)) return undefined;
  const parsedItems = parseArray(items, parseItemStack);
  if (parsedItems === undefined) return undefined;
  if (goldDoubled !== undefined && !isBoolean(goldDoubled)) return undefined;
  return goldDoubled === undefined
    ? { coins, items: parsedItems }
    : { coins, items: parsedItems, goldDoubled };
}

function parseNullableLootDrop(value: unknown): LootDrop | null | undefined {
  return value === null ? null : parseLootDrop(value);
}

function parseQuestStatus(value: unknown): QuestStatus | undefined {
  return stringUnion(value, ['available', 'active', 'completed', 'failed'] as const);
}

function parseQuestStatuses(value: unknown): Array<[string, QuestStatus]> | undefined {
  return parseArray(value, (entry) => {
    const parsed = parseStringKeyedTuple(entry, parseQuestStatus);
    return parsed === undefined ? undefined : [parsed[0], parsed[1]];
  });
}

function parseDebriefMemory(value: unknown): DebriefMemory | undefined {
  if (!isRecord(value)) return undefined;
  const { congratulated, namedItemIds, boxCountsAtLastTalk } = value;
  if (!isBoolean(congratulated) || !isUnknownArray(namedItemIds)) return undefined;
  if (!isRecord(boxCountsAtLastTalk)) return undefined;
  const { human, cat } = boxCountsAtLastTalk;
  if (!isNumber(human) || !isNumber(cat)) return undefined;
  return {
    congratulated,
    namedItemIds: namedItemIds.filter(isItemId),
    boxCountsAtLastTalk: { human, cat },
  };
}

/** Lenient, unlike its neighbours: a bad entry only costs a repeated congratulation. */
function parseMordecaiDebriefCheckpoint(value: unknown): MordecaiDebriefCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const parsed: MordecaiDebriefCheckpoint = {};
  for (const [key, entry] of Object.entries(value)) {
    const bossType = debriefBossType(key);
    const memory = parseDebriefMemory(entry);
    if (bossType !== null && memory !== undefined) parsed[bossType] = memory;
  }
  return parsed;
}

/** Lenient, like its neighbour above: a bad entry only costs one repeated System notice. */
function parseTacticsNoticesSeen(value: unknown): readonly TacticsTrait[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: TacticsTrait[] = [];
  for (const entry of value) {
    const trait = stringUnion(entry, TACTICS_TRAITS);
    if (trait !== undefined) parsed.push(trait);
  }
  return parsed;
}

function parseBossRoomRoom(value: unknown): BossRoomCheckpoint['rooms'][number] | undefined {
  if (!isRecord(value)) return undefined;
  const { locked, defeated, defeatTimer, pulse, entryWindowTimer, fightAborted } = value;
  if (
    !isBoolean(locked) ||
    !isBoolean(defeated) ||
    !isNumber(defeatTimer) ||
    !isNumber(pulse) ||
    !isNumber(entryWindowTimer) ||
    !isBoolean(fightAborted)
  ) {
    return undefined;
  }
  return { locked, defeated, defeatTimer, pulse, entryWindowTimer, fightAborted };
}

function parseBossRoomCheckpoint(value: unknown): BossRoomCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    rooms,
    enteredRoomIndices,
    humanIsInsider,
    catIsInsider,
    unenteredRegenDelay,
    regenNoticeGiven,
  } = value;
  const parsedRooms = parseArray(rooms, parseBossRoomRoom);
  if (
    parsedRooms === undefined ||
    !isNumberArray(enteredRoomIndices) ||
    !isBooleanArray(humanIsInsider) ||
    !isBooleanArray(catIsInsider) ||
    !isNumberArray(unenteredRegenDelay) ||
    !isBooleanArray(regenNoticeGiven)
  ) {
    return undefined;
  }
  return {
    rooms: parsedRooms,
    enteredRoomIndices,
    humanIsInsider,
    catIsInsider,
    unenteredRegenDelay,
    regenNoticeGiven,
  };
}

function parsePersistedArenaCheckpoint(value: unknown): PersistedArenaCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    arenaLocked,
    arenaPhase2Active,
    arenaStairwellUnlocked,
    entryWindowTimer,
    humanIsInsider,
    catIsInsider,
  } = value;
  if (
    !isBoolean(arenaLocked) ||
    !isBoolean(arenaPhase2Active) ||
    !isBoolean(arenaStairwellUnlocked) ||
    !isNumber(entryWindowTimer) ||
    !isBoolean(humanIsInsider) ||
    !isBoolean(catIsInsider)
  ) {
    return undefined;
  }
  return {
    arenaLocked,
    arenaPhase2Active,
    arenaStairwellUnlocked,
    entryWindowTimer,
    humanIsInsider,
    catIsInsider,
  };
}

function parseTreasureChestState(value: unknown): PersistedTreasureChestEntry['state'] | undefined {
  return stringUnion(value, ['locked', 'unlocking', 'unlocked', 'opened'] as const);
}

function parsePersistedTreasureChestEntry(value: unknown): PersistedTreasureChestEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { tileX, tileY, state, loot, unlockFrame, tryLockedTimer, hadMobs } = value;
  const parsedState = parseTreasureChestState(state);
  const parsedLoot = parseNullableLootDrop(loot);
  if (
    !isNumber(tileX) ||
    !isNumber(tileY) ||
    parsedState === undefined ||
    parsedLoot === undefined ||
    !isNumber(unlockFrame) ||
    !isNumber(tryLockedTimer) ||
    !isBoolean(hadMobs)
  ) {
    return undefined;
  }
  return {
    tileX,
    tileY,
    state: parsedState,
    loot: parsedLoot,
    unlockFrame,
    tryLockedTimer,
    hadMobs,
  };
}

function parsePersistedTreasureChestCheckpoint(
  value: unknown,
): PersistedTreasureChestCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const chests = parseArray(value.chests, parsePersistedTreasureChestEntry);
  if (chests === undefined) return undefined;
  return { chests };
}

function parseWoodBarrier(value: unknown): WoodBarrier | undefined {
  if (!isRecord(value)) return undefined;
  const { tileX, tileY, worldX, worldY, hp, maxHp, grateIdx, hitFlash } = value;
  if (
    !isNumber(tileX) ||
    !isNumber(tileY) ||
    !isNumber(worldX) ||
    !isNumber(worldY) ||
    !isNumber(hp) ||
    !isNumber(maxHp) ||
    !isNumber(grateIdx) ||
    !isNumber(hitFlash)
  ) {
    return undefined;
  }
  return { tileX, tileY, worldX, worldY, hp, maxHp, grateIdx, hitFlash };
}

function parsePendingBuild(value: unknown): PendingBuild | undefined {
  if (!isRecord(value)) return undefined;
  const { framesLeft, totalFrames, grateIdx, isRepair, builder } = value;
  const parsedBuilder = stringUnion(builder, ['human', 'cat'] as const);
  if (
    !isNumber(framesLeft) ||
    !isNumber(totalFrames) ||
    !isNumber(grateIdx) ||
    !isBoolean(isRepair) ||
    parsedBuilder === undefined
  ) {
    return undefined;
  }
  return { framesLeft, totalFrames, grateIdx, isRepair, builder: parsedBuilder };
}

function parseNPCMarkerType(
  value: unknown,
): PersistedDefendQuestCheckpoint['npcMarkerType'] | undefined {
  return stringUnion(value, ['exclamation', 'question', 'none'] as const);
}

function parseDefendQuestPhase(
  value: unknown,
): PersistedDefendQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, [
    'inactive',
    'npc_waiting',
    'dialog',
    'tutorial',
    'countdown',
    'defending',
    'complete_pending',
    'complete',
    'failed',
  ] as const);
}

function parsePersistedDefendQuestCheckpoint(
  value: unknown,
): PersistedDefendQuestCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    questStatuses,
    phase,
    approachTimer,
    defenseTimer,
    spawnTimer,
    woodRespawnTimer,
    woodPileAvailable,
    barriers,
    pendingBuild,
    audienceAbsenceFrames,
    encounterAborted,
    npcHp,
    npcMarkerType,
  } = value;
  const parsedQuestStatuses = parseQuestStatuses(questStatuses);
  const parsedPhase = parseDefendQuestPhase(phase);
  const parsedBarriers = parseArray(barriers, parseWoodBarrier);
  const parsedPendingBuild = pendingBuild === null ? null : parsePendingBuild(pendingBuild);
  const parsedMarkerType = parseNPCMarkerType(npcMarkerType);
  if (
    parsedQuestStatuses === undefined ||
    parsedPhase === undefined ||
    !isNumber(approachTimer) ||
    !isNumber(defenseTimer) ||
    !isNumber(spawnTimer) ||
    !isNumber(woodRespawnTimer) ||
    !isBoolean(woodPileAvailable) ||
    parsedBarriers === undefined ||
    parsedPendingBuild === undefined ||
    !isNumber(audienceAbsenceFrames) ||
    !isBoolean(encounterAborted) ||
    !isNumber(npcHp) ||
    parsedMarkerType === undefined
  ) {
    return undefined;
  }
  return {
    questStatuses: parsedQuestStatuses,
    phase: parsedPhase,
    approachTimer,
    defenseTimer,
    spawnTimer,
    woodRespawnTimer,
    woodPileAvailable,
    barriers: parsedBarriers,
    pendingBuild: parsedPendingBuild,
    audienceAbsenceFrames,
    encounterAborted,
    npcHp,
    npcMarkerType: parsedMarkerType,
  };
}

function parseMurderQuestPhase(
  value: unknown,
): PersistedMurderMysteryQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, [
    'gumgum_waiting',
    'body_waiting',
    'investigation',
    'night_attack',
    'cult_hideout',
    'confrontation',
    'lich_confrontation',
    'awaiting_rewards',
    'complete',
  ] as const);
}

function parseSwarmOffset(
  value: unknown,
): PersistedMurderMysteryQuestCheckpoint['swarmSpawnQueue'][number] | undefined {
  if (!isRecord(value)) return undefined;
  const { dx, dy } = value;
  if (!isNumber(dx) || !isNumber(dy)) return undefined;
  return { dx, dy };
}

function parsePersistedMurderMysteryQuestCheckpoint(
  value: unknown,
): PersistedMurderMysteryQuestCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    questStatuses,
    phase,
    swarmCleared,
    swarmStarted,
    swarmDefeatedBaseline,
    swarmSpawnQueue,
  } = value;
  const parsedQuestStatuses = parseQuestStatuses(questStatuses);
  const parsedPhase = parseMurderQuestPhase(phase);
  const parsedSpawnQueue = parseArray(swarmSpawnQueue, parseSwarmOffset);
  if (
    parsedQuestStatuses === undefined ||
    parsedPhase === undefined ||
    !isBoolean(swarmCleared) ||
    !isBoolean(swarmStarted) ||
    !isNumber(swarmDefeatedBaseline) ||
    parsedSpawnQueue === undefined
  ) {
    return undefined;
  }
  return {
    questStatuses: parsedQuestStatuses,
    phase: parsedPhase,
    swarmCleared,
    swarmStarted,
    swarmDefeatedBaseline,
    swarmSpawnQueue: parsedSpawnQueue,
  };
}

function parseSpiderQuestPhase(
  value: unknown,
): PersistedSpiderQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, [
    'inactive',
    'scientist_waiting',
    'scientist_dialog',
    'awaiting_hacking',
    'hacking',
    'keyboard_hero_tutorial',
    'hacking_failed',
    'cutscene',
    'boss_fight',
    'complete',
  ] as const);
}

function parseLifeMachine(value: unknown): LifeMachine | undefined {
  if (!isRecord(value)) return undefined;
  const {
    tileX,
    tileY,
    state,
    stateElapsed,
    spiderlingReleased,
    lightAnimFrame,
    lightAnimTimer,
    poweringOnSoundPending,
  } = value;
  const parsedState = stringUnion(state, [
    'idle',
    'warming',
    'hot',
    'printing',
    'dispensing',
    'purging',
    'offline',
  ] as const);
  if (
    !isNumber(tileX) ||
    !isNumber(tileY) ||
    parsedState === undefined ||
    !isNumber(stateElapsed) ||
    !isBoolean(spiderlingReleased) ||
    !isNumber(lightAnimFrame) ||
    !isNumber(lightAnimTimer) ||
    !isBoolean(poweringOnSoundPending)
  ) {
    return undefined;
  }
  return {
    tileX,
    tileY,
    state: parsedState,
    stateElapsed,
    spiderlingReleased,
    lightAnimFrame,
    lightAnimTimer,
    poweringOnSoundPending,
  };
}

function parseKeyboardHeroCheckpoint(
  value: unknown,
): PersistedSpiderQuestCheckpoint['keyboardHero'] | undefined {
  if (!isRecord(value)) return undefined;
  const { hitCount, missCount, failed, completed, nextChartIndex } = value;
  if (
    !isNumber(hitCount) ||
    !isNumber(missCount) ||
    !isBoolean(failed) ||
    !isBoolean(completed) ||
    !isNumber(nextChartIndex)
  ) {
    return undefined;
  }
  return { hitCount, missCount, failed, completed, nextChartIndex };
}

function parsePersistedSpiderQuestCheckpoint(
  value: unknown,
): PersistedSpiderQuestCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    phase,
    spiderEggOpened,
    scientistDead,
    hackingDone,
    hackStarting,
    hackStartTimer,
    machineryForcedOff,
    playerLocked,
    roomLocked,
    fightAborted,
    entryWindowTimer,
    humanIsInsider,
    catIsInsider,
    lifeMachines,
    keyboardHero,
  } = value;
  const parsedPhase = parseSpiderQuestPhase(phase);
  const parsedLifeMachines = parseArray(lifeMachines, parseLifeMachine);
  const parsedKeyboardHero = parseKeyboardHeroCheckpoint(keyboardHero);
  if (
    parsedPhase === undefined ||
    !isBoolean(spiderEggOpened) ||
    !isBoolean(scientistDead) ||
    !isBoolean(hackingDone) ||
    !isBoolean(hackStarting) ||
    !isNumber(hackStartTimer) ||
    !isBoolean(machineryForcedOff) ||
    !isBoolean(playerLocked) ||
    !isBoolean(roomLocked) ||
    !isBoolean(fightAborted) ||
    !isNumber(entryWindowTimer) ||
    !isBoolean(humanIsInsider) ||
    !isBoolean(catIsInsider) ||
    parsedLifeMachines === undefined ||
    parsedKeyboardHero === undefined
  ) {
    return undefined;
  }
  return {
    phase: parsedPhase,
    spiderEggOpened,
    scientistDead,
    hackingDone,
    hackStarting,
    hackStartTimer,
    machineryForcedOff,
    playerLocked,
    roomLocked,
    fightAborted,
    entryWindowTimer,
    humanIsInsider,
    catIsInsider,
    lifeMachines: parsedLifeMachines,
    keyboardHero: parsedKeyboardHero,
  };
}

function parseCircusQuestPhase(
  value: unknown,
): PersistedCircusQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, [
    'awaiting_intro',
    'ritual_defense',
    'awaiting_ritual_failed',
    'heather_hunt',
    'awaiting_heather_return',
    'assault',
    'bigtop_ready',
    'awaiting_resolution',
    'complete',
  ] as const);
}

function parsePersistedCircusQuestCheckpoint(
  value: unknown,
): PersistedCircusQuestCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { questStatuses, phase, waveIndex } = value;
  const parsedQuestStatuses = parseQuestStatuses(questStatuses);
  const parsedPhase = parseCircusQuestPhase(phase);
  if (parsedQuestStatuses === undefined || parsedPhase === undefined || !isNumber(waveIndex)) {
    return undefined;
  }
  return { questStatuses: parsedQuestStatuses, phase: parsedPhase, waveIndex };
}

function parseQuestMarkerType(value: unknown): QuestMarkerType | undefined {
  return stringUnion(value, ['exclamation', 'question', 'red_x', 'elite'] as const);
}

function parseBountyMarker(
  value: unknown,
): PersistedBountyCheckpoint['markers'][number] | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, type } = value;
  const parsedType = parseQuestMarkerType(type);
  if (!isNumber(x) || !isNumber(y) || parsedType === undefined) return undefined;
  return { x, y, type: parsedType };
}

function parsePersistedBountyCheckpoint(value: unknown): PersistedBountyCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { aggroReleased, respawnPending, markers, collectPointWorld } = value;
  const parsedMarkers = parseArray(markers, parseBountyMarker);
  const parsedCollectPoint = collectPointWorld === null ? null : parsePoint(collectPointWorld);
  if (
    !isBoolean(aggroReleased) ||
    !isBoolean(respawnPending) ||
    parsedMarkers === undefined ||
    parsedCollectPoint === undefined
  ) {
    return undefined;
  }
  return {
    aggroReleased,
    respawnPending,
    markers: parsedMarkers,
    collectPointWorld: parsedCollectPoint,
  };
}

export function parsePersistedMarketStockCheckpoint(
  value: unknown,
): PersistedMarketStockCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const remaining = parseArray(value.remaining, (entry) =>
    parseStringKeyedTuple(entry, (v) => (isNumber(v) ? v : undefined)),
  );
  if (remaining === undefined) return undefined;
  return { remaining };
}

export function parseTownMemoryCheckpoint(value: unknown): TownMemoryCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { residentTalks, poulticesLeft, clearedRooms } = value;
  // Absent from a save written before camps were remembered; such a save
  // simply remembers none, rather than losing the whole world state over it.
  const clearedCamps = value.clearedCamps ?? [];
  const residentIds = allResidents().map((resident) => resident.id);
  const parsedTalks = parseArray(residentTalks, (entry) =>
    parseStringKeyedTuple(entry, (v) => (isNumber(v) ? v : undefined)),
  );
  if (
    parsedTalks === undefined ||
    !isNumber(poulticesLeft) ||
    !isStringArray(clearedRooms) ||
    !isStringArray(clearedCamps)
  ) {
    return undefined;
  }
  const validTalks: Array<[(typeof residentIds)[number], number]> = [];
  for (const [id, count] of parsedTalks) {
    const residentId = residentIds.find((candidate) => candidate === id);
    if (residentId === undefined) continue;
    validTalks.push([residentId, count]);
  }
  return { residentTalks: validTalks, poulticesLeft, clearedRooms, clearedCamps };
}

function parseJournalProgressCheckpoint(value: unknown): JournalProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { visitedGuideStops, pinnedTrackerId } = value;
  if (!isStringArray(visitedGuideStops)) return undefined;
  if (pinnedTrackerId !== null && !isString(pinnedTrackerId)) return undefined;
  return { visitedGuideStops, pinnedTrackerId };
}

function parseCard(
  value: unknown,
): { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number] } | undefined {
  if (!isRecord(value)) return undefined;
  const rank = stringUnion(value.rank, RANKS);
  const suit = stringUnion(value.suit, SUITS);
  if (rank === undefined || suit === undefined) return undefined;
  return { rank, suit };
}

function parseShoeState(value: unknown): ShoeState | undefined {
  if (!isRecord(value)) return undefined;
  const { cards, cursor } = value;
  const parsedCards = parseArray(cards, parseCard);
  if (parsedCards === undefined || !isNumber(cursor)) return undefined;
  return { cards: parsedCards, cursor };
}

function parseClubMembershipCheckpoint(value: unknown): ClubMembershipCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { hasDesperadoPass, casinoShoe, casinoHintsEnabled } = value;
  const parsedShoe = casinoShoe === null ? null : parseShoeState(casinoShoe);
  if (!isBoolean(hasDesperadoPass) || parsedShoe === undefined) return undefined;
  if (casinoHintsEnabled !== null && !isBoolean(casinoHintsEnabled)) return undefined;
  return { hasDesperadoPass, casinoShoe: parsedShoe, casinoHintsEnabled };
}

/**
 * A hire the save cannot account for — a template id that no longer exists, or
 * a record missing a field — drops the contract and nothing else. The roster is
 * the least important thing in a save, and rejecting the whole world state over
 * it would throw away every quest the player had progressed with it.
 */
function parseHiredMercenary(value: unknown): HiredMercenary | null {
  if (!isRecord(value)) return null;
  const { id, name, contractLevelId, introduced, hp } = value;
  const parsedId = stringUnion(id, MERCENARY_TEMPLATE_IDS);
  if (parsedId === undefined || !isString(name) || !isString(contractLevelId)) return null;
  if (!isBoolean(introduced)) return null;
  const hire: HiredMercenary = { id: parsedId, name, contractLevelId, introduced };
  // A missing or unreadable health is a hire at full health, not a lost hire.
  if (isNumber(hp)) hire.hp = hirelingStartingHp({ ...hire, hp });
  return hire;
}

export function parseMercenaryRosterCheckpoint(
  value: unknown,
): MercenaryRosterCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { active, lastDeceased } = value;
  const parsedDeceased = isString(lastDeceased) ? lastDeceased : null;
  return { active: parseHiredMercenary(active), lastDeceased: parsedDeceased };
}

function parseMongoPetStateCheckpoint(value: unknown): MongoPetStateCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { hp, regenFrames, scaledAgainstMaxHp, summonLocked, restingUntilFull } = value;
  if (
    !isNumber(hp) ||
    !isNumber(regenFrames) ||
    !isNumber(scaledAgainstMaxHp) ||
    !isBoolean(summonLocked) ||
    !isBoolean(restingUntilFull)
  ) {
    return undefined;
  }
  return { hp, regenFrames, scaledAgainstMaxHp, summonLocked, restingUntilFull };
}

function parseCircusQuestProgressCheckpoint(
  value: unknown,
): CircusQuestProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { stage, heatherSlain, mongoKidnapped, bigTopPotionGiven } = value;
  const parsedStage = stringUnion(stage, [
    'not_started',
    'ritual_defense',
    'heather_hunt',
    'assault',
    'bigtop_ready',
    'grimaldi_redeemed',
    'complete',
  ] as const);
  if (
    parsedStage === undefined ||
    !isBoolean(heatherSlain) ||
    !isBoolean(mongoKidnapped) ||
    !isBoolean(bigTopPotionGiven)
  ) {
    return undefined;
  }
  return { stage: parsedStage, heatherSlain, mongoKidnapped, bigTopPotionGiven };
}

function parseAnchorStepState(value: unknown): AnchorQuestProgressCheckpoint['tinker'] | undefined {
  return stringUnion(value, ['offered', 'in_progress', 'shard_owed', 'done'] as const);
}

function parseAnchorQuestProgressCheckpoint(
  value: unknown,
): AnchorQuestProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { status, tinker, hilda, temple, hildaRepairedTypes, templeVerminRemaining } = value;
  const parsedStatus = parseQuestStatus(status);
  const parsedTinker = parseAnchorStepState(tinker);
  const parsedHilda = parseAnchorStepState(hilda);
  const parsedTemple = parseAnchorStepState(temple);
  if (
    parsedStatus === undefined ||
    parsedTinker === undefined ||
    parsedHilda === undefined ||
    parsedTemple === undefined ||
    !isNumberArray(hildaRepairedTypes) ||
    !isNumber(templeVerminRemaining)
  ) {
    return undefined;
  }
  return {
    status: parsedStatus,
    tinker: parsedTinker,
    hilda: parsedHilda,
    temple: parsedTemple,
    hildaRepairedTypes,
    templeVerminRemaining,
  };
}

function parseMurderQuestProgressCheckpoint(
  value: unknown,
): MurderQuestProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    stage,
    wellClueFound,
    homeClueFound,
    roostClueFound,
    quillNamed,
    officeSceneSeen,
    evidenceOwed,
    swarmKrasueDefeated,
  } = value;
  const parsedStage = stringUnion(stage, [
    'not_started',
    'body_waiting',
    'investigation',
    'night_attack',
    'cult_hideout',
    'confrontation',
    'quill_slain',
    'lich_slain',
    'complete',
  ] as const);
  const parsedEvidence = parseArray(evidenceOwed, (item) => (isItemId(item) ? item : undefined));
  if (
    parsedStage === undefined ||
    !isBoolean(wellClueFound) ||
    !isBoolean(homeClueFound) ||
    !isBoolean(roostClueFound) ||
    !isBoolean(quillNamed) ||
    !isBoolean(officeSceneSeen) ||
    parsedEvidence === undefined ||
    !isNumber(swarmKrasueDefeated)
  ) {
    return undefined;
  }
  return {
    stage: parsedStage,
    wellClueFound,
    homeClueFound,
    roostClueFound,
    quillNamed,
    officeSceneSeen,
    evidenceOwed: parsedEvidence,
    swarmKrasueDefeated,
  };
}

function parseNamesByType(value: unknown): Record<string, string[] | undefined> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string[] | undefined> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) {
      out[key] = undefined;
      continue;
    }
    if (!isStringArray(raw)) return undefined;
    out[key] = raw;
  }
  return out;
}

function parseNameCursorByType(value: unknown): Record<string, number | undefined> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number | undefined> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) {
      out[key] = undefined;
      continue;
    }
    if (!isNumber(raw)) return undefined;
    out[key] = raw;
  }
  return out;
}

function parseBountyProgressCheckpoint(value: unknown): BountyProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    phase,
    typeOrder,
    cycleIndex,
    namesByType,
    nameCursorByType,
    currentTypeId,
    currentName,
    currentSiteIndex,
    lastSiteIndex,
    bountiesCompleted,
    pendingPayoutCoins,
  } = value;
  const parsedPhase = stringUnion(phase, ['available', 'active', 'kill_pending'] as const);
  const parsedNamesByType = parseNamesByType(namesByType);
  const parsedNameCursorByType = parseNameCursorByType(nameCursorByType);
  if (
    parsedPhase === undefined ||
    !isStringArray(typeOrder) ||
    !isNumber(cycleIndex) ||
    parsedNamesByType === undefined ||
    parsedNameCursorByType === undefined ||
    (currentTypeId !== null && !isString(currentTypeId)) ||
    (currentName !== null && !isString(currentName)) ||
    (currentSiteIndex !== null && !isNumber(currentSiteIndex)) ||
    (lastSiteIndex !== null && !isNumber(lastSiteIndex)) ||
    !isNumber(bountiesCompleted) ||
    !isNumber(pendingPayoutCoins)
  ) {
    return undefined;
  }
  return {
    phase: parsedPhase,
    typeOrder,
    cycleIndex,
    namesByType: parsedNamesByType,
    nameCursorByType: parsedNameCursorByType,
    currentTypeId,
    currentName,
    currentSiteIndex,
    lastSiteIndex,
    bountiesCompleted,
    pendingPayoutCoins,
  };
}

/**
 * Parses untrusted JSON from local storage or the server. Any part that does
 * not match rejects the whole state, rather than trusting half of it.
 */
export function parsePersistedWorldState(value: unknown): PersistedWorldState | undefined {
  if (!isRecord(value)) return undefined;
  const bossRoom = parseBossRoomCheckpoint(value.bossRoom);
  const arena = parsePersistedArenaCheckpoint(value.arena);
  const treasureChests = parsePersistedTreasureChestCheckpoint(value.treasureChests);
  const defendQuest = parsePersistedDefendQuestCheckpoint(value.defendQuest);
  const spiderQuest = parsePersistedSpiderQuestCheckpoint(value.spiderQuest);
  const circusQuest = parsePersistedCircusQuestCheckpoint(value.circusQuest);
  const murderQuest = parsePersistedMurderMysteryQuestCheckpoint(value.murderQuest);
  const bounty = value.bounty === null ? null : parsePersistedBountyCheckpoint(value.bounty);
  const circusQuestProgress = parseCircusQuestProgressCheckpoint(value.circusQuestProgress);
  const anchorQuestProgress = parseAnchorQuestProgressCheckpoint(value.anchorQuestProgress);
  const murderQuestProgress = parseMurderQuestProgressCheckpoint(value.murderQuestProgress);
  const journal = parseJournalProgressCheckpoint(value.journal);
  const bountyProgress = parseBountyProgressCheckpoint(value.bountyProgress);
  const clubMembership = parseClubMembershipCheckpoint(value.clubMembership);
  const marketStock = parsePersistedMarketStockCheckpoint(value.marketStock);
  const townMemory = parseTownMemoryCheckpoint(value.townMemory);
  const mercenaryRoster = parseMercenaryRosterCheckpoint(value.mercenaryRoster);
  const mongoPetState = parseMongoPetStateCheckpoint(value.mongoPetState);
  const mordecaiDebrief = parseMordecaiDebriefCheckpoint(value.mordecaiDebrief);
  const tacticsNoticesSeen = parseTacticsNoticesSeen(value.tacticsNoticesSeen);
  const doomsday = parsePersistedDoomsday(value.doomsday);
  const bossRoomDressing = parseBossRoomDressingCheckpoint(value.bossRoomDressing);
  const { krakarenKilled, krakarenBossRoomIdx, juicerKilled, juicerBossRoomIdx } = value;

  if (
    bossRoom === undefined ||
    arena === undefined ||
    treasureChests === undefined ||
    defendQuest === undefined ||
    spiderQuest === undefined ||
    circusQuest === undefined ||
    murderQuest === undefined ||
    bounty === undefined ||
    circusQuestProgress === undefined ||
    anchorQuestProgress === undefined ||
    murderQuestProgress === undefined ||
    journal === undefined ||
    bountyProgress === undefined ||
    clubMembership === undefined ||
    marketStock === undefined ||
    townMemory === undefined ||
    mercenaryRoster === undefined ||
    mongoPetState === undefined ||
    !isBoolean(krakarenKilled) ||
    !isNumber(krakarenBossRoomIdx) ||
    !isBoolean(juicerKilled) ||
    !isNumber(juicerBossRoomIdx)
  ) {
    return undefined;
  }

  return {
    bossRoom,
    arena,
    treasureChests,
    defendQuest,
    spiderQuest,
    circusQuest,
    murderQuest,
    bounty,
    circusQuestProgress,
    anchorQuestProgress,
    murderQuestProgress,
    journal,
    bountyProgress,
    clubMembership,
    marketStock,
    townMemory,
    mercenaryRoster,
    mongoPetState,
    mordecaiDebrief,
    tacticsNoticesSeen,
    doomsday,
    bossRoomDressing,
    krakarenKilled,
    krakarenBossRoomIdx,
    juicerKilled,
    juicerBossRoomIdx,
  };
}
