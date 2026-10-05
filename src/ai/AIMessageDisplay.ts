// Renders transient System AI messages using the shared DialogBox component.
import { DialogBox, type ResolvedSpeaker } from '../ui/DialogBox';
import type { AudioManager } from '../audio/AudioManager';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { resolveSpeaker } from '../dialog/speakers';
import { chromeTarget } from '../ui/screens/dialogs/canvasChrome';
import { withAlpha } from '../ui/theme/color';
import { drawGlyph } from '../ui/theme/glyphs';
import { fillRounded, strokeRounded } from '../ui/widgets/paint';
import { measureText, text } from '../ui/widgets/text';

const SYSTEM_AI_NAME = 'System AI';

const SYSTEM_AI_SPEAKER: ResolvedSpeaker = resolveSpeaker({
  kind: 'transient',
  name: SYSTEM_AI_NAME,
  style: 'system',
});

interface AIMessage {
  text: string;
  ttl: number;
}

const MIN_DISPLAY_TICKS = 560;
const TICKS_PER_WORD = 15; // ~4 words/sec reading pace at 60fps
const FADE_TICKS = 60;

const ACTION_DISPLAY_TICKS = 210; // 3.5 seconds at 60 fps
const ACTION_FADE_TICKS = 45;

const MAX_ACTIONNOTIFS = 3;
const PADDING_BOTTOM = 20;
const ACTION_PADDING = 8;
const ACTION_BORDER_WIDTH = 1;
const ACTION_BORDER_ALPHA = 0.7;
const ACTION_GLYPH_SIZE = 14;

function calcTtl(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(MIN_DISPLAY_TICKS, words * TICKS_PER_WORD);
}

export class AIMessageDisplay {
  private messages: AIMessage[] = [];
  private actionNotifs: AIMessage[] = [];
  private _dialogBox: DialogBox | null = null;

  /** Wire in audio to enable the DialogBox typing animation for incoming messages. */
  setAudio(audio: AudioManager): void {
    this._dialogBox = new DialogBox(audio, { showFooterHint: false });
  }

  add(text: string): void {
    const ttl = calcTtl(text);
    // New message immediately replaces any existing ones
    this.messages = [{ text, ttl }];
    this._dialogBox?.show([text], SYSTEM_AI_SPEAKER, {
      questRelated: false,
      pageIndicator: () => null,
    });
  }

  addAction(text: string): void {
    this.actionNotifs.push({ text, ttl: ACTION_DISPLAY_TICKS });
    if (this.actionNotifs.length > MAX_ACTIONNOTIFS) {
      this.actionNotifs.shift();
    }
  }

  update(): void {
    this.messages = this.messages.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
    if (this.messages.length === 0) {
      this._dialogBox?.hide();
    }
    this._dialogBox?.update();
    this.actionNotifs = this.actionNotifs.filter((m) => {
      m.ttl--;
      return m.ttl > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const lastMsg = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    const alpha = lastMsg !== null && lastMsg.ttl < FADE_TICKS ? lastMsg.ttl / FADE_TICKS : 1;
    this._dialogBox?.render(ctx, alpha);

    if (this.actionNotifs.length > 0) {
      const notif = this.actionNotifs[this.actionNotifs.length - 1];
      const actionAlpha = notif.ttl < ACTION_FADE_TICKS ? notif.ttl / ACTION_FADE_TICKS : 1;
      this.renderActionPill(ctx, notif.text, actionAlpha);
    }
  }

  /** The one-line pill along the bottom naming what the System AI just did. */
  private renderActionPill(ctx: CanvasRenderingContext2D, message: string, alpha: number): void {
    const target = chromeTarget(ctx);
    const { palette, radius, space, type } = target.theme;
    const labelWidth = measureText(target, SYSTEM_AI_NAME, { role: 'accent' });
    const pillChromeWidth = ACTION_PADDING * 2 + ACTION_GLYPH_SIZE + space.xs + space.sm;
    const maxTextWidth = viewportWidth() - PADDING_BOTTOM * 2 - labelWidth - pillChromeWidth;
    const textWidth = Math.max(
      0,
      Math.min(maxTextWidth, measureText(target, message, { role: 'caption' })),
    );
    const pillH = type.label.lineHeight + ACTION_PADDING * 2;
    const pillW = pillChromeWidth + labelWidth + textWidth;
    const pill = {
      x: Math.round((viewportWidth() - pillW) / 2),
      y: viewportHeight() - pillH - PADDING_BOTTOM,
      w: pillW,
      h: pillH,
    };

    ctx.save();
    ctx.globalAlpha *= alpha;
    fillRounded(ctx, pill, radius.pill, palette.surface.base);
    strokeRounded(
      ctx,
      pill,
      radius.pill,
      withAlpha(palette.accent.base, ACTION_BORDER_ALPHA),
      ACTION_BORDER_WIDTH,
    );
    let cursorX = pill.x + ACTION_PADDING;
    drawGlyph(
      ctx,
      'settings',
      {
        x: cursorX,
        y: pill.y + (pill.h - ACTION_GLYPH_SIZE) / 2,
        w: ACTION_GLYPH_SIZE,
        h: ACTION_GLYPH_SIZE,
      },
      { color: palette.accent.base },
    );
    cursorX += ACTION_GLYPH_SIZE + space.xs;
    text(
      target,
      { x: cursorX, y: pill.y, w: labelWidth, h: pill.h },
      { text: SYSTEM_AI_NAME, role: 'accent' },
    );
    cursorX += labelWidth + space.sm;
    text(
      target,
      { x: cursorX, y: pill.y, w: textWidth, h: pill.h },
      { text: message, role: 'caption', color: palette.text.primary },
    );
    ctx.restore();
  }
}
