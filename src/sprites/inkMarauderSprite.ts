/**
 * Tsarina Signet's summons — tattoos torn off her skin and given a body.
 *
 * They are drawn as glowing blue line-work rather than solid creatures: a thin
 * translucent wash inside a bright contour, so they read as ink standing up off
 * the skin. Both forms tower over a tile-sized crawler.
 */

/** Frames of the coalescing swirl before the summon has full form. */
export const INK_EMERGE_FRAMES = 30;

/** Frames a caller should take to ease `InkMarauderPose.swimBlend` in or out. */
export const INK_SWIM_EASE_FRAMES = 12;

/** Which tattoo came to life. */
export type InkMarauderForm = 'ogre' | 'shark';

/**
 * Point in the strike animation where the scimitar bottoms out and the shark's
 * jaws are at full gape — the frame a caller should land its damage on, so the
 * hit reads as the swing connecting.
 */
export const INK_STRIKE_LAND_FRACTION = 0.6;

export interface InkMarauderPose {
  form: InkMarauderForm;
  /** Frames since summoning — drives the emerge swirl, idle bob and gait. */
  age: number;
  /** 1 at spawn, falling toward 0 as the summon bleeds back into ink. */
  lifeFraction: number;
  /** 0 when idle, sweeping 0→1 across a sword chop or a shark lunge. */
  attackProgress: number;
  /** Horizontal facing; negative mirrors the figure. */
  facingX: number;
  walkFrame: number;
  isMoving: boolean;
  /**
   * 0 hovering, 1 swimming hard — the shark's gait cue. Eased by the caller over
   * `INK_SWIM_EASE_FRAMES` because a raw `isMoving` flip would step the tail
   * amplitude and body pitch in a single frame, and mobs start and stop
   * constantly.
   */
  swimBlend: number;
}

/* ── Shared ink palette ────────────────────────────────────────────────── */

const INK_CONTOUR = '#7fd6ff';
const INK_DETAIL = '#4aa6e8';
/**
 * Barely-there interior tint. These are tattoos standing up off skin, not
 * bodies, so the contour carries the whole form. Note that it is far too sheer
 * to hide anything behind it: overlapping line-work shows through, which is
 * what makes them read as ink rather than as flesh.
 */
const INK_WASH = 'rgba(96, 176, 255, 0.09)';
const INK_GLOW = '#3fa9ff';
/**
 * Kept tight on purpose: a wide blur on a shape only a tile or two across
 * floods its own interior and the figure stops reading as an outline.
 */
const GLOW_BLUR_FRACTION = 0.09;

const CONTOUR_WIDTH = 0.035;
const DETAIL_WIDTH = 0.022;
const DETAIL_ALPHA = 0.75;

/**
 * Both figures are laid out in tile units about a ground point at the bottom
 * centre of the summon's tile, y climbing negative upward, so every number below
 * reads as "tiles above the floor" / "tiles out from the spine".
 */
const TILE_CENTER_X = 0.5;
const GROUND_ANCHOR_Y = 1;

/** Idle sway, shared by both forms. */
const BOB_AMPLITUDE = 0.045;
const BOB_SPEED = 0.045;

/** Coalescing swirl during the emerge animation. */
const SWIRL_ARM_COUNT = 5;
const SWIRL_MAX_RADIUS = 1.5;
const SWIRL_SPEED = 0.3;
const SWIRL_ARM_SWEEP = Math.PI * 0.6;
const SWIRL_ARM_SPACING = 0.12;
const SWIRL_CENTER_Y = -1.3;
const EMERGE_MIN_SCALE = 0.05;

/** Ink wisps bleeding off the summon as it fades. */
const WISP_COUNT = 5;
const WISP_RISE = 1.2;
const WISP_RADIUS = 0.06;
const WISP_SPEED = 0.02;
const WISP_DRIFT = 0.35;
const WISP_DRIFT_SPEED = 0.1;
const WISP_PHASE_SPREAD = 2;
const WISP_BASE_Y = -1.2;

/* ── Three-headed ogre ─────────────────────────────────────────────────── */

const GROUND_Y = 0;
const OGRE_FOOT_HEIGHT = 0.14;
const OGRE_ANKLE_Y = GROUND_Y - OGRE_FOOT_HEIGHT;
const OGRE_KNEE_Y = -0.52;
const OGRE_HIP_Y = -1.02;
const OGRE_LEG_X = 0.32;
const OGRE_THIGH_HALF_WIDTH = 0.19;
const OGRE_CALF_HALF_WIDTH = 0.14;
const OGRE_FOOT_FORWARD = 0.24;
const OGRE_KNEE_STRIDE_FRACTION = 0.5;

const OGRE_HIP_HALF_WIDTH = OGRE_LEG_X + OGRE_THIGH_HALF_WIDTH;
const OGRE_WAIST_Y = -1.4;
const OGRE_WAIST_HALF_WIDTH = 0.54;
const OGRE_CHEST_Y = -1.82;
const OGRE_CHEST_HALF_WIDTH = 0.9;
const OGRE_STERNUM_LINE_HALF_WIDTH = 0.3;
/** Top plane of the shoulders, where all three necks root. */
const OGRE_SHOULDER_Y = -2.06;
const OGRE_SHOULDER_HALF_WIDTH = 0.6;
const OGRE_ARM_JOINT_Y = -1.9;

const OGRE_MIDDLE_HEAD_Y = -2.52;
const OGRE_MIDDLE_HEAD_RX = 0.28;
const OGRE_MIDDLE_HEAD_RY = 0.31;
const OGRE_SIDE_HEAD_X = 0.58;
const OGRE_SIDE_HEAD_Y = -2.3;
const OGRE_SIDE_HEAD_RX = 0.23;
const OGRE_SIDE_HEAD_RY = 0.26;
/** Outward lean of the two flanking heads, in radians. */
const OGRE_SIDE_HEAD_TILT = 0.4;
const OGRE_NECK_HALF_WIDTH = 0.1;

const OGRE_EYE_INSET = 0.09;
const OGRE_EYE_Y_FRACTION = -0.2;
const OGRE_EYE_RADIUS = 0.045;
const OGRE_JAW_Y_FRACTION = 0.45;
const OGRE_JAW_HALF_WIDTH_FRACTION = 0.62;
const OGRE_TUSK_ROOT_X = 0.08;
const OGRE_TUSK_LENGTH = 0.13;
const OGRE_TUSK_FLARE = 0.04;

const OGRE_SHOULDER_JOINT_X = 0.8;
const OGRE_ARM_HALF_WIDTH = 0.17;
const OGRE_SWORD_ELBOW = { x: 1.12, y: -1.52 } as const;
const OGRE_SWORD_HAND = { x: 1.3, y: -2.06 } as const;
const OGRE_IDLE_ELBOW = { x: -1.02, y: -1.46 } as const;
const OGRE_IDLE_HAND = { x: -1.06, y: -0.9 } as const;
const OGRE_FIST_RADIUS = 0.15;

/** The scimitar, measured from the grip: pommel down, blade arcing up and forward. */
const OGRE_POMMEL_LENGTH = 0.3;
const OGRE_GUARD_HALF_WIDTH = 0.22;
const OGRE_BLADE_LENGTH = 1.55;
/** How far the cutting edge bows forward of the straight hilt-to-tip line. */
const OGRE_BLADE_CURVE = 0.55;
const OGRE_BLADE_SPINE_WIDTH = 0.13;
const OGRE_BLADE_CURVE_MIDPOINT = 0.5;
/** Rest angle of the raised blade, radians clockwise from straight up. */
const OGRE_BLADE_REST_ANGLE = -0.5;
/** Where the chop ends — blade swung through to roughly horizontal, out front. */
const OGRE_BLADE_CHOP_ANGLE = 1.9;
/** The wind-up pulls back past rest before the blade comes down. */
const OGRE_BLADE_WINDUP_ANGLE = -0.95;
const OGRE_WINDUP_END_FRACTION = 0.3;

const OGRE_STRIDE_LENGTH = 0.24;
/** How high the leading foot lifts at full stride. */
const OGRE_STRIDE_LIFT = 0.1;
const OGRE_BREATH_AMPLITUDE = 0.03;
const OGRE_BREATH_SPEED = 0.06;

/* ── Hammerhead shark ─────────────────────────────────────────────────── */

/** The shark never touches the floor — it swims through the air at this height. */
const SHARK_SPINE_Y = -1.35;
const SHARK_NOSE_X = 0.94;
const SHARK_TAIL_ROOT_X = -1.05;
const SHARK_BACK_RISE = 0.4;
const SHARK_BELLY_DROP = 0.36;
const SHARK_BACK_APEX_X = 0.1;
const SHARK_BELLY_APEX_X = 0.25;
const SHARK_TAIL_ROOT_RISE = 0.2;
const SHARK_TAIL_ROOT_DROP = 0.18;

/**
 * The cephalofoil is seen obliquely, so the hammer reads as a bar laid across
 * the snout: a thin span with a bulging lobe on each end, an eye in each lobe.
 * Without the lobes it reads as a paddle rather than as a hammerhead.
 */
const SHARK_FOIL_X = 1.02;
/** Half-thickness of the span between the lobes; narrower than them, or the
 * silhouette degenerates into a plain capsule and the hammer stops reading. */
const SHARK_FOIL_RX = 0.15;
const SHARK_FOIL_RY = 0.56;
const SHARK_FOIL_LOBE_RADIUS = 0.19;
const SHARK_FOIL_LOBE_CENTER_Y = SHARK_FOIL_RY - SHARK_FOIL_LOBE_RADIUS;
const SHARK_EYE_RADIUS = 0.085;

/**
 * How far along the belly curve the jaw sits, as the curve's own parameter, so
 * the mouth lands *on* the silhouette instead of floating in air beside it.
 * Chosen to keep the jaw behind the hammer's trailing edge — slid forward it runs
 * through the lower lobe and its own eye.
 */
const SHARK_JAW_ALONG_BELLY = 0.8;
const SHARK_MOUTH_HALF_WIDTH = 0.16;
/** How far the jaw drops open at the peak of a lunge, in tiles. */
const SHARK_JAW_OPEN = 0.22;
const SHARK_TOOTH_COUNT = 4;
const SHARK_TOOTH_LENGTH = 0.09;
/** Teeth sit at the centre of their slot rather than on the slot boundary. */
const TOOTH_PITCH_MIDPOINT = 0.5;

const SHARK_DORSAL_ROOT_FRONT_X = 0.24;
const SHARK_DORSAL_ROOT_BACK_X = -0.34;
const SHARK_DORSAL_ROOT_Y = -0.26;
const SHARK_DORSAL_TIP = { x: 0, y: -0.88 } as const;
const SHARK_PECTORAL_ROOT_FRONT_X = 0.5;
const SHARK_PECTORAL_ROOT_BACK_X = 0.14;
const SHARK_PECTORAL_ROOT_Y = 0.24;
const SHARK_PECTORAL_TIP = { x: 0.28, y: 0.66 } as const;

const SHARK_GILL_COUNT = 5;
const SHARK_GILL_FRONT_X = 0.42;
const SHARK_GILL_SPACING = 0.11;
const SHARK_GILL_HALF_HEIGHT = 0.18;
const SHARK_GILL_BOW = 0.05;

const SHARK_PEDUNCLE_X = -1.42;
const SHARK_TAIL_UPPER_TIP = { x: -2.02, y: -0.68 } as const;
const SHARK_TAIL_LOWER_TIP = { x: -1.82, y: 0.44 } as const;
const SHARK_TAIL_NOTCH = { x: -1.62, y: -0.02 } as const;
const SHARK_TAIL_SWEEP_ANGLE = 0.34;
/**
 * Driving off `age` rather than the walk cycle keeps the beat continuous when the
 * shark starts and stops; only the amplitude and the nose-down pitch change, and
 * those ride the caller's eased `swimBlend`.
 */
const SHARK_TAIL_SWEEP_ANGLE_SWIMMING = 0.52;
const SHARK_TAIL_SWEEP_SPEED = 0.14;
const SHARK_SWIM_PITCH = 0.07;

const SHARK_SWIM_ROLL = 0.05;
const SHARK_SWIM_ROLL_SPEED = 0.07;
/** Forward surge at the peak of a lunge, in tiles. */
const SHARK_LUNGE_REACH = 0.4;
/** Sine phase the lunge peaks at — a quarter turn in, where sin() is 1. */
const LUNGE_ARC_PEAK_PHASE = 0.5;

/** `Mob.renderDamageFlash` outlines exactly one tile. */
const FLASH_HEIGHT_TILES = 1;

type Ctx = CanvasRenderingContext2D;

function setContourStyle(ctx: Ctx): void {
  ctx.strokeStyle = INK_CONTOUR;
  ctx.lineWidth = CONTOUR_WIDTH;
  ctx.fillStyle = INK_WASH;
}

/**
 * Run `draw` in the dimmer interior-detail style. The alpha is *multiplied* into
 * whatever the caller already set, so details keep fading with the summon as it
 * emerges and bleeds away rather than snapping to full strength.
 */
function withDetailStyle(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.strokeStyle = INK_DETAIL;
  ctx.lineWidth = DETAIL_WIDTH;
  ctx.globalAlpha *= DETAIL_ALPHA;
  draw();
  ctx.restore();
}

/**
 * Wash the interior, then trace the contour — the outline is what carries the
 * form. The glow is suspended for the fill: a shadow cast by a filled path is
 * an opaque silhouette of that path, which would show straight through the
 * near-transparent wash and turn every figure into a solid blue slab.
 */
function fillAndStroke(ctx: Ctx): void {
  const glowBlur = ctx.shadowBlur;
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.shadowBlur = glowBlur;
  ctx.stroke();
}

/** One axis of a quadratic Bézier at `t`, for hanging detail off a curve. */
function quadraticAt(start: number, control: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}

function strokeEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  fillAndStroke(ctx);
}

/**
 * Draw one of Signet's summons. `sx`/`sy` are the top-left of the summon's own
 * tile; the figure is drawn standing on that tile but reaching well past it on
 * every axis — see `INK_MARAUDER_HEAD_CLEARANCE` / `INK_MARAUDER_HALF_WIDTH`.
 */
export function drawInkMarauderSprite(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  pose: InkMarauderPose,
): void {
  const { form, age, lifeFraction, attackProgress, facingX, walkFrame, isMoving, swimBlend } = pose;
  const emerging = age < INK_EMERGE_FRAMES;
  // Floored: at a literal zero the figure's transform is non-invertible and its
  // alpha collapses, so the first frame of the emerge would be a dead frame.
  const formProgress = emerging ? Math.max(EMERGE_MIN_SCALE, age / INK_EMERGE_FRAMES) : 1;
  const bob = Math.sin(age * BOB_SPEED) * BOB_AMPLITUDE;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, lifeFraction));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = INK_GLOW;
  ctx.shadowBlur = s * GLOW_BLUR_FRACTION;

  ctx.translate(sx + s * TILE_CENTER_X, sy + s * GROUND_ANCHOR_Y);
  ctx.scale(s, s);

  if (emerging) drawEmergeSwirl(ctx, age, formProgress);

  ctx.save();
  ctx.scale(formProgress, formProgress);
  ctx.globalAlpha *= formProgress;
  ctx.translate(0, bob);
  if (facingX < 0) ctx.scale(-1, 1);

  if (form === 'ogre') {
    drawThreeHeadedOgre(ctx, age, attackProgress, walkFrame, isMoving);
  } else {
    drawHammerheadShark(ctx, age, attackProgress, swimBlend);
  }
  ctx.restore();

  if (lifeFraction < 1) drawFadeWisps(ctx, age, lifeFraction);

  ctx.restore();
}

function drawEmergeSwirl(ctx: Ctx, age: number, formProgress: number): void {
  ctx.save();
  ctx.strokeStyle = INK_CONTOUR;
  ctx.lineWidth = CONTOUR_WIDTH;
  const radius = SWIRL_MAX_RADIUS * (1 - formProgress);
  for (let i = 0; i < SWIRL_ARM_COUNT; i++) {
    const startAngle = age * SWIRL_SPEED + (i / SWIRL_ARM_COUNT) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      0,
      SWIRL_CENTER_Y,
      radius + i * SWIRL_ARM_SPACING,
      startAngle,
      startAngle + SWIRL_ARM_SWEEP,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawFadeWisps(ctx: Ctx, age: number, lifeFraction: number): void {
  ctx.save();
  ctx.fillStyle = INK_CONTOUR;
  for (let i = 0; i < WISP_COUNT; i++) {
    const riseProgress = ((age * WISP_SPEED + i / WISP_COUNT) % 1) * (1 - lifeFraction);
    ctx.globalAlpha = Math.max(0, lifeFraction * (1 - riseProgress));
    ctx.beginPath();
    ctx.arc(
      Math.sin(age * WISP_DRIFT_SPEED + i * WISP_PHASE_SPREAD) * WISP_DRIFT,
      WISP_BASE_Y - riseProgress * WISP_RISE,
      WISP_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

/* ── Ogre ──────────────────────────────────────────────────────────────── */

function drawOgreLeg(ctx: Ctx, hipX: number, stride: number): void {
  const ankleX = hipX + stride;
  const kneeX = hipX + stride * OGRE_KNEE_STRIDE_FRACTION;
  const strideLift = Math.max(0, stride / OGRE_STRIDE_LENGTH) * OGRE_STRIDE_LIFT;
  const ankleY = OGRE_ANKLE_Y - strideLift;
  const soleY = GROUND_Y - strideLift;

  ctx.beginPath();
  ctx.moveTo(hipX - OGRE_THIGH_HALF_WIDTH, OGRE_HIP_Y);
  ctx.lineTo(kneeX - OGRE_CALF_HALF_WIDTH, OGRE_KNEE_Y);
  ctx.lineTo(ankleX - OGRE_CALF_HALF_WIDTH, ankleY);
  ctx.lineTo(ankleX + OGRE_CALF_HALF_WIDTH, ankleY);
  ctx.lineTo(kneeX + OGRE_CALF_HALF_WIDTH, OGRE_KNEE_Y);
  ctx.lineTo(hipX + OGRE_THIGH_HALF_WIDTH, OGRE_HIP_Y);
  ctx.closePath();
  fillAndStroke(ctx);

  ctx.beginPath();
  ctx.moveTo(ankleX - OGRE_CALF_HALF_WIDTH, ankleY);
  ctx.lineTo(ankleX - OGRE_CALF_HALF_WIDTH, soleY);
  ctx.lineTo(ankleX + OGRE_CALF_HALF_WIDTH + OGRE_FOOT_FORWARD, soleY);
  ctx.lineTo(ankleX + OGRE_CALF_HALF_WIDTH, ankleY);
  ctx.closePath();
  fillAndStroke(ctx);
}

function drawOgreHead(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tilt: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  strokeEllipse(ctx, 0, 0, rx, ry);

  withDetailStyle(ctx, () => {
    const eyeY = ry * OGRE_EYE_Y_FRACTION;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * (rx - OGRE_EYE_INSET), eyeY, OGRE_EYE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }

    const jawY = ry * OGRE_JAW_Y_FRACTION;
    const jawHalfWidth = rx * OGRE_JAW_HALF_WIDTH_FRACTION;
    ctx.beginPath();
    ctx.moveTo(-jawHalfWidth, jawY);
    ctx.lineTo(jawHalfWidth, jawY);
    ctx.stroke();

    // Tusks jutting up out of the lower jaw — the only reason these heads read as ogre.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * OGRE_TUSK_ROOT_X, jawY);
      ctx.lineTo(side * (OGRE_TUSK_ROOT_X + OGRE_TUSK_FLARE), jawY - OGRE_TUSK_LENGTH);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawOgreNeck(ctx: Ctx, headX: number, headY: number, breath: number): void {
  ctx.beginPath();
  ctx.moveTo(headX - OGRE_NECK_HALF_WIDTH, OGRE_SHOULDER_Y);
  ctx.lineTo(headX + OGRE_NECK_HALF_WIDTH, OGRE_SHOULDER_Y);
  ctx.lineTo(headX, headY - breath);
  ctx.closePath();
  fillAndStroke(ctx);
}

function drawOgreArm(
  ctx: Ctx,
  shoulderX: number,
  elbow: { readonly x: number; readonly y: number },
  hand: { readonly x: number; readonly y: number },
): void {
  ctx.beginPath();
  ctx.moveTo(shoulderX, OGRE_ARM_JOINT_Y - OGRE_ARM_HALF_WIDTH);
  ctx.lineTo(elbow.x, elbow.y - OGRE_ARM_HALF_WIDTH);
  ctx.lineTo(hand.x, hand.y);
  ctx.lineTo(elbow.x, elbow.y + OGRE_ARM_HALF_WIDTH);
  ctx.lineTo(shoulderX, OGRE_ARM_JOINT_Y + OGRE_ARM_HALF_WIDTH);
  ctx.closePath();
  fillAndStroke(ctx);
  strokeEllipse(ctx, hand.x, hand.y, OGRE_FIST_RADIUS, OGRE_FIST_RADIUS);
}

/**
 * A brute's keg torso: narrow hips, a barrel waist, then a chest flaring out to
 * carry all three necks, with the shoulders sloping back in on top.
 */
function drawOgreTorso(ctx: Ctx, breath: number): void {
  const waistHalfWidth = OGRE_WAIST_HALF_WIDTH + breath;

  ctx.beginPath();
  ctx.moveTo(-OGRE_HIP_HALF_WIDTH, OGRE_HIP_Y);
  ctx.quadraticCurveTo(-waistHalfWidth, OGRE_WAIST_Y, -OGRE_CHEST_HALF_WIDTH, OGRE_CHEST_Y);
  ctx.quadraticCurveTo(
    -OGRE_CHEST_HALF_WIDTH,
    OGRE_SHOULDER_Y,
    -OGRE_SHOULDER_HALF_WIDTH,
    OGRE_SHOULDER_Y,
  );
  ctx.lineTo(OGRE_SHOULDER_HALF_WIDTH, OGRE_SHOULDER_Y);
  ctx.quadraticCurveTo(OGRE_CHEST_HALF_WIDTH, OGRE_SHOULDER_Y, OGRE_CHEST_HALF_WIDTH, OGRE_CHEST_Y);
  ctx.quadraticCurveTo(waistHalfWidth, OGRE_WAIST_Y, OGRE_HIP_HALF_WIDTH, OGRE_HIP_Y);
  ctx.closePath();
  fillAndStroke(ctx);

  withDetailStyle(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-OGRE_STERNUM_LINE_HALF_WIDTH, OGRE_CHEST_Y);
    ctx.lineTo(OGRE_STERNUM_LINE_HALF_WIDTH, OGRE_CHEST_Y);
    ctx.stroke();
  });
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * The blade angle across one chop: a short wind-up back past rest, the swing
 * down across the body, then a recovery back to guard — the chop has to end
 * where it started or the blade snaps back the frame the animation expires.
 */
function ogreBladeAngle(attackProgress: number): number {
  if (attackProgress <= 0) return OGRE_BLADE_REST_ANGLE;
  if (attackProgress < OGRE_WINDUP_END_FRACTION) {
    return lerp(
      OGRE_BLADE_REST_ANGLE,
      OGRE_BLADE_WINDUP_ANGLE,
      attackProgress / OGRE_WINDUP_END_FRACTION,
    );
  }
  if (attackProgress < INK_STRIKE_LAND_FRACTION) {
    const chopProgress =
      (attackProgress - OGRE_WINDUP_END_FRACTION) /
      (INK_STRIKE_LAND_FRACTION - OGRE_WINDUP_END_FRACTION);
    return lerp(OGRE_BLADE_WINDUP_ANGLE, OGRE_BLADE_CHOP_ANGLE, chopProgress);
  }
  const recoveryProgress =
    (attackProgress - INK_STRIKE_LAND_FRACTION) / (1 - INK_STRIKE_LAND_FRACTION);
  return lerp(OGRE_BLADE_CHOP_ANGLE, OGRE_BLADE_REST_ANGLE, recoveryProgress);
}

function drawOgreScimitar(
  ctx: Ctx,
  hand: { readonly x: number; readonly y: number },
  bladeAngle: number,
): void {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(bladeAngle);

  ctx.beginPath();
  ctx.moveTo(0, OGRE_POMMEL_LENGTH);
  ctx.lineTo(0, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-OGRE_GUARD_HALF_WIDTH, 0);
  ctx.lineTo(OGRE_GUARD_HALF_WIDTH, 0);
  ctx.stroke();

  // Cutting edge bowing forward, spine returning behind it — the curve is the
  // whole silhouette, so both edges share one control offset.
  const curveY = -OGRE_BLADE_LENGTH * OGRE_BLADE_CURVE_MIDPOINT;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(OGRE_BLADE_CURVE, curveY, 0, -OGRE_BLADE_LENGTH);
  ctx.quadraticCurveTo(
    OGRE_BLADE_CURVE - OGRE_BLADE_SPINE_WIDTH,
    curveY,
    -OGRE_BLADE_SPINE_WIDTH,
    0,
  );
  ctx.closePath();
  fillAndStroke(ctx);

  ctx.restore();
}

function drawThreeHeadedOgre(
  ctx: Ctx,
  age: number,
  attackProgress: number,
  walkFrame: number,
  isMoving: boolean,
): void {
  setContourStyle(ctx);

  const stride = isMoving ? Math.sin(walkFrame) * OGRE_STRIDE_LENGTH : 0;
  const breath = Math.sin(age * OGRE_BREATH_SPEED) * OGRE_BREATH_AMPLITUDE;

  drawOgreLeg(ctx, -OGRE_LEG_X, -stride);
  drawOgreLeg(ctx, OGRE_LEG_X, stride);
  drawOgreArm(ctx, -OGRE_SHOULDER_JOINT_X, OGRE_IDLE_ELBOW, OGRE_IDLE_HAND);
  drawOgreTorso(ctx, breath);

  for (const side of [-1, 1]) {
    drawOgreNeck(ctx, side * OGRE_SIDE_HEAD_X, OGRE_SIDE_HEAD_Y, breath);
  }
  drawOgreNeck(ctx, 0, OGRE_MIDDLE_HEAD_Y, breath);

  for (const side of [-1, 1]) {
    drawOgreHead(
      ctx,
      side * OGRE_SIDE_HEAD_X,
      OGRE_SIDE_HEAD_Y - breath,
      OGRE_SIDE_HEAD_RX,
      OGRE_SIDE_HEAD_RY,
      side * OGRE_SIDE_HEAD_TILT,
    );
  }
  drawOgreHead(ctx, 0, OGRE_MIDDLE_HEAD_Y - breath, OGRE_MIDDLE_HEAD_RX, OGRE_MIDDLE_HEAD_RY, 0);

  drawOgreArm(ctx, OGRE_SHOULDER_JOINT_X, OGRE_SWORD_ELBOW, OGRE_SWORD_HAND);
  drawOgreScimitar(ctx, OGRE_SWORD_HAND, ogreBladeAngle(attackProgress));
}

/* ── Shark ─────────────────────────────────────────────────────────────── */

/**
 * The belly outline, evaluated at the curve's own parameter — the body path and
 * the jaw both key off these so the mouth cannot drift off the silhouette.
 */
function bellyPointX(t: number): number {
  return quadraticAt(SHARK_TAIL_ROOT_X, SHARK_BELLY_APEX_X, SHARK_NOSE_X, t);
}

function bellyPointY(t: number): number {
  return quadraticAt(SHARK_TAIL_ROOT_DROP, SHARK_BELLY_DROP, 0, t);
}

function drawSharkBody(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(SHARK_NOSE_X, 0);
  ctx.quadraticCurveTo(
    SHARK_BACK_APEX_X,
    -SHARK_BACK_RISE,
    SHARK_TAIL_ROOT_X,
    -SHARK_TAIL_ROOT_RISE,
  );
  ctx.lineTo(SHARK_PEDUNCLE_X, 0);
  ctx.lineTo(SHARK_TAIL_ROOT_X, SHARK_TAIL_ROOT_DROP);
  ctx.quadraticCurveTo(SHARK_BELLY_APEX_X, SHARK_BELLY_DROP, SHARK_NOSE_X, 0);
  ctx.closePath();
  fillAndStroke(ctx);
}

function drawSharkDorsalFin(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(SHARK_DORSAL_ROOT_FRONT_X, SHARK_DORSAL_ROOT_Y);
  ctx.lineTo(SHARK_DORSAL_TIP.x, SHARK_DORSAL_TIP.y);
  ctx.lineTo(SHARK_DORSAL_ROOT_BACK_X, SHARK_DORSAL_ROOT_Y);
  ctx.closePath();
  fillAndStroke(ctx);
}

function drawSharkPectoralFin(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(SHARK_PECTORAL_ROOT_FRONT_X, SHARK_PECTORAL_ROOT_Y);
  ctx.lineTo(SHARK_PECTORAL_TIP.x, SHARK_PECTORAL_TIP.y);
  ctx.lineTo(SHARK_PECTORAL_ROOT_BACK_X, SHARK_PECTORAL_ROOT_Y);
  ctx.closePath();
  fillAndStroke(ctx);
}

function drawSharkTail(ctx: Ctx, sweepAngle: number): void {
  ctx.save();
  ctx.translate(SHARK_PEDUNCLE_X, 0);
  ctx.rotate(sweepAngle);
  ctx.translate(-SHARK_PEDUNCLE_X, 0);

  ctx.beginPath();
  ctx.moveTo(SHARK_PEDUNCLE_X, 0);
  ctx.lineTo(SHARK_TAIL_UPPER_TIP.x, SHARK_TAIL_UPPER_TIP.y);
  ctx.lineTo(SHARK_TAIL_NOTCH.x, SHARK_TAIL_NOTCH.y);
  ctx.lineTo(SHARK_TAIL_LOWER_TIP.x, SHARK_TAIL_LOWER_TIP.y);
  ctx.closePath();
  fillAndStroke(ctx);

  ctx.restore();
}

function drawSharkHead(ctx: Ctx, jawOpen: number): void {
  // One closed silhouette: each lobe is traced only along the arc that lies
  // outside the span, so no stroke ever cuts across a lobe's face. Crossing them
  // is what made the head read as a dumbbell rather than as a cephalofoil.
  const lobeCenterY = SHARK_FOIL_LOBE_CENTER_Y;
  const seamAngle = Math.acos(SHARK_FOIL_RX / SHARK_FOIL_LOBE_RADIUS);
  const seamOffsetY = SHARK_FOIL_LOBE_RADIUS * Math.sin(seamAngle);

  ctx.beginPath();
  ctx.moveTo(SHARK_FOIL_X - SHARK_FOIL_RX, -lobeCenterY + seamOffsetY);
  ctx.arc(SHARK_FOIL_X, -lobeCenterY, SHARK_FOIL_LOBE_RADIUS, Math.PI - seamAngle, seamAngle);
  ctx.lineTo(SHARK_FOIL_X + SHARK_FOIL_RX, lobeCenterY - seamOffsetY);
  ctx.arc(SHARK_FOIL_X, lobeCenterY, SHARK_FOIL_LOBE_RADIUS, -seamAngle, Math.PI + seamAngle);
  ctx.closePath();
  fillAndStroke(ctx);

  withDetailStyle(ctx, () => {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(SHARK_FOIL_X, side * lobeCenterY, SHARK_EYE_RADIUS, 0, Math.PI * 2);
      fillAndStroke(ctx);
    }

    for (let i = 0; i < SHARK_GILL_COUNT; i++) {
      const gillX = SHARK_GILL_FRONT_X - i * SHARK_GILL_SPACING;
      ctx.beginPath();
      ctx.moveTo(gillX, -SHARK_GILL_HALF_HEIGHT);
      ctx.quadraticCurveTo(gillX - SHARK_GILL_BOW, 0, gillX, SHARK_GILL_HALF_HEIGHT);
      ctx.stroke();
    }
  });

  const mouthX = bellyPointX(SHARK_JAW_ALONG_BELLY);
  const mouthY = bellyPointY(SHARK_JAW_ALONG_BELLY);
  const jawControlY = mouthY + jawOpen;

  ctx.beginPath();
  ctx.moveTo(mouthX + SHARK_MOUTH_HALF_WIDTH, mouthY);
  ctx.quadraticCurveTo(mouthX, jawControlY, mouthX - SHARK_MOUTH_HALF_WIDTH, mouthY);
  ctx.stroke();

  if (jawOpen <= 0) return;
  withDetailStyle(ctx, () => {
    for (let i = 0; i < SHARK_TOOTH_COUNT; i++) {
      // Rooted on the jaw curve itself, so no tooth floats off the open jaw or
      // pokes through the closed one.
      const alongJaw = (i + TOOTH_PITCH_MIDPOINT) / SHARK_TOOTH_COUNT;
      const toothX = mouthX + SHARK_MOUTH_HALF_WIDTH * (1 - 2 * alongJaw);
      const toothRootY = quadraticAt(mouthY, jawControlY, mouthY, alongJaw);
      ctx.beginPath();
      ctx.moveTo(toothX, toothRootY);
      ctx.lineTo(toothX, toothRootY + SHARK_TOOTH_LENGTH);
      ctx.stroke();
    }
  });
}

/**
 * Surge-and-gape curve for the lunge, 0 at both ends and 1 at the moment the
 * jaws close on the target. Time is warped so the peak lands on
 * `INK_STRIKE_LAND_FRACTION` rather than at the animation's midpoint.
 */
function sharkLungeArc(attackProgress: number): number {
  if (attackProgress <= 0) return 0;
  const phase =
    attackProgress < INK_STRIKE_LAND_FRACTION
      ? (attackProgress / INK_STRIKE_LAND_FRACTION) * LUNGE_ARC_PEAK_PHASE
      : LUNGE_ARC_PEAK_PHASE +
        ((attackProgress - INK_STRIKE_LAND_FRACTION) / (1 - INK_STRIKE_LAND_FRACTION)) *
          LUNGE_ARC_PEAK_PHASE;
  return Math.sin(phase * Math.PI);
}

function drawHammerheadShark(
  ctx: Ctx,
  age: number,
  attackProgress: number,
  swimBlend: number,
): void {
  setContourStyle(ctx);

  const lungeArc = sharkLungeArc(attackProgress);
  const sweepAmplitude =
    SHARK_TAIL_SWEEP_ANGLE + (SHARK_TAIL_SWEEP_ANGLE_SWIMMING - SHARK_TAIL_SWEEP_ANGLE) * swimBlend;
  const sweepAngle = Math.sin(age * SHARK_TAIL_SWEEP_SPEED) * sweepAmplitude;
  const swimRoll = Math.sin(age * SHARK_SWIM_ROLL_SPEED) * SHARK_SWIM_ROLL;
  const swimPitch = SHARK_SWIM_PITCH * swimBlend;

  ctx.save();
  ctx.translate(lungeArc * SHARK_LUNGE_REACH, SHARK_SPINE_Y);
  ctx.rotate(swimRoll + swimPitch);

  drawSharkTail(ctx, sweepAngle);
  drawSharkDorsalFin(ctx);
  drawSharkBody(ctx);
  drawSharkPectoralFin(ctx);
  drawSharkHead(ctx, lungeArc * SHARK_JAW_OPEN);

  ctx.restore();
}

/* ── Extents, for callers that must reserve space around the tile ──────── */

/**
 * Tallest point either form reaches above the top edge of its tile, in tiles.
 * The scimitar wins this outright — it passes through vertical on every swing,
 * a full tile above the ogre's own heads.
 */
export const INK_MARAUDER_HEAD_CLEARANCE =
  Math.max(
    -(OGRE_SWORD_HAND.y - OGRE_BLADE_LENGTH),
    -(OGRE_MIDDLE_HEAD_Y - OGRE_MIDDLE_HEAD_RY),
    -(SHARK_SPINE_Y + SHARK_DORSAL_TIP.y),
  ) +
  BOB_AMPLITUDE -
  GROUND_ANCHOR_Y;

/**
 * Widest reach from the summon's centre line, in tiles. A lunge carries the
 * shark forward, so it extends the snout rather than the tail.
 */
export const INK_MARAUDER_HALF_WIDTH = Math.max(
  OGRE_SWORD_HAND.x + OGRE_BLADE_LENGTH,
  SHARK_FOIL_X + SHARK_FOIL_LOBE_RADIUS + SHARK_LUNGE_REACH,
  -SHARK_TAIL_UPPER_TIP.x,
);

/**
 * How far to lift one tile of tile-anchored feedback — a damage flash — so it
 * centres on the shark's spine instead of on the empty air it floats over.
 */
export const INK_SHARK_FLASH_Y_OFFSET = -(GROUND_ANCHOR_Y + SHARK_SPINE_Y) + FLASH_HEIGHT_TILES / 2;
