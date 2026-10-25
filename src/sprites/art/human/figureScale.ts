/**
 * How big the human is drawn, kept apart from the cell that paints him so the gait
 * can turn its strides into world pixels without importing the cell — which
 * imports the gait.
 */

/**
 * How much of a tile one unit of the human rig fills, for every figure built
 * on it. The anatomy is authored at a comfortable working size and then
 * scaled about its own ground line, which keeps the feet on the tile they
 * belong to. The rig is 2.03 units from sole to crown (`FIGURE_HEIGHT`); the
 * painted ink, hair and outline included, measures about 2.3 units, which at
 * this scale stands about 1.66 tiles — 53 px at the 32 px tile, the height
 * the town's crowds are drawn at.
 */
export const HUMAN_SCALE = 0.72;

/**
 * How much larger than the rig at {@link HUMAN_SCALE} the player's own human
 * is drawn, every look and every view alike: he is the one figure the player
 * watches all game, and at the town's scale he read as too small beside the
 * goblins and doorways he plays against. Everyone else built on the rig —
 * townsfolk, residents, the Incubus — stays at the rig's size.
 */
export const PLAYER_HUMAN_SIZE_OVER_RIG = 1.2;

/** How much of a tile one figure unit of the player's human spans. */
export const PLAYER_HUMAN_SCALE = HUMAN_SCALE * PLAYER_HUMAN_SIZE_OVER_RIG;

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * Cell pixels per figure unit of the rig at `HUMAN_SCALE` of a tile `TILE_SCALE`
 * px across; the player's figure stretches it by its look's axes
 * (`playerLookAxes`), which carry {@link PLAYER_HUMAN_SIZE_OVER_RIG}.
 */
export const HUMAN_CELL_PX_PER_UNIT = TILE_SCALE * HUMAN_SCALE;

/** Cell pixels per figure unit of the player's human, before his look's own build. */
export const PLAYER_HUMAN_CELL_PX_PER_UNIT = TILE_SCALE * PLAYER_HUMAN_SCALE;

/** The centre of his tile across, as a fraction of it: where the Smush damage is measured from. */
export const TILE_CENTRE_FRACTION = 0.5;

/** A tile-fraction `x` as a cell mirrored for a −X facing draws it: flipped about the tile's centre. */
export function mirroredTileX(x: number, flipX: boolean): number {
  return flipX ? 2 * TILE_CENTRE_FRACTION - x : x;
}
