/**
 * Illustrations for the Keyboard Hero tutorial in the spider's lab: the real
 * board, laid out in the illustration band, with notes falling to the
 * receptors on the first page and a hit beside a miss on the second.
 */

import { HIT_ZONE_IMG_CENTER } from '../../../systems/keyboardHeroGeometry';
import {
  computeKeyboardHeroLayout,
  LANE_BED_IMG_H,
  LANE_INDICES,
  noteImgYToScreenY,
  type KeyboardHeroLayout,
  type LaneIndex,
} from '../../../systems/keyboardHeroLayout';
import {
  clipToLanes,
  drawBoardBase,
  drawFirewallPip,
  drawLaneHighlight,
  drawNoteKeycap,
  drawReceptor,
  drawTouchButton,
} from '../../../systems/keyboardHeroBoardArt';
import { LANE_PALETTES } from '../../../sprites/art/keyboardHeroLanePalettes';
import { worldText } from '../../world/worldText';
import type { IllustrationRect } from './illustration';

const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const MS_PER_FRAME = MS_PER_SECOND / FRAMES_PER_SECOND;
const NOTE_CYCLE_MS = 1800;
const BOARD_BED_ALPHA = 1;
const BOARD_HIT_LINE_SCALE = 1;

/** The two notes the first page animates, and where each sits in the shared fall cycle. */
const DEMO_NOTES: ReadonlyArray<{ readonly lane: LaneIndex; readonly phase: number }> = [
  { lane: 1, phase: 0 },
  { lane: 3, phase: 0.45 },
];
/** How close to the hit line a demo note must be for its receptor to light up. */
const RECEPTOR_LIGHT_IMG = 60;
const HIT_DEMO_IMG_Y = HIT_ZONE_IMG_CENTER;
/** How far past the hit line the missed note has fallen: past saving. */
const MISS_DEMO_DROP_IMG = 84;
const MISS_DEMO_IMG_Y = HIT_ZONE_IMG_CENTER + MISS_DEMO_DROP_IMG;
const HIT_DEMO_LANE: LaneIndex = 1;
const MISS_DEMO_LANE: LaneIndex = 3;
const DEMO_HIGHLIGHT_STRENGTH = 0.8;

const KEY_ICON_SIZE = 34;
const KEY_ICON_TOP_PAD = 8;
/** Room under the board for the row of lane controls. */
const KEY_ROW_HEIGHT = KEY_ICON_SIZE + KEY_ICON_TOP_PAD * 2;

const CALLOUT_WIDTH_FRACTION = 0.86;
const CALLOUT_SIZE = 10;
const CALLOUT_LINE_H = 13;
const CALLOUT_TOP_FRACTION = 0.16;
const CALLOUT_HEADING_GAP = 15;
const CALLOUT_BODY_COLOR = '#cbd5e1';
const INFO_COLOR = '#93c5fd';
const HIT_COLOR = '#4ade80';
const DANGER_COLOR = '#ef4444';

const JUDGEMENT_SIZE = 13;
const JUDGEMENT_GAP = 6;
const JUDGEMENT_GLOW_BLUR = 8;

const PIP_SIZE = 16;
const PIP_GAP = 6;
/** Both pips the live board has, so the "two strikes" claim is literal. */
const PIP_COUNT = 2;
const PIP_Y_FRACTION = 0.62;
const PIP_LABEL_SIZE = 10;
const PIP_LABEL_COLOR = '#7c8ba1';

function drawCallout(
  ctx: CanvasRenderingContext2D,
  heading: string,
  body: string,
  color: string,
  gutterX: number,
  gutterW: number,
  boardH: number,
): void {
  const width = gutterW * CALLOUT_WIDTH_FRACTION;
  const x = gutterX + (gutterW - width) / 2;
  const y = boardH * CALLOUT_TOP_FRACTION;
  worldText(ctx, heading, {
    x: x + width / 2,
    y,
    size: CALLOUT_SIZE,
    bold: true,
    color,
    align: 'center',
  });
  worldText(ctx, body, {
    x,
    y: y + CALLOUT_HEADING_GAP,
    size: CALLOUT_SIZE,
    color: CALLOUT_BODY_COLOR,
    align: 'center',
    width,
    lineHeight: CALLOUT_LINE_H,
  });
}

function drawJudgement(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardHeroLayout,
  lane: LaneIndex,
  label: string,
  color: string,
): void {
  const receptor = layout.receptors[lane];
  worldText(ctx, label, {
    x: receptor.x + receptor.w / 2,
    y: receptor.y - JUDGEMENT_GAP - JUDGEMENT_SIZE,
    size: JUDGEMENT_SIZE,
    bold: true,
    color,
    align: 'center',
    glow: color,
    glowBlur: JUDGEMENT_GLOW_BLUR,
    outline: true,
  });
}

/** The same two pips the live board shows, with one already breached. */
function drawDemoPips(
  ctx: CanvasRenderingContext2D,
  gutterX: number,
  gutterW: number,
  boardH: number,
): void {
  const rowWidth = PIP_SIZE * PIP_COUNT + PIP_GAP * (PIP_COUNT - 1);
  const startX = gutterX + (gutterW - rowWidth) / 2;
  const y = boardH * PIP_Y_FRACTION;
  worldText(ctx, 'FIREWALL', {
    x: gutterX + gutterW / 2,
    y: y - PIP_LABEL_SIZE - JUDGEMENT_GAP,
    size: PIP_LABEL_SIZE,
    bold: true,
    color: PIP_LABEL_COLOR,
    align: 'center',
  });
  for (let pip = 0; pip < PIP_COUNT; pip++) {
    drawFirewallPip(
      ctx,
      { x: startX + pip * (PIP_SIZE + PIP_GAP), y, w: PIP_SIZE, h: PIP_SIZE },
      pip === 0,
    );
  }
}

/** Runs `paint` with the board laid out in the band's top, above the lane-control row. */
function onBoard(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  paint: (layout: KeyboardHeroLayout, boardH: number) => void,
): void {
  const boardH = rect.height - KEY_ROW_HEIGHT;
  const layout = computeKeyboardHeroLayout(rect.width, boardH, false);
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.beginPath();
  ctx.rect(0, 0, rect.width, boardH);
  ctx.clip();
  drawBoardBase(ctx, layout, () => BOARD_BED_ALPHA, BOARD_HIT_LINE_SCALE);
  paint(layout, boardH);
  ctx.restore();
}

/** One control per lane under the board: the keycap a desktop player sees, or the button a phone player taps. */
function drawLaneControls(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  touch: boolean,
): void {
  const columnW = rect.width / LANE_INDICES.length;
  const y = rect.y + rect.height - KEY_ROW_HEIGHT + KEY_ICON_TOP_PAD;
  for (const lane of LANE_INDICES) {
    const x = rect.x + lane * columnW + (columnW - KEY_ICON_SIZE) / 2;
    if (touch) {
      drawTouchButton(ctx, { x, y, w: KEY_ICON_SIZE, h: KEY_ICON_SIZE }, lane, 'idle');
    } else {
      drawNoteKeycap(
        ctx,
        lane,
        x + KEY_ICON_SIZE / 2,
        y + KEY_ICON_SIZE / 2,
        KEY_ICON_SIZE,
        'normal',
        1,
      );
    }
  }
}

/** How a tutorial page is drawn. */
export interface SpiderArtOptions {
  /** The lane controls are phone buttons rather than keycaps. */
  readonly touch: boolean;
  /**
   * Label the board from the gutters either side of it. A band with no room
   * for them leaves them out: the page's text says the same.
   */
  readonly callouts: boolean;
}

/** Notes falling to the receptors, with the lane controls underneath. */
export function drawFallingNotesPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
  opts: SpiderArtOptions,
): void {
  const cyclePosition = ((frame * MS_PER_FRAME) % NOTE_CYCLE_MS) / NOTE_CYCLE_MS;
  const demoNotes = DEMO_NOTES.map((demo) => ({
    lane: demo.lane,
    imgY: ((cyclePosition + demo.phase) % 1) * LANE_BED_IMG_H,
  }));
  onBoard(ctx, rect, (layout, boardH) => {
    ctx.save();
    clipToLanes(ctx, layout);
    for (const note of demoNotes) {
      const laneRect = layout.lanes[note.lane];
      drawNoteKeycap(
        ctx,
        note.lane,
        laneRect.x + laneRect.w / 2,
        noteImgYToScreenY(layout, note.imgY),
        layout.noteSize,
        'normal',
        1,
      );
    }
    ctx.restore();
    for (const lane of LANE_INDICES) {
      const arriving = demoNotes.some(
        (note) =>
          note.lane === lane && Math.abs(note.imgY - HIT_ZONE_IMG_CENTER) < RECEPTOR_LIGHT_IMG,
      );
      drawReceptor(ctx, layout, lane, arriving ? 'flash' : 'idle');
    }
    if (!opts.callouts) return;
    drawCallout(
      ctx,
      'FOUR LANES',
      'Every lane has its own colour and its own arrow.',
      INFO_COLOR,
      0,
      layout.board.x,
      boardH,
    );
    const rightGutterX = layout.board.x + layout.board.w;
    drawCallout(
      ctx,
      'THE RECEPTORS',
      'Notes fall to the rings at the bottom. That is where you press.',
      INFO_COLOR,
      rightGutterX,
      rect.width - rightGutterX,
      boardH,
    );
  });
  drawLaneControls(ctx, rect, opts.touch);
}

/** A clean hit in one lane beside a missed note in the next. */
export function drawHitMissPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  opts: Pick<SpiderArtOptions, 'callouts'>,
): void {
  onBoard(ctx, rect, (layout, boardH) => {
    drawLaneHighlight(
      ctx,
      layout,
      HIT_DEMO_LANE,
      LANE_PALETTES[HIT_DEMO_LANE].hue,
      DEMO_HIGHLIGHT_STRENGTH,
    );
    drawLaneHighlight(ctx, layout, MISS_DEMO_LANE, DANGER_COLOR, DEMO_HIGHLIGHT_STRENGTH);
    ctx.save();
    clipToLanes(ctx, layout);
    const hitRect = layout.lanes[HIT_DEMO_LANE];
    drawNoteKeycap(
      ctx,
      HIT_DEMO_LANE,
      hitRect.x + hitRect.w / 2,
      noteImgYToScreenY(layout, HIT_DEMO_IMG_Y),
      layout.noteSize,
      'hit',
      1,
    );
    const missRect = layout.lanes[MISS_DEMO_LANE];
    drawNoteKeycap(
      ctx,
      MISS_DEMO_LANE,
      missRect.x + missRect.w / 2,
      noteImgYToScreenY(layout, MISS_DEMO_IMG_Y),
      layout.noteSize,
      'missed',
      1,
    );
    ctx.restore();
    for (const lane of LANE_INDICES) {
      drawReceptor(ctx, layout, lane, lane === HIT_DEMO_LANE ? 'flash' : 'idle');
    }
    drawJudgement(ctx, layout, HIT_DEMO_LANE, 'PERFECT!', LANE_PALETTES[HIT_DEMO_LANE].light);
    drawJudgement(ctx, layout, MISS_DEMO_LANE, 'MISS', DANGER_COLOR);
    if (!opts.callouts) return;
    drawCallout(
      ctx,
      '✓  HIT',
      'Press the lane’s key as the note reaches its ring.',
      HIT_COLOR,
      0,
      layout.board.x,
      boardH,
    );
    const rightGutterX = layout.board.x + layout.board.w;
    const rightGutterW = rect.width - rightGutterX;
    drawCallout(
      ctx,
      '✗  MISS',
      'A missed note breaks a firewall pip. Two breaks and the hack is over.',
      DANGER_COLOR,
      rightGutterX,
      rightGutterW,
      boardH,
    );
    drawDemoPips(ctx, rightGutterX, rightGutterW, boardH);
  });
}
