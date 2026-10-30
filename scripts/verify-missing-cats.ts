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
 * - stranded: Belle let past the archive's west ward while Pumpkin sits on its
 *   plate can still walk to a stair that will take her once Pumpkin wanders
 *   off (`archive-ward-relights`);
 * - archive: the room's own way through, end to end: the dumbwaiter's bell
 *   sends the warden out of its room to peer into the hatch, Belle crosses the
 *   south doorway and the west room unseen meanwhile, the board batted off its
 *   shelf bridges the hole, the jar batted off the north shelf lands on the
 *   plate and puts the west ward out, and the stair down is then a walk away
 *   (`archive-bell-unanswered`);
 * - keeper: Belle wakes to Pumpkin's meeting once; out of her cage in the open
 *   under the keeper's look she is caught and shut back in her cage with its
 *   latch to work again, inside her own open cage she is never caught, and
 *   every cage front has a tile within a short dash that the keeper's look
 *   never takes in, hunting a jostle it heard or not; a jostle it hears at a
 *   latch beyond its reach sends it over to catch a Belle who stays, and a
 *   Belle who slips into cover outlasts its search (`cattery-keeper-blind`,
 *   `cattery-keeper-deaf`, `cattery-cage-unsafe`); past her
 *   cattery chapter, Belle back in the cattery under its look is never shut
 *   in again, and a cattery rebuilt from any phase with her latch worked or
 *   not holds her in her cage only behind a latch she can work;
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
 * - tuna: the tuna sent up is eaten as it arrives, leaving nothing at the
 *   archive's hatch, and the cellmate takes a counterweight plate on the
 *   bell storey (`cellmate-unfed`);
 * - portcullis: the dropped counterweight raises the kitchen's portcullis,
 *   live and in every later build of the storey (`kitchen-built-shut`);
 * - no exit: completing adds no way off the floor (`completion-descends`);
 * - paid once: the rewards are paid once, however often the inn is
 *   rebuilt or reloaded from the last save afterwards (`complete-not-saved`);
 * - hush: the reward is a hushing piece in Belle's bag; worn, an unalerted rat
 *   notices its wearer, and the other crawler beside her, only inside the
 *   hushed share of its range, notices the other crawler once she strays
 *   past the hush, and answers from its whole range once alerted
 *   (`reward-bell-loud`);
 * - fight stair: while the Warden is up, the cattery's stair down refuses
 *   (`fight-stair-open`);
 * - descent: once the Warden falls, the tower that stood built through the
 *   fight is walked from the cattery to the street door: every stair down
 *   takes the party and is a walk from where it lands, no guard or raveling
 *   keeps watch, no ward is lit and the bells strike no one
 *   (`tower-stands-guard-after-warden`);
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
import { PLAYER_SPEED, TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../src/core/constants';
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
  withGroupAt,
  withLiveGroup,
  type ExchangePointId,
  type PartyLocation,
  type PartySplitSnapshot,
  type PartySplitState,
} from '../src/core/party/partySplit';
import type { MercenaryTemplateId } from '../src/core/party/mercenaryTemplates';
import {
  KITCHEN_STAGES,
  MISSING_CATS_PHASES,
  captureMissingCatsProgress,
  cellmateFed,
  createMissingCatsProgress,
  missingCatsProgressAt,
  nextKitchenStage,
  parseMissingCatsProgressCheckpoint,
  phaseReached,
  restoreMissingCatsProgress,
  stormDrainOpenFor,
  towerLoanOffered,
  type KitchenStage,
  type MissingCatsClueId,
  type MissingCatsPhase,
  type MissingCatsProgress,
  type MissingCatsProgressCheckpoint,
} from '../src/core/quests/missingCatsProgress';
import { CLUE_PLACES, nextInvestigationClue } from '../src/core/quests/missingCatsLeads';
import {
  collectTrackerEntries,
  type TrackerEntry,
  type TrackerTarget,
} from '../src/systems/questTracker';
import {
  autoPinQuest,
  captureJournalProgress,
  createJournalProgress,
  restoreJournalProgress,
  type JournalProgress,
  type JournalProgressCheckpoint,
} from '../src/core/quests/JournalProgress';
import { parseJournalProgressCheckpoint } from '../src/core/save/PersistedWorldState';
import {
  pinnedInteriorLead,
  pinnedStreetEntry,
  standingTile,
} from '../src/systems/questRoute/pinnedLead';
import type { ResidentId } from '../src/core/state/residentIds';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { Player } from '../src/Player';
import { TheLich } from '../src/creatures/TheLich';
import { TowerGuard } from '../src/creatures/TowerGuard';
import { Raveling } from '../src/creatures/Raveling';
import { TOWER_SPLIT_BAR_S } from '../src/audio/music/stemSets';
import { Conversation } from '../src/dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../src/dialog/request';
import { innWallSitterLines } from '../src/dialog/scripts/scenes/missingCats';
import { level3 } from '../src/levels/level3';
import { STORM_DRAIN_ID, TOWN_TOWER_ID, type BuildingId } from '../src/map/buildingIds';
import { findPartyArrivalTiles } from '../src/map/findWalkableTile';
import { GameMap, TOWER_FLOOR_COUNT, TOWER_TOP_FLOOR } from '../src/map/GameMap';
import { CutsceneDirector, type CutsceneCueClock } from '../src/systems/cutscene/CutsceneDirector';
import {
  noWorldActions,
  type CutsceneScript,
  type CutsceneStep,
} from '../src/systems/cutscene/cutsceneSteps';
import {
  CAPTURE_ACTOR_IDS,
  CAPTURE_DROP_AFTER_PRETENCE_S,
  CaptureStaging,
  captureScript,
  type CaptureScriptActorId,
} from '../src/systems/missingCats/captureCutscene';
import { CAPTURE_RAVELING_LANDS_AT_S } from '../src/audio/missingCatsSoundCues';
import { PRISON_TILE, type PrisonGrid } from '../src/map/goblinPrisonPlan';
import {
  CONVEYOR_PLACEMENTS,
  TOWER_DUMBWAITER_CONVEYOR_ID,
  plateSetsFor,
} from '../src/map/town/interiors/roomMechanisms';
import {
  ARCHIVE_FIXED_WARDS,
  ARCHIVE_BRIDGE_TILES,
  ARCHIVE_KNOCKABLES,
  ARCHIVE_WARD_PLATE,
  BELL_STOREY_PLATES,
  BELL_STOREY_BEAMS,
  BELL_STOREY_BEAM_ROWS,
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
  type CatteryCageOccupant,
  type TowerStoreyId,
} from '../src/map/town/interiors/townCenterTower';
import type { TilePoint } from '../src/map/town/townPlan';
import { mulberry32 } from '../src/sprites/person/rng';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps';
import { CatAllySystem } from '../src/systems/CatAllySystem';
import { presentCrawlers, type SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import {
  LodgeCellarDefence,
  type LodgeCellarStart,
} from '../src/systems/missingCats/LodgeCellarDefence';
import { MissingCatsInteriorSystem } from '../src/systems/missingCats/MissingCatsInteriorSystem';
import { MISSING_CATS_QUEST_ID } from '../src/systems/missingCats/missingCatsPhase';
import { MissingCatsQuestSystem } from '../src/systems/missingCats/MissingCatsQuestSystem';
import { reserveInnWallSitterTile } from '../src/systems/missingCats/innWallSitter';
import { tileKey } from '../src/systems/tileKey';
import { planStakeout } from '../src/systems/missingCats/rooftopThief';
import { MISSING_CATS_COMPLETION_COINS } from '../src/systems/missingCats/missingCatsRewards';
import {
  BELLE_CAGE_LOCATION,
  MISSING_CATS_CHAPTERS,
  missingCatsSplitUnderWay,
  towerStairLanding,
} from '../src/systems/missingCats/missingCatsSplit';
import { ArchiveWorks } from '../src/systems/tower/archiveWorks';
import { CatteryWorks } from '../src/systems/tower/catteryWorks';
import { SPLIT_STAIR_REFUSAL, TowerChapters } from '../src/systems/missingCats/towerChapters';
import {
  CatteryKeeper,
  KEEPER_LOOK_REACH_PX,
  KEEPER_LOOK_SOFT_EDGE,
  KEEPER_NOTICE,
  KEEPER_DRIFT_PERIOD_FRAMES,
  KEEPER_DRIFT_TILES,
  KEEPER_LOOK_FRAMES,
  KEEPER_ROUND_FRAMES,
  KEEPER_SEARCH_FRAMES,
  keeperEyeBlocked,
  keeperSightGrid,
} from '../src/systems/tower/catteryKeeper';
import {
  bodyTouchesGuard,
  CAUGHT_AFTER_SEEN_FRAMES,
  CAUGHT_AFTER_SEEN_SECONDS,
  crawlerSighting,
  GUARD_FRONT_REACH_PX,
  lightSeesBody,
  stepSuspicion,
  SUSPICION_CAPTURE,
  SUSPICION_ORANGE_ALERT,
  type PrisonPoint,
} from '../src/systems/stealthKeySnatch/detection';
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
import { CraftExplainers } from '../src/ui/screens/dialogs/CraftExplainers';
import { CAT_SENSES_EXPLAINER } from '../src/ui/screens/dialogs/catSensesExplainer';
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
import {
  CELLMATE_NOTE_ITEM,
  KitchenWorks,
  TUNA_TIN_ITEM,
  tunaHolder,
} from '../src/systems/tower/kitchenWorks';
import {
  towerStep,
  towerStepTarget,
  type TowerStepCarried,
  type TowerStepPhase,
} from '../src/systems/missingCats/towerSteps';
import {
  interiorObjectiveRoute,
  type InteriorObjectiveRoute,
} from '../src/systems/questRoute/interiorObjectiveRoute';
import { doorwayBeaconTarget } from '../src/systems/objectiveBeaconTargets';
import { towerDoorRefusal, towerDoorStandingFor } from '../src/systems/tower/towerDoor';
import { TowerRitualSystem } from '../src/systems/tower/TowerRitualSystem';
import { TowerStoreysSystem } from '../src/systems/tower/TowerStoreysSystem';
import { despawnMob } from '../src/creatures/Mob';
import { RAT_AGGRO_RANGE_TILES, Rat } from '../src/creatures/Rat';
import { ITEM_DEF, isItemId, type ItemId } from '../src/core/items/defs/ItemDefs';
import { traitHandler, type GearTraitOf } from '../src/gear/traits';
import { GearSystem } from '../src/systems/GearSystem';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import type { StairDirection, StairRefusal } from '../src/systems/TowerStairSystem';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';
import { PLAYTEST_PRESETS, type PlaytestPreset } from '../src/dev/playtestPresets';
import { createMercenaryRoster, type MercenaryRoster } from '../src/core/party/MercenaryRoster';
import { parseGameProgress, stampGameProgress } from '../src/core/save/saveFormat';
import type { GameProgress } from '../src/auth/AuthClient';
import { snapPlayer } from '../src/core/save/PlayerSnapshot';
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
import { cameraAt, UNZOOMED } from '../src/core/rendering/camera.js';

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
  'cattery-keeper-blind',
  'cattery-keeper-deaf',
  'cattery-cage-unsafe',
  'archive-ward-relights',
  'archive-bell-unanswered',
  'reunion-not-saved',
  'fight-not-saved',
  'tower-loan-twice',
  'tower-loan-outlives-warden',
  'street-save-pulled-indoors',
  'cat-sense-cue-silent',
  'cat-sense-unseen',
  'capture-drop-off-hit',
  'fight-stair-open',
  'tower-stands-guard-after-warden',
  'reward-bell-loud',
  'kitchen-press-skips-a-step',
  'journal-reads-door-bags',
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

/** Breaks the archive's west ward so that it is out only while something stands on its plate. */
function relightWardOffItsPlate(): void {
  const original = methodOf(ArchiveWorks.prototype, 'noteWardPlate');
  breakMethod(ArchiveWorks.prototype, 'noteWardPlate', function (this: ArchiveWorks) {
    this['deps'].progress.westWardOut = false;
    return original(this);
  });
}

/** Breaks the split's stair rule so that `refusal` is never given. */
function dropStairRefusal(refusal: StairRefusal): void {
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
/** Belle trails the steered human this far behind as they reach the fountain: off the rim, but near enough to walk onto it herself. */
const BELLE_TRAILS_TO_BAIT_ROWS = 4;
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

/** The Journal's pin as a save writes it. */
function writeJournalSave(journal: JournalProgress): string {
  return JSON.stringify(captureJournalProgress(journal));
}

/** The Journal's pin read back through the game's own parser; null when it refuses it. */
function readJournalSave(text: string): JournalProgressCheckpoint | null {
  return parseJournalProgressCheckpoint(JSON.parse(text)) ?? null;
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
  /** What the Journal follows, pinned as the scenes pin it. */
  readonly journal: JournalProgress = createJournalProgress();
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

  constructor(record: RunRecord | null, journal: JournalProgressCheckpoint | null = null) {
    this.progress = createMissingCatsProgress();
    this.split = createPartySplitState();
    if (record !== null) {
      restoreMissingCatsProgress(this.progress, record.missingCats);
      restorePartySplit(this.split, record.partySplit);
    }
    if (journal !== null) restoreJournalProgress(this.journal, journal);
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

  /** `journal` is the Journal's lines where the bus is, which a quest started there is pinned against. */
  listen(bus: EventBus, journal: () => ReadonlyArray<TrackerEntry> = () => []): void {
    const notePhase = (): void => this.notePhase();
    bus.on('questStarted', ({ questId }) => {
      autoPinQuest(this.journal, questId, journal());
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

/** Every line any rig's conversation has opened with, in the order they were said. */
const spokenLines: string[] = [];

/** The scene's conversation box, writing down every line it is asked to show. */
class RecordingConversation extends Conversation {
  constructor() {
    super(null);
  }

  override open(request: ConversationRequest): ConversationHandle {
    for (const line of request.lines) {
      if ('paragraphs' in line) spokenLines.push(line.paragraphs.join(' '));
    }
    return super.open(request);
  }
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
  /** Ward lines added and not yet taken down. */
  readonly liveWardLines = new Set<WardLine>();

  override add<S extends SenseId>(sense: S, source: SenseSources[S]): SenseSourceHandle {
    if (isScentTrail(source)) this.scentTrails.push(source);
    const handle = super.add(sense, source);
    if (!isWardLine(source)) return handle;
    this.wardLines.push(source);
    this.liveWardLines.add(source);
    return {
      remove: () => {
        this.liveWardLines.delete(source);
        handle.remove();
      },
    };
  }
}

function standOn(body: { x: number; y: number }, tile: TilePoint): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
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
  readonly conversation = new RecordingConversation();
  readonly senses = new RecordingSenses();
  readonly cutscenes = new CutsceneStandIn();
  readonly pm: PlayerManager;
  readonly director: SplitDirector;
  readonly quest: MissingCatsQuestSystem;
  /** Every quest the Journal was asked to follow from this street. */
  readonly followed: string[] = [];
  readonly journal: JournalProgress;

  constructor(run: Run, at: TilePoint) {
    this.journal = run.journal;
    run.listen(this.bus, () => this.journalEntries());
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
      partyOnShow: () => ({ human: run.human, cat: run.cat }),
      steered: () => this.pm.active(),
      present: () => this.pm.presentCrawlers(),
      announce: () => undefined,
      barks: { say: () => undefined },
      noticeBoardTile: () => null,
      noticeBoardOpen: () => false,
      save: () => run.save(),
      senses: this.senses,
      playCutscene: (script, onComplete) => this.cutscenes.play(script, onComplete),
      cutsceneHides: () => false,
      split: this.director,
      hire: () => run.hire,
      followQuest: (questId) => {
        this.followed.push(questId);
        autoPinQuest(this.journal, questId, this.journalEntries());
      },
    });
  }

  here(): Place {
    return { kind: 'overworld', tile: tileStoodOn(this.pm.active()) };
  }

  /** The Journal's lines as the floor scene gathers them, from the one source this street has. */
  journalEntries(): TrackerEntry[] {
    return collectTrackerEntries([this.quest]);
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
  readonly conversation = new RecordingConversation();
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
      standingInRoom: () => ({ bodies: [run.human, run.cat], roster: this.roster }),
      audio: null,
      speechStyleOf: () => null,
      prewarmHurryOf: () => undefined,
      startCellarDefence: () => this.raiseCellarDefence('lid_just_opened'),
      daveTalking: () => false,
      readingOpen: () => false,
      onItemGranted: () => undefined,
      playCutscene: (script, onComplete) => this.cutscenes.play(script, onComplete),
      reunionReady: () => !this.cutscenes.busy && !this.conversation.isOpen,
      daveHome: () => this.map.startTile,
      pinnedTrackerId: () => MISSING_CATS_QUEST_ID,
      hire: () => run.hire,
      readableNamed: () => null,
      music: null,
      save: () => run.save(),
    });
    if (interior === null) throw new Error(`no questline system in ${building}`);
    this.interior = interior;
    if (interior.cellarDefenceOwedOnEntry) this.raiseCellarDefence('resumed');
  }

  /** The elves fighting beside the party in the cellar, none before the fight. */
  cellarElves(): number {
    return this.defence?.allyTargets().length ?? 0;
  }

  private raiseCellarDefence(start: LodgeCellarStart): void {
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
      start,
      audio: null,
      onElvesArrived: () => this.interior.elvesArrived(),
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
    if (this.interior.daveRefusalOwed && !this.conversation.isOpen)
      this.interior.tellDaveThePlan(null, () => undefined);
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
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
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
  readonly conversation = new RecordingConversation();
  readonly cutscenes = new CutsceneStandIn();
  readonly floors: TowerFloor[] = [];
  readonly pm: PlayerManager;
  readonly director: SplitDirector;
  readonly cellmate: CatAllySystem;
  readonly cellmateOrders: string[] = [];
  /** Companions a check stands in the tower beside the crawlers, for its watchers to see. */
  readonly companions: Player[] = [];
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
      removeMob: (index, mob) => {
        const { roster } = this.floors[index];
        despawnMob(mob, roster.mobs, roster.grid);
      },
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
      presentCompanions: () => this.companions,
      regroupCompanions: () => undefined,
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
  takeStair(going: StairDirection): StairRefusal | null {
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
  readonly run: Run;
  private rig: Rig;
  stalled: string | null = null;

  /** From the inn's first line, or from `start`, a phase the walk recorded, to try one step of it again on its own. */
  constructor(start: PhaseSnapshot | null = null) {
    this.run = new Run(start?.record ?? null);
    if (start !== null) {
      this.rig = rigAt(this.run, start.place);
      return;
    }
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

// ── The regular outside the inn ─────────────────────────────────────────────

/** Whether the regular on the bench outside the inn wears the `!` this frame. */
function innWallSitterMarked(town: TownRig): boolean {
  return (
    methodOf(MissingCatsQuestSystem.prototype, 'innWallSitterIcon')(town.quest) === 'available'
  );
}

/** Talks to the regular from the tile beside the bench; the line said, or null when nobody answered. */
function talkToInnWallSitter(walk: Walk, town: TownRig): string | null {
  const sitter = firstOf(town.quest.sortedFigures());
  if (sitter === undefined) return null;
  const human = walk.run.human;
  human.x = sitter.x + TILE_SIZE;
  human.y = sitter.y;
  const said = spokenLines.length;
  const took = walk.act(() => town.quest.tryTalkToInnWallSitter(human));
  return took ? spokenLines.slice(said).join(' ') : null;
}

/**
 * The regular's bench, claimed as the scene claims it before the props and
 * the crowd: solid to every body, held back from prop placement, on the tile
 * the regular is drawn on, and leaving the inn's doorway and its step open.
 */
function checkInnWallSitterBench(town: TownRig): void {
  const reserved = [...reserveInnWallSitterTile(TOWN_MAP)];
  const sitter = firstOf(town.quest.sortedFigures());
  const sitterKey =
    sitter === undefined ? null : tileKey(sitter.x / TILE_SIZE, sitter.y / TILE_SIZE);
  check(
    'inn regular',
    reserved.length === 1 && reserved[0] === sitterKey,
    'the reserved bench tile is the one the regular sits on',
  );
  if (sitter === undefined) return;
  const benchX = sitter.x / TILE_SIZE;
  const benchY = sitter.y / TILE_SIZE;
  check(
    'inn regular',
    !TOWN_MAP.isWalkable(benchX, benchY, 'walker'),
    'nobody can walk through the regular on the bench',
  );
  const inn = townEntry(INN);
  const step = doorstepOf(inn);
  const doorwayColumns = Array.from({ length: inn.doorway.width }, (_, i) => inn.doorway.x0 + i);
  const approachOpen = doorwayColumns.every(
    (x) =>
      TOWN_MAP.isWalkable(x, inn.doorTile.y, 'walker') && TOWN_MAP.isWalkable(x, step.y, 'walker'),
  );
  check('inn regular', approachOpen, "the inn's doorway and its step stay open beside the bench");
  check(
    'inn regular',
    !doorwayColumns.includes(benchX) && benchY === step.y,
    "the bench stands on the step's row, clear of the doorway",
  );
}

/** What the regular says, compared as text alone, which is the same in either voice. */
const INN_WALL_SITTER_LINES = innWallSitterLines('townsfolkFeminine');

/**
 * The regular on the bench by the inn's door: marked until the party has
 * heard them or asked Ossie, pointing the Journal at the inn once, and glad
 * once Biscuit is home.
 */
function checkInnWallSitter(): void {
  section('The regular outside the inn points the party at Ossie');
  const first = new Walk();
  const town = first.street();
  check('inn regular', town.quest.sortedFigures().length === 1, 'a regular sits outside the inn');
  check(
    'inn regular',
    innWallSitterMarked(town),
    'the regular wears a ! before anyone asks at the inn',
  );
  const heard = talkToInnWallSitter(first, town);
  check(
    'inn regular',
    heard === INN_WALL_SITTER_LINES.catMissing.paragraphs.join(' '),
    "the regular talks about the innkeeper's missing cat",
  );
  check(
    'inn regular',
    town.followed.join(' ') === MISSING_CATS_QUEST_ID,
    `hearing the regular points the Journal at the questline once (${town.followed.join(', ')})`,
  );
  check('inn regular', !innWallSitterMarked(town), 'the ! goes once the regular is heard');
  const entry = firstOf(town.quest.trackerEntries());
  check(
    'inn regular',
    entry?.target?.building === INN,
    'the Journal then points at the Sleeping Cat Inn',
  );
  talkToInnWallSitter(first, town);
  check('inn regular', town.followed.length === 1, 'hearing the regular again points nowhere new');
  checkInnWallSitterBench(town);
  const saved = parseMissingCatsProgressCheckpoint(
    JSON.parse(JSON.stringify(captureMissingCatsProgress(first.progress))),
  );
  check(
    'inn regular',
    saved?.innWallSitterHeard === true,
    'a save remembers the regular was heard',
  );

  const second = new Walk();
  const inn = second.room(INN);
  second.act(() => inn.interior.tryOpenDialog('innkeep_ossie', second.run.human));
  const later = second.street();
  check(
    'inn regular',
    !innWallSitterMarked(later),
    "asking Ossie first takes the regular's ! away",
  );
  const stillSad = talkToInnWallSitter(second, later);
  check(
    'inn regular',
    stillSad === INN_WALL_SITTER_LINES.catMissing.paragraphs.join(' '),
    'the regular is still sad while Biscuit is gone',
  );
  check(
    'inn regular',
    later.followed.length === 0,
    'once the quest is under way the regular points nowhere',
  );
  second.progress.phase = 'aftermath';
  const glad = talkToInnWallSitter(second, later);
  check(
    'inn regular',
    glad === INN_WALL_SITTER_LINES.catHome.paragraphs.join(' '),
    'with Biscuit home the regular says so',
  );
}

// ── Where the investigation sends the party ─────────────────────────────────

/** One thing done in the investigation, and the clue the story should point at once it is. */
type LeadStep =
  | { readonly kind: 'notices'; readonly then: MissingCatsClueId }
  | {
      readonly kind: 'owner';
      readonly building: BuildingId;
      readonly owner: ResidentId;
      readonly then: MissingCatsClueId;
    }
  | { readonly kind: 'spot'; readonly building: BuildingId; readonly then: MissingCatsClueId }
  | { readonly kind: 'ledger'; readonly then: MissingCatsClueId }
  | { readonly kind: 'scent'; readonly then: null };

/**
 * The investigation in an order that leaves sites half-done behind it: the
 * dish sends the party to the store while Lori's cottage is still untouched,
 * and the store's order book is read before anywhere else is finished.
 */
const LEAD_WALK: readonly LeadStep[] = [
  { kind: 'notices', then: 'inn_scent_trail' },
  {
    kind: 'owner',
    building: APOTHECARY,
    owner: 'taloncrest_apothecary_assistant',
    then: 'apothecary_tuna_dish',
  },
  { kind: 'spot', building: APOTHECARY, then: 'store_tuna_ledger' },
  { kind: 'ledger', then: 'inn_scent_trail' },
  { kind: 'owner', building: COTTAGE, owner: 'old_lori', then: 'cottage_latch' },
  { kind: 'spot', building: COTTAGE, then: 'inn_scent_trail' },
  { kind: 'owner', building: MILL, owner: 'marta_miller', then: 'mill_hayloft_feather' },
  { kind: 'spot', building: MILL, then: 'inn_scent_trail' },
  { kind: 'scent', then: null },
];

function describeLeadStep(step: LeadStep): string {
  switch (step.kind) {
    case 'notices':
      return 'reading the notices';
    case 'owner':
      return `asking ${step.owner}`;
    case 'spot':
      return `examining the clue in ${step.building}`;
    case 'ledger':
      return "reading the store's order book";
    case 'scent':
      return 'following the scent to its end';
  }
}

/** The building a step is taken in, or null for one taken on the street. */
function leadStepBuilding(step: LeadStep): BuildingId | null {
  switch (step.kind) {
    case 'owner':
    case 'spot':
      return step.building;
    case 'ledger':
      return STORE;
    case 'notices':
    case 'scent':
      return null;
  }
}

function takeLeadStep(walk: Walk, step: LeadStep): boolean {
  switch (step.kind) {
    case 'notices': {
      const inn = walk.room(INN);
      walk.act(() => inn.interior.tryOpenDialog('innkeep_ossie', walk.run.human));
      const town = walk.street();
      walk.act(() => town.quest.onNoticeBoardRead());
      walk.tick();
      walk.settleTalk();
      return walk.progress.phase === 'investigating';
    }
    case 'owner': {
      const room = walk.room(step.building);
      return walk.act(() => room.interior.tryOpenDialog(step.owner, walk.run.human));
    }
    case 'spot': {
      const room = walk.room(step.building);
      return walk.act(() => room.interactSomewhere());
    }
    case 'ledger': {
      const store = walk.room(STORE);
      walk.act(() => store.interior.onReadableOpened(STORE_ORDER_BOOK_ID));
      walk.tick();
      walk.settleTalk();
      return walk.progress.clues.has('store_tuna_ledger');
    }
    case 'scent': {
      const town = walk.street();
      walk.steer('cat');
      walk.tick();
      const end = lastOf(lastOf(town.senses.scentTrails)?.points ?? []);
      if (end === undefined) return false;
      walk.run.cat.x = end.x - TILE_SIZE / 2;
      walk.run.cat.y = end.y - TILE_SIZE / 2;
      walk.tick();
      walk.settleTalk();
      walk.steer('human');
      return walk.progress.clues.has('inn_scent_trail');
    }
  }
}

/**
 * The tile the Journal should lead to for the place a clue is found: the
 * trail's start for the inn's scent, the beam's tile on its door otherwise.
 * Null when there is no such tile to lead to.
 */
function clueTile(town: TownRig, clue: MissingCatsClueId): TilePoint | null {
  if (clue === 'inn_scent_trail') {
    const start = firstOf(lastOf(town.senses.scentTrails)?.points ?? []);
    return start === undefined ? null : standingTile(start);
  }
  return doorwayBeaconTarget(townEntry(CLUE_PLACES[clue].building));
}

function describeTile(tile: { readonly x: number; readonly y: number } | null | undefined): string {
  return tile === null || tile === undefined ? 'nowhere' : `(${tile.x}, ${tile.y})`;
}

function sameTile(
  a: { readonly x: number; readonly y: number } | undefined,
  b: { readonly x: number; readonly y: number } | null,
): boolean {
  return a !== undefined && b !== null && a.x === b.x && a.y === b.y;
}

/** Whether any of the questline's Journal lines points anywhere. */
function anyMissingCatsTarget(town: TownRig): boolean {
  return town.quest.trackerEntries().some((entry) => entry.target !== undefined);
}

/**
 * With Belle steered beside the scent trail the scent is the way, so the
 * Journal points nowhere; the human steered there still gets the arrow.
 */
function checkTrailLeadsAlone(walk: Walk): void {
  const town = walk.street();
  walk.steer('human');
  town.tick();
  const start = firstOf(lastOf(town.senses.scentTrails)?.points ?? []);
  if (start === undefined) {
    check('leads', false, 'a scent trail is laid outside the inn');
    return;
  }
  placeFeetAt(walk.run.human, start);
  town.tick();
  check('leads', anyMissingCatsTarget(town), 'the human beside the trail is still pointed at it');
  walk.steer('cat');
  placeFeetAt(walk.run.cat, start);
  town.tick();
  check(
    'leads',
    !anyMissingCatsTarget(town),
    'Belle beside the trail is pointed nowhere but along the scent',
  );
  walk.steer('human');
}

/** Where the party stands just inside `building`, on the storey its street door opens onto, as its scene reads it. */
function standingInsideDoorOf(building: BuildingId): Parameters<typeof pinnedInteriorLead>[2] {
  const entry = townEntry(building);
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(entry.type, 0, entry.id, entry.hasSafeRoom === true);
  return {
    building: entry.id,
    doorTile: entry.doorTile,
    storey: 0,
    isTower: entry.type === 'tower',
    hasStreetDoor: map._interiorExitTiles.length > 0,
  };
}

/**
 * Every pointer the scenes resolve from the pin the save holds, judged on
 * the tile `clue` is found at: the street arrow from the crawler's own tile,
 * and, when the step was taken indoors, the way that room leads, resolved
 * from its door: out of the street door toward that tile, or nowhere when
 * the clue is in the room itself.
 */
function checkLeadPointers(
  town: TownRig,
  takenIn: BuildingId | null,
  clue: MissingCatsClueId,
  when: string,
): void {
  const place = CLUE_PLACES[clue];
  const expected = clueTile(town, clue);
  const entries = town.journalEntries();
  check(
    'leads',
    town.journal.pinnedTrackerId === MISSING_CATS_QUEST_ID,
    `${when} the Journal follows the questline (${town.journal.pinnedTrackerId ?? 'nothing'})`,
  );
  const arrow = pinnedStreetEntry(town.journal, entries, town.pm.active())?.target;
  check(
    'leads',
    sameTile(arrow, expected),
    `${when} the street arrow points at ${place.name} ${describeTile(expected)} (${describeTile(arrow)})`,
  );
  if (takenIn === null) return;
  const lead = pinnedInteriorLead(town.journal, entries, standingInsideDoorOf(takenIn));
  const clueInThisRoom = place.building === takenIn;
  const expectedRoute = clueInThisRoom ? 'none' : 'street_door';
  check(
    'leads',
    lead.route.kind === expectedRoute,
    `${when} the way on from ${takenIn} is ${expectedRoute} (${lead.route.kind})`,
  );
  if (clueInThisRoom) return;
  check(
    'leads',
    sameTile(lead.entry?.target, expected),
    `${when} the way out of ${takenIn} leads to ${place.name} ${describeTile(expected)} (${describeTile(lead.entry?.target)})`,
  );
}

/**
 * Every step of the investigation: the story points where the step says it
 * should, the Journal's arrow points at that clue's place, and whenever that
 * place is somewhere other than where the step was taken, the party has just
 * named it aloud.
 */
function checkInvestigationLeads(): void {
  section('The investigation, guided where the party says it is going');
  const walk = new Walk();
  for (const step of LEAD_WALK) {
    if (step.kind === 'scent') checkTrailLeadsAlone(walk);
    const said = spokenLines.length;
    const where = describeLeadStep(step);
    const took = takeLeadStep(walk, step);
    check('leads', took, `${where} was taken`);
    if (!took) return;
    const spoken = spokenLines.slice(said).join(' ');
    const story = nextInvestigationClue(walk.progress);
    check(
      'leads',
      story === step.then,
      `after ${where} the story points at ${step.then} (${story})`,
    );
    if (step.then === null) {
      check(
        'leads',
        walk.progress.phase === 'blame',
        `after ${where} the investigation is solved (${walk.progress.phase})`,
      );
      continue;
    }
    const place = CLUE_PLACES[step.then];
    const takenIn = leadStepBuilding(step);
    const town = takenIn === null ? walk.street() : walk.street(doorstepOf(townEntry(takenIn)));
    walk.steer('human');
    town.tick();
    checkLeadPointers(town, takenIn, step.then, `after ${where}`);
    const reloaded = new TownRig(
      new Run(
        readSave(writeSave(walk.run.record)),
        readJournalSave(writeJournalSave(walk.run.journal)),
      ),
      tileStoodOn(walk.run.human),
    );
    reloaded.tick();
    checkLeadPointers(reloaded, takenIn, step.then, `after ${where} and a reload`);
    reloaded.dispose();
    const sentElsewhere = place.building !== takenIn;
    if (sentElsewhere) {
      check(
        'leads',
        spoken.toLowerCase().includes(place.name.toLowerCase()),
        `after ${where} the party names ${place.name} before the Journal points there`,
      );
    }
  }
}

/** Far enough from any sense that Belle's cue stays off, in tiles. */
const CAT_SENSE_FAR_TILES = 40;
/** One frame's step on the cue's clock. */
const CAT_SENSE_FRAME_MS = 16;

/** A cue built over recording stand-ins for the scene's barks, audio, explainers and stats. */
function recordingCatSenseCue(): {
  readonly cue: CatSenseCue;
  readonly played: SoundId[];
  readonly said: string[];
  readonly explainers: CraftExplainers;
  readonly stats: GameStats;
} {
  const played: SoundId[] = [];
  const said: string[] = [];
  const explainers = new CraftExplainers();
  explainers.register('cat_senses', CAT_SENSES_EXPLAINER);
  const stats = new GameStats();
  const cue = new CatSenseCue({
    barks: { say: (_crawler, lines) => said.push(...lines) },
    audio: { playRandom: (ids) => played.push(...ids.slice(0, 1)) },
    explainers,
    stats,
  });
  return { cue, played, said, explainers, stats };
}

function placeFeetAt(body: { x: number; y: number }, at: { x: number; y: number }): void {
  body.x = at.x - TILE_SIZE / 2;
  body.y = at.y - TILE_SIZE / 2;
}

/** The cues heard by the time the one held back by a busy party plays: the first, the re-armed one, and it. */
const CUES_ONCE_FREED = 3;
/** The length of the ward line laid alone, in tiles. */
const LONE_WARD_TILES = 4;

/** Halfway along a trail, by its points: away from both its start and its end. */
const MID_TRAIL_SHARE = 0.5;

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
  const end = lastOf(trail.points);
  const middle = itemAt(trail.points, Math.floor(trail.points.length * MID_TRAIL_SHARE));
  if (start === undefined || end === undefined || middle === undefined) {
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
  frame(end);
  check('cat senses', !rig.cue.showing, "the cue stays off at the trail's end");
  frame(middle);
  check('cat senses', !rig.cue.showing, 'the cue stays off halfway along the trail');
  check('cat senses', rig.played.length === 0, 'nothing plays away from where the trail starts');
  frame(far);
  frame(start);
  check('cat senses', rig.cue.showing, "the cue turns on at the trail's start");
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
  check(
    'cat senses',
    rig.explainers.openId === 'cat_senses',
    'the first cue in a run opens the senses explainer',
  );
  check('cat senses', rig.stats.catSensesExplained, 'the explainer is recorded as shown');
  rig.explainers.close();
  frame(middle);
  check('cat senses', rig.cue.showing, 'the cue holds while she walks the trail');
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
  check('cat senses', !rig.explainers.isOpen, 'the explainer is shown only once in a run');
  frame(far);
  nowMs += CAT_SENSE_REARM_MS;
  frame(start, false);
  check('cat senses', rig.played.length === 2, 'the cue waits while the party is held');
  frame(start);
  check(
    'cat senses',
    rig.played.length === CUES_ONCE_FREED,
    'the cue plays once the party is free again',
  );

  const uncued = new SenseLayer();
  uncued.add('scent', trail);
  const uncuedRig = recordingCatSenseCue();
  placeFeetAt(cat, end);
  uncued.update(cat, nowMs, true);
  placeFeetAt(cat, start);
  nowMs += CAT_SENSE_FRAME_MS;
  uncuedRig.cue.update({ senses: uncued, cat, steered: cat, calm: true, nowMs });
  check(
    'cat senses',
    uncuedRig.cue.showing,
    "reaching a trail's end without ever being cued on it does not count as following it",
  );

  const followed = new SenseLayer();
  followed.add('scent', trail);
  const followRig = recordingCatSenseCue();
  placeFeetAt(cat, start);
  followed.update(cat, nowMs, true);
  placeFeetAt(cat, end);
  followed.update(cat, nowMs, true);
  placeFeetAt(cat, far);
  nowMs += CAT_SENSE_REARM_MS;
  followRig.cue.update({ senses: followed, cat, steered: cat, calm: true, nowMs });
  placeFeetAt(cat, start);
  nowMs += CAT_SENSE_FRAME_MS;
  followRig.cue.update({ senses: followed, cat, steered: cat, calm: true, nowMs });
  check(
    'cat senses',
    !followRig.cue.showing && followRig.played.length === 0,
    'a trail Belle was cued on and followed to its end never raises the cue again',
  );

  const ward = new SenseLayer();
  const wardFrom = { x: 0, y: 0 };
  const wardTo = { x: TILE_SIZE * LONE_WARD_TILES, y: 0 };
  ward.add('ward', {
    id: 'lone_ward',
    segments: [{ from: wardFrom, to: wardTo }],
    hurts: false,
    pulse: () => 1,
  });
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
  if (!walk.expect(held, 'the lodge cellar never held')) return false;
  return walk.expect(lodge.cellarElves() > 0, 'no elves came in to hold the cellar');
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
  walk.steer('human');
  const before = walk.run.transfers.length;
  standOn(walk.run.cat, { x: fountain.x, y: fountain.y + BELLE_TRAILS_TO_BAIT_ROWS });
  standOn(walk.run.human, fountain);
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'cattery', 'the capture never split the party'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the capture moved nobody to the cage');
}

function workTheCattery(walk: Walk): boolean {
  const tower = walk.tower();
  walk.until(() => walk.progress.cellmateMet);
  const metOnArrival = walk.progress.cellmateMet;
  flagChecks.push(() =>
    check('keeper', metOnArrival, 'Belle wakes in her cage to the meeting with Pumpkin'),
  );
  const watch = watchTheKeeper(tower.map);
  checkKeeperEyeStaysClear(tower.map);
  const hideouts = checkKeeperCover(tower.map, watch);
  const hideoutFor = (occupant: CatteryCageOccupant): TilePoint | null =>
    hideouts.get(occupant) ?? nearestShadow(watch.shadows, TOWER_CATTERY_CAGES[occupant]);
  const workLatch = (occupant: CatteryCageOccupant, done: () => boolean): boolean =>
    pressLatchUntil(walk, tower, TOWER_CATTERY_CAGES[occupant], done, hideoutFor(occupant));
  const belleCage = 'crawler_cat' as const satisfies CatteryCageOccupant;
  const belleUncaged = (): boolean => walk.progress.crawlerCatUncaged;
  if (!walk.expect(workLatch(belleCage, belleUncaged), "Belle never worked her cage's latch"))
    return false;
  const safeInCage = waitInOpenCage(walk, tower);
  flagChecks.push(() =>
    check('keeper', safeInCage, 'Belle inside her own open cage is never caught by the keeper'),
  );
  const recaged = catchBelleInTheOpen(walk, tower, watch.mostWatched);
  flagChecks.push(() => {
    check('keeper', recaged.caught, "Belle in the open under the keeper's look is caught");
    check('keeper', recaged.shutIn, 'Belle caught by the keeper is shut back in her cage');
    check('keeper', recaged.metOnce, 'the meeting with Pumpkin does not play again');
  });
  const belleOut = workLatch(belleCage, belleUncaged);
  if (!walk.expect(belleOut, "Belle never worked her cage's latch again")) return false;
  const farHideout = hideoutFor(FAR_LATCH_CAGE);
  if (farHideout === null) return walk.expect(false, 'the far latch has nowhere to hide from');
  const slippedAway = jostleTheFarLatch(walk, tower, farHideout, 'slips_away');
  const stayedPut = jostleTheFarLatch(walk, tower, farHideout, 'stays');
  flagChecks.push(() => {
    check('keeper', slippedAway.heard, 'the keeper hears a jostle at a latch beyond its reach');
    check(
      'keeper',
      !slippedAway.caught && !slippedAway.stillHunting,
      'Belle who slips into cover after a heard jostle outlasts the keeper, who gives up its hunt',
    );
    check('keeper', stayedPut.heard, 'the keeper hears a second jostle at the far latch');
    check(
      'keeper',
      stayedPut.caught,
      'Belle who stays at a far latch the keeper heard her jostle is caught',
    );
  });
  const belleOutAgain = workLatch(belleCage, belleUncaged);
  if (!walk.expect(belleOutAgain, "Belle never worked her cage's latch a third time")) return false;
  const heldForCellmate = tower.storeys.stairRefusal('down') !== null;
  flagChecks.push(() =>
    check(
      'stairs',
      heldForCellmate,
      "the cattery's stair refuses Belle while the cellmate is still caged",
    ),
  );
  const cellmateOut = workLatch('tower_cattery_cellmate', () => walk.progress.cellmateFreed);
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
  if (!solveTheArchive(walk, tower)) return false;
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

const ARCHIVE_DOWN_LANDING = towerStairLanding('archive', 'stairDown');
/**
 * Where Belle waits beyond the archive's west ward: beside the stair down's
 * landing, off the landing itself so standing there never takes the stair.
 */
const BEYOND_WEST_WARD: TilePoint = { x: ARCHIVE_DOWN_LANDING.x - ONE, y: ARCHIVE_DOWN_LANDING.y };
/** Where Pumpkin wanders to once she steps off the ward's plate: the tile south of it, on the near side of the ward. */
const OFF_THE_PLATE: TilePoint = { x: ARCHIVE_WARD_PLATE.at.x, y: ARCHIVE_WARD_PLATE.at.y + ONE };

/**
 * Pumpkin sits on the west ward's plate, Belle slips past the ward while it is
 * dark, and Pumpkin steps off again. Returns whether Belle is then stranded:
 * no stair the split will let her take can be walked to from where she is.
 * Puts both back by the cattery stair afterwards.
 */
/**
 * The archive as Belle's chapter opens on it, played again apart from the
 * walk, whose jar stays on the plate for good: with only Pumpkin there to
 * hold it down, the plate can be let go of again.
 */
function checkWestWardStaysOut(walk: Walk): void {
  section("Belle let past the archive's west ward by Pumpkin on its plate can still get back out");
  const snapshot = walk.run.snapshots.get('archive');
  check('stranded', snapshot !== undefined, 'archive was recorded on the walk');
  if (snapshot === undefined) return;
  const replay = new Walk(snapshot);
  replay.settleTalk();
  const stranded = strandBelleBehindTheWestWard(replay, replay.tower());
  check(
    'stranded',
    replay.stalled === null && !stranded,
    `Pumpkin wandering off the plate does not shut Belle in behind the west ward${replay.stalled === null ? '' : `: ${replay.stalled}`}`,
  );
}

function strandBelleBehindTheWestWard(walk: Walk, tower: TowerRig): boolean {
  const pumpkin = tower.cellmate.body;
  if (pumpkin === null) return walk.expect(false, 'Pumpkin is not with Belle on the archive');
  if (!layTheShelfBoard(walk, tower)) return walk.expect(false, 'Belle could not bridge the hole');
  const plate = ARCHIVE_WARD_PLATE.at;
  const wardTile = firstOf(ARCHIVE_FIXED_WARDS.west.tiles);
  if (wardTile === undefined) return walk.expect(false, 'the archive has no west ward');
  const wardDark = (): boolean => tower.map.isWalkable(wardTile.x, wardTile.y, 'walker');
  for (let frame = 0; frame < BEAT_FRAMES && !wardDark(); frame++) {
    standOn(pumpkin, plate);
    walk.tick();
  }
  if (!walk.expect(wardDark(), 'Pumpkin on the plate never put the west ward out')) return true;
  standOn(walk.run.cat, BEYOND_WEST_WARD);
  for (let frame = 0; frame < BEAT_FRAMES; frame++) {
    standOn(walk.run.cat, BEYOND_WEST_WARD);
    standOn(pumpkin, OFF_THE_PLATE);
    walk.tick();
  }
  const stairsOpen = tower.storeys.stairRefusal('down') === null;
  const exits = [
    ...tower.map._interiorStairUpTiles,
    ...(stairsOpen ? tower.map._interiorStairDownTiles : []),
  ];
  const stranded = !catReachesAny(tower.map, BEYOND_WEST_WARD, exits);
  const landing = towerStairLanding('archive', 'stairUp');
  standOn(walk.run.cat, landing);
  standOn(pumpkin, landing);
  walk.tick();
  return stranded;
}

/** Where Belle keeps out of the way while the warden answers the bell: the east room's north end, well off its path. */
const ARCHIVE_BELL_HIDE: TilePoint = { x: 12, y: 5 };
/** The way Belle slips from the east room through the south doorway, the ward's own tile stepped over, to the shelf top beside the leaning board. */
const ARCHIVE_DOORWAY_ROUTE: readonly TilePoint[] = [
  { x: 11, y: 8 },
  { x: 10, y: 9 },
  { x: 7, y: 9 },
  { x: 7, y: 8 },
];
/** Frames Belle lingers on each tile of a route: as long as a warden needs to see her. */
const ROUTE_LINGER_FRAMES = 45;

/**
 * The archive's own way through, as its fittings teach it: Belle rings the
 * dumbwaiter's bell and keeps clear while the warden goes out to the hatch;
 * while it peers in she crosses the south doorway and the west room, bats the
 * board across the hole, crosses it, and bats the jar off the north shelf onto
 * the plate, which puts the west ward out between her and the stair down.
 * Returns whether the walk can go on.
 */
function solveTheArchive(walk: Walk, tower: TowerRig): boolean {
  let answered = false;
  let caught = false;
  const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
    if (moment.kind === 'archive_bell_answered') answered = true;
    if (moment.kind === 'archive_caught') caught = true;
  });
  try {
    const bell = TOWER_DUMBWAITER.head.bell;
    let rang = false;
    for (const tile of tilesAround(bell, REACH_SEARCH_TILES)) {
      standOn(walk.run.cat, tile);
      if (tower.floor.mechanisms.conveyors.wouldInteract(walk.run.cat) && tower.interact()) {
        rang = true;
        break;
      }
    }
    if (!walk.expect(rang, 'Belle could reach no dumbwaiter bell')) return false;
    for (let frame = 0; frame < BEAT_FRAMES && !answered; frame++) {
      standOn(walk.run.cat, ARCHIVE_BELL_HIDE);
      walk.tick();
    }
    flagChecks.push(() =>
      check('archive', answered, "the dumbwaiter's bell sends the warden to peer into the hatch"),
    );
    if (!answered) return true;
    caught = false;
    for (const tile of ARCHIVE_DOORWAY_ROUTE) {
      for (let frame = 0; frame < ROUTE_LINGER_FRAMES; frame++) {
        standOn(walk.run.cat, tile);
        walk.tick();
      }
    }
    if (!layTheShelfBoard(walk, tower))
      return walk.expect(false, 'Belle could not bridge the hole');
    const crossedUnseen = !caught;
    flagChecks.push(() =>
      check(
        'archive',
        crossedUnseen,
        'while the warden peers into the hatch, Belle crosses to the board unseen',
      ),
    );
    const bridged = ARCHIVE_BRIDGE_TILES.every((tile) =>
      tower.map.isWalkable(tile.x, tile.y, 'walker'),
    );
    flagChecks.push(() =>
      check('archive', bridged, 'the board batted off its shelf lies across the hole'),
    );
    const plateDropped = knockTheJarOntoThePlate(walk, tower);
    flagChecks.push(() =>
      check(
        'archive',
        plateDropped,
        'the jar batted off the north shelf lands on the plate and puts the west ward out',
      ),
    );
    const stairWithinReach = catReachesAny(
      tower.map,
      BEYOND_WEST_WARD,
      tower.map._interiorStairDownTiles,
    );
    const pastTheHole = catReachesAny(tower.map, OFF_THE_PLATE, [BEYOND_WEST_WARD]);
    flagChecks.push(() =>
      check(
        'archive',
        stairWithinReach && pastTheHole,
        'with the board down and the ward out, the stair down is a walk from the bridge',
      ),
    );
    return true;
  } finally {
    stopListening();
  }
}

/** Belle, over the hole by the board, climbs onto the north shelf and bats the jar off onto the plate below. */
function knockTheJarOntoThePlate(walk: Walk, tower: TowerRig): boolean {
  const wardTile = firstOf(ARCHIVE_FIXED_WARDS.west.tiles);
  if (wardTile === undefined) return false;
  let batted = false;
  for (const tile of tilesAround(ARCHIVE_KNOCKABLES.plate_jar.at, REACH_SEARCH_TILES)) {
    standOn(walk.run.cat, tile);
    if (tower.floor.mechanisms.knockOffs.wouldInteract(walk.run.cat) && tower.interact()) {
      batted = true;
      break;
    }
  }
  if (!batted) return false;
  for (let frame = 0; frame < BEAT_FRAMES && !walk.progress.westWardOut; frame++) {
    standOn(walk.run.cat, OFF_THE_PLATE);
    walk.tick();
  }
  for (let frame = 0; frame < ROUTE_LINGER_FRAMES; frame++) walk.tick();
  const jarOnPlate = tower.floor.mechanisms.knockOffs
    .weights()
    .some((weight) => weight.occupiesPlate(ARCHIVE_WARD_PLATE.at));
  const wardOut = tower.map.isWalkable(wardTile.x, wardTile.y, 'walker');
  return jarOnPlate && walk.progress.westWardOut && wardOut;
}

/** Belle bats the loose shelf board down across the hole in the archive's west room. */
function layTheShelfBoard(walk: Walk, tower: TowerRig): boolean {
  const holeTile = firstOf(ARCHIVE_BRIDGE_TILES);
  if (holeTile === undefined) return walk.expect(false, 'the archive has no hole to bridge');
  const bridged = (): boolean => tower.map.isWalkable(holeTile.x, holeTile.y, 'walker');
  for (const tile of tilesAround(ARCHIVE_KNOCKABLES.shelf_board.at, REACH_SEARCH_TILES)) {
    standOn(walk.run.cat, tile);
    if (tower.floor.mechanisms.knockOffs.wouldInteract(walk.run.cat) && tower.interact()) break;
  }
  walk.until(bridged);
  return bridged();
}

/** Whether any of `targets` can be reached from `from` over tiles a cat, who climbs, may stand on. */
function catReachesAny(map: GameMap, from: TilePoint, targets: readonly TilePoint[]): boolean {
  const wanted = new Set(targets.map((tile) => `${tile.x},${tile.y}`));
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: TilePoint[] = [from];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (wanted.has(`${next.x},${next.y}`)) return true;
    for (const step of tilesAround(next, ONE)) {
      const key = `${step.x},${step.y}`;
      const isDiagonal = step.x !== next.x && step.y !== next.y;
      if (isDiagonal || seen.has(key)) continue;
      const enterable = wanted.has(key) || map.isWalkable(step.x, step.y, 'climber');
      if (!enterable) continue;
      seen.add(key);
      queue.push(step);
    }
  }
  return false;
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
  walk.settleTalk();
  const ringWaiting = itemsWaitingAt(walk.run.split, DUMBWAITER_FOOT).some(
    (load) => load.item === TOWER_KEY_RING_ITEM,
  );
  flagChecks.push(() =>
    check('key ring', ringWaiting, "the key ring waits at the kitchen's dumbwaiter foot"),
  );
  const human = walk.run.human;
  for (const fitting of KITCHEN_DEED_ORDER) {
    const before = walk.progress.kitchen;
    pressKitchen(walk, fitting);
    const moved = walk.progress.kitchen === nextKitchenStage(before);
    if (!walk.expect(moved, `a press at the ${fitting} left the kitchen at ${before}`))
      return false;
    if (walk.progress.kitchen === 'bell_rung') {
      walk.until(() => walk.progress.kitchen === 'note_in_dumbwaiter');
      walk.settleTalk();
    }
    if (walk.progress.kitchen === 'note_in_hand') human.inventory.addItem(TUNA_TIN_ITEM, ONE);
  }
  if (!walk.expect(cellmateFed(walk.progress), 'the tuna never went up the dumbwaiter'))
    return false;
  const tunaLeftAtHatch = itemsWaitingAt(walk.run.split, DUMBWAITER_HEAD).some(
    (load) => load.item === TUNA_TIN_ITEM,
  );
  flagChecks.push(() =>
    check(
      'tuna',
      !tunaLeftAtHatch,
      "the tuna sent up is eaten as it arrives: none waits at the archive's dumbwaiter hatch",
    ),
  );
  const before = walk.run.transfers.length;
  walk.until(() => walk.run.transfers.length > before);
  if (!walk.expect(walk.progress.phase === 'bell_storey', 'the kitchen chapter never ended'))
    return false;
  return walk.expect(walk.followTransfer(before), 'the kitchen chapter handed play to nobody');
}

// ── The kitchen, one step at a time ──────────────────────────────────────────

/** The kitchen fittings a press works the human's chapter at. */
type KitchenPressFitting = 'hatch' | 'bell' | 'larder_door';

const KITCHEN_PRESS_TILES = {
  hatch: TOWER_DUMBWAITER.foot.hatch,
  bell: TOWER_DUMBWAITER.foot.bell,
  larder_door: LARDER_DOOR_TILE,
} as const satisfies Record<KitchenPressFitting, TilePoint>;

/** Where each deed of the kitchen is done, in the order the chapter is played. */
const KITCHEN_DEED_ORDER = [
  'hatch',
  'larder_door',
  'bell',
  'hatch',
  'hatch',
] as const satisfies readonly KitchenPressFitting[];

/** Where the Journal must point while the kitchen stands at each stage, read off the chapter rather than the code. */
const KITCHEN_TRACKED = {
  key_ring_in_dumbwaiter: { untinned: 'hatch', tinned: 'hatch' },
  key_ring_in_hand: { untinned: 'larder_door', tinned: 'larder_door' },
  larder_open: { untinned: 'bell', tinned: 'bell' },
  bell_rung: { untinned: 'hatch', tinned: 'hatch' },
  note_in_dumbwaiter: { untinned: 'hatch', tinned: 'hatch' },
  note_in_hand: { untinned: 'store', tinned: 'hatch' },
  tuna_sent: { untinned: 'stair_up', tinned: 'stair_up' },
} as const satisfies Record<
  KitchenStage,
  Record<'untinned' | 'tinned', KitchenPressFitting | 'stair_up' | 'store'>
>;

/** Presses made at once at a fitting, as an impatient thumb on Space would. */
const KITCHEN_SPAM_PRESSES = 6;

/**
 * The open floor tile beside `fitting` that is nearer it than any other
 * kitchen fitting, so a press there can only be meant for it.
 */
function kitchenStandFor(map: GameMap, fitting: KitchenPressFitting): TilePoint | null {
  const at = KITCHEN_PRESS_TILES[fitting];
  const others = Object.values(KITCHEN_PRESS_TILES).filter((tile) => tile !== at);
  const distance = (a: TilePoint, b: TilePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
  const stands = tilesAround(at, ONE).filter(
    (tile) =>
      map.isWalkable(tile.x, tile.y, 'walker') &&
      others.every((other) => distance(tile, other) > distance(tile, at)),
  );
  stands.sort((a, b) => distance(a, at) - distance(b, at));
  return firstOf(stands) ?? null;
}

/** One press of Space by the human beside `fitting`, and whatever conversation it opens let run. */
function pressKitchen(walk: Walk, fitting: KitchenPressFitting): void {
  const tower = walk.tower();
  const stand = kitchenStandFor(tower.map, fitting);
  if (stand === null) throw new Error(`no floor to stand on beside the kitchen's ${fitting}`);
  standOn(walk.run.human, stand);
  tower.interact();
  walk.tick();
  walk.settleTalk();
}

function loadsAt(walk: Walk, point: ExchangePointId, item: ItemId): number {
  return itemsWaitingAt(walk.run.split, point)
    .filter((load) => load.item === item)
    .reduce((total, load) => total + load.quantity, 0);
}

function carriedCount(walk: Walk, item: ItemId): number {
  return walk.run.human.inventory.countOf(item) + walk.run.cat.inventory.countOf(item);
}

/** What is wrong with where the key ring, the note and the tuna are for the stage the kitchen is at, or null. */
function kitchenItemsProblem(walk: Walk, tinsBought: number): string | null {
  const stage = walk.progress.kitchen;
  const where = (item: ItemId): string =>
    `bag ${carriedCount(walk, item)}, foot ${loadsAt(walk, DUMBWAITER_FOOT, item)}, head ${loadsAt(walk, DUMBWAITER_HEAD, item)}`;
  const holds = (item: ItemId, bag: number, foot: number, head: number): boolean =>
    carriedCount(walk, item) === bag &&
    loadsAt(walk, DUMBWAITER_FOOT, item) === foot &&
    loadsAt(walk, DUMBWAITER_HEAD, item) === head;
  const ring =
    stage === 'key_ring_in_dumbwaiter' ? [0, 1] : stage === 'key_ring_in_hand' ? [1, 0] : [0, 0];
  const note = stage === 'note_in_dumbwaiter' ? [0, 1] : stage === 'note_in_hand' ? [1, 0] : [0, 0];
  const tunaUp = cellmateFed(walk.progress) ? ONE : 0;
  if (!holds(TOWER_KEY_RING_ITEM, ring[0], ring[1], 0)) {
    return `at ${stage} the key ring is misplaced (${where(TOWER_KEY_RING_ITEM)})`;
  }
  if (!holds(CELLMATE_NOTE_ITEM, note[0], note[1], 0)) {
    return `at ${stage} the note is misplaced (${where(CELLMATE_NOTE_ITEM)})`;
  }
  if (!holds(TUNA_TIN_ITEM, tinsBought - tunaUp, 0, 0)) {
    return `at ${stage} the tuna is misplaced (${where(TUNA_TIN_ITEM)}, ${tinsBought} bought)`;
  }
  return null;
}

/** Whether a crawler in the kitchen, not one away upstairs, has a tin the hatch could send. */
function tinInTheKitchen(walk: Walk): boolean {
  return presentCrawlers(walk.run).some((crawler) => crawler.inventory.countOf(TUNA_TIN_ITEM) > 0);
}

/** What is wrong with where the Journal points for the stage the kitchen is at, or null. */
function kitchenTrackerProblem(walk: Walk): string | null {
  const stage = walk.progress.kitchen;
  const tinned = tinInTheKitchen(walk);
  const wanted = KITCHEN_TRACKED[stage][tinned ? 'tinned' : 'untinned'];
  const step = towerStep('gatehouse', walk.progress, { tuna: tunaHolder(walk.run) !== null });
  const target = towerStepTarget(
    step.place,
    (building) => doorwayBeaconTarget(townEntry(building)) ?? undefined,
  );
  const pointedAt =
    target?.indoors === undefined
      ? `${target?.building ?? 'nowhere'}`
      : `storey ${target.indoors.storey} ${describeTile(target.indoors.tile)}`;
  const tinUpstairsOnly = !tinned && carriedCount(walk, TUNA_TIN_ITEM) > 0;
  const tinNote = tinned ? ' with tuna' : tinUpstairsOnly ? ' with tuna only upstairs' : '';
  const problem = `at ${stage}${tinNote} the Journal ("${step.objective}") points at ${pointedAt}, not the ${wanted}`;
  if (wanted === 'store') {
    return target?.building === STORE && target.indoors === undefined ? null : problem;
  }
  const kitchenStair = towerStoreyPlan('kitchen').stairUp;
  const tile = wanted === 'stair_up' ? kitchenStair : KITCHEN_PRESS_TILES[wanted];
  const indoors = target?.indoors;
  const onIt =
    tile !== null &&
    indoors?.building === TOWN_TOWER_ID &&
    indoors.storey === STOREY.kitchen &&
    sameTile(indoors.tile, tile);
  return onIt ? null : problem;
}

/** One kitchen play-through, with every step recorded and every press judged as it lands. */
class KitchenPlay {
  readonly stages: KitchenStage[];
  readonly problems: string[] = [];
  /** Tins in either bag, as the tower's items are counted. */
  tinsBought = 0;
  /** Tins in the human's own bag, which the hatch can send. */
  tinsInTheKitchen = 0;

  constructor(readonly walk: Walk) {
    this.stages = [walk.progress.kitchen];
    this.judge('on arrival');
  }

  /** Presses Space `presses` times beside `fitting`, judging the kitchen after each. */
  spam(fitting: KitchenPressFitting, presses = KITCHEN_SPAM_PRESSES): void {
    for (let press = 0; press < presses; press++) {
      const before = this.walk.progress.kitchen;
      pressKitchen(this.walk, fitting);
      const after = this.walk.progress.kitchen;
      if (after !== before && after !== nextKitchenStage(before)) {
        this.problems.push(`a press at the ${fitting} took the kitchen from ${before} to ${after}`);
      }
      if (after !== before) this.stages.push(after);
      this.judge(`press ${press + ONE} at the ${fitting}`);
    }
  }

  /** Spams `fitting` and expects the kitchen to stay where it is. */
  refused(fitting: KitchenPressFitting): void {
    const before = this.walk.progress.kitchen;
    this.spam(fitting);
    if (this.walk.progress.kitchen !== before) {
      this.problems.push(
        `at ${before}, pressing the ${fitting} moved the kitchen on to ${this.walk.progress.kitchen}`,
      );
    }
  }

  /** Spams `fitting` and expects exactly the one step after where the kitchen stood. */
  takes(fitting: KitchenPressFitting): void {
    const before = this.walk.progress.kitchen;
    const next = nextKitchenStage(before);
    this.spam(fitting, ONE);
    if (this.walk.progress.kitchen !== next) {
      this.problems.push(
        `at ${before}, pressing the ${fitting} left the kitchen at ${this.walk.progress.kitchen}`,
      );
    }
    const reached = this.walk.progress.kitchen;
    this.spam(fitting, KITCHEN_SPAM_PRESSES - ONE);
    const settled = this.walk.progress.kitchen;
    const mayGoOn = reached === 'note_in_hand' && fitting === 'hatch' && this.tinsInTheKitchen > 0;
    if (settled !== reached && !(mayGoOn && settled === nextKitchenStage(reached))) {
      this.problems.push(`spamming the ${fitting} at ${reached} went on to ${settled}`);
    }
  }

  buyTuna(): void {
    this.walk.run.human.inventory.addItem(TUNA_TIN_ITEM, ONE);
    this.tinsBought++;
    this.tinsInTheKitchen++;
    this.judge('a tin bought');
  }

  /** A tin Belle was steered to buy before she was taken, in her bag at the top of the tower. */
  tinInBellesBag(): void {
    this.walk.run.cat.inventory.addItem(TUNA_TIN_ITEM, ONE);
    this.tinsBought++;
    this.judge("a tin in Belle's bag");
  }

  /** Down to the gatehouse and back up, as a trip out of the kitchen would go. */
  stepOutAndBack(): void {
    const tower = this.walk.tower();
    if (tower.takeStair('down') !== null)
      this.problems.push('the kitchen stair down refused the human');
    this.walk.tick();
    this.judge('down on the gatehouse');
    if (tower.takeStair('up') !== null)
      this.problems.push('the gatehouse stair up refused the human');
    this.walk.tick();
    this.walk.settleTalk();
    this.judge('back in the kitchen');
  }

  waitForTheNote(): void {
    const came = this.walk.until(() => this.walk.progress.kitchen === 'note_in_dumbwaiter');
    if (!came) this.problems.push('after the bell, nothing came down the dumbwaiter');
    else this.stages.push('note_in_dumbwaiter');
    this.walk.settleTalk();
    this.judge('the answer down');
  }

  private judge(when: string): void {
    const items = kitchenItemsProblem(this.walk, this.tinsBought);
    if (items !== null) this.problems.push(`${when}: ${items}`);
    const tracker = kitchenTrackerProblem(this.walk);
    if (tracker !== null) this.problems.push(`${when}: ${tracker}`);
  }
}

/** The kitchen from the gatehouse as the walk reached it, with the human carried up its stair. */
function kitchenFromTheGatehouse(walk: Walk): KitchenPlay | null {
  const snapshot = walk.run.snapshots.get('gatehouse');
  if (snapshot === undefined) return null;
  const replay = new Walk(snapshot);
  replay.settleTalk();
  if (replay.tower().takeStair('up') !== null) return null;
  replay.tick();
  replay.settleTalk();
  return new KitchenPlay(replay);
}

function judgeKitchenPlay(label: string, play: KitchenPlay | null): void {
  if (play === null) {
    check('kitchen', false, `${label}: the kitchen could not be reached from the gatehouse`);
    return;
  }
  for (const problem of play.problems) check('kitchen', false, `${label}: ${problem}`);
  check(
    'kitchen',
    play.stages.join(' > ') === KITCHEN_STAGES.join(' > '),
    `${label}: the kitchen passes every step in order (${play.stages.join(' > ')})`,
  );
  check('kitchen', play.walk.stalled === null, `${label}: ${play.walk.stalled ?? 'ran through'}`);
}

/**
 * The human's kitchen played three times from the gatehouse, Space spammed at
 * every fitting at every step: once with the tuna bought before anything else
 * and every fitting tried out of turn, once with the tuna fetched only after
 * the note, with a trip out of the kitchen while holding the key ring and
 * again while holding the note, and once with a tin only in Belle's bag at the
 * top of the tower, which the hatch cannot send and the Journal must not
 * count. The kitchen must move one step per deed, in order,
 * with nothing lost, doubled or sent early, and the Journal must point at the
 * next thing to work every time.
 */
function checkKitchenSequence(walk: Walk): void {
  section('The kitchen is played one step at a time, however Space is pressed');
  const tunaFirst = kitchenFromTheGatehouse(walk);
  if (tunaFirst !== null) {
    tunaFirst.buyTuna();
    tunaFirst.refused('bell');
    tunaFirst.refused('larder_door');
    tunaFirst.takes('hatch');
    tunaFirst.stepOutAndBack();
    tunaFirst.refused('bell');
    tunaFirst.refused('hatch');
    tunaFirst.takes('larder_door');
    tunaFirst.refused('hatch');
    tunaFirst.takes('bell');
    tunaFirst.refused('hatch');
    tunaFirst.refused('bell');
    tunaFirst.waitForTheNote();
    tunaFirst.takes('hatch');
  }
  judgeKitchenPlay('tuna bought first', tunaFirst);

  const tunaAfter = kitchenFromTheGatehouse(walk);
  if (tunaAfter !== null) {
    tunaAfter.takes('hatch');
    tunaAfter.takes('larder_door');
    tunaAfter.takes('bell');
    tunaAfter.waitForTheNote();
    tunaAfter.takes('hatch');
    tunaAfter.refused('hatch');
    tunaAfter.refused('bell');
    tunaAfter.stepOutAndBack();
    tunaAfter.buyTuna();
    tunaAfter.takes('hatch');
  }
  judgeKitchenPlay('tuna fetched after the note', tunaAfter);

  const tinUpstairs = kitchenFromTheGatehouse(walk);
  if (tinUpstairs !== null) {
    tinUpstairs.tinInBellesBag();
    tinUpstairs.takes('hatch');
    tinUpstairs.takes('larder_door');
    tinUpstairs.takes('bell');
    tinUpstairs.waitForTheNote();
    tinUpstairs.takes('hatch');
    tinUpstairs.refused('hatch');
    tinUpstairs.buyTuna();
    tinUpstairs.takes('hatch');
  }
  judgeKitchenPlay("a tin only in Belle's bag, upstairs", tinUpstairs);
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

/** Frames the bell storey is watched with a crawler on a beam: two full swings. */
const BELL_WATCH_SWINGS = 2;
const BELL_SWING_BARS = 2;
const BELL_WATCH_FRAMES = Math.ceil(
  BELL_WATCH_SWINGS * BELL_SWING_BARS * TOWER_SPLIT_BAR_S * WORLD_TICKS_PER_SECOND,
);
/** Frames the party stands on each storey on the way down, so anything still on watch has time to act. */
const DESCENT_SETTLE_FRAMES = WORLD_TICKS_PER_SECOND;

/** Whether `from` can walk to any of `targets`, a target counting as reached once it is a step away. */
function walkerReaches(map: GameMap, from: TilePoint, targets: readonly TilePoint[]): boolean {
  const wanted = new Set(targets.map((tile) => tileKey(tile.x, tile.y)));
  const seen = new Set<string>([tileKey(from.x, from.y)]);
  const queue: TilePoint[] = [from];
  // A for-of over the queue also visits what is pushed onto it as it runs.
  for (const at of queue) {
    if (wanted.has(tileKey(at.x, at.y))) return true;
    for (const [dx, dy] of NEIGHBOUR_STEPS) {
      const next = { x: at.x + dx, y: at.y + dy };
      const key = tileKey(next.x, next.y);
      if (seen.has(key)) continue;
      if (wanted.has(key)) return true;
      if (!map.isWalkable(next.x, next.y, 'walker')) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}

const NEIGHBOUR_STEPS = [
  [ONE, 0],
  [-ONE, 0],
  [0, ONE],
  [0, -ONE],
] as const;

/** The creatures on a storey still keeping watch: a gatehouse guard, a raveling. */
// ── Watchers catch at a glance ───────────────────────────────────────────────

/** Frames a companion is kept in a watcher's look: long past any catch, to show it never catches. */
const COMPANION_IN_SIGHT_FRAMES = CAUGHT_AFTER_SEEN_FRAMES * 10;
/** A sighting this strong is full view; anything above none and below it is the edge of a look. */
const FULL_VIEW = 1;
/** Extra room past a guard's front reach, so a body stood in its full view is seen, never walked into. */
const CLEAR_OF_TOUCH_PX = TILE_SIZE;

/** How one kind of watcher is read and its storey ticked, for the glance checks. */
interface GlanceWatcher {
  readonly label: string;
  /** A fresh storey, the watcher on its round and the crawler `crawler` on it. */
  readonly build: () => { readonly tower: TowerRig; readonly crawler: Player } | null;
  /** How strongly each of the storey's watchers takes in a body centred at `centre` now. */
  readonly sightings: (tower: TowerRig, centre: PrisonPoint) => readonly number[];
  /** Each watcher's suspicion now, in the order of {@link sightings}. */
  readonly suspicions: (tower: TowerRig) => readonly number[];
  /** Whether a body centred at `centre` would be caught by walking into a watcher rather than seen. */
  readonly touches: (tower: TowerRig, centre: PrisonPoint) => boolean;
}

function glanceTiles(tower: TowerRig): TilePoint[] {
  return glanceTilesOf(tower.map);
}

/** A tile watcher `index` takes in as `wanted` decides, clear of touching anyone, or null. */
function tileSeenBy(
  watcher: GlanceWatcher,
  tower: TowerRig,
  index: number,
  wanted: (weight: number) => boolean,
): TilePoint | null {
  return (
    glanceTiles(tower).find((tile) => {
      const centre = tileCentre(tile);
      const weight = watcher.sightings(tower, centre)[index] ?? 0;
      return wanted(weight) && !watcher.touches(tower, centre);
    }) ?? null
  );
}

/** A tile no watcher takes in at all, clear of touching anyone, or null. */
function tileSeenByNone(watcher: GlanceWatcher, tower: TowerRig): TilePoint | null {
  return (
    glanceTiles(tower).find((tile) => {
      const centre = tileCentre(tile);
      const seen = watcher.sightings(tower, centre).some((weight) => weight > 0);
      return !seen && !watcher.touches(tower, centre);
    }) ?? null
  );
}

/** The first watcher with a tile in its full view, and that tile. */
function fullViewOfAny(
  watcher: GlanceWatcher,
  tower: TowerRig,
): { readonly index: number; readonly tile: TilePoint } | null {
  const count = watcher.suspicions(tower).length;
  for (let index = 0; index < count; index++) {
    const tile = tileSeenBy(watcher, tower, index, (weight) => weight >= FULL_VIEW);
    if (tile !== null) return { index, tile };
  }
  return null;
}

/**
 * The three rules every on-sight watcher keeps: a crawler in its full view is
 * caught within {@link CAUGHT_AFTER_SEEN_SECONDS}; a companion in its look
 * raises it to orange and never further; and on orange, the crawler seen at
 * all is caught that frame.
 */
function checkGlanceRules(watcher: GlanceWatcher): void {
  const first = watcher.build();
  check('glance', first !== null, `${watcher.label}: a storey to watch was built`);
  if (first === null) return;
  first.tower.tick();
  const view = fullViewOfAny(watcher, first.tower);
  check('glance', view !== null, `${watcher.label}: some tile lies in a watcher's full view`);
  if (view !== null) {
    let caughtOnFrame: number | null = null;
    for (let frame = 1; frame <= COMPANION_IN_SIGHT_FRAMES && caughtOnFrame === null; frame++) {
      standOn(first.crawler, view.tile);
      first.tower.tick();
      if (first.tower.storeys.playerLocked) caughtOnFrame = frame;
    }
    check(
      'glance',
      caughtOnFrame !== null && caughtOnFrame <= CAUGHT_AFTER_SEEN_FRAMES,
      `${watcher.label}: the crawler in full view is caught within ${CAUGHT_AFTER_SEEN_SECONDS} s (${caughtOnFrame ?? 'never'} of ${CAUGHT_AFTER_SEEN_FRAMES} frames)`,
    );
  }

  const second = watcher.build();
  if (second === null) return;
  const { tower, crawler } = second;
  tower.tick();
  const companion = new HumanPlayer(0, 0, TILE_SIZE);
  tower.companions.push(companion);
  let caughtByCompanion = false;
  let stoodClear = true;
  let alerted: number | null = null;
  for (let frame = 0; frame < COMPANION_IN_SIGHT_FRAMES && !caughtByCompanion; frame++) {
    const inView = fullViewOfAny(watcher, tower);
    const clear = tileSeenByNone(watcher, tower);
    if (inView === null || clear === null) {
      stoodClear = false;
      break;
    }
    standOn(companion, inView.tile);
    standOn(crawler, clear);
    tower.tick();
    if (tower.storeys.playerLocked) caughtByCompanion = true;
    alerted = inView.index;
  }
  const suspicions = watcher.suspicions(tower);
  const orange = alerted === null ? null : (suspicions[alerted] ?? null);
  check(
    'glance',
    stoodClear && !caughtByCompanion && orange === SUSPICION_ORANGE_ALERT,
    `${watcher.label}: a companion kept in a watcher's full view raises it to orange alert and never to a catch (${caughtByCompanion ? 'caught' : `alert ${orange ?? 'unread'}`}${stoodClear ? '' : ', no clear tile to stand the crawler on'})`,
  );
  if (alerted === null || caughtByCompanion) return;
  const glimpsed =
    tileSeenBy(watcher, tower, alerted, (weight) => weight > 0 && weight < FULL_VIEW) ??
    tileSeenBy(watcher, tower, alerted, (weight) => weight > 0);
  check('glance', glimpsed !== null, `${watcher.label}: the alerted watcher's look reaches a tile`);
  if (glimpsed === null) return;
  standOn(crawler, glimpsed);
  tower.tick();
  check(
    'glance',
    tower.storeys.playerLocked,
    `${watcher.label}: on orange alert, the crawler seen at all is caught that frame`,
  );
}

/**
 * A gatehouse guard struck while the only body it sees is a companion has not
 * caught the party: only a crawler in its look makes a blow a catch.
 */
function checkStrikeWhileWatchingACompanion(walk: Walk): void {
  const watcher = gatehouseGlanceWatcher(walk);
  const built = watcher.build();
  if (built === null) return;
  const { tower, crawler } = built;
  tower.tick();
  const companion = new HumanPlayer(0, 0, TILE_SIZE);
  tower.companions.push(companion);
  const inView = fullViewOfAny(watcher, tower);
  const clear = tileSeenByNone(watcher, tower);
  check(
    'glance',
    inView !== null && clear !== null,
    "gatehouse guards: a tile in a guard's full view, and one clear of every look",
  );
  if (inView === null || clear === null) return;
  standOn(companion, inView.tile);
  standOn(crawler, clear);
  tower.tick();
  const guard = tower.storeys['guards'][inView.index];
  const watchingCompanion = guard?.seen?.kind === 'companion';
  if (guard !== undefined) guard.mob['strikesUntaken'] = 1;
  tower.tick();
  check(
    'glance',
    watchingCompanion && !tower.storeys.playerLocked,
    `gatehouse guards: a guard struck while it watches only a companion is no catch (watching the companion: ${String(watchingCompanion)}, caught: ${String(tower.storeys.playerLocked)})`,
  );
}

/** A rig on `storey` from the walk's record of `phase`, the party stood on `at`. */
function glanceRig(
  walk: Walk,
  phase: MissingCatsPhase,
  storey: TowerStoreyId,
  at: TilePoint,
  crawler: (run: Run) => Player,
): { readonly tower: TowerRig; readonly crawler: Player } | null {
  const snapshot = walk.run.snapshots.get(phase);
  if (snapshot === undefined) return null;
  const run = new Run(snapshot.record);
  return { tower: new TowerRig(run, STOREY[storey], at), crawler: crawler(run) };
}

function gatehouseGlanceWatcher(walk: Walk): GlanceWatcher {
  const guardsOf = (tower: TowerRig) => tower.storeys['guards'];
  const watchOf = (tower: TowerRig) => tower.storeys['watch'];
  return {
    label: 'gatehouse guards',
    build: () =>
      glanceRig(
        walk,
        'gatehouse',
        'gatehouse',
        towerStairLanding('gatehouse', 'stairDown'),
        (run) => run.human,
      ),
    sightings: (tower, centre) => {
      const { parsed, tuning } = watchOf(tower);
      return guardsOf(tower).map((guard) =>
        lightSeesBody(parsed.grid, guard.cone, centre, tuning.suspicion.coneEdgeWeight),
      );
    },
    suspicions: (tower) => guardsOf(tower).map((guard) => guard.suspicion),
    touches: (tower, centre) =>
      guardsOf(tower).some(
        (guard) =>
          Math.hypot(centre.x - guard.pose.x, centre.y - guard.pose.y) <=
            GUARD_FRONT_REACH_PX + CLEAR_OF_TOUCH_PX ||
          bodyTouchesGuard(watchOf(tower).parsed.grid, guard.pose, centre),
      ),
  };
}

function archiveGlanceWatcher(walk: Walk): GlanceWatcher {
  const archiveOf = (tower: TowerRig) => tower.storeys['archive'];
  const probe = new HumanPlayer(0, 0, TILE_SIZE);
  return {
    label: 'archive wardens',
    build: () =>
      glanceRig(
        walk,
        'archive',
        'archive',
        towerStairLanding('archive', 'stairUp'),
        (run) => run.cat,
      ),
    sightings: (tower, centre) => {
      probe.x = centre.x - TILE_SIZE * HALF_TILE;
      probe.y = centre.y - TILE_SIZE * HALF_TILE;
      const archive = archiveOf(tower);
      return archive['wardens'].map((warden) =>
        archive['wardenSees'](warden, probe) ? FULL_VIEW : 0,
      );
    },
    suspicions: (tower) => archiveOf(tower)['wardens'].map((warden) => warden.suspicion),
    touches: () => false,
  };
}

/**
 * The cattery's keeper, kept apart from the storey: its round is its own
 * class, so its catch is read straight off it rather than through Belle's
 * cage and chapter.
 */
function checkKeeperCatchesAtAGlance(): void {
  const progress = missingCatsProgressAt('cattery');
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', TOWER_TOP_FLOOR, TOWN_TOWER_ID, false, {
    kind: 'tower',
    conditions: towerConditionsFor(progress),
  });
  const plan = towerStoreyPlan('cattery');
  const keeper = new CatteryKeeper(keeperSightGrid(map, plan.width, plan.height));
  keeper.step(null);
  const floor = glanceTilesOf(map);
  const seenBy = (
    watcher: CatteryKeeper,
    wanted: (weight: number) => boolean,
  ): PrisonPoint | null => {
    const tile = floor.find((at) => wanted(watcher.sees(tileCentre(at))));
    return tile === undefined ? null : tileCentre(tile);
  };
  const inFullView = (weight: number): boolean => weight >= FULL_VIEW;
  const inView = seenBy(keeper, inFullView);
  check('glance', inView !== null, "cattery keeper: some tile lies in the keeper's full view");
  if (inView === null) return;
  const watching = keeper.clone();
  let caughtOnFrame: number | null = null;
  for (let frame = 1; frame <= COMPANION_IN_SIGHT_FRAMES && caughtOnFrame === null; frame++) {
    watching.step(inView);
    if (watching.caught) caughtOnFrame = frame;
  }
  check(
    'glance',
    caughtOnFrame !== null && caughtOnFrame <= CAUGHT_AFTER_SEEN_FRAMES,
    `cattery keeper: Belle in full view is caught within ${CAUGHT_AFTER_SEEN_SECONDS} s (${caughtOnFrame ?? 'never'} of ${CAUGHT_AFTER_SEEN_FRAMES} frames)`,
  );
  const wary = keeper.clone();
  let caughtByCompanion = false;
  let companionAt = inView;
  for (let frame = 0; frame < COMPANION_IN_SIGHT_FRAMES && !caughtByCompanion; frame++) {
    companionAt = seenBy(wary, inFullView) ?? companionAt;
    wary.step(null, [companionAt]);
    caughtByCompanion = wary.caught;
  }
  check(
    'glance',
    !caughtByCompanion && wary.suspicion === SUSPICION_ORANGE_ALERT,
    `cattery keeper: a companion kept in its full view raises it to orange alert and never to a catch (${caughtByCompanion ? 'caught' : `alert ${wary.suspicion}`})`,
  );
  const glimpsed =
    seenBy(wary, (weight) => weight > 0 && weight < FULL_VIEW) ?? seenBy(wary, inFullView);
  check('glance', glimpsed !== null, "cattery keeper: the alerted keeper's look reaches a tile");
  if (glimpsed === null) return;
  wary.step(glimpsed, [companionAt]);
  check(
    'glance',
    wary.caught,
    'cattery keeper: on orange alert, Belle seen at all is caught that frame',
  );
}

function glanceTilesOf(map: GameMap): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = 0; y < map.gridSize; y++) {
    for (let x = 0; x < map.gridSize; x++) if (map.isWalkable(x, y, 'walker')) tiles.push({ x, y });
  }
  return tiles;
}

/**
 * Every watcher the party must keep out of the look of catches at a glance:
 * a crawler in full view within {@link CAUGHT_AFTER_SEEN_SECONDS}, a companion
 * in its look only puts it on orange alert, and on orange any sight of a
 * crawler is the catch.
 */
function checkWatchersCatchAtAGlance(walk: Walk): void {
  section('Every tower watcher catches at a glance, and a companion it sees puts it on alert');
  checkGlanceRules(gatehouseGlanceWatcher(walk));
  checkGlanceRules(archiveGlanceWatcher(walk));
  checkStrikeWhileWatchingACompanion(walk);
  checkKeeperCatchesAtAGlance();
}

function watchersOn(floor: TowerFloor): string[] {
  return floor.roster.mobs
    .filter((mob) => mob.isAlive && (mob instanceof TowerGuard || mob instanceof Raveling))
    .map((mob) => mob.mobType);
}

/**
 * The Warden's fight, fought on a tower built as the party climbed, and the
 * way down after it on that same tower: while the Warden is up the cattery's
 * stair down refuses, and once it has fallen every storey from the cattery to
 * the street door is walked: each stair down takes the party, each storey's
 * stair down (and at the gatehouse the street door) is a walk from where the
 * party lands, no guard or raveling is left on watch, the archive's wards are
 * all out, and a crawler on a bell storey beam is never struck.
 */
function checkDescentAfterTheWarden(): void {
  section("The Warden's fight holds the stair down, and after it the way down is open");
  const run = new Run(wholePartyAt('ascent'));
  const tower = new TowerRig(run, STOREY.archive, towerStairLanding('archive', 'stairUp'));
  const until = (done: () => boolean): boolean => {
    for (let frame = 0; frame < BEAT_FRAMES && !done(); frame++) tower.tick();
    return done();
  };
  const climbed = tower.takeStair('up') === null;
  const risen = until(() => run.progress.phase === 'ritual');
  check('fight stair', climbed && risen, 'the Warden rises for a party climbing onto the cattery');
  const heldStair = tower.storeys.stairRefusal('down');
  check(
    'fight stair',
    heldStair !== null,
    `with the Warden up, the cattery's stair down refuses rather than offering the way out (${heldStair?.kind ?? 'offered'})`,
  );
  const fallen = until(() => {
    if (!tower.conversation.isOpen) {
      for (const mob of tower.floors[STOREY.cattery].roster.mobs) {
        if (mob instanceof TheLich) mob.hp = 0;
      }
    }
    return run.progress.phase === 'aftermath';
  });
  check('descent', fallen, 'the Warden falls');
  until(() => !tower.conversation.isOpen);
  while (tower.storey >= STOREY.gatehouse) {
    const name = storeyIdAt(tower.storey);
    for (let frame = 0; frame < DESCENT_SETTLE_FRAMES; frame++) tower.tick();
    const watchers = watchersOn(tower.floor);
    check(
      'descent',
      watchers.length === 0,
      `the ${name} keeps no watch after the Warden (${watchers.join(', ') || 'none'})`,
    );
    const live = tower.floor.senses.liveWardLines.size;
    check('descent', live === 0, `the ${name} has no ward lit after the Warden (${live} lit)`);
    if (tower.storey === STOREY.bell_storey) checkBellsStill(tower);
    const from = tileStoodOn(tower.pm.active());
    const isStreetStorey = tower.storey === STOREY.gatehouse;
    const way = isStreetStorey ? tower.map._interiorExitTiles : tower.map._interiorStairDownTiles;
    check(
      'descent',
      walkerReaches(tower.map, from, way),
      `the ${name}'s ${isStreetStorey ? 'street door' : 'stair down'} is a walk from where the party stands (${from.x},${from.y})`,
    );
    if (isStreetStorey) break;
    const refusal = tower.takeStair('down');
    if (refusal !== null) {
      check(
        'descent',
        false,
        `the ${name}'s stair down refuses after the Warden (${refusal.kind})`,
      );
      break;
    }
  }
  tower.dispose();
}

/** A crawler left on each bell storey beam through two full swings is neither struck nor moved. */
function checkBellsStill(tower: TowerRig): void {
  const crawler = tower.pm.active();
  const back = { x: crawler.x, y: crawler.y };
  const struckRow = BELL_STOREY_BEAM_ROWS.y0 + ONE;
  for (const beam of Object.values(BELL_STOREY_BEAMS)) {
    standOn(crawler, { x: beam, y: struckRow });
    const placed = { x: crawler.x, y: crawler.y };
    const hp = crawler.hp;
    for (let frame = 0; frame < BELL_WATCH_FRAMES; frame++) tower.tick();
    const unmoved = crawler.x === placed.x && crawler.y === placed.y;
    check(
      'descent',
      crawler.hp === hp && unmoved,
      `a crawler on the bell storey's beam ${beam} is never struck after the Warden`,
    );
  }
  crawler.x = back.x;
  crawler.y = back.y;
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

/** From a tile's corner to its centre, in tiles. */
const HALF_TILE = 0.5;
function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Frames before the keeper's round and its sway, out of step with each
 * other, come back into step: kept undisturbed from its post as the room is
 * built, it stands where it stood that many frames before, so a watch this
 * long sees every pairing of the two an undisturbed round makes.
 */
const KEEPER_PATTERN_FRAMES =
  (KEEPER_ROUND_FRAMES * KEEPER_DRIFT_PERIOD_FRAMES) /
  greatestCommonDivisor(KEEPER_ROUND_FRAMES, KEEPER_DRIFT_PERIOD_FRAMES);

/** How far a cage front may be from somewhere the keeper never looks, in tiles: a short dash. */
const KEEPER_COVER_REACH_TILES = 3;
/** Belle stood in the open is caught within this many frames. */
const KEEPER_CATCH_FRAMES = KEEPER_ROUND_FRAMES * 2;

interface KeeperWatch {
  /** Walkable tiles where the keeper's look never catches a cat who stays put there. */
  readonly shadows: readonly TilePoint[];
  /** The walkable tile its look takes in for the most frames. */
  readonly mostWatched: TilePoint;
}

/** Runs the keeper's round over the cattery as built and notes where its look would catch a cat. */
function watchTheKeeper(map: GameMap): KeeperWatch {
  const plan = towerStoreyPlan('cattery');
  const keeper = new CatteryKeeper(keeperSightGrid(map, plan.width, plan.height));
  const floor: TilePoint[] = [];
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) if (map.isWalkable(x, y, 'walker')) floor.push({ x, y });
  }
  const watchedFrames = floor.map(() => 0);
  const suspicion = floor.map(() => 0);
  const caught = floor.map(() => false);
  for (let frame = 0; frame < KEEPER_PATTERN_FRAMES; frame++) {
    keeper.step(null);
    floor.forEach((tile, index) => {
      const centre = { x: (tile.x + HALF_TILE) * TILE_SIZE, y: (tile.y + HALF_TILE) * TILE_SIZE };
      const seen = keeper.sees(centre);
      if (seen > 0) watchedFrames[index]++;
      suspicion[index] = stepSuspicion(
        suspicion[index],
        'cone',
        crawlerSighting(seen),
        KEEPER_NOTICE,
      );
      if (suspicion[index] >= SUSPICION_CAPTURE) caught[index] = true;
    });
  }
  const shadows = floor.filter((_, index) => !caught[index]);
  const most = Math.max(...watchedFrames);
  const mostWatched = floor[watchedFrames.indexOf(most)] ?? TOWER_CATTERY_CAGES.crawler_cat;
  return { shadows, mostWatched };
}

/** The moments of its round the keeper's eye is checked from when it hears a paw: at its watch post, and at the window. */
const KEEPER_EYE_HEARD_AT_FRAMES = [0, Math.floor(KEEPER_ROUND_FRAMES * HALF_TILE)] as const;
/**
 * Tall things laid in the keeper's own lanes, in tiles from where it starts:
 * either end of its sway and the way up to the window. The cattery as built
 * keeps its heaps out of those lanes, so these are what proves it goes round
 * whatever stands in its way rather than only where nothing does.
 */
const KEEPER_LANE_TALL_TILES = [
  { x: 2, y: 0 },
  { x: -2, y: 0 },
  { x: 0, y: -2 },
] as const satisfies readonly TilePoint[];

/** `grid` with each of `tiles` made tall. */
function withTallTiles(grid: PrisonGrid, tiles: readonly TilePoint[]): PrisonGrid {
  const copy = new Uint8Array(grid.tiles);
  for (const tile of tiles) copy[tile.y * grid.width + tile.x] = PRISON_TILE.wall;
  return { ...grid, tiles: copy };
}

/**
 * Where the keeper's eye rests inside something tall over `grid`, where its
 * look would be stopped before it starts: over its round, and hunting Belle
 * seen standing on any floor tile from either end of its round, then
 * searching, giving up and floating home. Empty when it never does.
 */
function keeperEyeBlockedMoments(map: GameMap, grid: PrisonGrid): readonly string[] {
  const blockedAt: string[] = [];
  const watchOver = (keeper: CatteryKeeper, label: string): void => {
    if (keeperEyeBlocked(grid, keeper.eye)) blockedAt.push(label);
  };
  const round = new CatteryKeeper(grid);
  for (let frame = 0; frame < KEEPER_PATTERN_FRAMES; frame++) {
    round.step(null);
    watchOver(round, `round frame ${frame}`);
  }
  const heardFrom = new CatteryKeeper(grid);
  const startingPoints: CatteryKeeper[] = [];
  for (let frame = 0; startingPoints.length < KEEPER_EYE_HEARD_AT_FRAMES.length; frame++) {
    if (KEEPER_EYE_HEARD_AT_FRAMES.some((heardAt) => heardAt === frame)) {
      startingPoints.push(heardFrom.clone());
    }
    heardFrom.step(null);
  }
  const huntFrames = HEARD_CATCH_FRAMES + KEEPER_HUNT_WATCH_FRAMES;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!map.isWalkable(x, y, 'walker')) continue;
      const belle = tileCentre({ x, y });
      for (const start of startingPoints) {
        const keeper = start.clone();
        keeper.hear(belle);
        for (let frame = 0; frame < huntFrames; frame++) {
          keeper.step(frame < HEARD_CATCH_FRAMES ? belle : null);
          watchOver(keeper, `hunting (${x}, ${y}), frame ${frame}`);
        }
      }
    }
  }
  return blockedAt;
}

/** The keeper's eye never rests inside something tall, in the cattery as built or with tall things in its lanes. */
function checkKeeperEyeStaysClear(map: GameMap): void {
  const plan = towerStoreyPlan('cattery');
  const built = keeperSightGrid(map, plan.width, plan.height);
  const start = new CatteryKeeper(built);
  const startTile = { x: Math.floor(start.x / TILE_SIZE), y: Math.floor(start.y / TILE_SIZE) };
  const laneTiles = KEEPER_LANE_TALL_TILES.map((lane) => ({
    x: startTile.x + lane.x,
    y: startTile.y + lane.y,
  }));
  const rooms = [
    { label: 'the cattery as built', grid: built },
    { label: 'the cattery with tall things in its lanes', grid: withTallTiles(built, laneTiles) },
  ] as const;
  for (const room of rooms) {
    const blockedAt = keeperEyeBlockedMoments(map, room.grid);
    flagChecks.push(() =>
      check(
        'keeper',
        blockedAt.length === 0,
        `over ${room.label}, the keeper's eye never rests inside something tall (${blockedAt.slice(0, 3).join('; ') || 'never'})`,
      ),
    );
  }
}

function nearestShadow(shadows: readonly TilePoint[], to: TilePoint): TilePoint | null {
  let best: TilePoint | null = null;
  for (const tile of shadows) {
    if (best === null || tileDistance(tile, to) < tileDistance(best, to)) best = tile;
  }
  return best;
}

function tileDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A sighting this strong is the keeper's full view, where it catches at a glance. */
const FULL_VIEW_SIGHTING = 1;
/** Long enough for any hunt to close, search and give up, and for its round to pass over the hideout after. */
const KEEPER_HUNT_WATCH_FRAMES = KEEPER_ROUND_FRAMES;
/** Points along a dash a straight run is checked at for something standing in its way, per tile. */
const DASH_SAMPLES_PER_TILE = 4;

function tileCentre(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + HALF_TILE) * TILE_SIZE, y: (tile.y + HALF_TILE) * TILE_SIZE };
}

/** Whether a cat can run straight from `from` to `to` without anything in her way; `to` itself may be her own cage. */
function dashIsClear(map: GameMap, from: TilePoint, to: TilePoint): boolean {
  const samples = Math.ceil(tileDistance(from, to) * DASH_SAMPLES_PER_TILE);
  for (let sample = 1; sample < samples; sample++) {
    const share = sample / samples;
    const x = Math.floor(from.x + HALF_TILE + (to.x - from.x) * share);
    const y = Math.floor(from.y + HALF_TILE + (to.y - from.y) * share);
    if (x === to.x && y === to.y) continue;
    if (!map.isWalkable(x, y, 'walker')) return false;
  }
  return true;
}

/**
 * Frames apart the keeper is heard at while its look holds still down the
 * room. The round and the sway share this as their greatest common divisor,
 * so every one of these samples lands on the same frame of both.
 */
const KEEPER_STEADY_LOOK_SAMPLE_FRAMES = greatestCommonDivisor(
  KEEPER_ROUND_FRAMES,
  KEEPER_DRIFT_PERIOD_FRAMES,
);
/** The sway's sine runs through a whole turn each period. */
const FULL_TURN_RADIANS = Math.PI * 2;
/** Samples a stride apart leave every frame between them within half a stride of one. */
const NEAREST_SAMPLE_SHARE_OF_STRIDE = 0.5;
/** The fastest the sway's target moves, in tiles a frame: its sine's steepest slope. */
const KEEPER_SWAY_MAX_TILES_PER_FRAME =
  (FULL_TURN_RADIANS * KEEPER_DRIFT_TILES) / KEEPER_DRIFT_PERIOD_FRAMES;
/**
 * The farthest any hearing moment the keeper can reach stands from the
 * nearest one sampled, in tiles of eye position, along its sway.
 */
const KEEPER_SAMPLED_EYE_BOUND_TILES =
  KEEPER_STEADY_LOOK_SAMPLE_FRAMES *
  NEAREST_SAMPLE_SHARE_OF_STRIDE *
  KEEPER_SWAY_MAX_TILES_PER_FRAME;

/**
 * The moments the cover gate hears a paw at the latch from (the keeper
 * looking at the room), each ready to hear one, over its whole pattern.
 *
 * Why this covers every moment it can be heard at: a hunt pauses its round
 * but not its sway, and turning away from a Belle shut back in her cage
 * restarts its round, so the two can come to stand in any pairing, not
 * only the ones an undisturbed pattern makes. The pattern makes, for every
 * frame of the round, the sway's frames that are a multiple of their
 * greatest common divisor apart, {@link KEEPER_STEADY_LOOK_SAMPLE_FRAMES}.
 * Every frame of the turns, where its look swings, is sampled; while its
 * look holds still down the room every that-many frames is, which moves
 * only how soon its round goes on once a hunt gives up. So any reachable
 * moment has a sampled one with the same look, its round within half that
 * many frames, and its eye within {@link KEEPER_SAMPLED_EYE_BOUND_TILES} along
 * the sway: its target moves at most {@link KEEPER_SWAY_MAX_TILES_PER_FRAME},
 * and the eye eases after it, never outrunning it. That is about a fifth of
 * a tile, under a tenth of the look's soft edge, where notice ramps in
 * gradually rather than all at once. {@link checkKeeperSamplingBound} holds
 * the bound there, so a retune that widens it fails rather than thins the
 * check.
 */
function keeperHearingMoments(grid: PrisonGrid): readonly CatteryKeeper[] {
  const round = new CatteryKeeper(grid);
  const moments: CatteryKeeper[] = [];
  const edge = KEEPER_STEADY_LOOK_SAMPLE_FRAMES;
  for (let frame = 0; frame < KEEPER_PATTERN_FRAMES; frame++) {
    const roundFrame = frame % KEEPER_ROUND_FRAMES;
    const holdingStill = roundFrame >= edge && roundFrame < KEEPER_LOOK_FRAMES - edge;
    const sampled = !holdingStill || frame % KEEPER_STEADY_LOOK_SAMPLE_FRAMES === 0;
    if (round.lookingAtRoom && sampled) moments.push(round.clone());
    round.step(null);
  }
  return moments;
}

const KEEPER_LOOK_SOFT_EDGE_TILES = (KEEPER_LOOK_REACH_PX / TILE_SIZE) * KEEPER_LOOK_SOFT_EDGE;
/** The sampled eye bound may be at most this share of the look's soft edge. */
const KEEPER_SAMPLED_EYE_SHARE_OF_SOFT_EDGE = 0.1;

/** The cover gate's sampling stays as fine as {@link keeperHearingMoments} argues it is. */
function checkKeeperSamplingBound(): void {
  check(
    'keeper',
    KEEPER_SAMPLED_EYE_BOUND_TILES <
      KEEPER_LOOK_SOFT_EDGE_TILES * KEEPER_SAMPLED_EYE_SHARE_OF_SOFT_EDGE,
    `every moment the keeper can be heard at has a sampled one within ${KEEPER_SAMPLED_EYE_BOUND_TILES.toFixed(3)} tiles of eye`,
  );
}

/**
 * Whether Belle, heard at `cage`'s latch from `front` at any moment the
 * keeper would hear it with the front out of its full view, gets away by
 * dashing straight to `hideout` and waiting there: the keeper closes on the
 * latch, searches and gives up without ever catching her. A jostle worked in
 * its full view is a catch at a glance, never a hunt to outlast. Her own cage
 * as the hideout hides her once she is in it, as the cattery does.
 */
function hideoutOutlastsHunt(
  hearingMoments: readonly CatteryKeeper[],
  cage: TilePoint,
  front: TilePoint,
  hideout: TilePoint,
): boolean {
  const ownCage = TOWER_CATTERY_CAGES.crawler_cat;
  const hidesInOwnCage = hideout.x === ownCage.x && hideout.y === ownCage.y;
  const from = tileCentre(front);
  const to = tileCentre(hideout);
  const dashFrames = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / PLAYER_SPEED);
  const belleAt = (frame: number): { x: number; y: number } | null => {
    if (frame >= dashFrames) return hidesInOwnCage ? null : to;
    const share = frame / dashFrames;
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
  };
  for (const moment of hearingMoments) {
    if (moment.sees(from) >= FULL_VIEW_SIGHTING) continue;
    const keeper = moment.clone();
    keeper.hear(tileCentre(cage));
    for (let frame = 0; frame < KEEPER_HUNT_WATCH_FRAMES; frame++) {
      const belle = belleAt(frame);
      keeper.step(belle);
      if (keeper.caught) return false;
      // Shut in her cage she is out of its sight for good, and its notice only drains from here.
      const shutInHerCage = belle === null;
      if (shutInHerCage) break;
    }
  }
  return true;
}

/**
 * Every cage's front has somewhere a short dash away that the keeper's round
 * never sees, and that also outlasts the hunt a jostle it hears sets off, so
 * its latch can be worked. Returns that hideout for each cage that has one.
 */
function checkKeeperCover(
  map: GameMap,
  watch: KeeperWatch,
): ReadonlyMap<CatteryCageOccupant, TilePoint> {
  const hideouts = new Map<CatteryCageOccupant, TilePoint>();
  const ownCage = TOWER_CATTERY_CAGES.crawler_cat;
  const plan = towerStoreyPlan('cattery');
  checkKeeperSamplingBound();
  const hearingMoments = keeperHearingMoments(keeperSightGrid(map, plan.width, plan.height));
  for (const occupant of CATTERY_TOWN_SIDE_CAGES) {
    const cage = TOWER_CATTERY_CAGES[occupant];
    const fronts = tilesAround(cage, ONE).filter((tile) =>
      map.isWalkable(tile.x, tile.y, 'walker'),
    );
    const hideout = fronts
      .flatMap((front) =>
        [...watch.shadows, ownCage]
          .filter((tile) => tileDistance(tile, front) <= KEEPER_COVER_REACH_TILES)
          .sort((a, b) => tileDistance(a, front) - tileDistance(b, front))
          .map((tile) => ({ front, tile })),
      )
      .find(
        ({ front, tile }) =>
          dashIsClear(map, front, tile) && hideoutOutlastsHunt(hearingMoments, cage, front, tile),
      );
    if (hideout !== undefined) hideouts.set(occupant, hideout.tile);
    flagChecks.push(() =>
      check(
        'keeper',
        hideout !== undefined,
        `${occupant}'s cage front has cover close by from the keeper, hunting a jostle or not`,
      ),
    );
  }
  return hideouts;
}

/** A west-wall cage whose front the keeper, looking down the room from its drift east, cannot reach. */
const FAR_LATCH_CAGE = 'taloncrest_inn_cat' as const satisfies CatteryCageOccupant;
/** Long enough for the keeper to swing round, float over and fill on a cat it heard. */
const HEARD_CATCH_FRAMES = KEEPER_SEARCH_FRAMES * 2;
/** Long enough for a hunt that never sees her to search, give up and float home. */
const HEARD_ESCAPE_FRAMES = KEEPER_SEARCH_FRAMES * 3;

type AfterTheJostle = 'slips_away' | 'stays';

/**
 * The owner's case: the keeper looks down the room from the far side of its
 * drift, and Belle at a far west latch, out of its look and beyond its reach,
 * jostles it. She then either slips off to `hideout` and waits, or stays at
 * the latch. Leaves her shut back in her cage when she is caught.
 */
function jostleTheFarLatch(
  walk: Walk,
  tower: TowerRig,
  hideout: TilePoint,
  after: AfterTheJostle,
): { readonly heard: boolean; readonly caught: boolean; readonly stillHunting: boolean } {
  const keeper = tower.storeys['cattery']['keeper'];
  const cat = walk.run.cat;
  const cage = TOWER_CATTERY_CAGES[FAR_LATCH_CAGE];
  const front = { x: cage.x + ONE, y: cage.y };
  const frontCentre = tileCentre(front);
  const outOfItsReach = (): boolean => {
    const eye = keeper.eye;
    const far = Math.hypot(frontCentre.x - eye.x, frontCentre.y - eye.y) > KEEPER_LOOK_REACH_PX;
    return far && keeper.sees(frontCentre) === 0;
  };
  let heard = false;
  let caught = false;
  const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
    if (moment.kind === 'latch_seen') heard = true;
    if (moment.kind === 'crawler_cat_recaged') caught = true;
  });
  for (let frame = 0; frame < LATCH_FRAMES; frame++) {
    standOn(cat, hideout);
    walk.tick();
    const lookingDownTheRoom = keeper.lookingAtRoom && !keeper.hunting;
    if (lookingDownTheRoom && keeper.suspicion === 0 && outOfItsReach()) break;
  }
  standOn(cat, front);
  tower.interact();
  const watchFrames = after === 'stays' ? HEARD_CATCH_FRAMES : HEARD_ESCAPE_FRAMES;
  for (let frame = 0; frame < watchFrames && !caught; frame++) {
    standOn(cat, after === 'stays' ? front : hideout);
    walk.tick();
  }
  for (let frame = 0; frame < BEAT_FRAMES && tower.storeys.playerLocked; frame++) walk.tick();
  stopListening();
  return { heard, caught, stillHunting: keeper.hunting };
}

/** Every cage but Belle's own, which she works from inside. */
const CATTERY_TOWN_SIDE_CAGES = Object.keys(TOWER_CATTERY_CAGES)
  .filter(isCatteryCageOccupant)
  .filter((occupant) => occupant !== 'crawler_cat');

function isCatteryCageOccupant(value: string): value is CatteryCageOccupant {
  return value in TOWER_CATTERY_CAGES;
}

/** Belle, her latch worked, sits on in her open cage through two of the keeper's rounds. Returns whether she was left there. */
function waitInOpenCage(walk: Walk, tower: TowerRig): boolean {
  let caught = false;
  const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
    if (moment.kind === 'crawler_cat_recaged') caught = true;
  });
  const cage = TOWER_CATTERY_CAGES.crawler_cat;
  for (let frame = 0; frame < KEEPER_CATCH_FRAMES && !caught; frame++) {
    standOn(walk.run.cat, cage);
    walk.tick();
  }
  for (let frame = 0; frame < BEAT_FRAMES && tower.storeys.playerLocked; frame++) walk.tick();
  stopListening();
  return !caught;
}

/** Belle, out of her cage, stands where the keeper looks most until it catches her. */
function catchBelleInTheOpen(
  walk: Walk,
  tower: TowerRig,
  open: TilePoint,
): { readonly caught: boolean; readonly shutIn: boolean; readonly metOnce: boolean } {
  let caught = false;
  let conversations = 0;
  const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
    if (moment.kind === 'crawler_cat_recaged') caught = true;
  });
  for (let frame = 0; frame < KEEPER_CATCH_FRAMES && !caught; frame++) {
    standOn(walk.run.cat, open);
    walk.tick();
    if (tower.conversation.isOpen) conversations++;
  }
  for (let frame = 0; frame < BEAT_FRAMES && tower.storeys.playerLocked; frame++) {
    walk.tick();
    if (tower.conversation.isOpen) conversations++;
  }
  stopListening();
  const cage = TOWER_CATTERY_CAGES.crawler_cat;
  const atCage = walk.run.cat.x === cage.x * TILE_SIZE && walk.run.cat.y === cage.y * TILE_SIZE;
  const cageShut = !tower.map.isWalkable(cage.x, cage.y, 'walker');
  const shutIn = !walk.progress.crawlerCatUncaged && atCage && cageShut;
  return { caught, shutIn, metOnce: conversations === 0 };
}

/**
 * Belle at a latch, jostling it until `done`. A jostle the keeper sees sets
 * it staring, so after one she waits out the stare and the rest of its look
 * before trying again, as a player learns to; between jostles she waits at
 * `hideAt`, out of its sight, as a player must.
 */
function pressLatchUntil(
  walk: Walk,
  tower: TowerRig,
  cage: TilePoint,
  done: () => boolean,
  hideAt: TilePoint | null,
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
  const hide = (): void => {
    if (hideAt !== null) standOn(cat, hideAt);
  };
  for (let frame = 0; frame < LATCH_FRAMES && !done(); frame++) {
    walk.tick();
    if (waitFrames > 0) {
      waitFrames--;
      hide();
      continue;
    }
    if (frame % LATCH_PRESS_GAP_FRAMES !== 0) continue;
    for (const tile of fronts) {
      standOn(cat, tile);
      if (tower.interact()) break;
    }
    hide();
  }
  stopListening();
  return done();
}

/** Belle's phases after her cattery chapter, until the party is whole again: she may climb back up in any of them. */
const PHASES_PAST_THE_CATTERY = MISSING_CATS_PHASES.filter(
  (phase) => phaseReached({ phase }, 'seeking_entry') && !phaseReached({ phase }, 'ascent'),
);
/** Every phase a cattery can be built in while Belle's cage may still stand shut on her. */
const PHASES_WITH_BELLE_IN_THE_TOWER = MISSING_CATS_PHASES.filter(
  (phase) => phaseReached({ phase }, 'cattery') && !phaseReached({ phase }, 'ascent'),
);
/** How long a rebuilt cattery runs before Belle, set down off her cage, is looked for. */
const HOLD_SETTLE_FRAMES = 10;

/** The run with Belle's side of the split the one being played, stood at the cattery's stair. */
function belleLiveInTheCattery(run: Run): TowerRig {
  const at = towerStairPlace('cattery', 'stairDown');
  const formation = run.split.formation;
  if (formation.kind === 'split') {
    const catGroup = PARTY_GROUP_IDS.find((id) => formation.groups[id].crawlers.includes('cat'));
    if (catGroup !== undefined) {
      run.split.formation = withGroupAt(withLiveGroup(formation, catGroup), catGroup, at);
    }
  }
  return new TowerRig(run, STOREY.cattery, at.tile);
}

function checkKeeperOffDuty(walk: Walk): void {
  section('Past her cattery chapter, Belle back in the cattery is never shut in again');
  for (const phase of PHASES_PAST_THE_CATTERY) {
    const snapshot = walk.run.snapshots.get(phase);
    check('keeper', snapshot !== undefined, `${phase} was recorded on the walk`);
    if (snapshot === undefined) continue;
    const run = new Run(snapshot.record);
    const tower = belleLiveInTheCattery(run);
    const open = watchTheKeeper(tower.map).mostWatched;
    let recaged = false;
    const stopListening = tower.bus.on('towerMoment', ({ moment }) => {
      if (moment.kind === 'crawler_cat_recaged') recaged = true;
    });
    for (let frame = 0; frame < KEEPER_CATCH_FRAMES && !recaged; frame++) {
      standOn(run.cat, open);
      tower.tick();
    }
    stopListening();
    check(
      'keeper',
      !recaged && run.progress.crawlerCatUncaged,
      `${phase}: Belle back in the cattery in the keeper's look is not caught and shut in`,
    );
    tower.dispose();
  }
}

function checkBelleNeverHeldWithoutALatch(walk: Walk): void {
  section('A cattery rebuilt from any phase holds Belle in her cage only behind a latch');
  const cage = TOWER_CATTERY_CAGES.crawler_cat;
  for (const phase of PHASES_WITH_BELLE_IN_THE_TOWER) {
    const snapshot = walk.run.snapshots.get(phase);
    check('keeper', snapshot !== undefined, `${phase} was recorded on the walk`);
    if (snapshot === undefined) continue;
    for (const uncaged of [false, true]) {
      const run = new Run(snapshot.record);
      run.progress.crawlerCatUncaged = uncaged;
      const tower = belleLiveInTheCattery(run);
      const offCage = towerStairLanding('cattery', 'stairDown');
      for (let frame = 0; frame < HOLD_SETTLE_FRAMES; frame++) {
        standOn(run.cat, offCage);
        tower.tick();
      }
      const held = run.cat.x === cage.x * TILE_SIZE && run.cat.y === cage.y * TILE_SIZE;
      const cageShut = !tower.map.isWalkable(cage.x, cage.y, 'walker');
      const latchTaken = held && tower.interact();
      check(
        'keeper',
        !held || (cageShut && latchTaken),
        `${phase} with her latch ${uncaged ? 'worked' : 'unworked'}: Belle is held in her cage only behind a latch she can work (held ${held}, shut ${cageShut}, latch ${latchTaken})`,
      );
      tower.dispose();
    }
  }
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

// ── The reward ────────────────────────────────────────────────────────────────

/** The hushing piece among what `crawler` carries, found by its mechanic rather than its name. */
function hushingPieceIn(crawler: Player): {
  readonly id: ItemId;
  readonly hush: GearTraitOf<'quietPaws'>;
} | null {
  for (const id of Object.keys(ITEM_DEF).filter(isItemId)) {
    if (crawler.inventory.countOf(id) === 0) continue;
    const hush = (ITEM_DEF[id].traits ?? []).find((trait) => trait.kind === 'quietPaws');
    if (hush?.kind === 'quietPaws') return { id, hush };
  }
  return null;
}

/** The first row of open floor at least `length` tiles long, by its west end. */
function openFloorRun(map: GameMap, length: number): TilePoint | null {
  for (let y = 0; y < map.structure.length; y++) {
    let run = 0;
    for (let x = 0; x < map.structure[y].length; x++) {
      run = map.isWalkable(x, y, 'walker') ? run + 1 : 0;
      if (run >= length) return { x: x - length + 1, y };
    }
  }
  return null;
}

const HUSH_ROOM_KIND = 'store';
const HUSH_ROOM_FLOOR = 0;
/** Tiles the rat stands east of the crawlers: past the hushed reach, inside its whole range. */
function hushProbeTiles(noticeShare: number): number {
  return (RAT_AGGRO_RANGE_TILES * (1 + noticeShare)) / 2;
}
/** How far into the hushed reach the wearer steps to be noticed regardless. */
const HUSH_INSIDE_SHARE = 0.5;
/** Far past any hush's partner reach: where the wearer goes to leave the other crawler unhushed. */
const HUSH_FAR_OFF_TILES = 40;

function checkRewardHushes(walk: Walk): void {
  section('The reward hushes its wearer, and the crawler beside her');
  const reward = hushingPieceIn(walk.run.cat);
  check('hush', reward !== null, "Belle's bag holds a hushing piece after the questline");
  if (reward === null) return;
  if (FAULT === 'reward-bell-loud')
    breakMethod(traitHandler('quietPaws'), 'onTick', () => undefined);

  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(HUSH_ROOM_KIND, HUSH_ROOM_FLOOR, null);
  const probeTiles = hushProbeTiles(reward.hush.noticeShare);
  const runLength = Math.ceil(probeTiles) + 1;
  const floor = openFloorRun(map, runLength);
  check('hush', floor !== null, `the store has ${runLength} tiles of open floor in a row`);
  if (floor === null) return;
  const ratTile = { x: floor.x + runLength - 1, y: floor.y };
  const probeX = (ratTile.x - probeTiles) * TILE_SIZE;
  const hushedReachTiles = reward.hush.noticeShare * RAT_AGGRO_RANGE_TILES;
  const nearX = (ratTile.x - hushedReachTiles * HUSH_INSIDE_SHARE) * TILE_SIZE;
  const rowY = floor.y * TILE_SIZE;

  const pm = new PlayerManager(floor.x, floor.y, undefined);
  const { human, cat } = pm;
  const bus = new EventBus();
  const roster = new MobRoster(map, new SpellSystem());
  const gear = new GearSystem({ gameMap: map, bus, audio: null, audioScope: null, pm, roster });
  const place = (crawler: Player, x: number): void => {
    crawler.x = x;
    crawler.y = rowY;
  };
  const freshRatNotices = (targets: Player[], alertedTo: Player | null = null): Player | null => {
    gear.update();
    const rat = spawnMob('rat', ratTile, map, liveSpawnContext('dev:spawn'));
    if (!(rat instanceof Rat)) return null;
    if (alertedTo !== null) rat.noticeTarget(alertedTo);
    rat.updateAI(targets);
    return rat.currentTarget;
  };

  place(human, probeX);
  place(cat, probeX);
  check(
    'hush',
    freshRatNotices([human]) === human,
    'bare, the human is noticed past the hushed reach (the rat can see him at all)',
  );
  human.inventory.addItem(reward.id, 1);
  human.inventory.equipByItemId(reward.id);
  check('hush', human.inventory.equipment.isEquipped(reward.id), 'the human wears the reward');
  check(
    'hush',
    freshRatNotices([human]) === null,
    'wearing it, the human goes unnoticed past the hushed reach',
  );
  place(human, nearX);
  check(
    'hush',
    freshRatNotices([human]) === human,
    'wearing it, the human is still noticed inside the hushed reach',
  );
  place(human, probeX);
  check(
    'hush',
    freshRatNotices([cat]) === null,
    'Belle beside the wearer goes unnoticed past the hushed reach',
  );
  place(human, probeX - HUSH_FAR_OFF_TILES * TILE_SIZE);
  check(
    'hush',
    reward.hush.partnerRangeTiles < HUSH_FAR_OFF_TILES && freshRatNotices([cat]) === cat,
    'Belle far from the wearer is noticed at the whole range',
  );
  place(human, probeX);
  check(
    'hush',
    freshRatNotices([human], human) === human,
    'a rat alerted to the wearer answers from its whole range',
  );
  gear.dispose();
}

// ── The door and the drain ────────────────────────────────────────────────────

function checkTowerDoor(): void {
  section("The tower's front door refuses in every phase");
  const door = townEntry(TOWN_TOWER_ID);
  const refusalOf: typeof towerDoorRefusal =
    FAULT === 'door-opens-after-quest'
      ? (entry, standing) =>
          standing === 'closedByOrder' ? null : towerDoorRefusal(entry, standing)
      : towerDoorRefusal;
  for (const phase of MISSING_CATS_PHASES) {
    const refusal = refusalOf(door, towerDoorStandingFor(missingCatsProgressAt(phase)));
    check(
      'door',
      typeof refusal === 'string' && refusal.length > 0,
      `at ${phase} the tower door refuses`,
    );
  }
}

// ── The capture's drop lands on the jingle's hit ─────────────────────────────

/** How long the player holds the capture's pretence open before reading on, in seconds: a skimmer to a dawdler. */
const PRETENCE_READING_SECONDS = [0, 2, 6, 15, 30, 60] as const;
/** How far, in world ticks, the landing may fall from its mark: the tick a step starts on is rounded to a frame. */
const CAPTURE_LANDING_TOLERANCE_TICKS = 2;
/** More ticks than the whole capture takes after the longest read. */
const CAPTURE_MAX_TICKS = WORLD_TICKS_PER_SECOND * 120;
/** More presses than any page of the capture's talks needs, reveal included. */
const CAPTURE_MAX_READ_PRESSES = 40;
/** Belle's tile on the open floor the capture is played on. */
const CAPTURE_BELLE_TILE = { x: 20, y: 20 } as const;
/** How far above Belle, in tiles, the raveling comes to rest over her. */
const CAPTURE_RAVELING_REST_TILES_ABOVE = 0.6;

type CaptureStep = CutsceneStep<never, CaptureScriptActorId>;

interface CaptureTiming {
  /** Seconds into the capture jingle that the raveling came to rest over Belle. */
  readonly landedAtCueS: number;
  /** Seconds from the pretence closing to the raveling coming to rest. */
  readonly landedAfterPretenceS: number;
}

function readThrough(conversation: Conversation): void {
  for (let press = 0; press < CAPTURE_MAX_READ_PRESSES && conversation.isOpen; press++) {
    conversation.advance();
    conversation.update(null);
  }
}

/** Plays the capture's script on a ticking audio clock, holding its pretence open `readingS` seconds. */
function playCaptureReading(readingS: number): CaptureTiming | null {
  const belle = { x: CAPTURE_BELLE_TILE.x * TILE_SIZE, y: CAPTURE_BELLE_TILE.y * TILE_SIZE };
  const restingAt = {
    x: belle.x,
    y: belle.y - CAPTURE_RAVELING_REST_TILES_ABOVE * TILE_SIZE,
  };
  let audioNowS = 0;
  let cueTopAtS: number | null = null;
  const clock: CutsceneCueClock = {
    start: (_cue, fromS) => {
      cueTopAtS = audioNowS - fromS;
      return audioNowS;
    },
    nowS: () => audioNowS,
  };
  const conversation = new Conversation(null);
  const director = new CutsceneDirector<never, CaptureScriptActorId>({
    conversation,
    teleportDaveOut: () => undefined,
    playSound: () => undefined,
    runWorldAction: noWorldActions,
    cueClock: clock,
  });
  const staging = new CaptureStaging(belle);
  for (const id of CAPTURE_ACTOR_IDS) director.actors.register(id, () => staging.actor(id));
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  const active = new PlayerManager(CAPTURE_BELLE_TILE.x, CAPTURE_BELLE_TILE.y, undefined).human;
  const raveling = staging.actor('capture_raveling');
  const script = captureScript({ belle, towerDoor: belle, choice: 'kept' });
  const fromTheTop = (step: CaptureStep): CaptureStep =>
    step.kind === 'playCue' ? { kind: step.kind, cue: step.cue } : step;
  const [first, ...later] = script;
  const played: CutsceneScript<never, CaptureScriptActorId> =
    FAULT === 'capture-drop-off-hit' ? [fromTheTop(first), ...later.map(fromTheTop)] : script;
  director.play(played);

  let pretenceOpenedAtS: number | null = null;
  let pretenceClosedAtS: number | null = null;
  for (let tick = 0; tick < CAPTURE_MAX_TICKS && director.isActive; tick++) {
    audioNowS += 1 / WORLD_TICKS_PER_SECOND;
    director.tickEffects();
    director.tickWorld(active, map);
    staging.update();
    if (conversation.isOpen) {
      if (pretenceClosedAtS === null) {
        pretenceOpenedAtS ??= audioNowS;
        if (audioNowS - pretenceOpenedAtS >= readingS) {
          readThrough(conversation);
          pretenceClosedAtS = audioNowS;
        }
      } else {
        readThrough(conversation);
      }
    }
    const at = raveling.position();
    if (
      pretenceClosedAtS !== null &&
      cueTopAtS !== null &&
      at.x === restingAt.x &&
      at.y === restingAt.y
    ) {
      return {
        landedAtCueS: audioNowS - cueTopAtS,
        landedAfterPretenceS: audioNowS - pretenceClosedAtS,
      };
    }
  }
  return null;
}

function checkCaptureDropOnHit(): void {
  section(
    "The capture's raveling lands on the jingle's drop hit, however long the pretence is read",
  );
  const toleranceS = CAPTURE_LANDING_TOLERANCE_TICKS / WORLD_TICKS_PER_SECOND;
  for (const readingS of PRETENCE_READING_SECONDS) {
    const timing = playCaptureReading(readingS);
    if (timing === null) {
      check('capture', false, `read for ${readingS} s: the raveling never came to rest over Belle`);
      continue;
    }
    check(
      'capture',
      Math.abs(timing.landedAtCueS - CAPTURE_RAVELING_LANDS_AT_S) <= toleranceS,
      `read for ${readingS} s: the raveling lands ${timing.landedAtCueS.toFixed(2)} s into the jingle, on its ${CAPTURE_RAVELING_LANDS_AT_S} s hit`,
    );
    check(
      'capture',
      Math.abs(timing.landedAfterPretenceS - CAPTURE_DROP_AFTER_PRETENCE_S) <= toleranceS,
      `read for ${readingS} s: and ${timing.landedAfterPretenceS.toFixed(2)} s after the pretence closes (${CAPTURE_DROP_AFTER_PRETENCE_S} s)`,
    );
  }
}

// ── The human's Journal inside the tower ─────────────────────────────────────

/** One of the human's tower steps, and the storeys he may stand on while it is his. */
interface HumanTowerStepCase {
  readonly label: string;
  readonly phase: TowerStepPhase;
  readonly progress: MissingCatsProgress;
  readonly carried: TowerStepCarried;
  readonly from: readonly TowerStoreyId[];
}

const NOTHING_CARRIED: TowerStepCarried = { tuna: false };
const TUNA_CARRIED: TowerStepCarried = { tuna: true };

function humanTowerStepCases(): HumanTowerStepCase[] {
  const at = (
    phase: TowerStepPhase,
    done: Partial<Pick<MissingCatsProgress, 'kitchen' | 'portcullisRaised'>>,
  ): MissingCatsProgress => Object.assign(missingCatsProgressAt(phase), done);
  const kitchenCases = KITCHEN_STAGES.flatMap((kitchen) =>
    [NOTHING_CARRIED, TUNA_CARRIED].map((carried): HumanTowerStepCase => ({
      label: `the kitchen at ${kitchen}${carried.tuna ? ' with tuna' : ''}`,
      phase: 'gatehouse',
      progress: at('gatehouse', { kitchen }),
      carried,
      from:
        kitchen === 'note_in_hand' && !carried.tuna
          ? ['gatehouse', 'kitchen']
          : ['cistern', 'gatehouse', 'kitchen'],
    })),
  );
  return [
    {
      label: 'the sluice',
      phase: 'cistern',
      progress: at('cistern', {}),
      carried: NOTHING_CARRIED,
      from: ['cistern'],
    },
    ...kitchenCases,
    {
      label: 'the raised portcullis',
      phase: 'bell_storey',
      progress: at('bell_storey', { portcullisRaised: true }),
      carried: NOTHING_CARRIED,
      from: ['gatehouse', 'kitchen'],
    },
  ];
}

/** Where following the Journal's way indoors from `start` ends, and every storey it passed. */
function followTheJournalIndoors(
  route: (storey: number) => InteriorObjectiveRoute,
  start: TowerStoreyId,
): { readonly end: InteriorObjectiveRoute; readonly storey: number; readonly passed: number[] } {
  let storey = towerStoreyIndex(start);
  const passed = [storey];
  for (let flight = 0; flight <= TOWER_FLOOR_COUNT; flight++) {
    const end = route(storey);
    if (end.kind !== 'stairs') return { end, storey, passed };
    storey += end.direction === 'up' ? ONE : -ONE;
    passed.push(storey);
  }
  return { end: { kind: 'none' }, storey, passed };
}

/**
 * Every step of the human's tower chapters, followed from each storey he may
 * stand on: a step in the tower leads up or down its own stairs to the storey
 * the step is on and never out through the cistern, and a step outside it
 * leads out by the gatehouse's front door rather than back down the sewer.
 */
function checkHumanTowerRoutes(): void {
  section("Inside the tower, the human's Journal leads to his next step, never back to the sewer");
  const cistern = towerStoreyIndex('cistern');
  const doorTarget = (building: BuildingId): TrackerTarget | undefined =>
    doorwayBeaconTarget(townEntry(building)) ?? undefined;
  for (const stepCase of humanTowerStepCases()) {
    const step = towerStep(stepCase.phase, stepCase.progress, stepCase.carried);
    const target = towerStepTarget(step.place, doorTarget);
    for (const from of stepCase.from) {
      const followed = followTheJournalIndoors(
        (storey) =>
          interiorObjectiveRoute(target, {
            building: TOWN_TOWER_ID,
            storey,
            isTower: true,
            hasStreetDoor: towerStoreyPlan(towerStoreyAt(storey) ?? 'cistern').door.length > 0,
          }),
        from,
      );
      const where = `${stepCase.label} ("${step.objective}") from the ${from}`;
      if (step.place.kind === 'store') {
        check(
          'journal indoors',
          followed.end.kind === 'street_door' && !followed.passed.includes(cistern),
          `${where} leads out by the front door (ends ${followed.end.kind} on storey ${followed.storey}, passing ${followed.passed.join('>')})`,
        );
        continue;
      }
      const stepStorey = towerStoreyIndex(step.place.storey);
      const climbedPast = followed.passed.slice(ONE);
      const throughTheCistern = stepStorey !== cistern && climbedPast.includes(cistern);
      check(
        'journal indoors',
        followed.end.kind === 'here' && followed.storey === stepStorey && !throughTheCistern,
        `${where} leads to the ${step.place.storey} (ends ${followed.end.kind} on storey ${followed.storey}, passing ${followed.passed.join('>')})`,
      );
    }
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

/** The Journal's missing-cats line as the floor scene gathers it now. */
function missingCatsObjective(scene: FloorScene): string {
  const entries = scene['collectTrackerEntries']();
  const entry = entries.find((candidate) => candidate.id === MISSING_CATS_QUEST_ID);
  return entry?.objective ?? 'no line';
}

/**
 * A tin of tuna bought inside the General Store, with the note from upstairs
 * in hand: the Journal must move on to sending it up while the party is still
 * in the shop, which it can only do by reading the bags of the crawlers in the
 * room rather than the floor's, which are left as they were at the door.
 */
async function checkJournalReadsTheRoomsBags(harness: SceneHarness): Promise<void> {
  section('Indoors, the Journal reads the bags of the party in the room');
  const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
  const scene = harness.scene;
  const progress = scene['missingCatsProgress'];
  const before = captureMissingCatsProgress(progress);
  const atTheNote = missingCatsProgressAt('gatehouse');
  atTheNote.kitchen = 'note_in_hand';
  restoreMissingCatsProgress(progress, captureMissingCatsProgress(atTheNote));
  const toBuy = missingCatsObjective(scene);
  scene['enterBuilding'](townEntry(STORE));
  const shop: unknown = Reflect.get(scene['sceneManager'], 'current');
  if (!(shop instanceof BuildingInteriorScene)) {
    check('journal indoors', false, 'walking into the General Store put up no room');
    restoreMissingCatsProgress(progress, before);
    return;
  }
  shop['human'].inventory.addItem(TUNA_TIN_ITEM, ONE);
  const bought = missingCatsObjective(scene);
  const floorBagEmpty = scene.pm.human.inventory.countOf(TUNA_TIN_ITEM) === 0;
  shop.onExit();
  shop.ui.dispose();
  const afterShop = missingCatsObjective(scene);
  restoreMissingCatsProgress(progress, before);
  check(
    'journal indoors',
    toBuy.includes('Buy a tin of tuna'),
    `with the note in hand and no tuna the Journal sends the party shopping ("${toBuy}")`,
  );
  check(
    'journal indoors',
    floorBagEmpty && bought.includes('Send the tuna up'),
    `a tin bought in the shop moves the Journal on before the party leaves ("${bought}")`,
  );
  check(
    'journal indoors',
    afterShop.includes('Buy a tin of tuna'),
    `once the room is gone the Journal reads the floor's own bags again ("${afterShop}")`,
  );
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
  if (FAULT === 'journal-reads-door-bags') {
    breakMethod(prototype, 'partyOnShow', function (this: object) {
      return { human: Reflect.get(this, 'human'), cat: Reflect.get(this, 'cat') };
    });
  }
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
  if (FAULT === 'cattery-stair-unguarded') dropStairRefusal(SPLIT_STAIR_REFUSAL.cellmateFirst);
  if (FAULT === 'fight-stair-open') {
    Object.defineProperty(TowerRitualSystem.prototype, 'stairDownRefusal', { get: () => null });
  }
  if (FAULT === 'tower-stands-guard-after-warden') {
    breakMethod(TowerStoreysSystem.prototype, 'standDown', () => undefined);
    Object.defineProperty(BellStoreyWorks.prototype, 'still', { get: () => false });
  }
  if (FAULT === 'cattery-keeper-blind') breakMethod(CatteryKeeper.prototype, 'sees', () => 0);
  if (FAULT === 'cattery-keeper-deaf')
    breakMethod(CatteryKeeper.prototype, 'hear', () => undefined);
  if (FAULT === 'cattery-cage-unsafe')
    breakMethod(CatteryWorks.prototype, 'inOwnCage', () => false);
  if (FAULT === 'archive-ward-relights') relightWardOffItsPlate();
  if (FAULT === 'archive-bell-unanswered') {
    breakMethod(ArchiveWorks.prototype, 'answerBell', () => undefined);
  }
  if (FAULT === 'archive-stair-unguarded') dropStairRefusal(SPLIT_STAIR_REFUSAL.keyRingFirst);
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
  if (FAULT === 'kitchen-press-skips-a-step') {
    const advance = methodOf(KitchenWorks.prototype, 'advance');
    breakMethod(KitchenWorks.prototype, 'advance', function (this: object) {
      advance(this);
      advance(this);
    });
  }
  if (FAULT === 'cellmate-unfed')
    breakMethod(BellStoreyWorks.prototype, 'seatCellmate', () => undefined);
  if (FAULT === 'grate-stays-shut')
    breakMethod(MissingCatsQuestSystem.prototype, 'openGrate', () => undefined);
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
checkWatchersCatchAtAGlance(walk);
checkWestWardStaysOut(walk);
checkKitchenSequence(walk);
checkKeeperOffDuty(walk);
checkBelleNeverHeldWithoutALatch(walk);
checkResumes(walk);
checkTowerResumes();
checkWholeSplits();
checkTowerLoan();
checkCompletion(walk);
checkRewardHushes(walk);
checkDescentAfterTheWarden();
checkTowerDoor();
checkCaptureDropOnHit();
checkHumanTowerRoutes();
checkStormDrain(walk);
checkInvestigationLeads();
checkInnWallSitter();
const harness = await buildSceneHarness();
await checkJournalReadsTheRoomsBags(harness);
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
