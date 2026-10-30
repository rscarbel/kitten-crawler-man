/**
 * The moment a prize becomes the party's: a gold card bursts onto the upper
 * part of the screen with the prize and its name, holds, then the prize flies
 * off the card to the HUD readout that keeps showing it is held.
 *
 * It floats over live play and takes no input, so a guard rounding the corner
 * during the celebration is still dealt with by walking, never by a dismiss.
 */

import type { ItemId } from '../../core/items/defs/ItemDefs';
import { centerIn, inset, type Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import { rewardIconPainter } from '../questReward/rewardLines';
import { skinsFor } from '../theme/skins';
import { drawGlass, strokeRounded } from '../widgets/paint';
import { lineHeightOf, text } from '../widgets/text';
import { WORLD_TICKS_PER_SECOND } from '../../core/constants';

/** How long the prize takes to rise from the world onto the card. */
const RISE_FRAMES = 24;
/** How long the card takes to burst in. */
const POP_FRAMES = 16;
/** When the prize leaves the card for the HUD. */
const DEPART_FRAME = 2 * WORLD_TICKS_PER_SECOND;
const FLIGHT_FRAMES = 36;
/** The card fades out over the prize's flight. */
export const PRIZE_CELEBRATION_FRAMES = DEPART_FRAME + FLIGHT_FRAMES;

/** How small the card starts before it bursts to full size. */
const POP_SCALE_FROM = 0.6;
/** easeOutBack's overshoot, so the card swells past its size and settles. */
const POP_OVERSHOOT = 1.70158;
/** The card's top edge, as a fraction of the viewport height down from its top. */
const CARD_TOP_FRACTION = 0.2;
/** How far the prize arcs above the straight line on each flight, in UI units. */
const FLIGHT_ARC = 48;
/** How large the prize is while it lifts off the world, relative to its size on the card. */
const WORLD_ICON_SCALE = 0.5;
const RAY_COUNT = 12;
/** One full turn of the rays behind the prize, in frames. */
const RAY_TURN_SECONDS = 6;
const RAY_TURN_FRAMES = RAY_TURN_SECONDS * WORLD_TICKS_PER_SECOND;
/** How far the rays reach past the prize's icon, as a multiple of its size. */
const RAY_REACH = 1.1;
/** Each ray's angular width, as a fraction of the gap between rays. */
const RAY_WIDTH_FRACTION = 0.45;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const CUBIC = 3;

/** A prize being celebrated this frame. */
export interface PrizeCelebration {
  readonly item: ItemId;
  readonly overline: string;
  readonly title: string;
  readonly subtitle: string;
  /** Frames since the prize was taken; the celebration ends at {@link PRIZE_CELEBRATION_FRAMES}. */
  readonly ageFrames: number;
  /** Where the prize was in the world when it was taken, in canvas CSS pixels. */
  readonly fromCss: { readonly x: number; readonly y: number };
  /**
   * Where the prize settles on the HUD, in UI units, drawn this frame; null
   * when the HUD has no room for it, and the prize fades on the card instead.
   */
  landing(now: number): Rect | null;
}

export interface PrizeCelebrationModel {
  prizeCelebration(): PrizeCelebration | null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** CUBIC;
}

function easeInOutSine(t: number): number {
  return (1 - Math.cos(Math.PI * t)) * HALF;
}

function easeOutBack(t: number): number {
  const lift = POP_OVERSHOOT + 1;
  return 1 + lift * (t - 1) ** CUBIC + POP_OVERSHOOT * (t - 1) ** 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function rectCentre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w * HALF, y: rect.y + rect.h * HALF };
}

/** A point along a raised arc between two points, `t` from 0 to 1. */
function arcPoint(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  t: number,
): { x: number; y: number } {
  const lift = Math.sin(t * Math.PI) * FLIGHT_ARC;
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - lift };
}

interface CardLayout {
  readonly card: Rect;
  readonly icon: Rect;
  readonly overline: Rect;
  readonly title: Rect;
  readonly subtitle: Rect;
}

function layoutCard(ui: Ui): CardLayout {
  const skin = skinsFor(ui.theme).prizeBanner;
  const { space } = ui.theme;
  const compact = ui.size === 'compact';
  const titleSkin = compact ? skin.titleCompact : skin.title;
  const iconSize = compact ? skin.iconSize * HALF + space.lg : skin.iconSize;
  const width = Math.min(ui.viewport.w - space.lg * 2, ui.theme.panelWidth.md);
  const pad = skin.panel.padding;
  const overlineH = lineHeightOf(ui, 'overline');
  const titleH = titleSkin.style.lineHeight;
  const subtitleH = skin.subtitle.style.lineHeight;
  const wordsH = overlineH + space.xs + titleH + space.xs + subtitleH;
  const height = Math.max(iconSize, wordsH) + pad * 2;
  const card: Rect = {
    x: ui.viewport.x + (ui.viewport.w - width) * HALF,
    y: ui.viewport.y + ui.viewport.h * CARD_TOP_FRACTION,
    w: width,
    h: height,
  };
  const body = inset(card, pad);
  const icon = centerIn({ ...body, w: iconSize }, iconSize, iconSize);
  const words = inset(body, { l: iconSize + space.lg });
  const top = words.y + (words.h - wordsH) * HALF;
  return {
    card,
    icon,
    overline: { ...words, y: top, h: overlineH },
    title: { ...words, y: top + overlineH + space.xs, h: titleH },
    subtitle: { ...words, y: top + overlineH + space.xs + titleH + space.xs, h: subtitleH },
  };
}

function drawRays(ui: Ui, centre: { x: number; y: number }, iconSize: number, age: number): void {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).prizeBanner;
  const reach = iconSize * RAY_REACH;
  const spin = (age / RAY_TURN_FRAMES) * FULL_TURN;
  const step = FULL_TURN / RAY_COUNT;
  const halfWidth = step * RAY_WIDTH_FRACTION * HALF;
  ctx.save();
  ctx.fillStyle = skin.rays;
  for (let ray = 0; ray < RAY_COUNT; ray++) {
    const angle = spin + ray * step;
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y);
    ctx.arc(centre.x, centre.y, reach, angle - halfWidth, angle + halfWidth);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderCelebration(ui: Ui, prize: PrizeCelebration): void {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).prizeBanner;
  const layout = layoutCard(ui);
  const age = prize.ageFrames;
  const popT = clamp01(age / POP_FRAMES);
  const departT = clamp01((age - DEPART_FRAME) / FLIGHT_FRAMES);
  const cardAlpha = clamp01(popT * (1 - departT));
  const scale = lerp(POP_SCALE_FROM, 1, easeOutBack(popT));
  const cardCentre = rectCentre(layout.card);

  if (cardAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= cardAlpha;
    ctx.translate(cardCentre.x, cardCentre.y);
    ctx.scale(scale, scale);
    ctx.translate(-cardCentre.x, -cardCentre.y);
    ctx.save();
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = skin.glowBlur;
    strokeRounded(ctx, layout.card, skin.panel.radius, skin.glow, skin.panel.borderWidth);
    ctx.restore();
    drawGlass(ui, layout.card, skin.panel);
    drawRays(ui, rectCentre(layout.icon), layout.icon.w, age);
    const compact = ui.size === 'compact';
    const titleSkin = compact ? skin.titleCompact : skin.title;
    text(ui, layout.overline, {
      text: prize.overline,
      style: skin.overline.style,
      color: skin.overline.color,
    });
    text(ui, layout.title, { text: prize.title, style: titleSkin.style, color: titleSkin.color });
    text(ui, layout.subtitle, {
      text: prize.subtitle,
      style: skin.subtitle.style,
      color: skin.subtitle.color,
    });
    ctx.restore();
  }

  renderFlyingPrize(ui, prize, layout, scale);
}

/** The prize itself: up from the world onto the card, then off the card to the HUD. */
function renderFlyingPrize(
  ui: Ui,
  prize: PrizeCelebration,
  layout: CardLayout,
  scale: number,
): void {
  const age = prize.ageFrames;
  const onCard = rectCentre(layout.icon);
  const cardSize = layout.icon.w * scale;
  const fromWorld = { x: prize.fromCss.x / ui.uiScale, y: prize.fromCss.y / ui.uiScale };
  const landing = prize.landing(ui.now);
  let centre: { x: number; y: number };
  let size: number;
  let alpha = 1;
  if (age < RISE_FRAMES) {
    const t = easeOutCubic(age / RISE_FRAMES);
    centre = arcPoint(fromWorld, onCard, t);
    size = lerp(cardSize * WORLD_ICON_SCALE, cardSize, t);
  } else if (age < DEPART_FRAME) {
    centre = onCard;
    size = cardSize;
  } else {
    const t = easeInOutSine(clamp01((age - DEPART_FRAME) / FLIGHT_FRAMES));
    if (landing === null) {
      centre = onCard;
      size = cardSize;
      alpha = 1 - t;
    } else {
      centre = arcPoint(onCard, rectCentre(landing), t);
      size = lerp(cardSize, Math.min(landing.w, landing.h), t);
    }
  }
  if (alpha <= 0 || size <= 0) return;
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= alpha;
  rewardIconPainter(prize.item)(
    ctx,
    centerIn({ x: centre.x, y: centre.y, w: 0, h: 0 }, size, size),
  );
  ctx.restore();
}

/** The celebration as a floating surface over live play. Mount once. */
export function prizeCelebrationSurface(id: string, model: PrizeCelebrationModel): Surface {
  return {
    id,
    band: 'toast',
    haltsWorld: false,
    isOpen: () => model.prizeCelebration() !== null,
    render: (ui) => {
      const prize = model.prizeCelebration();
      if (prize !== null) renderCelebration(ui, prize);
    },
  };
}
