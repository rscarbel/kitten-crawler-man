/**
 * Bakes prop sheet plans to PNG for review.
 *
 * The shipped game paints these sheets for itself from the same plans
 * (`src/sprites/sheets/`), so nothing written here is loaded by anything: this
 * is the eye's copy. What it still earns its keep for is the checks — that a
 * plan agrees with the manifest entry every draw site reads, and that no painter
 * draws outside the cell it was sized for, which is invisible in a typecheck and
 * permanent once a frame is clipped.
 */

import { createCanvas, type Canvas, type ImageData } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { asGameContext } from './nodeGameContext.js';
import {
  paintPropFrame,
  propSheetPlanMismatches,
  propSheetSize,
  type FrameEdge,
  type PropSheetPlan,
} from '../src/sprites/sheets/propSheetPlan.js';

export const PROP_PREVIEW_ROOT = resolve('preview/props');

/**
 * Alpha at or below which a border pixel counts as empty. Not zero: a shape
 * clamped to land exactly on the edge still antialiases a whisper of colour into
 * the last row.
 */
const FRAME_EDGE_ALPHA_TOLERANCE = 24;
const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;

/**
 * Reports every frame with ink on its own border.
 *
 * A frame is clipped to its cell wherever it is painted, so art that reaches
 * past the cell is not merely invisible — it is sheared off along a straight
 * line. That has already happened three times in the forest (pine flame tips
 * against the top edge, collapse dust against the bottom, the conifer skirt
 * hanging below the ground line), and none of it showed up in a typecheck, a
 * lint or a glance at the sheet.
 *
 * `groundedEdges` names the edges a family paints against on purpose. A prop
 * whose footprint row *is* the frame's last tile row stands on the bottom edge:
 * its contact shadow pools against that line because there is nowhere below it
 * to pool into, and every one of its frames would otherwise be reported forever.
 *
 * It is declared per *family*, not per sheet, which is a real limit: one grounded
 * prop turns that edge off for every frame of every sheet beside it. That is the
 * right granularity today, because a family shares one frame envelope and one
 * anchor convention — a club counter and a club stool stand on the same line. A
 * family whose members stopped sharing that would need the declaration to move
 * onto the plan.
 */
export function clippedFrames(
  plan: PropSheetPlan,
  pixels: ImageData,
  groundedEdges: ReadonlySet<FrameEdge> = new Set(),
): string[] {
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];

  const problems: string[] = [];
  plan.rows.forEach((row, rowIndex) => {
    row.frames.forEach((_frame, columnIndex) => {
      const left = columnIndex * plan.frameWidth;
      const top = rowIndex * plan.frameHeight;
      const right = left + plan.frameWidth - 1;
      const bottom = top + plan.frameHeight - 1;
      const report = (edge: string): void => {
        problems.push(
          `${plan.key} ${row.state} frame ${columnIndex} is clipped at its ${edge} edge — ` +
            `the painter drew outside the ${plan.frameWidth}x${plan.frameHeight} cell`,
        );
      };
      const inked = (edge: FrameEdge, alpha: number): boolean =>
        !groundedEdges.has(edge) && alpha > FRAME_EDGE_ALPHA_TOLERANCE;
      for (let x = left; x <= right; x++) {
        if (inked('top', alphaAt(x, top))) return report('top');
        if (inked('bottom', alphaAt(x, bottom))) return report('bottom');
      }
      for (let y = top; y <= bottom; y++) {
        if (inked('left', alphaAt(left, y))) return report('left');
        if (inked('right', alphaAt(right, y))) return report('right');
      }
    });
  });
  return problems;
}

/**
 * A per-family pixel check. Returns what is wrong rather than throwing, so a
 * bake reports every fault in a family at once instead of stopping at the first.
 */
export type PropSheetCheck = (plan: PropSheetPlan, pixels: ImageData) => string[];

export interface BakedSheet {
  readonly plan: PropSheetPlan;
  /**
   * The painted sheet itself. Review harnesses draw from this rather than from a
   * file, so what they show is what the game paints and not what some earlier
   * bake happened to leave on disk.
   */
  readonly canvas: Canvas;
  readonly pixels: ImageData;
  readonly png: Buffer;
}

/** Paints one plan into a node canvas, exactly as the game paints it. */
export function bakePropSheet(plan: PropSheetPlan): BakedSheet {
  const { widthPx, heightPx } = propSheetSize(plan);
  const canvas = createCanvas(widthPx, heightPx);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  plan.rows.forEach((row, rowIndex) => {
    row.frames.forEach((frame, columnIndex) => {
      paintPropFrame(ctx, plan, rowIndex, columnIndex, frame);
    });
  });
  return {
    plan,
    canvas,
    pixels: nodeCtx.getImageData(0, 0, canvas.width, canvas.height),
    png: canvas.toBuffer('image/png'),
  };
}

export interface PropFamilyBake {
  readonly extraChecks?: ReadonlyArray<PropSheetCheck>;
  /** Frame edges this family's art is meant to reach — see `clippedFrames`. */
  readonly groundedEdges?: ReadonlySet<FrameEdge>;
}

/**
 * Bakes a family for review and returns everything wrong with it.
 *
 * Nothing is written until every sheet has been painted and checked, so a family
 * with one bad sheet does not leave the review directory half-updated and
 * half-believable.
 */
export function bakePropFamily(
  directoryName: string,
  plans: ReadonlyArray<PropSheetPlan>,
  options: PropFamilyBake = {},
): string[] {
  const extraChecks = options.extraChecks ?? [];
  const problems: string[] = [];
  const baked = plans.map((plan) => {
    problems.push(...propSheetPlanMismatches(plan));
    const sheet = bakePropSheet(plan);
    problems.push(...clippedFrames(plan, sheet.pixels, options.groundedEdges));
    for (const check of extraChecks) problems.push(...check(plan, sheet.pixels));
    return sheet;
  });
  if (problems.length > 0) return problems;

  const outDir = resolve(PROP_PREVIEW_ROOT, directoryName);
  mkdirSync(outDir, { recursive: true });
  for (const sheet of baked) {
    writeFileSync(resolve(outDir, sheet.plan.file), sheet.png);
    const frames = sheet.plan.rows.reduce((total, row) => total + row.frames.length, 0);
    console.log(
      `${sheet.plan.key.padEnd(28)} ${sheet.plan.frameWidth}x${sheet.plan.frameHeight} ` +
        `tile@(${sheet.plan.tileX},${sheet.plan.tileY}) ` +
        `${sheet.plan.rows.length} state(s), ${frames} frame(s)`,
    );
  }
  console.log(`\nwrote ${baked.length} sheet(s) to ${outDir}`);
  return problems;
}
