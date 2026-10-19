/**
 * The one icon that floats over an NPC or a counter: a quest `!`/`?`, the
 * coin of somewhere that sells things, or nothing.
 *
 * A wearer never paints two. Every shopkeeper asks {@link overheadIconFor}
 * which one it wears and paints the answer with {@link drawOverheadIcon}, so
 * "the quest wins over the coin" is decided in one place rather than at each
 * call site.
 */

import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';
import {
  GLYPH_BADGE_BOB_AMPLITUDE,
  GLYPH_BADGE_SIZE,
  drawGlyphBadge,
  glyphBadgeBob,
} from '../ui/world/glyphBadge';
import { TILE_SIZE } from '../core/constants';
import { deferAboveDarkness } from '../systems/lighting/aboveDarkness';
import {
  EXCLAMATION_CENTER_X,
  QUEST_MARKER_HEAD_GAP_PX,
  drawQuestMarker,
  questMarkerColorFor,
  questMarkerTopY,
  type QuestMarkerGlyph,
  type QuestMarkerState,
} from './questNPCSprite';

/**
 * Whether a counter has anything to sell. A shelf that is empty for now but
 * restocks still `trades`; only a counter that will never sell again (Oren
 * once every tool is at its finest tier) or one shut right now is `closed`.
 */
export type ShopSign = 'trades' | 'closed';

/** The single icon a wearer shows. */
export type OverheadIcon = QuestMarkerState | 'shop';

/** The icon a wearer with quest state `quest` and shop sign `shop` shows: a quest marker always outranks the coin. */
export function overheadIconFor(quest: QuestMarkerState, shop: ShopSign): OverheadIcon {
  if (quest !== 'none') return quest;
  return shop === 'trades' ? 'shop' : 'none';
}

/** The sign for a counter that `trades` when true; for callers holding a boolean. */
export function shopSignWhen(trades: boolean): ShopSign {
  return trades ? 'trades' : 'closed';
}

/** The coin's edge as a fraction of its radius, floored so it stays visible on the smallest wearers. */
const COIN_OUTLINE_WIDTH_FRACTION = 0.3;
const COIN_OUTLINE_WIDTH_MIN = 1.1;
/** Stamped on the coin so it reads as money rather than a green orb. */
const CURRENCY_MARK = '$';
const CURRENCY_MARK_SIZE_RATIO = 1.5;
/** A middle baseline sits the mark's ink a touch high; this drops it onto the coin's centre. */
const CURRENCY_MARK_DROP_RATIO = 0.08;
const FULL_TURN = Math.PI * 2;

function glyphOf(icon: Exclude<OverheadIcon, 'shop' | 'none'>): QuestMarkerGlyph {
  return icon === 'question' ? '?' : '!';
}

/** A flat emerald coin on a dark edge, in the same idiom as the station glyphs. */
function drawCoinGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, FULL_TURN);
  ctx.strokeStyle = worldPalette.glyphBadge.glyphOutline;
  ctx.lineWidth = Math.max(COIN_OUTLINE_WIDTH_MIN, radius * COIN_OUTLINE_WIDTH_FRACTION);
  ctx.stroke();
  ctx.fillStyle = worldPalette.shopSign.coin;
  ctx.fill();
  ctx.restore();
  worldText(ctx, CURRENCY_MARK, {
    x: cx,
    y: cy + radius * CURRENCY_MARK_DROP_RATIO,
    size: Math.max(1, Math.round(radius * CURRENCY_MARK_SIZE_RATIO)),
    bold: true,
    color: worldPalette.shopSign.mark,
    align: 'center',
    baseline: 'middle',
  });
}

/** Wearers drawn larger than one world tile get a proportionally larger badge. */
function badgeLayout(artTopY: number, s: number) {
  const scale = s / TILE_SIZE;
  const halfSize = (GLYPH_BADGE_SIZE * scale) / 2;
  const bobAmplitude = GLYPH_BADGE_BOB_AMPLITUDE * scale;
  const restingCenterY = artTopY - QUEST_MARKER_HEAD_GAP_PX - bobAmplitude - halfSize;
  return { scale, halfSize, bobAmplitude, restingCenterY };
}

function drawShopBadge(ctx: CanvasRenderingContext2D, sx: number, artTopY: number, s: number) {
  if (deferAboveDarkness((target) => drawShopBadge(target, sx, artTopY, s))) return;
  const { scale, restingCenterY } = badgeLayout(artTopY, s);
  const cy = restingCenterY + glyphBadgeBob(performance.now()) * scale;
  const cx = sx + s * EXCLAMATION_CENTER_X;
  drawGlyphBadge(ctx, cx, cy, drawCoinGlyph, scale);
}

/**
 * Paints `icon` over a wearer whose highest painted pixel is `artTopY`, centred
 * over the box at `sx` sized `s` — the same contract as `drawQuestMarker`,
 * which the quest states are handed to unchanged.
 */
export function drawOverheadIcon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTopY: number,
  s: number,
  icon: OverheadIcon,
): void {
  if (icon === 'none') return;
  if (icon === 'shop') {
    drawShopBadge(ctx, sx, artTopY, s);
    return;
  }
  const color = questMarkerColorFor(icon);
  if (color === undefined) return;
  drawQuestMarker(ctx, sx, artTopY, s, glyphOf(icon), color);
}

/**
 * The screen y of the icon's highest pixel at the top of its bounce, or
 * `artTopY` itself when there is none — the line a bubble stacked over the
 * wearer has to stay above.
 */
export function overheadIconTopY(
  ctx: CanvasRenderingContext2D,
  artTopY: number,
  s: number,
  icon: OverheadIcon,
): number {
  if (icon === 'none') return artTopY;
  if (icon === 'shop') {
    const { halfSize, bobAmplitude, restingCenterY } = badgeLayout(artTopY, s);
    return restingCenterY - bobAmplitude - halfSize;
  }
  return questMarkerTopY(ctx, artTopY, s, glyphOf(icon));
}
