#!/usr/bin/env tsx
/**
 * Headless gate on Briar Hollow's own resource nodes, run on real floor-3
 * `GameMap`s: the quarry's deposits and dressed-stone stubs, the worked look,
 * quarry and grove regrowth (and that nothing outside the village regrows),
 * regrowth never trapping a body, the checkpoint rewind, the resource HUD's
 * work-yard zones, and the processing-machine lookup.
 *
 * Timings are written out here from the original request's numbers — 300 s
 * for a deposit, 240 s to a sapling and 60 s more to a tree, a 10 s retry —
 * not imported from the module under test.
 *
 * Run: npx tsx scripts/verify-village-nodes.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { ASSET_GROUPS } from '../src/core/assetGroups';
import { createBriarHollowState, type HarvestNodeState } from '../src/core/briarHollowState';
import { getManifestEntry } from '../src/core/SpriteLoader';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { GameMap } from '../src/map/GameMap';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level3 } from '../src/levels/level3';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { rectCentre } from '../src/map/overworld/briarHollowSite';
import {
  BOULDER_LARGE,
  BOULDER_SMALL,
  PROP_DAMAGE_STAGE_CRACKED,
  ROCK_DEPOSIT,
  RUBBLE,
  TREE,
} from '../src/map/tileTypes';
import { DRESSED_STONE_SPRITE_KEYS, rockDepositSpriteKey } from '../src/map/tiles/rockDepositTiles';
import { mulberry32 } from '../src/sprites/person/rng';
import { LootSystem } from '../src/systems/LootSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { TreeSystem } from '../src/systems/TreeSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { tileKey } from '../src/systems/tileKey';
import { harvestKindAt } from '../src/systems/briarHollow/harvestNodes';
import { NodeLedger } from '../src/systems/briarHollow/NodeLedger';
import { NodeRegrowth, type StandingBody } from '../src/systems/briarHollow/NodeRegrowth';
import { anyResourceZone, inGatheringDistrict } from '../src/systems/briarHollow/resourceZones';
import {
  processingStationInReach,
  processingStationsOf,
} from '../src/systems/briarHollow/processingStations';

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

// ── The request's own numbers ─────────────────────────────────────────────

const TICKS_PER_SECOND = 60;
/** A Resourcing level below every capacity perk. */
const UNPERKED_LEVEL = 1;
const EXPECTED_DEPOSIT_REGROW_TICKS = 300 * TICKS_PER_SECOND;
const EXPECTED_GROVE_SAPLING_TICKS = 240 * TICKS_PER_SECOND;
const EXPECTED_SAPLING_TO_TREE_TICKS = 60 * TICKS_PER_SECOND;
const EXPECTED_RETRY_TICKS = 10 * TICKS_PER_SECOND;
/** Slack for the tick a depletion is noticed on and the tree's half-second grow-in. */
const SCHEDULING_SLACK_TICKS = 2;
const GROW_IN_SLACK_TICKS = TICKS_PER_SECOND;
/** Longer than anything in the village takes, for "never regrows". */
const NEVER_TICKS = 400 * TICKS_PER_SECOND;
/** Enough felling-animation ticks for any tree to finish coming down. */
const FELLING_TICKS_LIMIT = 10 * TICKS_PER_SECOND;
const WORKED_FRACTION = 0.5;
const PROCESSING_REACH_TILES = 1.5;
/** How far either side of the reach the two probes stand. */
const REACH_PROBE_TILES = 0.1;
const FAR_TILES = 6;
const SITE_SEEDS = [424242, 7, 90210, 31337, 2024];
const TILE_CENTRE = 0.5;

// ── Maps ──────────────────────────────────────────────────────────────────

function buildMap(worldSeed: number): GameMap {
  return new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    dungeon: dungeonOptionsForLevel(level3),
    worldSeed,
  });
}

section('Quarry: deposits and ruined-wall stubs are minable deposits');
for (const seed of SITE_SEEDS) {
  const map = buildMap(seed);
  const site = map.briarHollow;
  if (site === null) {
    check(false, `seed ${seed}: the floor has a village`);
    continue;
  }
  const deposits = site.quarry.depositTiles;
  const stubs = site.quarry.stubTiles;
  const allDeposits = deposits.every(
    (tile) =>
      map.structure[tile.y][tile.x].type === ROCK_DEPOSIT &&
      harvestKindAt(map, tile.x, tile.y) === 'stone' &&
      !DRESSED_STONE_SPRITE_KEYS.some(
        (key) => key === rockDepositSpriteKey(map.structure[tile.y][tile.x], tile.x, tile.y),
      ),
  );
  check(
    deposits.length > 0 && allDeposits,
    `seed ${seed}: ${deposits.length} outcrops are stone nodes drawn as outcrops`,
  );
  const allStubs = stubs.every((tile) => {
    const content = map.structure[tile.y][tile.x];
    const key = rockDepositSpriteKey(content, tile.x, tile.y);
    return (
      content.type === ROCK_DEPOSIT &&
      harvestKindAt(map, tile.x, tile.y) === 'stone' &&
      DRESSED_STONE_SPRITE_KEYS.some((dressed) => dressed === key)
    );
  });
  check(
    stubs.length > 0 && allStubs,
    `seed ${seed}: ${stubs.length} wall stubs are stone nodes drawn as dressed stone`,
  );
}

section('Art: every deposit sheet has an intact and a worked row, and ships with floor 3');
{
  const keys = [
    'rock_deposit_a',
    'rock_deposit_b',
    'rock_deposit_c',
    'rock_deposit_dressed_a',
    'rock_deposit_dressed_b',
  ] as const;
  for (const key of keys) {
    const states = getManifestEntry(key).states;
    check('idle' in states && 'worked' in states, `${key} has idle and worked states`);
    check(
      ASSET_GROUPS.overworld.some((entry) => entry === key),
      `${key} is in the overworld asset group`,
    );
  }
}

// ── A rig on one map ──────────────────────────────────────────────────────

const gameMap = buildMap(SITE_SEEDS[0]);
const siteOrNull = gameMap.briarHollow;
if (siteOrNull === null) throw new Error('the gate map has no village');
const site: BriarHollowSite = siteOrNull;

interface Rig {
  readonly nodes: Map<string, HarvestNodeState>;
  readonly ledger: NodeLedger;
  readonly regrowth: NodeRegrowth;
  readonly trees: TreeSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly bodies: StandingBody[];
  /** Tiles a construction claims, by tile key: a snare's record, a job's reservation. */
  readonly claimed: Set<string>;
  readonly ctx: SystemContext;
}

function makeRig(): Rig {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  human.isActive = true;
  const nodes = createBriarHollowState().nodes;
  const trees = new TreeSystem(gameMap, new LootSystem(gameMap), level3.floorNumber);
  const ledger = new NodeLedger({
    gameMap,
    nodes,
    trees,
    bus: null,
    onTileChanged: () => undefined,
    capacityRng: mulberry32(1),
    onDepleted: () => undefined,
  });
  const bodies: StandingBody[] = [];
  const claimed = new Set<string>();
  const regrowth = new NodeRegrowth(
    {
      gameMap,
      nodes,
      onTileChanged: () => undefined,
      bodies: () => [human, cat, ...bodies],
      isTileClaimed: (tileX, tileY) => claimed.has(tileKey(tileX, tileY)),
    },
    site,
  );
  const roster = new MobRoster(gameMap, new SpellSystem());
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  };
  return { nodes, ledger, regrowth, trees, human, cat, bodies, claimed, ctx };
}

function tick(rig: Rig, count: number): void {
  for (let i = 0; i < count; i++) {
    rig.trees.update(rig.ctx);
    rig.regrowth.update();
  }
}

/** Ticks until `done` holds, or null within `limit`. */
function ticksUntil(rig: Rig, limit: number, done: () => boolean): number | null {
  for (let i = 1; i <= limit; i++) {
    tick(rig, 1);
    if (done()) return i;
  }
  return null;
}

function typeAt(tile: { x: number; y: number }): number {
  return gameMap.structure[tile.y][tile.x].type;
}

function spendOut(rig: Rig, tile: { x: number; y: number }): void {
  let guard = 0;
  while (rig.ledger.stateAt(tile.x, tile.y, UNPERKED_LEVEL) !== null && guard++ < 1000) {
    rig.ledger.spend(tile.x, tile.y, UNPERKED_LEVEL);
  }
}

function standOn(body: { x: number; y: number }, tile: { x: number; y: number }): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

const deposit = site.quarry.depositTiles[0];
const stub = site.quarry.stubTiles[0];

section('Worked look: a deposit past half its capacity shows it');
{
  const rig = makeRig();
  const state = rig.ledger.stateAt(deposit.x, deposit.y, UNPERKED_LEVEL);
  if (state === null) {
    check(false, 'the deposit is a node');
  } else {
    let lookAlwaysRight = true;
    while (state.remaining > 1) {
      rig.ledger.spend(deposit.x, deposit.y, UNPERKED_LEVEL);
      const worn =
        gameMap.structure[deposit.y][deposit.x].damageStage === PROP_DAMAGE_STAGE_CRACKED;
      const shouldBe = state.remaining < state.capacity * WORKED_FRACTION;
      if (worn !== shouldBe) lookAlwaysRight = false;
    }
    check(lookAlwaysRight, `worked look tracks "below half" over all ${state.capacity} harvests`);
    const checkpoint = rig.ledger.captureCheckpoint();
    rig.ledger.spend(deposit.x, deposit.y, UNPERKED_LEVEL);
    tick(rig, EXPECTED_DEPOSIT_REGROW_TICKS + SCHEDULING_SLACK_TICKS);
    check(
      typeAt(deposit) === ROCK_DEPOSIT &&
        gameMap.structure[deposit.y][deposit.x].damageStage === undefined,
      'a regrown deposit stands intact, not worked',
    );
    rig.ledger.restoreCheckpoint(checkpoint);
    rig.regrowth.reconcileAfterRestore();
    check(
      gameMap.structure[deposit.y][deposit.x].damageStage === PROP_DAMAGE_STAGE_CRACKED,
      'a rewind puts the worked look back with the rewound capacity',
    );
    rig.nodes.clear();
    delete gameMap.structure[deposit.y][deposit.x].damageStage;
  }
}

section('Quarry regrowth: a worked-out deposit stands again after 300 s');
for (const [label, tile] of [
  ['outcrop', deposit],
  ['wall stub', stub],
] as const) {
  const rig = makeRig();
  const spriteKeyBefore = gameMap.structure[tile.y][tile.x].spriteKey;
  spendOut(rig, tile);
  check(typeAt(tile) === RUBBLE, `${label}: crumbles to rubble when worked out`);
  const took = ticksUntil(
    rig,
    EXPECTED_DEPOSIT_REGROW_TICKS + SCHEDULING_SLACK_TICKS,
    () => typeAt(tile) === ROCK_DEPOSIT,
  );
  check(
    took !== null &&
      took >= EXPECTED_DEPOSIT_REGROW_TICKS &&
      took <= EXPECTED_DEPOSIT_REGROW_TICKS + SCHEDULING_SLACK_TICKS,
    `${label}: stands again after ${took ?? 'never'} ticks (want ${EXPECTED_DEPOSIT_REGROW_TICKS})`,
  );
  check(
    gameMap.structure[tile.y][tile.x].spriteKey === spriteKeyBefore,
    `${label}: comes back as the same stone`,
  );
  const fresh = rig.ledger.stateAt(tile.x, tile.y, UNPERKED_LEVEL);
  check(
    fresh !== null && fresh.remaining === fresh.capacity,
    `${label}: comes back as a fresh node with a full capacity`,
  );
}

section('Quarry regrowth never traps a body, and retries every 10 s');
{
  const rig = makeRig();
  spendOut(rig, deposit);
  const villager = { x: 0, y: 0 };
  standOn(villager, deposit);
  rig.bodies.push(villager);
  tick(rig, EXPECTED_DEPOSIT_REGROW_TICKS + SCHEDULING_SLACK_TICKS);
  check(typeAt(deposit) === RUBBLE, 'a villager standing on the rubble holds it back');
  villager.x = 0;
  villager.y = 0;
  standOn(rig.human, deposit);
  tick(rig, EXPECTED_RETRY_TICKS);
  check(typeAt(deposit) === RUBBLE, 'so does a crawler');
  rig.human.x = 0;
  rig.human.y = 0;
  const took = ticksUntil(rig, EXPECTED_RETRY_TICKS + 1, () => typeAt(deposit) === ROCK_DEPOSIT);
  check(
    took !== null && took <= EXPECTED_RETRY_TICKS,
    `once clear it stands at the next 10 s retry (${took ?? 'never'} ticks)`,
  );
  rig.nodes.clear();
}

section('Grove regrowth: stump, a sapling at 240 s, a tree 60 s after');
{
  const rig = makeRig();
  const grove = site.lumberYard.groveTiles[0];
  const species = gameMap.structure[grove.y][grove.x].spriteKey;
  spendOut(rig, grove);
  const felled = ticksUntil(rig, FELLING_TICKS_LIMIT, () => typeAt(grove) !== TREE);
  check(felled !== null, 'a worked-out grove tree comes down');
  const key = tileKey(grove.x, grove.y);
  const toSapling = ticksUntil(
    rig,
    EXPECTED_GROVE_SAPLING_TICKS + SCHEDULING_SLACK_TICKS,
    () => rig.nodes.get(key)?.sapling === true,
  );
  check(
    toSapling !== null &&
      toSapling >= EXPECTED_GROVE_SAPLING_TICKS &&
      toSapling <= EXPECTED_GROVE_SAPLING_TICKS + SCHEDULING_SLACK_TICKS,
    `a sapling comes up after ${toSapling ?? 'never'} ticks (want ${EXPECTED_GROVE_SAPLING_TICKS})`,
  );
  check(rig.regrowth.renderables().length === 1, 'the sapling is drawn');
  check(typeAt(grove) !== TREE, 'a sapling is not yet a solid tree');
  const toTree = ticksUntil(
    rig,
    EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS,
    () => typeAt(grove) === TREE,
  );
  check(
    toTree !== null &&
      toTree >= EXPECTED_SAPLING_TO_TREE_TICKS &&
      toTree <= EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS,
    `the sapling is a tree ${toTree ?? 'never'} ticks later (want ${EXPECTED_SAPLING_TO_TREE_TICKS} plus the pop)`,
  );
  check(
    gameMap.structure[grove.y][grove.x].spriteKey === species,
    'the regrown tree is the species that stood there',
  );
  check(harvestKindAt(gameMap, grove.x, grove.y) === 'wood', 'the regrown tree can be cut again');
  rig.nodes.clear();
}

section('Grove regrowth: a tree felled some other way comes back too');
{
  const rig = makeRig();
  const grove = site.lumberYard.groveTiles[1];
  rig.trees.fellByHarvest(grove.x, grove.y);
  ticksUntil(rig, FELLING_TICKS_LIMIT, () => typeAt(grove) !== TREE);
  const regrown = ticksUntil(
    rig,
    EXPECTED_GROVE_SAPLING_TICKS + EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS,
    () => typeAt(grove) === TREE,
  );
  check(regrown !== null, 'a grove tree felled without the ledger regrows');
  rig.nodes.clear();
}

section('Nothing regrows through a construction built on its rubble or stump');
{
  const rig = makeRig();
  const underTrebuchet = site.quarry.depositTiles[2];
  const underSnare = site.quarry.depositTiles[3];
  spendOut(rig, underTrebuchet);
  spendOut(rig, underSnare);
  // A trebuchet blocks its footprint through the block mask; a snare only has a record.
  gameMap.blockStructureTile(underTrebuchet.x, underTrebuchet.y);
  rig.claimed.add(tileKey(underSnare.x, underSnare.y));
  tick(rig, EXPECTED_DEPOSIT_REGROW_TICKS + EXPECTED_RETRY_TICKS * 3);
  check(typeAt(underTrebuchet) === RUBBLE, 'a deposit under a trebuchet never regrows');
  check(typeAt(underSnare) === RUBBLE, 'a deposit under a snare never regrows');
  gameMap.unblockStructureTile(underTrebuchet.x, underTrebuchet.y);
  rig.claimed.clear();
  const freed = ticksUntil(
    rig,
    EXPECTED_RETRY_TICKS + SCHEDULING_SLACK_TICKS,
    () => typeAt(underTrebuchet) === ROCK_DEPOSIT && typeAt(underSnare) === ROCK_DEPOSIT,
  );
  check(freed !== null, 'both regrow at the next retry once the constructions are gone');
  rig.nodes.clear();
}

section('Grove regrowth waits for a body standing on the sapling');
{
  const rig = makeRig();
  const grove = site.lumberYard.groveTiles[2];
  const key = tileKey(grove.x, grove.y);
  spendOut(rig, grove);
  ticksUntil(rig, FELLING_TICKS_LIMIT, () => typeAt(grove) !== TREE);
  ticksUntil(
    rig,
    EXPECTED_GROVE_SAPLING_TICKS + SCHEDULING_SLACK_TICKS,
    () => rig.nodes.get(key)?.sapling === true,
  );
  standOn(rig.cat, grove);
  tick(rig, EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS + EXPECTED_RETRY_TICKS);
  check(typeAt(grove) !== TREE, 'a sapling with Donut on it does not become a solid tree');
  rig.cat.x = 0;
  rig.cat.y = 0;
  const grew = ticksUntil(
    rig,
    EXPECTED_RETRY_TICKS + GROW_IN_SLACK_TICKS,
    () => typeAt(grove) === TREE,
  );
  check(grew !== null, `once she steps off it grows at the next retry (${grew ?? 'never'} ticks)`);
  rig.nodes.clear();
}

section('Grove checkpoint: a tree regrown after the checkpoint is taken away by the rewind');
{
  const rig = makeRig();
  const grove = site.lumberYard.groveTiles[3];
  const key = tileKey(grove.x, grove.y);
  spendOut(rig, grove);
  ticksUntil(rig, FELLING_TICKS_LIMIT, () => typeAt(grove) !== TREE);
  tick(rig, EXPECTED_RETRY_TICKS);
  const ledgerCheckpoint = rig.ledger.captureCheckpoint();
  const treeCheckpoint = rig.trees.captureCheckpoint();
  const ticksLeftAtCheckpoint = rig.nodes.get(key)?.regrowTicksLeft ?? null;
  const regrew = ticksUntil(
    rig,
    EXPECTED_GROVE_SAPLING_TICKS + EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS,
    () => typeAt(grove) === TREE,
  );
  check(regrew !== null, 'the grove tree regrew after the checkpoint');
  rig.trees.restoreCheckpoint(treeCheckpoint);
  rig.ledger.restoreCheckpoint(ledgerCheckpoint);
  rig.regrowth.reconcileAfterRestore();
  check(typeAt(grove) !== TREE, 'the rewind takes the regrown tree away');
  check(
    rig.nodes.get(key)?.regrowTicksLeft === ticksLeftAtCheckpoint &&
      rig.nodes.get(key)?.sapling === false,
    'and puts the stump back on the timer it had',
  );
  const again = ticksUntil(
    rig,
    EXPECTED_GROVE_SAPLING_TICKS + EXPECTED_SAPLING_TO_TREE_TICKS + GROW_IN_SLACK_TICKS,
    () => typeAt(grove) === TREE,
  );
  check(again !== null, 'it regrows again on the rewound timer');
  rig.nodes.clear();
}

section('Nothing outside the village regrows');
{
  const rig = makeRig();
  const outside = (types: ReadonlySet<number>): { x: number; y: number } | null => {
    for (let y = 1; y < gameMap.structure.length - 1; y++) {
      for (let x = 1; x < gameMap.structure[y].length - 1; x++) {
        if (!types.has(gameMap.structure[y][x].type) || harvestKindAt(gameMap, x, y) === null) {
          continue;
        }
        if (
          gameMap.briarHollowDistrictAt(
            (x + TILE_CENTRE) * TILE_SIZE,
            (y + TILE_CENTRE) * TILE_SIZE,
          ) !== null
        ) {
          continue;
        }
        return { x, y };
      }
    }
    return null;
  };
  const tree = outside(new Set([TREE]));
  const boulder = outside(new Set([BOULDER_SMALL, BOULDER_LARGE]));
  if (tree === null || boulder === null) {
    check(false, 'found a wild tree and a wild boulder');
  } else {
    const boulderType = typeAt(boulder);
    spendOut(rig, tree);
    spendOut(rig, boulder);
    tick(rig, NEVER_TICKS);
    check(typeAt(tree) !== TREE, `a wild tree stays felled after ${NEVER_TICKS} ticks`);
    check(
      typeAt(boulder) !== boulderType,
      `a wild boulder stays crumbled after ${NEVER_TICKS} ticks`,
    );
  }
  rig.nodes.clear();
}

section('Checkpoint: a rewind puts regrowth back where it was');
{
  const rig = makeRig();
  const tile = site.quarry.depositTiles[1];
  spendOut(rig, tile);
  tick(rig, EXPECTED_RETRY_TICKS);
  const checkpoint = rig.ledger.captureCheckpoint();
  const ticksLeftAtCheckpoint = rig.nodes.get(tileKey(tile.x, tile.y))?.regrowTicksLeft ?? null;
  tick(rig, EXPECTED_DEPOSIT_REGROW_TICKS);
  check(typeAt(tile) === ROCK_DEPOSIT, 'the deposit regrew after the checkpoint');
  rig.ledger.restoreCheckpoint(checkpoint);
  rig.regrowth.reconcileAfterRestore();
  check(typeAt(tile) === RUBBLE, 'the rewind crumbles it again');
  check(
    rig.nodes.get(tileKey(tile.x, tile.y))?.regrowTicksLeft === ticksLeftAtCheckpoint,
    'and its timer is the one captured',
  );
  const regrown = ticksUntil(
    rig,
    EXPECTED_DEPOSIT_REGROW_TICKS,
    () => typeAt(tile) === ROCK_DEPOSIT,
  );
  check(
    regrown !== null &&
      regrown <= EXPECTED_DEPOSIT_REGROW_TICKS - EXPECTED_RETRY_TICKS + SCHEDULING_SLACK_TICKS,
    `it regrows on the rewound timer (${regrown ?? 'never'} ticks)`,
  );
  rig.nodes.clear();
}

section('HUD zones: the lumber yard and the quarry keep the HUD up');
{
  const zone = inGatheringDistrict(gameMap);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const districtCentre = (id: string): { x: number; y: number } | null => {
    const district = site.districts.find((entry) => entry.id === id);
    return district === undefined ? null : rectCentre(district.rect);
  };
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['lumber_yard', true],
    ['quarry', true],
    ['square', false],
    ['pasture', false],
  ];
  for (const [id, expected] of cases) {
    const centre = districtCentre(id);
    if (centre === null) {
      check(false, `the site has a ${id} district`);
      continue;
    }
    standOn(human, centre);
    check(zone(human) === expected, `${id}: HUD zone ${expected ? 'on' : 'off'}`);
  }
  standOn(human, { x: site.palisadeBounds.x - FAR_TILES * 2, y: site.palisadeBounds.y });
  check(!zone(human), 'the wilderness is not a HUD zone');
  check(anyResourceZone(zone, () => true)(human), 'zones compose: another owner can add a zone');
  check(!anyResourceZone(zone, () => false)(human), 'and an OR of false zones is false');
}

section('Processing machines: the sawmill and the rope frame, within reach');
{
  const stations = processingStationsOf(site);
  const saw = stations.find((station) => station.kind === 'boards');
  const rope = stations.find((station) => station.kind === 'rope');
  check(stations.length === 2 && saw !== undefined && rope !== undefined, 'one of each machine');
  if (saw !== undefined) {
    const besideX = (saw.footprint.x - 1 + TILE_CENTRE) * TILE_SIZE;
    const besideY = (saw.footprint.y + TILE_CENTRE) * TILE_SIZE;
    check(
      processingStationInReach(stations, besideX, besideY)?.kind === 'boards',
      'the tile beside the sawmill works it',
    );
    const farX = (saw.footprint.x - FAR_TILES) * TILE_SIZE;
    check(
      processingStationInReach(stations, farX, besideY) === null,
      'six tiles off works nothing',
    );
    const edgeX = saw.footprint.x * TILE_SIZE;
    const middleY = (saw.footprint.y + saw.footprint.h / 2) * TILE_SIZE;
    const justInside = edgeX - (PROCESSING_REACH_TILES - REACH_PROBE_TILES) * TILE_SIZE;
    const justOutside = edgeX - (PROCESSING_REACH_TILES + REACH_PROBE_TILES) * TILE_SIZE;
    check(
      processingStationInReach(stations, justInside, middleY) !== null &&
        processingStationInReach(stations, justOutside, middleY) === null,
      'the default reach is 1.5 tiles: 1.4 works the sawmill, 1.6 does not',
    );
  }
  check(processingStationsOf(null).length === 0, 'no village, no machines');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`verify:village-nodes FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:village-nodes OK');
