/**
 * What a garment worn over his torso is built from: the rig's own torso
 * redrawn in the garment's cloth, on the wearer's own build. A hoodie, a coat
 * or a vest is the same body as the shirt under it, a step out, so it reads
 * the wearer's cut (`frame.look`) for the build and only swaps the cloth and
 * whatever of the cut is the garment's own (its hardware, its folds).
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { deriveRamp, type GlossRamp } from '../../art/biped/palette';
import { paintJacket, traceGarmentTorso, type GarmentCut } from '../../art/biped/torso';
import { mix, type Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import type { HumanLook } from '../../looks/humanLook';
import type { GarmentFrameContext } from '../garmentDef';

type Ctx = CanvasRenderingContext2D;

/** What of the cut a garment decides for itself; the rest is the wearer's build. */
export type CoverCut = Partial<Pick<GarmentCut, 'hasHardware' | 'foldWeight' | 'seamWeight'>>;

/**
 * A matte cloth ramp from one colour: its specular is its light step, so no
 * sheen sits on it that would read as wet or as leather.
 */
export function matteRamp(base: string): GlossRamp {
  const ramp = deriveRamp(base);
  return { ...ramp, specular: ramp.light };
}

/** The near-black a padded leather sleeve's fold bottoms out in: the rig's own jacket's deepest step. */
const SLEEVE_CREVICE = '#1c1016';
/** How far a cloth's deepest step is pushed toward that near-black. */
const SLEEVE_CREVICE_SHARE = 0.6;

/**
 * `cloth` with its two shade steps pushed toward the rig jacket's crevice. A
 * ramp derived from one colour keeps those steps close to its base, so a
 * garment painted in it has a pale shadow side and a far sleeve (which
 * recedes toward `shadow`) nearly as light as the near one; beside either,
 * his shaded far forearm in profile reads flat at the tile.
 */
export function withDeepShade(cloth: GlossRamp): GlossRamp {
  return {
    ...cloth,
    deep: mix(cloth.deep, SLEEVE_CREVICE, SLEEVE_CREVICE_SHARE),
    shadow: mix(cloth.shadow, SLEEVE_CREVICE, SLEEVE_CREVICE_SHARE),
  };
}

/** `look` dressed in `cloth`, its cut recut by `cut`. */
export function coverLook(look: HumanLook, cloth: GlossRamp, cut: CoverCut = {}): HumanLook {
  return {
    ...look,
    garment: cloth,
    garmentCut: { ...look.garmentCut, hasHardware: false, ...cut },
  };
}

/** Paints the garment's body: the wearer's torso, form-shaded in `cloth`. */
export function paintCoverBody(
  ctx: Ctx,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
  cloth: GlossRamp,
  cut: CoverCut = {},
): void {
  paintJacket(ctx, frame.skeleton, context.pose, frame.view, coverLook(frame.look, cloth, cut));
}

/** Runs `paint` clipped to the wearer's torso, so a detail laid across it ends at his sides. */
export function withinTorso(
  ctx: Ctx,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
  paint: () => void,
): void {
  withClip(
    ctx,
    () => traceGarmentTorso(ctx, frame.skeleton, context.pose, frame.view, frame.look),
    paint,
  );
}

/** Traces a closed polygon through `points`. */
export function tracePolygon(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  const [first, ...rest] = points;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

/** Fills a closed polygon through `points`. */
export function fillPolygon(ctx: Ctx, points: readonly Pt[], colour: string): void {
  tracePolygon(ctx, points);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Strokes an open line through `points`. */
export function strokeLine(ctx: Ctx, points: readonly Pt[], colour: string, width: number): void {
  ctx.beginPath();
  const [first, ...rest] = points;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
