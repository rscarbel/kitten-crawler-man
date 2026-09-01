/**
 * What Mordecai tells the player is still worth doing on this floor.
 *
 * Pure logic: no canvas, no scene imports, no map access. It is handed a
 * snapshot of what is and is not done and returns the pages of a dialog, so the
 * scenes stay the only thing that knows how to read the live systems.
 *
 * The advisor is the middle rank of three sources, in this order:
 *
 *     tutorial (if it handles it) → floor advice (if any objective remains) → AI chat
 *
 * Floor advice is deterministic and needs no server, so it answers "what's left
 * to do" reliably; returning `null` once everything is done is what hands a
 * cleared floor back to the AI chat for flavour.
 */

import { cardinalDirection } from '../utils';

/** Substituted with the computed bearing before a `bearing` sentence is shown. */
const DIRECTION_PLACEHOLDER = '{direction}';

export interface AdviceObjective {
  readonly id: string;
  readonly complete: boolean;
  /** Tile position the player should head toward. */
  readonly target: { x: number; y: number } | null;
  /**
   * Body text, one entry per dialog page. May contain `{direction}`.
   *
   * Paged by the author rather than split by the advisor: the dialog box is
   * about six lines tall and narrows with the canvas, so a sentence-splitting
   * heuristic would decide where the break falls on a phone and get it wrong.
   */
  readonly pages: ReadonlyArray<string>;
  /**
   * Closing sentence naming the bearing, with `{direction}` substituted. Dropped
   * entirely when `target` is `null` — the map fields it comes from are optional
   * types, and a missing one must not print `undefined` at the player.
   *
   * Absent on objectives whose pages already say where the thing is: the pinned
   * gateway speeches are spoken in the room immediately before the boss, where
   * "another crawler spotted it" would be absurd.
   */
  readonly bearing?: string;
  /**
   * Content the floor never requires of the player.
   *
   * Kept in walking order in its floor's list — Mordecai should raise the
   * nursery when the party is walking past the nursery — but stepped over while
   * anything the floor *does* require is still outstanding. An optional
   * objective a player is simply not interested in is never completed, and the
   * advice walk stops at the first unfinished entry, so without this one
   * declined side quest would silence every word he has about the boss beyond
   * it for the rest of the floor.
   */
  readonly optional?: boolean;
}

export type AdviceSlot = AdviceObjective;

export interface AdviceSnapshot {
  readonly floorNumber: number;
  /**
   * The tile every bearing in this snapshot is measured from.
   *
   * The safe room's own centre in the dungeon, so a floor's two safe rooms point
   * in genuinely different directions at the same boss. On floor 3 Mordecai
   * stands inside the town's safe-room building, whose interior grid has its
   * own origin — so it is that building's door tile there, the one position
   * that exists in both that scene and overworld space.
   */
  readonly bearingOrigin: { x: number; y: number };
  readonly objectives: ReadonlyArray<AdviceSlot>;
}

export class MordecaiAdvisor {
  /**
   * The pages of the first incomplete objective, or `null` when the floor holds
   * nothing left to point at.
   *
   * Walks the snapshot's objectives **in order**, so a player who has already
   * beaten a higher-priority item simply hears about the next one — no special
   * casing.
   */
  nextAdvice(snapshot: AdviceSnapshot): ReadonlyArray<string> | null {
    const unfinished = snapshot.objectives.filter((objective) => !objective.complete);
    if (unfinished.length === 0) return null;
    const next = unfinished.find((objective) => objective.optional !== true) ?? unfinished[0];
    return this.render(next, snapshot.bearingOrigin);
  }

  /**
   * Renders one specific objective, bypassing the "first incomplete" walk.
   *
   * A gateway safe room speaks about the boss it guards and nothing else, so it
   * needs to name its objective rather than take whatever is next in the floor's
   * ordering.
   */
  renderObjective(
    objective: AdviceObjective,
    bearingOrigin: { x: number; y: number },
  ): ReadonlyArray<string> {
    return this.render(objective, bearingOrigin);
  }

  private render(
    objective: AdviceObjective,
    bearingOrigin: { x: number; y: number },
  ): ReadonlyArray<string> {
    const { target } = objective;
    if (target === null) return [...objective.pages];

    const direction = cardinalDirection(bearingOrigin, target);
    const pages = objective.pages.map((page) => page.split(DIRECTION_PLACEHOLDER).join(direction));
    if (objective.bearing === undefined) return pages;

    const bearing = objective.bearing.split(DIRECTION_PLACEHOLDER).join(direction);
    if (pages.length === 0) return [bearing];

    const lastIndex = pages.length - 1;
    // Appended to the last page rather than given a page of its own: a page
    // holding one short sentence reads as a dropped line.
    pages[lastIndex] = `${pages[lastIndex]} ${bearing}`;
    return pages;
  }
}

/** The four gateway bosses whose speech is pinned to the safe room guarding them. */
const GATEWAY_ADVICE_IDS = ['the_hoarder', 'juicer', 'krakaren_clone', 'ball_of_swine'] as const;

/** A boss whose speech belongs to the safe room guarding it. */
export type GatewayAdviceId = (typeof GATEWAY_ADVICE_IDS)[number];

/** Every objective Mordecai has something to say about. */
export type AdviceObjectiveId =
  | 'the_hoarder'
  | 'juicer'
  | 'defend_goblin_mother'
  | 'krakaren_clone'
  | 'spider_lab'
  | 'ball_of_swine'
  | 'ball_of_swine_distant'
  | 'the_circus'
  | 'krasue_murders'
  | 'shady_bounties'
  | 'anchor_offer'
  | 'anchor_stone'
  | 'speed_fizz_tip';

interface AdviceText {
  readonly pages: ReadonlyArray<string>;
  readonly bearing?: string;
}

/**
 * Mordecai's prose, kept beside the advisor that renders it rather than in the
 * scenes that assemble the snapshot — a scene's job is to answer "is it done and
 * where is it", not to hold half a page of dialog per floor.
 *
 * Entries with a `bearing` end with the same "another crawler noticed it"
 * framing, phrased so it reads correctly for all eight bearings ("North East of
 * here", not "to the North East side"). The gateway speeches carry no bearing:
 * they are spoken in the room immediately before their boss, so they say where
 * it is themselves.
 */
const ADVICE_TEXT = {
  the_hoarder: {
    pages: [
      "There's a boss through the hallway {direction}. Once you enter her territory, the fight will begin. That's how the dungeon likes to do things.",
      "If you're looking for the stairwell, you'll have to deal with her. There may be other bosses waiting for you as well, but this is the one in your way.",
      "Keep your head. She's a neighborhood boss, which puts her toward the bottom of the food chain. She shouldn't be too difficult.",
    ],
  },

  juicer: {
    pages: [
      "There's another boss ahead, {direction} of here. You won't be able to avoid him if you're heading that way. He's another neighborhood boss, though this one looks a little nastier.",
      "I can't give you much more than that. I can tell you to watch his minions, the Troglodytes.",
      "They attack with their tongues. The poison they carry is quite unpleasant. Getting hit isn't necessarily fatal, but I'd prefer not to find out how many hits you can take.",
      "They're slow. Keep moving and don't let them corner you.",
    ],
  },

  defend_goblin_mother: {
    pages: [
      "The way forward runs through a goblin nursery. There's a mother in there with her young, and something is coming up through the floor grates at them.",
      "You can walk straight past her or help. Do it or don't. Whatever crawls out of those grates is worth experience to somebody.",
    ],
    bearing: 'Another crawler spotted the nursery {direction} of here.',
  },

  krakaren_clone: {
    pages: [
      "There's a Krakaren Clone just {direction} of here. It's a copy of the Krakaren who once existed in this dungeon. A copy is still dangerous, so don't make the mistake of treating it like one.",
      "Krakaren is loud and difficult to miss, but don't let that distract you from her attacks. Watch the floor. When a tentacle starts coming up, move. If the ground beneath you turns red, move faster.",
      "She'll summon smaller tentacles to protect herself. You'll see the floor crack before they appear. Kill those first. While they're alive, you're going to have a difficult time doing any real damage to her.",
      "Krakaren is also a rather... politically complicated figure. We don't have time for that conversation right now.",
    ],
  },

  spider_lab: {
    pages: [
      'Something has gone wrong with the Arachnid Experiments. You should probably deal with it before whatever is happening in that room finds a way to become your problem somewhere else.',
      "It's one of the more difficult encounters on this floor. Watch the ground. When you see red, don't stand in it.",
    ],
    bearing: 'Another crawler spotted the lab {direction} of here.',
  },

  ball_of_swine: {
    pages: [
      "There's a borough boss ahead, {direction} of here. It's considerably tougher than the fights you've dealt with so far. You can avoid it, if you're willing to look for another way around.",
      "If you kill it, though, you'll be guaranteed a stairwell to the next floor.",
      "Every boss in this dungeon has a trick. This one is a wheel made from fused swine. It rolls fast enough to turn you into paste, and it doesn't get tired. Trying to beat it by simply staying out of its way won't work.",
      "That's all I'm going to tell you. I will say this, though: nothing is unstoppable when it has nowhere to go. And that arena is made of iron.",
    ],
  },

  ball_of_swine_distant: {
    pages: [
      'Somewhere in these halls is a large iron arena. Inside it is a borough boss, a wheel made from fused swine. Borough bosses are considerably tougher than anything else on their floor, but killing one guarantees a stairwell down.',
      "It's entirely optional. If you'd rather keep all your bones where they currently are, you're free to find another way.",
    ],
    bearing: 'Another crawler marked the arena {direction} of here.',
  },

  the_circus: {
    pages: [
      "The circus has come to town. Given the dungeon, I wouldn't assume that's good news.",
      "You can have a look if you want. Just be careful about getting involved in anything you don't understand.",
    ],
    bearing: "It's {direction} of here.",
  },

  krasue_murders: {
    pages: [
      "People have been turning up in pieces. Not necessarily the pieces they started with, either. The city guard thinks it's a wild animal. It isn't.",
      "I'd recommend staying away from it. Of course, I know better than to expect you to take that advice.",
    ],
    bearing: 'The killings started {direction} of here, if you insist on looking into them.',
  },

  shady_bounties: {
    pages: [
      "There's a man by the notice board offering money for killing things out in the ruins. He doesn't give his name. That's probably for the best.",
      "The money is real, at least. The targets are out where nobody cares how much noise you make. By the standards of this place, it's practically honest work.",
    ],
    bearing: 'He usually loiters {direction} of here.',
  },

  anchor_offer: {
    pages: [
      "There's a fortune teller in the plaza who claims she can get you home faster than walking. If you're tired of the trip, you might want to hear what she has to say.",
    ],
    bearing: 'Her table is {direction} of here.',
  },

  anchor_stone: {
    pages: [
      "That stone Madame Voss made for you isn't decorative. Use it somewhere in the city and it'll pull your entire party back to the town square. Use it in the square, and it'll take you back to wherever you were standing before.",
      "It needs a little time to recover between uses. Don't expect to bounce back and forth with it indefinitely.",
    ],
  },

  speed_fizz_tip: {
    pages: [
      "The tinker sells something called Speed Fizz. Drink it and you'll move twice as fast for twenty-five seconds. Try not to waste it.",
    ],
    bearing: 'His stall is {direction} of here.',
  },
} as const satisfies Record<AdviceObjectiveId, AdviceText>;

/**
 * Narrows a safe room's `guardsBossType` to the objective whose prose it pins.
 *
 * The tag is a mob type string carried on the map, so the two vocabularies have
 * to be reconciled somewhere; they happen to agree on all four gateway bosses.
 */
export function gatewayAdviceId(bossType: string | undefined): GatewayAdviceId | null {
  if (bossType === undefined) return null;
  for (const id of GATEWAY_ADVICE_IDS) {
    if (id === bossType) return id;
  }
  return null;
}

/** One objective, with its prose looked up and its live state supplied. */
export function adviceObjective(
  id: AdviceObjectiveId,
  complete: boolean,
  target: { x: number; y: number } | null,
): AdviceObjective {
  const text: AdviceText = ADVICE_TEXT[id];
  return { id, complete, target, pages: text.pages, bearing: text.bearing };
}

/** The same, for content the floor offers rather than demands. See `optional`. */
export function optionalAdviceObjective(
  id: AdviceObjectiveId,
  complete: boolean,
  target: { x: number; y: number } | null,
): AdviceObjective {
  return { ...adviceObjective(id, complete, target), optional: true };
}
