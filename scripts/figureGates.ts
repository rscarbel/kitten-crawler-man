/**
 * The structural gates every painted figure must pass.
 *
 * A figure that ships its painter instead of its pixels has no baked PNG for
 * anyone to look at during a build, so the invariants the old bake enforced by
 * throwing — a pose that resolved to NaN and painted nothing, a cell too small
 * for the pose inside it, a row that lost its frames — have to be asserted
 * against the painter instead. These are the ones every figure shares; a
 * figure's own art gates (proportion, palette, silhouette) sit beside these in
 * its own gate module.
 *
 * A gate that cannot find what it measures fails rather than skipping: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing at all.
 */

import { EMPTY_ALPHA_CUTOFF } from '../src/core/spriteFrames.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { paintFigureCell } from './figureSheet.js';

const RGBA_STRIDE = 4;
/** Turns a 0-1 share into the percentage a failure message reads in. */
const PERCENT = 100;
/** Decimal places a cell share is reported to; a tenth of a percent is a pixel. */
const SHARE_DECIMALS = 3;
const FLOOR_DECIMALS = 2;
const ALPHA_OFFSET = 3;

/**
 * How much of the cell the widest pose must fill before the cell counts as
 * honest. A cell far larger than anything painted into it is memory every
 * instance of the figure pays for and nobody sees.
 */
const MIN_INK_AREA_SHARE = 0.15;

/**
 * The failure a filtering gate reports when its loop examined nothing.
 *
 * Every gate here narrows before it measures — planted frames only, IK-placed
 * arms only, one entry per painted piece — and a narrowing that matches nothing
 * leaves a loop that runs zero times and a gate that reports success. That is
 * the most dangerous state a gate can be in, because it looks exactly like a
 * pass. Route every filtered loop through this: count what the loop actually
 * examined and hand the count here.
 *
 * @param measured How many measurements the gate actually took.
 * @param what     What it was counting, phrased to finish "measured no …".
 */
export function nothingMeasuredFailures(measured: number, what: string): string[] {
  if (measured > 0) return [];
  return [
    `measured no ${what} at all — everything it looks at was filtered out, so it ` +
      'passed without examining anything',
  ];
}

/**
 * The failures for state names a caller asks a figure for that it does not
 * paint.
 *
 * Both draw paths skip a state they cannot find rather than throwing, so a name
 * the runtime builds and the figure lacks is an invisible creature and a silent
 * log. Any table of state names the runtime can reach — a pose-name template, a
 * gore-part list, a prewarm list — belongs in here.
 *
 * @param names   Every state name the runtime can ask for.
 * @param purpose Where those names come from, for the failure message.
 */
export function missingStateFailures(
  def: FigureDef,
  names: readonly string[],
  purpose: string,
): string[] {
  const failures = nothingMeasuredFailures(names.length, `state names from ${purpose}`);
  for (const name of names) {
    if (def.states.has(name)) continue;
    failures.push(
      `${purpose} asks for "${name}", which ${def.id} does not paint — the draw call ` +
        'returns without drawing anything and says nothing',
    );
  }
  return failures;
}

export interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The bounding box of a painted cell's ink, or null when it painted nothing. */
export function inkBoxOf(def: FigureDef, state: string, frame: number): InkBox | null {
  const cell = paintFigureCell(def, state, frame);
  const { width, height } = cell;
  const { data } = cell.getContext('2d').getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] <= EMPTY_ALPHA_CUTOFF) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

// ── Distinct frames ──────────────────────────────────────────────────────────

/**
 * How far one channel has to move before a pixel counts as having changed.
 *
 * Below about this a difference is antialiasing on an edge that did not really
 * go anywhere, and counting it lets a pose that never moved accumulate a large
 * "changed" area out of nothing. Twelve of 255 is under 5%, which is well below
 * what anyone can see in a single pixel and well above the shimmer a subpixel
 * shift leaves behind.
 */
const PERCEPTIBLE_CHANNEL_STEP = 12;

/**
 * How much of the cell two frames of one row have to differ over.
 *
 * A hash says two frames are not the same bytes. It does not say they are two
 * pictures: `mongo_adult.idle_side` frames 0 and 4 differed in eighteen pixels,
 * a tenth of a percent of the cell, because the term meant to separate them was
 * a head yaw the profile view foreshortens away — byte-distinct, and on screen
 * the same frame twice. Both figures whose rows were "fixed" by hashing alone
 * measured that way.
 *
 * Derived by measuring every pair of frames of every row of every gated figure.
 * Below the floor, before their idles were rebuilt: the mongo profile idle at
 * 0.096% (adult) and 0.180% (adolescent), which is the case this exists to
 * catch. Above it, across the shipped art, the tightest pairs are the Ball of
 * Swine's wallow at 0.300% and the Dark Knight's edge-on idle at 0.374%, so
 * 0.20% clears the worst shipped row by 1.5× and rejects the worst duplicate by
 * 2.1×.
 *
 * It is a duplicate detector and not a measure of how lively a row is: the
 * Hoarder's idles, before their weight shift, ran a hold–move–move–hold–move
 * pattern whose *held* pairs still measured 0.22%–0.54% because she is a big
 * figure and the held frames differed faintly everywhere. Loop continuity and
 * the evenness of a row are somebody else's gate; this one answers only "is
 * this frame a picture the row has already painted".
 */
const MIN_FRAME_DIFFERENCE_SHARE = 0.002;

export interface DistinctFrameOptions {
  /**
   * A pair of frames the row is meant to repeat, by state and frame index.
   *
   * The only justified shape of this so far is a one-shot authored to end on
   * the pose it began from, so that handing back to the idle is not a snap. An
   * exemption is a claim that the repeat is the art; it has to name the exact
   * pair rather than loosen a tolerance, so a row that stalls anywhere else
   * still fails.
   */
  readonly repeatsOnPurpose?: (state: string, earlier: number, later: number) => boolean;
  /** What the failure message calls the thing riding the oscillator. */
  readonly subject?: string;
}

export interface DistinctFrameReport {
  readonly failures: readonly string[];
  /** Frames examined, for `nothingMeasuredFailures`. */
  readonly framesMeasured: number;
  /** How far apart the closest pair the figure paints is, as a share of the cell. */
  readonly closestShare: number | null;
  /** That same pair, phrased for the harness log. */
  readonly closestNote: string | null;
}

/**
 * The failures for a row that paints fewer pictures than the frames it declares.
 *
 * A row whose every term rides one oscillator retraces its own path either side
 * of each turning point, so it can declare eight frames and paint five while
 * loop closure, continuity and centroid drift all stay green: those measure how
 * far the art *moves*, and a cycle that comes back the way it went moves exactly
 * as much on the return leg. A one-shot fails the same way from the other end,
 * by holding its extreme through a beat. Either way a repeated frame is a slot
 * of the cycle the player never sees and a cell the cache pays for anyway.
 *
 * Compared over full RGBA rather than over alpha, because two poses can share a
 * silhouette exactly and differ only in where the light falls.
 *
 * @param def      The figure under test.
 * @param pixelsOf The caller's own baked-cell reader, so each gate module keeps
 *                 its memoisation; it must return the cell the cache stores.
 */
export function distinctFrameFailures(
  def: FigureDef,
  pixelsOf: (state: string, frame: number) => Uint8ClampedArray,
  options: DistinctFrameOptions = {},
): DistinctFrameReport {
  const subject = options.subject ?? 'pose';
  const failures: string[] = [];
  let framesMeasured = 0;
  let closestShare: number | null = null;
  let closestPair: string | null = null;
  for (const [state, declared] of def.states) {
    const cells = Array.from({ length: declared.frames }, (_unused, frame) => {
      framesMeasured++;
      return pixelsOf(state, frame);
    });
    for (let later = 1; later < declared.frames; later++) {
      for (let earlier = 0; earlier < later; earlier++) {
        if (options.repeatsOnPurpose?.(state, earlier, later) === true) continue;
        const share = changedShare(cells[earlier], cells[later]);
        if (closestShare === null || share < closestShare) {
          closestShare = share;
          closestPair = `${def.id}.${state}[${earlier}|${later}]`;
        }
        if (share >= MIN_FRAME_DIFFERENCE_SHARE) continue;
        failures.push(
          `${def.id}.${state}[${later}] is the same picture as frame ${earlier} of the same row: ` +
            `they differ over ${(share * PERCENT).toFixed(SHARE_DECIMALS)}% of the cell ` +
            `(floor ${(MIN_FRAME_DIFFERENCE_SHARE * PERCENT).toFixed(FLOOR_DECIMALS)}%), so the row paints ` +
            `fewer pictures than the ${declared.frames} frames it declares — a term of the ` +
            `${subject} is riding the same oscillator as the rest and retracing its own path, or ` +
            'the only term that is not is one this view cannot see',
        );
      }
    }
  }
  const closestNote =
    closestPair === null || closestShare === null
      ? null
      : `${closestPair} differ over ${(closestShare * PERCENT).toFixed(SHARE_DECIMALS)}% of ` +
        `the cell (floor ${(MIN_FRAME_DIFFERENCE_SHARE * PERCENT).toFixed(FLOOR_DECIMALS)}%)`;
  return { failures, framesMeasured, closestShare, closestNote };
}

/** The share of a cell over which two frames differ by a visible amount. */
function changedShare(earlier: Uint8ClampedArray, later: Uint8ClampedArray): number {
  const pixels = earlier.length / RGBA_STRIDE;
  let changed = 0;
  for (let i = 0; i < earlier.length; i += RGBA_STRIDE) {
    let moved = false;
    for (let channel = 0; channel < RGBA_STRIDE && !moved; channel++) {
      moved = Math.abs(earlier[i + channel] - later[i + channel]) >= PERCEPTIBLE_CHANNEL_STEP;
    }
    if (moved) changed++;
  }
  return changed / pixels;
}

/** A side of the cell, for art that is authored to run off one of them. */
export type CellEdge = 'left' | 'right' | 'top' | 'bottom';

export interface StructuralGateOptions {
  /**
   * States whose art legitimately reaches the cell's edge — a full-bleed effect
   * rather than a figure standing in a padded cell.
   */
  readonly edgeBleedStates?: readonly string[];
  /**
   * Sides every state may legitimately run off, for art whose cell is a window
   * onto something larger — a machine bolted to the floor at the cell's bottom
   * edge, a projectile whose trail streams off the back.
   *
   * Preferred over exempting the states themselves: the other three sides stay
   * checked, and every cell still counts as measured, so a figure that bleeds
   * everywhere cannot turn this gate into one that examines nothing.
   */
  readonly bleedEdges?: readonly CellEdge[];
  /** States exempt from the cell-fill check, e.g. a single small gore piece. */
  readonly sparseStates?: readonly string[];
  /**
   * The frames that legitimately paint nothing, as state name to frame indices.
   *
   * An effect whose sweep runs its fade to a true zero paints an empty cell at
   * that endpoint, and that is the art rather than a defect. Declared both ways:
   * a frame named here that paints ink fails just as loudly as an undeclared
   * frame that paints none, so the exemption cannot quietly grow to cover a NaN.
   */
  readonly blankFrames?: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * How much of the cell the widest pose must fill, for a figure whose cell was
   * frozen by the bake it replaces and cannot be resized without breaking the
   * parity that proved it. Overriding this is a claim that the padding is
   * bought by something — a tail plume, a raised limb, a swing arc — and the
   * figure's own warm-row gate is what says the cells are still affordable.
   */
  readonly minInkAreaShare?: number;
}

/**
 * Runs the shared structural gates and returns one message per failure.
 *
 * @param def     The figure under test.
 * @param options Per-figure exemptions, each of which has to be justified where
 *                it is passed.
 */
export function figureStructuralFailures(
  def: FigureDef,
  options: StructuralGateOptions = {},
): string[] {
  const failures: string[] = [];
  const edgeBleed = new Set(options.edgeBleedStates ?? []);
  const sparse = new Set(options.sparseStates ?? []);
  const bleedEdges = new Set(options.bleedEdges ?? []);

  if (def.states.size === 0) failures.push(`${def.id} declares no states at all`);
  if (def.frameWidth <= 0 || def.frameHeight <= 0) {
    failures.push(`${def.id} declares a ${def.frameWidth}×${def.frameHeight} cell`);
  }
  if (def.tileScale <= 0) failures.push(`${def.id} declares tileScale ${def.tileScale}`);

  let widestInkArea = 0;
  let cellsMeasuredForFill = 0;
  let cellsMeasuredForEdge = 0;
  for (const [state, declared] of def.states) {
    if (declared.frames < 1) {
      failures.push(`${def.id}.${state} declares ${declared.frames} frames`);
      continue;
    }
    for (let frame = 0; frame < declared.frames; frame++) {
      const box = inkBoxOf(def, state, frame);
      const declaredBlank = options.blankFrames?.get(state)?.has(frame) === true;
      if (box === null) {
        if (declaredBlank) continue;
        failures.push(
          `${def.id}.${state}[${frame}] painted nothing at all, ` +
            'which almost always means a NaN in the pose',
        );
        continue;
      }
      if (declaredBlank) {
        failures.push(
          `${def.id}.${state}[${frame}] is declared a blank fade endpoint but painted ink ` +
            `at (${box.minX},${box.minY})-(${box.maxX},${box.maxY})`,
        );
      }
      const area = (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1);
      if (!sparse.has(state)) {
        widestInkArea = Math.max(widestInkArea, area);
        cellsMeasuredForFill++;
      }
      if (edgeBleed.has(state)) continue;
      cellsMeasuredForEdge++;
      const touchesEdge =
        (!bleedEdges.has('left') && box.minX <= 0) ||
        (!bleedEdges.has('top') && box.minY <= 0) ||
        (!bleedEdges.has('right') && box.maxX >= def.frameWidth - 1) ||
        (!bleedEdges.has('bottom') && box.maxY >= def.frameHeight - 1);
      if (touchesEdge) {
        failures.push(
          `${def.id}.${state}[${frame}] paints ink against the cell edge ` +
            `(${box.minX},${box.minY})-(${box.maxX},${box.maxY}) in ` +
            `${def.frameWidth}×${def.frameHeight}), so the pose is clipped`,
        );
      }
    }
  }

  failures.push(...nothingMeasuredFailures(cellsMeasuredForEdge, 'cells for clipping'));
  failures.push(...nothingMeasuredFailures(cellsMeasuredForFill, 'cells for cell fill'));

  const cellArea = def.frameWidth * def.frameHeight;
  const minFill = options.minInkAreaShare ?? MIN_INK_AREA_SHARE;
  if (widestInkArea / cellArea < minFill && cellsMeasuredForFill > 0) {
    failures.push(
      `${def.id}'s widest pose fills ${((widestInkArea / cellArea) * PERCENT).toFixed(1)}% of its ` +
        `${def.frameWidth}×${def.frameHeight} cell, under the ${(minFill * PERCENT).toFixed(1)}% it ` +
        'is held to; every instance pays for the rest',
    );
  }

  return failures;
}

/** Prints gate results and sets a failing exit code. Returns true when clean. */
export function reportFigureGates(label: string, failures: readonly string[]): boolean {
  if (failures.length === 0) {
    console.log(`  ok   ${label}`);
    return true;
  }
  for (const failure of failures) console.error(`  FAIL ${label}: ${failure}`);
  process.exitCode = 1;
  return false;
}
