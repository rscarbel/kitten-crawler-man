/**
 * Sound captions: a short line for each sound that carries gameplay
 * information the screen does not show at that moment — an alarm, a cry from
 * off camera, a trap going off. Which sounds those are is each id's `caption`
 * trait (`src/audio/soundTraits.ts`); a cue placed in the world gets a chevron
 * pointing from the middle of the screen toward where it came from.
 *
 * At most {@link MAX_CAPTION_LINES} lines show, newest at the bottom. The same
 * line heard again while it is up merges into it ("Goblin snarls ×3") rather
 * than stacking. Lines age by update tick, like the toasts, and take no input.
 * They are posted from the cue itself, never from what the speakers carry, so
 * they show whatever the volume or mute state.
 */

import type { PlayedCue } from '../../audio/AudioManager';
import { soundTraits } from '../../audio/soundTraits';
import { isPointInWorldView, type VisibleWorldView } from '../../core/visibleWorldView';
import type { Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor, type TextRole } from '../theme/skins';
import { motion } from '../theme/tokens';
import { drawGlass } from '../widgets/paint';
import { lineHeightOf, measureText, text } from '../widgets/text';

const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

function msToTicks(ms: number): number {
  return Math.max(1, Math.round((ms * TICKS_PER_SECOND) / MS_PER_SECOND));
}

/** The most lines the lane shows; an older line gives way to a new one. */
export const MAX_CAPTION_LINES = 3;
/** How long a line stays up after its sound was last heard, fade included. */
export const CAPTION_DISPLAY_TICKS = msToTicks(motion.captionDisplay);
const CAPTION_ENTER_TICKS = msToTicks(motion.base);
const CAPTION_FADE_TICKS = msToTicks(motion.slow);
const EASE_OUT_POWER = 3;
const CAPTION_ROLE: TextRole = 'label';
/** A merged line reads "Goblin snarls ×3". */
const REPEAT_MARK = '×';

/** One caption line as the lane draws it. */
export interface CaptionLine {
  readonly text: string;
  /** How many times the sound was heard while the line was up. */
  readonly count: number;
  /**
   * Which way the sound came from, as an angle in radians from the middle of
   * the screen (0 is right, a quarter turn is down); null for a sound with
   * no place in the world.
   */
  readonly direction: number | null;
  /** Ticks since the line first appeared. */
  readonly age: number;
  readonly ticksLeft: number;
}

/** What a heard cue posts: its words and where it points. */
export interface HeardCaption {
  readonly text: string;
  readonly direction: number | null;
}

interface MutableLine {
  text: string;
  count: number;
  direction: number | null;
  age: number;
  ticksLeft: number;
}

/** The angle from the middle of `view` toward `point`, in screen terms. */
function directionFrom(view: VisibleWorldView, point: { readonly x: number; readonly y: number }) {
  const centreX = view.left + view.width / 2;
  const centreY = view.top + view.height / 2;
  return Math.atan2(point.y - centreY, point.x - centreX);
}

/**
 * The caption `cue` posts with the camera showing `view`, or null when it
 * posts none: the id has no caption, or its caption is for off-screen sounds
 * and this one came from somewhere the player can see. A cue with no place
 * cannot be judged off screen, so an `offscreen` caption needs a placed cue.
 */
export function captionForCue(cue: PlayedCue, view: VisibleWorldView | null): HeardCaption | null {
  const caption = soundTraits(cue.id).caption;
  if (caption === null) return null;
  const source = cue.source;
  if (caption.when === 'offscreen') {
    if (source === null) return null;
    if (isPointInWorldView(view, source.x, source.y, 0)) return null;
  }
  const direction = source === null || view === null ? null : directionFrom(view, source);
  return { text: caption.text, direction };
}

/**
 * A caption for something said or done at `point` rather than a sound — a
 * room's reaction, narration — pointing toward it when there is a `view` to
 * judge from. Posted whatever the captions setting, since nothing else on
 * screen carries the words.
 */
export function captionToward(
  text: string,
  point: { readonly x: number; readonly y: number },
  view: VisibleWorldView | null,
): HeardCaption {
  return { text, direction: view === null ? null : directionFrom(view, point) };
}

/** The caption lane a scene's HUD draws, fed by the cues its audio plays. */
export class SoundCaptions {
  private lines: MutableLine[] = [];

  /** The lines up, oldest first. */
  get shown(): readonly CaptionLine[] {
    return this.lines;
  }

  get isShowing(): boolean {
    return this.lines.length > 0;
  }

  /** Posts `heard`, merging into a line already up with the same words. */
  post(heard: HeardCaption): void {
    const index = this.lines.findIndex((line) => line.text === heard.text);
    const existing = index === -1 ? null : this.lines[index];
    if (existing !== null) {
      this.lines.splice(index, 1);
      existing.count++;
      existing.direction = heard.direction;
      existing.ticksLeft = CAPTION_DISPLAY_TICKS;
      this.lines.push(existing);
      return;
    }
    this.lines.push({
      text: heard.text,
      count: 1,
      direction: heard.direction,
      age: 0,
      ticksLeft: CAPTION_DISPLAY_TICKS,
    });
    if (this.lines.length > MAX_CAPTION_LINES) this.lines.shift();
  }

  /** Posts the caption `cue` carries, if any, judged against `view`. */
  hear(cue: PlayedCue, view: VisibleWorldView | null): void {
    const heard = captionForCue(cue, view);
    if (heard !== null) this.post(heard);
  }

  /** Call once per game tick. */
  update(): void {
    for (const line of this.lines) {
      line.age++;
      line.ticksLeft--;
    }
    this.lines = this.lines.filter((line) => line.ticksLeft > 0);
  }

  /** Drops every line, for scene teardown. */
  clear(): void {
    this.lines = [];
  }
}

/**
 * Feeds every cue `audio` plays into `captions` while `enabled()` holds,
 * judged against the camera `view()` returns at that moment. Returns the
 * unsubscribe.
 */
export function listenForCaptions(
  audio: { onCuePlayed(listener: (cue: PlayedCue) => void): () => void },
  captions: SoundCaptions,
  view: () => VisibleWorldView | null,
  enabled: () => boolean,
): () => void {
  return audio.onCuePlayed((cue) => {
    if (enabled()) captions.hear(cue, view());
  });
}

/** Where the lane stacks from: its bottom edge, its start and how it aligns there. */
export interface CaptionAnchor {
  /** The lane's left edge when `align` is `left`; its middle when `center`. */
  readonly x: number;
  readonly bottom: number;
  readonly maxWidth: number;
  readonly align: 'left' | 'center';
}

function easeOut(linear: number): number {
  return 1 - Math.pow(1 - linear, EASE_OUT_POWER);
}

function lineLabel(line: CaptionLine): string {
  return line.count > 1 ? `${line.text} ${REPEAT_MARK}${line.count}` : line.text;
}

/** Turns a right-pointing chevron toward `direction` about the middle of `box`. */
function drawChevron(ui: Ui, box: Rect, direction: number, color: string): void {
  const { ctx } = ui;
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate(direction);
  drawGlyph(ctx, 'chevronRight', { x: -box.w / 2, y: -box.h / 2, w: box.w, h: box.h }, { color });
  ctx.restore();
}

/**
 * Draws the lines up on `captions`, newest at `anchor.bottom` and older ones
 * above, none reaching above `ceiling`. A line that would is left out, with
 * every older one above it.
 */
export function renderCaptions(
  ui: Ui,
  captions: SoundCaptions,
  anchor: CaptionAnchor,
  ceiling = -Infinity,
): void {
  const shown = captions.shown;
  if (shown.length === 0 || anchor.maxWidth <= 0) return;
  const { theme, ctx } = ui;
  const skin = skinsFor(theme).panel.caption;
  const padX = theme.space.sm;
  const padY = theme.space.xs;
  const gap = theme.space.xs;
  const icon = theme.size.icon;
  const lineH = lineHeightOf(ui, CAPTION_ROLE);
  const plateH = Math.max(lineH, icon) + padY * 2;
  const color = theme.palette.text.primary;
  let bottom = anchor.bottom;
  for (let index = shown.length - 1; index >= 0; index--) {
    const line = shown[index];
    const top = bottom - plateH;
    if (top < ceiling) return;
    const label = lineLabel(line);
    const chevronW = line.direction === null ? 0 : icon + gap;
    const room = Math.max(0, anchor.maxWidth - padX * 2 - chevronW);
    const textW = Math.min(Math.ceil(measureText(ui, label, { role: CAPTION_ROLE })), room);
    const plateW = padX * 2 + chevronW + textW;
    const restX = anchor.align === 'left' ? anchor.x : anchor.x - plateW / 2;
    const enter = easeOut(Math.min(1, line.age / CAPTION_ENTER_TICKS));
    const fade = line.ticksLeft < CAPTION_FADE_TICKS ? line.ticksLeft / CAPTION_FADE_TICKS : 1;
    const alpha = Math.max(0, enter * fade);
    const slide = (1 - enter) * theme.space.md;
    const plate: Rect =
      anchor.align === 'left'
        ? { x: restX - slide, y: top, w: plateW, h: plateH }
        : { x: restX, y: top + slide, w: plateW, h: plateH };
    if (alpha > 0) {
      ctx.save();
      ctx.globalAlpha *= alpha;
      drawGlass(ui, plate, skin);
      let textX = plate.x + padX;
      if (line.direction !== null) {
        const box: Rect = { x: textX, y: plate.y + (plate.h - icon) / 2, w: icon, h: icon };
        drawChevron(ui, box, line.direction, theme.palette.accent.base);
        textX += chevronW;
      }
      text(
        ui,
        { x: textX, y: plate.y, w: textW, h: plate.h },
        { text: label, role: CAPTION_ROLE, color },
      );
      ctx.restore();
    }
    bottom = top - gap;
  }
}
