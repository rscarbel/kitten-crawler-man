/**
 * A stone sarcophagus two tiles long, its heavy lid shoved askew so a wedge of
 * black shows inside. Not breakable: it is the crypt chapel's centrepiece and
 * stays put. Variants differ in which way the lid was pushed, a crack across
 * it and the carving on the chest's front.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarFixedPainter, PieceOrigin } from './cellarPiece';
import {
  HALF,
  HOLLOW,
  LIMESTONE,
  TWO_PI,
  contactShadow,
  crackLine,
  line,
  polygon,
  wash,
  type Ctx,
} from './cellarPaint';

const SARCOPHAGUS_SEED = 0x5a4c;
const VARIANTS = 4;
const TILES_WIDE = 2;

/** The chest and its lid, in tile fractions across the two-tile footprint. */
const CHEST = {
  leftX: 0.1,
  rightX: 1.9,
  topBackY: 0.04,
  topFrontY: 0.36,
  floorY: 0.9,
  plinth: 0.06,
  panelInset: 0.14,
  lidThickness: 0.08,
  lidShift: 0.22,
  lidOverhang: 0.03,
  /** The rim round the dark well, as a share of a tile; its front and back edges are thinner. */
  rim: 0.06,
  rimEdgeShare: 0.6,
  outlineWidth: 1.5,
} as const;

/** Light down the chest's front face: lit just under the lid, darker to the plinth. */
const FACE_MID_STOP = 0.25;

/** The sunk panel on the front, inset from the lid line and the plinth. */
const PANEL = {
  dropFromLid: 0.1,
  riseFromFloor: 0.14,
  edgeWidth: 2,
  /** The lit lower-right lip of the sunk panel, a pixel off the cut. */
  lipOffset: 1,
  carveWidth: 2.5,
  /** Carving keeps this far, in source pixels, inside the panel's top and bottom. */
  carveInset: 3,
} as const;
/** The cross in a ring, centred a touch above the panel's middle. */
const CROSS = { armReach: 0.12, rise: 0.02, ringRadius: 0.08 } as const;
/** The row of three arches. */
const ARCHES = { offsets: [-0.4, 0, 0.4], halfWidth: 0.1 } as const;

/** The lid: pushed along and skewed, kept inside the footprint's own two tiles. */
const LID = {
  /** Variants below this have the lid pushed to the right. */
  pushedRightBelow: 2,
  tilt: 0.05,
  footprintInset: 0.02,
  rise: 0.02,
  ridgeInset: 0.1,
  ridgeTiltShare: 0.6,
  ridgeWidth: 3,
  shadowDrop: 1.6,
  shadowDepth: 0.8,
  shadowRgb: '10,8,6',
  shadowAlpha: 0.35,
} as const;

const SHADOW = { rx: 0.94, ry: 0.1 } as const;
/** The crack across the lid of the cracked variants. */
const LID_CRACK = { fromX: 0.9, fromY: 0.02, toX: 1.05, toY: 0.38, wobble: 0.04 } as const;

const CARVING_ALPHA = 0.55;

function chest(ctx: Ctx, at: PieceOrigin): void {
  const { ox, oy, ts } = at;
  const left = ox + CHEST.leftX * ts;
  const right = ox + CHEST.rightX * ts;
  const back = oy + CHEST.topBackY * ts;
  const front = oy + CHEST.topFrontY * ts;
  const floor = oy + CHEST.floorY * ts;
  // Top rim of the open chest: the dark well inside it.
  ctx.fillStyle = LIMESTONE.lit;
  ctx.fillRect(left, back, right - left, front - back);
  ctx.fillStyle = HOLLOW;
  const rim = CHEST.rim * ts;
  const rimEdge = rim * CHEST.rimEdgeShare;
  ctx.fillRect(left + rim, back + rimEdge, right - left - rim * 2, front - back - rimEdge * 2);
  const face = ctx.createLinearGradient(0, front, 0, floor);
  face.addColorStop(0, LIMESTONE.lit);
  face.addColorStop(FACE_MID_STOP, LIMESTONE.mid);
  face.addColorStop(1, LIMESTONE.shade);
  ctx.fillStyle = face;
  ctx.fillRect(left, front, right - left, floor - front);
  ctx.fillStyle = LIMESTONE.shade;
  ctx.fillRect(
    left - CHEST.plinth * ts * HALF,
    floor - CHEST.plinth * ts,
    right - left + CHEST.plinth * ts,
    CHEST.plinth * ts,
  );
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = CHEST.outlineWidth;
  ctx.strokeRect(left, back, right - left, floor - back);
}

/** A sunk panel on the chest's front with a carved motif. */
function carving(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const inset = CHEST.panelInset * ts;
  const left = ox + CHEST.leftX * ts + inset;
  const right = ox + CHEST.rightX * ts - inset;
  const top = oy + (CHEST.topFrontY + PANEL.dropFromLid) * ts;
  const bottom = oy + (CHEST.floorY - PANEL.riseFromFloor) * ts;
  const lip = PANEL.lipOffset;
  ctx.save();
  ctx.globalAlpha = CARVING_ALPHA;
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = PANEL.edgeWidth;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = LIMESTONE.rim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + lip, bottom + lip);
  ctx.lineTo(right + lip, bottom + lip);
  ctx.lineTo(right + lip, top + lip);
  ctx.stroke();
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const carve = PANEL.carveWidth;
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = carve;
  if (variant % 2 === 0) {
    // A cross in a ring.
    const armY = cy - CROSS.rise * ts;
    line(ctx, cx, top + PANEL.carveInset, cx, bottom - PANEL.carveInset, LIMESTONE.deep, carve);
    line(
      ctx,
      cx - CROSS.armReach * ts,
      armY,
      cx + CROSS.armReach * ts,
      armY,
      LIMESTONE.deep,
      carve,
    );
    ctx.beginPath();
    ctx.arc(cx, armY, CROSS.ringRadius * ts, 0, TWO_PI);
    ctx.stroke();
  } else {
    // A row of three arches.
    const half = ARCHES.halfWidth * ts;
    const archFoot = bottom - PANEL.carveInset;
    for (const dx of ARCHES.offsets) {
      const ax = cx + dx * ts;
      ctx.beginPath();
      ctx.moveTo(ax - half, archFoot);
      ctx.lineTo(ax - half, cy);
      ctx.arc(ax, cy, half, Math.PI, 0);
      ctx.lineTo(ax + half, archFoot);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function lid(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const shiftRight = variant < LID.pushedRightBelow;
  const shift = (shiftRight ? 1 : -1) * CHEST.lidShift * ts;
  const tilt = (shiftRight ? LID.tilt : -LID.tilt) * ts;
  const over = CHEST.lidOverhang * ts;
  const left = ox + CHEST.leftX * ts - over + shift;
  const right = ox + CHEST.rightX * ts + over + shift;
  // Kept inside the footprint across: the lid is pushed along, then clipped
  // back to the piece's own two tiles so it never overhangs a neighbour.
  const minX = ox + LID.footprintInset * ts;
  const maxX = ox + (TILES_WIDE - LID.footprintInset) * ts;
  const l = Math.max(minX, left);
  const r = Math.min(maxX, right);
  const back = oy + (CHEST.topBackY - LID.rise) * ts;
  const front = oy + (CHEST.topFrontY - LID.rise) * ts;
  const thick = CHEST.lidThickness * ts;
  ctx.fillStyle = LIMESTONE.rim;
  polygon(ctx, [
    [l, back - tilt],
    [r, back + tilt],
    [r, front + tilt],
    [l, front - tilt],
  ]);
  ctx.fill();
  ctx.fillStyle = LIMESTONE.mid;
  polygon(ctx, [
    [l, front - tilt],
    [r, front + tilt],
    [r, front + tilt + thick],
    [l, front - tilt + thick],
  ]);
  ctx.fill();
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = CHEST.outlineWidth;
  polygon(ctx, [
    [l, back - tilt],
    [r, back + tilt],
    [r, front + tilt + thick],
    [l, front - tilt + thick],
  ]);
  ctx.stroke();
  // A raised ridge down the lid's length.
  line(
    ctx,
    l + LID.ridgeInset * ts,
    (back + front) / 2 - tilt * LID.ridgeTiltShare,
    r - LID.ridgeInset * ts,
    (back + front) / 2 + tilt * LID.ridgeTiltShare,
    LIMESTONE.lit,
    LID.ridgeWidth,
  );
  // The lid's own shadow falls on the face below it.
  wash(
    ctx,
    (l + r) / 2,
    front + thick * LID.shadowDrop,
    (r - l) / 2,
    thick * LID.shadowDepth,
    LID.shadowRgb,
    LID.shadowAlpha,
  );
}

function paintSarcophagus(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(SARCOPHAGUS_SEED + variant);
  contactShadow(ctx, ox + ts, oy + CHEST.floorY * ts, SHADOW.rx * ts, SHADOW.ry * ts);
  chest(ctx, at);
  carving(ctx, at, variant);
  lid(ctx, at, variant);
  if (variant % 2 === 1) {
    const c = LID_CRACK;
    crackLine(
      ctx,
      ox + c.fromX * ts,
      oy + c.fromY * ts,
      ox + c.toX * ts,
      oy + c.toY * ts,
      c.wobble * ts,
      rng,
      LIMESTONE.deep,
      CHEST.outlineWidth,
    );
  }
}

export const SARCOPHAGUS_PAINTER: CellarFixedPainter = {
  tilesWide: TILES_WIDE,
  variants: VARIANTS,
  paint: paintSarcophagus,
};
