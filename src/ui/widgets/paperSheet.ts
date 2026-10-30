/**
 * Text read off paper inside a panel: a small stack of sheets, the ones
 * beneath shifted and turned a little, with the words on the top sheet in the
 * paper's own face and ink.
 *
 * Two kinds, picked by {@link PaperSheetVariant}: `legal`, a tall ruled pad
 * page with a red margin, for documents (ledgers, letters, posted orders),
 * and `note`, a smaller, squarer slip torn off along its top and pinned up,
 * for a scribbled note. The panel around it stays an ordinary panel, so a
 * phone still gets its bottom sheet and Escape still closes it.
 *
 * The top sheet fills the height it is given, up to its paper's proportions,
 * so a reader paging through keeps one sheet size; text taller than the
 * sheet scrolls on it.
 */

import type { Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor, type PaperSheetMarks, type PaperSheetSkin } from '../theme/skins';
import {
  NOTE_TORN_EDGE,
  type PaperScale,
  type PaperSheetVariant,
  type Theme,
} from '../theme/tokens';
import type { PaintTarget } from './paint';
import { roundRectPath } from './roundRect';
import { scrollView } from './scrollView';
import { measureTextHeight, text } from './text';

export type { PaperSheetVariant } from '../theme/tokens';

export interface PaperSheetOptions {
  /** Unique within the surface; scopes the sheet's scroll. */
  readonly id: string;
  readonly variant: PaperSheetVariant;
  /** Lines separated by `\n`. A blank line between paragraphs keeps a pad's rules in step with the writing. */
  readonly text: string;
}

/** What laying out a stack needs: a measuring context, the theme, the screen's height and size class. */
export type PaperSheetTarget = Pick<Ui, 'ctx' | 'theme' | 'viewport' | 'size'>;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

const paperThemes = new WeakMap<Theme, Map<string, Theme>>();

/** `theme` with the paper's face in place of the UI face, built once per pair. */
function paperTheme(theme: Theme, family: string): Theme {
  const byFamily = paperThemes.get(theme) ?? new Map<string, Theme>();
  paperThemes.set(theme, byFamily);
  const cached = byFamily.get(family);
  if (cached !== undefined) return cached;
  const built: Theme = { ...theme, fontFamily: family };
  byFamily.set(family, built);
  return built;
}

function paperTarget(target: PaintTarget, skin: PaperSheetSkin): PaintTarget {
  return { ctx: target.ctx, theme: paperTheme(target.theme, skin.fontFamily) };
}

/** A phone's screen gets the compact paper, whose thin margins leave a short page its height for writing. */
function skinOf(target: PaperSheetTarget, variant: PaperSheetVariant): PaperSheetSkin {
  const scale: PaperScale = target.size === 'compact' ? 'compact' : 'roomy';
  return skinsFor(target.theme).paperSheet[scale][variant];
}

/** Room around the top sheet that the sheets beneath and the shadows show in. */
interface StackMargins {
  readonly side: number;
  readonly top: number;
  readonly bottom: number;
}

function stackMargins(skin: PaperSheetSkin, sheetWidth: number): StackMargins {
  let side = 0;
  let above = 0;
  let below = 0;
  for (const sheet of skin.under) {
    const turnRise = (sheetWidth * Math.abs(Math.sin(sheet.turn))) / 2;
    side = Math.max(side, Math.abs(sheet.dx));
    above = Math.max(above, turnRise - sheet.dy);
    below = Math.max(below, turnRise + sheet.dy);
  }
  return {
    side: side + skin.shadowOffset,
    top: Math.max(0, above),
    bottom: Math.max(0, below) + skin.shadowOffset,
  };
}

/** The top sheet's width in a stack `width` wide. */
function sheetWidthIn(skin: PaperSheetSkin, width: number): number {
  const side = stackMargins(skin, skin.maxWidth).side;
  return Math.max(0, Math.min(skin.maxWidth, width - side * 2));
}

function textWidthOn(skin: PaperSheetSkin, sheetWidth: number): number {
  return Math.max(0, sheetWidth - skin.pad.l - skin.pad.r);
}

function writingHeight(
  target: PaintTarget,
  skin: PaperSheetSkin,
  sheetWidth: number,
  content: string,
): number {
  return measureTextHeight(paperTarget(target, skin), textWidthOn(skin, sheetWidth), {
    text: content,
    style: skin.ink.style,
  });
}

/** The tallest the top sheet grows to fill its room: its text, or its paper's proportions if those are taller. */
function fullSheetHeight(skin: PaperSheetSkin, sheetWidth: number, contentHeight: number): number {
  const proportioned = skin.aspect > 0 ? sheetWidth / skin.aspect : 0;
  return Math.max(contentHeight, proportioned);
}

/**
 * How a stack is measured. `least` is what it needs to show its text
 * without scrolling. `natural` also gives a short text a sheet of its
 * paper's proportions, as far as {@link PaperSheetSkin.minHeightViewportShare}
 * of the screen allows, so a one-line note is still a slip and not a strip;
 * size a panel by it, and fit text to a screen by `least`.
 */
export type PaperSheetFit = 'natural' | 'least';

/** The height a stack `width` wide takes to show `opts.text`, measured by `opts.fit`. */
export function paperSheetHeight(
  target: PaperSheetTarget,
  width: number,
  opts: Pick<PaperSheetOptions, 'variant' | 'text'> & { readonly fit: PaperSheetFit },
): number {
  const skin = skinOf(target, opts.variant);
  const sheetW = sheetWidthIn(skin, width);
  const margins = stackMargins(skin, sheetW);
  const contentH = skin.pad.t + writingHeight(target, skin, sheetW, opts.text) + skin.pad.b;
  const shortestSheet =
    opts.fit === 'natural'
      ? Math.min(fullSheetHeight(skin, sheetW, 0), target.viewport.h * skin.minHeightViewportShare)
      : 0;
  return margins.top + Math.max(contentH, shortestSheet) + margins.bottom;
}

/** Traces a sheet's outline: a note's top edge is torn, every other edge is straight. */
function sheetPath(ctx: CanvasRenderingContext2D, skin: PaperSheetSkin, r: Rect): void {
  const marks = skin.marks;
  if (marks.kind !== 'pinnedSlip') {
    roundRectPath(ctx, r, skin.radius);
    return;
  }
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  ctx.beginPath();
  ctx.moveTo(r.x, bottom);
  const bite = (tooth: number): number =>
    (NOTE_TORN_EDGE[tooth % NOTE_TORN_EDGE.length]?.bite ?? 0) * marks.tearDepth;
  let tooth = 0;
  for (let x = r.x; x < right; x += marks.tearStep) {
    ctx.lineTo(x, r.y + bite(tooth));
    tooth++;
  }
  ctx.lineTo(right, r.y + bite(tooth));
  ctx.lineTo(right, bottom);
  ctx.closePath();
}

/** One sheet with its shadow under it and a hairline round it, in the current transform. */
function paintSheet(
  ctx: CanvasRenderingContext2D,
  skin: PaperSheetSkin,
  r: Rect,
  fill: string,
): void {
  const shadow: Rect = {
    x: r.x + skin.shadowOffset,
    y: r.y + skin.shadowOffset,
    w: r.w,
    h: r.h,
  };
  sheetPath(ctx, skin, shadow);
  ctx.fillStyle = skin.shadow;
  ctx.fill();
  sheetPath(ctx, skin, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = skin.edgeWidth;
  ctx.stroke();
}

function paintUnderSheets(ctx: CanvasRenderingContext2D, skin: PaperSheetSkin, top: Rect): void {
  const cx = top.x + top.w * HALF;
  const cy = top.y + top.h * HALF;
  const centred: Rect = { x: -top.w * HALF, y: -top.h * HALF, w: top.w, h: top.h };
  for (const sheet of skin.under) {
    ctx.save();
    ctx.translate(cx + sheet.dx, cy + sheet.dy);
    ctx.rotate(sheet.turn);
    paintSheet(ctx, skin, centred, sheet.fill);
    ctx.restore();
  }
}

/** A legal pad's double margin rule, down the whole sheet. */
function paintMargin(
  ctx: CanvasRenderingContext2D,
  marks: Extract<PaperSheetMarks, { kind: 'ruledPad' }>,
  sheet: Rect,
): void {
  ctx.strokeStyle = marks.margin;
  ctx.lineWidth = marks.marginWidth;
  ctx.beginPath();
  for (const x of [sheet.x + marks.marginInset, sheet.x + marks.marginInset + marks.marginGap]) {
    ctx.moveTo(x, sheet.y);
    ctx.lineTo(x, sheet.y + sheet.h);
  }
  ctx.stroke();
}

/** A rule under every line from `firstLineTop` to the bottom of `sheet`, edge to edge. */
function paintRules(
  ctx: CanvasRenderingContext2D,
  marks: Extract<PaperSheetMarks, { kind: 'ruledPad' }>,
  sheet: Rect,
  firstLineTop: number,
  lineHeight: number,
  clipBottom: number,
): void {
  if (lineHeight <= 0) return;
  ctx.strokeStyle = marks.rule;
  ctx.lineWidth = marks.ruleWidth;
  ctx.beginPath();
  for (let y = firstLineTop + lineHeight - marks.ruleRise; y < clipBottom; y += lineHeight) {
    ctx.moveTo(sheet.x, y);
    ctx.lineTo(sheet.x + sheet.w, y);
  }
  ctx.stroke();
}

function paintPin(
  ctx: CanvasRenderingContext2D,
  skin: PaperSheetSkin,
  marks: Extract<PaperSheetMarks, { kind: 'pinnedSlip' }>,
  sheet: Rect,
): void {
  const cx = sheet.x + sheet.w * HALF;
  const cy = sheet.y + marks.pinDrop;
  ctx.fillStyle = skin.shadow;
  ctx.beginPath();
  ctx.arc(cx + skin.shadowOffset, cy + skin.shadowOffset, marks.pinRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = marks.pinHead;
  ctx.beginPath();
  ctx.arc(cx, cy, marks.pinRadius, 0, FULL_TURN);
  ctx.fill();
  const shineRadius = marks.pinRadius * marks.pinShineShare;
  const shineOffset = marks.pinRadius - shineRadius * 2;
  ctx.fillStyle = marks.pinShine;
  ctx.beginPath();
  ctx.arc(cx - shineOffset, cy - shineOffset, shineRadius, 0, FULL_TURN);
  ctx.fill();
}

/**
 * Draws the stack in `rect`: the sheets beneath, the top sheet filling the
 * height it is given (up to its paper's proportions), its marks and the text
 * on it. Text too tall for the sheet scrolls on it.
 */
export function paperSheet(ui: Ui, rect: Rect, opts: PaperSheetOptions): void {
  const { ctx } = ui;
  const skin = skinOf(ui, opts.variant);
  const sheetW = sheetWidthIn(skin, rect.w);
  const margins = stackMargins(skin, sheetW);
  const writing = paperTarget(ui, skin);
  const textW = textWidthOn(skin, sheetW);
  const writingH = writingHeight(ui, skin, sheetW, opts.text);
  const contentH = skin.pad.t + writingH + skin.pad.b;
  const room = Math.max(0, rect.h - margins.top - margins.bottom);
  const sheetH = Math.min(room, fullSheetHeight(skin, sheetW, contentH));
  const sheet: Rect = {
    x: rect.x + (rect.w - sheetW) * HALF,
    y: rect.y + margins.top,
    w: sheetW,
    h: sheetH,
  };
  const lineHeight = skin.ink.style.lineHeight;
  const marks = skin.marks;

  ctx.save();
  paintUnderSheets(ctx, skin, sheet);
  paintSheet(ctx, skin, sheet, skin.sheet);
  if (marks.kind === 'ruledPad') paintMargin(ctx, marks, sheet);
  ctx.restore();

  const writingArea: Rect = {
    x: sheet.x,
    y: sheet.y + skin.pad.t,
    w: sheet.w,
    h: Math.max(0, sheet.h - skin.pad.t - skin.pad.b),
  };
  const drawWriting = (area: Rect): void => {
    if (marks.kind === 'ruledPad') {
      ctx.save();
      paintRules(ctx, marks, sheet, area.y, lineHeight, area.y + Math.max(area.h, sheet.h));
      ctx.restore();
    }
    text(
      writing,
      { x: sheet.x + skin.pad.l, y: area.y, w: textW, h: writingH },
      { text: opts.text, style: skin.ink.style, color: skin.ink.color, wrap: true },
    );
  };
  if (writingH > writingArea.h) {
    scrollView(ui, writingArea, {
      id: `${opts.id}/writing`,
      contentHeight: writingH,
      draw: drawWriting,
    });
  } else {
    ui.clip(sheet, () => drawWriting(writingArea));
  }

  if (marks.kind === 'pinnedSlip') {
    ctx.save();
    paintPin(ctx, skin, marks, sheet);
    ctx.restore();
  }
}
