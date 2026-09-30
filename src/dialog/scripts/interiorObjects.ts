/**
 * Words for the things a building's furniture lets you do besides stand
 * near them: a short look at an object (`examine`), what a container gives
 * up the first time it's opened (`search`), what a bell or a bowl does when
 * used (`use`), and what a room says back when something in it breaks.
 *
 * Kept separate from `townReadables.ts` on purpose: a readable is a document
 * someone wrote, paged like a letter; these are one-line reactions to poking
 * at the furniture itself, and never carry the load-bearing plot text a
 * readable does.
 */

import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import type {
  TownInteriorExamineId,
  TownInteriorSearchId,
  TownInteriorUseId,
} from '../../sprites/art/townInterior/townInteriorProps';

const narrator = speakerLines('narrator');

/** A short look at an object with nothing to search or use — `TownInteriorInteraction`'s `'examine'` id. */
export const EXAMINE_LINES = {
  jars: narrator.bark('Sealed clay jars, unlabeled. Whatever is in them has gone sharp with age.'),
  price_board: narrator.bark(
    'Rope, lamp oil, chalk, candles, pots, nails, flour and salt, cloth, tools — a price chalked beside each, rubbed and rewritten more than once.',
  ),
  /**
   * Echoes the one candle-purchase clue already written into Wick's own
   * `reactive` lines in `residents.ts` — no new fact is added here, only the
   * ledger entry he describes standing open in front of a reader.
   */
  ledger_desk: narrator.bark(
    "Wick's ledger, open to a page he keeps returning to: six weeks back, every lamp in the shop sold in one go — lamps, oil, and forty candles, paid in old coin, no name signed.",
  ),
  blade_rack: narrator.bark(
    'Blades, tools, horseshoes, a talon-grip handle — racked to sell, every edge honed and none of them notched yet.',
  ),
  wagon_bed: narrator.bark(
    "A long wagon bed, showman's red under the dust, gold trim gone thin at the edges and a sheet thrown over one end — one of eleven built for a circus that paid on the day, every time.",
  ),
  joiner_bench: narrator.bark(
    "A bench scarred by a thousand saw cuts, a spoke still in the vice. Every tool on the board behind it hangs within an arm's reach, each on its own peg.",
  ),
  lathe: narrator.bark(
    'A hub blank between the centres, a cord from the treadle round it and up to a springy pole. Press the treadle and the whole wall creaks.',
  ),
  shaving_horse: narrator.bark(
    'A low bench to sit astride, a foot clamp pinning a spoke to the bridge, the drawknife left across it mid-stroke.',
  ),
  axle_set: narrator.bark(
    'A new axletree up on trestles with a wheel hung on each arm, a chalk line at its middle. Somebody is getting a cart.',
  ),
  firewood_stack: narrator.bark(
    "Offcuts split and stacked by the armful: spoke ends, a cracked felloe, somebody's old axle. Nothing in here goes to waste.",
  ),
  armour_stand: narrator.bark(
    'A leather cuirass and helm on a wooden frame, garrison colours, waiting on whoever signs it out next.',
  ),
  /** Echoes Dann's own count in `residents.ts` — forty on paper, nineteen in fact — and nothing past it. */
  garrison_spear_rack: narrator.bark(
    'Pegs cut for forty spears. Most of them hold nothing but a pale ring on the sill where a butt used to stand.',
  ),
  issue_counter: narrator.bark(
    "The issue book lies open, the quill chained to it. Name, piece, date, signature, in columns. Nobody's line is left blank.",
  ),
  straw_dummy: narrator.bark(
    'A burlap man stuffed with straw, a target painted where his heart would be. The straw has been restuffed more than once.',
  ),
  pell_post: narrator.bark(
    'An oak post hacked pale from shoulder height down. Someone has roped it where it began to split and gone on hitting it.',
  ),
  archery_butt: narrator.bark(
    'A coiled straw butt on a frame, rings painted on its face. The arrows in it are mostly a long way from the gold.',
  ),
  drill_slate: narrator.bark(
    'Names down one side in chalk, tallies across. One row has been rubbed out with the flat of a hand.',
  ),
  briefing_table: narrator.bark(
    'A hand-drawn map of the town inside its wall, pinned flat. Red pins mark the watch posts. Some of the posts have no pin.',
  ),
  millstone: narrator.bark(
    'Two stones, one atop the other, worn glass-smooth at the centre where the grain has passed between them ten thousand times.',
  ),
  grain_scale: narrator.bark(
    'A steelyard on a gallows post, a sack on its hook and the poise run out along the notches. The slate at its foot is all tally marks in rows of four, crossed through.',
  ),
  /**
   * The sixteen sacks are Marta's own number, from her lore and her
   * ambient lines — the stack only shows them.
   */
  flour_sacks: narrator.bark(
    'Sacks stacked two high on a pallet, each one stencilled with a sheaf. Sixteen of them, counted twice by somebody, and a chalk arrow on the pallet pointing at the door.',
  ),
  farm_dresser: narrator.bark(
    'Blue-and-white plates stood along the rails, every one of them chipped somewhere. The preserves along the bottom shelf are labelled by colour, not by word.',
  ),
  larder_shelf: narrator.bark(
    'Cheese, eggs, a ham in its muslin, onions on a string. Everything here was grown, pressed or cured inside the wall.',
  ),
  /**
   * Echoes what Marta's own lore already establishes about Corvin — the
   * stairwell, the levels and loot he imagines, nothing invented past it.
   */
  crawler_scraps: narrator.bark(
    "A boy's corner: a tally of chalk marks by the door, a coiled scrap of rope, a stub of candle burnt low, and a hilt with no blade left. Someone has been counting crawlers.",
  ),
  /**
   * Echoes Kessler's own lore — the candles in a ring, the report marked
   * resolved by nobody, "the log is not on the wall" — no new fact added.
   */
  field_log: narrator.bark(
    'A logbook, kept apart from the one nailed to the wall. Candles in a ring, burnt to stubs, on a floor nobody was meant to find. Reported twice. Resolved by no one.',
  ),
  /**
   * Blackwood Lodge's pieces echo only what Kessler already says — the old
   * drainage under the row, two men and no relief, the eleven-hour watch,
   * reports sent back "resolved" — and add no fact of their own.
   */
  lodge_map_table: narrator.bark(
    'The row, drawn street by street, and under it in blue a run of old drainage older than the wall. Pins down the length of it. One spot ringed twice.',
  ),
  lodge_bunks: narrator.bark(
    'Bunks for a section. Two have been slept in. The rest are rolled, strapped and waiting on men nobody has sent.',
  ),
  lodge_spear_rack: narrator.bark(
    'Slotted for twelve spears. Five stand in it, oiled and sharp. The empty slots have been dusted anyway.',
  ),
  lodge_duty_board: narrator.bark(
    'The watch rotation, chalked in two names and eleven-hour shifts, and beside it two reports pinned up where they came back. Both are stamped "resolved".',
  ),
  lodge_stove: narrator.bark(
    'A kettle kept on the boil through the night watch, and a pair of socks drying on the rail. The one warm corner of the post.',
  ),
  milk_churn: narrator.bark(
    'Scoured tin, lid seated tight, standing exactly where a full one would stand. Nothing inside rattles.',
  ),
  tool_wall: narrator.bark(
    'Every tool in its place: the saws by length, the chisels narrowest to widest, the plumb bob hanging dead still. All of them oiled, none of them used this week.',
  ),
  dairy_wall: narrator.bark(
    'Through the window, the pasture: good grass, a fence better made than any other in town, and nothing standing in it. The pails below are hung upside down to keep the dust out.',
  ),
  feed_sacks: narrator.bark(
    'Feed, stacked square, every stencil turned outward. Not one sack has been opened.',
  ),
  repair_door: narrator.bark(
    "A four-panel door on trestles, planed true, its hinges laid out in the order they will go on. It is for somebody else's house.",
  ),
  slate_menu: narrator.bark(
    "Stew, bread, ale — chalked up fresh each morning and rubbed half away by evening, whatever's left in the pot.",
  ),
  cat_portrait: narrator.bark(
    'A painted cat, sitting square on a stool. Whoever painted it clearly believed every word of the story.',
  ),
  dairy_churn: narrator.bark(
    'An empty milk churn, scoured and kept ready. Nobody has poured into it in some time.',
  ),
  tab_ledger: narrator.bark(
    'A book of names and figures, hung by the bar rather than left where a curious hand could turn its pages.',
  ),
  trophy_banner: narrator.bark(
    'A guild banner, its shield stitched in thread gone dull at the edges from thirty years of pipe smoke.',
  ),
  guild_booth: narrator.bark(
    'Panelled walnut under the guild fleece. Every cushion has been sat into the shape of somebody in particular.',
  ),
  feast_bench: narrator.bark(
    'A walnut bench worn pale down the middle of the seat. The date cut into its end is older than the street outside.',
  ),
  flagon_back_bar: narrator.bark(
    'Cut-glass decanters, the mead casks set into the cabinet, and a mirror kept polished enough to watch the whole room in.',
  ),
  chalk_tally: narrator.bark(
    'Two columns of chalked names and scores. Some of the names have not been rubbed out since their owners stopped coming in.',
  ),
  dice_table: narrator.bark(
    'Cards face down, two dice, three little stacks of coin, and a knife stood in the wood where everyone can see it.',
  ),
  flagon_trophy: narrator.bark(
    'Arms hung high and kept bright. Nobody in the Flagon has swung anything heavier than a tankard in years.',
  ),
  bolted_door: narrator.bark(
    'A door barred with a beam thick enough to stop a shoulder. Whatever used to come through it, nobody wants it coming through again.',
  ),
  still: narrator.bark(
    'A copper pot still over a low flame, its neck running down into a tub where the worm coils under cold water. One drop at a time into the jar below. Nothing on the jar says what.',
  ),
  apothecary_drawer_wall: narrator.bark(
    "Drawers by the dozen, each keyed to a scrawled line of shorthand and nothing else, and above them glazed jar after glazed jar, labelled in a clipped hand. Whoever runs this shop trusts their own hand more than a customer's eye.",
  ),
  herb_drying_rack: narrator.bark(
    'Bunches hung head-down to dry — lavender, sage, yarrow, rosemary — over trays of petals turned by hand. Each tray has a date chalked on its edge. None has a name.',
  ),
  herb_bins: narrator.bark(
    "Loose stock sold by the scoop: chamomile, rose petal, mint, willow bark. The slates give a price and nothing else. Ask what it's for and you'll be told what it costs.",
  ),
  specimen_case: narrator.bark(
    'Kept in spirits behind glass: a coiled adder, a toad, a jar of leeches that still stir when the glass is tapped. None of it is priced. None of it is explained.',
  ),
  remedy_display: narrator.bark(
    'Remedies made up and stoppered, packets folded and tied. The card gives prices and one line underneath: as directed. It does not say directed by whom.',
  ),
  potting_bench: narrator.bark(
    'A soil-stained bench, seed trays lined along its back edge, the first true leaves just up in two of them. Not everything here comes in already dried.',
  ),
  live_herb_pots: narrator.bark(
    'A cluster of potted herbs, still green, still rooted — kept apart from the dried stock on the shelves, growing toward whichever jar needs refilling next.',
  ),
  /**
   * Ties into the anchor errand's own "funny looking rock" without naming
   * it: two jars visibly not sitting still is the room's own evidence that
   * something in this cottage is not ordinary stock.
   */
  witch_jars: narrator.bark(
    'Most of the jars on this shelf sit exactly where they were set down. Two of them do not — a slow, faint shift, there and then not, like something breathing inside the glass.',
  ),
  book_stack: narrator.bark(
    "A leaning stack of books with no shelf left to take them. None share a spine colour, and none look like they've been reshelved in years.",
  ),
  cottage_familiar: narrator.bark(
    'A black cat, curled tight on the cushion of the chair nearest the fire, one eye open and tracking you across the room without otherwise moving. The shawl on the chair back is covered in its hair.',
  ),
  witch_worktable: narrator.bark(
    'A table buried in the work: a book lying open, a mortar with something green ground into it, three candles burned down to three different heights. Nothing on it has been put away in a long while.',
  ),
  /**
   * Describes the visible object only — "the stone set within the face of
   * the altar" is Aviel's own protected line, not restated here.
   */
  altar_stone: narrator.bark(
    "A small pale stone is set into the altar's face, dull among the surrounding brass — plain enough that a visitor would walk past it without a second look.",
  ),
  lectern: narrator.bark(
    'A worn lectern, its book left open to the same page it always seems to be open to. The ribbon marking it has been moved more than the page has.',
  ),
  sky_banner: narrator.bark(
    "A wing spread wide over a rising sun, stitched in the temple's own blue-grey thread — the same device worked into the dome outside, brought down to eye level.",
  ),
  needle_tray: narrator.bark(
    "A trolley of corked ink and a fan of clean needles, laid out in the order they get used. Nothing here has touched skin that hasn't already paid.",
  ),
  feather_chart: narrator.bark(
    "Two pinned diagrams of a skyfowl's own feather-tracts, body and wing, labelled in a hand too neat to be Nim's own client notes — a reference, not a doodle.",
  ),
  flash_wall: narrator.bark(
    'Sheets of flash pinned edge to edge: roses, daggers, a ship, a skull, a skyfowl in flight. Each has a price pencilled under it, and none of the prices have been rubbed out.',
  ),
  ink_chair: narrator.bark(
    'A padded chair that tips back on an iron post, the leather worn pale where a hundred arms have rested. There is a towel folded over the headrest and a drop of black on the footrest nobody has got out.',
  ),
  pigment_cabinet: narrator.bark(
    'Three shelves of ink pots, each with its colour written on the label in that colour. The black ones are nearly empty. The rest have barely been touched.',
  ),
  grinding_bench: narrator.bark(
    'A stone slab gone smooth under a glass muller, a smear of ochre half worked into oil, and ink cakes drying on paper above it. The ink here is made, not bought.',
  ),
  birdcage: narrator.bark(
    'A cage on a tall iron stand, a cloth half drawn over it and a finch inside turning its head to watch you as you watch it back.',
  ),
  mushroom_basket: narrator.bark(
    'A basket heaped with mushrooms still damp from wherever they were pulled — none of them look like the sort you buy at a stall.',
  ),
  forge: narrator.bark(
    'Stone built up around a bed of coals, hood drawing the smoke up its own flue. The bellows beside it still smell of hot leather.',
  ),
  vice_bench: narrator.bark(
    'A leg vice bolted to the end of a heavy bench, and on the bench a helm with half its rivets in, files laid out beside it in order of size.',
  ),
  /** Echoes only Varga's own words about the anvil — the dish worn into its face, deep as a thumb. */
  anvil: narrator.bark(
    'The anvil stands on a stump bound in iron. Its face is dished in the middle, worn deep as a thumb.',
  ),
  smith_bellows: narrator.bark(
    'A great bellows slung in its frame, leather dark with oil. The pole overhead is worn pale where a hand has pulled it down ten thousand times.',
  ),
  smith_tool_wall: narrator.bark(
    'Hammers by weight, tongs by jaw, punches by size — every peg has its tool, and the one empty peg is the hammer on the anvil.',
  ),
  ironmongery_table: narrator.bark(
    'Pots, a skillet, a kettle, pot hooks, a lantern, a sickle — the everyday half of the trade, for people who will never buy a sword.',
  ),
  mail_stand: narrator.bark(
    'A mail shirt on a stand with a helm on top of it. Not for sale, by the look of it — for showing that it can be done here.',
  ),
  wheel_build_stand: narrator.bark(
    'A wheel half-built on its own cradle: the hub set, spokes driven in, the felloe not yet ringed round the rim.',
  ),
  timber_rack: narrator.bark(
    'Planks and poles racked against the wall by length, the shortest offcuts on top where a hand can reach them first.',
  ),
  flour_bin: narrator.bark('A deep bin, lid dusted white along its seam. Full enough to lean on.'),
  sieve_rack: narrator.bark(
    'A row of round sieves hung by size, mesh clogged grey with flour that never quite brushes clean.',
  ),
  scripture_shelf: narrator.bark(
    'Scrolls stand pigeonholed above a shelf of bound spines, none of them titled on the outside — you would have to open one to know which sky it answers to.',
  ),
  sky_window: narrator.bark(
    'A rose of blue glass with a white bird crossing it, and a pointed light either side. Whatever the weather outside, it lets in more sky than seems fair.',
  ),
  perch_stand: narrator.bark(
    "A tall roost with two crossbars, worn pale where feet grip it. The two birds on it don't look up — they are here for the service, not for you.",
  ),
  votive_rack: narrator.bark(
    'Two tiers of small candles in glass cups, most of them lit. Each one is somebody asking for something, and none of them are labelled.',
  ),
  sky_font: narrator.bark(
    'A stone basin of still water inside the door, a wing carved into its side. One white feather floats on it, turning slowly, never quite reaching the rim.',
  ),
  goods_wall: narrator.bark(
    'Shelves to the ceiling, every gap filled — lamps, rope, pots, jars, cloth. Nothing on them is dusty. Nothing stays long enough.',
  ),
  potion_cabinet: narrator.bark(
    'A glass cabinet, locked. Red draughts on the top shelves, scrolls in the pigeonholes below. The key is not in the lock and never is.',
  ),
  bulk_bins: narrator.bark(
    'Open barrels of nails, flour and salt, a scoop left in each and the price chalked on a stick. Weighed at the counter, not before.',
  ),
  dynamite_crate: narrator.bark(
    'A crate of goblin dynamite, lid off, kept on the keeper’s side of the counter. The warning on the side has been painted over twice to make it bigger.',
  ),
} satisfies Record<TownInteriorExamineId, BarkLine>;

/**
 * Plumbline Farm's dairy corner once a cow lives in Wendell's pasture again.
 * The `EXAMINE_LINES` entries these replace describe a room kept ready for a
 * cow that never came, which stops being true the day Midge arrives.
 */
export const DAIRY_LIVE_EXAMINE_LINES = {
  milk_churn: narrator.bark(
    "One churn stands open on the morning's milk, a straining cloth thrown over the next. The butter churn's dasher is down in cream, and the stand is still wet.",
  ),
  dairy_wall: narrator.bark(
    'Through the window, the pasture and its good fence, the grass along the near rail cropped short. The pails below hang upturned to dry.',
  ),
} satisfies Partial<Record<TownInteriorExamineId, BarkLine>>;

export interface SearchLoot {
  readonly coinsMin: number;
  readonly coinsMax: number;
}

/**
 * Built through a function rather than written as nested object literals:
 * the dialog-lines gate scans every exported object's own properties for a
 * reference, recursing into a literal but not a function call — `coinsMin`/
 * `coinsMax` are read by name in `InteriorPropInteractionSystem`, once, off
 * the shared `SearchLoot` shape, not per table entry.
 */
function searchLoot(coinsMin: number, coinsMax: number): SearchLoot {
  return { coinsMin, coinsMax };
}

/** A chest, weighted with a coat pocket or hook, and a small chest of drawers — smallest to largest cache. */
const CHEST_COINS_MIN = 2;
const CHEST_COINS_MAX = 5;
const COAT_HOOK_COINS_MIN = 0;
const COAT_HOOK_COINS_MAX = 2;
const DRAWER_UNIT_COINS_MIN = 1;
const DRAWER_UNIT_COINS_MAX = 3;
/** A back-room stock crate, already opened — worth less than a locked chest. */
const OPEN_CRATE_COINS_MIN = 1;
const OPEN_CRATE_COINS_MAX = 2;

/** What a container gives up the first time it's searched — `TownInteriorInteraction`'s `'search'` id. */
export const SEARCH_TABLES = {
  chest: searchLoot(CHEST_COINS_MIN, CHEST_COINS_MAX),
  coat_hook: searchLoot(COAT_HOOK_COINS_MIN, COAT_HOOK_COINS_MAX),
  drawer_unit: searchLoot(DRAWER_UNIT_COINS_MIN, DRAWER_UNIT_COINS_MAX),
  open_crate: searchLoot(OPEN_CRATE_COINS_MIN, OPEN_CRATE_COINS_MAX),
} satisfies Record<TownInteriorSearchId, SearchLoot>;

export const SEARCH_FOUND_LINE: BarkLine = narrator.bark(
  'Something worth taking, tucked away inside.',
);
export const SEARCH_NOTHING_FOUND_LINE: BarkLine = narrator.bark('Nothing worth taking inside.');
export const SEARCH_EMPTY_LINE: BarkLine = narrator.bark(
  'Already been through this. Nothing left.',
);

/** What using an object does — `TownInteriorInteraction`'s `'use'` id. */
export const USE_LINES = {
  shop_bell: [narrator.bark('A short brass ring, more habit than summons.')],
  offering_bowl: [
    narrator.bark('You lay a coin in the bowl. It rings once against the others already there.'),
  ],
  bench_seat: [narrator.bark('You sit a moment. The bench takes your weight without complaint.')],
  hearth: [narrator.bark('You hold your hands out to the fire and let the warmth settle in.')],
  grindstone: [
    narrator.bark('You lean an edge against the stone. It flares white for a moment, then cools.'),
  ],
  wheelwright_stand: [
    narrator.bark('You give the spokes a slow turn, checking the wheel still runs true.'),
  ],
  throw_dart: [
    narrator.bark('You send one at the board. It sticks, closer to the middle than you expected.'),
    narrator.bark('The dart bounces off the rim and skitters under a table. Nobody saw.'),
  ],
  biting_stool: [
    narrator.bark('You sit. A loose nail catches you before the wood does. It always does that.'),
  ],
} satisfies Record<TownInteriorUseId, NonEmpty<BarkLine>>;

/** A keeper's response to the bell, when the room has someone who'd answer it. */
export const SHOP_BELL_KEEPER_LINE: BarkLine = narrator.bark(
  '"Be right with you!" comes a voice from the back.',
);

/** An occupant's reaction to hearing something break nearby, split by how heavy the break sounded. */
export const BREAK_REACTION_LINES_LIGHT: NonEmpty<BarkLine> = [
  narrator.bark('Someone nearby winces at the crash.'),
  narrator.bark('"Careful with that!" someone calls out, not looking up.'),
  narrator.bark('A sharp intake of breath from across the room.'),
];

export const BREAK_REACTION_LINES_HEAVY: NonEmpty<BarkLine> = [
  narrator.bark('The clang draws a few startled looks.'),
  narrator.bark('"That better not have been mine," someone mutters.'),
  narrator.bark('Someone nearby mutters about the cost of replacing it.'),
];
