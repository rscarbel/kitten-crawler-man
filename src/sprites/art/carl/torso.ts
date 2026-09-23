/**
 * Carl's torso: the fitted brown leather moto jacket — zipped, with a stand
 * collar — and, when he wears it, the dark trollskin shirt showing only as a
 * band at the neckline. The jacket's chest-pocket zips are left out: at the tile they are
 * under a pixel and only dirty the chest sheen.
 *
 * The jacket is drawn as the body under it plus an offset, not as a box: the
 * trapezius slopes from the collar to the shoulders, the deltoid caps (the
 * sleeve tops, `sleeve.ts`) are the widest line, and the lats taper to a fitted
 * waist. Seen edge-on it has a real chest-to-back depth: the pecs project
 * forward, the upper back rounds over the shoulder blades and catches the key,
 * and the small of the back hollows in above the hem.
 *
 * Leather is stiff and glossy, so the jacket carries a few deep, sharp folds
 * (under the arm, at the waist) each with a bright lower lip, and hard sheen
 * on the planes that curve toward the key — the upper chest and the yoke.
 */

import { gearOf } from './gear';
import { HALF_PI, mixPt, pt } from './geometry';
import { crease, FIGURE_CREASE_LAYERS, shadeForm } from './paint';
import { LEATHER } from './palette';
import { CHEST_HALF, NECK_WIDTH, SHOULDER_Y, WAIST_HALF, WAIST_Y } from './proportions';
import { type BoneChain, type CarlPose, type Skeleton, type ViewSpec } from './rig';
import { clamp01, deg, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse, strokeSoftCrease, withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

// ── The torso's own frame ────────────────────────────────────────────────────

/**
 * Figure-space points from coordinates in the torso's own frame: origin at the
 * shoulder line on the spine, +y down the spine toward the hem, +x toward the
 * figure's right head-on and toward the chest in profile. Built along the
 * spine so a lean tips the whole jacket, collar and folds with it.
 */
interface TorsoFrame {
  readonly at: (x: number, y: number) => Pt;
  /** The spine's direction, shoulders to hips, as an angle. */
  readonly angle: number;
  /** Where the waist sits down the spine. */
  readonly waistY: number;
  /** The hem, a little below the waist. */
  readonly hemY: number;
  /**
   * A point on (or `dy` below) the hem line, carried by the hem's secondary
   * motion: the hem is the jacket's free edge, so it swings with the lag the
   * choreography computes while the waist above it stays on the body.
   */
  readonly hem: (x: number, dy?: number) => Pt;
  /** A figure-space point's position across the torso. */
  readonly acrossOf: (p: Pt) => number;
  /** A figure-space point's position down the torso. */
  readonly downOf: (p: Pt) => number;
}

/** The jacket ends just below the waist; a moto jacket is cut short. */
const HEM_DROP = 0.055;
const NO_LAG: Pt = { x: 0, y: 0 };
/**
 * A quadratic curve only reaches halfway to its control point, so a curve
 * meant to dip by `d` at its middle puts the control `d` times this.
 */
const QUAD_CONTROL_REACH = 2;

function torsoFrame(skeleton: Skeleton, pose: CarlPose): TorsoFrame {
  const origin = skeleton.shoulderCentre;
  const toWaist = { x: skeleton.waist.x - origin.x, y: skeleton.waist.y - origin.y };
  const drawnWaistY = Math.hypot(toWaist.x, toWaist.y);
  const down = { x: toWaist.x / drawnWaistY, y: toWaist.y / drawnWaistY };
  const across = { x: down.y, y: -down.x };
  // Heights in this frame are the jacket's own, measured on an upright spine;
  // a torso pitched at or away from the camera draws them all shorter by the
  // same share as the spine.
  const waistY = Math.abs(WAIST_Y - SHOULDER_Y);
  const spineShare = drawnWaistY / waistY;
  const at = (x: number, y: number): Pt => {
    const drawnY = y * spineShare;
    return pt(origin.x + across.x * x + down.x * drawnY, origin.y + across.y * x + down.y * drawnY);
  };
  const hemY = waistY + HEM_DROP;
  const lag = pose.jacketHemLag ?? NO_LAG;
  return {
    at,
    hem: (x, dy = 0) => {
      const rest = at(x, hemY + dy);
      return pt(rest.x + lag.x, rest.y + lag.y);
    },
    angle: Math.atan2(down.y, down.x),
    waistY,
    hemY,
    acrossOf: (p) => (p.x - origin.x) * across.x + (p.y - origin.y) * across.y,
    downOf: (p) => ((p.x - origin.x) * down.x + (p.y - origin.y) * down.y) / spineShare,
  };
}

// ── Silhouettes ──────────────────────────────────────────────────────────────

/** How much wider than the neck the collar, and so the jacket's neckline, wraps. */
const COLLAR_WRAP = 1.15;
/** The neckline's height above the shoulder line, where the trapezius starts its slope. */
const NECK_BASE_RISE = 0.04;
/**
 * The trapezius: the slope from the collar out to the shoulder. Its control
 * point sits high and well out, so the slope is a convex muscle, not a
 * straight coat-hanger line — a heavy man's trap fills the gap between neck
 * and shoulder.
 */
const TRAP_REACH = 0.7;
const TRAP_RISE = 0.07;
/** The acromion, where the slope ends, as a share of the arm root's distance out. */
const ACROMION_SHARE = 0.97;
const ACROMION_Y = 0.035;
/** The jacket's side bows out round the deltoid under the sleeve before it reaches the armpit. */
const DELTOID_BOW = 1.1;
const DELTOID_BOW_Y = 0.1;
const ARMPIT_Y = 0.2;
/** The lats hold their width well below the armpit before they taper; this is the V. */
const LAT_HOLD_Y = 0.3;
/** Leather stands off the body by this much. */
const JACKET_OFFSET = 0.015;
/** The hem flares a hair past the waist, and further when a move kicks it out. */
const HEM_FLARE = 1.03;
const HEM_KICK = 0.3;
/** A moto hem is cut nearly straight; it only sags a little at the centre. */
const HEM_SAG = 0.012;
/** Head-on the neckline dips at the front, under the collar. */
const NECKLINE_DIP = 0.04;

function traceFacing(
  ctx: Ctx,
  frame: TorsoFrame,
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
): void {
  const { at } = frame;
  const neckHalf = NECK_WIDTH * view.girth * COLLAR_WRAP;
  const leftRoot = -frame.acrossOf(skeleton.leftShoulder);
  const rightRoot = frame.acrossOf(skeleton.rightShoulder);
  const chestHalf = (CHEST_HALF + JACKET_OFFSET) * view.girth;
  const waistHalf = (WAIST_HALF + JACKET_OFFSET) * view.girth;
  const hemHalf = waistHalf * HEM_FLARE * (1 + pose.jacketFlare * HEM_KICK);

  const side = (s: number, root: number) => ({
    collar: at(s * neckHalf, -NECK_BASE_RISE),
    trap: at(s * root * TRAP_REACH, -TRAP_RISE),
    acromion: at(s * root * ACROMION_SHARE, ACROMION_Y),
    deltoid: at(s * root * DELTOID_BOW, DELTOID_BOW_Y),
    armpit: at(s * chestHalf, ARMPIT_Y),
    lat: at(s * chestHalf, LAT_HOLD_Y),
    waist: at(s * waistHalf, frame.waistY),
    hem: frame.hem(s * hemHalf),
  });
  const l = side(-1, leftRoot);
  const r = side(1, rightRoot);
  const hemMid = frame.hem(0, HEM_SAG);
  const neckMid = at(0, -NECK_BASE_RISE + NECKLINE_DIP);

  ctx.beginPath();
  ctx.moveTo(l.collar.x, l.collar.y);
  ctx.quadraticCurveTo(l.trap.x, l.trap.y, l.acromion.x, l.acromion.y);
  ctx.quadraticCurveTo(l.deltoid.x, l.deltoid.y, l.armpit.x, l.armpit.y);
  ctx.quadraticCurveTo(l.lat.x, l.lat.y, l.waist.x, l.waist.y);
  ctx.lineTo(l.hem.x, l.hem.y);
  ctx.quadraticCurveTo(hemMid.x, hemMid.y, r.hem.x, r.hem.y);
  ctx.lineTo(r.waist.x, r.waist.y);
  ctx.quadraticCurveTo(r.lat.x, r.lat.y, r.armpit.x, r.armpit.y);
  ctx.quadraticCurveTo(r.deltoid.x, r.deltoid.y, r.acromion.x, r.acromion.y);
  ctx.quadraticCurveTo(r.trap.x, r.trap.y, r.collar.x, r.collar.y);
  ctx.quadraticCurveTo(neckMid.x, neckMid.y, l.collar.x, l.collar.y);
  ctx.closePath();
}

/**
 * The profile, facing +x. Chest-to-back depth is about a third of a unit on a
 * man this size, split unevenly about the spine: the pecs stand further
 * forward of it than the shoulder blades stand behind it.
 */
const PROFILE = {
  neckFront: pt(0.085, -0.035),
  neckBack: pt(-0.1, -0.07),
  /** The trapezius rounding over into the upper back. */
  trapControl: pt(-0.235, -0.06),
  upperBack: pt(-0.25, 0.08),
  /** The shoulder blades, the back's fullest point. */
  bladeControl: pt(-0.275, 0.24),
  /**
   * The small of the back only just hollows in above the hem: a heavy man's
   * waist is nearly as deep as his chest, and a real hollow here pinches him
   * to a plank at the tile.
   */
  lumbar: pt(-0.19, 0.39),
  hemBack: pt(-0.19, 0),
  hemFront: pt(0.2, 0),
  belly: pt(0.215, 0.36),
  /** Under the pecs the leather bridges down to the belly. */
  underPec: pt(0.27, 0.25),
  /** The pec's forward bulge: a barrel ribcage under the leather. */
  pecControl: pt(0.36, 0.12),
  /** The upper chest, rising to the collar. */
  clavicle: pt(0.2, 0.0),
} as const;

function traceProfile(ctx: Ctx, frame: TorsoFrame, pose: CarlPose): void {
  const { at } = frame;
  const kick = 1 + pose.jacketFlare * HEM_KICK;
  const p = (q: Pt): Pt => at(q.x, q.y);
  const hemBack = frame.hem(PROFILE.hemBack.x * kick);
  const hemFront = frame.hem(PROFILE.hemFront.x * kick);
  const hemMid = frame.hem(0, HEM_SAG);
  const neckFront = p(PROFILE.neckFront);
  const neckBack = p(PROFILE.neckBack);
  const trap = p(PROFILE.trapControl);
  const upperBack = p(PROFILE.upperBack);
  const blade = p(PROFILE.bladeControl);
  const lumbar = p(PROFILE.lumbar);
  const belly = p(PROFILE.belly);
  const underPec = p(PROFILE.underPec);
  const pec = p(PROFILE.pecControl);
  const clavicle = p(PROFILE.clavicle);

  ctx.beginPath();
  ctx.moveTo(neckFront.x, neckFront.y);
  ctx.quadraticCurveTo(
    neckBack.x + (neckFront.x - neckBack.x) / 2,
    neckBack.y,
    neckBack.x,
    neckBack.y,
  );
  ctx.quadraticCurveTo(trap.x, trap.y, upperBack.x, upperBack.y);
  ctx.quadraticCurveTo(blade.x, blade.y, lumbar.x, lumbar.y);
  ctx.lineTo(hemBack.x, hemBack.y);
  ctx.quadraticCurveTo(hemMid.x, hemMid.y, hemFront.x, hemFront.y);
  ctx.lineTo(belly.x, belly.y);
  ctx.quadraticCurveTo(
    belly.x + (underPec.x - belly.x),
    belly.y - (belly.y - underPec.y) / 2,
    underPec.x,
    underPec.y,
  );
  ctx.quadraticCurveTo(pec.x, pec.y, clavicle.x, clavicle.y);
  ctx.lineTo(neckFront.x, neckFront.y);
  ctx.closePath();
}

// ── Surface detail ───────────────────────────────────────────────────────────

/** A torso is broad; its turn into shadow is gradual across the ribs. */
const TORSO_SOFTNESS = 1.6;
/** The chest faces the key squarely, so it carries the jacket's strongest sheen. */
const CHEST_SPECULAR = 0.65;

/** Stiff leather folds sharp: a narrow core, not a soft cotton bunch. */
const FOLD_WIDTH = 0.03;
const FOLD_OPACITY = 0.85;

/** Line weight of the zip. */
const ZIP_WIDTH = 0.028;
/** The zip's teeth catch the light on the side turned to the key. */
const ZIP_GLINT_WIDTH = 0.016;
const ZIP_GLINT_OFFSET = -0.016;
const ZIP_GLINT_ALPHA = 0.85;

/** Upper-chest planes: the sheen that says the leather is stretched over pecs. */
const PEC_X = 0.12;
const PEC_Y = 0.085;
const PEC_RX = 0.1;
const PEC_RY = 0.055;
const PEC_LIT_ALPHA = 0.55;
const PEC_SHADE_SIDE_ALPHA = 0.22;
const PEC_GLINT_X = 0.135;
const PEC_GLINT_Y = 0.07;
const PEC_GLINT_RX = 0.085;
const PEC_GLINT_RY = 0.028;
/** The glint lies along the pec's upper curve, which falls toward the armpit. */
const PEC_GLINT_TILT = 0.3;
const PEC_GLINT_ALPHA = 0.95;
const GLINT_CORE = 0.55;
/** The fold under each arm, where the sleeve's seam pulls the side panel. */
const UNDERARM_FROM = pt(0.25, 0.2);
const UNDERARM_CONTROL = pt(0.205, 0.225);
const UNDERARM_TO = pt(0.165, 0.29);
/**
 * The fold where the fitted waist gathers above the hem, as a height above the
 * waist. One per side: each fold is a full layered stroke, and a second one a
 * pixel below the first merges with it at the tile.
 */
const WAIST_FOLDS = [-0.04] as const;
/** How far in from the side a waist fold reaches, as a share of the waist's half-width. */
const WAIST_FOLD_REACH = 0.42;
const WAIST_FOLD_SLANT = 0.018;
/** The fold starts just outside the jacket's side, so the silhouette clip ends it cleanly. */
const WAIST_FOLD_OVERREACH = 1.05;

/** The waistband's height: about a screen pixel and a half at the tile. */
const WAISTBAND_HEIGHT = 0.065;
const WAISTBAND_ALPHA = 0.85;
/** The lit seam along the waistband's top edge. */
const HEM_LIP_WIDTH = 0.026;
const HEM_LIP_ALPHA = 0.45;

/** The back yoke: the panel across the shoulder blades, facing up into the key. */
const YOKE_Y = 0.13;
const YOKE_DIP = 0.035;
const YOKE_LIGHT_ALPHA = 0.5;
const YOKE_LIGHT_RX = 0.24;
const YOKE_LIGHT_RY = 0.085;
const YOKE_LIGHT_X = -0.07;
const YOKE_LIGHT_Y = 0.045;
/**
 * The yoke seam: a sewn line across the shoulder blades, dark where the lower
 * panel tucks under and lit along the upper panel's turned edge. A bare back
 * has no line running straight across it, so this seam — with the collar and
 * the waistband — is what makes the back read as a garment rather than a
 * tanned back; a dark channel down the spine does the opposite and reads as
 * the muscle groove between the erectors.
 */
const YOKE_SEAM_WIDTH = 0.045;
const YOKE_SEAM_ALPHA = 0.9;
const YOKE_STITCH_WIDTH = 0.026;
/**
 * Faint: a bright stitch line straight across the back reads as a strap of a
 * harness worn over the jacket; the seam is carried by its dark tuck.
 */
const YOKE_STITCH_ALPHA = 0.3;
/** The lit stitch line sits just above the seam's dark tuck. */
const YOKE_STITCH_RISE = 0.03;

/** In profile the lit back: the yoke's sheen runs down the curve of the upper back. */
const PROFILE_YOKE_LIGHT = pt(-0.2, 0.07);
const PROFILE_YOKE_RX = 0.1;
const PROFILE_YOKE_RY = 0.055;
const PROFILE_BACK_GLINT = pt(-0.225, 0.07);
const PROFILE_BACK_GLINT_RX = 0.07;
const PROFILE_BACK_GLINT_RY = 0.014;
/** The glint follows the back's contour, which runs steeply down from the trapezius. */
const PROFILE_BACK_GLINT_TILT = 1.15;
/** The zip follows the chest contour a little inside it, so it bends over the pec. */
const PROFILE_ZIP_INSET = 0.028;
/** The top of the pec in profile tips up into the key. */
const PROFILE_PEC_LIGHT = pt(0.23, 0.07);
const PROFILE_PEC_RX = 0.06;
const PROFILE_PEC_RY = 0.04;
const PROFILE_PEC_ALPHA = 0.4;
const PROFILE_UNDER_PEC_FROM = pt(0.255, 0.24);
const PROFILE_UNDER_PEC_TO = pt(0.07, 0.22);
const PROFILE_LUMBAR_FOLD_FROM = pt(-0.16, 0.375);
const PROFILE_LUMBAR_FOLD_TO = pt(-0.04, 0.395);

function foldAlong(ctx: Ctx, from: Pt, control: Pt | null, to: Pt): void {
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (control === null) ctx.lineTo(to.x, to.y);
      else ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    FOLD_WIDTH,
    LEATHER,
    FOLD_OPACITY,
  );
}

function strokeYokeSeam(ctx: Ctx, frame: TorsoFrame, shoulderHalf: number): void {
  const { at } = frame;
  const seamAt = (rise: number): (() => void) => {
    const from = at(-shoulderHalf, YOKE_Y - rise);
    const control = at(0, YOKE_Y + YOKE_DIP * QUAD_CONTROL_REACH - rise);
    const to = at(shoulderHalf, YOKE_Y - rise);
    return () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    };
  };
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(LEATHER.deep, YOKE_SEAM_ALPHA);
  ctx.lineWidth = YOKE_SEAM_WIDTH;
  seamAt(0)();
  ctx.stroke();
  ctx.strokeStyle = rgba(LEATHER.rim, YOKE_STITCH_ALPHA);
  ctx.lineWidth = YOKE_STITCH_WIDTH;
  seamAt(YOKE_STITCH_RISE)();
  ctx.stroke();
}

/** A zip: a dark line with its teeth glinting on the lit side. */
function strokeZip(ctx: Ctx, trace: () => void, glint: Pt): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = LEATHER.shadow;
  ctx.lineWidth = ZIP_WIDTH;
  trace();
  ctx.stroke();
  ctx.save();
  ctx.translate(glint.x, glint.y);
  ctx.strokeStyle = rgba(LEATHER.specular, ZIP_GLINT_ALPHA);
  ctx.lineWidth = ZIP_GLINT_WIDTH;
  trace();
  ctx.stroke();
  ctx.restore();
}

/**
 * The flanks: below each armpit the ribcage turns away from the viewer, and
 * the lats run down it to the waist. Darkening that plane on both sides leaves
 * the chest a lit wedge, broad at the pecs and narrow at the belt — the V taper
 * read in value, which at the tile is the only place it can show: head-on the
 * hanging arms cover the silhouette's own taper.
 */
const FLANK_TOP_Y = 0.12;
/** Where the lit chest wedge meets the flank, as shares of the chest and waist half-widths. */
const FLANK_INNER_TOP = 0.56;
const FLANK_INNER_BOTTOM = 0.3;
const FLANK_OUTER_PAD = 0.06;
const FLANK_LIT_SIDE_ALPHA = 0.9;
const FLANK_SHADE_SIDE_ALPHA = 0.9;

function paintFlanks(ctx: Ctx, frame: TorsoFrame, chestHalf: number, waistHalf: number): void {
  const { at } = frame;
  for (const s of [-1, 1]) {
    const innerTop = at(s * chestHalf * FLANK_INNER_TOP, FLANK_TOP_Y);
    const innerBottom = at(s * waistHalf * FLANK_INNER_BOTTOM, frame.hemY + FLANK_OUTER_PAD);
    const outerTop = at(s * (chestHalf + FLANK_OUTER_PAD), FLANK_TOP_Y - FLANK_OUTER_PAD);
    const outerBottom = at(s * (waistHalf + FLANK_OUTER_PAD), frame.hemY + FLANK_OUTER_PAD);
    const fadeFrom = at(s * waistHalf * FLANK_INNER_BOTTOM, frame.waistY);
    const fadeTo = at(s * chestHalf, frame.waistY);
    const lit = s < 0;
    const tone = lit ? LEATHER.shadow : LEATHER.deep;
    const gradient = ctx.createLinearGradient(fadeFrom.x, fadeFrom.y, fadeTo.x, fadeTo.y);
    gradient.addColorStop(0, rgba(tone, 0));
    gradient.addColorStop(FLANK_RAMP, tone);
    gradient.addColorStop(1, tone);
    ctx.save();
    ctx.globalAlpha *= lit ? FLANK_LIT_SIDE_ALPHA : FLANK_SHADE_SIDE_ALPHA;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(innerTop.x, innerTop.y);
    ctx.lineTo(outerTop.x, outerTop.y);
    ctx.lineTo(outerBottom.x, outerBottom.y);
    ctx.lineTo(innerBottom.x, innerBottom.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** How quickly the flank shade comes up to full across its width. */
const FLANK_RAMP = 0.25;

/**
 * The zipped jacket is pulled across a chest wider than its waist, so the
 * leather draws into one deep tension fold down each side, from under the arm
 * toward the fastened hem. The pair points down in a V, and at the tile they
 * are the folds that survive — the waist creases are a pixel of nothing there
 * — so they carry the taper and say "stiff leather" together. The core is
 * wide enough to hold a whole screen pixel.
 */
const TENSION_FOLD_FROM = pt(0.9, ARMPIT_Y + 0.03);
const TENSION_FOLD_CONTROL = pt(0.5, 0.32);
/** Where the fold dies out, as a share of the waist's half-width and a rise above the hem. */
const TENSION_FOLD_TO_ACROSS = 0.2;
const TENSION_FOLD_TO_RISE = 0.035;
const TENSION_FOLD_WIDTH = 0.042;
const TENSION_FOLD_OPACITY = 0.9;

function paintTensionFolds(
  ctx: Ctx,
  frame: TorsoFrame,
  chestHalf: number,
  waistHalf: number,
): void {
  const { at } = frame;
  for (const s of [-1, 1]) {
    const from = at(s * chestHalf * TENSION_FOLD_FROM.x, TENSION_FOLD_FROM.y);
    const control = at(s * chestHalf * TENSION_FOLD_CONTROL.x, TENSION_FOLD_CONTROL.y);
    const to = at(s * waistHalf * TENSION_FOLD_TO_ACROSS, frame.hemY - TENSION_FOLD_TO_RISE);
    crease(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      },
      TENSION_FOLD_WIDTH,
      LEATHER,
      TENSION_FOLD_OPACITY,
    );
  }
}

/** Which sides' arms are lifted clear of the body; `side` is −1 for the figure's left. */
type RaisedArm = (side: number) => boolean;

/**
 * An arm lifted this far from hanging straight down pulls the side panel into
 * a fold under it. A hanging arm covers that spot entirely, so the fold is
 * only painted when it can be seen.
 */
const ARM_RAISED_ANGLE = 0.6;

function raisedArms(skeleton: Skeleton, frame: TorsoFrame): RaisedArm {
  const lifted = (chain: Skeleton['leftArm']): boolean => {
    const along = frame.downOf(chain.joint) - frame.downOf(chain.root);
    const across = Math.abs(frame.acrossOf(chain.joint) - frame.acrossOf(chain.root));
    return Math.atan2(across, along) > ARM_RAISED_ANGLE;
  };
  const left = lifted(skeleton.leftArm);
  const right = lifted(skeleton.rightArm);
  return (side) => (side < 0 ? left : right);
}

function paintUnderarmFold(ctx: Ctx, frame: TorsoFrame, s: number): void {
  const { at } = frame;
  foldAlong(
    ctx,
    at(s * UNDERARM_FROM.x, UNDERARM_FROM.y),
    at(s * UNDERARM_CONTROL.x, UNDERARM_CONTROL.y),
    at(s * UNDERARM_TO.x, UNDERARM_TO.y),
  );
}

function paintFront(
  ctx: Ctx,
  frame: TorsoFrame,
  waistHalf: number,
  chestHalf: number,
  raised: RaisedArm,
): void {
  const { at } = frame;
  paintFlanks(ctx, frame, chestHalf, waistHalf);
  paintTensionFolds(ctx, frame, chestHalf, waistHalf);
  for (const s of [-1, 1]) {
    const lit = s < 0;
    const pecCentre = at(s * PEC_X, PEC_Y);
    fillSoftEllipse(
      ctx,
      pecCentre.x,
      pecCentre.y,
      PEC_RX,
      PEC_RY,
      LEATHER.light,
      lit ? PEC_LIT_ALPHA : PEC_SHADE_SIDE_ALPHA,
      frame.angle - HALF_PI,
    );
    if (lit) {
      const glint = at(s * PEC_GLINT_X, PEC_GLINT_Y);
      fillSoftEllipse(
        ctx,
        glint.x,
        glint.y,
        PEC_GLINT_RX,
        PEC_GLINT_RY,
        LEATHER.specular,
        PEC_GLINT_ALPHA,
        frame.angle - HALF_PI + PEC_GLINT_TILT,
        GLINT_CORE,
      );
    }
    if (raised(s)) paintUnderarmFold(ctx, frame, s);
    paintWaistFolds(ctx, frame, waistHalf, s);
  }
  const zipTop = at(0, -NECK_BASE_RISE + NECKLINE_DIP);
  const zipBottom = frame.hem(0, HEM_SAG);
  strokeZip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(zipTop.x, zipTop.y);
      ctx.lineTo(zipBottom.x, zipBottom.y);
    },
    zipGlintOffset(frame),
  );
}

function zipGlintOffset(frame: TorsoFrame): Pt {
  const origin = frame.at(0, 0);
  const shifted = frame.at(ZIP_GLINT_OFFSET, 0);
  return pt(shifted.x - origin.x, shifted.y - origin.y);
}

function paintWaistFolds(ctx: Ctx, frame: TorsoFrame, waistHalf: number, s: number): void {
  for (const rise of WAIST_FOLDS) {
    const y = frame.waistY + rise;
    foldAlong(
      ctx,
      frame.at(s * waistHalf * WAIST_FOLD_OVERREACH, y - WAIST_FOLD_SLANT),
      null,
      frame.at(s * waistHalf * (1 - WAIST_FOLD_REACH), y),
    );
  }
}

function paintBack(
  ctx: Ctx,
  frame: TorsoFrame,
  waistHalf: number,
  chestHalf: number,
  shoulderHalf: number,
  raised: RaisedArm,
): void {
  const { at } = frame;
  paintFlanks(ctx, frame, chestHalf, waistHalf);
  paintTensionFolds(ctx, frame, chestHalf, waistHalf);
  const yokeLight = at(YOKE_LIGHT_X, YOKE_LIGHT_Y);
  fillSoftEllipse(
    ctx,
    yokeLight.x,
    yokeLight.y,
    YOKE_LIGHT_RX,
    YOKE_LIGHT_RY,
    LEATHER.light,
    YOKE_LIGHT_ALPHA,
    frame.angle - HALF_PI,
  );
  const glint = at(-PEC_GLINT_X, PEC_GLINT_Y - YOKE_DIP);
  fillSoftEllipse(
    ctx,
    glint.x,
    glint.y,
    PEC_GLINT_RX,
    PEC_GLINT_RY,
    LEATHER.specular,
    PEC_GLINT_ALPHA,
    frame.angle - HALF_PI + PEC_GLINT_TILT,
    GLINT_CORE,
  );
  strokeYokeSeam(ctx, frame, shoulderHalf);
  for (const s of [-1, 1]) {
    if (raised(s)) paintUnderarmFold(ctx, frame, s);
    paintWaistFolds(ctx, frame, waistHalf, s);
  }
}

/**
 * Edge-on the near arm hangs over the side of the ribcage, leather on leather,
 * and the two merge into one column at the tile. The side plane round the arm
 * turns away from the key and sits in the arm's own shadow, so a broad dark
 * band follows the upper arm down the flank: with the lit sleeve laid over it,
 * the arm reads as a form standing off the body on both edges, not as a
 * stripe painted on it.
 */
const ARM_FLANK_SHADOW_HALF = 0.2;
const ARM_FLANK_SHADOW_ALPHA = 0.85;
/** The shadow reaches a little past the elbow, where the forearm leaves the body. */
const ARM_FLANK_SHADOW_PAST_ELBOW = 0.35;
/**
 * An arm lifted off the side throws its shadow further off and softer, so the
 * band fades out as the upper arm swings up to this angle from hanging —
 * gradually, so an arm rising through a fidget does not drop it in one frame.
 */
const ARM_FLANK_SHADOW_FADE_ANGLE = deg(80);

function paintArmShadowOnFlank(ctx: Ctx, arm: BoneChain): void {
  const lift = Math.abs(Math.atan2(arm.joint.x - arm.root.x, arm.joint.y - arm.root.y));
  const strength = clamp01(1 - lift / ARM_FLANK_SHADOW_FADE_ANGLE);
  if (strength <= 0) return;
  const past = mixPt(arm.joint, arm.end, ARM_FLANK_SHADOW_PAST_ELBOW);
  strokeSoftCrease(
    ctx,
    ARM_FLANK_SHADOW_HALF * 2,
    LEATHER.deep,
    () => {
      ctx.moveTo(arm.root.x, arm.root.y);
      ctx.lineTo(arm.joint.x, arm.joint.y);
      ctx.lineTo(past.x, past.y);
    },
    ARM_FLANK_SHADOW_ALPHA * strength,
    FIGURE_CREASE_LAYERS,
  );
}

function paintProfile(ctx: Ctx, frame: TorsoFrame, nearArm: BoneChain): void {
  const { at } = frame;
  const p = (q: Pt): Pt => at(q.x, q.y);
  const yoke = p(PROFILE_YOKE_LIGHT);
  fillSoftEllipse(
    ctx,
    yoke.x,
    yoke.y,
    PROFILE_YOKE_RX,
    PROFILE_YOKE_RY,
    LEATHER.light,
    YOKE_LIGHT_ALPHA,
    frame.angle - HALF_PI,
  );
  const backGlint = p(PROFILE_BACK_GLINT);
  fillSoftEllipse(
    ctx,
    backGlint.x,
    backGlint.y,
    PROFILE_BACK_GLINT_RX,
    PROFILE_BACK_GLINT_RY,
    LEATHER.specular,
    PEC_GLINT_ALPHA,
    frame.angle - HALF_PI + PROFILE_BACK_GLINT_TILT,
    GLINT_CORE,
  );
  const pecLight = p(PROFILE_PEC_LIGHT);
  fillSoftEllipse(
    ctx,
    pecLight.x,
    pecLight.y,
    PROFILE_PEC_RX,
    PROFILE_PEC_RY,
    LEATHER.light,
    PROFILE_PEC_ALPHA,
    frame.angle - HALF_PI,
  );
  foldAlong(ctx, p(PROFILE_UNDER_PEC_FROM), null, p(PROFILE_UNDER_PEC_TO));
  foldAlong(ctx, p(PROFILE_LUMBAR_FOLD_FROM), null, p(PROFILE_LUMBAR_FOLD_TO));
  paintArmShadowOnFlank(ctx, nearArm);

  const inset = (q: Pt): Pt => at(q.x - PROFILE_ZIP_INSET, q.y);
  const zipTop = inset(PROFILE.neckFront);
  const clavicle = inset(PROFILE.clavicle);
  const pec = inset(PROFILE.pecControl);
  const underPec = inset(PROFILE.underPec);
  const belly = inset(PROFILE.belly);
  const zipBottom = frame.hem(PROFILE.hemFront.x - PROFILE_ZIP_INSET);
  strokeZip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(zipTop.x, zipTop.y);
      ctx.lineTo(clavicle.x, clavicle.y);
      ctx.quadraticCurveTo(pec.x, pec.y, underPec.x, underPec.y);
      ctx.lineTo(belly.x, belly.y);
      ctx.lineTo(zipBottom.x, zipBottom.y);
    },
    zipGlintOffset(frame),
  );
}

/**
 * The waistband: a separate strip of leather sewn along the hem, darker than
 * the body panels with its top seam catching the light. Skin has no band
 * running round the waist, so like the yoke seam it is a garment-only mark,
 * and it is the line that parts the jacket from the white boxers below.
 */
function paintWaistband(ctx: Ctx, frame: TorsoFrame, back: number, front: number): void {
  const along = (dy: number): (() => void) => {
    const left = frame.hem(back, dy);
    const mid = frame.hem((back + front) / 2, HEM_SAG + dy);
    const right = frame.hem(front, dy);
    return () => {
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.quadraticCurveTo(mid.x, mid.y, right.x, right.y);
    };
  };
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(LEATHER.shadow, WAISTBAND_ALPHA);
  ctx.lineWidth = WAISTBAND_HEIGHT;
  along(-WAISTBAND_HEIGHT / 2)();
  ctx.stroke();
  ctx.strokeStyle = rgba(LEATHER.rim, HEM_LIP_ALPHA);
  ctx.lineWidth = HEM_LIP_WIDTH;
  along(-WAISTBAND_HEIGHT)();
  ctx.stroke();
}

// ── Collar ───────────────────────────────────────────────────────────────────

/**
 * The trollskin shirt: a dark navy, just visible above the zipped collar. At
 * the tile it is a one-pixel dark band that parts the face from the jacket.
 * It is an item he can take off, and then the collar closes on bare neck.
 */
const TROLLSKIN = '#1d2236';
const TROLLSKIN_LIT = '#2a3150';
const TROLLSKIN_BAND = 0.026;

/** The stand collar: a short upright band round the base of the neck. */
const COLLAR_HEIGHT = 0.042;
/** Head-on the collar's front edges sit lower than its sides; it rises behind the neck. */
const COLLAR_FRONT_DROP = 0.015;
const COLLAR_BACK_DROP = 0.0;
/** The collar's top is a touch narrower than its base, hugging the neck. */
const COLLAR_TOP_HUG = 0.9;
const COLLAR_RIM_ALPHA = 0.65;
const COLLAR_RIM_WIDTH = 0.012;

/** Profile collar corners, in the torso frame (facing +x). */
const PROFILE_COLLAR = {
  frontBottom: pt(0.09, 0.035),
  backBottom: pt(-0.12, 0.0),
  backTop: pt(-0.115, -0.045),
  frontTop: pt(0.075, 0.0),
} as const;

interface CollarShape {
  readonly bottomLeft: Pt;
  readonly bottomMid: Pt;
  readonly bottomRight: Pt;
  readonly topRight: Pt;
  readonly topMid: Pt;
  readonly topLeft: Pt;
}

function collarShape(frame: TorsoFrame, view: ViewSpec, raise: number): CollarShape {
  const { at } = frame;
  if (view.profile) {
    const c = PROFILE_COLLAR;
    return {
      bottomLeft: at(c.backBottom.x, c.backBottom.y),
      bottomMid: at(0, (c.backBottom.y + c.frontBottom.y) / 2),
      bottomRight: at(c.frontBottom.x, c.frontBottom.y),
      topRight: at(c.frontTop.x, c.frontTop.y - raise),
      topMid: at(0, (c.backTop.y + c.frontTop.y) / 2 - raise),
      topLeft: at(c.backTop.x, c.backTop.y - raise),
    };
  }
  const half = NECK_WIDTH * view.girth * COLLAR_WRAP;
  const drop = view.showsBack ? COLLAR_BACK_DROP : COLLAR_FRONT_DROP;
  const baseY = -NECK_BASE_RISE;
  const topY = baseY - COLLAR_HEIGHT;
  return {
    bottomLeft: at(-half, baseY),
    bottomMid: at(0, baseY + drop * QUAD_CONTROL_REACH),
    bottomRight: at(half, baseY),
    topRight: at(half * COLLAR_TOP_HUG, topY - raise),
    topMid: at(0, topY + drop * QUAD_CONTROL_REACH - raise),
    topLeft: at(-half * COLLAR_TOP_HUG, topY - raise),
  };
}

function traceCollar(ctx: Ctx, c: CollarShape): void {
  ctx.beginPath();
  ctx.moveTo(c.bottomLeft.x, c.bottomLeft.y);
  ctx.quadraticCurveTo(c.bottomMid.x, c.bottomMid.y, c.bottomRight.x, c.bottomRight.y);
  ctx.lineTo(c.topRight.x, c.topRight.y);
  ctx.quadraticCurveTo(c.topMid.x, c.topMid.y, c.topLeft.x, c.topLeft.y);
  ctx.closePath();
}

function drawCollar(ctx: Ctx, frame: TorsoFrame, view: ViewSpec, wearsShirt: boolean): void {
  const shirt = collarShape(frame, view, TROLLSKIN_BAND);
  if (wearsShirt) {
    traceCollar(ctx, shirt);
    ctx.fillStyle = TROLLSKIN;
    ctx.fill();
  }

  // The collar shows as a pixel or two at the tile, so it takes one flat tone
  // rather than a full form shade — the lit one, because a stand collar turns
  // its outer face up to the key, and a band lighter than the jacket below it
  // and darker than the neck above it is what says "collar" at this size.
  const collar = collarShape(frame, view, 0);
  traceCollar(ctx, collar);
  ctx.fillStyle = LEATHER.light;
  ctx.fill();

  // The collar's upper edge rolls toward the key; a lit lip, with the shirt
  // just above it lifted a step so the band reads as cloth, not a gap.
  ctx.lineCap = 'round';
  ctx.lineWidth = COLLAR_RIM_WIDTH;
  if (wearsShirt) {
    ctx.strokeStyle = TROLLSKIN_LIT;
    ctx.beginPath();
    ctx.moveTo(shirt.topLeft.x, shirt.topLeft.y);
    ctx.quadraticCurveTo(shirt.topMid.x, shirt.topMid.y, shirt.topRight.x, shirt.topRight.y);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(LEATHER.rim, COLLAR_RIM_ALPHA);
  ctx.beginPath();
  ctx.moveTo(collar.topLeft.x, collar.topLeft.y);
  ctx.quadraticCurveTo(collar.topMid.x, collar.topMid.y, collar.topRight.x, collar.topRight.y);
  ctx.stroke();
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function drawJacket(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, view: ViewSpec): void {
  const frame = torsoFrame(skeleton, pose);
  const waistHalf = (WAIST_HALF + JACKET_OFFSET) * view.girth;
  const chestHalf = (CHEST_HALF + JACKET_OFFSET) * view.girth;
  const shoulderHalf = Math.max(
    -frame.acrossOf(skeleton.leftShoulder),
    frame.acrossOf(skeleton.rightShoulder),
  );
  const trace = view.profile
    ? (): void => traceProfile(ctx, frame, pose)
    : (): void => traceFacing(ctx, frame, skeleton, pose, view);
  const halfWidth = view.profile
    ? (PROFILE.pecControl.x - PROFILE.bladeControl.x) / 2
    : shoulderHalf;

  ctx.save();
  shadeForm(ctx, trace, { from: frame.at(0, 0), to: frame.at(0, frame.hemY) }, LEATHER, {
    halfWidth,
    specular: CHEST_SPECULAR,
    softness: TORSO_SOFTNESS,
  });
  withClip(ctx, trace, () => {
    if (view.profile) paintProfile(ctx, frame, skeleton.rightArm);
    else if (view.showsBack) {
      paintBack(ctx, frame, waistHalf, chestHalf, shoulderHalf, raisedArms(skeleton, frame));
    } else paintFront(ctx, frame, waistHalf, chestHalf, raisedArms(skeleton, frame));
    if (view.profile) paintWaistband(ctx, frame, PROFILE.hemBack.x, PROFILE.hemFront.x);
    else paintWaistband(ctx, frame, -waistHalf * HEM_FLARE, waistHalf * HEM_FLARE);
  });
  drawCollar(ctx, frame, view, gearOf(pose).trollskinShirt === true);
  ctx.restore();
}
