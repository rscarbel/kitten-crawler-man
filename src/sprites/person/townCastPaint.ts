/**
 * Turns the person renderer's flat, single-tone fills into the standard the
 * rest of the cast paints to: a soft directional glaze that gives every mass
 * real volume, and a silhouette-only outline, so townsfolk sit beside Carl
 * and the other painted casts without looking like flat cut-outs.
 *
 * The shapes themselves (torso curve, limb capsules, face, hair, hat) stay
 * `drawPerson.ts`'s: they were never the problem, and redrawing anatomy that
 * already reads correctly would only risk it. What changes is what happens
 * after the shapes are down: a figure is painted once to an offscreen surface,
 * a warm outline is dilated from its own silhouette (Carl's own technique,
 * `carl/figure.ts`'s `outlineInto`), and a shadow/light glaze derived from the
 * look's own colours is laid over the top, clipped to the ink already there so
 * it never bleeds past the figure's edge.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { mix, rgba } from '../art/carlArt';
import { fillSoftEllipse } from '../art/softShade';
import { OUTLINE_PX } from '../art/carl/figure';
import { SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA } from '../art/carl/palette';
import type { PersonAppearance } from './PersonAppearance';
import { drawPersonWithPose } from './drawPerson';
import type { Facing, Pose } from './skeleton';

const TWO_PI = Math.PI * 2;
/**
 * Directions the silhouette is dilated in to build the outline ring. Fewer
 * samples leave gaps between the stamped copies that only partly overlap,
 * which reads as a soft, uneven glow rather than a crisp ring; a figure this
 * small needs enough samples that neighbouring stamps overlap at every
 * radius the outline is drawn at.
 */
const OUTLINE_SAMPLES = 24;

/** Where the key light sits, in the same convention Carl's own painter uses. */
const LIGHT_ANGLE_FROM_TOP = -0.9;
const SHADOW_TOWARD = '#241830';
const LIGHT_TOWARD = '#fff3d6';
/** How far the glaze's shadow/light washes reach toward those tones. */
const GLAZE_SHADOW_MIX = 0.34;
const GLAZE_LIGHT_MIX = 0.3;
/**
 * Kept low: a wash strong enough to dominate the read turns into the
 * "concentric ellipses" failure — a form is meant to be shaded by a
 * terminator that tracks its own silhouette, and one flat ellipse over the
 * whole figure only fakes that at a low strength, as an accent on top of the
 * shapes' own per-part tone, not a replacement for it.
 */
const GLAZE_ALPHA = 0.16;
const GLAZE_RADIUS_SHARE = 0.42;
const GLAZE_CORE_FRACTION = 0.08;
const GLAZE_OFFSET_SHARE = 0.32;

/** The bake scale the outline width is defined at, matching Carl's own convention. */
const TILE_SCALE_REFERENCE = 64;

/**
 * The outline's dilation at `cellScale`, in cell pixels — also the margin a
 * cell must reserve beyond the figure's own measured ink, since the outline
 * is painted a ring past the silhouette `personCellGeometry` measured.
 */
export function outlinePx(cellScale: number): number {
  return Math.max(1, Math.round(OUTLINE_PX * (cellScale / TILE_SCALE_REFERENCE)));
}

/**
 * Paints one gesture into a `size`×`size`-scaled figure at `(sx, sy)` on
 * `ctx`, with the standard outline and glaze applied. `cellWidth`/`cellHeight`
 * bound the offscreen surface the figure and its outline are composited on
 * before being drawn onto `ctx`.
 */
export function paintTownCastFrame(
  ctx: CanvasRenderingContext2D,
  cellWidth: number,
  cellHeight: number,
  sx: number,
  sy: number,
  size: number,
  appearance: PersonAppearance,
  pose: Pose,
  facing: Facing,
): void {
  const body = allocCanvas(cellWidth, cellHeight);
  const bodyCtx = surfaceContext(body);
  drawPersonWithPose(bodyCtx, sx, sy, size, appearance, pose, facing);
  paintGlaze(bodyCtx, cellWidth, cellHeight, appearance);

  const outlined = outlineFrom(body, cellWidth, cellHeight, outlinePx(size));
  ctx.drawImage(outlined, 0, 0);
}

/** A soft shadow wash on one side of the figure and a light wash on the other, clipped to its own ink. */
function paintGlaze(
  ctx: CanvasRenderingContext2D,
  cellWidth: number,
  cellHeight: number,
  appearance: PersonAppearance,
): void {
  const cx = cellWidth / 2;
  const cy = cellHeight / 2;
  const radius = Math.max(cellWidth, cellHeight) * GLAZE_RADIUS_SHARE;
  const shadowColor = mix(appearance.face.skin, SHADOW_TOWARD, GLAZE_SHADOW_MIX);
  const lightColor = mix(appearance.face.skin, LIGHT_TOWARD, GLAZE_LIGHT_MIX);
  const offsetX = Math.cos(LIGHT_ANGLE_FROM_TOP) * cellWidth * GLAZE_OFFSET_SHARE;
  const offsetY = Math.sin(LIGHT_ANGLE_FROM_TOP) * cellHeight * GLAZE_OFFSET_SHARE;

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  fillSoftEllipse(
    ctx,
    cx - offsetX,
    cy - offsetY,
    radius,
    radius,
    shadowColor,
    GLAZE_ALPHA,
    0,
    GLAZE_CORE_FRACTION,
  );
  fillSoftEllipse(
    ctx,
    cx + offsetX,
    cy + offsetY,
    radius,
    radius,
    lightColor,
    GLAZE_ALPHA,
    0,
    GLAZE_CORE_FRACTION,
  );
  ctx.restore();
}

/**
 * Dilates `body`'s own silhouette into a warm outline ring, then lays `body`
 * back over it — the same construction `carl/figure.ts`'s `outlineInto` uses,
 * generalised to a source surface rather than Carl's own layer stack.
 */
/** Below this alpha, a pixel counts as outside the silhouette. */
const SILHOUETTE_ALPHA_THRESHOLD = 96;
const OPAQUE_ALPHA = 255;
const ALPHA_CHANNEL_STRIDE = 4;
const ALPHA_CHANNEL_OFFSET = 3;

/**
 * A hard-edged copy of `body`'s silhouette: every pixel either fully opaque
 * or fully transparent, no partial alpha at the antialiased rim. Dilating the
 * soft original stamps each offset copy's own antialiased edge on top of the
 * next, which blends into a feathered halo instead of a ring; a binary mask
 * dilates into a crisp one, and the real, soft-edged `body` is drawn back on
 * top afterwards so the figure's own interior antialiasing is untouched.
 */
function hardSilhouette(body: CanvasSurface, cellWidth: number, cellHeight: number): CanvasSurface {
  const mask = allocCanvas(cellWidth, cellHeight);
  const maskCtx = surfaceContext(mask);
  maskCtx.drawImage(body, 0, 0);
  const image = maskCtx.getImageData(0, 0, cellWidth, cellHeight);
  const { data } = image;
  for (let i = ALPHA_CHANNEL_OFFSET; i < data.length; i += ALPHA_CHANNEL_STRIDE) {
    data[i] = data[i] >= SILHOUETTE_ALPHA_THRESHOLD ? OPAQUE_ALPHA : 0;
  }
  maskCtx.putImageData(image, 0, 0);
  return mask;
}

function outlineFrom(
  body: CanvasSurface,
  cellWidth: number,
  cellHeight: number,
  px: number,
): CanvasSurface {
  const mask = hardSilhouette(body, cellWidth, cellHeight);
  const ring = allocCanvas(cellWidth, cellHeight);
  const ringCtx = surfaceContext(ring);
  for (let i = 0; i < OUTLINE_SAMPLES; i++) {
    const angle = (i / OUTLINE_SAMPLES) * TWO_PI;
    const dx = Math.round(Math.cos(angle) * px);
    const dy = Math.round(Math.sin(angle) * px);
    ringCtx.drawImage(mask, dx, dy);
  }
  ringCtx.save();
  ringCtx.globalCompositeOperation = 'source-in';
  ringCtx.fillStyle = rgba(SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA);
  ringCtx.fillRect(0, 0, cellWidth, cellHeight);
  ringCtx.restore();
  ringCtx.drawImage(body, 0, 0);
  return ring;
}
