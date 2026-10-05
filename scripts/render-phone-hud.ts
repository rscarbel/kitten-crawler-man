/**
 * Review renders of a phone's HUD layout — the same in the dungeon and inside
 * a building: one sheet per viewport, tiling the minimap normal and expanded
 * against the Build slot held or not, with the top band full (a boss bar, an
 * encounter, a countdown and a banner). Each piece is a labelled box at the
 * rect the HUD draws from; see `phoneHudLayouts.ts`.
 *
 *   npm run render:phone-hud
 *   npm run render:phone-hud -- --viewports=568x320,844x390 --out-dir=preview/late-items --suffix=after
 */

import { createCanvas } from 'canvas';

const { asGameContext } = await import('./nodeGameContext');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut');
const { hudStates, drawHudSchematic, representativeTopBand, schematicSize } =
  await import('./phoneHudLayouts');

/** Rendered at 2× so the button labels read in review. */
const RENDER_SCALE = 2;
const SHEET_COLUMNS = 2;
const SHEET_GUTTER_PX = 8;
const ARG_PREFIX_LENGTH = '--='.length;
const DEFAULT_VIEWPORTS = '568x320,844x390';

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const outDir = stringArg('out-dir', `${PREVIEW_DIR}/phone-hud`);
const suffix = stringArg('suffix', '');
for (const spec of stringArg('viewports', DEFAULT_VIEWPORTS).split(',')) {
  const match = /^(\d+)x(\d+)$/.exec(spec);
  if (match === null) {
    console.log(`bad viewport "${spec}" — expected WIDTHxHEIGHT`);
    process.exit(1);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const states = hudStates(width, height, 'touch');
  const cell = schematicSize(width, height);
  const rows = Math.ceil(states.length / SHEET_COLUMNS);
  const sheetW = SHEET_COLUMNS * cell.w + (SHEET_COLUMNS - 1) * SHEET_GUTTER_PX;
  const sheetH = rows * cell.h + (rows - 1) * SHEET_GUTTER_PX;
  const canvas = createCanvas(sheetW * RENDER_SCALE, sheetH * RENDER_SCALE);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  for (const [index, state] of states.entries()) {
    ctx.save();
    ctx.translate(
      (index % SHEET_COLUMNS) * (cell.w + SHEET_GUTTER_PX),
      Math.floor(index / SHEET_COLUMNS) * (cell.h + SHEET_GUTTER_PX),
    );
    drawHudSchematic(ctx, {
      ...state,
      pieces: [...state.pieces, ...representativeTopBand(state.geometry)],
    });
    ctx.restore();
  }
  const name = `hud-${spec}${suffix === '' ? '' : `-${suffix}`}.png`;
  console.log(writePreviewPng(`${outDir}/${name}`, canvas.toBuffer('image/png')));
}
