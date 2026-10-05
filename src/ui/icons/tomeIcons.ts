import { drawSpriteKey } from '../../core/SpriteRenderer';
import { drawDynamiteInventoryIcon } from '../../sprites/dynamiteSprite';
import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';
import { type CoverPalette, drawBookIcon } from './skillBookIcon';

/** Soot-black cover, charred-red spine: the explosives tome reads apart from every skill book. */
const EXPLOSIVES_TOME_COVER: CoverPalette = { cover: '#262222', spine: '#7f1d1d' };
/** The dynamite emblem on the tome's cover, as a share of the icon. */
const EXPLOSIVES_TOME_EMBLEM_SCALE = 0.55;
/** Nudges the emblem off the spine so it sits on the face of the cover. */
const EXPLOSIVES_TOME_EMBLEM_SPINE_OFFSET = 0.04;

/** Tome of Explosives Handling: a soot-black book with a stick of dynamite on its cover. */
export function drawExplosivesTomeIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  drawBookIcon(ctx, rect, EXPLOSIVES_TOME_COVER);
  const emblemSize = size * EXPLOSIVES_TOME_EMBLEM_SCALE;
  const emblemX = x + (size - emblemSize) / 2 + size * EXPLOSIVES_TOME_EMBLEM_SPINE_OFFSET;
  const emblemY = y + (size - emblemSize) / 2;
  drawDynamiteInventoryIcon(ctx, { x: emblemX, y: emblemY, w: emblemSize, h: emblemSize });
}

/** Magic Missile tome: the spell's own ability icon. */
export function drawMagicMissileTomeIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  drawSpriteKey(ctx, 'magic_missile_icon', 'standard', 0, x, y, size);
}

/** Smush tome: the spell's own ability icon. */
export function drawSmushTomeIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  drawSpriteKey(ctx, 'smush_icon', 'standard', 0, x, y, size);
}
