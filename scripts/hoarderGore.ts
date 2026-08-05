/**
 * The six pieces the Hoarder comes apart into.
 *
 * The cut face is not here — `scripts/goreWound.ts` owns that, and every wound
 * below routes through it so her injuries are recognisably the same ones every
 * other dismembered thing in the bestiary has.
 *
 * What is here is the shape of each piece, and the shapes are chosen for
 * **silhouette** rather than for anatomy: six cells tumbling past at 16 px must
 * not read as six identical lumps. So the set is a broad jowly skull trailing
 * strings of hair, a slab of torso split down the middle with the gut coming
 * out of it, a long straight arm ending in a splayed hand, a second arm folded
 * hard at the elbow around a closed fist, a leg bent at the knee with a burst
 * slipper on the end, and a straight column of leg ending in bare toes.
 *
 * The one thing that has to look different from every other creature's gore is
 * the **fat**: a body this size cuts to a deep yellow subcutaneous layer before
 * it reaches any muscle, and that pale band inside every wound is what says
 * these pieces came off her and not off a goblin.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. Pieces spin, so nothing may be lit directionally.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { TWO_PI, type Pt, deg, hash1, lerp, ovalOutline, traceOutline } from './ratArt.js';
import { BLOOD_DARK, drawWound, grownOutline, paintGoreMass } from './goreWound.js';
import {
  ANKLE_WIDTH,
  BELLY_HALF,
  ELBOW_WIDTH,
  FOOT_DEPTH,
  FOOT_LENGTH,
  FOREARM_LENGTH,
  HEAD_RX as FIGURE_HEAD_RX,
  HEAD_RY as FIGURE_HEAD_RY,
  HAND_LENGTH,
  KNEE_WIDTH,
  CALF_WIDTH,
  SHIN_LENGTH,
  THIGH_LENGTH,
  THIGH_WIDTH,
  UPPER_ARM_LENGTH,
  UPPER_ARM_WIDTH,
  WRIST_WIDTH,
} from './hoarderArt.js';

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

// ── Tones ────────────────────────────────────────────────────────────────────

/**
 * Darker than the tones she is painted in while alive: a piece is lit only
 * ambiently, and skin painted at its standing brightness comes out reading as a
 * pale stone.
 */
const FLESH_MID = '#bb907b';
const FLESH_DARK = '#5f3a30';
const FLESH_LIGHT = '#d9b39a';
const VEST_MID = '#948e7c';
const VEST_DARK = '#4a463c';
const VEST_LIGHT = '#bab493';
const TROUSER_MID = '#3d382e';
const TROUSER_DARK = '#1b1814';
const TROUSER_LIGHT = '#5e5747';
const SLIPPER_MID = '#5f4130';
const SLIPPER_DARK = '#2a1c15';
const SLIPPER_LIGHT = '#8a6047';
const HAIR_MID = '#544736';
const HAIR_DARK = '#241f19';
const OUTLINE_INK = '#160d0a';
/**
 * The sliver of eye a half-shut lid leaves showing: the living sprite's sclera
 * white, dulled. The previous grey-green read as teal at review size, which is a
 * colour that appears nowhere else on her.
 */
const EYE_DEAD = '#d8cfba';

const FLESH_TONE = { mid: FLESH_MID, dark: FLESH_DARK, light: FLESH_LIGHT } as const;
const VEST_TONE = { mid: VEST_MID, dark: VEST_DARK, light: VEST_LIGHT } as const;
const TROUSER_TONE = { mid: TROUSER_MID, dark: TROUSER_DARK, light: TROUSER_LIGHT } as const;
const SLIPPER_TONE = { mid: SLIPPER_MID, dark: SLIPPER_DARK, light: SLIPPER_LIGHT } as const;

function paintMass(
  ctx: Ctx,
  trace: (grow: number) => void,
  tone: { readonly mid: string; readonly dark: string; readonly light: string },
): void {
  paintGoreMass(ctx, trace, tone, OUTLINE_INK);
}

/**
 * Binds an outline to the context it is being painted into. `paintGoreMass`
 * asks for the shape at several inset amounts, so what it needs is a function
 * of `grow` alone — the context has to come from the caller because a piece is
 * repainted by every measure pass and cannot capture one at construction.
 */
function tracer(ctx: Ctx, outline: readonly Pt[]): (grow: number) => void {
  return (grow: number) => traceOutline(ctx, grownOutline(outline, grow));
}

function piece(state: string, paint: (ctx: Ctx) => void): GorePiece {
  return { state, paint };
}

// ── Shared shapes ────────────────────────────────────────────────────────────

const SEGMENT_STEPS = 14;
const SEGMENT_WOBBLE = 0.09;
const SEGMENT_LOBES = 6;

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** A tapered, slightly lumpy capsule between two points. */
function segmentOutline(a: Pt, b: Pt, halfA: number, halfB: number, seed: number): Pt[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.cos(angle - Math.PI / 2);
  const ny = Math.sin(angle - Math.PI / 2);
  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let i = 0; i <= SEGMENT_STEPS; i++) {
    const t = i / SEGMENT_STEPS;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const half = lerp(halfA, halfB, t) * (1 + SEGMENT_WOBBLE * Math.sin(t * SEGMENT_LOBES + seed));
    near.push({ x: x + nx * half, y: y + ny * half });
    far.push({ x: x - nx * half, y: y - ny * half });
  }
  return [...near, ...far.reverse()];
}

/**
 * Two tapered segments meeting at a joint, as one outline.
 *
 * The spine is **filleted** through the joint rather than turning a corner at
 * it. A hard corner is what makes an offset outline self-intersect: on the
 * inside of the bend the two offset runs cross, the path doubles back on
 * itself, and `paintGoreMass`'s ambient pass fills the doubled region twice —
 * which reads as a pale wedge sitting inside the limb.
 *
 * Capping the joint's *width* also removes the crossing and is the wrong fix:
 * at these bends it takes the width down to a fifth of what was authored, and a
 * folded arm becomes two spikes meeting at a point. Spreading the turn over an
 * arc keeps the limb its full thickness.
 */
function jointedOutline(
  root: Pt,
  joint: Pt,
  end: Pt,
  halfRoot: number,
  halfJoint: number,
  halfEnd: number,
  seed: number,
): Pt[] {
  const upperLength = Math.hypot(joint.x - root.x, joint.y - root.y);
  const lowerLength = Math.hypot(end.x - joint.x, end.y - joint.y);
  // How far back along each segment the fillet starts. Large enough that the
  // arc's radius of curvature comfortably exceeds the limb's own half-width,
  // which is the condition for the inside offset not to fold over.
  const fillet = Math.min(
    halfJoint * FILLET_SPAN,
    upperLength * FILLET_MAX_SHARE,
    lowerLength * FILLET_MAX_SHARE,
  );
  const filletIn = mixPt(joint, root, fillet / Math.max(upperLength, MIN_SEGMENT_LENGTH));
  const filletOut = mixPt(joint, end, fillet / Math.max(lowerLength, MIN_SEGMENT_LENGTH));

  const spine: Array<{ point: Pt; half: number }> = [];
  const push = (point: Pt, half: number): void => {
    spine.push({ point, half });
  };

  for (let i = 0; i <= SEGMENT_STEPS; i++) {
    const t = i / SEGMENT_STEPS;
    push(mixPt(root, filletIn, t), lerp(halfRoot, halfJoint, t));
  }
  for (let i = 1; i < FILLET_STEPS; i++) {
    const t = i / FILLET_STEPS;
    // Quadratic through the corner: the joint is the control point, so the arc
    // never reaches it and the turn is spread across every station on the way.
    push(mixPt(mixPt(filletIn, joint, t), mixPt(joint, filletOut, t), t), halfJoint);
  }
  for (let i = 0; i <= SEGMENT_STEPS; i++) {
    const t = i / SEGMENT_STEPS;
    push(mixPt(filletOut, end, t), lerp(halfJoint, halfEnd, t));
  }

  const near: Pt[] = [];
  const far: Pt[] = [];
  spine.forEach((station, index) => {
    const before = spine[Math.max(0, index - 1)];
    const after = spine[Math.min(spine.length - 1, index + 1)];
    if (before === undefined || after === undefined) return;
    const angle = Math.atan2(after.point.y - before.point.y, after.point.x - before.point.x);
    const nx = Math.cos(angle - Math.PI / 2);
    const ny = Math.sin(angle - Math.PI / 2);
    const wobble = 1 + SEGMENT_WOBBLE * Math.sin((index / spine.length) * SEGMENT_LOBES * 2 + seed);
    const half = station.half * wobble;
    near.push({ x: station.point.x + nx * half, y: station.point.y + ny * half });
    far.push({ x: station.point.x - nx * half, y: station.point.y - ny * half });
  });
  return [...near, ...far.reverse()];
}

/** Fillet length as a multiple of the joint's half-width. */
const FILLET_SPAN = 2.6;
/** Never eat more than this share of the shorter segment. */
const FILLET_MAX_SHARE = 0.45;
const FILLET_STEPS = 10;
/** Guards the fillet ratio against a degenerate zero-length segment. */
const MIN_SEGMENT_LENGTH = 1e-4;

function distance(from: Pt, to: Pt): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

const BLOTCH_COUNT = 10;
const BLOTCH_ALPHA = 0.4;
const BLOTCH_MIN = 0.1;
const BLOTCH_RANGE = 0.2;
const BLOTCH_SQUASH = 0.6;

/** Bruising and grime over a piece of skin, clipped to it. */
function mottle(ctx: Ctx, trace: (grow: number) => void, seed: number, spread: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.globalAlpha = BLOTCH_ALPHA;
  ctx.fillStyle = FLESH_DARK;
  for (let i = 0; i < BLOTCH_COUNT; i++) {
    const x = (hash1(seed + i * 3.7) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 7.1 + 31) - 0.5) * 2 * spread;
    const rx = spread * (BLOTCH_MIN + hash1(seed + i * 11.3) * BLOTCH_RANGE);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * BLOTCH_SQUASH, hash1(seed + i * 2.3) * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── The pieces ───────────────────────────────────────────────────────────────

/**
 * A severed head is her head, so it is drawn at the size her head is: these were
 * hand-set literals, and while `HEADS_TALL` went from 5.6 to 8.3 chasing the
 * "she reads as a toddler" note they did not follow. The piece ended up 2.4×
 * her skull across and 1.8× down — four times its area — which is the single
 * thing that made the gore read as a cartoon.
 *
 * Everything below is a fraction of the skull for the same reason: a feature in
 * absolute units survives the next proportion change and the face slides off.
 */
const HEAD_RX = FIGURE_HEAD_RX;
const HEAD_RY = FIGURE_HEAD_RY;
const JOWL_RX = HEAD_RX * 1.14;
const JOWL_RY = HEAD_RY * 0.5;
const JOWL_DROP = HEAD_RY * 0.6;
const HEAD_SEED = 4.1;
const HEAD_EYE_RX = HEAD_RX * 0.14;
const HEAD_EYE_RY = HEAD_RY * 0.115;
const HEAD_EYE_SPACING = HEAD_RX * 0.367;
const HEAD_EYE_Y = HEAD_RY * -0.115;
const HEAD_MOUTH_RX = HEAD_RX * 0.273;
const HEAD_MOUTH_RY = HEAD_RY * 0.212;
const HEAD_MOUTH_Y = HEAD_RY * 0.5;
/** How dark the socket is, and how much of the eye the lid leaves showing. */
const EYE_SOCKET_ALPHA = 0.55;
const EYE_SLIT_DROP = 0.35;
const EYE_SLIT_SPAN = 0.62;
const EYE_SLIT_OPEN = 0.34;
/** A dead jaw does not hang square to the face. */
const MOUTH_SLACK_TILT = deg(7);
const LIP_ALPHA = 0.5;
const LIP_LIFT = 0.85;
const LIP_SPAN = 0.9;
const LIP_THICKNESS = 0.4;
/**
 * The neck comes off the back corner of the jaw, not off the point of the chin.
 * Centred under the mouth the stump is a second dark hole directly below the
 * first one, and a reviewer read the whole piece as a head with two mouths.
 */
const HEAD_WOUND_AT = { x: HEAD_RX * -0.5, y: HEAD_RY * 0.769 } as const;
const HEAD_WOUND_RADIUS = HEAD_RX * 0.467;

/**
 * The same hanks the living figure wears, at the same proportions. The previous
 * pass put four hard black triangles on the crown, which matched nothing
 * anywhere else on her and read as a spiked helmet rather than as hair.
 */
interface GoreHairClump {
  readonly at: number;
  readonly half: number;
  readonly length: number;
  readonly kick: number;
  readonly dark: boolean;
}

/**
 * `half` is a share of the skull's half-width, `length` of its half-height.
 *
 * Wide and short. Thin hanks half a skull long stand off the crown as three
 * hard points, and three hard points on a round shape is a crown of spikes —
 * the same read this table was rewritten once already to escape. Matted hair on
 * a severed head is a mass with a couple of clumps trailing out of it, and a
 * blunt tip is what stops a clump being a quill.
 */
const GORE_HAIR: readonly GoreHairClump[] = [
  { at: -0.96, half: 0.29, length: 0.33, kick: -0.18, dark: false },
  { at: -0.66, half: 0.42, length: 0.2, kick: -0.12, dark: true },
  { at: -0.28, half: 0.26, length: 0.28, kick: -0.05, dark: false },
  { at: 0.22, half: 0.38, length: 0.18, kick: 0.04, dark: true },
  { at: 0.6, half: 0.28, length: 0.26, kick: 0.12, dark: false },
  { at: 0.95, half: 0.33, length: 0.22, kick: 0.2, dark: true },
];
const GORE_HAIR_TIP = HEAD_RX * 0.12;
/** The scalp the hanks come off, so the crown is a mass and not a set of quills. */
const GORE_HAIR_CAP_GAIN = 1.22;
const GORE_HAIR_CAP_FROM = deg(196);
const GORE_HAIR_CAP_TO = deg(344);

function headPiece(ctx: Ctx): void {
  // Hair first, behind the skull, so the hanks read as trailing off it rather
  // than as lying on the face. The cap goes down before them: hanks alone on a
  // bare crown are quills however soft their tips are, and four of them
  // standing up off a skull is a helmet with spikes on it.
  ctx.fillStyle = HAIR_MID;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    HEAD_RX * GORE_HAIR_CAP_GAIN,
    HEAD_RY * GORE_HAIR_CAP_GAIN,
    0,
    GORE_HAIR_CAP_FROM,
    GORE_HAIR_CAP_TO,
  );
  ctx.closePath();
  ctx.fill();

  for (const clump of GORE_HAIR) {
    const half = clump.half * HEAD_RX;
    const length = clump.length * HEAD_RY;
    const rootX = clump.at * HEAD_RX;
    const rootY = -Math.sqrt(Math.max(0, 1 - clump.at ** 2)) * HEAD_RY * 0.92;
    const tipY = rootY - length;
    const tipX = rootX + clump.kick * length;
    const bellyY = lerp(rootY, tipY, 0.35);
    ctx.fillStyle = clump.dark ? HAIR_DARK : HAIR_MID;
    ctx.beginPath();
    ctx.moveTo(rootX - half, rootY);
    ctx.quadraticCurveTo(tipX - half * 0.24, bellyY, tipX - GORE_HAIR_TIP, tipY);
    ctx.lineTo(tipX + GORE_HAIR_TIP, tipY);
    ctx.quadraticCurveTo(tipX + half * 0.24, bellyY, rootX + half, rootY);
    ctx.closePath();
    ctx.fill();
  }

  const jowls = ovalOutline(0, JOWL_DROP, JOWL_RX, JOWL_RY, 0, HEAD_SEED + 1, 0.07);
  const skull = ovalOutline(0, 0, HEAD_RX, HEAD_RY, 0, HEAD_SEED, 0.05);
  paintMass(ctx, tracer(ctx, jowls), FLESH_TONE);
  paintMass(ctx, tracer(ctx, skull), FLESH_TONE);
  mottle(ctx, tracer(ctx, skull), HEAD_SEED, HEAD_RX);

  // Sunken sockets under a heavy lid, not eyeballs. A white sclera with a black
  // dot in it is the loudest mark anywhere on a piece this small, and two of
  // them side by side is a cartoon face wherever else the piece goes: the eyes
  // were the first thing anyone called cartoonish about this sheet. What a dead
  // face actually shows at this size is a dark hollow and a lid over it.
  for (const side of [-1, 1]) {
    const x = side * HEAD_EYE_SPACING;
    ctx.globalAlpha = EYE_SOCKET_ALPHA;
    ctx.fillStyle = OUTLINE_INK;
    ctx.beginPath();
    ctx.ellipse(x, HEAD_EYE_Y, HEAD_EYE_RX, HEAD_EYE_RY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    // The sliver of eye the lid has not covered, dull and half shut.
    ctx.fillStyle = EYE_DEAD;
    ctx.beginPath();
    ctx.ellipse(
      x,
      HEAD_EYE_Y + HEAD_EYE_RY * EYE_SLIT_DROP,
      HEAD_EYE_RX * EYE_SLIT_SPAN,
      HEAD_EYE_RY * EYE_SLIT_OPEN,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // A slack gape, not a mouth. The teeth that were in here rendered as one white
  // block wider than an eye — at this size a tooth is a highlight, and a
  // highlight in the middle of the darkest shape on the piece is a buck tooth.
  ctx.fillStyle = BLOOD_DARK;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_MOUTH_Y, HEAD_MOUTH_RX, HEAD_MOUTH_RY, MOUTH_SLACK_TILT, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = LIP_ALPHA;
  ctx.fillStyle = FLESH_DARK;
  ctx.beginPath();
  ctx.ellipse(
    0,
    HEAD_MOUTH_Y - HEAD_MOUTH_RY * LIP_LIFT,
    HEAD_MOUTH_RX * LIP_SPAN,
    HEAD_MOUTH_RY * LIP_THICKNESS,
    MOUTH_SLACK_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  drawWound(ctx, {
    kind: 'torn',
    centre: HEAD_WOUND_AT,
    radius: HEAD_WOUND_RADIUS,
    squash: 0.45,
    angle: deg(24),
    // A stack of vertebrae: the one bone in the set that is a ring of rings,
    // and the only place on her body it could have come from.
    bones: [
      { at: { x: 0, y: 0 }, size: 0.34, hollow: true },
      { at: { x: -0.44, y: 0.1 }, size: 0.2, hollow: true },
    ],
    runAngle: Math.PI * 0.75,
    seed: HEAD_SEED,
    hide: FLESH_DARK,
  });
}

/**
 * A chunk of trunk, not the whole trunk. Her torso is `BELLY_HALF` across and
 * over a tile tall; a piece drawn at that size is a second boss lying on the
 * floor. The share is named so it reads as the decision it is rather than as one
 * more number that drifted away from the figure.
 */
const TORSO_CHUNK_SHARE = 0.45;
/**
 * Taller than it is wide, and it has to be. Round, with three stumps evenly
 * round its upper rim and fold lines across its middle, the piece read as a
 * cauldron: a pot is exactly a symmetric bowl with handles on the rim. A trunk
 * is longer than it is broad, its neck is on the centreline and its shoulders
 * are out at the corners *below* it.
 */
const TORSO_TALLER_THAN_WIDE = 1.27;
const TORSO_RX = BELLY_HALF * TORSO_CHUNK_SHARE;
const TORSO_RY = TORSO_RX * TORSO_TALLER_THAN_WIDE;
const TORSO_SEED = 9.7;
const TORSO_VEST_TOP = -0.36;
const TORSO_VEST_HEIGHT = 0.2;
const TORSO_STUMP_RADIUS = 0.13;
const TORSO_NECK_AT = { x: 0.02, y: -0.34 } as const;
const TORSO_SHOULDER_ACROSS = 0.86;
const TORSO_SHOULDER_DOWN = 0.22;
const TORSO_FOLD_SHARES = [0.2, 0.48, 0.76] as const;
const TORSO_FOLD_SPANS = [0.62, 0.72, 0.5] as const;
const TORSO_FOLD_SAG = 0.05;
const TORSO_FOLD_ALPHA = 0.42;
const TORSO_FOLD_WIDTH = 0.022;

function torsoPiece(ctx: Ctx): void {
  const body = ovalOutline(0, 0, TORSO_RX, TORSO_RY, 0, TORSO_SEED, 0.08);
  // Two shoulder lobes proud of the trunk, the way the jowls sit proud of the
  // skull. A smooth oval with stumps on its rim is a pot; the bulge at the top
  // corners is the only thing that makes the same blob a pair of shoulders.
  for (const side of [-1, 1]) {
    paintMass(
      ctx,
      tracer(
        ctx,
        ovalOutline(
          side * TORSO_RX * TORSO_SHOULDER_ACROSS,
          TORSO_VEST_TOP + TORSO_SHOULDER_DOWN,
          TORSO_RX * 0.44,
          TORSO_RY * 0.3,
          side * deg(20),
          TORSO_SEED + side * 3,
          0.09,
        ),
      ),
      FLESH_TONE,
    );
  }
  paintMass(ctx, tracer(ctx, body), FLESH_TONE);
  mottle(ctx, tracer(ctx, body), TORSO_SEED, TORSO_RX);

  ctx.save();
  tracer(ctx, body)(0);
  ctx.clip();

  // What is left of the vest, in the tone and the position it occupies on the
  // living figure — the piece has to be recognisable as having come off *her*.
  // Torn off one shoulder and hanging lower on the other. Cut square across the
  // top of a round piece it made a lid, and a round piece with a lid on it is a
  // pot however much fat is painted round the rim.
  const vest = [
    { x: -TORSO_RX * 1.2, y: TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 0.34 },
    { x: -TORSO_RX * 0.34, y: TORSO_VEST_TOP },
    { x: TORSO_RX * 1.2, y: TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 0.14 },
    { x: TORSO_RX * 1.1, y: TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 1.05 },
    { x: TORSO_RX * 0.2, y: TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 0.78 },
    { x: -TORSO_RX * 1.1, y: TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 0.96 },
  ];
  paintMass(ctx, tracer(ctx, vest), VEST_TONE);

  // Belly folds carried over from the living silhouette. The previous pass put
  // a row of evenly spaced pale lumps inside a dark crescent here, and a
  // reviewer read the whole piece as a jaw with four molars in it.
  ctx.globalAlpha = TORSO_FOLD_ALPHA;
  ctx.strokeStyle = FLESH_DARK;
  ctx.lineWidth = TORSO_FOLD_WIDTH;
  ctx.lineCap = 'round';
  TORSO_FOLD_SHARES.forEach((share, index) => {
    const y = lerp(TORSO_VEST_TOP + TORSO_VEST_HEIGHT * 1.3, TORSO_RY * 0.86, share);
    const span = TORSO_RX * (TORSO_FOLD_SPANS[index] ?? TORSO_FOLD_SPANS[0] ?? 0.5);
    ctx.beginPath();
    ctx.moveTo(-span, y);
    ctx.quadraticCurveTo(0, y + TORSO_FOLD_SAG, span, y);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.restore();

  // Three stumps on the outline — a neck and two shoulders — which is the only
  // thing that says "this came off the top of a body" rather than "this is a
  // sack".
  drawWound(ctx, {
    kind: 'torn',
    centre: TORSO_NECK_AT,
    radius: TORSO_STUMP_RADIUS,
    squash: 0.4,
    angle: 0,
    // A vertebra with a sawn rib either side of it: the widest spread of bone
    // in the set, and the only one that could not be a limb.
    bones: [
      { at: { x: 0, y: 0 }, size: 0.36, hollow: true },
      { at: { x: -0.62, y: 0.12 }, size: 0.16, hollow: true },
      { at: { x: 0.62, y: 0.12 }, size: 0.16, hollow: true },
    ],
    runAngle: -Math.PI / 2,
    seed: TORSO_SEED,
    hide: FLESH_DARK,
  });
  for (const side of [-1, 1]) {
    // Deliberately unmatched. A symmetric pair of bullseyes at the top corners
    // of an egg is a pair of ears, and a blind namer duly called the whole
    // piece a second severed head.
    const shoulder = {
      x: side * TORSO_RX * TORSO_SHOULDER_ACROSS * (side > 0 ? 1 : 0.82),
      y: TORSO_VEST_TOP + TORSO_SHOULDER_DOWN * (side > 0 ? 1 : 1.9),
    };
    drawWound(ctx, {
      kind: 'crushed',
      centre: shoulder,
      radius: TORSO_STUMP_RADIUS * (side > 0 ? 0.62 : 0.44),
      squash: 0.5,
      angle: Math.PI / 2,
      bones: [{ at: { x: 0, y: 0 }, size: 0.3 }],
      runAngle: side > 0 ? 0 : Math.PI,
      seed: TORSO_SEED + side,
      hide: FLESH_DARK,
    });
  }
}

/**
 * A limb piece's joints, laid out along the bones they came off.
 *
 * The three points used to be typed in, and their spacing drifted from the
 * skeleton just as the widths did — the severed thigh was drawn 37% longer than
 * her actual femur on a leg half its width. Only the *directions* are art here;
 * the lengths belong to the figure.
 */
function jointsAlong(
  root: Pt,
  upperAngle: number,
  upperLength: number,
  lowerAngle: number,
  lowerLength: number,
): { readonly root: Pt; readonly joint: Pt; readonly end: Pt } {
  const joint = {
    x: root.x + Math.cos(upperAngle) * upperLength,
    y: root.y + Math.sin(upperAngle) * upperLength,
  };
  return {
    root,
    joint,
    end: {
      x: joint.x + Math.cos(lowerAngle) * lowerLength,
      y: joint.y + Math.sin(lowerAngle) * lowerLength,
    },
  };
}

const ARM_SEED = 17.3;
/**
 * A severed arm is her arm, at her arm's widths and her arm's bone lengths.
 * These were hand-set, and every one of them drifted from the figure: the whole
 * set was somewhere around four fifths of life while the head sat at two and a
 * half times it, which is what made the pile read as a cartoon rather than as
 * parts of one creature.
 */
const ARM_ROOT_HALF = UPPER_ARM_WIDTH;
const ARM_ELBOW_HALF = ELBOW_WIDTH;
const ARM_WRIST_HALF = WRIST_WIDTH;
const ARM_WOUND_RADIUS = UPPER_ARM_WIDTH * 0.8;
const HAND_RADIUS = HAND_LENGTH * 0.65;
const HAND_TILT_DEGREES = 18;
const THUMB_OUT = 0.055;
const THUMB_RADIUS = 0.032;
const FINGER_CREASE_COUNT = 3;
const FINGER_CREASE_WIDTH = 0.013;
const BARE_FOOT_HALF = FOOT_LENGTH * 0.5;
const BARE_FOOT_LEAD = FOOT_LENGTH * 0.3;

/** The straight arm, hand open and splayed — a rod ending in a star. */
function rightArmPiece(ctx: Ctx): void {
  const {
    root: shoulder,
    joint: elbow,
    end: wrist,
  } = jointsAlong({ x: -0.04, y: -0.36 }, deg(74.5), UPPER_ARM_LENGTH, deg(113.2), FOREARM_LENGTH);
  const outline = jointedOutline(
    shoulder,
    elbow,
    wrist,
    ARM_ROOT_HALF,
    ARM_ELBOW_HALF,
    ARM_WRIST_HALF,
    ARM_SEED,
  );
  // A mitten with a thumb off it, not a fan of separate digits: fanned circles
  // are the same shape as a set of toes, and a reviewer duly named this arm a
  // leg. Nothing that terminates an arm may repeat the foot's motif — but a
  // *smooth* mitten is a shin's stump, so the far edge carries finger creases
  // that the bare foot on the leg piece deliberately does not.
  ctx.fillStyle = FLESH_MID;
  ctx.beginPath();
  ctx.ellipse(
    wrist.x - HAND_RADIUS * 0.3,
    wrist.y + HAND_RADIUS,
    HAND_RADIUS * 1.15,
    HAND_RADIUS,
    deg(HAND_TILT_DEGREES),
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(wrist.x + THUMB_OUT, wrist.y + HAND_RADIUS * 0.5, THUMB_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = FLESH_DARK;
  ctx.lineWidth = FINGER_CREASE_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < FINGER_CREASE_COUNT; i++) {
    const share = (i + 1) / (FINGER_CREASE_COUNT + 1);
    const x = wrist.x - HAND_RADIUS * 1.2 + share * HAND_RADIUS * 2.1;
    ctx.beginPath();
    ctx.moveTo(x, wrist.y + HAND_RADIUS * 1.05);
    ctx.lineTo(x + HAND_RADIUS * 0.12, wrist.y + HAND_RADIUS * 1.85);
    ctx.stroke();
  }
  paintMass(ctx, tracer(ctx, outline), FLESH_TONE);
  mottle(ctx, tracer(ctx, outline), ARM_SEED, ARM_ROOT_HALF * 2);

  drawWound(ctx, {
    kind: 'torn',
    centre: shoulder,
    radius: ARM_WOUND_RADIUS,
    squash: 0.4,
    angle: 0,
    // One humerus, solid and set off-centre the way a bone actually sits in a
    // limb. Its opposite number, the folded arm, shows the same bone shattered.
    bones: [{ at: { x: -0.22, y: 0.06 }, size: 0.34 }],
    runAngle: -Math.PI / 2,
    seed: ARM_SEED,
    hide: FLESH_DARK,
  });
}

const FIST_RADIUS = 0.085;
const KNUCKLE_COUNT = 3;
const KNUCKLE_RADIUS = 0.026;

/** The folded arm — an L, hand closed, which is the straight arm's opposite. */
function leftArmPiece(ctx: Ctx): void {
  // Folded far harder than either leg is, and slimmer. Bent to the same ninety
  // degrees at the same taper it was named a leg in a blind test, and at half
  // size it and the bare leg were the same comma.
  const {
    root: shoulder,
    joint: elbow,
    end: fist,
  } = jointsAlong({ x: -0.32, y: -0.2 }, deg(-3.7), UPPER_ARM_LENGTH, deg(125.8), FOREARM_LENGTH);
  const outline = jointedOutline(
    shoulder,
    elbow,
    fist,
    ARM_ROOT_HALF * 0.86,
    ARM_ELBOW_HALF * 0.86,
    ARM_WRIST_HALF,
    ARM_SEED + 6.7,
  );
  ctx.fillStyle = FLESH_MID;
  ctx.beginPath();
  ctx.arc(fist.x, fist.y, FIST_RADIUS, 0, TWO_PI);
  ctx.fill();
  paintMass(ctx, tracer(ctx, outline), FLESH_TONE);
  mottle(ctx, tracer(ctx, outline), ARM_SEED + 6.7, ARM_ROOT_HALF * 2);

  ctx.strokeStyle = FLESH_DARK;
  ctx.lineWidth = 0.012;
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const share = i / (KNUCKLE_COUNT - 1);
    ctx.beginPath();
    ctx.arc(
      fist.x + (share - 0.5) * FIST_RADIUS * 1.2,
      fist.y + FIST_RADIUS * 0.4,
      KNUCKLE_RADIUS,
      Math.PI,
      TWO_PI,
    );
    ctx.stroke();
  }

  drawWound(ctx, {
    kind: 'crushed',
    centre: shoulder,
    radius: ARM_WOUND_RADIUS,
    squash: 0.42,
    angle: Math.PI / 3,
    // The same humerus as the straight arm's, crushed into three fragments.
    bones: [
      { at: { x: -0.26, y: -0.1 }, size: 0.22 },
      { at: { x: 0.14, y: 0.14 }, size: 0.18 },
      { at: { x: 0.4, y: -0.2 }, size: 0.12 },
    ],
    runAngle: Math.PI,
    seed: ARM_SEED + 6.7,
    hide: FLESH_DARK,
  });
}

const LEG_SEED = 27.9;
/**
 * Torn off mid-thigh rather than at the hip: at the hip's full width the piece
 * is a cone with a foot on it, because her thigh is six times her ankle and a
 * single straight taper over one bone length has nowhere to put that.
 */
const LEG_SEVERED_AT = 0.42;
/**
 * Her leg is a huge thigh on a peg ankle — 6.4 to 1 root to tip. Hand-set, the
 * piece was 2.2 to 1, a near-uniform column, and its femur stump was drawn
 * wider than the thigh the femur supposedly came out of.
 */
const LEG_ROOT_HALF = THIGH_WIDTH + (KNEE_WIDTH - THIGH_WIDTH) * LEG_SEVERED_AT;
/**
 * The calf's width rather than the knee's. `jointedOutline` carries one width at
 * the joint, and putting the calf's there is what stops the shin reading as a
 * stick — the knee is the narrowest part of a leg and the least worth drawing.
 */
const LEG_KNEE_HALF = CALF_WIDTH;
const LEG_ANKLE_HALF = ANKLE_WIDTH;
const LEG_WOUND_RADIUS = LEG_ROOT_HALF * 0.72;
/** A hand's-width band of trouser, and how far it stands off the flesh. */
const TROUSER_CUFF_LENGTH = 0.14;
const TROUSER_WRAP = 1.08;
/**
 * The foot and what is on it, off the foot's own dimensions. Left in absolute
 * units they survived the ankle shrinking by 29% and came out as a detached
 * brown box, a pale crescent the limb painted over, and three toes packed
 * closer together than their own radius.
 */
const SLIPPER_HALF = FOOT_DEPTH * 0.62;
const SLIPPER_LENGTH = FOOT_LENGTH * 0.86;
const BARE_FOOT_RY = FOOT_DEPTH * 0.5;
const TOE_COUNT = 3;
const TOE_RADIUS = FOOT_DEPTH * 0.2;
/** Toes have to be spread by more than their own width or they are one lump. */
const TOE_SPREAD = TOE_RADIUS * 2.4;

/** The bent leg, with the burst slipper still on it. */
function leftLegPiece(ctx: Ctx): void {
  const {
    root: hip,
    joint: knee,
    end: ankle,
  } = jointsAlong(
    { x: -0.28, y: -0.3 },
    deg(33.7),
    THIGH_LENGTH * (1 - LEG_SEVERED_AT),
    deg(137),
    SHIN_LENGTH,
  );
  const outline = jointedOutline(
    hip,
    knee,
    ankle,
    LEG_ROOT_HALF,
    LEG_KNEE_HALF,
    LEG_ANKLE_HALF,
    LEG_SEED,
  );
  paintMass(ctx, tracer(ctx, outline), FLESH_TONE);
  mottle(ctx, tracer(ctx, outline), LEG_SEED, LEG_ROOT_HALF * 2);

  // The trouser cuff, which is what stops this leg reading as the bare one. Its
  // length is measured in figure units, not as a share of the surviving stub:
  // as a share it collapsed when the piece started being torn mid-thigh, and a
  // band 0.59 wide over 0.08 of length is a plank lying across the limb.
  const cuffAlong = TROUSER_CUFF_LENGTH / Math.max(MIN_SEGMENT_LENGTH, distance(hip, knee));
  const cuffTo = {
    x: lerp(hip.x, knee.x, Math.min(1, cuffAlong)),
    y: lerp(hip.y, knee.y, Math.min(1, cuffAlong)),
  };
  paintMass(
    ctx,
    tracer(
      ctx,
      // Wrapped, not stuck on: a cuff wider than the limb hangs past both edges
      // of the silhouette and reads as a separate object behind the leg.
      segmentOutline(
        hip,
        cuffTo,
        LEG_ROOT_HALF * TROUSER_WRAP,
        LEG_ROOT_HALF * TROUSER_WRAP,
        LEG_SEED + 2,
      ),
    ),
    TROUSER_TONE,
  );

  const slipperTip = { x: ankle.x - SLIPPER_LENGTH, y: ankle.y + SLIPPER_HALF * 0.4 };
  paintMass(
    ctx,
    tracer(ctx, segmentOutline(ankle, slipperTip, SLIPPER_HALF, SLIPPER_HALF * 0.8, LEG_SEED + 5)),
    SLIPPER_TONE,
  );

  drawWound(ctx, {
    kind: 'torn',
    centre: hip,
    radius: LEG_WOUND_RADIUS,
    squash: 0.45,
    angle: Math.PI / 5,
    // The femur: the largest single bone anywhere in the set, which is what
    // separates a thigh stump from an upper arm's at 16 pixels.
    bones: [{ at: { x: 0.08, y: 0 }, size: 0.58 }],
    runAngle: -Math.PI * 0.75,
    seed: LEG_SEED,
    hide: FLESH_DARK,
  });
}

/** The straight leg, bare, ending in toes — a column, not an L. */
function rightLegPiece(ctx: Ctx): void {
  // Only slightly bent. It used to fold hard, which is what told it apart from
  // the straight arm — but once every piece was laid out along her real bone
  // lengths this leg and the *folded* arm became the same comma, and G7 said so
  // at 63% shared silhouette. The L now belongs to the left leg alone.
  const {
    root: hip,
    joint: knee,
    end: ankle,
  } = jointsAlong(
    { x: -0.24, y: -0.32 },
    deg(58),
    THIGH_LENGTH * (1 - LEG_SEVERED_AT),
    deg(82),
    SHIN_LENGTH,
  );
  const outline = jointedOutline(
    hip,
    knee,
    ankle,
    LEG_ROOT_HALF,
    LEG_KNEE_HALF,
    LEG_ANKLE_HALF,
    LEG_SEED + 11.3,
  );
  // A wide bare foot across the end, which is the leg's own terminator and now
  // appears on no arm.
  ctx.fillStyle = FLESH_MID;
  ctx.beginPath();
  ctx.ellipse(
    ankle.x - BARE_FOOT_LEAD,
    ankle.y + BARE_FOOT_RY,
    BARE_FOOT_HALF,
    BARE_FOOT_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  for (let i = 0; i < TOE_COUNT; i++) {
    const share = i / (TOE_COUNT - 1);
    ctx.beginPath();
    ctx.arc(
      ankle.x - BARE_FOOT_LEAD - BARE_FOOT_HALF * 0.8,
      ankle.y + BARE_FOOT_RY + (share - 0.5) * TOE_SPREAD,
      TOE_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  paintMass(ctx, tracer(ctx, outline), FLESH_TONE);
  mottle(ctx, tracer(ctx, outline), LEG_SEED + 11.3, LEG_ROOT_HALF * 2);

  drawWound(ctx, {
    kind: 'clean',
    centre: hip,
    radius: LEG_WOUND_RADIUS,
    squash: 0.42,
    angle: -Math.PI / 8,
    // Cut through the joint rather than the shaft: the femur's ball with the
    // rim of its socket still round it.
    bones: [
      { at: { x: 0, y: 0 }, size: 0.46 },
      { at: { x: 0, y: 0 }, size: 0.78, hollow: true },
    ],
    runAngle: -Math.PI * 0.8,
    seed: LEG_SEED + 11.3,
    hide: FLESH_DARK,
  });
}

/**
 * Order is the sheet's column order and the runtime's `HOARDER_GORE_PARTS`
 * order; a bake gate holds the two equal.
 */
export function hoarderGorePieces(): readonly GorePiece[] {
  return [
    piece('gore_head', headPiece),
    piece('gore_right_arm', rightArmPiece),
    piece('gore_left_arm', leftArmPiece),
    piece('gore_left_leg', leftLegPiece),
    piece('gore_right_leg', rightLegPiece),
    piece('gore_torso', torsoPiece),
  ];
}
