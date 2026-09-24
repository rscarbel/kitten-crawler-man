/**
 * Painters for the Juicer's gym: the dumbbell rack, the squat rack, the cable
 * stack, the treadmill belt and console, the boombox, the roll-down shutter,
 * the bowled plate, chalk puffs and the cracked mirror.
 *
 * Every painter draws in the same three-quarter view as `gymEquipmentSprite.ts`
 * and shares its materials, so a rack and a bench read as one gym. Each takes
 * the anchor tile's top-left corner and the tile's size in pixels; anything
 * upright stacks above the tile's floor, and nothing a prop blocks with hangs
 * past the sides of the tile it stands on — a rack wider than its tile looks
 * like somewhere to stand.
 *
 * They are painted once into sheets (`gymRoomSheets.ts`) and blitted; nothing
 * here runs per frame.
 */

import {
  BRUSHED_STEEL,
  CAST_IRON,
  GRIP_RUBBER,
  MOULDED_PLASTIC,
  POWDER_COAT,
  TREAD_RUBBER,
  cylinderGradient,
  drawContactShadow,
  fillPolygon,
  strokeTube,
  type Point,
  type Shade,
} from '../gymEquipmentSprite';

const TAU = Math.PI * 2;
const HALF = 0.5;

/** Racks and uprights: near-black steel, lifted by a hard cold rim so they read on black rubber. */
const RACK_STEEL: Shade = { dark: '#0d0f12', mid: '#34393f', light: '#8c96a2' };
/** Knurled bar chrome. */
const CHROME: Shade = { dark: '#2a2e33', mid: '#8a929b', light: '#e9eef3' };
/** Gym-red paint: J-hooks, selector pin, bumper plates. */
const GYM_RED: Shade = { dark: '#4a0a0e', mid: '#a3161f', light: '#ef4b4b' };
const GYM_BLUE: Shade = { dark: '#0b1c3d', mid: '#1f4fa3', light: '#5c97f0' };
const GYM_YELLOW: Shade = { dark: '#5a4308', mid: '#c99a14', light: '#ffe05a' };
const HEX_RUBBER: Shade = { dark: '#070808', mid: '#1c1f22', light: '#4b5157' };

/** The overhead fluorescents: a cold white glint along every top edge. */
const RIM_LIGHT = 'rgba(220,240,255,0.55)';
const HAIRLINE = 'rgba(0,0,0,0.75)';
const CHALK = 'rgba(245,245,240,0.8)';
const CHALK_FAINT = 'rgba(245,245,240,0.35)';

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

/** A flat bar with a lit top edge and a dark underside: shelves, feet, crossmembers. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shade: Shade,
): void {
  rect(ctx, x, y, w, h, cylinderGradient(ctx, 0, y, 0, y + h, shade));
  rect(ctx, x, y, w, Math.max(1, h * RIM_EDGE_SHARE), RIM_LIGHT);
}
const RIM_EDGE_SHARE = 0.22;

/** An upright post with its rim light down the lit (left) side. */
function drawPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  w: number,
  shade: Shade,
): void {
  rect(ctx, x, top, w, bottom - top, cylinderGradient(ctx, x, 0, x + w, 0, shade));
  rect(ctx, x, top, Math.max(1, w * RIM_EDGE_SHARE), bottom - top, RIM_LIGHT);
}

// ── Dumbbell rack ────────────────────────────────────────────────────────────

/**
 * Three tiers stepping back and up, one dumbbell lying across each, so a full
 * rack and an empty one differ by three big dark shapes rather than a detail.
 */
const RACK = {
  legLeftX: 0.08,
  legRightX: 0.84,
  legWidth: 0.08,
  footY: 0.9,
  legTopY: -0.3,
  footHeight: 0.07,
  tierYs: [0.66, 0.26, -0.12],
  tierInsetX: [0.12, 0.15, 0.18],
  trayHeight: 0.07,
  cradleOffsetX: 0.2,
  cradleWidth: 0.1,
  cradleHeight: 0.06,
  shadowRx: 0.5,
  shadowRy: 0.07,
  shadowY: 0.9,
  handleHalf: 0.26,
  handleThickness: 0.06,
  headX: 0.28,
  headHalfWidth: 0.1,
  headHalfHeight: [0.19, 0.17, 0.15],
  headLift: 0.14,
  stripeHeight: 0.05,
} as const;

/** The number of slots a rack holds. */
export const GYM_RACK_SLOTS = 3;

/** Paints a hex dumbbell lying across the view, centred at (cx, cy). */
function drawHexDumbbell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  headHalfHeightFrac: number,
): void {
  strokeTube(
    ctx,
    [cx - s * RACK.handleHalf, cy],
    [cx + s * RACK.handleHalf, cy],
    s * RACK.handleThickness,
    CHROME,
    false,
  );
  for (const side of [-1, 1]) {
    const headCx = cx + side * s * RACK.headX;
    const halfW = s * RACK.headHalfWidth;
    const halfH = s * headHalfHeightFrac;
    const hex: Point[] = [
      [headCx - halfW, cy - halfH * HALF],
      [headCx, cy - halfH],
      [headCx + halfW, cy - halfH * HALF],
      [headCx + halfW, cy + halfH * HALF],
      [headCx, cy + halfH],
      [headCx - halfW, cy + halfH * HALF],
    ];
    fillPolygon(ctx, hex, cylinderGradient(ctx, headCx - halfW, 0, headCx + halfW, 0, HEX_RUBBER));
    rect(
      ctx,
      headCx - halfW,
      cy - s * RACK.stripeHeight * HALF,
      halfW * 2,
      s * RACK.stripeHeight,
      GYM_RED.mid,
    );
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
    ctx.beginPath();
    hex.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.stroke();
    rect(ctx, headCx - halfW, cy - halfH, halfW, Math.max(1, s * HAIRLINE_FRAC), RIM_LIGHT);
  }
}
const HAIRLINE_FRAC = 0.02;

/** A dumbbell rack holding `filled` of its {@link GYM_RACK_SLOTS} dumbbells, bottom tier first. */
export function drawGymRack(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  filled: number,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * RACK.shadowY,
    s * RACK.shadowRx,
    s * RACK.shadowRy,
  );
  const legW = s * RACK.legWidth;
  // Rear legs first, a little higher on screen, so the frame has depth.
  drawPost(
    ctx,
    ox + s * RACK.legLeftX + legW,
    oy + s * RACK.legTopY,
    oy + s * RACK.tierYs[0],
    legW * HALF,
    RACK_STEEL,
  );
  drawPost(
    ctx,
    ox + s * RACK.legRightX,
    oy + s * RACK.legTopY,
    oy + s * RACK.tierYs[0],
    legW * HALF,
    RACK_STEEL,
  );
  for (let tier = RACK.tierYs.length - 1; tier >= 0; tier--) {
    const inset = s * RACK.tierInsetX[tier];
    const trayY = oy + s * RACK.tierYs[tier];
    drawBar(ctx, ox + inset, trayY, s - inset * 2, s * RACK.trayHeight, POWDER_COAT);
    for (const side of [-1, 1]) {
      const cradleX = ox + s * HALF + side * s * RACK.cradleOffsetX - s * RACK.cradleWidth * HALF;
      rect(
        ctx,
        cradleX,
        trayY - s * RACK.cradleHeight,
        s * RACK.cradleWidth,
        s * RACK.cradleHeight,
        RACK_STEEL.mid,
      );
    }
    if (tier < filled) {
      drawHexDumbbell(ctx, ox + s * HALF, trayY - s * RACK.headLift, s, RACK.headHalfHeight[tier]);
    }
  }
  drawPost(
    ctx,
    ox + s * RACK.legLeftX,
    oy + s * RACK.legTopY,
    oy + s * RACK.footY,
    legW,
    RACK_STEEL,
  );
  drawPost(
    ctx,
    ox + s * RACK.legRightX,
    oy + s * RACK.legTopY,
    oy + s * RACK.footY,
    legW,
    RACK_STEEL,
  );
  drawBar(
    ctx,
    ox + s * RACK.legLeftX,
    oy + s * (RACK.footY - RACK.footHeight),
    s * (RACK.legRightX - RACK.legLeftX + RACK.legWidth),
    s * RACK.footHeight,
    RACK_STEEL,
  );
}

// ── Squat rack ───────────────────────────────────────────────────────────────

const SQUAT = {
  frontLeftX: 0.1,
  frontRightX: 0.8,
  backLeftX: 0.2,
  backRightX: 0.7,
  postWidth: 0.1,
  backPostWidth: 0.08,
  frontFootY: 0.92,
  backFootY: 0.5,
  frontTopY: -1.3,
  backTopY: -1.52,
  topRailHeight: 0.08,
  footHeight: 0.08,
  holeCount: 9,
  holeTopY: -1.15,
  holeStep: 0.19,
  holeRadius: 0.018,
  hookY: -0.3,
  hookHeight: 0.1,
  hookWidth: 0.07,
  barY: -0.36,
  barLeftX: 0.05,
  barRightX: 0.95,
  barThickness: 0.05,
  plateX: [0.075, 0.925],
  plateRx: 0.045,
  plateRy: 0.3,
  safetyY: 0.12,
  safetyThickness: 0.05,
  storageY: 0.34,
  storageRx: 0.2,
  storageRy: 0.3,
  storageStep: 0.06,
  storageCount: 3,
  shadowRx: 0.46,
  shadowRy: 0.14,
  shadowY: 0.82,
  chalkCount: 5,
  chalkSpan: 0.3,
  chalkSize: 0.025,
} as const;

/** Paints a bumper plate seen edge-on: rubber disc, coloured band, steel hub. */
function drawBumperEdge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  band: Shade,
): void {
  ctx.fillStyle = cylinderGradient(ctx, cx - rx, 0, cx + rx, 0, HEX_RUBBER);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = cylinderGradient(ctx, cx - rx, 0, cx + rx, 0, band);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * BUMPER_BAND_RX_SHARE, ry * BUMPER_BAND_RY_SHARE, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, rx * BUMPER_OUTLINE_SHARE);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
}
const BUMPER_BAND_RX_SHARE = 0.7;
const BUMPER_BAND_RY_SHARE = 0.92;
const BUMPER_OUTLINE_SHARE = 0.35;

/** A power rack, barbell on the hooks, loaded with bumpers or stripped bare. */
export function drawGymSquatRack(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  loaded: boolean,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * SQUAT.shadowY,
    s * SQUAT.shadowRx,
    s * SQUAT.shadowRy,
  );
  const backW = s * SQUAT.backPostWidth;
  const frontW = s * SQUAT.postWidth;
  drawPost(
    ctx,
    ox + s * SQUAT.backLeftX,
    oy + s * SQUAT.backTopY,
    oy + s * SQUAT.backFootY,
    backW,
    POWDER_COAT,
  );
  drawPost(
    ctx,
    ox + s * SQUAT.backRightX,
    oy + s * SQUAT.backTopY,
    oy + s * SQUAT.backFootY,
    backW,
    POWDER_COAT,
  );
  drawBar(
    ctx,
    ox + s * SQUAT.backLeftX,
    oy + s * SQUAT.backTopY,
    s * (SQUAT.backRightX - SQUAT.backLeftX) + backW,
    s * SQUAT.topRailHeight,
    POWDER_COAT,
  );

  if (loaded) {
    for (let i = 0; i < SQUAT.storageCount; i++) {
      const band = i % 2 === 0 ? GYM_RED : GYM_BLUE;
      drawBumperEdge(
        ctx,
        ox + s * (HALF + (i - 1) * SQUAT.storageStep),
        oy + s * SQUAT.storageY,
        s * SQUAT.storageRx * STORAGE_EDGE_RX_SHARE,
        s * SQUAT.storageRy,
        band,
      );
    }
  }

  drawPost(
    ctx,
    ox + s * SQUAT.frontLeftX,
    oy + s * SQUAT.frontTopY,
    oy + s * SQUAT.frontFootY,
    frontW,
    RACK_STEEL,
  );
  drawPost(
    ctx,
    ox + s * SQUAT.frontRightX,
    oy + s * SQUAT.frontTopY,
    oy + s * SQUAT.frontFootY,
    frontW,
    RACK_STEEL,
  );
  // The top frame: front rail and the two side rails running back to the rear posts.
  drawBar(
    ctx,
    ox + s * SQUAT.frontLeftX,
    oy + s * SQUAT.frontTopY,
    s * (SQUAT.frontRightX - SQUAT.frontLeftX) + frontW,
    s * SQUAT.topRailHeight,
    RACK_STEEL,
  );
  for (const [frontX, backX] of [
    [SQUAT.frontLeftX, SQUAT.backLeftX],
    [SQUAT.frontRightX + SQUAT.postWidth - SQUAT.backPostWidth, SQUAT.backRightX],
  ] as const) {
    fillPolygon(
      ctx,
      [
        [ox + s * frontX, oy + s * SQUAT.frontTopY],
        [ox + s * backX, oy + s * SQUAT.backTopY],
        [ox + s * backX + backW, oy + s * SQUAT.backTopY],
        [ox + s * frontX + backW, oy + s * SQUAT.frontTopY],
      ],
      RACK_STEEL.mid,
    );
  }
  ctx.fillStyle = HAIRLINE;
  for (let hole = 0; hole < SQUAT.holeCount; hole++) {
    const hy = oy + s * (SQUAT.holeTopY + hole * SQUAT.holeStep);
    for (const postX of [SQUAT.frontLeftX, SQUAT.frontRightX]) {
      ctx.beginPath();
      ctx.arc(ox + s * (postX + SQUAT.postWidth * HALF), hy, s * SQUAT.holeRadius, 0, TAU);
      ctx.fill();
    }
  }
  // Safety arms.
  drawBar(
    ctx,
    ox + s * SQUAT.frontLeftX,
    oy + s * SQUAT.safetyY,
    s * (SQUAT.frontRightX - SQUAT.frontLeftX) + frontW,
    s * SQUAT.safetyThickness,
    CHROME,
  );

  for (const postX of [SQUAT.frontLeftX, SQUAT.frontRightX]) {
    rect(
      ctx,
      ox + s * (postX + SQUAT.postWidth * HALF - SQUAT.hookWidth * HALF),
      oy + s * SQUAT.hookY,
      s * SQUAT.hookWidth,
      s * SQUAT.hookHeight,
      GYM_RED.mid,
    );
  }
  strokeTube(
    ctx,
    [ox + s * SQUAT.barLeftX, oy + s * SQUAT.barY],
    [ox + s * SQUAT.barRightX, oy + s * SQUAT.barY],
    s * SQUAT.barThickness,
    CHROME,
    false,
  );
  ctx.fillStyle = CHALK;
  for (let mark = 0; mark < SQUAT.chalkCount; mark++) {
    const mx =
      ox + s * (HALF - SQUAT.chalkSpan * HALF + (mark / (SQUAT.chalkCount - 1)) * SQUAT.chalkSpan);
    ctx.fillRect(
      mx,
      oy + s * (SQUAT.barY - SQUAT.chalkSize),
      s * SQUAT.chalkSize,
      s * SQUAT.chalkSize,
    );
  }
  if (loaded) {
    for (const plateX of SQUAT.plateX) {
      drawBumperEdge(
        ctx,
        ox + s * plateX,
        oy + s * SQUAT.barY,
        s * SQUAT.plateRx,
        s * SQUAT.plateRy,
        GYM_RED,
      );
    }
  }
}
const STORAGE_EDGE_RX_SHARE = 0.3;

// ── Cable stack ──────────────────────────────────────────────────────────────

const CABLE = {
  frameLeftX: 0.1,
  frameRightX: 0.82,
  postWidth: 0.08,
  footY: 0.92,
  topY: -1.4,
  headHeight: 0.22,
  pulleyY: -1.2,
  pulleyRadius: 0.1,
  stackLeftX: 0.3,
  stackRightX: 0.7,
  stackBottomY: 0.72,
  plateCount: 10,
  plateHeight: 0.07,
  plateGap: 0.012,
  pinPlate: 6,
  rodInsetX: 0.08,
  shroudTopY: -1.12,
  shroudBottomY: -0.2,
  cableX: 0.5,
  handleY: 0.36,
  handleHalfWidth: 0.14,
  handleThickness: 0.05,
  hookY: 0.26,
  baseHeight: 0.1,
  stripeCount: 6,
  shadowRx: 0.46,
  shadowRy: 0.12,
  shadowY: 0.84,
  decalY: -0.8,
  decalHeight: 0.18,
} as const;

/** A cable crossover tower: weight stack, pulley head, cable and a D-handle. */
export function drawGymCableStack(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * CABLE.shadowY,
    s * CABLE.shadowRx,
    s * CABLE.shadowRy,
  );
  const postW = s * CABLE.postWidth;
  const stackLeft = ox + s * CABLE.stackLeftX;
  const stackWidth = s * (CABLE.stackRightX - CABLE.stackLeftX);

  // Guide rods behind the stack.
  for (const rodX of [CABLE.stackLeftX + CABLE.rodInsetX, CABLE.stackRightX - CABLE.rodInsetX]) {
    strokeTube(
      ctx,
      [ox + s * rodX, oy + s * CABLE.topY],
      [ox + s * rodX, oy + s * CABLE.stackBottomY],
      s * HAIRLINE_FRAC * 2,
      CHROME,
      true,
    );
  }
  for (let plate = 0; plate < CABLE.plateCount; plate++) {
    const plateTop =
      oy + s * (CABLE.stackBottomY - (plate + 1) * (CABLE.plateHeight + CABLE.plateGap));
    if (plateTop < oy + s * CABLE.shroudBottomY) break;
    drawBar(ctx, stackLeft, plateTop, stackWidth, s * CABLE.plateHeight, CAST_IRON);
    if (plate === CABLE.pinPlate) {
      rect(
        ctx,
        stackLeft + stackWidth,
        plateTop,
        s * CABLE.postWidth * HALF,
        s * CABLE.plateHeight,
        GYM_RED.light,
      );
    }
  }
  // Shroud over the upper stack, with the manufacturer's decal worn half off.
  rect(
    ctx,
    stackLeft,
    oy + s * CABLE.shroudTopY,
    stackWidth,
    s * (CABLE.shroudBottomY - CABLE.shroudTopY),
    cylinderGradient(ctx, stackLeft, 0, stackLeft + stackWidth, 0, MOULDED_PLASTIC),
  );
  rect(ctx, stackLeft, oy + s * CABLE.decalY, stackWidth, s * CABLE.decalHeight, GYM_YELLOW.mid);
  rect(
    ctx,
    stackLeft,
    oy + s * CABLE.decalY,
    stackWidth * HALF,
    s * CABLE.decalHeight * HALF,
    GYM_YELLOW.light,
  );

  drawPost(
    ctx,
    ox + s * CABLE.frameLeftX,
    oy + s * CABLE.topY,
    oy + s * CABLE.footY,
    postW,
    RACK_STEEL,
  );
  drawPost(
    ctx,
    ox + s * CABLE.frameRightX,
    oy + s * CABLE.topY,
    oy + s * CABLE.footY,
    postW,
    RACK_STEEL,
  );
  drawBar(
    ctx,
    ox + s * CABLE.frameLeftX,
    oy + s * CABLE.topY,
    s * (CABLE.frameRightX - CABLE.frameLeftX) + postW,
    s * CABLE.headHeight,
    RACK_STEEL,
  );

  // Base plate with hazard stripes, scuffed.
  const baseTop = oy + s * (CABLE.footY - CABLE.baseHeight);
  const baseLeft = ox + s * CABLE.frameLeftX;
  const baseWidth = s * (CABLE.frameRightX - CABLE.frameLeftX) + postW;
  rect(ctx, baseLeft, baseTop, baseWidth, s * CABLE.baseHeight, GYM_YELLOW.mid);
  ctx.save();
  ctx.beginPath();
  ctx.rect(baseLeft, baseTop, baseWidth, s * CABLE.baseHeight);
  ctx.clip();
  ctx.fillStyle = POWDER_COAT.dark;
  const stripeStep = baseWidth / CABLE.stripeCount;
  for (let stripe = 0; stripe < CABLE.stripeCount + 1; stripe++) {
    const sx0 = baseLeft + stripe * stripeStep;
    fillPolygon(
      ctx,
      [
        [sx0, baseTop + s * CABLE.baseHeight],
        [sx0 + stripeStep * HALF, baseTop + s * CABLE.baseHeight],
        [sx0 + stripeStep, baseTop],
        [sx0 + stripeStep * HALF, baseTop],
      ],
      POWDER_COAT.dark,
    );
  }
  ctx.restore();

  // Pulley head and the cable down to the handle.
  const pulleyCx = ox + s * CABLE.cableX;
  const pulleyCy = oy + s * CABLE.pulleyY;
  ctx.fillStyle = cylinderGradient(
    ctx,
    pulleyCx - s * CABLE.pulleyRadius,
    0,
    pulleyCx + s * CABLE.pulleyRadius,
    0,
    BRUSHED_STEEL,
  );
  ctx.beginPath();
  ctx.arc(pulleyCx, pulleyCy, s * CABLE.pulleyRadius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = HAIRLINE;
  ctx.beginPath();
  ctx.arc(pulleyCx, pulleyCy, s * CABLE.pulleyRadius * HALF, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = POWDER_COAT.dark;
  ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
  ctx.beginPath();
  ctx.moveTo(pulleyCx + s * CABLE.pulleyRadius, pulleyCy);
  ctx.lineTo(pulleyCx + s * CABLE.pulleyRadius, oy + s * CABLE.hookY);
  ctx.lineTo(pulleyCx, oy + s * CABLE.handleY);
  ctx.stroke();
  strokeTube(
    ctx,
    [pulleyCx - s * CABLE.handleHalfWidth, oy + s * CABLE.handleY],
    [pulleyCx + s * CABLE.handleHalfWidth, oy + s * CABLE.handleY],
    s * CABLE.handleThickness,
    GRIP_RUBBER,
    false,
  );
}

// ── Treadmill belt and console ───────────────────────────────────────────────

/** Frames in one belt cycle. The slats advance a quarter of their pitch per frame. */
export const GYM_BELT_FRAMES = 4;

const BELT = {
  railWidth: 0.13,
  slatPitch: 0.375,
  slatThickness: 0.06,
  chevronDepth: 0.12,
  chevronHalfWidth: 0.2,
  chevronThickness: 0.05,
} as const;
const BELT_RAIL: Shade = { dark: '#3a3f46', mid: '#7b848f', light: '#c9d1da' };
const BELT_SLAT = 'rgba(255,255,255,0.09)';
const BELT_CHEVRON = 'rgba(255,190,60,0.35)';
const BELT_CHEVRON_IDLE = 'rgba(255,190,60,0.14)';
const BELT_SHADOW = 'rgba(0,0,0,0.45)';

/**
 * One tile of treadmill belt running along the tile's vertical axis, its slats
 * moving toward +y. `phase` in [0, 1) is how far through one slat pitch the belt
 * has run. The painter for the other three push directions rotates this.
 */
export function drawGymBeltTile(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  phase: number,
  powered: boolean,
): void {
  const rail = s * BELT.railWidth;
  rect(
    ctx,
    ox + rail,
    oy,
    s - rail * 2,
    s,
    cylinderGradient(ctx, ox + rail, 0, ox + s - rail, 0, TREAD_RUBBER),
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + rail, oy, s - rail * 2, s);
  ctx.clip();
  const pitch = s * BELT.slatPitch;
  const offset = phase * pitch;
  for (let y = -pitch + offset; y < s + pitch; y += pitch) {
    rect(ctx, ox + rail, oy + y, s - rail * 2, s * BELT.slatThickness, BELT_SLAT);
    // A painted chevron on every other slat, pointing the way the belt runs,
    // so a crawler can read the push before stepping on.
    ctx.strokeStyle = powered ? BELT_CHEVRON : BELT_CHEVRON_IDLE;
    ctx.lineWidth = s * BELT.chevronThickness;
    ctx.beginPath();
    ctx.moveTo(
      ox + s * (HALF - BELT.chevronHalfWidth),
      oy + y + pitch * HALF - s * BELT.chevronDepth,
    );
    ctx.lineTo(ox + s * HALF, oy + y + pitch * HALF);
    ctx.lineTo(
      ox + s * (HALF + BELT.chevronHalfWidth),
      oy + y + pitch * HALF - s * BELT.chevronDepth,
    );
    ctx.stroke();
  }
  ctx.restore();
  rect(ctx, ox + rail, oy, s * BELT.slatThickness, s, BELT_SHADOW);
  for (const railX of [ox, ox + s - rail]) {
    rect(ctx, railX, oy, rail, s, cylinderGradient(ctx, railX, 0, railX + rail, 0, BELT_RAIL));
    rect(ctx, railX, oy, Math.max(1, rail * RIM_EDGE_SHARE), s, RIM_LIGHT);
  }
}

/** The console's three looks. */
export type GymConsoleState = 'off' | 'on' | 'beep';

const CONSOLE = {
  postLeftX: 0.14,
  postRightX: 0.78,
  postWidth: 0.08,
  postBottomY: 0.35,
  postTopY: -0.35,
  boxLeftX: 0.08,
  boxRightX: 0.92,
  boxTopY: -0.62,
  boxBottomY: -0.28,
  screenInsetX: 0.12,
  screenTopY: -0.55,
  screenBottomY: -0.38,
  readoutCount: 3,
  readoutWidth: 0.12,
  readoutHeight: 0.07,
  readoutGap: 0.05,
  handrailY: -0.05,
  handrailThickness: 0.06,
  keyY: -0.33,
  keySize: 0.04,
  beepBarHeight: 0.05,
} as const;
const SCREEN_OFF = '#0a1114';
const SCREEN_ON = '#0b2a22';
const SCREEN_BEEP = '#3a0b0b';
const READOUT_ON = '#2bf0a6';
const READOUT_DIM = '#1b8d63';
const READOUT_BEEP = '#ff5b4a';
const SAFETY_KEY = '#ffcc00';

/**
 * The treadmill's console and handrails, rising above the belt's wall end.
 * `blink` alternates the readouts so a live console flickers on the overlay clock.
 */
export function drawGymTreadmillConsole(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  state: GymConsoleState,
  blink: boolean,
): void {
  const postW = s * CONSOLE.postWidth;
  drawPost(
    ctx,
    ox + s * CONSOLE.postLeftX,
    oy + s * CONSOLE.postTopY,
    oy + s * CONSOLE.postBottomY,
    postW,
    BRUSHED_STEEL,
  );
  drawPost(
    ctx,
    ox + s * CONSOLE.postRightX,
    oy + s * CONSOLE.postTopY,
    oy + s * CONSOLE.postBottomY,
    postW,
    BRUSHED_STEEL,
  );
  strokeTube(
    ctx,
    [ox + s * CONSOLE.postLeftX, oy + s * CONSOLE.handrailY],
    [ox + s * (CONSOLE.postRightX + CONSOLE.postWidth), oy + s * CONSOLE.handrailY],
    s * CONSOLE.handrailThickness,
    GRIP_RUBBER,
    false,
  );

  const boxLeft = ox + s * CONSOLE.boxLeftX;
  const boxTop = oy + s * CONSOLE.boxTopY;
  const boxWidth = s * (CONSOLE.boxRightX - CONSOLE.boxLeftX);
  const boxHeight = s * (CONSOLE.boxBottomY - CONSOLE.boxTopY);
  rect(
    ctx,
    boxLeft,
    boxTop,
    boxWidth,
    boxHeight,
    cylinderGradient(ctx, 0, boxTop, 0, boxTop + boxHeight, MOULDED_PLASTIC),
  );
  rect(ctx, boxLeft, boxTop, boxWidth, Math.max(1, boxHeight * RIM_EDGE_SHARE * HALF), RIM_LIGHT);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
  ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);

  const screenLeft = ox + s * (CONSOLE.boxLeftX + CONSOLE.screenInsetX);
  const screenWidth = s * (CONSOLE.boxRightX - CONSOLE.boxLeftX - CONSOLE.screenInsetX * 2);
  const screenTop = oy + s * CONSOLE.screenTopY;
  const screenHeight = s * (CONSOLE.screenBottomY - CONSOLE.screenTopY);
  const screenFill = state === 'off' ? SCREEN_OFF : state === 'on' ? SCREEN_ON : SCREEN_BEEP;
  rect(ctx, screenLeft, screenTop, screenWidth, screenHeight, screenFill);
  if (state !== 'off') {
    const lit = state === 'beep' ? READOUT_BEEP : blink ? READOUT_ON : READOUT_DIM;
    const rowWidth =
      CONSOLE.readoutCount * CONSOLE.readoutWidth + (CONSOLE.readoutCount - 1) * CONSOLE.readoutGap;
    const firstX = ox + s * (HALF - rowWidth * HALF);
    for (let readout = 0; readout < CONSOLE.readoutCount; readout++) {
      const litThisOne = state === 'beep' ? blink : true;
      if (!litThisOne) continue;
      rect(
        ctx,
        firstX + s * readout * (CONSOLE.readoutWidth + CONSOLE.readoutGap),
        screenTop + (screenHeight - s * CONSOLE.readoutHeight) * HALF,
        s * CONSOLE.readoutWidth,
        s * CONSOLE.readoutHeight,
        lit,
      );
    }
    if (state === 'beep') {
      rect(ctx, screenLeft, screenTop, screenWidth, s * CONSOLE.beepBarHeight, READOUT_BEEP);
    }
  }
  rect(
    ctx,
    ox + s * (HALF - CONSOLE.keySize),
    oy + s * CONSOLE.keyY,
    s * CONSOLE.keySize * 2,
    s * CONSOLE.keySize,
    SAFETY_KEY,
  );
}

// ── Boombox ──────────────────────────────────────────────────────────────────

/** Which picture of the boombox a frame is. */
export type GymBoomboxLook = 'intact' | 'thump' | 'broken';

const BOOMBOX = {
  bodyLeftX: 0.1,
  bodyRightX: 0.9,
  bodyTopY: 0.28,
  bodyBottomY: 0.82,
  handleTopY: 0.12,
  handleInsetX: 0.22,
  handleThickness: 0.05,
  speakerX: [0.28, 0.72],
  speakerY: 0.6,
  speakerRadius: 0.14,
  coneRadius: 0.07,
  thumpConeRadius: 0.1,
  deckLeftX: 0.42,
  deckRightX: 0.58,
  deckTopY: 0.42,
  deckBottomY: 0.72,
  dialY: 0.35,
  dialRadius: 0.025,
  shadowRx: 0.46,
  shadowRy: 0.1,
  shadowY: 0.84,
  noteX: [0.2, 0.62, 0.84],
  noteY: [0.06, -0.02, 0.1],
  noteHead: 0.035,
  noteStem: 0.1,
  crackCount: 4,
  tapeLoopRadius: 0.06,
} as const;
const BOOMBOX_BODY: Shade = { dark: '#202328', mid: '#6d7580', light: '#c8cfd8' };
const SPEAKER_GRILLE = '#15171a';
const SPEAKER_CONE = '#3d4249';
const NOTE_INK = '#ffe36b';
const TAPE_BROWN = '#5b3a1e';

/** An 80s boombox on the floor: intact, mid-thump with notes coming off it, or smashed. */
export function drawGymBoombox(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  look: GymBoomboxLook,
  thumpPhase: number,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * BOOMBOX.shadowY,
    s * BOOMBOX.shadowRx,
    s * BOOMBOX.shadowRy,
  );
  const left = ox + s * BOOMBOX.bodyLeftX;
  const top = oy + s * BOOMBOX.bodyTopY;
  const width = s * (BOOMBOX.bodyRightX - BOOMBOX.bodyLeftX);
  const height = s * (BOOMBOX.bodyBottomY - BOOMBOX.bodyTopY);
  if (look !== 'broken') {
    strokeTube(
      ctx,
      [left + s * BOOMBOX.handleInsetX, oy + s * BOOMBOX.handleTopY],
      [left + width - s * BOOMBOX.handleInsetX, oy + s * BOOMBOX.handleTopY],
      s * BOOMBOX.handleThickness,
      CHROME,
      false,
    );
    for (const handleX of [
      left + s * BOOMBOX.handleInsetX,
      left + width - s * BOOMBOX.handleInsetX,
    ]) {
      strokeTube(
        ctx,
        [handleX, oy + s * BOOMBOX.handleTopY],
        [handleX, top],
        s * BOOMBOX.handleThickness,
        CHROME,
        true,
      );
    }
  }
  rect(ctx, left, top, width, height, cylinderGradient(ctx, 0, top, 0, top + height, BOOMBOX_BODY));
  rect(ctx, left, top, width, Math.max(1, height * RIM_EDGE_SHARE * HALF), RIM_LIGHT);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
  ctx.strokeRect(left, top, width, height);

  BOOMBOX.speakerX.forEach((speakerX, index) => {
    const cx = ox + s * speakerX;
    const cy = oy + s * BOOMBOX.speakerY;
    ctx.fillStyle = SPEAKER_GRILLE;
    ctx.beginPath();
    ctx.arc(cx, cy, s * BOOMBOX.speakerRadius, 0, TAU);
    ctx.fill();
    const blownOut = look === 'broken' && index === 0;
    if (blownOut) return;
    const pushed = look === 'thump' && thumpPhase > HALF;
    ctx.fillStyle = SPEAKER_CONE;
    ctx.beginPath();
    ctx.arc(cx, cy, s * (pushed ? BOOMBOX.thumpConeRadius : BOOMBOX.coneRadius), 0, TAU);
    ctx.fill();
    ctx.fillStyle = RIM_LIGHT;
    ctx.beginPath();
    ctx.arc(cx, cy, s * BOOMBOX.dialRadius, 0, TAU);
    ctx.fill();
  });
  rect(
    ctx,
    ox + s * BOOMBOX.deckLeftX,
    oy + s * BOOMBOX.deckTopY,
    s * (BOOMBOX.deckRightX - BOOMBOX.deckLeftX),
    s * (BOOMBOX.deckBottomY - BOOMBOX.deckTopY),
    SPEAKER_GRILLE,
  );
  for (const dialX of [BOOMBOX.deckLeftX, BOOMBOX.deckRightX]) {
    ctx.fillStyle = GYM_RED.light;
    ctx.beginPath();
    ctx.arc(ox + s * dialX, oy + s * BOOMBOX.dialY, s * BOOMBOX.dialRadius, 0, TAU);
    ctx.fill();
  }

  if (look === 'thump') {
    ctx.fillStyle = NOTE_INK;
    ctx.strokeStyle = NOTE_INK;
    ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
    const rise = thumpPhase > HALF ? NOTE_RISE_SHARE : 0;
    BOOMBOX.noteX.forEach((noteX, index) => {
      const nx = ox + s * noteX;
      const ny = oy + s * (BOOMBOX.noteY[index] - rise);
      ctx.beginPath();
      ctx.ellipse(nx, ny, s * BOOMBOX.noteHead, s * BOOMBOX.noteHead * NOTE_HEAD_SQUASH, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(nx + s * BOOMBOX.noteHead, ny);
      ctx.lineTo(nx + s * BOOMBOX.noteHead, ny - s * BOOMBOX.noteStem);
      ctx.stroke();
    });
  }
  if (look === 'broken') {
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC * 2);
    ctx.beginPath();
    for (let crack = 0; crack < BOOMBOX.crackCount; crack++) {
      const angle = (crack / BOOMBOX.crackCount) * TAU + CRACK_TWIST;
      const cx = ox + s * BOOMBOX.speakerX[0];
      const cy = oy + s * BOOMBOX.speakerY;
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(angle) * s * CRACK_REACH,
        cy + Math.sin(angle) * s * CRACK_REACH * HALF,
      );
    }
    ctx.stroke();
    // Tape spilling out of the deck.
    ctx.strokeStyle = TAPE_BROWN;
    ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC);
    ctx.beginPath();
    ctx.arc(
      ox + s * HALF,
      oy + s * BOOMBOX.deckBottomY + s * BOOMBOX.tapeLoopRadius,
      s * BOOMBOX.tapeLoopRadius,
      0,
      TAU,
    );
    ctx.stroke();
  }
}
const NOTE_RISE_SHARE = 0.06;
const NOTE_HEAD_SQUASH = 0.75;
const CRACK_TWIST = 0.4;
const CRACK_REACH = 0.18;

// ── Roll-down shutter ────────────────────────────────────────────────────────

/** Frames from rolled up to fully down. */
export const GYM_SHUTTER_FRAMES = 4;

const SHUTTER = {
  housingHeight: 0.22,
  slatHeight: 0.1,
  bottomBarHeight: 0.1,
  stripeCount: 5,
  guideWidth: 0.07,
} as const;
const SHUTTER_SLAT: Shade = { dark: '#3b4047', mid: '#8a939d', light: '#d3dae2' };

/**
 * A steel roller shutter across one tile of a doorway, `drop` in [0, 1] of the
 * way down. Drawn across the tile's horizontal axis; a doorway in a side wall
 * turns it a quarter.
 */
export function drawGymShutter(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  drop: number,
): void {
  const guide = s * SHUTTER.guideWidth;
  drawPost(ctx, ox, oy, oy + s, guide, RACK_STEEL);
  drawPost(ctx, ox + s - guide, oy, oy + s, guide, RACK_STEEL);
  const housing = s * SHUTTER.housingHeight;
  const curtainBottom = oy + housing + (s - housing) * drop;
  const slat = s * SHUTTER.slatHeight;
  for (let y = oy + housing; y < curtainBottom; y += slat) {
    const h = Math.min(slat, curtainBottom - y);
    rect(
      ctx,
      ox + guide,
      y,
      s - guide * 2,
      h,
      cylinderGradient(ctx, 0, y, 0, y + slat, SHUTTER_SLAT),
    );
    rect(ctx, ox + guide, y + h - 1, s - guide * 2, 1, HAIRLINE);
  }
  if (drop > 0) {
    const barTop = curtainBottom - s * SHUTTER.bottomBarHeight;
    rect(ctx, ox + guide, barTop, s - guide * 2, s * SHUTTER.bottomBarHeight, GYM_YELLOW.mid);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + guide, barTop, s - guide * 2, s * SHUTTER.bottomBarHeight);
    ctx.clip();
    const step = (s - guide * 2) / SHUTTER.stripeCount;
    for (let stripe = 0; stripe <= SHUTTER.stripeCount; stripe++) {
      const x0 = ox + guide + stripe * step;
      fillPolygon(
        ctx,
        [
          [x0, barTop + s * SHUTTER.bottomBarHeight],
          [x0 + step * HALF, barTop + s * SHUTTER.bottomBarHeight],
          [x0 + step, barTop],
          [x0 + step * HALF, barTop],
        ],
        POWDER_COAT.dark,
      );
    }
    ctx.restore();
  }
  drawBar(ctx, ox, oy, s, housing, RACK_STEEL);
}

// ── Bowled plate ─────────────────────────────────────────────────────────────

/** Frames in one turn of a rolling plate's print. */
export const GYM_PLATE_FRAMES = 4;

const PLATE = {
  rx: 0.3,
  ry: 0.36,
  cy: 0.5,
  hubRadius: 0.08,
  bandShare: 0.78,
  markLength: 0.2,
  markThickness: 0.06,
  shadowRx: 0.34,
  shadowRy: 0.09,
  shadowY: 0.88,
} as const;

/** A red bumper plate rolling on its edge, its print a quarter turn further on each frame. */
export function drawGymPlate(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  frame: number,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * PLATE.shadowY,
    s * PLATE.shadowRx,
    s * PLATE.shadowRy,
  );
  const cx = ox + s * HALF;
  const cy = oy + s * PLATE.cy;
  ctx.fillStyle = cylinderGradient(ctx, cx - s * PLATE.rx, 0, cx + s * PLATE.rx, 0, HEX_RUBBER);
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * PLATE.rx, s * PLATE.ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = cylinderGradient(ctx, cx - s * PLATE.rx, 0, cx + s * PLATE.rx, 0, GYM_RED);
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * PLATE.rx * PLATE.bandShare, s * PLATE.ry * PLATE.bandShare, 0, 0, TAU);
  ctx.fill();
  const angle = (frame / GYM_PLATE_FRAMES) * (Math.PI / 2);
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = s * PLATE.markThickness;
  ctx.beginPath();
  for (const turn of [0, Math.PI]) {
    const a = angle + turn;
    const innerX = cx + Math.cos(a) * s * PLATE.hubRadius;
    const innerY = cy + Math.sin(a) * s * PLATE.hubRadius;
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(
      innerX + Math.cos(a) * s * PLATE.markLength,
      innerY + Math.sin(a) * s * PLATE.markLength,
    );
  }
  ctx.stroke();
  ctx.fillStyle = cylinderGradient(
    ctx,
    cx - s * PLATE.hubRadius,
    0,
    cx + s * PLATE.hubRadius,
    0,
    CHROME,
  );
  ctx.beginPath();
  ctx.arc(cx, cy, s * PLATE.hubRadius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, s * HAIRLINE_FRAC * 2);
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * PLATE.rx, s * PLATE.ry, 0, 0, TAU);
  ctx.stroke();
}

// ── Chalk puff ───────────────────────────────────────────────────────────────

/** Frames in a puff, from a tight burst to a thin haze. */
export const GYM_CHALK_FRAMES = 4;

const PUFF = {
  blobCount: 5,
  firstRadius: 0.12,
  radiusGrowth: 0.07,
  spread: 0.12,
  spreadGrowth: 0.06,
  cy: 0.6,
} as const;
const PUFF_ALPHAS = [0.85, 0.65, 0.42, 0.2];

/** A burst of chalk dust; later frames are wider and thinner. */
export function drawGymChalkPuff(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  frame: number,
): void {
  const alpha = PUFF_ALPHAS[Math.min(frame, PUFF_ALPHAS.length - 1)];
  const radius = s * (PUFF.firstRadius + frame * PUFF.radiusGrowth);
  const spread = s * (PUFF.spread + frame * PUFF.spreadGrowth);
  for (let blob = 0; blob < PUFF.blobCount; blob++) {
    const angle = (blob / PUFF.blobCount) * TAU + frame;
    const bx = ox + s * HALF + Math.cos(angle) * spread;
    const by = oy + s * PUFF.cy + Math.sin(angle) * spread * HALF;
    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
    gradient.addColorStop(0, `rgba(245,245,240,${alpha})`);
    gradient.addColorStop(1, 'rgba(245,245,240,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, TAU);
    ctx.fill();
  }
}

// ── Cracked mirror ───────────────────────────────────────────────────────────

/** Tiles along the wall a mirror crack spans. */
export const GYM_MIRROR_CRACK_TILES = 3;

const CRACK = {
  spokes: 11,
  rings: 3,
  ringStep: 0.22,
  reach: 1.45,
  jitter: 0.35,
  cy: 0.5,
} as const;
const CRACK_LIGHT = 'rgba(235,250,255,0.9)';
const CRACK_DARK = 'rgba(10,20,30,0.7)';

/**
 * A spiderweb crack across a horizontal run of mirror {@link GYM_MIRROR_CRACK_TILES}
 * tiles long, impact at the middle. Deterministic: no randomness, so every
 * floor's mirror breaks the same way.
 */
export function drawGymMirrorCrack(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
): void {
  const cx = ox + s * GYM_MIRROR_CRACK_TILES * HALF;
  const cy = oy + s * CRACK.cy;
  const spokeEnds: Point[] = [];
  for (let spoke = 0; spoke < CRACK.spokes; spoke++) {
    const wobble = Math.sin(spoke * CRACK_WOBBLE_FREQUENCY) * CRACK.jitter;
    const angle = (spoke / CRACK.spokes) * TAU + wobble;
    const reach =
      s * CRACK.reach * (1 - Math.abs(Math.sin(spoke * CRACK_LENGTH_FREQUENCY)) * CRACK.jitter);
    spokeEnds.push([
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach * CRACK_VERTICAL_SQUASH,
    ]);
  }
  for (const [ink, width] of [
    [CRACK_DARK, CRACK_DARK_WIDTH],
    [CRACK_LIGHT, CRACK_LIGHT_WIDTH],
  ] as const) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, s * width);
    ctx.beginPath();
    for (const [ex, ey] of spokeEnds) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
    }
    for (let ring = 1; ring <= CRACK.rings; ring++) {
      const share = ring * CRACK.ringStep;
      spokeEnds.forEach(([ex, ey], index) => {
        const next = spokeEnds[(index + 1) % spokeEnds.length];
        const ax = cx + (ex - cx) * share;
        const ay = cy + (ey - cy) * share;
        const bx = cx + (next[0] - cx) * share;
        const by = cy + (next[1] - cy) * share;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      });
    }
    ctx.stroke();
  }
  ctx.fillStyle = CHALK_FAINT;
  ctx.beginPath();
  ctx.arc(cx, cy, s * CRACK_IMPACT_RADIUS, 0, TAU);
  ctx.fill();
}
const CRACK_WOBBLE_FREQUENCY = 2.3;
const CRACK_LENGTH_FREQUENCY = 1.7;
const CRACK_VERTICAL_SQUASH = 0.34;
const CRACK_DARK_WIDTH = 0.05;
const CRACK_LIGHT_WIDTH = 0.022;
const CRACK_IMPACT_RADIUS = 0.07;
