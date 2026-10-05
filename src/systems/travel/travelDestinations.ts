/**
 * The places the Wayfinder's Anchor carries the party to, as data.
 *
 * Every destination is a region of the one overworld map `DungeonScene` runs,
 * so a trip is only ever a choice of landing tile — never a scene change. The
 * travel menu, `RecallSystem` and the reward screens all read this one table,
 * so a destination's name, its unlock rule and where it sets the party down
 * cannot drift apart between them.
 */

import { TILE_SIZE } from '../../core/constants';
import { ANCHOR_QUEST_NAME, type AnchorQuestProgress } from '../../core/AnchorQuestProgress';
import { CIRCUS_QUEST_NAME, type CircusQuestProgress } from '../../core/CircusQuestProgress';
import type { VillageQuestState } from '../../core/briarHollowState';
import { BRIAR_HOLLOW_QUEST_NAME, isVillageUnderSiege } from '../../core/villageQuestPhase';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import { drawAnchorStoneIcon } from '../../ui/icons/anchorStoneIcon';
import type { QuestRewardSection, RewardUnlockCard } from '../../ui/questReward/types';

export type TravelDestinationId = 'town' | 'circus' | 'briar_hollow';

/**
 * What the unlock rules read: a narrow view of the three questlines' saved
 * progress. Each field is the live object `DungeonScene` threads through every
 * scene, so a quest finishing is seen by the very next read. The village is
 * held by its whole state rather than by its quest record because a
 * checkpoint restore replaces `quest` outright.
 */
export interface TravelUnlockState {
  readonly circus: Pick<CircusQuestProgress, 'stage'>;
  readonly briarHollow: { readonly quest: Pick<VillageQuestState, 'phase'> };
  readonly anchor: Pick<AnchorQuestProgress, 'status'>;
}

export interface TravelDestination {
  readonly id: TravelDestinationId;
  readonly label: string;
  /** One line about the place, shown under its name in the menu. */
  readonly description: string;
  /** The questline that binds the stone here, or null for a place bound from the start. */
  readonly unlockQuestTitle: string | null;
  /** The tile the stone aims for; the warp searches outward from it for open ground. */
  landingTile(map: GameMap): TilePoint | null;
  isUnlocked(state: TravelUnlockState): boolean;
  /** Whether a world-pixel position is inside this place, for "You are here". */
  contains(map: GameMap, worldX: number, worldY: number): boolean;
  /** Why the stone will not go here right now even though it is bound, or null. */
  closedReason(state: TravelUnlockState): string | null;
  /** The toast shown once the party has landed. */
  readonly arrivalToast: string;
  /** The words over the channelling crawler's head. */
  readonly channelLabel: string;
}

/** The landing search starts on the destination tile itself: landing there is the point. */
export const TRAVEL_LANDING_STANDOFF_TILES = 0;
/** Widest ring the stone searches around a destination for somewhere to set the party down. */
export const TRAVEL_LANDING_SEARCH_TILES = 24;

export const YOU_ARE_HERE_REASON = 'You are here';
/** A destination this map does not have, such as any of them off the overworld. */
export const NOT_ON_THIS_MAP_REASON = 'The stone cannot find that place.';
const VILLAGE_UNDER_SIEGE_REASON = 'The village is under siege';
/** Never shown while every place with no questline is bound from the start; a guard for one that is not. */
const NOT_BOUND_REASON = 'The stone is not bound here';

const TOWN: TravelDestination = {
  id: 'town',
  label: 'Skyfowl Town',
  description: 'The town square, by the fountain. The stone’s first home.',
  unlockQuestTitle: null,
  landingTile: (map) => map.townSquareCentre ?? null,
  isUnlocked: () => true,
  contains: (map, worldX, worldY) => map.isInTownSafeZone(worldX, worldY),
  closedReason: () => null,
  arrivalToast: 'The stone sets you down in the town square.',
  channelLabel: 'Travelling to Skyfowl Town…',
};

/**
 * The entry arch the stone lands at stands on the rim of the grounds' radius,
 * up to a tile past it, and the party is set down around it: this much apron
 * keeps a party at the arch counted as at the circus.
 */
const CIRCUS_ARCH_APRON_TILES = 3;

const CIRCUS: TravelDestination = {
  id: 'circus',
  label: 'Circus',
  description: 'The entry arch of the old circus grounds, under the Big Top.',
  unlockQuestTitle: CIRCUS_QUEST_NAME,
  landingTile: (map) => map.circusGrounds?.arch?.crossing ?? map.circusCentre ?? null,
  isUnlocked: (state) => state.circus.stage === 'complete',
  contains: (map, worldX, worldY) => map.isInCircusGrounds(worldX, worldY, CIRCUS_ARCH_APRON_TILES),
  closedReason: () => null,
  arrivalToast: 'The stone sets you down at the circus arch.',
  channelLabel: 'Travelling to the Circus…',
};

const BRIAR_HOLLOW: TravelDestination = {
  id: 'briar_hollow',
  label: 'Briar Hollow',
  description: 'Just inside the ratkin village’s south gate.',
  unlockQuestTitle: BRIAR_HOLLOW_QUEST_NAME,
  landingTile: (map) => map.briarHollow?.gate.inside ?? null,
  isUnlocked: (state) => state.briarHollow.quest.phase === 'complete',
  contains: (map, worldX, worldY) => map.isInBriarHollow(worldX, worldY),
  closedReason: (state) =>
    isVillageUnderSiege(state.briarHollow.quest.phase) ? VILLAGE_UNDER_SIEGE_REASON : null,
  arrivalToast: 'The stone sets you down inside Briar Hollow’s gate.',
  channelLabel: 'Travelling to Briar Hollow…',
};

/** Every destination, in the order the travel menu lists them. */
export const TRAVEL_DESTINATIONS: readonly TravelDestination[] = [TOWN, CIRCUS, BRIAR_HOLLOW];

export function travelDestination(id: TravelDestinationId): TravelDestination {
  switch (id) {
    case 'town':
      return TOWN;
    case 'circus':
      return CIRCUS;
    case 'briar_hollow':
      return BRIAR_HOLLOW;
  }
}

/** The locked reason a row shows: the questline that would bind the stone there. */
export function lockedReason(destination: TravelDestination): string {
  const title = destination.unlockQuestTitle;
  return title === null ? NOT_BOUND_REASON : `Complete "${title}"`;
}

const TILE_CENTRE_FRACTION = 0.5;

/**
 * Why the stone will not take the party to `destination` from where the
 * caster stands, or null when it will. One answer for the menu row and for
 * `RecallSystem`, so a row drawn enabled can never be refused on press.
 */
export function travelRefusal(
  destination: TravelDestination,
  state: TravelUnlockState,
  map: GameMap,
  caster: { readonly x: number; readonly y: number },
): string | null {
  if (!destination.isUnlocked(state)) return lockedReason(destination);
  if (destination.landingTile(map) === null) return NOT_ON_THIS_MAP_REASON;
  const casterCentreX = caster.x + TILE_SIZE * TILE_CENTRE_FRACTION;
  const casterCentreY = caster.y + TILE_SIZE * TILE_CENTRE_FRACTION;
  if (destination.contains(map, casterCentreX, casterCentreY)) return YOU_ARE_HERE_REASON;
  return destination.closedReason(state);
}

const UNLOCK_CARD_TITLE_PREFIX = 'Anchor travel: ';
const UNLOCK_CARD_BODY = "The Wayfinder's Anchor can now carry the party here.";
const UNLOCKS_HEADING = 'NEW DESTINATIONS';

/**
 * The reward screen's card for a destination the stone is bound to. Until
 * the stone itself has been earned the card says so, because the unlock is
 * real but cannot be used yet.
 */
export function travelUnlockCard(
  destinationId: TravelDestinationId,
  state: Pick<TravelUnlockState, 'anchor'>,
): RewardUnlockCard {
  const destination = travelDestination(destinationId);
  const card: RewardUnlockCard = {
    renderIcon: (ctx, rect) => drawAnchorStoneIcon(ctx, rect),
    title: `${UNLOCK_CARD_TITLE_PREFIX}${destination.label}`,
    body: [{ text: UNLOCK_CARD_BODY, emphasis: true }, { text: destination.description }],
  };
  if (state.anchor.status === 'completed') return card;
  return { ...card, condition: `(after completing "${ANCHOR_QUEST_NAME}")` };
}

/** An `unlocks` section of travel cards, for a quest-complete screen. */
export function travelUnlocksSection(
  destinationIds: readonly TravelDestinationId[],
  state: Pick<TravelUnlockState, 'anchor'>,
): QuestRewardSection {
  return {
    kind: 'unlocks',
    heading: UNLOCKS_HEADING,
    cards: destinationIds.map((id) => travelUnlockCard(id, state)),
  };
}

/** Every destination the stone is bound to right now, in menu order. */
export function unlockedDestinationIds(state: TravelUnlockState): TravelDestinationId[] {
  return TRAVEL_DESTINATIONS.filter((destination) => destination.isUnlocked(state)).map(
    (destination) => destination.id,
  );
}
