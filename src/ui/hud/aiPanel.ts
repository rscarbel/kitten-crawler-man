/**
 * The AI characters' corner of the HUD, under the unit frames: the
 * connection dot, an opinion flash, the latest message typing out with its
 * reply buttons, and the "intervened" line for an action that just landed.
 *
 * A HUD-band surface so it never takes keyboard focus or Escape from a menu,
 * and every menu covers it. Only the reply buttons take input; the rest is a
 * readout a tap passes through.
 */
import {
  speaksInCarolineFrame,
  type AIChatFeed,
  type AIConnectionStatus,
  type FeedMessage,
} from '../../ai/AIChatFeed';
import { inset, splitH, splitV, type Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { panelWidths } from '../theme/tokens';
import { badge, badgeSize, type BadgeTone } from '../widgets/badge';
import { button, buttonHeight } from '../widgets/button';
import { card } from '../widgets/card';
import {
  CAROLINE_FULLY_OPEN,
  CAROLINE_PREFIX,
  carolineBox,
  carolineBoxBody,
  carolineBoxChromeHeight,
  carolineLineHeight,
  layoutCarolineText,
  type CarolineReveal,
} from '../widgets/carolineFrame';
import { lineHeightOf, measureTextHeight, text } from '../widgets/text';
import { hudLayout, type HudGeometry } from './hudLayout';

export const AI_PANEL_SURFACE_ID = 'ai-panel';

export interface AIPanelDeps {
  readonly feed: AIChatFeed;
  /** The scene's HUD is up; the panel hides with it (cutscenes, loading). */
  readonly hudVisible: () => boolean;
  readonly onChoice: (choiceId: string) => void;
  /** Defaults to {@link AI_PANEL_SURFACE_ID}; review sheets mount several. */
  readonly id?: string;
}

const STATUS_BADGES: Readonly<
  Record<Exclude<AIConnectionStatus, 'disabled'>, { label: string; tone: BadgeTone }>
> = {
  connecting: { label: '● AI connecting', tone: 'neutral' },
  online: { label: '● AI online', tone: 'success' },
  degraded: { label: '● AI degraded', tone: 'warning' },
  offline: { label: '● AI offline', tone: 'danger' },
};

/** Phones keep the message short so the reply buttons stay above the hotbar. */
const MESSAGE_MAX_LINES_COMPACT = 4;
const MESSAGE_MAX_LINES = 7;
const MAX_CHOICE_COLUMNS = 3;
const FLASH_MAX_LINES = 2;
const TYPING_CARET = '_';

function messageMaxLines(ui: Ui): number {
  return ui.size === 'compact' ? MESSAGE_MAX_LINES_COMPACT : MESSAGE_MAX_LINES;
}

function visibleText(message: FeedMessage): string {
  const shown = message.text.slice(0, Math.floor(message.revealed));
  const stillTyping = !message.done || shown.length < message.text.length;
  return stillTyping ? `${shown}${TYPING_CARET}` : shown;
}

function choiceRows(count: number): number {
  return Math.ceil(count / MAX_CHOICE_COLUMNS);
}

/** The reply buttons' height under a message, the gap above them included; 0 for none. */
function choicesHeight(ui: Ui, rows: number): number {
  const { space } = ui.theme;
  return rows === 0 ? 0 : space.sm + rows * buttonHeight(ui, 'sm') + (rows - 1) * space.xs;
}

/** The reply buttons from the top of `area`, up to {@link MAX_CHOICE_COLUMNS} a row. */
function drawChoiceRows(
  ui: Ui,
  area: Rect,
  choices: FeedMessage['choices'],
  rows: number,
  onChoice: (choiceId: string) => void,
): void {
  const { space } = ui.theme;
  const choiceRowH = buttonHeight(ui, 'sm');
  const rowRects = splitV(
    { ...area, h: choicesHeight(ui, rows) - space.sm },
    Array.from({ length: rows }, () => choiceRowH),
    space.xs,
  );
  rowRects.forEach((rowRect, row) => {
    const rowChoices = choices.slice(row * MAX_CHOICE_COLUMNS, (row + 1) * MAX_CHOICE_COLUMNS);
    const cells = splitH(
      rowRect,
      rowChoices.map((): 'fill' => 'fill'),
      space.xs,
    );
    rowChoices.forEach((choice, column) => {
      button(ui, cells[column], {
        id: `choice-${choice.id}`,
        label: choice.label,
        size: 'sm',
        onTap: () => onChoice(choice.id),
      });
    });
  });
}

/** The card's height for a body of `bodyH`, given the overline it carries. */
function cardHeight(ui: Ui, bodyH: number): number {
  const padding = skinsFor(ui.theme).panel.hud.padding;
  return padding * 2 + lineHeightOf(ui, 'overline') + ui.theme.space.xxs + bodyH;
}

/** Something the panel stacks: its height at the panel's width, and how to draw it there. */
interface Block {
  readonly height: number;
  draw(at: Rect): void;
}

function statusBlock(ui: Ui, status: AIConnectionStatus): Block | null {
  if (status === 'disabled') return null;
  const look = STATUS_BADGES[status];
  const size = badgeSize(ui, { label: look.label, kind: 'tag' });
  return {
    height: size.h,
    draw: (at) =>
      void badge(
        ui,
        { x: at.x, y: at.y, w: size.w, h: size.h },
        { label: look.label, tone: look.tone, kind: 'tag', variant: 'soft' },
      ),
  };
}

function flashBlock(ui: Ui, flash: string, width: number): Block {
  const padding = skinsFor(ui.theme).panel.caption.padding;
  const bodyH = measureTextHeight(ui, width - padding * 2, {
    text: flash,
    role: 'label',
    maxLines: FLASH_MAX_LINES,
  });
  const height = bodyH + padding * 2;
  return {
    height,
    draw: (at) =>
      void card(
        ui,
        { ...at, h: height },
        {
          id: 'ai-flash',
          kind: 'caption',
          content: (body) =>
            void text(ui, body, {
              text: flash,
              role: 'label',
              wrap: true,
              maxLines: FLASH_MAX_LINES,
            }),
        },
      ),
  };
}

/**
 * How far Caroline's message has typed, as her frame reveals it: the prefix
 * is up at once, and the newest characters still decode while more arrive.
 */
function carolineRevealOf(ui: Ui, message: FeedMessage): CarolineReveal {
  const typed = Math.min(message.text.length, Math.floor(message.revealed));
  const shown = CAROLINE_PREFIX.length + typed;
  const typing = !message.done || typed < message.text.length;
  const decodeTail = skinsFor(ui.theme).caroline.decodeTail;
  return { shown, decoding: typing ? Math.min(decodeTail, typed) : 0 };
}

/** Caroline's message in her own frame, her reply buttons inside it under her text. */
function carolineMessageBlock(
  ui: Ui,
  message: FeedMessage,
  width: number,
  maxLines: number,
  onChoice: (choiceId: string) => void,
): Block {
  const { space } = ui.theme;
  const padding = skinsFor(ui.theme).caroline.padding;
  const lines = layoutCarolineText(ui, width - padding * 2, message.text, maxLines);
  const textH = lines.length * carolineLineHeight(ui.theme);
  const choices = message.done ? message.choices : [];
  const rows = choiceRows(choices.length);
  const choicesH = choicesHeight(ui, rows);
  const height = carolineBoxChromeHeight(ui.theme) + textH + choicesH;
  return {
    height,
    draw: (at) => {
      const frame = { ...at, h: height };
      carolineBox(ui, frame, {
        message: message.text,
        reveal: carolineRevealOf(ui, message),
        nowMs: ui.now,
        open: CAROLINE_FULLY_OPEN,
        maxLines,
      });
      if (rows === 0) return;
      const body = carolineBoxBody(ui.theme, frame);
      drawChoiceRows(ui, inset(body, { t: textH + space.sm }), choices, rows, onChoice);
    },
  };
}

function typingBlock(ui: Ui, characterName: string): Block {
  const line = `${characterName} is typing…`;
  const height = cardHeight(ui, lineHeightOf(ui, 'muted'));
  return {
    height,
    draw: (at) =>
      void card(
        ui,
        { ...at, h: height },
        {
          id: 'ai-typing',
          kind: 'hud',
          overline: characterName,
          content: (body) => void text(ui, body, { text: line, role: 'muted' }),
        },
      ),
  };
}

function messageBlock(
  ui: Ui,
  message: FeedMessage,
  width: number,
  maxLines: number,
  onChoice: (choiceId: string) => void,
): Block {
  const { space } = ui.theme;
  const innerW = width - skinsFor(ui.theme).panel.hud.padding * 2;
  const shown = visibleText(message);
  const textH = measureTextHeight(ui, innerW, { text: message.text, role: 'body', maxLines });
  const choices = message.done ? message.choices : [];
  const rows = choiceRows(choices.length);
  const choicesH = choicesHeight(ui, rows);
  const height = cardHeight(ui, textH + choicesH);
  const drawChoices = (body: Rect): void => {
    drawChoiceRows(ui, inset(body, { t: textH + space.sm }), choices, rows, onChoice);
  };
  return {
    height,
    draw: (at) =>
      void card(
        ui,
        { ...at, h: height },
        {
          id: 'ai-message',
          kind: 'hud',
          overline: message.characterName,
          accent: ui.theme.palette.accent.base,
          content: (body) => {
            text(ui, { ...body, h: textH }, { text: shown, role: 'body', wrap: true, maxLines });
            if (rows > 0) drawChoices(body);
          },
        },
      ),
  };
}

function interventionBlock(ui: Ui, actor: string, line: string): Block {
  const height = cardHeight(ui, lineHeightOf(ui, 'caption'));
  return {
    height,
    draw: (at) =>
      void card(
        ui,
        { ...at, h: height },
        {
          id: 'ai-intervention',
          kind: 'hud',
          overline: `${actor} intervened`,
          accent: ui.theme.palette.accent.base,
          content: (body) => void text(ui, body, { text: line, role: 'caption' }),
        },
      ),
  };
}

/**
 * The message (or typing line) at the most lines that fit `room`, shrinking
 * to one line before giving up, so the reply buttons always stay on screen.
 */
function fittedMessage(
  ui: Ui,
  feed: AIChatFeed,
  width: number,
  room: number,
  onChoice: (choiceId: string) => void,
): Block | null {
  const message = feed.message;
  if (message === null) {
    const typing = feed.typingCharacter;
    if (typing === null) return null;
    const block = typingBlock(ui, typing);
    return block.height <= room ? block : null;
  }
  const blockFor = speaksInCarolineFrame(message.characterName)
    ? carolineMessageBlock
    : messageBlock;
  for (let lines = messageMaxLines(ui); lines >= 1; lines--) {
    const block = blockFor(ui, message, width, lines, onChoice);
    if (block.height <= room) return block;
  }
  return null;
}

/** Narrower than this and the reply buttons stop reading; the panel looks for another column. */
const MIN_PANEL_WIDTH = 160;
/** Guards the obstacle loop: each pass only ever narrows or shortens the column. */
const MAX_COLUMN_PASSES = 8;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Every HUD control and the minimap and hotbar: what the panel must never cover. */
function hudObstacles(geometry: HudGeometry): Rect[] {
  const buttons = geometry.buttons;
  const optional = [buttons.build, buttons.switchButton].filter(
    (rect): rect is Rect => rect !== null,
  );
  return [
    buttons.pause,
    buttons.bag,
    buttons.follower,
    buttons.chip,
    buttons.journal,
    buttons.summon,
    ...buttons.extras,
    ...optional,
    geometry.normalMiniMap,
    geometry.hotbar.strip,
  ];
}

/**
 * The clear column that starts at (`x`, `top`): as wide as a small panel
 * where nothing stands in the way, narrowed by obstacles to its right and
 * cut short by obstacles below, or null when what is left is too narrow.
 */
function clearColumn(ui: Ui, geometry: HudGeometry, x: number, top: number): Rect | null {
  const { space } = ui.theme;
  const right = ui.viewport.x + ui.viewport.w - space.lg;
  let column: Rect = {
    x,
    y: top,
    w: Math.min(panelWidths.sm, right - x),
    h: geometry.hotbar.strip.y - space.xs - top,
  };
  const obstacles = hudObstacles(geometry);
  for (let pass = 0; pass < MAX_COLUMN_PASSES; pass++) {
    const blocking = obstacles.filter((obstacle) => overlaps(obstacle, column));
    if (blocking.length === 0) break;
    for (const obstacle of blocking) {
      if (obstacle.x >= x + MIN_PANEL_WIDTH) {
        column = { ...column, w: Math.min(column.w, obstacle.x - space.sm - x) };
      } else if (obstacle.y > top) {
        column = { ...column, h: Math.min(column.h, obstacle.y - space.xs - top) };
      } else {
        return null;
      }
    }
  }
  return column.w >= MIN_PANEL_WIDTH && column.h > 0 ? column : null;
}

/** What the panel stacks in `column`, most important first, leaving out what does not fit. */
function stackFor(ui: Ui, deps: AIPanelDeps, column: Rect): Array<Block | null> {
  const { space } = ui.theme;
  let room = column.h;
  const take = (block: Block | null): Block | null => {
    if (block === null || block.height > room) return null;
    room -= block.height + space.xs;
    return block;
  };
  const feed = deps.feed;
  const status = take(statusBlock(ui, feed.status));
  const message = take(fittedMessage(ui, feed, column.w, room, deps.onChoice));
  const flash = feed.flash === null ? null : take(flashBlock(ui, feed.flash.text, column.w));
  const interventions = feed.interventions;
  const latest = interventions.length > 0 ? interventions[interventions.length - 1] : null;
  const intervention =
    latest === null ? null : take(interventionBlock(ui, latest.actor, latest.text));
  return [status, flash, message, intervention];
}

/** Whether the stack left out a message the feed has to show. */
function dropsMessage(deps: AIPanelDeps, stack: Array<Block | null>): boolean {
  const wanted = deps.feed.message !== null || deps.feed.typingCharacter !== null;
  return wanted && stack[MESSAGE_SLOT] === null;
}

/** Where the message sits in {@link stackFor}'s draw order. */
const MESSAGE_SLOT = 2;

/** The AI panel as a surface; mount it once per gameplay scene. */
export function aiPanelSurface(deps: AIPanelDeps): Surface {
  return {
    id: deps.id ?? AI_PANEL_SURFACE_ID,
    band: 'hud',
    haltsWorld: false,
    isOpen: () => deps.hudVisible() && (deps.feed.status !== 'disabled' || deps.feed.hasContent),
    render: (ui) => {
      const { space } = ui.theme;
      const geometry = hudLayout({
        viewport: ui.viewport,
        size: ui.size,
        density: ui.density,
        miniMapExpanded: false,
        build: false,
      });
      const frames = geometry.framesBlock;
      // Under the unit frames first; a short landscape phone has more room beside them.
      const under = clearColumn(ui, geometry, frames.x, frames.y + frames.h + space.xs);
      const beside = clearColumn(ui, geometry, frames.x + frames.w + space.sm, frames.y);
      let column = under;
      let stack = under === null ? null : stackFor(ui, deps, under);
      if ((stack === null || dropsMessage(deps, stack)) && beside !== null) {
        const besideStack = stackFor(ui, deps, beside);
        if (stack === null || !dropsMessage(deps, besideStack)) {
          column = beside;
          stack = besideStack;
        }
      }
      if (column === null || stack === null) return;
      let y = column.y;
      for (const block of stack) {
        if (block === null) continue;
        block.draw({ x: column.x, y, w: column.w, h: block.height });
        y += block.height + space.xs;
      }
    },
  };
}
