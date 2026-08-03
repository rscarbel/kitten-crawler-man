/**
 * Painting for the floor-2 spider lab's life machines — the bio-printers that
 * extrude egg sacs and drop them onto the lab floor.
 *
 * The whole design exists to answer one question a player asks from across the
 * room: *where are these spiders coming from?* Every element is a printer part
 * with a visible job — a resin hopper feeding a heated nozzle, a print head that
 * climbs as the sac it is laying down grows under it, a glass chamber so the
 * half-finished sac is visible, and a delivery chute in the plinth whose
 * shutters open to put the finished sac on the floor the player walks on.
 *
 * Geometry: every coordinate here is in *frame* space — {@link FRAME_W} ×
 * {@link FRAME_H} pixels, drawn at a {@link TILE_SCALE} tile, with the frame's
 * bottom edge sitting on the bottom edge of the machine's one blocked tile and
 * the frame horizontally centred on it. Everything above the bottom tile row is
 * height the machine rises into the tiles behind it.
 *
 * The choreography (which pose each animation frame takes) lives in
 * `scripts/generate-life-machine-sprite.ts`.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Frame geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Two tiles wide: the plinth is one tile, the head and side panel overhang it. */
export const FRAME_W = TILE_SCALE * 2;
/** Three tiles tall — the height the runtime draws the machine at. */
export const FRAME_H = TILE_SCALE * 3;

const CENTER_X = FRAME_W / 2;

const TWO_PI = Math.PI * 2;

// Plinth: the part that stands on the blocked tile.
const BASE_TOP_Y = 146;
const BASE_BOTTOM_Y = 188;
/**
 * The plinth is the only part of the machine at floor level, and it may not
 * overhang the single tile the machine blocks — sideways overhang at floor
 * level lets the player stand *inside* the prop.
 */
const BASE_HALF_W_BOTTOM = TILE_SCALE / 2;
const BASE_HALF_W_TOP = BASE_HALF_W_BOTTOM - 6;
const BASE_RIM_H = 6;
const BASE_FOOT_H = 5;
const BASE_FOOT_W = 12;

/**
 * Delivery chute cut into the plinth's front face. It runs down to the floor
 * line: a finished sac has to fit through it and come to rest on the ground,
 * and a hatch that stops short of the floor makes the sac look stuck inside.
 */
const CHUTE_X0 = CENTER_X - 20;
const CHUTE_X1 = CENTER_X + 20;
const CHUTE_TOP_Y = 150;
const CHUTE_BOTTOM_Y = 186;
const CHUTE_TRAVEL = CHUTE_X1 - CHUTE_X0;

// Print chamber: the glass tube the sac is built inside.
const CHAMBER_X0 = CENTER_X - 28;
const CHAMBER_X1 = CENTER_X + 28;
const CHAMBER_TOP_Y = 58;
const CHAMBER_BOTTOM_Y = BASE_TOP_Y;
const CHAMBER_W = CHAMBER_X1 - CHAMBER_X0;
const CHAMBER_H = CHAMBER_BOTTOM_Y - CHAMBER_TOP_Y;
const CHAMBER_CAP_RY = 7;

/** Vertical rails the print head rides, just inside the glass. */
const RAIL_INSET = 4;
const RAIL_HALF_W = 2;

// Build plate the sac is printed on. It has to clear the chamber's bottom
// collar, or the plate and the first printed layers hide behind the metal.
const PLATE_Y = CHAMBER_BOTTOM_Y - 16;
const PLATE_HALF_W = 21;
const PLATE_H = 5;

// Head housing: hopper, extruder motor, gauge, beacon.
const HEAD_X0 = CENTER_X - 38;
const HEAD_X1 = CENTER_X + 38;
const HEAD_TOP_Y = 18;
const HEAD_BOTTOM_Y = CHAMBER_TOP_Y;

const HOPPER_X0 = CENTER_X - 30;
const HOPPER_X1 = CENTER_X + 8;
const HOPPER_TOP_Y = 23;
const HOPPER_BOTTOM_Y = 50;

const GAUGE_X = CENTER_X + 22;
const GAUGE_Y = 36;
const GAUGE_R = 9;
const GAUGE_SWEEP_START = Math.PI * 0.75;
const GAUGE_SWEEP_RANGE = Math.PI * 1.5;

const BEACON_X = CENTER_X + 22;
const BEACON_Y = HEAD_TOP_Y - 1;
const BEACON_R = 6;

// Side control panel.
const PANEL_X0 = CHAMBER_X1 - 2;
const PANEL_X1 = PANEL_X0 + 28;
const PANEL_TOP_Y = 72;
const PANEL_BOTTOM_Y = 118;
const SCREEN_INSET_X = 4;
const SCREEN_TOP_Y = PANEL_TOP_Y + 5;
const SCREEN_BOTTOM_Y = PANEL_TOP_Y + 27;
const LED_Y = PANEL_BOTTOM_Y - 11;
const LED_R = 2.6;
const LED_COUNT = 3;
const LED_SPACING = 8;
const LED_FIRST_X = PANEL_X0 + 7;

/** Light strip around the chamber's bottom collar. */
const COLLAR_TOP_Y = CHAMBER_BOTTOM_Y - 6;
const COLLAR_H = 4;

// Nozzle travel limits — parked just under the head, lowest at the build plate.
const NOZZLE_PARK_Y = CHAMBER_TOP_Y + 12;
const NOZZLE_LOW_Y = PLATE_Y - 8;
const NOZZLE_SWEEP_HALF_W = 12;
const CARRIAGE_HALF_W = 15;
const CARRIAGE_H = 9;
const NOZZLE_H = 8;
const NOZZLE_TIP_HALF_W = 1.6;
const NOZZLE_TOP_HALF_W = 5;

// Sac dimensions at full growth. Sized to clear the delivery chute — a sac
// that cannot fit through the hatch it is delivered by reads as two objects.
const SAC_RX = 17;
const SAC_RY = 18;
const SAC_LAYER_H = 3.4;

// ── Palette ──────────────────────────────────────────────────────────────────

const STEEL_DARK = '#2b3138';
const STEEL_MID = '#4b545e';
const STEEL_LIGHT = '#77828e';
const STEEL_HIGHLIGHT = '#a3aeba';
const STEEL_SHADOW = '#1b2026';
const CHAMBER_VOID = '#141a1c';
const GLASS_TINT = 'rgba(168, 206, 214, 0.10)';
const GLASS_RIM = 'rgba(198, 232, 240, 0.55)';
const RESIN = '#d9c6a4';
const RESIN_DARK = '#a68f68';
const SILK = '#e6e2d6';
const SILK_SHADE = '#b4ae9c';
const SILK_DEAD = '#6f6d66';
const HOT_CORE = '#ffe2ab';
const CABLE = '#20252a';

export const LED_GREEN = '#66ff9c';
export const LED_RED = '#ff4436';

const SHADOW_COLOR = 'rgba(0, 0, 0, 0.38)';

// ── Numeric helpers ──────────────────────────────────────────────────────────

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeInOut(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

/** 0 → 1 → 0 over the unit interval; the shape most "pulse" values want. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/**
 * node-canvas drops a whole `rgba()` when an alpha serialises in exponent form
 * (`5e-17`), baking a solid smear where a fade should be — so every computed
 * alpha in this module goes through here.
 */
function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp01(a).toFixed(3)})`;
}

function white(a: number): string {
  return rgba(255, 255, 255, a);
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function verticalGradientFill(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: ReadonlyArray<readonly [number, string]>,
): void {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

/** Left-lit metal: the single cue that turns a flat rectangle into a panel. */
function horizontalGradientFill(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: ReadonlyArray<readonly [number, string]>,
): void {
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

const BOLT_R = 1.5;

function drawBolt(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = STEEL_SHADOW;
  ctx.beginPath();
  ctx.arc(x, y, BOLT_R + 0.6, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = STEEL_HIGHLIGHT;
  ctx.beginPath();
  ctx.arc(x - 0.3, y - 0.3, BOLT_R, 0, TWO_PI);
  ctx.fill();
}

const GRILLE_SLAT_SPACING = 3;

function drawGrille(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = STEEL_SHADOW;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(122, 133, 145, 0.55);
  for (let slatY = y + 1; slatY < y + h - 1; slatY += GRILLE_SLAT_SPACING) {
    ctx.fillRect(x + 1, slatY, w - 2, 1);
  }
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** What the sac inside (or under) the machine currently is. */
export type SacForm = 'none' | 'printing' | 'finished' | 'split' | 'husk' | 'dead';

export interface LifeMachinePose {
  /** 0 = dead metal, 1 = every lamp and fluid at full brightness. */
  readonly power: number;
  /** 0 = print head parked under the head housing, 1 = down at the build plate. */
  readonly nozzleTravel: number;
  /** -1…1 lateral offset of the print head as it lays a layer. */
  readonly nozzleSweep: number;
  /** 0 = cold steel, 1 = white-hot and extruding. */
  readonly nozzleHeat: number;
  /** Draws silk threads running from the nozzle down to the sac's top layer. */
  readonly extruding: boolean;
  /** 0 = bare plate, 1 = a finished, full-height sac. */
  readonly sacGrowth: number;
  readonly sacForm: SacForm;
  /** 0 = sac still up in the chamber, 1 = lowered into the delivery chute. */
  readonly plateDrop: number;
  /** 0 = chute shutters closed, 1 = fully open. */
  readonly shutterOpen: number;
  /**
   * How far the delivered sac has torn open, 0…1. Separate from `shutterOpen`
   * because a husk stays torn while the shutters close over it.
   */
  readonly sacTear: number;
  /** 0 = no vent steam, 1 = a full billow. */
  readonly steam: number;
  /** How full the resin hopper reads, 0…1. */
  readonly hopperLevel: number;
  /** Loop phase (0…1) for fluid drift, bubbles and thread wobble. */
  readonly fluidPhase: number;
  /** Pressure gauge needle, 0…1 across the dial. */
  readonly gauge: number;
}

export const RESTING_POSE: LifeMachinePose = {
  power: 0.35,
  nozzleTravel: 0,
  nozzleSweep: 0,
  nozzleHeat: 0,
  extruding: false,
  sacGrowth: 0,
  sacForm: 'none',
  plateDrop: 0,
  shutterOpen: 0,
  sacTear: 0,
  steam: 0,
  hopperLevel: 0.85,
  fluidPhase: 0,
  gauge: 0.12,
};

// ── Sub-painters ─────────────────────────────────────────────────────────────

const FLOOR_SHADOW_RY = 7;

function drawFloorShadow(ctx: Ctx): void {
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(CENTER_X, BASE_BOTTOM_Y - 1, BASE_HALF_W_BOTTOM + 5, FLOOR_SHADOW_RY, 0, 0, TWO_PI);
  ctx.fill();
}

const CABLE_WIDTHS: readonly number[] = [4, 3, 2.5];
const CABLE_ANCHOR_Y = BASE_BOTTOM_Y - 14;
const CABLE_SPREAD_Y = 5;
const CABLE_RUN_X = 30;

/** Power and coolant runs leaving the plinth — the machine is plumbed into the room. */
function drawCables(ctx: Ctx): void {
  ctx.lineCap = 'round';
  CABLE_WIDTHS.forEach((width, index) => {
    const startY = CABLE_ANCHOR_Y + index * CABLE_SPREAD_Y;
    const endX = CENTER_X - BASE_HALF_W_BOTTOM - CABLE_RUN_X + index * 6;
    const endY = BASE_BOTTOM_Y - 2 + index;
    ctx.strokeStyle = CABLE;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(CENTER_X - BASE_HALF_W_TOP + 4, startY);
    ctx.quadraticCurveTo(endX + 14, startY + 10, endX, endY);
    ctx.stroke();
    ctx.strokeStyle = rgba(120, 130, 140, 0.35);
    ctx.lineWidth = Math.max(1, width - 2.4);
    ctx.beginPath();
    ctx.moveTo(CENTER_X - BASE_HALF_W_TOP + 4, startY - width * 0.25);
    ctx.quadraticCurveTo(endX + 14, startY + 10 - width * 0.25, endX, endY - width * 0.25);
    ctx.stroke();
  });
}

/** Amber-green nutrient haze and its bubbles, seen through the glass. */
function drawChamberAtmosphere(ctx: Ctx, pose: LifeMachinePose): void {
  const glow = clamp01(pose.power);
  if (glow <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H);
  ctx.clip();

  const haze = ctx.createLinearGradient(
    CENTER_X,
    CHAMBER_BOTTOM_Y,
    CENTER_X,
    CHAMBER_TOP_Y + CHAMBER_H * 0.2,
  );
  haze.addColorStop(0, rgba(143, 174, 78, 0.42 * glow));
  haze.addColorStop(1, rgba(143, 174, 78, 0.04 * glow));
  ctx.fillStyle = haze;
  ctx.fillRect(CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H);

  const BUBBLE_COUNT = 9;
  const BUBBLE_MAX_R = 2.2;
  for (let index = 0; index < BUBBLE_COUNT; index++) {
    const columnT = (index + 0.5) / BUBBLE_COUNT;
    const rise = (pose.fluidPhase + index / BUBBLE_COUNT) % 1;
    const bubbleX = CHAMBER_X0 + columnT * CHAMBER_W + Math.sin(rise * TWO_PI + index) * 2;
    const bubbleY = CHAMBER_BOTTOM_Y - rise * CHAMBER_H;
    const radius = BUBBLE_MAX_R * (0.4 + ((index * 7) % 5) / 8);
    ctx.fillStyle = rgba(201, 236, 124, 0.5 * glow * (1 - rise * 0.7));
    ctx.beginPath();
    ctx.arc(bubbleX, bubbleY, radius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** The dark inner wall behind the sac, so the chamber reads as a volume. */
function drawChamberInterior(ctx: Ctx, pose: LifeMachinePose): void {
  verticalGradientFill(ctx, CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H, [
    [0, CHAMBER_VOID],
    [0.55, '#1c2427'],
    [1, '#0e1214'],
  ]);

  const RIB_COUNT = 5;
  const ribSpacing = CHAMBER_H / (RIB_COUNT + 1);
  ctx.fillStyle = rgba(90, 104, 110, 0.3);
  for (let index = 1; index <= RIB_COUNT; index++) {
    ctx.fillRect(CHAMBER_X0 + 3, CHAMBER_TOP_Y + index * ribSpacing, CHAMBER_W - 6, 1);
  }

  drawChamberAtmosphere(ctx, pose);
}

function drawBuildPlate(ctx: Ctx, plateY: number): void {
  ctx.fillStyle = STEEL_SHADOW;
  ctx.fillRect(CENTER_X - PLATE_HALF_W, plateY, PLATE_HALF_W * 2, PLATE_H);
  ctx.fillStyle = STEEL_LIGHT;
  ctx.fillRect(CENTER_X - PLATE_HALF_W, plateY, PLATE_HALF_W * 2, 1.6);
  ctx.fillStyle = rgba(35, 40, 46, 0.9);
  ctx.fillRect(CENTER_X - 2, plateY + PLATE_H, 4, CHAMBER_BOTTOM_Y - plateY);
}

const EMBRYO_LEG_COUNT = 4;
const EMBRYO_VISIBLE_GROWTH = 0.55;

/** A curled spiderling silhouette showing through the silk once the sac has bulk. */
function drawEmbryo(ctx: Ctx, cx: number, cy: number, scale: number, alpha: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = rgba(57, 48, 42, alpha);
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (let index = 0; index < EMBRYO_LEG_COUNT; index++) {
    const spread = (index - (EMBRYO_LEG_COUNT - 1) / 2) * 0.42;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * 6, spread * 6 - 2, side * 9, spread * 8 + 4);
      ctx.stroke();
    }
  }
  ctx.fillStyle = rgba(57, 48, 42, alpha);
  ctx.beginPath();
  ctx.ellipse(0, 1, 4, 3.2, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

interface SacOptions {
  readonly cx: number;
  /** Y the sac's underside rests on. */
  readonly baseY: number;
  readonly growth: number;
  readonly form: SacForm;
  readonly fluidPhase: number;
}

/**
 * The sac itself. A printing sac is the *finished* silhouette clipped to the
 * height printed so far, which is what sells the layer-by-layer build: the top
 * of the shape is always a flat, freshly-laid band rather than a rounded egg
 * that merely got bigger.
 */
function drawSac(ctx: Ctx, options: SacOptions): void {
  const { cx, baseY, growth, form, fluidPhase } = options;
  if (form === 'none' || growth <= 0) return;

  const dead = form === 'dead';
  const silkBody = dead ? SILK_DEAD : SILK;
  const silkShade = dead ? '#4e4c46' : SILK_SHADE;
  const fullHeight = SAC_RY * 2;
  const printedHeight = fullHeight * clamp01(growth);
  const centerY = baseY - SAC_RY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - SAC_RX - 2, baseY - printedHeight, SAC_RX * 2 + 4, printedHeight + 2);
  ctx.clip();

  const body = ctx.createRadialGradient(
    cx - SAC_RX * 0.3,
    centerY - SAC_RY * 0.3,
    2,
    cx,
    centerY,
    SAC_RX * 1.5,
  );
  body.addColorStop(0, dead ? '#7d7b74' : '#f2efe6');
  body.addColorStop(0.6, silkBody);
  body.addColorStop(1, silkShade);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, centerY, SAC_RX, SAC_RY, 0, 0, TWO_PI);
  ctx.fill();

  if (growth > EMBRYO_VISIBLE_GROWTH && !dead) {
    const embryoAlpha = 0.42 * clamp01((growth - EMBRYO_VISIBLE_GROWTH) * 3);
    drawEmbryo(ctx, cx, centerY + 2, 0.9, embryoAlpha);
  }

  // Printed layer bands. They read as strata in a finished sac and as tool
  // marks in a growing one, which is the same cue either way: this was made.
  ctx.strokeStyle = rgba(150, 145, 132, dead ? 0.35 : 0.5);
  ctx.lineWidth = 0.7;
  for (let layerY = baseY - SAC_LAYER_H; layerY > baseY - printedHeight; layerY -= SAC_LAYER_H) {
    ctx.beginPath();
    ctx.moveTo(cx - SAC_RX, layerY);
    ctx.lineTo(cx + SAC_RX, layerY);
    ctx.stroke();
  }

  if (!dead) {
    const wispCount = 7;
    ctx.strokeStyle = white(0.4);
    ctx.lineWidth = 0.6;
    for (let index = 0; index < wispCount; index++) {
      const angle = (index / wispCount) * TWO_PI + fluidPhase * TWO_PI * 0.15;
      const startR = SAC_RX * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * startR, centerY + Math.sin(angle) * startR * 0.9);
      ctx.quadraticCurveTo(
        cx + Math.cos(angle + 0.5) * SAC_RX * 0.8,
        centerY + Math.sin(angle + 0.5) * SAC_RY * 0.8,
        cx + Math.cos(angle) * SAC_RX * 0.95,
        centerY + Math.sin(angle) * SAC_RY * 0.95,
      );
      ctx.stroke();
    }
  }

  if (form === 'printing') {
    // The band currently under the nozzle is still molten.
    const freshY = baseY - printedHeight;
    const freshHalfW = SAC_RX * Math.sqrt(Math.max(0, 1 - ((freshY - centerY) / SAC_RY) ** 2));
    ctx.fillStyle = rgba(255, 226, 171, 0.75);
    ctx.fillRect(cx - freshHalfW, freshY, freshHalfW * 2, 1.8);
  }
  ctx.restore();

  ctx.strokeStyle = rgba(120, 116, 106, dead ? 0.5 : 0.7);
  ctx.lineWidth = 0.8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - SAC_RX - 2, baseY - printedHeight, SAC_RX * 2 + 4, printedHeight + 2);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx, centerY, SAC_RX, SAC_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

const TEAR_POINT_COUNT = 9;
const TEAR_JAG = 0.2;
/** A husk has slumped and dried out; a fresh split still holds the sac's volume. */
const HUSK_SQUASH = 0.78;
const HUSK_SPREAD = 1.05;

/**
 * A delivered sac: whole, but torn open where the spiderling came out.
 *
 * Peeled-apart halves were the first attempt and they failed at play size — a
 * 34px-wide sac split down the middle just reads as two unrelated white lumps.
 * Keeping the silhouette intact and cutting a ragged dark mouth into it survives
 * the downscale, because the shape the player already learned stays on screen.
 */
function drawTornSac(ctx: Ctx, cx: number, baseY: number, openness: number, husk: boolean): void {
  const rx = SAC_RX * (husk ? HUSK_SPREAD : 1);
  const ry = SAC_RY * (husk ? HUSK_SQUASH : 1);
  const centerY = baseY - ry;

  const body = ctx.createRadialGradient(
    cx - rx * 0.3,
    centerY - ry * 0.35,
    2,
    cx,
    centerY,
    rx * 1.5,
  );
  body.addColorStop(0, husk ? '#8d8a80' : '#f2efe6');
  body.addColorStop(0.6, husk ? SILK_DEAD : SILK);
  body.addColorStop(1, husk ? '#4e4c46' : SILK_SHADE);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, centerY, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  if (!husk) {
    ctx.strokeStyle = rgba(150, 145, 132, 0.5);
    ctx.lineWidth = 0.7;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, centerY, rx, ry, 0, 0, TWO_PI);
    ctx.clip();
    for (let layerY = baseY - SAC_LAYER_H; layerY > baseY - ry * 2; layerY -= SAC_LAYER_H) {
      ctx.beginPath();
      ctx.moveTo(cx - rx, layerY);
      ctx.lineTo(cx + rx, layerY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The ragged mouth. Its radius is what `openness` drives: the tear widens as
  // the sac clears the machine.
  const mouthRx = rx * lerp(0.12, 0.34, easeInOut(openness));
  const mouthRy = ry * lerp(0.14, 0.4, easeInOut(openness));
  ctx.beginPath();
  for (let index = 0; index <= TEAR_POINT_COUNT; index++) {
    const angle = (index / TEAR_POINT_COUNT) * TWO_PI;
    const jag = 1 + (index % 2 === 0 ? TEAR_JAG : -TEAR_JAG);
    const pointX = cx + Math.cos(angle) * mouthRx * jag;
    const pointY = centerY - ry * 0.2 + Math.sin(angle) * mouthRy * jag;
    if (index === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(38, 31, 26, husk ? 0.7 : 0.85);
  ctx.fill();
  ctx.strokeStyle = white(husk ? 0.2 : 0.45);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Strands still bridging the tear.
  ctx.strokeStyle = white(husk ? 0.22 : 0.5);
  ctx.lineWidth = 0.6;
  const STRAND_COUNT = 3;
  for (let index = 0; index < STRAND_COUNT; index++) {
    const strandY = centerY - mouthRy * 0.5 + (index / (STRAND_COUNT - 1)) * mouthRy;
    ctx.beginPath();
    ctx.moveTo(cx - mouthRx, strandY);
    ctx.quadraticCurveTo(cx, strandY + 2, cx + mouthRx, strandY);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(110, 106, 98, 0.8);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(cx, centerY, rx, ry, 0, 0, TWO_PI);
  ctx.stroke();
}

function nozzleYFor(pose: LifeMachinePose): number {
  return lerp(NOZZLE_PARK_Y, NOZZLE_LOW_Y, easeInOut(pose.nozzleTravel));
}

const THREAD_COUNT = 3;

/** The print head: carriage on the rails, heated nozzle, silk in flight. */
function drawPrintHead(ctx: Ctx, pose: LifeMachinePose, sacTopY: number): void {
  const headX = CENTER_X + pose.nozzleSweep * NOZZLE_SWEEP_HALF_W;
  const headY = nozzleYFor(pose);

  // Carriage yoke reaching out to both rails, so the head reads as driven.
  ctx.strokeStyle = STEEL_MID;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CHAMBER_X0 + RAIL_INSET, headY);
  ctx.lineTo(CHAMBER_X1 - RAIL_INSET, headY);
  ctx.stroke();

  horizontalGradientFill(
    ctx,
    headX - CARRIAGE_HALF_W,
    headY - CARRIAGE_H / 2,
    CARRIAGE_HALF_W * 2,
    CARRIAGE_H,
    [
      [0, STEEL_LIGHT],
      [0.45, STEEL_MID],
      [1, STEEL_SHADOW],
    ],
  );
  ctx.fillStyle = STEEL_HIGHLIGHT;
  ctx.fillRect(headX - CARRIAGE_HALF_W, headY - CARRIAGE_H / 2, CARRIAGE_HALF_W * 2, 1);

  const nozzleTopY = headY + CARRIAGE_H / 2;
  const nozzleTipY = nozzleTopY + NOZZLE_H;
  ctx.beginPath();
  ctx.moveTo(headX - NOZZLE_TOP_HALF_W, nozzleTopY);
  ctx.lineTo(headX + NOZZLE_TOP_HALF_W, nozzleTopY);
  ctx.lineTo(headX + NOZZLE_TIP_HALF_W, nozzleTipY);
  ctx.lineTo(headX - NOZZLE_TIP_HALF_W, nozzleTipY);
  ctx.closePath();
  const nozzleBody = ctx.createLinearGradient(
    headX - NOZZLE_TOP_HALF_W,
    0,
    headX + NOZZLE_TOP_HALF_W,
    0,
  );
  nozzleBody.addColorStop(0, STEEL_LIGHT);
  nozzleBody.addColorStop(1, STEEL_SHADOW);
  ctx.fillStyle = nozzleBody;
  ctx.fill();

  const heat = clamp01(pose.nozzleHeat);
  if (heat > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(headX, nozzleTipY, 0, headX, nozzleTipY, 9 * heat + 2);
    glow.addColorStop(0, rgba(255, 226, 171, 0.85 * heat));
    glow.addColorStop(0.45, rgba(255, 138, 58, 0.45 * heat));
    glow.addColorStop(1, rgba(255, 138, 58, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(headX, nozzleTipY, 9 * heat + 2, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = HOT_CORE;
    ctx.beginPath();
    ctx.arc(headX, nozzleTipY - 0.5, 1.4 + heat, 0, TWO_PI);
    ctx.fill();
  }

  if (pose.extruding && sacTopY > nozzleTipY) {
    ctx.lineCap = 'round';
    for (let index = 0; index < THREAD_COUNT; index++) {
      const wobblePhase = pose.fluidPhase * TWO_PI + index * 2;
      const spread = (index - (THREAD_COUNT - 1) / 2) * 2.2;
      ctx.strokeStyle = index === 1 ? rgba(255, 226, 171, 0.85) : white(0.55);
      ctx.lineWidth = index === 1 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(headX + spread * 0.3, nozzleTipY);
      ctx.quadraticCurveTo(
        headX + spread + Math.sin(wobblePhase) * 1.6,
        (nozzleTipY + sacTopY) / 2,
        headX + spread * 1.4,
        sacTopY,
      );
      ctx.stroke();
    }
  }
}

/** Glass front: tint, vertical highlight, rim caps. Drawn over the contents. */
function drawGlass(ctx: Ctx): void {
  ctx.fillStyle = GLASS_TINT;
  ctx.fillRect(CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H);

  const sheen = ctx.createLinearGradient(CHAMBER_X0, 0, CHAMBER_X1, 0);
  sheen.addColorStop(0, white(0.16));
  sheen.addColorStop(0.16, white(0.04));
  sheen.addColorStop(0.5, white(0));
  sheen.addColorStop(0.82, white(0.05));
  sheen.addColorStop(1, white(0.2));
  ctx.fillStyle = sheen;
  ctx.fillRect(CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H);

  ctx.fillStyle = white(0.28);
  ctx.fillRect(CHAMBER_X0 + 6, CHAMBER_TOP_Y + 6, 2, CHAMBER_H * 0.45);

  ctx.strokeStyle = GLASS_RIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(CHAMBER_X0 + 0.5, CHAMBER_TOP_Y + 0.5, CHAMBER_W - 1, CHAMBER_H - 1);

  ctx.fillStyle = rgba(120, 150, 156, 0.35);
  ctx.beginPath();
  ctx.ellipse(CENTER_X, CHAMBER_TOP_Y, CHAMBER_W / 2, CHAMBER_CAP_RY, 0, 0, TWO_PI);
  ctx.fill();
}

function drawRails(ctx: Ctx): void {
  for (const side of [-1, 1]) {
    const railX = CENTER_X + side * (CHAMBER_W / 2 - RAIL_INSET);
    verticalGradientFill(
      ctx,
      railX - RAIL_HALF_W,
      CHAMBER_TOP_Y + 2,
      RAIL_HALF_W * 2,
      CHAMBER_H - 4,
      [
        [0, STEEL_HIGHLIGHT],
        [0.5, STEEL_MID],
        [1, STEEL_SHADOW],
      ],
    );
  }
}

const PIPE_COUNT = 2;
const PIPE_W = 4;

/** Feed lines carrying resin from the hopper down into the print head. */
function drawFeedPipes(ctx: Ctx, pose: LifeMachinePose): void {
  const headY = nozzleYFor(pose);
  for (let index = 0; index < PIPE_COUNT; index++) {
    const side = index === 0 ? -1 : 1;
    const topX = CENTER_X + side * 10;
    const bottomX = CENTER_X + side * (CHAMBER_W / 2 - RAIL_INSET - 1);
    ctx.strokeStyle = STEEL_DARK;
    ctx.lineWidth = PIPE_W;
    ctx.beginPath();
    ctx.moveTo(topX, HOPPER_BOTTOM_Y - 2);
    ctx.quadraticCurveTo(topX + side * 8, CHAMBER_TOP_Y - 2, bottomX, CHAMBER_TOP_Y + 6);
    ctx.stroke();
    ctx.strokeStyle = rgba(150, 160, 170, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(topX - side, HOPPER_BOTTOM_Y - 2);
    ctx.quadraticCurveTo(topX + side * 7, CHAMBER_TOP_Y - 2, bottomX - side, CHAMBER_TOP_Y + 6);
    ctx.stroke();
  }

  // A flexible umbilical follows the carriage down the chamber.
  ctx.strokeStyle = rgba(40, 46, 52, 0.9);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(CHAMBER_X0 + RAIL_INSET + 2, CHAMBER_TOP_Y + 6);
  ctx.quadraticCurveTo(
    CHAMBER_X0 + 6,
    (CHAMBER_TOP_Y + headY) / 2,
    CENTER_X + pose.nozzleSweep * NOZZLE_SWEEP_HALF_W - CARRIAGE_HALF_W + 2,
    headY - 1,
  );
  ctx.stroke();
}

const HOPPER_RESIN_TOP_PAD = 3;

function drawHeadHousing(ctx: Ctx, pose: LifeMachinePose): void {
  const headW = HEAD_X1 - HEAD_X0;
  const headH = HEAD_BOTTOM_Y - HEAD_TOP_Y;

  roundedRect(ctx, HEAD_X0, HEAD_TOP_Y, headW, headH, 4);
  const shellGradient = ctx.createLinearGradient(HEAD_X0, 0, HEAD_X1, 0);
  shellGradient.addColorStop(0, STEEL_LIGHT);
  shellGradient.addColorStop(0.4, STEEL_MID);
  shellGradient.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = shellGradient;
  ctx.fill();
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = white(0.18);
  ctx.fillRect(HEAD_X0 + 3, HEAD_TOP_Y + 2, headW - 6, 1.4);

  // Resin hopper — a window onto the machine's stock of raw material.
  const hopperW = HOPPER_X1 - HOPPER_X0;
  const hopperH = HOPPER_BOTTOM_Y - HOPPER_TOP_Y;
  roundedRect(ctx, HOPPER_X0, HOPPER_TOP_Y, hopperW, hopperH, 3);
  ctx.fillStyle = rgba(30, 36, 40, 0.9);
  ctx.fill();

  const resinTop = HOPPER_BOTTOM_Y - (hopperH - HOPPER_RESIN_TOP_PAD) * clamp01(pose.hopperLevel);
  ctx.save();
  roundedRect(ctx, HOPPER_X0, HOPPER_TOP_Y, hopperW, hopperH, 3);
  ctx.clip();
  verticalGradientFill(ctx, HOPPER_X0, resinTop, hopperW, HOPPER_BOTTOM_Y - resinTop, [
    [0, RESIN],
    [1, RESIN_DARK],
  ]);
  ctx.fillStyle = white(0.35);
  ctx.fillRect(HOPPER_X0, resinTop, hopperW, 1);
  // Slurry churn: the stock is being consumed right now.
  const churnCount = 4;
  for (let index = 0; index < churnCount; index++) {
    const churnX = HOPPER_X0 + ((index + 0.5) / churnCount) * hopperW;
    const churnY = resinTop + 3 + Math.sin(pose.fluidPhase * TWO_PI + index) * 2;
    ctx.fillStyle = rgba(255, 245, 225, 0.25);
    ctx.beginPath();
    ctx.arc(churnX, churnY, 1.4, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 1;
  roundedRect(ctx, HOPPER_X0 + 0.5, HOPPER_TOP_Y + 0.5, hopperW - 1, hopperH - 1, 3);
  ctx.stroke();

  const gaugeFace = ctx.createRadialGradient(
    GAUGE_X - 2,
    GAUGE_Y - 2,
    1,
    GAUGE_X,
    GAUGE_Y,
    GAUGE_R,
  );
  gaugeFace.addColorStop(0, '#dfe4e8');
  gaugeFace.addColorStop(1, '#8e98a2');
  ctx.fillStyle = gaugeFace;
  ctx.beginPath();
  ctx.arc(GAUGE_X, GAUGE_Y, GAUGE_R, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const TICK_COUNT = 7;
  ctx.strokeStyle = rgba(40, 46, 52, 0.7);
  ctx.lineWidth = 0.8;
  for (let index = 0; index < TICK_COUNT; index++) {
    const angle = GAUGE_SWEEP_START + (index / (TICK_COUNT - 1)) * GAUGE_SWEEP_RANGE;
    ctx.beginPath();
    ctx.moveTo(
      GAUGE_X + Math.cos(angle) * (GAUGE_R - 3),
      GAUGE_Y + Math.sin(angle) * (GAUGE_R - 3),
    );
    ctx.lineTo(
      GAUGE_X + Math.cos(angle) * (GAUGE_R - 1),
      GAUGE_Y + Math.sin(angle) * (GAUGE_R - 1),
    );
    ctx.stroke();
  }
  const needleAngle = GAUGE_SWEEP_START + clamp01(pose.gauge) * GAUGE_SWEEP_RANGE;
  ctx.strokeStyle = '#c4322a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(GAUGE_X, GAUGE_Y);
  ctx.lineTo(
    GAUGE_X + Math.cos(needleAngle) * (GAUGE_R - 2),
    GAUGE_Y + Math.sin(needleAngle) * (GAUGE_R - 2),
  );
  ctx.stroke();

  // Beacon housing; the lamp itself is painted by the light overlay.
  ctx.fillStyle = STEEL_DARK;
  ctx.beginPath();
  ctx.arc(BEACON_X, BEACON_Y, BEACON_R, Math.PI, TWO_PI);
  ctx.fill();
  ctx.fillStyle = STEEL_MID;
  ctx.fillRect(BEACON_X - BEACON_R, BEACON_Y - 1, BEACON_R * 2, 2.5);

  drawGrille(ctx, HEAD_X0 + 4, HEAD_BOTTOM_Y - 9, 18, 6);
  drawBolt(ctx, HEAD_X0 + 4, HEAD_TOP_Y + 4);
  drawBolt(ctx, HEAD_X1 - 4, HEAD_TOP_Y + 4);
  drawBolt(ctx, HEAD_X0 + 4, HEAD_BOTTOM_Y - 3);
  drawBolt(ctx, HEAD_X1 - 4, HEAD_BOTTOM_Y - 3);
}

function drawControlPanel(ctx: Ctx): void {
  const panelW = PANEL_X1 - PANEL_X0;
  const panelH = PANEL_BOTTOM_Y - PANEL_TOP_Y;
  roundedRect(ctx, PANEL_X0, PANEL_TOP_Y, panelW, panelH, 3);
  const shell = ctx.createLinearGradient(PANEL_X0, 0, PANEL_X1, 0);
  shell.addColorStop(0, STEEL_MID);
  shell.addColorStop(0.35, STEEL_LIGHT);
  shell.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#0d1412';
  ctx.fillRect(
    PANEL_X0 + SCREEN_INSET_X,
    SCREEN_TOP_Y,
    panelW - SCREEN_INSET_X * 2,
    SCREEN_BOTTOM_Y - SCREEN_TOP_Y,
  );
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.strokeRect(
    PANEL_X0 + SCREEN_INSET_X + 0.5,
    SCREEN_TOP_Y + 0.5,
    panelW - SCREEN_INSET_X * 2 - 1,
    SCREEN_BOTTOM_Y - SCREEN_TOP_Y - 1,
  );

  // Sockets the lamps sit in, so an unlit panel still reads as having lamps.
  for (let index = 0; index < LED_COUNT; index++) {
    ctx.fillStyle = STEEL_SHADOW;
    ctx.beginPath();
    ctx.arc(LED_FIRST_X + index * LED_SPACING, LED_Y, LED_R + 1.2, 0, TWO_PI);
    ctx.fill();
  }

  const KNOB_Y = PANEL_BOTTOM_Y - 22;
  for (const knobX of [PANEL_X0 + 8, PANEL_X0 + 19]) {
    ctx.fillStyle = STEEL_DARK;
    ctx.beginPath();
    ctx.arc(knobX, KNOB_Y, 3.2, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = STEEL_HIGHLIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(knobX, KNOB_Y);
    ctx.lineTo(knobX + 2, KNOB_Y - 2);
    ctx.stroke();
  }

  drawBolt(ctx, PANEL_X0 + 3, PANEL_TOP_Y + 3);
  drawBolt(ctx, PANEL_X1 - 3, PANEL_BOTTOM_Y - 3);
}

function drawCollar(ctx: Ctx): void {
  horizontalGradientFill(ctx, CHAMBER_X0 - 3, COLLAR_TOP_Y, CHAMBER_W + 6, COLLAR_H + 4, [
    [0, STEEL_LIGHT],
    [0.4, STEEL_MID],
    [1, STEEL_DARK],
  ]);
  ctx.fillStyle = STEEL_SHADOW;
  ctx.fillRect(CHAMBER_X0 - 3, COLLAR_TOP_Y + COLLAR_H + 3, CHAMBER_W + 6, 1);
}

const CHEVRON_COUNT = 3;
const CHEVRON_H = 5;
const HAZARD_STRIPE = 'rgba(226, 156, 38, 0.75)';

/** Hazard chevrons pointing down the way the sac travels: out and onto the floor. */
function drawShutterChevrons(ctx: Ctx, doorX: number, doorW: number, chuteH: number): void {
  ctx.strokeStyle = HAZARD_STRIPE;
  ctx.lineWidth = 2;
  for (let index = 0; index < CHEVRON_COUNT; index++) {
    const topY = CHUTE_TOP_Y + 5 + index * ((chuteH - 8) / CHEVRON_COUNT);
    ctx.beginPath();
    ctx.moveTo(doorX + 2, topY);
    ctx.lineTo(doorX + doorW / 2, topY + CHEVRON_H);
    ctx.lineTo(doorX + doorW - 2, topY);
    ctx.stroke();
  }
}

/**
 * The delivery chute and its shutters. Whatever is inside is painted by the
 * caller through `drawChuteContents`, so the sac can be drawn between the dark
 * recess and the doors that slide across it.
 */
function drawChuteRecess(ctx: Ctx, pose: LifeMachinePose): void {
  const chuteW = CHUTE_X1 - CHUTE_X0;
  const chuteH = CHUTE_BOTTOM_Y - CHUTE_TOP_Y;

  verticalGradientFill(ctx, CHUTE_X0, CHUTE_TOP_Y, chuteW, chuteH, [
    [0, '#05080a'],
    [0.6, '#12181b'],
    [1, '#05080a'],
  ]);

  // Light spilling out of an open hatch, so the opening reads as a way out.
  const spill = easeInOut(pose.shutterOpen) * clamp01(pose.power + 0.35);
  if (spill > 0) {
    const glow = ctx.createLinearGradient(CENTER_X, CHUTE_TOP_Y, CENTER_X, CHUTE_BOTTOM_Y);
    glow.addColorStop(0, rgba(226, 186, 108, 0.3 * spill));
    glow.addColorStop(1, rgba(226, 186, 108, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(CHUTE_X0, CHUTE_TOP_Y, chuteW, chuteH);
  }
}

function drawShutters(ctx: Ctx, pose: LifeMachinePose): void {
  const chuteW = CHUTE_X1 - CHUTE_X0;
  const chuteH = CHUTE_BOTTOM_Y - CHUTE_TOP_Y;
  const doorW = chuteW / 2;
  const openPx = (CHUTE_TRAVEL / 2) * easeInOut(pose.shutterOpen);

  for (const side of [-1, 1]) {
    const doorX = side < 0 ? CHUTE_X0 - openPx : CENTER_X + openPx;
    horizontalGradientFill(ctx, doorX, CHUTE_TOP_Y, doorW, chuteH, [
      [0, side < 0 ? STEEL_MID : STEEL_LIGHT],
      [1, side < 0 ? STEEL_DARK : STEEL_MID],
    ]);
    drawShutterChevrons(ctx, doorX, doorW, chuteH);
    ctx.strokeStyle = STEEL_SHADOW;
    ctx.lineWidth = 1;
    ctx.strokeRect(doorX + 0.5, CHUTE_TOP_Y + 0.5, doorW - 1, chuteH - 1);
  }

  // Recess frame, drawn last so the doors read as sitting inside the plinth.
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 2;
  ctx.strokeRect(CHUTE_X0 - 1, CHUTE_TOP_Y - 1, chuteW + 2, chuteH + 2);
  ctx.strokeStyle = rgba(150, 160, 170, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CHUTE_X0 - 2, CHUTE_TOP_Y - 2);
  ctx.lineTo(CHUTE_X1 + 2, CHUTE_TOP_Y - 2);
  ctx.stroke();
}

/** The plinth's outline; also the clip the chute and its shutters live inside. */
function plinthPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(CENTER_X - BASE_HALF_W_TOP, BASE_TOP_Y);
  ctx.lineTo(CENTER_X + BASE_HALF_W_TOP, BASE_TOP_Y);
  ctx.lineTo(CENTER_X + BASE_HALF_W_BOTTOM, BASE_BOTTOM_Y);
  ctx.lineTo(CENTER_X - BASE_HALF_W_BOTTOM, BASE_BOTTOM_Y);
  ctx.closePath();
}

/** Plinth shell only; the chute is painted separately so the sac can sit inside it. */
function drawPlinth(ctx: Ctx): void {
  plinthPath(ctx);
  const plinth = ctx.createLinearGradient(
    CENTER_X - BASE_HALF_W_BOTTOM,
    0,
    CENTER_X + BASE_HALF_W_BOTTOM,
    0,
  );
  plinth.addColorStop(0, STEEL_LIGHT);
  plinth.addColorStop(0.35, STEEL_MID);
  plinth.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = plinth;
  ctx.fill();
  ctx.strokeStyle = STEEL_SHADOW;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = STEEL_HIGHLIGHT;
  ctx.fillRect(CENTER_X - BASE_HALF_W_TOP, BASE_TOP_Y, BASE_HALF_W_TOP * 2, 1.6);
  ctx.fillStyle = rgba(30, 36, 42, 0.55);
  ctx.fillRect(CENTER_X - BASE_HALF_W_TOP, BASE_TOP_Y + BASE_RIM_H, BASE_HALF_W_TOP * 2, 1);

  const VENT_W = 9;
  const VENT_H = 8;
  drawGrille(
    ctx,
    CENTER_X - BASE_HALF_W_TOP + 3,
    BASE_BOTTOM_Y - BASE_FOOT_H - VENT_H,
    VENT_W,
    VENT_H,
  );
  drawGrille(
    ctx,
    CENTER_X + BASE_HALF_W_TOP - 3 - VENT_W,
    BASE_BOTTOM_Y - BASE_FOOT_H - VENT_H,
    VENT_W,
    VENT_H,
  );

  const RUST_STAIN = 'rgba(109, 82, 56, 0.35)';
  ctx.fillStyle = RUST_STAIN;
  ctx.fillRect(CENTER_X - BASE_HALF_W_BOTTOM + 3, BASE_BOTTOM_Y - BASE_FOOT_H - 3, 8, 4);

  // Feet, kept inside the plinth's own footprint for the same reason the plinth
  // is only one tile wide.
  ctx.fillStyle = STEEL_SHADOW;
  ctx.fillRect(
    CENTER_X - BASE_HALF_W_BOTTOM,
    BASE_BOTTOM_Y - BASE_FOOT_H,
    BASE_FOOT_W,
    BASE_FOOT_H,
  );
  ctx.fillRect(
    CENTER_X + BASE_HALF_W_BOTTOM - BASE_FOOT_W,
    BASE_BOTTOM_Y - BASE_FOOT_H,
    BASE_FOOT_W,
    BASE_FOOT_H,
  );

  drawBolt(ctx, CENTER_X - BASE_HALF_W_TOP + 4, BASE_TOP_Y + 4);
  drawBolt(ctx, CENTER_X + BASE_HALF_W_TOP - 4, BASE_TOP_Y + 4);
}

const STEAM_PUFF_COUNT = 5;
const STEAM_VENT_Y = BASE_TOP_Y + 2;

function drawSteam(ctx: Ctx, pose: LifeMachinePose): void {
  const strength = clamp01(pose.steam);
  if (strength <= 0) return;

  for (const side of [-1, 1]) {
    const ventX = CENTER_X + side * (BASE_HALF_W_TOP - 6);
    for (let index = 0; index < STEAM_PUFF_COUNT; index++) {
      const t = (index + 1) / STEAM_PUFF_COUNT;
      const rise = t * 22 * strength;
      const radius = 2.5 + t * 6 * strength;
      ctx.fillStyle = white(0.3 * strength * (1 - t * 0.8));
      ctx.beginPath();
      ctx.arc(ventX + side * t * 7, STEAM_VENT_Y - rise, radius, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// ── Public painters ──────────────────────────────────────────────────────────

/**
 * Paints one machine body frame. Lamps are deliberately *not* painted here —
 * they are a separate overlay so the runtime can swap green for red without a
 * duplicate copy of every body frame.
 */
export function drawLifeMachine(ctx: Ctx, pose: LifeMachinePose): void {
  // The sac travels one continuous path from the build plate to the chute
  // floor. It is painted twice against two clips — once inside the chamber,
  // once inside the chute — so it slides behind the plinth's top rim and comes
  // back out below it instead of teleporting between two containers.
  const sacBaseY = lerp(PLATE_Y, CHUTE_BOTTOM_Y - 2, easeInOut(pose.plateDrop));
  const plateY = lerp(PLATE_Y, CHAMBER_BOTTOM_Y + PLATE_H, easeInOut(pose.plateDrop));
  const sacTopY = sacBaseY - SAC_RY * 2 * clamp01(pose.sacGrowth);

  const paintSac = (): void => {
    if (pose.sacForm === 'none') return;
    if (pose.sacForm === 'split' || pose.sacForm === 'husk') {
      drawTornSac(ctx, CENTER_X, sacBaseY, pose.sacTear, pose.sacForm === 'husk');
      return;
    }
    drawSac(ctx, {
      cx: CENTER_X,
      baseY: sacBaseY,
      growth: pose.sacGrowth,
      form: pose.sacForm,
      fluidPhase: pose.fluidPhase,
    });
  };

  drawFloorShadow(ctx);
  drawCables(ctx);

  drawChamberInterior(ctx, pose);

  ctx.save();
  ctx.beginPath();
  ctx.rect(CHAMBER_X0, CHAMBER_TOP_Y, CHAMBER_W, CHAMBER_H);
  ctx.clip();
  drawBuildPlate(ctx, plateY);
  paintSac();
  drawPrintHead(ctx, pose, sacTopY);
  ctx.restore();

  drawGlass(ctx);
  drawRails(ctx);
  drawCollar(ctx);
  drawFeedPipes(ctx, pose);
  drawHeadHousing(ctx, pose);
  drawControlPanel(ctx);

  drawPlinth(ctx);
  // Everything in the chute is clipped to the plinth: a fully-open shutter
  // slides past the chute's own bounds, and unclipped it hangs in mid-air
  // beside the machine.
  ctx.save();
  plinthPath(ctx);
  ctx.clip();
  drawChuteRecess(ctx, pose);
  ctx.save();
  ctx.beginPath();
  ctx.rect(CHUTE_X0, CHUTE_TOP_Y, CHUTE_X1 - CHUTE_X0, CHUTE_BOTTOM_Y - CHUTE_TOP_Y);
  ctx.clip();
  paintSac();
  ctx.restore();
  drawShutters(ctx, pose);
  ctx.restore();

  drawSteam(ctx, pose);
}

/** Dimmest a lamp ever goes while it is lit at all. */
const LAMP_PULSE_MIN = 0.35;

/**
 * Paints only the lamps: panel LEDs, screen readout, chamber collar strip and
 * the roof beacon. Composited over any body frame, so it must contain nothing
 * that would look wrong over a powered-down machine.
 *
 * `channels` is the per-lamp brightness ring the frame index rotates through,
 * which is what makes a lamp chase around the panel rather than all three
 * blinking in unison.
 */
export function drawLifeMachineLights(
  ctx: Ctx,
  color: string,
  phase: number,
  channels: readonly number[],
): void {
  const rgbMatch = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const r = rgbMatch === null ? 255 : parseInt(rgbMatch[1], 16);
  const g = rgbMatch === null ? 255 : parseInt(rgbMatch[2], 16);
  const b = rgbMatch === null ? 255 : parseInt(rgbMatch[3], 16);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let index = 0; index < LED_COUNT; index++) {
    const brightness = channels[(index + phase) % channels.length] ?? 1;
    const ledX = LED_FIRST_X + index * LED_SPACING;
    const glow = ctx.createRadialGradient(ledX, LED_Y, 0, ledX, LED_Y, LED_R * 3.2);
    glow.addColorStop(0, rgba(r, g, b, 0.95 * brightness));
    glow.addColorStop(0.4, rgba(r, g, b, 0.45 * brightness));
    glow.addColorStop(1, rgba(r, g, b, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ledX, LED_Y, LED_R * 3.2, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(255, 255, 255, 0.75 * brightness);
    ctx.beginPath();
    ctx.arc(ledX, LED_Y, LED_R * 0.55, 0, TWO_PI);
    ctx.fill();
  }

  // Screen readout: a stack of bars that marches, so the panel looks like it is
  // reporting on a job in progress rather than displaying a static texture.
  const screenX = PANEL_X0 + SCREEN_INSET_X + 2;
  const screenW = PANEL_X1 - PANEL_X0 - SCREEN_INSET_X * 2 - 4;
  const BAR_COUNT = 4;
  const barH = 2;
  const barGap = (SCREEN_BOTTOM_Y - SCREEN_TOP_Y - 4 - BAR_COUNT * barH) / (BAR_COUNT - 1);
  for (let index = 0; index < BAR_COUNT; index++) {
    const fill = ((index + phase) % BAR_COUNT) / (BAR_COUNT - 1);
    const barY = SCREEN_TOP_Y + 2 + index * (barH + barGap);
    ctx.fillStyle = rgba(r, g, b, LAMP_PULSE_MIN + 0.5 * fill);
    ctx.fillRect(screenX, barY, Math.max(2, screenW * (0.3 + 0.7 * fill)), barH);
  }

  const collarPulse = LAMP_PULSE_MIN + 0.5 * (1 - Math.abs(((phase % 3) - 1) / 1));
  ctx.fillStyle = rgba(r, g, b, 0.55 * collarPulse);
  ctx.fillRect(CHAMBER_X0 - 1, COLLAR_TOP_Y + 1, CHAMBER_W + 2, 1.4);

  const beaconBrightness = channels[phase % channels.length] ?? 1;
  const beaconGlow = ctx.createRadialGradient(
    BEACON_X,
    BEACON_Y,
    0,
    BEACON_X,
    BEACON_Y,
    BEACON_R * 2.4,
  );
  beaconGlow.addColorStop(0, rgba(r, g, b, 0.9 * beaconBrightness));
  beaconGlow.addColorStop(0.45, rgba(r, g, b, 0.4 * beaconBrightness));
  beaconGlow.addColorStop(1, rgba(r, g, b, 0));
  ctx.fillStyle = beaconGlow;
  ctx.beginPath();
  ctx.arc(BEACON_X, BEACON_Y, BEACON_R * 2.4, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(255, 255, 255, 0.6 * beaconBrightness);
  ctx.beginPath();
  ctx.arc(BEACON_X, BEACON_Y - 1, BEACON_R * 0.45, Math.PI, TWO_PI);
  ctx.fill();

  ctx.restore();
}
