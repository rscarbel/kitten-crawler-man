/**
 * Small worn accessories layered over the human rig after Carl's own painter
 * has finished, so a townsfolk look reads its role at a glance without a
 * bespoke garment system of its own: an apron, a satchel, a tabard, a
 * brimmed hat, a stole, a patched hood. Each is drawn in the same figure-unit
 * space Carl's own rig paints in (`carl/proportions.ts`'s constants), so it
 * sits on him wherever the pose puts his shoulders, waist and head — it is
 * not baked into a fixed screen position.
 *
 * These are deliberately simple flat/two-tone shapes, not full anatomy-grade
 * paint: the point is a silhouette and colour cue that survives at 32px, laid
 * over a body already fully shaded by Carl's own painter.
 */

import { mix, rgba } from '../carlArt';
import type { CarlPose, CarlView } from '../carl/rig';
import type { Ramp } from '../carl/palette';
import {
  HEAD_CENTRE_Y,
  HEAD_RX,
  HEAD_RY,
  HIP_Y,
  LEG_ROOT_HALF,
  SHOULDER_HALF,
  SHOULDER_Y,
  WAIST_Y,
} from '../carl/proportions';

type Ctx = CanvasRenderingContext2D;

export type AccessoryKind =
  | 'none'
  | 'apron'
  | 'satchel'
  | 'tabard'
  | 'brimmedHat'
  | 'stole'
  | 'patchedHood'
  | 'ledgerPencil'
  | 'shawlCharms'
  | 'flourApron'
  | 'vialCase'
  | 'builderRule';

export interface AccessorySpec {
  readonly kind: AccessoryKind;
  readonly color: string;
  readonly accentColor?: string;
}

/** How much darker/lighter the shaded and lit edge of a flat accessory shape are. */
const SHADE_MIX = 0.35;
const LIGHT_MIX = 0.25;
const SHADOW_TOWARD = '#100c14';
const LIGHT_TOWARD = '#ffffff';

function shaded(color: string): string {
  return mix(color, SHADOW_TOWARD, SHADE_MIX);
}
function lit(color: string): string {
  return mix(color, LIGHT_TOWARD, LIGHT_MIX);
}

/** A pencil-graphite colour shared by every resident who carries a writing tool. */
const PENCIL_COLOR = '#c9a24a';
/** A hairline outline weight shared by the small flat props below (ledger corners, tongs, etc). */
const FINE_OUTLINE_WIDTH = 0.006;
/** A slightly heavier stroke weight for a prop's own most visible line. */
const PROP_STROKE_WIDTH = 0.01;

// ── Trousers ─────────────────────────────────────────────────────────────────
//
// Carl's own canon look is bare-legged below his boxers — a trait of his own
// character, not of the rig every look shares. A town of citizens in his
// boxers reads as absurd rather than unfinished, so every adult look wears
// trousers over the bare legs his own painter draws, following the pose's own
// foot targets rather than a fixed shape, so they track the stride instead of
// floating free of it.

/**
 * Half-widths, the same convention `THIGH_WIDTH`/`CALF_WIDTH`/`ANKLE_WIDTH`
 * in `carl/proportions.ts` use (thigh 0.14, calf 0.11, ankle 0.04). The
 * `outer` share is comfortably past the bare leg so loose cloth clears it;
 * the `inner` share is deliberately smaller than `outer` (not the bare leg's
 * own half-width) so the two legs' fabric never meets in the middle and
 * fuses into one blob — a real trouser has a visible seam and shadow between
 * the legs even standing with the feet close together.
 */
const TROUSER_HIP_OUTER = 0.15;
const TROUSER_HIP_INNER = 0.065;
const TROUSER_KNEE_OUTER = 0.115;
const TROUSER_KNEE_INNER = 0.05;
const TROUSER_ANKLE_OUTER = 0.075;
const TROUSER_ANKLE_INNER = 0.035;
/** Edge-on there is no left/right to separate, so both edges use the outer (fuller) width. */
const TROUSER_PROFILE_HALF = TROUSER_HIP_OUTER;
const TROUSER_PROFILE_KNEE_HALF = TROUSER_KNEE_OUTER;
const TROUSER_PROFILE_ANKLE_HALF = TROUSER_ANKLE_OUTER;
const TROUSER_HIP_Y = WAIST_Y;
/** In profile both legs root near the centreline rather than at the hip's full width. */
const TROUSER_PROFILE_ROOT_X = 0.02;
/** How far the knee bend bows toward the foot's own lean, as a share of the hip-to-foot span. */
const TROUSER_KNEE_BOW = 0.5;
const TROUSER_OUTLINE_WIDTH = 0.012;
const TROUSER_INSEAM_SHADOW_ALPHA = 0.55;
const TROUSER_CUFF_WIDTH = 0.014;
const TROUSER_CUFF_ALPHA = 0.6;
/** A lit stripe down the outer edge, so a leg reads as a round form rather than a flat card. */
const TROUSER_LIGHT_STRIPE_WIDTH = 0.022;
const TROUSER_LIGHT_STRIPE_ALPHA = 0.35;
const TROUSER_LIGHT_STRIPE_INSET = 0.55;
/** The waistband: a band across both legs' own hip points. */
const WAISTBAND_STRIP_HEIGHT = 0.03;
const WAISTBAND_STRIP_ALPHA = 0.7;

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

function unitPerp(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/**
 * One trouser leg as a single continuous tapered outline (hip → knee → foot,
 * both edges), rather than two stroked-and-filled capsules meeting at the
 * knee — two capsules leave a visible seam where their rounded caps overlap
 * imperfectly at the joint; one path miters cleanly through the bend instead.
 * `outward` is the leg's own sideways sign (−1 left, +1 right) so the inner
 * (crotch-side) edge can stay narrower than the outer edge.
 */
function traceTaperedLeg(
  ctx: Ctx,
  hip: Vec2,
  foot: Vec2,
  outward: number,
  hipOuter: number,
  hipInner: number,
  kneeOuter: number,
  kneeInner: number,
  ankleOuter: number,
  ankleInner: number,
): void {
  const knee = {
    x: hip.x + (foot.x - hip.x) * TROUSER_KNEE_BOW,
    y: hip.y + (foot.y - hip.y) * TROUSER_KNEE_BOW,
  };
  const perpUpper = unitPerp(hip, knee);
  const perpLower = unitPerp(knee, foot);
  const perpKnee = normalize({ x: perpUpper.x + perpLower.x, y: perpUpper.y + perpLower.y });
  // `outward` decides which side of each perpendicular is the fuller, outer edge.
  const outer = (base: Vec2, perp: Vec2, half: number): Vec2 => ({
    x: base.x + perp.x * half * outward,
    y: base.y + perp.y * half * outward,
  });
  const inner = (base: Vec2, perp: Vec2, half: number): Vec2 => ({
    x: base.x - perp.x * half * outward,
    y: base.y - perp.y * half * outward,
  });
  ctx.beginPath();
  ctx.moveTo(outer(hip, perpUpper, hipOuter).x, outer(hip, perpUpper, hipOuter).y);
  const kneeOut = outer(knee, perpKnee, kneeOuter);
  ctx.lineTo(kneeOut.x, kneeOut.y);
  const footOut = outer(foot, perpLower, ankleOuter);
  ctx.lineTo(footOut.x, footOut.y);
  const footIn = inner(foot, perpLower, ankleInner);
  ctx.lineTo(footIn.x, footIn.y);
  const kneeIn = inner(knee, perpKnee, kneeInner);
  ctx.lineTo(kneeIn.x, kneeIn.y);
  const hipIn = inner(hip, perpUpper, hipInner);
  ctx.lineTo(hipIn.x, hipIn.y);
  ctx.closePath();
}

/** Paints one trouser leg: fill, outline, a lit outer stripe, and a cuff line at the ankle. */
function paintTrouserLeg(
  ctx: Ctx,
  hip: Vec2,
  foot: Vec2,
  outward: number,
  widths: readonly [number, number, number, number, number, number],
  fill: string,
  outline: string,
): void {
  const [hipOuter, hipInner, kneeOuter, kneeInner, ankleOuter, ankleInner] = widths;
  traceTaperedLeg(
    ctx,
    hip,
    foot,
    outward,
    hipOuter,
    hipInner,
    kneeOuter,
    kneeInner,
    ankleOuter,
    ankleInner,
  );
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = TROUSER_OUTLINE_WIDTH;
  ctx.stroke();

  // A lit stripe along the outer edge reads as a round leg, not a flat card.
  const knee = {
    x: hip.x + (foot.x - hip.x) * TROUSER_KNEE_BOW,
    y: hip.y + (foot.y - hip.y) * TROUSER_KNEE_BOW,
  };
  const stripeInset = (a: Vec2, b: Vec2, t: number): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  ctx.strokeStyle = rgba(lit(outline), TROUSER_LIGHT_STRIPE_ALPHA);
  ctx.lineWidth = TROUSER_LIGHT_STRIPE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const stripeTop = stripeInset(hip, knee, 1 - TROUSER_LIGHT_STRIPE_INSET);
  ctx.moveTo(stripeTop.x, stripeTop.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(foot.x, foot.y);
  ctx.stroke();

  // The cuff: a lit hem line just above the ankle.
  const cuffUp = { x: foot.x, y: foot.y - ankleOuter * 0.6 };
  ctx.strokeStyle = rgba(lit(outline), TROUSER_CUFF_ALPHA);
  ctx.lineWidth = TROUSER_CUFF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cuffUp.x - ankleOuter, cuffUp.y);
  ctx.lineTo(cuffUp.x + ankleOuter, cuffUp.y);
  ctx.stroke();
}

/**
 * Draws trousers over both legs, following `pose`'s own foot targets — the
 * far leg a shade darker than the near one, the same lit/shadow-side read
 * every other worn accessory here uses — plus a waistband across the hip and
 * an inseam shadow between the legs, so the crotch reads as a gap rather
 * than fused cloth.
 */
export function drawTrousers(ctx: Ctx, view: CarlView, pose: CarlPose, color: string): void {
  const profile = view === 'side';
  const leftRootX = profile ? -TROUSER_PROFILE_ROOT_X : -LEG_ROOT_HALF;
  const rightRootX = profile ? TROUSER_PROFILE_ROOT_X : LEG_ROOT_HALF;
  const leftHip = { x: leftRootX, y: TROUSER_HIP_Y };
  const rightHip = { x: rightRootX, y: TROUSER_HIP_Y };
  const far = shaded(color);
  const widths: readonly [number, number, number, number, number, number] = profile
    ? [
        TROUSER_PROFILE_HALF,
        TROUSER_PROFILE_HALF,
        TROUSER_PROFILE_KNEE_HALF,
        TROUSER_PROFILE_KNEE_HALF,
        TROUSER_PROFILE_ANKLE_HALF,
        TROUSER_PROFILE_ANKLE_HALF,
      ]
    : [
        TROUSER_HIP_OUTER,
        TROUSER_HIP_INNER,
        TROUSER_KNEE_OUTER,
        TROUSER_KNEE_INNER,
        TROUSER_ANKLE_OUTER,
        TROUSER_ANKLE_INNER,
      ];
  // Far leg first, so in profile the near leg's cloth laps over it.
  paintTrouserLeg(ctx, leftHip, pose.leftFoot, 1, widths, far, shaded(far));
  paintTrouserLeg(ctx, rightHip, pose.rightFoot, -1, widths, color, shaded(color));

  if (profile) return;
  // The waistband and the inseam shadow only mean anything front/back on, where both legs show side by side.
  ctx.strokeStyle = rgba(shaded(color), WAISTBAND_STRIP_ALPHA);
  ctx.lineWidth = WAISTBAND_STRIP_HEIGHT;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(leftHip.x - TROUSER_HIP_OUTER, TROUSER_HIP_Y);
  ctx.lineTo(rightHip.x + TROUSER_HIP_OUTER, TROUSER_HIP_Y);
  ctx.stroke();
  ctx.strokeStyle = rgba('#100c14', TROUSER_INSEAM_SHADOW_ALPHA);
  ctx.lineWidth = TROUSER_HIP_INNER * 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, TROUSER_HIP_Y);
  ctx.lineTo(0, TROUSER_HIP_Y + WAISTBAND_STRIP_HEIGHT * 2);
  ctx.stroke();
}

// ── Shoes ────────────────────────────────────────────────────────────────────
//
// Carl's own canon look is barefoot — again a trait of his own character, not
// of the rig. Every townsfolk look wears a flat shoe over each bare foot,
// following the pose's own foot target the same way trousers do, so nothing
// of his bare skin shows past the ankle on anyone.

const SHOE_HALF_WIDTH = 0.09;
const SHOE_HALF_LENGTH = 0.065;
/** The shoe sits centred slightly above the foot's own ground point, so its sole reads as flat on the floor rather than floating. */
const SHOE_RISE = 0.025;
const SHOE_OUTLINE_WIDTH = 0.01;
/** A lit seam across the toe, the one shoe-specific mark that survives at 32px. */
const SHOE_SEAM_ALPHA = 0.55;
const SHOE_SEAM_WIDTH = 0.008;

function drawShoe(ctx: Ctx, foot: { x: number; y: number }, color: string): void {
  const cy = foot.y - SHOE_RISE;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(foot.x, cy, SHOE_HALF_WIDTH, SHOE_HALF_LENGTH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shaded(color);
  ctx.lineWidth = SHOE_OUTLINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = rgba(lit(color), SHOE_SEAM_ALPHA);
  ctx.lineWidth = SHOE_SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(foot.x - SHOE_HALF_WIDTH * 0.6, cy - SHOE_HALF_LENGTH * 0.2);
  ctx.lineTo(foot.x + SHOE_HALF_WIDTH * 0.6, cy - SHOE_HALF_LENGTH * 0.2);
  ctx.stroke();
}

/** Draws a flat shoe over each of `pose`'s own feet — the far one a shade darker, matching every other worn accessory here. */
export function drawShoes(ctx: Ctx, _view: CarlView, pose: CarlPose, color: string): void {
  drawShoe(ctx, pose.leftFoot, shaded(color));
  drawShoe(ctx, pose.rightFoot, color);
}

const APRON_TOP = WAIST_Y - 0.08;
const APRON_BOTTOM = HIP_Y + 0.42;
const APRON_HALF_WIDTH = 0.16;
const APRON_TIE_WIDTH = 0.014;
const APRON_PROFILE_HALF_WIDTH = 0.07;
/** The hem tapers in from the bib's own width, so the apron reads as cloth rather than a rigid board. */
const APRON_HEM_TAPER = 0.85;
/** The waist tie's knot reaches slightly past the bib's own edge on each side. */
const APRON_TIE_OVERHANG = 1.1;

function drawApron(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  if (view === 'back') return;
  const half = view === 'side' ? APRON_PROFILE_HALF_WIDTH : APRON_HALF_WIDTH;
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  ctx.moveTo(-half, APRON_TOP);
  ctx.lineTo(half, APRON_TOP);
  ctx.lineTo(half * APRON_HEM_TAPER, APRON_BOTTOM);
  ctx.lineTo(-half * APRON_HEM_TAPER, APRON_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shaded(spec.color);
  ctx.lineWidth = APRON_TIE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-half, APRON_TOP);
  ctx.lineTo(half, APRON_TOP);
  ctx.stroke();
  // A waist tie: two short bands knotted at the sides.
  ctx.strokeStyle = spec.accentColor ?? shaded(spec.color);
  ctx.beginPath();
  ctx.moveTo(-half * APRON_TIE_OVERHANG, WAIST_Y);
  ctx.lineTo(half * APRON_TIE_OVERHANG, WAIST_Y);
  ctx.stroke();
}

const SATCHEL_STRAP_WIDTH = 0.02;
const SATCHEL_POUCH_HALF = 0.075;
const SATCHEL_POUCH_Y = HIP_Y + 0.1;
/** How far below the shoulder line the strap starts. */
const SATCHEL_STRAP_TOP_DROP = 0.05;
/** The strap's near-centreline anchor points in profile. */
const SATCHEL_PROFILE_SHOULDER_X = 0.04;
const SATCHEL_PROFILE_HIP_X = -0.02;
/** The strap's anchor points as a fraction of shoulder half-width, front-on. */
const SATCHEL_FRONT_SHOULDER_FRAC = 0.7;
const SATCHEL_FRONT_HIP_FRAC = 0.5;
/** The pouch reads slightly flattened top-to-bottom, not a perfect circle. */
const SATCHEL_POUCH_VERTICAL_FRAC = 0.8;

function drawSatchel(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  const shoulderX =
    view === 'side' ? SATCHEL_PROFILE_SHOULDER_X : -SHOULDER_HALF * SATCHEL_FRONT_SHOULDER_FRAC;
  const hipX = view === 'side' ? SATCHEL_PROFILE_HIP_X : SHOULDER_HALF * SATCHEL_FRONT_HIP_FRAC;
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = SATCHEL_STRAP_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, SHOULDER_Y + SATCHEL_STRAP_TOP_DROP);
  ctx.lineTo(hipX, SATCHEL_POUCH_Y);
  ctx.stroke();
  ctx.fillStyle = spec.accentColor ?? shaded(spec.color);
  ctx.beginPath();
  ctx.ellipse(
    hipX,
    SATCHEL_POUCH_Y,
    SATCHEL_POUCH_HALF,
    SATCHEL_POUCH_HALF * SATCHEL_POUCH_VERTICAL_FRAC,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

const TABARD_TOP = SHOULDER_Y + 0.04;
const TABARD_BOTTOM = WAIST_Y + 0.05;
const TABARD_HALF_WIDTH = 0.1;
const TABARD_OUTLINE_WIDTH = 0.012;

function drawTabard(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  if (view === 'side') return;
  ctx.fillStyle = spec.color;
  ctx.fillRect(-TABARD_HALF_WIDTH, TABARD_TOP, TABARD_HALF_WIDTH * 2, TABARD_BOTTOM - TABARD_TOP);
  ctx.strokeStyle = spec.accentColor ?? lit(spec.color);
  ctx.lineWidth = TABARD_OUTLINE_WIDTH;
  ctx.strokeRect(-TABARD_HALF_WIDTH, TABARD_TOP, TABARD_HALF_WIDTH * 2, TABARD_BOTTOM - TABARD_TOP);
}

const HAT_CROWN_RY = HEAD_RY * 0.55;
const HAT_CROWN_RX = HEAD_RX * 0.85;
const HAT_CROWN_RISE = HEAD_RY * 1.15;
const HAT_BRIM_RY = HEAD_RY * 0.22;
const HAT_BRIM_RX = HEAD_RX * 1.7;
const HAT_BRIM_RISE = HEAD_RY * 0.78;
const HAT_PROFILE_BRIM_LEAD = HEAD_RX * 1.4;
/** The profile brim's own centre sits slightly ahead of the lead point, not on top of it. */
const HAT_PROFILE_BRIM_OFFSET_FRAC = 0.15;

function drawBrimmedHat(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  const crownY = HEAD_CENTRE_Y - HAT_CROWN_RISE;
  const brimY = HEAD_CENTRE_Y - HAT_BRIM_RISE;
  ctx.fillStyle = shaded(spec.color);
  ctx.beginPath();
  ctx.ellipse(0, crownY, HAT_CROWN_RX, HAT_CROWN_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = spec.color;
  if (view === 'side') {
    ctx.beginPath();
    ctx.ellipse(
      HAT_PROFILE_BRIM_LEAD * HAT_PROFILE_BRIM_OFFSET_FRAC,
      brimY,
      HAT_PROFILE_BRIM_LEAD,
      HAT_BRIM_RY,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.beginPath();
    ctx.ellipse(0, brimY, HAT_BRIM_RX, HAT_BRIM_RY, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = lit(spec.color);
  ctx.lineWidth = PROP_STROKE_WIDTH;
  ctx.stroke();
}

const STOLE_HALF_WIDTH = 0.03;
const STOLE_TOP = SHOULDER_Y + 0.06;
const STOLE_BOTTOM = HIP_Y + 0.2;
const STOLE_BAND_HEIGHT = 0.02;

function drawStole(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  if (view === 'side') return;
  ctx.fillStyle = spec.color;
  ctx.fillRect(-STOLE_HALF_WIDTH, STOLE_TOP, STOLE_HALF_WIDTH * 2, STOLE_BOTTOM - STOLE_TOP);
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  ctx.fillRect(
    -STOLE_HALF_WIDTH,
    STOLE_BOTTOM - STOLE_BAND_HEIGHT,
    STOLE_HALF_WIDTH * 2,
    STOLE_BAND_HEIGHT,
  );
}

const HOOD_RX = HEAD_RX * 1.15;
const HOOD_RY = HEAD_RY * 1.2;
const HOOD_RISE = HEAD_RY * 0.5;
const HOOD_FILL_ALPHA = 0.92;
/** The patch's own square size. */
const HOOD_PATCH_SIZE = 0.05;
/** How far below the shoulder line the patch sits. */
const HOOD_PATCH_Y_DROP = 0.1;
const HOOD_PATCH_PROFILE_X = 0.05;
const HOOD_PATCH_FRONT_FRAC = 0.4;

function drawPatchedHood(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  ctx.fillStyle = rgba(spec.color, HOOD_FILL_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - HOOD_RISE, HOOD_RX, HOOD_RY, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // One visible patch, always on the shoulder — cheap and reads at any view.
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  const patchX = view === 'side' ? HOOD_PATCH_PROFILE_X : SHOULDER_HALF * HOOD_PATCH_FRONT_FRAC;
  ctx.fillRect(patchX, SHOULDER_Y + HOOD_PATCH_Y_DROP, HOOD_PATCH_SIZE, HOOD_PATCH_SIZE);
}

// ── Named-resident accessories ──────────────────────────────────────────────
//
// One-off cues for individual residents (`residentLooks.ts`), never worn by
// the random street crowd. Each pairs with a base garment the resident's own
// look picks, the same way an apron or tabard layers over one above.

const LEDGER_WIDTH = 0.06;
const LEDGER_HEIGHT = 0.08;
/** How far below the hip the ledger's own centre sits. */
const LEDGER_Y_DROP = 0.05;
const LEDGER_PROFILE_X = 0.03;
const LEDGER_FRONT_X_FRAC = 0.55;
const LEDGER_PENCIL_WIDTH = 0.01;
/** The pencil crosses the cover diagonally, corner to corner, scaled in from the true corners. */
const LEDGER_PENCIL_START_FRAC = 0.4;
const LEDGER_PENCIL_END_X_FRAC = 0.5;
const LEDGER_PENCIL_END_Y_FRAC = 0.35;

/** Wick's ledger and pencil, held at the hip. */
function drawLedgerPencil(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  if (view === 'back') return;
  const x = view === 'side' ? LEDGER_PROFILE_X : SHOULDER_HALF * LEDGER_FRONT_X_FRAC;
  const y = HIP_Y + LEDGER_Y_DROP;
  ctx.fillStyle = spec.color;
  ctx.fillRect(x - LEDGER_WIDTH / 2, y - LEDGER_HEIGHT / 2, LEDGER_WIDTH, LEDGER_HEIGHT);
  ctx.strokeStyle = spec.accentColor ?? shaded(spec.color);
  ctx.lineWidth = FINE_OUTLINE_WIDTH;
  ctx.strokeRect(x - LEDGER_WIDTH / 2, y - LEDGER_HEIGHT / 2, LEDGER_WIDTH, LEDGER_HEIGHT);
  ctx.strokeStyle = PENCIL_COLOR;
  ctx.lineWidth = LEDGER_PENCIL_WIDTH;
  ctx.beginPath();
  ctx.moveTo(
    x - LEDGER_WIDTH * LEDGER_PENCIL_START_FRAC,
    y - LEDGER_HEIGHT * LEDGER_PENCIL_START_FRAC,
  );
  ctx.lineTo(
    x + LEDGER_WIDTH * LEDGER_PENCIL_END_X_FRAC,
    y + LEDGER_HEIGHT * LEDGER_PENCIL_END_Y_FRAC,
  );
  ctx.stroke();
}

const SHAWL_TOP = SHOULDER_Y - 0.02;
const SHAWL_BOTTOM = HIP_Y + 0.05;
const SHAWL_PROFILE_HALF_WIDTH = 0.08;
/** Front-on the shawl reaches past the shoulders themselves, draping over them. */
const SHAWL_FRONT_WIDTH_SCALE = 1.15;
/** The hem gathers in from the shoulder line's own width. */
const SHAWL_HEM_TAPER = 0.7;
const SHAWL_CHARM_RADIUS = 0.014;
/** How far below the hem a charm hangs. */
const SHAWL_CHARM_DROP = 0.03;
const SHAWL_CHARM_PROFILE_X = 0.02;
const SHAWL_CHARM_FRONT_FRAC = 0.4;

/** Old Hilda's shawl, draped over both shoulders, with two hanging charm trinkets. */
function drawShawlCharms(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  const half = view === 'side' ? SHAWL_PROFILE_HALF_WIDTH : SHOULDER_HALF * SHAWL_FRONT_WIDTH_SCALE;
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  ctx.moveTo(-half, SHAWL_TOP);
  ctx.lineTo(half, SHAWL_TOP);
  ctx.lineTo(half * SHAWL_HEM_TAPER, SHAWL_BOTTOM);
  ctx.lineTo(-half * SHAWL_HEM_TAPER, SHAWL_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shaded(spec.color);
  ctx.lineWidth = PROP_STROKE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  const charmXs =
    view === 'side'
      ? [SHAWL_CHARM_PROFILE_X]
      : [-half * SHAWL_CHARM_FRONT_FRAC, half * SHAWL_CHARM_FRONT_FRAC];
  for (const cx of charmXs) {
    ctx.beginPath();
    ctx.arc(cx, SHAWL_BOTTOM + SHAWL_CHARM_DROP, SHAWL_CHARM_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

const FLOUR_FLECK_COLOR = 'rgba(255,255,255,0.55)';
const FLOUR_FLECK_RADIUS = 0.008;
/** Three fleck positions, each a fraction of the apron's own half-width/vertical span. */
const FLOUR_FLECKS: ReadonlyArray<readonly [xFrac: number, yOffset: number]> = [
  [-0.4, 0.06],
  [0.3, 0.14],
  [-0.15, -0.08],
];

/** Marta's apron, dusted white with flour flecks. */
function drawFlourApron(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  drawApron(ctx, view, spec);
  if (view === 'back') return;
  const half = view === 'side' ? APRON_PROFILE_HALF_WIDTH : APRON_HALF_WIDTH;
  ctx.fillStyle = FLOUR_FLECK_COLOR;
  for (const [xFrac, yOffset] of FLOUR_FLECKS) {
    const fy = yOffset >= 0 ? APRON_TOP + yOffset : APRON_BOTTOM + yOffset;
    ctx.beginPath();
    ctx.arc(half * xFrac, fy, FLOUR_FLECK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Two stoppered vials, side by side, riding just above the satchel's own pouch. */
const VIAL_SPACING_X = 0.02;
const VIAL_WIDTH = 0.012;
const VIAL_HEIGHT = 0.03;
/** How far above the pouch's own centre the vials sit. */
const VIAL_RISE_ABOVE_POUCH = 0.03;

/** Fen's satchel, with a rack of stoppered vials showing over the lip. */
function drawVialCase(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  drawSatchel(ctx, view, spec);
  if (view === 'side') return;
  const hipX = SHOULDER_HALF * SATCHEL_FRONT_HIP_FRAC;
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  for (const dx of [-VIAL_SPACING_X, VIAL_SPACING_X]) {
    ctx.fillRect(
      hipX + dx - VIAL_WIDTH / 2,
      SATCHEL_POUCH_Y - VIAL_RISE_ABOVE_POUCH,
      VIAL_WIDTH,
      VIAL_HEIGHT,
    );
  }
}

/** How far below the hip the rule's own top end sits. */
const RULE_TOP_DROP = 0.02;
const RULE_ZIGZAG_WIDTH = 0.03;
/** The rule's three folding segments, each this tall. */
const RULE_SEGMENT_HEIGHT = 0.05;
const RULE_LINE_WIDTH = 0.014;
const RULE_FRONT_X_FRAC = 0.6;
const RULE_PROFILE_X = 0.04;
/** The pencil tucked at the collar reads best set in from the rule's own x position. */
const PENCIL_X_FRAC = 0.3;
const PENCIL_START_Y_DROP = 0.08;
const PENCIL_END_Y_DROP = 0.2;
const PENCIL_START_X_FRAC = 0.1;

/** Wendell's folding rule at the belt — a builder's tool, not a farmer's. */
function drawBuilderRule(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  const x = view === 'side' ? RULE_PROFILE_X : SHOULDER_HALF * RULE_FRONT_X_FRAC;
  const topY = HIP_Y - RULE_TOP_DROP;
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = RULE_LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - RULE_ZIGZAG_WIDTH, topY);
  ctx.lineTo(x, topY + RULE_SEGMENT_HEIGHT);
  ctx.lineTo(x - RULE_ZIGZAG_WIDTH, topY + RULE_SEGMENT_HEIGHT * 2);
  ctx.lineTo(x, topY + RULE_SEGMENT_HEIGHT * 3);
  ctx.stroke();
  // A carpenter's pencil, tucked at the collar in place of a head slot.
  ctx.strokeStyle = spec.accentColor ?? PENCIL_COLOR;
  ctx.lineWidth = PROP_STROKE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-x * PENCIL_X_FRAC, SHOULDER_Y + PENCIL_START_Y_DROP);
  ctx.lineTo(-x * PENCIL_START_X_FRAC, SHOULDER_Y + PENCIL_END_Y_DROP);
  ctx.stroke();
}

type WornAccessoryKind = Exclude<AccessoryKind, 'none'>;

const ACCESSORY_PAINTERS: Readonly<
  Record<WornAccessoryKind, (ctx: Ctx, view: CarlView, spec: AccessorySpec) => void>
> = {
  apron: drawApron,
  satchel: drawSatchel,
  tabard: drawTabard,
  brimmedHat: drawBrimmedHat,
  stole: drawStole,
  patchedHood: drawPatchedHood,
  ledgerPencil: drawLedgerPencil,
  shawlCharms: drawShawlCharms,
  flourApron: drawFlourApron,
  vialCase: drawVialCase,
  builderRule: drawBuilderRule,
};

/** Paints `spec`'s accessory, in figure-unit space, over an already-drawn body. */
export function drawAccessory(ctx: Ctx, view: CarlView, spec: AccessorySpec): void {
  if (spec.kind === 'none') return;
  ACCESSORY_PAINTERS[spec.kind](ctx, view, spec);
}

// ── Hair style overlays ──────────────────────────────────────────────────────
//
// Carl's own hair is one fixed short-tufted style. Colour now varies with
// `setCarlSkinHairRamp`; style is layered on top as an overlay rather than
// by touching his own hair painter — cheap, and it cannot desync from his
// own hair geometry the way patching his painter's internals could.

export type HairStyleKind = 'short' | 'bald' | 'long' | 'curly' | 'headscarf';

const BALD_PATCH_RX = HEAD_RX * 0.92;
const BALD_PATCH_RY = HEAD_RY * 0.98;
const BALD_PATCH_RISE = HEAD_RY * 0.55;
const BALD_PATCH_OUTLINE_WIDTH = 0.01;

/** A skin-toned patch over the crown, painted after Carl's own hair — the cheapest way to erase it without touching his painter. */
function drawBaldPatch(ctx: Ctx, skin: Ramp): void {
  ctx.fillStyle = skin.base;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - BALD_PATCH_RISE, BALD_PATCH_RX, BALD_PATCH_RY, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = skin.light;
  ctx.lineWidth = BALD_PATCH_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - BALD_PATCH_RISE, BALD_PATCH_RX, BALD_PATCH_RY, 0, Math.PI, 0);
  ctx.stroke();
}

/**
 * `destination-over` compositing (the previous approach here) only paints
 * into canvas that is still transparent when it runs. By the time a hair
 * style overlay runs, Carl's own body and head painter has already left no
 * transparent pixels anywhere near the head, down the neck or across the
 * shoulders — so a mass meant to hang past his own hair silhouette had
 * nowhere left to paint into and was, in practice, entirely invisible.
 *
 * The fix draws normally (`source-over`, on top of the finished body) but
 * clipped to exclude an ellipse a little bigger than the skull, using the
 * `evenodd` fill rule across a bounding rect and the ellipse together: a
 * point inside the rect only is covered an odd number of times (painted), a
 * point inside both the rect and the ellipse is covered an even number of
 * times (excluded). That protects the already-finished face and head
 * outline while still letting hair paint over the shoulders and torso below
 * it, which is where it actually needs to show.
 */
const HEAD_EXCLUDE_SCALE = 1.1;
const HEAD_EXCLUDE_BOUNDS = 3;

function withHeadExcluded(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    -HEAD_EXCLUDE_BOUNDS,
    -HEAD_EXCLUDE_BOUNDS,
    HEAD_EXCLUDE_BOUNDS * 2,
    HEAD_EXCLUDE_BOUNDS * 2,
  );
  ctx.ellipse(
    0,
    HEAD_CENTRE_Y,
    HEAD_RX * HEAD_EXCLUDE_SCALE,
    HEAD_RY * HEAD_EXCLUDE_SCALE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.clip('evenodd');
  draw();
  ctx.restore();
}

const LONG_HAIR_TOP_RISE = HEAD_RY * 0.4;
const LONG_HAIR_DROP = HEAD_RY * 2.4;
const LONG_HAIR_HALF_WIDTH = HEAD_RX * 0.85;
const LONG_HAIR_OUTLINE_WIDTH = 0.012;
/** The mass's own curve control points bow slightly wider than its start/end width. */
const LONG_HAIR_BOW_SCALE = 1.1;
/** The curve's control point sits partway down the drop, not at its midpoint. */
const LONG_HAIR_BOW_DROP_FRAC = 0.6;
/**
 * How close to the centreline a lobe's own inner edge and bottom point come
 * — never all the way to 0. Head-on, long hair must frame the face rather
 * than cross it: the first cut traced one continuous mass from the head's
 * left edge to its right edge, which read fine behind the skull but, once
 * `withHeadExcluded`'s clip let hair paint past the chin and down the neck
 * (below the protected head ellipse, where there is no face to guard), it
 * closed back up across the centreline there and painted a beard. Each side
 * is now its own lobe, confined to one sign of x throughout, so nothing ever
 * crosses the front of the face or the chin.
 */
const LONG_HAIR_INNER_WIDTH = HEAD_RX * 0.22;
const LONG_HAIR_BOTTOM_INSET = HEAD_RX * 0.4;

/** One side's hanging lobe, head-on or from behind — `side` is −1 (left) or 1 (right), and every x term carries its sign, so the lobe never reaches the centreline. */
function traceLongHairLobe(ctx: Ctx, side: number): void {
  const outer = side * LONG_HAIR_HALF_WIDTH;
  const inner = side * LONG_HAIR_INNER_WIDTH;
  const bottom = side * LONG_HAIR_BOTTOM_INSET;
  ctx.beginPath();
  ctx.moveTo(outer, HEAD_CENTRE_Y - LONG_HAIR_TOP_RISE);
  ctx.quadraticCurveTo(
    outer * LONG_HAIR_BOW_SCALE,
    HEAD_CENTRE_Y + LONG_HAIR_DROP * LONG_HAIR_BOW_DROP_FRAC,
    bottom,
    HEAD_CENTRE_Y + LONG_HAIR_DROP,
  );
  ctx.quadraticCurveTo(
    inner,
    HEAD_CENTRE_Y + LONG_HAIR_DROP * LONG_HAIR_BOW_DROP_FRAC * LONG_HAIR_INNER_RETURN_FRAC,
    inner,
    HEAD_CENTRE_Y - LONG_HAIR_TOP_RISE * LONG_HAIR_INNER_TOP_FRAC,
  );
  ctx.closePath();
}
const LONG_HAIR_INNER_RETURN_FRAC = 0.6;
const LONG_HAIR_INNER_TOP_FRAC = 0.3;

/** Edge-on there is no left/right to frame — the whole mass hangs behind the head, on the side away from the face (`PROFILE_EAR_X` is negative for the same reason). */
const PROFILE_LONG_HAIR_BACK = -1;

function drawLongHairLobes(ctx: Ctx, hair: Ramp): void {
  for (const side of [-1, 1]) {
    ctx.fillStyle = hair.mid;
    traceLongHairLobe(ctx, side);
    ctx.fill();
    ctx.strokeStyle = hair.shadow;
    ctx.lineWidth = LONG_HAIR_OUTLINE_WIDTH;
    traceLongHairLobe(ctx, side);
    ctx.stroke();
  }
}

/** A hanging mass behind the head and down the back, reaching the shoulder blades — tied back or loose, read the same at 32px, and never crossing the face. */
function drawLongHairMass(ctx: Ctx, hair: Ramp, view: CarlView): void {
  withHeadExcluded(ctx, () => {
    if (view === 'side') {
      traceLongHairLobe(ctx, PROFILE_LONG_HAIR_BACK);
      ctx.fillStyle = hair.mid;
      ctx.fill();
      ctx.strokeStyle = hair.shadow;
      ctx.lineWidth = LONG_HAIR_OUTLINE_WIDTH;
      traceLongHairLobe(ctx, PROFILE_LONG_HAIR_BACK);
      ctx.stroke();
      return;
    }
    drawLongHairLobes(ctx, hair);
  });
}

const CURLY_BUMP_COUNT = 6;
const CURLY_BUMP_RADIUS = HEAD_RX * 0.32;
const CURLY_RING_RISE = HEAD_RY * 1.05;
const CURLY_RING_RX = HEAD_RX * 0.95;
/** The ring flattens vertically to half its own horizontal radius. */
const CURLY_RING_VERTICAL_FRAC = 0.5;
const CURLY_BUMP_OUTLINE_WIDTH = 0.008;

/** A ring of round bumps over the crown, reading as volume/curl without a per-strand painter — see {@link withHeadExcluded} for why this can't use `destination-over`. */
function drawCurlyMass(ctx: Ctx, hair: Ramp): void {
  withHeadExcluded(ctx, () => {
    ctx.fillStyle = hair.mid;
    for (let i = 0; i < CURLY_BUMP_COUNT; i++) {
      const t = i / (CURLY_BUMP_COUNT - 1);
      const angle = Math.PI + t * Math.PI;
      const x = Math.cos(angle) * CURLY_RING_RX;
      const y =
        HEAD_CENTRE_Y -
        CURLY_RING_RISE +
        Math.sin(angle) * CURLY_RING_RX * CURLY_RING_VERTICAL_FRAC;
      ctx.beginPath();
      ctx.arc(x, y, CURLY_BUMP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hair.shadow;
    ctx.lineWidth = CURLY_BUMP_OUTLINE_WIDTH;
    for (let i = 0; i < CURLY_BUMP_COUNT; i++) {
      const t = i / (CURLY_BUMP_COUNT - 1);
      const angle = Math.PI + t * Math.PI;
      const x = Math.cos(angle) * CURLY_RING_RX;
      const y =
        HEAD_CENTRE_Y -
        CURLY_RING_RISE +
        Math.sin(angle) * CURLY_RING_RX * CURLY_RING_VERTICAL_FRAC;
      ctx.beginPath();
      ctx.arc(x, y, CURLY_BUMP_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/**
 * A kerchief tied over the crown, covering the hair rather than extending
 * it — painted as an ordinary opaque shape (no head-exclusion clip needed,
 * since covering the head, not draping past it, is the whole point) with a
 * small knot at the back.
 */
/**
 * Noticeably bigger than the head, not merely a hair-tinted cap — a
 * headscarf has to extend past Carl's own hair silhouette on every side to
 * read as a separate draped item rather than a recolour of his hair.
 */
const SCARF_RX = HEAD_RX * 1.35;
const SCARF_RY = HEAD_RY * 1.15;
const SCARF_RISE = HEAD_RY * 0.25;
const SCARF_OUTLINE_WIDTH = 0.012;
/**
 * No knot mark: a first cut placed one at `HEAD_CENTRE_Y + HEAD_RY * 0.55`,
 * meaning to suggest a tie at the back of the head, but every view draws the
 * same geometry and `MOUTH_Y` (`HEAD_RY * 0.62`) sits almost exactly there —
 * head-on it painted a dark filled circle on top of the mouth, reading as an
 * open "o" regardless of the pose's own (correctly closed) mouth. A real
 * back-of-head knot needs the view split `drawHairStyleOverlay` doesn't wire
 * up today; cut rather than risk the same collision again.
 */
function drawHeadscarf(ctx: Ctx, cloth: Ramp): void {
  ctx.fillStyle = cloth.mid;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - SCARF_RISE, SCARF_RX, SCARF_RY, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = cloth.shadow;
  ctx.lineWidth = SCARF_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - SCARF_RISE, SCARF_RX, SCARF_RY, 0, Math.PI, 0);
  ctx.stroke();
}

/**
 * Paints a hair-style overlay for `style`; `'short'` is Carl's own native
 * tufted style and paints nothing extra. `clothRamp` is the look's own
 * garment ramp — the headscarf's material, chosen to contrast in value with
 * the hair rather than read as a same-toned cap.
 */
export function drawHairStyleOverlay(
  ctx: Ctx,
  view: CarlView,
  style: HairStyleKind,
  hairRamp: Ramp,
  skinRamp: Ramp,
  clothRamp: Ramp,
): void {
  if (style === 'short') return;
  if (style === 'bald') {
    drawBaldPatch(ctx, skinRamp);
    return;
  }
  if (style === 'long') {
    drawLongHairMass(ctx, hairRamp, view);
    return;
  }
  if (style === 'headscarf') {
    drawHeadscarf(ctx, clothRamp);
    return;
  }
  drawCurlyMass(ctx, hairRamp);
}
