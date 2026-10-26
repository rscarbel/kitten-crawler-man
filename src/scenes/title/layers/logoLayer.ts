/**
 * The wordmark: gold letters on a deep extrusion, with a glow that breathes
 * with the music and a sheen that crosses the gold now and then. Barely lit
 * while the hall is dark; it slams in on the ignition's beat.
 *
 * Every static pass (extrusion, outline, face, glow) is baked once per layout;
 * a frame is a few blits plus the sheen.
 */

import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../../../core/rendering/canvasSurface';
import { getRenderScale } from '../../../core/rendering/Viewport';
import type { Rect } from '../../../ui/core/geom';
import { mix } from '../../../ui/theme/color';
import { skinsFor, type TextFillSkin } from '../../../ui/theme/skins';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import type { PaintTarget } from '../../../ui/widgets/paint';
import { text } from '../../../ui/widgets/text';
import type { TitleClock } from '../titleClock';
import { applyTitleCamera, type TitleCamera, type TitleLayer } from '../titleLayer';
import {
  logoFontGeneration,
  LogoSlamClock,
  titleLogoGeometry,
  type TitleLogoGeometry,
} from '../titleLogo';
import type { TitleStage } from '../titleStage';
import { LOGO_FALL_MS, type TitleCue } from '../titleTimeline';

/** Near the front: the logo hangs between the viewer and the hall. */
const LOGO_DEPTH = 0.85;

/** The extrusion is stepped one CSS pixel at a time so its sides read solid. */
const EXTRUSION_STEP_PX = 1;
/** Each extrusion step's sideways drift per pixel down: the light is above and a little left. */
const EXTRUSION_SLANT = 0.35;
/** The dark edge round the face, as a share of the title size. */
const OUTLINE_EM = 0.03;
/** The outline is stamped at this many points round the face. */
const OUTLINE_TAPS = 12;
const FULL_TURN = Math.PI * 2;
/** The bright rim along the top edges of the gold, as a share of the title size. */
const BEVEL_EM = 0.014;
/** How soft the glow is, as a share of the title size. */
const GLOW_BLUR_EM = 0.32;
/**
 * The glow's letters are drawn this far off the canvas and only their shadow
 * is thrown back on, so the bake holds the halo alone and none of the glyphs.
 */
const GLOW_THROW_PX = 10000;

/** Dormant: the gold is a ghost of itself, and only just there. */
const DORMANT_FACE_ALPHA = 0.08;
const DORMANT_EXTRUSION_ALPHA = 0.35;
/** As the torches light, before the slam, the ghost warms a little. */
const RUN_UP_FACE_ALPHA = 0.2;

/** The glow at rest, and how much more of it the music's peaks add: a breath, not a strobe. */
const GLOW_REST_ALPHA = 0.42;
const GLOW_PULSE_GAIN = 0.26;
/** The dive dims the logo slowly at first, then all at once, with the torches. */
const DIVE_EASE_EXPONENT = 2;

/** The slam: the letters fall from this scale onto the screen. */
const SLAM_FROM_SCALE = 1.9;
/** The fall is invisible at first and opaque by this share of it. */
const SLAM_OPAQUE_AT = 0.45;
/** The bounce after impact: a squash this deep, settling over this long. */
const SLAM_RECOIL_DEPTH = 0.035;
const SLAM_RECOIL_MS = 260;
/** The flash of light on impact, and how quickly it dies. */
const SLAM_FLASH_ALPHA = 0.85;
const SLAM_FLASH_DECAY_MS = 380;
/** The glow is pushed this much harder for the flash. */
const SLAM_FLASH_GLOW_GAIN = 1.4;
/** With reduced motion the letters only fade in, over this long, and the flash is gentler. */
const REDUCED_FADE_MS = 500;
const REDUCED_FLASH_SHARE = 0.4;

/** The sheen crosses once per period, the first time just after the slam. */
const SHEEN_PERIOD_MS = 5600;
const SHEEN_FIRST_DELAY_MS = 380;
const SHEEN_SWEEP_MS = 1150;
/** The band's half width, as a share of the title size. */
const SHEEN_HALF_WIDTH_EM = 0.55;
/** The band leans this far off vertical, in radians. */
const SHEEN_LEAN = 0.38;
const SHEEN_ALPHA = 0.75;

const GRADIENT_START = 0;
const GRADIENT_MIDDLE = 0.5;
const GRADIENT_END = 1;
const OPAQUE = 1;
const UNIT_SCALE = 1;

interface BakedLogo {
  readonly geometry: TitleLogoGeometry;
  readonly scale: number;
  readonly extrusion: CanvasSurface;
  readonly face: CanvasSurface;
  readonly glow: CanvasSurface;
  /** Per-frame scratch for the sheen, masked to the face. */
  readonly sheen: CanvasSurface;
}

/** How the letters stand this frame. */
interface LogoPose {
  readonly scale: number;
  /** The landed logo's opacity. */
  readonly alpha: number;
  /** The dark ghost's opacity, shown until the logo lands over it. */
  readonly ghostAlpha: number;
  /** Extra light on impact, 0 to 1. */
  readonly flash: number;
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** The flash's decay never quite reaches zero; below this it is nothing to see, so nothing is drawn. */
const SLAM_FLASH_VISIBLE_MIN = 0.004;

function flashFrom(decay: number): number {
  return decay < SLAM_FLASH_VISIBLE_MIN ? 0 : decay;
}

function ghostFaceAlpha(runUp: number): number {
  return DORMANT_FACE_ALPHA + (RUN_UP_FACE_ALPHA - DORMANT_FACE_ALPHA) * runUp;
}

/** How much of the logo's light is left, 1 until a choice is taken. */
function diveRemaining(clock: TitleClock): number {
  return 1 - Math.pow(clock.diveProgress, DIVE_EASE_EXPONENT);
}

function poseAt(clock: TitleClock, since: number | null): LogoPose {
  if (since === null) return { scale: UNIT_SCALE, alpha: 0, ghostAlpha: OPAQUE, flash: 0 };
  if (clock.reducedMotion) {
    const alpha = clamp01(since / REDUCED_FADE_MS);
    const flashT = clamp01(1 - since / REDUCED_FADE_MS);
    return {
      scale: UNIT_SCALE,
      alpha,
      ghostAlpha: 1 - alpha,
      flash: flashFrom(flashT * alpha * REDUCED_FLASH_SHARE),
    };
  }
  if (since < LOGO_FALL_MS) {
    const fall = since / LOGO_FALL_MS;
    const alpha = clamp01(fall / SLAM_OPAQUE_AT);
    return {
      scale: SLAM_FROM_SCALE + (UNIT_SCALE - SLAM_FROM_SCALE) * easeInCubic(fall),
      alpha,
      ghostAlpha: 1 - alpha,
      flash: 0,
    };
  }
  const afterImpact = since - LOGO_FALL_MS;
  const recoil =
    afterImpact < SLAM_RECOIL_MS ? Math.sin((afterImpact / SLAM_RECOIL_MS) * Math.PI) : 0;
  return {
    scale: UNIT_SCALE - SLAM_RECOIL_DEPTH * recoil,
    alpha: OPAQUE,
    ghostAlpha: 0,
    flash: flashFrom(Math.exp(-afterImpact / SLAM_FLASH_DECAY_MS)),
  };
}

/** Where the sheen's band is through its sweep, 0 to 1, or `null` between sweeps. */
function sheenProgress(clock: TitleClock, since: number | null): number | null {
  if (clock.reducedMotion) return null;
  if (since === null) return null;
  const sinceFirst = since - SHEEN_FIRST_DELAY_MS;
  if (sinceFirst < 0) return null;
  const phase = sinceFirst % SHEEN_PERIOD_MS;
  return phase < SHEEN_SWEEP_MS ? phase / SHEEN_SWEEP_MS : null;
}

interface WordmarkInk {
  readonly color?: string;
  readonly fill?: TextFillSkin;
}

/**
 * A text fill laid over the em box a rule sits in, so the rule takes the gold
 * at the same height as the letters beside it.
 */
function emBoxFill(
  ctx: CanvasRenderingContext2D,
  fill: TextFillSkin,
  emTop: number,
  emSize: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, emTop, 0, emTop + emSize);
  for (const stop of fill.stops) gradient.addColorStop(stop.at, stop.color);
  return gradient;
}

/** A rule drawn full-thickness at its inner end and tapering to a point at its outer one. */
function traceRule(ctx: CanvasRenderingContext2D, rule: Rect, pointsLeft: boolean): void {
  const middleY = rule.y + rule.h * GRADIENT_MIDDLE;
  const outerX = pointsLeft ? rule.x : rule.x + rule.w;
  const innerX = pointsLeft ? rule.x + rule.w : rule.x;
  ctx.beginPath();
  ctx.moveTo(outerX, middleY);
  ctx.lineTo(innerX, rule.y);
  ctx.lineTo(innerX, rule.y + rule.h);
  ctx.closePath();
}

/** Every piece of the wordmark in one ink, shifted by `dx`, `dy`. */
function paintWordmark(
  target: PaintTarget,
  geometry: TitleLogoGeometry,
  ink: WordmarkInk,
  dx: number,
  dy: number,
): void {
  const { ctx } = target;
  const shifted = (rect: Rect): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy });
  for (const line of [...geometry.titleLines, geometry.subtitle]) {
    text(target, shifted(line.rect), {
      text: line.text,
      style: line.style,
      color: ink.color,
      fill: ink.fill,
      align: 'center',
    });
  }
  const subtitle = geometry.subtitle;
  const emTop = subtitle.rect.y + dy + (subtitle.rect.h - subtitle.style.size) * GRADIENT_MIDDLE;
  geometry.rules.forEach((rule, index) => {
    const placed = shifted(rule);
    ctx.save();
    if (ink.fill !== undefined)
      ctx.fillStyle = emBoxFill(ctx, ink.fill, emTop, subtitle.style.size);
    else if (ink.color !== undefined) ctx.fillStyle = ink.color;
    traceRule(ctx, placed, index === 0);
    ctx.fill();
    ctx.restore();
  });
}

function bakeSurface(bounds: Rect, scale: number): CanvasSurface {
  return allocCanvas('title', Math.ceil(bounds.w * scale), Math.ceil(bounds.h * scale));
}

/** A context on `surface` that draws in stage CSS pixels. */
function stageContext(
  surface: CanvasSurface,
  bounds: Rect,
  scale: number,
): CanvasRenderingContext2D {
  const ctx = surfaceContext(surface);
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  return ctx;
}

function bakeExtrusion(geometry: TitleLogoGeometry, scale: number): CanvasSurface {
  const { bounds, depth, size, theme } = geometry;
  const surface = bakeSurface(bounds, scale);
  const target: PaintTarget = { ctx: stageContext(surface, bounds, scale), theme };
  const ink = TITLE_INK.logo;
  const steps = Math.max(1, Math.round(depth / EXTRUSION_STEP_PX));
  for (let step = steps; step >= 1; step -= 1) {
    const far = step / steps;
    const dy = step * EXTRUSION_STEP_PX;
    paintWordmark(
      target,
      geometry,
      { color: mix(ink.extrusionNear, ink.extrusionFar, far) },
      dy * EXTRUSION_SLANT,
      dy,
    );
  }
  const outline = size * OUTLINE_EM;
  for (let tap = 0; tap < OUTLINE_TAPS; tap += 1) {
    const angle = (tap / OUTLINE_TAPS) * FULL_TURN;
    paintWordmark(
      target,
      geometry,
      { color: ink.outline },
      Math.cos(angle) * outline,
      Math.sin(angle) * outline,
    );
  }
  return surface;
}

function bakeFace(geometry: TitleLogoGeometry, scale: number): CanvasSurface {
  const { bounds, theme } = geometry;
  const surface = bakeSurface(bounds, scale);
  const target: PaintTarget = { ctx: stageContext(surface, bounds, scale), theme };
  paintWordmark(target, geometry, { color: TITLE_INK.logo.bevel }, 0, -geometry.size * BEVEL_EM);
  paintWordmark(target, geometry, { fill: skinsFor(theme).titleLogo.face }, 0, 0);
  return surface;
}

function bakeGlow(geometry: TitleLogoGeometry, scale: number): CanvasSurface {
  const { bounds, size, theme } = geometry;
  const surface = bakeSurface(bounds, scale);
  const ctx = stageContext(surface, bounds, scale);
  const glow = TITLE_INK.logo.glow;
  // Shadow offsets and blur are in device pixels, untouched by the transform.
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * GLOW_BLUR_EM * scale;
  ctx.shadowOffsetX = GLOW_THROW_PX * scale;
  paintWordmark({ ctx, theme }, geometry, { color: glow }, -GLOW_THROW_PX, 0);
  return surface;
}

function release(surface: CanvasSurface): void {
  releaseSurface(surface);
}

class LogoLayer implements TitleLayer {
  readonly id = 'logo';
  readonly depth = LOGO_DEPTH;
  private baked: BakedLogo | null = null;
  private stage: TitleStage | null = null;
  private readonly slamClock = new LogoSlamClock();

  layout(stage: TitleStage): void {
    this.stage = stage;
    this.bake(stage);
  }

  render(
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
    camera: TitleCamera,
  ): void {
    const baked = this.current(stage);
    const { geometry } = baked;
    const since = this.slamClock.since(clock);
    const pose = poseAt(clock, since);
    const remaining = diveRemaining(clock);
    applyTitleCamera(ctx, camera, this.depth);

    if (pose.ghostAlpha > 0) {
      this.paintGhost(ctx, baked, this.slamClock.runUp(clock), pose.ghostAlpha * remaining);
    }
    if (pose.alpha <= 0) return;

    const { center } = geometry;
    ctx.translate(center.x, center.y);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-center.x, -center.y);

    const glowAlpha =
      (GLOW_REST_ALPHA + GLOW_PULSE_GAIN * clock.musicPulse) *
      (1 + SLAM_FLASH_GLOW_GAIN * pose.flash) *
      remaining;
    this.blit(ctx, baked, baked.glow, pose.alpha * Math.min(1, glowAlpha), 'lighter');
    this.blit(ctx, baked, baked.extrusion, pose.alpha, 'source-over');
    this.blit(ctx, baked, baked.face, pose.alpha, 'source-over');
    if (pose.flash > 0) {
      this.blit(ctx, baked, baked.face, pose.alpha * pose.flash * SLAM_FLASH_ALPHA, 'lighter');
    }
    const sheen = sheenProgress(clock, since);
    if (sheen !== null) this.paintSheen(ctx, baked, sheen, pose.alpha);
  }

  onCue(cue: TitleCue): void {
    this.slamClock.onCue(cue);
  }

  dispose(): void {
    const baked = this.baked;
    if (baked === null) return;
    release(baked.extrusion);
    release(baked.face);
    release(baked.glow);
    release(baked.sheen);
    this.baked = null;
  }

  /** The bake for this stage, redone if the face or the render scale has changed under it. */
  private current(stage: TitleStage): BakedLogo {
    const baked = this.baked;
    const stale =
      baked === null ||
      this.stage !== stage ||
      baked.scale !== getRenderScale() ||
      baked.geometry.fontGeneration !== logoFontGeneration();
    if (!stale) return baked;
    this.stage = stage;
    return this.bake(stage);
  }

  private bake(stage: TitleStage): BakedLogo {
    this.dispose();
    const geometry = titleLogoGeometry(stage);
    const scale = getRenderScale();
    const baked: BakedLogo = {
      geometry,
      scale,
      extrusion: bakeExtrusion(geometry, scale),
      face: bakeFace(geometry, scale),
      glow: bakeGlow(geometry, scale),
      sheen: bakeSurface(geometry.bounds, scale),
    };
    this.baked = baked;
    return baked;
  }

  private blit(
    ctx: CanvasRenderingContext2D,
    baked: BakedLogo,
    surface: CanvasSurface,
    alpha: number,
    mode: GlobalCompositeOperation,
  ): void {
    if (alpha <= 0) return;
    const { bounds } = baked.geometry;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode;
    ctx.drawImage(surface, bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
  }

  private paintGhost(
    ctx: CanvasRenderingContext2D,
    baked: BakedLogo,
    runUp: number,
    ghostAlpha: number,
  ): void {
    this.blit(ctx, baked, baked.extrusion, ghostAlpha * DORMANT_EXTRUSION_ALPHA, 'source-over');
    this.blit(ctx, baked, baked.face, ghostAlpha * ghostFaceAlpha(runUp), 'source-over');
  }

  /** A leaning band of light, masked to the gold, swept left to right. */
  private paintSheen(
    ctx: CanvasRenderingContext2D,
    baked: BakedLogo,
    progress: number,
    alpha: number,
  ): void {
    const { geometry, scale, sheen, face } = baked;
    const { size } = geometry;
    const scratch = surfaceContext(sheen);
    scratch.setTransform(UNIT_SCALE, 0, 0, UNIT_SCALE, 0, 0);
    scratch.globalCompositeOperation = 'source-over';
    scratch.clearRect(0, 0, sheen.width, sheen.height);
    scratch.drawImage(face, 0, 0);
    scratch.globalCompositeOperation = 'source-in';

    const halfWidth = size * SHEEN_HALF_WIDTH_EM * scale;
    const travel = sheen.width + halfWidth * 2;
    const centerX = -halfWidth + travel * progress;
    const centerY = sheen.height * GRADIENT_MIDDLE;
    const dirX = Math.cos(SHEEN_LEAN) * halfWidth;
    const dirY = -Math.sin(SHEEN_LEAN) * halfWidth;
    const band = scratch.createLinearGradient(
      centerX - dirX,
      centerY - dirY,
      centerX + dirX,
      centerY + dirY,
    );
    const ink = TITLE_INK.logo;
    band.addColorStop(GRADIENT_START, ink.sheenFade);
    band.addColorStop(GRADIENT_MIDDLE, ink.sheen);
    band.addColorStop(GRADIENT_END, ink.sheenFade);
    scratch.fillStyle = band;
    scratch.fillRect(0, 0, sheen.width, sheen.height);
    scratch.globalCompositeOperation = 'source-over';

    this.blit(ctx, baked, sheen, alpha * SHEEN_ALPHA, 'lighter');
  }
}

export function logoLayer(): TitleLayer {
  return new LogoLayer();
}
