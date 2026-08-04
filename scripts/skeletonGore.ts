/**
 * The pieces a skeleton comes apart into.
 *
 * A skeleton's gore is the one set in this game with no gore in it. There is
 * nothing to sever — the thing was already bones — so what flies is bone
 * scatter: a skull, a section of ribcage, the pelvis, the two big leg bones, the
 * forearm pair and a hand. Each break routes through
 * {@link drawBoneBreak} in `scripts/goreWound.ts` rather than through the flesh
 * engine beside it, so the exposed face is cortical wall and dry sponge instead
 * of muscle and blood.
 *
 * All three variants scatter the same seven shapes; what differs is the bone
 * tone (the warriors are far more weathered than their master) and the lord's
 * crown, which stays fused to his skull.
 *
 * Coordinates are tile units with the origin at the centre of the piece's own
 * cell. The generator re-centres each piece on its measured ink before the final
 * bake, so construction can be drawn wherever is convenient.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { drawBoneBreak } from './goreWound.js';
import {
  BONE,
  CAVITY,
  OUTLINE,
  TWO_PI,
  deg,
  fillCapsule,
  fillDisc,
  lerp,
  mix,
  outlineCapsule,
  outlineDisc,
  rgba,
  type Pt,
  type SkeletonVariant,
} from './skeletonArt.js';

/** One severed piece: the manifest state it bakes into, and how to paint it. */
export interface SkeletonGorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

/**
 * The order pieces are listed in, which is the order `BodyPartGoreSystem`
 * launches them. Exported so the runtime's `*_GORE_PARTS` list and this bake
 * cannot disagree about how many pieces there are.
 */
export const SKELETON_GORE_STATES: readonly string[] = [
  'gore_skull',
  'gore_ribcage',
  'gore_pelvis',
  'gore_femur',
  'gore_tibia',
  'gore_forearm',
  'gore_hand',
];

/** How weathered each variant's loose bones are, matching its standing art. */
const VARIANT_STAIN: Record<SkeletonVariant, number> = {
  lord: 0,
  sword: 0.3,
  archer: 0.42,
};

/** The dead brown old bone stains toward once it has been in the ground. */
const STAIN_TONE = '#8e7f57';
const STAIN_SHADOW = '#42381f';

interface BoneTone {
  readonly cortical: string;
  readonly mid: string;
  readonly dark: string;
  readonly shadow: string;
  readonly rim: string;
}

function toneFor(variant: SkeletonVariant): BoneTone {
  const stain = VARIANT_STAIN[variant];
  return {
    cortical: mix(BONE.light, STAIN_TONE, stain),
    mid: mix(BONE.mid, STAIN_TONE, stain),
    dark: mix(BONE.dark, STAIN_SHADOW, stain),
    shadow: mix(BONE.shadow, STAIN_SHADOW, stain),
    rim: mix(BONE.rim, STAIN_TONE, stain * 0.6),
  };
}

/**
 * Ambient light every piece takes, regardless of how it is tumbling.
 *
 * `BodyPartGoreSystem` spins each part continuously, so any lighting cue that
 * depended on the piece's orientation would strobe once per rotation.
 */
const AMBIENT_HIGHLIGHT_ALPHA = 0.26;

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** A long bone with a break at one end: shaft, one intact knob, one raw face. */
function paintSnappedLongBone(
  ctx: Ctx,
  tone: BoneTone,
  length: number,
  shaftWidth: number,
  knobRadius: number,
  seed: number,
): void {
  const head = pt(-length / 2, 0);
  const broken = pt(length / 2, 0);

  outlineDisc(ctx, head, knobRadius);
  outlineCapsule(ctx, head, broken, shaftWidth, shaftWidth * 0.92);
  fillCapsule(ctx, head, broken, shaftWidth, shaftWidth * 0.92, tone.mid);
  fillDisc(ctx, head, knobRadius, tone.mid);
  // The condyle is a pair of lobes, not a ball — that split is what says "knee"
  // or "hip" on a piece with no body left to place it against.
  fillDisc(
    ctx,
    { x: head.x - knobRadius * 0.3, y: -knobRadius * 0.35 },
    knobRadius * 0.55,
    tone.cortical,
  );
  fillDisc(
    ctx,
    { x: head.x - knobRadius * 0.3, y: knobRadius * 0.35 },
    knobRadius * 0.55,
    tone.mid,
  );
  fillCapsule(
    ctx,
    { x: head.x + knobRadius, y: -shaftWidth * 0.35 },
    { x: broken.x - shaftWidth, y: -shaftWidth * 0.3 },
    shaftWidth * 0.3,
    shaftWidth * 0.26,
    rgba(tone.rim, AMBIENT_HIGHLIGHT_ALPHA),
  );

  drawBoneBreak(ctx, {
    kind: 'torn',
    centre: broken,
    radius: shaftWidth * 1.05,
    squash: 0.55,
    angle: 0,
    seed,
    cortical: tone.cortical,
    shadow: tone.shadow,
  });
}

const SKULL_RX = 0.16;
const SKULL_RY = 0.2;
const ORBIT_RX = 0.05;
const ORBIT_RY = 0.055;

/** The skull, cracked across the crown, jaw hanging off its hinge. */
function paintSkullPiece(ctx: Ctx, tone: BoneTone, variant: SkeletonVariant): void {
  ctx.beginPath();
  ctx.ellipse(0, -0.02, SKULL_RX + 0.012, SKULL_RY + 0.012, 0, 0, TWO_PI);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -0.02, SKULL_RX, SKULL_RY, 0, 0, TWO_PI);
  ctx.fillStyle = tone.mid;
  ctx.fill();

  const dome = ctx.createRadialGradient(-SKULL_RX * 0.4, -SKULL_RY * 0.4, 0, 0, 0, SKULL_RX * 1.5);
  dome.addColorStop(0, rgba(tone.rim, 0.7));
  dome.addColorStop(1, rgba(tone.rim, 0));
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.ellipse(0, -0.02, SKULL_RX, SKULL_RY, 0, 0, TWO_PI);
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 0.055, -0.02, ORBIT_RX, ORBIT_RY, 0, 0, TWO_PI);
    ctx.fillStyle = CAVITY;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0.035);
  ctx.lineTo(0.022, 0.085);
  ctx.lineTo(-0.022, 0.085);
  ctx.closePath();
  ctx.fillStyle = CAVITY;
  ctx.fill();

  // Jaw, knocked off its hinge and hanging: a skull with a shut mouth reads as
  // a prop, and this one has just been hit hard enough to come off a body.
  ctx.save();
  ctx.translate(0.02, SKULL_RY * 0.62);
  ctx.rotate(deg(16));
  ctx.beginPath();
  ctx.moveTo(-SKULL_RX * 0.72, 0);
  ctx.quadraticCurveTo(0, SKULL_RY * 0.62, SKULL_RX * 0.72, 0);
  ctx.lineTo(SKULL_RX * 0.62, -0.022);
  ctx.quadraticCurveTo(0, SKULL_RY * 0.4, -SKULL_RX * 0.62, -0.022);
  ctx.closePath();
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.save();
  const JAW_INSET = 0.88;
  ctx.scale(JAW_INSET, JAW_INSET);
  ctx.beginPath();
  ctx.moveTo(-SKULL_RX * 0.72, 0);
  ctx.quadraticCurveTo(0, SKULL_RY * 0.62, SKULL_RX * 0.72, 0);
  ctx.lineTo(SKULL_RX * 0.62, -0.022);
  ctx.quadraticCurveTo(0, SKULL_RY * 0.4, -SKULL_RX * 0.62, -0.022);
  ctx.closePath();
  ctx.fillStyle = tone.cortical;
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // The crack that took the crown off, and the crown itself on the lord.
  ctx.strokeStyle = rgba(tone.shadow, 0.9);
  ctx.lineWidth = 0.011;
  ctx.beginPath();
  ctx.moveTo(-SKULL_RX * 0.8, -SKULL_RY * 0.4);
  ctx.lineTo(-SKULL_RX * 0.2, -SKULL_RY * 0.72);
  ctx.lineTo(SKULL_RX * 0.25, -SKULL_RY * 0.45);
  ctx.lineTo(SKULL_RX * 0.78, -SKULL_RY * 0.6);
  ctx.stroke();

  if (variant === 'lord') {
    const SPIKES = 5;
    for (let i = 0; i < SPIKES; i++) {
      const t = i / (SPIKES - 1) - 0.5;
      const x = t * SKULL_RX * 1.5;
      const height = SKULL_RY * lerp(0.2, 0.44, Math.max(0, 1 - Math.abs(t) * 1.4));
      const bandY = -SKULL_RY * 0.62;
      ctx.beginPath();
      ctx.moveTo(x - 0.016, bandY);
      ctx.lineTo(x, bandY - height);
      ctx.lineTo(x + 0.016, bandY);
      ctx.closePath();
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 0.011, bandY);
      ctx.lineTo(x, bandY - height * 0.85);
      ctx.lineTo(x + 0.011, bandY);
      ctx.closePath();
      ctx.fillStyle = tone.rim;
      ctx.fill();
    }
  }
}

const RIB_SECTION_COUNT = 4;

/**
 * A section of ribcage with a stub of spine still attached to it.
 *
 * Ribs on **both** sides of the column. Drawn on one side only — which is what
 * this piece did at first — it reads as a run of loose hooks beside a string of
 * beads, not as a ribcage: it is the paired arch either side of a spine that
 * names the shape.
 */
function paintRibcagePiece(ctx: Ctx, tone: BoneTone): void {
  const SPINE_TOP = -0.15;
  const SPINE_BOTTOM = 0.15;
  const VERTEBRA_RADIUS = 0.036;
  const RIB_INK_WIDTH = 0.036;
  const RIB_WIDTH = 0.027;

  for (let i = 0; i < RIB_SECTION_COUNT; i++) {
    const t = i / (RIB_SECTION_COUNT - 1);
    const y = lerp(SPINE_TOP, SPINE_BOTTOM, t);
    const reach = lerp(0.19, 0.26, Math.sin(t * Math.PI));
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(side * reach * 1.1, y + 0.015, side * reach * 0.66, y + 0.085);
      ctx.lineCap = 'round';
      ctx.lineWidth = RIB_INK_WIDTH;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = RIB_WIDTH;
      ctx.strokeStyle = side < 0 ? tone.mid : tone.cortical;
      ctx.stroke();
    }
  }

  // The column goes on last so the ribs plainly spring from behind it.
  outlineCapsule(
    ctx,
    pt(0, SPINE_TOP - 0.02),
    pt(0, SPINE_BOTTOM + 0.02),
    VERTEBRA_RADIUS * 0.8,
    VERTEBRA_RADIUS * 0.8,
  );
  fillCapsule(
    ctx,
    pt(0, SPINE_TOP - 0.02),
    pt(0, SPINE_BOTTOM + 0.02),
    VERTEBRA_RADIUS * 0.8,
    VERTEBRA_RADIUS * 0.8,
    tone.dark,
  );
  for (let i = 0; i < RIB_SECTION_COUNT; i++) {
    const t = i / (RIB_SECTION_COUNT - 1);
    const y = lerp(SPINE_TOP, SPINE_BOTTOM, t);
    outlineDisc(ctx, pt(0, y), VERTEBRA_RADIUS);
    fillDisc(ctx, pt(0, y), VERTEBRA_RADIUS, tone.mid);
    fillDisc(
      ctx,
      pt(-VERTEBRA_RADIUS * 0.28, y - VERTEBRA_RADIUS * 0.28),
      VERTEBRA_RADIUS * 0.45,
      tone.cortical,
    );
  }

  const RIBCAGE_BREAK_SEED = 4102;
  drawBoneBreak(ctx, {
    kind: 'crushed',
    centre: pt(0, SPINE_BOTTOM + 0.03),
    radius: VERTEBRA_RADIUS * 1.1,
    squash: 0.5,
    angle: 0,
    seed: RIBCAGE_BREAK_SEED,
    cortical: tone.cortical,
    shadow: tone.shadow,
  });
}

/**
 * The pelvis: two broad iliac wings, two sockets and a closed pubic arch, with
 * the obturator holes left as real transparency between them.
 *
 * The wings are filled arcs rather than capsules. Drawn as two fat capsules
 * angled up and out — the first attempt — the piece reads as a moth, because a
 * capsule is as thick at its end as in its middle and an iliac blade is a fan.
 */
function paintPelvisPiece(ctx: Ctx, tone: BoneTone): void {
  const HALF = 0.2;
  const CREST_Y = -0.1;
  const SOCKET_Y = 0.06;
  const PUBIS_Y = 0.11;
  const RAMUS_WIDTH = 0.03;
  const SOCKET_RADIUS = 0.042;

  const traceWing = (side: number, grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(side * (HALF * 0.28 - grow), SOCKET_Y);
    // Up the inner edge, out along the crest, then back down to the socket.
    ctx.quadraticCurveTo(side * HALF * 0.3, CREST_Y - grow, side * (HALF * 0.55), CREST_Y - grow);
    ctx.quadraticCurveTo(
      side * (HALF + grow),
      CREST_Y - grow,
      side * (HALF + grow),
      SOCKET_Y - 0.03,
    );
    ctx.quadraticCurveTo(
      side * (HALF + grow),
      SOCKET_Y + grow,
      side * (HALF * 0.62),
      SOCKET_Y + grow,
    );
    ctx.closePath();
  };

  for (const side of [-1, 1]) {
    traceWing(side, 0.012);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    traceWing(side, 0);
    ctx.fillStyle = tone.mid;
    ctx.fill();
    // The crest's lit edge is what stops a flat wing reading as a paper cut-out.
    ctx.strokeStyle = rgba(tone.rim, AMBIENT_HIGHLIGHT_ALPHA);
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(side * HALF * 0.55, CREST_Y + 0.008);
    ctx.quadraticCurveTo(side * HALF * 0.92, CREST_Y + 0.008, side * HALF * 0.92, SOCKET_Y - 0.04);
    ctx.stroke();
  }

  // Pubic arch: two bars meeting at the bottom centre, closing the ring and
  // leaving one hole under each socket.
  for (const side of [-1, 1]) {
    const socket = pt(side * HALF * 0.7, SOCKET_Y);
    const pubis = pt(side * 0.012, PUBIS_Y);
    outlineCapsule(ctx, socket, pubis, RAMUS_WIDTH, RAMUS_WIDTH * 0.8);
    fillCapsule(ctx, socket, pubis, RAMUS_WIDTH, RAMUS_WIDTH * 0.8, tone.dark);
  }

  // The sockets themselves — the only round dark things on the piece, and what
  // says "this is where the legs went".
  for (const side of [-1, 1]) {
    const socket = pt(side * HALF * 0.7, SOCKET_Y);
    outlineDisc(ctx, socket, SOCKET_RADIUS);
    fillDisc(ctx, socket, SOCKET_RADIUS, tone.mid);
    fillDisc(ctx, socket, SOCKET_RADIUS * 0.62, tone.shadow);
  }

  const SACRUM_WIDTH = 0.042;
  outlineCapsule(ctx, pt(0, CREST_Y - 0.02), pt(0, SOCKET_Y), SACRUM_WIDTH, SACRUM_WIDTH * 0.55);
  fillCapsule(
    ctx,
    pt(0, CREST_Y - 0.02),
    pt(0, SOCKET_Y),
    SACRUM_WIDTH,
    SACRUM_WIDTH * 0.55,
    tone.mid,
  );

  const PELVIS_BREAK_SEED = 8817;
  drawBoneBreak(ctx, {
    kind: 'clean',
    centre: pt(0, CREST_Y - 0.03),
    radius: SACRUM_WIDTH,
    squash: 0.45,
    angle: 0,
    seed: PELVIS_BREAK_SEED,
    cortical: tone.cortical,
    shadow: tone.shadow,
  });
}

/**
 * The radius and ulna, snapped off at the wrist.
 *
 * They are drawn as two separate bones with their own heads rather than sharing
 * one disc at the elbow: joined at both ends the pair closes into a single
 * outline and reads as a hairpin, which is the exact opposite of the point —
 * the gap between them is what says "forearm" instead of "stick".
 */
function paintForearmPiece(ctx: Ctx, tone: BoneTone): void {
  const ELBOW_X = -0.17;
  const WRIST_X = 0.17;
  const ELBOW_GAP = 0.05;
  const WRIST_GAP = 0.032;
  const BONE_WIDTH = 0.022;
  const HEAD_RADIUS = 0.036;
  const FOREARM_BREAK_SEED = 2255;

  for (const side of [-1, 1]) {
    const head = pt(ELBOW_X, side * ELBOW_GAP);
    const tip = pt(WRIST_X, side * WRIST_GAP);
    outlineDisc(ctx, head, HEAD_RADIUS);
    outlineCapsule(ctx, head, tip, BONE_WIDTH, BONE_WIDTH * 0.85);
  }
  for (const side of [-1, 1]) {
    const head = pt(ELBOW_X, side * ELBOW_GAP);
    const tip = pt(WRIST_X, side * WRIST_GAP);
    // The ulna is the heavier of the two and carries the elbow's hook.
    const body = side < 0 ? tone.mid : tone.cortical;
    fillCapsule(ctx, head, tip, BONE_WIDTH, BONE_WIDTH * 0.85, body);
    fillDisc(ctx, head, HEAD_RADIUS, body);
    fillDisc(
      ctx,
      pt(head.x - HEAD_RADIUS * 0.3, head.y - HEAD_RADIUS * 0.3),
      HEAD_RADIUS * 0.45,
      tone.rim,
    );
    drawBoneBreak(ctx, {
      kind: 'clean',
      centre: tip,
      radius: BONE_WIDTH * 1.05,
      squash: 0.5,
      angle: 0,
      seed: FOREARM_BREAK_SEED + side,
      cortical: tone.cortical,
      shadow: tone.shadow,
    });
  }
}

const HAND_FINGER_COUNT = 4;

/**
 * A hand snapped off at the wrist, fingers hooked into a claw.
 *
 * The fingers fan across a narrow arc and all point the same way, with a wrist
 * stub behind the palm. Fanned right round the palm instead — which is what a
 * radial layout gives — the piece reads unmistakably as a spider.
 */
function paintHandPiece(ctx: Ctx, tone: BoneTone): void {
  const PALM = pt(-0.02, 0.05);
  const PALM_RADIUS = 0.05;
  const FINGER_WIDTH = 0.017;
  const REACH = 0.078;
  /** Total spread of the four fingers. A hand's digits are close to parallel. */
  const FINGER_FAN = deg(46);
  /** Which way the fingers point: up the cell, so the wrist can sit below. */
  const HAND_AIM = deg(-74);

  const wrist = pt(
    PALM.x - Math.cos(HAND_AIM) * PALM_RADIUS * 1.5,
    PALM.y - Math.sin(HAND_AIM) * PALM_RADIUS * 1.5,
  );
  outlineCapsule(ctx, wrist, PALM, PALM_RADIUS * 0.62, PALM_RADIUS * 0.8);

  for (let i = 0; i < HAND_FINGER_COUNT; i++) {
    const fan = (i / (HAND_FINGER_COUNT - 1) - 0.5) * 2;
    const angle = HAND_AIM + (fan * FINGER_FAN) / 2;
    // The outer fingers are shorter, which is most of what makes a fan of
    // equal-length spokes read as a hand.
    const length = REACH * lerp(1, 0.78, Math.abs(fan));
    const knuckle = pt(PALM.x + Math.cos(angle) * length, PALM.y + Math.sin(angle) * length);
    const hook = angle + deg(52);
    const tip = pt(
      knuckle.x + Math.cos(hook) * length * 0.75,
      knuckle.y + Math.sin(hook) * length * 0.75,
    );
    outlineCapsule(ctx, PALM, knuckle, FINGER_WIDTH, FINGER_WIDTH);
    outlineCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.7);
    fillCapsule(ctx, PALM, knuckle, FINGER_WIDTH, FINGER_WIDTH, tone.cortical);
    fillCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.7, tone.mid);
  }

  const thumbAngle = HAND_AIM - deg(78);
  const thumbTip = pt(
    PALM.x + Math.cos(thumbAngle) * REACH * 0.8,
    PALM.y + Math.sin(thumbAngle) * REACH * 0.8,
  );
  outlineCapsule(ctx, PALM, thumbTip, FINGER_WIDTH * 1.15, FINGER_WIDTH * 0.8);
  fillCapsule(ctx, PALM, thumbTip, FINGER_WIDTH * 1.15, FINGER_WIDTH * 0.8, tone.cortical);

  fillCapsule(ctx, wrist, PALM, PALM_RADIUS * 0.62, PALM_RADIUS * 0.8, tone.mid);
  fillDisc(
    ctx,
    pt(PALM.x - PALM_RADIUS * 0.3, PALM.y - PALM_RADIUS * 0.3),
    PALM_RADIUS * 0.45,
    tone.cortical,
  );

  const HAND_BREAK_SEED = 6631;
  drawBoneBreak(ctx, {
    kind: 'torn',
    centre: wrist,
    radius: PALM_RADIUS * 0.62,
    squash: 0.6,
    angle: HAND_AIM,
    seed: HAND_BREAK_SEED,
    cortical: tone.cortical,
    shadow: tone.shadow,
  });
}

const FEMUR_LENGTH = 0.42;
const FEMUR_SHAFT = 0.042;
const FEMUR_HEAD = 0.062;
const TIBIA_LENGTH = 0.36;
const TIBIA_SHAFT = 0.034;
const TIBIA_HEAD = 0.05;
const FEMUR_BREAK_SEED = 1301;
const TIBIA_BREAK_SEED = 7717;

/** Every piece for one variant, in the order `BodyPartGoreSystem` spawns them. */
export function skeletonGorePieces(variant: SkeletonVariant): readonly SkeletonGorePiece[] {
  const tone = toneFor(variant);
  return [
    { state: 'gore_skull', paint: (ctx) => paintSkullPiece(ctx, tone, variant) },
    { state: 'gore_ribcage', paint: (ctx) => paintRibcagePiece(ctx, tone) },
    { state: 'gore_pelvis', paint: (ctx) => paintPelvisPiece(ctx, tone) },
    {
      state: 'gore_femur',
      paint: (ctx) =>
        paintSnappedLongBone(ctx, tone, FEMUR_LENGTH, FEMUR_SHAFT, FEMUR_HEAD, FEMUR_BREAK_SEED),
    },
    {
      state: 'gore_tibia',
      paint: (ctx) =>
        paintSnappedLongBone(ctx, tone, TIBIA_LENGTH, TIBIA_SHAFT, TIBIA_HEAD, TIBIA_BREAK_SEED),
    },
    { state: 'gore_forearm', paint: (ctx) => paintForearmPiece(ctx, tone) },
    { state: 'gore_hand', paint: (ctx) => paintHandPiece(ctx, tone) },
  ];
}
