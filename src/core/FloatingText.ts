/**
 * Requests for world-anchored feedback labels ("MISS!", "+1 DEX", "COCKROACH!").
 *
 * Gameplay code that has no scene reference — `Player.takeDamage`, level-up
 * handling — queues these on the player; `FloatingCombatTextSystem` drains the
 * queue and owns the rendering.
 */

/** Visual treatment for a floating label. */
export type FloatingTextStyle = 'miss' | 'buff' | 'trigger';

export interface FloatingTextRequest {
  text: string;
  style: FloatingTextStyle;
}
