/**
 * Where the overworld's fairies land, measured across a sweep of generated
 * floor-3 maps.
 *
 * - No fairy stands inside the town wall, inside the town's safe radius, or
 *   inside the circus grounds and the buffer the ruins keep from them.
 * - Every fairy stands on a tile with room to move.
 * - The sweep placed enough fairies for those to mean something.
 * - Every scatter point that placed a fairy or healer holds a shield beside
 *   it: the guaranteed one when the point rolled none.
 *
 * - A fairy just outside the town's safe zone never targets, bolts or lobs at
 *   a crawler standing inside it.
 *
 * Each exclusion is measured on the placed fairy's own position with the map's
 * own geometry, never through the spawner's filter, and each is run again
 * against a placement that skips the filter, where it must go red.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { DIFFICULTY_PROFILES, type Difficulty } from '../../src/core/difficultyProfiles';
import { withWorldSeed } from '../../src/core/WorldRandom';
import { GameMap } from '../../src/map/GameMap';
import { hasRoomToMove } from '../../src/map/findWalkableTile';
import { RUINS_CIRCUS_BUFFER } from '../../src/map/OverworldGenerator';
import { level3 } from '../../src/levels/level3';
import { Fairy } from '../../src/creatures/fairies/Fairy';
import { IceFairy } from '../../src/creatures/fairies/IceFairy';
import { FireFairy } from '../../src/creatures/fairies/FireFairy';
import { setPackAlertGrid } from '../../src/creatures/packAlert';
import { PlayerManager } from '../../src/core/PlayerManager';
import type { Player } from '../../src/Player';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import {
  FAIRY_SPAWN_KEYS,
  FairyRoomLedger,
  spawnOverworldFairies,
} from '../../src/levels/fairySpawner';
import { createMob } from '../../src/levels/spawner';
import { mulberry32 } from '../../src/sprites/person/rng';
import type { FairyGateReport } from './report';

/** Maps generated per sweep; each builds in well under a tenth of a second. */
const SWEEP_MAP_COUNT = 40;
const SWEEP_BASE_SEED = 0x0f_a1_e5_00;
/** The difficulty with the highest scatter chance, so each map places the most fairies. */
const SWEEP_DIFFICULTY: Difficulty = 'hard';
/** A mid-floor party, so levels resolve inside the floor's bands. */
const SWEEP_PARTY_LEVEL = 24;
/**
 * Fewer placed fairies than this across the whole sweep and the exclusion
 * checks have too little to look at to be believed.
 */
const MIN_SWEEP_FAIRIES = 200;
/** Tiles a filter-skipping placement drops per map, uniformly over walkable ground. */
const UNFILTERED_PLACEMENTS_PER_MAP = 400;
/** Attempts to find a walkable tile for one unfiltered placement before giving up on it. */
const UNFILTERED_PLACEMENT_ATTEMPTS = 50;
const MILLISECONDS_PER_SECOND = 1000;

interface Violations {
  insideTownWall: number;
  insideSafeRadius: number;
  insideCircusBuffer: number;
  cramped: number;
  measured: number;
}

function emptyViolations(): Violations {
  return {
    insideTownWall: 0,
    insideSafeRadius: 0,
    insideCircusBuffer: 0,
    cramped: 0,
    measured: 0,
  };
}

/**
 * Scores one placed position against every exclusion. The safe radius and the
 * circus reach are recomputed from the map's centres and radii here rather than
 * asked of any predicate the spawner itself consults.
 */
function measure(map: GameMap, x: number, y: number, into: Violations): void {
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  into.measured++;
  if (map.isTileInsideTownWall(tileX, tileY)) into.insideTownWall++;

  const safeRadius = map.townSafeRadius;
  const townCentre = map.townSquareCentre;
  if (safeRadius !== null && townCentre !== undefined) {
    const dx = x / TILE_SIZE - townCentre.x;
    const dy = y / TILE_SIZE - townCentre.y;
    if (Math.hypot(dx, dy) <= safeRadius) into.insideSafeRadius++;
  }

  const circus = map.circusCentre;
  const circusRadius = map.circusRadiusTiles;
  if (circus !== undefined && circusRadius !== undefined) {
    const reach = circusRadius + RUINS_CIRCUS_BUFFER;
    if (Math.hypot(tileX - circus.x, tileY - circus.y) <= reach) into.insideCircusBuffer++;
  }

  if (!hasRoomToMove(map, tileX, tileY)) into.cramped++;
}

/**
 * The placement a missing filter would make: any walkable tile at all,
 * anywhere on the map.
 */
function measureUnfilteredPlacements(map: GameMap, seed: number, into: Violations): void {
  const rng = mulberry32(seed);
  const size = map.gridSize;
  for (let i = 0; i < UNFILTERED_PLACEMENTS_PER_MAP; i++) {
    for (let attempt = 0; attempt < UNFILTERED_PLACEMENT_ATTEMPTS; attempt++) {
      const tileX = Math.floor(rng() * size);
      const tileY = Math.floor(rng() * size);
      if (!map.isWalkable(tileX, tileY)) continue;
      measure(map, tileX * TILE_SIZE, tileY * TILE_SIZE, into);
      break;
    }
  }
}

/**
 * A floor-3 map built as the game builds one from a save's seed. `Math.random`
 * is pinned as well for the length of the build: parts of generation read it
 * directly, and an unpinned stream would make a red run impossible to replay.
 */
function buildSeededOverworld(seed: number): GameMap {
  const unseeded = Math.random;
  Math.random = mulberry32(seed);
  try {
    return withWorldSeed(
      seed,
      () => new GameMap({ mapSize: level3.mapSize, tileHeight: TILE_SIZE, mapType: 'overworld' }),
    );
  } finally {
    Math.random = unseeded;
  }
}

/** How far from its scatter point, in tiles on either axis, a fairy may be placed. */
const SCATTER_REACH_TILES = 2;

interface ScatterAudit {
  /** Scatter points that placed anything. */
  groups: number;
  /** Groups whose last fairy is a shield no earlier fairy in the group made needed. */
  guaranteed: number;
  /** Groups holding a fairy and no shield. */
  unshielded: number;
  /** Groups holding more than one shield: a guarantee beside a rolled shield. */
  doubleShielded: number;
  /** Shields standing farther from their point than a scatter placement reaches. */
  farShields: number;
}

function emptyScatterAudit(): ScatterAudit {
  return { groups: 0, guaranteed: 0, unshielded: 0, doubleShielded: 0, farShields: 0 };
}

/**
 * Scores the fairies one scatter point placed. The pass places the rolled
 * fairies first and the guaranteed shield last, so a shield placed after
 * fairies holding none is the guarantee.
 */
function auditScatterGroup(
  point: { readonly x: number; readonly y: number },
  group: readonly Fairy[],
  into: ScatterAudit,
): void {
  if (group.length === 0) return;
  into.groups++;
  const shields = group.filter((fairy) => fairy.kind === 'shield');
  if (shields.length === 0) into.unshielded++;
  if (shields.length > 1) into.doubleShielded++;
  const last = group[group.length - 1];
  const rolled = group.slice(0, -1);
  const isGuarantee =
    last.kind === 'shield' && rolled.length > 0 && !rolled.some((fairy) => fairy.kind === 'shield');
  if (isGuarantee) into.guaranteed++;
  for (const shield of shields) {
    const tileX = Math.floor(shield.x / TILE_SIZE);
    const tileY = Math.floor(shield.y / TILE_SIZE);
    const reach = Math.max(Math.abs(tileX - point.x), Math.abs(tileY - point.y));
    if (reach > SCATTER_REACH_TILES) into.farShields++;
  }
}

/** A scatter pass that never adds the guaranteed shield: each group without its last-placed guarantee. */
function withoutGuarantee(group: readonly Fairy[]): Fairy[] {
  if (group.length < 2) return [...group];
  const last = group[group.length - 1];
  const rolled = group.slice(0, -1);
  const lastIsGuarantee =
    last.kind === 'shield' && !rolled.some((fairy) => fairy.kind === 'shield');
  return lastIsGuarantee ? rolled : [...group];
}

/**
 * A scatter pass that guarantees a shield to every point that placed
 * anything, whether or not it rolled one: the rolled group plus a shield.
 */
function withUnconditionalGuarantee(
  map: GameMap,
  point: { readonly x: number; readonly y: number },
  group: readonly Fairy[],
): Fairy[] {
  const rolled = withoutGuarantee(group);
  if (rolled.length === 0) return rolled;
  const shield = createMob(FAIRY_SPAWN_KEYS.shield, point.x, point.y, map);
  if (!(shield instanceof Fairy)) throw new Error('the shield spawn key made no fairy');
  return [...rolled, shield];
}

function describeScatter(audit: ScatterAudit): string {
  return `${audit.groups} points placed: ${audit.guaranteed} guaranteed shields, ${audit.unshielded} unshielded, ${audit.doubleShielded} double-shielded, ${audit.farShields} shields out of reach`;
}

/**
 * The overworld pass run one scatter point at a time, so each point's fairies
 * can be told from its neighbours'. The rng is shared across the calls, so
 * the draws are the ones a single whole-map pass would make.
 */
function spawnPerPoint(
  map: GameMap,
  ledger: FairyRoomLedger,
  seed: number,
): { point: { x: number; y: number }; group: Fairy[] }[] {
  const rng = mulberry32(seed);
  const points = map.hallwaySpawnPoints;
  const groups: { point: { x: number; y: number }; group: Fairy[] }[] = [];
  try {
    for (const point of points) {
      map.hallwaySpawnPoints = [point];
      groups.push({ point, group: spawnOverworldFairies(map, ledger, rng) });
    }
  } finally {
    map.hallwaySpawnPoints = points;
  }
  return groups;
}

function describe(v: Violations): string {
  return `${v.measured} placed: ${v.insideTownWall} in town wall, ${v.insideSafeRadius} in safe radius, ${v.insideCircusBuffer} in circus buffer, ${v.cramped} cramped`;
}

export function verifyOverworldFairies(report: FairyGateReport): void {
  report.section('Floor 3: fairies keep out of the town and the circus');
  const started = Date.now();
  const shipped = emptyViolations();
  const unfiltered = emptyViolations();
  let healers = 0;
  const scatter = emptyScatterAudit();
  const unguaranteed = emptyScatterAudit();
  const overGuaranteed = emptyScatterAudit();

  for (let index = 0; index < SWEEP_MAP_COUNT; index++) {
    const seed = SWEEP_BASE_SEED + index;
    const map = buildSeededOverworld(seed);
    const ledger = new FairyRoomLedger(
      level3,
      SWEEP_PARTY_LEVEL,
      DIFFICULTY_PROFILES[SWEEP_DIFFICULTY],
      SWEEP_DIFFICULTY,
    );
    for (const { point, group } of spawnPerPoint(map, ledger, seed)) {
      auditScatterGroup(point, group, scatter);
      auditScatterGroup(point, withoutGuarantee(group), unguaranteed);
      auditScatterGroup(point, withUnconditionalGuarantee(map, point, group), overGuaranteed);
      for (const fairy of group) {
        measure(map, fairy.x, fairy.y, shipped);
        if (fairy.kind === 'healer') healers++;
      }
    }
    measureUnfilteredPlacements(map, seed, unfiltered);
  }

  const elapsedSeconds = (Date.now() - started) / MILLISECONDS_PER_SECOND;
  report.check(
    shipped.measured >= MIN_SWEEP_FAIRIES,
    `the ${SWEEP_MAP_COUNT}-map sweep placed at least ${MIN_SWEEP_FAIRIES} fairies to measure`,
    `${shipped.measured} fairies (${healers} healers) in ${elapsedSeconds.toFixed(1)} s`,
  );
  report.check(shipped.insideTownWall === 0, 'no fairy inside the town wall', describe(shipped));
  report.check(shipped.insideSafeRadius === 0, "no fairy inside the town's safe radius");
  report.check(
    shipped.insideCircusBuffer === 0,
    'no fairy within the circus radius plus the ruins buffer',
  );
  report.check(shipped.cramped === 0, 'every fairy stands on a tile with room to move');
  report.check(
    scatter.guaranteed > 0 && scatter.unshielded === 0,
    'every scatter point that placed a fairy or healer holds a shield, the guaranteed one when it rolled none',
    describeScatter(scatter),
  );
  report.check(
    scatter.doubleShielded === 0,
    'no scatter point holds a guaranteed shield beside a rolled one',
  );
  report.check(
    scatter.farShields === 0,
    `every shield stands within ${SCATTER_REACH_TILES} tiles of its scatter point`,
  );
  report.checkCatches(
    unguaranteed.unshielded === 0,
    'a scatter pass without the guaranteed shield is caught leaving points unshielded',
    describeScatter(unguaranteed),
  );
  report.checkCatches(
    overGuaranteed.doubleShielded === 0,
    'a scatter pass that guarantees a shield beside a rolled one is caught',
    describeScatter(overGuaranteed),
  );

  report.checkCatches(
    unfiltered.insideTownWall === 0,
    'a placement that skips the filter is caught inside the town wall',
    describe(unfiltered),
  );
  report.checkCatches(
    unfiltered.insideSafeRadius === 0,
    "a placement that skips the filter is caught inside the town's safe radius",
  );
  report.checkCatches(
    unfiltered.insideCircusBuffer === 0,
    'a placement that skips the filter is caught inside the circus buffer',
  );
  report.checkCatches(
    unfiltered.cramped === 0,
    'a placement that skips the filter is caught on a cramped tile',
  );
}

// ── The town's safe zone ─────────────────────────────────────────────────────

/** How far inside the safe radius the crawler stands, and outside it the fairy hovers, in tiles. */
const SAFE_ZONE_CRAWLER_DEPTH_TILES = 1.5;
const SAFE_ZONE_FAIRY_OFFSET_TILES = 2.5;
/** Directions tried around the town for a crawler and fairy pair in clear sight of each other. */
const SAFE_ZONE_DIRECTIONS = 72;
/** Frames the fairy is watched: long enough for either kind's first cast many times over. */
const SAFE_ZONE_FRAMES = 180;

interface SafeZonePair {
  readonly crawler: { readonly x: number; readonly y: number };
  readonly fairy: { readonly x: number; readonly y: number };
}

/**
 * A walkable tile just inside the safe radius and one just outside it, on the
 * same bearing from the plaza, with a clear line between them. Null when no
 * bearing gives one.
 */
function findSafeZonePair(map: GameMap): SafeZonePair | null {
  const centre = map.townSquareCentre;
  const radius = map.townSafeRadius;
  if (centre === undefined || radius === null) return null;
  const half = TILE_SIZE / 2;
  for (let step = 0; step < SAFE_ZONE_DIRECTIONS; step++) {
    const angle = (step / SAFE_ZONE_DIRECTIONS) * Math.PI * 2;
    const at = (reach: number) => ({
      x: Math.round(centre.x + Math.cos(angle) * reach),
      y: Math.round(centre.y + Math.sin(angle) * reach),
    });
    const crawler = at(radius - SAFE_ZONE_CRAWLER_DEPTH_TILES);
    const fairy = at(radius + SAFE_ZONE_FAIRY_OFFSET_TILES);
    if (!map.isWalkable(crawler.x, crawler.y) || !map.isWalkable(fairy.x, fairy.y)) continue;
    if (!map.isInTownSafeZone(crawler.x * TILE_SIZE, crawler.y * TILE_SIZE)) continue;
    if (map.isInTownSafeZone(fairy.x * TILE_SIZE, fairy.y * TILE_SIZE)) continue;
    const clear = map.hasLineOfSight(
      crawler.x * TILE_SIZE + half,
      crawler.y * TILE_SIZE + half,
      fairy.x * TILE_SIZE + half,
      fairy.y * TILE_SIZE + half,
    );
    if (clear) return { crawler, fairy };
  }
  return null;
}

/** An ice fairy blind to the safe zone: the defect under test. */
class ZoneBlindIceFairy extends IceFairy {
  protected override mayFight(_target: Player): boolean {
    return true;
  }
}

/** A fire fairy blind to the safe zone: the defect under test. */
class ZoneBlindFireFairy extends FireFairy {
  protected override mayFight(_target: Player): boolean {
    return true;
  }
}

interface SafeZoneOutcome {
  readonly targeted: boolean;
  readonly casts: number;
}

/**
 * Both crawlers inside the safe zone and a fairy just outside it, run for
 * {@link SAFE_ZONE_FRAMES} frames of its AI. `casts` counts the bolts or lobs
 * it loosed.
 */
function safeZoneRun(
  map: GameMap,
  pair: SafeZonePair,
  makeFairy: (tileX: number, tileY: number) => IceFairy | FireFairy,
): SafeZoneOutcome {
  const pm = new PlayerManager(pair.crawler.x, pair.crawler.y, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  setPackAlertGrid(roster.grid);
  const fairy = makeFairy(pair.fairy.x, pair.fairy.y);
  fairy.setMap(map);
  roster.add(fairy);
  const party: Player[] = [pm.human, pm.cat];
  for (const crawler of party) {
    crawler.x = pair.crawler.x * TILE_SIZE;
    crawler.y = pair.crawler.y * TILE_SIZE;
  }
  let targeted = false;
  let casts = 0;
  for (let frame = 0; frame < SAFE_ZONE_FRAMES; frame++) {
    fairy.updateAI(party);
    if (fairy.currentTarget !== null) targeted = true;
    casts +=
      fairy instanceof IceFairy
        ? fairy.takePendingIceBolts().length
        : fairy.takePendingFireballs().length;
  }
  return { targeted, casts };
}

/** No floor-3 fairy turns on a crawler sheltering inside the town's safe zone. */
export function verifyFairiesRespectTownSafeZone(report: FairyGateReport): void {
  report.section("Floor 3: fairies leave the town's safe zone alone");
  const map = buildSeededOverworld(SWEEP_BASE_SEED);
  const pair = findSafeZonePair(map);
  report.precondition(
    pair !== null,
    'the town has a crawler spot inside its safe zone in clear sight of fairy ground outside it',
  );
  if (pair === null) return;
  const describe = (run: SafeZoneOutcome): string =>
    `${run.targeted ? 'targeted a crawler' : 'targeted no one'}, ${run.casts} casts loosed`;
  const kinds = [
    {
      name: 'ice',
      real: (x: number, y: number) => new IceFairy(x, y, TILE_SIZE),
      blind: (x: number, y: number) => new ZoneBlindIceFairy(x, y, TILE_SIZE),
    },
    {
      name: 'fire',
      real: (x: number, y: number) => new FireFairy(x, y, TILE_SIZE),
      blind: (x: number, y: number) => new ZoneBlindFireFairy(x, y, TILE_SIZE),
    },
  ];
  for (const kind of kinds) {
    const real = safeZoneRun(map, pair, kind.real);
    report.check(
      !real.targeted && real.casts === 0,
      `a ${kind.name} fairy outside the safe zone never targets a crawler inside it`,
      describe(real),
    );
    const blind = safeZoneRun(map, pair, kind.blind);
    report.checkCatches(
      !blind.targeted && blind.casts === 0,
      `a ${kind.name} fairy blind to the safe zone is caught casting into it`,
      describe(blind),
    );
  }
}
