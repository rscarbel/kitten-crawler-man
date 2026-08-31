/**
 * Drawing engine for the keyboard-hero mini-game's board art.
 *
 * The fiction is that Carl is jacked into a lab terminal to shut the spider's
 * life machines down, so the housing is intrusion hardware — brushed steel, a
 * cabling loom and vent louvres down the side rails, recessed bezel strips top
 * and bottom — rather than a guitar. What makes it *play* like a rhythm game is
 * the layer split: the frame owns the chassis and leaves the lane well dark, and
 * every lane, note, receptor and touch button is painted separately so the
 * runtime can tint, pulse and flash a single lane without redrawing the console.
 *
 * Every dimension here is a fraction of the frame it is handed, so the same code
 * paints correctly at any `BOARD_BAKE_SCALE`. The board's *proportions* come from
 * `src/systems/keyboardHeroLayout.ts` rather than being restated, because the
 * runtime positions its lane rects from those same constants — a rail width that
 * drifted between the two would put the painted lane bed and the tappable lane
 * in different places.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 *
 * This ships as the painter rather than as pixels: `keyboardHeroArtCache` runs
 * it once per distinct piece at runtime and blits the result, and the offline
 * review harness drives the same functions through `scripts/nodeGameContext`.
 */

import { HIT_ZONE_IMG_CENTER } from '../../systems/keyboardHeroGeometry';
import {
  BOARD_IMG_H,
  BOARD_IMG_W,
  FRAME_FOOTER_IMG_H,
  FRAME_HEADER_IMG_H,
  FRAME_RAIL_IMG_W,
  LANE_BED_IMG_H,
  LANE_BED_IMG_W,
  LANE_COUNT,
  LANE_GAP_IMG,
  type LanePalette,
} from '../../systems/keyboardHeroLayout';
import { mulberry32, type Rng } from '../person/rng';

export type NoteState = 'normal' | 'hit' | 'missed';
export type ReceptorState = 'idle' | 'pressed' | 'flash';
export type TouchState = 'idle' | 'pressed';

const TWO_PI = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const HALF_TURN = Math.PI;
const THREE_QUARTER_TURN = Math.PI + QUARTER_TURN;

/** Gradient stop offset for "halfway down", named so stop lists read as design. */
const GRADIENT_MIDPOINT = 0.5;

// ── Colour plumbing ─────────────────────────────────────────────────────────

/**
 * node-canvas parses an `rgba()` string itself, and it drops the whole colour —
 * silently, baking a hard-edged smear where a fade was meant to be — when the
 * alpha arrives in exponent notation. Every computed alpha therefore goes
 * through here, which clamps it and forces plain decimal digits.
 */
const ALPHA_DECIMALS = 3;

function alphaText(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(ALPHA_DECIMALS);
}

type Rgb = readonly [number, number, number];

const HEX_RADIX = 16;
const HEX_CHANNEL_LENGTH = 2;
const RGB_CHANNEL_COUNT = 3;

function hexToRgb(hex: string): Rgb {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex;
  const channels: number[] = [];
  for (let i = 0; i < digits.length; i += HEX_CHANNEL_LENGTH) {
    channels.push(parseInt(digits.slice(i, i + HEX_CHANNEL_LENGTH), HEX_RADIX));
  }
  const [r, g, b] = channels;
  if (channels.length !== RGB_CHANNEL_COUNT || Number.isNaN(r + g + b)) {
    throw new Error(`keyboardHeroArt: unparseable colour "${hex}"`);
  }
  return [r, g, b];
}

function rgba(color: Rgb | string, opacity: number): string {
  const [r, g, b] = typeof color === 'string' ? hexToRgb(color) : color;
  return `rgba(${r},${g},${b},${alphaText(opacity)})`;
}

/**
 * Blends toward another colour — used to walk a lane hue up to white-hot. The
 * result is hex rather than `rgb()` because blends are chained and fed back into
 * `rgba()`, and only hex round-trips through `hexToRgb`.
 */
function mix(from: string, to: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(from);
  const [br, bg, bb] = hexToRgb(to);
  const channel = (a: number, b: number) =>
    Math.round(a + (b - a) * amount)
      .toString(HEX_RADIX)
      .padStart(HEX_CHANNEL_LENGTH, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
const NEAR_BLACK = '#05070a';

// ── Shape helpers ───────────────────────────────────────────────────────────

/** node-canvas's `roundRect` availability varies by build, so the path is explicit. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function verticalGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  stops: ReadonlyArray<readonly [number, string]>,
): CanvasGradient {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  return grad;
}

/**
 * The arrow the lane's key means, as a path centred on the origin and sized to
 * `span`. Shared by the falling keycap and the mobile button so a left arrow is
 * literally the same shape in both — the touch button is a promise about which
 * note it plays, and two different left arrows would break that promise.
 */
const GLYPH_TIP_REACH = 0.5;
const GLYPH_BARB_REACH = 0.44;
const GLYPH_BARB_DEPTH = 0.05;
const GLYPH_SHAFT_HALF_WIDTH = 0.17;
const GLYPH_TAIL_REACH = 0.46;

const GLYPH_ROTATION: Record<LanePalette['glyph'], number> = {
  up: 0,
  right: QUARTER_TURN,
  down: HALF_TURN,
  left: THREE_QUARTER_TURN,
};

function arrowGlyphPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  span: number,
  glyph: LanePalette['glyph'],
): void {
  const outline: ReadonlyArray<readonly [number, number]> = [
    [0, -GLYPH_TIP_REACH],
    [GLYPH_BARB_REACH, -GLYPH_BARB_DEPTH],
    [GLYPH_SHAFT_HALF_WIDTH, -GLYPH_BARB_DEPTH],
    [GLYPH_SHAFT_HALF_WIDTH, GLYPH_TAIL_REACH],
    [-GLYPH_SHAFT_HALF_WIDTH, GLYPH_TAIL_REACH],
    [-GLYPH_SHAFT_HALF_WIDTH, -GLYPH_BARB_DEPTH],
    [-GLYPH_BARB_REACH, -GLYPH_BARB_DEPTH],
  ];
  const angle = GLYPH_ROTATION[glyph];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  ctx.beginPath();
  outline.forEach(([ux, uy], index) => {
    const x = cx + (ux * cos - uy * sin) * span;
    const y = cy + (ux * sin + uy * cos) * span;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// ── Board frame ─────────────────────────────────────────────────────────────

const CHASSIS_TOP = '#2c3239';
const CHASSIS_MID = '#1c2127';
const CHASSIS_BOTTOM = '#12161b';
const CHASSIS_EDGE_LIGHT = 'rgba(190,215,235,0.30)';
const CHASSIS_EDGE_DARK = 'rgba(0,0,0,0.55)';

const CHASSIS_CORNER_FRACTION = 0.018;
const CHASSIS_OUTLINE_FRACTION = 0.004;

/** Brushed-steel streaks. Seeded so every repaint of a piece is identical to the last. */
const CHASSIS_SEED = 0x4b1e07;
const BRUSH_STROKE_COUNT = 900;
const BRUSH_MIN_LENGTH_FRACTION = 0.02;
const BRUSH_MAX_EXTRA_LENGTH_FRACTION = 0.1;
const BRUSH_LIGHT_ALPHA = 0.045;
const BRUSH_DARK_ALPHA = 0.06;
const BRUSH_LIGHT_SHARE = 0.5;
const BRUSH_STROKE_WIDTH_FRACTION = 0.001;
const CHASSIS_MID_STOP = 0.45;

/** Vent louvres and rivets live on the rails; the loom cables run past them. */
const LOUVRE_BAND_COUNT = 26;
const LOUVRE_HEIGHT_FRACTION = 0.45;
const LOUVRE_INSET_FRACTION = 0.24;
const RIVET_COUNT = 9;
const RIVET_RADIUS_FRACTION = 0.12;
const CABLE_COUNT = 2;
const CABLE_WIDTH_FRACTION = 0.19;
/** A loom is dressed, not tangled: two lazy bows down the rail, no more. */
const CABLE_WAVE_COUNT = 2;
const CABLE_WAVE_AMPLITUDE_FRACTION = 0.07;
const CABLE_FIRST_X_FRACTION = 0.3;
const CABLE_X_STRIDE_FRACTION = 0.4;
const CABLE_SEGMENT_COUNT = 48;
const CABLE_COLORS: readonly string[] = ['#7a2f2f', '#2f5a7a'];
const CABLE_CLAMP_COUNT = 4;
const CABLE_CLAMP_HEIGHT_FRACTION = 0.9;
const CABLE_SHEEN_ALPHA = 0.14;
const CABLE_SHEEN_WIDTH_FRACTION = 0.3;

const CLAMP_COLOR = '#3a424b';
const CLAMP_LIP_COLOR = '#d5e6f5';
const CLAMP_INSET_FRACTION = 0.08;
const CLAMP_WIDTH_FRACTION = 0.84;
const CLAMP_CORNER_FRACTION = 0.3;
const CLAMP_LIP_ALPHA = 0.22;
const CLAMP_LIP_HEIGHT_FRACTION = 0.14;
const CLAMP_SHADOW_ALPHA = 0.45;

/** The rail's own shading, before anything is bolted to it. */
const RAIL_SHADE_TOP_ALPHA = 0.35;
const RAIL_SHADE_MID_ALPHA = 0.12;
const RAIL_SHADE_BOTTOM_ALPHA = 0.4;

const LOUVRE_LIP_COLOR = '#c9dcee';
const LOUVRE_SLOT_ALPHA = 0.62;
const LOUVRE_LIP_ALPHA = 0.16;
const LOUVRE_LIP_HEIGHT_FRACTION = 0.3;
const LOUVRE_LIP_CORNER_FRACTION = 0.15;

const RIVET_COLOR = '#4a545e';
const RIVET_HIGHLIGHT_COLOR = '#e6f2ff';
const RIVET_HIGHLIGHT_ALPHA = 0.4;
const RIVET_HIGHLIGHT_OFFSET_FRACTION = 0.28;
const RIVET_HIGHLIGHT_RADIUS_FRACTION = 0.42;
const RIVET_OUTLINE_ALPHA = 0.5;
const RIVET_OUTLINE_WIDTH_FRACTION = 0.18;

/** The recessed strips the runtime paints its HUD into. */
const BEZEL_INSET_FRACTION = 0.16;
const BEZEL_CORNER_FRACTION = 0.22;
const BEZEL_FILL = '#0a0e13';
const BEZEL_LIP_LIGHT = 'rgba(170,200,225,0.22)';
const BEZEL_LIP_DARK = 'rgba(0,0,0,0.6)';
const BEZEL_FLOOR_LIFT_FRACTION = 0.5;
const BEZEL_LIP_WIDTH_FRACTION = 0.35;

/** The lane well: near-black, so the lane-bed layer is what the player sees. */
const WELL_FILL = '#04060a';
const WELL_BEVEL_FRACTION = 0.006;
const DIVIDER_HIGHLIGHT = 'rgba(120,160,190,0.18)';
const DIVIDER_COLOR = '#8fb4cf';
const DIVIDER_ALPHA = 0.1;
const DIVIDER_HIGHLIGHT_WIDTH_FRACTION = 0.3;

const SCANLINE_PERIOD_FRACTION = 0.005;
const SCANLINE_ALPHA = 0.16;
const VIGNETTE_ALPHA = 0.55;
const VIGNETTE_INNER_STOP = 0.45;
const VIGNETTE_OUTER_STOP_FRACTION = 0.75;

function paintBrushedMetal(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void {
  ctx.save();
  ctx.lineWidth = Math.max(1, h * BRUSH_STROKE_WIDTH_FRACTION);
  for (let i = 0; i < BRUSH_STROKE_COUNT; i++) {
    const y = rng() * h;
    const length = w * (BRUSH_MIN_LENGTH_FRACTION + rng() * BRUSH_MAX_EXTRA_LENGTH_FRACTION);
    const x = rng() * (w - length);
    const isLight = rng() < BRUSH_LIGHT_SHARE;
    ctx.strokeStyle = isLight ? rgba('#dcecff', BRUSH_LIGHT_ALPHA) : rgba(BLACK, BRUSH_DARK_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y);
    ctx.stroke();
  }
  ctx.restore();
}

function paintRail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = verticalGradient(ctx, x, y, h, [
    [0, rgba(BLACK, RAIL_SHADE_TOP_ALPHA)],
    [GRADIENT_MIDPOINT, rgba(BLACK, RAIL_SHADE_MID_ALPHA)],
    [1, rgba(BLACK, RAIL_SHADE_BOTTOM_ALPHA)],
  ]);
  ctx.fillRect(x, y, w, h);

  const louvreStride = h / LOUVRE_BAND_COUNT;
  const louvreH = louvreStride * LOUVRE_HEIGHT_FRACTION;
  const louvreInset = w * LOUVRE_INSET_FRACTION;
  const louvreW = w - louvreInset * 2;
  for (let i = 0; i < LOUVRE_BAND_COUNT; i++) {
    const slotY = y + i * louvreStride + (louvreStride - louvreH) / 2;
    ctx.fillStyle = rgba(BLACK, LOUVRE_SLOT_ALPHA);
    roundRectPath(ctx, x + louvreInset, slotY, louvreW, louvreH, louvreH / 2);
    ctx.fill();
    ctx.fillStyle = rgba(LOUVRE_LIP_COLOR, LOUVRE_LIP_ALPHA);
    roundRectPath(
      ctx,
      x + louvreInset,
      slotY + louvreH,
      louvreW,
      louvreH * LOUVRE_LIP_HEIGHT_FRACTION,
      louvreH * LOUVRE_LIP_CORNER_FRACTION,
    );
    ctx.fill();
  }

  const rivetStride = h / RIVET_COUNT;
  const rivetR = w * RIVET_RADIUS_FRACTION;
  for (let i = 0; i < RIVET_COUNT; i++) {
    const cx = x + w / 2;
    const cy = y + rivetStride * i + rivetStride / 2;
    ctx.fillStyle = RIVET_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, rivetR, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(RIVET_HIGHLIGHT_COLOR, RIVET_HIGHLIGHT_ALPHA);
    ctx.beginPath();
    ctx.arc(
      cx - rivetR * RIVET_HIGHLIGHT_OFFSET_FRACTION,
      cy - rivetR * RIVET_HIGHLIGHT_OFFSET_FRACTION,
      rivetR * RIVET_HIGHLIGHT_RADIUS_FRACTION,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = rgba(BLACK, RIVET_OUTLINE_ALPHA);
    ctx.lineWidth = Math.max(1, rivetR * RIVET_OUTLINE_WIDTH_FRACTION);
    ctx.beginPath();
    ctx.arc(cx, cy, rivetR, 0, TWO_PI);
    ctx.stroke();
  }

  const cableSpan = w * CABLE_WIDTH_FRACTION;
  for (let cable = 0; cable < CABLE_COUNT; cable++) {
    const baseX = x + w * (CABLE_FIRST_X_FRACTION + cable * CABLE_X_STRIDE_FRACTION);
    const phase = rng() * TWO_PI;
    ctx.strokeStyle = CABLE_COLORS[cable % CABLE_COLORS.length];
    ctx.lineWidth = cableSpan;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let s = 0; s <= CABLE_SEGMENT_COUNT; s++) {
      const t = s / CABLE_SEGMENT_COUNT;
      const wave = Math.sin(phase + t * TWO_PI * CABLE_WAVE_COUNT);
      const px = baseX + wave * w * CABLE_WAVE_AMPLITUDE_FRACTION;
      const py = y + t * h;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(WHITE, CABLE_SHEEN_ALPHA);
    ctx.lineWidth = cableSpan * CABLE_SHEEN_WIDTH_FRACTION;
    ctx.stroke();
  }

  const clampStride = h / CABLE_CLAMP_COUNT;
  const clampH = w * CABLE_CLAMP_HEIGHT_FRACTION;
  for (let i = 0; i < CABLE_CLAMP_COUNT; i++) {
    const clampY = y + clampStride * i + clampStride / 2 - clampH / 2;
    const clampX = x + w * CLAMP_INSET_FRACTION;
    const clampW = w * CLAMP_WIDTH_FRACTION;
    const clampLipH = Math.max(1, clampH * CLAMP_LIP_HEIGHT_FRACTION);
    ctx.fillStyle = CLAMP_COLOR;
    roundRectPath(ctx, clampX, clampY, clampW, clampH, clampH * CLAMP_CORNER_FRACTION);
    ctx.fill();
    ctx.fillStyle = rgba(CLAMP_LIP_COLOR, CLAMP_LIP_ALPHA);
    ctx.fillRect(clampX, clampY, clampW, clampLipH);
    ctx.fillStyle = rgba(BLACK, CLAMP_SHADOW_ALPHA);
    ctx.fillRect(clampX, clampY + clampH - clampLipH, clampW, clampLipH);
  }

  ctx.restore();
}

function paintBezelStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const inset = h * BEZEL_INSET_FRACTION;
  const radius = h * BEZEL_CORNER_FRACTION;
  ctx.save();
  ctx.fillStyle = BEZEL_LIP_DARK;
  roundRectPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius);
  ctx.fill();
  ctx.fillStyle = BEZEL_FILL;
  roundRectPath(
    ctx,
    x + inset,
    y + inset,
    w - inset * 2,
    h - inset * 2 - Math.max(1, inset * BEZEL_FLOOR_LIFT_FRACTION),
    radius,
  );
  ctx.fill();
  ctx.strokeStyle = BEZEL_LIP_LIGHT;
  ctx.lineWidth = Math.max(1, inset * BEZEL_LIP_WIDTH_FRACTION);
  roundRectPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius);
  ctx.stroke();
  ctx.restore();
}

function paintWellWash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const period = Math.max(2, Math.round(h * SCANLINE_PERIOD_FRACTION));
  ctx.fillStyle = rgba(BLACK, SCANLINE_ALPHA);
  for (let lineY = y; lineY < y + h; lineY += period) {
    ctx.fillRect(x, lineY, w, Math.max(1, period / 2));
  }

  const vignette = ctx.createRadialGradient(
    x + w / 2,
    y + h / 2,
    Math.min(w, h) * VIGNETTE_INNER_STOP,
    x + w / 2,
    y + h / 2,
    Math.max(w, h) * VIGNETTE_OUTER_STOP_FRACTION,
  );
  vignette.addColorStop(0, rgba(BLACK, 0));
  vignette.addColorStop(1, rgba(BLACK, VIGNETTE_ALPHA));
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * The console housing. The lane well is left near-black on purpose: the lane-bed
 * layer is drawn over it at runtime, and a frame that painted its own lanes
 * would show through every gap the moment a lane pulsed.
 */
export function paintBoardFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = mulberry32(CHASSIS_SEED);
  const railW = (FRAME_RAIL_IMG_W / BOARD_IMG_W) * w;
  const headerH = (FRAME_HEADER_IMG_H / BOARD_IMG_H) * h;
  const footerH = (FRAME_FOOTER_IMG_H / BOARD_IMG_H) * h;
  const wellX = railW;
  const wellY = headerH;
  const wellW = w - railW * 2;
  const wellH = h - headerH - footerH;
  const cornerRadius = h * CHASSIS_CORNER_FRACTION;

  ctx.save();
  roundRectPath(ctx, 0, 0, w, h, cornerRadius);
  ctx.clip();

  ctx.fillStyle = verticalGradient(ctx, 0, 0, h, [
    [0, CHASSIS_TOP],
    [CHASSIS_MID_STOP, CHASSIS_MID],
    [1, CHASSIS_BOTTOM],
  ]);
  ctx.fillRect(0, 0, w, h);
  paintBrushedMetal(ctx, w, h, rng);

  paintRail(ctx, 0, 0, railW, h, rng);
  paintRail(ctx, w - railW, 0, railW, h, rng);

  paintBezelStrip(ctx, wellX, 0, wellW, headerH);
  paintBezelStrip(ctx, wellX, h - footerH, wellW, footerH);

  ctx.fillStyle = WELL_FILL;
  ctx.fillRect(wellX, wellY, wellW, wellH);

  const laneStride = ((LANE_BED_IMG_W + LANE_GAP_IMG) / BOARD_IMG_W) * w;
  const gapW = (LANE_GAP_IMG / BOARD_IMG_W) * w;
  for (let divider = 1; divider < LANE_COUNT; divider++) {
    const gapX = wellX + divider * laneStride - gapW;
    ctx.fillStyle = rgba(DIVIDER_COLOR, DIVIDER_ALPHA);
    ctx.fillRect(gapX, wellY, gapW, wellH);
    ctx.fillStyle = DIVIDER_HIGHLIGHT;
    ctx.fillRect(gapX, wellY, Math.max(1, gapW * DIVIDER_HIGHLIGHT_WIDTH_FRACTION), wellH);
  }
  paintWellWash(ctx, wellX, wellY, wellW, wellH);

  const bevel = Math.max(1, h * WELL_BEVEL_FRACTION);
  ctx.fillStyle = CHASSIS_EDGE_DARK;
  ctx.fillRect(wellX, wellY, wellW, bevel);
  ctx.fillRect(wellX, wellY, bevel, wellH);
  ctx.fillStyle = CHASSIS_EDGE_LIGHT;
  ctx.fillRect(wellX, wellY + wellH - bevel, wellW, bevel);
  ctx.fillRect(wellX + wellW - bevel, wellY, bevel, wellH);

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = CHASSIS_EDGE_LIGHT;
  ctx.lineWidth = Math.max(1, h * CHASSIS_OUTLINE_FRACTION);
  roundRectPath(
    ctx,
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    w - ctx.lineWidth,
    h - ctx.lineWidth,
    cornerRadius,
  );
  ctx.stroke();
  ctx.restore();
}

// ── Lane bed ────────────────────────────────────────────────────────────────

/** Where the hit line falls inside a lane bed, as a fraction of its depth. */
const HIT_LINE_BED_FRACTION = HIT_ZONE_IMG_CENTER / LANE_BED_IMG_H;

const BED_TOP_FILL = '#04060a';
/**
 * The bed is tinted with the lane's own hue all the way to the top, faintly.
 * A lane whose spawn end is pure black is indistinguishable from its
 * neighbours exactly where a note is fading in and needs the most help.
 */
const BED_TINT_TOP_ALPHA = 0.12;
const BED_TINT_MID_ALPHA = 0.3;
const BED_TINT_HIT_ALPHA = 0.8;
const BED_TINT_APRON_ALPHA = 0.42;
/** Where the mid tint stop sits, as a fraction of the way down to the hit line. */
const BED_TINT_MID_STOP_FRACTION = 0.5;

/** Horizontal data rungs. Enough to read as a scale, sparse enough to stay quiet. */
const RUNG_COUNT = 18;
const RUNG_THICKNESS_FRACTION = 0.0025;
const RUNG_BASE_ALPHA = 0.1;
const RUNG_HIT_ALPHA = 0.45;
const RUNG_INSET_FRACTION = 0.12;

/** A soft band of light straddling the hit line — the bed's own "press here". */
const BED_LANDING_BAND_FRACTION = 0.11;
const BED_LANDING_BAND_ALPHA = 0.46;

const BED_RAIL_WIDTH_FRACTION = 0.075;
const BED_RAIL_TOP_ALPHA = 0.1;
const BED_RAIL_HIT_ALPHA = 0.85;

const BED_SCANLINE_PERIOD_FRACTION = 0.006;
const BED_SCANLINE_ALPHA = 0.1;

/**
 * One lane's bed, tinted with the lane's own hue and brightening toward the hit
 * line so the eye is pulled to where the press has to happen.
 */
export function paintLaneBed(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: LanePalette,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  ctx.fillStyle = BED_TOP_FILL;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = verticalGradient(ctx, 0, 0, h, [
    [0, rgba(palette.hue, BED_TINT_TOP_ALPHA)],
    [HIT_LINE_BED_FRACTION * BED_TINT_MID_STOP_FRACTION, rgba(palette.hue, BED_TINT_MID_ALPHA)],
    [HIT_LINE_BED_FRACTION, rgba(palette.hue, BED_TINT_HIT_ALPHA)],
    [1, rgba(palette.shade, BED_TINT_APRON_ALPHA)],
  ]);
  ctx.fillRect(0, 0, w, h);

  const rungInset = w * RUNG_INSET_FRACTION;
  const rungThickness = Math.max(1, h * RUNG_THICKNESS_FRACTION);
  for (let rung = 1; rung <= RUNG_COUNT; rung++) {
    const t = rung / (RUNG_COUNT + 1);
    const nearness = 1 - Math.min(1, Math.abs(t - HIT_LINE_BED_FRACTION) / HIT_LINE_BED_FRACTION);
    ctx.fillStyle = rgba(
      palette.hue,
      RUNG_BASE_ALPHA + (RUNG_HIT_ALPHA - RUNG_BASE_ALPHA) * nearness * nearness,
    );
    ctx.fillRect(rungInset, t * h, w - rungInset * 2, rungThickness);
  }

  const bandH = h * BED_LANDING_BAND_FRACTION;
  const bandY = HIT_LINE_BED_FRACTION * h - bandH / 2;
  ctx.fillStyle = verticalGradient(ctx, 0, bandY, bandH, [
    [0, rgba(palette.hue, 0)],
    [GRADIENT_MIDPOINT, rgba(palette.light, BED_LANDING_BAND_ALPHA)],
    [1, rgba(palette.hue, 0)],
  ]);
  ctx.fillRect(0, bandY, w, bandH);

  const railW = w * BED_RAIL_WIDTH_FRACTION;
  const railGradient = verticalGradient(ctx, 0, 0, h, [
    [0, rgba(palette.hue, BED_RAIL_TOP_ALPHA)],
    [HIT_LINE_BED_FRACTION, rgba(palette.light, BED_RAIL_HIT_ALPHA)],
    [1, rgba(palette.hue, BED_RAIL_TOP_ALPHA)],
  ]);
  ctx.fillStyle = railGradient;
  ctx.fillRect(0, 0, railW, h);
  ctx.fillRect(w - railW, 0, railW, h);

  const period = Math.max(2, Math.round(h * BED_SCANLINE_PERIOD_FRACTION));
  ctx.fillStyle = rgba(BLACK, BED_SCANLINE_ALPHA);
  for (let lineY = 0; lineY < h; lineY += period) {
    ctx.fillRect(0, lineY, w, Math.max(1, period / 2));
  }

  ctx.restore();
}

// ── Lane highlight ──────────────────────────────────────────────────────────

const HIGHLIGHT_TOP_ALPHA = 0;
const HIGHLIGHT_MID_ALPHA = 0.18;
const HIGHLIGHT_HIT_ALPHA = 0.7;
const HIGHLIGHT_BOTTOM_ALPHA = 0.34;
const HIGHLIGHT_EDGE_WIDTH_FRACTION = 0.1;
const HIGHLIGHT_EDGE_BOOST = 0.28;
const HIGHLIGHT_MID_STOP_FRACTION = 0.55;

/**
 * A neutral white one-lane strip. The runtime multiplies it by whatever colour
 * the moment calls for — the lane's own hue for a press, red for a strike — so
 * one frame does the job the four baked full-board error overlays used to, at a
 * twentieth of the sheet area.
 */
export function paintLaneHighlight(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = verticalGradient(ctx, 0, 0, h, [
    [0, rgba(WHITE, HIGHLIGHT_TOP_ALPHA)],
    [HIT_LINE_BED_FRACTION * HIGHLIGHT_MID_STOP_FRACTION, rgba(WHITE, HIGHLIGHT_MID_ALPHA)],
    [HIT_LINE_BED_FRACTION, rgba(WHITE, HIGHLIGHT_HIT_ALPHA)],
    [1, rgba(WHITE, HIGHLIGHT_BOTTOM_ALPHA)],
  ]);
  ctx.fillRect(0, 0, w, h);

  const edgeW = w * HIGHLIGHT_EDGE_WIDTH_FRACTION;
  ctx.fillStyle = verticalGradient(ctx, 0, 0, h, [
    [0, rgba(WHITE, 0)],
    [HIT_LINE_BED_FRACTION, rgba(WHITE, HIGHLIGHT_EDGE_BOOST)],
    [1, rgba(WHITE, 0)],
  ]);
  ctx.fillRect(0, 0, edgeW, h);
  ctx.fillRect(w - edgeW, 0, edgeW, h);
  ctx.restore();
}

// ── Note keycap ─────────────────────────────────────────────────────────────

const KEYCAP_INSET_FRACTION = 0.08;
const KEYCAP_CORNER_FRACTION = 0.18;
const KEYCAP_RIM_FRACTION = 0.045;
const KEYCAP_TOP_BEVEL_FRACTION = 0.2;
const KEYCAP_BOTTOM_BEVEL_FRACTION = 0.12;
const KEYCAP_GLOSS_INSET_FRACTION = 0.16;
const KEYCAP_GLOSS_HEIGHT_FRACTION = 0.38;
const KEYCAP_GLOSS_ALPHA = 0.3;
const KEYCAP_SHADOW_OFFSET_FRACTION = 0.05;
const KEYCAP_SHADOW_ALPHA = 0.45;
const GLYPH_SPAN_FRACTION = 0.52;
const GLYPH_OUTLINE_FRACTION = 0.035;
const GLYPH_OUTLINE_ALPHA = 0.55;
const GLYPH_OUTLINE_HIT_ALPHA = 0.25;
const KEYCAP_TOP_BEVEL_ALPHA = 0.55;
const KEYCAP_BOTTOM_BEVEL_ALPHA = 0.3;
const KEYCAP_GLOSS_CORNER_SHARE = 0.7;
const GLOSS_TOP_OFFSET_SHARE = 0.5;

/** `hit` blows the cap out to white and throws a ring; the ring reads at 32px. */
const HIT_RING_RADIUS_FRACTION = 0.46;
const HIT_RING_WIDTH_FRACTION = 0.07;
const HIT_CORONA_ALPHA = 0.55;
const HIT_FACE_WHITENING = 0.72;
/** The cap's bottom stays a touch less blown out than its face, so it still reads as a cap. */
const HIT_FACE_BOTTOM_SHARE = 0.6;
const HIT_CORONA_MID_STOP = 0.6;
const HIT_CORONA_MID_SHARE = 0.5;
const HIT_RING_ALPHA = 0.9;

/** `missed` drains the hue out and cracks the cap. */
const MISS_DESATURATION = 0.82;
const MISS_RED_TINT = '#7a2b2b';
const MISS_CRACK_COUNT = 3;
const MISS_CRACK_SEED = 0x9c31d0;
const MISS_CRACK_SEGMENTS = 4;
const MISS_CRACK_WIDTH_FRACTION = 0.022;
const MISS_ALPHA = 0.85;
const MISS_TOP_DARKENING = 0.25;
const MISS_MID_DARKENING = 0.5;
const MISS_BOTTOM_DARKENING = 0.7;
const MISS_GLYPH_COLOR = '#9b8f8f';
const MISS_RIM_COLOR = '#140d0d';
const MISS_CRACK_COLOR = '#0b0708';
const MISS_CRACK_ALPHA = 0.85;
const MISS_CRACK_WANDER_FRACTION = 0.4;
/** Recentres `rng()`'s [0, 1) output around 0 so a crack wanders both ways, not just rightward. */
const MISS_CRACK_WANDER_CENTER = 0.5;

interface KeycapFace {
  readonly top: string;
  readonly mid: string;
  readonly bottom: string;
  readonly glyph: string;
  readonly rim: string;
  readonly gloss: boolean;
}

function noteFace(palette: LanePalette, state: NoteState): KeycapFace {
  if (state === 'hit') {
    return {
      top: WHITE,
      mid: mix(palette.light, WHITE, HIT_FACE_WHITENING),
      bottom: mix(palette.hue, WHITE, HIT_FACE_WHITENING * HIT_FACE_BOTTOM_SHARE),
      glyph: palette.shade,
      rim: palette.hue,
      gloss: true,
    };
  }
  if (state === 'missed') {
    const drained = mix(palette.hue, MISS_RED_TINT, MISS_DESATURATION);
    return {
      top: mix(drained, BLACK, MISS_TOP_DARKENING),
      mid: mix(drained, BLACK, MISS_MID_DARKENING),
      bottom: mix(drained, BLACK, MISS_BOTTOM_DARKENING),
      glyph: MISS_GLYPH_COLOR,
      rim: MISS_RIM_COLOR,
      gloss: false,
    };
  }
  return {
    top: palette.light,
    mid: palette.hue,
    bottom: palette.shade,
    glyph: WHITE,
    rim: NEAR_BLACK,
    gloss: true,
  };
}

function paintKeycapBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  face: KeycapFace,
  rimWidth: number,
): void {
  ctx.fillStyle = verticalGradient(ctx, x, y, h, [
    [0, face.top],
    [KEYCAP_TOP_BEVEL_FRACTION, face.mid],
    [1 - KEYCAP_BOTTOM_BEVEL_FRACTION, face.mid],
    [1, face.bottom],
  ]);
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.fillStyle = rgba(face.top, KEYCAP_TOP_BEVEL_ALPHA);
  roundRectPath(ctx, x, y, w, h * KEYCAP_TOP_BEVEL_FRACTION, radius);
  ctx.fill();
  ctx.fillStyle = rgba(BLACK, KEYCAP_BOTTOM_BEVEL_ALPHA);
  roundRectPath(
    ctx,
    x,
    y + h * (1 - KEYCAP_BOTTOM_BEVEL_FRACTION),
    w,
    h * KEYCAP_BOTTOM_BEVEL_FRACTION,
    radius,
  );
  ctx.fill();

  if (face.gloss) {
    const glossInset = w * KEYCAP_GLOSS_INSET_FRACTION;
    ctx.fillStyle = verticalGradient(ctx, x, y, h * KEYCAP_GLOSS_HEIGHT_FRACTION, [
      [0, rgba(WHITE, KEYCAP_GLOSS_ALPHA)],
      [1, rgba(WHITE, 0)],
    ]);
    roundRectPath(
      ctx,
      x + glossInset,
      y + glossInset * GLOSS_TOP_OFFSET_SHARE,
      w - glossInset * 2,
      h * KEYCAP_GLOSS_HEIGHT_FRACTION,
      radius * KEYCAP_GLOSS_CORNER_SHARE,
    );
    ctx.fill();
  }

  // The rim is the whole reason a dark keycap survives a dark lane bed at the
  // lowest render-quality setting; without it the cap dissolves into the well.
  ctx.strokeStyle = face.rim;
  ctx.lineWidth = rimWidth;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.stroke();
}

/** A glossy directional keycap — the falling note. */
export function paintNoteKeycap(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: LanePalette,
  state: NoteState,
): void {
  const face = noteFace(palette, state);
  const inset = size * KEYCAP_INSET_FRACTION;
  const capX = inset;
  const capY = inset;
  const capSize = size - inset * 2;
  const radius = size * KEYCAP_CORNER_FRACTION;
  const rimWidth = Math.max(1, size * KEYCAP_RIM_FRACTION);
  const center = size / 2;

  ctx.save();
  if (state === 'missed') ctx.globalAlpha = MISS_ALPHA;

  if (state === 'hit') {
    const corona = ctx.createRadialGradient(center, center, 0, center, center, size / 2);
    corona.addColorStop(0, rgba(WHITE, HIT_CORONA_ALPHA));
    corona.addColorStop(
      HIT_CORONA_MID_STOP,
      rgba(palette.hue, HIT_CORONA_ALPHA * HIT_CORONA_MID_SHARE),
    );
    corona.addColorStop(1, rgba(palette.hue, 0));
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = rgba(BLACK, KEYCAP_SHADOW_ALPHA);
    roundRectPath(ctx, capX, capY + size * KEYCAP_SHADOW_OFFSET_FRACTION, capSize, capSize, radius);
    ctx.fill();
  }

  paintKeycapBody(ctx, capX, capY, capSize, capSize, radius, face, rimWidth);

  if (state === 'missed') {
    // Cracks wander up to ±MISS_CRACK_WANDER_FRACTION·capSize per segment, so a
    // crack seeded near the cap's edge can wander past it — clip to the cap's own
    // rounded-rect path so the crack ends inside the cap it damaged, not sliced
    // flat by the cell boundary beside it.
    ctx.save();
    roundRectPath(ctx, capX, capY, capSize, capSize, radius);
    ctx.clip();
    const rng = mulberry32(MISS_CRACK_SEED);
    ctx.strokeStyle = rgba(MISS_CRACK_COLOR, MISS_CRACK_ALPHA);
    ctx.lineWidth = Math.max(1, size * MISS_CRACK_WIDTH_FRACTION);
    for (let crack = 0; crack < MISS_CRACK_COUNT; crack++) {
      let px = capX + rng() * capSize;
      let py = capY;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let seg = 0; seg < MISS_CRACK_SEGMENTS; seg++) {
        px += (rng() - MISS_CRACK_WANDER_CENTER) * capSize * MISS_CRACK_WANDER_FRACTION;
        py += capSize / MISS_CRACK_SEGMENTS;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  arrowGlyphPath(ctx, center, center, size * GLYPH_SPAN_FRACTION, palette.glyph);
  ctx.fillStyle = face.glyph;
  ctx.fill();
  ctx.strokeStyle = rgba(BLACK, state === 'hit' ? GLYPH_OUTLINE_HIT_ALPHA : GLYPH_OUTLINE_ALPHA);
  ctx.lineWidth = Math.max(1, size * GLYPH_OUTLINE_FRACTION);
  ctx.stroke();

  if (state === 'hit') {
    ctx.strokeStyle = rgba(WHITE, HIT_RING_ALPHA);
    ctx.lineWidth = Math.max(1, size * HIT_RING_WIDTH_FRACTION);
    ctx.beginPath();
    ctx.arc(center, center, size * HIT_RING_RADIUS_FRACTION, 0, TWO_PI);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Receptor ────────────────────────────────────────────────────────────────

const RECEPTOR_INSET_FRACTION = 0.13;
const RECEPTOR_CORNER_FRACTION = 0.17;
const RECEPTOR_IDLE_RING_FRACTION = 0.05;
const RECEPTOR_PRESSED_RING_FRACTION = 0.075;
const RECEPTOR_FLASH_RING_FRACTION = 0.1;
/**
 * `idle` is on screen for the whole run, unlike `pressed`/`flash` which only
 * show for a few frames — so its ring is mixed toward the lane's light tint
 * rather than left at raw `hue`, which reads too close to the lane bed's own
 * hue-tinted fill to stand out as the "press here" mark.
 */
const RECEPTOR_IDLE_RING_LIGHTEN_FRACTION = 0.35;
const RECEPTOR_IDLE_FILL_ALPHA = 0.22;
const RECEPTOR_PRESSED_FILL_ALPHA = 0.28;
const RECEPTOR_FLASH_FILL_ALPHA = 0.45;
/** The receptor sits over a lit lane bed, so it darkens its own interior first. */
const RECEPTOR_WELL_ALPHA = 0.45;
const RECEPTOR_CORNER_TICK_FRACTION = 0.22;
const RECEPTOR_TICK_ALPHA = 0.8;

/** The burst that says "that press landed", drawn outside the ring. */
const FLASH_CORONA_ALPHA = 0.7;
const FLASH_SPIKE_COUNT = 8;
const FLASH_SPIKE_INNER_FRACTION = 0.42;
const FLASH_SPIKE_WIDTH_FRACTION = 0.03;
const FLASH_SPIKE_ALPHA = 0.85;
/**
 * A `round` line cap extends half the stroke width past its endpoint, so an
 * outer fraction of exactly 0.5 (the cell edge) puts that cap's far half
 * outside the cell — the 0°/90°/180°/270° spikes get amputated while the
 * diagonals, which reach the edge along a shorter axis-aligned component,
 * don't. Budget the cap's radius, plus a hair of margin for antialiasing
 * bleed, out of the outer fraction so all eight spikes taper identically.
 */
const FLASH_SPIKE_CAP_RADIUS_FRACTION = FLASH_SPIKE_WIDTH_FRACTION / 2;
const FLASH_SPIKE_EDGE_MARGIN_FRACTION = 0.01;
const FLASH_SPIKE_OUTER_FRACTION =
  0.5 - FLASH_SPIKE_CAP_RADIUS_FRACTION - FLASH_SPIKE_EDGE_MARGIN_FRACTION;
const FLASH_CORONA_MID_STOP = 0.55;
const FLASH_CORONA_MID_SHARE = 0.6;
const RECEPTOR_INNER_GLOW_ALPHA = 0.45;
const RECEPTOR_TICK_WIDTH_MULTIPLIER = 1.2;

/** A hollow keycap outline at the hit line — the "put the note here" affordance. */
export function paintReceptor(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: LanePalette,
  state: ReceptorState,
): void {
  const inset = size * RECEPTOR_INSET_FRACTION;
  const boxSize = size - inset * 2;
  const radius = size * RECEPTOR_CORNER_FRACTION;
  const center = size / 2;

  const ringFraction =
    state === 'idle'
      ? RECEPTOR_IDLE_RING_FRACTION
      : state === 'pressed'
        ? RECEPTOR_PRESSED_RING_FRACTION
        : RECEPTOR_FLASH_RING_FRACTION;
  const ringColor =
    state === 'flash'
      ? WHITE
      : state === 'pressed'
        ? palette.light
        : mix(palette.hue, palette.light, RECEPTOR_IDLE_RING_LIGHTEN_FRACTION);
  const ringAlpha = 1;
  const fillAlpha =
    state === 'idle'
      ? RECEPTOR_IDLE_FILL_ALPHA
      : state === 'pressed'
        ? RECEPTOR_PRESSED_FILL_ALPHA
        : RECEPTOR_FLASH_FILL_ALPHA;

  ctx.save();

  if (state === 'flash') {
    const corona = ctx.createRadialGradient(center, center, 0, center, center, center);
    corona.addColorStop(0, rgba(WHITE, FLASH_CORONA_ALPHA));
    corona.addColorStop(
      FLASH_CORONA_MID_STOP,
      rgba(palette.light, FLASH_CORONA_ALPHA * FLASH_CORONA_MID_SHARE),
    );
    corona.addColorStop(1, rgba(palette.hue, 0));
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = rgba(WHITE, FLASH_SPIKE_ALPHA);
    ctx.lineWidth = Math.max(1, size * FLASH_SPIKE_WIDTH_FRACTION);
    ctx.lineCap = 'round';
    for (let spike = 0; spike < FLASH_SPIKE_COUNT; spike++) {
      const angle = (spike / FLASH_SPIKE_COUNT) * TWO_PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(
        center + cos * size * FLASH_SPIKE_INNER_FRACTION,
        center + sin * size * FLASH_SPIKE_INNER_FRACTION,
      );
      ctx.lineTo(
        center + cos * size * FLASH_SPIKE_OUTER_FRACTION,
        center + sin * size * FLASH_SPIKE_OUTER_FRACTION,
      );
      ctx.stroke();
    }
  }

  ctx.fillStyle = rgba(BLACK, RECEPTOR_WELL_ALPHA);
  roundRectPath(ctx, inset, inset, boxSize, boxSize, radius);
  ctx.fill();
  ctx.fillStyle = rgba(state === 'idle' ? palette.shade : palette.hue, fillAlpha);
  roundRectPath(ctx, inset, inset, boxSize, boxSize, radius);
  ctx.fill();

  if (state !== 'idle') {
    const innerGlow = ctx.createRadialGradient(center, center, 0, center, center, boxSize / 2);
    innerGlow.addColorStop(
      0,
      rgba(state === 'flash' ? WHITE : palette.light, RECEPTOR_INNER_GLOW_ALPHA),
    );
    innerGlow.addColorStop(1, rgba(palette.hue, 0));
    ctx.fillStyle = innerGlow;
    roundRectPath(ctx, inset, inset, boxSize, boxSize, radius);
    ctx.fill();
  }

  ctx.strokeStyle = rgba(ringColor, ringAlpha);
  ctx.lineWidth = Math.max(1, size * ringFraction);
  roundRectPath(ctx, inset, inset, boxSize, boxSize, radius);
  ctx.stroke();

  // Corner ticks give the idle ring enough structure to read as a *target*
  // rather than as an empty square the art forgot to fill.
  const tick = boxSize * RECEPTOR_CORNER_TICK_FRACTION;
  ctx.strokeStyle = rgba(ringColor, ringAlpha * RECEPTOR_TICK_ALPHA);
  ctx.lineWidth = Math.max(1, size * ringFraction * RECEPTOR_TICK_WIDTH_MULTIPLIER);
  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [inset, inset, 1, 1],
    [inset + boxSize, inset, -1, 1],
    [inset, inset + boxSize, 1, -1],
    [inset + boxSize, inset + boxSize, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * tick);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Touch button ────────────────────────────────────────────────────────────

const TOUCH_INSET_FRACTION = 0.06;
const TOUCH_CORNER_FRACTION = 0.26;
const TOUCH_BASE_DEPTH_FRACTION = 0.1;
const TOUCH_PRESSED_SINK_FRACTION = 0.06;
const TOUCH_RIM_FRACTION = 0.04;
const TOUCH_GLYPH_SPAN_FRACTION = 0.44;
const TOUCH_PRESSED_BRIGHTENING = 0.55;
const TOUCH_INNER_SHADOW_ALPHA = 0.35;
const TOUCH_PRESSED_HALO_ALPHA = 0.75;
const TOUCH_PRESSED_HALO_WIDTH = 1.6;
const TOUCH_INNER_SHADOW_HEIGHT_FRACTION = 0.4;
const TOUCH_BASE_DARKENING = 0.45;

/** A chunky mobile button carrying the same arrow its lane's notes carry. */
export function paintTouchButton(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: LanePalette,
  state: TouchState,
): void {
  const inset = size * TOUCH_INSET_FRACTION;
  const baseDepth = size * TOUCH_BASE_DEPTH_FRACTION;
  const sink = state === 'pressed' ? size * TOUCH_PRESSED_SINK_FRACTION : 0;
  const capSize = size - inset * 2;
  const capHeight = capSize - baseDepth;
  const radius = size * TOUCH_CORNER_FRACTION;
  const rimWidth = Math.max(1, size * TOUCH_RIM_FRACTION);
  const capY = inset + sink;
  // The base's rect is fixed regardless of press state — its bottom always lands
  // at inset + capSize, matching the top inset so the full rounded base stays
  // inside the frame. Only the cap moves: a press draws it lower, over the top
  // of the same base, which is what makes the button read as a cap sinking
  // rather than the whole button shrinking.
  const baseY = inset + capHeight;

  const face: KeycapFace =
    state === 'pressed'
      ? {
          top: mix(palette.light, WHITE, TOUCH_PRESSED_BRIGHTENING),
          mid: mix(palette.hue, WHITE, TOUCH_PRESSED_BRIGHTENING),
          bottom: palette.hue,
          glyph: WHITE,
          rim: NEAR_BLACK,
          gloss: false,
        }
      : {
          top: palette.light,
          mid: palette.hue,
          bottom: palette.shade,
          glyph: WHITE,
          rim: NEAR_BLACK,
          gloss: true,
        };

  ctx.save();

  ctx.fillStyle = mix(palette.shade, BLACK, TOUCH_BASE_DARKENING);
  roundRectPath(ctx, inset, baseY, capSize, baseDepth, radius);
  ctx.fill();

  paintKeycapBody(ctx, inset, capY, capSize, capHeight, radius, face, rimWidth);

  if (state === 'pressed') {
    const innerShadowH = capHeight * TOUCH_INNER_SHADOW_HEIGHT_FRACTION;
    ctx.fillStyle = verticalGradient(ctx, inset, capY, innerShadowH, [
      [0, rgba(BLACK, TOUCH_INNER_SHADOW_ALPHA)],
      [1, rgba(BLACK, 0)],
    ]);
    roundRectPath(ctx, inset, capY, capSize, innerShadowH, radius);
    ctx.fill();

    ctx.strokeStyle = rgba(palette.light, TOUCH_PRESSED_HALO_ALPHA);
    ctx.lineWidth = rimWidth * TOUCH_PRESSED_HALO_WIDTH;
    roundRectPath(ctx, inset, capY, capSize, capHeight, radius);
    ctx.stroke();
  }

  const glyphCenterY = capY + capHeight / 2;
  arrowGlyphPath(ctx, size / 2, glyphCenterY, size * TOUCH_GLYPH_SPAN_FRACTION, palette.glyph);
  ctx.fillStyle = face.glyph;
  ctx.fill();
  ctx.strokeStyle = rgba(BLACK, GLYPH_OUTLINE_ALPHA);
  ctx.lineWidth = Math.max(1, size * GLYPH_OUTLINE_FRACTION);
  ctx.stroke();

  ctx.restore();
}
