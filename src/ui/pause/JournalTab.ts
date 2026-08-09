/**
 * The Quest Journal: every thread the run has going, with where each one is.
 *
 * Lives in the pause menu rather than on the HUD. A tracker hung in the corner
 * of a playing screen has to be small, and small meant two things the player
 * could not get past: rows past a cap were replaced by a "+N more" line with
 * nothing behind it, and the text was squeezed hard enough to collide. A paused,
 * scrolling, full-modal list has room for all of it and costs nothing while the
 * game is running.
 *
 * The tab itself is floor-agnostic — it renders whatever `TrackerSource`s the
 * scene collected — but the scene only offers it from the Over City up, which is
 * the first floor running more than one thread at a time. The dungeon floors
 * below it each have exactly one, and a journal listing a single quest is a menu
 * standing between the player and something they already knew.
 *
 * Holds no quest state: entries are handed in freshly built (see
 * `src/systems/questTracker.ts`) and the player's pin lives on the run-scoped
 * `JournalProgress` record.
 */

import { drawText, TEXT_PRESETS } from '../TextBox';
import { drawScrollbar } from '../Box';
import { addButton, drawButton, BUTTON_PRESETS } from '../Button';
import { type ButtonRect, type PauseTab } from './types';
import {
  isOutstanding,
  pinMatchesEntry,
  type TrackerEntry,
  type TrackerStatus,
} from '../../systems/questTracker';
import type { JournalProgress } from '../../core/JournalProgress';

/** What the tab needs from the world to draw a bearing on each row. */
export interface JournalTabContext {
  readonly playerTileX: number;
  readonly playerTileY: number;
  readonly entries: ReadonlyArray<TrackerEntry>;
  readonly progress: JournalProgress;
}

const HEADER_Y_OFFSET = 34;
const HEADER_Y_TEXT_OFFSET = 13;
const HEADER_TEXT_SIZE = 16;
const SUBHEAD_Y = 40;

/** Where the scrolling list starts and how much the footer keeps for itself. */
export const JOURNAL_SCROLL_TOP_Y = 58;
export const JOURNAL_FOOTER_H = 52;

const ROW_X_INSET = 14;
/** Breathing room above the first row, so its top border is not clipped away. */
const LIST_TOP_PAD = 4;
const ROW_HEIGHT = 62;
const ROW_GAP = 6;
const ROW_PADDING_X = 8;

/** Text tops inside a row, from its top. */
const ROW_NAME_Y = 8;
const ROW_OBJECTIVE_Y = 27;
const ROW_HINT_Y = 44;

/** The status tag and the bearing sit against the row's right edge. */
const ROW_RIGHT_GUTTER = 8;
const TAG_Y = 9;
const CHEVRON_Y = 26;
const DISTANCE_Y = 43;

/** Width the right gutter keeps for the tag, the chevron and the distance. */
const ROW_TEXT_RIGHT_INSET = 76;

/**
 * Line box for each of a row's three text lines, used as both the line height
 * and the clip height.
 *
 * Making the two equal is what holds a wrapped line to exactly one line: a
 * second line starts at the clip's own bottom edge, so it is cut entirely,
 * while the first keeps its full descender. Clipping *below* the line height
 * instead — the obvious way to do it — shaves the tails off `g`, `y` and `p` in
 * the name of an active quest, which is the largest text on the row.
 */
const NAME_LINE_BOX = 18;
const OBJECTIVE_LINE_BOX = 15;
const HINT_LINE_BOX = 14;

/** Marks the row the world arrow is following. */
const PIN_GLYPH = '📌';

const EMPTY_TEXT_Y = 12;

const SCROLLBAR_X_INSET = 7;
const SCROLLBAR_WIDTH = 3;

/** The ▲/▼ pair in the header, shown only when the list overflows its band. */
const SCROLL_BTN_SIZE = 20;
const SCROLL_BTN_GAP = 4;
const SCROLL_BTN_RIGHT_INSET = 10;
const SCROLL_BTN_Y = 12;
/** One row of travel per press, so a press always reveals exactly one new row. */
const SCROLL_STEP = ROW_HEIGHT + ROW_GAP;

const BACK_BTN_X_OFFSET = 20;
const BACK_BTN_Y_OFFSET = 8;
const BACK_BTN_WIDTH_REDUCTION = 40;
const BACK_BTN_HEIGHT = 36;

/** The eight compass glyphs, in clockwise order starting due east. */
const COMPASS_GLYPHS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const;
const COMPASS_SECTORS = COMPASS_GLYPHS.length;
const RADIANS_PER_TURN = Math.PI * 2;

/** Colour of a row's text, per status. */
const STATUS_TEXT: Record<TrackerStatus, keyof typeof TEXT_PRESETS> = {
  active: 'heading',
  available: 'value',
  completed: 'muted',
  failed: 'danger',
};

/** One-word status tag drawn at the top-right of a row. */
const STATUS_TAG: Record<TrackerStatus, string> = {
  active: 'ACTIVE',
  available: 'NEW',
  completed: 'DONE',
  failed: 'FAILED',
};

/**
 * The compass glyph pointing from the player toward a tile.
 *
 * Screen y grows downward, so the sector is measured off `atan2(dy, dx)` in
 * screen terms and the glyph table reads clockwise from due east — which is what
 * makes "↓" mean "south on the map" rather than "north".
 */
function compassGlyph(fromTileX: number, fromTileY: number, to: { x: number; y: number }): string {
  const angle = Math.atan2(to.y - fromTileY, to.x - fromTileX);
  const turns = (angle + RADIANS_PER_TURN) % RADIANS_PER_TURN;
  const sector = Math.round((turns / RADIANS_PER_TURN) * COMPASS_SECTORS) % COMPASS_SECTORS;
  return COMPASS_GLYPHS[sector];
}

/** Straight-line tiles — what "how far is it" means to somebody reading a map. */
function tileDistance(fromTileX: number, fromTileY: number, to: { x: number; y: number }): number {
  return Math.round(Math.hypot(to.x - fromTileX, to.y - fromTileY));
}

/**
 * Whether pinning this entry would actually point at anything.
 *
 * Deliberately the same two conditions `resolvePinnedEntry` resolves a pin
 * under. Accepting a pin the resolver will then refuse — a failed quest that
 * still carries its target tile, say — sets the gold frame and the pin glyph on
 * a row with no arrow and no minimap marker behind them, which is exactly the
 * silent no-op this guard exists to prevent.
 */
function canPin(entry: TrackerEntry): boolean {
  return entry.target !== undefined && isOutstanding(entry.status);
}

/**
 * Whether this row is the one the pin currently resolves to.
 *
 * Not straight equality, because a pin set when a quest started names the quest
 * rather than the step: the anchor questline then re-keys its row per shard, and
 * an `===` test would leave the gold frame and the 📌 off a row the arrow is in
 * fact pointing at.
 */
function isPinnedRow(progress: JournalProgress, entry: TrackerEntry): boolean {
  const pinnedId = progress.pinnedTrackerId;
  return pinnedId !== null && pinMatchesEntry(pinnedId, entry);
}

/**
 * Un-pinning is tested *first*, because a quest can stop being pinnable while it
 * is the pinned one: the murder mystery drops its tower tile the moment the boss
 * dies, and a bounty has no target while Shady is off the map. Refusing the tap
 * would strand the pin on a quest the player could then never clear.
 */
function togglePin(progress: JournalProgress, entry: TrackerEntry): void {
  if (isPinnedRow(progress, entry)) {
    progress.pinnedTrackerId = null;
    return;
  }
  if (!canPin(entry)) return;
  progress.pinnedTrackerId = entry.id;
}

/** Whether any part of a row at this y falls inside the visible band. */
function rowIsOnScreen(rowY: number, band: { top: number; bottom: number }): boolean {
  return rowY + ROW_HEIGHT > band.top && rowY < band.bottom;
}

function renderRow(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  entry: TrackerEntry,
  rowX: number,
  rowY: number,
  rowWidth: number,
  band: { top: number; bottom: number },
  jc: JournalTabContext,
): void {
  const isPinned = isPinnedRow(jc.progress, entry);
  const rowStyle = isPinned ? BUTTON_PRESETS.trackerRowPinned : BUTTON_PRESETS.trackerRow;
  const rowButton = {
    x: rowX,
    y: rowY,
    width: rowWidth,
    height: ROW_HEIGHT,
    // The row's own content is drawn over it — the button is the hover, press
    // and pin affordance, not the label.
    label: '',
    ...rowStyle,
    action: () => {
      togglePin(jc.progress, entry);
    },
  };
  // Only a row the pin can land on, drawn whole, is a live button. Every other
  // row goes through `drawButton` marked disabled, which is what keeps it out of
  // the pointer registry and the focus ring as well as suppressing hover and
  // press. The heading over this list tells the player to tap a quest to pin it,
  // so a row that answers a tap with an animation and a click sound and no pin
  // is the panel telling them it worked.
  const isWhollyVisible = rowY >= band.top && rowY + ROW_HEIGHT <= band.bottom;
  if ((canPin(entry) || isPinned) && isWhollyVisible) {
    addButton(ctx, buttons, rowButton);
  } else {
    drawButton(ctx, { ...rowButton, disabled: true });
  }

  const textX = rowX + ROW_PADDING_X;
  // `width` word-wraps; `lineHeight` and `height` together hold what wrapped to
  // one line, so a long quest name is cut rather than pushed down onto the
  // objective under it.
  const lineWidth = rowWidth - ROW_PADDING_X - ROW_TEXT_RIGHT_INSET;
  const lineBox = (box: number) => ({ width: lineWidth, lineHeight: box, height: box });

  drawText(ctx, isPinned ? `${PIN_GLYPH} ${entry.name}` : entry.name, {
    x: textX,
    y: rowY + ROW_NAME_Y,
    ...TEXT_PRESETS[STATUS_TEXT[entry.status]],
    ...lineBox(NAME_LINE_BOX),
  });
  drawText(ctx, entry.objective, {
    x: textX,
    y: rowY + ROW_OBJECTIVE_Y,
    ...TEXT_PRESETS.label,
    ...lineBox(OBJECTIVE_LINE_BOX),
  });
  if (entry.hint !== undefined) {
    drawText(ctx, entry.hint, {
      x: textX,
      y: rowY + ROW_HINT_Y,
      ...TEXT_PRESETS.muted,
      ...lineBox(HINT_LINE_BOX),
    });
  }

  const rightX = rowX + rowWidth - ROW_RIGHT_GUTTER;
  drawText(ctx, STATUS_TAG[entry.status], {
    x: rightX,
    y: rowY + TAG_Y,
    align: 'right',
    ...TEXT_PRESETS.controls,
  });

  if (entry.target === undefined) return;
  drawText(ctx, compassGlyph(jc.playerTileX, jc.playerTileY, entry.target), {
    x: rightX,
    y: rowY + CHEVRON_Y,
    align: 'right',
    ...TEXT_PRESETS.value,
  });
  drawText(ctx, `${tileDistance(jc.playerTileX, jc.playerTileY, entry.target)}m`, {
    x: rightX,
    y: rowY + DISTANCE_Y,
    align: 'right',
    ...TEXT_PRESETS.muted,
  });
}

/** Returns total content height so `PauseMenu` can clamp the scroll. */
export function renderJournalTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  scrollBy: (delta: number) => void,
  jc: JournalTabContext,
  scrollY: number,
): number {
  drawText(ctx, 'QUEST JOURNAL', {
    x: bx + bw / 2,
    y: by + HEADER_Y_OFFSET - HEADER_Y_TEXT_OFFSET,
    bold: true,
    size: HEADER_TEXT_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });
  drawText(ctx, 'Tap a quest to pin it — an arrow will point the way', {
    x: bx + bw / 2,
    y: by + SUBHEAD_Y,
    align: 'center',
    ...TEXT_PRESETS.muted,
  });

  const scrollTop = by + JOURNAL_SCROLL_TOP_Y;
  // Clamped at zero so a modal squeezed by a short window yields an empty list
  // rather than an inside-out clip rect.
  const scrollHeight = Math.max(0, bh - JOURNAL_SCROLL_TOP_Y - JOURNAL_FOOTER_H);
  const band = { top: scrollTop, bottom: scrollTop + scrollHeight };

  // Derived up front rather than accumulated in the loop below, because the
  // scroll buttons have to be registered before any row: the focus ring is in
  // registration order, and only a stop the scrolling cannot move is one a
  // keyboard player can press twice.
  const contentHeight =
    jc.entries.length === 0
      ? 0
      : LIST_TOP_PAD + jc.entries.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;

  // Wheel and drag reach the rows below the fold, but the focus ring only ever
  // holds the rows that are wholly drawn — so without these a keyboard player
  // could see a seventh quest and have no way to pin it.
  if (contentHeight > scrollHeight) {
    const buttonY = by + SCROLL_BTN_Y;
    const downX = bx + bw - SCROLL_BTN_RIGHT_INSET - SCROLL_BTN_SIZE;
    const upX = downX - SCROLL_BTN_SIZE - SCROLL_BTN_GAP;
    addButton(ctx, buttons, {
      x: upX,
      y: buttonY,
      width: SCROLL_BTN_SIZE,
      height: SCROLL_BTN_SIZE,
      label: '▲',
      ...BUTTON_PRESETS.toggle,
      action: () => {
        scrollBy(-SCROLL_STEP);
      },
    });
    addButton(ctx, buttons, {
      x: downX,
      y: buttonY,
      width: SCROLL_BTN_SIZE,
      height: SCROLL_BTN_SIZE,
      label: '▼',
      ...BUTTON_PRESETS.toggle,
      action: () => {
        scrollBy(SCROLL_STEP);
      },
    });
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollHeight);
  ctx.clip();

  // Not translated: a button's hit-rect comes from the coordinates it is handed,
  // so the rows are placed in screen space and the clip does the hiding.
  const rowX = bx + ROW_X_INSET;
  const rowWidth = bw - ROW_X_INSET * 2;
  let localY = LIST_TOP_PAD;

  if (jc.entries.length === 0) {
    drawText(ctx, 'Nothing on the go.', {
      x: rowX + ROW_PADDING_X,
      y: scrollTop + EMPTY_TEXT_Y,
      ...TEXT_PRESETS.muted,
    });
  }

  for (const entry of jc.entries) {
    const screenY = scrollTop + localY - scrollY;
    // Culled rather than clipped once a row is entirely outside the band. The
    // clip hides its paint, but a drawn button also claims a pointer rect and a
    // focus-ring stop — and a row scrolled past the bottom sits out on the
    // dimmed backdrop *below the modal*, where a click on empty screen would
    // answer with the row's click sound.
    if (rowIsOnScreen(screenY, band)) {
      renderRow(ctx, buttons, entry, rowX, screenY, rowWidth, band, jc);
    }
    localY += ROW_HEIGHT + ROW_GAP;
  }

  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_INSET,
    trackY: scrollTop,
    trackH: scrollHeight,
    contentH: contentHeight,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X_OFFSET,
    y: by + bh - JOURNAL_FOOTER_H + BACK_BTN_Y_OFFSET,
    width: bw - BACK_BTN_WIDTH_REDUCTION,
    height: BACK_BTN_HEIGHT,
    label: 'Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('game'),
  });

  return contentHeight;
}

/** How many entries still want doing — what the Journal's badge counts. */
export function outstandingCount(entries: ReadonlyArray<TrackerEntry>): number {
  return entries.filter((entry) => isOutstanding(entry.status)).length;
}
