/**
 * The circus grounds as the gates read them: the real generated third-floor
 * map for one world seed, the named places on it the fights are authored
 * against, and a headless rig that runs the real `CircusQuestSystem` over it.
 *
 * Shared by `verify-circus-grounds.ts` (the geometry and the assault run) and
 * `render-circus-grounds.ts` (the review render), so the gate and the picture
 * always describe the same site.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { AbilityManager } from '../../src/core/AbilityManager';
import { EventBus } from '../../src/core/EventBus';
import {
  createCircusQuestProgress,
  type CircusQuestStage,
} from '../../src/core/CircusQuestProgress';
import { createAnchorQuestProgress } from '../../src/core/AnchorQuestProgress';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import { level3 } from '../../src/levels/level3';
import { GameMap } from '../../src/map/GameMap';
import {
  BIG_TOP_ENTRY_NAME,
  OVERWORLD_BORDER_TILES,
  type BuildingEntry,
} from '../../src/map/OverworldGenerator';
import { gateHighwayTiles, widenApproach } from '../../src/map/town/paintStreets';
import { circusApproachCentreLine } from '../../src/map/overworld/paintCircusGrounds';
import { SIGNET_ANCHOR_INSET_TILES } from '../../src/systems/CircusQuestSystem';
import { CircusQuestSystem } from '../../src/systems/CircusQuestSystem';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { SpellSystem } from '../../src/systems/SpellSystem';

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** The grounds of one generated world, with the places its fights are authored against. */
export interface CircusSite {
  readonly seed: number;
  readonly map: GameMap;
  readonly centre: TilePoint;
  readonly radiusTiles: number;
  readonly bigTop: BuildingEntry;
  /** Where Signet's lookout is authored: on the centre row, inset from the east rim. */
  readonly lookout: TilePoint;
  /** Every tile the approach road is laid along, before anything else claims one. */
  readonly roadRoute: readonly TilePoint[];
  /** The road's centre line, from the Big Top's doorstep out to the town gate. */
  readonly roadCentreLine: readonly TilePoint[];
  /**
   * Every tile of the grounds' disc a town gate's highway is laid along. Read
   * from the town plan, not the grid, so a lot pass that paints over the
   * highway cannot also hide it from the gate.
   */
  readonly highwayRoute: readonly TilePoint[];
}

/**
 * Builds the real third-floor overworld for a seed and names its circus.
 * Returns a reason instead when the map has no circus or no Big Top, which a
 * gate must count as a failure rather than a skipped seed.
 */
export function buildCircusSite(seed: number): CircusSite | string {
  const map = new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
  });
  const centre = map.circusCentre;
  const radiusTiles = map.circusRadiusTiles;
  if (centre === undefined || radiusTiles === undefined) return 'the map has no circus';
  const bigTop = map.buildingEntries.find((entry) => entry.name === BIG_TOP_ENTRY_NAME);
  if (bigTop === undefined) return 'the circus has no Big Top entry';
  const plan = map.townPlan;
  if (plan === undefined) return 'the map has no town plan to route the approach road from';
  return {
    seed,
    map,
    centre,
    radiusTiles,
    bigTop,
    lookout: { x: centre.x + radiusTiles - SIGNET_ANCHOR_INSET_TILES, y: centre.y },
    roadRoute: widenApproach(circusApproachCentreLine(plan, centre)),
    roadCentreLine: circusApproachCentreLine(plan, centre),
    highwayRoute: gateHighwayTiles(plan, map.structure.length, OVERWORLD_BORDER_TILES).filter(
      (tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) <= radiusTiles,
    ),
  };
}

/** Straight-line distance of a tile from the circus centre, in tiles. */
export function radiusOf(site: CircusSite, tile: TilePoint): number {
  return Math.hypot(tile.x - site.centre.x, tile.y - site.centre.y);
}

/** Every tile of the grounds' disc, centre outward by row. */
export function discTiles(site: CircusSite, radiusTiles: number = site.radiusTiles): TilePoint[] {
  const tiles: TilePoint[] = [];
  const reach = Math.ceil(radiusTiles);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) > radiusTiles) continue;
      tiles.push({ x: site.centre.x + dx, y: site.centre.y + dy });
    }
  }
  return tiles;
}

/**
 * Rewrites one tile's type in place, the way a fault injection or a future
 * stamper would. The tile keeps everything else it carried.
 */
export function stampTileType(map: GameMap, tile: TilePoint, type: number): void {
  const row = map.structure[tile.y];
  const cell = row[tile.x];
  row[tile.x] = { ...cell, type };
  map.markTileDirty(tile.x, tile.y);
}

/** The approach angle a site is reached from, as a compass word, for labels. */
export function approachHeading(site: CircusSite): string {
  const rim = roadRimCrossing(site);
  if (rim === null) return 'unknown';
  const angle = Math.atan2(rim.y - site.centre.y, rim.x - site.centre.x);
  const headings = [
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
    'north',
    'north-east',
  ];
  const sectorRadians = (Math.PI * 2) / headings.length;
  const index =
    ((Math.round(angle / sectorRadians) % headings.length) + headings.length) % headings.length;
  return headings[index];
}

/**
 * The route tile where the approach road crosses the grounds' rim, or null
 * when the route never leaves the disc.
 */
export function roadRimCrossing(site: CircusSite): TilePoint | null {
  let best: TilePoint | null = null;
  let bestGap = Infinity;
  for (const tile of site.roadRoute) {
    const gap = Math.abs(radiusOf(site, tile) - site.radiusTiles);
    if (gap < bestGap) {
      bestGap = gap;
      best = tile;
    }
  }
  return best;
}

/** One frame-steppable party and circus quest standing on a site. */
export interface QuestRig {
  readonly quest: CircusQuestSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly ctx: SystemContext;
  /** Runs one frame in the scene's order: mobs, health, kills, quest, timers. */
  step(): void;
}

/**
 * Stands the party on `partyTile` and builds a real `CircusQuestSystem` at
 * `stage`, which spawns that stage's first wave exactly as a scene rebuild does.
 */
export function buildQuestRig(
  site: CircusSite,
  stage: CircusQuestStage,
  partyTile: TilePoint,
): QuestRig {
  const human = new HumanPlayer(partyTile.x, partyTile.y, TILE_SIZE);
  const cat = new CatPlayer(partyTile.x + 1, partyTile.y, TILE_SIZE);
  human.isActive = true;
  cat.setMap(site.map);
  const spells = new SpellSystem();
  const roster = new MobRoster(site.map, spells);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: site.map,
    extraTargets: [],
  };
  const combat: CombatContext = {
    human,
    cat,
    mobs: roster.mobs,
    mobGrid: roster.grid,
    gameMap: site.map,
    safeRoom: null,
    bus: new EventBus(),
    abilityManager: new AbilityManager(),
    spells,
    hitLanded: false,
  };
  const progress = createCircusQuestProgress();
  progress.stage = stage;
  const quest = new CircusQuestSystem(
    site.map,
    new EventBus(),
    (mob) => roster.add(mob),
    null,
    progress,
    null,
    null,
    human,
    new Conversation(null),
    { anchor: createAnchorQuestProgress() },
  );
  const mobLoop = new MobUpdateLoop();
  return {
    quest,
    human,
    cat,
    roster,
    ctx,
    step() {
      mobLoop.update(ctx);
      // The run measures the grounds, not the fight: the party is never put down.
      human.hp = human.maxHp;
      cat.hp = cat.maxHp;
      resolveKills(combat);
      quest.update(ctx);
      human.tickTimers();
      cat.tickTimers();
    },
  };
}
