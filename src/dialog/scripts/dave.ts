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
  krakaren_clone: say.line(
    "You killed the Krakaren Clone. I'll be honest, I wasn't sure you would. Catch your breath.",
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
    'The two at his door peck and punch. The neck goes back before a peck. Watch for it.',
    'Inside, he fights with a dumbbell. Get close and he swings it like a club. The floor shows you where it passes before it does, so get out of that patch.',
    'Stay well back and he throws it instead. Anywhere in between, he walks you down. Pick a distance and keep it.',
  ]),

  defend_goblin_mother: say.line([
    "If you help her, watch the grates, not the goblins. Whatever's coming climbs out of them.",
    'Hit it as it comes up, before it reaches the little ones.',
  ]),

  krakaren_clone: say.line([
    "A copy's still dangerous. Don't treat it like one.",
    'Watch the floor. When a tentacle starts coming up, move. If the ground under you turns red, move faster. Red floor always means move.',
    "She'll call up smaller tentacles to guard her. The floor cracks first. Kill the small ones first. While they're alive you won't do her much real damage.",
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

  ball_of_swine: say.line([
    "Every boss down here has a trick. This one's a wheel of fused swine. Rolls fast enough to turn you into paste, and it never gets tired.",
    "You won't win just by staying out of its way.",
    "I'll say this much. Nothing's unstoppable when it's got nowhere to go. And that arena's made of iron.",
  ]),

  ball_of_swine_distant: say.line([
    "If you go after that wheel, don't just dodge it. It doesn't get tired. You will.",
    "Nothing's unstoppable when it's got nowhere to go. And that arena's made of iron.",
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
