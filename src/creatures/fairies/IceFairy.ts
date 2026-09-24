import { Mob } from '../Mob';
import type { Player } from '../../Player';
import { TILE_SIZE } from '../../core/constants';
import { wouldIceHitFreeze } from '../../core/frostStatus';
import {
  Fairy,
  type ActiveFairyCast,
  type FairyCast,
  type FairyCastIntent,
  type FairyPositioning,
} from './Fairy';
import type { FairyKind } from '../../sprites/art/fairyTiming';
import {
  ICE_BOLT_COOLDOWN_FRAMES,
  ICE_BOLT_COOLDOWN_MIN_FRAMES,
  ICE_BOLT_DAMAGE,
  ICE_BOLT_RANGE_TILES,
  ICE_PREFERRED_RANGE_TILES,
  ICE_SUPPORT_LEASH_TILES,
} from './fairyTuning';

/** The death screen's key for a crawler killed by an ice bolt. */
export const ICE_BOLT_ATTACK_TYPE = 'ice_bolt';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: ICE_PREFERRED_RANGE_TILES,
  supportLeashTiles: ICE_SUPPORT_LEASH_TILES,
  keepsSightOfCrawler: true,
};

/**
 * The bolt, loosed the frame it is chosen at where the crawler stands then,
 * with no lead. Its flight is the dodge window: it is slower than the crawler
 * and flies dead straight.
 */
export const ICE_BOLT_CAST: FairyCast = {
  id: 'ice_bolt',
  row: 'cast_beam',
  cooldownFrames: ICE_BOLT_COOLDOWN_FRAMES,
  minCooldownFrames: ICE_BOLT_COOLDOWN_MIN_FRAMES,
};

const ICE_CASTS: readonly FairyCast[] = [ICE_BOLT_CAST];

const NO_TARGETS: readonly Player[] = [];
const NO_BOLTS: readonly PendingIceBolt[] = [];

const TILE_CENTRE = 0.5;

/**
 * One bolt an ice fairy has loosed, handed to `FairySystem`, which owns it from
 * then on so a bolt in the air outlives the fairy that threw it. Coordinates
 * are world pixels on the ground plane.
 */
export interface PendingIceBolt {
  readonly fromX: number;
  readonly fromY: number;
  /** Unit heading, fixed at release. */
  readonly dirX: number;
  readonly dirY: number;
  /** Already level-scaled. */
  readonly damage: number;
  /** How high above the ground the bolt flies, from the fairy's hands. */
  readonly liftPx: number;
}

/** The white fairy: fires ice bolts that chill, then freeze, and a chilling burst when it dies. */
export class IceFairy extends Fairy {
  readonly kind: FairyKind = 'ice';
  protected readonly positioning = POSITIONING;
  readonly xpValue = 7;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Ice Fairy';
  description = 'A pale fairy that fires freezing bolts. Two hits in a row and you will not move.';

  /**
   * The party this frame's AI tick was handed. Held only for the length of
   * `updateAI`, because the caller reuses the array.
   */
  private party: readonly Player[] = NO_TARGETS;

  private pendingBolts: PendingIceBolt[] = [];

  override updateAI(targets: Player[]): void {
    this.party = targets;
    try {
      super.updateAI(targets);
    } finally {
      this.party = NO_TARGETS;
    }
  }

  protected override get casts(): readonly FairyCast[] {
    return ICE_CASTS;
  }

  /** Drains the bolts loosed since the last call. */
  takePendingIceBolts(): readonly PendingIceBolt[] {
    if (this.pendingBolts.length === 0) return NO_BOLTS;
    const taken = this.pendingBolts;
    this.pendingBolts = [];
    return taken;
  }

  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    if (crawler === null || !this.isCastReady(ICE_BOLT_CAST)) return null;
    const target = this.chooseTarget();
    if (target === null) return null;
    const aim = bodyCentre(target);
    return { cast: ICE_BOLT_CAST, target, aimX: aim.x, aimY: aim.y };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const from = this.groundCentre;
    const dx = cast.aimX - from.x;
    const dy = cast.aimY - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.pendingBolts.push({
      fromX: from.x,
      fromY: from.y,
      dirX: dx / distance,
      dirY: dy / distance,
      damage: this.scaledDamage(ICE_BOLT_DAMAGE),
      liftPx: this.hoverLiftPx,
    });
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.pendingBolts = [];
  }

  /**
   * The crawler to fire at: in range, in clear sight, and — given the choice —
   * one a hit would freeze, because finishing a chill into a freeze is the
   * fairy's whole play. Mongo and the mercenaries can be struck by a bolt that
   * meets them, but are never what it is aimed at.
   */
  private chooseTarget(): Player | null {
    const map = this.map;
    const origin = this.groundCentre;
    const rangePx = this.tileSize * ICE_BOLT_RANGE_TILES;
    let best: Player | null = null;
    let bestFreezes = false;
    let bestDistance = Infinity;
    for (const target of this.party) {
      if (!target.isAlive || target instanceof Mob || target.isDefendTarget === true) continue;
      if (!this.mayFight(target)) continue;
      const centre = bodyCentre(target);
      const distance = Math.hypot(centre.x - origin.x, centre.y - origin.y);
      if (distance > rangePx || distance === 0) continue;
      if (map !== null && !map.hasLineOfSight(origin.x, origin.y, centre.x, centre.y)) continue;
      const freezes = wouldIceHitFreeze(target);
      const better =
        best === null ||
        (freezes && !bestFreezes) ||
        (freezes === bestFreezes && distance < bestDistance);
      if (!better) continue;
      best = target;
      bestFreezes = freezes;
      bestDistance = distance;
    }
    return best;
  }
}

function bodyCentre(body: Player): { x: number; y: number } {
  return { x: body.x + TILE_SIZE * TILE_CENTRE, y: body.y + TILE_SIZE * TILE_CENTRE };
}
