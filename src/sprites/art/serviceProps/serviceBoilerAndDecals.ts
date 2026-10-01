/**
 * The boiler-room boiler, and the service level's walkable floor clutter:
 * cable runs, drifts of paper and a dropped towel.
 *
 * The boiler is two tiles by two and drawn whole from its south-west tile: a
 * riveted iron drum standing on a firebox, its flue and feed pipe climbing to
 * the ceiling. It cannot be broken, so it has a single looping row: the fire
 * behind its door and the steam off its relief valve. The fire door is the
 * boiler's own emitter and the only bright thing on it; the room's light is
 * the lighting pass's.
 *
 * The decals are baked flat into the floor, so each one stays strictly inside
 * its own tile and keeps to the floor's low contrast: clutter to walk through,
 * not shapes to read as obstacles.
 *
 * Measurements are in source pixels at the sheet's 64 px tile unless a name
 * says it is a fraction of the tile.
 */

import { type Ctx, contactShadow, cylinderRamp, lerp, puff, withRotation } from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  BARE_STEEL,
  BOILER_IRON,
  SAFETY_YELLOW,
  type BoxGeometry,
  boxFrontTop,
  line,
  paintBox,
  rustStreak,
  wash,
} from './servicePaint';
import { ONE_TILE_BASE_FRACTION, drawPaperSheets } from './serviceTallProps';

const FULL_TURN = Math.PI * 2;

/** Frames in the boiler's idle loop. */
export const BOILER_FRAMES = 4;

const BOILER_SEED = 0xb011;
const BOILER_FRAME_STRIDE = 97;
const BOILER_CONTACT_SHADOW_SCALE = 1;
/** The firebox: a low iron box across the footprint's front. */
const FIREBOX = {
  inset: 6,
  heightFraction: 0.55,
  depthFraction: 0.3,
  doorW: 30,
  doorH: 16,
  doorFrame: 3,
  doorFromBase: 14,
  bars: 4,
  barW: 3,
  tongues: 4,
  tonguePitch: 7,
  tongueInset: 4,
  tongueHalfW: 3,
  tongueJitter: 2,
  tongueMin: 0.4,
  tongueSpread: 0.45,
  tongueOvershoot: 1.2,
  tongueAlpha: 0.7,
  flickerMin: 0.75,
  flickerSpread: 0.25,
  hotStop: 0.3,
  midStop: 0.7,
  plateGap: 4,
  plateH: 5,
  hazardStripes: 5,
  stripePitch: 6,
  stripeLean: 3,
  stripeWidth: 2,
  rivetPitch: 8,
  rivetSize: 1.6,
  rivetDrop: 3,
} as const;
/** The drum: a vertical riveted cylinder standing on the firebox. */
const DRUM = {
  widthFraction: 1.5,
  heightFraction: 0.95,
  capSquash: 0.32,
  bands: 3,
  bandWidth: 2,
  bandLitWidth: 0.8,
  rivetPitch: 7,
  rivetSize: 1.8,
  rivetRise: 3,
  rustXFraction: 0.18,
  rustDrop: 6,
  rustLength: 30,
  litAt: 0.28,
  midAt: 0.5,
  rimWidth: 1.4,
} as const;
const GAUGE = {
  xFraction: 0.7,
  drop: 14,
  radius: 8,
  bezel: 2,
  needleWidth: 1.4,
  needleInset: 2,
} as const;
/** How far the gauge needle wanders each frame, in radians, about where it rests. */
const NEEDLE_JITTER = 0.08;
const NEEDLE_REST = -0.6;
const PIPES = {
  flueXFraction: 0.32,
  flueW: 12,
  feedXFraction: 0.78,
  feedW: 7,
  ceilingTiles: 1.95,
  litAt: 0.35,
  collarH: 3,
} as const;
const RELIEF = {
  xFraction: 0.62,
  stemW: 4,
  stemH: 7,
  wheelRadius: 5,
  wheelWidth: 2,
  spokeWidth: 1.3,
} as const;
/** Steam off the relief valve: big and pale enough to read over the dark room. */
const STEAM = {
  puffs: 4,
  driftX: 10,
  riseTiles: 0.75,
  radiusMin: 5,
  radiusGrowth: 10,
  alpha: 0.6,
} as const;
const STEAM_RGB = [228, 232, 230] as const;
const FIRE_CORE = '#fff0b8';
const FIRE_HOT = '#ffc04a';
const FIRE_MID = '#f07a22';
const FIRE_DEEP = '#a8320e';
const GAUGE_FACE = '#d9d2bc';
const VALVE_RED = '#9a2e24';
const HAZARD_BLACK = '#1d1b16';

/** A vertical pipe from `bottomY` up to `topY`, lit on its left. */
function pipe(ctx: Ctx, cx: number, width: number, topY: number, bottomY: number): void {
  ctx.save();
  ctx.fillStyle = cylinderRamp(ctx, cx - width / 2, cx + width / 2, topY, [
    [0, BARE_STEEL.dark],
    [PIPES.litAt, BARE_STEEL.light],
    [1, BARE_STEEL.dark],
  ]);
  ctx.fillRect(cx - width / 2, topY, width, bottomY - topY);
  ctx.restore();
  wash(
    ctx,
    cx - width / 2 - 1,
    bottomY - PIPES.collarH,
    width + 2,
    PIPES.collarH,
    BARE_STEEL.dark,
    1,
  );
}

/** The boiler at idle frame `frame`, its fire flickering and its valve steaming. */
export function drawBoiler(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const rng = mulberry32(BOILER_SEED + frame * BOILER_FRAME_STRIDE);
  const left = ox + FIREBOX.inset;
  const right = ox + ts * 2 - FIREBOX.inset;
  const cx = (left + right) / 2;
  const baseY = oy + ts * ONE_TILE_BASE_FRACTION;
  contactShadow(ctx, cx, baseY, ts * 2, BOILER_CONTACT_SHADOW_SCALE);

  const firebox: BoxGeometry = {
    left,
    right,
    baseY,
    height: ts * FIREBOX.heightFraction,
    depth: ts * FIREBOX.depthFraction,
  };
  const fireboxTop = boxFrontTop(firebox);
  const drumHalf = (ts * DRUM.widthFraction) / 2;
  const drumLeft = cx - drumHalf;
  const drumRight = cx + drumHalf;
  const drumBase = fireboxTop - firebox.depth / 2;
  const drumTop = drumBase - ts * DRUM.heightFraction;
  const capRy = drumHalf * DRUM.capSquash;
  const ceilingY = oy - ts * PIPES.ceilingTiles;

  // Pipes behind the drum climb out of its cap towards the ceiling.
  pipe(ctx, lerp(drumLeft, drumRight, PIPES.flueXFraction), PIPES.flueW, ceilingY, drumTop);
  pipe(ctx, lerp(drumLeft, drumRight, PIPES.feedXFraction), PIPES.feedW, ceilingY, drumTop);

  paintBox(ctx, firebox, BOILER_IRON);
  for (let x = left + FIREBOX.rivetPitch / 2; x < right; x += FIREBOX.rivetPitch) {
    wash(
      ctx,
      x,
      fireboxTop + FIREBOX.rivetDrop,
      FIREBOX.rivetSize,
      FIREBOX.rivetSize,
      BOILER_IRON.edge,
      1,
    );
  }

  // The drum: a lit cylinder with an elliptical cap.
  ctx.save();
  ctx.fillStyle = cylinderRamp(ctx, drumLeft, drumRight, drumTop, [
    [0, BOILER_IRON.frontLow],
    [DRUM.litAt, BOILER_IRON.edge],
    [DRUM.midAt, BOILER_IRON.frontHigh],
    [1, BOILER_IRON.outline],
  ]);
  ctx.beginPath();
  ctx.moveTo(drumLeft, drumBase);
  ctx.lineTo(drumLeft, drumTop);
  ctx.ellipse(cx, drumTop, drumHalf, capRy, 0, Math.PI, 0, true);
  ctx.lineTo(drumRight, drumBase);
  ctx.ellipse(cx, drumBase, drumHalf, capRy, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = BOILER_IRON.outline;
  ctx.lineWidth = DRUM.rimWidth;
  ctx.stroke();
  ctx.fillStyle = BOILER_IRON.top;
  ctx.beginPath();
  ctx.ellipse(cx, drumTop, drumHalf, capRy, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  for (let b = 1; b <= DRUM.bands; b++) {
    const y = lerp(drumTop, drumBase, b / (DRUM.bands + 1));
    ctx.save();
    ctx.strokeStyle = BOILER_IRON.outline;
    ctx.lineWidth = DRUM.bandWidth;
    ctx.beginPath();
    ctx.ellipse(cx, y, drumHalf, capRy, 0, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = BOILER_IRON.edge;
    ctx.lineWidth = DRUM.bandLitWidth;
    ctx.beginPath();
    ctx.ellipse(cx, y + DRUM.bandWidth, drumHalf, capRy, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    // Rivets along the band, following its curve round the drum.
    for (let x = drumLeft + DRUM.rivetPitch / 2; x < drumRight; x += DRUM.rivetPitch) {
      const across = (x - cx) / drumHalf;
      const curveY = y + Math.sqrt(Math.max(0, 1 - across * across)) * capRy;
      wash(ctx, x, curveY - DRUM.rivetRise, DRUM.rivetSize, DRUM.rivetSize, BOILER_IRON.edge, 1);
    }
  }
  rustStreak(
    ctx,
    lerp(drumLeft, drumRight, DRUM.rustXFraction),
    drumTop + DRUM.rustDrop,
    DRUM.rustLength,
  );

  const gaugeX = lerp(drumLeft, drumRight, GAUGE.xFraction);
  const gaugeY = drumTop + capRy + GAUGE.drop;
  ctx.save();
  ctx.fillStyle = BARE_STEEL.dark;
  ctx.beginPath();
  ctx.arc(gaugeX, gaugeY, GAUGE.radius + GAUGE.bezel, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = GAUGE_FACE;
  ctx.beginPath();
  ctx.arc(gaugeX, gaugeY, GAUGE.radius, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
  const needle = NEEDLE_REST + (rng() - 0.5) * 2 * NEEDLE_JITTER;
  const needleReach = GAUGE.radius - GAUGE.needleInset;
  line(
    ctx,
    gaugeX,
    gaugeY,
    gaugeX + Math.cos(needle) * needleReach,
    gaugeY + Math.sin(needle) * needleReach,
    VALVE_RED,
    GAUGE.needleWidth,
  );

  // The fire door, its glow the boiler's own light.
  const doorLeft = cx - FIREBOX.doorW / 2;
  const doorTop = baseY - FIREBOX.doorFromBase - FIREBOX.doorH;
  wash(
    ctx,
    doorLeft - FIREBOX.doorFrame,
    doorTop - FIREBOX.doorFrame,
    FIREBOX.doorW + FIREBOX.doorFrame * 2,
    FIREBOX.doorH + FIREBOX.doorFrame * 2,
    BOILER_IRON.outline,
    1,
  );
  const flicker = FIREBOX.flickerMin + rng() * FIREBOX.flickerSpread;
  ctx.save();
  const fire = ctx.createLinearGradient(0, doorTop + FIREBOX.doorH, 0, doorTop);
  fire.addColorStop(0, FIRE_CORE);
  fire.addColorStop(FIREBOX.hotStop * flicker, FIRE_HOT);
  fire.addColorStop(FIREBOX.midStop, FIRE_MID);
  fire.addColorStop(1, FIRE_DEEP);
  ctx.fillStyle = fire;
  ctx.fillRect(doorLeft, doorTop, FIREBOX.doorW, FIREBOX.doorH);
  ctx.beginPath();
  ctx.rect(doorLeft, doorTop, FIREBOX.doorW, FIREBOX.doorH);
  ctx.clip();
  ctx.fillStyle = FIRE_CORE;
  ctx.globalAlpha = FIREBOX.tongueAlpha;
  const doorBottom = doorTop + FIREBOX.doorH;
  for (let i = 0; i < FIREBOX.tongues; i++) {
    const fx =
      doorLeft + FIREBOX.tongueInset + i * FIREBOX.tonguePitch + rng() * FIREBOX.tongueJitter;
    const tongue = FIREBOX.doorH * (FIREBOX.tongueMin + rng() * FIREBOX.tongueSpread);
    ctx.beginPath();
    ctx.moveTo(fx - FIREBOX.tongueHalfW, doorBottom);
    ctx.quadraticCurveTo(
      fx,
      doorBottom - tongue * FIREBOX.tongueOvershoot,
      fx + FIREBOX.tongueHalfW,
      doorBottom,
    );
    ctx.fill();
  }
  ctx.restore();
  for (let b = 1; b < FIREBOX.bars; b++) {
    const x = doorLeft + (FIREBOX.doorW * b) / FIREBOX.bars;
    wash(ctx, x - FIREBOX.barW / 2, doorTop, FIREBOX.barW, FIREBOX.doorH, BOILER_IRON.outline, 1);
  }
  // Yellow and black hazard plate under the fire door.
  const plateY = doorBottom + FIREBOX.doorFrame + FIREBOX.plateGap;
  wash(ctx, doorLeft, plateY, FIREBOX.doorW, FIREBOX.plateH, SAFETY_YELLOW.frontHigh, 1);
  for (let i = 0; i < FIREBOX.hazardStripes; i++) {
    const sx = doorLeft + FIREBOX.stripeWidth + i * FIREBOX.stripePitch;
    line(
      ctx,
      sx,
      plateY + FIREBOX.plateH,
      sx + FIREBOX.stripeLean,
      plateY,
      HAZARD_BLACK,
      FIREBOX.stripeWidth,
    );
  }

  // The relief valve on the drum's cap, and the steam it leaks.
  const valveX = lerp(drumLeft, drumRight, RELIEF.xFraction);
  const valveBase = drumTop;
  wash(
    ctx,
    valveX - RELIEF.stemW / 2,
    valveBase - RELIEF.stemH,
    RELIEF.stemW,
    RELIEF.stemH,
    BARE_STEEL.mid,
    1,
  );
  const wheelY = valveBase - RELIEF.stemH;
  ctx.save();
  ctx.strokeStyle = VALVE_RED;
  ctx.lineWidth = RELIEF.wheelWidth;
  ctx.beginPath();
  ctx.arc(valveX, wheelY, RELIEF.wheelRadius, 0, FULL_TURN);
  ctx.stroke();
  ctx.restore();
  line(
    ctx,
    valveX - RELIEF.wheelRadius,
    wheelY,
    valveX + RELIEF.wheelRadius,
    wheelY,
    VALVE_RED,
    RELIEF.spokeWidth,
  );
  line(
    ctx,
    valveX,
    wheelY - RELIEF.wheelRadius,
    valveX,
    wheelY + RELIEF.wheelRadius,
    VALVE_RED,
    RELIEF.spokeWidth,
  );
  const phase = frame / BOILER_FRAMES;
  for (let i = 0; i < STEAM.puffs; i++) {
    const t = (phase + i / STEAM.puffs) % 1;
    puff(
      ctx,
      valveX + t * STEAM.driftX,
      wheelY - t * ts * STEAM.riseTiles,
      STEAM.radiusMin + t * STEAM.radiusGrowth,
      STEAM.alpha * (1 - t),
      STEAM_RGB,
    );
  }
}

// ── Decals ─────────────────────────────────────────────────────────────────

/** Keeps every stroke clear of the tile's edge so the chunk bake never clips one. */
const DECAL_MARGIN = 3;

const CABLE_SEED = 0xca8e;
const CABLE_VARIANT_STRIDE = 59;
const CABLE_SHADES = ['#232526', '#2f3335', '#3a3e40'] as const;
const CABLE_EXTENSION = '#a85f24';
/** The plain variant is all black cable; the others run an orange extension lead through it. */
const PLAIN_CABLE_VARIANT = 0;
const CABLE = {
  strands: 3,
  width: 3.6,
  shadowAlpha: 0.3,
  shadowDrop: 1.2,
  endInset: 6,
  startJitter: 0.6,
  bendAt: 0.35,
  bendOutAt: 0.65,
  bendSwing: 20,
} as const;

/** A few cables snaking across the floor, one of them an orange extension lead. */
export function drawCableBundle(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(CABLE_SEED + variant * CABLE_VARIANT_STRIDE);
  const lo = DECAL_MARGIN;
  const hi = ts - DECAL_MARGIN;
  for (let i = 0; i < CABLE.strands; i++) {
    const y0 =
      oy +
      lerp(
        lo + CABLE.endInset,
        hi - CABLE.endInset,
        (i + rng() * CABLE.startJitter) / CABLE.strands,
      );
    const y1 = oy + lerp(lo + CABLE.endInset, hi - CABLE.endInset, rng());
    const isLead = i === CABLE.strands - 1 && variant !== PLAIN_CABLE_VARIANT;
    const shade = isLead ? CABLE_EXTENSION : (CABLE_SHADES[i] ?? CABLE_SHADES[0]);
    const swingIn = (rng() - 0.5) * CABLE.bendSwing;
    const swingOut = (rng() - 0.5) * CABLE.bendSwing;
    const path = (dy: number) => {
      ctx.beginPath();
      ctx.moveTo(ox + lo, y0 + dy);
      ctx.bezierCurveTo(
        ox + ts * CABLE.bendAt,
        y0 + dy + swingIn,
        ox + ts * CABLE.bendOutAt,
        y1 + dy + swingOut,
        ox + hi,
        y1 + dy,
      );
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = CABLE.width;
    ctx.globalAlpha = CABLE.shadowAlpha;
    ctx.strokeStyle = '#000';
    path(CABLE.shadowDrop);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = shade;
    path(0);
    ctx.stroke();
    ctx.restore();
  }
}

const PAPER_SEED = 0x9a9e;
const PAPER_VARIANT_STRIDE = 71;
const PAPER_DRIFT = {
  alpha: 0.85,
  spreadFraction: 0.3,
  sheetsMin: 6,
  ballRadius: 3,
  ballFirstXFraction: 0.25,
  ballSpreadXFraction: 0.5,
  ballFirstYFraction: 0.3,
  ballSpreadYFraction: 0.4,
} as const;
const PAPER_BALL = '#bcb8aa';

/** A drift of loose paper, low contrast against the floor. */
export function drawPaperDrift(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(PAPER_SEED + variant * PAPER_VARIANT_STRIDE);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + DECAL_MARGIN, oy + DECAL_MARGIN, ts - DECAL_MARGIN * 2, ts - DECAL_MARGIN * 2);
  ctx.clip();
  ctx.globalAlpha = PAPER_DRIFT.alpha;
  drawPaperSheets(
    ctx,
    ox + ts / 2,
    oy + ts / 2,
    ts * PAPER_DRIFT.spreadFraction,
    PAPER_DRIFT.sheetsMin + variant,
    rng,
  );
  ctx.restore();
  // One sheet balled up.
  ctx.save();
  ctx.fillStyle = PAPER_BALL;
  ctx.beginPath();
  ctx.arc(
    ox + ts * (PAPER_DRIFT.ballFirstXFraction + rng() * PAPER_DRIFT.ballSpreadXFraction),
    oy + ts * (PAPER_DRIFT.ballFirstYFraction + rng() * PAPER_DRIFT.ballSpreadYFraction),
    PAPER_DRIFT.ballRadius,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();
}

const TOWEL_SEED = 0x7043;
const TOWEL_VARIANT_STRIDE = 83;
const TOWEL_BODY = '#aeb3b2';
const TOWEL_STRIPE = '#4f6f8a';
/** The towel's outline, as points about its centre: a crumpled rectangle with sagging long edges. */
const TOWEL_SHAPE = {
  topLeft: [-16, -6] as const,
  topSag: [-2, -10] as const,
  topRight: [15, -5] as const,
  bottomRight: [13, 7] as const,
  bottomSag: [0, 10] as const,
  bottomLeft: [-14, 6] as const,
} as const;
const TOWEL = {
  centreYFraction: 0.55,
  maxTwist: 0.8,
  shadowLeft: -15,
  shadowTop: -7,
  shadowW: 31,
  shadowH: 16,
  shadowAlpha: 0.22,
  stripeA: [-15, -3, 29] as const,
  stripeB: [-14, 3, 27] as const,
  stripeH: 2,
  stripeAlpha: 0.9,
  foldAlpha: 0.35,
  foldWidth: 3,
  folds: 2,
  foldFirstX: -8,
  foldPitch: 12,
  foldLean: 4,
  foldReach: 7,
} as const;

/** A towel dropped in a heap, folds shown as darker bands. */
export function drawDroppedTowel(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(TOWEL_SEED + variant * TOWEL_VARIANT_STRIDE);
  const cx = ox + ts / 2;
  const cy = oy + ts * TOWEL.centreYFraction;
  const at = (point: readonly [number, number]): [number, number] => [cx + point[0], cy + point[1]];
  withRotation(ctx, cx, cy, (rng() - 0.5) * TOWEL.maxTwist, () => {
    wash(
      ctx,
      cx + TOWEL.shadowLeft,
      cy + TOWEL.shadowTop,
      TOWEL.shadowW,
      TOWEL.shadowH,
      '#000',
      TOWEL.shadowAlpha,
    );
    ctx.save();
    ctx.fillStyle = TOWEL_BODY;
    ctx.beginPath();
    ctx.moveTo(...at(TOWEL_SHAPE.topLeft));
    ctx.quadraticCurveTo(...at(TOWEL_SHAPE.topSag), ...at(TOWEL_SHAPE.topRight));
    ctx.lineTo(...at(TOWEL_SHAPE.bottomRight));
    ctx.quadraticCurveTo(...at(TOWEL_SHAPE.bottomSag), ...at(TOWEL_SHAPE.bottomLeft));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    for (const [x, y, w] of [TOWEL.stripeA, TOWEL.stripeB]) {
      wash(ctx, cx + x, cy + y, w, TOWEL.stripeH, TOWEL_STRIPE, TOWEL.stripeAlpha);
    }
    ctx.save();
    ctx.globalAlpha = TOWEL.foldAlpha;
    for (let i = 0; i < TOWEL.folds; i++) {
      const fx = cx + TOWEL.foldFirstX + i * TOWEL.foldPitch;
      line(
        ctx,
        fx,
        cy - TOWEL.foldReach,
        fx + TOWEL.foldLean,
        cy + TOWEL.foldReach,
        '#000',
        TOWEL.foldWidth,
      );
    }
    ctx.restore();
  });
}
