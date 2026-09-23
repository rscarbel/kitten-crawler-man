import type { Player } from '../../Player';
import type { Rng } from '../../sprites/person/rng';
import { GUARD_COOLDOWN_FRAMES } from './blockGuard';
import {
  FLANK_REFRESH_FRAMES,
  FLANK_RELEASE_TILES,
  FLANK_STAGED_TILES,
  flankMoveToward,
  flankSlotAngle,
  flankStagingPoint,
  flankStagingTilesOf,
} from './flank';
import {
  KITE_COOLDOWN_FRAMES,
  KITE_RETRY_FRAMES,
  REGROUP_RETRY_FRAMES,
  isWoundedEnoughToRegroup,
  planKite,
  planRegroup,
  type Retreat,
  type RetreatEnd,
} from './retreat';
import {
  distanceBetween,
  type TacticalBehaviour,
  type TacticalFrame,
  type TacticalMove,
} from './tacticalFrame';
import { rollTacticsTraits, traitChance, type TacticsTrait } from './tacticsTraits';
import { noteGuardBlock, noteKiteEnd, noteKiteStart } from './tacticsTelemetry';

/**
 * One mob's learned behaviours, and the live state of any of them in progress.
 *
 * Two lifetimes live here and must not be confused. The **traits** are rolled
 * once, at spawn, and belong to the mob for good: a checkpoint restore, a
 * boss-room abort or a heal must never re-roll or strip them, or dying would
 * de-evolve the floor. The **live state** — a guard's cooldown, and anything
 * else a behaviour is partway through — describes a fight, and is cleared by
 * {@link clearLiveState} whenever the fight is called off.
 *
 * Creatures ask this object questions from their own `updateAI` rather than
 * handing it control, so each creature's own timing, animation and facing code
 * stays in charge of how a behaviour looks.
 */
export class MobTactics {
  private _traits: readonly TacticsTrait[] = [];
  private _rolled = false;
  /** Per-blow guard chance, fixed at the roll like the trait itself. */
  private guardChance = 0;
  private guardCooldownFrames = 0;
  /** True from a guard until the next unguarded hit, so guards can never chain. */
  private guardAwaitingCleanHit = false;
  /** Set by a guard on a mob with `riposte`, spent by the next {@link claimRiposte}. */
  private riposteArmed = false;
  /** The traits that steer where the mob walks, so a mob with none skips every plan. */
  private movesTactically = false;
  /** The target the movement state below was planned against. */
  private plannedAgainst: Player | null = null;
  private retreat: Retreat | null = null;
  private kiteCooldownFrames = 0;
  private regroupRetryFrames = 0;
  /** One regroup per life: set when one starts, cleared only with the fight. */
  private regroupSpent = false;
  private flankSlot: number | null = null;
  private flankRefreshFrames = 0;
  /** Walking to its staging point on the last frame. */
  private flankApproaching = false;
  /**
   * Committed to closing straight in — staged, inside the staging ring, or
   * with its slot shut — until the target gets {@link FLANK_RELEASE_TILES}
   * away. The gap between that and the staging ring is what stops a flanker
   * flipping between its slot and the direct line every time a retreating
   * player crosses the ring, and each flip throwing its route away.
   */
  private flankClosing = false;
  private _lastMove: TacticalBehaviour | null = null;
  private _lastRetreatEnd: RetreatEnd | null = null;

  /** Every trait this mob rolled, in roll order. */
  get traits(): readonly TacticsTrait[] {
    return this._traits;
  }

  get hasAnyTrait(): boolean {
    return this._traits.length > 0;
  }

  has(trait: TacticsTrait): boolean {
    return this._traits.includes(trait);
  }

  /**
   * Roll this mob's traits. Refused, with a warning, on a second call: traits
   * apply once, at spawn, the same way levels do.
   *
   * @returns whether the roll happened.
   */
  roll(
    level: number,
    eligibility: readonly TacticsTrait[],
    chanceScale: number,
    rng: Rng,
  ): boolean {
    if (this._rolled) {
      console.warn('[MobTactics] traits are already rolled; ignoring a re-roll');
      return false;
    }
    this._rolled = true;
    this._traits = rollTacticsTraits(level, eligibility, chanceScale, rng);
    this.guardChance = this.has('block') ? traitChance('block', level, chanceScale) : 0;
    this.movesTactically = this.has('flank') || this.has('kite') || this.has('regroup');
    return true;
  }

  /** The per-blow chance a guard is attempted with; zero without `block`. */
  get guardChancePerBlow(): number {
    return this.guardChance;
  }

  /** Whether the next guardable blow may be rolled against at all. */
  get isGuardReady(): boolean {
    return this.guardChance > 0 && this.guardCooldownFrames === 0 && !this.guardAwaitingCleanHit;
  }

  /**
   * Roll a guard against one blow the caller has already judged guardable.
   * On success the guard is spent until an unguarded hit lands and the
   * cooldown has run out.
   */
  tryGuard(rng: Rng = Math.random): boolean {
    if (!this.isGuardReady) return false;
    if (rng() >= this.guardChance) return false;
    this.guardCooldownFrames = GUARD_COOLDOWN_FRAMES;
    this.guardAwaitingCleanHit = true;
    this.riposteArmed = this.has('riposte');
    noteGuardBlock();
    return true;
  }

  /**
   * Whether a guard since the last call has earned this mob a riposte. Spends
   * it: the creature cuts its attack cooldown with `riposteCooldown` once.
   */
  claimRiposte(): boolean {
    if (!this.riposteArmed) return false;
    this.riposteArmed = false;
    return true;
  }

  /** Whether this mob is kiting or regrouping right now. */
  get isRetreating(): boolean {
    return this.retreat !== null;
  }

  /** The movement tactic steering this mob right now, if a retreat is. */
  get activeRetreat(): 'kite' | 'regroup' | null {
    return this.retreat?.behaviour ?? null;
  }

  /** Why the most recent retreat ended; null until one has. */
  get lastRetreatEnd(): RetreatEnd | null {
    return this._lastRetreatEnd;
  }

  /** Whether any trait this mob rolled steers where it walks; without one, {@link chooseMove} is a no-op. */
  get hasMovementTraits(): boolean {
    return this.movesTactically;
  }

  /** The movement tactic {@link chooseMove} last answered with, or null for none. */
  get lastMove(): TacticalBehaviour | null {
    return this._lastMove;
  }

  /** Whether this mob's one regroup of this life has been used. */
  get hasRegrouped(): boolean {
    return this.regroupSpent;
  }

  /**
   * Where this mob's movement tactics want it to walk this frame, or null to
   * fight exactly as it would without them.
   *
   * Call once per AI frame while the creature has a target, before it decides
   * how to chase. A move with `breaksOff` means fall back and do not swing; a
   * flank move replaces the chase goal and leaves attacking to the creature.
   * A retreat already running is carried on first, then a regroup, then a
   * kite, then a flank — falling back always outranks fanning out.
   */
  chooseMove(frame: TacticalFrame): TacticalMove | null {
    const move = this.planMove(frame);
    this._lastMove = move?.behaviour ?? null;
    return move;
  }

  private planMove(frame: TacticalFrame): TacticalMove | null {
    if (!this.movesTactically) return null;
    if (frame.target !== this.plannedAgainst) {
      this.dropMovement();
      this.plannedAgainst = frame.target;
    }

    const running = this.retreat;
    if (running !== null) {
      const step = running.advance(frame);
      if (typeof step !== 'string') return step;
      this.endRetreat(running, step);
    }

    const regroup = this.tryStartRegroup(frame);
    if (regroup !== null) return regroup;
    const kite = this.tryStartKite(frame);
    if (kite !== null) return kite;
    return this.flankMove(frame);
  }

  /** The fight has no target any more: drop what was planned against the last one. */
  disengage(): void {
    this.dropMovement();
    this.plannedAgainst = null;
  }

  private tryStartRegroup(frame: TacticalFrame): TacticalMove | null {
    if (!this.has('regroup') || this.regroupSpent || this.regroupRetryFrames > 0) return null;
    if (!isWoundedEnoughToRegroup(frame.self)) return null;
    const planned = planRegroup(frame);
    if (planned === null) {
      this.regroupRetryFrames = REGROUP_RETRY_FRAMES;
      return null;
    }
    this.regroupSpent = true;
    return this.beginRetreat(planned, frame);
  }

  private tryStartKite(frame: TacticalFrame): TacticalMove | null {
    if (!this.has('kite') || this.kiteCooldownFrames > 0) return null;
    const planned = planKite(frame);
    if (planned === null) {
      this.kiteCooldownFrames = KITE_RETRY_FRAMES;
      return null;
    }
    noteKiteStart();
    return this.beginRetreat(planned, frame);
  }

  private beginRetreat(planned: Retreat, frame: TacticalFrame): TacticalMove | null {
    this.retreat = planned;
    this.flankSlot = null;
    const step = planned.advance(frame);
    if (typeof step !== 'string') return step;
    this.endRetreat(planned, step);
    return null;
  }

  /**
   * Close a retreat. A kite, however it ended — capped, arrived, stalled or
   * turned back by a hazard — spends its whole cooldown, so no ending can be
   * followed by a fresh kite on the next frame.
   */
  private endRetreat(finished: Retreat, reason: RetreatEnd): void {
    this._lastRetreatEnd = reason;
    this.retreat = null;
    // A regroup spends the kite's cooldown too: a mob that has just fallen
    // back does not fall back again the moment it arrives, which would chain
    // two retreats into one long stretch of not fighting.
    this.kiteCooldownFrames = KITE_COOLDOWN_FRAMES;
    if (finished.behaviour === 'kite') noteKiteEnd(finished.framesElapsed);
  }

  private flankMove(frame: TacticalFrame): TacticalMove | null {
    if (!this.has('flank')) return null;
    const { self, targetPoint, tileSize } = frame;
    const toTarget = distanceBetween(self, targetPoint);
    if (this.flankClosing) {
      if (toTarget <= FLANK_RELEASE_TILES * tileSize) return null;
      this.flankClosing = false;
      this.flankSlot = null;
    }
    // Already inside the staging ring: close in directly rather than stepping
    // back out to it.
    if (toTarget <= (flankStagingTilesOf(frame) + FLANK_STAGED_TILES) * tileSize) {
      return this.commitToClosing();
    }
    if (this.flankSlot === null || this.flankRefreshFrames === 0) {
      this.flankSlot = flankSlotAngle(frame);
      this.flankRefreshFrames = FLANK_REFRESH_FRAMES;
    }
    const staging = this.flankSlot === null ? null : flankStagingPoint(frame, this.flankSlot);
    // A lone mob that was never flanking just approaches; one whose slot has
    // gone, or has shut, commits to the direct line rather than flickering
    // back to the slot the next time it reopens.
    if (staging === null) return this.flankApproaching ? this.commitToClosing() : null;
    if (distanceBetween(self, staging) <= FLANK_STAGED_TILES * tileSize) {
      return this.commitToClosing();
    }
    this.flankApproaching = true;
    return flankMoveToward(staging);
  }

  private commitToClosing(): null {
    this.flankClosing = true;
    this.flankApproaching = false;
    return null;
  }

  private dropMovement(): void {
    if (this.retreat !== null) this.endRetreat(this.retreat, 'lost');
    this.flankSlot = null;
    this.flankApproaching = false;
    this.flankClosing = false;
    this.flankRefreshFrames = 0;
    this._lastMove = null;
  }

  /** A blow got through: the streak a guard started is broken. */
  noteCleanHit(): void {
    this.guardAwaitingCleanHit = false;
  }

  /** Advance every live timer by one frame. */
  tick(): void {
    if (this.guardCooldownFrames > 0) this.guardCooldownFrames--;
    if (this.kiteCooldownFrames > 0) this.kiteCooldownFrames--;
    if (this.regroupRetryFrames > 0) this.regroupRetryFrames--;
    if (this.flankRefreshFrames > 0) this.flankRefreshFrames--;
  }

  /** Forget any behaviour in progress. Traits are untouched. */
  clearLiveState(): void {
    this.guardCooldownFrames = 0;
    this.guardAwaitingCleanHit = false;
    this.riposteArmed = false;
    this.disengage();
    this.kiteCooldownFrames = 0;
    this.regroupRetryFrames = 0;
    this.regroupSpent = false;
    this._lastRetreatEnd = null;
  }
}
