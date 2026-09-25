/**
 * Headless review render of Briar Hollow and its surroundings — the palisade,
 * the street plan, the quarry, the ruins and the start of the road to town —
 * from three world seeds, through the game's real ground and decoration
 * renderers and the same Y-sorted order `RenderPipeline` draws in, so a wall
 * or a prop overlaps a figure exactly as it does in play.
 *
 *   npm run render:briar-hollow [-- --seeds=11,22,33] [-- --scale=0.5] [-- --frame=world]
 *                               [-- --labels=off]
 *
 * Writes, per seed:
 * - `preview/briar-hollow-<seed>.png` — the village and its surroundings;
 * - `preview/briar-hollow-<seed>-detail-<0..3>.png` — the village's four
 *   quarters at game scale, NW, NE, SW, SE;
 * - `preview/briar-hollow-<seed>-vs-town.png` — the town square beside the
 *   village's south-west quarter, at game scale;
 * - `preview/briar-hollow-<seed>-probes.png` — one cottage at Retina scale
 *   with Carl standing at the three places a roofless wall can get wrong:
 *   inside behind the south cutaway, inside in front of the north wall, and in
 *   the doorway.
 *
 * `--frame=world` frames the whole map instead (at `WORLD_SCALE` unless
 * `--scale` says otherwise), to check where the village sits and where its road
 * runs. `--labels=off` leaves the building names off, for a blind review.
 */

import { createCanvas, type Canvas } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;

/** Retina, so the sheets render at the resolution they were baked at — see `render-town.ts`. */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { loadSprites } = await import('../src/core/SpriteLoader');
const { GameMap } = await import('../src/map/GameMap');
const { renderCanvas } = await import('../src/map/TileRenderer');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { drawText } = await import('../src/ui/TextBox');
const { drawFigureCached } = await import('../src/sprites/figure/figureFrameCache');
const { activeHumanFigure } = await import('../src/sprites/humanSprite');
const { isWalkableTileType } = await import('../src/map/walkability');
const { VillageAmbience } = await import('../src/systems/briarHollow/VillageAmbience');

type GameMapInstance = InstanceType<typeof GameMap>;

const MAP_SIZE = 280;
/** Three worlds, as multiples of one seed. */
const DEFAULT_SEED_BASE = 7919;
const DEFAULT_SEED_COUNT = 3;
const DEFAULT_SEEDS = Array.from(
  { length: DEFAULT_SEED_COUNT },
  (_unused, index) => DEFAULT_SEED_BASE * (index + 1),
);
/** Tiles of wilderness shown round the palisade on the west, north and south-west. */
const FRAME_MARGIN_TILES = 8;
/** Tiles shown past the ruins disc to the east. */
const RUINS_MARGIN_TILES = 4;
/** Tiles shown south of the palisade: the quarry, the south road and its assault-lane end. */
const SOUTH_REACH_TILES = 26;
const DEFAULT_SCALE = 0.5;
/** The whole 280-tile map at this scale is a 1120-pixel square. */
const WORLD_SCALE = 0.125;
const LABEL_SIZE_PX = 28;
const LABEL_COLOR = '#fde68a';
/** The cottage the wall probes stand in: south door, walls on all four sides. */
const PROBE_BUILDING = 'home_nella';
/** Tiles of street shown round the probe cottage. */
const PROBE_MARGIN_TILES = 3;
/** Retina: the probe image is judged at the density the game is played at. */
const PROBE_SCALE = 2;
/** Carl's standing breath loop, first frame. */
const CARL_IDLE_ROW = 'idle';
/** The village is also written in four quarters at 1:1, the scale it is played at. */
const DETAIL_QUARTERS = 4;
const DETAIL_SCALE = 1;
/** A fixed clock for the ambience, so repeated renders match. */
const REVIEW_TIME_SECONDS = 1.25;

function stringArg(name: string): string | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? undefined : raw.slice(`--${name}=`.length);
}

const seeds =
  stringArg('seeds')
    ?.split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value)) ?? DEFAULT_SEEDS;
const worldFrame = stringArg('frame') === 'world';
const showLabels = stringArg('labels') !== 'off';
const scaleArg = Number.parseFloat(stringArg('scale') ?? '');
const scale =
  Number.isFinite(scaleArg) && scaleArg > 0 ? scaleArg : worldFrame ? WORLD_SCALE : DEFAULT_SCALE;

await loadSprites('src/images/');
const { paintEnvironmentArtInNode } = await import('./nodeCanvasGlobals.js');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);

interface TileView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Probe {
  readonly tx: number;
  readonly ty: number;
}

interface SortedDraw {
  readonly sortY: number;
  readonly draw: () => void;
}

/**
 * Paints a view the way `RenderPipeline` does: the baked ground, then every
 * decoration and figure in one list sorted by foot, decorations first at a tie,
 * then the effects pass.
 */
function renderView(
  gameMap: GameMapInstance,
  view: TileView,
  viewScale: number,
  probes: ReadonlyArray<Probe>,
): Canvas {
  const camX = view.x * TILE_SIZE;
  const camY = view.y * TILE_SIZE;
  const viewW = view.w * TILE_SIZE;
  const viewH = view.h * TILE_SIZE;
  const canvas = createCanvas(Math.round(viewW * viewScale), Math.round(viewH * viewScale));
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(viewScale, viewScale);
  const ctx = asGameContext(nodeCtx);

  renderCanvas(ctx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

  const ambience = new VillageAmbience();
  ambience.update(gameMap, REVIEW_TIME_SECONDS);
  const draws: SortedDraw[] = [];
  for (const { tx, ty, sortYAnchorPx } of gameMap.getVisibleDecorationTiles(
    camX,
    camY,
    viewW,
    viewH,
  )) {
    draws.push({
      sortY: ty * TILE_SIZE + sortYAnchorPx,
      draw: () => gameMap.drawDecorationAt(ctx, tx, ty, camX, camY),
    });
  }
  for (const probe of probes) {
    draws.push({
      sortY: probe.ty * TILE_SIZE + TILE_SIZE,
      draw: () =>
        drawFigureCached(
          ctx,
          activeHumanFigure(),
          CARL_IDLE_ROW,
          0,
          probe.tx * TILE_SIZE - camX,
          probe.ty * TILE_SIZE - camY,
          TILE_SIZE,
        ),
    });
  }
  for (const prop of ambience.renderEntities()) {
    draws.push({
      sortY: prop.y + TILE_SIZE,
      draw: () => prop.render(ctx, camX, camY, TILE_SIZE),
    });
  }
  // Stable, like the game's: at a tie the decoration pushed first draws first.
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const item of draws) item.draw();
  ambience.renderAbove(ctx, camX, camY, viewW, viewH);
  return canvas;
}

/** The first walkable tile of a row of a building's interior, scanning from the west. */
function walkableInRow(
  gameMap: GameMapInstance,
  row: number,
  fromX: number,
  toX: number,
): Probe | null {
  for (let x = fromX; x <= toX; x++) {
    if (isWalkableTileType(gameMap.structure[row][x])) return { tx: x, ty: row };
  }
  return null;
}

for (const seed of seeds) {
  const gameMap = new GameMap({
    mapSize: MAP_SIZE,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
  });
  const site = gameMap.briarHollow;
  if (site === null) throw new Error(`seed ${seed}: no Briar Hollow`);
  const bounds = site.palisadeBounds;
  const eastEdge = site.ruins.centre.x + site.ruins.radiusTiles + RUINS_MARGIN_TILES;
  const view: TileView = worldFrame
    ? { x: 0, y: 0, w: MAP_SIZE, h: MAP_SIZE }
    : {
        x: bounds.x - FRAME_MARGIN_TILES,
        y: bounds.y - FRAME_MARGIN_TILES,
        w: eastEdge - (bounds.x - FRAME_MARGIN_TILES),
        h: bounds.h + FRAME_MARGIN_TILES + SOUTH_REACH_TILES,
      };

  const cottage = site.buildings.find((building) => building.id === PROBE_BUILDING);
  if (cottage === undefined) throw new Error(`seed ${seed}: no ${PROBE_BUILDING}`);
  const inner = cottage.interior;
  const behindSouthWall = walkableInRow(
    gameMap,
    inner.y + inner.h - 1,
    inner.x,
    inner.x + inner.w - 1,
  );
  const beforeNorthWall = walkableInRow(gameMap, inner.y, inner.x, inner.x + inner.w - 1);
  const doorway = cottage.doorways.length > 0 ? cottage.doorways[0] : null;
  const requireProbe = (name: string, probe: Probe | null): Probe => {
    if (probe === null) throw new Error(`seed ${seed}: no free tile ${name} of ${PROBE_BUILDING}`);
    return probe;
  };
  const probes: Probe[] = [
    requireProbe('behind the south cutaway', behindSouthWall),
    requireProbe('in front of the north wall', beforeNorthWall),
    requireProbe('in the doorway', doorway === null ? null : { tx: doorway.x, ty: doorway.y }),
  ];

  const canvas = renderView(gameMap, view, scale, worldFrame ? [] : probes);
  if (showLabels) {
    // The same context `renderView` drew through, still under its scale.
    const labelCtx = asGameContext(canvas.getContext('2d'));
    for (const building of worldFrame ? [] : site.buildings) {
      drawText(labelCtx, building.name, {
        x: (building.rect.x + building.rect.w / 2 - view.x) * TILE_SIZE,
        y: (building.rect.y + building.rect.h / 2 - view.y) * TILE_SIZE,
        size: LABEL_SIZE_PX,
        color: LABEL_COLOR,
        align: 'center',
        outline: true,
      });
    }
  }
  const labelSuffix = showLabels ? '' : '-unlabelled';
  const written = writePreviewPng(
    `${PREVIEW_DIR}/briar-hollow-${worldFrame ? 'world-' : ''}${seed}${labelSuffix}.png`,
    canvas.toBuffer('image/png'),
  );
  console.log(`${written}: ${view.w}x${view.h} tiles from (${view.x}, ${view.y}) at ${scale}x`);

  if (worldFrame) continue;
  // The village in quarters at game scale, where a prop's read is judged.
  for (let quarter = 0; quarter < DETAIL_QUARTERS; quarter++) {
    const halfW = Math.ceil(bounds.w / 2);
    const halfH = Math.ceil(bounds.h / 2);
    const detailView: TileView = {
      x: bounds.x + (quarter % 2) * halfW,
      y: bounds.y + Math.floor(quarter / 2) * halfH,
      w: halfW,
      h: halfH,
    };
    const detail = renderView(gameMap, detailView, DETAIL_SCALE, []);
    const detailPath = writePreviewPng(
      `${PREVIEW_DIR}/briar-hollow-${seed}-detail-${quarter}.png`,
      detail.toBuffer('image/png'),
    );
    console.log(detailPath);
  }
  // The village beside the town at the same scale: the village must sit one
  // step darker and warmer than the town's plaster, and only a side-by-side
  // shows whether it does.
  const townCentre = gameMap.townSquareCentre;
  if (townCentre !== undefined) {
    const halfW = Math.ceil(bounds.w / 2);
    const halfH = Math.ceil(bounds.h / 2);
    const townView: TileView = {
      x: Math.round(townCentre.x - halfW / 2),
      y: Math.round(townCentre.y - halfH / 2),
      w: halfW,
      h: halfH,
    };
    const villageView: TileView = { x: bounds.x, y: bounds.y + halfH, w: halfW, h: halfH };
    const town = renderView(gameMap, townView, DETAIL_SCALE, []);
    const village = renderView(gameMap, villageView, DETAIL_SCALE, []);
    const pair = createCanvas(town.width + village.width, Math.max(town.height, village.height));
    const pairCtx = pair.getContext('2d');
    pairCtx.drawImage(town, 0, 0);
    pairCtx.drawImage(village, town.width, 0);
    const pairPath = writePreviewPng(
      `${PREVIEW_DIR}/briar-hollow-${seed}-vs-town.png`,
      pair.toBuffer('image/png'),
    );
    console.log(pairPath);
  }
  const probeView: TileView = {
    x: cottage.rect.x - PROBE_MARGIN_TILES,
    y: cottage.rect.y - PROBE_MARGIN_TILES,
    w: cottage.rect.w + PROBE_MARGIN_TILES * 2,
    h: cottage.rect.h + PROBE_MARGIN_TILES * 2,
  };
  const probeCanvas = renderView(gameMap, probeView, PROBE_SCALE, probes);
  const probePath = writePreviewPng(
    `${PREVIEW_DIR}/briar-hollow-${seed}-probes.png`,
    probeCanvas.toBuffer('image/png'),
  );
  console.log(`${probePath}: Carl at ${probes.map((p) => `(${p.tx}, ${p.ty})`).join(', ')}`);
}
