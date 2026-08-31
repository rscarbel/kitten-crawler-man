/**
 * Turns prop sheet plans into work the environment art cache can pace.
 *
 * One step per row rather than per frame: a prop frame is a fraction of a
 * millisecond, so a step per frame would spend more on bookkeeping than on
 * painting, while a whole tree row of twenty-seven frames is still comfortably
 * inside a frame's allowance. Sheets are requested as a family — a town's street
 * furniture, a floor's forest — because that is the granularity a scene knows.
 */

import {
  requestEnvironmentSheet,
  type EnvironmentSheetPlan,
  type PaintStep,
} from '../../map/environmentArtCache';
import {
  paintPropFrame,
  propSheetPlanMismatches,
  propSheetSize,
  type PropSheetPlan,
} from './propSheetPlan';

function stepsFor(plan: PropSheetPlan): PaintStep[] {
  return plan.rows.map((row, rowIndex) => ({
    // One class per sheet row: the frames of a row are the same painter in
    // different dress, so the first row measured predicts the rest of its sheet.
    costClass: `prop:${plan.key}:${row.state}`,
    paint: (ctx) => {
      row.frames.forEach((frame, columnIndex) => {
        paintPropFrame(ctx, plan, rowIndex, columnIndex, frame);
      });
    },
  }));
}

/**
 * Queues a family of prop sheets, unless they are already painted.
 *
 * `variesWithFloorSeed` decides whether the family survives a floor change.
 * A prop whose art carries no floor seed is the same picture wherever it is
 * drawn, so it is kept while its asset group is still needed and dropped with
 * that group rather than at every set of stairs.
 */
export interface PropSheetRequest {
  readonly variesWithFloorSeed: boolean;
  /**
   * Leading rows that must be painted before the sheet may be drawn at all.
   * Defaults to every row.
   *
   * A forest's idle trees are what a floor shows the moment it opens; its
   * burning and felling rows are twenty-four frames per tree that most trees
   * never play. Publishing after the rows that are always visible puts the wood
   * on the ground in the first second and lets the rest fill in behind it.
   */
  readonly readyRows?: number;
  readonly onSheetPainted?: () => void;
}

export function requestPropSheets(
  plans: ReadonlyArray<PropSheetPlan>,
  options: PropSheetRequest,
): void {
  for (const plan of plans) {
    const mismatches = propSheetPlanMismatches(plan);
    if (mismatches.length > 0) {
      // Thrown rather than skipped: a sheet painted to an envelope the draw
      // sites do not share lands its art in the wrong place on every frame, and
      // a missing sheet is far easier to notice than a subtly offset one.
      throw new Error(mismatches.join('\n'));
    }
    const plannedSheet: EnvironmentSheetPlan = {
      key: plan.key,
      ...propSheetSize(plan),
      steps: stepsFor(plan),
      readySteps: options.readyRows,
      variesWithFloorSeed: options.variesWithFloorSeed,
      onReady: options.onSheetPainted,
    };
    requestEnvironmentSheet(plannedSheet);
  }
}
