/**
 * The town's decorative placements, as data.
 *
 * Split out of `TownDecorSystem` because the offline sheet generator
 * (`scripts/generate-townscape-sprites.ts`) has to bake a frame for every span
 * and every label the town actually uses, and it cannot import the system to
 * find out: that would drag `GameMap` and the whole render stack into a Node
 * script. A second, hand-copied list of spans in the generator would be a second
 * thing to keep in step — and getting it wrong shows up as a prop that silently
 * fails to draw, because there is no baked frame for its span.
 *
 * Only the tables the generator needs live here. Placements that resolve to a
 * single tile — clutter anchors, lamp strides — stay in the system, because the
 * sheet is indexed by kind and does not care where a piece stands.
 */

import type { SignpostArm } from '../sprites/townWayfinding';
import type { TownOffset } from '../map/town/townPlan';

/**
 * The signposts, by the plan's own names: one inside each gate, pointing back the
 * way you came and on down the street it opens onto.
 *
 * Anchored to a gate's `exit` rather than to its opening, then stepped *inward*
 * and sideways, so a post stands on the town's side of the wall where a traveller
 * reads it on arrival, beside the gate's road rather than in it.
 *
 * The arms point left and right because that is what a fingerpost's arms do; each
 * names what lies that way along the street the post stands on, so the labels are
 * read off the layout rather than invented.
 *
 * The order is the order their art occupies frames of `signpost.png`, so
 * appending is the only safe edit.
 */
export interface PlannedSignpost {
  readonly gateName: string;
  /** Tiles inward from the gate exit along the gate's own axis. */
  readonly inwardTiles: number;
  /** Tiles to the side of the gate's centre line, so the post is not in the road. */
  readonly sidewaysTiles: number;
  readonly arms: ReadonlyArray<SignpostArm>;
}

const SIGNPOST_INWARD_TILES = 4;
const SIGNPOST_SIDEWAYS_TILES = 3;

export const PLANNED_SIGNPOSTS: ReadonlyArray<PlannedSignpost> = [
  {
    gateName: 'south gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: -SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Low Quarter', direction: -1 },
      { label: 'The Club', direction: 1 },
    ],
  },
  {
    gateName: 'west gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Market Plaza', direction: 1 },
      { label: 'West Gate', direction: -1 },
    ],
  },
  {
    gateName: 'east gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: -SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Market Plaza', direction: -1 },
      { label: 'East Gate', direction: 1 },
    ],
  },
];

/**
 * Bunting spans, as an offset from the plaza centre and a width in tiles.
 *
 * Two spans over the civic terrace and one across the plaza's Market Street
 * frontage — the town's two bunting sites, the terrace getting a pair because it
 * is ten rows deep and one string across it reads as a stray rope. Both terrace
 * spans sit on terrace rows: the terrace runs y −18…−9 from the plaza centre, and
 * an earlier pair at −9 and −4 put the second one five rows inside the plaza.
 *
 * Stated as offsets because none of them hangs off a building or a yard; they
 * cross open ground, and the thing they are measured against is the plaza.
 */
export interface PlannedBunting {
  readonly offset: TownOffset;
  readonly spanTiles: number;
}

export const BUNTING_SPANS: ReadonlyArray<PlannedBunting> = [
  { offset: { dx: -6, dy: -13 }, spanTiles: 11 },
  { offset: { dx: -6, dy: -9 }, spanTiles: 11 },
  { offset: { dx: -8, dy: 9 }, spanTiles: 16 },
];

/**
 * Lines strung across the Low Quarter's two alleys, by the plan's surface names.
 * An alley is the narrowest thing in the town, which is what makes a line across
 * one read as spanning a gap rather than as a rope in a field.
 *
 * The ends land on the alley's flanking ground rather than on a wall — measured,
 * the nearest building is about three tiles from either end — so `drawLaundryLine`
 * stands its own poles instead of assuming there is something there to tie to.
 */
export const LAUNDRY_ALLEY_NAMES: ReadonlyArray<string> = ['club service alley', 'murder alley'];

/**
 * How far down an alley from its north end each line hangs. Both alleys are ten
 * rows deep, so two lines at these depths sit clear of each end and of each
 * other; a line past the last row is dropped rather than clamped.
 */
const LAUNDRY_FIRST_ROW_OFFSET = 3;
const LAUNDRY_SECOND_ROW_OFFSET = 7;
export const LAUNDRY_ROW_OFFSETS: ReadonlyArray<number> = [
  LAUNDRY_FIRST_ROW_OFFSET,
  LAUNDRY_SECOND_ROW_OFFSET,
];

/**
 * A laundry line is anchored one tile west of its alley and spans the alley's
 * width plus that tile, so its poles stand on the flanking ground either side.
 */
export function laundryLineSpanTiles(alleyWidthTiles: number): number {
  return alleyWidthTiles + 1;
}

/** The tile a laundry line is anchored on, given its alley's west edge. */
export function laundryLineAnchorX(alleyLeftTile: number): number {
  return alleyLeftTile - 1;
}
