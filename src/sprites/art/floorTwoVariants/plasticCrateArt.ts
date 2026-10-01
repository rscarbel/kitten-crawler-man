/**
 * The service level's crate: a stacking plastic crate in 3/4 view — a thick
 * lit rim, a handle cut below it, a row of slots, a stencilled stock mark —
 * open at the top so its contents show. Plastic cracks along a line rather
 * than splintering, so a struck crate loses a corner and splits down its face.
 *
 * All measurements are authored on a 64-pixel tile.
 */

import {
  TWO_PI,
  contactShadow,
  cylinderRamp,
  lerp,
  signedUnit,
  verticalRamp,
  type Ctx,
} from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  CAVITY,
  PLASTIC_DARK,
  PLASTIC_EDGE,
  PLASTIC_LIGHT,
  PLASTIC_MID,
  PLASTIC_SPEC,
  STEEL_DARK,
  STEEL_LIGHT,
  STEEL_SPEC,
  STENCIL,
  line,
  variantSeed,
} from './floorTwoPaint';

const PLASTIC_CRATE_SEED = 0x4c2b;

const BOX = {
  leftFraction: 0.12,
  rightFraction: 0.74,
  topFraction: 0.4,
  bottomFraction: 0.88,
  depthXFraction: 0.14,
  depthYFraction: -0.14,
  shadowScale: 1.05,
  shadowDrop: 2,
} as const;

/** The dark inside of the far walls, inset from the rim. */
const INTERIOR_INSET = {
  frontLeft: 3,
  backLeft: 2,
  backDrop: 3,
  backRight: -3,
  frontRight: -2,
} as const;

const RIM_HEIGHT = 4;
const HANDLE = { widthFraction: 0.34, height: 3, drop: 2, radius: 1.5 } as const;
const SLOTS = {
  columns: 5,
  width: 2.4,
  inset: 5,
  dropBelowHandle: 6,
  bottomInset: 4,
  radius: 1,
  /** The side face's slots are narrower: seen edge-on. */
  sideWidthFraction: 0.7,
  sideCount: 2,
  sideTopDrop: 3,
  sideBottomInset: 4,
} as const;

const FRONT_STOPS = [
  [0, PLASTIC_LIGHT],
  [0.25, PLASTIC_MID],
  [1, PLASTIC_DARK],
] as const;
const RIM_SHADOW = 'rgba(0,0,0,0.3)';

/** The stencilled stock mark: a chevron and a bar, at a look's own place on the slots. */
const STENCIL_MARK = {
  yFraction: 0.45,
  xFractionByLook: [0.3, 0.62, 0.3],
  half: 4,
  armRise: 3,
  armDrop: 1,
  innerDrop: 4,
  barGap: 7,
  barRise: 2,
  barLength: 7,
  barHeight: 2.4,
} as const;

/** The look that wears a paper shipping label instead of a stencil. */
const PAPER_LABEL_LOOK = 2;
/** The look scuffed pale where it has been dragged across concrete. */
const SCUFFED_LOOK = 1;
const PAPER_LABEL = {
  xFraction: 0.5,
  yFraction: 0.5,
  halfWidth: 7,
  halfHeight: 5,
  lineInset: 2,
  lineStep: 2.5,
  lineCount: 3,
  colour: '#d7d3c4',
  ink: 'rgba(40,44,48,0.7)',
} as const;
const SCUFF = { count: 7, half: 4, slope: 2, width: 1, colour: 'rgba(170,196,214,0.6)' } as const;

/** A paper shipping label stuck over the slots, with a few lines of print on it. */
function drawPaperLabel(ctx: Ctx, cx: number, cy: number): void {
  const p = PAPER_LABEL;
  ctx.fillStyle = p.colour;
  ctx.fillRect(cx - p.halfWidth, cy - p.halfHeight, p.halfWidth * 2, p.halfHeight * 2);
  ctx.fillStyle = p.ink;
  for (let i = 0; i < p.lineCount; i++) {
    ctx.fillRect(
      cx - p.halfWidth + p.lineInset,
      cy - p.halfHeight + p.lineInset + i * p.lineStep,
      (p.halfWidth - p.lineInset) * 2 - i * p.lineInset,
      1,
    );
  }
}

/** What a crate holds, seen over its open top. */
type CrateContents = 'cans' | 'rags' | 'empty';
const CONTENTS: Readonly<Record<number, CrateContents>> = { 0: 'cans', 1: 'rags', 2: 'empty' };

const CANS = {
  count: 4,
  leftInset: 6,
  rightInset: -8,
  rise: 2,
  stagger: -3,
  halfWidth: 3,
  height: 6,
  topRise: 4,
  topRy: 1.2,
} as const;
const CAN_STOPS = [
  [0, STEEL_DARK],
  [0.35, STEEL_SPEC],
  [1, STEEL_DARK],
] as const;

const RAG_DARK = '#6b6658';
const RAG_LIGHT = '#857f6c';
const RAGS = {
  rise: 2,
  widthFraction: 0.45,
  ry: 4,
  tilt: -0.1,
  foldDx: -4,
  foldRise: 3.5,
  foldWidthFraction: 0.2,
  foldRy: 2,
  foldTilt: 0.2,
} as const;

/** The cracked-off corner and the split running down from it. */
const CRACK = {
  cornerLength: 9,
  innerReach: 4,
  splitWidth: 1.2,
  splitXFraction: 0.3,
  splitBulgeXFraction: 0.36,
  splitBulgeYFraction: 0.5,
  splitFootInset: 3,
} as const;

export function drawPlasticCrate(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
): void {
  const rng = mulberry32(PLASTIC_CRATE_SEED + variantSeed(variant));
  const frontL = ox + ts * BOX.leftFraction;
  const frontR = ox + ts * BOX.rightFraction;
  const frontT = oy + ts * BOX.topFraction;
  const frontB = oy + ts * BOX.bottomFraction;
  const depthX = ts * BOX.depthXFraction;
  const depthY = ts * BOX.depthYFraction;
  const backR = frontR + depthX;
  const backT = frontT + depthY;
  const backL = frontL + depthX;
  const frontW = frontR - frontL;
  const frontH = frontB - frontT;

  contactShadow(ctx, (frontL + backR) / 2, frontB + BOX.shadowDrop, ts, BOX.shadowScale);

  // Open top: the inside of the far walls, then whatever is packed in it.
  ctx.fillStyle = PLASTIC_DARK;
  ctx.beginPath();
  ctx.moveTo(frontL, frontT);
  ctx.lineTo(backL, backT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(frontR, frontT);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.moveTo(frontL + INTERIOR_INSET.frontLeft, frontT);
  ctx.lineTo(backL + INTERIOR_INSET.backLeft, backT + INTERIOR_INSET.backDrop);
  ctx.lineTo(backR + INTERIOR_INSET.backRight, backT + INTERIOR_INSET.backDrop);
  ctx.lineTo(frontR + INTERIOR_INSET.frontRight, frontT);
  ctx.closePath();
  ctx.fill();
  const contents = CONTENTS[variant] ?? 'empty';
  if (contents === 'cans') {
    for (let i = 0; i < CANS.count; i++) {
      const x =
        lerp(frontL + CANS.leftInset, frontR + depthX + CANS.rightInset, i / (CANS.count - 1)) +
        signedUnit(rng);
      const y = frontT - CANS.rise + (i % 2) * CANS.stagger;
      ctx.fillStyle = cylinderRamp(ctx, x - CANS.halfWidth, x + CANS.halfWidth, 0, CAN_STOPS);
      ctx.fillRect(x - CANS.halfWidth, y - CANS.topRise, CANS.halfWidth * 2, CANS.height);
      ctx.fillStyle = STEEL_LIGHT;
      ctx.beginPath();
      ctx.ellipse(x, y - CANS.topRise, CANS.halfWidth, CANS.topRy, 0, 0, TWO_PI);
      ctx.fill();
    }
  } else if (contents === 'rags') {
    const middle = (frontL + backR) / 2;
    ctx.fillStyle = RAG_DARK;
    ctx.beginPath();
    ctx.ellipse(
      middle,
      frontT - RAGS.rise,
      frontW * RAGS.widthFraction,
      RAGS.ry,
      RAGS.tilt,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = RAG_LIGHT;
    ctx.beginPath();
    ctx.ellipse(
      middle + RAGS.foldDx,
      frontT - RAGS.foldRise,
      frontW * RAGS.foldWidthFraction,
      RAGS.foldRy,
      RAGS.foldTilt,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // Right side: shaded plastic with its own slot row.
  ctx.beginPath();
  ctx.moveTo(frontR, frontT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backT + frontH);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  ctx.fillStyle = PLASTIC_DARK;
  ctx.fill();
  for (let i = 0; i < SLOTS.sideCount; i++) {
    const t = (i + 1) / (SLOTS.sideCount + 1);
    const x = lerp(frontR, backR, t);
    const y = lerp(frontT, backT, t);
    line(
      ctx,
      x,
      y + RIM_HEIGHT + SLOTS.sideTopDrop,
      x,
      y + frontH - SLOTS.sideBottomInset,
      CAVITY,
      SLOTS.width * SLOTS.sideWidthFraction,
    );
  }

  // Front: a thick lit rim, a handle cut through below it, and a row of slots.
  ctx.fillStyle = verticalRamp(ctx, frontL, frontT, frontB, FRONT_STOPS);
  ctx.fillRect(frontL, frontT, frontW, frontH);
  ctx.fillStyle = PLASTIC_SPEC;
  ctx.fillRect(frontL, frontT, frontW, 1);
  ctx.fillStyle = RIM_SHADOW;
  ctx.fillRect(frontL, frontT + RIM_HEIGHT, frontW, 1);
  const handleW = frontW * HANDLE.widthFraction;
  const handleX = frontL + (frontW - handleW) / 2;
  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.roundRect(handleX, frontT + RIM_HEIGHT + HANDLE.drop, handleW, HANDLE.height, HANDLE.radius);
  ctx.fill();
  const slotTop = frontT + RIM_HEIGHT + HANDLE.height + SLOTS.dropBelowHandle;
  const slotBottom = frontB - SLOTS.bottomInset;
  for (let i = 0; i < SLOTS.columns; i++) {
    const x = lerp(frontL + SLOTS.inset, frontR - SLOTS.inset, i / (SLOTS.columns - 1));
    ctx.fillStyle = CAVITY;
    ctx.beginPath();
    ctx.roundRect(x - SLOTS.width / 2, slotTop, SLOTS.width, slotBottom - slotTop, SLOTS.radius);
    ctx.fill();
  }

  if (variant === PAPER_LABEL_LOOK) {
    drawPaperLabel(
      ctx,
      frontL + frontW * PAPER_LABEL.xFraction,
      lerp(slotTop, slotBottom, PAPER_LABEL.yFraction),
    );
  } else {
    const mark = STENCIL_MARK;
    ctx.fillStyle = STENCIL;
    const markY = lerp(slotTop, slotBottom, mark.yFraction);
    const markX = frontL + frontW * (mark.xFractionByLook[variant] ?? mark.xFractionByLook[0]);
    ctx.beginPath();
    ctx.moveTo(markX - mark.half, markY - mark.armRise);
    ctx.lineTo(markX, markY + mark.armDrop);
    ctx.lineTo(markX + mark.half, markY - mark.armRise);
    ctx.lineTo(markX + mark.half, markY);
    ctx.lineTo(markX, markY + mark.innerDrop);
    ctx.lineTo(markX - mark.half, markY);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(markX + mark.barGap, markY - mark.barRise, mark.barLength, mark.barHeight);
  }
  if (variant === SCUFFED_LOOK) {
    ctx.strokeStyle = SCUFF.colour;
    ctx.lineWidth = SCUFF.width;
    for (let i = 0; i < SCUFF.count; i++) {
      const x = lerp(frontL, frontR, rng());
      const y = lerp(frontT + RIM_HEIGHT, frontB, rng());
      ctx.beginPath();
      ctx.moveTo(x - SCUFF.half, y);
      ctx.lineTo(x + SCUFF.half, y + signedUnit(rng) * SCUFF.slope);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = PLASTIC_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(frontL, frontB);
  ctx.lineTo(frontL, frontT);
  ctx.lineTo(backL, backT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backT + frontH);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  ctx.moveTo(frontR, frontT);
  ctx.lineTo(frontR, frontB);
  ctx.moveTo(frontL, frontT);
  ctx.lineTo(frontR, frontT);
  ctx.lineTo(backR, backT);
  ctx.stroke();

  if (damaged) {
    ctx.fillStyle = CAVITY;
    ctx.beginPath();
    ctx.moveTo(frontR - CRACK.cornerLength, frontT);
    ctx.lineTo(frontR, frontT);
    ctx.lineTo(frontR, frontT + CRACK.cornerLength);
    ctx.lineTo(frontR - CRACK.innerReach, frontT + CRACK.innerReach);
    ctx.closePath();
    ctx.fill();
    line(
      ctx,
      frontR - CRACK.cornerLength,
      frontT,
      frontR - CRACK.innerReach,
      frontT + CRACK.innerReach,
      PLASTIC_SPEC,
    );
    ctx.strokeStyle = CAVITY;
    ctx.lineWidth = CRACK.splitWidth;
    ctx.beginPath();
    ctx.moveTo(frontL + frontW * CRACK.splitXFraction, frontT + RIM_HEIGHT);
    ctx.lineTo(
      frontL + frontW * CRACK.splitBulgeXFraction,
      frontT + frontH * CRACK.splitBulgeYFraction,
    );
    ctx.lineTo(frontL + frontW * CRACK.splitXFraction, frontB - CRACK.splitFootInset);
    ctx.stroke();
  }
}
