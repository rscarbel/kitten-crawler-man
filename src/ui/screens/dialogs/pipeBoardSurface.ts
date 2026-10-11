/**
 * The clogged bathroom's pipe board: the full-screen puzzle behind the pipe
 * wall. It halts the world and keeps the keys while it is up; Escape and ✕
 * close it with every turn kept, because the board belongs to the floor, not
 * to this screen.
 *
 * Above the board a status strip counts full fixtures and leaks,
 * and one coaching line says what is still wrong (never which tile to turn).
 * Tapping a tile turns it clockwise; the arrows move a cursor, Space or Enter
 * turns the tile under it clockwise and Backspace anticlockwise. Once solved,
 * input stays locked through the win moment, then a single button leads back
 * to the bathroom.
 */

import { splitH, splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { pipeInk } from '../../theme/pipeInk';
import {
  fitPipeBoard,
  paintPipeBanner,
  paintPipeBoard,
  paintPipeCounterIcon,
  pipeBoardExtent,
  pipeCellRect,
  type PipeBoardFit,
  type PipeBoardGeometry,
  type PipeBoardShape,
  type PipeCounterIcon,
} from '../../pipeBoard/pipeBoardPainter';
import { PipeBoardView } from '../../pipeBoard/pipeBoardView';
import { card } from '../../widgets/card';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { meter } from '../../widgets/meter';
import { drawFocusRing } from '../../widgets/paint';
import { button, buttonHeight } from '../../widgets/button';
import { panel, panelBodyMaxHeight, panelBodyWidth, type FooterButton } from '../../widgets/panel';
import { lineHeightOf, text } from '../../widgets/text';
import type { BathroomCue } from '../../../systems/cloggedBathroom/bathroomSoundCues';
import type {
  PipeBoard,
  PipeFlowCounts,
  TurnDirection,
} from '../../../systems/cloggedBathroom/pipeBoard';

/**
 * What the board surface reads and drives. `CloggedBathroomSystem` owns the
 * floor's one board and implements this; the surface never turns a tile
 * itself, and it animates whatever the board does, so a restart or a solver
 * driving the board directly shows the same way a tap does.
 */
export interface PipeBoardSource {
  readonly isPipeBoardOpen: boolean;
  /** The floor's board, or null while it is still being generated. */
  readonly pipeBoard: PipeBoard | null;
  /** 0..1 through generating the board, while `pipeBoard` is null. */
  readonly pipeBoardGenerationProgress: number;
  /** Solved before: the board opens on its solved picture with nothing to replay. */
  readonly pipeBoardSolved: boolean;
  /** Turns one tile a quarter. False when it is bolted and won't budge. */
  turnPipeTile(cell: number, direction: TurnDirection): boolean;
  /** Plays one of the bathroom's cues. */
  playPipeBoardCue(cue: BathroomCue): void;
  /** Called once, the moment the board is first seen solved, before the win moment plays. */
  onPipeBoardSolved(): void;
  /** Escape, ✕ or "Back to the bathroom": the board goes away with every turn kept. */
  closePipeBoard(): void;
  /** "How it works": show the explainer over the board. */
  openPipeBoardExplainer(): void;
  /** "Start over", once confirmed: every tile back on the opening scramble. */
  restartPipeBoard(): void;
}

const TITLE = 'Fix the pipes';
const HOW_IT_WORKS = 'How it works';
const START_OVER = 'Start over';
const BACK_TO_BATHROOM = 'Back to the bathroom';
const GENERATING = 'Laying out the pipes…';
const WIN_BANNER = 'PLUMBING FIXED!';
const CONFIRM_TITLE = 'Start over?';
const CONFIRM_BODY = 'Every pipe goes back to how you found it.';
const CONFIRM_YES = 'Start over';
const CONFIRM_NO = 'Keep going';

/** The tile size the board never grows past, however much room there is. */
const BOARD_MAX_CELL = 68;
/** The info column beside the board when the board sits beside its status rather than under it. */
const SIDE_COLUMN_WIDTH = 210;
/** The beside layout must beat the stacked one by this much to be worth the unusual shape. */
const SIDE_LAYOUT_ADVANTAGE = 1.08;
const COACHING_LINES = 2;
const COUNTER_COUNT = 2;
const COUNTER_LABEL_PAD = 6;
/** The banner spans this share of the grid's width. */
const BANNER_WIDTH_SHARE = 0.94;
const BANNER_HEIGHT_CELLS = 0.95;
const BANNER_SCALE_FROM = 0.6;
/** A generous height to ask the panel for before it has measured anything. */
const UNMEASURED_BOARD_HEIGHT = 480;

/** One sentence on what is still wrong, by priority. It never says which tile to turn. */
export function pipeCoachingLine(counts: PipeFlowCounts, won: boolean): string {
  if (won) return 'Plumbing fixed!';
  if (counts.wetTiles === 0) return 'Turn the pipe by the water main so the water can get in.';
  const allFull = counts.fixturesFull === counts.fixturesTotal;
  if (counts.leaks > 0 && !allFull) {
    return "Water's escaping. Every open end has to meet another pipe or a fixture.";
  }
  if (counts.leaks > 0) return 'Every fixture has water. Now stop the leaks.';
  return 'No leaks. Now get water to every toilet and sink.';
}

interface Counter {
  readonly icon: PipeCounterIcon;
  readonly label: string;
  readonly atGoal: boolean;
}

function counters(counts: PipeFlowCounts): readonly Counter[] {
  return [
    {
      icon: 'fixtures',
      label: `Fixtures ${counts.fixturesFull}/${counts.fixturesTotal}`,
      atGoal: counts.fixturesFull === counts.fixturesTotal,
    },
    { icon: 'leaks', label: `Leaks ${counts.leaks}`, atGoal: counts.leaks === 0 },
  ];
}

function shapeOf(board: PipeBoard): PipeBoardShape {
  return { cols: board.size, rows: board.size, inletRow: board.inletRow, fixtures: board.fixtures };
}

function boardFit(ui: Ui): PipeBoardFit {
  return {
    maxCell: BOARD_MAX_CELL,
    minCell: ui.theme.size.control,
    sideOverhang: ui.theme.space.sm,
    gauge: true,
  };
}

interface BoardLayout {
  readonly counters: readonly Rect[];
  readonly coaching: Rect;
  readonly board: Rect;
  /** Where the buttons go when they sit in the side column rather than the panel's footer. */
  readonly buttons: readonly Rect[] | null;
}

function counterHeight(ui: Ui): number {
  return lineHeightOf(ui, 'label') + COUNTER_LABEL_PAD * 2;
}

function coachingHeight(ui: Ui): number {
  return lineHeightOf(ui, 'body') * COACHING_LINES;
}

function stackedLayout(ui: Ui, body: Rect): BoardLayout {
  const { space } = ui.theme;
  const [strip, coaching, board] = splitV(
    body,
    [counterHeight(ui), coachingHeight(ui), 'fill'],
    space.sm,
  );
  return {
    counters: splitH(strip, ['fill', 'fill'], space.sm),
    coaching,
    board,
    buttons: null,
  };
}

/** Board on the left; counters, coaching and the buttons down a column on the right. */
function besideLayout(ui: Ui, body: Rect, buttonCount: number): BoardLayout {
  const { space } = ui.theme;
  const [board, column] = splitH(body, ['fill', SIDE_COLUMN_WIDTH], space.lg);
  const rowH = counterHeight(ui);
  const buttonH = buttonHeight(ui);
  const buttonTracks = Array.from({ length: buttonCount }, () => buttonH);
  const rows = splitV(column, [rowH, rowH, 'fill', ...buttonTracks], space.sm);
  return {
    counters: rows.slice(0, COUNTER_COUNT),
    coaching: rows[COUNTER_COUNT] ?? column,
    board,
    buttons: rows.slice(COUNTER_COUNT + 1),
  };
}

function cellIn(ui: Ui, area: Rect, shape: PipeBoardShape): number {
  return fitPipeBoard(area, shape, boardFit(ui)).cell;
}

/** Whether the board sits beside its status, which wins only when it makes the tiles clearly bigger. */
function boardGoesBeside(ui: Ui, shape: PipeBoardShape, footer: readonly FooterButton[]): boolean {
  const width = panelBodyWidth(ui, 'xl');
  const chrome = { width: 'xl', title: TITLE, onClose: () => undefined } as const;
  const stackedBody: Rect = {
    x: 0,
    y: 0,
    w: width,
    h: panelBodyMaxHeight(ui, { ...chrome, footer }),
  };
  const besideBody: Rect = { x: 0, y: 0, w: width, h: panelBodyMaxHeight(ui, chrome) };
  const stackedCell = cellIn(ui, stackedLayout(ui, stackedBody).board, shape);
  const besideCell = cellIn(ui, besideLayout(ui, besideBody, footer.length).board, shape);
  return besideCell > stackedCell * SIDE_LAYOUT_ADVANTAGE;
}

/** The body height the board would like: its status rows plus the panel at the tile size the width allows. */
function wantedBodyHeight(ui: Ui, shape: PipeBoardShape | null): number {
  const { space } = ui.theme;
  const rows = counterHeight(ui) + coachingHeight(ui) + space.sm * 2;
  if (shape === null) return rows + UNMEASURED_BOARD_HEIGHT;
  const width = panelBodyWidth(ui, 'xl');
  const unbounded: Rect = { x: 0, y: 0, w: width, h: Number.MAX_SAFE_INTEGER };
  const geometry = fitPipeBoard(unbounded, shape, boardFit(ui));
  const roomy = geometry.fixtureDepth >= geometry.cell;
  return rows + pipeBoardExtent(shape, geometry.cell, roomy).h;
}

function paintCounter(ui: Ui, rect: Rect, counter: Counter, id: string): void {
  const { space, palette } = ui.theme;
  card(ui, rect, { id, kind: 'inset' });
  const iconSide = rect.h - COUNTER_LABEL_PAD * 2;
  const [iconCell, labelCell] = splitH(
    { x: rect.x + space.sm, y: rect.y + COUNTER_LABEL_PAD, w: rect.w - space.sm * 2, h: iconSide },
    [iconSide, 'fill'],
    space.xs,
  );
  paintPipeCounterIcon(ui.ctx, iconCell, counter.icon, counter.atGoal);
  text(ui, labelCell, {
    text: counter.label,
    role: 'label',
    color: counter.atGoal ? palette.state.success : palette.text.primary,
    tabular: true,
  });
}

/** An overshoot ease for the banner's arrival. */
function easeOutBack(t: number): number {
  const overshoot = 1.70158;
  const shifted = t - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

function paintWinBanner(ui: Ui, geometry: PipeBoardGeometry, progress: number): void {
  if (progress <= 0) return;
  const { grid, cell } = geometry;
  const w = grid.w * BANNER_WIDTH_SHARE;
  const h = Math.max(cell * BANNER_HEIGHT_CELLS, lineHeightOf(ui, 'display'));
  const cx = grid.x + grid.w / 2;
  const cy = grid.y + grid.h / 2;
  const rect: Rect = { x: cx - w / 2, y: cy - h / 2, w, h };
  const scale = BANNER_SCALE_FROM + (1 - BANNER_SCALE_FROM) * easeOutBack(progress);
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, progress * 2);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  paintPipeBanner(ctx, rect);
  text(ui, rect, {
    text: WIN_BANNER,
    role: ui.size === 'compact' ? 'heading' : 'display',
    align: 'center',
    halo: pipeInk.banner.ribbonDark,
  });
  ctx.restore();
}

interface Cursor {
  cell: number;
  /** Drawn only once the keyboard has been used, never for pointer-only play. */
  shown: boolean;
  /** Space and Enter turn the tile under it; false once Tab has gone to the buttons. */
  active: boolean;
}

/**
 * The board surface and its "Start over" confirmation, to be mounted
 * together (the confirmation stacks over the board while it asks).
 */
export function pipeBoardSurfaces(source: PipeBoardSource, id = 'pipe-board'): readonly Surface[] {
  let view: PipeBoardView | null = null;
  let seenOpenedAt: number | null = null;
  let confirmOpen = false;
  let now = 0;
  const cursor: Cursor = { cell: 0, shown: false, active: true };
  const emit = (cue: BathroomCue): void => source.playPipeBoardCue(cue);

  const noteSolve = (): void => {
    if (view?.takeSolvedNotice() === true) source.onPipeBoardSolved();
  };

  const currentView = (at: number): PipeBoardView | null => {
    const board = source.pipeBoard;
    if (board === null) return null;
    if (view?.board !== board) {
      view = new PipeBoardView(board, at, source.pipeBoardSolved, emit);
      cursor.cell = board.inletRow * board.size;
    }
    return view;
  };

  const turn = (cell: number, direction: TurnDirection): void => {
    const active = currentView(now);
    if (active?.acceptsTurns(now) !== true) return;
    if (source.turnPipeTile(cell, direction)) {
      source.playPipeBoardCue('pipeTurn');
    } else {
      active.noteBolted(cell, now);
      source.playPipeBoardCue('pipeBolted');
    }
    active.sync(now);
    noteSolve();
  };

  const locked = (): boolean => view !== null && view.solved && !view.winMoment(now).done;

  const moveCursor = (board: PipeBoard, dx: number, dy: number): void => {
    const x = Math.min(board.size - 1, Math.max(0, (cursor.cell % board.size) + dx));
    const y = Math.min(board.size - 1, Math.max(0, Math.floor(cursor.cell / board.size) + dy));
    cursor.cell = y * board.size + x;
  };

  const ARROWS: Readonly<Partial<Record<string, readonly [number, number]>>> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };

  const footer = (active: PipeBoardView | null): readonly FooterButton[] => {
    if (active?.solved === true) {
      return [
        {
          id: 'back',
          label: BACK_TO_BATHROOM,
          variant: 'primary',
          primary: true,
          onTap: () => source.closePipeBoard(),
        },
      ];
    }
    return [
      {
        id: 'how',
        label: HOW_IT_WORKS,
        icon: 'info',
        variant: 'secondary',
        onTap: () => source.openPipeBoardExplainer(),
      },
      {
        id: 'restart',
        label: START_OVER,
        variant: 'secondary',
        disabled: active === null ? GENERATING : false,
        onTap: () => {
          confirmOpen = true;
        },
      },
    ];
  };

  const renderGenerating = (ui: Ui, body: Rect): void => {
    const { space } = ui.theme;
    const [, label, bar] = splitV(
      body,
      ['fill', lineHeightOf(ui, 'body'), ui.theme.space.md],
      space.md,
    );
    text(ui, label, { text: GENERATING, role: 'secondary', align: 'center' });
    meter(ui, bar, {
      id: 'generating',
      value: source.pipeBoardGenerationProgress,
      max: 1,
      ghost: false,
    });
  };

  const renderBoard = (
    ui: Ui,
    body: Rect,
    active: PipeBoardView,
    beside: boolean,
    buttons: readonly FooterButton[],
  ): void => {
    const board = active.board;
    const shape = shapeOf(board);
    const layout = beside ? besideLayout(ui, body, buttons.length) : stackedLayout(ui, body);
    layout.buttons?.forEach((rect, index) => {
      const spec = buttons[index];
      button(ui, rect, { ...spec, id: `${id}/${spec.id ?? spec.label}` });
    });
    const trace = active.trace;
    const won = active.solved;
    counters(trace.counts).forEach((counter, index) => {
      const rect = layout.counters[index];
      paintCounter(ui, rect, counter, `counter-${counter.icon}`);
    });
    text(ui, layout.coaching, {
      text: pipeCoachingLine(trace.counts, won && trace.won),
      role: won && trace.won ? 'success' : 'secondary',
      wrap: true,
      maxLines: Math.max(1, Math.floor(layout.coaching.h / lineHeightOf(ui, 'body'))),
    });
    const geometry = fitPipeBoard(layout.board, shape, boardFit(ui));
    paintPipeBoard(ui.ctx, geometry, active.picture(ui.now));
    const accepting = active.acceptsTurns(ui.now);
    if (accepting) {
      board.tiles.forEach((_tile, cell) => {
        ui.hit(`tile-${cell}`, pipeCellRect(geometry, cell), {
          onTap: () => {
            cursor.cell = cell;
            cursor.shown = false;
            cursor.active = true;
            turn(cell, 'clockwise');
          },
          onSecondaryTap: () => {
            cursor.cell = cell;
            cursor.shown = false;
            turn(cell, 'anticlockwise');
          },
          focusable: false,
          sound: null,
        });
      });
    }
    if (accepting && cursor.shown) {
      drawFocusRing(ui, pipeCellRect(geometry, cursor.cell), ui.theme.radius.sm);
    }
    paintWinBanner(ui, geometry, active.winMoment(ui.now).banner);
  };

  const closeBoard = (): void => {
    confirmOpen = false;
    source.closePipeBoard();
  };

  const boardSurface: Surface = {
    id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    get blocksEscape(): boolean {
      return locked();
    },
    isOpen: () => source.isPipeBoardOpen,
    close: closeBoard,
    render: (ui) => {
      now = ui.now;
      if (seenOpenedAt !== ui.openedAt) {
        seenOpenedAt = ui.openedAt;
        view = null;
        confirmOpen = false;
        cursor.shown = false;
        cursor.active = true;
      }
      const active = currentView(ui.now);
      if (active !== null) {
        active.sync(ui.now);
        noteSolve();
      }
      const shape = active === null ? null : shapeOf(active.board);
      const buttons = footer(active);
      const beside = shape !== null && boardGoesBeside(ui, shape, buttons);
      const footerForLayout = beside ? [] : buttons;
      const chrome = { width: 'xl', title: TITLE, footer: footerForLayout } as const;
      const bodyMax = panelBodyMaxHeight(ui, { ...chrome, onClose: () => undefined });
      const buttonsShown = !locked();
      const reserved =
        buttonsShown || footerForLayout.length === 0 ? 0 : buttonHeight(ui) + ui.theme.space.lg;
      const p = panel(ui, {
        id,
        ...chrome,
        footer: buttonsShown ? footerForLayout : [],
        height: beside ? 'fill' : 'content',
        contentHeight: Math.min(bodyMax, wantedBodyHeight(ui, shape)) + reserved,
        footerLayout: 'end',
        onClose: locked() ? undefined : closeBoard,
      });
      const body: Rect = { ...p.body, h: p.body.h - reserved };
      if (active === null) renderGenerating(ui, body);
      else renderBoard(ui, body, active, beside, buttonsShown ? buttons : []);
    },
    onKey: (key, mods) => {
      const board = source.pipeBoard;
      if (key === 'Escape') return false;
      if (board === null) return false;
      if (locked()) return true;
      const active = view;
      if (active?.acceptsTurns(now) !== true) return false;
      if (key === 'Tab') {
        cursor.active = false;
        cursor.shown = false;
        return false;
      }
      const arrow = ARROWS[key];
      if (arrow !== undefined) {
        if (mods.predatesSurface === true) return true;
        if (cursor.shown) moveCursor(board, arrow[0], arrow[1]);
        cursor.shown = true;
        cursor.active = true;
        return true;
      }
      const clockwise = key === ' ' || key === 'Enter';
      if ((clockwise && cursor.active) || key === 'Backspace') {
        if (mods.repeat === true || mods.predatesSurface === true) return true;
        cursor.shown = true;
        cursor.active = true;
        turn(cursor.cell, clockwise ? 'clockwise' : 'anticlockwise');
        return true;
      }
      return false;
    },
  };

  const confirmSurface = choiceModalSurface({
    id: `${id}-restart`,
    isOpen: () => confirmOpen && source.isPipeBoardOpen,
    haltsWorld: true,
    locksKeyboard: true,
    escape: {
      kind: 'close',
      onEscape: () => {
        confirmOpen = false;
      },
    },
    content: () => ({
      id: 'confirm',
      title: CONFIRM_TITLE,
      body: CONFIRM_BODY,
      icon: 'alert',
      tone: 'danger',
      width: 'sm',
      defaultButton: 1,
      buttons: [
        {
          id: 'yes',
          label: CONFIRM_YES,
          variant: 'danger',
          onTap: () => {
            confirmOpen = false;
            source.restartPipeBoard();
          },
        },
        {
          id: 'no',
          label: CONFIRM_NO,
          onTap: () => {
            confirmOpen = false;
          },
        },
      ],
    }),
  });

  return [boardSurface, confirmSurface];
}
