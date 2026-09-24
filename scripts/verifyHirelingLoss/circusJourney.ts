/**
 * A hire taken through "The Show Must Go On" from the town gate to a defeat in
 * the Big Top's maze, on the real third-floor map, with the real hireling, mob
 * loop, kill resolution and circus quest running every frame.
 *
 * After each step — the walk out to the grounds, the ritual defense, the
 * sideshow assault, the walk into the Big Top, the maze, the walk out, and a
 * defeat in the maze that respawns the party from its last save — the roster
 * still names the hire, the hire stands in the roster of the place the party is
 * in, and it is within catch-up reach of the crawler it follows.
 *
 * The scenes need a DOM, so what they do at a door is done here in the order
 * they do it: the hire is dismissed for the transition, and the place arrived
 * in stands up its own hireling system from the one roster. A stage Signet's
 * conversation would advance is advanced the way any scene rebuild does it —
 * from the cross-scene progress object.
 *
 * Two runs must lose the hire, or the checks cannot see a loss: one with the
 * catch-up held off (a hostile beside the crawler keeps the hire marked as
 * engaged, which the catch-up refuses to pull a hire out of), and one where the Big Top hosts no
 * hireling system at all.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { AbilityManager } from '../../src/core/AbilityManager';
import { setViewportSize } from '../../src/core/Viewport';
import { withWorldSeed } from '../../src/core/WorldRandom';
import {
  BIG_TOP_BUILDING_NAME,
  createCircusQuestProgress,
  type CircusQuestProgress,
} from '../../src/core/CircusQuestProgress';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type MercenaryRoster,
} from '../../src/core/MercenaryRoster';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { parseMercenaryRosterCheckpoint } from '../../src/core/PersistedWorldState';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import type { Mercenary } from '../../src/creatures/Mercenary';
import { HIRELING_CATCH_UP_TILES } from '../../src/creatures/mercenaries/hirelingCatchUp';
import { despawnMob, type Mob } from '../../src/creatures/Mob';
import { Signet } from '../../src/creatures/Signet';
import { createMob } from '../../src/levels/spawner';
import { level3 } from '../../src/levels/level3';
import { MAZE_CAT_SPAWN_TILE, MAZE_HUMAN_SPAWN_TILE } from '../../src/map/bigTopMazeLayout';
import { GameMap } from '../../src/map/GameMap';
import type { Player } from '../../src/Player';
import { CircusQuestSystem } from '../../src/systems/CircusQuestSystem';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';

/** How a gate reports; the caller owns the failure count. */
export interface JourneyGateReporter {
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const HIRE_ID = 'sledge';
/** A desktop window, so "on screen" means what it means in play. */
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
/** Frames the party stands on the grounds after arriving: time for a hire that can walk to walk. */
const ARRIVAL_SETTLE_FRAMES = 60;
/** Frames a wave's creatures are left to fight before they are cut down. */
const WAVE_FIGHT_FRAMES = 90;
/** Frames allowed for either wave fight before the gate calls it stuck. */
const WAVE_FIGHT_BUDGET_FRAMES = 6000;
/** Frames spent inside a place before it is judged. */
const INDOOR_SETTLE_FRAMES = 60;
/** Far beyond any creature's health: a wave is cleared in one blow each. */
const OVERKILL_DAMAGE = 1_000_000;
/**
 * Rows south of a door that a building exit sets the party down on — the
 * `returnTile` the scene's building callback builds from `doorTile`.
 */
const RETURN_TILE_ROWS_SOUTH_OF_DOOR = 1;
/** Tiles above its centre the party walks onto the circus grounds at. */
const GROUNDS_ARRIVAL_INSET_TILES = 3;

type JourneyStep =
  | 'setting out'
  | 'walk to the circus'
  | 'ritual defense'
  | 'sideshow assault'
  | 'walk to the Big Top'
  | 'inside the maze'
  | 'out of the maze'
  | 'back in the maze'
  | 'defeated in the maze';

interface StepReading {
  readonly step: JourneyStep;
  readonly problem: string | null;
}

interface JourneyOptions {
  /** A hostile keeps the hire marked as engaged, which the catch-up never overrides. */
  readonly holdCatchUpOff: boolean;
  /** The Big Top hosts no hireling system: whoever walks in, walks in alone. */
  readonly bigTopHostsNoHire: boolean;
}

/** One place the party can stand: a map, its creatures, and its hireling system. */
interface Place {
  readonly map: GameMap;
  readonly mobs: MobRoster;
  readonly spells: SpellSystem;
  readonly hireling: MercenarySystem | null;
  readonly mobLoop: MobUpdateLoop;
  readonly combat: CombatContext;
  readonly extras: Player[];
  readonly ctx: SystemContext;
}

interface Party {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

function makePlace(
  map: GameMap,
  party: Party,
  roster: MercenaryRoster,
  levelId: string | null,
  hostsHire: boolean,
): Place {
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const extras: Player[] = [];
  const ctx: SystemContext = {
    human: party.human,
    cat: party.cat,
    active: party.human,
    inactive: party.cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
    extraTargets: extras,
  };
  const combat: CombatContext = {
    human: party.human,
    cat: party.cat,
    mobs: mobs.mobs,
    mobGrid: mobs.grid,
    gameMap: map,
    safeRoom: null,
    bus: new EventBus(),
    abilityManager: new AbilityManager(),
    spells,
    hitLanded: false,
  };
  party.cat.setMap(map);
  const hireling = hostsHire ? new MercenarySystem(roster, levelId) : null;
  return { map, mobs, spells, hireling, mobLoop: new MobUpdateLoop(), combat, extras, ctx };
}

function placeParty(party: Party, tile: { readonly x: number; readonly y: number }): void {
  party.human.x = tile.x * TILE_SIZE;
  party.human.y = tile.y * TILE_SIZE;
  party.cat.x = (tile.x + 1) * TILE_SIZE;
  party.cat.y = tile.y * TILE_SIZE;
}

/**
 * The gate is about losing track of a hire, not about anyone losing a fight:
 * the party and the hire are topped up before the frame's health checks, so a
 * wave can never put either down.
 */
function topUp(party: Party, hire: Mercenary | null): void {
  party.human.hp = party.human.maxHp;
  party.cat.hp = party.cat.maxHp;
  if (hire !== null) hire.hp = hire.maxHp;
}

/**
 * A hostile that keeps the hire marked as its target while standing beside the
 * active crawler — inside the mob loop's activation radius, so it counts as a
 * live fight, which the catch-up never pulls a hire out of. Held still, so it
 * never lands a blow or wanders off.
 */
interface Decoy {
  readonly mob: Mob;
}

/** Columns east of the active crawler the decoy is kept at. */
const DECOY_OFFSET_TILES = 2;

function keepDecoyBeside(decoy: Decoy, place: Place, party: Party, hire: Mercenary): void {
  const mob = decoy.mob;
  const preMoveX = mob.x;
  const preMoveY = mob.y;
  mob.x = party.human.x + DECOY_OFFSET_TILES * TILE_SIZE;
  mob.y = party.human.y;
  place.mobs.grid.move(mob, preMoveX, preMoveY);
  mob.currentTarget = hire;
  mob.retaliateMob = hire;
}

/** One frame of a place, in the scene's order. */
function step(place: Place, party: Party, quest: CircusQuestSystem | null, decoy: Decoy | null) {
  const hireling = place.hireling;
  place.extras.length = 0;
  const standing = hireling?.activeMerc ?? null;
  if (standing !== null) place.extras.push(standing);
  if (decoy !== null && standing !== null) keepDecoyBeside(decoy, place, party, standing);

  place.mobLoop.update(place.ctx);
  topUp(party, standing);
  hireling?.checkHealth();
  resolveKills(place.combat);
  hireling?.update(place.ctx);
  quest?.update(place.ctx);
  party.human.tickTimers();
  party.cat.tickTimers();
}

function run(
  place: Place,
  party: Party,
  frames: number,
  quest: CircusQuestSystem | null,
  decoy: Decoy | null,
): void {
  for (let frame = 0; frame < frames; frame++) step(place, party, quest, decoy);
}

function hireIn(place: Place): Mercenary | null {
  return place.hireling?.activeMerc ?? place.hireling?.downedMerc ?? null;
}

function readStep(
  stepName: JourneyStep,
  place: Place,
  party: Party,
  roster: MercenaryRoster,
): StepReading {
  const fail = (problem: string): StepReading => ({ step: stepName, problem });
  if (roster.active === null) return fail('the roster no longer names the hire');
  const hire = hireIn(place);
  if (hire === null) return fail('no hire is standing here');
  if (!place.mobs.mobs.includes(hire) || !place.mobs.grid.has(hire)) {
    return fail('the hire is not in the roster of the place the party is in');
  }
  const distanceTiles = Math.hypot(hire.x - party.human.x, hire.y - party.human.y) / TILE_SIZE;
  if (distanceTiles > HIRELING_CATCH_UP_TILES) {
    return fail(`the hire is ${distanceTiles.toFixed(1)} tiles from the crawler`);
  }
  return { step: stepName, problem: null };
}

/** Cuts down every creature fighting the party, leaving Signet and the decoy. */
function cutDownHostiles(place: Place, party: Party, decoy: Decoy | null): void {
  for (const mob of place.mobs.mobs) {
    if (!mob.isAlive || !mob.isHostile) continue;
    if (mob instanceof Signet || mob === decoy?.mob) continue;
    mob.takeDamageFrom(OVERKILL_DAMAGE, party.human);
  }
}

/** Plays a wave fight out: each wave fights for a while, then falls, until the quest moves on. */
function fightWaves(
  place: Place,
  party: Party,
  quest: CircusQuestSystem,
  decoy: Decoy | null,
): boolean {
  for (let frame = 0; frame < WAVE_FIGHT_BUDGET_FRAMES; frame++) {
    if (!quest.isWaveFightInProgress) return true;
    if (frame % WAVE_FIGHT_FRAMES === WAVE_FIGHT_FRAMES - 1) cutDownHostiles(place, party, decoy);
    step(place, party, quest, decoy);
  }
  return !quest.isWaveFightInProgress;
}

/**
 * The quest at a new stage, as Signet's conversation or a scene rebuild leaves
 * it. The Signet the previous build stood up goes with it, or the grounds would
 * hold two of her.
 */
function rebuildQuest(
  place: Place,
  progress: CircusQuestProgress,
  party: Party,
): CircusQuestSystem {
  for (const mob of [...place.mobs.mobs]) {
    if (mob instanceof Signet) despawnMob(mob, place.mobs.mobs, place.mobs.grid);
  }
  return new CircusQuestSystem(
    place.map,
    new EventBus(),
    (mob) => place.mobs.add(mob),
    null,
    progress,
    null,
    null,
    party.human,
  );
}

function makeDecoy(place: Place, tile: { x: number; y: number }): Decoy {
  const mob = createMob('goblin', tile.x, tile.y, place.map);
  mob.aiHeld = true;
  place.mobs.add(mob);
  return { mob };
}

function bigTopMaze(): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('house', 0, BIG_TOP_BUILDING_NAME, false, 'bigtop_maze');
  return map;
}

function enterMaze(party: Party, roster: MercenaryRoster, options: JourneyOptions): Place {
  const maze = bigTopMaze();
  // An interior passes no floor: the building must not re-stamp the floor its
  // contract is judged against.
  const place = makePlace(maze, party, roster, null, !options.bigTopHostsNoHire);
  party.human.x = MAZE_HUMAN_SPAWN_TILE.x * TILE_SIZE;
  party.human.y = MAZE_HUMAN_SPAWN_TILE.y * TILE_SIZE;
  party.cat.x = MAZE_CAT_SPAWN_TILE.x * TILE_SIZE;
  party.cat.y = MAZE_CAT_SPAWN_TILE.y * TILE_SIZE;
  return place;
}

function leave(place: Place): void {
  place.hireling?.dismissForTransition(place.mobs.mobs, place.mobs.grid);
}

function journey(worldSeed: number, options: JourneyOptions): StepReading[] {
  const readings: StepReading[] = [];
  const overworld = withWorldSeed(
    worldSeed,
    () => new GameMap({ mapSize: level3.mapSize, tileHeight: TILE_SIZE, mapType: 'overworld' }),
  );
  const centre = overworld.circusCentre;
  const bigTop = overworld.buildingEntries.find((entry) => entry.name === BIG_TOP_BUILDING_NAME);
  const town = overworld.townSquareCentre ?? overworld.startTile;
  if (centre === undefined || bigTop === undefined) {
    return [{ step: 'setting out', problem: 'the overworld has no circus or no Big Top' }];
  }

  const human = new HumanPlayer(town.x, town.y, TILE_SIZE);
  const cat = new CatPlayer(town.x + 1, town.y, TILE_SIZE);
  human.isActive = true;
  const party: Party = { human, cat };
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRE_ID,
    name: getMercenaryTemplate(HIRE_ID).name,
    contractLevelId: level3.id,
    introduced: true,
  };

  let place = makePlace(overworld, party, roster, level3.id, true);
  run(place, party, 1, null, null);
  readings.push(readStep('setting out', place, party, roster));
  // Walking through the town gate is the last save before the circus.
  const lastSave: unknown = JSON.parse(JSON.stringify(captureMercenaryRoster(roster)));
  const decoy = options.holdCatchUpOff ? makeDecoy(place, town) : null;

  const progress = createCircusQuestProgress();
  progress.stage = 'ritual_defense';
  placeParty(party, { x: centre.x, y: centre.y + GROUNDS_ARRIVAL_INSET_TILES });
  let quest = rebuildQuest(place, progress, party);
  run(place, party, ARRIVAL_SETTLE_FRAMES, quest, decoy);
  readings.push(readStep('walk to the circus', place, party, roster));

  const ritualDone = fightWaves(place, party, quest, decoy);
  readings.push(
    ritualDone
      ? readStep('ritual defense', place, party, roster)
      : { step: 'ritual defense', problem: 'the ritual waves never ended' },
  );

  progress.stage = 'assault';
  quest = rebuildQuest(place, progress, party);
  const assaultDone = fightWaves(place, party, quest, decoy);
  readings.push(
    assaultDone
      ? readStep('sideshow assault', place, party, roster)
      : { step: 'sideshow assault', problem: 'the assault waves never ended' },
  );

  const bigTopDoorstep = {
    x: bigTop.doorTile.x,
    y: bigTop.doorTile.y + RETURN_TILE_ROWS_SOUTH_OF_DOOR,
  };
  placeParty(party, bigTopDoorstep);
  run(place, party, ARRIVAL_SETTLE_FRAMES, quest, decoy);
  readings.push(readStep('walk to the Big Top', place, party, roster));

  leave(place);
  place = enterMaze(party, roster, options);
  run(place, party, INDOOR_SETTLE_FRAMES, null, null);
  readings.push(readStep('inside the maze', place, party, roster));

  leave(place);
  place = makePlace(overworld, party, roster, level3.id, true);
  placeParty(party, bigTopDoorstep);
  run(place, party, INDOOR_SETTLE_FRAMES, null, null);
  readings.push(readStep('out of the maze', place, party, roster));

  leave(place);
  place = enterMaze(party, roster, options);
  run(place, party, INDOOR_SETTLE_FRAMES, null, null);
  readings.push(readStep('back in the maze', place, party, roster));

  // A defeat is a death: the scene it rebuilds reads the roster back from the
  // last save rather than carrying the live one.
  const parsed = parseMercenaryRosterCheckpoint(lastSave);
  const respawned = createMercenaryRoster();
  respawned.floorLevelId = level3.id;
  if (parsed !== undefined) restoreMercenaryRoster(respawned, parsed);
  place = makePlace(overworld, party, respawned, level3.id, true);
  placeParty(party, town);
  run(place, party, INDOOR_SETTLE_FRAMES, null, null);
  readings.push(readStep('defeated in the maze', place, party, respawned));
  return readings;
}

function firstLoss(readings: readonly StepReading[]): StepReading | null {
  return readings.find((reading) => reading.problem !== null) ?? null;
}

export function checkCircusJourney(report: JourneyGateReporter, seeds: readonly number[]): void {
  setViewportSize(VIEWPORT_W, VIEWPORT_H);
  for (const seed of seeds) {
    const label = `seed ${seed}`;
    for (const reading of journey(seed, { holdCatchUpOff: false, bigTopHostsNoHire: false })) {
      report.check(
        reading.problem === null,
        `${label}, ${reading.step}: ${reading.problem ?? 'the hire is with the party'}`,
      );
    }

    const withoutCatchUp = firstLoss(
      journey(seed, { holdCatchUpOff: true, bigTopHostsNoHire: false }),
    );
    report.checkCatches(
      withoutCatchUp === null,
      `${label}: with the catch-up held off, the hire still kept up on every step`,
    );
    const withoutCarry = firstLoss(
      journey(seed, { holdCatchUpOff: false, bigTopHostsNoHire: true }),
    );
    report.checkCatches(
      withoutCarry?.step !== 'inside the maze',
      `${label}: with no hire hosted in the Big Top, the maze step did not notice (${withoutCarry?.step ?? 'no step'} failed)`,
    );
  }
}
