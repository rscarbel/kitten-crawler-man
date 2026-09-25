/**
 * The shapes the village assault's siege is built from, kept apart from the
 * behaviour in `siegeCapability.ts` so that `Mob` can name them without
 * importing any of it.
 */

import type { DefenseStructures, StructureRef } from '../../systems/briarHollow/DefenseStructures';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { Mob } from '../Mob';
import type { Player } from '../../Player';

/** A tile, in tile coordinates. */
export interface SiegeTile {
  readonly x: number;
  readonly y: number;
}

/**
 * What a siege mob asks of the assault's navigation: which way is downhill
 * toward the bell from a tile, and which structure — if any — a step from that
 * tile would walk into. The assault's flow field answers both; a gate or a
 * preview can answer them with anything simpler.
 */
export interface SiegeFlowQuery {
  /**
   * The next tile toward the bell from `tile`, or null where there is none.
   * `spreadSeed` picks among equally good ways on, so a crowd spreads out;
   * the same seed on the same tile always answers the same.
   */
  nextStep(tile: SiegeTile, spreadSeed?: number): SiegeTile | null;
  /** The structure the step out of `tile` would enter, or null when it enters open ground. */
  blockingStructure(tile: SiegeTile, spreadSeed?: number): StructureRef | null;
}

/** Everything a siege mob needs to see of the village it is attacking. */
export interface SiegeWorld {
  readonly defense: DefenseStructures;
  readonly flow: SiegeFlowQuery;
  readonly site: BriarHollowSite;
  /** The scene's live mob list, for a caster that raises the fallen. */
  readonly mobs: readonly Mob[];
}

/**
 * The siege capability an assault mob carries: how hard its blows land on a
 * structure, the structure it is striking now, and the village it is in.
 */
export interface SiegeCapable {
  readonly structureDamageMultiplier: number;
  siegeTarget: StructureRef | null;
  readonly world: SiegeWorld;
  /** This mob's own tie-break among equally good steps; see {@link SiegeFlowQuery.nextStep}. */
  readonly spreadSeed: number;
}

/**
 * What an assault mob does this frame instead of its own AI, when the
 * assault has something for it to do: consulted by the mob loop before
 * `updateAI`. Answers true when it moved (or held) the mob itself, so its own
 * AI does not run this frame; false hands the frame back to that AI.
 */
export interface SiegeDirective {
  steer(mob: Mob, targets: readonly Player[]): boolean;
}
