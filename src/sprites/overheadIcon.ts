/**
 * The one icon that floats over an NPC or a counter: a quest marker, the coin
 * of somewhere that sells things, the cross of someone who heals, or nothing.
 *
 * A wearer never paints two. Every shopkeeper asks {@link overheadIconFor}
 * (or, for a quest object rather than a person, {@link objectOverheadIconFor})
 * which one it wears and paints the answer with {@link drawOverheadIcon}, so
 * "the quest wins over the coin" is decided in one place rather than at each
 * call site.
 */

import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';
import { reportOverheadTop } from '../ui/world/overheadStack';
import {
  GLYPH_BADGE_BOB_AMPLITUDE,
  GLYPH_BADGE_SIZE,
  drawGlyphBadge,
  glyphBadgeBob,
  type BadgeGlyph,
} from '../ui/world/glyphBadge';
import { TILE_SIZE } from '../core/constants';
import { deferAboveDarkness } from '../systems/lighting/aboveDarkness';
import type { DrawnFigureRow } from './figure/figureDef';
import { figureRowInkTopWhenMeasured } from './figure/figureFrameCache';
import {
  EXCLAMATION_CENTER_X,
  QUEST_MARKER_HEAD_GAP_PX,
  drawQuestMarker,
  objectMarkerLook,
  questMarkerReachAboveArtPx,
  questMarkerPresentReachRightPx,
  questMarkerTopY,
  type ObjectQuestMarker,
  type ShownObjectQuestMarker,
} from './questNPCSprite';
import {
  npcMarkerBeaconStrength,
  npcMarkerLook,
  type NpcMarker,
  type ShownNpcMarker,
} from './npcQuestMarker';
import { drawQuestBeacon, questBeaconBounds } from './questBeacon';

/**
 * Whether a counter has anything to sell. A shelf that is empty for now but
 * restocks still `trades`; a counter that sells healing rather than goods
 * `treats`; only a counter that will never sell again (Oren once every tool is
 * at its finest tier) or one shut right now is `closed`.
 */
export type ShopSign = 'trades' | 'treats' | 'closed';

type BadgeIcon = 'shop' | 'medical';

/** The single icon a person shows: an NPC marker (see `npcQuestMarker.ts`) or a counter's badge. */
export type NpcOverheadIcon = NpcMarker | BadgeIcon;

/** The single icon a quest object (a board, a stall) shows: the plain `!`/`?` or a counter's badge. */
export type ObjectOverheadIcon = ShownObjectQuestMarker | BadgeIcon | 'none';

/** Any overhead icon, for the painters that draw both kinds. */
export type OverheadIcon = NpcOverheadIcon | ObjectOverheadIcon;

const ICON_FOR_SIGN = {
  trades: 'shop',
  treats: 'medical',
  closed: 'none',
} as const satisfies Record<ShopSign, BadgeIcon | 'none'>;

/** The icon a person with marker `marker` and shop sign `shop` shows: a marker always outranks the counter's badge. */
export function overheadIconFor(marker: NpcMarker, shop: ShopSign): NpcOverheadIcon {
  if (marker !== 'none') return marker;
  return ICON_FOR_SIGN[shop];
}

/** {@link overheadIconFor} for a quest object rather than a person. */
export function objectOverheadIconFor(
  quest: ObjectQuestMarker,
  shop: ShopSign,
): ObjectOverheadIcon {
  if (quest !== 'none') return quest;
  return ICON_FOR_SIGN[shop];
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
/** The cross's arm length and thickness as fractions of the disc's radius. */
const CROSS_ARM_RATIO = 0.62;
const CROSS_THICKNESS_RATIO = 0.42;

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

/** A white disc with a green first-aid cross, so a healer reads as a healer rather than another shop. */
function drawMedicalGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, FULL_TURN);
  ctx.strokeStyle = worldPalette.glyphBadge.glyphOutline;
  ctx.lineWidth = Math.max(COIN_OUTLINE_WIDTH_MIN, radius * COIN_OUTLINE_WIDTH_FRACTION);
  ctx.stroke();
  ctx.fillStyle = worldPalette.medicalSign.disc;
  ctx.fill();
  const arm = radius * CROSS_ARM_RATIO;
  const halfThickness = (radius * CROSS_THICKNESS_RATIO) / 2;
  ctx.fillStyle = worldPalette.medicalSign.cross;
  ctx.fillRect(cx - arm, cy - halfThickness, arm * 2, halfThickness * 2);
  ctx.fillRect(cx - halfThickness, cy - arm, halfThickness * 2, arm * 2);
  ctx.restore();
}

const BADGE_GLYPHS = {
  shop: drawCoinGlyph,
  medical: drawMedicalGlyph,
} as const satisfies Record<BadgeIcon, BadgeGlyph>;

/**
 * Where a glyph badge hangs over art whose highest pixel is `artTopY`: its
 * centre at rest, and `topY`, its highest pixel at the top of its bob. The
 * badge's lowest point at the bottom of its bob keeps `gapPx` of clear air
 * over the art. Wearers drawn larger than one world tile get a proportionally
 * larger badge.
 */
export function badgeLayout(artTopY: number, s: number, gapPx = QUEST_MARKER_HEAD_GAP_PX) {
  const scale = s / TILE_SIZE;
  const halfSize = (GLYPH_BADGE_SIZE * scale) / 2;
  const bobAmplitude = GLYPH_BADGE_BOB_AMPLITUDE * scale;
  const restingCenterY = artTopY - gapPx - bobAmplitude - halfSize;
  const topY = restingCenterY - bobAmplitude - halfSize;
  return { scale, restingCenterY, topY };
}

function drawCounterBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTopY: number,
  s: number,
  icon: BadgeIcon,
) {
  const { scale, restingCenterY, topY } = badgeLayout(artTopY, s);
  const cx = sx + s * EXCLAMATION_CENTER_X;
  reportOverheadTop(ctx, cx, topY);
  if (deferAboveDarkness((target) => drawCounterBadge(target, sx, artTopY, s, icon))) return;
  const cy = restingCenterY + glyphBadgeBob(performance.now()) * scale;
  drawGlyphBadge(ctx, cx, cy, BADGE_GLYPHS[icon], scale);
}

/** How a quest icon paints: its glyph, colour and whether a present rides beside it. */
function questIconLook(icon: ShownNpcMarker | ShownObjectQuestMarker) {
  switch (icon) {
    case 'available':
    case 'inProgress':
    case 'turnIn':
    case 'news':
      return npcMarkerLook(icon);
    case 'exclamation':
    case 'question':
      return objectMarkerLook(icon);
    default: {
      const unhandled: never = icon;
      return unhandled;
    }
  }
}

/**
 * The line an overhead icon hangs from: a top that will not move once the
 * icon shows.
 *
 * A figure row's plain top (`figureRowInkTop`) is a stand-in at the top
 * of its cell until the row is measured, so an icon hung from it shows a head
 * too high, then drops onto the wearer a moment later. An anchor can only be
 * made from a measured row ({@link IconAnchor.ofRow}, null until the row is
 * measured, when the icon is left off) or from art whose top is final on its
 * first frame ({@link IconAnchor.ofFixedArt}), so a wearer has to say which.
 */
export class IconAnchor {
  private constructor(readonly y: number) {}

  /** The measured top of the row a figure drew, or null while it is still being measured. */
  static ofRow(row: DrawnFigureRow | undefined, sy: number, tileSize: number): IconAnchor | null {
    if (row === undefined) return null;
    const y = figureRowInkTopWhenMeasured(row, sy, tileSize);
    return y === null ? null : new IconAnchor(y);
  }

  /**
   * A top that is right on the first frame it is known: a baked sheet's ink,
   * a figure's fixed head height. Never a figure row's top; that is
   * {@link IconAnchor.ofRow}.
   */
  static ofFixedArt(y: number): IconAnchor {
    return new IconAnchor(y);
  }

  /** This anchor raised to clear `top` as well: a health bar or a bubble at fixed geometry. */
  clearing(top: number): IconAnchor {
    return top < this.y ? new IconAnchor(top) : this;
  }
}

/**
 * Paints `icon` over a wearer whose art ends at `anchor`, centred over the box
 * at `sx` sized `s` — the same contract as `drawQuestMarker`. Nothing while
 * the anchor is null: the wearer's row is still being measured.
 */
export function drawOverheadIcon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  anchor: IconAnchor | null,
  s: number,
  icon: OverheadIcon,
): void {
  if (anchor === null) return;
  const artTopY = anchor.y;
  switch (icon) {
    case 'none':
      return;
    case 'shop':
    case 'medical':
      drawCounterBadge(ctx, sx, artTopY, s, icon);
      return;
    case 'available':
    case 'inProgress':
    case 'turnIn':
    case 'news':
    case 'exclamation':
    case 'question': {
      const look = questIconLook(icon);
      drawQuestMarker(ctx, sx, artTopY, s, look.glyph, look.color, look.withPresent);
    }
  }
}

/**
 * The column of light behind a wearer of `icon`, whose tile's top-left is at
 * screen (`sx`, `sy`): only a quest icon has one, in its own colour, and an
 * offer quiets while the party is on another quest. Call it before the
 * wearer's body paint so the beam stands behind them. `strengthScale` is
 * `drawQuestBeacon`'s, for a figure pale enough to wash out in the glow.
 */
export function drawOverheadIconBeacon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  camX: number,
  camY: number,
  icon: OverheadIcon,
  strengthScale = 1,
): void {
  switch (icon) {
    case 'none':
    case 'shop':
    case 'medical':
      return;
    case 'available':
    case 'inProgress':
    case 'turnIn':
    case 'news': {
      const strength = strengthScale * npcMarkerBeaconStrength(icon);
      const { color } = npcMarkerLook(icon);
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), color, strength);
      return;
    }
    case 'exclamation':
    case 'question': {
      const color = questIconLook(icon).color;
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), color, strengthScale);
      return;
    }
    default: {
      const unhandled: never = icon;
      return unhandled;
    }
  }
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
  switch (icon) {
    case 'none':
      return artTopY;
    case 'shop':
    case 'medical':
      return badgeLayout(artTopY, s).topY;
    case 'available':
    case 'inProgress':
    case 'turnIn':
    case 'news':
    case 'exclamation':
    case 'question':
      return questMarkerTopY(ctx, artTopY, s, questIconLook(icon).glyph);
  }
}

/** The part of the screen an overhead icon and its beam can paint over its wearer. */
export interface OverheadIconReach {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  /** A quest beam's ground pool spreads below the wearer's tile; a badge stays above the art. */
  readonly bottom: number;
}

/**
 * Everything `icon` can paint over a wearer whose box is at `sx` sized `s`,
 * whose tile's top-left is at (`sx`, `sy`) as {@link drawOverheadIconBeacon}
 * takes it, and whose art can rise no higher than `artTopY`: the beam of a
 * quest icon and the glyph or badge at the top of its bounce. Null for none.
 * For a culler, which must draw the wearer before any of it reaches the view.
 */
export function overheadIconReach(
  sx: number,
  sy: number,
  s: number,
  artTopY: number,
  icon: OverheadIcon,
): OverheadIconReach | null {
  switch (icon) {
    case 'none':
      return null;
    case 'shop':
    case 'medical': {
      const layout = badgeLayout(artTopY, s);
      const halfSize = (GLYPH_BADGE_SIZE * layout.scale) / 2;
      const centreX = sx + s * EXCLAMATION_CENTER_X;
      return {
        left: Math.min(sx, centreX - halfSize),
        right: Math.max(sx + s, centreX + halfSize),
        top: layout.topY,
        bottom: artTopY,
      };
    }
    case 'available':
    case 'inProgress':
    case 'turnIn':
    case 'news':
    case 'exclamation':
    case 'question': {
      const beam = questBeaconBounds(sx, sy, s);
      const presentRight = questIconLook(icon).withPresent
        ? sx + s * EXCLAMATION_CENTER_X + questMarkerPresentReachRightPx(s)
        : sx + s;
      return {
        left: Math.min(sx, beam.left),
        right: Math.max(sx + s, beam.right, presentRight),
        top: Math.min(beam.top, artTopY - questMarkerReachAboveArtPx(s)),
        bottom: beam.bottom,
      };
    }
  }
}
