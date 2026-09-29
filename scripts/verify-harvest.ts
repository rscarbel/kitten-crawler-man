#!/usr/bin/env tsx
/**
 * Headless gate on gathering: the yield arithmetic, harvest speed, node
 * capacity and depletion, luck, per-crawler skills, XP, the channel's stop
 * rules, and thralls — run against a real floor-3 `GameMap`.
 *
 * The expected numbers are written out here from the original request's
 * wording, not imported from the module under test, so a formula that drifts
 * from the request fails rather than agreeing with itself.
 *
 * Run: npx tsx scripts/verify-harvest.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import {
  harvestAward,
  harvestIntervalTicks,
  harvestXp,
  rollHarvestLuck,
  thrallHarvestXp,
  type LuckyDrop,
} from '../src/core/harvestYield';
import { type HarvestKind, resourcingNodeCapacityBonus } from '../src/core/craftPerks';
import { MAX_CRAFT_LEVEL } from '../src/core/CraftSkills';
import { PartyTools, type PartyToolsState } from '../src/core/PartyTools';
import { isToolTier, MAX_TOOL_TIER, TOOL_TIERS, type ToolTier } from '../src/core/toolTiers';
import { createBriarHollowState, type HarvestNodeState } from '../src/core/briarHollowState';
import { ITEM_DEF, type ItemId } from '../src/core/ItemDefs';
import { resetThrallCooldownsForTests, thrallCooldownTicksLeft } from '../src/core/thrallCooldowns';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Rat } from '../src/creatures/Rat';
import { GameMap } from '../src/map/GameMap';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level3 } from '../src/levels/level3';
import { BOULDER_LARGE, BOULDER_SMALL, TREE } from '../src/map/tileTypes';
import { mulberry32 } from '../src/sprites/person/rng';
import { LootSystem } from '../src/systems/LootSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { TreeSystem } from '../src/systems/TreeSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { HarvestEffects } from '../src/systems/briarHollow/HarvestEffects';
import { HARVEST_REACH_TILES, HarvestSystem } from '../src/systems/briarHollow/HarvestSystem';
import { NodeLedger } from '../src/systems/briarHollow/NodeLedger';
import { ThrallSystem } from '../src/systems/briarHollow/ThrallSystem';
import {
  createNodeState,
  harvestKindAt,
  ROCK_HARVESTS_MAX,
  ROCK_HARVESTS_MIN,
  TREE_HARVESTS_MAX,
  TREE_HARVESTS_MIN,
} from '../src/systems/briarHollow/harvestNodes';

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

const EPSILON = 1e-9;
const PERCENT_MULTIPLIER = 100;
const TICKS_PER_SECOND = 60;
const WORLD_SEED = 424242;
const TILE_CENTRE = 0.5;
const NO_CAPACITY_BONUS = 0;
/** A Resourcing level below every capacity perk. */
const UNPERKED_LEVEL = 1;

// ── The request's own numbers ─────────────────────────────────────────────

/**
 * "The bonus is always +N": each listed level replaces the bonus, it does not
 * add to it. Levels between listed ones keep the last. It lengthens a fresh
 * node's capacity and never touches one harvest's award.
 */
const EXPECTED_CAPACITY_BONUS: readonly number[] = [
  // index = level; level 0 is never harvested at.
  0, 0, 1, 1, 2, 2, 2, 3, 3, 5, 5, 5, 5, 10, 10, 10,
];
/**
 * The ten speed levels, 5% each, additively: the dedicated speed perks (3, 6,
 * 8, 11, 12) and the node-duration perks (2, 4, 7, 9, 13), which grant the
 * same speed step alongside their duration bonus.
 */
const EXPECTED_SPEED: ReadonlyMap<number, number> = new Map([
  [1, 1.0],
  [2, 0.95],
  [3, 0.9],
  [4, 0.85],
  [6, 0.8],
  [7, 0.75],
  [8, 0.7],
  [9, 0.65],
  [11, 0.6],
  [12, 0.55],
  [13, 0.5],
]);
const DOUBLING_LEVEL = 15;
const EXPECTED_WOOD_BASE_SECONDS = 1.5;
const EXPECTED_STONE_BASE_SECONDS = 2.75;
/** Every tool tier's speed bonus, written out flat so the gate cannot agree with a wrong derivation in the module under test. */
const EXPECTED_TOOL_SPEED_BONUS: ReadonlyMap<ToolTier, number> = new Map([
  [0, 0],
  [1, 0.05],
  [2, 0.1],
  [3, 0.15],
  [4, 0.15],
  [5, 0.15],
]);
/** Every tool tier's yield multiplier, written out flat for the same reason. */
const EXPECTED_TOOL_YIELD_MULTIPLIER: ReadonlyMap<ToolTier, number> = new Map([
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 2],
  [5, 4],
]);
const EXPECTED_REFINED_WOOD = 0.07;
const EXPECTED_REFINED_STONE = 0.04;
const EXPECTED_TREB_KIT = 0.01;
const EXPECTED_SNARE_KIT = 0.05;
const EXPECTED_THRALL_XP_SHARE = 0.25;
const EXPECTED_THRALL_LIFETIME_SECONDS = 45;
const EXPECTED_THRALL_COOLDOWN_SECONDS = 60;
const THRALL_LIFETIME_TICKS = EXPECTED_THRALL_LIFETIME_SECONDS * TICKS_PER_SECOND;
const THRALL_COOLDOWN_TICKS = EXPECTED_THRALL_COOLDOWN_SECONDS * TICKS_PER_SECOND;
const EXPECTED_TREE_HARVESTS = { min: 5, max: 15 } as const;
const EXPECTED_ROCK_HARVESTS = { min: 20, max: 50 } as const;

/** Levels the request names. */
const REFINED_LEVEL = 5;
const BELOW_REFINED_LEVEL = REFINED_LEVEL - 1;
const KIT_LEVEL = 14;
const SUMMON_LEVEL = 10;
const BELOW_SUMMON_LEVEL = SUMMON_LEVEL - 1;
const TOP_LEVEL = 15;
/** A speed level partway up the table, used to check Carl's own pace differs from Donut's unleveled one. */
const FAST_LEVEL = 12;
/** The Ratkin Forge tier: on the speed ladder, same yield as the basic tool. */
const FORGE_TIER: ToolTier = 3;
/** The top tier: quadruples the basic tool's yield. */
const TOP_TIER: ToolTier = MAX_TOOL_TIER;
const TOP_TIER_YIELD_MULTIPLE = 4;
/** Four ticks shows a 1.5× carry alternate twice. Every real tier's yield is a whole number, so the carry mechanic is exercised against a synthetic multiplier. */
const CARRY_SEQUENCE_TICKS = 4;
const EXPECTED_CARRY_SEQUENCE = '1,2,1,2';
const FRACTIONAL_YIELD_MULTIPLIER_FOR_CARRY_TEST = 1.5;
/** Summons at the top level bring this many thralls. */
const TOP_LEVEL_THRALLS = 3;
/** Independent luck streams, one per rate measured. */
const LUCK_SEED_WOOD = 11;
const LUCK_SEED_STONE = 12;
const LUCK_SEED_KITS = 13;
const LUCK_SEED_LOW = 14;
const LUCK_SEED_TOP = 15;
/** How many of each node the map has to offer the tests. */
const TREE_SPOTS_WANTED = 40;
const TREE_SPOTS_NEEDED = 20;
const ROCK_SPOTS_WANTED = 20;
const ROCK_SPOTS_NEEDED = 6;
/** Generous waits, in seconds, for things that should land well inside them. */
const AWARD_WAIT_SECONDS = 2;
const GLIDE_WAIT_SECONDS = 10;
/** Summon sites tried for a glide that has to pass over something solid. */
const GLIDE_ATTEMPTS = 20;
/** How far thralls look for work from where they were summoned, in tiles. */
const EXPECTED_THRALL_SEARCH_RADIUS_TILES = 12;
/** Extra tiles worked out past the search radius, so rounding at its rim cannot leave a stray tree. */
const GLIDE_EXHAUST_MARGIN_TILES = 2;
/** The farthest a target tree is looked for from the thrall, in tiles: well inside the search radius. */
const GLIDE_TARGET_REACH_TILES = 8;
/** Where a thrall stands to work: this far from its node's centre, toward where it came from. */
const WORK_STAND_OFF_TILES = 0.8;
/** Points sampled per tile along a candidate route when looking for something solid on it. */
const ROUTE_SAMPLES_PER_TILE = 8;
/** Slack on the work stand's distance from its node, in tiles. */
const STAND_TOLERANCE_TILES = 0.1;
/** How far a glide step may turn from its leg's heading before the leg counts as bent. */
const GLIDE_HEADING_TOLERANCE = 1e-6;
/** Decimal places rates and shares are printed to. */
const RATE_DIGITS = 4;
const SHARE_DIGITS = 3;

// ── Award table ────────────────────────────────────────────────────────────

section('Tool ladder: every tier’s speed bonus and yield multiplier match the request');
{
  for (const kind of ['axe', 'pickaxe'] as const) {
    for (const [tier, def] of TOOL_TIERS[kind].entries()) {
      if (!isToolTier(tier)) {
        check(false, `${def.id}: tier index ${tier} is a valid ToolTier`);
        continue;
      }
      const expectedSpeedBonus = EXPECTED_TOOL_SPEED_BONUS.get(tier) ?? 0;
      check(
        Math.abs(def.speedBonus - expectedSpeedBonus) < EPSILON,
        `${def.id}: speed bonus +${def.speedBonus * PERCENT_MULTIPLIER}%`,
      );
      check(
        def.yieldMultiplier === EXPECTED_TOOL_YIELD_MULTIPLIER.get(tier),
        `${def.id}: yield ×${def.yieldMultiplier}`,
      );
    }
  }
}

section('Award table: every tier × level × kind, 1,000 ticks, exact');
{
  const TICKS = 1000;
  let rows = 0;
  let mismatches = 0;
  for (const kind of ['axe', 'pickaxe'] as const) {
    for (const def of TOOL_TIERS[kind]) {
      for (let level = 1; level <= MAX_CRAFT_LEVEL; level++) {
        let carry = 0;
        let total = 0;
        for (let tick = 0; tick < TICKS; tick++) {
          const award = harvestAward(def.yieldMultiplier, carry, level);
          carry = award.carry;
          total += award.amount;
        }
        const baseUnits = Math.floor(TICKS * def.yieldMultiplier + EPSILON);
        const expected = level >= DOUBLING_LEVEL ? baseUnits * 2 : baseUnits;
        rows++;
        if (total !== expected) {
          mismatches++;
          console.error(`    ${def.id} L${level}: got ${total}, expected ${expected}`);
        }
      }
    }
  }
  check(rows === TOOL_TIERS.axe.length * 2 * MAX_CRAFT_LEVEL, `${rows} rows simulated`);
  check(
    mismatches === 0,
    `every row matches the request's yield rule (perk bonuses never add to it) (${mismatches} mismatched)`,
  );

  // Every real tier's yield is a whole number, so the carry mechanic is
  // exercised against a synthetic multiplier.
  const sequence: number[] = [];
  let carry = 0;
  for (let tick = 0; tick < CARRY_SEQUENCE_TICKS; tick++) {
    const award = harvestAward(FRACTIONAL_YIELD_MULTIPLIER_FOR_CARRY_TEST, carry, 1);
    carry = award.carry;
    sequence.push(award.amount);
  }
  check(
    sequence.join(',') === EXPECTED_CARRY_SEQUENCE,
    `a 1.5× yield multiplier carries its remainder: 1, 2, 1, 2 (got ${sequence.join(', ')})`,
  );
}

// ── Speed ──────────────────────────────────────────────────────────────────

/** No tool bonus: the basic tier's speedBonus is 0. */
const NO_TOOL_SPEED_BONUS = 0;

section('Speed: interval at the ten speed levels, basic tool');
for (const [level, factor] of EXPECTED_SPEED) {
  const wood = harvestIntervalTicks('wood', level, NO_TOOL_SPEED_BONUS) / TICKS_PER_SECOND;
  const stone = harvestIntervalTicks('stone', level, NO_TOOL_SPEED_BONUS) / TICKS_PER_SECOND;
  check(
    Math.abs(wood - EXPECTED_WOOD_BASE_SECONDS * factor) < EPSILON &&
      Math.abs(stone - EXPECTED_STONE_BASE_SECONDS * factor) < EPSILON,
    `level ${level}: ${factor}× base (wood ${wood.toFixed(SHARE_DIGITS)} s, stone ${stone.toFixed(SHARE_DIGITS)} s)`,
  );
}

section('Speed: a tool’s speed bonus stacks additively with Resourcing’s own steps');
{
  const level = FAST_LEVEL;
  const skillFactor = EXPECTED_SPEED.get(level) ?? 1;
  for (const [tier, def] of TOOL_TIERS.axe.entries()) {
    const expectedFactor = skillFactor - def.speedBonus;
    const seconds = harvestIntervalTicks('wood', level, def.speedBonus) / TICKS_PER_SECOND;
    check(
      Math.abs(seconds - EXPECTED_WOOD_BASE_SECONDS * expectedFactor) < EPSILON,
      `L${level} ${def.name} (tier ${tier}): ${expectedFactor.toFixed(SHARE_DIGITS)}× base (${seconds.toFixed(SHARE_DIGITS)} s)`,
    );
  }
}

// ── The map ────────────────────────────────────────────────────────────────

const gameMap = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  dungeon: dungeonOptionsForLevel(level3),
  worldSeed: WORLD_SEED,
});

interface Spot {
  readonly tileX: number;
  readonly tileY: number;
  /** A walkable tile beside it to work it from. */
  readonly standX: number;
  readonly standY: number;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

function workableSpots(types: ReadonlySet<number>, limit: number): Spot[] {
  const found: Spot[] = [];
  const used = new Set<string>();
  const structure = gameMap.structure;
  for (let ty = 1; ty < structure.length - 1 && found.length < limit; ty++) {
    for (let tx = 1; tx < structure[ty].length - 1 && found.length < limit; tx++) {
      if (!types.has(structure[ty][tx].type) || harvestKindAt(gameMap, tx, ty) === null) continue;
      if (
        gameMap.isInsideTownWall((tx + TILE_CENTRE) * TILE_SIZE, (ty + TILE_CENTRE) * TILE_SIZE)
      ) {
        continue;
      }
      for (const [dx, dy] of NEIGHBOURS) {
        const sx = tx + dx;
        const sy = ty + dy;
        if (!gameMap.isWalkable(sx, sy) || used.has(`${sx},${sy}`)) continue;
        // Keep every stand clear of any other node, so a crawler there can only mean this one.
        const crowded = NEIGHBOURS.some(
          ([ox, oy]) =>
            (sx + ox !== tx || sy + oy !== ty) && harvestKindAt(gameMap, sx + ox, sy + oy) !== null,
        );
        if (crowded) continue;
        used.add(`${sx},${sy}`);
        found.push({ tileX: tx, tileY: ty, standX: sx, standY: sy });
        break;
      }
    }
  }
  return found;
}

const TREE_SPOTS = workableSpots(new Set([TREE]), TREE_SPOTS_WANTED);
const ROCK_SPOTS = workableSpots(new Set([BOULDER_SMALL, BOULDER_LARGE]), ROCK_SPOTS_WANTED);
check(
  TREE_SPOTS.length >= TREE_SPOTS_NEEDED,
  `found ${TREE_SPOTS.length} workable trees on the floor-3 map`,
);
check(
  ROCK_SPOTS.length >= ROCK_SPOTS_NEEDED,
  `found ${ROCK_SPOTS.length} workable boulders on the floor-3 map`,
);
let nextTree = 0;
let nextRock = 0;
function takeTree(): Spot {
  const spot = TREE_SPOTS[nextTree % TREE_SPOTS.length];
  nextTree++;
  return spot;
}
function takeRock(): Spot {
  const spot = ROCK_SPOTS[nextRock % ROCK_SPOTS.length];
  nextRock++;
  return spot;
}

// ── A harness around the real systems ──────────────────────────────────────

interface Rig {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly tools: PartyToolsState;
  readonly nodes: Map<string, HarvestNodeState>;
  readonly ledger: NodeLedger;
  readonly harvest: HarvestSystem;
  readonly thralls: ThrallSystem;
  readonly trees: TreeSystem;
  readonly roster: MobRoster;
  readonly announcements: string[];
}

function makeRig(luckSeed = 1): Rig {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  human.isActive = true;
  const tools: PartyToolsState = { axeTier: 0, pickaxeTier: 0 };
  const partyTools = new PartyTools(tools);
  const nodes = createBriarHollowState().nodes;
  const trees = new TreeSystem(gameMap, new LootSystem(gameMap), level3.floorNumber);
  const effects = new HarvestEffects();
  const announcements: string[] = [];
  const ledger = new NodeLedger({
    gameMap,
    nodes,
    trees,
    bus: null,
    onTileChanged: () => undefined,
    capacityRng: mulberry32(luckSeed + 1),
    onDepleted: () => undefined,
  });
  const harvest = new HarvestSystem({
    gameMap,
    ledger,
    tools,
    partyTools,
    effects,
    bus: null,
    audio: null,
    announce: (message) => announcements.push(message),
    luckRng: mulberry32(luckSeed),
    noteActivity: () => undefined,
    onTreeStruck: () => undefined,
  });
  const thralls = new ThrallSystem({
    gameMap,
    ledger,
    partyTools,
    tierOf: (tool) => (tool === 'axe' ? tools.axeTier : tools.pickaxeTier),
    effects,
    bus: null,
    audio: null,
    announce: (message) => announcements.push(message),
    noteActivity: () => undefined,
    onTreeStruck: () => undefined,
    harvestedNodeFor: (crawler) => harvest.nodeFor(crawler),
  });
  const roster = new MobRoster(gameMap, new SpellSystem());
  return { human, cat, tools, nodes, ledger, harvest, thralls, trees, roster, announcements };
}

interface GlidePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Splits a thrall's per-tick positions into legs: the runs of ticks it moved,
 * each leg with the point it set off from.
 */
function glideLegs(path: ReadonlyArray<GlidePoint>): GlidePoint[][] {
  const legs: GlidePoint[][] = [];
  let leg: GlidePoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const moved = from.x !== to.x || from.y !== to.y;
    if (!moved) {
      if (leg.length > 0) legs.push(leg);
      leg = [];
      continue;
    }
    if (leg.length === 0) leg.push(from);
    leg.push(to);
  }
  if (leg.length > 0) legs.push(leg);
  return legs;
}

interface TileRef {
  readonly tileX: number;
  readonly tileY: number;
}

/** Ticks the rig's thralls until the first stands still, and returns where; null if it never does. */
function tickUntilStill(rig: Rig): { x: number; y: number; node: TileRef | null } | null {
  let previous = rig.thralls.snapshot[0];
  for (let tick = 0; tick < TICKS_PER_SECOND * GLIDE_WAIT_SECONDS; tick++) {
    rig.thralls.update();
    const view = rig.thralls.snapshot[0];
    if (view.x === previous.x && view.y === previous.y) return view;
    previous = view;
  }
  return null;
}

/** Whether a thrall's centre at `point` is over a non-walkable tile that is neither end of its route. */
function isSolidInTheWay(point: GlidePoint, from: TileRef, to: TileRef): boolean {
  const tileX = Math.floor(point.x / TILE_SIZE + TILE_CENTRE);
  const tileY = Math.floor(point.y / TILE_SIZE + TILE_CENTRE);
  const isEnd =
    (tileX === from.tileX && tileY === from.tileY) || (tileX === to.tileX && tileY === to.tileY);
  return !isEnd && !gameMap.isWalkable(tileX, tileY);
}

/**
 * The nearest tree within the target reach of a thrall standing at `at`
 * (tile top-left, px) whose straight route to its work stand passes over
 * something solid, and which lies in the thrall's search radius from home.
 */
function treeBehindSomethingSolid(
  at: GlidePoint,
  from: TileRef,
  homeX: number,
  homeY: number,
): TileRef | null {
  const centreX = at.x + TILE_SIZE * TILE_CENTRE;
  const centreY = at.y + TILE_SIZE * TILE_CENTRE;
  const atTileX = Math.floor(centreX / TILE_SIZE);
  const atTileY = Math.floor(centreY / TILE_SIZE);
  let best: TileRef | null = null;
  let bestDistance = Infinity;
  for (let dy = -GLIDE_TARGET_REACH_TILES; dy <= GLIDE_TARGET_REACH_TILES; dy++) {
    for (let dx = -GLIDE_TARGET_REACH_TILES; dx <= GLIDE_TARGET_REACH_TILES; dx++) {
      const tile = { tileX: atTileX + dx, tileY: atTileY + dy };
      if (tile.tileX === from.tileX && tile.tileY === from.tileY) continue;
      if (harvestKindAt(gameMap, tile.tileX, tile.tileY) !== 'wood') continue;
      const nodeX = (tile.tileX + TILE_CENTRE) * TILE_SIZE;
      const nodeY = (tile.tileY + TILE_CENTRE) * TILE_SIZE;
      const fromHome = Math.hypot(nodeX - homeX, nodeY - homeY);
      if (fromHome > GLIDE_TARGET_REACH_TILES * TILE_SIZE) continue;
      const distance = Math.hypot(centreX - nodeX, centreY - nodeY);
      if (distance >= bestDistance || distance === 0) continue;
      const standX = nodeX + ((centreX - nodeX) / distance) * WORK_STAND_OFF_TILES * TILE_SIZE;
      const standY = nodeY + ((centreY - nodeY) / distance) * WORK_STAND_OFF_TILES * TILE_SIZE;
      const samples = Math.ceil((distance / TILE_SIZE) * ROUTE_SAMPLES_PER_TILE);
      let blocked = false;
      for (let i = 1; i < samples && !blocked; i++) {
        const t = i / samples;
        const point = {
          x: centreX + (standX - centreX) * t - TILE_SIZE * TILE_CENTRE,
          y: centreY + (standY - centreY) * t - TILE_SIZE * TILE_CENTRE,
        };
        blocked = isSolidInTheWay(point, from, tile);
      }
      if (!blocked) continue;
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether every step of a leg heads the same way as its first. */
function isStraight(leg: ReadonlyArray<GlidePoint>): boolean {
  if (leg.length < 2) return true;
  const headingX = leg[1].x - leg[0].x;
  const headingY = leg[1].y - leg[0].y;
  const headingLength = Math.hypot(headingX, headingY);
  for (let i = 2; i < leg.length; i++) {
    const stepX = leg[i].x - leg[i - 1].x;
    const stepY = leg[i].y - leg[i - 1].y;
    const stepLength = Math.hypot(stepX, stepY);
    const sine = (headingX * stepY - headingY * stepX) / (headingLength * stepLength);
    const forward = headingX * stepX + headingY * stepY > 0;
    if (Math.abs(sine) > GLIDE_HEADING_TOLERANCE || !forward) return false;
  }
  return true;
}

function teach(crawler: HumanPlayer | CatPlayer, level: number): void {
  crawler.craftSkills.restore({
    ...crawler.craftSkills.snapshot(),
    resourcing: { learned: true, level, xp: 0 },
  });
}

function stand(crawler: HumanPlayer | CatPlayer, spot: Spot): void {
  crawler.x = spot.standX * TILE_SIZE;
  crawler.y = spot.standY * TILE_SIZE;
}

function contextFor(rig: Rig, active: HumanPlayer | CatPlayer): SystemContext {
  const inactive = active === rig.human ? rig.cat : rig.human;
  rig.human.isActive = active === rig.human;
  rig.cat.isActive = active === rig.cat;
  return {
    human: rig.human,
    cat: rig.cat,
    active,
    inactive,
    activeIsMoving: false,
    roster: rig.roster,
    gameMap,
  };
}

function woodHeld(crawler: HumanPlayer | CatPlayer, id: ItemId = 'wood'): number {
  return crawler.inventory.countOf(id);
}

/** Ticks until the next award lands, and how much it was; null when none lands in `limit` ticks. */
function nextAward(
  rig: Rig,
  crawler: HumanPlayer | CatPlayer,
  id: ItemId,
  limit: number,
): { ticks: number; amount: number } | null {
  const before = crawler.inventory.countOf(id);
  const ctx = contextFor(rig, crawler);
  for (let tick = 1; tick <= limit; tick++) {
    rig.harvest.update(ctx, false);
    const now = crawler.inventory.countOf(id);
    if (now !== before) return { ticks: tick, amount: now - before };
  }
  return null;
}

// ── Grove tree immunity ──────────────────────────────────────────────────────

section('Grove trees: immune to combat damage, fire and blasts; the axe still fells one');
{
  const rig = makeRig();
  const groveTiles = gameMap.briarHollow?.lumberYard.groveTiles ?? [];
  check(groveTiles.length > 0, 'the village has a lumber yard grove to test against');

  // Never drawn from `TREE_SPOTS`: that pool is shared with every later
  // section through `takeTree()`'s own running counter, and felling one of its
  // entries here — to prove combat can still fell an *unprotected* tree —
  // would silently hand a later section a stump instead of a tree.
  const reservedElsewhere = new Set(TREE_SPOTS.map((spot) => `${spot.tileX},${spot.tileY}`));

  function findStandingTree(
    predicate: (tileX: number, tileY: number) => boolean,
  ): { tileX: number; tileY: number } | null {
    const structure = gameMap.structure;
    for (let ty = 1; ty < structure.length - 1; ty++) {
      for (let tx = 1; tx < structure[ty].length - 1; tx++) {
        if (structure[ty][tx].type !== TREE) continue;
        if (reservedElsewhere.has(`${tx},${ty}`)) continue;
        if (!predicate(tx, ty)) continue;
        return { tileX: tx, tileY: ty };
      }
    }
    return null;
  }

  const isGroveTile = (tileX: number, tileY: number): boolean =>
    groveTiles.some((tile) => tile.x === tileX && tile.y === tileY);

  const standingGroveSpot = findStandingTree(isGroveTile);
  const standingGrove =
    standingGroveSpot === null
      ? undefined
      : { x: standingGroveSpot.tileX, y: standingGroveSpot.tileY };
  check(standingGrove !== undefined, 'found a standing grove tree outside the shared test pool');

  function freshNonGroveTree(): { tileX: number; tileY: number } | null {
    return findStandingTree((tileX, tileY) => !isGroveTile(tileX, tileY));
  }

  // Well under one tile: every check here is about the one tile under test,
  // and a wider radius would reach whatever real (unprotected) tree happens to
  // stand next to it — including one `TREE_SPOTS` is still going to draw from
  // in a later section — and fell that one for real as collateral.
  const BLAST_TEST_RADIUS = TILE_SIZE * 0.25;
  const OVERWHELMING_DAMAGE = 1_000_000;

  if (standingGrove !== undefined) {
    const worldX = (standingGrove.x + TILE_CENTRE) * TILE_SIZE;
    const worldY = (standingGrove.y + TILE_CENTRE) * TILE_SIZE;

    rig.trees.tryProjectileHit(worldX, worldY, BLAST_TEST_RADIUS, OVERWHELMING_DAMAGE, rig.cat);
    rig.trees.igniteRadius(worldX, worldY, BLAST_TEST_RADIUS);
    check(
      gameMap.structure[standingGrove.y][standingGrove.x].type === TREE &&
        gameMap.structure[standingGrove.y][standingGrove.x].treeStage === undefined,
      "a magic missile's hit and its ignite ring never damage or burn the grove tree",
    );

    rig.trees.destroyInRadius(worldX, worldY, BLAST_TEST_RADIUS, rig.human);
    check(
      gameMap.structure[standingGrove.y][standingGrove.x].type === TREE,
      'a dynamite blast never flattens the grove tree',
    );

    rig.human.x = standingGrove.x * TILE_SIZE;
    rig.human.y = standingGrove.y * TILE_SIZE;
    rig.trees.smashAllInRadius(rig.human, BLAST_TEST_RADIUS);
    check(
      gameMap.structure[standingGrove.y][standingGrove.x].type === TREE,
      'a smush stomp never flattens the grove tree',
    );

    const meleeHit = rig.trees.tryMeleeHit(rig.human, BLAST_TEST_RADIUS, OVERWHELMING_DAMAGE);
    check(
      meleeHit && gameMap.structure[standingGrove.y][standingGrove.x].type === TREE,
      'a melee punch lands on the grove tree (the thud still plays) but never damages it',
    );
  }

  // The same attack fells an ordinary tree outside the grove: without this, a
  // lookup that never finds the lumber yard would leave every check above
  // vacuously true instead of proving the immunity is real.
  const ctx = contextFor(rig, rig.human);
  const FELLING_SETTLE_TICKS = 120;

  const control = freshNonGroveTree();
  check(control !== null, 'found an ordinary tree outside the grove to test against');
  if (control !== null) {
    const worldX = (control.tileX + TILE_CENTRE) * TILE_SIZE;
    const worldY = (control.tileY + TILE_CENTRE) * TILE_SIZE;
    rig.trees.destroyInRadius(worldX, worldY, BLAST_TEST_RADIUS, rig.human);
    for (let i = 0; i < FELLING_SETTLE_TICKS; i++) rig.trees.update(ctx);
    check(
      gameMap.structure[control.tileY][control.tileX].type !== TREE,
      'the same blast fells an ordinary tree outside the grove',
    );
  }

  if (standingGrove !== undefined) {
    const felled = rig.trees.fellByHarvest(standingGrove.x, standingGrove.y);
    check(felled, 'the axe still claims a grove tree normally');
    for (let i = 0; i < FELLING_SETTLE_TICKS; i++) rig.trees.update(ctx);
    check(
      gameMap.structure[standingGrove.y][standingGrove.x].type !== TREE,
      'and chopping it down for wood still fells it to ground',
    );
  }
}

// ── Capacity and depletion ────────────────────────────────────────────────

section('Capacity: trees hold 5–15 harvests, rocks 20–50, both extremes seen');
{
  const SEEDS = 4000;
  const seen = { wood: new Set<number>(), stone: new Set<number>() };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = mulberry32(seed);
    seen.wood.add(createNodeState('wood', 0, 0, TREE, rng, NO_CAPACITY_BONUS).capacity);
    seen.stone.add(createNodeState('stone', 0, 0, BOULDER_SMALL, rng, NO_CAPACITY_BONUS).capacity);
  }
  const woodValues = [...seen.wood];
  const stoneValues = [...seen.stone];
  check(
    Math.min(...woodValues) === TREE_HARVESTS_MIN && Math.max(...woodValues) === TREE_HARVESTS_MAX,
    `tree capacities span exactly ${Math.min(...woodValues)}–${Math.max(...woodValues)}`,
  );
  check(
    Math.min(...stoneValues) === ROCK_HARVESTS_MIN &&
      Math.max(...stoneValues) === ROCK_HARVESTS_MAX,
    `rock capacities span exactly ${Math.min(...stoneValues)}–${Math.max(...stoneValues)}`,
  );
  check(
    TREE_HARVESTS_MIN === EXPECTED_TREE_HARVESTS.min &&
      TREE_HARVESTS_MAX === EXPECTED_TREE_HARVESTS.max &&
      ROCK_HARVESTS_MIN === EXPECTED_ROCK_HARVESTS.min &&
      ROCK_HARVESTS_MAX === EXPECTED_ROCK_HARVESTS.max,
    'the capacity constants are the request’s 5–15 and 20–50',
  );
}

section('Capacity perks: a fresh node holds the first worker’s bonus on top of its roll');
{
  const ROLL_SEED = 77;
  for (let level = 1; level <= MAX_CRAFT_LEVEL; level++) {
    const bonus = EXPECTED_CAPACITY_BONUS[level];
    check(
      resourcingNodeCapacityBonus(level) === bonus,
      `L${level}: node capacity bonus is +${bonus}`,
    );
    const plain = createNodeState('wood', 0, 0, TREE, mulberry32(ROLL_SEED), NO_CAPACITY_BONUS);
    const perked = createNodeState('wood', 0, 0, TREE, mulberry32(ROLL_SEED), bonus);
    check(
      perked.capacity === plain.capacity + bonus && perked.remaining === perked.capacity,
      `L${level}: same roll, capacity ${plain.capacity} → ${perked.capacity}, nothing yet taken`,
    );
  }
  const rig = makeRig();
  const tree = takeTree();
  const state = rig.ledger.stateAt(tree.tileX, tree.tileY, MAX_CRAFT_LEVEL);
  const held = state?.capacity ?? 0;
  const ceiling = TREE_HARVESTS_MAX + EXPECTED_CAPACITY_BONUS[MAX_CRAFT_LEVEL];
  check(
    held >= TREE_HARVESTS_MIN + EXPECTED_CAPACITY_BONUS[MAX_CRAFT_LEVEL] && held <= ceiling,
    `a tree first worked at L${MAX_CRAFT_LEVEL} holds ${held} harvests, within the perked range`,
  );
}

section('Depletion rewrites the tiles');
{
  const rig = makeRig();
  const tree = takeTree();
  const state = rig.ledger.stateAt(tree.tileX, tree.tileY, UNPERKED_LEVEL);
  check(state !== null, 'a standing tree is a node');
  const capacity = state?.capacity ?? 0;
  for (let i = 0; i < capacity; i++) rig.ledger.spend(tree.tileX, tree.tileY, UNPERKED_LEVEL);
  const ctx = contextFor(rig, rig.human);
  const FELLING_SETTLE_TICKS = 120;
  for (let i = 0; i < FELLING_SETTLE_TICKS; i++) rig.trees.update(ctx);
  check(
    gameMap.structure[tree.tileY][tree.tileX].type !== TREE,
    `a tree worked ${capacity} times is felled to ground`,
  );

  const rock = takeRock();
  const rockState = rig.ledger.stateAt(rock.tileX, rock.tileY, UNPERKED_LEVEL);
  const rockCapacity = rockState?.capacity ?? 0;
  const rockType = gameMap.structure[rock.tileY][rock.tileX].type;
  for (let i = 0; i < rockCapacity - 1; i++)
    rig.ledger.spend(rock.tileX, rock.tileY, UNPERKED_LEVEL);
  check(
    gameMap.structure[rock.tileY][rock.tileX].type === rockType,
    'a rock one harvest from empty still stands',
  );
  const checkpoint = rig.ledger.captureCheckpoint();
  rig.ledger.spend(rock.tileX, rock.tileY, UNPERKED_LEVEL);
  check(
    harvestKindAt(gameMap, rock.tileX, rock.tileY) === null &&
      gameMap.isWalkable(rock.tileX, rock.tileY),
    `a rock worked ${rockCapacity} times crumbles to walkable ground`,
  );
  rig.ledger.restoreCheckpoint(checkpoint);
  check(
    gameMap.structure[rock.tileY][rock.tileX].type === rockType &&
      rig.ledger.stateAt(rock.tileX, rock.tileY, UNPERKED_LEVEL)?.remaining === 1,
    'a checkpoint rewound to before the crumble stands the rock back up, one harvest left',
  );
}

// ── Luck ───────────────────────────────────────────────────────────────────

section('Luck: 200,000 seeded ticks land within ±10% of the request’s rates');
{
  const TICKS = 200_000;
  const TOLERANCE = 0.1;
  const within = (observed: number, expected: number): boolean =>
    Math.abs(observed - expected) <= expected * TOLERANCE;
  const tally = (level: number, kind: HarvestKind, seed: number): Map<LuckyDrop, number> => {
    const rng = mulberry32(seed);
    const counts = new Map<LuckyDrop, number>();
    for (let i = 0; i < TICKS; i++) {
      const drop = rollHarvestLuck(level, kind, rng);
      if (drop !== null) counts.set(drop, (counts.get(drop) ?? 0) + 1);
    }
    return counts;
  };
  const woodL5 = tally(REFINED_LEVEL, 'wood', LUCK_SEED_WOOD);
  const woodRefined = ((woodL5.get('wood_board') ?? 0) + (woodL5.get('rope') ?? 0)) / TICKS;
  check(
    within(woodRefined, EXPECTED_REFINED_WOOD),
    `wood L5 refined ${woodRefined.toFixed(RATE_DIGITS)} ≈ 0.07`,
  );
  const boardShare = (woodL5.get('wood_board') ?? 0) / Math.max(1, woodRefined * TICKS);
  check(
    Math.abs(boardShare - TILE_CENTRE) < TOLERANCE / 2,
    `boards vs rope split ${boardShare.toFixed(SHARE_DIGITS)} ≈ 50/50`,
  );
  const stoneL5 = tally(REFINED_LEVEL, 'stone', LUCK_SEED_STONE);
  const dynamite = (stoneL5.get('goblin_dynamite') ?? 0) / TICKS;
  check(
    within(dynamite, EXPECTED_REFINED_STONE),
    `stone L5 dynamite ${dynamite.toFixed(RATE_DIGITS)} ≈ 0.04`,
  );
  const woodL14 = tally(KIT_LEVEL, 'wood', LUCK_SEED_KITS);
  const treb = (woodL14.get('trebuchet_kit') ?? 0) / TICKS;
  const snare = (woodL14.get('snare_kit') ?? 0) / TICKS;
  check(within(treb, EXPECTED_TREB_KIT), `L14 trebuchet kits ${treb.toFixed(RATE_DIGITS)} ≈ 0.01`);
  check(
    within(snare, (1 - EXPECTED_TREB_KIT) * EXPECTED_SNARE_KIT),
    `L14 snare kits ${snare.toFixed(RATE_DIGITS)} ≈ 0.05 of the ticks the trebuchet roll missed`,
  );
  const lowLevel = tally(BELOW_REFINED_LEVEL, 'wood', LUCK_SEED_LOW);
  check(lowLevel.size === 0, 'below level 5 nothing lucky ever happens');

  // Kits roll first: a stream whose first draw would land every chance proves
  // the kit took the tick, not the refined material.
  const alwaysLucky = (): number => 0;
  check(
    rollHarvestLuck(KIT_LEVEL, 'wood', alwaysLucky) === 'trebuchet_kit',
    'the trebuchet kit rolls first',
  );
  const draws = [EXPECTED_TREB_KIT + EPSILON, 0];
  let drawIndex = 0;
  const trebMissesSnareHits = (): number => draws[drawIndex++ % draws.length];
  check(
    rollHarvestLuck(KIT_LEVEL, 'wood', trebMissesSnareHits) === 'snare_kit',
    'a missed trebuchet roll falls to the snare roll before any refined roll',
  );
  const l15 = tally(TOP_LEVEL, 'stone', LUCK_SEED_TOP);
  const l15Refined = (l15.get('goblin_dynamite') ?? 0) / TICKS;
  const l15KitMisses = (1 - EXPECTED_TREB_KIT) * (1 - EXPECTED_SNARE_KIT);
  check(
    within(l15Refined, l15KitMisses),
    `L15 always refines when no kit lands (${l15Refined.toFixed(RATE_DIGITS)} ≈ ${l15KitMisses.toFixed(RATE_DIGITS)})`,
  );
}

// ── The channel ───────────────────────────────────────────────────────────

section('Skills are never shared: each crawler harvests at their own level');
{
  const rig = makeRig();
  teach(rig.human, FAST_LEVEL);
  teach(rig.cat, 1);
  const carlTree = takeTree();
  const donutTree = takeTree();
  stand(rig.human, carlTree);
  stand(rig.cat, donutTree);

  check(rig.harvest.tryStart(rig.human), 'Carl starts chopping');
  const catBefore = JSON.stringify(rig.cat.craftSkills.snapshot());
  const carl = nextAward(rig, rig.human, 'wood', TICKS_PER_SECOND * AWARD_WAIT_SECONDS);
  const carlExpectedTicks = Math.ceil(
    TICKS_PER_SECOND * EXPECTED_WOOD_BASE_SECONDS * (EXPECTED_SPEED.get(FAST_LEVEL) ?? 0),
  );
  check(
    carl !== null && carl.ticks === carlExpectedTicks,
    `Carl at L12 lands his first wood after ${carl?.ticks ?? 'no'} ticks (expected ${carlExpectedTicks})`,
  );
  check(
    carl !== null && carl.amount === 1,
    `Carl at L12 gets ${carl?.amount ?? 'nothing'} wood a tick (expected 1: the perk lengthens the tree, not the award)`,
  );
  check(
    JSON.stringify(rig.cat.craftSkills.snapshot()) === catBefore,
    "Carl's XP never touches Donut's Resourcing",
  );
  rig.harvest.stop(rig.human);

  check(rig.harvest.tryStart(rig.cat), 'Donut starts chopping');
  const donut = nextAward(rig, rig.cat, 'wood', TICKS_PER_SECOND * AWARD_WAIT_SECONDS);
  const donutExpectedTicks = TICKS_PER_SECOND * EXPECTED_WOOD_BASE_SECONDS;
  check(
    donut !== null && donut.ticks === donutExpectedTicks,
    `Donut at L1 lands her first wood after ${donut?.ticks ?? 'no'} ticks (expected ${donutExpectedTicks})`,
  );
  check(
    donut !== null && donut.amount === 1,
    `Donut at L1 gets ${donut?.amount ?? 'nothing'} wood (expected 1)`,
  );
  rig.harvest.stop(rig.cat);
}

section('XP: the top-tier tool trains four times as fast as the basic one');
{
  const rig = makeRig();
  teach(rig.human, 1);
  const xpPerTick = (tier: ToolTier): number => {
    rig.tools.axeTier = tier;
    stand(rig.human, takeTree());
    rig.harvest.tryStart(rig.human);
    const before = rig.human.craftSkills.getXp('resourcing');
    nextAward(rig, rig.human, 'wood', TICKS_PER_SECOND * AWARD_WAIT_SECONDS);
    rig.harvest.stop(rig.human);
    return rig.human.craftSkills.getXp('resourcing') - before;
  };
  const basic = xpPerTick(0);
  const top = xpPerTick(TOP_TIER);
  check(basic > 0, `a basic-axe tick gives XP (${basic})`);
  check(
    Math.abs(top - basic * TOP_TIER_YIELD_MULTIPLE) < EPSILON,
    `a top-tier tick gives ${top} = 4 × ${basic}`,
  );
}

section('Channel: moving, a full bag and a hostile each end it');
{
  const rig = makeRig();
  teach(rig.human, 1);
  const tree = takeTree();
  stand(rig.human, tree);
  rig.harvest.tryStart(rig.human);
  const ctx = contextFor(rig, rig.human);
  rig.harvest.update(ctx, false);
  check(rig.harvest.isHarvesting(rig.human), 'still working after a still tick');
  rig.human.x += 1;
  rig.harvest.update(ctx, false);
  check(!rig.harvest.isHarvesting(rig.human), 'a 1 px move ends the channel');
  stand(rig.human, tree);

  const filler = ITEM_DEF.basic_pickaxe;
  rig.human.inventory.removeItems('wood', rig.human.inventory.countOf('wood'));
  const slots = rig.human.inventory.bag.slots;
  const emptied: number[] = [];
  slots.forEach((slot, index) => {
    if (slot === null) emptied.push(index);
  });
  for (const index of emptied) slots[index] = { ...filler, quantity: 1 };
  rig.harvest.tryStart(rig.human);
  const full = nextAward(rig, rig.human, 'wood', TICKS_PER_SECOND * AWARD_WAIT_SECONDS);
  check(
    full === null && !rig.harvest.isHarvesting(rig.human),
    'a full bag ends the channel with nothing awarded',
  );
  check(rig.announcements.includes('Your bag is full.'), 'and says so');
  for (const index of emptied) slots[index] = null;

  rig.harvest.tryStart(rig.human);
  rig.harvest.update(ctx, false);
  const rat = new Rat(tree.standX + 1, tree.standY, TILE_SIZE);
  rig.roster.add(rat);
  rig.harvest.update(ctx, false);
  check(!rig.harvest.isHarvesting(rig.human), 'a hostile in attack range ends the channel');
}

section('Channel: a modal pauses it rather than ending it');
{
  const rig = makeRig();
  teach(rig.human, 1);
  const tree = takeTree();
  stand(rig.human, tree);
  const ctx = contextFor(rig, rig.human);
  rig.harvest.tryStart(rig.human);

  const level = rig.human.craftSkills.getLevel('resourcing');
  const interval = harvestIntervalTicks('wood', level, NO_TOOL_SPEED_BONUS);
  const before = woodHeld(rig.human);
  for (let i = 0; i < interval * 2; i++) rig.harvest.update(ctx, true);
  check(
    rig.harvest.isHarvesting(rig.human),
    'still running behind a modal, however long it stays up',
  );
  check(woodHeld(rig.human) === before, 'no award lands while paused');

  const resumed = nextAward(rig, rig.human, 'wood', interval + 1);
  check(
    resumed !== null && resumed.ticks === interval,
    `closing the modal picks the channel back up exactly where it left off: first award after ${resumed?.ticks ?? 'no'} ticks (expected ${interval})`,
  );
  rig.harvest.stop(rig.human);

  const rock = takeRock();
  stand(rig.human, rock);
  rig.harvest.tryStart(rig.human);
  const rockState = rig.ledger.stateAt(rock.tileX, rock.tileY, UNPERKED_LEVEL);
  const rockCapacity = rockState?.capacity ?? 0;
  // Spent directly on the ledger, not through the channel: a thrall on the
  // same node keeps ticking through a modal that halts the crawlers, so the
  // node can still run out from under a paused channel.
  for (let i = 0; i < rockCapacity; i++) rig.ledger.spend(rock.tileX, rock.tileY, UNPERKED_LEVEL);
  rig.harvest.update(ctx, true);
  check(
    !rig.harvest.isHarvesting(rig.human),
    'a node worked out by something else while paused still ends the channel',
  );
}

section('No Resourcing or no tool');
{
  const rig = makeRig();
  const tree = takeTree();
  stand(rig.human, tree);
  check(!rig.harvest.tryStart(rig.human), 'an untaught crawler falls through to a swing');
  check(!rig.harvest.wouldStartHarvest(rig.human), 'and the prompt check agrees');
  teach(rig.human, 1);
  check(rig.harvest.wouldStartHarvest(rig.human), 'a taught crawler beside a tree would harvest');
  rig.tools.axeTier = null;
  check(rig.harvest.tryStart(rig.human), 'a taught crawler without an axe is answered…');
  check(
    rig.announcements.includes('You need an axe for that.'),
    '…with "You need an axe for that."',
  );
}

// ── Thralls ───────────────────────────────────────────────────────────────

/** A summon spot with no node of `kind` within twelve tiles. */
function barrenSpot(kind: HarvestKind): { x: number; y: number } | null {
  const RADIUS = 12;
  const structure = gameMap.structure;
  for (let ty = RADIUS; ty < structure.length - RADIUS; ty += 3) {
    for (let tx = RADIUS; tx < structure[ty].length - RADIUS; tx += 3) {
      if (!gameMap.isWalkable(tx, ty)) continue;
      let any = false;
      for (let dy = -RADIUS; dy <= RADIUS && !any; dy++) {
        for (let dx = -RADIUS; dx <= RADIUS && !any; dx++) {
          if (harvestKindAt(gameMap, tx + dx, ty + dy) === kind) any = true;
        }
      }
      if (!any) return { x: tx, y: ty };
    }
  }
  return null;
}

section('Thralls: nothing nearby means no summon and no cooldown');
{
  resetThrallCooldownsForTests();
  const rig = makeRig();
  teach(rig.human, SUMMON_LEVEL);
  const barren = barrenSpot('stone');
  check(barren !== null, 'found a spot with no rock in reach');
  if (barren !== null) {
    rig.human.x = barren.x * TILE_SIZE;
    rig.human.y = barren.y * TILE_SIZE;
    check(rig.thralls.trySummon(rig.human, 'pickaxe') === 'nothingNearby', 'the summon is refused');
    check(
      rig.announcements.includes("There's nothing here to collect."),
      'with the request’s line',
    );
    check(thrallCooldownTicksLeft(rig.human.crawlerKind) === 0, 'and no cooldown starts');
  }
  teach(rig.cat, BELOW_SUMMON_LEVEL);
  stand(rig.cat, takeTree());
  check(
    rig.thralls.trySummon(rig.cat, 'axe') === 'notUnlocked',
    'below level 10 there is no summon',
  );
}

section('Thralls: lifetime, cooldown, count, resources, XP and no luck');
{
  resetThrallCooldownsForTests();
  const rig = makeRig();
  teach(rig.human, TOP_LEVEL);
  teach(rig.cat, 1);
  const home = takeTree();
  stand(rig.human, home);
  const catXpBefore = JSON.stringify(rig.cat.craftSkills.snapshot());
  const humanWoodBefore = woodHeld(rig.human);
  const catWoodBefore = woodHeld(rig.cat);
  check(rig.thralls.trySummon(rig.human, 'axe') === 'summoned', 'Carl at L15 summons');
  check(
    rig.thralls.snapshot.length === TOP_LEVEL_THRALLS,
    `level 15 summons three (${rig.thralls.snapshot.length})`,
  );

  const LUCKY: readonly ItemId[] = [
    'trebuchet_kit',
    'snare_kit',
    'wood_board',
    'rope',
    'goblin_dynamite',
  ];
  const luckyBefore = LUCKY.map((id) => rig.human.inventory.countOf(id));
  let workingTicks = 0;
  let gone = -1;
  let readyAgainAt = -1;
  for (let tick = 1; tick <= THRALL_COOLDOWN_TICKS + 1; tick++) {
    rig.thralls.update();
    const views = rig.thralls.snapshot;
    if (views.some((view) => !view.fading)) workingTicks = tick;
    if (gone < 0 && views.length === 0) gone = tick;
    if (readyAgainAt < 0 && thrallCooldownTicksLeft(rig.human.crawlerKind) === 0)
      readyAgainAt = tick;
  }
  check(
    workingTicks === THRALL_LIFETIME_TICKS - 1,
    `thralls work for 45 s of fixed ticks (last working tick ${workingTicks + 1})`,
  );
  check(gone > THRALL_LIFETIME_TICKS, `and fade out after it (gone at tick ${gone})`);
  check(
    readyAgainAt === THRALL_COOLDOWN_TICKS,
    `the cooldown is 60 s of fixed ticks (ready at ${readyAgainAt})`,
  );
  check(woodHeld(rig.human) > humanWoodBefore, 'the wood went to the summoner');
  check(woodHeld(rig.cat) === catWoodBefore, 'and none to the other crawler');
  check(
    JSON.stringify(rig.cat.craftSkills.snapshot()) === catXpBefore,
    'the other crawler earned no XP',
  );
  const luckyAfter = LUCKY.map((id) => rig.human.inventory.countOf(id));
  check(
    luckyAfter.every((count, index) => count === luckyBefore[index]),
    'thralls never roll luck, even for a level-15 summoner whose own harvests always refine',
  );
}

section('Thralls: a quarter of the XP, to the summoner alone');
{
  resetThrallCooldownsForTests();
  const rig = makeRig();
  teach(rig.human, SUMMON_LEVEL);
  teach(rig.cat, SUMMON_LEVEL);
  rig.tools.axeTier = FORGE_TIER;
  stand(rig.human, takeTree());
  const catBefore = JSON.stringify(rig.cat.craftSkills.snapshot());
  const xpBefore = rig.human.craftSkills.getXp('resourcing');
  const woodBefore = woodHeld(rig.human);
  rig.thralls.trySummon(rig.human, 'axe');
  let gained = -1;
  for (let tick = 0; tick < TICKS_PER_SECOND * GLIDE_WAIT_SECONDS && gained < 0; tick++) {
    rig.thralls.update();
    if (woodHeld(rig.human) !== woodBefore) {
      gained = rig.human.craftSkills.getXp('resourcing') - xpBefore;
    }
  }
  const yieldMultiplier = TOOL_TIERS.axe[FORGE_TIER].yieldMultiplier;
  const expected = harvestXp(yieldMultiplier) * EXPECTED_THRALL_XP_SHARE;
  check(
    Math.abs(gained - expected) < EPSILON &&
      Math.abs(thrallHarvestXp(yieldMultiplier) - expected) < EPSILON,
    `a thrall harvest gives the summoner ${gained} XP = 25% of ${harvestXp(yieldMultiplier)}`,
  );
  check(
    JSON.stringify(rig.cat.craftSkills.snapshot()) === catBefore,
    'and the other crawler nothing',
  );
}

section('Thralls glide straight, through whatever is in the way');
{
  resetThrallCooldownsForTests();
  const rig = makeRig();
  teach(rig.human, SUMMON_LEVEL);
  // Summon sites until one has a tree whose straight route from the thrall's
  // first stand passes over something solid; the map is seeded, so the same
  // site is chosen every run.
  let setup: { first: GlidePoint; firstNode: TileRef; target: TileRef } | null = null;
  for (let attempt = 0; attempt < GLIDE_ATTEMPTS && setup === null; attempt++) {
    resetThrallCooldownsForTests();
    rig.thralls.dismissAll();
    stand(rig.human, takeTree());
    if (rig.thralls.trySummon(rig.human, 'axe') !== 'summoned') continue;
    const arrival = tickUntilStill(rig);
    if (arrival === null || arrival.node === null) continue;
    const homeX = rig.human.x + TILE_SIZE * TILE_CENTRE;
    const homeY = rig.human.y + TILE_SIZE * TILE_CENTRE;
    const target = treeBehindSomethingSolid(arrival, arrival.node, homeX, homeY);
    if (target === null) continue;
    setup = { first: arrival, firstNode: arrival.node, target };
  }
  check(setup !== null, 'found a tree with something solid between it and a working thrall');
  if (setup !== null) {
    const { first, firstNode, target } = setup;
    // Every other tree in reach is worked out, so the one left is where it must go.
    const exhaustRadius = EXPECTED_THRALL_SEARCH_RADIUS_TILES + GLIDE_EXHAUST_MARGIN_TILES;
    const homeTileX = Math.floor(rig.human.x / TILE_SIZE + TILE_CENTRE);
    const homeTileY = Math.floor(rig.human.y / TILE_SIZE + TILE_CENTRE);
    for (let dy = -exhaustRadius; dy <= exhaustRadius; dy++) {
      for (let dx = -exhaustRadius; dx <= exhaustRadius; dx++) {
        const tileX = homeTileX + dx;
        const tileY = homeTileY + dy;
        if (tileX === target.tileX && tileY === target.tileY) continue;
        const state = rig.ledger.stateAt(tileX, tileY, UNPERKED_LEVEL);
        if (state !== null && state.kind === 'wood') state.remaining = 0;
      }
    }
    const path: GlidePoint[] = [first];
    let reachedTarget = false;
    for (let tick = 0; tick < TICKS_PER_SECOND * GLIDE_WAIT_SECONDS && !reachedTarget; tick++) {
      rig.thralls.update();
      const view = rig.thralls.snapshot[0];
      const previous = path[path.length - 1];
      path.push({ x: view.x, y: view.y });
      const still = view.x === previous.x && view.y === previous.y;
      const workingTarget = view.node?.tileX === target.tileX && view.node.tileY === target.tileY;
      const besideTarget =
        Math.hypot(
          view.x / TILE_SIZE + TILE_CENTRE - (target.tileX + TILE_CENTRE),
          view.y / TILE_SIZE + TILE_CENTRE - (target.tileY + TILE_CENTRE),
        ) <=
        WORK_STAND_OFF_TILES + STAND_TOLERANCE_TILES;
      reachedTarget = still && workingTarget && besideTarget;
    }
    check(reachedTarget, 'with its tree worked out it goes to stand at the next one in reach');
    const legs = glideLegs(path);
    check(legs.length === 1, `it gets there in one leg, with no stop on the way (${legs.length})`);
    check(legs.every(isStraight), 'and that leg is one straight line');
    const crossed = legs.some((leg) =>
      leg.some((point) => isSolidInTheWay(point, firstNode, target)),
    );
    check(crossed, 'a thrall crossed a solid tile on its way to work');
  }
  rig.thralls.dismissAll();
  resetThrallCooldownsForTests();
}

// ── Concurrent harvesting: two crawlers, one channel each ──────────────────

section("Concurrent harvesting: Carl starting his own never stops Donut's");
{
  // A second walkable side of the same tree, clear of any other node within
  // reach from there, so Carl and Donut can work one tile from two tiles at
  // once without either one's `nodeInReach` picking something else instead.
  function onlyNodeNear(
    standTileX: number,
    standTileY: number,
    tileX: number,
    tileY: number,
  ): boolean {
    const searchTiles = Math.ceil(HARVEST_REACH_TILES);
    for (let ty = standTileY - searchTiles; ty <= standTileY + searchTiles; ty++) {
      for (let tx = standTileX - searchTiles; tx <= standTileX + searchTiles; tx++) {
        if (tx === tileX && ty === tileY) continue;
        if (harvestKindAt(gameMap, tx, ty) === null) continue;
        const dx = (tx + TILE_CENTRE) * TILE_SIZE - (standTileX + TILE_CENTRE) * TILE_SIZE;
        const dy = (ty + TILE_CENTRE) * TILE_SIZE - (standTileY + TILE_CENTRE) * TILE_SIZE;
        if (Math.hypot(dx, dy) <= HARVEST_REACH_TILES * TILE_SIZE) return false;
      }
    }
    return true;
  }

  function secondStand(spot: Spot): { x: number; y: number } | null {
    for (const [dx, dy] of NEIGHBOURS) {
      const sx = spot.tileX + dx;
      const sy = spot.tileY + dy;
      if (sx === spot.standX && sy === spot.standY) continue;
      if (!gameMap.isWalkable(sx, sy)) continue;
      if (!onlyNodeNear(sx, sy, spot.tileX, spot.tileY)) continue;
      return { x: sx, y: sy };
    }
    return null;
  }

  // Drawn through `takeTree()`, not indexed into `TREE_SPOTS` directly: earlier
  // sections have already felled some of these tiles for real on the shared
  // `gameMap`, and a raw index could land back on one of those stumps.
  let sharedSpot: Spot | null = null;
  let sharedSecond: { x: number; y: number } | null = null;
  for (const _attempt of TREE_SPOTS) {
    const spot = takeTree();
    if (harvestKindAt(gameMap, spot.tileX, spot.tileY) !== 'wood') continue;
    const candidate = secondStand(spot);
    if (candidate === null) continue;
    sharedSpot = spot;
    sharedSecond = candidate;
    break;
  }
  check(sharedSpot !== null && sharedSecond !== null, 'found a tree workable from two sides');

  if (sharedSpot !== null && sharedSecond !== null) {
    const spot = sharedSpot;
    const second = sharedSecond;
    const rig = makeRig();
    teach(rig.human, 1);
    teach(rig.cat, 1);
    stand(rig.cat, spot);
    rig.human.x = second.x * TILE_SIZE;
    rig.human.y = second.y * TILE_SIZE;

    check(rig.harvest.tryStart(rig.cat), 'Donut starts working the tree first');
    const ctx = contextFor(rig, rig.human);
    rig.harvest.update(ctx, false);
    check(rig.harvest.isHarvesting(rig.cat), 'Donut is mid-channel');

    rig.harvest.tryStart(rig.human);
    check(
      rig.harvest.isHarvesting(rig.cat),
      "Carl starting his own harvest never cancels Donut's — the reported regression",
    );
    check(rig.harvest.isHarvesting(rig.human), 'and Carl is now working the same tree too');

    const state = rig.ledger.knownStateAt(spot.tileX, spot.tileY);
    check(state !== null, 'the shared node has a known capacity');
    const capacity = state?.capacity ?? 0;
    const interval = harvestIntervalTicks('wood', 1, NO_TOOL_SPEED_BONUS);
    const soloTicksToDeplete = capacity * interval;
    // Donut got one extra tick's head start above (the update that proved she
    // was already mid-channel before Carl joined), so the two channels are not
    // in perfect lockstep — this brackets "roughly half the solo time" rather
    // than asserting an exact tick, which the offset would otherwise break.
    const COMBINED_RATE_LOWER_FRACTION = 0.4;
    const COMBINED_RATE_UPPER_FRACTION = 0.6;
    const combinedLowerBound = soloTicksToDeplete * COMBINED_RATE_LOWER_FRACTION - interval;
    const combinedUpperBound = soloTicksToDeplete * COMBINED_RATE_UPPER_FRACTION + interval;

    const carlWoodBefore = rig.human.inventory.countOf('wood');
    const donutWoodBefore = rig.cat.inventory.countOf('wood');
    const maxTicks = soloTicksToDeplete + interval;
    let tick = 0;
    for (; tick < maxTicks; tick++) {
      rig.harvest.update(ctx, false);
      if (!rig.harvest.isHarvesting(rig.human) && !rig.harvest.isHarvesting(rig.cat)) break;
    }
    check(
      !rig.harvest.isHarvesting(rig.human) && !rig.harvest.isHarvesting(rig.cat),
      `the shared node depletes with both still on it (stopped after ${tick} ticks)`,
    );
    check(
      tick >= combinedLowerBound && tick <= combinedUpperBound,
      `the combined rate empties it in ${tick} ticks — roughly half the ${soloTicksToDeplete} a lone harvester would take (expected between ${combinedLowerBound} and ${combinedUpperBound})`,
    );
    const woodGained =
      rig.human.inventory.countOf('wood') -
      carlWoodBefore +
      (rig.cat.inventory.countOf('wood') - donutWoodBefore);
    check(
      woodGained === capacity,
      `the node's whole capacity (${capacity}) landed between the two bags, none lost or doubled (got ${woodGained})`,
    );

    const carlWoodAfterDepletion = rig.human.inventory.countOf('wood');
    const donutWoodAfterDepletion = rig.cat.inventory.countOf('wood');
    for (let i = 0; i < interval * 2; i++) rig.harvest.update(ctx, false);
    check(
      !rig.harvest.isHarvesting(rig.human) &&
        !rig.harvest.isHarvesting(rig.cat) &&
        rig.human.inventory.countOf('wood') === carlWoodAfterDepletion &&
        rig.cat.inventory.countOf('wood') === donutWoodAfterDepletion,
      'neither auto-restarts on another node once this one is spent',
    );
  }
}

section('Concurrent harvesting: different nodes each progress on their own');
{
  const rig = makeRig();
  teach(rig.human, 1);
  teach(rig.cat, 1);
  const carlTree = takeTree();
  const donutTree = takeTree();
  stand(rig.human, carlTree);
  stand(rig.cat, donutTree);

  check(rig.harvest.tryStart(rig.human), 'Carl starts his own tree');
  check(rig.harvest.tryStart(rig.cat), "Donut starts hers, unaffected by Carl's channel");
  check(
    rig.harvest.isHarvesting(rig.human) && rig.harvest.isHarvesting(rig.cat),
    'both are mid-channel at once',
  );

  const ctx = contextFor(rig, rig.human);
  const interval = harvestIntervalTicks('wood', 1, NO_TOOL_SPEED_BONUS);
  const carlWoodBefore = rig.human.inventory.countOf('wood');
  const donutWoodBefore = rig.cat.inventory.countOf('wood');
  for (let tick = 0; tick < interval; tick++) rig.harvest.update(ctx, false);
  check(
    rig.human.inventory.countOf('wood') === carlWoodBefore + 1 &&
      rig.cat.inventory.countOf('wood') === donutWoodBefore + 1,
    'each lands their own first award on schedule, independent of the other',
  );
  check(
    rig.harvest.isHarvesting(rig.human) && rig.harvest.isHarvesting(rig.cat),
    'and both keep working their own node afterward',
  );
  rig.harvest.stop(rig.human);
  rig.harvest.stop(rig.cat);
}

console.log(`\n${checks - failures}/${checks} harvest checks passed.`);
if (failures > 0) {
  console.error(`${failures} harvest check(s) FAILED.`);
  process.exit(1);
}
