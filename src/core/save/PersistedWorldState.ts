import type { BossRoomCheckpoint } from '../../systems/BossRoomSystem';
import {
  parseBossRoomDressingCheckpoint,
  type BossRoomDressingCheckpoint,
} from '../../systems/bossRooms/bossRoomDressingCheckpoint';
import type {
  ChestLockProgress,
  TreasureChestProgressSnapshot,
} from '../../systems/TreasureChestSystem';
import type { DefendQuestCheckpoint } from '../../systems/DefendQuestSystem';
import {
  parseCloggedBathroomCheckpoint,
  type CloggedBathroomCheckpoint,
} from '../../systems/cloggedBathroom/cloggedBathroomCheckpoint';
import {
  parseStealthKeySnatchCheckpoint,
  type StealthKeySnatchCheckpoint,
} from '../../systems/stealthKeySnatch/stealthKeySnatchCheckpoint';
import type { SpiderQuestCheckpoint } from '../../systems/SpiderQuestSystem';
import type { BountyCheckpoint } from '../../systems/BountySystem';
import type { CasinoStateCheckpoint, PokerReads } from '../club/CasinoState';
import type { PlayerRead } from '../../systems/casino/poker/npc/playerRead';
import { isRegularId } from '../../systems/casino/poker/npc/regularIds';
import { normalizeJackpotPool } from '../../systems/casino/slots/slotBets';
import {
  MERCENARY_CONTRACT_TERMS,
  type HireContract,
  type HiredMercenary,
  type MercenaryRosterCheckpoint,
} from '../party/MercenaryRoster';
import { isLevelId } from '../../levels/levelIds';
import type { DeinonychusPetStateCheckpoint } from '../state/DeinonychusPetState';
import {
  VISITED_PLACE_IDS,
  isInteriorPropPayoutKey,
  type TownMemoryCheckpoint,
} from '../state/TownMemory';
import type { JournalProgressCheckpoint } from '../quests/JournalProgress';
import { SEWER_WORK_IDS } from '../../map/sewer/sewerLayouts';
import { TACTICS_TRAITS, type TacticsTrait } from '../../creatures/tactics/tacticsTraits';
import { parseShopStockSnapshot, type ShopStockSnapshot } from '../../economy/shopStock';
import type { StarlightTentProgressCheckpoint } from '../state/StarlightTentProgress';
import type { AnchorQuestProgressCheckpoint } from '../quests/AnchorQuestProgress';
import {
  parseMissingCatsProgressCheckpoint,
  type MissingCatsProgressCheckpoint,
} from '../quests/missingCatsProgress';
import type { BountyProgressCheckpoint } from '../quests/BountyProgress';
import type { LootDrop } from '../../creatures/Mob';
import { isItemId, type ItemId } from '../items/defs/ItemDefs';
import type { QuestStatus } from '../quests/QuestManager';
import type { QuestMarkerType } from '../../systems/MiniMapSystem';
import { SUITS, RANKS, type ShoeState } from '../../systems/casino/Deck';
import type { WoodBarrier, PendingBuild } from '../../systems/DefendQuestSystem';
import type { LifeMachine } from '../../systems/SpiderQuestSystem';
import { RESIDENT_IDS } from '../state/residentIds';
import { MERCENARY_TEMPLATE_IDS } from '../party/mercenaryTemplates';
import { isRecord } from '../util/guards';
import { type DebriefMemory, type DaveDebriefCheckpoint } from '../../systems/daveDebrief';
import { debriefBossType } from '../mobs/debriefBossTypes';
import {
  parseBriarHollowStateSnapshot,
  type BriarHollowStateSnapshot,
} from '../quests/briarHollowState';
import { parsePartySplitSnapshot, type PartySplitSnapshot } from '../party/partySplit';
import { parseKeyRingState, type KeyRingState } from '../keys/keyRingState';

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
  treasureChests: PersistedTreasureChestCheckpoint;
  defendQuest: PersistedDefendQuestCheckpoint;
  spiderQuest: PersistedSpiderQuestCheckpoint;

  bounty: PersistedBountyCheckpoint | null;

  starlightTentProgress: StarlightTentProgressCheckpoint;
  anchorQuestProgress: AnchorQuestProgressCheckpoint;
  missingCatsProgress: MissingCatsProgressCheckpoint;
  journal: JournalProgressCheckpoint;
  bountyProgress: BountyProgressCheckpoint;
  casinoState: CasinoStateCheckpoint;
  shopStock: ShopStockSnapshot;
  townMemory: TownMemoryCheckpoint;
  mercenaryRoster: MercenaryRosterCheckpoint;
  deinonychusPetState: DeinonychusPetStateCheckpoint;
  daveDebrief: DaveDebriefCheckpoint;
  /** Tactics traits the party has already been told enemies have learned, for the whole run. */
  tacticsNoticesSeen: readonly TacticsTrait[];
  /** What each boss room's props and ground looked like. */
  bossRoomDressing: BossRoomDressingCheckpoint;
  /**
   * Briar Hollow's quest, structures and soldier orders. Written on every
   * floor, because the village state is threaded through the whole run.
   */
  briarHollow: BriarHollowStateSnapshot;
  /** The clogged bathroom's quest and whether its explainer was seen. */
  cloggedBathroom: CloggedBathroomCheckpoint;
  /** The stealth gate's key quest and whether the prison's explainer was seen. */
  stealthKeySnatch: StealthKeySnatchCheckpoint;
  /** A split party survives a reload: its groups, where each stands, and what they left each other. */
  partySplit: PartySplitSnapshot;
  /** The floor's key fragments, forged keys and opened seals. */
  keyRing: KeyRingState;

  krakenKilled: boolean;
  bigRoosterKilled: boolean;
  bigRoosterBossRoomIdx: number;
}

/** One chest's state, keyed by its tile rather than by the chest object. */
export type PersistedTreasureChestEntry = Omit<TreasureChestProgressSnapshot, 'chest'> & {
  readonly tileX: number;
  readonly tileY: number;
};

export interface PersistedTreasureChestCheckpoint {
  readonly chests: readonly PersistedTreasureChestEntry[];
}

export type PersistedDefendQuestCheckpoint = Omit<DefendQuestCheckpoint, 'questMobs'>;

export type PersistedSpiderQuestCheckpoint = Omit<
  SpiderQuestCheckpoint,
  'grotesqueSpider' | 'smallSpiders'
>;

export type PersistedBountyCheckpoint = Omit<BountyCheckpoint, 'boss' | 'encounter' | 'shady'>;

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

function isItemIdValue(value: unknown): value is ItemId {
  return typeof value === 'string' && isItemId(value);
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
  if (!isItemIdValue(id) || !isNumber(quantity)) return undefined;
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
  const { congratulated, keyNoted, namedItemIds } = value;
  const parsedItemIds = parseArray(namedItemIds, (item) =>
    isItemIdValue(item) ? item : undefined,
  );
  if (!isBoolean(congratulated) || !isBoolean(keyNoted) || parsedItemIds === undefined) {
    return undefined;
  }
  return { congratulated, keyNoted, namedItemIds: parsedItemIds };
}

function parseDaveDebriefCheckpoint(value: unknown): DaveDebriefCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const parsed: DaveDebriefCheckpoint = {};
  for (const [key, entry] of Object.entries(value)) {
    const bossType = debriefBossType(key);
    const memory = parseDebriefMemory(entry);
    if (bossType === null || memory === undefined) return undefined;
    parsed[bossType] = memory;
  }
  return parsed;
}

function parseTacticsNoticesSeen(value: unknown): readonly TacticsTrait[] | undefined {
  return parseArray(value, (entry) => stringUnion(entry, TACTICS_TRAITS));
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

function parseTreasureChestState(value: unknown): PersistedTreasureChestEntry['state'] | undefined {
  return stringUnion(value, ['locked', 'unlocking', 'unlocked', 'opened'] as const);
}

function parseChestLockProgress(value: unknown): ChestLockProgress | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, hadMobs } = value;
  switch (kind) {
    case 'guards':
      return isBoolean(hadMobs) ? { kind: 'guards', hadMobs } : undefined;
    case 'boss':
      return { kind: 'boss' };
    case 'none':
      return { kind: 'none' };
    default:
      return undefined;
  }
}

function parsePersistedTreasureChestEntry(value: unknown): PersistedTreasureChestEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { tileX, tileY, state, loot, unlockFrame, tryLockedTimer, lock } = value;
  const parsedState = parseTreasureChestState(state);
  const parsedLoot = parseNullableLootDrop(loot);
  const parsedLock = parseChestLockProgress(lock);
  if (
    !isNumber(tileX) ||
    !isNumber(tileY) ||
    parsedState === undefined ||
    parsedLoot === undefined ||
    !isNumber(unlockFrame) ||
    !isNumber(tryLockedTimer) ||
    parsedLock === undefined
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
    lock: parsedLock,
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
  const barrier: WoodBarrier = { tileX, tileY, worldX, worldY, hp, maxHp, grateIdx, hitFlash };
  const { spikesHp, spikesBy } = value;
  if (spikesHp === undefined && spikesBy === undefined) return barrier;
  const parsedSpikesBy = stringUnion(spikesBy, ['human', 'cat'] as const);
  if (!isNumber(spikesHp) || spikesHp <= 0 || parsedSpikesBy === undefined) return undefined;
  barrier.spikesHp = spikesHp;
  barrier.spikesBy = parsedSpikesBy;
  return barrier;
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

/** Every defense-quest phase, in the order the encounter reaches them; `failed` ends it. */
export const DEFEND_QUEST_PHASE_ORDER = [
  'inactive',
  'npc_waiting',
  'dialog',
  'tutorial',
  'countdown',
  'defending',
  'complete_pending',
  'complete',
  'failed',
] as const satisfies readonly PersistedDefendQuestCheckpoint['phase'][];

function parseDefendQuestPhase(
  value: unknown,
): PersistedDefendQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, DEFEND_QUEST_PHASE_ORDER);
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
  } = value;
  const parsedQuestStatuses = parseQuestStatuses(questStatuses);
  const parsedPhase = parseDefendQuestPhase(phase);
  const parsedBarriers = parseArray(barriers, parseWoodBarrier);
  const parsedPendingBuild = pendingBuild === null ? null : parsePendingBuild(pendingBuild);
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
    !isNumber(npcHp)
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
  };
}

/**
 * Every spider-lab phase, in the order the quest reaches them. A save only
 * ever holds the steady ones: the explanation is saved as waiting and the run
 * back as awaiting the hack, but the order lists every phase so a comparison
 * along it never meets one it does not know.
 */
export const SPIDER_QUEST_PHASE_ORDER = [
  'inactive',
  'scientist_waiting',
  'scientist_dialog',
  'scientist_returning',
  'awaiting_hacking',
  'keyboard_hero_tutorial',
  'hacking',
  'hacking_failed',
  'cutscene',
  'boss_fight',
  'complete',
] as const satisfies readonly PersistedSpiderQuestCheckpoint['phase'][];

function parseSpiderQuestPhase(
  value: unknown,
): PersistedSpiderQuestCheckpoint['phase'] | undefined {
  return stringUnion(value, SPIDER_QUEST_PHASE_ORDER);
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

export function parseTownMemoryCheckpoint(value: unknown): TownMemoryCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { residentTalks, clearedCamps, paidOutInteriorProps, visitedPlaces, settledSewerWorks } =
    value;
  const parsedTalks = parseArray(residentTalks, (entry) => {
    const talk = parseStringKeyedTuple(entry, (v) => (isNumber(v) ? v : undefined));
    if (talk === undefined) return undefined;
    const residentId = stringUnion(talk[0], RESIDENT_IDS);
    return residentId === undefined ? undefined : ([residentId, talk[1]] as const);
  });
  const parsedVisitedPlaces = parseArray(visitedPlaces, (entry) =>
    stringUnion(entry, VISITED_PLACE_IDS),
  );
  const parsedPaidOutProps = parseArray(paidOutInteriorProps, (entry) =>
    isInteriorPropPayoutKey(entry) ? entry : undefined,
  );
  const parsedSewerWorks = parseArray(settledSewerWorks, (entry) =>
    stringUnion(entry, SEWER_WORK_IDS),
  );
  if (
    parsedTalks === undefined ||
    !isStringArray(clearedCamps) ||
    parsedPaidOutProps === undefined ||
    parsedVisitedPlaces === undefined ||
    parsedSewerWorks === undefined
  ) {
    return undefined;
  }
  return {
    residentTalks: parsedTalks,
    clearedCamps,
    paidOutInteriorProps: parsedPaidOutProps,
    visitedPlaces: parsedVisitedPlaces,
    settledSewerWorks: parsedSewerWorks,
  };
}

export function parseJournalProgressCheckpoint(
  value: unknown,
): JournalProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { pinnedTrackerId, pinSource } = value;
  if (pinnedTrackerId !== null && !isString(pinnedTrackerId)) return undefined;
  const parsedPinSource =
    pinSource === null ? null : stringUnion(pinSource, ['auto', 'player'] as const);
  if (parsedPinSource === undefined) return undefined;
  return { pinnedTrackerId, pinSource: parsedPinSource };
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

function isCount(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function parsePlayerRead(value: unknown): PlayerRead | undefined {
  if (!isRecord(value)) return undefined;
  const {
    handsSeen,
    hands,
    vpipHands,
    pfrHands,
    aggressiveActions,
    passiveActions,
    sawFlop,
    wentToShowdown,
    showdownsShown,
    bluffsShown,
  } = value;
  if (
    !isCount(handsSeen) ||
    !isCount(hands) ||
    !isCount(vpipHands) ||
    !isCount(pfrHands) ||
    !isCount(aggressiveActions) ||
    !isCount(passiveActions) ||
    !isCount(sawFlop) ||
    !isCount(wentToShowdown) ||
    !isCount(showdownsShown) ||
    !isCount(bluffsShown)
  ) {
    return undefined;
  }
  return {
    handsSeen,
    hands,
    vpipHands,
    pfrHands,
    aggressiveActions,
    passiveActions,
    sawFlop,
    wentToShowdown,
    showdownsShown,
    bluffsShown,
  };
}

/** Every key must be a regular and every read must parse, or the whole record is refused. */
function parsePokerReads(value: unknown): PokerReads | undefined {
  if (!isRecord(value)) return undefined;
  const reads: PokerReads = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRegularId(id)) return undefined;
    const read = parsePlayerRead(raw);
    if (read === undefined) return undefined;
    reads[id] = read;
  }
  return reads;
}

export function parseCasinoStateCheckpoint(value: unknown): CasinoStateCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const {
    casinoShoe,
    casinoHintsEnabled,
    pokerFast,
    pokerShowCards,
    slotsJackpotPool,
    slotsTurbo,
  } = value;
  const parsedShoe = casinoShoe === null ? null : parseShoeState(casinoShoe);
  if (parsedShoe === undefined) return undefined;
  if (casinoHintsEnabled !== null && !isBoolean(casinoHintsEnabled)) return undefined;
  const pokerReads = parsePokerReads(value.pokerReads);
  const pokerNotes = parsePokerReads(value.pokerNotes);
  if (pokerReads === undefined || pokerNotes === undefined) return undefined;
  if (!isBoolean(pokerFast) || !isBoolean(pokerShowCards) || !isBoolean(slotsTurbo)) {
    return undefined;
  }
  if (!isNumber(slotsJackpotPool)) return undefined;
  return {
    casinoShoe: parsedShoe,
    casinoHintsEnabled,
    pokerReads,
    pokerNotes,
    pokerFast,
    pokerShowCards,
    slotsJackpotPool: normalizeJackpotPool(slotsJackpotPool),
    slotsTurbo,
  };
}

function parseHireContract(value: unknown): HireContract | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, levelId } = value;
  if (kind === 'carried') return levelId === undefined ? { kind } : undefined;
  if (kind !== 'floor' || !isString(levelId) || !isLevelId(levelId)) return undefined;
  return { kind, levelId };
}

export function parseHiredMercenary(value: unknown): HiredMercenary | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, terms, contract, introduced, hp } = value;
  const parsedId = stringUnion(id, MERCENARY_TEMPLATE_IDS);
  const parsedTerms = stringUnion(terms, MERCENARY_CONTRACT_TERMS);
  const parsedContract = parseHireContract(contract);
  if (parsedId === undefined || parsedTerms === undefined) return undefined;
  if (!isString(name) || parsedContract === undefined) return undefined;
  if (!isBoolean(introduced)) return undefined;
  const hire: HiredMercenary = {
    id: parsedId,
    name,
    terms: parsedTerms,
    contract: parsedContract,
    introduced,
  };
  if (hp === undefined) return hire;
  // A live hire is the only one whose health is written, so it always has some left.
  if (!isNumber(hp) || hp <= 0) return undefined;
  hire.hp = hp;
  return hire;
}

export function parseMercenaryRosterCheckpoint(
  value: unknown,
): MercenaryRosterCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { active, lastDeceased, towerLoanSigned } = value;
  const parsedActive = active === null ? null : parseHiredMercenary(active);
  if (parsedActive === undefined) return undefined;
  if (lastDeceased !== null && !isString(lastDeceased)) return undefined;
  if (!isBoolean(towerLoanSigned)) return undefined;
  return { active: parsedActive, lastDeceased, towerLoanSigned };
}

function parseDeinonychusPetStateCheckpoint(
  value: unknown,
): DeinonychusPetStateCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { hp, regenFrames, scaledAgainstMaxHp, restingUntilFull } = value;
  if (
    !isNumber(hp) ||
    !isNumber(regenFrames) ||
    !isNumber(scaledAgainstMaxHp) ||
    !isBoolean(restingUntilFull)
  ) {
    return undefined;
  }
  return { hp, regenFrames, scaledAgainstMaxHp, restingUntilFull };
}

function parseStarlightTentProgressCheckpoint(
  value: unknown,
): StarlightTentProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { encorePaid, chestClaimed } = value;
  if (!isBoolean(encorePaid) || !isBoolean(chestClaimed)) return undefined;
  return { encorePaid, chestClaimed };
}

function parseAnchorStepState(value: unknown): AnchorQuestProgressCheckpoint['tinker'] | undefined {
  return stringUnion(value, ['offered', 'in_progress', 'shard_owed', 'done'] as const);
}

function parseAnchorQuestProgressCheckpoint(
  value: unknown,
): AnchorQuestProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { status, tinker, lori, temple, loriRepairedTypes, templeVerminRemaining } = value;
  const parsedStatus = parseQuestStatus(status);
  const parsedTinker = parseAnchorStepState(tinker);
  const parsedLori = parseAnchorStepState(lori);
  const parsedTemple = parseAnchorStepState(temple);
  if (
    parsedStatus === undefined ||
    parsedTinker === undefined ||
    parsedLori === undefined ||
    parsedTemple === undefined ||
    !isNumberArray(loriRepairedTypes) ||
    !isNumber(templeVerminRemaining)
  ) {
    return undefined;
  }
  return {
    status: parsedStatus,
    tinker: parsedTinker,
    lori: parsedLori,
    temple: parsedTemple,
    loriRepairedTypes,
    templeVerminRemaining,
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
  const treasureChests = parsePersistedTreasureChestCheckpoint(value.treasureChests);
  const defendQuest = parsePersistedDefendQuestCheckpoint(value.defendQuest);
  const spiderQuest = parsePersistedSpiderQuestCheckpoint(value.spiderQuest);
  const bounty = value.bounty === null ? null : parsePersistedBountyCheckpoint(value.bounty);
  const starlightTentProgress = parseStarlightTentProgressCheckpoint(value.starlightTentProgress);
  const anchorQuestProgress = parseAnchorQuestProgressCheckpoint(value.anchorQuestProgress);
  const missingCatsProgress = parseMissingCatsProgressCheckpoint(value.missingCatsProgress);
  const journal = parseJournalProgressCheckpoint(value.journal);
  const bountyProgress = parseBountyProgressCheckpoint(value.bountyProgress);
  const casinoState = parseCasinoStateCheckpoint(value.casinoState);
  const shopStock = parseShopStockSnapshot(value.shopStock);
  const townMemory = parseTownMemoryCheckpoint(value.townMemory);
  const mercenaryRoster = parseMercenaryRosterCheckpoint(value.mercenaryRoster);
  const deinonychusPetState = parseDeinonychusPetStateCheckpoint(value.deinonychusPetState);
  const daveDebrief = parseDaveDebriefCheckpoint(value.daveDebrief);
  const tacticsNoticesSeen = parseTacticsNoticesSeen(value.tacticsNoticesSeen);
  const bossRoomDressing = parseBossRoomDressingCheckpoint(value.bossRoomDressing);
  const briarHollow = parseBriarHollowStateSnapshot(value.briarHollow);
  const cloggedBathroom = parseCloggedBathroomCheckpoint(value.cloggedBathroom);
  const stealthKeySnatch = parseStealthKeySnatchCheckpoint(value.stealthKeySnatch);
  const partySplit = parsePartySplitSnapshot(value.partySplit);
  const keyRing = parseKeyRingState(value.keyRing);
  const { krakenKilled, bigRoosterKilled, bigRoosterBossRoomIdx } = value;

  if (
    bossRoom === undefined ||
    treasureChests === undefined ||
    defendQuest === undefined ||
    spiderQuest === undefined ||
    bounty === undefined ||
    starlightTentProgress === undefined ||
    anchorQuestProgress === undefined ||
    missingCatsProgress === undefined ||
    journal === undefined ||
    bountyProgress === undefined ||
    casinoState === undefined ||
    shopStock === undefined ||
    townMemory === undefined ||
    mercenaryRoster === undefined ||
    deinonychusPetState === undefined ||
    daveDebrief === undefined ||
    tacticsNoticesSeen === undefined ||
    bossRoomDressing === undefined ||
    briarHollow === undefined ||
    cloggedBathroom === undefined ||
    stealthKeySnatch === undefined ||
    partySplit === undefined ||
    keyRing === undefined ||
    !isBoolean(krakenKilled) ||
    !isBoolean(bigRoosterKilled) ||
    !isNumber(bigRoosterBossRoomIdx)
  ) {
    return undefined;
  }

  return {
    bossRoom,
    treasureChests,
    defendQuest,
    spiderQuest,
    bounty,
    starlightTentProgress,
    anchorQuestProgress,
    missingCatsProgress,
    journal,
    bountyProgress,
    casinoState,
    shopStock,
    townMemory,
    mercenaryRoster,
    deinonychusPetState,
    daveDebrief,
    tacticsNoticesSeen,
    bossRoomDressing,
    briarHollow,
    cloggedBathroom,
    stealthKeySnatch,
    partySplit,
    keyRing,
    krakenKilled,
    bigRoosterKilled,
    bigRoosterBossRoomIdx,
  };
}
