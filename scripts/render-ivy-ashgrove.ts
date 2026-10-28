#!/usr/bin/env tsx
/**
 * Review harness and gates for Ivy Ashgrove (`ivyAshgroveFigure.ts`), the
 * Barracks Mercenaries' archer, and the bow rows she is painted with
 * (`human/actionsBow.ts`).
 *
 * Runs the gates first and exits non-zero if any fails, then writes, under
 * `preview/ivy-ashgrove/`:
 *   ivy-<state>.png     one row, every frame: at the 32 px tile blown up 3x,
 *                       then at bake size (64 px per tile)
 *   ivy-ingame.png      every row at the 32 px tile, blown up 3x, on a dark floor
 *   ivy-context.png     her three idle views and the shot beside the human crawler,
 *                       at 32 px on a light and a dark floor
 *   ivy-closeup.png     the idle and the full draw in each view at 6x the tile
 *
 *   npm run render:ivy-ashgrove
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, frameCountOf, paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { progressFrameIndex } from '../src/core/spriteAssets/SpriteRenderer.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import { undressedHumanFigure } from '../src/sprites/art/humanFigure.js';
import { activeHumanLook } from '../src/sprites/humanSprite.js';
import { LONGBOW_NOCKED } from '../src/sprites/art/biped/props/longbow.js';
import type { BipedPose } from '../src/sprites/art/biped/rig.js';
import { bowShotBack, bowShotFront, bowShotSide } from '../src/sprites/art/human/actionsBow.js';
import { BOW_RELEASE_FRAME, BOW_SHOT_FRAMES } from '../src/sprites/art/human/timing.js';
import {
  IVY_ASHGROVE_FIGURE,
  IVY_ROLE_VIEWS,
  IVY_ROLES,
  ivyStateName,
} from '../src/sprites/art/ivyAshgroveFigure.js';
import { IVY_DRAWN_STATES } from '../src/sprites/ivyAshgroveSprite.js';
import { IVY_SHOT_RELEASE_PROGRESS } from '../src/sprites/ivyAshgroveTiming.js';

function flagValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? fallback : arg.slice(prefix.length);
}

const FIGURE = IVY_ASHGROVE_FIGURE;
const OUT_DIR = flagValue('out', `${PREVIEW_DIR}/ivy-ashgrove`);
const PREFIX = 'ivy';
const BAKE_PX_PER_TILE = FIGURE.tileScale;
const PIXEL_ZOOM = 3;
const CLOSEUP_ZOOM = 6;
const CLOSEUP_PX_PER_TILE = TILE_SIZE * CLOSEUP_ZOOM;
const BACKDROP = '#2f2a2e';
const FLOOR = '#6f665a';
/** The dungeon's floor: her green and the bow's honey have to part from it. */
const DARK_FLOOR = '#2c2826';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '11px sans-serif';
const LABEL_HEIGHT = 14;
const LABEL_BASELINE_UP = 3;
const PADDING = 8;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const FRAME_SPACING_TILES = 1.7;
const CONTEXT_SPACING_TILES = 1.8;
const HEADROOM_TILES = 2.3;
const DEATH_SPACING_TILES = 3;
const HALF = 0.5;

// ── Gates ────────────────────────────────────────────────────────────────────

const SHOT_POSES: readonly [string, (frame: number) => BipedPose][] = [
  ['front', bowShotFront],
  ['side', bowShotSide],
  ['back', bowShotBack],
];

function nocked(pose: BipedPose): boolean {
  return (pose.heldProps ?? []).some(
    (prop) => prop.kind === 'longbow' && prop.variant === LONGBOW_NOCKED,
  );
}

function stringDrawn(pose: BipedPose): boolean {
  return (pose.heldProps ?? []).some(
    (prop) => prop.kind === 'longbow' && prop.tether !== undefined,
  );
}

/**
 * The arrow is on the string up to the loose and gone from it on: every frame
 * before the release frame is nocked and drawn, every one from it on braced
 * and empty. And the kit's release progress lands on that frame, so the arrow
 * leaves on the tick the picture lets go of it.
 */
function releaseFailures(): string[] {
  const failures: string[] = [];
  let measured = 0;
  for (const [view, pose] of SHOT_POSES) {
    for (let frame = 0; frame < BOW_SHOT_FRAMES; frame++) {
      measured++;
      const drawn = pose(frame);
      const before = frame < BOW_RELEASE_FRAME;
      if (nocked(drawn) !== before || stringDrawn(drawn) !== before) {
        failures.push(
          `${view} shot frame ${frame} ${before ? 'has no arrow on a drawn string' : 'still holds the arrow'} ` +
            `(release frame ${BOW_RELEASE_FRAME})`,
        );
      }
    }
  }
  const shown = progressFrameIndex(IVY_SHOT_RELEASE_PROGRESS, BOW_SHOT_FRAMES);
  if (shown !== BOW_RELEASE_FRAME) {
    failures.push(
      `the release progress ${IVY_SHOT_RELEASE_PROGRESS} draws frame ${shown}, not the release frame ${BOW_RELEASE_FRAME}`,
    );
  }
  for (const view of IVY_ROLE_VIEWS.shoot) {
    const frames = frameCountOf(FIGURE, ivyStateName('shoot', view));
    if (frames !== BOW_SHOT_FRAMES) {
      failures.push(`shoot${view} paints ${frames} frames, not ${BOW_SHOT_FRAMES}`);
    }
  }
  return [...nothingMeasuredFailures(measured, 'shot frames'), ...failures];
}

/** Every row warm at once must fit the per-figure cache ceiling. */
function budgetFailures(): string[] {
  const cellBytes = FIGURE.frameWidth * FIGURE.frameHeight * BYTES_PER_PIXEL;
  let cells = 0;
  for (const declared of FIGURE.states.values()) cells += declared.frames;
  const bytes = cells * cellBytes;
  const budget = figureByteBudgetFor(FIGURE);
  console.log(
    `  info every row warm: ${cells} cells, ${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB ` +
      `of ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
  );
  return bytes > budget ? ['every row warm at once overruns the figure cache ceiling'] : [];
}

function runGates(): boolean {
  const results = [
    reportFigureGates('structure', figureStructuralFailures(FIGURE)),
    reportFigureGates(
      'drawn states',
      missingStateFailures(FIGURE, IVY_DRAWN_STATES, 'ivyAshgroveSprite'),
    ),
    reportFigureGates('arrow leaves on the release', releaseFailures()),
    reportFigureGates('budget', budgetFailures()),
  ];
  return results.every(Boolean);
}

// ── Pictures ─────────────────────────────────────────────────────────────────

interface Subject {
  readonly label: string;
  readonly def: FigureDef;
  readonly state: string;
  readonly frame: number;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function placeCell(
  ctx: NodeCtx,
  subject: Subject,
  tileLeft: number,
  tileTop: number,
  pxPerTile: number,
): void {
  // Past the bake's own density the cell is painted at the size it is shown,
  // so a closeup shows the painter's detail rather than an upscaled blur.
  const density = pxPerTile / subject.def.tileScale;
  const cell =
    density > 1
      ? paintFigureCell(subject.def, subject.state, subject.frame, density)
      : bakeFigureCell(subject.def, subject.state, subject.frame);
  const drawScale = density > 1 ? 1 : density;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    cell,
    tileLeft - subject.def.tileX * density,
    tileTop - subject.def.tileY * density,
    cell.width * drawScale,
    cell.height * drawScale,
  );
}

function lineup(
  subjects: readonly Subject[],
  pxPerTile: number,
  spacingTiles: number,
  floor: string,
  labelled = true,
): Canvas {
  const width = Math.ceil(subjects.length * spacingTiles * pxPerTile);
  const labelHeight = labelled ? LABEL_HEIGHT : 0;
  const height = Math.ceil((HEADROOM_TILES + 1) * pxPerTile) + labelHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, width, height - labelHeight);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, height - labelHeight, width, labelHeight);
  subjects.forEach((subject, index) => {
    const centreX = (index + HALF) * spacingTiles * pxPerTile;
    placeCell(ctx, subject, centreX - pxPerTile / 2, HEADROOM_TILES * pxPerTile, pxPerTile);
    if (labelled) label(ctx, subject.label, centreX, height - LABEL_BASELINE_UP);
  });
  return canvas;
}

function stack(canvases: readonly Canvas[]): Canvas {
  const width = Math.max(...canvases.map((c) => c.width)) + PADDING * 2;
  const height = canvases.reduce((sum, c) => sum + c.height + PADDING, PADDING);
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = PADDING;
  for (const c of canvases) {
    ctx.drawImage(c, PADDING, y);
    y += c.height + PADDING;
  }
  return out;
}

function zoomed(source: Canvas, zoom: number): Canvas {
  const out = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function rowSubjects(state: string): Subject[] {
  return Array.from({ length: frameCountOf(FIGURE, state) }, (_unused, frame) => ({
    label: `${frame}`,
    def: FIGURE,
    state,
    frame,
  }));
}

function spacingFor(state: string): number {
  return state.startsWith('death') ? DEATH_SPACING_TILES : FRAME_SPACING_TILES;
}

function contextSubjects(): Subject[] {
  const fullDraw = BOW_RELEASE_FRAME - 1;
  return [
    { label: 'the human', def: undressedHumanFigure(activeHumanLook()), state: 'idle', frame: 0 },
    { label: 'front', def: FIGURE, state: ivyStateName('idle', 'front'), frame: 0 },
    { label: 'side', def: FIGURE, state: ivyStateName('idle', 'side'), frame: 0 },
    { label: 'away', def: FIGURE, state: ivyStateName('idle', 'away'), frame: 0 },
    { label: 'aim', def: FIGURE, state: ivyStateName('shoot', 'side'), frame: fullDraw },
    { label: 'aim', def: FIGURE, state: ivyStateName('shoot', 'front'), frame: fullDraw },
    { label: 'aim', def: FIGURE, state: ivyStateName('shoot', 'away'), frame: fullDraw },
  ];
}

function closeupSubjects(): Subject[] {
  const fullDraw = BOW_RELEASE_FRAME - 1;
  return IVY_ROLE_VIEWS.shoot.flatMap((view) => [
    { label: `idle ${view}`, def: FIGURE, state: ivyStateName('idle', view), frame: 0 },
    { label: `aim ${view}`, def: FIGURE, state: ivyStateName('shoot', view), frame: fullDraw },
  ]);
}

function write(name: string, canvas: Canvas): void {
  const path = `${OUT_DIR}/${PREFIX}-${name}.png`;
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`  wrote ${path}`);
}

function main(): void {
  console.log('Ivy Ashgrove gates');
  const passed = runGates();

  const context = contextSubjects();
  write(
    'context',
    stack([
      zoomed(lineup(context, TILE_SIZE, CONTEXT_SPACING_TILES, FLOOR), PIXEL_ZOOM),
      zoomed(lineup(context, TILE_SIZE, CONTEXT_SPACING_TILES, DARK_FLOOR), PIXEL_ZOOM),
    ]),
  );
  write('closeup', lineup(closeupSubjects(), CLOSEUP_PX_PER_TILE, CONTEXT_SPACING_TILES, FLOOR));

  const inGameRows: Canvas[] = [];
  for (const role of IVY_ROLES) {
    for (const view of IVY_ROLE_VIEWS[role]) {
      const state = ivyStateName(role, view);
      const frames = rowSubjects(state);
      const spacing = spacingFor(state);
      const inGame = zoomed(lineup(frames, TILE_SIZE, spacing, DARK_FLOOR), PIXEL_ZOOM);
      inGameRows.push(inGame);
      write(state, stack([inGame, lineup(frames, BAKE_PX_PER_TILE, spacing, DARK_FLOOR)]));
    }
  }
  write('ingame', stack(inGameRows));

  if (!passed) process.exit(1);
}

main();
