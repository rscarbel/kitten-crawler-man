import type { SkillId } from '../../core/SkillManager';

/**
 * One shared book silhouette for every skill book, tinted per skill.
 *
 * Five near-identical hand-drawn books would be five places to keep in sync for
 * no visual gain — the cover colour is what a player actually reads at inventory
 * slot size.
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

interface CoverPalette {
  cover: string;
  spine: string;
}

const SKILL_COVERS: Record<SkillId, CoverPalette> = {
  cockroach: { cover: '#5b3a1e', spine: '#2f1d0d' },
  cat_reflexes: { cover: '#4c1d95', spine: '#2a0f57' },
  pugilism: { cover: '#7f1d1d', spine: '#450a0a' },
  iron_stomach: { cover: '#3f6212', spine: '#1f3006' },
  night_vision: { cover: '#1e3a8a', spine: '#0d1b45' },
  iron_punch: { cover: '#3f4854', spine: '#1c2129' },
  powerful_strike: { cover: '#92400e', spine: '#4a1f04' },
};

/** Draws a closed book, cover facing the viewer, into a square icon region. */
export function drawSkillBookIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  skillId: SkillId,
): void {
  const palette = SKILL_COVERS[skillId];
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
