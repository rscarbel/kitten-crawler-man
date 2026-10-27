/**
 * Who stands in each of the town's buildings, as data: one `OccupantSpec` per
 * person, in five orthogonal parts.
 *
 * - `placement` — where they stand: beside a kind of furniture the room is
 *   scanned for (`anchor`), on one side of a named prop (`prop`), or on the
 *   room's open middle (`roam`).
 * - `territory` — how far they drift from there. Defaults to the activity's
 *   radius for a posted occupant and the whole room for a roamer.
 * - `figure` — what they are drawn as: a citizen cast look (the default) or a
 *   bespoke resident painter from `BESPOKE_RESIDENT_FIGURES`.
 * - `routine` — an optional behaviour layered on the idle and wander loop.
 * - `service` — what talking to them opens, when they keep a counter.
 *
 * Kept apart from `InteriorOccupantSystem` so the audio preloader can ask what
 * a building sells without importing the people who sell it.
 */

import type { TownRole } from '../sprites/person/PersonAppearance';
import { CLOAK_AND_DAGGER_NAME, type TilePoint } from '../map/town/townPlan';
import { CLUB_HOST_MARK } from '../core/club/clubLayout';
import type { TownInteriorPropId } from '../sprites/art/townInterior/townInteriorProps';
import type { BespokeResidentFigureId } from '../creatures/bespokeResidentFigures';
import type { AnchorKind } from './InteriorOccupantSystem';
import type { BuildingEntry } from './BuildingSystem';
import type { ResidentId } from './townResidents';
import type { TownSpecies } from './townSpecies';
import type { OccupantService } from './townServices';
import type { OccupantRoutine } from './occupantRoutines';

/** What a posted occupant is doing — drives how far they drift by default and how long they linger. */
export type StationedActivity =
  'work_forge' | 'tend_counter' | 'sit_at_table' | 'browse_shelf' | 'sweep' | 'wander' | 'idle';

/** Where in the room this occupant belongs, when the room's furniture alone does not say. */
export type OccupantPost = 'north' | 'south' | 'east' | 'west' | 'centre' | 'door' | 'back';

/** A side of a prop's footprint. */
export type PropSide = 'north' | 'south' | 'east' | 'west';

/**
 * Where an occupant is first stood.
 *
 * `anchor` takes a free tile beside the first piece of a furniture kind the
 * room is scanned for, `post` biasing which piece. `prop` stands on the named
 * side of a placed prop, centred on its footprint, shifted along that side by
 * `offset` tiles (east or south positive) and `distance` tiles out from it (1,
 * the default, is the row or column touching it); `post` picks among several
 * of the same prop. `mark` stands them on one authored tile, facing
 * `faces`, for a room laid out by hand whose furniture is not scanned (the
 * Cloak & Dagger's), and drops them when that tile is solid or reserved.
 * `roam` starts on the open floor nearest the room's middle.
 */
export type OccupantPlacement =
  | {
      readonly kind: 'anchor';
      readonly anchor: AnchorKind;
      readonly post?: OccupantPost;
      readonly activity: StationedActivity;
    }
  | {
      readonly kind: 'prop';
      readonly prop: TownInteriorPropId;
      readonly side: PropSide;
      readonly offset?: number;
      readonly distance?: number;
      readonly post?: OccupantPost;
      readonly activity: StationedActivity;
    }
  | {
      readonly kind: 'mark';
      readonly tile: TilePoint;
      readonly faces: PropSide;
      readonly activity: StationedActivity;
    }
  | { readonly kind: 'roam' };

/**
 * How far an occupant may drift from where they were stood. A `rect` is given
 * in whole tiles from the stand tile, each extent zero or more, so it always
 * contains the stand. `room` is the largest stretch of open floor the party
 * can reach, and an occupant on it holds still while the player is near.
 */
export type OccupantTerritory =
  | { readonly kind: 'radius'; readonly tiles: number }
  | {
      readonly kind: 'rect';
      readonly west: number;
      readonly east: number;
      readonly north: number;
      readonly south: number;
    }
  | { readonly kind: 'room' };

/** What an occupant is drawn as. */
export type OccupantFigure =
  { readonly kind: 'citizen' } | { readonly kind: 'bespoke'; readonly id: BespokeResidentFigureId };

export interface OccupantSpec {
  readonly role: TownRole;
  /**
   * Unnamed occupants carry their own species here — see `townResidents.ts`'s
   * cast table for what each room's roster is meant to be. Ignored (and not
   * needed) when `residentId` is set: a named resident's species comes from
   * their own `ResidentDef` instead, so it can never drift from theirs.
   * Defaults to `DEFAULT_TOWN_SPECIES` when omitted.
   */
  readonly species?: TownSpecies;
  /**
   * Names this occupant as a specific resident (see `townResidents.ts`). A
   * resident whose placement finds nothing is stood against any furniture in
   * the room instead: an unnamed extra can be dropped without anyone noticing,
   * but a missing bookshelf must not delete a resident.
   */
  readonly residentId?: ResidentId;
  readonly placement: OccupantPlacement;
  readonly territory?: OccupantTerritory;
  readonly figure?: OccupantFigure;
  readonly routine?: OccupantRoutine;
  readonly service?: OccupantService;
}

/**
 * Sydney stands over the east half of her desk, so the west half of the row
 * behind it stays open as the walk from the lane to the flags beyond.
 */
const MERC_DESK_MANAGER_OFFSET = 1;

/** A patron seated at whichever table the room's anchor cursor hands them. */
const AT_TABLE: OccupantPlacement = { kind: 'anchor', anchor: 'table', activity: 'sit_at_table' };
/** Somebody drifting between the tables rather than sitting at one. */
const WANDERING_THE_TABLES: OccupantPlacement = {
  kind: 'anchor',
  anchor: 'table',
  activity: 'wander',
};

/**
 * A pub's janitor: mops their way round the whole room and works the floor
 * wherever they stop.
 */
const JANITOR = {
  role: 'laborer',
  placement: { kind: 'roam' },
  territory: { kind: 'room' },
  figure: { kind: 'bespoke', id: 'janitor' },
  routine: { kind: 'mop' },
} as const satisfies OccupantSpec;

/**
 * How far in front of his target Steve Cartwright shoots from: far enough
 * that the lane reads as a range, close enough that it fits the workshop's
 * floor.
 */
const CARTWRIGHT_SHOOTING_DISTANCE_TILES = 4;

/**
 * Occupants for each marquee building, keyed by the name `GameMap.generateInterior`
 * lays out. `scripts/verify-interiors.ts` checks it headlessly against the
 * resident registry and the generated rooms.
 */
export const BUILDING_OCCUPANTS = new Map<string, ReadonlyArray<OccupantSpec>>(
  Object.entries({
    // A garrison man waiting on his steel, because the smith's whole story is
    // that she reads the garrison's damage before the garrison admits to it.
    //
    // Varga anchors on the shop counter, not on the forge. Every brazier in the
    // room is north of the partition wall, so a forge anchor stationed her in
    // the forge hall — through a doorway from the room the player spawns into,
    // with nobody at all behind the counter they walk up to. The counter is the
    // point of the two-room layout: the customer never has to walk into the
    // quench to be served.
    'The Rusty Anvil': [
      {
        role: 'smith',
        placement: {
          kind: 'anchor',
          anchor: 'counter',
          // East rather than `back`, though `back` is what a counter usually
          // takes: this counter run is one row, so "deepest into the room" only
          // means its far west corner, five tiles from the door. The east end is
          // the end the street door opens onto.
          post: 'east',
          activity: 'tend_counter',
        },
        residentId: 'smith_varga',
        service: { surface: 'menu', counter: 'smithy', verb: 'Sharpen' },
      },
      {
        role: 'laborer',
        placement: { kind: 'anchor', anchor: 'crate', activity: 'idle' },
        species: 'hawkfolk',
      },
      {
        role: 'guard',
        placement: { kind: 'anchor', anchor: 'table', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    // The town's safe room, so the taproom is where the whole roster lives.
    // Every post here points south for one reason: the guest rooms upstairs are
    // rented, and a room a crawler has paid for should not have a stranger
    // standing in it when they open the door.
    'The Sleeping Cat Inn': [
      {
        role: 'innkeeper',
        placement: { kind: 'anchor', anchor: 'counter', post: 'back', activity: 'tend_counter' },
        residentId: 'innkeep_ossie',
        service: { surface: 'menu', counter: 'inn', verb: 'Order' },
      },
      {
        role: 'drunk',
        placement: { kind: 'anchor', anchor: 'table', post: 'south', activity: 'sit_at_table' },
        species: 'human',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'table', post: 'south', activity: 'sit_at_table' },
        species: 'hawkfolk',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'table', post: 'west', activity: 'sit_at_table' },
        species: 'human',
      },
      {
        role: 'child',
        placement: { kind: 'anchor', anchor: 'crate', post: 'south', activity: 'sweep' },
        species: 'hawkfolk',
      },
      {
        role: 'noble',
        placement: { kind: 'anchor', anchor: 'counter', post: 'door', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    // The mead hall: a full house down both sides of the feast table.
    'The Horned Flagon': [
      {
        role: 'innkeeper',
        placement: { kind: 'anchor', anchor: 'counter', post: 'back', activity: 'tend_counter' },
        residentId: 'innkeep_brend',
        service: { surface: 'menu', counter: 'tavern', verb: 'Order' },
      },
      { role: 'laborer', placement: AT_TABLE, species: 'human' },
      { role: 'laborer', placement: AT_TABLE, species: 'human' },
      { role: 'drunk', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'drunk', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'commoner', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'commoner', placement: AT_TABLE, species: 'human' },
      { role: 'noble', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'beggar', placement: WANDERING_THE_TABLES, species: 'human' },
      { ...JANITOR, residentId: 'janitor_grout' },
    ],
    // The dive: rowdier and drunker than the mead hall, packed into a smaller room.
    'The Sunken Stump Pub': [
      {
        role: 'innkeeper',
        placement: { kind: 'anchor', anchor: 'counter', post: 'back', activity: 'tend_counter' },
        residentId: 'innkeep_marlow',
        service: { surface: 'menu', counter: 'tavern', verb: 'Order' },
      },
      { role: 'drunk', placement: AT_TABLE, species: 'human' },
      { role: 'drunk', placement: AT_TABLE, species: 'human' },
      { role: 'drunk', placement: AT_TABLE, species: 'human' },
      { role: 'laborer', placement: AT_TABLE, species: 'human' },
      { role: 'commoner', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'noble', placement: AT_TABLE, species: 'hawkfolk' },
      { role: 'beggar', placement: WANDERING_THE_TABLES, species: 'human' },
      { ...JANITOR, residentId: 'janitor_puddles' },
    ],
    // The child is Corvin, who wants to be a crawler and whose mother hates it.
    "Miller's Farm": [
      {
        role: 'farmer',
        placement: { kind: 'anchor', anchor: 'hearth', post: 'centre', activity: 'idle' },
        residentId: 'marta_miller',
        service: { surface: 'menu', counter: 'miller_kitchen', verb: 'Eat' },
      },
      { role: 'commoner', placement: AT_TABLE, species: 'human' },
      { role: 'child', placement: WANDERING_THE_TABLES, species: 'human' },
    ],
    // A customer waiting at the counter, so the apothecary reads as a shop with trade.
    'Herb & Remedy': [
      {
        role: 'merchant',
        placement: { kind: 'anchor', anchor: 'counter', post: 'back', activity: 'tend_counter' },
        residentId: 'apothecary_fen',
        service: { surface: 'menu', counter: 'apothecary', verb: 'Buy' },
      },
      {
        role: 'priest',
        placement: { kind: 'anchor', anchor: 'shelf', activity: 'browse_shelf' },
        species: 'hawkfolk',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'counter', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    'Plumbline Farm': [
      {
        role: 'farmer',
        placement: { kind: 'anchor', anchor: 'hearth', post: 'centre', activity: 'idle' },
        residentId: 'wendell',
        service: { surface: 'menu', counter: 'plumbline_hayloft', verb: 'Rest' },
      },
      {
        role: 'child',
        placement: { kind: 'anchor', anchor: 'table', activity: 'sweep' },
        species: 'human',
      },
    ],
    "Cartwright's Workshop": [
      {
        role: 'laborer',
        placement: {
          kind: 'prop',
          prop: 'target_board',
          side: 'west',
          distance: CARTWRIGHT_SHOOTING_DISTANCE_TILES,
          activity: 'idle',
        },
        residentId: 'steve_cartwright',
        figure: { kind: 'bespoke', id: 'steve_cartwright' },
        routine: { kind: 'target_practice', targetProp: 'target_board' },
        service: { surface: 'menu', counter: 'cartwright', verb: 'Buy' },
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'crate', activity: 'idle' },
        species: 'hawkfolk',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'crate', activity: 'browse_shelf' },
        species: 'hawkfolk',
      },
    ],
    // Kestrel is this room's only counter occupant — `ShopSystem` draws no
    // figure of its own; it reads her position off the `Townsperson`
    // this spec places (`BuildingInteriorScene` wires it through with
    // `ShopSystem.setKeeper`) for its "Shop" prompt and interact range, so she
    // is rendered exactly once, by the occupant system's own Y-sorted pass.
    'General Store': [
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'shelf', post: 'back', activity: 'browse_shelf' },
        residentId: 'stock_clerk_wick',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'shelf', activity: 'browse_shelf' },
        species: 'hawkfolk',
      },
      {
        role: 'laborer',
        placement: { kind: 'anchor', anchor: 'crate', activity: 'idle' },
        species: 'human',
      },
      {
        role: 'merchant',
        placement: { kind: 'anchor', anchor: 'counter', activity: 'tend_counter' },
        residentId: 'keeper_brenna_kestrel',
      },
    ],
    // Somebody is always waiting on a charm, which is how a cottage with one
    // occupant reads as a practice rather than as a spare room.
    //
    // Lori roams rather than keeping a post: every piece of furniture she could
    // be stationed at is heaped against a wall, and posted at any of them she
    // stood tucked into a corner behind the worktable where the player had to
    // hunt for a way up to her. Her readings, her repair errand and her lore all
    // start by talking to her, so she has to be the easiest thing in the room to
    // reach.
    "Old Lori's Cottage": [
      {
        role: 'priest',
        placement: { kind: 'roam' },
        residentId: 'old_lori',
        figure: { kind: 'bespoke', id: 'old_lori' },
        service: { surface: 'reading', verb: 'Reading' },
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'hearth', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    // Aviel keeps the strip of dais in front of the altar, which stands
    // against the north wall under the sky window: the blessing is offered
    // where the aisle ends, and he never strays off the dais into the nave.
    'Temple of the Sky': [
      {
        role: 'priest',
        placement: { kind: 'prop', prop: 'altar', side: 'south', activity: 'tend_counter' },
        territory: { kind: 'rect', west: 1, east: 2, north: 0, south: 0 },
        residentId: 'deacon_aviel',
        service: { surface: 'menu', counter: 'temple_blessing', verb: 'Pray' },
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'shelf', activity: 'browse_shelf' },
        species: 'human',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'forge', activity: 'idle' },
        species: 'human',
      },
    ],
    // The inking shop. Nim works in front of the alcove's side table and keeps
    // to the alcove's bottom rows: the work is private, and a tattooist
    // standing among the people waiting is a shop, not a parlour. Posted north
    // because the waiting room has a side table too.
    //
    // Both customers wait at the waiting room's tables. Placement by prop
    // runs before anchors and claims the alcove table for Nim, so a `table`
    // anchor can only ever find the waiting room's.
    'The Quiet Needle': [
      {
        role: 'merchant',
        placement: {
          kind: 'prop',
          prop: 'side_table',
          side: 'south',
          post: 'north',
          activity: 'work_forge',
        },
        territory: { kind: 'rect', west: 5, east: 0, north: 0, south: 1 },
        residentId: 'tattooist_nim',
        service: { surface: 'menu', counter: 'tattoo_parlour', verb: 'Get inked' },
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'table', post: 'south', activity: 'idle' },
        species: 'human',
      },
      {
        role: 'drunk',
        placement: { kind: 'anchor', anchor: 'table', post: 'south', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    // The garrison. Two counters, so two named staff: Dann west behind the
    // armoury run, Pell east on the sand where the dummies are. The recruits
    // on the sand are townsfolk who have not been given the title yet. The
    // mercenaries rent the east end of the muster hall, and Sydney keeps
    // their hire desk there, behind it and never out from it.
    'The Barracks': [
      {
        role: 'merchant',
        placement: {
          kind: 'anchor',
          anchor: 'counter',
          // North rather than west, though his counter is the room's west wall:
          // the run's west end has the stock barrels stacked behind it, so the
          // stand search can only find him a tile on the *customer's* side of his
          // own counter. The north end opens onto the alley the run pens off,
          // which is where a quartermaster belongs.
          post: 'north',
          activity: 'tend_counter',
        },
        residentId: 'quartermaster_dann',
        service: { surface: 'menu', counter: 'armoury', verb: 'Requisition' },
      },
      {
        role: 'guard',
        placement: { kind: 'anchor', anchor: 'dummy', post: 'east', activity: 'idle' },
        residentId: 'corporal_pell',
        service: { surface: 'menu', counter: 'drill_yard', verb: 'Train' },
      },
      {
        role: 'merchant',
        placement: {
          kind: 'prop',
          prop: 'merc_desk',
          side: 'north',
          offset: MERC_DESK_MANAGER_OFFSET,
          activity: 'tend_counter',
        },
        territory: { kind: 'radius', tiles: 0 },
        figure: { kind: 'bespoke', id: 'sydney' },
        residentId: 'sydney',
        service: { surface: 'desk', desk: 'mercenary_guild', verb: 'Hire' },
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'dummy', post: 'east', activity: 'wander' },
        species: 'human',
      },
      {
        role: 'drunk',
        placement: { kind: 'anchor', anchor: 'table', post: 'south', activity: 'sit_at_table' },
        species: 'human',
      },
      {
        role: 'laborer',
        placement: { kind: 'anchor', anchor: 'crate', post: 'west', activity: 'idle' },
        species: 'human',
      },
      {
        role: 'commoner',
        placement: { kind: 'anchor', anchor: 'board', post: 'south', activity: 'idle' },
        species: 'hawkfolk',
      },
    ],
    'Blackwood Lodge': [
      {
        role: 'guard',
        placement: { kind: 'anchor', anchor: 'table', post: 'centre', activity: 'idle' },
        residentId: 'sgt_kessler',
      },
      {
        role: 'guard',
        placement: { kind: 'anchor', anchor: 'crate', activity: 'wander' },
        species: 'human',
      },
    ],
    // The club's host, greeting the door from behind his stand. His territory
    // is the row behind the stand and nothing else: a host who wanders off his
    // book leaves the door unanswered.
    [CLOAK_AND_DAGGER_NAME]: [
      {
        role: 'noble',
        placement: { kind: 'mark', tile: CLUB_HOST_MARK, faces: 'south', activity: 'tend_counter' },
        territory: { kind: 'rect', west: 0, east: 1, north: 0, south: 0 },
        residentId: 'brandon',
        figure: { kind: 'bespoke', id: 'brandon' },
      },
    ],
  } satisfies Record<string, ReadonlyArray<OccupantSpec>>),
);

/** Light company for the town-service interiors, which already have their own scripted NPCs. */
export const TYPE_OCCUPANTS: Partial<Record<BuildingEntry['type'], ReadonlyArray<OccupantSpec>>> = {
  store: [
    { role: 'commoner', placement: { kind: 'anchor', anchor: 'shelf', activity: 'browse_shelf' } },
  ],
};
