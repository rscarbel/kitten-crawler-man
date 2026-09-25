#!/usr/bin/env tsx
/**
 * Headless gate on Construction, run against a real floor-3 `GameMap` with
 * Briar Hollow on it: the number tables, the palisade segments, the gate,
 * placement and its push-out and no-trap guarantees, build jobs, spikes,
 * dynamite, and persistence through a rebuild, a rewind and a reload.
 *
 * The expected numbers are written out here from the original request's
 * wording, not imported from the module under test, so a rule that drifts
 * from the request fails rather than agreeing with itself.
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
} from '../src/core/briarHollowState';
import { spend } from '../src/core/partyResources';
import { PlayerManager } from '../src/core/PlayerManager';
import { AbilityManager } from '../src/core/AbilityManager';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { ConstructionKit } from '../src/systems/briarHollow/ConstructionKit';
import { StructureHold } from '../src/systems/briarHollow/structureHold';
import type { SceneWorld } from '../src/systems/kits/SceneWorld';
import { Bugaboo } from '../src/creatures/Bugaboo';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem';
import { GRATE_SPIKES_BASE_HP, GrateSpikesMenu } from '../src/systems/GrateSpikesMenu';
import type { CrawlerKind } from '../src/core/SkillManager';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Rat } from '../src/creatures/Rat';
import { Cow } from '../src/creatures/Cow';
import { Mongo } from '../src/creatures/Mongo';
import { GameMap } from '../src/map/GameMap';
import {
  FloorTypeValue,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  HOLLOW_THRESHOLD,
  type TileContent,
} from '../src/map/tileTypes';
import { tileCoordKey } from '../src/map/tileIndex';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import type { SystemContext } from '../src/systems/GameSystem';
import { applyMovement } from '../src/systems/GameLoopPhases';
import { DefenseStructures, structureKey } from '../src/systems/briarHollow/DefenseStructures';
import {
  ConstructionSystem,
  type PushableBody,
} from '../src/systems/briarHollow/ConstructionSystem';
import { crawlerPushBody, mobPushBody } from '../src/systems/briarHollow/ConstructionKit';
import {
  NO_SPACE_MESSAGE,
  doorwayTiles,
  planTrebuchetPushOut,
  pushOutTile,
  tileRefusal,
  villagerAnchorKeys,
} from '../src/systems/briarHollow/constructionPlacement';
import {
  STRUCTURE_BLAST_DAMAGE,
  WALL_TIERS,
  discountedCost,
  jobFrames,
  repairChunks,
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
/** The request's spikes: 150 health on walls, trebuchets and defense-quest grates alike. */
const EXPECTED_SPIKES_HP = 150;

// ── The request's own numbers ─────────────────────────────────────────────

const EXPECTED_TIERS = {
  fence: { hp: 1 },
  wood: { hp: 150, cost: { wood_board: 5 }, build: 3, repairChunk: { wood_board: 1 }, repair: 1.5 },
  stone: { hp: 450, cost: { stone: 5 }, build: 4, repairChunk: { stone: 1 }, repair: 2 },
  fortified: {
    hp: 1000,
    cost: { stone: 8, wood_board: 2 },
    build: 5,
    repairChunk: { stone: 2 },
    repair: 2.5,
  },
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
  const bus = new EventBus();
  const roster = new MobRoster(map, new SpellSystem());
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  teach(human, 1);
  teach(cat, 1);
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
    announce: (message) => messages.push(message),
    noteResourceActivity: () => undefined,
    bodies: () => {
      const bodies: PushableBody[] = [crawlerPushBody(human), crawlerPushBody(cat)];
      for (const mob of roster.mobs) if (mob.isAlive) bodies.push(mobPushBody(mob, roster));
      return bodies;
    },
    indoors: false,
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

function give(
  crawler: HumanPlayer | CatPlayer,
  id: 'wood_board' | 'stone' | 'rope',
  count: number,
): void {
  crawler.inventory.addItem(id, count);
}

function boardsHeld(rig: Rig): number {
  return rig.human.inventory.countOf('wood_board') + rig.cat.inventory.countOf('wood_board');
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
  check(
    sameCost(actual.upgradeCost ?? {}, expected.cost),
    `${tier}: costs ${JSON.stringify(expected.cost)}`,
  );
  check(actual.buildSeconds === expected.build, `${tier}: builds in ${expected.build} s`);
  check(
    sameCost(actual.repairChunkCost ?? {}, expected.repairChunk),
    `${tier}: repairs ${JSON.stringify(expected.repairChunk)} per chunk`,
  );
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
check(
  sameCost(discountedCost({ wood_board: 1 }, 9), { wood_board: 1 }),
  'L9: a 1-board line is not discounted',
);
check(sameCost(discountedCost({ wood_board: 1 }, 10), {}), 'L10: a 1-board line drops');
check(sameCost(discountedCost({ stone: 2 }, 13), { stone: 1 }), 'L13: a 2-stone line costs 1');
check(sameCost(discountedCost({ stone: 2 }, 14), {}), 'L14: a 2-stone line drops');
check(
  sameCost(discountedCost({ stone: 8, wood_board: 2 }, 14), { stone: 6 }),
  'L14: fortified costs 6 stone',
);
// `repairChunks` is a fraction of max HP, so any consistent max stands in — the
// tier's own reference number, not a real segment's (which now varies by length).
const CHUNK_TEST_MAX = WALL_TIERS.wood.baseHp;
check(repairChunks(CHUNK_TEST_MAX * 0.01, CHUNK_TEST_MAX) === 1, 'repair chunks: 1% missing is 1');
check(repairChunks(CHUNK_TEST_MAX * 0.2, CHUNK_TEST_MAX) === 1, 'repair chunks: 20% missing is 1');
check(repairChunks(CHUNK_TEST_MAX * 0.21, CHUNK_TEST_MAX) === 2, 'repair chunks: 21% missing is 2');
check(repairChunks(CHUNK_TEST_MAX * 0.99, CHUNK_TEST_MAX) === 5, 'repair chunks: 99% missing is 5');
check(repairChunks(CHUNK_TEST_MAX, CHUNK_TEST_MAX) === 5, 'repair chunks: 100% missing is 5');
check(
  sameCost(trebuchetRepairCost(99, 100, false), { wood_board: 3, rope: 1 }),
  'trebuchet repair: a scratch is one unit',
);
check(
  sameCost(trebuchetRepairCost(50, 100, true), { wood_board: 12, rope: 4 }),
  'trebuchet repair: broken at half is 4 units',
);
check(
  sameCost(trebuchetRepairCost(0, 100, true), { wood_board: 15, rope: 5 }),
  'trebuchet repair: broken at 0 is capped at the build cost',
);

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
    sameCost(woodRig.defense.repairCost(ref) ?? {}, { wood_board: 5 }),
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

  const pushedNorth = (mob: Rat | Cow | Mongo): boolean => {
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
  const mongo = new Mongo(outside.x, outside.y, TILE_SIZE, rig.cat, 1, 100);
  mongo.setMap(gameMap);
  check(pushedNorth(mongo), 'Mongo crosses the gate');

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
  give(rig.human, 'wood_board', 60);
  give(rig.human, 'rope', 20);
  // Builder faces north: the trebuchet goes up in the three rows above him.
  standAt(rig.human, patch.x, patch.y, 0, -1);
  standAt(rig.cat, patch.x + 3, patch.y + 2, 0, 1);
  const planned = rig.construction.plannedFootprint(rig.human, 'trebuchet');
  const footprint = planned.footprint;
  const rat = new Rat(footprint.x, footprint.y, TILE_SIZE);
  const cow = new Cow(footprint.x + 1, footprint.y + 1, TILE_SIZE, 'holstein', 'adult');
  const mongo = new Mongo(footprint.x, footprint.y + 2, TILE_SIZE, rig.cat, 1, 100);
  rig.roster.add(rat);
  rig.roster.add(cow);
  rig.roster.add(mongo);
  const started = rig.construction.startOption('trebuchet');
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
    rig.construction.update();
    for (const mob of [rat, cow, mongo]) mob.advanceKnockback();
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
  check(!inside(mongo) && onGround(mongo), 'the companion is pushed clear onto open ground');
  check(
    !gameMap.isWalkable(footprint.x, footprint.y),
    'the footprint is reserved while it goes up',
  );
  rig.construction.cancelJob();
  check(
    gameMap.isWalkable(footprint.x, footprint.y),
    'a cancelled trebuchet releases its footprint',
  );
  for (const mob of [rat, cow, mongo]) {
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
  give(rig.human, 'wood_board', 60);
  give(rig.human, 'rope', 20);
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
  give(rig.human, 'wood_board', 60);
  give(rig.human, 'rope', 20);
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
  give(rig.human, 'wood_board', 60);
  give(rig.human, 'rope', 20);
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

// ── Jobs ──────────────────────────────────────────────────────────────────

section('Jobs');
function wallJobRig(): { rig: Rig; id: string } {
  const rig = makeRig();
  const { id, tile } = southWallSegment();
  standAt(rig.human, tile.x, tile.y - 1, 0, 1);
  give(rig.human, 'wood_board', 5);
  return { rig, id };
}
{
  const { rig, id } = wallJobRig();
  const started = rig.construction.startOption('wood');
  rig.construction.update();
  check(started && boardsHeld(rig) === 5, 'starting a wall takes nothing');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'wood' && boardsHeld(rig) === 0,
    'finishing it takes the five boards',
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
      boardsHeld(rig) === 5 &&
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
  rig.human.inventory.removeItems('wood_board', 5);
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
  give(rig.human, 'stone', 5);
  rig.construction.startOption('stone');
  rig.construction.update();
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'breach' && rig.human.inventory.countOf('stone') === 5,
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
  const boardsBefore = boardsHeld(rig);
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    boardsHeld(rig) === boardsBefore && rig.defense.record(ref)?.spikesHp === null,
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
  rig.human.inventory.removeItems('wood_board', boardsHeld(rig));
  give(rig.human, 'wood_board', 1);
  rig.construction.startRepair(ref);
  rig.construction.update();
  rig.defense.damage(ref, 10000, null, 'blast');
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'breach' && boardsHeld(rig) === 1,
    'a scratch repair cannot stand a breach back up for one board',
  );
  give(rig.human, 'wood_board', 4);
  rig.construction.startRepair(ref);
  runJob(rig);
  check(
    rig.defense.segmentTier(id) === 'wood' && boardsHeld(rig) === 0,
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
  give(rig.human, 'wood_board', 1);
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
    pm,
    roster: new MobRoster(gameMap, new SpellSystem()),
  };
  const menus = new MenusKit({ world, abilityManager: new AbilityManager() });
  const state = createBriarHollowState();
  teach(pm.human, 1);
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
  human.inventory.addItem('quest_wood_board', 5);
  check(
    !menu.addSpikes() && human.inventory.countOf('quest_wood_board') === 5,
    'Barricade Boards do not pay for spikes',
  );
  give(human, 'wood_board', 1);
  const spiked = menu.addSpikes();
  const barrierNow = () => quest.captureCheckpoint().barriers[0];
  check(spiked && human.inventory.countOf('wood_board') === 0, 'spikes cost one Boards of Wood');
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

console.log(
  `\n${checks - failures}/${checks} checks passed${fault === null ? '' : ` (fault: ${fault})`}`,
);
if (failures > 0) {
  console.error(`verify:construction FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:construction passed');
