import type { Pt } from '../sprites/art/bipedArt';
import type { ThrownPropVisualId } from '../sprites/held/heldVisualIds';

/**
 * How a crawler stands with an explosive that has not left them yet:
 * - `readied` — unlit, waiting for a tap on the world to say where it goes;
 * - `lighting` — a stick being lit and drawn back while the throw's power builds;
 * - `windingUp` — a bomb drawn back while the throw's power builds; it has no
 *   fuse to light.
 */
export type ExplosiveStance = 'readied' | 'lighting' | 'windingUp';

/** What a throw tells `DynamiteSystem` as it plays. */
export interface ThrowCallbacks {
  /** The tick the explosive leaves the thrower, at {@link ExplosiveThrower.explosiveReleasePoint}. */
  readonly onRelease: () => void;
  /**
   * The throw is over, whether or not it got as far as letting go; `defeated`
   * when the thrower went down under it, so the world it would land in is about
   * to be rewound or rebuilt.
   */
  readonly onEnd: (defeated: boolean) => void;
}

/**
 * The picture half of throwing an explosive: how a crawler takes one up,
 * stands with it, throws it and where it leaves them. The human lights a stick
 * and throws it from his fist; the cat carries it in her jaws and flings it
 * with a flick of her head. What the throw does is `DynamiteSystem`'s, the
 * same whoever throws.
 */
export interface ExplosiveThrower {
  /** Puts an explosive that looks like `look` in hand or jaws. */
  takeExplosive(look: ThrownPropVisualId): void;
  /**
   * Keeps the thrower posed for `stance`. Asked every tick the explosive waits,
   * so a stride or a turn that took over is put right once the thrower stands
   * still again.
   */
  holdExplosive(stance: ExplosiveStance): void;
  /**
   * Plays the throw. Refused (false) when the thrower cannot throw right now:
   * mid-blow, reeling or out cold.
   */
  throwExplosive(callbacks: ThrowCallbacks): boolean;
  /** Ends any pose with an explosive that is still playing, throwing nothing. */
  dropExplosivePose(): void;
  /** Where in the world the explosive leaves the thrower on the cell drawn this tick. */
  explosiveReleasePoint(): Pt;
}
