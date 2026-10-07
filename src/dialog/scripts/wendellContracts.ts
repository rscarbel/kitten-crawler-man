/**
 * Wendell's construction contracts, once "The Borrowed Blueprints" is done:
 * Midge is in his pasture, he would rather stay home with her, and the work
 * that still comes to him he subcontracts to the party.
 *
 * Same man as in `wendellBlueprints.ts`: an architect turned builder turned
 * farmer, careful, dry, and a sentence longer than the job strictly needs.
 */

import { pickLine, speakerLines, type DialogLine, type NonEmpty } from '../line';

const wendell = speakerLines('wendell');

/** A building named mid-sentence: "at the Rusty Anvil", not "at The Rusty Anvil". */
function midSentence(siteName: string): string {
  return siteName.replace(/^The /, 'the ');
}

/** A spot label read as part of a list: "re-rope the bellows". */
function asListItem(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const WENDELL_CONTRACTS = {
  /** The first talk once the contracts are unlocked; ends on the accept-or-decline row. */
  intro: wendell.line([
    "Now that Midge is safely in my keeping, I confess I find the prospect of remaining at home with her considerably more agreeable than passing my days upon a ladder in another man's parlour. Unfortunately, work possesses the tiresome habit of arriving whether one invites it or not.",
    'If you have the inclination, and the materials to support it, I might entrust some of these matters to you. Boards, rope and stone: you provide them, you perform the work, and the client pays you upon its completion. It is a perfectly respectable arrangement, and, I assure you, considerably more respectable than some arrangements I have known.',
  ]),
  /** The accept side of the intro's row. */
  acceptLabel: "I'll take a contract",
  /** The decline side of the intro's row. */
  declineLabel: 'Not right now',
  /** Opening line on any talk after the intro was declined, with no contract held. */
  reOffer: wendell.line(
    'The offer remains, should you discover yourselves possessed of an afternoon, a little ambition, and a sufficiently impressive pile of boards.',
  ),
  /** Opening line with no contract held, once the intro has been heard and a contract taken. */
  idle: wendell.line('I have another piece of work, should you be in the mood to acquire one.'),
  /** A contract still has unfinished spots. */
  activeNotReady: wendell.fn((args: { siteName: string; remaining: readonly string[] }) => [
    `And how proceeds the work at ${midSentence(args.siteName)}? It appears ${listed(args.remaining.map(asListItem))} still require your attention.`,
  ]),
  /** Every spot is done and the client has not yet paid. */
  activeReady: wendell.fn((args: { contactName: string }) => [
    `You ought to see ${args.contactName}; they owe you your payment. I would not leave them waiting. A client's gratitude is most generous immediately after a job is finished, and, like most pleasant things, diminishes considerably with time.`,
  ]),
  /** "Take another contract" pressed while one is still held. */
  finishFirst: wendell.fn((args: { siteName: string }) => [
    `You had best finish at ${midSentence(args.siteName)} first, unless you mean to abandon it. One undertaking at a time is generally the wiser course; I acquired that particular piece of wisdom at rather greater expense than I recommend.`,
  ]),
  /** "Take another contract" pressed while a finished job is still unpaid. */
  collectFirst: wendell.fn((args: { contactName: string }) => [
    `You should collect from ${args.contactName} first. I cannot, in good conscience, entrust you with another commission while the last remains unpaid; however fond I may be of optimism, I have never mistaken it for accounting.`,
  ]),
  /** Asked before a held contract is dropped. */
  dropConfirm: wendell.line(
    'I can find another person to undertake it, should you prefer. The materials already spent will, naturally, remain spent. I have yet to discover a method by which one may persuade a nailed board to return to its former state.',
  ),
  /** After the drop is confirmed. */
  dropped: wendell.line(
    'Then let us consider the matter returned. I bear you no ill will. The building has endured this long without your assistance, and I see no reason to suppose it shall become impatient now.',
  ),
  /** No site can take a contract right now. */
  nothingDoing: wendell.line(
    'There is nothing suitable at present. Do come again presently; it seems every roof in the neighbourhood has discovered some more urgent reason to require mending.',
  ),
  /** A contract was just issued: the building, the client and the exact bill. */
  issued: wendell.fn((args: { siteName: string; contactName: string; costText: string }) => [
    `${args.siteName}. ${args.contactName} is expecting you. You will require ${args.costText}. I recommend arriving with all of it.`,
  ]),
  /** Choice row labels. */
  takeAnotherLabel: 'Take another contract',
  dropLabel: 'Drop this contract',
  confirmDropLabel: 'Drop it',
  neverMindLabel: 'Never mind',
  restLabel: 'Rest in the hayloft',
  chatLabel: 'Chat',
  leaveLabel: 'Leave',
} as const;

const FOLLOW_UPS: NonEmpty<(siteName: string) => string> = [
  (siteName) =>
    `I understand you have made an end of things at ${midSentence(siteName)}. You are welcome at the farm whenever you find yourself in need of another occupation.`,
  (siteName) =>
    `Word has reached me from ${midSentence(siteName)} that the work is sound. Such praise is not given lightly, I assure you. Come by the farm when you are ready for another.`,
  (siteName) =>
    `${siteName} informs me that the work is finished and the account settled. I shall endeavour to have something else prepared for you the next time you pass the farm.`,
  (siteName) =>
    `I am told ${midSentence(siteName)} is standing more proudly than it has in years. One cannot ask much more of a building. There is, however, more work waiting for you at the farm.`,
];

/**
 * Wendell's note once a contract has been paid, naming the building. `n`
 * rotates the wording (pass the number of contracts completed), so two jobs in
 * a row are not signed off with the same sentence.
 */
export function wendellFollowUp(siteName: string, n: number): DialogLine {
  return wendell.line(pickLine(FOLLOW_UPS, n)(siteName));
}
