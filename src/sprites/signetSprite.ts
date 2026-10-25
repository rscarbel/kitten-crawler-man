/**
 * Tsarina Signet — half-naiad, half-high-elf Summoner.
 *
 * She is painted live every frame from a pose solved as a small 3D skeleton
 * (`art/signet/skeleton.ts`) and projected into one of three views: head-on,
 * from behind, or in profile. Everything below the entry point works in figure
 * units — half a tile — with the floor under her at `FOOT_Y`; see
 * `art/signet/proportions.ts`.
 */

import { drawArm, handPoint } from './art/signet/arms';
import { drawBackCurtain, drawBackHair, drawChestLocks, drawHead } from './art/signet/head';
import {
  drawContactShadows,
  drawLegFrontBack,
  drawLegSide,
  HEAD_ON_SILHOUETTE_SHADE,
  inkLeg,
  PROFILE_SILHOUETTE_SHADE,
  type LimbPaint,
} from './art/signet/legs';
import { shadeSilhouette, traceSmooth, type FigureBox } from './art/signet/paint';
import {
  drawSignetProfileBody,
  drawSignetProfileDetails,
  drawSignetProfileHead,
  drawSignetProfileHair,
} from './art/signet/profile';
import {
  ARM_ROOT_X,
  FIGURE_SCALE,
  FIGURE_TOP_Y,
  FOREARM_LENGTH,
  FOOT_Y,
  HAND_LENGTH,
  HEAD_CENTER_Y,
  BUST_Y,
  NECK_TOP_Y,
  SHOULDER_Y,
  TILE_GROUND_Y,
  UPPER_ARM_LENGTH,
  WAIST_Y,
  tileYOf,
} from './art/signet/proportions';
import { clamp01 } from './art/bipedArt';
import { INK_GLOW_COLOR, SHIMMER_COLOR, SHIMMER_EDGE_COLOR } from './art/signet/palette';
import {
  SIDES,
  mirrorSkeleton,
  project,
  solveSignetSkeleton,
  signetStrideTiles,
  type BodySide,
  type SignetSkeleton,
  type SignetView,
} from './art/signet/skeleton';
import { figureHeightPx, resolveDetail } from './art/signet/tattoos';
import { onTorsoAt, torsoWarp, drawTorso, drawTorsoDetails } from './art/signet/torso';

export { signetStrideTiles };
export type { SignetView };

const MS_PER_SECOND = 1000;
const TILE_HALF_SPAN = 0.5;

/** Distance above the tile's *top edge* that her head reaches, in tile fractions. */
const SIGNET_HEAD_CLEARANCE = -(tileYOf(FIGURE_TOP_Y) + TILE_HALF_SPAN);

/**
 * Where her chest sits relative to the tile's top edge, so spells launch from
 * her hands rather than from the tile she happens to occupy.
 */
export const SIGNET_CHEST_Y_OFFSET = tileYOf(BUST_Y) + TILE_HALF_SPAN;

/** The claws reach past the fingertips by about this much. */
const CLAW_REACH = 0.02;
/** Half-width she reaches in her widest pose, arms flung out to summon, in tile fractions. */
export const SIGNET_HALF_WIDTH =
  (ARM_ROOT_X + UPPER_ARM_LENGTH + FOREARM_LENGTH + HAND_LENGTH + CLAW_REACH) * FIGURE_SCALE;

/* ── Elite marker ──────────────────────────────────────────────────────── */

const ELITE_MARKER_RADIUS = 0.14;
const ELITE_MARKER_CROSS_ARM = 0.08;
const ELITE_MARKER_GAP = 0.06;
const ELITE_MARKER_BOB_AMP = 0.03;
const ELITE_MARKER_Y_OFFSET = -SIGNET_HEAD_CLEARANCE - ELITE_MARKER_RADIUS - ELITE_MARKER_GAP;
const ELITE_MARKER_FILL = '#ffffff';
const ELITE_MARKER_INK = '#000000';

/**
 * How far above the tile's top edge anything else must sit to clear both her
 * head and the elite marker floating over it — health bar, aggro mark,
 * interaction prompts. Derived so callers never re-guess the marker geometry.
 */
export const SIGNET_OVERLAY_CLEARANCE =
  -ELITE_MARKER_Y_OFFSET + ELITE_MARKER_RADIUS + ELITE_MARKER_BOB_AMP;
const ELITE_MARKER_BOB_SPEED = 2.2;
const ELITE_MARKER_STROKE_FRACTION = 0.035;
const ELITE_MARKER_MIN_STROKE_PX = 1.5;

/**
 * Draw the Dungeon's elite mark — a black cross in a white circle — floating
 * above an elite NPC's head.
 */
export function drawEliteMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const timeSec = performance.now() / MS_PER_SECOND;
  const cx = sx + s / 2;
  const cy =
    sy +
    ELITE_MARKER_Y_OFFSET * s +
    Math.sin(timeSec * ELITE_MARKER_BOB_SPEED) * ELITE_MARKER_BOB_AMP * s;

  ctx.save();
  ctx.fillStyle = ELITE_MARKER_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, ELITE_MARKER_RADIUS * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ELITE_MARKER_INK;
  ctx.lineWidth = Math.max(ELITE_MARKER_MIN_STROKE_PX, s * ELITE_MARKER_STROKE_FRACTION);
  ctx.beginPath();
  ctx.moveTo(cx - ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.lineTo(cx + ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.moveTo(cx, cy - ELITE_MARKER_CROSS_ARM * s);
  ctx.lineTo(cx, cy + ELITE_MARKER_CROSS_ARM * s);
  ctx.stroke();
  ctx.restore();
}

/* ── Effects ───────────────────────────────────────────────────────────── */

/**
 * The sheen spills past her outline, and her skin is already near white: any
 * stronger and it rings her in a pale halo that blurs her silhouette into the
 * floor instead of reading as light on her.
 */
const SHIMMER_ALPHA = 0.05;
const SHIMMER_PULSE_SPEED = 1.7;
const SHIMMER_PULSE_FLOOR = 0.6;
const SHIMMER_PULSE_SWING = 0.4;
const SHIMMER_HALF_WIDTH = 0.1;
const SHIMMER_HEIGHT_FRACTION = 0.6;

const INK_DROP_COUNT = 5;
const INK_DROP_RADIUS = 0.016;
const INK_DROP_RISE = 0.28;
const SUMMON_AURA_RADIUS = 0.34;
/** Kept low for the same reason as the sheen: a bright aura washes out her edge. */
const SUMMON_AURA_ALPHA = 0.18;
const SUMMON_AURA_EDGE = 'rgba(127,230,212,0)';

function drawSummonEffects(
  ctx: CanvasRenderingContext2D,
  summonProgress: number,
  hands: ReadonlyArray<{ x: number; y: number }>,
): void {
  const auraFade = Math.sin(summonProgress * Math.PI);
  ctx.save();
  ctx.globalAlpha = auraFade * SUMMON_AURA_ALPHA;
  const aura = ctx.createRadialGradient(0, WAIST_Y, 0, 0, WAIST_Y, SUMMON_AURA_RADIUS);
  aura.addColorStop(0, INK_GLOW_COLOR);
  aura.addColorStop(1, SUMMON_AURA_EDGE);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, WAIST_Y, SUMMON_AURA_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = INK_GLOW_COLOR;
  for (const hand of hands) {
    for (let i = 0; i < INK_DROP_COUNT; i++) {
      const rise = (summonProgress + i / INK_DROP_COUNT) % 1;
      ctx.globalAlpha = (1 - rise) * auraFade;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y - rise * INK_DROP_RISE, INK_DROP_RADIUS * (1 - rise), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawShimmer(ctx: CanvasRenderingContext2D, timeSec: number): void {
  const pulse = SHIMMER_PULSE_FLOOR + SHIMMER_PULSE_SWING * Math.sin(timeSec * SHIMMER_PULSE_SPEED);
  const centerY = (HEAD_CENTER_Y + FOOT_Y) / 2;
  const radiusY = (FOOT_Y - HEAD_CENTER_Y) * SHIMMER_HEIGHT_FRACTION;
  ctx.save();
  ctx.globalAlpha = SHIMMER_ALPHA * pulse;
  // Stretched so one radial gradient covers the whole figure and still fades
  // out before the empty tile around her head and shoulders.
  ctx.translate(0, centerY);
  ctx.scale(1, radiusY / SHIMMER_HALF_WIDTH);
  const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, SHIMMER_HALF_WIDTH);
  sheen.addColorStop(0, SHIMMER_COLOR);
  sheen.addColorStop(1, SHIMMER_EDGE_COLOR);
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(0, 0, SHIMMER_HALF_WIDTH, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── Entry ─────────────────────────────────────────────────────────────── */

/** Pose and animation inputs for {@link drawSignetSprite}. */
export interface SignetPose {
  /** Gait phase in radians, advanced by ground covered. */
  walkFrame: number;
  /** 0 standing to 1 fully in stride; eased by the creature as she starts and stops. */
  locomotion: number;
  /** Her smoothed ground speed, which sets her stride and whether she walks or runs. */
  speedTilesPerSecond: number;
  /** 0–1 progress through the summoning gesture. */
  summonProgress: number;
  /** 0–1 progress through a fireball cast; drives the eye glow and throw. */
  castProgress: number;
  /** Horizontal facing; negative mirrors the figure. */
  facingX: number;
  view: SignetView;
}

/**
 * The figure-unit box her torso and legs stay inside in each view, which sizes
 * the scratch surface their silhouette is shaded on. Profile is wider: a full
 * stride reaches well ahead of and behind her.
 */
const TORSO_HALF_SPAN = 0.12;
/** Past any joint, the widest a leg's flesh or a foot reaches. */
const LIMB_REACH = 0.07;
const HEAD_ON_FOOT_DROP = 0.07;

/** The box her torso and legs stay inside this frame, for sizing the scratch surface their silhouette is shaded on. */
function bodyBox(skeleton: SignetSkeleton, view: SignetView): FigureBox {
  let left = -TORSO_HALF_SPAN;
  let right = TORSO_HALF_SPAN;
  for (const side of SIDES) {
    const leg = skeleton.legs[side];
    for (const joint of [leg.knee, leg.ankle, leg.heel, leg.toe]) {
      const x = project(view, joint).x;
      left = Math.min(left, x - LIMB_REACH);
      right = Math.max(right, x + LIMB_REACH);
    }
  }
  return { left, top: NECK_TOP_Y, right, bottom: FOOT_Y + HEAD_ON_FOOT_DROP };
}

/** The head rides the chest and turns on its own about the base of the neck. */
function withHeadFrame(ctx: CanvasRenderingContext2D, paint: () => void, roll: number): void {
  ctx.save();
  ctx.translate(0, NECK_TOP_Y);
  ctx.rotate(roll);
  ctx.translate(0, -NECK_TOP_Y);
  paint();
  ctx.restore();
}

function drawHeadOn(
  ctx: CanvasRenderingContext2D,
  solved: SignetSkeleton,
  view: 'front' | 'back',
  lp: LimbPaint,
  eyeGlow: number,
  summonProgress: number,
): void {
  const back = view === 'back';
  const skeleton = back ? solved : mirrorSkeleton(solved);
  /** Head-on the screen's sides are her opposite ones. */
  const anatomical = (screenSide: BodySide): BodySide =>
    back ? screenSide : screenSide > 0 ? -1 : 1;
  const warp = torsoWarp(skeleton);
  const onChest = (paint: () => void): void => {
    ctx.save();
    onTorsoAt(ctx, warp, SHOULDER_Y);
    paint();
    ctx.restore();
  };

  onChest(() => drawBackHair(ctx, skeleton.hairSway));

  // The leg nearer the camera is drawn last.
  const nearness = (side: BodySide): number => (back ? -1 : 1) * skeleton.legs[side].knee.z;
  const order: BodySide[] = nearness(-1) <= nearness(1) ? [-1, 1] : [1, -1];
  const legOutlines = order.map((side, i) => ({
    side,
    outline: drawLegFrontBack(lp, side, skeleton.legs[side], i === 0),
  }));
  const torsoPaint = {
    ctx,
    back,
    timeSec: lp.timeSec,
    castGlow: eyeGlow,
    glowTileSizePx: lp.glowTileSizePx,
    detail: lp.detail,
  };
  const torsoTrace = drawTorso(torsoPaint, warp);
  shadeSilhouette(
    ctx,
    bodyBox(skeleton, view),
    [
      torsoTrace,
      ...legOutlines.flatMap(({ outline }) =>
        outline.map(
          (shape) => (target: CanvasRenderingContext2D) => traceSmooth(target, shape, true),
        ),
      ),
    ],
    HEAD_ON_SILHOUETTE_SHADE,
  );
  for (const { side, outline } of legOutlines)
    inkLeg(lp, anatomical(side), skeleton.legs[side], outline);
  drawTorsoDetails(torsoPaint, warp);

  const hands: { x: number; y: number }[] = [];
  for (const side of SIDES) {
    drawArm(lp, side, skeleton.arms[side], false);
    hands.push(handPoint(lp, skeleton.arms[side]));
  }

  onChest(() => {
    if (back) {
      drawBackCurtain(ctx, skeleton.hairSway);
    } else {
      drawChestLocks(ctx, lp.timeSec, skeleton.headRoll);
    }
    withHeadFrame(ctx, () => drawHead(ctx, eyeGlow, lp.glowTileSizePx, back), skeleton.headRoll);
  });

  if (summonProgress > 0) drawSummonEffects(ctx, summonProgress, hands);
}

function drawInProfile(
  ctx: CanvasRenderingContext2D,
  skeleton: SignetSkeleton,
  lp: LimbPaint,
  eyeGlow: number,
  summonProgress: number,
): void {
  // Facing +x she shows her right side: her left limbs are the far ones.
  const far: BodySide = -1;
  const near: BodySide = 1;
  // Both legs go under the torso, so the seat overhangs the back of the near
  // thigh and the groin closes over its front, the way they do on a body.
  drawArm(lp, far, skeleton.arms[far], true);
  const farLeg = drawLegSide(lp, far, skeleton.legs[far], true);
  const nearLeg = drawLegSide(lp, near, skeleton.legs[near], false);
  const torsoTrace = drawSignetProfileBody(ctx, skeleton);
  shadeSilhouette(
    ctx,
    bodyBox(skeleton, 'side'),
    [
      torsoTrace,
      ...[farLeg, nearLeg].map(
        (outline) => (target: CanvasRenderingContext2D) => traceSmooth(target, outline, true),
      ),
    ],
    PROFILE_SILHOUETTE_SHADE,
  );
  inkLeg(lp, near, skeleton.legs[near], [nearLeg]);
  drawSignetProfileDetails(ctx, skeleton);
  drawSignetProfileHair(ctx, skeleton, lp.timeSec);
  drawArm(lp, near, skeleton.arms[near], false);
  drawSignetProfileHead(ctx, skeleton, eyeGlow, lp.glowTileSizePx);
  if (summonProgress > 0) {
    drawSummonEffects(ctx, summonProgress, [
      handPoint(lp, skeleton.arms[near]),
      handPoint(lp, skeleton.arms[far]),
    ]);
  }
}

/**
 * Draw Tsarina Signet: a tall, feminine half-naiad/half-high-elf summoner with
 * luminous pale skin, black hair cut just past the bust, long pointed ears, and heavy
 * old-school flash — a hammerhead, an octopus, dragons, a lightning eel, a
 * three-headed ogre and a small fish — that drifts beneath her skin. She wears
 * only a thong; the two chest locks of hair are load-bearing coverage and are
 * drawn over the bust in every pose.
 */
export function drawSignetSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pose: SignetPose,
): void {
  const timeSec = performance.now() / MS_PER_SECOND;
  const summonProgress = clamp01(pose.summonProgress);
  const castProgress = clamp01(pose.castProgress);
  const summonEase = summonProgress > 0 ? Math.sin(summonProgress * Math.PI) : 0;
  const castEase = castProgress > 0 ? Math.sin(castProgress * Math.PI) : 0;
  const eyeGlow = Math.max(summonEase, castEase);

  const skeleton = solveSignetSkeleton({
    walkPhase: pose.walkFrame,
    locomotion: pose.locomotion,
    speedTilesPerSecond: pose.speedTilesPerSecond,
    castProgress,
    summonProgress,
    timeSec,
    profile: pose.view === 'side',
  });

  // Glow blur is in device pixels and ignores the transform, so the figure
  // scale has to be folded in by hand or her glows shrink as she grows.
  const glowTileSizePx = s * FIGURE_SCALE;
  const detail = resolveDetail(figureHeightPx(ctx, s));

  ctx.save();
  ctx.translate(sx + s / 2, sy + s / 2);
  if (pose.facingX < 0) ctx.scale(-1, 1);
  ctx.scale(s, s);
  ctx.translate(0, TILE_GROUND_Y);
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
  ctx.translate(0, -FOOT_Y);

  drawContactShadows(ctx, pose.view, skeleton.legs);
  const lp: LimbPaint = {
    ctx,
    view: pose.view,
    timeSec,
    castGlow: eyeGlow,
    glowTileSizePx,
    detail,
  };
  if (pose.view === 'side') {
    drawInProfile(ctx, skeleton, lp, eyeGlow, summonProgress);
  } else {
    drawHeadOn(ctx, skeleton, pose.view, lp, eyeGlow, summonProgress);
  }
  drawShimmer(ctx, timeSec);
  ctx.restore();
}
