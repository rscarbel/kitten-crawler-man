/**
 * The prize screen for rewards already handed over (a wheel prize paid the
 * moment it landed): the item itself, large, on a tier-coloured pedestal under
 * a pulsing halo and slowly turning tier rays, with sparkles drifting round
 * it, a tier ribbon, the item's name and what it does. It stays a jackpot
 * moment for as long as it is up, not only during the opening burst.
 *
 * The rays and the halo are painted once into cached bitmaps per colour and
 * size and only rotated or faded each frame. The halo's pulse is slow and
 * shallow, well clear of anything that reads as a flash.
 */

import type { BoxTier } from '../core/AchievementManager';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../core/canvasSurface';
import { onCanvasRecovery } from '../core/canvasRecovery';
import { inset, type Rect } from './core/geom';
import { ITEM_ICONS } from './icons/itemIcons';
import { lootTierColor } from './screens/dialogs/canvasChrome';
import { withAlpha } from './theme/color';
import { drawCoinRewardIcon } from './icons/rewardIcons';
import { skinsFor, type TextRole } from './theme/skins';
import { drawGlass, fillRounded, strokeRounded, type PaintTarget } from './widgets/paint';
import { lineHeightOf, measureText, measureTextHeight, text } from './widgets/text';

/** One thing the prize paid, pictured on its own pedestal. */
export interface PresentedHero {
  readonly icon: ItemId | 'coins';
  readonly label: string;
}

export interface PresentedRewardView {
  readonly tier: BoxTier;
  readonly title: string;
  readonly playerName: string;
  readonly heroes: readonly PresentedHero[];
  /** What a single item does. */
  readonly detail?: string;
  /** Frames since the screen appeared; drives the rays, the halo and the sparkles. */
  readonly ageFrames: number;
  /** 0 as the lid blows off, 1 once the item has grown to full size. */
  readonly openProgress: number;
  readonly hint: string;
  /** Narrow screens set smaller type. */
  readonly compact: boolean;
}

const PANEL_MAX_W = 560;
const PANEL_MAX_H = 640;
const PANEL_MARGIN = 16;
const PANEL_EDGE_WIDTH = 2;
const PANEL_GLOW_BLUR = 32;
const PANEL_GLOW_ALPHA = 0.6;
/** The tier's wash down from the top of the panel, behind the title. */
const PANEL_WASH_ALPHA = 0.18;
const PANEL_WASH_SHARE = 0.55;

const RIBBON_PAD_X = 14;
const RIBBON_PAD_Y = 4;

/** The single item's picture, as a share of the hero band and of the panel's width. */
const HERO_ICON_HEIGHT_SHARE = 0.68;
const HERO_ICON_WIDTH_SHARE = 0.56;
/** Several items share the band, each this share of its cell. */
const ROW_ICON_CELL_SHARE = 0.72;
const ROW_ICON_HEIGHT_SHARE = 0.72;
/** The halo and the rays reach this far past the item, as multiples of its size. */
const HALO_REACH = 1.05;
const RAYS_REACH = 1.6;
const PEDESTAL_WIDTH_SHARE = 1.15;
const PEDESTAL_HEIGHT_SHARE = 0.16;
const PEDESTAL_ALPHA = 0.55;

/** Rays: how many, how wide each shaft is, how bright, and how fast they turn. */
const RAY_COUNT = 12;
const RAY_HALF_ANGLE = 0.13;
const RAY_ALPHA = 0.42;
const RAY_TURN_PER_FRAME = 0.004;
/** Platinum's sheen turns the other way, so the two sets of shafts cross and glint. */
const SHEEN_TURN_PER_FRAME = -0.006;
const SHEEN_ALPHA_SHARE = 0.7;

/** The halo breathes slowly between these strengths: no strobing. */
const HALO_ALPHA = 0.7;
const HALO_PULSE_MIN = 0.65;
const HALO_PULSE_PERIOD_FRAMES = 150;

/** Sparkles drifting round the item, capped so a phone draws few. */
const MAX_SPARKLES = 18;
const SPARKLE_ORBIT_PER_FRAME = 0.006;
const SPARKLE_BOB_PER_FRAME = 0.03;
const SPARKLE_TWINKLE_PER_FRAME = 0.09;
const SPARKLE_SIZE_MIN = 2;
const SPARKLE_SIZE_RANGE = 3.5;
const SPARKLE_RADIUS_MIN = 0.45;
const SPARKLE_RADIUS_RANGE = 0.55;
const SPARKLE_BOB = 0.06;
const SPARKLE_WAIST = 0.28;
const GOLDEN_ANGLE = 2.399963;

/** The item grows in with a small overshoot as the screen opens. */
const OPEN_OVERSHOOT = 1.7;
/**
 * The description wraps to as many lines as it needs, but never squeezes the
 * item's band below this share of the card's free height, so a short phone on
 * its side still shows the item at a readable size.
 */
const MIN_HERO_BAND_SHARE = 0.4;
/** A description always keeps at least this many lines, however short the card. */
const DETAIL_MIN_LINES = 2;

/** Cached bitmaps are sized in steps of this many pixels, so a resize reuses them. */
const BITMAP_STEP_PX = 32;
const BITMAP_MAX_PX = 1024;
const MAX_CACHED_BITMAPS = 12;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const PRIME_A = 12.9898;
const PRIME_B = 43758.5453;

const bitmaps = new Map<string, CanvasSurface | null>();
function clearBitmaps(): void {
  for (const bitmap of bitmaps.values()) if (bitmap !== null) releaseSurface(bitmap);
  bitmaps.clear();
}
// A purged canvas would stay blank for good.
onCanvasRecovery(clearBitmaps);

function scatter(index: number): number {
  const value = Math.sin(index * PRIME_A) * PRIME_B;
  return value - Math.floor(value);
}

function bitmapSize(px: number): number {
  return Math.min(
    BITMAP_MAX_PX,
    Math.max(BITMAP_STEP_PX, Math.ceil(px / BITMAP_STEP_PX) * BITMAP_STEP_PX),
  );
}

function cachedBitmap(
  key: string,
  size: number,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void,
): CanvasSurface | null {
  const full = `${key}@${size}`;
  const cached = bitmaps.get(full);
  if (cached !== undefined) return cached;
  if (bitmaps.size >= MAX_CACHED_BITMAPS) clearBitmaps();
  let surface: CanvasSurface | null = null;
  try {
    surface = allocCanvas('ui', size, size);
    paint(surfaceContext(surface), size);
  } catch {
    if (surface !== null) releaseSurface(surface);
    surface = null;
  }
  bitmaps.set(full, surface);
  return surface;
}

function paintRays(color: string) {
  return (ctx: CanvasRenderingContext2D, size: number): void => {
    const r = size * HALF;
    ctx.translate(r, r);
    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    fade.addColorStop(0, withAlpha(color, RAY_ALPHA));
    fade.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = fade;
    for (let ray = 0; ray < RAY_COUNT; ray++) {
      const angle = (ray / RAY_COUNT) * FULL_TURN;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, angle - RAY_HALF_ANGLE, angle + RAY_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
    }
  };
}

function paintHalo(color: string) {
  return (ctx: CanvasRenderingContext2D, size: number): void => {
    const r = size * HALF;
    const glow = ctx.createRadialGradient(r, r, 0, r, r, r);
    glow.addColorStop(0, withAlpha(color, HALO_ALPHA));
    glow.addColorStop(HALF, withAlpha(color, HALO_ALPHA * HALF));
    glow.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  };
}

/** Device pixels per unit of the current transform, for sizing the cached bitmaps. */
function pixelsPerUnit(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform();
  return Math.max(1, Math.hypot(t.a, t.b));
}

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasSurface | null,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  alpha: number,
): void {
  if (bitmap === null || radius <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.drawImage(bitmap, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

function easeOutBack(t: number): number {
  const shifted = t - 1;
  return (
    1 + (OPEN_OVERSHOOT + 1) * shifted * shifted * shifted + OPEN_OVERSHOOT * shifted * shifted
  );
}

/** The rays, the halo, the pedestal and the sparkles behind one item at (cx, cy). */
function paintAura(
  target: PaintTarget,
  view: PresentedRewardView,
  cx: number,
  cy: number,
  iconSize: number,
  withRays: boolean,
  withPedestal = true,
): void {
  const { ctx, theme } = target;
  const color = lootTierColor(theme, view.tier);
  const scale = pixelsPerUnit(ctx);
  const grow = Math.min(1, view.openProgress);
  if (withRays) {
    const raysR = iconSize * RAYS_REACH * grow;
    const raysPx = bitmapSize(raysR * 2 * scale);
    drawBitmap(
      ctx,
      cachedBitmap(`rays|${color}`, raysPx, paintRays(color)),
      cx,
      cy,
      raysR,
      view.ageFrames * RAY_TURN_PER_FRAME,
      1,
    );
    if (view.tier === 'Platinum') {
      const sheen = theme.palette.tier.platinumSheen;
      drawBitmap(
        ctx,
        cachedBitmap(`rays|${sheen}`, raysPx, paintRays(sheen)),
        cx,
        cy,
        raysR,
        view.ageFrames * SHEEN_TURN_PER_FRAME,
        SHEEN_ALPHA_SHARE,
      );
    }
  }
  const haloR = iconSize * HALO_REACH;
  const breath =
    HALO_PULSE_MIN +
    (1 - HALO_PULSE_MIN) *
      (Math.sin((view.ageFrames / HALO_PULSE_PERIOD_FRAMES) * FULL_TURN) + 1) *
      HALF;
  drawBitmap(
    ctx,
    cachedBitmap(`halo|${color}`, bitmapSize(haloR * 2 * scale), paintHalo(color)),
    cx,
    cy,
    haloR,
    0,
    breath * grow,
  );
  if (!withPedestal) return;
  const pedestalW = iconSize * PEDESTAL_WIDTH_SHARE;
  const pedestalH = iconSize * PEDESTAL_HEIGHT_SHARE;
  const pedestalY = cy + iconSize * HALF;
  ctx.save();
  const plinth = ctx.createRadialGradient(cx, pedestalY, 0, cx, pedestalY, pedestalW * HALF);
  plinth.addColorStop(0, withAlpha(color, PEDESTAL_ALPHA));
  plinth.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = plinth;
  ctx.beginPath();
  ctx.ellipse(cx, pedestalY, pedestalW * HALF, pedestalH * HALF, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

function paintSparkles(
  target: PaintTarget,
  view: PresentedRewardView,
  cx: number,
  cy: number,
  reach: number,
): void {
  const { ctx, theme } = target;
  const tierColor = lootTierColor(theme, view.tier);
  ctx.save();
  for (let index = 0; index < MAX_SPARKLES; index++) {
    const angle =
      index * GOLDEN_ANGLE + view.ageFrames * SPARKLE_ORBIT_PER_FRAME * (1 + scatter(index));
    const radius =
      reach * (SPARKLE_RADIUS_MIN + SPARKLE_RADIUS_RANGE * scatter(index + MAX_SPARKLES));
    const bob = Math.sin(view.ageFrames * SPARKLE_BOB_PER_FRAME + index) * reach * SPARKLE_BOB;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius + bob;
    const twinkle =
      (Math.sin(view.ageFrames * SPARKLE_TWINKLE_PER_FRAME + index * GOLDEN_ANGLE) + 1) * HALF;
    const size = (SPARKLE_SIZE_MIN + SPARKLE_SIZE_RANGE * scatter(index * 2 + 1)) * twinkle;
    if (size <= 0) continue;
    ctx.globalAlpha = twinkle * Math.min(1, view.openProgress);
    ctx.fillStyle = index % 2 === 0 ? tierColor : theme.palette.text.primary;
    const waist = size * SPARKLE_WAIST;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + waist, y - waist);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + waist, y + waist);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - waist, y + waist);
    ctx.lineTo(x - size, y);
    ctx.lineTo(x - waist, y - waist);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintHeroIcon(target: PaintTarget, hero: PresentedHero, rect: Rect): void {
  const { ctx } = target;
  if (hero.icon === 'coins') {
    drawCoinRewardIcon(ctx, rect);
    return;
  }
  ITEM_ICONS[hero.icon](ctx, rect);
}

function tierRibbon(
  target: PaintTarget,
  view: PresentedRewardView,
  centreX: number,
  y: number,
): number {
  const { ctx, theme } = target;
  const label = view.tier.toUpperCase();
  const h = lineHeightOf(target, 'overline') + RIBBON_PAD_Y * 2;
  const w = measureText(target, label, { role: 'overline' }) + RIBBON_PAD_X * 2;
  const rect: Rect = { x: centreX - w * HALF, y, w, h };
  const color = lootTierColor(theme, view.tier);
  if (view.tier === 'Platinum') {
    const sheen = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    sheen.addColorStop(0, color);
    sheen.addColorStop(1, theme.palette.tier.platinumSheen);
    ctx.save();
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, theme.radius.pill);
    ctx.fill();
    ctx.restore();
  } else {
    fillRounded(ctx, rect, theme.radius.pill, color);
  }
  text(target, rect, {
    text: label,
    role: 'overline',
    color: theme.palette.text.inverse,
    align: 'center',
    valign: 'middle',
  });
  return h;
}

/**
 * Paints the screen over a `cw` × `ch` area. Returns where the item sits, for
 * the opener's burst particles to fly out of.
 */
export function paintPresentedReward(
  target: PaintTarget,
  cw: number,
  ch: number,
  view: PresentedRewardView,
): { x: number; y: number } {
  const { ctx, theme } = target;
  const { space } = theme;
  const skins = skinsFor(theme);
  const tierColor = lootTierColor(theme, view.tier);
  const panelW = Math.min(PANEL_MAX_W, cw - PANEL_MARGIN * 2);
  const panelH = Math.min(PANEL_MAX_H, ch - PANEL_MARGIN * 2);
  const panel: Rect = { x: (cw - panelW) * HALF, y: (ch - panelH) * HALF, w: panelW, h: panelH };

  ctx.save();
  ctx.shadowColor = withAlpha(tierColor, PANEL_GLOW_ALPHA);
  ctx.shadowBlur = PANEL_GLOW_BLUR;
  fillRounded(ctx, panel, theme.radius.lg, theme.palette.surface.sunken);
  ctx.restore();
  drawGlass(target, panel, skins.panel.card);
  ctx.save();
  const wash = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.h * PANEL_WASH_SHARE);
  wash.addColorStop(0, withAlpha(tierColor, PANEL_WASH_ALPHA));
  wash.addColorStop(1, withAlpha(tierColor, 0));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.w, panel.h, theme.radius.lg);
  ctx.fill();
  ctx.restore();
  strokeRounded(ctx, panel, theme.radius.lg, tierColor, PANEL_EDGE_WIDTH);

  const inner = inset(panel, view.compact ? space.md : space.lg);
  const centreX = inner.x + inner.w * HALF;
  let top = inner.y;
  top += tierRibbon(target, view, centreX, top) + space.sm;
  const titleRole: TextRole = view.compact ? 'title' : 'heading';
  const titleH = lineHeightOf(target, titleRole);
  text(
    target,
    { x: inner.x, y: top, w: inner.w, h: titleH },
    {
      text: view.title,
      role: titleRole,
      color: tierColor,
      align: 'center',
    },
  );
  top += titleH;
  const forH = lineHeightOf(target, 'caption');
  text(
    target,
    { x: inner.x, y: top, w: inner.w, h: forH },
    {
      text: `for ${view.playerName}`,
      role: 'caption',
      align: 'center',
    },
  );
  top += forH + space.sm;

  const hintH = lineHeightOf(target, 'caption');
  let bottom = inner.y + inner.h;
  text(
    target,
    { x: inner.x, y: bottom - hintH, w: inner.w, h: hintH },
    {
      text: view.hint,
      role: 'muted',
      align: 'center',
    },
  );
  bottom -= hintH + space.sm;

  const single = view.heroes.length === 1 ? view.heroes[0] : null;
  const nameRole: TextRole = view.compact ? 'heading' : 'display';
  if (single !== null && view.detail !== undefined) {
    const lineH = lineHeightOf(target, 'secondary');
    const nameH = measureTextHeight(target, inner.w, { text: single.label, role: nameRole });
    const freeH = bottom - top;
    const detailRoom = freeH * (1 - MIN_HERO_BAND_SHARE) - nameH - space.sm * 2;
    const maxLines = Math.max(DETAIL_MIN_LINES, Math.floor(detailRoom / lineH));
    const detailH = Math.min(
      maxLines * lineH,
      measureTextHeight(target, inner.w, { text: view.detail, role: 'secondary' }),
    );
    text(
      target,
      { x: inner.x, y: bottom - detailH, w: inner.w, h: detailH },
      {
        text: view.detail,
        role: 'secondary',
        align: 'center',
        wrap: true,
        maxLines,
      },
    );
    bottom -= detailH + space.sm;
  }
  if (single !== null) {
    const nameH = measureTextHeight(target, inner.w, { text: single.label, role: nameRole });
    text(
      target,
      { x: inner.x, y: bottom - nameH, w: inner.w, h: nameH },
      {
        text: single.label,
        role: nameRole,
        color: theme.palette.text.primary,
        align: 'center',
        wrap: true,
      },
    );
    bottom -= nameH + space.sm;
  }

  const band: Rect = { x: inner.x, y: top, w: inner.w, h: Math.max(0, bottom - top) };
  const grow = easeOutBack(Math.min(1, view.openProgress));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.w, panel.h, theme.radius.lg);
  ctx.clip();
  if (single !== null) {
    const iconSize = Math.min(band.h * HERO_ICON_HEIGHT_SHARE, band.w * HERO_ICON_WIDTH_SHARE);
    const cx = band.x + band.w * HALF;
    const cy = band.y + band.h * HALF;
    paintAura(target, view, cx, cy, iconSize, true);
    const side = Math.max(0, iconSize * grow);
    paintHeroIcon(target, single, { x: cx - side * HALF, y: cy - side * HALF, w: side, h: side });
    paintSparkles(target, view, cx, cy, iconSize * HALO_REACH);
    ctx.restore();
    return { x: cx, y: cy };
  }
  const count = Math.max(1, view.heroes.length);
  const cellW = band.w / count;
  const labelH = lineHeightOf(target, 'label');
  const iconSize = Math.min(
    cellW * ROW_ICON_CELL_SHARE,
    (band.h - labelH - space.sm) * ROW_ICON_HEIGHT_SHARE,
  );
  const cy = band.y + (band.h - labelH - space.sm) * HALF;
  paintAura(target, view, band.x + band.w * HALF, cy, Math.min(band.h, band.w) * HALF, true, false);
  view.heroes.forEach((hero, index) => {
    const cx = band.x + cellW * (index + HALF);
    paintAura(target, view, cx, cy, iconSize, false);
    const side = Math.max(0, iconSize * grow);
    paintHeroIcon(target, hero, { x: cx - side * HALF, y: cy - side * HALF, w: side, h: side });
    text(
      target,
      { x: cx - cellW * HALF, y: cy + iconSize * HALF + space.sm, w: cellW, h: labelH },
      { text: hero.label, role: 'label', color: theme.palette.text.primary, align: 'center' },
    );
  });
  const centre = { x: band.x + band.w * HALF, y: cy };
  paintSparkles(target, view, centre.x, centre.y, Math.min(band.h, band.w) * HALF);
  ctx.restore();
  return centre;
}

/** The heroes a reward's contents show: each named item, then its coins. */
export function presentedHeroes(
  items: ReadonlyArray<{ readonly id: ItemId; readonly quantity: number }>,
  coins: number,
): PresentedHero[] {
  const heroes: PresentedHero[] = items.map(({ id, quantity }) => ({
    icon: id,
    label: quantity > 1 ? `${quantity} × ${ITEM_DEF[id].name}` : ITEM_DEF[id].name,
  }));
  if (coins > 0) heroes.push({ icon: 'coins', label: `${coins.toLocaleString()} Coins` });
  return heroes;
}

/** A screen narrower or shorter than these sets the prize in smaller type. */
const COMPACT_BELOW_W = 440;
const COMPACT_BELOW_H = 520;

/** Whether a `cw` × `ch` screen takes the compact type. */
export function presentedCompact(cw: number, ch: number): boolean {
  return cw < COMPACT_BELOW_W || ch < COMPACT_BELOW_H;
}
