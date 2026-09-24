/**
 * The Grotesque Spider's attack clock and hit geometry.
 *
 * Every consumer that has to agree on *when* an attack lands — the creature's
 * damage tick, the sprite frame that shows contact, the ground telegraph, the
 * audio cue and the screen feedback — reads it from the tables here, so none of
 * them can drift from the others. The hit shapes live here for the same reason:
 * the telegraph that draws a shape and the test that hits inside it read one
 * set of constants.
 *
 * This module must stay free of the creature class so the art, the gates and
 * the audio can import it without pulling in the whole mob.
 */

import { TILE_SIZE } from '../core/constants';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from './mobLevelScaling';

/** Every attack the spider can commit to. */
export type SpiderAttack = 'slam' | 'screech' | 'spit' | 'lay';

/** The four readable stages every attack passes through, in order. */
export type SpiderAttackStage = 'tell' | 'lock' | 'strike' | 'recovery';

export interface SpiderAttackTimeline {
  /** Frames the pose and telegraph build while aim may still track. */
  readonly tellFrames: number;
  /**
   * Frames aim and shape are frozen before the strike. At least
   * `LOCKED_TELEGRAPH_MIN_FRAMES` for every attack that can hit; `lay` hits
   * nothing and has no lock.
   */
  readonly lockFrames: number;
  /**
   * Frames the strike pose is held from the damage tick on. At least
   * `MIN_IMPACT_HOLD_FRAMES`, because `Scene.loop` can run two updates per
   * callback and a pose held for a single tick may never be drawn. For `lay`
   * this is the stretch the eggs drop across.
   */
  readonly impactHoldFrames: number;
  /** Punish window: she cannot act, turn, or move, and takes bonus damage. */
  readonly recoveryFrames: number;
  /** Seconds into the attack's impact sound file where the audible hit is, or null for no timed cue. */
  readonly audioImpactSeconds: number | null;
}

/** Game frames per second; every frame count in this module is at this rate. */
export const SPIDER_FRAMES_PER_SECOND = 60;

/**
 * The shortest hold of a strike pose. Two catch-up updates can share a single
 * render, so anything shorter than a few ticks can be skipped over entirely.
 */
export const MIN_IMPACT_HOLD_FRAMES = 4;

/** Seconds into `grotesque_spider_slam_attack` where the legs audibly hit. */
const SLAM_AUDIO_IMPACT_SECONDS = 0.5;
/** Seconds into `grotesque_spider_screech_attack` where the burst peaks. */
const SCREECH_AUDIO_IMPACT_SECONDS = 1.05;

/** Frames between successive eggs of one clutch. */
const LAY_EGG_INTERVAL_FRAMES = 8;
/** The largest clutch any HP phase lays; sizes the drop window. */
export const MAX_EGG_CLUTCH_SIZE = 3;

/**
 * Tell and lock lengths are identical in every HP phase: only the gaps between
 * attacks and the attack mix change as she weakens, so what a player learned
 * about reading an attack early in the fight stays true at the end of it.
 */
export const SPIDER_ATTACK_TIMELINES: Readonly<Record<SpiderAttack, SpiderAttackTimeline>> = {
  slam: {
    tellFrames: 60,
    lockFrames: 30,
    impactHoldFrames: 8,
    recoveryFrames: 50,
    audioImpactSeconds: SLAM_AUDIO_IMPACT_SECONDS,
  },
  screech: {
    tellFrames: 75,
    lockFrames: 30,
    impactHoldFrames: 10,
    recoveryFrames: 60,
    audioImpactSeconds: SCREECH_AUDIO_IMPACT_SECONDS,
  },
  spit: {
    tellFrames: 40,
    lockFrames: 24,
    impactHoldFrames: 6,
    recoveryFrames: 24,
    audioImpactSeconds: null,
  },
  lay: {
    tellFrames: 36,
    lockFrames: 0,
    impactHoldFrames: LAY_EGG_INTERVAL_FRAMES * MAX_EGG_CLUTCH_SIZE,
    recoveryFrames: 55,
    audioImpactSeconds: null,
  },
};

/** Every attack that can hit, i.e. every one that must honour the locked-telegraph floor. */
export const SPIDER_DAMAGING_ATTACKS: readonly Exclude<SpiderAttack, 'lay'>[] = [
  'slam',
  'screech',
  'spit',
];

for (const attack of SPIDER_DAMAGING_ATTACKS) {
  if (SPIDER_ATTACK_TIMELINES[attack].lockFrames < LOCKED_TELEGRAPH_MIN_FRAMES) {
    throw new Error(`Grotesque Spider ${attack} locks for less than the fairness floor`);
  }
}

/** The attack frame the damage tick lands on: the first frame after the lock. */
export function strikeFrame(attack: SpiderAttack): number {
  const timeline = SPIDER_ATTACK_TIMELINES[attack];
  return timeline.tellFrames + timeline.lockFrames;
}

/** Frames from the first tell tick to the end of recovery; the attack's frames are `0 .. totalFrames - 1`. */
export function totalFrames(attack: SpiderAttack): number {
  const timeline = SPIDER_ATTACK_TIMELINES[attack];
  return strikeFrame(attack) + timeline.impactHoldFrames + timeline.recoveryFrames;
}

/** The first attack frame of the recovery (punish) window. */
export function recoveryStartFrame(attack: SpiderAttack): number {
  return strikeFrame(attack) + SPIDER_ATTACK_TIMELINES[attack].impactHoldFrames;
}

/** Which stage an attack frame falls in, and how far through that stage it is (0 at its first frame). */
export interface SpiderAttackStageAt {
  readonly stage: SpiderAttackStage;
  readonly stageProgress: number;
}

function progressThrough(frame: number, start: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(1, Math.max(0, (frame - start) / length));
}

/**
 * The stage an attack frame belongs to. Frames past the end of the attack
 * report the end of recovery rather than throwing, so a renderer that samples
 * one tick late still draws a sensible pose.
 */
export function attackStageAt(attack: SpiderAttack, frame: number): SpiderAttackStageAt {
  const timeline = SPIDER_ATTACK_TIMELINES[attack];
  const lockStart = timeline.tellFrames;
  const strike = strikeFrame(attack);
  const recoveryStart = recoveryStartFrame(attack);
  if (frame < lockStart) {
    return { stage: 'tell', stageProgress: progressThrough(frame, 0, timeline.tellFrames) };
  }
  if (frame < strike) {
    return { stage: 'lock', stageProgress: progressThrough(frame, lockStart, timeline.lockFrames) };
  }
  if (frame < recoveryStart) {
    return {
      stage: 'strike',
      stageProgress: progressThrough(frame, strike, timeline.impactHoldFrames),
    };
  }
  return {
    stage: 'recovery',
    stageProgress: progressThrough(frame, recoveryStart, timeline.recoveryFrames),
  };
}

/** How many frames before the strike the audible impact sits in its sound file. */
function audioLeadFrames(audioImpactSeconds: number): number {
  return Math.round(audioImpactSeconds * SPIDER_FRAMES_PER_SECOND);
}

/**
 * The attack frame the impact sound should start on so its audible hit lands
 * on the strike tick, or null for an attack with no timed cue. Clamped at 0;
 * whatever part of the lead does not fit before the strike is skipped by
 * {@link audioSeekSeconds} instead.
 */
export function audioStartFrame(attack: SpiderAttack): number | null {
  const { audioImpactSeconds } = SPIDER_ATTACK_TIMELINES[attack];
  if (audioImpactSeconds === null) return null;
  return Math.max(0, strikeFrame(attack) - audioLeadFrames(audioImpactSeconds));
}

/**
 * Seconds to seek into the impact sound when it starts. Zero unless the sound's
 * lead-in is longer than the whole run-up to the strike, in which case the part
 * that does not fit is skipped so the hit still lands on the strike tick.
 */
export function audioSeekSeconds(attack: SpiderAttack): number {
  const { audioImpactSeconds } = SPIDER_ATTACK_TIMELINES[attack];
  if (audioImpactSeconds === null) return 0;
  return Math.max(0, audioImpactSeconds - strikeFrame(attack) / SPIDER_FRAMES_PER_SECOND);
}

/**
 * The `lay` attack frames an egg drops on, first egg first. A clutch of N drops
 * on the first N; the last lands inside the drop window so the lay's own
 * recovery starts after every egg is down.
 */
export const LAY_EGG_FRAMES: readonly number[] = Array.from(
  { length: MAX_EGG_CLUTCH_SIZE },
  (_, eggIndex) => strikeFrame('lay') + eggIndex * LAY_EGG_INTERVAL_FRAMES,
);

// ── Phase-transition roar ───────────────────────────────────────────────────

/**
 * Frames from the start of the phase-change roar to its (harmless) burst.
 * Matched to the audible peak of the screech file the roar plays, so the ring
 * bursts on the sound.
 */
export const PHASE_ROAR_BUILD_FRAMES = audioLeadFrames(SCREECH_AUDIO_IMPACT_SECONDS);

/** Frames she stands spent after the roar; a punish window like any attack's recovery. */
export const PHASE_ROAR_PAUSE_FRAMES = 50;

/** Total frames of the phase-change roar, build plus pause. */
export const PHASE_ROAR_TOTAL_FRAMES = PHASE_ROAR_BUILD_FRAMES + PHASE_ROAR_PAUSE_FRAMES;

// ── Hit geometry ────────────────────────────────────────────────────────────

/** Screech burst radius in tiles, from her centre to the player's centre. */
export const SCREECH_RADIUS_TILES = 3;
/** Screech burst radius in world pixels. */
export const SCREECH_RADIUS_PX = TILE_SIZE * SCREECH_RADIUS_TILES;

/** Slam cone reach in tiles, from her centre to the player's centre. */
export const SLAM_CONE_RADIUS_TILES = 2.2;
/** Slam cone reach in world pixels. */
export const SLAM_CONE_RADIUS_PX = TILE_SIZE * SLAM_CONE_RADIUS_TILES;
/** The slam cone spans 120°: 60° either side of her locked facing. */
const SLAM_CONE_HALF_ANGLE_DEGREES = 60;
const DEGREES_PER_HALF_TURN = 180;
export const SLAM_CONE_HALF_ANGLE_RAD =
  (SLAM_CONE_HALF_ANGLE_DEGREES / DEGREES_PER_HALF_TURN) * Math.PI;

/** The shape one slam struck, in world pixels, emitted on its strike tick. */
export interface SlamImpact {
  /** Her centre on the strike tick. */
  readonly originX: number;
  readonly originY: number;
  /** Unit vector of her locked facing. */
  readonly dirX: number;
  readonly dirY: number;
  readonly radiusPx: number;
  readonly halfAngleRad: number;
}

/**
 * Whether a world point is inside a slam's cone. A point exactly on her centre
 * counts as inside: anything standing under her is under the legs too.
 */
export function isInsideSlamCone(impact: SlamImpact, x: number, y: number): boolean {
  const dx = x - impact.originX;
  const dy = y - impact.originY;
  const distance = Math.hypot(dx, dy);
  if (distance > impact.radiusPx) return false;
  if (distance === 0) return true;
  const alignment = (dx / distance) * impact.dirX + (dy / distance) * impact.dirY;
  return alignment >= Math.cos(impact.halfAngleRad);
}

/** Whether a world point is inside a screech burst centred on (originX, originY). */
export function isInsideScreech(originX: number, originY: number, x: number, y: number): boolean {
  return Math.hypot(x - originX, y - originY) <= SCREECH_RADIUS_PX;
}

/**
 * One strike-tick event for screen feedback (shake, decals, flash). Emitted on
 * the tick the damage is computed, and meant to live for that attack's
 * `impactHoldFrames`.
 */
export interface SpiderImpactEvent {
  readonly attack: Exclude<SpiderAttack, 'lay'>;
  /** Her centre on the strike tick, in world pixels. */
  readonly originX: number;
  readonly originY: number;
  /** Unit vector of the locked aim (slam facing, spit direction; her facing for a screech). */
  readonly dirX: number;
  readonly dirY: number;
}
