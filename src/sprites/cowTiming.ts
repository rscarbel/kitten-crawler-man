/**
 * The cow's row lengths and playback rates, shared by the figure that paints
 * the rows, the runtime that plays them and the gates that measure them.
 *
 * One module rather than a copy in each: a frame count the runtime believes and
 * the painter does not is a row that freezes on its last frame or never plays
 * its tail, and nothing but watching that one animation would show it.
 */

export const COW_WALK_FRAMES = 16;
export const COW_IDLE_FRAMES = 12;
export const COW_GRAZE_FRAMES = 12;
export const COW_HAPPY_FRAMES = 16;
export const COW_FLINCH_FRAMES = 6;
export const COW_TROT_FRAMES = 12;
export const COW_LIE_FRAMES = 1;
export const COW_LIE_DOWN_FRAMES = 8;

/**
 * Ground covered per walk cycle, in tiles, for an adult and for a calf.
 *
 * A planted hoof slides back through the cell at a fixed rate through its
 * stance, and the sprite has to be carried over the ground at exactly that rate
 * or the hooves skate. The runtime advances the walk phase by distance actually
 * covered — `2π / (COW_TILES_PER_WALK_CYCLE * tileSize)` radians per pixel —
 * and caps the advance at one row frame per tick, past which the row is
 * undersampled and the legs vibrate rather than walk.
 *
 * Frozen here because the runtime cannot measure a pose; `scripts/gates-cow.ts`
 * re-measures it from the choreography's planted hooves on every render and
 * fails if the two disagree.
 */
export const COW_TILES_PER_WALK_CYCLE = 0.8;
export const CALF_TILES_PER_WALK_CYCLE = 0.6;

/** The same, for the panic trot. */
export const COW_TILES_PER_TROT_CYCLE = 1.0344827586206897;
export const CALF_TILES_PER_TROT_CYCLE = 0.7586206896551725;

/** Clock-driven loops: an idle cow chews about once a second at this rate. */
export const COW_IDLE_FPS = 6;
export const COW_GRAZE_FPS = 6;
/** One-shots, as frames per second of play. */
export const COW_HAPPY_FPS = 12;
export const COW_FLINCH_FPS = 12;
export const COW_LIE_DOWN_FPS = 8;
