/**
 * The service level's brazier: a cut-down oil drum with holes punched round
 * its wall, burning rubbish. The fire and the holes it shows through are its
 * emitter; the light it throws is the lighting pass's.
 *
 * All measurements are authored on a 64-pixel tile.
 */

import { BRAZIER_FLAME_FRAMES, drawFlame } from '../destructiblePropArt';
import {
  TWO_PI,
  contactShadow,
  cylinderRamp,
  lerp,
  signedUnit,
  withRotation,
  type Ctx,
} from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  FIRE_HOT,
  FIRE_OUTER,
  OIL_DARK,
  OIL_SPEC,
  RUST,
  SOOT,
  STEEL_EDGE,
  dent,
  wash,
} from './floorTwoPaint';

const DRUM_BRAZIER_SEED = 0x29f3;

const BARREL = {
  rx: 17,
  rimRy: 5.5,
  topFraction: 0.44,
  bottomFraction: 0.9,
  shadowScale: 0.95,
  shadowDrop: 3,
  damagedTilt: 0.1,
  flameScale: 1.5,
  /** The flame rises from just under the rim's lip. */
  flameDrop: 1,
} as const;
const BODY_STOPS = [
  [0, OIL_DARK],
  [0.3, '#5a4436'],
  [0.6, '#3a2c24'],
  [1, OIL_DARK],
] as const;

/** Heat scale under the rim, and rust washing down from it. */
const HEAT_SCALE = {
  drop: 3,
  widthFraction: 1.2,
  ry: 6,
  colour: 'rgba(20,14,10,0.7)',
  rustCount: 3,
  rustSpreadFraction: 0.7,
  rustDrop: 12,
  rustRx: 3,
  rustRy: 9,
} as const;

/** Punched holes, staggered row to row, each breathing with the flame. */
const HOLES = {
  rows: 2,
  columns: 5,
  radius: 1.5,
  sideInset: 3,
  topDrop: 10,
  bottomRise: 6,
  rowStagger: 0.5,
  columnPhase: 0.3,
  rowPhase: 0.5,
} as const;

/** The burning load seen over the rim. */
const LOAD = {
  count: 7,
  hotPeriod: 3,
  spreadFraction: 0.7,
  jitterY: 2,
  radius: 1.8,
  rimTrim: 0.1,
} as const;

const STRUCK_DENT = { dx: -6, dy: 3, rx: 6, ry: 3 } as const;

export function drawDrumBrazier(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  frame: number,
): void {
  const rng = mulberry32(DRUM_BRAZIER_SEED);
  const cx = ox + ts / 2;
  const topY = oy + ts * BARREL.topFraction;
  const bottomY = oy + ts * BARREL.bottomFraction;
  const phase = frame / BRAZIER_FLAME_FRAMES;
  contactShadow(ctx, cx, bottomY + BARREL.shadowDrop, ts, BARREL.shadowScale);

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(cx - BARREL.rx, topY);
    ctx.lineTo(cx - BARREL.rx, bottomY);
    ctx.ellipse(cx, bottomY, BARREL.rx, BARREL.rimRy, 0, Math.PI, 0, true);
    ctx.lineTo(cx + BARREL.rx, topY);
  };

  const paintBody = () => {
    bodyPath();
    ctx.closePath();
    ctx.fillStyle = cylinderRamp(ctx, cx - BARREL.rx, cx + BARREL.rx, 0, BODY_STOPS);
    ctx.fill();
    ctx.save();
    ctx.clip();
    wash(
      ctx,
      cx,
      topY + HEAT_SCALE.drop,
      BARREL.rx * HEAT_SCALE.widthFraction,
      HEAT_SCALE.ry,
      HEAT_SCALE.colour,
    );
    for (let i = 0; i < HEAT_SCALE.rustCount; i++) {
      wash(
        ctx,
        cx + signedUnit(rng) * BARREL.rx * HEAT_SCALE.rustSpreadFraction,
        topY + HEAT_SCALE.rustDrop,
        HEAT_SCALE.rustRx,
        HEAT_SCALE.rustRy,
        RUST,
      );
    }
    ctx.restore();
    for (let row = 0; row < HOLES.rows; row++) {
      for (let col = 0; col < HOLES.columns; col++) {
        const t = (col + 0.5 + (row % 2) * HOLES.rowStagger) / (HOLES.columns + 0.5);
        const x = lerp(cx - BARREL.rx + HOLES.sideInset, cx + BARREL.rx - HOLES.sideInset, t);
        const y = lerp(
          topY + HOLES.topDrop,
          bottomY - HOLES.bottomRise,
          row / Math.max(1, HOLES.rows - 1),
        );
        const flicker =
          0.5 + 0.5 * Math.sin((phase + col * HOLES.columnPhase + row * HOLES.rowPhase) * TWO_PI);
        ctx.fillStyle = flicker > 0.5 ? FIRE_HOT : FIRE_OUTER;
        ctx.beginPath();
        ctx.arc(x, y, HOLES.radius, 0, TWO_PI);
        ctx.fill();
      }
    }
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 1;
    bodyPath();
    ctx.stroke();
    // The ragged cut rim, and the burning load seen over it.
    ctx.fillStyle = SOOT;
    ctx.beginPath();
    ctx.ellipse(cx, topY, BARREL.rx, BARREL.rimRy, 0, 0, TWO_PI);
    ctx.fill();
    for (let i = 0; i < LOAD.count; i++) {
      ctx.fillStyle = i % LOAD.hotPeriod === 0 ? FIRE_HOT : FIRE_OUTER;
      ctx.beginPath();
      ctx.arc(
        cx + signedUnit(rng) * BARREL.rx * LOAD.spreadFraction,
        topY + signedUnit(rng) * LOAD.jitterY,
        LOAD.radius,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    ctx.strokeStyle = OIL_SPEC;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, topY, BARREL.rx, BARREL.rimRy, 0, LOAD.rimTrim, Math.PI - LOAD.rimTrim);
    ctx.stroke();
  };
  if (damaged) {
    withRotation(ctx, cx, bottomY, BARREL.damagedTilt, () => {
      paintBody();
      dent(
        ctx,
        cx + STRUCK_DENT.dx,
        (topY + bottomY) / 2 + STRUCK_DENT.dy,
        STRUCK_DENT.rx,
        STRUCK_DENT.ry,
        OIL_SPEC,
      );
      drawFlame(ctx, cx, topY - BARREL.flameDrop, phase, true, BARREL.flameScale);
    });
  } else {
    paintBody();
    drawFlame(ctx, cx, topY - BARREL.flameDrop, phase, false, BARREL.flameScale);
  }
}
