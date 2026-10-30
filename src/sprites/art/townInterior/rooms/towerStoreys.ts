/**
 * The Town Center Tower's storeys below and above the civic floors: the
 * cistern's ward-conduit sluice, the portcullis that bars the spiral stair,
 * the cattery's cages, and the binding room's circle and tether pillars.
 *
 * The ironwork is the tower's own black iron and the wood its walnut, so these
 * read as the same building's fittings. The one new colour is the ward light,
 * a sickly violet-white kept well away from red, which is reserved for ground
 * that is about to hurt.
 */

import {
  footprintBox,
  withFootprintClip,
  jitter,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type FootprintBox,
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, mix, type RGB, type Ramp } from '../../town/townPalette';
import { mulberry32 } from '../../../person/rng';
import { easeOut, lerp } from '../../bipedArt';
import {
  WALNUT,
  BRASS_DIM,
  BRASS_BRIGHT,
  ironRamp,
  bandShadow,
  inkRect,
  slab,
  litEdge,
  glow,
} from './townCenterTower';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

// ── Materials ──────────────────────────────────────────────────────────────

/** Cistern masonry: the town's ashlar, darkened by damp and no daylight. */
const CISTERN_STONE: Ramp = {
  shadow: [28, 30, 34],
  mid: [64, 68, 74],
  light: [98, 104, 112],
  accent: [124, 130, 138],
};
/** Dressed stone for the stair arch, a stop lighter than the cistern's. */
function archStoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}
const CULVERT_DARK: RGB = [10, 12, 16];
const WATER_DARK: RGB = [18, 26, 34];
const WATER_DEEP: RGB = [30, 44, 56];
/** The cold light the ward conduit carries on its water. */
const CONDUIT_LIGHT_CORE: RGB = [226, 240, 255];
const CONDUIT_LIGHT_MID: RGB = [138, 182, 226];
/** Ward light: violet-white, sickly rather than warm. */
const WARD_CORE: RGB = [240, 232, 255];
const WARD_MID: RGB = [182, 156, 238];
const WARD_EDGE: RGB = [108, 80, 172];
/** The cistern's damp brick, dark and cold. */
/** The binding room's carved stone: paler than the cistern's, so the carving reads. */
const CARVED_STONE: Ramp = {
  shadow: [46, 46, 54],
  mid: [98, 100, 110],
  light: [144, 146, 158],
  accent: [176, 178, 190],
};
const CISTERN_BRICK: Ramp = {
  shadow: [34, 24, 22],
  mid: [74, 50, 42],
  light: [108, 76, 62],
  accent: [132, 98, 80],
};
const MORTAR_DAMP: RGB = [26, 24, 24];
const CHALK_DULL: RGB = [150, 144, 160];
const STRAW: RGB = [196, 168, 98];
const STRAW_SHADE: RGB = [142, 116, 60];
const DISH_GLAZE: RGB = [170, 176, 182];

function hairline(ts: number, tiles: number): number {
  return Math.max(1, ts * tiles);
}

const MASONRY_JOINT_FRACTION = 0.12;
const MASONRY_TONE_CENTRE = 0.5;
const MASONRY_TONE_JITTER = 0.16;
const MASONRY_TOP_LIGHT_FRACTION = 0.18;
const MASONRY_TOP_LIGHT_ALPHA = 0.35;

/**
 * Staggered blocks at a fixed course height in tiles, so a tall wall and a
 * short one share one block size. `paintStoneCourses` sizes its courses to the
 * area painted, which turns a two-tile wall into a few slabs.
 */
function paintMasonry(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
  courseTiles: number,
  blockTiles: number,
  ts: number,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(MORTAR_DAMP);
  ctx.fillRect(x, y, w, h);
  const courseH = ts * courseTiles;
  const blockW = ts * blockTiles;
  const joint = Math.max(1, courseH * MASONRY_JOINT_FRACTION);
  const courses = Math.ceil(h / courseH);
  for (let row = 0; row < courses; row++) {
    const rowBottom = y + h - row * courseH;
    const rowTop = rowBottom - courseH;
    const stagger = row % 2 === 0 ? 0 : blockW / 2;
    for (let cursor = x - stagger; cursor < x + w; cursor += blockW) {
      const tone = MASONRY_TONE_CENTRE + jitter(rng, MASONRY_TONE_JITTER);
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.fillRect(cursor + joint / 2, rowTop + joint / 2, blockW - joint, courseH - joint);
      ctx.fillStyle = rgba(sampleRamp(ramp, 1), MASONRY_TOP_LIGHT_ALPHA);
      ctx.fillRect(
        cursor + joint / 2,
        rowTop + joint / 2,
        blockW - joint,
        (courseH - joint) * MASONRY_TOP_LIGHT_FRACTION,
      );
    }
  }
  ctx.restore();
}

// ── Ward conduit sluice ────────────────────────────────────────────────────

const SLUICE_RUNNING_VARIANT = 0;
/** Top of the stone headwall, in tiles above the footprint's foot. */
const SLUICE_HEADWALL_TOP_TILES = 2.15;
const SLUICE_HEADWALL_INSET_TILES = 0.04;
/** The channel the water falls into, along the footprint's foot. */
const SLUICE_BRICK_COURSE_TILES = 0.12;
const SLUICE_BRICK_LENGTH_TILES = 0.3;
const SLUICE_BASIN_DEPTH_TILES = 0.36;
const SLUICE_BASIN_LIP_TILES = 0.07;
const SLUICE_MOUTH_WIDTH_TILES = 0.86;
const SLUICE_MOUTH_SILL_TILES = 0.42;
const SLUICE_MOUTH_HEIGHT_TILES = 0.62;
const SLUICE_VOUSSOIR_TILES = 0.13;
const SLUICE_VOUSSOIR_COUNT = 7;
const SLUICE_RAIL_WIDTH_TILES = 0.07;
const SLUICE_RAIL_TOP_TILES = 1.85;
const SLUICE_GATE_HEIGHT_TILES = 0.66;
/** How far above the mouth's sill the raised gate's foot hangs. */
const SLUICE_GATE_RAISED_LIFT_TILES = 0.64;
const SLUICE_GATE_PLANKS = 4;
const SLUICE_GATE_STRAPS = 2;
/** The winding wheel sits to the right of the mouth, above the rail head. */
const SLUICE_WHEEL_X_FRACTION = 0.79;
const SLUICE_WHEEL_Y_TILES = 1.52;
const SLUICE_WHEEL_RADIUS_TILES = 0.24;
const SLUICE_WHEEL_SPOKES = 6;
const SLUICE_WHEEL_SHUT_TURN = Math.PI / SLUICE_WHEEL_SPOKES;
const SLUICE_SPINDLE_WIDTH_TILES = 0.05;
const SLUICE_CHAIN_LINK_TILES = 0.05;
const SLUICE_FALL_STREAKS = 6;
const SLUICE_RIPPLES = 5;
const SLUICE_GLOW_RADIUS_TILES = 1.0;
const SLUICE_LIT_GLOW_ALPHA = 0.7;
const SLUICE_GUTTERED_GLOW_ALPHA = 0.08;

/**
 * A stone culvert mouth in the cistern's north wall with an iron-strapped
 * sluice gate in two rails, wound by the wheel at its side. Variant 0 runs:
 * the gate is up and the water pouring out carries the ward conduit's cold
 * light. Variant 1 is shut: the gate is down in the channel, the wheel turned
 * and the light guttered to a glint on dark water.
 */
export function paintWardConduitSluice(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const running = variant === SLUICE_RUNNING_VARIANT;
    const inset = ts * SLUICE_HEADWALL_INSET_TILES;
    const wallLeft = box.left + inset;
    const wallWidth = box.width - inset * 2;
    const wallTop = box.bottom - ts * SLUICE_HEADWALL_TOP_TILES;
    const basinTop = box.bottom - ts * SLUICE_BASIN_DEPTH_TILES;

    paintMasonry(
      ctx,
      wallLeft,
      wallTop,
      wallWidth,
      basinTop - wallTop,
      CISTERN_BRICK,
      SLUICE_BRICK_COURSE_TILES,
      SLUICE_BRICK_LENGTH_TILES,
      ts,
      rng,
    );
    inkRect(ctx, wallLeft, wallTop, wallWidth, basinTop - wallTop, ts);

    const mouthCentreX = box.left + box.width * 0.36;
    const mouthHalfW = (ts * SLUICE_MOUTH_WIDTH_TILES) / 2;
    const mouthSill = box.bottom - ts * SLUICE_MOUTH_SILL_TILES;
    const mouthSpring = mouthSill - ts * SLUICE_MOUTH_HEIGHT_TILES + mouthHalfW;
    traceArchOpening(ctx, mouthCentreX, mouthHalfW, mouthSpring, mouthSill);
    ctx.fillStyle = rgb(CULVERT_DARK);
    ctx.fill();
    paintVoussoirs(ctx, mouthCentreX, mouthHalfW, mouthSpring, ts, CISTERN_STONE, rng);

    if (running) {
      const tunnelLight = ctx.createLinearGradient(0, mouthSpring, 0, mouthSill);
      tunnelLight.addColorStop(0, rgba(CONDUIT_LIGHT_MID, 0));
      tunnelLight.addColorStop(1, rgba(CONDUIT_LIGHT_MID, 0.55));
      traceArchOpening(ctx, mouthCentreX, mouthHalfW * 0.8, mouthSpring, mouthSill);
      ctx.fillStyle = tunnelLight;
      ctx.fill();
    }

    paintBasin(ctx, box, basinTop, ts, running);

    if (running) {
      paintFall(ctx, mouthCentreX, mouthHalfW, mouthSill, basinTop, ts, rng);
    }

    const railW = ts * SLUICE_RAIL_WIDTH_TILES;
    const railTop = box.bottom - ts * SLUICE_RAIL_TOP_TILES;
    const iron = ironRamp();
    for (const side of [-1, 1]) {
      const railX = mouthCentreX + side * (mouthHalfW + railW * 0.2) - railW / 2;
      slab(ctx, iron, 0.4, railX, railTop, railW, basinTop - railTop, ts);
    }
    slab(
      ctx,
      iron,
      0.5,
      mouthCentreX - mouthHalfW - railW,
      railTop - railW,
      mouthHalfW * 2 + railW * 2,
      railW,
      ts,
    );

    const gateH = ts * SLUICE_GATE_HEIGHT_TILES;
    const gateFoot = running ? mouthSill - ts * SLUICE_GATE_RAISED_LIFT_TILES : basinTop + ts * 0.1;
    paintSluiceGate(ctx, mouthCentreX, mouthHalfW, gateFoot - gateH, gateH, ts, running);

    const wheelX = box.left + box.width * SLUICE_WHEEL_X_FRACTION;
    const wheelY = box.bottom - ts * SLUICE_WHEEL_Y_TILES;
    const spindleW = ts * SLUICE_SPINDLE_WIDTH_TILES;
    slab(ctx, iron, 0.35, wheelX - spindleW / 2, wheelY, spindleW, basinTop - wheelY, ts);
    paintChain(ctx, wheelX, wheelY, mouthCentreX + mouthHalfW * 0.5, gateFoot - gateH, ts);
    const wheelTurn = running ? 0 : SLUICE_WHEEL_SHUT_TURN;
    paintWindingWheel(ctx, wheelX, wheelY, ts * SLUICE_WHEEL_RADIUS_TILES, wheelTurn, ts);

    const glowY = (mouthSill + basinTop) / 2;
    const glowAlpha = running ? SLUICE_LIT_GLOW_ALPHA : SLUICE_GUTTERED_GLOW_ALPHA;
    glow(ctx, mouthCentreX, glowY, ts * SLUICE_GLOW_RADIUS_TILES, CONDUIT_LIGHT_MID, glowAlpha);
  });
}

/** A round-headed opening: straight jambs from the sill up to the springing line, then a half circle. */
function traceArchOpening(
  ctx: Ctx,
  centreX: number,
  halfW: number,
  springY: number,
  sillY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(centreX - halfW, sillY);
  ctx.lineTo(centreX - halfW, springY);
  ctx.arc(centreX, springY, halfW, Math.PI, 0);
  ctx.lineTo(centreX + halfW, sillY);
  ctx.closePath();
}

function paintVoussoirs(
  ctx: Ctx,
  centreX: number,
  halfW: number,
  springY: number,
  ts: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const ringW = ts * SLUICE_VOUSSOIR_TILES;
  const inner = halfW;
  const outer = halfW + ringW;
  for (let i = 0; i < SLUICE_VOUSSOIR_COUNT; i++) {
    const start = Math.PI + (Math.PI * i) / SLUICE_VOUSSOIR_COUNT;
    const end = Math.PI + (Math.PI * (i + 1)) / SLUICE_VOUSSOIR_COUNT;
    ctx.beginPath();
    ctx.arc(centreX, springY, outer, start, end);
    ctx.arc(centreX, springY, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.62 + jitter(rng, 0.1)));
    ctx.fill();
    inkOutline(ctx, ts);
  }
}

function paintBasin(
  ctx: Ctx,
  box: FootprintBox,
  basinTop: number,
  ts: number,
  running: boolean,
): void {
  const lipH = ts * SLUICE_BASIN_LIP_TILES;
  slab(ctx, CISTERN_STONE, 0.55, box.left, basinTop, box.width, lipH, ts);
  litEdge(ctx, CISTERN_STONE, box.left, basinTop, box.width, ts);
  const waterTop = basinTop + lipH;
  const water = ctx.createLinearGradient(0, waterTop, 0, box.bottom);
  water.addColorStop(0, rgb(running ? mix(WATER_DEEP, CONDUIT_LIGHT_MID, 0.35) : WATER_DARK));
  water.addColorStop(1, rgb(running ? WATER_DEEP : WATER_DARK));
  ctx.fillStyle = water;
  ctx.fillRect(box.left, waterTop, box.width, box.bottom - waterTop);
}

function paintFall(
  ctx: Ctx,
  centreX: number,
  halfW: number,
  sillY: number,
  basinTop: number,
  ts: number,
  rng: Rng,
): void {
  const fallHalfW = halfW * 0.78;
  const sheet = ctx.createLinearGradient(0, sillY, 0, basinTop);
  sheet.addColorStop(0, rgba(CONDUIT_LIGHT_MID, 0.75));
  sheet.addColorStop(1, rgba(CONDUIT_LIGHT_CORE, 0.9));
  ctx.fillStyle = sheet;
  ctx.fillRect(centreX - fallHalfW, sillY - ts * 0.04, fallHalfW * 2, basinTop - sillY + ts * 0.06);
  ctx.fillStyle = rgba(CONDUIT_LIGHT_CORE, 0.85);
  for (let i = 0; i < SLUICE_FALL_STREAKS; i++) {
    const streakX = centreX - fallHalfW + (fallHalfW * 2 * (i + 0.5)) / SLUICE_FALL_STREAKS;
    ctx.fillRect(streakX + jitter(rng, ts * 0.02), sillY, hairline(ts, 0.014), basinTop - sillY);
  }
  ctx.strokeStyle = rgba(CONDUIT_LIGHT_CORE, 0.7);
  ctx.lineWidth = hairline(ts, 0.014);
  for (let i = 0; i < SLUICE_RIPPLES; i++) {
    const rippleY = basinTop + ts * (0.12 + i * 0.045);
    const rippleHalfW = fallHalfW * (1.1 + i * 0.28);
    ctx.beginPath();
    ctx.ellipse(centreX, rippleY, rippleHalfW, ts * 0.018, 0, 0, Math.PI);
    ctx.stroke();
  }
}

function paintSluiceGate(
  ctx: Ctx,
  centreX: number,
  mouthHalfW: number,
  top: number,
  height: number,
  ts: number,
  running: boolean,
): void {
  const left = centreX - mouthHalfW;
  const width = mouthHalfW * 2;
  const plankW = width / SLUICE_GATE_PLANKS;
  for (let i = 0; i < SLUICE_GATE_PLANKS; i++) {
    slab(ctx, WALNUT, i % 2 === 0 ? 0.32 : 0.4, left + i * plankW, top, plankW, height, ts);
  }
  litEdge(ctx, WALNUT, left, top, width, ts);
  const iron = ironRamp();
  const strapH = ts * 0.06;
  for (let i = 0; i < SLUICE_GATE_STRAPS; i++) {
    const strapY = top + height * (0.22 + i * 0.5);
    slab(ctx, iron, 0.55, left, strapY, width, strapH, ts);
  }
  if (!running) {
    ctx.fillStyle = rgba(WATER_DARK, 0.7);
    ctx.fillRect(left, top + height * 0.82, width, height * 0.18);
  }
}

function paintChain(
  ctx: Ctx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  ts: number,
): void {
  const length = Math.hypot(toX - fromX, toY - fromY);
  const linkLength = ts * SLUICE_CHAIN_LINK_TILES;
  const links = Math.max(1, Math.round(length / linkLength));
  const iron = ironRamp();
  for (let i = 0; i < links; i++) {
    const t = (i + 0.5) / links;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    ctx.strokeStyle = rgb(sampleRamp(iron, i % 2 === 0 ? 0.75 : 0.5));
    ctx.lineWidth = hairline(ts, 0.016);
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      linkLength * 0.55,
      linkLength * 0.32,
      Math.atan2(toY - fromY, toX - fromX),
      0,
      FULL_TURN,
    );
    ctx.stroke();
  }
}

function paintWindingWheel(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  turn: number,
  ts: number,
): void {
  const iron = ironRamp();
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.55));
  ctx.lineWidth = hairline(ts, 0.035);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.85));
  ctx.lineWidth = hairline(ts, 0.012);
  ctx.beginPath();
  ctx.arc(x, y, radius, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
  ctx.lineWidth = hairline(ts, 0.02);
  for (let i = 0; i < SLUICE_WHEEL_SPOKES; i++) {
    const angle = turn + (FULL_TURN * i) / SLUICE_WHEEL_SPOKES;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    ctx.stroke();
  }
  const crankAngle = turn - Math.PI / 2;
  const crankX = x + Math.cos(crankAngle) * radius;
  const crankY = y + Math.sin(crankAngle) * radius;
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
  ctx.beginPath();
  ctx.arc(crankX, crankY, ts * 0.035, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.beginPath();
  ctx.arc(x, y, ts * 0.045, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.fillRect(x - ts * 0.02, y - ts * 0.025, ts * 0.015, ts * 0.015);
}

// ── Stair portcullis ───────────────────────────────────────────────────────

const PORTCULLIS_JAMB_WIDTH_TILES = 0.3;
/** Height of the jambs' springing line, above the footprint's foot. */
const PORTCULLIS_SPRING_TILES = 1.75;
const PORTCULLIS_HEADER_TOP_TILES = 3.25;
const PORTCULLIS_COURSE_TILES = 0.22;
const PORTCULLIS_BLOCK_TILES = 0.44;
const PORTCULLIS_RING_TILES = 0.18;
const PORTCULLIS_RING_STONES = 9;
const PORTCULLIS_BARS = 6;
const PORTCULLIS_RAILS = 4;
const PORTCULLIS_BAR_WIDTH_TILES = 0.055;
const PORTCULLIS_RAIL_HEIGHT_TILES = 0.05;
const PORTCULLIS_SPIKE_TILES = 0.12;
/** The raised gate hangs with its spikes this high above the foot. */
const PORTCULLIS_RAISED_FOOT_TILES = 1.62;
const PORTCULLIS_PULLEY_RADIUS_TILES = 0.07;

function paintPortcullis(ctx: Ctx, frame: TownPropFrame, rng: Rng, raised: boolean): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = archStoneRamp();
    const jambW = ts * PORTCULLIS_JAMB_WIDTH_TILES;
    const openLeft = box.left + jambW;
    const openRight = box.right - jambW;
    const halfW = (openRight - openLeft) / 2;
    const centreX = box.centreX;
    const springY = box.bottom - ts * PORTCULLIS_SPRING_TILES;
    const headerTop = box.bottom - ts * PORTCULLIS_HEADER_TOP_TILES;
    const crownY = springY - halfW;

    const gateTop = crownY - ts * 0.05;
    const gateFoot = raised ? box.bottom - ts * PORTCULLIS_RAISED_FOOT_TILES : box.bottom;
    const gateHeight = gateFoot - gateTop;

    ctx.save();
    traceArchOpening(ctx, centreX, halfW, springY, box.bottom);
    ctx.clip();
    if (raised) {
      ctx.fillStyle = rgba(CULVERT_DARK, 0.85);
      ctx.fillRect(openLeft, crownY - ts * 0.1, halfW * 2, gateFoot - crownY + ts * 0.1);
    }
    paintGrille(ctx, openLeft, halfW * 2, gateTop, gateHeight, ts);
    ctx.restore();

    for (const left of [box.left, openRight]) {
      paintMasonry(
        ctx,
        left,
        headerTop,
        jambW,
        box.bottom - headerTop,
        stone,
        PORTCULLIS_COURSE_TILES,
        PORTCULLIS_JAMB_WIDTH_TILES,
        ts,
        rng,
      );
      inkRect(ctx, left, headerTop, jambW, box.bottom - headerTop, ts);
    }
    const spandrelTop = headerTop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(openLeft, spandrelTop, halfW * 2, springY - spandrelTop);
    ctx.moveTo(centreX + halfW, springY);
    ctx.arc(centreX, springY, halfW, 0, Math.PI, true);
    ctx.closePath();
    ctx.clip('evenodd');
    paintMasonry(
      ctx,
      openLeft,
      spandrelTop,
      halfW * 2,
      springY - spandrelTop,
      stone,
      PORTCULLIS_COURSE_TILES,
      PORTCULLIS_BLOCK_TILES,
      ts,
      rng,
    );
    ctx.restore();
    const ringW = ts * PORTCULLIS_RING_TILES;
    for (let i = 0; i < PORTCULLIS_RING_STONES; i++) {
      const start = Math.PI + (Math.PI * i) / PORTCULLIS_RING_STONES;
      const end = Math.PI + (Math.PI * (i + 1)) / PORTCULLIS_RING_STONES;
      const isKeystone = i === Math.floor(PORTCULLIS_RING_STONES / 2);
      ctx.beginPath();
      ctx.arc(centreX, springY, halfW + ringW * (isKeystone ? 1.35 : 1), start, end);
      ctx.arc(centreX, springY, halfW, end, start, true);
      ctx.closePath();
      ctx.fillStyle = rgb(sampleRamp(stone, (isKeystone ? 0.8 : 0.62) + jitter(rng, 0.08)));
      ctx.fill();
      inkOutline(ctx, ts);
    }
    inkRect(ctx, box.left, headerTop, box.width, box.bottom - headerTop, ts);
    litEdge(ctx, stone, box.left, headerTop, box.width, ts);

    const pulleyY = headerTop + ts * 0.16;
    const iron = ironRamp();
    for (const side of [-1, 1]) {
      const pulleyX = centreX + side * halfW * 0.72;
      const chainFootY = raised
        ? gateFoot - ts * PORTCULLIS_SPIKE_TILES - ts * 0.04
        : crownY + ts * 0.08;
      if (raised) {
        paintChain(ctx, pulleyX, pulleyY, pulleyX, chainFootY, ts);
      } else {
        paintChain(ctx, pulleyX, pulleyY, pulleyX, Math.min(chainFootY, springY - halfW * 0.6), ts);
      }
      ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
      ctx.beginPath();
      ctx.arc(pulleyX, pulleyY, ts * PORTCULLIS_PULLEY_RADIUS_TILES, 0, FULL_TURN);
      ctx.fill();
      inkOutline(ctx, ts);
    }
  });
}

/** Iron bars with riveted cross rails, spiked at the foot; the gaps stay clear. */
function paintGrille(
  ctx: Ctx,
  left: number,
  width: number,
  top: number,
  height: number,
  ts: number,
): void {
  const iron = ironRamp();
  const barW = ts * PORTCULLIS_BAR_WIDTH_TILES;
  const spikeH = ts * PORTCULLIS_SPIKE_TILES;
  const foot = top + height;
  const railH = ts * PORTCULLIS_RAIL_HEIGHT_TILES;
  for (let r = 0; r < PORTCULLIS_RAILS; r++) {
    const railY = foot - spikeH - ts * 0.18 - r * ((height - spikeH) / PORTCULLIS_RAILS);
    slab(ctx, iron, 0.45, left, railY, width, railH, ts);
  }
  for (let b = 0; b < PORTCULLIS_BARS; b++) {
    const barX = left + (width * (b + 0.5)) / PORTCULLIS_BARS - barW / 2;
    slab(ctx, iron, 0.5, barX, top, barW, height - spikeH, ts);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.9));
    ctx.fillRect(barX + barW * 0.2, top, hairline(ts, 0.012), height - spikeH);
    ctx.beginPath();
    ctx.moveTo(barX - barW * 0.2, foot - spikeH);
    ctx.lineTo(barX + barW * 1.2, foot - spikeH);
    ctx.lineTo(barX + barW / 2, foot);
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.6));
    ctx.fill();
    inkOutline(ctx, ts);
  }
}

/** An iron portcullis dropped in a stone arch at the stair block's south face; the stair shows through the bars. */
export function paintStairPortcullis(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  paintPortcullis(ctx, frame, rng, false);
}

/** The same arch with the gate hauled up into its head on taut chains, the stair open beneath. */
export function paintStairPortcullisRaised(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  paintPortcullis(ctx, frame, rng, true);
}

// ── Cattery cage ───────────────────────────────────────────────────────────

const CAGE_OPEN_VARIANT = 1;
const CAGE_INSET_TILES = 0.05;
const CAGE_FOOT_LIFT_TILES = 0.03;
/** Height of the cage's front face above its tray. */
const CAGE_FRONT_HEIGHT_TILES = 0.78;
/** How far up the back face sits from the front: the cage's depth seen from above. */
const CAGE_DEPTH_TILES = 0.34;
const CAGE_TRAY_HEIGHT_TILES = 0.1;
const CAGE_FRONT_BARS = 7;
const CAGE_BACK_BARS = 9;
const CAGE_BAR_TILES = 0.022;
const CAGE_FRAME_TILES = 0.036;
const CAGE_BAR_CORE_FRACTION = 0.5;
const CAGE_BAR_GLINT_FRACTION = 0.35;
const CAGE_BAR_GLINT_OFFSET = 0.25;
/** Ramp stops per face: the back is in the cage's own shadow, the front catches the room's light. */
const CAGE_BACK_BAR_STOP = 0.2;
const CAGE_TOP_BAR_STOP = 0.5;
const CAGE_FRONT_BAR_STOP = 0.75;
const CAGE_DOOR_BAR_STOP = 0.9;
const CAGE_TOP_SHADE_ALPHA = 0.18;
const CAGE_SHADOW_ALPHA = 0.35;
const CAGE_DOOR_LEFT_FRACTION = 0.2;
const CAGE_DOOR_RIGHT_FRACTION = 0.8;
const CAGE_DOOR_TOP_FRACTION = 0.14;
const CAGE_DOOR_BARS = 4;
/** A swung-open door is seen nearly edge-on, so its free edge lands this far back past the hinge. */
const CAGE_OPEN_DOOR_REACH_FRACTION = 0.5;
/** An open door swings toward the viewer, so its far edge drops this much. */
const CAGE_OPEN_DOOR_DROP_TILES = 0.07;
const CAGE_HINGE_KNUCKLE_TILES = 0.05;
const CAGE_LATCH_WIDTH_TILES = 0.1;
const CAGE_LATCH_HEIGHT_TILES = 0.06;
const CAGE_CARRY_RING_TILES = 0.05;
const CAGE_STRAW_TUFTS = 22;

/**
 * A wrought-iron cat cage against the wall: a barred box on a walnut tray,
 * straw and a water dish on its floor and its middle left empty for the cat
 * another system draws inside. Variant 0 is latched, 1 has the door swung
 * wide on its left hinge.
 */
export function paintCatteryCage(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const open = variant === CAGE_OPEN_VARIANT;
    const iron = ironRamp();
    const inset = ts * CAGE_INSET_TILES;
    const left = box.left + inset;
    const right = box.right - inset;
    const width = right - left;
    const trayH = ts * CAGE_TRAY_HEIGHT_TILES;
    const trayFoot = box.bottom - ts * CAGE_FOOT_LIFT_TILES;
    const frontFoot = trayFoot - trayH;
    const frontTop = frontFoot - ts * CAGE_FRONT_HEIGHT_TILES;
    const depth = ts * CAGE_DEPTH_TILES;
    const backFoot = frontFoot - depth;
    const backTop = frontTop - depth;
    const barWeight = hairline(ts, CAGE_BAR_TILES);
    const frameWeight = hairline(ts, CAGE_FRAME_TILES);

    bandShadow(ctx, box, ts, CAGE_SHADOW_ALPHA);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.22));
    ctx.fillRect(left, backFoot, width, frontFoot - backFoot);
    paintStraw(ctx, left, right, backFoot, frontFoot, ts, rng);
    paintWaterDish(ctx, right - width * 0.22, frontFoot - depth * 0.3, ts);

    for (let i = 0; i <= CAGE_BACK_BARS; i++) {
      const x = left + (width * i) / CAGE_BACK_BARS;
      ironBar(ctx, iron, x, backFoot, x, backTop, barWeight, CAGE_BACK_BAR_STOP);
    }
    ironBar(ctx, iron, left, backTop, right, backTop, frameWeight, CAGE_BACK_BAR_STOP);
    ironBar(ctx, iron, left, backFoot, right, backFoot, frameWeight, CAGE_BACK_BAR_STOP);

    ctx.fillStyle = rgba(sampleRamp(iron, 0), CAGE_TOP_SHADE_ALPHA);
    ctx.fillRect(left, backTop, width, frontTop - backTop);
    for (let i = 1; i < CAGE_FRONT_BARS; i++) {
      const x = left + (width * i) / CAGE_FRONT_BARS;
      ironBar(ctx, iron, x, frontTop, x, backTop, barWeight, CAGE_TOP_BAR_STOP);
    }
    for (const x of [left, right]) {
      ironBar(ctx, iron, x, frontTop, x, backTop, frameWeight, CAGE_TOP_BAR_STOP);
      ironBar(ctx, iron, x, frontFoot, x, backFoot, frameWeight, CAGE_BACK_BAR_STOP);
    }

    slab(ctx, WALNUT, 0.45, left, frontFoot, width, trayH, ts);
    litEdge(ctx, WALNUT, left, frontFoot, width, ts);

    const doorLeft = left + width * CAGE_DOOR_LEFT_FRACTION;
    const doorRight = left + width * CAGE_DOOR_RIGHT_FRACTION;
    const doorTop = frontTop + (frontFoot - frontTop) * CAGE_DOOR_TOP_FRACTION;
    for (let i = 1; i < CAGE_FRONT_BARS; i++) {
      const x = left + (width * i) / CAGE_FRONT_BARS;
      const inDoorway = x > doorLeft && x < doorRight;
      ironBar(
        ctx,
        iron,
        x,
        frontTop,
        x,
        inDoorway ? doorTop : frontFoot,
        barWeight,
        CAGE_FRONT_BAR_STOP,
      );
    }
    for (const x of [left, right]) {
      ironBar(ctx, iron, x, frontTop, x, frontFoot, frameWeight, CAGE_FRONT_BAR_STOP);
    }
    for (const y of [frontTop, doorTop]) {
      ironBar(ctx, iron, left, y, right, y, frameWeight, CAGE_FRONT_BAR_STOP);
    }

    const doorW = doorRight - doorLeft;
    if (open) {
      const swungReach = -doorW * CAGE_OPEN_DOOR_REACH_FRACTION;
      const drop = ts * CAGE_OPEN_DOOR_DROP_TILES;
      paintCageDoor(ctx, doorLeft, doorTop, frontFoot, swungReach, drop, ts);
    } else {
      paintCageDoor(ctx, doorLeft, doorTop, frontFoot, doorW, 0, ts);
      paintCageLatch(ctx, doorRight, (doorTop + frontFoot) / 2, ts);
    }
    const ringRadius = ts * CAGE_CARRY_RING_TILES;
    ctx.strokeStyle = rgb(iron.accent);
    ctx.lineWidth = frameWeight;
    ctx.beginPath();
    ctx.arc(box.centreX, backTop - ringRadius, ringRadius, 0, FULL_TURN);
    ctx.stroke();
  });
}

/** A wrought bar: a black core with a lit hairline down one side, so it reads on a dark wall. */
function ironBar(
  ctx: Ctx,
  iron: Ramp,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  weight: number,
  stop: number,
): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(sampleRamp(iron, stop * CAGE_BAR_CORE_FRACTION));
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = rgb(mix(sampleRamp(iron, 1), iron.accent, stop));
  ctx.lineWidth = Math.max(1, weight * CAGE_BAR_GLINT_FRACTION);
  ctx.beginPath();
  ctx.moveTo(x1 - weight * CAGE_BAR_GLINT_OFFSET, y1);
  ctx.lineTo(x2 - weight * CAGE_BAR_GLINT_OFFSET, y2);
  ctx.stroke();
}

/**
 * The cage door as a barred panel hinged at `hingeX`. `reach` is how far its
 * free edge sits from the hinge on screen (negative when swung back past the
 * hinge) and `drop` how far that edge falls toward the viewer.
 */
function paintCageDoor(
  ctx: Ctx,
  hingeX: number,
  top: number,
  foot: number,
  reach: number,
  drop: number,
  ts: number,
): void {
  const iron = ironRamp();
  const barWeight = hairline(ts, CAGE_BAR_TILES);
  const frameWeight = hairline(ts, CAGE_FRAME_TILES);
  for (let i = 1; i < CAGE_DOOR_BARS; i++) {
    const t = i / CAGE_DOOR_BARS;
    const x = hingeX + reach * t;
    ironBar(ctx, iron, x, top + drop * t, x, foot + drop * t, barWeight, CAGE_DOOR_BAR_STOP);
  }
  const freeX = hingeX + reach;
  ironBar(ctx, iron, hingeX, top, hingeX, foot, frameWeight, CAGE_DOOR_BAR_STOP);
  ironBar(ctx, iron, freeX, top + drop, freeX, foot + drop, frameWeight, CAGE_DOOR_BAR_STOP);
  for (const y of [top, (top + foot) / 2, foot]) {
    ironBar(ctx, iron, hingeX, y, freeX, y + drop, frameWeight, CAGE_DOOR_BAR_STOP);
  }
  ctx.fillStyle = rgb(BRASS_DIM);
  const knuckle = ts * CAGE_HINGE_KNUCKLE_TILES;
  for (const y of [top + (foot - top) * 0.18, foot - (foot - top) * 0.18]) {
    ctx.fillRect(hingeX - knuckle / 2, y - knuckle / 2, knuckle, knuckle);
  }
}

function paintCageLatch(ctx: Ctx, x: number, y: number, ts: number): void {
  const latchW = ts * CAGE_LATCH_WIDTH_TILES;
  const latchH = ts * CAGE_LATCH_HEIGHT_TILES;
  const latchLeft = x - latchW / 2;
  const latchTop = y - latchH / 2;
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.fillRect(latchLeft, latchTop, latchW, latchH);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.fillRect(latchLeft, latchTop, latchW, hairline(ts, 0.014));
  inkRect(ctx, latchLeft, latchTop, latchW, latchH, ts);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.arc(x + latchW / 2, y, latchH * 0.4, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
}

function paintStraw(
  ctx: Ctx,
  left: number,
  right: number,
  backY: number,
  frontY: number,
  ts: number,
  rng: Rng,
): void {
  ctx.lineWidth = hairline(ts, 0.014);
  for (let i = 0; i < CAGE_STRAW_TUFTS; i++) {
    const x = left + (right - left) * rng();
    const y = backY + (frontY - backY) * rng();
    const angle = jitter(rng, 1.2);
    const length = ts * (0.06 + rng() * 0.06);
    ctx.strokeStyle = rgb(rng() < 0.5 ? STRAW : STRAW_SHADE);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length * 0.4);
    ctx.stroke();
  }
}

function paintWaterDish(ctx: Ctx, x: number, y: number, ts: number): void {
  const radiusX = ts * 0.09;
  const radiusY = ts * 0.035;
  ctx.fillStyle = rgb(DISH_GLAZE);
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, 0, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(WATER_DEEP);
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX * 0.72, radiusY * 0.6, 0, 0, FULL_TURN);
  ctx.fill();
}

// ── Ritual circle ──────────────────────────────────────────────────────────

const RITUAL_LIT_VARIANT = 1;
const RITUAL_STATIONS = 9;
/** The star's step round the nine stations: every fourth, so the lines cross into a nine-pointed star. */
const RITUAL_STAR_STEP = 4;
const RITUAL_OUTER_RADIUS_FRACTION = 0.46;
const RITUAL_INNER_RADIUS_FRACTION = 0.38;
const RITUAL_STATION_RADIUS_TILES = 0.13;
const RITUAL_GLYPHS_PER_ARC = 2;
const RITUAL_GLYPH_STROKES = 3;
const RITUAL_GLYPH_SIZE_TILES = 0.09;
/** Fixed so both variants carry the same glyphs: the seed a variant paints with differs between them. */
const RITUAL_GLYPH_SEED = 0x5ca7c1;
const RITUAL_DARK_ALPHA = 0.34;
const RITUAL_LIT_ALPHA = 0.8;
const RITUAL_LIT_HALO_ALPHA = 0.16;

/**
 * A binding circle chalked and inlaid into the boards: two rings, nine
 * stations evenly round the rim, a nine-pointed star between them and sigils
 * in the band. Variant 0 is cold chalk; variant 1 glows violet-white. Both stay
 * thin lines on the floor so the room's boards still read through.
 */
export function paintRitualCircle(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const lit = variant === RITUAL_LIT_VARIANT;
    const centreX = box.centreX;
    const centreY = (box.top + box.bottom) / 2;
    const size = Math.min(box.width, box.height);
    const outer = size * RITUAL_OUTER_RADIUS_FRACTION;
    const inner = size * RITUAL_INNER_RADIUS_FRACTION;

    if (lit) {
      glow(ctx, centreX, centreY, outer * 1.08, WARD_MID, RITUAL_LIT_HALO_ALPHA);
      ctx.save();
      ctx.shadowColor = rgba(WARD_MID, 0.9);
      ctx.shadowBlur = ts * 0.12;
      strokeCircleFigure(
        ctx,
        centreX,
        centreY,
        outer,
        inner,
        ts,
        rgba(WARD_CORE, RITUAL_LIT_ALPHA),
      );
      ctx.restore();
    } else {
      strokeCircleFigure(
        ctx,
        centreX,
        centreY,
        outer,
        inner,
        ts,
        rgba(CHALK_DULL, RITUAL_DARK_ALPHA),
      );
    }
  });
}

function strokeCircleFigure(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  outer: number,
  inner: number,
  ts: number,
  ink: string,
): void {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = hairline(ts, 0.035);
  for (const radius of [outer, inner]) {
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
    ctx.stroke();
  }

  const stationAngle = (i: number): number => -Math.PI / 2 + (FULL_TURN * i) / RITUAL_STATIONS;
  ctx.lineWidth = hairline(ts, 0.025);
  ctx.beginPath();
  for (let i = 0; i <= RITUAL_STATIONS; i++) {
    const angle = stationAngle((i * RITUAL_STAR_STEP) % RITUAL_STATIONS);
    const x = centreX + Math.cos(angle) * inner;
    const y = centreY + Math.sin(angle) * inner;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const stationR = ts * RITUAL_STATION_RADIUS_TILES;
  const rimRadius = (outer + inner) / 2;
  for (let i = 0; i < RITUAL_STATIONS; i++) {
    const angle = stationAngle(i);
    const x = centreX + Math.cos(angle) * rimRadius;
    const y = centreY + Math.sin(angle) * rimRadius;
    ctx.lineWidth = hairline(ts, 0.03);
    ctx.beginPath();
    ctx.arc(x, y, stationR, 0, FULL_TURN);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, stationR * 0.3, 0, FULL_TURN);
    ctx.fill();
  }

  const glyphRng = mulberry32(RITUAL_GLYPH_SEED);
  const glyphSize = ts * RITUAL_GLYPH_SIZE_TILES;
  ctx.lineWidth = hairline(ts, 0.018);
  for (let i = 0; i < RITUAL_STATIONS; i++) {
    for (let g = 0; g < RITUAL_GLYPHS_PER_ARC; g++) {
      const angle = stationAngle(i + (g + 1) / (RITUAL_GLYPHS_PER_ARC + 1));
      const x = centreX + Math.cos(angle) * rimRadius;
      const y = centreY + Math.sin(angle) * rimRadius;
      strokeGlyph(ctx, x, y, glyphSize, glyphRng);
    }
  }
}

/** A sigil: a few short strokes between points of a small grid, so each reads as a letter, not a scribble. */
function strokeGlyph(ctx: Ctx, x: number, y: number, size: number, rng: Rng): void {
  const gridPoint = (): readonly [number, number] => [
    x + (Math.floor(rng() * 3) - 1) * size,
    y + (Math.floor(rng() * 3) - 1) * size,
  ];
  ctx.beginPath();
  for (let s = 0; s < RITUAL_GLYPH_STROKES; s++) {
    const [fromX, fromY] = gridPoint();
    const [toX, toY] = gridPoint();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
  }
  ctx.stroke();
}

// ── Binding pillar ─────────────────────────────────────────────────────────

const PILLAR_LIT_VARIANT = 1;
const PILLAR_BROKEN_VARIANT = 2;
const PILLAR_FOOT_LIFT_TILES = 0.14;
const PILLAR_HEIGHT_TILES = 1.35;
const PILLAR_SHAFT_WIDTH_TILES = 0.46;
const PILLAR_PLINTH_WIDTH_TILES = 0.7;
const PILLAR_PLINTH_HEIGHT_TILES = 0.16;
const PILLAR_CAP_HEIGHT_TILES = 0.12;
const PILLAR_BAND_HEIGHT_TILES = 0.09;
/** The iron band sits low, where a short tether reaches a cat. */
const PILLAR_BAND_HEIGHT_FRACTION = 0.42;
const PILLAR_RING_RADIUS_TILES = 0.12;
const PILLAR_GROOVE_ZIGS = 5;
const PILLAR_LIT_GLOW_ALPHA = 0.5;

/**
 * A short carved stone pillar with an iron band and a ring for a cat's
 * tether. A zigzag groove runs up its face; in variant 1 ward light runs up
 * the groove and haloes the stone. Variant 2 is the pillar shattered: a
 * stump on its plinth with the rest of it lying round its foot.
 */
export function paintBindingPillar(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  if (variant === PILLAR_BROKEN_VARIANT) {
    paintBrokenBindingPillar(ctx, frame, rng);
    return;
  }
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const lit = variant === PILLAR_LIT_VARIANT;
    const stone = CARVED_STONE;
    const iron = ironRamp();
    const foot = box.bottom - ts * PILLAR_FOOT_LIFT_TILES;
    const top = foot - ts * PILLAR_HEIGHT_TILES;
    const shaftW = ts * PILLAR_SHAFT_WIDTH_TILES;
    const shaftLeft = box.centreX - shaftW / 2;
    const plinthW = ts * PILLAR_PLINTH_WIDTH_TILES;
    const plinthH = ts * PILLAR_PLINTH_HEIGHT_TILES;
    const capH = ts * PILLAR_CAP_HEIGHT_TILES;

    drawTownContactShadow(ctx, box.centreX, foot, plinthW * 0.62, ts * 0.12, 0.45);
    if (lit) glow(ctx, box.centreX, (top + foot) / 2, ts * 0.62, WARD_MID, PILLAR_LIT_GLOW_ALPHA);

    slab(ctx, stone, 0.4, box.centreX - plinthW / 2, foot - plinthH, plinthW, plinthH, ts);
    litEdge(ctx, stone, box.centreX - plinthW / 2, foot - plinthH, plinthW, ts);
    const shaftTop = top + capH;
    const shaftFoot = foot - plinthH;
    const shaft = ctx.createLinearGradient(shaftLeft, 0, shaftLeft + shaftW, 0);
    shaft.addColorStop(0, rgb(sampleRamp(stone, 0.72)));
    shaft.addColorStop(1, rgb(sampleRamp(stone, 0.32)));
    ctx.fillStyle = shaft;
    ctx.fillRect(shaftLeft, shaftTop, shaftW, shaftFoot - shaftTop);
    inkRect(ctx, shaftLeft, shaftTop, shaftW, shaftFoot - shaftTop, ts);
    ctx.fillStyle = rgba(sampleRamp(stone, 0.15), 0.5);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(
        shaftLeft + shaftW * (0.15 + rng() * 0.6),
        shaftTop + (shaftFoot - shaftTop) * rng(),
        hairline(ts, 0.02),
        hairline(ts, 0.02),
      );
    }

    const grooveTop = shaftTop + ts * 0.06;
    const grooveFoot = shaftFoot - ts * 0.06;
    ctx.beginPath();
    for (let i = 0; i <= PILLAR_GROOVE_ZIGS; i++) {
      const y = grooveFoot - ((grooveFoot - grooveTop) * i) / PILLAR_GROOVE_ZIGS;
      const x = box.centreX + (i % 2 === 0 ? -1 : 1) * shaftW * 0.24;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lit) {
      ctx.save();
      ctx.shadowColor = rgba(WARD_MID, 0.95);
      ctx.shadowBlur = ts * 0.1;
      ctx.strokeStyle = rgb(WARD_EDGE);
      ctx.lineWidth = hairline(ts, 0.07);
      ctx.stroke();
      ctx.strokeStyle = rgb(WARD_CORE);
      ctx.lineWidth = hairline(ts, 0.035);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = rgb(sampleRamp(stone, 0.08));
      ctx.lineWidth = hairline(ts, 0.05);
      ctx.stroke();
      ctx.strokeStyle = rgba(sampleRamp(stone, 0.85), 0.5);
      ctx.lineWidth = hairline(ts, 0.012);
      ctx.save();
      ctx.translate(0, hairline(ts, 0.025));
      ctx.stroke();
      ctx.restore();
    }

    slab(ctx, stone, 0.6, box.centreX - plinthW * 0.42, top, plinthW * 0.84, capH, ts);
    litEdge(ctx, stone, box.centreX - plinthW * 0.42, top, plinthW * 0.84, ts);

    const bandH = ts * PILLAR_BAND_HEIGHT_TILES;
    const bandY = shaftFoot - (shaftFoot - shaftTop) * PILLAR_BAND_HEIGHT_FRACTION;
    slab(ctx, iron, 0.5, shaftLeft - ts * 0.02, bandY, shaftW + ts * 0.04, bandH, ts);
    litEdge(ctx, iron, shaftLeft - ts * 0.02, bandY, shaftW + ts * 0.04, ts);
    const ringR = ts * PILLAR_RING_RADIUS_TILES;
    const ringY = bandY + bandH + ringR * 0.9;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.6));
    ctx.lineWidth = hairline(ts, 0.03);
    ctx.beginPath();
    ctx.arc(box.centreX, ringY, ringR, 0, FULL_TURN);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.95));
    ctx.lineWidth = hairline(ts, 0.01);
    ctx.beginPath();
    ctx.arc(box.centreX, ringY, ringR, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.7));
    ctx.fillRect(box.centreX - ts * 0.025, bandY + bandH * 0.5, ts * 0.05, ringR * 0.5);
  });
}

// ── Broken binding pillar ──────────────────────────────────────────────────

/** The stump stands this share of the shaft above the plinth; the rest lies round it. */
const STUMP_HEIGHT_FRACTION = 0.3;
const STUMP_BREAK_POINTS = 6;
const STUMP_BREAK_JAG_TILES = 0.05;
/** The break falls away from one side to the other, the way a shaft struck from one side fails. */
const STUMP_BREAK_SLOPE_TILES = 0.1;
/** How much of the broken top shows above the front edge, seen from above. */
const STUMP_FACE_DEPTH_TILES = 0.07;
const STUMP_FACE_TONE = 0.82;
const STUMP_FACE_PITS = 3;
const BROKEN_SHADOW_ALPHA = 0.4;
const BROKEN_SHADOW_WIDTH_SHARE = 0.75;
const RUBBLE_CHUNK_SIDES = 6;
const RUBBLE_CHUNK_JITTER = 0.3;

/**
 * One piece of the fallen pillar on the floor, from the pillar's centre at
 * its foot, in tiles: + is east and south. Placed by hand rather than
 * scattered, so the heap reads as a pillar that fell and not as gravel.
 */
interface RubblePiece {
  readonly dx: number;
  readonly dy: number;
  readonly radius: number;
  readonly squash: number;
  readonly tone: number;
}

/** The pieces behind the stump, drawn before it. */
const RUBBLE_BEHIND: readonly RubblePiece[] = [
  { dx: -0.36, dy: -0.05, radius: 0.07, squash: 0.65, tone: 0.45 },
  { dx: 0.33, dy: -0.04, radius: 0.06, squash: 0.7, tone: 0.5 },
];
/** The pieces in front of it. */
const RUBBLE_FRONT: readonly RubblePiece[] = [
  { dx: 0.25, dy: 0.06, radius: 0.08, squash: 0.62, tone: 0.55 },
  { dx: -0.06, dy: 0.1, radius: 0.05, squash: 0.7, tone: 0.6 },
  { dx: 0.4, dy: 0.1, radius: 0.045, squash: 0.75, tone: 0.48 },
  { dx: -0.42, dy: 0.08, radius: 0.04, squash: 0.75, tone: 0.52 },
];

/** The biggest piece: a length of the shaft, groove and all, lying across the floor in front. */
const FALLEN_SHAFT = { dx: -0.2, dy: 0.06, length: 0.36, angle: -0.22 } as const;
/** The snapped iron band, a half hoop lying flat beside the stump. */
const FALLEN_BAND = { dx: 0.16, dy: 0.1, radiusX: 0.13, radiusY: 0.045 } as const;
const FALLEN_BAND_FROM = Math.PI * 0.05;
const FALLEN_BAND_TO = Math.PI * 1.05;
const GRIT_SPECKS = 14;
const GRIT_SPREAD_X_TILES = 0.46;
const GRIT_FROM_TILES = -0.06;
const GRIT_TO_TILES = 0.12;
const GRIT_ALPHA = 0.55;

/** The broken pillar: its plinth and a jagged stump of the shaft, the rest of it in pieces round its foot. */
function paintBrokenBindingPillar(ctx: Ctx, frame: TownPropFrame, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = CARVED_STONE;
    const foot = box.bottom - ts * PILLAR_FOOT_LIFT_TILES;
    const top = foot - ts * PILLAR_HEIGHT_TILES;
    const shaftW = ts * PILLAR_SHAFT_WIDTH_TILES;
    const shaftLeft = box.centreX - shaftW / 2;
    const plinthW = ts * PILLAR_PLINTH_WIDTH_TILES;
    const plinthH = ts * PILLAR_PLINTH_HEIGHT_TILES;
    const shaftTop = top + ts * PILLAR_CAP_HEIGHT_TILES;
    const shaftFoot = foot - plinthH;
    const stumpTop = shaftFoot - (shaftFoot - shaftTop) * STUMP_HEIGHT_FRACTION;

    drawTownContactShadow(
      ctx,
      box.centreX,
      foot,
      box.width * BROKEN_SHADOW_WIDTH_SHARE * 0.5,
      ts * 0.12,
      BROKEN_SHADOW_ALPHA,
    );
    paintGrit(ctx, box.centreX, foot, ts, rng);
    for (const piece of RUBBLE_BEHIND) paintRubblePiece(ctx, box.centreX, foot, ts, piece, rng);

    slab(ctx, stone, 0.4, box.centreX - plinthW / 2, foot - plinthH, plinthW, plinthH, ts);
    litEdge(ctx, stone, box.centreX - plinthW / 2, foot - plinthH, plinthW, ts);

    const breakLine: Array<readonly [number, number]> = [];
    for (let i = 0; i < STUMP_BREAK_POINTS; i++) {
      const across = i / (STUMP_BREAK_POINTS - 1);
      const slope = (across - 0.5) * ts * STUMP_BREAK_SLOPE_TILES;
      const jag = (rng() - 0.5) * 2 * ts * STUMP_BREAK_JAG_TILES;
      breakLine.push([shaftLeft + shaftW * across, stumpTop + slope + jag]);
    }

    const traceStump = (): void => {
      ctx.beginPath();
      ctx.moveTo(shaftLeft, shaftFoot);
      for (const [x, y] of breakLine) ctx.lineTo(x, y);
      ctx.lineTo(shaftLeft + shaftW, shaftFoot);
      ctx.closePath();
    };
    const shaft = ctx.createLinearGradient(shaftLeft, 0, shaftLeft + shaftW, 0);
    shaft.addColorStop(0, rgb(sampleRamp(stone, 0.72)));
    shaft.addColorStop(1, rgb(sampleRamp(stone, 0.32)));
    traceStump();
    ctx.fillStyle = shaft;
    ctx.fill();
    ctx.save();
    traceStump();
    ctx.clip();
    strokeDeadGroove(ctx, box.centreX, shaftW, stumpTop, shaftFoot - ts * 0.06, ts, stone);
    ctx.restore();
    traceStump();
    inkOutline(ctx, ts);

    const faceDepth = ts * STUMP_FACE_DEPTH_TILES;
    ctx.beginPath();
    breakLine.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    for (let i = breakLine.length - 1; i >= 0; i--) {
      const [x, y] = breakLine[i];
      ctx.lineTo(x, y - faceDepth * (0.6 + rng() * 0.4));
    }
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(stone, STUMP_FACE_TONE));
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(stone, 0.2), 0.7);
    for (let i = 0; i < STUMP_FACE_PITS; i++) {
      const [x, y] = breakLine[1 + Math.floor(rng() * (breakLine.length - 2))];
      ctx.fillRect(x, y - faceDepth * 0.55, hairline(ts, 0.025), hairline(ts, 0.02));
    }

    paintFallenShaft(ctx, box.centreX, foot, ts, shaftW, stone);
    for (const piece of RUBBLE_FRONT) paintRubblePiece(ctx, box.centreX, foot, ts, piece, rng);
    paintFallenBand(ctx, box.centreX, foot, ts);
  });
}

/** The groove's dark cut up the stump's face, as the dormant pillar carries it. */
function strokeDeadGroove(
  ctx: Ctx,
  centreX: number,
  shaftW: number,
  grooveTop: number,
  grooveFoot: number,
  ts: number,
  stone: Ramp,
): void {
  const zigHeight = (grooveFoot - grooveTop) / (PILLAR_GROOVE_ZIGS * STUMP_HEIGHT_FRACTION);
  ctx.beginPath();
  for (let i = 0; i <= PILLAR_GROOVE_ZIGS; i++) {
    const y = grooveFoot - zigHeight * i;
    const x = centreX + (i % 2 === 0 ? -1 : 1) * shaftW * 0.24;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgb(sampleRamp(stone, 0.08));
  ctx.lineWidth = hairline(ts, 0.05);
  ctx.stroke();
}

/** A lump of carved stone lying on the floor: an irregular flattened polygon, lit on its upper edge. */
function paintRubblePiece(
  ctx: Ctx,
  centreX: number,
  foot: number,
  ts: number,
  piece: RubblePiece,
  rng: Rng,
): void {
  const x = centreX + piece.dx * ts;
  const y = foot + piece.dy * ts;
  const radius = piece.radius * ts;
  ctx.beginPath();
  for (let i = 0; i < RUBBLE_CHUNK_SIDES; i++) {
    const angle = (FULL_TURN * i) / RUBBLE_CHUNK_SIDES + rng() * RUBBLE_CHUNK_JITTER;
    const reach = radius * (1 - RUBBLE_CHUNK_JITTER * 0.5 + rng() * RUBBLE_CHUNK_JITTER);
    const px = x + Math.cos(angle) * reach;
    const py = y + Math.sin(angle) * reach * piece.squash;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const shade = ctx.createLinearGradient(0, y - radius, 0, y + radius * piece.squash);
  shade.addColorStop(0, rgb(sampleRamp(CARVED_STONE, piece.tone + 0.25)));
  shade.addColorStop(1, rgb(sampleRamp(CARVED_STONE, piece.tone - 0.2)));
  ctx.fillStyle = shade;
  ctx.fill();
  inkOutline(ctx, ts);
}

/** A length of the broken shaft lying on its side, the groove's zigzag still cut along it. */
function paintFallenShaft(
  ctx: Ctx,
  centreX: number,
  foot: number,
  ts: number,
  shaftW: number,
  stone: Ramp,
): void {
  const length = FALLEN_SHAFT.length * ts;
  const thickness = shaftW * 0.5;
  ctx.save();
  ctx.translate(centreX + FALLEN_SHAFT.dx * ts, foot + FALLEN_SHAFT.dy * ts);
  ctx.rotate(FALLEN_SHAFT.angle);
  const body = ctx.createLinearGradient(0, -thickness / 2, 0, thickness / 2);
  body.addColorStop(0, rgb(sampleRamp(stone, 0.78)));
  body.addColorStop(1, rgb(sampleRamp(stone, 0.3)));
  ctx.beginPath();
  ctx.rect(-length / 2, -thickness / 2, length, thickness);
  ctx.fillStyle = body;
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.beginPath();
  ctx.ellipse(length / 2, 0, thickness * 0.22, thickness / 2, 0, 0, FULL_TURN);
  ctx.fillStyle = rgb(sampleRamp(stone, STUMP_FACE_TONE));
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.beginPath();
  const zigs = 3;
  for (let i = 0; i <= zigs; i++) {
    const x = -length / 2 + (length * 0.8 * i) / zigs + length * 0.05;
    const y = (i % 2 === 0 ? -1 : 1) * thickness * 0.2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgb(sampleRamp(stone, 0.08));
  ctx.lineWidth = hairline(ts, 0.035);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** The iron band, snapped open and lying flat beside the stump, with the tether ring still on it. */
function paintFallenBand(ctx: Ctx, centreX: number, foot: number, ts: number): void {
  const iron = ironRamp();
  const x = centreX + FALLEN_BAND.dx * ts;
  const y = foot + FALLEN_BAND.dy * ts;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    FALLEN_BAND.radiusX * ts,
    FALLEN_BAND.radiusY * ts,
    0,
    FALLEN_BAND_FROM,
    FALLEN_BAND_TO,
  );
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.15));
  ctx.lineWidth = hairline(ts, 0.07);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.6));
  ctx.lineWidth = hairline(ts, 0.035);
  ctx.stroke();
  const ringR = ts * PILLAR_RING_RADIUS_TILES * 0.7;
  ctx.beginPath();
  ctx.ellipse(
    x - FALLEN_BAND.radiusX * ts * 0.4,
    y + FALLEN_BAND.radiusY * ts,
    ringR,
    ringR * 0.5,
    0,
    0,
    FULL_TURN,
  );
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.7));
  ctx.lineWidth = hairline(ts, 0.025);
  ctx.stroke();
}

/** Stone dust and grit scattered round the foot. */
function paintGrit(ctx: Ctx, centreX: number, foot: number, ts: number, rng: Rng): void {
  ctx.fillStyle = rgba(sampleRamp(CARVED_STONE, 0.6), GRIT_ALPHA);
  for (let i = 0; i < GRIT_SPECKS; i++) {
    const x = centreX + (rng() - 0.5) * 2 * GRIT_SPREAD_X_TILES * ts;
    const y = foot + (GRIT_FROM_TILES + rng() * (GRIT_TO_TILES - GRIT_FROM_TILES)) * ts;
    const speck = hairline(ts, 0.02 + rng() * 0.02);
    ctx.fillRect(x, y, speck, speck);
  }
}

// ── Binding pillar shatter ─────────────────────────────────────────────────

/** Frames the shatter plays over the pillar as it breaks. */
export const BINDING_PILLAR_SHATTER_FRAMES = 36;
/** Where on the pillar it bursts, in tiles above its foot: where the stump breaks off. */
const SHATTER_BURST_HEIGHT_TILES = 0.55;
/** The ward light let go: a flash that swells and is gone in the first part of the shatter. */
const SHATTER_FLASH_SHARE = 0.35;
const SHATTER_FLASH_FROM_TILES = 0.25;
const SHATTER_FLASH_TO_TILES = 1.1;
const SHATTER_FLASH_ALPHA = 0.85;
/** Of the shatter, the share in which the pieces fly; the rest they lie still and fade into the rubble. */
const SHATTER_LAND_SHARE = 0.6;
const SHATTER_PIECES = 10;
const SHATTER_PIECE_SEED = 0xb10c5;
const SHATTER_PIECE_MIN_TILES = 0.04;
const SHATTER_PIECE_MAX_TILES = 0.09;
const SHATTER_REACH_MIN_TILES = 0.35;
const SHATTER_REACH_MAX_TILES = 0.95;
const SHATTER_ARC_MIN_TILES = 0.25;
const SHATTER_ARC_MAX_TILES = 0.6;
/** The pieces fan out wider across the room than up and down it: a floor seen from above. */
const SHATTER_DEPTH_SQUASH = 0.5;
const SHATTER_SPIN_MAX = 7;
const SHATTER_DUST_PUFFS = 4;
const SHATTER_DUST_FROM_TILES = 0.2;
const SHATTER_DUST_TO_TILES = 0.7;
const SHATTER_DUST_ALPHA = 0.45;
const SHATTER_DUST_SPREAD_TILES = 0.35;

interface ShatterPiece {
  readonly angle: number;
  readonly reach: number;
  readonly arc: number;
  readonly size: number;
  readonly spin: number;
  readonly tone: number;
}

const SHATTER_PIECE_TABLE: readonly ShatterPiece[] = (() => {
  const rng = mulberry32(SHATTER_PIECE_SEED);
  const pieces: ShatterPiece[] = [];
  for (let i = 0; i < SHATTER_PIECES; i++) {
    pieces.push({
      angle: (FULL_TURN * (i + rng() * 0.6)) / SHATTER_PIECES,
      reach: SHATTER_REACH_MIN_TILES + rng() * (SHATTER_REACH_MAX_TILES - SHATTER_REACH_MIN_TILES),
      arc: SHATTER_ARC_MIN_TILES + rng() * (SHATTER_ARC_MAX_TILES - SHATTER_ARC_MIN_TILES),
      size: SHATTER_PIECE_MIN_TILES + rng() * (SHATTER_PIECE_MAX_TILES - SHATTER_PIECE_MIN_TILES),
      spin: (rng() - 0.5) * 2 * SHATTER_SPIN_MAX,
      tone: 0.35 + rng() * 0.45,
    });
  }
  return pieces;
})();

/**
 * A binding pillar breaking, drawn over the broken pillar's own art from the
 * frame it shatters: the ward light let go in one flash, the shaft's pieces
 * thrown out across the floor and fading as they come to rest, and a cloud of
 * stone dust settling over the rubble. `footX`/`footY` are the bottom middle
 * of the pillar's tile in screen pixels; `progress` runs 0..1.
 */
export function drawBindingPillarShatter(
  ctx: Ctx,
  footX: number,
  footY: number,
  tileSize: number,
  progress: number,
): void {
  const ts = tileSize;
  const burstY = footY - ts * (PILLAR_FOOT_LIFT_TILES + SHATTER_BURST_HEIGHT_TILES);
  ctx.save();

  const dustAlpha = SHATTER_DUST_ALPHA * (1 - progress);
  const dustRadius = ts * lerp(SHATTER_DUST_FROM_TILES, SHATTER_DUST_TO_TILES, easeOut(progress));
  for (let i = 0; i < SHATTER_DUST_PUFFS; i++) {
    const angle = (FULL_TURN * i) / SHATTER_DUST_PUFFS;
    const drift = ts * SHATTER_DUST_SPREAD_TILES * easeOut(progress);
    const x = footX + Math.cos(angle) * drift;
    const y = footY - ts * PILLAR_FOOT_LIFT_TILES + Math.sin(angle) * drift * SHATTER_DEPTH_SQUASH;
    glow(ctx, x, y - dustRadius * 0.4, dustRadius, sampleRamp(CARVED_STONE, 0.7), dustAlpha);
  }

  if (progress < SHATTER_FLASH_SHARE) {
    const flash = progress / SHATTER_FLASH_SHARE;
    const radius = ts * lerp(SHATTER_FLASH_FROM_TILES, SHATTER_FLASH_TO_TILES, easeOut(flash));
    glow(ctx, footX, burstY, radius, WARD_CORE, SHATTER_FLASH_ALPHA * (1 - flash));
    glow(ctx, footX, burstY, radius * 0.5, WARD_MID, SHATTER_FLASH_ALPHA * (1 - flash));
  }

  const flight = Math.min(1, progress / SHATTER_LAND_SHARE);
  const settled = Math.max(0, (progress - SHATTER_LAND_SHARE) / (1 - SHATTER_LAND_SHARE));
  const pieceAlpha = 1 - settled;
  const launchHeight = burstY - (footY - ts * PILLAR_FOOT_LIFT_TILES);
  for (const piece of SHATTER_PIECE_TABLE) {
    const out = easeOut(flight) * piece.reach * ts;
    const groundX = footX + Math.cos(piece.angle) * out;
    const groundY =
      footY - ts * PILLAR_FOOT_LIFT_TILES + Math.sin(piece.angle) * out * SHATTER_DEPTH_SQUASH;
    const height = launchHeight * (1 - flight) - 4 * piece.arc * ts * flight * (1 - flight);
    paintFlyingPiece(
      ctx,
      groundX,
      groundY + height,
      piece.size * ts,
      piece.spin * flight,
      piece.tone,
      pieceAlpha,
    );
  }
  ctx.restore();
}

function paintFlyingPiece(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  turn: number,
  tone: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.beginPath();
  ctx.moveTo(-size, -size * 0.6);
  ctx.lineTo(size * 0.8, -size);
  ctx.lineTo(size, size * 0.5);
  ctx.lineTo(-size * 0.5, size);
  ctx.closePath();
  ctx.fillStyle = rgb(sampleRamp(CARVED_STONE, tone));
  ctx.fill();
  ctx.strokeStyle = rgb(sampleRamp(CARVED_STONE, 0.05));
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ── Cistern culvert ─────────────────────────────────────────────────────────

/** The bore through the west wall, as shares of a tile: its height, and where its middle sits down the row. */
const CULVERT_BORE_HEIGHT_TILES = 0.74;
const CULVERT_BORE_MIDDLE_TILES = 0.5;
/** The stone ring proud of the wall's inner face, as shares of a tile. */
const CULVERT_RING_HALF_WIDTH_TILES = 0.22;
const CULVERT_RING_HALF_HEIGHT_TILES = 0.5;
const CULVERT_RING_THICKNESS_TILES = 0.13;
/** Where the ring stands across the wall tile: on its inner face. */
const CULVERT_RING_AT_TILES = 0.94;
const CULVERT_VOUSSOIRS = 7;
/** The ring's stones darken from the lit top (upper left light) round to the foot. */
const CULVERT_RING_BASE_TONE = 0.35;
const CULVERT_RING_LIT_TONE = 0.55;
const CULVERT_RING_TONE_JITTER = 0.06;
const CULVERT_SEAM_PX = 1;
/** The bore's sill, wet, catching what little light gets in. */
const CULVERT_SILL_HEIGHT_TILES = 0.1;
const CULVERT_SILL_SHEEN_ALPHA = 0.3;
/** The damp the culvert's seep leaves on the floor in front of it, as a soft oval. */
const CULVERT_DAMP_RADIUS_X_TILES = 0.85;
const CULVERT_DAMP_RADIUS_Y_TILES = 0.42;
const CULVERT_DAMP_ALPHA = 0.32;
/** The shallow pool the seep spreads into just inside the mouth. */
const CULVERT_POOL_OFFSET_TILES = 0.32;
const CULVERT_POOL_RADIUS_X_TILES = 0.34;
const CULVERT_POOL_RADIUS_Y_TILES = 0.17;
const CULVERT_POOL_ALPHA = 0.5;
const CULVERT_POOL_RIM_ALPHA = 0.16;
const CULVERT_BORE_DEEP: RGB = [4, 5, 8];
const CULVERT_SILL: RGB = [70, 86, 96];

/**
 * The sewer culvert's mouth in the cistern's west wall: a dark bore through
 * the wall tile under a stone ring on its inner face, and the seep from it
 * pooling on the floor tile in front. Flat to the ground, so the party walks
 * out of it over the damp.
 */
export function paintCisternCulvert(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const middleY = box.top + ts * CULVERT_BORE_MIDDLE_TILES;
    const boreHalfH = (ts * CULVERT_BORE_HEIGHT_TILES) / 2;
    const ringX = box.left + ts * CULVERT_RING_AT_TILES;
    const sillY = middleY + boreHalfH - ts * CULVERT_SILL_HEIGHT_TILES;

    const damp = ctx.createRadialGradient(
      ringX,
      middleY,
      0,
      ringX,
      middleY,
      ts * CULVERT_DAMP_RADIUS_X_TILES,
    );
    damp.addColorStop(0, rgba(WATER_DARK, CULVERT_DAMP_ALPHA));
    damp.addColorStop(1, rgba(WATER_DARK, 0));
    ctx.fillStyle = damp;
    ctx.beginPath();
    ctx.ellipse(
      ringX,
      middleY,
      ts * CULVERT_DAMP_RADIUS_X_TILES,
      ts * CULVERT_DAMP_RADIUS_Y_TILES,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();

    const poolX = ringX + ts * CULVERT_POOL_OFFSET_TILES;
    ctx.beginPath();
    ctx.ellipse(
      poolX,
      sillY,
      ts * CULVERT_POOL_RADIUS_X_TILES,
      ts * CULVERT_POOL_RADIUS_Y_TILES,
      0,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = rgba(WATER_DEEP, CULVERT_POOL_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(CONDUIT_LIGHT_MID, CULVERT_POOL_RIM_ALPHA);
    ctx.lineWidth = CULVERT_SEAM_PX;
    ctx.stroke();

    const bore = ctx.createLinearGradient(box.left, 0, ringX, 0);
    bore.addColorStop(0, rgb(CULVERT_BORE_DEEP));
    bore.addColorStop(1, rgb(CULVERT_DARK));
    ctx.fillStyle = bore;
    ctx.fillRect(box.left, middleY - boreHalfH, ringX - box.left, boreHalfH * 2);
    ctx.fillStyle = rgba(CULVERT_SILL, CULVERT_SILL_SHEEN_ALPHA);
    ctx.fillRect(box.left, sillY, ringX - box.left, ts * CULVERT_SILL_HEIGHT_TILES);

    const ringHalfW = ts * CULVERT_RING_HALF_WIDTH_TILES;
    const ringHalfH = ts * CULVERT_RING_HALF_HEIGHT_TILES;
    const thickness = ts * CULVERT_RING_THICKNESS_TILES;
    for (let stone = 0; stone < CULVERT_VOUSSOIRS; stone++) {
      const from = -Math.PI / 2 + (Math.PI * stone) / CULVERT_VOUSSOIRS;
      const to = -Math.PI / 2 + (Math.PI * (stone + 1)) / CULVERT_VOUSSOIRS;
      const litShare = 1 - stone / CULVERT_VOUSSOIRS;
      const tone =
        CULVERT_RING_BASE_TONE +
        CULVERT_RING_LIT_TONE * litShare +
        jitter(rng, CULVERT_RING_TONE_JITTER);
      ctx.beginPath();
      ctx.ellipse(ringX, middleY, ringHalfW, ringHalfH, 0, from, to);
      ctx.ellipse(ringX, middleY, ringHalfW - thickness, ringHalfH - thickness, 0, to, from, true);
      ctx.closePath();
      ctx.fillStyle = rgb(sampleRamp(CISTERN_STONE, tone));
      ctx.fill();
      ctx.strokeStyle = rgb(MORTAR_DAMP);
      ctx.lineWidth = CULVERT_SEAM_PX;
      ctx.stroke();
    }
  });
}
