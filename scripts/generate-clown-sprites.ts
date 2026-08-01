#!/usr/bin/env tsx
/**
 * Generates the sprite sheets for Grimaldi's clown troupe on floor 3 — the Fat
 * Clown, the Stilt Clown and Terror the Clown.
 *
 * Each clown is posed through the shared skeletal rig in `scripts/clownArt.ts`,
 * which solves knees and elbows from foot and hand targets. Gaits are therefore
 * authored as *where the foot goes*, which is what keeps a planted foot planted
 * and stops a limb from sliding off the body mid-swing.
 *
 * Every figure is drawn facing +X; the runtime mirrors it for the other facing.
 *
 * Sheet rows (see the `fat_clown`, `stilt_clown` and `terror_clown` entries in
 * src/images/enemies/manifest.json):
 *   fat_clown     walk, idle, slam
 *   stilt_clown   walk, idle, windup, lunge
 *   terror_clown  walk, idle, windup, swing, then the same four enraged
 *
 * Run: npx tsx scripts/generate-clown-sprites.ts
 * Review: npx tsx scripts/render-clowns.ts
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clamp01,
  deg,
  groundedHipHeight,
  drawClown,
  easeInOut,
  easeOut,
  lerp,
  restingPose,
  shoulderHeight,
  type ClownPalette,
  type ClownPose,
  type ClownProportions,
  type ClownStyle,
  type Point,
  type PropPainter,
} from './clownArt';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** zlib's slowest, smallest setting — see the note in `renderSheet`. */
const MAX_PNG_COMPRESSION = 9;

const FULL_CYCLE = Math.PI * 2;

// ── Shared gait construction ─────────────────────────────────────────────────

/** Fraction of a stride the foot spends planted on the ground. */
const CONTACT_FRACTION = 0.6;

interface GaitConfig {
  /** Half the distance between the forward and rear extremes of a stride. */
  readonly stride: number;
  /** Peak height of the foot during its swing. */
  readonly lift: number;
  /** Peak rise of the pelvis at mid-stance. */
  readonly bob: number;
  /** Side-to-side weight transfer of the pelvis. */
  readonly sway: number;
  readonly leanBase: number;
  readonly leanSwing: number;
  /** Forward/back travel of the hands as they counter-swing the legs. */
  readonly armSwing: number;
}

/** Where a foot sits at `phase` (0–1) of its own stride cycle. */
function footTarget(phase: number, config: GaitConfig): Point {
  const wrapped = phase - Math.floor(phase);
  if (wrapped < CONTACT_FRACTION) {
    const rolled = wrapped / CONTACT_FRACTION;
    return { x: lerp(config.stride, -config.stride, rolled), y: 0 };
  }
  const swing = (wrapped - CONTACT_FRACTION) / (1 - CONTACT_FRACTION);
  return {
    x: lerp(-config.stride, config.stride, easeInOut(swing)),
    y: -config.lift * Math.sin(swing * Math.PI),
  };
}

/** Two footfalls per cycle, so the pelvis rises twice as fast as it strides. */
const BOB_PER_CYCLE = 2;

function walkPose(style: ClownStyle, phase: number, config: GaitConfig): ClownPose {
  const rest = restingPose(style);
  const swingAngle = phase * FULL_CYCLE;
  const armPhase = Math.sin(swingAngle);
  const handLift = Math.abs(armPhase) * config.armSwing * 0.2;

  return {
    ...rest,
    bob: -config.bob * (0.5 - 0.5 * Math.cos(swingAngle * BOB_PER_CYCLE)),
    sway: config.sway * Math.sin(swingAngle),
    lean: config.leanBase + config.leanSwing * Math.sin(swingAngle * BOB_PER_CYCLE),
    nearFoot: footTarget(phase, config),
    farFoot: footTarget(phase + 0.5, config),
    nearHand: {
      x: rest.nearHand.x - armPhase * config.armSwing,
      y: rest.nearHand.y - handLift,
    },
    farHand: {
      x: rest.farHand.x + armPhase * config.armSwing,
      y: rest.farHand.y - handLift,
    },
    headTilt: -armPhase * deg(3),
  };
}

/** Breathing idle: the chest swells, the weight settles, the eyes pulse. */
interface IdleConfig {
  readonly breathDepth: number;
  readonly bob: number;
  readonly sway: number;
  readonly headRoll: number;
  readonly mouthPulse: number;
}

function idlePose(style: ClownStyle, phase: number, config: IdleConfig): ClownPose {
  const rest = restingPose(style);
  const breath = Math.sin(phase * FULL_CYCLE);
  const GLOW_FLOOR = 0.45;
  const GLOW_RANGE = 0.35;

  return {
    ...rest,
    bob: config.bob * breath,
    sway: config.sway * Math.sin(phase * FULL_CYCLE + Math.PI / 2),
    torsoSquash: 1 + config.breathDepth * breath,
    nearHand: { x: rest.nearHand.x, y: rest.nearHand.y - config.bob * breath },
    farHand: { x: rest.farHand.x, y: rest.farHand.y + config.bob * breath },
    headTilt: config.headRoll * Math.sin(phase * FULL_CYCLE + Math.PI / 4),
    mouthOpen: config.mouthPulse * (0.5 + 0.5 * breath),
    eyeGlow: GLOW_FLOOR + GLOW_RANGE * (0.5 + 0.5 * breath),
  };
}

// ── Fat Clown ────────────────────────────────────────────────────────────────

const FAT_PALETTE: ClownPalette = {
  suitLight: '#f0e2c6',
  suitMid: '#b62334',
  suitDark: '#7d1523',
  suitTrim: '#e8c34a',
  suitFar: '#5e0f1a',
  limbSheen: 'rgba(255,240,215,0.2)',
  accent: '#e8c34a',
  ruff: '#f3e6cd',
  ruffShade: '#c3ad8c',
  skin: '#e7d3b6',
  skinShade: '#c9ac89',
  paint: '#f4ece0',
  paintShade: '#cbbda9',
  paintMark: '#241a1c',
  mouthFill: '#8f1120',
  mouthDark: '#3d0a12',
  teeth: '#e9dcc4',
  hair: '#e4622a',
  hairShade: '#b8451c',
  shoe: '#3c2f52',
  shoeDark: '#221a30',
  nose: '#d61f28',
  noseHighlight: '#ff8b7a',
  eyeCore: '#fff2c2',
  eyeGlow: 'rgba(255,138,40,0.85)',
  outline: '#1a1016',
};

const FAT_PROPORTIONS: ClownProportions = {
  torsoLength: 0.58,
  shoulderHalfWidth: 0.34,
  hipHalfWidth: 0.38,
  bellyBulge: 0.22,
  neckLength: 0.04,
  headRadius: 0.27,
  headWidthFactor: 1.0,
  thighLength: 0.22,
  shinLength: 0.22,
  upperArmLength: 0.26,
  forearmLength: 0.26,
  legWidth: 0.19,
  armWidth: 0.16,
  handRadius: 0.1,
  shoeLength: 0.44,
  shoeHeight: 0.12,
};

const FAT_STYLE: ClownStyle = {
  palette: FAT_PALETTE,
  proportions: FAT_PROPORTIONS,
  hair: 'tufts',
  mouth: 'grin',
  facePaint: 'rouge',
  pattern: 'stripes',
  feet: 'shoes',
  hat: 'none',
  ruffRadius: 0.3,
  pompomCount: 3,
};

const FAT_GAIT: GaitConfig = {
  stride: 0.16,
  lift: 0.07,
  bob: 0.045,
  sway: 0.035,
  leanBase: deg(4),
  leanSwing: deg(3),
  armSwing: 0.13,
};

const FAT_IDLE: IdleConfig = {
  breathDepth: 0.05,
  bob: 0.02,
  sway: 0.012,
  headRoll: deg(4),
  mouthPulse: 0.35,
};

/** Slam beats: cock back, drive the shoulder through, then settle. */
const SLAM_WINDUP_END = 0.35;
const SLAM_STRIKE_END = 0.6;

function fatSlamPose(progress: number): ClownPose {
  const rest = restingPose(FAT_STYLE);
  const armLength = FAT_PROPORTIONS.upperArmLength + FAT_PROPORTIONS.forearmLength;
  const shoulderY = -shoulderHeight(FAT_PROPORTIONS);

  const windup = clamp01(progress / SLAM_WINDUP_END);
  const strike = clamp01((progress - SLAM_WINDUP_END) / (SLAM_STRIKE_END - SLAM_WINDUP_END));
  const recover = clamp01((progress - SLAM_STRIKE_END) / (1 - SLAM_STRIKE_END));

  const drive = easeOut(strike) * (1 - easeInOut(recover));
  const cock = easeInOut(windup) * (1 - easeOut(strike));

  const REACH_FORWARD = 0.95;
  const REACH_BACK = 0.35;
  const HAND_RISE = 0.3;

  const handX =
    lerp(rest.nearHand.x, -armLength * REACH_BACK, cock) + armLength * REACH_FORWARD * drive;
  const handY =
    lerp(rest.nearHand.y, shoulderY + armLength * 0.35, cock) - armLength * HAND_RISE * drive;

  return {
    ...rest,
    lean: deg(-14) * cock + deg(30) * drive,
    bob: 0.04 * cock - 0.05 * drive,
    sway: -0.06 * cock + 0.12 * drive,
    torsoSquash: 1 + 0.06 * cock - 0.05 * drive,
    nearFoot: { x: FAT_PROPORTIONS.hipHalfWidth * 0.5 + 0.2 * drive, y: 0 },
    farFoot: { x: -FAT_PROPORTIONS.hipHalfWidth * 0.5 - 0.12 * cock, y: 0 },
    nearHand: { x: handX, y: handY },
    farHand: {
      x: rest.farHand.x - 0.1 * cock + 0.22 * drive,
      y: rest.farHand.y - armLength * 0.18 * drive,
    },
    headTilt: deg(-8) * cock + deg(16) * drive,
    headLead: 0.06 * drive,
    mouthOpen: Math.max(cock * 0.5, drive),
    eyeGlow: 0.6 + 0.4 * Math.max(cock, drive),
  };
}

// ── Stilt Clown ──────────────────────────────────────────────────────────────

const STILT_PALETTE: ClownPalette = {
  suitLight: '#7b58a6',
  suitMid: '#432a63',
  suitDark: '#2a1740',
  suitTrim: '#6b5330',
  suitFar: '#1f1030',
  limbSheen: 'rgba(224,206,255,0.18)',
  accent: '#c9d94a',
  ruff: '#d9cfe6',
  ruffShade: '#9b8fb0',
  skin: '#d8cfc0',
  skinShade: '#b0a493',
  paint: '#efeae2',
  paintShade: '#bdb5a8',
  paintMark: '#17121c',
  mouthFill: '#7a0f2a',
  mouthDark: '#2b0713',
  teeth: '#ded2b8',
  hair: '#2a2029',
  hairShade: '#14101a',
  shoe: '#8a6a3a',
  shoeDark: '#4a3520',
  nose: '#b81f34',
  noseHighlight: '#ef7d80',
  eyeCore: '#e8fbff',
  eyeGlow: 'rgba(120,220,255,0.8)',
  outline: '#120d18',
};

const STILT_PROPORTIONS: ClownProportions = {
  torsoLength: 0.5,
  shoulderHalfWidth: 0.2,
  hipHalfWidth: 0.17,
  bellyBulge: 0.02,
  neckLength: 0.13,
  headRadius: 0.21,
  headWidthFactor: 0.82,
  thighLength: 0.5,
  shinLength: 0.82,
  upperArmLength: 0.42,
  forearmLength: 0.46,
  legWidth: 0.1,
  armWidth: 0.085,
  handRadius: 0.085,
  shoeLength: 0.2,
  shoeHeight: 0.05,
};

const STILT_STYLE: ClownStyle = {
  palette: STILT_PALETTE,
  proportions: STILT_PROPORTIONS,
  hair: 'stringy',
  mouth: 'stitched',
  facePaint: 'tears',
  pattern: 'harlequin',
  feet: 'stilts',
  hat: 'cone',
  ruffRadius: 0.19,
  pompomCount: 2,
};

const STILT_GAIT: GaitConfig = {
  stride: 0.3,
  lift: 0.26,
  bob: 0.05,
  sway: 0.02,
  leanBase: deg(-2),
  leanSwing: deg(2),
  armSwing: 0.09,
};

const STILT_IDLE: IdleConfig = {
  breathDepth: 0.025,
  bob: 0.035,
  sway: 0.03,
  headRoll: deg(9),
  mouthPulse: 0.2,
};

/** The stilt clown rears back and coils before every strike. */
function stiltWindupPose(progress: number): ClownPose {
  const rest = restingPose(STILT_STYLE);
  const coil = easeInOut(progress);
  const armLength = STILT_PROPORTIONS.upperArmLength + STILT_PROPORTIONS.forearmLength;
  const shoulderY = -shoulderHeight(STILT_PROPORTIONS);
  const tremor = Math.sin(progress * FULL_CYCLE * 3) * 0.012 * coil;

  return {
    ...rest,
    lean: deg(-13) * coil,
    bob: -0.05 * coil,
    sway: -0.05 * coil + tremor,
    nearFoot: { x: rest.nearFoot.x + 0.12 * coil, y: 0 },
    farFoot: { x: rest.farFoot.x - 0.16 * coil, y: 0 },
    nearHand: {
      x: lerp(rest.nearHand.x, -armLength * 0.42, coil),
      y: lerp(rest.nearHand.y, shoulderY + armLength * 0.2, coil),
    },
    farHand: {
      x: lerp(rest.farHand.x, -armLength * 0.3, coil),
      y: lerp(rest.farHand.y, shoulderY + armLength * 0.55, coil),
    },
    headTilt: deg(-14) * coil,
    headLead: -0.04 * coil,
    mouthOpen: coil,
    eyeGlow: 0.4 + 0.6 * coil,
  };
}

/** …then unfolds, throwing its whole reach at the target. */
const STILT_LUNGE_STRIKE_END = 0.45;

function stiltLungePose(progress: number): ClownPose {
  const rest = restingPose(STILT_STYLE);
  const armLength = STILT_PROPORTIONS.upperArmLength + STILT_PROPORTIONS.forearmLength;
  const shoulderY = -shoulderHeight(STILT_PROPORTIONS);
  const thrust = easeOut(clamp01(progress / STILT_LUNGE_STRIKE_END));
  const settle = easeInOut(
    clamp01((progress - STILT_LUNGE_STRIKE_END) / (1 - STILT_LUNGE_STRIKE_END)),
  );
  const extend = thrust * (1 - settle * 0.55);

  const REACH_FRACTION = 1.3;
  // The claw finishes at roughly the player's chest, not up by its own head.
  const STRIKE_HAND_HEIGHT = -groundedHipHeight(STILT_PROPORTIONS) * 0.72;

  return {
    ...rest,
    lean: deg(26) * extend,
    bob: 0.03 * extend,
    sway: 0.1 * extend,
    nearFoot: { x: rest.nearFoot.x + 0.26 * extend, y: 0 },
    farFoot: { x: rest.farFoot.x - 0.3 * extend, y: 0 },
    nearHand: {
      x: lerp(-armLength * 0.42, armLength * REACH_FRACTION, extend),
      y: lerp(shoulderY + armLength * 0.2, STRIKE_HAND_HEIGHT, extend),
    },
    farHand: {
      x: lerp(-armLength * 0.3, -armLength * 0.55, extend),
      y: lerp(shoulderY + armLength * 0.55, shoulderY + armLength * 0.75, extend),
    },
    headTilt: deg(18) * extend,
    headLead: 0.09 * extend,
    mouthOpen: 1 - settle * 0.6,
    eyeGlow: 1,
  };
}

// ── Terror the Clown ─────────────────────────────────────────────────────────

const TERROR_PALETTE: ClownPalette = {
  suitLight: '#7c4090',
  suitMid: '#4a2156',
  suitDark: '#1e0d24',
  suitTrim: '#3a3a3a',
  suitFar: '#24102c',
  limbSheen: 'rgba(238,220,255,0.16)',
  accent: '#4ea832',
  ruff: '#b8a2c4',
  ruffShade: '#7d6a8a',
  skin: '#dcc7ab',
  skinShade: '#b39a7c',
  paint: '#f2e9dc',
  paintShade: '#c0b2a0',
  paintMark: '#1b1116',
  mouthFill: '#7d0f1c',
  mouthDark: '#2c060c',
  teeth: '#efe4c8',
  hair: '#3f9a2b',
  hairShade: '#26661a',
  shoe: '#2b2b2b',
  shoeDark: '#151515',
  nose: '#cf1f26',
  noseHighlight: '#ff8272',
  eyeCore: '#fff6d0',
  eyeGlow: 'rgba(255,70,40,0.9)',
  outline: '#0f0a12',
};

/** Enrage repaints the suit and stokes the eyes; the skeleton is unchanged. */
const TERROR_ENRAGED_PALETTE: ClownPalette = {
  ...TERROR_PALETTE,
  suitLight: '#9c2f36',
  suitMid: '#87202e',
  suitDark: '#3d0a12',
  suitFar: '#4a0b16',
  accent: '#ffb02e',
  hair: '#e8b21f',
  hairShade: '#b87d10',
  paintMark: '#2a0d10',
  eyeCore: '#fffbe8',
  eyeGlow: 'rgba(255,170,40,0.95)',
};

const TERROR_PROPORTIONS: ClownProportions = {
  torsoLength: 0.72,
  shoulderHalfWidth: 0.4,
  hipHalfWidth: 0.38,
  bellyBulge: 0.14,
  neckLength: 0.05,
  headRadius: 0.34,
  headWidthFactor: 1.05,
  thighLength: 0.34,
  shinLength: 0.36,
  upperArmLength: 0.38,
  forearmLength: 0.4,
  legWidth: 0.21,
  armWidth: 0.19,
  handRadius: 0.13,
  shoeLength: 0.5,
  shoeHeight: 0.15,
};

function terrorStyle(enraged: boolean): ClownStyle {
  return {
    palette: enraged ? TERROR_ENRAGED_PALETTE : TERROR_PALETTE,
    proportions: TERROR_PROPORTIONS,
    hair: 'mane',
    mouth: 'fanged',
    facePaint: 'slashes',
    pattern: 'motley',
    feet: 'shoes',
    hat: 'none',
    ruffRadius: 0.26,
    pompomCount: 3,
  };
}

const TERROR_GAIT: GaitConfig = {
  stride: 0.22,
  lift: 0.11,
  bob: 0.05,
  sway: 0.03,
  leanBase: deg(6),
  leanSwing: deg(2.5),
  armSwing: 0.11,
};

const TERROR_IDLE: IdleConfig = {
  breathDepth: 0.04,
  bob: 0.025,
  sway: 0.015,
  headRoll: deg(5),
  mouthPulse: 0.45,
};

/** Rotation from the forearm to the mallet's shaft — a natural wrist cock. */
const MALLET_GRIP_ANGLE = deg(-15);
const MALLET_SWING_WRIST_ANGLE = deg(12);
const MALLET_HANDLE_LENGTH = 0.92;
const MALLET_GRIP_OVERHANG = 0.16;
const MALLET_HANDLE_WIDTH = 0.08;
const MALLET_HEAD_LENGTH = 0.3;
const MALLET_HEAD_HALF_HEIGHT = 0.17;
const MALLET_BAND_WIDTH = 0.05;

function makeMalletPainter(palette: ClownPalette): PropPainter {
  return (ctx: Ctx, hand: Point, wristAngle: number): void => {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(wristAngle);

    const handleEnd = MALLET_HANDLE_LENGTH;
    ctx.fillStyle = palette.outline;
    ctx.fillRect(
      -MALLET_GRIP_OVERHANG,
      -MALLET_HANDLE_WIDTH * 0.75,
      handleEnd + MALLET_GRIP_OVERHANG,
      MALLET_HANDLE_WIDTH * 1.5,
    );
    ctx.fillStyle = '#7a5326';
    ctx.fillRect(
      -MALLET_GRIP_OVERHANG,
      -MALLET_HANDLE_WIDTH * 0.5,
      handleEnd + MALLET_GRIP_OVERHANG,
      MALLET_HANDLE_WIDTH,
    );
    ctx.fillStyle = '#a9793d';
    ctx.fillRect(
      -MALLET_GRIP_OVERHANG,
      -MALLET_HANDLE_WIDTH * 0.5,
      handleEnd + MALLET_GRIP_OVERHANG,
      MALLET_HANDLE_WIDTH * 0.3,
    );

    ctx.fillStyle = palette.outline;
    ctx.fillRect(
      handleEnd - MALLET_HEAD_LENGTH * 0.35,
      -MALLET_HEAD_HALF_HEIGHT - MALLET_BAND_WIDTH * 0.4,
      MALLET_HEAD_LENGTH + MALLET_BAND_WIDTH * 0.8,
      MALLET_HEAD_HALF_HEIGHT * 2 + MALLET_BAND_WIDTH * 0.8,
    );
    ctx.fillStyle = palette.suitMid;
    ctx.fillRect(
      handleEnd - MALLET_HEAD_LENGTH * 0.35,
      -MALLET_HEAD_HALF_HEIGHT,
      MALLET_HEAD_LENGTH,
      MALLET_HEAD_HALF_HEIGHT * 2,
    );
    ctx.fillStyle = palette.suitLight;
    ctx.fillRect(
      handleEnd - MALLET_HEAD_LENGTH * 0.35,
      -MALLET_HEAD_HALF_HEIGHT,
      MALLET_HEAD_LENGTH,
      MALLET_HEAD_HALF_HEIGHT * 0.55,
    );
    ctx.fillStyle = palette.accent;
    ctx.fillRect(
      handleEnd + MALLET_HEAD_LENGTH * 0.5,
      -MALLET_HEAD_HALF_HEIGHT,
      MALLET_BAND_WIDTH,
      MALLET_HEAD_HALF_HEIGHT * 2,
    );

    ctx.restore();
  };
}

const TERROR_ARM_LENGTH = TERROR_PROPORTIONS.upperArmLength + TERROR_PROPORTIONS.forearmLength;
const TERROR_SHOULDER_Y = -shoulderHeight(TERROR_PROPORTIONS);

/** Mallet hauled back over the shoulder, weight loaded onto the rear foot. */
function terrorWindupPose(progress: number): ClownPose {
  const rest = restingPose(terrorStyle(false));
  const load = easeInOut(progress);
  const shudder = Math.sin(progress * FULL_CYCLE * 2.5) * deg(2) * load;

  return {
    ...rest,
    lean: deg(-16) * load,
    bob: -0.03 * load,
    sway: -0.08 * load,
    torsoSquash: 1 + 0.04 * load,
    nearFoot: { x: rest.nearFoot.x + 0.14 * load, y: 0 },
    farFoot: { x: rest.farFoot.x - 0.14 * load, y: 0 },
    nearHand: {
      x: lerp(rest.nearHand.x, -TERROR_ARM_LENGTH * 0.28, load),
      y: lerp(rest.nearHand.y, TERROR_SHOULDER_Y - TERROR_ARM_LENGTH * 0.72, load),
    },
    farHand: {
      x: lerp(rest.farHand.x, -TERROR_ARM_LENGTH * 0.5, load),
      y: lerp(rest.farHand.y, TERROR_SHOULDER_Y - TERROR_ARM_LENGTH * 0.3, load),
    },
    wristTwist: MALLET_GRIP_ANGLE + shudder,
    propBehind: true,
    headTilt: deg(-10) * load,
    mouthOpen: 0.4 + 0.6 * load,
    eyeGlow: 0.5 + 0.5 * load,
  };
}

/** …and brings it down in a full overhead arc, then drags to a stop. */
const TERROR_SWING_IMPACT = 0.4;
/** Progress through the strike at which the mallet crosses in front of Terror. */
const SWING_OVERHEAD_END = 0.3;

function terrorSwingPose(progress: number): ClownPose {
  const rest = restingPose(terrorStyle(false));
  const swing = easeOut(clamp01(progress / TERROR_SWING_IMPACT));
  const recoil = easeInOut(clamp01((progress - TERROR_SWING_IMPACT) / (1 - TERROR_SWING_IMPACT)));

  const startX = -TERROR_ARM_LENGTH * 0.28;
  const startY = TERROR_SHOULDER_Y - TERROR_ARM_LENGTH * 0.72;
  const impactX = TERROR_ARM_LENGTH * 0.95;
  const impactY = TERROR_SHOULDER_Y + TERROR_ARM_LENGTH * 0.5;

  const handX = lerp(startX, impactX, swing) + (rest.nearHand.x - impactX) * recoil;
  const handY = lerp(startY, impactY, swing) + (rest.nearHand.y - impactY) * recoil;

  // The off hand counterweights the swing and then settles onto the resting
  // pose, so the last frame of the row lines up with idle and walk.
  const farStartX = -TERROR_ARM_LENGTH * 0.5;
  const farStartY = TERROR_SHOULDER_Y - TERROR_ARM_LENGTH * 0.3;
  const farEndX = TERROR_ARM_LENGTH * 0.45;
  const farEndY = TERROR_SHOULDER_Y + TERROR_ARM_LENGTH * 0.55;
  const farHandX = lerp(farStartX, farEndX, swing) + (rest.farHand.x - farEndX) * recoil;
  const farHandY = lerp(farStartY, farEndY, swing) + (rest.farHand.y - farEndY) * recoil;

  return {
    ...rest,
    lean: lerp(deg(-16), deg(24), swing) * (1 - recoil * 0.6),
    bob: lerp(-0.03, -0.08, swing) * (1 - recoil),
    sway: lerp(-0.08, 0.1, swing) * (1 - recoil * 0.7),
    torsoSquash: 1 - 0.06 * swing * (1 - recoil),
    nearFoot: { x: rest.nearFoot.x + 0.2 * swing * (1 - recoil), y: 0 },
    farFoot: { x: rest.farFoot.x - 0.2 * swing * (1 - recoil), y: 0 },
    nearHand: { x: handX, y: handY },
    farHand: { x: farHandX, y: farHandY },
    wristTwist: lerp(MALLET_GRIP_ANGLE, MALLET_SWING_WRIST_ANGLE, swing),
    // The mallet only comes round in front of the body once it is past vertical.
    propBehind: swing < SWING_OVERHEAD_END,
    headTilt: lerp(deg(-10), deg(14), swing) * (1 - recoil),
    headLead: 0.05 * swing * (1 - recoil),
    mouthOpen: 1 - recoil * 0.5,
    eyeGlow: 1 - recoil * 0.3,
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly pose: (frame: number) => ClownPose;
  readonly style: ClownStyle;
  readonly prop?: PropPainter;
}

interface SheetSpec {
  readonly key: string;
  readonly fileName: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Distance from the top of the frame down to the ground the clown stands on. */
  readonly groundY: number;
  readonly rows: readonly RowSpec[];
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const WALK_FRAMES = 8;
const IDLE_FRAMES = 6;
const FAT_SLAM_FRAMES = 10;
const STILT_WINDUP_FRAMES = 6;
const STILT_LUNGE_FRAMES = 8;
const TERROR_WINDUP_FRAMES = 8;
const TERROR_SWING_FRAMES = 8;

function terrorRows(enraged: boolean): readonly RowSpec[] {
  const style = terrorStyle(enraged);
  const prop = makeMalletPainter(style.palette);
  const suffix = enraged ? '_enraged' : '';
  return [
    {
      name: `walk${suffix}`,
      frameCount: WALK_FRAMES,
      style,
      prop,
      pose: (f) => walkPose(style, cyclePhase(f, WALK_FRAMES), TERROR_GAIT),
    },
    {
      name: `idle${suffix}`,
      frameCount: IDLE_FRAMES,
      style,
      prop,
      pose: (f) => idlePose(style, cyclePhase(f, IDLE_FRAMES), TERROR_IDLE),
    },
    {
      name: `windup${suffix}`,
      frameCount: TERROR_WINDUP_FRAMES,
      style,
      prop,
      pose: (f) => terrorWindupPose(shotProgress(f, TERROR_WINDUP_FRAMES)),
    },
    {
      name: `swing${suffix}`,
      frameCount: TERROR_SWING_FRAMES,
      style,
      prop,
      pose: (f) => terrorSwingPose(shotProgress(f, TERROR_SWING_FRAMES)),
    },
  ];
}

const SHEETS: readonly SheetSpec[] = [
  {
    key: 'fat_clown',
    fileName: 'fat_clown.png',
    frameWidth: 192,
    frameHeight: 160,
    groundY: 140,
    rows: [
      {
        name: 'walk',
        frameCount: WALK_FRAMES,
        style: FAT_STYLE,
        pose: (f) => walkPose(FAT_STYLE, cyclePhase(f, WALK_FRAMES), FAT_GAIT),
      },
      {
        name: 'idle',
        frameCount: IDLE_FRAMES,
        style: FAT_STYLE,
        pose: (f) => idlePose(FAT_STYLE, cyclePhase(f, IDLE_FRAMES), FAT_IDLE),
      },
      {
        name: 'slam',
        frameCount: FAT_SLAM_FRAMES,
        style: FAT_STYLE,
        pose: (f) => fatSlamPose(shotProgress(f, FAT_SLAM_FRAMES)),
      },
    ],
  },
  {
    key: 'stilt_clown',
    fileName: 'stilt_clown.png',
    frameWidth: 224,
    frameHeight: 224,
    groundY: 204,
    rows: [
      {
        name: 'walk',
        frameCount: WALK_FRAMES,
        style: STILT_STYLE,
        pose: (f) => walkPose(STILT_STYLE, cyclePhase(f, WALK_FRAMES), STILT_GAIT),
      },
      {
        name: 'idle',
        frameCount: IDLE_FRAMES,
        style: STILT_STYLE,
        pose: (f) => idlePose(STILT_STYLE, cyclePhase(f, IDLE_FRAMES), STILT_IDLE),
      },
      {
        name: 'windup',
        frameCount: STILT_WINDUP_FRAMES,
        style: STILT_STYLE,
        pose: (f) => stiltWindupPose(shotProgress(f, STILT_WINDUP_FRAMES)),
      },
      {
        name: 'lunge',
        frameCount: STILT_LUNGE_FRAMES,
        style: STILT_STYLE,
        pose: (f) => stiltLungePose(shotProgress(f, STILT_LUNGE_FRAMES)),
      },
    ],
  },
  {
    key: 'terror_clown',
    fileName: 'terror_clown.png',
    frameWidth: 256,
    frameHeight: 240,
    groundY: 214,
    rows: [...terrorRows(false), ...terrorRows(true)],
  },
];

function renderSheet(spec: SheetSpec): Buffer {
  const cols = Math.max(...spec.rows.map((row) => row.frameCount));
  const sheet = createCanvas(cols * spec.frameWidth, spec.rows.length * spec.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const frame = createCanvas(spec.frameWidth * SUPERSAMPLE, spec.frameHeight * SUPERSAMPLE);
  const frameCtx = frame.getContext('2d');
  const originX = (spec.frameWidth / 2) * SUPERSAMPLE;
  const originY = spec.groundY * SUPERSAMPLE;

  for (let row = 0; row < spec.rows.length; row++) {
    const rowSpec = spec.rows[row];
    for (let col = 0; col < rowSpec.frameCount; col++) {
      frameCtx.clearRect(0, 0, frame.width, frame.height);
      drawClown(
        frameCtx,
        originX,
        originY,
        TILE_SCALE * SUPERSAMPLE,
        rowSpec.style,
        rowSpec.pose(col),
        rowSpec.prop,
      );
      sheetCtx.drawImage(
        frame,
        0,
        0,
        frame.width,
        frame.height,
        col * spec.frameWidth,
        row * spec.frameHeight,
        spec.frameWidth,
        spec.frameHeight,
      );
    }
  }

  // These sheets are baked once offline, so the slowest zlib setting is free.
  return sheet.toBuffer('image/png', {
    compressionLevel: MAX_PNG_COMPRESSION,
  });
}

for (const spec of SHEETS) {
  const outPath = resolve(`src/images/enemies/${spec.fileName}`);
  writeFileSync(outPath, renderSheet(spec));

  const cols = Math.max(...spec.rows.map((row) => row.frameCount));
  const tileX = spec.frameWidth / 2 - TILE_SCALE / 2;
  const tileY = spec.groundY - TILE_SCALE;
  console.log(`${spec.key} → ${outPath}`);
  console.log(
    `  ${cols * spec.frameWidth}×${spec.rows.length * spec.frameHeight}px ` +
      `(${spec.rows.length} rows × ${cols} cols of ${spec.frameWidth}×${spec.frameHeight})`,
  );
  console.log(`  tileX=${tileX} tileY=${tileY} tileScale=${TILE_SCALE}`);
  spec.rows.forEach((row, i) => {
    console.log(`    row ${i}: ${row.name} (${row.frameCount} frames)`);
  });
}
