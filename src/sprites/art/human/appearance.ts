/**
 * The figure Carl is painted as in each outfit.
 *
 * A cached cell is keyed by figure, state and frame and shared by every draw,
 * so what he wears cannot be a parameter of one draw: each outfit is a figure
 * of its own, painted from the same rows, keyed by the outfit's garments and by
 * the grip his fist closes on. Only one Carl exists, so only his current
 * outfit's figures are resident, one per grip he draws with; the runtime swaps
 * them when his equipment changes and releases the old ones.
 */

import type { HumanGarmentRow } from '../carl/carlParts';
import { type CarlPose } from '../carl/rig';
import { type FigureDef } from '../../figure/figureDef';
import { DEFAULT_CARL_OUTFIT } from '../../garments/human/carlDressing';
import type { Outfit } from '../../garments/outfit';
import {
  firstImpactFrame,
  HUMAN_FIGURE,
  HUMAN_FIGURE_PAINTING,
  HUMAN_ROWS,
  type HumanFigurePainting,
  humanHeldLayers,
  type HumanRowName,
  paintDressedHumanFrame,
  type RowSpec,
} from '../humanFigure';
import { type CarriedGrip, carriedGripKey, carryInMainHand } from './carry';

// ── What a row tells the garments that move with it ──────────────────────────

/**
 * Whether a row is a punch his right fist lands, as its strike metadata names
 * the limb. The art gates hold that name to the rig: the named fist is the one
 * driven furthest on the impact frame.
 */
function rightFistLandsBlow(row: RowSpec): boolean {
  const strike = row.strike;
  if (row.role !== 'strike' || strike === undefined) return false;
  return strike.tags.includes('punch') && strike.reachLimb === 'hand';
}

const RIGHT_PUNCH_ROWS: ReadonlySet<HumanRowName> = new Set(
  HUMAN_ROWS.filter(rightFistLandsBlow).map((row) => row.name),
);

/**
 * The rows on which the gauntlet turns to spiked steel round his right fist.
 * The art gates hold it to a non-empty set with the cross in it.
 */
export const HUMAN_RIGHT_PUNCH_ROWS: readonly HumanRowName[] = [...RIGHT_PUNCH_ROWS];

/** What `row` tells a garment that moves with it: the right punch it lands, the gait it travels at. */
export function garmentRowOf(row: RowSpec): HumanGarmentRow {
  const impact = firstImpactFrame(row);
  const travelling = row.locomotion === 'travelling';
  const gait = row.gait ?? row.bridges;
  return {
    name: row.name,
    rightPunchImpact: RIGHT_PUNCH_ROWS.has(row.name) && impact !== undefined ? impact : null,
    travellingGait: travelling ? (gait === 'walk' ? 'walk' : 'run') : null,
  };
}

// ── Figures ──────────────────────────────────────────────────────────────────

/**
 * A row's pose as it is painted in `outfit`: the outfit, and the row and frame
 * its garments read, laid onto it. For gates that pose a cell themselves.
 */
export function dressedPose(
  outfit: Outfit<'human'>,
  pose: CarlPose,
  row: RowSpec,
  frame: number,
): CarlPose {
  return {
    ...pose,
    outfit: { outfit, row: garmentRowOf(row), frame, frameCount: row.frameCount },
  };
}

const DEFAULT_KEY = figureKey(DEFAULT_CARL_OUTFIT, null);

/** One of Carl's figures: the cells it paints, and how it paints them. */
export interface HumanFigure {
  readonly def: FigureDef;
  readonly painting: HumanFigurePainting;
}

/**
 * Built on first use rather than all up front: a `FigureDef` costs nothing
 * resident, but most outfits are never worn in a session.
 */
const figuresByKey = new Map<string, HumanFigure>();

const BASE_FIGURE: HumanFigure = { def: HUMAN_FIGURE, painting: HUMAN_FIGURE_PAINTING };

/** The key a figure is cached under: the outfit, and the handle in his main hand if any. */
function figureKey(outfit: Outfit<'human'>, held: CarriedGrip | null): string {
  return held === null ? outfit.key : `${outfit.key}:holding-${carriedGripKey(held)}`;
}

/**
 * The figure Carl is painted as in `outfit`, his main hand closed on an
 * equipment-chosen item the way `held` says, or holding nothing. The default
 * outfit holding nothing is `HUMAN_FIGURE` itself; every other shares its
 * rows, cell and budget and differs in its id, in the garments laid on each pose
 * and in what closes his right fist.
 *
 * A held item is not part of the figure: only the fist closed round its
 * handle is, and each frame it closes on one is baked in two layers so the
 * item can be drawn between them.
 */
export function humanFigureFor(outfit: Outfit<'human'>, held: CarriedGrip | null): HumanFigure {
  const key = figureKey(outfit, held);
  if (key === DEFAULT_KEY) return BASE_FIGURE;
  const known = figuresByKey.get(key);
  if (known !== undefined) return known;
  const dress = (pose: CarlPose, row: RowSpec, frame: number): CarlPose => {
    const dressed = dressedPose(outfit, pose, row, frame);
    return held === null ? dressed : carryInMainHand(dressed, row, held);
  };
  const painting: HumanFigurePainting = {
    dress,
    itemHandle: HUMAN_FIGURE_PAINTING.itemHandle,
  };
  const figure: HumanFigure = {
    def: {
      ...HUMAN_FIGURE,
      id: `${HUMAN_FIGURE.id}:${key}`,
      paintFrame: (ctx, state, frame) => paintDressedHumanFrame(ctx, state, frame, painting),
      heldLayers: humanHeldLayers(painting),
    },
    painting,
  };
  figuresByKey.set(key, figure);
  return figure;
}

/** The figure Carl is painted as in `outfit`, holding nothing of equipment's choosing. */
export function humanFigureWearing(outfit: Outfit<'human'>): FigureDef {
  return humanFigureFor(outfit, null).def;
}
