/**
 * The pieces of a run's world that travel with the party from floor to floor,
 * and into a new game: a hire on a carried contract, and the Wayfinder's
 * Anchor's repair.
 *
 * Both live in the floor's world state (the mercenary roster and the anchor
 * quest's progress), which a floor change drops and a save written as the party
 * changes floors leaves out. So every save also writes this bundle, built from
 * the live world, and a scene built without a world rebuilds those two pieces
 * from it.
 */

import { isRecord } from '../util/guards';
import {
  carriedHire,
  copyHire,
  type HiredMercenary,
  type MercenaryRoster,
} from '../party/MercenaryRoster';
import {
  createAnchorQuestProgress,
  repairedAnchorQuestProgress,
  type AnchorQuestProgress,
} from '../quests/AnchorQuestProgress';
import { parseHiredMercenary } from './PersistedWorldState';

export interface NewGameCarry {
  /** The hire walking with the party on a carried contract, or null. */
  readonly hire: HiredMercenary | null;
  /** Whether the Wayfinder's Anchor has been repaired, which a new game keeps along with the anchor. */
  readonly anchorRepaired: boolean;
}

/** A run that carries nothing: no carried hire, and an anchor still in pieces. */
export const NOTHING_CARRIED: NewGameCarry = { hire: null, anchorRepaired: false };

type CarrySources = {
  readonly roster: Pick<MercenaryRoster, 'active'>;
  readonly anchor: Pick<AnchorQuestProgress, 'status'>;
};

/**
 * What the run carries across its next floor change, read from the live
 * world: only a hire already on a carried contract travels, since a desk hire
 * ends with its floor.
 */
export function runCarryOf({ roster, anchor }: CarrySources): NewGameCarry {
  const active = roster.active;
  const travels = active !== null && active.contract.kind === 'carried';
  return {
    hire: travels ? copyHire(active) : null,
    anchorRepaired: anchor.status === 'completed',
  };
}

/**
 * What a new game takes over from the world of the run it replaces: whoever
 * is hired, on a carried contract whatever their terms were, and the anchor's
 * repair.
 */
export function newGameCarryOf({ roster, anchor }: CarrySources): NewGameCarry {
  const active = roster.active;
  return {
    hire: active === null ? null : carriedHire(active),
    anchorRepaired: anchor.status === 'completed',
  };
}

/** The roster a scene built without a world starts from: empty but for the carried hire. */
export function rosterCarrying(carry: NewGameCarry): MercenaryRoster {
  return {
    active: copyHire(carry.hire),
    lastDeceased: null,
    towerLoanSigned: false,
    floorLevelId: null,
  };
}

/**
 * The anchor quest's progress a scene built without a world starts from. A
 * repaired anchor's quest is already finished, so Madame Voss never offers
 * the shards again and none are ever stocked or handed out.
 */
export function anchorProgressCarrying(carry: NewGameCarry): AnchorQuestProgress {
  return carry.anchorRepaired ? repairedAnchorQuestProgress() : createAnchorQuestProgress();
}

/** A stored bundle, or undefined when it is not one this build writes. */
export function parseNewGameCarry(value: unknown): NewGameCarry | undefined {
  if (!isRecord(value)) return undefined;
  const { hire, anchorRepaired } = value;
  if (typeof anchorRepaired !== 'boolean') return undefined;
  if (hire === null) return { hire: null, anchorRepaired };
  const parsed = parseHiredMercenary(hire);
  if (parsed?.contract.kind !== 'carried') return undefined;
  return { hire: parsed, anchorRepaired };
}
