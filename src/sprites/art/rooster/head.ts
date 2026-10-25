/**
 * The rooster's head: a small feathered skull, the upright scarlet comb, the
 * wattles swinging under a short hooked beak, a bare red face round a fierce
 * orange eye.
 *
 * The head is laid out once in its own three dimensions — forward along the
 * beak, across between the eyes, up — and projected through its turn from the
 * camera's line of sight. Profile, three-quarter and the back of the head are
 * then one drawing seen from three places, and a part is painted before or
 * after the skull by whether it faces the camera, so a head turning away hides
 * its far eye and its beak by construction rather than by a table of cases.
 */

import { clamp01, lerp, mix, rgba } from '../bipedArt';
import type { Ramp, RoosterBuildSpec } from './builds';
import {
  type Ctx,
  appendEllipse,
  appendPolygon,
  appendSmoothLoop,
  clipped,
  fillTrace,
  roundGradient,
  softSpot,
} from './paint';
import {
  HEAD_DEPTH_HALF,
  HEAD_HEIGHT_HALF,
  HEAD_WIDTH_HALF,
  type Pt,
  type RoosterPose,
  type RoosterSkeleton,
  pt,
} from './rig';

/** A point on the head: ahead along the beak, across toward his right, and up. */
interface HeadPoint {
  readonly forward: number;
  readonly across: number;
  readonly up: number;
}

interface Projected {
  readonly at: Pt;
  /** Toward the camera is positive. */
  readonly depth: number;
}

function project(p: HeadPoint, turn: number, size: number): Projected {
  const s = Math.sin(turn);
  const c = Math.cos(turn);
  return {
    at: pt((p.forward * s + p.across * c) * size, -p.up * size),
    depth: p.forward * c - p.across * s,
  };
}

// ── Layout, in head units at the big build's size ────────────────────────────

const BEAK_ROOT_FORWARD = 0.12;
const BEAK_TIP_FORWARD = 0.27;
const BEAK_ROOT_TOP = 0.075;
const BEAK_ROOT_BOTTOM = -0.065;
/** The hook: the upper mandible's tip curls down past the lower one. */
const BEAK_HOOK_DROP = 0.02;
/** How far back from the tip the hook's point curls under. */
const BEAK_HOOK_BACK = 0.015;
/** Where along the beak the culmen's arch is drawn, and how high it stands there against the root. */
const BEAK_CULMEN_AT = 0.5;
const BEAK_CULMEN_HEIGHT = 0.55;
/** The tip sits this share of the way down to the root's underside. */
const BEAK_TIP_DROP_SHARE = 0.55;
/** The line between the mandibles, as a share of the root's underside. */
const BEAK_GAPE_LINE = 0.35;
const BEAK_HALF_WIDTH = 0.06;
const BEAK_GAPE = 0.14;
/**
 * The lower mandible: narrower than the upper, ending short of its hook, and
 * swinging down from the root as the beak opens — its point further than its throat.
 */
const LOWER_BEAK_WIDTH = 0.8;
const LOWER_BEAK_SHORT = 0.05;
const LOWER_BEAK_DEPTH = 0.02;
const LOWER_BEAK_DROP = 1.6;
const LOWER_BEAK_THROAT_DROP = 0.6;
const MOUTH_INSIDE = '#5a1018';
/** The beak's highlight sits over its root and spreads a little past the beak's length. */
const BEAK_GLOSS_FORWARD = 0.05;
const BEAK_GLOSS_RADIUS = 0.12;
const NOSTRIL_FORWARD = 0.03;
const NOSTRIL_BELOW_TOP = 0.012;
const NOSTRIL_RX = 0.012;
const NOSTRIL_RY = 0.007;
const NOSTRIL_ALPHA = 0.8;

const EYE_FORWARD = 0.03;
const EYE_ACROSS = 0.1;
const EYE_UP = 0.025;
const EYE_RADIUS = 0.055;
/**
 * An eye this little toward the camera is round the edge of the skull and not
 * painted: a sliver of eye on the rim of the back of the head reads as a face
 * on the wrong side.
 */
const EYE_HIDDEN_DEPTH = 0.06;
const PUPIL_RADIUS = 0.02;
/** The bare red face round the eye, which is what makes a rooster's head read as one. */
const FACE_RADIUS = 0.08;
/** An eye turned to face the camera full on is round; one at the skull's edge narrows to this share. */
const EDGE_ON_NARROWING = 0.5;
/** Biases the eye's facing so a profile eye, which has no depth toward the camera, still draws full. */
const EYE_FACING_BIAS = 0.35;
/** A shut eye is a slit this share of an open one, ringed in the lid's dark line. */
const SHUT_LID_SHARE = 0.12;
const SHUT_LID_LINE = 0.004;
const EYE_RING_GROWTH = 1.18;
const OPEN_ENOUGH_FOR_IRIS = 0.2;
/** The pupil sits a little forward in the iris: he is looking ahead, not at the camera. */
const PUPIL_FORWARD = 0.15;
const CATCHLIGHT = '#fff6e0';
const CATCHLIGHT_OFFSET = pt(0.35, 0.4);
const CATCHLIGHT_SIZE = 0.24;
/**
 * The scowl: a dark wedge of brow over the eye, low toward the beak and high
 * behind, as (forward, up) in eye radii. It is what makes the eye fierce
 * rather than surprised.
 */
const BROW_OUTLINE: readonly (readonly [number, number])[] = [
  [-1.5, 1.55],
  [1.6, 0.55],
  [1.3, 1.2],
  [-0.6, 2],
];
const BROW_ALPHA = 0.9;
/** The skull sits a hair behind the head's centre, so the beak has room in front of it. */
const SKULL_BACK_SHIFT = 0.01;
const SKULL_SHADE_REACH = 1.1;

const WATTLE_FORWARD = 0.1;
const WATTLE_ACROSS = 0.03;
const WATTLE_TOP = -0.03;
const WATTLE_LENGTH = 0.17;
const WATTLE_HALF_WIDTH = 0.045;
/** How far a wattle swings back for a full lag. */
const WATTLE_SWING = 0.06;
/**
 * Seen from nearly straight behind the wattles are hidden by the throat: a red
 * lobe hanging under the back of the skull reads as a wound.
 */
const WATTLES_HIDDEN_BEHIND = -0.8;

/** The comb's base runs along the crown from just over the beak to the back of the skull. */
const COMB_FRONT = 0.13;
const COMB_BACK = -0.15;
const COMB_BASE_UP = 0.105;
const COMB_HEIGHT = 0.27;
/** The rear blade trails back off the last point, low over the nape. */
const COMB_BLADE_BACK = -0.2;
const COMB_BLADE_UP = 0.08;
/**
 * How deep the notches between the points run, against the comb's height. A
 * comb is a fleshy blade with lobes on top; notched deep it is a brush.
 */
const COMB_VALLEY_SHARE = 0.5;
const COMB_HALF_THICKNESS = 0.04;
/**
 * A comb flopped fully over curls this far from its base to its points: a
 * floppy comb is a soft blade that stands at the root and folds over at the
 * top, its points hanging down the side of his head below the fold. Tipped over whole like a lid,
 * it shows edge-on in profile as a flat red band, a headband.
 */
const COMB_FLOP_CURL = Math.PI * 1.5;

const MIDDLE = 0.5;
/**
 * The comb's points rise along an arch that peaks a little behind the front,
 * the shortest at either end standing this share of the tallest.
 */
const COMB_SHORTEST_POINT = 0.62;
const COMB_ARCH_START = 0.25;
const COMB_ARCH_SPAN = 0.6;
/** The front and rear points sit just inside the blade's own ends. */
const COMB_FRONT_INSET = 0.02;
const COMB_BACK_INSET = 0.03;
/**
 * How far each point leans out to the side, per unit of its height,
 * alternately one way and the other. Edge-on to the camera a flat blade stacks
 * its points into one rounded cap; splayed a little, as a thick fleshy comb's
 * are, they stand apart as a row of points from any side. Fanned in one sweep
 * from front to back instead, they close into a single cone as the head turns.
 */
const COMB_POINT_FAN = 0.3;
/** How far the comb's tips trail back for a full lag of the head. */
const COMB_LAG = 0.04;

/** The wet gloss on the comb's lit side, just under its tallest point. */
const COMB_GLOSS_OFFSET = pt(0.03, 0.05);
const COMB_GLOSS_RX = 0.07;
const COMB_GLOSS_RY = 0.04;
const COMB_GLOSS_ALPHA = 0.55;

/** Each point's height against the comb's tallest, front to back. */
function combPointHeight(index: number, count: number): number {
  const t = count === 1 ? MIDDLE : index / (count - 1);
  const arch = Math.sin(Math.PI * (COMB_ARCH_START + t * COMB_ARCH_SPAN));
  return COMB_SHORTEST_POINT + (1 - COMB_SHORTEST_POINT) * arch;
}

interface HeadPaintOptions {
  readonly skeleton: RoosterSkeleton;
  readonly pose: RoosterPose;
  readonly build: RoosterBuildSpec;
}

/** The comb's silhouette as projected head points, base front to base back. */
function combOutline(
  turn: number,
  size: number,
  build: RoosterBuildSpec,
  pose: RoosterPose,
  across: number,
  flopSide: number,
): Pt[] {
  const curl = build.carriage.combFlop * COMB_FLOP_CURL;
  const height = COMB_HEIGHT * build.proportions.combHeight;
  const lag = pose.wattleLag * COMB_LAG;
  // A blade of even curvature: a point `h` along it has turned `curl * h / height`.
  const curled = (h: number): { readonly side: number; readonly rise: number } => {
    if (curl === 0) return { side: 0, rise: h };
    const radius = height / curl;
    const turned = curl * (h / height);
    return {
      side: flopSide * radius * (1 - Math.cos(turned)),
      rise: radius * Math.sin(turned),
    };
  };
  const up = (forward: number, h: number, fan = 0): Pt => {
    const along = curled(h);
    return project(
      {
        forward: forward - lag * (h / COMB_HEIGHT),
        across: across + along.side + fan * h,
        up: COMB_BASE_UP + along.rise,
      },
      turn,
      size,
    ).at;
  };
  const count = build.proportions.combPoints;
  const points: Pt[] = [up(COMB_FRONT, 0)];
  for (let i = 0; i < count; i++) {
    const t = (i + MIDDLE) / count;
    const forward = lerp(COMB_FRONT - COMB_FRONT_INSET, COMB_BACK + COMB_BACK_INSET, t);
    const valley = lerp(COMB_FRONT, COMB_BACK, (i + 1) / count);
    const fan = i % 2 === 0 ? COMB_POINT_FAN : -COMB_POINT_FAN;
    points.push(up(forward, height * combPointHeight(i, count), fan));
    if (i < count - 1) points.push(up(valley, height * COMB_VALLEY_SHARE));
  }
  points.push(up(COMB_BLADE_BACK, COMB_BLADE_UP * build.proportions.combHeight));
  points.push(up(COMB_BACK, 0));
  return points;
}

function drawComb(ctx: Ctx, turn: number, size: number, options: HeadPaintOptions): void {
  const { build, pose } = options;
  const ramp = build.palette.comb;
  const near = Math.cos(turn) >= 0 ? -1 : 1;
  // A flopped comb falls over toward the camera: folded the far way, the head
  // hides it and all that shows is a low red edge along the crown, a headband.
  const far = combOutline(turn, size, build, pose, COMB_HALF_THICKNESS * near * -1, near);
  const front = combOutline(turn, size, build, pose, COMB_HALF_THICKNESS * near, near);
  fillTrace(ctx, () => appendSmoothLoop(ctx, far), ramp.dark);
  // The blade's own thickness: seen edge-on both faces collapse to a line, and
  // the band between their outlines is the whole comb.
  for (let i = 0; i < front.length - 1; i++) {
    fillTrace(
      ctx,
      () => appendPolygon(ctx, [far[i], far[i + 1], front[i + 1], front[i]]),
      i % 2 === 0 ? ramp.mid : ramp.dark,
    );
  }
  const trace = (): void => appendSmoothLoop(ctx, front);
  const top = front.reduce((best, p) => (p.y < best.y ? p : best), front[0]);
  fillTrace(
    ctx,
    trace,
    roundGradient(ctx, pt(top.x, top.y + COMB_HEIGHT * size * MIDDLE), COMB_HEIGHT * size, ramp),
  );
  clipped(ctx, trace, () => {
    softSpot(
      ctx,
      pt(top.x - COMB_GLOSS_OFFSET.x * size, top.y + COMB_GLOSS_OFFSET.y * size),
      COMB_GLOSS_RX * size,
      COMB_GLOSS_RY * size,
      0,
      ramp.rim,
      COMB_GLOSS_ALPHA,
    );
  });
}

function drawWattle(
  ctx: Ctx,
  side: number,
  turn: number,
  size: number,
  options: HeadPaintOptions,
): void {
  const { build, pose } = options;
  const ramp = build.palette.comb;
  const top = project(
    { forward: WATTLE_FORWARD, across: side * WATTLE_ACROSS, up: WATTLE_TOP },
    turn,
    size,
  );
  const swing = pose.wattleLag * WATTLE_SWING;
  const bottom = project(
    {
      forward: WATTLE_FORWARD - swing,
      across: side * WATTLE_ACROSS,
      up: WATTLE_TOP - WATTLE_LENGTH,
    },
    turn,
    size,
  );
  const centre = pt((top.at.x + bottom.at.x) / 2, (top.at.y + bottom.at.y) / 2);
  const length = Math.hypot(bottom.at.x - top.at.x, bottom.at.y - top.at.y);
  const angle = Math.atan2(bottom.at.y - top.at.y, bottom.at.x - top.at.x);
  const shade = top.depth < 0 ? ramp.dark : ramp.mid;
  const trace = (): void => appendEllipse(ctx, centre, length / 2, WATTLE_HALF_WIDTH * size, angle);
  fillTrace(ctx, trace, top.depth < 0 ? shade : roundGradient(ctx, centre, length / 2, ramp));
}

function drawBeak(ctx: Ctx, turn: number, size: number, options: HeadPaintOptions): void {
  const { build, pose } = options;
  const ramp = build.palette.beak;
  const open = clamp01(pose.beakOpen) * BEAK_GAPE;
  const at = (forward: number, across: number, up: number): Pt =>
    project({ forward, across, up }, turn, size).at;
  // The upper mandible: a deep root under the brow, a culmen arching down to
  // the tip, and the tip hooked down past the lower mandible. Deep at the root
  // and short, or at the tile it is a stick poking out of the face.
  const tip = at(BEAK_TIP_FORWARD, 0, BEAK_ROOT_BOTTOM * BEAK_TIP_DROP_SHARE);
  const upper = [
    at(BEAK_ROOT_FORWARD, -BEAK_HALF_WIDTH, BEAK_ROOT_TOP),
    at(BEAK_ROOT_FORWARD, BEAK_HALF_WIDTH, BEAK_ROOT_TOP),
    at(
      lerp(BEAK_ROOT_FORWARD, BEAK_TIP_FORWARD, BEAK_CULMEN_AT),
      0,
      BEAK_ROOT_TOP * BEAK_CULMEN_HEIGHT,
    ),
    tip,
    at(BEAK_TIP_FORWARD - BEAK_HOOK_BACK, 0, BEAK_ROOT_BOTTOM - BEAK_HOOK_DROP),
    at(
      lerp(BEAK_ROOT_FORWARD, BEAK_TIP_FORWARD, BEAK_CULMEN_AT),
      0,
      BEAK_ROOT_BOTTOM * BEAK_GAPE_LINE,
    ),
    at(BEAK_ROOT_FORWARD, BEAK_HALF_WIDTH, BEAK_ROOT_BOTTOM * BEAK_GAPE_LINE),
    at(BEAK_ROOT_FORWARD, -BEAK_HALF_WIDTH, BEAK_ROOT_BOTTOM * BEAK_GAPE_LINE),
  ];
  const lower = [
    at(BEAK_ROOT_FORWARD, -BEAK_HALF_WIDTH * LOWER_BEAK_WIDTH, BEAK_ROOT_BOTTOM * BEAK_GAPE_LINE),
    at(BEAK_TIP_FORWARD - LOWER_BEAK_SHORT, 0, BEAK_ROOT_BOTTOM - open * LOWER_BEAK_DROP),
    at(BEAK_ROOT_FORWARD, BEAK_HALF_WIDTH * LOWER_BEAK_WIDTH, BEAK_ROOT_BOTTOM * BEAK_GAPE_LINE),
    at(BEAK_ROOT_FORWARD, 0, BEAK_ROOT_BOTTOM - LOWER_BEAK_DEPTH - open * LOWER_BEAK_THROAT_DROP),
  ];
  if (open > 0) {
    const mouth = [upper[3], tip, lower[1], lower[3]];
    fillTrace(ctx, () => appendPolygon(ctx, mouth), MOUTH_INSIDE);
  }
  fillTrace(ctx, () => appendSmoothLoop(ctx, lower), ramp.dark);
  fillTrace(
    ctx,
    () => appendPolygon(ctx, upper),
    roundGradient(
      ctx,
      at(BEAK_ROOT_FORWARD + BEAK_GLOSS_FORWARD, 0, BEAK_ROOT_TOP),
      BEAK_GLOSS_RADIUS * size,
      ramp,
    ),
  );
  const nostril = at(BEAK_ROOT_FORWARD + NOSTRIL_FORWARD, 0, BEAK_ROOT_TOP - NOSTRIL_BELOW_TOP);
  fillTrace(
    ctx,
    () => appendEllipse(ctx, nostril, NOSTRIL_RX * size, NOSTRIL_RY * size, 0),
    rgba(ramp.deep, NOSTRIL_ALPHA),
  );
}

function drawEye(
  ctx: Ctx,
  side: number,
  turn: number,
  size: number,
  options: HeadPaintOptions,
): void {
  const { build, pose } = options;
  const eye = project({ forward: EYE_FORWARD, across: side * EYE_ACROSS, up: EYE_UP }, turn, size);
  if (eye.depth < EYE_HIDDEN_DEPTH) return;
  const facing = clamp01(eye.depth / EYE_ACROSS + EYE_FACING_BIAS);
  const comb = build.palette.comb;
  fillTrace(
    ctx,
    () =>
      appendEllipse(
        ctx,
        eye.at,
        FACE_RADIUS * size * lerp(EDGE_ON_NARROWING, 1, facing),
        FACE_RADIUS * size,
        0,
      ),
    comb.mid,
  );
  const squash = 1 - clamp01(pose.blink);
  const rx = EYE_RADIUS * size * lerp(EDGE_ON_NARROWING, 1, facing);
  const ry = EYE_RADIUS * size * Math.max(squash, SHUT_LID_SHARE);
  fillTrace(
    ctx,
    () => appendEllipse(ctx, eye.at, rx * EYE_RING_GROWTH, ry * EYE_RING_GROWTH + SHUT_LID_LINE, 0),
    build.palette.pupil,
  );
  if (squash > OPEN_ENOUGH_FOR_IRIS) {
    fillTrace(ctx, () => appendEllipse(ctx, eye.at, rx, ry, 0), build.palette.iris);
    const forwardSign = Math.sign(Math.sin(turn)) || 1;
    const pupil = pt(eye.at.x + forwardSign * rx * PUPIL_FORWARD, eye.at.y);
    fillTrace(
      ctx,
      () =>
        appendEllipse(
          ctx,
          pupil,
          PUPIL_RADIUS * size * lerp(EDGE_ON_NARROWING, 1, facing),
          PUPIL_RADIUS * size * squash,
          0,
        ),
      build.palette.pupil,
    );
    fillTrace(
      ctx,
      () =>
        appendEllipse(
          ctx,
          pt(eye.at.x - rx * CATCHLIGHT_OFFSET.x, eye.at.y - ry * CATCHLIGHT_OFFSET.y),
          rx * CATCHLIGHT_SIZE,
          ry * CATCHLIGHT_SIZE,
          0,
        ),
      CATCHLIGHT,
    );
  }
  const forwardSign = Math.sign(Math.sin(turn)) || 1;
  const brow = BROW_OUTLINE.map(([forward, up]) =>
    pt(eye.at.x + forwardSign * rx * forward, eye.at.y - ry * up),
  );
  fillTrace(ctx, () => appendPolygon(ctx, brow), rgba(comb.deep, BROW_ALPHA));
}

/**
 * How far the skull's feathers sit from the hackles' gold toward the back's
 * red. The short head feathers are darker than the long hackles below them; in
 * the hackles' own colour, seen from behind, head and neck run together into
 * one gold column with the comb on top.
 */
const SKULL_REDDENING = 0.5;

function skullRamp(build: RoosterBuildSpec): Ramp {
  const { hackle, back } = build.palette;
  return {
    deep: mix(hackle.deep, back.deep, SKULL_REDDENING),
    dark: mix(hackle.dark, back.dark, SKULL_REDDENING),
    mid: mix(hackle.mid, back.mid, SKULL_REDDENING),
    light: mix(hackle.light, back.light, SKULL_REDDENING),
    rim: mix(hackle.rim, back.rim, SKULL_REDDENING),
  };
}

/**
 * Paints the head about its own centre. The caller translates and rotates to
 * the head's place; everything here is in head units times the build's size.
 */
export function drawHead(ctx: Ctx, options: HeadPaintOptions): void {
  const { skeleton, build } = options;
  const size = build.proportions.headSize;
  const turn = skeleton.headTurn;
  const nearSide = Math.sin(turn) >= 0 ? -1 : 1;
  const ramp = skullRamp(build);
  const skullRx =
    Math.hypot(Math.sin(turn) * HEAD_DEPTH_HALF, Math.cos(turn) * HEAD_WIDTH_HALF) * size;
  const skullCentre = pt(Math.sin(turn) * -SKULL_BACK_SHIFT * size, 0);

  const beakFacesCamera =
    project({ forward: BEAK_TIP_FORWARD, across: 0, up: 0 }, turn, size).depth >= 0;
  if (!beakFacesCamera) drawBeak(ctx, turn, size, options);
  const wattlesShow = Math.cos(turn) > WATTLES_HIDDEN_BEHIND;
  if (wattlesShow) drawWattle(ctx, -nearSide, turn, size, options);
  drawEye(ctx, -nearSide, turn, size, options);

  const skull = (): void => appendEllipse(ctx, skullCentre, skullRx, HEAD_HEIGHT_HALF * size, 0);
  fillTrace(
    ctx,
    skull,
    roundGradient(ctx, skullCentre, HEAD_HEIGHT_HALF * size * SKULL_SHADE_REACH, ramp),
  );
  drawComb(ctx, turn, size, options);
  drawEye(ctx, nearSide, turn, size, options);
  if (wattlesShow) drawWattle(ctx, nearSide, turn, size, options);
  if (beakFacesCamera) drawBeak(ctx, turn, size, options);
}

/** The head's resting radius in rig units, for sizing the composing surface round it. */
export function headReach(build: RoosterBuildSpec): number {
  return (
    (COMB_HEIGHT * build.proportions.combHeight + HEAD_HEIGHT_HALF + BEAK_TIP_FORWARD) *
    build.proportions.headSize
  );
}

/** Where the near eye is in the head's own frame, for the eye-shine placement. */
export function eyeOffset(turn: number, size: number): Pt {
  const near = Math.sin(turn) >= 0 ? -1 : 1;
  return project({ forward: EYE_FORWARD, across: near * EYE_ACROSS, up: EYE_UP }, turn, size).at;
}

/** Where the beak's tip is in the head's own frame, for the peck's reach. */
export function beakTipOffset(turn: number, size: number): Pt {
  return project({ forward: BEAK_TIP_FORWARD, across: 0, up: BEAK_ROOT_BOTTOM }, turn, size).at;
}
