/**
 * The service level's bookshelf: a bay of slotted-angle steel shelving loaded
 * with cardboard supply boxes and paint tins. The uprights sit on the tile's
 * edges, so two bays side by side read as one long run.
 *
 * All measurements are authored on a 64-pixel tile.
 */

import {
  contactShadow,
  cylinderRamp,
  pick,
  verticalRamp,
  withRotation,
  type Ctx,
} from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  CARD_DARK,
  CARD_MID,
  CARD_SHADES,
  CARD_TAPE,
  STEEL_DARK,
  STEEL_EDGE,
  STEEL_LIGHT,
  STEEL_MID,
  STEEL_SPEC,
  dent,
  variantSeed,
} from './floorTwoPaint';

const SHELVING_SEED = 0x5e17;

const BAY = {
  leftFraction: 0.06,
  rightFraction: 0.94,
  /** Above its own tile: a bay stands taller than the crawler beside it. */
  topFraction: -0.78,
  baseFraction: 0.94,
  uprightWidth: 3.5,
  levels: 4,
  shelfThickness: 2.5,
  /** The shelf seen slightly from above: how deep its lit top surface reads. */
  shelfTopDepth: 3,
  /** A shelf overhangs the uprights' inner faces by this much each side. */
  shelfOverhang: 1,
  /** Headroom left between the tallest box on a shelf and the shelf above. */
  levelHeadroom: 5,
  holeStep: 4,
  holeTopInset: 3,
  holeBottomInset: 2,
  holeHalfWidth: 0.6,
  holeHeight: 1.6,
  edgeWidth: 0.8,
  droppedLevel: 1,
  dropTilt: 0.22,
  shadowScale: 1.1,
  shadowDrop: 1,
} as const;
const WALL_SHADOW = 'rgba(8,12,16,0.55)';
const SHELF_EDGE_STOPS = [
  [0, STEEL_SPEC],
  [1, STEEL_DARK],
] as const;
const UPRIGHT_STOPS = [
  [0, STEEL_LIGHT],
  [0.4, STEEL_SPEC],
  [1, STEEL_MID],
] as const;

const BOXES = {
  widthMin: 8,
  widthSpread: 8,
  heightMinFraction: 0.5,
  heightSpreadFraction: 0.42,
  gapChance: 0.18,
  gapMin: 2,
  gapSpread: 4,
  startInset: 1,
  endClearance: 1,
  spacing: 0.5,
} as const;

const TINS = {
  chance: 0.2,
  maxDiameter: 8,
  labelTopFraction: 1.4,
  labelHeightFraction: 0.8,
  spacing: 1,
  labels: ['#7a3a2c', '#3d5a3a', '#6e6a5c'],
} as const;
const TIN_STOPS = [
  [0, STEEL_DARK],
  [0.35, STEEL_SPEC],
  [1, STEEL_DARK],
] as const;

const BOX_PAINT = {
  flapLight: 'rgba(255,240,215,0.22)',
  flapHeight: 1.5,
  sideShade: 'rgba(0,0,0,0.28)',
  sideWidth: 1.5,
  tapeHalfWidth: 1,
  tapeLength: 4,
  edgeWidth: 0.6,
} as const;

/** The box knocked off the dropped shelf, at rest against the foot of the bay. */
const FALLEN_BOX = { inset: 16, width: 12, height: 8 } as const;
const UPRIGHT_DENT = { levelFraction: 1.5, rx: 3, ry: 2 } as const;

/** One cardboard supply box, standing on `baseY`: lit top flap, taped seam, shaded side. */
export function supplyBox(
  ctx: Ctx,
  x: number,
  baseY: number,
  w: number,
  h: number,
  shade: string,
): void {
  const top = baseY - h;
  ctx.fillStyle = shade;
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = BOX_PAINT.flapLight;
  ctx.fillRect(x, top, w, BOX_PAINT.flapHeight);
  ctx.fillStyle = BOX_PAINT.sideShade;
  ctx.fillRect(x + w - BOX_PAINT.sideWidth, top, BOX_PAINT.sideWidth, h);
  ctx.fillStyle = CARD_TAPE;
  ctx.fillRect(
    x + w / 2 - BOX_PAINT.tapeHalfWidth,
    top,
    BOX_PAINT.tapeHalfWidth * 2,
    Math.min(h, BOX_PAINT.tapeLength),
  );
  ctx.strokeStyle = CARD_DARK;
  ctx.lineWidth = BOX_PAINT.edgeWidth;
  ctx.strokeRect(x, top, w, h);
}

function drawShelfContents(
  ctx: Ctx,
  x0: number,
  x1: number,
  baseY: number,
  levelHeight: number,
  rng: () => number,
): void {
  let x = x0 + BOXES.startInset;
  while (x < x1 - BOXES.widthMin) {
    if (rng() < BOXES.gapChance) {
      x += BOXES.gapMin + rng() * BOXES.gapSpread;
      continue;
    }
    const w = Math.min(x1 - x - BOXES.endClearance, BOXES.widthMin + rng() * BOXES.widthSpread);
    const h = levelHeight * (BOXES.heightMinFraction + rng() * BOXES.heightSpreadFraction);
    if (rng() < TINS.chance) {
      const r = Math.min(w, TINS.maxDiameter) / 2;
      ctx.fillStyle = cylinderRamp(ctx, x, x + r * 2, 0, TIN_STOPS);
      ctx.fillRect(x, baseY - r * 2, r * 2, r * 2);
      ctx.fillStyle = pick(rng, [...TINS.labels]);
      ctx.fillRect(x, baseY - r * TINS.labelTopFraction, r * 2, r * TINS.labelHeightFraction);
      x += r * 2 + TINS.spacing;
      continue;
    }
    supplyBox(ctx, x, baseY, w, h, pick(rng, [...CARD_SHADES]));
    x += w + BOXES.spacing;
  }
}

export function drawSteelShelving(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
): void {
  const rng = mulberry32(SHELVING_SEED + variantSeed(variant));
  const left = ox + ts * BAY.leftFraction;
  const right = ox + ts * BAY.rightFraction;
  const top = oy + ts * BAY.topFraction;
  const base = oy + ts * BAY.baseFraction;
  const innerL = left + BAY.uprightWidth;
  const innerR = right - BAY.uprightWidth;

  contactShadow(ctx, (left + right) / 2, base + BAY.shadowDrop, ts, BAY.shadowScale);
  // The wall behind, in shadow, so the load reads against something dark.
  ctx.fillStyle = WALL_SHADOW;
  ctx.fillRect(innerL, top, innerR - innerL, base - top);

  const levelHeight = (base - top) / BAY.levels;
  const shelfLeft = innerL - BAY.shelfOverhang;
  const shelfWidth = innerR - innerL + BAY.shelfOverhang * 2;
  for (let i = 0; i < BAY.levels; i++) {
    const shelfY = top + levelHeight * (i + 1) - BAY.shelfThickness;
    const dropped = damaged && i === BAY.droppedLevel;
    const paintLevel = () => {
      drawShelfContents(
        ctx,
        innerL,
        innerR,
        shelfY - BAY.shelfTopDepth,
        levelHeight - BAY.levelHeadroom,
        rng,
      );
      ctx.fillStyle = STEEL_LIGHT;
      ctx.fillRect(shelfLeft, shelfY - BAY.shelfTopDepth, shelfWidth, BAY.shelfTopDepth);
      ctx.fillStyle = verticalRamp(
        ctx,
        innerL,
        shelfY,
        shelfY + BAY.shelfThickness,
        SHELF_EDGE_STOPS,
      );
      ctx.fillRect(shelfLeft, shelfY, shelfWidth, BAY.shelfThickness);
    };
    if (dropped) withRotation(ctx, innerL, shelfY, BAY.dropTilt, paintLevel);
    else paintLevel();
  }

  // Slotted-angle uprights, lit on their front flange, punched with bolt holes.
  for (const x of [left, innerR]) {
    ctx.fillStyle = cylinderRamp(ctx, x, x + BAY.uprightWidth, 0, UPRIGHT_STOPS);
    ctx.fillRect(x, top, BAY.uprightWidth, base - top);
    ctx.fillStyle = STEEL_DARK;
    for (let y = top + BAY.holeTopInset; y < base - BAY.holeBottomInset; y += BAY.holeStep) {
      ctx.fillRect(
        x + BAY.uprightWidth / 2 - BAY.holeHalfWidth,
        y,
        BAY.holeHalfWidth * 2,
        BAY.holeHeight,
      );
    }
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = BAY.edgeWidth;
    ctx.strokeRect(x, top, BAY.uprightWidth, base - top);
  }

  if (damaged) {
    supplyBox(ctx, innerR - FALLEN_BOX.inset, base, FALLEN_BOX.width, FALLEN_BOX.height, CARD_MID);
    dent(
      ctx,
      left + BAY.uprightWidth / 2,
      top + levelHeight * UPRIGHT_DENT.levelFraction,
      UPRIGHT_DENT.rx,
      UPRIGHT_DENT.ry,
      STEEL_SPEC,
    );
  }
}
