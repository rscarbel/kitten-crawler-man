/**
 * The floor-3 wilderness's two enemy camps: a goblin camp and a troglodyte den.
 *
 * These are **landmarks, not a population change.** Ruins ghouls and krasues
 * stay the dominant force on the floor — the ambient spawn table is untouched —
 * and what a camp adds is a place on the map that is obviously *somebody's*,
 * with its own residents standing around it.
 *
 * The camps are also deliberately inert: nothing here clears, respawns, or
 * reports. What it does leave is a clean seam — the sites come out of the
 * generator on `OverworldData.camps` and are carried onto `GameMap` exactly the
 * way the circus's centre and radius are — so a future quest can find a camp
 * without the generator having to know anything about quests.
 */

import {
  BONES,
  BOULDER_LARGE,
  BOULDER_SMALL,
  CAMPFIRE,
  CRATE,
  DEN_HOLLOW,
  FloorTypeValue,
  GOBLIN_TENT,
  SCREE,
} from '../tileTypes';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import type { ElevationField } from './elevation';

/** Which kind of camp a site is. Consumed by `LevelDef.campSpawns`. */
export type CampKind = 'goblin' | 'troglodyte';

/** A camp site, as the generator hands it out. */
export interface CampSite {
  readonly kind: CampKind;
  readonly centre: TilePoint;
  readonly radiusTiles: number;
}

const CAMP_RADIUS_TILES = 7;

/** Clearances a camp site must respect, past each site's own radius. */
const CAMP_TOWN_CLEARANCE_TILES = 10;
const CAMP_CIRCUS_CLEARANCE_TILES = 10;
/** Two camps this close would read as one settlement with two halves. */
const CAMP_SEPARATION_TILES = 50;
/** A camp needs dry ground under it; the disc is cleared, water cannot be. */
const CAMP_WATER_CLEARANCE_TILES = 3;

/** How many sites are tried before a camp is skipped for this map. */
const CAMP_SITE_ATTEMPTS = 400;

/** Nearest a camp may be sited to the town, in tiles. */
const CAMP_MIN_DISTANCE_TILES = 58;
/** Furthest, as a fraction of the map's half-width — so it stays off the border. */
const CAMP_MAX_DISTANCE_FRACTION = 0.82;

/**
 * How strongly a site prefers the band its camp belongs in.
 *
 * A preference, not a rule: goblins want open low country near a route, trogs
 * want high broken ground. On a map whose elevation field happens to offer
 * neither, a camp placed in the wrong band is much better than no camp — so the
 * search takes the best-scoring site it saw rather than insisting on a perfect
 * one.
 */
const PREFERRED_BAND_SCORE = 1;
const ADJACENT_BAND_SCORE = 0.4;

/** Goblin camp dressing. */
const GOBLIN_TENT_COUNT = 4;
/** Tents keep this many tiles clear of each other and of the fire. */
const TENT_CLEARANCE_TILES = 3;
const TENT_RING_RADIUS_TILES = 4;
const GOBLIN_BONES_COUNT = 6;
const GOBLIN_CRATE_COUNT = 3;

/** Troglodyte den dressing. */
const DEN_BOULDER_COUNT = 9;
const DEN_BOULDER_RING_RADIUS_TILES = 5;
const DEN_LARGE_BOULDER_SHARE = 0.7;
const DEN_BONES_COUNT = 14;
const DEN_HOLLOW_RADIUS_TILES = 1;

/** Full circle, for placing things on a ring. */
const TWO_PI = Math.PI * 2;

interface CampExclusion {
  readonly centreX: number;
  readonly centreY: number;
  readonly radiusTiles: number;
}

function distanceTo(exclusion: CampExclusion, x: number, y: number): number {
  return Math.hypot(x - exclusion.centreX, y - exclusion.centreY);
}

export function hasWaterWithin(grid: TileGrid, centre: TilePoint, radiusTiles: number): boolean {
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      if (Math.hypot(dx, dy) > radiusTiles) continue;
      if (grid.typeAt(centre.x + dx, centre.y + dy) === FloorTypeValue.water) return true;
    }
  }
  return false;
}

/**
 * How well a site suits a camp of this kind, by the band it stands in.
 *
 * `bandAt` is the same field the whole wilderness is derived from, so a
 * troglodyte den scored on it lands where the scree and the boulders already
 * are — which is the entire reason there is one shared field rather than one
 * noise source per feature.
 */
function bandScoreFor(kind: CampKind, elevation: ElevationField, site: TilePoint): number {
  const band = elevation.bandAt(site.x, site.y);
  if (kind === 'goblin') {
    if (band === 'meadow' || band === 'lowland') return PREFERRED_BAND_SCORE;
    return band === 'highland' ? ADJACENT_BAND_SCORE : 0;
  }
  if (band === 'highland' || band === 'ridge') return PREFERRED_BAND_SCORE;
  return band === 'meadow' ? ADJACENT_BAND_SCORE : 0;
}

/**
 * Picks a site for one camp, or `null` when the map has nowhere to put it.
 *
 * Returning `null` rather than forcing a placement is the right failure: a map
 * with one camp is a slightly emptier map, whereas a camp dropped on the town
 * wall or in the middle of a river is a broken one.
 */
function pickCampSite(
  grid: TileGrid,
  kind: CampKind,
  elevation: ElevationField,
  exclusions: ReadonlyArray<CampExclusion>,
  townCentre: TilePoint,
  border: number,
): TilePoint | null {
  const maxDistance = (grid.size / 2) * CAMP_MAX_DISTANCE_FRACTION;
  let best: TilePoint | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < CAMP_SITE_ATTEMPTS; attempt++) {
    const angle = Math.random() * TWO_PI;
    const distance =
      CAMP_MIN_DISTANCE_TILES + Math.random() * Math.max(0, maxDistance - CAMP_MIN_DISTANCE_TILES);
    const site: TilePoint = {
      x: Math.round(townCentre.x + Math.cos(angle) * distance),
      y: Math.round(townCentre.y + Math.sin(angle) * distance),
    };

    const margin = border + CAMP_RADIUS_TILES + 1;
    if (site.x < margin || site.y < margin) continue;
    if (site.x >= grid.size - margin || site.y >= grid.size - margin) continue;
    if (exclusions.some((zone) => distanceTo(zone, site.x, site.y) < zone.radiusTiles)) continue;
    if (hasWaterWithin(grid, site, CAMP_RADIUS_TILES + CAMP_WATER_CLEARANCE_TILES)) continue;

    const score = bandScoreFor(kind, elevation, site);
    if (score > bestScore) {
      bestScore = score;
      best = site;
      if (score >= PREFERRED_BAND_SCORE) break;
    }
  }
  return best;
}

/** Clears a camp's disc down to one surface, so the dressing reads as a floor. */
function clearDisc(grid: TileGrid, centre: TilePoint, radiusTiles: number, surface: number): void {
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      if (Math.hypot(dx, dy) > radiusTiles) continue;
      const tx = centre.x + dx;
      const ty = centre.y + dy;
      // The town's own structures are the one thing a camp may never eat. The
      // site search already holds it well clear of them; this is the backstop
      // that makes that a guarantee rather than a tuning assumption.
      if (grid.isSolid(tx, ty)) continue;
      grid.set(tx, ty, surface);
    }
  }
}

/** Scatters a decoration over a camp's cleared disc, avoiding what already stands. */
function scatterInCamp(
  grid: TileGrid,
  centre: TilePoint,
  radiusTiles: number,
  type: number,
  count: number,
): void {
  for (let placed = 0; placed < count; placed++) {
    const angle = Math.random() * TWO_PI;
    const reach = Math.sqrt(Math.random()) * radiusTiles;
    const tx = Math.round(centre.x + Math.cos(angle) * reach);
    const ty = Math.round(centre.y + Math.sin(angle) * reach);
    if (grid.isSolid(tx, ty)) continue;
    grid.setStanding(tx, ty, type);
  }
}

/**
 * A goblin camp: a beaten-earth disc, a fire at the centre, tents ringed around
 * it, and the litter of people who live outdoors.
 */
function paintGoblinCamp(grid: TileGrid, centre: TilePoint): void {
  clearDisc(grid, centre, CAMP_RADIUS_TILES, FloorTypeValue.road);
  grid.setStanding(centre.x, centre.y, CAMPFIRE);

  // Tents on a ring, rejected where they would crowd another — the same
  // clearance idiom the circus's small tents use.
  const placed: TilePoint[] = [centre];
  for (let tent = 0; tent < GOBLIN_TENT_COUNT; tent++) {
    const angle = (tent / GOBLIN_TENT_COUNT) * TWO_PI + Math.random();
    const spot: TilePoint = {
      x: Math.round(centre.x + Math.cos(angle) * TENT_RING_RADIUS_TILES),
      y: Math.round(centre.y + Math.sin(angle) * TENT_RING_RADIUS_TILES),
    };
    if (grid.isSolid(spot.x, spot.y)) continue;
    if (
      placed.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < TENT_CLEARANCE_TILES)
    )
      continue;
    grid.setStanding(spot.x, spot.y, GOBLIN_TENT);
    placed.push(spot);
  }

  scatterInCamp(grid, centre, CAMP_RADIUS_TILES, BONES, GOBLIN_BONES_COUNT);
  scatterInCamp(grid, centre, CAMP_RADIUS_TILES, CRATE, GOBLIN_CRATE_COUNT);
}

/**
 * A troglodyte den: a scree hollow ringed with boulders, thick with bones.
 *
 * No structures — the rock family does all the work, which is the point. A
 * troglodyte does not build; it moves into somewhere.
 */
function paintTroglodyteDen(grid: TileGrid, centre: TilePoint): void {
  clearDisc(grid, centre, CAMP_RADIUS_TILES, SCREE);
  grid.setStanding(centre.x, centre.y, DEN_HOLLOW);
  for (let dy = -DEN_HOLLOW_RADIUS_TILES; dy <= DEN_HOLLOW_RADIUS_TILES; dy++) {
    for (let dx = -DEN_HOLLOW_RADIUS_TILES; dx <= DEN_HOLLOW_RADIUS_TILES; dx++) {
      if (Math.hypot(dx, dy) > DEN_HOLLOW_RADIUS_TILES) continue;
      if (grid.isSolid(centre.x + dx, centre.y + dy)) continue;
      grid.setStanding(centre.x + dx, centre.y + dy, DEN_HOLLOW);
    }
  }

  for (let boulder = 0; boulder < DEN_BOULDER_COUNT; boulder++) {
    const angle = (boulder / DEN_BOULDER_COUNT) * TWO_PI + Math.random();
    const tx = Math.round(centre.x + Math.cos(angle) * DEN_BOULDER_RING_RADIUS_TILES);
    const ty = Math.round(centre.y + Math.sin(angle) * DEN_BOULDER_RING_RADIUS_TILES);
    if (grid.isSolid(tx, ty)) continue;
    const isLarge = Math.random() < DEN_LARGE_BOULDER_SHARE;
    grid.setStanding(tx, ty, isLarge ? BOULDER_LARGE : BOULDER_SMALL);
  }

  scatterInCamp(grid, centre, CAMP_RADIUS_TILES, BONES, DEN_BONES_COUNT);
}

/**
 * Sites and paints both camps.
 *
 * Runs after the forests and the ruins so it can clear its own ground — a camp
 * is a place people have cleared — and before the ambient spawn scatter, which
 * excludes the camps so ghouls do not loiter in somebody else's.
 */
export function paintCamps(
  grid: TileGrid,
  plan: TownPlan,
  elevation: ElevationField,
  circus: CampExclusion,
  border: number,
): CampSite[] {
  const exclusions: CampExclusion[] = [
    {
      centreX: plan.centre.x,
      centreY: plan.centre.y,
      radiusTiles: plan.safeRadiusTiles + CAMP_TOWN_CLEARANCE_TILES + CAMP_RADIUS_TILES,
    },
    {
      centreX: circus.centreX,
      centreY: circus.centreY,
      radiusTiles: circus.radiusTiles + CAMP_CIRCUS_CLEARANCE_TILES + CAMP_RADIUS_TILES,
    },
  ];

  const camps: CampSite[] = [];
  const kinds: ReadonlyArray<CampKind> = ['goblin', 'troglodyte'];
  for (const kind of kinds) {
    const centre = pickCampSite(grid, kind, elevation, exclusions, plan.centre, border);
    if (centre === null) continue;
    if (kind === 'goblin') paintGoblinCamp(grid, centre);
    else paintTroglodyteDen(grid, centre);
    camps.push({ kind, centre, radiusTiles: CAMP_RADIUS_TILES });
    // The camp just placed becomes an exclusion for the next one, so the two
    // never read as one settlement with two halves.
    exclusions.push({ centreX: centre.x, centreY: centre.y, radiusTiles: CAMP_SEPARATION_TILES });
  }
  return camps;
}
