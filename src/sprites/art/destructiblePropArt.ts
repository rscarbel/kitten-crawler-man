/**
 * The cellars' smashable furniture: an upright barrel, a barrel on its side, a
 * crate, a bookshelf, a standing torch and a brazier, each at four wear stages
 * — intact, damaged, coming apart, and the flat wreckage left behind.
 *
 * Floor 1 is warm and old, so every piece is painted from one warm-oak ramp and
 * one dark-iron ramp and reads as furniture from a single workshop. The service
 * level's steel and plastic versions of the same props live in
 * `floorTwoPropVariantArt.ts`; how a break flies and settles is shared through
 * `propPaint.ts`.
 *
 * The static props carry {@link PROP_VARIANT_COUNT} looks per wear stage. Their
 * geometry never changes between looks — only stains, contents and wear do — so
 * a room of barrels reads as one cooper's work that has aged differently.
 *
 * A flame paints only itself: the light it throws on the floor and walls is the
 * lighting pass's job, so no frame here carries a glow round its fire.
 *
 * Everything is in the caller's `ts` (the logical tile) from the anchor tile's
 * top-left corner (`ox`, `oy`).
 */

import {
  PROP_VARIANT_COUNT,
  SHATTER_FRAMES,
  TWO_PI,
  contactShadow,
  cylinderRamp,
  drawDebrisBurst,
  drawWreckageField,
  lerp,
  pick,
  puff,
  radialDebris,
  signedUnit,
  speckle,
  verticalRamp,
  withRotation,
  wreckageField,
  wreckageShadow,
  type BurstCloud,
  type Ctx,
  type DebrisPiece,
} from './propPaint';
import { mulberry32 } from '../person/rng';

export { SHATTER_FRAMES };

/** Frames in the torch's flame loop, shared by its intact and damaged rows. */
export const FLAME_FRAMES = 6;
/**
 * Frames in the brazier's flame loop. Shorter than the torch's because a bed of
 * coals in a wide bowl settles into a slower dance than a brand does.
 */
export const BRAZIER_FLAME_FRAMES = 4;

export type PropKind = 'barrel' | 'barrel_side' | 'crate' | 'torch' | 'brazier' | 'bookshelf';
export type PropState = 'idle' | 'damaged' | 'shatter' | 'remains';

// ── Palette ───────────────────────────────────────────────────────────────────
// Five-value warm oak ramp. The darkest value is the outline colour — nothing
// is drawn in pure black, which reads as a UI icon rather than a prop.
const WOOD_EDGE = '#2a1a0d';
const WOOD_SHADOW = '#3a2413';
const WOOD_DARK = '#5a3a1e';
const WOOD_MID = '#7a5028';
const WOOD_LIGHT = '#9a6a38';
const WOOD_RIM = '#c09050';
const WOOD_RAMP = [WOOD_SHADOW, WOOD_DARK, WOOD_MID, WOOD_LIGHT, WOOD_RIM] as const;

// Old blackened iron, a touch warm so it sits in the cellars' tallow light.
const IRON_EDGE = '#1c1a1a';
const IRON_DARK = '#33312f';
const IRON_MID = '#4a4744';
const IRON_LIGHT = '#6e6a64';
const IRON_SPEC = '#a49c90';
const IRON_RAMP = [IRON_DARK, IRON_MID, IRON_LIGHT] as const;

const CAVITY = '#1d1208';
const DUST = '#b09878';
const DUST_RGB = [176, 152, 120] as const;
const ASH = '#8a7e74';
const ASH_RGB = [138, 126, 116] as const;

// Fire ramp, from the pale core out to the cooling tips.
const FLAME_CORE = '#fff6cf';
const FLAME_HOT = '#ffd24a';
const FLAME_MID = '#ff8a1e';
const FLAME_OUTER = '#e2450f';
const SOOT = '#241a14';
const SMOKE_RGB = [172, 166, 160] as const;
/** Coal that has gone out: what a spilled fire bed is once the remains are left lying. */
const DEAD_COAL = '#2e2724';
const DEAD_COAL_GREY = '#4d4540';

// Pitch-soaked rag on a torch head: near-black with a glossy, warm sheen.
const PITCH_DARK = '#1f1610';
const PITCH_MID = '#3a2a1c';
const PITCH_SHEEN = '#7a5c3c';
const CHAR_BLACK = '#141110';
const CHAR_GREY = '#3c3632';

// Stains a barrel or crate may carry. Wide tonal washes, never speckle.
const WINE_STAIN = 'rgba(70,14,22,0.55)';
const DAMP_STAIN = 'rgba(20,16,10,0.4)';
const SALT_BLOOM = 'rgba(214,204,178,0.32)';
const BRAND_MARK = 'rgba(28,16,8,0.7)';
const STRAW = '#b39a52';
const STRAW_DARK = '#7d6a34';

/** Seed offsets for each of a static prop's looks. Literal per look, never derived. */
const VARIANT_SEEDS = [0x0, 0x51d7, 0xa3b1] as const;

function variantSeed(variant: number): number {
  return VARIANT_SEEDS[variant % PROP_VARIANT_COUNT] ?? VARIANT_SEEDS[0];
}

// ── Shared wood and iron primitives ───────────────────────────────────────────

const WOOD_CYLINDER_STOPS = [
  [0, WOOD_DARK],
  [0.18, WOOD_LIGHT],
  [0.34, WOOD_RIM],
  [0.62, WOOD_MID],
  [0.86, WOOD_DARK],
  [1, WOOD_SHADOW],
] as const;

/** Left-to-right wood shading with the highlight just left of centre, where the key light hits. */
function woodGradient(ctx: Ctx, x0: number, x1: number, y: number): CanvasGradient {
  return cylinderRamp(ctx, x0, x1, y, WOOD_CYLINDER_STOPS);
}

const WOOD_FACE_STOPS = [
  [0, WOOD_LIGHT],
  [0.35, WOOD_MID],
  [1, WOOD_SHADOW],
] as const;

/** Top-to-bottom wood shading for a front face: lit at the top, falling off toward the floor. */
function woodGradientV(ctx: Ctx, x: number, y0: number, y1: number): CanvasGradient {
  return verticalRamp(ctx, x, y0, y1, WOOD_FACE_STOPS);
}

const SEAM_ALPHA = 0.85;

/** A 1px plank seam. The caller varies the spacing so seams never read as stripes. */
function seam(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alpha = SEAM_ALPHA,
  colour = WOOD_SHADOW,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

const IRON_STRAP_SPEC_ALPHA = 0.7;
const IRON_STRAP_SPEC_OFFSET = 0.5;

/** A flat iron strap between two points, lit along its upper edge. */
function ironStrap(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number): void {
  const g = ctx.createLinearGradient(x0, y0 - width, x0, y0 + width);
  g.addColorStop(0, IRON_LIGHT);
  g.addColorStop(0.5, IRON_MID);
  g.addColorStop(1, IRON_DARK);
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalAlpha = IRON_STRAP_SPEC_ALPHA;
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - IRON_STRAP_SPEC_OFFSET, y0 - IRON_STRAP_SPEC_OFFSET);
  ctx.lineTo(x1 - IRON_STRAP_SPEC_OFFSET, y1 - IRON_STRAP_SPEC_OFFSET);
  ctx.stroke();
  ctx.restore();
}

const CRACK_STEPS = 5;
const CRACK_WIDTH = 1.4;

/** A jagged split running down a plank, with the dark cavity showing through. */
function crack(ctx: Ctx, x: number, y0: number, y1: number, wobble: number, rng: () => number) {
  ctx.save();
  ctx.strokeStyle = CAVITY;
  ctx.lineWidth = CRACK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  for (let i = 1; i <= CRACK_STEPS; i++) {
    ctx.lineTo(x + signedUnit(rng) * (wobble / 2), lerp(y0, y1, i / CRACK_STEPS));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A missing chip: a shallow recess with a lit splinter lip on its upper edge.
 * Deep brown rather than black — a black hole at this size reads as a sticker.
 */
function chip(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const peak = [x + w * 0.6, y - h * 0.3] as const;
  const right = [x + w, y + h * 0.2] as const;
  ctx.save();
  const recess = ctx.createLinearGradient(x, y - h * 0.3, x + w, y + h);
  recess.addColorStop(0, CAVITY);
  recess.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = recess;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(...peak);
  ctx.lineTo(...right);
  ctx.lineTo(x + w * 0.45, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WOOD_RIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(...peak);
  ctx.lineTo(...right);
  ctx.stroke();
  ctx.restore();
}

/** A soft-edged tonal wash in an ellipse — how a stain sits in wood without speckle. */
function stainWash(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, colour: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A nail head: a dark dot with a lit pip on its upper side. */
function nailHead(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = IRON_SPEC;
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

// ── Upright barrel ────────────────────────────────────────────────────────────

/** Fixed seed for the upright barrel's stave spacing and its damage marks. */
const BARREL_SEED = 0x8a71;

const BARREL_LID_RY = 7;
const BARREL_TOP_RX = 20;
const BARREL_BOTTOM_RX = 17;
const BARREL_BULGE_RX = 23;
const BARREL_TOP_FRACTION = 0.22;
const BARREL_BOTTOM_FRACTION = 0.88;
const BARREL_MID_FRACTION = 0.55;
const BARREL_UPPER_HOOP_FRACTION = 0.24;
const BARREL_LOWER_HOOP_FRACTION = 0.74;
const BARREL_HOOP_THICKNESS = 3.5;
const BARREL_UPPER_HOOP_RY_FRACTION = 0.85;
const BARREL_LOWER_HOOP_RY_FRACTION = 0.8;
const BARREL_SPRUNG_HOOP_LIFT = 2;
const BARREL_SPRUNG_HOOP_TILT = -0.13;
const BARREL_STAVE_GAP_MIN = 4;
const BARREL_STAVE_GAP_SPREAD = 3.5;
const BARREL_STAVE_INSET = 2;
/** A stave seam leans outward with the bulge, by this share of its offset from centre. */
const BARREL_STAVE_FLARE = 0.06;
const BARREL_SHADOW_DROP = 3;
const BARREL_BUNG_RADIUS = 2;

interface BarrelGeometry {
  readonly cx: number;
  readonly topY: number;
  readonly bottomY: number;
  readonly midY: number;
}

function barrelGeometry(ox: number, oy: number, ts: number): BarrelGeometry {
  return {
    cx: ox + ts / 2,
    topY: oy + ts * BARREL_TOP_FRACTION,
    bottomY: oy + ts * BARREL_BOTTOM_FRACTION,
    midY: oy + ts * BARREL_MID_FRACTION,
  };
}

/** Outline of the barrel body: bulged cylinder walls plus the base ellipse. */
function barrelBodyPath(ctx: Ctx, g: BarrelGeometry): void {
  const { cx, topY, bottomY, midY } = g;
  ctx.beginPath();
  ctx.moveTo(cx - BARREL_TOP_RX, topY);
  ctx.bezierCurveTo(
    cx - BARREL_BULGE_RX,
    lerp(topY, midY, 0.7),
    cx - BARREL_BULGE_RX,
    lerp(midY, bottomY, 0.4),
    cx - BARREL_BOTTOM_RX,
    bottomY,
  );
  ctx.ellipse(cx, bottomY, BARREL_BOTTOM_RX, BARREL_LID_RY * 0.8, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(
    cx + BARREL_BULGE_RX,
    lerp(midY, bottomY, 0.4),
    cx + BARREL_BULGE_RX,
    lerp(topY, midY, 0.7),
    cx + BARREL_TOP_RX,
    topY,
  );
  ctx.closePath();
}

/** Half-width of the barrel at height `y`, following the bulge. */
function barrelRxAt(g: BarrelGeometry, y: number): number {
  const t = (y - g.topY) / (g.bottomY - g.topY);
  const bulge = Math.sin(t * Math.PI);
  return lerp(BARREL_TOP_RX, BARREL_BOTTOM_RX, t) + bulge * (BARREL_BULGE_RX - BARREL_TOP_RX);
}

/**
 * What each of a barrel's looks carries: a cellarman's chalk mark, a weeping
 * bung with its lid knocked ajar, or a damp foot that has rusted its lower
 * hoop away. The barrel's shape never changes between them.
 */
type BarrelLook = 'chalked' | 'wine' | 'damp';

const BARREL_LOOKS: Readonly<Record<number, BarrelLook>> = { 0: 'chalked', 1: 'wine', 2: 'damp' };

const CHALK = 'rgba(222,214,196,0.75)';
const CHALK_WIDTH = 1.3;
/** A chalked ring with a cross through it, and a tally beside it, on the barrel's lit side. */
const CHALK_MARK = {
  dx: -7,
  yFraction: 0.42,
  ringR: 4,
  tallyDx: 4,
  tallyStep: 2.4,
  tallyCount: 3,
  tallyHalf: 3.5,
} as const;
/** A wine run's second, darker pool where it has soaked the staves above the foot. */
const WINE_SOAK = 'rgba(52,8,14,0.6)';
const WINE_RUN_JITTER = 4;
const WINE_POOL = { drop: 3, widthScale: 1.6, ry: 4 } as const;
/** How far a knocked lid has lifted and turned, showing the dark inside under its edge. */
const LID_AJAR = { lift: 3, dx: -2, tilt: -0.14 } as const;
/** Where the lost lower hoop has left its mark: a band of rust on the staves. */
const HOOP_GHOST = 'rgba(96,52,26,0.55)';
const HOOP_GHOST_WIDTH = 1.4;
const DAMP_TIDE_JITTER = 3;
const DAMP_WASH_WIDTH = 1.2;
const DAMP_WASH_DEPTH = 1.4;
const SALT_LINE_RY_FRACTION = 0.7;
const SALT_LINE_TRIM = 0.1;

/** Chalk: a ring with a cross through it, and a short tally beside it. */
function chalkMark(ctx: Ctx, x: number, y: number): void {
  const m = CHALK_MARK;
  ctx.save();
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = CHALK_WIDTH;
  ctx.beginPath();
  ctx.arc(x, y, m.ringR, 0, TWO_PI);
  ctx.moveTo(x - m.ringR, y - m.ringR);
  ctx.lineTo(x + m.ringR, y + m.ringR);
  for (let i = 0; i < m.tallyCount; i++) {
    const tx = x + m.ringR + m.tallyDx + i * m.tallyStep;
    ctx.moveTo(tx, y - m.tallyHalf);
    ctx.lineTo(tx, y + m.tallyHalf);
  }
  ctx.stroke();
  ctx.restore();
}

const WINE_STAIN_RX = 7;
const WINE_STAIN_RY = 14;
const DAMP_STAIN_RY = 8;
const SALT_BLOOM_WIDTH = 1.4;

function drawBarrelLook(ctx: Ctx, g: BarrelGeometry, look: BarrelLook, rng: () => number): void {
  ctx.save();
  barrelBodyPath(ctx, g);
  ctx.clip();
  if (look === 'chalked') {
    chalkMark(ctx, g.cx + CHALK_MARK.dx, lerp(g.topY, g.bottomY, CHALK_MARK.yFraction));
  } else if (look === 'wine') {
    // A run down the front from a weeping bung, soaked darker toward the foot.
    const runX = g.cx + signedUnit(rng) * WINE_RUN_JITTER;
    stainWash(ctx, runX, g.midY, WINE_STAIN_RX, WINE_STAIN_RY, WINE_STAIN);
    stainWash(ctx, runX, g.midY + WINE_STAIN_RY / 2, WINE_STAIN_RX, WINE_STAIN_RY, WINE_SOAK);
    stainWash(
      ctx,
      runX,
      g.bottomY - WINE_POOL.drop,
      WINE_STAIN_RX * WINE_POOL.widthScale,
      WINE_POOL.ry,
      WINE_SOAK,
    );
  } else {
    // Damp wicking up from the floor, its high-water mark a pale salt line.
    const tideY = g.bottomY - DAMP_STAIN_RY - rng() * DAMP_TIDE_JITTER;
    stainWash(
      ctx,
      g.cx,
      g.bottomY,
      BARREL_BULGE_RX * DAMP_WASH_WIDTH,
      DAMP_STAIN_RY * DAMP_WASH_DEPTH,
      DAMP_STAIN,
    );
    ctx.strokeStyle = SALT_BLOOM;
    ctx.lineWidth = SALT_BLOOM_WIDTH;
    ctx.beginPath();
    ctx.ellipse(
      g.cx,
      tideY,
      barrelRxAt(g, tideY),
      BARREL_LID_RY * SALT_LINE_RY_FRACTION,
      0,
      SALT_LINE_TRIM,
      Math.PI - SALT_LINE_TRIM,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** The rust band a lost hoop leaves on the staves it used to bind. */
function hoopGhost(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thickness: number,
): void {
  ctx.save();
  ctx.strokeStyle = HOOP_GHOST;
  ctx.lineWidth = HOOP_GHOST_WIDTH;
  for (const dy of [-thickness / 2, thickness / 2]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + dy, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBarrelBody(ctx: Ctx, g: BarrelGeometry, rng: () => number): void {
  const { cx, topY, bottomY } = g;
  barrelBodyPath(ctx, g);
  ctx.save();
  ctx.fillStyle = woodGradient(ctx, cx - BARREL_BULGE_RX, cx + BARREL_BULGE_RX, g.midY);
  ctx.fill();
  ctx.clip();
  // The key light falls off down the staves, so the foot of the barrel is darker than its shoulder.
  ctx.fillStyle = verticalRamp(ctx, cx, topY, bottomY, [
    [0, 'rgba(255,230,190,0.10)'],
    [0.45, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.32)'],
  ]);
  ctx.fillRect(cx - BARREL_BULGE_RX, topY, BARREL_BULGE_RX * 2, bottomY - topY + BARREL_LID_RY);
  let offset = -BARREL_BULGE_RX + BARREL_STAVE_INSET;
  while (offset < BARREL_BULGE_RX - BARREL_STAVE_INSET) {
    const x = cx + offset;
    seam(ctx, x, topY - 2, x + offset * BARREL_STAVE_FLARE, bottomY + 2, 0.55 + rng() * 0.3);
    offset += BARREL_STAVE_GAP_MIN + rng() * BARREL_STAVE_GAP_SPREAD;
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  barrelBodyPath(ctx, g);
  ctx.stroke();
  ctx.restore();
}

const HOOP_SHADOW_ALPHA = 0.45;
const HOOP_KEY_LIGHT_START = Math.PI * 0.15;
const HOOP_KEY_LIGHT_END = Math.PI * 0.75;

/**
 * An iron hoop round the barrel, drawn as the strip between two ellipse arcs.
 * Its upper edge catches the key light across the front of the barrel, and it
 * throws a thin shadow on the staves below it — that pair is what makes it
 * read as a band standing proud of the wood.
 */
function hoopBand(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thickness: number,
): void {
  ctx.save();
  ctx.globalAlpha = HOOP_SHADOW_ALPHA;
  ctx.strokeStyle = CAVITY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy + thickness / 2 + 1, rx, ry, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();

  const g = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
  g.addColorStop(0, IRON_DARK);
  g.addColorStop(0.3, IRON_LIGHT);
  g.addColorStop(0.6, IRON_MID);
  g.addColorStop(1, IRON_DARK);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + thickness / 2, rx, ry, 0, 0, Math.PI);
  ctx.ellipse(cx, cy - thickness / 2, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = IRON_EDGE;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy - thickness / 2 + 0.5, rx, ry, 0, HOOP_KEY_LIGHT_START, HOOP_KEY_LIGHT_END);
  ctx.stroke();
  ctx.restore();
}

const LID_BOARD_COUNT_HALF = 1;
const LID_BOARD_SPACING_FRACTION = 0.75;

function drawBarrelLid(ctx: Ctx, g: BarrelGeometry, rng: () => number): void {
  const { cx, topY } = g;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, topY, BARREL_TOP_RX, BARREL_LID_RY, 0, 0, TWO_PI);
  const lidGrad = ctx.createLinearGradient(
    cx - BARREL_TOP_RX,
    topY - BARREL_LID_RY,
    cx + BARREL_TOP_RX,
    topY + BARREL_LID_RY,
  );
  lidGrad.addColorStop(0, WOOD_RIM);
  lidGrad.addColorStop(0.45, WOOD_LIGHT);
  lidGrad.addColorStop(1, WOOD_MID);
  ctx.fillStyle = lidGrad;
  ctx.fill();
  ctx.clip();
  for (let i = -LID_BOARD_COUNT_HALF; i <= LID_BOARD_COUNT_HALF; i++) {
    const y = topY + i * (BARREL_LID_RY * LID_BOARD_SPACING_FRACTION) + signedUnit(rng) / 2;
    seam(ctx, cx - BARREL_TOP_RX, y, cx + BARREL_TOP_RX, y, 0.6);
  }
  // The bung, a dark plug in the middle board.
  ctx.fillStyle = WOOD_SHADOW;
  ctx.beginPath();
  ctx.arc(cx + BARREL_TOP_RX * 0.3, topY + 1, BARREL_BUNG_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // The chime: the stave ends standing a little proud of the lid, lit on the far side.
  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(cx, topY, BARREL_TOP_RX, BARREL_LID_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = WOOD_RIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, topY, BARREL_TOP_RX - 1, BARREL_LID_RY - 1, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();
}

function drawBarrel(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
  seedTerm: number,
): void {
  const rng = mulberry32(BARREL_SEED + seedTerm);
  const lookRng = mulberry32(BARREL_SEED + variantSeed(variant) + seedTerm);
  const g = barrelGeometry(ox, oy, ts);

  contactShadow(ctx, g.cx, g.bottomY + BARREL_SHADOW_DROP, ts);
  drawBarrelBody(ctx, g, rng);
  const look = BARREL_LOOKS[variant] ?? 'chalked';
  drawBarrelLook(ctx, g, look, lookRng);

  const upperHoopY = lerp(g.topY, g.bottomY, BARREL_UPPER_HOOP_FRACTION);
  const lowerHoopY = lerp(g.topY, g.bottomY, BARREL_LOWER_HOOP_FRACTION);
  const upperRy = BARREL_LID_RY * BARREL_UPPER_HOOP_RY_FRACTION;
  if (damaged) {
    const sprungY = upperHoopY - BARREL_SPRUNG_HOOP_LIFT;
    withRotation(ctx, g.cx, sprungY, BARREL_SPRUNG_HOOP_TILT, () => {
      hoopBand(ctx, g.cx, sprungY, barrelRxAt(g, upperHoopY), upperRy, BARREL_HOOP_THICKNESS);
    });
  } else {
    hoopBand(ctx, g.cx, upperHoopY, barrelRxAt(g, upperHoopY), upperRy, BARREL_HOOP_THICKNESS);
  }
  const lowerRy = BARREL_LID_RY * BARREL_LOWER_HOOP_RY_FRACTION;
  if (look === 'damp') {
    hoopGhost(ctx, g.cx, lowerHoopY, barrelRxAt(g, lowerHoopY), lowerRy, BARREL_HOOP_THICKNESS);
  } else {
    hoopBand(ctx, g.cx, lowerHoopY, barrelRxAt(g, lowerHoopY), lowerRy, BARREL_HOOP_THICKNESS);
  }

  if (look === 'wine') {
    // Knocked ajar: the dark of the barrel's inside shows where the lid has lifted off it.
    ctx.fillStyle = CAVITY;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.topY, BARREL_TOP_RX, BARREL_LID_RY, 0, 0, TWO_PI);
    ctx.fill();
    withRotation(ctx, g.cx, g.topY, LID_AJAR.tilt, () => {
      ctx.translate(LID_AJAR.dx, -LID_AJAR.lift);
      drawBarrelLid(ctx, g, rng);
    });
  } else {
    drawBarrelLid(ctx, g, rng);
  }

  if (damaged) {
    crack(ctx, g.cx - 7, g.topY + 6, g.bottomY - 5, 3.5, rng);
    chip(ctx, g.cx + 6, g.topY + 12, 7, 9);
    chip(ctx, g.cx - BARREL_TOP_RX + 4, g.topY - 1, 5, 5);
  }
}

// ── Barrel on its side ────────────────────────────────────────────────────────

/** Fixed seed for the fallen barrel's staves and its damage marks. */
const BARREL_SIDE_SEED = 0x51c3;

const BARREL_SIDE_HALF_LEN = 22;
const BARREL_SIDE_CAP_RX = 7;
const BARREL_SIDE_END_RY = 15;
const BARREL_SIDE_BULGE_RY = 18;
const BARREL_SIDE_CENTER_FRACTION = 0.56;
const BARREL_SIDE_CONTROL_FRACTION = 0.4;
const BARREL_SIDE_HOOP_FRACTIONS = [0.28, 0.72] as const;
const BARREL_SIDE_SPRUNG_HOOP_TILT = 0.16;
const BARREL_SIDE_HOOP_HALF_THICKNESS = 2;
const BARREL_SIDE_SHADOW_SCALE = 1.05;
const BARREL_SIDE_CAP_SEAM_STEP = 7;
const SIDE_CHALK = { dx: -10, dy: -6 } as const;
const SIDE_WINE = {
  jitter: 8,
  rx: 14,
  ry: 6,
  poolDx: 4,
  poolDy: 16,
  poolRx: 13,
  poolRy: 5,
  capStainDy: 6,
  capStainRx: 6,
  capStainRy: 9,
  bungDy: -4,
  bungRx: 1.6,
  bungRy: 2.4,
} as const;
const SIDE_DAMP = { widthScale: 1.3, ry: 9 } as const;
/** The damp look's lost hoop: the one nearer the floor-soaked end. */
const SIDE_LOST_HOOP = 1;

interface BarrelSideGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly leftX: number;
  readonly rightX: number;
}

function barrelSideGeometry(ox: number, oy: number, ts: number): BarrelSideGeometry {
  const cx = ox + ts / 2;
  const cy = oy + ts * BARREL_SIDE_CENTER_FRACTION;
  return { cx, cy, leftX: cx - BARREL_SIDE_HALF_LEN, rightX: cx + BARREL_SIDE_HALF_LEN };
}

function barrelSideBodyPath(ctx: Ctx, g: BarrelSideGeometry): void {
  const { cx, cy, leftX, rightX } = g;
  const controlDx = BARREL_SIDE_HALF_LEN * BARREL_SIDE_CONTROL_FRACTION;
  ctx.beginPath();
  ctx.moveTo(leftX, cy - BARREL_SIDE_END_RY);
  ctx.bezierCurveTo(
    cx - controlDx,
    cy - BARREL_SIDE_BULGE_RY,
    cx + controlDx,
    cy - BARREL_SIDE_BULGE_RY,
    rightX,
    cy - BARREL_SIDE_END_RY,
  );
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, -Math.PI / 2, Math.PI / 2);
  ctx.bezierCurveTo(
    cx + controlDx,
    cy + BARREL_SIDE_BULGE_RY,
    cx - controlDx,
    cy + BARREL_SIDE_BULGE_RY,
    leftX,
    cy + BARREL_SIDE_END_RY,
  );
  ctx.ellipse(leftX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

function drawBarrelSide(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
  seedTerm: number,
): void {
  const rng = mulberry32(BARREL_SIDE_SEED + seedTerm);
  const lookRng = mulberry32(BARREL_SIDE_SEED + variantSeed(variant) + seedTerm);
  const g = barrelSideGeometry(ox, oy, ts);
  const { cx, cy, rightX } = g;

  contactShadow(ctx, cx, cy + BARREL_SIDE_END_RY + 2, ts, BARREL_SIDE_SHADOW_SCALE);

  barrelSideBodyPath(ctx, g);
  ctx.save();
  ctx.fillStyle = woodGradientV(ctx, cx, cy - BARREL_SIDE_BULGE_RY, cy + BARREL_SIDE_BULGE_RY);
  ctx.fill();
  ctx.clip();
  let off = -BARREL_SIDE_BULGE_RY + BARREL_STAVE_INSET;
  while (off < BARREL_SIDE_BULGE_RY - BARREL_STAVE_INSET) {
    const y = cy + off;
    seam(ctx, g.leftX - 4, y, rightX, y, 0.45 + rng() * 0.3);
    off += BARREL_STAVE_GAP_MIN + rng() * (BARREL_STAVE_GAP_SPREAD - 0.5);
  }
  const look = BARREL_LOOKS[variant] ?? 'chalked';
  if (look === 'chalked') {
    chalkMark(ctx, cx + SIDE_CHALK.dx, cy + SIDE_CHALK.dy);
  } else if (look === 'wine') {
    stainWash(
      ctx,
      cx + signedUnit(lookRng) * SIDE_WINE.jitter,
      cy + BARREL_SIDE_BULGE_RY,
      SIDE_WINE.rx,
      SIDE_WINE.ry,
      WINE_SOAK,
    );
  } else {
    stainWash(
      ctx,
      cx,
      cy + BARREL_SIDE_BULGE_RY,
      BARREL_SIDE_HALF_LEN * SIDE_DAMP.widthScale,
      SIDE_DAMP.ry,
      DAMP_STAIN,
    );
  }
  ctx.restore();

  if (look === 'wine') {
    // Leaking from the open bung in its end: a pool spreading on the floor below it.
    stainWash(
      ctx,
      rightX + SIDE_WINE.poolDx,
      cy + SIDE_WINE.poolDy,
      SIDE_WINE.poolRx,
      SIDE_WINE.poolRy,
      WINE_SOAK,
    );
  }

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  barrelSideBodyPath(ctx, g);
  ctx.stroke();
  ctx.restore();

  const ryAt = (x: number) => {
    const t = (x - g.leftX) / (g.rightX - g.leftX);
    return lerp(BARREL_SIDE_END_RY, BARREL_SIDE_BULGE_RY, Math.sin(t * Math.PI));
  };
  BARREL_SIDE_HOOP_FRACTIONS.forEach((frac, index) => {
    const x = lerp(g.leftX, g.rightX, frac);
    const ry = ryAt(x);
    if (look === 'damp' && index === SIDE_LOST_HOOP) {
      ctx.save();
      ctx.strokeStyle = HOOP_GHOST;
      ctx.lineWidth = HOOP_GHOST_WIDTH;
      ctx.beginPath();
      ctx.ellipse(x, cy, BARREL_SIDE_HOOP_HALF_THICKNESS, ry, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const paintHoop = () => {
      ctx.beginPath();
      ctx.ellipse(x, cy, BARREL_SIDE_HOOP_HALF_THICKNESS, ry, 0, 0, TWO_PI);
      const bandGrad = ctx.createLinearGradient(x, cy - ry, x, cy + ry);
      bandGrad.addColorStop(0, IRON_SPEC);
      bandGrad.addColorStop(0.25, IRON_LIGHT);
      bandGrad.addColorStop(0.6, IRON_MID);
      bandGrad.addColorStop(1, IRON_DARK);
      ctx.fillStyle = bandGrad;
      ctx.fill();
      ctx.strokeStyle = IRON_EDGE;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    };
    const isSprung = damaged && index === 0;
    if (isSprung) withRotation(ctx, x, cy, BARREL_SIDE_SPRUNG_HOOP_TILT, paintHoop);
    else {
      ctx.save();
      paintHoop();
      ctx.restore();
    }
  });

  // The visible end, lit across its upper half.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, 0, TWO_PI);
  const capGrad = ctx.createRadialGradient(
    rightX - 2,
    cy - 5,
    1,
    rightX,
    cy,
    BARREL_SIDE_END_RY * 1.1,
  );
  capGrad.addColorStop(0, WOOD_LIGHT);
  capGrad.addColorStop(0.6, WOOD_MID);
  capGrad.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = capGrad;
  ctx.fill();
  ctx.clip();
  for (let i = -1; i <= 1; i++) {
    const y = cy + i * BARREL_SIDE_CAP_SEAM_STEP;
    seam(ctx, rightX - BARREL_SIDE_CAP_RX, y, rightX + BARREL_SIDE_CAP_RX, y, 0.6);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
  if (look === 'wine') {
    // The open bunghole, and the wine that has run down the end from it.
    stainWash(
      ctx,
      rightX,
      cy + SIDE_WINE.capStainDy,
      SIDE_WINE.capStainRx,
      SIDE_WINE.capStainRy,
      WINE_SOAK,
    );
    ctx.fillStyle = CAVITY;
    ctx.beginPath();
    ctx.ellipse(rightX, cy + SIDE_WINE.bungDy, SIDE_WINE.bungRx, SIDE_WINE.bungRy, 0, 0, TWO_PI);
    ctx.fill();
  }

  if (damaged) {
    crack(ctx, cx - 4, cy - BARREL_SIDE_BULGE_RY + 3, cy + BARREL_SIDE_BULGE_RY - 4, 3, rng);
    chip(ctx, cx + 4, cy - BARREL_SIDE_END_RY + 1, 8, 6);
    chip(ctx, g.leftX + 2, cy + 5, 6, 7);
  }
}

// ── Crate ─────────────────────────────────────────────────────────────────────
// 3/4 view — front face, right side face and a shallow top — built the way a
// cooper's crate is: horizontal slats with gaps between them, nailed to corner
// battens, with a diagonal brace across the front holding it square.

const CRATE_SEED = 0x3f19;
const CRATE_FRONT_LEFT_FRACTION = 0.12;
const CRATE_FRONT_RIGHT_FRACTION = 0.72;
const CRATE_FRONT_TOP_FRACTION = 0.34;
const CRATE_FRONT_BOTTOM_FRACTION = 0.88;
const CRATE_DEPTH_X_FRACTION = 0.16;
const CRATE_DEPTH_Y_FRACTION = -0.12;
const CRATE_SLAT_COUNT = 3;
const CRATE_SLAT_GAP = 1.6;
const CRATE_BATTEN_WIDTH = 5;
const CRATE_BRACE_WIDTH = 5;
const CRATE_TOP_SLAT_COUNT = 3;
const CRATE_SIDE_SLAT_COUNT = 3;
const CRATE_NAIL_INSET = 2.5;
const CRATE_SHADOW_SCALE = 1.05;

/** What each look adds to the crate: a damp foot, a burnt-in brand, or a lid slat gone. */
type CrateLook = 'damp' | 'brand' | 'open';
const CRATE_LOOKS: Readonly<Record<number, CrateLook>> = { 0: 'damp', 1: 'brand', 2: 'open' };
const CRATE_CHALK = { xFraction: 0.42, yFraction: 0.3 } as const;
const CRATE_BRAND = {
  xFraction: 0.58,
  yFraction: 0.5,
  jitter: 0.05,
  radius: 5.5,
  barHalf: 8,
  width: 2.2,
  splitFrom: 0.15,
  splitTo: 0.7,
  splitDrop: -1,
  splitDepth: 0.4,
} as const;
const CRATE_STRAW = { count: 9, inset: 3, spreadY: 2.5, half: 3.5, tilt: 2.5 } as const;
/** The front slat the open look has had replaced, and the paler plank it was replaced with. */
const CRATE_REPLACED_SLAT = 2;
const CRATE_NEW_PLANK = 'rgba(214,176,118,0.45)';
/**
 * The damaged crate's stove-in middle slat: where across the front it split,
 * and how far each broken end's ragged outline sits from that line, in pixels.
 * The right end is notched part-way down rather than cut straight.
 */
const CRATE_STOVE_IN = {
  breakXFraction: 0.45,
  leftTopInset: 3,
  leftBottomInset: 7,
  rightTopOffset: 6,
  rightNotchOffset: 2,
  rightNotchDepthFraction: 0.6,
  rightBottomOffset: 8,
} as const;

interface CrateBox {
  readonly frontL: number;
  readonly frontR: number;
  readonly frontT: number;
  readonly frontB: number;
  readonly depthX: number;
  readonly depthY: number;
}

function crateBox(ox: number, oy: number, ts: number): CrateBox {
  return {
    frontL: ox + ts * CRATE_FRONT_LEFT_FRACTION,
    frontR: ox + ts * CRATE_FRONT_RIGHT_FRACTION,
    frontT: oy + ts * CRATE_FRONT_TOP_FRACTION,
    frontB: oy + ts * CRATE_FRONT_BOTTOM_FRACTION,
    depthX: ts * CRATE_DEPTH_X_FRACTION,
    depthY: ts * CRATE_DEPTH_Y_FRACTION,
  };
}

/** A run of slats filling a quad, each lit along its upper edge, with dark gaps between. */
function slatRun(
  ctx: Ctx,
  corners: readonly [readonly [number, number], readonly [number, number]],
  across: readonly [number, number],
  count: number,
  baseShade: string,
  litShade: string,
  rng: () => number,
): void {
  const [[x0, y0], [x1, y1]] = corners;
  const [ax, ay] = across;
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const gapT = CRATE_SLAT_GAP / Math.hypot(ax, ay);
    const s0 = t0;
    const s1 = Math.max(s0, t1 - gapT);
    ctx.fillStyle = baseShade;
    ctx.beginPath();
    ctx.moveTo(x0 + ax * s0, y0 + ay * s0);
    ctx.lineTo(x1 + ax * s0, y1 + ay * s0);
    ctx.lineTo(x1 + ax * s1, y1 + ay * s1);
    ctx.lineTo(x0 + ax * s1, y0 + ay * s1);
    ctx.closePath();
    ctx.fill();
    seam(ctx, x0 + ax * s0, y0 + ay * s0, x1 + ax * s0, y1 + ay * s0, 0.5 + rng() * 0.3, litShade);
  }
}

function drawCrate(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
  seedTerm: number,
): void {
  const rng = mulberry32(CRATE_SEED + seedTerm);
  const lookRng = mulberry32(CRATE_SEED + variantSeed(variant) + seedTerm);
  const look = CRATE_LOOKS[variant] ?? 'damp';
  const { frontL, frontR, frontT, frontB, depthX, depthY } = crateBox(ox, oy, ts);
  const backL = frontL + depthX;
  const backR = frontR + depthX;
  const backT = frontT + depthY;
  const backB = frontB + depthY;
  const frontW = frontR - frontL;
  const frontH = frontB - frontT;

  contactShadow(ctx, (frontL + backR) / 2, frontB + 2, ts, CRATE_SHADOW_SCALE);

  // The interior the gaps show into: the box's dark inside, filling its whole silhouette.
  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.moveTo(frontL, frontB);
  ctx.lineTo(frontL, frontT);
  ctx.lineTo(backL, backT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backB);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  ctx.fill();

  // Right side: furthest from the key light, so the darkest face.
  slatRun(
    ctx,
    [
      [frontR, frontT],
      [backR, backT],
    ],
    [0, frontH],
    CRATE_SIDE_SLAT_COUNT,
    WOOD_DARK,
    WOOD_MID,
    rng,
  );

  // Top: the brightest face. One look has a slat prised off and the straw packing showing.
  const topSlats = CRATE_TOP_SLAT_COUNT;
  for (let i = 0; i < topSlats; i++) {
    const t0 = i / topSlats;
    const t1 = (i + 1) / topSlats;
    const missing = look === 'open' && i === 1;
    const x0 = lerp(frontL, frontR, t0);
    const x1 = lerp(frontL, frontR, t1) - CRATE_SLAT_GAP;
    ctx.beginPath();
    ctx.moveTo(x0, frontT);
    ctx.lineTo(x1, frontT);
    ctx.lineTo(x1 + depthX, backT);
    ctx.lineTo(x0 + depthX, backT);
    ctx.closePath();
    if (missing) {
      ctx.fillStyle = STRAW_DARK;
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let s = 0; s < 6; s++) {
        const sx = lerp(x0, x1 + depthX, lookRng());
        const sy = lerp(backT, frontT, lookRng());
        seam(ctx, sx - 3, sy, sx + 3, sy + signedUnit(lookRng) * 2, 0.9, STRAW);
      }
      ctx.restore();
    } else {
      const topGrad = ctx.createLinearGradient(x0, frontT, x0 + depthX, backT);
      topGrad.addColorStop(0, WOOD_LIGHT);
      topGrad.addColorStop(1, WOOD_RIM);
      ctx.fillStyle = topGrad;
      ctx.fill();
      seam(ctx, x0 + 1, frontT, x0 + 1 + depthX, backT, 0.35);
    }
  }

  // Front: horizontal slats over the dark interior, lit at the top of each.
  for (let i = 0; i < CRATE_SLAT_COUNT; i++) {
    const y0 = lerp(frontT, frontB, i / CRATE_SLAT_COUNT);
    const y1 = lerp(frontT, frontB, (i + 1) / CRATE_SLAT_COUNT) - CRATE_SLAT_GAP;
    const stoveIn = damaged && i === 1;
    if (stoveIn) {
      // The middle slat split and pushed in: two broken ends either side of a hole.
      const breakX = lerp(frontL, frontR, CRATE_STOVE_IN.breakXFraction);
      const leftTopX = breakX - CRATE_STOVE_IN.leftTopInset;
      const leftBottomX = breakX - CRATE_STOVE_IN.leftBottomInset;
      const notchY = y0 + (y1 - y0) * CRATE_STOVE_IN.rightNotchDepthFraction;
      ctx.fillStyle = woodGradient(ctx, frontL, frontR, y0);
      ctx.beginPath();
      ctx.moveTo(frontL, y0);
      ctx.lineTo(leftTopX, y0);
      ctx.lineTo(leftBottomX, y1);
      ctx.lineTo(frontL, y1);
      ctx.closePath();
      ctx.moveTo(frontR, y0);
      ctx.lineTo(breakX + CRATE_STOVE_IN.rightTopOffset, y0);
      ctx.lineTo(breakX + CRATE_STOVE_IN.rightNotchOffset, notchY);
      ctx.lineTo(breakX + CRATE_STOVE_IN.rightBottomOffset, y1);
      ctx.lineTo(frontR, y1);
      ctx.closePath();
      ctx.fill();
      seam(ctx, leftTopX, y0, leftBottomX, y1, 0.9, WOOD_RIM);
      continue;
    }
    ctx.fillStyle = woodGradient(ctx, frontL, frontR, y0);
    ctx.fillRect(frontL, y0, frontW, y1 - y0);
    if (look === 'open' && i === CRATE_REPLACED_SLAT) {
      // A slat replaced with whatever plank was to hand: newer, paler wood.
      ctx.fillStyle = CRATE_NEW_PLANK;
      ctx.fillRect(frontL, y0, frontW, y1 - y0);
    }
    ctx.fillStyle = 'rgba(255,225,170,0.18)';
    ctx.fillRect(frontL, y0, frontW, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(frontL, y1 - 1, frontW, 1);
    let grainX = frontL + 6 + rng() * 6;
    while (grainX < frontR - 6) {
      seam(ctx, grainX, y0 + 1, grainX + 4, y0 + 1 + rng(), 0.25);
      grainX += 9 + rng() * 8;
    }
  }

  // The lower half of the box is further from the key light.
  ctx.fillStyle = verticalRamp(ctx, frontL, frontT, frontB, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.25)'],
  ]);
  ctx.fillRect(frontL, frontT, frontW, frontH);

  if (look === 'damp') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(frontL, frontT, frontW + depthX, frontH);
    ctx.clip();
    stainWash(ctx, (frontL + frontR) / 2, frontB, frontW * 0.7, 8, DAMP_STAIN);
    ctx.restore();
    chalkMark(
      ctx,
      lerp(frontL, frontR, CRATE_CHALK.xFraction),
      lerp(frontT, frontB, CRATE_CHALK.yFraction),
    );
  } else if (look === 'brand') {
    // A merchant's mark burnt deep into the slats: a ring with a bar through it.
    const b = CRATE_BRAND;
    const markX = lerp(frontL, frontR, b.xFraction + signedUnit(lookRng) * b.jitter);
    const markY = lerp(frontT, frontB, b.yFraction);
    ctx.save();
    ctx.strokeStyle = BRAND_MARK;
    ctx.lineWidth = b.width;
    ctx.beginPath();
    ctx.arc(markX, markY, b.radius, 0, TWO_PI);
    ctx.moveTo(markX - b.barHalf, markY);
    ctx.lineTo(markX + b.barHalf, markY);
    ctx.stroke();
    ctx.restore();
    // A split along the top's front slat, the dark of the inside showing through.
    seam(
      ctx,
      lerp(frontL, frontR, b.splitFrom),
      frontT + b.splitDrop,
      lerp(frontL, frontR, b.splitTo),
      frontT + b.splitDrop + depthY * b.splitDepth,
      1,
      CAVITY,
    );
  } else {
    // The straw packing, pulled up over the lip where the slat came off.
    const straw = CRATE_STRAW;
    for (let i = 0; i < straw.count; i++) {
      const sx = lerp(frontL + straw.inset, frontR, lookRng());
      const sy = frontT + signedUnit(lookRng) * straw.spreadY;
      seam(
        ctx,
        sx - straw.half,
        sy,
        sx + straw.half,
        sy + signedUnit(lookRng) * straw.tilt,
        0.9,
        STRAW,
      );
    }
  }

  // Corner battens, then the diagonal brace, all nailed through the slats.
  const battenGrad = woodGradientV(ctx, frontL, frontT, frontB);
  ctx.fillStyle = battenGrad;
  ctx.fillRect(frontL, frontT, CRATE_BATTEN_WIDTH, frontH);
  const rightBattenX = frontR - CRATE_BATTEN_WIDTH;
  ctx.fillRect(rightBattenX, frontT, CRATE_BATTEN_WIDTH, frontH);
  ctx.fillStyle = 'rgba(255,225,170,0.22)';
  ctx.fillRect(frontL, frontT, 1, frontH);
  ctx.fillRect(rightBattenX, frontT, 1, frontH);

  const braceStart = [frontL + CRATE_BATTEN_WIDTH, frontB - CRATE_BRACE_WIDTH / 2] as const;
  const braceEndY = damaged ? frontT + CRATE_BRACE_WIDTH * 1.6 : frontT + CRATE_BRACE_WIDTH / 2;
  const braceEnd = [rightBattenX + (damaged ? 2 : 0), braceEndY] as const;
  ctx.save();
  ctx.strokeStyle = WOOD_MID;
  ctx.lineWidth = CRATE_BRACE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(...braceStart);
  ctx.lineTo(...braceEnd);
  ctx.stroke();
  ctx.strokeStyle = WOOD_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(braceStart[0], braceStart[1] - CRATE_BRACE_WIDTH / 2);
  ctx.lineTo(braceEnd[0], braceEnd[1] - CRATE_BRACE_WIDTH / 2);
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < CRATE_SLAT_COUNT; i++) {
    const slatMidY = lerp(frontT, frontB, (i + 0.4) / CRATE_SLAT_COUNT);
    nailHead(ctx, frontL + CRATE_NAIL_INSET, slatMidY);
    nailHead(ctx, frontR - CRATE_NAIL_INSET, slatMidY);
  }
  nailHead(ctx, braceStart[0] + 2, braceStart[1]);
  if (!damaged) nailHead(ctx, braceEnd[0] - 2, braceEnd[1]);

  // Top edge of the side face, so the box keeps its corner where two faces meet.
  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(frontL, frontB);
  ctx.lineTo(frontL, frontT);
  ctx.lineTo(backL, backT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backB);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  ctx.moveTo(frontR, frontT);
  ctx.lineTo(backR, backT);
  ctx.moveTo(frontR, frontT);
  ctx.lineTo(frontR, frontB);
  ctx.moveTo(frontL, frontT);
  ctx.lineTo(frontR, frontT);
  ctx.stroke();
  ctx.restore();

  if (damaged) chip(ctx, frontR - 11, frontT + 2, 6, 5);
}

// ── Bookshelf ─────────────────────────────────────────────────────────────────
// A tall oak case against a wall: cornice, two stiles, three compartments of
// books, plinth. Books are bought and shelved in sets, so the spines are
// painted as runs — blocks of one binding with only a faint step between
// volumes — rather than as a stripe of unrelated colours.

/** Aged leather and cloth bindings: dulled, and all within a stop of each other. */
const BOOK_SHADES = [
  '#6e3b34',
  '#4c5a4a',
  '#3f4a5e',
  '#7a6238',
  '#5b4436',
  '#4d4152',
  '#6b6247',
] as const;
const BOOK_GILT = 'rgba(190,160,96,0.55)';
const BOOK_PAGES = '#b8ab8a';

const BOOKSHELF_SEED = 0x2c7b;
const BOOKSHELF_LEFT_FRACTION = 0.11;
const BOOKSHELF_RIGHT_FRACTION = 0.89;
/** Above its own tile: a case stands taller than the crawler beside it. */
const BOOKSHELF_TOP_FRACTION = -0.78;
const BOOKSHELF_BASE_FRACTION = 0.94;
const BOOKSHELF_CORNICE_OVERHANG_FRACTION = 0.035;
const BOOKSHELF_CORNICE_HEIGHT_FRACTION = 0.08;
const BOOKSHELF_PLINTH_HEIGHT_FRACTION = 0.06;
const BOOKSHELF_STILE_WIDTH_FRACTION = 0.075;
const BOOKSHELF_COMPARTMENT_COUNT = 4;
const BOOKSHELF_SHELF_BOARD_THICKNESS = 2.5;
const BOOKSHELF_CONTACT_SHADOW_SCALE = 0.95;
const BOOKSHELF_BROKEN_COMPARTMENT = 1;
/**
 * How far the snapped board sags at its middle, in pixels. Generous, because at
 * a 32 px tile the wear stage has one job — telling the player their swing
 * landed — and a board that dips by a pixel cannot do it.
 */
const BOOKSHELF_BROKEN_BOARD_SAG = 6;

const BOOK_HEADROOM = 2;
const BOOK_MIN_WIDTH = 2.6;
const BOOK_WIDTH_SPREAD = 1.8;
/** A set runs this many volumes before the next binding starts. */
const BOOK_RUN_MIN = 3;
const BOOK_RUN_SPREAD = 5;
/** Volumes in a set share a height band, so the run's top edge reads as one block. */
const BOOK_RUN_HEIGHT_MIN_FRACTION = 0.66;
const BOOK_RUN_HEIGHT_SPREAD_FRACTION = 0.3;
const BOOK_IN_RUN_HEIGHT_JITTER = 1.4;
/** The faint step in value between neighbouring volumes of one set. */
const BOOK_IN_RUN_VALUE_STEP = 0.07;
const BOOK_RUN_GAP_CHANCE = 0.12;
const BOOK_RUN_GAP_CHANCE_BROKEN = 0.6;
const BOOK_GAP_WIDTH_MIN = 2;
const BOOK_GAP_WIDTH_SPREAD = 4;
/** Chance a set ends in one volume leaning on the last. */
const BOOK_RUN_LEAN_CHANCE = 0.35;
const BOOK_LEAN = 0.24;
const BOOK_STACK_CHANCE = 0.16;
const BOOK_STACK_MIN_COUNT = 2;
const BOOK_STACK_COUNT_SPREAD = 2;
const BOOK_STACK_WIDTH_MIN = 8;
const BOOK_STACK_WIDTH_SPREAD = 4;
const BOOK_STACK_LAYER_HEIGHT = 2.6;
/** Only a few sets carry gilt bands, so the tooling reads as a feature, not a pattern. */
const BOOK_RUN_GILT_CHANCE = 0.3;
const BOOK_BAND_FRACTIONS = [0.16, 0.3] as const;
const BOOK_BAND_HEIGHT = 1;
/** The dark line down a spine's right edge that parts it from its neighbour. */
const BOOK_SEPARATOR_WIDTH = 0.6;
/** The lit strip down a run's left end and the shaded strip down its right, at most. */
const BOOK_RUN_EDGE_WIDTH = 2;
const BOOK_SEPARATOR_ALPHA = 0.45;
const BOOK_RUN_LIT_ALPHA = 0.18;
const BOOK_RUN_SHADE_ALPHA = 0.3;

function bookShade(rng: () => number): string {
  return pick(rng, BOOK_SHADES);
}

/** A single upright volume, standing on `baseY` and leaning about its foot. */
function drawBookSpine(
  ctx: Ctx,
  x: number,
  baseY: number,
  width: number,
  height: number,
  lean: number,
  shade: string,
  valueStep: number,
  gilt: boolean,
): void {
  ctx.save();
  ctx.translate(x + width / 2, baseY);
  ctx.rotate(lean);
  const halfW = width / 2;
  const top = -height;
  ctx.fillStyle = shade;
  ctx.fillRect(-halfW, top, width, height);
  if (valueStep !== 0) {
    ctx.fillStyle = valueStep > 0 ? `rgba(255,240,220,${valueStep})` : `rgba(0,0,0,${-valueStep})`;
    ctx.fillRect(-halfW, top, width, height);
  }
  ctx.fillStyle = BOOK_PAGES;
  ctx.fillRect(-halfW, top, width, 1);
  if (gilt) {
    ctx.fillStyle = BOOK_GILT;
    for (const fraction of BOOK_BAND_FRACTIONS) {
      ctx.fillRect(-halfW, top + height * fraction, width, BOOK_BAND_HEIGHT);
    }
  }
  // Only the right edge is darkened: neighbouring spines in a set touch, and a
  // full outline would cut the block back into stripes.
  ctx.globalAlpha = BOOK_SEPARATOR_ALPHA;
  ctx.fillStyle = CAVITY;
  ctx.fillRect(halfW - BOOK_SEPARATOR_WIDTH, top, BOOK_SEPARATOR_WIDTH, height);
  ctx.restore();
}

function drawBookStack(
  ctx: Ctx,
  x: number,
  baseY: number,
  width: number,
  count: number,
  rng: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const layerTop = baseY - (i + 1) * BOOK_STACK_LAYER_HEIGHT;
    const inset = rng() * 2;
    ctx.fillStyle = bookShade(rng);
    ctx.fillRect(x + inset, layerTop, width - inset, BOOK_STACK_LAYER_HEIGHT);
    ctx.fillStyle = BOOK_PAGES;
    ctx.fillRect(x + inset, layerTop, width - inset, 0.8);
    ctx.strokeStyle = CAVITY;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + inset, layerTop, width - inset, BOOK_STACK_LAYER_HEIGHT);
  }
}

/** Fills one compartment with sets of books, walking left to right. */
function drawBookRow(
  ctx: Ctx,
  x0: number,
  x1: number,
  baseY: number,
  compartmentHeight: number,
  rng: () => number,
  ransacked: boolean,
): void {
  const tallest = compartmentHeight - BOOK_HEADROOM;
  const gapChance = ransacked ? BOOK_RUN_GAP_CHANCE_BROKEN : BOOK_RUN_GAP_CHANCE;
  let x = x0 + 0.5;

  while (x < x1 - BOOK_MIN_WIDTH) {
    if (rng() < gapChance) {
      x += BOOK_GAP_WIDTH_MIN + rng() * BOOK_GAP_WIDTH_SPREAD;
      continue;
    }
    if (rng() < BOOK_STACK_CHANCE) {
      const stackWidth = BOOK_STACK_WIDTH_MIN + rng() * BOOK_STACK_WIDTH_SPREAD;
      if (x + stackWidth > x1 - 0.5) break;
      const count = BOOK_STACK_MIN_COUNT + Math.floor(rng() * BOOK_STACK_COUNT_SPREAD);
      drawBookStack(ctx, x, baseY, stackWidth, count, rng);
      x += stackWidth;
      continue;
    }
    const runLength = BOOK_RUN_MIN + Math.floor(rng() * BOOK_RUN_SPREAD);
    const shade = bookShade(rng);
    const runHeight =
      tallest * (BOOK_RUN_HEIGHT_MIN_FRACTION + rng() * BOOK_RUN_HEIGHT_SPREAD_FRACTION);
    const volumeWidth = BOOK_MIN_WIDTH + rng() * BOOK_WIDTH_SPREAD;
    const gilt = rng() < BOOK_RUN_GILT_CHANCE;
    const runStart = x;
    for (let i = 0; i < runLength && x + volumeWidth <= x1 - 0.5; i++) {
      const height = Math.min(tallest, runHeight + signedUnit(rng) * BOOK_IN_RUN_HEIGHT_JITTER);
      const valueStep = (i % 2 === 0 ? 1 : -1) * BOOK_IN_RUN_VALUE_STEP * rng();
      drawBookSpine(ctx, x, baseY, volumeWidth, height, 0, shade, valueStep, gilt);
      x += volumeWidth;
    }
    // The set reads as one block with the key light on its left and shade on its right.
    const runWidth = x - runStart;
    ctx.fillStyle = `rgba(255,240,220,${BOOK_RUN_LIT_ALPHA})`;
    const edgeWidth = Math.min(BOOK_RUN_EDGE_WIDTH, runWidth);
    ctx.fillRect(runStart, baseY - runHeight, edgeWidth, runHeight);
    ctx.fillStyle = `rgba(0,0,0,${BOOK_RUN_SHADE_ALPHA})`;
    ctx.fillRect(x - edgeWidth, baseY - runHeight, edgeWidth, runHeight);
    if (rng() < BOOK_RUN_LEAN_CHANCE && x + volumeWidth * 2 < x1) {
      drawBookSpine(
        ctx,
        x + 1,
        baseY,
        volumeWidth,
        runHeight * 0.92,
        BOOK_LEAN,
        bookShade(rng),
        0,
        false,
      );
      x += volumeWidth * 2;
    }
  }
}

function drawShelfBoard(
  ctx: Ctx,
  x0: number,
  x1: number,
  surfaceY: number,
  snapped: boolean,
): void {
  ctx.save();
  if (snapped) {
    const midX = (x0 + x1) / 2;
    const sagY = surfaceY + BOOKSHELF_BROKEN_BOARD_SAG;
    ctx.strokeStyle = WOOD_MID;
    ctx.lineWidth = BOOKSHELF_SHELF_BOARD_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(x0, surfaceY);
    ctx.lineTo(midX - 1, sagY);
    ctx.moveTo(midX + 2, sagY - 1);
    ctx.lineTo(x1, surfaceY);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = WOOD_MID;
  ctx.fillRect(x0, surfaceY, x1 - x0, BOOKSHELF_SHELF_BOARD_THICKNESS);
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(x0, surfaceY, x1 - x0, 1);
  ctx.fillStyle = WOOD_SHADOW;
  ctx.fillRect(x0, surfaceY + BOOKSHELF_SHELF_BOARD_THICKNESS - 1, x1 - x0, 1);
  ctx.restore();
}

function drawBookshelf(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  variant: number,
  seedTerm: number,
): void {
  const rng = mulberry32(BOOKSHELF_SEED + seedTerm);
  const booksRng = mulberry32(BOOKSHELF_SEED + variantSeed(variant) + seedTerm);
  const left = ox + ts * BOOKSHELF_LEFT_FRACTION;
  const right = ox + ts * BOOKSHELF_RIGHT_FRACTION;
  const top = oy + ts * BOOKSHELF_TOP_FRACTION;
  const base = oy + ts * BOOKSHELF_BASE_FRACTION;
  const corniceOverhang = ts * BOOKSHELF_CORNICE_OVERHANG_FRACTION;
  const corniceHeight = ts * BOOKSHELF_CORNICE_HEIGHT_FRACTION;
  const plinthHeight = ts * BOOKSHELF_PLINTH_HEIGHT_FRACTION;
  const stileWidth = ts * BOOKSHELF_STILE_WIDTH_FRACTION;

  contactShadow(ctx, (left + right) / 2, base + 1, ts, BOOKSHELF_CONTACT_SHADOW_SCALE);

  ctx.fillStyle = woodGradient(ctx, left, right, top);
  ctx.fillRect(left, top, right - left, base - top);

  const innerLeft = left + stileWidth;
  const innerRight = right - stileWidth;
  const innerTop = top + corniceHeight;
  const innerBottom = base - plinthHeight;

  const backGrad = ctx.createLinearGradient(innerLeft, innerTop, innerRight, innerBottom);
  backGrad.addColorStop(0, WOOD_SHADOW);
  backGrad.addColorStop(1, CAVITY);
  ctx.fillStyle = backGrad;
  ctx.fillRect(innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop);

  const compartmentHeight = (innerBottom - innerTop) / BOOKSHELF_COMPARTMENT_COUNT;
  for (let i = 0; i < BOOKSHELF_COMPARTMENT_COUNT; i++) {
    const boardY = innerTop + compartmentHeight * (i + 1);
    const snapped = damaged && i === BOOKSHELF_BROKEN_COMPARTMENT;
    drawBookRow(ctx, innerLeft, innerRight, boardY, compartmentHeight, booksRng, snapped);
    // The shelf above shades the top of each compartment.
    ctx.fillStyle = verticalRamp(ctx, innerLeft, boardY - compartmentHeight, boardY, [
      [0, 'rgba(0,0,0,0.35)'],
      [0.4, 'rgba(0,0,0,0)'],
    ]);
    ctx.fillRect(innerLeft, boardY - compartmentHeight, innerRight - innerLeft, compartmentHeight);
    drawShelfBoard(ctx, innerLeft, innerRight, boardY, snapped);
  }

  ctx.fillStyle = woodGradientV(ctx, left, top, base);
  ctx.fillRect(left, innerTop, stileWidth, innerBottom - innerTop);
  ctx.fillStyle = woodGradientV(ctx, innerRight, top, base);
  ctx.fillRect(innerRight, innerTop, stileWidth, innerBottom - innerTop);

  const corniceLeft = left - corniceOverhang;
  const corniceWidth = right - left + corniceOverhang * 2;
  ctx.fillStyle = woodGradient(ctx, corniceLeft, corniceLeft + corniceWidth, top);
  ctx.fillRect(corniceLeft, top, corniceWidth, corniceHeight);
  ctx.fillStyle = WOOD_RIM;
  ctx.fillRect(corniceLeft, top, corniceWidth, 1);
  ctx.fillStyle = WOOD_SHADOW;
  ctx.fillRect(corniceLeft, top + corniceHeight - 1, corniceWidth, 1);

  ctx.fillStyle = woodGradient(ctx, corniceLeft, corniceLeft + corniceWidth, innerBottom);
  ctx.fillRect(corniceLeft, innerBottom, corniceWidth, base - innerBottom);
  ctx.fillStyle = WOOD_SHADOW;
  ctx.fillRect(corniceLeft, base - 1, corniceWidth, 1);

  const leftGrainX = left + stileWidth * 0.55;
  const rightGrainX = innerRight + stileWidth * 0.45;
  seam(ctx, leftGrainX, innerTop, leftGrainX, innerBottom, 0.4);
  seam(ctx, rightGrainX, innerTop, rightGrainX, innerBottom, 0.4);

  if (damaged) {
    // Short and barely wobbling: at the width of a stile a wandering split
    // strays off the case and reads as a wire hanging beside it.
    crack(ctx, innerRight + stileWidth * 0.5, innerTop + 4, innerBottom - 6, 1.2, rng);
    chip(ctx, corniceLeft + 4, top + 1, 7, corniceHeight - 1);
    drawBookSpine(ctx, innerLeft + 3, innerBottom, 3.2, 7, -0.9, BOOK_SHADES[0], 0, false);
    drawBookStack(ctx, innerRight - 12, innerBottom, 9, 1, rng);
  }

  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(corniceLeft, top, corniceWidth, corniceHeight);
  ctx.strokeRect(left, top, right - left, base - top);
}

// ── Torch ─────────────────────────────────────────────────────────────────────
// A wrought-iron stand — three splayed feet, a straight shaft, a basket socket
// at the top — holding a short brand whose head is wrapped in pitch-soaked rag.
// The rag is what burns: when the torch is struck the wrap chars black and
// starts to come loose, and when it falls the head lies there charred and out.

const TORCH_SEED = 0x6b2d;

const TORCH_FOOT_BASE_FRACTION = 0.93;
const TORCH_FOOT_SPREAD = [-12, 0, 12] as const;
/** The front foot points at the viewer, so it lands lower than the outer two. */
const TORCH_FRONT_FOOT_DROP = 3;
const TORCH_FOOT_WIDTH = 3.2;
const TORCH_HUB_FRACTION = 0.72;
const TORCH_SHAFT_WIDTH = 4.4;
/** Where the socket basket sits above the tile's top edge, as a fraction of a tile. */
const TORCH_SOCKET_ABOVE_TILE_FRACTION = 0.02;
const TORCH_SOCKET_RX = 6.5;
const TORCH_SOCKET_RY = 2.4;
const TORCH_SOCKET_DEPTH = 7;
/** How far in each basket strip pinches at the socket's foot, as a fraction of its spread at the rim. */
const TORCH_SOCKET_FOOT_SPREAD_FRACTION = 0.35;
const TORCH_STICK_HALF_W = 2.2;
const TORCH_STICK_SHOWN = 5;
const TORCH_HEAD_HALF_W = 5.6;
const TORCH_HEAD_H = 15;
const TORCH_WRAP_BANDS = 4;
const TORCH_WRAP_SLANT = 3;
const TORCH_SHAFT_BEND_DAMAGED = 0.12;
/** The loose strip of charred wrap that hangs off a struck head. */
const TORCH_LOOSE_WRAP_LENGTH = 7;
const TORCH_CHAR_EMBER_COUNT = 4;
/** Each ember seam's half-length, and how far its right end climbs over its left. */
const TORCH_CHAR_EMBER_HALF_LENGTH = 1.5;
const TORCH_CHAR_EMBER_RISE = 1;
const TORCH_SHADOW_SCALE = 0.75;

const FLAME_BASE_H = 18;
const FLAME_H_FLICKER = 3.5;
const FLAME_HALF_W = 6.5;
const FLAME_SWAY = 2.2;
const FLAME_MID_SCALE = 0.66;
const FLAME_CORE_SCALE = 0.34;
const FLAME_DAMAGED_SCALE = 0.62;
const FLAME_MID_HEIGHT_FRACTION = 0.78;
const FLAME_CORE_HEIGHT_FRACTION = 0.5;
const FLAME_MID_SWAY_FRACTION = 0.7;
const FLAME_CORE_SWAY_FRACTION = 0.4;
const SMOKE_PUFF_COUNT = 3;
const SMOKE_PUFF_STRIDE = 5;
const SMOKE_PUFF_LIFT = 3;
const SMOKE_PUFF_SWAY = 4;
const SMOKE_PUFF_BASE_RADIUS = 3;
const SMOKE_PUFF_ALPHA_BASE = 0.2;
const SMOKE_PUFF_ALPHA_DECAY = 0.055;
const SMOKE_DAMAGED_MULTIPLIER = 1.8;
const TORCH_FLAME_SCALE = 1;

interface TorchGeometry {
  readonly cx: number;
  readonly footY: number;
  readonly hubY: number;
  readonly socketY: number;
  readonly headBottomY: number;
  readonly headTopY: number;
}

function torchGeometry(ox: number, oy: number, ts: number): TorchGeometry {
  const footY = oy + ts * TORCH_FOOT_BASE_FRACTION;
  const socketY = oy - ts * TORCH_SOCKET_ABOVE_TILE_FRACTION;
  const headBottomY = socketY - TORCH_STICK_SHOWN;
  return {
    cx: ox + ts / 2,
    footY,
    hubY: oy + ts * TORCH_HUB_FRACTION,
    socketY,
    headBottomY,
    headTopY: headBottomY - TORCH_HEAD_H,
  };
}

/** Three splayed iron feet meeting at a hub, and the straight shaft rising from it. */
function drawTorchStand(ctx: Ctx, g: TorchGeometry): void {
  TORCH_FOOT_SPREAD.forEach((dx) => {
    const isFront = dx === 0;
    const footY = g.footY + (isFront ? TORCH_FRONT_FOOT_DROP : 0);
    ironStrap(ctx, g.cx, g.hubY, g.cx + dx, footY, TORCH_FOOT_WIDTH);
    // A curled toe, the smith's finish on each foot.
    ctx.fillStyle = IRON_DARK;
    ctx.beginPath();
    ctx.ellipse(g.cx + dx, footY, 2.4, 1.3, 0, 0, TWO_PI);
    ctx.fill();
  });
  ctx.fillStyle = IRON_MID;
  ctx.beginPath();
  ctx.arc(g.cx, g.hubY, 2.6, 0, TWO_PI);
  ctx.fill();

  const shaftTop = g.socketY + TORCH_SOCKET_DEPTH;
  const shaftGrad = cylinderRamp(
    ctx,
    g.cx - TORCH_SHAFT_WIDTH / 2,
    g.cx + TORCH_SHAFT_WIDTH / 2,
    0,
    [
      [0, IRON_DARK],
      [0.35, IRON_LIGHT],
      [0.7, IRON_MID],
      [1, IRON_EDGE],
    ],
  );
  ctx.fillStyle = shaftGrad;
  ctx.fillRect(g.cx - TORCH_SHAFT_WIDTH / 2, shaftTop, TORCH_SHAFT_WIDTH, g.hubY - shaftTop);
  ctx.fillStyle = IRON_EDGE;
  ctx.fillRect(g.cx + TORCH_SHAFT_WIDTH / 2 - 0.6, shaftTop, 0.6, g.hubY - shaftTop);
}

/** The basket socket: an open cage of iron strips the brand sits in. */
function drawTorchSocket(ctx: Ctx, g: TorchGeometry): void {
  const bottomY = g.socketY + TORCH_SOCKET_DEPTH;
  ctx.save();
  ctx.strokeStyle = IRON_MID;
  ctx.lineWidth = 1.4;
  for (const dx of [-TORCH_SOCKET_RX, -TORCH_SOCKET_RX / 3, TORCH_SOCKET_RX / 3, TORCH_SOCKET_RX]) {
    ctx.beginPath();
    ctx.moveTo(g.cx + dx, g.socketY);
    ctx.lineTo(g.cx + dx * TORCH_SOCKET_FOOT_SPREAD_FRACTION, bottomY);
    ctx.stroke();
  }
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.socketY, TORCH_SOCKET_RX, TORCH_SOCKET_RY, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.socketY - 0.6, TORCH_SOCKET_RX, TORCH_SOCKET_RY, 0, 0.3, Math.PI - 0.3);
  ctx.stroke();
  ctx.restore();
}

/**
 * The brand: a short stick rising out of the socket into a rag head. `charred`
 * blackens the wrap, opens glowing seams in it and lets one strip hang loose.
 */
function drawTorchHead(ctx: Ctx, g: TorchGeometry, charred: boolean, rng: () => number): void {
  const { cx, headBottomY, headTopY } = g;
  ctx.fillStyle = woodGradient(ctx, cx - TORCH_STICK_HALF_W, cx + TORCH_STICK_HALF_W, 0);
  ctx.fillRect(
    cx - TORCH_STICK_HALF_W,
    headBottomY - 1,
    TORCH_STICK_HALF_W * 2,
    g.socketY - headBottomY + 3,
  );

  // The wrapped head swells a little toward its middle, like rag bound round a stick.
  const headPath = () => {
    ctx.beginPath();
    ctx.moveTo(cx - TORCH_HEAD_HALF_W + 1, headBottomY);
    ctx.quadraticCurveTo(
      cx - TORCH_HEAD_HALF_W - 1,
      (headBottomY + headTopY) / 2,
      cx - TORCH_HEAD_HALF_W + 1.5,
      headTopY,
    );
    ctx.lineTo(cx + TORCH_HEAD_HALF_W - 1.5, headTopY);
    ctx.quadraticCurveTo(
      cx + TORCH_HEAD_HALF_W + 1,
      (headBottomY + headTopY) / 2,
      cx + TORCH_HEAD_HALF_W - 1,
      headBottomY,
    );
    ctx.closePath();
  };
  headPath();
  ctx.save();
  ctx.fillStyle = cylinderRamp(ctx, cx - TORCH_HEAD_HALF_W, cx + TORCH_HEAD_HALF_W, 0, [
    [0, charred ? CHAR_BLACK : PITCH_DARK],
    [0.3, charred ? CHAR_GREY : PITCH_SHEEN],
    [0.55, charred ? CHAR_BLACK : PITCH_MID],
    [1, CHAR_BLACK],
  ]);
  ctx.fill();
  ctx.clip();
  // The wrap's bands, slanting the way rag is wound.
  const bandStep = TORCH_HEAD_H / TORCH_WRAP_BANDS;
  for (let i = 1; i < TORCH_WRAP_BANDS; i++) {
    const y = headBottomY - i * bandStep;
    seam(
      ctx,
      cx - TORCH_HEAD_HALF_W - 1,
      y + TORCH_WRAP_SLANT / 2,
      cx + TORCH_HEAD_HALF_W + 1,
      y - TORCH_WRAP_SLANT / 2,
      0.9,
      CHAR_BLACK,
    );
    if (!charred) {
      // The glossy lip of pitch on each band's upper edge.
      seam(ctx, cx - TORCH_HEAD_HALF_W, y + TORCH_WRAP_SLANT / 2 - 1, cx, y - 1, 0.55, PITCH_SHEEN);
    }
  }
  if (charred) {
    // Seams of live ember where the char has split: the head's own glow, the only bright part.
    ctx.strokeStyle = FLAME_OUTER;
    ctx.lineWidth = 0.9;
    for (let i = 0; i < TORCH_CHAR_EMBER_COUNT; i++) {
      const y = lerp(headTopY + 2, headBottomY - 2, rng());
      const x = cx + signedUnit(rng) * (TORCH_HEAD_HALF_W - 1.5);
      ctx.beginPath();
      ctx.moveTo(x - TORCH_CHAR_EMBER_HALF_LENGTH, y);
      ctx.lineTo(x + TORCH_CHAR_EMBER_HALF_LENGTH, y - TORCH_CHAR_EMBER_RISE);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (charred) {
    // One strip of burnt rag come unwound, hanging off the head's shaded side.
    ctx.save();
    ctx.strokeStyle = CHAR_GREY;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + TORCH_HEAD_HALF_W - 1, headBottomY - 3);
    ctx.quadraticCurveTo(
      cx + TORCH_HEAD_HALF_W + 3,
      headBottomY,
      cx + TORCH_HEAD_HALF_W + 2,
      headBottomY + TORCH_LOOSE_WRAP_LENGTH,
    );
    ctx.stroke();
    ctx.restore();
  }
}

function flamePath(
  ctx: Ctx,
  x: number,
  baseY: number,
  halfW: number,
  height: number,
  sway: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - halfW, baseY);
  ctx.bezierCurveTo(
    x - halfW,
    baseY - height * 0.45,
    x + sway - halfW * 0.5,
    baseY - height * 0.78,
    x + sway,
    baseY - height,
  );
  ctx.bezierCurveTo(
    x + sway + halfW * 0.5,
    baseY - height * 0.78,
    x + halfW,
    baseY - height * 0.45,
    x + halfW,
    baseY,
  );
  ctx.closePath();
}

/**
 * The fire itself, rising from `baseY` at `cx`: three nested teardrops and a
 * column of smoke off the tip. No glow is painted round it — the light a flame
 * throws is drawn by the lighting pass, which knows where the walls are.
 *
 * @param sizeScale Multiplies every dimension, so a brazier's bed of coals burns
 *   visibly bigger than a single brand.
 */
export function drawFlame(
  ctx: Ctx,
  cx: number,
  baseY: number,
  phase: number,
  damaged: boolean,
  sizeScale: number,
): void {
  const wave = Math.sin(phase * TWO_PI);
  const scale = (damaged ? FLAME_DAMAGED_SCALE : 1) * sizeScale;
  const height = (FLAME_BASE_H + wave * FLAME_H_FLICKER) * scale;
  const halfW = FLAME_HALF_W * scale;
  const sway = Math.sin(phase * TWO_PI * 2) * FLAME_SWAY;
  const tipY = baseY - height;

  ctx.save();
  flamePath(ctx, cx, baseY, halfW, height, sway);
  const outerGrad = ctx.createLinearGradient(cx, baseY, cx, tipY);
  outerGrad.addColorStop(0, FLAME_MID);
  outerGrad.addColorStop(0.55, FLAME_OUTER);
  outerGrad.addColorStop(1, FLAME_OUTER);
  ctx.fillStyle = outerGrad;
  ctx.fill();

  flamePath(
    ctx,
    cx,
    baseY,
    halfW * FLAME_MID_SCALE,
    height * FLAME_MID_HEIGHT_FRACTION,
    sway * FLAME_MID_SWAY_FRACTION,
  );
  const midGrad = ctx.createLinearGradient(cx, baseY, cx, tipY);
  midGrad.addColorStop(0, FLAME_HOT);
  midGrad.addColorStop(1, FLAME_MID);
  ctx.fillStyle = midGrad;
  ctx.fill();

  flamePath(
    ctx,
    cx,
    baseY,
    halfW * FLAME_CORE_SCALE,
    height * FLAME_CORE_HEIGHT_FRACTION,
    sway * FLAME_CORE_SWAY_FRACTION,
  );
  ctx.fillStyle = FLAME_CORE;
  ctx.fill();
  ctx.restore();

  const smokeAlphaScale = damaged ? SMOKE_DAMAGED_MULTIPLIER : 1;
  for (let i = 0; i < SMOKE_PUFF_COUNT; i++) {
    const drift = Math.sin(phase * TWO_PI + i) * SMOKE_PUFF_SWAY;
    puff(
      ctx,
      cx + sway + drift,
      tipY - SMOKE_PUFF_LIFT - i * SMOKE_PUFF_STRIDE,
      (SMOKE_PUFF_BASE_RADIUS + i) * sizeScale,
      Math.max(0, (SMOKE_PUFF_ALPHA_BASE - i * SMOKE_PUFF_ALPHA_DECAY) * smokeAlphaScale),
      SMOKE_RGB,
    );
  }
}

function drawTorch(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  frame: number,
  seedTerm: number,
): void {
  const rng = mulberry32(TORCH_SEED + seedTerm);
  const g = torchGeometry(ox, oy, ts);
  contactShadow(ctx, g.cx, g.footY + 2, ts, TORCH_SHADOW_SCALE);
  drawTorchStand(ctx, g);
  const paintTop = () => {
    drawTorchSocket(ctx, g);
    drawTorchHead(ctx, g, damaged, rng);
    drawFlame(ctx, g.cx, g.headTopY + 2, frame / FLAME_FRAMES, damaged, TORCH_FLAME_SCALE);
  };
  // A struck stand bends at the hub, carrying the head over with it.
  if (damaged) withRotation(ctx, g.cx, g.hubY, TORCH_SHAFT_BEND_DAMAGED, paintTop);
  else paintTop();
}

// ── Brazier ───────────────────────────────────────────────────────────────────
// A wide iron fire-bowl on three splayed legs. No wood in it, so a felled one
// throws bent iron and scattered coals.

const BRAZIER_SEED = 0x3f81;
const BRAZIER_FOOT_BASE_FRACTION = 0.94;
const BRAZIER_RIM_FRACTION = 0.42;
const BRAZIER_BOWL_RIM_RX = 19;
const BRAZIER_BOWL_RIM_RY = 6.5;
const BRAZIER_BOWL_DEPTH = 12;
const BRAZIER_BOWL_BASE_HALF_W = 8.5;
const BRAZIER_LEG_COUNT = 3;
const BRAZIER_LEG_FOOT_OFFSETS = [-15, 0, 15] as const;
const BRAZIER_LEG_TOP_OFFSETS = [-6.5, 0, 6.5] as const;
const BRAZIER_LEG_WIDTH = 3.4;
const BRAZIER_CENTER_LEG_FOOT_DROP = 3;
const BRAZIER_FOOT_PAD_RX = 4;
const BRAZIER_FOOT_PAD_RY = 1.8;
const BRAZIER_COLLAR_RX = 10;
const BRAZIER_COLLAR_RY = 3;
const BRAZIER_COAL_COUNT = 9;
const BRAZIER_COAL_RADIUS = 2.1;
const BRAZIER_COAL_SPREAD_FRACTION = 0.72;
const BRAZIER_DAMAGED_BOWL_TILT = 0.11;
const BRAZIER_BUCKLED_LEG_TILT = 0.28;
const BRAZIER_BUCKLED_LEG_INDEX = 0;
const BRAZIER_FLAME_SCALE = 1.9;
const BRAZIER_RIVET_COUNT = 5;
const BRAZIER_SHADOW_SCALE = 0.95;
const COAL_ALPHA_MIN = 0.6;
const COAL_ALPHA_SPREAD = 0.4;
const COAL_HOT_CHANCE = 0.4;
const COAL_RADIUS_MIN_FRACTION = 0.6;
const COAL_RADIUS_SPREAD_FRACTION = 0.6;

interface BrazierGeometry {
  readonly cx: number;
  readonly footY: number;
  readonly rimY: number;
  readonly bowlBottomY: number;
}

function brazierGeometry(ox: number, oy: number, ts: number): BrazierGeometry {
  const rimY = oy + ts * BRAZIER_RIM_FRACTION;
  return {
    cx: ox + ts / 2,
    footY: oy + ts * BRAZIER_FOOT_BASE_FRACTION,
    rimY,
    bowlBottomY: rimY + BRAZIER_BOWL_DEPTH,
  };
}

function drawBrazierLegs(ctx: Ctx, g: BrazierGeometry, damaged: boolean): void {
  const { cx, footY, bowlBottomY } = g;
  for (let i = 0; i < BRAZIER_LEG_COUNT; i++) {
    const footOffset = BRAZIER_LEG_FOOT_OFFSETS[i] ?? 0;
    const topOffset = BRAZIER_LEG_TOP_OFFSETS[i] ?? 0;
    const isCenterLeg = footOffset === 0;
    const legFootY = footY + (isCenterLeg ? BRAZIER_CENTER_LEG_FOOT_DROP : 0);
    const footX = cx + footOffset;
    const topX = cx + topOffset;
    const paintLeg = () => {
      ironStrap(ctx, topX, bowlBottomY, footX, legFootY, BRAZIER_LEG_WIDTH);
      ctx.fillStyle = IRON_DARK;
      ctx.beginPath();
      ctx.ellipse(footX, legFootY, BRAZIER_FOOT_PAD_RX, BRAZIER_FOOT_PAD_RY, 0, 0, TWO_PI);
      ctx.fill();
    };
    if (damaged && i === BRAZIER_BUCKLED_LEG_INDEX) {
      withRotation(ctx, topX, bowlBottomY, BRAZIER_BUCKLED_LEG_TILT, paintLeg);
    } else {
      paintLeg();
    }
  }
  ctx.save();
  ctx.fillStyle = cylinderRamp(ctx, cx - BRAZIER_COLLAR_RX, cx + BRAZIER_COLLAR_RX, 0, [
    [0, IRON_MID],
    [0.35, IRON_LIGHT],
    [1, IRON_DARK],
  ]);
  ctx.beginPath();
  ctx.ellipse(cx, bowlBottomY, BRAZIER_COLLAR_RX, BRAZIER_COLLAR_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawCoalBed(
  ctx: Ctx,
  cx: number,
  rimY: number,
  spread: number,
  rimRy: number,
  count: number,
  radius: number,
  rng: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    ctx.globalAlpha = COAL_ALPHA_MIN + rng() * COAL_ALPHA_SPREAD;
    ctx.fillStyle = rng() < COAL_HOT_CHANCE ? FLAME_HOT : FLAME_OUTER;
    ctx.beginPath();
    ctx.arc(
      lerp(cx - spread, cx + spread, t),
      rimY + (rng() - 0.5) * rimRy,
      radius * (COAL_RADIUS_MIN_FRACTION + rng() * COAL_RADIUS_SPREAD_FRACTION),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBrazierBowl(ctx: Ctx, g: BrazierGeometry, rng: () => number, damaged: boolean): void {
  const { cx, rimY, bowlBottomY } = g;
  const paintBowl = () => {
    ctx.beginPath();
    ctx.moveTo(cx - BRAZIER_BOWL_RIM_RX, rimY);
    ctx.lineTo(cx - BRAZIER_BOWL_BASE_HALF_W, bowlBottomY);
    ctx.lineTo(cx + BRAZIER_BOWL_BASE_HALF_W, bowlBottomY);
    ctx.lineTo(cx + BRAZIER_BOWL_RIM_RX, rimY);
    ctx.closePath();
    ctx.fillStyle = cylinderRamp(ctx, cx - BRAZIER_BOWL_RIM_RX, cx + BRAZIER_BOWL_RIM_RX, 0, [
      [0, IRON_DARK],
      [0.3, IRON_LIGHT],
      [0.6, IRON_MID],
      [1, IRON_DARK],
    ]);
    ctx.fill();
    ctx.strokeStyle = IRON_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    // A row of rivets where the bowl's plates were joined, each catching the key light.
    for (let i = 0; i < BRAZIER_RIVET_COUNT; i++) {
      const t = (i + 0.5) / BRAZIER_RIVET_COUNT;
      const rivetY = rimY + BRAZIER_BOWL_DEPTH * 0.45;
      const halfAtRivet = lerp(BRAZIER_BOWL_RIM_RX, BRAZIER_BOWL_BASE_HALF_W, 0.45);
      nailHead(ctx, lerp(cx - halfAtRivet + 2, cx + halfAtRivet - 2, t), rivetY);
    }

    ctx.beginPath();
    ctx.ellipse(cx, rimY, BRAZIER_BOWL_RIM_RX, BRAZIER_BOWL_RIM_RY, 0, 0, TWO_PI);
    ctx.fillStyle = SOOT;
    ctx.fill();
    ctx.strokeStyle = IRON_SPEC;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, rimY, BRAZIER_BOWL_RIM_RX, BRAZIER_BOWL_RIM_RY, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    drawCoalBed(
      ctx,
      cx,
      rimY,
      BRAZIER_BOWL_RIM_RX * BRAZIER_COAL_SPREAD_FRACTION,
      BRAZIER_BOWL_RIM_RY,
      BRAZIER_COAL_COUNT,
      BRAZIER_COAL_RADIUS,
      rng,
    );
  };
  if (damaged) withRotation(ctx, cx, rimY, BRAZIER_DAMAGED_BOWL_TILT, paintBowl);
  else {
    ctx.save();
    paintBowl();
    ctx.restore();
  }

  if (damaged) {
    crack(ctx, cx + 4, rimY + 3, bowlBottomY - 1, 2.5, rng);
    ctx.save();
    ctx.fillStyle = SOOT;
    ctx.beginPath();
    ctx.moveTo(cx - BRAZIER_BOWL_RIM_RX + 4, rimY - 2);
    ctx.lineTo(cx - BRAZIER_BOWL_RIM_RX - 1, rimY + 1);
    ctx.lineTo(cx - BRAZIER_BOWL_RIM_RX + 3, rimY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawBrazier(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  frame: number,
  seedTerm: number,
): void {
  const rng = mulberry32(BRAZIER_SEED + seedTerm);
  const g = brazierGeometry(ox, oy, ts);
  contactShadow(ctx, g.cx, g.footY + 2, ts, BRAZIER_SHADOW_SCALE);
  drawBrazierLegs(ctx, g, damaged);
  drawBrazierBowl(ctx, g, rng, damaged);
  drawFlame(ctx, g.cx, g.rimY - 1, frame / BRAZIER_FLAME_FRAMES, damaged, BRAZIER_FLAME_SCALE);
}

// ── Shatter ───────────────────────────────────────────────────────────────────

const BURST_CENTER_Y_FRACTION = 0.5;
/**
 * The torch bursts from halfway up its shaft rather than the tile centre, so the
 * stand reads as snapping along its length instead of the floor erupting.
 */
const TORCH_BURST_CENTER_Y_FRACTION = 0.34;
/** The brazier's mass is its bowl, which rides a little above the tile centre. */
const BRAZIER_BURST_CENTER_Y_FRACTION = 0.44;

/** A bookshelf's mass is the middle of a case that stands most of a tile above its own. */
const BOOKSHELF_BURST_CENTER_Y_FRACTION = 0.1;

function burstCenterYFraction(kind: PropKind): number {
  if (kind === 'torch') return TORCH_BURST_CENTER_Y_FRACTION;
  if (kind === 'bookshelf') return BOOKSHELF_BURST_CENTER_Y_FRACTION;
  if (kind === 'brazier') return BRAZIER_BURST_CENTER_Y_FRACTION;
  return BURST_CENTER_Y_FRACTION;
}

const BOX_DEBRIS_COUNT = 16;
const BOX_DEBRIS_SPREAD_PX = 34;
const BOX_DEBRIS_IRON_PERIOD = 5;
const PLANK_LENGTH_MIN = 7;
const PLANK_LENGTH_SPREAD = 9;
const PLANK_WIDTH_MIN = 2.5;
const PLANK_WIDTH_SPREAD = 3;

function boxDebris(seed: number, curlPeriod: number): DebrisPiece[] {
  return radialDebris(seed, {
    count: BOX_DEBRIS_COUNT,
    spreadPx: BOX_DEBRIS_SPREAD_PX,
    shades: [...WOOD_RAMP],
    edge: WOOD_EDGE,
    curlPeriod,
    curlShade: IRON_MID,
    lengthMin: PLANK_LENGTH_MIN,
    lengthSpread: PLANK_LENGTH_SPREAD,
    widthMin: PLANK_WIDTH_MIN,
    widthSpread: PLANK_WIDTH_SPREAD,
  });
}

// A torch's pieces come off all the way up the stand and are flung sideways
// off it, so they stay a tall narrow column rather than a radial ring.
const TORCH_DEBRIS_COUNT = 18;
const TORCH_DEBRIS_ORIGIN_SPAN_TILES = 1.05;
const TORCH_DEBRIS_SPREAD_PX = 15;
const TORCH_DEBRIS_CONE_HALF_ANGLE = Math.PI / 3;
/** Most of a torch is iron now; one piece in three is a scrap of the brand or its rag. */
const TORCH_DEBRIS_WOOD_PERIOD = 3;
const TORCH_IRON_LENGTH_MIN = 9;
const TORCH_IRON_LENGTH_SPREAD = 9;
const TORCH_IRON_WIDTH = 2;
const TORCH_SPLINTER_LENGTH_MIN = 5;
const TORCH_SPLINTER_LENGTH_SPREAD = 5;
const TORCH_SPLINTER_WIDTH_MIN = 1.7;
const TORCH_SPLINTER_WIDTH_SPREAD = 1.6;
const TORCH_SPLINTER_TILT = 0.5;
const TORCH_SPLINTER_SPIN_MAX = 4;
const TORCH_DEBRIS_DISTANCE_MIN_FRACTION = 0.4;
const TORCH_DEBRIS_DISTANCE_SPREAD_FRACTION = 0.9;
const QUARTER_TURN = Math.PI / 2;

function buildTorchDebris(seed: number): DebrisPiece[] {
  const rng = mulberry32(seed);
  const out: DebrisPiece[] = [];
  for (let i = 0; i < TORCH_DEBRIS_COUNT; i++) {
    const isBrand = i % TORCH_DEBRIS_WOOD_PERIOD === TORCH_DEBRIS_WOOD_PERIOD - 1;
    const thrownLeft = i % 2 === 0;
    const offHorizontal = signedUnit(rng) * TORCH_DEBRIS_CONE_HALF_ANGLE;
    // Origins walk the stand in order, jittered inside their own slot, so the
    // column stays evenly populated instead of clumping.
    const alongPole = (i + rng()) / TORCH_DEBRIS_COUNT - 0.5;
    out.push({
      angle: (thrownLeft ? Math.PI : 0) + offHorizontal,
      distance:
        TORCH_DEBRIS_SPREAD_PX *
        (TORCH_DEBRIS_DISTANCE_MIN_FRACTION + rng() * TORCH_DEBRIS_DISTANCE_SPREAD_FRACTION),
      originY: alongPole * TORCH_DEBRIS_ORIGIN_SPAN_TILES,
      restAngle: QUARTER_TURN + signedUnit(rng) * TORCH_SPLINTER_TILT,
      length: isBrand
        ? TORCH_SPLINTER_LENGTH_MIN + rng() * TORCH_SPLINTER_LENGTH_SPREAD
        : TORCH_IRON_LENGTH_MIN + rng() * TORCH_IRON_LENGTH_SPREAD,
      width: isBrand
        ? TORCH_SPLINTER_WIDTH_MIN + rng() * TORCH_SPLINTER_WIDTH_SPREAD
        : TORCH_IRON_WIDTH,
      spin: signedUnit(rng) * (TORCH_SPLINTER_SPIN_MAX / 2),
      shade: isBrand ? pick(rng, [PITCH_MID, WOOD_DARK, CHAR_GREY]) : pick(rng, [...IRON_RAMP]),
      edge: isBrand ? WOOD_EDGE : IRON_EDGE,
      form: 'shard',
    });
  }
  return out;
}

// A brazier has no wood in it: bent iron thrown in a flat ring the width of the
// bowl, with the coal bed scattering out ahead of it.
const BRAZIER_DEBRIS_COUNT = 17;
const BRAZIER_DEBRIS_SPREAD_PX = 28;
const BRAZIER_DEBRIS_COAL_PERIOD = 3;
const BRAZIER_IRON_LENGTH_MIN = 8;
const BRAZIER_IRON_LENGTH_SPREAD = 7;
const BRAZIER_IRON_WIDTH = 2.5;
const BRAZIER_COAL_LENGTH_MIN = 3;
const BRAZIER_COAL_LENGTH_SPREAD = 3.5;
const BRAZIER_COAL_WIDTH_MIN = 2.2;
const BRAZIER_COAL_WIDTH_SPREAD = 1.6;
const BRAZIER_DEBRIS_SPIN_MAX = 6;
const BRAZIER_ANGLE_JITTER = 0.5;
const COAL_RAMP = [FLAME_OUTER, FLAME_MID, FLAME_HOT, SOOT] as const;

function buildBrazierDebris(seed: number): DebrisPiece[] {
  const rng = mulberry32(seed);
  const out: DebrisPiece[] = [];
  for (let i = 0; i < BRAZIER_DEBRIS_COUNT; i++) {
    const isCoal = i % BRAZIER_DEBRIS_COAL_PERIOD === 0;
    out.push({
      angle: (i / BRAZIER_DEBRIS_COUNT) * TWO_PI + rng() * BRAZIER_ANGLE_JITTER,
      distance: BRAZIER_DEBRIS_SPREAD_PX * (isCoal ? 0.6 + rng() * 0.9 : 0.4 + rng() * 0.7),
      originY: 0,
      restAngle: rng() * Math.PI,
      length: isCoal
        ? BRAZIER_COAL_LENGTH_MIN + rng() * BRAZIER_COAL_LENGTH_SPREAD
        : BRAZIER_IRON_LENGTH_MIN + rng() * BRAZIER_IRON_LENGTH_SPREAD,
      width: isCoal
        ? BRAZIER_COAL_WIDTH_MIN + rng() * BRAZIER_COAL_WIDTH_SPREAD
        : BRAZIER_IRON_WIDTH,
      spin: signedUnit(rng) * (BRAZIER_DEBRIS_SPIN_MAX / 2),
      shade: isCoal ? pick(rng, [...COAL_RAMP]) : IRON_MID,
      edge: SOOT,
      form: isCoal ? 'shard' : 'curl',
    });
  }
  return out;
}

// A case coming apart throws its contents as well as itself.
const BOOKSHELF_DEBRIS_BOOK_PERIOD = 3;
const BOOK_DEBRIS_LENGTH_MIN = 6;
const BOOK_DEBRIS_LENGTH_SPREAD = 4;
const BOOK_DEBRIS_WIDTH_MIN = 4;
const BOOK_DEBRIS_WIDTH_SPREAD = 2;

function buildBookshelfDebris(seed: number): DebrisPiece[] {
  const rng = mulberry32(seed);
  return boxDebris(seed, 0).map((piece, i) => {
    const isBook = i % BOOKSHELF_DEBRIS_BOOK_PERIOD === BOOKSHELF_DEBRIS_BOOK_PERIOD - 1;
    if (!isBook) return piece;
    return {
      ...piece,
      length: BOOK_DEBRIS_LENGTH_MIN + rng() * BOOK_DEBRIS_LENGTH_SPREAD,
      width: BOOK_DEBRIS_WIDTH_MIN + rng() * BOOK_DEBRIS_WIDTH_SPREAD,
      shade: bookShade(rng),
      edge: CAVITY,
    };
  });
}

/**
 * Fixed seeds for each kind's burst, one literal per kind. Never derive these
 * from an index or the kind's name: two kinds landing on the same seed would
 * throw the same pieces to the same places.
 */
const DEBRIS_SEEDS: Readonly<Record<PropKind, number>> = {
  barrel: 0x1177,
  barrel_side: 0x2288,
  crate: 0x3399,
  torch: 0x44aa,
  brazier: 0x55bb,
  bookshelf: 0x66cc,
};

function debrisFor(kind: PropKind, seedTerm: number): DebrisPiece[] {
  const seed = DEBRIS_SEEDS[kind] + seedTerm;
  if (kind === 'torch') return buildTorchDebris(seed);
  if (kind === 'brazier') return buildBrazierDebris(seed);
  if (kind === 'bookshelf') return buildBookshelfDebris(seed);
  return boxDebris(seed, BOX_DEBRIS_IRON_PERIOD);
}

const TORCH_CLOUD_PUFF_COUNT = 3;
const TORCH_CLOUD_RADIUS_SCALE = 0.55;
const BRAZIER_SMOKE_CORE_RADIUS_SCALE = 0.62;

/**
 * The cloud the pieces come out of: sawdust for a box, a column of ash up the
 * stand for a torch, and ash and smoke off a brazier's spilled fire bed. None
 * of it glows — the flash of a break is not light the lighting pass knows of.
 */
function cloudFor(kind: PropKind, ts: number): BurstCloud {
  if (kind === 'brazier') {
    return (ctx, cx, cy, radius, alpha) => {
      puff(ctx, cx, cy, radius, alpha, ASH_RGB);
      puff(ctx, cx, cy, radius * BRAZIER_SMOKE_CORE_RADIUS_SCALE, alpha, SMOKE_RGB);
    };
  }
  if (kind === 'torch') {
    return (ctx, cx, cy, radius, alpha) => {
      const columnRadius = radius * TORCH_CLOUD_RADIUS_SCALE;
      const columnHeight = ts * TORCH_DEBRIS_ORIGIN_SPAN_TILES;
      for (let i = 0; i < TORCH_CLOUD_PUFF_COUNT; i++) {
        const alongPole = i / (TORCH_CLOUD_PUFF_COUNT - 1) - 0.5;
        puff(ctx, cx, cy + alongPole * columnHeight, columnRadius, alpha, ASH_RGB);
      }
    };
  }
  return (ctx, cx, cy, radius, alpha) => puff(ctx, cx, cy, radius, alpha, DUST_RGB);
}

function drawShatterFrame(
  ctx: Ctx,
  kind: PropKind,
  ox: number,
  oy: number,
  ts: number,
  progress: number,
  seedTerm: number,
): void {
  // The tile's centre, not the silhouette's: the burst stays anchored to the tile the prop stood on.
  const cx = ox + ts / 2;
  const cy = oy + ts * burstCenterYFraction(kind);
  drawDebrisBurst(ctx, debrisFor(kind, seedTerm), cloudFor(kind, ts), cx, cy, ts, progress);
}

// ── Remains ───────────────────────────────────────────────────────────────────
// Flat wreckage with no vertical volume, so the tile still reads as walkable.
// Remains stay for the whole floor, so nothing in them glows: a spilled fire
// bed has gone out by the time it is wreckage.

/** The wood ramp minus its darkest value, which is the props' outline colour. */
const REMAINS_WOOD_SHADES = [WOOD_DARK, WOOD_MID, WOOD_LIGHT] as const;
const REMAINS_PLANK_SIZE = { lengthMin: 10, lengthSpread: 12, widthMin: 2.5, widthSpread: 2.5 };
const REMAINS_PLANK_COUNT = 9;
const BRAZIER_REMAINS_PIECE_COUNT = 6;
const BOOKSHELF_REMAINS_PLANK_COUNT = 11;
const TORCH_REMAINS_SPLINTER_COUNT = 3;
const REMAINS_CENTER_Y_FRACTION = 0.6;
const REMAINS_SPECKLE_SPREAD_TILE_FRACTION = 0.34;

/** Fixed seeds for the field of pieces each kind settles into, one literal per kind. */
const PLANK_SEEDS: Readonly<Record<PropKind, number>> = {
  barrel: 0x4411,
  barrel_side: 0x5522,
  crate: 0x6633,
  torch: 0x7755,
  brazier: 0x8866,
  bookshelf: 0x9977,
};
/** Fixed seeds for the scorch, dusting and spilled books drawn round those pieces. */
const REMAINS_SEEDS: Readonly<Record<PropKind, number>> = {
  barrel: 0x774a,
  barrel_side: 0x774f,
  crate: 0x7749,
  torch: 0x7758,
  brazier: 0x774b,
  bookshelf: 0x7751,
};

const SPILLED_BOOK_COUNT = 6;
const SPILLED_BOOK_SPREAD_X = 17;
const SPILLED_BOOK_SPREAD_Y = 8;
const SPILLED_BOOK_LENGTH_MIN = 7;
const SPILLED_BOOK_LENGTH_SPREAD = 5;
const SPILLED_BOOK_WIDTH_MIN = 4.5;
const SPILLED_BOOK_WIDTH_SPREAD = 2;

function drawSpilledBooks(ctx: Ctx, cx: number, cy: number, rng: () => number): void {
  for (let i = 0; i < SPILLED_BOOK_COUNT; i++) {
    const x = cx + signedUnit(rng) * SPILLED_BOOK_SPREAD_X;
    const y = cy + signedUnit(rng) * SPILLED_BOOK_SPREAD_Y;
    const length = SPILLED_BOOK_LENGTH_MIN + rng() * SPILLED_BOOK_LENGTH_SPREAD;
    const width = SPILLED_BOOK_WIDTH_MIN + rng() * SPILLED_BOOK_WIDTH_SPREAD;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * TWO_PI);
    ctx.fillStyle = bookShade(rng);
    ctx.fillRect(-length / 2, -width / 2, length, width);
    ctx.fillStyle = BOOK_PAGES;
    ctx.fillRect(-length / 2, -width / 2, length, 1);
    ctx.strokeStyle = CAVITY;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(-length / 2, -width / 2, length, width);
    ctx.restore();
  }
}

const SCORCH_RX_TILE_FRACTION = 0.3;
const SCORCH_RY_TILE_FRACTION = 0.15;
const SCORCH_ALPHA = 0.5;
const DEAD_COAL_COUNT = 9;
const DEAD_COAL_SPREAD_TILE_FRACTION = 0.26;
const DEAD_COAL_MAX_RADIUS = 1.6;
const DEAD_COAL_MIN_RADIUS = 0.7;

/** Soot where a fire bowl tipped out, and the coals it spilled — gone dead and grey. */
function drawScorch(ctx: Ctx, cx: number, cy: number, ts: number, rng: () => number): void {
  stainWash(
    ctx,
    cx,
    cy,
    ts * SCORCH_RX_TILE_FRACTION,
    ts * SCORCH_RY_TILE_FRACTION,
    `rgba(36,26,20,${SCORCH_ALPHA})`,
  );
  for (let i = 0; i < DEAD_COAL_COUNT; i++) {
    const angle = rng() * TWO_PI;
    const reach = Math.sqrt(rng()) * ts * DEAD_COAL_SPREAD_TILE_FRACTION;
    ctx.fillStyle = rng() < 0.5 ? DEAD_COAL : DEAD_COAL_GREY;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach * 0.5,
      DEAD_COAL_MIN_RADIUS + rng() * DEAD_COAL_MAX_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** The bent hoop or crushed fire bowl a prop leaves behind. A bookshelf is all wood. */
function drawRemainsIronwork(ctx: Ctx, kind: PropKind, cx: number, cy: number): void {
  if (kind === 'bookshelf' || kind === 'crate' || kind === 'torch') return;
  ctx.save();
  ctx.strokeStyle = IRON_MID;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (kind === 'brazier') {
    // Flattened bowl plus one leg come off with it, so the tile still reads as
    // the thing that used to stand there.
    ctx.ellipse(cx - 2, cy + 3, 16, 5, -0.12, 0, Math.PI * 1.55);
    ctx.moveTo(cx + 9, cy + 8);
    ctx.lineTo(cx + 20, cy + 12);
  } else {
    ctx.ellipse(cx + 2, cy + 3, 15, 6, 0.2, 0.3, Math.PI * 1.75);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

const FALLEN_STAND_ANGLE = -0.42;
const FALLEN_STAND_LENGTH = 34;
const FALLEN_HEAD_OFFSET_X = 15;
const FALLEN_HEAD_OFFSET_Y = -5;
const FALLEN_HEAD_RX = 7.5;
const FALLEN_HEAD_RY = 4.6;
const FALLEN_STAND_BEND_FRACTION = 0.4;
const FALLEN_STAND_DROP = 2;
const FALLEN_STAND_WIDTH = 4;
const FALLEN_FOOT_SPREAD = [-8, 0, 8] as const;
const FALLEN_FOOT_REACH = 6;
/** The tile size the fallen head's own small contact shadow is scaled against. */
const FALLEN_HEAD_SHADOW_TILE = 16;
/** Pale ash flaking off a fallen torch's burnt head: how many flakes, how far they scatter, how big. */
const FALLEN_ASH = { count: 4, spreadX: 3, spreadY: 1.5, width: 1.2, height: 1 } as const;

/** A felled torch: its stand lying bent across the tile and the head beside it, charred and out. */
function drawFallenTorch(ctx: Ctx, cx: number, cy: number, rng: () => number): void {
  const half = FALLEN_STAND_LENGTH / 2;
  const dx = Math.cos(FALLEN_STAND_ANGLE) * half;
  const dy = Math.sin(FALLEN_STAND_ANGLE) * half;
  const bendX = cx + dx * FALLEN_STAND_BEND_FRACTION;
  const bendY = cy + dy * FALLEN_STAND_BEND_FRACTION + FALLEN_STAND_DROP;
  const hubX = cx - dx;
  const hubY = cy - dy + FALLEN_STAND_DROP;
  ironStrap(ctx, hubX, hubY, bendX, bendY, FALLEN_STAND_WIDTH);
  ironStrap(ctx, bendX, bendY, cx + dx, cy + FALLEN_STAND_DROP * 2, FALLEN_STAND_WIDTH);
  for (const footDx of FALLEN_FOOT_SPREAD) {
    ironStrap(ctx, hubX, hubY, hubX + footDx, hubY + FALLEN_FOOT_REACH, TORCH_FOOT_WIDTH);
  }

  const headX = cx + FALLEN_HEAD_OFFSET_X;
  const headY = cy + FALLEN_HEAD_OFFSET_Y;
  contactShadow(ctx, headX, headY + FALLEN_HEAD_RY, FALLEN_HEAD_SHADOW_TILE);
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(FALLEN_STAND_ANGLE + 0.6);
  ctx.fillStyle = cylinderRamp(ctx, -FALLEN_HEAD_RX, FALLEN_HEAD_RX, 0, [
    [0, CHAR_BLACK],
    [0.4, CHAR_GREY],
    [1, CHAR_BLACK],
  ]);
  ctx.beginPath();
  ctx.ellipse(0, 0, FALLEN_HEAD_RX, FALLEN_HEAD_RY, 0, 0, TWO_PI);
  ctx.fill();
  // The stub of the brand still in it.
  ctx.fillStyle = WOOD_SHADOW;
  ctx.fillRect(-FALLEN_HEAD_RX - 5, -1.4, 5, 2.8);
  // Pale ash flaking off the burnt wrap.
  ctx.fillStyle = ASH;
  for (let i = 0; i < FALLEN_ASH.count; i++) {
    const flakeX = signedUnit(rng) * FALLEN_ASH.spreadX;
    const flakeY = signedUnit(rng) * FALLEN_ASH.spreadY;
    ctx.fillRect(flakeX, flakeY, FALLEN_ASH.width, FALLEN_ASH.height);
  }
  ctx.restore();
}

function drawRemains(
  ctx: Ctx,
  kind: PropKind,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  seedTerm: number,
): void {
  const lookTerm = variantSeed(variant) + seedTerm;
  const rng = mulberry32(REMAINS_SEEDS[kind] + lookTerm);
  const cx = ox + ts / 2;
  const cy = oy + ts * REMAINS_CENTER_Y_FRACTION;

  wreckageShadow(ctx, cx, cy, ts);
  if (kind === 'torch' || kind === 'brazier') drawScorch(ctx, cx, cy, ts, rng);
  drawRemainsIronwork(ctx, kind, cx, cy);

  if (kind === 'torch') {
    const splinters = wreckageField(
      PLANK_SEEDS.torch + lookTerm,
      TORCH_REMAINS_SPLINTER_COUNT,
      REMAINS_WOOD_SHADES,
      REMAINS_PLANK_SIZE,
    );
    drawWreckageField(ctx, splinters, cx, cy, WOOD_EDGE);
    drawFallenTorch(ctx, cx, cy, rng);
    speckle(ctx, cx, cy, ts * REMAINS_SPECKLE_SPREAD_TILE_FRACTION, rng, ASH, SOOT);
    return;
  }

  const count =
    kind === 'brazier'
      ? BRAZIER_REMAINS_PIECE_COUNT
      : kind === 'bookshelf'
        ? BOOKSHELF_REMAINS_PLANK_COUNT
        : REMAINS_PLANK_COUNT;
  const shades = kind === 'brazier' ? IRON_RAMP : REMAINS_WOOD_SHADES;
  const pieces = wreckageField(PLANK_SEEDS[kind] + lookTerm, count, shades, REMAINS_PLANK_SIZE);
  drawWreckageField(ctx, pieces, cx, cy, kind === 'brazier' ? IRON_EDGE : WOOD_EDGE);
  if (kind === 'crate' && CRATE_LOOKS[variant] === 'open') {
    // The crate's straw packing, thrown out over the boards.
    for (let i = 0; i < 8; i++) {
      const sx = cx + signedUnit(rng) * 14;
      const sy = cy + signedUnit(rng) * 6;
      seam(ctx, sx - 3, sy, sx + 3, sy + signedUnit(rng) * 2, 0.9, STRAW);
    }
  }
  if (kind === 'bookshelf') drawSpilledBooks(ctx, cx, cy, rng);
  const [dustLight, dustDark] = kind === 'brazier' ? [ASH, SOOT] : [DUST, WOOD_DARK];
  speckle(ctx, cx, cy, ts * REMAINS_SPECKLE_SPREAD_TILE_FRACTION, rng, dustLight, dustDark);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Paints one frame of one prop, with the anchor tile's top-left corner at
 * (`ox`, `oy`) and the tile `ts` pixels across.
 *
 * `frame` is the animation frame of a burning prop's idle and damaged rows and
 * of every shatter row; for a static prop's idle, damaged and remains rows it
 * is the look, 0 to {@link PROP_VARIANT_COUNT} − 1.
 *
 * `seedTerm` is added to every fixed seed the prop draws from, so a review bake
 * can shift the whole family together while each kind keeps its own identity.
 * Zero is the art every sheet was reviewed against.
 */
export function drawProp(
  ctx: Ctx,
  kind: PropKind,
  state: PropState,
  frame: number,
  ox: number,
  oy: number,
  ts: number,
  seedTerm: number,
): void {
  if (state === 'shatter') {
    const progress = frame / (SHATTER_FRAMES - 1);
    drawShatterFrame(ctx, kind, ox, oy, ts, progress, seedTerm);
    return;
  }
  const burning = kind === 'torch' || kind === 'brazier';
  const variant = burning ? 0 : frame;
  if (state === 'remains') {
    drawRemains(ctx, kind, ox, oy, ts, variant, seedTerm);
    return;
  }
  const damaged = state === 'damaged';
  if (kind === 'barrel') drawBarrel(ctx, ox, oy, ts, damaged, variant, seedTerm);
  else if (kind === 'barrel_side') drawBarrelSide(ctx, ox, oy, ts, damaged, variant, seedTerm);
  else if (kind === 'torch') drawTorch(ctx, ox, oy, ts, damaged, frame, seedTerm);
  else if (kind === 'brazier') drawBrazier(ctx, ox, oy, ts, damaged, frame, seedTerm);
  else if (kind === 'bookshelf') drawBookshelf(ctx, ox, oy, ts, damaged, variant, seedTerm);
  else drawCrate(ctx, ox, oy, ts, damaged, variant, seedTerm);
}
