/**
 * The contract between a creature that throws globs and
 * `GlobProjectileSystem`, which flies them, lands them and keeps their
 * puddles. Kept apart from the system so `Mob` can name the outbox without
 * importing the system's painters.
 */

import type { Player } from '../Player';

/** Every glob kind, in the order tools list them. */
export const ALL_GLOB_KINDS = ['fireball', 'acid'] as const;

/** What a glob is made of, which decides how it looks, sounds and hurts. */
export type GlobKind = (typeof ALL_GLOB_KINDS)[number];

/** One shot, as the thrower hands it over. */
export interface GlobShot {
  readonly kind: GlobKind;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** Damage the glob deals on a direct hit, already scaled for the thrower's level. */
  readonly damage: number;
  /** Class name of the thrower, so the death screen can name it. */
  readonly mobType: string;
  /**
   * The thrower's level, which sets how fast the glob flies.
   *
   * Carried rather than resolved by the system: the shot outlives its thrower
   * by design, so by the time this is read the creature may not exist.
   */
  readonly mobLevel: number;
  /**
   * Whoever the thrower was aiming at, when that is not one of the two players.
   *
   * Mobs can be made hostile to each other, and a thrower will happily lock
   * onto and wind up at such a target. Without carrying it here the system
   * has no way to know it exists, and the glob flies straight through the
   * thing it was aimed at.
   */
  readonly aimedAt: Player | null;
}

/**
 * The outbox a glob thrower offers through `Mob.globShooter`.
 *
 * The thrower never owns a glob in flight: a mob stops being updated and drawn
 * the instant it dies, and a projectile stored on it would vanish in mid-air.
 */
export interface GlobShooter {
  /**
   * Every shot fired since the last call, emptied by the call. Returned
   * wholesale because the system drains the dead as well as the living, and a
   * pull-one-per-frame interface would strand the rest of a dead thrower's
   * queue.
   */
  takePendingGlobs(): readonly GlobShot[];
}

/** Shared empty result so a thrower's common no-shots-this-frame path allocates nothing. */
export const NO_GLOB_SHOTS: readonly GlobShot[] = [];
