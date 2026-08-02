/**
 * Canvas-drawn figures for the Desperado Club's cosmetic NPCs and station staff.
 *
 * Every non-stone figure shares one pose-driven humanoid renderer so limbs can
 * actually swing, step, and sway — this is what sells the dancing. Appearance
 * (skin, outfit, hair) for the crowd figures (dancers/patrons) is derived from a
 * stable per-figure `seed` so a floor full of people reads as a varied crowd
 * rather than clones. The Cretin bouncers (Sledge/Bomo) render as cracked stone
 * golems in tuxedos instead of the humanoid.
 */

import { scaleHumanoidBox } from './humanoidScale';

export type ClubNpcVariant =
  'sledge' | 'bomo' | 'dj' | 'dancer' | 'patron' | 'bartender' | 'merchant' | 'rosemarie' | 'vip';

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
  Exclude<ClubNpcVariant, 'sledge' | 'bomo' | 'dancer' | 'patron'>,
  FixedStyle
> = {
  dj: { skin: '#e8e6de', outfit: '#2a1a3a', accent: '#e0407a', hair: '#e8e6de', skeleton: true },
  bartender: { skin: '#c89068', outfit: '#3a1f14', accent: '#e4d8b0', hair: '#241812' },
  merchant: { skin: '#b88858', outfit: '#4a2a5a', accent: '#e0b040', hair: '#3a2410' },
  rosemarie: { skin: '#d8b088', outfit: '#5a2a2a', accent: '#e0a040', hair: '#6a2820' },
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

  if (variant === 'sledge' || variant === 'bomo') {
    drawStoneGolem(ctx, cx, sy, s, variant, phase, motion);
    ctx.restore();
    return;
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

  // Torso.
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

  // Accent trim down the front.
  ctx.fillStyle = look.accent;
  ctx.fillRect(shoulderCX - s * 0.02, shoulderY, s * 0.04, hipY - shoulderY);

  // Arms — swing from the shoulders, hand at the end.
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

  // Head.
  const headCX = shoulderCX + pose.headTilt * s;
  const headCY = bsy + s * 0.26;
  const headR = s * 0.13;
  // Hair backing.
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

// ── Stone golem bouncers ──────────────────────────────────────────────────

const GOLEM_STONE_BASE = '#6a6f78';
const GOLEM_STONE_LIGHT = '#868c96';
const GOLEM_STONE_DARK = '#3f434b';
const GOLEM_CRACK = '#26282e';
const GOLEM_EYE = '#ffc23a';
const GOLEM_EYE_GLOW = '#ffb000';
const GOLEM_TUX_ACCENT: Record<'sledge' | 'bomo', string> = {
  sledge: '#c8a840',
  bomo: '#b8863c',
};
const GOLEM_TUX = '#15151b';
const GOLEM_BOB_SPEED = 0.045;
const GOLEM_BOB_AMOUNT = 0.01;
/** A slab of granite plods: a slower cycle and a heavier heave than a person's. */
const GOLEM_WALK_SPEED = 0.18;
const GOLEM_STOMP_LIFT = 0.05;
const GOLEM_WALK_HEAVE = 0.02;
/** How far the leading fist travels forward through a swing, as a fraction of the figure. */
const GOLEM_SWING_REACH = 0.26;

/**
 * A broad, cracked-granite bruiser in a tuxedo — angular boulder shoulders, a
 * blocky rubble body, glowing eyes, and gold tuxedo trim. Deliberately not the
 * smooth humanoid so it reads as living rock, not a grey man.
 */
function drawStoneGolem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  sy: number,
  s: number,
  variant: 'sledge' | 'bomo',
  phase: number,
  motion?: ClubNpcMotion,
): void {
  const striking = motion?.attack !== undefined && motion.attack !== null;
  const walking = !striking && motion?.walking === true;
  const stride = walking ? Math.sin(phase * GOLEM_WALK_SPEED) : 0;
  const heave = walking ? Math.abs(Math.sin(phase * GOLEM_WALK_SPEED * 2)) * GOLEM_WALK_HEAVE : 0;
  // A strike is a wind-up followed by the arm being thrown across the body.
  const swing = striking ? Math.sin((motion.attack ?? 0) * Math.PI) : 0;

  const bob = (Math.sin(phase * GOLEM_BOB_SPEED) + 1) * 0.5 * GOLEM_BOB_AMOUNT * s;
  const bsy = sy + bob - heave * s;
  const accent = GOLEM_TUX_ACCENT[variant];

  // Blocky legs — a stomping stride raises one slab at a time.
  ctx.fillStyle = GOLEM_STONE_DARK;
  const leftLift = Math.max(0, stride) * GOLEM_STOMP_LIFT * s;
  const rightLift = Math.max(0, -stride) * GOLEM_STOMP_LIFT * s;
  ctx.fillRect(cx - s * 0.22, bsy + s * 0.78 - leftLift, s * 0.19, s * 0.2);
  ctx.fillRect(cx + s * 0.03, bsy + s * 0.78 - rightLift, s * 0.19, s * 0.2);

  // Rubble torso — an irregular stone slab.
  const torso = new Path2D();
  torso.moveTo(cx - s * 0.34, bsy + s * 0.4);
  torso.lineTo(cx - s * 0.28, bsy + s * 0.34);
  torso.lineTo(cx + s * 0.28, bsy + s * 0.34);
  torso.lineTo(cx + s * 0.34, bsy + s * 0.42);
  torso.lineTo(cx + s * 0.3, bsy + s * 0.82);
  torso.lineTo(cx - s * 0.3, bsy + s * 0.82);
  torso.closePath();
  ctx.fillStyle = GOLEM_STONE_BASE;
  ctx.fill(torso);

  // Tuxedo over the stone — dark jacket panels with a gold-trimmed lapel V.
  ctx.fillStyle = GOLEM_TUX;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, bsy + s * 0.36);
  ctx.lineTo(cx, bsy + s * 0.52);
  ctx.lineTo(cx - s * 0.26, bsy + s * 0.8);
  ctx.lineTo(cx - s * 0.3, bsy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.28, bsy + s * 0.36);
  ctx.lineTo(cx, bsy + s * 0.52);
  ctx.lineTo(cx + s * 0.26, bsy + s * 0.8);
  ctx.lineTo(cx + s * 0.3, bsy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  // Shirt strip + gold lapel edges + bow tie.
  ctx.fillStyle = '#d8d4c8';
  ctx.fillRect(cx - s * 0.05, bsy + s * 0.4, s * 0.1, s * 0.34);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, bsy + s * 0.36);
  ctx.lineTo(cx, bsy + s * 0.52);
  ctx.lineTo(cx + s * 0.28, bsy + s * 0.36);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.08, bsy + s * 0.4);
  ctx.lineTo(cx, bsy + s * 0.44);
  ctx.lineTo(cx - s * 0.08, bsy + s * 0.48);
  ctx.moveTo(cx + s * 0.08, bsy + s * 0.4);
  ctx.lineTo(cx, bsy + s * 0.44);
  ctx.lineTo(cx + s * 0.08, bsy + s * 0.48);
  ctx.fill();

  // Boulder shoulders + blocky arms flanking the jacket.
  ctx.fillStyle = GOLEM_STONE_LIGHT;
  ctx.beginPath();
  ctx.arc(cx - s * 0.34, bsy + s * 0.42, s * 0.12, 0, TWO_PI);
  ctx.arc(cx + s * 0.34, bsy + s * 0.42, s * 0.12, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = GOLEM_STONE_BASE;
  // The right arm is the one that swings; a stride counter-swings both.
  const armSwing = stride * GOLEM_SWING_REACH * 0.35 * s;
  const strikeReach = swing * GOLEM_SWING_REACH * s;
  ctx.fillRect(cx - s * 0.44 - armSwing, bsy + s * 0.44, s * 0.14, s * 0.3);
  ctx.fillRect(
    cx + s * 0.3 + armSwing + strikeReach,
    bsy + s * 0.44 - strikeReach * 0.6,
    s * 0.14,
    s * 0.3,
  );
  // Stone fists.
  ctx.fillStyle = GOLEM_STONE_LIGHT;
  ctx.beginPath();
  ctx.arc(cx - s * 0.37 - armSwing, bsy + s * 0.76, s * 0.09, 0, TWO_PI);
  ctx.arc(
    cx + s * 0.37 + armSwing + strikeReach,
    bsy + s * 0.76 - strikeReach * 0.6,
    s * 0.11,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Craggy head — a rough boulder with a chip knocked off the top-right.
  ctx.fillStyle = GOLEM_STONE_LIGHT;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.16, bsy + s * 0.24);
  ctx.lineTo(cx - s * 0.14, bsy + s * 0.06);
  ctx.lineTo(cx + s * 0.05, bsy + s * 0.02);
  ctx.lineTo(cx + s * 0.17, bsy + s * 0.12);
  ctx.lineTo(cx + s * 0.15, bsy + s * 0.26);
  ctx.lineTo(cx - s * 0.05, bsy + s * 0.32);
  ctx.closePath();
  ctx.fill();

  // Cracks + facet shading across body and head.
  ctx.strokeStyle = GOLEM_CRACK;
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, bsy + s * 0.5);
  ctx.lineTo(cx - s * 0.08, bsy + s * 0.62);
  ctx.moveTo(cx + s * 0.22, bsy + s * 0.56);
  ctx.lineTo(cx + s * 0.12, bsy + s * 0.7);
  ctx.moveTo(cx - s * 0.1, bsy + s * 0.14);
  ctx.lineTo(cx - s * 0.02, bsy + s * 0.2);
  ctx.stroke();

  // Glowing eyes — the clearest "this is alive" tell.
  ctx.save();
  ctx.shadowColor = GOLEM_EYE_GLOW;
  ctx.shadowBlur = s * 0.12;
  ctx.fillStyle = GOLEM_EYE;
  ctx.fillRect(cx - s * 0.1, bsy + s * 0.13, s * 0.06, s * 0.035);
  ctx.fillRect(cx + s * 0.03, bsy + s * 0.12, s * 0.06, s * 0.035);
  ctx.restore();
}
