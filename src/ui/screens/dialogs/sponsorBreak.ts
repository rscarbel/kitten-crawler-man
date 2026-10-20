/**
 * A word from our sponsors: the show's AI cuts away for a fake advert, in the
 * same typed terminal voice the System uses on the title screen. Short and
 * skippable — any tap, Space, Enter or Escape ends it, and it ends itself once
 * the line has been typed and held a moment. The world halts while it runs,
 * so an advert never costs the party a hit; the AI only runs one away from a
 * fight.
 */

import type { Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { ACTIVATE_KEYS } from '../../core/UiRoot';
import { skinsFor } from '../../theme/skins';
import { terminalTheme } from '../../theme/terminalTheme';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModal } from '../../widgets/choiceModal';
import { panelBodyWidth } from '../../widgets/panel';
import type { PaintTarget } from '../../widgets/paint';
import { measureText, text, wrapToWidth } from '../../widgets/text';

/** A sponsor break on screen. */
export interface SponsorBreakView {
  readonly sponsor: string;
  readonly message: string;
}

/** What the break reads and drives. */
export interface SponsorBreakSource {
  readonly sponsorBreak: SponsorBreakView | null;
  /** The break came off the screen; `skipped` when the player cut it short. */
  endSponsorBreak(skipped: boolean): void;
}

const BREAK_WIDTH: PanelWidth = 'sm';
/** The title screen's machine pace. */
export const SPONSOR_TYPE_MS_PER_CHARACTER = 28;
/** The typed line stays up this long before the break ends itself. */
const SPONSOR_HOLD_MS = 2500;
const SPONSOR_MIN_MS = 4000;
const SPONSOR_MAX_MS = 10000;
const CARET = '_';
const CARET_BLINK_MS = 530;
const OVERLINE = 'A word from our sponsor';

/** How long a break with `message` stays up unless skipped. */
export function sponsorBreakDurationMs(message: string): number {
  const typed = message.length * SPONSOR_TYPE_MS_PER_CHARACTER;
  return Math.max(SPONSOR_MIN_MS, Math.min(SPONSOR_MAX_MS, typed + SPONSOR_HOLD_MS));
}

function typedMessagePart(
  ui: Ui,
  message: string,
  elapsedMs: number,
): { readonly height: number; readonly draw: (rect: Rect) => void } {
  const skin = skinsFor(ui.theme).systemAi;
  const { style } = skin.text;
  const target: PaintTarget = { ctx: ui.ctx, theme: terminalTheme(ui.theme) };
  const width = panelBodyWidth(ui, BREAK_WIDTH);
  const measure = (line: string): number => measureText(target, line, { style });
  // Laid out whole before any of it shows, so a word never jumps to the next line mid-type.
  const lines = wrapToWidth(message, width, measure);
  const typedCount = Math.floor(elapsedMs / SPONSOR_TYPE_MS_PER_CHARACTER);
  const caretOn = Math.floor(elapsedMs / CARET_BLINK_MS) % 2 === 0;
  return {
    height: lines.length * style.lineHeight,
    draw: (rect) => {
      let remaining = typedCount;
      lines.forEach((line, index) => {
        if (remaining <= 0 && index > 0) return;
        const visible = line.slice(0, Math.max(0, remaining));
        remaining -= line.length;
        const typingHere = remaining <= 0 || index === lines.length - 1;
        text(
          target,
          { x: rect.x, y: rect.y + index * style.lineHeight, w: rect.w, h: style.lineHeight },
          {
            text: typingHere && caretOn ? `${visible}${CARET}` : visible,
            style,
            color: skin.text.color,
            halo: skin.halo,
            align: 'center',
          },
        );
      });
    },
  };
}

export function sponsorBreakSurface(id: string, source: SponsorBreakSource): Surface {
  const skip = (): void => source.endSponsorBreak(true);
  return {
    id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => source.sponsorBreak !== null,
    close: skip,
    onKey: (key, mods) => {
      if (!ACTIVATE_KEYS.has(key)) return false;
      if (mods.repeat !== true && mods.predatesSurface !== true) skip();
      return true;
    },
    render: (ui) => {
      const shown = source.sponsorBreak;
      if (shown === null) return;
      const elapsedMs = Math.max(0, ui.now - ui.openedAt);
      if (elapsedMs >= sponsorBreakDurationMs(shown.message)) {
        source.endSponsorBreak(false);
        return;
      }
      choiceModal(ui, {
        id: 'sponsor-break',
        overline: OVERLINE,
        icon: ui.size === 'compact' ? undefined : 'sparkle',
        tone: 'info',
        title: shown.sponsor,
        extra: typedMessagePart(ui, shown.message, elapsedMs),
        width: BREAK_WIDTH,
        buttons: [{ id: 'skip', label: 'Skip', variant: 'ghost', onTap: skip }],
        defaultButton: 0,
        onScrimTap: skip,
      });
    },
  };
}
