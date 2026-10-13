/**
 * The attack cow's own row lengths and playback rates, shared by the figure
 * that paints the rows and the creature that plays them, so the frame a
 * headbutt lands on is the frame it is drawn landing on. The rows she borrows
 * from the village cow keep `cowTiming.ts`'s numbers.
 */

export const ATTACK_COW_HEADBUTT_FRAMES = 10;
/** The frame the helmet is driven furthest forward: the blow lands on it. */
export const ATTACK_COW_HEADBUTT_IMPACT_FRAME = 5;
export const ATTACK_COW_HEADBUTT_FPS = 15;

export const ATTACK_COW_DOWNED_FRAMES = 8;
export const ATTACK_COW_DOWNED_FPS = 12;
