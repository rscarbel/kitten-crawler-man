/**
 * The city elf cultist's vestments and elven anatomy, painted onto Carl's rig
 * as attachments (`CarlAttachments` in `carl/figure.ts`): a deep cowl with a
 * gold-trimmed opening and the brim's shadow over the eyes, long pointed ears
 * thrust out through slits in the hood, an ivory stole, the cult's winged-eye
 * sigil, a rope girdle with a skyfowl feather tied to it, a gold hem band and
 * soft shoes.
 *
 * The cult believes the skyfowl circling the Over City are angels and that the
 * Krasue murders are their tithe, so its mark is an eye under spread wings,
 * and every cultist carries a stolen feather at the hip.
 *
 * Everything is in the rig's figure units — origin between the feet, +Y down —
 * and hung off the solved skeleton, shaded with Carl's own `shadeForm` so the
 * vestments light the same way as the body they are worn on, and composed
 * inside his figure so the silhouette outline runs round them too.
 *
 * Silhouette carries the read at the 32 px tile: the hood is a peaked dome
 * wider than a bare head, the ears are two points standing out of it, and the
 * stole and hem band are the only pale shapes on a dark robe.
 */

import { type CarlAttachments } from './carl/figure';
import { footSoleLandmarks, LEFT_FOOT_OUT, RIGHT_FOOT_OUT } from './carl/feet';
import { headAngle } from './carl/head';
import { addCapsule, crease, shadeForm } from './carl/paint';
import {
  deriveGlossRamp,
  deriveRamp,
  FAR_LIMB_SHADE,
  type GlossRamp,
  type Ramp,
  receded,
  recededGloss,
} from './carl/palette';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY, WAIST_HALF } from './carl/proportions';
import { type BoneChain, type CarlPose, type Skeleton, type ViewSpec } from './carl/rig';
import { torsoFrame, traceGarmentTorso, type TorsoFrame } from './carl/torso';
import { clamp01, lerp, type Pt, rgba } from './carlArt';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Pale, cool skin with a faint lilac cast: an elf who keeps out of the sun.
 * The lit steps stay warm enough to read as living rather than as a corpse,
 * which the soul-thieves around them are not.
 */
export const CULTIST_SKIN: Ramp = {
  deep: '#3a2630',
  shadow: '#634854',
  dark: '#836670',
  mid: '#9d8085',
  base: '#b9998f',
  light: '#d2b5a6',
  rim: '#e6d0c0',
};

/** Ash-dark hair, so the little that shows under the brim merges with the hood's shadow. */
export const CULTIST_HAIR: Ramp = deriveRamp('#2c2630');

/**
 * The robe: a deep violet, the colour of the soul bolts they throw. Light
 * enough that its ramp's shadow steps stay a colour on the black lodge floor.
 */
export const CULTIST_ROBE: GlossRamp = deriveGlossRamp('#4b2f6e');

const HOOD: GlossRamp = CULTIST_ROBE;
const HOOD_LINING = '#1a0b16';
const GOLD: Ramp = deriveRamp('#c9a24a');
const STOLE: Ramp = deriveRamp('#d8cfb6');
const SIGIL_RED = '#9a1f33';
const ROPE: Ramp = deriveRamp('#a08452');
const FEATHER = '#ece6d6';
const FEATHER_SHAFT = '#8a7a66';
const SHOES: GlossRamp = deriveGlossRamp('#2a2030');
/** The violet of the soul bolt's core, for the eyes under the hood. */
const EYE_GLOW_CORE = '#efe4ff';
const EYE_GLOW_RIM = '#8b5cf6';

// ── Motion ───────────────────────────────────────────────────────────────────

/** What the choreography hands the attachments on one frame, beyond the pose. */
export interface CultistMotion {
  /** How bright the eyes burn under the hood, 0 to 1: a low smoulder, flaring on a cast. */
  readonly eyeGlow: number;
  /** Sideways swing of the feather fetish, −1 to 1. */
  readonly fetishSway: number;
}

// ── Small geometry ───────────────────────────────────────────────────────────

function at(origin: Pt, dx: number, dy: number): Pt {
  return { x: origin.x + dx, y: origin.y + dy };
}

function inHeadFrame(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, paint: () => void): void {
  ctx.save();
  try {
    ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
    ctx.rotate(headAngle(pose));
    paint();
  } finally {
    ctx.restore();
  }
}

/** A quadratic Bézier, written out as points: `[start, control, end]`. */
type Quad = readonly [Pt, Pt, Pt];

function traceQuads(ctx: Ctx, quads: readonly Quad[]): void {
  ctx.moveTo(quads[0][0].x, quads[0][0].y);
  for (const [, control, end] of quads) ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
}

/** The same curves walked the other way, so a hole traced with them winds against its outline. */
function reversedQuads(quads: readonly Quad[]): Quad[] {
  return [...quads].reverse().map(([start, control, end]): Quad => [end, control, start]);
}

function mirrorQuads(quads: readonly Quad[]): Quad[] {
  const flip = (p: Pt): Pt => ({ x: -p.x, y: p.y });
  return quads.map(([a, b, c]): Quad => [flip(a), flip(b), flip(c)]);
}

function p(x: number, y: number): Pt {
  return { x, y };
}

// ── Hood, head-on and from behind ────────────────────────────────────────────
// Head-local units: origin at the head's centre (the eye line), +Y down, in
// fractions of HEAD_RX across and HEAD_RY down.

const RX = HEAD_RX;
const RY = HEAD_RY;
const D = HEAD_DEPTH;

/**
 * The hood's outline down its left half, peak to the mantle's hem: wider than
 * the skull at the temples so the cowl stands off the head, a soft point at
 * the crown, and a short mantle that settles on the shoulders.
 */
const HOOD_FACING_LEFT: readonly Quad[] = [
  [p(0, -RY * 1.52), p(-RX * 1.05, -RY * 1.42), p(-RX * 1.4, -RY * 0.25)],
  [p(-RX * 1.4, -RY * 0.25), p(-RX * 1.52, RY * 0.95), p(-RX * 1.9, RY * 1.82)],
];
/** The mantle's hem, a shallow curve across the top of the chest. */
const HOOD_HEM_DIP = RY * 2.02;

/**
 * The face opening's left edge, from the apex over the brow down past the
 * jaw, where it runs into a V below the chin.
 */
const OPENING_LEFT: readonly Quad[] = [
  [p(0, -RY * 0.74), p(-RX * 0.98, -RY * 0.72), p(-RX * 0.98, RY * 0.35)],
  [p(-RX * 0.98, RY * 0.35), p(-RX * 0.9, RY * 1.2), p(0, RY * 1.72)],
];

function traceFacingHoodOuter(ctx: Ctx): void {
  const right = reversedQuads(mirrorQuads(HOOD_FACING_LEFT));
  const leftHem = HOOD_FACING_LEFT[HOOD_FACING_LEFT.length - 1][2];
  traceQuads(ctx, HOOD_FACING_LEFT);
  ctx.quadraticCurveTo(0, HOOD_HEM_DIP, -leftHem.x, leftHem.y);
  for (const [, control, end] of right) ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.closePath();
}

function traceFacingOpening(ctx: Ctx): void {
  // Wound the other way from the outline, so a nonzero fill leaves it a hole:
  // the outline runs down its left side first, the opening down its right.
  traceQuads(ctx, mirrorQuads(OPENING_LEFT));
  for (const [, control, end] of reversedQuads(OPENING_LEFT)) {
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  }
  ctx.closePath();
}

/** The cowl's gold edging, a band laid just inside the opening. */
const TRIM_WIDTH = 0.022;
const TRIM_INSET = 0.008;
/** The hood's back seam, from behind: what turns a dome into a hood. */
const SEAM_WIDTH = 0.012;
const SEAM_OPACITY = 0.8;
/** The cowl's matte cloth: a whisper of sheen on the crown, no more. */
const CLOTH_SPECULAR = 0.25;

/**
 * The brim's shadow falls over the brow and the eyes and is gone by the
 * mouth: the face stays readable, but the cultist looks out from under it.
 */
const BRIM_SHADOW_TOP = -RY * 0.8;
const BRIM_SHADOW_BOTTOM = RY * 0.32;
const BRIM_SHADOW_ALPHA = 0.78;
const BRIM_SHADOW_MID = 0.45;
const BRIM_SHADOW_MID_ALPHA = 0.5;

function paintFacingHood(ctx: Ctx, showsFace: boolean): void {
  const trace = (): void => {
    ctx.beginPath();
    traceFacingHoodOuter(ctx);
    if (showsFace) traceFacingOpening(ctx);
  };
  shadeForm(
    ctx,
    trace,
    { from: p(0, -RY * 1.52), to: p(0, HOOD_HEM_DIP) },
    HOOD,
    { halfWidth: RX * 1.45, specular: CLOTH_SPECULAR },
    () => {
      if (showsFace) {
        ctx.lineWidth = TRIM_WIDTH;
        ctx.strokeStyle = GOLD.base;
        ctx.save();
        ctx.translate(0, -TRIM_INSET);
        ctx.beginPath();
        traceFacingOpening(ctx);
        ctx.stroke();
        ctx.restore();
        return;
      }
      crease(
        ctx,
        () => {
          ctx.moveTo(0, -RY * 1.45);
          ctx.quadraticCurveTo(RX * 0.06, RY * 0.4, 0, RY * 1.5);
        },
        SEAM_WIDTH,
        HOOD,
        SEAM_OPACITY,
      );
    },
  );
  if (showsFace) paintBrimShadow(ctx, traceFacingOpening);
}

function paintBrimShadow(ctx: Ctx, traceOpening: (ctx: Ctx) => void): void {
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceOpening(ctx);
    },
    () => {
      const shade = ctx.createLinearGradient(0, BRIM_SHADOW_TOP, 0, BRIM_SHADOW_BOTTOM);
      shade.addColorStop(0, rgba(HOOD_LINING, BRIM_SHADOW_ALPHA));
      shade.addColorStop(BRIM_SHADOW_MID, rgba(HOOD_LINING, BRIM_SHADOW_MID_ALPHA));
      shade.addColorStop(1, rgba(HOOD_LINING, 0));
      ctx.fillStyle = shade;
      ctx.fillRect(-RX * 2, BRIM_SHADOW_TOP, RX * 4, BRIM_SHADOW_BOTTOM - BRIM_SHADOW_TOP);
    },
  );
}

// ── Hood, edge-on ────────────────────────────────────────────────────────────
// Head-local, +X toward the way he faces.

/**
 * The cowl in profile, as one closed outline: the brim overhanging the brow,
 * the crown rising to a point that falls back behind the skull, the back of
 * the hood down the nape onto the shoulder, and the front edge back up the
 * cheek to the brim. The face in front of that edge is left open.
 */
const HOOD_PROFILE: readonly Quad[] = [
  [p(D * 1.5, -RY * 0.6), p(D * 0.75, -RY * 1.7), p(-D * 0.75, -RY * 1.36)],
  [p(-D * 0.75, -RY * 1.36), p(-D * 1.6, -RY * 0.85), p(-D * 1.45, RY * 0.45)],
  [p(-D * 1.45, RY * 0.45), p(-D * 1.35, RY * 1.4), p(-D * 1.75, RY * 1.95)],
  [p(-D * 1.75, RY * 1.95), p(-D * 0.4, RY * 2.15), p(D * 0.62, RY * 1.82)],
  [p(D * 0.62, RY * 1.82), p(D * 0.55, RY * 1.45), p(D * 0.42, RY * 1.2)],
  [p(D * 0.42, RY * 1.2), p(D * 0.22, -RY * 0.2), p(D * 1.5, -RY * 0.6)],
];

/** The open face in front of the hood's front edge, for the brim shadow's clip. */
function traceProfileOpening(ctx: Ctx): void {
  const [edgeStart, edgeControl, edgeEnd] = HOOD_PROFILE[HOOD_PROFILE.length - 1];
  ctx.moveTo(edgeStart.x, edgeStart.y);
  ctx.quadraticCurveTo(edgeControl.x, edgeControl.y, edgeEnd.x, edgeEnd.y);
  ctx.lineTo(D * 2.5, edgeEnd.y);
  ctx.lineTo(D * 2.5, edgeStart.y);
  ctx.closePath();
}

function paintProfileHood(ctx: Ctx): void {
  const trace = (): void => {
    ctx.beginPath();
    traceQuads(ctx, HOOD_PROFILE);
    ctx.closePath();
  };
  shadeForm(
    ctx,
    trace,
    { from: p(-D * 0.4, -RY * 1.4), to: p(-D * 0.4, RY * 1.9) },
    HOOD,
    { halfWidth: D * 1.3, specular: CLOTH_SPECULAR },
    () => {
      const [edgeStart, edgeControl, edgeEnd] = HOOD_PROFILE[HOOD_PROFILE.length - 1];
      ctx.lineWidth = TRIM_WIDTH;
      ctx.strokeStyle = GOLD.base;
      ctx.beginPath();
      ctx.moveTo(edgeStart.x - TRIM_INSET, edgeStart.y);
      ctx.quadraticCurveTo(edgeControl.x - TRIM_INSET, edgeControl.y, edgeEnd.x, edgeEnd.y);
      ctx.stroke();
      crease(
        ctx,
        () => {
          ctx.moveTo(-D * 0.2, -RY * 1.2);
          ctx.quadraticCurveTo(-D * 0.9, -RY * 0.2, -D * 0.95, RY * 1.0);
        },
        SEAM_WIDTH,
        HOOD,
        SEAM_OPACITY,
      );
    },
  );
  paintBrimShadow(ctx, traceProfileOpening);
}

// ── Eyes ─────────────────────────────────────────────────────────────────────

const EYE_DX = HEAD_RX * 0.4;
const PROFILE_EYE_X = HEAD_DEPTH * 0.7;
const EYE_GLOW_RADIUS = HEAD_RX * 0.42;
const EYE_GLOW_CORE_SHARE = 0.3;
const EYE_GLOW_RIM_ALPHA = 0.55;
/** Fainter than this the glow changes no pixel, and its colour stops risk exponent notation. */
const MIN_EYE_GLOW = 0.02;

function paintEyeGlow(ctx: Ctx, centre: Pt, strength: number): void {
  if (strength < MIN_EYE_GLOW) return;
  const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, EYE_GLOW_RADIUS);
  glow.addColorStop(0, rgba(EYE_GLOW_CORE, strength));
  glow.addColorStop(EYE_GLOW_CORE_SHARE, rgba(EYE_GLOW_RIM, strength * EYE_GLOW_RIM_ALPHA));
  glow.addColorStop(1, rgba(EYE_GLOW_RIM, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, EYE_GLOW_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Ears ─────────────────────────────────────────────────────────────────────

/**
 * An elf's ear, root to tip, standing out through a slit in the hood. Sized
 * well past a real elf's: at the 32 px tile this one is four pixels beyond
 * the cowl, and anything shorter is a bump in the cloth.
 */
interface EarShape {
  readonly root: Pt;
  readonly bend: Pt;
  readonly tip: Pt;
}
/** Head-on the ears leave the hood's sides and sweep out and up, for the figure's +X side. */
const EAR_FACING: EarShape = {
  root: p(RX * 1.22, RY * 0.08),
  bend: p(RX * 2.05, -RY * 0.08),
  tip: p(RX * 2.75, -RY * 0.62),
};
/** Edge-on the near ear leaves the side of the hood and sweeps back past its outline. */
const EAR_PROFILE: EarShape = {
  root: p(-D * 0.05, RY * 0.08),
  bend: p(-D * 1.15, -RY * 0.1),
  tip: p(-D * 2.4, -RY * 0.8),
};
const EAR_ROOT_HALF = RY * 0.2;
const EAR_TIP_HALF = RY * 0.015;
const EAR_SAMPLES = 10;
/** The slit the ear comes through: a dark lip round the root. */
const EAR_SLIT_HALF = EAR_ROOT_HALF * 1.15;
const EAR_SLIT_ALPHA = 0.85;
const EAR_HOLLOW_WIDTH = 0.012;
const EAR_HOLLOW_OPACITY = 0.7;
const EAR_HOLLOW_FROM = 0.2;
const EAR_HOLLOW_TO = 0.8;

function earPoint(shape: EarShape, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * shape.root.x + 2 * u * t * shape.bend.x + t * t * shape.tip.x,
    y: u * u * shape.root.y + 2 * u * t * shape.bend.y + t * t * shape.tip.y,
  };
}

/** One closed taper along the ear's curve, with its top edge fuller than its bottom: an ear's rim. */
function traceEar(ctx: Ctx, shape: EarShape): void {
  const spine = Array.from({ length: EAR_SAMPLES + 1 }, (_unused, i) =>
    earPoint(shape, i / EAR_SAMPLES),
  );
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  const last = spine.length - 1;
  spine.forEach((point, index) => {
    const before = spine[Math.max(0, index - 1)];
    const after = spine[Math.min(last, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const half = lerp(EAR_ROOT_HALF, EAR_TIP_HALF, index / last);
    const nx = -dy / length;
    const ny = dx / length;
    upper.push({ x: point.x + nx * half, y: point.y + ny * half });
    lower.push({ x: point.x - nx * half, y: point.y - ny * half });
  });
  ctx.beginPath();
  ctx.moveTo(upper[0].x, upper[0].y);
  for (const point of upper) ctx.lineTo(point.x, point.y);
  for (let index = lower.length - 1; index >= 0; index--) {
    ctx.lineTo(lower[index].x, lower[index].y);
  }
  ctx.closePath();
}

function paintEar(ctx: Ctx, shape: EarShape, skin: Ramp): void {
  ctx.fillStyle = rgba(HOOD_LINING, EAR_SLIT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(shape.root.x, shape.root.y, EAR_SLIT_HALF * 0.6, EAR_SLIT_HALF, 0, 0, Math.PI * 2);
  ctx.fill();
  shadeForm(
    ctx,
    () => traceEar(ctx, shape),
    { from: shape.root, to: shape.tip },
    skin,
    { halfWidth: EAR_ROOT_HALF },
    () =>
      crease(
        ctx,
        () => {
          const from = earPoint(shape, EAR_HOLLOW_FROM);
          const to = earPoint(shape, EAR_HOLLOW_TO);
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
        },
        EAR_HOLLOW_WIDTH,
        skin,
        EAR_HOLLOW_OPACITY,
      ),
  );
}

function mirroredEar(shape: EarShape): EarShape {
  return {
    root: p(-shape.root.x, shape.root.y),
    bend: p(-shape.bend.x, shape.bend.y),
    tip: p(-shape.tip.x, shape.tip.y),
  };
}

// ── Head assembly ────────────────────────────────────────────────────────────

function paintHoodedHead(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  motion: CultistMotion,
): void {
  inHeadFrame(ctx, skeleton, pose, () => {
    if (view.profile) {
      paintProfileHood(ctx);
      paintEyeGlow(ctx, p(PROFILE_EYE_X, 0), motion.eyeGlow);
      paintEar(ctx, EAR_PROFILE, CULTIST_SKIN);
      return;
    }
    const facesCamera = !view.showsBack;
    paintFacingHood(ctx, facesCamera);
    if (facesCamera) {
      for (const side of [-1, 1]) paintEyeGlow(ctx, p(side * EYE_DX, 0), motion.eyeGlow);
    }
    // Lit from the upper left, the ear on the left of the picture takes the light.
    paintEar(ctx, mirroredEar(EAR_FACING), CULTIST_SKIN);
    paintEar(ctx, EAR_FACING, receded(CULTIST_SKIN, FAR_LIMB_SHADE / 2));
  });
}

// ── Stole and sigil ──────────────────────────────────────────────────────────
// Torso-frame units: across from the spine, down from the shoulder line.

/**
 * Head-on the stole hangs from either side of the neck, closes in toward the
 * waist like a priest's vestment, then falls straight to near the hem.
 */
const STOLE_TOP_ACROSS = 0.15;
const STOLE_WAIST_ACROSS = 0.085;
const STOLE_TOP_DOWN = 0.06;
const STOLE_HALF = 0.04;
/** How far above the robe's hem the stole's ends hang. */
const STOLE_END_ABOVE_HEM = 0.12;
/** Its ends are cut to a point, edged in gold. */
const STOLE_POINT = 0.05;
const STOLE_EDGE_WIDTH = 0.012;

function stoleBand(frame: TorsoFrame, side: number, endDy: number): Pt[] {
  const top = frame.at(side * STOLE_TOP_ACROSS, STOLE_TOP_DOWN);
  const waist = frame.at(side * STOLE_WAIST_ACROSS, frame.waistY);
  const end = frame.hem(side * STOLE_WAIST_ACROSS, endDy);
  return [top, waist, end];
}

function traceStoleBand(ctx: Ctx, spine: readonly Pt[], half: number): void {
  const [top, waist, end] = spine;
  ctx.beginPath();
  ctx.moveTo(top.x - half, top.y);
  ctx.lineTo(waist.x - half, waist.y);
  ctx.lineTo(end.x - half, end.y);
  ctx.lineTo(end.x, end.y + STOLE_POINT);
  ctx.lineTo(end.x + half, end.y);
  ctx.lineTo(waist.x + half, waist.y);
  ctx.lineTo(top.x + half, top.y);
  ctx.closePath();
}

function paintStoleBand(ctx: Ctx, spine: readonly Pt[], ramp: Ramp): void {
  const trace = (): void => traceStoleBand(ctx, spine, STOLE_HALF);
  shadeForm(ctx, trace, { from: spine[0], to: spine[2] }, ramp, { halfWidth: STOLE_HALF });
  ctx.lineWidth = STOLE_EDGE_WIDTH;
  ctx.strokeStyle = GOLD.dark;
  trace();
  ctx.stroke();
}

/**
 * The cult's mark: an eye under two upswept wings, the skyfowl they call
 * angels watching over the tithe. Drawn bold and simple — at the tile it is
 * a gold bird-shape on the chest with a red point in it.
 */
const SIGIL_WING_SPAN = 0.13;
const SIGIL_WING_RISE = 0.07;
const SIGIL_WING_THICK = 0.032;
const SIGIL_EYE_RX = 0.04;
const SIGIL_EYE_RY = 0.024;
const SIGIL_PUPIL_R = 0.014;

function paintSigil(ctx: Ctx, centre: Pt, scale: number): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(scale, 1);
  ctx.fillStyle = GOLD.light;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * SIGIL_EYE_RX * 0.6, -SIGIL_EYE_RY);
    ctx.quadraticCurveTo(
      side * SIGIL_WING_SPAN * 0.55,
      -SIGIL_WING_RISE * 0.4,
      side * SIGIL_WING_SPAN,
      -SIGIL_WING_RISE * 1.2,
    );
    ctx.quadraticCurveTo(
      side * SIGIL_WING_SPAN * 0.7,
      SIGIL_WING_THICK * 0.4,
      side * SIGIL_EYE_RX * 0.7,
      SIGIL_WING_THICK * 0.5,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, SIGIL_EYE_RX, SIGIL_EYE_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SIGIL_RED;
  ctx.beginPath();
  ctx.arc(0, 0, SIGIL_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Where the sigil sits on the chest, below the hood's mantle, and on the back between the blades. */
const SIGIL_CHEST_DOWN = 0.34;
const SIGIL_BACK_DOWN = 0.36;
const SIGIL_BACK_SCALE = 1.25;
/** Edge-on the chest is seen nearly side-on: the sigil is foreshortened to a sliver by the front. */
const SIGIL_PROFILE_ACROSS = 0.1;
const SIGIL_PROFILE_SCALE = 0.45;

/** Edge-on the stole runs down the front of the robe as one band. */
const STOLE_PROFILE_TOP_ACROSS = 0.02;
const STOLE_PROFILE_WAIST_ACROSS = 0.1;
const STOLE_PROFILE_HEM_ACROSS = 0.15;

function profileStoleBand(frame: TorsoFrame, endDy: number): Pt[] {
  return [
    frame.at(STOLE_PROFILE_TOP_ACROSS, STOLE_TOP_DOWN),
    frame.at(STOLE_PROFILE_WAIST_ACROSS, frame.waistY),
    frame.hem(STOLE_PROFILE_HEM_ACROSS, endDy),
  ];
}

// ── Girdle and fetish ────────────────────────────────────────────────────────

const ROPE_HALF = 0.018;
/** The girdle sits a little above the true waist, the robe bloused over it. */
const GIRDLE_ABOVE_WAIST = 0.02;
const GIRDLE_REACH = 0.98;
/** The knot and its two hanging ends, on the figure's own left front. */
const KNOT_ACROSS = 0.1;
const KNOT_R = 0.028;
const ROPE_END_DROP = 0.22;
const ROPE_END_SPLAY = 0.03;
/** The feather tied to the girdle: a skyfowl's, taken from the angels they serve. */
const FEATHER_ACROSS = -0.12;
const FEATHER_LENGTH = 0.24;
const FEATHER_HALF = 0.032;
const FEATHER_SWAY = 0.05;
const FEATHER_SHAFT_WIDTH = 0.008;

function paintRope(ctx: Ctx, from: Pt, to: Pt, ramp: Ramp): void {
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, from, to, ROPE_HALF, ROPE_HALF);
    },
    { from, to },
    ramp,
    { halfWidth: ROPE_HALF },
  );
}

function paintFeather(ctx: Ctx, root: Pt, sway: number): void {
  const tip = at(root, sway * FEATHER_SWAY, FEATHER_LENGTH);
  const mid = at(root, sway * FEATHER_SWAY * 0.4 + FEATHER_HALF * 0.3, FEATHER_LENGTH * 0.5);
  ctx.fillStyle = FEATHER;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(mid.x + FEATHER_HALF, mid.y, tip.x, tip.y);
  ctx.quadraticCurveTo(mid.x - FEATHER_HALF, mid.y, root.x, root.y);
  ctx.fill();
  ctx.strokeStyle = FEATHER_SHAFT;
  ctx.lineWidth = FEATHER_SHAFT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
  ctx.stroke();
}

function paintGirdle(
  ctx: Ctx,
  frame: TorsoFrame,
  view: ViewSpec,
  motion: CultistMotion,
  showFront: boolean,
): void {
  const y = frame.waistY - GIRDLE_ABOVE_WAIST;
  const half = view.profile ? 0.15 : WAIST_HALF * view.girth * GIRDLE_REACH;
  const from = frame.at(-half, y);
  const to = frame.at(half, y);
  paintRope(ctx, from, to, ROPE);
  if (!showFront) return;
  const knotAcross = view.profile ? half * 0.8 : KNOT_ACROSS;
  const knot = frame.at(knotAcross, y);
  for (const splay of [-1, 1]) {
    paintRope(ctx, knot, at(knot, splay * ROPE_END_SPLAY, ROPE_END_DROP), receded(ROPE, 0.15));
  }
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(knot.x, knot.y, KNOT_R, 0, Math.PI * 2);
    },
    { from: at(knot, 0, -KNOT_R), to: at(knot, 0, KNOT_R) },
    ROPE,
    { halfWidth: KNOT_R },
  );
  const featherAcross = view.profile ? half * 0.3 : FEATHER_ACROSS;
  paintFeather(ctx, frame.at(featherAcross, y), motion.fetishSway);
}

// ── Hem band ─────────────────────────────────────────────────────────────────

const HEM_BAND_WIDTH = 0.04;
const HEM_BAND_ABOVE = 0.035;
const HEM_BAND_REACH = 1;

function paintHemBand(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceGarmentTorso(ctx, skeleton, pose, view);
    },
    () => {
      const left = frame.hem(-HEM_BAND_REACH, -HEM_BAND_ABOVE);
      const right = frame.hem(HEM_BAND_REACH, -HEM_BAND_ABOVE);
      ctx.strokeStyle = GOLD.dark;
      ctx.lineWidth = HEM_BAND_WIDTH;
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    },
  );
}

// ── Shoes ────────────────────────────────────────────────────────────────────

const SHOE_TOE_HALF = 0.062;
const SHOE_HEEL_HALF = 0.068;
const SHOE_SHAFT_HALF = 0.07;
const SHOE_SHAFT_RISE = 0.08;
const SHOE_SPECULAR = 0.3;

/**
 * Head-on the bare foot below is drawn coming at the camera, short and wide,
 * its toes splayed outward: the shoe is a rounded toe box over all of it, so
 * no toe shows past the leather.
 */
const HEAD_ON_TOE_BOX_DROP = 0.085;
const HEAD_ON_TOE_BOX_OUT = 0.037;
const HEAD_ON_TOE_BOX_RX = 0.122;
const HEAD_ON_TOE_BOX_RY = 0.076;

function paintShoeHeadOn(ctx: Ctx, chain: BoneChain, outward: number, ramp: GlossRamp): void {
  const box = at(chain.end, outward * HEAD_ON_TOE_BOX_OUT, HEAD_ON_TOE_BOX_DROP);
  const shaftTop = at(chain.end, 0, -SHOE_SHAFT_RISE);
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, shaftTop, chain.end, SHOE_SHAFT_HALF, SHOE_SHAFT_HALF);
      ctx.moveTo(box.x + HEAD_ON_TOE_BOX_RX, box.y);
      ctx.ellipse(box.x, box.y, HEAD_ON_TOE_BOX_RX, HEAD_ON_TOE_BOX_RY, 0, 0, Math.PI * 2);
    },
    { from: at(box, -HEAD_ON_TOE_BOX_RX, 0), to: at(box, HEAD_ON_TOE_BOX_RX, 0) },
    ramp,
    { halfWidth: HEAD_ON_TOE_BOX_RY, specular: SHOE_SPECULAR },
  );
}

function paintShoe(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  point: number,
  ramp: GlossRamp,
): void {
  if (!view.profile && !view.showsBack) {
    paintShoeHeadOn(ctx, chain, outward, ramp);
    return;
  }
  const { heel, toe } = footSoleLandmarks(chain.end, pitch, view, outward, point);
  const heelTop = at(heel, 0, -SHOE_HEEL_HALF);
  const toeTop = at(toe, 0, -SHOE_TOE_HALF);
  const shaftTop = at(chain.end, 0, -SHOE_SHAFT_RISE);
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, heelTop, toeTop, SHOE_HEEL_HALF, SHOE_TOE_HALF);
      addCapsule(ctx, shaftTop, chain.end, SHOE_SHAFT_HALF, SHOE_SHAFT_HALF);
    },
    { from: heelTop, to: toeTop },
    ramp,
    { halfWidth: SHOE_HEEL_HALF, specular: SHOE_SPECULAR },
  );
}

function paintShoes(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  const farShade = view.profile ? FAR_LIMB_SHADE : 0;
  paintShoe(
    ctx,
    skeleton.leftLeg,
    pose.leftFootPitch,
    view,
    LEFT_FOOT_OUT,
    pose.leftFootPoint ?? 0,
    recededGloss(SHOES, farShade),
  );
  paintShoe(
    ctx,
    skeleton.rightLeg,
    pose.rightFootPitch,
    view,
    RIGHT_FOOT_OUT,
    pose.rightFootPoint ?? 0,
    SHOES,
  );
}

// ── Skirt panels ─────────────────────────────────────────────────────────────

/**
 * The robe's torso is one rigid shape down to the hem, and a striding leg
 * swings out past it: the bare shin showed behind the hem on every step. The
 * cloth over each leg is carried by that leg instead, a broad panel from the
 * hip to just above the ankle, so the skirt opens and closes with the stride
 * the way a robe's does.
 */
const PANEL_HIP_HALF = 0.15;
const PANEL_KNEE_HALF = 0.15;
const PANEL_HEM_HALF = 0.17;
/** How far down the shin, knee to ankle, the panel's hem falls. */
const PANEL_HEM_ALONG_SHIN = 0.78;
const PANEL_HIP_RISE = 0.1;

function paintSkirtPanel(ctx: Ctx, chain: BoneChain, ramp: Ramp): void {
  const top = at(chain.root, 0, -PANEL_HIP_RISE);
  const hem = {
    x: lerp(chain.joint.x, chain.end.x, PANEL_HEM_ALONG_SHIN),
    y: lerp(chain.joint.y, chain.end.y, PANEL_HEM_ALONG_SHIN),
  };
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, top, chain.joint, PANEL_HIP_HALF, PANEL_KNEE_HALF);
      addCapsule(ctx, chain.joint, hem, PANEL_KNEE_HALF, PANEL_HEM_HALF);
    },
    { from: top, to: hem },
    ramp,
    { halfWidth: PANEL_HIP_HALF },
  );
}

function paintSkirtPanels(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const farShade = view.profile ? FAR_LIMB_SHADE : 0;
  paintSkirtPanel(ctx, skeleton.leftLeg, receded(CULTIST_ROBE, farShade));
  paintSkirtPanel(ctx, skeleton.rightLeg, CULTIST_ROBE);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function paintVestments(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  motion: CultistMotion,
): void {
  const frame = torsoFrame(skeleton, pose);
  const stoleEnd = -STOLE_END_ABOVE_HEM;
  paintHemBand(ctx, skeleton, view, pose);
  if (view.profile) {
    paintStoleBand(ctx, profileStoleBand(frame, stoleEnd), STOLE);
    paintSigil(ctx, frame.at(SIGIL_PROFILE_ACROSS, SIGIL_CHEST_DOWN), SIGIL_PROFILE_SCALE);
    paintGirdle(ctx, frame, view, motion, true);
    return;
  }
  if (view.showsBack) {
    paintGirdle(ctx, frame, view, motion, false);
    paintSigil(ctx, frame.at(0, SIGIL_BACK_DOWN), SIGIL_BACK_SCALE);
    return;
  }
  for (const side of [-1, 1]) paintStoleBand(ctx, stoleBand(frame, side, stoleEnd), STOLE);
  paintSigil(ctx, frame.at(0, SIGIL_CHEST_DOWN), 1);
  paintGirdle(ctx, frame, view, motion, true);
}

/** Ink past the skeleton: the hood's peak and mantle, the ear tips, the feather's tip. */
function attachmentReach(skeleton: Skeleton, view: ViewSpec, pose: CarlPose): Pt[] {
  const head = skeleton.headCentre;
  const angle = headAngle(pose);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toFigure = (local: Pt): Pt => ({
    x: head.x + local.x * cos - local.y * sin,
    y: head.y + local.x * sin + local.y * cos,
  });
  const headPoints = view.profile
    ? [...HOOD_PROFILE.flatMap(([a, , c]) => [a, c]), EAR_PROFILE.tip]
    : [
        ...HOOD_FACING_LEFT.flatMap(([a, , c]) => [a, c, p(-a.x, a.y), p(-c.x, c.y)]),
        EAR_FACING.tip,
        mirroredEar(EAR_FACING).tip,
      ];
  return headPoints.map(toFigure);
}

/** The cultist's attachments for one frame. */
export function cultistAttachments(motion: CultistMotion): CarlAttachments {
  const clamped: CultistMotion = { ...motion, eyeGlow: clamp01(motion.eyeGlow) };
  return {
    overLegs: (ctx, skeleton, view, pose) => {
      paintSkirtPanels(ctx, skeleton, view);
      paintShoes(ctx, skeleton, view, pose);
    },
    over: (ctx, skeleton, view, pose) => {
      paintVestments(ctx, skeleton, view, pose, clamped);
      paintHoodedHead(ctx, skeleton, view, pose, clamped);
    },
    reach: (skeleton, view, pose) => attachmentReach(skeleton, view, pose),
  };
}
