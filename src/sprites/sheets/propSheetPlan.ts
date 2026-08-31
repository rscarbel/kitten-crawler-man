/**
 * A prop sheet, described once and painted in two places.
 *
 * The town's street furniture, the forest, the boulders and the camps are all
 * painted by the game's own painters in `src/sprites/`. What used to differ
 * between the shipped game and the offline bakers was only *who* called those
 * painters: the game loaded a PNG, and a script in `scripts/` decided which
 * pictures went on it. That decision — the frame envelope, which state is which
 * row, how many frames a row holds — now lives here, so the sheet the game
 * paints and the sheet a review bake writes cannot describe different art.
 *
 * The frame envelope is not derived from the manifest, it is checked against it:
 * `SpriteLoader`'s entry is what every draw site, footprint and cull margin is
 * written against, and a plan that disagrees with it is the frame-size drift
 * that shows up as one prop bleeding a neighbour's row.
 */

import { getManifestEntry, sheetSizePx, type SpriteKey } from '../../core/SpriteLoader';

/** Paints one frame with the anchor tile's top-left corner at (originX, originY). */
export type FramePainter = (
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
) => void;

export interface PropSheetRow {
  /** Manifest state name. Rows are laid out in this array's order. */
  readonly state: string;
  readonly frames: ReadonlyArray<FramePainter>;
}

/** A frame's four boundaries, named so a family can say which it stands on. */
export type FrameEdge = 'top' | 'bottom' | 'left' | 'right';

export interface PropSheetPlan {
  readonly key: SpriteKey;
  /** File a review bake writes, under the plan family's preview directory. */
  readonly file: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Where the anchor tile's top-left corner sits inside a frame. */
  readonly tileX: number;
  readonly tileY: number;
  /** Source pixels per game tile the painters were authored against. */
  readonly tileScale: number;
  readonly rows: ReadonlyArray<PropSheetRow>;
}

/**
 * Checks a plan against the manifest entry every draw site reads, and returns
 * what disagrees.
 *
 * Returned rather than thrown so a gate can report every mismatch in a family at
 * once instead of stopping at the first; the runtime painter throws on the same
 * list, because a sheet painted to the wrong envelope is art that silently
 * lands in the wrong place forever.
 */
export function propSheetPlanMismatches(plan: PropSheetPlan): string[] {
  const entry = getManifestEntry(plan.key);
  const problems: string[] = [];
  const compare = (field: string, planned: number, declared: number): void => {
    if (planned !== declared) {
      problems.push(`${plan.key}: plan says ${field} ${planned}, manifest says ${declared}`);
    }
  };
  compare('frameWidth', plan.frameWidth, entry.frameWidth);
  compare('frameHeight', plan.frameHeight, entry.frameHeight);
  compare('tileX', plan.tileX, entry.tileX);
  compare('tileY', plan.tileY, entry.tileY);
  compare('tileScale', plan.tileScale, entry.tileScale);

  const declaredStates = Object.entries(entry.states);
  if (declaredStates.length !== plan.rows.length) {
    problems.push(
      `${plan.key}: plan paints ${plan.rows.length} rows, manifest declares ${declaredStates.length}`,
    );
  }
  plan.rows.forEach((row, rowIndex) => {
    const declared = declaredStates.find(([name]) => name === row.state);
    if (declared === undefined) {
      problems.push(`${plan.key}: manifest declares no row "${row.state}"`);
      return;
    }
    const [, state] = declared;
    if (state.row !== rowIndex) {
      problems.push(
        `${plan.key}: plan paints "${row.state}" on row ${rowIndex}, manifest says ${state.row}`,
      );
    }
    if (state.frameCount !== row.frames.length) {
      problems.push(
        `${plan.key}: plan paints ${row.frames.length} frames of "${row.state}", ` +
          `manifest declares ${state.frameCount}`,
      );
    }
  });
  return problems;
}

/**
 * Sheet size in pixels, read off the manifest entry the plan has just been
 * proved to agree with — so the surface a plan paints into and the surface
 * `registerPaintedSprite` expects are one number rather than two that match.
 */
export function propSheetSize(plan: PropSheetPlan): { widthPx: number; heightPx: number } {
  return sheetSizePx(getManifestEntry(plan.key));
}

/**
 * Paints one frame into its cell of a sheet.
 *
 * Clipped to the cell, which is load-bearing rather than defensive: a painter
 * that reaches past the envelope it was sized for bleeds into the neighbouring
 * frame, and the result reads as a drawing bug in the *next* picture. The
 * offline bakers have always clipped, so painting unclipped at runtime would
 * make the game and the review sheets disagree exactly where a frame is too
 * small.
 */
export function paintPropFrame(
  ctx: CanvasRenderingContext2D,
  plan: PropSheetPlan,
  rowIndex: number,
  columnIndex: number,
  paint: FramePainter,
): void {
  const cellX = columnIndex * plan.frameWidth;
  const cellY = rowIndex * plan.frameHeight;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(cellX, cellY, plan.frameWidth, plan.frameHeight);
    ctx.clip();
    paint(ctx, cellX + plan.tileX, cellY + plan.tileY);
  } finally {
    ctx.restore();
  }
}
