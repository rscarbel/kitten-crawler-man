#!/usr/bin/env tsx
/**
 * The keyboard-hero board review harness.
 *
 * The board's pieces are layers, not pictures: on its own the console frame is a
 * window with nothing behind it, a lane bed is a stripe, and a keycap is a
 * swatch. The only way to judge any of them is assembled — through the same
 * `computeKeyboardHeroLayout` rects the runtime positions them with — so that is
 * what this draws, at a desktop fit and at a phone fit, beside every state of
 * every per-lane piece.
 *
 * The art is painted rather than baked, so this runs the game's own painter
 * through `nodeGameContext` — the same functions the runtime cache runs, at the
 * same supersampled size — instead of decoding sheets.
 *
 * The layers go down in the order `drawBoardBase` composites them in the game:
 * the console housing first, the lane beds into its well. That order is not
 * cosmetic — the frame's well is opaque, so the other order hides every lane hue —
 * and it is restated here rather than imported because the drawing module reaches
 * for `OffscreenCanvas`, which node does not have.
 *
 * The gates run first, before the contact sheet is allocated, so a failure is
 * reported against the art rather than after a multi-megapixel canvas.
 *
 *   npm run render:keyboard-hero
 *   npx tsx scripts/render-keyboard-hero.ts --out=board.png
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import { reportFigureGates } from './figureGates.js';
import {
  NOTE_STATES,
  RECEPTOR_STATES,
  TOUCH_STATES,
  keyboardHeroGateFailures,
  paintKeyboardHeroArt,
} from './gates-keyboard-hero.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { HIT_ZONE_IMG_CENTER } from '../src/systems/keyboardHeroGeometry.js';
import {
  BOARD_BAKE_SCALE,
  BOARD_IMG_H,
  BOARD_IMG_W,
  LANE_BED_IMG_H,
  LANE_BED_IMG_W,
  LANE_INDICES,
  LANE_PALETTES,
  NOTE_IMG_SIZE,
  RECEPTOR_IMG_SIZE,
  TOUCH_IMG_SIZE,
  computeKeyboardHeroLayout,
  noteImgYToScreenY,
  type KeyboardHeroLayout,
  type LaneIndex,
  type LanePalette,
  type Rect,
} from '../src/systems/keyboardHeroLayout.js';
import {
  paintBoardFrame,
  paintLaneBed,
  paintLaneHighlight,
  paintNoteKeycap,
  paintReceptor,
  paintTouchButton,
  type NoteState,
  type ReceptorState,
  type TouchState,
} from '../src/sprites/art/keyboardHeroArt.js';

const BACKDROP = '#0b0f14';
const PANEL_BACKDROP = '#05070a';
const LABEL_COLOR = '#e8eef6';
const SUBLABEL_COLOR = '#8fa3bd';
const LABEL_FONT = 'bold 20px sans-serif';
const CAPTION_FONT = '15px sans-serif';
const TITLE_FONT = 'bold 26px sans-serif';

const MARGIN = 28;
const SECTION_GAP = 40;
const LABEL_HEIGHT = 30;
const CAPTION_HEIGHT = 24;
const SWATCH_GAP = 14;

/** The hit line the runtime paints over the beds, redrawn here as a review annotation. */
const HIT_LINE_COLOR = 'rgba(255,255,255,0.75)';
const HIT_LINE_IMG_H = 2.5;
const HIT_BAND_COLOR = 'rgba(255,255,255,0.1)';

/** Depth of the first review note down the lane, as a fraction of the bed. */
const FIRST_NOTE_DEPTH = 0.14;
const NOTE_DEPTH_STRIDE = 0.16;

interface BoardPanel {
  readonly caption: string;
  readonly viewportW: number;
  readonly viewportH: number;
  readonly isMobile: boolean;
}

/**
 * A desktop board is height-bound at every ordinary desktop aspect, so a narrow
 * simulated viewport renders exactly the board a 1280×720 window does while
 * spending a third of the contact sheet's width on it.
 */
const DESKTOP_PANEL_W = 620;
const DESKTOP_PANEL_H = 720;
const MOBILE_PANEL_W = 390;
const MOBILE_PANEL_H = 844;

const BOARD_PANELS: readonly BoardPanel[] = [
  {
    caption: 'desktop fit',
    viewportW: DESKTOP_PANEL_W,
    viewportH: DESKTOP_PANEL_H,
    isMobile: false,
  },
  {
    caption: '390×844 phone fit, with the touch row',
    viewportW: MOBILE_PANEL_W,
    viewportH: MOBILE_PANEL_H,
    isMobile: true,
  },
];

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function text(ctx: Ctx, value: string, x: number, y: number, font: string, color: string): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

// ── The painted pieces ──────────────────────────────────────────────────────

const paintedPieces = new Map<string, Canvas>();

/**
 * One piece, painted at the supersampled size the runtime paints it at and kept
 * for the rest of the run — the harness's stand-in for `keyboardHeroArtCache`,
 * so the contact sheet is assembled out of blits of exactly what the game blits.
 */
function piece(
  key: string,
  imgW: number,
  imgH: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Canvas {
  const cached = paintedPieces.get(key);
  if (cached !== undefined) return cached;
  const canvas = createCanvas(imgW * BOARD_BAKE_SCALE, imgH * BOARD_BAKE_SCALE);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.clip();
  paint(ctx, canvas.width, canvas.height);
  ctx.restore();
  paintedPieces.set(key, canvas);
  return canvas;
}

function paletteFor(lane: LaneIndex): LanePalette {
  return LANE_PALETTES[lane];
}

function framePiece(): Canvas {
  return piece('frame', BOARD_IMG_W, BOARD_IMG_H, paintBoardFrame);
}

function bedPiece(lane: LaneIndex): Canvas {
  return piece(`lane_${lane}`, LANE_BED_IMG_W, LANE_BED_IMG_H, (ctx, w, h) =>
    paintLaneBed(ctx, w, h, paletteFor(lane)),
  );
}

function highlightPiece(): Canvas {
  return piece('highlight', LANE_BED_IMG_W, LANE_BED_IMG_H, paintLaneHighlight);
}

function notePiece(state: NoteState, lane: LaneIndex): Canvas {
  return piece(`note_${state}_${lane}`, NOTE_IMG_SIZE, NOTE_IMG_SIZE, (ctx, w) =>
    paintNoteKeycap(ctx, w, paletteFor(lane), state),
  );
}

function receptorPiece(state: ReceptorState, lane: LaneIndex): Canvas {
  return piece(`receptor_${state}_${lane}`, RECEPTOR_IMG_SIZE, RECEPTOR_IMG_SIZE, (ctx, w) =>
    paintReceptor(ctx, w, paletteFor(lane), state),
  );
}

function touchPiece(state: TouchState, lane: LaneIndex): Canvas {
  return piece(`touch_${state}_${lane}`, TOUCH_IMG_SIZE, TOUCH_IMG_SIZE, (ctx, w) =>
    paintTouchButton(ctx, w, paletteFor(lane), state),
  );
}

function blit(ctx: Ctx, art: Canvas, rect: Rect): void {
  ctx.drawImage(art, rect.x, rect.y, rect.width, rect.height);
}

// ── The assembled board ─────────────────────────────────────────────────────

function drawLaneBeds(ctx: Ctx, layout: KeyboardHeroLayout): void {
  for (const lane of LANE_INDICES) blit(ctx, bedPiece(lane), layout.lanes[lane]);
}

function drawHitWindow(ctx: Ctx, layout: KeyboardHeroLayout): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = HIT_BAND_COLOR;
  ctx.fillRect(
    layout.laneArea.x,
    layout.hitLineY - layout.hitWindowHalfHeight,
    layout.laneArea.width,
    layout.hitWindowHalfHeight * 2,
  );
  ctx.fillStyle = HIT_LINE_COLOR;
  const lineH = Math.max(1, HIT_LINE_IMG_H * layout.scale);
  ctx.fillRect(layout.laneArea.x, layout.hitLineY - lineH / 2, layout.laneArea.width, lineH);
  ctx.restore();
}

function drawReviewNotes(ctx: Ctx, layout: KeyboardHeroLayout): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.laneArea.x, layout.laneArea.y, layout.laneArea.width, layout.laneArea.height);
  ctx.clip();
  for (const lane of LANE_INDICES) {
    const depth = FIRST_NOTE_DEPTH + lane * NOTE_DEPTH_STRIDE;
    const centerY = noteImgYToScreenY(layout, depth * LANE_BED_IMG_H);
    const laneRect = layout.lanes[lane];
    blit(ctx, notePiece('normal', lane), {
      x: laneRect.x + (laneRect.width - layout.noteSize) / 2,
      y: centerY - layout.noteSize / 2,
      width: layout.noteSize,
      height: layout.noteSize,
    });
  }
  ctx.restore();
}

function drawBoardPanel(ctx: Ctx, panel: BoardPanel): void {
  const layout = computeKeyboardHeroLayout(panel.viewportW, panel.viewportH, panel.isMobile);

  ctx.fillStyle = PANEL_BACKDROP;
  ctx.fillRect(0, 0, panel.viewportW, panel.viewportH);

  blit(ctx, framePiece(), layout.board);
  drawLaneBeds(ctx, layout);
  drawHitWindow(ctx, layout);

  drawReviewNotes(ctx, layout);
  for (const lane of LANE_INDICES) {
    blit(ctx, receptorPiece('idle', lane), layout.receptors[lane]);
  }

  const buttons = layout.touchButtons;
  if (buttons !== null) {
    for (const lane of LANE_INDICES) blit(ctx, touchPiece('idle', lane), buttons[lane]);
  }
}

// ── Per-state swatches ──────────────────────────────────────────────────────

interface SwatchFamily {
  readonly title: string;
  readonly stateNames: readonly string[];
  readonly size: number;
  readonly art: (stateIndex: number, lane: LaneIndex) => Canvas;
}

const SWATCH_FAMILIES: readonly SwatchFamily[] = [
  {
    title: 'Notes — lane × state',
    stateNames: NOTE_STATES,
    size: NOTE_IMG_SIZE,
    art: (index, lane) => notePiece(NOTE_STATES[index], lane),
  },
  {
    title: 'Receptors — lane × state',
    stateNames: RECEPTOR_STATES,
    size: RECEPTOR_IMG_SIZE,
    art: (index, lane) => receptorPiece(RECEPTOR_STATES[index], lane),
  },
  {
    title: 'Touch buttons — lane × state',
    stateNames: TOUCH_STATES,
    size: TOUCH_IMG_SIZE,
    art: (index, lane) => touchPiece(TOUCH_STATES[index], lane),
  },
];

/** Each family is a block of lane rows; every cell carries its lane name and state. */
function swatchBlockHeight(family: SwatchFamily): number {
  return LABEL_HEIGHT + LANE_INDICES.length * (family.size + CAPTION_HEIGHT + SWATCH_GAP);
}

function drawSwatchFamily(ctx: Ctx, family: SwatchFamily, top: number): void {
  text(ctx, family.title, MARGIN, top + LABEL_HEIGHT - 8, LABEL_FONT, LABEL_COLOR);
  const rowHeight = family.size + CAPTION_HEIGHT + SWATCH_GAP;
  for (const lane of LANE_INDICES) {
    const rowTop = top + LABEL_HEIGHT + lane * rowHeight;
    family.stateNames.forEach((state, index) => {
      const x = MARGIN + index * (family.size + SWATCH_GAP);
      const rect: Rect = { x, y: rowTop, width: family.size, height: family.size };
      // Painted on the lane's own bed rather than on the page, because that is
      // the only surface any of these art states is ever seen against.
      drawSwatchBed(ctx, lane, rect);
      blit(ctx, family.art(index, lane), rect);
      text(
        ctx,
        `${LANE_PALETTES[lane].name} · ${state}`,
        x,
        rowTop + family.size + CAPTION_HEIGHT - 8,
        CAPTION_FONT,
        SUBLABEL_COLOR,
      );
    });
  }
}

/** The slice of the lane bed that sits behind a note at the hit line. */
function drawSwatchBed(ctx: Ctx, lane: LaneIndex, rect: Rect): void {
  const bed = bedPiece(lane);
  const sourceH = rect.height * BOARD_BAKE_SCALE;
  ctx.drawImage(
    bed,
    0,
    HIT_ZONE_IMG_CENTER * BOARD_BAKE_SCALE - sourceH / 2,
    bed.width,
    sourceH,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

/** Bed strip block: the four beds full depth, plus the neutral highlight strip. */
const BED_STRIP_W = LANE_BED_IMG_W;
const BED_STRIP_H = 560;

function drawBedStrips(ctx: Ctx, top: number): void {
  text(
    ctx,
    'Lane beds at full depth, and the neutral highlight strip the runtime tints',
    MARGIN,
    top + LABEL_HEIGHT - 8,
    LABEL_FONT,
    LABEL_COLOR,
  );
  const strips: { readonly caption: string; readonly art: Canvas }[] = LANE_INDICES.map((lane) => ({
    caption: LANE_PALETTES[lane].name,
    art: bedPiece(lane),
  }));
  strips.push({ caption: 'highlight', art: highlightPiece() });

  strips.forEach((strip, index) => {
    const x = MARGIN + index * (BED_STRIP_W + SWATCH_GAP);
    const y = top + LABEL_HEIGHT;
    ctx.fillStyle = PANEL_BACKDROP;
    ctx.fillRect(x, y, BED_STRIP_W, BED_STRIP_H);
    blit(ctx, strip.art, { x, y, width: BED_STRIP_W, height: BED_STRIP_H });
    text(ctx, strip.caption, x, y + BED_STRIP_H + CAPTION_HEIGHT - 8, CAPTION_FONT, SUBLABEL_COLOR);
  });
}

function main(): void {
  reportFigureGates('keyboard hero', keyboardHeroGateFailures(paintKeyboardHeroArt()));

  const panelsWidth =
    BOARD_PANELS.reduce((total, panel) => total + panel.viewportW, 0) +
    SWATCH_GAP * (BOARD_PANELS.length - 1);
  const panelsHeight = Math.max(...BOARD_PANELS.map((panel) => panel.viewportH));
  const swatchesHeight = SWATCH_FAMILIES.reduce(
    (total, family) => total + swatchBlockHeight(family) + SECTION_GAP,
    0,
  );
  const bedsHeight = LABEL_HEIGHT + BED_STRIP_H + CAPTION_HEIGHT;

  const width = Math.max(
    panelsWidth + MARGIN * 2,
    MARGIN * 2 + (BED_STRIP_W + SWATCH_GAP) * (LANE_INDICES.length + 1),
  );
  const boardTop = MARGIN + LABEL_HEIGHT * 2;
  const swatchTop = boardTop + panelsHeight + CAPTION_HEIGHT + SECTION_GAP;
  const height = swatchTop + swatchesHeight + bedsHeight + MARGIN;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);

  text(
    ctx,
    'Keyboard hero — board review harness',
    MARGIN,
    MARGIN + LABEL_HEIGHT - 8,
    TITLE_FONT,
    LABEL_COLOR,
  );

  let panelX = MARGIN;
  for (const panel of BOARD_PANELS) {
    ctx.save();
    ctx.translate(panelX, boardTop);
    drawBoardPanel(ctx, panel);
    ctx.restore();
    text(
      ctx,
      panel.caption,
      panelX,
      boardTop + panel.viewportH + CAPTION_HEIGHT - 8,
      CAPTION_FONT,
      SUBLABEL_COLOR,
    );
    panelX += panel.viewportW + SWATCH_GAP;
  }

  let sectionTop = swatchTop;
  for (const family of SWATCH_FAMILIES) {
    drawSwatchFamily(ctx, family, sectionTop);
    sectionTop += swatchBlockHeight(family) + SECTION_GAP;
  }
  drawBedStrips(ctx, sectionTop);

  const outPath = parseFlag('out', `${PREVIEW_DIR}/keyboard-hero-review.png`);
  const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${width}×${height}px)`);
}

main();
