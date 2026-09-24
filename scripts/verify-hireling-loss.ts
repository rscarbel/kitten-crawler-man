/**
 * The ways a hireling (and Mongo) could be lost to a scripted moment rather than
 * to a fight, each checked against the real systems on the real third floor.
 *
 * - The circus assault pens the crawlers inside the ring. A standing hireling
 *   and a summoned Mongo left outside are stood beside the active crawler on
 *   the grounds and re-indexed in the mob grid, so attacks find them there. A
 *   downed hireling is never moved: its revive belongs to the spot it fell.
 * - A hire is signed inside the Desperado Club, which cannot save. Leaving the
 *   club lands inside the town wall, whose entry is a save, and that save
 *   carries the new hire through capture, the save format, and the restore a
 *   death respawn runs.
 * - Nothing on the third floor seals a room: no boss room, no swine arena, no
 *   spider lab. Hirelings exist only on the third floor, so none of the systems
 *   that lock a door behind the party can shut one outside.
 * - A hire taken through the whole circus questline, from the town to a defeat
 *   in the Big Top's maze, is still with the party after every step
 *   (`verifyHirelingLoss/circusJourney.ts`).
 * - A hire's permanent death is announced once, whichever way it died
 *   (`verifyHirelingLoss/deathNotice.ts`).
 *
 * Every rule is paired with a run where it must go the other way, so a check
 * that cannot see its effect fails rather than passes.
 *
 *   npx tsx scripts/verify-hireling-loss.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { withWorldSeed } from '../src/core/WorldRandom';
import { createCircusQuestProgress } from '../src/core/CircusQuestProgress';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
} from '../src/core/MercenaryRoster';
import { getMercenaryTemplate, MERCENARY_TEMPLATE_IDS } from '../src/core/mercenaryTemplates';
import { parseMercenaryRosterCheckpoint } from '../src/core/PersistedWorldState';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { Mercenary } from '../src/creatures/Mercenary';
import type { Mob } from '../src/creatures/Mob';
import { Mongo } from '../src/creatures/Mongo';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level2 } from '../src/levels/level2';
import { level3 } from '../src/levels/level3';
import type { LevelDef } from '../src/levels/types';
import { GameMap } from '../src/map/GameMap';
import { BIG_TOP_ENTRY_NAME } from '../src/map/OverworldGenerator';
import { CircusQuestSystem } from '../src/systems/CircusQuestSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import type { Player } from '../src/Player';
import { mulberry32 } from '../src/sprites/person/rng';
import { checkCircusJourney } from './verifyHirelingLoss/circusJourney';
import { checkDeathNotice } from './verifyHirelingLoss/deathNotice';
import { checkCatchUpAttention } from './verifyHirelingLoss/catchUpAttention';

/** Overworlds built per rule: enough layouts that one lucky circus placement cannot pass the gate. */
const SEED_COUNT = 5;
/** Root of the seed sequence, fixed so a red run replays. */
const SEED_ROOT = 0x5eed_1055;
/** Scales a unit roll to a full 32-bit world seed. */
const UINT32_RANGE = 0x1_0000_0000;

const seedRoll = mulberry32(SEED_ROOT);
const SEEDS: ReadonlyArray<number> = Array.from({ length: SEED_COUNT }, () =>
  Math.floor(seedRoll() * UINT32_RANGE),
);

/** Mongo's level; the circus rule does not read it, only his constructor does. */
const MONGO_LEVEL = 1;
/**
 * How far from the crawler a gathered companion may land: the landing search
 * radius plus one tile, because the search runs from the crawler's tile and the
 * distance here is measured between pixel origins.
 */
const GATHER_LANDING_REACH_TILES = 5;
/** Radius of the grid probe around a companion's position. */
const GRID_PROBE_RADIUS_PX = TILE_SIZE;
/**
 * Rows south of a door that a building exit sets the party down on — the
 * `returnTile` the scene's building callback builds from `doorTile`.
 */
const RETURN_TILE_ROWS_SOUTH_OF_DOOR = 1;
/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;
const CLUB_ENTRY_TYPE = 'club';

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.error(`FAIL ${message}`);
}

/** A rule run where it must fail; passes only if it did. */
function checkCatches(ruleHolds: boolean, message: string): void {
  check(!ruleHolds, `negative control held when it should not: ${message}`);
}

function buildMap(levelDef: LevelDef, worldSeed: number): GameMap {
  return withWorldSeed(
    worldSeed,
    () =>
      new GameMap({
        mapSize: levelDef.mapSize,
        tileHeight: TILE_SIZE,
        mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
        dungeon: dungeonOptionsForLevel(levelDef),
        worldSeed,
      }),
  );
}

// ── The circus assault ───────────────────────────────────────────────────────

interface CircusStage {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly quest: CircusQuestSystem;
  readonly centre: { x: number; y: number };
  readonly radiusTiles: number;
}

function stageAssault(worldSeed: number): CircusStage | null {
  const map = buildMap(level3, worldSeed);
  const centre = map.circusCentre;
  const radiusTiles = map.circusRadiusTiles;
  if (centre === undefined || radiusTiles === undefined) return null;
  const roster = new MobRoster(map, new SpellSystem());
  const progress = createCircusQuestProgress();
  progress.stage = 'assault';
  const human = new HumanPlayer(centre.x, centre.y, TILE_SIZE);
  human.isActive = true;
  const quest = new CircusQuestSystem(
    map,
    new EventBus(),
    (mob) => roster.add(mob),
    null,
    progress,
    null,
    null,
    human,
  );
  return { map, roster, human, quest, centre, radiusTiles };
}

function contextFor(stage: CircusStage, cat: CatPlayer, extraTargets: Player[]): SystemContext {
  return {
    human: stage.human,
    cat,
    active: stage.human,
    inactive: cat,
    activeIsMoving: false,
    roster: stage.roster,
    gameMap: stage.map,
    extraTargets,
  };
}

function tilesBetween(a: Pick<Player, 'x' | 'y'>, b: Pick<Player, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function isOnGrounds(stage: CircusStage, body: Pick<Player, 'x' | 'y'>): boolean {
  const centreX = (stage.centre.x + TILE_CENTRE_FRACTION) * TILE_SIZE;
  const centreY = (stage.centre.y + TILE_CENTRE_FRACTION) * TILE_SIZE;
  const bodyX = body.x + TILE_SIZE * TILE_CENTRE_FRACTION;
  const bodyY = body.y + TILE_SIZE * TILE_CENTRE_FRACTION;
  return Math.hypot(bodyX - centreX, bodyY - centreY) <= stage.radiusTiles * TILE_SIZE;
}

function gridFinds(roster: MobRoster, mob: Mob): boolean {
  return roster.grid.queryCircle(mob.x, mob.y, GRID_PROBE_RADIUS_PX).has(mob);
}

function makeHire(owner: Player, tileX: number, tileY: number, index: number): Mercenary {
  const id = MERCENARY_TEMPLATE_IDS[index % MERCENARY_TEMPLATE_IDS.length];
  return new Mercenary(tileX, tileY, TILE_SIZE, owner, id, getMercenaryTemplate(id).name);
}

/** Runs the Mongo constructor the way `MongoSystem` does: at full health for his level. */
function makeMongo(owner: Player, tileX: number, tileY: number): Mongo {
  const probe = new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, 1);
  return new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, probe.maxHp);
}

function checkCircusGather(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const stage = stageAssault(worldSeed);
  if (stage === null) {
    check(false, `${label}: the overworld has no circus to stage an assault in`);
    return;
  }
  const cat = new CatPlayer(stage.centre.x + 1, stage.centre.y, TILE_SIZE);
  // The town square is well outside the ring: where a companion left behind on
  // the walk out would still be standing.
  const leftBehind = stage.map.townSquareCentre ?? stage.map.startTile;

  const hire = makeHire(stage.human, leftBehind.x, leftBehind.y, worldSeed);
  const mongo = makeMongo(cat, leftBehind.x + 1, leftBehind.y);
  const downed = makeHire(stage.human, leftBehind.x, leftBehind.y + 1, worldSeed + 1);
  downed.goDown();
  for (const mob of [hire, mongo, downed]) stage.roster.add(mob);

  check(
    !isOnGrounds(stage, hire) && !isOnGrounds(stage, mongo) && !isOnGrounds(stage, downed),
    `${label}: the companions did not start off the circus grounds, so nothing is tested`,
  );
  const downedAt = { x: downed.x, y: downed.y };

  stage.quest.update(contextFor(stage, cat, [mongo, hire, downed]));

  for (const [name, companion] of [
    ['the hireling', hire],
    ['Mongo', mongo],
  ] as const) {
    check(isOnGrounds(stage, companion), `${label}: ${name} was left off the circus grounds`);
    check(
      tilesBetween(companion, stage.human) <= GATHER_LANDING_REACH_TILES,
      `${label}: ${name} landed ${tilesBetween(companion, stage.human).toFixed(1)} tiles from the crawler`,
    );
    check(
      stage.map.isWalkable(
        Math.round(companion.x / TILE_SIZE),
        Math.round(companion.y / TILE_SIZE),
      ),
      `${label}: ${name} landed on a tile it cannot walk on`,
    );
    check(
      gridFinds(stage.roster, companion),
      `${label}: ${name} was moved without re-indexing the mob grid, so attacks miss it`,
    );
  }
  check(
    downed.x === downedAt.x && downed.y === downedAt.y,
    `${label}: a downed hireling was carried away from the spot it has to be revived on`,
  );

  // The same stage with nobody listed as a companion: the rule must leave a
  // stranger outside the ring, or the checks above cannot tell a gather from
  // something that moves every mob.
  const control = stageAssault(worldSeed);
  if (control === null) return;
  const stranger = makeHire(control.human, leftBehind.x, leftBehind.y, worldSeed);
  control.roster.add(stranger);
  control.quest.update(contextFor(control, cat, []));
  checkCatches(
    isOnGrounds(control, stranger),
    `${label}: a hireling nobody listed as a companion was gathered anyway`,
  );
}

/** Frames the hire spends walking home from town before it is gathered: long enough to latch the walk. */
const WALK_HOME_FRAMES = 30;
/** Frames the gathered hire is watched for walking back off the grounds. */
const STAY_ON_GROUNDS_FRAMES = 90;
/** Tiles inside the ring's edge the crawler stands at. */
const EDGE_STANDOFF_TILES = 1.5;

/**
 * A hire lifted onto the grounds mid-walk must drop the walk: left holding its
 * route and its walk-home latch toward where it was, it steers back out over
 * the edge and is gathered again, jumping on every pass.
 */
function checkGatheredHireStays(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const stage = stageAssault(worldSeed);
  if (stage === null) return;
  const cat = new CatPlayer(stage.centre.x + 1, stage.centre.y, TILE_SIZE);
  cat.setMap(stage.map);
  const leftBehind = stage.map.townSquareCentre ?? stage.map.startTile;
  // The crawler stands just inside the ring on the town side, the way a party
  // walking in from town arrives: a hire set down beside them is a step from
  // the edge, with its old walk pointing back out over it.
  const toTownX = leftBehind.x - stage.centre.x;
  const toTownY = leftBehind.y - stage.centre.y;
  const toTownTiles = Math.hypot(toTownX, toTownY);
  const edgeReach = (stage.radiusTiles - EDGE_STANDOFF_TILES) / toTownTiles;
  stage.human.x = Math.round(stage.centre.x + toTownX * edgeReach) * TILE_SIZE;
  stage.human.y = Math.round(stage.centre.y + toTownY * edgeReach) * TILE_SIZE;
  const hire = makeHire(stage.human, leftBehind.x, leftBehind.y, worldSeed);
  stage.roster.add(hire);
  const ctx = contextFor(stage, cat, [hire]);
  const mobLoop = new MobUpdateLoop();
  for (let frame = 0; frame < WALK_HOME_FRAMES; frame++) mobLoop.update(ctx);
  check(
    hire.isFollowingOwner,
    `${label}: the hire left in town is not walking home, so there is no walk to drop`,
  );

  const stallBeforeGather = hire.followStallFrames;
  stage.quest.update(ctx);
  check(
    !hire.isFollowingOwner && hire.followStallFrames === 0,
    `${label}: the gathered hire still holds its walk home (following ${hire.isFollowingOwner}, stalled ${hire.followStallFrames} frames, ${stallBeforeGather} before)`,
  );
  let framesOffGrounds = 0;
  for (let frame = 0; frame < STAY_ON_GROUNDS_FRAMES; frame++) {
    mobLoop.update(ctx);
    if (!isOnGrounds(stage, hire)) framesOffGrounds++;
    stage.quest.update(ctx);
  }
  check(
    framesOffGrounds === 0,
    `${label}: the gathered hire walked back off the grounds on ${framesOffGrounds} frames`,
  );
}

// ── A new hire survives the save that leaving the club writes ────────────────

function returnTileOf(entry: { doorTile: { x: number; y: number } }): { x: number; y: number } {
  return { x: entry.doorTile.x, y: entry.doorTile.y + RETURN_TILE_ROWS_SOUTH_OF_DOOR };
}

function isInsideWallAtTile(map: GameMap, tile: { x: number; y: number }): boolean {
  return map.isInsideTownWall(
    (tile.x + TILE_CENTRE_FRACTION) * TILE_SIZE,
    (tile.y + TILE_CENTRE_FRACTION) * TILE_SIZE,
  );
}

function checkClubExitSaves(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const map = buildMap(level3, worldSeed);
  const clubs = map.buildingEntries.filter((entry) => entry.type === CLUB_ENTRY_TYPE);
  check(clubs.length === 1, `${label}: ${clubs.length} Desperado Clubs, expected one`);
  for (const club of clubs) {
    check(
      isInsideWallAtTile(map, returnTileOf(club)),
      `${label}: leaving the club lands outside the town wall, so no save carries a new hire`,
    );
  }
  const bigTop = map.buildingEntries.find((entry) => entry.name === BIG_TOP_ENTRY_NAME);
  check(bigTop !== undefined, `${label}: no Big Top to stand in for an exit that does not save`);
  if (bigTop !== undefined) {
    checkCatches(
      isInsideWallAtTile(map, returnTileOf(bigTop)),
      `${label}: the Big Top's exit, out on the circus grounds, reads as inside the wall`,
    );
  }
}

function checkNewHireRoundTrips(): void {
  // Signed the way the desk signs one: fresh, unintroduced, no recorded health.
  const id = MERCENARY_TEMPLATE_IDS[0];
  const atDesk = createMercenaryRoster();
  atDesk.floorLevelId = level3.id;
  atDesk.active = {
    id,
    name: getMercenaryTemplate(id).name,
    contractLevelId: level3.id,
    introduced: false,
  };

  const onDisk: unknown = JSON.parse(JSON.stringify(captureMercenaryRoster(atDesk)));
  const parsed = parseMercenaryRosterCheckpoint(onDisk);
  check(parsed !== undefined, 'a roster holding a fresh hire does not parse back from the save');
  if (parsed === undefined) return;

  const respawned = createMercenaryRoster();
  respawned.floorLevelId = level3.id;
  restoreMercenaryRoster(respawned, parsed);
  check(
    respawned.active?.id === id && respawned.active.contractLevelId === level3.id,
    'a hire signed at the desk is gone after a death respawns from the club-exit save',
  );

  // The same save restored on another floor must drop it, or the check above
  // would pass for a restore that ignores the snapshot altogether.
  const elsewhere = createMercenaryRoster();
  elsewhere.floorLevelId = level2.id;
  restoreMercenaryRoster(elsewhere, parsed);
  checkCatches(
    elsewhere.active !== null,
    'a floor-3 contract restored on another floor still names its hire',
  );
}

// ── Nothing on the third floor seals a room ──────────────────────────────────

function checkNoSealingRooms(worldSeed: number): void {
  const label = `seed ${worldSeed}`;
  const map = buildMap(level3, worldSeed);
  check(map.bossRooms.length === 0, `${label}: the overworld has a boss room that can lock`);
  check(map.arenaExteriors.length === 0, `${label}: the overworld has an arena that can lock`);
  check(map.spiderLabRoom === null, `${label}: the overworld has a spider lab that can lock`);
}

function checkSealingRoomsAreVisible(): void {
  check(
    (level3.bossRooms ?? []).length === 0,
    'the third floor declares a boss room, which can seal a hireling outside',
  );
  // A floor that does have them must show up, or the overworld's empty lists
  // above prove nothing.
  const map = buildMap(level2, SEEDS[0]);
  checkCatches(
    map.bossRooms.length === 0 && map.arenaExteriors.length === 0 && map.spiderLabRoom === null,
    'the second floor, which has sealing rooms, reads as having none',
  );
}

for (const seed of SEEDS) {
  checkCircusGather(seed);
  checkGatheredHireStays(seed);
  checkClubExitSaves(seed);
  checkNoSealingRooms(seed);
}
checkNewHireRoundTrips();
checkSealingRoomsAreVisible();
checkCircusJourney({ check, checkCatches }, SEEDS);
checkDeathNotice({ check, checkCatches });
checkCatchUpAttention({ check, checkCatches });

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
