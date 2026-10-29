/**
 * Dave's words outside the story beats: his tutorial reminders, his
 * congratulations behind each boss, the debrief's gear sentences, and his
 * survival tactics for every objective. Which of these he says, and when, is
 * decided in `daveAdvice.ts`, `daveDebrief.ts` and the tutorial; this file
 * only holds what he says once that choice has been made. Where a thing is
 * and whether it is optional is Caroline's to say (`caroline.ts`).
 */

import { crawlerDisplayName } from '../../characters/characters';
import type { AdviceObjectiveId } from '../../story/adviceObjectiveIds';
import type { DebriefBossType } from '../../core/mobs/debriefBossTypes';
import type { TutorialState } from '../../systems/TutorialController';
import type { DaveLines } from '../../story/storyTypes';
import { speakerLines } from '../line';
import type { DialogLine } from '../line';
import type { SpeakerRef } from '../speakers';

const say = speakerLines('dave');

/** The speaker of a `PendingLine` for the AI chat, which has no line of its own to build from. */
export const DAVE_SPEAKER_REF: SpeakerRef = { kind: 'cast', id: 'dave' };

/** One of his story beats as a line, one page per paragraph. */
export function daveStoryLine(lines: DaveLines): DialogLine {
  return say.line(lines);
}

// ── Tutorial ─────────────────────────────────────────────────────────────────

/**
 * What he says when tapped at each tutorial step: the step's instruction
 * again. Null where the step has a talk of its own or needs nothing from him.
 */
export const DAVE_TUTORIAL_REMINDERS = {
  SEPARATE_ROOMS: null,
  HUMAN_MOVED: null,
  HUMAN_NEAR_GOBLIN: null,
  HUMAN_KILLED_GOBLIN: null,
  HUMAN_GETS_TO_SAFE_ROOM: null,
  HUMAN_TALKED_TO_DAVE: say.line('Your reward chest first. Go on, open it.'),
  HUMAN_OPENED_ACHIEVEMENT: say.line('Set your things up from the inventory menu first.'),
  HUMAN_EQUIPPED_SEISMIC_STOMP: say.line(
    'West to the iron gate. Use Seismic Stomp, slot 1, on the guards behind it.',
  ),
  HUMAN_STOMPED_GUARDS: say.line("The gate's up. Go on through. Your partner's waiting."),
  HUMAN_LEVELED_UP: say.line(
    "You've levelled up. Tap the +1 on your level badge and spend the point. Any stat will do.",
  ),
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  USED_HEALTH_POTION: say.line('Head for the treasure room.'),
  CAT_INSIDE_TREASURE_ROOM: say.line('Open the chest.'),
  CAT_OPENED_TREASURE_BOX: say.line('Equip your new ability from the inventory first.'),
  CAT_EQUIPPED_MAGIC_MISSILE: say.line('Fire your magic missile over the fence at the goblin.'),
  CAT_SHOT_GUARD: null,
  AWAITING_SWITCH_TO_HUMAN: say.line(
    () =>
      `Switch back to ${crawlerDisplayName('human')}. The Switch button, or the switch key on a keyboard.`,
  ),
  SWITCHED_TO_HUMAN: say.line('Use the Follower button. Call the cat over first.'),
  CAT_ARRIVED: null,
  TALKED_TO_DAVE_AGAIN: say.line("The stairwell's just below this room. Go on down."),
  COMPLETE: null,
} as const satisfies Record<TutorialState, DialogLine | null>;

// ── Post-boss debrief ────────────────────────────────────────────────────────

/** His congratulations in the safe room behind each boss; each names the boss as the mob names itself. */
export const DAVE_DEBRIEF_CONGRATS = {
  trash_gremlin: say.line(
    "So. The Trash Gremlin's dead and the two of you aren't. Don't let it go to your heads. It was king of a rubbish heap.",
  ),
  big_rooster: say.line(
    "Big Rooster's down and you're both still standing. That's the right way round. Not how I'd have bet it.",
  ),
  kraken: say.line(
    "The Kraken's dead, and neither of you ended up as shark food. I'll be honest, I wasn't sure. Dry off and catch your breath.",
  ),
  electric_goblin: say.line(
    "The Current Goblin's down and neither of you is smoking. Good. Sit down a minute and let your hair settle.",
  ),
} as const satisfies Record<DebriefBossType, DialogLine>;

/** The sentence opening a crawler's unworn-gear list. */
export function daveDebriefGearFirstSentence(
  crawlerName: string,
  possessive: string,
  itemList: string,
): string {
  return `${crawlerName} has ${itemList} in ${possessive} bag.`;
}

/** The sentence continuing a crawler's unworn-gear list onto a further page. */
export function daveDebriefGearMoreSentence(crawlerName: string, itemList: string): string {
  return `${crawlerName} is also carrying ${itemList}.`;
}

export const DAVE_DEBRIEF_GEAR_CLOSING =
  "Wear what you're carrying. The stat boosts are the point. Gear in a bag does nothing for anyone.";

/** Wraps a fully assembled sequence of debrief pages as one spoken `DialogLine`. */
export function daveSpokenPages(pages: ReadonlyArray<string>): DialogLine | null {
  if (pages.length === 0) return null;
  const [first, ...rest] = pages;
  return say.line([first, ...rest]);
}

// ── Survival tactics ─────────────────────────────────────────────────────────

/**
 * How to survive each objective, as he says it when tapped. Tactics only:
 * where the thing is, what it is and whether it can be skipped come from
 * Caroline's intel for the same objective, so nothing here names a bearing.
 */
export const DAVE_ADVICE = {
  trash_gremlin: say.line([
    "Two things about the gremlin. When its throat starts to glow, it's about to spit acid. Move.",
    "When it shrieks, the roaches come out of the trash piles, not out of the gremlin. Mind which piles you're standing next to.",
    "Under the crown and the noise it's a scrawny little thing. Keep your head and you'll be fine.",
  ]),

  big_rooster: say.line([
    "The two at his door peck and punch. The neck goes back before a peck. Watch for it. And don't roll dynamite at any of them; they kick it straight back.",
    'Inside, he fights with a dumbbell. Get close and he swings it like a club. The floor shows you where it passes before it does, so get out of that patch. Stay well back and he throws it instead.',
    "Once he's hurting, or one of his birds is down, he flings a rack of kettlebells into the air. Watch the floor. The shadows grow before the iron lands, and there's always a gap.",
    "Hurt him enough and he stops feeling it for a bit. He'll kick every exercise ball in the place loose. Keep off him till they're all rolling, then go back to work.",
  ]),

  defend_goblin_mother: say.line([
    "If you help her, watch the grates, not the goblins. Whatever's coming climbs out of them.",
    'Hit it as it comes up, before it reaches the little ones.',
  ]),

  kraken: say.line([
    "Don't waste a swing on her while that room's full. Nothing touches her under the water. Shut the pumps off and drain it first.",
    "Stay on the rafts. The shark circles whichever one you're on. Wait till it's round the far side of its loop, then go. Go early and it'll have you.",
    "Every raft's got a tentacle under it, and it comes up when you climb on. Kill it before you leave, or it'll knock you flat in the water. Can't reach one? Switch to the cat and shoot it.",
    "Once it's dry she fights back. Red floor means a slam. It won't kill you outright, but it takes a big piece out of you. The little tentacles come up out of the drains and they hit hard, so keep an eye on them.",
  ]),

  electric_goblin: say.line([
    "He throws little shock grenades. One for each of you, and a few more wherever he likes. Each one marks the floor where it'll land. Get out of the ring before it comes down.",
    "Keep an eye on the puddles. If he wades into one and lifts both rods, get off the water. When those rods go in, the whole puddle's live. Not him, though. Rubber boots.",
    'Up close he swings a rod and the shock throws you backwards. If he slams both rods down, a wave runs along the floor at where you were standing. Step sideways, not back.',
    "He crosses the rods and swats your missiles away, about half of them. Not while he's winding up, or while he's catching his breath after. Throw then. And light a stick of dynamite if you want to watch him run.",
  ]),

  stealth_gate: say.line([
    "That prison, you sneak through. You can't fight your way past those guards, so don't try.",
    'Stay out of sight, take your time, and get the key.',
  ]),

  spider_lab: say.line(
    "Hear the scientist out before you decide anything. Nothing on the way down needs whatever he's selling.",
  ),

  spider_lab_started: say.line([
    "That lab's one of the harder fights on this floor. Don't go in hurt.",
    'And if the ground looks red, get off it.',
  ]),

  spider_lab_station: say.line([
    "Have a seat. The cot's less comfortable than it looks.",
    "Whatever the scientist wants, it's at the end of that hallway. You don't have to go. I'd think about it, if I were you.",
  ]),

  krasue_murders: say.line([
    "I'd stay out of it. You won't, I know.",
    'So ask questions before you swing at anything, and keep your partner close.',
  ]),

  shady_bounties: say.line(
    "The money's real, and the targets are out where nobody minds the noise. Take the ones you can handle. Leave the rest.",
  ),

  anchor_offer: say.line("If you're tired of the walk, hear the fortune teller out."),

  anchor_stone: say.line(
    "Use that stone. It needs a breather between uses, so don't plan on bouncing back and forth with it.",
  ),

  speed_fizz_tip: say.line(
    'Speed Fizz is for getting out, not getting in. Keep one for when a fight goes wrong.',
  ),
} as const satisfies Record<AdviceObjectiveId, DialogLine>;
