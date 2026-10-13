/**
 * The Riveted Bracers on Carl: a plate of boiled leather round each forearm
 * from below the jacket's shoved-up cuff to just short of the wrist, with a
 * steel rivet at each corner of the plate.
 */

import { angleBetween, pt, TWO_PI } from '../../art/carl/geometry';
import { bareSegmentEdges } from '../../art/carl/limbs';
import { shadeForm } from '../../art/carl/paint';
import { FAR_LIMB_SHADE, receded, type Ramp } from '../../art/carl/palette';
import type { CarlForearmFrame } from '../../art/carl/carlParts';
import { mix } from '../../art/carlArt';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Boiled leather goes hard and tan: a warm brown well under his skin's
 * value and well over his jacket's, so a bracer reads as neither bare arm nor
 * sleeve.
 */
const BOILED_LEATHER: Ramp = {
  deep: '#3c2414',
  shadow: '#56361f',
  dark: '#6f4729',
  mid: '#875a34',
  base: '#a87547',
  light: '#c9976a',
  rim: '#e6bf8e',
};
/** Bright steel heads, cold against the warm leather so they never read as more of it. */
const RIVET_LIT = '#f4f1ea';
/** A quadratic only reaches halfway to its control point. */
const QUAD_CONTROL_REACH = 2;

/** Where the plate runs along the forearm, 0 at the elbow and 1 at the wrist: clear of the cuff and the hand. */
const BRACER_FROM = 0.34;
const BRACER_TO = 0.94;
/** Boiled leather stands this far proud of the skin either side. */
const BRACER_PROUD = 0.012;
/**
 * Each end of the plate is the rim of a tube seen a little from above, so it
 * bows toward the wrist; straight cut ends read as a box stuck on the arm.
 */
const END_BOW = 0.4;
/** Each end is a stiff rolled edge, a band a step darker than the plate. */
const EDGE_BAND_WIDTH = 0.03;
const EDGE_BAND_INSET = EDGE_BAND_WIDTH / 2;
/** A rivet sits just in from each corner of the plate. */
const RIVET_IN_FROM_END = 0.07;
const RIVET_ACROSS = 0.55;
const RIVET_RADIUS = 0.02;
/** The dimple a rivet is set in shows down and away from the key, in the leather's own shadow. */
const RIVET_SHADE_OFFSET = 0.012;
const RIVET_SHADE_RADIUS = 0.024;

interface PlateEdges {
  readonly plus: number;
  readonly minus: number;
}

function plateEdges(along: number, profile: boolean): PlateEdges {
  const bare = bareSegmentEdges('forearm', along, profile);
  return { plus: bare.plus + BRACER_PROUD, minus: bare.minus + BRACER_PROUD };
}

function endBow(edges: PlateEdges): number {
  const halfWidth = (edges.plus + edges.minus) / 2;
  return halfWidth * END_BOW * QUAD_CONTROL_REACH;
}

function traceEnd(ctx: Ctx, along: number, edges: PlateEdges): void {
  ctx.moveTo(along, -edges.minus);
  ctx.quadraticCurveTo(along + endBow(edges), 0, along, edges.plus);
}

function tracePlate(ctx: Ctx, from: number, to: number, near: PlateEdges, far: PlateEdges): void {
  ctx.beginPath();
  ctx.moveTo(from, -near.minus);
  ctx.lineTo(to, -far.minus);
  ctx.quadraticCurveTo(to + endBow(far), 0, to, far.plus);
  ctx.lineTo(from, near.plus);
  ctx.quadraticCurveTo(from + endBow(near), 0, from, -near.minus);
  ctx.closePath();
}

function paintRivet(
  ctx: Ctx,
  x: number,
  y: number,
  lit: string,
  shade: string,
  angle: number,
): void {
  const fallX = Math.cos(-angle) * RIVET_SHADE_OFFSET - Math.sin(-angle) * RIVET_SHADE_OFFSET;
  const fallY = Math.sin(-angle) * RIVET_SHADE_OFFSET + Math.cos(-angle) * RIVET_SHADE_OFFSET;
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x + fallX, y + fallY, RIVET_SHADE_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(x, y, RIVET_RADIUS, 0, TWO_PI);
  ctx.fill();
}

function paintForearm(ctx: Ctx, frame: CarlForearmFrame): void {
  if (frame.piece !== 'arm') return;
  const { chain, view } = frame;
  const isFarArm = view.profile && frame.drawn === 'left';
  const depthShade = isFarArm ? FAR_LIMB_SHADE : 0;
  const ramp = receded(BOILED_LEATHER, depthShade);
  const rivetLit = mix(RIVET_LIT, ramp.shadow, depthShade);
  const angle = angleBetween(chain.joint, chain.end);
  const forearmLength = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const from = forearmLength * BRACER_FROM;
  const to = forearmLength * BRACER_TO;
  const near = plateEdges(BRACER_FROM, view.profile);
  const far = plateEdges(BRACER_TO, view.profile);
  const widest = Math.max(near.plus, near.minus, far.plus, far.minus);

  ctx.save();
  ctx.translate(chain.joint.x, chain.joint.y);
  ctx.rotate(angle);
  shadeForm(
    ctx,
    () => tracePlate(ctx, from, to, near, far),
    { from: pt(from, 0), to: pt(to, 0) },
    ramp,
    { halfWidth: widest, frameRotation: angle },
    () => {
      ctx.strokeStyle = ramp.dark;
      ctx.lineWidth = EDGE_BAND_WIDTH;
      ctx.beginPath();
      traceEnd(ctx, from + EDGE_BAND_INSET, near);
      traceEnd(ctx, to - EDGE_BAND_INSET, far);
      ctx.stroke();
    },
  );
  const rivetRows = [
    { x: from + RIVET_IN_FROM_END, edges: near },
    { x: to - RIVET_IN_FROM_END, edges: far },
  ];
  for (const { x, edges } of rivetRows) {
    paintRivet(ctx, x, -edges.minus * RIVET_ACROSS, rivetLit, ramp.shadow, angle);
    paintRivet(ctx, x, edges.plus * RIVET_ACROSS, rivetLit, ramp.shadow, angle);
  }
  ctx.restore();
}

export const CARL_BRACERS = defineGarment({
  id: 'carl_bracers',
  name: 'Riveted Bracers',
  wearer: 'human',
  material: 'leather',
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: carlEveryView(paintForearm) },
});
