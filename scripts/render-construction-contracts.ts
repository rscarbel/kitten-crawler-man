#!/usr/bin/env tsx
/**
 * Review renders for construction-contract art: every material's damage on
 * every kind of target, a rebuild site per material, the reach glow and the
 * finish puff, then every spot in a Skyfowl Town room's and a Briar Hollow
 * room's pool, area highlights included, composited onto the real room.
 *
 *   npm run render:construction-contracts
 *   npm run render:construction-contracts -- --skyfowl=sleeping_cat_inn --hollow=forge
 *   npm run render:construction-contracts -- --out-dir=preview/my-pass
 *
 * Every image is written three ways: `-1x` at the game's own 32 px tiles,
 * `-1x-zoom` that same image blown up with hard pixels so a mark's read at
 * game size can be judged, and `-2x` painted at Retina density.
 *
 * In the Skyfowl Town room a repair spot's damage is drawn the way the
 * interior draws it: floors, doorways and walls under every figure, a prop's
 * damage straight after its prop in the Y-sorted pass. A rebuild spot's prop is
 * hidden and its build site drawn on the floor.
 *
 * The Briar Hollow room is drawn by the game's own `ConstructionContractSystem`
 * holding a contract for every spot in the pool: its ground layer, its
 * overlays merged into the overworld's Y-sorted decoration pass the way
 * `RenderPipeline` merges them, and its layer above. So the image is a check
 * of how the damage sorts against the roofless walls, not a re-drawing of it.
 * The highlights are the game's too, frozen at the moment the render runs.
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';
import type { ContractSpotMaterial } from '../src/systems/constructionContracts/contractCatalog.js';

installCanvasGlobals();

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { renderCanvas } = await import('../src/map/TileRenderer.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { createTownPlan } = await import('../src/map/town/townPlan.js');
const { drawTownInteriorGroundProps, townInteriorPropFigures } =
  await import('../src/systems/townInteriorPropFigures.js');
const { CONTRACT_SITES, contractSiteKey } =
  await import('../src/systems/constructionContracts/contractCatalog.js');
const { ConstructionContractSystem } =
  await import('../src/systems/constructionContracts/ConstructionContractSystem.js');
const { createBriarHollowState } = await import('../src/core/briarHollowState.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { skyfowlSpotFootprint, briarHollowSpotFootprint } =
  await import('../src/systems/constructionContracts/contractTargets.js');
const { contractSpotArtSeed, drawContractBuildSite, drawContractOverlay, releaseContractArt } =
  await import('../src/sprites/art/constructionContracts/contractArtCache.js');
const { drawContractSpotGlow, drawContractFinishPuff, CONTRACT_FINISH_PUFF_SECONDS } =
  await import('../src/sprites/art/constructionContracts/contractEffectsArt.js');
const { contractSpotFrameRect, contractSpotHighlightColor } =
  await import('../src/systems/constructionContracts/ContractSiteWork.js');
const { drawAreaHighlightFrame, drawAreaHighlightGround } =
  await import('../src/ui/AreaHighlight.js');
const { paintNorthInteriorWallFace } =
  await import('../src/sprites/art/townInterior/interiorWallFace.js');
const { paintPlankBoard, paintStoneCourses, paintPlasterWash } =
  await import('../src/sprites/art/town/townMaterials.js');
const { getTownRamp } = await import('../src/sprites/art/town/townPalette.js');
const { drawPlanks, drawFieldstones, drawWattle, WOOD } =
  await import('../src/sprites/art/villageArt.js');
const { mulberry32 } = await import('../src/sprites/person/rng.js');
const { worldText } = await import('../src/ui/world/worldText.js');

type GameMapInstance = InstanceType<typeof GameMap>;
type Material = ContractSpotMaterial;
type Surface = 'prop' | 'floor' | 'wall' | 'doorway' | 'open_side';
type Settlement = 'skyfowl' | 'hollow';

const MATERIALS: readonly Material[] = ['wood', 'stone', 'rope', 'plaster'];
const SURFACES: readonly Surface[] = ['prop', 'floor', 'wall', 'doorway', 'open_side'];
const SETTLEMENTS: readonly Settlement[] = ['skyfowl', 'hollow'];

const DEFAULT_OUT_DIR = `${PREVIEW_DIR}/construction-contracts`;
const DEFAULT_SKYFOWL_SITE = 'sleeping_cat_inn';
const DEFAULT_HOLLOW_SITE = 'forge';
/** Hard-pixel blow-up of the 1x image, so a one-pixel mark is visible as a pixel. */
const ZOOM = 3;
const RETINA = 2;
const TOWN_PLAN_SIZE = 280;
const OVERWORLD_SIZE = 280;
const HOLLOW_WORLD_SEED = 7919;
const ROOM_MARGIN_TILES = 1;
const SWATCH_SEED = 4242;
/** Above the room for the north wall's face and cap, below it for the south cutaway and the door step. */
const ROOM_VIEW_ROWS_OF_MARGIN = 3;
const FLOOR_BOARD_TILES = 0.5;
const PROP_BOARD_TILES = 0.3;
const WALL_BOARD_TILES = 0.24;
const STONE_COURSE_TILES = 0.3;
const FOOTING_STONE_TILES = 0.14;
/** Share of a village wall face that is fieldstone footing, as the roofless walls paint it. */
const HOLLOW_FOOTING_SHARE = 0.22;
const CELL_FOOT_MARGIN_TILES = 0.5;
const CELL_GUTTER_PX = 2;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(`--${name}=`.length);
}

const outDir = stringArg('out-dir', DEFAULT_OUT_DIR);
const skyfowlSlug = stringArg('skyfowl', DEFAULT_SKYFOWL_SITE);
const hollowSlug = stringArg('hollow', DEFAULT_HOLLOW_SITE);

await loadSprites('src/images/');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);

/** Paints a scene at `scale` canvas pixels per game pixel. */
type ScenePainter = (ctx: CanvasRenderingContext2D) => void;

function renderAt(widthPx: number, heightPx: number, scale: number, paint: ScenePainter): Canvas {
  const canvas = createCanvas(Math.round(widthPx * scale), Math.round(heightPx * scale));
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(scale, scale);
  paint(asGameContext(nodeCtx));
  return canvas;
}

function zoomed(source: Canvas): Canvas {
  const canvas = createCanvas(source.width * ZOOM, source.height * ZOOM);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function writeAllScales(
  name: string,
  widthPx: number,
  heightPx: number,
  paint: ScenePainter,
): void {
  // Art caches are keyed by tile size, not density, so each density repaints from scratch.
  releaseContractArt();
  const native = renderAt(widthPx, heightPx, 1, paint);
  releaseContractArt();
  const retina = renderAt(widthPx, heightPx, RETINA, paint);
  for (const [suffix, canvas] of [
    ['1x', native],
    ['1x-zoom', zoomed(native)],
    ['2x', retina],
  ] as const) {
    console.log(writePreviewPng(`${outDir}/${name}-${suffix}.png`, canvas.toBuffer('image/png')));
  }
}

// ── Swatches ──────────────────────────────────────────────────────────────────

/** Each swatch's target, in tiles. */
const SWATCH_TARGET: Record<Surface, { readonly w: number; readonly h: number }> = {
  prop: { w: 2, h: 1 },
  floor: { w: 2, h: 2 },
  wall: { w: 3, h: 1 },
  doorway: { w: 2, h: 1 },
  open_side: { w: 3, h: 1 },
};
/** A rebuild swatch's stripped footprint, in tiles: a square, like a bed or a table. */
const REBUILD_SWATCH_TARGET = { w: 2, h: 2 } as const;
/** One seed per stand-in painter, so the prop and the wall stand-ins never share a draw. */
const PROP_STANDIN_SEED = SWATCH_SEED + 1;
const WALL_STANDIN_SEED = SWATCH_SEED + 2;
const CELL_W_TILES = 4;
const CELL_H_TILES = 3;
const LABEL_COLUMN_TILES = 2;
const HEADER_ROW_TILES = 1;
/** The prop stand-in rises this far above its footprint, like a cabinet or a hearth. */
const PROP_STANDIN_RISE_TILES = 0.9;
const LABEL_SIZE_PX = 10;
const LABEL_COLOR = '#e5e7eb';
const SHEET_BACKGROUND = '#1b1b1f';
/** `oc_plaster`'s mid, under the wash. */
const PLASTER_STANDIN_BASE = 'rgb(167,154,128)';

function paintFloor(
  ctx: CanvasRenderingContext2D,
  settlement: Settlement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rng = mulberry32(SWATCH_SEED);
  if (settlement === 'skyfowl') {
    paintPlankBoard(ctx, x, y, w, h, rng, {
      direction: 'horizontal',
      boardPx: TILE_SIZE * FLOOR_BOARD_TILES,
      ramp: getTownRamp('oc_timber'),
    });
  } else {
    drawPlanks(ctx, x, y, w, h, rng, {
      direction: 'horizontal',
      boardPx: TILE_SIZE * FLOOR_BOARD_TILES,
      base: WOOD.body,
      highlight: WOOD.light,
      seam: WOOD.deep,
    });
  }
}

/** A plain block of the material, standing on its footprint, for a prop's damage to sit on. */
function paintPropStandIn(
  ctx: CanvasRenderingContext2D,
  settlement: Settlement,
  material: Material,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rng = mulberry32(PROP_STANDIN_SEED);
  const top = y - TILE_SIZE * PROP_STANDIN_RISE_TILES;
  const height = h + TILE_SIZE * PROP_STANDIN_RISE_TILES;
  if (settlement === 'skyfowl') {
    if (material === 'stone')
      paintStoneCourses(ctx, x, top, w, height, getTownRamp('oc_stone'), rng);
    else if (material === 'plaster') {
      ctx.fillStyle = PLASTER_STANDIN_BASE;
      ctx.fillRect(x, top, w, height);
      paintPlasterWash(ctx, x, top, w, height, getTownRamp('oc_plaster'), rng);
    } else
      paintPlankBoard(ctx, x, top, w, height, rng, {
        direction: 'horizontal',
        boardPx: TILE_SIZE * PROP_BOARD_TILES,
        ramp: getTownRamp('oc_timber'),
      });
  } else if (material === 'stone') {
    drawFieldstones(ctx, x, top, w, height, rng, TILE_SIZE * STONE_COURSE_TILES);
  } else if (material === 'plaster') {
    drawWattle(ctx, x, top, w, height, rng);
  } else {
    drawPlanks(ctx, x, top, w, height, rng, {
      direction: 'horizontal',
      boardPx: TILE_SIZE * PROP_BOARD_TILES,
      base: WOOD.mid,
      highlight: WOOD.highlight,
      seam: WOOD.deep,
    });
  }
}

function paintWallStandIn(
  ctx: CanvasRenderingContext2D,
  settlement: Settlement,
  material: Material,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (settlement === 'skyfowl') {
    const finish = material === 'stone' ? 'stone' : material === 'plaster' ? 'plaster' : 'timber';
    for (let tile = 0; tile * TILE_SIZE < w; tile++) {
      paintNorthInteriorWallFace(ctx, x + tile * TILE_SIZE, y, TILE_SIZE, h, finish, tile, 0);
    }
    return;
  }
  const rng = mulberry32(WALL_STANDIN_SEED);
  const footing = h * HOLLOW_FOOTING_SHARE;
  if (material === 'stone')
    drawFieldstones(ctx, x, y, w, h - footing, rng, TILE_SIZE * STONE_COURSE_TILES);
  else if (material === 'plaster') drawWattle(ctx, x, y, w, h - footing, rng);
  else
    drawPlanks(ctx, x, y, w, h - footing, rng, {
      direction: 'horizontal',
      boardPx: TILE_SIZE * WALL_BOARD_TILES,
      base: WOOD.body,
      highlight: WOOD.light,
      seam: WOOD.deep,
    });
  drawFieldstones(ctx, x, y + h - footing, w, footing, rng, TILE_SIZE * FOOTING_STONE_TILES);
}

function swatchSheet(settlement: Settlement): void {
  const columns = SURFACES.length + 1;
  const widthPx = (LABEL_COLUMN_TILES + columns * CELL_W_TILES) * TILE_SIZE;
  const heightPx = (HEADER_ROW_TILES + MATERIALS.length * CELL_H_TILES) * TILE_SIZE;
  writeAllScales(`swatches-${settlement}`, widthPx, heightPx, (ctx) => {
    ctx.fillStyle = SHEET_BACKGROUND;
    ctx.fillRect(0, 0, widthPx, heightPx);
    const headers = [...SURFACES, 'rebuild'];
    headers.forEach((header, column) => {
      worldText(ctx, header, {
        x: (LABEL_COLUMN_TILES + column * CELL_W_TILES + CELL_W_TILES / 2) * TILE_SIZE,
        y: (HEADER_ROW_TILES / 2) * TILE_SIZE,
        size: LABEL_SIZE_PX,
        color: LABEL_COLOR,
        align: 'center',
      });
    });
    MATERIALS.forEach((material, row) => {
      const cellTop = (HEADER_ROW_TILES + row * CELL_H_TILES) * TILE_SIZE;
      worldText(ctx, material, {
        x: (LABEL_COLUMN_TILES / 2) * TILE_SIZE,
        y: cellTop + (CELL_H_TILES / 2) * TILE_SIZE,
        size: LABEL_SIZE_PX,
        color: LABEL_COLOR,
        align: 'center',
      });
      [...SURFACES, 'rebuild' as const].forEach((surface, column) => {
        const cellLeft = (LABEL_COLUMN_TILES + column * CELL_W_TILES) * TILE_SIZE;
        const cellW = CELL_W_TILES * TILE_SIZE;
        const cellH = CELL_H_TILES * TILE_SIZE;
        const target = surface === 'rebuild' ? REBUILD_SWATCH_TARGET : SWATCH_TARGET[surface];
        const tw = target.w * TILE_SIZE;
        const th = target.h * TILE_SIZE;
        const tx = cellLeft + (cellW - tw) / 2;
        const ty = cellTop + cellH - th - TILE_SIZE * CELL_FOOT_MARGIN_TILES;
        paintFloor(
          ctx,
          settlement,
          cellLeft + CELL_GUTTER_PX,
          cellTop + CELL_GUTTER_PX,
          cellW - CELL_GUTTER_PX * 2,
          cellH - CELL_GUTTER_PX * 2,
        );
        const spec = {
          cacheKey: `swatch:${settlement}:${material}:${surface}`,
          material,
          settlement,
          widthTiles: target.w,
          heightTiles: target.h,
          tilePx: TILE_SIZE,
          seed: contractSpotArtSeed(`${settlement}:${material}:${surface}`),
        };
        if (surface === 'rebuild') {
          drawContractBuildSite(ctx, spec, tx, ty);
          return;
        }
        if (surface === 'prop') paintPropStandIn(ctx, settlement, material, tx, ty, tw, th);
        if (surface === 'wall') paintWallStandIn(ctx, settlement, material, tx, ty, tw, th);
        drawContractOverlay(ctx, { ...spec, surface }, tx, ty);
      });
    });
  });
}

// ── Effects ───────────────────────────────────────────────────────────────────

const PUFF_FRAMES = 6;
const EFFECT_CELL_TILES = 3;
/** Three moments across one pulse, so the sheet shows its range. */
const GLOW_TIME_STEP_SECONDS = 1.1;
const GLOW_TIMES = [0, GLOW_TIME_STEP_SECONDS, GLOW_TIME_STEP_SECONDS * 2];
const GLOW_COLUMNS = GLOW_TIMES.length;
/** The glow row above the finish-puff row. */
const EFFECT_ROWS = 2;
/** The effect's stand-in prop: two tiles wide, one deep, half a tile in from its cell's edge. */
const EFFECT_SPOT_W_TILES = 2;
const EFFECT_SPOT_INSET_TILES = 0.5;

function effectsSheet(): void {
  const columns = Math.max(PUFF_FRAMES, GLOW_COLUMNS);
  const widthPx = columns * EFFECT_CELL_TILES * TILE_SIZE;
  const heightPx = EFFECT_ROWS * EFFECT_CELL_TILES * TILE_SIZE;
  writeAllScales('effects', widthPx, heightPx, (ctx) => {
    ctx.fillStyle = SHEET_BACKGROUND;
    ctx.fillRect(0, 0, widthPx, heightPx);
    const cell = EFFECT_CELL_TILES * TILE_SIZE;
    const spotRect = (
      column: number,
      row: number,
    ): { x: number; y: number; w: number; h: number } => ({
      x: column * cell + TILE_SIZE * EFFECT_SPOT_INSET_TILES,
      y: row * cell + TILE_SIZE,
      w: TILE_SIZE * EFFECT_SPOT_W_TILES,
      h: TILE_SIZE,
    });
    const floorInCell = (column: number, row: number): [number, number, number, number] => [
      column * cell + CELL_GUTTER_PX,
      row * cell + CELL_GUTTER_PX,
      cell - CELL_GUTTER_PX * 2,
      cell - CELL_GUTTER_PX * 2,
    ];
    for (let column = 0; column < GLOW_COLUMNS; column++) {
      const rect = spotRect(column, 0);
      paintFloor(ctx, 'hollow', ...floorInCell(column, 0));
      drawContractSpotGlow(ctx, rect, GLOW_TIMES[column]);
      paintPropStandIn(ctx, 'hollow', 'wood', rect.x, rect.y, rect.w, rect.h);
    }
    for (let frame = 0; frame < PUFF_FRAMES; frame++) {
      const rect = spotRect(frame, 1);
      paintFloor(ctx, 'skyfowl', ...floorInCell(frame, 1));
      paintPropStandIn(ctx, 'skyfowl', 'wood', rect.x, rect.y, rect.w, rect.h);
      drawContractFinishPuff(
        ctx,
        rect,
        (frame / PUFF_FRAMES) * CONTRACT_FINISH_PUFF_SECONDS,
        TILE_SIZE * PROP_STANDIN_RISE_TILES,
      );
    }
  });
}

// ── Real rooms ────────────────────────────────────────────────────────────────

interface PlacedSpot {
  readonly id: string;
  readonly kind: 'repair' | 'rebuild';
  readonly material: Material;
  readonly surface: Surface;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

function overlaySpec(spot: PlacedSpot, settlement: Settlement) {
  return {
    cacheKey: spot.id,
    material: spot.material,
    surface: spot.surface,
    settlement,
    widthTiles: spot.rect.w,
    heightTiles: spot.rect.h,
    tilePx: TILE_SIZE,
    seed: contractSpotArtSeed(spot.id),
  };
}

function drawSpot(
  ctx: CanvasRenderingContext2D,
  spot: PlacedSpot,
  settlement: Settlement,
  camX: number,
  camY: number,
): void {
  const spec = overlaySpec(spot, settlement);
  const x = spot.rect.x * TILE_SIZE - camX;
  const y = spot.rect.y * TILE_SIZE - camY;
  if (spot.kind === 'rebuild') drawContractBuildSite(ctx, spec, x, y);
  else drawContractOverlay(ctx, spec, x, y);
}

/** A moment in the highlight's pulse where its sparks and motes are both well under way. */
const HIGHLIGHT_SNAPSHOT_MS = 900;
const HIGHLIGHT_STYLE = {
  color: contractSpotHighlightColor('ready'),
  nowMs: HIGHLIGHT_SNAPSHOT_MS,
  mood: 'ready',
} as const;

function screenRect(spot: PlacedSpot, camX: number, camY: number) {
  return {
    x: spot.rect.x * TILE_SIZE - camX,
    y: spot.rect.y * TILE_SIZE - camY,
    w: spot.rect.w * TILE_SIZE,
    h: spot.rect.h * TILE_SIZE,
  };
}

/** The ground half of every spot's highlight, as `ContractSiteWork.renderGround` draws it. */
function drawSpotHighlights(ctx: CanvasRenderingContext2D, spots: readonly PlacedSpot[]): void {
  for (const spot of spots) drawAreaHighlightGround(ctx, screenRect(spot, 0, 0), HIGHLIGHT_STYLE);
}

/** The frame half over every standing spot, as `ContractSiteWork.renderAbove` draws it. */
function drawSpotFrames(ctx: CanvasRenderingContext2D, spots: readonly PlacedSpot[]): void {
  const scratch = { x: 0, y: 0, w: 0, h: 0 };
  for (const spot of spots) {
    const rect = contractSpotFrameRect(spot, 0, 0, scratch);
    if (rect !== null) drawAreaHighlightFrame(ctx, rect, HIGHLIGHT_STYLE);
  }
}

function isGroundSpot(spot: PlacedSpot): boolean {
  return spot.kind === 'rebuild' || spot.surface !== 'prop';
}

function skyfowlRoom(): void {
  const site = CONTRACT_SITES.find((candidate) => candidate.slug === skyfowlSlug);
  if (site?.town !== 'skyfowl')
    throw new Error(`--skyfowl=${skyfowlSlug} names no Skyfowl Town site`);
  const plan = createTownPlan(TOWN_PLAN_SIZE);
  const building = plan.buildings.find((candidate) => candidate.name === site.buildingName);
  if (building === undefined) throw new Error(`${site.buildingName} is not in the town plan`);
  const map = new GameMap({
    tileHeight: TILE_SIZE,
    prebuiltStructure: [],
    artSeed: FLOOR_ART_SEEDS[0],
  });
  map.generateInterior(building.kind, 0, building.name, false, 'default');
  map.invalidateAllTileArt();
  const spots: PlacedSpot[] = [];
  const hiddenPropIds = new Set<string>();
  for (const spot of site.spots) {
    const footprint = skyfowlSpotFootprint(site, spot, map);
    if (footprint === null) {
      console.warn(`  ${spot.id}: target not found in the layout`);
      continue;
    }
    spots.push({
      id: spot.id,
      kind: spot.kind,
      material: spot.material,
      surface: footprint.surface,
      rect: footprint.rect,
    });
    if (spot.kind === 'rebuild' && spot.target.kind === 'prop')
      hiddenPropIds.add(spot.target.placedId);
  }
  const propSpotByPlacedId = new Map<string, PlacedSpot>();
  for (const spot of site.spots) {
    const placed = spots.find((candidate) => candidate.id === spot.id);
    if (placed !== undefined && spot.target.kind === 'prop' && placed.kind === 'repair') {
      propSpotByPlacedId.set(spot.target.placedId, placed);
    }
  }
  const viewW = (map.structure[0]?.length ?? 0) * TILE_SIZE;
  const viewH = map.structure.length * TILE_SIZE;
  // The highlights cull against the viewport.
  setViewportSize(viewW, viewH);
  const paintRoom =
    (withSpots: boolean): ScenePainter =>
    (ctx) => {
      map.renderCanvas(ctx, 0, 0, viewW, viewH);
      drawTownInteriorGroundProps(ctx, map, 0, 0, TILE_SIZE);
      map.renderDecorationsOverlay(ctx, 0, 0, viewW, viewH);
      if (withSpots) {
        for (const spot of spots.filter(isGroundSpot)) drawSpot(ctx, spot, 'skyfowl', 0, 0);
        drawSpotHighlights(ctx, spots);
      }
      const figures = townInteriorPropFigures(map, withSpots ? hiddenPropIds : new Set()).sort(
        (a, b) => a.y - b.y,
      );
      for (const figure of figures) {
        figure.render(ctx, 0, 0, TILE_SIZE);
        const spot = propSpotByPlacedId.get(figure.placed.id);
        if (withSpots && spot !== undefined) drawSpot(ctx, spot, 'skyfowl', 0, 0);
      }
      if (withSpots) drawSpotFrames(ctx, spots);
    };
  writeAllScales(`room-skyfowl-${site.slug}`, viewW, viewH, paintRoom(true));
  writeAllScales(`room-skyfowl-${site.slug}-before`, viewW, viewH, paintRoom(false));
  for (const spot of spots)
    console.log(
      `  ${spot.id}: ${spot.kind} ${spot.material} ${spot.surface} ${JSON.stringify(spot.rect)}`,
    );
}

function hollowRoom(): void {
  const site = CONTRACT_SITES.find((candidate) => candidate.slug === hollowSlug);
  if (site?.town !== 'briar_hollow')
    throw new Error(`--hollow=${hollowSlug} names no Briar Hollow site`);
  const gameMap: GameMapInstance = new GameMap({
    mapSize: OVERWORLD_SIZE,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: HOLLOW_WORLD_SEED,
  });
  const village = gameMap.briarHollow;
  if (village === null) throw new Error('this world has no Briar Hollow');
  const building = village.buildings.find((candidate) => candidate.id === site.buildingId);
  if (building === undefined) throw new Error(`${site.buildingId} is not in the village`);
  const view = {
    x: building.rect.x - ROOM_MARGIN_TILES,
    y: building.rect.y - ROOM_MARGIN_TILES * 2,
    w: building.rect.w + ROOM_MARGIN_TILES * 2,
    h: building.rect.h + ROOM_MARGIN_TILES * ROOM_VIEW_ROWS_OF_MARGIN,
  };
  const camX = view.x * TILE_SIZE;
  const camY = view.y * TILE_SIZE;
  const viewW = view.w * TILE_SIZE;
  const viewH = view.h * TILE_SIZE;
  setViewportSize(viewW, viewH);

  const state = createBriarHollowState();
  // Off the view, so no spot is the one in reach and only the highlights show.
  const builder = new HumanPlayer(camX - TILE_SIZE * view.w, camY, TILE_SIZE);
  const cat = new CatPlayer(builder.x, builder.y, TILE_SIZE);
  const contracts = new ConstructionContractSystem({
    state,
    gameMap,
    site: village,
    human: builder,
    cat,
    audio: null,
    bus: new EventBus(),
    conversation: new Conversation(null),
    villagers: {
      addQuestLineProvider: () => undefined,
      removeQuestLineProvider: () => undefined,
      villagerFor: () => null,
    },
    flyCoins: () => undefined,
    soldierTile: () => null,
    announce: () => undefined,
    noteResourceActivity: () => undefined,
    worldHalted: () => false,
    pleaPhase: () => 'unmet',
  });

  const paintRoom =
    (withSpots: boolean): ScenePainter =>
    (ctx) => {
      renderCanvas(ctx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
      if (withSpots) contracts.renderGround(ctx, camX, camY, builder);
      // Decorations first and a stable sort, as `RenderPipeline` queues them,
      // so an overlay whose foot ties with a wall's draws in front of it.
      const draws: Array<{ sortY: number; draw: () => void }> = [];
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
      if (withSpots) {
        for (const overlay of contracts.renderEntities()) {
          draws.push({
            sortY: overlay.y + TILE_SIZE,
            draw: () => overlay.render(ctx, camX, camY, TILE_SIZE),
          });
        }
      }
      draws.sort((a, b) => a.sortY - b.sortY);
      for (const item of draws) item.draw();
      if (withSpots) contracts.renderAbove(ctx, camX, camY);
    };

  writeAllScales(`room-hollow-${site.slug}-before`, viewW, viewH, paintRoom(false));
  state.contracts.active = {
    site: contractSiteKey(site),
    spotIds: site.spots.map((spot) => spot.id),
    spotsDone: site.spots.map(() => false),
  };
  contracts.update();
  writeAllScales(`room-hollow-${site.slug}`, viewW, viewH, paintRoom(true));
  contracts.dispose();
  for (const spot of site.spots) {
    const footprint = briarHollowSpotFootprint(site, spot, village);
    console.log(
      `  ${spot.id}: ${spot.kind} ${spot.material} ${footprint?.surface ?? 'missing'} ${JSON.stringify(footprint?.rect ?? null)}`,
    );
  }
}

for (const settlement of SETTLEMENTS) swatchSheet(settlement);
effectsSheet();
skyfowlRoom();
hollowRoom();
