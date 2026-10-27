/**
 * The line pools every street townsperson and interior occupant draws from.
 * Nobody here has a name of their own — they speak as their role, through a
 * transient speaker `townDialog.ts` builds from {@link roleDisplayName}.
 *
 * Danger barks are keyed by species, then role. Ambient pools are keyed by
 * voice, then role, and `AMBIENT_VOICE_OF` names the voice each species talks
 * in: a Hawkfolk guard and a human guard hold the same post but talk about it
 * differently (Hawkfolk idiom, a minority's caution, a majority's ease).
 * `townDialog.ts`'s `citizenSpecies` and `townResidents.ts`'s `residentSpecies`
 * read each speaker's own species and hand it to `ambientPool`/`dangerBark`
 * below.
 */

import type { NonEmpty } from '../line';
import type { TownRole } from '../../sprites/person/PersonAppearance';
import type { TownSpecies } from '../../systems/townSpecies';

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
  commoner: 'Townsperson',
};

export function roleDisplayName(role: TownRole): string {
  return ROLE_NAMES[role];
}

/**
 * Everyday, role-flavoured lines for citizens who live on the ground. Rotated
 * per citizen so repeats stay fresh.
 */
const AMBIENT_LINES_GROUNDFOLK = {
  guard: [
    'Watch’s short-handed again. Pell keeps asking for a second pair of boots and it never comes.',
    'I walk the ground beat, same as you. Feet the whole shift.',
    'Break a bottle in the alley and it’s Marlow you owe, not me.',
    'Four years on this post and my knees have opinions about it.',
  ],
  merchant: [
    'Undercut by the shop again this week. Kestrel’s prices, not mine — try telling a customer that.',
    'I count the till twice. Once for me, once for whoever asks.',
    'Bess and Orlo split the square between them. I sell what’s left over.',
    'Buy something or don’t. Just don’t lean on the cart.',
  ],
  farmer: [
    'Marta’s flour feeds the garrison and gets none of the credit for it.',
    'Weather’s held. Around here that counts as a small miracle.',
    'Lost a hen to something that came over the wall last week. Didn’t wait to see what.',
    'Corvin from the mill asks me every week if I’ve met a real crawler.',
  ],
  smith: [
    'Varga does the real work at the Anvil. I haul the coal.',
    'Every blade that comes back from past the wall has a story cut into it somewhere.',
    'Burned my sleeve twice this week. Third time’s the charm, they say.',
    'Steel doesn’t lie, my old master used to tell me. Varga says the same, fewer words.',
  ],
  innkeeper: [
    'Rougher than the Cat, gentler than the Stump. We split the difference.',
    'I keep a room open for anyone who won’t say why they need it.',
    'Half my regulars owe me. The other half pay early to feel better about it.',
    'You look like you slept somewhere worse than a bed last night.',
  ],
  priest: [
    'I sweep the temple steps. Doesn’t make me devout, just tidy.',
    'Aviel preaches to whoever’s standing there that morning, ground or wing.',
    'That dome went up faster than any ground crew could’ve built it.',
    'I light the lamps and leave the doctrine to the deacon.',
  ],
  child: [
    'My mum says the shopkeeper up the square counts everything twice. I believe her.',
    'I dared my friend to touch the well and she wouldn’t. I might.',
    'Are you really from past the wall? What’s it like out there?',
    'I found a feather bigger than my hand. Didn’t ask whose it was.',
  ],
  drunk: [
    'Marlow keeps pouring even after he says he won’t. Bless him for it.',
    'Three of his regulars went missing and everyone just stopped asking.',
    'I had a trade once. Ask me again after the next round, might come back to me.',
    'The circus used to draw a crowd past the wall. Now it’s just us, drawing on the bar.',
  ],
  noble: [
    'I came into money the honest way. I married it.',
    'This town smells of woodsmoke and ambition. Mostly the woodsmoke.',
    'I keep meaning to leave. The company’s oddly good.',
    'Nobody’s robbed me yet. I choose to take that as respect.',
  ],
  beggar: [
    'Spare a coin. I’ve fed a family on less, once.',
    'I watch this square better than the guards do. Nobody watches me back.',
    'Cold sits harder on the ground than it does on a roost, I’d wager.',
    'Marlow lets me sit by his door if I don’t ask for ale. Fair trade.',
  ],
  laborer: [
    'Steve pays fair for scrap timber. Rare enough to say twice.',
    'Hauled crates since sunup. My back has opinions.',
    'That scaffolding by the tower hasn’t moved in a month. Nobody’s in a hurry.',
    'Ground work’s steady work. I’ll take steady.',
  ],
  commoner: [
    'Heard the new shopkeeper counts stock twice a week. Good luck slipping anything past her.',
    'The tattooist by the club corrected her own sign, twice. Spelling was never the part she trained for.',
    'Sleeping badly? Try a room at the Sleeping Cat. Whatever’s out there hasn’t made it past that door yet.',
    'Bess and Orlo have run those two stalls so long I forget the square without them.',
    'You’re new. It shows.',
  ],
} as const satisfies Record<TownRole, NonEmpty<string>>;

/** Everyday, role-flavoured lines for Hawkfolk citizens. */
const AMBIENT_LINES_HAWKFOLK = {
  guard: [
    'Corporal Pell drills us twice what the roster admits to. Nineteen spears, not forty — don’t repeat that.',
    'I’d rather stand a roof post. You see trouble coming from up there.',
    'Kessler’s still filing reports on that cellar. Nobody upstairs reads them.',
    'A ground patrol’s an insult to anyone with wings. The pay’s still the pay.',
  ],
  merchant: [
    'Ground-side stock moves slower than wing-side. Don’t ask why, it just does.',
    'Every crawler pays the same mark-up. Argue after and you’re arguing with the till.',
    'Nest-debt or not, I don’t extend credit past the week’s end.',
    'Fen keeps cutting into my herb trade. Good for her, worse for me.',
  ],
  farmer: [
    'Ground crops, ground work. My cousins in the roost don’t understand why I bother.',
    'Soil here’s better than most of the floor. Say what you like about the ruins.',
    'Wendell used to keep cows past the Barracks. Pasture’s still there. Cows aren’t.',
    'Molt-year or not, the fields don’t plant themselves.',
  ],
  smith: [
    'Garrison steel keeps coming back with high notches on the edge. I don’t ask, I just re-forge it.',
    'Ground-side apprentices flinch at the heat. So do half the wing-side ones, if I’m honest.',
    'The forge runs hottest an hour before the wing shift changes. No idea why.',
    'Varga taught me to read a blade before I read a person. Still the better skill.',
  ],
  innkeeper: [
    'Full house tonight — wing-side rooms go first, they always do.',
    'Ossie runs the quiet house. I run the one where the clerks actually talk.',
    'A bed’s a bed. I don’t ask why a crawler needs one this badly.',
    'Brend’s guild corner’s sat empty three nights running. Bad sign or a slow season — hard to say.',
  ],
  priest: [
    'The high watch sees more than it says. Aviel’s own words, not mine.',
    'Donations are down since the magistrate stopped coming. Draw your own conclusions.',
    'A watcher observes and doesn’t intervene. Comforting some weeks, less so others.',
    'Sit on the temple steps a while. Nobody up there minds the company.',
  ],
  child: [
    'I can glide off the fountain edge now. Don’t tell my mother.',
    'The ground kids can’t see over the market stalls. I feel bad about it sometimes.',
    'Corvin from the mill dared me to land on the tower roof. Haven’t yet.',
    'My feathers came in wrong on one side. Everyone says it doesn’t matter. It does, a little.',
  ],
  drunk: [
    'Grounded tonight, in every sense of the word.',
    'Ossie waters mine down. I know it and I still order another.',
    'Lost a molt-year’s wages at that table. I’d do it again.',
    'The high watch doesn’t drink. Somebody ought to, on its behalf.',
  ],
  noble: [
    'Golden barring isn’t bought, whatever the tailors downstairs will tell you.',
    'Featherfall used to receive callers. These days nobody receives anyone.',
    'I slum it at the Stump once a season. Keeps the perspective honest.',
    'The high watch owes me a courtesy call it hasn’t paid.',
  ],
  beggar: [
    'Clipped, if you’re wondering. Lost the roost before I lost the trade.',
    'Ground-side pity spends the same as wing-side pity. I’ll take either.',
    'Stood guard at that gate once. Now I sit under it.',
    'Nest-debt caught up with me before the season did.',
  ],
  laborer: [
    'Wing-side hauling pays better and I still take the ground jobs. Habit, I suppose.',
    'Steve’s old apprentice worked this crew. We don’t talk about him much.',
    'Carried timber past the wall and back twice this week. My wings ache worse than my legs ever did.',
    'Molt-year’s coming. Rather be hauling crates than moulting mid-shift.',
  ],
  commoner: [
    'Groundfolk ask a lot of questions for people who can’t see the whole square at once.',
    'Market’s better stocked wing-side of the fountain. Everyone knows it, nobody says it out loud.',
    'Molt-year’s been kind to me so far. Ask again in a month.',
    'The high watch hasn’t said a word in six weeks. That’s its own kind of news.',
    'You walk like someone who’s never had to look up to cross a street.',
  ],
} as const satisfies Record<TownRole, NonEmpty<string>>;

/** A shared ambient pool: the everyday talk of the street, as heard from the ground or from the roosts. */
type AmbientVoice = 'groundfolk' | 'hawkfolk';

const AMBIENT_LINES = {
  groundfolk: AMBIENT_LINES_GROUNDFOLK,
  hawkfolk: AMBIENT_LINES_HAWKFOLK,
} as const satisfies Record<AmbientVoice, Record<TownRole, NonEmpty<string>>>;

/**
 * Which ambient pool each species' unnamed citizens talk from. The groundfolk
 * pool is town gossip from someone without wings and nothing in it is
 * particular to humans, so a species with no street talk of its own shares it
 * until it is given a pool here.
 */
const AMBIENT_VOICE_OF = {
  human: 'groundfolk',
  hawkfolk: 'hawkfolk',
  dwarf: 'groundfolk',
  otter: 'groundfolk',
  crocodilian: 'groundfolk',
} as const satisfies Record<TownSpecies, AmbientVoice>;

/** The citizen's ambient pool, by the voice their species talks in. */
export function ambientPool(species: TownSpecies, role: TownRole): NonEmpty<string> {
  return AMBIENT_LINES[AMBIENT_VOICE_OF[species]][role];
}

/** Everyone drops everything and reacts when the town is under threat. */
const DANGER_LINES_HUMAN = {
  guard: 'Civilians behind me, NOW!',
  merchant: 'Forget the cart, just RUN!',
  farmer: 'Gods above, it’s found the town!',
  smith: 'Grab whatever’s sharp, we hold here!',
  innkeeper: 'Cellar, everyone, GO!',
  priest: 'Light keep us. Inside, all of you!',
  child: 'Mama! MAMA!',
  drunk: 'That sobered me up quick. We’re done for!',
  noble: 'Where are my GUARDS?!',
  beggar: 'Nobody’ll miss me. Get the children out first!',
  laborer: 'Drop the tools, grab anything that swings!',
  commoner: 'It’s through the gate. Run for the stairs!',
} as const satisfies Record<TownRole, string>;

const DANGER_LINES_HAWKFOLK = {
  guard: 'Air’s no safer tonight. Hold the line anyway!',
  merchant: 'Leave the stall, nothing on it’s worth this!',
  farmer: 'To the roofs, all of you, NOW!',
  smith: 'Off the ground, everyone who can manage it!',
  innkeeper: 'Upstairs and bar the shutters, MOVE!',
  priest: 'The high watch sees this too. Get to shelter, NOW!',
  child: 'I can’t fly fast enough, help!',
  drunk: 'Grounded and terrified. Wonderful combination!',
  noble: 'Someone fetch the watch. I did NOT pay taxes for this!',
  beggar: 'Already clipped. Might as well stand and shout for the rest of you!',
  laborer: 'Scatter wing-side, NOW, don’t bunch up!',
  commoner: 'To the roosts, everyone. Don’t look back!',
} as const satisfies Record<TownRole, string>;

const DANGER_LINES_DWARF = {
  guard: 'Shields together! Nothing gets past a dwarf standing still!',
  merchant: 'Lock the strongbox first, THEN run!',
  farmer: 'Down the root cellar, every last one of you!',
  smith: 'Hammers up! It bleeds like anything else!',
  innkeeper: 'Into the cellar, the barrels will hold a door!',
  priest: 'Stone wards hold. Get behind me, all of you!',
  child: 'I can’t see over anyone, which way do I RUN?',
  drunk: 'Good. I was hoping something would pick a fight!',
  noble: 'This is NOT what I pay the watch for!',
  beggar: 'I’ve lived through worse. Keep your heads low!',
  laborer: 'Pick up anything with a heavy end and HOLD!',
  commoner: 'Down, low and inside. Go, go, GO!',
} as const satisfies Record<TownRole, string>;

const DANGER_LINES_OTTER = {
  guard: 'Whistle’s gone, that means MOVE!',
  merchant: 'Leave it, leave all of it, it floats or it doesn’t!',
  farmer: 'Make for the river, it won’t follow us in!',
  smith: 'Bank the forge and get behind the anvil!',
  innkeeper: 'Everybody out the back and down to the water!',
  priest: 'Keep calm and keep moving, that’s the whole prayer!',
  child: 'I’m small, I can hide, but where?!',
  drunk: 'Somebody hold my drink. Actually, I’ll hold it. RUN!',
  noble: 'My good coat! Somebody save my good coat!',
  beggar: 'Into the reeds, nobody looks in the reeds!',
  laborer: 'Down tools, grab a pole, and stay together!',
  commoner: 'Head for the water, it’s the one place it won’t look!',
} as const satisfies Record<TownRole, string>;

const DANGER_LINES_CROCODILIAN = {
  guard: 'Behind me. I’m the thickest hide in this street!',
  merchant: 'Shutters down! Everyone get BEHIND the counter!',
  farmer: 'Into the mud and stay still, it can’t see what doesn’t move!',
  smith: 'Let it come close. I bite harder than I hit.',
  innkeeper: 'Bar the doors and don’t you DARE open them!',
  priest: 'Patience got us through worse than this. Inside, now!',
  child: 'I’ll bite it! I WILL bite it!',
  drunk: 'Lucky thing, whatever it is, that I’m too slow to run.',
  noble: 'Someone with less expensive scales go and deal with it!',
  beggar: 'Nobody bothers a croc. Get the little ones out first!',
  laborer: 'Down tools, everybody in the back, NOW!',
  commoner: 'Stay low and keep still. Then RUN when I say!',
} as const satisfies Record<TownRole, string>;

const DANGER_LINES = {
  human: DANGER_LINES_HUMAN,
  hawkfolk: DANGER_LINES_HAWKFOLK,
  dwarf: DANGER_LINES_DWARF,
  otter: DANGER_LINES_OTTER,
  crocodilian: DANGER_LINES_CROCODILIAN,
} as const satisfies Record<TownSpecies, Record<TownRole, string>>;

/** The citizen's danger bark, in their own species' voice. */
export function dangerBark(species: TownSpecies, role: TownRole): string {
  return DANGER_LINES[species][role];
}

/**
 * How the town regards the player, once quests resolve. Unlike a gossip line
 * (third-person "the town's talking"), these greet the player directly — a
 * hero's welcome once threats are behind them, wary hope while the killer
 * still walks. Every role greets from the same pool, since the tier is about
 * the player's deeds, not the speaker's trade or species.
 */
export type ReputationTier = 'savior' | 'murder_hero' | 'murder_wary';

export const REPUTATION_GREETINGS = {
  savior: [
    'You held that tower together with your bare hands, near enough. We’re alive because of it.',
    'The whole square would be ash by now if not for you. Nobody here forgets that.',
    'Grandchildren not born yet are going to hear about you.',
  ],
  murder_hero: [
    'Whatever was killing people, it isn’t anymore. That’s your doing.',
    'My family sleeps with the door unbolted again. Thank you for that.',
    'No more bodies by the well. Took long enough, but you did it.',
  ],
  murder_wary: [
    'You’re looking into the killings, aren’t you. Watch yourself.',
    'Careful who you trust out there. Whoever’s doing this wears a friendly face.',
    'If anyone’s going to stop this, my money’s on you.',
  ],
} as const satisfies Record<ReputationTier, NonEmpty<string>>;

/**
 * The reactive, third-person gossip a citizen leads with when the world has
 * something worth reporting. Named by the world state each answers rather
 * than left as a chain of anonymous string literals, so the branch that picks
 * one and the line it picks read as the same fact.
 */
export const GOSSIP_LINES = {
  doomsdaySurvived: 'That tower nearly took the whole square with it. Nearly.',
  murderResolved: 'The killings have stopped. Folk are sleeping again — we owe that to somebody.',
  murderStillRaw: 'It isn’t over, is it. Doesn’t feel over.',
  murderQuillNamed: 'They’re saying it was Miss Quill all along. Who’d have guessed?',
  murderActiveUnnamed: 'Bar your door tonight. Someone’s still killing after dark.',
  murderBodyFound: 'Did you hear? They found another one by the well.',
} as const;
