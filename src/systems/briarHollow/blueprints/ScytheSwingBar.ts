/**
 * The scythe swing's timing bar: a screen-wide strip in the HUD pass, with
 * the good and perfect bands marked on it, a needle crossing it over the
 * swing, and a verdict the moment the one timed press is judged — a flash,
 * a burst and "PERFECT!" / "Clean cut!" on a hit; a red flash, a shake and
 * "Miss!" on a miss, or when the swing ran out with no press at all.
 *
 * Pure drawing and layout: `GrainHarvest` owns the swing and hands this a
 * {@link ScytheSwingBarView} each frame. The bar lies across the screen
 * below the crawler, who stands at its centre, and gives way sideways or
 * upward to whatever HUD pieces and phone buttons it would cover.
 */

import type { Rect } from '../../DungeonUIRenderer';
import { drawBox } from '../../../ui/Box';
import { drawText } from '../../../ui/TextBox';
import type { ScytheGrade } from './GrainHarvest';

/** A band of the swing, as shares of it. */
export interface ScytheWindow {
  readonly start: number;
  readonly end: number;
}

/** Everything the bar shows for one frame. */
export interface ScytheSwingBarView {
  /** Where the needle stands, 0–1 of the swing. */
  readonly progress: number;
  /** Where the one graded press landed, 0–1, or null before it (and for a swing that ran out). */
  readonly pressShare: number | null;
  /** The swing's verdict, or null while it is still waiting for its press. */
  readonly verdict: ScytheGrade | null;
  /** Seconds since the verdict was reached; drives the flash, burst, shake and pop. */
  readonly verdictAgeSeconds: number;
  /** The grain the verdict is worth, shown beside it. */
  readonly verdictGrain: number;
  readonly goodWindow: ScytheWindow;
  readonly perfectWindow: ScytheWindow;
  /** What makes the timed press on this device, for the instruction: "Space", "Tap". */
  readonly pressLabel: string;
}

// ── Layout ─────────────────────────────────────────────────────────────────

/** Clear space between the bar and each screen edge. */
const SIDE_MARGIN_PX = 16;
/** Clear space kept between the bar and any HUD piece it gives way to. */
const KEEPOUT_GAP_PX = 8;
/**
 * How far below the screen's centre, where the crawler stands, the bar's top
 * sits by preference: enough to clear Carl's feet and his scythe's sweep.
 */
const BELOW_CRAWLER_PX = 44;
/** The same clearance when the bar has to go over the crawler: head, name and prompt. */
const ABOVE_CRAWLER_PX = 72;
/** Candidate positions are tried this many pixels apart. */
const PLACEMENT_STEP_PX = 6;
/**
 * A spot this wide a share of the full span counts as full width, and wins
 * over a wider one further from the preferred spot.
 */
const FULL_WIDTH_SHARE = 0.8;

/** The sizes one screen's bar is drawn at. */
interface ScytheSwingBarMetrics {
  /** The instruction / verdict line above the track. */
  readonly headerHeight: number;
  readonly trackHeight: number;
  readonly instructionSize: number;
  readonly verdictSize: number;
  /** The "+N grain" beside the verdict. */
  readonly detailSize: number;
}

const ROOMY_METRICS: ScytheSwingBarMetrics = {
  headerHeight: 28,
  trackHeight: 30,
  instructionSize: 15,
  verdictSize: 22,
  detailSize: 14,
};
/** A phone held landscape has little height between the crawler and the hotbar. */
const COMPACT_METRICS: ScytheSwingBarMetrics = {
  headerHeight: 20,
  trackHeight: 20,
  instructionSize: 13,
  verdictSize: 17,
  detailSize: 12,
};
/** Screens shorter than this get {@link COMPACT_METRICS}. */
const COMPACT_BELOW_VIEWPORT_H = 520;

const PANEL_PADDING_PX = 8;
const PANEL_RADIUS_PX = 8;
const NEEDLE_OVERHANG_PX = 4;
const NEEDLE_HEAD_PX = 5;
/** How far the needle stands proud of the track, head included, above and below. */
const NEEDLE_REACH_PX = NEEDLE_OVERHANG_PX + NEEDLE_HEAD_PX;
/** Clear air between the needle's head and the panel's bottom edge. */
const NEEDLE_CLEARANCE_PX = 2;
const HEADER_TO_TRACK_GAP_PX = NEEDLE_REACH_PX;
const TRACK_TO_PANEL_BOTTOM_PX = NEEDLE_REACH_PX + NEEDLE_CLEARANCE_PX;

/** Where the bar's panel goes, the track inside it, and the sizes it is drawn at. */
export interface ScytheSwingBarLayout {
  readonly panel: Rect;
  readonly track: Rect;
  readonly metrics: ScytheSwingBarMetrics;
}

function panelHeightFor(metrics: ScytheSwingBarMetrics): number {
  return (
    PANEL_PADDING_PX +
    metrics.headerHeight +
    HEADER_TO_TRACK_GAP_PX +
    metrics.trackHeight +
    TRACK_TO_PANEL_BOTTOM_PX
  );
}

/**
 * The clear horizontal run at `top`..`top + height` once every keepout that
 * reaches into that band has pushed its side of the bar inward: a piece left
 * of centre moves the left edge, one right of it the right edge.
 */
function clearRunAt(
  top: number,
  height: number,
  viewportW: number,
  keepouts: readonly Rect[],
): { left: number; right: number } {
  let left = SIDE_MARGIN_PX;
  let right = viewportW - SIDE_MARGIN_PX;
  const centreX = viewportW / 2;
  for (const keepout of keepouts) {
    if (keepout.w <= 0 || keepout.h <= 0) continue;
    const reachesBand =
      keepout.y < top + height + KEEPOUT_GAP_PX && keepout.y + keepout.h > top - KEEPOUT_GAP_PX;
    if (!reachesBand) continue;
    const keepoutCentreX = keepout.x + keepout.w / 2;
    if (keepoutCentreX < centreX) left = Math.max(left, keepout.x + keepout.w + KEEPOUT_GAP_PX);
    else right = Math.min(right, keepout.x - KEEPOUT_GAP_PX);
  }
  return { left, right };
}

/**
 * Where the bar goes on a `viewportW` × `viewportH` screen with `keepouts`
 * to stay off: below the crawler first, stepping down and then over the
 * crawler until a spot is found that spans {@link FULL_WIDTH_SHARE} of the
 * screen; failing that, the widest spot seen.
 */
export function scytheSwingBarLayout(
  viewportW: number,
  viewportH: number,
  keepouts: readonly Rect[],
): ScytheSwingBarLayout {
  const metrics = viewportH < COMPACT_BELOW_VIEWPORT_H ? COMPACT_METRICS : ROOMY_METRICS;
  const panelHeight = panelHeightFor(metrics);
  const fullSpan = viewportW - SIDE_MARGIN_PX * 2;
  const centreY = viewportH / 2;
  const candidateTops: number[] = [];
  const lowestTop = viewportH - SIDE_MARGIN_PX - panelHeight;
  for (let top = centreY + BELOW_CRAWLER_PX; top <= lowestTop; top += PLACEMENT_STEP_PX) {
    candidateTops.push(top);
  }
  for (
    let top = centreY - ABOVE_CRAWLER_PX - panelHeight;
    top >= SIDE_MARGIN_PX;
    top -= PLACEMENT_STEP_PX
  ) {
    candidateTops.push(top);
  }
  let best: { top: number; left: number; right: number } | null = null;
  for (const top of candidateTops) {
    const run = clearRunAt(top, panelHeight, viewportW, keepouts);
    const width = run.right - run.left;
    if (width >= fullSpan * FULL_WIDTH_SHARE) {
      best = { top, ...run };
      break;
    }
    if (best === null || width > best.right - best.left) best = { top, ...run };
  }
  const chosen = best ?? {
    top: Math.min(centreY + BELOW_CRAWLER_PX, lowestTop),
    left: SIDE_MARGIN_PX,
    right: viewportW - SIDE_MARGIN_PX,
  };
  const panel: Rect = {
    x: chosen.left,
    y: chosen.top,
    w: Math.max(0, chosen.right - chosen.left),
    h: panelHeight,
  };
  const track: Rect = {
    x: panel.x + PANEL_PADDING_PX,
    y: panel.y + PANEL_PADDING_PX + metrics.headerHeight + HEADER_TO_TRACK_GAP_PX,
    w: Math.max(0, panel.w - PANEL_PADDING_PX * 2),
    h: metrics.trackHeight,
  };
  return { panel, track, metrics };
}

// ── Look ───────────────────────────────────────────────────────────────────

const PANEL_FILL = 'rgba(8,15,30,0.9)';
const PANEL_BORDER = '#475569';
const PANEL_BORDER_WIDTH = 2;
const TRACK_FILL = '#0b1220';
const TRACK_BORDER = '#64748b';
const TRACK_RADIUS_PX = 4;
/** The part of the track the needle has already crossed. */
const ELAPSED_FILL = 'rgba(148,163,184,0.16)';
const GOOD_BAND_FILL = 'rgba(234,179,8,0.55)';
const GOOD_BAND_EDGE = '#facc15';
const PERFECT_BAND_FILL = 'rgba(34,197,94,0.9)';
const PERFECT_BAND_EDGE = '#bbf7d0';
const BAND_EDGE_WIDTH_PX = 2;
const BAND_LABEL_SIZE = 10;
const BAND_LABEL_COLOR = '#ffffff';
/** A dark rim keeps the name legible over the gold, the green and a white flash alike. */
const BAND_LABEL_OUTLINE = '#0b1220';
const BAND_LABEL_OUTLINE_WIDTH_PX = 3;
/** A band's name is only written into it where it has this much room either side. */
const BAND_LABEL_ROOM_PX = 4;
const BAND_LABEL_CHAR_WIDTH_SHARE = 0.62;

const NEEDLE_WIDTH_PX = 4;
const NEEDLE_COLOR = '#ffffff';
const NEEDLE_OUTLINE = '#0f172a';
const NEEDLE_OUTLINE_WIDTH_PX = 2;

const PRESS_MARK_WIDTH_PX = 4;
const PRESS_MARK_OVERHANG_PX = 7;
const MISS_CROSS_HALF_PX = 7;
const MISS_CROSS_WIDTH_PX = 3;

const INSTRUCTION_COLOR = '#e2e8f0';
/** Gap between the verdict word and the grain beside it. */
const VERDICT_DETAIL_GAP_PX = 12;
/**
 * A miss's consolation grain is written dimmer than a hit's, so the red
 * "Miss!" beside it still carries the line.
 */
const MISS_DETAIL_ALPHA_SHARE = 0.55;
const VERDICT_CHAR_WIDTH_SHARE = 0.62;
const VERDICT_GLOW_BLUR = 14;

/** The verdict word lands this much larger and settles to its size over {@link POP_SECONDS}. */
const POP_EXTRA_SCALE = 0.6;
const POP_SECONDS = 0.18;
/** The hit band's white flash, the track's red flash on a miss. */
const FLASH_SECONDS = 0.35;
const HIT_FLASH_PEAK_ALPHA = 0.85;
const MISS_FLASH_PEAK_ALPHA = 0.55;
const MISS_FLASH_COLOR = '#ef4444';
/** The panel's glow, in the verdict's colour, dies away over this long. */
const PANEL_GLOW_SECONDS = 0.6;
const PANEL_GLOW_BLUR_PEAK = 28;
/** A miss shakes the whole bar side to side, dying away. */
const SHAKE_SECONDS = 0.4;
const SHAKE_AMPLITUDE_PX = 9;
const SHAKE_HZ = 14;
/** A hit throws rays out of the press mark. */
const BURST_SECONDS = 0.45;
const BURST_RAYS = 12;
const PERFECT_BURST_REACH_PX = 58;
const GOOD_BURST_REACH_PX = 38;
const BURST_RAY_LENGTH_SHARE = 0.45;
const BURST_RAY_WIDTH_PX = 3;
/** The screen's edges glow in the verdict's colour for a moment. */
const EDGE_GLOW_SECONDS = 0.5;
const EDGE_GLOW_DEPTH_SHARE = 0.09;
const EDGE_GLOW_PEAK_ALPHA = 0.55;
const MISS_EDGE_GLOW_PEAK_ALPHA = 0.4;

const ALPHA_DECIMALS = 3;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

interface VerdictStyle {
  readonly word: string;
  readonly color: string;
  /** `r,g,b` of {@link color}, for the fading edge glow. */
  readonly rgb: string;
}

const VERDICT_STYLES: Record<ScytheGrade, VerdictStyle> = {
  perfect: { word: 'PERFECT!', color: '#4ade80', rgb: '74,222,128' },
  good: { word: 'Clean cut!', color: '#facc15', rgb: '250,204,21' },
  miss: { word: 'Miss!', color: '#f87171', rgb: '239,68,68' },
};

/** 1 at the verdict, falling linearly to 0 after `seconds`. */
function fadeOver(ageSeconds: number, seconds: number): number {
  return Math.max(0, 1 - ageSeconds / seconds);
}

/** The screen x of `share` of the track. */
function trackX(track: Rect, share: number): number {
  return track.x + Math.max(0, Math.min(1, share)) * track.w;
}

/** The sideways shake a miss gives the bar this frame. */
function shakeOffset(view: ScytheSwingBarView): number {
  if (view.verdict !== 'miss') return 0;
  const decay = fadeOver(view.verdictAgeSeconds, SHAKE_SECONDS);
  if (decay <= 0) return 0;
  return Math.sin(view.verdictAgeSeconds * SHAKE_HZ * FULL_TURN) * SHAKE_AMPLITUDE_PX * decay;
}

function shifted(rect: Rect, dx: number): Rect {
  return { x: rect.x + dx, y: rect.y, w: rect.w, h: rect.h };
}

/** What the bar says before the press is judged, with `pressLabel` naming the press. */
export function scytheSwingInstruction(pressLabel: string): string {
  return `Swing!  ${pressLabel} when the needle is in the green`;
}

/** Draws the bar for `view` at `layout`. */
export function drawScytheSwingBar(
  ctx: CanvasRenderingContext2D,
  layout: ScytheSwingBarLayout,
  view: ScytheSwingBarView,
): void {
  if (layout.panel.w <= 0) return;
  const dx = shakeOffset(view);
  const panel = shifted(layout.panel, dx);
  const track = shifted(layout.track, dx);
  const style = view.verdict === null ? null : VERDICT_STYLES[view.verdict];
  const glow = style === null ? 0 : fadeOver(view.verdictAgeSeconds, PANEL_GLOW_SECONDS);

  ctx.save();
  drawBox(ctx, {
    x: panel.x,
    y: panel.y,
    width: panel.w,
    height: panel.h,
    fill: PANEL_FILL,
    border: style?.color ?? PANEL_BORDER,
    borderWidth: PANEL_BORDER_WIDTH,
    radius: PANEL_RADIUS_PX,
    ...(style !== null && glow > 0
      ? { glow: style.color, glowBlur: PANEL_GLOW_BLUR_PEAK * glow }
      : {}),
  });
  drawHeader(ctx, panel, layout.metrics, view, style);
  drawTrack(ctx, track, view);
  drawPressMark(ctx, track, view);
  drawBurst(ctx, track, view);
  drawBandLabels(ctx, track, view);
  drawNeedle(ctx, track, view.progress);
  ctx.restore();
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  panel: Rect,
  metrics: ScytheSwingBarMetrics,
  view: ScytheSwingBarView,
  style: VerdictStyle | null,
): void {
  const centreX = panel.x + panel.w * HALF;
  const headerTop = panel.y + PANEL_PADDING_PX;
  if (style === null) {
    drawText(ctx, scytheSwingInstruction(view.pressLabel), {
      x: centreX,
      y: headerTop + (metrics.headerHeight - metrics.instructionSize) * HALF,
      size: metrics.instructionSize,
      bold: true,
      color: INSTRUCTION_COLOR,
      align: 'center',
      outline: true,
    });
    return;
  }
  const pop = 1 + POP_EXTRA_SCALE * fadeOver(view.verdictAgeSeconds, POP_SECONDS);
  const verdictSize = Math.round(metrics.verdictSize * pop);
  const detail = view.verdictGrain > 0 ? `+${view.verdictGrain} grain` : '';
  const detailAlpha = view.verdict === 'miss' ? MISS_DETAIL_ALPHA_SHARE : 1;
  const restingWordWidth = style.word.length * metrics.verdictSize * VERDICT_CHAR_WIDTH_SHARE;
  const detailWidth =
    detail === ''
      ? 0
      : detail.length * metrics.detailSize * VERDICT_CHAR_WIDTH_SHARE + VERDICT_DETAIL_GAP_PX;
  const lineLeft = centreX - (restingWordWidth + detailWidth) * HALF;
  // The word pops about its own centre, so the grain beside it steps aside as it grows.
  const wordCentreX = lineLeft + restingWordWidth * HALF;
  const poppedWordWidth = style.word.length * verdictSize * VERDICT_CHAR_WIDTH_SHARE;
  const headerMidY = headerTop + metrics.headerHeight * HALF;
  drawText(ctx, style.word, {
    x: wordCentreX,
    y: headerMidY - verdictSize * HALF,
    size: verdictSize,
    bold: true,
    color: style.color,
    align: 'center',
    outline: true,
    glow: style.color,
    glowBlur: VERDICT_GLOW_BLUR,
  });
  if (detail === '') return;
  drawText(ctx, detail, {
    x: wordCentreX + poppedWordWidth * HALF + VERDICT_DETAIL_GAP_PX,
    y: headerMidY - metrics.detailSize * HALF,
    size: metrics.detailSize,
    bold: true,
    color: INSTRUCTION_COLOR,
    outline: true,
    alpha: detailAlpha,
  });
}

function drawTrack(ctx: CanvasRenderingContext2D, track: Rect, view: ScytheSwingBarView): void {
  drawBox(ctx, {
    x: track.x,
    y: track.y,
    width: track.w,
    height: track.h,
    fill: TRACK_FILL,
    border: TRACK_BORDER,
    borderWidth: 1,
    radius: TRACK_RADIUS_PX,
  });
  const needleX = trackX(track, view.progress);
  if (needleX > track.x) {
    drawBox(ctx, {
      x: track.x,
      y: track.y,
      width: needleX - track.x,
      height: track.h,
      fill: ELAPSED_FILL,
      radius: TRACK_RADIUS_PX,
    });
  }
  drawBandFill(ctx, track, view.goodWindow, GOOD_BAND_FILL, GOOD_BAND_EDGE);
  drawBandFill(ctx, track, view.perfectWindow, PERFECT_BAND_FILL, PERFECT_BAND_EDGE);
  drawVerdictFlash(ctx, track, view);
}

/** The bands' names, drawn over the flash and the burst so they read in every state. */
function drawBandLabels(
  ctx: CanvasRenderingContext2D,
  track: Rect,
  view: ScytheSwingBarView,
): void {
  const earlyGoodSpan = { start: view.goodWindow.start, end: view.perfectWindow.start };
  drawBandLabel(ctx, track, earlyGoodSpan, 'GOOD');
  drawBandLabel(ctx, track, view.perfectWindow, 'PERFECT');
}

/** The white flash over a hit's band, or the red one over the whole track on a miss. */
function drawVerdictFlash(
  ctx: CanvasRenderingContext2D,
  track: Rect,
  view: ScytheSwingBarView,
): void {
  const flash = fadeOver(view.verdictAgeSeconds, FLASH_SECONDS);
  if (flash <= 0 || view.verdict === null) return;
  if (view.verdict === 'miss') {
    drawBox(ctx, {
      x: track.x,
      y: track.y,
      width: track.w,
      height: track.h,
      fill: MISS_FLASH_COLOR,
      radius: TRACK_RADIUS_PX,
      alpha: MISS_FLASH_PEAK_ALPHA * flash,
    });
    return;
  }
  const hitBand = view.verdict === 'perfect' ? view.perfectWindow : view.goodWindow;
  drawBox(ctx, {
    x: trackX(track, hitBand.start),
    y: track.y,
    width: (hitBand.end - hitBand.start) * track.w,
    height: track.h,
    fill: '#ffffff',
    alpha: HIT_FLASH_PEAK_ALPHA * flash,
    glow: VERDICT_STYLES[view.verdict].color,
    glowBlur: PANEL_GLOW_BLUR_PEAK * flash,
  });
}

function drawBandFill(
  ctx: CanvasRenderingContext2D,
  track: Rect,
  band: ScytheWindow,
  fill: string,
  edge: string,
): void {
  drawBox(ctx, {
    x: trackX(track, band.start),
    y: track.y,
    width: (band.end - band.start) * track.w,
    height: track.h,
    fill,
    border: edge,
    borderWidth: BAND_EDGE_WIDTH_PX,
  });
}

/** A band's name, centred in `span`: left out where the span is too narrow to hold it. */
function drawBandLabel(
  ctx: CanvasRenderingContext2D,
  track: Rect,
  span: ScytheWindow,
  label: string,
): void {
  const spanLeft = trackX(track, span.start);
  const spanWidth = (span.end - span.start) * track.w;
  const labelWidth = label.length * BAND_LABEL_SIZE * BAND_LABEL_CHAR_WIDTH_SHARE;
  if (labelWidth + BAND_LABEL_ROOM_PX * 2 > spanWidth) return;
  drawText(ctx, label, {
    x: spanLeft + spanWidth * HALF,
    y: track.y + (track.h - BAND_LABEL_SIZE) * HALF,
    size: BAND_LABEL_SIZE,
    bold: true,
    color: BAND_LABEL_COLOR,
    align: 'center',
    outline: BAND_LABEL_OUTLINE,
    outlineWidth: BAND_LABEL_OUTLINE_WIDTH_PX,
  });
}

/** The needle: a bright bar standing proud of the track, with a head top and bottom. */
function drawNeedle(ctx: CanvasRenderingContext2D, track: Rect, progress: number): void {
  const x = trackX(track, progress);
  const top = track.y - NEEDLE_OVERHANG_PX;
  const bottom = track.y + track.h + NEEDLE_OVERHANG_PX;
  ctx.beginPath();
  ctx.moveTo(x - NEEDLE_HEAD_PX, top - NEEDLE_HEAD_PX);
  ctx.lineTo(x + NEEDLE_HEAD_PX, top - NEEDLE_HEAD_PX);
  ctx.lineTo(x + NEEDLE_WIDTH_PX * HALF, top);
  ctx.lineTo(x + NEEDLE_WIDTH_PX * HALF, bottom);
  ctx.lineTo(x + NEEDLE_HEAD_PX, bottom + NEEDLE_HEAD_PX);
  ctx.lineTo(x - NEEDLE_HEAD_PX, bottom + NEEDLE_HEAD_PX);
  ctx.lineTo(x - NEEDLE_WIDTH_PX * HALF, bottom);
  ctx.lineTo(x - NEEDLE_WIDTH_PX * HALF, top);
  ctx.closePath();
  ctx.lineWidth = NEEDLE_OUTLINE_WIDTH_PX;
  ctx.strokeStyle = NEEDLE_OUTLINE;
  ctx.stroke();
  ctx.fillStyle = NEEDLE_COLOR;
  ctx.fill();
}

/** Where the press landed, in the verdict's colour; a cross for a miss. */
function drawPressMark(ctx: CanvasRenderingContext2D, track: Rect, view: ScytheSwingBarView): void {
  if (view.pressShare === null || view.verdict === null) return;
  const style = VERDICT_STYLES[view.verdict];
  const x = trackX(track, view.pressShare);
  drawBox(ctx, {
    x: x - PRESS_MARK_WIDTH_PX * HALF,
    y: track.y - PRESS_MARK_OVERHANG_PX,
    width: PRESS_MARK_WIDTH_PX,
    height: track.h + PRESS_MARK_OVERHANG_PX * 2,
    fill: style.color,
    border: NEEDLE_OUTLINE,
    borderWidth: 1,
  });
  if (view.verdict !== 'miss') return;
  const cy = track.y + track.h * HALF;
  ctx.beginPath();
  ctx.moveTo(x - MISS_CROSS_HALF_PX, cy - MISS_CROSS_HALF_PX);
  ctx.lineTo(x + MISS_CROSS_HALF_PX, cy + MISS_CROSS_HALF_PX);
  ctx.moveTo(x + MISS_CROSS_HALF_PX, cy - MISS_CROSS_HALF_PX);
  ctx.lineTo(x - MISS_CROSS_HALF_PX, cy + MISS_CROSS_HALF_PX);
  ctx.lineCap = 'round';
  ctx.lineWidth = MISS_CROSS_WIDTH_PX + NEEDLE_OUTLINE_WIDTH_PX;
  ctx.strokeStyle = NEEDLE_OUTLINE;
  ctx.stroke();
  ctx.lineWidth = MISS_CROSS_WIDTH_PX;
  ctx.strokeStyle = style.color;
  ctx.stroke();
}

/** Rays thrown out of a hit's press mark, reaching further and fading as they go. */
function drawBurst(ctx: CanvasRenderingContext2D, track: Rect, view: ScytheSwingBarView): void {
  if (view.pressShare === null || view.verdict === null || view.verdict === 'miss') return;
  const life = fadeOver(view.verdictAgeSeconds, BURST_SECONDS);
  if (life <= 0) return;
  const reach = view.verdict === 'perfect' ? PERFECT_BURST_REACH_PX : GOOD_BURST_REACH_PX;
  const travelled = reach * (1 - life);
  const rayLength = reach * BURST_RAY_LENGTH_SHARE * life;
  const cx = trackX(track, view.pressShare);
  const cy = track.y + track.h * HALF;
  ctx.save();
  ctx.globalAlpha *= life;
  ctx.strokeStyle = VERDICT_STYLES[view.verdict].color;
  ctx.lineWidth = BURST_RAY_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let ray = 0; ray < BURST_RAYS; ray++) {
    const angle = (ray / BURST_RAYS) * FULL_TURN;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.moveTo(cx + cos * travelled, cy + sin * travelled);
    ctx.lineTo(cx + cos * (travelled + rayLength), cy + sin * (travelled + rayLength));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The screen's four edges washed in the verdict's colour for a moment after
 * it lands, so a hit or a miss registers even with the eye on the crawler.
 */
export function drawScytheVerdictEdgeGlow(
  ctx: CanvasRenderingContext2D,
  viewportW: number,
  viewportH: number,
  view: ScytheSwingBarView,
): void {
  if (view.verdict === null) return;
  const life = fadeOver(view.verdictAgeSeconds, EDGE_GLOW_SECONDS);
  if (life <= 0) return;
  const peak = view.verdict === 'miss' ? MISS_EDGE_GLOW_PEAK_ALPHA : EDGE_GLOW_PEAK_ALPHA;
  const alpha = peak * life;
  const { rgb } = VERDICT_STYLES[view.verdict];
  // Fixed-point, because node-canvas drops an rgba() whose alpha is written with an exponent.
  const solid = `rgba(${rgb},${alpha.toFixed(ALPHA_DECIMALS)})`;
  const clear = `rgba(${rgb},0)`;
  const depth = Math.min(viewportW, viewportH) * EDGE_GLOW_DEPTH_SHARE;
  const edges: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; rect: Rect }> = [
    { x0: 0, y0: 0, x1: 0, y1: depth, rect: { x: 0, y: 0, w: viewportW, h: depth } },
    {
      x0: 0,
      y0: viewportH,
      x1: 0,
      y1: viewportH - depth,
      rect: { x: 0, y: viewportH - depth, w: viewportW, h: depth },
    },
    { x0: 0, y0: 0, x1: depth, y1: 0, rect: { x: 0, y: 0, w: depth, h: viewportH } },
    {
      x0: viewportW,
      y0: 0,
      x1: viewportW - depth,
      y1: 0,
      rect: { x: viewportW - depth, y: 0, w: depth, h: viewportH },
    },
  ];
  ctx.save();
  for (const edge of edges) {
    const gradient = ctx.createLinearGradient(edge.x0, edge.y0, edge.x1, edge.y1);
    gradient.addColorStop(0, solid);
    gradient.addColorStop(1, clear);
    ctx.fillStyle = gradient;
    ctx.fillRect(edge.rect.x, edge.rect.y, edge.rect.w, edge.rect.h);
  }
  ctx.restore();
}
