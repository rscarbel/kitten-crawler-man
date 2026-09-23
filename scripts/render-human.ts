/**
 * Carl's review harness. Art has to be judged as an image, by something that
 * only looks at the image — every defect that has ever mattered on a figure in
 * this project was invisible to `typecheck`, `lint` and a code read.
 *
 * The contact sheet is painted from `HUMAN_FIGURE` the way the runtime cache
 * bakes it, and the art gates run as part of the render — in the default
 * outfit, bare and in all his gear — so one command answers both "does it
 * still hold together" and "what does it look like".
 *
 *   npm run render:human
 *   npx tsx scripts/render-human.ts --row=smush --scale=4
 *   npx tsx scripts/render-human.ts --part=head --scale=6
 *   npx tsx scripts/render-human.ts --row=walk_side --mode=onion --scale=3
 *   npx tsx scripts/render-human.ts --frame=4 --row=jab_side --scale=8
 *
 *   npx tsx scripts/render-human.ts --mode=trails --row=walk_side --scale=3
 *     Per-frame joint paths (both ankles, both wrists, pelvis, head, and the
 *     stamp anchor for rows that have one) over a faint onion, with a ground
 *     line. Travelling rows also get a ground-plane panel: a planted foot is
 *     a dot there, a skating one a smear.
 *
 *   npx tsx scripts/render-human.ts --mode=strip32 --row=walk_side
 *   npx tsx scripts/render-human.ts --mode=strip32
 *     Every frame of a row (or, with no --row, every row) at the in-game
 *     32 px tile size on the dungeon floor, plus the same strip again at 2×
 *     nearest-neighbour underneath so the pixels are inspectable.
 *
 *   npx tsx scripts/render-human.ts --mode=compare --against=<png>
 *     The current sheet-style render beside a previous render or a reference
 *     PNG, both scaled so their figure content is the same height (found by
 *     bounding box against each image's own corner colour, so mismatched
 *     padding or backdrop between the two doesn't skew the comparison) and
 *     aligned at the top.
 *
 *   npx tsx scripts/render-human.ts --row=jab_side --frame=4 --ref=<png>
 *     Works alongside sheet/onion/delta on a single frame (--row and --frame
 *     both required): places the reference image beside that frame, scaled so
 *     its content height matches Carl's own head-to-ground height there.
 *
 * A run with no --row stacks every declared row into one contact sheet, which
 * for `sheet`/`onion`/`delta`/`strip32` can want a canvas taller than the
 * platform allows. Those modes paginate automatically: `--out=foo.png` becomes
 * `foo-p1.png`, `foo-p2.png`, … whenever more than one page is needed, and a
 * run that fits on one page keeps writing exactly `foo.png`.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { type NodeContext } from './nodeGameContext.js';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { humanGateFailures } from './gates-human.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  BARE_HUMAN_APPEARANCE,
  DEFAULT_HUMAN_APPEARANCE,
  HUMAN_APPEARANCE_FLAGS,
  type HumanAppearance,
  humanAppearanceKey,
  humanFigureWearing,
  parseHumanAppearance,
} from '../src/sprites/art/human/appearance.js';
import {
  HUMAN_ROW_NAMES,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  humanRowOf,
  type HumanRowName,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import { TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import {
  HUMAN_GROUND_Y,
  probeHumanJoints,
  type HumanJointProbe,
  type ProbedLeg,
  TRAVEL_DIRECTION,
  floorDriftPerFrameCellPx,
} from '../src/sprites/art/human/probe.js';
import { type Pt } from '../src/sprites/art/carlArt.js';
import { HEAD_RY } from '../src/sprites/art/carl/proportions.js';
import { TILE_SIZE } from '../src/core/constants.js';

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const ONION_ALPHA = 0.4;
const NO_FRAME = -1;
const MAX_FRAME_FLAG = 64;

type Mode = 'sheet' | 'onion' | 'delta' | 'trails' | 'strip32' | 'compare';
const MODES: ReadonlyArray<Mode> = ['sheet', 'onion', 'delta', 'trails', 'strip32', 'compare'];
/** Modes that share the grid-of-cells pipeline; `compare` renders as `sheet` first. */
type GridMode = 'sheet' | 'onion' | 'delta';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one body part, as fractions of the frame so the table survives
 * the figure re-deriving its own cell size. Whole-figure contact sheets hide
 * exactly the defects that matter most at these sizes.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.32, y: 0.32, w: 0.36, h: 0.36 },
  torso: { x: 0.21, y: 0.31, w: 0.58, h: 0.42 },
  hands: { x: 0.17, y: 0.47, w: 0.67, h: 0.31 },
  legs: { x: 0.21, y: 0.63, w: 0.58, h: 0.37 },
  feet: { x: 0.21, y: 0.78, w: 0.58, h: 0.22 },
};

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** The flag's value, or null when the flag was not passed at all. */
function parseOptionalFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

/**
 * The outfit to paint and gate him in: `--gear=cloak+gauntlet+trollskinShirt`,
 * flags joined by `+` as `humanAppearanceKey` writes them, or `bare`. Absent
 * is his default outfit. Each outfit is a figure of its own, so each is gated
 * on its own.
 */
function parseAppearance(): HumanAppearance {
  const raw = GEAR_FLAG;
  if (raw === null) return DEFAULT_HUMAN_APPEARANCE;
  const appearance = parseHumanAppearance(raw);
  if (appearance === null) {
    throw new Error(`--gear=${raw} names a flag outside ${HUMAN_APPEARANCE_FLAGS.join(', ')}`);
  }
  return appearance;
}

const GEAR_FLAG = parseOptionalFlag('gear');
const APPEARANCE = parseAppearance();
const FIGURE = humanFigureWearing(APPEARANCE);

function everyPieceOfGear(): HumanAppearance {
  const appearance = parseHumanAppearance(HUMAN_APPEARANCE_FLAGS.join('+'));
  if (appearance === null) throw new Error('the full set of gear flags does not parse');
  return appearance;
}

/**
 * The outfits a run gates. A named `--gear` is gated alone. Otherwise three
 * are: the default the rows were authored in; bare, which is how every new
 * game's Carl is drawn until he finds his shirt; and every piece at once,
 * where the gear crowds the cell the most. Each is held to every gate —
 * most of the time goes to the pixel gates, which are the ones an outfit can
 * turn red, so a shorter list for the extra outfits would save little.
 */
function gatedOutfits(): readonly HumanAppearance[] {
  if (GEAR_FLAG !== null) return [APPEARANCE];
  return [DEFAULT_HUMAN_APPEARANCE, BARE_HUMAN_APPEARANCE, everyPieceOfGear()];
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

/** A requested frame index, clamped into a row's valid range; `NO_FRAME` (no single frame selected) passes through unclamped. */
function clampFrame(frameCount: number, frame: number): number {
  return frame === NO_FRAME ? frame : Math.min(frameCount - 1, Math.max(0, frame));
}

function frameCountOf(state: string): number {
  const declared = FIGURE.states.get(state);
  if (declared === undefined) throw new Error(`Carl declares no state "${state}"`);
  return declared.frames;
}

function rowOf(state: string) {
  const row = humanRowOf(state);
  if (row === undefined) throw new Error(`no row named "${state}"`);
  return row;
}

function labelOf(state: string): string {
  const row = rowOf(state);
  return `${row.name} — ${row.frameCount} frames, ${row.view}, ${row.kind}`;
}

/** Narrows a validated row name to `HumanRowName` without a cast. */
function asHumanRowName(state: string): HumanRowName {
  const found = HUMAN_ROW_NAMES.find((name) => name === state);
  if (found === undefined) throw new Error(`"${state}" is not a declared Carl row`);
  return found;
}

const allStateNames = (): string[] => HUMAN_ROWS.map((row) => row.name);

function resolveStates(rowFilter: string): string[] {
  const all = allStateNames();
  const states = rowFilter === '' ? all : all.filter((state) => state === rowFilter);
  if (states.length === 0) throw new Error(`--row=${rowFilter} is not one of ${all.join(', ')}`);
  return states;
}

// ── Grid pipeline: sheet / onion / delta ────────────────────────────────────

interface GridOptions {
  readonly mode: GridMode;
  readonly states: readonly string[];
  readonly scale: number;
  readonly part: PartWindow | null;
  readonly frameFilter: number;
}

interface GridResult {
  readonly canvas: Canvas;
  /** The cell's own ground line, in the composed canvas's pixels — only meaningful when exactly one cell was drawn. */
  readonly cellGroundY: number;
  /** Cell pixels per canvas pixel for a length, i.e. the render scale actually used. */
  readonly scale: number;
  /** How far the crop's own top edge sits from the frame's top, in cell pixels. */
  readonly cropTopOffset: number;
}

function renderGrid(options: GridOptions): GridResult {
  const { mode, states, scale, part, frameFilter } = options;

  const baked = bakeFigureSheet(FIGURE, [...states]);
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;

  const cropped = part !== null;
  const srcW = cropped ? Math.round(part.w * frameW) : frameW;
  const srcH = cropped ? Math.round(part.h * frameH) : frameH;
  const srcOffsetX = cropped ? Math.round(part.x * frameW) : 0;
  const srcOffsetY = cropped ? Math.round(part.y * frameH) : 0;
  const cellW = srcW * scale;
  const cellH = srcH * scale;

  const columnsOf = (frameCount: number): number[] =>
    frameFilter === NO_FRAME
      ? Array.from({ length: frameCount }, (_unused, i) => i)
      : [clampFrame(frameCount, frameFilter)];

  const maxCols = Math.max(...states.map((state) => columnsOf(frameCountOf(state)).length));
  const inGameScale = TILE_SIZE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;
  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  const partName = Object.entries(PARTS).find(([, window]) => window === part)?.[0] ?? '';

  let y = PADDING;
  let cellGroundY = NO_FRAME;
  states.forEach((state, sheetRow) => {
    const frameCount = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      labelOf(state) + (cropped ? `  [${partName}]` : ''),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    columnsOf(frameCount).forEach((col, slot) => {
      const x = PADDING + slot * (cellW + PADDING);
      if (states.length === 1 && columnsOf(frameCount).length === 1) {
        cellGroundY = y + (HUMAN_GROUND_Y - srcOffsetY) * scale;
      }
      const blit = (frame: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sheet,
          frame * frameW + srcOffsetX,
          sheetRow * frameH + srcOffsetY,
          srcW,
          srcH,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.restore();
      };
      if (mode === 'delta') {
        // The previous frame is subtracted rather than overlaid, so what is
        // left is only what moved — which is where a continuity gate fires.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        blit(col, 1);
        ctx.globalCompositeOperation = 'difference';
        blit((col + frameCount - 1) % frameCount, 1);
        ctx.restore();
      } else {
        if (mode === 'onion') blit((col + frameCount - 1) % frameCount, ONION_ALPHA);
        blit(col, 1);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (!cropped) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + FIGURE.tileX * scale,
          y + FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    });
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'in-game size (32px tile), on the dungeon floor',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, y, canvas.width, inGameH);
  states.forEach((_state, sheetRow) => {
    ctx.drawImage(
      sheet,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + sheetRow * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  return {
    canvas,
    cellGroundY,
    scale,
    cropTopOffset: srcOffsetY,
  };
}

// ── Trails mode ──────────────────────────────────────────────────────────────

/** One tracked joint's path across a row's frames. */
interface JointTrail {
  readonly label: string;
  readonly color: string;
  readonly point: (probe: HumanJointProbe) => Pt;
  readonly clamped?: (probe: HumanJointProbe) => boolean;
}

const JOINT_TRAILS: readonly JointTrail[] = [
  { label: 'pelvis', color: '#fff176', point: (p) => p.pelvis },
  { label: 'head', color: '#f06292', point: (p) => p.headCentre },
  {
    label: 'L ankle',
    color: '#4fc3f7',
    point: (p) => p.leftLeg.ankle,
    clamped: (p) => p.leftLeg.clamped,
  },
  {
    label: 'R ankle',
    color: '#81c784',
    point: (p) => p.rightLeg.ankle,
    clamped: (p) => p.rightLeg.clamped,
  },
  { label: 'L wrist', color: '#ffb74d', point: (p) => p.leftArm.wrist },
  { label: 'R wrist', color: '#ba68c8', point: (p) => p.rightArm.wrist },
];

const CLAMP_RING_COLOR = '#ff1744';
const STAMP_ANCHOR_COLOR = '#26c6da';
const JOINT_DOT_RADIUS = 3;
const CLAMP_RING_RADIUS = 6;
const STAMP_MARKER_RADIUS = 7;
const FRAME_LABEL_FONT = '10px sans-serif';
const FRAME_LABEL_OFFSET = 4;
const TRAILS_ONION_ALPHA = 0.16;
const GROUND_LINE_COLOR = 'rgba(255,255,255,0.55)';
const LEGEND_SWATCH = 12;
const LEGEND_GAP = 14;
const LEGEND_ROW_HEIGHT = 18;
const LEGEND_TEXT_GAP = 4;
const LEGEND_TEXT_BASELINE_DROP = 4;
const GROUND_PANEL_CAPTION_Y = 12;
const GROUND_PANEL_HEIGHT = 220;
const GROUND_PANEL_SIDE_MARGIN = 40;
const CAPTION_FONT = '11px sans-serif';

/** A full turn of the phase accumulator `walkFrame` advances by each tick. */
const FULL_GAIT_TURN_RADIANS = Math.PI * 2;

function outlinedText(ctx: NodeContext, text: string, x: number, y: number): void {
  ctx.fillStyle = '#000000';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x, y);
}

function drawLegend(ctx: NodeContext, x: number, y: number, hasStamp: boolean): void {
  ctx.font = CAPTION_FONT;
  let cursorX = x;
  const rowY = y + LEGEND_ROW_HEIGHT / 2;
  for (const trail of JOINT_TRAILS) {
    ctx.fillStyle = trail.color;
    ctx.fillRect(cursorX, rowY - LEGEND_SWATCH / 2, LEGEND_SWATCH, LEGEND_SWATCH);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      trail.label,
      cursorX + LEGEND_SWATCH + LEGEND_TEXT_GAP,
      rowY + LEGEND_TEXT_BASELINE_DROP,
    );
    cursorX += LEGEND_SWATCH + LEGEND_TEXT_GAP + ctx.measureText(trail.label).width + LEGEND_GAP;
  }
  ctx.strokeStyle = CLAMP_RING_COLOR;
  ctx.beginPath();
  ctx.arc(cursorX + LEGEND_SWATCH / 2, rowY, LEGEND_SWATCH / 2, 0, FULL_GAIT_TURN_RADIANS);
  ctx.stroke();
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'IK clamped',
    cursorX + LEGEND_SWATCH + LEGEND_TEXT_GAP,
    rowY + LEGEND_TEXT_BASELINE_DROP,
  );
  cursorX += LEGEND_SWATCH + LEGEND_TEXT_GAP + ctx.measureText('IK clamped').width + LEGEND_GAP;
  if (hasStamp) {
    ctx.strokeStyle = STAMP_ANCHOR_COLOR;
    ctx.beginPath();
    ctx.moveTo(cursorX, rowY);
    ctx.lineTo(cursorX + LEGEND_SWATCH, rowY);
    ctx.moveTo(cursorX + LEGEND_SWATCH / 2, rowY - LEGEND_SWATCH / 2);
    ctx.lineTo(cursorX + LEGEND_SWATCH / 2, rowY + LEGEND_SWATCH / 2);
    ctx.stroke();
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      'stamp anchor',
      cursorX + LEGEND_SWATCH + LEGEND_TEXT_GAP,
      rowY + LEGEND_TEXT_BASELINE_DROP,
    );
  }
}

/** Where a row's `stampAnchor` (tile fractions) lands in the cell's own pixels. */
function stampAnchorCellPx(anchor: Pt): Pt {
  return { x: TILE_X + anchor.x * TILE_SCALE, y: TILE_Y + anchor.y * TILE_SCALE };
}

function drawTrailsPanel(
  ctx: NodeContext,
  originX: number,
  originY: number,
  frameW: number,
  frameH: number,
  scale: number,
  sheet: Canvas,
  sheetRow: number,
  state: HumanRowName,
  frameCount: number,
  loop: boolean,
): void {
  const panelW = frameW * scale;
  const panelH = frameH * scale;
  ctx.save();
  ctx.translate(originX, originY);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, panelW, panelH);

  for (let f = 0; f < frameCount; f += 1) {
    ctx.save();
    ctx.globalAlpha = TRAILS_ONION_ALPHA;
    ctx.drawImage(sheet, f * frameW, sheetRow * frameH, frameW, frameH, 0, 0, panelW, panelH);
    ctx.restore();
  }

  ctx.strokeStyle = GROUND_LINE_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, HUMAN_GROUND_Y * scale);
  ctx.lineTo(panelW, HUMAN_GROUND_Y * scale);
  ctx.stroke();

  const row = rowOf(state);
  if (row.stampAnchor !== undefined) {
    const anchor = stampAnchorCellPx(row.stampAnchor);
    const ax = anchor.x * scale;
    const ay = anchor.y * scale;
    ctx.strokeStyle = STAMP_ANCHOR_COLOR;
    ctx.beginPath();
    ctx.moveTo(ax - STAMP_MARKER_RADIUS, ay);
    ctx.lineTo(ax + STAMP_MARKER_RADIUS, ay);
    ctx.moveTo(ax, ay - STAMP_MARKER_RADIUS);
    ctx.lineTo(ax, ay + STAMP_MARKER_RADIUS);
    ctx.stroke();
  }

  ctx.font = FRAME_LABEL_FONT;
  for (const trail of JOINT_TRAILS) {
    const points = Array.from({ length: frameCount }, (_unused, f) => {
      const probe = probeHumanJoints(state, f);
      const p = trail.point(probe);
      return { x: p.x * scale, y: p.y * scale, clamped: trail.clamped?.(probe) === true };
    });

    ctx.strokeStyle = trail.color;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    if (loop) ctx.lineTo(points[0].x, points[0].y);
    ctx.stroke();

    points.forEach((p, f) => {
      ctx.fillStyle = trail.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, JOINT_DOT_RADIUS, 0, FULL_GAIT_TURN_RADIANS);
      ctx.fill();
      if (p.clamped) {
        ctx.strokeStyle = CLAMP_RING_COLOR;
        ctx.beginPath();
        ctx.arc(p.x, p.y, CLAMP_RING_RADIUS, 0, FULL_GAIT_TURN_RADIANS);
        ctx.stroke();
      }
      outlinedText(ctx, String(f), p.x + FRAME_LABEL_OFFSET, p.y - FRAME_LABEL_OFFSET);
    });
  }
  ctx.restore();
}

/**
 * The ground-plane panel for a travelling row: where each foot is along the
 * floor, measured along the way the row travels — its position in the cell
 * plus how far the body has been carried by that frame. Both the ankle and
 * the toe are plotted: a rolling foot's ankle rises round its toe as it
 * pushes off, so it is the toe, not the ankle, that has to stay a dot through
 * the push-off. Frames the choreography calls planted are filled dots; a
 * planted foot that smears is skating.
 */
function drawGroundPlanePanel(
  ctx: NodeContext,
  originX: number,
  originY: number,
  panelW: number,
  state: HumanRowName,
  frameCount: number,
): void {
  const travelPerFrame = floorDriftPerFrameCellPx(state);
  const direction = TRAVEL_DIRECTION[HUMAN_ROW_TABLE[state].view];
  const along = (p: Pt): number => p.x * direction.x + p.y * direction.y;
  const legs: ReadonlyArray<{
    color: string;
    leg: (p: HumanJointProbe) => ProbedLeg;
    point: (leg: ProbedLeg) => Pt;
  }> = [
    { color: '#4fc3f7', leg: (p) => p.leftLeg, point: (leg) => leg.ankle },
    { color: '#81c784', leg: (p) => p.rightLeg, point: (leg) => leg.ankle },
    { color: '#b3e5fc', leg: (p) => p.leftLeg, point: (leg) => leg.toe },
    { color: '#c8e6c9', leg: (p) => p.rightLeg, point: (leg) => leg.toe },
  ];

  const seriesPerLeg = legs.map((trace) =>
    Array.from({ length: frameCount }, (_unused, f) => {
      const leg = trace.leg(probeHumanJoints(state, f));
      const groundX = along(trace.point(leg)) + f * travelPerFrame;
      return { frame: f, groundX, planted: leg.planted ?? false };
    }),
  );

  const allX = seriesPerLeg.flat().map((s) => s.groundX);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const range = Math.max(maxX - minX, 1);
  const usableW = panelW - GROUND_PANEL_SIDE_MARGIN * 2;
  const mapX = (x: number): number => GROUND_PANEL_SIDE_MARGIN + ((x - minX) / range) * usableW;
  const rowHeight = GROUND_PANEL_HEIGHT / frameCount;

  ctx.save();
  ctx.translate(originX, originY);
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, 0, panelW, GROUND_PANEL_HEIGHT);
  ctx.font = CAPTION_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'ground plane along travel: ankle (dark) and toe (pale); filled = planted — a planted smear is a skating foot',
    GROUND_PANEL_SIDE_MARGIN,
    GROUND_PANEL_CAPTION_Y,
  );

  ctx.font = FRAME_LABEL_FONT;
  legs.forEach((trace, legIndex) => {
    const series = seriesPerLeg[legIndex];
    ctx.strokeStyle = trace.color;
    ctx.beginPath();
    series.forEach((point, i) => {
      const x = mapX(point.groundX);
      const y = point.frame * rowHeight + rowHeight / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    series.forEach((point) => {
      const x = mapX(point.groundX);
      const y = point.frame * rowHeight + rowHeight / 2;
      ctx.fillStyle = trace.color;
      ctx.strokeStyle = trace.color;
      ctx.beginPath();
      ctx.arc(x, y, JOINT_DOT_RADIUS, 0, FULL_GAIT_TURN_RADIANS);
      if (point.planted) ctx.fill();
      else ctx.stroke();
      outlinedText(ctx, String(point.frame), x + FRAME_LABEL_OFFSET, y - FRAME_LABEL_OFFSET);
    });
  });
  ctx.restore();
}

function renderTrails(states: readonly string[], scale: number): Canvas {
  const baked = bakeFigureSheet(FIGURE, [...states]);
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;
  const panelW = frameW * scale;
  const panelH = frameH * scale;

  const rows = states.map((state) => {
    const row = rowOf(state);
    const frameCount = frameCountOf(state);
    const travelling = row.locomotion === 'travelling';
    return { state, row, frameCount, travelling };
  });

  const legendHeight = LEGEND_ROW_HEIGHT + PADDING;
  const perRowHeight = (travelling: boolean): number =>
    LABEL_HEIGHT + panelH + PADDING + (travelling ? GROUND_PANEL_HEIGHT + PADDING : 0);

  const width = PADDING * 2 + panelW;
  const height =
    PADDING + legendHeight + rows.reduce((sum, r) => sum + perRowHeight(r.travelling), 0) + PADDING;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawLegend(
    ctx,
    PADDING,
    PADDING,
    rows.some((r) => r.row.stampAnchor !== undefined),
  );

  let y = PADDING + legendHeight;
  rows.forEach(({ state, row, frameCount, travelling }, sheetRow) => {
    ctx.font = LABEL_FONT;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(labelOf(state), PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    drawTrailsPanel(
      ctx,
      PADDING,
      y,
      frameW,
      frameH,
      scale,
      sheet,
      sheetRow,
      asHumanRowName(state),
      frameCount,
      row.kind === 'loop',
    );
    y += panelH + PADDING;

    if (travelling) {
      drawGroundPlanePanel(ctx, PADDING, y, panelW, asHumanRowName(state), frameCount);
      y += GROUND_PANEL_HEIGHT + PADDING;
    }
  });

  return canvas;
}

// ── strip32 mode ─────────────────────────────────────────────────────────────

const STRIP32_NEAREST_SCALE = 2;

/**
 * One frame downsampled from the baked cell to its true in-game size, the way
 * the runtime cache bakes it. Nearest-neighbour magnifying this (smoothing
 * off) shows the exact pixels the game draws; magnifying the source cell
 * directly instead would only be a 1:1 blit of it, since the source cell and
 * the in-game tile are not the same resolution.
 */
function inGameCell(
  sheet: Canvas,
  srcX: number,
  srcY: number,
  frameW: number,
  frameH: number,
  inGameW: number,
  inGameH: number,
): Canvas {
  const cell = createCanvas(Math.ceil(inGameW), Math.ceil(inGameH));
  const ctx = cell.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sheet, srcX, srcY, frameW, frameH, 0, 0, inGameW, inGameH);
  return cell;
}

function renderStrip32(states: readonly string[], frameFilter: number): Canvas {
  const baked = bakeFigureSheet(FIGURE, [...states]);
  const sheet = baked.canvas;
  const frameW = baked.frameWidth;
  const frameH = baked.frameHeight;

  const inGameScale = TILE_SIZE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;
  const nearestW = inGameW * STRIP32_NEAREST_SCALE;
  const nearestH = inGameH * STRIP32_NEAREST_SCALE;

  const columnsOf = (frameCount: number): number[] =>
    frameFilter === NO_FRAME
      ? Array.from({ length: frameCount }, (_unused, i) => i)
      : [clampFrame(frameCount, frameFilter)];

  const maxCols = Math.max(...states.map((state) => columnsOf(frameCountOf(state)).length));
  const width = PADDING + maxCols * (nearestW + PADDING);
  const rowBlockHeight = LABEL_HEIGHT + inGameH + PADDING + nearestH + PADDING;
  const height = PADDING + states.length * rowBlockHeight;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  states.forEach((state, sheetRow) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(labelOf(state), PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    const columns = columnsOf(frameCountOf(state));

    ctx.fillStyle = DUNGEON_FLOOR;
    ctx.fillRect(PADDING, y, width - PADDING, inGameH);
    ctx.imageSmoothingEnabled = true;
    columns.forEach((col, slot) => {
      const x = PADDING + slot * (nearestW + PADDING);
      ctx.drawImage(sheet, col * frameW, sheetRow * frameH, frameW, frameH, x, y, inGameW, inGameH);
    });
    y += inGameH + PADDING;

    ctx.fillStyle = DUNGEON_FLOOR;
    ctx.fillRect(PADDING, y, width - PADDING, nearestH);
    ctx.imageSmoothingEnabled = false;
    columns.forEach((col, slot) => {
      const x = PADDING + slot * (nearestW + PADDING);
      const small = inGameCell(
        sheet,
        col * frameW,
        sheetRow * frameH,
        frameW,
        frameH,
        inGameW,
        inGameH,
      );
      ctx.drawImage(small, 0, 0, small.width, small.height, x, y, nearestW, nearestH);
    });
    ctx.imageSmoothingEnabled = true;
    y += nearestH + PADDING;
  });

  return canvas;
}

// ── compare / ref composition ───────────────────────────────────────────────

/** A pixel differing from a sampled background colour by more than this, per channel, counts as figure content. */
const BACKGROUND_MATCH_TOLERANCE = 12;
/** A pixel this transparent or more counts as background regardless of its colour. */
const BACKGROUND_ALPHA_THRESHOLD = 10;
const RGBA_CHANNELS = 4;
const PIXEL_ALPHA_OFFSET = 3;

function isBackgroundPixel(
  data: Uint8ClampedArray,
  i: number,
  background: readonly [number, number, number],
): boolean {
  if (data[i + PIXEL_ALPHA_OFFSET] < BACKGROUND_ALPHA_THRESHOLD) return true;
  return (
    Math.abs(data[i] - background[0]) <= BACKGROUND_MATCH_TOLERANCE &&
    Math.abs(data[i + 1] - background[1]) <= BACKGROUND_MATCH_TOLERANCE &&
    Math.abs(data[i + 2] - background[2]) <= BACKGROUND_MATCH_TOLERANCE
  );
}

interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * The height of the figure content in an image, found by its bounding box
 * against a background colour sampled from its own top-left corner —
 * independent of how much backdrop or label padding surrounds it. Falls back
 * to the full image height when nothing differs from the corner colour, so a
 * blank or fully-transparent image still yields a usable (if meaningless)
 * scale rather than a division by zero.
 */
function contentBoundingBoxHeight(pixels: PixelBuffer): number {
  const { width, height, data } = pixels;
  const background: [number, number, number] = [data[0], data[1], data[2]];
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackgroundPixel(data, (y * width + x) * RGBA_CHANNELS, background)) {
        if (y < top) top = y;
        bottom = y;
        break;
      }
    }
  }
  return bottom >= top ? bottom - top + 1 : height;
}

function pixelsOf(canvas: Canvas): PixelBuffer {
  const { width, height } = canvas;
  return { width, height, data: canvas.getContext('2d').getImageData(0, 0, width, height).data };
}

/**
 * Places `current` beside a loaded `against` image, both scaled so their
 * figure content (not their raw canvas size) is the same height, and
 * top-aligned. Matching on the visible figure rather than the whole canvas
 * means an arbitrary reference image compares correctly even when its
 * padding, labels or backdrop don't match this harness's own layout; against
 * one of this harness's own renders it produces the same result either way.
 */
async function composeCompare(current: Canvas, againstPath: string): Promise<Canvas> {
  const img = await loadImage(againstPath);
  const probe = createCanvas(img.width, img.height);
  probe.getContext('2d').drawImage(img, 0, 0);

  const currentFigureHeight = contentBoundingBoxHeight(pixelsOf(current));
  const againstFigureHeight = contentBoundingBoxHeight(pixelsOf(probe));
  const scale = currentFigureHeight / againstFigureHeight;
  const targetWidth = img.width * scale;
  const targetHeight = img.height * scale;

  const gap = PADDING * 2;
  const width = current.width + gap + targetWidth;
  const height = Math.max(current.height, targetHeight) + LABEL_HEIGHT;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;

  ctx.fillText('current', PADDING, LABEL_HEIGHT - PADDING);
  ctx.drawImage(current, 0, LABEL_HEIGHT);

  const againstX = current.width + gap;
  ctx.fillText('against', againstX, LABEL_HEIGHT - PADDING);
  ctx.drawImage(
    img,
    0,
    0,
    img.width,
    img.height,
    againstX,
    LABEL_HEIGHT,
    targetWidth,
    targetHeight,
  );

  return canvas;
}

/** Places a reference image beside `current`, scaled to `figureHeightPx` and bottom-aligned on `groundY` (current's own coordinates). */
async function composeRef(
  current: Canvas,
  refPath: string,
  groundY: number,
  figureHeightPx: number,
): Promise<Canvas> {
  const img = await loadImage(refPath);
  const refHeight = figureHeightPx;
  const refWidth = img.width * (refHeight / img.height);
  const refTopUnshifted = groundY - refHeight;
  const topPad = Math.max(0, -refTopUnshifted);
  const gap = PADDING * 2;

  const width = current.width + gap + refWidth;
  const height = topPad + Math.max(current.height, groundY);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(current, 0, topPad);

  const refX = current.width + gap;
  const refY = topPad + refTopUnshifted;
  ctx.drawImage(img, 0, 0, img.width, img.height, refX, refY, refWidth, refHeight);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('reference', refX, Math.max(LABEL_HEIGHT - PADDING, refY - PADDING));

  return canvas;
}

/** Carl's own head-top-to-ground height for one probed frame, in cell pixels. */
function figureHeightCellPx(probe: HumanJointProbe): number {
  const headTopY = probe.headCentre.y - HEAD_RY * probe.pixelsPerUnit;
  return probe.groundY - headTopY;
}

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * node-canvas rejects a canvas taller or wider than this, and browsers cap a
 * `<canvas>` element the same way. Carl declares well over a hundred rows,
 * so a contact sheet stacking every row at any usable scale routinely wants a
 * canvas past this — the sheet is paginated instead of grown past it.
 */
const MAX_CANVAS_DIMENSION = 32767;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** `foo.png` for a single page, `foo-p2.png` for page 2 of a multi-page render. */
function pagedOutPath(outPath: string, page: number, pageCount: number): string {
  if (pageCount <= 1) return outPath;
  const dot = outPath.lastIndexOf('.');
  const base = dot === -1 ? outPath : outPath.slice(0, dot);
  const ext = dot === -1 ? '' : outPath.slice(dot);
  return `${base}-p${page}${ext}`;
}

/** The cell height `renderGrid` will paint at, before any per-row label or padding. */
function gridCellHeight(scale: number, part: PartWindow | null): number {
  const srcH = part !== null ? Math.round(part.h * FIGURE.frameHeight) : FIGURE.frameHeight;
  return srcH * scale;
}

/**
 * How many contact-sheet rows fit on one page before the stacked canvas would
 * exceed `MAX_CANVAS_DIMENSION`. Every page also carries the "in-game size"
 * footer strip (`renderGrid` draws one per call), so that footer's height is
 * reserved once per page alongside the top padding.
 */
function gridRowsPerPage(cellH: number): number {
  const inGameScale = TILE_SIZE / TILE_SCALE;
  const inGameH = FIGURE.frameHeight * inGameScale;
  const perRowHeight = cellH + LABEL_HEIGHT + PADDING;
  const fixedOverhead = PADDING + inGameH + LABEL_HEIGHT + PADDING;
  return Math.max(1, Math.floor((MAX_CANVAS_DIMENSION - fixedOverhead) / perRowHeight));
}

/** How many `strip32` rows fit on one page before the stacked canvas would exceed `MAX_CANVAS_DIMENSION`. */
function strip32RowsPerPage(): number {
  const inGameScale = TILE_SIZE / TILE_SCALE;
  const inGameH = FIGURE.frameHeight * inGameScale;
  const nearestH = inGameH * STRIP32_NEAREST_SCALE;
  const rowBlockHeight = LABEL_HEIGHT + inGameH + PADDING + nearestH + PADDING;
  return Math.max(1, Math.floor((MAX_CANVAS_DIMENSION - PADDING) / rowBlockHeight));
}

async function main(): Promise<void> {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/human-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', '');
  const frameFilter = Math.round(parseNumberFlag('frame', NO_FRAME, NO_FRAME, MAX_FRAME_FLAG));
  const againstPath = parseOptionalFlag('against');
  const refPath = parseOptionalFlag('ref');

  const part = partName === '' ? null : (PARTS[partName] ?? null);
  if (partName !== '' && part === null) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }

  const states = resolveStates(rowFilter);

  if (mode === 'compare' && againstPath === null) {
    throw new Error('--mode=compare requires --against=<png>');
  }
  if (refPath !== null && (states.length !== 1 || frameFilter === NO_FRAME)) {
    throw new Error('--ref needs a single frame to match: pass --row=<name> and --frame=<n>');
  }

  // Ahead of the contact sheet rather than after it: the sheet is a
  // tens-of-megapixel allocation, and measuring art on the far side of one is
  // how a gate goes red on art nobody touched.
  for (const appearance of gatedOutfits()) {
    const outfit = humanAppearanceKey(appearance);
    console.log(`Gating Carl in ${outfit}…`);
    reportFigureGates(`human (${outfit})`, humanGateFailures(appearance));
  }

  let canvasPages: Canvas[];

  if (mode === 'trails') {
    canvasPages = [renderTrails(states, scale)];
  } else if (mode === 'strip32') {
    const statePages = chunk(states, strip32RowsPerPage());
    canvasPages = statePages.map((pageStates) => renderStrip32(pageStates, frameFilter));
  } else {
    const gridMode: GridMode = mode === 'compare' ? 'sheet' : mode;
    const statePages = chunk(states, gridRowsPerPage(gridCellHeight(scale, part)));
    canvasPages = [];
    for (const pageStates of statePages) {
      const grid = renderGrid({ mode: gridMode, states: pageStates, scale, part, frameFilter });
      let pageCanvas = grid.canvas;

      if (mode === 'compare') {
        const path = againstPath;
        if (path === null) throw new Error('--mode=compare requires --against=<png>');
        pageCanvas = await composeCompare(pageCanvas, path);
      } else if (refPath !== null) {
        const clampedFrame = clampFrame(frameCountOf(pageStates[0]), frameFilter);
        const probe = probeHumanJoints(asHumanRowName(pageStates[0]), clampedFrame);
        const height = figureHeightCellPx(probe) * scale;
        pageCanvas = await composeRef(pageCanvas, refPath, grid.cellGroundY, height);
      }
      canvasPages.push(pageCanvas);
    }
  }

  canvasPages.forEach((canvas, index) => {
    const page = index + 1;
    const writtenPath = writePreviewPng(
      pagedOutPath(outPath, page, canvasPages.length),
      canvas.toBuffer('image/png'),
    );
    const pageNote = canvasPages.length > 1 ? `, page ${page}/${canvasPages.length}` : '';
    console.log(
      `Wrote ${writtenPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode}${pageNote})`,
    );
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
