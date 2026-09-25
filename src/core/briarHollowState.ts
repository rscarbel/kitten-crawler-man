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
import type { RatkinCastId } from '../sprites/art/ratkin/cast';
import { HOLLOW_BELL_MAX_HP } from '../systems/briarHollow/hollowBell';
import { PALISADE_SEGMENT_SCHEME_VERSION } from '../map/overworld/briarHollowSite';

// ── Quest state ──────────────────────────────────────────────────────────

export interface VillageGatheringProgress {
  woodChopped: number;
  stoneMined: number;
  boardsProcessed: number;
  ropeProcessed: number;
}

/** What the last siege cost the village, for the Mayor's word on the damage afterwards. */
export interface VillageSiegeSummary {
  segmentsBreached: number;
  structuresDestroyed: number;
  soldiersDowned: number;
}

export interface VillageQuestState {
  phase: VillageQuestPhase;
  gathering: VillageGatheringProgress;
  /** Frames left on the "attack imminent" countdown; 0 when none is running. */
  imminentCountdownFrames: number;
  /** Which assault wave is under way, or null outside the `assault` phase. */
  assaultWaveIndex: number | null;
  /** The Hollow Bell's health. Full whenever no siege is being fought. */
  bellHp: number;
  /** The damage the most recent siege did, or null before the first one ends. */
  lastSiege: VillageSiegeSummary | null;
  /** Set the moment the Mayor's rewards are handed over, so a second turn-in pays nothing. */
  rewardsGranted: boolean;
}

function createVillageGatheringProgress(): VillageGatheringProgress {
  return { woodChopped: 0, stoneMined: 0, boardsProcessed: 0, ropeProcessed: 0 };
}

function createVillageQuestState(): VillageQuestState {
  return {
    phase: 'unmet',
    gathering: createVillageGatheringProgress(),
    imminentCountdownFrames: 0,
    assaultWaveIndex: null,
    bellHp: HOLLOW_BELL_MAX_HP,
    lastSiege: null,
    rewardsGranted: false,
  };
}

/** The two phases a siege is fought in; neither is ever written to a save or a checkpoint. */
const UNPERSISTED_SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);

/**
 * The quest as a save or a checkpoint may record it: a siege in progress is
 * written as the fortifying it began from, with the bell whole and no
 * countdown or wave, so a death or a reload mid-siege lands before the siege
 * rather than halfway through a wave nothing could resume.
 */
function persistableQuest(quest: VillageQuestState): VillageQuestState {
  const lastSiege = quest.lastSiege === null ? null : { ...quest.lastSiege };
  if (!UNPERSISTED_SIEGE_PHASES.has(quest.phase)) {
    return { ...quest, gathering: { ...quest.gathering }, lastSiege };
  }
  return {
    ...quest,
    phase: 'fortifying',
    gathering: { ...quest.gathering },
    imminentCountdownFrames: 0,
    assaultWaveIndex: null,
    bellHp: HOLLOW_BELL_MAX_HP,
    lastSiege,
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
  /**
   * Which crawler added the spikes, whose kills the spikes' thorn damage is
   * credited to. Absent on a structure without spikes, or from a save that
   * never recorded it — the human is credited then.
   */
  spikesBy?: CrawlerKind;
  /**
   * The level-15 HP multiplier `hp` and `spikesHp` were last scaled under.
   * When the builder's own multiplier moves, both are rescaled by the ratio so
   * a half-health wall stays at half health. Absent means 1.
   */
  hpMultiplier?: number;
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

/** A tile on the map, as a soldier's patrol route records its waypoints. */
export interface SoldierRouteTile {
  x: number;
  y: number;
}

/**
 * A soldier's standing orders. A soldier with no record is at their post,
 * which is also what every new save starts with.
 */
export interface SoldierOrderRecord {
  soldierId: VillagerId;
  order: SoldierOrder;
  /** The post a `'hold'` or `'patrol'` order is anchored to; absent while following. */
  x?: number;
  y?: number;
  /** Which crawler a `'follow'` order trails: whoever gave it. */
  followCrawler?: CrawlerKind;
  /**
   * A `'patrol'` order's waypoints, worked out and checked walkable when the
   * order was given and walked in order, looping, ever after.
   */
  patrolRoute?: SoldierRouteTile[];
}

/** A deep copy of one order, so a snapshot never shares a patrol route with the live state. */
function copySoldierOrder(order: SoldierOrderRecord): SoldierOrderRecord {
  const copy: SoldierOrderRecord = { ...order };
  if (order.patrolRoute !== undefined) {
    copy.patrolRoute = order.patrolRoute.map((tile) => ({ ...tile }));
  }
  return copy;
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
  /**
   * Every tree and rock anyone has worked, keyed by `tileKey`, so a door visit
   * never refills a half-chopped tree. Not part of {@link BriarHollowStateSnapshot}:
   * the gathering system checkpoints it itself, because putting a crumbled rock
   * back needs the live and the captured states side by side, and it is never
   * saved, because the map it describes regenerates on reload.
   */
  nodes: Map<string, HarvestNodeState>;
  /**
   * What the villagers remember between conversations. Not part of
   * {@link BriarHollowStateSnapshot} either: every entry is a recent-event
   * stamp or a cooldown on a session clock, and a reload starting them all
   * fresh is the same as the village simply not having noticed.
   */
  villagers: VillagerMemory;
}

/** Where and when something happened that a villager may remark on. */
export interface VillageEventMark {
  /** On {@link VillagerMemory.clockSeconds}. */
  at: number;
  tileX: number;
  tileY: number;
}

export interface VillagerMemory {
  /**
   * Seconds of village life, advanced by the village's own update. Every
   * stamp below is on this clock, which stops with the pause menu and
   * carries on across door visits.
   */
  clockSeconds: number;
  lastCowPet: VillageEventMark | null;
  /** The last rock deposit that crumbled. */
  lastDepositDepleted: VillageEventMark | null;
  /** Party stone as of each villager's last conversation. */
  stoneAtLastTalk: Partial<Record<VillagerId, number>>;
  /** When Wicker last suggested upgrading a wooden wall to stone. */
  lastStoneUpgradeHintAt: number | null;
  /** When each cast member may next bark, keyed by cast id. */
  barkReadyAt: Map<RatkinCastId, number>;
}

export function createVillagerMemory(): VillagerMemory {
  return {
    clockSeconds: 0,
    lastCowPet: null,
    lastDepositDepleted: null,
    stoneAtLastTalk: {},
    lastStoneUpgradeHintAt: null,
    barkReadyAt: new Map(),
  };
}

/** A harvest node's worked state, created the first time anyone works it. */
export interface HarvestNodeState {
  kind: 'wood' | 'stone';
  tileX: number;
  tileY: number;
  /** Harvests the node held when first worked. */
  capacity: number;
  /** Harvests left; 0 once felled or crumbled. */
  remaining: number;
  /** The node's tile type when first worked, which a rewind stands a crumbled rock back up as. */
  tileType: number;
  /**
   * Fixed-timestep ticks until a run-out village node takes its next step
   * back, or null for one that is not regrowing. Only the quarry's deposits
   * and the lumber yard's grove regrow; the wilds stay worked out.
   */
  regrowTicksLeft: number | null;
  /** A grove tree that has come back as far as a sapling, on its way to a full tree. */
  sapling: boolean;
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
    nodes: new Map(),
    villagers: createVillagerMemory(),
  };
}

/**
 * A JSON-safe, value-equal copy of a {@link BriarHollowState} at a point in
 * time. `segmentScheme` records which cut of the palisade ring the segment ids
 * in `structures` were keyed against, so a save written under an older cut can
 * be told apart from one written under the current one.
 */
export type BriarHollowStateSnapshot = Omit<BriarHollowState, 'nodes' | 'villagers'> & {
  segmentScheme: number;
};

/**
 * Captures the state for a save file or a world checkpoint — both go through
 * here. **Invariant:** the `imminent` and `assault` phases are never captured;
 * a siege under way is recorded as `fortifying` with the bell at full health,
 * so a death or a page reload during the siege rewinds to before it and no
 * half-fought wave can ever be resumed. A death always returns to the last
 * save, and the last save cannot have been taken mid-wave.
 */
export function captureBriarHollowState(state: BriarHollowState): BriarHollowStateSnapshot {
  return {
    quest: persistableQuest(state.quest),
    structures: state.structures.map((structure) => ({ ...structure })),
    soldierOrders: state.soldierOrders.map(copySoldierOrder),
    talkCounts: { ...state.talkCounts },
    onceFlags: [...state.onceFlags],
    merchantStock: { ...state.merchantStock },
    segmentScheme: PALISADE_SEGMENT_SCHEME_VERSION,
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
  target.quest = persistableQuest(snapshot.quest);
  target.structures = snapshot.structures.map((structure) => ({ ...structure }));
  target.soldierOrders = snapshot.soldierOrders.map(copySoldierOrder);
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
  const parsedPhase = stringUnion(value.phase, VILLAGE_QUEST_PHASES) ?? defaults.phase;
  // A save never holds a siege; one that claims to is read as the fortifying
  // it would have begun from, like the capture writes it.
  const phase = UNPERSISTED_SIEGE_PHASES.has(parsedPhase) ? 'fortifying' : parsedPhase;
  const assaultWaveIndex =
    value.assaultWaveIndex === null
      ? null
      : isNumber(value.assaultWaveIndex)
        ? Math.max(0, Math.floor(value.assaultWaveIndex))
        : null;
  return {
    phase,
    gathering: parseVillageGatheringProgress(value.gathering),
    imminentCountdownFrames: isNumber(value.imminentCountdownFrames)
      ? Math.max(0, value.imminentCountdownFrames)
      : defaults.imminentCountdownFrames,
    assaultWaveIndex,
    bellHp: HOLLOW_BELL_MAX_HP,
    lastSiege: parseVillageSiegeSummary(value.lastSiege),
    rewardsGranted: isBoolean(value.rewardsGranted)
      ? value.rewardsGranted
      : defaults.rewardsGranted,
  };
}

function parseVillageSiegeSummary(value: unknown): VillageSiegeSummary | null {
  if (!isRecord(value)) return null;
  const count = (field: unknown): number => (isNumber(field) ? Math.max(0, Math.floor(field)) : 0);
  return {
    segmentsBreached: count(value.segmentsBreached),
    structuresDestroyed: count(value.structuresDestroyed),
    soldiersDowned: count(value.soldiersDowned),
  };
}

function parseSpikesHp(value: unknown): number | null {
  if (value === null) return null;
  return isNumber(value) ? Math.max(0, value) : null;
}

function parseBuiltBy(value: unknown): CrawlerKind | undefined {
  return stringUnion(value, CRAWLER_KINDS);
}

/** The optional fields every structure record shares, copied onto `record` only when valid. */
function parseStructureExtras(value: Record<string, unknown>, record: StructureRecordBase): void {
  const spikesBy = parseBuiltBy(value.spikesBy);
  if (spikesBy !== undefined) record.spikesBy = spikesBy;
  if (isNumber(value.hpMultiplier) && value.hpMultiplier > 0) {
    record.hpMultiplier = value.hpMultiplier;
  }
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
  parseStructureExtras(value, record);
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
  const record: TrebuchetStructureRecord = {
    kind: 'trebuchet',
    x,
    y,
    hp: Math.max(0, hp),
    broken,
    ammo: Math.max(0, ammo),
    spikesHp: parseSpikesHp(value.spikesHp),
    builtBy,
  };
  parseStructureExtras(value, record);
  return record;
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
  const record: SnareStructureRecord = {
    kind: 'snare',
    x,
    y,
    hp: Math.max(0, hp),
    broken,
    repairedOnce,
    spikesHp: parseSpikesHp(value.spikesHp),
    builtBy,
  };
  parseStructureExtras(value, record);
  return record;
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
  const followCrawler = stringUnion(value.followCrawler, CRAWLER_KINDS);
  if (followCrawler !== undefined) record.followCrawler = followCrawler;
  if (Array.isArray(value.patrolRoute)) {
    const route: SoldierRouteTile[] = [];
    for (const tile of value.patrolRoute) {
      if (isRecord(tile) && isNumber(tile.x) && isNumber(tile.y)) {
        route.push({ x: tile.x, y: tile.y });
      }
    }
    record.patrolRoute = route;
  }
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
  // A save written under an earlier cut of the palisade ring keys its wall
  // segments by an index that now names a different, wrongly-sized run —
  // rather than misapply a stranger's HP and tier to that stretch of wall,
  // every wall segment from an old-scheme save resets to the untouched fence
  // it would read as if nobody had ever kept its record at all. Trebuchets and
  // snares are keyed by tile, not by segment index, so they carry over untouched.
  const currentScheme =
    isNumber(value.segmentScheme) && value.segmentScheme === PALISADE_SEGMENT_SCHEME_VERSION;
  const structures: StructureRecord[] = [];
  if (Array.isArray(value.structures)) {
    for (const entry of value.structures) {
      const parsed = parseStructureRecord(entry);
      if (parsed === undefined) continue;
      if (parsed.kind === 'segment' && !currentScheme) continue;
      structures.push(parsed);
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
    segmentScheme: PALISADE_SEGMENT_SCHEME_VERSION,
  };
}
