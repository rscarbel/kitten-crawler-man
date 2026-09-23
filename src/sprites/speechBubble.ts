/**
 * World-space speech bubbles above an NPC's head.
 *
 * Lifted out of `mordecaiSprite` once the Bopca needed the same shape with words
 * in it: two callers, one drawing routine, and the tail geometry is fiddly enough
 * that a second copy would have drifted.
 */

import { drawText, measureTextBox } from '../ui/TextBox';
import { drawBox } from '../ui/Box';

const BUBBLE_PULSE_RATE = 0.12;
const BUBBLE_ALPHA_BASE = 0.7;
const BUBBLE_ALPHA_SWING = 0.3;

// "..." bubble geometry, as fractions of the tile size.
const DOTS_BUBBLE_LEFT = 0.18;
const DOTS_BUBBLE_TOP = -0.52;
const DOTS_BUBBLE_WIDTH = 0.64;
const DOTS_BUBBLE_HEIGHT = 0.35;
const DOTS_BUBBLE_RADIUS = 0.06;
const DOTS_TAIL_INSET = 0.1;
const DOTS_TAIL_DROP = 0.15;
const DOTS_TAIL_LEFT = 0.12;
const DOTS_TAIL_RIGHT = 0.22;
const DOT_COUNT = 3;
const DOT_START_FRACTION = 0.28;
const DOT_STEP_FRACTION = 0.22;
const DOT_RADIUS = 0.04;

// Text bubble geometry, in pixels except where noted.
const TEXT_SIZE = 10;
const TEXT_LINE_HEIGHT = 13;
const TEXT_PADDING = 6;
const TEXT_MAX_WIDTH_TILES = 5.5;
const TEXT_BUBBLE_RADIUS = 4;
const TEXT_TAIL_HALF_WIDTH = 5;
const TEXT_TAIL_DROP = 7;
/** Gap between the bubble's bottom edge and the anchor point it points at. */
const TEXT_BUBBLE_GAP = 4;
/** Mean glyph width as a fraction of font size, for the sans-serif UI face. */
const AVERAGE_GLYPH_WIDTH_RATIO = 0.55;

const BUBBLE_FILL = '#ffffff';
const BUBBLE_DOTS = '#334155';
const BUBBLE_TEXT = '#1e293b';

/** Draws a rounded rect with a downward-left tail, in already-camera-offset space. */
function bubblePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  tailCentreX: number,
  tailHalfWidth: number,
  tailDrop: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(tailCentreX + tailHalfWidth, y + h);
  ctx.lineTo(tailCentreX, y + h + tailDrop);
  ctx.lineTo(tailCentreX - tailHalfWidth, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * The wordless "…" bubble that appears over an NPC the player can talk to.
 *
 * @param sx Screen-x of the NPC's tile origin.
 * @param sy Screen-y of the NPC's tile origin.
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pulse: number,
): void {
  ctx.save();
  ctx.globalAlpha = BUBBLE_ALPHA_BASE + Math.sin(pulse * BUBBLE_PULSE_RATE) * BUBBLE_ALPHA_SWING;

  const bx = sx + s * DOTS_BUBBLE_LEFT;
  const by = sy + s * DOTS_BUBBLE_TOP;
  const bw = s * DOTS_BUBBLE_WIDTH;
  const bh = s * DOTS_BUBBLE_HEIGHT;

  ctx.fillStyle = BUBBLE_FILL;
  ctx.beginPath();
  ctx.moveTo(bx + s * DOTS_BUBBLE_RADIUS, by);
  ctx.lineTo(bx + bw - s * DOTS_BUBBLE_RADIUS, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + s * DOTS_BUBBLE_RADIUS);
  ctx.lineTo(bx + bw, by + bh - s * DOTS_BUBBLE_RADIUS);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - s * DOTS_BUBBLE_RADIUS, by + bh);
  ctx.lineTo(bx + s * (DOTS_BUBBLE_RADIUS + DOTS_TAIL_INSET), by + bh);
  ctx.lineTo(bx + s * DOTS_TAIL_LEFT, by + bh + s * DOTS_TAIL_DROP);
  ctx.lineTo(bx + s * (DOTS_BUBBLE_RADIUS + DOTS_TAIL_RIGHT), by + bh);
  ctx.lineTo(bx + s * DOTS_BUBBLE_RADIUS, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - s * DOTS_BUBBLE_RADIUS);
  ctx.lineTo(bx, by + s * DOTS_BUBBLE_RADIUS);
  ctx.quadraticCurveTo(bx, by, bx + s * DOTS_BUBBLE_RADIUS, by);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = BUBBLE_DOTS;
  const dotY = by + bh * 0.5;
  for (let i = 0; i < DOT_COUNT; i++) {
    ctx.beginPath();
    ctx.arc(
      bx + bw * (DOT_START_FRACTION + i * DOT_STEP_FRACTION),
      dotY,
      s * DOT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}

/**
 * A bubble with a line of dialog in it, centred over `anchorX` and pointing down
 * at `anchorY`. Used for lines an NPC says unprompted, where opening the whole
 * dialog box would be far too heavy.
 */
export function drawSpeechBubbleWithText(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  s: number,
  text: string,
): void {
  // Sized from an average glyph width rather than `measureText`: the bubble is
  // drawn every frame a bark is up, and the font is fixed, so a measurement per
  // frame buys nothing that a slightly generous box does not.
  const textWidth = text.length * TEXT_SIZE * AVERAGE_GLYPH_WIDTH_RATIO;
  const boxWidth = Math.min(s * TEXT_MAX_WIDTH_TILES, textWidth + TEXT_PADDING * 2);
  const lineCount = Math.max(1, Math.ceil(textWidth / (boxWidth - TEXT_PADDING * 2)));
  const boxHeight = lineCount * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;
  const boxX = anchorX - boxWidth / 2;
  const boxY = anchorY - boxHeight - TEXT_TAIL_DROP - TEXT_BUBBLE_GAP;

  ctx.save();
  ctx.fillStyle = BUBBLE_FILL;
  bubblePath(
    ctx,
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    TEXT_BUBBLE_RADIUS,
    anchorX,
    TEXT_TAIL_HALF_WIDTH,
    TEXT_TAIL_DROP,
  );
  ctx.fill();
  ctx.restore();

  drawText(ctx, text, {
    x: boxX + TEXT_PADDING,
    y: boxY + TEXT_PADDING,
    size: TEXT_SIZE,
    color: BUBBLE_TEXT,
    width: boxWidth - TEXT_PADDING * 2,
    lineHeight: TEXT_LINE_HEIGHT,
  });
}

/** How long a timed line stays up, in frames, unless the speaker asks for longer. */
export const SPEECH_DURATION_FRAMES = 150;
/** The last stretch of a timed line fades out rather than vanishing mid-read. */
const TIMED_FADE_FRAMES = 30;

/**
 * A line a character says over their head for a while and then drops — a
 * crawler calling her pet, a hireling's bark. The state half of a timed
 * bubble; {@link drawTimedSpeechBubble} is the drawing half.
 *
 * Frames rather than wall-clock, so a line said just before the pause menu is
 * still up when the game resumes.
 */
export class TimedSpeech {
  private text: string | null = null;
  private italic = false;
  private framesLeft = 0;
  private duration = SPEECH_DURATION_FRAMES;

  /**
   * @param options.italic Set for narration — what a character does rather
   *   than says — so it reads as a stage direction, not a line.
   */
  say(text: string, options?: { durationFrames?: number; italic?: boolean }): void {
    this.text = text;
    this.italic = options?.italic ?? false;
    this.duration = options?.durationFrames ?? SPEECH_DURATION_FRAMES;
    this.framesLeft = this.duration;
  }

  tick(): void {
    if (this.framesLeft > 0) this.framesLeft--;
    if (this.framesLeft <= 0) this.text = null;
  }

  clear(): void {
    this.text = null;
    this.framesLeft = 0;
  }

  /** The line on screen, or null when nothing is being said. */
  get current(): string | null {
    return this.framesLeft > 0 ? this.text : null;
  }

  get isItalic(): boolean {
    return this.italic;
  }

  /** Opacity for this frame: full until the fade-out stretch at the end of the line. */
  get alpha(): number {
    return Math.min(1, this.framesLeft / Math.min(TIMED_FADE_FRAMES, this.duration));
  }
}

const TIMED_FONT_SIZE = 11;
const TIMED_LINE_HEIGHT = 14;
/** Wide enough for a short sentence on one line, narrow enough to wrap a long one. */
const TIMED_MAX_TEXT_WIDTH = 200;
const TIMED_PADDING_X = 8;
const TIMED_PADDING_Y = 4;
/** Centres the glyphs vertically inside their line box. */
const TIMED_GLYPH_INSET = (TIMED_LINE_HEIGHT - TIMED_FONT_SIZE) / 2;
const TIMED_CORNER_RADIUS = 6;
const TIMED_BG_ALPHA = 0.8;
const TIMED_BORDER_WIDTH = 1;
const TIMED_POINTER_HALF_WIDTH = 5;
const TIMED_POINTER_HEIGHT = 6;

export interface TimedBubbleStyle {
  /** Border colour: tells the speakers apart when two talk at once. */
  readonly border: string;
  readonly text: string;
}

/** The cat's calls to Mongo: a cool blue, the colour of her own UI. */
export const CAT_SPEECH_STYLE: TimedBubbleStyle = { border: '#60a5fa', text: '#e0f2fe' };

/**
 * Draws a {@link TimedSpeech} line in a dark rounded box with a pointer at its
 * speaker, word-wrapped when it runs long.
 *
 * @param anchorX Screen-x the pointer aims at — the speaker's centre.
 * @param headY Screen-y the pointer's tip touches — the top of the speaker's head.
 */
export function drawTimedSpeechBubble(
  ctx: CanvasRenderingContext2D,
  speech: TimedSpeech,
  anchorX: number,
  headY: number,
  style: TimedBubbleStyle,
): void {
  const text = speech.current;
  if (text === null) return;
  const alpha = speech.alpha;
  const italic = speech.isItalic;

  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}bold ${TIMED_FONT_SIZE}px monospace`;
  const singleLineWidth = ctx.measureText(text).width;
  ctx.restore();
  const textWidth = Math.min(singleLineWidth, TIMED_MAX_TEXT_WIDTH);
  const { lineCount } = measureTextBox(ctx, text, {
    size: TIMED_FONT_SIZE,
    bold: true,
    italic,
    width: textWidth,
    lineHeight: TIMED_LINE_HEIGHT,
  });

  const boxWidth = textWidth + TIMED_PADDING_X * 2;
  const boxHeight = lineCount * TIMED_LINE_HEIGHT + TIMED_PADDING_Y * 2;
  const boxX = anchorX - boxWidth / 2;
  const boxBottom = headY - TIMED_POINTER_HEIGHT;
  const boxY = boxBottom - boxHeight;
  const fill = `rgba(0,0,0,${TIMED_BG_ALPHA})`;

  ctx.save();
  ctx.globalAlpha = alpha;
  drawBox(ctx, {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    fill,
    border: style.border,
    borderWidth: TIMED_BORDER_WIDTH,
    radius: TIMED_CORNER_RADIUS,
    // drawBox sets its own globalAlpha, so the fade has to be handed to it.
    alpha,
  });
  // The pointer is the one part with no utility for it: a triangle hanging off
  // one edge of a box is not a box.
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(anchorX - TIMED_POINTER_HALF_WIDTH, boxBottom);
  ctx.lineTo(anchorX, boxBottom + TIMED_POINTER_HEIGHT);
  ctx.lineTo(anchorX + TIMED_POINTER_HALF_WIDTH, boxBottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawText(ctx, text, {
    x: boxX + TIMED_PADDING_X,
    y: boxY + TIMED_PADDING_Y + TIMED_GLYPH_INSET,
    width: textWidth,
    size: TIMED_FONT_SIZE,
    lineHeight: TIMED_LINE_HEIGHT,
    bold: true,
    italic,
    color: style.text,
    align: 'center',
    alpha,
  });
}
