/**
 * Whether a partner piece's link has been heard forming, as opposed to whether
 * it holds this very tick (`GearLiveState.partnerLinked`). The link chimes only
 * when it forms from `parted`: a crawler's live gear state is built fresh in
 * every scene and on every load, and the party can land a beat apart after a
 * door or a warp, so neither a fresh state nor a momentary gap may count as
 * the pair finding each other again.
 */
export type PartnerBond =
  /**
   * Fresh since a scene, a load or a rewind: a link found before it settles is
   * one the pair already had. `seenApart` once a tick has passed without the
   * link, so a snapshot taken before the first tick does not call a linked
   * pair apart.
   */
  | { readonly kind: 'arriving'; readonly framesLeft: number; readonly seenApart: boolean }
  | { readonly kind: 'bonded' }
  /** The link lapsed; it is only lost once the pair stay out of reach past the grace. */
  | { readonly kind: 'parting'; readonly framesLeft: number }
  | { readonly kind: 'parted' };

/** Long enough for a companion who steps through a door or a warp after the player to land beside her. */
const ARRIVAL_SETTLE_FRAMES = 120;
/** A pair brushing the edge of the range, or a frame of a partner being moved, is not a parting. */
const PARTING_GRACE_FRAMES = 60;

export const ARRIVING_BOND: PartnerBond = {
  kind: 'arriving',
  framesLeft: ARRIVAL_SETTLE_FRAMES,
  seenApart: false,
};

/**
 * Whether the pair were apart as a crawler leaves a scene, carried in her
 * snapshot so a split party regrouping through a door is still heard finding
 * each other. A fresh scene's tick without the link counts as apart: a partner
 * away in another group never links.
 */
export function apartAtHandOff(bond: PartnerBond, linkedNow: boolean): boolean {
  if (linkedNow) return false;
  switch (bond.kind) {
    case 'parted':
      return true;
    case 'arriving':
      return bond.seenApart;
    case 'bonded':
    case 'parting':
      return false;
    default: {
      const unhandled: never = bond;
      return unhandled;
    }
  }
}

/** The bond a crawler rebuilt in a new scene starts from, given whether the pair were apart before it. */
export function bondAfterHandOff(apart: boolean): PartnerBond {
  return apart ? { kind: 'parted' } : ARRIVING_BOND;
}

/** The bond after a tick in which the link did or did not hold, and whether that tick is the one it formed on. */
export function advancePartnerBond(
  bond: PartnerBond,
  linked: boolean,
  dtFrames: number,
): { readonly bond: PartnerBond; readonly formed: boolean } {
  const bonded: PartnerBond = { kind: 'bonded' };
  switch (bond.kind) {
    case 'arriving': {
      if (linked) return { bond: bonded, formed: false };
      const framesLeft = bond.framesLeft - dtFrames;
      const settled = framesLeft <= 0;
      const stillArriving: PartnerBond = { kind: 'arriving', framesLeft, seenApart: true };
      return { bond: settled ? { kind: 'parted' } : stillArriving, formed: false };
    }
    case 'bonded':
      return {
        bond: linked ? bond : { kind: 'parting', framesLeft: PARTING_GRACE_FRAMES },
        formed: false,
      };
    case 'parting': {
      if (linked) return { bond: bonded, formed: false };
      const framesLeft = bond.framesLeft - dtFrames;
      const lost = framesLeft <= 0;
      return { bond: lost ? { kind: 'parted' } : { kind: 'parting', framesLeft }, formed: false };
    }
    case 'parted':
      return linked ? { bond: bonded, formed: true } : { bond, formed: false };
    default: {
      const unhandled: never = bond;
      return unhandled;
    }
  }
}
