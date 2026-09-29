/**
 * The town's purely decorative street furniture — the props that make the Over
 * City read as somewhere people live rather than as a street plan with buildings
 * on it.
 *
 * Kept apart from `TownPropSystem`, which owns the fixtures the player *acts on*
 * (the notice board, the seer, the heal spots). Nothing here has a Space-key
 * behaviour, so nothing here belongs in that system's interaction chain; the two
 * only meet in `DungeonScene`, which concatenates both prop lists for the
 * Y-sorted render pass.
 *
 * **Placement is derived from the finished map, not restated.** Signs hang off
 * `buildingEntries` and lamps off the `TownPlan`'s own street rectangles, so a
 * building or a street that moves takes its furniture with it. That is the same
 * choice `?townmap` makes when it re-derives footprints from the grid instead of
 * having the generator export them: a second copy of a coordinate is a second
 * thing to keep in step.
 */

import { TILE_SIZE } from '../core/constants';
import { GOLDEN_ANGLE_RAD } from '../utils';
import {
  SIGN_SWAY_PHASE_STRIDE_RAD,
  shopSignSwayStep,
  signWestShiftTiles,
} from '../sprites/shopSign';
import { streetLampFlickerStep } from '../sprites/streetLamp';
import {
  TOWN_CLUTTER_KINDS,
  laundryLineSwayStep,
  type TownClutterKind,
} from '../sprites/townClutter';
import { type GateArchAxis } from '../sprites/townWayfinding';
import { drawTownSheetFrame } from '../sprites/townSheetProp';
import {
  BUNTING_SPANS,
  LAUNDRY_ALLEY_NAMES,
  LAUNDRY_ROW_OFFSETS,
  PLANNED_SIGNPOSTS,
  laundryLineAnchorX,
  laundryLineSpanTiles,
} from './townDecorPlan';
import { tileKey } from './tileKey';
import { doorwayKeepClearTiles } from './doorwayKeepClear';
import type { GameMap } from '../map/GameMap';
import {
  SHOP_SIGN_EMBLEMS,
  type ShopSignEmblem,
  type TileRect,
  type TownOffset,
  type TownPlan,
} from '../map/town/townPlan';
import type { GameSystem } from './GameSystem';
import type { TownPropRenderable } from './townPropRenderable';

/**
 * Streets the town lights, by the `TownPlan`'s own surface names. Market Street and
 * Low Street are the town's two lit thoroughfares; King's Road is the arrival
 * sightline from the south gate, and the two Low Quarter alleys are the reason
 * for lamps at all — an unlit alley beside a nightclub is a corridor, a lit one
 * is a place.
 *
 * Names rather than tile types, because a tile type says what a street is paved
 * in and not which street it is: Market Street and the plaza's approaches are
 * both cobble.
 */
const LIT_STREET_NAMES: ReadonlySet<string> = new Set([
  'Market Street',
  'Low Street',
  "King's Road",
  'club service alley',
  'murder alley',
]);

/** Tiles between consecutive lamps along one street. */
const LAMP_STRIDE_TILES = 9;
/** How far in from a street's ends the first and last lamp stand. */
const LAMP_END_MARGIN_TILES = 3;
/**
 * Lamps must clear a doorway by more than a diagonal step, so one never stands
 * in the tile a player is pushed into on leaving a building, nor in the apron
 * the door hint draws over.
 */
const LAMP_DOOR_CLEARANCE_TILES = 2;

/**
 * Spread the flicker so a street of lamps does not breathe in unison. The golden
 * angle, for the reason `GOLDEN_ANGLE_RAD` gives — a round stride puts some pair
 * of a dozen lamps in visual lockstep.
 */
const LAMP_FLICKER_PHASE_STRIDE_RAD = GOLDEN_ANGLE_RAD;

/**
 * Where a piece of clutter belongs, named the way the `TownPlan` names things
 * rather than as a coordinate.
 *
 * `yard` puts it inside a block interior, offset from that yard's north-west
 * corner. `door` puts it on a building's own frontage, offset from its door
 * tile — which for every building in this town means the street row below it,
 * because the tiles either side of a door are the facade. Trade spilling onto
 * the pavement is what a market street looks like; a barrel tucked invisibly
 * behind a wall is not.
 */
type ClutterAnchor =
  | { readonly at: 'yard'; readonly name: string; readonly offset: TownOffset }
  | { readonly at: 'door'; readonly name: string; readonly offset: TownOffset }
  // `surface` reaches a `PlannedSurface` (the drill yards, the crop rows) rather
  // than a `PlannedYard` — the working ground a trade actually stands on, which
  // for the Barracks is gravel the generator plans as a surface, not a fenced
  // `yard` entry.
  | { readonly at: 'surface'; readonly name: string; readonly offset: TownOffset };

interface ClutterPlacement {
  readonly kind: TownClutterKind;
  readonly anchor: ClutterAnchor;
}

/**
 * Every piece of clutter in the town.
 *
 * **The smithy's gear is on The Rusty Anvil's own frontage, not in the Market
 * Row east workyard.** The district wants a smithy yard, and this block cannot
 * give it one: the Anvil fills columns 9–16
 * and the East Lane separates it from the yard at 20–27, so an anvil dropped in
 * that yard would be an anvil in someone else's yard. The yard gets the carting
 * gear it actually serves.
 */
const CLUTTER_PLACEMENTS: ReadonlyArray<ClutterPlacement> = [
  // The smithy, spilling onto Market Street either side of its door.
  {
    kind: 'anvil_block',
    anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: -3, dy: 1 } },
  },
  { kind: 'coal_pile', anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: -4, dy: 1 } } },
  {
    kind: 'quench_barrel',
    anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: 3, dy: 1 } },
  },
  { kind: 'tool_rack', anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: 4, dy: 1 } } },

  // Frontages: what each trade leaves outside its own door.
  {
    kind: 'water_trough',
    anchor: { at: 'door', name: 'The Sleeping Cat Inn', offset: { dx: -3, dy: 1 } },
  },
  {
    kind: 'hitching_post',
    anchor: { at: 'door', name: 'The Sleeping Cat Inn', offset: { dx: -4, dy: 1 } },
  },
  { kind: 'crate_stack', anchor: { at: 'door', name: 'General Store', offset: { dx: 3, dy: 1 } } },
  { kind: 'sacks', anchor: { at: 'door', name: 'General Store', offset: { dx: 4, dy: 1 } } },
  // +4, not +3: The Horned Flagon's doorway is four tiles wide, so `paintDoorApron`
  // reaches three tiles east of the door *centre* and a barrel at +3 stood on the
  // last tile of its own doorstep.
  {
    kind: 'barrel_stack',
    anchor: { at: 'door', name: 'The Horned Flagon', offset: { dx: 4, dy: 1 } },
  },
  { kind: 'planter', anchor: { at: 'door', name: 'Temple of the Sky', offset: { dx: 3, dy: 1 } } },
  { kind: 'birdbath', anchor: { at: 'door', name: 'Temple of the Sky', offset: { dx: 5, dy: 1 } } },
  {
    kind: 'barrel_stack',
    anchor: { at: 'door', name: 'The Desperado Club', offset: { dx: 4, dy: 1 } },
  },
  { kind: 'handcart', anchor: { at: 'door', name: "Miller's Farm", offset: { dx: -3, dy: 1 } } },
  { kind: 'hay_bale', anchor: { at: 'door', name: "Miller's Farm", offset: { dx: -4, dy: 1 } } },
  {
    kind: 'planter',
    anchor: { at: 'door', name: "Old Hilda's Cottage", offset: { dx: 3, dy: 1 } },
  },

  // The carting yard behind Market Row.
  {
    kind: 'crate_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 2, dy: 1 } },
  },
  {
    kind: 'barrel_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 4, dy: 1 } },
  },
  {
    kind: 'hay_bale',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 6, dy: 2 } },
  },
  {
    kind: 'handcart',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 2, dy: 3 } },
  },
  {
    kind: 'wagon_wheel',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 5, dy: 4 } },
  },
  {
    kind: 'sacks',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 6, dy: 4 } },
  },

  // The gardens.
  {
    kind: 'chicken_coop',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 1, dy: 1 } },
  },
  {
    kind: 'garden_pump',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 5, dy: 1 } },
  },
  {
    kind: 'garden_pump',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 2, dy: 2 } },
  },
  {
    kind: 'planter',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 9, dy: 6 } },
  },
  {
    kind: 'barrel_stack',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 1, dy: 1 } },
  },
  {
    kind: 'crate_stack',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 4, dy: 2 } },
  },
  { kind: 'hay_bale', anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 1, dy: 1 } } },
  { kind: 'planter', anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 5, dy: 4 } } },
  // Wendell's own pasture gear — a trough and a rack, not the loose garden
  // clutter above. Kept along the green's edges, clear of the yard's own
  // centre for the cow Wendell's pasture is being kept ready for.
  {
    kind: 'water_trough',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 1, dy: 5 } },
  },
  { kind: 'hay_rack', anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 4, dy: 2 } } },

  // Building-line dressing: something at most every frontage, so facades sit
  // in a lived-in street rather than on bare ground.
  { kind: 'tool_rack', anchor: { at: 'door', name: 'The Barracks', offset: { dx: -3, dy: 1 } } },
  { kind: 'crate_stack', anchor: { at: 'door', name: 'The Barracks', offset: { dx: 4, dy: 1 } } },
  {
    kind: 'wagon_wheel',
    anchor: { at: 'door', name: "Cartwright's Workshop", offset: { dx: -3, dy: 1 } },
  },
  {
    kind: 'sacks',
    anchor: { at: 'door', name: "Cartwright's Workshop", offset: { dx: 4, dy: 1 } },
  },
  {
    kind: 'planter',
    anchor: { at: 'door', name: 'The Sunken Stump Pub', offset: { dx: -3, dy: 1 } },
  },
  {
    kind: 'crate_stack',
    anchor: { at: 'door', name: 'The Sunken Stump Pub', offset: { dx: 4, dy: 1 } },
  },
  { kind: 'planter', anchor: { at: 'door', name: 'The Quiet Needle', offset: { dx: -3, dy: 1 } } },

  // Trade-themed yard dressing: the empty back strips and gardens each read as
  // the trade behind them rather than as bare kept grass.
  {
    kind: 'herb_rack',
    anchor: { at: 'yard', name: 'Herb & Remedy back strip', offset: { dx: 2, dy: 0 } },
  },
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: 'Herb & Remedy side strip', offset: { dx: 0, dy: 2 } },
  },
  {
    kind: 'herb_rack',
    anchor: { at: 'yard', name: "Old Hilda's side strip", offset: { dx: 0, dy: 2 } },
  },
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 3, dy: 1 } },
  },
  {
    kind: 'timber_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 3, dy: 1 } },
  },
  {
    kind: 'garden_bench',
    anchor: { at: 'yard', name: 'Horned Flagon back strip', offset: { dx: 3, dy: 0 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 6, dy: 1 } },
  },
  {
    kind: 'garden_bench',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 6, dy: 2 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'General Store back strip', offset: { dx: 3, dy: 0 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'Sleeping Cat back strip', offset: { dx: 3, dy: 0 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'Garrison back strip', offset: { dx: 5, dy: 0 } },
  },
  {
    kind: 'drill_pell',
    anchor: { at: 'surface', name: 'Barracks drill yard (west)', offset: { dx: 1, dy: 2 } },
  },
  {
    kind: 'drill_pell',
    anchor: { at: 'surface', name: 'Barracks drill yard (east)', offset: { dx: 1, dy: 2 } },
  },

  // Wendell's pasture: crafted, not rustic — squared timber, a milking stool and
  // pail at the gate, a feed bin, all clear of the yard's own centre for a cow.
  {
    kind: 'timber_stack',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 2, dy: 5 } },
  },
  {
    kind: 'feed_bin',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 3, dy: 1 } },
  },
  {
    kind: 'milking_stool',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 1, dy: 3 } },
  },

  // Whole-lot compositions, not one or two pieces of clutter lost in a grass
  // rectangle. Every yard below gets enough pieces, spread across
  // its own footprint, to read as a place someone works or tends rather than
  // as kept lawn with an ornament on it.

  // Miller's kitchen garden: a working vegetable plot, not a single row. The
  // yard is only three rows deep and fenced on every side, so `dy: 1` is the
  // one row clear of the perimeter posts on every column.
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 2, dy: 1 } },
  },
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 6, dy: 2 } },
  },
  {
    kind: 'grain_bin',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 3, dy: 2 } },
  },

  // Market Row east workyard: the carting yard fuller still — a place things
  // are stacked and fetched, not a gravel rectangle with a wheel on it.
  {
    kind: 'tool_rack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 1, dy: 4 } },
  },
  {
    kind: 'crate_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 7, dy: 2 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 1, dy: 0 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 4, dy: 0 } },
  },

  // The Quiet Needle's courtyard: paved (see the `courtyard` `YardKind`), with
  // a planter ring, a second bench and a tree — a bench and a pump alone read
  // as a back garden, not a courtyard.
  {
    kind: 'planter',
    // Beside the tree on the open paving north of the parlour. The yard's
    // bounds take in the parlour itself, so an offset into its footprint drifts
    // to the nearest walkable tile — which, from inside the facade, is the door.
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 4, dy: 3 } },
  },
  {
    kind: 'planter',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 9, dy: 2 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 5, dy: 5 } },
  },
  {
    kind: 'garden_bench',
    anchor: { at: 'yard', name: "The Quiet Needle's back garden", offset: { dx: 9, dy: 8 } },
  },

  // The Sunken Stump's beer garden: more barrels and benches to sit them at.
  {
    kind: 'garden_bench',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 2, dy: 3 } },
  },
  {
    kind: 'barrel_stack',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 5, dy: 3 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 3, dy: 1 } },
  },

  // Barracks drill yards: a weapon rack and a second pell each, plus a crate
  // of practice gear, so the ground reads as drilled rather than swept.
  {
    kind: 'weapon_rack',
    anchor: { at: 'surface', name: 'Barracks drill yard (west)', offset: { dx: 1, dy: 4 } },
  },
  {
    kind: 'drill_pell',
    anchor: { at: 'surface', name: 'Barracks drill yard (west)', offset: { dx: 3, dy: 3 } },
  },
  {
    kind: 'weapon_rack',
    anchor: { at: 'surface', name: 'Barracks drill yard (east)', offset: { dx: 1, dy: 4 } },
  },
  {
    kind: 'drill_pell',
    anchor: { at: 'surface', name: 'Barracks drill yard (east)', offset: { dx: 3, dy: 3 } },
  },

  // Back strips: a second and third piece along each, and a hedge to frame the
  // ones that are otherwise just a name on an empty row of grass.
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: 'Herb & Remedy back strip', offset: { dx: 5, dy: 0 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: "Old Hilda's side strip", offset: { dx: 0, dy: 4 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: 'General Store back strip', offset: { dx: 5, dy: 0 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: 'Sleeping Cat back strip', offset: { dx: 5, dy: 0 } },
  },
  {
    kind: 'hedge_row',
    anchor: { at: 'yard', name: 'Horned Flagon back strip', offset: { dx: 5, dy: 0 } },
  },
  {
    kind: 'street_tree',
    anchor: { at: 'yard', name: 'Garrison back strip', offset: { dx: 9, dy: 0 } },
  },
  {
    kind: 'coal_pile',
    anchor: { at: 'yard', name: 'Rusty Anvil back strip', offset: { dx: 2, dy: 0 } },
  },
  {
    kind: 'tool_rack',
    anchor: { at: 'yard', name: 'Rusty Anvil back strip', offset: { dx: 5, dy: 0 } },
  },

  // Wendell's pasture, finished: a tidy string-line plot beside the vegetable
  // beds his farm-in-waiting does not have yet, and a hedge along the back
  // lane fence so the green reads as tended right up to its edges. Still clear
  // of the yard's own centre for the cow Wendell's pasture is being kept ready for.
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 2, dy: 2 } },
  },
  {
    kind: 'vegetable_row',
    anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 2, dy: 4 } },
  },
];

/** How far a piece of clutter may drift from its stated tile to find a free one. */
const CLUTTER_SEARCH_RADIUS = 2;

/**
 * A custom-frame building-line fixture — a post, a perch or a shelter, each
 * with its own sheet rather than a shared clutter envelope. Placed the same
 * connectivity-checked way as clutter, but rendered by `FixtureProp` rather
 * than `ClutterProp`.
 */
type FixtureKind = 'awning_post' | 'skyfowl_perch' | 'field_shelter';

const FIXTURE_SHEET_KEY: Record<FixtureKind, string> = {
  awning_post: 'town_awning_post',
  skyfowl_perch: 'town_skyfowl_perch',
  field_shelter: 'town_field_shelter',
};

interface FixturePlacement {
  readonly kind: FixtureKind;
  readonly anchor: ClutterAnchor;
}

/**
 * Awning posts at the town's two busiest frontages and the club's door, and a
 * skyfowl perch at the temple — furniture a bird chooses to use, never baked
 * into the facade, so a fixture can be repositioned or removed without a
 * repaint.
 */
const FIXTURE_PLACEMENTS: ReadonlyArray<FixturePlacement> = [
  { kind: 'awning_post', anchor: { at: 'door', name: 'General Store', offset: { dx: -4, dy: 1 } } },
  {
    kind: 'awning_post',
    anchor: { at: 'door', name: 'The Horned Flagon', offset: { dx: -4, dy: 1 } },
  },
  {
    kind: 'awning_post',
    anchor: { at: 'door', name: 'The Desperado Club', offset: { dx: -4, dy: 1 } },
  },
  {
    kind: 'skyfowl_perch',
    anchor: { at: 'door', name: 'Temple of the Sky', offset: { dx: -4, dy: 1 } },
  },
];

/** Wendell's pasture shelter — one fixture, placed directly rather than through the generic list, since it is the only one anchored to a yard corner rather than a door. */
const FIELD_SHELTER_OFFSET: TownOffset = { dx: 5, dy: 1 };

/**
 * A gateway is anchored **on** the wall, at the opening's west or north jamb.
 *
 * An earlier version inset the face-on form one row inward, on the reasoning that
 * a prop anchored on a wall tile "would sort behind the rampart's own art". That
 * is not how the wall is drawn: `TOWN_WALL` is a ground tile baked in the chunk
 * cache, so a prop drawn in the Y-sorted pass is always over it whatever its
 * anchor row. The inset bought nothing and cost the two south-gate torches, whose
 * tiles the arch's piers landed on and occluded almost completely.
 */
const GATEWAY_INSET_TILES = 0;

/**
 * Slack added to a spanning prop's own span to get its cull margin.
 *
 * A span is measured between the two ends' tile *centres*, and each end's art —
 * a pennant, a hanging sheet, a pier — reaches a fraction of a tile past that.
 * One tile covers it with room over. Culling is on the anchor alone, so getting
 * this wrong makes a sixteen-tile string vanish in one frame with twelve tiles
 * still on screen, which is exactly what the default four-tile margin did.
 */
const SPANNING_PROP_CULL_SLACK_TILES = 1;
/** The gateway's piers stand proud of both ends, so it needs a little more. */
const GATEWAY_CULL_SLACK_TILES = 2;

interface TileXY {
  x: number;
  y: number;
}

export class TownDecorSystem implements GameSystem {
  private readonly renderables: TownPropRenderable[] = [];
  private readonly occupied = new Set<string>();
  /** See `reachableInterior`. Null until the first placement needs it. */
  private reachableCache: number | null = null;
  private frame = 0;
  /** See `doorwayKeepClearTiles`: the connectivity check cannot see a sealed door. */
  private readonly doorwayKeepClear: ReadonlySet<string>;

  /**
   * @param claimedElsewhere tiles the market stalls and `TownPropSystem`'s props
   *   already stand on. Needed for the same reason `TownPropSystem` needs the
   *   market's: placement tests `isWalkableIgnoringPermanent`, which by design
   *   does not see those systems' permanent blocks.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly claimedElsewhere: ReadonlySet<string> = new Set(),
  ) {
    this.doorwayKeepClear = doorwayKeepClearTiles(gameMap.buildingEntries);
    this.placeShopSigns();
    this.placeStreetLamps();
    this.placeClutter();
    this.placeFixtures();
    this.placeFieldShelter();
    this.placeLaundryLines();
    this.placeSignposts();
    this.placeGateArches();
    this.placeBunting();
  }

  update(): void {
    this.frame++;
  }

  /** Renderable props for the scene's Y-sorted entity pass. */
  get props(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /**
   * One hanging sign over every shop front. Entries with no `sign` — the main
   * tower and the circus's Big Top — are skipped rather than given a default:
   * neither is a trade, and a fallback emblem would put a mug over the Big Top.
   *
   * Signs block nothing, and nothing needs them to: the board hangs over the
   * facade tile *west* of the doorway, which is already solid, and its lowest ink
   * sits 9 px above the anchor tile's top edge — measured over every emblem and a
   * full sway cycle. Nobody can stand under one.
   */
  private placeShopSigns(): void {
    let signIndex = 0;
    for (const entry of this.gameMap.buildingEntries) {
      const emblem = entry.sign;
      if (emblem === undefined) continue;
      this.renderables.push(
        new ShopSignProp(
          entry.doorTile,
          emblem,
          signWestShiftTiles(entry.doorTile.x, entry.doorwayX0 ?? entry.doorTile.x),
          signIndex * SIGN_SWAY_PHASE_STRIDE_RAD,
          () => this.frame,
        ),
      );
      signIndex++;
    }
  }

  /**
   * Lamps down the kerbs of the lit streets, staggered so opposite sides
   * alternate rather than facing each other in pairs.
   *
   * A lamp is a post, so it blocks its tile — and a prop system's block happens
   * *after* generation, where none of the generator's seven standing assertions
   * can see it. `assertTownIsFullyReachable` proved that a single well-meant
   * fence post can strand fourteen walkable tiles with nothing about the map
   * looking wrong, so every lamp here is checked against the same property
   * before it is placed rather than after someone notices.
   */
  private placeStreetLamps(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    const doorClearance = this.gatherDoorClearance();
    let lampIndex = 0;
    for (const surface of plan.surfaces) {
      if (!LIT_STREET_NAMES.has(surface.name)) continue;
      for (const tile of kerbSites(surface.bounds)) {
        if (doorClearance.has(tileKey(tile.x, tile.y))) continue;
        if (!this.canStandOn(tile)) continue;
        if (!this.leavesTownConnected(plan, tile)) continue;
        this.reserve(tile);
        this.renderables.push(
          new StreetLampProp(tile, lampIndex * LAMP_FLICKER_PHASE_STRIDE_RAD, () => this.frame),
        );
        lampIndex++;
      }
    }
  }

  /**
   * The town's carts, crates, troughs and yard gear.
   *
   * Every piece blocks its tile — a barrel you can walk through is worse than no
   * barrel — so each goes through the same connectivity check the lamps do. A
   * piece whose stated tile is taken drifts a short way to find a free one and is
   * dropped if it cannot; the alternative is a barrel inside a wall, and clutter
   * is the one thing in the town that can be missing without anything looking
   * wrong.
   */
  private placeClutter(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const placement of CLUTTER_PLACEMENTS) {
      const preferred = this.resolveClutterAnchor(plan, placement.anchor);
      if (preferred === null) continue;
      const tile = this.findFreeTile(plan, preferred);
      if (tile === null) continue;
      this.reserve(tile);
      this.renderables.push(new ClutterProp(tile, placement.kind));
    }
  }

  /**
   * The custom-frame fixtures: awning posts and the temple's perch. Same
   * connectivity-checked placement as clutter, kept separate because each
   * fixture is its own sheet rather than a row of `town_clutter`.
   */
  private placeFixtures(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const placement of FIXTURE_PLACEMENTS) {
      const preferred = this.resolveClutterAnchor(plan, placement.anchor);
      if (preferred === null) continue;
      const tile = this.findFreeTile(plan, preferred);
      if (tile === null) continue;
      this.reserve(tile);
      this.renderables.push(new FixtureProp(tile, FIXTURE_SHEET_KEY[placement.kind]));
    }
  }

  /**
   * Wendell's pasture shelter, in the Garrison Green's own corner. Sized for a
   * cow that is not there yet — the offset is chosen clear of the yard's
   * other pasture dressing and its own centre, leaving the yard's centre
   * walkable.
   */
  private placeFieldShelter(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    const yard = plan.yards.find((y) => y.name === 'Garrison Green');
    if (yard === undefined) return;
    const preferred = {
      x: yard.bounds.x + FIELD_SHELTER_OFFSET.dx,
      y: yard.bounds.y + FIELD_SHELTER_OFFSET.dy,
    };
    const tile = this.findFreeTile(plan, preferred);
    if (tile === null) return;
    this.reserve(tile);
    this.renderables.push(new FixtureProp(tile, FIXTURE_SHEET_KEY.field_shelter));
  }

  private resolveClutterAnchor(plan: TownPlan, anchor: ClutterAnchor): TileXY | null {
    if (anchor.at === 'door') {
      const entry = this.gameMap.buildingEntries.find((e) => e.name === anchor.name);
      if (entry === undefined) return null;
      return { x: entry.doorTile.x + anchor.offset.dx, y: entry.doorTile.y + anchor.offset.dy };
    }
    if (anchor.at === 'surface') {
      const surface = plan.surfaces.find((s) => s.name === anchor.name);
      if (surface === undefined) return null;
      return { x: surface.bounds.x + anchor.offset.dx, y: surface.bounds.y + anchor.offset.dy };
    }
    const yard = plan.yards.find((y) => y.name === anchor.name);
    if (yard === undefined) return null;
    return { x: yard.bounds.x + anchor.offset.dx, y: yard.bounds.y + anchor.offset.dy };
  }

  /** Spirals out from `preferred` for a tile that is free and safe to block. */
  private findFreeTile(plan: TownPlan, preferred: TileXY): TileXY | null {
    for (let ring = 0; ring <= CLUTTER_SEARCH_RADIUS; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const tile = { x: preferred.x + dx, y: preferred.y + dy };
          if (!this.canStandOn(tile)) continue;
          if (!this.leavesTownConnected(plan, tile)) continue;
          return tile;
        }
      }
    }
    return null;
  }

  /**
   * Washing strung across the Low Quarter's alleys.
   *
   * Lines block nothing — they hang a tile above head height, like the shop
   * signs — so they skip the connectivity check, and unlike everything else here
   * their anchor is one *end* of the prop rather than the thing itself.
   */
  private placeLaundryLines(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const alleyName of LAUNDRY_ALLEY_NAMES) {
      const alley = plan.surfaces.find((surface) => surface.name === alleyName);
      if (alley === undefined) continue;
      for (const rowOffset of LAUNDRY_ROW_OFFSETS) {
        const y = alley.bounds.y + rowOffset;
        if (y >= alley.bounds.y + alley.bounds.h) continue;
        this.renderables.push(
          new LaundryLineProp(
            { x: laundryLineAnchorX(alley.bounds.x), y },
            laundryLineSpanTiles(alley.bounds.w),
            () => this.frame,
          ),
        );
      }
    }
  }

  /**
   * Fingerposts inside each gate. They block their tile, so they go through the
   * same connectivity check everything else that blocks does.
   */
  private placeSignposts(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    PLANNED_SIGNPOSTS.forEach((planned, plannedIndex) => {
      const gate = plan.gates.find((g) => g.name === planned.gateName);
      if (gate === undefined) return;
      // Inward is the reverse of the gate's outward axis; sideways is the axis it
      // does not run along, which for an axis-aligned gate is the other one.
      const inward = { dx: -gate.outward.dx, dy: -gate.outward.dy };
      const preferred = {
        x: gate.exit.x + inward.dx * planned.inwardTiles + inward.dy * planned.sidewaysTiles,
        y: gate.exit.y + inward.dy * planned.inwardTiles + inward.dx * planned.sidewaysTiles,
      };
      const tile = this.findFreeTile(plan, preferred);
      if (tile === null) return;
      this.reserve(tile);
      this.renderables.push(new SignpostProp(tile, plannedIndex));
    });
  }

  /**
   * A gateway over each gate. Blocks nothing — its piers stand beyond the ends of
   * the opening and its stonework is above head height — so it needs no
   * connectivity check.
   *
   * **The gates are not all the same shape and must not be drawn the same way.**
   * The north and south gates are openings in an east–west wall: you look through
   * them, and they take the face-on arch. The side gates are four-tile openings in
   * north–south walls, which the wall renderer itself draws top-down, so they take
   * the gatehouse form. Drawing every gate face-on spanned the side gates *along
   * Market Street* instead of across their own throats and planted a stone pier in
   * the carriageway five tiles inside the wall.
   */
  private placeGateArches(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const gate of plan.gates) {
      const axis: GateArchAxis = gate.bounds.w >= gate.bounds.h ? 'across' : 'along';
      const spanTiles = Math.max(gate.bounds.w, gate.bounds.h);
      const anchor = {
        x: gate.bounds.x - gate.outward.dx * GATEWAY_INSET_TILES,
        y: gate.bounds.y - gate.outward.dy * GATEWAY_INSET_TILES,
      };
      this.renderables.push(new GateArchProp(anchor, spanTiles, axis));
    }
  }

  /** Bunting across the civic terrace and the plaza's Market Street frontage. */
  private placeBunting(): void {
    const centre = this.gameMap.townSquareCentre;
    if (centre === undefined) return;
    BUNTING_SPANS.forEach((span, index) => {
      this.renderables.push(
        new BuntingProp(
          { x: centre.x + span.offset.dx, y: centre.y + span.offset.dy },
          span.spanTiles,
          index,
        ),
      );
    });
  }

  /**
   * Every tile within `LAMP_DOOR_CLEARANCE_TILES` of a door, as a Chebyshev
   * square rather than a circle: the concern is the apron in front of a door,
   * which is square.
   */
  private gatherDoorClearance(): ReadonlySet<string> {
    const clearance = new Set<string>();
    for (const entry of this.gameMap.buildingEntries) {
      for (let dy = -LAMP_DOOR_CLEARANCE_TILES; dy <= LAMP_DOOR_CLEARANCE_TILES; dy++) {
        for (let dx = -LAMP_DOOR_CLEARANCE_TILES; dx <= LAMP_DOOR_CLEARANCE_TILES; dx++) {
          clearance.add(tileKey(entry.doorTile.x + dx, entry.doorTile.y + dy));
        }
      }
    }
    return clearance;
  }

  private canStandOn(tile: TileXY): boolean {
    const key = tileKey(tile.x, tile.y);
    if (this.occupied.has(key) || this.claimedElsewhere.has(key)) return false;
    if (this.doorwayKeepClear.has(key)) return false;
    // `IgnoringPermanent` for the reason `TownPropSystem.findFreeTile` gives: the
    // overworld map instance outlives a trip into a building, so a prop's own
    // block would make re-placement pick a different tile every trip.
    return this.gameMap.isWalkableIgnoringPermanent(tile.x, tile.y);
  }

  private reserve(tile: TileXY): void {
    this.gameMap.blockTilePermanently(tile.x, tile.y);
    this.occupied.add(tileKey(tile.x, tile.y));
    if (this.reachableCache !== null) this.reachableCache--;
  }

  /**
   * True when blocking `candidate` leaves every other walkable tile inside the
   * walls reachable from the plaza.
   *
   * The fill is confined to the wall's interior, which is both far cheaper than
   * flooding the wilderness and a *stricter* property — getting from one part of
   * the town to another must not require walking out of a gate and round the
   * outside.
   */
  private leavesTownConnected(plan: TownPlan, candidate: TileXY): boolean {
    const reachableWithout = this.countReachableInterior(plan, candidate);
    // The candidate itself is the one tile that stops being reachable. Anything
    // more than that is a piece of town this prop would have sealed off.
    return reachableWithout === this.reachableInterior(plan) - 1;
  }

  /**
   * How much of the interior the plaza can reach with everything placed **so
   * far** blocked — memoised, and decremented by one on each successful
   * placement, which `leavesTownConnected` has just proved is the exact effect of
   * blocking that tile.
   *
   * Recomputing it per candidate was half the cost of the whole system and bought
   * nothing: it only changes when a tile is reserved.
   */
  private reachableInterior(plan: TownPlan): number {
    this.reachableCache ??= this.countReachableInterior(plan, null);
    return this.reachableCache;
  }

  /**
   * Tiles the plaza can reach, treating as blocked: the map's own solids, every
   * tile any town system has claimed, and optionally one candidate.
   *
   * **`isWalkableIgnoringPermanent`, not `isWalkable`** — the same choice, and the
   * same reason, as `canStandOn`. `GameMap` outlives a trip into a building
   * (`DungeonScene` hands the existing map back on exit), and `permanentBlockedTiles`
   * only ever grows, so a fill that honoured it would see this system's *previous*
   * run's props as walls. The candidate would then already be unreachable, the
   * count would come out equal rather than one less, and every lamp would be
   * rejected: measured on a reused map, **12 street lamps on the first visit to the
   * town and 0 on every visit after it**, with their tiles left blocked as
   * invisible walls and construction climbing 68 ms → 307 ms by the fifth trip.
   *
   * Reconstructing the claimed set from `occupied` and `claimedElsewhere` instead
   * makes the whole placement idempotent: the same map yields the same props on
   * every trip, which is what the `IgnoringPermanent` comment on `canStandOn`
   * always promised and only half delivered.
   */
  private countReachableInterior(plan: TownPlan, blocked: TileXY | null): number {
    const { interior } = plan;
    const centre = this.gameMap.townSquareCentre;
    if (centre === undefined) return 0;
    const seen = new Set<string>();
    const queue: TileXY[] = [centre];
    seen.add(tileKey(centre.x, centre.y));
    let count = 0;
    while (queue.length > 0) {
      // `pop` rather than `shift`: this is a connectivity count, so the traversal
      // order is irrelevant and `shift` is quadratic on an array queue.
      const tile = queue.pop();
      if (tile === undefined) break;
      count++;
      for (const [dx, dy] of CARDINALS) {
        const nx = tile.x + dx;
        const ny = tile.y + dy;
        if (nx < interior.x || ny < interior.y) continue;
        if (nx >= interior.x + interior.w || ny >= interior.y + interior.h) continue;
        if (blocked !== null && nx === blocked.x && ny === blocked.y) continue;
        const key = tileKey(nx, ny);
        if (seen.has(key)) continue;
        if (this.occupied.has(key) || this.claimedElsewhere.has(key)) continue;
        if (!this.gameMap.isWalkableIgnoringPermanent(nx, ny)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    return count;
  }
}

const CARDINALS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Lamp positions along a street's two kerbs, alternating sides so the street is
 * lit down its length rather than in facing pairs.
 *
 * A street rectangle is longer than it is wide, and which axis that is decides
 * which two edges are kerbs. A square one would be a plaza, not a street, and
 * the `TownPlan` has none.
 */
function kerbSites(bounds: TileRect): TileXY[] {
  const sites: TileXY[] = [];
  const horizontal = bounds.w >= bounds.h;
  const length = horizontal ? bounds.w : bounds.h;
  const nearEdge = horizontal ? bounds.y : bounds.x;
  const farEdge = horizontal ? bounds.y + bounds.h - 1 : bounds.x + bounds.w - 1;
  let step = 0;
  for (
    let along = LAMP_END_MARGIN_TILES;
    along <= length - 1 - LAMP_END_MARGIN_TILES;
    along += LAMP_STRIDE_TILES
  ) {
    const edge = step % 2 === 0 ? nearEdge : farEdge;
    const start = horizontal ? bounds.x : bounds.y;
    sites.push(horizontal ? { x: start + along, y: edge } : { x: edge, y: start + along });
    step++;
  }
  return sites;
}

/**
 * The manifest keys of the baked sheets these props draw from, generated by
 * `scripts/generate-townscape-sprites.ts` and `generate-over-city-sprites.ts`.
 *
 * The span-carrying keys are built rather than listed because the generator
 * builds them the same way, from the same plan: a gateway's picture depends on
 * how wide its opening is, so the span is part of what names it. Move a gate and
 * both sides follow, as long as the sheets are regenerated.
 */
const SHOP_SIGN_SHEET_KEY = 'shop_sign';
const STREET_LAMP_SHEET_KEY = 'street_lamp';
const CLUTTER_SHEET_KEY = 'town_clutter';
const SIGNPOST_SHEET_KEY = 'over_city_signpost';

/** A gateway is one picture, so its sheet has a single frame. */
const GATE_ARCH_FRAME = 0;

function gateArchSheetKey(axis: GateArchAxis, spanTiles: number): string {
  return `gate_arch_${axis}_${spanTiles}`;
}

function buntingSheetKey(spanTiles: number): string {
  return `bunting_${spanTiles}`;
}

function laundryLineSheetKey(spanTiles: number): string {
  return `laundry_line_${spanTiles}`;
}

/**
 * A sign board bolted to the facade beside a building's door.
 *
 * Its anchor is the **door tile**, which is the building's own front row, so the
 * scene's Y-sort places it against the facade's visual foot — behind a player
 * standing on the street below and in front of the wall it is bolted to.
 * Measured at a 32 px tile, the art reaches 1.47 tiles above the anchor and
 * 1.03 tiles west of it — 2.03 for the two wide doorways, which shift the whole
 * sign a tile further —
 * comfortably inside `RenderPipeline`'s 4-tile prop cull margin.
 *
 * The frame counter is read through a callback rather than copied in, because a
 * prop is constructed once and the system that animates it ticks every frame.
 */
class ShopSignProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly emblem: ShopSignEmblem,
    private readonly westShiftTiles: number,
    private readonly swayPhase: number,
    private readonly currentFrame: () => number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const step = shopSignSwayStep(this.currentFrame(), this.swayPhase);
    // The west shift is applied here rather than baked, because it is a whole-sign
    // translation: the fronts that need it would otherwise double the sheet for a
    // picture identical but for its position.
    const shift = tileSize * this.westShiftTiles;
    drawTownSheetFrame(
      ctx,
      SHOP_SIGN_SHEET_KEY,
      `sway_${step}`,
      SHOP_SIGN_EMBLEMS.indexOf(this.emblem),
      this.tile.x * tileSize - camX - shift,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/** A piece of yard or street clutter, standing on and blocking its own tile. */
class ClutterProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly kind: TownClutterKind,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      CLUTTER_SHEET_KEY,
      'idle',
      TOWN_CLUTTER_KINDS.indexOf(this.kind),
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/**
 * A custom-frame fixture — an awning post, a perch, the field shelter —
 * standing on and blocking its own tile. Single state, single frame: none of
 * these three animate.
 */
class FixtureProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly sheetKey: string,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      this.sheetKey,
      'idle',
      0,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/**
 * A washing line spanning an alley.
 *
 * Its anchor is the tile at the line's **west end**, and it reaches `spanTiles`
 * east of that and about a tile above it — so it declares its own cull margin
 * rather than relying on the default, which is measured against the anchor and
 * knows nothing about how far a prop spans.
 */
class LaundryLineProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly currentFrame: () => number,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + SPANNING_PROP_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      laundryLineSheetKey(this.spanTiles),
      'idle',
      laundryLineSwayStep(this.currentFrame()),
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/**
 * A fingerpost standing on and blocking its own tile.
 *
 * Carries its index into `PLANNED_SIGNPOSTS` rather than its arms: the labels
 * are baked into the sheet, and the arms are sized by measuring them, so at
 * render time a post is nothing but which of the three pictures it is.
 */
class SignpostProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly plannedIndex: number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      SIGNPOST_SHEET_KEY,
      'idle',
      this.plannedIndex,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/**
 * A stone gateway, anchored at its west (face-on) or north (top-down) jamb.
 *
 * Measured ink at a 32 px tile, anchor-relative: the face-on arch reaches 2.84
 * tiles north and 4.72 east; the top-down gatehouse reaches 4.81 south. Both are
 * outside `RenderPipeline`'s 4-tile default, which is why this class declares its
 * own margin rather than relying on it.
 */
class GateArchProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly axis: GateArchAxis,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + GATEWAY_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      gateArchSheetKey(this.axis, this.spanTiles),
      'idle',
      GATE_ARCH_FRAME,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/** A string of pennants across a street, anchored at its west end. */
class BuntingProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly colorPhase: number,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + SPANNING_PROP_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      buntingSheetKey(this.spanTiles),
      'idle',
      this.colorPhase,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

/**
 * A lit lamp standing on its own tile.
 *
 * Measured ink, at a 32 px tile: 2.63 tiles above the anchor — more than the
 * 2.3 the geometry constants alone give, because the flame's halo is a
 * `shadowBlur` and blur is not in the geometry — a quarter of a tile past each
 * side, and 3 px below, which is the ground shadow. All inside the 4-tile cull
 * margin, with room to spare.
 */
class StreetLampProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly flickerPhase: number,
    private readonly currentFrame: () => number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      STREET_LAMP_SHEET_KEY,
      'idle',
      streetLampFlickerStep(this.currentFrame(), this.flickerPhase),
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}
