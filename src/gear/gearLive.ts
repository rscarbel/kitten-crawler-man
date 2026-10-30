/**
 * What a crawler's gear is doing this moment, as opposed to what it remembers
 * (`GearItemState`): combo counts, an armed riposte, how long she has stood
 * still, a vanish or slowed world still running. None of it is saved, so a
 * reload or a checkpoint rewind starts every one of these fresh.
 *
 * Every window here is counted in gear ticks, which `GearSystem` runs once a
 * frame of play: a window holds still while the world is halted under a menu
 * or a dialog, and runs out in play however it was opened.
 */

import type { Rarity } from '../core/items/defs/rarity';
import type { ClawTrail } from '../core/items/equipment/weapons';
import { ARRIVING_BOND, type PartnerBond } from './partnerBond';
import type { GearSetId } from './sets';

/**
 * A picture a trait asks for, in world pixels, queued on the wearer and drawn
 * by whichever `GearSystem` drains it. Traits never hold a renderer.
 */
export type GearFxRequest =
  | {
      readonly kind: 'chainArc';
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
    }
  | {
      readonly kind: 'shockwave';
      readonly x: number;
      readonly y: number;
      readonly radiusPx: number;
      /** Which trait threw it, since each sounds its own way. */
      readonly source: 'comboStun' | 'flinchNova';
    }
  /** The wearer survived a downing blow. */
  | { readonly kind: 'lifeSaved' }
  /** A piece of the wearer's gear awakened. */
  | { readonly kind: 'awakened' }
  /** A set completed on the wearer, in its rarest piece's colour. */
  | { readonly kind: 'setShimmer'; readonly rarity: Rarity }
  /** A relic's ward swallowed a ranged blow. */
  | { readonly kind: 'wardShatter' }
  /** A shield on the wearer's arm turned a shot loosed from (`dirX`, `dirY`), a unit direction. */
  | { readonly kind: 'bucklerBlock'; readonly dirX: number; readonly dirY: number }
  | {
      readonly kind: 'clawTrail';
      readonly trail: ClawTrail;
      readonly x: number;
      readonly y: number;
      readonly dirX: number;
      readonly dirY: number;
      readonly reachPx: number;
    }
  | {
      readonly kind: 'slashWave';
      readonly x: number;
      readonly y: number;
      readonly dirX: number;
      readonly dirY: number;
      readonly rangePx: number;
    };

/** An enemy's whole range: what a crawler nothing hushes is noticed at. */
export const FULL_NOTICE_RANGE_SHARE = 1;

/** The most requests one crawler can hold undrained, so a scene with no drainer cannot leak. */
const MAX_PENDING_FX = 32;

export class GearLiveState {
  /** Consecutive landed melee blows toward a combo, and frames left before the run lapses. */
  comboHits = 0;
  comboWindowFrames = 0;
  /** The combo trait's step count, kept so the pips over her know how many to draw. */
  comboTarget = 0;
  /** Frames a riposte stays armed after a blow landed on her; 0 when not armed. */
  riposteFrames = 0;
  /** Frames she has stood in one place. */
  stillFrames = 0;
  /** Whether a stillness regen bonus is running on her right now. */
  stillnessRegenActive = false;
  /** Where she stood last tick, to tell standing from moving. */
  lastX: number | null = null;
  lastY: number | null = null;
  /** Frames she stays hidden from enemies after a kill. */
  vanishFrames = 0;
  /**
   * The share of an enemy's usual range at which it can first notice her,
   * granted afresh each gear tick; 1 when nothing hushes her.
   */
  noticeRangeShare = FULL_NOTICE_RANGE_SHARE;
  /** Frames the world stays slowed by her last stand. */
  lastStandFrames = 0;
  /** Whether her partner piece is linked with the other crawler's this frame. */
  partnerLinked = false;
  /** Whether her link has been heard forming, so it chimes only on a real reunion. */
  partnerBond: PartnerBond = ARRIVING_BOND;
  /** The flat bonus to every stat the link lends while it holds. */
  partnerLinkStatBonus = 0;
  /** Whether her partner was down last tick, so the partner's downing shields her once. */
  partnerWasDown = false;
  /** Claw swipes counted toward the next slash wave. */
  swipeCount = 0;
  /** The sets whose top bonus she had on last tick, so a completion shimmers once. */
  completedSets = new Set<GearSetId>();
  /** False until the first look since a load or rewind has learned which sets she already had on. */
  completedSetsSeeded = false;
  /** Pictures waiting for a `GearSystem` to draw. */
  readonly fx: GearFxRequest[] = [];

  /** Queues a picture for the next `GearSystem` tick; dropped once the queue is full. */
  queueFx(request: GearFxRequest): void {
    if (this.fx.length >= MAX_PENDING_FX) return;
    this.fx.push(request);
  }

  /** Hands over every queued picture and empties the queue. */
  drainFx(): GearFxRequest[] {
    return this.fx.splice(0, this.fx.length);
  }

  /** Whether enemies have lost sight of her. */
  get vanished(): boolean {
    return this.vanishFrames > 0;
  }

  /** Back to nothing running, for a reload or a rewind. */
  reset(): void {
    this.comboHits = 0;
    this.comboWindowFrames = 0;
    this.comboTarget = 0;
    this.riposteFrames = 0;
    this.stillFrames = 0;
    this.stillnessRegenActive = false;
    this.lastX = null;
    this.lastY = null;
    this.vanishFrames = 0;
    this.lastStandFrames = 0;
    this.noticeRangeShare = FULL_NOTICE_RANGE_SHARE;
    this.partnerLinked = false;
    this.partnerBond = ARRIVING_BOND;
    this.partnerLinkStatBonus = 0;
    this.partnerWasDown = false;
    this.swipeCount = 0;
    this.completedSets = new Set();
    this.completedSetsSeeded = false;
    this.fx.length = 0;
  }
}
