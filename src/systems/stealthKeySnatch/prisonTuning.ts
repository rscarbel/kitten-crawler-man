/**
 * Every number the Goblin High Security Prison's stealth is tuned by, per
 * difficulty.
 *
 * The layouts are authored once; difficulty changes only what is read from
 * here: which optional guards and spotlights stand their posts, how far and
 * wide a flashlight reaches, how fast patrols walk and beams travel, and how
 * quickly being seen fills a light's suspicion. `npm run verify:prison-stealth`
 * proves every layout at every difficulty against these same values.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type { PlayerDamageType } from '../../creatures/Mob';
import type { PrisonTier } from '../../map/goblinPrisonLayouts';

export interface PrisonConeTuning {
  readonly rangeTiles: number;
  readonly halfAngleDeg: number;
  /**
   * The outer share of the cone's half-angle and of its range over which the
   * suspicion rate fades from full to {@link PrisonSuspicionTuning.coneEdgeWeight}.
   */
  readonly softEdge: number;
}

export interface PrisonSpotlightTuning {
  readonly radiusTiles: number;
  readonly speedPxPerFrame: number;
}

/**
 * Suspicion runs 0..1 per light; at 1 the capture starts. Each rate is given
 * as the frames it takes to run the whole way, which is how it is felt.
 */
export interface PrisonSuspicionTuning {
  readonly kind: 'gradual';
  /** Frames to fill, for a crawler on a cone's axis at close range. */
  readonly coneFillFrames: number;
  /** The rate multiplier at a cone's soft edge and far end. */
  readonly coneEdgeWeight: number;
  /** Frames to fill anywhere inside a spotlight's disc. Spotlights fill faster than flashlights. */
  readonly spotFillFrames: number;
  /** Frames to drain from full while the light sees nobody. */
  readonly drainFrames: number;
}

/**
 * A watcher that catches at a glance: a crawler in full view is caught within
 * `CAUGHT_AFTER_SEEN_FRAMES`, whatever the difficulty, so only the edge of its
 * look and how long it stays wary are tuned.
 */
export interface OnSightNoticeTuning {
  readonly kind: 'on_sight';
  /**
   * Frames a crawler seen at weight 1 would take to raise the orange alert
   * were full view not quicker; at the soft edge's weight `w` it takes this
   * over `w`.
   */
  readonly alertFillFrames: number;
  /** The sighting weight at a look's soft edge and far end. */
  readonly coneEdgeWeight: number;
  /** Frames to drain from full while it sees nobody. */
  readonly drainFrames: number;
}

/** How any stealth watcher's suspicion rises and falls. */
export type WatcherNoticeTuning = PrisonSuspicionTuning | OnSightNoticeTuning;

export interface PrisonDifficultyTuning {
  /** Guards authored at this tier or below stand their posts. */
  readonly guardTier: PrisonTier;
  /** Spotlights authored at this tier or below are lit. */
  readonly spotlightTier: PrisonTier;
  readonly cone: PrisonConeTuning;
  readonly patrolSpeedPxPerFrame: number;
  /** How fast a guard turns its flashlight, in degrees per frame. Turns are never snapped. */
  readonly turnDegPerFrame: number;
  readonly spotlight: PrisonSpotlightTuning;
  readonly suspicion: WatcherNoticeTuning;
}

export const PRISON_TUNING: Readonly<Record<Difficulty, PrisonDifficultyTuning>> = {
  easy: {
    guardTier: 0,
    spotlightTier: 0,
    cone: { rangeTiles: 4.5, halfAngleDeg: 26, softEdge: 0.3 },
    patrolSpeedPxPerFrame: 1,
    turnDegPerFrame: 2.5,
    spotlight: { radiusTiles: 1.4, speedPxPerFrame: 1.3 },
    suspicion: {
      kind: 'gradual',
      coneFillFrames: 60,
      coneEdgeWeight: 0.35,
      spotFillFrames: 40,
      drainFrames: 90,
    },
  },
  normal: {
    guardTier: 1,
    spotlightTier: 1,
    cone: { rangeTiles: 5, halfAngleDeg: 30, softEdge: 0.25 },
    patrolSpeedPxPerFrame: 1.15,
    turnDegPerFrame: 3,
    spotlight: { radiusTiles: 1.6, speedPxPerFrame: 1.6 },
    suspicion: {
      kind: 'gradual',
      coneFillFrames: 45,
      coneEdgeWeight: 0.35,
      spotFillFrames: 30,
      drainFrames: 120,
    },
  },
  hard: {
    guardTier: 2,
    spotlightTier: 2,
    cone: { rangeTiles: 5.5, halfAngleDeg: 34, softEdge: 0.2 },
    patrolSpeedPxPerFrame: 1.3,
    turnDegPerFrame: 3.5,
    spotlight: { radiusTiles: 1.8, speedPxPerFrame: 1.9 },
    suspicion: {
      kind: 'gradual',
      coneFillFrames: 32,
      coneEdgeWeight: 0.4,
      spotFillFrames: 22,
      drainFrames: 150,
    },
  },
};

/** What made a noise. Every landed party attack is one of the damage types; a blast is `'explosion'`. */
export type PrisonNoiseKind = PlayerDamageType;

/** How far each kind of noise carries, in tiles. Dynamite carries furthest. */
export const PRISON_NOISE_RADIUS_TILES: Readonly<Record<PrisonNoiseKind, number>> = {
  melee: 4,
  slingshot: 4,
  energy_shield: 3,
  missile: 5,
  seismic_stomp: 6,
  explosion: 10,
};

/**
 * A guard only answers a noise it can reach without a long detour: the walk
 * there may be at most this many times the noise's own radius.
 */
export const INVESTIGATION_PATH_SLACK = 1.5;

/** How long a guard sweeps its light around the spot a noise came from, in frames. */
export const INVESTIGATION_SWEEP_FRAMES = 150;

/** How far either side of the noise's bearing the investigating guard sweeps, in degrees. */
export const INVESTIGATION_SWEEP_HALF_ARC_DEG = 70;
