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
    for (const objective of snapshot.objectives) {
      if (objective.complete) continue;
      return this.render(objective, snapshot.bearingOrigin);
    }
    return null;
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
  | 'shady_bounties';

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
      "Through the hallway {direction} of this room is a boss. The dungeon contains boss fights that will commence once you are in the boss's area.",
      "In order to find the stairwell, it looks like you'll have no choice but to face up against this and potentially other bosses.",
      'Just keep a cool head. She is a neighborhood boss, the weakest kind of boss, and she looks like a simple one.',
    ],
  },
  juicer: {
    pages: [
      "I see we have another boss that there's no way you can avoid — his den lies {direction} of here. Fortunately, this one is also just a neighborhood boss, but this one looks a little tougher.",
      "I'm not allowed to tell you any details, but what I can say is be careful of his minions, the Troglodytes.",
      "Troglodytes lash you with their tongues, which contains a deadly poison. You do not want to get hit with that or there's a solid chance you'll find that your journey ends here.",
      "Troglodytes are pretty slow, so maybe don't stop moving and you'll be fine.",
    ],
  },
  defend_goblin_mother: {
    pages: [
      'There is a goblin mother down here asking for help holding her brood. Grim work, but it is a great way to get experience.',
    ],
    bearing: 'I heard another crawler spotted her {direction} of here.',
  },
  krakaren_clone: {
    pages: [
      "I see a Krakaren Clone just {direction} of here. It is just a copy of the Krakaren boss, which really existed in this dungeon, but don't underestimate it nonetheless.",
      "Krakaren may be noisy and obviously visible, but she has very powerful attacks. Watch for a tentacle rising out of the floor before she slams it down — if the ground below you turns red too, that is a signal that you may want to move or you'll die.",
      "She'll also drag up smaller tentacles to guard herself while you fight — you'll see the floor crack open first. While one of those things is still alive your blows barely scratch her, so cut it down before you go back to hitting the big one.",
      "Krakaren is a very politicized figure here, but there's not really time to get into all that for now.",
    ],
  },
  spider_lab: {
    pages: [
      'Something is going wrong with the Arachnid Experiments. Worth looking into before the problem spreads any further than that room.',
      'It is among the harder things on this floor, mind. Watch for the red zones on the ground and get out of the way of them.',
    ],
    bearing: 'I heard another crawler spotted it {direction} of here.',
  },
  ball_of_swine: {
    pages: [
      "Up ahead, {direction} of this room, is a borough boss. That means it's tougher than the other fights you've had so far. However, it looks like you also have the option to ignore it and go around to see if you can find a different stairwell or find other challenges.",
      "If you can beat this boss, you're guaranteed a stairwell to the next floor.",
      'Bosses in this dungeon always have a secret to beating them. This one is a wheel of fused swine that rolls fast enough to break a crawler in half, and it never once slows down of its own accord. Do not try to out-last it.',
      'That is as much as I will say. But I will note that a wheel is only unstoppable while nothing gets in its way, and that the walls of that place are iron.',
    ],
  },
  ball_of_swine_distant: {
    pages: [
      'Somewhere out in these halls stands a great iron arena, and a borough boss rolls inside it — a wheel of fused swine. Borough bosses are tougher than anything else on their floor, but beat one and you are guaranteed a stairwell down.',
      'It is entirely optional, mind. If you would rather keep your bones arranged the way they are, no one here will judge you.',
    ],
    bearing: 'Another crawler marked the arena {direction} of here.',
  },
  the_circus: {
    pages: [
      'The circus has come to town, and not for the reason painted on the tent. Have a look, by all means.',
      'But be careful about getting involved in anything over your head.',
    ],
    bearing: 'You can find it {direction} from here.',
  },
  krasue_murders: {
    pages: [
      'People have been turning up in pieces, and the pieces are the wrong ones. The city guard has decided it is a wild animal. It is not a wild animal.',
      'I would leave it well alone, and I know perfectly well that you will not.',
    ],
    bearing: 'It started {direction} of here, if you insist.',
  },
  shady_bounties: {
    pages: [
      'There is a man by the notice board who will pay you to go and kill something out in the ruins. He will not tell you his name and I would not believe it if he did.',
      'The coin is real, though, and the marks are out where nobody minds the noise. It is honest work by the standards of this place.',
    ],
    bearing: 'He loiters {direction} of here.',
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
