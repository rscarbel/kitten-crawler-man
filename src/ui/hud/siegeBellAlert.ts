/**
 * The siege's alarm when the dead reach the clocktower, and the banner a lost
 * siege ends on.
 *
 * The alert stacks four signals on purpose, for this one moment only: a
 * danger card slammed across the upper screen, a red pulse round the
 * screen's edges, a badge pinned to the edge pointing back to the bell (the
 * world arrow is the fourth, drawn with the scene's other arrows). The pulse
 * and the badge show only while the bell is out of sight; walking back into
 * view of it stops both.
 *
 * Both surfaces float over live play and register no regions, so every tap
 * still reaches the world or the HUD beneath.
 */

import { TILE_SIZE } from '../../core/constants';
import { UPDATES_PER_SECOND } from '../../systems/briarHollow/structureRules';
import type {
  BellAlertView,
  SiegeOutcomeView,
} from '../../systems/briarHollow/VillageAssaultSystem';
import { centerIn, inset, overlaps, type Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { condensedType, type TypeStyle } from '../theme/tokens';
import { choiceModalSurface } from '../widgets/choiceModal';
import { meter } from '../widgets/meter';
import { drawGlass, strokeRounded } from '../widgets/paint';
import { measureText, measureTextHeight, text } from '../widgets/text';
import { fitStyleToWidth } from '../screens/dialogs/endScreenParts';
import type { HudSurface } from './HudSurface';
import { hudLayout, type HudGeometry } from './hudLayout';
import { CHEVRON_LENGTH_RATIO, paintOffscreenTargetMarker } from './offscreenPetMarker';

const MS_PER_SECOND = 1000;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const CUBIC = 3;
/** One full swell and fade of the edge pulse. */
const EDGE_PULSE_PERIOD_MS = 1200;
/** The card's middle sits this far down the screen on a roomy one. */
const CARD_CENTRE_FRACTION = 0.3;
/** How small the card starts before it slams to full size. */
const SLAM_SCALE_FROM = 0.4;
/** easeOutBack's overshoot, so the card swells past its size and settles. */
const SLAM_OVERSHOOT = 1.70158;
/** The card shakes side to side for this long after it lands. */
const BANNER_SHAKE_MS = 600;
const BANNER_SHAKE_AMPLITUDE = 6;
/** Radians of shake per millisecond: a few quick swings, not a wobble. */
const BANNER_SHAKE_RATE = 0.06;
/** The card fades out over its last this-many frames. */
const BANNER_FADE_FRAMES = 30;
/** How much the edge badge swells at the pulse's peak. */
const MARKER_PULSE_SCALE = 0.15;
const MARKER_RING_WIDTH = 2;
/** The bell glyph's share of the badge. */
const MARKER_GLYPH_SHARE = 0.55;
/** The chevron's outline round the badge, in UI units. */
const MARKER_CHEVRON_LINE_WIDTH = 1.5;
/**
 * How much nearer, in UI units round the screen's edge, a new slid spot must
 * be than the badge's last one before the badge moves to it.
 */
const SLIDE_SWITCH_MARGIN = 48;
/**
 * How far a remembered spot may sit off the current screen edge and still be
 * kept: further means the screen was resized or turned, and it is dropped.
 */
const EDGE_SNAP_EPSILON = 1;
/** The badge never comes nearer the screen's middle than this share of its shorter side. */
const POINTER_NEAREST_SHARE = 0.3;
/** Wide enough for "999 tiles" in caption type. */
const MARKER_CAPTION_WIDTH = 72;

/** The HUD as it was last drawn, which the siege's cards and badge keep clear of. */
export interface SiegeHudKeepouts {
  /** The layout the HUD drew with, its minimap expanded or not. */
  readonly geometry: HudGeometry;
  /** Every top-band entry as drawn, in UI units. */
  readonly topBand: readonly Rect[];
  /** Every dock button as drawn, in UI units. */
  readonly dock: readonly Rect[];
}

/** What the alert surface reads each frame. */
export interface SiegeBellAlertModel {
  readonly view: BellAlertView | null;
  /** The camera's top-left in world pixels, which are canvas CSS pixels. */
  readonly camera: { readonly x: number; readonly y: number };
  /**
   * The HUD's keep-outs, read only while the surface draws; null before the
   * HUD has drawn, when its layout is worked out afresh.
   */
  readonly hud: () => SiegeHudKeepouts | null;
}

/** What the ending banner reads each frame. */
export interface SiegeOutcomeModel {
  readonly outcome: SiegeOutcomeView | null;
  readonly hud: () => SiegeHudKeepouts | null;
}

/** The keep-outs of the HUD as `hud` last drew it, or null before its first frame. */
export function siegeHudKeepouts(hud: HudSurface): SiegeHudKeepouts | null {
  const frame = hud.frame;
  if (frame === null) return null;
  return { geometry: frame.geometry, topBand: hud.bandRects, dock: [...frame.dock.values()] };
}

/** The HUD's keep-outs as drawn, or as a fresh layout would place them. */
function resolveKeepouts(ui: Ui, hud: SiegeHudKeepouts | null): SiegeHudKeepouts {
  if (hud !== null) return hud;
  const geometry = hudLayout({
    viewport: ui.viewport,
    size: ui.size,
    density: ui.density,
    miniMapExpanded: false,
    build: true,
  });
  return { geometry, topBand: [], dock: [] };
}

/** Every piece of HUD chrome a card or the badge must not stand on. */
function hudObstacles(keepouts: SiegeHudKeepouts): Rect[] {
  const { geometry } = keepouts;
  return [
    geometry.framesBlock,
    geometry.miniMap,
    geometry.hotbar.strip,
    ...geometry.topBandObstacles,
    ...keepouts.topBand,
    ...keepouts.dock,
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutBack(t: number): number {
  const lift = SLAM_OVERSHOOT + 1;
  return 1 + lift * (t - 1) ** CUBIC + SLAM_OVERSHOOT * (t - 1) ** 2;
}

function framesToMs(frames: number): number {
  return (frames / UPDATES_PER_SECOND) * MS_PER_SECOND;
}

/** 0 to 1 and back over one pulse period, on the UI clock. */
function edgePulse(ui: Ui): number {
  return HALF - HALF * Math.cos((ui.now / EDGE_PULSE_PERIOD_MS) * FULL_TURN);
}

/** One alarm card: a headline, a wrapped detail line and an optional health bar. */
interface AlarmCard {
  readonly id: string;
  readonly headline: string;
  readonly detail: string;
  readonly glyph: GlyphId;
  /** The clocktower's health under the text, or null for no bar. */
  readonly meterFraction: number | null;
  readonly ageFrames: number;
  readonly framesLeft: number;
}

interface CardLayout {
  readonly card: Rect;
  readonly headline: Rect;
  readonly headlineStyle: TypeStyle;
  readonly detail: Rect;
  readonly detailStyle: TypeStyle;
  readonly meter: Rect | null;
  /** The glyphs either side of the headline; none where the headline needs their width. */
  readonly glyphs: readonly Rect[];
}

/**
 * Where a card of `width` and `height` stands clear of the HUD: at
 * `preferredTop` or the first place below it, never over the top band
 * (which carries the same news), and on a phone clear of the player's box
 * too if it can be. Null when nothing at this width is clear of the HUD.
 */
function clearPlace(
  ui: Ui,
  width: number,
  height: number,
  preferredTop: number,
  keepouts: SiegeHudKeepouts,
  step: number,
): Rect | null {
  const area = ui.viewport;
  const x = area.x + (area.w - width) * HALF;
  const firstTop = Math.max(preferredTop, topBandBottom(ui, keepouts) + step);
  const lastTop = area.y + area.h - height;
  const hud = hudObstacles(keepouts);
  const withPlayerBox = [...hud, ...keepouts.geometry.topBandKeepClear];
  for (const obstacles of [withPlayerBox, hud]) {
    for (let top = firstTop; top <= lastTop; top += step) {
      const rect: Rect = { x, y: top, w: width, h: height };
      if (!obstacles.some((obstacle) => overlaps(obstacle, rect))) return rect;
    }
  }
  return null;
}

function topBandBottom(ui: Ui, keepouts: SiegeHudKeepouts): number {
  return Math.max(ui.viewport.y, ...keepouts.topBand.map((rect) => rect.y + rect.h));
}

/**
 * The width between the HUD's left column (the unit frames) and its right
 * one (the minimap and the dock), centred on the screen, counting only the
 * chrome beside the rows from `top` down `height`.
 */
function columnGap(ui: Ui, keepouts: SiegeHudKeepouts, top: number, height: number): number {
  const area = ui.viewport;
  const middle = area.x + area.w * HALF;
  const { framesBlock, miniMap } = keepouts.geometry;
  const beside = (rect: Rect): boolean => rect.y < top + height && rect.y + rect.h > top;
  const columns = [framesBlock, miniMap, ...keepouts.dock].filter(beside);
  const leftEdge = Math.max(
    area.x,
    ...columns.filter((rect) => rect.x < middle).map((rect) => rect.x + rect.w),
  );
  const rightEdge = Math.min(
    area.x + area.w,
    ...columns.filter((rect) => rect.x >= middle).map((rect) => rect.x),
  );
  return Math.min(middle - leftEdge, rightEdge - middle) * 2;
}

/** The headline's widest word at `style`: no card is laid out narrower, so no word is ever split. */
function longestWordWidth(ui: Ui, content: string, style: TypeStyle): number {
  return Math.max(...content.split(' ').map((word) => measureText(ui, word, { style })));
}

/** A card's type and heights at one width. */
interface CardMetrics {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  readonly glyphColumn: number;
  readonly textW: number;
  readonly headlineStyle: TypeStyle;
  readonly headlineH: number;
  readonly detailStyle: TypeStyle;
  readonly detailH: number;
  readonly meterH: number;
}

function measureCard(ui: Ui, card: AlarmCard, width: number): CardMetrics {
  const skin = skinsFor(ui.theme).siegeAlert;
  const { space, type } = ui.theme;
  const compact = ui.size === 'compact';
  const pad = compact ? skin.paddingCompact : skin.panel.padding;
  const headlineBase = headlineBaseFor(ui);
  const headlineFloor = headlineFloorFor(ui);
  const bareTextW = width - pad * 2;
  const withGlyphsW = bareTextW - (skin.glyphSize + space.sm) * 2;
  // The glyphs give their width back to the headline wherever it would
  // otherwise wrap: one line of alarm reads faster than two flanked by bells.
  const fittedBesideGlyphs = fitStyleToWidth(
    ui,
    card.headline,
    headlineBase,
    headlineFloor,
    withGlyphsW,
  );
  const floorFitsBesideGlyphs =
    measureText(ui, card.headline, { style: fittedBesideGlyphs }) <= withGlyphsW;
  const showsGlyphs = !compact && floorFitsBesideGlyphs;
  const glyphColumn = showsGlyphs ? skin.glyphSize + space.sm : 0;
  const textW = showsGlyphs ? withGlyphsW : bareTextW;
  const headlineStyle = fitStyleToWidth(ui, card.headline, headlineBase, headlineFloor, textW);
  const headlineH = measureTextHeight(ui, textW, { text: card.headline, style: headlineStyle });
  const detailStyle = compact ? type[condensedType.heading] : skin.detail.style;
  const detailH = measureTextHeight(ui, textW, { text: card.detail, style: detailStyle });
  // A phone's top band already carries the clocktower's bar, left in view
  // above the card, so the card spends no height on a second one.
  const showsMeter = card.meterFraction !== null && !compact;
  const meterH = showsMeter ? skinsFor(ui.theme).meter.hp.height : 0;
  const meterBlock = showsMeter ? space.sm + meterH : 0;
  return {
    width,
    height: pad * 2 + headlineH + space.xs + detailH + meterBlock,
    pad,
    glyphColumn,
    textW,
    headlineStyle,
    headlineH,
    detailStyle,
    detailH,
    meterH,
  };
}

/**
 * A phone cannot hold the headline at the display step; a smaller one still
 * reads, and on the narrowest it wraps, since a cut one does not.
 */
function headlineFloorFor(ui: Ui): TypeStyle {
  return ui.size === 'compact' ? ui.theme.type.heading : ui.theme.type.display;
}

function headlineBaseFor(ui: Ui): TypeStyle {
  return ui.size === 'compact'
    ? { ...ui.theme.type[condensedType.alarm], upper: true }
    : skinsFor(ui.theme).siegeAlert.headline.style;
}

/**
 * The headline at its smallest, as it is drawn there: the floor's size with
 * the headline's own weight, spacing and capitals, which make it wider than
 * the plain floor step.
 */
function floorHeadlineStyle(ui: Ui, headline: string): TypeStyle {
  return fitStyleToWidth(ui, headline, headlineBaseFor(ui), headlineFloorFor(ui), 0);
}

/**
 * Lays the card out at full width where that is clear of the HUD; failing
 * that, narrowed to the gap between the HUD's side columns; failing both, at
 * full width under the top band, over whatever HUD lies there — a card over
 * the world hides less, but an alarm must show.
 */
function layoutCard(ui: Ui, card: AlarmCard, keepouts: SiegeHudKeepouts): CardLayout {
  const skin = skinsFor(ui.theme).siegeAlert;
  const { space } = ui.theme;
  const compact = ui.size === 'compact';
  const gutter = compact ? space.sm : space.lg;
  const area = ui.viewport;
  const fullWidth = compact
    ? area.w - gutter * 2
    : Math.min(area.w - gutter * 2, ui.theme.panelWidth.xl);
  const preferredTopFor = (height: number): number =>
    compact ? area.y + gutter : area.y + area.h * CARD_CENTRE_FRACTION - height * HALF;
  const full = measureCard(ui, card, fullWidth);
  let metrics = full;
  let frame = clearPlace(
    ui,
    full.width,
    full.height,
    preferredTopFor(full.height),
    keepouts,
    space.sm,
  );
  if (frame === null) {
    const searchTop = topBandBottom(ui, keepouts);
    const gapWidth = columnGap(ui, keepouts, searchTop, area.y + area.h - searchTop) - gutter * 2;
    const minWidth =
      longestWordWidth(ui, card.headline, floorHeadlineStyle(ui, card.headline)) + full.pad * 2;
    if (gapWidth >= minWidth && gapWidth < fullWidth) {
      const narrow = measureCard(ui, card, gapWidth);
      const narrowFrame = clearPlace(
        ui,
        narrow.width,
        narrow.height,
        preferredTopFor(narrow.height),
        keepouts,
        space.sm,
      );
      if (narrowFrame !== null) {
        metrics = narrow;
        frame = narrowFrame;
      }
    }
  }
  if (frame === null) {
    const lastTop = area.y + area.h - full.height;
    const fallbackTop = Math.min(
      Math.max(preferredTopFor(full.height), topBandBottom(ui, keepouts) + space.sm),
      Math.max(area.y, lastTop),
    );
    frame = {
      x: area.x + (area.w - full.width) * HALF,
      y: fallbackTop,
      w: full.width,
      h: full.height,
    };
  }
  const body = inset(frame, metrics.pad);
  const textX = body.x + metrics.glyphColumn;
  const headline: Rect = { x: textX, y: body.y, w: metrics.textW, h: metrics.headlineH };
  const detail: Rect = {
    x: textX,
    y: headline.y + headline.h + space.xs,
    w: metrics.textW,
    h: metrics.detailH,
  };
  const meterRect: Rect | null =
    metrics.meterH > 0
      ? { x: textX, y: detail.y + detail.h + space.sm, w: metrics.textW, h: metrics.meterH }
      : null;
  const glyphBand: Rect = { ...body, h: metrics.headlineStyle.lineHeight };
  const glyphSize = skin.glyphSize;
  return {
    card: frame,
    headline,
    headlineStyle: metrics.headlineStyle,
    detail,
    detailStyle: metrics.detailStyle,
    meter: meterRect,
    glyphs:
      metrics.glyphColumn === 0
        ? []
        : [
            centerIn({ ...glyphBand, w: glyphSize }, glyphSize, glyphSize),
            centerIn(
              { ...glyphBand, x: body.x + body.w - glyphSize, w: glyphSize },
              glyphSize,
              glyphSize,
            ),
          ],
  };
}

/** Draws the card and returns where it stands at rest. */
function renderAlarmCard(ui: Ui, card: AlarmCard, keepouts: SiegeHudKeepouts): Rect {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).siegeAlert;
  const layout = layoutCard(ui, card, keepouts);
  const ageMs = framesToMs(card.ageFrames);
  const slamT = clamp01(ageMs / ui.theme.motion.base);
  const scale = SLAM_SCALE_FROM + (1 - SLAM_SCALE_FROM) * easeOutBack(slamT);
  const shakeLeft = clamp01(1 - ageMs / BANNER_SHAKE_MS);
  const shake = Math.sin(ageMs * BANNER_SHAKE_RATE) * BANNER_SHAKE_AMPLITUDE * shakeLeft;
  const alpha = clamp01(card.framesLeft / BANNER_FADE_FRAMES) * clamp01(slamT * 2);
  if (alpha <= 0) return layout.card;
  const centreX = layout.card.x + layout.card.w * HALF;
  const centreY = layout.card.y + layout.card.h * HALF;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(centreX + shake, centreY);
  ctx.scale(scale, scale);
  ctx.translate(-centreX, -centreY);
  ctx.save();
  ctx.shadowColor = skin.glow;
  ctx.shadowBlur = skin.glowBlur;
  strokeRounded(ctx, layout.card, skin.panel.radius, skin.glow, skin.panel.borderWidth);
  ctx.restore();
  drawGlass(ui, layout.card, skin.panel);
  for (const rect of layout.glyphs) drawGlyph(ctx, card.glyph, rect, { color: skin.glyph });
  text(ui, layout.headline, {
    text: card.headline,
    style: layout.headlineStyle,
    color: skin.headline.color,
    align: 'center',
    wrap: true,
  });
  text(ui, layout.detail, {
    text: card.detail,
    style: layout.detailStyle,
    color: skin.detail.color,
    align: 'center',
    wrap: true,
  });
  if (layout.meter !== null && card.meterFraction !== null) {
    meter(ui, layout.meter, {
      id: `${card.id}/clocktower`,
      value: card.meterFraction,
      max: 1,
      kind: 'hp',
      ghost: false,
    });
  }
  ctx.restore();
  return layout.card;
}

/** The red vignette round all four edges, swelling and fading with the pulse. */
function renderEdgePulse(ui: Ui, pulse: number): void {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).siegeAlert;
  const { x, y, w, h } = ui.screen;
  const depth = Math.min(skin.edgePulseDepth, w * HALF, h * HALF);
  const peak = withAlpha(skin.edgePulse, skin.edgePulsePeakAlpha * pulse);
  const clear = withAlpha(skin.edgePulse, 0);
  const edges: ReadonlyArray<{ from: [number, number]; to: [number, number]; rect: Rect }> = [
    { from: [x, y], to: [x, y + depth], rect: { x, y, w, h: depth } },
    { from: [x, y + h], to: [x, y + h - depth], rect: { x, y: y + h - depth, w, h: depth } },
    { from: [x, y], to: [x + depth, y], rect: { x, y, w: depth, h } },
    { from: [x + w, y], to: [x + w - depth, y], rect: { x: x + w - depth, y, w: depth, h } },
  ];
  ctx.save();
  for (const edge of edges) {
    const gradient = ctx.createLinearGradient(edge.from[0], edge.from[1], edge.to[0], edge.to[1]);
    gradient.addColorStop(0, peak);
    gradient.addColorStop(1, clear);
    ctx.fillStyle = gradient;
    ctx.fillRect(edge.rect.x, edge.rect.y, edge.rect.w, edge.rect.h);
  }
  ctx.restore();
}

/**
 * Where the badge stands: on the ray from the screen's middle towards the
 * bell, at the edge (kept in by `edgeInset`), then drawn back along the ray
 * until it and its caption clear every rect in `obstacles` — a badge on top of
 * the unit frames or the minimap would hide both — but never nearer the
 * middle than `nearest`, where it would stand on the player. Past that it
 * slides round the screen's edge from where the ray meets it instead
 * ({@link slideAlongEdge}). Null only when no spot on the edge is clear
 * either; the world arrow still points the way.
 */
function pointerSpot(
  area: Rect,
  from: { readonly x: number; readonly y: number },
  bell: { readonly x: number; readonly y: number },
  edgeInset: number,
  footprint: number,
  step: number,
  nearest: number,
  obstacles: readonly Rect[],
  memory: PointerMemory,
): { x: number; y: number } | null {
  const dx = bell.x - from.x;
  const dy = bell.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const inner = inset(area, edgeInset);
  const reachX =
    ux > 0 ? (inner.x + inner.w - from.x) / ux : ux < 0 ? (inner.x - from.x) / ux : Infinity;
  const reachY =
    uy > 0 ? (inner.y + inner.h - from.y) / uy : uy < 0 ? (inner.y - from.y) / uy : Infinity;
  let reach = Math.min(length, reachX, reachY);
  const spotAt = (distance: number): { x: number; y: number } => ({
    x: from.x + ux * distance,
    y: from.y + uy * distance,
  });
  const half = footprint * HALF;
  const blocked = (spot: { x: number; y: number }): boolean =>
    obstacles.some((rect) =>
      overlaps(rect, { x: spot.x - half, y: spot.y - half, w: footprint, h: footprint }),
    );
  const edgeReach = reach;
  while (reach >= nearest) {
    const spot = spotAt(reach);
    if (!blocked(spot)) {
      memory.slid = null;
      return spot;
    }
    reach -= step;
  }
  const slid = slideAlongEdge(spotAt(edgeReach), inner, step, blocked, memory.slid);
  memory.slid = slid;
  return slid;
}

/** The badge's last slid spot, so it does not hop between edges frame to frame. */
interface PointerMemory {
  slid: { x: number; y: number } | null;
}

/**
 * The nearest clear spot round the screen's edge from `hit`, trying each way
 * in turn and turning the corners: where everything on the ray is covered (a
 * card across the middle of the screen), the badge still stands on the edge
 * near its bearing, and its chevron points the rest of the way.
 *
 * `previous` is kept while it is still clear and no more than
 * {@link SLIDE_SWITCH_MARGIN} further round than the nearest spot: with the
 * bell straight ahead, the two ways round are near-equal, and without that
 * slack the badge would hop from one edge to the other as the player strafes.
 */
function slideAlongEdge(
  hit: { readonly x: number; readonly y: number },
  inner: Rect,
  step: number,
  blocked: (spot: { x: number; y: number }) => boolean,
  previous: { x: number; y: number } | null,
): { x: number; y: number } | null {
  const perimeter = (inner.w + inner.h) * 2;
  if (perimeter <= 0) return null;
  const start = perimeterOffset(hit, inner);
  let nearest: { spot: { x: number; y: number }; distance: number } | null = null;
  for (let offset = step; offset <= perimeter * HALF && nearest === null; offset += step) {
    for (const direction of [-1, 1]) {
      const spot = perimeterPoint(start + direction * offset, inner);
      if (!blocked(spot)) {
        nearest = { spot, distance: offset };
        break;
      }
    }
  }
  if (nearest === null) return null;
  const snapped =
    previous === null ? null : perimeterPoint(perimeterOffset(previous, inner), inner);
  const stillOnEdge =
    previous !== null &&
    snapped !== null &&
    Math.hypot(snapped.x - previous.x, snapped.y - previous.y) <= EDGE_SNAP_EPSILON;
  if (previous !== null && stillOnEdge && !blocked(previous)) {
    const around = Math.abs(perimeterOffset(previous, inner) - start);
    const previousDistance = Math.min(around, perimeter - around);
    if (previousDistance <= nearest.distance + SLIDE_SWITCH_MARGIN) return previous;
  }
  return nearest.spot;
}

/** How far round `rect`'s edge, clockwise from its top-left corner, the edge point nearest `point` is. */
function perimeterOffset(point: { readonly x: number; readonly y: number }, rect: Rect): number {
  const x = Math.min(rect.x + rect.w, Math.max(rect.x, point.x));
  const y = Math.min(rect.y + rect.h, Math.max(rect.y, point.y));
  const toTop = y - rect.y;
  const toRight = rect.x + rect.w - x;
  const toBottom = rect.y + rect.h - y;
  const toLeft = x - rect.x;
  const nearest = Math.min(toTop, toRight, toBottom, toLeft);
  if (nearest === toTop) return x - rect.x;
  if (nearest === toRight) return rect.w + (y - rect.y);
  if (nearest === toBottom) return rect.w + rect.h + (rect.x + rect.w - x);
  return rect.w * 2 + rect.h + (rect.y + rect.h - y);
}

/** The point `offset` round `rect`'s edge, clockwise from its top-left corner. */
function perimeterPoint(offset: number, rect: Rect): { x: number; y: number } {
  const perimeter = (rect.w + rect.h) * 2;
  let along = ((offset % perimeter) + perimeter) % perimeter;
  if (along <= rect.w) return { x: rect.x + along, y: rect.y };
  along -= rect.w;
  if (along <= rect.h) return { x: rect.x + rect.w, y: rect.y + along };
  along -= rect.h;
  if (along <= rect.w) return { x: rect.x + rect.w - along, y: rect.y + rect.h };
  along -= rect.w;
  return { x: rect.x, y: rect.y + rect.h - along };
}

/** The bell badge pinned to the screen edge on the bearing to the bell, with its distance under it. */
function renderBellPointer(
  ui: Ui,
  model: SiegeBellAlertModel,
  view: BellAlertView,
  pulse: number,
  card: Rect | null,
  keepouts: SiegeHudKeepouts,
  memory: PointerMemory,
): void {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).siegeAlert;
  const { space } = ui.theme;
  const area = ui.viewport;
  // The chevron reaches past the badge, furthest at the pulse's peak; the
  // edge inset keeps its tip on screen.
  const chevronReach = skin.markerSize * (1 + MARKER_PULSE_SCALE) * CHEVRON_LENGTH_RATIO;
  const bell = {
    x: (view.bellWorld.x - model.camera.x) / ui.uiScale,
    y: (view.bellWorld.y - model.camera.y) / ui.uiScale,
  };
  const centre = { x: ui.screen.x + ui.screen.w * HALF, y: ui.screen.y + ui.screen.h * HALF };
  const distanceTiles = Math.round(
    (Math.hypot(bell.x - centre.x, bell.y - centre.y) * ui.uiScale) / TILE_SIZE,
  );
  const captionH = skin.markerCaption.style.lineHeight;
  const obstacles: Rect[] = [...hudObstacles(keepouts), ...(card === null ? [] : [card])];
  const footprint = skin.markerSize + (captionH + space.xs) * 2;
  const spot = pointerSpot(
    area,
    centre,
    bell,
    chevronReach + space.xs,
    footprint,
    space.sm,
    Math.min(area.w, area.h) * POINTER_NEAREST_SHARE,
    obstacles,
    memory,
  );
  if (spot === null) return;
  paintOffscreenTargetMarker(
    ctx,
    {
      screenX: spot.x,
      screenY: spot.y,
      screenW: ui.screen.w,
      screenH: ui.screen.h,
      bearing: Math.atan2(bell.y - spot.y, bell.x - spot.x),
      paintPortrait: (paintCtx, x, y, side) => {
        paintCtx.save();
        paintCtx.fillStyle = skin.markerFill;
        paintCtx.strokeStyle = skin.markerInk;
        paintCtx.lineWidth = MARKER_RING_WIDTH;
        paintCtx.beginPath();
        paintCtx.arc(x, y, side * HALF, 0, FULL_TURN);
        paintCtx.fill();
        paintCtx.stroke();
        paintCtx.restore();
        const glyph = side * MARKER_GLYPH_SHARE;
        drawGlyph(paintCtx, 'bell', centerIn({ x, y, w: 0, h: 0 }, glyph, glyph), {
          color: skin.markerInk,
        });
      },
    },
    {
      edgeInset: 0,
      portraitSize: skin.markerSize * (1 + MARKER_PULSE_SCALE * pulse),
      chevronFill: skin.markerInk,
      chevronOutline: skin.markerOutline,
      chevronLineWidth: MARKER_CHEVRON_LINE_WIDTH,
    },
  );
  const below = spot.y + skin.markerSize * HALF + space.xs;
  const fitsBelow = below + captionH <= area.y + area.h;
  const captionY = fitsBelow ? below : spot.y - skin.markerSize * HALF - space.xs - captionH;
  text(
    ui,
    { x: spot.x - MARKER_CAPTION_WIDTH * HALF, y: captionY, w: MARKER_CAPTION_WIDTH, h: captionH },
    {
      text: `${distanceTiles} tiles`,
      style: skin.markerCaption.style,
      color: skin.markerCaption.color,
      align: 'center',
      tabular: true,
      halo: skin.markerOutline,
    },
  );
}

function renderBellAlert(
  ui: Ui,
  model: SiegeBellAlertModel,
  view: BellAlertView,
  memory: PointerMemory,
): void {
  const pulse = edgePulse(ui);
  const pointsOffscreen = view.underAttack && !view.bellInView;
  if (pointsOffscreen) renderEdgePulse(ui, pulse);
  const keepouts = resolveKeepouts(ui, model.hud());
  const card =
    view.banner === null
      ? null
      : renderAlarmCard(
          ui,
          {
            id: 'bell-alert',
            headline: view.banner.headline,
            detail: view.banner.detail,
            glyph: 'bell',
            meterFraction: view.bellFraction,
            ageFrames: view.banner.age,
            framesLeft: view.banner.framesLeft,
          },
          keepouts,
        );
  if (pointsOffscreen) renderBellPointer(ui, model, view, pulse, card, keepouts, memory);
  else memory.slid = null;
}

function alertShows(view: BellAlertView | null): view is BellAlertView {
  return view !== null && (view.banner !== null || (view.underAttack && !view.bellInView));
}

/** The clocktower alert as a floating surface over live play. Mount once. */
export function siegeBellAlertSurface(id: string, model: () => SiegeBellAlertModel): Surface {
  const memory: PointerMemory = { slid: null };
  return {
    id,
    band: 'toast',
    haltsWorld: false,
    isOpen: () => {
      const open = alertShows(model().view);
      // A spot remembered from an earlier attack would pull the next one's
      // badge to where the bell was then.
      if (!open) memory.slid = null;
      return open;
    },
    render: (ui) => {
      const current = model();
      if (alertShows(current.view)) renderBellAlert(ui, current, current.view, memory);
    },
  };
}

/** A lost siege's banner, at the alert's scale, as a floating surface. Mount once. */
export function siegeOutcomeSurface(id: string, model: () => SiegeOutcomeModel): Surface {
  return {
    id,
    band: 'toast',
    haltsWorld: false,
    isOpen: () => model().outcome !== null,
    render: (ui) => {
      const { outcome, hud } = model();
      if (outcome === null) return;
      renderAlarmCard(
        ui,
        {
          id: 'siege-outcome',
          headline: outcome.headline,
          detail: outcome.detail,
          glyph: 'alert',
          meterFraction: null,
          ageFrames: outcome.age,
          framesLeft: outcome.framesLeft,
        },
        resolveKeepouts(ui, hud()),
      );
    },
  };
}

const LOSS_EXPLAINER_TITLE = 'Siege lost';
const LOSS_EXPLAINER_BODY =
  "When you hear the clocktower's bell being struck, the dead have reached the town square. Return and drive them off: if the clocktower is destroyed, the siege is lost. Repair it and speak with the Mayor to try again.";

/** What the loss explainer reads: whether it is up, and how the player puts it away. */
export interface SiegeLossExplainerModel {
  isOpen(): boolean;
  dismiss(): void;
}

/**
 * Why the siege was lost, once its banner has had a moment: a halting modal
 * the player reads and puts away, so the rule behind the bell is learned
 * here rather than on the next attempt.
 */
export function siegeLossExplainerSurface(id: string, model: SiegeLossExplainerModel): Surface {
  return choiceModalSurface({
    id,
    isOpen: () => model.isOpen(),
    escape: { kind: 'close', onEscape: () => model.dismiss() },
    content: () => ({
      id: 'siege-lost',
      title: LOSS_EXPLAINER_TITLE,
      icon: 'bell',
      tone: 'danger',
      body: LOSS_EXPLAINER_BODY,
      buttons: [
        { id: 'understood', label: 'Understood', variant: 'primary', onTap: () => model.dismiss() },
      ],
      defaultButton: 0,
    }),
  });
}
