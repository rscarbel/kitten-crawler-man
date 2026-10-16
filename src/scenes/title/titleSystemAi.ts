/**
 * The System AI's line on the title screen: its welcome as the reveal lands,
 * then its sponsor breaks while the player lingers, each typed out a
 * character at a time in the terminal face.
 *
 * A readout, never a control: it registers no region and takes no keys. What
 * it shows is a function of the title clock and the latest line on the quip
 * channel, so a frozen review moment shows a line exactly as far typed as a
 * player would see it.
 */

import type { Rect } from '../../ui/core/geom';
import type { Surface, Ui } from '../../ui/core/UiRoot';
import { TERMINAL_FONT_STACK } from '../../ui/theme/fonts';
import { skinsFor } from '../../ui/theme/skins';
import type { Theme } from '../../ui/theme/tokens';
import type { PaintTarget } from '../../ui/widgets/paint';
import { measureText, text, wrapToWidth } from '../../ui/widgets/text';
import type { TitleClock } from './titleClock';
import type { TitleQuip, TitleQuipChannel } from './titleEvents';
import { titleLogoGeometry, type TitleLogoGeometry } from './titleLogo';
import { stageRectInUi, type TitleStage } from './titleStage';

export const TITLE_SYSTEM_AI_SURFACE_ID = 'title-system-ai';

/** What the System AI says as the show opens. In capitals: it is the announcer. */
export const TITLE_WELCOME_LINE = 'WELCOME, CRAWLER. THE DUNGEON IS OPEN.';
/** How long the welcome stays up, typing included, unless a sponsor break takes the line first. */
export const TITLE_WELCOME_HOLD_MS = 7000;

/** Typed at a steady machine pace: quick enough that a long sponsor break still leaves time to read it. */
const TYPE_MS_PER_CHARACTER = 28;
/** The line fades out over the last of its time up. */
const FADE_OUT_MS = 500;
/** The cursor blinks once the line is typed. */
const CARET_BLINK_MS = 530;
const CARET = '_';
/** Every line opens on a prompt, so it reads as typed into a terminal. */
const PROMPT = '> ';
/** Above the menu, the line takes at most this many lines. */
const ABOVE_MENU_MAX_LINES = 3;
/** Under the heroes the line needs this many, or a sponsor break would end mid-sentence. */
const MIN_LINES_UNDER_HEROES = 2;
/** The dive takes the line down with the light, slowly at first. */
const DIVE_FADE_EXPONENT = 2;

export interface TitleSystemAiDeps {
  readonly clock: () => TitleClock;
  readonly quips: TitleQuipChannel;
  readonly stage: () => TitleStage;
  /** The menu's strip this frame, in UI units: held upright, the line sits just above it. */
  readonly menuStrip: (ui: Ui) => Rect;
}

const terminalThemes = new WeakMap<Theme, Theme>();

/** `theme` with the terminal face in place of the UI face, built once per theme. */
function terminalTheme(theme: Theme): Theme {
  const cached = terminalThemes.get(theme);
  if (cached !== undefined) return cached;
  const built: Theme = { ...theme, fontFamily: TERMINAL_FONT_STACK };
  terminalThemes.set(theme, built);
  return built;
}

/** How much of `quip` shows at `nowMs`, or null when it is not up. */
function shownAt(quip: TitleQuip, nowMs: number): { typed: number; alpha: number } | null {
  const sinceMs = nowMs - quip.startedAtMs;
  if (sinceMs < 0 || sinceMs >= quip.durationMs) return null;
  const typed = Math.floor(sinceMs / TYPE_MS_PER_CHARACTER);
  const alpha = Math.min(1, (quip.durationMs - sinceMs) / FADE_OUT_MS);
  return { typed, alpha };
}

const ELLIPSIS = '…';

/** `lines` with the last one cut back until it ends in an ellipsis within `width`. */
function endInEllipsis(
  lines: readonly string[],
  width: number,
  measure: (line: string) => number,
): string[] {
  const kept = lines.slice(0, -1);
  let last = (lines[lines.length - 1] ?? '').trimEnd();
  while (last.length > 0 && measure(`${last}${ELLIPSIS}`) > width) last = last.slice(0, -1);
  return [...kept, `${last.trimEnd()}${ELLIPSIS}`];
}

export function titleSystemAiSurface(deps: TitleSystemAiDeps): Surface {
  let logo: { readonly stage: TitleStage; readonly geometry: TitleLogoGeometry } | null = null;
  const logoFoot = (stage: TitleStage): number => {
    const known = logo !== null && logo.stage === stage ? logo.geometry : null;
    const geometry = known ?? titleLogoGeometry(stage);
    logo = { stage, geometry };
    return geometry.footY;
  };

  /** The room between the logo and the menu's strip, across `span`; null when not a line fits. */
  const aboveMenu = (
    ui: Ui,
    lineHeight: number,
    span: { x: number; w: number },
  ): { rect: Rect; maxLines: number } | null => {
    const { space } = ui.theme;
    const strip = deps.menuStrip(ui);
    const bottom = strip.y - space.sm;
    const ceiling = logoFoot(deps.stage()) / ui.uiScale + space.sm;
    const fits = Math.floor((bottom - ceiling) / lineHeight);
    if (fits < 1) return null;
    const maxLines = Math.min(ABOVE_MENU_MAX_LINES, fits);
    const rect: Rect = {
      x: span.x,
      y: bottom - maxLines * lineHeight,
      w: span.w,
      h: maxLines * lineHeight,
    };
    return { rect, maxLines };
  };

  /**
   * Where the line may go: under the heroes on a wide screen, or across the
   * screen between the logo and the menu where the room under the heroes is
   * too short for a sponsor break (a phone on its side) or the menu is docked
   * under them. Null when not even one line fits anywhere.
   */
  const room = (
    ui: Ui,
    lineHeight: number,
  ): { rect: Rect; maxLines: number; centred: boolean } | null => {
    const stage = deps.stage();
    const { space } = ui.theme;
    const acrossScreen = { x: ui.viewport.x + space.md, w: ui.viewport.w - space.md * 2 };
    if (stage.composition === 'portrait') {
      const found = aboveMenu(ui, lineHeight, acrossScreen);
      return found === null ? null : { ...found, centred: true };
    }
    const rect = stageRectInUi(stage.promptRect, ui.uiScale);
    const maxLines = Math.floor(rect.h / lineHeight);
    if (maxLines >= MIN_LINES_UNDER_HEROES) return { rect, maxLines, centred: false };
    const found = aboveMenu(ui, lineHeight, acrossScreen);
    const capacity = (option: { rect: Rect; maxLines: number }): number =>
      option.maxLines * option.rect.w;
    if (found !== null && capacity(found) >= capacity({ rect, maxLines }))
      return { ...found, centred: true };
    return maxLines < 1 ? null : { rect, maxLines, centred: false };
  };

  return {
    id: TITLE_SYSTEM_AI_SURFACE_ID,
    band: 'hud',
    haltsWorld: false,
    isOpen: () => deps.quips.current() !== null,
    render: (ui) => {
      const quip = deps.quips.current();
      if (quip === null) return;
      const clock = deps.clock();
      const shown = shownAt(quip, clock.elapsedMs);
      if (shown === null) return;

      const skin = skinsFor(ui.theme).systemAi;
      const { style } = skin.text;
      const target: PaintTarget = { ctx: ui.ctx, theme: terminalTheme(ui.theme) };
      const space = room(ui, style.lineHeight);
      if (space === null) return;
      const { rect, maxLines, centred } = space;
      const measure = (line: string): number => measureText(target, line, { style });
      // Laid out whole before any of it shows, so a word never jumps to the next line mid-type.
      const wrapped = wrapToWidth(`${PROMPT}${quip.text}`, rect.w, measure);
      const lines =
        wrapped.length > maxLines
          ? endInEllipsis(wrapped.slice(0, maxLines), rect.w, measure)
          : wrapped;
      const blockWidth = Math.max(...lines.map(measure));
      const left = centred ? rect.x + (rect.w - blockWidth) / 2 : rect.x;
      const typedThrough = shown.typed + PROMPT.length;
      const fullyTyped = typedThrough >= lines.join('').length;
      const caretOn = !fullyTyped || Math.floor(clock.elapsedMs / CARET_BLINK_MS) % 2 === 0;

      const { ctx } = ui;
      ctx.save();
      ctx.globalAlpha *= shown.alpha * (1 - Math.pow(clock.diveProgress, DIVE_FADE_EXPONENT));
      let remaining = typedThrough;
      lines.forEach((line, index) => {
        if (remaining <= 0 && index > 0) return;
        const visible = line.slice(0, Math.max(0, remaining));
        remaining -= line.length;
        const caretHere = caretOn && (remaining <= 0 || index === lines.length - 1);
        text(
          target,
          { x: left, y: rect.y + index * style.lineHeight, w: rect.w, h: style.lineHeight },
          {
            text: caretHere ? `${visible}${CARET}` : visible,
            style,
            color: skin.text.color,
            halo: skin.halo,
          },
        );
      });
      ctx.restore();
    },
  };
}
