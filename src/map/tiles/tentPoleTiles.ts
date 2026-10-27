/**
 * Tent poles in the Y-sorted decoration pass.
 *
 * A run of pole tiles is one pole. Its floor (sawdust and contact shadow) is
 * baked into the chunk like any floor; the mast is drawn once, from the
 * pole's bottom-left tile, so it sorts on the pole's foot: a crawler north of
 * the pole walks behind the mast as it rises out of view, one south of it in
 * front. The king pole also carries the trapeze hanging over the ring, the
 * flap cut in the roof where it passes through, and the rope ladder up its
 * south face to that flap.
 */

import type { TileContent } from '../tileTypes';
import type { MapSpriteExtentsPx } from '../../core/spriteAssets/SpriteLoader';
import {
  MAST_RISE_TILES,
  paintTentMast,
} from '../../sprites/art/starlightTent/starlightTentShellArt';
import {
  paintRoofFlap,
  paintRopeLadder,
  paintTrapeze,
  ROOF_FLAP_OVERHANG_TILES,
  TRAPEZE_REACH_WEST_TILES,
} from '../../sprites/art/starlightTent/finaleProps';
import { poleCellAt } from './interiorTiles';

/** A pole at least this many tiles across both ways is the ring's king pole. */
const KING_POLE_MIN_TILES = 2;

/** Whether this pole tile is the one that draws the whole mast: the pole's bottom-left. */
export function tentPoleDrawsAt(structure: TileContent[][], tx: number, ty: number): boolean {
  const cell = poleCellAt(structure, tx, ty);
  return cell.column === 0 && cell.row === cell.blockHeight - 1;
}

function isKingPole(blockWidth: number, blockHeight: number): boolean {
  return Math.min(blockWidth, blockHeight) >= KING_POLE_MIN_TILES;
}

/** Draws the mast from its drawing tile; every other tile of the pole draws nothing here. */
export function drawTentPoleTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  if (!tentPoleDrawsAt(structure, tx, ty)) return;
  const cell = poleCellAt(structure, tx, ty);
  const originX = sx - cell.column * ts;
  const originY = sy - cell.row * ts;
  const king = isKingPole(cell.blockWidth, cell.blockHeight);
  if (king) {
    paintTrapeze(ctx, originX, originY, ts);
    paintRoofFlap(ctx, originX, originY, ts, cell.blockWidth, cell.blockHeight);
  }
  paintTentMast(ctx, originX, originY, ts, cell.blockWidth, cell.blockHeight);
  if (king) paintRopeLadder(ctx, originX, originY, ts, cell.blockWidth, cell.blockHeight);
}

const NO_EXTENTS: MapSpriteExtentsPx = { left: 0, up: 0, right: 0, down: 0 };

/** How far the drawing tile's art reaches past its own square: the rest of the pole, the rise, the trapeze and the roof flap. */
export function tentPoleExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
  ts: number,
): MapSpriteExtentsPx {
  if (!tentPoleDrawsAt(structure, tx, ty)) return NO_EXTENTS;
  const cell = poleCellAt(structure, tx, ty);
  const king = isKingPole(cell.blockWidth, cell.blockHeight);
  return {
    left: king ? Math.ceil(TRAPEZE_REACH_WEST_TILES * ts) : 0,
    up: (cell.blockHeight - 1 + MAST_RISE_TILES) * ts,
    right: (cell.blockWidth - 1) * ts + (king ? Math.ceil(ROOF_FLAP_OVERHANG_TILES * ts) : 0),
    down: 0,
  };
}
