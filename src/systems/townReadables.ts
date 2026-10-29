/**
 * The things you can pick up and read inside Taloncrest's buildings.
 *
 * A resident tells you what they are willing to say out loud. A ledger, a tally
 * board or a half-burnt letter tells you what nobody meant you to see — which is
 * why every readable here says something its room's occupant does not, and why
 * several of them are simply lists. A list of names is the cheapest horror in
 * the world and this town keeps several.
 *
 * Pure data + selection, the same shape as `townNotices.ts`: no rendering, no
 * audio, no scene coupling. `InteriorReadableSystem` finds a piece of furniture
 * to sit each one on and `ReadableOverlay` draws it.
 */

import type { BuildingId, PlannedBuildingId } from '../map/buildingIds';

/** The furniture a readable sits on, resolved to real tiles by the owning system. */
export type ReadableAnchor = 'shelf' | 'table' | 'crate' | 'board';

/**
 * What the piece is physically made of, which decides the sound of picking it
 * up: a bound book's page turns, a loose sheet unfolds, and a chalked slate or
 * lettered board makes neither.
 */
export type ReadableMedium = 'book' | 'sheet' | 'board';

export interface Readable {
  /** Stable id, so a room can never place the same piece twice. */
  readonly id: string;
  readonly title: string;
  /** Shown under the title in small caps — where the thing physically is. */
  readonly where: string;
  readonly anchor: ReadableAnchor;
  readonly medium: ReadableMedium;
  /** Paragraphs, laid out in order down one modal. */
  readonly body: ReadonlyArray<string>;
}

const BUILDING_READABLES: ReadonlyMap<BuildingId, ReadonlyArray<Readable>> = new Map([
  [
    'taloncrest_old_lady_cottage',
    [
      {
        id: 'lori_herbal',
        title: 'A Herbal, Annotated',
        where: 'open on the shelf, spine cracked',
        anchor: 'shelf',
        medium: 'book',
        body: [
          'The printed text describes a marsh root, its preparation, and its use for those who cannot sleep. Every margin is crowded with a second hand in brown ink.',
          '"For the ones who came back out of the fray. They walk in at night and stand at their old doors, and they cannot rest, and neither can anybody who knew them."',
          '"Third year. The root does nothing for the change. It does stop them screaming, which is not nothing."',
          '"Cordwainer\'s wife, back the second week. Gave her the root. She thanked me and walked out to the west gate and did not come back. I have written her name at the back with the others."',
          'The last leaf has been torn out. Something was written on the page beneath it, hard enough to emboss: a column of names, thirty or forty long.',
        ],
      },
    ],
  ],
  [
    'taloncrest_garrison_lodge',
    [
      {
        id: 'lodge_cellar_letter',
        title: 'A Half-Burnt Letter',
        where: 'weighted flat on the duty table',
        anchor: 'table',
        medium: 'sheet',
        body: [
          'Garrison paper, scorched down one side. The hand is careful and unhurried.',
          '"...the ring below the Lodge is adequate and the soldiers above it are not curious. Continue to meet on the seventh night, and keep the candles below the grate."',
          '"She chooses whom she speaks to. She has never once chosen us, and we have stopped waiting to be chosen. A trinket earns a glance. A lock of hair earns a longer one. You all know what earns the rest."',
          '"Let the carriers keep their dead weight. We went down when they went up, and we came back knowing whose hand it was."',
          'The signature has burnt away. What is left of the seal is pressed into black wax: an open eye above a cupped hand.',
        ],
      },
    ],
  ],
  [
    'taloncrest_temple',
    [
      {
        id: 'temple_carrying',
        title: 'On the Carrying',
        where: 'chained to the lectern shelf',
        anchor: 'shelf',
        medium: 'book',
        body: [
          'A thin book, copied by hand, the ink faded to the colour of tea.',
          '"When the Fraying came, the ground came apart under the old city, and we flew. Record this plainly, so that no wing forgets it: we lifted what could be lifted, and we could not lift enough."',
          '"Carry what the ground cannot. Set it down gently. Take no fee for the first carry, whoever asks it of you."',
          '"Remember every name you could not lift. They are written at the back of this book, and the book is chained to the shelf so that nobody carries them off."',
          '"Whoever reads this aloud on the seventh day, read the names after it. All of them. The roost can wait."',
        ],
      },
    ],
  ],
  [
    'taloncrest_crafting_house',
    [
      {
        id: 'cartwright_playbill',
        title: 'Playbill — The Travelling Circus',
        where: 'nailed above the bench, gone soft with damp',
        anchor: 'table',
        medium: 'sheet',
        body: [
          'ONE NIGHT ONLY, UNDER THE STARLIGHT TENT. Eleven wagons, forty performers, and the finest tumbling family on any road.',
          'TEST YOUR ARM at the High Striker: ring the bell and take home a prize. Clowns on the midway, fire and spotlights in the ring.',
          'AND, for the first time before any crowd: THE HALL OF MIRRORS. Find the way through, if you can find yourself.',
          'Someone has written across the bottom in carpenter\'s pencil: "Paid same day, every time. Asked after my knees. — S.C."',
        ],
      },
    ],
  ],
  [
    'taloncrest_builder_farm',
    [
      {
        id: 'wendell_milk_rounds',
        title: 'Milk Rounds',
        where: 'a slate, propped where he eats',
        anchor: 'table',
        medium: 'board',
        body: [
          'A slate ruled into a grid with a straightedge: the houses he delivered to down one side, the days of the week across the top.',
          'The Sleeping Cat, four churns a morning. The Horned Flagon, three. The Sunken Stump, one, "and the empty to be returned this time."',
          'Every figure has been struck through with a single level line, each the same length as the last.',
          'Underneath, in the same careful hand: "Rounds suspended until further notice." The last three words have since been wiped away, and nothing written in their place.',
        ],
      },
    ],
  ],
  [
    'taloncrest_apothecary',
    [
      {
        id: 'apothecary_ledger',
        title: 'Stock Ledger, Current Quarter',
        where: 'behind the counter, open at today',
        anchor: 'shelf',
        medium: 'book',
        body: [
          'Neat columns: item, source, cost, sold. Most lines are ordinary — honey, marsh root, clean linen, four kinds of moss.',
          'One line repeats down the whole page in a heavier hand: "ANTIDOTE — components: purchased at a loss. Do not raise the price."',
          "Further down, out of the columns entirely, a list of dates: every storm this year, and beside each one how many paces the ruins' edge had shifted by morning. The last figure is underlined twice.",
          'And, dated this week: "Asked to examine a body. Told the guard what I found. Was thanked, and asked not to write it down. Writing it down."',
        ],
      },
    ],
  ],
  [
    'taloncrest_pub',
    [
      {
        id: 'stump_slate',
        title: 'The Slate',
        where: 'hung by the taps, half wiped',
        anchor: 'table',
        medium: 'board',
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
    'taloncrest_inn',
    [
      {
        id: 'inn_ledger',
        title: 'The Guest Ledger',
        where: 'open on the counter, quill across it',
        anchor: 'table',
        medium: 'book',
        body: [
          "Names, dates, rooms. Mostly traders. Every so often a line in a different ink, added later, in the innkeeper's hand.",
          '"Room 4 — party of six, came up the stair. Ate everything. Two came back down a week later and would not say where the others were."',
          '"Room 2 — woman, alone, asked to be locked in from the outside. Wrote the request out so I would have it in writing. Fine by morning. Left gold under the plate."',
          '"No room — a cat. Would not be moved off the stool. TALKED. Talked me out of a ham. I am writing this so that when I am old I will know it happened."',
        ],
      },
      {
        id: 'inn_tariff_board',
        title: 'The Tariff Board',
        where: 'propped on the guest-room shelf, so nobody argues the bill',
        anchor: 'shelf',
        medium: 'board',
        body: [
          'A plank of chalked slate, ruled into three rows in a careful hand.',
          'THE ATTIC COT. Four to a room, straw, one candle. Cheapest bed on the floor and the innkeep says so out loud.',
          'THE HEARTHSIDE ROOM. Its own fire, laid before dusk. "Worth it in the wet months. Do not argue, just take it."',
          "THE CAT'S OWN ROOM. The shelf, the good brazier, the door that bolts from both sides. The price has been rubbed out and written again four times, each larger than the last.",
          'Under the rows, not chalk but paint, and older than the rest of the board: "NOTHING HOSTILE CROSSES THIS THRESHOLD. Nobody has to pay for that part."',
        ],
      },
    ],
  ],
  [
    'taloncrest_flagon_tavern',
    [
      {
        id: 'flagon_seating',
        title: 'The Seating Book',
        where: 'under the bar, thumbed soft',
        anchor: 'table',
        medium: 'book',
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
    'taloncrest_smithy',
    [
      {
        id: 'anvil_repair_book',
        title: 'Repair Book',
        where: 'chained to the bench',
        anchor: 'table',
        medium: 'book',
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
    'taloncrest_mill_farm',
    [
      {
        id: 'miller_requisition',
        title: 'Requisition, Office of the Magistrate',
        where: 'spiked on a nail by the door',
        anchor: 'table',
        medium: 'sheet',
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
    'taloncrest_general_store',
    [
      {
        id: 'store_order_book',
        title: 'The Order Book',
        where: 'on the shelf where the clerk left it',
        anchor: 'shelf',
        medium: 'book',
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
    'taloncrest_barracks',
    [
      {
        id: 'barracks_orders',
        title: 'Standing Orders, Third Floor Garrison',
        where: 'nailed to the muster board, four sheets deep',
        anchor: 'board',
        medium: 'sheet',
        body: [
          'ONE. This is not a safe room and no soldier is to tell a crawler otherwise. The room that cannot be argued with is the Sleeping Cat Inn. Send them there and stop sending them here.',
          'TWO. Nobody goes past the wall alone. Not for a bet, not for a shortcut, not for a lost animal.',
          'THREE. The sand is open to any crawler off the stair. Free of charge, and worth what you put into it.',
          'FOUR. The floor timer is not a rumour and it is not fixed. Assume it will be shortened. Assume it will be shortened again.',
          'Beneath the orders, the current postings: nineteen names in four watches, and a fifth watch ruled out with a line through it and nothing written underneath.',
          'Under that, in a dozen different hands, a longer list with dates beside it. Some of the dates are very recent.',
        ],
      },
      {
        id: 'barracks_map_table',
        title: 'The Floor Map',
        where: 'pinned flat under counters and a broken rule',
        anchor: 'table',
        medium: 'sheet',
        body: [
          'The third floor as the garrison understands it, drawn over four times and corrected in three inks.',
          'The wall is drawn heavy and confident. Everything outside it is a guess, and the guesses get thinner the further out they go.',
          'Wooden counters mark the patrols. Twelve of them sit inside the wall. Four sit outside it and have not been moved in six weeks, and nobody has taken them off the map.',
          'In the far corner, well past the last drawn road, somebody has inked a small neat circle with no label on it at all.',
          'Beside the circle, in a different hand: "this is where they come from. do not put a counter here. i will not have men standing on it."',
        ],
      },
    ],
  ],
  [
    'taloncrest_tattoo_parlor',
    [
      {
        id: 'ink_design_book',
        title: 'The Design Book',
        where: 'on the stand beside the chair',
        anchor: 'table',
        medium: 'book',
        body: [
          'Page after page of marks, drawn in a fine confident line: fists, ribs, eyes, serpents, a throat in beaten brass.',
          'Every design has a note under it in the tattooist\'s hand. "Settles in a day." "Argues with the ribs, do not pair." "Wakes when the wearer lies."',
          'One page near the back is different. The line is not the same line — it is better, and it moves very slightly when you are not looking at it directly.',
          'The note under that one says only: "Hers. Do not copy. It would not let me anyway."',
        ],
      },
      {
        id: 'needle_price_board',
        title: 'The Board of Rates',
        where: 'propped against the pigment jars, lettered in four inks',
        anchor: 'shelf',
        medium: 'board',
        body: [
          'A slate in a good hand, and the prices are not the interesting part.',
          'STAT MARK — one hundred. ONE PER SKIN. This is not a haggle and it is not a rule of the house, it is a rule of the ink.',
          'THROAT MARK, BRASS — two hundred and fifty. Separate from the above. Do not ask me to explain how, I only know that the two of them ignore each other.',
          'COVER-UP — no. REMOVAL — no. SECOND MARK — no.',
          'At the bottom, scratched smaller, without a price beside it: "Anything I will not put on you is on the last page of the design book and you may not read that page."',
        ],
      },
      {
        id: 'needle_customer_ledger',
        title: "The Customer's Ledger",
        where: 'open on the work table, weighted with a muller',
        anchor: 'table',
        medium: 'book',
        body: [
          'Names, dates, marks, and a fourth column with no heading on it.',
          'Most of the fourth column is blank. Where it is not blank it says a floor number, and every number is lower than the one on the line above it.',
          'Thirty-one lines in, the hand changes: the letters get smaller and the entries get shorter, and the fourth column starts being filled in on the same day the mark was cut.',
          '"Cutler, ribs, boar. 4." "Halbrook, forearm, eye. 4." "Nissa, throat, brass. 4."',
          'The last twelve lines have no fourth column at all, and one of them has been gone over so many times the parchment has given way.',
        ],
      },
    ],
  ],
] satisfies ReadonlyArray<readonly [PlannedBuildingId, ReadonlyArray<Readable>]>);

/** Every building with readables authored, for the gallery and the headless check. */
export function readableBuildings(): ReadonlyArray<BuildingId> {
  return [...BUILDING_READABLES.keys()];
}

/** Every readable authored for `building`, in the order they should be placed. */
export function readablesFor(building: BuildingId): ReadonlyArray<Readable> {
  return BUILDING_READABLES.get(building) ?? [];
}
