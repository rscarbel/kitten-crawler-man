#!/usr/bin/env tsx
/**
 * Headless gate on the village assault's undead — Vordrick Boneharrow the
 * necromancer, the Grave Bull and the raised ratkin — and the siege strike
 * they share, run on a real floor-3 `GameMap` with Briar Hollow on it, through
 * the real mob loop, summon system and projectile system.
 *
 *   npm run verify:necromancer [-- --fault=necro-enters|merged-cap|no-anchor]
 *
 * Each fault breaks what one section guards and must turn it red:
 *  - `necro-enters` lifts the necromancer's wall clamp, so the knockbacks the
 *    home-zone streams throw at him carry him through the breaches;
 *  - `merged-cap` counts his raises against the wave's live cap, which the
 *    starvation check must catch;
 *  - `no-anchor` leaves him no spot to settle on, so he never walks from his
 *    lane's spawn into his home zone.
 */

import { gameContext } from './nodeGameContext';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createBriarHollowState } from '../src/core/briarHollowState';
import type { CrawlerKind } from '../src/core/SkillManager';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob } from '../src/creatures/Mob';
import type { Player } from '../src/Player';
import { GameMap } from '../src/map/GameMap';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import type { SystemContext } from '../src/systems/GameSystem';
import { SkeletonSummonSystem } from '../src/systems/SkeletonSummonSystem';
import {
  HOLLOW_SOUL_BOLT_SPEED,
  SkeletonProjectileSystem,
} from '../src/systems/SkeletonProjectileSystem';
import { DefenseStructures, type StructureRef } from '../src/systems/briarHollow/DefenseStructures';
import { WALL_TIERS } from '../src/systems/briarHollow/structureRules';
import {
  trebuchetDirectDamage,
  trebuchetSplashDamage,
} from '../src/systems/briarHollow/TrebuchetSystem';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling';
import { BOSS_BLAST_DAMAGE_SCALE } from '../src/creatures/Mob';
import {
  NECRO_BOLT_TELEGRAPH_FRAMES,
  NECRO_ESCORT_CAP,
  NECRO_MIN_WALL_DISTANCE_TILES,
  NECRO_PULSE_CHANNEL_FRAMES,
  NECRO_PULSE_RANGE_TILES,
  NECRO_PULSE_STRUCTURE_DAMAGE,
  NECRO_RAISE_TELEGRAPH_FRAMES,
  Necromancer,
  necroPulseInterruptDamage,
} from '../src/creatures/Necromancer';
import {
  GRAVE_BULL_CHARGE_MAX_TILES,
  GRAVE_BULL_CHARGE_SPEED,
  GRAVE_BULL_PAW_TELEGRAPH_FRAMES,
  GRAVE_BULL_STRUCTURE_MULTIPLIER,
  GraveBull,
} from '../src/creatures/GraveBull';
import { RAISED_RATKIN_HP, RaisedRatkin } from '../src/creatures/RaisedRatkin';
import { RuinsGhoul } from '../src/creatures/RuinsGhoul';
import { SkeletonWarrior } from '../src/creatures/SkeletonWarrior';
import { SkeletonArcher } from '../src/creatures/SkeletonArcher';
import {
  enlistInSiege,
  isInsidePalisadeTile,
  isStandingStructure,
  nearestStructurePoint,
  tileUnder,
} from '../src/creatures/siege/siegeCapability';
import { palisadeDistanceFor, INSIDE_PALISADE } from '../src/creatures/siege/palisadeDistance';
import {
  isNecromancerRaise,
  livingAssaultSpawns,
  livingNecromancerRaises,
} from '../src/creatures/siege/assaultCaps';
import type { SiegeFlowQuery, SiegeTile, SiegeWorld } from '../src/creatures/siege/siegeTypes';
import { SKELETON_RISE_FRAMES } from '../src/sprites/skeletonTiming';
import { RISE_FRAMES } from '../src/sprites/art/raisedRatkinFigure';
import { DEATH_FRAMES } from '../src/sprites/art/necromancerFigure';
import { NECROMANCER_STANDING_PREWARM_LEAD_FRAMES } from '../src/sprites/necromancerSprite';
import { MAX_MOB_LEVEL } from '../src/levels/spawner';
import { tileCoordKey } from '../src/map/tileIndex';

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
/** The level every creature here is levelled to: the village's band sits at 5–8. */
const TEST_LEVEL = 7;
const HALF = TILE_SIZE / 2;

// ── The request's own numbers ─────────────────────────────────────────────
// Written out rather than imported, so a constant that drifts from what was
// asked for fails here instead of agreeing with itself.
const REQUEST_ESCORT_CAP = 8;
const REQUEST_MIN_WALL_DISTANCE_TILES = 3;
const REQUEST_PULSE_CHANNEL_FRAMES = 90;
const REQUEST_PULSE_STONE_SHARE = 0.25;
const REQUEST_BULL_STRUCTURE_MULTIPLE = 6;
const REQUEST_BULL_PAW_FRAMES = 60;
const REQUEST_BULL_MAX_CHARGE_TILES = 8;

/** A small seeded generator, so each stream replays exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  console.error('verify:necromancer FAILED: the map has no Briar Hollow site');
  process.exit(1);
}
const site: BriarHollowSite = maybeSite;
const field = palisadeDistanceFor(site);

function laneOf(id: 'east' | 'south') {
  const lane = site.assaultLanes.find((candidate) => candidate.id === id);
  if (lane === undefined) throw new Error(`no ${id} lane`);
  return lane;
}

/**
 * A stand-in for the assault's flow field: Dijkstra from the bell over the
 * village and its surroundings, walkable ground costing one, a standing
 * structure costing its health over a chewing rate, the gate and solid ground
 * impassable. Enough to walk a siege mob into the wall in front of it.
 */
class TestFlow implements SiegeFlowQuery {
  private readonly cost = new Map<number, number>();
  private static readonly MARGIN = 30;
  private static readonly CHEW_RATE = 10;

  constructor(private readonly defense: DefenseStructures) {
    this.rebuild();
  }

  private stepCost(tileX: number, tileY: number): number {
    if (this.defense.isGateTile(tileX, tileY)) return Infinity;
    const ref = this.defense.at(tileX, tileY);
    if (ref !== null && isStandingStructure(this.defense, ref)) {
      return 1 + this.defense.hp(ref) / TestFlow.CHEW_RATE;
    }
    return gameMap.isWalkableForHostile(tileX, tileY) ? 1 : Infinity;
  }

  rebuild(): void {
    this.cost.clear();
    const bounds = site.palisadeBounds;
    const minX = bounds.x - TestFlow.MARGIN;
    const minY = bounds.y - TestFlow.MARGIN;
    const maxX = bounds.x + bounds.w + TestFlow.MARGIN;
    const maxY = bounds.y + bounds.h + TestFlow.MARGIN;
    const bell = site.square.bellTile;
    const open: Array<{ key: number; x: number; y: number; cost: number }> = [
      { key: tileCoordKey(bell.x, bell.y), x: bell.x, y: bell.y, cost: 0 },
    ];
    this.cost.set(tileCoordKey(bell.x, bell.y), 0);
    while (open.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].cost < open[bestIndex].cost) bestIndex = i;
      }
      const [current] = open.splice(bestIndex, 1);
      if (current === undefined) break;
      if (current.cost > (this.cost.get(current.key) ?? Infinity)) continue;
      for (const [dx, dy] of NEIGHBOURS_4) {
        const x = current.x + dx;
        const y = current.y + dy;
        if (x < minX || y < minY || x > maxX || y > maxY) continue;
        const step = this.stepCost(x, y);
        if (!Number.isFinite(step)) continue;
        const next = current.cost + step;
        const key = tileCoordKey(x, y);
        if (next >= (this.cost.get(key) ?? Infinity)) continue;
        this.cost.set(key, next);
        open.push({ key, x, y, cost: next });
      }
    }
  }

  nextStep(tile: SiegeTile): SiegeTile | null {
    const here = this.cost.get(tileCoordKey(tile.x, tile.y)) ?? Infinity;
    let best: SiegeTile | null = null;
    let bestCost = here;
    for (const [dx, dy] of NEIGHBOURS_4) {
      const cost = this.cost.get(tileCoordKey(tile.x + dx, tile.y + dy)) ?? Infinity;
      if (cost < bestCost) {
        bestCost = cost;
        best = { x: tile.x + dx, y: tile.y + dy };
      }
    }
    return best;
  }

  blockingStructure(tile: SiegeTile): StructureRef | null {
    const next = this.nextStep(tile);
    if (next === null) return null;
    const ref = this.defense.at(next.x, next.y);
    return ref !== null && isStandingStructure(this.defense, ref) ? ref : null;
  }
}

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface Rig {
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly defense: DefenseStructures;
  readonly flow: TestFlow;
  readonly world: SiegeWorld;
  readonly loop: MobUpdateLoop;
  readonly summons: SkeletonSummonSystem;
  readonly projectiles: SkeletonProjectileSystem;
  readonly ctx: SystemContext;
  readonly deaths: Map<Mob, number>;
}

function makeRig(): Rig {
  const state = createBriarHollowState();
  const bus = new EventBus();
  const roster = new MobRoster(gameMap, new SpellSystem());
  const human = new HumanPlayer(site.square.bellTile.x, site.square.bellTile.y + 3, TILE_SIZE);
  const cat = new CatPlayer(site.square.bellTile.x + 1, site.square.bellTile.y + 3, TILE_SIZE);
  human.isActive = true;
  const crawlerOf = (kind: CrawlerKind) => (kind === 'human' ? human : cat);
  const defense = new DefenseStructures({
    gameMap,
    site,
    state,
    bus,
    audio: null,
    roster,
    constructionLevel: () => 1,
    crawler: crawlerOf,
    onTileChanged: () => undefined,
    clockSeconds: () => 0,
    random: () => 0,
  });
  const flow = new TestFlow(defense);
  const world: SiegeWorld = { defense, flow, site, mobs: roster.mobs };
  const summons = new SkeletonSummonSystem(gameMap, (mob) => roster.add(mob));
  const projectiles = new SkeletonProjectileSystem(gameMap);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  };
  return {
    roster,
    human,
    cat,
    defense,
    flow,
    world,
    loop: new MobUpdateLoop(),
    summons,
    projectiles,
    ctx,
    deaths: new Map(),
  };
}

/** One frame: the mob loop, the summons, the projectiles, then kill resolution as `resolveKills` does it. */
function step(rig: Rig): void {
  rig.loop.update(rig.ctx);
  rig.summons.update(rig.ctx);
  rig.projectiles.update(rig.ctx);
  for (const mob of rig.roster.mobs) {
    if (mob.isAlive || !mob.rendersWhenDead || mob.corpseExpired) continue;
    mob.advanceCorpse();
    if (!mob.belongsInMobGrid) rig.roster.grid.remove(mob);
  }
  for (const mob of rig.roster.mobs) {
    if (!mob.justDied) continue;
    mob.justDied = false;
    rig.deaths.set(mob, (rig.deaths.get(mob) ?? 0) + 1);
    mob.dispose();
    if (!mob.belongsInMobGrid) rig.roster.grid.remove(mob);
  }
}

function spawnNecromancer(rig: Rig, tile: SiegeTile): Necromancer {
  const necro = new Necromancer(tile.x, tile.y, TILE_SIZE);
  necro.applyMobLevel(TEST_LEVEL);
  enlistInSiege(necro, rig.world);
  rig.roster.add(necro);
  return necro;
}

function placeCrawler(crawler: Player, tileX: number, tileY: number): void {
  crawler.x = tileX * TILE_SIZE;
  crawler.y = tileY * TILE_SIZE;
}

function keepCrawlersStanding(rig: Rig): void {
  for (const crawler of [rig.human, rig.cat]) crawler.hp = crawler.maxHp;
}

function upgradeSegmentsTo(rig: Rig, predicate: (id: string) => boolean): void {
  for (const segment of site.segments) {
    if (!predicate(segment.id)) continue;
    rig.defense.applyUpgrade({ kind: 'segment', id: segment.id }, 'human');
  }
}

function segmentAt(tileX: number, tileY: number): string | null {
  return (
    site.segments.find((segment) => segment.tiles.some((t) => t.x === tileX && t.y === tileY))
      ?.id ?? null
  );
}

function southWallSegmentIds(): Set<string> {
  const southRow = site.palisadeBounds.y + site.palisadeBounds.h - 1;
  const ids = new Set<string>();
  for (const segment of site.segments) {
    if (segment.tiles.some((tile) => tile.y === southRow)) ids.add(segment.id);
  }
  return ids;
}

// ── 1. The telegraphs ─────────────────────────────────────────────────────

section("The request's numbers");
check(NECRO_ESCORT_CAP === REQUEST_ESCORT_CAP, `escort cap ${NECRO_ESCORT_CAP}`);
check(
  NECRO_MIN_WALL_DISTANCE_TILES === REQUEST_MIN_WALL_DISTANCE_TILES,
  `nearest to the wall ${NECRO_MIN_WALL_DISTANCE_TILES} tiles`,
);
check(
  NECRO_PULSE_CHANNEL_FRAMES === REQUEST_PULSE_CHANNEL_FRAMES,
  `pulse channel ${NECRO_PULSE_CHANNEL_FRAMES}`,
);
check(
  NECRO_PULSE_STRUCTURE_DAMAGE === Math.round(WALL_TIERS.stone.baseHp * REQUEST_PULSE_STONE_SHARE),
  `pulse damage ${NECRO_PULSE_STRUCTURE_DAMAGE}, a quarter of a stone wall`,
);
check(
  GRAVE_BULL_STRUCTURE_MULTIPLIER === REQUEST_BULL_STRUCTURE_MULTIPLE,
  `the bull's charge lands at ${GRAVE_BULL_STRUCTURE_MULTIPLIER}× on a structure`,
);
check(
  GRAVE_BULL_PAW_TELEGRAPH_FRAMES === REQUEST_BULL_PAW_FRAMES,
  `the paw lasts ${GRAVE_BULL_PAW_TELEGRAPH_FRAMES}`,
);
check(
  GRAVE_BULL_CHARGE_MAX_TILES === REQUEST_BULL_MAX_CHARGE_TILES,
  `a charge runs at most ${GRAVE_BULL_CHARGE_MAX_TILES} tiles`,
);

section('Telegraphs: every wind-up at least the locked-telegraph floor');
check(
  NECRO_RAISE_TELEGRAPH_FRAMES >= LOCKED_TELEGRAPH_MIN_FRAMES,
  `raise sigils show ${NECRO_RAISE_TELEGRAPH_FRAMES} frames before the dead rise (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
);
check(
  NECRO_BOLT_TELEGRAPH_FRAMES >= LOCKED_TELEGRAPH_MIN_FRAMES,
  `the bolt fan shows ${NECRO_BOLT_TELEGRAPH_FRAMES} frames before the volley (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
);
check(
  NECRO_PULSE_CHANNEL_FRAMES >= LOCKED_TELEGRAPH_MIN_FRAMES,
  `the grave pulse channels ${NECRO_PULSE_CHANNEL_FRAMES} frames before it lands (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
);
check(
  GRAVE_BULL_PAW_TELEGRAPH_FRAMES >= LOCKED_TELEGRAPH_MIN_FRAMES,
  `the bull paws ${GRAVE_BULL_PAW_TELEGRAPH_FRAMES} frames before it charges (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
);
check(
  HOLLOW_SOUL_BOLT_SPEED < PLAYER_SPEED,
  `soul bolts fly at ${HOLLOW_SOUL_BOLT_SPEED.toFixed(2)} px/frame, under the player's ${PLAYER_SPEED}`,
);

/** Whether the ground mark draws any visible pixel, on a canvas framed around the necromancer. */
function telegraphPaints(necro: Necromancer): boolean {
  const spanTiles = 30;
  const size = spanTiles * TILE_SIZE;
  const ctx = gameContext(size, size);
  const camX = necro.x - size / 2;
  const camY = necro.y - size / 2;
  necro.renderGroundTelegraph(ctx, camX, camY);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 0) return true;
  }
  return false;
}

{
  const rig = makeRig();
  const southIds = southWallSegmentIds();
  upgradeSegmentsTo(rig, (id) => southIds.has(id));
  // A wall to pulse at: the segment in front of the south approach, worn down.
  const approach = laneOf('south').approach;
  const wornId = segmentAt(approach.x + 3, approach.y - 3);
  if (wornId !== null) {
    rig.defense.damage(
      { kind: 'segment', id: wornId },
      WALL_TIERS.wood.baseHp * 0.5,
      null,
      'blast',
    );
  }
  rig.flow.rebuild();
  const necro = spawnNecromancer(rig, laneOf('south').spawn);
  const watchedRow = approach.y - 3;
  placeCrawler(rig.human, approach.x + 4, watchedRow);
  placeCrawler(rig.cat, site.square.bellTile.x, site.square.bellTile.y);

  interface CastWatch {
    shownFrames: number;
    paintedFrames: number;
    firstAngle: number | null;
    landed: boolean;
    payloadAfter: number;
  }
  const watches: Record<'raise' | 'bolt' | 'pulse', CastWatch[]> = {
    raise: [],
    bolt: [],
    pulse: [],
  };
  let current: { kind: 'raise' | 'bolt' | 'pulse'; watch: CastWatch } | null = null;
  let boltsSeen = 0;
  let raisesSeen = 0;
  let pulsesSeen = 0;
  let volleyAnglesOk = true;
  const volleyAngleError = 1e-6;

  for (let frame = 0; frame < UPDATES_PER_SECOND * 60; frame++) {
    keepCrawlersStanding(rig);
    // The target keeps moving through every cast, so a bolt re-aimed on its
    // release frame would miss the fan the ground showed.
    placeCrawler(rig.human, approach.x + 4 + Math.round(Math.sin(frame / 20) * 3), watchedRow);
    step(rig);
    const telegraph = necro.groundTelegraph;
    if (telegraph !== null && telegraph.kind !== 'blink') {
      if (current === null || current.kind !== telegraph.kind) {
        const watch: CastWatch = {
          shownFrames: 0,
          paintedFrames: 0,
          firstAngle: telegraph.kind === 'bolt' ? telegraph.angle : null,
          landed: false,
          payloadAfter: 0,
        };
        watches[telegraph.kind].push(watch);
        current = { kind: telegraph.kind, watch };
      }
      current.watch.shownFrames++;
      if (current.watch.paintedFrames < LOCKED_TELEGRAPH_MIN_FRAMES && telegraphPaints(necro)) {
        current.watch.paintedFrames++;
      }
    }
    const bolts = rig.projectiles.shotsInFlight.filter(
      (shot) => shot.kind === 'hollow_soul_bolt' && shot.owner === necro,
    );
    if (bolts.length > boltsSeen && current?.kind === 'bolt') {
      current.watch.landed = true;
      current.watch.payloadAfter = current.watch.shownFrames;
      const angle = current.watch.firstAngle;
      for (const shot of bolts.slice(boltsSeen)) {
        const heading = Math.atan2(shot.vy, shot.vx);
        const offsets = [-1, 0, 1].map((k) => Math.abs(heading - ((angle ?? 0) + k * 0.18)));
        if (Math.min(...offsets) > volleyAngleError) volleyAnglesOk = false;
      }
      current = null;
    }
    boltsSeen = bolts.length;
    const raises = rig.roster.mobs.filter((mob) => isNecromancerRaise(mob)).length;
    if (raises > raisesSeen && current?.kind === 'raise') {
      current.watch.landed = true;
      current.watch.payloadAfter = current.watch.shownFrames;
      current = null;
    }
    raisesSeen = raises;
    if (necro.pulsesLanded > pulsesSeen && current?.kind === 'pulse') {
      current.watch.landed = true;
      current.watch.payloadAfter = current.watch.shownFrames;
      current = null;
    }
    pulsesSeen = necro.pulsesLanded;
    if (telegraph === null && current !== null && current.kind !== 'raise') current = null;
  }

  for (const kind of ['raise', 'bolt', 'pulse'] as const) {
    const landed = watches[kind].filter((watch) => watch.landed);
    check(landed.length > 0, `${kind}: at least one cast reached its payload (${landed.length})`);
    const shortest = Math.min(...landed.map((watch) => watch.payloadAfter));
    check(
      landed.length > 0 && shortest >= LOCKED_TELEGRAPH_MIN_FRAMES,
      `${kind}: the ground mark was up ${shortest} frames before the payload, at least ${LOCKED_TELEGRAPH_MIN_FRAMES}`,
    );
    const painted = Math.min(...landed.map((watch) => watch.paintedFrames));
    check(
      landed.length > 0 && painted >= LOCKED_TELEGRAPH_MIN_FRAMES,
      `${kind}: the mark actually painted pixels on ${painted} of its first ${LOCKED_TELEGRAPH_MIN_FRAMES} frames`,
    );
  }
  check(volleyAnglesOk, 'every bolt flew along the fan locked when the cast began');
}

// ── 1b. Arrival ───────────────────────────────────────────────────────────

section('Home zone: from each lane he reaches his zone and holds it');
{
  /** How long he may take to walk from his lane's spawn to his zone, and how long the watch runs. */
  const ARRIVAL_LIMIT_SECONDS = 45;
  const WATCH_SECONDS = 120;
  /** The least share of the watch, after arriving, he must spend in the zone. */
  const MIN_ZONE_SHARE = 0.75;
  /** Movement under this many pixels in an update is standing still, whatever `isMoving` says. */
  const STATIONARY_PX = 0.25;
  /** The most of his time in the zone he may spend playing the drift while standing still. */
  const MAX_DRIFT_IN_PLACE_SHARE = 0.05;
  if (fault === 'no-anchor') Reflect.set(Necromancer.prototype, 'homeAnchor', () => null);
  for (const laneId of ['east', 'south'] as const) {
    Math.random = mulberry32(laneId === 'east' ? 11 : 12);
    const rig = makeRig();
    const necro = spawnNecromancer(rig, laneOf(laneId).spawn);
    placeCrawler(rig.human, site.square.bellTile.x, site.square.bellTile.y + 4);
    placeCrawler(rig.cat, site.square.bellTile.x + 2, site.square.bellTile.y + 4);
    let arrivedAt: number | null = null;
    let inZoneAfter = 0;
    let framesAfter = 0;
    let warmedAt: number | null = null;
    let firstStandingDraw: number | null = null;
    let driftInPlace = 0;
    for (let frame = 0; frame < UPDATES_PER_SECOND * WATCH_SECONDS; frame++) {
      keepCrawlersStanding(rig);
      const beforeX = necro.x;
      const beforeY = necro.y;
      step(rig);
      const moved = Math.hypot(necro.x - beforeX, necro.y - beforeY);
      if (warmedAt === null && necro.standingWarmedAt !== null) warmedAt = frame;
      const action = necro.currentRow.action;
      if (firstStandingDraw === null && (action === 'idle' || action === 'hurt')) {
        firstStandingDraw = frame;
      }
      const tile = tileUnder(necro);
      const inZone = necro.isInHomeZone(tile.x, tile.y);
      if (inZone && action === 'drift' && moved < STATIONARY_PX) driftInPlace++;
      if (arrivedAt === null && inZone) arrivedAt = frame;
      if (arrivedAt !== null) {
        framesAfter++;
        if (inZone) inZoneAfter++;
      }
    }
    const share = framesAfter === 0 ? 0 : inZoneAfter / framesAfter;
    const standingLead =
      warmedAt === null || firstStandingDraw === null ? -1 : firstStandingDraw - warmedAt;
    check(
      standingLead >= NECROMANCER_STANDING_PREWARM_LEAD_FRAMES,
      `${laneId} lane: his standing set was warmed ${standingLead} updates before he first stood (lead ${NECROMANCER_STANDING_PREWARM_LEAD_FRAMES})`,
    );
    const driftShare = inZoneAfter === 0 ? 1 : driftInPlace / inZoneAfter;
    check(
      driftShare <= MAX_DRIFT_IN_PLACE_SHARE,
      `${laneId} lane: he drifted in place ${(driftShare * 100).toFixed(1)}% of his time in the zone (at most ${MAX_DRIFT_IN_PLACE_SHARE * 100}%)`,
    );
    check(
      arrivedAt !== null && arrivedAt <= UPDATES_PER_SECOND * ARRIVAL_LIMIT_SECONDS,
      `${laneId} lane: he reached his zone ${arrivedAt === null ? 'never' : `in ${(arrivedAt / UPDATES_PER_SECOND).toFixed(1)} s`} (limit ${ARRIVAL_LIMIT_SECONDS} s)`,
    );
    check(
      share >= MIN_ZONE_SHARE,
      `${laneId} lane: he then spent ${(share * 100).toFixed(0)}% of the watch in it (at least ${MIN_ZONE_SHARE * 100}%)`,
    );
  }
}

// ── 2. The home zone ──────────────────────────────────────────────────────

section('Home zone: he never enters the palisade, even with every segment breached');

const HOME_STREAMS = 12;
const HOME_STREAM_FRAMES = UPDATES_PER_SECOND * 60 * 5;
/** How often a stream throws him at the wall, and how hard. */
const SHOVE_EVERY_FRAMES = 400;
const SHOVE_TILES = 6;
const SHOVE_FRAMES = 20;
/** How often a crawler picks a new place to be. */
const CRAWLER_REPLAN_FRAMES = 240;

if (fault === 'necro-enters') {
  Reflect.set(Necromancer.prototype, 'mayStandAt', () => true);
}

let everInside = false;
let everTooClose = false;
let blinksTotal = 0;
let badBlinks = 0;
let closestApproach = Infinity;
let raiseCapExceeded = false;
let raiseCapReached = false;

for (let stream = 0; stream < HOME_STREAMS; stream++) {
  const random = mulberry32(stream + 1);
  Math.random = random;
  const rig = makeRig();
  for (const segment of site.segments) {
    rig.defense.damage({ kind: 'segment', id: segment.id }, 1, null, 'blast');
  }
  rig.flow.rebuild();
  const lane = laneOf(stream % 2 === 0 ? 'east' : 'south');
  const necro = spawnNecromancer(rig, lane.spawn);
  const crawlers = [rig.human, rig.cat];
  const goals = crawlers.map(() => ({ x: site.centre.x, y: site.centre.y }));
  for (const crawler of crawlers) placeCrawler(crawler, site.centre.x, site.centre.y);
  let lastBlinks = 0;

  for (let frame = 0; frame < HOME_STREAM_FRAMES; frame++) {
    keepCrawlersStanding(rig);
    crawlers.forEach((crawler, index) => {
      const goal = goals[index];
      if (frame % CRAWLER_REPLAN_FRAMES === index * (CRAWLER_REPLAN_FRAMES / 2)) {
        const roll = random();
        const here = tileUnder(necro);
        if (roll < 0.4) {
          goal.x = here.x + Math.round((random() - 0.5) * 2);
          goal.y = here.y + Math.round((random() - 0.5) * 2);
        } else if (roll < 0.7) {
          goal.x = Math.round((here.x + site.centre.x) / 2);
          goal.y = Math.round((here.y + site.centre.y) / 2);
        } else {
          goal.x = here.x + Math.round((random() - 0.5) * 16);
          goal.y = here.y + Math.round((random() - 0.5) * 16);
        }
      }
      const toX = goal.x * TILE_SIZE - crawler.x;
      const toY = goal.y * TILE_SIZE - crawler.y;
      const distance = Math.hypot(toX, toY);
      if (distance > PLAYER_SPEED) {
        crawler.x += (toX / distance) * PLAYER_SPEED;
        crawler.y += (toY / distance) * PLAYER_SPEED;
      }
    });
    if (frame % SHOVE_EVERY_FRAMES === SHOVE_EVERY_FRAMES - 1 && necro.isAlive) {
      necro.applyKnockback(
        site.centre.x * TILE_SIZE - necro.x,
        site.centre.y * TILE_SIZE - necro.y,
        SHOVE_TILES * TILE_SIZE,
        SHOVE_FRAMES,
      );
    }
    step(rig);

    const tile = tileUnder(necro);
    if (isInsidePalisadeTile(site, tile.x, tile.y)) everInside = true;
    const distance = field.distanceAt(tile.x, tile.y);
    closestApproach = Math.min(closestApproach, distance === INSIDE_PALISADE ? -1 : distance);
    if (distance !== INSIDE_PALISADE && distance < NECRO_MIN_WALL_DISTANCE_TILES)
      everTooClose = true;
    if (necro.blinks > lastBlinks) {
      lastBlinks = necro.blinks;
      blinksTotal++;
      const landing = necro.lastBlinkLanding;
      if (
        landing === null ||
        !gameMap.isWalkableForHostile(landing.x, landing.y) ||
        isInsidePalisadeTile(site, landing.x, landing.y) ||
        field.distanceAt(landing.x, landing.y) < NECRO_MIN_WALL_DISTANCE_TILES
      ) {
        badBlinks++;
      }
    }
    const raises = livingNecromancerRaises(rig.roster.mobs);
    if (raises > NECRO_ESCORT_CAP) raiseCapExceeded = true;
    if (raises === NECRO_ESCORT_CAP) raiseCapReached = true;
  }
  console.log(
    `    stream ${stream + 1} (${lane.id}): closest ${field.distanceAt(tileUnder(necro).x, tileUnder(necro).y)} at the end, ${necro.blinks} blinks, ${livingNecromancerRaises(rig.roster.mobs)} raises standing`,
  );
}

check(
  !everInside,
  `he never stood inside the palisade across ${HOME_STREAMS} streams of 5 minutes`,
);
check(
  !everTooClose,
  `he never came nearer the ring than ${NECRO_MIN_WALL_DISTANCE_TILES} tiles (closest ${closestApproach})`,
);

section('Blink: never inside the palisade, never on unwalkable ground');
check(blinksTotal > 0, `the streams drew blinks out of him (${blinksTotal})`);
check(badBlinks === 0, `every blink landed walkable and outside the wall (${badBlinks} bad)`);

section('Raise: never past his escort cap');
check(raiseCapReached, `his raises reached the cap of ${NECRO_ESCORT_CAP} at some point`);
check(!raiseCapExceeded, `his living raises never exceeded ${NECRO_ESCORT_CAP}`);

// ── 3. Separate caps ──────────────────────────────────────────────────────

section('Raise: the wave still reaches its numbers while he is at cap');
{
  /** The assault's own live cap on its scripted spawns. */
  const ASSAULT_LIVE_CAP = 22;
  const rig = makeRig();
  const necro = spawnNecromancer(rig, laneOf('south').spawn);
  const lane = laneOf('south');
  for (let i = 0; i < NECRO_ESCORT_CAP; i++) {
    const raised = new RaisedRatkin(lane.spawn.x + (i % 4), lane.spawn.y + 2, TILE_SIZE);
    raised.raisedByNecromancer = true;
    enlistInSiege(raised, rig.world);
    rig.roster.add(raised);
  }
  const alreadyInWave = 8;
  for (let i = 0; i < alreadyInWave; i++) {
    const ghoul = new RuinsGhoul(lane.spawn.x - 3 + (i % 4), lane.spawn.y + 3, TILE_SIZE);
    enlistInSiege(ghoul, rig.world);
    rig.roster.add(ghoul);
  }
  const counted = (mobs: readonly Mob[]): number =>
    fault === 'merged-cap'
      ? livingAssaultSpawns(mobs) + livingNecromancerRaises(mobs)
      : livingAssaultSpawns(mobs);
  const wanted = ASSAULT_LIVE_CAP - livingAssaultSpawns(rig.roster.mobs);
  let spawned = 0;
  for (let attempt = 0; attempt < wanted * 2; attempt++) {
    if (counted(rig.roster.mobs) >= ASSAULT_LIVE_CAP) break;
    const raised = new RaisedRatkin(lane.spawn.x + (attempt % 5), lane.spawn.y - 1, TILE_SIZE);
    enlistInSiege(raised, rig.world);
    rig.roster.add(raised);
    spawned++;
  }
  check(
    livingNecromancerRaises(rig.roster.mobs) === NECRO_ESCORT_CAP && necro.isAlive,
    `he stands at his cap of ${NECRO_ESCORT_CAP} raises`,
  );
  check(
    spawned === wanted,
    `the wave spawned all ${wanted} of its bodies up to the live cap of ${ASSAULT_LIVE_CAP} (${spawned})`,
  );
}

// ── 4. Grave Pulse ────────────────────────────────────────────────────────

section('Grave Pulse: the lowest-health structure in reach, broken by a direct hit');
{
  Math.random = mulberry32(99);
  const rig = makeRig();
  const southIds = southWallSegmentIds();
  // Stone, so a worn wall still has more left than one pulse takes.
  upgradeSegmentsTo(rig, (id) => southIds.has(id));
  upgradeSegmentsTo(rig, (id) => southIds.has(id));
  const approach = laneOf('south').approach;
  const damagedIds = [
    segmentAt(approach.x + 3, approach.y - 3),
    segmentAt(approach.x - 4, approach.y - 3),
  ];
  const shares = [0.6, 0.35];
  damagedIds.forEach((id, index) => {
    if (id === null) return;
    rig.defense.damage(
      { kind: 'segment', id },
      WALL_TIERS.stone.baseHp * (1 - shares[index]),
      null,
      'blast',
    );
  });
  const trebuchet = rig.defense.placeTrebuchet(approach.x + 1, approach.y - 7, 'human');
  rig.defense.damage(trebuchet, rig.defense.maxHp(trebuchet) * 0.8, null, 'blast');
  rig.flow.rebuild();
  const necro = spawnNecromancer(rig, laneOf('south').spawn);
  placeCrawler(rig.human, site.square.bellTile.x, site.square.bellTile.y);
  placeCrawler(rig.cat, site.square.bellTile.x + 1, site.square.bellTile.y);

  const lowestInReach = (): StructureRef | null => {
    const refs: StructureRef[] = [
      ...site.segments.map((segment): StructureRef => ({ kind: 'segment', id: segment.id })),
      trebuchet,
    ];
    let best: StructureRef | null = null;
    let bestShare = Infinity;
    for (const ref of refs) {
      if (!isStandingStructure(rig.defense, ref)) continue;
      const point = nearestStructurePoint(rig.defense, ref, necro);
      if (point === null) continue;
      const reach = Math.hypot(point.x - (necro.x + HALF), point.y - (necro.y + HALF));
      if (reach > NECRO_PULSE_RANGE_TILES * TILE_SIZE) continue;
      const share = rig.defense.hp(ref) / rig.defense.maxHp(ref);
      if (share < bestShare) {
        bestShare = share;
        best = ref;
      }
    }
    return best;
  };
  const sameRef = (a: StructureRef | null, b: StructureRef | null): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

  let firstPulseChecked = false;
  let pickedLowest = false;
  let pickedDamagedOne = false;
  let landedDamage = false;
  let interruptChecked = false;
  let interruptWorked = false;
  let targetBefore = 0;
  let pulseRef: StructureRef | null = null;
  let wasChanneling = false;
  // His own blows on the defences, apart from his raises' claws on the same walls.
  const necroBlows: Array<{ readonly ref: StructureRef; readonly amount: number }> = [];
  const dealStructureDamage = rig.defense.damage.bind(rig.defense);
  rig.defense.damage = (ref, amount, attacker, source) => {
    if (attacker === necro) necroBlows.push({ ref, amount });
    dealStructureDamage(ref, amount, attacker, source);
  };
  let blowsAtChannelStart = 0;

  for (let frame = 0; frame < UPDATES_PER_SECOND * 90 && !interruptChecked; frame++) {
    keepCrawlersStanding(rig);
    step(rig);
    const telegraph = necro.groundTelegraph;
    const channeling = telegraph !== null && telegraph.kind === 'pulse';
    if (channeling && !wasChanneling) {
      blowsAtChannelStart = necroBlows.length;
      const chosen = necro.chooseGravePulseTarget();
      pulseRef = chosen?.ref ?? null;
      if (!firstPulseChecked) {
        pickedLowest = sameRef(pulseRef, lowestInReach());
        pickedDamagedOne =
          pulseRef !== null && rig.defense.hp(pulseRef) < rig.defense.maxHp(pulseRef);
        targetBefore = pulseRef === null ? 0 : rig.defense.hp(pulseRef);
      } else {
        targetBefore = pulseRef === null ? 0 : rig.defense.hp(pulseRef);
        // A trebuchet's direct hit, dealt the way `TrebuchetSystem` deals it.
        const direct = Math.max(
          1,
          Math.round(trebuchetDirectDamage(TEST_LEVEL) * necro.blastDamageScale),
        );
        const before = necro.pulsesInterrupted;
        necro.takeCreditedDamage(direct, rig.human, 'melee', null);
        interruptWorked = necro.pulsesInterrupted === before + 1;
      }
    }
    if (!channeling && wasChanneling && pulseRef !== null) {
      if (!firstPulseChecked) {
        firstPulseChecked = true;
        const landed = necroBlows.slice(blowsAtChannelStart);
        landedDamage =
          landed.length === 1 &&
          sameRef(landed[0].ref, pulseRef) &&
          landed[0].amount === NECRO_PULSE_STRUCTURE_DAMAGE &&
          targetBefore - rig.defense.hp(pulseRef) >= NECRO_PULSE_STRUCTURE_DAMAGE;
      } else {
        interruptChecked = true;
        interruptWorked &&= necroBlows.length === blowsAtChannelStart;
      }
    }
    wasChanneling = channeling;
  }
  check(firstPulseChecked, 'he cast a grave pulse at the defences');
  check(pickedDamagedOne, 'the pulse went for a worn structure, not a whole one');
  check(pickedLowest, 'the pulse went for the lowest share of health in reach');
  check(
    landedDamage,
    `the pulse took exactly ${NECRO_PULSE_STRUCTURE_DAMAGE} (a quarter of a stone wall's ${WALL_TIERS.stone.baseHp})`,
  );
  check(
    interruptChecked && interruptWorked,
    'a trebuchet direct hit mid-channel broke the pulse and spared the wall',
  );
  let thresholdHolds = true;
  for (let level = 1; level <= MAX_MOB_LEVEL; level++) {
    const direct = Math.max(1, Math.round(trebuchetDirectDamage(level) * BOSS_BLAST_DAMAGE_SCALE));
    if (direct < necroPulseInterruptDamage(level)) thresholdHolds = false;
  }
  check(
    thresholdHolds,
    `a direct hit meets the interrupt threshold at every level 1–${MAX_MOB_LEVEL}`,
  );
}

// ── 5. Death ──────────────────────────────────────────────────────────────

section('Death: a held terminal phase, and justDied latches once');
{
  const rig = makeRig();
  const necro = spawnNecromancer(rig, laneOf('south').spawn);
  placeCrawler(rig.human, site.square.bellTile.x, site.square.bellTile.y);
  for (let frame = 0; frame < 30; frame++) step(rig);
  necro.takeDamageFrom(necro.maxHp * 2, rig.human, 'melee');
  let lastFrameHeld = 0;
  let awake = false;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 10; frame++) {
    step(rig);
    if (necro.isAlive) awake = true;
    if (necro.currentRow.action === 'death' && necro.currentRow.frame === DEATH_FRAMES - 1) {
      lastFrameHeld++;
    }
  }
  check(!awake, 'he stays dead');
  check(
    rig.deaths.get(necro) === 1,
    `justDied latched exactly once (${rig.deaths.get(necro) ?? 0})`,
  );
  check(necro.isDeathSettled, 'the death reached its settled heap');
  check(
    lastFrameHeld > UPDATES_PER_SECOND * 5,
    `the heap held its last frame (${lastFrameHeld} frames)`,
  );
  check(necro.belongsInMobGrid, 'the heap is still drawn');
  check(necro.groundTelegraph === null, 'no telegraph outlives him');
}

// ── 6. Grave Bull ─────────────────────────────────────────────────────────

section('Grave Bull: a charge into a wooden wall deals six times its weight');
{
  Math.random = mulberry32(7);
  const rig = makeRig();
  const southIds = southWallSegmentIds();
  upgradeSegmentsTo(rig, (id) => southIds.has(id));
  rig.flow.rebuild();
  const southRow = site.palisadeBounds.y + site.palisadeBounds.h - 1;
  const wallX = site.gate.tiles[2].x + 6;
  const bull = new GraveBull(wallX, southRow + 5, TILE_SIZE);
  bull.applyMobLevel(TEST_LEVEL);
  enlistInSiege(bull, rig.world);
  rig.roster.add(bull);
  placeCrawler(rig.human, site.square.bellTile.x, site.square.bellTile.y);
  placeCrawler(rig.cat, site.square.bellTile.x + 1, site.square.bellTile.y);
  const hpBefore = new Map(
    site.segments.map((s) => [s.id, rig.defense.hp({ kind: 'segment', id: s.id })]),
  );
  let pawFrames = 0;
  let headingHeld = true;
  let lockedHeading: { x: number; y: number } | null = null;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 20 && bull.lastChargeEnd === null; frame++) {
    step(rig);
    if (bull.isPawing) {
      pawFrames++;
      lockedHeading ??= { ...bull.chargeHeading };
      if (bull.chargeHeading.x !== lockedHeading.x || bull.chargeHeading.y !== lockedHeading.y) {
        headingHeld = false;
      }
    }
  }
  let struckLoss = 0;
  for (const segment of site.segments) {
    const loss =
      (hpBefore.get(segment.id) ?? 0) - rig.defense.hp({ kind: 'segment', id: segment.id });
    struckLoss = Math.max(struckLoss, loss);
  }
  const expected = bull.structureStrikeDamage * REQUEST_BULL_STRUCTURE_MULTIPLE;
  check(
    bull.lastChargeEnd === 'structure',
    `the charge ended on the wall (${bull.lastChargeEnd ?? 'none'})`,
  );
  check(
    Math.abs(struckLoss - expected) < 1e-6,
    `the wall lost ${struckLoss}, six times the bull's ${bull.structureStrikeDamage}`,
  );
  check(pawFrames >= GRAVE_BULL_PAW_TELEGRAPH_FRAMES, `it pawed ${pawFrames} frames first`);
  check(headingHeld, 'the heading stayed locked through the paw');
}

/** An open run of ground outside the village, `length` tiles along a row. */
function openRow(length: number): SiegeTile {
  for (let y = site.palisadeBounds.y + site.palisadeBounds.h + 8; y < MAP_SIZE - 2; y++) {
    for (let x = site.palisadeBounds.x; x < site.palisadeBounds.x + site.palisadeBounds.w; x++) {
      let clear = true;
      for (let dy = -2; dy <= 2 && clear; dy++) {
        for (let dx = 0; dx <= length && clear; dx++) {
          if (!gameMap.isWalkableForHostile(x + dx, y + dy)) clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no open ground for the bull');
}

section('Grave Bull: a snare stops the charge dead');
{
  const rig = makeRig();
  const start = openRow(GRAVE_BULL_CHARGE_MAX_TILES + 3);
  const bull = new GraveBull(start.x, start.y, TILE_SIZE);
  bull.applyMobLevel(TEST_LEVEL);
  rig.roster.add(bull);
  placeCrawler(rig.human, start.x + 5, start.y);
  placeCrawler(rig.cat, start.x + 5, start.y - 30);
  const snare = {};
  let rootedAt: { x: number; y: number } | null = null;
  let movedWhileRooted = 0;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 6; frame++) {
    keepCrawlersStanding(rig);
    if (bull.isPawing) placeCrawler(rig.human, start.x + 5, start.y - 3);
    step(rig);
    if (bull.isCharging && rootedAt === null) {
      bull.root(UPDATES_PER_SECOND * 10, snare);
      rootedAt = { x: bull.x, y: bull.y };
    } else if (rootedAt !== null && bull.isRooted) {
      movedWhileRooted = Math.max(
        movedWhileRooted,
        Math.hypot(bull.x - rootedAt.x, bull.y - rootedAt.y),
      );
    }
  }
  check(rootedAt !== null, 'the bull charged');
  check(
    bull.lastChargeEnd === 'snare',
    `the snare ended the charge (${bull.lastChargeEnd ?? 'none'})`,
  );
  check(
    movedWhileRooted <= GRAVE_BULL_CHARGE_SPEED,
    `it moved no further than one charge step once held (${movedWhileRooted.toFixed(1)} px)`,
  );
}

section('Grave Bull: with nothing in the lane, the charge stops at eight tiles');
{
  const rig = makeRig();
  const start = openRow(GRAVE_BULL_CHARGE_MAX_TILES + 3);
  const bull = new GraveBull(start.x, start.y, TILE_SIZE);
  bull.applyMobLevel(TEST_LEVEL);
  rig.roster.add(bull);
  placeCrawler(rig.human, start.x + 5, start.y);
  placeCrawler(rig.cat, start.x + 5, start.y - 30);
  for (let frame = 0; frame < UPDATES_PER_SECOND * 6 && bull.lastChargeEnd === null; frame++) {
    keepCrawlersStanding(rig);
    // Stepping out of the locked line during the paw: the charge meets nobody.
    if (bull.isPawing) placeCrawler(rig.human, start.x + 5, start.y - 4);
    step(rig);
  }
  const maxPx = REQUEST_BULL_MAX_CHARGE_TILES * TILE_SIZE;
  check(bull.lastChargeEnd === 'distance', `the charge ran out (${bull.lastChargeEnd ?? 'none'})`);
  check(
    bull.lastChargeDistancePx >= maxPx - GRAVE_BULL_CHARGE_SPEED &&
      bull.lastChargeDistancePx <= maxPx + GRAVE_BULL_CHARGE_SPEED,
    `it ran ${(bull.lastChargeDistancePx / TILE_SIZE).toFixed(2)} tiles (${GRAVE_BULL_CHARGE_MAX_TILES} allowed)`,
  );
  check(rig.human.hp === rig.human.maxHp, 'the crawler who stepped aside took nothing');
}

section('Grave Bull: a shatter alone leaves it standing; a direct hit and a shatter kill it');
{
  let splashSurvives = true;
  let bothKill = true;
  for (let level = 1; level <= MAX_MOB_LEVEL; level++) {
    const bull = new GraveBull(0, 0, TILE_SIZE);
    bull.applyMobLevel(level);
    const splash = Math.max(1, Math.round(trebuchetSplashDamage(level) * bull.blastDamageScale));
    const direct = Math.max(1, Math.round(trebuchetDirectDamage(level) * bull.blastDamageScale));
    if (splash >= bull.maxHp) splashSurvives = false;
    if (direct + splash < bull.maxHp) bothKill = false;
  }
  check(splashSurvives, `a shatter never kills it at levels 1–${MAX_MOB_LEVEL}`);
  check(bothKill, `a direct hit and a shatter always do at levels 1–${MAX_MOB_LEVEL}`);
}

// ── 7. Raised Ratkin ──────────────────────────────────────────────────────

section('Raised Ratkin: rises immune, then can be hurt; the weakest wave body');
{
  const rig = makeRig();
  const start = openRow(4);
  const raised = new RaisedRatkin(start.x, start.y, TILE_SIZE);
  raised.beginRising();
  raised.applyMobLevel(TEST_LEVEL);
  rig.roster.add(raised);
  placeCrawler(rig.human, start.x, start.y - 20);
  placeCrawler(rig.cat, start.x, start.y - 21);
  step(rig);
  const full = raised.hp;
  raised.takeDamageFrom(1, rig.human, 'melee');
  check(raised.isRising && raised.hp === full, 'a blow while rising does nothing');
  let finalRiseFrame = -1;
  for (let frame = 0; frame < SKELETON_RISE_FRAMES; frame++) {
    if (raised.currentRow.action === 'rise') finalRiseFrame = raised.currentRow.frame;
    step(rig);
  }
  check(!raised.isRising, 'the rise ends with the rising window');
  check(
    finalRiseFrame === RISE_FRAMES - 1,
    `the rise row reached its last frame (${finalRiseFrame})`,
  );
  raised.takeDamageFrom(1, rig.human, 'melee');
  check(raised.hp === full - 1, 'once out of the ground it takes the blow');
  const others = [
    new SkeletonWarrior(0, 0, TILE_SIZE),
    new SkeletonArcher(0, 0, TILE_SIZE),
    new RuinsGhoul(0, 0, TILE_SIZE),
    new GraveBull(0, 0, TILE_SIZE),
  ];
  check(
    others.every((mob) => mob.maxHp > RAISED_RATKIN_HP),
    `its ${RAISED_RATKIN_HP} HP is the lowest of the wave's bodies`,
  );
}

// ── 8. The siege strike ───────────────────────────────────────────────────

section('Siege strike: a raised ratkin batters the wall in its way, and spikes bite back');
{
  const rig = makeRig();
  const southIds = southWallSegmentIds();
  upgradeSegmentsTo(rig, (id) => southIds.has(id));
  rig.flow.rebuild();
  const southRow = site.palisadeBounds.y + site.palisadeBounds.h - 1;
  const wallX = site.gate.tiles[2].x + 6;
  const segmentId = segmentAt(wallX, southRow);
  const raised = new RaisedRatkin(wallX, southRow + 1, TILE_SIZE);
  raised.applyMobLevel(TEST_LEVEL);
  enlistInSiege(raised, rig.world);
  rig.roster.add(raised);
  placeCrawler(rig.human, site.square.bellTile.x, site.square.bellTile.y);
  placeCrawler(rig.cat, site.square.bellTile.x + 1, site.square.bellTile.y);
  const ref: StructureRef | null = segmentId === null ? null : { kind: 'segment', id: segmentId };
  const before = ref === null ? 0 : rig.defense.hp(ref);
  for (let frame = 0; frame < UPDATES_PER_SECOND * 6; frame++) step(rig);
  const lost = ref === null ? 0 : before - rig.defense.hp(ref);
  const blow = raised.structureStrikeDamage;
  check(lost > 0, `the wall in its way took blows (${lost})`);
  check(
    blow > 0 && Math.abs(lost / blow - Math.round(lost / blow)) < 1e-6,
    `each blow took its own weight, ${blow}, at a multiplier of one`,
  );
  if (ref !== null) rig.defense.applySpikes(ref, 'human');
  const hpBefore = raised.hp;
  for (let frame = 0; frame < UPDATES_PER_SECOND * 4; frame++) step(rig);
  check(raised.hp < hpBefore, 'spikes sent its blows back at it');
  check(
    new SkeletonArcher(0, 0, TILE_SIZE).siegeStructureMultiplier === 0,
    'archers never batter walls',
  );
}

console.log(
  `\nverify:necromancer ${failures === 0 ? 'OK' : 'FAILED'} (${checks - failures}/${checks} checks passed)`,
);
process.exit(failures === 0 ? 0 : 1);
