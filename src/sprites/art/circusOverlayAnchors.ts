/**
 * Where the circus grounds' live dressing meets the baked structure art.
 *
 * The moving parts of the grounds — a flame lamp's fire, the caravan's
 * curtain, the balloons tied at the ticket booth, bunting tied to a pole — are
 * drawn every frame by `CircusGroundsAmbience`, over frames the painters in
 * `circusArt.ts` bake once. Both read their positions from here, so the
 * painted half of a prop and its live half cannot drift apart.
 *
 * Every anchor is in tiles on the structure's own footprint: `x` east from its
 * west edge, `up` above its south edge (the ground line), in the game's
 * projection where a step north and a step up both move a point one tile up
 * the frame.
 */

/** A point on a structure's footprint, in tiles. */
export interface CircusOverlayAnchor {
  readonly x: number;
  readonly up: number;
}

/** A rectangle on a structure's footprint, in tiles: `up` is its bottom edge. */
export interface CircusOverlayRect {
  readonly x: number;
  readonly up: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The flame lamp's brazier mouth: the centre of the clown face's open mouth,
 * where the live flame stands. The painter leaves the mouth a dark hollow of
 * {@link FLAME_LAMP_MOUTH_HALF_WIDTH_TILES} either side of this point.
 */
export const FLAME_LAMP_MOUTH: CircusOverlayAnchor = { x: 0.5, up: 2.05 };
export const FLAME_LAMP_MOUTH_HALF_WIDTH_TILES = 0.11;
/** Where a string of bunting or bulbs is tied onto a flame lamp's pole, just under the brazier. */
export const FLAME_LAMP_TIE: CircusOverlayAnchor = { x: 0.5, up: 1.72 };

/**
 * The clown caravan's side window, facing the viewer. The painter glazes it
 * dark and hangs the curtain's still half; the live curtain twitches inside
 * this rectangle.
 */
export const CARAVAN_WINDOW: CircusOverlayRect = { x: 1.9, up: 0.98, w: 0.46, h: 0.4 };

/** Where the tethered balloons' strings are tied onto the ticket booth. */
export const TICKET_BOOTH_BALLOON_TIE: CircusOverlayAnchor = { x: 1.72, up: 1.62 };

/** The pavilions' single king pole: its peak, where the canvas meets, above the footprint's centre. */
export const PAVILION_PEAK_HEIGHT_TILES = 2.5;
/** How far the pavilion's pole cap stands above its peak. */
export const PAVILION_POLE_CAP_TILES = 0.3;
