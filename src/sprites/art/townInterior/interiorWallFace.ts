/**
 * The inner face of a town building's own walls — what a player actually
 * sees looking across a room, not just the props standing in front of it.
 *
 * Drawn as an overlay pass directly over the flat ground-material fill
 * `drawGroundMaterialTile` already paints for an `INTERIOR_WALL` tile
 * (`src/map/tiles/terrainTiles.ts`). This file never touches the baked
 * `ground_interior` sheet, the tile type, walkability or sight — a wall
 * tile is exactly as solid and exactly as sight-blocking as it always was;
 * only what gets drawn on top of it changed.
 */

import { rgb, rgba, type Rng } from '../town/townArt';
import { getTownRamp, sampleRamp, type Ramp } from '../town/townPalette';
import { paintPlasterWash, paintStoneCourses, paintPlankBoard } from '../town/townMaterials';
import { mulberry32 } from '../../person/rng';

type Ctx = CanvasRenderingContext2D;

/** Which finish a building's own walls are dressed in, chosen per building. */
export type TownInteriorWallMaterialId = 'plaster' | 'stone' | 'timber';

const SKIRTING_HEIGHT_FRACTION = 0.2;
const CORNICE_HEIGHT_FRACTION = 0.07;
const CORNICE_ALPHA = 0.6;
const SKIRTING_LINE_ALPHA = 0.5;
const EDGE_BAND_FRACTION = 0.24;
const EDGE_LIT_ALPHA = 0.55;
const EDGE_SHADOW_ALPHA = 0.4;
const EDGE_SHADOW_BAND_SCALE = 0.55;
/** A tile-deterministic hash so the same wall tile always paints the same picture. */
const TILE_SEED_X_PRIME = 73856093;
const TILE_SEED_Y_PRIME = 19349663;
/** A plaster wall's timber-post hint appears on every third tile, not every one. */
const WALL_POST_TILE_SPACING = 3;
const WALL_POST_WIDTH_FRACTION = 0.05;
const WALL_POST_INSET_FRACTION = 0.5;
const WALL_POST_ALPHA = 0.3;

function tileRng(tx: number, ty: number): Rng {
  const seed = ((tx * TILE_SEED_X_PRIME) ^ (ty * TILE_SEED_Y_PRIME)) >>> 0;
  return mulberry32(seed);
}

function wallWoodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function wallStoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}
function wallPlasterRamp(): Ramp {
  return getTownRamp('oc_plaster');
}

function rampForMaterial(material: TownInteriorWallMaterialId): Ramp {
  if (material === 'timber') return wallWoodRamp();
  if (material === 'stone') return wallStoneRamp();
  return wallPlasterRamp();
}

/**
 * The tall, fully visible face of a wall tile whose south neighbour is
 * floor — a room's own north wall, the one elevation a player looking down
 * into the room actually sees standing up. A timber skirting or stone
 * plinth always runs along the foot regardless of the wall's own finish (a
 * plaster wall still stands on a real base), and a lit cornice line caps it.
 */
export function paintNorthInteriorWallFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  material: TownInteriorWallMaterialId,
  tx: number,
  ty: number,
): void {
  const rng = tileRng(tx, ty);
  const skirtH = h * SKIRTING_HEIGHT_FRACTION;
  const bodyH = h - skirtH;

  if (material === 'timber') {
    paintPlankBoard(ctx, x, y, w, bodyH, rng, {
      direction: 'vertical',
      boardPx: w / 2.4,
      ramp: wallWoodRamp(),
    });
  } else if (material === 'stone') {
    paintStoneCourses(ctx, x, y, w, bodyH, wallStoneRamp(), rng);
  } else {
    paintPlasterWash(ctx, x, y, w, bodyH, wallPlasterRamp(), rng);
    // A hint of a timber post, not a full framed bay: `paintTimberFraming`
    // draws corner posts, a head beam and a diagonal brace sized for one
    // continuous facade span, and calling it per one-tile wall segment
    // repeats its brace into a cramped sawtooth. A single quiet vertical
    // line every few tiles reads as "post glimpsed behind plaster" instead.
    if (tx % WALL_POST_TILE_SPACING === 0) {
      const postW = Math.max(1, w * WALL_POST_WIDTH_FRACTION);
      ctx.fillStyle = rgba(sampleRamp(wallWoodRamp(), 0.4), WALL_POST_ALPHA);
      ctx.fillRect(x + w * WALL_POST_INSET_FRACTION, y, postW, bodyH);
    }
  }

  const skirtRamp = material === 'stone' ? wallStoneRamp() : wallWoodRamp();
  ctx.fillStyle = rgb(sampleRamp(skirtRamp, 0.3));
  ctx.fillRect(x, y + bodyH, w, skirtH);
  ctx.strokeStyle = rgba(sampleRamp(skirtRamp, 0.6), SKIRTING_LINE_ALPHA);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + bodyH);
  ctx.lineTo(x + w, y + bodyH);
  ctx.stroke();

  const corniceRamp = material === 'stone' ? wallStoneRamp() : wallPlasterRamp();
  const corniceH = h * CORNICE_HEIGHT_FRACTION;
  ctx.fillStyle = rgba(sampleRamp(corniceRamp, 0.92), CORNICE_ALPHA);
  ctx.fillRect(x, y, w, corniceH);
}

/**
 * A side or south wall tile: the room's floor is visible from only one
 * side of it, so it reads as a clean thick edge (a lit outward face, a
 * shadowed inward one) rather than a full elevation — the same convention
 * a top-down room's near and side walls always use.
 */
export function paintEdgeInteriorWallFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  material: TownInteriorWallMaterialId,
  side: 'west' | 'east' | 'south',
): void {
  const ramp = rampForMaterial(material);
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.42));
  ctx.fillRect(x, y, w, h);

  const bandThickness = side === 'south' ? h * EDGE_BAND_FRACTION : w * EDGE_BAND_FRACTION;
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.78), EDGE_LIT_ALPHA);
  if (side === 'west') ctx.fillRect(x + w - bandThickness, y, bandThickness, h);
  else if (side === 'east') ctx.fillRect(x, y, bandThickness, h);
  else ctx.fillRect(x, y, w, bandThickness);

  const shadowThickness = bandThickness * EDGE_SHADOW_BAND_SCALE;
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.12), EDGE_SHADOW_ALPHA);
  if (side === 'west') ctx.fillRect(x, y, shadowThickness, h);
  else if (side === 'east') ctx.fillRect(x + w - shadowThickness, y, shadowThickness, h);
  else ctx.fillRect(x, y + h - shadowThickness, w, shadowThickness);
}
