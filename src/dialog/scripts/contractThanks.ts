/**
 * What each construction contract's contact says when the party comes to
 * collect: two thanks lines per contact, in their own voice, each closing on
 * the amount paid. Skyfowl Town residents speak as their interior resident
 * does, a runtime name in their citizen voice; Briar Hollow villagers speak as
 * their own cast entry.
 */

import type {
  ContractContactId,
  SkyfowlContractContactId,
  VillageContractContactId,
} from '../../systems/constructionContracts/contractCatalog';
import { residentById } from '../../systems/townResidents';
import {
  pickLine,
  speakerLines,
  transientSpeaker,
  type DialogLine,
  type LineBuilder,
  type NonEmpty,
} from '../line';
import type { CitizenSpeechStyle } from '../speakers';

interface ThanksText {
  /** The building as Wendell and the Journal name it, so a contact with two sites names the right one. */
  readonly site: string;
  /** The payout, worded as it is spoken: "294 coins". */
  readonly coins: string;
}

type ThanksPool = NonEmpty<(text: ThanksText) => string>;

const CONTRACT_THANKS = {
  quartermaster_dann: [
    ({ coins }) =>
      `Bunks stood, racks pegged, flags flat. I have checked the work against the list twice and the list agrees. Signed for, and here are your ${coins}, counted out even.`,
    ({ site, coins }) =>
      `${site} goes back on the books as serviceable. I do not say that lightly, and I do not say it twice. Your ${coins}.`,
  ],
  sgt_kessler: [
    ({ coins }) =>
      `You were useful. That puts you ahead of everyone the high watch ever sent down this alley. Pay is ${coins}.`,
    ({ coins }) =>
      `Stove draws, wall stands, floor does not give under a boot. I will put that in a report nobody reads. You get ${coins}, which is better.`,
  ],
  brann_cartwright: [
    ({ coins }) =>
      `Slow work, honest work, and you did both. Shop has not stood this square since I was an apprentice. Here is ${coins}, paid on the day.`,
    ({ coins }) =>
      `I went over every joint looking for something to fix and found nothing. Strange feeling, in my own shop. That is ${coins}, and I asked after your knees.`,
  ],
  keeper_brenna_kestrel: [
    ({ coins }) =>
      `Counter level, shelves sound, storeroom dry. I counted it once and the till counted it again, and we agree. Your ${coins}, paid on the nail.`,
    ({ coins }) =>
      `Coin first, story after, I always say. You have earned the story, so here is the coin: ${coins}.`,
  ],
  deacon_aviel: [
    ({ coins }) =>
      `The sky hath a sound roof beneath it once more, and thou didst raise it. Bless thee. Take these ${coins} from the temple's own purse.`,
    ({ coins }) =>
      `I prayed for carpenters. I confess I did not expect them to come up out of the dungeon. Thy wage is ${coins}, and my thanks besides.`,
  ],
  apothecary_fen: [
    ({ coins }) =>
      `Racks strung, still drawing, and nothing drips on the counter. That is a better result than most of my remedies manage. ${coins}, and no, I will not throw in a tincture.`,
    ({ coins }) =>
      `Prevention is free and nobody takes it. You took it anyway, on my behalf. Here are your ${coins}.`,
  ],
  innkeep_ossie: [
    ({ coins }) =>
      `Beds hold, hearth draws, and nobody has fallen through anything yet. You look like you worked in a hedge, and I mean that kindly. Here is ${coins}.`,
    ({ coins }) =>
      `The guests will sleep sounder for this, and so will I, behind the bar beside the till. Speaking of the till: ${coins}, and a bowl of stew whenever you want one.`,
  ],
  innkeep_brend: [
    ({ coins }) =>
      `The Flagon keeps a table again. Several, in fact. We do not extend credit, so here is your payment in full: ${coins}.`,
    ({ coins }) =>
      `The guild corner approved of the hearth. That is the first thing they have approved of in a decade. Your ${coins}, and I shall repeat only a third of how it went.`,
  ],
  innkeep_marlow: [
    ({ coins }) =>
      `Floor's level in two corners now. That doubles the pitch. Here's ${coins}, and don't go out the back way.`,
    ({ coins }) =>
      `Nobody in here is anybody, but they'll all drink at a bar that doesn't wobble. You built that. ${coins}, cash, no questions.`,
  ],
  old_hilda: [
    ({ coins }) =>
      `The hearth draws and the jars have stopped complaining, dearie. That is a rare thing in this cottage. Here are your ${coins}.`,
    ({ coins }) =>
      `I will tell you plain, same as always: good work, honest work, and not a charm in it. That is ${coins}, dearie. Spend them on something with a lid.`,
  ],
  smith_varga: [
    ({ coins }) =>
      `Forge draws, bellows breathe, quench holds water. It was all going to break, and you fixed it before it did. ${coins}. Do not touch the black end on your way out.`,
    ({ coins }) =>
      `Fifty years, and the forge did not once tell me you were rushing. That is the highest praise I have. Here are your ${coins}.`,
  ],
  tattooist_nim: [
    ({ coins }) =>
      `The chair is comfortable again. That is deliberate, and it is still the only kindness in here, apart from this: ${coins}.`,
    ({ coins }) => `You worked all day and did not once ask me for a mark. I noticed. ${coins}.`,
  ],
  marta_miller: [
    ({ coins }) =>
      `Mill turns, hearth's lit, nothing rotting under the flour. You want the price or the truth? Truth is you saved my week. Price is ${coins}.`,
    ({ coins }) =>
      `Eat something, you're all edges. And take these before the Barracks hear and call it a favour: ${coins}.`,
  ],

  bramblewick: [
    ({ coins }) =>
      `I have recorded your work in the hall ledger, which is the highest honour I am in a position to bestow. The village purse, I am pleased to say, can manage something rather more tangible: ${coins}.`,
    ({ coins }) =>
      `One does not appreciate how much a hall depends upon its benches until one has spent a season standing. On behalf of Briar Hollow, please accept ${coins}.`,
  ],
  oren: [
    ({ coins }) =>
      `Hearth's hot, anvil's set, and nothing in here wobbles when I strike. Good work. That's ${coins}.`,
    ({ coins }) =>
      `Better tools get the job done faster. Turns out better hands do too. Here's ${coins}.`,
  ],
  pipkin: [
    ({ coins }) =>
      `Hearth's roaring, counter's solid, and nobody's eating off their knees anymore. Don't ask what's in tonight's stew. Do take your ${coins}.`,
    ({ coins }) =>
      `Coins on the counter, that's how it works in here. Just this once they go the other way: ${coins}.`,
  ],
  sella: [
    ({ coins }) =>
      `Clean floor, cots that hold, and a basin I can trust. That's better medicine than anything I sell. Your fee: ${coins}.`,
    ({ coins }) =>
      `You've done my patients a kindness. Try not to come back needing one of those cots. ${coins}, as agreed.`,
  ],
  vetch: [
    ({ coins }) =>
      `Shelves standing, floor sealed against the rats. Fewer losses means better margins, and better margins mean I can hand you ${coins} without wincing. Much.`,
    ({ coins }) =>
      `Excellent. That is very good for future business. Here are your ${coins}, none of which, I assure you, are stolen.`,
  ],
  tikka: [
    ({ coins }) =>
      `Bench is square, crates are handled, and the test pad is level. Not mostly. Completely. Here's ${coins}.`,
    ({ coins }) =>
      `I needed labor more than I needed introductions, and you've given me plenty of both. ${coins}. Go build something else.`,
  ],
  fenna: [
    ({ coins }) =>
      `Well, I'll be. Nothin' creakin', nothin' saggin', and the hoist holds. That's ${coins}, an' every one earned.`,
    ({ coins }) =>
      `Not a speck of sawdust anywhere it ain't got business bein'. Here's ${coins}. Fair enough, I'd say.`,
  ],
  sedge: [
    ({ coins }) => `Bunks are up. Door's sound. The post is easier to hold now. Here's ${coins}.`,
    ({ coins }) => `Good work. I'll stand a better watch for it. ${coins}.`,
  ],
  merrit: [
    ({ site, coins }) =>
      `Whelp, y'all got the ${site} lookin' better'n it has in years. I'm a rodent of my word, and my word was ${coins}.`,
    ({ site, coins }) =>
      `The cows'll be pleased, and so am I. Holler if the ${site} ever needs more doin'. Here's ${coins}.`,
  ],
  nella: [
    ({ coins }) =>
      `Everyone will notice the cottage, though nobody will say so. I will. Thank you. ${coins}.`,
    ({ coins }) =>
      `The loom sings again. I'd sew you a pair of gloves, but I think you'd rather have ${coins}.`,
  ],
  cricket: [
    ({ coins }) => `Floor's dry. That's more than I can say for me. Here's ${coins}.`,
    ({ coins }) => `Door's square, walls hold. Mud stays outside, where it belongs. ${coins}.`,
  ],
  wicker: [
    ({ coins }) =>
      `I fix things for everyone. Nobody fixes things for me. Until today. Here's ${coins}.`,
    ({ coins }) => `That'll hold for a while. Longer than a while, honestly. I'd know. ${coins}.`,
  ],
  midge: [
    ({ coins }) =>
      `Lamps back on their shelf, and the wind stays out of the walls. Maybe the bell will mean something good tomorrow. Here's ${coins}.`,
    ({ coins }) => `I watched you work. Steady hands. I notice that sort of thing. ${coins}.`,
  ],
  garn: [
    ({ coins }) =>
      `Good stonework. Strong walls eat a shocking amount of it, and you picked the right pieces. ${coins}.`,
    ({ coins }) => `Hut's sound and the step won't crack. That's ${coins}.`,
  ],
} as const satisfies Record<ContractContactId, ThanksPool>;

/** Who is speaking the thanks, and for a Skyfowl Town resident, the voice they speak in. */
export type ContractThanksSpeaker =
  | {
      readonly town: 'skyfowl';
      readonly contact: SkyfowlContractContactId;
      readonly speechStyle: CitizenSpeechStyle;
    }
  | { readonly town: 'briar_hollow'; readonly contact: VillageContractContactId };

export interface ContractThanksOptions {
  /** The finished site's name, as `ContractSiteDef.name` gives it. */
  readonly siteName: string;
  readonly payout: number;
  /** Any integer; picks which of the contact's lines plays, so callers can rotate through them. */
  readonly variant: number;
}

function thanksSpeaker(speaker: ContractThanksSpeaker): LineBuilder {
  return speaker.town === 'skyfowl'
    ? transientSpeaker(residentById(speaker.contact).name, speaker.speechStyle)
    : speakerLines(speaker.contact);
}

/** The contact's thanks on handing over a finished contract's payout. */
export function contractThanksLines(
  speaker: ContractThanksSpeaker,
  { siteName, payout, variant }: ContractThanksOptions,
): NonEmpty<DialogLine> {
  const pool: ThanksPool = CONTRACT_THANKS[speaker.contact];
  const text = pickLine(pool, variant)({ site: siteName, coins: `${payout} coins` });
  return [thanksSpeaker(speaker).line(text)];
}
