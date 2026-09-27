/**
 * Role interfaces: what every speaker of a kind must be able to say. Adding a
 * member here means every script that `satisfies` the interface is missing a
 * property until it's written — the compiler lists every site that needs it,
 * rather than a runtime lookup returning `undefined` in silence.
 *
 * A member is optional only where its absence is a designed behaviour (a
 * villager with no after-victory line, because the ladder skips that rung for
 * them) — a caller generic over the role must then handle `undefined`.
 */

import type { BarkLine, DialogLine, NonEmpty, Paragraphs } from './line';
import type { TownDialogContext } from '../systems/townDialog';

/**
 * Lines every named Briar Hollow villager has, or may have. `attackStarted`
 * and `enemyBreach` are here rather than on `SoldierLines` because the siege
 * ladder's opening resolver reads them for any villager, named soldier or
 * not — today only the Mayor calls the breach of the outer defenses, and only
 * Hobb and Marta call an inner one.
 */
export interface VillagerLines {
  /** The hover tooltip's body for this villager, in the village's own voice — not a line spoken aloud. */
  readonly backstory: string;
  readonly firstMeeting: DialogLine;
  readonly attackImminent?: BarkLine;
  readonly attackStarted?: BarkLine;
  readonly enemyBreach?: BarkLine;
  readonly afterVictory?: BarkLine;
  readonly questActive?: DialogLine;
  readonly fallbackQuestions?: NonEmpty<DialogLine>;
}

/**
 * The four militia additionally take orders and, standing, call out what they
 * see. `stayActive`, `patrolActive` and `enemySpotted` are optional: the
 * opening ladder falls back to the plain order-acknowledgement line for a
 * soldier who has none of their own, and only Sedge calls out a sighting.
 */
export interface SoldierLines extends VillagerLines {
  readonly ordersNeedMayor: DialogLine;
  readonly commandFollow: DialogLine;
  readonly commandStay: DialogLine;
  readonly commandPatrol: DialogLine;
  readonly followActive: BarkLine;
  readonly patrolReturn: BarkLine;
  readonly stayActive?: BarkLine;
  readonly patrolActive?: BarkLine;
  readonly enemySpotted?: BarkLine;
}

/**
 * Anyone who sells something needs at least a header bark for when their
 * menu opens. `cannotAfford` is optional: Vetch's trading post refuses a sale
 * with the stock's own "Sold out" label instead of a line of his own.
 */
export interface ShopkeeperLines extends VillagerLines {
  readonly shopOpen: BarkLine;
  readonly cannotAfford?: BarkLine;
}

/**
 * The bark a hired mercenary may have for each moment its contract lets it
 * speak. Every member is optional: which moments a hire has anything to say
 * for — Tumbledown has none of these, only stage directions and grunts — is a
 * character choice, not an omission to fix.
 */
export interface MercenaryLines {
  readonly hired?: NonEmpty<BarkLine>;
  readonly idle?: NonEmpty<BarkLine>;
  readonly engage?: NonEmpty<BarkLine>;
  readonly kill?: NonEmpty<BarkLine>;
  readonly lowHp?: NonEmpty<BarkLine>;
  readonly special?: NonEmpty<BarkLine>;
  readonly ownerHurt?: NonEmpty<BarkLine>;
  readonly catHurt?: NonEmpty<BarkLine>;
  readonly downed?: NonEmpty<BarkLine>;
  readonly revived?: NonEmpty<BarkLine>;
  readonly potion?: NonEmpty<BarkLine>;
  readonly death?: NonEmpty<BarkLine>;
  readonly talk?: NonEmpty<BarkLine>;
  readonly floorEnd?: NonEmpty<BarkLine>;
}

/**
 * The words a named building resident has, as opposed to the generic role
 * they anchor: everyday chatter in their own voice, a multi-page life story
 * told one entry per talk, and a quest-gated pool for when their corner of
 * town is not business as usual. `reactive` is `null`, not omitted, for a
 * resident with no state-gated line of their own.
 */
export interface ResidentLines {
  readonly ambient: NonEmpty<string>;
  readonly lore: ReadonlyArray<Paragraphs>;
  readonly reactive: ((ctx: TownDialogContext) => NonEmpty<string> | null) | null;
}
