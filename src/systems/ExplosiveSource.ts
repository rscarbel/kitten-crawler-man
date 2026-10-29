/**
 * Anything that puts lit explosives in the world, told to the mobs that want
 * to react to them: one that runs clear of a blast, one that kicks a stick
 * away. A mob reads them through `creatures/explosiveAwareness.ts`, which
 * `MobUpdateLoop` publishes every frame, the same way it publishes marked
 * ground.
 */

/** A lit stick of dynamite in the world: the only explosive a body can kick. */
export type LiveStickId = `stick_${number}`;

/** A black powder bomb on its lob, which goes off where it lands. */
export type LiveBombId = `bomb_${number}`;

/** Whose explosive it is. Every explosive in the world today is the party's. */
type ExplosiveFaction = 'party';

/** World pixels per frame. */
export interface ExplosiveVelocity {
  readonly vx: number;
  readonly vy: number;
}

interface LiveExplosiveCommon {
  /** Where it goes off if it went off now, in world pixels: a stick's body, a bomb's landing point. */
  readonly x: number;
  readonly y: number;
  /** Frames until it goes off. */
  readonly fuseFramesLeft: number;
  /** How far its blast reaches from {@link x}, {@link y}, in world pixels. */
  readonly blastRadiusPx: number;
  readonly owner: ExplosiveFaction;
}

/** One explosive alight in the world, as a mob sees it. */
export type LiveExplosive =
  | (LiveExplosiveCommon & {
      readonly kind: 'stick';
      readonly id: LiveStickId;
      /** False while it is still drawn in the air from the throw or a kick. */
      readonly grounded: boolean;
    })
  | (LiveExplosiveCommon & { readonly kind: 'bomb'; readonly id: LiveBombId });

export interface ExplosiveSource {
  /** Every explosive alight in the world this frame. */
  liveExplosives(): readonly LiveExplosive[];
  /**
   * Relaunches the stick `id` from where it lies at `velocity`, its fuse still
   * burning. False when no such stick is alight any more.
   */
  kick(id: LiveStickId, velocity: ExplosiveVelocity): boolean;
}
