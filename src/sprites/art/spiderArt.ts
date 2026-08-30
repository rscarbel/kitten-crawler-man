/**
 * The small hunting spider's anatomy: palette, body geometry, leg rig and every
 * stroke of paint.
 *
 * The spider is drawn top-down facing "north" (toward -Y) and rotated to its
 * heading at draw time, so one orientation covers every direction. Anatomy is
 * modelled on a real ground-hunting spider (Lycosidae): a pear-shaped prosoma
 * carrying the eye group and chelicerae, a narrow pedicel, an ovoid
 * opisthosoma with a scalloped folium, and eight legs of four segments whose
 * knees break outward the way a real spider's do.
 *
 * Which pose each frame of each row gets is choreography and lives in
 * `spiderFigure.ts`; this module knows only how to paint one pose.
 */

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

/** Smooth 0→1 ease used for limb swings and body transitions. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps a value from one range to a clamped 0→1 progress. */
export function ramp(value: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
export function hashRandom(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

// ── Palette ──────────────────────────────────────────────────────────────────

const CARAPACE_HIGHLIGHT = '#7a4f28';
const CARAPACE_MID = '#4d2e17';
const CARAPACE_EDGE = '#26150b';
const CARAPACE_RIM = '#150b05';
const CARAPACE_MARGIN_BAND = '#8a6237';

const ABDOMEN_HIGHLIGHT = '#5c3b1f';
const ABDOMEN_MID = '#3a2413';
const ABDOMEN_EDGE = '#1d1108';
const ABDOMEN_FOLIUM = '#120a04';
const ABDOMEN_PALE = '#967549';

const LEG_DARK = '#1e1209';
const LEG_MID = '#38210f';
const LEG_SHEEN = '#6b4423';
const LEG_BAND = '#7d5a30';
const SETA_COLOR = 'rgba(24,14,7,0.55)';
const SPINE_COLOR = 'rgba(14,8,4,0.85)';

const EYE_DARK = '#080604';
const EYE_RING = '#241408';
const EYE_GLINT = 'rgba(255,246,232,0.9)';
const EYE_SHINE_COLOR = 'rgba(214,132,54,0.85)';

const FANG_BASE = '#432414';
const FANG_TIP = '#1a0c05';

const VENTRAL_STERNUM = '#b19064';
const VENTRAL_STERNUM_EDGE = '#6d5230';
const VENTRAL_COXA = '#8a6d44';
const VENTRAL_BELLY = '#8e7148';
const VENTRAL_BELLY_EDGE = '#4a3620';
const VENTRAL_BOOK_LUNG = '#c9ad7d';
const VENTRAL_FURROW = '#3d2c17';
const VENTRAL_LEG_TINT = '#2a1a0c';
const VENTRAL_LEG_MID = '#5c3f22';

const SHADOW_COLOR = 'rgba(0,0,0,0.42)';

// ── Body geometry, in tile units (1.0 === TILE_SCALE px) ─────────────────────

// An arachnid has two tagmata of comparable bulk, not an insect's small head on
// a fat gaster. If the carapace shrinks much below the abdomen it stops reading
// as half the animal and starts reading as a head, and no amount of leg work
// recovers the silhouette from there.
const PROSOMA_FRONT_Y = -0.3;
const PROSOMA_REAR_Y = 0.115;
const PROSOMA_HALF_WIDTH = 0.2;
const PROSOMA_LENGTH = PROSOMA_REAR_Y - PROSOMA_FRONT_Y;
/** The carapace flares behind the eye region and tapers again toward the pedicel. */
const PROSOMA_WIDEST_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.42;
/** The eye-bearing cephalic dome sits on the front fifth of the carapace. */
const CEPHALIC_CENTER_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.2;
/** The fovea is the pit two-thirds back where the sucking-stomach muscles anchor. */
const FOVEA_FRONT_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.59;
const FOVEA_REAR_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.76;

// The abdomen starts behind the carapace rather than butting against it: the
// gap the pedicel bridges is what keeps the two from fusing into one peanut.
const ABDOMEN_FRONT_Y = 0.055;
const ABDOMEN_REAR_Y = 0.555;
const ABDOMEN_HALF_WIDTH = 0.222;
const ABDOMEN_WIDEST_Y = 0.26;
const PEDICEL_HALF_WIDTH = 0.034;

/**
 * One leg, described on the spider's right side; the left side mirrors it.
 * Angles are degrees from +X with +Y pointing toward the spider's rear, so a
 * negative angle reaches forward.
 */
export interface LegDef {
  readonly attachX: number;
  readonly attachY: number;
  readonly femurAngle: number;
  readonly tibiaAngle: number;
  readonly tarsusAngle: number;
  readonly femur: number;
  readonly tibia: number;
  /** Metatarsus and tarsus lumped: nearly as long as the tibia on a real spider. */
  readonly tarsus: number;
}

/**
 * Front → rear. Leg IV is the longest and leg III the shortest.
 *
 * Every coxa sockets into the carapace and nothing sockets into the abdomen —
 * that is the whole difference between an arachnid and an insect thorax, and it
 * forces all eight attachments into the narrow band between the eye region and
 * the pedicel.
 *
 * The femur runs almost transverse so the knee is the widest point of the
 * animal; everything past it sweeps fore or aft and the tarsus curls back in
 * toward the long axis. That dogleg — wide knees, feet tucked inside them — is
 * the single most recognisable thing about a spider seen from above.
 */
export const LEGS: readonly LegDef[] = [
  {
    attachX: 0.118,
    attachY: -0.185,
    femurAngle: -30,
    tibiaAngle: -74,
    tarsusAngle: -99,
    femur: 0.3,
    tibia: 0.34,
    tarsus: 0.31,
  },
  {
    attachX: 0.14,
    attachY: -0.105,
    femurAngle: -12,
    tibiaAngle: -46,
    tarsusAngle: -66,
    femur: 0.28,
    tibia: 0.31,
    tarsus: 0.28,
  },
  {
    attachX: 0.14,
    attachY: -0.02,
    femurAngle: 14,
    tibiaAngle: 44,
    tarsusAngle: 64,
    femur: 0.27,
    tibia: 0.29,
    tarsus: 0.26,
  },
  {
    attachX: 0.11,
    attachY: 0.045,
    femurAngle: 33,
    tibiaAngle: 76,
    tarsusAngle: 100,
    femur: 0.31,
    tibia: 0.36,
    tarsus: 0.33,
  },
];

export const LEG_COUNT_PER_SIDE = LEGS.length;
export const TOTAL_LEGS = LEG_COUNT_PER_SIDE * 2;
/** Legs 0–3 are the right side, 4–7 the left. */
export const FIRST_LEFT_LEG = LEG_COUNT_PER_SIDE;

// Spider legs taper hard: a thick muscular femur down to a tarsus barely wider
// than a hair. Even taper along the whole limb is what makes a beetle leg.
const FEMUR_HALF_WIDTH = 0.032;
const KNEE_HALF_WIDTH = 0.023;
const TIBIA_TIP_HALF_WIDTH = 0.015;
const TARSUS_TIP_HALF_WIDTH = 0.006;

// ── Pose model ───────────────────────────────────────────────────────────────

export interface LegPose {
  readonly femurAngle: number;
  readonly tibiaAngle: number;
  readonly tarsusAngle: number;
  /** 0 planted, 1 fully raised mid-swing. */
  readonly lift: number;
  /** Scales every segment; below 1 pulls the leg in toward the body. */
  readonly reach: number;
}

export interface SpiderPose {
  readonly legs: readonly LegPose[];
  /** Uniform scale — larger reads as closer to the camera, i.e. airborne. */
  readonly bodyScale: number;
  /** In-plane rotation, radians. */
  readonly spin: number;
  /** Roll about the long axis: 0 upright, π fully on its back. */
  readonly roll: number;
  readonly abdomenSway: number;
  readonly abdomenScale: number;
  /** Pulls the prosoma back toward the abdomen when the spider hunkers down. */
  readonly prosomaSink: number;
  readonly fangOpen: number;
  readonly palpSwing: number;
  readonly shadowScale: number;
  readonly shadowAlpha: number;
  readonly eyeShine: number;
}

export const DEFAULT_SHADOW_ALPHA = 1;

export function restLeg(def: LegDef): LegPose {
  return {
    femurAngle: def.femurAngle,
    tibiaAngle: def.tibiaAngle,
    tarsusAngle: def.tarsusAngle,
    lift: 0,
    reach: 1,
  };
}

export function basePose(legs: readonly LegPose[]): SpiderPose {
  return {
    legs,
    bodyScale: 1,
    spin: 0,
    roll: 0,
    abdomenSway: 0,
    abdomenScale: 1,
    prosomaSink: 0,
    fangOpen: 0,
    palpSwing: 0,
    shadowScale: 1,
    shadowAlpha: DEFAULT_SHADOW_ALPHA,
    eyeShine: 0,
  };
}

/**
 * Straightens a leg out along `targetDegrees`, keeping a shallow residual bend.
 * A spider in flight extends its legs almost rigid instead of holding the deep
 * standing crouch, so the airborne frames need a target pose, not a rotation.
 */
export function reachLeg(
  leg: LegPose,
  targetDegrees: number,
  bendDegrees: number,
  amount: number,
): LegPose {
  return {
    femurAngle: lerp(leg.femurAngle, targetDegrees - bendDegrees, amount),
    tibiaAngle: lerp(leg.tibiaAngle, targetDegrees, amount),
    tarsusAngle: lerp(leg.tarsusAngle, targetDegrees + bendDegrees * 0.6, amount),
    lift: leg.lift,
    reach: leg.reach,
  };
}

/** Rotates a leg's whole chain — used for strides, splays and flails. */
export function swingLeg(leg: LegPose, degrees: number, lift = 0, reach = 1): LegPose {
  return {
    femurAngle: leg.femurAngle + degrees,
    tibiaAngle: leg.tibiaAngle + degrees,
    tarsusAngle: leg.tarsusAngle + degrees,
    lift: Math.max(leg.lift, lift),
    reach: leg.reach * reach,
  };
}

// A dead spider's legs curl because losing hydraulic pressure lets the flexors
// win. Two things happen at once: the femora pull in off their walking stance
// into an even radial fan, and everything past the knee folds back on itself.
// The result is the familiar rosette — knees at the outside, tarsi converging
// over the belly.
const CURL_FOLD_DEG = 120;
/** Femur headings the fan settles into, front → rear pair, on the right side. */
const CURL_FAN_DEG: readonly number[] = [-68, -26, 26, 68];
const CURL_REACH = 0.94;

export function curlLeg(pair: number, leg: LegPose, amount: number): LegPose {
  const fanAngle = CURL_FAN_DEG[pair];
  // Fold back toward the body's long axis so no leg sweeps across to the
  // opposite side: forward-fanned legs curl rearward and vice versa.
  const fold = (fanAngle < 0 ? 1 : -1) * CURL_FOLD_DEG;
  return {
    femurAngle: lerp(leg.femurAngle, fanAngle, amount),
    tibiaAngle: lerp(leg.tibiaAngle, fanAngle + fold, amount),
    tarsusAngle: lerp(leg.tarsusAngle, fanAngle + fold * 2, amount),
    lift: leg.lift,
    reach: leg.reach * lerp(1, CURL_REACH, amount),
  };
}

// ── Low-level drawing helpers ────────────────────────────────────────────────

/**
 * Draws a limb segment as a tapered capsule: a quad between two half-widths
 * with a disc at each joint so consecutive segments meet without a seam.
 */
function taperedSegment(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  halfWidth1: number,
  halfWidth2: number,
  color: string,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < Number.EPSILON) return;
  const nx = -dy / length;
  const ny = dx / length;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * halfWidth1, y1 + ny * halfWidth1);
  ctx.lineTo(x2 + nx * halfWidth2, y2 + ny * halfWidth2);
  ctx.lineTo(x2 - nx * halfWidth2, y2 - ny * halfWidth2);
  ctx.lineTo(x1 - nx * halfWidth1, y1 - ny * halfWidth1);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x1, y1, halfWidth1, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x2, y2, halfWidth2, 0, TWO_PI);
  ctx.fill();
}

const BOW_STEPS = 5;

/**
 * Draws a limb segment as a shallow arc instead of a straight rod, `bow` being
 * the perpendicular control offset as a fraction of the segment's length.
 *
 * A spider leg is a continuous curve, not a polyline. Posing straight rods at
 * the right joint angles still reads as machinery — the bow is what turns three
 * hinged sticks into a limb.
 */
function bowedSegment(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  halfWidth1: number,
  halfWidth2: number,
  bow: number,
  color: string,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const controlX = (x1 + x2) / 2 - dy * bow;
  const controlY = (y1 + y2) / 2 + dx * bow;

  let prevX = x1;
  let prevY = y1;
  for (let step = 1; step <= BOW_STEPS; step++) {
    const t = step / BOW_STEPS;
    const u = 1 - t;
    const nextX = u * u * x1 + 2 * u * t * controlX + t * t * x2;
    const nextY = u * u * y1 + 2 * u * t * controlY + t * t * y2;
    taperedSegment(
      ctx,
      prevX,
      prevY,
      nextX,
      nextY,
      lerp(halfWidth1, halfWidth2, (step - 1) / BOW_STEPS),
      lerp(halfWidth1, halfWidth2, t),
      color,
    );
    prevX = nextX;
    prevY = nextY;
  }
}

/** The specular ridge along the top of a rounded segment. */
function segmentSheen(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = LEG_SHEEN;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

const SETAE_PER_SEGMENT = 4;
const SETA_ANGLE_DEG = 58;
const SETA_LENGTH_JITTER = 0.4;

/** Fine bristles along a segment — the detail that sells "real spider". */
function drawSetae(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  length: number,
  seed: number,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const axis = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = SETA_COLOR;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < SETAE_PER_SEGMENT; i++) {
    const t = (i + 1) / (SETAE_PER_SEGMENT + 1);
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    for (const side of [-1, 1]) {
      const jitter = hashRandom(seed + i * 7 + (side + 1) * 31);
      const hairLength = length * (1 - SETA_LENGTH_JITTER + jitter * SETA_LENGTH_JITTER * 2);
      const angle = axis + side * deg(SETA_ANGLE_DEG) + (jitter - 0.5) * deg(20);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * hairLength, by + Math.sin(angle) * hairLength);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const TIBIAL_SPINE_COUNT = 2;
const TIBIAL_SPINE_ANGLE_DEG = 42;

function drawTibialSpines(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  length: number,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const axis = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = SPINE_COLOR;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < TIBIAL_SPINE_COUNT; i++) {
    const t = (i + 1) / (TIBIAL_SPINE_COUNT + 1);
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    for (const side of [-1, 1]) {
      const angle = axis + side * deg(TIBIAL_SPINE_ANGLE_DEG);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * length, by + Math.sin(angle) * length);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/** A lifted leg foreshortens as it swings up out of the ground plane. */
const LIFT_FORESHORTEN = 0.12;
const LIFT_BRIGHTEN = 0.35;
const JOINT_NUB_SCALE = 1.15;
const CLAW_LENGTH = 0.035;
const CLAW_SPREAD_DEG = 26;
/** Perpendicular bow per degree of turn at the joint that follows a segment. */
const BOW_PER_TURN_DEGREE = 0.0028;
const TARSUS_BOW_CARRYOVER = 1.4;

function drawLeg(ctx: Ctx, ts: number, side: number, def: LegDef, pose: LegPose, ventral: boolean) {
  ctx.save();
  ctx.scale(side, 1);

  const reach = pose.reach * (1 - pose.lift * LIFT_FORESHORTEN);
  const ax = def.attachX * ts;
  const ay = def.attachY * ts;

  const femurAngle = deg(pose.femurAngle);
  const tibiaAngle = deg(pose.tibiaAngle);
  const tarsusAngle = deg(pose.tarsusAngle);

  const kneeX = ax + Math.cos(femurAngle) * def.femur * ts * reach;
  const kneeY = ay + Math.sin(femurAngle) * def.femur * ts * reach;
  const bendX = kneeX + Math.cos(tibiaAngle) * def.tibia * ts * reach;
  const bendY = kneeY + Math.sin(tibiaAngle) * def.tibia * ts * reach;
  const tipX = bendX + Math.cos(tarsusAngle) * def.tarsus * ts * reach;
  const tipY = bendY + Math.sin(tarsusAngle) * def.tarsus * ts * reach;

  const femurHalf = FEMUR_HALF_WIDTH * ts;
  const kneeHalf = KNEE_HALF_WIDTH * ts;
  const tibiaTipHalf = TIBIA_TIP_HALF_WIDTH * ts;
  const tarsusTipHalf = TARSUS_TIP_HALF_WIDTH * ts;

  const baseColor = ventral ? VENTRAL_LEG_TINT : LEG_DARK;
  const midColor = ventral ? VENTRAL_LEG_MID : LEG_MID;

  // Each segment bows into the turn the next joint makes, so the three links
  // read as one continuous curve instead of a hinged polyline. The tarsus has
  // no joint after it, so it carries on the curl the knee started.
  const femurBow = (pose.tibiaAngle - pose.femurAngle) * BOW_PER_TURN_DEGREE;
  const tibiaBow = (pose.tarsusAngle - pose.tibiaAngle) * BOW_PER_TURN_DEGREE;
  const tarsusBow = tibiaBow * TARSUS_BOW_CARRYOVER;

  bowedSegment(ctx, ax, ay, kneeX, kneeY, femurHalf, kneeHalf, femurBow, midColor);
  bowedSegment(ctx, kneeX, kneeY, bendX, bendY, kneeHalf, tibiaTipHalf, tibiaBow, baseColor);
  bowedSegment(ctx, bendX, bendY, tipX, tipY, tibiaTipHalf, tarsusTipHalf, tarsusBow, baseColor);

  const sheenAlpha = (ventral ? 0.18 : 0.32) + pose.lift * LIFT_BRIGHTEN;
  segmentSheen(ctx, ax, ay, kneeX, kneeY, femurHalf * 0.7, sheenAlpha);
  segmentSheen(ctx, kneeX, kneeY, bendX, bendY, kneeHalf * 0.6, sheenAlpha * 0.8);

  // Pale annulations mark the joints the way banded hunting spiders' legs do.
  ctx.fillStyle = LEG_BAND;
  ctx.globalAlpha = ventral ? 0.35 : 0.7;
  ctx.beginPath();
  ctx.arc(kneeX, kneeY, kneeHalf * JOINT_NUB_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bendX, bendY, tibiaTipHalf * JOINT_NUB_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(kneeX, kneeY, kneeHalf * 0.75, 0, TWO_PI);
  ctx.fill();

  const setaLength = ts * 0.05;
  const hairWidth = Math.max(0.6, ts * 0.006);
  drawSetae(ctx, ax, ay, kneeX, kneeY, setaLength, def.femurAngle * 3 + side, hairWidth);
  drawSetae(
    ctx,
    kneeX,
    kneeY,
    bendX,
    bendY,
    setaLength * 0.8,
    def.tibiaAngle * 5 + side,
    hairWidth,
  );
  drawTibialSpines(ctx, kneeX, kneeY, bendX, bendY, ts * 0.055, hairWidth * 1.6);

  // Two tarsal claws at the tip.
  const clawAxis = Math.atan2(tipY - bendY, tipX - bendX);
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = Math.max(0.7, ts * 0.008);
  ctx.lineCap = 'round';
  for (const clawSide of [-1, 1]) {
    const angle = clawAxis + clawSide * deg(CLAW_SPREAD_DEG);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(angle) * ts * CLAW_LENGTH,
      tipY + Math.sin(angle) * ts * CLAW_LENGTH,
    );
    ctx.stroke();
  }

  ctx.restore();
}

// ── Prosoma (cephalothorax) ──────────────────────────────────────────────────

/**
 * Builds the carapace outline: a blunt shield, narrow across the eye region and
 * broadest where legs II and III socket in.
 */
function prosomaPath(ctx: Ctx, ts: number): void {
  const w = PROSOMA_HALF_WIDTH * ts;
  const front = PROSOMA_FRONT_Y * ts;
  const rear = PROSOMA_REAR_Y * ts;
  const widest = PROSOMA_WIDEST_Y * ts;
  const shoulder = PROSOMA_LENGTH * ts * 0.22;
  const haunch = PROSOMA_LENGTH * ts * 0.2;

  ctx.beginPath();
  ctx.moveTo(0, front);
  ctx.bezierCurveTo(w * 0.66, front + ts * 0.004, w * 1.0, widest - shoulder, w, widest);
  ctx.bezierCurveTo(w, widest + haunch, w * 0.66, rear - ts * 0.02, w * 0.2, rear);
  ctx.bezierCurveTo(w * 0.1, rear + ts * 0.01, -w * 0.1, rear + ts * 0.01, -w * 0.2, rear);
  ctx.bezierCurveTo(-w * 0.66, rear - ts * 0.02, -w, widest + haunch, -w, widest);
  ctx.bezierCurveTo(-w * 1.0, widest - shoulder, -w * 0.66, front + ts * 0.004, 0, front);
  ctx.closePath();
}

const PROSOMA_GROOVE_COUNT = 4;

function drawProsomaDorsal(ctx: Ctx, ts: number): void {
  prosomaPath(ctx, ts);
  const domeY = (PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.36) * ts;
  const falloffY = (PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.48) * ts;
  const gradient = ctx.createRadialGradient(
    0,
    domeY,
    ts * 0.02,
    0,
    falloffY,
    PROSOMA_LENGTH * ts * 0.7,
  );
  gradient.addColorStop(0, CARAPACE_HIGHLIGHT);
  gradient.addColorStop(0.55, CARAPACE_MID);
  gradient.addColorStop(1, CARAPACE_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Pale marginal band just inside the rim.
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = CARAPACE_MARGIN_BAND;
  ctx.lineWidth = ts * 0.022;
  prosomaPath(ctx, ts);
  ctx.stroke();
  ctx.restore();

  // Raised cephalic region carrying the eyes.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = CARAPACE_HIGHLIGHT;
  ctx.beginPath();
  ctx.ellipse(
    0,
    CEPHALIC_CENTER_Y * ts,
    PROSOMA_HALF_WIDTH * ts * 0.52,
    PROSOMA_LENGTH * ts * 0.18,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

  // Thoracic fovea and the grooves radiating from it toward each coxa.
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, FOVEA_FRONT_Y * ts);
  ctx.lineTo(0, FOVEA_REAR_Y * ts);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = ts * 0.008;
  const grooveOrigin = FOVEA_FRONT_Y * ts;
  for (let i = 0; i < PROSOMA_GROOVE_COUNT; i++) {
    const spread = deg(38 + i * 30);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, grooveOrigin);
      ctx.quadraticCurveTo(
        side * Math.cos(spread) * PROSOMA_HALF_WIDTH * ts * 0.42,
        grooveOrigin + Math.sin(spread) * ts * 0.02 - ts * 0.03,
        side * Math.cos(spread) * PROSOMA_HALF_WIDTH * ts * 0.9,
        grooveOrigin - ts * 0.05 + Math.sin(spread) * ts * 0.06,
      );
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.014;
  prosomaPath(ctx, ts);
  ctx.stroke();
}

const STERNUM_HALF_WIDTH = 0.072;
const STERNUM_FRONT_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.34;
const STERNUM_REAR_Y = PROSOMA_FRONT_Y + PROSOMA_LENGTH * 0.85;
const VENTRAL_COXA_COUNT = 4;

function drawProsomaVentral(ctx: Ctx, ts: number): void {
  prosomaPath(ctx, ts);
  ctx.fillStyle = VENTRAL_STERNUM_EDGE;
  ctx.fill();
  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.014;
  ctx.stroke();

  // Coxae ring the sternum where the legs socket in.
  ctx.fillStyle = VENTRAL_COXA;
  for (let i = 0; i < VENTRAL_COXA_COUNT; i++) {
    const def = LEGS[i];
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * def.attachX * ts * 0.72,
        def.attachY * ts * 0.9,
        ts * 0.042,
        ts * 0.03,
        side * deg(20),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }

  // Sternum: the pale heart-shaped plate, pointed toward the rear.
  const halfWidth = STERNUM_HALF_WIDTH * ts;
  const front = STERNUM_FRONT_Y * ts;
  const rear = STERNUM_REAR_Y * ts;
  ctx.beginPath();
  ctx.moveTo(0, rear);
  ctx.bezierCurveTo(halfWidth * 0.9, rear - ts * 0.06, halfWidth, front + ts * 0.05, 0, front);
  ctx.bezierCurveTo(-halfWidth, front + ts * 0.05, -halfWidth * 0.9, rear - ts * 0.06, 0, rear);
  ctx.closePath();
  ctx.fillStyle = VENTRAL_STERNUM;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = VENTRAL_STERNUM_EDGE;
  ctx.lineWidth = ts * 0.01;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Labium and mouthparts at the front of the sternum.
  ctx.fillStyle = VENTRAL_STERNUM_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, front - ts * 0.03, ts * 0.032, ts * 0.026, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Abdomen (opisthosoma) ────────────────────────────────────────────────────

function abdomenPath(ctx: Ctx, ts: number): void {
  const w = ABDOMEN_HALF_WIDTH * ts;
  const front = ABDOMEN_FRONT_Y * ts;
  const rear = ABDOMEN_REAR_Y * ts;
  const widest = ABDOMEN_WIDEST_Y * ts;

  ctx.beginPath();
  ctx.moveTo(0, front);
  ctx.bezierCurveTo(w * 0.62, front + ts * 0.02, w, widest - ts * 0.09, w, widest);
  ctx.bezierCurveTo(w, widest + ts * 0.16, w * 0.52, rear - ts * 0.02, 0, rear);
  ctx.bezierCurveTo(-w * 0.52, rear - ts * 0.02, -w, widest + ts * 0.16, -w, widest);
  ctx.bezierCurveTo(-w, widest - ts * 0.09, -w * 0.62, front + ts * 0.02, 0, front);
  ctx.closePath();
}

const FOLIUM_LOBE_COUNT = 4;
const FOLIUM_FRONT_Y = 0.06;
const FOLIUM_REAR_Y = 0.5;
const FOLIUM_HALF_WIDTH = 0.115;
const SIGILLA_COUNT = 3;
const CHEVRON_COUNT = 3;
const ABDOMEN_HAIR_COUNT = 30;

/** The scalloped leaf-shaped dorsal mark almost every ground spider carries. */
function drawFolium(ctx: Ctx, ts: number): void {
  const front = FOLIUM_FRONT_Y * ts;
  const rear = FOLIUM_REAR_Y * ts;
  const span = rear - front;

  ctx.beginPath();
  ctx.moveTo(0, front);
  for (const side of [1, -1]) {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= FOLIUM_LOBE_COUNT; i++) {
      const t = i / FOLIUM_LOBE_COUNT;
      const taper = Math.sin(Math.PI * Math.pow(t, 0.7));
      const lobe = i % 2 === 0 ? 1 : 0.55;
      points.push([side * FOLIUM_HALF_WIDTH * ts * taper * lobe, front + span * t]);
    }
    if (side === 1) {
      for (const [px, py] of points) ctx.lineTo(px, py);
    } else {
      for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i][0], points[i][1]);
    }
  }
  ctx.closePath();

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ABDOMEN_FOLIUM;
  ctx.fill();
  ctx.restore();
}

function drawAbdomenDorsal(ctx: Ctx, ts: number): void {
  abdomenPath(ctx, ts);
  const gradient = ctx.createRadialGradient(0, ts * 0.18, ts * 0.02, 0, ts * 0.24, ts * 0.32);
  gradient.addColorStop(0, ABDOMEN_HIGHLIGHT);
  gradient.addColorStop(0.6, ABDOMEN_MID);
  gradient.addColorStop(1, ABDOMEN_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.save();
  ctx.clip();

  drawFolium(ctx, ts);

  // Pale cardiac mark riding the front of the folium.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ABDOMEN_PALE;
  ctx.beginPath();
  ctx.moveTo(0, ts * 0.05);
  ctx.quadraticCurveTo(ts * 0.03, ts * 0.12, 0, ts * 0.21);
  ctx.quadraticCurveTo(-ts * 0.03, ts * 0.12, 0, ts * 0.05);
  ctx.closePath();
  ctx.fill();

  // Sigilla — the paired muscle-attachment dimples.
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = ABDOMEN_EDGE;
  for (let i = 0; i < SIGILLA_COUNT; i++) {
    const y = ts * (0.14 + i * 0.09);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * ts * 0.048, y, ts * 0.013, ts * 0.009, 0, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Pale chevrons stacked toward the spinnerets.
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = ABDOMEN_PALE;
  ctx.lineWidth = ts * 0.012;
  ctx.lineCap = 'round';
  for (let i = 0; i < CHEVRON_COUNT; i++) {
    const y = ts * (0.35 + i * 0.06);
    const halfWidth = ts * (0.105 - i * 0.022);
    ctx.beginPath();
    ctx.moveTo(-halfWidth, y);
    ctx.lineTo(0, y - ts * 0.05);
    ctx.lineTo(halfWidth, y);
    ctx.stroke();
  }
  ctx.restore();

  // Bristles standing off the silhouette.
  ctx.save();
  ctx.strokeStyle = SETA_COLOR;
  ctx.lineWidth = Math.max(0.6, ts * 0.007);
  ctx.lineCap = 'round';
  for (let i = 0; i < ABDOMEN_HAIR_COUNT; i++) {
    const angle = (i / ABDOMEN_HAIR_COUNT) * TWO_PI;
    const rx = ABDOMEN_HALF_WIDTH * ts;
    const ry = ((ABDOMEN_REAR_Y - ABDOMEN_FRONT_Y) / 2) * ts;
    const cy = ((ABDOMEN_REAR_Y + ABDOMEN_FRONT_Y) / 2) * ts;
    const px = Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    const hairLength = ts * (0.035 + hashRandom(i * 13) * 0.03);
    ctx.beginPath();
    ctx.moveTo(px * 0.94, cy + (py - cy) * 0.94);
    ctx.lineTo(px + Math.cos(angle) * hairLength, py + Math.sin(angle) * hairLength);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  abdomenPath(ctx, ts);
  ctx.stroke();
}

const BOOK_LUNG_Y = 0.11;
const EPIGASTRIC_FURROW_Y = 0.15;

function drawAbdomenVentral(ctx: Ctx, ts: number): void {
  abdomenPath(ctx, ts);
  const gradient = ctx.createRadialGradient(0, ts * 0.2, ts * 0.02, 0, ts * 0.24, ts * 0.32);
  gradient.addColorStop(0, VENTRAL_BELLY);
  gradient.addColorStop(1, VENTRAL_BELLY_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Book-lung covers flanking the epigastric furrow.
  ctx.fillStyle = VENTRAL_BOOK_LUNG;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * ts * 0.095, ts * BOOK_LUNG_Y, ts * 0.045, ts * 0.03, 0, 0, TWO_PI);
    ctx.fill();
  }

  ctx.strokeStyle = VENTRAL_FURROW;
  ctx.lineWidth = ts * 0.014;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-ts * 0.14, ts * EPIGASTRIC_FURROW_Y);
  ctx.quadraticCurveTo(0, ts * (EPIGASTRIC_FURROW_Y + 0.02), ts * 0.14, ts * EPIGASTRIC_FURROW_Y);
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.lineWidth = ts * 0.01;
  ctx.beginPath();
  ctx.moveTo(0, ts * (EPIGASTRIC_FURROW_Y + 0.02));
  ctx.lineTo(0, ts * 0.5);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  abdomenPath(ctx, ts);
  ctx.stroke();
}

const SPINNERET_PAIRS: readonly (readonly [number, number, number, number])[] = [
  [0.028, 0.555, 0.02, 0.038],
  [0.062, 0.525, 0.016, 0.03],
];

function drawSpinnerets(ctx: Ctx, ts: number, ventral: boolean): void {
  ctx.fillStyle = ventral ? VENTRAL_BELLY_EDGE : ABDOMEN_EDGE;
  for (const [offsetX, offsetY, halfWidth, length] of SPINNERET_PAIRS) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * offsetX * ts,
        offsetY * ts,
        halfWidth * ts,
        length * ts,
        side * deg(14),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }
}

/** Bridges the gap the two tagmata leave between them; the pinch is the waist. */
function drawPedicel(ctx: Ctx, ts: number, ventral: boolean): void {
  const centerY = (PROSOMA_REAR_Y + ABDOMEN_FRONT_Y) / 2;
  const halfLength = (PROSOMA_REAR_Y - ABDOMEN_FRONT_Y) / 2;
  ctx.fillStyle = ventral ? VENTRAL_BELLY_EDGE : CARAPACE_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, centerY * ts, PEDICEL_HALF_WIDTH * ts, halfLength * ts, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Eyes, chelicerae, pedipalps ──────────────────────────────────────────────

interface EyeDef {
  readonly x: number;
  /** Distance behind the front edge of the carapace, so the group rides the clypeus. */
  readonly depth: number;
  readonly r: number;
}

/**
 * Lycosid eye group: a front row of four small eyes, a pair of large posterior
 * median eyes above them, and two posterior laterals set wide on the carapace.
 * The whole group stays tight — spread it and the face starts reading mammalian.
 */
const EYES: readonly EyeDef[] = [
  { x: 0.021, depth: 0.029, r: 0.0115 },
  { x: 0.056, depth: 0.037, r: 0.0105 },
  { x: 0.042, depth: 0.079, r: 0.0245 },
  { x: 0.078, depth: 0.127, r: 0.0165 },
];

function drawEyes(ctx: Ctx, ts: number, shine: number): void {
  for (const eye of EYES) {
    for (const side of [-1, 1]) {
      const ex = side * eye.x * ts;
      const ey = (PROSOMA_FRONT_Y + eye.depth) * ts;
      const er = eye.r * ts;

      ctx.fillStyle = EYE_RING;
      ctx.beginPath();
      ctx.arc(ex, ey, er * 1.22, 0, TWO_PI);
      ctx.fill();

      if (shine > 0) {
        ctx.save();
        ctx.globalAlpha = shine;
        ctx.fillStyle = EYE_SHINE_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, er * 1.05, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = EYE_DARK;
      ctx.beginPath();
      ctx.arc(ex, ey, er * (shine > 0 ? 0.78 : 1), 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = EYE_GLINT;
      ctx.beginPath();
      ctx.arc(ex - er * 0.3, ey - er * 0.32, er * 0.28, 0, TWO_PI);
      ctx.fill();
    }
  }
}

const CHELICERA_ATTACH_X = 0.056;
const CHELICERA_ATTACH_Y = PROSOMA_FRONT_Y + 0.062;
const CHELICERA_LENGTH = 0.098;
const CHELICERA_HALF_WIDTH = 0.042;
const CHELICERA_REST_ANGLE_DEG = -84;
const CHELICERA_SPREAD_DEG = 26;
/** How far the whole jaw pushes out past the carapace when it gapes. */
const CHELICERA_EXTEND = 0.045;
const FANG_LENGTH = 0.07;
const FANG_REST_FOLD = 0.3;
const FANG_SWING_DEG = 96;

function drawChelicerae(ctx: Ctx, ts: number, open: number): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);

    const baseX = CHELICERA_ATTACH_X * ts;
    const baseY = (CHELICERA_ATTACH_Y - CHELICERA_EXTEND * open) * ts;
    const angle = deg(CHELICERA_REST_ANGLE_DEG + open * CHELICERA_SPREAD_DEG);
    const tipX = baseX + Math.cos(angle) * CHELICERA_LENGTH * ts;
    const tipY = baseY + Math.sin(angle) * CHELICERA_LENGTH * ts;

    taperedSegment(
      ctx,
      baseX,
      baseY,
      tipX,
      tipY,
      CHELICERA_HALF_WIDTH * ts,
      CHELICERA_HALF_WIDTH * ts * 0.62,
      FANG_BASE,
    );
    segmentSheen(ctx, baseX, baseY, tipX, tipY, CHELICERA_HALF_WIDTH * ts * 0.5, 0.28);

    // At rest the fang folds back under the chelicera; opening swings it out.
    const fangAngle = angle + deg(FANG_SWING_DEG * (1 - open));
    const fangLength = FANG_LENGTH * ts * lerp(FANG_REST_FOLD, 1, open);
    const jointX = tipX;
    const jointY = tipY;
    const curveX = jointX + Math.cos(fangAngle - deg(18)) * fangLength * 0.6;
    const curveY = jointY + Math.sin(fangAngle - deg(18)) * fangLength * 0.6;
    const fangTipX = jointX + Math.cos(fangAngle) * fangLength;
    const fangTipY = jointY + Math.sin(fangAngle) * fangLength;

    taperedSegment(
      ctx,
      jointX,
      jointY,
      curveX,
      curveY,
      CHELICERA_HALF_WIDTH * ts * 0.5,
      CHELICERA_HALF_WIDTH * ts * 0.3,
      FANG_TIP,
    );
    taperedSegment(
      ctx,
      curveX,
      curveY,
      fangTipX,
      fangTipY,
      CHELICERA_HALF_WIDTH * ts * 0.3,
      ts * 0.004,
      FANG_TIP,
    );

    ctx.restore();
  }
}

// The palps read as a stubby fifth pair of arms held out in front of the fangs.
// Without them the front of the carapace is bare and the leading legs get read
// as antennae instead.
const PALP_ATTACH_X = 0.088;
const PALP_ATTACH_Y = PROSOMA_FRONT_Y + 0.07;
const PALP_FEMUR = 0.078;
const PALP_TARSUS = 0.062;
const PALP_FEMUR_ANGLE_DEG = -104;
const PALP_TARSUS_ANGLE_DEG = -74;

function drawPedipalps(ctx: Ctx, ts: number, swingDegrees: number): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);

    const baseX = PALP_ATTACH_X * ts;
    const baseY = PALP_ATTACH_Y * ts;
    const femurAngle = deg(PALP_FEMUR_ANGLE_DEG + swingDegrees);
    const kneeX = baseX + Math.cos(femurAngle) * PALP_FEMUR * ts;
    const kneeY = baseY + Math.sin(femurAngle) * PALP_FEMUR * ts;
    const tarsusAngle = deg(PALP_TARSUS_ANGLE_DEG + swingDegrees * 1.4);
    const tipX = kneeX + Math.cos(tarsusAngle) * PALP_TARSUS * ts;
    const tipY = kneeY + Math.sin(tarsusAngle) * PALP_TARSUS * ts;

    taperedSegment(ctx, baseX, baseY, kneeX, kneeY, ts * 0.019, ts * 0.015, LEG_MID);
    taperedSegment(ctx, kneeX, kneeY, tipX, tipY, ts * 0.015, ts * 0.017, LEG_DARK);
    drawSetae(ctx, kneeX, kneeY, tipX, tipY, ts * 0.03, side * 97, Math.max(0.6, ts * 0.006));

    ctx.restore();
  }
}

// ── Whole-spider assembly ────────────────────────────────────────────────────

const SHADOW_RX = 0.4;
const SHADOW_RY = 0.42;
const SHADOW_CENTER_Y = 0.08;
/** Never squash the body to nothing while it rolls edge-on. */
const MIN_ROLL_SCALE = 0.07;

function drawShadow(ctx: Ctx, ts: number, pose: SpiderPose): void {
  if (pose.shadowAlpha <= 0) return;
  const rx = SHADOW_RX * ts * pose.shadowScale;
  const ry = SHADOW_RY * ts * pose.shadowScale;
  const gradient = ctx.createRadialGradient(
    0,
    SHADOW_CENTER_Y * ts,
    0,
    0,
    SHADOW_CENTER_Y * ts,
    ry,
  );
  gradient.addColorStop(0, SHADOW_COLOR);
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.save();
  ctx.globalAlpha = pose.shadowAlpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, SHADOW_CENTER_Y * ts, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export function drawSpider(ctx: Ctx, cx: number, cy: number, ts: number, pose: SpiderPose): void {
  ctx.save();
  ctx.translate(cx, cy);

  drawShadow(ctx, ts, pose);

  ctx.rotate(pose.spin);
  const rollScaleX = Math.max(MIN_ROLL_SCALE, Math.abs(Math.cos(pose.roll)));
  ctx.scale(rollScaleX * pose.bodyScale, pose.bodyScale);

  const ventral = pose.roll > HALF_PI;

  const drawLegs = () => {
    for (let i = 0; i < TOTAL_LEGS; i++) {
      const side = i < FIRST_LEFT_LEG ? 1 : -1;
      drawLeg(ctx, ts, side, LEGS[i % LEG_COUNT_PER_SIDE], pose.legs[i], ventral);
    }
  };

  // Upright, the legs socket in under the carapace; on its back the curled legs
  // fold over the belly and read in front of it.
  if (!ventral) drawLegs();

  ctx.save();
  ctx.translate(pose.abdomenSway * ts, 0);
  ctx.scale(pose.abdomenScale, pose.abdomenScale);
  if (ventral) drawAbdomenVentral(ctx, ts);
  else drawAbdomenDorsal(ctx, ts);
  drawSpinnerets(ctx, ts, ventral);
  ctx.restore();

  drawPedicel(ctx, ts, ventral);

  ctx.save();
  ctx.translate(0, pose.prosomaSink * ts);
  if (ventral) {
    drawProsomaVentral(ctx, ts);
  } else {
    // Mouthparts go down before the carapace so it overlaps their bases the way
    // a real spider's does — only the working ends clear the front edge.
    drawPedipalps(ctx, ts, pose.palpSwing);
    drawChelicerae(ctx, ts, pose.fangOpen);
    drawProsomaDorsal(ctx, ts);
    drawEyes(ctx, ts, pose.eyeShine);
  }
  ctx.restore();

  if (ventral) drawLegs();

  ctx.restore();
}
