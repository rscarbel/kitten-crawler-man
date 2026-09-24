/**
 * Requests for world-anchored feedback labels ("MISS!", "+1 DEX", "COCKROACH!",
 * "Blocked").
 *
 * Gameplay code that has no scene reference — `Player.takeDamage`, level-up
 * handling, a mob guarding a blow — queues these on the body they belong to;
 * `FloatingCombatTextSystem` drains the queue and owns the rendering.
 */

/** Visual treatment for a floating label. */
export type FloatingTextStyle = 'miss' | 'buff' | 'trigger' | 'block';

export interface FloatingTextRequest {
  text: string;
  style: FloatingTextStyle;
  /**
   * When set, the label is dropped if the same text was already shown over the
   * same body within this many frames. For labels a flurry of blows can raise
   * every frame, which would otherwise stack into an unreadable column.
   */
  throttleFrames?: number;
}

/** Optional behaviour for `Player.queueFloatingText`. */
export type FloatingTextOptions = Pick<FloatingTextRequest, 'throttleFrames'>;
