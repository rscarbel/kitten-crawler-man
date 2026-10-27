/**
 * The Cloak & Dagger's own marks — a dagger, a domino mask, a key, a raven, a
 * poison vial and a crescent moon — as flat silhouettes the club's furniture
 * stamps on its slot cabinets and its host stand.
 *
 * Each mark is drawn about a centre in units of `size`, the mark's half-extent
 * in pixels, so one painter serves a two-tile belly panel and a thumbnail
 * badge alike. A silhouette is one fill plus a thinner shade line, because
 * anything finer is lost at the game's 32px tiles.
 */

type Ctx = CanvasRenderingContext2D;

export type ClubEmblem = 'dagger' | 'mask' | 'key' | 'raven' | 'vial' | 'moon';

export interface EmblemInk {
  /** The silhouette itself. */
  readonly fill: string;
  /** Cut lines, fullers and eyes inside it. */
  readonly shade: string;
}

const TWO_PI = Math.PI * 2;
const POISON_GREEN = '#8ef04a';
/** Shade lines are this share of the mark's half-extent, never under a pixel. */
const SHADE_LINE_SHARE = 0.09;

function shadeWidth(size: number): number {
  return Math.max(1, size * SHADE_LINE_SHARE);
}

/** A point in emblem units, `size` pixels each, about the emblem's centre. */
interface Unit {
  readonly x: number;
  readonly y: number;
}

function polygon(ctx: Ctx, cx: number, cy: number, size: number, points: readonly Unit[]): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = cx + point.x * size;
    const y = cy + point.y * size;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// ── Dagger: slanted, point down, the way it hangs on the club's sign ───────

const DAGGER = {
  /**
   * The slant is what makes it a weapon at a glance: upright, a hilt and a
   * crossguard are a cross.
   */
  tilt: (40 * Math.PI) / 180,
  pommelY: -0.88,
  pommelR: 0.16,
  gripHalfW: 0.09,
  gripTop: -0.76,
  guardY: -0.42,
  guardHalfW: 0.5,
  /** How far the quillon tips droop toward the point. */
  guardDroop: 0.16,
  guardThick: 0.17,
  bladeHalfW: 0.22,
  tipY: 1,
  fullerBottom: 0.5,
} as const;

function paintDagger(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DAGGER.tilt);
  ctx.fillStyle = ink.fill;
  polygon(ctx, 0, 0, size, [
    { x: -DAGGER.bladeHalfW, y: DAGGER.guardY },
    { x: DAGGER.bladeHalfW, y: DAGGER.guardY },
    { x: 0, y: DAGGER.tipY },
  ]);
  ctx.fill();
  ctx.fillRect(
    -DAGGER.gripHalfW * size,
    DAGGER.gripTop * size,
    DAGGER.gripHalfW * 2 * size,
    (DAGGER.guardY - DAGGER.gripTop) * size,
  );
  ctx.beginPath();
  ctx.arc(0, DAGGER.pommelY * size, DAGGER.pommelR * size, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = ink.fill;
  ctx.lineCap = 'round';
  ctx.lineWidth = DAGGER.guardThick * size;
  ctx.beginPath();
  ctx.moveTo(-DAGGER.guardHalfW * size, (DAGGER.guardY + DAGGER.guardDroop) * size);
  ctx.quadraticCurveTo(
    0,
    (DAGGER.guardY - DAGGER.guardDroop) * size,
    DAGGER.guardHalfW * size,
    (DAGGER.guardY + DAGGER.guardDroop) * size,
  );
  ctx.stroke();
  ctx.strokeStyle = ink.shade;
  ctx.lineCap = 'butt';
  ctx.lineWidth = shadeWidth(size);
  ctx.beginPath();
  ctx.moveTo(0, (DAGGER.guardY + DAGGER.guardThick) * size);
  ctx.lineTo(0, DAGGER.fullerBottom * size);
  ctx.stroke();
  ctx.restore();
}

// ── Domino mask ─────────────────────────────────────────────────────────────

const MASK = {
  tipY: -0.12,
  browY: -0.5,
  browHandleX: 0.5,
  cheekX: 0.55,
  cheekY: 0.5,
  bridgeY: 0.12,
  eyeX: 0.42,
  eyeY: -0.04,
  eyeRx: 0.2,
  eyeRy: 0.12,
  /** The eyes tilt up toward the temples, which is what makes it sly rather than surprised. */
  eyeTilt: 0.3,
} as const;

function paintMask(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  ctx.fillStyle = ink.fill;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy + MASK.tipY * size);
  ctx.bezierCurveTo(
    cx - MASK.browHandleX * size,
    cy + MASK.browY * size,
    cx + MASK.browHandleX * size,
    cy + MASK.browY * size,
    cx + size,
    cy + MASK.tipY * size,
  );
  ctx.quadraticCurveTo(
    cx + MASK.cheekX * size,
    cy + MASK.cheekY * size,
    cx,
    cy + MASK.bridgeY * size,
  );
  ctx.quadraticCurveTo(
    cx - MASK.cheekX * size,
    cy + MASK.cheekY * size,
    cx - size,
    cy + MASK.tipY * size,
  );
  ctx.closePath();
  for (const side of [-1, 1]) {
    const ex = cx + side * MASK.eyeX * size;
    const ey = cy + MASK.eyeY * size;
    ctx.moveTo(ex + MASK.eyeRx * size, ey);
    ctx.ellipse(ex, ey, MASK.eyeRx * size, MASK.eyeRy * size, -side * MASK.eyeTilt, 0, TWO_PI);
  }
  ctx.fill('evenodd');
}

// ── Key ─────────────────────────────────────────────────────────────────────

const KEY = {
  bowX: -0.58,
  bowR: 0.38,
  bowHoleR: 0.17,
  shaftLeft: -0.24,
  shaftHalfH: 0.08,
  teeth: [
    { left: 0.5, right: 0.64, depth: 0.34 },
    { left: 0.78, right: 1, depth: 0.24 },
  ],
} as const;

function paintKey(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  ctx.fillStyle = ink.fill;
  ctx.beginPath();
  ctx.arc(cx + KEY.bowX * size, cy, KEY.bowR * size, 0, TWO_PI);
  ctx.moveTo(cx + (KEY.bowX + KEY.bowHoleR) * size, cy);
  ctx.arc(cx + KEY.bowX * size, cy, KEY.bowHoleR * size, 0, TWO_PI);
  ctx.fill('evenodd');
  ctx.fillRect(
    cx + KEY.shaftLeft * size,
    cy - KEY.shaftHalfH * size,
    (1 - KEY.shaftLeft) * size,
    KEY.shaftHalfH * 2 * size,
  );
  for (const tooth of KEY.teeth) {
    ctx.fillRect(
      cx + tooth.left * size,
      cy + KEY.shaftHalfH * size,
      (tooth.right - tooth.left) * size,
      tooth.depth * size,
    );
  }
}

// ── Raven, perched in profile ───────────────────────────────────────────────

const RAVEN_BODY: readonly Unit[] = [
  { x: 0.6, y: -0.15 },
  { x: 0.42, y: 0.32 },
  { x: -0.15, y: 0.52 },
  { x: -0.55, y: 0.38 },
  { x: -1, y: 0.7 },
  { x: -0.95, y: 0.28 },
  { x: -0.6, y: -0.02 },
  { x: -0.2, y: -0.3 },
  { x: 0.25, y: -0.38 },
];
const RAVEN = {
  headX: 0.48,
  headY: -0.34,
  headR: 0.3,
  beakBase: { x: 0.6, top: -0.48, bottom: -0.2 },
  beakTip: { x: 1, y: -0.18 },
  /** The control point that bends the upper mandible down into a hook. */
  beakHookX: 0.98,
  crownFrom: Math.PI * 1.05,
  crownTo: Math.PI * 1.75,
  backFrom: { x: 0.25, y: -0.38 },
  backTo: { x: -0.6, y: -0.02 },
  eyeX: 0.52,
  eyeY: -0.38,
  eyeR: 0.06,
  wingFrom: { x: 0.28, y: -0.08 },
  wingControl: { x: -0.1, y: 0.05 },
  wingTo: { x: -0.62, y: 0.22 },
  legs: [0.05, 0.2],
  legTop: 0.36,
  legBottom: 0.68,
} as const;

function paintRaven(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  ctx.fillStyle = ink.fill;
  polygon(ctx, cx, cy, size, RAVEN_BODY);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + RAVEN.headX * size, cy + RAVEN.headY * size, RAVEN.headR * size, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + RAVEN.beakBase.x * size, cy + RAVEN.beakBase.top * size);
  ctx.quadraticCurveTo(
    cx + RAVEN.beakHookX * size,
    cy + RAVEN.beakBase.top * size,
    cx + RAVEN.beakTip.x * size,
    cy + RAVEN.beakTip.y * size,
  );
  ctx.lineTo(cx + RAVEN.beakBase.x * size, cy + RAVEN.beakBase.bottom * size);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ink.fill;
  ctx.lineWidth = shadeWidth(size);
  for (const legX of RAVEN.legs) {
    ctx.beginPath();
    ctx.moveTo(cx + legX * size, cy + RAVEN.legTop * size);
    ctx.lineTo(cx + legX * size, cy + RAVEN.legBottom * size);
    ctx.stroke();
  }
  // A rim light along the back and crown, where the key light catches the feathers.
  ctx.strokeStyle = ink.shade;
  ctx.beginPath();
  ctx.arc(
    cx + RAVEN.headX * size,
    cy + RAVEN.headY * size,
    RAVEN.headR * size,
    RAVEN.crownFrom,
    RAVEN.crownTo,
  );
  ctx.moveTo(cx + RAVEN.backFrom.x * size, cy + RAVEN.backFrom.y * size);
  ctx.lineTo(cx + RAVEN.backTo.x * size, cy + RAVEN.backTo.y * size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + RAVEN.wingFrom.x * size, cy + RAVEN.wingFrom.y * size);
  ctx.quadraticCurveTo(
    cx + RAVEN.wingControl.x * size,
    cy + RAVEN.wingControl.y * size,
    cx + RAVEN.wingTo.x * size,
    cy + RAVEN.wingTo.y * size,
  );
  ctx.stroke();
  ctx.fillStyle = ink.shade;
  ctx.beginPath();
  ctx.arc(cx + RAVEN.eyeX * size, cy + RAVEN.eyeY * size, RAVEN.eyeR * size, 0, TWO_PI);
  ctx.fill();
}

// ── Poison vial ─────────────────────────────────────────────────────────────

const VIAL = {
  bulbY: 0.44,
  bulbR: 0.5,
  neckHalfW: 0.12,
  neckTop: -0.52,
  lipHalfW: 0.2,
  lipTop: -0.62,
  corkHalfW: 0.13,
  corkTop: -0.92,
  /** The liquid line inside the bulb, as a height up from its bottom. */
  liquidY: 0.3,
  glintFrom: Math.PI * 1.1,
  glintTo: Math.PI * 1.4,
  glintR: 0.38,
  /** The liquid sits inside a rim of glass this share of the bulb's radius. */
  glassShare: 0.8,
  dripX: 0.78,
  dripY: 0.1,
  dripR: 0.12,
  /** How far above its round belly the drip's tail runs, in drip radii. */
  dripPoint: 1.8,
} as const;

function paintVial(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  ctx.fillStyle = ink.fill;
  ctx.beginPath();
  ctx.arc(cx, cy + VIAL.bulbY * size, VIAL.bulbR * size, 0, TWO_PI);
  ctx.fill();
  // The poison is always its own sickly green, whatever ink the flask is stamped in.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + VIAL.bulbY * size, VIAL.bulbR * size * VIAL.glassShare, 0, TWO_PI);
  ctx.clip();
  ctx.fillStyle = POISON_GREEN;
  ctx.fillRect(
    cx - VIAL.bulbR * size,
    cy + VIAL.liquidY * size,
    VIAL.bulbR * 2 * size,
    VIAL.bulbR * 2 * size,
  );
  ctx.restore();
  const dripX = cx + VIAL.dripX * size;
  const dripY = cy + VIAL.dripY * size;
  const dripR = VIAL.dripR * size;
  ctx.fillStyle = POISON_GREEN;
  ctx.beginPath();
  ctx.moveTo(dripX, dripY - dripR * VIAL.dripPoint);
  ctx.quadraticCurveTo(dripX + dripR, dripY, dripX, dripY + dripR);
  ctx.quadraticCurveTo(dripX - dripR, dripY, dripX, dripY - dripR * VIAL.dripPoint);
  ctx.fill();
  ctx.fillRect(
    cx - VIAL.neckHalfW * size,
    cy + VIAL.neckTop * size,
    VIAL.neckHalfW * 2 * size,
    (VIAL.bulbY - VIAL.neckTop) * size,
  );
  ctx.fillRect(
    cx - VIAL.lipHalfW * size,
    cy + VIAL.lipTop * size,
    VIAL.lipHalfW * 2 * size,
    (VIAL.neckTop - VIAL.lipTop) * size,
  );
  ctx.fillStyle = ink.shade;
  ctx.fillRect(
    cx - VIAL.corkHalfW * size,
    cy + VIAL.corkTop * size,
    VIAL.corkHalfW * 2 * size,
    (VIAL.lipTop - VIAL.corkTop) * size,
  );
  ctx.strokeStyle = ink.shade;
  ctx.lineWidth = shadeWidth(size);
  ctx.beginPath();
  ctx.moveTo(cx - VIAL.bulbR * size, cy + VIAL.liquidY * size);
  ctx.lineTo(cx + VIAL.bulbR * size, cy + VIAL.liquidY * size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + VIAL.bulbY * size, VIAL.glintR * size, VIAL.glintFrom, VIAL.glintTo);
  ctx.stroke();
}

// ── Crescent moon ───────────────────────────────────────────────────────────

const MOON = {
  outerR: 0.86,
  innerR: 0.72,
  /** How far the cutting circle sits from the moon's centre: the crescent's thickness. */
  innerOffset: 0.42,
  /** The horns lean up and to the right, like a moon rising over the club's roofline. */
  tilt: -0.5,
  starX: 0.5,
  starY: 0.1,
  starR: 0.16,
  starInnerShare: 0.4,
  starPoints: 4,
} as const;

function paintMoon(ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk): void {
  const big = MOON.outerR * size;
  const small = MOON.innerR * size;
  const offset = MOON.innerOffset * size;
  const crossX = (big * big - small * small + offset * offset) / (2 * offset);
  const crossY = Math.sqrt(Math.max(0, big * big - crossX * crossX));
  const outerFrom = Math.atan2(crossY, crossX);
  const innerFrom = Math.atan2(-crossY, crossX - offset);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(MOON.tilt);
  ctx.fillStyle = ink.fill;
  ctx.beginPath();
  ctx.arc(0, 0, big, outerFrom, TWO_PI - outerFrom);
  ctx.arc(offset, 0, small, innerFrom, -innerFrom, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const starCx = cx + MOON.starX * size;
  const starCy = cy + MOON.starY * size;
  const spikes = MOON.starPoints * 2;
  ctx.fillStyle = ink.fill;
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const r = (i % 2 === 0 ? 1 : MOON.starInnerShare) * MOON.starR * size;
    const angle = (i / spikes) * TWO_PI;
    const x = starCx + Math.sin(angle) * r;
    const y = starCy - Math.cos(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const EMBLEM_PAINTERS: Readonly<
  Record<ClubEmblem, (ctx: Ctx, cx: number, cy: number, size: number, ink: EmblemInk) => void>
> = {
  dagger: paintDagger,
  mask: paintMask,
  key: paintKey,
  raven: paintRaven,
  vial: paintVial,
  moon: paintMoon,
};

/** Stamps `emblem` centred on (`cx`, `cy`), `size` pixels from its centre to its widest edge. */
export function paintClubEmblem(
  ctx: Ctx,
  emblem: ClubEmblem,
  cx: number,
  cy: number,
  size: number,
  ink: EmblemInk,
): void {
  ctx.save();
  EMBLEM_PAINTERS[emblem](ctx, cx, cy, size, ink);
  ctx.restore();
}
