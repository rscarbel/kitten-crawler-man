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

import { isRecord } from '../util/guards';
import {
  captureShopStock,
  createShopStock,
  parseShopStockSnapshot,
  restoreShopStock,
  type ShopStock,
  type ShopStockSnapshot,
} from '../../economy/shopStock';
import type { PalisadeTier } from '../../map/tileTypes';
import type { CrawlerKind } from '../skills/SkillManager';
import { VILLAGE_QUEST_PHASE_ORDER, type VillageQuestPhase } from './villageQuestPhase';
import {
  CONSTRUCTION_UNLOCK_IDS,
  createVillageUnlocks,
  type ConstructionUnlockId,
  type VillageUnlocks,
} from './villageUnlocks';
import { VILLAGER_IDS, type VillagerId } from '../../dialog/scripts/briarHollow';
import type { RatkinCastId } from '../../sprites/art/ratkin/cast';
import { HOLLOW_BELL_MAX_HP } from '../../systems/briarHollow/hollowBell';
import { PASTURE_FENCE_SECTION_COUNT } from '../../map/overworld/briarHollowLayout';
import {
  BLUEPRINTS_QUEST_PHASE_ORDER,
  type BlueprintsQuestPhase,
  type BlueprintsStationId,
} from './blueprintsQuestPhase';
import {
  contractSiteByBuildingId,
  CONTRACT_SITES,
  type ContractSiteBuildingId,
  contractSiteKey,
  contractSpot,
  taloncrestContractSite,
  type ContractSiteDef,
  type ContractSiteKey,
  type ContractSpotId,
} from '../../systems/constructionContracts/contractCatalog';
import { isBuildingId } from '../../map/buildingIds';

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
  /**
   * The bell tower lies broken after a lost siege, until the crawlers rebuild
   * it. Distinct from `bellHp`, which only ever runs down during a siege.
   */
  bellTowerBroken: boolean;
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
    bellTowerBroken: false,
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

// ── The Borrowed Blueprints ──────────────────────────────────────────────

/** Which of Fenna's two stations stand upgraded from Tikka's blueprints. */
export type BlueprintsStationsUpgraded = Record<BlueprintsStationId, boolean>;

/**
 * "The Borrowed Blueprints", Fenna's side quest. Held items (Merrit's scythe,
 * the blueprints) are deliberately absent: they are read off both crawlers'
 * inventories whenever they matter, so an item lost from the quest slot can
 * never leave this record claiming it is still held. Midge's position is
 * absent too, because a load or a rewind always stands her back at Merrit's
 * pasture gate.
 */
export interface BlueprintsQuestState {
  phase: BlueprintsQuestPhase;
  /** One flag per pasture fence section, in the ring order the sections are cut in. */
  fenceSectionsBuilt: boolean[];
  /** Grain harvested toward Merrit's hundred; an overshoot is kept. */
  grain: number;
  stationsUpgraded: BlueprintsStationsUpgraded;
  /**
   * Whether the party has read the quest-complete screen through to Continue.
   * Durable so a door visit, a reload or a rewind never raises it a second
   * time; false after completion only until that screen is dismissed.
   */
  completionScreenSeen: boolean;
}

export function createBlueprintsQuestState(): BlueprintsQuestState {
  return {
    phase: 'unoffered',
    fenceSectionsBuilt: new Array<boolean>(PASTURE_FENCE_SECTION_COUNT).fill(false),
    grain: 0,
    stationsUpgraded: { saw: false, ropeWalk: false },
    completionScreenSeen: false,
  };
}

/** A deep copy: the save and the checkpoint must never share arrays with the live record. */
function copyBlueprintsQuestState(quest: BlueprintsQuestState): BlueprintsQuestState {
  return {
    phase: quest.phase,
    fenceSectionsBuilt: [...quest.fenceSectionsBuilt],
    grain: quest.grain,
    stationsUpgraded: { ...quest.stationsUpgraded },
    completionScreenSeen: quest.completionScreenSeen,
  };
}

// ── Construction contracts ───────────────────────────────────────────────

/** The one contract the party holds: a site and the spots chosen from its pool. */
export interface ActiveContract {
  site: ContractSiteKey;
  spotIds: readonly ContractSpotId[];
  /** Parallel to `spotIds`. Ready to collect when every entry is true; never stored as its own flag. */
  spotsDone: boolean[];
}

/** Wendell's repeatable construction contracts, unlocked by finishing the Borrowed Blueprints. */
export interface ConstructionContractsState {
  /** Whether Wendell has given his long introduction; afterwards he offers in one line. */
  introSeen: boolean;
  /** Also the index of the RNG stream the next contract is drawn from, so a save reproduces it. */
  contractsIssued: number;
  contractsCompleted: number;
  active: ActiveContract | null;
  /** The last site finished or dropped, so the same building never comes up twice running. */
  lastSiteKey: ContractSiteBuildingId | null;
  /** Each site's last spot set, so a building never repeats its exact set back to back. */
  lastSpotSetBySite: Partial<Record<ContractSiteBuildingId, readonly ContractSpotId[]>>;
}

export function createConstructionContractsState(): ConstructionContractsState {
  return {
    introSeen: false,
    contractsIssued: 0,
    contractsCompleted: 0,
    active: null,
    lastSiteKey: null,
    lastSpotSetBySite: {},
  };
}

function copyActiveContract(active: ActiveContract): ActiveContract {
  return {
    site: { ...active.site },
    spotIds: [...active.spotIds],
    spotsDone: [...active.spotsDone],
  };
}

function copyConstructionContractsState(
  contracts: ConstructionContractsState,
): ConstructionContractsState {
  const lastSpotSetBySite: ConstructionContractsState['lastSpotSetBySite'] = {};
  for (const { buildingId } of CONTRACT_SITES) {
    const spotIds = contracts.lastSpotSetBySite[buildingId];
    if (spotIds !== undefined) lastSpotSetBySite[buildingId] = [...spotIds];
  }
  return {
    introSeen: contracts.introSeen,
    contractsIssued: contracts.contractsIssued,
    contractsCompleted: contracts.contractsCompleted,
    active: contracts.active === null ? null : copyActiveContract(contracts.active),
    lastSiteKey: contracts.lastSiteKey,
    lastSpotSetBySite,
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
   * credited to. Absent on a structure without spikes.
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
  /** Fenna's side quest, "The Borrowed Blueprints". */
  blueprints: BlueprintsQuestState;
  /** Wendell's construction contracts, once the Borrowed Blueprints is finished. */
  contracts: ConstructionContractsState;
  unlocks: VillageUnlocks;
  structures: StructureRecord[];
  soldierOrders: SoldierOrderRecord[];
  talkCounts: Record<VillagerId, number>;
  /** One-shot lines already spoken, e.g. `"wicker:wooden_wall_built"`. */
  onceFlags: string[];
  /**
   * Vetch's counter and Pipkin's kitchen, apart from the town's shops: each
   * floor's village has its own state, so a new floor's village opens with
   * every shelf at normal stock.
   */
  shopStock: ShopStock;
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
  /**
   * Base-speed harvests the node held when first worked. A faster harvester
   * spends a fraction of one per award (`harvestNodeWork`), so this measures
   * the node's life in time, not in awards.
   */
  capacity: number;
  /** Base-speed harvests left, possibly fractional; 0 once felled or crumbled. */
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
 * Every villager listed explicitly, like `VILLAGER_SCRIPTS`, so that a new
 * villager id fails this function's typecheck until it is added here too,
 * rather than silently reading as never-talked-to.
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

/**
 * Whether the whole village, not only its square, saves the game on entry: true
 * once the Plea's rewards have been handed over.
 */
export function isVillageSavePoint(state: BriarHollowState): boolean {
  return state.quest.rewardsGranted;
}

export function createBriarHollowState(): BriarHollowState {
  return {
    quest: createVillageQuestState(),
    blueprints: createBlueprintsQuestState(),
    contracts: createConstructionContractsState(),
    unlocks: createVillageUnlocks(),
    structures: [],
    soldierOrders: [],
    talkCounts: emptyTalkCounts(),
    onceFlags: [],
    shopStock: createShopStock(),
    nodes: new Map(),
    villagers: createVillagerMemory(),
  };
}

/** A JSON-safe, value-equal copy of a {@link BriarHollowState} at a point in time. */
export type BriarHollowStateSnapshot = Omit<
  BriarHollowState,
  'nodes' | 'villagers' | 'shopStock'
> & {
  shopStock: ShopStockSnapshot;
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
    blueprints: copyBlueprintsQuestState(state.blueprints),
    contracts: copyConstructionContractsState(state.contracts),
    unlocks: copyUnlocks(state.unlocks),
    structures: state.structures.map((structure) => ({ ...structure })),
    soldierOrders: state.soldierOrders.map(copySoldierOrder),
    talkCounts: { ...state.talkCounts },
    onceFlags: [...state.onceFlags],
    shopStock: captureShopStock(state.shopStock),
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
  target.blueprints = copyBlueprintsQuestState(snapshot.blueprints);
  target.contracts = copyConstructionContractsState(snapshot.contracts);
  target.unlocks = copyUnlocks(snapshot.unlocks);
  target.structures = snapshot.structures.map((structure) => ({ ...structure }));
  target.soldierOrders = snapshot.soldierOrders.map(copySoldierOrder);
  target.talkCounts = { ...snapshot.talkCounts };
  target.onceFlags = [...snapshot.onceFlags];
  restoreShopStock(target.shopStock, snapshot.shopStock);
}

function copyUnlocks(unlocks: VillageUnlocks): VillageUnlocks {
  return { ...unlocks, construction: [...unlocks.construction] };
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

function isCount(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isWholeCount(value: unknown): value is number {
  return isCount(value) && Number.isInteger(value);
}

function stringUnion<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.find((candidate) => candidate === value);
}

/** Every entry must parse, or the whole array is refused. */
function parseEach<T>(
  value: unknown,
  parseItem: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const item of value) {
    const entry = parseItem(item);
    if (entry === undefined) return undefined;
    parsed.push(entry);
  }
  return parsed;
}

function isVillagerId(value: unknown): value is VillagerId {
  return typeof value === 'string' && VILLAGER_IDS.some((id) => id === value);
}

const PALISADE_TIERS: readonly PalisadeTier[] = ['fence', 'wood', 'stone', 'fortified'];
const WALL_SEGMENT_TIERS: readonly WallSegmentTier[] = [...PALISADE_TIERS, 'breach', 'gap'];
const CRAWLER_KINDS: readonly CrawlerKind[] = ['human', 'cat'];
const SOLDIER_ORDERS: readonly SoldierOrder[] = ['follow', 'hold', 'patrol'];

/** The phases a save may hold: every phase but the two a capture never writes. */
const PERSISTED_VILLAGE_QUEST_PHASES = VILLAGE_QUEST_PHASE_ORDER.filter(
  (phase) => !UNPERSISTED_SIEGE_PHASES.has(phase),
);

function parseVillageGatheringProgress(value: unknown): VillageGatheringProgress | undefined {
  if (!isRecord(value)) return undefined;
  const { woodChopped, stoneMined, boardsProcessed, ropeProcessed } = value;
  if (
    !isCount(woodChopped) ||
    !isCount(stoneMined) ||
    !isCount(boardsProcessed) ||
    !isCount(ropeProcessed)
  ) {
    return undefined;
  }
  return { woodChopped, stoneMined, boardsProcessed, ropeProcessed };
}

function parseVillageSiegeSummary(value: unknown): VillageSiegeSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { segmentsBreached, structuresDestroyed, soldiersDowned } = value;
  if (
    !isWholeCount(segmentsBreached) ||
    !isWholeCount(structuresDestroyed) ||
    !isWholeCount(soldiersDowned)
  ) {
    return undefined;
  }
  return { segmentsBreached, structuresDestroyed, soldiersDowned };
}

function parseVillageQuestState(value: unknown): VillageQuestState | undefined {
  if (!isRecord(value)) return undefined;
  const { imminentCountdownFrames, assaultWaveIndex, bellHp, rewardsGranted, bellTowerBroken } =
    value;
  const phase = stringUnion(value.phase, PERSISTED_VILLAGE_QUEST_PHASES);
  const gathering = parseVillageGatheringProgress(value.gathering);
  const lastSiege = value.lastSiege === null ? null : parseVillageSiegeSummary(value.lastSiege);
  if (
    phase === undefined ||
    gathering === undefined ||
    !isCount(imminentCountdownFrames) ||
    (assaultWaveIndex !== null && !isWholeCount(assaultWaveIndex)) ||
    !isCount(bellHp) ||
    lastSiege === undefined ||
    !isBoolean(rewardsGranted) ||
    !isBoolean(bellTowerBroken)
  ) {
    return undefined;
  }
  return {
    phase,
    gathering,
    imminentCountdownFrames,
    assaultWaveIndex,
    bellHp,
    lastSiege,
    rewardsGranted,
    bellTowerBroken,
  };
}

function parseStationsUpgraded(value: unknown): BlueprintsStationsUpgraded | undefined {
  if (!isRecord(value)) return undefined;
  const { saw, ropeWalk } = value;
  if (!isBoolean(saw) || !isBoolean(ropeWalk)) return undefined;
  return { saw, ropeWalk };
}

function parseBlueprintsQuestState(value: unknown): BlueprintsQuestState | undefined {
  if (!isRecord(value)) return undefined;
  const { grain, completionScreenSeen } = value;
  const phase = stringUnion(value.phase, BLUEPRINTS_QUEST_PHASE_ORDER);
  const fenceSectionsBuilt = parseEach(value.fenceSectionsBuilt, (section) =>
    isBoolean(section) ? section : undefined,
  );
  const stationsUpgraded = parseStationsUpgraded(value.stationsUpgraded);
  if (
    phase === undefined ||
    fenceSectionsBuilt?.length !== PASTURE_FENCE_SECTION_COUNT ||
    !isWholeCount(grain) ||
    stationsUpgraded === undefined ||
    !isBoolean(completionScreenSeen)
  ) {
    return undefined;
  }
  return { phase, fenceSectionsBuilt, grain, stationsUpgraded, completionScreenSeen };
}

/** The catalogue site a saved key names, or undefined when it names none. */
function parseContractSiteKey(value: unknown): ContractSiteDef | undefined {
  if (!isRecord(value)) return undefined;
  if (value.town === 'taloncrest' && isBuildingId(value.buildingId)) {
    return taloncrestContractSite(value.buildingId);
  }
  if (value.town === 'briar_hollow' && isString(value.buildingId)) {
    const site = contractSiteByBuildingId(value.buildingId);
    return site?.town === 'briar_hollow' ? site : undefined;
  }
  return undefined;
}

/** A list of distinct spot ids, every one of them in `site`'s pool. */
function parseSiteSpotIds(value: unknown, site: ContractSiteDef): ContractSpotId[] | undefined {
  const spotIds = parseEach(value, (id) =>
    isString(id) && contractSpot(site, id) !== undefined ? id : undefined,
  );
  if (spotIds === undefined) return undefined;
  const hasDuplicates = new Set(spotIds).size !== spotIds.length;
  return hasDuplicates ? undefined : spotIds;
}

function parseActiveContract(value: unknown): ActiveContract | undefined {
  if (!isRecord(value)) return undefined;
  const site = parseContractSiteKey(value.site);
  if (site === undefined) return undefined;
  const spotIds = parseSiteSpotIds(value.spotIds, site);
  const spotsDone = parseEach(value.spotsDone, (done) => (isBoolean(done) ? done : undefined));
  if (spotIds === undefined || spotIds.length === 0) return undefined;
  if (spotsDone?.length !== spotIds.length) return undefined;
  return { site: contractSiteKey(site), spotIds, spotsDone };
}

function parseSpotSetsBySite(
  value: unknown,
): ConstructionContractsState['lastSpotSetBySite'] | undefined {
  if (!isRecord(value)) return undefined;
  const sets: ConstructionContractsState['lastSpotSetBySite'] = {};
  for (const [buildingId, saved] of Object.entries(value)) {
    const site = contractSiteByBuildingId(buildingId);
    if (site === undefined) return undefined;
    const spotIds = parseSiteSpotIds(saved, site);
    if (spotIds === undefined) return undefined;
    sets[site.buildingId] = spotIds;
  }
  return sets;
}

function parseConstructionContractsState(value: unknown): ConstructionContractsState | undefined {
  if (!isRecord(value)) return undefined;
  const { introSeen, contractsIssued, contractsCompleted, lastSiteKey } = value;
  const active = value.active === null ? null : parseActiveContract(value.active);
  const lastSpotSetBySite = parseSpotSetsBySite(value.lastSpotSetBySite);
  const lastSite =
    lastSiteKey === null
      ? null
      : isString(lastSiteKey)
        ? contractSiteByBuildingId(lastSiteKey)
        : undefined;
  if (
    !isBoolean(introSeen) ||
    !isWholeCount(contractsIssued) ||
    !isWholeCount(contractsCompleted) ||
    active === undefined ||
    lastSite === undefined ||
    lastSpotSetBySite === undefined
  ) {
    return undefined;
  }
  return {
    introSeen,
    contractsIssued,
    contractsCompleted,
    active,
    lastSiteKey: lastSite === null ? null : lastSite.buildingId,
    lastSpotSetBySite,
  };
}

function isConstructionUnlockId(value: unknown): value is ConstructionUnlockId {
  return typeof value === 'string' && CONSTRUCTION_UNLOCK_IDS.some((id) => id === value);
}

function parseVillageUnlocks(value: unknown): VillageUnlocks | undefined {
  if (!isRecord(value)) return undefined;
  const { processingStations, soldierCommands } = value;
  const construction = parseEach(value.construction, (id) =>
    isConstructionUnlockId(id) ? id : undefined,
  );
  if (!isBoolean(processingStations) || !isBoolean(soldierCommands) || construction === undefined) {
    return undefined;
  }
  return { processingStations, soldierCommands, construction };
}

function parseBuiltBy(value: unknown): CrawlerKind | undefined {
  return stringUnion(value, CRAWLER_KINDS);
}

/** The fields every structure record shares, or undefined when any is malformed. */
function parseStructureBase(value: Record<string, unknown>): StructureRecordBase | undefined {
  const { hp, spikesHp, spikesBy, hpMultiplier } = value;
  const builtBy = parseBuiltBy(value.builtBy);
  const parsedSpikesBy = spikesBy === undefined ? undefined : parseBuiltBy(spikesBy);
  if (
    builtBy === undefined ||
    !isCount(hp) ||
    (spikesHp !== null && !isCount(spikesHp)) ||
    (spikesBy !== undefined && parsedSpikesBy === undefined) ||
    (hpMultiplier !== undefined && !(isNumber(hpMultiplier) && hpMultiplier > 0))
  ) {
    return undefined;
  }
  const base: StructureRecordBase = { builtBy, hp, spikesHp };
  if (parsedSpikesBy !== undefined) base.spikesBy = parsedSpikesBy;
  if (hpMultiplier !== undefined) base.hpMultiplier = hpMultiplier;
  return base;
}

function parseSegmentStructureRecord(
  value: Record<string, unknown>,
  base: StructureRecordBase,
): SegmentStructureRecord | undefined {
  const { id, formerTier } = value;
  const tier = stringUnion(value.tier, WALL_SEGMENT_TIERS);
  const parsedFormerTier =
    formerTier === undefined ? undefined : stringUnion(formerTier, PALISADE_TIERS);
  const formerTierValid =
    formerTier === undefined || (tier === 'breach' && parsedFormerTier !== undefined);
  if (!isString(id) || tier === undefined || !formerTierValid) return undefined;
  const record: SegmentStructureRecord = { ...base, kind: 'segment', id, tier };
  if (parsedFormerTier !== undefined) record.formerTier = parsedFormerTier;
  return record;
}

function parseTrebuchetStructureRecord(
  value: Record<string, unknown>,
  base: StructureRecordBase,
): TrebuchetStructureRecord | undefined {
  const { x, y, broken, ammo } = value;
  if (!isNumber(x) || !isNumber(y) || !isBoolean(broken) || !isCount(ammo)) return undefined;
  return { ...base, kind: 'trebuchet', x, y, broken, ammo };
}

function parseSnareStructureRecord(
  value: Record<string, unknown>,
  base: StructureRecordBase,
): SnareStructureRecord | undefined {
  const { x, y, broken, repairedOnce } = value;
  if (!isNumber(x) || !isNumber(y) || !isBoolean(broken) || !isBoolean(repairedOnce)) {
    return undefined;
  }
  return { ...base, kind: 'snare', x, y, broken, repairedOnce };
}

function parseStructureRecord(value: unknown): StructureRecord | undefined {
  if (!isRecord(value)) return undefined;
  const base = parseStructureBase(value);
  if (base === undefined) return undefined;
  switch (value.kind) {
    case 'segment':
      return parseSegmentStructureRecord(value, base);
    case 'trebuchet':
      return parseTrebuchetStructureRecord(value, base);
    case 'snare':
      return parseSnareStructureRecord(value, base);
    default:
      return undefined;
  }
}

function parseRouteTile(value: unknown): SoldierRouteTile | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (!isNumber(x) || !isNumber(y)) return undefined;
  return { x, y };
}

function parseSoldierOrderRecord(value: unknown): SoldierOrderRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { soldierId, x, y, followCrawler, patrolRoute } = value;
  const order = stringUnion(value.order, SOLDIER_ORDERS);
  const parsedFollowCrawler =
    followCrawler === undefined ? undefined : stringUnion(followCrawler, CRAWLER_KINDS);
  const parsedRoute =
    patrolRoute === undefined ? undefined : parseEach(patrolRoute, parseRouteTile);
  if (
    !isVillagerId(soldierId) ||
    order === undefined ||
    (x !== undefined && !isNumber(x)) ||
    (y !== undefined && !isNumber(y)) ||
    (followCrawler !== undefined && parsedFollowCrawler === undefined) ||
    (patrolRoute !== undefined && parsedRoute === undefined)
  ) {
    return undefined;
  }
  const record: SoldierOrderRecord = { soldierId, order };
  if (x !== undefined) record.x = x;
  if (y !== undefined) record.y = y;
  if (parsedFollowCrawler !== undefined) record.followCrawler = parsedFollowCrawler;
  if (parsedRoute !== undefined) record.patrolRoute = parsedRoute;
  return record;
}

function parseTalkCounts(value: unknown): Record<VillagerId, number> | undefined {
  if (!isRecord(value)) return undefined;
  const counts = emptyTalkCounts();
  for (const id of VILLAGER_IDS) {
    const count = value[id];
    if (!isWholeCount(count)) return undefined;
    counts[id] = count;
  }
  return counts;
}

/**
 * Reads a saved {@link BriarHollowStateSnapshot} back from untrusted JSON.
 * Any missing or malformed field, including any one array entry, refuses the
 * whole snapshot.
 */
export function parseBriarHollowStateSnapshot(
  value: unknown,
): BriarHollowStateSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const quest = parseVillageQuestState(value.quest);
  const blueprints = parseBlueprintsQuestState(value.blueprints);
  const contracts = parseConstructionContractsState(value.contracts);
  const unlocks = parseVillageUnlocks(value.unlocks);
  const structures = parseEach(value.structures, parseStructureRecord);
  const soldierOrders = parseEach(value.soldierOrders, parseSoldierOrderRecord);
  const talkCounts = parseTalkCounts(value.talkCounts);
  const onceFlags = parseEach(value.onceFlags, (flag) => (isString(flag) ? flag : undefined));
  const shopStock = parseShopStockSnapshot(value.shopStock);
  if (
    quest === undefined ||
    blueprints === undefined ||
    contracts === undefined ||
    unlocks === undefined ||
    structures === undefined ||
    soldierOrders === undefined ||
    talkCounts === undefined ||
    onceFlags === undefined ||
    shopStock === undefined
  ) {
    return undefined;
  }
  return {
    quest,
    blueprints,
    contracts,
    unlocks,
    structures,
    soldierOrders,
    talkCounts,
    onceFlags,
    shopStock,
  };
}
