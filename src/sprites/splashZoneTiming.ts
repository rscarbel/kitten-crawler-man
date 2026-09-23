/**
 * Frame counts, event frames and playback lengths for Splash Zone's rows and
 * his water effects.
 *
 * The choreography (`src/sprites/art/splashZoneFigure.ts`) paints the bolt
 * leaving the crossbow and the wave leaving his paws on the frames named here,
 * and the combat kit spawns the bolt and the wave on the tick those frames are
 * drawn. Copying any of these numbers into either side instead is how a bolt
 * ends up flying while the crossbow in his paw is still loaded.
 *
 * This module deliberately imports nothing — the offline gates load it directly,
 * so it must not pull in any browser-only code.
 */

/** Game ticks per second; every duration below is in ticks. */
export const SPLASH_ZONE_TICKS_PER_SECOND = 60;

export const SPLASH_ZONE_IDLE_FRAMES = 12;
export const SPLASH_ZONE_WALK_FRAMES = 12;
export const SPLASH_ZONE_SHOOT_FRAMES = 8;
export const SPLASH_ZONE_CAST_WAVE_FRAMES = 12;
export const SPLASH_ZONE_HURT_FRAMES = 4;
export const SPLASH_ZONE_DEATH_FRAMES = 12;

/** Fraction of the shoot row at which the string snaps and the bolt leaves. */
export const SPLASH_ZONE_SHOOT_RELEASE_PROGRESS = 0.5;
/** Fraction of the cast row at which the paws reach full extension and the wave leaves. */
export const SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS = 0.6;

/**
 * The frame a timing fraction is drawn on.
 *
 * One-shot rows are sampled at frame centres — frame `f` shows the pose at
 * `(f + 0.5) / frames` — so the first frame whose pose is past the fraction is
 * the one nearest `progress * frames - 0.5`, rounded up.
 */
function frameAt(frames: number, progress: number): number {
  return Math.max(0, Math.ceil(frames * progress - 0.5));
}

/** The first shoot frame drawn with the crossbow empty and the bolt away. */
export const SPLASH_ZONE_SHOOT_RELEASE_FRAME = frameAt(
  SPLASH_ZONE_SHOOT_FRAMES,
  SPLASH_ZONE_SHOOT_RELEASE_PROGRESS,
);
/** The first cast frame drawn with the water thrown off the paws. */
export const SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME = frameAt(
  SPLASH_ZONE_CAST_WAVE_FRAMES,
  SPLASH_ZONE_CAST_WAVE_RELEASE_PROGRESS,
);
/** The death row's last frame: the corpse, held while it fades. */
export const SPLASH_ZONE_CORPSE_FRAME = SPLASH_ZONE_DEATH_FRAMES - 1;

/** How long each one-shot row plays, in ticks. */
export const SPLASH_ZONE_SHOOT_TICKS = 32;
export const SPLASH_ZONE_CAST_WAVE_TICKS = 54;
export const SPLASH_ZONE_HURT_TICKS = 14;
export const SPLASH_ZONE_DEATH_TICKS = 66;

/** Loop speed of the idle bounce, in frames per second. */
export const SPLASH_ZONE_IDLE_FPS = 8;

/**
 * The tick, counted from a row's start, on which a frame first appears when
 * the row is played over `durationTicks` through `progressFrameIndex`.
 */
export function splashZoneTickOfFrame(
  frame: number,
  frames: number,
  durationTicks: number,
): number {
  return Math.ceil((frame / frames) * durationTicks);
}

/** The tick of the shoot row on which the bolt should be spawned. */
export const SPLASH_ZONE_SHOOT_RELEASE_TICK = splashZoneTickOfFrame(
  SPLASH_ZONE_SHOOT_RELEASE_FRAME,
  SPLASH_ZONE_SHOOT_FRAMES,
  SPLASH_ZONE_SHOOT_TICKS,
);
/** The tick of the cast row on which the wave should be spawned. */
export const SPLASH_ZONE_CAST_WAVE_RELEASE_TICK = splashZoneTickOfFrame(
  SPLASH_ZONE_CAST_WAVE_RELEASE_FRAME,
  SPLASH_ZONE_CAST_WAVE_FRAMES,
  SPLASH_ZONE_CAST_WAVE_TICKS,
);

// ── Effects ──────────────────────────────────────────────────────────────────

export const SPLASH_ZONE_BOLT_FRAMES = 4;
export const SPLASH_ZONE_WAVE_FRAMES = 8;
export const SPLASH_ZONE_SPLASH_FRAMES = 8;
/** Loop speeds of the bolt's shimmer and the wave's rolling crest. */
export const SPLASH_ZONE_BOLT_FPS = 16;
export const SPLASH_ZONE_WAVE_FPS = 12;
/** How long an impact splash plays, in ticks. */
export const SPLASH_ZONE_SPLASH_TICKS = 24;
