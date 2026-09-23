/**
 * Canvas-drawn figures for the Desperado Club's cosmetic NPCs and station staff.
 *
 * Every non-stone figure shares one pose-driven humanoid renderer so limbs can
 * actually swing, step, and sway — this is what sells the dancing. Appearance
 * (skin, outfit, hair) for the crowd figures (dancers/patrons) is derived from a
 * stable per-figure `seed` so a floor full of people reads as a varied crowd
 * rather than clones. The Cretins — the club's tuxedoed rock-monster bodyguards
 * — are painted figures of their own (`cretinSprite.ts`) rather than the
 * humanoid.
 */

import { drawCretinSprite, type CretinVariant } from './cretinSprite';
import { CRETIN_WALK_FRAMES } from './cretinTiming';
import { scaleHumanoidBox } from './humanoidScale';

/** The club NPCs who are Cretins, drawn from the Cretin figure. */
type ClubCretin = Extract<CretinVariant, 'sledge' | 'bomo' | 'clayton' | 'very_sullen'>;

export type ClubNpcVariant =
  ClubCretin | 'dj' | 'dancer' | 'patron' | 'bartender' | 'merchant' | 'vip';

interface Appearance {
  skin: string;
  outfit: string;
  accent: string;
  hair: string;
}

interface FixedStyle extends Appearance {
  skeleton?: boolean;
}

/** Fixed-look figures (named staff + the skeleton DJ). Crowd figures are seeded instead. */
const FIXED_STYLES: Record<
  Exclude<ClubNpcVariant, ClubCretin | 'dancer' | 'patron'>,
  FixedStyle
> = {
  dj: { skin: '#e8e6de', outfit: '#2a1a3a', accent: '#e0407a', hair: '#e8e6de', skeleton: true },
  bartender: { skin: '#c89068', outfit: '#3a1f14', accent: '#e4d8b0', hair: '#241812' },
  merchant: { skin: '#b88858', outfit: '#4a2a5a', accent: '#e0b040', hair: '#3a2410' },
  vip: { skin: '#d0a070', outfit: '#1a1a3a', accent: '#c8a840', hair: '#2a1c10' },
};

// Crowd variety pools — sampled deterministically by seed so each figure keeps a stable look.
const SKIN_TONES = [
  '#f0c9a0',
  '#e8b98f',
  '#d8a878',
  '#c68a52',
  '#a56b3a',
  '#8a5a2c',
  '#6f4522',
] as const;
const DANCER_OUTFITS = [
  '#d0307a',
  '#3a9be0',
  '#e0a020',
  '#28c070',
  '#a040e0',
  '#e04848',
  '#20c0c0',
  '#e070b0',
] as const;
// Club-night wear: mostly dark tailoring, with enough colour in the mix that a
// crowd doesn't read as a queue of identical suits.
const PATRON_OUTFITS = [
  '#3a4a6a',
  '#5a3a2a',
  '#2a4a3a',
  '#4a2a4a',
  '#5a5a2a',
  '#3a3a4a',
  '#6a3a3a',
  '#1f2733',
  '#7a4a1c',
  '#2f5a6a',
  '#6a2a52',
  '#46523a',
] as const;
const HAIR_COLORS = [
  '#150d06',
  '#3a2410',
  '#0a0a0a',
  '#6a4020',
  '#c8a850',
  '#e8e4dc',
  '#7a2a2a',
] as const;
const ACCENT_COLORS = ['#40d0e0', '#f0d060', '#ff5aa0', '#8affc0', '#c090ff'] as const;

// Avalanche constants from the MurmurHash3 finaliser — chosen because each one
// spreads a single changed input bit across the whole word.
const HASH_SALT_MIX = 0x9e3779b1;
const HASH_MIX_A = 0x85ebca6b;
const HASH_MIX_B = 0xc2b2ae35;
const HASH_SHIFT_A = 13;
const HASH_SHIFT_B = 16;

/**
 * Deterministic index into a pool from a figure seed (salt separates independent
 * choices).
 *
 * The seed is avalanched rather than scaled and taken modulo directly: callers
 * hand out seeds on a fixed stride, and any stride sharing a factor with a pool's
 * length collapses that pool to a single entry for the whole crowd. That is not
 * hypothetical — a stride of 7 against the seven-entry skin, hair and outfit
 * pools is what made every club patron identical.
 */
function pick<T>(pool: ReadonlyArray<T>, seed: number, salt: number): T {
  let h = Math.floor(seed) ^ Math.imul(salt + 1, HASH_SALT_MIX);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_A), HASH_MIX_A);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_B), HASH_MIX_B);
  h ^= h >>> HASH_SHIFT_B;
  return pool[Math.abs(h) % pool.length];
}

function crowdAppearance(variant: 'dancer' | 'patron', seed: number): Appearance {
  const outfits = variant === 'dancer' ? DANCER_OUTFITS : PATRON_OUTFITS;
  return {
    skin: pick(SKIN_TONES, seed, 1),
    outfit: pick(outfits, seed, 2),
    accent: pick(ACCENT_COLORS, seed, 3),
    hair: pick(HAIR_COLORS, seed, 4),
  };
}

const TWO_PI = Math.PI * 2;

/** A single frame of limb placement, all offsets as fractions of the figure size `s`. */
interface Pose {
  bounce: number;
  hipShift: number;
  lean: number;
  leftArmRaise: number;
  rightArmRaise: number;
  leftArmOut: number;
  rightArmOut: number;
  leftLegLift: number;
  rightLegLift: number;
  headTilt: number;
}

const IDLE_POSE: Pose = {
  bounce: 0,
  hipShift: 0,
  lean: 0,
  leftArmRaise: 0,
  rightArmRaise: 0,
  leftArmOut: 0.5,
  rightArmOut: 0.5,
  leftLegLift: 0,
  rightLegLift: 0,
  headTilt: 0,
};

// Idle motion for standing figures (staff, resting patrons).
const IDLE_BOB_SPEED = 0.05;
const IDLE_BOB_AMOUNT = 0.012;

// Dance motion.
const DANCE_BASE_SPEED = 0.14;

/** One of four looping dance routines, chosen per dancer by seed so the floor looks choreographed-but-varied. */
function danceStyle(styleId: number, t: number): Pose {
  const beat = Math.sin(t);
  const offBeat = Math.sin(t + Math.PI);
  switch (styleId % 4) {
    // Hands-in-the-air sway.
    case 0:
      return {
        bounce: Math.abs(Math.sin(t)) * 0.06,
        hipShift: Math.sin(t) * 0.06,
        lean: Math.sin(t) * 0.05,
        leftArmRaise: 0.75 + beat * 0.2,
        rightArmRaise: 0.75 + offBeat * 0.2,
        leftArmOut: 0.7,
        rightArmOut: 0.7,
        leftLegLift: 0,
        rightLegLift: 0,
        headTilt: Math.sin(t) * 0.04,
      };
    // Side-stepping shuffle.
    case 1:
      return {
        bounce: Math.abs(Math.sin(t * 2)) * 0.04,
        hipShift: Math.sin(t) * 0.09,
        lean: Math.sin(t) * 0.03,
        leftArmRaise: 0.2 + beat * 0.35,
        rightArmRaise: 0.2 + offBeat * 0.35,
        leftArmOut: 0.55 + beat * 0.2,
        rightArmOut: 0.55 + offBeat * 0.2,
        leftLegLift: Math.max(0, beat) * 0.12,
        rightLegLift: Math.max(0, offBeat) * 0.12,
        headTilt: 0,
      };
    // Bouncing jump.
    case 2: {
      const jump = Math.max(0, Math.sin(t));
      return {
        bounce: jump * 0.12,
        hipShift: Math.sin(t * 0.5) * 0.03,
        lean: 0,
        leftArmRaise: 0.4 + jump * 0.5,
        rightArmRaise: 0.4 + jump * 0.5,
        leftArmOut: 0.5,
        rightArmOut: 0.5,
        leftLegLift: jump * 0.1,
        rightLegLift: jump * 0.1,
        headTilt: 0,
      };
    }
    // Twisting hip-roll.
    default:
      return {
        bounce: Math.abs(Math.sin(t * 2)) * 0.03,
        hipShift: Math.sin(t) * 0.08,
        lean: Math.sin(t + Math.PI / 2) * 0.06,
        leftArmRaise: 0.5 + Math.sin(t + Math.PI / 2) * 0.3,
        rightArmRaise: 0.5 - Math.sin(t + Math.PI / 2) * 0.3,
        leftArmOut: 0.8,
        rightArmOut: 0.8,
        leftLegLift: 0,
        rightLegLift: 0,
        headTilt: Math.sin(t) * 0.06,
      };
  }
}

function idlePose(phase: number): Pose {
  return { ...IDLE_POSE, bounce: (Math.sin(phase * IDLE_BOB_SPEED) + 1) * 0.5 * IDLE_BOB_AMOUNT };
}

/** DJ leans over the decks, both hands low and working, head nodding. */
function djPose(phase: number): Pose {
  const t = phase * 0.12;
  return {
    ...IDLE_POSE,
    bounce: Math.abs(Math.sin(t)) * 0.03,
    leftArmRaise: -0.2 + Math.sin(t) * 0.2,
    rightArmRaise: -0.2 + Math.sin(t + Math.PI) * 0.2,
    leftArmOut: 0.85,
    rightArmOut: 0.85,
    headTilt: Math.sin(t) * 0.05,
  };
}

// Walk and strike motion — used by wandering patrons and by hired mercenaries,
// who are club figures fighting in the field rather than standing at a station.
const WALK_CYCLE_SPEED = 0.22;
const WALK_STRIDE = 0.5;
const WALK_ARM_SWING = 0.3;
const WALK_BOUNCE = 0.02;
/** Fraction of the strike spent winding up; the rest is the swing through. */
const STRIKE_WINDUP_FRACTION = 0.35;

/** A plain two-beat stride: legs alternate, arms counter-swing, torso bobs on each step. */
function walkPose(phase: number): Pose {
  const t = phase * WALK_CYCLE_SPEED;
  const stride = Math.sin(t);
  return {
    ...IDLE_POSE,
    bounce: Math.abs(Math.sin(t * 2)) * WALK_BOUNCE,
    hipShift: stride * 0.02,
    lean: 0.01,
    leftArmRaise: -stride * WALK_ARM_SWING,
    rightArmRaise: stride * WALK_ARM_SWING,
    leftArmOut: 0.42,
    rightArmOut: 0.42,
    leftLegLift: Math.max(0, stride) * WALK_STRIDE,
    rightLegLift: Math.max(0, -stride) * WALK_STRIDE,
    headTilt: 0,
  };
}

/**
 * A committed overhand strike: the lead arm cocks back and over, then drives
 * down and forward past the body while the figure leans into it.
 */
function strikePose(progress: number): Pose {
  const windingUp = progress < STRIKE_WINDUP_FRACTION;
  const swing = windingUp
    ? progress / STRIKE_WINDUP_FRACTION
    : 1 - (progress - STRIKE_WINDUP_FRACTION) / (1 - STRIKE_WINDUP_FRACTION);
  const followThrough = windingUp ? 0 : 1 - swing;
  return {
    ...IDLE_POSE,
    bounce: 0.01,
    hipShift: -0.02 + followThrough * 0.05,
    lean: -0.03 + followThrough * 0.11,
    leftArmRaise: -0.1,
    rightArmRaise: swing * 1.15 - followThrough * 0.55,
    leftArmOut: 0.35,
    rightArmOut: 0.55 + followThrough * 0.75,
    leftLegLift: 0,
    rightLegLift: followThrough * 0.16,
    headTilt: followThrough * 0.03,
  };
}

/** Optional motion overrides for figures that do more than stand at a station. */
export interface ClubNpcMotion {
  /** Play the stride cycle instead of the figure's resting animation. */
  walking?: boolean;
  /** 0→1 through a strike. Overrides `walking`; omit or pass null when not attacking. */
  attack?: number | null;
}

function poseFor(
  variant: ClubNpcVariant,
  phase: number,
  seed: number,
  motion: ClubNpcMotion | undefined,
): Pose {
  if (motion?.attack !== undefined && motion.attack !== null) return strikePose(motion.attack);
  if (motion?.walking === true) return walkPose(phase);
  if (variant === 'dancer') return danceStyle(seed, phase * DANCE_BASE_SPEED + seed);
  if (variant === 'dj') return djPose(phase);
  if (variant === 'patron') {
    // Resting patrons sway gently in place; a subset (by seed) bob a little more.
    const lively = seed % 3 === 0;
    return danceStyleLite(phase * (lively ? 0.08 : 0.05) + seed, lively);
  }
  return idlePose(phase);
}

/** A calmer sway for patrons watching the floor. */
function danceStyleLite(t: number, lively: boolean): Pose {
  const amp = lively ? 0.05 : 0.025;
  return {
    ...IDLE_POSE,
    bounce: Math.abs(Math.sin(t)) * amp,
    hipShift: Math.sin(t) * amp,
    leftArmRaise: 0.05,
    rightArmRaise: 0.05,
    leftArmOut: 0.5,
    rightArmOut: 0.5,
    headTilt: Math.sin(t) * 0.02,
  };
}

/** The club's animation clock ticks once per 60 Hz frame; figures timed in seconds divide by this. */
export const CLUB_ANIM_FRAMES_PER_SECOND = 60;

/**
 * Draws a club NPC standing at (sx, sy) sized to `s` pixels. `phase` advances
 * the animation clock; `seed` is a stable per-figure integer that fixes crowd
 * appearance and dance routine. `facingX < 0` mirrors horizontally.
 */
export function drawClubNpc(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  variant: ClubNpcVariant,
  phase: number,
  facingX = 1,
  seed = 0,
  motion?: ClubNpcMotion,
): void {
  if (isClubCretin(variant)) {
    drawClubCretin(ctx, sx, sy, s, variant, phase, facingX, motion);
    return;
  }
  ctx.save();
  const box = scaleHumanoidBox(sx, sy, s);
  sx = box.sx;
  sy = box.sy;
  s = box.s;
  const cx = sx + s * 0.5;
  if (facingX < 0) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  const appearance =
    variant === 'dancer' || variant === 'patron'
      ? crowdAppearance(variant, seed)
      : FIXED_STYLES[variant];
  const skeleton = 'skeleton' in appearance && appearance.skeleton === true;
  drawHumanoid(ctx, cx, sy, s, appearance, poseFor(variant, phase, seed, motion), skeleton);

  ctx.restore();
}

/** Pose-driven humanoid: torso + swinging arms + stepping legs + head. Reads as motion because every limb tracks the pose. */
function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  sy: number,
  s: number,
  look: Appearance,
  pose: Pose,
  skeleton: boolean,
): void {
  const bsy = sy - pose.bounce * s;
  const hipX = cx + pose.hipShift * s;
  const shoulderCX = cx + (pose.hipShift + pose.lean) * s;

  const hipY = bsy + s * 0.62;
  const shoulderY = bsy + s * 0.4;
  const legLen = s * 0.24;
  const legW = s * 0.12;

  // Legs — the lifted leg bends up and inward for a stepping read.
  const drawLeg = (dir: number, lift: number): void => {
    const footX = hipX + dir * s * 0.09;
    const topY = hipY;
    const footY = hipY + legLen - lift * s * 0.14;
    ctx.strokeStyle = '#141018';
    ctx.lineWidth = legW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(footX, topY);
    ctx.lineTo(footX + dir * lift * s * 0.05, footY);
    ctx.stroke();
  };
  drawLeg(-1, pose.leftLegLift);
  drawLeg(1, pose.rightLegLift);

  const torsoW = s * 0.32;
  const torsoTopX = shoulderCX - torsoW / 2;
  ctx.fillStyle = look.outfit;
  ctx.beginPath();
  ctx.moveTo(torsoTopX, shoulderY);
  ctx.lineTo(torsoTopX + torsoW, shoulderY);
  ctx.lineTo(hipX + torsoW * 0.42, hipY);
  ctx.lineTo(hipX - torsoW * 0.42, hipY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = look.accent;
  ctx.fillRect(shoulderCX - s * 0.02, shoulderY, s * 0.04, hipY - shoulderY);

  const armLen = s * 0.28;
  const drawArm = (dir: number, raise: number, out: number): void => {
    const shX = shoulderCX + dir * torsoW * 0.5;
    const handX = shX + dir * armLen * out;
    const handY = shoulderY + armLen * (0.9 - raise * 1.7);
    ctx.strokeStyle = look.outfit;
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shX, shoulderY + s * 0.02);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = skeleton ? '#e8e6de' : look.skin;
    ctx.beginPath();
    ctx.arc(handX, handY, s * 0.055, 0, TWO_PI);
    ctx.fill();
  };
  drawArm(-1, pose.leftArmRaise, pose.leftArmOut);
  drawArm(1, pose.rightArmRaise, pose.rightArmOut);

  const headCX = shoulderCX + pose.headTilt * s;
  const headCY = bsy + s * 0.26;
  const headR = s * 0.13;
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.arc(headCX, headCY - s * 0.02, headR * 1.12, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(headCX, headCY + s * 0.02, headR, 0, TWO_PI);
  ctx.fill();

  if (skeleton) {
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(headCX - s * 0.05, headCY, s * 0.035, 0, TWO_PI);
    ctx.arc(headCX + s * 0.05, headCY, s * 0.035, 0, TWO_PI);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1a0e04';
    ctx.fillRect(headCX - s * 0.07, headCY - s * 0.01, s * 0.03, s * 0.035);
    ctx.fillRect(headCX + s * 0.04, headCY - s * 0.01, s * 0.03, s * 0.035);
  }
}

// ── Cretins ──────────────────────────────────────────────────────────────

const CLUB_CRETINS: readonly ClubCretin[] = ['sledge', 'bomo', 'clayton', 'very_sullen'];

function isClubCretin(variant: ClubNpcVariant): variant is ClubCretin {
  return CLUB_CRETINS.some((cretin) => cretin === variant);
}

/**
 * Gait advance per tick for a club Cretin on the move: one sheet frame a tick.
 * The club has no distance covered to pace the stride by, and one frame a tick
 * is the most a row can play before it is undersampled into a vibration.
 */
const CLUB_CRETIN_WALK_RADIANS_PER_TICK = TWO_PI / CRETIN_WALK_FRAMES;

/**
 * A club Cretin at its tile: facing the room while it stands, and seen in
 * profile, heading the way it faces, while it walks. It is drawn at its own
 * size — two tiles of rock in a tux — rather than through the humanoid box.
 */
function drawClubCretin(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  variant: ClubCretin,
  phase: number,
  facingX: number,
  motion: ClubNpcMotion | undefined,
): void {
  const walking = motion?.walking === true;
  drawCretinSprite(ctx, sx, sy, s, {
    variant,
    row: walking ? 'walk' : 'idle',
    facingX: walking ? facingX : 0,
    facingY: walking ? 0 : 1,
    walkPhase: phase * CLUB_CRETIN_WALK_RADIANS_PER_TICK,
    ticks: phase,
  });
}
