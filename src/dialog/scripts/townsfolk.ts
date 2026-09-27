/**
 * The line pools every street townsperson and interior occupant draws from.
 * Nobody here has a name of their own — they speak as their role, through a
 * transient speaker `townDialog.ts` builds from {@link roleDisplayName}.
 */

import type { NonEmpty } from '../line';
import type { TownRole } from '../../sprites/person/PersonAppearance';

/** The name shown as the dialog speaker for each role. */
const ROLE_NAMES: Record<TownRole, string> = {
  guard: 'Town Guard',
  merchant: 'Merchant',
  farmer: 'Farmer',
  smith: 'Blacksmith',
  innkeeper: 'Innkeeper',
  priest: 'Priest',
  child: 'Child',
  drunk: 'Tavern Regular',
  noble: 'Noble',
  beggar: 'Beggar',
  laborer: 'Laborer',
  skyfowl: 'Bird-folk',
  commoner: 'Townsperson',
};

export function roleDisplayName(role: TownRole): string {
  return ROLE_NAMES[role];
}

/** Everyday, role-flavoured lines. Rotated per citizen so repeats stay fresh. */
export const AMBIENT_LINES = {
  guard: [
    'Move along. Nothing to see here.',
    "Keep your nose clean and we'll get along fine.",
    'Long watch tonight. The ruins never sleep.',
    "Draw a blade in my square and you'll answer for it.",
    'Stay inside the walls after dark. Safer that way.',
  ],
  merchant: [
    'Finest wares this side of the ruins — come see!',
    'Coin talks, friend. What are you buying?',
    'Trade’s been slow with the roads so dangerous.',
    'A discerning eye! I like that in a customer.',
    "Everything's for sale if the price is right.",
    'Signet’s ink moves on the skin, you know. Mine’s been asleep for weeks.',
    'One mark per crawler. Any more and they start arguing with each other.',
  ],
  farmer: [
    'Weather’s held. Should be a fair harvest.',
    'These old bones weren’t made for city cobbles.',
    'Lost two sheep to whatever crawls out of those ruins.',
    'Honest work, honest pay. That’s all I ask.',
    'Come by the farm if you want fresh milk.',
  ],
  smith: [
    'Mind the sparks. Forge runs hot today.',
    'Bring me good steel and I’ll make it sing.',
    'A dull blade gets a man killed out there.',
    'Every dent tells a story. What’s yours?',
    'Hammer, heat, and patience. No shortcuts.',
  ],
  innkeeper: [
    'A warm bed and a hot meal — best in town.',
    'Sit anywhere you like. Ale’s coming.',
    'Travellers bring the strangest tales through here.',
    'Mind the regulars. They’re harmless. Mostly.',
    'First one’s on the house for a friendly face.',
  ],
  priest: [
    'May the light keep you on the dark roads.',
    'Dark times test the faithful. Keep heart.',
    'The ruins hunger, but hope endures.',
    'A quiet word of prayer costs nothing.',
    'Peace be with you, traveller.',
    'The skyfowl are not birds. They are watchers, and they are patient.',
    'Come to the temple when you are broken. That is what it is for.',
  ],
  child: [
    'Wanna see me hop the whole square? Watch!',
    'Are you a real adventurer? You look like one!',
    'Mama says not to talk to strangers. You seem okay though.',
    'I found a shiny rock! Wanna see? No? Okay.',
    'Tag! You’re it! ...aw, you’re no fun.',
  ],
  drunk: [
    'Heyyy... you’re alright, you know that?',
    'One more round won’t kill me. Probably.',
    'I coulda been a hero. Coulda been...',
    'The room’s spinnin’ or the world is. Can’t tell.',
    'Shhh — don’t tell the barkeep I’m out of coin.',
  ],
  noble: [
    'Do watch where you step. This cloak was expensive.',
    'One simply cannot find decent help these days.',
    'The rabble grows bold. Where are the guards?',
    'I own half this street, you know. The better half.',
    'Charming little town. For a ruin on the edge of doom.',
  ],
  beggar: [
    'Spare a coin? Anything helps, kind soul.',
    'Haven’t eaten since the frost. You got bread?',
    'I see things others miss, down here in the gutter.',
    'Bless you, bless you — even for a passing glance.',
    'The cold’s a cruel landlord, friend.',
  ],
  laborer: [
    'Back’s achin’, but the walls won’t build themselves.',
    'Honest sweat, that’s all a man’s got out here.',
    'Careful past the scaffolding, aye?',
    'Long day. Longer night. Same as always.',
    'You lookin’ for work? Foreman’s always short-handed.',
  ],
  skyfowl: [
    'Skies are clear today. Good flying, if you’ve the wings.',
    'We roost above the square. Best view in town.',
    'Groundfolk worry too much. Look up once in a while.',
    'The wind carries strange tidings from the ruins.',
    'Ruffle my feathers and we’ll have words, friend.',
  ],
  commoner: [
    'Have you seen the new temple? Whole dome went up in a season.',
    'There’s a tattooist by the club now. My cousin got one. It winked at me.',
    'The Sleeping Cat is the safe room now. Nothing hostile gets through that door — try it once and you will not sleep anywhere else.',
    'Fine day, isn’t it? For now, anyway.',
    'You’re not from around here, are you?',
    'Heard the market’s got fresh stock. Worth a look.',
    'Keep to the lit streets and you’ll be fine.',
    'A face like yours means trouble’s not far behind.',
  ],
} as const satisfies Record<TownRole, NonEmpty<string>>;

/** Everyone drops everything and reacts when the town is under threat. */
export const DANGER_LINES = {
  guard: 'Get behind me, civilian! To arms!',
  merchant: 'My wares — never mind the wares, RUN!',
  farmer: 'Gods preserve us, it’s come for the town!',
  smith: 'Grab a blade off the rack — we make our stand here!',
  innkeeper: 'Everyone into the cellar! Go, go!',
  priest: 'Light shield us all — the reckoning is upon us!',
  child: 'Mama! MAMA! I’m scared!',
  drunk: 'Sobered me right up, that did. We’re done for!',
  noble: 'Where are my guards?! Somebody DO something!',
  beggar: 'Nobody’ll miss an old beggar. Save yourselves.',
  laborer: 'Drop the tools — grab anything that swings!',
  skyfowl: 'Take to the air! The ground’s no place to be!',
  commoner: 'It’s breaking through! Run for the stairs!',
} as const satisfies Record<TownRole, string>;

/**
 * How the town regards the player, once quests resolve. Unlike a gossip line
 * (third-person "the town's talking"), these greet the player directly — a
 * hero's welcome once threats are behind them, wary hope while the killer
 * still walks. Every role greets from the same pool, since the tier is about
 * the player's deeds, not the speaker's trade.
 */
export type ReputationTier =
  'savior' | 'double_hero' | 'circus_hero' | 'murder_hero' | 'murder_wary';

export const REPUTATION_GREETINGS = {
  savior: [
    'You held back the doom in that tower. We are alive because of you.',
    'The whole city would be ash if not for you. We won’t forget it.',
    'They’ll tell your tale for generations — the one who saved us all.',
  ],
  double_hero: [
    'The circus freed and the killer dead — is there anything you can’t do?',
    'Two shadows lifted off this town, both by your hand. Bless you.',
    'Folk walk easy day and night again. That’s your doing, friend.',
  ],
  circus_hero: [
    'You’re the one who freed the circus folk! The whole town’s grateful.',
    'They say you broke the ringmaster’s grip. Well done, truly.',
    'The performers walk free thanks to you. First round’s on us!',
  ],
  murder_hero: [
    'The night-killer’s dead because of you. We can breathe again.',
    'You ended the murders. My family sleeps easy now — thank you.',
    'No more bodies by the well. The town owes you a debt.',
  ],
  murder_wary: [
    'You’re looking into the killings, aren’t you? ...Watch your back.',
    'Careful who you trust — the killer wears a friendly face.',
    'If anyone can stop these murders, maybe it’s you. Gods speed.',
  ],
} as const satisfies Record<ReputationTier, NonEmpty<string>>;

/**
 * The reactive, third-person gossip a citizen leads with when the world has
 * something worth reporting. Named by the world state each answers rather
 * than left as a chain of anonymous string literals, so the branch that picks
 * one and the line it picks read as the same fact.
 */
export const GOSSIP_LINES = {
  doomsdaySurvived: 'We nearly lost everything up in that tower. Nearly.',
  murderResolved: 'The killings have stopped. Folk sleep easier now — we owe you.',
  murderStillRaw: 'It isn’t over, is it. It doesn’t feel over.',
  murderQuillNamed: 'They say it was Miss Quill all along. Who could’ve guessed?',
  murderActiveUnnamed: 'Lock your doors. Someone’s been killing in the night.',
  murderBodyFound: 'Did you hear? They found a poor soul dead by the well.',
  circusResolved: 'The circus folk walk free again. The whole town’s talking.',
  circusHeatherSlain: 'They say the dancing bear fell in the ruins. Grim business.',
  circusOngoing: 'Strange lights over the old Big Top of late. Gives me chills.',
} as const;
