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

import { cardinalDirection, randomInt } from '../utils';

/** Substituted with the computed bearing before a `bearing` sentence is shown. */
const DIRECTION_PLACEHOLDER = '{direction}';

export interface AdviceObjective {
  readonly id: string;
  readonly complete: boolean;
  /** Tile position the player should head toward. */
  readonly target: { x: number; y: number } | null;
  /**
   * Body text, one entry per dialog page.
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
   */
  readonly bearing: string;
}

/**
 * Two objectives sharing one slot, spoken alternately.
 *
 * A first-class shape rather than a special case inside `nextAdvice`, so the
 * walk over a floor's objectives stays a plain in-order search for the first
 * incomplete one.
 */
export interface AlternatingObjective {
  readonly kind: 'alternating';
  /** Identifies the slot's alternation state across conversations. */
  readonly id: string;
  readonly options: readonly [AdviceObjective, AdviceObjective];
}

export type AdviceSlot = AdviceObjective | AlternatingObjective;

export interface AdviceSnapshot {
  readonly floorNumber: number;
  /**
   * The tile every bearing in this snapshot is measured from.
   *
   * The safe room's own centre in the dungeon, so a floor's two safe rooms point
   * in genuinely different directions at the same boss. On floor 3 Mordecai
   * stands inside the restaurant, whose interior grid has its own origin — so it
   * is the restaurant's door tile there, the one position that exists in both
   * that scene and overworld space.
   */
  readonly bearingOrigin: { x: number; y: number };
  readonly objectives: ReadonlyArray<AdviceSlot>;
}

function isAlternating(slot: AdviceSlot): slot is AlternatingObjective {
  return 'kind' in slot;
}

export class MordecaiAdvisor {
  /** Which of an alternating slot's options is next, keyed by slot id. */
  private readonly nextAlternation = new Map<string, number>();
  private lastFloorNumber: number | null = null;

  /**
   * The pages of the first incomplete objective, or `null` when the floor holds
   * nothing left to point at.
   *
   * Walks the snapshot's objectives **in order**, so a player who has already
   * beaten a higher-priority item simply hears about the next one — no special
   * casing.
   */
  nextAdvice(snapshot: AdviceSnapshot): ReadonlyArray<string> | null {
    // Alternation is per floor: the same advisor instance surviving a floor
    // change would otherwise carry floor 2's slot state into floor 3.
    if (this.lastFloorNumber !== snapshot.floorNumber) {
      this.nextAlternation.clear();
      this.lastFloorNumber = snapshot.floorNumber;
    }

    for (const slot of snapshot.objectives) {
      const objective = this.present(slot);
      if (objective === null) continue;
      return this.render(objective, snapshot.bearingOrigin);
    }
    return null;
  }

  /**
   * Which objective a slot presents now, or `null` when the slot is finished.
   *
   * Advancing the alternation here is safe because `nextAdvice` returns on the
   * first slot that presents anything: a slot that is merely walked past is
   * complete, and a complete alternating slot never reaches the advance.
   */
  private present(slot: AdviceSlot): AdviceObjective | null {
    if (!isAlternating(slot)) return slot.complete ? null : slot;

    const [first, second] = slot.options;
    if (first.complete && second.complete) return null;
    // One left standing pins the slot to it, and deliberately does not advance
    // the alternation — there is nothing to alternate with.
    if (first.complete) return second;
    if (second.complete) return first;

    const stored = this.nextAlternation.get(slot.id);
    const index = stored ?? randomInt(0, slot.options.length - 1);
    this.nextAlternation.set(slot.id, (index + 1) % slot.options.length);
    return slot.options[index];
  }

  private render(
    objective: AdviceObjective,
    bearingOrigin: { x: number; y: number },
  ): ReadonlyArray<string> {
    const pages = [...objective.pages];
    const { target } = objective;
    if (target === null) return pages;

    const bearing = objective.bearing
      .split(DIRECTION_PLACEHOLDER)
      .join(cardinalDirection(bearingOrigin, target));
    if (pages.length === 0) return [bearing];

    const lastIndex = pages.length - 1;
    // Appended to the last page rather than given a page of its own: a page
    // holding one short sentence reads as a dropped line.
    pages[lastIndex] = `${pages[lastIndex]} ${bearing}`;
    return pages;
  }
}

/** Every objective Mordecai has something to say about. */
export type AdviceObjectiveId =
  | 'the_hoarder'
  | 'juicer'
  | 'defend_goblin_mother'
  | 'krakaren_clone'
  | 'spider_lab'
  | 'ball_of_swine'
  | 'the_circus';

interface AdviceText {
  readonly pages: ReadonlyArray<string>;
  readonly bearing: string;
}

/**
 * Mordecai's prose, kept beside the advisor that renders it rather than in the
 * scenes that assemble the snapshot — a scene's job is to answer "is it done and
 * where is it", not to hold half a page of dialog per floor.
 *
 * Every entry ends with the same "another crawler noticed it" framing, phrased so
 * it reads correctly for all eight bearings ("North East of here", not "to the
 * North East side").
 */
const ADVICE_TEXT = {
  the_hoarder: {
    pages: [
      'Start with the Hoarder. It is a neighbourhood boss — one of the easier things down here — and every crawler who has made it past the second floor cut their teeth on it.',
      'It has been dragging every scrap on the floor back into one room, and it fights like something guarding a nest. Keep your distance when it rears up.',
    ],
    bearing: 'I heard another crawler spotted it {direction} of here.',
  },
  juicer: {
    pages: [
      'The Juicer is a step up from the Hoarder. Take it on once you have a level or two on you.',
      'And be careful of the troglodytes on the way. Their tongues are poisonous — never stop moving, because standing still is how you end up wearing it for half a minute.',
    ],
    bearing: 'I heard another crawler spotted it {direction} of here.',
  },
  defend_goblin_mother: {
    pages: [
      'There is a goblin mother down here asking for help holding her brood. Grim work, but it is a great way to get experience.',
    ],
    bearing: 'I heard another crawler spotted her {direction} of here.',
  },
  krakaren_clone: {
    pages: [
      'The Krakaren Clone is a simple enough fight, so long as you avoid the red spots on the floor.',
      'A red spot means that patch is about to take massive damage. See one under your feet and move — do not finish your swing first.',
    ],
    bearing: 'I heard another crawler spotted it {direction} of here.',
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
      'There is a guaranteed stairwell by the Ball of Swine. All you have to do is put down the borough boss and it is yours.',
      'Its rolling attack is lethal — but drop things in its way, the gym equipment, and you will stop it cold.',
    ],
    bearing: 'I heard another crawler spotted it {direction} of here.',
  },
  the_circus: {
    pages: [
      'The circus has come to town, and not for the reason painted on the tent. Have a look, by all means.',
      'But be careful about getting involved in anything over your head.',
    ],
    bearing: 'You can find it {direction} from here.',
  },
} as const satisfies Record<AdviceObjectiveId, AdviceText>;

/** One objective, with its prose looked up and its live state supplied. */
export function adviceObjective(
  id: AdviceObjectiveId,
  complete: boolean,
  target: { x: number; y: number } | null,
): AdviceObjective {
  const { pages, bearing } = ADVICE_TEXT[id];
  return { id, complete, target, pages, bearing };
}
