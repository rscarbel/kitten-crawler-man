/**
 * What the Grotesque Spider paints on the floor to say where and when she hits:
 * the slam cone, the screech disk, the spit aim line, the phase-change roar ring
 * and the glow that marks her punish window.
 *
 * The timing of every one of them is a pure function of the attack clock in
 * `grotesqueSpiderTimeline.ts`, exposed as {@link spiderTelegraphStateAt} so the
 * gates can assert the same numbers the renderer draws: the fill meets the
 * outline on the strike tick, and the outline is at full strength then.
 */

import type { GrotesqueSpider } from './GrotesqueSpider';
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
import { drawDangerCircle, drawDangerCone } from '../sprites/dangerTelegraph';

/** The attacks drawn as an area on the floor. */
export type SpiderAreaAttack = Extract<SpiderAttack, 'slam' | 'screech'>;

/** The spider state the telegraphs read; a structural slice so gates can drive them with a stub. */
export type SpiderTelegraphSource = Pick<
  GrotesqueSpider,
  'currentAttack' | 'attackFrame' | 'lockedAimX' | 'lockedAimY' | 'roarFrame' | 'isExposed'
>;

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

// ── Spit aim line ───────────────────────────────────────────────────────────

/** The aim line starts clear of her body so it reads as floor paint, not a limb. */
const SPIT_AIM_START_TILES = 0.9;
const SPIT_AIM_DOT_PX = 3;
const SPIT_AIM_GAP_PX = 7;
/** Frames per pixel the tracking dots creep outward; they freeze once the aim locks. */
const SPIT_AIM_CRAWL_FRAMES_PER_PX = 0.5;
const SPIT_AIM_TRACKING_COLOR = '#bef264';
const SPIT_AIM_TRACKING_ALPHA = 0.9;
const SPIT_AIM_TRACKING_WIDTH = 3;
const SPIT_AIM_LOCKED_COLOR = '#f7fee7';
const SPIT_AIM_LOCKED_ALPHA = 1;
const SPIT_AIM_LOCKED_WIDTH = 4;
/**
 * A dark stroke under each dot, wider than the dot, so the line keeps its
 * contrast on the pale lab tiles as well as the dark ones.
 */
const SPIT_AIM_UNDER_COLOR = '#14200a';
const SPIT_AIM_UNDER_EXTRA_WIDTH = 3;
const SPIT_AIM_UNDER_ALPHA = 0.7;
/** Opacity left at the far end of the line, which fades out along its length. */
const SPIT_AIM_TAIL_ALPHA = 0;

/** Whether the spit aim line shows on this frame, and whether it has frozen. */
export function spitAimStateAt(attackFrame: number): { readonly locked: boolean } | null {
  if (attackFrame < 0 || attackFrame >= strikeFrame('spit')) return null;
  return { locked: attackFrame >= SPIDER_ATTACK_TIMELINES.spit.tellFrames };
}

function drawSpitAimLine(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
  lengthPx: number,
): void {
  const aim = spitAimStateAt(source.attackFrame);
  if (aim === null) return;
  const startPx = TILE_SIZE * SPIT_AIM_START_TILES;
  if (lengthPx <= startPx) return;
  const startX = cx + source.lockedAimX * startPx;
  const startY = cy + source.lockedAimY * startPx;
  const endX = cx + source.lockedAimX * lengthPx;
  const endY = cy + source.lockedAimY * lengthPx;
  const color = aim.locked ? SPIT_AIM_LOCKED_COLOR : SPIT_AIM_TRACKING_COLOR;
  const width = aim.locked ? SPIT_AIM_LOCKED_WIDTH : SPIT_AIM_TRACKING_WIDTH;
  const dashPeriod = SPIT_AIM_DOT_PX + SPIT_AIM_GAP_PX;
  const crawl = aim.locked ? 0 : (source.attackFrame / SPIT_AIM_CRAWL_FRAMES_PER_PX) % dashPeriod;
  const traceLine = (): void => {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
  };

  const fadeAlong = (stopColor: string): CanvasGradient => {
    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, stopColor);
    gradient.addColorStop(1, withAlpha(stopColor, SPIT_AIM_TAIL_ALPHA));
    return gradient;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([SPIT_AIM_DOT_PX, SPIT_AIM_GAP_PX]);
  ctx.lineDashOffset = -crawl;
  ctx.globalAlpha = SPIT_AIM_UNDER_ALPHA;
  ctx.strokeStyle = fadeAlong(SPIT_AIM_UNDER_COLOR);
  ctx.lineWidth = width + SPIT_AIM_UNDER_EXTRA_WIDTH;
  traceLine();
  ctx.stroke();
  ctx.globalAlpha = aim.locked ? SPIT_AIM_LOCKED_ALPHA : SPIT_AIM_TRACKING_ALPHA;
  ctx.strokeStyle = fadeAlong(color);
  ctx.lineWidth = width;
  traceLine();
  ctx.stroke();
  ctx.restore();
}

const HEX_RADIX = 16;
const HEX_BYTE_MAX = 255;
const HEX_BYTE_DIGITS = 2;

/** A `#rrggbb` colour with an alpha channel appended, for a gradient stop that fades out. */
function withAlpha(hexColor: string, alpha: number): string {
  const alphaByte = Math.round(Math.min(1, Math.max(0, alpha)) * HEX_BYTE_MAX);
  return `${hexColor}${alphaByte.toString(HEX_RADIX).padStart(HEX_BYTE_DIGITS, '0')}`;
}

// ── Phase-change roar ───────────────────────────────────────────────────────

/**
 * The roar is harmless, so its rings must not look like any of her attacks:
 * pale violet on a dark violet under-stroke, solid, never filled. They live in
 * a band just outside her legs and just inside the screech radius, so they are
 * never hidden under her body and never reach the edge a real screech is
 * drawn at.
 */
const ROAR_RING_COLOR = '#f3e8ff';
const ROAR_RING_UNDER_COLOR = '#581c87';
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

const EXPOSED_GLOW_COLOR = '#facc15';
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
    drawDangerCircle(ctx, cx, cy, geometry.radiusPx, fade, undefined, options);
    return;
  }
  const aimAngle = Math.atan2(source.lockedAimY, source.lockedAimX);
  drawDangerCone(
    ctx,
    cx,
    cy,
    geometry.radiusPx,
    aimAngle,
    geometry.halfAngleRad,
    fade,
    undefined,
    options,
  );
}

/**
 * Draws every floor telegraph she currently owns, centred on her screen-space
 * centre (cx, cy): the fills, the strike flash, the spit aim line, the roar
 * rings and the punish-window glow. Floor paint: call in the ground pass,
 * before any entity.
 *
 * @param spitAimLengthPx How far from her centre the spit aim line reaches.
 */
export function drawSpiderGroundTelegraphs(
  ctx: CanvasRenderingContext2D,
  source: SpiderTelegraphSource,
  cx: number,
  cy: number,
  spitAimLengthPx: number,
): void {
  if (source.isExposed) drawExposedGlow(ctx, cx, cy);
  const roarFrame = source.roarFrame;
  if (roarFrame !== null) {
    drawRoarRing(ctx, roarFrame, cx, cy);
    return;
  }
  if (source.currentAttack === 'spit') {
    drawSpitAimLine(ctx, source, cx, cy, spitAimLengthPx);
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
