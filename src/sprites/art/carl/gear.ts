/**
 * The canon gear Carl can be seen wearing: the War Gauntlet of the Exalted
 * Grull on his right wrist, the Nightgaunt Cloak off his shoulders, the
 * trollskin shirt's band at his neckline, the Splatter Skunk toe ring and the
 * shine a pedicure leaves on his feet.
 *
 * What he wears arrives on the pose (`CarlPose.gear`) rather than being read
 * from anywhere, so a cell stays a pure function of its row and frame: each
 * combination of gear is a figure of its own, painted from the same rows with
 * a different `gear` laid on every pose.
 */

import { HALF_PI, mixPt, pt, TWO_PI } from './geometry';
import { handHalfWidth, handLength, wristAngle } from './limbs';
import { type FootAccents } from './feet';
import { shadeForm } from './paint';
import { type Ramp } from './palette';
import { NECK_WIDTH, WRIST_WIDTH } from './proportions';
import {
  type BodySide,
  type BoneChain,
  type CarlPose,
  drawnSide,
  type HandShape,
  type Skeleton,
  type ViewSpec,
} from './rig';
import { clamp01, lerp, mix, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse } from '../softShade';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;
/** A cast shadow falls down and to the right of what casts it, away from the key. */
const SHADOW_FALL_X = 0.025;
const SHADOW_FALL_Y = 0.03;

// ── What he wears ────────────────────────────────────────────────────────────

/**
 * What the gauntlet on his right wrist is on one frame.
 *
 * - `bracer`: the charcoal wrist bracer it is at rest.
 * - `spiked`: the spiked hunk of orcish steel it becomes round a tight fist.
 * - `smoke`: the bracer again, in the puff of smoke the steel vanishes in as
 *   the fist relaxes.
 * - `wisp`: the bracer, the puff a frame later — risen, thinning.
 */
export type GauntletForm = 'bracer' | 'spiked' | 'smoke' | 'wisp';

/** The gear painted on one pose. An absent field is gear he is not wearing. */
export interface CarlGear {
  readonly gauntlet?: GauntletForm;
  readonly cloak?: boolean;
  /** The trollskin shirt, which shows only as a dark band above the jacket's collar. */
  readonly trollskinShirt?: boolean;
  readonly toeRing?: boolean;
  readonly pedicure?: boolean;
  /**
   * How hard the air of his own travel pushes the cloak back, 0 to 1, in
   * profile: a spring cannot supply this, because it is a steady drag rather
   * than an oscillation about the body.
   */
  readonly cloakStream?: number;
}

/**
 * The look a pose with no `gear` is painted in: the trollskin shirt and
 * nothing else. It is the figure every row was authored and reviewed against,
 * so an absent `gear` must not strip the shirt's band from the neckline.
 */
const DEFAULT_CARL_GEAR: CarlGear = { trollskinShirt: true };

export function gearOf(pose: CarlPose): CarlGear {
  return pose.gear ?? DEFAULT_CARL_GEAR;
}

// ── Nightgaunt Cloak ─────────────────────────────────────────────────────────

/**
 * Black leather with a violet cast, so its shadows stay a colour rather than
 * a hole: at the tile a pure black cloak on the near-black dungeon floor is a
 * missing piece of the figure, and the value steps are what let the ribs and
 * the scallops read at all.
 */
const CLOAK: Ramp = {
  deep: '#08070b',
  shadow: '#0f0c13',
  dark: '#16121b',
  mid: '#1d1824',
  base: '#241e2c',
  light: '#362d41',
  rim: '#51445e',
};
/**
 * The bone of the fingers the leather is stretched over: a dull, dark ivory,
 * well under the skin's value so the ribs read as ridges in the leather and
 * not as white stripes painted on it.
 */
const FINGERBONE = '#8a7d8f';
const FINGERBONE_LIT = '#b2a4b5';
/**
 * The lit edge down the cloak's key side and along its scallops. On the
 * darkest floor the rim, not the fill, is what draws the cloak's outline.
 */
const CLOAK_RIM = '#7d6d8c';
const CLOAK_RIM_ALPHA = 0.75;
const CLOAK_RIM_WIDTH = 0.028;
/**
 * The key-lit edge is stroked inside the cloak's own clip, which hides the
 * outer half of the line; doubled, it shows as wide as the hood's unclipped rim.
 */
const CLOAK_LIT_EDGE_WIDTH = CLOAK_RIM_WIDTH * 2;

/**
 * The cloak hangs from his shoulders to his calves, whatever the pose does
 * with his spine: its length is measured straight down from the shoulders.
 */
const CLOAK_LENGTH = 1.12;
/** The hem never passes through the floor; a crouch lays it on the floor instead. */
const HEM_FLOOR_CLEARANCE = 0.03;
/**
 * Seen square on, the hem flares to this half-width — past his shoulders, so
 * the cloak shows as a dark wedge either side of his arms, which is the
 * silhouette that says "cloak" at the tile.
 */
const FACING_HEM_HALF = 0.56;
/** Where it leaves the shoulders, as a share of his shoulder half-width. */
const FACING_ATTACH_SHARE = 0.96;
const FACING_ATTACH_DROP = -0.05;
/** The sides belly outward a little between shoulder and hem, as cloth under its own weight does. */
const FACING_SIDE_BELLY = 0.05;
/** The rib tips across the hem: the fingers of the wing. */
const FACING_RIB_TIPS = 5;
/** The outer tips sweep up, the way a bat's wing rises to its outer fingers. */
const OUTER_TIP_RISE = 0.2;
/** How deep each scallop of membrane arcs up between two finger tips. */
const SCALLOP_DEPTH = 0.12;
/** A quadratic only reaches halfway to its control point. */
const QUAD_CONTROL_REACH = 2;
/**
 * The stand collar behind his neck: seen from the front it is the cloak's
 * only part that shows above his shoulders, a dark band either side of the
 * neck; from behind it is the neckline the hood hangs from.
 */
const FRONT_COLLAR_HALF = NECK_WIDTH * 1.9;
const BACK_COLLAR_HALF = NECK_WIDTH * 1.45;
const FRONT_COLLAR_RISE = 0.22;
const BACK_COLLAR_RISE = 0.09;
/** The hub each finger radiates from is pulled this far in from the shoulder toward the collar. */
const RIB_HUB_PULL = 0.35;
/** Fingers bow outward along their length, like the long bones of a wing. */
const RIB_BOW = 0.06;
const RIB_WIDTH = 0.04;
const RIB_HIGHLIGHT_WIDTH = 0.012;
/** The two knuckles along each finger, as shares of its length. */
const KNUCKLES_AT: readonly number[] = [0.45, 0.72];
const KNUCKLE_RADIUS = 0.022;
/** Between two fingers the membrane sags into a darker pocket. */
const MEMBRANE_SAG_AT = 0.62;
const MEMBRANE_SAG_ALPHA = 0.6;
const MEMBRANE_SAG_WIDTH_SHARE = 0.3;
const MEMBRANE_SAG_LENGTH_SHARE = 0.3;
const CLOAK_SOFTNESS = 1.6;
const CLOAK_CONTRAST = 0.85;
/**
 * The inside of the cloak, seen past his body from the front: a step lighter
 * than the outside. Head-on the cloak shows mostly as slivers between his arms
 * and his body, and a sliver of the outside's near-black there is exactly
 * what an ink line round the arm looks like; the lighter lining reads as
 * material instead.
 */
const LINING: Ramp = {
  deep: '#141019',
  shadow: '#1f1926',
  dark: '#2a2233',
  mid: '#362c40',
  base: '#43384e',
  light: '#574a63',
  rim: '#72627f',
};

/**
 * The spring lag the choreography gives the jacket hem is scaled up for the
 * cloak's: a longer, looser pendulum swings wider behind the same body.
 */
const CLOAK_LAG_GAIN = 3;
/** How far, and how high, a full stream carries the hem behind him in profile. */
const STREAM_BACK = 0.34;
const STREAM_LIFT = 0.16;
/** Displacement grows down the cloak by this power of the share of its length. */
const LAG_FALLOFF = 1.6;

/** Profile: the cloak hangs behind him, from the back of his shoulder. */
const PROFILE_COLLAR = pt(-0.1, -0.12);
const PROFILE_BACK_ATTACH = pt(-0.16, 0.04);
const PROFILE_FRONT_ATTACH = pt(0.04, 0.02);
/** Hem tips from the front of the drape to its trailing edge, as offsets behind his shoulders. */
const PROFILE_TIP_BEHIND: readonly number[] = [-0.04, -0.24, -0.44, -0.62];
/** The trailing tips ride higher, the wing's edge sweeping up behind him. */
const PROFILE_TIP_RISE: readonly number[] = [0, 0.03, 0.08, 0.16];
/** The trailing edge bows out behind his back on its way down. */
const PROFILE_BACK_BELLY = pt(-0.34, 0.32);
const PROFILE_FRONT_BELLY = pt(-0.08, 0.5);

/**
 * The most of the cloak that spreads on the floor. A man lying flat has
 * nearly all of it under him; spread out past him it would run off the cell.
 */
const MAX_POOLED_LENGTH = 0.35;

/**
 * The share of the length on the floor that spreads the hem out across it
 * rather than piling up: cloth settles into a spread, not a heap.
 */
const POOL_SPREAD = 0.8;

/** The hood, down, hanging at the top of his back. */
const HOOD_HALF_WIDTH = 0.19;
const HOOD_DEPTH = 0.3;
/**
 * The hood's pointed ears stand up off its crumpled crown at the nape, either
 * side of his neck. Hanging down the hood as a lowered hood's would, they sit
 * inside the cloak's own dark and never show; standing clear of the shoulder
 * line they are the one feature that says "nightgaunt" from behind.
 */
const HOOD_EAR_LENGTH = 0.2;
const HOOD_EAR_SPREAD = 0.75;
const HOOD_EAR_BASE = 0.065;
/** The ears splay outward from the crown, as a bat's do. */
const HOOD_EAR_SPLAY = 0.45;
const HOOD_SHADOW_ALPHA = 0.55;
const PROFILE_HOOD_CENTRE = pt(-0.17, 0.08);
const PROFILE_HOOD_RADIUS_X = 0.085;
const PROFILE_HOOD_RADIUS_Y = 0.12;
/** The hood's leather: the cloak's own, a step up the ramp. */
const HOOD: Ramp = {
  deep: CLOAK.dark,
  shadow: CLOAK.mid,
  dark: CLOAK.base,
  mid: CLOAK.light,
  base: CLOAK.rim,
  light: CLOAK_RIM,
  rim: FINGERBONE_LIT,
};
const HOOD_MOUTH_WIDTH = 0.7;
const HOOD_MOUTH_DEPTH = 0.3;
const HOOD_MOUTH_ALPHA = 0.9;

interface CloakRib {
  readonly hub: Pt;
  readonly bow: Pt;
  readonly tip: Pt;
}

/** The cloak's silhouette and the fingers inside it, in figure space. */
interface CloakShape {
  /** Builds the closed silhouette path; begins its own path. */
  readonly trace: (ctx: Ctx) => void;
  /** Opens a path along the edge the key light rims. */
  readonly litEdge: (ctx: Ctx) => void;
  readonly ribs: readonly CloakRib[];
  readonly top: Pt;
  readonly hemCentre: Pt;
  readonly halfWidth: number;
  /** Every point the silhouette's curves run through or toward, for the layer bounds. */
  readonly extent: readonly Pt[];
}

/** How far the hem hangs off where the body would carry it. */
function hemLag(pose: CarlPose, view: ViewSpec, gear: CarlGear): Pt {
  const lag = pose.jacketHemLag ?? pt(0, 0);
  const stream = view.profile ? clamp01(gear.cloakStream ?? 0) : 0;
  return pt(
    lag.x * CLOAK_LAG_GAIN - stream * STREAM_BACK,
    lag.y * CLOAK_LAG_GAIN - stream * STREAM_LIFT,
  );
}

/** Moves `p` by the hem's lag in proportion to how far down the cloak it hangs. */
function lagged(p: Pt, top: number, hemY: number, lag: Pt): Pt {
  const share = clamp01((p.y - top) / Math.max(hemY - top, HEM_FLOOR_CLEARANCE));
  const weight = Math.pow(share, LAG_FALLOFF);
  return pt(p.x + lag.x * weight, p.y + lag.y * weight);
}

function hemLine(skeleton: Skeleton): number {
  return Math.min(skeleton.shoulderCentre.y + CLOAK_LENGTH, -HEM_FLOOR_CLEARANCE);
}

/**
 * How much of the cloak's length lies on the floor, when his shoulders are
 * lower than the cloak is long: kneeling, crouched, down on the ground.
 */
function pooledLength(skeleton: Skeleton): number {
  const onFloor = skeleton.shoulderCentre.y + CLOAK_LENGTH + HEM_FLOOR_CLEARANCE;
  return clamp01(onFloor / MAX_POOLED_LENGTH) * MAX_POOLED_LENGTH;
}

/** Traces scallops from `tips[0]` to the last tip, each arcing up between two fingers. */
function traceScallops(ctx: Ctx, tips: readonly Pt[]): void {
  for (let i = 1; i < tips.length; i++) {
    const a = tips[i - 1];
    const b = tips[i];
    const mid = mixPt(a, b, HALF);
    ctx.quadraticCurveTo(mid.x, mid.y - SCALLOP_DEPTH * QUAD_CONTROL_REACH, b.x, b.y);
  }
}

function facingCloak(
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
  gear: CarlGear,
): CloakShape {
  const sc = skeleton.shoulderCentre;
  const hemY = hemLine(skeleton);
  const hemHalf = FACING_HEM_HALF + pooledLength(skeleton) * POOL_SPREAD;
  const lag = hemLag(pose, view, gear);
  const collarRise = view.showsBack ? BACK_COLLAR_RISE : FRONT_COLLAR_RISE;
  const collarHalf = view.showsBack ? BACK_COLLAR_HALF : FRONT_COLLAR_HALF;
  const top = sc.y - collarRise;
  const at = (p: Pt): Pt => lagged(p, top, hemY, lag);

  const attachHalf = skeleton.shoulderHalf * FACING_ATTACH_SHARE;
  const collarLeft = pt(sc.x - collarHalf, top);
  const collarRight = pt(sc.x + collarHalf, top);
  const attachLeft = pt(sc.x - attachHalf, sc.y + FACING_ATTACH_DROP);
  const attachRight = pt(sc.x + attachHalf, sc.y + FACING_ATTACH_DROP);

  const tips: Pt[] = [];
  for (let i = 0; i < FACING_RIB_TIPS; i++) {
    const across = lerp(-1, 1, i / (FACING_RIB_TIPS - 1));
    tips.push(at(pt(sc.x + across * hemHalf, hemY - OUTER_TIP_RISE * across * across)));
  }
  const first = tips[0];
  const last = tips[tips.length - 1];
  const bellyLeft = at(
    pt(lerp(attachLeft.x, first.x, HALF) - FACING_SIDE_BELLY, lerp(attachLeft.y, first.y, HALF)),
  );
  const bellyRight = at(
    pt(lerp(attachRight.x, last.x, HALF) + FACING_SIDE_BELLY, lerp(attachRight.y, last.y, HALF)),
  );

  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.moveTo(collarLeft.x, collarLeft.y);
    ctx.lineTo(collarRight.x, collarRight.y);
    ctx.lineTo(attachRight.x, attachRight.y);
    ctx.quadraticCurveTo(bellyRight.x, bellyRight.y, last.x, last.y);
    traceScallops(ctx, [...tips].reverse());
    ctx.quadraticCurveTo(bellyLeft.x, bellyLeft.y, attachLeft.x, attachLeft.y);
    ctx.closePath();
  };
  const litEdge = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.moveTo(attachLeft.x, attachLeft.y);
    ctx.quadraticCurveTo(bellyLeft.x, bellyLeft.y, first.x, first.y);
    traceScallops(ctx, tips);
  };

  const collarMid = pt(sc.x, top);
  const ribs = tips.map((tip, i): CloakRib => {
    const across = lerp(-1, 1, i / (FACING_RIB_TIPS - 1));
    const shoulder = across < 0 ? attachLeft : attachRight;
    const hub = mixPt(collarMid, shoulder, Math.abs(across) * (1 - RIB_HUB_PULL));
    const mid = mixPt(hub, tip, HALF);
    return { hub, bow: pt(mid.x + across * RIB_BOW, mid.y), tip };
  });

  return {
    trace,
    litEdge,
    ribs,
    top: collarMid,
    hemCentre: pt(sc.x + lag.x, hemY),
    halfWidth: hemHalf,
    extent: [collarLeft, collarRight, attachLeft, attachRight, bellyLeft, bellyRight, ...tips],
  };
}

function profileCloak(
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
  gear: CarlGear,
): CloakShape {
  const sc = skeleton.shoulderCentre;
  const hemY = hemLine(skeleton);
  const lag = hemLag(pose, view, gear);
  const collar = pt(sc.x + PROFILE_COLLAR.x, sc.y + PROFILE_COLLAR.y);
  const at = (p: Pt): Pt => lagged(p, collar.y, hemY, lag);
  const backAttach = pt(sc.x + PROFILE_BACK_ATTACH.x, sc.y + PROFILE_BACK_ATTACH.y);
  const frontAttach = pt(sc.x + PROFILE_FRONT_ATTACH.x, sc.y + PROFILE_FRONT_ATTACH.y);

  const pooled = pooledLength(skeleton) * POOL_SPREAD;
  const tips = PROFILE_TIP_BEHIND.map((behind, i) => {
    // What lies on the floor spreads out behind him, the trailing edge
    // furthest, and a hem lying flat on the floor has no edge left to lift.
    const spread = pooled * (i / (PROFILE_TIP_BEHIND.length - 1));
    const rise = pooled > 0 ? 0 : PROFILE_TIP_RISE[i];
    return at(pt(sc.x + behind - spread, hemY - rise));
  });
  const front = tips[0];
  const trailing = tips[tips.length - 1];
  const backBelly = at(pt(sc.x + PROFILE_BACK_BELLY.x, sc.y + PROFILE_BACK_BELLY.y));
  const frontBelly = at(pt(sc.x + PROFILE_FRONT_BELLY.x, sc.y + PROFILE_FRONT_BELLY.y));

  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.moveTo(frontAttach.x, frontAttach.y);
    ctx.quadraticCurveTo(frontBelly.x, frontBelly.y, front.x, front.y);
    traceScallops(ctx, tips);
    ctx.quadraticCurveTo(backBelly.x, backBelly.y, collar.x, collar.y);
    ctx.closePath();
  };
  const litEdge = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.moveTo(collar.x, collar.y);
    ctx.quadraticCurveTo(backBelly.x, backBelly.y, trailing.x, trailing.y);
    traceScallops(ctx, [...tips].reverse());
  };

  const ribs = tips.map((tip): CloakRib => {
    const hub = backAttach;
    const mid = mixPt(hub, tip, HALF);
    return { hub, bow: pt(mid.x - RIB_BOW, mid.y), tip };
  });

  return {
    trace,
    litEdge,
    ribs,
    top: collar,
    hemCentre: mixPt(front, trailing, HALF),
    halfWidth: Math.abs(trailing.x - front.x) * HALF,
    extent: [collar, backAttach, frontAttach, backBelly, frontBelly, ...tips],
  };
}

function cloakShape(
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
  gear: CarlGear,
): CloakShape {
  return view.profile
    ? profileCloak(skeleton, pose, view, gear)
    : facingCloak(skeleton, pose, view, gear);
}

/**
 * Seen from behind the cloak covers his back; facing the camera and in
 * profile it hangs behind him.
 */
export function cloakInFront(view: ViewSpec): boolean {
  return view.showsBack && !view.profile;
}

/**
 * How the fingerbones are painted: a bone stroke, and — where they are seen
 * whole — a lit ridge down each and a lit knuckle at each joint.
 */
interface BonePaint {
  readonly bone: string;
  readonly lit: string | null;
}

const LIT_BONES: BonePaint = { bone: FINGERBONE, lit: FINGERBONE_LIT };
/** The bone and its ridge as the one tone they average to across the bone's width. */
const PLAIN_BONES: BonePaint = {
  bone: mix(FINGERBONE, FINGERBONE_LIT, RIB_HIGHLIGHT_WIDTH / RIB_WIDTH),
  lit: null,
};

function paintRibs(ctx: Ctx, ribs: readonly CloakRib[], paint: BonePaint): void {
  const { bone, lit } = paint;
  ctx.lineCap = 'round';
  for (const rib of ribs) {
    ctx.strokeStyle = bone;
    ctx.lineWidth = RIB_WIDTH;
    ctx.beginPath();
    ctx.moveTo(rib.hub.x, rib.hub.y);
    ctx.quadraticCurveTo(rib.bow.x, rib.bow.y, rib.tip.x, rib.tip.y);
    ctx.stroke();
    if (lit === null) continue;
    ctx.strokeStyle = lit;
    ctx.lineWidth = RIB_HIGHLIGHT_WIDTH;
    ctx.stroke();
  }
  if (lit === null) return;
  ctx.fillStyle = lit;
  for (const rib of ribs) {
    for (const share of KNUCKLES_AT) {
      const knuckle = quadPoint(rib.hub, rib.bow, rib.tip, share);
      ctx.beginPath();
      ctx.arc(knuckle.x, knuckle.y, KNUCKLE_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
  }
}

function quadPoint(a: Pt, control: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return pt(
    u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  );
}

/** The dark pocket each span of membrane sags into between two fingers. */
function paintMembrane(ctx: Ctx, ribs: readonly CloakRib[], ramp: Ramp): void {
  for (let i = 1; i < ribs.length; i++) {
    const a = quadPoint(ribs[i - 1].hub, ribs[i - 1].bow, ribs[i - 1].tip, MEMBRANE_SAG_AT);
    const b = quadPoint(ribs[i].hub, ribs[i].bow, ribs[i].tip, MEMBRANE_SAG_AT);
    const centre = mixPt(a, b, HALF);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const length = Math.hypot(ribs[i].tip.x - ribs[i].hub.x, ribs[i].tip.y - ribs[i].hub.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    fillSoftEllipse(
      ctx,
      centre.x,
      centre.y,
      span * MEMBRANE_SAG_WIDTH_SHARE,
      length * MEMBRANE_SAG_LENGTH_SHARE,
      ramp.deep,
      MEMBRANE_SAG_ALPHA,
      angle,
    );
  }
}

/** The hood, down: a pouch at the top of his back, its eared crown hanging lowest. */
function paintHoodFromBehind(ctx: Ctx, collar: Pt): void {
  const bottom = collar.y + HOOD_DEPTH;
  const left = collar.x - HOOD_HALF_WIDTH;
  const right = collar.x + HOOD_HALF_WIDTH;
  const ears = [-1, 1].map((side) => {
    const root = pt(collar.x + side * HOOD_HALF_WIDTH * HOOD_EAR_SPREAD, collar.y + HOOD_EAR_BASE);
    const tip = pt(root.x + side * HOOD_EAR_LENGTH * HOOD_EAR_SPLAY, root.y - HOOD_EAR_LENGTH);
    return { root, tip };
  });
  // The rim is stroked along the open edges only: closing them would rule a
  // line across the collar and across the foot of each ear.
  const hoodEdge = (): void => {
    ctx.moveTo(left, collar.y);
    ctx.quadraticCurveTo(left, bottom, collar.x, bottom);
    ctx.quadraticCurveTo(right, bottom, right, collar.y);
  };
  const earEdges = (closed: boolean): void => {
    for (const { root, tip } of ears) {
      ctx.moveTo(root.x - HOOD_EAR_BASE, root.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(root.x + HOOD_EAR_BASE, root.y);
      if (closed) ctx.closePath();
    }
  };
  const traceHood = (): void => {
    ctx.beginPath();
    hoodEdge();
    ctx.closePath();
  };
  const traceEars = (): void => {
    ctx.beginPath();
    earEdges(true);
  };

  // The hood and its ears throw their shadow on the cloak, down and to the right.
  ctx.save();
  ctx.translate(SHADOW_FALL_X, SHADOW_FALL_Y);
  ctx.fillStyle = rgba(CLOAK.deep, HOOD_SHADOW_ALPHA);
  traceHood();
  ctx.fill();
  traceEars();
  ctx.fill();
  ctx.restore();

  // The hood is a fold standing off the cloak, so it sits a step lighter than
  // the leather it lies on; the same value would merge the two into one sheet.
  traceEars();
  ctx.fillStyle = CLOAK.rim;
  ctx.fill();
  shadeForm(ctx, traceHood, { from: collar, to: pt(collar.x, bottom) }, HOOD, {
    halfWidth: HOOD_HALF_WIDTH,
    softness: CLOAK_SOFTNESS,
  });
  // Its open mouth, round his neck, is the one deep pocket in it.
  fillSoftEllipse(
    ctx,
    collar.x,
    collar.y,
    HOOD_HALF_WIDTH * HOOD_MOUTH_WIDTH,
    HOOD_DEPTH * HOOD_MOUTH_DEPTH,
    CLOAK.deep,
    HOOD_MOUTH_ALPHA,
  );
  ctx.strokeStyle = rgba(CLOAK_RIM, CLOAK_RIM_ALPHA);
  ctx.lineWidth = CLOAK_RIM_WIDTH;
  ctx.beginPath();
  hoodEdge();
  earEdges(false);
  ctx.stroke();
}

/** The hood in profile: a fold at the back of his neck, one ear hanging behind it. */
function paintHoodInProfile(ctx: Ctx, skeleton: Skeleton): void {
  const sc = skeleton.shoulderCentre;
  const centre = pt(sc.x + PROFILE_HOOD_CENTRE.x, sc.y + PROFILE_HOOD_CENTRE.y);
  const ear = pt(centre.x, centre.y - PROFILE_HOOD_RADIUS_Y);
  ctx.beginPath();
  ctx.moveTo(ear.x - HOOD_EAR_BASE, ear.y + HOOD_EAR_BASE);
  ctx.lineTo(ear.x - HOOD_EAR_LENGTH * HOOD_EAR_SPLAY, ear.y - HOOD_EAR_LENGTH);
  ctx.lineTo(ear.x + HOOD_EAR_BASE, ear.y + HOOD_EAR_BASE);
  ctx.closePath();
  ctx.fillStyle = CLOAK.rim;
  ctx.fill();
  const traceHood = (): void => {
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, PROFILE_HOOD_RADIUS_X, PROFILE_HOOD_RADIUS_Y, 0, 0, TWO_PI);
  };
  shadeForm(
    ctx,
    traceHood,
    {
      from: pt(centre.x, centre.y - PROFILE_HOOD_RADIUS_Y),
      to: pt(centre.x, centre.y + PROFILE_HOOD_RADIUS_Y),
    },
    CLOAK,
    { halfWidth: PROFILE_HOOD_RADIUS_X, softness: CLOAK_SOFTNESS },
  );
}

/**
 * The Nightgaunt Cloak: black leather "like a demon's leathery wing",
 * stretched over rows of fingerbones, its hem scalloped between the finger
 * tips, hanging from the jacket's shoulders with the pointed-eared hood down
 * at his back. Call it where {@link cloakInFront} says it belongs in the
 * figure's draw order.
 */
export function drawCloak(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, view: ViewSpec): void {
  const gear = gearOf(pose);
  if (gear.cloak !== true) return;
  const shape = cloakShape(skeleton, pose, view, gear);
  const inside = !view.showsBack && !view.profile;
  const ramp = inside ? LINING : CLOAK;
  const trace = (): void => shape.trace(ctx);
  // Facing the camera the lining hangs behind him and shows only as a sliver
  // at each flank, where a bone's lit ridge and a knuckle are each under a
  // screen pixel of the tile: the ribs there are drawn as the one tone they
  // average to, in his most-drawn view.
  const bones = inside ? PLAIN_BONES : LIT_BONES;

  ctx.save();
  shadeForm(
    ctx,
    trace,
    { from: shape.top, to: shape.hemCentre },
    ramp,
    { halfWidth: shape.halfWidth, softness: CLOAK_SOFTNESS, contrast: CLOAK_CONTRAST },
    () => {
      paintMembrane(ctx, shape.ribs, ramp);
      paintRibs(ctx, shape.ribs, bones);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(CLOAK_RIM, CLOAK_RIM_ALPHA);
      ctx.lineWidth = CLOAK_LIT_EDGE_WIDTH;
      shape.litEdge(ctx);
      ctx.stroke();
    },
  );
  if (view.profile) paintHoodInProfile(ctx, skeleton);
  else if (view.showsBack) paintHoodFromBehind(ctx, shape.top);
  ctx.restore();
}

// ── War Gauntlet of the Exalted Grull ────────────────────────────────────────

/**
 * Charcoal steel: the bracer at rest. Its darkest step stays above the
 * outline's value: the bracer lies against his body in most standing poses,
 * and a near-black band there reads as an ink line round the wrist.
 */
const CHARCOAL: Ramp = {
  deep: '#23232a',
  shadow: '#2c2c34',
  dark: '#36363f',
  mid: '#42424c',
  base: '#4e4e59',
  light: '#6c6c78',
  rim: '#9090a0',
};
/** Orcish steel, a colder grey than the bracer, so the spikes gleam against it. */
const ORC_STEEL: Ramp = {
  deep: '#1b1e25',
  shadow: '#2a2f39',
  dark: '#39404c',
  mid: '#4a5260',
  base: '#5d6676',
  light: '#8a94a6',
  rim: '#b8c2d4',
};
const SPIKE_GLEAM = '#f2f6ff';
const SPIKE_GLEAM_RADIUS = 0.02;

/** The bracer runs this far up the forearm from the wrist. */
const BRACER_LENGTH = 0.15;
/** Round the wrist it is a little proud of the skin; at its far end, of the thicker forearm. */
const BRACER_WRIST_GIRTH = 1.3;
const BRACER_FAR_GIRTH = 1.5;
/** Its corners are cut off: the angular plate reads as armour, a rounded one as a sock. */
const BRACER_CHAMFER = 0.03;
const BRACER_CHAMFER_SHARE = 0.78;
/** It stops just past the wrist, over the heel of the hand. */
const BRACER_OVERHANG = 0.012;
/** The plate's raised ridge catches the key along its length. */
const BRACER_RIDGE_ACROSS = -0.3;
const BRACER_RIDGE_WIDTH = 0.02;

/**
 * Round a fist the steel grows into a block a screen pixel proud of the bare
 * fist on every side, so the fist visibly becomes something heavier; its back
 * edge sits just behind the wrist, over the bracer.
 */
const GAUNTLET_PROUD = 0.03;
const GAUNTLET_BACK = 0.08;
const GAUNTLET_CHAMFER = 0.035;
/**
 * The spikes stand out of the steel every way from the fist: off the middle
 * of the knuckle face, off its two corners, and off both flanks. Parallel
 * prongs out of the front read as fingers — a rake, a claw, a gun barrel —
 * and at the tile so does any fan of spikes out of the front alone; a fist
 * bristling on every side is the one shape that reads as spiked steel there.
 * The block runs back over the wrist so it stays a gauntlet rather than a
 * mace head held in the hand. Each spike is a place on the block's outline,
 * as shares of its length along and its half-width across, a direction off
 * the line of the forearm, and a length.
 */
const CORNER_SPIKE = Math.PI / 4;
const SPIKE_LENGTH = 0.07;
const FLANK_SPIKE_AT = 0.4;
const GAUNTLET_SPIKES: readonly {
  along: number;
  across: number;
  direction: number;
  length: number;
}[] = [
  { along: 1, across: 0, direction: 0, length: SPIKE_LENGTH },
  { along: 0.92, across: -0.9, direction: -CORNER_SPIKE, length: SPIKE_LENGTH },
  { along: 0.92, across: 0.9, direction: CORNER_SPIKE, length: SPIKE_LENGTH },
  { along: FLANK_SPIKE_AT, across: -1, direction: -HALF_PI, length: SPIKE_LENGTH },
  { along: FLANK_SPIKE_AT, across: 1, direction: HALF_PI, length: SPIKE_LENGTH },
];
const SPIKE_BASE = 0.04;
const SPIKE_COLOUR = '#a7b0c0';
const SPIKE_SHADOW = '#4a5260';

/**
 * The smoke the steel goes up in as the fist opens: a lumpy cluster of puffs,
 * as offsets from the middle of the fist in figure units (+Y down). It gathers
 * above the fist rather than over it, so the bare fist shows through as the
 * steel goes — smoke laid over the hand reads as the hand holding a ball.
 */
const SMOKE_PUFFS: readonly { x: number; y: number; radius: number }[] = [
  { x: 0, y: -0.11, radius: 0.105 },
  { x: -0.1, y: -0.06, radius: 0.08 },
  { x: 0.1, y: -0.07, radius: 0.085 },
  { x: -0.04, y: -0.21, radius: 0.075 },
  { x: 0.08, y: -0.19, radius: 0.065 },
];
/**
 * A warm, sooty grey — it "smells of burnt hair" — well below the steel's
 * value, so the puff never reads as more of the gauntlet.
 */
const SMOKE_LIT = '#c8c3b9';
const SMOKE_SHADE = '#4f4843';
const SMOKE_ALPHA = 0.85;
const SMOKE_SHADE_ALPHA = 0.7;
const SMOKE_CORE = 0.5;
/**
 * A frame later the puff has risen and drifted outward, away from his body —
 * straight up, a fist held at his face would put it over his face.
 */
const WISP_RISE = 0.06;
const WISP_DRIFT = 0.14;
const WISP_SCALE = 0.8;
const WISP_FADE = 0.5;

/** His right arm, the one the gauntlet is on, as the drawn skeleton holds it. */
function gauntletArm(skeleton: Skeleton, view: ViewSpec): BoneChain {
  return drawnSide('right', view) === 'right' ? skeleton.rightArm : skeleton.leftArm;
}

function traceBracer(ctx: Ctx, wristHalf: number, farHalf: number, length: number): void {
  const chamfer = BRACER_CHAMFER;
  ctx.beginPath();
  ctx.moveTo(-length, -farHalf * BRACER_CHAMFER_SHARE);
  ctx.lineTo(-length + chamfer, -farHalf);
  ctx.lineTo(-chamfer, -wristHalf);
  ctx.lineTo(BRACER_OVERHANG, -wristHalf * BRACER_CHAMFER_SHARE);
  ctx.lineTo(BRACER_OVERHANG, wristHalf * BRACER_CHAMFER_SHARE);
  ctx.lineTo(-chamfer, wristHalf);
  ctx.lineTo(-length + chamfer, farHalf);
  ctx.lineTo(-length, farHalf * BRACER_CHAMFER_SHARE);
  ctx.closePath();
}

function paintBracer(ctx: Ctx, angle: number): void {
  const wristHalf = WRIST_WIDTH * BRACER_WRIST_GIRTH;
  const farHalf = WRIST_WIDTH * BRACER_FAR_GIRTH;
  shadeForm(
    ctx,
    () => traceBracer(ctx, wristHalf, farHalf, BRACER_LENGTH),
    { from: pt(-BRACER_LENGTH, 0), to: pt(0, 0) },
    CHARCOAL,
    { halfWidth: farHalf, frameRotation: angle },
    () => {
      ctx.strokeStyle = CHARCOAL.rim;
      ctx.lineWidth = BRACER_RIDGE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(-BRACER_LENGTH, farHalf * BRACER_RIDGE_ACROSS);
      ctx.lineTo(0, wristHalf * BRACER_RIDGE_ACROSS);
      ctx.stroke();
      // The plate's cut ends catch the key as hard edges: what makes it an
      // angular bracer rather than a cloth cuff.
      ctx.strokeStyle = CHARCOAL.light;
      ctx.beginPath();
      ctx.moveTo(-BRACER_LENGTH, -farHalf);
      ctx.lineTo(-BRACER_LENGTH, farHalf);
      ctx.moveTo(-BRACER_CHAMFER, -wristHalf);
      ctx.lineTo(-BRACER_CHAMFER, wristHalf);
      ctx.stroke();
    },
  );
}

function spike(ctx: Ctx, base: Pt, direction: number, length: number): Pt {
  const tip = pt(base.x + Math.cos(direction) * length, base.y + Math.sin(direction) * length);
  const side = direction + HALF_PI;
  const dx = Math.cos(side) * SPIKE_BASE;
  const dy = Math.sin(side) * SPIKE_BASE;
  ctx.beginPath();
  ctx.moveTo(base.x - dx, base.y - dy);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(base.x + dx, base.y + dy);
  ctx.closePath();
  ctx.fillStyle = SPIKE_COLOUR;
  ctx.fill();
  // The flank turned from the key sits in shadow: a spike is a cone, not a flat triangle.
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(base.x + dx, base.y + dy);
  ctx.closePath();
  ctx.fillStyle = SPIKE_SHADOW;
  ctx.fill();
  return tip;
}

function paintSpikedGauntlet(ctx: Ctx, angle: number, fist: number, shape: HandShape): void {
  paintBracer(ctx, angle);
  const front = handLength(fist, shape) + GAUNTLET_PROUD;
  const back = -GAUNTLET_BACK;
  const half = handHalfWidth(fist, shape) + GAUNTLET_PROUD;
  const chamfer = GAUNTLET_CHAMFER;
  const traceShell = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, -half + chamfer);
    ctx.lineTo(back + chamfer, -half);
    ctx.lineTo(front - chamfer, -half);
    ctx.lineTo(front, -half + chamfer);
    ctx.lineTo(front, half - chamfer);
    ctx.lineTo(front - chamfer, half);
    ctx.lineTo(back + chamfer, half);
    ctx.lineTo(back, half - chamfer);
    ctx.closePath();
  };
  const tips = GAUNTLET_SPIKES.map((placement) =>
    spike(
      ctx,
      pt(lerp(back, front, placement.along), placement.across * half),
      placement.direction,
      placement.length,
    ),
  );
  shadeForm(
    ctx,
    traceShell,
    { from: pt(back, 0), to: pt(front, 0) },
    ORC_STEEL,
    { halfWidth: half, frameRotation: angle },
    () => {
      ctx.strokeStyle = ORC_STEEL.rim;
      ctx.lineWidth = BRACER_RIDGE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(back, half * BRACER_RIDGE_ACROSS);
      ctx.lineTo(front, half * BRACER_RIDGE_ACROSS);
      ctx.stroke();
    },
  );
  ctx.fillStyle = SPIKE_GLEAM;
  for (const tip of tips) {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, SPIKE_GLEAM_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * The gauntlet, if he wears it and `drawn` is the side of the skeleton his
 * right arm is drawn from: painted after that arm, so the steel lies over the
 * wrist and, closed round a fist, over the whole hand.
 *
 * A profile row facing left is the right-facing cell mirrored whole, so there
 * the gauntlet shows on his left hand; mirroring keeps it on the hand that
 * throws the cross and the hook, which is the hand the steel has to follow.
 */
export function drawGauntlet(
  ctx: Ctx,
  pose: CarlPose,
  view: ViewSpec,
  drawn: BodySide,
  chain: BoneChain,
): void {
  const form = gearOf(pose).gauntlet;
  if (form === undefined || drawnSide('right', view) !== drawn) return;
  const fist = drawn === 'left' ? pose.leftFist : pose.rightFist;
  const shape = (drawn === 'left' ? pose.leftHandShape : pose.rightHandShape) ?? 'relaxed';
  const angle = wristAngle(chain);
  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  ctx.rotate(angle);
  if (form === 'spiked') paintSpikedGauntlet(ctx, angle, fist, shape);
  else paintBracer(ctx, angle);
  ctx.restore();
}

/** Whether the gauntlet is going up in smoke on this pose, painted by {@link drawGauntletSmoke}. */
export function gauntletSmokes(pose: CarlPose): boolean {
  const form = gearOf(pose).gauntlet;
  return form === 'smoke' || form === 'wisp';
}

/**
 * The puff of smoke the steel vanishes in, laid over the finished figure:
 * smoke has no outline of its own and drifts past the silhouette.
 */
export function drawGauntletSmoke(
  ctx: Ctx,
  pose: CarlPose,
  view: ViewSpec,
  skeleton: Skeleton,
): void {
  const form = gearOf(pose).gauntlet;
  if (form !== 'smoke' && form !== 'wisp') return;
  const wisp = form === 'wisp';
  const chain = gauntletArm(skeleton, view);
  const angle = wristAngle(chain);
  const rightDrawnRight = drawnSide('right', view) === 'right';
  const fist = rightDrawnRight ? pose.rightFist : pose.leftFist;
  const shape = (rightDrawnRight ? pose.rightHandShape : pose.leftHandShape) ?? 'relaxed';
  const halfFist = handLength(fist, shape) * HALF;
  const fistCentre = pt(
    chain.end.x + Math.cos(angle) * halfFist,
    chain.end.y + Math.sin(angle) * halfFist,
  );
  const outward = Math.sign(fistCentre.x - skeleton.shoulderCentre.x) || 1;
  const centre = wisp
    ? pt(fistCentre.x + outward * WISP_DRIFT, fistCentre.y - WISP_RISE)
    : fistCentre;
  const scale = wisp ? WISP_SCALE : 1;
  const fade = wisp ? WISP_FADE : 1;
  for (const puff of SMOKE_PUFFS) {
    const x = centre.x + puff.x * scale;
    const y = centre.y + puff.y * scale;
    const radius = puff.radius * scale;
    fillSoftEllipse(
      ctx,
      x + SHADOW_FALL_X,
      y + SHADOW_FALL_Y,
      radius,
      radius,
      SMOKE_SHADE,
      SMOKE_SHADE_ALPHA * fade,
      0,
      SMOKE_CORE,
    );
  }
  for (const puff of SMOKE_PUFFS) {
    const radius = puff.radius * scale;
    fillSoftEllipse(
      ctx,
      centre.x + puff.x * scale,
      centre.y + puff.y * scale,
      radius,
      radius,
      SMOKE_LIT,
      SMOKE_ALPHA * fade,
      0,
      SMOKE_CORE,
    );
  }
}

// ── Feet ─────────────────────────────────────────────────────────────────────

/**
 * What the foot on the drawn skeleton's `drawn` side wears: the toe ring is on
 * his right foot only; a pedicure is on both.
 */
export function footAccents(pose: CarlPose, view: ViewSpec, drawn: BodySide): FootAccents {
  const gear = gearOf(pose);
  return {
    toeRing: gear.toeRing === true && drawnSide('right', view) === drawn,
    pedicure: gear.pedicure === true,
  };
}

// ── Reach ────────────────────────────────────────────────────────────────────

/** The farthest a spike or a puff of smoke stands off the wrist. */
const GAUNTLET_REACH_RADIUS = 0.36;

/**
 * Figure-space points the gear's ink can reach, for the surface the figure is
 * composed on: the cloak flares and streams well past the skeleton, and ink
 * past that surface is cut off along a straight edge.
 */
export function gearReach(skeleton: Skeleton, pose: CarlPose, view: ViewSpec): readonly Pt[] {
  const gear = gearOf(pose);
  const points: Pt[] = [];
  if (gear.cloak === true) points.push(...cloakShape(skeleton, pose, view, gear).extent);
  if (gear.gauntlet !== undefined) {
    const wrist = gauntletArm(skeleton, view).end;
    points.push(
      pt(wrist.x - GAUNTLET_REACH_RADIUS, wrist.y - GAUNTLET_REACH_RADIUS),
      pt(wrist.x + GAUNTLET_REACH_RADIUS, wrist.y + GAUNTLET_REACH_RADIUS),
    );
  }
  return points;
}
