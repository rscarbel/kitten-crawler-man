/**
 * Measurements of the circus grounds' geometry on one generated site: what is
 * blocked, where every wave actually spawns against where it was authored,
 * whether each spawn can walk to the places the fights are about, whether any
 * walkable ground is sealed off, and whether the named keep-clear bands and
 * the rim hold.
 *
 * Measuring and judging are kept apart: this file only reads the site, and
 * `verify-circus-grounds.ts` holds the readings to their budgets. `--measure`
 * prints the same readings, which is how a budget is set.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { Mob } from '../../src/creatures/Mob';
import { CIRCUS_STRUCTURE_LOW, TORCH } from '../../src/map/tileTypes';
import {
  CIRCUS_KEEP_CLEAR_BANDS,
  CIRCUS_STRUCTURES,
  blockedSteps,
  keepClearBandTiles,
  type CircusKeepClearBandName,
  type CircusStructureId,
} from '../../src/map/overworld/circusGroundsLayout';
import {
  ARENA_SPAWN_EDGE_INSET_TILES,
  ASSAULT_WAVES,
  RITUAL_WAVES,
  type WaveSpawn,
} from '../../src/systems/CircusQuestSystem';
import {
  buildQuestRig,
  discTiles,
  radiusOf,
  type CircusSite,
  type QuestRig,
  type TilePoint,
} from './site';

/**
 * Tile types that count as rim dressing wherever they turn up: props allowed
 * to block because they stand where nobody fights — the low structures (the
 * arch's posts, the flame lamps, the wagons and booths) and any plain torch.
 * The tall rim props (the crate stack) are read off the site's record, since
 * the Big Top and the pavilions share their tile type.
 */
export const RIM_PROP_TILE_TYPES: ReadonlySet<number> = new Set([TORCH, CIRCUS_STRUCTURE_LOW]);
/** The structures that stand in the field rather than on the rim. */
const FIELD_STRUCTURES: ReadonlySet<CircusStructureId> = new Set([
  'big_top',
  'pavilion_mold_lion',
  'pavilion_feats_of_flesh',
  'pavilion_fortunes',
]);
/** How far past the grounds' radius a rim prop is still looked for: rim art may straddle the edge. */
const RIM_PROP_SEARCH_MARGIN_TILES = 2;
/** Rows south of the centre the forecourt is probed at for reachability. */
const FORECOURT_PROBE_ROWS_SOUTH = 2;
/**
 * How far past the grounds a flood from the forecourt may run. A rim tile
 * that only connects through the wilderness just outside is reachable ground,
 * not a sealed pocket.
 */
const POCKET_ESCAPE_MARGIN_TILES = 4;
/** Far beyond any wave mob's health: each falls to one blow. */
const OVERKILL_DAMAGE = 1_000_000;
const WAVE_TABLES = { ritual: RITUAL_WAVES, assault: ASSAULT_WAVES } as const;
type WaveTableName = keyof typeof WAVE_TABLES;
export const LEMUR_WAVE_INDEX = 0;
export const STILT_WAVE_INDEX = 1;

/** The layout's own keep-clear bands, plus the approach road, which only a site can place. */
export type BandName = CircusKeepClearBandName | 'road';
export const BAND_NAMES: readonly BandName[] = [
  'forecourt',
  'lemur field',
  'stilt field',
  'door',
  'road',
  'lookout',
];

export type ReachTarget = 'Big Top door' | "Signet's lookout" | 'forecourt';

export interface ResolvedSpawn {
  /** Stable across seeds: `ritual w1 s2` is the third spawn of the second ritual wave. */
  readonly key: string;
  readonly authored: TilePoint;
  /** Null when the wave came up short and this spawn could not be matched to a mob. */
  readonly resolved: TilePoint | null;
  /** Straight-line tiles from authored to resolved; Infinity when unresolved. */
  readonly nudgeTiles: number;
}

export interface BandReading {
  readonly tiles: number;
  readonly blocked: readonly TilePoint[];
}

export interface Pocket {
  readonly size: number;
  readonly at: TilePoint;
  /** The pocket's tile nearest the centre, in tiles: a pocket reaching inside the rim band is a field pocket. */
  readonly innermostRadius: number;
}

export interface GroundsReading {
  /** Tiles in the grounds' disc no crawler can stand on. */
  readonly blockedTiles: number;
  readonly blockedByType: ReadonlyMap<number, number>;
  readonly spawns: readonly ResolvedSpawn[];
  /** How far Signet was set down from her authored lookout. */
  readonly signetNudgeTiles: number;
  /** Every (spawn, target) pair a hostile could not walk between inside the arena. */
  readonly unreachable: ReadonlyArray<{ readonly spawn: string; readonly target: ReachTarget }>;
  /** Pairs the reach check actually tried, so an empty `unreachable` is not vacuous. */
  readonly reachPairsTried: number;
  readonly pockets: readonly Pocket[];
  readonly bands: ReadonlyMap<BandName, BandReading>;
  readonly rimProps: ReadonlyArray<RimPropTile>;
  /** Rim structures no tile of which touches ground a crawler on the forecourt can walk to. */
  readonly unreachableRimProps: ReadonlyArray<{
    readonly structure: string;
    readonly at: TilePoint;
  }>;
}

export interface RimPropTile {
  readonly tile: TilePoint;
  readonly radius: number;
  /** The structure the tile belongs to, or null for a rim-type tile no structure claims. */
  readonly structure: CircusStructureId | null;
}

function tileOf(mob: Mob): TilePoint {
  return { x: Math.round(mob.x / TILE_SIZE), y: Math.round(mob.y / TILE_SIZE) };
}

/** Wider than any map, so a row and column pack into one number without colliding. */
const TILE_KEY_ROW_STRIDE = 100_000;

function keyOf(tile: TilePoint): number {
  return tile.y * TILE_KEY_ROW_STRIDE + tile.x;
}

/**
 * Walks one wave table through a real quest: reads each wave the moment it is
 * spawned, then cuts it down and runs a frame so the quest spawns the next.
 */
function readWaveTable(
  rig: QuestRig,
  table: WaveTableName,
  originOf: () => TilePoint,
): ResolvedSpawn[] {
  const waves = WAVE_TABLES[table];
  const spawns: ResolvedSpawn[] = [];
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave: ReadonlyArray<WaveSpawn> = waves[waveIndex];
    const mobs = rig.quest.captureCheckpoint().waveMobs;
    const origin = originOf();
    // A wave that came up short cannot be matched spawn-to-mob by order, so
    // every spawn of it is reported unresolved rather than guessed at.
    const matched = mobs.length === wave.length;
    wave.forEach((spawn, spawnIndex) => {
      const authored = { x: origin.x + spawn.dx, y: origin.y + spawn.dy };
      const resolved = matched ? tileOf(mobs[spawnIndex]) : null;
      spawns.push({
        key: `${table} w${waveIndex} s${spawnIndex}`,
        authored,
        resolved,
        nudgeTiles:
          resolved === null
            ? Infinity
            : Math.hypot(resolved.x - authored.x, resolved.y - authored.y),
      });
    });
    for (const mob of mobs) mob.takeDamageFrom(OVERKILL_DAMAGE, rig.human);
    rig.step();
  }
  return spawns;
}

function readSpawns(site: CircusSite): {
  spawns: ResolvedSpawn[];
  signetNudgeTiles: number;
} {
  const ritual = buildQuestRig(site, 'ritual_defense', site.centre);
  const signet = ritual.quest.captureCheckpoint().signet;
  const signetTile = signet === null ? null : tileOf(signet);
  const signetNudgeTiles =
    signetTile === null
      ? Infinity
      : Math.hypot(signetTile.x - site.lookout.x, signetTile.y - site.lookout.y);
  // Ritual offsets are authored against the lookout; the quest reads them off
  // wherever Signet was actually set down, so her own nudge is reported apart.
  const ritualSpawns = readWaveTable(ritual, 'ritual', () => site.lookout);
  const assault = buildQuestRig(site, 'assault', site.centre);
  const assaultSpawns = readWaveTable(assault, 'assault', () => site.centre);
  return { spawns: [...ritualSpawns, ...assaultSpawns], signetNudgeTiles };
}

/** Four-connected flood over tiles `passable` admits, from `start`. */
function flood(start: TilePoint, passable: (tile: TilePoint) => boolean): Set<number> {
  const seen = new Set<number>();
  if (!passable(start)) return seen;
  const queue: TilePoint[] = [start];
  seen.add(keyOf(start));
  const steps: readonly TilePoint[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  // A for-of over an array visits what is pushed onto it mid-loop, which is the queue.
  for (const here of queue) {
    for (const stepBy of steps) {
      const next = { x: here.x + stepBy.x, y: here.y + stepBy.y };
      const key = keyOf(next);
      if (seen.has(key) || !passable(next)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

function forecourtProbe(site: CircusSite): TilePoint {
  return { x: site.centre.x, y: site.centre.y + FORECOURT_PROBE_ROWS_SOUTH };
}

function doorstep(site: CircusSite): TilePoint {
  return { x: site.bigTop.doorTile.x, y: site.bigTop.doorTile.y + 1 };
}

function readReach(
  site: CircusSite,
  spawns: readonly ResolvedSpawn[],
): { unreachable: GroundsReading['unreachable']; tried: number } {
  const arenaRadius = site.radiusTiles - ARENA_SPAWN_EDGE_INSET_TILES;
  const hostilePassable = (tile: TilePoint): boolean =>
    radiusOf(site, tile) <= arenaRadius && site.map.isWalkableForHostile(tile.x, tile.y);
  const targets: ReadonlyArray<{ name: ReachTarget; tile: TilePoint }> = [
    { name: 'Big Top door', tile: doorstep(site) },
    { name: "Signet's lookout", tile: site.lookout },
    { name: 'forecourt', tile: forecourtProbe(site) },
  ];
  const unreachable: Array<{ spawn: string; target: ReachTarget }> = [];
  let tried = 0;
  for (const spawn of spawns) {
    const from = spawn.resolved;
    if (from === null) continue;
    const reached = flood(from, hostilePassable);
    for (const target of targets) {
      tried++;
      if (!reached.has(keyOf(target.tile)))
        unreachable.push({ spawn: spawn.key, target: target.name });
    }
  }
  return { unreachable, tried };
}

/**
 * Walkable tiles of the disc a crawler at the forecourt cannot reach, grouped
 * into four-connected pockets.
 */
function readPockets(site: CircusSite): Pocket[] {
  const escapeRadius = site.radiusTiles + POCKET_ESCAPE_MARGIN_TILES;
  const walkable = (tile: TilePoint): boolean => site.map.isWalkable(tile.x, tile.y);
  const reached = flood(
    forecourtProbe(site),
    (tile) => radiusOf(site, tile) <= escapeRadius && walkable(tile),
  );
  const inDisc = (tile: TilePoint): boolean => radiusOf(site, tile) <= site.radiusTiles;
  const claimed = new Set<number>(reached);
  const pockets: Pocket[] = [];
  for (const tile of discTiles(site)) {
    if (claimed.has(keyOf(tile)) || !walkable(tile)) continue;
    const pocket = flood(tile, (next) => inDisc(next) && walkable(next));
    let innermostRadius = Infinity;
    for (const key of pocket) {
      claimed.add(key);
      const x = key % TILE_KEY_ROW_STRIDE;
      const y = Math.floor(key / TILE_KEY_ROW_STRIDE);
      innermostRadius = Math.min(innermostRadius, radiusOf(site, { x, y }));
    }
    pockets.push({ size: pocket.size, at: tile, innermostRadius });
  }
  return pockets;
}

/** The tiles of each keep-clear band on this site, clipped to the grounds. */
export function bandTiles(site: CircusSite): ReadonlyMap<BandName, readonly TilePoint[]> {
  const inGrounds = (tile: TilePoint): boolean => radiusOf(site, tile) <= site.radiusTiles;
  const roadKeys = new Set<number>();
  const road: TilePoint[] = [];
  // The centre line, from the doorstep out: the full width brushes a
  // pavilion's corner where the road turns up a flank, and a road narrowed
  // there is still a road.
  for (const tile of site.roadCentreLine) {
    if (radiusOf(site, tile) > site.radiusTiles) continue;
    const key = keyOf(tile);
    if (roadKeys.has(key)) continue;
    roadKeys.add(key);
    road.push(tile);
  }
  const bands = new Map<BandName, readonly TilePoint[]>();
  for (const [name, band] of Object.entries(CIRCUS_KEEP_CLEAR_BANDS)) {
    if (!isLayoutBandName(name)) continue;
    bands.set(name, keepClearBandTiles(band, site.centre).filter(inGrounds));
  }
  bands.set('road', road);
  return bands;
}

function isLayoutBandName(name: string): name is CircusKeepClearBandName {
  return name in CIRCUS_KEEP_CLEAR_BANDS;
}

/**
 * The spawns of the lemur and stilt waves that stand outside the layout's
 * band for them: the two describe one field and must not drift apart.
 */
export function wavesOutsideTheirBands(): string[] {
  const outside: string[] = [];
  const pairs = [
    { wave: LEMUR_WAVE_INDEX, band: CIRCUS_KEEP_CLEAR_BANDS['lemur field'], name: 'lemur field' },
    { wave: STILT_WAVE_INDEX, band: CIRCUS_KEEP_CLEAR_BANDS['stilt field'], name: 'stilt field' },
  ];
  for (const { wave, band, name } of pairs) {
    for (const spawn of ASSAULT_WAVES[wave]) {
      const inside =
        spawn.dx >= band.dxFrom &&
        spawn.dx <= band.dxTo &&
        spawn.dy >= band.dyFrom &&
        spawn.dy <= band.dyTo;
      if (!inside)
        outside.push(
          `assault wave ${wave} spawn (${spawn.dx}, ${spawn.dy}) is outside the ${name}`,
        );
    }
  }
  return outside;
}

function readBands(site: CircusSite): Map<BandName, BandReading> {
  const readings = new Map<BandName, BandReading>();
  for (const [name, tiles] of bandTiles(site)) {
    readings.set(name, {
      tiles: tiles.length,
      blocked: tiles.filter((tile) => !site.map.isWalkable(tile.x, tile.y)),
    });
  }
  return readings;
}

/** Every rim structure on the site's record, with the map tiles of its footprint. */
function rimStructures(
  site: CircusSite,
): Array<{ structure: CircusStructureId; tiles: TilePoint[] }> {
  const placed = site.map.circusGrounds?.structures ?? [];
  return placed
    .filter((entry) => !FIELD_STRUCTURES.has(entry.structure))
    .map((entry) => {
      const spec = CIRCUS_STRUCTURES[entry.structure];
      const tiles = blockedSteps(spec).map((step) => ({
        x: entry.rect.x + step.dx,
        y: entry.rect.y + step.dy,
      }));
      return { structure: entry.structure, tiles };
    });
}

function readRimProps(site: CircusSite): RimPropTile[] {
  const owner = new Map<number, CircusStructureId>();
  for (const { structure, tiles } of rimStructures(site)) {
    for (const tile of tiles) owner.set(keyOf(tile), structure);
  }
  const props: RimPropTile[] = [];
  const seen = new Set<number>();
  for (const tile of discTiles(site, site.radiusTiles + RIM_PROP_SEARCH_MARGIN_TILES)) {
    const key = keyOf(tile);
    const isRimType = RIM_PROP_TILE_TYPES.has(site.map.structure[tile.y][tile.x].type);
    if (!isRimType && !owner.has(key)) continue;
    seen.add(key);
    props.push({ tile, radius: radiusOf(site, tile), structure: owner.get(key) ?? null });
  }
  // A rim structure stood beyond the search disc is still a rim prop, and
  // must still be held to the rim band.
  for (const [key, structure] of owner) {
    if (seen.has(key)) continue;
    const tile = { x: key % TILE_KEY_ROW_STRIDE, y: Math.floor(key / TILE_KEY_ROW_STRIDE) };
    props.push({ tile, radius: radiusOf(site, tile), structure });
  }
  return props;
}

/** Rim structures sealed off from the forecourt: nothing beside them a crawler can reach. */
function readUnreachableRimProps(site: CircusSite): GroundsReading['unreachableRimProps'] {
  const escapeRadius = site.radiusTiles + POCKET_ESCAPE_MARGIN_TILES;
  const reached = flood(
    forecourtProbe(site),
    (tile) => radiusOf(site, tile) <= escapeRadius && site.map.isWalkable(tile.x, tile.y),
  );
  const steps: readonly TilePoint[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const unreachable: Array<{ structure: string; at: TilePoint }> = [];
  for (const { structure, tiles } of rimStructures(site)) {
    const touchesReached = tiles.some((tile) =>
      steps.some((step) => reached.has(keyOf({ x: tile.x + step.x, y: tile.y + step.y }))),
    );
    if (!touchesReached) unreachable.push({ structure, at: tiles[0] });
  }
  return unreachable;
}

/** Every geometry reading for one site. Runs a real quest over it for the spawns. */
export function measureGrounds(site: CircusSite): GroundsReading {
  let blockedTiles = 0;
  const blockedByType = new Map<number, number>();
  for (const tile of discTiles(site)) {
    if (site.map.isWalkable(tile.x, tile.y)) continue;
    blockedTiles++;
    const type = site.map.structure[tile.y][tile.x].type;
    blockedByType.set(type, (blockedByType.get(type) ?? 0) + 1);
  }
  const { spawns, signetNudgeTiles } = readSpawns(site);
  const reach = readReach(site, spawns);
  return {
    blockedTiles,
    blockedByType,
    spawns,
    signetNudgeTiles,
    unreachable: reach.unreachable,
    reachPairsTried: reach.tried,
    pockets: readPockets(site),
    bands: readBands(site),
    rimProps: readRimProps(site),
    unreachableRimProps: readUnreachableRimProps(site),
  };
}
