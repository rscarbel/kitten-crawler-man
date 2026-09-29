/**
 * The circus grounds on the real generated third floor, across many world
 * seeds, held to the budgets the fights on them depend on:
 *
 * - Blocked tiles in the grounds' disc stay at or under their budget. Every
 *   solid tile on the grounds is somewhere a wave mob can wedge.
 * - Every `RITUAL_WAVES` / `ASSAULT_WAVES` spawn lands where it was authored,
 *   or within {@link AUTHORED_SPAWN_TOLERANCE_TILES} of it. A spawn the
 *   grounds are allowed to push further is listed, with its limit, in
 *   {@link SPAWN_NUDGE_BASELINE_TILES}.
 * - From every wave spawn a hostile can walk, inside the arena, to the Big
 *   Top's door, Signet's lookout and the forecourt.
 * - No walkable ground on the grounds is sealed off from the forecourt.
 * - The keep-clear bands the layout names (`CIRCUS_KEEP_CLEAR_BANDS`: the
 *   forecourt, the lemur and stilt fields, the door and two rows south of it,
 *   Signet's lookout) and the approach road are open, and the waves the quest
 *   authors stand inside the bands kept for them.
 * - Rim props (the flame lamps, wagons, booths, striker and crate stack)
 *   stand in the rim band, off the road, clear of the entry arch, touching
 *   ground a crawler can walk to, and each is stood on most seeds.
 * - No arch post, flame lamp or rim prop stands on a town gate highway that
 *   crosses the grounds. The highway is read from the town plan, so a lot
 *   pass that paints over it cannot hide it from this check.
 * - The sideshow assault, played headless from several posts, needs the stall
 *   rescue no more often than its budget.
 *
 * Every check counts itself, and a section that ran no checks fails, so a
 * lookup that finds nothing cannot pass.
 *
 *   npm run verify:circus-grounds
 *   npx tsx scripts/verify-circus-grounds.ts --seeds=40 --assault-seeds=3
 *   npx tsx scripts/verify-circus-grounds.ts --measure      # print every reading
 *   npx tsx scripts/verify-circus-grounds.ts --fault=forecourt-solid   # must go red
 *
 * Faults (each must turn the gate red): forecourt-solid, blocked-count,
 * spawn-wall, pocket, rim-prop, rim-arch, cut-lookout, wedge, highway-prop.
 */

import {
  BUILDING_WALL,
  CIRCUS_STRUCTURE_LOW,
  CIRCUS_STRUCTURE_TALL,
  TORCH,
} from '../src/map/tileTypes';
import { runAssault, type AssaultRun } from './verifyCircusGrounds/assault';
import {
  BAND_NAMES,
  bandTiles,
  measureGrounds,
  wavesOutsideTheirBands,
  type BandName,
  type GroundsReading,
} from './verifyCircusGrounds/geometry';
import {
  CIRCUS_ARCH_CLEARANCE_TILES,
  CIRCUS_LOOKOUT_OFFSET,
  CIRCUS_RIM_OUTER_RADIUS_TILES,
  CIRCUS_RIM_PROPS,
  CIRCUS_STRUCTURE_PLACEMENTS,
} from '../src/map/overworld/circusGroundsLayout';
import {
  buildCircusSite,
  discTiles,
  stampTileType,
  type CircusSite,
  type TilePoint,
} from './verifyCircusGrounds/site';

// ── Budgets ───────────────────────────────────────────────────────────────
//
// Each is the most the grounds may reach: a ratchet, lowered whenever the
// layout improves on it and never raised.

/**
 * Most tiles of the r14 disc the grounds may block: the Big Top's 54 (its
 * 12 x 5 rectangle less the doorway and the four corners its ellipse
 * clears), three pavilions of 6 and six flame lamps — 78 — plus whatever of
 * the rim's wagons, booths and crate stack falls inside the disc. The rim
 * props are stood outermost-first, so most of each lies past r14; 84 on most
 * seeds, and 89 on the worst, where a road or a gate highway takes the outer
 * ring on the north rim and pushes a wagon inward.
 */
const BLOCKED_TILES_BASELINE = 89;
/**
 * The blocked-tile budget never rises past this: 95 of the disc's 613 tiles,
 * under a sixth, so the fields the waves are fought across stay open ground
 * rather than lanes between structures.
 */
const BLOCKED_TILES_CEILING = 95;
/** How far a wave spawn may land from its authored tile and still count as placed there. */
const AUTHORED_SPAWN_TOLERANCE_TILES = 1;
/**
 * Spawns allowed to land further than the tolerance from their authored
 * tile, with the furthest any seed may push each, in tiles. Every spawn lands
 * exactly where it is authored, so none is listed.
 */
const SPAWN_NUDGE_BASELINE_TILES: Readonly<Record<string, number>> = {};
/** How far Signet may be set down from her authored lookout. */
const SIGNET_NUDGE_BASELINE_TILES = 0;
/** Blocked tiles each keep-clear band may hold on any seed. */
const BAND_BLOCKED_BASELINE: Readonly<Record<BandName, number>> = {
  forecourt: 0,
  'lemur field': 0,
  'stilt field': 0,
  door: 0,
  road: 0,
  lookout: 0,
};
/** Sealed-off walkable pockets allowed in the rim band on any seed. */
const RIM_POCKETS_BASELINE = 0;
/** Walkable pockets smaller than this are the ones a spawn or a knock-back can strand a body in. */
const POCKET_MIN_TILES = 6;
/** Where the rim band starts, in tiles from the centre; blocking props belong outside it. */
const RIM_BAND_INNER_RADIUS_TILES = 12;
/**
 * The fewest seeds, as a share of the sweep, that must stand each rim prop.
 * A prop's arc of the rim can be taken by the road or a river now and then,
 * and the prop is then left out rather than jammed in; a prop left out on most
 * seeds is a layout the resolver cannot satisfy.
 */
const RIM_PROP_MIN_PLACED_SHARE = 0.75;
const PERCENT = 100;
/** Most stall-rescue lifts the whole default assault sweep may need. */
const STALL_LIFTS_BASELINE = 711;
/**
 * Most waves, across the default sweep, that the run has to cut down at the
 * end of their frame budget because some mob of theirs never came within the
 * engage range, in clear sight, of the post. That is mostly mobs that never
 * make for the party at all — Terror holding behind the Big Top, lemurs
 * keeping to their field — rather than mobs wedged on the way, so this is a
 * loose ceiling on how the fight plays out, not a count of wedged mobs; the
 * stall-lift budget above is the wedging measure.
 */
const STUCK_WAVES_BASELINE = 32;

// ── Sweep ─────────────────────────────────────────────────────────────────

const SEED_STRIDE = 7919;
const DEFAULT_GEOMETRY_SEEDS = 24;
const DEFAULT_ASSAULT_SEEDS = 4;
/**
 * Seeds whose town gate highway crosses the grounds where a rim prop, a lamp
 * or an arch post would otherwise stand, swept for geometry on every run so
 * the highway check always has a crossing to hold. The stride sweep's own
 * first seed is one too.
 */
const HIGHWAY_CROSSING_SEEDS: readonly number[] = [
  36676, 76271, 258408, 131704, 5000, 187137, 377193,
];

function stringArg(name: string): string | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? undefined : raw.slice(`--${name}=`.length);
}

function countArg(name: string, fallback: number): number {
  const parsed = Number.parseInt(stringArg(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const FAULTS = [
  'forecourt-solid',
  'blocked-count',
  'spawn-wall',
  'pocket',
  'rim-prop',
  'rim-arch',
  'cut-lookout',
  'wedge',
  'highway-prop',
] as const;
type Fault = (typeof FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

const faultArg = stringArg('fault');
if (faultArg !== undefined && !isFault(faultArg)) {
  console.error(`unknown --fault=${faultArg}; one of ${FAULTS.join(', ')}`);
  process.exit(2);
}
const fault: Fault | null = faultArg ?? null;
const measureOnly = process.argv.includes('--measure');
const strideSeeds = Array.from(
  { length: countArg('seeds', DEFAULT_GEOMETRY_SEEDS) },
  (_unused, index) => SEED_STRIDE * (index + 1),
);
// The crossing seeds go after the stride so the assault, which plays the
// first few, keeps playing the same ones.
const geometrySeeds = [
  ...strideSeeds,
  ...HIGHWAY_CROSSING_SEEDS.filter((seed) => !strideSeeds.includes(seed)),
];
const assaultSeedCount = countArg('assault-seeds', DEFAULT_ASSAULT_SEEDS);

// ── Faults ────────────────────────────────────────────────────────────────

/** A lemur spawn the spawn-wall fault buries. */
const BURIED_SPAWN_OFFSET: TilePoint = { x: -9, y: 1 };
/** Half the side of the block the spawn-wall fault lays over it. */
const BURIED_SPAWN_HALF_TILES = 2;
/** Where the forecourt fault stands its solid tile, from the centre. */
const FORECOURT_FAULT_OFFSET: TilePoint = { x: 4, y: 2 };
/** Where the pocket and rim-prop faults work, from the centre: open south-east ground. */
const POCKET_FAULT_OFFSET: TilePoint = { x: 5, y: 10 };
const RIM_FAULT_OFFSET: TilePoint = { x: -6, y: 9 };
/** Radius of the wall ring the cut-lookout fault closes round the lookout. */
const LOOKOUT_RING_RADIUS_TILES = 2;
/**
 * The column, west of the centre, the wedge fault runs a wall down: between
 * the lemur field and every post east of it, so the lemurs lose sight of the
 * party and stall.
 */
const WEDGE_COLUMN_OFFSET = -5;

function offsetTile(site: CircusSite, offset: TilePoint): TilePoint {
  return { x: site.centre.x + offset.x, y: site.centre.y + offset.y };
}

function ringTiles(centre: TilePoint, radius: number): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      tiles.push({ x: centre.x + dx, y: centre.y + dy });
    }
  }
  return tiles;
}

/** An open tile of the grounds that no keep-clear band or road claims. */
function unclaimedOpenTile(site: CircusSite): TilePoint | null {
  const claimed = new Set<string>();
  for (const tiles of bandTiles(site).values()) {
    for (const tile of tiles) claimed.add(`${tile.x},${tile.y}`);
  }
  for (const tile of site.roadRoute) claimed.add(`${tile.x},${tile.y}`);
  return (
    discTiles(site).find(
      (tile) => !claimed.has(`${tile.x},${tile.y}`) && site.map.isWalkable(tile.x, tile.y),
    ) ?? null
  );
}

function applyFault(site: CircusSite, which: Fault): void {
  const solid = (tile: TilePoint): void => stampTileType(site.map, tile, BUILDING_WALL);
  switch (which) {
    case 'forecourt-solid':
      solid(offsetTile(site, FORECOURT_FAULT_OFFSET));
      return;
    case 'blocked-count': {
      const tile = unclaimedOpenTile(site);
      if (tile !== null) solid(tile);
      return;
    }
    case 'spawn-wall': {
      const buried = offsetTile(site, BURIED_SPAWN_OFFSET);
      for (let dy = -BURIED_SPAWN_HALF_TILES; dy <= BURIED_SPAWN_HALF_TILES; dy++) {
        for (let dx = -BURIED_SPAWN_HALF_TILES; dx <= BURIED_SPAWN_HALF_TILES; dx++) {
          solid({ x: buried.x + dx, y: buried.y + dy });
        }
      }
      return;
    }
    case 'pocket':
      for (const tile of ringTiles(offsetTile(site, POCKET_FAULT_OFFSET), 1)) solid(tile);
      return;
    case 'rim-prop':
      stampTileType(site.map, offsetTile(site, RIM_FAULT_OFFSET), TORCH);
      return;
    case 'rim-arch': {
      const post = site.map.circusGrounds?.arch?.posts[0];
      if (post === undefined) return;
      // Beside the post, on the side away from the road the post stands off.
      const crossing = site.map.circusGrounds?.arch?.crossing ?? post;
      const away = {
        x: post.x + Math.sign(post.x - crossing.x),
        y: post.y + Math.sign(post.y - crossing.y),
      };
      stampTileType(site.map, away, CIRCUS_STRUCTURE_LOW);
      return;
    }
    case 'cut-lookout':
      for (const tile of ringTiles(site.lookout, LOOKOUT_RING_RADIUS_TILES)) solid(tile);
      return;
    case 'highway-prop': {
      const templateTiles = templateFootprintKeys(site);
      const open = site.highwayRoute.find((tile) => !templateTiles.has(`${tile.x},${tile.y}`));
      if (open !== undefined) stampTileType(site.map, open, CIRCUS_STRUCTURE_LOW);
      return;
    }
    case 'wedge':
      for (let dy = -site.radiusTiles; dy <= site.radiusTiles; dy++) {
        solid({ x: site.centre.x + WEDGE_COLUMN_OFFSET, y: site.centre.y + dy });
      }
      return;
  }
}

// ── Report ────────────────────────────────────────────────────────────────

type Section = 'blocked' | 'spawns' | 'reach' | 'pockets' | 'bands' | 'rim' | 'highway' | 'assault';
const checksRun = new Map<Section, number>();
const failures: string[] = [];

function check(section: Section, ok: boolean, message: string): void {
  checksRun.set(section, (checksRun.get(section) ?? 0) + 1);
  if (!ok) failures.push(`[${section}] ${message}`);
}

function buildSite(seed: number): CircusSite | null {
  const site = buildCircusSite(seed);
  if (typeof site === 'string') {
    check('blocked', false, `seed ${seed}: ${site}`);
    return null;
  }
  if (fault !== null) applyFault(site, fault);
  return site;
}

const TEMPLATE_STRUCTURES = new Set<string>(
  CIRCUS_STRUCTURE_PLACEMENTS.map((placement) => placement.structure),
);

/**
 * Every tile under the grounds' fixed structures. The Big Top and the
 * pavilions are pitched where the template puts them whatever runs under
 * them, so a highway through the middle of the grounds ends at their walls;
 * only what is placed by search round the rim must find ground off it.
 */
function templateFootprintKeys(site: CircusSite): Set<string> {
  const keys = new Set<string>();
  for (const entry of site.map.circusGrounds?.structures ?? []) {
    if (!TEMPLATE_STRUCTURES.has(entry.structure)) continue;
    for (let dy = 0; dy < entry.rect.h; dy++) {
      for (let dx = 0; dx < entry.rect.w; dx++) {
        keys.add(`${entry.rect.x + dx},${entry.rect.y + dy}`);
      }
    }
  }
  return keys;
}

function isCircusStructureTile(site: CircusSite, tile: TilePoint): boolean {
  const type = site.map.structure[tile.y]?.[tile.x]?.type;
  return type === CIRCUS_STRUCTURE_LOW || type === CIRCUS_STRUCTURE_TALL;
}

let seedsWithHighwayCrossing = 0;

function judgeHighway(site: CircusSite): void {
  if (site.highwayRoute.length === 0) return;
  seedsWithHighwayCrossing++;
  const templateTiles = templateFootprintKeys(site);
  const onHighway = site.highwayRoute.filter(
    (tile) => !templateTiles.has(`${tile.x},${tile.y}`) && isCircusStructureTile(site, tile),
  );
  check(
    'highway',
    onHighway.length === 0,
    `seed ${site.seed}: a structure stands on the gate highway at ${onHighway
      .map((tile) => describe(tile, site))
      .join(' ')}`,
  );
}

function describe(tile: TilePoint, site: CircusSite): string {
  return `(${tile.x - site.centre.x >= 0 ? '+' : ''}${tile.x - site.centre.x}, ${tile.y - site.centre.y >= 0 ? '+' : ''}${tile.y - site.centre.y})`;
}

function judgeGeometry(site: CircusSite, reading: GroundsReading): void {
  const label = `seed ${site.seed}`;
  check(
    'blocked',
    reading.blockedTiles <= BLOCKED_TILES_BASELINE,
    `${label}: ${reading.blockedTiles} blocked tiles in the grounds, over the ${BLOCKED_TILES_BASELINE} budget`,
  );

  for (const spawn of reading.spawns) {
    const cap = Math.max(
      AUTHORED_SPAWN_TOLERANCE_TILES,
      SPAWN_NUDGE_BASELINE_TILES[spawn.key] ?? 0,
    );
    check(
      'spawns',
      spawn.nudgeTiles <= cap,
      spawn.resolved === null
        ? `${label}: ${spawn.key} never spawned`
        : `${label}: ${spawn.key} landed ${spawn.nudgeTiles.toFixed(2)} tiles from its authored ${describe(spawn.authored, site)}, over ${cap}`,
    );
  }
  check(
    'spawns',
    reading.signetNudgeTiles <= SIGNET_NUDGE_BASELINE_TILES,
    `${label}: Signet set down ${reading.signetNudgeTiles.toFixed(2)} tiles from her lookout, over ${SIGNET_NUDGE_BASELINE_TILES}`,
  );

  check('reach', reading.reachPairsTried > 0, `${label}: no spawn-to-target walk was tried`);
  for (const miss of reading.unreachable) {
    check('reach', false, `${label}: ${miss.spawn} cannot walk to ${miss.target}`);
  }
  if (reading.unreachable.length === 0) check('reach', true, '');

  const listPockets = (pockets: GroundsReading['pockets']): string =>
    pockets
      .map(
        (pocket) =>
          `${pocket.size} tile(s) at ${describe(pocket.at, site)}${pocket.size < POCKET_MIN_TILES ? ' (small)' : ''}`,
      )
      .join(', ');
  // A pocket is the rim's only if every tile of it is: one tile reaching into
  // the field makes it ground a wave can be stranded on.
  const inRimBand = (pocket: GroundsReading['pockets'][number]): boolean =>
    pocket.innermostRadius >= RIM_BAND_INNER_RADIUS_TILES;
  const fieldPockets = reading.pockets.filter((pocket) => !inRimBand(pocket));
  const rimPockets = reading.pockets.filter(inRimBand);
  check(
    'pockets',
    fieldPockets.length === 0,
    `${label}: walkable ground sealed off inside the rim band: ${listPockets(fieldPockets)}`,
  );
  check(
    'pockets',
    rimPockets.length <= RIM_POCKETS_BASELINE,
    `${label}: ${rimPockets.length} sealed pocket(s) on the rim, over ${RIM_POCKETS_BASELINE}: ${listPockets(rimPockets)}`,
  );

  for (const name of BAND_NAMES) {
    const band = reading.bands.get(name);
    if (band === undefined || band.tiles === 0) {
      check('bands', false, `${label}: the ${name} band has no tiles`);
      continue;
    }
    check(
      'bands',
      band.blocked.length <= BAND_BLOCKED_BASELINE[name],
      `${label}: the ${name} band has ${band.blocked.length} blocked tile(s), over ${BAND_BLOCKED_BASELINE[name]}: ${band.blocked
        .map((tile) => describe(tile, site))
        .join(' ')}`,
    );
  }

  rimPropsSeen += reading.rimProps.length;
  const roadTiles = new Set(site.roadRoute.map((tile) => `${tile.x},${tile.y}`));
  const archPosts = site.map.circusGrounds?.arch?.posts ?? [];
  for (const prop of reading.rimProps) {
    const name = prop.structure ?? 'rim-type tile';
    const at = `${name} at ${describe(prop.tile, site)}`;
    check(
      'rim',
      prop.radius >= RIM_BAND_INNER_RADIUS_TILES,
      `${label}: ${at} stands ${prop.radius.toFixed(1)} tiles out, inside the r${RIM_BAND_INNER_RADIUS_TILES} rim band`,
    );
    // The arch's posts stand beside the road by definition; everything else
    // keeps off the road, clear of the posts, and on the grounds' edge.
    if (prop.structure === 'arch_post') continue;
    check(
      'rim',
      prop.radius <= CIRCUS_RIM_OUTER_RADIUS_TILES,
      `${label}: ${at} stands ${prop.radius.toFixed(1)} tiles out, past the r${CIRCUS_RIM_OUTER_RADIUS_TILES} rim band`,
    );
    check('rim', !roadTiles.has(`${prop.tile.x},${prop.tile.y}`), `${label}: ${at} is on the road`);
    const nearestPost = Math.min(
      Infinity,
      ...archPosts.map((post) =>
        Math.max(Math.abs(post.x - prop.tile.x), Math.abs(post.y - prop.tile.y)),
      ),
    );
    check(
      'rim',
      nearestPost > CIRCUS_ARCH_CLEARANCE_TILES,
      `${label}: ${at} stands ${nearestPost} tile(s) from an arch post, inside its ${CIRCUS_ARCH_CLEARANCE_TILES}-tile clearance`,
    );
  }
  for (const sealed of reading.unreachableRimProps) {
    check(
      'rim',
      false,
      `${label}: ${sealed.structure} at ${describe(sealed.at, site)} touches no ground reachable from the forecourt`,
    );
  }
  for (const entry of site.map.circusGrounds?.structures ?? []) {
    rimPropPlacements.set(entry.structure, (rimPropPlacements.get(entry.structure) ?? 0) + 1);
  }
}

function printReading(site: CircusSite, reading: GroundsReading): void {
  const types = [...reading.blockedByType].map(([type, count]) => `${type}:${count}`).join(' ');
  const nudged = reading.spawns
    .filter((spawn) => spawn.nudgeTiles > 0)
    .map((spawn) => `${spawn.key}=${spawn.nudgeTiles.toFixed(2)}`)
    .join(' ');
  const bands = BAND_NAMES.map((name) => {
    const band = reading.bands.get(name);
    return `${name} ${band?.blocked.length ?? '?'}/${band?.tiles ?? '?'}`;
  }).join(', ');
  console.log(
    `seed ${site.seed} centre (${site.centre.x}, ${site.centre.y}): blocked ${reading.blockedTiles} [${types}]` +
      `\n  nudges: ${nudged || 'none'}; Signet ${reading.signetNudgeTiles.toFixed(2)}` +
      `\n  unreachable: ${reading.unreachable.length}/${reading.reachPairsTried}; pockets: ${reading.pockets.map((p) => p.size).join(',') || 'none'}` +
      `\n  bands: ${bands}` +
      `\n  rim props: ${reading.rimProps.map((p) => p.radius.toFixed(1)).join(', ')}`,
  );
}

// ── Run ───────────────────────────────────────────────────────────────────

const maxNudgeByKey = new Map<string, number>();
/**
 * Counted across the sweep rather than per seed: on some seeds the forest
 * pass has grown a tree over every one of the six torch tiles.
 */
let rimPropsSeen = 0;
/** How many seeds stood each structure, so a rim prop the resolver always refuses cannot pass unseen. */
const rimPropPlacements = new Map<string, number>();
let worstBlocked = 0;
for (const seed of geometrySeeds) {
  const site = buildSite(seed);
  if (site === null) continue;
  const reading = measureGrounds(site);
  worstBlocked = Math.max(worstBlocked, reading.blockedTiles);
  for (const spawn of reading.spawns) {
    maxNudgeByKey.set(spawn.key, Math.max(maxNudgeByKey.get(spawn.key) ?? 0, spawn.nudgeTiles));
  }
  if (measureOnly) printReading(site, reading);
  judgeGeometry(site, reading);
  judgeHighway(site);
}
check(
  'highway',
  seedsWithHighwayCrossing > 0,
  'no seed in the sweep has a gate highway crossing the grounds to hold the rim off',
);

check('rim', rimPropsSeen > 0, 'no rim prop found on any seed to hold to the rim');
for (const anchor of CIRCUS_RIM_PROPS) {
  const placed = rimPropPlacements.get(anchor.prop) ?? 0;
  const share = placed / geometrySeeds.length;
  check(
    'rim',
    share >= RIM_PROP_MIN_PLACED_SHARE,
    `${anchor.prop} stood on ${placed} of ${geometrySeeds.length} seeds, under the ${Math.round(RIM_PROP_MIN_PLACED_SHARE * PERCENT)}% floor`,
  );
}

// The fields the gate keeps clear are the layout's, and the waves are authored
// in the quest system; the two must describe the same ground.
for (const problem of wavesOutsideTheirBands()) check('bands', false, problem);
check('bands', true, '');
const firstSite = buildCircusSite(geometrySeeds[0]);
if (typeof firstSite !== 'string') {
  const lookoutDx = firstSite.lookout.x - firstSite.centre.x;
  const lookoutDy = firstSite.lookout.y - firstSite.centre.y;
  check(
    'bands',
    lookoutDx === CIRCUS_LOOKOUT_OFFSET.x && lookoutDy === CIRCUS_LOOKOUT_OFFSET.y,
    `Signet's lookout is authored at (${lookoutDx}, ${lookoutDy}) but the layout keeps (${CIRCUS_LOOKOUT_OFFSET.x}, ${CIRCUS_LOOKOUT_OFFSET.y}) clear`,
  );
}

const assaultRuns: AssaultRun[] = [];
for (const seed of geometrySeeds.slice(0, assaultSeedCount)) {
  const site = buildSite(seed);
  if (site === null) continue;
  for (const result of runAssault(site)) {
    if (typeof result === 'string') {
      check('assault', false, `seed ${seed}: ${result}`);
      continue;
    }
    assaultRuns.push(result);
    if (measureOnly) {
      console.log(
        `assault seed ${seed} ${result.post}: ${result.stallLifts} lifts, ${result.stuckWaves} stuck of ${result.wavesFought} waves, ${result.frames} frames`,
      );
    }
  }
}
const totalLifts = assaultRuns.reduce((sum, run) => sum + run.stallLifts, 0);
const totalStuck = assaultRuns.reduce((sum, run) => sum + run.stuckWaves, 0);
check('assault', assaultRuns.length > 0, 'no assault run finished');
check(
  'assault',
  totalLifts <= STALL_LIFTS_BASELINE,
  `${totalLifts} stall-rescue lifts across ${assaultRuns.length} assault runs, over the ${STALL_LIFTS_BASELINE} budget`,
);
check(
  'assault',
  totalStuck <= STUCK_WAVES_BASELINE,
  `${totalStuck} waves never reached their post across ${assaultRuns.length} assault runs, over the ${STUCK_WAVES_BASELINE} budget`,
);

check(
  'blocked',
  BLOCKED_TILES_BASELINE <= BLOCKED_TILES_CEILING,
  `the blocked-tile budget ${BLOCKED_TILES_BASELINE} is over its ${BLOCKED_TILES_CEILING} ceiling`,
);

const sections: readonly Section[] = [
  'blocked',
  'spawns',
  'reach',
  'pockets',
  'bands',
  'rim',
  'highway',
  'assault',
];
for (const section of sections) {
  if ((checksRun.get(section) ?? 0) === 0) failures.push(`[${section}] ran no checks`);
}

console.log(
  `circus grounds: ${geometrySeeds.length} seeds, worst ${worstBlocked} blocked (budget ${BLOCKED_TILES_BASELINE})`,
);
if (measureOnly) {
  const nudges = [...maxNudgeByKey]
    .filter(([, nudge]) => nudge > 0)
    .map(([key, nudge]) => `${key}=${nudge.toFixed(2)}`)
    .join(' ');
  console.log(`worst nudge per spawn: ${nudges || 'none'}`);
}
console.log(
  `assault: ${assaultRuns.length} runs, ${totalLifts} stall lifts (budget ${STALL_LIFTS_BASELINE}), ${totalStuck} stuck waves (budget ${STUCK_WAVES_BASELINE})`,
);
const totalChecks = [...checksRun.values()].reduce((sum, count) => sum + count, 0);
if (fault !== null) console.log(`fault injected: ${fault}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`${failures.length} failure(s) in ${totalChecks} checks`);
  process.exit(1);
}
console.log(`PASS: ${totalChecks} checks`);
