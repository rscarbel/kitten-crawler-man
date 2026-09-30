/**
 * Where the hall of mirrors hangs its marquees: the board's over the exits,
 * and each teaching lane's beside the doorway it opens.
 *
 * Shared by the maze, which draws them, and the stage lights, which bake a
 * pool under each — the two have to agree on where a marquee is, and both
 * only know it once the board has been dealt.
 */

import {
  boardTileToTent,
  MIRROR_BOARD_TENT_ORIGIN,
  type BoardStar,
  type MirrorBoard,
} from '../../map/bigTop/mirrorBoard';
import {
  MAZE_TEACHING_DOORWAYS,
  MIRROR_HALL_GLASS_COLUMNS,
  TEACHING_STRIP_BOARD,
  teachingStarLane,
  type MazeHalf,
  type MazeTile,
} from '../../map/bigTopMazeLayout';
import { starMarqueeWidthTiles } from '../../sprites/art/bigTop/mirrorPuzzleProps';

/** A marquee's left edge and wall row, in tiles, and how wide it is. */
export interface MarqueePlacement {
  /** The left edge, in fractional tiles. */
  readonly x: number;
  /** The wall row it hangs on. */
  readonly y: number;
  readonly widthTiles: number;
}

const HALF = 0.5;

/** The dividing wall's column, which the board's marquee is centred on. */
const DIVIDER_COLUMN = MIRROR_HALL_GLASS_COLUMNS[1];

/**
 * Stars in the order their bulbs stand on a marquee: the ones a solve needs
 * first, the optional encore last, so the bulbs that matter are read first.
 */
export function marqueeStarOrder(stars: ReadonlyArray<BoardStar>): BoardStar[] {
  return [
    ...stars.filter((star) => star.kind !== 'encore'),
    ...stars.filter((star) => star.kind === 'encore'),
  ];
}

/**
 * The board's marquee: on the wall between the two exits, one row above their
 * gates, centred on the dividing wall so both lanes read it as theirs. That
 * wall is outside the board, so no star the board deals can ever be under it.
 */
export function hallMarqueePlacement(board: MirrorBoard): MarqueePlacement {
  const widthTiles = starMarqueeWidthTiles(board.stars.length);
  return {
    x: DIVIDER_COLUMN + HALF - widthTiles / 2,
    // The board's own top row is the wall its gates are cut into.
    y: MIRROR_BOARD_TENT_ORIGIN.y - 1,
    widthTiles,
  };
}

/** Wall tiles a two-bulb marquee spans beside a doorway. */
const TEACHING_MARQUEE_SPAN_TILES = 2;

/**
 * A teaching lane's two-bulb marquee, on the hall's bottom wall beside that
 * lane's doorway. The hall's board may set one of its own stars in that wall,
 * so the marquee takes whichever side of the doorway is clear of them, the
 * lane's outer side first.
 */
export function teachingMarqueePlacement(board: MirrorBoard, half: MazeHalf): MarqueePlacement {
  const doorway = MAZE_TEACHING_DOORWAYS[half];
  const widthTiles = starMarqueeWidthTiles(teachingStarsOf(half).length);
  const hallStarTiles = board.stars.map((star) => boardTileToTent(star.tile));
  const outward = half === 'human' ? -1 : 1;
  const sides = [outward, -outward];
  const leftTileOf = (side: number): number =>
    side < 0 ? doorway.x - TEACHING_MARQUEE_SPAN_TILES : doorway.x + 1;
  const isClear = (side: number): boolean => {
    const left = leftTileOf(side);
    return !hallStarTiles.some(
      (tile) =>
        tile.y === doorway.y && tile.x >= left && tile.x < left + TEACHING_MARQUEE_SPAN_TILES,
    );
  };
  const side = sides.find(isClear) ?? outward;
  return {
    x: leftTileOf(side) + (TEACHING_MARQUEE_SPAN_TILES - widthTiles) / 2,
    y: doorway.y,
    widthTiles,
  };
}

/** A teaching lane's own stars, in board order. */
export function teachingStarsOf(half: MazeHalf): BoardStar[] {
  return TEACHING_STRIP_BOARD.stars.filter((star) => teachingStarLane(star) === half);
}

/** The middle of a marquee, in fractional tiles, where its lamp pool is centred. */
export function marqueeCentre(placement: MarqueePlacement): { x: number; y: number } {
  return { x: placement.x + placement.widthTiles / 2, y: placement.y + HALF };
}

/** Whether a tile lies under any part of a marquee. */
export function marqueeCovers(placement: MarqueePlacement, tile: MazeTile): boolean {
  return (
    tile.y === placement.y &&
    tile.x + 1 > placement.x &&
    tile.x < placement.x + placement.widthTiles
  );
}
