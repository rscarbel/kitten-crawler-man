/**
 * The electric goblin's kit, dressed on the goblin rig: rubberised insulating
 * armour, heavy insulated boots, a generator strapped to his back and a shock
 * rod in each fist, each rod wired to the generator.
 *
 * He is the biggest goblin in the dungeon by far, and at the 32-px tile he is
 * named by three shapes: the two copper coil towers standing up off his back
 * over his shoulders, the long rod with a ball on its end in each hand, and the
 * red cable looping from the generator to each rod. Mustard insulating rubber
 * over the green skin keeps him a goblin with his ears and face bare.
 *
 * Everything solid is a {@link GoblinOutfit} hook or a {@link GoblinProp}, so it
 * shares the figure's outline, rim and cast shadows. Light — the generator's
 * core, the charged balls and the arcs between them — is painted over the
 * finished figure by {@link drawElectricGoblinLight}, where an outline would
 * turn a glow into a sticker.
 *
 * Coordinates follow the rig: tile units, +X the way the goblin faces, -Y up.
 */

import {
  FULL_CIRCLE_ANGLE,
  LIGHT,
  NO_GEAR,
  along,
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
  traceSkull,
  type BoneChain,
  type GoblinOutfit,
  type GoblinProp,
  type GoblinProportions,
  type GoblinStyle,
  type Pt,
  type Ramp,
  type Skeleton,
} from './goblinArt';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;
const QUARTER = 0.25;

// ── Materials ────────────────────────────────────────────────────────────────

/**
 * Mustard insulating rubber, the lineman's colour: warm and pale enough to part
 * from the lime skin and from every dungeon floor, and far from the cool cyan
 * of the electricity so the light always reads as light.
 */
const RUBBER: Ramp = {
  shadow: '#3b2a07',
  dark: '#6d4f10',
  mid: '#a87d1a',
  light: '#d3a838',
  rim: '#f2d67c',
};

/** Black rubber: boots, gauntlet cuffs, knee pads, the rod grips and the skullcap. */
const BLACK_RUBBER: Ramp = {
  shadow: '#08090b',
  dark: '#15171b',
  mid: '#24272d',
  light: '#3a3e46',
  rim: '#6d737e',
};

/** Gunmetal for the generator housing and the rod shafts. */
const STEEL: Ramp = {
  shadow: '#171b21',
  dark: '#2e343d',
  mid: '#4d5560',
  light: '#78818e',
  rim: '#b9c2cd',
};

/** Coil windings and the rods' balls. */
const COPPER: Ramp = {
  shadow: '#3d1909',
  dark: '#783614',
  mid: '#b05823',
  light: '#dc8a44',
  rim: '#f8c48d',
};

/**
 * The cables: a saturated red, the one colour on him nothing else shares, so
 * the loop from back to fist reads as a wire at any size.
 */
const CABLE: Ramp = {
  shadow: '#3a0b09',
  dark: '#6c1511',
  mid: '#ac241b',
  light: '#d9473a',
  rim: '#f2837a',
};

/** Webbing for the generator's harness. */
const WEBBING: Ramp = {
  shadow: '#11140f',
  dark: '#1f241b',
  mid: '#323a2b',
  light: '#4a5540',
  rim: '#76846a',
};

/** The electricity: a white-hot core in a cyan glow fading to deep blue. */
const ARC_CORE = '#f6feff';
const ARC_GLOW = '#7fe9ff';
const ARC_DEEP = '#2a86ff';
/** The generator's glass at no charge, a cold dark teal. */
const CORE_GLASS_DEAD = '#173a44';
const CORE_GLASS_LIVE = '#9ff4ff';
const GOGGLE_GLASS = '#3fb8c9';
const GOGGLE_GLINT = '#e8fdff';

/** Every part with an edge of its own inside the silhouette gets this much ink round it. */
const PART_OUTLINE = 0.014;

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * The goblin proportions scaled and thickened: the same big skull on a
 * stooped body, but the shoulders, gut, hips and limbs all far heavier than
 * any other goblin's. Arms shorter than a scavenger's so the hands carry the
 * rods at the hips rather than at the knees.
 */
const ELECTRIC_GOBLIN_BUILD: GoblinProportions = {
  thighLength: 0.4,
  shinLength: 0.37,
  footHeight: 0.085,
  torsoLength: 0.44,
  neckLength: 0.03,
  headRadius: 0.27,
  headWidthFactor: 1.06,
  shoulderHalfWidth: 0.37,
  hipHalfWidth: 0.27,
  bellyBulge: 0.3,
  upperArmLength: 0.4,
  forearmLength: 0.42,
  legWidth: 0.2,
  armWidth: 0.17,
  handRadius: 0.14,
  footLength: 0.4,
  earLength: 0.42,
  noseProjection: 0.17,
};

/** Sole-to-skull height he stands at in play, in tile units, before the coils. */
const ELECTRIC_GOBLIN_HEIGHT = 1.85;

/** How much of its authored size the figure is drawn at; see `ARCHETYPE_SCALE`. */
export const ELECTRIC_GOBLIN_SCALE = ELECTRIC_GOBLIN_HEIGHT / figureHeight(ELECTRIC_GOBLIN_BUILD);

/** He carries the generator's weight upright: less hunch than a scavenger. */
const ELECTRIC_GOBLIN_HUNCH = deg(6);

// ── Generator state ──────────────────────────────────────────────────────────

/**
 * What the generator is doing on one frame. One frame's art is a pure function
 * of its row and frame, so the choreography works these out and the painters
 * read them; nothing here is per-instance.
 */
export interface GeneratorState {
  /** The flywheel's turn, in radians. */
  readonly spin: number;
  /** 0 is dead, 1 is the full charge of an attack; idle hums low. */
  readonly charge: number;
}

// ── Torso: the rubber coat ───────────────────────────────────────────────────

/** Horizontal seams between the coat's moulded rubber plates, as shares of the torso up from the hip. */
const COAT_SEAMS: readonly number[] = [0.3, 0.55, 0.78];
const COAT_SEAM_WIDTH = 0.016;
/** The lit band along each plate's upper edge, as a share of the torso. */
const COAT_SEAM_LIP = 0.03;
/**
 * The coat's light and shadow as hard bands. The terminator is a line across
 * the gut from the armpit down to the belly's front; above and behind it the
 * rubber is lit, below and in front of it it falls into core shadow.
 */
const COAT_TERMINATOR = { backY: -0.95, frontY: -0.2, frontX: 1.6, bowY: -0.35 } as const;
const COAT_LIT = { backX: -1.6, frontX: 0.15, lowY: -0.62 } as const;
const COAT_REACH = 2;
/** The black rubber chest plate over the sternum, in shoulder half-widths and torso lengths. */
const CHEST_PLATE = { back: -0.05, front: 1.05, top: -0.98, bottom: -0.58 } as const;
const HAZARD_STRIPES = 4;
const HAZARD_STRIPE_WIDTH = 0.05;

function drawRubberCoat(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const span = (p.hipHalfWidth + p.bellyBulge) * COAT_REACH;
  ctx.fillStyle = RUBBER.mid;
  ctx.fillRect(-span, -t * COAT_REACH, span * 2, t * COAT_REACH * 2);

  ctx.fillStyle = RUBBER.light;
  ctx.beginPath();
  ctx.moveTo(p.shoulderHalfWidth * COAT_LIT.backX, -t * COAT_REACH);
  ctx.lineTo(p.shoulderHalfWidth * COAT_LIT.frontX, -t * COAT_REACH);
  ctx.lineTo(p.shoulderHalfWidth * COAT_LIT.frontX, -t);
  ctx.quadraticCurveTo(
    -p.shoulderHalfWidth * HALF,
    -t,
    p.shoulderHalfWidth * COAT_LIT.backX,
    t * COAT_LIT.lowY,
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = RUBBER.dark;
  ctx.beginPath();
  ctx.moveTo(-span, t * COAT_TERMINATOR.backY + t);
  ctx.quadraticCurveTo(
    0,
    t * COAT_TERMINATOR.bowY,
    p.hipHalfWidth * COAT_TERMINATOR.frontX,
    t * COAT_TERMINATOR.frontY - t * HALF,
  );
  ctx.lineTo(span, -t * HALF);
  ctx.lineTo(span, t);
  ctx.lineTo(-span, t);
  ctx.closePath();
  ctx.fill();

  for (const seam of COAT_SEAMS) {
    const y = -t * seam;
    ctx.fillStyle = RUBBER.shadow;
    ctx.fillRect(-span, y, span * 2, COAT_SEAM_WIDTH);
    ctx.fillStyle = rgba(RUBBER.rim, HALF);
    ctx.fillRect(-span, y - t * COAT_SEAM_LIP, span * 2, COAT_SEAM_WIDTH * HALF);
  }

  const plate = (): void => {
    ctx.beginPath();
    ctx.rect(
      p.shoulderHalfWidth * CHEST_PLATE.back,
      t * CHEST_PLATE.top,
      p.shoulderHalfWidth * (CHEST_PLATE.front - CHEST_PLATE.back) * 2,
      t * (CHEST_PLATE.bottom - CHEST_PLATE.top),
    );
  };
  ctx.fillStyle = BLACK_RUBBER.mid;
  plate();
  ctx.fill();
  withClip(ctx, plate, () => {
    ctx.strokeStyle = RUBBER.light;
    ctx.lineWidth = HAZARD_STRIPE_WIDTH;
    const left = p.shoulderHalfWidth * CHEST_PLATE.back;
    const width = p.shoulderHalfWidth * (CHEST_PLATE.front - CHEST_PLATE.back) * 2;
    const height = t * (CHEST_PLATE.bottom - CHEST_PLATE.top);
    for (let i = 0; i <= HAZARD_STRIPES; i++) {
      const x = left + (width * i) / HAZARD_STRIPES;
      ctx.beginPath();
      ctx.moveTo(x, t * CHEST_PLATE.top);
      ctx.lineTo(x - height, t * CHEST_PLATE.bottom);
      ctx.stroke();
    }
  });
  ctx.strokeStyle = BLACK_RUBBER.shadow;
  ctx.lineWidth = PART_OUTLINE;
  plate();
  ctx.stroke();
}

// ── Hips: the trousers' seat and the belt ────────────────────────────────────

/**
 * The trousers' seat over the hips and the wide belt above it, in hip
 * half-widths (x) and torso lengths (y), hip at 0. Kept low and close to the
 * body: anything flaring off the hips turns his middle into a crate.
 */
const SEAT = { back: -1.05, front: 1.15, top: -0.12, bottom: 0.2 } as const;
const BELT = { top: -0.14, height: 0.1, back: -1.15, front: 1.6 } as const;
const BUCKLE = { x: 1.2, half: 0.055 } as const;

function drawBeltAndSeat(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const h = p.hipHalfWidth;
  ctx.fillStyle = RUBBER.dark;
  ctx.beginPath();
  ctx.ellipse(
    h * (SEAT.back + SEAT.front) * HALF,
    t * (SEAT.top + SEAT.bottom) * HALF,
    h * (SEAT.front - SEAT.back) * HALF,
    t * (SEAT.bottom - SEAT.top) * HALF,
    0,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();

  ctx.fillStyle = BLACK_RUBBER.mid;
  ctx.fillRect(h * BELT.back, t * BELT.top, h * (BELT.front - BELT.back), t * BELT.height);
  ctx.fillStyle = BLACK_RUBBER.light;
  ctx.fillRect(
    h * BELT.back,
    t * BELT.top,
    h * (BELT.front - BELT.back),
    t * BELT.height * QUARTER,
  );
  const buckle = pt(h * BUCKLE.x, t * (BELT.top + BELT.height * HALF));
  ctx.fillStyle = STEEL.light;
  ctx.fillRect(buckle.x - BUCKLE.half, buckle.y - BUCKLE.half, BUCKLE.half * 2, BUCKLE.half * 2);
  ctx.strokeStyle = STEEL.shadow;
  ctx.lineWidth = PART_OUTLINE;
  ctx.strokeRect(buckle.x - BUCKLE.half, buckle.y - BUCKLE.half, BUCKLE.half * 2, BUCKLE.half * 2);
}

// ── Legs and boots ───────────────────────────────────────────────────────────

/**
 * The lit band down a rubber tube's upper segment, toward the key light: from
 * and to as shares of the segment, widths as shares of the tube's half-width.
 * A hard band rather than a gradient, so the terminator reads as a line.
 */
const SHEEN = { from: 0.1, to: 0.82, rootWidth: 0.35, endWidth: 0.3 } as const;
const TROUSER_WIDTH = 1.3;
const TROUSER_KNEE = 1.05;
/** The boot's shaft covers the shin from this far down it. */
const BOOT_SHAFT_FROM = 0.55;
const BOOT_SHAFT_WIDTH = 1.4;
const BOOT_CUFF_WIDTH = 1.55;
const BOOT_CUFF_DEPTH = 0.1;
const KNEE_PAD_RADIUS = 0.45;
/** The pad's lit quarter, toward the key light. */
const PAD_LIT_FROM = deg(190);
const PAD_LIT_TO = deg(280);

/**
 * Where a round-ended tube of `radius` down the shin has to stop so its end
 * cap meets the sole rather than pushing through the floor under the ankle.
 */
function aboveSole(chain: BoneChain, radius: number, footHeight: number): Pt {
  const shin = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const back = Math.max(0, radius - footHeight);
  return shin === 0 ? chain.end : mixPt(chain.end, chain.joint, Math.min(1, back / shin));
}

function drawRubberLeg(ctx: Ctx, chain: BoneChain, style: GoblinStyle, near: boolean): void {
  const legWidth = style.proportions.legWidth;
  const footHeight = style.proportions.footHeight;
  const half = (legWidth * TROUSER_WIDTH) / 2;
  const fill = near ? RUBBER.mid : RUBBER.dark;
  fillCapsule(ctx, chain.anchor, chain.joint, half, half * TROUSER_KNEE, fill);
  fillCapsule(
    ctx,
    chain.joint,
    aboveSole(chain, half * TROUSER_KNEE, footHeight),
    half * TROUSER_KNEE,
    half * TROUSER_KNEE,
    fill,
  );
  if (near) {
    const lit = (at: Pt): Pt => offset(at, LIGHT.x * half * HALF, LIGHT.y * half * HALF);
    fillCapsule(
      ctx,
      lit(mixPt(chain.anchor, chain.joint, SHEEN.from)),
      lit(mixPt(chain.anchor, chain.joint, SHEEN.to)),
      half * SHEEN.rootWidth,
      half * SHEEN.endWidth,
      RUBBER.light,
    );
  }

  const shaftTop = mixPt(chain.joint, chain.end, BOOT_SHAFT_FROM);
  const shaftHalf = (legWidth * BOOT_SHAFT_WIDTH) / 2;
  const bootFill = near ? BLACK_RUBBER.mid : BLACK_RUBBER.dark;
  fillCapsule(
    ctx,
    shaftTop,
    aboveSole(chain, shaftHalf, footHeight),
    shaftHalf,
    shaftHalf,
    bootFill,
  );
  const cuffEnd = mixPt(chain.joint, chain.end, BOOT_SHAFT_FROM + BOOT_CUFF_DEPTH);
  const cuffHalf = (legWidth * BOOT_CUFF_WIDTH) / 2;
  fillCapsule(
    ctx,
    shaftTop,
    cuffEnd,
    cuffHalf,
    cuffHalf,
    near ? BLACK_RUBBER.light : BLACK_RUBBER.mid,
  );

  ctx.fillStyle = near ? BLACK_RUBBER.mid : BLACK_RUBBER.dark;
  ctx.beginPath();
  ctx.arc(chain.joint.x, chain.joint.y, legWidth * KNEE_PAD_RADIUS, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  if (near) {
    ctx.fillStyle = BLACK_RUBBER.rim;
    ctx.beginPath();
    ctx.arc(chain.joint.x, chain.joint.y, legWidth * KNEE_PAD_RADIUS, PAD_LIT_FROM, PAD_LIT_TO);
    ctx.lineTo(chain.joint.x, chain.joint.y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The insulated boot in the foot's frame: a tall rounded toe cap, a sole far
 * thicker than a bare goblin foot's, and a square heel block. Big and blunt on
 * purpose: at 32 px the feet are two dark blocks that plant him.
 */
const BOOT = {
  heel: -0.3,
  toe: 0.82,
  toeCapRise: 2.4,
  ankleRise: 2,
  soleDepth: 0.42,
  treadInset: 0.2,
} as const;

/** A boot this far up off its planted height, in tile units, turns with its shin in full. */
const BOOT_TILT_FULL_LIFT = 0.06;

function drawInsulatedBoot(
  ctx: Ctx,
  ankle: Pt,
  tilt: number,
  style: GoblinStyle,
  near: boolean,
): void {
  const lift = Math.max(0, -ankle.y - style.proportions.footHeight);
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(tilt * Math.min(1, lift / BOOT_TILT_FULL_LIFT));
  paintBoot(ctx, style, near);
  ctx.restore();
}

function paintBoot(ctx: Ctx, style: GoblinStyle, near: boolean): void {
  const p = style.proportions;
  const length = p.footLength;
  const sole = p.footHeight;
  const heel = length * BOOT.heel;
  const toe = length * BOOT.toe;
  const ramp = BLACK_RUBBER;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(heel, -sole * BOOT.ankleRise);
    ctx.lineTo(heel, sole);
    ctx.lineTo(toe, sole);
    ctx.quadraticCurveTo(toe + sole, sole, toe, -sole * HALF);
    ctx.quadraticCurveTo(toe * HALF, -sole * BOOT.toeCapRise, 0, -sole * BOOT.toeCapRise);
    ctx.lineTo(heel, -sole * BOOT.ankleRise);
    ctx.closePath();
  };
  ctx.fillStyle = near ? ramp.mid : ramp.dark;
  trace();
  ctx.fill();
  withClip(ctx, trace, () => {
    ctx.fillStyle = near ? ramp.light : ramp.mid;
    ctx.fillRect(heel, -sole * BOOT.toeCapRise * 2, (toe - heel) * HALF, sole * BOOT.ankleRise);
    ctx.fillStyle = RUBBER.dark;
    ctx.fillRect(
      heel,
      sole * (1 - BOOT.soleDepth * 2),
      toe - heel + sole,
      sole * BOOT.soleDepth * 2,
    );
    ctx.fillStyle = RUBBER.light;
    ctx.fillRect(
      heel,
      sole * (1 - BOOT.soleDepth * 2),
      toe - heel + sole,
      sole * BOOT.soleDepth * HALF,
    );
  });
}

// ── Arms: sleeves, gauntlet cuffs and the cables ─────────────────────────────

const SLEEVE_WIDTH = 1.2;
const SLEEVE_WRIST_TAPER = 0.9;
const ELBOW_PAD_RADIUS = 0.45;
/** The gauntlet's cuff flares over the forearm from this far down it. */
const GAUNTLET_FROM = 0.55;
const GAUNTLET_ROOT_WIDTH = 1.45;
const GAUNTLET_FLARE_WIDTH = 1.75;

function drawRubberSleeve(ctx: Ctx, chain: BoneChain, width: number, near: boolean): void {
  const half = (width * SLEEVE_WIDTH) / 2;
  const fill = near ? RUBBER.mid : RUBBER.dark;
  fillCapsule(ctx, chain.anchor, chain.joint, half, half, fill);
  fillCapsule(ctx, chain.joint, chain.end, half, half * SLEEVE_WRIST_TAPER, fill);
  if (near) {
    const lit = (at: Pt): Pt => offset(at, LIGHT.x * half * HALF, LIGHT.y * half * HALF);
    fillCapsule(
      ctx,
      lit(mixPt(chain.anchor, chain.joint, SHEEN.from)),
      lit(mixPt(chain.anchor, chain.joint, SHEEN.to)),
      half * SHEEN.rootWidth,
      half * SHEEN.endWidth,
      RUBBER.light,
    );
  }
  ctx.fillStyle = near ? BLACK_RUBBER.mid : BLACK_RUBBER.dark;
  ctx.beginPath();
  ctx.arc(chain.joint.x, chain.joint.y, width * ELBOW_PAD_RADIUS, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  const cuffFrom = mixPt(chain.joint, chain.end, GAUNTLET_FROM);
  fillCapsule(
    ctx,
    cuffFrom,
    chain.end,
    (width * GAUNTLET_ROOT_WIDTH) / 2,
    (width * GAUNTLET_FLARE_WIDTH) / 2,
    near ? BLACK_RUBBER.mid : BLACK_RUBBER.dark,
  );
  if (near) {
    fillCapsule(
      ctx,
      offset(cuffFrom, LIGHT.x * width * QUARTER, LIGHT.y * width * QUARTER),
      offset(chain.end, LIGHT.x * width * QUARTER, LIGHT.y * width * QUARTER),
      width * QUARTER * HALF,
      width * QUARTER * HALF,
      BLACK_RUBBER.light,
    );
  }
}

/** Thickness of a cable, in tile units: two screen pixels at the 32-px tile once drawn. */
const CABLE_WIDTH = 0.05;
/** How far a cable sags below the straight line from shoulder to rod, per tile of that line. */
const CABLE_SAG_PER_TILE = 0.3;
const CABLE_MIN_SAG = 0.08;
/** Where the cable crosses the shoulder: up off the joint by this share of the arm's width. */
const CABLE_SHOULDER_LIFT = 0.55;

/** A thick outlined cable along a quadratic chain through `points`. */
function strokeCable(ctx: Ctx, points: readonly Pt[], near: boolean, outline: string): void {
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const corner = points[i];
      const next = mixPt(corner, points[i + 1], i === points.length - 2 ? 1 : HALF);
      ctx.quadraticCurveTo(corner.x, corner.y, next.x, next.y);
    }
    if (points.length === 2) ctx.lineTo(points[1].x, points[1].y);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = CABLE_WIDTH + PART_OUTLINE * 2;
  trace();
  ctx.stroke();
  ctx.strokeStyle = near ? CABLE.mid : CABLE.dark;
  ctx.lineWidth = CABLE_WIDTH;
  trace();
  ctx.stroke();
  if (!near) return;
  ctx.save();
  ctx.translate(LIGHT.x * CABLE_WIDTH * QUARTER, LIGHT.y * CABLE_WIDTH * QUARTER);
  ctx.strokeStyle = CABLE.light;
  ctx.lineWidth = CABLE_WIDTH * QUARTER;
  trace();
  ctx.stroke();
  ctx.restore();
}

/**
 * The cable from the generator to the rod in this arm's fist: up out of the
 * pack's port, over the shoulder, then hanging in a loose loop under the arm
 * to the connector on the rod's butt. Solved from the arm on every frame, so
 * it follows the fist wherever the row puts it.
 */
function drawRodCable(
  ctx: Ctx,
  chain: BoneChain,
  width: number,
  wristAngle: number,
  style: GoblinStyle,
  near: boolean,
  skeleton: Skeleton,
): void {
  const port = generatorCablePort(skeleton, style, near);
  const shoulder = offset(chain.anchor, 0, -width * CABLE_SHOULDER_LIFT);
  const butt = rodButtPoint(chain.end, wristAngle);
  const span = Math.hypot(butt.x - shoulder.x, butt.y - shoulder.y);
  const sag = Math.max(CABLE_MIN_SAG, span * CABLE_SAG_PER_TILE);
  const belly = offset(mixPt(shoulder, butt, HALF), 0, sag);
  strokeCable(ctx, [port, shoulder, belly, butt], near, style.palette.outline);
}

function drawElectricArm(
  ctx: Ctx,
  chain: BoneChain,
  width: number,
  wristAngle: number,
  style: GoblinStyle,
  near: boolean,
  skeleton: Skeleton,
): void {
  drawRubberSleeve(ctx, chain, width, near);
  drawRodCable(ctx, chain, width, wristAngle, style, near, skeleton);
}

// ── Head: rubber skullcap and goggles ────────────────────────────────────────

/** The skullcap covers the skull above this line, in head radii (y) at the back and the front. */
const CAP_EDGE = { backY: -0.05, frontY: -0.42 } as const;
const CAP_RIDGE_WIDTH = 0.05;
/** The cap's lit dome toward the key light, in head half-widths and radii. */
const CAP_SHINE = { x: -0.25, y: -0.7, rx: 0.55, ry: 0.3, tilt: deg(-15) } as const;
/**
 * Paths that only need to run off the skull's edge before the skull clips
 * them reach this far out, in head half-widths and radii.
 */
const PAST_SKULL = 2;
/** The strap's buckle end behind the ear, in head half-widths and radii. */
const STRAP_BACK = { x: -0.95, y: -0.1 } as const;
/** The lens's lit rim, as an arc of its ring. */
const LENS_RIM_FROM = deg(180);
const LENS_RIM_TO = deg(290);
/** The goggle lens on the brow, in head half-widths (x) and head radii (y). */
const GOGGLE = { x: 0.48, y: -0.5, radius: 0.27, ring: 0.3 } as const;
const GOGGLE_STRAP_WIDTH = 0.16;

function drawElectricHead(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const capTrace = (): void => {
    ctx.beginPath();
    ctx.moveTo(-rx * PAST_SKULL, r * CAP_EDGE.backY);
    ctx.lineTo(rx * PAST_SKULL, r * CAP_EDGE.frontY);
    ctx.lineTo(rx * PAST_SKULL, -r * PAST_SKULL);
    ctx.lineTo(-rx * PAST_SKULL, -r * PAST_SKULL);
    ctx.closePath();
  };
  withClip(
    ctx,
    () => traceSkull(ctx, p),
    () => {
      ctx.fillStyle = BLACK_RUBBER.mid;
      capTrace();
      ctx.fill();
      withClip(ctx, capTrace, () => {
        ctx.fillStyle = BLACK_RUBBER.light;
        ctx.beginPath();
        ctx.ellipse(
          rx * CAP_SHINE.x,
          r * CAP_SHINE.y,
          rx * CAP_SHINE.rx,
          r * CAP_SHINE.ry,
          CAP_SHINE.tilt,
          0,
          FULL_CIRCLE_ANGLE,
        );
        ctx.fill();
      });
      ctx.strokeStyle = BLACK_RUBBER.shadow;
      ctx.lineWidth = CAP_RIDGE_WIDTH * r;
      ctx.beginPath();
      ctx.moveTo(-rx * PAST_SKULL, r * CAP_EDGE.backY);
      ctx.lineTo(rx * PAST_SKULL, r * CAP_EDGE.frontY);
      ctx.stroke();
    },
  );
  const lens = pt(rx * GOGGLE.x, r * GOGGLE.y);
  const lensRadius = r * GOGGLE.radius;
  ctx.strokeStyle = BLACK_RUBBER.dark;
  ctx.lineWidth = r * GOGGLE_STRAP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(rx * STRAP_BACK.x, r * STRAP_BACK.y);
  ctx.lineTo(lens.x, lens.y);
  ctx.stroke();
  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, lensRadius * (1 + GOGGLE.ring * HALF), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = COPPER.mid;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, lensRadius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = COPPER.rim;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, lensRadius, LENS_RIM_FROM, LENS_RIM_TO);
  ctx.lineTo(lens.x, lens.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOGGLE_GLASS;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, lensRadius * (1 - GOGGLE.ring), 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = GOGGLE_GLINT;
  ctx.beginPath();
  ctx.arc(
    lens.x - lensRadius * QUARTER,
    lens.y - lensRadius * QUARTER,
    lensRadius * QUARTER,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
}

// ── The generator on his back ────────────────────────────────────────────────

/**
 * The generator in pack space: the top of the spine at the origin, turned with
 * the spine, +Y down the back and -X away behind him. The housing's front face
 * sits against his back; the two coil towers stand up off its top, above his
 * shoulders and behind his head, where they break the silhouette on every row.
 */
const PACK = {
  /** Where the housing's front face sits, in shoulder half-widths behind the spine. */
  backFace: -0.98,
  depth: 0.4,
  rise: 0.14,
  height: 0.64,
  corner: 0.07,
} as const;
const COIL = {
  /** Each tower's centre, as a share of the housing's depth back from its front face. */
  at: [0.28, 0.74] as const,
  halfWidth: 0.065,
  height: [0.36, 0.3] as const,
  turns: 6,
  capRadius: 0.07,
} as const;
const FLYWHEEL = {
  litFrom: deg(160),
  litTo: deg(300),
  across: 0.5,
  down: 0.7,
  radius: 0.2,
  hub: 0.05,
  spokes: 4,
  rim: 0.035,
} as const;
const CORE_WINDOW = { across: 0.5, down: 0.26, halfWidth: 0.09, halfHeight: 0.12 } as const;
/** The two cable ports on the housing's front top corner, the far one a touch deeper. */
const PORT = { across: 0.06, down: 0.06, farDown: 0.12, radius: 0.04 } as const;
const PACK_LIT_SHARE = 0.32;
const PACK_SHADE_SHARE = 0.3;
const RIVETS = 3;
const RIVET_RADIUS = 0.016;

function packFront(style: GoblinStyle): number {
  return style.proportions.shoulderHalfWidth * PACK.backFace;
}

/** A point given in pack space placed in figure space. */
function packToFigure(skeleton: Skeleton, style: GoblinStyle, local: Pt): Pt {
  const turned = rotatePt(pt(packFront(style) + local.x, local.y), skeleton.lean);
  return offset(skeleton.spineTop, turned.x, turned.y);
}

/** Where a rod's cable leaves the generator, in figure space. */
function generatorCablePort(skeleton: Skeleton, style: GoblinStyle, near: boolean): Pt {
  return packToFigure(
    skeleton,
    style,
    pt(-PACK.depth * PORT.across, near ? PACK.depth * PORT.down : PACK.depth * PORT.farDown),
  );
}

/** The middle of the generator's glowing core window, in figure space. */
function generatorCorePoint(skeleton: Skeleton, style: GoblinStyle): Pt {
  return packToFigure(
    skeleton,
    style,
    pt(-PACK.depth * CORE_WINDOW.across, PACK.height * CORE_WINDOW.down),
  );
}

/** The top of each coil tower, in figure space: where the generator's own arcs leap from. */
function generatorCoilTops(skeleton: Skeleton, style: GoblinStyle): readonly Pt[] {
  return COIL.at.map((share, i) =>
    packToFigure(skeleton, style, pt(-PACK.depth * share, -PACK.rise - COIL.height[i])),
  );
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCoilTower(
  ctx: Ctx,
  centreX: number,
  base: number,
  height: number,
  outline: string,
): void {
  const top = base - height;
  const w = COIL.halfWidth;
  ctx.fillStyle = outline;
  ctx.fillRect(
    centreX - w - PART_OUTLINE,
    top - PART_OUTLINE,
    (w + PART_OUTLINE) * 2,
    height + PART_OUTLINE,
  );
  ctx.fillStyle = COPPER.mid;
  ctx.fillRect(centreX - w, top, w * 2, height);
  const turn = height / COIL.turns;
  for (let i = 0; i < COIL.turns; i++) {
    const y = top + turn * i;
    ctx.fillStyle = COPPER.light;
    ctx.fillRect(centreX - w, y, w * 2, turn * HALF);
    ctx.fillStyle = COPPER.dark;
    ctx.fillRect(centreX - w, y + turn * (1 - QUARTER), w * 2, turn * QUARTER);
  }
  ctx.fillStyle = rgba(COPPER.rim, HALF);
  ctx.fillRect(centreX - w, top, w * HALF, height);
  ctx.fillStyle = rgba(COPPER.shadow, HALF);
  ctx.fillRect(centreX + w * HALF, top, w * HALF, height);
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(centreX, top, COIL.capRadius + PART_OUTLINE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = STEEL.light;
  ctx.beginPath();
  ctx.arc(centreX, top, COIL.capRadius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = STEEL.rim;
  ctx.beginPath();
  ctx.arc(centreX, top, COIL.capRadius, LENS_RIM_FROM, LENS_RIM_TO);
  ctx.lineTo(centreX, top);
  ctx.closePath();
  ctx.fill();
}

function drawFlywheel(ctx: Ctx, centre: Pt, spin: number, outline: string): void {
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, FLYWHEEL.radius + PART_OUTLINE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = STEEL.dark;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, FLYWHEEL.radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.strokeStyle = STEEL.light;
  ctx.lineWidth = FLYWHEEL.rim;
  ctx.beginPath();
  ctx.arc(
    centre.x,
    centre.y,
    FLYWHEEL.radius - FLYWHEEL.rim * HALF,
    FLYWHEEL.litFrom,
    FLYWHEEL.litTo,
  );
  ctx.stroke();
  ctx.strokeStyle = STEEL.mid;
  ctx.lineWidth = FLYWHEEL.rim;
  for (let i = 0; i < FLYWHEEL.spokes; i++) {
    const angle = spin + (i * Math.PI) / FLYWHEEL.spokes;
    const reach = FLYWHEEL.radius - FLYWHEEL.rim;
    ctx.beginPath();
    ctx.moveTo(centre.x - Math.cos(angle) * reach, centre.y - Math.sin(angle) * reach);
    ctx.lineTo(centre.x + Math.cos(angle) * reach, centre.y + Math.sin(angle) * reach);
    ctx.stroke();
  }
  ctx.fillStyle = COPPER.light;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, FLYWHEEL.hub, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

function drawGenerator(
  ctx: Ctx,
  spineTop: Pt,
  lean: number,
  style: GoblinStyle,
  generator: GeneratorState,
): void {
  const outline = style.palette.outline;
  ctx.save();
  ctx.translate(spineTop.x, spineTop.y);
  ctx.rotate(lean);
  ctx.translate(packFront(style), 0);
  const left = -PACK.depth;
  const top = -PACK.rise;

  COIL.at.forEach((share, i) => {
    drawCoilTower(ctx, -PACK.depth * share, top + PART_OUTLINE, COIL.height[i], outline);
  });

  const housing = (): void =>
    roundedRect(ctx, left, top, PACK.depth, PACK.height + PACK.rise, PACK.corner);
  ctx.fillStyle = STEEL.mid;
  housing();
  ctx.fill();
  withClip(ctx, housing, () => {
    ctx.fillStyle = STEEL.light;
    ctx.fillRect(left, top, PACK.depth, (PACK.height + PACK.rise) * PACK_LIT_SHARE);
    ctx.fillStyle = STEEL.dark;
    ctx.fillRect(
      left,
      top + (PACK.height + PACK.rise) * (1 - PACK_SHADE_SHARE),
      PACK.depth,
      (PACK.height + PACK.rise) * PACK_SHADE_SHARE,
    );
    ctx.fillStyle = STEEL.rim;
    ctx.fillRect(left, top, PACK.depth, PART_OUTLINE * 2);
    ctx.fillStyle = STEEL.shadow;
    ctx.fillRect(-PART_OUTLINE * 2, top, PART_OUTLINE * 2, PACK.height + PACK.rise);
  });
  ctx.strokeStyle = outline;
  ctx.lineWidth = PART_OUTLINE;
  housing();
  ctx.stroke();

  ctx.fillStyle = STEEL.rim;
  for (let i = 0; i < RIVETS; i++) {
    const x = lerp(left + PACK.corner, -PACK.corner, i / (RIVETS - 1));
    ctx.beginPath();
    ctx.arc(x, top + PACK.corner, RIVET_RADIUS, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }

  const window = pt(-PACK.depth * CORE_WINDOW.across, PACK.height * CORE_WINDOW.down);
  ctx.fillStyle = outline;
  ctx.fillRect(
    window.x - CORE_WINDOW.halfWidth - PART_OUTLINE,
    window.y - CORE_WINDOW.halfHeight - PART_OUTLINE,
    (CORE_WINDOW.halfWidth + PART_OUTLINE) * 2,
    (CORE_WINDOW.halfHeight + PART_OUTLINE) * 2,
  );
  ctx.fillStyle = mix(CORE_GLASS_DEAD, CORE_GLASS_LIVE, generator.charge);
  ctx.fillRect(
    window.x - CORE_WINDOW.halfWidth,
    window.y - CORE_WINDOW.halfHeight,
    CORE_WINDOW.halfWidth * 2,
    CORE_WINDOW.halfHeight * 2,
  );
  ctx.fillStyle = rgba(ARC_CORE, generator.charge * HALF);
  ctx.fillRect(
    window.x - CORE_WINDOW.halfWidth * QUARTER,
    window.y - CORE_WINDOW.halfHeight,
    CORE_WINDOW.halfWidth * HALF,
    CORE_WINDOW.halfHeight * 2,
  );

  drawFlywheel(
    ctx,
    pt(-PACK.depth * FLYWHEEL.across, PACK.height * FLYWHEEL.down),
    generator.spin,
    outline,
  );

  for (const down of [PORT.down, PORT.farDown]) {
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.arc(
      -PACK.depth * PORT.across,
      PACK.depth * down,
      PORT.radius + PART_OUTLINE,
      0,
      FULL_CIRCLE_ANGLE,
    );
    ctx.fill();
    ctx.fillStyle = BLACK_RUBBER.light;
    ctx.beginPath();
    ctx.arc(-PACK.depth * PORT.across, PACK.depth * down, PORT.radius, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
  ctx.restore();
}

/** The harness: a strap over the shoulder to the chest, and a belly strap round the coat. */
/**
 * The harness, in shoulder or hip half-widths (x) and torso lengths (y), hip
 * at 0: a strap over the shoulder to the chest, and a belly strap that sags
 * under the gut and rises over its front.
 */
const STRAP = {
  width: 0.07,
  shoulderX: -0.75,
  shoulderY: -1.02,
  overShoulderY: -1.05,
  chestX: 0.75,
  chestY: -0.5,
  bellyBackX: -1.05,
  bellyY: -0.38,
  bellySag: 0.06,
  bellyFrontX: 1.1,
  bellyFrontRise: -0.04,
} as const;

function drawHarness(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const t = p.torsoLength;
  const strap = (from: Pt, via: Pt, to: Pt): void => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = style.palette.outline;
    ctx.lineWidth = STRAP.width + PART_OUTLINE * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(via.x, via.y, to.x, to.y);
    ctx.stroke();
    ctx.strokeStyle = WEBBING.mid;
    ctx.lineWidth = STRAP.width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(via.x, via.y, to.x, to.y);
    ctx.stroke();
  };
  strap(
    pt(p.shoulderHalfWidth * STRAP.shoulderX, t * STRAP.shoulderY),
    pt(p.shoulderHalfWidth * HALF, t * STRAP.overShoulderY),
    pt(p.shoulderHalfWidth * STRAP.chestX, t * STRAP.chestY),
  );
  strap(
    pt(p.shoulderHalfWidth * STRAP.bellyBackX, t * STRAP.bellyY),
    pt(0, t * (STRAP.bellyY + STRAP.bellySag)),
    pt(
      p.hipHalfWidth + p.bellyBulge * STRAP.bellyFrontX,
      t * (STRAP.bellyY + STRAP.bellyFrontRise),
    ),
  );
}

// ── The shock rod ────────────────────────────────────────────────────────────

/**
 * The rod in the fist's frame (+X out along the rod from the grip): a ribbed
 * black rubber grip with a connector on its butt, a rubber guard disc, a thick
 * steel pole and a copper ball on the end.
 */
const ROD = {
  butt: 0.13,
  gripEnd: 0.13,
  guardAt: 0.16,
  guardHalf: 0.075,
  guardThick: 0.035,
  tip: 0.84,
  gripHalf: 0.045,
  shaftHalf: 0.034,
  ballRadius: 0.088,
  connectorRadius: 0.042,
  gripRibs: 3,
} as const;

/** The ball's shaded half, away from the key light, and its lit cap, as a share of its radius. */
const BALL_SHADE_FROM = deg(-20);
const BALL_SHADE_TO = deg(140);
const BALL_LIT_SHARE = 0.6;

/** Radius of the rod's ball, in tile units. */
const ROD_BALL_RADIUS = ROD.ballRadius;

/** The connector on the rod's butt, where its cable plugs in, for a fist at `hand`. */
function rodButtPoint(hand: Pt, wristAngle: number): Pt {
  return along(hand, wristAngle, -ROD.butt);
}

/** The middle of the rod's ball for a fist at `hand`. */
export function rodBallPoint(hand: Pt, wristAngle: number): Pt {
  return along(hand, wristAngle, ROD.tip);
}

/** The shock grenade riding on a rod's ball until it is flung. */
const GRENADE = { halfLength: 0.07, halfWidth: 0.055, bandHalf: 0.016, capHalf: 0.03 } as const;

function paintRod(ctx: Ctx, hand: Pt, wristAngle: number, grenade: boolean, outline: string): void {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(wristAngle);

  ctx.fillStyle = outline;
  ctx.fillRect(
    -ROD.butt,
    -ROD.gripHalf - PART_OUTLINE,
    ROD.butt + ROD.tip,
    (ROD.gripHalf + PART_OUTLINE) * 2,
  );
  ctx.fillStyle = STEEL.mid;
  ctx.fillRect(ROD.gripEnd, -ROD.shaftHalf, ROD.tip - ROD.gripEnd, ROD.shaftHalf * 2);
  ctx.fillStyle = STEEL.rim;
  ctx.fillRect(ROD.gripEnd, -ROD.shaftHalf, ROD.tip - ROD.gripEnd, ROD.shaftHalf * HALF);
  ctx.fillStyle = STEEL.shadow;
  ctx.fillRect(ROD.gripEnd, ROD.shaftHalf * HALF, ROD.tip - ROD.gripEnd, ROD.shaftHalf * HALF);

  ctx.fillStyle = BLACK_RUBBER.mid;
  ctx.fillRect(-ROD.butt, -ROD.gripHalf, ROD.butt + ROD.gripEnd, ROD.gripHalf * 2);
  ctx.fillStyle = BLACK_RUBBER.rim;
  for (let i = 0; i < ROD.gripRibs; i++) {
    const x = lerp(-ROD.butt, ROD.gripEnd, (i + 1) / (ROD.gripRibs + 1));
    ctx.fillRect(x, -ROD.gripHalf, PART_OUTLINE, ROD.gripHalf * 2);
  }

  ctx.fillStyle = outline;
  ctx.fillRect(
    ROD.guardAt - PART_OUTLINE,
    -ROD.guardHalf - PART_OUTLINE,
    ROD.guardThick + PART_OUTLINE * 2,
    (ROD.guardHalf + PART_OUTLINE) * 2,
  );
  ctx.fillStyle = BLACK_RUBBER.light;
  ctx.fillRect(ROD.guardAt, -ROD.guardHalf, ROD.guardThick, ROD.guardHalf * 2);

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(-ROD.butt, 0, ROD.connectorRadius + PART_OUTLINE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = COPPER.dark;
  ctx.beginPath();
  ctx.arc(-ROD.butt, 0, ROD.connectorRadius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(ROD.tip, 0, ROD.ballRadius + PART_OUTLINE, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.fillStyle = COPPER.mid;
  ctx.beginPath();
  ctx.arc(ROD.tip, 0, ROD.ballRadius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
  ctx.restore();

  // The ball's light is laid in figure space, so it stays upper-left however the rod turns.
  const ball = rodBallPoint(hand, wristAngle);
  ctx.fillStyle = COPPER.shadow;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ROD.ballRadius, BALL_SHADE_FROM, BALL_SHADE_TO);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COPPER.light;
  ctx.beginPath();
  ctx.arc(
    ball.x + LIGHT.x * ROD.ballRadius * QUARTER,
    ball.y + LIGHT.y * ROD.ballRadius * QUARTER,
    ROD.ballRadius * BALL_LIT_SHARE,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();
  ctx.fillStyle = COPPER.rim;
  ctx.beginPath();
  ctx.arc(
    ball.x + LIGHT.x * ROD.ballRadius * HALF,
    ball.y + LIGHT.y * ROD.ballRadius * HALF,
    ROD.ballRadius * QUARTER,
    0,
    FULL_CIRCLE_ANGLE,
  );
  ctx.fill();

  if (grenade)
    drawShockGrenade(
      ctx,
      along(ball, wristAngle, ROD.ballRadius + GRENADE.halfLength),
      wristAngle,
      outline,
    );
}

/**
 * A shock grenade: a squat steel canister with a cyan band round its middle and
 * copper caps, standing off the ball it is clamped to.
 */
function drawShockGrenade(ctx: Ctx, centre: Pt, angle: number, outline: string): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(angle);
  const body = (): void =>
    roundedRect(
      ctx,
      -GRENADE.halfLength,
      -GRENADE.halfWidth,
      GRENADE.halfLength * 2,
      GRENADE.halfWidth * 2,
      GRENADE.halfWidth * HALF,
    );
  ctx.fillStyle = outline;
  ctx.fillRect(
    -GRENADE.halfLength - PART_OUTLINE,
    -GRENADE.halfWidth - PART_OUTLINE,
    (GRENADE.halfLength + PART_OUTLINE) * 2,
    (GRENADE.halfWidth + PART_OUTLINE) * 2,
  );
  ctx.fillStyle = STEEL.light;
  body();
  ctx.fill();
  ctx.fillStyle = COPPER.mid;
  ctx.fillRect(-GRENADE.halfLength, -GRENADE.halfWidth, GRENADE.capHalf, GRENADE.halfWidth * 2);
  ctx.fillRect(
    GRENADE.halfLength - GRENADE.capHalf,
    -GRENADE.halfWidth,
    GRENADE.capHalf,
    GRENADE.halfWidth * 2,
  );
  ctx.fillStyle = ARC_GLOW;
  ctx.fillRect(-GRENADE.bandHalf, -GRENADE.halfWidth, GRENADE.bandHalf * 2, GRENADE.halfWidth * 2);
  ctx.restore();
}

/** A shock rod. `grenade` clamps a shock grenade to its ball, ready to be flung. */
export function makeShockRodProp(grenade: boolean): GoblinProp {
  const outline = goblinPalette().outline;
  return {
    tipDistance: ROD.tip + ROD.ballRadius + (grenade ? GRENADE.halfLength * 2 : 0),
    offGripDistance: null,
    headHalfHeight: ROD.ballRadius,
    paint: (ctx, hand, wristAngle) => paintRod(ctx, hand, wristAngle, grenade, outline),
  };
}

// ── The style ────────────────────────────────────────────────────────────────

/** The electric goblin dressed, with the generator in the state one frame shows. */
export function electricGoblinStyle(generator: GeneratorState): GoblinStyle {
  const outfit: GoblinOutfit = {
    head: drawElectricHead,
    torso: drawRubberCoat,
    hips: drawBeltAndSeat,
    leg: drawRubberLeg,
    foot: drawInsulatedBoot,
    arm: drawElectricArm,
    back: (ctx, spineTop, lean, style) => drawGenerator(ctx, spineTop, lean, style, generator),
    overTorso: drawHarness,
  };
  return {
    palette: goblinPalette(),
    proportions: ELECTRIC_GOBLIN_BUILD,
    gear: NO_GEAR,
    spineLean: ELECTRIC_GOBLIN_HUNCH,
    earNotches: 2,
    outfit,
  };
}

// ── Light over the finished figure ───────────────────────────────────────────

/** A deterministic 0–1 value per (index, salt): arc kinks and spark directions. */
function hash01(index: number, salt: number): number {
  const PRIME_A = 12.9898;
  const PRIME_B = 78.233;
  const SCALE = 43758.5453;
  const value = Math.sin(index * PRIME_A + salt * PRIME_B) * SCALE;
  return value - Math.floor(value);
}

/** One salt per use of the hash, so an arc's kinks and a spray's angles never move together. */
const HASH_SALT = { arcKink: 1, sparkAngle: 2, sparkReach: 3 } as const;

/** node-canvas drops an `rgba()` whose alpha prints in exponent notation. */
const MIN_ALPHA = 1e-4;

function safeAlpha(alpha: number): number {
  return alpha < MIN_ALPHA ? 0 : Math.min(1, alpha);
}

function glow(ctx: Ctx, at: Pt, radius: number, colour: string, alpha: number): void {
  const a = safeAlpha(alpha);
  if (a === 0) return;
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  gradient.addColorStop(0, rgba(colour, a));
  gradient.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_CIRCLE_ANGLE);
  ctx.fill();
}

const ARC_SEGMENTS = 7;
/** How far an arc's kinks wander off the straight line, as a share of its length. */
const ARC_JITTER = 0.16;
const ARC_GLOW_WIDTH = 0.05;
const ARC_CORE_WIDTH = 0.018;
/** The deep-blue halo round an arc, as a multiple of its glow's width. */
const ARC_HALO_SPREAD = 1.8;

/**
 * A jagged lightning arc from `from` to `to`. `seed` picks its kinks, so a row
 * crackles from frame to frame while every bake of one frame is identical.
 */
function drawArc(ctx: Ctx, from: Pt, to: Pt, seed: number, strength: number): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const normal = length === 0 ? pt(0, 0) : pt(-(to.y - from.y) / length, (to.x - from.x) / length);
  const points: Pt[] = [from];
  for (let i = 1; i < ARC_SEGMENTS; i++) {
    const along01 = i / ARC_SEGMENTS;
    const kink =
      (hash01(seed * ARC_SEGMENTS + i, HASH_SALT.arcKink) - HALF) * 2 * length * ARC_JITTER;
    const base = mixPt(from, to, along01);
    points.push(offset(base, normal.x * kink, normal.y * kink));
  }
  points.push(to);
  const trace = (): void => {
    ctx.beginPath();
    points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(ARC_DEEP, safeAlpha(strength * HALF));
  ctx.lineWidth = ARC_GLOW_WIDTH * ARC_HALO_SPREAD;
  trace();
  ctx.stroke();
  ctx.strokeStyle = rgba(ARC_GLOW, safeAlpha(strength));
  ctx.lineWidth = ARC_GLOW_WIDTH;
  trace();
  ctx.stroke();
  ctx.strokeStyle = rgba(ARC_CORE, safeAlpha(strength));
  ctx.lineWidth = ARC_CORE_WIDTH;
  trace();
  ctx.stroke();
}

const SPARK_COUNT = 6;
const SPARK_MIN = 0.06;
const SPARK_REACH = 0.12;
const SPARK_WIDTH = 0.016;

/** A spray of short spark streaks out of `at`, all round. */
function drawSparkSpray(ctx: Ctx, at: Pt, seed: number, strength: number): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = hash01(seed * SPARK_COUNT + i, HASH_SALT.sparkAngle) * FULL_CIRCLE_ANGLE;
    const reach =
      (SPARK_MIN + hash01(seed * SPARK_COUNT + i, HASH_SALT.sparkReach) * SPARK_REACH) * strength;
    const inner = along(at, angle, reach * QUARTER);
    const outer = along(at, angle, reach);
    ctx.strokeStyle = rgba(ARC_GLOW, safeAlpha(strength));
    ctx.lineWidth = SPARK_WIDTH * 2;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
    ctx.strokeStyle = rgba(ARC_CORE, safeAlpha(strength));
    ctx.lineWidth = SPARK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }
}

/** What crackles on one frame, beyond the steady glow every frame carries. */
export interface ElectricEffects {
  /** An arc bridging the two balls, 0 for none. */
  readonly bridge: number;
  /** Sparks spraying off the near ball, 0 for none. */
  readonly nearSparks: number;
  /** Sparks spraying off the far ball, 0 for none. */
  readonly farSparks: number;
  /** Arcs crawling down each rod from ball to grip, 0 for none. */
  readonly rodCrawl: number;
  /** Arcs leaping between the generator's coil tops, 0 for none. */
  readonly coilArc: number;
  /** Seeds this frame's kinks and spark directions. */
  readonly seed: number;
}

export const NO_ELECTRIC_EFFECTS: ElectricEffects = {
  bridge: 0,
  nearSparks: 0,
  farSparks: 0,
  rodCrawl: 0,
  coilArc: 0,
  seed: 0,
};

const CORE_GLOW_RADIUS = 0.2;
const CORE_GLOW_ALPHA = 0.55;
const BALL_GLOW_RADIUS = 0.19;
const BALL_GLOW_ALPHA = 0.6;
/** The balls stay dark copper until the charge is past this. */
const BALL_GLOW_FROM = 0.4;
/** How far up a rod a crawling arc reaches from the ball, as a share of the rod. */
const ROD_CRAWL_SHARE = 0.75;
/** Each effect's offset into the frame's seed, so no two crackle in step. */
const SEED_STREAM = {
  coil: 0,
  farRod: 1,
  nearRod: 2,
  bridge: 3,
  farSparks: 4,
  nearSparks: 5,
} as const;

/** Where both rods' balls are on one frame, near rod first. */
export interface RodBalls {
  readonly near: Pt;
  readonly far: Pt;
  readonly nearAngle: number;
  readonly farAngle: number;
}

/**
 * The electricity on one frame, painted over the finished figure: the core's
 * glow, the charged balls, and whatever the frame's effects crackle.
 */
export function drawElectricGoblinLight(
  ctx: Ctx,
  skeleton: Skeleton,
  style: GoblinStyle,
  generator: GeneratorState,
  rods: RodBalls,
  effects: ElectricEffects,
): void {
  glow(
    ctx,
    generatorCorePoint(skeleton, style),
    CORE_GLOW_RADIUS,
    ARC_GLOW,
    generator.charge * CORE_GLOW_ALPHA,
  );
  const ballCharge = Math.max(0, (generator.charge - BALL_GLOW_FROM) / (1 - BALL_GLOW_FROM));
  for (const ball of [rods.far, rods.near]) {
    glow(ctx, ball, BALL_GLOW_RADIUS, ARC_GLOW, ballCharge * BALL_GLOW_ALPHA);
    glow(ctx, ball, ROD_BALL_RADIUS * HALF, ARC_CORE, ballCharge);
  }
  if (effects.coilArc > 0) {
    const [first, second] = generatorCoilTops(skeleton, style);
    drawArc(ctx, first, second, effects.seed + SEED_STREAM.coil, effects.coilArc);
  }
  if (effects.rodCrawl > 0) {
    const pairs: ReadonlyArray<readonly [Pt, number, number]> = [
      [rods.far, rods.farAngle, SEED_STREAM.farRod],
      [rods.near, rods.nearAngle, SEED_STREAM.nearRod],
    ];
    for (const [ball, angle, stream] of pairs) {
      const down = along(ball, angle, -ROD.tip * ROD_CRAWL_SHARE);
      drawArc(ctx, ball, down, effects.seed + stream, effects.rodCrawl);
    }
  }
  if (effects.bridge > 0)
    drawArc(ctx, rods.far, rods.near, effects.seed + SEED_STREAM.bridge, effects.bridge);
  if (effects.farSparks > 0)
    drawSparkSpray(ctx, rods.far, effects.seed + SEED_STREAM.farSparks, effects.farSparks);
  if (effects.nearSparks > 0)
    drawSparkSpray(ctx, rods.near, effects.seed + SEED_STREAM.nearSparks, effects.nearSparks);
}
