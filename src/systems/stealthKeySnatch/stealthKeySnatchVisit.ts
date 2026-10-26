import type { ItemId } from '../../core/items/defs/ItemDefs';
import type { Inventory } from '../../core/items/inventory/Inventory';
import type { StealthKeySnatchPhase } from './stealthKeySnatchCheckpoint';

/** The item the prison's pedestal holds and the gate guard takes. */
export const PRISON_KEY_ITEM: ItemId = 'quest_prison_key';

/** Both crawlers, as far as the key is concerned. */
export interface PrisonKeyHolders {
  readonly human: { readonly inventory: Inventory };
  readonly cat: { readonly inventory: Inventory };
}

/** Whether either crawler carries the prison key. */
export function partyHoldsPrisonKey(party: PrisonKeyHolders): boolean {
  return (
    party.human.inventory.countOf(PRISON_KEY_ITEM) > 0 ||
    party.cat.inventory.countOf(PRISON_KEY_ITEM) > 0
  );
}

/**
 * What the prison interior may read and change of the stealth gate's quest
 * while the party is inside. Handed to it through
 * `InteriorFloorContext.stealthKeySnatch` for the prison's door only.
 *
 * The quest stays owned by the floor's `StealthKeySnatchSystem`, which is the
 * object behind this interface; the floor re-captures it on the way out, so
 * whatever the visit changed comes back with the party.
 *
 * Taking the key is adding {@link PRISON_KEY_ITEM} to a crawler's inventory,
 * and losing it (a quest-slot eviction) is its leaving: the phase follows the
 * inventories, never the other way round. Call {@link syncWithInventories}
 * after either, so {@link phase} reads true while still inside.
 */
export interface StealthKeySnatchVisit {
  /** Where the quest stands. `opened` means nothing in the prison matters any more. */
  readonly phase: StealthKeySnatchPhase;
  /** Whether the prison's explainer has been read on this save. */
  readonly explainerSeen: boolean;
  /** Records that the explainer has been read, so later entries skip it. */
  markExplainerSeen(): void;
  /** Re-reads both crawlers' inventories, moving `briefed` ↔ `keyHeld` to match the key. */
  syncWithInventories(party: PrisonKeyHolders): void;
}
