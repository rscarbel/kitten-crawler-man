/**
 * The pages of every "Borrowed Blueprints" conversation, assembled in order
 * from the speakers' own scripts (`fenna.ts`, `merrit.ts`,
 * `wendellBlueprints.ts`). Pure: each builder takes what varies — which
 * crawler is talking, whether the Plea is won, which way the town lies — and
 * returns the lines; the systems that open the conversations decide when.
 *
 * Kept apart from the systems so the scene order is written once, and so the
 * dialog gate can read the order without standing up a scene.
 */

import { playerCharacter, type PlayerSpeakerId } from '../../../characters/characters';
import type { DialogLine, NonEmpty } from '../../../dialog/line';
import { FENNA, MERRIT, MERRIT_BLUEPRINTS_REPLIES } from '../../../dialog/scripts/briarHollow';
import {
  WENDELL,
  WENDELL_BLUEPRINTS_ASIDES,
  WENDELL_BLUEPRINTS_REPLIES,
} from '../../../dialog/scripts/wendellBlueprints';
import { cardinalDirection } from '../../../utils';

/** Which crawler's voice a line takes: the one the player is controlling. */
export type SpeakingCrawler = PlayerSpeakerId;

/**
 * The line in `active`'s voice. Both crawlers' versions are named at every
 * call site, rather than looked up by key, so the dialog gate sees each one read.
 */
function inVoiceOf(
  active: SpeakingCrawler,
  humanVersion: DialogLine,
  catVersion: DialogLine,
): DialogLine {
  return active === playerCharacter('human').speakerId ? humanVersion : catVersion;
}

/** The voice of whichever crawler the player controls: the human's when the human is active. */
export function speakingCrawler(humanIsActive: boolean): SpeakingCrawler {
  return playerCharacter(humanIsActive ? 'human' : 'cat').speakerId;
}

// ── Fenna ────────────────────────────────────────────────────────────────

/** Fenna's accept button on the offer. */
export const FENNA_OFFER_ACCEPT_LABEL = "We'll help";
/** Fenna's decline button on the offer. */
export const FENNA_OFFER_DECLINE_LABEL = 'Not right now';
/** The topic on Fenna that replays the offer after a decline. */
export const FENNA_REOFFER_TOPIC_LABEL = 'About those work stations';

/** What Fenna's line says when the town's bearing cannot be worked out. */
const TOWN_WHEREABOUTS_FALLBACK = 'Taloncrest, past the road';

/**
 * Where Fenna says Taloncrest is, finishing "He lives at Plumbline
 * Farm, in …": the town by name, then its bearing from the village,
 * lower-cased ("Taloncrest, north west of here"), or a plain "past the road"
 * when either end is unknown.
 */
export function taloncrestWhereabouts(
  villageCentre: { readonly x: number; readonly y: number } | null,
  townCentre: { readonly x: number; readonly y: number } | null,
): string {
  if (villageCentre === null || townCentre === null) return TOWN_WHEREABOUTS_FALLBACK;
  const direction = cardinalDirection(villageCentre, townCentre).toLowerCase();
  return `Taloncrest, ${direction} of here`;
}

/** The offer: ends on the {@link FENNA_OFFER_ACCEPT_LABEL} / {@link FENNA_OFFER_DECLINE_LABEL} row. */
export function fennaOfferPages(): NonEmpty<DialogLine> {
  return [FENNA.blueprintsOffer];
}

/** Fenna's answer to "We'll help", sending the party to Wendell. */
export function fennaAcceptedPages(townWhereabouts: string): NonEmpty<DialogLine> {
  return [FENNA.blueprintsAccepted({ townWhereabouts })];
}

/** Fenna's answer to "Not right now". */
export function fennaDeclinedPages(): NonEmpty<DialogLine> {
  return [FENNA.blueprintsDeclined];
}

/** Fenna's opening at every step while the quest is under way. */
export function fennaInProgressPages(): NonEmpty<DialogLine> {
  return [FENNA.blueprintsInProgress];
}

/** Fenna's briefing when the party first brings her the blueprints; each cost is a `formatCost` string. */
export function fennaShowBlueprintsPages(
  sawCost: string,
  ropeWalkCost: string,
): NonEmpty<DialogLine> {
  return [FENNA.blueprintsShown({ sawCost, ropeWalkCost })];
}

/** Fenna's shout once the second station stands upgraded. */
export const FENNA_COMPLETION_BARK = FENNA.blueprintsComplete;

// ── Wendell ──────────────────────────────────────────────────────────────

/**
 * The whole first visit, in order: the active crawler asks, Wendell
 * remembers, the active crawler asks to borrow them, Wendell names his
 * price, Belle asks about the cows, Wendell answers, and Ryan turns to Belle.
 */
export function wendellFirstVisitPages(active: SpeakingCrawler): NonEmpty<DialogLine> {
  const { ryan, belle } = WENDELL_BLUEPRINTS_REPLIES;
  return [
    inVoiceOf(active, ryan.askAboutBlueprints, belle.askAboutBlueprints),
    WENDELL.remembersTheBlueprints,
    inVoiceOf(active, ryan.askToBorrow, belle.askToBorrow),
    WENDELL.namesHisPrice,
    WENDELL_BLUEPRINTS_ASIDES.belleAsksAboutCows,
    WENDELL.missesTheCows,
    WENDELL_BLUEPRINTS_ASIDES.ryanPlansTheCow,
  ];
}

/** Wendell's line from naming his price until Midge is in his pasture. */
export function wendellWaitingPages(): NonEmpty<DialogLine> {
  return [WENDELL.waitingForCow];
}

/** Wendell handing over the blueprints once Midge is settled. */
export function wendellMidgeDeliveredPages(): NonEmpty<DialogLine> {
  return [WENDELL.midgeDelivered];
}

/** Wendell handing the blueprints back after they were lost from the quest slot. */
export function wendellBlueprintsReturnedPages(): NonEmpty<DialogLine> {
  return [WENDELL.blueprintsReturned];
}

// ── Merrit ───────────────────────────────────────────────────────────────

/**
 * Asking Merrit for a cow, opened by the active crawler. Her greeting depends
 * on whether the Plea is won: thanks for beating Vordrick Boneharrow, or good
 * luck against him.
 */
export function merritAskPages(
  active: SpeakingCrawler,
  pleaComplete: boolean,
): NonEmpty<DialogLine> {
  const { ryan, belle } = MERRIT_BLUEPRINTS_REPLIES;
  const greeting = pleaComplete
    ? MERRIT.blueprintsGreetingAfterPlea
    : MERRIT.blueprintsGreetingBeforePlea;
  return [
    inVoiceOf(active, ryan.goodMorning, belle.goodMorning),
    greeting,
    inVoiceOf(active, ryan.itsWhatWeDo, belle.itsWhatWeDo),
    inVoiceOf(active, ryan.askForCow, belle.askForCow),
    MERRIT.blueprintsFenceTerms,
    inVoiceOf(active, ryan.fenceAgreed, belle.fenceAgreed),
  ];
}

/** Merrit's opening while the fence is unfinished. */
export function merritFenceWaitingPages(): NonEmpty<DialogLine> {
  return [MERRIT.blueprintsFenceWaiting];
}

/** Merrit on the finished fence, the Bramblewick mix-up, and the grain she wants for Midge. */
export function merritFenceDonePages(active: SpeakingCrawler): NonEmpty<DialogLine> {
  const { ryan, belle } = MERRIT_BLUEPRINTS_REPLIES;
  return [
    MERRIT.blueprintsFenceDone,
    inVoiceOf(active, ryan.theMayor, belle.theMayor),
    MERRIT.blueprintsNotTheMayor,
    inVoiceOf(active, ryan.needMilk, belle.needMilk),
    MERRIT.blueprintsDairyTerms,
    MERRIT.blueprintsScytheOffer,
  ];
}

/** Merrit's opening while the party harvests. */
export function merritHarvestWaitingPages(): NonEmpty<DialogLine> {
  return [MERRIT.blueprintsHarvestWaiting];
}

/** Merrit taking the grain. Once it closes she calls Midge. */
export function merritGrainDeliveredPages(): NonEmpty<DialogLine> {
  return [MERRIT.blueprintsGrainDelivered];
}

/** Merrit's shout for Midge, barked across the pasture. */
export const MERRIT_CALL_MIDGE_BARK = MERRIT.blueprintsCallMidge;

/** The conversation Merrit opens herself once Midge has come to the party. */
export function merritMidgeArrivedPages(): NonEmpty<DialogLine> {
  return [MERRIT.blueprintsMidgeArrived];
}
