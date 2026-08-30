/**
 * The Sky Fowl — a sentient bipedal hawk who wanders the overworld town in a
 * vest, pants and, half the time, a hat.
 *
 * The painter only: anatomy, gait and palette. The choreography — which row is
 * which and how a frame index becomes a pose — lives in `skyFowlFigure.ts`.
 *
 * The clothing is a *parameter* rather than a separate layer. The sheets this
 * replaced could not take one, so each garment shipped as a white silhouette
 * mask that the runtime tinted and composited over a neutral body; a painter is
 * handed the colours and paints them where they go.
 *
 * The art invariants live in `scripts/gates-sky-fowl.ts`, which the review
 * harness runs: `npm run render:sky-fowl`.
 */

type Ctx = CanvasRenderingContext2D;

export interface SkyFowlClothColors {
  vest: string;
  pants: string;
  trim: string;
  hat: string | null;
}

/** Eight distinct clothing palettes — picked randomly per-instance. */
export const SKY_FOWL_PALETTES: readonly SkyFowlClothColors[] = [
  { vest: '#2e5c8a', pants: '#1a2a3a', trim: '#f0c060', hat: '#1a4050' }, // blue + gold
  { vest: '#6b2d2d', pants: '#3a1a1a', trim: '#c8a060', hat: '#8a3020' }, // burgundy + bronze
  { vest: '#2d6b3a', pants: '#1a3a1a', trim: '#e8d090', hat: null }, // forest green
  { vest: '#7a6020', pants: '#4a3a1a', trim: '#a8d080', hat: '#6a5010' }, // mustard + olive
  { vest: '#5a2d7a', pants: '#2a1a3a', trim: '#f0a0d0', hat: '#6a3090' }, // purple + pink
  { vest: '#1a4a4a', pants: '#0a2a2a', trim: '#80d0d0', hat: null }, // teal
  { vest: '#8a4020', pants: '#3a2010', trim: '#e0c060', hat: '#6a3010' }, // burnt orange + gold
  { vest: '#4a4a2a', pants: '#2a2a10', trim: '#a0c050', hat: null }, // olive drab
];

/** The bare scaled tarsus, which no garment covers. */
export const SKY_FOWL_LEG_COLOR = '#c8a030';

const FEATHER_BASE = '#7a5530';
const FEATHER_DARK = '#4a3015';
const FEATHER_LIGHT = '#a07840';
const BELLY_COLOR = '#d4b878';
const LEG_SCALE_COLOR = '#9a7820';
const TALON_COLOR = '#2a1a08';
/** The upper mandible, and the one colour on the bird that only the beak wears. */
export const SKY_FOWL_BEAK_COLOR = '#e0a418';
const BEAK_UPPER_COLOR = SKY_FOWL_BEAK_COLOR;
const BEAK_HOOK_COLOR = '#b07800';
const EYE_SCLERA_COLOR = '#fff5d0';
const EYE_IRIS_COLOR = '#e89010';
const EYE_PUPIL_COLOR = '#140800';
const EYE_GLINT_COLOR = 'rgba(255,255,255,0.65)';
const CONTACT_SHADOW_COLOR = 'rgba(0,0,0,0.18)';
/** The bloodshot ring that says this one has been provoked. */
const ANGRY_EYE_RING_COLOR = 'rgba(210,40,40,0.72)';

/**
 * The fowl is drawn slightly larger than the tile it stands on, so a bird in
 * the street reads as a person rather than as a chicken.
 */
const FIGURE_SCALE = 1.08;
/** Where the soles sit inside the tile. */
const GROUND_OFFSET_IN_TILE = 0.95;

const THIGH_HEIGHT = 0.22;
const TARSUS_HEIGHT = 0.13;
const BODY_HEIGHT = 0.27;
const BODY_WIDTH = 0.24;
const HEAD_RADIUS = 0.17;
/** How far the body's underside sits below the hips. */
const BODY_BOTTOM_BELOW_HIP = 0.05;
const HIP_HALF_SPREAD = 0.115;

/** Vertical travel of the body over one stride, as a fraction of the tile. */
const BODY_BOB = 0.042;
/** How much of the body's bob the head inherits, so the neck absorbs the rest. */
const HEAD_BOB_SHARE = 0.3;
const TAIL_SWAY = 0.038;
const WING_FLUTTER = 0.018;
/** How far the head lunges forward at the peak of a peck. */
const PECK_LUNGE = 0.1;

const TAU = Math.PI * 2;

/**
 * A foot on the ground, or in the air over its swing.
 *
 * The gait is a stance-then-swing cycle rather than a sine wave through both
 * legs at once: the planted foot slides backward under a body moving forward,
 * which is what makes a step read as a contact rather than as a skate, and only
 * the swinging one leaves the ground.
 */
export interface FootPlacement {
  readonly x: number;
  readonly y: number;
  /** 0 while the foot is planted, rising to 1 at the top of its swing arc. */
  readonly liftFraction: number;
}

/** Half the distance a foot travels between its forward and back extremes. */
const STRIDE = 0.159;
/** How high the swinging foot arcs over the ground line. */
const SWING_LIFT = 0.159;
/** Where along hip-to-foot the knee sits; biased toward the hip. */
const KNEE_TOWARD_FOOT = 0.45;
/** How far the knee rises at the top of its own foot's swing. */
const SWING_KNEE_RISE = 0.072;
/** The point in the cycle at which stance hands over to swing. */
const SWING_START_PHASE = 0.5;
/** The right foot leads the left by this much of a cycle. */
const LEG_PHASE_OFFSET = 0.5;

function footAtPhase(
  phase: number,
  cx: number,
  groundY: number,
  stride: number,
  lift: number,
): FootPlacement {
  const wrapped = ((phase % 1) + 1) % 1;
  if (wrapped < SWING_START_PHASE) {
    const through = wrapped / SWING_START_PHASE;
    return { x: cx + stride * Math.cos(through * Math.PI), y: groundY, liftFraction: 0 };
  }
  const through = (wrapped - SWING_START_PHASE) / (1 - SWING_START_PHASE);
  // The knee rides this rather than a flag flipped at the hand-over: a step
  // change at the instant the foot leaves the ground snaps the knee a
  // full sixteenth of a tile on one frame, and the leg reads as jointed wrong.
  const liftFraction = Math.sin(through * Math.PI);
  return {
    x: cx - stride * Math.cos(through * Math.PI),
    y: groundY - lift * liftFraction,
    liftFraction,
  };
}

/** One leg, placed in cell pixels: hip, the backward-bending knee, and the foot. */
interface LegPlacement {
  readonly hipX: number;
  readonly kneeX: number;
  readonly kneeY: number;
  readonly footX: number;
  readonly footY: number;
}

/** How far forward of the hip a standing bird's knee sits, giving the Z-bend. */
const STANDING_KNEE_FORWARD = 0.04;
/** How far the standing tarsus rakes back under that knee. */
const STANDING_FOOT_BEHIND_KNEE = 0.03;

function standingLegs(cx: number, cs: number, groundY: number, kneeY: number): LegPlacement[] {
  return [-1, 1].map((side) => {
    const hipX = cx + side * cs * HIP_HALF_SPREAD;
    const kneeX = hipX + cs * STANDING_KNEE_FORWARD;
    return {
      hipX,
      kneeX,
      kneeY,
      footX: kneeX - cs * STANDING_FOOT_BEHIND_KNEE,
      footY: groundY,
    };
  });
}

/**
 * Where both feet are at a point in the stride cycle, in figure units — the
 * scale the whole bird is drawn at. `x` runs from the body's centre line and
 * `y` from the ground line, so a planted foot is at zero and a swinging one is
 * negative.
 *
 * Exported so the gait gate reads the placement the painter draws from rather
 * than a re-derivation of it. The left foot is first.
 */
export function skyFowlWalkFeet(walkFrame: number): readonly FootPlacement[] {
  const phase = walkFrame / TAU;
  return [-1, 1].map((side) =>
    footAtPhase(side < 0 ? phase + LEG_PHASE_OFFSET : phase, 0, 0, STRIDE, SWING_LIFT),
  );
}

function walkingLegs(
  walkFrame: number,
  cx: number,
  cs: number,
  groundY: number,
  kneeY: number,
): LegPlacement[] {
  return skyFowlWalkFeet(walkFrame).map((foot, index) => {
    const side = index === 0 ? -1 : 1;
    const hipX = cx + side * cs * HIP_HALF_SPREAD;
    const footX = cx + foot.x * cs;
    return {
      hipX,
      kneeX: hipX + (footX - hipX) * KNEE_TOWARD_FOOT,
      kneeY: kneeY - cs * SWING_KNEE_RISE * foot.liftFraction,
      footX,
      footY: groundY + foot.y * cs,
    };
  });
}

/**
 * Draw a Sky Fowl.
 *
 * @param ctx          Canvas rendering context
 * @param sx           Screen X (top-left of the tile)
 * @param sy           Screen Y (top-left of the tile)
 * @param s            Tile size in pixels
 * @param walkFrame    Gait phase in radians; one stride cycle per turn
 * @param isMoving     True when actively walking
 * @param isAggressive True when the fowl has been attacked and is fighting back
 * @param cloth        Clothing colours for this fowl
 * @param peckAmt      0–1 head-lunge for the peck animation
 */
export function drawSkyFowlSprite(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  walkFrame: number,
  isMoving: boolean,
  isAggressive: boolean,
  cloth: SkyFowlClothColors,
  peckAmt: number,
): void {
  const cs = s * FIGURE_SCALE;
  const cx = sx + s * 0.5;

  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * BODY_BOB : 0;
  // Both driven at the stride frequency rather than at their own: an incommensurate
  // rate looks livelier frame by frame and leaves the eight-frame row unable to
  // close, which is a visible pop once per cycle for the life of the creature.
  const wingFlutter = isMoving ? Math.sin(walkFrame) * cs * WING_FLUTTER : 0;
  const tailSway = Math.sin(walkFrame) * cs * TAIL_SWAY;

  const fBase = FEATHER_BASE;
  const fDark = FEATHER_DARK;
  const fLight = FEATHER_LIGHT;
  const belly = BELLY_COLOR;
  const legCol = SKY_FOWL_LEG_COLOR;
  const talonCol = TALON_COLOR;
  const beakUpper = BEAK_UPPER_COLOR;
  const beakHook = BEAK_HOOK_COLOR;
  const eyeAmber = EYE_IRIS_COLOR;
  const eyePupil = EYE_PUPIL_COLOR;

  const thighH = cs * THIGH_HEIGHT;
  const tarsusH = cs * TARSUS_HEIGHT;
  const bodyH = cs * BODY_HEIGHT;
  const bodyW = cs * BODY_WIDTH;
  const headR = cs * HEAD_RADIUS;

  // The ground line does not bob. The body rides over it and the legs reach for
  // it; bobbing it too takes the contact shadow and the planted foot up with the
  // hips, which is the whole cue that the creature is standing on anything.
  const groundY = sy + s * GROUND_OFFSET_IN_TILE;
  const kneeY = groundY + bodyBob - tarsusH;
  const hipY = kneeY - thighH;
  const bodyBottomY = hipY + cs * BODY_BOTTOM_BELOW_HIP;
  const bodyTopY = bodyBottomY - bodyH;
  const bodyCy = (bodyBottomY + bodyTopY) * 0.5;
  const headCy = bodyTopY - headR * 0.75 + bodyBob * HEAD_BOB_SHARE;

  const peckOffsetX = peckAmt * cs * PECK_LUNGE;

  ctx.save();

  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(cx, groundY + cs * 0.035, cs * 0.28, cs * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = fDark;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.ellipse(
      cx - cs * 0.06 + i * cs * 0.09 + tailSway * 0.6,
      bodyBottomY + cs * 0.09,
      cs * 0.055,
      cs * 0.13,
      i * 0.28 + tailSway * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Tail highlight
  ctx.fillStyle = fLight;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.ellipse(
      cx - cs * 0.06 + i * cs * 0.09 + tailSway * 0.6,
      bodyBottomY + cs * 0.07,
      cs * 0.022,
      cs * 0.07,
      i * 0.28 + tailSway * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const legs = isMoving
    ? walkingLegs(walkFrame, cx, cs, groundY, kneeY)
    : standingLegs(cx, cs, groundY, kneeY);

  // Pants (thigh)
  ctx.lineCap = 'round';
  ctx.lineWidth = cs * 0.115;
  ctx.strokeStyle = cloth.pants;
  for (const leg of legs) {
    ctx.beginPath();
    ctx.moveTo(leg.hipX, hipY);
    ctx.lineTo(leg.kneeX, leg.kneeY);
    ctx.stroke();
  }

  // Tarsus (bare scaled leg)
  ctx.lineWidth = cs * 0.075;
  ctx.strokeStyle = legCol;
  for (const leg of legs) {
    ctx.beginPath();
    ctx.moveTo(leg.kneeX, leg.kneeY);
    ctx.lineTo(leg.footX, leg.footY);
    ctx.stroke();
  }

  // Scale texture on tarsus
  ctx.strokeStyle = LEG_SCALE_COLOR;
  ctx.lineWidth = cs * 0.018;
  const scaleNotchCount = 2;
  for (const leg of legs) {
    for (let i = 1; i <= scaleNotchCount; i++) {
      const t = i / (scaleNotchCount + 1);
      const px = leg.kneeX + (leg.footX - leg.kneeX) * t;
      const py = leg.kneeY + (leg.footY - leg.kneeY) * t;
      ctx.beginPath();
      ctx.moveTo(px - cs * 0.04, py);
      ctx.lineTo(px + cs * 0.04, py);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = talonCol;
  ctx.lineWidth = cs * 0.04;
  ctx.lineCap = 'round';
  for (const { footX: fx, footY: fy } of legs) {
    // Three forward talons
    for (let t = -1; t <= 1; t++) {
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(
        fx + cs * 0.06 + t * cs * 0.03,
        fy + cs * 0.03,
        fx + cs * 0.1 + t * cs * 0.04,
        fy + cs * 0.055,
      );
      ctx.stroke();
    }
    // One rear talon
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx - cs * 0.04, fy + cs * 0.02, fx - cs * 0.07, fy + cs * 0.05);
    ctx.stroke();
  }

  ctx.fillStyle = fBase;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, bodyW, bodyH * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly (lighter front)
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.045, bodyCy + cs * 0.025, bodyW * 0.52, bodyH * 0.37, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = cloth.vest;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.04, bodyCy, bodyW * 0.49, bodyH * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Vest collar V-shape
  ctx.strokeStyle = cloth.trim;
  ctx.lineWidth = cs * 0.024;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.04, bodyCy - bodyH * 0.28);
  ctx.lineTo(cx + cs * 0.04, bodyCy - bodyH * 0.06);
  ctx.lineTo(cx + cs * 0.1, bodyCy - bodyH * 0.28);
  ctx.stroke();

  // Vest buttons
  ctx.fillStyle = cloth.trim;
  for (let b = 0; b < 3; b++) {
    ctx.beginPath();
    ctx.arc(cx + cs * 0.04, bodyCy - cs * 0.055 + b * cs * 0.072, cs * 0.017, 0, Math.PI * 2);
    ctx.fill();
  }

  // Left wing
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(
    cx - bodyW * 0.86 + wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.095,
    bodyH * 0.38,
    -0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = fLight;
  ctx.beginPath();
  ctx.ellipse(
    cx - bodyW * 0.86 + wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.04,
    bodyH * 0.24,
    -0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Right wing
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(
    cx + bodyW * 0.86 - wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.095,
    bodyH * 0.38,
    0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = fLight;
  ctx.beginPath();
  ctx.ellipse(
    cx + bodyW * 0.86 - wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.04,
    bodyH * 0.24,
    0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = fBase;
  const neckCy = bodyTopY + (headCy - bodyTopY) * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.02, neckCy, cs * 0.09, cs * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  const hx = cx + peckOffsetX; // lunge forward when pecking
  ctx.fillStyle = fBase;
  ctx.beginPath();
  ctx.arc(hx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // Cap feathers (dark top of head)
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(hx - cs * 0.015, headCy - headR * 0.3, headR * 0.82, headR * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small crest feather on top
  ctx.strokeStyle = fDark;
  ctx.lineWidth = cs * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - cs * 0.01, headCy - headR * 0.88);
  ctx.quadraticCurveTo(hx + cs * 0.04, headCy - headR * 1.28, hx + cs * 0.07, headCy - headR * 1.2);
  ctx.stroke();

  if (cloth.hat) {
    const brimY = headCy - headR * 0.58;
    const crownH = headR * 0.58;

    // Hat crown (box shape)
    ctx.fillStyle = cloth.hat;
    ctx.beginPath();
    ctx.rect(hx - headR * 0.68, brimY - crownH, headR * 1.36, crownH);
    ctx.fill();
    // Crown top ellipse
    ctx.beginPath();
    ctx.ellipse(hx, brimY - crownH, headR * 0.68, headR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Brim ellipse
    ctx.beginPath();
    ctx.ellipse(hx, brimY, headR * 1.08, headR * 0.21, 0, 0, Math.PI * 2);
    ctx.fill();

    // No hatband. The crown is four pixels tall at a 32px tile, so a band in the
    // trim colour across it stops reading as a hat with a ribbon and starts
    // reading as a bright bar sitting on the bird's head.
  }

  // Upper mandible — curved hook
  const bx = hx + headR * 0.68;
  const by = headCy + headR * 0.05;

  ctx.fillStyle = beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by - headR * 0.15);
  ctx.quadraticCurveTo(bx + headR * 0.7, by + headR * 0.05, bx + headR * 0.5, by + headR * 0.35);
  ctx.lineTo(bx, by + headR * 0.2);
  ctx.closePath();
  ctx.fill();

  // Hook tip (darker)
  ctx.fillStyle = beakHook;
  ctx.beginPath();
  ctx.moveTo(bx + headR * 0.44, by + headR * 0.3);
  ctx.quadraticCurveTo(bx + headR * 0.68, by + headR * 0.38, bx + headR * 0.52, by + headR * 0.52);
  ctx.lineTo(bx + headR * 0.3, by + headR * 0.42);
  ctx.closePath();
  ctx.fill();

  // Lower mandible (smaller, opens slightly when aggressive or pecking)
  const jawOpen = peckAmt * headR * 0.12 + (isAggressive ? headR * 0.06 : 0);
  ctx.fillStyle = beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by + headR * 0.2 + jawOpen);
  ctx.quadraticCurveTo(
    bx + headR * 0.45,
    by + headR * 0.3 + jawOpen,
    bx + headR * 0.42,
    by + headR * 0.4 + jawOpen,
  );
  ctx.lineTo(bx, by + headR * 0.32 + jawOpen);
  ctx.closePath();
  ctx.fill();

  const eyeX = hx + headR * 0.3;
  const eyeY = headCy - headR * 0.18;
  const eyeR = headR * 0.27;

  // Sclera
  ctx.fillStyle = EYE_SCLERA_COLOR;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Iris
  ctx.fillStyle = eyeAmber;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = eyePupil;
  ctx.beginPath();
  ctx.arc(eyeX + eyeR * 0.06, eyeY + eyeR * 0.06, eyeR * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  ctx.fillStyle = EYE_GLINT_COLOR;
  ctx.beginPath();
  ctx.arc(eyeX - eyeR * 0.18, eyeY - eyeR * 0.2, eyeR * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Brow ridge (expressive — flat when neutral, angled inward when aggressive)
  ctx.strokeStyle = fDark;
  ctx.lineWidth = cs * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (isAggressive) {
    // Furrowed brow — inner end drops lower
    ctx.moveTo(eyeX - eyeR * 1.0, eyeY - eyeR * 0.95);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.35);
  } else {
    // Neutral / curious brow — slight upward curve
    ctx.moveTo(eyeX - eyeR * 1.0, eyeY - eyeR * 1.15);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.1);
  }
  ctx.stroke();

  // Aggressive red eye ring
  if (isAggressive) {
    ctx.strokeStyle = ANGRY_EYE_RING_COLOR;
    ctx.lineWidth = cs * 0.032;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR * 1.28, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
