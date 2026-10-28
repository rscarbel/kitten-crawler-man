/**
 * The one painter for Caroline, the System AI. Everything she says is drawn
 * here, in a frame no other speaker wears: a chamfered terminal readout with
 * a cyan hairline and heavier corner brackets over a blue-black ground with a
 * faint grid and slowly drifting scanlines, a "System AI message:" strip with
 * a pulsing status dot, and her words decoding in after "Caroline - ".
 *
 * Script text never carries the label or the prefix: this file adds both.
 *
 * Two variants share the frame: the full box (dialog, prompts, the AI
 * panel) and a compact toast (one row, label inline). Every painter is a pure function of
 * the clock it is handed, so a frozen review moment shows exactly what a
 * player would.
 */

import type { SoundId } from '../../audio/sounds';
import { inset, type Rect } from '../core/geom';
import { withAlpha } from '../theme/color';
import { skinsFor, type CarolineSkin } from '../theme/skins';
import { terminalTheme } from '../theme/terminalTheme';
import type { Theme, TypeStyle } from '../theme/tokens';
import type { PaintTarget } from './paint';
import { measureText, text, wrapToWidth } from './text';

/** The strip over every message she sends. */
const CAROLINE_LABEL = 'System AI message:';
/** What every message she sends opens with. */
export const CAROLINE_PREFIX = 'Caroline - ';
/** Played as a frame of hers opens over the game. */
export const CAROLINE_CHIME = 'caroline_message_chime' as const satisfies SoundId;

/** How far into her text the reveal has got. */
export interface CarolineReveal {
  /** Characters on screen, prefix included, the still-decoding ones among them. */
  readonly shown: number;
  /** How many of the last `shown` are still cycling random glyphs. */
  readonly decoding: number;
}

/** How far a frame has opened: the line across first, then the box down from it. Both 1 is fully open. */
export interface CarolineOpen {
  readonly across: number;
  readonly down: number;
}

export const CAROLINE_FULLY_OPEN: CarolineOpen = { across: 1, down: 1 };

/** Glyphs a decoding character cycles through: capitals, digits and terminal punctuation, never a letter-like accent. */
const SCRAMBLE_GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/\\|$@';
/** Large primes that spread a character's index and the scramble step across the glyph set. */
const SCRAMBLE_INDEX_PRIME = 73856093;
const SCRAMBLE_STEP_PRIME = 19349663;
/** The status dot breathes between this share of full strength and full. */
const DOT_DIM_SHARE = 0.35;
const FULL_TURN = Math.PI * 2;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;
const HALF = 0.5;
/** The block cursor is this share of the body text's size tall. */
const CURSOR_HEIGHT_SHARE = 0.9;
/** The bright line drawn as the frame opens, against its resting hairline. */
const OPENING_LINE_WIDTH = 2;
/** A toast keeps a longer message to this many lines; past that it ends in an ellipsis. */
const TOAST_MAX_LINES = 2;
/** Beside the label her text needs at least this share of a toast's width, or the label moves above it. */
const TOAST_MIN_TEXT_SHARE = 0.6;
/** A character cell, for the block cursor's width. */
const CURSOR_CELL = 'M';
const ELLIPSIS = '…';
/** Room past a measured run, so drawing it at exactly its own width never trips the ellipsis. */
const MEASURE_SLACK = 1;

function skinOf(theme: Theme): CarolineSkin {
  return skinsFor(theme).caroline;
}

/** The target with the terminal face in place of the UI face. */
function terminal(target: PaintTarget): PaintTarget {
  return { ctx: target.ctx, theme: terminalTheme(target.theme) };
}

/** How many characters a message of `message` reveals, the prefix included. */
export function carolineRevealLength(message: string): number {
  return CAROLINE_PREFIX.length + message.length;
}

/** Everything shown at once, nothing decoding: a finished line, or reduced motion. */
export function carolineSettled(message: string): CarolineReveal {
  const length = carolineRevealLength(message);
  return { shown: length, decoding: 0 };
}

/**
 * The reveal `elapsedMs` after `message` started: a character appears every
 * `characterMs` and scrambles for `decodeTail` more before it locks. Reduced
 * motion shows the whole line at once.
 */
export function carolineRevealAt(
  theme: Theme,
  message: string,
  elapsedMs: number,
  reducedMotion: boolean,
): CarolineReveal {
  const length = carolineRevealLength(message);
  if (reducedMotion) return { shown: length, decoding: 0 };
  const skin = skinOf(theme);
  const started = Math.max(0, Math.floor(elapsedMs / skin.characterMs) + 1);
  const shown = Math.min(length, started);
  const locked = Math.max(0, Math.min(length, started - skin.decodeTail));
  return { shown, decoding: shown - locked };
}

/** How long a frame takes to open, and to close. */
export function carolineOpenDurationMs(theme: Theme): number {
  const skin = skinOf(theme);
  return skin.lineDrawMs + skin.unfoldMs;
}

/** How far a frame has opened `sinceOpenMs` after it began. Reduced motion opens it at once. */
export function carolineOpenAt(
  theme: Theme,
  sinceOpenMs: number,
  reducedMotion: boolean,
): CarolineOpen {
  if (reducedMotion) return CAROLINE_FULLY_OPEN;
  const skin = skinOf(theme);
  const across = Math.max(0, Math.min(1, sinceOpenMs / skin.lineDrawMs));
  const down = Math.max(0, Math.min(1, (sinceOpenMs - skin.lineDrawMs) / skin.unfoldMs));
  return { across, down };
}

/** The open run backwards: how far a frame is still open `sinceCloseMs` after it began closing. */
export function carolineCloseAt(
  theme: Theme,
  sinceCloseMs: number,
  reducedMotion: boolean,
): CarolineOpen {
  if (reducedMotion) return { across: 0, down: 0 };
  return carolineOpenAt(theme, carolineOpenDurationMs(theme) - sinceCloseMs, false);
}

/** Half of a character outside the basic plane: scrambling it alone would split the character. */
function isSurrogate(unit: string): boolean {
  const code = unit.charCodeAt(0);
  return code >= SURROGATE_FIRST && code <= SURROGATE_LAST;
}

function scrambleGlyph(index: number, nowMs: number, skin: CarolineSkin): string {
  const step = Math.floor(nowMs / skin.scrambleStepMs);
  const hash = ((index * SCRAMBLE_INDEX_PRIME) ^ (step * SCRAMBLE_STEP_PRIME)) >>> 0;
  return SCRAMBLE_GLYPHS[hash % SCRAMBLE_GLYPHS.length];
}

function chamferPath(ctx: CanvasRenderingContext2D, r: Rect, chamfer: number): void {
  const cut = Math.min(chamfer, r.w * HALF, r.h * HALF);
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  ctx.beginPath();
  ctx.moveTo(r.x + cut, r.y);
  ctx.lineTo(right - cut, r.y);
  ctx.lineTo(right, r.y + cut);
  ctx.lineTo(right, bottom - cut);
  ctx.lineTo(right - cut, bottom);
  ctx.lineTo(r.x + cut, bottom);
  ctx.lineTo(r.x, bottom - cut);
  ctx.lineTo(r.x, r.y + cut);
  ctx.closePath();
}

/** The four heavier brackets that follow the chamfer round each corner. */
function strokeBrackets(ctx: CanvasRenderingContext2D, r: Rect, skin: CarolineSkin): void {
  const half = skin.bracketWidth * HALF;
  const box = inset(r, half);
  const cut = Math.min(skin.chamfer, box.w * HALF, box.h * HALF);
  const arm = Math.min(skin.bracketLength, box.w * HALF - cut, box.h * HALF - cut);
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  ctx.save();
  ctx.strokeStyle = skin.bracket;
  ctx.lineWidth = skin.bracketWidth;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + cut + arm);
  ctx.lineTo(box.x, box.y + cut);
  ctx.lineTo(box.x + cut, box.y);
  ctx.lineTo(box.x + cut + arm, box.y);
  ctx.moveTo(right - cut - arm, box.y);
  ctx.lineTo(right - cut, box.y);
  ctx.lineTo(right, box.y + cut);
  ctx.lineTo(right, box.y + cut + arm);
  ctx.moveTo(right, bottom - cut - arm);
  ctx.lineTo(right, bottom - cut);
  ctx.lineTo(right - cut, bottom);
  ctx.lineTo(right - cut - arm, bottom);
  ctx.moveTo(box.x + cut + arm, bottom);
  ctx.lineTo(box.x + cut, bottom);
  ctx.lineTo(box.x, bottom - cut);
  ctx.lineTo(box.x, bottom - cut - arm);
  ctx.stroke();
  ctx.restore();
}

export interface CarolineFrameOptions {
  readonly nowMs: number;
}

/** The frame alone: ground, grid, scanlines, hairline and brackets. */
export function paintCarolineFrame(
  target: PaintTarget,
  rect: Rect,
  opts: CarolineFrameOptions,
): void {
  const { ctx } = target;
  const skin = skinOf(target.theme);
  ctx.save();
  chamferPath(ctx, rect, skin.chamfer);
  ctx.fillStyle = skin.ground;
  ctx.fill();
  ctx.clip();

  ctx.beginPath();
  for (let x = rect.x + skin.gridStep; x < rect.x + rect.w; x += skin.gridStep) {
    ctx.moveTo(Math.round(x) + HALF, rect.y);
    ctx.lineTo(Math.round(x) + HALF, rect.y + rect.h);
  }
  for (let y = rect.y + skin.gridStep; y < rect.y + rect.h; y += skin.gridStep) {
    ctx.moveTo(rect.x, Math.round(y) + HALF);
    ctx.lineTo(rect.x + rect.w, Math.round(y) + HALF);
  }
  ctx.strokeStyle = skin.grid;
  ctx.lineWidth = skin.hairlineWidth;
  ctx.stroke();

  const drift = ((opts.nowMs % skin.scanlineDriftMs) / skin.scanlineDriftMs) * skin.scanlineStep;
  ctx.fillStyle = skin.scanline;
  for (let y = rect.y - skin.scanlineStep + drift; y < rect.y + rect.h; y += skin.scanlineStep) {
    ctx.fillRect(rect.x, y, rect.w, skin.hairlineWidth);
  }
  ctx.restore();

  ctx.save();
  chamferPath(ctx, inset(rect, skin.hairlineWidth * HALF), skin.chamfer);
  ctx.strokeStyle = skin.hairline;
  ctx.lineWidth = skin.hairlineWidth;
  ctx.stroke();
  ctx.restore();
  strokeBrackets(ctx, rect, skin);
}

/** Whether a frame has finished opening. */
export function carolineOpened(open: CarolineOpen): boolean {
  return open.across >= 1 && open.down >= 1;
}

/** The part of `rect` a frame shows so far: a centred band that widens, then grows tall. */
export function carolineOpenRect(rect: Rect, open: CarolineOpen): Rect {
  const width = rect.w * open.across;
  const height = rect.h * open.down;
  return {
    x: rect.x + (rect.w - width) * HALF,
    y: rect.y + (rect.h - height) * HALF,
    w: width,
    h: height,
  };
}

/** The bright line a frame draws out from, then unfolds along, while it opens. */
export function paintCarolineOpeningLine(
  target: PaintTarget,
  rect: Rect,
  open: CarolineOpen,
): void {
  if (carolineOpened(open)) return;
  const shown = carolineOpenRect(rect, open);
  if (shown.w <= 0) return;
  const { ctx } = target;
  const lineHalf = OPENING_LINE_WIDTH * HALF;
  ctx.save();
  ctx.fillStyle = skinOf(target.theme).bracket;
  ctx.fillRect(shown.x, shown.y - lineHalf, shown.w, OPENING_LINE_WIDTH);
  if (shown.h > 0) ctx.fillRect(shown.x, shown.y + shown.h - lineHalf, shown.w, OPENING_LINE_WIDTH);
  ctx.restore();
}

/** Runs `draw` clipped to how far the frame has opened over `rect`, after its opening line. */
export function withCarolineOpen(
  target: PaintTarget,
  rect: Rect,
  open: CarolineOpen,
  draw: () => void,
): void {
  if (carolineOpened(open)) {
    draw();
    return;
  }
  paintCarolineOpeningLine(target, rect, open);
  const shown = carolineOpenRect(rect, open);
  const { ctx } = target;
  ctx.save();
  ctx.beginPath();
  ctx.rect(shown.x, shown.y, shown.w, shown.h);
  ctx.clip();
  draw();
  ctx.restore();
}

/** The header strip's height: the label's line, a gap and the rule. */
export function carolineHeaderHeight(theme: Theme): number {
  const skin = skinOf(theme);
  return skin.label.style.lineHeight + theme.space.xs + skin.ruleWidth;
}

function paintDot(target: PaintTarget, centreX: number, centreY: number, nowMs: number): void {
  const { ctx } = target;
  const skin = skinOf(target.theme);
  const phase = (nowMs % skin.dotPulseMs) / skin.dotPulseMs;
  const breath = HALF + HALF * Math.cos(phase * FULL_TURN);
  const strength = DOT_DIM_SHARE + (1 - DOT_DIM_SHARE) * breath;
  ctx.save();
  ctx.fillStyle = withAlpha(skin.dot, strength);
  ctx.beginPath();
  ctx.arc(centreX, centreY, skin.dotSize * HALF, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** Width the dot and its gap take before the label. */
function dotSpan(theme: Theme): number {
  return skinOf(theme).dotSize + theme.space.sm;
}

function labelWidth(target: PaintTarget): number {
  return measureText(terminal(target), CAROLINE_LABEL, { style: skinOf(target.theme).label.style });
}

function paintLabel(target: PaintTarget, row: Rect, nowMs: number): void {
  const skin = skinOf(target.theme);
  paintDot(target, row.x + skin.dotSize * HALF, row.y + row.h * HALF, nowMs);
  text(
    terminal(target),
    { ...row, x: row.x + dotSpan(target.theme), w: Math.max(0, row.w - dotSpan(target.theme)) },
    { text: CAROLINE_LABEL, style: skin.label.style, color: skin.label.color },
  );
}

/** The "System AI message:" strip: pulsing dot, label, and the thin rule under it. */
export function carolineHeader(target: PaintTarget, rect: Rect, nowMs: number): void {
  const skin = skinOf(target.theme);
  paintLabel(target, { ...rect, h: skin.label.style.lineHeight }, nowMs);
  target.ctx.save();
  target.ctx.fillStyle = skin.rule;
  target.ctx.fillRect(rect.x, rect.y + rect.h - skin.ruleWidth, rect.w, skin.ruleWidth);
  target.ctx.restore();
}

/** One line of her text as laid out, with where it starts in the prefixed text. */
export interface CarolineLine {
  readonly text: string;
  readonly start: number;
}

function measureBody(target: PaintTarget, style: TypeStyle): (line: string) => number {
  const face = terminal(target);
  return (line) => measureText(face, line, { style });
}

/** `full` cut back until it fits `width` with an ellipsis after it. */
function withEllipsis(full: string, width: number, measure: (line: string) => number): string {
  let kept = full.trimEnd();
  while (kept.length > 0 && measure(`${kept}${ELLIPSIS}`) > width) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/**
 * Her text after the prefix, wrapped to `width` whole before any of it shows
 * so a word never jumps lines mid-reveal. Past `maxLines` the last kept line
 * ends in an ellipsis.
 */
export function layoutCarolineText(
  target: PaintTarget,
  width: number,
  message: string,
  maxLines?: number,
): CarolineLine[] {
  const skin = skinOf(target.theme);
  const measure = measureBody(target, skin.body.style);
  const full = `${CAROLINE_PREFIX}${message}`;
  const wrapped = wrapToWidth(full, width, measure);
  const kept = maxLines !== undefined && wrapped.length > maxLines;
  const lines = kept ? wrapped.slice(0, maxLines) : wrapped;
  if (kept && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = withEllipsis(lines[last], width, measure);
  }
  let searchFrom = 0;
  return lines.map((line) => {
    const found = full.indexOf(line, searchFrom);
    const start = found === -1 ? searchFrom : found;
    searchFrom = start + line.length;
    return { text: line, start };
  });
}

export interface CarolineLinesOptions {
  readonly reveal: CarolineReveal;
  readonly nowMs: number;
  /** Where the accent prefix ends in the laid-out text: `CAROLINE_PREFIX.length` on her first page, 0 after. */
  readonly prefixEnd: number;
  /** Characters in the whole page; the cursor blinks only once all of them are shown. */
  readonly total: number;
  /** The style the lines were laid out in. Defaults to the skin's body. */
  readonly style?: TypeStyle;
}

/**
 * Draws laid-out lines from `left`, `top` down: the prefix in the accent, the
 * rest near-white, the newest characters still scrambling, and a block cursor
 * after the last one shown, solid while typing and blinking once done.
 */
export function paintCarolineLines(
  target: PaintTarget,
  left: number,
  top: number,
  lines: readonly CarolineLine[],
  opts: CarolineLinesOptions,
): void {
  const skin = skinOf(target.theme);
  const style = opts.style ?? skin.body.style;
  const face = terminal(target);
  const measure = measureBody(target, style);
  const { shown, decoding } = opts.reveal;
  const lockedThrough = shown - decoding;
  let cursorAt: { x: number; middle: number } | null = null;

  for (const [index, line] of lines.entries()) {
    const visibleCount = Math.max(0, Math.min(line.text.length, shown - line.start));
    const rowTop = top + index * style.lineHeight;
    const middle = rowTop + style.lineHeight * HALF;
    if (visibleCount === 0) {
      if (index === 0) cursorAt = { x: left, middle };
      break;
    }
    let drawn = '';
    for (let offset = 0; offset < visibleCount; offset++) {
      const at = line.start + offset;
      const char = line.text[offset];
      const scrambling = at >= lockedThrough && char !== ' ' && !isSurrogate(char);
      drawn += scrambling ? scrambleGlyph(at, opts.nowMs, skin) : char;
    }
    const accentCount = Math.max(0, Math.min(drawn.length, opts.prefixEnd - line.start));
    const accent = drawn.slice(0, accentCount);
    const rest = drawn.slice(accentCount);
    const accentWidth = accent === '' ? 0 : measure(accent);
    const restWidth = rest === '' ? 0 : measure(rest);
    if (accent !== '') {
      text(
        face,
        { x: left, y: rowTop, w: accentWidth + MEASURE_SLACK, h: style.lineHeight },
        { text: accent, style, color: skin.prefix.color },
      );
    }
    if (rest !== '') {
      text(
        face,
        { x: left + accentWidth, y: rowTop, w: restWidth + MEASURE_SLACK, h: style.lineHeight },
        { text: rest, style, color: skin.body.color },
      );
    }
    cursorAt = { x: left + accentWidth + restWidth, middle };
  }

  const typing = shown < opts.total;
  const blinkOn = Math.floor(opts.nowMs / skin.cursorBlinkMs) % 2 === 0;
  if (cursorAt === null || (!typing && !blinkOn)) return;
  const cursor = cursorAt;
  const cellWidth = measure(CURSOR_CELL);
  const cursorHeight = style.size * CURSOR_HEIGHT_SHARE;
  const { ctx } = target;
  ctx.save();
  ctx.fillStyle = skin.cursor;
  ctx.fillRect(cursor.x, cursor.middle - cursorHeight * HALF, cellWidth, cursorHeight);
  ctx.restore();
}

/** What a message on one of her frames reads and how far along it is. */
export interface CarolineMessageView {
  readonly message: string;
  readonly reveal: CarolineReveal;
  readonly nowMs: number;
  readonly open: CarolineOpen;
}

export interface CarolineBoxOptions extends CarolineMessageView {
  /** Longer text ends in an ellipsis past this many lines. */
  readonly maxLines?: number;
}

function boxPadding(theme: Theme): number {
  return skinOf(theme).padding;
}

/** The body's top inside a box at `rect`, under the header strip. */
function boxBodyTop(theme: Theme, rect: Rect): number {
  return rect.y + boxPadding(theme) + carolineHeaderHeight(theme) + theme.space.sm;
}

/** The height a full box adds round its text: padding, the header strip and the gap under it. */
export function carolineBoxChromeHeight(theme: Theme): number {
  return boxPadding(theme) * 2 + carolineHeaderHeight(theme) + theme.space.sm;
}

/** One line of her text's height. */
export function carolineLineHeight(theme: Theme): number {
  return skinOf(theme).body.style.lineHeight;
}

/** The height a full box of `width` needs for `message`, chrome included. */
export function measureCarolineBox(
  target: PaintTarget,
  width: number,
  message: string,
  maxLines?: number,
): number {
  const { theme } = target;
  const padding = boxPadding(theme);
  const lines = layoutCarolineText(target, width - padding * 2, message, maxLines);
  return carolineBoxChromeHeight(theme) + lines.length * carolineLineHeight(theme);
}

/** The full box: frame, header strip and her decoding text. */
export function carolineBox(target: PaintTarget, rect: Rect, opts: CarolineBoxOptions): void {
  const { theme } = target;
  const padding = boxPadding(theme);
  const inner = inset(rect, padding);
  withCarolineOpen(target, rect, opts.open, () => {
    paintCarolineFrame(target, rect, { nowMs: opts.nowMs });
    carolineHeader(target, { ...inner, h: carolineHeaderHeight(theme) }, opts.nowMs);
    const lines = layoutCarolineText(target, inner.w, opts.message, opts.maxLines);
    paintCarolineLines(target, inner.x, boxBodyTop(theme, rect), lines, {
      reveal: opts.reveal,
      nowMs: opts.nowMs,
      prefixEnd: CAROLINE_PREFIX.length,
      total: carolineRevealLength(opts.message),
    });
  });
}

/** The space a box's body leaves under the header strip, for content laid under her text (reply buttons). */
export function carolineBoxBody(theme: Theme, rect: Rect): Rect {
  const top = boxBodyTop(theme, rect);
  const padding = boxPadding(theme);
  return {
    x: rect.x + padding,
    y: top,
    w: rect.w - padding * 2,
    h: rect.y + rect.h - padding - top,
  };
}

/** The label column's width in a toast: dot, label and the gap after it. */
function toastLabelSpan(target: PaintTarget): number {
  return dotSpan(target.theme) + labelWidth(target) + target.theme.space.md;
}

/**
 * A toast laid out once for its message and the width it may take; measure
 * with it and draw with it, so the drawn toast is exactly the measured one.
 */
export interface CarolineToastLayout {
  readonly message: string;
  /** The label sits on its own row over her text, where beside it would leave her text too little room. */
  readonly stacked: boolean;
  readonly labelSpan: number;
  readonly lines: readonly CarolineLine[];
  readonly textWidth: number;
  readonly w: number;
  readonly h: number;
}

/** Lays a toast out for `message` within `maxWidth`; its `w` and `h` are the size it draws at. */
export function layoutCarolineToast(
  target: PaintTarget,
  maxWidth: number,
  message: string,
): CarolineToastLayout {
  const skin = skinOf(target.theme);
  const padding = skin.paddingCompact;
  const inner = Math.max(0, maxWidth - padding * 2);
  const labelSpan = toastLabelSpan(target);
  const stacked = inner - labelSpan < inner * TOAST_MIN_TEXT_SHARE;
  const room = stacked ? inner : inner - labelSpan;
  const lines = layoutCarolineText(target, room, message, TOAST_MAX_LINES);
  const measure = measureBody(target, skin.body.style);
  const widest = Math.max(...lines.map((line) => measure(line.text)));
  const textWidth = Math.min(room, widest + measure(CURSOR_CELL));
  const bodyHeight = lines.length * skin.body.style.lineHeight;
  const labelRow = skin.label.style.lineHeight + target.theme.space.xs;
  const contentWidth = stacked ? Math.max(textWidth, labelSpan) : labelSpan + textWidth;
  return {
    message,
    stacked,
    labelSpan,
    lines,
    textWidth,
    w: padding * 2 + contentWidth,
    h: padding * 2 + bodyHeight + (stacked ? labelRow : 0),
  };
}

/**
 * The compact toast: the label inline on the left with her text beside it,
 * or on its own row above her text where the row is too narrow for both.
 */
export function carolineToast(
  target: PaintTarget,
  at: { readonly x: number; readonly y: number },
  laid: CarolineToastLayout,
  opts: Omit<CarolineMessageView, 'message'>,
): void {
  const skin = skinOf(target.theme);
  const rect: Rect = { x: at.x, y: at.y, w: laid.w, h: laid.h };
  const inner = inset(rect, skin.paddingCompact);
  withCarolineOpen(target, rect, opts.open, () => {
    paintCarolineFrame(target, rect, { nowMs: opts.nowMs });
    const { ctx } = target;
    const lineHeight = skin.body.style.lineHeight;
    const labelRowHeight = laid.stacked ? skin.label.style.lineHeight : lineHeight;
    paintLabel(
      target,
      { x: inner.x, y: inner.y, w: laid.labelSpan, h: labelRowHeight },
      opts.nowMs,
    );
    ctx.save();
    ctx.fillStyle = skin.rule;
    if (laid.stacked) {
      const ruleY = inner.y + labelRowHeight + target.theme.space.xxs;
      ctx.fillRect(inner.x, ruleY, inner.w, skin.ruleWidth);
    } else {
      const ruleX = inner.x + laid.labelSpan - target.theme.space.sm;
      ctx.fillRect(ruleX, inner.y, skin.ruleWidth, inner.h);
    }
    ctx.restore();
    const textLeft = laid.stacked ? inner.x : inner.x + laid.labelSpan;
    const textTop = laid.stacked ? inner.y + labelRowHeight + target.theme.space.xs : inner.y;
    paintCarolineLines(target, textLeft, textTop, laid.lines, {
      reveal: opts.reveal,
      nowMs: opts.nowMs,
      prefixEnd: CAROLINE_PREFIX.length,
      total: carolineRevealLength(laid.message),
    });
  });
}
