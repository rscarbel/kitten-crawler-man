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

export type ClubNpcVariant =
  | 'sledge'
  | 'bomo'
  | 'dj'
  | 'dancer'
  | 'patron'
  | 'bartender'
  | 'dealer'
  | 'merchant'
  | 'rosemarie'
  | 'vip';

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
  dealer: { skin: '#caa080', outfit: '#14322a', accent: '#e0c060', hair: '#1a1208' },
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
const PATRON_OUTFITS = [
  '#3a4a6a',
  '#5a3a2a',
  '#2a4a3a',
  '#4a2a4a',
  '#5a5a2a',
  '#3a3a4a',
  '#6a3a3a',
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

/** Deterministic index into a pool from a figure seed (salt separates independent choices). */
function pick<T>(pool: ReadonlyArray<T>, seed: number, salt: number): T {
  const h = Math.abs(Math.floor(seed) * 2654435761 + salt * 40503) % pool.length;
  return pool[h];
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

function poseFor(variant: ClubNpcVariant, phase: number, seed: number): Pose {
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
): void {
  ctx.save();
  const cx = sx + s * 0.5;
  if (facingX < 0) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  if (variant === 'sledge' || variant === 'bomo') {
    drawStoneGolem(ctx, cx, sy, s, variant, phase);
    ctx.restore();
    return;
  }

  const appearance =
    variant === 'dancer' || variant === 'patron'
      ? crowdAppearance(variant, seed)
      : FIXED_STYLES[variant];
  const skeleton = 'skeleton' in appearance && appearance.skeleton === true;
  drawHumanoid(ctx, cx, sy, s, appearance, poseFor(variant, phase, seed), skeleton);

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
): void {
  const bob = (Math.sin(phase * GOLEM_BOB_SPEED) + 1) * 0.5 * GOLEM_BOB_AMOUNT * s;
  const bsy = sy + bob;
  const accent = GOLEM_TUX_ACCENT[variant];

  // Blocky legs.
  ctx.fillStyle = GOLEM_STONE_DARK;
  ctx.fillRect(cx - s * 0.22, bsy + s * 0.78, s * 0.19, s * 0.2);
  ctx.fillRect(cx + s * 0.03, bsy + s * 0.78, s * 0.19, s * 0.2);

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
  ctx.fillRect(cx - s * 0.44, bsy + s * 0.44, s * 0.14, s * 0.3);
  ctx.fillRect(cx + s * 0.3, bsy + s * 0.44, s * 0.14, s * 0.3);
  // Stone fists.
  ctx.fillStyle = GOLEM_STONE_LIGHT;
  ctx.beginPath();
  ctx.arc(cx - s * 0.37, bsy + s * 0.76, s * 0.09, 0, TWO_PI);
  ctx.arc(cx + s * 0.37, bsy + s * 0.76, s * 0.09, 0, TWO_PI);
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
