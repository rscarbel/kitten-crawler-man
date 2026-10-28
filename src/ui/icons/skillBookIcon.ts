import type { SkillId } from '../../core/skills/SkillManager';
import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';
import { palette as themePalette } from '../theme/tokens';

/**
 * One shared book silhouette for every skill book, tinted per skill.
 *
 * A hand-drawn book per skill would be one more picture to keep in step for
 * every skill added, for no visual gain: the cover colour is what a player
 * actually reads at inventory slot size.
 */

// Geometry as fractions of the icon square.
const BOOK_CX = 0.5;
const BOOK_CY = 0.5;
const BOOK_W = 0.52;
const BOOK_H = 0.66;
const SPINE_W = 0.11;
const PAGE_INSET = 0.05;
const PAGE_LINE_COUNT = 3;
const PAGE_LINE_INSET_X = 0.1;
const PAGE_LINE_TOP = 0.22;
const PAGE_LINE_SPACING = 0.15;
const CLASP_W = 0.06;
const CLASP_H = 0.12;
const BORDER_WIDTH = 1;
const PAGE_LINE_WIDTH = 1;

const PAGE_COLOR = '#e8dfc8';
const PAGE_LINE_COLOR = '#a8927a';
const CLASP_COLOR = '#c8a860';

export interface CoverPalette {
  readonly cover: string;
  readonly spine: string;
}

const SKILL_COVERS = themePalette.skillBook satisfies Record<SkillId, CoverPalette>;

/** Draws a closed skill book, cover facing the viewer, centred in `rect`. */
export function drawSkillBookIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  skillId: SkillId,
): void {
  drawBookIcon(ctx, rect, SKILL_COVERS[skillId]);
}

/**
 * Draws a closed book in the given cover colours. Shared by every tome in the
 * game, so a book always reads as a book at slot size whatever it teaches.
 */
export function drawBookIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  palette: CoverPalette,
): void {
  const { x, y, size } = iconSquare(rect);
  const w = size * BOOK_W;
  const h = size * BOOK_H;
  const left = x + size * BOOK_CX - w / 2;
  const top = y + size * BOOK_CY - h / 2;

  // Page block peeking out past the fore-edge
  ctx.fillStyle = PAGE_COLOR;
  ctx.fillRect(left + size * PAGE_INSET, top + size * PAGE_INSET, w, h - size * PAGE_INSET * 2);

  ctx.fillStyle = palette.cover;
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = palette.spine;
  ctx.fillRect(left, top, size * SPINE_W, h);

  ctx.strokeStyle = palette.spine;
  ctx.lineWidth = BORDER_WIDTH;
  ctx.strokeRect(left, top, w, h);

  // Title lines embossed on the cover
  ctx.strokeStyle = PAGE_LINE_COLOR;
  ctx.lineWidth = PAGE_LINE_WIDTH;
  ctx.beginPath();
  for (let i = 0; i < PAGE_LINE_COUNT; i++) {
    const lineY = top + h * (PAGE_LINE_TOP + i * PAGE_LINE_SPACING);
    ctx.moveTo(left + w * PAGE_LINE_INSET_X + size * SPINE_W, lineY);
    ctx.lineTo(left + w * (1 - PAGE_LINE_INSET_X), lineY);
  }
  ctx.stroke();

  ctx.fillStyle = CLASP_COLOR;
  ctx.fillRect(
    left + w - size * CLASP_W,
    top + h / 2 - (size * CLASP_H) / 2,
    size * CLASP_W,
    size * CLASP_H,
  );
}
