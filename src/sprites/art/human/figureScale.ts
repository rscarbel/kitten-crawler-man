/**
 * How big Carl is drawn, kept apart from the cell that paints him so the gait
 * can turn its strides into world pixels without importing the cell — which
 * imports the gait.
 */

/**
 * How much of a tile Carl fills. The anatomy is authored at a comfortable
 * working size and then scaled about his own ground line, which keeps his feet
 * on the tile they belong to. His rig is 2.03 units from sole to crown
 * (`FIGURE_HEIGHT`); the painted ink, hair and outline included, measures
 * about 2.3 units, which at this scale stands about 1.66 tiles — 53 px at the
 * 32 px tile, the height the maps' doorways, corridors and crowds are built
 * around; any taller and he reads as a giant beside them.
 */
export const HUMAN_SCALE = 0.72;

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/** Cell pixels per figure unit: a tile at `TILE_SCALE`, with Carl drawn at `HUMAN_SCALE` of it. */
export const HUMAN_CELL_PX_PER_UNIT = TILE_SCALE * HUMAN_SCALE;

/** The centre of his tile across, as a fraction of it: where the Smush damage is measured from. */
export const TILE_CENTRE_FRACTION = 0.5;

/** A tile-fraction `x` as a cell mirrored for a −X facing draws it: flipped about the tile's centre. */
export function mirroredTileX(x: number, flipX: boolean): number {
  return flipX ? 2 * TILE_CENTRE_FRACTION - x : x;
}
