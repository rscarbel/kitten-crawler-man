/**
 * The two goblins that throw explosives, dressed on the goblin rig.
 *
 * Both are told apart from the melee goblins, the archer and each other by
 * silhouette first, because that is all that survives at the 32-px tile with
 * the colour taken away:
 *
 * - The dynamite goblin is small, lean and hunched under a dented miner's
 *   helmet with a candle stub standing up off its crown, and a bandolier of
 *   red sticks bristles off its chest. The candle's flame is the one warm point
 *   of light any goblin carries at its head.
 * - The black powder goblin is squat and broad, planted wide, with an
 *   iron-banded powder keg on its back that reads as a big round hump over the
 *   shoulders, a floppy wide-brimmed cap, and a scarf pulled up over its nose.
 *
 * Everything here is clothing and gear composed inside the figure through the
 * rig's outfit hooks, so it shares the figure's outline, rim and cast shadows,
 * plus the light painters (flames, sparks, embers and smoke) that the
 * choreography lays over the finished figure, where an outline would turn a
 * glow into a sticker.
 *
 * Coordinates follow the rig: tile units, +X the way the goblin faces, -Y up.
 */

import {
  FULL_CIRCLE_ANGLE,
  LIGHT,
  NO_GEAR,
  deg,
  fillCapsule,
  figureHeight,
  goblinPalette,
  lerp,
  mix,
  mixPt,
  offset,
  pt,
  rgba,
  rotatePt,
  traceNose,
  traceSkull,
  type BoneChain,
  type GoblinBomberArchetype,
  type GoblinOutfit,
  type GoblinPalette,
  type GoblinProportions,
  type GoblinStyle,
  type Pt,
  type Ramp,
} from './goblinArt';
import { withClip } from './softShade';
import { DYNAMITE_CRIMP, DYNAMITE_FUSE_CORD, DYNAMITE_PAPER } from './goblinWeapons';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;

/** A point given in head units (x in head widths, y in head radii) placed in head space. */
function headPoint(p: GoblinProportions, at: Pt): Pt {
  return pt(at.x * p.headRadius * p.headWidthFactor, at.y * p.headRadius);
}

/** Shades a traced shape from its lit upper-left to its shadowed lower-right. */
function shadeAcross(
  ctx: Ctx,
  trace: () => void,
  from: Pt,
  to: Pt,
  ramp: Ramp,
  litAlpha: number,
  shadeAlpha: number,
): void {
  withClip(ctx, trace, () => {
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, rgba(ramp.rim, litAlpha));
    gradient.addColorStop(HALF, rgba(ramp.mid, 0));
    gradient.addColorStop(1, rgba(ramp.shadow, shadeAlpha));
    ctx.fillStyle = gradient;
    const left = Math.min(from.x, to.x);
    const top = Math.min(from.y, to.y);
    ctx.fillRect(left, top, Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  });
}

// ── Materials ────────────────────────────────────────────────────────────────

/** A dented tin miner's helmet, gone dull ochre under soot and grease. */
const HELMET_TIN: Ramp = {
  shadow: '#38331f',
  dark: '#5f5637',
  mid: '#8e8358',
  light: '#b8ad7c',
  rim: '#e0d6a4',
};
const CANDLE_WAX = '#efe5c4';
const CANDLE_WAX_SHADE = '#b9a97c';
const GOGGLE_BRASS: Ramp = {
  shadow: '#4b3510',
  dark: '#7a5a1c',
  mid: '#b98d33',
  light: '#dcb45a',
  rim: '#f6dd92',
};
const GOGGLE_GLASS = '#1f3436';
const GOGGLE_GLINT = '#bfe6e2';
/** Soot: a warm brown-black, so it reads as burnt rather than as a shadow. */
const SOOT = '#17120d';
/** The apron's char and the glow still caught in its holes. */
const CHAR = '#0f0b08';
const EMBER_EDGE = '#d0641f';
const RAGGED_TROUSERS: Ramp = {
  shadow: '#1c1f26',
  dark: '#30353f',
  mid: '#4b525e',
  light: '#68707d',
  rim: '#8c94a0',
};
const BANDOLIER_STRAP: Ramp = {
  shadow: '#1f130a',
  dark: '#3a2414',
  mid: '#5a381e',
  light: '#7b5130',
  rim: '#a37448',
};

/** Quilted gambeson, a dirty canvas grey stained black with powder. */
const GAMBESON: Ramp = {
  shadow: '#3b3832',
  dark: '#625e53',
  mid: '#aea896',
  light: '#c6c0ae',
  rim: '#e6e0ce',
};
const POWDER_STAIN = '#16161a';
const FELT_CAP: Ramp = {
  shadow: '#140f0b',
  dark: '#241b14',
  mid: '#3b2e23',
  light: '#574537',
  rim: '#7d6855',
};
const BREECHES: Ramp = {
  shadow: '#1d140d',
  dark: '#33251a',
  mid: '#4f3a29',
  light: '#6a5039',
  rim: '#8d6f52',
};
const KEG_IRON = '#2a2d31';
const KEG_IRON_LIT = '#6b727b';
const HEMP: Ramp = {
  shadow: '#4a3b22',
  dark: '#715c37',
  mid: '#9a8256',
  light: '#bea676',
  rim: '#ddc89a',
};
const HORN_TIP = '#2a2018';
const BRASS_CAP = '#c9a24a';
const BOMB_BLACK = '#22262b';
const BOMB_SHEEN = '#c3ccd6';

// ── Shared overlays: light laid over the finished figure ─────────────────────

/** A deterministic 0–1 value per (index, salt), for spark directions and flicker. */
function hash01(index: number, salt: number): number {
  const PRIME_A = 12.9898;
  const PRIME_B = 78.233;
  const SCALE = 43758.5453;
  const value = Math.sin(index * PRIME_A + salt * PRIME_B) * SCALE;
  return value - Math.floor(value);
}

/** How strongly a node-canvas gradient stop survives; alphas below this are dropped as zero. */
const MIN_ALPHA = 1e-4;

function safeAlpha(alpha: number): number {
  return alpha < MIN_ALPHA ? 0 : alpha;
}

/** A soft round glow, its colour fading to nothing at `radius`. */
function glow(ctx: Ctx, at: Pt, radius: number, colour: string, alpha: number): void {
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  gradient.addColorStop(0, rgba(colour, safeAlpha(alpha)));
  gradient.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

const SPARK_GLOW = '#ffb347';
const SPARK_HOT = '#fff6d0';
const SPARK_TRAIL = '#ff8a2a';
const FLAME_OUTER = '#ff9a30';
const FLAME_INNER = '#ffe9a8';
const SMOKE = '#8f9294';

/** A burning fuse: a hot core, a halo, and a spray of short spark streaks. */
const FUSE_GLOW_RADIUS = 0.11;
const FUSE_GLOW_ALPHA = 0.55;
const FUSE_CORE_RADIUS = 0.022;
const FUSE_SPARKS = 5;
const FUSE_SPARK_MIN = 0.05;
const FUSE_SPARK_REACH = 0.06;
const FUSE_SPARK_WIDTH = 0.012;
/** Sparks fly up and away more than down: a fan centred straight up. */
const FUSE_SPARK_FAN = deg(250);
const FUSE_SPARK_FAN_CENTRE = deg(-90);

/**
 * A fizzing fuse at `at`. `seed` picks this frame's spray, so a row flickers
 * from frame to frame while every bake of the same frame is identical;
 * `strength` scales it, 1 for an ordinary burn.
 */
export function drawFuseSpark(ctx: Ctx, at: Pt, seed: number, strength: number): void {
  if (strength <= 0) return;
  glow(ctx, at, FUSE_GLOW_RADIUS * strength, SPARK_GLOW, FUSE_GLOW_ALPHA);
  ctx.lineCap = 'round';
  for (let i = 0; i < FUSE_SPARKS; i++) {
    const angle = FUSE_SPARK_FAN_CENTRE + (hash01(seed, i) - HALF) * FUSE_SPARK_FAN;
    const reach = (FUSE_SPARK_MIN + hash01(seed, i + FUSE_SPARKS) * FUSE_SPARK_REACH) * strength;
    const tip = pt(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach);
    ctx.strokeStyle = rgba(SPARK_TRAIL, HALF + HALF * hash01(seed, i + 2 * FUSE_SPARKS));
    ctx.lineWidth = FUSE_SPARK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.fillStyle = SPARK_HOT;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, FUSE_SPARK_WIDTH * HALF, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
  ctx.fillStyle = SPARK_HOT;
  ctx.beginPath();
  ctx.arc(at.x, at.y, FUSE_CORE_RADIUS * strength, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

/** The flash where a fuse catches: a bright star of rays and a wide halo. */
const BURST_RADIUS = 0.2;
const BURST_GLOW_ALPHA = 0.75;
const BURST_RAYS = 8;
const BURST_RAY_WIDTH = 0.02;
const BURST_CORE_RADIUS = 0.035;
/** Alternate rays are this share of the long ones, so the burst reads as a star. */
const BURST_SHORT_RAY = 0.55;

export function drawSparkBurst(ctx: Ctx, at: Pt, strength: number): void {
  if (strength <= 0) return;
  const radius = BURST_RADIUS * strength;
  glow(ctx, at, radius, SPARK_GLOW, BURST_GLOW_ALPHA);
  ctx.strokeStyle = SPARK_HOT;
  ctx.lineCap = 'round';
  ctx.lineWidth = BURST_RAY_WIDTH * strength;
  for (let i = 0; i < BURST_RAYS; i++) {
    const angle = (i / BURST_RAYS) * FULL_CIRCLE_ANGLE;
    const reach = radius * (i % 2 === 0 ? 1 : BURST_SHORT_RAY);
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach);
    ctx.stroke();
  }
  ctx.fillStyle = SPARK_HOT;
  ctx.beginPath();
  ctx.arc(at.x, at.y, BURST_CORE_RADIUS * strength, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

/** A candle flame standing on its wick, with the warm pool of light it casts. */
const FLAME_HEIGHT = 0.085;
const FLAME_HALF_WIDTH = 0.026;
const FLAME_FLICKER = 0.25;
const FLAME_LEAN = 0.012;
const FLAME_POOL_RADIUS = 0.2;
const FLAME_POOL_ALPHA = 0.45;
const FLAME_CORE_SHARE = 0.5;
/** The flame's widest point, as a share of its height up from the wick. */
const FLAME_BELLY = 0.3;

export function drawCandleFlame(ctx: Ctx, wick: Pt, seed: number): void {
  const flicker = 1 + (hash01(seed, 1) - HALF) * FLAME_FLICKER;
  const lean = (hash01(seed, 2) - HALF) * FLAME_LEAN * 2;
  const height = FLAME_HEIGHT * flicker;
  glow(ctx, offset(wick, 0, -height * HALF), FLAME_POOL_RADIUS, FLAME_OUTER, FLAME_POOL_ALPHA);
  const traceFlame = (scale: number): void => {
    const top = pt(wick.x + lean * scale, wick.y - height * scale);
    const half = FLAME_HALF_WIDTH * scale;
    const belly = wick.y - height * FLAME_BELLY * scale;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(wick.x + half * 2, belly, wick.x, wick.y);
    ctx.quadraticCurveTo(wick.x - half * 2, belly, top.x, top.y);
    ctx.closePath();
  };
  ctx.fillStyle = FLAME_OUTER;
  traceFlame(1);
  ctx.fill();
  ctx.fillStyle = FLAME_INNER;
  traceFlame(FLAME_CORE_SHARE);
  ctx.fill();
}

/** A slow-match's glowing tip: a small, steady ember. */
const EMBER_RADIUS = 0.13;
const EMBER_ALPHA = 0.95;
const EMBER_CORE = 0.026;

export function drawEmber(ctx: Ctx, at: Pt): void {
  glow(ctx, at, EMBER_RADIUS, SPARK_TRAIL, EMBER_ALPHA);
  ctx.fillStyle = SPARK_HOT;
  ctx.beginPath();
  ctx.arc(at.x, at.y, EMBER_CORE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

/**
 * A thin wisp of smoke rising off a point. The puffs climb the wisp over one
 * cycle, so a looping row shows smoke drifting up rather than a fixed smudge.
 */
const SMOKE_PUFFS = 3;
const SMOKE_RISE = 0.3;
const SMOKE_DRIFT = 0.05;
const SMOKE_PUFF_RADIUS = 0.03;
const SMOKE_PUFF_GROWTH = 0.03;
const SMOKE_ALPHA = 0.45;

export function drawSmokeWisp(ctx: Ctx, from: Pt, cycle: number): void {
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const age = (cycle + i / SMOKE_PUFFS) % 1;
    const at = pt(
      from.x - SMOKE_DRIFT * age + Math.sin(age * FULL_CIRCLE_ANGLE) * SMOKE_DRIFT * HALF,
      from.y - SMOKE_RISE * age,
    );
    glow(ctx, at, SMOKE_PUFF_RADIUS + SMOKE_PUFF_GROWTH * age, SMOKE, SMOKE_ALPHA * (1 - age));
  }
}

// ── Dynamite goblin: helmet, candle, goggles and soot ────────────────────────

/** The helmet's dome and narrow brim, in head units. */
const HELMET = {
  backBase: pt(-1.04, -0.3),
  backControl: pt(-1.14, -0.98),
  crownControl: pt(-0.52, -1.34),
  crown: pt(0.08, -1.3),
  frontControl: pt(0.66, -1.27),
  foreheadControl: pt(0.98, -0.95),
  frontBase: pt(0.98, -0.5),
  brimTip: pt(1.3, -0.42),
  brimLip: pt(1.28, -0.33),
  brimBack: pt(-1.16, -0.22),
  shadeFrom: pt(-1.0, -1.3),
  shadeTo: pt(1.0, -0.3),
} as const;
/** The dent knocked into the crown: a shadowed hollow with a lit lower lip. */
const HELMET_DENT = { at: pt(-0.42, -1.08), rx: 0.26, ry: 0.11, tilt: deg(-18) } as const;
const HELMET_DENT_LIP = 0.05;
/** The band of the hat round the base of the dome. */
const HELMET_BAND_TOP = -0.56;
const HELMET_BAND_ALPHA = 0.65;
const HELMET_LIT_ALPHA = 0.7;
const HELMET_SHADE_ALPHA = 0.7;
/** The specular streak along the lit shoulder of the dome. */
const HELMET_GLINT = {
  at: pt(-0.38, -1.0),
  rx: 0.34,
  ry: 0.07,
  tilt: deg(-28),
  alpha: 0.7,
} as const;

/**
 * The candle stub stands on the crown toward the front, tall enough to break
 * the head's outline as a short post: that post is what the silhouette shows,
 * and the flame on it is what the colour shows.
 */
const CANDLE = {
  left: 0.12,
  right: 0.36,
  base: -1.24,
  top: -1.95,
  drip: 0.09,
} as const;
/** Where the wick stands, in head units: the flame is painted on it. */
export const DYNAMITE_CANDLE_WICK: Pt = pt((CANDLE.left + CANDLE.right) / 2, CANDLE.top - 0.05);
/** The tin cup the candle is wedged in, at its foot. */
const CANDLE_CUP_HEIGHT = 0.12;
const CANDLE_CUP_FLARE = 0.06;

/** The goggles pushed up onto the front of the helmet, in head units. */
const GOGGLE_NEAR = { at: pt(0.66, -0.78), radius: 0.24 } as const;
const GOGGLE_FAR = { at: pt(0.98, -0.74), radius: 0.18 } as const;
const GOGGLE_RING = 0.3;
const GOGGLE_GLINT_AT = pt(-0.3, -0.35);
const GOGGLE_GLINT_RADIUS = 0.22;
const GOGGLE_STRAP_WIDTH = 0.16;

/** Soot over the lower face, from just under the nose root down. */
const SOOT_FROM = 0.0;
const SOOT_FULL = 0.45;
const SOOT_ALPHA = 0.78;
/** Singed brows: a few burnt stubs along the brow ridge. */
const SINGE_STUBS = 4;
const SINGE_FROM = 0.15;
const SINGE_TO = 0.85;
const SINGE_Y = -0.36;
const SINGE_RADIUS = 0.05;

function drawSootedFace(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const soot = (): void => {
    const gradient = ctx.createLinearGradient(0, r * SOOT_FROM, 0, r * SOOT_FULL);
    gradient.addColorStop(0, rgba(SOOT, 0));
    gradient.addColorStop(1, rgba(SOOT, SOOT_ALPHA));
    ctx.fillStyle = gradient;
    ctx.fillRect(-r * 2, r * SOOT_FROM, r * 4, r * 2);
  };
  withClip(ctx, () => traceSkull(ctx, p), soot);
  withClip(ctx, () => traceNose(ctx, p), soot);
  ctx.fillStyle = SOOT;
  for (let i = 0; i < SINGE_STUBS; i++) {
    const t = lerp(SINGE_FROM, SINGE_TO, i / (SINGE_STUBS - 1));
    const at = headPoint(p, pt(t, SINGE_Y));
    ctx.beginPath();
    ctx.arc(at.x, at.y, r * SINGE_RADIUS, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
}

function drawMinerHelmet(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const at = (point: Pt): Pt => headPoint(p, point);
  const traceDome = (): void => {
    const backBase = at(HELMET.backBase);
    const backControl = at(HELMET.backControl);
    const crownControl = at(HELMET.crownControl);
    const crown = at(HELMET.crown);
    const frontControl = at(HELMET.frontControl);
    const foreheadControl = at(HELMET.foreheadControl);
    const frontBase = at(HELMET.frontBase);
    const brimTip = at(HELMET.brimTip);
    const brimLip = at(HELMET.brimLip);
    const brimBack = at(HELMET.brimBack);
    ctx.beginPath();
    ctx.moveTo(brimBack.x, brimBack.y);
    ctx.lineTo(backBase.x, backBase.y);
    ctx.bezierCurveTo(
      backControl.x,
      backControl.y,
      crownControl.x,
      crownControl.y,
      crown.x,
      crown.y,
    );
    ctx.bezierCurveTo(
      frontControl.x,
      frontControl.y,
      foreheadControl.x,
      foreheadControl.y,
      frontBase.x,
      frontBase.y,
    );
    ctx.lineTo(brimTip.x, brimTip.y);
    ctx.lineTo(brimLip.x, brimLip.y);
    ctx.closePath();
  };

  // The candle goes in first so the dome's crown overlaps the foot of its cup.
  const candleLeft = at(pt(CANDLE.left, CANDLE.base));
  const candleTop = at(pt(CANDLE.right, CANDLE.top));
  ctx.fillStyle = CANDLE_WAX;
  ctx.fillRect(candleLeft.x, candleTop.y, candleTop.x - candleLeft.x, candleLeft.y - candleTop.y);
  ctx.fillStyle = CANDLE_WAX_SHADE;
  const candleMid = (candleLeft.x + candleTop.x) / 2;
  ctx.fillRect(candleMid, candleTop.y, candleTop.x - candleMid, candleLeft.y - candleTop.y);
  ctx.fillStyle = CANDLE_WAX;
  ctx.beginPath();
  ctx.ellipse(
    candleLeft.x + (candleTop.x - candleLeft.x) * HALF * HALF,
    candleTop.y + r * CANDLE.drip * 2,
    r * CANDLE.drip * HALF,
    r * CANDLE.drip,
    0,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
  const wick = at(DYNAMITE_CANDLE_WICK);
  ctx.strokeStyle = SOOT;
  ctx.lineWidth = r * CANDLE_CUP_FLARE * HALF;
  ctx.beginPath();
  ctx.moveTo(wick.x, candleTop.y);
  ctx.lineTo(wick.x, wick.y);
  ctx.stroke();
  const cupTop = candleLeft.y - r * CANDLE_CUP_HEIGHT;
  ctx.fillStyle = HELMET_TIN.dark;
  ctx.beginPath();
  ctx.moveTo(candleLeft.x - r * CANDLE_CUP_FLARE, cupTop);
  ctx.lineTo(candleTop.x + r * CANDLE_CUP_FLARE, cupTop);
  ctx.lineTo(candleTop.x, candleLeft.y + r * CANDLE_CUP_FLARE);
  ctx.lineTo(candleLeft.x, candleLeft.y + r * CANDLE_CUP_FLARE);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = HELMET_TIN.mid;
  traceDome();
  ctx.fill();
  shadeAcross(
    ctx,
    traceDome,
    at(HELMET.shadeFrom),
    at(HELMET.shadeTo),
    HELMET_TIN,
    HELMET_LIT_ALPHA,
    HELMET_SHADE_ALPHA,
  );
  withClip(ctx, traceDome, () => {
    const bandTop = r * HELMET_BAND_TOP;
    ctx.fillStyle = rgba(HELMET_TIN.shadow, HELMET_BAND_ALPHA);
    ctx.fillRect(-r * 2, bandTop, r * 4, r);
    const glint = HELMET_GLINT;
    const glintAt = at(glint.at);
    ctx.fillStyle = rgba(HELMET_TIN.rim, glint.alpha);
    ctx.beginPath();
    ctx.ellipse(glintAt.x, glintAt.y, r * glint.rx, r * glint.ry, glint.tilt, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    const dent = HELMET_DENT;
    const dentAt = at(dent.at);
    ctx.fillStyle = HELMET_TIN.rim;
    ctx.beginPath();
    ctx.ellipse(
      dentAt.x,
      dentAt.y + r * HELMET_DENT_LIP,
      r * dent.rx,
      r * dent.ry,
      dent.tilt,
      0,
      FULL_CIRCLE_ANGLE,
    );
    ctx.fill();
    ctx.fillStyle = HELMET_TIN.shadow;
    ctx.beginPath();
    ctx.ellipse(dentAt.x, dentAt.y, r * dent.rx, r * dent.ry, dent.tilt, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  });

  // The goggle strap round the dome, then the far lens peeping past the near one.
  const nearLens = at(GOGGLE_NEAR.at);
  const farLens = at(GOGGLE_FAR.at);
  withClip(ctx, traceDome, () => {
    ctx.strokeStyle = BANDOLIER_STRAP.dark;
    ctx.lineWidth = r * GOGGLE_STRAP_WIDTH;
    ctx.beginPath();
    ctx.moveTo(at(HELMET.backBase).x, nearLens.y + r * GOGGLE_STRAP_WIDTH);
    ctx.lineTo(nearLens.x, nearLens.y);
    ctx.stroke();
  });
  drawGoggleLens(ctx, farLens, r * GOGGLE_FAR.radius, style.palette.outline);
  drawGoggleLens(ctx, nearLens, r * GOGGLE_NEAR.radius, style.palette.outline);
}

function drawGoggleLens(ctx: Ctx, at: Pt, radius: number, outline: string): void {
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius * (1 + GOGGLE_RING * HALF), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = GOGGLE_BRASS.mid;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = GOGGLE_BRASS.rim;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, deg(180), deg(300));
  ctx.lineTo(at.x, at.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOGGLE_GLASS;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius * (1 - GOGGLE_RING), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = GOGGLE_GLINT;
  ctx.beginPath();
  ctx.arc(
    at.x + radius * GOGGLE_GLINT_AT.x,
    at.y + radius * GOGGLE_GLINT_AT.y,
    radius * GOGGLE_GLINT_RADIUS,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
}

function drawDynamiteHead(ctx: Ctx, style: GoblinStyle): void {
  drawSootedFace(ctx, style);
  drawMinerHelmet(ctx, style);
}

// ── Dynamite goblin: apron, trousers and bandolier ───────────────────────────

/** The apron, in torso lengths (y) and hip half-widths (x) in spine space. */
const APRON = {
  top: -0.78,
  topFront: 1.25,
  bellyFront: 1.75,
  hemFront: 1.45,
  hem: 0.95,
  back: -0.45,
  bibBack: 0.15,
} as const;
/** The torn hem's points, as shares of the hem depth. */
const APRON_TEARS = [1, 0.82, 1.06, 0.78, 0.98, 0.84] as const;
const APRON_CHAR_FROM = 0.45;
const APRON_CHAR_ALPHA = 0.85;
const APRON_LIT_ALPHA = 0.55;
const APRON_SHADE_ALPHA = 0.6;
/** The burnt-through holes near the hem: centre (shares of width and depth) and radius. */
const APRON_HOLES: ReadonlyArray<{ readonly x: number; readonly y: number; readonly r: number }> = [
  { x: 0.55, y: 0.72, r: 0.07 },
  { x: 0.18, y: 0.86, r: 0.05 },
];
const APRON_HOLE_RIM = 0.4;
/** The waist tie and the neck strap, in torso lengths. */
const APRON_TIE_HEIGHT = 0.07;
const APRON_TIE_Y = -0.12;
const APRON_STRAP_WIDTH = 0.06;

function drawScorchedApron(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const { leather } = style.palette;
  const t = p.torsoLength;
  const h = p.hipHalfWidth;
  const front = (share: number): number => h * share + p.bellyBulge;
  const hemY = t * APRON.hem;
  const back = h * APRON.back;
  const traceApron = (): void => {
    ctx.beginPath();
    ctx.moveTo(h * APRON.bibBack, t * APRON.top);
    ctx.lineTo(front(APRON.topFront), t * APRON.top);
    ctx.quadraticCurveTo(front(APRON.bellyFront), t * APRON_TIE_Y, front(APRON.hemFront), hemY);
    for (let i = 0; i < APRON_TEARS.length; i++) {
      const share = i / (APRON_TEARS.length - 1);
      ctx.lineTo(lerp(front(APRON.hemFront), back, share), hemY * APRON_TEARS[i]);
    }
    ctx.lineTo(back, t * APRON_TIE_Y);
    ctx.lineTo(h * APRON.bibBack, t * APRON_TIE_Y);
    ctx.closePath();
  };
  ctx.fillStyle = leather.mid;
  traceApron();
  ctx.fill();
  withClip(ctx, traceApron, () => {
    const width = front(APRON.bellyFront) - back;
    ctx.fillStyle = rgba(leather.rim, APRON_LIT_ALPHA);
    ctx.fillRect(back, t * APRON.top, width * HALF * HALF, hemY * 2);
    ctx.fillStyle = rgba(leather.shadow, APRON_SHADE_ALPHA);
    ctx.fillRect(back + width * HALF, t * APRON.top, width, hemY * 2);
    const char = ctx.createLinearGradient(0, hemY * APRON_CHAR_FROM, 0, hemY);
    char.addColorStop(0, rgba(CHAR, 0));
    char.addColorStop(1, rgba(CHAR, APRON_CHAR_ALPHA));
    ctx.fillStyle = char;
    ctx.fillRect(back, hemY * APRON_CHAR_FROM, width, hemY);
    for (const hole of APRON_HOLES) {
      const at = pt(lerp(back, front(APRON.hemFront), hole.x), hemY * hole.y);
      ctx.fillStyle = EMBER_EDGE;
      ctx.beginPath();
      ctx.arc(at.x, at.y, t * hole.r * (1 + APRON_HOLE_RIM), 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = CHAR;
      ctx.beginPath();
      ctx.arc(at.x, at.y, t * hole.r, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
    }
    ctx.fillStyle = leather.shadow;
    ctx.fillRect(back, t * APRON_TIE_Y, width, t * APRON_TIE_HEIGHT);
  });
  ctx.strokeStyle = leather.dark;
  ctx.lineWidth = t * APRON_STRAP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(h * APRON.bibBack, t * APRON.top);
  ctx.lineTo(-p.shoulderHalfWidth * HALF, -t);
  ctx.stroke();
}

/** Ragged trouser legs to just under the knee, tattered at the hem. */
const TROUSER_WIDTH = 1.75;
const TROUSER_HEM = 0.38;
const TROUSER_KNEE = 0.92;
const TROUSER_TATTERS = 3;
const TROUSER_TATTER_DROP = 0.5;

function drawRaggedTrouserLeg(
  ctx: Ctx,
  chain: BoneChain,
  style: GoblinStyle,
  near: boolean,
  cloth: Ramp,
): void {
  const half = (style.proportions.legWidth * TROUSER_WIDTH) / 2;
  const hem = mixPt(chain.joint, chain.end, TROUSER_HEM);
  const fill = near ? cloth.mid : mix(cloth.dark, cloth.mid, HALF);
  fillCapsule(ctx, chain.anchor, chain.joint, half, half * TROUSER_KNEE, fill);
  fillCapsule(ctx, chain.joint, hem, half * TROUSER_KNEE, half, fill);
  const along = Math.atan2(chain.end.y - chain.joint.y, chain.end.x - chain.joint.x);
  const across = along + Math.PI / 2;
  ctx.fillStyle = fill;
  for (let i = 0; i < TROUSER_TATTERS; i++) {
    const share = (i + HALF) / TROUSER_TATTERS - HALF;
    const root = offset(
      hem,
      Math.cos(across) * half * share * 2,
      Math.sin(across) * half * share * 2,
    );
    const drop = half * (TROUSER_TATTER_DROP + (i % 2) * TROUSER_TATTER_DROP);
    const tip = offset(root, Math.cos(along) * drop, Math.sin(along) * drop);
    const side = half / TROUSER_TATTERS;
    ctx.beginPath();
    ctx.moveTo(root.x + Math.cos(across) * side, root.y + Math.sin(across) * side);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(root.x - Math.cos(across) * side, root.y - Math.sin(across) * side);
    ctx.closePath();
    ctx.fill();
  }
  if (!near) return;
  ctx.fillStyle = rgba(cloth.rim, HALF);
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * half * HALF, LIGHT.y * half * HALF);
  fillCapsule(
    ctx,
    lit(mixPt(chain.anchor, chain.joint, 0.2)),
    lit(mixPt(chain.anchor, chain.joint, 0.8)),
    half * 0.22,
    half * 0.18,
    rgba(cloth.rim, HALF),
  );
}

/**
 * The bandolier, from the back of the shoulder to the front of the hip, in
 * torso lengths (y) and shoulder/hip half-widths (x). The sticks ride in loops
 * across it, standing out square to the strap.
 */
const BANDOLIER = {
  shoulderX: -1.05,
  shoulderY: -1.0,
  hipX: 1.35,
  hipY: -0.06,
  width: 0.13,
} as const;
/** Where each stick sits along the strap, from the shoulder end. */
const BANDOLIER_STICKS = [0.08, 0.32, 0.56, 0.8] as const;
/**
 * Each stick is longer than the strap is wide, square across it, so the ends
 * stand clear of the chest and back as a row of spikes the silhouette keeps.
 */
const BANDOLIER_STICK_LENGTH = 0.15;
const BANDOLIER_STICK_HALF_WIDTH = 0.028;
/** Sticks stand a little off square, alternately, as stuffed loops do. */
const BANDOLIER_STICK_SPLAY = deg(12);
const BANDOLIER_FUSE_LENGTH = 0.035;
const BANDOLIER_LOOP_WIDTH = 0.018;

function drawBandolier(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const from = pt(p.shoulderHalfWidth * BANDOLIER.shoulderX, t * BANDOLIER.shoulderY);
  const to = pt(p.hipHalfWidth * BANDOLIER.hipX + p.bellyBulge, t * BANDOLIER.hipY);
  const strapAngle = Math.atan2(to.y - from.y, to.x - from.x);
  const outward = strapAngle - Math.PI / 2;
  const { outline } = style.palette;

  const sticks = BANDOLIER_STICKS.map((share, index) => ({
    at: mixPt(from, to, share),
    angle: outward + (index % 2 === 0 ? 1 : -1) * BANDOLIER_STICK_SPLAY,
  }));
  for (const stick of sticks) {
    ctx.save();
    ctx.translate(stick.at.x, stick.at.y);
    ctx.rotate(stick.angle);
    const length = BANDOLIER_STICK_LENGTH;
    const half = BANDOLIER_STICK_HALF_WIDTH;
    ctx.strokeStyle = DYNAMITE_FUSE_CORD;
    ctx.lineWidth = half * HALF;
    ctx.beginPath();
    ctx.moveTo(length * HALF, 0);
    ctx.lineTo(length * HALF + BANDOLIER_FUSE_LENGTH, -half * HALF);
    ctx.stroke();
    ctx.fillStyle = outline;
    ctx.fillRect(-length * HALF - 0.01, -half - 0.01, length + 0.02, half * 2 + 0.02);
    ctx.fillStyle = DYNAMITE_PAPER.mid;
    ctx.fillRect(-length * HALF, -half, length, half * 2);
    ctx.fillStyle = rgba(DYNAMITE_PAPER.rim, HALF);
    ctx.fillRect(-length * HALF, -half, length, half * HALF);
    ctx.fillStyle = rgba(DYNAMITE_PAPER.shadow, HALF);
    ctx.fillRect(-length * HALF, half * HALF, length, half * HALF);
    ctx.fillStyle = DYNAMITE_CRIMP;
    ctx.fillRect(length * HALF - BANDOLIER_LOOP_WIDTH, -half, BANDOLIER_LOOP_WIDTH, half * 2);
    ctx.restore();
  }

  ctx.lineCap = 'round';
  ctx.strokeStyle = BANDOLIER_STRAP.dark;
  ctx.lineWidth = t * BANDOLIER.width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = BANDOLIER_STRAP.light;
  ctx.lineWidth = t * BANDOLIER.width * HALF * HALF;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - t * BANDOLIER.width * HALF * HALF);
  ctx.lineTo(to.x, to.y - t * BANDOLIER.width * HALF * HALF);
  ctx.stroke();
  // The loops round each stick sit over the strap.
  for (const stick of sticks) {
    ctx.save();
    ctx.translate(stick.at.x, stick.at.y);
    ctx.rotate(strapAngle);
    ctx.fillStyle = BANDOLIER_STRAP.shadow;
    ctx.fillRect(
      -BANDOLIER_STICK_HALF_WIDTH * (1 + HALF),
      -t * BANDOLIER.width * HALF,
      BANDOLIER_STICK_HALF_WIDTH * 3,
      t * BANDOLIER.width,
    );
    ctx.restore();
  }
}

const DYNAMITE_OUTFIT: GoblinOutfit = {
  head: drawDynamiteHead,
  hips: drawScorchedApron,
  leg: (ctx, chain, style, near) => {
    drawRaggedTrouserLeg(ctx, chain, style, near, RAGGED_TROUSERS);
  },
  overTorso: drawBandolier,
};

// ── Black powder goblin: cap and scarf ───────────────────────────────────────

/** The floppy cap: a low crown and a wide brim drooping at both ends, in head units. */
const SAPPER_CAP = {
  backDroop: pt(-1.18, -0.36),
  backBrim: pt(-1.02, -0.56),
  crownBack: pt(-0.9, -0.64),
  crownBackControl: pt(-0.98, -1.16),
  crownTopControl: pt(-0.2, -1.26),
  crownTop: pt(0.3, -1.12),
  crownFrontControl: pt(0.8, -1.02),
  crownFront: pt(0.9, -0.62),
  frontBrim: pt(1.18, -0.54),
  frontDroopControl: pt(1.36, -0.46),
  frontDroop: pt(1.22, -0.38),
  underFront: pt(1.0, -0.44),
  underControl: pt(0.0, -0.6),
  underBack: pt(-1.1, -0.44),
  shadeFrom: pt(-1.0, -1.3),
  shadeTo: pt(1.2, -0.2),
} as const;
const CAP_BAND = { top: -0.76, bottom: -0.62 } as const;
const CAP_LIT_ALPHA = 0.5;
const CAP_SHADE_ALPHA = 0.6;
const BRIM_SHADOW = { at: pt(0.55, -0.22), rx: 0.55, ry: 0.14, alpha: 0.7 } as const;

/**
 * The scarf pulled up over the nose, in head units: it covers the face from
 * under the eyes to the jaw and drapes over the hooked nose, which becomes a
 * blunt cloth snout. The two knotted tails hang off the nape.
 */
const SCARF = {
  topBack: pt(0.15, 0.26),
  topFront: pt(0.75, 0.2),
  noseControl: pt(1.0, 0.24),
  bottomFront: pt(0.8, 0.86),
  chinControl: pt(0.55, 1.12),
  jawBack: pt(-0.25, 0.92),
  napeControl: pt(-0.3, 0.3),
} as const;
/** How much of the nose's projection the cloth drapes over: it pulls the hook flat. */
const SCARF_NOSE_SHARE = 0.45;
const SCARF_FOLDS = 3;
const SCARF_FOLD_WIDTH = 0.05;
const SCARF_LIT_ALPHA = 0.5;
const SCARF_SHADE_ALPHA = 0.6;
const SCARF_KNOT = { at: pt(-0.62, 0.62), radius: 0.16 } as const;
const SCARF_TAILS: ReadonlyArray<{ readonly to: Pt; readonly width: number }> = [
  { to: pt(-1.18, 1.0), width: 0.16 },
  { to: pt(-0.98, 1.18), width: 0.13 },
];

function drawSapperCap(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const at = (point: Pt): Pt => headPoint(p, point);
  const c = SAPPER_CAP;
  const traceCap = (): void => {
    const backDroop = at(c.backDroop);
    const backBrim = at(c.backBrim);
    const crownBack = at(c.crownBack);
    const crownBackControl = at(c.crownBackControl);
    const crownTopControl = at(c.crownTopControl);
    const crownTop = at(c.crownTop);
    const crownFrontControl = at(c.crownFrontControl);
    const crownFront = at(c.crownFront);
    const frontBrim = at(c.frontBrim);
    const frontDroopControl = at(c.frontDroopControl);
    const frontDroop = at(c.frontDroop);
    const underFront = at(c.underFront);
    const underControl = at(c.underControl);
    const underBack = at(c.underBack);
    ctx.beginPath();
    ctx.moveTo(backDroop.x, backDroop.y);
    ctx.lineTo(backBrim.x, backBrim.y);
    ctx.lineTo(crownBack.x, crownBack.y);
    ctx.bezierCurveTo(
      crownBackControl.x,
      crownBackControl.y,
      crownTopControl.x,
      crownTopControl.y,
      crownTop.x,
      crownTop.y,
    );
    ctx.quadraticCurveTo(crownFrontControl.x, crownFrontControl.y, crownFront.x, crownFront.y);
    ctx.lineTo(frontBrim.x, frontBrim.y);
    ctx.quadraticCurveTo(frontDroopControl.x, frontDroopControl.y, frontDroop.x, frontDroop.y);
    ctx.lineTo(underFront.x, underFront.y);
    ctx.quadraticCurveTo(underControl.x, underControl.y, underBack.x, underBack.y);
    ctx.closePath();
  };
  const shadowAt = at(BRIM_SHADOW.at);
  ctx.fillStyle = rgba(style.palette.skin.shadow, BRIM_SHADOW.alpha);
  ctx.beginPath();
  ctx.ellipse(
    shadowAt.x,
    shadowAt.y,
    r * BRIM_SHADOW.rx,
    r * BRIM_SHADOW.ry,
    0,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
  ctx.fillStyle = FELT_CAP.mid;
  traceCap();
  ctx.fill();
  shadeAcross(
    ctx,
    traceCap,
    at(c.shadeFrom),
    at(c.shadeTo),
    FELT_CAP,
    CAP_LIT_ALPHA,
    CAP_SHADE_ALPHA,
  );
  withClip(ctx, traceCap, () => {
    ctx.fillStyle = FELT_CAP.shadow;
    ctx.fillRect(-r * 2, r * CAP_BAND.top, r * 4, r * (CAP_BAND.bottom - CAP_BAND.top));
  });
}

function drawScarf(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const { cloth } = style.palette;
  const at = (point: Pt): Pt => headPoint(p, point);
  const noseTip = pt(
    at(SCARF.noseControl).x + p.noseProjection * SCARF_NOSE_SHARE,
    at(SCARF.noseControl).y,
  );
  const s = SCARF;
  const traceScarf = (): void => {
    const topBack = at(s.topBack);
    const topFront = at(s.topFront);
    const bottomFront = at(s.bottomFront);
    const chinControl = at(s.chinControl);
    const jawBack = at(s.jawBack);
    const napeControl = at(s.napeControl);
    ctx.beginPath();
    ctx.moveTo(topBack.x, topBack.y);
    ctx.lineTo(topFront.x, topFront.y);
    ctx.quadraticCurveTo(
      noseTip.x,
      noseTip.y,
      bottomFront.x + p.noseProjection * SCARF_NOSE_SHARE,
      bottomFront.y,
    );
    ctx.quadraticCurveTo(chinControl.x, chinControl.y, jawBack.x, jawBack.y);
    ctx.quadraticCurveTo(napeControl.x, napeControl.y, topBack.x, topBack.y);
    ctx.closePath();
  };
  for (const tail of SCARF_TAILS) {
    const knot = at(SCARF_KNOT.at);
    const end = at(tail.to);
    fillCapsule(ctx, knot, end, r * tail.width, r * tail.width * HALF, cloth.dark);
  }
  ctx.fillStyle = cloth.mid;
  traceScarf();
  ctx.fill();
  shadeAcross(
    ctx,
    traceScarf,
    at(pt(0, 0)),
    pt(noseTip.x, at(s.chinControl).y),
    cloth,
    SCARF_LIT_ALPHA,
    SCARF_SHADE_ALPHA,
  );
  withClip(ctx, traceScarf, () => {
    ctx.strokeStyle = cloth.shadow;
    ctx.lineWidth = r * SCARF_FOLD_WIDTH;
    for (let i = 1; i <= SCARF_FOLDS; i++) {
      const y = lerp(s.topFront.y, s.bottomFront.y, i / (SCARF_FOLDS + 1));
      const back = at(pt(s.topBack.x, y));
      const front = at(pt(s.noseControl.x, y));
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.quadraticCurveTo(
        (back.x + front.x) / 2,
        back.y + r * SCARF_FOLD_WIDTH * 2,
        front.x,
        front.y,
      );
      ctx.stroke();
    }
  });
  const knot = at(SCARF_KNOT.at);
  ctx.fillStyle = cloth.light;
  ctx.beginPath();
  ctx.arc(knot.x, knot.y, r * SCARF_KNOT.radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

function drawBlackPowderHead(ctx: Ctx, style: GoblinStyle): void {
  drawScarf(ctx, style);
  drawSapperCap(ctx, style);
}

// ── Black powder goblin: gambeson, breeches, sleeves and slow-match ──────────

const QUILT_COLUMNS = 5;
const QUILT_ROWS = 4;
const QUILT_LINE_WIDTH = 0.012;
const QUILT_ALPHA = 0.55;
/** The powder stains on the gambeson: centre (shares of span and torso) and radius. */
const POWDER_STAINS: ReadonlyArray<{ readonly x: number; readonly y: number; readonly r: number }> =
  [
    { x: 0.7, y: -0.35, r: 0.14 },
    { x: 0.35, y: -0.72, r: 0.1 },
    { x: 0.82, y: -0.15, r: 0.09 },
  ];
const POWDER_STAIN_ALPHA = 0.55;
const GAMBESON_LIT_ALPHA = 0.85;
const GAMBESON_SHADE_ALPHA = 0.7;
/** The torso shading box past the torso's own extent, in torso lengths. */
const GAMBESON_REACH = 1.5;
/** The stand collar at the neck, in torso lengths. */
const COLLAR = { height: 0.16, back: -0.85, front: 0.75 } as const;

function drawGambeson(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const span = p.hipHalfWidth + p.bellyBulge * 2;
  ctx.fillStyle = GAMBESON.mid;
  ctx.fillRect(-span * GAMBESON_REACH, -t * GAMBESON_REACH, span * GAMBESON_REACH * 2, t * 2);
  const shading = ctx.createLinearGradient(-span, -t, span, 0);
  shading.addColorStop(0, rgba(GAMBESON.rim, GAMBESON_LIT_ALPHA));
  shading.addColorStop(HALF, rgba(GAMBESON.mid, 0));
  shading.addColorStop(1, rgba(GAMBESON.shadow, GAMBESON_SHADE_ALPHA));
  ctx.fillStyle = shading;
  ctx.fillRect(-span * GAMBESON_REACH, -t * GAMBESON_REACH, span * GAMBESON_REACH * 2, t * 2);
  for (const stain of POWDER_STAINS) {
    const at = pt(lerp(-span, span, stain.x), t * stain.y);
    const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, t * stain.r);
    gradient.addColorStop(0, rgba(POWDER_STAIN, POWDER_STAIN_ALPHA));
    gradient.addColorStop(1, rgba(POWDER_STAIN, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(at.x, at.y, t * stain.r, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(GAMBESON.shadow, QUILT_ALPHA);
  ctx.lineWidth = QUILT_LINE_WIDTH;
  for (let i = 1; i < QUILT_COLUMNS; i++) {
    const x = lerp(-span, span, i / QUILT_COLUMNS);
    ctx.beginPath();
    ctx.moveTo(x, -t * GAMBESON_REACH);
    ctx.quadraticCurveTo(x + span * HALF * HALF * HALF, -t * HALF, x, t * HALF);
    ctx.stroke();
  }
  for (let i = 1; i < QUILT_ROWS; i++) {
    const y = -t * (i / QUILT_ROWS);
    ctx.beginPath();
    ctx.moveTo(-span * GAMBESON_REACH, y);
    ctx.lineTo(span * GAMBESON_REACH, y);
    ctx.stroke();
  }
  ctx.fillStyle = GAMBESON.light;
  ctx.fillRect(
    p.shoulderHalfWidth * COLLAR.back,
    -t - t * COLLAR.height * HALF,
    p.shoulderHalfWidth * (COLLAR.front - COLLAR.back),
    t * COLLAR.height,
  );
}

/** The gambeson's padded skirt over the hips, in torso lengths and hip half-widths. */
const SKIRT = {
  top: -0.3,
  hem: 0.42,
  back: -1.35,
  hemBack: -1.5,
  front: 1.25,
  hemFront: 1.45,
} as const;
const SKIRT_PLEATS = 4;
const BELT = { top: -0.32, height: 0.1, buckleX: 0.95, buckle: 0.07 } as const;
/** The powder horn hangs off the back hip on a cord, its curl standing clear of the skirt. */
const HORN = {
  cordFrom: pt(-0.9, -0.24),
  mouth: pt(-1.75, 0.1),
  curlControl: pt(-2.25, 0.62),
  tip: pt(-1.35, 0.62),
  mouthHalf: 0.075,
  tipHalf: 0.012,
  segments: 8,
  capShare: 0.18,
  tipShare: 0.25,
  cordWidth: 0.012,
} as const;

function quadraticPoint(from: Pt, via: Pt, to: Pt, t: number): Pt {
  return mixPt(mixPt(from, via, t), mixPt(via, to, t), t);
}

function drawPowderHorn(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const h = p.hipHalfWidth;
  const { bone, outline } = style.palette;
  const at = (point: Pt): Pt => pt(h * point.x, t * point.y);
  const mouth = at(HORN.mouth);
  const curl = at(HORN.curlControl);
  const tip = at(HORN.tip);
  ctx.strokeStyle = HEMP.dark;
  ctx.lineWidth = HORN.cordWidth;
  ctx.beginPath();
  const cordFrom = at(HORN.cordFrom);
  ctx.moveTo(cordFrom.x, cordFrom.y);
  ctx.lineTo(mouth.x, mouth.y);
  ctx.stroke();
  const tracePart = (from: number, to: number, grow: number): void => {
    ctx.beginPath();
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= HORN.segments; i++) {
      const share = lerp(from, to, i / HORN.segments);
      const centre = quadraticPoint(mouth, curl, tip, share);
      const ahead = quadraticPoint(mouth, curl, tip, Math.min(1, share + 1 / HORN.segments));
      const behind = quadraticPoint(mouth, curl, tip, Math.max(0, share - 1 / HORN.segments));
      const heading = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
      const half = t * lerp(HORN.mouthHalf, HORN.tipHalf, share) + grow;
      left.push(offset(centre, -Math.sin(heading) * half, Math.cos(heading) * half));
      right.push(offset(centre, Math.sin(heading) * half, -Math.cos(heading) * half));
    }
    ctx.moveTo(left[0].x, left[0].y);
    for (const point of left) ctx.lineTo(point.x, point.y);
    for (const point of right.reverse()) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  };
  const PART_OUTLINE = 0.012;
  ctx.fillStyle = outline;
  tracePart(0, 1, PART_OUTLINE);
  ctx.fill();
  ctx.fillStyle = bone.light;
  tracePart(0, 1, 0);
  ctx.fill();
  ctx.fillStyle = rgba(bone.shadow, HALF);
  tracePart(HALF, 1, 0);
  ctx.fill();
  ctx.fillStyle = HORN_TIP;
  tracePart(1 - HORN.tipShare, 1, 0);
  ctx.fill();
  ctx.fillStyle = BRASS_CAP;
  tracePart(0, HORN.capShare, 0);
  ctx.fill();
}

function drawGambesonSkirt(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const h = p.hipHalfWidth;
  const front = (share: number): number => h * share + p.bellyBulge;
  const traceSkirt = (): void => {
    ctx.beginPath();
    ctx.moveTo(h * SKIRT.back, t * SKIRT.top);
    ctx.lineTo(front(SKIRT.front), t * SKIRT.top);
    ctx.lineTo(front(SKIRT.hemFront), t * SKIRT.hem);
    ctx.lineTo(h * SKIRT.hemBack, t * SKIRT.hem);
    ctx.closePath();
  };
  drawPowderHorn(ctx, style);
  ctx.fillStyle = GAMBESON.mid;
  traceSkirt();
  ctx.fill();
  shadeAcross(
    ctx,
    traceSkirt,
    pt(h * SKIRT.hemBack, t * SKIRT.top),
    pt(front(SKIRT.hemFront), t * SKIRT.hem),
    GAMBESON,
    GAMBESON_LIT_ALPHA,
    GAMBESON_SHADE_ALPHA,
  );
  withClip(ctx, traceSkirt, () => {
    ctx.strokeStyle = rgba(GAMBESON.shadow, QUILT_ALPHA);
    ctx.lineWidth = QUILT_LINE_WIDTH;
    for (let i = 1; i < SKIRT_PLEATS; i++) {
      const share = i / SKIRT_PLEATS;
      ctx.beginPath();
      ctx.moveTo(lerp(h * SKIRT.back, front(SKIRT.front), share), t * SKIRT.top);
      ctx.lineTo(lerp(h * SKIRT.hemBack, front(SKIRT.hemFront), share), t * SKIRT.hem);
      ctx.stroke();
    }
  });
  const { leather } = style.palette;
  ctx.fillStyle = leather.dark;
  ctx.fillRect(h * SKIRT.back, t * BELT.top, front(SKIRT.front) - h * SKIRT.back, t * BELT.height);
  ctx.fillStyle = BRASS_CAP;
  ctx.fillRect(
    front(BELT.buckleX) - t * BELT.buckle * HALF,
    t * BELT.top,
    t * BELT.buckle,
    t * BELT.height,
  );
}

/** Baggy breeches to the knee, with a wrap round the shin below. */
const BREECH_WIDTH = 1.7;
const BREECH_KNEE = 1.0;
const BREECH_CUFF = 0.12;
const SHIN_WRAP_FROM = 0.3;
const SHIN_WRAP_TO = 0.78;
const SHIN_WRAP_WIDTH = 1.15;
const SHIN_WRAP_BANDS = 3;

function drawBreechesLeg(ctx: Ctx, chain: BoneChain, style: GoblinStyle, near: boolean): void {
  const half = (style.proportions.legWidth * BREECH_WIDTH) / 2;
  const cuff = mixPt(chain.joint, chain.end, BREECH_CUFF);
  const fill = near ? BREECHES.mid : mix(BREECHES.dark, BREECHES.mid, HALF);
  const wrapFrom = mixPt(chain.joint, chain.end, SHIN_WRAP_FROM);
  const wrapTo = mixPt(chain.joint, chain.end, SHIN_WRAP_TO);
  const wrapHalf = (style.proportions.legWidth * SHIN_WRAP_WIDTH) / 2;
  fillCapsule(
    ctx,
    wrapFrom,
    wrapTo,
    wrapHalf,
    wrapHalf * HALF * (1 + HALF),
    near ? HEMP.mid : HEMP.dark,
  );
  ctx.strokeStyle = HEMP.shadow;
  ctx.lineWidth = wrapHalf * HALF * HALF;
  for (let i = 1; i <= SHIN_WRAP_BANDS; i++) {
    const at = mixPt(wrapFrom, wrapTo, i / (SHIN_WRAP_BANDS + 1));
    ctx.beginPath();
    ctx.moveTo(at.x - wrapHalf, at.y - wrapHalf * HALF);
    ctx.lineTo(at.x + wrapHalf, at.y + wrapHalf * HALF);
    ctx.stroke();
  }
  fillCapsule(ctx, chain.anchor, chain.joint, half, half * BREECH_KNEE, fill);
  fillCapsule(ctx, chain.joint, cuff, half * BREECH_KNEE, half * HALF * (1 + HALF), fill);
  if (!near) return;
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * half * HALF, LIGHT.y * half * HALF);
  fillCapsule(
    ctx,
    lit(mixPt(chain.anchor, chain.joint, 0.15)),
    lit(mixPt(chain.anchor, chain.joint, 0.85)),
    half * 0.25,
    half * 0.2,
    rgba(BREECHES.rim, HALF),
  );
}

/** The quilted sleeve over the upper arm, a little wider than the arm. */
const SLEEVE_WIDTH = 1.45;
const SLEEVE_REACH = 0.5;

/**
 * The slow-match: a hemp cord coiled three times round the far forearm, the
 * arm that cradles the bomb, its smouldering end poking out of the heel of the
 * fist. The ember and its smoke sit right under the bomb, which is the read:
 * fire held next to powder.
 */
const MATCH_COILS = 3;
const MATCH_FROM = 0.25;
const MATCH_TO = 0.75;
const MATCH_WIDTH = 0.026;
const MATCH_COIL_SLANT = 0.6;
/**
 * Where the burning end pokes out of the fist, in the hand's own frame: back
 * out of the heel of the fist, away from whatever the fingers hold.
 */
const MATCH_END_REACH = -0.07;
const MATCH_END_DROP = 0.05;

/** Where the slow-match's burning end is, for a fist at `hand` turned to `wristAngle`. */
export function slowMatchEmberAt(hand: Pt, wristAngle: number): Pt {
  const reach = rotatePt(pt(MATCH_END_REACH, MATCH_END_DROP), wristAngle);
  return offset(hand, reach.x, reach.y);
}

function drawBlackPowderArm(
  ctx: Ctx,
  chain: BoneChain,
  width: number,
  wristAngle: number,
  style: GoblinStyle,
  near: boolean,
): void {
  const sleeveHalf = (width * SLEEVE_WIDTH) / 2;
  const sleeveEnd = mixPt(chain.anchor, chain.joint, SLEEVE_REACH);
  fillCapsule(
    ctx,
    chain.anchor,
    sleeveEnd,
    sleeveHalf,
    sleeveHalf * (HALF + HALF * HALF),
    near ? GAMBESON.dark : GAMBESON.shadow,
  );
  if (near) return;

  const half = width / 2;
  const heading = Math.atan2(chain.end.y - chain.joint.y, chain.end.x - chain.joint.x);
  const across = pt(
    -Math.sin(heading) * half * (1 + HALF * HALF),
    Math.cos(heading) * half * (1 + HALF * HALF),
  );
  const slant = pt(
    Math.cos(heading) * half * MATCH_COIL_SLANT,
    Math.sin(heading) * half * MATCH_COIL_SLANT,
  );
  ctx.lineCap = 'round';
  for (let i = 0; i < MATCH_COILS; i++) {
    const at = mixPt(chain.joint, chain.end, lerp(MATCH_FROM, MATCH_TO, i / (MATCH_COILS - 1)));
    ctx.strokeStyle = style.palette.outline;
    ctx.lineWidth = MATCH_WIDTH * (1 + HALF);
    ctx.beginPath();
    ctx.moveTo(at.x + across.x - slant.x, at.y + across.y - slant.y);
    ctx.lineTo(at.x - across.x + slant.x, at.y - across.y + slant.y);
    ctx.stroke();
    ctx.strokeStyle = HEMP.light;
    ctx.lineWidth = MATCH_WIDTH;
    ctx.beginPath();
    ctx.moveTo(at.x + across.x - slant.x, at.y + across.y - slant.y);
    ctx.lineTo(at.x - across.x + slant.x, at.y - across.y + slant.y);
    ctx.stroke();
  }
  const ember = slowMatchEmberAt(chain.end, wristAngle);
  ctx.strokeStyle = HEMP.mid;
  ctx.lineWidth = MATCH_WIDTH;
  ctx.beginPath();
  const lastCoil = mixPt(chain.joint, chain.end, MATCH_TO);
  ctx.moveTo(lastCoil.x, lastCoil.y);
  ctx.quadraticCurveTo(chain.end.x, chain.end.y, ember.x, ember.y);
  ctx.stroke();
}

// ── Black powder goblin: the keg on its back ─────────────────────────────────

/**
 * The powder keg, in tile units from the top of the spine: behind the back,
 * its mouth up over the shoulder line so the bomb peeking out of it tops the
 * silhouette's hump.
 */
const KEG = {
  backOffset: 1.95,
  rise: -0.16,
  height: 0.42,
  endHalfWidth: 0.14,
  bellyHalfWidth: 0.19,
  tilt: deg(-6),
  bands: [0.12, 0.5, 0.88] as const,
  bandWidth: 0.028,
  staves: 4,
  staveWidth: 0.008,
  mouthDepth: 0.04,
  bombRadius: 0.12,
  bombRise: 0.08,
} as const;
const KEG_LIT_ALPHA = 0.55;
const KEG_SHADE_ALPHA = 0.7;
/**
 * The one bomb peeking out of the keg's open mouth, fuse up: a round black top
 * with a fuse on the hump is what says the keg holds bombs and not beer.
 */
const KEG_BOMB_FUSE_LEAN = deg(-12);
/** A peeking bomb's fuse, as a share of its radius. */
const PEEKING_FUSE_LENGTH = 1.1;
const PEEKING_FUSE_WIDTH = 0.028;
const PEEKING_OUTLINE = 0.016;

function drawPeekingBomb(
  ctx: Ctx,
  at: Pt,
  radius: number,
  fuseLean: number,
  outline: string,
): void {
  const fuseEnd = offset(
    at,
    Math.sin(fuseLean) * radius * (1 + PEEKING_FUSE_LENGTH),
    -Math.cos(fuseLean) * radius * (1 + PEEKING_FUSE_LENGTH),
  );
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = PEEKING_FUSE_WIDTH + PEEKING_OUTLINE * 2;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(fuseEnd.x, fuseEnd.y);
  ctx.stroke();
  ctx.strokeStyle = HEMP.light;
  ctx.lineWidth = PEEKING_FUSE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(fuseEnd.x, fuseEnd.y);
  ctx.stroke();
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius + PEEKING_OUTLINE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = BOMB_BLACK;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = BOMB_SHEEN;
  ctx.beginPath();
  ctx.arc(
    at.x + LIGHT.x * radius * HALF,
    at.y + LIGHT.y * radius * HALF,
    radius * HALF * HALF,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
}

/** The rope harness: over the shoulder from the keg's mouth. */
const HARNESS_WIDTH = 0.034;

function drawPowderKeg(ctx: Ctx, spineTop: Pt, lean: number, style: GoblinStyle): void {
  const p = style.proportions;
  const { wood, outline } = style.palette;
  ctx.save();
  ctx.translate(spineTop.x, spineTop.y);
  ctx.rotate(lean + KEG.tilt);
  ctx.translate(-p.shoulderHalfWidth * KEG.backOffset, -KEG.rise);
  const top = 0;
  const bottom = KEG.height;
  const traceKeg = (): void => {
    ctx.beginPath();
    ctx.moveTo(-KEG.endHalfWidth, top);
    ctx.lineTo(KEG.endHalfWidth, top);
    ctx.quadraticCurveTo(
      KEG.bellyHalfWidth * 2 - KEG.endHalfWidth,
      bottom * HALF,
      KEG.endHalfWidth,
      bottom,
    );
    ctx.lineTo(-KEG.endHalfWidth, bottom);
    ctx.quadraticCurveTo(
      -(KEG.bellyHalfWidth * 2 - KEG.endHalfWidth),
      bottom * HALF,
      -KEG.endHalfWidth,
      top,
    );
    ctx.closePath();
  };

  drawPeekingBomb(ctx, pt(0, top - KEG.bombRise), KEG.bombRadius, KEG_BOMB_FUSE_LEAN, outline);

  ctx.fillStyle = wood.mid;
  traceKeg();
  ctx.fill();
  shadeAcross(
    ctx,
    traceKeg,
    pt(-KEG.bellyHalfWidth, top),
    pt(KEG.bellyHalfWidth, bottom),
    wood,
    KEG_LIT_ALPHA,
    KEG_SHADE_ALPHA,
  );
  withClip(ctx, traceKeg, () => {
    ctx.strokeStyle = rgba(wood.shadow, HALF);
    ctx.lineWidth = KEG.staveWidth;
    for (let i = 1; i < KEG.staves; i++) {
      const x = lerp(-KEG.bellyHalfWidth, KEG.bellyHalfWidth, i / KEG.staves);
      ctx.beginPath();
      ctx.moveTo(x * (KEG.endHalfWidth / KEG.bellyHalfWidth), top);
      ctx.quadraticCurveTo(
        x * (1 + HALF * HALF),
        bottom * HALF,
        x * (KEG.endHalfWidth / KEG.bellyHalfWidth),
        bottom,
      );
      ctx.stroke();
    }
    for (const band of KEG.bands) {
      ctx.fillStyle = KEG_IRON;
      ctx.fillRect(
        -KEG.bellyHalfWidth,
        bottom * band - KEG.bandWidth * HALF,
        KEG.bellyHalfWidth * 2,
        KEG.bandWidth,
      );
      ctx.fillStyle = KEG_IRON_LIT;
      ctx.fillRect(
        -KEG.bellyHalfWidth,
        bottom * band - KEG.bandWidth * HALF,
        KEG.bellyHalfWidth * 2,
        KEG.bandWidth * HALF * HALF,
      );
    }
    ctx.fillStyle = wood.shadow;
    ctx.fillRect(-KEG.endHalfWidth, top, KEG.endHalfWidth * 2, KEG.mouthDepth);
  });

  ctx.strokeStyle = HEMP.mid;
  ctx.lineWidth = HARNESS_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(KEG.endHalfWidth, top + KEG.mouthDepth);
  ctx.lineTo(p.shoulderHalfWidth * KEG.backOffset, KEG.rise + KEG.mouthDepth);
  ctx.stroke();
  ctx.restore();
}

/** The harness rope over the gambeson, from the top of the shoulder down to the armpit. */
const HARNESS_ROPE = { fromX: -0.6, fromY: -1.04, toX: 0.55, toY: -0.55 } as const;

function drawHarness(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  ctx.lineCap = 'round';
  const from = pt(p.shoulderHalfWidth * HARNESS_ROPE.fromX, t * HARNESS_ROPE.fromY);
  const to = pt(p.shoulderHalfWidth * HARNESS_ROPE.toX, t * HARNESS_ROPE.toY);
  ctx.strokeStyle = style.palette.outline;
  ctx.lineWidth = HARNESS_WIDTH * (1 + HALF);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = HEMP.light;
  ctx.lineWidth = HARNESS_WIDTH;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

const BLACK_POWDER_OUTFIT: GoblinOutfit = {
  head: drawBlackPowderHead,
  torso: drawGambeson,
  hips: drawGambesonSkirt,
  leg: drawBreechesLeg,
  arm: drawBlackPowderArm,
  back: drawPowderKeg,
  overTorso: drawHarness,
};

// ── Builds ───────────────────────────────────────────────────────────────────

/**
 * Lean and twitchy: the narrowest shoulders, the thinnest limbs and the
 * deepest hunch of any goblin, and a little smaller than the sword goblin. The
 * ears stay big, since with a helmet on they and the candle carry the head.
 */
const DYNAMITE_BUILD: GoblinProportions = {
  thighLength: 0.28,
  shinLength: 0.26,
  footHeight: 0.05,
  torsoLength: 0.26,
  neckLength: 0.025,
  headRadius: 0.245,
  headWidthFactor: 0.98,
  shoulderHalfWidth: 0.15,
  hipHalfWidth: 0.11,
  bellyBulge: 0.02,
  upperArmLength: 0.36,
  forearmLength: 0.4,
  legWidth: 0.1,
  // As thin as an arm gets: the gore's severed arm insets its shading by a
  // fixed margin, and a thinner arm turns that inset inside out.
  armWidth: 0.08,
  handRadius: 0.1,
  footLength: 0.34,
  earLength: 0.44,
  noseProjection: 0.16,
};

/**
 * Squat and broad: the widest shoulders and hips in the family on short, thick
 * legs, a touch taller than the sword goblin. The bulk is what the keg sits
 * on, and the keg is what names it.
 */
const BLACK_POWDER_BUILD: GoblinProportions = {
  thighLength: 0.3,
  shinLength: 0.27,
  footHeight: 0.07,
  torsoLength: 0.34,
  neckLength: 0.02,
  headRadius: 0.27,
  headWidthFactor: 1.05,
  shoulderHalfWidth: 0.25,
  hipHalfWidth: 0.19,
  bellyBulge: 0.1,
  upperArmLength: 0.39,
  forearmLength: 0.43,
  legWidth: 0.15,
  armWidth: 0.115,
  handRadius: 0.12,
  footLength: 0.4,
  earLength: 0.48,
  noseProjection: 0.16,
};

/** The dynamite goblin's apron is the leather ramp burnt darker. */
const SCORCHED_LEATHER: Ramp = {
  shadow: '#1d120a',
  dark: '#3a2414',
  mid: '#5c3b22',
  light: '#7c5534',
  rim: '#a77a50',
};

function bomberPalette(overrides: Partial<GoblinPalette>): GoblinPalette {
  return { ...goblinPalette(), ...overrides };
}

const DYNAMITE_STYLE: GoblinStyle = {
  palette: bomberPalette({ leather: SCORCHED_LEATHER }),
  proportions: DYNAMITE_BUILD,
  // A bracer on the throwing arm would hide the soot; a greave tells its
  // severed leg from its severed arm on the floor, which this build's thin
  // limbs cannot do on width alone.
  gear: { ...NO_GEAR, greave: true },
  spineLean: deg(26),
  earNotches: 2,
  outfit: DYNAMITE_OUTFIT,
};

const BLACK_POWDER_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: BLACK_POWDER_BUILD,
  gear: { ...NO_GEAR, bracer: true },
  spineLean: deg(10),
  earNotches: 1,
  outfit: BLACK_POWDER_OUTFIT,
};

export const GOBLIN_BOMBER_STYLES: Record<GoblinBomberArchetype, GoblinStyle> = {
  dynamite: DYNAMITE_STYLE,
  black_powder: BLACK_POWDER_STYLE,
};

/** Sole-to-skull height each bomber stands at in play, in tile units. */
const BOMBER_HEIGHTS: Record<GoblinBomberArchetype, number> = {
  dynamite: 0.84,
  black_powder: 0.95,
};

/** How much of its authored size each bomber is drawn at; see `ARCHETYPE_SCALE`. */
export const BOMBER_SCALE: Record<GoblinBomberArchetype, number> = {
  dynamite: BOMBER_HEIGHTS.dynamite / figureHeight(DYNAMITE_BUILD),
  black_powder: BOMBER_HEIGHTS.black_powder / figureHeight(BLACK_POWDER_BUILD),
};
