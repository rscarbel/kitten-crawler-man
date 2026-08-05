/**
 * The things you can pick up and read inside the Over City's buildings.
 *
 * A resident tells you what they are willing to say out loud. A ledger, a tally
 * board or a half-burnt letter tells you what nobody meant you to see — which is
 * why every readable here says something its room's occupant does not, and why
 * several of them are simply lists. A list of names is the cheapest horror in
 * the world and this town keeps several.
 *
 * Pure data + selection, the same shape as `townNotices.ts`: no rendering, no
 * audio, no scene coupling. `InteriorReadableSystem` finds a piece of furniture
 * to sit each one on and `ReadablePanel` draws it.
 */

/** The furniture a readable sits on, resolved to real tiles by the owning system. */
export type ReadableAnchor = 'shelf' | 'table' | 'crate';

export interface Readable {
  /** Stable id, so a room can never place the same piece twice. */
  readonly id: string;
  readonly title: string;
  /** Shown under the title in small caps — where the thing physically is. */
  readonly where: string;
  readonly anchor: ReadableAnchor;
  /** Paragraphs, laid out in order down one modal. */
  readonly body: ReadonlyArray<string>;
}

const BUILDING_READABLES: ReadonlyMap<string, ReadonlyArray<Readable>> = new Map([
  [
    "Old Hilda's Cottage",
    [
      {
        id: 'hilda_herbal',
        title: 'A Herbal, Annotated',
        where: 'open on the shelf, spine cracked',
        anchor: 'shelf',
        body: [
          'The printed text describes a marsh root, its preparation, and its use against fever. Every margin is crowded with a second hand in brown ink.',
          '"Not fever. Fever is what the temple calls it because fever is a thing that ends."',
          '"Third year. The root does nothing for the change. It does stop them screaming, which is not nothing."',
          '"Cordwainer\'s wife, second week. Gave her the root. She thanked me and walked out to the west gate and did not come back. I have written her name at the back with the others."',
          'The last leaf has been torn out. Something was written on the page beneath it, hard enough to emboss: a column of names, thirty or forty long.',
        ],
      },
    ],
  ],
  [
    'Blackwood Lodge',
    [
      {
        id: 'lodge_cellar_letter',
        title: 'A Half-Burnt Letter',
        where: 'weighted flat on the duty table',
        anchor: 'table',
        body: [
          'Garrison paper, scorched down one side. The hand is careful and unhurried.',
          '"...the ring below the Lodge is adequate and the soldiers above it are not curious. Continue to meet on the seventh night."',
          '"They are not angels. I have never said they were angels. I have said they are watching, which is true, and that they will reward what they see, which is also true, and the difference has never once mattered to any of them."',
          '"Bring the low-street names only. Nobody counts those. When the count begins we will already be finished."',
          'The signature has burnt away. What is left of the seal is a feather pressed into black wax.',
        ],
      },
    ],
  ],
  [
    'Temple of the Sky',
    [
      {
        id: 'temple_watchers',
        title: 'On the Watchers',
        where: 'chained to the lectern shelf',
        anchor: 'shelf',
        body: [
          'A thin book, copied by hand, the ink faded to the colour of tea.',
          '"They came down before the walls and they did not help. Record this plainly. A doctrine that flatters is a doctrine that will get somebody killed."',
          '"The skyfowl are not birds. They are watchers. A watcher observes; a watcher records; a watcher does not intervene, and is not sorry, and does not lie about it either — which is more than can be said for us."',
          '"Therefore: build the roof. Feed the hungry under it. Expect nothing from above and you will not be disappointed by it."',
          'A newer hand has written under the last line: "Featherfall read this aloud every seventh day for thirty years. Ask yourself who stopped him."',
        ],
      },
    ],
  ],
  [
    "Cartwright's Workshop",
    [
      {
        id: 'cartwright_playbill',
        title: "Playbill — Grimaldi's Travelling Circus",
        where: 'nailed above the bench, gone soft with damp',
        anchor: 'table',
        body: [
          "ONE NIGHT ONLY. GRIMALDI'S TRAVELLING CIRCUS. Eleven wagons, forty performers, and the finest tumbling family on any road.",
          'FEATURING: the Stilt-Men. The Lemurs of the Southern Reach. Heather, the Dancing Bear (do not feed her). Terror the Clown, for the brave only.',
          "AND: the Ringmaster's own daughter, in her first season before the crowd.",
          'Someone has written across the bottom in carpenter\'s pencil: "Paid same day, every time. Asked after my knees. — B.C."',
        ],
      },
    ],
  ],
  [
    "Shepherd's Cabin",
    [
      {
        id: 'shepherd_tally',
        title: 'The Tally Board',
        where: 'chalk on slate, by the door',
        anchor: 'table',
        body: [
          'A slate ruled into columns, one per week. Each column holds a number, written and rubbed out and written again.',
          'Forty-three. Forty-three. Forty-three. Forty-three. Forty-one.',
          'Forty-one, and then forty-one for eleven columns after it, in a hand that presses harder each week.',
          'At the bottom, under the ruling: "GATE WAS SHUT. GATE WAS SHUT. GATE WAS SHUT."',
        ],
      },
    ],
  ],
  [
    'Herb & Remedy',
    [
      {
        id: 'apothecary_ledger',
        title: 'Stock Ledger, Current Quarter',
        where: 'behind the counter, open at today',
        anchor: 'shelf',
        body: [
          'Neat columns: item, source, cost, sold. Most lines are ordinary — honey, marsh root, clean linen, four kinds of moss.',
          'One line repeats down the whole page in a heavier hand: "ANTIDOTE — components: purchased at a loss. Do not raise the price."',
          'Further down, out of the columns entirely: "Fourth request to the magistracy for a survey of the east ground water. No answer. No answer. No answer."',
          'And, dated this week: "Asked to examine a body. Told the guard what I found. Was thanked, and asked not to write it down. Writing it down."',
        ],
      },
    ],
  ],
  [
    'The Sunken Stump Pub',
    [
      {
        id: 'stump_slate',
        title: 'The Slate',
        where: 'hung by the taps, half wiped',
        anchor: 'table',
        body: [
          "Marlow's running tab, names down one side and marks down the other.",
          'Ten names are struck through and paid. Three are not struck through, and beside each of those, instead of a mark, the same three words: "no longer calls."',
          'Someone — not Marlow, the hand is worse — has added at the bottom: "they were not the kind of people anyone writes down"',
          'Under that, in Marlow\'s hand again: "I write them down."',
        ],
      },
    ],
  ],
  [
    'The Sleeping Cat Inn',
    [
      {
        id: 'inn_ledger',
        title: 'The Guest Ledger',
        where: 'open on the counter, quill across it',
        anchor: 'table',
        body: [
          "Names, dates, rooms. Mostly traders. Every so often a line in a different ink, added later, in the innkeeper's hand.",
          '"Room 4 — party of six, came up the stair. Ate everything. Two came back down a week later and would not say where the others were."',
          '"Room 2 — woman, alone, asked to be locked in from the outside. Wrote the request out so I would have it in writing. Fine by morning. Left gold under the plate."',
          '"No room — a cat. Would not be moved off the stool. TALKED. Talked me out of a ham. I am writing this so that when I am old I will know it happened."',
        ],
      },
    ],
  ],
  [
    'The Horned Flagon',
    [
      {
        id: 'flagon_seating',
        title: 'The Seating Book',
        where: 'under the bar, thumbed soft',
        anchor: 'table',
        body: [
          'Not a reservation book — a map. Twenty years of who sits where, drawn and redrawn on tracing leaves laid over one another.',
          "The guild corner. The wool families along the north wall. The magistrate's clerks, seventh night, the two tables by the fire, every leaf for twenty years.",
          "The topmost leaf is nearly empty. The clerks' tables are drawn in and left blank.",
          'In the margin: "6 weeks. Ask B. — no. Do not ask anyone."',
        ],
      },
    ],
  ],
  [
    'The Rusty Anvil',
    [
      {
        id: 'anvil_repair_book',
        title: 'Repair Book',
        where: 'chained to the bench',
        anchor: 'table',
        body: [
          'Every job in and out, fifty years of it, three hands taking over from one another.',
          'The early pages are hinges, plough shares, cart tyres, horseshoes by the dozen. The word "horse" stops appearing about a third of the way in and never returns.',
          'After that it is all edges, and beside each one the smith has noted where the damage was: "notch, high left." "notch, high left." "spine bent, high left."',
          'The last page has a tally of those in the corner, and the number is very large, and it is circled.',
        ],
      },
    ],
  ],
  [
    "Miller's Farm",
    [
      {
        id: 'miller_requisition',
        title: 'Requisition, Office of the Magistrate',
        where: 'spiked on a nail by the door',
        anchor: 'table',
        body: [
          'SIXTEEN SACKS WEEKLY to the garrison at the rate set in the ninth year, the said rate to be reviewed at the pleasure of the office.',
          'The review dates are listed below. There are eleven of them. All eleven have been struck through and marked "deferred".',
          'Across the whole page, in flour-dusted pencil: "Fine. Feed them. Somebody has to."',
          'And smaller, in the corner, almost worn away: "Corvin asked again."',
        ],
      },
    ],
  ],
  [
    'General Store',
    [
      {
        id: 'store_order_book',
        title: 'The Order Book',
        where: 'on the shelf where the clerk left it',
        anchor: 'shelf',
        body: [
          'What the shop has ordered in, month by month, and how fast it went back out.',
          'Rope: steady. Chalk: steady. Lamp oil: steady, steady, steady, and then a single line six weeks ago that empties the column.',
          'Beside that line, in a young hand: "40 candles + all oil. Old coin. Would not sign. Town clothes."',
          'Health potions run out inside a day, every day, and the reorder note has been the same for two years: "double it." It has been doubled four times.',
        ],
      },
    ],
  ],
  [
    'The Barracks',
    [
      {
        id: 'barracks_orders',
        title: 'Standing Orders, Third Floor Garrison',
        where: 'pinned by the door where everyone must pass it',
        anchor: 'table',
        body: [
          'ONE. This room is a safe room. Nothing hostile crosses the threshold. This is not a policy of the garrison; it is a fact of the floor, and it has never failed.',
          'TWO. Any crawler off the stair may take a bunk. No questions, no fee, no limit. We were all off the stair once.',
          'THREE. Nobody goes past the wall alone. Not for a bet, not for a shortcut, not for a lost animal.',
          'FOUR. The floor timer is not a rumour and it is not fixed. Assume it will be shortened. Assume it will be shortened again.',
          'Beneath the orders, in a dozen different hands, a list of names with dates beside them. Some of the dates are very recent.',
        ],
      },
    ],
  ],
  [
    "Signet's Ink",
    [
      {
        id: 'ink_design_book',
        title: 'The Design Book',
        where: 'on the stand beside the chair',
        anchor: 'table',
        body: [
          'Page after page of marks, drawn in a fine confident line: fists, ribs, eyes, serpents, a throat in beaten brass.',
          'Every design has a note under it in the tattooist\'s hand. "Settles in a day." "Argues with the ribs, do not pair." "Wakes when the wearer lies."',
          'One page near the back is different. The line is not the same line — it is better, and it moves very slightly when you are not looking at it directly.',
          'The note under that one says only: "Hers. Do not copy. It would not let me anyway."',
        ],
      },
    ],
  ],
]);

/**
 * Every building this registry names. Walked by the headless check for the same
 * reason `interiorServiceBuildings` is: a readable keyed to a misspelled
 * building never surfaces when the check asks each real building what it holds.
 */
export function readableBuildings(): ReadonlyArray<string> {
  return [...BUILDING_READABLES.keys()];
}

/** Every readable authored for `building`, in the order they should be placed. */
export function readablesFor(building: string): ReadonlyArray<Readable> {
  return BUILDING_READABLES.get(building) ?? [];
}
