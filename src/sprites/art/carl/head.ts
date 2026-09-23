/**
 * Carl's head and the neck it sits on: skull, face planes, features, ears and
 * hair, plus the neck column under them.
 *
 * The face is modelled as planes rather than as one shaded ball. At the 32 px
 * tile the head is about ten pixels tall, and what survives that is a handful
 * of flat value shapes — the lit front plane, a shadowed side plane, the
 * sockets under the brow, the under-planes of the cheekbones, nose and jaw.
 * A smooth gradient over an oval averages into one flat colour there, and the
 * head reads as a doll's.
 *
 * The key light is upper left and also in front of him (it lights whatever
 * faces the camera). That matters edge-on: the profile is always drawn facing
 * +X, away from the key, but what the camera sees of a head in profile is its
 * side plane — cheek, temple, jaw — which faces the camera and so takes the
 * light. Only the narrow front planes along the profile line (brow, nose,
 * lips, chin) turn away from it. Shading the profile as a ball lit from the
 * left puts his whole face in shadow.
 */

import { mixPt, pt, rotate, TWO_PI } from './geometry';
import { castShadow, crease, fillCapsule, printHash, shadeClipped } from './paint';
import { EYE_WHITE, HAIR, IRIS, MOUTH_INNER, OUTLINE, type Ramp, SKIN, TOOTH } from './palette';
import { HEAD_CHIN_DROP, HEAD_DEPTH, HEAD_RX, HEAD_RY, NECK_WIDTH } from './proportions';
import { type CarlPose, type Skeleton, type ViewSpec } from './rig';
import { clamp01, deg, hump, lerp, mix, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse, withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

/**
 * How much of the torso's lean the head copies. Near 1 the head buries itself
 * in the shoulders on any leaning pose, which turns a punch into a hunch; a
 * head that stays nearly level keeps the figure reading upright.
 */
const HEAD_LEAN_FOLLOW = 0.25;

/** The rotation the head is painted at, relative to figure space. */
export function headAngle(pose: CarlPose): number {
  return pose.headTilt + pose.lean * HEAD_LEAN_FOLLOW;
}

// ── Skull silhouette, head-on ────────────────────────────────────────────────
// Head-local units: origin at the head's centre (the eye line), +Y down. Every
// landmark is a fraction of HEAD_RX across and HEAD_RY down.

/** Where the cranium's side meets the cheek; the skull is widest here. */
const CRANIUM_SIDE_Y = -0.1;
const CROWN_Y = -1.2;
/** Control height that squares the top of the cranium off. */
const CROWN_CONTROL_Y = -1.25;
/**
 * The cheek runs almost straight down from the cranium to the jaw corner. A
 * square jaw is a corner, not a curve: the width is held to the corner and
 * turns in there, so the chin hangs off a squared jawline.
 */
const CHEEK_CONTROL_X = 0.95;
const CHEEK_CONTROL_Y = 0.4;
const JAW_CORNER_X = 0.9;
const JAW_CORNER_Y = 0.66;
const JAW_CORNER_CONTROL_X = 0.88;
const JAW_CORNER_CONTROL_Y = 0.88;
const JAW_CORNER_END_X = 0.7;
const JAW_CORNER_END_Y = 0.94;
/** The chin's own corners: a broad chin, not a point. */
const CHIN_CORNER_X = 0.44;
const CHIN_CORNER_Y = 1.14;
const CHIN_CONTROL_X = 0.2;

/** Traces the skull-plus-jaw silhouette seen head-on (or from behind). */
function traceSkullFacing(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-HEAD_RX, HEAD_RY * CRANIUM_SIDE_Y);
  ctx.quadraticCurveTo(-HEAD_RX, HEAD_RY * CROWN_CONTROL_Y, 0, HEAD_RY * CROWN_Y);
  ctx.quadraticCurveTo(HEAD_RX, HEAD_RY * CROWN_CONTROL_Y, HEAD_RX, HEAD_RY * CRANIUM_SIDE_Y);
  for (const side of [1, -1]) {
    // Down one side and back up the other: the right side runs top to bottom,
    // the left bottom to top, so the path closes on itself.
    const x = (fraction: number): number => side * HEAD_RX * fraction;
    if (side > 0) {
      ctx.quadraticCurveTo(
        x(CHEEK_CONTROL_X),
        HEAD_RY * CHEEK_CONTROL_Y,
        x(JAW_CORNER_X),
        HEAD_RY * JAW_CORNER_Y,
      );
      ctx.quadraticCurveTo(
        x(JAW_CORNER_CONTROL_X),
        HEAD_RY * JAW_CORNER_CONTROL_Y,
        x(JAW_CORNER_END_X),
        HEAD_RY * JAW_CORNER_END_Y,
      );
      ctx.lineTo(x(CHIN_CORNER_X), HEAD_RY * CHIN_CORNER_Y);
      ctx.quadraticCurveTo(
        x(CHIN_CONTROL_X),
        HEAD_RY * HEAD_CHIN_DROP,
        0,
        HEAD_RY * HEAD_CHIN_DROP,
      );
    } else {
      ctx.quadraticCurveTo(
        x(CHIN_CONTROL_X),
        HEAD_RY * HEAD_CHIN_DROP,
        x(CHIN_CORNER_X),
        HEAD_RY * CHIN_CORNER_Y,
      );
      ctx.lineTo(x(JAW_CORNER_END_X), HEAD_RY * JAW_CORNER_END_Y);
      ctx.quadraticCurveTo(
        x(JAW_CORNER_CONTROL_X),
        HEAD_RY * JAW_CORNER_CONTROL_Y,
        x(JAW_CORNER_X),
        HEAD_RY * JAW_CORNER_Y,
      );
      ctx.quadraticCurveTo(
        x(CHEEK_CONTROL_X),
        HEAD_RY * CHEEK_CONTROL_Y,
        -HEAD_RX,
        HEAD_RY * CRANIUM_SIDE_Y,
      );
    }
  }
  ctx.closePath();
}

/**
 * Seen from behind, the jaw is hidden by the neck: below the ears the skull
 * narrows straight into it. Carried down to the jaw corners the way the face
 * view is, the back of the head grows a wide pale jowl under the hair.
 */
const BACK_SKULL_BOTTOM_Y = 0.8;
const BACK_SKULL_BOTTOM_HALF = 0.72;
const BACK_SKULL_CONTROL_Y = 0.45;

function traceSkullBack(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-HEAD_RX, HEAD_RY * CRANIUM_SIDE_Y);
  ctx.quadraticCurveTo(-HEAD_RX, HEAD_RY * CROWN_CONTROL_Y, 0, HEAD_RY * CROWN_Y);
  ctx.quadraticCurveTo(HEAD_RX, HEAD_RY * CROWN_CONTROL_Y, HEAD_RX, HEAD_RY * CRANIUM_SIDE_Y);
  ctx.quadraticCurveTo(
    HEAD_RX,
    HEAD_RY * BACK_SKULL_CONTROL_Y,
    HEAD_RX * BACK_SKULL_BOTTOM_HALF,
    HEAD_RY * BACK_SKULL_BOTTOM_Y,
  );
  ctx.lineTo(-HEAD_RX * BACK_SKULL_BOTTOM_HALF, HEAD_RY * BACK_SKULL_BOTTOM_Y);
  ctx.quadraticCurveTo(
    -HEAD_RX,
    HEAD_RY * BACK_SKULL_CONTROL_Y,
    -HEAD_RX,
    HEAD_RY * CRANIUM_SIDE_Y,
  );
  ctx.closePath();
}

/** The underside of the jaw seen head-on, corner to corner, as an open path. */
function traceJawEdgeFacing(ctx: Ctx): void {
  ctx.moveTo(-HEAD_RX * JAW_CORNER_X, HEAD_RY * JAW_CORNER_Y);
  ctx.quadraticCurveTo(
    -HEAD_RX * JAW_CORNER_CONTROL_X,
    HEAD_RY * JAW_CORNER_CONTROL_Y,
    -HEAD_RX * JAW_CORNER_END_X,
    HEAD_RY * JAW_CORNER_END_Y,
  );
  ctx.lineTo(-HEAD_RX * CHIN_CORNER_X, HEAD_RY * CHIN_CORNER_Y);
  ctx.quadraticCurveTo(
    0,
    HEAD_RY * HEAD_CHIN_DROP,
    HEAD_RX * CHIN_CORNER_X,
    HEAD_RY * CHIN_CORNER_Y,
  );
  ctx.lineTo(HEAD_RX * JAW_CORNER_END_X, HEAD_RY * JAW_CORNER_END_Y);
  ctx.quadraticCurveTo(
    HEAD_RX * JAW_CORNER_CONTROL_X,
    HEAD_RY * JAW_CORNER_CONTROL_Y,
    HEAD_RX * JAW_CORNER_X,
    HEAD_RY * JAW_CORNER_Y,
  );
}

// ── Skull silhouette, edge-on ────────────────────────────────────────────────
// Always drawn facing +X; the runtime mirrors it. Fractions of HEAD_DEPTH
// across and HEAD_RY down, with the same heights as the head-on view so the
// face is the same length from every side.

/**
 * The profile line, brow to chin. The nose stands barely a fifth of the head's
 * depth proud of the face: any longer and a nose on a head this small reads as
 * a beak.
 */
const PROFILE_LINE: readonly Pt[] = [
  pt(0.9, -0.72), // forehead
  pt(0.99, -0.3), // brow ridge
  pt(0.93, -0.14), // bridge of the nose
  pt(1.2, 0.22), // nose tip
  pt(0.95, 0.3), // under the nose
  pt(1.0, 0.43), // upper lip
  pt(0.96, 0.52), // mouth
  pt(0.99, 0.62), // lower lip
  pt(0.92, 0.75), // the dip above the chin
  pt(1.0, 1.0), // chin
  pt(0.76, 1.24), // under the chin: blunt, so a tipped-back head does not end in a point
];
/**
 * The jaw's angle, well below and a little in front of the ear. A heavy jaw
 * runs back from the chin nearly level; sloped up toward the ear it reads as
 * a weak chin on a head thrust forward.
 */
const PROFILE_JAW_ANGLE = pt(-0.36, 1.02);
/** Where the jaw's rear edge meets the skull under the ear. */
const PROFILE_JAW_REAR = pt(-0.4, 0.3);
/** The base of the skull behind, where the neck takes over. */
const PROFILE_SKULL_BASE = pt(-0.86, 0.3);
const PROFILE_OCCIPUT = pt(-1.04, -0.35);
const PROFILE_CROWN = pt(0.1, -1.2);
const PROFILE_CROWN_BACK_CONTROL = pt(-1.02, -1.18);
const PROFILE_CROWN_FRONT_CONTROL = pt(0.9, -1.18);

function profilePoint(p: Pt): Pt {
  return pt(p.x * HEAD_DEPTH, p.y * HEAD_RY);
}

function traceSkullProfile(ctx: Ctx): void {
  ctx.beginPath();
  const back = profilePoint(PROFILE_SKULL_BASE);
  ctx.moveTo(back.x, back.y);
  const occiput = profilePoint(PROFILE_OCCIPUT);
  ctx.lineTo(occiput.x, occiput.y);
  const backControl = profilePoint(PROFILE_CROWN_BACK_CONTROL);
  const crown = profilePoint(PROFILE_CROWN);
  ctx.quadraticCurveTo(backControl.x, backControl.y, crown.x, crown.y);
  const frontControl = profilePoint(PROFILE_CROWN_FRONT_CONTROL);
  const forehead = profilePoint(PROFILE_LINE[0]);
  ctx.quadraticCurveTo(frontControl.x, frontControl.y, forehead.x, forehead.y);
  // Through the midpoints, so the landmarks read as soft turns rather than
  // as the corners of a polygon.
  for (let i = 1; i < PROFILE_LINE.length - 1; i++) {
    const here = profilePoint(PROFILE_LINE[i]);
    const next = profilePoint(PROFILE_LINE[i + 1]);
    const mid = mixPt(here, next, 0.5);
    ctx.quadraticCurveTo(here.x, here.y, mid.x, mid.y);
  }
  const underChin = profilePoint(PROFILE_LINE[PROFILE_LINE.length - 1]);
  ctx.lineTo(underChin.x, underChin.y);
  const angle = profilePoint(PROFILE_JAW_ANGLE);
  ctx.lineTo(angle.x, angle.y);
  const rear = profilePoint(PROFILE_JAW_REAR);
  ctx.lineTo(rear.x, rear.y);
  ctx.closePath();
}

/**
 * The underside of the jaw edge-on, chin to angle, as an open path. The rear
 * edge of the jaw above the angle is left out: the light falls from behind
 * it, so it casts nothing onto the neck, and its lit sliver would lay a pale
 * stripe down the back of the jaw.
 */
function traceJawEdgeProfile(ctx: Ctx): void {
  const chin = profilePoint(PROFILE_LINE[PROFILE_LINE.length - 1]);
  const angle = profilePoint(PROFILE_JAW_ANGLE);
  ctx.moveTo(chin.x, chin.y);
  ctx.lineTo(angle.x, angle.y);
}

// ── Neck ─────────────────────────────────────────────────────────────────────

/** Where the neck column starts, hidden inside the head, in head radii below its centre. */
const NECK_ROOT_Y = 0.2;
/** The column is barely narrower under the jaw than at its base: a thick neck. */
const NECK_TAPER = 0.94;
/**
 * The trapezius: the neck's sides flare out into the shoulders instead of
 * standing on them as a column. The flare starts this far above the shoulder
 * line and reaches this multiple of the neck's half-width where it goes under
 * the collar.
 */
const TRAP_RISE = 0.07;
const TRAP_FLARE = 2.1;
/** How far the neck runs on under the jacket, so no gap opens at the collar. */
const NECK_SINK = 0.05;
/**
 * Seen edge-on, the throat's front edge under the chin, and how far in front
 * of the spine the pit of the neck sits.
 */
const PROFILE_THROAT_TOP = pt(0.4, 0.98);
const PROFILE_THROAT_BASE_X = 0.62;
const PROFILE_NAPE_X = -0.72;
const PROFILE_NAPE_TOP = pt(-0.8, 0.34);
/** The trapezius runs well back from the nape into the shoulders edge-on. */
const PROFILE_TRAP_BACK_X = -1.15;
/**
 * The sternocleidomastoid: from behind the ear down to the pit of the neck.
 * It is a ridge with a groove on its throat side; one soft crease is all that
 * resolves. Edge-on only: head-on the chin sits down on the collar and covers
 * the front of the neck, so a crease there is painted and never seen.
 */
const SCM_TOP_PROFILE = pt(-0.24, 0.42);
const SCM_WIDTH = 0.011;
const SCM_OPACITY = 0.55;
/** The furrow down the back of the neck between the two neck muscles. */
const NUCHAL_TOP_Y = 0.56;
const NUCHAL_WIDTH = 0.01;
const NUCHAL_OPACITY = 0.5;
/** The neck turns away from the key more than the face: it sits under the jaw. */
const NECK_TERMINATOR = 0.55;
/** The jaw's shadow on the neck: wide enough to read as the jaw overhanging it. */
const JAW_SHADOW_WIDTH = 0.032;
/** The hair's shadow on the nape, seen from behind. */
const NAPE_SHADOW_WIDTH = 0.022;

/** `base` is the shoulder centre, in head-local coordinates. */
function traceNeckFacing(ctx: Ctx, base: Pt): void {
  const half = NECK_WIDTH;
  const topHalf = half * NECK_TAPER;
  const top = HEAD_RY * NECK_ROOT_Y;
  const flareY = base.y - TRAP_RISE;
  const floorY = base.y + NECK_SINK;
  ctx.beginPath();
  ctx.moveTo(base.x - topHalf, top);
  ctx.lineTo(base.x - half, flareY);
  ctx.quadraticCurveTo(base.x - half, base.y, base.x - half * TRAP_FLARE, floorY);
  ctx.lineTo(base.x + half * TRAP_FLARE, floorY);
  ctx.quadraticCurveTo(base.x + half, base.y, base.x + half, flareY);
  ctx.lineTo(base.x + topHalf, top);
  ctx.closePath();
}

function traceNeckProfile(ctx: Ctx, base: Pt): void {
  const throatTop = profilePoint(PROFILE_THROAT_TOP);
  const napeTop = profilePoint(PROFILE_NAPE_TOP);
  const throatBaseX = base.x + HEAD_DEPTH * PROFILE_THROAT_BASE_X;
  const napeX = base.x + HEAD_DEPTH * PROFILE_NAPE_X;
  const flareY = base.y - TRAP_RISE;
  const floorY = base.y + NECK_SINK;
  ctx.beginPath();
  ctx.moveTo(napeTop.x, napeTop.y);
  ctx.lineTo(0, HEAD_RY * NECK_ROOT_Y);
  ctx.lineTo(throatTop.x, throatTop.y);
  ctx.quadraticCurveTo(throatBaseX, lerp(throatTop.y, base.y, 0.5), throatBaseX, floorY);
  ctx.lineTo(base.x + HEAD_DEPTH * PROFILE_TRAP_BACK_X, floorY);
  ctx.quadraticCurveTo(napeX, base.y, napeX, flareY);
  ctx.closePath();
}

/**
 * The neck column, from the shoulder line up under the jaw, with the
 * trapezius flaring into the collar and the jaw's shadow falling across its
 * top. Painted in the head's own frame so that shadow follows the jaw however
 * the head tilts.
 */
export function drawNeck(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, view: ViewSpec): void {
  const angle = headAngle(pose);
  const base = rotate(
    pt(
      skeleton.shoulderCentre.x - skeleton.headCentre.x,
      skeleton.shoulderCentre.y - skeleton.headCentre.y,
    ),
    -angle,
  );
  const trace = (): void =>
    view.profile ? traceNeckProfile(ctx, base) : traceNeckFacing(ctx, base);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(angle);
  trace();
  ctx.fillStyle = SKIN.base;
  ctx.fill();
  withClip(ctx, trace, () => {
    shadeClipped(ctx, { from: pt(base.x, base.y), to: pt(0, HEAD_RY * NECK_ROOT_Y) }, SKIN, {
      halfWidth: NECK_WIDTH,
      terminator: NECK_TERMINATOR,
      frameRotation: angle,
      fillBase: false,
    });
    if (view.showsBack) {
      crease(
        ctx,
        () => {
          ctx.moveTo(base.x, HEAD_RY * NUCHAL_TOP_Y);
          ctx.lineTo(base.x, base.y);
        },
        NUCHAL_WIDTH,
        SKIN,
        NUCHAL_OPACITY,
        angle,
      );
    } else if (view.profile) {
      const top = profilePoint(SCM_TOP_PROFILE);
      crease(
        ctx,
        () => {
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(base.x + HEAD_DEPTH * PROFILE_THROAT_BASE_X, base.y);
        },
        SCM_WIDTH,
        SKIN,
        SCM_OPACITY,
        angle,
      );
    }
  });
  if (view.showsBack) {
    castShadow(
      ctx,
      trace,
      () => {
        ctx.moveTo(-HEAD_RX, HEAD_RY * BACK_HAIR_COVERAGE);
        // A quadratic's apex sits halfway to its control point, so the control
        // goes twice as far past the corners as the nape's centre does.
        const napeDip = BACK_HAIR_COVERAGE * (BACK_HAIR_NAPE_DROP - 1);
        ctx.quadraticCurveTo(
          0,
          HEAD_RY * (BACK_HAIR_COVERAGE + napeDip * 2),
          HEAD_RX,
          HEAD_RY * BACK_HAIR_COVERAGE,
        );
      },
      SKIN,
      NAPE_SHADOW_WIDTH,
      angle,
    );
  } else {
    castShadow(
      ctx,
      trace,
      () => (view.profile ? traceJawEdgeProfile(ctx) : traceJawEdgeFacing(ctx)),
      SKIN,
      JAW_SHADOW_WIDTH,
      angle,
    );
  }
  ctx.restore();
}

// ── Face, head-on ────────────────────────────────────────────────────────────

/**
 * The boundary between the face's front plane and the side plane on each
 * side: in at the temple, out over the cheekbone, in under it, out to the jaw
 * corner, then along the jawline to the chin. Across it the value steps
 * rather than rolls, which is what makes the head read as bone and not as a
 * balloon.
 */
const SIDE_PLANE_EDGE: readonly Pt[] = [
  pt(0.66, -1.0),
  pt(0.58, -0.5), // temple
  pt(0.72, 0.02), // cheekbone
  pt(0.6, 0.38), // under the cheekbone
  pt(0.74, 0.66), // jaw corner
  pt(0.36, 1.12), // chin corner
];
/** How far past the silhouette the side-plane shapes reach; the skull clip ends them. */
const PLANE_OVERREACH = 1.4;

function traceSidePlane(ctx: Ctx, side: number): void {
  ctx.beginPath();
  const first = SIDE_PLANE_EDGE[0];
  ctx.moveTo(side * HEAD_RX * first.x, HEAD_RY * first.y);
  for (let i = 1; i < SIDE_PLANE_EDGE.length - 1; i++) {
    const here = SIDE_PLANE_EDGE[i];
    const next = SIDE_PLANE_EDGE[i + 1];
    ctx.quadraticCurveTo(
      side * HEAD_RX * here.x,
      HEAD_RY * here.y,
      side * HEAD_RX * lerp(here.x, next.x, 0.5),
      HEAD_RY * lerp(here.y, next.y, 0.5),
    );
  }
  const last = SIDE_PLANE_EDGE[SIDE_PLANE_EDGE.length - 1];
  ctx.lineTo(side * HEAD_RX * last.x, HEAD_RY * last.y);
  ctx.lineTo(side * HEAD_RX * last.x, HEAD_RY * PLANE_OVERREACH);
  ctx.lineTo(side * HEAD_RX * PLANE_OVERREACH, HEAD_RY * PLANE_OVERREACH);
  ctx.lineTo(side * HEAD_RX * PLANE_OVERREACH, -HEAD_RY * PLANE_OVERREACH);
  ctx.lineTo(side * HEAD_RX * first.x, -HEAD_RY * PLANE_OVERREACH);
  ctx.closePath();
}

/** Where the front plane's light pools: up on the forehead and cheek nearer the key. */
const FRONT_LIGHT_FROM = pt(-0.8, -0.2);
const FRONT_LIGHT_TO = pt(0.6, 0.5);
/** How much of the lit front plane's gradient holds at full light before falling off. */
const FRONT_LIGHT_HOLD = 0.12;
/**
 * The lit plane stops a little short of the ramp's light step: the forehead
 * under a high, straight hairline is a broad plane, and at full light it is
 * the loudest shape on the head.
 */
const FRONT_LIGHT_TEMPER = 0.3;
/** Past this share of the gradient the front plane is back at the base tone. */
const FRONT_LIGHT_END = 0.55;

/** The eyes' sockets: the brow ridge's shadow, deepest toward the bridge of the nose. */
const SOCKET_RX = 1.1;
const SOCKET_RY = 1.3;
/** Raised toward the brow: the shadow is cast *by* the brow, so it hangs from it. */
const SOCKET_LIFT = 0.16;
/**
 * Soft enough that the sockets stay skin in shadow: fuller, they join the
 * brows and the eyes into one dark band across the face at the tile.
 */
const SOCKET_ALPHA = 0.4;
const SOCKET_CORE = 0.45;
/** The pocket beside the bridge of the nose, where the socket is deepest. */

/** The under-plane of each cheekbone, running down and in toward the mouth corner. */
const CHEEK_UNDER_PLANE: readonly Pt[] = [pt(0.68, 0.14), pt(0.46, 0.38), pt(0.62, 0.5)];
const CHEEK_UNDER_ALPHA = 0.6;

/** The nose, built from light only: a shaded bridge side, a lit tip, a cast shadow under it. */
const NOSE_BRIDGE_SHADE: readonly Pt[] = [
  pt(0.06, -0.14),
  pt(0.17, -0.1),
  pt(0.24, 0.3),
  pt(0.06, 0.32),
];
const NOSE_BRIDGE_ALPHA = 0.75;
const NOSE_RIDGE_X = -0.04;
const NOSE_RIDGE_TOP_Y = -0.3;
const NOSE_RIDGE_WIDTH = 0.14;
const NOSE_RIDGE_ALPHA = 0.8;
const NOSE_TIP = pt(-0.04, 0.22);
const NOSE_TIP_RX = 0.12;
const NOSE_TIP_RY = 0.08;
const NOSE_TIP_ALPHA = 0.9;
const NOSE_SHADOW = pt(0.06, 0.38);
/**
 * Small and half-strength: the nose's cast shadow falls on the upper lip, and
 * any wider or darker it joins the mouth line into a dark bar across the lip,
 * which at the tile is a moustache on a man who shaves every day.
 */
const NOSE_SHADOW_RX = 0.15;
const NOSE_SHADOW_RY = 0.06;
const NOSE_SHADOW_ALPHA = 0.5;
/** The nostrils either side of the tip, just under it, seen from below. */
const NOSTRIL_DX = 0.11;
const NOSTRIL_DY = 0.07;
const NOSTRIL_RX = 0.08;
const NOSTRIL_RY = 0.06;
const NOSTRIL_ALPHA = 0.9;

/** The dip under the lower lip, which faces down and away from the key. */
const LIP_DIP_ALPHA = 0.55;
/** The chin's ball catches light on its key side. */
const CHIN_LIGHT = pt(-0.12, 1.0);
const CHIN_LIGHT_RX = 0.2;
const CHIN_LIGHT_RY = 0.1;
const CHIN_LIGHT_ALPHA = 0.7;

/**
 * The lit edge along the jaw on the key side: the jaw's lower plane turns
 the light just before it turns under, so the corner reads as bone.
 */
const JAW_LIGHT_INSET = 0.012;
const JAW_LIGHT_WIDTH = 0.014;
const JAW_LIGHT_ALPHA = 0.75;

/**
 * A hard-edged ellipse at partial alpha, for marks a pixel or two across: at
 * that size a soft edge lands in the same pixels as a hard one, and a radial
 * gradient costs several times the fill.
 */
function fillFlatEllipse(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colour: string,
  alpha: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(colour, alpha);
  ctx.fill();
}

function fillPolygon(ctx: Ctx, points: readonly Pt[], sx: number, sy: number): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x * sx, p.y * sy);
    else ctx.lineTo(p.x * sx, p.y * sy);
  });
  ctx.closePath();
  ctx.fill();
}

/** The planes of the face seen head-on, painted inside the skull's clip. */
function paintFacePlanesFacing(ctx: Ctx, lift: number): void {
  // The front plane, lit from the upper left: a linear falloff, so its lower
  // right fades toward the base rather than ending on a ring.
  const front = ctx.createLinearGradient(
    HEAD_RX * FRONT_LIGHT_FROM.x,
    HEAD_RY * FRONT_LIGHT_FROM.y,
    HEAD_RX * FRONT_LIGHT_TO.x,
    HEAD_RY * FRONT_LIGHT_TO.y,
  );
  const lit = mix(SKIN.light, SKIN.base, FRONT_LIGHT_TEMPER);
  front.addColorStop(0, lit);
  front.addColorStop(FRONT_LIGHT_HOLD, lit);
  front.addColorStop(FRONT_LIGHT_END, SKIN.base);
  front.addColorStop(1, SKIN.base);
  ctx.fillStyle = front;
  ctx.fillRect(-HEAD_RX, -HEAD_RY * PLANE_OVERREACH, HEAD_RX * 2, HEAD_RY * PLANE_OVERREACH * 2);

  // The key-side plane turns from the camera but still faces the light.
  traceSidePlane(ctx, -1);
  ctx.fillStyle = SKIN.base;
  ctx.fill();
  // The far side plane is the one in shadow: a hard step at the plane's edge,
  // then the floor's bounce lifting it again toward the silhouette.
  const shade = ctx.createLinearGradient(HEAD_RX * SIDE_SHADE_FROM, 0, HEAD_RX, 0);
  shade.addColorStop(0, SKIN.mid);
  shade.addColorStop(SIDE_SHADE_CORE, SKIN.shadow);
  shade.addColorStop(1, SKIN.dark);
  traceSidePlane(ctx, 1);
  ctx.fillStyle = shade;
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.fillStyle = rgba(side < 0 ? SKIN.mid : SKIN.shadow, CHEEK_UNDER_ALPHA);
    fillPolygon(ctx, CHEEK_UNDER_PLANE, side * HEAD_RX, HEAD_RY);
  }

  for (const side of [-1, 1]) {
    fillSoftEllipse(
      ctx,
      side * EYE_DX,
      EYE_Y - HEAD_RY * SOCKET_LIFT,
      EYE_RX * SOCKET_RX,
      EYE_RY * SOCKET_RY,
      side < 0 ? SKIN.mid : SKIN.shadow,
      SOCKET_ALPHA,
      0,
      SOCKET_CORE,
    );
  }

  // The nose, from light only. The bridge between the eyes faces the key and
  // is what keeps the two sockets from joining into one band across the face.
  ctx.strokeStyle = rgba(SKIN.light, NOSE_RIDGE_ALPHA);
  ctx.lineWidth = HEAD_RX * NOSE_RIDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(HEAD_RX * NOSE_RIDGE_X, HEAD_RY * NOSE_RIDGE_TOP_Y);
  ctx.lineTo(HEAD_RX * NOSE_RIDGE_X, HEAD_RY * NOSE_TIP.y);
  ctx.stroke();
  ctx.fillStyle = rgba(SKIN.mid, NOSE_BRIDGE_ALPHA);
  fillPolygon(ctx, NOSE_BRIDGE_SHADE, HEAD_RX, HEAD_RY);
  // Tipped back, the nose stops casting down onto the lip and shows its
  // underside instead: the nostrils, the one dark mark that says "chin up".
  const nostrils = clamp01(lift / NOSTRIL_FULL_LIFT);
  fillFlatEllipse(
    ctx,
    HEAD_RX * NOSE_SHADOW.x,
    HEAD_RY * NOSE_SHADOW.y,
    HEAD_RX * NOSE_SHADOW_RX,
    HEAD_RY * NOSE_SHADOW_RY,
    SKIN.shadow,
    NOSE_SHADOW_ALPHA * (1 - nostrils),
  );
  if (nostrils > 0) {
    for (const side of [-1, 1]) {
      fillFlatEllipse(
        ctx,
        HEAD_RX * (NOSE_TIP.x + side * NOSTRIL_DX),
        HEAD_RY * (NOSE_TIP.y + NOSTRIL_DY),
        HEAD_RX * NOSTRIL_RX,
        HEAD_RY * NOSTRIL_RY,
        SKIN.deep,
        NOSTRIL_ALPHA * nostrils,
      );
    }
  }
  fillFlatEllipse(
    ctx,
    HEAD_RX * NOSE_TIP.x,
    HEAD_RY * NOSE_TIP.y,
    HEAD_RX * NOSE_TIP_RX,
    HEAD_RY * NOSE_TIP_RY,
    SKIN.rim,
    NOSE_TIP_ALPHA,
  );

  // The chin's ball. Head-on nothing is painted between it and the mouth
  // line: a shade under the lower lip merges with the line into a pair of lips.
  fillFlatEllipse(
    ctx,
    HEAD_RX * CHIN_LIGHT.x,
    HEAD_RY * CHIN_LIGHT.y,
    HEAD_RX * CHIN_LIGHT_RX,
    HEAD_RY * CHIN_LIGHT_RY,
    SKIN.light,
    CHIN_LIGHT_ALPHA,
  );

  ctx.save();
  ctx.translate(JAW_LIGHT_INSET, -JAW_LIGHT_INSET);
  ctx.strokeStyle = rgba(SKIN.rim, JAW_LIGHT_ALPHA);
  ctx.lineWidth = JAW_LIGHT_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-HEAD_RX * CHEEK_CONTROL_X, HEAD_RY * JAW_CORNER_Y * JAW_LIGHT_START);
  ctx.quadraticCurveTo(
    -HEAD_RX * JAW_CORNER_X,
    HEAD_RY * JAW_CORNER_Y,
    -HEAD_RX * JAW_CORNER_END_X,
    HEAD_RY * JAW_CORNER_END_Y,
  );
  ctx.lineTo(-HEAD_RX * CHIN_CORNER_X, HEAD_RY * CHIN_CORNER_Y);
  ctx.stroke();
  ctx.restore();
}

/** Where the lit jaw edge starts, as a share of the way down to the jaw corner. */
const JAW_LIGHT_START = 0.55;
/** The shadowed side plane: where its gradient starts, and where the core shadow sits. */
const SIDE_SHADE_FROM = 0.58;
const SIDE_SHADE_CORE = 0.55;

// ── Face, edge-on ────────────────────────────────────────────────────────────

/** The front planes along the profile line turn from the key; the side plane faces the camera. */
const PROFILE_FRONT_SHADE_FROM = 0.74;
const PROFILE_FRONT_SHADE_TO = 1.02;
/** The temple and cheekbone on the side plane catch the most light. */
const PROFILE_CHEEK_LIGHT = pt(0.3, -0.12);
const PROFILE_CHEEK_LIGHT_RX = 0.5;
const PROFILE_CHEEK_LIGHT_RY = 0.4;
const PROFILE_CHEEK_LIGHT_ALPHA = 0.8;
const PROFILE_SOCKET = pt(0.76, -0.06);
const PROFILE_SOCKET_RX = 0.24;
const PROFILE_SOCKET_RY = 0.16;
const PROFILE_SOCKET_ALPHA = 0.9;
const PROFILE_CHEEK_UNDER: readonly Pt[] = [pt(0.3, 0.16), pt(0.78, 0.36), pt(0.66, 0.5)];
const PROFILE_NOSE_SHADOW = pt(0.92, 0.3);
const PROFILE_NOSE_SHADOW_RX = 0.14;
const PROFILE_NOSE_SHADOW_RY = 0.06;
const PROFILE_NOSE_BRIDGE_FROM = pt(0.95, -0.12);
const PROFILE_NOSE_BRIDGE_TO = pt(1.1, 0.16);
const PROFILE_NOSE_BRIDGE_WIDTH = 0.014;
const PROFILE_NOSE_BRIDGE_ALPHA = 0.8;
const PROFILE_LIP_DIP = pt(0.86, 0.72);
const PROFILE_LIP_DIP_RX = 0.12;
const PROFILE_LIP_DIP_RY = 0.06;
const PROFILE_CHIN_LIGHT = pt(0.74, 0.95);
const PROFILE_CHIN_LIGHT_RX = 0.18;
const PROFILE_CHIN_LIGHT_RY = 0.12;
const PROFILE_JAW_LIGHT_FROM = pt(-0.26, 0.94);
const PROFILE_JAW_LIGHT_TO = pt(0.68, 1.1);

/** The planes of the face edge-on, painted inside the skull's clip. */
function paintFacePlanesProfile(ctx: Ctx): void {
  fillSoftEllipse(
    ctx,
    HEAD_DEPTH * PROFILE_CHEEK_LIGHT.x,
    HEAD_RY * PROFILE_CHEEK_LIGHT.y,
    HEAD_DEPTH * PROFILE_CHEEK_LIGHT_RX,
    HEAD_RY * PROFILE_CHEEK_LIGHT_RY,
    SKIN.light,
    PROFILE_CHEEK_LIGHT_ALPHA,
  );
  const front = ctx.createLinearGradient(
    HEAD_DEPTH * PROFILE_FRONT_SHADE_FROM,
    0,
    HEAD_DEPTH * PROFILE_FRONT_SHADE_TO,
    0,
  );
  front.addColorStop(0, rgba(SKIN.mid, 0));
  front.addColorStop(1, SKIN.mid);
  ctx.fillStyle = front;
  ctx.fillRect(
    0,
    -HEAD_RY * PLANE_OVERREACH,
    HEAD_DEPTH * PLANE_OVERREACH,
    HEAD_RY * PLANE_OVERREACH * 2,
  );

  ctx.fillStyle = rgba(SKIN.mid, CHEEK_UNDER_ALPHA);
  fillPolygon(ctx, PROFILE_CHEEK_UNDER, HEAD_DEPTH, HEAD_RY);
  fillSoftEllipse(
    ctx,
    HEAD_DEPTH * PROFILE_SOCKET.x,
    HEAD_RY * PROFILE_SOCKET.y,
    HEAD_DEPTH * PROFILE_SOCKET_RX,
    HEAD_RY * PROFILE_SOCKET_RY,
    SKIN.dark,
    PROFILE_SOCKET_ALPHA,
    0,
    SOCKET_CORE,
  );
  fillFlatEllipse(
    ctx,
    HEAD_DEPTH * PROFILE_NOSE_SHADOW.x,
    HEAD_RY * PROFILE_NOSE_SHADOW.y,
    HEAD_DEPTH * PROFILE_NOSE_SHADOW_RX,
    HEAD_RY * PROFILE_NOSE_SHADOW_RY,
    SKIN.shadow,
    NOSE_SHADOW_ALPHA,
  );
  // The top of the nose faces up into the light.
  ctx.strokeStyle = rgba(SKIN.rim, PROFILE_NOSE_BRIDGE_ALPHA);
  ctx.lineWidth = PROFILE_NOSE_BRIDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(HEAD_DEPTH * PROFILE_NOSE_BRIDGE_FROM.x, HEAD_RY * PROFILE_NOSE_BRIDGE_FROM.y);
  ctx.lineTo(HEAD_DEPTH * PROFILE_NOSE_BRIDGE_TO.x, HEAD_RY * PROFILE_NOSE_BRIDGE_TO.y);
  ctx.stroke();
  fillFlatEllipse(
    ctx,
    HEAD_DEPTH * PROFILE_LIP_DIP.x,
    HEAD_RY * PROFILE_LIP_DIP.y,
    HEAD_DEPTH * PROFILE_LIP_DIP_RX,
    HEAD_RY * PROFILE_LIP_DIP_RY,
    SKIN.mid,
    LIP_DIP_ALPHA,
  );
  fillFlatEllipse(
    ctx,
    HEAD_DEPTH * PROFILE_CHIN_LIGHT.x,
    HEAD_RY * PROFILE_CHIN_LIGHT.y,
    HEAD_DEPTH * PROFILE_CHIN_LIGHT_RX,
    HEAD_RY * PROFILE_CHIN_LIGHT_RY,
    SKIN.light,
    CHIN_LIGHT_ALPHA,
  );
  ctx.strokeStyle = rgba(SKIN.rim, JAW_LIGHT_ALPHA);
  ctx.lineWidth = JAW_LIGHT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(HEAD_DEPTH * PROFILE_JAW_LIGHT_FROM.x, HEAD_RY * PROFILE_JAW_LIGHT_FROM.y);
  ctx.lineTo(HEAD_DEPTH * PROFILE_JAW_LIGHT_TO.x, HEAD_RY * PROFILE_JAW_LIGHT_TO.y);
  ctx.stroke();
}

// ── Features ─────────────────────────────────────────────────────────────────

/**
 * The face, laid out from the eyeline. A human's eyes sit halfway between
 * crown and chin; set lower, the head reads as an inflated cranium with a
 * small face hung underneath.
 */
const EYE_Y = 0;
const EYE_WIDTH = HEAD_RX * 0.4;
const EYE_RX = EYE_WIDTH / 2;
const EYE_RY = EYE_RX * 0.62;
/** Eyes sit one eye-width apart. */
const EYE_DX = EYE_WIDTH;
const IRIS_R = EYE_RX * 0.7;
/**
 * The sclera sits under the brow's shadow, so it is never white: a white
 * almond at this size reads as a pair of goggles.
 */
const SCLERA_SHADE = 0.62;
const SCLERA = mix(EYE_WHITE, SKIN.mid, SCLERA_SHADE);
/**
 * The iris under the brow's shadow, deepened so that head-on, where the eye
 * is about one screen pixel, it lands as a dark point in the skin — still
 * blue where the eye is drawn large enough to show it.
 */
const IRIS_SHADE = 0.6;
const IRIS_IN_SHADE = mix(IRIS, OUTLINE, IRIS_SHADE);
/**
 * The upper lid is the one real line on the eye. The lower lid is only the
 * edge of the sclera: stroked as well, the eye is a lens in a rim.
 */
const UPPER_LID_WIDTH = 0.016;
/**
 * The scowl lowers the upper lid and lifts the lower one. The lower lid's
 * rise is what separates irritated from sleepy: a drooping upper lid alone
 * reads as tired.
 */
const SCOWL_UPPER_CLOSE = 0.3;
const SCOWL_LOWER_RAISE = 0.55;
const EYE_SHUT_THRESHOLD = 0.2;
const EYE_LOOK_TRAVEL = 0.4;
/**
 * The eye is much shorter than it is wide, so an iris lifted by the sideways
 * travel's share would leave the socket; this keeps a sliver of it under the lid.
 */
const EYE_LOOK_UP_TRAVEL = 0.7;
/** The inner corner sits a little lower than the outer one. */
const EYE_CANTHAL_TILT = 0.18;

interface EyeSpec {
  readonly cx: number;
  readonly cy: number;
  /** Half the eye's width; narrower edge-on. */
  readonly rx: number;
  /** +1 when the eye's outer corner is toward +X. */
  readonly outward: number;
  readonly look: number;
  readonly lookUp: number;
  readonly blink: number;
  readonly scowl: number;
  /** False where the iris is too small to hold a colour and is painted as a dark mark. */
  readonly irisColoured: boolean;
  /**
   * Whether the white of the eye is painted. Head-on each eye is about one
   * screen pixel, and a sclera there only averages with the iris into a pale
   * grey pixel; two of those either side of the nose, under the brows, read as
   * the lenses of sunglasses. Without it the eye is a dark point in the skin.
   */
  readonly sclera: boolean;
}

function traceEyeOpening(ctx: Ctx, eye: EyeSpec, top: number, bottom: number): void {
  const inner = pt(eye.cx - eye.outward * eye.rx, eye.cy + EYE_RY * EYE_CANTHAL_TILT);
  const outer = pt(eye.cx + eye.outward * eye.rx, eye.cy - EYE_RY * EYE_CANTHAL_TILT);
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  // A quadratic's apex sits halfway to its control point, hence the doubling.
  ctx.quadraticCurveTo(eye.cx, eye.cy - top * 2, outer.x, outer.y);
  ctx.quadraticCurveTo(eye.cx, eye.cy + bottom * 2, inner.x, inner.y);
  ctx.closePath();
}

/**
 * An eye: an almond of shaded sclera, the iris, and a heavy upper lid line.
 * No ring round it — a closed outline round a small eye reads as spectacles.
 */
function drawEye(ctx: Ctx, eye: EyeSpec): void {
  const openness = 1 - eye.blink;
  const top = EYE_RY * openness * (1 - eye.scowl * SCOWL_UPPER_CLOSE);
  const bottom = EYE_RY * openness * (1 - eye.scowl * SCOWL_LOWER_RAISE);

  if (openness > EYE_SHUT_THRESHOLD) {
    if (eye.sclera) {
      traceEyeOpening(ctx, eye, top, bottom);
      ctx.fillStyle = SCLERA;
      ctx.fill();
    }
    withClip(
      ctx,
      () => traceEyeOpening(ctx, eye, top, bottom),
      () => {
        const irisX = eye.cx + eye.look * eye.rx * EYE_LOOK_TRAVEL;
        const irisY = eye.cy - eye.lookUp * EYE_RY * EYE_LOOK_UP_TRAVEL;
        ctx.beginPath();
        ctx.arc(irisX, irisY, IRIS_R, 0, TWO_PI);
        // No pupil: at a pixel and a half across, a pupil covers the iris
        // and the eye reads grey rather than blue.
        ctx.fillStyle = eye.irisColoured ? IRIS_IN_SHADE : OUTLINE;
        ctx.fill();
      },
    );
  }

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = UPPER_LID_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(eye.cx - eye.outward * eye.rx, eye.cy + EYE_RY * EYE_CANTHAL_TILT);
  ctx.quadraticCurveTo(
    eye.cx,
    eye.cy - top * 2,
    eye.cx + eye.outward * eye.rx,
    eye.cy - EYE_RY * EYE_CANTHAL_TILT,
  );
  ctx.stroke();
}

const BROW_Y = -HEAD_RY * 0.3;
const BROW_THICK = HEAD_RY * 0.19;
const BROW_LENGTH = EYE_WIDTH * 1.3;
/** How far the inner end of a brow drops below the outer one: the whole scowl. */
const BROW_ANGRY_TILT = 1.5;
const BROW_OUTER_LIFT = 0.5;
/** The brow tapers from its inner head to its tail. */
const BROW_TAIL_SHARE = 0.34;

/**
 * The scowl. The brow's inner end drops toward the bridge of the nose and sits
 * almost on the lid; brows angled the other way read as worried, which is the
 * one expression Carl never wears.
 */
function drawBrow(
  ctx: Ctx,
  cx: number,
  cy: number,
  outward: number,
  anger: number,
  shape: BrowShape,
): void {
  const innerDrop = anger * BROW_ANGRY_TILT * BROW_THICK;
  const halfLength = BROW_LENGTH * shape.length * 0.5;
  const inner = pt(cx - outward * halfLength, cy + innerDrop);
  const outer = pt(cx + outward * halfLength, cy - innerDrop * BROW_OUTER_LIFT);
  const thick = BROW_THICK * shape.thickness;
  fillCapsule(ctx, inner, outer, thick * 0.5, thick * shape.tail, shape.colour);
}

/** How a brow is drawn in one view, against {@link BROW_THICK} and {@link BROW_LENGTH}. */
interface BrowShape {
  readonly thickness: number;
  readonly length: number;
  /** The tail's width against the inner head's. */
  readonly tail: number;
  readonly colour: string;
}

/** Edge-on only one brow shows, and it has to carry the whole scowl alone. */
const PROFILE_BROW: BrowShape = {
  thickness: 1,
  length: 1,
  tail: BROW_TAIL_SHARE,
  colour: HAIR.deep,
};
/**
 * Head-on the brow sits this much higher than edge-on, so a row of skin
 * survives between brow and lid at the tile at the outer ends; the inner ends
 * still come down to the lid, which is the scowl.
 */
const FACING_BROW_RAISE = HEAD_RY * 0.07;
/**
 * Head-on two full-weight bars join with the sockets under them into one band
 * across the face, and read as a mask. Thinner, shorter and tapering to a fine
 * tail, they stay two brows — and they keep the darkest hair tone, because a
 * lighter brow averages into the skin at the tile and the scowl goes with it;
 * the angle carries the scowl.
 */
const FACING_BROW: BrowShape = {
  thickness: 0.85,
  length: 0.72,
  tail: 0.3,
  colour: HAIR.deep,
};

/** A short, hard mouth line: the width of the nose's wings and a little more, never a grin. */
/**
 * Set a clear band of lit upper lip below the nose: closer, the mouth line and
 * the shade under the nose merge into one dark bar across the lip, which at
 * the tile is a moustache on a man who shaves every day.
 */
const MOUTH_Y = HEAD_RY * 0.62;
const MOUTH_HALF_WIDTH = HEAD_RX * 0.24;
/** The corners pull down a touch: flat, unimpressed. */
const MOUTH_CORNER_DROP = HEAD_RY * 0.02;
const MOUTH_LINE_WIDTH = 0.016;
/**
 * The closed mouth is one of the few genuine dark marks on the face. In the
 * skin's own occlusion tone it straddles two pixel rows as a pink smear and
 * reads as a pout.
 */
const MOUTH_LINE_ALPHA = 0.85;
/**
 * The line is the skin's own rose occlusion pushed toward the mouth's
 * interior, not the brown-black ink: at the tile it is a pixel or two under
 * the nose, and in the hair's brown that mark is a moustache, where a dark
 * rose one is a mouth.
 */
const MOUTH_LINE_INTERIOR_SHARE = 0.5;
const MOUTH_LINE = mix(SKIN.deep, MOUTH_INNER, MOUTH_LINE_INTERIOR_SHARE);
/** The lower lip catches the key just under the mouth line; that lit edge is what makes the line a mouth. */
const LOWER_LIP_ROWS_DOWN = 1;
const LOWER_LIP_ALPHA = 0.55;
/** The lower lip is shorter than the mouth line: it stops short of the corners. */
const LOWER_LIP_SHARE = 0.6;
const MOUTH_OPEN_HEIGHT = HEAD_RY * 0.28;
const MOUTH_TEETH_THRESHOLD = 0.3;
const TEETH_SHARE = 0.5;
/** Edge-on the mouth runs from the lips back to its corner, about half its width. */
const PROFILE_MOUTH_FRONT = 0.97;
const PROFILE_MOUTH_BACK = 0.72;

function drawMouth(
  ctx: Ctx,
  left: number,
  right: number,
  cy: number,
  open: number,
  widthScale: number,
): void {
  const centre = (left + right) / 2;
  const halfWidth = ((right - left) / 2) * widthScale;
  if (open > MOUTH_TEETH_THRESHOLD) {
    const height = MOUTH_OPEN_HEIGHT * open;
    const traceOpen = (): void => {
      ctx.beginPath();
      ctx.ellipse(centre, cy + height * 0.5, halfWidth, height, 0, 0, TWO_PI);
    };
    traceOpen();
    ctx.fillStyle = MOUTH_INNER;
    ctx.fill();
    withClip(ctx, traceOpen, () => {
      ctx.fillStyle = TOOTH;
      ctx.fillRect(centre - halfWidth, cy - height * 0.5, halfWidth * 2, height * TEETH_SHARE);
    });
    return;
  }
  // The line is a pixel tall on the painter's own surface, and laid on a pixel
  // row rather than across two: straddling a row boundary it bakes as a
  // two-pixel grey-brown bar under the nose, which reads as a moustache.
  ctx.save();
  const onRow = snapToPixelRow(ctx, centre, cy);
  ctx.translate(onRow.x - centre, onRow.y - cy);
  ctx.strokeStyle = rgba(MOUTH_LINE, MOUTH_LINE_ALPHA);
  ctx.lineWidth = Math.max(MOUTH_LINE_WIDTH * (1 + open), onePixel(ctx));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centre - halfWidth, cy + MOUTH_CORNER_DROP);
  ctx.quadraticCurveTo(centre, cy - MOUTH_CORNER_DROP, centre + halfWidth, cy + MOUTH_CORNER_DROP);
  ctx.stroke();
  const lipHalf = halfWidth * LOWER_LIP_SHARE;
  ctx.strokeStyle = rgba(SKIN.light, LOWER_LIP_ALPHA);
  ctx.lineWidth = onePixel(ctx);
  ctx.beginPath();
  ctx.moveTo(centre - lipHalf, cy + onePixel(ctx) * LOWER_LIP_ROWS_DOWN);
  ctx.lineTo(centre + lipHalf, cy + onePixel(ctx) * LOWER_LIP_ROWS_DOWN);
  ctx.stroke();
  ctx.restore();
}

/**
 * The size of one pixel of the surface being painted, in the current units.
 * Carl is painted on a surface of the painter's own, so its transform is the
 * painter's and reading it does not make the art depend on the caller.
 */
function onePixel(ctx: Ctx): number {
  const m = ctx.getTransform();
  return 1 / Math.max(Math.hypot(m.a, m.b), DEGENERATE_SCALE);
}

/** `x, y` moved to the centre of the surface pixel row it falls in. */
function snapToPixelRow(ctx: Ctx, x: number, y: number): Pt {
  const m = ctx.getTransform();
  const device = m.transformPoint({ x, y });
  const snapped = m.inverse().transformPoint({ x: device.x, y: Math.floor(device.y) + HALF_PIXEL });
  return pt(snapped.x, snapped.y);
}

const HALF_PIXEL = 0.5;
const DEGENERATE_SCALE = 1e-9;

// ── Ears ─────────────────────────────────────────────────────────────────────

const EAR_Y = 0;
const EAR_RX = HEAD_RX * 0.26;
const EAR_RY = HEAD_RY * 0.3;
const EAR_OUT_FACING = 0.96;
const EAR_OUT_BACK = 0.98;
/** Edge-on the ear sits a little behind the head's centre. */
const PROFILE_EAR_X = -0.2;
/**
 * Edge-on the ear is as long as brow to nose base. At the head-on size it is a
 * pink dot mid-cheek that reads as a nose; at full length it reads as an ear.
 */
const PROFILE_EAR_LENGTH = 1.7;
const PROFILE_EAR_BREADTH = 1.05;
/** Its centre sits a little below the eye line, between brow and nose base. */
const PROFILE_EAR_Y = 0.06;
/** The ear's bowl, a step darker, forward and down of its centre. */
const EAR_BOWL_SHIFT = 0.25;
const EAR_BOWL_SCALE = 0.55;

function drawEar(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  bowl: string,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + rx * EAR_BOWL_SHIFT,
    cy + ry * EAR_BOWL_SHIFT,
    rx * EAR_BOWL_SCALE,
    ry * EAR_BOWL_SCALE,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = bowl;
  ctx.fill();
}

/**
 * Edge-on the ear is the landmark that says "side of a head", and it sits on
 * the lit side plane in the same skin as the cheek, so on its own it is a
 * blob. A shadowed crease along its front edge where it joins the head, a lit
 * helix round its top and back, and a dark bowl make it an ear.
 */
const PROFILE_EAR_CREASE_WIDTH = 0.012;
const PROFILE_EAR_CREASE_ALPHA = 0.8;
const PROFILE_HELIX_WIDTH = 0.012;
const PROFILE_HELIX_ALPHA = 0.85;
/** The helix runs from over the top of the ear round its back, in radians. */
const HELIX_FROM = deg(200);
const HELIX_TO = deg(100);
const EAR_FRONT_FROM = deg(-70);
const EAR_FRONT_TO = deg(60);

/**
 * Edge-on the ear's bowl sits in the shadow step, not the half-tone: in the
 * rose half-tone the whole ear is one soft pink patch the size of a cheek, and
 * it reads as blusher rather than as an ear.
 */
const PROFILE_EAR_BOWL = SKIN.dark;

function drawProfileEar(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  drawEar(ctx, cx, cy, rx, ry, SKIN.base, PROFILE_EAR_BOWL);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(SKIN.shadow, PROFILE_EAR_CREASE_ALPHA);
  ctx.lineWidth = PROFILE_EAR_CREASE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, EAR_FRONT_FROM, EAR_FRONT_TO);
  ctx.stroke();
  ctx.strokeStyle = rgba(SKIN.light, PROFILE_HELIX_ALPHA);
  ctx.lineWidth = PROFILE_HELIX_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, HELIX_TO, HELIX_FROM);
  ctx.stroke();
  ctx.restore();
}

// ── Hair ─────────────────────────────────────────────────────────────────────

/**
 * The hair's ramp, a step down the brown: laid in at the ramp's own base it
 * reads as ginger under the key, and his hair is plain brown.
 */
const HAIR_TONE: Ramp = {
  deep: HAIR.deep,
  shadow: HAIR.deep,
  dark: HAIR.shadow,
  mid: HAIR.dark,
  base: HAIR.mid,
  light: HAIR.base,
  rim: HAIR.light,
};

/** Many small tufts, not a few tall spikes. */
const HAIR_TUFTS = 8;
const HAIR_TUFT_HEIGHT = HEAD_RY * 0.3;
const HAIR_SPIKE_LEAN = 0.4;
/**
 * Where the hair meets the side of the head: below the top of the ear, so the
 * crop covers the temple, but above the ear's middle, so the ear still shows
 * beneath it. Carried past the ear entirely the hair swallows it.
 */
const HAIRLINE_TEMPLE_Y = -0.24;
/**
 * The brow sits at −0.3 HEAD_RY, so the hairline has to clear it by a real
 * margin or he has no forehead — a crop with no forehead under it reads as
 * headgear rather than hair.
 */
const HAIRLINE_CROWN_Y = -0.72;
/** How far out the hairline turns down toward the temple. */
const HAIRLINE_CORNER = 0.82;
/** Where the straight run of the hairline ends and the temple corner begins. */
const HAIRLINE_STRAIGHT = 0.34;
/** The skull's half-width at brow height, as a fraction of its widest. */
const BROW_ON_SKULL = Math.sqrt(Math.max(0, 1 - HAIRLINE_CROWN_Y * HAIRLINE_CROWN_Y));

/**
 * Edge-on, the temple: the hairline turns back from the brow into the temple
 * corner and then drops nearly straight to the sideburn. Run as one long
 * diagonal from the brow to the ear instead, the side of the crop reads as a
 * fringe swept across the head — longer hair than the front view shows.
 */
const TEMPLE_CORNER_X = 0.44;
const TEMPLE_CORNER_Y = -0.6;
const TEMPLE_TURN_X = 0.52;
const TEMPLE_DROP_X = 0.36;
/**
 * The sideburn's front edge. The ear sits a shade *behind* centre at
 * `PROFILE_EAR_X`, so the sideburn belongs just forward of that — out where
 * the head is widest it lands on his cheek and reads as a chinstrap.
 */
const SIDEBURN_X = 0.2;
/** Its tip: a short drop past the hairline, level with the top of the ear. */
const SIDEBURN_TIP_Y = -0.1;
/** Where it rejoins the hairline, behind the sideburn. */
const SIDEBURN_BACK_X = -0.04;
/** The hairline clears the top of the ear (which reaches −0.3) by a little. */
const ABOVE_EAR_Y = -0.36;
/**
 * …and then runs a little way down the back of the skull. Only a little: a
 * deep nape reads as a mullet rather than as a haircut.
 */
const PROFILE_NAPE_Y = 0;
/** How far back the hairline holds its height before dropping to the nape. */
const PROFILE_NAPE_BEND = 0.3;
/** A shallow widow's peak, so the brow line is not dead flat. */
const HAIRLINE_PEAK = 0.07;
/** Half-width of the crop against the skull it sits on, head-on and edge-on. */
const HAIR_HALF_FACING = 1.0;
const HAIR_HALF_PROFILE = 1.02;

/** How far down the back of the head the crop reaches. */
const BACK_HAIR_COVERAGE = 0.42;
/** Half-width at the crop's lower corners, following the skull as it narrows. */
const BACK_HAIR_SIDE = 0.7;
/**
 * How far the lower edge reaches at the centre of the nape, against how far it
 * reaches beside the ears. Over 1, because a nape hairline dips *down* in the
 * middle of the neck and lifts toward the ears — inverted it curves like a
 * chinstrap. At 1 exactly the edge is straight, which reads as a moulded rim.
 */
const BACK_HAIR_NAPE_DROP = 1.3;
const NAPE_TUFTS = 7;
/** Unevenness along the nape, in head radii. Hair does not end on a curve. */
const NAPE_WOBBLE = 0.16;
/** Keeps the nape's noise off the same row the crown tufts draw from. */
const NAPE_NOISE_ROW = 5;
/** The crown arc the tufts root along, in radians around the head centre. */
const HAIR_ARC_START = deg(200);
const HAIR_ARC_END = deg(340);
/** Edge-on the crop reaches further down the back and stops at the brow. */
const PROFILE_ARC_START = deg(200);
const PROFILE_ARC_END = deg(309);
/** The shortest tuft, at the ends of the crown arc, against the tallest in its middle. */
const HAIR_TUFT_MIN_SHARE = 0.55;
/**
 * Edge-on, the tufts grow toward the front: the hair is swept up off the
 * brow, so its tallest point is the front of the crop, and the back lies
 * short and flat. Tallest in the middle, as head-on, the side reads as a
 * bowl.
 */
const PROFILE_QUIFF_SHARE = 1.3;
/**
 * Edge-on the back of the crop lies close to the skull. Standing off it as far
 * as the crown tufts do, it adds a bulge behind the occiput that makes the head
 * read deeper than his chest.
 */
const PROFILE_BACK_TUFT_SHARE = 0.3;

/** Hair stands off the skull; flush to it the crop has no volume at all. */
const HAIR_CAP_LIFT = 1.05;
const HAIR_CROWN_FLATNESS = 0.62;
const HAIR_TUFT_TILT = 1.1;
/** Just enough unevenness to keep the edge from reading as a moulded helmet. */
const HAIR_TUFT_WOBBLE = 0.6;
const HAIR_SWEEP_BACK = 0.7;
/** The hair's form is shaded like the skull under it: a ball, softly turned. */
const HAIR_TERMINATOR = 0.72;
const HAIR_SOFTNESS = 2.4;

/**
 * The crown of a head of hair is not a circle — it runs flat across the top and
 * turns down hard at the corners. Raising the circle's height to a power under
 * one squares it off exactly that much; drawn round, the crop reads as a cap
 * pulled over the skull.
 */
function crownProfile(angle: number): number {
  const height = Math.sin(angle);
  return -Math.pow(Math.abs(height), HAIR_CROWN_FLATNESS);
}

/**
 * The hair: one mass with a jagged top edge, not a cap with separate spikes
 * standing on it. Spikes drawn as individual shapes rooted along the skull's
 * rim read as a crown — the silhouette has to be the hair itself.
 *
 * `flow` leans the whole crop sideways; in profile it sweeps back off the face.
 */
function drawHair(ctx: Ctx, profile: boolean, flow: number, fromBehind: boolean, tipLag: Pt): void {
  const half = profile ? HEAD_DEPTH * HAIR_HALF_PROFILE : HEAD_RX * HAIR_HALF_FACING;
  const templeY = HEAD_RY * (fromBehind ? BACK_HAIR_COVERAGE : HAIRLINE_TEMPLE_Y);
  const crownY =
    HEAD_RY * (fromBehind ? BACK_HAIR_COVERAGE * BACK_HAIR_NAPE_DROP : HAIRLINE_CROWN_Y);
  const sweep = (profile ? -HAIR_SWEEP_BACK : 0) + flow * HAIR_SPIKE_LEAN;

  // The crop is one soft mass with an uneven edge, drawn as a curve through a
  // ring of small tufts. Straight lines between tall peaks and deep notches
  // would give him a crown of thorns, not hair.
  // Edge-on the crop has to stop where the hairline starts. Carried round to the
  // same angle the head-on view uses, its front end juts out past the brow and
  // the hairline then cuts back up behind it — an overhang over his face.
  const arcStart = profile ? PROFILE_ARC_START : HAIR_ARC_START;
  const arcEnd = profile ? PROFILE_ARC_END : HAIR_ARC_END;
  const tufts: Pt[] = [];
  for (let i = 0; i <= HAIR_TUFTS; i++) {
    const t = i / HAIR_TUFTS;
    const angle = lerp(arcStart, arcEnd, t);
    const wobble = 1 + (printHash(i, 0) - 0.5) * HAIR_TUFT_WOBBLE;
    const share = profile
      ? lerp(PROFILE_BACK_TUFT_SHARE, PROFILE_QUIFF_SHARE, t)
      : lerp(HAIR_TUFT_MIN_SHARE, 1, hump(t));
    const lift = HAIR_TUFT_HEIGHT * share * wobble;
    const outX = Math.cos(angle) + sweep;
    const outY = Math.sin(angle) * HAIR_TUFT_TILT;
    // The lag moves the free tips only; the tallest tufts, in the middle of
    // the crown, swing furthest.
    const lagShare = lift / HAIR_TUFT_HEIGHT;
    tufts.push(
      pt(
        Math.cos(angle) * half + outX * lift + tipLag.x * lagShare,
        crownProfile(angle) * HEAD_RY * HAIR_CAP_LIFT + outY * lift + tipLag.y * lagShare,
      ),
    );
  }

  const backStartY = profile ? HEAD_RY * PROFILE_NAPE_Y : templeY;
  /**
   * Where the crop's lower corners sit, seen from behind. On the skull, which
   * at that height is only ~0.69 of its widest — carried out to the full
   * half-width the silhouette is widest at its lowest point, which is a bowl
   * sitting on his head however ragged its edge is.
   */
  const backSideX = half * BACK_HAIR_SIDE;

  const traceHair = (): void => {
    ctx.beginPath();
    ctx.moveTo(profile ? -half : -backSideX, backStartY);
    ctx.lineTo(tufts[0].x, tufts[0].y);
    for (let i = 1; i < tufts.length - 1; i++) {
      const mid = mixPt(tufts[i], tufts[i + 1], 0.5);
      ctx.quadraticCurveTo(tufts[i].x, tufts[i].y, mid.x, mid.y);
    }
    const lastTuft = tufts[tufts.length - 1];
    ctx.lineTo(lastTuft.x, lastTuft.y);
    if (profile) {
      // Edge-on the hairline is three different heights: the brow, where it
      // sits exactly where the front view puts it; a sideburn dropping in
      // front of the ear; and the nape, which runs a long way further down the
      // back of the skull. Closed at one height all round — which is what the
      // front view's hairline does — the crop reads as a bowl.
      // Edge-on the face is the head's front *edge*, so the brow hairline sits
      // at the crown height the front view shows across the forehead — not at
      // the temple height, which reads as a hood pulled down over his eyes. It
      // also has to sit *on* the skull: the head is an ellipse, and at brow
      // height it is only two-thirds as wide as it is at the ears, so a brow
      // point out at the full half-width hangs off the front of his face.
      ctx.lineTo(half * BROW_ON_SKULL, crownY);
      ctx.quadraticCurveTo(
        half * TEMPLE_TURN_X,
        crownY,
        half * TEMPLE_CORNER_X,
        HEAD_RY * TEMPLE_CORNER_Y,
      );
      ctx.quadraticCurveTo(
        half * TEMPLE_DROP_X,
        HEAD_RY * ABOVE_EAR_Y,
        half * SIDEBURN_X,
        HEAD_RY * ABOVE_EAR_Y,
      );
      ctx.quadraticCurveTo(-half * PROFILE_NAPE_BEND, HEAD_RY * ABOVE_EAR_Y, -half, backStartY);
    } else if (fromBehind) {
      // From behind the crop has to follow the curve of the skull; closed with
      // straight sides it reads as a box sitting on his shoulders.
      //
      // Both ends land back on `templeY`, where the path began. Ending anywhere
      // else leaves `closePath` to close the gap with a seam down one side of
      // his head below the ear.
      // The nape hairline is broken up the same way the crown is. Two clean
      // quadratics across the back of the head give it a moulded lower rim,
      // and a moulded rim on a smooth dome is a helmet — hair ends raggedly.
      const nape: Pt[] = [];
      for (let i = 0; i <= NAPE_TUFTS; i++) {
        const across = i / NAPE_TUFTS;
        const arch = Math.sin(across * Math.PI);
        const wobble = (printHash(i, NAPE_NOISE_ROW) - 0.5) * NAPE_WOBBLE * HEAD_RY;
        nape.push(pt(lerp(backSideX, -backSideX, across), lerp(templeY, crownY, arch) + wobble));
      }
      ctx.lineTo(backSideX, templeY);
      ctx.lineTo(nape[0].x, nape[0].y);
      for (let i = 1; i < nape.length - 1; i++) {
        const mid = mixPt(nape[i], nape[i + 1], 0.5);
        ctx.quadraticCurveTo(nape[i].x, nape[i].y, mid.x, mid.y);
      }
      const lastNape = nape[nape.length - 1];
      ctx.lineTo(lastNape.x, lastNape.y);
      ctx.lineTo(-backSideX, templeY);
    } else {
      // A hairline runs nearly straight across the brow and only turns down at
      // the temples. Bowed up through the middle it is a helmet brim.
      ctx.lineTo(half, templeY);
      ctx.quadraticCurveTo(half * HAIRLINE_CORNER, crownY, half * HAIRLINE_STRAIGHT, crownY);
      ctx.quadraticCurveTo(0, crownY + HEAD_RY * HAIRLINE_PEAK, -half * HAIRLINE_STRAIGHT, crownY);
      ctx.quadraticCurveTo(-half * HAIRLINE_CORNER, crownY, -half, templeY);
    }
    ctx.closePath();
  };

  traceHair();
  ctx.fillStyle = HAIR_TONE.base;
  ctx.fill();
  withClip(ctx, traceHair, () => {
    shadeClipped(ctx, HEAD_AXIS, HAIR_TONE, {
      halfWidth: half,
      terminator: HAIR_TERMINATOR,
      softness: HAIR_SOFTNESS,
    });
    drawHairClumps(ctx, profile ? 'profile' : fromBehind ? 'back' : 'front', half, flow, tipLag);
    if (profile || fromBehind) {
      // A short cut is tapered at the nape: the hair thins to the skin under it
      // rather than stopping as a solid edge, which from behind or edge-on reads
      // as hair long enough to rest on the collar.
      const taper = ctx.createLinearGradient(0, HEAD_RY * NAPE_TAPER_FROM_Y, 0, backStartY);
      taper.addColorStop(0, rgba(SKIN.mid, 0));
      taper.addColorStop(1, rgba(SKIN.mid, NAPE_TAPER_ALPHA));
      ctx.fillStyle = taper;
      ctx.fillRect(
        -half * PLANE_OVERREACH,
        HEAD_RY * NAPE_TAPER_FROM_Y,
        half * PLANE_OVERREACH * 2,
        HEAD_RY,
      );
    }
  });
  if (profile) drawSideburn(ctx, half);
}

/** Where the nape taper starts, and how far toward the skin it has gone at the crop's edge. */
const NAPE_TAPER_FROM_Y = -0.3;
const NAPE_TAPER_ALPHA = 0.6;

type HairSide = 'front' | 'back' | 'profile';

/**
 * The partings between clumps of hair: a few grooves combed in the direction
 * the hair lies, each with the lit lip a crease gets. Without them the crop is
 * one smooth shaded shell, and a smooth shell on a head is a helmet.
 *
 * Head-on and edge-on the grooves rise from the hairline and lean back over
 * the crown — hair swept up off the brow. From behind they fall from the
 * crown to the nape.
 */
const HAIR_CLUMPS = 4;
const HAIR_CLUMP_WIDTH = 0.011;
const HAIR_CLUMP_OPACITY = 0.7;
/** How far each groove wanders from its even spacing, as a share of that spacing. */
const HAIR_CLUMP_JITTER = 0.5;
const HAIR_CLUMP_NOISE_ROW = 9;
/** Head-on: grooves root along the hairline and run up to the crown, fanning inward. */
const FRONT_CLUMP_SPAN = 0.72;
const FRONT_CLUMP_ROOT_Y = -0.84;
const FRONT_CLUMP_TIP_Y = -1.18;
const FRONT_CLUMP_FAN = 0.6;
/** Edge-on: grooves rise off the brow and sweep back over the crown. */
const PROFILE_CLUMP_ROOT_X = 0.62;
const PROFILE_CLUMP_ROOT_Y = -0.84;
const PROFILE_CLUMP_RISE_Y = -1.18;
const PROFILE_CLUMP_TIP_X = -0.5;
const PROFILE_CLUMP_TIP_Y = -1.0;
const PROFILE_CLUMP_STAGGER = 0.2;
/** From behind: grooves fall from the crown to the nape, fanning out. */
const BACK_CLUMP_CROWN_Y = -1.05;
const BACK_CLUMP_NAPE_Y = 0.2;
const BACK_CLUMP_SPAN = 0.62;
const BACK_CLUMP_CROWN_SHARE = 0.25;
/** How far the pose's hair flow drags the groove tips sideways. */
const HAIR_CLUMP_FLOW = 0.3;

function drawHairClumps(ctx: Ctx, side: HairSide, half: number, flow: number, tipLag: Pt): void {
  const drift = flow * HAIR_CLUMP_FLOW * half + tipLag.x;
  // Every groove goes in one path, so the whole set costs one crease.
  const trace = (): void => {
    for (let i = 0; i < HAIR_CLUMPS; i++) {
      const even = (i + 0.5) / HAIR_CLUMPS;
      const jitter = ((printHash(i, HAIR_CLUMP_NOISE_ROW) - 0.5) * HAIR_CLUMP_JITTER) / HAIR_CLUMPS;
      const across = lerp(-1, 1, even + jitter);
      if (side === 'front') {
        const rootX = across * half * FRONT_CLUMP_SPAN;
        ctx.moveTo(rootX, HEAD_RY * FRONT_CLUMP_ROOT_Y);
        ctx.quadraticCurveTo(
          rootX,
          HEAD_RY * lerp(FRONT_CLUMP_ROOT_Y, FRONT_CLUMP_TIP_Y, 0.5),
          rootX * FRONT_CLUMP_FAN + drift,
          HEAD_RY * FRONT_CLUMP_TIP_Y,
        );
      } else if (side === 'profile') {
        const stagger = even * PROFILE_CLUMP_STAGGER;
        const rootX = HEAD_DEPTH * (PROFILE_CLUMP_ROOT_X - stagger * 2);
        const rootY = HEAD_RY * (PROFILE_CLUMP_ROOT_Y + stagger);
        ctx.moveTo(rootX, rootY);
        ctx.quadraticCurveTo(
          rootX,
          HEAD_RY * PROFILE_CLUMP_RISE_Y,
          HEAD_DEPTH * (PROFILE_CLUMP_TIP_X + stagger) + drift,
          HEAD_RY * (PROFILE_CLUMP_TIP_Y + stagger * 2),
        );
      } else {
        const napeX = across * half * BACK_CLUMP_SPAN;
        ctx.moveTo(napeX * BACK_CLUMP_CROWN_SHARE + drift, HEAD_RY * BACK_CLUMP_CROWN_Y);
        ctx.quadraticCurveTo(
          napeX,
          HEAD_RY * lerp(BACK_CLUMP_CROWN_Y, BACK_CLUMP_NAPE_Y, 0.5),
          napeX,
          HEAD_RY * BACK_CLUMP_NAPE_Y,
        );
      }
    }
  };
  crease(ctx, trace, HAIR_CLUMP_WIDTH, HAIR_TONE, HAIR_CLUMP_OPACITY);
}

/**
 * The tab of hair in front of the ear. Painted on its own, after the crop:
 * inside the crop's path its point is as narrow as a pixel and vanishes into
 * the shading.
 */
function drawSideburn(ctx: Ctx, half: number): void {
  const front = half * SIDEBURN_X;
  const back = half * SIDEBURN_BACK_X;
  const top = HEAD_RY * ABOVE_EAR_Y;
  const tip = HEAD_RY * SIDEBURN_TIP_Y;
  ctx.beginPath();
  ctx.moveTo(front, top);
  ctx.quadraticCurveTo(front, tip, (front + back) / 2, tip);
  ctx.quadraticCurveTo(back, tip, back, top);
  ctx.closePath();
  ctx.fillStyle = HAIR_TONE.dark;
  ctx.fill();
}

// ── Head ─────────────────────────────────────────────────────────────────────

const NO_LAG = pt(0, 0);

/** The back of the skull and the hair are shaded as one upright form, crown to chin. */
const HEAD_AXIS = { from: pt(0, -HEAD_RY), to: pt(0, HEAD_RY) };
/**
 * From behind there are no planes to carry the form, so the skull takes the
 * ball's roll-off: a skull turns away from the key gradually, and a crisp
 * line down the back of the head reads as a two-tone mask.
 */
const SKULL_TERMINATOR = 0.72;
const SKULL_SOFTNESS = 2.4;
/**
 * How far a fully pitched head moves its features up the face. The face is
 * the front of a ball turning about the ears, so tipping it back lifts every
 * feature by the sine of the pitch times the face's depth — about a third of
 * the head's height at the full lift.
 */
const FACE_PITCH_TRAVEL = HEAD_RY * 0.48;
/**
 * How much shorter the face draws at a full pitch, either way: the face plane
 * turning away from the camera foreshortens brow to chin by the cosine of the
 * pitch. It is what makes the move read as the head turning rather than as the
 * features sliding over a fixed skull.
 */
const FACE_PITCH_FORESHORTEN = 0.24;
/**
 * The hair's height as drawn against its own, per unit of pitch, scaled about
 * the top of the crop. Tipped back the crown turns away over the top and the
 * hairline climbs toward it; tucked, the crown turns toward the camera and the
 * crop reaches further down the forehead. The tuck is gentler, because the
 * temples then come down over the ears, which have to stay visible.
 */
const HAIR_PITCH_BACK = 0.55;
const HAIR_PITCH_TUCK = 0.22;
/** The top of the crop, which stays put while the hairline rides up or down. */
const HAIR_PITCH_PIVOT_Y = -HEAD_RY * 1.5;
/**
 * The underside of the jaw, which comes into view below the chin as the head
 * tips back: a plane facing the floor, out of the key but lifted by the
 * floor's bounce, so a half-tone — lighter than the throat's shadow below it,
 * which is what separates the two planes.
 */
const JAW_UNDERSIDE_ALPHA = 0.9;
const CHIN_EDGE_ALPHA = 0.7;
const CHIN_EDGE_WIDTH = 0.016;
/** How far past the skull the underside plane's fill reaches; the skull clip ends it. */
const JAW_UNDERSIDE_REACH = 3;
/** A head tipped back past this share of the full lift already shows its nostrils in full. */
const NOSTRIL_FULL_LIFT = 0.6;

/**
 * Pitches the face head-on: `lift` is the pose's `chinLift`. Features, face
 * planes and the jaw's underside are all painted inside this transform, so the
 * whole face turns together.
 */
function applyFacePitch(ctx: Ctx, lift: number): void {
  ctx.translate(0, -lift * FACE_PITCH_TRAVEL);
  ctx.scale(1, 1 - Math.abs(lift) * FACE_PITCH_FORESHORTEN);
}

/** The hair's vertical scale for a head-on pitch; see {@link HAIR_PITCH_BACK}. */
function hairPitchScale(lift: number): number {
  return lift > 0 ? 1 - lift * HAIR_PITCH_BACK : 1 - lift * HAIR_PITCH_TUCK;
}

/**
 * The jaw's underside below the pitched chin, down to the skull's own
 * silhouette. Nothing is painted for a level or tucked head: tucked, the chin
 * sinks toward the neck and the jaw's underside turns away.
 */
function paintJawUnderside(ctx: Ctx, lift: number): void {
  if (lift <= 0) return;
  ctx.save();
  applyFacePitch(ctx, lift);
  ctx.beginPath();
  traceJawEdgeFacing(ctx);
  ctx.lineTo(HEAD_RX * JAW_UNDERSIDE_REACH, HEAD_RY * JAW_UNDERSIDE_REACH);
  ctx.lineTo(-HEAD_RX * JAW_UNDERSIDE_REACH, HEAD_RY * JAW_UNDERSIDE_REACH);
  ctx.closePath();
  const shown = clamp01(lift / NOSTRIL_FULL_LIFT);
  ctx.fillStyle = rgba(SKIN.dark, JAW_UNDERSIDE_ALPHA * shown);
  ctx.fill();
  // The chin's lower edge still faces the key as it turns under, and that lit
  // lip is what separates the chin from the plane behind it.
  ctx.beginPath();
  traceJawEdgeFacing(ctx);
  ctx.strokeStyle = rgba(SKIN.light, CHIN_EDGE_ALPHA * shown);
  ctx.lineWidth = CHIN_EDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}
/** How far the eyes track sideways edge-on: toward the front, where he is looking. */
const PROFILE_EYE_LOOK = 0.4;
/** Edge-on the eye is set back from the brow, and seen at a steep angle it is half as wide. */
const PROFILE_EYE_X = 0.7;
const PROFILE_EYE_WIDTH_SHARE = 0.55;

/**
 * Where the profile eye is painted, in figure space: the landmark a gate
 * reads to prove the face is not hidden behind the near arm.
 */
export function profileEyeCentre(skeleton: Skeleton, pose: CarlPose): Pt {
  const inHead = rotate(pt(HEAD_DEPTH * PROFILE_EYE_X, EYE_Y), headAngle(pose));
  return pt(skeleton.headCentre.x + inHead.x, skeleton.headCentre.y + inHead.y);
}
const PROFILE_BROW_X = 0.74;
/** Edge-on the face points +X, so the outer corner of the eye and the brow's outer end point back. */
const PROFILE_OUTWARD = -1;

/** Draw the head in head-local space: origin at its centre, the face toward +X edge-on. */
export function drawHead(ctx: Ctx, pose: CarlPose, view: ViewSpec): void {
  const profile = view.profile;
  const lift = pose.chinLift ?? 0;
  ctx.save();
  // A head tipped back rides up on the neck as it turns, as well as turning.
  if (!profile && !view.showsBack) ctx.translate(0, -Math.max(0, lift) * HEAD_PITCH_RISE);
  paintHead(ctx, pose, view, lift);
  ctx.restore();
}

/** How far a fully tipped-back head rises on its neck, head-on. */
const HEAD_PITCH_RISE = HEAD_RY * 0.12;

function paintHead(ctx: Ctx, pose: CarlPose, view: ViewSpec, lift: number): void {
  const profile = view.profile;
  // The lag is given in figure space; the head is painted in its own rotated frame.
  const hairLag = rotate(pose.hairTuftLag ?? NO_LAG, -headAngle(pose));

  if (view.showsBack) {
    // Ears are the only thing that keeps a back-of-head from reading as a ball.
    for (const side of [-1, 1]) {
      drawEar(
        ctx,
        side * HEAD_RX * EAR_OUT_BACK,
        EAR_Y,
        EAR_RX,
        EAR_RY,
        side < 0 ? SKIN.base : SKIN.mid,
        SKIN.dark,
      );
    }
    traceSkullBack(ctx);
    ctx.fillStyle = SKIN.base;
    ctx.fill();
    withClip(
      ctx,
      () => traceSkullBack(ctx),
      () =>
        shadeClipped(ctx, HEAD_AXIS, SKIN, {
          halfWidth: HEAD_RX,
          terminator: SKULL_TERMINATOR,
          softness: SKULL_SOFTNESS,
        }),
    );
    drawHair(ctx, false, pose.hairFlow, true, hairLag);
    return;
  }

  // Far ears first, so the skull covers where they meet the head.
  if (!profile) {
    for (const side of [-1, 1]) {
      drawEar(
        ctx,
        side * HEAD_RX * EAR_OUT_FACING,
        EAR_Y,
        EAR_RX,
        EAR_RY,
        side < 0 ? SKIN.base : SKIN.mid,
        side < 0 ? SKIN.mid : SKIN.shadow,
      );
    }
  }

  const traceSkull = (): void => (profile ? traceSkullProfile(ctx) : traceSkullFacing(ctx));
  traceSkull();
  ctx.fillStyle = SKIN.base;
  ctx.fill();
  withClip(ctx, traceSkull, () => {
    if (profile) {
      paintFacePlanesProfile(ctx);
      return;
    }
    ctx.save();
    applyFacePitch(ctx, lift);
    paintFacePlanesFacing(ctx, lift);
    ctx.restore();
    paintJawUnderside(ctx, lift);
  });

  const anger = pose.brow;
  const mouthWidth = pose.mouthWidth ?? 1;
  if (profile) {
    const eyeX = HEAD_DEPTH * PROFILE_EYE_X;
    drawEye(ctx, {
      cx: eyeX,
      cy: EYE_Y,
      rx: EYE_RX * PROFILE_EYE_WIDTH_SHARE,
      outward: PROFILE_OUTWARD,
      look: PROFILE_EYE_LOOK,
      lookUp: pose.gazeUp ?? 0,
      blink: pose.blink,
      scowl: anger,
      irisColoured: false,
      sclera: true,
    });
    drawBrow(ctx, HEAD_DEPTH * PROFILE_BROW_X, BROW_Y, PROFILE_OUTWARD, anger, PROFILE_BROW);
    drawMouth(
      ctx,
      HEAD_DEPTH * PROFILE_MOUTH_BACK,
      HEAD_DEPTH * PROFILE_MOUTH_FRONT,
      MOUTH_Y,
      pose.mouth,
      mouthWidth,
    );
  } else {
    // Head-on a pitch has no in-plane angle, so tipping the head back shows as
    // the whole face riding up the skull and shortening, the jaw's underside
    // taking its place.
    ctx.save();
    applyFacePitch(ctx, lift);
    for (const side of [-1, 1]) {
      drawEye(ctx, {
        cx: side * EYE_DX,
        cy: EYE_Y,
        rx: EYE_RX,
        outward: side,
        look: pose.headTurn,
        lookUp: pose.gazeUp ?? 0,
        blink: pose.blink,
        scowl: anger,
        irisColoured: true,
        sclera: false,
      });
      drawBrow(ctx, side * EYE_DX, BROW_Y - FACING_BROW_RAISE, side, anger, FACING_BROW);
    }
    drawMouth(ctx, -MOUTH_HALF_WIDTH, MOUTH_HALF_WIDTH, MOUTH_Y, pose.mouth, mouthWidth);
    ctx.restore();
  }

  ctx.save();
  if (!profile) {
    ctx.translate(0, HAIR_PITCH_PIVOT_Y);
    ctx.scale(1, hairPitchScale(lift));
    ctx.translate(0, -HAIR_PITCH_PIVOT_Y);
  }
  drawHair(ctx, profile, pose.hairFlow, false, hairLag);
  ctx.restore();
  if (profile) {
    // After the hair: a short cut is trimmed round the top of the ear, so the
    // ear sits over the crop's edge rather than under it.
    drawProfileEar(
      ctx,
      HEAD_DEPTH * PROFILE_EAR_X,
      HEAD_RY * PROFILE_EAR_Y,
      EAR_RX * PROFILE_EAR_BREADTH,
      EAR_RY * PROFILE_EAR_LENGTH,
    );
  }
}
