/**
 * Carl's bare feet: big, callused, and on the floor.
 *
 * Each view gets its own silhouette rather than one foot squashed three ways.
 * In profile the foot shows its whole heel-to-toe length, so a heel strike and
 * a toe-off read as the foot rolling over the floor. Head-on it is the top of
 * a foot coming at the camera: a short instep widening from the ankle to a row
 * of toes, with the big toe split off on the inside. From behind it is a heel.
 */

import { offset, pt, rotate, TWO_PI } from './geometry';
import { crease, shadeForm } from './paint';
import { type Ramp, receded, SKIN } from './palette';
import { ANKLE_WIDTH, FIGURE_HEIGHT } from './proportions';
import { type ViewSpec } from './rig';
import { lerp, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse } from '../softShade';

type Ctx = CanvasRenderingContext2D;

/**
 * Derived from his height, not from his head: a foot is about 15% of a figure,
 * and a foot hung off this character's deliberately oversized head is a clown
 * shoe.
 */
const FOOT_LEN = FIGURE_HEIGHT * 0.15;
/** A bare foot is about half as deep as it is long; thinner reads as a blade. */
const FOOT_DEPTH = FOOT_LEN * 0.5;
/**
 * How much of the foot lies behind the ankle. A bare heel is short — the ankle
 * sits well back over it — and a foot centred on its ankle reads as a shoe.
 */
const HEEL_SHARE = 0.22;
/** Head-on the foot comes at the camera, so it draws short and blunt. */
const FOOT_FORESHORTEN = 0.5;
/** A sole sits half the foot's depth below the ankle. */
const SOLE_DROP = 0.5;
/**
 * How deep the toe end is against the ankle. Thin, the front of the foot tapers
 * to a blade; a real foot keeps most of its depth all the way to the toes.
 */
const TOE_HEIGHT_SHARE = 0.38;

/**
 * Head-on a foot pointed down onto its toes cannot rotate in the picture: its
 * top turns to face the camera and the whole foot below the ankle draws that
 * much taller. At full point it is this much taller than flat. From behind a
 * pointed foot needs nothing of its own: the rig lifts the ankle, and the
 * heel, the only part of the foot seen, comes up off the floor with it.
 */
const POINTED_STRETCH = 0.9;

/** How much taller than flat a head-on foot pointed by `point` (0 to 1) is drawn. */
function pointedFootStretch(point: number): number {
  return 1 + Math.min(Math.max(point, 0), 1) * POINTED_STRETCH;
}

/**
 * How far a head-on foot pointed by `point` lifts its ankle to keep its sole
 * on the floor: the heel comes up and the leg with it.
 */
export function pointedAnkleRise(point: number): number {
  return FOOT_DEPTH * SOLE_DROP * (pointedFootStretch(point) - 1);
}

/** Feet turn outward, away from the centreline, on both sides. */
export const LEFT_FOOT_OUT = -1;
export const RIGHT_FOOT_OUT = 1;

/** Where a planted foot meets the floor: the middle of its sole, and half its length there. */
interface FootContact {
  readonly centre: Pt;
  readonly halfLength: number;
}

/**
 * The patch of floor a foot standing on its ankle presses: along the sole
 * from heel to toes, below the ankle by the sole's drop. From behind the foot
 * points away from the camera and shows only its heel, so it presses the
 * same patch the head-on view draws.
 */
export function footContact(
  ankle: Pt,
  view: ViewSpec,
  outward: number,
  scale: number,
): FootContact {
  const { toeX, heelX, sole } = footExtent(view.profile, outward);
  return {
    centre: pt(ankle.x + ((toeX + heelX) / 2) * scale, ankle.y + sole * scale),
    halfLength: (Math.abs(toeX - heelX) / 2) * scale,
  };
}

/** From behind the foot is a heel hung below the ankle: how far, and how round. */
const BACK_HEEL_DROP = 0.35;
const BACK_HEEL_RADIUS = 0.55;

/**
 * Thick, yellowed skin along the sole, where "he can barely feel the soles of
 * his feet". A warm step off the skin ramp rather than a darker one: callus is
 * paler and duller than the skin above it, never dirtier.
 */
const CALLUS = '#d2a773';
const CALLUS_ALPHA = 0.85;

/** Lays the callus tone over everything below `top`; the caller's clip ends it at the sole. */
function paintCallus(ctx: Ctx, left: number, top: number, width: number): void {
  ctx.save();
  ctx.globalAlpha *= CALLUS_ALPHA;
  ctx.fillStyle = CALLUS;
  ctx.fillRect(left, top, width, FOOT_DEPTH);
  ctx.restore();
}

/** The foot's length and the ankle-local positions of its sole line. */
function footExtent(profile: boolean, outward: number) {
  const length = profile ? FOOT_LEN : FOOT_LEN * FOOT_FORESHORTEN;
  const lead = profile ? 1 : outward;
  return {
    length,
    lead,
    toeX: length * (1 - HEEL_SHARE) * lead,
    heelX: -length * HEEL_SHARE * lead,
    sole: FOOT_DEPTH * SOLE_DROP,
    toeHalf: FOOT_DEPTH * TOE_HEIGHT_SHARE,
  };
}

/**
 * Where the heel and toe ends of the sole line land in figure space, for a foot
 * painted by {@link drawFoot} with the same arguments. Seen from behind no toe
 * is drawn, so both are the bottom of the heel.
 */
export function footSoleLandmarks(
  ankle: Pt,
  pitch: number,
  view: ViewSpec,
  outward: number,
  point = 0,
): { heel: Pt; toe: Pt } {
  if (view.showsBack) {
    const heelBottom = offset(
      ankle,
      0,
      FOOT_DEPTH * BACK_HEEL_DROP + FOOT_DEPTH * BACK_HEEL_RADIUS,
    );
    return { heel: heelBottom, toe: heelBottom };
  }
  const { toeX, heelX, sole: flatSole } = footExtent(view.profile, outward);
  const angle = view.profile ? pitch : 0;
  const sole = view.profile ? flatSole : flatSole * pointedFootStretch(point);
  const heel = rotate(pt(heelX, sole), angle);
  const toe = rotate(pt(toeX, sole), angle);
  return { heel: offset(ankle, heel.x, heel.y), toe: offset(ankle, toe.x, toe.y) };
}

/**
 * What a foot wears, beyond being bare: the toe ring on his right second toe,
 * and the shine a pedicure leaves on nails and instep. Absent is neither.
 */
export interface FootAccents {
  readonly toeRing?: boolean;
  readonly pedicure?: boolean;
}

const NO_ACCENTS: FootAccents = {};

/**
 * A bare foot drawn from the ankle, in the silhouette its view calls for.
 *
 * The toes are shaped in the outline and split by one crease, never drawn as
 * separate strokes: toe lines painted on top read as sandal straps, and Carl
 * is barefoot.
 */
export function drawFoot(
  ctx: Ctx,
  ankle: Pt,
  pitch: number,
  view: ViewSpec,
  outward: number,
  shade: number,
  accents: FootAccents = NO_ACCENTS,
  point = 0,
): void {
  const flesh = receded(SKIN, shade);
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  if (view.showsBack) drawHeelFromBehind(ctx, flesh);
  else if (view.profile) {
    ctx.rotate(pitch);
    drawFootInProfile(ctx, flesh, pitch, outward, accents);
  } else {
    ctx.scale(1, pointedFootStretch(point));
    drawFootHeadOn(ctx, flesh, outward, accents);
  }
  ctx.restore();
}

// ── Accents ──────────────────────────────────────────────────────────────────

/**
 * The toe ring: a thin gold band. At the tile it is one warm pixel on the
 * toes, which is all a toe ring should ever be.
 */
const RING_GOLD = '#d4a23a';
const RING_GLINT = '#fff0b8';
const RING_BAND_HALF = 0.022;
const RING_BAND_WIDTH = 0.018;
const RING_GLINT_RADIUS = 0.008;
/**
 * The pedicure's glitter: small, near-white specks on the nails and the
 * instep, faintly pink — polish rather than wet skin.
 */
const GLITTER = '#fff3f8';
const GLITTER_ALPHA = 0.9;
const NAIL_GLINT_RADIUS = 0.016;
const SPARKLE_ARM = 0.03;
const SPARKLE_WIDTH = 0.01;

/** A four-pointed sparkle: two crossed strokes, the glint a glittery surface throws. */
function paintSparkle(ctx: Ctx, at: Pt): void {
  ctx.strokeStyle = rgba(GLITTER, GLITTER_ALPHA);
  ctx.lineWidth = SPARKLE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(at.x - SPARKLE_ARM, at.y);
  ctx.lineTo(at.x + SPARKLE_ARM, at.y);
  ctx.moveTo(at.x, at.y - SPARKLE_ARM);
  ctx.lineTo(at.x, at.y + SPARKLE_ARM);
  ctx.stroke();
}

function paintNailGlints(ctx: Ctx, nails: readonly Pt[]): void {
  ctx.fillStyle = rgba(GLITTER, GLITTER_ALPHA);
  for (const nail of nails) {
    ctx.beginPath();
    ctx.arc(nail.x, nail.y, NAIL_GLINT_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

/** A band across a toe running along `across`, with the glint on its lit end. */
function paintRing(ctx: Ctx, centre: Pt, across: Pt): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = RING_GOLD;
  ctx.lineWidth = RING_BAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(centre.x - across.x * RING_BAND_HALF, centre.y - across.y * RING_BAND_HALF);
  ctx.lineTo(centre.x + across.x * RING_BAND_HALF, centre.y + across.y * RING_BAND_HALF);
  ctx.stroke();
  ctx.fillStyle = RING_GLINT;
  ctx.beginPath();
  ctx.arc(
    centre.x - across.x * RING_BAND_HALF * HALF_SHARE,
    centre.y - across.y * RING_BAND_HALF * HALF_SHARE,
    RING_GLINT_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();
}

const HALF_SHARE = 0.5;

// ── Profile ──────────────────────────────────────────────────────────────────

/** The Achilles leaves the ankle a little behind its centre and sweeps into the heel. */
const ACHILLES_BACK = 0.95;
const ACHILLES_TOP = 0.6;
/** The heel bulb swells behind the Achilles line before rounding onto the floor. */
const HEEL_BULB = 0.7;
const HEEL_BULB_DROP = 0.55;
const HEEL_FLOOR = 0.55;
/** The sole's run from heel to the ball of the foot, where the toe block starts. */
const BALL_BACK = 1.35;
/**
 * The arch lifts the sole only on the inside of the foot; the outer edge sits
 * flat on the floor. Slight either way: a sole lifted far through its middle is
 * a crescent between heel and toe — a scythe blade, not a foot.
 */
const ARCH_AT = 0.5;
const ARCH_LIFT = 0.16;
/** The near foot's outer edge still lifts a little between heel and ball. */
const OUTER_ARCH_LIFT = 0.1;
/** The big toe leads, rounded and low; a toe that overshoots the ball ends in a point. */
const BIG_TOE_LEAD = 0.4;
const BIG_TOE_TIP = 0.35;
const BIG_TOE_TOP = 0.95;
const BIG_TOE_BACK = 0.2;
/** The dip in the top line where the toes leave the ball of the foot. */
const TOE_ROOT_BACK = 0.95;
const TOE_ROOT_DEPTH = 0.78;
/** The instep climbs from the toe root to the front of the ankle. */
const INSTEP_CONTROL_AT = 0.35;
const INSTEP_CONTROL_RISE = 0.2;
/**
 * The instep meets the front of the shin well up the ankle, so the top line
 * of the foot runs down from the shin in one slope to the toes. Meeting it
 * low, the shin stands on the foot like a post on a plank, which is the
 * slab — a boot, not a foot.
 */
const ANKLE_FRONT = 1.05;
const ANKLE_FRONT_RISE = 0.8;
/** The foot's shading axis runs heel to toe through the middle of its depth. */
const FOOT_AXIS_DROP = 0.3;
const FOOT_HALF_DEPTH = 0.5;
/** The top of the instep faces the key: a long lit plane. */
const INSTEP_LIGHT_AT = 0.3;
const INSTEP_LIGHT_RISE = 0.05;
const INSTEP_LIGHT_LENGTH = 0.28;
const INSTEP_LIGHT_DEPTH = 0.16;
const INSTEP_LIGHT_ALPHA = 0.7;
/** The crease where the toes fold off the ball, running down from the top-line dip. */
const TOE_CREASE_DROP = 0.55;
const FOOT_CREASE_WIDTH = 0.018;
const FOOT_CREASE_OPACITY = 0.8;
/** The shade under the arch, centred between heel and ball along the sole. */
const ARCH_SHADE_LENGTH = 0.35;
const ARCH_SHADE_DEPTH = 0.3;
const ARCH_SHADE_ALPHA = 0.7;
/** The heel and ball pads: where on the sole, and how large against the foot. */
const HEEL_PAD_AT = 0.3;
const SOLE_PAD_LENGTH = 0.16;
const SOLE_PAD_DEPTH = 0.22;
const SOLE_PAD_CORE = 0.5;

function drawFootInProfile(
  ctx: Ctx,
  flesh: Ramp,
  pitch: number,
  outward: number,
  accents: FootAccents,
): void {
  const { length, toeX, heelX, sole, toeHalf } = footExtent(true, outward);
  // Edge-on the near foot shows its outer edge, flat on the floor; the far one
  // turns its arch to the camera.
  const archLift = outward < 0 ? ARCH_LIFT : OUTER_ARCH_LIFT;
  const toeRoot = pt(toeX - toeHalf * TOE_ROOT_BACK, sole - toeHalf * TOE_ROOT_DEPTH);

  const traceFoot = (): void => {
    ctx.beginPath();
    ctx.moveTo(-ANKLE_WIDTH * ACHILLES_BACK, -FOOT_DEPTH * ACHILLES_TOP);
    ctx.quadraticCurveTo(
      heelX - FOOT_DEPTH * HEEL_BULB,
      sole * HEEL_BULB_DROP,
      heelX * HEEL_FLOOR,
      sole,
    );
    const ball = toeX - toeHalf * BALL_BACK;
    ctx.quadraticCurveTo(lerp(heelX, ball, ARCH_AT), sole - FOOT_DEPTH * archLift, ball, sole);
    ctx.quadraticCurveTo(
      toeX + toeHalf * BIG_TOE_LEAD,
      sole,
      toeX + toeHalf * BIG_TOE_LEAD,
      sole - toeHalf * BIG_TOE_TIP,
    );
    ctx.quadraticCurveTo(
      toeX + toeHalf * BIG_TOE_LEAD,
      sole - toeHalf * BIG_TOE_TOP,
      toeX - toeHalf * BIG_TOE_BACK,
      sole - toeHalf * BIG_TOE_TOP,
    );
    ctx.lineTo(toeRoot.x, toeRoot.y);
    ctx.quadraticCurveTo(
      toeX * INSTEP_CONTROL_AT,
      -FOOT_DEPTH * INSTEP_CONTROL_RISE,
      ANKLE_WIDTH * ANKLE_FRONT,
      -FOOT_DEPTH * ANKLE_FRONT_RISE,
    );
    ctx.closePath();
  };

  shadeForm(
    ctx,
    traceFoot,
    { from: pt(heelX, sole * FOOT_AXIS_DROP), to: pt(toeX, sole * FOOT_AXIS_DROP) },
    flesh,
    { halfWidth: FOOT_DEPTH * FOOT_HALF_DEPTH, frameRotation: pitch },
    () => {
      fillSoftEllipse(
        ctx,
        toeX * INSTEP_LIGHT_AT,
        -FOOT_DEPTH * INSTEP_LIGHT_RISE,
        length * INSTEP_LIGHT_LENGTH,
        FOOT_DEPTH * INSTEP_LIGHT_DEPTH,
        flesh.light,
        INSTEP_LIGHT_ALPHA,
      );
      // Callus only where the sole bears weight — the heel and the ball — with
      // the arch between them turned up out of the light. One band the whole
      // length of the sole is the edge of a slab; three values along it are
      // a heel, an arch and a ball.
      const ball = toeX - toeHalf * BALL_BACK;
      const archCentre = lerp(heelX, ball, ARCH_AT);
      fillSoftEllipse(
        ctx,
        archCentre,
        sole,
        (ball - heelX) * ARCH_SHADE_LENGTH,
        FOOT_DEPTH * ARCH_SHADE_DEPTH,
        flesh.shadow,
        ARCH_SHADE_ALPHA,
      );
      for (const padAt of [heelX * HEEL_PAD_AT, ball]) {
        fillSoftEllipse(
          ctx,
          padAt,
          sole,
          length * SOLE_PAD_LENGTH,
          FOOT_DEPTH * SOLE_PAD_DEPTH,
          CALLUS,
          CALLUS_ALPHA,
          0,
          SOLE_PAD_CORE,
        );
      }
      crease(
        ctx,
        () => {
          ctx.moveTo(toeRoot.x, toeRoot.y);
          ctx.lineTo(toeRoot.x, toeRoot.y + toeHalf * TOE_CREASE_DROP);
        },
        FOOT_CREASE_WIDTH,
        flesh,
        FOOT_CREASE_OPACITY,
        pitch,
      );
    },
  );

  if (accents.pedicure === true) {
    paintNailGlints(ctx, [
      pt(toeX + toeHalf * PROFILE_NAIL_LEAD, sole - toeHalf * PROFILE_NAIL_RISE),
    ]);
    paintSparkle(ctx, pt(toeX * INSTEP_LIGHT_AT, -FOOT_DEPTH * INSTEP_LIGHT_RISE));
  }
  if (accents.toeRing === true) {
    // Edge-on the second toe is hidden behind the big toe on the far side of
    // the foot; the ring shows as a glint over the top of the toes.
    const ring = pt(
      lerp(toeRoot.x, toeX, PROFILE_RING_ALONG),
      lerp(toeRoot.y, sole, PROFILE_RING_DOWN),
    );
    paintRing(ctx, ring, pt(0, 1));
  }
}

/** The big toe's nail, on its top just behind the tip. */
const PROFILE_NAIL_LEAD = 0.2;
const PROFILE_NAIL_RISE = 0.8;
/** The ring sits on the toes about halfway from their root to the tip, near their top. */
const PROFILE_RING_ALONG = 0.45;
const PROFILE_RING_DOWN = 0.2;

// ── Head-on ──────────────────────────────────────────────────────────────────

/**
 * Across the toes a foot is about two fifths of its length; head-on it also
 * has to read as a foot, not a stub, so it is taken at the ball, its widest.
 */
const FOOT_HALF_WIDTH = FOOT_LEN * 0.36;
/**
 * Head-on the floor is seen from above, so a foot pointing at the camera shows
 * the top of it running down the screen from the ankle to the toes — the same
 * projection that carries a planted foot down the screen as he walks. Stopped
 * at the ankle's own depth the foot is a stub the width of the ankle.
 */
const TOES_TOWARD_CAMERA = 0.5;
/**
 * Head-on, a foot turns out in the *ground* plane, which a 2D rotation cannot
 * express: rotating it rolls him onto the outer edge of the sole. The toe row
 * slides outward instead, and the sole stays level.
 */
const TOE_SPLAY = FOOT_LEN * 0.12;
/** How tall the toe row is, seen end on, against the foot's depth. */
const TOE_ROW = 0.38;
/**
 * The foot's outline leaves the shin this far above the ankle, so the ankle
 * bones are part of the foot's own silhouette rather than a seam across the leg.
 */
const ANKLE_ROOT_RISE = 0.55;
const ANKLE_ROOT_SIDE = 0.95;
/**
 * The ankle bones: the inner one (tibia) sits higher and further forward than
 * the outer one (fibula), which is lower and further back. Each is a bump in
 * the outline, wider than the ankle above it — without them the shin runs
 * straight into the top of the foot like a post into a pad.
 */
const INNER_MALLEOLUS_RISE = 0.18;
const OUTER_MALLEOLUS_RISE = -0.02;
const MALLEOLUS_SWELL = 1.32;
const MALLEOLUS_BULGE = 1.5;
/**
 * The heel sits behind the ankle and is as wide as it, so head-on its
 * rounded mass shows past the instep on both sides just above the floor —
 * more on the outside, where the foot turns away. It is what makes the foot
 * heavy rather than a flat pad under the ankle.
 */
const HEEL_SIDE_DROP = 0.35;
const OUTER_HEEL_SIDE = 1.8;
const INNER_HEEL_SIDE = 1.5;
/** The inner edge swells over the ball of the big toe. */
const BALL_SWELL = 1.06;
const BALL_RISE = 0.75;
/** The big toe: the widest, lowest toe, on the inside. */
const BIG_TOE_CORNER = 1.06;
const BIG_TOE_OUTER = 0.5;
/** The notch that splits the big toe from the rest. */
const TOE_GAP_AT = 0.3;
const TOE_GAP_RISE = 0.75;
/** The four small toes step up and back toward the outside, as two soft bumps. */
const SMALL_TOE_BUMPS: readonly { readonly at: number; readonly rise: number }[] = [
  { at: -0.05, rise: 0.05 },
  { at: -0.45, rise: 0.12 },
];
const SMALL_TOE_DIP = 0.3;
const LITTLE_TOE = 0.95;
const LITTLE_TOE_RISE = 0.35;
/** The outer edge runs flat along the floor from the little toe back to the heel. */
const OUTER_EDGE = 1.08;
const OUTER_EDGE_RISE = 0.55;
/**
 * The top of the foot faces up into the key: a lit plane from the ankle
 * crease down to the toe knuckles, highest along the big toe's ridge.
 */
const TOP_LIGHT_AT = 0.42;
const TOP_LIGHT_INBOARD = 0.2;
const TOP_LIGHT_WIDTH = 0.62;
const TOP_LIGHT_HEIGHT = 0.45;
const TOP_LIGHT_ALPHA = 0.9;
/**
 * The toes' ends face the camera rather than the key, so the toe row sits a
 * step down from the lit top of the foot — a change of plane, not a line.
 */
const TOE_ROW_SHADE_WIDTH = 1.1;
const TOE_ROW_SHADE_ALPHA = 0.55;
/** The heel's two sides turn away from the key and sit behind the instep. */
const HEEL_SHADE_WIDTH = 0.55;
const HEEL_SHADE_HEIGHT = 0.4;
const HEEL_SHADE_ALPHA = 0.75;
/** A small lit crown on each ankle bone. */
const MALLEOLUS_LIGHT_RADIUS = 0.45;
const MALLEOLUS_LIGHT_ALPHA = 0.65;
/**
 * Where the toes curl under onto the floor the skin is in occlusion: a dark
 * seam along the bottom of the toe row that says the weight is on them.
 */
const TOE_UNDERSIDE_HEIGHT = 0.1;
const TOE_UNDERSIDE_ALPHA = 0.35;
/** The split between the big toe and the rest runs only part way up the toe row. */
const TOE_SPLIT_REACH = 0.8;

function drawFootHeadOn(ctx: Ctx, flesh: Ramp, outward: number, accents: FootAccents): void {
  const sole = FOOT_DEPTH * (SOLE_DROP + TOES_TOWARD_CAMERA);
  const toeRow = FOOT_DEPTH * TOE_ROW;
  const inner = -outward;
  const toes = outward * TOE_SPLAY;
  const f = FOOT_HALF_WIDTH;
  const a = ANKLE_WIDTH;
  const toeGap = pt(toes + inner * f * TOE_GAP_AT, sole - toeRow * TOE_GAP_RISE);
  const innerMalleolus = pt(inner * a * MALLEOLUS_SWELL, -FOOT_DEPTH * INNER_MALLEOLUS_RISE);
  const outerMalleolus = pt(outward * a * MALLEOLUS_SWELL, -FOOT_DEPTH * OUTER_MALLEOLUS_RISE);
  const heelY = FOOT_DEPTH * HEEL_SIDE_DROP;
  const littleToe = pt(toes - inner * f * LITTLE_TOE, sole - toeRow * LITTLE_TOE_RISE);

  const traceFoot = (): void => {
    ctx.beginPath();
    ctx.moveTo(inner * a * ANKLE_ROOT_SIDE, -FOOT_DEPTH * ANKLE_ROOT_RISE);
    ctx.quadraticCurveTo(
      inner * a * MALLEOLUS_BULGE,
      innerMalleolus.y - FOOT_DEPTH * ANKLE_ROOT_RISE * HALF_SHARE,
      innerMalleolus.x,
      innerMalleolus.y,
    );
    ctx.quadraticCurveTo(inner * a, heelY * HALF_SHARE, inner * a * INNER_HEEL_SIDE, heelY);
    ctx.quadraticCurveTo(
      inner * f * BALL_SWELL,
      heelY,
      toes + inner * f * BALL_SWELL,
      sole - toeRow * BALL_RISE,
    );
    ctx.quadraticCurveTo(
      toes + inner * f * BIG_TOE_CORNER,
      sole,
      toes + inner * f * BIG_TOE_OUTER,
      sole,
    );
    ctx.quadraticCurveTo(toes + inner * f * TOE_GAP_AT, sole, toeGap.x, toeGap.y);
    let from = toeGap;
    for (const bump of SMALL_TOE_BUMPS) {
      const tip = pt(toes + inner * f * bump.at, sole - toeRow * bump.rise);
      ctx.quadraticCurveTo(lerp(from.x, tip.x, HALF_SHARE), sole, tip.x, tip.y);
      from = pt(tip.x, sole - toeRow * (bump.rise + SMALL_TOE_DIP));
      ctx.lineTo(from.x, from.y);
    }
    ctx.quadraticCurveTo(
      lerp(from.x, littleToe.x, HALF_SHARE),
      sole - toeRow * LITTLE_TOE_RISE * HALF_SHARE,
      littleToe.x,
      littleToe.y,
    );
    ctx.quadraticCurveTo(
      toes - inner * f * OUTER_EDGE,
      sole - toeRow * OUTER_EDGE_RISE,
      outward * a * OUTER_HEEL_SIDE,
      heelY,
    );
    ctx.quadraticCurveTo(outward * a, heelY * HALF_SHARE, outerMalleolus.x, outerMalleolus.y);
    ctx.quadraticCurveTo(
      outward * a * MALLEOLUS_BULGE,
      outerMalleolus.y - FOOT_DEPTH * ANKLE_ROOT_RISE * HALF_SHARE,
      outward * a * ANKLE_ROOT_SIDE,
      -FOOT_DEPTH * ANKLE_ROOT_RISE,
    );
    ctx.closePath();
  };

  shadeForm(
    ctx,
    traceFoot,
    { from: pt(0, -FOOT_DEPTH * ANKLE_ROOT_RISE), to: pt(toes, sole) },
    flesh,
    { halfWidth: f },
    () => {
      for (const side of [inner, outward]) {
        fillSoftEllipse(
          ctx,
          side * a * OUTER_HEEL_SIDE,
          heelY,
          a * HEEL_SHADE_WIDTH,
          FOOT_DEPTH * HEEL_SHADE_HEIGHT,
          flesh.shadow,
          HEEL_SHADE_ALPHA,
        );
      }
      fillSoftEllipse(
        ctx,
        toes * TOP_LIGHT_AT + inner * f * TOP_LIGHT_INBOARD,
        sole * TOP_LIGHT_AT,
        f * TOP_LIGHT_WIDTH,
        FOOT_DEPTH * TOP_LIGHT_HEIGHT,
        flesh.light,
        TOP_LIGHT_ALPHA,
      );
      for (const bone of [innerMalleolus, outerMalleolus]) {
        fillSoftEllipse(
          ctx,
          bone.x * HALF_SHARE,
          bone.y,
          a * MALLEOLUS_LIGHT_RADIUS,
          a * MALLEOLUS_LIGHT_RADIUS,
          flesh.light,
          MALLEOLUS_LIGHT_ALPHA,
        );
      }
      fillSoftEllipse(
        ctx,
        toes,
        sole - toeRow / 2,
        f * TOE_ROW_SHADE_WIDTH,
        toeRow,
        flesh.dark,
        TOE_ROW_SHADE_ALPHA,
      );
      fillSoftEllipse(
        ctx,
        toes,
        sole,
        f * TOE_ROW_SHADE_WIDTH,
        FOOT_DEPTH * TOE_UNDERSIDE_HEIGHT,
        flesh.deep,
        TOE_UNDERSIDE_ALPHA,
      );
      crease(
        ctx,
        () => {
          ctx.moveTo(toeGap.x, toeGap.y);
          ctx.lineTo(toeGap.x, toeGap.y - toeRow * TOE_SPLIT_REACH);
        },
        FOOT_CREASE_WIDTH,
        flesh,
        FOOT_CREASE_OPACITY,
      );
    },
  );

  if (accents.pedicure === true) {
    const nailY = sole - toeRow * HEAD_ON_NAIL_RISE;
    paintNailGlints(ctx, [
      pt(toes + inner * f * BIG_TOE_NAIL_AT, nailY),
      ...SMALL_TOE_NAILS_AT.map((at) => pt(toes - inner * f * at, nailY)),
    ]);
    paintSparkle(ctx, pt(toes * TOP_LIGHT_AT + inner * f * TOP_LIGHT_INBOARD, sole * TOP_LIGHT_AT));
  }
  if (accents.toeRing === true) {
    paintRing(ctx, pt(toes + inner * f * SECOND_TOE_AT, sole - toeRow * RING_ON_TOE), pt(1, 0));
  }
}

/** Head-on, the nails sit low on the toe ends that face the camera. */
const HEAD_ON_NAIL_RISE = 0.45;
const BIG_TOE_NAIL_AT = 0.72;
const SMALL_TOE_NAILS_AT: readonly number[] = [0.05, 0.45];
/** The second toe, just outboard of the gap that splits off the big toe. */
const SECOND_TOE_AT = 0.1;
/** The ring sits at the toe's base, just below the crease where it leaves the foot. */
const RING_ON_TOE = 0.75;

// ── From behind ──────────────────────────────────────────────────────────────

/** From behind the Achilles pinches in above a heel bulb wider than the ankle. */
const ACHILLES_PINCH = 0.72;
const ACHILLES_PINCH_DROP = 0.2;
const HEEL_WIDEST_RISE = 0.55;
/** The sole's callused edge shows as a band along the bottom of the heel. */
const HEEL_CALLUS_BAND = 0.28;
/** The heel bulb's lit upper curve. */
const HEEL_LIGHT_RISE = 0.9;
const HEEL_LIGHT_WIDTH = 0.6;
const HEEL_LIGHT_HEIGHT = 0.35;
const HEEL_LIGHT_ALPHA = 0.5;

function drawHeelFromBehind(ctx: Ctx, flesh: Ramp): void {
  const radius = FOOT_DEPTH * BACK_HEEL_RADIUS;
  const bottom = FOOT_DEPTH * BACK_HEEL_DROP + radius;
  const widestY = bottom - radius * HEEL_WIDEST_RISE;
  const pinchY = FOOT_DEPTH * ACHILLES_PINCH_DROP;

  const traceHeel = (): void => {
    ctx.beginPath();
    ctx.moveTo(-ANKLE_WIDTH, 0);
    ctx.quadraticCurveTo(-ANKLE_WIDTH * ACHILLES_PINCH, pinchY, -radius, widestY);
    ctx.quadraticCurveTo(-radius, bottom, 0, bottom);
    ctx.quadraticCurveTo(radius, bottom, radius, widestY);
    ctx.quadraticCurveTo(ANKLE_WIDTH * ACHILLES_PINCH, pinchY, ANKLE_WIDTH, 0);
    ctx.closePath();
  };
  shadeForm(
    ctx,
    traceHeel,
    { from: pt(0, 0), to: pt(0, bottom) },
    flesh,
    {
      halfWidth: radius,
    },
    () => {
      fillSoftEllipse(
        ctx,
        0,
        bottom - radius * HEEL_LIGHT_RISE,
        radius * HEEL_LIGHT_WIDTH,
        radius * HEEL_LIGHT_HEIGHT,
        flesh.light,
        HEEL_LIGHT_ALPHA,
      );
      paintCallus(ctx, -radius, bottom - radius * HEEL_CALLUS_BAND, radius * 2);
    },
  );
}
