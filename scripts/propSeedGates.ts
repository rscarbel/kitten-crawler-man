/**
 * What a floor art seed must not do to the prop families that carry one.
 *
 * Trees, boulders, goblin camps and the club's furniture are painted from their
 * own literal seeds plus the floor's term, and the one property their art has to
 * keep is that every frame stays inside the cell it was sized for. A frame is
 * clipped to that cell wherever it is painted, so a seed that pushes a canopy or
 * a tent shadow past the edge does not merely look different — it is sheared off
 * along a straight line, permanently, in the frame the game draws.
 *
 * Cheap enough to run over the whole alphabet: the four families together are
 * under a second a seed, almost all of it the forest.
 */

import { bakePropSheet, clippedFrames } from './propSheetBake.js';
import type { FrameEdge, PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';
import { treeSheetPlans } from '../src/sprites/sheets/treeSheets.js';
import { rockSheetPlans } from '../src/sprites/sheets/rockSheets.js';
import { CAMP_GROUNDED_EDGES, campSheetPlans } from '../src/sprites/sheets/campSheets.js';
import {
  CLUB_GROUNDED_EDGES,
  clubFurnitureSheetPlans,
} from '../src/sprites/sheets/clubFurnitureSheets.js';
import {
  CAMP_SALT,
  PROP_SALT,
  ROCK_SALT,
  TREE_SALT,
  floorArtSubSeed,
  setFloorArtSeed,
} from '../src/map/ground/floorArtSeed.js';

/** Families whose art must clear every edge of its own cell. */
const NO_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>();

interface SeededFamily {
  readonly name: string;
  readonly plans: ReadonlyArray<PropSheetPlan>;
  readonly groundedEdges: ReadonlySet<FrameEdge>;
}

/** Every prop family that carries a floor seed, painted at the seed now in force. */
function seededFamilies(): SeededFamily[] {
  return [
    {
      name: 'trees',
      plans: treeSheetPlans(floorArtSubSeed(TREE_SALT)),
      groundedEdges: NO_GROUNDED_EDGES,
    },
    {
      name: 'rocks',
      plans: rockSheetPlans(floorArtSubSeed(ROCK_SALT)),
      groundedEdges: NO_GROUNDED_EDGES,
    },
    {
      name: 'camps',
      plans: campSheetPlans(floorArtSubSeed(CAMP_SALT)),
      groundedEdges: CAMP_GROUNDED_EDGES,
    },
    {
      name: 'club',
      plans: clubFurnitureSheetPlans(floorArtSubSeed(PROP_SALT)),
      groundedEdges: CLUB_GROUNDED_EDGES,
    },
  ];
}

export interface PropSeedVerdict {
  readonly failures: ReadonlyArray<string>;
  /** Sheets actually painted, so a verdict that measured nothing can be caught. */
  readonly sheetsChecked: number;
}

/** Paints every seeded prop family at one art seed and reports what it clips. */
export function judgePropArtSeed(artSeed: number): PropSeedVerdict {
  setFloorArtSeed(artSeed);
  const failures: string[] = [];
  let sheetsChecked = 0;
  for (const family of seededFamilies()) {
    for (const plan of family.plans) {
      const baked = bakePropSheet(plan);
      sheetsChecked++;
      for (const problem of clippedFrames(plan, baked.pixels, family.groundedEdges)) {
        failures.push(`${family.name}: ${problem}`);
      }
    }
  }
  return { failures, sheetsChecked };
}
