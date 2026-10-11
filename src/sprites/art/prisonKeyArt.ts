/**
 * The Goblin High Security Prison's key and the stone pedestal it floats over.
 *
 * The key has to be impossible to miss once it is on screen: it is about two
 * tiles tall, gold, ornate, bobbing and slowly turning about its upright axis,
 * with a pulsing halo and sparkles. Turning is drawn as a horizontal squash
 * through its edge, with the gold's thickness showing as it passes edge-on and
 * a darker back face, so it reads as a solid object rather than a flipping
 * card.
 *
 * Both painters are pure functions of their arguments: the same `t` always
 * paints the same frame. Positions are canvas pixels and sizes are given by
 * `tileSize`, so the runtime and the review harness draw at any scale.
 */

type Ctx = CanvasRenderingContext2D;

const FULL_CIRCLE = Math.PI * 2;

/** The key's height, in tiles. */
export const PRISON_KEY_HEIGHT_TILES = 2;
/** How far above the pedestal's base the key's centre floats, in tiles, at the middle of its bob. */
export const PRISON_KEY_CENTRE_ABOVE_BASE_TILES = 2.05;
/** The pedestal's footprint width, in tiles; it stands on one tile. */
export const KEY_PEDESTAL_WIDTH_TILES = 1;

// ── Gold ─────────────────────────────────────────────────────────────────────

interface GoldPalette {
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
  readonly outline: string;
}

const GOLD: GoldPalette = {
  shadow: '#5a3a06',
  dark: '#8c5f0e',
  mid: '#c9921d',
  light: '#f2c443',
  rim: '#fff3b0',
  outline: '#2b1a04',
};

/** The back face, turned away from the light. */
const GOLD_BACK: GoldPalette = {
  ...GOLD,
  mid: '#9c6c14',
  light: '#c99a2c',
  rim: '#e9cf7a',
};

const HALO = '#ffd860';
const SPARK = '#fffbe0';

// ── The key's shape, in key units ────────────────────────────────────────────
//
// 1.0 is the key's whole height; the origin is its centre, +Y down. The bow is
// a quatrefoil ring over a crown finial, the shaft carries two collars, and the
// bit hangs off one side at the foot. The bit and the cut-outs are what make
// it a key rather than a sceptre at a glance.

const BOW_CENTRE_Y = -0.27;
const BOW_RADIUS = 0.12;
const BOW_LOBE_RADIUS = 0.085;
const BOW_LOBE_REACH = 0.17;
const BOW_LOBES = 4;
const BOW_HOLE_RADIUS = 0.055;
const BOW_LOBE_HOLE_RADIUS = 0.03;
const FINIAL = { baseY: -0.5, tipY: -0.58, halfWidth: 0.045 } as const;
const SHAFT = { topY: -0.15, bottomY: 0.44, halfWidth: 0.032 } as const;
const COLLARS: ReadonlyArray<{
  readonly y: number;
  readonly halfWidth: number;
  readonly height: number;
}> = [
  { y: -0.14, halfWidth: 0.075, height: 0.035 },
  { y: -0.07, halfWidth: 0.06, height: 0.025 },
  { y: 0.2, halfWidth: 0.055, height: 0.025 },
];
/** The bit: a plate off the shaft's right at the foot, with notches cut into its far edge. */
const BIT = { topY: 0.27, bottomY: 0.44, outerX: 0.17 } as const;
const BIT_NOTCHES: ReadonlyArray<{
  readonly y: number;
  readonly depth: number;
  readonly height: number;
}> = [
  { y: 0.3, depth: 0.05, height: 0.03 },
  { y: 0.37, depth: 0.08, height: 0.025 },
];
const TIP_RADIUS = 0.04;
/** Outline width, in key units. */
const OUTLINE = 0.012;

function traceBow(ctx: Ctx, grow: number): void {
  ctx.moveTo(BOW_RADIUS + grow, BOW_CENTRE_Y);
  ctx.arc(0, BOW_CENTRE_Y, BOW_RADIUS + grow, 0, FULL_CIRCLE);
  for (let i = 0; i < BOW_LOBES; i++) {
    const angle = (i * FULL_CIRCLE) / BOW_LOBES;
    const cx = Math.cos(angle) * BOW_LOBE_REACH;
    const cy = BOW_CENTRE_Y + Math.sin(angle) * BOW_LOBE_REACH;
    ctx.moveTo(cx + BOW_LOBE_RADIUS + grow, cy);
    ctx.arc(cx, cy, BOW_LOBE_RADIUS + grow, 0, FULL_CIRCLE);
  }
}

/** The cut-outs, wound against the shapes so a nonzero fill leaves them open. */
function traceHoles(ctx: Ctx, shrink: number): void {
  const hole = BOW_HOLE_RADIUS - shrink;
  const lobeHole = BOW_LOBE_HOLE_RADIUS - shrink;
  ctx.moveTo(hole, BOW_CENTRE_Y);
  ctx.arc(0, BOW_CENTRE_Y, hole, 0, FULL_CIRCLE, true);
  for (let i = 0; i < BOW_LOBES; i++) {
    const angle = (i * FULL_CIRCLE) / BOW_LOBES;
    const cx = Math.cos(angle) * BOW_LOBE_REACH;
    const cy = BOW_CENTRE_Y + Math.sin(angle) * BOW_LOBE_REACH;
    ctx.moveTo(cx + lobeHole, cy);
    ctx.arc(cx, cy, lobeHole, 0, FULL_CIRCLE, true);
  }
}

function traceBody(ctx: Ctx, grow: number): void {
  ctx.rect(
    -SHAFT.halfWidth - grow,
    SHAFT.topY,
    (SHAFT.halfWidth + grow) * 2,
    SHAFT.bottomY - SHAFT.topY,
  );
  for (const collar of COLLARS) {
    ctx.rect(
      -collar.halfWidth - grow,
      collar.y - grow,
      (collar.halfWidth + grow) * 2,
      collar.height + grow * 2,
    );
  }
  ctx.moveTo(0, FINIAL.tipY - grow);
  ctx.lineTo(FINIAL.halfWidth + grow, FINIAL.baseY);
  ctx.lineTo(0, BOW_CENTRE_Y - BOW_RADIUS);
  ctx.lineTo(-FINIAL.halfWidth - grow, FINIAL.baseY);
  ctx.closePath();
  ctx.moveTo(SHAFT.halfWidth, BIT.topY - grow);
  ctx.lineTo(BIT.outerX + grow, BIT.topY - grow);
  for (const notch of BIT_NOTCHES) {
    ctx.lineTo(BIT.outerX + grow, notch.y);
    ctx.lineTo(BIT.outerX - notch.depth + grow, notch.y);
    ctx.lineTo(BIT.outerX - notch.depth + grow, notch.y + notch.height);
    ctx.lineTo(BIT.outerX + grow, notch.y + notch.height);
  }
  ctx.lineTo(BIT.outerX + grow, BIT.bottomY + grow);
  ctx.lineTo(SHAFT.halfWidth, BIT.bottomY + grow);
  ctx.closePath();
  ctx.moveTo(TIP_RADIUS + grow, SHAFT.bottomY);
  ctx.arc(0, SHAFT.bottomY, TIP_RADIUS + grow, 0, FULL_CIRCLE);
}

function traceKey(ctx: Ctx, grow: number): void {
  ctx.beginPath();
  traceBow(ctx, grow);
  traceBody(ctx, grow);
  traceHoles(ctx, grow);
}

/** The face's sheen: a lit band down the left of the shaft and across the bow. */
const SHEEN_ALPHA = 0.7;
const CORE_SHADE_ALPHA = 0.5;
const KEY_HALF_SPAN = 0.25;

function paintKeyFace(ctx: Ctx, palette: GoldPalette): void {
  ctx.fillStyle = palette.outline;
  traceKey(ctx, OUTLINE);
  ctx.fill();

  const gradient = ctx.createLinearGradient(-KEY_HALF_SPAN, -1 / 2, KEY_HALF_SPAN, 1 / 2);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(GRADIENT_MID, palette.mid);
  gradient.addColorStop(1, palette.dark);
  ctx.fillStyle = gradient;
  traceKey(ctx, 0);
  ctx.fill();

  ctx.save();
  traceKey(ctx, 0);
  ctx.clip();
  ctx.fillStyle = withAlpha(palette.rim, SHEEN_ALPHA);
  ctx.fillRect(
    -SHAFT.halfWidth,
    SHAFT.topY,
    SHAFT.halfWidth * SHEEN_SHARE,
    SHAFT.bottomY - SHAFT.topY,
  );
  ctx.beginPath();
  ctx.arc(0, BOW_CENTRE_Y, BOW_RADIUS + BOW_LOBE_RADIUS, Math.PI, Math.PI * BOW_SHEEN_END);
  ctx.lineWidth = BOW_SHEEN_WIDTH;
  ctx.strokeStyle = withAlpha(palette.rim, SHEEN_ALPHA);
  ctx.stroke();
  ctx.fillStyle = withAlpha(palette.shadow, CORE_SHADE_ALPHA);
  ctx.fillRect(
    SHAFT.halfWidth * SHADE_FROM,
    SHAFT.topY,
    SHAFT.halfWidth,
    SHAFT.bottomY - SHAFT.topY,
  );
  ctx.restore();
}
const GRADIENT_MID = 0.5;
const SHEEN_SHARE = 0.8;
const BOW_SHEEN_END = 1.45;
const BOW_SHEEN_WIDTH = 0.04;
const SHADE_FROM = 0.3;

const HEX_RADIX = 16;
const HEX_PAIR = 2;
/** Alphas below this go to zero: node-canvas drops an `rgba()` written in exponent notation. */
const MIN_ALPHA = 1e-6;

function withAlpha(hex: string, alpha: number): string {
  const channel = (at: number): number => parseInt(hex.slice(at, at + HEX_PAIR), HEX_RADIX);
  const red = channel(1);
  const green = channel(1 + HEX_PAIR);
  const blue = channel(1 + HEX_PAIR * 2);
  const safe = alpha < MIN_ALPHA ? 0 : Math.min(1, alpha);
  return `rgba(${red},${green},${blue},${safe.toFixed(4)})`;
}

/**
 * Paint the key upright at `(cx, cy)`, `height` pixels tall, turned so its face
 * spans `faceScale` of its width (1 face-on, 0 edge-on, negative showing the
 * back). `thickness` is the gold's depth in key units, shown as an extruded
 * edge in the direction the face is turning.
 */
export function drawPrisonKeyShape(
  ctx: Ctx,
  cx: number,
  cy: number,
  height: number,
  faceScale: number,
  turnDirection: number,
): void {
  const width = Math.sign(faceScale || 1) * Math.max(Math.abs(faceScale), MIN_FACE_SCALE);
  const palette = faceScale >= 0 ? GOLD : GOLD_BACK;
  const edge = (1 - Math.abs(faceScale)) * KEY_THICKNESS * Math.sign(turnDirection || 1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(height, height);
  if (Math.abs(edge) > MIN_ALPHA) {
    ctx.save();
    ctx.translate(edge, 0);
    ctx.scale(width, 1);
    ctx.fillStyle = GOLD.outline;
    traceKey(ctx, OUTLINE);
    ctx.fill();
    ctx.fillStyle = GOLD.shadow;
    traceKey(ctx, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.scale(width, 1);
  paintKeyFace(ctx, palette);
  ctx.restore();
}
/** Edge-on, the key is still drawn this wide, so it never vanishes into a line. */
const MIN_FACE_SCALE = 0.14;
const KEY_THICKNESS = 0.05;

// ── The floating key ─────────────────────────────────────────────────────────

/** One full turn about the upright axis takes this many seconds. */
const TURN_PERIOD_SECONDS = 5;
const BOB_PERIOD_SECONDS = 2.4;
const BOB_TILES = 0.08;
const HALO_PERIOD_SECONDS = 1.6;
const HALO_RADIUS_TILES = 1.35;
const HALO_MIN_ALPHA = 0.28;
const HALO_PULSE_ALPHA = 0.22;
const HALO_CORE_STOP = 0.25;
const HALO_CORE_SHARE = 0.6;

/** Sparkles: how many are alive at once, how long each lives and how far out they appear. */
const SPARK_COUNT = 6;
const SPARK_LIFE_SECONDS = 0.9;
const SPARK_SPREAD_X_TILES = 0.75;
const SPARK_SPREAD_Y_TILES = 1.05;
const SPARK_SIZE_TILES = 0.12;
const SPARK_WAIST = 0.2;
const SPARK_ALPHA = 0.95;
/** Two large primes, so neighbouring sparkle cycles land far apart. */
const HASH_A = 2654435761;
const HASH_B = 40503;
const HASH_SPAN = 4294967296;

function hash01(cycle: number, index: number, salt: number): number {
  const mixed = Math.imul(cycle * HASH_B + index * HASH_A + salt, HASH_A) >>> 0;
  return mixed / HASH_SPAN;
}

function drawSparkle(ctx: Ctx, x: number, y: number, size: number, alpha: number): void {
  if (alpha < MIN_ALPHA || size < MIN_ALPHA) return;
  const waist = size * SPARK_WAIST;
  ctx.fillStyle = withAlpha(SPARK, alpha);
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + waist, y - waist);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.closePath();
  ctx.fill();
}

/** The halo's strength at time `t`, 0–1; the lighting can pulse its pool with it. */
export function prisonKeyPulse(t: number): number {
  return (1 + Math.sin((t / HALO_PERIOD_SECONDS) * FULL_CIRCLE)) / 2;
}

/** How far the key has bobbed above its rest height at time `t`, in tiles. */
export function prisonKeyBobTiles(t: number): number {
  return Math.sin((t / BOB_PERIOD_SECONDS) * FULL_CIRCLE) * BOB_TILES;
}

/**
 * Paint the floating key, its halo and its sparkles, centred on `(x, y)` at
 * the middle of its bob, at time `t` in seconds.
 */
export function drawPrisonKey(ctx: Ctx, x: number, y: number, t: number, tileSize: number): void {
  const centreY = y - prisonKeyBobTiles(t) * tileSize;
  const pulse = prisonKeyPulse(t);
  const turn = (t / TURN_PERIOD_SECONDS) * FULL_CIRCLE;
  const haloRadius = HALO_RADIUS_TILES * tileSize;
  const haloAlpha = HALO_MIN_ALPHA + HALO_PULSE_ALPHA * pulse;

  ctx.save();
  const halo = ctx.createRadialGradient(x, centreY, 0, x, centreY, haloRadius);
  halo.addColorStop(0, withAlpha(HALO, haloAlpha));
  halo.addColorStop(HALO_CORE_STOP, withAlpha(HALO, haloAlpha * HALO_CORE_SHARE));
  halo.addColorStop(1, withAlpha(HALO, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, centreY, haloRadius, 0, FULL_CIRCLE);
  ctx.fill();

  drawPrisonKeyShape(
    ctx,
    x,
    centreY,
    PRISON_KEY_HEIGHT_TILES * tileSize,
    Math.cos(turn),
    -Math.sin(turn),
  );

  for (let i = 0; i < SPARK_COUNT; i++) {
    const offsetT = t + (i * SPARK_LIFE_SECONDS) / SPARK_COUNT;
    const cycle = Math.floor(offsetT / SPARK_LIFE_SECONDS);
    const life = offsetT / SPARK_LIFE_SECONDS - cycle;
    const sx = x + (hash01(cycle, i, 1) * 2 - 1) * SPARK_SPREAD_X_TILES * tileSize;
    const sy = centreY + (hash01(cycle, i, 2) * 2 - 1) * SPARK_SPREAD_Y_TILES * tileSize;
    const swell = Math.sin(life * Math.PI);
    drawSparkle(ctx, sx, sy, SPARK_SIZE_TILES * tileSize * swell, SPARK_ALPHA * swell);
  }
  ctx.restore();
}

// ── The pedestal ─────────────────────────────────────────────────────────────

const STONE = {
  shadow: '#2a2a2f',
  dark: '#45464d',
  mid: '#6b6c73',
  light: '#93949b',
  rim: '#c2c3c8',
  outline: '#141418',
} as const;

/** The pedestal's parts, in tiles: widths are full widths, heights stack up from the base. */
const PLINTH = { width: 0.96, height: 0.16 } as const;
const PLINTH_STEP = { width: 0.82, height: 0.08 } as const;
const COLUMN = { width: 0.56, height: 0.5 } as const;
const CAPITAL = { width: 0.86, height: 0.12 } as const;
/** The top face, seen from a little above: its depth as a share of its width. */
const TOP_DEPTH_SHARE = 0.28;
const FLUTES = 3;
const FLUTE_WIDTH = 0.035;
const INLAY_AT = 0.45;
const INLAY_HEIGHT = 0.05;
const STONE_OUTLINE = 0.025;
const BASE_SHADOW = { width: 1.25, depth: 0.32, alpha: 0.45 } as const;
const STONE_SHADE_ALPHA = 0.45;
const STONE_LIGHT_ALPHA = 0.35;
const SIDE_SHARE = 0.3;
/** Lit: a warm glow over the top face and a bright inlay; dim: a faint lamp. */
const LIT_GLOW = { radius: 0.9, alpha: 0.55 } as const;
const DIM_GLOW = { radius: 0.35, alpha: 0.22 } as const;
const INLAY_LIT = '#ffd860';
const INLAY_DIM = '#7a5a1c';
const RUNE_COUNT = 5;
const RUNE_SIZE = 0.035;

/** Total height of the pedestal from its base to its top face, in tiles. */
export const KEY_PEDESTAL_HEIGHT_TILES =
  PLINTH.height + PLINTH_STEP.height + COLUMN.height + CAPITAL.height;

function stoneBlock(ctx: Ctx, cx: number, bottom: number, width: number, height: number): void {
  const left = cx - width / 2;
  const top = bottom - height;
  ctx.fillStyle = STONE.outline;
  ctx.fillRect(
    left - STONE_OUTLINE,
    top - STONE_OUTLINE,
    width + STONE_OUTLINE * 2,
    height + STONE_OUTLINE * 2,
  );
  ctx.fillStyle = STONE.mid;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = withAlpha(STONE.rim, STONE_LIGHT_ALPHA);
  ctx.fillRect(left, top, width * SIDE_SHARE, height);
  ctx.fillStyle = withAlpha(STONE.shadow, STONE_SHADE_ALPHA);
  ctx.fillRect(left + width * (1 - SIDE_SHARE), top, width * SIDE_SHARE, height);
}

/**
 * Paint the stone pedestal standing on the floor at `(x, y)` (the middle of
 * its base). `lit` is the vault's state while the key is on it: a warm glow and
 * a bright gold inlay. Unlit, it is a dim lamp.
 */
export function drawKeyPedestal(
  ctx: Ctx,
  x: number,
  y: number,
  lit: boolean,
  tileSize: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(tileSize, tileSize);

  ctx.fillStyle = withAlpha(STONE.outline, BASE_SHADOW.alpha);
  ctx.beginPath();
  ctx.ellipse(0, 0, BASE_SHADOW.width / 2, BASE_SHADOW.depth / 2, 0, 0, FULL_CIRCLE);
  ctx.fill();

  let bottom = 0;
  stoneBlock(ctx, 0, bottom, PLINTH.width, PLINTH.height);
  bottom -= PLINTH.height;
  stoneBlock(ctx, 0, bottom, PLINTH_STEP.width, PLINTH_STEP.height);
  bottom -= PLINTH_STEP.height;
  stoneBlock(ctx, 0, bottom, COLUMN.width, COLUMN.height);
  ctx.fillStyle = STONE.dark;
  for (let i = 0; i < FLUTES; i++) {
    const fx = -COLUMN.width / 2 + ((i + 1) * COLUMN.width) / (FLUTES + 1);
    ctx.fillRect(fx - FLUTE_WIDTH / 2, bottom - COLUMN.height, FLUTE_WIDTH, COLUMN.height);
  }
  const inlayY = bottom - COLUMN.height * INLAY_AT;
  ctx.fillStyle = lit ? INLAY_LIT : INLAY_DIM;
  ctx.fillRect(-COLUMN.width / 2, inlayY, COLUMN.width, INLAY_HEIGHT);
  if (lit) {
    ctx.fillStyle = STONE.outline;
    for (let i = 0; i < RUNE_COUNT; i++) {
      const rx = -COLUMN.width / 2 + ((i + 0.5) * COLUMN.width) / RUNE_COUNT;
      ctx.fillRect(
        rx - RUNE_SIZE / 2,
        inlayY + (INLAY_HEIGHT - RUNE_SIZE) / 2,
        RUNE_SIZE,
        RUNE_SIZE,
      );
    }
  }
  bottom -= COLUMN.height;
  stoneBlock(ctx, 0, bottom, CAPITAL.width, CAPITAL.height);
  bottom -= CAPITAL.height;

  const topDepth = CAPITAL.width * TOP_DEPTH_SHARE;
  ctx.fillStyle = STONE.outline;
  ctx.beginPath();
  ctx.ellipse(
    0,
    bottom,
    CAPITAL.width / 2 + STONE_OUTLINE,
    topDepth / 2 + STONE_OUTLINE,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
  ctx.fillStyle = STONE.light;
  ctx.beginPath();
  ctx.ellipse(0, bottom, CAPITAL.width / 2, topDepth / 2, 0, 0, FULL_CIRCLE);
  ctx.fill();

  const glow = lit ? LIT_GLOW : DIM_GLOW;
  const light = ctx.createRadialGradient(0, bottom, 0, 0, bottom, glow.radius);
  light.addColorStop(0, withAlpha(HALO, glow.alpha));
  light.addColorStop(1, withAlpha(HALO, 0));
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(0, bottom, glow.radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();
}
