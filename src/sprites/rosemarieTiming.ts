/**
 * Frame counts, playback rates and the coin-release timing for Rosemarie and
 * Bernie, the mole on her shoulder.
 *
 * The choreography (`src/sprites/art/rosemarieFigure.ts`), the runtime sprite
 * (`src/sprites/rosemarieSprite.ts`) and whatever launches the thrown coin all
 * read these. A coin spawned off a copied number leaves her hand a frame
 * before or after the flick that throws it, and nothing but watching it would
 * say so.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

/** One slow hobble: weight onto the cane, off it again, and a cane re-plant. */
export const ROSEMARIE_IDLE_FRAMES = 12;
/**
 * Six frames a second makes the hobble a two-second breath of a thing — about
 * the pace an old woman leaning on a stick shifts her weight. The row moves at
 * most a pixel or two per frame at the 32 px tile, well inside what six frames
 * a second carries without strobing.
 */
export const ROSEMARIE_IDLE_FPS = 6;

/** Pocket, coin up, cock the wrist, flick, follow through, cackle, settle. */
export const ROSEMARIE_COIN_TOSS_FRAMES = 10;
/**
 * How long one coin toss plays. Eight-tenths of a second: the dip to the
 * pocket is slow and the flick is one frame, which is what makes it read as a
 * flick rather than a throw.
 */
export const ROSEMARIE_COIN_TOSS_DURATION_MS = 800;
/**
 * The frame the flick is drawn on: her wrist has snapped through and the hand
 * is open and empty. The coin is not painted on it — the runtime's thrown coin
 * starts from `rosemarieCoinReleasePoint` on this frame and is the only coin on
 * screen from here on.
 */
export const ROSEMARIE_COIN_TOSS_RELEASE_FRAME = 6;
/**
 * The same moment as a fraction of the row, for a caller driving the row by
 * progress. One-shot rows are sampled at frame centres, so frame `f` shows
 * progress `(f + 0.5) / frames`.
 */
export const ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS =
  (ROSEMARIE_COIN_TOSS_RELEASE_FRAME + 0.5) / ROSEMARIE_COIN_TOSS_FRAMES;

/** Bernie's snuffle: nose down, then nose up and twitching. */
export const BERNIE_SNUFFLE_FRAMES = 2;
/**
 * How many snuffle steps a second while he is sniffing. A two-frame row looped
 * steadily reads as a flicker, so the runtime plays it in bursts (see
 * `BERNIE_SNUFFLE_PATTERN`) at this rate and rests between them.
 */
export const BERNIE_SNUFFLE_FPS = 8;
/**
 * One burst of sniffing and the pause after it, as frame indices played one
 * per `BERNIE_SNUFFLE_FPS` tick. A mole sniffs in quick trains of three or four
 * twitches and then goes still with its nose down.
 *
 * Twenty-three steps long: at `BERNIE_SNUFFLE_FPS` that is a 2.875 s loop
 * against her 2 s hobble, so his bursts land on a different moment of her
 * sway each time round and the pair only lines up again every 46 seconds.
 * A 24-step pattern would be 3 s and repeat with her every 6.
 */
export const BERNIE_SNUFFLE_PATTERN: readonly number[] = [
  1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
];
