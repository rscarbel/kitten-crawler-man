/**
 * What the glyph and the column of light over a quest NPC say about their quest.
 *
 * Every person (or animal) the party talks to for a quest wears exactly one of
 * these, worked out from the quest's own state each frame:
 *
 * - `'available'`: a gold beacon and `!`. The quest is on offer and the party
 *   has not started it.
 * - `'inProgress'`: a green beacon and `?`. The party is partway through this
 *   NPC's quest and talking to them moves it on.
 * - `'turnIn'`: a green beacon, `?` and a present beside it. Talking to them
 *   now pays a reward or unlocks something.
 * - `'none'`: nothing to say.
 *
 * Dave is no quest giver, so he wears an {@link NpcMarker}, which adds
 * `'news'`: the gold `!` of a story beat or tactics, which never quiets, since
 * what he has to say is usually about the quest in hand.
 *
 * While the party is on any quest, an `'available'` beacon burns at
 * {@link AVAILABLE_BEACON_STRENGTH_WHILE_ON_A_QUEST} of its strength, so the
 * offers of quests not yet started stay findable without competing with the
 * quest in hand.
 *
 * Objects (a notice board, a terminal, a crystal to deal with) are not NPCs and
 * wear the plain `!`/`?` of `ObjectQuestMarker` in `questNPCSprite.ts`.
 */

import type { QuestMarkerType } from '../systems/MiniMapSystem';
import { renderFrameNumber } from '../core/rendering/renderFrameClock';
import { worldPalette } from '../ui/theme/worldInk';
import type { QuestMarkerGlyph } from './questNPCSprite';

/** What a quest NPC has for the party; see the module doc for what each one looks like. */
export type NpcQuestMarker = 'available' | 'inProgress' | 'turnIn' | 'none';

/** What any person wears overhead: a quest marker, or Dave's news. */
export type NpcMarker = NpcQuestMarker | 'news';

/** A marker that paints something. */
export type ShownNpcMarker = Exclude<NpcMarker, 'none'>;

interface NpcMarkerLook {
  readonly glyph: QuestMarkerGlyph;
  readonly color: string;
  /** A present beside the glyph: talking now pays out. */
  readonly withPresent: boolean;
  /** The beacon quiets while the party is busy with a quest, since this one has not been started. */
  readonly quietsWhileOnAQuest: boolean;
  readonly minimap: Extract<QuestMarkerType, 'exclamation' | 'question'>;
}

const NPC_MARKER_LOOKS = {
  available: {
    glyph: '!',
    color: worldPalette.questMarker.offer,
    withPresent: false,
    quietsWhileOnAQuest: true,
    minimap: 'exclamation',
  },
  inProgress: {
    glyph: '?',
    color: worldPalette.questMarker.underway,
    withPresent: false,
    quietsWhileOnAQuest: false,
    minimap: 'question',
  },
  turnIn: {
    glyph: '?',
    color: worldPalette.questMarker.underway,
    withPresent: true,
    quietsWhileOnAQuest: false,
    minimap: 'question',
  },
  news: {
    glyph: '!',
    color: worldPalette.questMarker.offer,
    withPresent: false,
    quietsWhileOnAQuest: false,
    minimap: 'exclamation',
  },
} as const satisfies Record<ShownNpcMarker, NpcMarkerLook>;

/** How each shown marker is painted. */
export function npcMarkerLook(marker: ShownNpcMarker): NpcMarkerLook {
  return NPC_MARKER_LOOKS[marker];
}

/** Whether `marker` paints anything, narrowing it to one that does. */
export function npcMarkerShows<M extends NpcMarker>(marker: M): marker is Exclude<M, 'none'> {
  return marker !== 'none';
}

/** The minimap glyph for an NPC wearing `marker`. */
export function minimapMarkerFor(
  marker: ShownNpcMarker,
): Extract<QuestMarkerType, 'exclamation' | 'question'> {
  return NPC_MARKER_LOOKS[marker].minimap;
}

/**
 * The share of its strength an `'available'` beacon keeps while the party is
 * on a quest: a third, enough to be found by a player who looks for it.
 */
const AVAILABLE_BEACON_STRENGTH_WHILE_ON_A_QUEST = 1 / 3;

/**
 * The render frame the gameplay scene last said a quest was under way in.
 *
 * Stamped with the frame rather than held as a flag: the creatures that draw
 * a beacon have no reference to the quest list, and a flag left set by a scene
 * since left would quiet the offers of whatever scene is drawn next. Only the
 * frame it was set in counts, so a scene that never sets it reads "no quest".
 */
let partyOnAQuestFrame: number | null = null;

/** Call once per rendered frame, before anything draws a beacon, with whether any quest is active. */
export function setPartyOnAQuest(onAQuest: boolean): void {
  partyOnAQuestFrame = onAQuest ? renderFrameNumber() : null;
}

/** The share of full strength the beacon over an NPC wearing `marker` burns at this frame. */
export function npcMarkerBeaconStrength(marker: ShownNpcMarker): number {
  const onAQuest = partyOnAQuestFrame === renderFrameNumber();
  const quiet = onAQuest && NPC_MARKER_LOOKS[marker].quietsWhileOnAQuest;
  return quiet ? AVAILABLE_BEACON_STRENGTH_WHILE_ON_A_QUEST : 1;
}
