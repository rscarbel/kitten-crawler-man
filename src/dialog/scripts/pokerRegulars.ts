/**
 * What the Desperado Club's poker regulars say at the table, keyed by voice
 * and then by the moment that sets them off.
 *
 * A voice (banter set) is rolled per run alongside everything else about how a
 * regular plays, so the same face can grumble one run and philosophise the
 * next. That is why no line may hint at a play style: a regular who says "I
 * never fold" would hand the player the read the table is meant to make them
 * earn. Lines talk about luck, nerves, money and manners, never about how the
 * speaker plays.
 *
 * Every line is written to fit two rendered rows of the compact speech bubble.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import type { SpeakerId } from '../speakers';
import type { PokerBanterTrigger } from '../../systems/casino/poker/pokerEvents';
import type { BanterSetId } from '../../systems/casino/poker/npc/profiles';
import type { RegularId } from '../../systems/casino/poker/npc/regulars';

type BanterPool = Readonly<Record<PokerBanterTrigger, NonEmpty<string>>>;

/** The cast entry each regular speaks as. */
export const REGULAR_SPEAKERS = {
  wren: 'pokerWren',
  grizzle: 'pokerGrizzle',
  ottoline: 'pokerOttoline',
  pell: 'pokerPell',
  dabney: 'pokerDabney',
  corvina: 'pokerCorvina',
  reverend: 'pokerReverend',
  malloy: 'pokerMalloy',
  crumb: 'pokerCrumb',
  quillfeather: 'pokerQuillfeather',
  tuppence: 'pokerTuppence',
  vane: 'pokerVane',
  brisket: 'pokerBrisket',
  mags: 'pokerMags',
} as const satisfies Record<RegularId, SpeakerId>;

const GRUMBLER: BanterPool = {
  sit_down: [
    '"Same chair. Same draft. Same rotten deck."',
    '"Deal. Before I remember I have a home."',
    '"Who left the seat warm? Disgusting."',
  ],
  big_pot_win: [
    '"About time. The deck owed me that since spring."',
    '"Don\'t clap. It\'s my own money coming home."',
    '"Finally. Still down on the decade."',
  ],
  bad_beat: [
    '"Of course. Of course that card came."',
    '"Rigged. Not the deck. The universe."',
    '"I should\'ve stayed in the dungeon. Safer."',
  ],
  bluff_shown: [
    '"Look all you like. You still folded."',
    '"Nothing. I had nothing. Feel bad yet?"',
    '"Air. Pure air. Write that down, genius."',
  ],
  got_bluffed: [
    '"With THAT? The cards here have no shame."',
    '"Robbed. In daylight. By rubbish."',
    '"I\'m filing a complaint with the System."',
  ],
  fold_to_raise: [
    '"Take it. Choke on it."',
    '"Fine. Have the crumbs."',
    '"Not today. Not with this trash."',
  ],
  all_in: [
    '"All of it. Happy now?"',
    '"Everything. Let\'s get this over with."',
    '"There. The whole miserable pile."',
  ],
  needle_player: [
    '"Crawler money spends the same. Thanks."',
    '"Go fight a goblin. You\'re better at that."',
    '"Leave the chips. Take the lesson."',
  ],
  rebuy: [
    '"Again. Don\'t look at me."',
    '"Another stack. My accountant weeps."',
    '"Fresh chips. Same luck, no doubt."',
  ],
  leaving: [
    '"I\'m done. This table\'s cursed."',
    '"Going home to shout at a wall."',
    '"Night. Hope your chairs collapse."',
  ],
  tilted: [
    '"Deal the next one. NOW."',
    '"I am perfectly calm. Shut up."',
    '"Somebody take this deck out back."',
  ],
  card_dead: [
    '"Nine-three. Again. Is it glued?"',
    '"I\'ve seen better hands on a corpse."',
    '"Who shuffled? I want a name."',
  ],
};

const CHARMER: BanterPool = {
  sit_down: [
    '"Darlings! Did you miss me? Don\'t answer."',
    '"Save me a seat by the handsome ones."',
    '"Evening, all. Deuce, you look radiant."',
  ],
  big_pot_win: [
    '"Oh, for me? You shouldn\'t have. Truly."',
    '"Lovely. I\'ll think of you all when I spend it."',
    '"Thank you, thank you. Drinks on nobody."',
  ],
  bad_beat: [
    '"Well! That card has terrible manners."',
    '"Beaten at the last. How very rude."',
    '"Darling, that was cruel. Well played."',
  ],
  bluff_shown: [
    '"A peek, since you\'ve been so sweet."',
    '"Don\'t be cross. It\'s only a game."',
    '"Oops. Nothing at all. Our secret?"',
  ],
  got_bluffed: [
    '"You wicked thing. I\'m almost proud."',
    '"Fooled me! Do it again, I dare you."',
    '"Charming. I\'ll remember that."',
  ],
  fold_to_raise: [
    '"After you, of course. I insist."',
    '"Take it, sweetheart. My treat."',
    '"I yield. Gracefully, as always."',
  ],
  all_in: [
    '"Everything, darling. Let\'s be dramatic."',
    '"All in. Somebody fan me."',
    '"Why not? Life is short. Shorter here."',
  ],
  needle_player: [
    '"Don\'t pout, Crawler. It ruins the face."',
    '"So sorry, love. Not really."',
    '"Lovely playing with you. And beating you."',
  ],
  rebuy: [
    '"More chips, please. I\'m having fun."',
    '"Another stack for the lady of luck."',
    '"Top me up, Deuce. Don\'t tell anyone."',
  ],
  leaving: [
    '"Ta-ta! Don\'t win without me."',
    '"I must fly. Kisses, everyone."',
    '"Goodnight, darlings. Behave."',
  ],
  tilted: [
    '"I\'m smiling. Can\'t you see me smiling?"',
    '"Delightful. Just delightful. Deal."',
    '"No, no, I\'m fine. Utterly fine."',
  ],
  card_dead: [
    '"The cards don\'t love me tonight. Rude."',
    '"Deuce, darling, deal me a real one."',
    '"Another dud. I\'m wasted on this deck."',
  ],
};

const BRAGGART: BanterPool = {
  sit_down: [
    '"Relax, everyone. The champ is here."',
    '"Clear some room. My chips need space."',
    '"Who wants to be a story I tell later?"',
  ],
  big_pot_win: [
    '"And THAT is why they talk about me."',
    '"Stack it high, Deuce. Higher."',
    '"Too easy. Somebody make it hard."',
  ],
  bad_beat: [
    '"Pure luck. Write it down: pure luck."',
    '"I played that perfectly. The deck didn\'t."',
    '"Enjoy it. It won\'t happen twice."',
  ],
  bluff_shown: [
    '"Read \'em and weep. There\'s nothing to read."',
    '"I could win with my eyes closed."',
    '"That\'s a free lesson. You\'re welcome."',
  ],
  got_bluffed: [
    '"I let you have that one. Charity."',
    '"Cute. Very cute. Won\'t work twice."',
    '"Bold. Wrong, but bold."',
  ],
  fold_to_raise: [
    '"I\'ll let you have it. I\'m generous."',
    '"Keep it. I\'m saving myself for a real pot."',
    '"Small fry. Not worth my time."',
  ],
  all_in: [
    '"All in. Watch and learn."',
    '"Every chip. Make it a good story."',
    '"Get the sponsors on the line."',
  ],
  needle_player: [
    '"They\'ll put that one on the highlight reel."',
    '"Stick to the dungeon, Crawler."',
    '"Don\'t feel bad. Everybody loses to me."',
  ],
  rebuy: [
    '"Reload. Champions don\'t walk away."',
    '"A warm-up stack. Now we start."',
    '"Small setback. Big comeback."',
  ],
  leaving: [
    '"I\'ve taken enough. Leave some for you."',
    '"My public awaits."',
    '"Same time tomorrow. Bring more."',
  ],
  tilted: [
    '"I don\'t lose. I\'m between wins."',
    '"Deal. I\'m about to get serious."',
    '"Nobody saw that. Nobody."',
  ],
  card_dead: [
    '"Even my bad cards are better than yours."',
    '"Waiting for the deck to catch up to me."',
    '"Patience. Greatness takes a while."',
  ],
};

const FRETTER: BanterPool = {
  sit_down: [
    '"Is this seat taken? It\'s fine if it is."',
    '"Oh dear. Big blinds. Bigger than last time?"',
    '"I promised myself just one hand. Hello."',
  ],
  big_pot_win: [
    '"Is that mine? Really? Nobody\'s cross?"',
    '"Oh no, oh good, oh my. I won?"',
    '"Don\'t look at me, I\'ll drop it all."',
  ],
  bad_beat: [
    '"I knew it. I KNEW it. I said nothing."',
    '"That\'s the rent. That was the rent."',
    '"Why do I keep coming here?"',
  ],
  bluff_shown: [
    '"I\'m so sorry. I panicked. Sorry."',
    '"Please don\'t be angry. It just happened."',
    '"I can\'t believe that worked. Can you?"',
  ],
  got_bluffed: [
    '"I thought you had it! You looked like it!"',
    '"Oh. Oh no. I\'m such a pigeon."',
    '"I\'m going to think about that all night."',
  ],
  fold_to_raise: [
    '"Too rich for me. Far too rich."',
    '"No, no. Not again. Fold. Folding."',
    '"I\'ll just... yes. Away it goes."',
  ],
  all_in: [
    '"All of it? All of it. Oh, gods."',
    '"I can\'t look. Somebody tell me after."',
    '"This is fine. Is this fine?"',
  ],
  needle_player: [
    '"Sorry! Sorry. Are we still friends?"',
    '"I didn\'t mean to win. Honestly."',
    '"Please don\'t stab me, Crawler."',
  ],
  rebuy: [
    '"Just one more stack. Then home."',
    '"Don\'t tell my mother. Please."',
    '"I\'m chasing it. I know I am."',
  ],
  leaving: [
    '"I should go before I do something silly."',
    '"Bye! Sorry! Thank you! Bye!"',
    '"My nerves have left. I\'m following."',
  ],
  tilted: [
    '"I\'m not crying. It\'s the cigar smoke."',
    '"Why did I sit down? Why does anyone?"',
    '"Breathe. In. Out. Deal, please."',
  ],
  card_dead: [
    '"Is the deck angry with me?"',
    '"Another nothing. Maybe that\'s safer."',
    '"I keep praying and it keeps dealing."',
  ],
};

const DEADPAN: BanterPool = {
  sit_down: ['"Hello."', '"Chips. Chair. Good."', '"I am here now. Proceed."'],
  big_pot_win: [
    '"Mine. Noted."',
    '"That is a lot of chips. Fine."',
    '"Thank you for your contributions."',
  ],
  bad_beat: [
    '"Ah. That card. My old enemy."',
    '"That happened. I saw it happen."',
    '"Good. I had too many chips anyway."',
  ],
  bluff_shown: ['"Nothing. It was nothing."', '"You may look. There is nothing to see."', '"Yes."'],
  got_bluffed: ['"Interesting. I am interested."', '"Huh."', '"Well. That was air."'],
  fold_to_raise: ['"No."', '"Not this one."', '"Pass. Politely."'],
  all_in: ['"All in."', '"All of them. Yes."', '"I would like this to be over."'],
  needle_player: [
    '"You lost. I have been told to say: \'ha\'."',
    '"Better luck. Statistically, anyway."',
    '"Your chips are mine now. Sorry."',
  ],
  rebuy: ['"More."', '"Same again, Deuce."', '"The chips left. I bought more chips."'],
  leaving: ['"I am leaving now."', '"Goodbye. It was a table."', '"Enough cards for one life."'],
  tilted: [
    '"I am upset. You can tell by my face."',
    '"I am going to sigh now."',
    '"Deal. Quickly. Please."',
  ],
  card_dead: [
    '"Another one. Same as the last."',
    '"These cards are cards. Barely."',
    '"I have forgotten what an ace looks like."',
  ],
};

const PHILOSOPHER: BanterPool = {
  sit_down: [
    '"Every hand is a little life. Let\'s live."',
    '"Ah. The felt remembers us all."',
    '"We sit, we bet, we learn nothing."',
  ],
  big_pot_win: [
    '"Fortune visits. She never stays."',
    '"Chips flow downhill. Tonight, to me."',
    '"A gift from the void. I accept."',
  ],
  bad_beat: [
    '"The deck gives. Mostly it takes."',
    '"Even the dungeon is kinder than this deck."',
    '"Loss is a teacher with no lesson plan."',
  ],
  bluff_shown: [
    '"What is a hand, really? Nothing, today."',
    '"You folded to an idea. Ideas are strong."',
    '"Truth is overrated. So is my hand."',
  ],
  got_bluffed: [
    '"I believed. Belief is expensive here."',
    '"Fooled. And yet, wiser. Poorer, too."',
    '"Well played. Doubt is the tax we pay."',
  ],
  fold_to_raise: [
    '"Wisdom is knowing when to leave."',
    '"I release it. Let it go to its home."',
    '"Not every battle is mine."',
  ],
  all_in: [
    '"All things end. Let these chips end too."',
    '"Everything I have. As with all choices."',
    '"Let the cards decide. They always do."',
  ],
  needle_player: [
    '"Losing builds character, Crawler."',
    '"You fight monsters. The deck is worse."',
    '"Do not grieve. Chips were never yours."',
  ],
  rebuy: [
    '"A new stack, a new self."',
    '"From the ashes, more chips."',
    '"Money is a story. I\'ll buy a sequel."',
  ],
  leaving: [
    '"The table goes on. I do not."',
    '"I leave with what I came with: questions."',
    '"Farewell. The cards will miss nobody."',
  ],
  tilted: [
    '"I have become the river. Angry."',
    '"Serenity is a bluff, too."',
    '"Even sages throw chairs sometimes."',
  ],
  card_dead: [
    '"Garbage, dealt with great dignity."',
    '"The cards are telling me something rude."',
    '"Patience. The deck turns, as all things."',
  ],
};

export const POKER_REGULAR_LINES = {
  grumbler: GRUMBLER,
  charmer: CHARMER,
  braggart: BRAGGART,
  fretter: FRETTER,
  deadpan: DEADPAN,
  philosopher: PHILOSOPHER,
} as const satisfies Record<BanterSetId, BanterPool>;

/** `fresh` as a `NonEmpty` pool, or `fallback` when filtering left nothing. */
function freshOrFallback(fresh: readonly string[], fallback: NonEmpty<string>): NonEmpty<string> {
  if (fresh.length === 0) return fallback;
  const [first, ...rest] = fresh;
  return [first, ...rest];
}

/**
 * A line for `regular` speaking in `banterSet` at `trigger`, credited to that
 * regular. Never repeats `lastLine`, the text of the table's previous bubble,
 * so two seats sharing a voice cannot echo each other back to back.
 *
 * @param random A uniform draw in [0, 1); defaults to `Math.random`.
 */
export function pickRegularLine(
  regular: RegularId,
  banterSet: BanterSetId,
  trigger: PokerBanterTrigger,
  lastLine: string | null,
  random: () => number = Math.random,
): BarkLine {
  const pool = POKER_REGULAR_LINES[banterSet][trigger];
  const candidates = freshOrFallback(
    pool.filter((line) => line !== lastLine),
    pool,
  );
  const text = pickLine(candidates, random() * candidates.length);
  return speakerLines(REGULAR_SPEAKERS[regular]).bark(text);
}

/**
 * Small talk while a hand is being played, one pool per voice. The chatter
 * tell raises these: a regular who talks more, or less, depending on what they
 * hold. Like every line here, none hints at how the speaker plays.
 */
export const POKER_CHATTER_LINES = {
  grumbler: [
    '"This chair has a wobble. Every chair has a wobble."',
    '"Is it warm in here or is it just the losing?"',
    '"Somebody act. I\'m not getting younger."',
  ],
  charmer: [
    '"Lovely shuffle, Deuce. Truly artisanal."',
    '"Has anyone told you that hat suits you? Anyone?"',
    '"Such good company tonight. Mostly."',
  ],
  braggart: [
    '"Did I mention I once beat a goblin king at this?"',
    '"Take your time. I\'ve got all night and most of tomorrow."',
    '"Nice table. I\'ve sat at nicer. Not many."',
  ],
  fretter: [
    '"Is that clock fast? It feels fast."',
    '"Sorry. Sorry, was it me? It\'s not me. Right?"',
    '"I should eat something. After this one."',
  ],
  deadpan: ['"Riveting."', '"I am having the time of my life."', '"Another card. How novel."'],
  philosopher: [
    '"Every chip is a small story, briefly told."',
    '"The felt is green so we forget it is a battlefield."',
    '"To wait is also to play."',
  ],
} as const satisfies Record<BanterSetId, NonEmpty<string>>;

/** What a regular "says" when the chatter tell has them fall quiet: a pointed silence. */
export const POKER_QUIET_LINE = '…';

/**
 * A line of small talk for `regular`, credited to that regular, never
 * repeating `lastLine`.
 *
 * @param random A uniform draw in [0, 1); defaults to `Math.random`.
 */
export function pickChatterLine(
  regular: RegularId,
  banterSet: BanterSetId,
  lastLine: string | null,
  random: () => number = Math.random,
): BarkLine {
  const pool = POKER_CHATTER_LINES[banterSet];
  const candidates = freshOrFallback(
    pool.filter((line) => line !== lastLine),
    pool,
  );
  const text = pickLine(candidates, random() * candidates.length);
  return speakerLines(REGULAR_SPEAKERS[regular]).bark(text);
}
