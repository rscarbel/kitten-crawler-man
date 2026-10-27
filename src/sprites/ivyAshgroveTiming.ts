/**
 * How long each of Ivy Ashgrove's one-shot rows plays, and where in the shot
 * the arrow leaves. Kept apart from her art so a kit can pace itself on these
 * without importing a painter.
 */

import { BOW_RELEASE_FRAME, BOW_SHOT_FRAMES } from './art/human/timing';

/**
 * The whole shot, nock to recovered: a little over a second, the aim held
 * long enough to read before the loose.
 */
export const IVY_SHOT_DURATION_MS = 1100;
/**
 * The share of the shot at which the string is loosed and the arrow must be
 * spawned: the start of the first frame drawn with the arrow gone. The row is
 * drawn at frame `floor(progress × frames)`, so this is that frame's start.
 */
export const IVY_SHOT_RELEASE_PROGRESS = BOW_RELEASE_FRAME / BOW_SHOT_FRAMES;
/** The flinch: a snap back and the step under it, about the human crawler's own. */
export const IVY_HURT_DURATION_MS = 400;
/** The fall from on her feet to lying still, before the shell holds and fades the body. */
export const IVY_DEATH_DURATION_MS = 800;
