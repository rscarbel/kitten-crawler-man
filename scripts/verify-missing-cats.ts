#!/usr/bin/env tsx
/**
 * "A Cat Always Comes Back", walked from its first line to its last, headless.
 *
 * The walk drives the questline's own systems the way the scenes do: the
 * town half (`MissingCatsQuestSystem`) on the real floor-3 overworld, each
 * room's half (`MissingCatsInteriorSystem`, the lodge cellar's defence) in
 * the room as the game builds it, and the tower (`TowerStoreysSystem`, its
 * storeys' works, `TowerChapters`, `TowerRitualSystem`, `SplitDirector`) on
 * all six storeys built from the questline's conditions. The walk never
 * writes a phase: every phase is reached by talking, examining, pressing,
 * standing on things and taking stairs, and every hand-over the director
 * asks for rebuilds the place it names. What the walk does stand in for is
 * the travel between fittings, the fights (a wave or the Warden is simply
 * struck down), a tin of tuna bought at the store, and the cutscenes' own
 * staging, whose endings it plays one frame after they are asked for.
 *
 * Checks, each with a `--fault=` that breaks the behaviour it guards:
 *
 * - reachable: every phase is entered, in order, by the quest's own moves
 *   (`notice-board-ignored`);
 * - rebuild: every phase stands up again in a place rebuilt from its record
 *   without moving on, splitting where it must and handing nothing over
 *   (`captured-stays-whole`);
 * - save: every phase's record, captured by the real floor scene's save and
 *   read back by the save parser, survives whole, split, exchange and all,
 *   and stands up again from what was read (`save-loses-exchange`);
 * - resume: every save a split writes holds the chapter about to start, and
 *   loading it lands on that chapter's own opening place (`chapter-start-ignored`);
 *   the floor scene, rebuilt from a save written indoors mid-split, moves the
 *   party to the live group, from one written on the street mid-split leaves
 *   it there, and from one written in the tower with the party together stands
 *   it where the reunion, the fight or the aftermath is (`street-save-pulled-indoors`);
 * - whole: a party found whole in any phase of the split (the `sewer` preset)
 *   is split as that phase plays it, and every questline preset boots into a
 *   scene that plays on (`captured-stays-whole`);
 * - stairs: while split, the cattery's stair waits for the cellmate and the
 *   archive's for the key ring (`cattery-stair-unguarded`, `archive-stair-unguarded`);
 * - reunion: the save the reunion writes, loaded, does not play it again
 *   (`reunion-not-saved`);
 * - fight: the save written on reaching the Warden holds the ritual and
 *   resumes at the foot of the cattery stair (`fight-not-saved`);
 * - loan: Sydney's desk lends one hire free, once, from the elf's offer until
 *   the party is whole inside, and the loan ends with the Warden
 *   (`tower-loan-twice`, `tower-loan-outlives-warden`);
 * - conduit: the shut sluice turns the archive's wards from solid to
 *   pulsing (`archive-built-stale`);
 * - key ring: the ring sent down waits at the kitchen's dumbwaiter foot
 *   (`dumbwaiter-drops-key-ring`);
 * - tuna: the tuna sent up waits at the archive's hatch, and the cellmate
 *   takes a counterweight plate on the bell storey (`cellmate-unfed`);
 * - portcullis: the dropped counterweight raises the kitchen's portcullis,
 *   live and in every later build of the storey (`kitchen-built-shut`);
 * - no exit: completing adds no way off the floor (`completion-descends`);
 * - paid once: the rewards are paid once, however often the inn is
 *   rebuilt or reloaded from the last save afterwards (`complete-not-saved`);
 * - door: the tower's front door refuses in every phase (`door-opens-after-quest`);
 * - drain: the storm drain opens from `sewer` on and stays open (`grate-stays-shut`);
 * - cat senses: the scent trail outside the inn, and a ward line, turn Belle's
 *   sense cue on within her reach and off out of it; its turning on plays the
 *   cue sound and her bark, the first time in a run also the explainer, never
 *   oftener than its rearm, and waits out a busy moment rather than losing it
 *   (`cat-sense-cue-silent`, `cat-sense-unseen`).
 *
 * Run: npm run verify:missing-cats
 *      npx tsx scripts/verify-missing-cats.ts --fault=<name>   (must fail)
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { isRecord } from '../src/core/util/guards';
import { PlayerManager } from '../src/core/party/PlayerManager';
import {
  PARTY_GROUP_IDS,
  capturePartySplit,
  createPartySplitState,
  itemsWaitingAt,
  liveGroupOf,
  parsePartySplitSnapshot,
  presenceOf,
  restorePartySplit,
  withCompanionJoining,
  type PartyLocation,
  type PartySplitSnapshot,
  type PartySplitState,
} from '../src/core/party/partySplit';
import type { MercenaryTemplateId } from '../src/core/party/mercenaryTemplates';
import {
  MISSING_CATS_PHASES,
  captureMissingCatsProgress,
  createMissingCatsProgress,
  missingCatsProgressAt,
  parseMissingCatsProgressCheckpoint,
  phaseReached,
  restoreMissingCatsProgress,
  stormDrainOpenFor,
  towerLoanOffered,
  type MissingCatsPhase,
  type MissingCatsProgress,
  type MissingCatsProgressCheckpoint,
} from '../src/core/quests/missingCatsProgress';
import type { ResidentId } from '../src/core/state/residentIds';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import type { HumanPlayer } from '../src/creatures/HumanPlayer';
import { TheLich } from '../src/creatures/TheLich';
import { Conversation } from '../src/dialog/Conversation';
import { TOWER_DOOR_REFUSALS } from '../src/dialog/scripts/scenes/towerDoor';
import { level3 } from '../src/levels/level3';
import { STORM_DRAIN_ID, TOWN_TOWER_ID, type BuildingId } from '../src/map/buildingIds';
import { findPartyArrivalTiles } from '../src/map/findWalkableTile';
import { GameMap, TOWER_FLOOR_COUNT, TOWER_TOP_FLOOR } from '../src/map/GameMap';
import {
  CONVEYOR_PLACEMENTS,
  TOWER_DUMBWAITER_CONVEYOR_ID,
  plateSetsFor,
} from '../src/map/town/interiors/roomMechanisms';
import {
  ARCHIVE_FIXED_WARDS,
  ARCHIVE_KNOCKABLES,
  BELL_STOREY_PLATES,
  KITCHEN_PORTCULLIS_ID,
  LARDER_DOOR_TILE,
  TOWER_CATTERY_CAGES,
  TOWER_CISTERN_ARRIVAL_TILE,
  TOWER_DUMBWAITER,
  TOWER_KEY_RING_ITEM,
  WARD_CONDUIT_SLUICE_TILE,
  towerConditionsFor,
  towerStoreyAt,
  towerStoreyIndex,
  towerStoreyPlan,
  type TowerStoreyId,
} from '../src/map/town/interiors/townCenterTower';
import type { TilePoint } from '../src/map/town/townPlan';
import { mulberry32 } from '../src/sprites/person/rng';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps';
import { CatAllySystem } from '../src/systems/CatAllySystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { LodgeCellarDefence } from '../src/systems/missingCats/LodgeCellarDefence';
import { MissingCatsInteriorSystem } from '../src/systems/missingCats/MissingCatsInteriorSystem';
import { MISSING_CATS_QUEST_ID } from '../src/systems/missingCats/missingCatsPhase';
import { MissingCatsQuestSystem } from '../src/systems/missingCats/MissingCatsQuestSystem';
import { planStakeout } from '../src/systems/missingCats/rooftopThief';
import { MISSING_CATS_COMPLETION_COINS } from '../src/systems/missingCats/missingCatsRewards';
import {
  BELLE_CAGE_LOCATION,
  MISSING_CATS_CHAPTERS,
  missingCatsSplitUnderWay,
  towerStairLanding,
} from '../src/systems/missingCats/missingCatsSplit';
import { TowerChapters } from '../src/systems/missingCats/towerChapters';
import { missingCatsTowerResume } from '../src/systems/missingCats/towerResume';
import {
  sameMap,
  tileStoodOn,
  type PartyTransferRequest,
} from '../src/systems/partySplit/partyTransfer';
import { SplitDirector, currentChapter } from '../src/systems/partySplit/SplitDirector';
import { conveyorEndPoint, ConveyorSystem } from '../src/systems/roomMechanisms/conveyors';
import { RoomMechanisms } from '../src/systems/roomMechanisms/RoomMechanisms';
import { CAT_SENSE_REARM_MS, CatSenseCue } from '../src/systems/senses/CatSenseCue';
import { GameStats } from '../src/core/progression/GameStats';
import type { SoundId } from '../src/audio/sounds';
import {
  SenseLayer,
  type ScentTrail,
  type SenseId,
  type SenseSourceHandle,
  type SenseSources,
  type WardLine,
} from '../src/systems/senses/SenseLayer';
import { stormDrainRefusal } from '../src/systems/sewer/stormDrainGrate';
import { SpellSystem } from '../src/systems/SpellSystem';
import { STORE_ORDER_BOOK_ID } from '../src/systems/townReadables';
import { BellStoreyWorks } from '../src/systems/tower/bellStoreyWorks';
import { TUNA_TIN_ITEM } from '../src/systems/tower/kitchenWorks';
import { towerDoorRefusal, towerDoorStandingFor } from '../src/systems/tower/towerDoor';
import { TowerRitualSystem } from '../src/systems/tower/TowerRitualSystem';
import { TowerStoreysSystem } from '../src/systems/tower/TowerStoreysSystem';
import type { StairDirection } from '../src/systems/TowerStairSystem';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';
import { PLAYTEST_PRESETS, type PlaytestPreset } from '../src/dev/playtestPresets';
import { createMercenaryRoster, type MercenaryRoster } from '../src/core/party/MercenaryRoster';
import { parseGameProgress, stampGameProgress } from '../src/core/save/saveFormat';
import type { GameProgress } from '../src/auth/AuthClient';
import { snapPlayer } from '../src/core/save/PlayerSnapshot';
import { SPLIT_STAIR_REFUSALS } from '../src/dialog/scripts/scenes/missingCats';
import { doorstepOf, type BuildingEntry } from '../src/map/buildingEntry';
import {
  ARCHIVE_WARDS_BY_CONDUIT,
  KITCHEN_PORTCULLIS_PROPS,
} from '../src/map/town/interiors/townCenterTower';
import type { DungeonScene, SaveProgressInput } from '../src/scenes/DungeonScene';
import type { SaveParty } from '../src/scenes/interiorPartyRun';
import { sceneSetupFromSave } from '../src/scenes/resumeFromSave';
import { MercenaryGuildSystem } from '../src/systems/MercenaryGuildSystem';
import { MercenarySystem } from '../src/systems/MercenarySystem';
import { splitWholePartyIfOwed } from '../src/systems/missingCats/missingCatsSplit';
import { resumeLocationFor, savedIndoorsInFor } from '../src/systems/partySplit/splitResume';
import { installBrowserShim } from './browserShim';

installCanvasGlobals();
useDevPlayerIdentity();

/** Every random draw the questline's systems make comes from here, so a red run reproduces. */
const RANDOM_SEED = 20261029;
Math.random = mulberry32(RANDOM_SEED);

/** The floor-3 world the walk plays on: the seed the other headless scene harnesses use. */
const WORLD_SEED = 7;

// ── Faults ────────────────────────────────────────────────────────────────────

const FAULTS = [
  'notice-board-ignored',
  'captured-stays-whole',
  'save-loses-exchange',
  'chapter-start-ignored',
  'archive-built-stale',
  'dumbwaiter-drops-key-ring',
  'cellmate-unfed',
  'kitchen-built-shut',
  'completion-descends',
  'complete-not-saved',
  'door-opens-after-quest',
  'grate-stays-shut',
  'cattery-stair-unguarded',
  'archive-stair-unguarded',
  'reunion-not-saved',
  'fight-not-saved',
  'tower-loan-twice',
  'tower-loan-outlives-warden',
  'street-save-pulled-indoors',
  'cat-sense-cue-silent',
  'cat-sense-unseen',
] as const;
type Fault = (typeof FAULTS)[number];

const FAULT_FLAG = '--fault=';

function parseFault(): Fault | null {
  const flag = process.argv.find((arg) => arg.startsWith(FAULT_FLAG));
  if (flag === undefined) return null;
  const name = flag.slice(FAULT_FLAG.length);
  const fault = FAULTS.find((candidate) => candidate === name);
  if (fault === undefined) {
    console.error(`unknown fault "${name}"; known: ${FAULTS.join(', ')}`);
    process.exit(2);
  }
  return fault;
}

const FAULT = parseFault();

const failures: string[] = [];
let checks = 0;

function check(label: string, condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  const line = `FAIL [${label}] ${message}`;
  failures.push(line);
  console.error(line);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Replaces a method on a class's prototype, private ones included, for a fault that breaks it. */
function breakMethod(prototype: object, name: string, replacement: unknown): void {
  if (typeof Reflect.get(prototype, name) !== 'function') {
    throw new Error(`no method "${name}" to break`);
  }
  if (typeof replacement !== 'function') throw new Error(`no replacement for "${name}"`);
  Reflect.set(prototype, name, replacement);
}

/** A prototype's own method, private ones included, to call from a fault that wraps it. */
function methodOf(prototype: object, name: string): (...args: unknown[]) => unknown {
  const method: unknown = Reflect.get(prototype, name);
  if (typeof method !== 'function') throw new Error(`no method "${name}" to wrap`);
  return (...args) => {
    const result: unknown = Reflect.apply(method, args[0], args.slice(ONE));
    return result;
  };
}

/**
 * Breaks a method so that one of the hooks it was built with does nothing for
 * the length of the call: the method's own call to that hook is what is lost.
 */
function muteHookDuring(prototype: object, method: string, hook: string): void {
  const original = methodOf(prototype, method);
  breakMethod(prototype, method, function (this: object, ...args: unknown[]) {
    const deps: unknown = Reflect.get(this, 'deps');
    if (!isRecord(deps) || typeof deps[hook] !== 'function') {
      throw new Error(`${method} has no ${hook} hook to mute`);
    }
    const kept: unknown = deps[hook];
    Reflect.set(deps, hook, () => undefined);
    try {
      return original(this, ...args);
    } finally {
      Reflect.set(deps, hook, kept);
    }
  });
}

/** Breaks the split's stair rule so that `refusal` is never given. */
function dropStairRefusal(refusal: string): void {
  const original = methodOf(TowerChapters.prototype, 'stairRefusal');
  breakMethod(TowerChapters.prototype, 'stairRefusal', function (this: object, going: unknown) {
    const given = original(this, going);
    return given === refusal ? null : given;
  });
}

// ── Pacing ────────────────────────────────────────────────────────────────────

/** Long enough for any single beat the walk waits on: a chapter's hold, a cutscene, a wave. */
const BEAT_FRAMES = 2000;
/** Three waves up the cellar lid, each struck down as it stands up, and the gaps between. */
const CELLAR_FRAMES = 6000;
/** The stakeout and the chase run on the thief's own long clocks. */
const THIEF_FRAMES = 30000;
/** A cage latch only gives while the keeper's back is turned, over several rounds. */
const LATCH_FRAMES = 20000;
/** Frames between latch jostles, so one lands in every turn of the keeper's round. */
const LATCH_PRESS_GAP_FRAMES = 12;
/** After a jostle is seen: the keeper's stare, and the rest of its look over the room. */
const KEEPER_WAIT_FRAMES = 420;
/** Frames between hauls on the sluice's wheel. */
const SLUICE_PRESS_GAP_FRAMES = 4;
const SLUICE_PRESS_LIMIT = 40;
/** How long a rebuilt place is left to run on its own before it is judged. */
const REBUILD_SETTLE_FRAMES = 90;
/** How long the archive's wards are watched for a pulse. */
const PULSE_WATCH_FRAMES = 900;
/** Pages and choices a conversation is given to close. */
const CONVERSATION_STEP_LIMIT = 400;
/** The number key that answers Aviel's choice: the second, keeping his secret. */
const AVIEL_CHOICE_KEY = '2';
/** How far round a fitting the walk looks for a tile to work it from. */
const REACH_SEARCH_TILES = 3;
const ONE = 1;

// ── The floor ─────────────────────────────────────────────────────────────────

const TOWN_MAP = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});

function townEntry(id: BuildingId): BuildingEntry {
  const entry = TOWN_MAP.buildingEntries.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`the floor-3 town has no ${id}`);
  return entry;
}

const INN: BuildingId = 'taloncrest_inn';
const COTTAGE: BuildingId = 'taloncrest_old_lady_cottage';
const APOTHECARY: BuildingId = 'taloncrest_apothecary';
const STORE: BuildingId = 'taloncrest_general_store';
const MILL: BuildingId = 'taloncrest_mill_farm';
const LODGE: BuildingId = 'taloncrest_garrison_lodge';
const TEMPLE: BuildingId = 'taloncrest_temple';

const HIRE: MercenaryTemplateId = 'crush';

const STOREY = {
  cistern: towerStoreyIndex('cistern'),
  gatehouse: towerStoreyIndex('gatehouse'),
  kitchen: towerStoreyIndex('kitchen'),
  bell_storey: towerStoreyIndex('bell_storey'),
  archive: towerStoreyIndex('archive'),
  cattery: towerStoreyIndex('cattery'),
} as const;

const DUMBWAITER_FOOT = conveyorEndPoint(TOWER_DUMBWAITER_CONVEYOR_ID, 'foot');
const DUMBWAITER_HEAD = conveyorEndPoint(TOWER_DUMBWAITER_CONVEYOR_ID, 'head');

// ── Places ────────────────────────────────────────────────────────────────────

/** Where a scene stands: the street, a one-room building, or a storey of the tower. */
type Place =
  | { readonly kind: 'overworld'; readonly tile: TilePoint }
  | { readonly kind: 'room'; readonly building: BuildingId }
  | { readonly kind: 'tower'; readonly storey: number; readonly tile: TilePoint };

function placeOf(location: PartyLocation): Place {
  switch (location.kind) {
    case 'overworld':
      return { kind: 'overworld', tile: location.tile };
    case 'interior':
      return location.building === TOWN_TOWER_ID
        ? { kind: 'tower', storey: location.storey, tile: location.tile }
        : { kind: 'room', building: location.building };
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function describePlace(place: Place): string {
  switch (place.kind) {
    case 'overworld':
      return `the street at ${place.tile.x},${place.tile.y}`;
    case 'room':
      return place.building;
    case 'tower':
      return `tower storey ${place.storey} at ${place.tile.x},${place.tile.y}`;
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

function sameLocation(a: PartyLocation, b: PartyLocation): boolean {
  if (!sameMap(a, b)) return false;
  return a.tile.x === b.tile.x && a.tile.y === b.tile.y;
}

function describeLocation(location: PartyLocation): string {
  return describePlace(placeOf(location));
}

// ── Saves ─────────────────────────────────────────────────────────────────────

/** What a save holds of the questline and the party, before it is written as text. */
interface RunRecord {
  readonly missingCats: MissingCatsProgressCheckpoint;
  readonly partySplit: PartySplitSnapshot;
}

function recordOf(progress: MissingCatsProgress, split: PartySplitState): RunRecord {
  return {
    missingCats: captureMissingCatsProgress(progress),
    partySplit: capturePartySplit(split),
  };
}

/** The record as a save writes it. */
function writeSave(record: RunRecord): string {
  return JSON.stringify(record);
}

/** A save read back through the game's own parsers; null when they refuse it. */
function readSave(text: string): RunRecord | null {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) return null;
  const missingCats = parseMissingCatsProgressCheckpoint(value.missingCats);
  const partySplit = parsePartySplitSnapshot(value.partySplit);
  if (missingCats === undefined || partySplit === undefined) return null;
  return { missingCats, partySplit };
}

/** The record's text with nothing a save would drop: what equality is judged on. */
function recordText(record: RunRecord): string {
  return JSON.stringify(record);
}

interface PhaseSnapshot {
  readonly phase: MissingCatsPhase;
  readonly record: RunRecord;
  readonly place: Place;
}

interface DirectorSave {
  readonly text: string;
  readonly chapterStart: PartyLocation;
}

// ── The run ───────────────────────────────────────────────────────────────────

/** Everything that outlives a scene: the questline, the split, the two crawlers and what was written down. */
class Run {
  readonly progress: MissingCatsProgress;
  readonly split: PartySplitState;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly hire: MercenaryTemplateId | null = HIRE;
  readonly transfers: PartyTransferRequest[] = [];
  readonly directorSaves: DirectorSave[] = [];
  readonly entered: MissingCatsPhase[] = [];
  readonly snapshots = new Map<MissingCatsPhase, PhaseSnapshot>();
  readonly rewardsShown: string[] = [];
  readonly floorEnds: string[] = [];
  questCompletions = 0;
  saveCount = 0;
  /** The last save the scenes wrote, as text: what a reload or a death comes back to. */
  lastSave: string | null = null;
  private readonly eager = new Map<MissingCatsPhase, RunRecord>();
  private readonly pending: MissingCatsPhase[] = [];

  constructor(record: RunRecord | null) {
    this.progress = createMissingCatsProgress();
    this.split = createPartySplitState();
    if (record !== null) {
      restoreMissingCatsProgress(this.progress, record.missingCats);
      restorePartySplit(this.split, record.partySplit);
    }
    const start = TOWN_MAP.startTile;
    const party = new PlayerManager(start.x, start.y, undefined);
    this.human = party.human;
    this.cat = party.cat;
    this.entered.push(this.progress.phase);
  }

  get record(): RunRecord {
    return recordOf(this.progress, this.split);
  }

  save(): void {
    this.saveCount++;
    this.lastSave = writeSave(this.record);
  }

  saveForChapter(chapterStart: PartyLocation): void {
    this.save();
    this.directorSaves.push({ text: writeSave(this.record), chapterStart });
  }

  listen(bus: EventBus): void {
    const notePhase = (): void => this.notePhase();
    bus.on('questStarted', ({ questId }) => {
      if (questId === MISSING_CATS_QUEST_ID) notePhase();
    });
    bus.on('objectiveComplete', ({ objectiveId }) => {
      if (objectiveId.startsWith(`${MISSING_CATS_QUEST_ID}:`)) notePhase();
    });
    bus.on('questCompleted', ({ questId }) => {
      if (questId !== MISSING_CATS_QUEST_ID) return;
      this.questCompletions++;
      notePhase();
      if (FAULT === 'completion-descends') Reflect.set(level3, 'nextLevelId', 'level1');
    });
    bus.on('questRewardShown', (spec) => this.rewardsShown.push(spec.questTitle));
    bus.on('levelComplete', () => this.floorEnds.push('levelComplete'));
  }

  private notePhase(): void {
    const phase = this.progress.phase;
    if (this.entered[this.entered.length - 1] === phase) return;
    this.entered.push(phase);
    this.eager.set(phase, this.record);
    this.pending.push(phase);
  }

  /**
   * Once a frame is over: each phase entered during it is recorded as the
   * frame left it, at the place the party is now headed, unless the frame
   * already moved past it, when it is recorded as it stood when entered.
   */
  settle(here: Place, transfersBefore: number): void {
    const headedTo =
      this.transfers.length > transfersBefore ? (lastOf(this.transfers)?.to ?? null) : null;
    const place = headedTo === null ? here : placeOf(headedTo);
    for (const phase of this.pending.splice(0)) {
      const settled = this.progress.phase === phase;
      const record = settled ? this.record : this.eager.get(phase);
      if (record === undefined) continue;
      this.snapshots.set(phase, { phase, record, place: settled ? place : here });
    }
  }
}

// ── Shared scene parts ────────────────────────────────────────────────────────

/** Pages through an open conversation one step a frame, answering any choice with `choiceKey`. */
function stepConversation(conversation: Conversation, choiceKey: string): void {
  if (!conversation.isOpen) return;
  conversation.update(null);
  if (conversation.isShowingChoices) {
    conversation.handleKeyDown(choiceKey);
    return;
  }
  conversation.advance();
}

/**
 * The scene's cutscene director, as far as the questline can tell: a script
 * is taken, and its ending runs the next frame. The staging (walks, cues,
 * shown and hidden actors) is the director's own business and is checked
 * elsewhere.
 */
class CutsceneStandIn {
  private readonly endings: (() => void)[] = [];

  play(_script: unknown, onComplete: () => void): void {
    this.endings.push(onComplete);
  }

  get busy(): boolean {
    return this.endings.length > 0;
  }

  flush(): void {
    for (const ending of this.endings.splice(0)) ending();
  }
}

function isScentTrail(value: unknown): value is ScentTrail {
  return isRecord(value) && Array.isArray(value.points) && Array.isArray(value.sniffAt);
}

function isWardLine(value: unknown): value is WardLine {
  return isRecord(value) && Array.isArray(value.segments) && typeof value.pulse === 'function';
}

/** The scene's sense layer, keeping hold of what is laid on it so the walk can follow a trail or read a ward. */
class RecordingSenses extends SenseLayer {
  readonly scentTrails: ScentTrail[] = [];
  readonly wardLines: WardLine[] = [];

  override add<S extends SenseId>(sense: S, source: SenseSources[S]): SenseSourceHandle {
    if (isScentTrail(source)) this.scentTrails.push(source);
    if (isWardLine(source)) this.wardLines.push(source);
    return super.add(sense, source);
  }
}

function standOn(body: { x: number; y: number }, tile: TilePoint): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

function firstOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[0];
}

/** Tiles within `radius` of `around`, nearest first. */
function tilesAround(around: TilePoint, radius: number): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) tiles.push({ x: around.x + dx, y: around.y + dy });
  }
  return tiles.sort(
    (a, b) =>
      Math.hypot(a.x - around.x, a.y - around.y) - Math.hypot(b.x - around.x, b.y - around.y),
  );
}

interface Rig {
  readonly bus: EventBus;
  readonly pm: PlayerManager;
  here(): Place;
  tick(): void;
  dispose(): void;
}

function partyOn(run: Run, map: GameMap, at: TilePoint): PlayerManager {
  const pm = new PlayerManager(at.x, at.y, undefined, { human: run.human, cat: run.cat });
  pm.bindPartySplit(run.split);
  pm.steerLiveGroup();
  pm.setPartyDown(findPartyArrivalTiles(map, at));
  return pm;
}

// ── The street ────────────────────────────────────────────────────────────────

class TownRig implements Rig {
  readonly bus = new EventBus();
  readonly conversation = new Conversation(null);
  readonly senses = new RecordingSenses();
  readonly cutscenes = new CutsceneStandIn();
  readonly pm: PlayerManager;
  readonly director: SplitDirector;
  readonly quest: MissingCatsQuestSystem;

  constructor(run: Run, at: TilePoint) {
    run.listen(this.bus);
    this.pm = partyOn(run, TOWN_MAP, at);
    this.director = makeDirector(run, this.pm, () => ({
      kind: 'overworld',
      tile: tileStoodOn(this.pm.active()),
    }));
    this.quest = new MissingCatsQuestSystem({
      map: TOWN_MAP,
      bus: this.bus,
      progress: run.progress,
      conversation: this.conversation,
      audio: null,
      music: null,
      loops: null,
      human: run.human,
      cat: run.cat,
      steered: () => this.pm.active(),
      present: () => this.pm.presentCrawlers(),
      announce: () => undefined,
      noticeBoardTile: () => null,
      noticeBoardOpen: () => false,
      save: () => run.save(),
      senses: this.senses,
      playCutscene: (script, onComplete) => this.cutscenes.play(script, onComplete),
      cutsceneHides: () => false,
      split: this.director,
      hire: () => run.hire,
    });
  }

  here(): Place {
    return { kind: 'overworld', tile: tileStoodOn(this.pm.active()) };
  }

  tick(): void {
    this.cutscenes.flush();
    stepConversation(this.conversation, AVIEL_CHOICE_KEY);
    this.quest.update();
  }

  dispose(): void {
    this.quest.dispose();
  }
}

/** The director a scene builds, with the scene's save and transfer written down instead of carried out. */
function makeDirector(run: Run, pm: PlayerManager, here: () => PartyLocation): SplitDirector {
  return new SplitDirector({
    state: run.split,
    locateLiveGroup: here,
    save: (chapterStart) => run.saveForChapter(chapterStart),
    transfer: (request) => run.transfers.push(request),
    onFormationChanged: () => pm.steerLiveGroup(),
  });
}

// ── A room ────────────────────────────────────────────────────────────────────

class RoomRig implements Rig {
  readonly bus = new EventBus();
  readonly conversation = new Conversation(null);
  readonly cutscenes = new CutsceneStandIn();
  readonly map: GameMap;
  readonly pm: PlayerManager;
  readonly roster: MobRoster;
  readonly interior: MissingCatsInteriorSystem;
  private defence: LodgeCellarDefence | null = null;

  constructor(
    private readonly run: Run,
    readonly building: BuildingId,
  ) {
    run.listen(this.bus);
    const entry = townEntry(building);
    this.map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
    this.map.generateInterior(entry.type, 0, entry.id, entry.hasSafeRoom === true);
    this.pm = partyOn(run, this.map, this.map.startTile);
    this.roster = new MobRoster(this.map, new SpellSystem());
    const interior = MissingCatsInteriorSystem.forBuilding(0, {
      buildingId: building,
      map: this.map,
      progress: run.progress,
      bus: this.bus,
      conversation: this.conversation,
      human: run.human,
      cat: run.cat,
      audio: null,
      speechStyleOf: () => null,
      startCellarDefence: () => this.raiseCellarDefence(),
      daveTalking: () => false,
      readingOpen: () => false,
      onItemGranted: () => undefined,
      playCutscene: (script, onComplete) => this.cutscenes.play(script, onComplete),
      reunionReady: () => !this.cutscenes.busy && !this.conversation.isOpen,
      daveHome: () => this.map.startTile,
      pinnedTrackerId: () => MISSING_CATS_QUEST_ID,
      readableNamed: () => null,
      music: null,
      save: () => run.save(),
    });
    if (interior === null) throw new Error(`no questline system in ${building}`);
    this.interior = interior;
    if (interior.cellarDefenceOwedOnEntry) this.raiseCellarDefence();
  }

  private raiseCellarDefence(): void {
    const lid = this.map.placedInteriorProps.find((placed) => placed.propId === 'cellar_trapdoor');
    if (lid === undefined) throw new Error(`${this.building} has no cellar lid`);
    if (this.defence !== null) return;
    this.defence = new LodgeCellarDefence({
      map: this.map,
      progress: this.run.progress,
      addMob: (mob) => this.roster.add(mob),
      partyLevel: this.run.human.level,
      owner: this.run.human,
      lid: lid.tile,
      audio: null,
      onHeld: () => this.interior.cellarHeld(),
    });
  }

  here(): Place {
    return { kind: 'room', building: this.building };
  }

  /** Every hostile in the room struck down: the party winning whatever fight it is in. */
  winTheFight(): void {
    for (const mob of this.roster.mobs) if (mob.isHostileTarget) mob.hp = 0;
  }

  tick(): void {
    this.cutscenes.flush();
    stepConversation(this.conversation, AVIEL_CHOICE_KEY);
    if (this.interior.daveRefusalOwed && !this.conversation.isOpen) this.interior.daveRefused();
    this.interior.update();
    this.defence?.update(roomContext(this.pm, this.roster, this.map));
  }

  /** Stands the steered crawler on each tile of the room in turn until an interact press there is taken. */
  interactSomewhere(): boolean {
    const active = this.pm.active();
    const height = this.map.structure.length;
    const width = this.map.structure[0]?.length ?? 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!this.map.isWalkable(x, y, 'walker')) continue;
        standOn(active, { x, y });
        if (this.interior.tryInteract(active)) return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.interior.dispose();
  }
}

function roomContext(pm: PlayerManager, roster: MobRoster, map: GameMap): SystemContext {
  return {
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    partner: pm.presentPartner(),
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
}

// ── The tower ─────────────────────────────────────────────────────────────────

interface TowerFloor {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly mechanisms: RoomMechanisms;
  readonly senses: RecordingSenses;
}

class TowerRig implements Rig {
  readonly bus = new EventBus();
  readonly conversation = new Conversation(null);
  readonly cutscenes = new CutsceneStandIn();
  readonly floors: TowerFloor[] = [];
  readonly pm: PlayerManager;
  readonly director: SplitDirector;
  readonly cellmate: CatAllySystem;
  readonly cellmateOrders: string[] = [];
  readonly storeys: TowerStoreysSystem;
  storey: number;
  /** Frames the storey has been on screen: none while its arrival card is up, on the frame it is built. */
  private framesShown = 0;

  constructor(
    private readonly run: Run,
    storey: number,
    at: TilePoint,
  ) {
    run.listen(this.bus);
    const conditions = towerConditionsFor(run.progress);
    const spells = new SpellSystem();
    for (let index = 0; index < TOWER_FLOOR_COUNT; index++) {
      const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
      map.generateInterior('tower', index, TOWN_TOWER_ID, false, { kind: 'tower', conditions });
      this.floors.push({
        map,
        roster: new MobRoster(map, spells),
        mechanisms: new RoomMechanisms({
          map,
          place: { building: TOWN_TOWER_ID, storey: index },
          plateSets: plateSetsFor(TOWN_TOWER_ID, index),
          conveyors: CONVEYOR_PLACEMENTS,
          split: run.split,
          bus: this.bus,
          shatter: () => false,
          playSound: () => undefined,
        }),
        senses: new RecordingSenses(),
      });
    }
    this.storey = storey;
    this.pm = partyOn(run, this.map, at);
    this.director = makeDirector(run, this.pm, () => this.location());
    const cellmate = new CatAllySystem(
      'tower_cattery_cellmate',
      presenceOf(() => this.pm.formation),
    );
    this.cellmate = cellmate;
    cellmate.followCrawler('cat');
    const { progress } = run;
    if (progress.cellmateFreed && !phaseReached(progress, 'aftermath') && !run.cat.isAway) {
      cellmate.bringOut(run.cat, this.map, this.floor.roster);
    }
    const cattery = this.floors[TOWER_TOP_FLOOR];
    const ritual = new TowerRitualSystem({
      map: cattery.map,
      bus: this.bus,
      addMob: (mob) => cattery.roster.add(mob),
      progress,
      conditions,
      audio: null,
      music: null,
      companion: null,
      conversation: this.conversation,
      partyLevel: () => run.human.level,
      saveBeforeFight: () => run.save(),
      onWardenFallen: () => run.save(),
    });
    const chapters = new TowerChapters({
      director: this.director,
      progress,
      bus: this.bus,
      formation: () => this.pm.formation,
      currentStorey: () => this.storey,
      playCutscene: (script, onComplete) => this.cutscenes.play(script, onComplete),
      sceneBusy: () => this.cutscenes.busy || this.conversation.isOpen,
      roomShown: () => this.framesShown > 0,
      saveNow: () => run.save(),
      here: () => this.location(),
      transferParty: (request) => run.transfers.push(request),
      audio: null,
      music: null,
    });
    this.storeys = new TowerStoreysSystem({
      storeys: this.floors.map((floor) => floor.map),
      progress,
      conditions,
      difficulty: 'normal',
      currentStorey: () => this.storey,
      addMob: (index, mob) => this.floors[index].roster.add(mob),
      bus: this.bus,
      split: run.split,
      sensesOf: (index) => this.floors[index].senses,
      mechanismsOf: (index) => this.floors[index].mechanisms,
      cellmate: {
        body: () => cellmate.body,
        bringOut: (tile) => {
          const body = cellmate.bringOut(run.cat, cattery.map, cattery.roster);
          if (body === null) return null;
          standOn(body, tile);
          return body;
        },
        joinCat: () => {
          cellmate.followCrawler('cat');
          const formation = run.split.formation;
          if (formation.kind !== 'split') return;
          const catGroup = PARTY_GROUP_IDS.find((id) =>
            formation.groups[id].crawlers.includes('cat'),
          );
          if (catGroup === undefined) return;
          run.split.formation = withCompanionJoining(formation, catGroup, cellmate.companionRef);
        },
        order: (directive) => {
          if (directive === null) {
            cellmate.clearDirective();
            return;
          }
          cellmate.setDirective(directive);
          this.cellmateOrders.push(`${directive.x},${directive.y}`);
          const body = cellmate.body;
          if (body !== null) {
            body.x = directive.x;
            body.y = directive.y;
          }
        },
      },
      audio: null,
      presentCrawlers: () => this.pm.presentCrawlers(),
      setPartyDown: (tile) => this.pm.setPartyDown(findPartyArrivalTiles(this.map, tile)),
      toast: () => undefined,
      heardOffScreen: () => undefined,
      ritual,
      cellmateAlly: cellmate,
      chapters,
    });
  }

  get floor(): TowerFloor {
    return this.floors[this.storey];
  }

  get map(): GameMap {
    return this.floor.map;
  }

  location(): PartyLocation {
    return {
      kind: 'interior',
      building: TOWN_TOWER_ID,
      storey: this.storey,
      tile: tileStoodOn(this.pm.active()),
    };
  }

  here(): Place {
    return { kind: 'tower', storey: this.storey, tile: tileStoodOn(this.pm.active()) };
  }

  context(): SystemContext {
    const body = this.cellmate.body;
    return {
      ...roomContext(this.pm, this.floor.roster, this.map),
      extraTargets: body === null ? [] : [body],
    };
  }

  tick(): void {
    this.cutscenes.flush();
    stepConversation(this.conversation, AVIEL_CHOICE_KEY);
    const ctx = this.context();
    this.splitIfOwed();
    this.floor.mechanisms.update(ctx);
    this.storeys.update(ctx);
    this.framesShown++;
  }

  /** As the scene does each frame: a party found whole mid-split is split as the phase plays it. */
  private splitIfOwed(): void {
    const formed = splitWholePartyIfOwed(this.director, this.run.progress, {
      here: this.location(),
      street: doorstepOf(townEntry(TOWN_TOWER_ID)),
      hire: this.run.hire,
    });
    if (formed !== null && !formed.ok) throw new Error(`no split formed: ${formed.reason}`);
  }

  /** An interact press from the steered crawler, offered to the storey's works and then its fittings. */
  interact(): boolean {
    const ctx = this.context();
    if (this.storeys.tryInteract(ctx)) return true;
    return this.floor.mechanisms.tryInteract(this.pm.active());
  }

  /** Takes the stair `going`, as the stair system would: refused, or onto the next storey's landing. */
  takeStair(going: StairDirection): string | null {
    const refusal = this.storeys.stairRefusal(going);
    if (refusal !== null) return refusal;
    const ctx = this.context();
    this.storeys.leaveFloor(ctx);
    const body = this.cellmate.body;
    if (body !== null) this.cellmate.putAway(this.floor.roster.mobs, this.floor.roster.grid);
    const from = this.storey;
    this.storey = going === 'up' ? from + ONE : from - ONE;
    const arrivalStair = going === 'up' ? 'stairDown' : 'stairUp';
    const landing = towerStairLanding(storeyIdAt(this.storey), arrivalStair);
    this.pm.setPartyDown(findPartyArrivalTiles(this.map, landing));
    if (body !== null) this.cellmate.bringOut(this.run.cat, this.map, this.floor.roster);
    return null;
  }

  dispose(): void {
    this.storeys.dispose();
  }
}

function storeyIdAt(index: number): TowerStoreyId {
  const id = towerStoreyAt(index);
  if (id === null) throw new Error(`no tower storey ${index}`);
  return id;
}

function rigAt(run: Run, place: Place): Rig {
  switch (place.kind) {
    case 'overworld':
      return new TownRig(run, place.tile);
    case 'room':
      return new RoomRig(run, place.building);
    case 'tower':
      return new TowerRig(run, place.storey, place.tile);
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

// ── Walking ───────────────────────────────────────────────────────────────────

/** Where the walk is and the run it is walking. */
class Walk {
  readonly run = new Run(null);
  private rig: Rig;
  stalled: string | null = null;

  constructor() {
    this.rig = new TownRig(this.run, TOWN_MAP.startTile);
    this.run.snapshots.set('not_started', {
      phase: 'not_started',
      record: this.run.record,
      place: this.rig.here(),
    });
  }

  get progress(): MissingCatsProgress {
    return this.run.progress;
  }

  tick(): void {
    const before = this.run.transfers.length;
    this.rig.tick();
    this.run.settle(this.rig.here(), before);
  }

  /** Ticks until `done`, or `limit` frames; returns whether it came. */
  until(done: () => boolean, limit = BEAT_FRAMES): boolean {
    for (let frame = 0; frame < limit; frame++) {
      if (done()) return true;
      this.tick();
    }
    return done();
  }

  /** Does `act` once and runs the frames after it until any conversation it opened is closed. */
  act<R>(act: () => R): R {
    const result = act();
    this.settleTalk();
    return result;
  }

  settleTalk(): void {
    const conversation = this.conversationOf(this.rig);
    for (let step = 0; step < CONVERSATION_STEP_LIMIT; step++) {
      if (!conversation.isOpen && !this.cutscenesBusy()) return;
      this.tick();
    }
  }

  private conversationOf(rig: Rig): Conversation {
    if (rig instanceof TownRig || rig instanceof RoomRig || rig instanceof TowerRig) {
      return rig.conversation;
    }
    throw new Error('a rig with no conversation');
  }

  private cutscenesBusy(): boolean {
    const rig = this.rig;
    if (rig instanceof TownRig || rig instanceof RoomRig || rig instanceof TowerRig) {
      return rig.cutscenes.busy;
    }
    return false;
  }

  /** Goes to `place`, as a door or a hand-over would: the scene there is built fresh. */
  goTo(place: Place): void {
    this.rig.dispose();
    this.rig = rigAt(this.run, place);
  }

  /** Follows the last transfer asked for since `before`; false when none was. */
  followTransfer(before: number): boolean {
    if (this.run.transfers.length <= before) return false;
    const request = lastOf(this.run.transfers);
    if (request === undefined) return false;
    this.goTo(placeOf(request.to));
    return true;
  }

  town(): TownRig {
    if (!(this.rig instanceof TownRig)) throw new Error('the walk is not on the street');
    return this.rig;
  }

  room(building: BuildingId): RoomRig {
    const rig = this.rig;
    if (rig instanceof RoomRig && rig.building === building) return rig;
    this.goTo({ kind: 'room', building });
    const fresh = this.rig;
    if (!(fresh instanceof RoomRig)) throw new Error(`no room rig for ${building}`);
    return fresh;
  }

  street(at: TilePoint = TOWN_MAP.startTile): TownRig {
    if (this.rig instanceof TownRig) return this.rig;
    this.goTo({ kind: 'overworld', tile: at });
    return this.town();
  }

  tower(): TowerRig {
    if (!(this.rig instanceof TowerRig)) throw new Error('the walk is not in the tower');
    return this.rig;
  }

  /** Records a step that did not happen, and stops the walk there. */
  expect(condition: boolean, message: string): boolean {
    if (condition) return true;
    this.stalled ??= `${message} (questline at ${this.progress.phase})`;
    return false;
  }

  /** Steers `kind` on the street, while the party is still whole and can switch. */
  steer(kind: 'human' | 'cat'): void {
    const rig = this.rig;
    if (!(rig instanceof TownRig)) return;
    if (rig.pm.active().crawlerKind !== kind) rig.pm.switchActive();
  }
}

/** Checks judged on what the walk saw at a moment, run once the walk is over. */
const flagChecks: Array<() => void> = [];

/** Where the walk saw the director set the party down together once the split was over. */
const walkPlaces: { regrouped: PartyLocation | null } = { regrouped: null };

/** The landing in front of a storey's stair, as the walk's own stairs set a party down on it. */
function towerStairPlace(storey: TowerStoreyId, stair: 'stairUp' | 'stairDown'): PartyLocation {
  return {
    kind: 'interior',
    building: TOWN_TOWER_ID,
    storey: STOREY[storey],
    tile: towerStairLanding(storey, stair),
  };
}

/** A save the walk wrote in the tower with the party together, and where loading it must stand them. */
interface TowerResumeCase {
  readonly label: string;
  readonly save: string | null;
  readonly phase: MissingCatsPhase;
  readonly expectedAt: PartyLocation | null;
}

const towerResumes: TowerResumeCase[] = [];

function walkTheQuestline(walk: Walk): void {
  const steps: Array<() => boolean> = [
    () => hearTheInnkeeper(walk),
    () => readTheNotices(walk),
    () => askTheOwners(walk),
    () => followTheScent(walk),
    () => holdTheCellar(walk),
    () => watchTheStore(walk),
    () => followTheThief(walk),
    () => showAvielTheFeather(walk),
    () => layTheBait(walk),
    () => workTheCattery(walk),
    () => findAWayIn(walk),
    () => shutTheSluice(walk),
    () => sendTheKeyRing(walk),
    () => sendTheTuna(walk),
    () => dropTheCounterweight(walk),
    () => meetAgain(walk),
    () => climbToTheWarden(walk),
    () => bringPumpkinHome(walk),
  ];
  for (const step of steps) if (!step()) return;
}

function hearTheInnkeeper(walk: Walk): boolean {
  const inn = walk.room(INN);
  walk.act(() => inn.interior.tryOpenDialog('innkeep_ossie', walk.run.human));
  return walk.expect(walk.progress.phase === 'posters_up', 'the innkeeper never told the party');
}

function readTheNotices(walk: Walk): boolean {
  const town = walk.street();
  walk.act(() => town.quest.onNoticeBoardRead());
  return walk.expect(walk.progress.phase === 'investigating', 'reading the board started nothing');
}

const OWNER_VISITS: ReadonlyArray<{ readonly building: BuildingId; readonly owner: ResidentId }> = [
  { building: COTTAGE, owner: 'old_lori' },
  { building: APOTHECARY, owner: 'taloncrest_apothecary_assistant' },
  { building: MILL, owner: 'marta_miller' },
];

function askTheOwners(walk: Walk): boolean {
  for (const { building, owner } of OWNER_VISITS) {
    const room = walk.room(building);
    walk.act(() => room.interior.tryOpenDialog(owner, walk.run.human));
    const found = walk.act(() => room.interactSomewhere());
    if (!walk.expect(found, `nothing in ${building} could be examined`)) return false;
    if (building === APOTHECARY) {
      const store = walk.room(STORE);
      walk.act(() => store.interior.onReadableOpened(STORE_ORDER_BOOK_ID));
      walk.until(() => !store.conversation.isOpen && walk.progress.clues.has('store_tuna_ledger'));
    }
  }
  return walk.expect(walk.progress.clues.size > 0, 'no owner gave anything up');
}

function followTheScent(walk: Walk): boolean {
  const town = walk.street();
  walk.steer('cat');
  walk.tick();
  const trail = lastOf(town.senses.scentTrails);
  if (trail === undefined) return walk.expect(false, 'no scent trail was laid outside the inn');
  checkCatSenseCue(town.senses, trail, walk.run.cat, walk.run.human);
  const end = lastOf(trail.points);
  if (end === undefined) return walk.expect(false, 'the scent trail has no end');
  const cat = walk.run.cat;
  cat.x = end.x - TILE_SIZE / 2;
  cat.y = end.y - TILE_SIZE / 2;
  walk.tick();
  walk.settleTalk();
  walk.steer('human');
  return walk.expect(walk.progress.phase === 'blame', 'the clues are in and nobody blamed anyone');
}

/** Far enough from any sense that Belle's cue stays off, in tiles. */
const CAT_SENSE_FAR_TILES = 40;
/** One frame's step on the cue's clock. */
const CAT_SENSE_FRAME_MS = 16;

/** A cue built over recording stand-ins for the scene's barks, audio and stats. */
function recordingCatSenseCue(): {
  readonly cue: CatSenseCue;
  readonly played: SoundId[];
  readonly said: string[];
  readonly conversation: Conversation;
  readonly stats: GameStats;
} {
  const played: SoundId[] = [];
  const said: string[] = [];
  const conversation = new Conversation(null);
  const stats = new GameStats();
  const cue = new CatSenseCue({
    barks: { say: (_crawler, lines) => said.push(...lines) },
    audio: { playRandom: (ids) => played.push(...ids.slice(0, 1)) },
    conversation,
    stats,
  });
  return { cue, played, said, conversation, stats };
}

function placeFeetAt(body: { x: number; y: number }, at: { x: number; y: number }): void {
  body.x = at.x - TILE_SIZE / 2;
  body.y = at.y - TILE_SIZE / 2;
}

/**
 * Belle's sense cue over the real scent trail outside the inn (with the human
 * steered, as a player who has not thought to switch would be), and over a
 * ward line laid alone. Leaves her where she stood.
 */
function checkCatSenseCue(
  senses: SenseLayer,
  trail: ScentTrail,
  cat: CatPlayer,
  human: HumanPlayer,
): void {
  const start = firstOf(trail.points);
  if (start === undefined) {
    check('cat senses', false, 'the scent trail has points');
    return;
  }
  const home = { x: cat.x, y: cat.y };
  const far = { x: start.x + CAT_SENSE_FAR_TILES * TILE_SIZE, y: start.y };
  const rig = recordingCatSenseCue();
  let nowMs = 0;
  const frame = (at: { x: number; y: number }, calm = true): void => {
    placeFeetAt(cat, at);
    nowMs += CAT_SENSE_FRAME_MS;
    rig.cue.update({ senses, cat, steered: human, calm, nowMs });
  };

  frame(far);
  check('cat senses', !rig.cue.showing, 'the cue stays off far from the trail');
  check('cat senses', rig.played.length === 0, 'nothing plays far from the trail');
  frame(start);
  check('cat senses', rig.cue.showing, 'the cue turns on with the scent trail in her reach');
  check(
    'cat senses',
    rig.played.length === 1,
    `the cue sound plays once as it turns on (played ${rig.played.length})`,
  );
  check(
    'cat senses',
    rig.said.length === 1,
    `Belle says something as it turns on (said ${rig.said.length})`,
  );
  check('cat senses', rig.conversation.isOpen, 'the first cue in a run opens the explainer');
  check('cat senses', rig.stats.catSensesExplained, 'the explainer is recorded as shown');
  rig.conversation.close();
  frame(start);
  check('cat senses', rig.played.length === 1, 'the cue does not repeat while it stays on');
  frame(far);
  check('cat senses', !rig.cue.showing, 'the cue turns off once the trail is out of reach');
  frame(start);
  check('cat senses', rig.played.length === 1, 'the cue does not come again inside its rearm');
  frame(far);
  nowMs += CAT_SENSE_REARM_MS;
  frame(start);
  check('cat senses', rig.played.length === 2, 'the cue comes again once its rearm has run');
  check('cat senses', rig.said.length === 2, 'Belle speaks again with it');
  check('cat senses', !rig.conversation.isOpen, 'the explainer is shown only once in a run');
  frame(far);
  nowMs += CAT_SENSE_REARM_MS;
  frame(start, false);
  check('cat senses', rig.played.length === 2, 'the cue waits while the party is held');
  frame(start);
  check('cat senses', rig.played.length === 3, 'the cue plays once the party is free again');

  const ward = new SenseLayer();
  const wardFrom = { x: 0, y: 0 };
  const wardTo = { x: TILE_SIZE * 4, y: 0 };
  ward.add('ward', { segments: [{ from: wardFrom, to: wardTo }], hurts: false, pulse: () => 1 });
  const wardRig = recordingCatSenseCue();
  placeFeetAt(cat, { x: TILE_SIZE * 2, y: TILE_SIZE * 2 });
  wardRig.cue.update({ senses: ward, cat, steered: cat, calm: true, nowMs: CAT_SENSE_FRAME_MS });
  check('cat senses', wardRig.cue.showing, 'a ward line in her reach turns the cue on');
  check('cat senses', wardRig.played.length === 1, 'and plays the cue sound');
  cat.x = home.x;
  cat.y = home.y;
}

function holdTheCellar(walk: Walk): boolean {
  const lodge = walk.room(LODGE);
  walk.act(() => lodge.interior.tryOpenDialog('sgt_kessler', walk.run.human));
  const held = walk.until(() => {
    lodge.winTheFight();
    return walk.progress.phase === 'stakeout';
  }, CELLAR_FRAMES);
  return walk.expect(held, 'the lodge cellar never held');
}

function watchTheStore(walk: Walk): boolean {
  const town = walk.street();
  const storeDoor = townEntry(STORE).doorTile;
  const spots = planStakeoutSpots(storeDoor);
  const spot = firstOf(spots);
  if (spot === undefined) return walk.expect(false, 'the store has no hiding spot');
  const swooped = walk.until(() => {
    for (const crawler of town.pm.presentCrawlers()) standOn(crawler, spot);
    return walk.progress.phase === 'chase';
  }, THIEF_FRAMES);
  return walk.expect(swooped, 'the thief never came for the last cat');
}

function followTheThief(walk: Walk): boolean {
  const town = walk.street();
  const landed = walk.until(() => {
    const target = town.quest.trackerEntries()[0]?.target;
    if (target !== undefined) {
      for (const crawler of town.pm.presentCrawlers()) standOn(crawler, target);
    }
    return walk.progress.phase === 'confession';
  }, THIEF_FRAMES);
  return walk.expect(landed, 'the thief never landed on the temple');
}

function showAvielTheFeather(walk: Walk): boolean {
  const temple = walk.room(TEMPLE);
  walk.act(() => temple.interior.tryOpenDialog('deacon_aviel', walk.run.human));
  walk.until(() => walk.progress.phase === 'bait');
  return walk.expect(
    walk.progress.phase === 'bait',
    'Aviel never confessed or the choice never took',
  );
}

function layTheBait(walk: Walk): boolean {
  walk.room(INN);
  walk.until(() => walk.progress.daveRefusedBait);
  if (!walk.expect(walk.progress.daveRefusedBait, 'Dave never refused the bait')) return false;
  const fountain = TOWN_MAP.fountainCentre;
  if (fountain === undefined) return walk.expect(false, 'the town has no fountain');
  walk.street(fountain);
  walk.steer('cat');
  const before = walk.run.transfers.length;
  standOn(walk.run.cat, fountain);
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'cattery', 'the capture never split the party'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the capture moved nobody to the cage');
}

function workTheCattery(walk: Walk): boolean {
  const tower = walk.tower();
  const belleOut = pressLatchUntil(
    walk,
    tower,
    TOWER_CATTERY_CAGES.crawler_cat,
    () => walk.progress.crawlerCatUncaged,
  );
  if (!walk.expect(belleOut, "Belle never worked her cage's latch")) return false;
  const heldForCellmate = tower.storeys.stairRefusal('down') !== null;
  flagChecks.push(() =>
    check(
      'stairs',
      heldForCellmate,
      "the cattery's stair refuses Belle while the cellmate is still caged",
    ),
  );
  const cellmateOut = pressLatchUntil(
    walk,
    tower,
    TOWER_CATTERY_CAGES.tower_cattery_cellmate,
    () => walk.progress.cellmateFreed,
  );
  if (!walk.expect(cellmateOut, 'the cellmate was never let out')) return false;
  const before = walk.run.transfers.length;
  if (!walk.expect(tower.takeStair('down') === null, 'the cattery stair refused Belle'))
    return false;
  const solidWatch = watchWards(walk, tower);
  flagChecks.push(() => {
    check(
      'conduit',
      !solidWatch.everOpen,
      'before the sluice is shut, the archive doorway ward bars the way',
    );
    check('conduit', !solidWatch.pulsed, 'before the sluice is shut, no archive ward pulses');
  });
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'seeking_entry', 'the cattery chapter never ended'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the cattery chapter handed play to nobody');
}

function findAWayIn(walk: Walk): boolean {
  const lodge = walk.room(LODGE);
  walk.act(() => lodge.interior.tryOpenDialog('taloncrest_lodge_cellar_elf', walk.run.human));
  if (!walk.expect(walk.progress.elfWaitsAtGrate, 'the cellar elf never offered the drain'))
    return false;
  const grate = townEntry(STORM_DRAIN_ID).doorTile;
  walk.street(grate);
  let opened = false;
  for (const tile of tilesAround(grate, REACH_SEARCH_TILES * 2)) {
    standOn(walk.run.human, tile);
    walk.tick();
    walk.settleTalk();
    if (walk.progress.phase === 'sewer') {
      opened = true;
      break;
    }
  }
  if (!walk.expect(opened, 'the elf never opened the storm drain')) return false;
  walk.goTo({ kind: 'tower', storey: STOREY.cistern, tile: TOWER_CISTERN_ARRIVAL_TILE });
  walk.until(() => walk.progress.phase === 'cistern', REBUILD_SETTLE_FRAMES);
  return walk.expect(
    walk.progress.phase === 'cistern',
    'reaching the cistern did not open its chapter',
  );
}

function shutTheSluice(walk: Walk): boolean {
  const tower = walk.tower();
  const refusedEarly = tower.takeStair('up') !== null;
  flagChecks.push(() =>
    check('conduit', refusedEarly, 'the cistern stair refuses the human until the sluice is shut'),
  );
  const worked = workFittingFrom(
    tower,
    WARD_CONDUIT_SLUICE_TILE,
    () => walk.progress.conduitShut,
    () => {
      for (let gap = 0; gap < SLUICE_PRESS_GAP_FRAMES; gap++) walk.tick();
    },
  );
  if (!walk.expect(worked, 'the sluice never shut')) return false;
  const before = walk.run.transfers.length;
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'archive', 'the cistern chapter never ended'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the cistern chapter handed play to nobody');
}

function sendTheKeyRing(walk: Walk): boolean {
  const tower = walk.tower();
  const onArchive = tower.storey === STOREY.archive;
  const watch = watchWards(walk, tower);
  flagChecks.push(() => {
    check('conduit', onArchive, 'Belle opens her archive chapter on the archive');
    check(
      'conduit',
      watch.everOpen,
      'with the sluice shut the archive doorway ward can be crossed',
    );
    check('conduit', watch.pulsed, 'with the sluice shut the archive doorway ward pulses');
  });
  const heldForKeyRing = tower.storeys.stairRefusal('down') !== null;
  flagChecks.push(() =>
    check(
      'stairs',
      heldForKeyRing,
      "the archive's stair refuses Belle until the key ring has gone down",
    ),
  );
  const ringAt = ARCHIVE_KNOCKABLES.key_ring.at;
  let batted = false;
  for (const tile of tilesAround(ringAt, REACH_SEARCH_TILES)) {
    standOn(walk.run.cat, tile);
    if (tower.floor.mechanisms.knockOffs.wouldInteract(walk.run.cat) && tower.interact()) {
      batted = true;
      break;
    }
  }
  if (!walk.expect(batted, 'Belle could reach no key ring')) return false;
  walk.until(() => walk.progress.keyRingSent);
  flagChecks.push(() =>
    check(
      'key ring',
      walk.progress.keyRingSent,
      'the key ring batted off its shelf goes down the dumbwaiter',
    ),
  );
  if (!walk.expect(walk.progress.keyRingSent, 'the key ring never went down the dumbwaiter'))
    return false;
  const before = walk.run.transfers.length;
  if (!walk.expect(tower.takeStair('down') === null, 'the archive stair refused Belle'))
    return false;
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'gatehouse', 'the archive chapter never ended'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the archive chapter handed play to nobody');
}

function sendTheTuna(walk: Walk): boolean {
  const tower = walk.tower();
  const kitchenStairUp = portcullisTiles();
  const kitchen = tower.floors[STOREY.kitchen].map;
  const shutWalkable = kitchenStairUp.some((tile) => kitchen.isWalkable(tile.x, tile.y, 'walker'));
  flagChecks.push(() =>
    check(
      'portcullis',
      !shutWalkable,
      'before the counterweight falls, the kitchen stair is barred',
    ),
  );
  if (!walk.expect(tower.takeStair('up') === null, 'the gatehouse stair refused the human'))
    return false;
  walk.tick();
  const ringWaiting = itemsWaitingAt(walk.run.split, DUMBWAITER_FOOT).some(
    (load) => load.item === TOWER_KEY_RING_ITEM,
  );
  flagChecks.push(() =>
    check('key ring', ringWaiting, "the key ring waits at the kitchen's dumbwaiter foot"),
  );
  const human = walk.run.human;
  const took = workFittingFrom(
    tower,
    TOWER_DUMBWAITER.foot.hatch,
    () => human.inventory.countOf(TOWER_KEY_RING_ITEM) > 0,
    () => walk.tick(),
  );
  flagChecks.push(() =>
    check('key ring', took, 'the human takes the key ring out of the dumbwaiter'),
  );
  if (!walk.expect(took, 'the human never had the key ring')) return false;
  const opened = workFittingFrom(
    tower,
    LARDER_DOOR_TILE,
    () => walk.progress.larderOpened,
    () => walk.tick(),
  );
  if (!walk.expect(opened, 'the larder never opened')) return false;
  human.inventory.addItem(TUNA_TIN_ITEM, ONE);
  const sent = workFittingFrom(
    tower,
    TOWER_DUMBWAITER.foot.hatch,
    () => walk.progress.tunaSent,
    () => walk.tick(),
  );
  if (!walk.expect(sent, 'the tuna never went up the dumbwaiter')) return false;
  const tunaAtHatch = itemsWaitingAt(walk.run.split, DUMBWAITER_HEAD).some(
    (load) => load.item === TUNA_TIN_ITEM,
  );
  flagChecks.push(() =>
    check('tuna', tunaAtHatch, "the tuna waits at the archive's dumbwaiter hatch"),
  );
  const before = walk.run.transfers.length;
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'bell_storey', 'the kitchen chapter never ended'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the kitchen chapter handed play to nobody');
}

function dropTheCounterweight(walk: Walk): boolean {
  const tower = walk.tower();
  walk.until(() => tower.cellmateOrders.length > 0);
  const ordered = tower.cellmateOrders.length > 0;
  flagChecks.push(() =>
    check('tuna', ordered, 'fed, the cellmate goes to sit on a counterweight plate'),
  );
  if (!walk.expect(ordered, 'the cellmate never took a plate')) return false;
  const before = walk.run.transfers.length;
  const raised = walk.until(() => {
    standOn(walk.run.cat, BELL_STOREY_PLATES.west.at);
    return walk.progress.portcullisRaised;
  });
  if (!walk.expect(raised, 'the counterweight never fell')) return false;
  const kitchen = tower.floors[STOREY.kitchen].map;
  const liveOpen = portcullisTiles().every((tile) => kitchen.isWalkable(tile.x, tile.y, 'walker'));
  flagChecks.push(() =>
    check('portcullis', liveOpen, 'the counterweight falling opens the kitchen stair at once'),
  );
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.run.split.formation.kind === 'together', 'the split never ended'))
    return false;
  walkPlaces.regrouped = lastOf(walk.run.transfers)?.to ?? null;
  return walk.expect(walk.followTransfer(before), 'the party was never set down together');
}

function meetAgain(walk: Walk): boolean {
  const before = walk.run.transfers.length;
  walk.until(() => walk.progress.phase === 'ascent' && walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'ascent', 'the reunion never played')) return false;
  if (!walk.expect(walk.followTransfer(before), 'the climb never began')) return false;
  towerResumes.push({
    label: 'reunion',
    save: walk.run.lastSave,
    phase: 'ascent',
    expectedAt: walkPlaces.regrouped,
  });
  const kitchen = walk.tower().floors[STOREY.kitchen].map;
  const raisedArt = kitchen.placedInteriorProps.find(
    (placed) => placed.id === KITCHEN_PORTCULLIS_ID,
  );
  const rebuiltOpen = portcullisTiles().every((tile) =>
    kitchen.isWalkable(tile.x, tile.y, 'walker'),
  );
  flagChecks.push(() => {
    check(
      'portcullis',
      raisedArt?.propId === 'stair_portcullis_raised',
      `the kitchen built after the reunion stands its portcullis raised (${raisedArt?.propId ?? 'none'})`,
    );
    check('portcullis', rebuiltOpen, 'the kitchen built after the reunion has its stair open');
  });
  return true;
}

function climbToTheWarden(walk: Walk): boolean {
  const tower = walk.tower();
  while (tower.storey < STOREY.cattery) {
    if (
      !walk.expect(
        tower.takeStair('up') === null,
        `the stair up from storey ${tower.storey} refused the party`,
      )
    ) {
      return false;
    }
  }
  walk.until(() => walk.progress.phase === 'ritual');
  if (!walk.expect(walk.progress.phase === 'ritual', 'the Warden never rose')) return false;
  towerResumes.push({
    label: 'fight',
    save: walk.run.lastSave,
    phase: 'ritual',
    expectedAt: towerStairPlace('archive', 'stairUp'),
  });
  const fallen = walk.until(() => {
    if (!tower.conversation.isOpen) {
      for (const mob of tower.floors[STOREY.cattery].roster.mobs) {
        if (mob instanceof TheLich) mob.hp = 0;
      }
    }
    return walk.progress.phase === 'aftermath';
  });
  towerResumes.push({
    label: 'aftermath',
    save: walk.run.lastSave,
    phase: 'aftermath',
    expectedAt: towerStairPlace('cattery', 'stairDown'),
  });
  return walk.expect(fallen, 'the Warden never fell');
}

function bringPumpkinHome(walk: Walk): boolean {
  const inn = walk.room(INN);
  const coinsBefore = walk.run.human.coins;
  const transfersBefore = walk.run.transfers.length;
  walk.until(
    () => walk.progress.phase === 'complete' && !inn.cutscenes.busy && !inn.conversation.isOpen,
  );
  completion.coinsPaid = walk.run.human.coins - coinsBefore;
  completion.transfersAfter = walk.run.transfers.length - transfersBefore;
  return walk.expect(walk.progress.phase === 'complete', 'Pumpkin never came home');
}

const completion = { coinsPaid: 0, transfersAfter: 0 };

/** The hiding spots the stakeout plans round the store's door. */
function planStakeoutSpots(storeDoor: TilePoint): readonly TilePoint[] {
  return planStakeout(TOWN_MAP, storeDoor)?.hidingSpots ?? [];
}

/** The kitchen's stair-up tiles under the portcullis. */
function portcullisTiles(): TilePoint[] {
  const stair = towerStoreyPlan('kitchen').stairUp;
  if (stair === null) return [];
  const { footprint } = TOWN_INTERIOR_PROPS.stair_portcullis;
  const tiles: TilePoint[] = [];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) tiles.push({ x: stair.x + dx, y: stair.y + dy });
  }
  return tiles;
}

interface WardWatch {
  /** Whether the ward's tiles were ever walkable: a ward burning solid bars them. */
  readonly everOpen: boolean;
  /** Whether any ward line on the archive rose and fell over the watch: a pulse. */
  readonly pulsed: boolean;
}

/** Watches the conduit's ward on the archive for a while. */
function watchWards(walk: Walk, tower: TowerRig): WardWatch {
  const tiles = ARCHIVE_FIXED_WARDS.doorway.tiles;
  let everOpen = false;
  const archive = tower.floors[STOREY.archive];
  const low = archive.senses.wardLines.map(() => Number.POSITIVE_INFINITY);
  const high = archive.senses.wardLines.map(() => Number.NEGATIVE_INFINITY);
  for (let frame = 0; frame < PULSE_WATCH_FRAMES; frame++) {
    walk.tick();
    for (const tile of tiles) {
      if (archive.map.isWalkable(tile.x, tile.y, 'walker')) everOpen = true;
    }
    archive.senses.wardLines.forEach((line, index) => {
      const pulse = line.pulse();
      low[index] = Math.min(low[index] ?? pulse, pulse);
      high[index] = Math.max(high[index] ?? pulse, pulse);
    });
  }
  const pulsed = low.some((least, index) => (high[index] ?? least) > least);
  return { everOpen, pulsed };
}

/** Stands the steered crawler round `fitting` and presses until `done`. */
function workFittingFrom(
  tower: TowerRig,
  fitting: TilePoint,
  done: () => boolean,
  between: () => void,
): boolean {
  const active = tower.pm.active();
  for (const tile of tilesAround(fitting, REACH_SEARCH_TILES)) {
    if (!tower.map.isWalkable(tile.x, tile.y, 'walker')) continue;
    standOn(active, tile);
    for (let press = 0; press < SLUICE_PRESS_LIMIT && !done(); press++) {
      standOn(active, tile);
      if (!tower.interact()) break;
      between();
    }
    if (done()) return true;
  }
  return done();
}

/**
 * Belle at a latch, jostling it until `done`. A jostle the keeper sees sets
 * it staring, so after one she waits out the stare and the rest of its look
 * before trying again, as a player learns to.
 */
function pressLatchUntil(
  walk: Walk,
  tower: TowerRig,
  cage: TilePoint,
  done: () => boolean,
): boolean {
  const cat = walk.run.cat;
  const fronts = tilesAround(cage, ONE).filter(
    (tile) =>
      (tile.x === cage.x && tile.y === cage.y) || tower.map.isWalkable(tile.x, tile.y, 'walker'),
  );
  let waitFrames = 0;
  const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
    if (moment.kind === 'latch_seen') waitFrames = KEEPER_WAIT_FRAMES;
  });
  for (let frame = 0; frame < LATCH_FRAMES && !done(); frame++) {
    walk.tick();
    if (waitFrames > 0) {
      waitFrames--;
      continue;
    }
    if (frame % LATCH_PRESS_GAP_FRAMES !== 0) continue;
    for (const tile of fronts) {
      standOn(cat, tile);
      if (tower.interact()) break;
    }
  }
  stopListening();
  return done();
}

// ── Rebuilds and saves ────────────────────────────────────────────────────────

const PHASES_THAT_SPLIT_ON_REBUILD: ReadonlySet<MissingCatsPhase> = new Set(['captured']);

interface Settled {
  readonly run: Run;
  readonly rig: Rig;
  readonly transfers: readonly PartyTransferRequest[];
}

function settleAt(record: RunRecord, place: Place): Settled {
  const run = new Run(record);
  const rig = rigAt(run, place);
  for (let frame = 0; frame < REBUILD_SETTLE_FRAMES; frame++) {
    const before = run.transfers.length;
    rig.tick();
    run.settle(rig.here(), before);
  }
  return { run, rig, transfers: run.transfers };
}

/** Judges a place rebuilt from `record` at `phase` after it has run a while on its own. */
function judgeRebuild(
  label: string,
  phase: MissingCatsPhase,
  record: RunRecord,
  place: Place,
): void {
  const where = `${phase} rebuilt at ${describePlace(place)}`;
  let settled: Settled;
  try {
    settled = settleAt(record, place);
  } catch (error) {
    check(
      label,
      false,
      `${where} throws: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const { run, rig, transfers } = settled;
  const after = run.progress.phase;
  if (PHASES_THAT_SPLIT_ON_REBUILD.has(phase)) {
    const formation = run.split.formation;
    check(label, formation.kind === 'split', `${where}: the party found whole is split`);
    check(label, after === 'cattery', `${where}: the questline moves on to the cattery (${after})`);
    const to = firstOf(transfers)?.to;
    check(
      label,
      transfers.length === ONE && to !== undefined && sameLocation(to, BELLE_CAGE_LOCATION),
      `${where}: the scene moves to Belle's cage (${transfers.length} transfers)`,
    );
    rig.dispose();
    return;
  }
  check(label, after === phase, `${where}: the questline stays at ${phase} (now ${after})`);
  check(
    label,
    transfers.length === 0,
    `${where}: nothing is handed over (${transfers.map((request) => describeLocation(request.to)).join('; ')})`,
  );
  const formation = run.split.formation;
  const splitOwed = missingCatsSplitUnderWay(run.progress);
  check(
    label,
    (formation.kind === 'split') === splitOwed,
    `${where}: the party is ${splitOwed ? 'split' : 'together'} (${formation.kind})`,
  );
  if (formation.kind === 'split') {
    const chapter = currentChapter(MISSING_CATS_CHAPTERS, run.progress);
    check(
      label,
      chapter?.group === formation.live,
      `${where}: the live group is the one whose chapter is being played`,
    );
    const steered = rig.pm.active().crawlerKind;
    check(
      label,
      liveGroupOf(formation).crawlers.includes(steered),
      `${where}: the crawler steered is the live group's (${steered})`,
    );
  }
  rig.dispose();
}

function checkRebuilds(walk: Walk): void {
  section('Every phase stands up again in a place rebuilt from its record');
  for (const phase of MISSING_CATS_PHASES) {
    const snapshot = walk.run.snapshots.get(phase);
    check('rebuild', snapshot !== undefined, `${phase} was recorded on the walk`);
    if (snapshot === undefined) continue;
    const rebuilt = recordFromRestore(snapshot.record);
    judgeRebuild('rebuild', phase, rebuilt, snapshot.place);
  }
}

/** The record as a rebuilt scene reads it: restored into fresh objects, no text in between. */
function recordFromRestore(record: RunRecord): RunRecord {
  const run = new Run(record);
  return run.record;
}

function checkResumes(walk: Walk): void {
  section('A save written mid-split resumes into the chapter about to start, where it starts');
  const saves = walk.run.directorSaves;
  check('resume', saves.length > 0, 'the split wrote saves');
  for (const save of saves) {
    const read = readSave(save.text);
    check('resume', read !== null, `the save at ${describeLocation(save.chapterStart)} reads back`);
    if (read === null) continue;
    const progress = new Run(read).progress;
    const formation = read.partySplit.formation;
    const where = `${progress.phase} save`;
    const savedIndoorsIn = savedIndoorsInFor(save.chapterStart);
    const resume = resumeLocationFor(formation, savedIndoorsIn, missingCatsTowerResume(progress));
    if (formation.kind !== 'split') {
      check(
        'resume',
        currentChapter(MISSING_CATS_CHAPTERS, progress) === null,
        `${where}: the party is saved whole only once every chapter is over`,
      );
      const regrouped = walkPlaces.regrouped;
      check(
        'resume',
        resume !== null && regrouped !== null && sameLocation(resume, regrouped),
        `${where}: loading the whole party lands where the director set it down together`,
      );
      if (resume === null) continue;
      const together = settleAt(read, placeOf(resume));
      check(
        'resume',
        together.run.progress.phase === 'ascent' && together.transfers.length === ONE,
        `${where}: loaded there, the reunion plays and the climb begins (${together.run.progress.phase}, ${together.transfers.length} transfers)`,
      );
      together.rig.dispose();
      continue;
    }
    const live = liveGroupOf(formation);
    check(
      'resume',
      savedIndoorsIn === null
        ? resume === null
        : resume !== null && sameLocation(resume, save.chapterStart),
      `${where}: loading moves the party to the chapter's start only when it is indoors (${resume === null ? 'stays' : describeLocation(resume)})`,
    );
    check(
      'resume',
      sameLocation(live.at, save.chapterStart),
      `${where}: the live group stands where the chapter starts (${describeLocation(live.at)} vs ${describeLocation(save.chapterStart)})`,
    );
    const chapter = currentChapter(MISSING_CATS_CHAPTERS, progress);
    check(
      'resume',
      chapter?.group === formation.live,
      `${where}: the chapter being played is the live group's`,
    );
    if (chapter !== null && chapter.start !== null) {
      check(
        'resume',
        sameLocation(chapter.start, live.at),
        `${where}: loading lands on the chapter's own opening place (${describeLocation(chapter.start)}, got ${describeLocation(live.at)})`,
      );
    }
    const place = placeOf(live.at);
    let settled: Settled | null = null;
    try {
      settled = settleAt(read, place);
    } catch (error) {
      check(
        'resume',
        false,
        `${where}: loading throws: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (settled === null) continue;
    check(
      'resume',
      settled.transfers.length === 0 && settled.run.progress.phase === progress.phase,
      `${where}: loaded at ${describePlace(place)} it plays on without handing over`,
    );
    settled.rig.dispose();
  }
}

function checkTowerResumes(): void {
  section('A save written in the tower with the party together resumes where it was written');
  for (const resumeCase of towerResumes) {
    const { label, phase, expectedAt } = resumeCase;
    const where = `the ${label} save`;
    const read = resumeCase.save === null ? null : readSave(resumeCase.save);
    check(label, read !== null, `${where} was written and reads back`);
    if (read === null) continue;
    const progress = new Run(read).progress;
    check(label, progress.phase === phase, `${where} holds ${phase} (${progress.phase})`);
    const resume = resumeLocationFor(
      read.partySplit.formation,
      TOWN_TOWER_ID,
      missingCatsTowerResume(progress),
    );
    check(
      label,
      resume !== null && expectedAt !== null && sameLocation(resume, expectedAt),
      `${where} resumes at ${expectedAt === null ? 'nowhere' : describeLocation(expectedAt)} (${resume === null ? 'the tower door' : describeLocation(resume)})`,
    );
    if (resume === null) continue;
    const settled = settleAt(read, placeOf(resume));
    check(
      label,
      settled.transfers.length === 0 && settled.run.progress.phase === progress.phase,
      `${where}, loaded, plays on without replaying anything (${settled.run.progress.phase}, ${settled.transfers.length} transfers)`,
    );
    if (phase === 'ritual') checkFightReplays(settled);
    settled.rig.dispose();
  }
}

/** From the foot of the cattery stair a fight resumed by a save rises again one flight up. */
function checkFightReplays(settled: Settled): void {
  const tower = settled.rig;
  if (!(tower instanceof TowerRig)) {
    check('fight', false, 'the fight save resumes in the tower');
    return;
  }
  const climbed = tower.takeStair('up') === null;
  let wardenUp = false;
  for (let frame = 0; frame < BEAT_FRAMES && !wardenUp; frame++) {
    tower.tick();
    wardenUp = tower.floors[STOREY.cattery].roster.mobs.some((mob) => mob instanceof TheLich);
  }
  check('fight', climbed && wardenUp, 'the stair up from the fight save leads back into the fight');
}

/** Where a preset's party is put down on the street. */
function presetStreetTile(preset: PlaytestPreset): TilePoint {
  const spawn = preset.spawn;
  if (spawn.kind === 'townBuildingDoor') return doorstepOf(townEntry(spawn.buildingId));
  return TOWN_MAP.startTile;
}

/** A whole party at `phase`, as a dev preset or a hand-built record has it. */
function wholePartyAt(phase: MissingCatsPhase): RunRecord {
  return recordOf(missingCatsProgressAt(phase), createPartySplitState());
}

/**
 * Settles a whole party at `phase` on `place`, follows any move it asks for,
 * and judges the split it formed: the chapter's side live and steered, the
 * hire with the human and the cellmate with Belle once she is out, and the
 * place it then plays on handing nothing more over.
 */
function judgeWholeSplit(label: string, phase: MissingCatsPhase, place: Place): void {
  const where = `a whole party at ${phase} on ${describePlace(place)}`;
  const run = new Run(wholePartyAt(phase));
  let rig = rigAt(run, place);
  for (let frame = 0; frame < REBUILD_SETTLE_FRAMES; frame++) rig.tick();
  const formation = run.split.formation;
  const chapter = currentChapter(MISSING_CATS_CHAPTERS, run.progress);
  if (!missingCatsSplitUnderWay(run.progress)) {
    check(
      label,
      formation.kind === 'together' && run.transfers.length === 0 && run.progress.phase === phase,
      `${where} plays on together (${formation.kind}, ${run.transfers.length} transfers, ${run.progress.phase})`,
    );
    rig.dispose();
    return;
  }
  check(label, formation.kind === 'split', `${where} is split (${formation.kind})`);
  if (formation.kind !== 'split' || chapter === null) {
    rig.dispose();
    return;
  }
  check(
    label,
    formation.live === chapter.group,
    `${where}: the side whose chapter is played is live`,
  );
  const live = liveGroupOf(formation);
  check(
    label,
    live.crawlers.includes(rig.pm.active().crawlerKind),
    `${where}: the crawler steered is the live side's`,
  );
  const humanSide = PARTY_GROUP_IDS.map((id) => formation.groups[id]).find((group) =>
    group.crawlers.includes('human'),
  );
  check(
    label,
    humanSide?.companions.some((ref) => ref.kind === 'mercenary' && ref.hire === HIRE) === true,
    `${where}: the hire goes with the human`,
  );
  const transfer = firstOf(run.transfers);
  const startsHere = chapter.start === null && live.crawlers.includes('human');
  check(
    label,
    startsHere
      ? run.transfers.length === 0
      : run.transfers.length === ONE &&
          transfer !== undefined &&
          sameLocation(transfer.to, live.at),
    `${where}: the scene ${startsHere ? 'plays on where it is' : `moves to ${describeLocation(live.at)}`} (${run.transfers.map((request) => describeLocation(request.to)).join('; ') || 'stays'})`,
  );
  if (transfer !== undefined) {
    rig.dispose();
    rig = rigAt(run, placeOf(transfer.to));
  }
  const handedBefore = run.transfers.length;
  for (let frame = 0; frame < REBUILD_SETTLE_FRAMES; frame++) rig.tick();
  check(
    label,
    run.transfers.length === handedBefore && run.progress.phase === phase,
    `${where}: the live side plays on (${run.progress.phase}, ${run.transfers.length - handedBefore} more transfers)`,
  );
  rig.dispose();
}

function checkWholeSplits(): void {
  section('A party found whole in the split is split as the phase plays it');
  const cistern: Place = {
    kind: 'tower',
    storey: STOREY.cistern,
    tile: TOWER_CISTERN_ARRIVAL_TILE,
  };
  const street: Place = { kind: 'overworld', tile: doorstepOf(townEntry(STORM_DRAIN_ID)) };
  const kitchenLanding = towerStairPlace('kitchen', 'stairDown');
  const kitchen: Place = { kind: 'tower', storey: STOREY.kitchen, tile: kitchenLanding.tile };
  for (const phase of MISSING_CATS_PHASES) {
    if (!missingCatsSplitUnderWay(missingCatsProgressAt(phase))) continue;
    judgeWholeSplit('whole', phase, street);
    judgeWholeSplit('whole', phase, kitchen);
  }
  section('Every questline preset boots into a scene that plays on');
  for (const preset of PLAYTEST_PRESETS) {
    const phase = preset.missingCatsPhase;
    if (phase === undefined) continue;
    judgeWholeSplit('whole', phase, { kind: 'overworld', tile: presetStreetTile(preset) });
  }
  const sewer = PLAYTEST_PRESETS.find((preset) => preset.missingCatsPhase === 'sewer');
  check('whole', sewer !== undefined, 'a preset starts in the sewer');
  if (sewer === undefined) return;
  const run = new Run(wholePartyAt('sewer'));
  const streetRig = rigAt(run, { kind: 'overworld', tile: presetStreetTile(sewer) });
  streetRig.tick();
  streetRig.dispose();
  const tower = rigAt(run, cistern);
  for (let frame = 0; frame < REBUILD_SETTLE_FRAMES; frame++) tower.tick();
  check(
    'whole',
    run.progress.phase === 'cistern',
    `the sewer preset's party, come up into the cistern, opens its chapter (${run.progress.phase})`,
  );
  tower.dispose();
}

// ── The tower loan ────────────────────────────────────────────────────────────

function contractOf(roster: MercenaryRoster): MercenaryRoster['active'] {
  return roster.active;
}

function loanDesk(roster: MercenaryRoster, phase: MissingCatsPhase): MercenaryGuildSystem {
  const progress = missingCatsProgressAt(phase);
  roster.floorLevelId = level3.id;
  return new MercenaryGuildSystem(roster, null, () => towerLoanOffered(progress));
}

function checkTowerLoan(): void {
  section("Sydney's desk lends one hire for the tower, once, and the loan ends with the Warden");
  const run = new Run(null);
  const { human, cat } = run;
  human.coins = 0;
  cat.coins = 0;
  const roster = createMercenaryRoster();
  const desk = loanDesk(roster, 'sewer');
  desk.pressHire(HIRE, human, cat);
  check(
    'loan',
    roster.active?.terms === 'tower_loan',
    `a party with no coins under the tower is lent a hire free (${roster.active?.terms ?? 'none'})`,
  );
  desk.askDismiss();
  desk.tearUpContract();
  desk.pressHire(HIRE, human, cat);
  check('loan', roster.active === null, 'the desk lends the tower a hire only once');
  for (const phase of ['captured', 'ascent'] as const) {
    const unlent = createMercenaryRoster();
    loanDesk(unlent, phase).pressHire(HIRE, human, cat);
    check('loan', unlent.active === null, `at ${phase} the desk lends nobody for free`);
  }
  const lent = createMercenaryRoster();
  loanDesk(lent, 'gatehouse').pressHire(HIRE, human, cat);
  const ended = new MercenarySystem(lent, level3.id).endTowerLoan();
  check('loan', ended && lent.active === null, 'the tower loan ends when the Warden falls');
  const paid = createMercenaryRoster();
  paid.active = {
    id: HIRE,
    name: HIRE,
    terms: 'paid',
    contractLevelId: level3.id,
    introduced: false,
  };
  const keptPaid = !new MercenarySystem(paid, level3.id).endTowerLoan();
  check('loan', keptPaid && contractOf(paid) !== null, 'a paid contract outlives the Warden');
}

// ── Completion ────────────────────────────────────────────────────────────────

function checkCompletion(walk: Walk): void {
  section('Completion leaves the party on the floor, paid once');
  const { run } = walk;
  check('no exit', run.progress.phase === 'complete', 'the walk completed the questline');
  check(
    'no exit',
    run.questCompletions === ONE,
    `the questline completes once (${run.questCompletions})`,
  );
  check('no exit', run.floorEnds.length === 0, 'nothing on the way ended the floor');
  check('no exit', completion.transfersAfter === 0, 'completing moves the party nowhere');
  check('no exit', run.split.formation.kind === 'together', 'the party is whole on the floor');
  check('no exit', level3.nextLevelId === undefined, 'floor 3 still leads nowhere further down');
  check('no exit', TOWN_MAP.stairwellTiles.length === 0, 'the town has no stairwell');
  const complete = run.snapshots.get('complete');
  if (complete !== undefined) {
    const street = settleAt(complete.record, { kind: 'overworld', tile: TOWN_MAP.startTile });
    check(
      'no exit',
      street.transfers.length === 0 && street.run.progress.phase === 'complete',
      'the street after completion sends the party nowhere',
    );
    street.rig.dispose();
  }

  check(
    'paid once',
    run.rewardsShown.length === ONE,
    `the reward screen is asked for once (${run.rewardsShown.length})`,
  );
  check(
    'paid once',
    completion.coinsPaid === MISSING_CATS_COMPLETION_COINS,
    `the completion coins are paid once (${completion.coinsPaid} of ${MISSING_CATS_COMPLETION_COINS})`,
  );
  check('paid once', complete !== undefined, 'the completion was recorded');
  if (complete === undefined) return;
  const lastSave = run.lastSave;
  for (const via of ['rebuild', 'save'] as const) {
    const saved = lastSave === null ? null : readSave(lastSave);
    const record = via === 'rebuild' ? complete.record : saved;
    check('paid once', record !== null, `the completed questline's ${via} reads back`);
    if (record === null) continue;
    const inn = settleAt(record, { kind: 'room', building: INN });
    const settle = inn.rig;
    if (settle instanceof RoomRig) {
      for (let frame = 0; frame < BEAT_FRAMES; frame++) settle.tick();
    }
    check(
      'paid once',
      inn.run.rewardsShown.length === 0 && inn.run.questCompletions === 0,
      `the inn after a ${via} at completion pays nothing again (${inn.run.rewardsShown.length} rewards)`,
    );
    inn.rig.dispose();
  }
}

// ── The door and the drain ────────────────────────────────────────────────────

function checkTowerDoor(): void {
  section("The tower's front door refuses in every phase");
  const door = townEntry(TOWN_TOWER_ID);
  for (const phase of MISSING_CATS_PHASES) {
    const refusal = towerDoorRefusal(door, towerDoorStandingFor(missingCatsProgressAt(phase)));
    check(
      'door',
      typeof refusal === 'string' && refusal.length > 0,
      `at ${phase} the tower door refuses`,
    );
  }
}

function checkStormDrain(walk: Walk): void {
  section('The storm drain opens from the sewer on, and stays open');
  const drain = townEntry(STORM_DRAIN_ID);
  const reachedPastSewer = walk.run.entered.includes('sewer');
  check('drain', reachedPastSewer, 'the elf opened the grate on the walk');
  for (const phase of MISSING_CATS_PHASES) {
    const snapshot = walk.run.snapshots.get(phase);
    const progress =
      snapshot === undefined ? missingCatsProgressAt(phase) : new Run(snapshot.record).progress;
    const open = stormDrainOpenFor(progress);
    const shouldBeOpen = phaseReached({ phase }, 'sewer');
    const refusal = stormDrainRefusal(drain, open);
    check(
      'drain',
      open === shouldBeOpen && (refusal === null) === shouldBeOpen,
      `at ${phase} the drain is ${shouldBeOpen ? 'open' : 'shut'} (${open ? 'open' : 'shut'})`,
    );
  }
}

// ── The floor scene's own save and resume ─────────────────────────────────────

const SCENE_VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;

type FloorScene = DungeonScene;

/** What the scene sets up around a resume, for one check: the save it writes and the scene it rebuilds from it. */
interface SceneHarness {
  readonly scene: FloorScene;
  readonly written: SaveProgressInput[];
  /** The scene rebuilt from the last save `scene` wrote, with the move its first frame owes and makes. */
  resumeFromLastSave(): Promise<{
    readonly owed: PartyLocation | null;
    readonly moved: PartyLocation | null;
  }>;
}

function loadIntoScene(scene: FloorScene, record: RunRecord): void {
  restoreMissingCatsProgress(scene['missingCatsProgress'], record.missingCats);
  restorePartySplit(scene['partySplit'], record.partySplit);
  scene.pm.steerLiveGroup();
}

function partyOfScene(scene: FloorScene): SaveParty {
  return {
    human: snapPlayer(scene.pm.human),
    cat: snapPlayer(scene.pm.cat),
    ...scene['deinonychusPetSaveState'](),
  };
}

/** A save as storage hands it back: stamped, written as text and read by the game's own parser. */
function storedAndRead(progress: SaveProgressInput): GameProgress | null {
  return parseGameProgress(JSON.parse(JSON.stringify(stampGameProgress(progress))));
}

function recordOfSave(save: GameProgress | null): RunRecord | null {
  const persisted = save?.world?.persisted;
  if (persisted === undefined) return null;
  return { missingCats: persisted.missingCatsProgress, partySplit: persisted.partySplit };
}

async function buildSceneHarness(): Promise<SceneHarness> {
  installBrowserShim(SCENE_VIEWPORT);
  const { SceneManager } = await import('../src/core/Scene.js');
  const { InputManager } = await import('../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
  applySceneFaults(DungeonScene.prototype);
  const written: SaveProgressInput[] = [];
  const saveProgress = (progress: SaveProgressInput): Promise<'saved'> => {
    written.push(progress);
    return Promise.resolve('saved');
  };
  const scene = new DungeonScene(level3, new InputManager(), new SceneManager(), {
    worldSeed: WORLD_SEED,
    skipIntro: true,
    saveProgress,
  });
  return {
    scene,
    written,
    resumeFromLastSave: () => {
      const last = lastOf(written);
      const read = last === undefined ? null : storedAndRead(last);
      if (read === null) throw new Error('the scene wrote no save its parser reads back');
      const { levelDef, options } = sceneSetupFromSave({ skipIntro: true, saveProgress }, read);
      const resumed = new DungeonScene(levelDef, new InputManager(), new SceneManager(), options);
      const owed = resumed['resumeOwed'];
      let moved: PartyLocation | null = null;
      Reflect.set(resumed, 'transferParty', (request: PartyTransferRequest) => {
        moved = request.to;
      });
      resumed['resumeIfOwed']();
      resumed.onExit();
      return Promise.resolve({ owed, moved });
    },
  };
}

function sameOrBothNull(a: PartyLocation | null, b: PartyLocation | null): boolean {
  if (a === null || b === null) return a === b;
  return sameLocation(a, b);
}

function describeMaybe(location: PartyLocation | null): string {
  return location === null ? 'where it was written' : describeLocation(location);
}

/** Judges where the scene rebuilt from its last save, and the same scene rewound to it, put the party. */
async function judgeSceneResume(
  harness: SceneHarness,
  label: string,
  where: string,
  expected: PartyLocation | null,
): Promise<void> {
  const { owed, moved } = await harness.resumeFromLastSave();
  check(
    label,
    sameOrBothNull(owed, expected) && sameOrBothNull(moved, expected),
    `${where}: a reload resumes ${describeMaybe(expected)} (owed ${describeMaybe(owed)}, moved ${describeMaybe(moved)})`,
  );
  const scene = harness.scene;
  const checkpoint = scene['lastSave']?.checkpoint ?? null;
  if (checkpoint === null) return;
  scene['restoreFromCheckpoint'](checkpoint);
  const rewound = scene['resumeOwed'];
  check(
    label,
    sameOrBothNull(rewound, expected),
    `${where}: a death rewound in place owes ${describeMaybe(expected)} (owes ${describeMaybe(rewound)})`,
  );
  scene['resumeOwed'] = null;
}

async function checkSceneSaves(harness: SceneHarness, walk: Walk): Promise<void> {
  section("Every phase survives the floor scene's save, and stands up again from what was read");
  for (const phase of MISSING_CATS_PHASES) {
    const snapshot = walk.run.snapshots.get(phase);
    check('save', snapshot !== undefined, `${phase} was recorded on the walk`);
    if (snapshot === undefined) continue;
    loadIntoScene(harness.scene, snapshot.record);
    const read = recordOfSave(
      storedAndRead(harness.scene['buildSaveProgress'](partyOfScene(harness.scene))),
    );
    check('save', read !== null, `${phase}: the save reads back`);
    if (read === null) continue;
    const wrote = snapshot.record;
    check(
      'save',
      JSON.stringify(read.missingCats) === JSON.stringify(wrote.missingCats),
      `${phase}: the questline reads back as it was written`,
    );
    check(
      'save',
      JSON.stringify(read.partySplit.formation) === JSON.stringify(wrote.partySplit.formation),
      `${phase}: the formation, its groups, live group and places read back`,
    );
    check(
      'save',
      JSON.stringify(read.partySplit.exchange) === JSON.stringify(wrote.partySplit.exchange),
      `${phase}: what one side left the other reads back`,
    );
    check('save', recordText(read) === recordText(wrote), `${phase}: the whole record reads back`);
    judgeRebuild('save', phase, read, snapshot.place);
  }
  await Promise.resolve();
}

/** The director's save for the chapter about to start at `phase`, as the walk wrote it. */
function chapterSaveAt(
  walk: Walk,
  phase: MissingCatsPhase,
): { record: RunRecord; start: PartyLocation } | null {
  for (const save of walk.run.directorSaves) {
    const read = readSave(save.text);
    if (read?.missingCats.phase === phase && read.partySplit.formation.kind === 'split') {
      return { record: read, start: save.chapterStart };
    }
  }
  return null;
}

async function checkSceneResumes(harness: SceneHarness, walk: Walk): Promise<void> {
  section('The floor scene, rebuilt from a save, moves the party where the save says it was');
  const { scene } = harness;
  for (const save of walk.run.directorSaves) {
    const read = readSave(save.text);
    if (read?.partySplit.formation.kind !== 'split') continue;
    loadIntoScene(scene, read);
    scene['captureChapterSave'](save.chapterStart);
    const expected = save.chapterStart.kind === 'interior' ? save.chapterStart : null;
    await judgeSceneResume(
      harness,
      'resume',
      `the ${read.missingCats.phase} chapter's save`,
      expected,
    );
  }

  const gatehouse = chapterSaveAt(walk, 'gatehouse');
  check('resume', gatehouse !== null, 'the gatehouse chapter wrote a save');
  if (gatehouse !== null) {
    const shopStep = doorstepOf(townEntry(STORE));
    loadIntoScene(scene, gatehouse.record);
    scene['captureSavePoint'](shopStep);
    const streetSave = recordOfSave(
      storedAndRead(lastOf(harness.written) ?? scene['buildSaveProgress'](partyOfScene(scene))),
    );
    const recorded = streetSave?.partySplit.formation;
    check(
      'resume',
      recorded?.kind === 'split' &&
        sameLocation(liveGroupOf(recorded).at, { kind: 'overworld', tile: shopStep }),
      'a street save mid-split records the live side on the street where it was written',
    );
    await judgeSceneResume(harness, 'resume', 'a street save mid-split, out for the tuna', null);
    const kitchen = towerStairPlace('kitchen', 'stairDown');
    await scene['commitSaveFromInterior'](partyOfScene(scene), kitchen);
    await judgeSceneResume(harness, 'resume', 'the next save, back inside in the kitchen', kitchen);
  }

  const somewhereInTheTower = towerStairPlace('cistern', 'stairUp');
  for (const resumeCase of towerResumes) {
    const read = resumeCase.save === null ? null : readSave(resumeCase.save);
    if (read === null) continue;
    loadIntoScene(scene, read);
    await scene['commitSaveFromInterior'](partyOfScene(scene), somewhereInTheTower);
    await judgeSceneResume(
      harness,
      resumeCase.label,
      `the ${resumeCase.label} save, the party together`,
      resumeCase.expectedAt,
    );
  }
}

// ── Running it ────────────────────────────────────────────────────────────────

function applySceneFaults(prototype: FloorScene): void {
  if (FAULT === 'save-loses-exchange') {
    const capture = methodOf(prototype, 'capturePersistedWorldState');
    breakMethod(prototype, 'capturePersistedWorldState', function (this: object) {
      const state: unknown = capture(this);
      if (!isRecord(state) || !isRecord(state.partySplit) || !isRecord(state.partySplit.exchange)) {
        throw new Error('the scene captured no party split');
      }
      return {
        ...state,
        partySplit: { ...state.partySplit, exchange: { ...state.partySplit.exchange, items: [] } },
      };
    });
  }
  if (FAULT === 'street-save-pulled-indoors') {
    breakMethod(prototype, 'oweIndoorsResume', function (this: FloorScene) {
      const formation = this['partySplit'].formation;
      const liveAt = formation.kind === 'split' ? liveGroupOf(formation).at : null;
      this['resumeOwed'] = liveAt?.kind === 'interior' ? liveAt : null;
    });
  }
}

function applyWalkFaults(): void {
  if (FAULT === 'chapter-start-ignored') {
    const handOver = methodOf(SplitDirector.prototype, 'handOver');
    breakMethod(
      SplitDirector.prototype,
      'handOver',
      function (this: object, to: unknown, card: unknown) {
        return handOver(this, to, card, null);
      },
    );
  }
  if (FAULT === 'archive-built-stale') Reflect.set(ARCHIVE_WARDS_BY_CONDUIT, 'shut', 'solid');
  if (FAULT === 'kitchen-built-shut') {
    Reflect.set(KITCHEN_PORTCULLIS_PROPS, 'raised', KITCHEN_PORTCULLIS_PROPS.shut);
  }
  if (FAULT === 'complete-not-saved') {
    muteHookDuring(MissingCatsInteriorSystem.prototype, 'completeQuestline', 'save');
  }
  if (FAULT === 'reunion-not-saved')
    muteHookDuring(TowerChapters.prototype, 'climbTogether', 'saveNow');
  if (FAULT === 'fight-not-saved')
    muteHookDuring(TowerRitualSystem.prototype, 'arrive', 'saveBeforeFight');
  if (FAULT === 'cattery-stair-unguarded') dropStairRefusal(SPLIT_STAIR_REFUSALS.cellmateFirst);
  if (FAULT === 'archive-stair-unguarded') dropStairRefusal(SPLIT_STAIR_REFUSALS.keyRingFirst);
  if (FAULT === 'tower-loan-twice') {
    const loanStands = methodOf(MercenaryGuildSystem.prototype, 'loanStands');
    breakMethod(MercenaryGuildSystem.prototype, 'loanStands', function (this: object) {
      const roster: unknown = Reflect.get(this, 'roster');
      if (!isRecord(roster)) throw new Error('the desk has no roster');
      const signed: unknown = roster.towerLoanSigned;
      Reflect.set(roster, 'towerLoanSigned', false);
      try {
        return loanStands(this);
      } finally {
        Reflect.set(roster, 'towerLoanSigned', signed);
      }
    });
  }
  if (FAULT === 'tower-loan-outlives-warden') {
    breakMethod(MercenarySystem.prototype, 'endTowerLoan', () => false);
  }
  if (FAULT === 'notice-board-ignored')
    breakMethod(MissingCatsQuestSystem.prototype, 'onNoticeBoardRead', () => undefined);
  if (FAULT === 'dumbwaiter-drops-key-ring')
    breakMethod(ConveyorSystem.prototype, 'deliverAt', () => false);
  if (FAULT === 'cellmate-unfed')
    breakMethod(BellStoreyWorks.prototype, 'seatCellmate', () => undefined);
  if (FAULT === 'grate-stays-shut')
    breakMethod(MissingCatsQuestSystem.prototype, 'openGrate', () => undefined);
  if (FAULT === 'door-opens-after-quest') Reflect.set(TOWER_DOOR_REFUSALS, 'closedByOrder', null);
  if (FAULT === 'cat-sense-cue-silent')
    breakMethod(CatSenseCue.prototype, 'announce', () => undefined);
  if (FAULT === 'cat-sense-unseen')
    breakMethod(SenseLayer.prototype, 'exclusiveSenseWithin', () => false);
}

function applyRebuildFaults(): void {
  if (FAULT === 'captured-stays-whole')
    breakMethod(MissingCatsQuestSystem.prototype, 'splitIfOwed', () => undefined);
}

applyWalkFaults();
const walk = new Walk();
section('The questline, walked from the inn to Pumpkin coming home');
walkTheQuestline(walk);
check(
  'reachable',
  walk.stalled === null,
  `the walk ran to the end${walk.stalled === null ? '' : `: ${walk.stalled}`}`,
);
const missed = MISSING_CATS_PHASES.filter((phase) => !walk.run.entered.includes(phase));
check(
  'reachable',
  missed.length === 0,
  `every phase is entered (missed: ${missed.join(', ') || 'none'})`,
);
check(
  'reachable',
  walk.run.entered.join(' ') === MISSING_CATS_PHASES.join(' '),
  `the phases are entered in order (${walk.run.entered.join(' → ')})`,
);
for (const flagCheck of flagChecks) flagCheck();
check(
  'conduit',
  walk.run.entered.includes('archive'),
  "the archive's wards were read after the sluice",
);
check(
  'key ring',
  walk.run.entered.includes('bell_storey'),
  'the kitchen was reached after the key ring went down',
);
check(
  'tuna',
  walk.run.entered.includes('ascent'),
  'the bell storey was played after the tuna went up',
);
check(
  'portcullis',
  walk.run.entered.includes('ascent'),
  'the kitchen was rebuilt after the counterweight fell',
);
check('save', walk.run.saveCount > 0, 'the walk wrote saves');

applyRebuildFaults();
checkRebuilds(walk);
checkResumes(walk);
checkTowerResumes();
checkWholeSplits();
checkTowerLoan();
checkCompletion(walk);
checkTowerDoor();
checkStormDrain(walk);
const harness = await buildSceneHarness();
await checkSceneSaves(harness, walk);
await checkSceneResumes(harness, walk);
harness.scene.onExit();

if (failures.length > 0) {
  console.error(
    `\n${failures.length} of ${checks} checks failed${FAULT === null ? '' : ` under --fault=${FAULT}`}`,
  );
  process.exit(1);
}
console.log(
  `\nall ${checks} checks passed${FAULT === null ? '' : ` — but --fault=${FAULT} should have failed`}`,
);
if (FAULT !== null) process.exit(1);
