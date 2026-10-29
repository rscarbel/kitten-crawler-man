/**
 * What the Grotesque Spider paints on the floor to say where and when she hits:
 * the slam cone, the screech disk, the spit aim lane, the phase-change roar ring
 * and the glow that marks her punish window.
 *
 * The timing of every one of them is a pure function of the attack clock in
 * `grotesqueSpiderTimeline.ts`, exposed as {@link spiderTelegraphStateAt} so the
 * gates can assert the same numbers the renderer draws: the fill meets the
 * outline on the strike tick, and the outline is at full strength then.
 */

import type { GrotesqueSpider } from './GrotesqueSpider';
import { worldPalette } from '../ui/theme/worldInk';
import { withAlpha } from '../ui/theme/color';
import {
  PHASE_ROAR_BUILD_FRAMES,
  SCREECH_RADIUS_PX,
  SCREECH_RADIUS_TILES,
  SLAM_CONE_HALF_ANGLE_RAD,
  SLAM_CONE_RADIUS_PX,
  SPIDER_ATTACK_TIMELINES,
  attackStageAt,
  recoveryStartFrame,
  strikeFrame,
  type SpiderAttack,
} from './grotesqueSpiderTimeline';
import { TILE_SIZE } from '../core/constants';
import { drawDangerCircle, drawDangerCone, drawDangerLane } from '../sprites/dangerTelegraph';

/** The attacks drawn as an area on the floor. */
export type SpiderAreaAttack = Extract<SpiderAttack, 'slam' | 'screech'>;

/** The spider state the telegraphs read; a structural slice so gates can drive them with a stub. */
export type SpiderTelegraphSource = Pick<
  GrotesqueSpider,
  'currentAttack' | 'attackFrame' | 'lockedAimX' | 'lockedAimY' | 'roarFrame' | 'isExposed'
>;

/** The reach and half-width of the lane her spit will fly down, in pixels from her centre. */
export interface SpitAimLane {
  readonly lengthPx: number;
  readonly halfWidthPx: number;
}

/** How an area telegraph looks on one attack frame. */
export interface SpiderTelegraphState {
  /** 0–1 reach of the fill toward the outline; exactly 1 from the strike tick on. */
  readonly fillProgress: number;
  /** True from the first lock tick: the outline stops crawling and goes solid. */
  readonly locked: boolean;
  /** 0–1 strength of the strike flash: 1 on the strike tick, fading across the impact hold. */
  readonly strikeFlash: number;
  /** 0–1 opacity of the outline and fill; full from the end of the fade-in through the impact hold. */
  readonly outlineAlpha: number;
}

/** Frames an area telegraph takes to fade in from its first tell tick. */
const TELEGRAPH_FADE_IN_FRAMES = 12;

/**
 * The area telegraph for an attack frame, or null when nothing is drawn (the
 * recovery window). The fill grows linearly across tell and lock and meets the
 * outline on the strike tick itself, so "the red reached the line" and "the
 * damage landed" are the same frame.
 */
export function spiderTelegraphStateAt(
  attack: SpiderAreaAttack,
  attackFrame: number,
): SpiderTelegraphState | null {
  if (attackFrame < 0 || attackFrame >= recoveryStartFrame(attack)) return null;
  const { stage, stageProgress } = attackStageAt(attack, attackFrame);
  return {
    fillProgress: Math.min(1, attackFrame / strikeFrame(attack)),
    locked: stage === 'lock' || stage === 'strike',
    strikeFlash: stage === 'strike' ? 1 - stageProgress : 0,
    outlineAlpha: Math.min(1, (attackFrame + 1) / TELEGRAPH_FADE_IN_FRAMES),
  };
}

/** The drawn reach of an area attack, read from the same constants its hit test uses. */
export interface SpiderTelegraphGeometry {
  readonly radiusPx: number;
  /** Half-angle of the cone either side of her locked aim, or null for a full disk. */
  readonly halfAngleRad: number | null;
}

export function spiderTelegraphGeometry(attack: SpiderAreaAttack): SpiderTelegraphGeometry {
  if (attack === 'screech') return { radiusPx: SCREECH_RADIUS_PX, halfAngleRad: null };
  return { radiusPx: SLAM_CONE_RADIUS_PX, halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD };
}

// ── Spit aim lane ───────────────────────────────────────────────────────────

/** The lane starts clear of her body so it reads as floor paint, not a limb. */
const SPIT_AIM_START_TILES = 0.9;
/** The lane is at full strength from the first tell tick; its growing fill is the countdown. */
const SPIT_AIM_FADE = 1;

/**
 * Whether the spit aim lane shows on this frame, how far its fill has run and
 * whether it has frozen. The fill meets the end of the lane on the frame the
 * glob leaves.
 */
export function spitAimStateAt(
  attackFrame: number,
): { readonly locked: boolean; readonly fillProgress: number } | null {
  const strike = strikeFrame('spit');
  if (attackFrame < 0 || attackFrame >= strike) return null;
  return {
    locked: attackFrame >= SPIDER_ATTACK_TIMELINES.spit.tellFrames,
    fillProgress: attackFrame / strike,
  };
}

/** The red lane her spit will fly down, as wide as the glob's hit either side of its line. */
function drawSpitAimLane(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
  lane: SpitAimLane,
): void {
  const aim = spitAimStateAt(source.attackFrame);
  if (aim === null) return;
  const startPx = TILE_SIZE * SPIT_AIM_START_TILES;
  if (lane.lengthPx <= startPx) return;
  drawDangerLane(
    ctx,
    cx + source.lockedAimX * startPx,
    cy + source.lockedAimY * startPx,
    source.lockedAimX,
    source.lockedAimY,
    lane.lengthPx - startPx,
    lane.halfWidthPx,
    SPIT_AIM_FADE,
    { fillProgress: aim.fillProgress, locked: aim.locked },
  );
}

// ── Phase-change roar ───────────────────────────────────────────────────────

/**
 * The roar is harmless, so its rings must not look like any of her attacks:
 * pale violet on a dark violet under-stroke, solid, never filled. They live in
 * a band just outside her legs and just inside the screech radius, so they are
 * never hidden under her body and never reach the edge a real screech is
 * drawn at.
 */
const ROAR_RING_COLOR = worldPalette.grotesqueSpider.roarRing;
const ROAR_RING_UNDER_COLOR = worldPalette.grotesqueSpider.roarRingUnder;
const ROAR_RING_WIDTH = 3;
const ROAR_RING_UNDER_EXTRA_WIDTH = 4;
const ROAR_RING_UNDER_ALPHA_SHARE = 0.8;
/** Inner edge of the band: clear of her leg tips. */
const ROAR_BAND_INNER_TILES = 2.5;
/** How far inside the screech radius the band's outer edge stops. */
const ROAR_BAND_SCREECH_CLEARANCE_TILES = 0.1;
const ROAR_BAND_OUTER_TILES = SCREECH_RADIUS_TILES - ROAR_BAND_SCREECH_CLEARANCE_TILES;
/** Frames one gathering ring takes to close in across the band. */
const ROAR_GATHER_CYCLE_FRAMES = 32;
const ROAR_GATHER_RING_COUNT = 2;
/** Opacity of the gathering rings at the start of the build; they brighten to full by the burst. */
const ROAR_GATHER_START_ALPHA = 0.45;
/** Share of a ring's opacity it has at the band's outer edge, rising as it closes in. */
const ROAR_GATHER_RING_FLOOR = 0.4;
/** Frames the harmless burst ring takes to spread across the band and fade. */
const ROAR_BURST_FRAMES = 28;
const ROAR_BURST_START_ALPHA = 1;
const ROAR_BURST_WIDTH = 5;

function strokeRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  alpha: number,
  width: number,
): void {
  if (radiusPx <= 0 || alpha <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.globalAlpha = alpha * ROAR_RING_UNDER_ALPHA_SHARE;
  ctx.strokeStyle = ROAR_RING_UNDER_COLOR;
  ctx.lineWidth = width + ROAR_RING_UNDER_EXTRA_WIDTH;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = ROAR_RING_COLOR;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawRoarRing(
  ctx: CanvasRenderingContext2D,
  roarFrame: number,
  cx: number,
  cy: number,
): void {
  const innerPx = TILE_SIZE * ROAR_BAND_INNER_TILES;
  const outerPx = TILE_SIZE * ROAR_BAND_OUTER_TILES;
  ctx.save();
  ctx.setLineDash([]);
  if (roarFrame < PHASE_ROAR_BUILD_FRAMES) {
    const buildProgress = roarFrame / PHASE_ROAR_BUILD_FRAMES;
    const buildAlpha = ROAR_GATHER_START_ALPHA + (1 - ROAR_GATHER_START_ALPHA) * buildProgress;
    for (let ring = 0; ring < ROAR_GATHER_RING_COUNT; ring++) {
      const phaseOffset = (ring / ROAR_GATHER_RING_COUNT) * ROAR_GATHER_CYCLE_FRAMES;
      const cycle =
        ((roarFrame + phaseOffset) % ROAR_GATHER_CYCLE_FRAMES) / ROAR_GATHER_CYCLE_FRAMES;
      const radius = outerPx + (innerPx - outerPx) * cycle;
      const ringShare = ROAR_GATHER_RING_FLOOR + (1 - ROAR_GATHER_RING_FLOOR) * cycle;
      strokeRing(ctx, cx, cy, radius, buildAlpha * ringShare, ROAR_RING_WIDTH);
    }
  } else {
    const burstFrame = roarFrame - PHASE_ROAR_BUILD_FRAMES;
    if (burstFrame < ROAR_BURST_FRAMES) {
      const burstProgress = burstFrame / ROAR_BURST_FRAMES;
      const radius = innerPx + (outerPx - innerPx) * burstProgress;
      strokeRing(
        ctx,
        cx,
        cy,
        radius,
        ROAR_BURST_START_ALPHA * (1 - burstProgress),
        ROAR_BURST_WIDTH,
      );
    }
  }
  ctx.restore();
}

// ── Punish-window glow ──────────────────────────────────────────────────────

const EXPOSED_GLOW_COLOR = worldPalette.grotesqueSpider.exposedGlow;
/**
 * The glow is a pool of gold on the floor around her leg tips rather than a
 * filter on her body: a filter over a figure that falls back to live painting
 * applies per paint operation, not once over the finished sprite.
 */
const EXPOSED_GLOW_INNER_TILES = 1.2;
const EXPOSED_GLOW_PEAK_TILES = 2.3;
const EXPOSED_GLOW_OUTER_TILES = 2.9;
const EXPOSED_GLOW_MIN_ALPHA = 0.2;
const EXPOSED_GLOW_MAX_ALPHA = 0.45;
/** Seconds per glow pulse: slow enough to read as "open", not as a hit flash. */
const EXPOSED_GLOW_PULSE_SECONDS = 0.8;
const MS_PER_SECOND = 1000;

function drawExposedGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const timeSeconds = performance.now() / MS_PER_SECOND;
  const pulse = (1 + Math.sin((timeSeconds / EXPOSED_GLOW_PULSE_SECONDS) * Math.PI * 2)) / 2;
  const alpha = EXPOSED_GLOW_MIN_ALPHA + (EXPOSED_GLOW_MAX_ALPHA - EXPOSED_GLOW_MIN_ALPHA) * pulse;
  const inner = TILE_SIZE * EXPOSED_GLOW_INNER_TILES;
  const outer = TILE_SIZE * EXPOSED_GLOW_OUTER_TILES;
  const peakStop =
    (EXPOSED_GLOW_PEAK_TILES - EXPOSED_GLOW_INNER_TILES) /
    (EXPOSED_GLOW_OUTER_TILES - EXPOSED_GLOW_INNER_TILES);
  const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  gradient.addColorStop(0, withAlpha(EXPOSED_GLOW_COLOR, 0));
  gradient.addColorStop(peakStop, EXPOSED_GLOW_COLOR);
  gradient.addColorStop(1, withAlpha(EXPOSED_GLOW_COLOR, 0));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Entry points ────────────────────────────────────────────────────────────

/** Opacity of the above-entities outline, as a share of the floor telegraph's. */
const OVERLAY_OUTLINE_ALPHA_SHARE = 0.6;

/** The area telegraph for the current attack frame, drawn whole or as strokes only. */
function drawAreaTelegraph(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
  outlineOnly: boolean,
): void {
  const attack = source.currentAttack;
  if (attack !== 'slam' && attack !== 'screech') return;
  const state = spiderTelegraphStateAt(attack, source.attackFrame);
  if (state === null) return;
  const geometry = spiderTelegraphGeometry(attack);
  const fade = outlineOnly ? state.outlineAlpha * OVERLAY_OUTLINE_ALPHA_SHARE : state.outlineAlpha;
  const options = {
    fillProgress: state.fillProgress,
    locked: state.locked,
    strikeFlash: state.strikeFlash,
    outlineOnly,
  };
  if (geometry.halfAngleRad === null) {
    drawDangerCircle(ctx, cx, cy, geometry.radiusPx, fade, options);
    return;
  }
  const aimAngle = Math.atan2(source.lockedAimY, source.lockedAimX);
  drawDangerCone(ctx, cx, cy, geometry.radiusPx, aimAngle, geometry.halfAngleRad, fade, options);
}

/**
 * Draws every floor telegraph she currently owns, centred on her screen-space
 * centre (cx, cy): the fills, the strike flash, the spit aim lane, the roar
 * rings and the punish-window glow. Floor paint: call in the ground pass,
 * before any entity.
 *
 * @param spitAimLane How far from her centre the spit aim lane reaches, and how wide it is.
 */
export function drawSpiderGroundTelegraphs(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
  spitAimLane: SpitAimLane,
): void {
  if (source.isExposed) drawExposedGlow(ctx, cx, cy);
  const roarFrame = source.roarFrame;
  if (roarFrame !== null) {
    drawRoarRing(ctx, roarFrame, cx, cy);
    return;
  }
  if (source.currentAttack === 'spit') {
    drawSpitAimLane(ctx, source, cx, cy, spitAimLane);
    return;
  }
  drawAreaTelegraph(ctx, source, cx, cy, false);
}

/**
 * The area telegraph's edge again, above the entities: the outline, its locked
 * style and the front of the growing fill, at reduced opacity and with no wash
 * or flash. Her body covers most of a cone drawn on the floor, and the edge is
 * the one thing a player must be able to see to get clear of it.
 */
export function drawSpiderTelegraphOutlines(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
): void {
  if (source.roarFrame !== null) return;
  drawAreaTelegraph(ctx, source, cx, cy, true);
}
