/**
 * The service level's barrel: a painted 200-litre steel drum standing, the
 * same drum on its side, and the oil drum some of them are instead — black,
 * with a yellow band and a run of oil from the bung.
 *
 * Metal dents before it gives, so a struck drum's damaged stage is dented and
 * knocked askew rather than cracked. The geometry is fixed across looks; a
 * look only changes the markings and wear painted onto it.
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
  withRotation,
  type Ctx,
} from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  BLACK_DRUM,
  BLUE_DRUM,
  LABEL_RED,
  LABEL_WHITE,
  OIL_BAND,
  OIL_BAND_LIGHT,
  OIL_GLOSS,
  OIL_SHEEN,
  RUST,
  RUST_DARK,
  STEEL_EDGE,
  STENCIL,
  TRANSPARENT,
  dent,
  line,
  variantSeed,
  wash,
  type DentMark,
  type DrumPaint,
} from './floorTwoPaint';

const DRUM_SEED = 0x7d31;
/** The side drum's looks draw from their own stream, one past the standing drum's. */
const SIDE_DRUM_SEED_OFFSET = 1;

const DRUM = {
  rx: 19,
  lidRy: 6.5,
  topFraction: 0.2,
  bottomFraction: 0.88,
  ribFractions: [0.33, 0.66],
  ribThickness: 2.4,
  chimeThickness: 2,
  bungLargeR: 2.6,
  bungSmallR: 1.6,
  bungOffsetFraction: 0.5,
  /** The small bung sits a pixel back on the lid, behind the large one. */
  bungSmallLift: 1,
  shadowDrop: 3,
  damagedTilt: 0.08,
} as const;

/** The rolled rib's shadow line and its lit upper edge. */
const RIB = {
  shadowDrop: 1,
  arcTrim: 0.05,
  litLift: 0.5,
  litInset: 0.5,
  litStart: Math.PI * 0.18,
  litEnd: Math.PI * 0.72,
} as const;

/** The base is rolled into the wall a pixel above the drum's foot. */
const BOTTOM_CHIME_LIFT = 1;

const LID = {
  innerInset: 1.5,
  innerDrop: 0.8,
  innerLineWidth: 0.8,
  innerTrim: 0.1,
} as const;

const DRUM_BODY_STOPS = (paint: DrumPaint) =>
  [
    [0, paint.dark],
    [0.22, paint.light],
    [0.36, paint.spec],
    [0.5, paint.light],
    [0.8, paint.mid],
    [1, paint.dark],
  ] as const;

/** The key light falls off down the drum toward the floor. */
const DRUM_FOOT_SHADE = [
  [0, TRANSPARENT],
  [1, 'rgba(0,0,0,0.3)'],
] as const;

/** The oil drum's yellow hazard band: where it sits, how tall, and how it follows the drum's shading. */
const OIL_BAND_SHAPE = {
  yFraction: 0.48,
  height: 7,
  /** The band's shading is a darkening wash this many band-heights tall, starting a lid's depth above. */
  shadeHeights: 3,
} as const;
const OIL_BAND_STOPS = [
  [0, OIL_BAND_LIGHT],
  [0.4, OIL_BAND],
  [1, OIL_BAND],
] as const;
const OIL_BAND_SHADE_STOPS = [
  [0, 'rgba(0,0,0,0.55)'],
  [0.3, TRANSPARENT],
  [0.75, 'rgba(0,0,0,0.2)'],
  [1, 'rgba(0,0,0,0.6)'],
] as const;

/** The run of oil down from the bung, in pixels across and fractions of the drum's height down. */
const OIL_RUN = {
  jitter: 2,
  topDrop: 2,
  leftEdge: -2,
  leftBulge: -3,
  leftBulgeFraction: 0.5,
  footFraction: 0.7,
  footLeft: -1,
  footRight: 1.5,
  rightBulge: 1,
  rightBulgeFraction: 0.4,
  rightEdge: 2,
  sheenX: -1.4,
  sheenFootX: -1.6,
  sheenTop: 6,
  sheenFootFraction: 0.45,
} as const;

/** A faded diamond hazard label on the lit side of the drum. */
const HAZARD_LABEL = {
  xFraction: -0.25,
  yFraction: 0.5,
  half: 5,
  barThirds: 3,
} as const;

const RUST_STREAKS = {
  count: 3,
  spreadFraction: 0.8,
  yFraction: 0.3,
  rx: 3,
  heightFraction: 0.32,
  lidRy: 4,
} as const;

const SCUFF = {
  widthFraction: 1.1,
  ry: 6,
  digitCount: 3,
  digitLeft: -7,
  digitYFraction: 0.42,
  digitStep: 5,
  digitWidth: 3,
  digitHeight: 6,
  wornChance: 0.2,
} as const;

/** A contents band painted round the shoulder of a labelled drum. */
const PAINT_BAND = { yFraction: 0.12, height: 4, colour: 'rgba(196,198,186,0.55)' } as const;
/** Rust on a neglected drum: heavy patches where the paint has gone, not faint streaks. */
const RUST_HEAVY = 'rgba(122,62,26,0.82)';
const RUST_PATCHES: ReadonlyArray<{
  readonly dx: number;
  readonly yFraction: number;
  readonly rx: number;
  readonly ry: number;
}> = [
  { dx: -10, yFraction: 0.35, rx: 6, ry: 9 },
  { dx: 7, yFraction: 0.6, rx: 7, ry: 6 },
  { dx: -2, yFraction: 0.92, rx: 12, ry: 5 },
];
const SCRAPES = {
  count: 5,
  yFraction: 0.7,
  spreadX: 12,
  spreadY: 5,
  half: 4,
  slope: 1.5,
  width: 1,
  colour: 'rgba(196,206,212,0.75)',
} as const;
const OIL_PLACARD_HALF = 5;
const OIL_PLACARD_INNER = 0.6;
const LID_SLICK = { dx: -4, dy: 1, rx: 9, ry: 3, tilt: 0.1, sheenHalf: 4 } as const;

/** The dents a struck standing drum carries: two in the wall, one in the chime. */
const STANDING_DENTS: ReadonlyArray<DentMark & { readonly yFraction: number }> = [
  { dx: -5, dy: 0, yFraction: 0.5, rx: 7, ry: 4 },
  { dx: 9, dy: 0, yFraction: 0.8, rx: 5, ry: 3 },
  { dx: DRUM.rx - 5, dy: 2, yFraction: 0, rx: 5, ry: 2.5 },
];

/** What a drum's look adds: a hazard label, rust run down from the lid, or scuffed paint at the foot. */
type DrumLook = 'label' | 'rust' | 'scuffed';
const DRUM_LOOKS: Readonly<Record<number, DrumLook>> = { 0: 'label', 1: 'rust', 2: 'scuffed' };

interface DrumGeometry {
  readonly cx: number;
  readonly topY: number;
  readonly bottomY: number;
}

function drumGeometry(ox: number, oy: number, ts: number): DrumGeometry {
  return {
    cx: ox + ts / 2,
    topY: oy + ts * DRUM.topFraction,
    bottomY: oy + ts * DRUM.bottomFraction,
  };
}

function drumBodyPath(ctx: Ctx, g: DrumGeometry): void {
  ctx.beginPath();
  ctx.moveTo(g.cx - DRUM.rx, g.topY);
  ctx.lineTo(g.cx - DRUM.rx, g.bottomY);
  ctx.ellipse(g.cx, g.bottomY, DRUM.rx, DRUM.lidRy, 0, Math.PI, 0, true);
  ctx.lineTo(g.cx + DRUM.rx, g.topY);
  ctx.closePath();
}

/** A rolling rib pressed round the drum: lit along its top, shadowed below. */
function drumRib(ctx: Ctx, g: DrumGeometry, y: number, paint: DrumPaint): void {
  ctx.save();
  ctx.lineWidth = DRUM.ribThickness;
  ctx.strokeStyle = paint.dark;
  ctx.beginPath();
  ctx.ellipse(g.cx, y + RIB.shadowDrop, DRUM.rx, DRUM.lidRy, 0, RIB.arcTrim, Math.PI - RIB.arcTrim);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = paint.spec;
  ctx.beginPath();
  ctx.ellipse(
    g.cx,
    y - RIB.litLift,
    DRUM.rx - RIB.litInset,
    DRUM.lidRy,
    0,
    RIB.litStart,
    RIB.litEnd,
  );
  ctx.stroke();
  ctx.restore();
}

function drawOilBand(
  ctx: Ctx,
  g: DrumGeometry,
  height: number,
  rng: () => number,
  withRun: boolean,
): void {
  const bandY = g.topY + height * OIL_BAND_SHAPE.yFraction;
  ctx.fillStyle = verticalRamp(ctx, g.cx, bandY, bandY + OIL_BAND_SHAPE.height, OIL_BAND_STOPS);
  ctx.beginPath();
  ctx.ellipse(g.cx, bandY + OIL_BAND_SHAPE.height, DRUM.rx, DRUM.lidRy, 0, 0, Math.PI);
  ctx.ellipse(g.cx, bandY, DRUM.rx, DRUM.lidRy, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  // The band's shading follows the drum's, dark at both sides.
  ctx.fillStyle = cylinderRamp(ctx, g.cx - DRUM.rx, g.cx + DRUM.rx, 0, OIL_BAND_SHADE_STOPS);
  ctx.fillRect(
    g.cx - DRUM.rx,
    bandY - DRUM.lidRy,
    DRUM.rx * 2,
    OIL_BAND_SHAPE.height * OIL_BAND_SHAPE.shadeHeights,
  );
  if (!withRun) return;
  // Oil run down from the bung, glossy where it is still wet.
  const run = OIL_RUN;
  const runX = g.cx + DRUM.rx * DRUM.bungOffsetFraction + signedUnit(rng) * run.jitter;
  ctx.fillStyle = OIL_GLOSS;
  ctx.beginPath();
  ctx.moveTo(runX + run.leftEdge, g.topY + run.topDrop);
  ctx.quadraticCurveTo(
    runX + run.leftBulge,
    g.topY + height * run.leftBulgeFraction,
    runX + run.footLeft,
    g.topY + height * run.footFraction,
  );
  ctx.lineTo(runX + run.footRight, g.topY + height * run.footFraction);
  ctx.quadraticCurveTo(
    runX + run.rightBulge,
    g.topY + height * run.rightBulgeFraction,
    runX + run.rightEdge,
    g.topY + run.topDrop,
  );
  ctx.closePath();
  ctx.fill();
  line(
    ctx,
    runX + run.sheenX,
    g.topY + run.sheenTop,
    runX + run.sheenFootX,
    g.topY + height * run.sheenFootFraction,
    OIL_SHEEN,
  );
}

function drawHazardLabel(ctx: Ctx, g: DrumGeometry, height: number): void {
  const lx = g.cx + DRUM.rx * HAZARD_LABEL.xFraction;
  const ly = g.topY + height * HAZARD_LABEL.yFraction;
  const half = HAZARD_LABEL.half;
  ctx.fillStyle = LABEL_WHITE;
  ctx.beginPath();
  ctx.moveTo(lx, ly - half);
  ctx.lineTo(lx + half, ly);
  ctx.lineTo(lx, ly + half);
  ctx.lineTo(lx - half, ly);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = LABEL_RED;
  ctx.fillRect(lx - half / 2, ly, half, half / HAZARD_LABEL.barThirds);
}

function drawDrumLook(
  ctx: Ctx,
  g: DrumGeometry,
  look: DrumLook,
  oil: boolean,
  rng: () => number,
): void {
  ctx.save();
  drumBodyPath(ctx, g);
  ctx.clip();
  const height = g.bottomY - g.topY;
  if (oil) {
    drawOilLook(ctx, g, height, look, rng);
    ctx.restore();
    return;
  }
  if (look === 'label') {
    drawHazardLabel(ctx, g, height);
    // A painted contents band round the shoulder, chipped where it has been knocked.
    const bandY = g.topY + height * PAINT_BAND.yFraction;
    ctx.fillStyle = PAINT_BAND.colour;
    ctx.fillRect(g.cx - DRUM.rx, bandY, DRUM.rx * 2, PAINT_BAND.height);
  } else if (look === 'rust') {
    for (const patch of RUST_PATCHES) {
      wash(ctx, g.cx + patch.dx, g.topY + height * patch.yFraction, patch.rx, patch.ry, RUST_HEAVY);
    }
    for (let i = 0; i < RUST_STREAKS.count; i++) {
      const x = g.cx + signedUnit(rng) * DRUM.rx * RUST_STREAKS.spreadFraction;
      wash(
        ctx,
        x,
        g.topY + height * RUST_STREAKS.yFraction,
        RUST_STREAKS.rx,
        height * RUST_STREAKS.heightFraction,
        RUST,
      );
    }
    wash(ctx, g.cx, g.topY, DRUM.rx, RUST_STREAKS.lidRy, RUST_DARK);
  } else {
    wash(ctx, g.cx, g.bottomY, DRUM.rx * SCUFF.widthFraction, SCUFF.ry, RUST);
    // A stencilled stock number, half worn off.
    ctx.fillStyle = STENCIL;
    const sx = g.cx + SCUFF.digitLeft;
    const sy = g.topY + height * SCUFF.digitYFraction;
    for (let i = 0; i < SCUFF.digitCount; i++) {
      if (rng() < SCUFF.wornChance) continue;
      ctx.fillRect(sx + i * SCUFF.digitStep, sy, SCUFF.digitWidth, SCUFF.digitHeight);
    }
    scrapes(ctx, g.cx, g.topY + height * SCRAPES.yFraction, rng);
  }
  ctx.restore();
}

/** Bare steel showing through the paint where the drum has been dragged and knocked. */
function scrapes(ctx: Ctx, cx: number, cy: number, rng: () => number): void {
  for (let i = 0; i < SCRAPES.count; i++) {
    const x = cx + signedUnit(rng) * SCRAPES.spreadX;
    const y = cy + signedUnit(rng) * SCRAPES.spreadY;
    line(
      ctx,
      x - SCRAPES.half,
      y,
      x + SCRAPES.half,
      y + SCRAPES.slope,
      SCRAPES.colour,
      SCRAPES.width,
    );
  }
}

/**
 * An oil drum's looks: the run of oil from its bung, its hazard band scraped
 * through to bare steel, or a slick of oil pooled on its lid.
 */
function drawOilLook(
  ctx: Ctx,
  g: DrumGeometry,
  height: number,
  look: DrumLook,
  rng: () => number,
): void {
  if (look === 'label') {
    drawOilBand(ctx, g, height, rng, true);
    return;
  }
  drawOilBand(ctx, g, height, rng, false);
  if (look === 'rust') {
    scrapes(ctx, g.cx, g.topY + height * OIL_BAND_SHAPE.yFraction + OIL_BAND_SHAPE.height / 2, rng);
    wash(ctx, g.cx, g.bottomY, DRUM.rx * SCUFF.widthFraction, SCUFF.ry, RUST_HEAVY);
  } else {
    // A flammable diamond stuck on the band, red on white.
    const x = g.cx + DRUM.rx * HAZARD_LABEL.xFraction;
    const y = g.topY + height * OIL_BAND_SHAPE.yFraction + OIL_BAND_SHAPE.height / 2;
    const half = OIL_PLACARD_HALF;
    ctx.fillStyle = LABEL_WHITE;
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = LABEL_RED;
    ctx.beginPath();
    ctx.moveTo(x, y - half * OIL_PLACARD_INNER);
    ctx.lineTo(x + half * OIL_PLACARD_INNER, y);
    ctx.lineTo(x, y + half * OIL_PLACARD_INNER);
    ctx.lineTo(x - half * OIL_PLACARD_INNER, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** A slick of oil pooled on the lid, glossy black with the cold sheen across it. */
function lidSlick(ctx: Ctx, g: DrumGeometry): void {
  ctx.fillStyle = OIL_GLOSS;
  ctx.beginPath();
  ctx.ellipse(
    g.cx + LID_SLICK.dx,
    g.topY + LID_SLICK.dy,
    LID_SLICK.rx,
    LID_SLICK.ry,
    LID_SLICK.tilt,
    0,
    TWO_PI,
  );
  ctx.fill();
  line(
    ctx,
    g.cx + LID_SLICK.dx - LID_SLICK.sheenHalf,
    g.topY + LID_SLICK.dy - 1,
    g.cx + LID_SLICK.dx + LID_SLICK.sheenHalf,
    g.topY + LID_SLICK.dy - 1,
    OIL_SHEEN,
  );
}

/** The lid: lit flat steel, the rolled chime round it and the two bungs. */
function drawDrumLid(ctx: Ctx, g: DrumGeometry, paint: DrumPaint): void {
  ctx.beginPath();
  ctx.ellipse(g.cx, g.topY, DRUM.rx, DRUM.lidRy, 0, 0, TWO_PI);
  const lidGrad = ctx.createLinearGradient(
    g.cx - DRUM.rx,
    g.topY - DRUM.lidRy,
    g.cx + DRUM.rx,
    g.topY + DRUM.lidRy,
  );
  lidGrad.addColorStop(0, paint.spec);
  lidGrad.addColorStop(0.5, paint.light);
  lidGrad.addColorStop(1, paint.mid);
  ctx.fillStyle = lidGrad;
  ctx.fill();
  ctx.strokeStyle = paint.dark;
  ctx.lineWidth = DRUM.chimeThickness;
  ctx.stroke();
  ctx.strokeStyle = paint.spec;
  ctx.lineWidth = LID.innerLineWidth;
  ctx.beginPath();
  ctx.ellipse(
    g.cx,
    g.topY + LID.innerDrop,
    DRUM.rx - LID.innerInset,
    DRUM.lidRy - LID.innerInset,
    0,
    LID.innerTrim,
    Math.PI - LID.innerTrim,
  );
  ctx.stroke();
  const bungX = g.cx + DRUM.rx * DRUM.bungOffsetFraction;
  ctx.fillStyle = paint.dark;
  ctx.beginPath();
  ctx.arc(bungX, g.topY, DRUM.bungLargeR, 0, TWO_PI);
  ctx.arc(
    g.cx - DRUM.rx * DRUM.bungOffsetFraction,
    g.topY - DRUM.bungSmallLift,
    DRUM.bungSmallR,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/** A standing steel drum, or an oil drum when `oil` is set. */
export function drawSteelDrum(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
  oil: boolean,
): void {
  const lookRng = mulberry32(DRUM_SEED + variantSeed(variant));
  const paint = oil ? BLACK_DRUM : BLUE_DRUM;
  const look = DRUM_LOOKS[variant] ?? 'label';
  const g = drumGeometry(ox, oy, ts);
  const height = g.bottomY - g.topY;
  contactShadow(ctx, g.cx, g.bottomY + DRUM.shadowDrop, ts);

  const paintBody = () => {
    drumBodyPath(ctx, g);
    ctx.fillStyle = cylinderRamp(ctx, g.cx - DRUM.rx, g.cx + DRUM.rx, 0, DRUM_BODY_STOPS(paint));
    ctx.fill();
    ctx.save();
    drumBodyPath(ctx, g);
    ctx.clip();
    ctx.fillStyle = verticalRamp(ctx, g.cx, g.topY, g.bottomY, DRUM_FOOT_SHADE);
    ctx.fillRect(g.cx - DRUM.rx, g.topY, DRUM.rx * 2, g.bottomY - g.topY + DRUM.lidRy);
    ctx.restore();
    drawDrumLook(ctx, g, look, oil, lookRng);
    for (const fraction of DRUM.ribFractions) drumRib(ctx, g, g.topY + height * fraction, paint);
    ctx.strokeStyle = paint.dark;
    ctx.lineWidth = DRUM.chimeThickness;
    ctx.beginPath();
    ctx.ellipse(
      g.cx,
      g.bottomY - BOTTOM_CHIME_LIFT,
      DRUM.rx,
      DRUM.lidRy,
      0,
      RIB.arcTrim,
      Math.PI - RIB.arcTrim,
    );
    ctx.stroke();
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 1;
    drumBodyPath(ctx, g);
    ctx.stroke();
    drawDrumLid(ctx, g, paint);
    if (oil && look === 'scuffed') lidSlick(ctx, g);
  };

  if (damaged) {
    // Dented, not cracked: the drum knocked askew and dents punched into its wall.
    withRotation(ctx, g.cx, g.bottomY, DRUM.damagedTilt, () => {
      paintBody();
      for (const mark of STANDING_DENTS) {
        dent(
          ctx,
          g.cx + mark.dx,
          g.topY + height * mark.yFraction + mark.dy,
          mark.rx,
          mark.ry,
          paint.spec,
        );
      }
    });
  } else {
    paintBody();
    if (look === 'scuffed' && !oil) {
      dent(
        ctx,
        g.cx + SCUFF_DENT.dx,
        g.topY + height * SCUFF_DENT.yFraction,
        SCUFF_DENT.rx,
        SCUFF_DENT.ry,
        paint.spec,
      );
    }
  }
}

/** The old knock a scuffed drum carries even before anyone strikes it. */
const SCUFF_DENT = { dx: 8, yFraction: 0.3, rx: 5, ry: 3 } as const;

// ── On its side ───────────────────────────────────────────────────────────────

const SIDE_DRUM = {
  halfLen: 22,
  ry: 16,
  capRx: 6.5,
  centerFraction: 0.56,
  ribFractions: [0.33, 0.66],
  shadowScale: 1.05,
  shadowDrop: 2,
  ribOffset: 1,
  ribLitOffset: -0.5,
  ribLitReachFraction: 0.2,
  bungDx: 1,
  bungRiseFraction: 0.45,
  bungScale: 0.8,
} as const;

const SIDE_DRUM_BODY_STOPS = (paint: DrumPaint) =>
  [
    [0, paint.mid],
    [0.18, paint.spec],
    [0.4, paint.light],
    [0.8, paint.mid],
    [1, paint.dark],
  ] as const;

const SIDE_DRUM_CAP_STOPS = (paint: DrumPaint) =>
  [
    [0, paint.spec],
    [0.5, paint.light],
    [1, paint.dark],
  ] as const;

const SIDE_RUST = { count: 3, spread: 15, rx: 7, ry: 9, yFraction: 0.4 } as const;
const SIDE_LABEL = { dx: -6, dy: -5, half: 6 } as const;
const SIDE_SCUFF_RY = 8;
const SIDE_DENTS: ReadonlyArray<DentMark> = [
  { dx: -6, dy: -4, rx: 8, ry: 4 },
  { dx: 10, dy: 6, rx: 5, ry: 3 },
];

/** A steel drum lying on its side, its lit end toward the east. */
export function drawSteelDrumSide(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
): void {
  const lookRng = mulberry32(DRUM_SEED + SIDE_DRUM_SEED_OFFSET + variantSeed(variant));
  const paint = BLUE_DRUM;
  const s = SIDE_DRUM;
  const cx = ox + ts / 2;
  const cy = oy + ts * s.centerFraction;
  const leftX = cx - s.halfLen;
  const rightX = cx + s.halfLen;
  contactShadow(ctx, cx, cy + s.ry + s.shadowDrop, ts, s.shadowScale);

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(leftX, cy - s.ry);
    ctx.lineTo(rightX, cy - s.ry);
    ctx.ellipse(rightX, cy, s.capRx, s.ry, 0, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(leftX, cy + s.ry);
    ctx.ellipse(leftX, cy, s.capRx, s.ry, 0, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  };
  bodyPath();
  ctx.fillStyle = verticalRamp(ctx, cx, cy - s.ry, cy + s.ry, SIDE_DRUM_BODY_STOPS(paint));
  ctx.fill();
  ctx.save();
  bodyPath();
  ctx.clip();
  const look = DRUM_LOOKS[variant] ?? 'label';
  if (look === 'label') {
    // The hazard diamond, on what is now the drum's upward face.
    const x = cx + SIDE_LABEL.dx;
    const y = cy + SIDE_LABEL.dy;
    const half = SIDE_LABEL.half;
    ctx.fillStyle = LABEL_WHITE;
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = LABEL_RED;
    ctx.fillRect(x - half / 2, y, half, half / HAZARD_LABEL.barThirds);
  } else if (look === 'rust') {
    for (let i = 0; i < SIDE_RUST.count; i++) {
      wash(
        ctx,
        cx + signedUnit(lookRng) * SIDE_RUST.spread,
        cy + s.ry * SIDE_RUST.yFraction,
        SIDE_RUST.rx,
        SIDE_RUST.ry,
        RUST_HEAVY,
      );
    }
  } else {
    wash(ctx, cx, cy + s.ry, s.halfLen, SIDE_SCUFF_RY, RUST);
    scrapes(ctx, cx, cy, lookRng);
  }
  for (const fraction of s.ribFractions) {
    const x = lerp(leftX, rightX, fraction);
    line(
      ctx,
      x + s.ribOffset,
      cy - s.ry,
      x + s.ribOffset,
      cy + s.ry,
      paint.dark,
      DRUM.ribThickness,
    );
    line(
      ctx,
      x + s.ribLitOffset,
      cy - s.ry,
      x + s.ribLitOffset,
      cy - s.ry * s.ribLitReachFraction,
      paint.spec,
    );
  }
  ctx.restore();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 1;
  bodyPath();
  ctx.stroke();

  // The visible end: lit steel with the rolled chime and one bung.
  ctx.beginPath();
  ctx.ellipse(rightX, cy, s.capRx, s.ry, 0, 0, TWO_PI);
  ctx.fillStyle = verticalRamp(ctx, rightX, cy - s.ry, cy + s.ry, SIDE_DRUM_CAP_STOPS(paint));
  ctx.fill();
  ctx.strokeStyle = paint.dark;
  ctx.lineWidth = DRUM.chimeThickness;
  ctx.stroke();
  ctx.fillStyle = paint.dark;
  ctx.beginPath();
  ctx.arc(
    rightX + s.bungDx,
    cy - s.ry * s.bungRiseFraction,
    DRUM.bungLargeR * s.bungScale,
    0,
    TWO_PI,
  );
  ctx.fill();

  if (damaged || look === 'scuffed') {
    for (const mark of damaged ? SIDE_DENTS : SIDE_DENTS.slice(1)) {
      dent(ctx, cx + mark.dx, cy + mark.dy, mark.rx, mark.ry, paint.spec);
    }
  }
}

// ── Burst shell ───────────────────────────────────────────────────────────────

/** The torn shell's outline, in pixels from its centre before it is turned. */
const SHELL_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-14, -6],
  [4, -8],
  [8, -3],
  [14, -7],
  [13, 5],
  [-13, 6],
];
const SHELL = {
  offsetX: -3,
  tilt: -0.2,
  halfWidth: 14,
  seamX: -6,
  seamTop: -7,
  seamBottom: 6,
  seamWidth: 2,
} as const;
/** The two edges of the tear, bright where the steel split. */
const SHELL_TEAR: ReadonlyArray<readonly [number, number, number, number]> = [
  [4, -8, 8, -3],
  [8, -3, 14, -7],
];

const SHELL_STOPS = (paint: DrumPaint) =>
  [
    [0, paint.dark],
    [0.35, paint.light],
    [1, paint.dark],
  ] as const;

/** A drum that has burst: its torn shell lying flattened, split open along a seam. */
export function burstDrumShell(ctx: Ctx, cx: number, cy: number, paint: DrumPaint): void {
  ctx.save();
  ctx.translate(cx + SHELL.offsetX, cy);
  ctx.rotate(SHELL.tilt);
  ctx.fillStyle = cylinderRamp(ctx, -SHELL.halfWidth, SHELL.halfWidth, 0, SHELL_STOPS(paint));
  ctx.beginPath();
  SHELL_OUTLINE.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const [x0, y0, x1, y1] of SHELL_TEAR) line(ctx, x0, y0, x1, y1, paint.spec);
  line(ctx, SHELL.seamX, SHELL.seamTop, SHELL.seamX, SHELL.seamBottom, paint.dark, SHELL.seamWidth);
  ctx.restore();
}
