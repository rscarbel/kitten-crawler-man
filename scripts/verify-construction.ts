#!/usr/bin/env tsx
/**
 * Headless gate on Construction, run against a real floor-3 `GameMap` with
 * Briar Hollow on it: the number tables, the palisade segments, the gate,
 * placement and its push-out and no-trap guarantees, build jobs, spikes,
 * dynamite, and persistence through a rebuild, a rewind and a reload.
 *
 * Hit points, timings and the speed table are written out here from the
 * original request's wording, so a rule that drifts from the request fails
 * rather than agreeing with itself. Prices are tuning numbers the designer
 * retunes freely, so every material and coin cost is read from the tables the
 * game charges from, and the checks hold the rules around them instead: the
 * cost shown is the cost charged, a discount takes the rule's own amount off
 * every line, a party one short cannot pay.
 *
 *   npm run verify:construction [-- --fault=gate-open|skip-corridor|spend-at-start]
 *
 * Each fault breaks the thing one section guards, and must turn it red:
 *  - `gate-open` lifts the gate's hostile-only block;
 *  - `skip-corridor` turns off the trebuchet's corridor check;
 *  - `spend-at-start` takes a job's materials when it starts.
 */

import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
  type BriarHollowState,
} from '../src/core/quests/briarHollowState';
import { spend, type ResourceCost } from '../src/core/items/gathering/partyResources';
import { RESOURCE_IDS, type ResourceId } from '../src/core/items/gathering/resourceIds';
import { constructionDiscount } from '../src/core/labour/craftPerks';
import {
  CONSTRUCTION_UNLOCK_IDS,
  grantConstructionUnlocks,
} from '../src/core/quests/villageUnlocks';
import { PlayerManager } from '../src/core/party/PlayerManager';
import { AbilityManager } from '../src/core/skills/AbilityManager';
import { PetNameBook } from '../src/core/party/petNames';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { ConstructionKit } from '../src/systems/briarHollow/ConstructionKit';
import { StructureHold } from '../src/systems/briarHollow/structureHold';
import type { SceneWorld } from '../src/systems/kits/SceneWorld';
import { Bugaboo } from '../src/creatures/Bugaboo';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem';
import { Conversation } from '../src/dialog/Conversation';
import { GRATE_SPIKES_BASE_HP, GrateSpikesMenu } from '../src/systems/GrateSpikesMenu';
import type { CrawlerKind } from '../src/core/skills/SkillManager';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Rat } from '../src/creatures/Rat';
import { Cow } from '../src/creatures/Cow';
import { Deinonychus } from '../src/creatures/Deinonychus';
import { GameMap } from '../src/map/GameMap';
import {
  FloorTypeValue,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  HOLLOW_THRESHOLD,
  type PalisadeTier,
  type TileContent,
} from '../src/map/tileTypes';
import { tileCoordKey } from '../src/map/tileIndex';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import type { SystemContext } from '../src/systems/GameSystem';
import { applyMovement } from '../src/systems/GameLoopPhases';
import {
  DefenseStructures,
  structureKey,
  trebuchetSolidRect,
} from '../src/systems/briarHollow/DefenseStructures';
import {
  ConstructionSystem,
  type PushableBody,
} from '../src/systems/briarHollow/ConstructionSystem';
import {
  crawlerPushBody,
  mobPushBody,
  STRUCTURE_REACH_TILES,
} from '../src/systems/briarHollow/ConstructionKit';
import {
  NO_SPACE_MESSAGE,
  doorwayTiles,
  planTrebuchetPushOut,
  pushOutTile,
  tileRefusal,
  villagerAnchorKeys,
} from '../src/systems/briarHollow/constructionPlacement';
import {
  BELL_TOWER_REPAIR_COINS,
  BELL_TOWER_REPAIR_COST,
  REPAIR_CHUNKS_PER_FULL_REPAIR,
  SNARE_BUILD_COST,
  SPIKES_COST,
  STRUCTURE_BLAST_DAMAGE,
  TREBUCHET_BUILD_COST,
  TREBUCHET_HEIGHT_TILES,
  TREBUCHET_REPAIR_UNIT,
  TREBUCHET_WIDTH_TILES,
  WALL_TIERS,
  capCost,
  discountedCost,
  jobFrames,
  repairChunks,
  scaleCost,
  trebuchetRepairCost,
  wallSegmentHp,
} from '../src/systems/briarHollow/structureRules';

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.split('=')[1] ?? null;

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const WORLD_SEED = 7919;
const MAP_SIZE = 280;
const UPDATES_PER_SECOND = 60;
const SIMULATED_GATE_SECONDS = 60;
const SETTLE_FRAMES = 30;
/** Construction at which spikes unlock, for the jobs that add them. */
const SPIKES_TEST_LEVEL = 5;
const MAX_CONSTRUCTION_LEVEL = 15;
/** How far the long-press check's camera sits up and left of the crawler, in tiles. */
const LONG_PRESS_VIEW_TILES = 6;
/** A snare this far off is out of the crawler's reach. */
const FAR_SNARE_TILES = 4;
/** How far a held finger may drift and still be the same hold. */
const HOLD_STILL_PX = 20;
/** The Construction level every rig's crawlers start at; their prices are discounted for it. */
const RIG_BUILDER_LEVEL = 1;
/** Trebuchets' and snares' worth of materials a placement check hands over, so a refusal is never a shortage. */
const PLENTY_OF_TRAPS = 4;
/** The request's spikes: 150 health on walls, trebuchets and defense-quest grates alike. */
const EXPECTED_SPIKES_HP = 150;

// ── The request's own numbers ─────────────────────────────────────────────

const EXPECTED_TIERS = {
  fence: { hp: 1 },
  wood: { hp: 150, build: 3, repair: 1.5 },
  stone: { hp: 450, build: 4, repair: 2 },
  fortified: { hp: 1000, build: 5, repair: 2.5 },
} as const;

/** The request's speed table: every level shaves another 5% off. */
const EXPECTED_SPEED_FACTORS = [
  1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3,
];

function sameCost(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

function upgradeCostOf(tier: PalisadeTier): ResourceCost {
  return WALL_TIERS[tier].upgradeCost ?? {};
}

function repairChunkOf(tier: PalisadeTier): ResourceCost {
  return WALL_TIERS[tier].repairChunkCost ?? {};
}

/** `cost` as a rig's own crawlers pay it. */
function rigPrice(cost: ResourceCost): ResourceCost {
  return discountedCost(cost, RIG_BUILDER_LEVEL);
}

function isFree(cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= 0);
}

// ── The world ─────────────────────────────────────────────────────────────

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const maybeSite = gameMap.briarHollow;
if (maybeSite === null) {
  console.error('verify:construction FAILED: the map has no Briar Hollow site');
  process.exit(1);
}
const site: BriarHollowSite = maybeSite;

if (fault === 'gate-open') {
  for (const tile of site.gate.tiles) gameMap.setHostileOnlyBlock(tile.x, tile.y, false);
}

interface Rig {
  readonly state: BriarHollowState;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly defense: DefenseStructures;
  readonly construction: ConstructionSystem;
  readonly messages: string[];
}

function teach(crawler: HumanPlayer | CatPlayer, level: number): void {
  crawler.craftSkills.restore({
    ...crawler.craftSkills.snapshot(),
    construction: { learned: true, level, xp: 0 },
  });
}

function makeRig(state: BriarHollowState = createBriarHollowState(), map: GameMap = gameMap): Rig {
  // Every plan granted, so this rig exercises the same builds a fully
  // progressed questline would offer, not the empty-menu state a fresh save
  // starts from.
  grantConstructionUnlocks(state.unlocks, CONSTRUCTION_UNLOCK_IDS);
  const bus = new EventBus();
  const roster = new MobRoster(map, new SpellSystem());
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  teach(human, RIG_BUILDER_LEVEL);
  teach(cat, RIG_BUILDER_LEVEL);
  const messages: string[] = [];
  const crawlerOf = (kind: CrawlerKind) => (kind === 'human' ? human : cat);
  const mapSite = map.briarHollow ?? site;
  const defense = new DefenseStructures({
    gameMap: map,
    site: mapSite,
    state,
    bus,
    audio: null,
    roster,
    constructionLevel: (kind) => crawlerOf(kind).craftSkills.getLevel('construction'),
    crawler: crawlerOf,
    onTileChanged: () => undefined,
    clockSeconds: () => 0,
    random: () => 0,
  });
  const construction = new ConstructionSystem({
    gameMap: map,
    site: mapSite,
    defense,
    human,
    cat,
    roster,
    audio: null,
    audioScope: null,
    announce: (message) => messages.push(message),
    noteResourceActivity: () => undefined,
    bodies: () => {
      const bodies: PushableBody[] = [crawlerPushBody(human), crawlerPushBody(cat)];
      for (const mob of roster.mobs) if (mob.isAlive) bodies.push(mobPushBody(mob, roster));
      return bodies;
    },
    indoors: false,
    unlocks: () => state.unlocks,
  });
  if (fault === 'skip-corridor') construction.skipCorridorCheck = true;
  if (fault === 'spend-at-start') {
    const start = construction.startOption.bind(construction);
    construction.startOption = (option) => {
      const status = construction.optionStatus(option);
      const started = start(option);
      if (started) spend(human, cat, status.cost, human);
      return started;
    };
  }
  return { state, bus, roster, human, cat, defense, construction, messages };
}

function giveCost(crawler: HumanPlayer | CatPlayer, cost: ResourceCost): void {
  for (const id of RESOURCE_IDS) {
    const amount = cost[id] ?? 0;
    if (amount > 0) crawler.inventory.addItem(id, amount);
  }
}

/** Hands the human whatever the party lacks of `cost`, so it holds at least that much. */
function topUpTo(rig: Rig, cost: ResourceCost): void {
  for (const id of RESOURCE_IDS) {
    const missing = (cost[id] ?? 0) - partyHolds(rig, id);
    if (missing > 0) rig.human.inventory.addItem(id, missing);
  }
}

function partyHolds(rig: Rig, id: ResourceId): number {
  return rig.human.inventory.countOf(id) + rig.cat.inventory.countOf(id);
}

/** Whether the party holds exactly `cost` of every building material, and nothing more. */
function holdsExactly(rig: Rig, cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => partyHolds(rig, id) === (cost[id] ?? 0));
}

function giveTrapStock(crawler: HumanPlayer | CatPlayer): void {
  giveCost(crawler, scaleCost(TREBUCHET_BUILD_COST, PLENTY_OF_TRAPS));
  giveCost(crawler, scaleCost(SNARE_BUILD_COST, PLENTY_OF_TRAPS));
}

function runJob(rig: Rig, maxFrames = UPDATES_PER_SECOND * 20): void {
  for (let frame = 0; frame < maxFrames && rig.construction.job !== null; frame++) {
    rig.construction.update();
  }
}

function standAt(
  crawler: HumanPlayer | CatPlayer,
  tileX: number,
  tileY: number,
  faceX: number,
  faceY: number,
): void {
  crawler.x = tileX * TILE_SIZE;
  crawler.y = tileY * TILE_SIZE;
  crawler.facingX = faceX;
  crawler.facingY = faceY;
  crawler.isMoving = false;
}

/** A spot on the south wall, away from the gate, with open ground in front of it. */
function southWallSegment(): { id: string; tile: { x: number; y: number } } {
  const bottom = site.palisadeBounds.y + site.palisadeBounds.h - 1;
  for (const segment of site.segments) {
    const tile = segment.tiles[1] ?? segment.tiles[0];
    const allSouth = segment.tiles.every((t) => t.y === bottom);
    if (!allSouth) continue;
    if (!gameMap.isWalkable(tile.x, tile.y - 1)) continue;
    const nearGate = site.gate.tiles.some((gate) => Math.abs(gate.x - tile.x) < 6);
    if (nearGate) continue;
    return { id: segment.id, tile };
  }
  throw new Error('no south wall segment with open ground inside it');
}

/**
 * A wood-tier segment's real max HP: the tier's flat number scales with how
 * many tiles the segment actually covers, since the ring's cut into segments
 * varies segment to segment (a remainder tile lands on some runs and not
 * others). Every check below reads a segment's own tile count rather than
 * assuming they all match.
 */
function woodMaxFor(segmentId: string): number {
  return wallSegmentHp('wood', segmentTiles(segmentId));
}

function segmentTiles(segmentId: string): number {
  const segment = site.segments.find((candidate) => candidate.id === segmentId);
  if (segment === undefined) throw new Error(`no such segment: ${segmentId}`);
  return segment.tiles.length;
}

// ── Tables ────────────────────────────────────────────────────────────────

section('Tables');
check(WALL_TIERS.fence.baseHp === EXPECTED_TIERS.fence.hp, 'a fence has 1 HP');
for (const tier of ['wood', 'stone', 'fortified'] as const) {
  const expected = EXPECTED_TIERS[tier];
  const actual = WALL_TIERS[tier];
  check(actual.baseHp === expected.hp, `${tier}: ${expected.hp} HP`);
  check(!isFree(upgradeCostOf(tier)), `${tier}: raising a wall to it costs materials`);
  check(actual.buildSeconds === expected.build, `${tier}: builds in ${expected.build} s`);
  check(!isFree(repairChunkOf(tier)), `${tier}: a repair chunk costs materials`);
  check(actual.repairSeconds === expected.repair, `${tier}: repairs in ${expected.repair} s`);
}
EXPECTED_SPEED_FACTORS.forEach((factor, index) => {
  const level = index + 1;
  const frames = jobFrames(1, level);
  check(
    frames === Math.round(UPDATES_PER_SECOND * factor),
    `speed L${level}: a 1 s job takes ${frames} frames (×${factor})`,
  );
});
{
  const pricedBuilds: readonly ResourceCost[] = [
    upgradeCostOf('wood'),
    upgradeCostOf('stone'),
    upgradeCostOf('fortified'),
    TREBUCHET_BUILD_COST,
    SNARE_BUILD_COST,
    SPIKES_COST,
    BELL_TOWER_REPAIR_COST,
  ];
  const everyLineLosesTheDiscount = (level: number) =>
    pricedBuilds.every((cost) =>
      RESOURCE_IDS.every((id) => {
        const full = cost[id] ?? 0;
        const expected = Math.max(0, full - constructionDiscount(level));
        const charged = discountedCost(cost, level)[id];
        return expected > 0 ? charged === expected : charged === undefined;
      }),
    );
  const levels = Array.from({ length: MAX_CONSTRUCTION_LEVEL }, (_, index) => index + 1);
  const failingLevel = levels.find((level) => !everyLineLosesTheDiscount(level));
  check(
    failingLevel === undefined,
    `every level takes its own discount off every line of every build, and drops a line it covers${failingLevel === undefined ? '' : ` (wrong at L${failingLevel})`}`,
  );
  check(constructionDiscount(1) === 0, 'a level-1 builder pays full price');
  check(
    levels.every(
      (level) => level === 1 || constructionDiscount(level) >= constructionDiscount(level - 1),
    ),
    'the discount never shrinks as the builder levels',
  );
  const fortified = upgradeCostOf('fortified');
  const fortifiedAtTop = discountedCost(fortified, MAX_CONSTRUCTION_LEVEL);
  check(
    RESOURCE_IDS.every((id) => (fortifiedAtTop[id] ?? 0) <= (fortified[id] ?? 0)) &&
      !sameCost(fortifiedAtTop, fortified),
    'a top-level builder pays less for a fortified wall than a beginner',
  );
}
// `repairChunks` is a fraction of max HP, so any consistent max stands in — the
// tier's own reference number, not a real segment's (which now varies by length).
const CHUNK_TEST_MAX = WALL_TIERS.wood.baseHp;
check(repairChunks(CHUNK_TEST_MAX * 0.01, CHUNK_TEST_MAX) === 1, 'repair chunks: 1% missing is 1');
check(repairChunks(CHUNK_TEST_MAX * 0.2, CHUNK_TEST_MAX) === 1, 'repair chunks: 20% missing is 1');
check(repairChunks(CHUNK_TEST_MAX * 0.21, CHUNK_TEST_MAX) === 2, 'repair chunks: 21% missing is 2');
check(repairChunks(CHUNK_TEST_MAX * 0.99, CHUNK_TEST_MAX) === 5, 'repair chunks: 99% missing is 5');
check(repairChunks(CHUNK_TEST_MAX, CHUNK_TEST_MAX) === 5, 'repair chunks: 100% missing is 5');
{
  const repairUnits = (units: number) =>
    capCost(scaleCost(TREBUCHET_REPAIR_UNIT, units), TREBUCHET_BUILD_COST);
  const BROKEN_AT_HALF_UNITS = 4;
  const BROKEN_AT_ZERO_UNITS = 6;
  check(
    sameCost(trebuchetRepairCost(99, 100, false), repairUnits(1)),
    'trebuchet repair: a scratch is one unit',
  );
  check(
    sameCost(trebuchetRepairCost(50, 100, true), repairUnits(BROKEN_AT_HALF_UNITS)),
    'trebuchet repair: broken at half is 4 units',
  );
  const brokenAtZero = trebuchetRepairCost(0, 100, true);
  check(
    sameCost(brokenAtZero, repairUnits(BROKEN_AT_ZERO_UNITS)) &&
      RESOURCE_IDS.every((id) => (brokenAtZero[id] ?? 0) <= (TREBUCHET_BUILD_COST[id] ?? 0)),
    'trebuchet repair: broken at 0 is 6 units, capped at the build cost',
  );
}

{
  const rig = makeRig();
  const { id } = southWallSegment();
  const woodMax = woodMaxFor(id);
  teach(rig.human, 14);
  const ref = { kind: 'segment', id } as const;
  rig.defense.applyUpgrade(ref, 'human');
  rig.defense.damage(ref, woodMax / 2, null, 'blast');
  const before = rig.defense.hp(ref) / rig.defense.maxHp(ref);
  teach(rig.human, 15);
  rig.defense.update(0);
  const after = rig.defense.hp(ref) / rig.defense.maxHp(ref);
  check(rig.defense.maxHp(ref) === woodMax * 2, "L15: the builder doubles the wall's max HP");
  check(
    Math.abs(after - before) < 1e-9 && rig.defense.hp(ref) === woodMax,
    'L15: a half-health wall stays at half health',
  );
  teach(rig.cat, 15);
  // Same tile count as `id`'s segment, so its wood max is the same number —
  // otherwise this would also be testing the length scaling, not the builder.
  const catRef = site.segments.find(
    (segment) => segment.id !== id && segment.tiles.length === segmentTiles(id),
  );
  if (catRef !== undefined) {
    rig.defense.applyUpgrade({ kind: 'segment', id: catRef.id }, 'human');
    check(
      rig.defense.maxHp({ kind: 'segment', id: catRef.id }) === woodMax * 2,
      'the doubling follows the builder, not the party',
    );
  }
}

// ── Segments ──────────────────────────────────────────────────────────────

section('Segments');
{
  const ringKeys = new Set(site.palisadePath.map((tile) => tileCoordKey(tile.x, tile.y)));
  const covered = new Set<number>();
  let duplicate = false;
  for (const segment of site.segments) {
    for (const tile of segment.tiles) {
      const key = tileCoordKey(tile.x, tile.y);
      if (covered.has(key)) duplicate = true;
      covered.add(key);
    }
  }
  check(
    !duplicate && covered.size === ringKeys.size && [...ringKeys].every((key) => covered.has(key)),
    `the ${site.segments.length} segments cover the ring exactly`,
  );

  const rig = makeRig();
  const { id } = southWallSegment();
  const woodMax = woodMaxFor(id);
  const ref = { kind: 'segment', id } as const;
  const tiles = rig.defense.footprintOf(ref);
  const tierOnMap = () => {
    const tile = tiles[0];
    const content: TileContent | undefined = gameMap.structure[tile.y]?.[tile.x];
    return content?.type === HOLLOW_PALISADE ? (content.wallTier ?? 'none') : 'gap';
  };
  const path: string[] = [tierOnMap()];
  for (let step = 0; step < 3; step++) {
    rig.defense.applyUpgrade(ref, 'human');
    path.push(tierOnMap());
  }
  check(
    path.join('>') === 'fence>wood>stone>fortified',
    `fence → fortified upgrades on the map (${path.join(' > ')})`,
  );
  check(rig.defense.upgradeTarget(ref) === null, 'nothing upgrades past fortified');

  const woodRig = makeRig();
  woodRig.defense.applyUpgrade(ref, 'human');
  woodRig.defense.damage(ref, 10000, null, 'blast');
  check(woodRig.defense.segmentTier(id) === 'breach', 'a wooden wall at 0 HP is a breach');
  check(
    tiles.every(
      (tile) =>
        gameMap.structure[tile.y][tile.x].type === HOLLOW_PALISADE_GAP &&
        gameMap.isWalkable(tile.x, tile.y),
    ),
    'a breach is walkable rubble',
  );
  check(
    sameCost(
      woodRig.defense.repairCost(ref) ?? {},
      scaleCost(repairChunkOf('wood'), REPAIR_CHUNKS_PER_FULL_REPAIR),
    ),
    'repairing a breach costs the full five chunks',
  );
  woodRig.defense.applyRepair(ref);
  check(
    woodRig.defense.segmentTier(id) === 'wood' && woodRig.defense.hp(ref) === woodMax,
    'repair stands the wooden wall back up at full health',
  );
  check(
    tiles.every((tile) => !gameMap.isWalkable(tile.x, tile.y)),
    'a repaired wall blocks again',
  );

  const meleeRig = makeRig();
  const target = tiles[1] ?? tiles[0];
  standAt(meleeRig.human, target.x, target.y - 1, 0, 1);
  const struckFence = meleeRig.defense.tryMeleeHit(meleeRig.human, meleeRig.human.getMeleeRange());
  check(
    struckFence && meleeRig.defense.segmentTier(id) === 'gap',
    'one melee hit flattens a fence',
  );
  meleeRig.defense.applyUpgrade(ref, 'human');
  meleeRig.defense.tryMeleeHit(meleeRig.human, meleeRig.human.getMeleeRange());
  check(meleeRig.defense.hp(ref) === woodMax, "a crawler's melee never dents a wooden wall");
  // Put the ring back as it was generated for the sections below.
  const reset = makeRig();
  reset.defense.syncMap();
}

// ── Wall upgrades never eject an occupant to the far side ──────────────────

section('Wall upgrades keep occupants on their own side');
/**
 * A north-perimeter wall tile with `clearRows` of open ground on both sides
 * of it — enough room to actually walk a body up against either face
 * through real movement collision, not just teleport it there.
 */
function northWallSegment(clearRows: number): { id: string; tile: { x: number; y: number } } {
  const top = site.palisadeBounds.y;
  for (const segment of site.segments) {
    for (const segTile of segment.tiles) {
      if (segTile.y !== top) continue;
      let clear = true;
      for (let dy = 1; dy <= clearRows && clear; dy++) {
        if (!gameMap.isWalkable(segTile.x, segTile.y + dy)) clear = false;
        if (!gameMap.isWalkable(segTile.x, segTile.y - dy)) clear = false;
      }
      if (!clear) continue;
      const nearGate = site.gate.tiles.some((gate) => Math.abs(gate.x - segTile.x) < 6);
      if (nearGate) continue;
      return { id: segment.id, tile: segTile };
    }
  }
  throw new Error('no north wall segment with open ground on both sides of it');
}

/** Raises `id` from fence through every tier up to (and including) `to`. */
function raiseWall(rig: Rig, id: string, to: PalisadeTier): void {
  for (const tier of ['wood', 'stone', 'fortified'] as const) {
    rig.defense.applyUpgrade({ kind: 'segment', id }, 'human');
    if (tier === to) return;
  }
}

{
  // (a) The user's exact case: a crawler walks north into the wall from
  // inside the village — real movement collision, not a teleport — and comes
  // to rest touching it. Fortifying the wall must not move them: their own
  // standing tile (their centre, which is what movement collision itself
  // tests) was never inside the wall's footprint, so they were never trapped
  // — the pre-fix code moved them anyway because it judged "trapped" by a
  // looser test (a quarter-tile-inset footing box) that standing flush
  // against any solid wall already satisfies.
  const { id, tile } = northWallSegment(4);
  const rig = makeRig();
  giveCost(rig.human, upgradeCostOf('fortified'));
  raiseWall(rig, id, 'stone');
  rig.human.x = tile.x * TILE_SIZE;
  rig.human.y = (tile.y + 4) * TILE_SIZE;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 3; frame++) {
    applyMovement(rig.human, { dx: 0, dy: -1, isMobile: false }, gameMap);
  }
  rig.human.isMoving = false;
  const beforeX = rig.human.x;
  const beforeY = rig.human.y;
  const beforeTileY = Math.floor((beforeY + TILE_SIZE / 2) / TILE_SIZE);
  check(
    beforeTileY === tile.y + 1,
    `walking north comes to rest on the wall's own south neighbour (row ${beforeTileY})`,
  );
  const started = rig.construction.startOption('fortified');
  check(started, '(a) the fortified job starts facing the wall from inside');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'fortified' &&
      rig.human.x === beforeX &&
      rig.human.y === beforeY,
    `(a) a crawler standing legally south of the wall is not moved at all when it fortifies (before ${beforeX},${beforeY} / after ${rig.human.x},${rig.human.y})`,
  );
}

{
  // (b) The mirror of (a): a companion pressed against the wall's OUTER face
  // (standing north of it, walking south into it) must stay outside. Nothing
  // standing legally outside is on the village's business — it could just as
  // well be a sieging hostile — so the fix must never default to "put it
  // inside".
  const { id, tile } = northWallSegment(4);
  const rig = makeRig();
  giveCost(rig.human, upgradeCostOf('fortified'));
  raiseWall(rig, id, 'stone');
  rig.cat.x = tile.x * TILE_SIZE;
  rig.cat.y = (tile.y - 4) * TILE_SIZE;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 3; frame++) {
    applyMovement(rig.cat, { dx: 0, dy: 1, isMobile: false }, gameMap);
  }
  rig.cat.isMoving = false;
  const beforeX = rig.cat.x;
  const beforeY = rig.cat.y;
  const beforeTileY = Math.floor((beforeY + TILE_SIZE / 2) / TILE_SIZE);
  check(
    beforeTileY === tile.y - 1,
    `walking south comes to rest on the wall's own north neighbour (row ${beforeTileY})`,
  );
  standAt(rig.human, tile.x, tile.y + 1, 0, -1);
  const started = rig.construction.startOption('fortified');
  check(started, '(b) the fortified job starts facing the wall from inside');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'fortified' && rig.cat.x === beforeX && rig.cat.y === beforeY,
    `(b) a companion pressed against the outer face is not pulled inside when the wall fortifies (before ${beforeX},${beforeY} / after ${rig.cat.x},${rig.cat.y})`,
  );
}

{
  // (c) A body whose centre is genuinely inside the wall's own tile — the
  // breach/gap-standing case `freeTrappedOccupants` exists for — is put back
  // on the side its own centre was already leaning toward. Run with a
  // hostile leaning north: a sieging mob caught this way must come out on
  // its own (outside) side, never be pulled into the village.
  const { id, tile } = northWallSegment(2);
  const rigSouth = makeRig();
  giveCost(rigSouth.human, upgradeCostOf('fortified'));
  raiseWall(rigSouth, id, 'stone');
  rigSouth.human.x = tile.x * TILE_SIZE;
  rigSouth.human.y = tile.y * TILE_SIZE + TILE_SIZE / 4; // leaning toward the south half of the tile
  rigSouth.human.facingX = 0;
  rigSouth.human.facingY = -1;
  rigSouth.human.isMoving = false;
  check(
    rigSouth.construction.startOption('fortified'),
    '(c) the fortified job starts with the crawler standing on the wall tile, leaning south',
  );
  runJob(rigSouth);
  const southFinalY = Math.floor((rigSouth.human.y + TILE_SIZE / 2) / TILE_SIZE);
  check(
    rigSouth.defense.segmentTier(id) === 'fortified' && southFinalY > tile.y,
    `(c) leaning south lands south of the wall (row ${southFinalY}, wall at ${tile.y})`,
  );

  const { id: id2, tile: tile2 } = northWallSegment(2);
  const rigNorth = makeRig();
  giveCost(rigNorth.human, upgradeCostOf('fortified'));
  raiseWall(rigNorth, id2, 'stone');
  standAt(rigNorth.human, tile2.x, tile2.y + 1, 0, -1);
  const rat = new Rat(tile2.x, tile2.y, TILE_SIZE);
  rat.x = tile2.x * TILE_SIZE;
  rat.y = tile2.y * TILE_SIZE - TILE_SIZE / 4; // leaning toward the north half of the tile
  rigNorth.roster.add(rat);
  check(
    rigNorth.construction.startOption('fortified'),
    '(c) the fortified job starts with a hostile standing on the wall tile, leaning north',
  );
  runJob(rigNorth);
  const northFinalY = Math.floor((rat.y + TILE_SIZE / 2) / TILE_SIZE);
  check(
    rigNorth.defense.segmentTier(id2) === 'fortified' && northFinalY < tile2.y,
    `(c) a hostile leaning north lands north of the wall, not pulled into the village (row ${northFinalY}, wall at ${tile2.y})`,
  );
  rat.hp = 0;
}

// ── The gate ──────────────────────────────────────────────────────────────

section('The gate');
{
  check(
    site.gate.tiles.every((tile) => gameMap.isWalkable(tile.x, tile.y)),
    'the gate is walkable',
  );
  check(
    site.gate.tiles.every((tile) => !gameMap.isWalkableForHostile(tile.x, tile.y)),
    'the gate turns hostiles away',
  );
  const outside = site.gate.outside;
  const inside = site.gate.inside;
  const friendlyPath = gameMap.findPath(outside.x, outside.y, inside.x, inside.y, 40, false);
  const hostilePath = gameMap.findPath(outside.x, outside.y, inside.x, inside.y, 40, true);
  check(friendlyPath.length > 0, 'A* for a friendly goes through the gate');
  check(hostilePath.length === 0, 'A* for a hostile finds no way through the gate');

  const rig = makeRig();
  const rat = new Rat(outside.x, outside.y, TILE_SIZE);
  rig.roster.add(rat);
  standAt(rig.human, inside.x, inside.y, 0, 1);
  standAt(rig.cat, inside.x + 1, inside.y - 1, 0, 1);
  const ctx: SystemContext = {
    human: rig.human,
    cat: rig.cat,
    active: rig.human,
    inactive: rig.cat,
    activeIsMoving: false,
    roster: rig.roster,
    gameMap,
  };
  const loop = new MobUpdateLoop();
  const gateRow = site.gate.tiles[0].y;
  let crossed = false;
  let closest = Infinity;
  rig.human.godMode = true;
  rig.cat.godMode = true;
  for (let frame = 0; frame < SIMULATED_GATE_SECONDS * UPDATES_PER_SECOND; frame++) {
    loop.update(ctx);
    standAt(rig.human, inside.x, inside.y, 0, 1);
    const ratTileY = Math.floor((rat.y + TILE_SIZE / 2) / TILE_SIZE);
    closest = Math.min(closest, ratTileY);
    if (ratTileY <= gateRow) crossed = true;
  }
  check(
    !crossed,
    `a hostile chasing a crawler across the gate never crosses it in ${SIMULATED_GATE_SECONDS} s (closest row ${closest}, gate row ${gateRow})`,
  );

  const pushedNorth = (mob: Rat | Cow | Deinonychus): boolean => {
    mob.x = outside.x * TILE_SIZE;
    mob.y = outside.y * TILE_SIZE;
    mob.applyKnockback(0, -1, TILE_SIZE * 6, UPDATES_PER_SECOND);
    for (let frame = 0; frame < UPDATES_PER_SECOND + 1; frame++) mob.advanceKnockback();
    return Math.floor((mob.y + TILE_SIZE / 2) / TILE_SIZE) < gateRow;
  };
  const shoved = new Rat(outside.x, outside.y, TILE_SIZE);
  shoved.setMap(gameMap);
  check(!pushedNorth(shoved), 'a hostile knocked back into the gate stops at its face');
  const cow = new Cow(outside.x, outside.y, TILE_SIZE, 'holstein', 'adult');
  cow.setMap(gameMap);
  check(pushedNorth(cow), 'a cow crosses the gate');
  const deinonychus = new Deinonychus(outside.x, outside.y, TILE_SIZE, rig.cat, 1, 100);
  deinonychus.setMap(gameMap);
  check(pushedNorth(deinonychus), 'Deinonychus crosses the gate');

  const walker = new HumanPlayer(outside.x, outside.y, TILE_SIZE);
  for (let frame = 0; frame < UPDATES_PER_SECOND * 3; frame++) {
    applyMovement(walker, { dx: 0, dy: -1, isMobile: false }, gameMap);
  }
  check(
    Math.floor((walker.y + TILE_SIZE / 2) / TILE_SIZE) < gateRow,
    'a crawler walks through the gate',
  );
}

// ── Placement ─────────────────────────────────────────────────────────────

section('Placement');
/** An open patch of ground outside the village and the town, clear for a 7 × 9 box around a builder. */
function openPatch(): { x: number; y: number } {
  const world = { gameMap, site, defense: null, anchorTiles: villagerAnchorKeys(site) };
  const doors = doorwayTiles(gameMap, site);
  const bounds = site.palisadeBounds;
  for (let radius = 4; radius < 40; radius++) {
    for (let y = bounds.y - radius; y <= bounds.y + bounds.h + radius; y++) {
      for (let x = bounds.x - radius; x <= bounds.x + bounds.w + radius; x++) {
        let clear = true;
        for (let dy = -5; dy <= 4 && clear; dy++) {
          for (let dx = -4; dx <= 4 && clear; dx++) {
            if (tileRefusal(world, doors, x + dx, y + dy, true) !== null) clear = false;
          }
        }
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open patch of ground near the village');
}

{
  const patch = openPatch();
  const rig = makeRig();
  giveTrapStock(rig.human);
  // Builder faces north: the trebuchet goes up in the three rows above him.
  standAt(rig.human, patch.x, patch.y, 0, -1);
  standAt(rig.cat, patch.x + 3, patch.y + 2, 0, 1);
  const planned = rig.construction.plannedFootprint(rig.human, 'trebuchet');
  const footprint = planned.footprint;
  const rat = new Rat(footprint.x, footprint.y, TILE_SIZE);
  const cow = new Cow(footprint.x + 1, footprint.y + 1, TILE_SIZE, 'holstein', 'adult');
  const deinonychus = new Deinonychus(footprint.x, footprint.y + 2, TILE_SIZE, rig.cat, 1, 100);
  rig.roster.add(rat);
  rig.roster.add(cow);
  rig.roster.add(deinonychus);
  const started = rig.construction.startOption('trebuchet');
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
    rig.construction.update();
    for (const mob of [rat, cow, deinonychus]) mob.advanceKnockback();
  }
  const inside = (body: { x: number; y: number }) => {
    const tx = Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE);
    const ty = Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE);
    return (
      tx >= footprint.x &&
      ty >= footprint.y &&
      tx < footprint.x + footprint.w &&
      ty < footprint.y + footprint.h
    );
  };
  const onGround = (body: { x: number; y: number }) =>
    gameMap.isWalkable(
      Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE),
      Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE),
    );
  check(started, 'a trebuchet starts over a hostile, a cow and the companion');
  check(!inside(rat) && onGround(rat), 'the hostile is pushed clear onto open ground');
  check(!inside(cow) && onGround(cow), 'the cow is pushed clear onto open ground');
  check(
    !inside(deinonychus) && onGround(deinonychus),
    'the companion is pushed clear onto open ground',
  );
  check(
    !gameMap.isWalkable(footprint.x, footprint.y),
    'the footprint is reserved while it goes up',
  );
  rig.construction.cancelJob();
  check(
    gameMap.isWalkable(footprint.x, footprint.y),
    'a cancelled trebuchet releases its footprint',
  );
  for (const mob of [rat, cow, deinonychus]) {
    mob.hp = 0;
  }
}

{
  // A body that refuses the nearest way out (a penned cow's `acceptsShove`) is
  // pushed to the next spot it will take, never forced.
  const patchForRefusal = openPatch();
  const refusalRig = makeRig();
  standAt(refusalRig.human, patchForRefusal.x, patchForRefusal.y, 0, -1);
  const refusalFootprint = refusalRig.construction.plannedFootprint(
    refusalRig.human,
    'trebuchet',
  ).footprint;
  const eastEdgePx = (refusalFootprint.x + refusalFootprint.w) * TILE_SIZE;
  const picky = {
    x: refusalFootprint.x * TILE_SIZE,
    y: refusalFootprint.y * TILE_SIZE,
    accepts: (x: number) => x >= eastEdgePx,
  };
  const pickyPlan = planTrebuchetPushOut(gameMap, refusalFootprint, patchForRefusal, [picky]);
  const pickyTo = pickyPlan?.[0]?.to;
  check(
    pickyTo !== undefined && pickyTo.x * TILE_SIZE >= eastEdgePx,
    'a body that refuses the nearest spot is pushed to the next one it accepts',
  );
  const stubborn = { ...picky, accepts: () => false };
  check(
    planTrebuchetPushOut(gameMap, refusalFootprint, patchForRefusal, [stubborn]) === null,
    'a body that accepts nowhere refuses the build rather than being forced',
  );
}

{
  // A 2-wide gap in a long three-deep wall, and the trebuchet that would fill it.
  const patch = openPatch();
  const checkpoint = gameMap.captureCheckpoint();
  const rig = makeRig();
  giveTrapStock(rig.human);
  standAt(rig.human, patch.x, patch.y, 0, -1);
  standAt(rig.cat, patch.x, patch.y + 2, 0, 1);
  const footprint = rig.construction.plannedFootprint(rig.human, 'trebuchet').footprint;
  const reach = 22;
  for (let y = footprint.y; y < footprint.y + footprint.h; y++) {
    for (let x = footprint.x - reach; x <= footprint.x + footprint.w + reach; x++) {
      if (x >= footprint.x && x < footprint.x + footprint.w) continue;
      gameMap.blockTilePermanently(x, y);
    }
  }
  rig.messages.length = 0;
  const sealed = rig.construction.startOption('trebuchet');
  check(
    !sealed && rig.messages.includes(NO_SPACE_MESSAGE),
    `a trebuchet that would seal a corridor is refused with "${NO_SPACE_MESSAGE}"`,
  );
  rig.construction.cancelJob();
  gameMap.restoreCheckpoint(checkpoint);
}

{
  // No candidate footprint fits anywhere round the builder: the menu row
  // stays pressable, and pressing it must spend nothing, build nothing, and
  // stand up the "no room" silhouette over the same spot the attempt used.
  const patch = openPatch();
  const checkpoint = gameMap.captureCheckpoint();
  const rig = makeRig();
  giveTrapStock(rig.human);
  standAt(rig.human, patch.x, patch.y, 0, -1);
  const boardsBefore = partyHolds(rig, 'wood_board');
  const ropeBefore = partyHolds(rig, 'rope');
  const wallRadius = 6;
  for (let y = patch.y - wallRadius; y <= patch.y + 2; y++) {
    for (let x = patch.x - wallRadius; x <= patch.x + wallRadius; x++) {
      if (x === patch.x && y === patch.y) continue;
      gameMap.blockTilePermanently(x, y);
    }
  }
  const attempted = rig.construction.plannedFootprint(rig.human, 'trebuchet').footprint;
  rig.messages.length = 0;
  const started = rig.construction.startOption('trebuchet');
  check(!started, 'a trebuchet with nowhere to fit never starts');
  check(rig.messages.includes(NO_SPACE_MESSAGE), `it is refused with "${NO_SPACE_MESSAGE}"`);
  check(rig.construction.job === null, 'no job is left running');
  check(partyHolds(rig, 'wood_board') === boardsBefore, 'no boards are spent on a no-room attempt');
  check(partyHolds(rig, 'rope') === ropeBefore, 'no rope is spent on a no-room attempt');
  check(
    rig.defense.at(attempted.x, attempted.y) === null,
    'nothing is built where the attempt was made',
  );
  const ghost = rig.construction.noRoomGhost;
  check(
    ghost !== null &&
      ghost.footprint.x === attempted.x &&
      ghost.footprint.y === attempted.y &&
      ghost.footprint.w === attempted.w &&
      ghost.footprint.h === attempted.h,
    'the no-room silhouette is set up over the same footprint the attempt used',
  );
  check(ghost !== null && ghost.alpha > 0, 'the silhouette starts faded fully in');
  rig.construction.clearNoRoomGhost();
  check(
    rig.construction.noRoomGhost === null,
    'the silhouette clears on demand, the same way reopening the build menu does',
  );
  gameMap.restoreCheckpoint(checkpoint);
}

{
  // A body whose only push-out tile is walled in.
  const patch = openPatch();
  const checkpoint = gameMap.captureCheckpoint();
  const rig = makeRig();
  standAt(rig.human, patch.x, patch.y, 0, -1);
  const footprint = rig.construction.plannedFootprint(rig.human, 'trebuchet').footprint;
  const pocket = { x: footprint.x + footprint.w, y: footprint.y };
  for (let y = footprint.y - 1; y <= footprint.y + footprint.h; y++) {
    for (let x = footprint.x - 1; x <= footprint.x + footprint.w; x++) {
      const inFootprint =
        x >= footprint.x &&
        y >= footprint.y &&
        x < footprint.x + footprint.w &&
        y < footprint.y + footprint.h;
      const isBuilder = x === patch.x && y === patch.y;
      const isPocket = x === pocket.x && y === pocket.y;
      if (!inFootprint && !isBuilder && !isPocket) gameMap.blockTilePermanently(x, y);
    }
  }
  // The pocket's own way out is walled too, so it reaches nothing.
  gameMap.blockTilePermanently(pocket.x + 1, pocket.y);
  const bodyTile = { x: footprint.x + footprint.w - 1, y: footprint.y };
  check(
    pushOutTile(gameMap, bodyTile, footprint, patch) === null,
    'a body whose only way out is an enclosed pocket has no push-out tile',
  );
  const rat = new Rat(bodyTile.x, bodyTile.y, TILE_SIZE);
  rig.roster.add(rat);
  giveTrapStock(rig.human);
  rig.messages.length = 0;
  check(
    !rig.construction.startOption('trebuchet') && rig.messages.includes(NO_SPACE_MESSAGE),
    'so the trebuchet is refused',
  );
  gameMap.restoreCheckpoint(checkpoint);
}

{
  const patch = openPatch();
  const rig = makeRig();
  giveTrapStock(rig.human);
  standAt(rig.human, patch.x, patch.y, 1, 0);
  const snareTile = rig.construction.plannedFootprint(rig.human, 'snare').footprint;
  const rat = new Rat(snareTile.x, snareTile.y, TILE_SIZE);
  rig.roster.add(rat);
  rig.messages.length = 0;
  check(
    !rig.construction.startOption('snare') && rig.messages.includes(NO_SPACE_MESSAGE),
    'a snare on an occupied tile is refused',
  );
  rat.hp = 0;
  check(rig.construction.startOption('snare'), 'the same snare starts once the tile is free');
  runJob(rig);
  check(rig.defense.at(snareTile.x, snareTile.y)?.kind === 'snare', 'the snare is built');
  check(!rig.construction.startOption('snare'), 'a second snare on the same tile is impossible');
  standAt(rig.human, snareTile.x - 1, snareTile.y + 1, 0, -1);
  const overlapping = rig.construction.plannedFootprint(rig.human, 'trebuchet');
  const coversSnare = (fp: { x: number; y: number; w: number; h: number }) =>
    snareTile.x >= fp.x &&
    snareTile.x < fp.x + fp.w &&
    snareTile.y >= fp.y &&
    snareTile.y < fp.y + fp.h;
  check(
    !(overlapping.valid && coversSnare(overlapping.footprint)),
    'a trebuchet can never be placed over a snare',
  );
  rig.defense.destroy({ kind: 'snare', key: structureKey(snareTile.x, snareTile.y) });
}

{
  const world = { gameMap, site, defense: null, anchorTiles: villagerAnchorKeys(site) };
  const doors = doorwayTiles(gameMap, site);
  const interior = gameMap.townPlan?.interior;
  const townTile =
    interior === undefined
      ? null
      : { x: interior.x + Math.floor(interior.w / 2), y: interior.y + Math.floor(interior.h / 2) };
  check(
    townTile !== null && tileRefusal(world, doors, townTile.x, townTile.y, false) !== null,
    'nothing is built inside the town wall',
  );
  let threshold: { x: number; y: number } | null = null;
  for (const building of site.buildings) {
    for (const door of building.doorways) {
      if (gameMap.structure[door.y]?.[door.x]?.type === HOLLOW_THRESHOLD) threshold = door;
    }
  }
  check(
    threshold !== null && tileRefusal(world, doors, threshold.x, threshold.y, false) !== null,
    'nothing is built on a threshold',
  );
  check(
    threshold !== null && tileRefusal(world, doors, threshold.x, threshold.y + 2, false) !== null,
    'nothing is built within two tiles of a doorway',
  );
}

section('Squeezing past a trebuchet');
/** Where a walk south starts, in tiles above the trebuchets' footprints. */
const SQUEEZE_START_TILES_NORTH = 2;
/** How far into a trebuchet's frame the off-line walk starts, in tiles: inside the corner slide. */
const SQUEEZE_MISALIGN_TILES = 0.2;
const SQUEEZE_MAX_FRAMES = UPDATES_PER_SECOND * 6;
/** Rows of footprint between the seam's middle row and open ground. */
const SQUEEZE_CHASE_RING_TILES = 2;

/** Walks the active crawler south from above the footprints; true once its centre is past them. */
function walkSouthPast(rig: Rig, centreColumnPx: number, footprintTop: number): boolean {
  const crawler = rig.human;
  crawler.x = centreColumnPx - TILE_SIZE / 2;
  crawler.y = (footprintTop - SQUEEZE_START_TILES_NORTH) * TILE_SIZE;
  const pastY = (footprintTop + TREBUCHET_HEIGHT_TILES) * TILE_SIZE;
  for (let frame = 0; frame < SQUEEZE_MAX_FRAMES; frame++) {
    applyMovement(crawler, { dx: 0, dy: 1, isMobile: false }, gameMap);
    if (crawler.y >= pastY) return true;
  }
  return false;
}

{
  const patch = openPatch();
  const rig = makeRig();
  const top = patch.y - TREBUCHET_HEIGHT_TILES;
  const westX = patch.x - TREBUCHET_WIDTH_TILES;
  const west = rig.defense.placeTrebuchet(westX, top, 'human');
  const east = rig.defense.placeTrebuchet(patch.x, top, 'human');
  const seamPx = patch.x * TILE_SIZE;
  check(
    !gameMap.isWalkable(patch.x - 1, top + 1) && !gameMap.isWalkable(patch.x, top + 1),
    'every footprint tile stays solid for mobs and A*',
  );
  check(
    walkSouthPast(rig, seamPx, top),
    'a crawler walks between two trebuchets built flush, along their bare edges',
  );
  const westFrame = trebuchetSolidRect(westX, top);
  check(
    walkSouthPast(rig, westFrame.right - SQUEEZE_MISALIGN_TILES * TILE_SIZE, top),
    'a crawler slightly inside a frame is eased around its corner and through',
  );
  check(
    !walkSouthPast(rig, (westFrame.left + westFrame.right) / 2, top),
    "a crawler walking into a frame's middle is still stopped",
  );
  // The seam's middle row: every tile around it is footprint, so a chase must
  // close from the nearest ring that has open ground.
  const stripTile = { x: patch.x - 1, y: top + 1 };
  const route = gameMap.findPath(westX - 2, stripTile.y, stripTile.x, stripTile.y);
  const routeEnd = route[route.length - 1];
  check(
    routeEnd !== undefined &&
      gameMap.isWalkable(routeEnd.x, routeEnd.y) &&
      Math.max(Math.abs(routeEnd.x - stripTile.x), Math.abs(routeEnd.y - stripTile.y)) <=
        SQUEEZE_CHASE_RING_TILES,
    'a chase aimed at a crawler on the edge strip ends just beside the frames',
  );
  rig.defense.destroy(west);
  rig.defense.destroy(east);
}

// ── Jobs ──────────────────────────────────────────────────────────────────

section('Jobs');
const woodWallPrice = rigPrice(upgradeCostOf('wood'));
/** A rig facing a bare stretch of the south wall, holding exactly a wooden wall's price. */
function wallJobRig(): { rig: Rig; id: string } {
  const rig = makeRig();
  const { id, tile } = southWallSegment();
  standAt(rig.human, tile.x, tile.y - 1, 0, 1);
  giveCost(rig.human, woodWallPrice);
  return { rig, id };
}
{
  const { rig, id } = wallJobRig();
  const shown = rig.construction.optionStatus('wood').cost;
  check(sameCost(shown, woodWallPrice), 'the menu quotes the price the builder pays');
  const started = rig.construction.startOption('wood');
  rig.construction.update();
  check(started && holdsExactly(rig, woodWallPrice), 'starting a wall takes nothing');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'wood' && holdsExactly(rig, {}),
    'finishing it takes the quoted price',
  );
  check(
    rig.human.craftSkills.getXp('construction') > 0 ||
      rig.human.craftSkills.getLevel('construction') > 1,
    'the builder earns Construction XP',
  );
  check(rig.cat.craftSkills.getXp('construction') === 0, 'the other crawler earns none');
}
{
  const { rig, id } = wallJobRig();
  rig.construction.startOption('wood');
  rig.construction.update();
  rig.human.x += TILE_SIZE / 4;
  rig.human.isMoving = true;
  rig.construction.update();
  check(
    rig.construction.job === null &&
      holdsExactly(rig, woodWallPrice) &&
      rig.defense.segmentTier(id) === 'fence',
    'walking off cancels with nothing lost',
  );
}
{
  const { rig, id } = wallJobRig();
  rig.construction.startOption('wood');
  rig.construction.update();
  rig.human.takeDamage(1);
  // A shove from the blow, with no step of his own.
  rig.human.x += 3;
  rig.human.isMoving = false;
  runJob(rig);
  check(rig.defense.segmentTier(id) === 'wood', 'being hit does not cancel the job');
}
{
  const { rig, id } = wallJobRig();
  rig.construction.startOption('wood');
  rig.construction.update();
  for (const id of RESOURCE_IDS) rig.human.inventory.removeItems(id, woodWallPrice[id] ?? 0);
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'fence' &&
      rig.messages.includes('You no longer have the materials.'),
    'running out mid-build fails cleanly',
  );
}
{
  // The wall is breached while an upgrade is being hammered on: nothing is
  // spent and nothing is built.
  const { rig, id } = wallJobRig();
  const ref = { kind: 'segment', id } as const;
  rig.defense.applyUpgrade(ref, 'human');
  const stoneWallPrice = rigPrice(upgradeCostOf('stone'));
  topUpTo(rig, stoneWallPrice);
  const heldBefore = Object.fromEntries(RESOURCE_IDS.map((id) => [id, partyHolds(rig, id)]));
  rig.construction.startOption('stone');
  rig.construction.update();
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'breach' && holdsExactly(rig, heldBefore),
    'an upgrade whose wall is breached mid-job spends nothing and builds nothing',
  );
}
{
  // Spikes started on a wall that falls before they are nailed on.
  const { rig, id } = wallJobRig();
  const ref = { kind: 'segment', id } as const;
  rig.defense.applyUpgrade(ref, 'human');
  teach(rig.human, SPIKES_TEST_LEVEL);
  rig.construction.startSpikes(ref);
  rig.construction.update();
  const boardsBefore = partyHolds(rig, 'wood_board');
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    partyHolds(rig, 'wood_board') === boardsBefore && rig.defense.record(ref)?.spikesHp === null,
    'spikes whose wall falls mid-job spend nothing',
  );
}
{
  // A repair priced for a scratch, and the wall breached before it finishes:
  // the bill is the breach's, not the scratch's.
  const { rig, id } = wallJobRig();
  const ref = { kind: 'segment', id } as const;
  rig.defense.applyUpgrade(ref, 'human');
  rig.defense.damage(ref, 1, null, 'blast');
  for (const id of RESOURCE_IDS) rig.human.inventory.removeItems(id, partyHolds(rig, id));
  const scratchPrice = rigPrice(repairChunkOf('wood'));
  giveCost(rig.human, scratchPrice);
  rig.construction.startRepair(ref);
  rig.construction.update();
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'breach' && holdsExactly(rig, scratchPrice),
    "a scratch repair cannot stand a breach back up for a scratch's price",
  );
  topUpTo(rig, rigPrice(scaleCost(repairChunkOf('wood'), REPAIR_CHUNKS_PER_FULL_REPAIR)));
  rig.construction.startRepair(ref);
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'wood' && holdsExactly(rig, {}),
    'paid in full, the breach is repaired',
  );
}

// ── Spikes ────────────────────────────────────────────────────────────────

section('Spikes');
{
  const { rig, id } = wallJobRig();
  const woodMax = woodMaxFor(id);
  const ref = { kind: 'segment', id } as const;
  rig.defense.applyUpgrade(ref, 'human');
  teach(rig.human, 4);
  check(!rig.construction.startSpikes(ref), 'spikes are locked below Construction 5');
  teach(rig.human, 5);
  giveCost(rig.human, SPIKES_COST);
  check(rig.construction.startSpikes(ref), 'spikes unlock at Construction 5');
  runJob(rig);
  const spikesMax = rig.defense.spikesMaxHp(ref);
  const attacker = new Rat(0, 0, TILE_SIZE);
  const hpBefore = attacker.hp;
  const blow = 100;
  rig.defense.damage(ref, blow, attacker, 'melee');
  check(
    rig.defense.record(ref)?.spikesHp === spikesMax - blow && rig.defense.hp(ref) === woodMax,
    'spikes take a blow first',
  );
  check(attacker.hp < hpBefore, 'a melee attacker is hurt by the thorns');
  const archer = new Rat(0, 0, TILE_SIZE);
  const archerHp = archer.hp;
  rig.defense.damage(ref, blow, archer, 'ranged');
  check(archer.hp === archerHp, 'a ranged attacker is not');
  const overflow = blow - (spikesMax - blow);
  check(
    rig.defense.record(ref)?.spikesHp === null && rig.defense.hp(ref) === woodMax - overflow,
    `the overflow (${overflow}) reaches the wall`,
  );
}

// ── Dynamite ──────────────────────────────────────────────────────────────

section('Dynamite');
{
  const rig = makeRig();
  const bottom = site.palisadeBounds.y + site.palisadeBounds.h - 1;
  const southSegments = site.segments.filter((segment) =>
    segment.tiles.every((tile) => tile.y === bottom),
  );
  const [first, second] = southSegments.filter((segment) => segment.tiles.length >= 2);
  if (first === undefined || second === undefined) {
    check(false, 'two adjacent south-wall segments to blast');
  } else {
    for (const segment of [first, second])
      rig.defense.applyUpgrade({ kind: 'segment', id: segment.id }, 'human');
    const lastOfFirst = first.tiles[first.tiles.length - 1];
    const centreX = (lastOfFirst.x + 1) * TILE_SIZE;
    const centreY = (lastOfFirst.y + 0.5) * TILE_SIZE;
    const firstMax = woodMaxFor(first.id);
    const secondMax = woodMaxFor(second.id);
    rig.defense.blastInRadius(centreX, centreY, TILE_SIZE * 1.6);
    const hp = (id: string) => rig.defense.hp({ kind: 'segment', id });
    check(
      hp(first.id) === firstMax - STRUCTURE_BLAST_DAMAGE &&
        hp(second.id) === secondMax - STRUCTURE_BLAST_DAMAGE,
      `one blast deals ${STRUCTURE_BLAST_DAMAGE} to each segment it touches, once each`,
    );
    // How many blasts a wooden wall this long takes to breach, from its own
    // (length-scaled) max HP rather than a number tied to the old fixed length.
    const blastsToBreach = Math.ceil(firstMax / STRUCTURE_BLAST_DAMAGE);
    for (let blast = 1; blast < blastsToBreach - 1; blast++) {
      rig.defense.blastInRadius(centreX, centreY, TILE_SIZE * 1.6);
    }
    check(
      rig.defense.segmentTier(first.id) !== 'breach',
      `a wooden wall survives ${blastsToBreach - 1} blasts of ${STRUCTURE_BLAST_DAMAGE}`,
    );
    rig.defense.blastInRadius(centreX, centreY, TILE_SIZE * 1.6);
    check(
      rig.defense.segmentTier(first.id) === 'breach',
      `and falls to blast number ${blastsToBreach}`,
    );
  }
}
{
  const rig = makeRig();
  const patch = openPatch();
  const trebuchet = rig.defense.placeTrebuchet(patch.x, patch.y - 3, 'human');
  // Built by a level-15 crawler so it has HP to spare: a 40 HP snare would just break.
  teach(rig.cat, MAX_CONSTRUCTION_LEVEL);
  const snare = rig.defense.placeSnare(patch.x + 3, patch.y, 'cat');
  const trebuchetHp = rig.defense.hp(trebuchet);
  const snareHp = rig.defense.hp(snare);
  rig.defense.blastInRadius((patch.x + 2) * TILE_SIZE, (patch.y - 0.5) * TILE_SIZE, TILE_SIZE * 2);
  check(
    rig.defense.hp(trebuchet) === trebuchetHp - STRUCTURE_BLAST_DAMAGE,
    `a trebuchet in the blast loses exactly ${STRUCTURE_BLAST_DAMAGE}`,
  );
  check(
    rig.defense.hp(snare) === snareHp - STRUCTURE_BLAST_DAMAGE,
    `a snare in the blast loses exactly ${STRUCTURE_BLAST_DAMAGE}`,
  );
  rig.defense.destroy(trebuchet);
  rig.defense.destroy(snare);
}

// ── Persistence ───────────────────────────────────────────────────────────

section('Persistence');
function palisadeSnapshot(map: GameMap, mapSite: BriarHollowSite): string {
  const parts: string[] = [];
  for (const tile of mapSite.palisadePath) {
    const content = map.structure[tile.y][tile.x];
    parts.push(
      `${content.type}:${content.wallTier ?? '-'}:${content.damageStage ?? 0}:${content.wallSpiked === true ? 's' : '-'}`,
    );
  }
  parts.push([...map.structureTileKeys()].sort((a, b) => a - b).join(','));
  return parts.join('|');
}
{
  const state = createBriarHollowState();
  const rig = makeRig(state);
  teach(rig.human, 6);
  const segments = site.segments;
  const damaged = { kind: 'segment', id: segments[5].id } as const;
  const spiked = { kind: 'segment', id: segments[9].id } as const;
  rig.defense.applyUpgrade(damaged, 'human');
  rig.defense.damage(damaged, 70, null, 'blast');
  rig.defense.applyUpgrade(spiked, 'human');
  rig.defense.applyUpgrade(spiked, 'human');
  rig.defense.applySpikes(spiked, 'cat');
  const patch = openPatch();
  const trebuchet = rig.defense.placeTrebuchet(patch.x, patch.y - 3, 'human');
  const record = rig.defense.trebuchet(trebuchet.kind === 'trebuchet' ? trebuchet.key : '');
  if (record !== null) record.ammo = 12;
  rig.defense.placeSnare(patch.x + 3, patch.y, 'cat');
  const expected = palisadeSnapshot(gameMap, site);

  const rebuilt = makeRig(state);
  rebuilt.defense.syncMap();
  check(palisadeSnapshot(gameMap, site) === expected, 'a scene rebuild leaves the map as it was');

  const checkpoint = captureBriarHollowState(state);
  rig.defense.damage(spiked, 5000, null, 'blast');
  rig.defense.destroy(trebuchet);
  restoreBriarHollowState(state, checkpoint);
  rig.defense.update(0);
  check(palisadeSnapshot(gameMap, site) === expected, 'a death rewind puts the map back');

  const saved = JSON.parse(JSON.stringify(captureBriarHollowState(state)));
  const parsed = parseBriarHollowStateSnapshot(saved);
  const reloadedMap = new GameMap({
    mapSize: MAP_SIZE,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: WORLD_SEED,
  });
  const reloadedState = createBriarHollowState();
  if (parsed !== undefined) restoreBriarHollowState(reloadedState, parsed);
  const reloaded = makeRig(reloadedState, reloadedMap);
  reloaded.defense.syncMap();
  const reloadedSite = reloadedMap.briarHollow ?? site;
  check(
    parsed !== undefined && palisadeSnapshot(reloadedMap, reloadedSite) === expected,
    'a page reload rebuilds the same map',
  );
  const reloadedTrebuchet = reloaded.defense.trebuchets[0];
  check(reloadedTrebuchet?.ammo === 12, 'a trebuchet keeps its ammunition through a reload');
  check(reloaded.defense.record(spiked)?.spikesBy === 'cat', 'spikes remember who added them');
}

// ── Long-press on a structure ─────────────────────────────────────────────

section('Long-press');
{
  const patch = openPatch();
  const pm = new PlayerManager(patch.x, patch.y, undefined);
  const world: SceneWorld = {
    gameMap,
    bus: new EventBus(),
    audio: null,
    audioScope: null,
    pm,
    roster: new MobRoster(gameMap, new SpellSystem()),
  };
  const menus = new MenusKit({
    world,
    abilityManager: new AbilityManager(),
    petNames: new PetNameBook(),
  });
  const state = createBriarHollowState();
  grantConstructionUnlocks(state.unlocks, CONSTRUCTION_UNLOCK_IDS);
  teach(pm.human, RIG_BUILDER_LEVEL);
  pm.human.isActive = true;
  pm.cat.isActive = false;
  const kit = new ConstructionKit({
    world,
    site,
    human: pm.human,
    cat: pm.cat,
    state,
    menus,
    audio: null,
    noteResourceActivity: () => undefined,
    onTileChanged: () => undefined,
    villagers: () => [],
    clockSeconds: () => 0,
    isInSafeRoom: () => false,
    worldHalted: () => false,
  });
  const snare = kit.defense.placeSnare(patch.x + 1, patch.y, 'human');
  const camX = (patch.x - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  const camY = (patch.y - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  const fingerX = (patch.x + 1.5) * TILE_SIZE - camX;
  const fingerY = (patch.y + 0.5) * TILE_SIZE - camY;
  check(
    kit.isStructureUnderFinger(fingerX, fingerY, camX, camY),
    'a finger resting on a snare a tile away is on a structure, so the hold does not walk the crawler',
  );
  check(
    kit.handleLongPress(fingerX, fingerY, camX, camY) && kit.isMenuOpen,
    'and the long-press opens its Structure menu',
  );
  kit.closeAllPanels();
  const emptyX = (patch.x - 1.5) * TILE_SIZE - camX;
  check(
    !kit.isStructureUnderFinger(emptyX, fingerY, camX, camY),
    'a finger on open ground is not, so holding there still walks',
  );
  const farSnare = kit.defense.placeSnare(patch.x + FAR_SNARE_TILES, patch.y, 'human');
  const farX = (patch.x + FAR_SNARE_TILES + 0.5) * TILE_SIZE - camX;
  check(
    !kit.isStructureUnderFinger(farX, fingerY, camX, camY),
    'a snare out of reach is not, so holding on it still walks the crawler there',
  );
  const gateTile = site.gate.tiles[0];
  standAt(pm.human, gateTile.x, gateTile.y - 1, 0, 1);
  const gateCamX = (gateTile.x - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  const gateCamY = (gateTile.y - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  check(
    !kit.isStructureUnderFinger(
      (gateTile.x + 0.5) * TILE_SIZE - gateCamX,
      (gateTile.y + 0.5) * TILE_SIZE - gateCamY,
      gateCamX,
      gateCamY,
    ),
    'the gate is not, so holding on it still walks',
  );
  // The finger-on-the-art allowance reaches one tile up only for what stands
  // tall. A snare, the gate and a fallen wall are flat: a finger just above
  // one is on open ground.
  const aboveSnareY = (patch.y - 0.5) * TILE_SIZE - camY;
  standAt(pm.human, patch.x, patch.y, 1, 0);
  check(
    !kit.isStructureUnderFinger(fingerX, aboveSnareY, camX, camY),
    'a finger a tile above a snare is not on it',
  );
  standAt(pm.human, gateTile.x, gateTile.y - 2, 0, 1);
  check(
    !kit.isStructureUnderFinger(
      (gateTile.x + 0.5) * TILE_SIZE - gateCamX,
      (gateTile.y - 0.5) * TILE_SIZE - gateCamY,
      gateCamX,
      gateCamY,
    ),
    'a finger a tile above the gate is not on it',
  );
  const { id: fallenId, tile: fallenTile } = southWallSegment();
  const fallen = { kind: 'segment', id: fallenId } as const;
  kit.defense.applyUpgrade(fallen, 'human');
  const standingCamX = (fallenTile.x - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  const standingCamY = (fallenTile.y - LONG_PRESS_VIEW_TILES) * TILE_SIZE;
  const aboveWallX = (fallenTile.x + 0.5) * TILE_SIZE - standingCamX;
  const aboveWallY = (fallenTile.y - 0.5) * TILE_SIZE - standingCamY;
  standAt(pm.human, fallenTile.x - 1, fallenTile.y - 1, 1, 0);
  check(
    kit.isStructureUnderFinger(aboveWallX, aboveWallY, standingCamX, standingCamY),
    'a finger on the art just above a standing wall is on the wall',
  );
  kit.defense.damage(fallen, 10000, null, 'blast');
  check(
    !kit.isStructureUnderFinger(aboveWallX, aboveWallY, standingCamX, standingCamY),
    'a finger a tile above a fallen wall is not on it',
  );
  kit.defense.applyRepair(fallen);
  // A walk that began on open ground stays a walk when the camera slides a
  // structure under the still finger; a hold that began on one stays a hold
  // only while the finger stays put.
  const hold = new StructureHold();
  hold.begin(false, fingerX, fingerY);
  check(
    !hold.suppressesWalk(fingerX, fingerY, HOLD_STILL_PX),
    'a hold that began on open ground always walks',
  );
  hold.begin(true, fingerX, fingerY);
  check(
    hold.suppressesWalk(fingerX + 1, fingerY, HOLD_STILL_PX),
    'a hold that began on a structure does not walk',
  );
  check(
    !hold.suppressesWalk(fingerX + HOLD_STILL_PX * 2, fingerY, HOLD_STILL_PX),
    'until the finger moves off',
  );
  hold.end();
  check(!hold.suppressesWalk(fingerX, fingerY, HOLD_STILL_PX), 'and the lift clears it');
  kit.defense.destroy(snare);
  kit.defense.destroy(farSnare);
  kit.dispose();
}

// ── The build key over a faced wall ───────────────────────────────────────

section('The build key over a faced wall');
{
  const { id, tile } = southWallSegment();
  const pm = new PlayerManager(tile.x, tile.y - 1, undefined);
  const world: SceneWorld = {
    gameMap,
    bus: new EventBus(),
    audio: null,
    audioScope: null,
    pm,
    roster: new MobRoster(gameMap, new SpellSystem()),
  };
  const menus = new MenusKit({
    world,
    abilityManager: new AbilityManager(),
    petNames: new PetNameBook(),
  });
  const state = createBriarHollowState();
  grantConstructionUnlocks(state.unlocks, CONSTRUCTION_UNLOCK_IDS);
  teach(pm.human, RIG_BUILDER_LEVEL);
  pm.human.isActive = true;
  pm.cat.isActive = false;
  const kit = new ConstructionKit({
    world,
    site,
    human: pm.human,
    cat: pm.cat,
    state,
    menus,
    audio: null,
    noteResourceActivity: () => undefined,
    onTileChanged: () => undefined,
    villagers: () => [],
    clockSeconds: () => 0,
    isInSafeRoom: () => false,
    worldHalted: () => false,
  });
  standAt(pm.human, tile.x, tile.y - 1, 0, 1);
  giveCost(pm.human, rigPrice(upgradeCostOf('wood')));
  check(kit.isWallPromptShowing(), 'facing a bare wall, the build prompt shows');
  check(
    !kit.tryBuildWall(true) && kit.construction.job === null,
    'a world tap never builds: only the double tap the touch prompt names does',
  );
  check(
    kit.tryBuildWall(false) && kit.construction.job !== null,
    'a key press builds on any device, so a touch laptop honours "Press Space"',
  );
  check(kit.defense.segmentTier(id) !== 'wood', 'and the wall is still only being raised');
  kit.dispose();
}

// ── Defend-quest grate spikes ─────────────────────────────────────────────

section('Defend-quest grate spikes');
{
  const size = 12;
  const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
  const dungeon = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  const quest = new DefendQuestSystem(
    dungeon,
    new EventBus(),
    () => undefined,
    new Conversation(null),
    () => 1,
    undefined,
  );
  const grate = { x: 5, y: 5 };
  const barrierMaxHp = 36;
  const human = new HumanPlayer(grate.x, grate.y + 1, TILE_SIZE);
  const cat = new CatPlayer(grate.x + 1, grate.y + 1, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  const roster = new MobRoster(dungeon, new SpellSystem());
  // One idle tick to introduce the party, before the wave is put in place: a
  // live wave with no nursery on this bare map would call itself off.
  quest.update({
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: dungeon,
  });
  const snapshot = quest.captureCheckpoint();
  quest.restoreCheckpoint({
    ...snapshot,
    phase: 'defending',
    barriers: [
      {
        tileX: grate.x,
        tileY: grate.y,
        worldX: grate.x * TILE_SIZE,
        worldY: grate.y * TILE_SIZE,
        hp: barrierMaxHp,
        maxHp: barrierMaxHp,
        grateIdx: 0,
        hitFlash: 0,
      },
    ],
  });
  const messages: string[] = [];
  const menu = new GrateSpikesMenu({
    defendQuest: quest,
    human,
    cat,
    audio: null,
    announce: (m) => messages.push(m),
  });

  check(!menu.tryOpen(), 'a save that never learned Construction gets no grate menu');
  teach(human, 4);
  check(!menu.tryOpen(), 'Construction 4 gets no grate menu either');
  teach(human, 5);
  check(menu.tryOpen(), 'Construction 5 opens the grate menu beside a boarded grate');
  const grateSpikesPrice = discountedCost(SPIKES_COST, SPIKES_TEST_LEVEL);
  const barricadeBoards = Math.max(1, grateSpikesPrice.wood_board ?? 0);
  human.inventory.addItem('quest_wood_board', barricadeBoards);
  check(
    !menu.addSpikes() && human.inventory.countOf('quest_wood_board') === barricadeBoards,
    'Barricade Boards do not pay for spikes',
  );
  giveCost(human, grateSpikesPrice);
  const spiked = menu.addSpikes();
  const barrierNow = () => quest.captureCheckpoint().barriers[0];
  check(
    spiked && RESOURCE_IDS.every((id) => human.inventory.countOf(id) === 0),
    'spikes on a grate cost what spikes on a wall cost',
  );
  check(
    GRATE_SPIKES_BASE_HP === EXPECTED_SPIKES_HP,
    `grate spikes hold ${EXPECTED_SPIKES_HP} HP, as a wall's do`,
  );
  check(
    (barrierNow()?.spikesHp ?? 0) === GRATE_SPIKES_BASE_HP,
    `the grate carries ${GRATE_SPIKES_BASE_HP} HP of spikes`,
  );

  const bugaboo = new Bugaboo(grate.x, grate.y - 1, TILE_SIZE);
  const bugHp = bugaboo.hp;
  const claw = 10;
  quest.damageBarrier(grate, claw, bugaboo);
  check(
    barrierNow()?.hp === barrierMaxHp && barrierNow()?.spikesHp === GRATE_SPIKES_BASE_HP - claw,
    "the spikes take a clawing bugaboo's blow before the boards",
  );
  check(bugaboo.hp < bugHp, 'and the bugaboo takes it back');
  quest.damageBarrier(grate, GRATE_SPIKES_BASE_HP, bugaboo);
  const overflow = GRATE_SPIKES_BASE_HP - (GRATE_SPIKES_BASE_HP - claw);
  check(
    barrierNow()?.spikesHp === undefined && barrierNow()?.hp === barrierMaxHp - overflow,
    'once the spikes are gone the overflow reaches the boards',
  );
}

// ── Bell tower repair ────────────────────────────────────────────────────

section('Bell tower repair');
const bellRepairPrice = rigPrice(BELL_TOWER_REPAIR_COST);
{
  const rig = makeRig();
  rig.state.quest.bellTowerBroken = true;
  rig.state.quest.phase = 'repair_bell';
  const bellTile = site.square.bellTile;
  // Just outside the tower's own footprint, but within repair reach of it.
  standAt(rig.human, bellTile.x - 1, bellTile.y, 1, 0);
  giveCost(rig.human, bellRepairPrice);
  rig.human.coins = BELL_TOWER_REPAIR_COINS;
  check(
    sameCost(
      rig.construction.repairCostFor({ kind: 'bellTower' }, rig.human) ?? {},
      bellRepairPrice,
    ),
    'the repair quotes the price it charges',
  );

  // The same entry point the repair key calls.
  rig.construction.repairOrLoad(STRUCTURE_REACH_TILES);
  runJob(rig);

  check(!rig.state.quest.bellTowerBroken, 'the repair key mends a broken tower it stands beside');
  check(holdsExactly(rig, {}), 'the repair spends its materials');
  check(rig.human.coins + rig.cat.coins === 0, 'the repair spends its coins from the purse');
}
{
  // A player short on coins alone: the repair must not silently succeed, and
  // must not spend the materials it could not finish paying for.
  const rig = makeRig();
  rig.state.quest.bellTowerBroken = true;
  rig.state.quest.phase = 'repair_bell';
  const bellTile = site.square.bellTile;
  standAt(rig.human, bellTile.x - 1, bellTile.y, 1, 0);
  giveCost(rig.human, bellRepairPrice);
  rig.human.coins = BELL_TOWER_REPAIR_COINS - 1;
  rig.cat.coins = 0;

  rig.construction.repairOrLoad(STRUCTURE_REACH_TILES);
  runJob(rig);

  check(rig.state.quest.bellTowerBroken, 'one coin short, the tower stays broken');
  check(holdsExactly(rig, bellRepairPrice), 'one coin short, the materials are not spent');
  check(
    rig.messages.includes('Insufficient money.'),
    'one coin short, the party is told why the repair failed',
  );
}
{
  // Lost, but the Mayor has not yet asked for the rebuild: mending it now
  // would leave the quest's repair step waiting on a tower already whole.
  const rig = makeRig();
  rig.state.quest.bellTowerBroken = true;
  rig.state.quest.phase = 'repelled_failed';
  const bellTile = site.square.bellTile;
  standAt(rig.human, bellTile.x - 1, bellTile.y, 1, 0);
  giveCost(rig.human, bellRepairPrice);
  rig.human.coins = BELL_TOWER_REPAIR_COINS;

  rig.construction.repairOrLoad(STRUCTURE_REACH_TILES);
  runJob(rig);

  check(
    rig.state.quest.bellTowerBroken,
    'before the Mayor asks, the repair key leaves the tower broken',
  );
  check(holdsExactly(rig, bellRepairPrice), 'before the Mayor asks, nothing is spent');
  check(!rig.defense.bellTowerRepairable, 'before the Mayor asks, the tower is not repairable');
}

console.log(
  `\n${checks - failures}/${checks} checks passed${fault === null ? '' : ` (fault: ${fault})`}`,
);
if (failures > 0) {
  console.error(`verify:construction FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:construction passed');
