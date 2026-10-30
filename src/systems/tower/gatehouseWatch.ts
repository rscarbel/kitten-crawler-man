/**
 * The tower guards' watch over the gatehouse, as pure data and geometry.
 *
 * The gatehouse reuses the prison's stealth pieces whole: its patrols are
 * scripts in the prison's language compiled by `compileStealthFloor`, its
 * guards see along `castCone`, and a noise is answered by `respondToNoise`.
 * What differs is the floor: the grid the cones are cast on is read from the
 * storey's own layout, so every wall and every piece of furniture that stands
 * on the map is the same tile that stops a guard's look. The guards carry no
 * light; they look out from just ahead of their faces.
 *
 * No scene access: `npm run verify:prison-stealth` solves this same floor.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type { StealthGuardDef, StealthLayout } from '../../map/goblinPrisonLayouts';
import { PRISON_TILE, type PrisonTile, type StealthFloor } from '../../map/goblinPrisonPlan';
import {
  buildTowerStorey,
  GATEHOUSE_PATROL_POINTS,
  towerLandingTiles,
  type TowerConditions,
} from '../../map/town/interiors/townCenterTower';
import { TOWN_INTERIOR_PROPS } from '../../sprites/art/townInterior/townInteriorProps';
import { INTERIOR_WALL } from '../../map/tileTypes';
import { compileStealthFloor, type CompiledStealth } from '../stealthKeySnatch/prisonPatrols';
import type { PrisonDifficultyTuning } from '../stealthKeySnatch/prisonTuning';

/**
 * The guards on watch. Tier 0 stands at every difficulty, 1 from normal, 2 on
 * hard only, as in the prison.
 *
 * - **hall**: walks the hall's middle row, east and back, turning each way
 *   through south so its look never swings up over the cellar stair.
 * - **stair**: walks the east side from the hearth down to the casks, the
 *   last stretch before the stair up.
 * - **muster**: stands under the muster board looking down the west side.
 */
const GATEHOUSE_GUARDS: ReadonlyArray<StealthGuardDef> = [
  { id: 'gatehouse-hall', tier: 0, script: 'a >b p50 fS p30 fW >a p50 fS p30' },
  { id: 'gatehouse-stair', tier: 1, script: 'c >d p60 >c p60' },
  { id: 'gatehouse-muster', tier: 1, script: 'e fS s50/150 p60' },
];

const GATEHOUSE_LAYOUT: StealthLayout = {
  id: 'tower_gatehouse',
  cycleFrames: 2880,
  guards: GATEHOUSE_GUARDS,
  spotlights: [],
};

/**
 * The gatehouse's watch per difficulty. The hall is lit, so the guards see a
 * little further than the prison's goblins do down their flashlights, and
 * they walk at a guard's pace, not a patrol's hurry.
 */
export const GATEHOUSE_TUNING: Readonly<Record<Difficulty, PrisonDifficultyTuning>> = {
  easy: {
    guardTier: 0,
    spotlightTier: 0,
    cone: { rangeTiles: 4.5, halfAngleDeg: 28, softEdge: 0.3 },
    patrolSpeedPxPerFrame: 0.9,
    turnDegPerFrame: 2.5,
    spotlight: { radiusTiles: 0, speedPxPerFrame: 0 },
    suspicion: { coneFillFrames: 60, coneEdgeWeight: 0.35, spotFillFrames: 1, drainFrames: 90 },
  },
  normal: {
    guardTier: 1,
    spotlightTier: 1,
    cone: { rangeTiles: 5, halfAngleDeg: 30, softEdge: 0.25 },
    patrolSpeedPxPerFrame: 1,
    turnDegPerFrame: 3,
    spotlight: { radiusTiles: 0, speedPxPerFrame: 0 },
    suspicion: { coneFillFrames: 45, coneEdgeWeight: 0.35, spotFillFrames: 1, drainFrames: 120 },
  },
  hard: {
    guardTier: 2,
    spotlightTier: 2,
    cone: { rangeTiles: 5.5, halfAngleDeg: 32, softEdge: 0.2 },
    patrolSpeedPxPerFrame: 1.1,
    turnDegPerFrame: 3.5,
    spotlight: { radiusTiles: 0, speedPxPerFrame: 0 },
    suspicion: { coneFillFrames: 34, coneEdgeWeight: 0.4, spotFillFrames: 1, drainFrames: 150 },
  },
};

/** The gatehouse's floor as its guards see it: walls, the furniture that stops a look, and open floor. */
function gatehouseStealthFloor(conditions: TowerConditions): StealthFloor {
  const build = buildTowerStorey('gatehouse', conditions);
  const { width, height } = build.plan;
  const tiles = new Uint8Array(width * height).fill(PRISON_TILE.wall);
  for (const entry of build.entries) {
    if (entry.kind === 'tile') {
      tiles[entry.y * width + entry.x] =
        entry.tileType === INTERIOR_WALL ? PRISON_TILE.wall : PRISON_TILE.floor;
      continue;
    }
    const def = TOWN_INTERIOR_PROPS[entry.propId];
    if (def.passableBy.has('walker')) continue;
    for (let dy = 0; dy < def.footprint.h; dy++)
      for (let dx = 0; dx < def.footprint.w; dx++)
        tiles[(entry.y + dy) * width + entry.x + dx] = PRISON_TILE.cover;
  }
  const waypoints = new Map<string, PrisonTile>(Object.entries(GATEHOUSE_PATROL_POINTS));
  return {
    layout: GATEHOUSE_LAYOUT,
    grid: { width, height, tiles },
    waypoints,
    anchors: new Map(),
  };
}

/** The gatehouse's watch at one difficulty. */
export function compileGatehouseWatch(
  conditions: TowerConditions,
  difficulty: Difficulty,
  tuning: PrisonDifficultyTuning = GATEHOUSE_TUNING[difficulty],
): CompiledStealth {
  return compileStealthFloor(gatehouseStealthFloor(conditions), difficulty, tuning, 'eyes');
}

/** Where a caught party is put back: the landing of the cellar stair it came up. */
export function gatehouseCellarLanding(conditions: TowerConditions): PrisonTile {
  const { stairDown } = buildTowerStorey('gatehouse', conditions).plan;
  if (stairDown === null) throw new Error('the gatehouse has no cellar stair');
  return { x: stairDown.x, y: stairDown.y + LANDING_ROW_BELOW_STAIR };
}

/** The tiles in front of the stair up, which reaching unseen is crossing the gatehouse. */
export function gatehouseStairUpLanding(conditions: TowerConditions): ReadonlyArray<PrisonTile> {
  const { stairUp } = buildTowerStorey('gatehouse', conditions).plan;
  if (stairUp === null) throw new Error('the gatehouse has no stair up');
  return towerLandingTiles(stairUp);
}

/** A 2×2 stair's landing starts two rows below its north-west tile. */
const LANDING_ROW_BELOW_STAIR = 2;
