/**
 * The station upgrades' checks for `verify:borrowed-blueprints`: which X
 * press an upgrade takes and which it leaves to repair / load, the fixed
 * costs and the refusal when the party is short, the channel and what
 * finishing it does, an upgraded machine working four wood a press (or what
 * the party has left), the upgraded look surviving a reload, and the quest
 * completing when the second station is done.
 *
 * Stood up on a real generated village with real crawlers, the real
 * `BlueprintsQuestSystem` and the real sawmill service, so the gate needs no
 * scene.
 */

import { createBriarHollowState, type BriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { teachBoth } from '../../src/core/CraftSkills';
import { EventBus } from '../../src/core/EventBus';
import { createPartyCraftsState } from '../../src/core/partyCrafts';
import { PartyTools } from '../../src/core/PartyTools';
import { formatCost, partyCount, type ResourceCost } from '../../src/core/partyResources';
import { RESOURCE_IDS } from '../../src/core/resourceIds';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import { FENNA } from '../../src/dialog/scripts/briarHollow';
import { GameMap } from '../../src/map/GameMap';
import type { BriarHollowSite } from '../../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { BlueprintsQuestSystem } from '../../src/systems/briarHollow/BlueprintsQuestSystem';
import {
  BLUEPRINTS_QUEST_ID,
  grantBlueprintsItem,
} from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import {
  ROPE_WALK_UPGRADE_COST,
  SAW_UPGRADE_COST,
  STATION_UPGRADE_CONSTRUCTION_XP,
  STATION_UPGRADE_SECONDS,
  STATION_UPGRADE_SHORT_LINE,
  UPGRADED_WOOD_PER_PRESS,
  stationUpgradeCost,
} from '../../src/systems/briarHollow/blueprints/StationUpgrades';
import {
  processingStationsOf,
  type ProcessingStation,
  type ProcessingStationKind,
} from '../../src/systems/briarHollow/processingStations';
import { VillageServices } from '../../src/systems/briarHollow/services/VillageServices';
import {
  BOARDS_PER_WOOD,
  MANUAL_PROCESS_SECONDS,
  PROCESS_CONSTRUCTION_XP_PER_WOOD,
  ROPE_PER_WOOD,
} from '../../src/systems/briarHollow/services/woodProcessing';
import { VillagerSystem } from '../../src/systems/briarHollow/VillagerSystem';
import { allocCanvas, surfaceContext } from '../../src/core/canvasSurface';
import {
  interactionPromptsDrawnThisFrame,
  setInteractionPromptsSuppressed,
} from '../../src/ui/InteractionPrompt';
import type { SoundId } from '../../src/audio/sounds';
import { cueSoundOr } from '../../src/systems/briarHollow/blueprints/blueprintsSoundCues';
import { PLAIN_SAWING_LOOP, SawmillService } from '../../src/systems/briarHollow/services/sawmill';
import type { Check } from './fenna';
import { setViewportSize } from '../../src/core/Viewport';
import { PROGRESS_PRESETS } from '../../src/ui/Box';
import { TEXT_PRESETS } from '../../src/ui/TextBox';
import type { VillageQuestPhase } from '../../src/core/villageQuestPhase';
import type { CrawlerKind } from '../../src/core/SkillManager';
import { DefenseStructures } from '../../src/systems/briarHollow/DefenseStructures';
import type { QuestGuidance } from '../../src/systems/briarHollow/questGuidance';
import { VillageQuestGuide } from '../../src/systems/briarHollow/VillageQuestGuide';

const STATIONS_MAP_SIZE = 280;
const STATIONS_MAP_SEED = 1;
const UPDATES_PER_SECOND = 60;
/** A few frames past the channel's own length, so rounding can never leave it one short. */
const FRAME_SLACK = 3;
const UPGRADE_FRAMES = Math.round(STATION_UPGRADE_SECONDS * UPDATES_PER_SECOND) + FRAME_SLACK;
const PRESS_FRAMES = Math.round(MANUAL_PROCESS_SECONDS * UPDATES_PER_SECOND) + FRAME_SLACK;
/** Far enough below a machine that nothing at the sawmill is in reach. */
const OUT_OF_REACH_TILES = 6;
/** A step bigger than the channel's drift tolerance. */
const WALK_OFF_PX = 4;
/** Enough wood for more than one upgraded press. */
const PLENTY_OF_WOOD = 10;
/** Less than one upgraded press's worth. */
const SHORT_WOOD = 3;
/**
 * The prices Fenna's quest quotes, written out here rather than read from
 * the constants under test, so a changed constant is a changed promise.
 */
const PROMISED_SAW_COST: ResourceCost = { wood_board: 30, rope: 15, stone: 20 };
const PROMISED_ROPE_WALK_COST: ResourceCost = { wood_board: 12, rope: 20, stone: 10 };
/** Room for one prompt on the throwaway canvas the prompt checks draw on. */
const PROMPT_CANVAS_PX = 64;
/** A screen big enough to hold both machines' captions, for the far-caption check. */
const CAPTION_SCREEN_PX = 1200;
/** Where the camera puts the saw's footprint, so its caption stands well inside the screen. */
const CAPTION_CAMERA_INSET_PX = 400;
/** A Construction level high enough that every discounted build is cheaper. */
const DISCOUNTED_CONSTRUCTION_LEVEL = 10;
/** The boards the Plea's own shortfall asks for in the guide checks: unlike the saw upgrade's, so its count line is its own. */
const PLEA_BOARDS_TARGET = 10;
/** One caption line's height, as the guide stacks them. */
const CAPTION_LINE_PX = 13;

function sameCost(a: ResourceCost, b: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (a[id] ?? 0) === (b[id] ?? 0));
}

let sharedMap: GameMap | null = null;

/** One generated overworld for every rig: generation is the slow part, and each rig resyncs the station flags from its own state. */
function stationsMap(): GameMap {
  sharedMap ??= new GameMap({
    mapSize: STATIONS_MAP_SIZE,
    mapType: 'overworld',
    worldSeed: STATIONS_MAP_SEED,
    tileHeight: TILE_SIZE,
  });
  return sharedMap;
}

/** A real village with the real quest system on it; also stood up by the eviction checks. */
export interface StationsRig {
  readonly map: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly villagers: VillagerSystem;
  readonly services: VillageServices;
  readonly bus: EventBus;
  readonly quest: BlueprintsQuestSystem;
  readonly announced: string[];
  readonly callouts: string[];
  readonly completed: string[];
  /** The Plea's phase the quest reads, for the siege checks to move. */
  readonly plea: { phase: VillageQuestPhase };
}

export function stationsRig(
  state: BriarHollowState = createBriarHollowState(),
): StationsRig | null {
  const map = stationsMap();
  const site = map.briarHollow;
  if (site === null) return null;
  state.unlocks.processingStations = true;
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  teachBoth(human, cat, 'construction');
  const crafts = createPartyCraftsState();
  const bus = new EventBus();
  const completed: string[] = [];
  bus.on('questCompleted', (event) => completed.push(event.questId));
  const conversation = new Conversation(null);
  const villagers = new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus,
    audio: null,
    conversation,
    party: () => ({
      hpFractions: { human: 1, cat: 1 },
      stone: 0,
      axeTier: null,
      pickaxeTier: null,
      constructionLevels: { human: 1, cat: 1 },
      constructionLearned: true,
    }),
    random: () => 0,
  });
  const announced: string[] = [];
  const callouts: string[] = [];
  const questRef: { quest: BlueprintsQuestSystem | null } = { quest: null };
  const plea: { phase: VillageQuestPhase } = { phase: 'fortifying' };
  const services = new VillageServices({
    human,
    cat,
    state,
    partyTools: new PartyTools(crafts.tools),
    partyCrafts: crafts,
    site,
    villagers,
    bus,
    audio: null,
    sawmill: { working: false },
    menus: {
      enqueueReward: () => undefined,
      afterRewardsDrain: (run) => run(),
      openResourcingExplainer: () => undefined,
      announce: (message) => announced.push(message),
    },
    isInteractKey: (key) => key === ' ',
    noteResourceActivity: () => undefined,
    worldHalted: () => false,
    stationsUpgrading: () => questRef.quest?.stations.isUpgrading === true,
  });
  const quest = new BlueprintsQuestSystem({
    state,
    gameMap: map,
    site,
    bus,
    audio: null,
    roster: new MobRoster(map, new SpellSystem()),
    human,
    cat,
    active: () => (human.isActive ? human : cat),
    villagers,
    conversation,
    announce: (message) => announced.push(message),
    callout: (text) => callouts.push(text),
    onTileChanged: () => undefined,
    noteResourceActivity: () => undefined,
    worldHalted: () => false,
    pleaPhase: () => plea.phase,
    guideTarget: () => null,
  });
  questRef.quest = quest;
  return {
    map,
    site,
    state,
    human,
    cat,
    villagers,
    services,
    bus,
    quest,
    announced,
    callouts,
    completed,
    plea,
  };
}

/** A rig at `build_stations` with the blueprints in Carl's quest slot. */
function buildStationsRig(): StationsRig | null {
  const rig = stationsRig();
  if (rig === null) return null;
  rig.state.blueprints.phase = 'build_stations';
  grantBlueprintsItem(rig.human, 'quest_blueprints');
  return rig;
}

function machineOf(rig: StationsRig, kind: ProcessingStationKind): ProcessingStation | null {
  return processingStationsOf(rig.site).find((station) => station.kind === kind) ?? null;
}

/** Stands Carl on the tile just south of `machine`, well inside its reach. */
function standBeside(rig: StationsRig, machine: ProcessingStation): void {
  const { x, y, h } = machine.footprint;
  rig.human.x = x * TILE_SIZE;
  rig.human.y = (y + h) * TILE_SIZE;
}

function give(rig: StationsRig, cost: ResourceCost): void {
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    if (amount !== undefined && amount > 0) rig.human.inventory.addItem(id, amount);
  }
}

function holds(rig: StationsRig, cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => partyCount(rig.human, rig.cat, id) === (cost[id] ?? 0));
}

function runUpgrade(rig: StationsRig): void {
  for (let frame = 0; frame < UPGRADE_FRAMES; frame++) rig.quest.stations.update();
}

function anchorFlag(rig: StationsRig, machine: ProcessingStation): boolean {
  const { x, y } = machine.footprint;
  return rig.map.structure[y][x].stationUpgraded === true;
}

/** Where a crawler stands in Construction: a grant either adds its XP or crosses a level. */
function constructionProgress(crawler: HumanPlayer): { level: number; xp: number } {
  return {
    level: crawler.craftSkills.getRealLevel('construction'),
    xp: crawler.craftSkills.getXp('construction'),
  };
}

// ── X precedence ─────────────────────────────────────────────────────────

/** Which X presses the upgrade takes, and which it leaves for repair / load. */
export function verifyStationXPrecedence(check: Check): void {
  const rig = stationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  give(rig, SAW_UPGRADE_COST);
  standBeside(rig, saw);
  rig.state.blueprints.phase = 'midge_delivered';
  grantBlueprintsItem(rig.human, 'quest_blueprints');
  check(!rig.quest.tryUpgradeStation(rig.human), 'before build_stations: X falls through');
  rig.state.blueprints.phase = 'build_stations';
  rig.human.inventory.removeItems('quest_blueprints', 1);
  check(
    !rig.quest.tryUpgradeStation(rig.human),
    'build_stations without the blueprints: X falls through',
  );
  grantBlueprintsItem(rig.human, 'quest_blueprints');
  rig.human.y += OUT_OF_REACH_TILES * TILE_SIZE;
  check(!rig.quest.tryUpgradeStation(rig.human), 'out of reach of any station: X falls through');
  check(rig.quest.stations.upgradableInReach(rig.human) === null, 'and no station offers itself');
  standBeside(rig, saw);
  check(rig.quest.tryUpgradeStation(rig.human), 'in reach of the saw: X is taken');
  check(rig.quest.stations.isUpgrading, 'and the upgrade channel starts');
  check(rig.quest.tryUpgradeStation(rig.human), 'a second X while it runs is still taken');
  rig.quest.stations.cancel();
  rig.state.blueprints.stationsUpgraded.saw = true;
  check(
    !rig.quest.tryUpgradeStation(rig.human),
    'beside an already-upgraded saw: X falls through to repair / load',
  );

  const tapRig = buildStationsRig();
  const tapSaw = tapRig === null ? null : machineOf(tapRig, 'boards');
  if (tapRig === null || tapSaw === null) return;
  give(tapRig, SAW_UPGRADE_COST);
  standBeside(tapRig, tapSaw);
  const { x, y, w, h } = tapSaw.footprint;
  const onMachine = { x: (x + w / 2) * TILE_SIZE, y: (y + h / 2) * TILE_SIZE };
  check(
    !tapRig.quest.handleDoubleTap(
      onMachine.x + OUT_OF_REACH_TILES * TILE_SIZE,
      onMachine.y,
      tapRig.human,
    ),
    'a double tap off the machine is left alone',
  );
  check(
    tapRig.quest.handleDoubleTap(onMachine.x, onMachine.y, tapRig.human),
    'a double tap on the machine starts its upgrade',
  );
  check(tapRig.quest.stations.isUpgrading, 'and the channel runs');
}

// ── Costs and the refusal ────────────────────────────────────────────────

/** The fixed prices, and what a short party is told and guided to. */
export function verifyStationCosts(check: Check): void {
  check(
    sameCost(SAW_UPGRADE_COST, PROMISED_SAW_COST),
    `the saw costs ${formatCost(PROMISED_SAW_COST)}`,
  );
  check(
    sameCost(ROPE_WALK_UPGRADE_COST, PROMISED_ROPE_WALK_COST),
    `the rope walk costs ${formatCost(PROMISED_ROPE_WALK_COST)}`,
  );
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  standBeside(rig, saw);
  const short: ResourceCost = { ...SAW_UPGRADE_COST, stone: (SAW_UPGRADE_COST.stone ?? 0) - 1 };
  give(rig, short);
  check(rig.quest.tryUpgradeStation(rig.human), 'short one stone: the press is still taken');
  check(!rig.quest.stations.isUpgrading, 'but no channel starts');
  check(
    rig.announced.includes(STATION_UPGRADE_SHORT_LINE),
    `and the party is told "${STATION_UPGRADE_SHORT_LINE}"`,
  );
  check(holds(rig, short), 'and nothing is spent');
  check(rig.quest.guidance()?.kind === 'mine', 'guidance turns to the shortfall: mine the stone');

  const levelled = buildStationsRig();
  const levelledSaw = levelled === null ? null : machineOf(levelled, 'boards');
  if (levelled === null || levelledSaw === null) return;
  // A high Construction level discounts every other build; the station's
  // price must stay the figure the player was told.
  levelled.human.craftSkills.setGodModeMinLevel(DISCOUNTED_CONSTRUCTION_LEVEL);
  standBeside(levelled, levelledSaw);
  give(levelled, SAW_UPGRADE_COST);
  levelled.quest.tryUpgradeStation(levelled.human);
  runUpgrade(levelled);
  check(
    levelled.state.blueprints.stationsUpgraded.saw && holds(levelled, {}),
    'a levelled builder still pays the full, fixed price',
  );
}

// ── The channel ──────────────────────────────────────────────────────────

/** Walking off cancels for free; finishing spends, flags, re-skins and pays XP. */
export function verifyStationChannel(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  standBeside(rig, saw);
  give(rig, SAW_UPGRADE_COST);
  rig.quest.tryUpgradeStation(rig.human);
  rig.human.x += WALK_OFF_PX;
  rig.quest.stations.update();
  check(!rig.quest.stations.isUpgrading, 'moving cancels the channel');
  check(holds(rig, SAW_UPGRADE_COST), 'and a cancelled channel spends nothing');

  standBeside(rig, saw);
  const before = constructionProgress(rig.human);
  rig.quest.tryUpgradeStation(rig.human);
  for (let frame = 0; frame < UPGRADE_FRAMES - FRAME_SLACK * 2 - 1; frame++) {
    rig.quest.stations.update();
  }
  check(
    rig.quest.stations.isUpgrading && !rig.state.blueprints.stationsUpgraded.saw,
    `the channel is still running just short of ${STATION_UPGRADE_SECONDS} s`,
  );
  runUpgrade(rig);
  check(rig.state.blueprints.stationsUpgraded.saw, 'after the channel the saw stands upgraded');
  check(!rig.state.blueprints.stationsUpgraded.ropeWalk, 'and the rope walk does not');
  check(holds(rig, {}), 'the whole cost is spent');
  check(anchorFlag(rig, saw), "the saw's anchor tile carries the upgraded look");
  check(rig.callouts.length === 1, 'a callout floats off the machine');
  const after = constructionProgress(rig.human);
  check(
    after.level > before.level || after.xp - before.xp === STATION_UPGRADE_CONSTRUCTION_XP,
    'the builder earns Construction XP',
  );
  check(rig.state.blueprints.phase === 'build_stations', 'one station done: the quest runs on');
  check(
    rig.quest.stations.upgradableInReach(rig.human) === null,
    'an upgraded saw offers no second upgrade',
  );

  const reloaded = createBriarHollowState();
  reloaded.blueprints.phase = 'build_stations';
  reloaded.blueprints.stationsUpgraded.saw = true;
  const reloadRig = stationsRig(reloaded);
  const reloadSaw = reloadRig === null ? null : machineOf(reloadRig, 'boards');
  const reloadRope = reloadRig === null ? null : machineOf(reloadRig, 'rope');
  if (reloadRig === null || reloadSaw === null || reloadRope === null) return;
  check(anchorFlag(reloadRig, reloadSaw), 'a save with the saw upgraded builds the upgraded saw');
  check(!anchorFlag(reloadRig, reloadRope), 'and the plain rope walk');
  const fresh = stationsRig();
  if (fresh === null) return;
  const freshSaw = machineOf(fresh, 'boards');
  check(freshSaw !== null && !anchorFlag(fresh, freshSaw), 'a fresh village builds the plain saw');
}

// ── Processing at an upgraded machine ────────────────────────────────────

/** An upgraded machine works four wood a press, or what the party has left; a plain one works one. */
export function verifyUpgradedProcessing(check: Check): void {
  const rig = stationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  const rope = rig === null ? null : machineOf(rig, 'rope');
  if (rig === null || saw === null || rope === null) {
    check(false, 'the village stands up both machines');
    return;
  }
  const sawmill = rig.services.sawmill;
  const press = (): void => {
    sawmill.press(rig.human);
    for (let frame = 0; frame < PRESS_FRAMES; frame++) sawmill.update(false);
  };
  rig.state.blueprints.stationsUpgraded.saw = true;
  rig.human.inventory.addItem('wood', PLENTY_OF_WOOD);
  standBeside(rig, saw);
  const xpBefore = rig.human.craftSkills.getXp('construction');
  press();
  check(
    partyCount(rig.human, rig.cat, 'wood_board') === UPGRADED_WOOD_PER_PRESS * BOARDS_PER_WOOD,
    `one press at the upgraded saw makes ${UPGRADED_WOOD_PER_PRESS * BOARDS_PER_WOOD} boards`,
  );
  check(
    partyCount(rig.human, rig.cat, 'wood') === PLENTY_OF_WOOD - UPGRADED_WOOD_PER_PRESS,
    `and works ${UPGRADED_WOOD_PER_PRESS} wood`,
  );
  check(
    rig.human.craftSkills.getXp('construction') - xpBefore ===
      PROCESS_CONSTRUCTION_XP_PER_WOOD * UPGRADED_WOOD_PER_PRESS,
    'XP is paid per wood worked, not per press',
  );

  rig.human.inventory.removeItems('wood', partyCount(rig.human, rig.cat, 'wood'));
  rig.human.inventory.removeItems('wood_board', partyCount(rig.human, rig.cat, 'wood_board'));
  rig.human.inventory.addItem('wood', SHORT_WOOD);
  press();
  check(
    partyCount(rig.human, rig.cat, 'wood_board') === SHORT_WOOD * BOARDS_PER_WOOD &&
      partyCount(rig.human, rig.cat, 'wood') === 0,
    `with only ${SHORT_WOOD} wood, the press works all ${SHORT_WOOD}`,
  );

  rig.human.inventory.addItem('wood', PLENTY_OF_WOOD);
  standBeside(rig, rope);
  press();
  check(
    partyCount(rig.human, rig.cat, 'rope') === ROPE_PER_WOOD &&
      partyCount(rig.human, rig.cat, 'wood') === PLENTY_OF_WOOD - 1,
    'the plain rope walk still works one wood a press',
  );
  rig.state.blueprints.stationsUpgraded.ropeWalk = true;
  press();
  check(
    partyCount(rig.human, rig.cat, 'rope') === ROPE_PER_WOOD * (1 + UPGRADED_WOOD_PER_PRESS),
    `the upgraded rope walk makes ${UPGRADED_WOOD_PER_PRESS * ROPE_PER_WOOD} rope a press`,
  );
}

const PLAIN_ROPE_SOUND: SoundId = 'rope_tightening';

/**
 * An upgraded station sounds as its own cue (or the plain sound standing in
 * for a recording that has not landed), and a plain one as the plain sound:
 * the rope walk's press sound is checked through a recording audio sink, the
 * saw's cutting loop through the loop the service asks for, which also has to
 * end when the cut ends or is cancelled.
 */
export function verifyUpgradedStationSounds(check: Check): void {
  const rig = stationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  const rope = rig === null ? null : machineOf(rig, 'rope');
  if (rig === null || saw === null || rope === null) {
    check(false, 'the village stands up both machines');
    return;
  }
  const played: SoundId[] = [];
  const upgraded = { saw: false, rope: false };
  const sawmill = new SawmillService({
    party: { human: rig.human, cat: rig.cat, active: () => rig.human },
    site: rig.site,
    bus: null,
    audio: { play: (id) => void played.push(id) },
    sawmill: { working: false },
    announce: () => undefined,
    noteResourceActivity: () => undefined,
    fennaTilesFrom: () => null,
    fennaNoWood: () => undefined,
    unlocked: () => true,
    isUpgraded: (station) => (station.kind === 'boards' ? upgraded.saw : upgraded.rope),
    rebuilding: () => false,
  });
  const press = (): void => {
    sawmill.press(rig.human);
    for (let frame = 0; frame < PRESS_FRAMES; frame++) sawmill.update(false);
  };
  rig.human.inventory.addItem('wood', PLENTY_OF_WOOD);

  standBeside(rig, saw);
  sawmill.press(rig.human);
  check(sawmill.sawingLoop === PLAIN_SAWING_LOOP, 'a plain saw cuts to the plain sawing loop');
  sawmill.cancel();
  check(sawmill.sawingLoop === null, 'cancelling the cut ends the loop');
  upgraded.saw = true;
  sawmill.press(rig.human);
  check(
    sawmill.sawingLoop === cueSoundOr('upgradedSawLoop', PLAIN_SAWING_LOOP),
    'an upgraded saw cuts to the upgraded loop (or its stand-in)',
  );
  for (let frame = 0; frame < PRESS_FRAMES; frame++) sawmill.update(false);
  check(sawmill.sawingLoop === null, 'a finished cut ends the loop');

  standBeside(rig, rope);
  press();
  check(
    played.length === 1 && played[0] === PLAIN_ROPE_SOUND,
    'a plain rope walk press plays the plain rope sound',
  );
  played.length = 0;
  upgraded.rope = true;
  press();
  check(
    played.length === 1 && played[0] === cueSoundOr('upgradedRopeWalkLoop', PLAIN_ROPE_SOUND),
    'an upgraded rope walk press plays the upgraded cue (or its stand-in)',
  );
}

/**
 * The rebuild and a cut never share a machine: no cut starts (or is
 * offered) while a rebuild runs, and a cut works the wood its machine worked
 * when it started, so an upgrade landing mid-cut cannot pay out early.
 */
export function verifyRebuildAndCutsApart(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  const sawmill = rig.services.sawmill;
  rig.human.inventory.addItem('wood', PLENTY_OF_WOOD);
  standBeside(rig, saw);
  give(rig, SAW_UPGRADE_COST);
  rig.quest.tryUpgradeStation(rig.human);
  setInteractionPromptsSuppressed(false);
  const promptCtx = surfaceContext(allocCanvas(PROMPT_CANVAS_PX, PROMPT_CANVAS_PX));
  const claimed = rig.services.renderPrompt(promptCtx, 0, 0, rig.human);
  check(
    claimed && interactionPromptsDrawnThisFrame() === 0,
    'no cut is offered while the rebuild runs, and no prompt further down the chain is either',
  );
  const outcome = sawmill.press(rig.human);
  check(
    rig.quest.stations.isUpgrading && outcome === 'busy' && !sawmill.isWorking,
    `a press at the saw while it is being rebuilt starts no cut (${outcome ?? 'not taken'})`,
  );
  runUpgrade(rig);
  check(sawmill.press(rig.human) === 'started', 'once the rebuild is done the saw cuts again');
  sawmill.cancel();

  const plain = stationsRig();
  const plainSaw = plain === null ? null : machineOf(plain, 'boards');
  if (plain === null || plainSaw === null) return;
  plain.human.inventory.addItem('wood', PLENTY_OF_WOOD);
  standBeside(plain, plainSaw);
  plain.services.sawmill.press(plain.human);
  plain.state.blueprints.stationsUpgraded.saw = true;
  for (let frame = 0; frame < PRESS_FRAMES; frame++) plain.services.sawmill.update(false);
  const worked = PLENTY_OF_WOOD - partyCount(plain.human, plain.cat, 'wood');
  check(
    worked === 1,
    `a cut begun on the plain saw works one wood even if the saw is upgraded before it ends (worked ${worked})`,
  );
}

// ── Marking ──────────────────────────────────────────────────────────────

interface DrawnText {
  readonly text: string;
  readonly color: string;
  readonly y: number;
}

/** What one over-body pass drew: every word with its colour and height, and the colour of every filled shape. */
interface RecordedFrame {
  readonly texts: readonly DrawnText[];
  readonly fills: readonly string[];
}

function recordFrame(draw: (ctx: CanvasRenderingContext2D) => void): RecordedFrame {
  setViewportSize(CAPTION_SCREEN_PX, CAPTION_SCREEN_PX);
  setInteractionPromptsSuppressed(false);
  const ctx = surfaceContext(allocCanvas(CAPTION_SCREEN_PX, CAPTION_SCREEN_PX));
  const texts: DrawnText[] = [];
  const fills: string[] = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (...args: Parameters<CanvasRenderingContext2D['fillText']>) => {
    texts.push({ text: args[0], color: String(ctx.fillStyle), y: args[2] });
    fillText(...args);
  };
  const fill = ctx.fill.bind(ctx);
  ctx.fill = (pathOrRule?: Path2D | CanvasFillRule, fillRule?: CanvasFillRule) => {
    fills.push(String(ctx.fillStyle));
    if (typeof pathOrRule === 'object') fill(pathOrRule, fillRule);
    else fill(pathOrRule);
  };
  draw(ctx);
  return { texts, fills };
}

/** Every word the stations' over-body pass drew, with the colour it was drawn in. */
function captionFrame(rig: StationsRig, camX: number, camY: number): readonly DrawnText[] {
  return recordFrame((ctx) => rig.quest.stations.renderAbove(ctx, camX, camY)).texts;
}

/** Whether `drawn` holds `text`, drawn in `color`. */
function drewIn(
  drawn: ReadonlyArray<{ readonly text: string; readonly color: string }>,
  text: string,
  color: string,
): boolean {
  return drawn.some((entry) => entry.text === text && entry.color.toLowerCase() === color);
}

/**
 * Both stations stay marked through `build_stations` until each is upgraded —
 * even while guidance has sent the party off for a shortfall — with a caption
 * that shows from across the screen, and each material line flips from the
 * "short" colour to the "met" one the moment the party holds enough.
 */
export function verifyStationsStayMarked(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  const guidance = rig.quest.guidance();
  check(
    guidance?.kind !== 'station_upgrade' &&
      rig.quest.marksStation('boards') &&
      rig.quest.marksStation('rope'),
    `short of everything, guidance goes after the shortfall (${guidance?.kind ?? 'none'}) and both stations stay marked`,
  );

  rig.human.x = (saw.footprint.x - OUT_OF_REACH_TILES) * TILE_SIZE;
  rig.human.y = (saw.footprint.y + saw.footprint.h + OUT_OF_REACH_TILES) * TILE_SIZE;
  const camX = saw.footprint.x * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const camY = saw.footprint.y * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const short = captionFrame(rig, camX, camY);
  const shortBoards = `Boards 0/${SAW_UPGRADE_COST.wood_board ?? 0}`;
  check(
    short.some((entry) => entry.text === 'Upgrade saw'),
    `out of reach, the saw's caption still shows (${short.map((entry) => entry.text).join(' | ')})`,
  );
  check(
    drewIn(short, shortBoards, TEXT_PRESETS.requirementShort.color),
    `a short material is drawn in the "short" colour (${shortBoards})`,
  );

  give(rig, SAW_UPGRADE_COST);
  const met = captionFrame(rig, camX, camY);
  const metBoards = `Boards ${SAW_UPGRADE_COST.wood_board ?? 0}/${SAW_UPGRADE_COST.wood_board ?? 0} ✓`;
  check(
    drewIn(met, metBoards, TEXT_PRESETS.requirementMet.color),
    `once held, the same line flips to the "met" colour with a tick (${metBoards})`,
  );
  check(
    drewIn(met, 'Upgrade saw', TEXT_PRESETS.ready.color),
    'with every line met, the title turns to the "ready" gold',
  );

  standBeside(rig, saw);
  runUpgradeFrom(rig);
  check(
    !rig.quest.marksStation('boards') && rig.quest.marksStation('rope'),
    'an upgraded saw is no longer marked; the rope walk still is',
  );
}

/**
 * The marks stand down with the quest: through the siege no machine is
 * marked (so the village guide's own marks come back), and while a crawler
 * is down the frames and captions go, though a channel's bar stays.
 */
export function verifyStationMarksStandDown(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  if (rig === null || saw === null) {
    check(false, 'the village stands up a saw to upgrade');
    return;
  }
  const camX = saw.footprint.x * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const camY = saw.footprint.y * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const hasCaption = (texts: readonly DrawnText[]): boolean =>
    texts.some((entry) => entry.text === 'Upgrade saw');
  check(hasCaption(captionFrame(rig, camX, camY)), 'before the siege the saw carries its caption');

  rig.plea.phase = 'assault';
  const underSiege = captionFrame(rig, camX, camY);
  check(
    !rig.quest.marksStation('boards') &&
      !rig.quest.marksStation('rope') &&
      !hasCaption(underSiege) &&
      rig.quest.stationCaptionTopWorldY('boards') === null,
    `through the siege neither machine is marked or captioned (${underSiege.map((entry) => entry.text).join(' | ') || 'nothing drawn'})`,
  );
  rig.plea.phase = 'fortifying';

  rig.cat.isKnockedOut = true;
  const catDown = recordFrame((ctx) => rig.quest.stations.renderAbove(ctx, camX, camY));
  check(
    !hasCaption(catDown.texts) && catDown.fills.length === 0,
    `with the cat down the saw has no frame and no caption (${catDown.fills.length} fills)`,
  );
  check(
    rig.quest.marksStation('boards'),
    'a downed crawler does not un-mark the machine, so the guide adds no highlight of its own',
  );

  give(rig, SAW_UPGRADE_COST);
  standBeside(rig, saw);
  rig.quest.tryUpgradeStation(rig.human);
  rig.quest.stations.update();
  const channelling = recordFrame((ctx) => rig.quest.stations.renderAbove(ctx, camX, camY));
  const withoutSpaces = (color: string): string => color.replace(/\s/g, '');
  const barColor = withoutSpaces(PROGRESS_PRESETS.build.background);
  check(
    rig.quest.stations.isUpgrading &&
      channelling.fills.some((color) => withoutSpaces(color) === barColor),
    `with the cat down, Carl's upgrade still shows its progress bar (${channelling.fills.join() || 'nothing filled'})`,
  );
  rig.cat.isKnockedOut = false;
}

/** A guide over `rig`'s village, wired the way `BriarHollowKit` wires it, with the Plea's guidance in `plea`. */
function guideOver(
  rig: StationsRig,
  plea: { guidance: QuestGuidance | null },
): VillageQuestGuide | null {
  const site = rig.map.briarHollow;
  if (site === null) return null;
  const crawlerOf = (kind: CrawlerKind) => (kind === 'human' ? rig.human : rig.cat);
  const defense = new DefenseStructures({
    gameMap: rig.map,
    site,
    state: rig.state,
    bus: rig.bus,
    audio: null,
    roster: new MobRoster(rig.map, new SpellSystem()),
    constructionLevel: (kind) => crawlerOf(kind).craftSkills.getLevel('construction'),
    crawler: crawlerOf,
    onTileChanged: () => undefined,
    clockSeconds: () => 0,
    random: () => 0,
  });
  return new VillageQuestGuide({
    gameMap: rig.map,
    site,
    state: rig.state,
    defense,
    human: rig.human,
    cat: rig.cat,
    onTileChanged: () => undefined,
    guidance: () => plea.guidance ?? rig.quest.guidance(),
    isDefaultTrebuchetPromptShowing: () => false,
    isDefaultWallPromptShowing: () => false,
    questMarksStation: (kind) => rig.quest.marksStation(kind),
    questStationCaptionTopWorldY: (kind) => rig.quest.stationCaptionTopWorldY(kind),
    showingSideQuestGuidance: () => plea.guidance === null,
  });
}

/**
 * The Plea can send the party to the saw for boards while this quest marks
 * the saw for its upgrade. The guide leaves the highlight to this quest but
 * keeps the Plea's instruction and count on screen, stacked clear above the
 * upgrade caption; a shortfall of this quest's own is already that caption's
 * checklist and gets nothing more.
 */
export function verifyPleaProcessOverMarkedStation(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  const plea: { guidance: QuestGuidance | null } = {
    guidance: {
      kind: 'process',
      stations: [{ station: 'saw', progress: { have: 0, target: PLEA_BOARDS_TARGET } }],
    },
  };
  const guide = rig === null ? null : guideOver(rig, plea);
  if (rig === null || saw === null || guide === null) {
    check(false, 'the village stands up a saw and a guide');
    return;
  }
  rig.human.x = (saw.footprint.x - OUT_OF_REACH_TILES) * TILE_SIZE;
  rig.human.y = (saw.footprint.y + saw.footprint.h + OUT_OF_REACH_TILES) * TILE_SIZE;
  const camX = saw.footprint.x * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const camY = saw.footprint.y * TILE_SIZE - CAPTION_CAMERA_INSET_PX;
  const drawBoth = (ctx: CanvasRenderingContext2D): void => {
    rig.quest.stations.renderAbove(ctx, camX, camY);
    guide.renderAbove(ctx, camX, camY);
  };

  guide.update();
  const pleaFrame = recordFrame(drawBoth).texts;
  const drawnTexts = pleaFrame.map((entry) => entry.text).join(' | ');
  const pleaTitle = pleaFrame.find((entry) => entry.text === 'Process wood at the saw');
  const pleaCount = pleaFrame.find((entry) =>
    entry.text.startsWith(`Boards 0/${PLEA_BOARDS_TARGET}`),
  );
  check(
    rig.quest.marksStation('boards') &&
      pleaTitle !== undefined &&
      pleaCount !== undefined &&
      pleaFrame.some((entry) => entry.text === 'Upgrade saw'),
    `the Plea's "process" caption and count show at the saw beside the upgrade caption (${drawnTexts})`,
  );
  const upgradeTop = rig.quest.stationCaptionTopWorldY('boards');
  const upgradeTopScreen = upgradeTop === null ? null : upgradeTop - camY;
  const pleaBottom = Math.max(pleaTitle?.y ?? Infinity, pleaCount?.y ?? Infinity);
  check(
    upgradeTopScreen !== null && pleaBottom + CAPTION_LINE_PX <= upgradeTopScreen,
    `the Plea's caption stacks clear above the upgrade caption (its last line at ${pleaBottom}, the panel's top at ${upgradeTopScreen ?? 'none'})`,
  );

  plea.guidance = null;
  give(rig, { stone: SAW_UPGRADE_COST.stone ?? 0, rope: SAW_UPGRADE_COST.rope ?? 0 });
  rig.human.inventory.addItem('wood', 1);
  guide.update();
  const ownGuidance = rig.quest.guidance();
  const ownFrame = recordFrame(drawBoth).texts;
  check(
    ownGuidance?.kind === 'process' &&
      !ownFrame.some((entry) => entry.text === 'Process wood at the saw'),
    `this quest's own boards shortfall (${ownGuidance?.kind ?? 'none'}) adds no second caption at the saw`,
  );
}

function runUpgradeFrom(rig: StationsRig): void {
  rig.quest.tryUpgradeStation(rig.human);
  runUpgrade(rig);
}

// ── Completion ───────────────────────────────────────────────────────────

/** The second station done: Fenna's shout, the blueprints retired, the quest complete. */
export function verifyStationsComplete(check: Check): void {
  const rig = buildStationsRig();
  const saw = rig === null ? null : machineOf(rig, 'boards');
  const rope = rig === null ? null : machineOf(rig, 'rope');
  if (rig === null || saw === null || rope === null) {
    check(false, 'the village stands up both machines');
    return;
  }
  for (const [machine, station] of [
    [saw, 'saw'],
    [rope, 'ropeWalk'],
  ] as const) {
    give(rig, stationUpgradeCost(station));
    standBeside(rig, machine);
    rig.quest.tryUpgradeStation(rig.human);
    runUpgrade(rig);
  }
  const upgraded = rig.state.blueprints.stationsUpgraded;
  check(upgraded.saw && upgraded.ropeWalk, 'both stations stand upgraded');
  check(anchorFlag(rig, rope), "the rope walk's anchor tile carries the upgraded look");
  check(rig.state.blueprints.phase === 'complete', 'the quest is complete');
  check(rig.completed.includes(BLUEPRINTS_QUEST_ID), 'questCompleted fires for the quest');
  check(
    rig.human.inventory.countOf('quest_blueprints') === 0 &&
      rig.cat.inventory.countOf('quest_blueprints') === 0,
    'the blueprints are cleared from the quest slot',
  );
  check(
    rig.villagers.villagerFor('fenna')?.bark.current === FENNA.blueprintsComplete.paragraphs[0],
    'Fenna shouts her line',
  );
  check(rig.completed.length === 1, 'the quest completes once');
}

/** Every station-upgrade section, for the runner's `SECTIONS`. */
export function stationSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    { name: 'Station upgrades: X precedence', run: () => verifyStationXPrecedence(check) },
    { name: 'Station upgrades: costs and refusal', run: () => verifyStationCosts(check) },
    { name: 'Station upgrades: the channel', run: () => verifyStationChannel(check) },
    { name: 'Station upgrades: four wood a press', run: () => verifyUpgradedProcessing(check) },
    {
      name: 'Station upgrades: a rebuild and a cut never share a machine',
      run: () => verifyRebuildAndCutsApart(check),
    },
    { name: 'Station upgrades: sounds', run: () => verifyUpgradedStationSounds(check) },
    { name: 'Station upgrades: marked until upgraded', run: () => verifyStationsStayMarked(check) },
    {
      name: 'Station upgrades: marks stand down through the siege and a downed crawler',
      run: () => verifyStationMarksStandDown(check),
    },
    {
      name: "Station upgrades: the Plea's process guidance over a marked station",
      run: () => verifyPleaProcessOverMarkedStation(check),
    },
    { name: 'Station upgrades: completion', run: () => verifyStationsComplete(check) },
  ];
}
