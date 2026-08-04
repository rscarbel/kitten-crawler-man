#!/usr/bin/env tsx
/**
 * Generates the sprite sheets for the clowns on floor 3 — Grimaldi's Fat Clown,
 * Stilt Clown and Terror the Clown, plus the Evil Clown bounty target.
 *
 * Each clown is posed through the shared skeletal rig in `scripts/clownArt.ts`,
 * which solves knees and elbows from foot and hand targets. Gaits are therefore
 * authored as *where the foot goes*, which is what keeps a planted foot planted
 * and stops a limb from sliding off the body mid-swing.
 *
 * Grimaldi's three are drawn in profile facing +X and the runtime mirrors them.
 * The Evil Clown is three tiles tall, which a mirrored profile cannot carry
 * when he walks straight down the screen, so he is drawn in all three of the
 * rig's viewpoints and only his profile rows are mirrored.
 *
 * Sheet rows (see the matching entries in src/images/enemies/manifest.json):
 *   fat_clown     walk, idle, slam
 *   stilt_clown   walk, idle, windup, lunge
 *   terror_clown  walk, idle, windup, swing, then the same four enraged
 *   evil_clown    walk / idle / swipe / juggle_walk × toward, side, away,
 *                 plus a toward-only laugh and a gore row
 *
 * Run: npm run gen:clowns
 * Review: npx tsx scripts/render-clowns.ts --clown=evil
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx, type ImageData } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
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
  type ClownView,
  type Point,
  type PropPainter,
} from './clownArt';
import { EVIL_CLOWN_GORE_PIECES } from './clownGore';

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

// ── The Evil Clown ───────────────────────────────────────────────────────────

/**
 * The bounty target: a clown the size of a doorway, painted in bleached
 * greasepaint over a bruise-coloured suit, with the toxic yellow-green of his
 * own gas showing in his eyes and his pompoms.
 *
 * Nothing here is bright. Every colour a circus would use is present and
 * soured — the ruff is yellowed rather than white, the nose is scabbed rather
 * than pillar-box, the hair is a mossy green rather than orange. Read at 32 px
 * the figure is a pale head and a pale ruff floating over a dark column, which
 * is the silhouette the whole design is built around.
 */
const EVIL_PALETTE: ClownPalette = {
  suitLight: '#57653a',
  suitMid: '#2f2438',
  suitDark: '#1a1322',
  suitTrim: '#8a7a3f',
  suitFar: '#170f1e',
  limbSheen: 'rgba(206,226,176,0.12)',
  accent: '#b9d146',
  ruff: '#c2b596',
  ruffShade: '#726348',
  skin: '#cdbfa8',
  skinShade: '#9c8c74',
  paint: '#f2f0e6',
  paintShade: '#a9a698',
  paintMark: '#100c14',
  mouthFill: '#5a0e18',
  mouthDark: '#160308',
  teeth: '#d8cca4',
  hair: '#3a4a24',
  hairShade: '#22301a',
  shoe: '#3a2d34',
  shoeDark: '#171015',
  nose: '#6d1418',
  noseHighlight: '#a2413a',
  eyeCore: '#eaffc0',
  eyeGlow: 'rgba(150,220,60,0.85)',
  outline: '#0b070e',
};

/**
 * Roughly three tiles tall, and wrong at every joint: the arms are longer than
 * the legs, so the hands hang below the knee, and the head is a full third of
 * the torso's length. The narrow shoulders on a wide stance are what make him
 * read as stretched rather than merely large.
 */
const EVIL_PROPORTIONS: ClownProportions = {
  torsoLength: 0.86,
  shoulderHalfWidth: 0.34,
  hipHalfWidth: 0.28,
  bellyBulge: 0.06,
  neckLength: 0.32,
  headRadius: 0.42,
  headWidthFactor: 0.86,
  thighLength: 0.52,
  shinLength: 0.54,
  upperArmLength: 0.55,
  forearmLength: 0.58,
  legWidth: 0.15,
  armWidth: 0.13,
  handRadius: 0.13,
  shoeLength: 0.62,
  shoeHeight: 0.18,
};

const EVIL_STYLE: ClownStyle = {
  palette: EVIL_PALETTE,
  proportions: EVIL_PROPORTIONS,
  hair: 'lank',
  mouth: 'rictus',
  facePaint: 'sockets',
  pattern: 'harlequin',
  feet: 'shoes',
  hat: 'none',
  ruffRadius: 0.24,
  ruffRise: 0.8,
  pompomCount: 4,
  // A small scabbed nose and big burning eyes on a face whose grin sits low:
  // the default clown layout puts a bright ball in the middle of the mouth and
  // hides the eyes, which reads as a party mask rather than as a predator.
  face: { eyeScale: 0.92, noseScale: 0.48, mouthDrop: 0.14 },
};

const EVIL_ARM_LENGTH = EVIL_PROPORTIONS.upperArmLength + EVIL_PROPORTIONS.forearmLength;
const EVIL_SHOULDER_Y = -shoulderHeight(EVIL_STYLE.proportions);

/** Long, slow, over-reaching strides — he covers ground without hurrying. */
const EVIL_GAIT: GaitConfig = {
  stride: 0.3,
  lift: 0.13,
  bob: 0.055,
  sway: 0.03,
  leanBase: deg(5),
  leanSwing: deg(2),
  armSwing: 0.16,
};

/**
 * Walking at the camera, the stride is almost invisible and the lift is
 * everything, so the feet are picked up higher and placed narrower than the
 * profile gait would put them.
 */
const EVIL_FRONTAL_GAIT: GaitConfig = {
  stride: 0.1,
  lift: 0.19,
  bob: 0.06,
  sway: 0.05,
  leanBase: 0,
  leanSwing: deg(1.5),
  armSwing: 0.09,
};

const EVIL_IDLE: IdleConfig = {
  breathDepth: 0.035,
  bob: 0.03,
  sway: 0.018,
  headRoll: deg(6),
  mouthPulse: 0.15,
};

/**
 * A head-on walk cannot borrow the profile arm swing: swinging a hand along +X
 * from a front view walks it sideways across the body instead of forward past
 * the hip. Here the hands rise and fall in counter-phase instead, and the whole
 * pelvis rocks, which is what a walk toward the camera actually shows.
 */
function frontalWalkPose(style: ClownStyle, phase: number, config: GaitConfig): ClownPose {
  const rest = restingPose(style);
  const swingAngle = phase * FULL_CYCLE;
  const armPhase = Math.sin(swingAngle);

  return {
    ...rest,
    bob: -config.bob * (0.5 - 0.5 * Math.cos(swingAngle * BOB_PER_CYCLE)),
    sway: config.sway * Math.sin(swingAngle),
    lean: config.leanBase + config.leanSwing * Math.sin(swingAngle * BOB_PER_CYCLE),
    nearFoot: frontalFootTarget(phase, config, rest.nearFoot.x),
    farFoot: frontalFootTarget(phase + 0.5, config, rest.farFoot.x),
    nearHand: {
      x: rest.nearHand.x + armPhase * config.armSwing * 0.35,
      y: rest.nearHand.y - armPhase * config.armSwing,
    },
    farHand: {
      x: rest.farHand.x - armPhase * config.armSwing * 0.35,
      y: rest.farHand.y + armPhase * config.armSwing,
    },
    headTilt: -armPhase * deg(2),
  };
}

/** Head-on footfall: mostly a lift, with a small in-and-out shuffle around it. */
function frontalFootTarget(phase: number, config: GaitConfig, restX: number): Point {
  const wrapped = phase - Math.floor(phase);
  if (wrapped < CONTACT_FRACTION) return { x: restX, y: 0 };
  const swing = (wrapped - CONTACT_FRACTION) / (1 - CONTACT_FRACTION);
  return {
    x: restX + Math.sin(swing * Math.PI) * config.stride,
    y: -config.lift * Math.sin(swing * Math.PI),
  };
}

/** Swipe beats: the arm is dragged back, thrown across, then hangs. */
const SWIPE_WINDUP_END = 0.42;
const SWIPE_STRIKE_END = 0.66;

/**
 * A backhand, not a punch: the whole arm is hauled across the body and flung
 * out again at the end of its own length, which is the only attack that reads
 * on a figure whose hands hang below its knees.
 */
function evilSwipePose(progress: number): ClownPose {
  const rest = restingPose(EVIL_STYLE);
  const windup = clamp01(progress / SWIPE_WINDUP_END);
  const strike = clamp01((progress - SWIPE_WINDUP_END) / (SWIPE_STRIKE_END - SWIPE_WINDUP_END));
  const recover = clamp01((progress - SWIPE_STRIKE_END) / (1 - SWIPE_STRIKE_END));

  const cock = easeInOut(windup) * (1 - easeOut(strike));
  const throwOut = easeOut(strike) * (1 - easeInOut(recover));

  const REACH_ACROSS = 0.55;
  const REACH_OUT = 1.15;
  const STRIKE_HEIGHT = 0.42;

  return {
    ...rest,
    lean: deg(-12) * cock + deg(22) * throwOut,
    bob: 0.03 * cock - 0.02 * throwOut,
    sway: -0.07 * cock + 0.1 * throwOut,
    torsoSquash: 1 + 0.03 * cock,
    nearFoot: { x: rest.nearFoot.x + 0.16 * throwOut, y: 0 },
    farFoot: { x: rest.farFoot.x - 0.12 * cock, y: 0 },
    nearHand: {
      x: lerp(rest.nearHand.x, -EVIL_ARM_LENGTH * REACH_ACROSS, cock) +
        EVIL_ARM_LENGTH * REACH_OUT * throwOut,
      y: lerp(rest.nearHand.y, EVIL_SHOULDER_Y + EVIL_ARM_LENGTH * 0.2, cock) -
        EVIL_ARM_LENGTH * STRIKE_HEIGHT * throwOut,
    },
    farHand: {
      x: rest.farHand.x - 0.12 * cock + 0.18 * throwOut,
      y: rest.farHand.y - EVIL_ARM_LENGTH * 0.12 * throwOut,
    },
    headTilt: deg(-7) * cock + deg(12) * throwOut,
    headLead: 0.07 * throwOut,
    mouthOpen: Math.max(cock * 0.4, throwOut),
    eyeGlow: 0.5 + 0.5 * Math.max(cock, throwOut),
  };
}

/**
 * The same beat seen head-on. The reach is lateral rather than forward, and the
 * lean becomes a lunge toward or away from the camera — which the rig renders
 * as foreshortening, so the pose only has to say how far he leans.
 */
function evilFrontalSwipePose(progress: number): ClownPose {
  const rest = restingPose(EVIL_STYLE);
  const windup = clamp01(progress / SWIPE_WINDUP_END);
  const strike = clamp01((progress - SWIPE_WINDUP_END) / (SWIPE_STRIKE_END - SWIPE_WINDUP_END));
  const recover = clamp01((progress - SWIPE_STRIKE_END) / (1 - SWIPE_STRIKE_END));

  const cock = easeInOut(windup) * (1 - easeOut(strike));
  const throwOut = easeOut(strike) * (1 - easeInOut(recover));

  const ACROSS_BODY = 0.35;
  const SWEEP_OUT = 0.95;

  return {
    ...rest,
    lean: deg(-10) * cock + deg(18) * throwOut,
    bob: 0.03 * cock - 0.03 * throwOut,
    sway: -0.05 * cock + 0.06 * throwOut,
    nearFoot: { x: rest.nearFoot.x + 0.1 * throwOut, y: 0 },
    farFoot: { x: rest.farFoot.x - 0.1 * cock, y: 0 },
    nearHand: {
      x: lerp(rest.nearHand.x, -EVIL_ARM_LENGTH * ACROSS_BODY, cock) +
        EVIL_ARM_LENGTH * SWEEP_OUT * throwOut,
      y: lerp(rest.nearHand.y, EVIL_SHOULDER_Y + EVIL_ARM_LENGTH * 0.3, cock) -
        EVIL_ARM_LENGTH * 0.25 * throwOut,
    },
    farHand: {
      x: rest.farHand.x + 0.06 * cock - 0.14 * throwOut,
      y: rest.farHand.y - EVIL_ARM_LENGTH * 0.1 * throwOut,
    },
    headTilt: deg(6) * cock - deg(9) * throwOut,
    headLead: 0.05 * throwOut,
    mouthOpen: Math.max(cock * 0.4, throwOut),
    eyeGlow: 0.5 + 0.5 * Math.max(cock, throwOut),
  };
}

/**
 * The laugh: the tell that the juggling is coming. Head thrown back, shoulders
 * heaving twice, arms slack at his sides. It has to be legible from across a
 * field, so the whole spine goes with it rather than just the jaw.
 */
const LAUGH_HEAVES = 2;
/** Fraction of the laugh spent throwing the head back, and later righting it. */
const LAUGH_RISE_END = 0.25;
const LAUGH_FALL_START = 0.75;

function evilLaughPose(progress: number): ClownPose {
  const rest = restingPose(EVIL_STYLE);
  const rise = easeInOut(clamp01(progress / LAUGH_RISE_END));
  const fall = easeInOut(clamp01((progress - LAUGH_FALL_START) / (1 - LAUGH_FALL_START)));
  const held = rise * (1 - fall);
  const heave = Math.sin(progress * FULL_CYCLE * LAUGH_HEAVES);

  return {
    ...rest,
    // Head-on rows render a lean as foreshortening, so tipping backwards reads
    // as the head sinking into the shoulders — exactly the shape wanted here.
    lean: deg(-26) * held,
    bob: (-0.04 + 0.03 * heave) * held,
    torsoSquash: 1 + (0.06 + 0.04 * heave) * held,
    nearHand: {
      x: rest.nearHand.x + 0.1 * held,
      y: rest.nearHand.y + 0.05 * heave * held,
    },
    farHand: {
      x: rest.farHand.x - 0.1 * held,
      y: rest.farHand.y - 0.05 * heave * held,
    },
    headTilt: deg(4) * heave * held,
    headLead: -0.06 * held,
    mouthOpen: held * (0.7 + 0.3 * heave),
    eyeGlow: 0.4 + 0.6 * held,
  };
}

/**
 * The juggling walk: an unhurried meander with both hands up at chest height,
 * catching and tossing. The vials themselves are painted by
 * {@link makeJugglePainter} — they are part of the pose, not a projectile.
 */
function evilJugglePose(style: ClownStyle, phase: number, headOn: boolean): ClownPose {
  const base = headOn
    ? frontalWalkPose(style, phase, EVIL_FRONTAL_GAIT)
    : walkPose(style, phase, EVIL_GAIT);
  const catchPhase = Math.sin(phase * FULL_CYCLE * JUGGLE_TOSSES_PER_STRIDE);
  const handY = EVIL_SHOULDER_Y + EVIL_ARM_LENGTH * JUGGLE_HAND_DROP;
  const handX = EVIL_PROPORTIONS.shoulderHalfWidth * JUGGLE_HAND_SPREAD;

  return {
    ...base,
    nearHand: { x: handX, y: handY - JUGGLE_HAND_TRAVEL * catchPhase },
    farHand: { x: -handX, y: handY + JUGGLE_HAND_TRAVEL * catchPhase },
    headTilt: deg(3) * catchPhase,
    mouthOpen: 0.45,
    eyeGlow: 0.9,
  };
}

/** Tosses per stride — the hands work faster than the feet do. */
const JUGGLE_TOSSES_PER_STRIDE = 3;
/** Where the hands hold, down the arm's length from the shoulder. */
const JUGGLE_HAND_DROP = 0.55;
const JUGGLE_HAND_SPREAD = 1.9;
const JUGGLE_HAND_TRAVEL = 0.07;

// ── The juggled vials ────────────────────────────────────────────────────────

const VIAL_COUNT = 3;
const VIAL_BODY_HALF_WIDTH = 0.1;
const VIAL_BODY_HEIGHT = 0.3;
const VIAL_NECK_HALF_WIDTH = 0.034;
const VIAL_NECK_HEIGHT = 0.08;
const VIAL_GLASS = 'rgba(180,205,190,0.72)';
/** The vials cross the clown's own white face; without an outline they vanish. */
const VIAL_OUTLINE = '#0b070e';
const VIAL_OUTLINE_WIDTH = 0.022;
const VIAL_GLASS_RIM = 'rgba(232,245,232,0.85)';
const VIAL_GAS = '#9fbe33';
const VIAL_GAS_LIGHT = '#d7e86a';
const VIAL_CORK = '#6b4d2c';

/** One stoppered vial, drawn upright about its own centre. */
function paintVial(ctx: Ctx): void {
  const halfW = VIAL_BODY_HALF_WIDTH;
  const bodyTop = -VIAL_BODY_HEIGHT * 0.5;
  const bodyBottom = VIAL_BODY_HEIGHT * 0.5;

  ctx.beginPath();
  ctx.moveTo(-halfW, bodyTop);
  ctx.lineTo(halfW, bodyTop);
  ctx.quadraticCurveTo(halfW * 1.15, bodyBottom, 0, bodyBottom);
  ctx.quadraticCurveTo(-halfW * 1.15, bodyBottom, -halfW, bodyTop);
  ctx.closePath();
  ctx.fillStyle = VIAL_GLASS;
  ctx.fill();
  ctx.strokeStyle = VIAL_OUTLINE;
  ctx.lineWidth = VIAL_OUTLINE_WIDTH;
  ctx.stroke();

  // The contents sit in the bottom two-thirds, so the vial reads as full of
  // something rather than as a lump of glass.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = VIAL_GAS;
  ctx.fillRect(-halfW, bodyTop + VIAL_BODY_HEIGHT * 0.3, halfW * 2, VIAL_BODY_HEIGHT);
  ctx.fillStyle = VIAL_GAS_LIGHT;
  ctx.fillRect(-halfW, bodyTop + VIAL_BODY_HEIGHT * 0.3, halfW * 0.55, VIAL_BODY_HEIGHT);
  ctx.restore();

  ctx.fillStyle = VIAL_GLASS_RIM;
  ctx.fillRect(-VIAL_NECK_HALF_WIDTH, bodyTop - VIAL_NECK_HEIGHT, VIAL_NECK_HALF_WIDTH * 2, VIAL_NECK_HEIGHT);
  ctx.fillStyle = VIAL_CORK;
  ctx.fillRect(
    -VIAL_NECK_HALF_WIDTH * 1.4,
    bodyTop - VIAL_NECK_HEIGHT * 1.6,
    VIAL_NECK_HALF_WIDTH * 2.8,
    VIAL_NECK_HEIGHT * 0.7,
  );
}

/** Half the width of the cascade the vials travel through. */
const CASCADE_HALF_WIDTH = 0.5;
/**
 * Peak height of the cascade above the hands. A juggler's pattern crests level
 * with the top of the head; anything shorter keeps the vials down among the
 * arms, where the figure's own limbs hide the one thing the row exists to show.
 */
const CASCADE_APEX = 2.25;
const VIAL_SPIN_TURNS = 1.5;

/**
 * The three vials in the air above the clown's hands, at a given point in the
 * cascade. Ignores the hand it is handed: the cascade is anchored on the body's
 * centre line, which is what keeps the pattern steady while the hands work.
 */
function makeJugglePainter(phase: number): PropPainter {
  const handY = EVIL_SHOULDER_Y + EVIL_ARM_LENGTH * JUGGLE_HAND_DROP;
  return (ctx: Ctx): void => {
    for (let i = 0; i < VIAL_COUNT; i++) {
      const t = (phase + i / VIAL_COUNT) % 1;
      const x = lerp(-CASCADE_HALF_WIDTH, CASCADE_HALF_WIDTH, t);
      const y = handY - CASCADE_APEX * Math.sin(t * Math.PI);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * FULL_CYCLE * VIAL_SPIN_TURNS);
      paintVial(ctx);
      ctx.restore();
    }
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  /**
   * The pose for each frame, or null on a gore row — whose cells are severed
   * pieces rather than poses of a whole figure.
   */
  readonly pose: ((frame: number) => ClownPose) | null;
  /** Severed-piece painters, one per column. Present only on a gore row. */
  readonly pieces?: ReadonlyArray<(ctx: Ctx, style: ClownStyle) => void>;
  /**
   * Manifest state name per gore column. Carried so {@link gateManifest} can
   * check the pieces against the sheet's `colOffset` states — without it the
   * gore order is a convention nothing enforces.
   */
  readonly pieceStates?: ReadonlyArray<string>;
  readonly style: ClownStyle;
  readonly prop?: PropPainter;
  /** Per-frame prop, for rows whose prop moves independently of the hands. */
  readonly propFor?: (frame: number) => PropPainter;
  readonly view?: ClownView;
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
const EVIL_SWIPE_FRAMES = 8;
const EVIL_LAUGH_FRAMES = 10;
const EVIL_JUGGLE_FRAMES = 8;

/**
 * The Evil Clown's rows, three views apiece.
 *
 * Only the profile rows are mirrored at runtime; the head-on rows are drawn
 * once and used for both headings, which is why the toward and away walks are
 * authored from {@link frontalWalkPose} rather than being the profile walk
 * turned sideways.
 */
function evilRows(): readonly RowSpec[] {
  const style = EVIL_STYLE;
  const views: ReadonlyArray<{ suffix: string; view: ClownView }> = [
    { suffix: '', view: 'toward' },
    { suffix: '_side', view: 'profile' },
    { suffix: '_away', view: 'away' },
  ];
  const rows: RowSpec[] = [];

  for (const { suffix, view } of views) {
    const headOn = view !== 'profile';
    rows.push({
      name: `walk${suffix}`,
      frameCount: WALK_FRAMES,
      style,
      view,
      pose: (f) =>
        headOn
          ? frontalWalkPose(style, cyclePhase(f, WALK_FRAMES), EVIL_FRONTAL_GAIT)
          : walkPose(style, cyclePhase(f, WALK_FRAMES), EVIL_GAIT),
    });
  }
  for (const { suffix, view } of views) {
    rows.push({
      name: `idle${suffix}`,
      frameCount: IDLE_FRAMES,
      style,
      view,
      pose: (f) => idlePose(style, cyclePhase(f, IDLE_FRAMES), EVIL_IDLE),
    });
  }
  for (const { suffix, view } of views) {
    const headOn = view !== 'profile';
    rows.push({
      name: `swipe${suffix}`,
      frameCount: EVIL_SWIPE_FRAMES,
      style,
      view,
      pose: (f) =>
        headOn
          ? evilFrontalSwipePose(shotProgress(f, EVIL_SWIPE_FRAMES))
          : evilSwipePose(shotProgress(f, EVIL_SWIPE_FRAMES)),
    });
  }
  rows.push({
    name: 'laugh',
    frameCount: EVIL_LAUGH_FRAMES,
    style,
    view: 'toward',
    pose: (f) => evilLaughPose(shotProgress(f, EVIL_LAUGH_FRAMES)),
  });
  for (const { suffix, view } of views) {
    const headOn = view !== 'profile';
    rows.push({
      name: `juggle_walk${suffix}`,
      frameCount: EVIL_JUGGLE_FRAMES,
      style,
      view,
      pose: (f) => evilJugglePose(style, cyclePhase(f, EVIL_JUGGLE_FRAMES), headOn),
      propFor: (f) => makeJugglePainter(cyclePhase(f, EVIL_JUGGLE_FRAMES)),
    });
  }
  rows.push({
    name: 'gore',
    frameCount: EVIL_CLOWN_GORE_PIECES.length,
    style,
    pose: null,
    pieces: EVIL_CLOWN_GORE_PIECES.map((piece) => piece.paint),
    pieceStates: EVIL_CLOWN_GORE_PIECES.map((piece) => piece.name),
  });
  return rows;
}

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
  {
    key: 'evil_clown',
    fileName: 'evil_clown.png',
    frameWidth: 272,
    frameHeight: 296,
    groundY: 268,
    rows: evilRows(),
  },
];

interface BakedSheet {
  readonly buffer: Buffer;
  readonly pixels: ImageData;
}

function renderSheet(spec: SheetSpec): BakedSheet {
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
      const piece = rowSpec.pieces?.[col];
      if (piece !== undefined) {
        frameCtx.save();
        // Gore cells anchor on the middle of the cell rather than on the ground
        // line: a tumbling piece has no feet and no floor to stand on.
        frameCtx.translate((spec.frameWidth / 2) * SUPERSAMPLE, (spec.frameHeight / 2) * SUPERSAMPLE);
        frameCtx.scale(TILE_SCALE * SUPERSAMPLE, TILE_SCALE * SUPERSAMPLE);
        piece(frameCtx, rowSpec.style);
        frameCtx.restore();
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
        continue;
      }
      const pose = rowSpec.pose;
      if (pose === null) {
        throw new Error(`row "${rowSpec.name}" has neither a pose function nor a piece painter`);
      }
      drawClown(
        frameCtx,
        originX,
        originY,
        TILE_SCALE * SUPERSAMPLE,
        rowSpec.style,
        pose(col),
        rowSpec.propFor?.(col) ?? rowSpec.prop,
        rowSpec.view,
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
  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    pixels: sheetCtx.getImageData(0, 0, sheet.width, sheet.height),
  };
}

/**
 * Alpha a frame's outermost pixels may carry before the bake is rejected.
 *
 * Anything above this means the figure ran into the cell wall and was cut along
 * a straight line — permanently, in the PNG. A clipped shoe or a clipped
 * juggled vial is invisible in a code review and obvious in the game.
 */
const MAX_EDGE_ALPHA = 6;

function gateEdgeBleed(spec: SheetSpec, pixels: ImageData): void {
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET];

  for (let row = 0; row < spec.rows.length; row++) {
    for (let col = 0; col < spec.rows[row].frameCount; col++) {
      const left = col * spec.frameWidth;
      const right = left + spec.frameWidth - 1;
      const top = row * spec.frameHeight;
      const bottom = top + spec.frameHeight - 1;
      let worst = 0;
      for (let x = left; x <= right; x++) worst = Math.max(worst, alphaAt(x, top), alphaAt(x, bottom));
      for (let y = top; y <= bottom; y++) worst = Math.max(worst, alphaAt(left, y), alphaAt(right, y));
      if (worst > MAX_EDGE_ALPHA) {
        throw new Error(
          `${spec.key} row "${spec.rows[row].name}" frame ${col} paints its own border at alpha ` +
            `${worst}; the figure is clipped by the frame. Grow the cell or shrink the pose.`,
        );
      }
    }
  }
}

const MANIFEST_PATH = 'src/images/enemies/manifest.json';

interface ManifestState {
  readonly row: number;
  readonly frameCount: number;
  readonly colOffset?: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestState>;
}

/**
 * The manifest entry this bake requires.
 *
 * A gore row is many one-frame states sharing a row by column, so it expands to
 * one state per piece rather than to a single row entry.
 */
function manifestEntryFor(spec: SheetSpec): ManifestEntry {
  const states: Record<string, ManifestState> = {};
  spec.rows.forEach((row, index) => {
    if (row.pieceStates === undefined) {
      states[row.name] = { row: index, frameCount: row.frameCount };
      return;
    }
    row.pieceStates.forEach((state, colOffset) => {
      states[state] = { row: index, colOffset, frameCount: 1 };
    });
  });
  return {
    path: `enemies/${spec.fileName}`,
    frameWidth: spec.frameWidth,
    frameHeight: spec.frameHeight,
    tileX: spec.frameWidth / 2 - TILE_SCALE / 2,
    tileY: spec.groundY - TILE_SCALE,
    tileScale: TILE_SCALE,
    states,
  };
}

/** Key order in JSON carries no meaning, so compare on a sorted stringify. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

/**
 * A sheet whose manifest entry does not describe it renders as garbage — the
 * runtime slices rectangles that are no longer there. The manifest is checked
 * rather than rewritten because `src/images/enemies/manifest.json` also holds
 * every other creature's entry, and a programmatic rewrite of a shared file
 * clobbers other agents' edits.
 */
function gateManifest(specs: readonly SheetSpec[]): boolean {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const stale: string[] = [];
  for (const spec of specs) {
    const required = manifestEntryFor(spec);
    if (canonicalJson(manifest[spec.key]) !== canonicalJson(required)) {
      stale.push(`"${spec.key}": ${JSON.stringify(required, null, 2)}`);
    }
  }
  if (stale.length === 0) {
    console.log(`manifest: ${MANIFEST_PATH} is in sync`);
    return true;
  }
  console.error(
    `\n${MANIFEST_PATH} is out of sync with the bake. Set these entries:\n${stale.join(',\n')}\n`,
  );
  process.exitCode = 1;
  return false;
}

// Gated before anything reaches disk, for the same reason the edge-bleed gate
// is: a sheet the manifest no longer describes must not be the one sitting in
// src/images when the run reports a failure.
const manifestInSync = gateManifest(SHEETS);

for (const spec of SHEETS) {
  if (!manifestInSync) break;
  const outPath = resolve(`src/images/enemies/${spec.fileName}`);
  const { buffer, pixels } = renderSheet(spec);
  // Gated before anything reaches disk: a sheet that fails must not be the one
  // sitting in src/images when the run ends.
  gateEdgeBleed(spec, pixels);
  writeFileSync(outPath, buffer);

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
