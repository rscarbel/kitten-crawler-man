/**
 * The prison goblins' kit: the guards' uniform, cap, belt and key ring, their
 * baton and flashlight, and the prisoners' striped rags.
 *
 * Everything here is a {@link GoblinOutfit} or a {@link GoblinProp}, painted by
 * the goblin rig in its own draw order (`goblinArt.ts`), so the clothes share
 * the figure's outline, rim and cast shadows. The choreography that wears them
 * lives in `goblinGuardFigure.ts`.
 *
 * At the 32-px tile the guard is read by three things: the peaked cap's flat
 * crown and jutting visor over the head, the dark uniform against green skin,
 * and the pale lens of the flashlight held out ahead of him. The prisoner is
 * read by his stripes.
 */

import {
  FULL_CIRCLE_ANGLE,
  GOBLIN_STYLES,
  LIGHT,
  figureHeight,
  fillCapsule,
  lerp,
  mix,
  mixPt,
  offset,
  pt,
  rgba,
  deg,
  type BoneChain,
  type GoblinGear,
  type GoblinOutfit,
  type GoblinProp,
  type GoblinProportions,
  type GoblinStyle,
  type Pt,
  type Ramp,
} from './goblinArt';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Materials ────────────────────────────────────────────────────────────────

/** A slate-blue serge, dark enough to read as a uniform and still part from black. */
const UNIFORM: Ramp = {
  shadow: '#10141d',
  dark: '#1c2331',
  mid: '#2b3548',
  light: '#3f4c66',
  rim: '#6a7a9a',
};

/** The cap's glossy black visor and the belt's polished leather. */
const PATENT: Ramp = {
  shadow: '#050607',
  dark: '#0d0f12',
  mid: '#191c21',
  light: '#2e333b',
  rim: '#7d8794',
};

const GOLD: Ramp = {
  shadow: '#4a3208',
  dark: '#7a560f',
  mid: '#b8871c',
  light: '#e6b93a',
  rim: '#fff0a0',
};

/** The prisoner's stripes: an unwashed cream and a charcoal. */
const STRIPE_PALE: Ramp = {
  shadow: '#5b5546',
  dark: '#8c846e',
  mid: '#b3aa8f',
  light: '#d2c9ad',
  rim: '#ece5cc',
};
const STRIPE_DARK = '#1e1e22';
const GRIME = '#3d3426';

/** Part outline growth on the props, in tile units; matches the rig's weapons. */
const PART_OUTLINE = 0.014;

/** The lit-to-shadowed sweep across a garment, in the rig's key-light direction. */
const CLOTH_LIT_ALPHA = 0.4;
const CLOTH_SHADED_ALPHA = 0.7;
const SHADE_MIDPOINT = 0.5;
/** How far the area painted under a clip reaches past the torso, so the clip alone shapes it. */
const CLIP_OVERREACH = 3;

// ── The guard's tunic ────────────────────────────────────────────────────────

/** Where the collar band sits, as fractions of the torso up from the hip. */
const COLLAR_FROM = 0.9;
/** The button placket, in shoulder half-widths forward of the spine. */
const PLACKET_X = 0.62;
const PLACKET_WIDTH = 0.05;
const BUTTON_COUNT = 3;
/** The buttons run from this fraction of the torso down to the next. */
const BUTTON_TOP = 0.78;
const BUTTON_BOTTOM = 0.4;
const BUTTON_RADIUS = 0.035;
/**
 * The badge on the chest: centre in shoulder half-widths forward and torso
 * fractions up, radius as a fraction of the torso. Big enough to survive as a
 * gold fleck at 32 px; any smaller and it is lost in the dark serge.
 */
const BADGE = { x: 0.22, y: 0.7, radius: 0.13, points: 5, innerShare: 0.5 } as const;
/** The epaulette strip along the top of the shoulder, as a fraction of the torso. */
const EPAULETTE_DEPTH = 0.1;
const EPAULETTE_ALPHA = 0.85;

/** A star of `points` points, centred on (x, y). */
function traceStar(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  points: number,
  inner: number,
): void {
  ctx.beginPath();
  const steps = points * 2;
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const reach = i % 2 === 0 ? radius : radius * inner;
    const px = x + Math.cos(angle) * reach;
    const py = y + Math.sin(angle) * reach;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawBadge(ctx: Ctx, x: number, y: number, radius: number): void {
  ctx.fillStyle = GOLD.dark;
  traceStar(ctx, x, y, radius * BADGE_RIM_SCALE, BADGE.points, BADGE.innerShare);
  ctx.fill();
  ctx.fillStyle = GOLD.light;
  traceStar(ctx, x, y, radius, BADGE.points, BADGE.innerShare);
  ctx.fill();
  ctx.fillStyle = GOLD.rim;
  ctx.beginPath();
  ctx.arc(
    x - radius * BADGE_GLINT_SHIFT,
    y - radius * BADGE_GLINT_SHIFT,
    radius * BADGE_GLINT,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
}
const BADGE_RIM_SCALE = 1.3;
const BADGE_GLINT_SHIFT = 0.2;
const BADGE_GLINT = 0.3;

/** The tunic over the whole torso, painted inside its clip in spine space. */
function drawTunic(ctx: Ctx, style: GoblinStyle, badgeScale: number): void {
  const p = style.proportions;
  const top = -p.torsoLength;
  const reach = p.torsoLength * CLIP_OVERREACH;

  ctx.fillStyle = UNIFORM.mid;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
  const shading = ctx.createLinearGradient(-p.shoulderHalfWidth, top, p.shoulderHalfWidth * 2, 0);
  shading.addColorStop(0, rgba(UNIFORM.rim, CLOTH_LIT_ALPHA));
  shading.addColorStop(SHADE_MIDPOINT, rgba(UNIFORM.mid, 0));
  shading.addColorStop(1, rgba(UNIFORM.shadow, CLOTH_SHADED_ALPHA));
  ctx.fillStyle = shading;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);

  ctx.fillStyle = rgba(UNIFORM.light, EPAULETTE_ALPHA);
  ctx.fillRect(-reach, top - reach, reach * 2, reach + p.torsoLength * EPAULETTE_DEPTH);
  ctx.fillStyle = UNIFORM.shadow;
  ctx.fillRect(-reach, top - reach, reach * 2, reach + p.torsoLength * (1 - COLLAR_FROM));

  const placketX = p.shoulderHalfWidth * PLACKET_X;
  ctx.fillStyle = UNIFORM.dark;
  ctx.fillRect(placketX, top, p.torsoLength * PLACKET_WIDTH, p.torsoLength);
  ctx.fillStyle = GOLD.mid;
  for (let i = 0; i < BUTTON_COUNT; i++) {
    const t = i / (BUTTON_COUNT - 1);
    ctx.beginPath();
    ctx.arc(
      placketX + p.torsoLength * PLACKET_WIDTH,
      top * lerp(BUTTON_TOP, BUTTON_BOTTOM, t),
      p.torsoLength * BUTTON_RADIUS,
      0,
      FULL_CIRCLE_ANGLE,
    );
    ctx.fill();
  }

  drawBadge(
    ctx,
    p.shoulderHalfWidth * BADGE.x,
    top * BADGE.y,
    p.torsoLength * BADGE.radius * badgeScale,
  );
}

// ── Belt, skirt and key ring ─────────────────────────────────────────────────

/** Where the belt sits, as a fraction of the torso up from the hip. */
const BELT_AT = 0.24;
const BELT_HEIGHT = 0.1;
/** The tunic's skirt below the belt: how far past the hips it flares and drops. */
const SKIRT_FLARE = 1.12;
const SKIRT_BELLY_WRAP = 1.15;
const SKIRT_DROP = 0.55;
const SKIRT_HEM_INSET = 0.82;
const SKIRT_SHADOW_START = 0.1;
const SKIRT_SHADOW_ALPHA = 0.55;
const BUCKLE_SIZE = 0.1;
/** Where the buckle sits along the belt: just behind the belly's front. */
const BUCKLE_FORWARD = 0.75;

/**
 * The key ring hung off the belt: where along the belt it hangs (a fraction of
 * the way from the back edge to the front), its radius and its keys, all in
 * torso fractions. The gate guard's is larger and gold.
 */
interface KeyRingSpec {
  readonly along: number;
  readonly radius: number;
  readonly keys: number;
  readonly keyLength: number;
  readonly metal: Ramp;
}

const IRON_KEYS: Ramp = {
  shadow: '#1c1d20',
  dark: '#34363b',
  mid: '#5b5f66',
  light: '#8c9199',
  rim: '#c4c9d0',
};

const PATROL_KEY_RING: KeyRingSpec = {
  along: 0.38,
  radius: 0.11,
  keys: 3,
  keyLength: 0.22,
  metal: IRON_KEYS,
};
const GATE_KEY_RING: KeyRingSpec = {
  along: 0.2,
  radius: 0.17,
  keys: 4,
  keyLength: 0.24,
  metal: GOLD,
};
const RING_STROKE = 0.045;
/** The keys fan out below the ring across this arc, centred straight down. */
const KEY_FAN = deg(50);
const KEY_WIDTH = 0.045;
const KEY_BOW_RADIUS = 0.065;
const KEY_TOOTH_LENGTH = 0.06;

function drawKeyRing(
  ctx: Ctx,
  style: GoblinStyle,
  ring: KeyRingSpec,
  back: number,
  front: number,
  waist: number,
): void {
  const t = style.proportions.torsoLength;
  const radius = t * ring.radius;
  const centre = pt(lerp(back, front, ring.along), waist + radius);
  ctx.strokeStyle = ring.metal.dark;
  ctx.lineWidth = t * RING_STROKE * 2;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, FULL_CIRCLE_ANGLE);
  ctx.stroke();
  ctx.strokeStyle = ring.metal.light;
  ctx.lineWidth = t * RING_STROKE;
  ctx.stroke();

  for (let i = 0; i < ring.keys; i++) {
    const share = ring.keys === 1 ? 0.5 : i / (ring.keys - 1);
    const angle = Math.PI / 2 + lerp(-KEY_FAN / 2, KEY_FAN / 2, share);
    const root = pt(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
    const tip = pt(
      root.x + Math.cos(angle) * t * ring.keyLength,
      root.y + Math.sin(angle) * t * ring.keyLength,
    );
    fillCapsule(ctx, root, tip, t * KEY_WIDTH, t * KEY_WIDTH * KEY_SHAFT_TAPER, ring.metal.mid);
    ctx.fillStyle = ring.metal.light;
    ctx.beginPath();
    ctx.arc(root.x, root.y, t * KEY_BOW_RADIUS, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
    const toothAngle = angle + Math.PI / 2;
    fillCapsule(
      ctx,
      tip,
      pt(
        tip.x + Math.cos(toothAngle) * t * KEY_TOOTH_LENGTH,
        tip.y + Math.sin(toothAngle) * t * KEY_TOOTH_LENGTH,
      ),
      t * KEY_WIDTH * KEY_SHAFT_TAPER,
      t * KEY_WIDTH * KEY_SHAFT_TAPER,
      ring.metal.dark,
    );
  }
}
const KEY_SHAFT_TAPER = 0.8;

/** The tunic's skirt, the belt and the key ring over the hips, in spine space. */
function drawGuardHips(ctx: Ctx, style: GoblinStyle, ring: KeyRingSpec): void {
  const p = style.proportions;
  const waist = -p.torsoLength * BELT_AT;
  const front = p.hipHalfWidth * SKIRT_FLARE + p.bellyBulge * SKIRT_BELLY_WRAP;
  const back = -p.hipHalfWidth * SKIRT_FLARE;
  const hem = p.hipHalfWidth * SKIRT_DROP;

  const traceSkirt = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, waist);
    ctx.lineTo(front, waist);
    ctx.lineTo(front * SKIRT_HEM_INSET, hem);
    ctx.lineTo(back * SKIRT_HEM_INSET, hem);
    ctx.closePath();
  };
  ctx.fillStyle = UNIFORM.mid;
  traceSkirt();
  ctx.fill();
  withClip(ctx, traceSkirt, () => {
    ctx.fillStyle = rgba(UNIFORM.shadow, SKIRT_SHADOW_ALPHA);
    ctx.fillRect(front * SKIRT_SHADOW_START, waist, front, hem - waist);
  });

  const beltHeight = p.torsoLength * BELT_HEIGHT;
  ctx.fillStyle = PATENT.mid;
  ctx.fillRect(back, waist - beltHeight / 2, front - back, beltHeight);
  ctx.fillStyle = rgba(PATENT.rim, BELT_SHEEN_ALPHA);
  ctx.fillRect(back, waist - beltHeight / 2, front - back, beltHeight * BELT_SHEEN_DEPTH);
  const buckle = p.torsoLength * BUCKLE_SIZE;
  ctx.fillStyle = GOLD.light;
  ctx.fillRect(lerp(back, front, BUCKLE_FORWARD) - buckle / 2, waist - buckle / 2, buckle, buckle);

  drawKeyRing(ctx, style, ring, back, front, waist + beltHeight / 2);
}
const BELT_SHEEN_ALPHA = 0.35;
const BELT_SHEEN_DEPTH = 0.3;

// ── Trousers ─────────────────────────────────────────────────────────────────

/** Trouser legs are wider than the starved leg inside them; they stop at mid-shin. */
const TROUSER_WIDTH = 1.8;
const TROUSER_HEM = 0.7;
const TROUSER_KNEE_TAPER = 0.88;
const TROUSER_HEM_TAPER = 0.8;
const TROUSER_SHEEN_OFFSET = 0.5;
const TROUSER_SHEEN_WIDTH = 0.2;
const TROUSER_SHEEN_ALPHA = 0.35;
/** A far limb sits this share of the way from `mid` down to `dark`. */
const FAR_SHARE = 0.4;

function drawGuardTrouserLeg(ctx: Ctx, chain: BoneChain, style: GoblinStyle, near: boolean): void {
  const half = (style.proportions.legWidth * TROUSER_WIDTH) / 2;
  const knee = half * TROUSER_KNEE_TAPER;
  const hem = mixPt(chain.joint, chain.end, TROUSER_HEM);
  const fill = near ? UNIFORM.mid : mix(UNIFORM.mid, UNIFORM.dark, FAR_SHARE);
  fillCapsule(ctx, chain.anchor, chain.joint, half, knee, fill);
  fillCapsule(ctx, chain.joint, hem, knee, half * TROUSER_HEM_TAPER, fill);
  if (!near) return;
  const shift = half * TROUSER_SHEEN_OFFSET;
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * shift, LIGHT.y * shift);
  fillCapsule(
    ctx,
    lit(chain.anchor),
    lit(chain.joint),
    half * TROUSER_SHEEN_WIDTH,
    half * TROUSER_SHEEN_WIDTH,
    rgba(UNIFORM.rim, TROUSER_SHEEN_ALPHA),
  );
}

// ── The peaked cap ───────────────────────────────────────────────────────────

/**
 * The cap's points in head units — X in head half-widths, Y in head radii, +X
 * forward, -Y up — plus the badge, and whether the band is gold braid.
 *
 * The crown is a flat saucer wider than the band and tipped up at the front,
 * over a glossy visor that juts forward past the brow: those two flat planes
 * are what part a guard's cap from the plumber's soft one at 32 px.
 */
interface CapSpec {
  readonly bandBack: Pt;
  readonly bandFront: Pt;
  readonly bandTop: number;
  readonly crownBack: Pt;
  readonly crownFront: Pt;
  readonly crownTopBack: Pt;
  readonly crownTopFront: Pt;
  readonly visorRoot: Pt;
  readonly visorTip: Pt;
  readonly visorDepth: number;
  readonly badge: Pt;
  readonly badgeRadius: number;
  readonly braid: boolean;
}

const PATROL_CAP: CapSpec = {
  bandBack: pt(-0.98, -0.32),
  bandFront: pt(0.86, -0.48),
  bandTop: -0.72,
  crownBack: pt(-1.16, -0.92),
  crownFront: pt(1.14, -1.08),
  crownTopBack: pt(-1.02, -1.18),
  crownTopFront: pt(1.0, -1.34),
  visorRoot: pt(0.8, -0.5),
  visorTip: pt(1.5, -0.36),
  visorDepth: 0.12,
  badge: pt(0.62, -0.9),
  badgeRadius: 0.17,
  braid: false,
};

const GATE_CAP: CapSpec = {
  ...PATROL_CAP,
  crownBack: pt(-1.22, -1.02),
  crownFront: pt(1.22, -1.22),
  crownTopBack: pt(-1.08, -1.32),
  crownTopFront: pt(1.08, -1.52),
  visorTip: pt(1.58, -0.34),
  badgeRadius: 0.24,
  braid: true,
};

/** The brim's shadow across the brow, in head units. */
const BRIM_SHADOW = { centre: pt(0.6, -0.28), radii: pt(0.5, 0.12), alpha: 0.6 } as const;
const BRAID_STROKE = 0.07;
const CROWN_TOP_SHEEN_ALPHA = 0.45;

function drawGuardCap(ctx: Ctx, style: GoblinStyle, cap: CapSpec): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const at = (point: Pt): Pt => pt(rx * point.x, r * point.y);

  const shadowCentre = at(BRIM_SHADOW.centre);
  const shadowRadii = at(BRIM_SHADOW.radii);
  ctx.fillStyle = rgba(style.palette.skin.shadow, BRIM_SHADOW.alpha);
  ctx.beginPath();
  ctx.ellipse(
    shadowCentre.x,
    shadowCentre.y,
    shadowRadii.x,
    shadowRadii.y,
    0,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();

  const bandBack = at(cap.bandBack);
  const bandFront = at(cap.bandFront);
  const bandTop = r * cap.bandTop;
  const crownBack = at(cap.crownBack);
  const crownFront = at(cap.crownFront);
  const topBack = at(cap.crownTopBack);
  const topFront = at(cap.crownTopFront);

  const traceCrown = (): void => {
    ctx.beginPath();
    ctx.moveTo(bandBack.x, bandBack.y);
    ctx.lineTo(bandBack.x, bandTop);
    ctx.lineTo(crownBack.x, crownBack.y);
    ctx.lineTo(topBack.x, topBack.y);
    ctx.lineTo(topFront.x, topFront.y);
    ctx.lineTo(crownFront.x, crownFront.y);
    ctx.lineTo(bandFront.x, bandTop);
    ctx.lineTo(bandFront.x, bandFront.y);
    ctx.closePath();
  };
  ctx.fillStyle = UNIFORM.mid;
  traceCrown();
  ctx.fill();
  withClip(ctx, traceCrown, () => {
    const shading = ctx.createLinearGradient(crownBack.x, topBack.y, crownFront.x, bandFront.y);
    shading.addColorStop(0, rgba(UNIFORM.rim, CLOTH_LIT_ALPHA));
    shading.addColorStop(SHADE_MIDPOINT, rgba(UNIFORM.mid, 0));
    shading.addColorStop(1, rgba(UNIFORM.shadow, CLOTH_SHADED_ALPHA));
    ctx.fillStyle = shading;
    ctx.fillRect(crownBack.x, topFront.y, crownFront.x - crownBack.x, bandBack.y - topFront.y);
    ctx.fillStyle = rgba(UNIFORM.rim, CROWN_TOP_SHEEN_ALPHA);
    ctx.beginPath();
    ctx.moveTo(crownBack.x, crownBack.y);
    ctx.lineTo(topBack.x, topBack.y);
    ctx.lineTo(topFront.x, topFront.y);
    ctx.lineTo(crownFront.x, crownFront.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cap.braid ? GOLD.mid : PATENT.mid;
    ctx.fillRect(bandBack.x, bandTop, bandFront.x - bandBack.x, bandBack.y - bandTop);
    if (cap.braid) {
      ctx.strokeStyle = GOLD.light;
      ctx.lineWidth = r * BRAID_STROKE;
      ctx.beginPath();
      ctx.moveTo(bandBack.x, lerp(bandTop, bandBack.y, SHADE_MIDPOINT));
      ctx.lineTo(bandFront.x, lerp(bandTop, bandFront.y, SHADE_MIDPOINT));
      ctx.stroke();
    }
  });

  const visorRoot = at(cap.visorRoot);
  const visorTip = at(cap.visorTip);
  const visorDepth = r * cap.visorDepth;
  ctx.fillStyle = PATENT.mid;
  ctx.beginPath();
  ctx.moveTo(visorRoot.x, visorRoot.y - visorDepth);
  ctx.lineTo(visorTip.x, visorTip.y - visorDepth / 2);
  ctx.lineTo(visorTip.x, visorTip.y + visorDepth / 2);
  ctx.lineTo(visorRoot.x, visorRoot.y + visorDepth);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PATENT.rim;
  ctx.lineWidth = visorDepth / 2;
  ctx.beginPath();
  ctx.moveTo(visorRoot.x, visorRoot.y - visorDepth);
  ctx.lineTo(visorTip.x, visorTip.y - visorDepth / 2);
  ctx.stroke();

  const badge = at(cap.badge);
  drawBadge(ctx, badge.x, badge.y, r * cap.badgeRadius);
}

// ── Outfits ──────────────────────────────────────────────────────────────────

/** How much larger the gate guard's chest badge is than a patrol guard's. */
const GATE_BADGE_SCALE = 1.3;

const PATROL_OUTFIT: GoblinOutfit = {
  torso: (ctx, style) => drawTunic(ctx, style, 1),
  hips: (ctx, style) => drawGuardHips(ctx, style, PATROL_KEY_RING),
  leg: drawGuardTrouserLeg,
  head: (ctx, style) => drawGuardCap(ctx, style, PATROL_CAP),
};

const GATE_OUTFIT: GoblinOutfit = {
  torso: (ctx, style) => drawTunic(ctx, style, GATE_BADGE_SCALE),
  hips: (ctx, style) => drawGuardHips(ctx, style, GATE_KEY_RING),
  leg: drawGuardTrouserLeg,
  head: (ctx, style) => drawGuardCap(ctx, style, GATE_CAP),
};

// ── The prisoner's stripes ───────────────────────────────────────────────────

/** Stripe pitch and the dark band's share of it, as fractions of the torso. */
const STRIPE_PITCH = 0.22;
const STRIPE_SHARE = 0.4;
/** A rip in the tunic's front, so it reads as rags rather than as a fresh uniform. */
const RIP = { x: 0.55, y: 0.45, w: 0.16, h: 0.2 } as const;
const GRIME_ALPHA = 0.35;
const PRISONER_SHORTS_DROP = 0.75;
const PRISONER_SHORTS_FLARE = 1.1;
const PRISONER_HEM_TEARS = 5;
const PRISONER_HEM_TEAR_DEPTH = 0.35;

/** Horizontal stripes across a region, perpendicular to the spine. */
function paintStripes(
  ctx: Ctx,
  torsoLength: number,
  from: number,
  to: number,
  reach: number,
): void {
  const pitch = torsoLength * STRIPE_PITCH;
  ctx.fillStyle = STRIPE_DARK;
  for (let y = from; y < to; y += pitch) {
    ctx.fillRect(-reach, y, reach * 2, pitch * STRIPE_SHARE);
  }
}

function drawPrisonerTunic(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const top = -p.torsoLength;
  const reach = p.torsoLength * CLIP_OVERREACH;
  ctx.fillStyle = STRIPE_PALE.mid;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
  paintStripes(ctx, p.torsoLength, top, reach, reach);
  const shading = ctx.createLinearGradient(-p.shoulderHalfWidth, top, p.shoulderHalfWidth * 2, 0);
  shading.addColorStop(0, rgba(STRIPE_PALE.rim, CLOTH_LIT_ALPHA));
  shading.addColorStop(SHADE_MIDPOINT, rgba(STRIPE_PALE.mid, 0));
  shading.addColorStop(1, rgba(STRIPE_PALE.shadow, CLOTH_SHADED_ALPHA));
  ctx.fillStyle = shading;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
  ctx.fillStyle = rgba(GRIME, GRIME_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    p.shoulderHalfWidth * RIP.x,
    top * RIP.y,
    p.torsoLength * RIP.w * 2,
    p.torsoLength * RIP.h * 2,
    0,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
  ctx.fillStyle = style.palette.skin.dark;
  ctx.beginPath();
  ctx.moveTo(p.shoulderHalfWidth * RIP.x, top * RIP.y - p.torsoLength * RIP.h);
  ctx.lineTo(p.shoulderHalfWidth * RIP.x + p.torsoLength * RIP.w, top * RIP.y);
  ctx.lineTo(p.shoulderHalfWidth * RIP.x, top * RIP.y + p.torsoLength * RIP.h);
  ctx.closePath();
  ctx.fill();
}

/** Ragged striped shorts over the hips, in spine space. */
function drawPrisonerHips(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const waist = -p.torsoLength * BELT_AT;
  const front = p.hipHalfWidth * PRISONER_SHORTS_FLARE + p.bellyBulge * SKIRT_BELLY_WRAP;
  const back = -p.hipHalfWidth * PRISONER_SHORTS_FLARE;
  const hem = p.hipHalfWidth * PRISONER_SHORTS_DROP;
  const traceShorts = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, waist);
    ctx.lineTo(front, waist);
    for (let i = 0; i <= PRISONER_HEM_TEARS; i++) {
      const t = i / PRISONER_HEM_TEARS;
      const deep = i % 2 === 0 ? 1 : 1 - PRISONER_HEM_TEAR_DEPTH;
      ctx.lineTo(lerp(front * SKIRT_HEM_INSET, back * SKIRT_HEM_INSET, t), hem * deep);
    }
    ctx.closePath();
  };
  ctx.fillStyle = STRIPE_PALE.dark;
  traceShorts();
  ctx.fill();
  withClip(ctx, traceShorts, () => {
    paintStripes(ctx, p.torsoLength, waist, hem, front - back);
    ctx.fillStyle = rgba(STRIPE_PALE.shadow, SKIRT_SHADOW_ALPHA);
    ctx.fillRect(front * SKIRT_SHADOW_START, waist, front, hem - waist);
  });
  ctx.fillStyle = GRIME;
  ctx.fillRect(
    back,
    waist - p.torsoLength * ROPE_BELT_HEIGHT,
    front - back,
    p.torsoLength * ROPE_BELT_HEIGHT,
  );
}
const ROPE_BELT_HEIGHT = 0.06;

const PRISONER_OUTFIT: GoblinOutfit = {
  torso: drawPrisonerTunic,
  hips: drawPrisonerHips,
};

// ── Builds and styles ────────────────────────────────────────────────────────

/** Upright and squared off for a goblin: a guard stands to attention, with a smaller gut. */
const GUARD_BUILD: GoblinProportions = {
  thighLength: 0.28,
  shinLength: 0.27,
  footHeight: 0.06,
  torsoLength: 0.4,
  neckLength: 0.02,
  headRadius: 0.25,
  headWidthFactor: 1.02,
  shoulderHalfWidth: 0.21,
  hipHalfWidth: 0.16,
  bellyBulge: 0.08,
  upperArmLength: 0.36,
  forearmLength: 0.42,
  legWidth: 0.11,
  armWidth: 0.095,
  handRadius: 0.105,
  footLength: 0.34,
  earLength: 0.42,
  noseProjection: 0.16,
};

/** Half-starved and stooped: the prisoners have been in here a while. */
const PRISONER_BUILD: GoblinProportions = {
  ...GUARD_BUILD,
  torsoLength: 0.36,
  shoulderHalfWidth: 0.18,
  hipHalfWidth: 0.14,
  bellyBulge: 0.05,
  armWidth: 0.085,
  legWidth: 0.1,
};

const GUARD_GEAR: GoblinGear = {
  pauldron: false,
  bracer: false,
  greave: false,
  necklace: false,
  hood: false,
  quiver: false,
  flatCap: false,
  overalls: false,
  plunger: false,
};

/** Every goblin shares one palette: builds and kit tell them apart, never skin. */
const SHARED_PALETTE = GOBLIN_STYLES.sword.palette;
const GUARD_HUNCH = deg(8);
const PRISONER_HUNCH = deg(16);

/** A patrol guard inside the prison: tunic, peaked cap, belt and a small iron key ring. */
export const GOBLIN_GUARD_STYLE: GoblinStyle = {
  palette: SHARED_PALETTE,
  proportions: GUARD_BUILD,
  gear: GUARD_GEAR,
  spineLean: GUARD_HUNCH,
  earNotches: 1,
  outfit: PATROL_OUTFIT,
};

/** The gate guard: the patrol uniform with a taller braided cap and a big gold key ring. */
export const GOBLIN_GATE_GUARD_STYLE: GoblinStyle = {
  ...GOBLIN_GUARD_STYLE,
  earNotches: 0,
  outfit: GATE_OUTFIT,
};

/** A prisoner in the cell block: striped rags, no kit. */
export const GOBLIN_PRISONER_STYLE: GoblinStyle = {
  palette: SHARED_PALETTE,
  proportions: PRISONER_BUILD,
  gear: GUARD_GEAR,
  spineLean: PRISONER_HUNCH,
  earNotches: 2,
  outfit: PRISONER_OUTFIT,
};

/** Sole-to-skull height each stands at in play, in tile units. */
const GUARD_HEIGHT = 1.0;
const PRISONER_HEIGHT = 0.92;

/** The draw scale for the guards' builds, as `ARCHETYPE_SCALE` is for the hostile goblins. */
export const GOBLIN_GUARD_SCALE = GUARD_HEIGHT / figureHeight(GUARD_BUILD);
export const GOBLIN_PRISONER_SCALE = PRISONER_HEIGHT / figureHeight(PRISONER_BUILD);

// ── The baton ────────────────────────────────────────────────────────────────

/**
 * Lacquered hardwood: a black baton vanishes against the dark uniform it is
 * carried across, and the stick is half of what says "guard" at 32 px.
 */
const TRUNCHEON_WOOD: Ramp = {
  shadow: '#2e1608',
  dark: '#4f2a12',
  mid: '#7a4520',
  light: '#a8652f',
  rim: '#e0a868',
};
//
// Short, smooth and mace-like: a grip, a shaft that swells toward the end and a
// rounded knob. No flanges or spikes, because a guard's baton must not read as
// the mace goblin's weapon.

const BATON_BUTT = 0.07;
const BATON_GRIP_END = 0.1;
const BATON_TIP = 0.4;
const BATON_GRIP_HALF_WIDTH = 0.026;
const BATON_SWELL_HALF_WIDTH = 0.042;
const BATON_KNOB_RADIUS = 0.05;
const BATON_POMMEL_RADIUS = 0.034;
const BATON_GRIP_BANDS = 3;
const BATON_BAND_WIDTH = 0.012;
const BATON_SHEEN_ALPHA = 0.55;
const BATON_SHEEN_SHARE = 0.4;

/** The guard's baton, held in the near hand. */
export function makeGuardBatonProp(): GoblinProp {
  return {
    tipDistance: BATON_TIP + BATON_KNOB_RADIUS,
    offGripDistance: null,
    headHalfHeight: BATON_KNOB_RADIUS,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);
      const traceBaton = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-BATON_BUTT, -BATON_GRIP_HALF_WIDTH - grow);
        ctx.lineTo(BATON_GRIP_END, -BATON_GRIP_HALF_WIDTH - grow);
        ctx.lineTo(BATON_TIP, -BATON_SWELL_HALF_WIDTH - grow);
        ctx.arc(BATON_TIP, 0, BATON_KNOB_RADIUS + grow, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(BATON_GRIP_END, BATON_GRIP_HALF_WIDTH + grow);
        ctx.lineTo(-BATON_BUTT, BATON_GRIP_HALF_WIDTH + grow);
        ctx.closePath();
        ctx.moveTo(-BATON_BUTT + BATON_POMMEL_RADIUS + grow, 0);
        ctx.arc(-BATON_BUTT, 0, BATON_POMMEL_RADIUS + grow, 0, FULL_CIRCLE_ANGLE);
      };
      ctx.fillStyle = SHARED_PALETTE.outline;
      traceBaton(PART_OUTLINE);
      ctx.fill();
      ctx.fillStyle = TRUNCHEON_WOOD.light;
      traceBaton(0);
      ctx.fill();
      withClip(
        ctx,
        () => traceBaton(0),
        () => {
          ctx.fillStyle = rgba(TRUNCHEON_WOOD.rim, BATON_SHEEN_ALPHA);
          ctx.fillRect(
            -BATON_BUTT * 2,
            -BATON_KNOB_RADIUS,
            BATON_TIP * 2,
            BATON_KNOB_RADIUS * BATON_SHEEN_SHARE,
          );
          ctx.fillStyle = TRUNCHEON_WOOD.shadow;
          ctx.fillRect(
            -BATON_BUTT * 2,
            BATON_KNOB_RADIUS * BATON_SHEEN_SHARE * BATON_SHEEN_SHARE,
            BATON_TIP * 2,
            BATON_KNOB_RADIUS,
          );
        },
      );
      ctx.fillStyle = GOLD.mid;
      for (let i = 0; i < BATON_GRIP_BANDS; i++) {
        const x = lerp(-BATON_BUTT, BATON_GRIP_END, (i + 1) / (BATON_GRIP_BANDS + 1));
        ctx.fillRect(x, -BATON_GRIP_HALF_WIDTH, BATON_BAND_WIDTH, BATON_GRIP_HALF_WIDTH * 2);
      }
      ctx.restore();
    },
  };
}

// ── The flashlight ───────────────────────────────────────────────────────────
//
// Held in the far hand. The lens is a pale disc facing along +X, and its
// distance from the grip is exported: the prison's lighting starts the cone
// there, so the drawn lamp and the light it throws meet.

/**
 * The lamp is long and pale on purpose: a short dark barrel vanishes behind
 * the fist at 32 px and leaves only the lens as a glint. Polished chrome
 * reads against both the navy uniform and the green skin.
 */
const LAMP_CHROME: Ramp = {
  shadow: '#5c636d',
  dark: '#8a929d',
  mid: '#b9c0c9',
  light: '#dde2e8',
  rim: '#f6f8fb',
};
const LAMP_TAIL = 0.04;
const LAMP_BODY_HALF_WIDTH = 0.046;
const LAMP_NECK = 0.28;
const LAMP_HEAD_HALF_WIDTH = 0.085;
/** Distance from the grip to the lens face, along the lamp's own axis, in tile units. */
export const FLASHLIGHT_LENS_DISTANCE = 0.42;
const LAMP_LENS_DEPTH = 0.05;
/** The dark bezel ringing the lens, as a share of the head's half-width. */
const LAMP_BEZEL_DEPTH = 0.035;
const LAMP_LENS_INSET = 0.72;
const LAMP_LENS = '#fffbe2';
const LAMP_LENS_GLOW = '#ffe27a';
const LAMP_LENS_GLOW_RADIUS = 0.13;
const LAMP_LENS_GLOW_ALPHA = 0.6;
/** The rubber grip band round the barrel where the fist closes. */
const LAMP_GRIP_FROM = -0.04;
const LAMP_GRIP_TO = 0.05;
const LAMP_SHEEN_ALPHA = 0.8;
const LAMP_SHADE_ALPHA = 0.7;

/** The flashlight, for the far hand. */
export function makeFlashlightProp(): GoblinProp {
  return {
    tipDistance: FLASHLIGHT_LENS_DISTANCE + LAMP_LENS_GLOW_RADIUS,
    offGripDistance: null,
    headHalfHeight: LAMP_HEAD_HALF_WIDTH,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);
      const lens = FLASHLIGHT_LENS_DISTANCE;
      const traceLamp = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-LAMP_TAIL - grow, -LAMP_BODY_HALF_WIDTH - grow);
        ctx.lineTo(LAMP_NECK, -LAMP_BODY_HALF_WIDTH - grow);
        ctx.lineTo(lens - LAMP_BEZEL_DEPTH, -LAMP_HEAD_HALF_WIDTH - grow);
        ctx.lineTo(lens + grow, -LAMP_HEAD_HALF_WIDTH - grow);
        ctx.lineTo(lens + grow, LAMP_HEAD_HALF_WIDTH + grow);
        ctx.lineTo(lens - LAMP_BEZEL_DEPTH, LAMP_HEAD_HALF_WIDTH + grow);
        ctx.lineTo(LAMP_NECK, LAMP_BODY_HALF_WIDTH + grow);
        ctx.lineTo(-LAMP_TAIL - grow, LAMP_BODY_HALF_WIDTH + grow);
        ctx.closePath();
      };
      ctx.fillStyle = SHARED_PALETTE.outline;
      traceLamp(PART_OUTLINE);
      ctx.fill();
      ctx.fillStyle = LAMP_CHROME.mid;
      traceLamp(0);
      ctx.fill();
      withClip(
        ctx,
        () => traceLamp(0),
        () => {
          ctx.fillStyle = rgba(LAMP_CHROME.rim, LAMP_SHEEN_ALPHA);
          ctx.fillRect(
            -LAMP_TAIL,
            -LAMP_HEAD_HALF_WIDTH,
            lens + LAMP_TAIL,
            LAMP_HEAD_HALF_WIDTH * BATON_SHEEN_SHARE,
          );
          ctx.fillStyle = rgba(LAMP_CHROME.shadow, LAMP_SHADE_ALPHA);
          ctx.fillRect(
            -LAMP_TAIL,
            LAMP_BODY_HALF_WIDTH * BATON_SHEEN_SHARE,
            lens + LAMP_TAIL,
            LAMP_HEAD_HALF_WIDTH,
          );
          ctx.fillStyle = PATENT.mid;
          ctx.fillRect(
            LAMP_GRIP_FROM,
            -LAMP_HEAD_HALF_WIDTH,
            LAMP_GRIP_TO - LAMP_GRIP_FROM,
            LAMP_HEAD_HALF_WIDTH * 2,
          );
          ctx.fillRect(
            lens - LAMP_BEZEL_DEPTH,
            -LAMP_HEAD_HALF_WIDTH,
            LAMP_BEZEL_DEPTH,
            LAMP_HEAD_HALF_WIDTH * 2,
          );
        },
      );

      const glow = ctx.createRadialGradient(lens, 0, 0, lens, 0, LAMP_LENS_GLOW_RADIUS);
      glow.addColorStop(0, rgba(LAMP_LENS_GLOW, LAMP_LENS_GLOW_ALPHA));
      glow.addColorStop(1, rgba(LAMP_LENS_GLOW, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lens, 0, LAMP_LENS_GLOW_RADIUS, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      const lensHalf = LAMP_HEAD_HALF_WIDTH * LAMP_LENS_INSET;
      ctx.fillStyle = LAMP_LENS;
      ctx.fillRect(lens - LAMP_LENS_DEPTH / 2, -lensHalf, LAMP_LENS_DEPTH, lensHalf * 2);
      ctx.restore();
    },
  };
}

/**
 * A hand closed on something the scene draws, not the figure: a prisoner's
 * fists round the cell bars. It paints nothing and exists to close the grip.
 */
export function makeEmptyGripProp(): GoblinProp {
  return {
    tipDistance: 0,
    offGripDistance: null,
    headHalfHeight: 0,
    paint: () => undefined,
  };
}
