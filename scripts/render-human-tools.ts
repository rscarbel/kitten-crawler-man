/**
 * Review harness for Carl's resource-node swings: the chop and mine rows in
 * all three views with the working tool drawn over them exactly as the game
 * draws it, at every tier.
 *
 *   npm run render:human-tools
 *   npx tsx scripts/render-human-tools.ts --out=preview/human-tools.png
 *
 * Runs the tool gates first and exits non-zero if any fails, then bakes one
 * sheet: each row large at tier 0 (mirrored profile rows included, which is
 * how he faces west), then every row at the 32 px tile once per tier, and the
 * same strip blown up three times with nearest-neighbour so a reviewer can
 * see the in-game pixels.
 */

import { createCanvas, type Canvas } from 'canvas';
import { asGameContext, type NodeContext } from './nodeGameContext.js';
import { bakeFigureCell } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { humanToolGateFailures } from './gates-human-tools.js';
import {
  CHOP_ROWS,
  eventFrame,
  FRAME_H,
  FRAME_W,
  HUMAN_FIGURE,
  HUMAN_ROW_TABLE,
  type HumanRowName,
  MINE_ROWS,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import { TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import { drawToolOverlay, toolOverlayOf } from '../src/sprites/toolOverlaySprite.js';
import {
  MAX_TOOL_TIER,
  TOOL_TIER_BASIC,
  TOOL_TIER_RATKIN_FORGE,
  isToolTier,
  type ToolKind,
  type ToolTier,
} from '../src/core/toolTiers.js';

const DEFAULT_OUT = `${PREVIEW_DIR}/human-tools.png`;
const LABEL_FONT = '13px sans-serif';
const LABEL_HEIGHT = 18;
const LABEL_COLOR = '#e8e8e8';
const SHEET_BACKGROUND = '#34363c';
/** The in-game strips sit on grass, which is what he chops and mines on. */
const GRASS = '#3f5a2c';
const IN_GAME_TILE = 32;
/** Blow-up of the in-game strip, nearest-neighbour, so its real pixels can be judged. */
const BLOW_UP = 3;
/** The large cells are the art's own cell, cropped to the band he and his tool occupy. */
const LARGE_CROP_TOP = 20;
const LARGE_CROP_HEIGHT = 170;
const GAP = 6;
/** Gaps round and between the sheet's three sections. */
const SECTION_GAPS = 4;
/** The blown-up strip shows the forge tier: bronze on the grass is the hardest head to read. */
const BLOW_UP_TIER: ToolTier = TOOL_TIER_RATKIN_FORGE;
/** The tier comparison shows a raised frame this long before the blow, then the blow. */
const FRAMES_BEFORE_IMPACT_COMPARED = 3;
/** The whole-row strip at one tier, and the tier comparison. */
const BLOW_UP_SECTIONS = 2;

interface ToolRow {
  readonly row: HumanRowName;
  readonly kind: ToolKind;
}

const TOOL_ROWS: readonly ToolRow[] = [
  ...Object.values(CHOP_ROWS).map((row) => ({ row, kind: 'axe' as const })),
  ...Object.values(MINE_ROWS).map((row) => ({ row, kind: 'pickaxe' as const })),
];

const TIERS: readonly ToolTier[] = Array.from(
  { length: MAX_TOOL_TIER + 1 },
  (_unused, i) => i,
).filter(isToolTier);

function parseOut(): string {
  const prefix = '--out=';
  const flag = process.argv.find((arg) => arg.startsWith(prefix));
  return flag === undefined ? DEFAULT_OUT : flag.slice(prefix.length);
}

function label(ctx: NodeContext, text: string, x: number, y: number): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

const cellCache = new Map<string, Canvas>();

function cellOf(row: HumanRowName, frame: number): Canvas {
  const cacheKey = `${row}:${frame}`;
  const known = cellCache.get(cacheKey);
  if (known !== undefined) return known;
  const cell = bakeFigureCell(HUMAN_FIGURE, row, frame);
  cellCache.set(cacheKey, cell);
  return cell;
}

/**
 * One frame with its tool, the cell's top-left at (`x`, `y`) scaled by
 * `scale`, mirrored about the tile's centre when `flipX` — how the runtime
 * draws him facing −X.
 */
function drawWorkingCell(
  ctx: NodeContext,
  toolRow: ToolRow,
  frame: number,
  tier: ToolTier,
  x: number,
  y: number,
  scale: number,
  flipX: boolean,
): void {
  const placement = toolOverlayOf({ row: toolRow.row, frame, flipX });
  const tileSize = TILE_SCALE * scale;
  const sx = x + TILE_X * scale;
  const sy = y + TILE_Y * scale;
  const game = asGameContext(ctx);
  if (placement?.behindFigure === true) {
    drawToolOverlay(game, toolRow.kind, tier, placement, sx, sy, tileSize);
  }
  ctx.save();
  if (flipX) {
    ctx.translate(x + (FRAME_W * scale) / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(x + (FRAME_W * scale) / 2), 0);
  }
  ctx.drawImage(cellOf(toolRow.row, frame), x, y, FRAME_W * scale, FRAME_H * scale);
  ctx.restore();
  if (placement?.behindFigure === false) {
    drawToolOverlay(game, toolRow.kind, tier, placement, sx, sy, tileSize);
  }
}

/** One strip of cells at the 32 px tile on grass, blown up nearest-neighbour onto the sheet. */
function blowUpStrip(
  ctx: NodeContext,
  toolRow: ToolRow,
  cells: readonly { frame: number; tier: ToolTier }[],
  y: number,
  smallScale: number,
): void {
  const cellW = FRAME_W * smallScale;
  const strip = createCanvas(cells.length * cellW, FRAME_H * smallScale);
  const stripCtx = strip.getContext('2d');
  stripCtx.fillStyle = GRASS;
  stripCtx.fillRect(0, 0, strip.width, strip.height);
  cells.forEach(({ frame, tier }, index) => {
    drawWorkingCell(stripCtx, toolRow, frame, tier, index * cellW, 0, smallScale, false);
  });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(strip, GAP, y, strip.width * BLOW_UP, strip.height * BLOW_UP);
  ctx.imageSmoothingEnabled = true;
}

function frameCount(row: HumanRowName): number {
  return HUMAN_ROW_TABLE[row].frameCount;
}

function render(): Canvas {
  const maxFrames = Math.max(...TOOL_ROWS.map((toolRow) => frameCount(toolRow.row)));
  const largeRows: { toolRow: ToolRow; flipX: boolean }[] = [];
  for (const toolRow of TOOL_ROWS) {
    largeRows.push({ toolRow, flipX: false });
    if (HUMAN_ROW_TABLE[toolRow.row].mirrorable) largeRows.push({ toolRow, flipX: true });
  }
  const smallScale = IN_GAME_TILE / TILE_SCALE;
  const smallCellW = FRAME_W * smallScale;
  const smallCellH = FRAME_H * smallScale;
  const stripBandH = LABEL_HEIGHT + smallCellH;
  const width = Math.max(maxFrames * FRAME_W, maxFrames * smallCellW * BLOW_UP) + GAP * 2;
  const largeBandH = LABEL_HEIGHT + LARGE_CROP_HEIGHT;
  const smallSectionH = TOOL_ROWS.length * TIERS.length * stripBandH;
  const blowSectionH = BLOW_UP_SECTIONS * TOOL_ROWS.length * (LABEL_HEIGHT + smallCellH * BLOW_UP);
  const height = largeRows.length * largeBandH + smallSectionH + blowSectionH + SECTION_GAPS * GAP;

  const sheet = createCanvas(width, height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  let y = GAP;
  for (const { toolRow, flipX } of largeRows) {
    label(
      ctx,
      `${toolRow.row}${flipX ? ' (facing −X)' : ''} — tier 0, impact frame marked *`,
      GAP,
      y,
    );
    y += LABEL_HEIGHT;
    const impact = eventFrame(toolRow.row, 'impact');
    for (let frame = 0; frame < frameCount(toolRow.row); frame++) {
      const x = GAP + frame * FRAME_W;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, FRAME_W, LARGE_CROP_HEIGHT);
      ctx.clip();
      drawWorkingCell(ctx, toolRow, frame, TOOL_TIER_BASIC, x, y - LARGE_CROP_TOP, 1, flipX);
      ctx.restore();
      label(ctx, frame === impact ? `${frame}*` : `${frame}`, x + GAP, y);
    }
    y += LARGE_CROP_HEIGHT;
  }

  y += GAP;
  for (const toolRow of TOOL_ROWS) {
    for (const tier of TIERS) {
      label(ctx, `${toolRow.row} at the 32 px tile, tier ${tier}`, GAP, y);
      y += LABEL_HEIGHT;
      ctx.fillStyle = GRASS;
      ctx.fillRect(GAP, y, frameCount(toolRow.row) * smallCellW, smallCellH);
      for (let frame = 0; frame < frameCount(toolRow.row); frame++) {
        drawWorkingCell(ctx, toolRow, frame, tier, GAP + frame * smallCellW, y, smallScale, false);
      }
      y += smallCellH;
    }
  }

  y += GAP;
  for (const toolRow of TOOL_ROWS) {
    label(ctx, `${toolRow.row}, tier ${BLOW_UP_TIER}, 32 px tile blown up ${BLOW_UP}×`, GAP, y);
    y += LABEL_HEIGHT;
    const cells = Array.from({ length: frameCount(toolRow.row) }, (_unused, frame) => ({
      frame,
      tier: BLOW_UP_TIER,
    }));
    blowUpStrip(ctx, toolRow, cells, y, smallScale);
    y += smallCellH * BLOW_UP;
  }

  y += GAP;
  for (const toolRow of TOOL_ROWS) {
    const impact = eventFrame(toolRow.row, 'impact') ?? 0;
    const raised =
      (impact - FRAMES_BEFORE_IMPACT_COMPARED + frameCount(toolRow.row)) % frameCount(toolRow.row);
    label(
      ctx,
      `${toolRow.row}, frames ${raised} and ${impact} at tiers ${TIERS.join(', ')} side by side, blown up ${BLOW_UP}×`,
      GAP,
      y,
    );
    y += LABEL_HEIGHT;
    const cells = [
      ...TIERS.map((tier) => ({ frame: raised, tier })),
      ...TIERS.map((tier) => ({ frame: impact, tier })),
    ];
    blowUpStrip(ctx, toolRow, cells, y, smallScale);
    y += smallCellH * BLOW_UP;
  }
  return sheet;
}

const failures = humanToolGateFailures();
for (const failure of failures) console.error(`  FAIL human tools: ${failure}`);
const written = writePreviewPng(parseOut(), render().toBuffer('image/png'));
console.log(`Wrote ${written}`);
if (failures.length > 0) process.exit(1);
