/**
 * Briar Hollow's durable state: the defense questline's phase and gathering
 * counters, every palisade segment/trebuchet/snare the party has built, the
 * militia's standing orders, and the village's talk and stock bookkeeping.
 *
 * `BuildingInteriorScene` regenerates its map on every door entry and
 * `DungeonScene` is rebuilt on every door exit, so — like `TownMemory` — the
 * live object is threaded by reference through both scenes rather than owned
 * by either. A system rebuilt on a door visit reads from it and never holds
 * its own copy.
 */

import { isRecord } from './guards';
import type { PalisadeTier } from '../map/tileTypes';
import type { CrawlerKind } from './SkillManager';
import type { VillageQuestPhase } from './villageQuestPhase';
import type { VillagerId } from '../systems/briarHollow/ratkinDialogue';
import { VILLAGER_IDS } from '../systems/briarHollow/ratkinDialogue';

// ── Quest state ──────────────────────────────────────────────────────────

export interface VillageGatheringProgress {
  woodChopped: number;
  stoneMined: number;
  boardsProcessed: number;
  ropeProcessed: number;
}

export interface VillageQuestState {
  phase: VillageQuestPhase;
  gathering: VillageGatheringProgress;
  /** True once at least one wooden wall exists, so the Mayor can be told "We're ready". */
  readyToStart: boolean;
  /** Frames left on the "attack imminent" countdown; 0 when none is running. */
  imminentCountdownFrames: number;
  /** Which assault wave is under way, or null outside the `assault` phase. */
  assaultWaveIndex: number | null;
}

function createVillageGatheringProgress(): VillageGatheringProgress {
  return { woodChopped: 0, stoneMined: 0, boardsProcessed: 0, ropeProcessed: 0 };
}

function createVillageQuestState(): VillageQuestState {
  return {
    phase: 'unmet',
    gathering: createVillageGatheringProgress(),
    readyToStart: false,
    imminentCountdownFrames: 0,
    assaultWaveIndex: null,
  };
}

// ── Structures ───────────────────────────────────────────────────────────

/** A wall segment's tier, plus the two states a segment reaches at 0 HP. */
export type WallSegmentTier = PalisadeTier | 'breach' | 'gap';

interface StructureRecordBase {
  /** Which crawler's own Construction level the structure's level-15 effects read. */
  builtBy: CrawlerKind;
  hp: number;
  /** Spikes' own HP, or null when the structure has none built. */
  spikesHp: number | null;
}

export interface SegmentStructureRecord extends StructureRecordBase {
  kind: 'segment';
  id: string;
  tier: WallSegmentTier;
  /** The tier a breach remembers, restored by a full repair. Only set while `tier` is `'breach'`. */
  formerTier?: PalisadeTier;
}

export interface TrebuchetStructureRecord extends StructureRecordBase {
  kind: 'trebuchet';
  x: number;
  y: number;
  broken: boolean;
  ammo: number;
}

export interface SnareStructureRecord extends StructureRecordBase {
  kind: 'snare';
  x: number;
  y: number;
  broken: boolean;
  repairedOnce: boolean;
}

export type StructureRecord =
  SegmentStructureRecord | TrebuchetStructureRecord | SnareStructureRecord;

// ── Soldiers ─────────────────────────────────────────────────────────────

export type SoldierOrder = 'follow' | 'hold' | 'patrol';

export interface SoldierOrderRecord {
  soldierId: VillagerId;
  order: SoldierOrder;
  /** The post a `'hold'` or `'patrol'` order is anchored to; absent while following. */
  x?: number;
  y?: number;
}

// ── Top-level state ──────────────────────────────────────────────────────

export interface BriarHollowState {
  quest: VillageQuestState;
  structures: StructureRecord[];
  soldierOrders: SoldierOrderRecord[];
  talkCounts: Record<VillagerId, number>;
  /** One-shot lines already spoken, e.g. `"wicker:wooden_wall_built"`. */
  onceFlags: string[];
  merchantStock: Record<string, number>;
}

/**
 * Every villager listed explicitly, like `VILLAGER_TABLE` in `ratkinDialogue.ts`,
 * so that a new villager id fails this function's typecheck until it is added
 * here too, rather than silently reading as never-talked-to.
 */
function emptyTalkCounts(): Record<VillagerId, number> {
  return {
    bramblewick: 0,
    merrit: 0,
    pipkin: 0,
    sella: 0,
    vetch: 0,
    oren: 0,
    tikka: 0,
    fenna: 0,
    garn: 0,
    sedge: 0,
    hobb: 0,
    marta: 0,
    pru: 0,
    nella: 0,
    cricket: 0,
    wicker: 0,
    midge: 0,
  };
}

export function createBriarHollowState(): BriarHollowState {
  return {
    quest: createVillageQuestState(),
    structures: [],
    soldierOrders: [],
    talkCounts: emptyTalkCounts(),
    onceFlags: [],
    merchantStock: {},
  };
}

/** A JSON-safe, value-equal copy of a {@link BriarHollowState} at a point in time. */
export type BriarHollowStateSnapshot = BriarHollowState;

export function captureBriarHollowState(state: BriarHollowState): BriarHollowStateSnapshot {
  return {
    quest: { ...state.quest, gathering: { ...state.quest.gathering } },
    structures: state.structures.map((structure) => ({ ...structure })),
    soldierOrders: state.soldierOrders.map((order) => ({ ...order })),
    talkCounts: { ...state.talkCounts },
    onceFlags: [...state.onceFlags],
    merchantStock: { ...state.merchantStock },
  };
}

/**
 * Mutates `target` in place: the same `BriarHollowState` object is threaded by
 * reference through every scene, so rebinding a fresh one would strand every
 * system already holding it.
 */
export function restoreBriarHollowState(
  target: BriarHollowState,
  snapshot: BriarHollowStateSnapshot,
): void {
  target.quest = { ...snapshot.quest, gathering: { ...snapshot.quest.gathering } };
  target.structures = snapshot.structures.map((structure) => ({ ...structure }));
  target.soldierOrders = snapshot.soldierOrders.map((order) => ({ ...order }));
  target.talkCounts = { ...snapshot.talkCounts };
  target.onceFlags = [...snapshot.onceFlags];
  target.merchantStock = { ...snapshot.merchantStock };
}

// ── Parsing untrusted JSON ───────────────────────────────────────────────

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function stringUnion<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.find((candidate) => candidate === value);
}

function isVillagerId(value: unknown): value is VillagerId {
  return typeof value === 'string' && VILLAGER_IDS.some((id) => id === value);
}

const VILLAGE_QUEST_PHASES: readonly VillageQuestPhase[] = [
  'unmet',
  'offered',
  'declined',
  'need_tools',
  'gathering',
  'fortifying',
  'imminent',
  'assault',
  'repelled_failed',
  'victory',
  'complete',
];

const PALISADE_TIERS: readonly PalisadeTier[] = ['fence', 'wood', 'stone', 'fortified'];
const WALL_SEGMENT_TIERS: readonly WallSegmentTier[] = [...PALISADE_TIERS, 'breach', 'gap'];
const CRAWLER_KINDS: readonly CrawlerKind[] = ['human', 'cat'];
const SOLDIER_ORDERS: readonly SoldierOrder[] = ['follow', 'hold', 'patrol'];

function parseVillageGatheringProgress(value: unknown): VillageGatheringProgress {
  const defaults = createVillageGatheringProgress();
  if (!isRecord(value)) return defaults;
  return {
    woodChopped: isNumber(value.woodChopped)
      ? Math.max(0, value.woodChopped)
      : defaults.woodChopped,
    stoneMined: isNumber(value.stoneMined) ? Math.max(0, value.stoneMined) : defaults.stoneMined,
    boardsProcessed: isNumber(value.boardsProcessed)
      ? Math.max(0, value.boardsProcessed)
      : defaults.boardsProcessed,
    ropeProcessed: isNumber(value.ropeProcessed)
      ? Math.max(0, value.ropeProcessed)
      : defaults.ropeProcessed,
  };
}

function parseVillageQuestState(value: unknown): VillageQuestState {
  const defaults = createVillageQuestState();
  if (!isRecord(value)) return defaults;
  const phase = stringUnion(value.phase, VILLAGE_QUEST_PHASES) ?? defaults.phase;
  const assaultWaveIndex =
    value.assaultWaveIndex === null
      ? null
      : isNumber(value.assaultWaveIndex)
        ? Math.max(0, Math.floor(value.assaultWaveIndex))
        : null;
  return {
    phase,
    gathering: parseVillageGatheringProgress(value.gathering),
    readyToStart: isBoolean(value.readyToStart) ? value.readyToStart : defaults.readyToStart,
    imminentCountdownFrames: isNumber(value.imminentCountdownFrames)
      ? Math.max(0, value.imminentCountdownFrames)
      : defaults.imminentCountdownFrames,
    assaultWaveIndex,
  };
}

function parseSpikesHp(value: unknown): number | null {
  if (value === null) return null;
  return isNumber(value) ? Math.max(0, value) : null;
}

function parseBuiltBy(value: unknown): CrawlerKind | undefined {
  return stringUnion(value, CRAWLER_KINDS);
}

function parseSegmentStructureRecord(
  value: Record<string, unknown>,
): SegmentStructureRecord | undefined {
  const { id, tier, hp, formerTier } = value;
  const parsedTier = stringUnion(tier, WALL_SEGMENT_TIERS);
  const builtBy = parseBuiltBy(value.builtBy);
  if (!isString(id) || parsedTier === undefined || !isNumber(hp) || builtBy === undefined) {
    return undefined;
  }
  const record: SegmentStructureRecord = {
    kind: 'segment',
    id,
    tier: parsedTier,
    hp: Math.max(0, hp),
    spikesHp: parseSpikesHp(value.spikesHp),
    builtBy,
  };
  if (parsedTier === 'breach') {
    const parsedFormerTier = stringUnion(formerTier, PALISADE_TIERS);
    if (parsedFormerTier !== undefined) record.formerTier = parsedFormerTier;
  }
  return record;
}

function parseTrebuchetStructureRecord(
  value: Record<string, unknown>,
): TrebuchetStructureRecord | undefined {
  const { x, y, hp, broken, ammo } = value;
  const builtBy = parseBuiltBy(value.builtBy);
  if (
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(hp) ||
    !isBoolean(broken) ||
    !isNumber(ammo) ||
    builtBy === undefined
  ) {
    return undefined;
  }
  return {
    kind: 'trebuchet',
    x,
    y,
    hp: Math.max(0, hp),
    broken,
    ammo: Math.max(0, ammo),
    spikesHp: parseSpikesHp(value.spikesHp),
    builtBy,
  };
}

function parseSnareStructureRecord(
  value: Record<string, unknown>,
): SnareStructureRecord | undefined {
  const { x, y, hp, broken, repairedOnce } = value;
  const builtBy = parseBuiltBy(value.builtBy);
  if (
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(hp) ||
    !isBoolean(broken) ||
    !isBoolean(repairedOnce) ||
    builtBy === undefined
  ) {
    return undefined;
  }
  return {
    kind: 'snare',
    x,
    y,
    hp: Math.max(0, hp),
    broken,
    repairedOnce,
    spikesHp: parseSpikesHp(value.spikesHp),
    builtBy,
  };
}

/** A malformed entry returns `undefined` and is dropped by the caller, rather than failing the whole array. */
function parseStructureRecord(value: unknown): StructureRecord | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'segment':
      return parseSegmentStructureRecord(value);
    case 'trebuchet':
      return parseTrebuchetStructureRecord(value);
    case 'snare':
      return parseSnareStructureRecord(value);
    default:
      return undefined;
  }
}

function parseSoldierOrderRecord(value: unknown): SoldierOrderRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { soldierId, order, x, y } = value;
  const parsedOrder = stringUnion(order, SOLDIER_ORDERS);
  if (!isVillagerId(soldierId) || parsedOrder === undefined) return undefined;
  const record: SoldierOrderRecord = { soldierId, order: parsedOrder };
  if (isNumber(x)) record.x = x;
  if (isNumber(y)) record.y = y;
  return record;
}

function parseTalkCounts(value: unknown): Record<VillagerId, number> {
  const counts = emptyTalkCounts();
  if (!isRecord(value)) return counts;
  for (const id of VILLAGER_IDS) {
    const count = value[id];
    if (isNumber(count)) counts[id] = Math.max(0, count);
  }
  return counts;
}

function parseOnceFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

function parseMerchantStock(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const stock: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (isNumber(count)) stock[key] = Math.max(0, count);
  }
  return stock;
}

/**
 * Reads a saved {@link BriarHollowStateSnapshot} back from untrusted JSON.
 * Tolerant field-by-field, like `parseTownMemoryCheckpoint`: a missing or
 * malformed field falls back to its empty default rather than failing the
 * whole snapshot, and a malformed array entry is dropped rather than
 * rejecting the rest of the array. Only a value that is not an object at all
 * (not a save missing the field, but the field itself corrupted) is refused.
 */
export function parseBriarHollowStateSnapshot(
  value: unknown,
): BriarHollowStateSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const structures: StructureRecord[] = [];
  if (Array.isArray(value.structures)) {
    for (const entry of value.structures) {
      const parsed = parseStructureRecord(entry);
      if (parsed !== undefined) structures.push(parsed);
    }
  }
  const soldierOrders: SoldierOrderRecord[] = [];
  if (Array.isArray(value.soldierOrders)) {
    for (const entry of value.soldierOrders) {
      const parsed = parseSoldierOrderRecord(entry);
      if (parsed !== undefined) soldierOrders.push(parsed);
    }
  }
  return {
    quest: parseVillageQuestState(value.quest),
    structures,
    soldierOrders,
    talkCounts: parseTalkCounts(value.talkCounts),
    onceFlags: parseOnceFlags(value.onceFlags),
    merchantStock: parseMerchantStock(value.merchantStock),
  };
}
