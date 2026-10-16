/**
 * The receding dungeon hall: two side walls and a far wall of the cellars'
 * own masonry, a flagged floor running away to them, pilasters down each
 * wall, and the stairwell going down through an arched doorway in the far
 * wall. Painted in one-point perspective by drawing the game's flat wall and
 * floor art one screen column (walls) or one screen row (floor) at a time,
 * baked once per size, and lit by the light layer rather than here.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { smoothstepUnit } from '../../../map/overworld/elevation';
import { canvasGeneration } from '../../../core/canvasRecovery';
import { DEFAULT_DUNGEON_FLOOR_THEME } from '../../../map/dungeon/floorTheme';
import { getMaterial, paintPatch } from '../../../map/tilegen/materials';
import { TILE_PX, type Surface } from '../../../map/tilegen/raster';
import { dungeonWallMasonry, paintFaceStrip } from '../../../sprites/art/dungeonWallArt';
import { STAIRWELL_OPENING, paintStairwell } from '../../../sprites/art/stairwellArt';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import { TitleBakedPlane } from '../titleBake';
import {
  HALL_DEPTH,
  WALL_FADE_START_TILES,
  WALL_HEIGHT_TILES,
  distanceAtScale,
  floorScaleAt,
  rowAtHeight,
  sideWallColumn,
  sideWallScaleAt,
  titleHall,
  type TitleHall,
} from '../titleHall';
import { applyTitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';

/** The hall is the cellars, whatever floor the player last stood on. */
const HALL_THEME = DEFAULT_DUNGEON_FLOOR_THEME;
/** Square dressed flags: their joints are the lines that carry the floor's recession. */
const FLOOR_MATERIAL_ID = 'f1_flags';
const FLOOR_STRUCTURE_SEED = 0x7a11;
const FLOOR_DETAIL_SEED = 0x7a12;

/** Past the stage on every side, for the camera's drift and shake. */
const BAKE_MARGIN_PX = 28;

const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const CHANNEL_MAX = 255;

/**
 * Rows of the face strip under its cap carry the cap's shadow; built into a
 * wall taller than one face they would draw a ledge across it, so the strip is
 * used from this far below the cap down and plain masonry stands above.
 */
const FACE_ROWS_SKIPPED_BELOW_CAP = 24;

/** Halvings in each texture's mip chain; the far end of the hall minifies its stone this much. */
const MIP_LEVELS = 4;

/** How dark the far end of the hall is baked before any torch lights it. */
const DEPTH_SHADE_AT_FAR_WALL = 0.42;

/** The dark band where the floor meets each wall, in tiles out from the wall. */
const JUNCTION_SHADE_TILES = 0.9;
const JUNCTION_SHADE_TEXTURE_PX = 64;

/** A pilaster's width down the hall, and the shadow it throws on the wall beyond it. */
const PILASTER_WIDTH_TILES = 0.7;
const PILASTER_SHADOW_TILES = 0.35;
const PILASTER_LIGHT_ALPHA = 0.1;
const PILASTER_SHADOW_ALPHA = 0.45;

/** The doorway's dressed-stone arch, and the dark reveal inside it. */
const DOOR_FRAME_TILES = 0.24;
const DOOR_REVEAL_TILES = 0.08;
/** The faint warm breath rising out of the stairwell, as a share of the door's width. */
const DOOR_GLOW_RADIUS_SHARE = 0.9;
const DOOR_GLOW_INNER = 0;

/** Each wall starts its masonry at a different place, so the two sides are not mirror copies. */
const LEFT_WALL_U_OFFSET_PX = 0;
const RIGHT_WALL_U_OFFSET_PX = 131;
const FAR_WALL_U_OFFSET_PX = 57;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

interface MipChain {
  readonly levels: readonly CanvasSurface[];
  readonly width: number;
  readonly height: number;
}

interface HallTextures {
  readonly wall: MipChain;
  readonly floor: MipChain;
  readonly junctionShade: CanvasSurface;
  readonly generation: number;
}

let cachedTextures: HallTextures | null = null;

function hallTextures(): HallTextures {
  const generation = canvasGeneration();
  if (cachedTextures !== null && cachedTextures.generation === generation) return cachedTextures;
  cachedTextures = {
    wall: mipChain(paintWallTexture()),
    floor: mipChain(paintFloorTexture()),
    junctionShade: paintJunctionShade(),
    generation,
  };
  return cachedTextures;
}

/**
 * A wall as tall as the hall's, one masonry patch wide: the floor's real face
 * strip at the foot (tide line and all), the same masonry continued above it,
 * and the stone falling away to nothing toward the vault.
 */
function paintWallTexture(): CanvasSurface {
  const strip = paintFaceStrip(HALL_THEME, 0);
  const masonry = dungeonWallMasonry(HALL_THEME);
  const width = strip.width;
  const height = Math.round(WALL_HEIGHT_TILES * TILE_PX);
  const firstStripRow = strip.capTopRow + FACE_ROWS_SKIPPED_BELOW_CAP;
  const stripRowsUsed = strip.height - firstStripRow;
  const stripTop = height - stripRowsUsed;
  const fadeStartRow = height - WALL_FADE_START_TILES * TILE_PX;

  const canvas = allocCanvas(width, height);
  const ctx = surfaceContext(canvas);
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const fade = y >= fadeStartRow ? 1 : smoothstep(y / Math.max(1, fadeStartRow));
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * RGBA_CHANNELS;
      if (y >= stripTop) {
        const source = ((y - stripTop + firstStripRow) * width + x) * RGB_CHANNELS;
        image.data[out] = strip.rgb[source];
        image.data[out + 1] = strip.rgb[source + 1];
        image.data[out + 2] = strip.rgb[source + 2];
      } else {
        // Row `firstStripRow` of the strip is row `firstStripRow` of the masonry, so counting back from it joins the two without a seam.
        const [red, green, blue] = masonry.get(x, firstStripRow - (stripTop - y));
        image.data[out] = red * fade;
        image.data[out + 1] = green * fade;
        image.data[out + 2] = blue * fade;
      }
      image.data[out + RGBA_CHANNELS - 1] = CHANNEL_MAX * fade;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function paintFloorTexture(): CanvasSurface {
  return surfaceToCanvas(
    paintPatch(getMaterial(FLOOR_MATERIAL_ID), FLOOR_STRUCTURE_SEED, FLOOR_DETAIL_SEED),
  );
}

function surfaceToCanvas(surface: Surface): CanvasSurface {
  const canvas = allocCanvas(surface.size, surface.size);
  const ctx = surfaceContext(canvas);
  const image = ctx.createImageData(surface.size, surface.size);
  image.data.set(surface.toRgba());
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function paintJunctionShade(): CanvasSurface {
  const canvas = allocCanvas(JUNCTION_SHADE_TEXTURE_PX, 1);
  const ctx = surfaceContext(canvas);
  const gradient = ctx.createLinearGradient(0, 0, JUNCTION_SHADE_TEXTURE_PX, 0);
  gradient.addColorStop(0, TITLE_INK.hall.junctionShade);
  gradient.addColorStop(1, TITLE_INK.hall.junctionShadeFade);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, JUNCTION_SHADE_TEXTURE_PX, 1);
  return canvas;
}

function mipChain(base: CanvasSurface): MipChain {
  const levels: CanvasSurface[] = [base];
  let previous = base;
  for (let level = 1; level < MIP_LEVELS; level++) {
    const width = Math.max(1, Math.round(previous.width * HALF));
    const height = Math.max(1, Math.round(previous.height * HALF));
    const next = allocCanvas(width, height);
    const ctx = surfaceContext(next);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(previous, 0, 0, width, height);
    levels.push(next);
    previous = next;
  }
  return { levels, width: base.width, height: base.height };
}

/** The mip level for a texture shrunk by `minification` texels per device pixel. */
function mipLevelFor(minification: number): number {
  if (minification <= 1) return 0;
  return Math.min(MIP_LEVELS - 1, Math.floor(Math.log2(minification)));
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function smoothstep(t: number): number {
  return smoothstepUnit(Math.min(1, Math.max(0, t)));
}

/** How much darker the hall is baked at eye distance `distanceTiles`. */
function depthShadeAt(hall: TitleHall, distanceTiles: number): number {
  const span = Math.max(Number.EPSILON, hall.farDistanceTiles - hall.heroDistanceTiles);
  return DEPTH_SHADE_AT_FAR_WALL * smoothstep((distanceTiles - hall.heroDistanceTiles) / span);
}

interface WallColumn {
  readonly x: number;
  readonly width: number;
  readonly scale: number;
  /** Texture column, in base-level texels. */
  readonly u: number;
  /** Texels of the base level this column spans across. */
  readonly uSpan: number;
}

function drawWallColumn(
  ctx: CanvasRenderingContext2D,
  hall: TitleHall,
  wall: MipChain,
  column: WallColumn,
  pixelRatio: number,
): void {
  const top = rowAtHeight(hall, column.scale, hall.wallHeightTiles);
  const bottom = rowAtHeight(hall, column.scale, 0);
  const heightPx = bottom - top;
  if (heightPx <= 0) return;
  const verticalMinification = wall.height / (heightPx * pixelRatio);
  const horizontalMinification = column.uSpan / (column.width * pixelRatio);
  const level = mipLevelFor(Math.max(verticalMinification, horizontalMinification));
  const texture = wall.levels[level];
  const levelScale = texture.width / wall.width;
  const sourceX = positiveMod(column.u, wall.width) * levelScale;
  const sourceWidth = Math.max(1, column.uSpan * levelScale);
  const clampedWidth = Math.min(sourceWidth, texture.width - sourceX);
  ctx.drawImage(
    texture,
    sourceX,
    0,
    clampedWidth,
    texture.height,
    column.x,
    top,
    column.width,
    heightPx,
  );
}

function shadeColumn(
  ctx: CanvasRenderingContext2D,
  hall: TitleHall,
  x: number,
  width: number,
  scale: number,
  ink: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const top = rowAtHeight(hall, scale, hall.wallHeightTiles);
  const bottom = rowAtHeight(hall, scale, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ink;
  ctx.fillRect(x, top, width, bottom - top);
  ctx.globalAlpha = 1;
}

/** Whether a wall at eye distance `distanceTiles` is a pilaster's face, its shadow, or plain wall. */
function pilasterAt(hall: TitleHall, distanceTiles: number): 'face' | 'shadow' | 'none' {
  for (const rib of hall.ribDistancesTiles) {
    const offset = distanceTiles - rib;
    if (Math.abs(offset) <= PILASTER_WIDTH_TILES * HALF) return 'face';
    const pastFarEdge = offset - PILASTER_WIDTH_TILES * HALF;
    if (pastFarEdge > 0 && pastFarEdge <= PILASTER_SHADOW_TILES) return 'shadow';
  }
  return 'none';
}

function paintSideWall(
  ctx: CanvasRenderingContext2D,
  stage: TitleStage,
  hall: TitleHall,
  wall: MipChain,
  side: -1 | 1,
  pixelRatio: number,
): void {
  const step = 1 / pixelRatio;
  const corner = sideWallColumn(hall, 1, side);
  const outerEdge = side < 0 ? -BAKE_MARGIN_PX : stage.width + BAKE_MARGIN_PX;
  const uOffset = side < 0 ? LEFT_WALL_U_OFFSET_PX : RIGHT_WALL_U_OFFSET_PX;
  const columnCount = Math.ceil(Math.abs(outerEdge - corner) / step);
  for (let i = 0; i < columnCount; i++) {
    const nearX = corner + side * i * step;
    const x = side < 0 ? nearX - step : nearX;
    const scale = sideWallScaleAt(hall, nearX + side * step * HALF);
    const distance = distanceAtScale(hall, scale);
    const nextDistance = distanceAtScale(hall, sideWallScaleAt(hall, nearX + side * step));
    const u = distance * TILE_PX + uOffset;
    const uSpan = Math.abs(distance - nextDistance) * TILE_PX;
    drawWallColumn(ctx, hall, wall, { x, width: step, scale, u, uSpan }, pixelRatio);

    const pilaster = pilasterAt(hall, distance);
    if (pilaster === 'face') {
      shadeColumn(ctx, hall, x, step, scale, TITLE_INK.hall.pilasterLight, PILASTER_LIGHT_ALPHA);
    } else if (pilaster === 'shadow') {
      shadeColumn(ctx, hall, x, step, scale, TITLE_INK.hall.depthShade, PILASTER_SHADOW_ALPHA);
    }
    shadeColumn(ctx, hall, x, step, scale, TITLE_INK.hall.depthShade, depthShadeAt(hall, distance));
  }
}

function paintFarWall(
  ctx: CanvasRenderingContext2D,
  hall: TitleHall,
  wall: MipChain,
  pixelRatio: number,
): void {
  const step = 1 / pixelRatio;
  const left = sideWallColumn(hall, 1, -1);
  const right = sideWallColumn(hall, 1, 1);
  const texelsPerPx = TILE_PX / hall.farPxPerTile;
  const columnCount = Math.ceil((right - left) / step);
  for (let i = 0; i < columnCount; i++) {
    const x = left + i * step;
    const u = (x - left) * texelsPerPx + FAR_WALL_U_OFFSET_PX;
    drawWallColumn(
      ctx,
      hall,
      wall,
      { x, width: step, scale: 1, u, uSpan: texelsPerPx * step },
      pixelRatio,
    );
  }
  shadeColumn(
    ctx,
    hall,
    left,
    right - left,
    1,
    TITLE_INK.hall.depthShade,
    depthShadeAt(hall, hall.farDistanceTiles),
  );
}

function paintFloor(
  ctx: CanvasRenderingContext2D,
  stage: TitleStage,
  hall: TitleHall,
  textures: HallTextures,
  pixelRatio: number,
): void {
  const floor = textures.floor;
  const step = 1 / pixelRatio;
  const bottom = stage.height + BAKE_MARGIN_PX;
  const rowCount = Math.ceil((bottom - hall.farFloorY) / step);
  for (let i = 0; i < rowCount; i++) {
    const y = hall.farFloorY + i * step;
    const scale = floorScaleAt(hall, y + step * HALF);
    const distance = distanceAtScale(hall, scale);
    const nextDistance = distanceAtScale(hall, floorScaleAt(hall, y + step));
    const pxPerTile = hall.farPxPerTile * scale;
    const wallLeft = sideWallColumn(hall, scale, -1);
    const wallRight = sideWallColumn(hall, scale, 1);
    const left = Math.max(wallLeft, -BAKE_MARGIN_PX);
    const right = Math.min(wallRight, stage.width + BAKE_MARGIN_PX);
    if (right <= left) continue;

    const verticalMinification =
      (Math.abs(distance - nextDistance) * TILE_PX) / (step * pixelRatio);
    const horizontalMinification = TILE_PX / (pxPerTile * pixelRatio);
    const level = mipLevelFor(Math.max(verticalMinification, horizontalMinification));
    const texture = floor.levels[level];
    const levelScale = texture.width / floor.width;
    // A source row reaching past the texture's last row draws nothing at all, so it is held one row short of the edge.
    const lastRow = texture.height - 1;
    const v = Math.min(lastRow, positiveMod(distance * TILE_PX, floor.height) * levelScale);
    const texelsPerPx = (TILE_PX / pxPerTile) * levelScale;
    const firstTexel =
      ((left - hall.vanish.x) / pxPerTile + hall.halfWidthTiles) * TILE_PX * levelScale;
    paintFloorRow(ctx, texture, firstTexel, texelsPerPx, v, left, right, y, step);

    const shadeWidth = JUNCTION_SHADE_TILES * pxPerTile;
    ctx.drawImage(textures.junctionShade, wallLeft, y, shadeWidth, step);
    ctx.save();
    ctx.translate(wallRight, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(textures.junctionShade, 0, y, shadeWidth, step);
    ctx.restore();

    const shade = depthShadeAt(hall, distance);
    if (shade > 0) {
      ctx.globalAlpha = shade;
      ctx.fillStyle = TITLE_INK.hall.depthShade;
      ctx.fillRect(left, y, right - left, step);
      ctx.globalAlpha = 1;
    }
  }
}

/** One screen row of floor, wrapping round the patch as many times as the row needs. */
function paintFloorRow(
  ctx: CanvasRenderingContext2D,
  texture: CanvasSurface,
  firstTexel: number,
  texelsPerPx: number,
  v: number,
  left: number,
  right: number,
  y: number,
  height: number,
): void {
  let x = left;
  let texel = positiveMod(firstTexel, texture.width);
  while (x < right) {
    const texelsLeftInPatch = texture.width - texel;
    const pxLeftInPatch = texelsLeftInPatch / texelsPerPx;
    const spanPx = Math.min(right - x, pxLeftInPatch);
    const spanTexels = spanPx * texelsPerPx;
    if (spanTexels > 0) {
      ctx.drawImage(texture, texel, v, spanTexels, 1, x, y, spanPx, height);
    }
    x += spanPx;
    texel = 0;
  }
}

function traceDoorArch(ctx: CanvasRenderingContext2D, hall: TitleHall, inset: number): void {
  const { door } = hall;
  const left = door.x + inset;
  const right = door.x + door.w - inset;
  const radius = (right - left) * HALF;
  const springY = door.y + door.w * HALF;
  const bottom = door.y + door.h;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, springY);
  ctx.arc(left + radius, springY, radius, HALF_TURN, FULL_TURN);
  ctx.lineTo(right, bottom);
  ctx.closePath();
}

function paintDoorway(ctx: CanvasRenderingContext2D, hall: TitleHall): void {
  const { door } = hall;
  const frame = DOOR_FRAME_TILES * hall.farPxPerTile;
  const reveal = DOOR_REVEAL_TILES * hall.farPxPerTile;

  traceDoorArch(ctx, hall, -frame);
  ctx.fillStyle = TITLE_INK.hall.doorFrame;
  ctx.fill();

  ctx.save();
  traceDoorArch(ctx, hall, 0);
  ctx.clip();
  ctx.fillStyle = TITLE_INK.hall.doorVoid;
  ctx.fillRect(door.x, door.y, door.w, door.h);
  const openingWidthShare = STAIRWELL_OPENING.right - STAIRWELL_OPENING.left;
  const size = door.w / openingWidthShare;
  const originX = door.x - STAIRWELL_OPENING.left * size;
  const originY = hall.farFloorY - STAIRWELL_OPENING.bottom * size;
  paintStairwell(ctx, originX, originY, size, HALL_THEME);

  const glowRadius = door.w * DOOR_GLOW_RADIUS_SHARE;
  const glowX = door.x + door.w * HALF;
  const glowY = hall.farFloorY - door.w * HALF;
  const glow = ctx.createRadialGradient(glowX, glowY, DOOR_GLOW_INNER, glowX, glowY, glowRadius);
  glow.addColorStop(0, TITLE_INK.hall.doorGlow);
  glow.addColorStop(1, TITLE_INK.hall.doorGlowFade);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(door.x, door.y, door.w, door.h);
  ctx.restore();

  traceDoorArch(ctx, hall, 0);
  ctx.strokeStyle = TITLE_INK.hall.doorReveal;
  ctx.lineWidth = reveal;
  ctx.stroke();
}

function paintHall(ctx: CanvasRenderingContext2D, stage: TitleStage, pixelRatio: number): void {
  const hall = titleHall(stage);
  const textures = hallTextures();
  ctx.imageSmoothingEnabled = true;
  paintFarWall(ctx, hall, textures.wall, pixelRatio);
  paintSideWall(ctx, stage, hall, textures.wall, -1, pixelRatio);
  paintSideWall(ctx, stage, hall, textures.wall, 1, pixelRatio);
  paintFloor(ctx, stage, hall, textures, pixelRatio);
  paintDoorway(ctx, hall);
}

/** Paints the hall's wall and floor textures now, so the title's first frame only has to lay them out. */
export function prewarmTitleHall(): void {
  hallTextures();
}

export function dungeonHallLayer(): TitleLayer {
  const plane = new TitleBakedPlane(paintHall, BAKE_MARGIN_PX);
  return {
    id: 'dungeonHall',
    depth: HALL_DEPTH,
    layout: () => plane.invalidate(),
    render: (ctx, _clock, stage, camera) => {
      applyTitleCamera(ctx, camera, HALL_DEPTH);
      plane.draw(ctx, stage, camera.zoom);
    },
    dispose: () => plane.dispose(),
  };
}
