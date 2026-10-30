import type { PartyTransferRequest } from './partySplit/partyTransfer';

/**
 * Where an interior's way out leads: its own door to the street, or onward
 * through the floor's one transfer, which can set the party down straight in
 * another interior with no street shown between them.
 */
export type InteriorExitDestination =
  { readonly kind: 'door' } | { readonly kind: 'onward'; readonly request: PartyTransferRequest };

export const OUT_THROUGH_THE_DOOR: InteriorExitDestination = { kind: 'door' };
