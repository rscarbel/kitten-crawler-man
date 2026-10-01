/**
 * The dead of the cellars: scattered bones on the floor, heaps of them against
 * the walls, and the occasional crawler who sat down against a north face and
 * never got up.
 *
 * Every piece is built from the same four parts, so a scatter, a heap and a
 * skeleton all read as one body broken up differently:
 *
 * - a skull — dome, eye sockets, nasal cavity and jaw as value shapes rather
 *   than outlines
 * - a ribcage fragment — curved ribs off a few vertebrae
 * - long bones with real joints — two condyles at each end, not a ball on a stick
 * - a dust shadow — the soft grey ground the bones have lain in for years
 *
 * Bone here is yellow-grey and dirty, held near a dungeon floor's own value so
 * the remains sit in the floor rather than glowing off it. Anything lying flat
 * (the scatter, the wreckage) gets a darker underside and a deeper dust bed:
 * with no height of its own to throw a shadow, that is all that separates it
 * from a pale limestone floor.
 *
 * All geometry is authored on a {@link REMAINS_AUTHORED_TILE}-unit tile and
 * scaled to the caller's `ts`; the shape tables below are in those units.
 */

import {
  PROP_VARIANT_COUNT,
  SHATTER_FRAMES,
  TWO_PI,
  drawDebrisBurst,
  lerp,
  puff,
  radialDebris,
  signedUnit,
  speckle,
  type Ctx,
} from './propPaint';
import { mulberry32 } from '../person/rng';

/** The tile size every coordinate in this module is written against. */
export const REMAINS_AUTHORED_TILE = 64;

/** Looks the walkable scatter decal carries, one frame each. */
export const BONE_SCATTER_VARIANTS = 4;

export type RemainsKind = 'bone_pile' | 'slumped_skeleton';
export type RemainsState = 'idle' | 'damaged' | 'shatter' | 'remains';

// ── Palette ───────────────────────────────────────────────────────────────────

const BONE_LIGHT = '#b2a787';
const BONE_MID = '#918766';
const BONE_DARK = '#685f47';
const BONE_SHADOW = '#463f30';
/** The underside of a bone lying flat: darker than a standing piece's, for contrast on pale floors. */
const BONE_FLAT_UNDERSIDE = '#2c2619';
const SOCKET = '#211c15';
const BONE_SHADES = [BONE_LIGHT, BONE_MID, BONE_DARK] as const;
const DUST_RGB = [150, 140, 116] as const;
const GRIME = 'rgba(52,40,26,0.45)';
const TRANSPARENT = 'rgba(0,0,0,0)';
const RAG_DARK = '#3b352c';
const RAG_MID = '#544b3d';

/** Seed offsets for each look, written out rather than derived. */
const LOOK_SEEDS = [0x0, 0x3d1f, 0x8a27, 0xc4e5] as const;

function lookSeed(look: number): number {
  return LOOK_SEEDS[look % LOOK_SEEDS.length] ?? LOOK_SEEDS[0];
}

/** Runs `paint` in authored units: origin at the tile's top-left, one tile {@link REMAINS_AUTHORED_TILE} wide. */
function inAuthoredTile(ctx: Ctx, ox: number, oy: number, ts: number, paint: () => void): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(ts / REMAINS_AUTHORED_TILE, ts / REMAINS_AUTHORED_TILE);
  paint();
  ctx.restore();
}

/** A point in authored units. */
interface At {
  readonly x: number;
  readonly y: number;
}

// ── Parts ─────────────────────────────────────────────────────────────────────

/** How dark a dust bed is at its centre and its middle ring. */
interface DustStrength {
  readonly core: string;
  readonly ring: string;
}
/** The bed under a piece with height, which its own shadow already darkens. */
const DUST_STANDING: DustStrength = { core: 'rgba(18,14,9,0.38)', ring: 'rgba(18,14,9,0.2)' };
/** The bed under bones lying flat, deep enough to hold them against a pale floor. */
const DUST_FLAT: DustStrength = { core: 'rgba(14,11,7,0.55)', ring: 'rgba(14,11,7,0.3)' };
const DUST_RING_STOP = 0.6;
const DUST_EDGE = 'rgba(18,14,9,0)';

/** The soft grey ground a body has lain in: dust, darker toward its middle. */
function dustShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  strength: DustStrength = DUST_STANDING,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, strength.core);
  g.addColorStop(DUST_RING_STOP, strength.ring);
  g.addColorStop(1, DUST_EDGE);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** The underside a bone is painted over, offset down so it has a lower edge. */
interface Underside {
  readonly colour: string;
  readonly drop: number;
}
const STANDING_UNDERSIDE: Underside = { colour: BONE_SHADOW, drop: 0.9 };
const FLAT_UNDERSIDE: Underside = { colour: BONE_FLAT_UNDERSIDE, drop: 1.3 };

const LONG_BONE = {
  /** The shaft is waisted to this share of its end width at the middle. */
  waist: 0.6,
  condyleSpread: 0.55,
  condyleRadius: 0.62,
  litInset: 0.4,
  litRise: 0.75,
  litFraction: 0.35,
} as const;

/**
 * A long bone from (`x0`, `y0`) to (`x1`, `y1`): a shaft a little waisted in
 * the middle, two condyles at each end, lit along its upper edge.
 */
function longBone(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  underside: Underside = STANDING_UNDERSIDE,
): void {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const length = Math.hypot(x1 - x0, y1 - y0);
  const half = thickness / 2;
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(angle);
  const paintShape = (fill: string, dy: number) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, -half + dy);
    ctx.quadraticCurveTo(length / 2, -half * LONG_BONE.waist + dy, length, -half + dy);
    ctx.lineTo(length, half + dy);
    ctx.quadraticCurveTo(length / 2, half * LONG_BONE.waist + dy, 0, half + dy);
    ctx.closePath();
    ctx.fill();
    for (const endX of [0, length]) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(
          endX,
          side * thickness * LONG_BONE.condyleSpread + dy,
          thickness * LONG_BONE.condyleRadius,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
    }
  };
  paintShape(underside.colour, underside.drop);
  paintShape(BONE_MID, 0);
  ctx.fillStyle = BONE_LIGHT;
  ctx.fillRect(
    thickness * LONG_BONE.litInset,
    -half * LONG_BONE.litRise,
    length - thickness * (LONG_BONE.litInset * 2),
    thickness * LONG_BONE.litFraction,
  );
  ctx.restore();
}

const SMALL_BONE_THICKNESS = 1.6;

/** One short bone: a finger, a toe, a broken end. */
function smallBone(
  ctx: Ctx,
  x: number,
  y: number,
  length: number,
  angle: number,
  underside: Underside = STANDING_UNDERSIDE,
): void {
  longBone(
    ctx,
    x - (Math.cos(angle) * length) / 2,
    y - (Math.sin(angle) * length) / 2,
    x + (Math.cos(angle) * length) / 2,
    y + (Math.sin(angle) * length) / 2,
    SMALL_BONE_THICKNESS,
    underside,
  );
}

/** A skull's proportions, as fractions of its width (`size`) or of its own half-axes. */
const SKULL = {
  ryFraction: 0.44,
  jawY: 0.95,
  jawRx: 0.55,
  jawRy: 0.42,
  teethLeft: -0.45,
  teethY: 0.75,
  teethWidth: 0.9,
  teethHeight: 0.18,
  domeLightX: -0.3,
  domeLightY: -0.45,
  domeReach: 1.15,
  domeMidStop: 0.55,
  maxillaY: 0.62,
  maxillaRx: 0.62,
  maxillaRy: 0.42,
  faceDrop: 0.18,
  socketSpread: 0.24,
  socketRx: 0.17,
  socketRy: 0.15,
  socketTilt: 0.2,
  noseTop: 0.08,
  noseHalfWidth: 0.07,
  noseBottom: 0.27,
  teethSeamLeft: -0.4,
  teethSeamY: 0.86,
  teethSeamWidth: 0.8,
  teethSeamHeight: 0.9,
  browHalfWidth: 0.12,
  browRise: 0.2,
  browWidth: 0.24,
} as const;

/**
 * A skull of width `size` centred on (`cx`, `cy`), tipped by `tilt`. Facing the
 * viewer when `face` is 1, turned away to the crown at 0. The jaw is drawn when
 * it is still attached.
 */
function skull(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  tilt: number,
  face: number,
  jaw: boolean,
): void {
  const k = SKULL;
  const rx = size / 2;
  const ry = size * k.ryFraction;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  if (jaw && face > 0) {
    ctx.fillStyle = BONE_DARK;
    ctx.beginPath();
    ctx.ellipse(0, ry * k.jawY, rx * k.jawRx, ry * k.jawRy, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = BONE_MID;
    ctx.fillRect(rx * k.teethLeft, ry * k.teethY, rx * k.teethWidth, ry * k.teethHeight);
  }
  // Cranium: lit from above, falling into shadow under the cheekbones.
  const g = ctx.createRadialGradient(
    rx * k.domeLightX,
    ry * k.domeLightY,
    0,
    0,
    0,
    rx * k.domeReach,
  );
  g.addColorStop(0, BONE_LIGHT);
  g.addColorStop(k.domeMidStop, BONE_MID);
  g.addColorStop(1, BONE_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  // The face narrows below the brow: the maxilla, a shade down.
  ctx.fillStyle = BONE_MID;
  ctx.beginPath();
  ctx.ellipse(0, ry * k.maxillaY, rx * k.maxillaRx, ry * k.maxillaRy, 0, 0, TWO_PI);
  ctx.fill();
  if (face > 0) {
    const socketY = ry * k.faceDrop;
    ctx.fillStyle = SOCKET;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * size * k.socketSpread,
        socketY,
        size * k.socketRx * face,
        size * k.socketRy,
        side * k.socketTilt,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    // Nasal cavity, and the dark seam of the teeth.
    ctx.beginPath();
    ctx.moveTo(0, socketY + size * k.noseTop);
    ctx.lineTo(size * -k.noseHalfWidth, socketY + size * k.noseBottom);
    ctx.lineTo(size * k.noseHalfWidth, socketY + size * k.noseBottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(rx * k.teethSeamLeft, ry * k.teethSeamY, rx * k.teethSeamWidth, k.teethSeamHeight);
    // The brow catches the light over each socket.
    ctx.fillStyle = BONE_LIGHT;
    for (const side of [-1, 1]) {
      ctx.fillRect(
        side * size * k.socketSpread - size * k.browHalfWidth,
        socketY - size * k.browRise,
        size * k.browWidth,
        1,
      );
    }
  }
  ctx.restore();
}

/** A rib's curve and strokes, as fractions of the fragment's size. */
const RIB = {
  firstRise: 0.3,
  span: 0.6,
  bowX: 0.75,
  bowRise: 0.1,
  tipDrop: 0.3,
  shadowDrop: 0.8,
  shadowWidth: 2.6,
  boneWidth: 2,
  litWidth: 0.8,
  litStartX: 1,
  litLift: 0.6,
  litBowX: 0.6,
  litBowRise: 0.12,
  litTipX: 0.8,
  litTipDrop: 0.05,
  spineReach: 0.4,
  spineRadius: 0.22,
} as const;

/** A run of ribs curving off a few vertebrae: the fragment of a chest. */
function ribFragment(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  ribs: number,
  flip: boolean,
): void {
  const dir = flip ? -1 : 1;
  for (let i = 0; i < ribs; i++) {
    const y = cy - size * RIB.firstRise + (i * size * RIB.span) / Math.max(1, ribs - 1);
    ctx.strokeStyle = BONE_SHADOW;
    ctx.lineWidth = RIB.shadowWidth;
    ctx.beginPath();
    ctx.moveTo(cx, y + RIB.shadowDrop);
    ctx.quadraticCurveTo(
      cx + dir * size * RIB.bowX,
      y - size * RIB.bowRise + RIB.shadowDrop,
      cx + dir * size,
      y + size * RIB.tipDrop + RIB.shadowDrop,
    );
    ctx.stroke();
    ctx.strokeStyle = BONE_MID;
    ctx.lineWidth = RIB.boneWidth;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.quadraticCurveTo(
      cx + dir * size * RIB.bowX,
      y - size * RIB.bowRise,
      cx + dir * size,
      y + size * RIB.tipDrop,
    );
    ctx.stroke();
    ctx.strokeStyle = BONE_LIGHT;
    ctx.lineWidth = RIB.litWidth;
    ctx.beginPath();
    ctx.moveTo(cx + dir * RIB.litStartX, y - RIB.litLift);
    ctx.quadraticCurveTo(
      cx + dir * size * RIB.litBowX,
      y - size * RIB.litBowRise,
      cx + dir * size * RIB.litTipX,
      y + size * RIB.litTipDrop,
    );
    ctx.stroke();
  }
  spine(
    ctx,
    cx,
    cy - size * RIB.spineReach,
    cx,
    cy + size * RIB.spineReach,
    size * RIB.spineRadius,
  );
}

const VERTEBRA = {
  spacing: 1.7,
  shadowDrop: 0.7,
  shadowRx: 1.1,
  shadowRy: 0.8,
  ry: 0.72,
  litHalf: 0.5,
  litHeight: 0.8,
} as const;

/** A column of vertebrae from one point to another. */
function spine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, radius: number): void {
  const count = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (radius * VERTEBRA.spacing)));
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = lerp(x0, x1, t);
    const y = lerp(y0, y1, t);
    ctx.fillStyle = BONE_SHADOW;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + VERTEBRA.shadowDrop,
      radius * VERTEBRA.shadowRx,
      radius * VERTEBRA.shadowRy,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = BONE_MID;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * VERTEBRA.ry, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BONE_LIGHT;
    ctx.fillRect(
      x - radius * VERTEBRA.litHalf,
      y - radius * VERTEBRA.litHalf,
      radius,
      VERTEBRA.litHeight,
    );
  }
}

/** A grimy wash over the lower half of a piece: bone that has sat on a cellar floor is dirtiest at the bottom. */
function grime(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
  g.addColorStop(0, TRANSPARENT);
  g.addColorStop(1, GRIME);
  ctx.fillStyle = g;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.restore();
}

// ── Scatter decal ─────────────────────────────────────────────────────────────
// The walkable scatter is baked into the floor chunk, so every look stays well
// inside its own tile. No two long bones in a look cross: bones that fell
// apart lie where they fell, and a neat X reads as a pirate's flag.

const SCATTER_SEED = 0x60e5;
const SCATTER_GRIME = { x: 32, y: 36, rx: 26, ry: 16 } as const;

interface BoneLaid {
  readonly from: At;
  readonly to: At;
  readonly thickness: number;
}
interface SmallLaid {
  readonly at: At;
  readonly length: number;
  readonly angle: number;
}
interface ScatterLook {
  readonly dust: { readonly at: At; readonly rx: number; readonly ry: number };
  readonly longBones: ReadonlyArray<BoneLaid>;
  readonly smallBones: ReadonlyArray<SmallLaid>;
  readonly skull?: { readonly at: At; readonly size: number; readonly tilt: number };
  readonly ribs?: { readonly at: At; readonly size: number; readonly count: number };
  readonly jaw?: {
    readonly at: At;
    readonly rx: number;
    readonly ry: number;
    readonly tilt: number;
  };
  readonly vertebrae?: { readonly from: At; readonly to: At; readonly radius: number };
  readonly hand?: { readonly at: At; readonly count: number; readonly step: number };
}

const SCATTER_LOOKS: ReadonlyArray<ScatterLook> = [
  {
    dust: { at: { x: 30, y: 37 }, rx: 22, ry: 11 },
    longBones: [{ from: { x: 12, y: 44 }, to: { x: 38, y: 36 }, thickness: 3.4 }],
    smallBones: [
      { at: { x: 22, y: 51 }, length: 8, angle: 0.4 },
      { at: { x: 48, y: 47 }, length: 6, angle: -0.6 },
    ],
    skull: { at: { x: 43, y: 29 }, size: 15, tilt: 0.35 },
  },
  {
    // A femur and a shin lying end to end where the leg came apart.
    dust: { at: { x: 32, y: 38 }, rx: 24, ry: 11 },
    longBones: [
      { from: { x: 10, y: 33 }, to: { x: 34, y: 41 }, thickness: 3.6 },
      { from: { x: 38, y: 46 }, to: { x: 55, y: 38 }, thickness: 3 },
    ],
    smallBones: [{ at: { x: 22, y: 50 }, length: 7, angle: 0.1 }],
    vertebrae: { from: { x: 40, y: 27 }, to: { x: 50, y: 30 }, radius: 2 },
  },
  {
    dust: { at: { x: 32, y: 35 }, rx: 22, ry: 12 },
    longBones: [],
    smallBones: [
      { at: { x: 46, y: 44 }, length: 9, angle: 0.9 },
      { at: { x: 14, y: 48 }, length: 7, angle: -0.3 },
    ],
    ribs: { at: { x: 26, y: 32 }, size: 18, count: 4 },
  },
  {
    // The jaw on its own, and the small bones of a hand.
    dust: { at: { x: 32, y: 39 }, rx: 20, ry: 10 },
    longBones: [],
    smallBones: [],
    jaw: { at: { x: 24, y: 34 }, rx: 8, ry: 5, tilt: 0.3 },
    hand: { at: { x: 36, y: 40 }, count: 5, step: 3.5 },
    vertebrae: { from: { x: 16, y: 46 }, to: { x: 26, y: 50 }, radius: 2 },
  },
];

const SCATTER_SKULL_TILT_JITTER = 0.1;
/** The jaw's lit inner arch, a pixel inside and above its shaded outer edge. */
const JAW_INNER = { inset: 1, lift: 1 } as const;
const HAND = { jitterY: 3, lengthMin: 5, lengthSpread: 2, angle: 1.2, angleJitter: 0.3 } as const;

/**
 * The walkable scatter, kept well inside its own tile: it is baked into the
 * floor chunk, where anything past the tile's edge would be clipped.
 */
export function paintBoneScatter(ctx: Ctx, ox: number, oy: number, ts: number, look: number): void {
  const rng = mulberry32(SCATTER_SEED + lookSeed(look));
  const spec = SCATTER_LOOKS[look % BONE_SCATTER_VARIANTS];
  inAuthoredTile(ctx, ox, oy, ts, () => {
    dustShadow(ctx, spec.dust.at.x, spec.dust.at.y, spec.dust.rx, spec.dust.ry, DUST_FLAT);
    for (const b of spec.longBones) {
      longBone(ctx, b.from.x, b.from.y, b.to.x, b.to.y, b.thickness, FLAT_UNDERSIDE);
    }
    if (spec.ribs !== undefined) {
      ribFragment(ctx, spec.ribs.at.x, spec.ribs.at.y, spec.ribs.size, spec.ribs.count, false);
    }
    if (spec.jaw !== undefined) {
      const j = spec.jaw;
      ctx.fillStyle = BONE_FLAT_UNDERSIDE;
      ctx.beginPath();
      ctx.ellipse(j.at.x, j.at.y, j.rx, j.ry, j.tilt, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = BONE_MID;
      ctx.beginPath();
      ctx.ellipse(
        j.at.x,
        j.at.y - JAW_INNER.lift,
        j.rx - JAW_INNER.inset,
        j.ry - JAW_INNER.inset,
        j.tilt,
        0,
        Math.PI,
      );
      ctx.fill();
    }
    if (spec.hand !== undefined) {
      const h = spec.hand;
      for (let i = 0; i < h.count; i++) {
        smallBone(
          ctx,
          h.at.x + i * h.step,
          h.at.y + signedUnit(rng) * HAND.jitterY,
          HAND.lengthMin + rng() * HAND.lengthSpread,
          HAND.angle + signedUnit(rng) * HAND.angleJitter,
          FLAT_UNDERSIDE,
        );
      }
    }
    if (spec.vertebrae !== undefined) {
      const v = spec.vertebrae;
      spine(ctx, v.from.x, v.from.y, v.to.x, v.to.y, v.radius);
    }
    for (const b of spec.smallBones) {
      smallBone(ctx, b.at.x, b.at.y, b.length, b.angle, FLAT_UNDERSIDE);
    }
    if (spec.skull !== undefined) {
      const s = spec.skull;
      skull(
        ctx,
        s.at.x,
        s.at.y,
        s.size,
        s.tilt + signedUnit(rng) * SCATTER_SKULL_TILT_JITTER,
        1,
        false,
      );
    }
    grime(ctx, SCATTER_GRIME.x, SCATTER_GRIME.y, SCATTER_GRIME.rx, SCATTER_GRIME.ry);
  });
}

// ── Bone pile ─────────────────────────────────────────────────────────────────
// A knee-high heap: long bones laid crosswise at the bottom, ribs and skulls
// over them, one skull crowning the top. The mound's outline is fixed; which
// pieces lie where is the look.

const PILE_SEED = 0x7b0e;

const PILE = {
  dust: { x: 32, y: 52, rx: 30, ry: 12 },
  courseCount: 6,
  courseRows: 3,
  courseBaseY: 50,
  courseStep: 3,
  courseLeft: 8,
  courseLeftSpread: 10,
  courseLength: 34,
  courseLengthSpread: 10,
  courseStartJitter: 2,
  courseEndJitter: 4,
  courseThickness: 3.2,
  ribsLeft: { x: 20, y: 40 },
  ribsRight: { x: 44, y: 40 },
  ribSize: 13,
  ribCount: 3,
  skullLeft: { x: 18, y: 38, size: 14, tilt: -0.2 },
  skullRight: { x: 46, y: 36, size: 13, tilt: 0.3 },
  skullTiltJitter: 0.15,
  /** The right skull is turned half away from the viewer on some looks. */
  turnedAwayChance: 0.5,
  turnedAwayFace: 0.6,
  middleBoneA: { from: { x: 26, y: 36 }, to: { x: 48, y: 30 }, thickness: 3 },
  middleBoneB: { from: { x: 14, y: 30 }, to: { x: 36, y: 34 }, thickness: 2.8 },
  crown: { x: 32, y: 24, size: 15, tiltJitter: 0.2 },
  rolledSkull: { x: 54, y: 52, size: 12, tilt: 1.6, face: 0.7 },
  displacedBone: { from: { x: 26, y: 26 }, to: { x: 40, y: 32 }, thickness: 2.6 },
  grime: { x: 32, y: 40, rx: 32, ry: 22 },
} as const;

function paintBonePile(ctx: Ctx, look: number, damaged: boolean): void {
  const p = PILE;
  const rng = mulberry32(PILE_SEED + lookSeed(look));
  dustShadow(ctx, p.dust.x, p.dust.y, p.dust.rx, p.dust.ry);
  for (let i = 0; i < p.courseCount; i++) {
    const y = p.courseBaseY - (i % p.courseRows) * p.courseStep;
    const x = p.courseLeft + rng() * p.courseLeftSpread;
    longBone(
      ctx,
      x,
      y + signedUnit(rng) * p.courseStartJitter,
      x + p.courseLength + rng() * p.courseLengthSpread,
      y + signedUnit(rng) * p.courseEndJitter,
      p.courseThickness,
    );
  }
  ribFragment(ctx, p.ribsLeft.x, p.ribsLeft.y, p.ribSize, p.ribCount, false);
  ribFragment(ctx, p.ribsRight.x, p.ribsRight.y, p.ribSize, p.ribCount, true);
  const left = p.skullLeft;
  skull(ctx, left.x, left.y, left.size, left.tilt + signedUnit(rng) * p.skullTiltJitter, 1, false);
  const a = p.middleBoneA;
  longBone(ctx, a.from.x, a.from.y, a.to.x, a.to.y, a.thickness);
  const right = p.skullRight;
  skull(
    ctx,
    right.x,
    right.y,
    right.size,
    right.tilt + signedUnit(rng) * p.skullTiltJitter,
    rng() < p.turnedAwayChance ? 1 : p.turnedAwayFace,
    false,
  );
  const b = p.middleBoneB;
  longBone(ctx, b.from.x, b.from.y, b.to.x, b.to.y, b.thickness);
  if (damaged) {
    // The crowning skull has rolled off onto the floor beside the heap.
    const r = p.rolledSkull;
    skull(ctx, r.x, r.y, r.size, r.tilt, r.face, false);
    const d = p.displacedBone;
    longBone(ctx, d.from.x, d.from.y, d.to.x, d.to.y, d.thickness);
  } else {
    skull(ctx, p.crown.x, p.crown.y, p.crown.size, signedUnit(rng) * p.crown.tiltJitter, 1, true);
  }
  grime(ctx, p.grime.x, p.grime.y, p.grime.rx, p.grime.ry);
}

// ── Slumped skeleton ──────────────────────────────────────────────────────────
// Sitting on the floor with its back to the north wall: the skull drooped
// forward onto the chest, the ribcage leaning on the face behind, the left arm
// hanging to the floor and the right lying in the lap, legs out toward the
// viewer with the knees a little raised. The top of the tile is the foot of
// the wall, so the shoulders sit right against it.

/** Joint positions in authored units, for a skeleton facing the viewer. */
const SKELETON = {
  neck: { x: 32, y: 12 },
  shoulderL: { x: 21, y: 15 },
  shoulderR: { x: 43, y: 15 },
  chest: { x: 32, y: 21 },
  pelvis: { x: 32, y: 35 },
  hipL: { x: 27, y: 37 },
  hipR: { x: 37, y: 37 },
  kneeL: { x: 22, y: 45 },
  kneeR: { x: 42, y: 45 },
  footL: { x: 20, y: 57 },
  footR: { x: 45, y: 57 },
  elbowL: { x: 16, y: 26 },
  handL: { x: 15, y: 37 },
  elbowR: { x: 46, y: 27 },
  handR: { x: 36, y: 33 },
} as const;

const SKELETON_SIZES = {
  femur: 3.6,
  shin: 3,
  upperArm: 2.6,
  forearm: 2.2,
  collarbone: 2,
  spineRadius: 2,
  /** The spine rises from just inside the pelvis to just under the neck. */
  spineFootRise: 2,
  spineTopDrop: 4,
  collarDrop: 3,
  collarInset: 1,
  ribSize: 11,
  ribCount: 4,
  ribInset: 1,
  skull: 15,
} as const;

/** The pelvis seen from the front: two iliac wings either side of the sacrum, no holes. */
const PELVIS = {
  wingDx: 6,
  wingRx: 6.5,
  wingRy: 4.2,
  wingTilt: 0.35,
  sacrumHalfWidth: 3.5,
  sacrumTop: -3,
  sacrumBottom: 4,
  shadowDrop: 1,
  litWidth: 7,
  litRise: 3.5,
} as const;

/** The only shadow the skeleton throws: under the pelvis, where it sits on the floor. */
const SEAT_SHADOW = { dy: 5, rx: 15, ry: 6 } as const;

/** Each look's slump: where the drooped head has come to rest on the chest, and its lean. */
const HEAD_SLUMPS: ReadonlyArray<{
  readonly dx: number;
  readonly dy: number;
  readonly tilt: number;
}> = [
  { dx: -7, dy: 8, tilt: -0.75 },
  { dx: 7, dy: 8, tilt: 0.75 },
  { dx: 0, dy: 9, tilt: 0 },
];
/** Drooped forward, the face is turned down toward the lap: little of it shows. */
const DROOPED_FACE = 0.35;
/** The look that still wears a scrap of clothing. */
const RAGGED_LOOK = 2;
const RAG_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [24, 31],
  [40, 30],
  [42, 39],
  [36, 37],
  [31, 41],
  [23, 38],
];
const RAG_HEM = { x: 25, y: 31, width: 14, height: 1.4 } as const;

const FINGERS = { count: 4, step: 2, drop: 2, length: 4 } as const;
/** How far a hand's fingers fan, per finger, in radians. */
const FINGER_SPLAY = 0.15;
const TOES = { dx: 2, drop: 1, length: 5, splay: 0.2 } as const;

/** What a struck skeleton loses: its skull, rolled to the floor, and the arm from its lap. */
const STRUCK = {
  skull: { x: 50, y: 52, size: 14, tilt: 2.4, face: 0.5 },
  arm: { from: { x: 47, y: 46 }, to: { x: 58, y: 42 } },
  hand: { x: 54, y: 50, length: 5, angle: 0.3 },
  neckStub: { y: 10 },
} as const;

const SKELETON_GRIME = { x: 32, y: 40, rx: 32, ry: 26 } as const;

function hand(ctx: Ctx, x: number, y: number, spread: number): void {
  for (let i = 0; i < FINGERS.count; i++) {
    const offset = i - (FINGERS.count - 1) / 2;
    smallBone(
      ctx,
      x + offset * FINGERS.step,
      y + FINGERS.drop,
      FINGERS.length,
      Math.PI / 2 + offset * spread,
    );
  }
}

function pelvis(ctx: Ctx, cx: number, cy: number): void {
  const p = PELVIS;
  for (const [fill, dy] of [
    [BONE_SHADOW, p.shadowDrop],
    [BONE_MID, 0],
  ] as const) {
    ctx.fillStyle = fill;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * p.wingDx, cy + dy, p.wingRx, p.wingRy, side * p.wingTilt, 0, TWO_PI);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(cx - p.sacrumHalfWidth, cy + p.sacrumTop + dy);
    ctx.lineTo(cx + p.sacrumHalfWidth, cy + p.sacrumTop + dy);
    ctx.lineTo(cx, cy + p.sacrumBottom + dy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = BONE_LIGHT;
  for (const side of [-1, 1]) {
    ctx.fillRect(cx + side * p.wingDx - p.litWidth / 2, cy - p.litRise, p.litWidth, 1);
  }
}

function paintSlumpedSkeleton(ctx: Ctx, look: number, damaged: boolean): void {
  const s = SKELETON;
  const z = SKELETON_SIZES;
  const slump = HEAD_SLUMPS[look % HEAD_SLUMPS.length] ?? { dx: 0, dy: 0, tilt: 0 };

  dustShadow(ctx, s.pelvis.x, s.pelvis.y + SEAT_SHADOW.dy, SEAT_SHADOW.rx, SEAT_SHADOW.ry);

  // Back to front: the arm hanging behind the body, the chest, the pelvis, the
  // legs coming forward over it, the arm in the lap, and the drooped head.
  longBone(ctx, s.shoulderL.x, s.shoulderL.y, s.elbowL.x, s.elbowL.y, z.upperArm);
  longBone(ctx, s.elbowL.x, s.elbowL.y, s.handL.x, s.handL.y, z.forearm);
  hand(ctx, s.handL.x, s.handL.y, -FINGER_SPLAY);
  spine(
    ctx,
    s.pelvis.x,
    s.pelvis.y - z.spineFootRise,
    s.neck.x,
    s.neck.y + z.spineTopDrop,
    z.spineRadius,
  );
  ribFragment(ctx, s.chest.x - z.ribInset, s.chest.y, z.ribSize, z.ribCount, true);
  ribFragment(ctx, s.chest.x + z.ribInset, s.chest.y, z.ribSize, z.ribCount, false);
  longBone(
    ctx,
    s.shoulderL.x,
    s.shoulderL.y,
    s.neck.x - z.collarInset,
    s.neck.y + z.collarDrop,
    z.collarbone,
  );
  longBone(
    ctx,
    s.neck.x + z.collarInset,
    s.neck.y + z.collarDrop,
    s.shoulderR.x,
    s.shoulderR.y,
    z.collarbone,
  );
  pelvis(ctx, s.pelvis.x, s.pelvis.y);
  if (look === RAGGED_LOOK) {
    ctx.fillStyle = RAG_DARK;
    ctx.beginPath();
    RAG_OUTLINE.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = RAG_MID;
    ctx.fillRect(RAG_HEM.x, RAG_HEM.y, RAG_HEM.width, RAG_HEM.height);
  }
  longBone(ctx, s.hipL.x, s.hipL.y, s.kneeL.x, s.kneeL.y, z.femur);
  longBone(ctx, s.hipR.x, s.hipR.y, s.kneeR.x, s.kneeR.y, z.femur);
  longBone(ctx, s.kneeL.x, s.kneeL.y, s.footL.x, s.footL.y, z.shin);
  longBone(ctx, s.kneeR.x, s.kneeR.y, s.footR.x, s.footR.y, z.shin);
  for (const foot of [s.footL, s.footR]) {
    smallBone(ctx, foot.x - TOES.dx, foot.y + TOES.drop, TOES.length, Math.PI / 2 + TOES.splay);
    smallBone(ctx, foot.x + TOES.dx, foot.y + TOES.drop, TOES.length, Math.PI / 2 - TOES.splay);
  }

  if (damaged) {
    const arm = STRUCK.arm;
    longBone(ctx, arm.from.x, arm.from.y, arm.to.x, arm.to.y, z.forearm);
    smallBone(ctx, STRUCK.hand.x, STRUCK.hand.y, STRUCK.hand.length, STRUCK.hand.angle);
    // A bare stub of neck where the head was.
    spine(ctx, s.neck.x, STRUCK.neckStub.y, s.neck.x, s.neck.y + z.spineTopDrop, z.spineRadius);
    const k = STRUCK.skull;
    skull(ctx, k.x, k.y, k.size, k.tilt + slump.tilt, k.face, false);
  } else {
    longBone(ctx, s.shoulderR.x, s.shoulderR.y, s.elbowR.x, s.elbowR.y, z.upperArm);
    longBone(ctx, s.elbowR.x, s.elbowR.y, s.handR.x, s.handR.y, z.forearm);
    hand(ctx, s.handR.x, s.handR.y, FINGER_SPLAY);
    skull(ctx, s.neck.x + slump.dx, s.neck.y + slump.dy, z.skull, slump.tilt, DROOPED_FACE, false);
  }
  grime(ctx, SKELETON_GRIME.x, SKELETON_GRIME.y, SKELETON_GRIME.rx, SKELETON_GRIME.ry);
}

// ── Wreckage ──────────────────────────────────────────────────────────────────

const REMAINS_SEED = 0x2e44;
/** The skeleton's wreckage lies higher in its tile, against the wall it sat by. */
const WRECKAGE_CENTER_Y = { bone_pile: 40, slumped_skeleton: 32 } as const;
const WRECKAGE = {
  dustDrop: 4,
  dustRx: 30,
  dustRy: 14,
  boneCount: 7,
  boneLeft: 10,
  boneSpreadX: 44,
  boneRise: 6,
  boneSpreadY: 16,
  boneLengthMin: 8,
  boneLengthSpread: 14,
  /** Bones lying on the floor are seen foreshortened: half as deep as wide. */
  boneSquash: 0.5,
  boneThicknessMin: 2.4,
  ribLeft: 20,
  ribSpread: 10,
  ribSize: 10,
  ribCount: 3,
  skullX: 36,
  skullSpread: 8,
  skullSize: 13,
  skullTilt: 1.2,
  skullFace: 0.6,
  speckleSpread: 20,
  grimeRx: 32,
  grimeRy: 18,
  flipChance: 0.5,
} as const;

/** What is left once a heap or a skeleton is knocked apart: a low spread of bone and dust. */
function paintBoneWreckage(ctx: Ctx, kind: RemainsKind, look: number): void {
  const w = WRECKAGE;
  const rng = mulberry32(REMAINS_SEED + lookSeed(look) + (kind === 'slumped_skeleton' ? 1 : 0));
  const cy = WRECKAGE_CENTER_Y[kind];
  const centreX = REMAINS_AUTHORED_TILE / 2;
  dustShadow(ctx, centreX, cy + w.dustDrop, w.dustRx, w.dustRy, DUST_FLAT);
  for (let i = 0; i < w.boneCount; i++) {
    const x = w.boneLeft + rng() * w.boneSpreadX;
    const y = cy - w.boneRise + rng() * w.boneSpreadY;
    const a = rng() * Math.PI;
    const len = w.boneLengthMin + rng() * w.boneLengthSpread;
    longBone(
      ctx,
      x,
      y,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len * w.boneSquash,
      w.boneThicknessMin + rng(),
      FLAT_UNDERSIDE,
    );
  }
  ribFragment(
    ctx,
    w.ribLeft + rng() * w.ribSpread,
    cy,
    w.ribSize,
    w.ribCount,
    rng() < w.flipChance,
  );
  skull(
    ctx,
    w.skullX + signedUnit(rng) * w.skullSpread,
    cy + w.dustDrop,
    w.skullSize,
    w.skullTilt + signedUnit(rng),
    w.skullFace,
    false,
  );
  speckle(ctx, centreX, cy + w.dustDrop, w.speckleSpread, rng, BONE_LIGHT, BONE_DARK);
  grime(ctx, centreX, cy + w.dustDrop, w.grimeRx, w.grimeRy);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const BURST_CENTER_Y_FRACTION = 0.55;
const BONE_DEBRIS = {
  count: 16,
  spreadPx: 30,
  shades: BONE_SHADES,
  edge: BONE_SHADOW,
  curlPeriod: 0,
  curlShade: BONE_MID,
  lengthMin: 4,
  lengthSpread: 8,
  widthMin: 1.8,
  widthSpread: 1.6,
} as const;
const DEBRIS_SEEDS: Readonly<Record<RemainsKind, number>> = {
  bone_pile: 0x3c01,
  slumped_skeleton: 0x3c02,
};

/**
 * Paints one frame of a heap or a skeleton with the anchor tile's top-left at
 * (`ox`, `oy`). `frame` is the look for idle, damaged and remains, and the
 * frame of the break for shatter.
 */
export function drawRemainsProp(
  ctx: Ctx,
  kind: RemainsKind,
  state: RemainsState,
  frame: number,
  ox: number,
  oy: number,
  ts: number,
): void {
  if (state === 'shatter') {
    const progress = frame / (SHATTER_FRAMES - 1);
    drawDebrisBurst(
      ctx,
      radialDebris(DEBRIS_SEEDS[kind], BONE_DEBRIS),
      (c, cx, cy, radius, alpha) => puff(c, cx, cy, radius, alpha, DUST_RGB),
      ox + ts / 2,
      oy + ts * BURST_CENTER_Y_FRACTION,
      ts,
      progress,
    );
    return;
  }
  const look = frame % PROP_VARIANT_COUNT;
  inAuthoredTile(ctx, ox, oy, ts, () => {
    if (state === 'remains') paintBoneWreckage(ctx, kind, look);
    else if (kind === 'bone_pile') paintBonePile(ctx, look, state === 'damaged');
    else paintSlumpedSkeleton(ctx, look, state === 'damaged');
  });
}
