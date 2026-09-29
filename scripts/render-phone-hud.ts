/**
 * Review renders of a phone's HUD layout, in the dungeon and inside a
 * building: one sheet per scene and viewport, tiling the minimap normal and
 * expanded against the HUD panel expanded and collapsed, with every optional
 * button showing (the level timer, Build and the siege panel in the dungeon;
 * Follow and Summon indoors). Each piece is a labelled box at the rect its
 * renderer draws from; see `phoneHudLayouts.ts`.
 *
 *   npm run render:phone-hud
 *   npm run render:phone-hud -- --viewports=568x320,844x390 --out-dir=preview/late-items --suffix=after
 */

import { createCanvas } from 'canvas';

Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
installCanvasGlobals();
const { asGameContext } = await import('./nodeGameContext');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut');
const { dungeonPhoneHudStates, interiorPhoneHudStates, drawPhoneHudSchematic, schematicSize } =
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

/** The optional pieces a sheet shows: every one, so the layout is at its most crowded. */
const SHEET_STATES = {
  dungeon: [
    'minimap, hud expanded, timer, build+siege',
    'minimap, hud collapsed, timer, build+siege',
    'minimap expanded, hud expanded, timer, build+siege',
    'minimap expanded, hud collapsed, timer, build+siege',
  ],
  interior: [
    'minimap, hud expanded, follow, summon',
    'minimap, hud collapsed, follow, summon',
    'minimap expanded, hud expanded, follow, summon',
    'minimap expanded, hud collapsed, follow, summon',
  ],
} as const;

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
  for (const scene of ['dungeon', 'interior'] as const) {
    const all =
      scene === 'dungeon'
        ? dungeonPhoneHudStates(width, height)
        : interiorPhoneHudStates(width, height);
    const states = SHEET_STATES[scene].map((label) => {
      const found = all.find((state) => state.label === label);
      if (found === undefined) throw new Error(`no ${scene} layout labelled "${label}"`);
      return found;
    });
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
      drawPhoneHudSchematic(ctx, state);
      ctx.restore();
    }
    const name = `hud-${scene}-${spec}${suffix === '' ? '' : `-${suffix}`}.png`;
    console.log(writePreviewPng(`${outDir}/${name}`, canvas.toBuffer('image/png')));
  }
}
