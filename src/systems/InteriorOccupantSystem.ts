/**
 * Populates a building's interior with role-appropriate occupants who perform
 * stationed activities — a smith at the forge, patrons at the tables, a barkeep
 * behind the counter — so walking in feels rewarding rather than like touring an
 * empty diorama. Owned by `BuildingInteriorScene` and the interior analog of
 * `TownLifeSystem`: instead of free-roaming a plaza, each occupant is anchored to
 * a piece of the hand-crafted furniture and only shuffles within a small radius
 * of it. The exception is a roamer (`roam_room`), who belongs to the whole room
 * rather than to one piece of it and strolls its open floor.
 *
 * Anchors are *derived* from the generated interior, not hard-coded: the system
 * scans the finished grid for furniture (forge braziers, hearths, tables,
 * shelves, counters) and stands each occupant on a walkable tile beside the
 * relevant piece. That keeps this decoupled from the exact column/row constants
 * inside `GameMap.generateInterior` — re-arrange a room and the occupants follow
 * the furniture.
 *
 * Never constructed for a live quest-encounter interior (the Big Top maze, cult
 * hideout, tower confrontation): the scene passes `null` occupants whenever its
 * combat stack is active, mirroring the gate `initEntryEncounter` uses.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { findPartyArrivalTiles, hasRoomToMove } from '../map/findWalkableTile';
import { SOUTHWARD_PROBE_DROP } from '../map/collisionAnchors';
import { Townsperson } from '../creatures/Townsperson';
import { CITIZEN_TALK_RADIUS_TILES, findNearestTownsperson } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { TownRole } from '../sprites/person/PersonAppearance';
import type { Facing } from '../sprites/person/skeleton';
import {
  BRAZIER,
  FIREPLACE,
  TABLE,
  BOOKSHELF,
  CRATE,
  BARREL,
  INTERIOR_COUNTER,
  INTERIOR_WALL,
  MAP_TABLE,
  TRAINING_DUMMY,
  MUSTER_BOARD,
  INK_BENCH,
} from '../map/tileTypes';
import type { BuildingEntry } from './BuildingSystem';
import type { GameSystem } from './GameSystem';
import { residentById, residentSpecies, type ResidentId } from './townResidents';
import { DEFAULT_TOWN_SPECIES, type TownSpecies } from './townSpecies';
import { safeRoomAnchorTiles } from './SafeRoomSystem';
import { anchorCursorForBuilding } from './interiorPlacement';
import { TOWN_INTERIOR_PROPS } from '../sprites/art/townInterior/townInteriorProps';

/** Which furniture a role stations beside; resolved to concrete tiles by scanning the room. */
export type AnchorKind =
  'forge' | 'hearth' | 'table' | 'shelf' | 'counter' | 'crate' | 'dummy' | 'board' | 'bench';

/** What a stationed occupant is doing — drives how far they drift from their post and how long they linger. */
type StationedActivity =
  'work_forge' | 'tend_counter' | 'sit_at_table' | 'browse_shelf' | 'sweep' | 'wander' | 'idle';

/** Where in the room this occupant belongs, when the room's furniture alone does not say. */
export type OccupantPost = 'north' | 'south' | 'east' | 'west' | 'centre' | 'door' | 'back';

interface OccupantIdentity {
  role: TownRole;
  /**
   * Unnamed occupants carry their own species here — see `townResidents.ts`'s
   * cast table for what each room's roster is meant to be. Ignored (and not
   * needed) when `residentId` is set: a named resident's species comes from
   * their own `ResidentDef` instead, so it can never drift from theirs.
   * Defaults to `DEFAULT_TOWN_SPECIES` when omitted.
   */
  species?: TownSpecies;
  /**
   * Names this occupant as a specific resident (see `townResidents.ts`). A
   * stationed spec carrying one is placed against any furniture in the room
   * rather than only its preferred anchor: an unnamed extra can be dropped
   * without anyone noticing, but a missing bookshelf must not delete a resident.
   */
  residentId?: ResidentId;
}

/** An occupant posted beside one piece of furniture, drifting only a little way from it. */
export interface StationedOccupantSpec extends OccupantIdentity {
  activity: StationedActivity;
  anchor: AnchorKind;
  /**
   * Biases which piece of the anchor group this occupant takes. Without it the
   * group is walked in raw scan order, which is row-major from the north-west —
   * so the first spec in every roster took the north-westmost table in the room
   * and the whole town's shopkeepers stood in the same corner.
   */
  post?: OccupantPost;
}

/**
 * An occupant who belongs to no one piece of furniture and potters about the
 * whole of the room's open floor instead. Starts on the open tile nearest the
 * room's centre, and stands still whenever the player comes within
 * {@link ROAMER_HOLD_RADIUS_TILES}, so walking up to them always ends with them
 * in reach rather than strolling off mid-approach.
 */
export interface RoamingOccupantSpec extends OccupantIdentity {
  activity: 'roam_room';
}

export type OccupantSpec = StationedOccupantSpec | RoamingOccupantSpec;

/** The furniture a spec is stationed at, or null for an occupant who roams the room. */
export function occupantAnchor(spec: OccupantSpec): AnchorKind | null {
  return spec.activity === 'roam_room' ? null : spec.anchor;
}

/**
 * The furniture tile types each anchor kind matches. Ordered as a list so the
 * furniture scan can iterate kinds without an unsound `Object.keys` cast.
 *
 * A shop counter and a tavern bar are their own tile type, not walls, and the
 * `counter` entry must name that type. A list that matches nothing fails
 * silently: `forBuilding` drops an occupant whose anchor group is empty without
 * a warning, so the innkeepers in all three taverns and the herbalist's
 * merchant simply do not appear behind their bars.
 *
 * Exported so `scripts/verify-interiors.ts` can ask a generated room whether it
 * actually holds the furniture its roster anchors on, which is the only way that
 * silent drop is visible from outside the game.
 */
export const ANCHOR_TILE_TYPES: ReadonlyArray<{
  kind: AnchorKind;
  types: ReadonlyArray<number>;
}> = [
  { kind: 'forge', types: [BRAZIER] },
  { kind: 'hearth', types: [FIREPLACE] },
  // A garrison's map table is a table: the room has no ordinary `TABLE` in it,
  // and an anchor group that matches nothing drops its occupant without a word.
  { kind: 'table', types: [TABLE, MAP_TABLE] },
  { kind: 'shelf', types: [BOOKSHELF] },
  { kind: 'counter', types: [INTERIOR_COUNTER] },
  { kind: 'crate', types: [CRATE, BARREL] },
  { kind: 'dummy', types: [TRAINING_DUMMY] },
  { kind: 'board', types: [MUSTER_BOARD] },
  { kind: 'bench', types: [INK_BENCH] },
];

interface ActivityBehavior {
  /** How far (tiles) the occupant may drift from its stand tile. */
  radiusTiles: number;
  pauseMin: number;
  pauseMax: number;
}

// Stationed workers barely move and pause for long stretches; roamers cover more ground more often.
const PAUSE_STATIONED_MIN = 90;
const PAUSE_STATIONED_MAX = 360;
const PAUSE_ROAMING_MIN = 30;
const PAUSE_ROAMING_MAX = 150;

const ACTIVITY_BEHAVIOR: Record<StationedActivity, ActivityBehavior> = {
  work_forge: { radiusTiles: 0.6, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  tend_counter: { radiusTiles: 0.5, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  sit_at_table: { radiusTiles: 0.4, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  browse_shelf: { radiusTiles: 0.9, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_STATIONED_MIN },
  idle: { radiusTiles: 0.6, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  sweep: { radiusTiles: 1.8, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_ROAMING_MAX },
  wander: { radiusTiles: 2.6, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_ROAMING_MAX },
};

/**
 * Occupants for each marquee building, keyed by the name `GameMap.generateInterior`
 * lays out. Exported so `scripts/verify-interiors.ts` can check it headlessly
 * against the service and resident registries — a service whose role nobody in
 * the room has is a counter with nobody behind it, and the game says nothing.
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
        activity: 'tend_counter',
        anchor: 'counter',
        // East rather than `back`, though `back` is what a counter usually
        // takes: this counter run is one row, so "deepest into the room" only
        // means its far west corner, five tiles from the door. The east end is
        // the end the street door opens onto.
        post: 'east',
        residentId: 'smith_varga',
      },
      { role: 'laborer', activity: 'idle', anchor: 'crate', species: 'skyfowl' },
      { role: 'guard', activity: 'idle', anchor: 'table', species: 'skyfowl' },
    ],
    // The town's safe room, so the taproom is where the whole roster lives.
    // Every post here points south for one reason: the guest rooms upstairs are
    // rented, and a room a crawler has paid for should not have a stranger
    // standing in it when they open the door.
    'The Sleeping Cat Inn': [
      {
        role: 'innkeeper',
        activity: 'tend_counter',
        anchor: 'counter',
        post: 'back',
        residentId: 'innkeep_ossie',
      },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', post: 'south', species: 'human' },
      {
        role: 'commoner',
        activity: 'sit_at_table',
        anchor: 'table',
        post: 'south',
        species: 'skyfowl',
      },
      {
        role: 'commoner',
        activity: 'sit_at_table',
        anchor: 'table',
        post: 'west',
        species: 'human',
      },
      { role: 'child', activity: 'sweep', anchor: 'crate', post: 'south', species: 'skyfowl' },
      { role: 'noble', activity: 'idle', anchor: 'counter', post: 'door', species: 'skyfowl' },
    ],
    // The mead hall: a full house down both sides of the feast table.
    'The Horned Flagon': [
      {
        role: 'innkeeper',
        activity: 'tend_counter',
        anchor: 'counter',
        post: 'back',
        residentId: 'innkeep_brend',
      },
      { role: 'laborer', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'laborer', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'noble', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'beggar', activity: 'wander', anchor: 'table', species: 'human' },
    ],
    // The dive: rowdier and drunker than the mead hall, packed into a smaller room.
    'The Sunken Stump Pub': [
      {
        role: 'innkeeper',
        activity: 'tend_counter',
        anchor: 'counter',
        post: 'back',
        residentId: 'innkeep_marlow',
      },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'laborer', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'noble', activity: 'sit_at_table', anchor: 'table', species: 'skyfowl' },
      { role: 'beggar', activity: 'wander', anchor: 'table', species: 'human' },
    ],
    // The child is Corvin, who wants to be a crawler and whose mother hates it.
    "Miller's Farm": [
      {
        role: 'farmer',
        activity: 'idle',
        anchor: 'hearth',
        post: 'centre',
        residentId: 'marta_miller',
      },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table', species: 'human' },
      { role: 'child', activity: 'wander', anchor: 'table', species: 'human' },
    ],
    // A customer waiting at the counter, so the apothecary reads as a shop with trade.
    'Herb & Remedy': [
      {
        role: 'merchant',
        activity: 'tend_counter',
        anchor: 'counter',
        post: 'back',
        residentId: 'apothecary_fen',
      },
      { role: 'priest', activity: 'browse_shelf', anchor: 'shelf', species: 'skyfowl' },
      { role: 'commoner', activity: 'idle', anchor: 'counter', species: 'skyfowl' },
    ],
    'Plumbline Farm': [
      { role: 'farmer', activity: 'idle', anchor: 'hearth', post: 'centre', residentId: 'wendell' },
      { role: 'child', activity: 'sweep', anchor: 'table', species: 'human' },
    ],
    // Only Brann is a laborer here, and that is load-bearing: the workshop's
    // service is keyed on the laborer role, so a second one would sell Brann's
    // dynamite anonymously, with none of his lines. `verify-interiors` guards it.
    "Cartwright's Workshop": [
      {
        role: 'laborer',
        activity: 'idle',
        anchor: 'table',
        post: 'north',
        residentId: 'brann_cartwright',
      },
      { role: 'commoner', activity: 'idle', anchor: 'crate', species: 'skyfowl' },
      { role: 'commoner', activity: 'browse_shelf', anchor: 'crate', species: 'skyfowl' },
    ],
    // Kestrel is this room's only counter occupant — `ShopSystem` draws no
    // figure of its own; it reads her position off the `Townsperson`
    // this spec places (`BuildingInteriorScene` wires it through with
    // `ShopSystem.setKeeper`) for its "Shop" prompt and interact range, so she
    // is rendered exactly once, by this system's own Y-sorted pass.
    'General Store': [
      {
        role: 'commoner',
        activity: 'browse_shelf',
        anchor: 'shelf',
        post: 'back',
        residentId: 'stock_clerk_wick',
      },
      { role: 'commoner', activity: 'browse_shelf', anchor: 'shelf', species: 'skyfowl' },
      { role: 'laborer', activity: 'idle', anchor: 'crate', species: 'human' },
      {
        role: 'merchant',
        activity: 'tend_counter',
        anchor: 'counter',
        residentId: 'keeper_brenna_kestrel',
      },
    ],
    // Somebody is always waiting on a charm, which is how a cottage with one
    // occupant reads as a practice rather than as a spare room.
    //
    // Hilda roams rather than keeping a post: every piece of furniture she could
    // be stationed at is heaped against a wall, and posted at any of them she
    // stood tucked into a corner behind the worktable where the player had to
    // hunt for a way up to her. Her readings, her repair errand and her lore all
    // start by talking to her, so she has to be the easiest thing in the room to
    // reach.
    "Old Hilda's Cottage": [
      { role: 'priest', activity: 'roam_room', residentId: 'old_hilda' },
      { role: 'commoner', activity: 'idle', anchor: 'hearth', species: 'skyfowl' },
    ],
    // The priest stands at the altar (the room's only TABLE) so the blessing is
    // offered where the player naturally walks up the aisle.
    'Temple of the Sky': [
      {
        role: 'priest',
        activity: 'tend_counter',
        anchor: 'table',
        post: 'north',
        residentId: 'deacon_aviel',
      },
      { role: 'commoner', activity: 'browse_shelf', anchor: 'shelf', species: 'human' },
      { role: 'commoner', activity: 'idle', anchor: 'forge', species: 'human' },
    ],
    // The inking shop. Nim is posted north so she takes the alcove bench behind
    // its own wall rather than the waiting-room furniture — the work is private,
    // and a tattooist standing among the people waiting is a shop, not a parlour.
    //
    // Both customers anchor on the waiting room's low table, not on the bench:
    // the only `INK_BENCH` tiles in the room are the alcove's own, so a customer
    // anchored on `bench` waits *inside* the private alcove, behind a wall from
    // the room the flash art hangs in.
    'The Quiet Needle': [
      {
        role: 'merchant',
        activity: 'work_forge',
        anchor: 'bench',
        post: 'north',
        residentId: 'tattooist_nim',
      },
      { role: 'commoner', activity: 'idle', anchor: 'table', post: 'south', species: 'human' },
      { role: 'drunk', activity: 'idle', anchor: 'table', post: 'south', species: 'skyfowl' },
    ],
    // The garrison. Two counters, so two named staff: Dann west behind the
    // armoury run, Pell east on the sand where the dummies are.
    //
    // Pell is the room's only `guard`, and that is load-bearing rather than
    // thematic: the drill yard's service is keyed on the guard role, so a second
    // soldier in the room would sell Pell's training anonymously, with none of
    // his lines. The recruits on the sand are townsfolk who have not been given
    // the title yet, which is also true of them.
    'The Barracks': [
      {
        role: 'merchant',
        activity: 'tend_counter',
        anchor: 'counter',
        // North rather than west, though his counter is the room's west wall:
        // the run's west end has the stock barrels stacked behind it, so the
        // stand search can only find him a tile on the *customer's* side of his
        // own counter. The north end opens onto the alley the run pens off,
        // which is where a quartermaster belongs.
        post: 'north',
        residentId: 'quartermaster_dann',
      },
      {
        role: 'guard',
        activity: 'idle',
        anchor: 'dummy',
        post: 'east',
        residentId: 'corporal_pell',
      },
      {
        role: 'commoner',
        activity: 'wander',
        anchor: 'dummy',
        post: 'east',
        species: 'human',
      },
      {
        role: 'drunk',
        activity: 'sit_at_table',
        anchor: 'table',
        post: 'south',
        species: 'human',
      },
      { role: 'laborer', activity: 'idle', anchor: 'crate', post: 'west', species: 'human' },
      {
        role: 'commoner',
        activity: 'idle',
        anchor: 'board',
        post: 'south',
        species: 'skyfowl',
      },
    ],
    'Blackwood Lodge': [
      {
        role: 'guard',
        activity: 'idle',
        anchor: 'table',
        post: 'centre',
        residentId: 'sgt_kessler',
      },
      { role: 'guard', activity: 'wander', anchor: 'crate', species: 'human' },
    ],
  }),
);

/** Light company for the town-service interiors, which already have their own scripted NPCs. */
const TYPE_OCCUPANTS: Partial<Record<BuildingEntry['type'], ReadonlyArray<OccupantSpec>>> = {
  store: [{ role: 'commoner', activity: 'browse_shelf', anchor: 'shelf' }],
};

const TALK_RADIUS = TILE_SIZE * CITIZEN_TALK_RADIUS_TILES;

/**
 * A roaming occupant stands still while the player is this close. Wider than
 * the talk radius on purpose: at exactly the talk radius a roamer walking away
 * would stop just as they slipped out of reach, and the player would have to
 * chase the last step.
 */
export const ROAMER_HOLD_RADIUS_TILES = 2;
const ROAMER_HOLD_RADIUS = TILE_SIZE * ROAMER_HOLD_RADIUS_TILES;
/** Roamers linger between strolls about as long as a browsing shopper does. */
const ROAMER_PAUSE_MIN = PAUSE_ROAMING_MIN;
const ROAMER_PAUSE_MAX = PAUSE_STATIONED_MAX;
/**
 * Tiles around every exit tile a roamer keeps off. The exit is where the player
 * walks in and where they leave, and a figure standing on the threshold reads as
 * blocking the door even though nobody collides with townsfolk.
 */
const ROAMER_EXIT_CLEARANCE_TILES = 1;
/** Random destinations tried per stroll before a roamer settles for staying put. */
const ROAMER_TARGET_ATTEMPTS = 12;
/**
 * Spacing of the points a stroll's straight line is tested at, in world pixels.
 * Fine enough that a diagonal cannot slip between two blocked tiles' corners
 * between samples — the step itself would then refuse the move and cost the
 * roamer a pause facing a wall.
 */
const ROAMER_LINE_SAMPLE_PX = 2;
/** Frames a roamer holds still per update while the player is within reach. */
const ROAMER_HOLD_FRAMES = 1;

const OCCUPANT_SEED_BASE = 5209;
const OCCUPANT_SEED_STRIDE = 71;
const OCCUPANT_SPEED = 0.4;
const MAX_INITIAL_PAUSE = 180;
// A target counts as reached within this fraction of a tile — tight, so a small
// wander radius still registers arrivals and the occupant keeps lingering.
const ARRIVE_DIST_FRACTION = 0.35;
const ARRIVE_DIST = TILE_SIZE * ARRIVE_DIST_FRACTION;
// Rings searched outward from a furniture tile for a walkable spot to stand.
const STAND_SEARCH_RADIUS_TILES = 2;
// Attempts to sample a walkable wander target before falling back to standing put.
const WANDER_SAMPLE_ATTEMPTS = 6;
// Half a tile: from a figure's top-left draw origin to the point under its feet.
const CENTER_OFFSET = TILE_SIZE / 2;

interface TileXY {
  x: number;
  y: number;
}

function addAnchorTile(
  groups: Map<AnchorKind, TileXY[]>,
  kind: AnchorKind,
  x: number,
  y: number,
): void {
  const list = groups.get(kind) ?? [];
  list.push({ x, y });
  groups.set(kind, list);
}

/**
 * Group every interior furniture tile by the anchor kind it can host.
 *
 * Excludes the outermost ring of the grid — the border walls a room is carved
 * inside of can never hold furniture. Exported so `verify-interiors.ts` can
 * scan with these exact bounds rather than its own: a check that swept a wider
 * area than the placer would pass on furniture the placer can never see.
 *
 * Two sources feed the same groups: legacy tile types (`ANCHOR_TILE_TYPES`,
 * still how the bespoke garrison/apothecary/tattoo fixtures and a few
 * unconverted furniture pieces anchor) and placed town interior props
 * (`GameMap.placedInteriorProps`, each prop declaring its own anchor kinds).
 * A room may mix both freely — the smithy's counter is a prop, its map table
 * is still a legacy tile type, and an occupant anchored on `'table'` finds
 * either.
 */
export function scanInteriorFurniture(map: GameMap): Map<AnchorKind, TileXY[]> {
  const groups = new Map<AnchorKind, TileXY[]>();
  const structure = map.structure;
  for (let y = 1; y < structure.length - 1; y++) {
    const row = structure[y];
    for (let x = 1; x < row.length - 1; x++) {
      const type = row[x].type;
      for (const { kind, types } of ANCHOR_TILE_TYPES) {
        if (!types.includes(type)) continue;
        addAnchorTile(groups, kind, x, y);
      }
    }
  }
  for (const placed of map.placedInteriorProps) {
    const propDef = TOWN_INTERIOR_PROPS[placed.propId];
    for (const kind of propDef.anchors) addAnchorTile(groups, kind, placed.tile.x, placed.tile.y);
  }
  return groups;
}

/**
 * Where the room's roamers should hold still for — the crawler the player is
 * steering — or null when nobody is there to hold still for.
 */
export type RoamerFocus = () => { readonly x: number; readonly y: number } | null;

/** The open floor a roamer may stand on, as a list to sample and a set to test. */
interface RoamFloor {
  readonly tiles: ReadonlyArray<TileXY>;
  readonly keys: ReadonlySet<string>;
}

export class InteriorOccupantSystem implements GameSystem {
  private readonly occupants: Townsperson[] = [];
  private readonly roamers: Townsperson[] = [];
  /** Furniture tiles an occupant is stationed at, keyed `x,y`. */
  private readonly claimedFurniture = new Set<string>();

  /**
   * Builds the occupant system for a building, or returns `null` when the
   * building takes no ambient occupants (towers, the club, the Big Top, or any
   * type with no authored roster). The scene calls this only when no live quest
   * encounter owns the interior.
   *
   * @param focus - read every update; roaming occupants stand still while it is
   *   within {@link ROAMER_HOLD_RADIUS_TILES} of them.
   */
  static forBuilding(
    map: GameMap,
    type: BuildingEntry['type'],
    name: string,
    focus: RoamerFocus = () => null,
  ): InteriorOccupantSystem | null {
    if (type === 'tower' || type === 'club' || name === 'Big Top') return null;
    const specs = BUILDING_OCCUPANTS.get(name) ?? TYPE_OCCUPANTS[type];
    if (specs === undefined || specs.length === 0) return null;
    const system = new InteriorOccupantSystem(map, specs, name, focus);
    return system.occupants.length > 0 ? system : null;
  }

  private constructor(
    private readonly map: GameMap,
    specs: ReadonlyArray<OccupantSpec>,
    private readonly buildingName: string,
    private readonly focus: RoamerFocus,
  ) {
    const furniture = this.scanFurniture();
    const groupCursors = new Map<AnchorKind, number>();
    const usedStands = new Set<string>();
    const reserved = this.reservedTiles();
    const placedBySpec: Array<Townsperson | null> = specs.map(() => null);

    specs.forEach((spec, index) => {
      if (spec.activity === 'roam_room') return;
      const placement = this.placeSpec(spec, furniture, groupCursors, usedStands, reserved);
      if (placement === null) return;
      usedStands.add(tileKey(placement.stand.x, placement.stand.y));
      this.claimedFurniture.add(tileKey(placement.furniture.x, placement.furniture.y));
      placedBySpec[index] = this.makeStationedOccupant(spec, placement, index);
    });

    // Only once every stationed occupant has its stand, so the floor the
    // roamers are given already leaves those stands out.
    const openFloor = this.openRoamableTiles(reserved, usedStands);
    specs.forEach((spec, index) => {
      if (spec.activity !== 'roam_room') return;
      const floor = largestStretch(openFloor, usedStands);
      if (floor === null) return;
      const start = this.roamStartTile(floor, usedStands);
      if (start === null) return;
      usedStands.add(tileKey(start.x, start.y));
      const roamer = this.makeRoamer(spec, start, floor, index);
      this.roamers.push(roamer);
      placedBySpec[index] = roamer;
    });

    for (const occupant of placedBySpec) {
      if (occupant !== null) this.occupants.push(occupant);
    }
  }

  /**
   * The furniture this room's occupants are standing at.
   *
   * `InteriorReadableSystem` scans the same grid in the same order, so without
   * this it would sit every readable on the exact piece of furniture somebody is
   * already working at — and since talking wins the interact press over reading,
   * the readable would be unreachable.
   */
  get occupiedFurniture(): ReadonlySet<string> {
    return this.claimedFurniture;
  }

  /** The occupants, for the scene's Y-sorted interior render pass. */
  get people(): ReadonlyArray<Townsperson> {
    return this.occupants;
  }

  /** The nearest occupant the player (at world origin `x`,`y`) can talk to, or `null`. */
  findTalkTarget(x: number, y: number): Townsperson | null {
    return findNearestTownsperson(this.occupants, x, y, TALK_RADIUS);
  }

  update(): void {
    const focus = this.focus();
    if (focus !== null) {
      for (const roamer of this.roamers) {
        if (roamer.frozen) continue;
        const distance = Math.hypot(roamer.x - focus.x, roamer.y - focus.y);
        if (distance > ROAMER_HOLD_RADIUS) continue;
        // A pause rather than a freeze, so the idle loop keeps breathing and
        // the stroll resumes from wherever it was once the player moves off.
        roamer.pause = Math.max(roamer.pause, ROAMER_HOLD_FRAMES);
        roamer.faceToward(focus.x, focus.y);
      }
    }
    for (const occupant of this.occupants) occupant.update();
  }

  private scanFurniture(): Map<AnchorKind, TileXY[]> {
    return scanInteriorFurniture(this.map);
  }

  /**
   * Tiles occupants must never stand on: the entrance/exit, both players'
   * spawns, the safe room's own fixtures, and any one-tile doorway.
   *
   * The doorways matter because a partitioned interior's only route between two
   * of its rooms can be a single gap in a wall, and the stand search walks
   * outward from a piece of furniture in raw ring order — so a notice board
   * hung beside an archway hands the archway itself to whoever is reading it.
   */
  private reservedTiles(): Set<string> {
    const reserved = new Set<string>();
    for (const doorway of this.doorwayTiles()) reserved.add(tileKey(doorway.x, doorway.y));
    for (const exit of this.map._interiorExitTiles) reserved.add(tileKey(exit.x, exit.y));
    // Asked of the same helper the scene sets the party down with, so an
    // occupant never takes the tile a crawler is about to be put on.
    const arrival = findPartyArrivalTiles(this.map, this.map.startTile);
    reserved.add(tileKey(arrival.leader.x, arrival.leader.y));
    reserved.add(tileKey(arrival.follower.x, arrival.follower.y));
    // Mordecai and the sleeping bed own their tiles in a safe-room interior.
    for (const anchor of safeRoomAnchorTiles(this.map)) reserved.add(tileKey(anchor.x, anchor.y));
    return reserved;
  }

  /** Every walkable tile pinched between two walls on one axis — a gap in a partition. */
  private doorwayTiles(): TileXY[] {
    const structure = this.map.structure;
    const doorways: TileXY[] = [];
    for (let y = 1; y < structure.length - 1; y++) {
      for (let x = 1; x < structure[y].length - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        const pinchedVertically =
          structure[y - 1][x].type === INTERIOR_WALL && structure[y + 1][x].type === INTERIOR_WALL;
        const pinchedHorizontally =
          structure[y][x - 1].type === INTERIOR_WALL && structure[y][x + 1].type === INTERIOR_WALL;
        if (pinchedVertically || pinchedHorizontally) doorways.push({ x, y });
      }
    }
    return doorways;
  }

  /**
   * Places one spec against its preferred anchor, falling back to any other
   * furniture in the room when the spec names a resident — a room missing the
   * one piece of furniture a resident prefers must still contain that resident.
   */
  private placeSpec(
    spec: StationedOccupantSpec,
    furniture: ReadonlyMap<AnchorKind, TileXY[]>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
    reserved: Set<string>,
  ): { stand: TileXY; furniture: TileXY; facing: Facing } | null {
    const preferred = furniture.get(spec.anchor);
    if (preferred !== undefined && preferred.length > 0) {
      const placement = this.placeAtAnchor(
        spec.anchor,
        preferred,
        cursors,
        usedStands,
        reserved,
        spec.post,
      );
      if (placement !== null) return placement;
    }
    if (spec.residentId === undefined) return null;

    for (const { kind } of ANCHOR_TILE_TYPES) {
      if (kind === spec.anchor) continue;
      const tiles = furniture.get(kind);
      if (tiles === undefined || tiles.length === 0) continue;
      const placement = this.placeAtAnchor(kind, tiles, cursors, usedStands, reserved, spec.post);
      if (placement !== null) return placement;
    }
    return null;
  }

  /**
   * Stands the occupant at the first furniture tile in the group that still has
   * a free walkable neighbour. Returns the stand tile plus the facing that
   * points back at the furniture.
   *
   * A spec with a `post` walks the group ordered by that post instead of by scan
   * order, and leaves the group's cursor alone — the cursor exists to spread
   * *unposted* extras out, and a posted occupant taking a turn on it would push
   * the extras off the furniture the room actually has.
   */
  private placeAtAnchor(
    kind: AnchorKind,
    anchorTiles: ReadonlyArray<TileXY>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
    reserved: Set<string>,
    post: OccupantPost | undefined,
  ): { stand: TileXY; furniture: TileXY; facing: Facing } | null {
    if (post !== undefined) {
      for (const furniture of this.orderedByPost(anchorTiles, post)) {
        if (this.claimedFurniture.has(tileKey(furniture.x, furniture.y))) continue;
        const stand = this.findStandTile(furniture, usedStands, reserved);
        if (stand === null) continue;
        return { stand, furniture, facing: facingToward(stand, furniture) };
      }
      return null;
    }
    const start =
      cursors.get(kind) ?? anchorCursorForBuilding(this.buildingName, anchorTiles.length);
    for (let offset = 0; offset < anchorTiles.length; offset++) {
      const idx = (start + offset) % anchorTiles.length;
      const furniture = anchorTiles[idx];
      if (this.claimedFurniture.has(tileKey(furniture.x, furniture.y))) continue;
      const stand = this.findStandTile(furniture, usedStands, reserved);
      if (stand === null) continue;
      cursors.set(kind, idx + 1);
      return { stand, furniture, facing: facingToward(stand, furniture) };
    }
    return null;
  }

  /**
   * The anchor group ordered by how well each tile serves `post`.
   *
   * `door` and `back` are measured against the player's own entry tile rather
   * than against a wall, because what they mean is "front of house" and "behind
   * the bar" — a barkeep belongs at whichever end of their counter is deepest
   * into the room, whatever shape the room is.
   */
  private orderedByPost(
    anchorTiles: ReadonlyArray<TileXY>,
    post: OccupantPost,
  ): ReadonlyArray<TileXY> {
    const structure = this.map.structure;
    const south = structure.length - 2;
    const east = (structure[0]?.length ?? 0) - 2;
    const { x: midX, y: midY } = this.roomCentre();
    const start = this.map.startTile;
    const { target, farthest } = ((): { target: TileXY; farthest: boolean } => {
      switch (post) {
        case 'north':
          return { target: { x: midX, y: 1 }, farthest: false };
        case 'south':
          return { target: { x: midX, y: south }, farthest: false };
        case 'east':
          return { target: { x: east, y: midY }, farthest: false };
        case 'west':
          return { target: { x: 1, y: midY }, farthest: false };
        case 'centre':
          return { target: { x: midX, y: midY }, farthest: false };
        case 'door':
          return { target: start, farthest: false };
        case 'back':
          return { target: start, farthest: true };
      }
    })();
    const rank = (tile: TileXY): number => {
      const squared = (tile.x - target.x) ** 2 + (tile.y - target.y) ** 2;
      return farthest ? -squared : squared;
    };
    return [...anchorTiles].sort((a, b) => rank(a) - rank(b));
  }

  /** Nearest walkable, unclaimed interior tile to `furniture`, searched in expanding rings. */
  private findStandTile(
    furniture: TileXY,
    usedStands: Set<string>,
    reserved: Set<string>,
  ): TileXY | null {
    for (let radius = 1; radius <= STAND_SEARCH_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tx = furniture.x + dx;
          const ty = furniture.y + dy;
          const key = tileKey(tx, ty);
          if (usedStands.has(key) || reserved.has(key)) continue;
          if (this.map.isWalkable(tx, ty)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  private makeStationedOccupant(
    spec: StationedOccupantSpec,
    placement: { stand: TileXY; facing: Facing },
    index: number,
  ): Townsperson {
    const behavior = ACTIVITY_BEHAVIOR[spec.activity];
    return new Townsperson({
      x: placement.stand.x * TILE_SIZE,
      y: placement.stand.y * TILE_SIZE,
      role: spec.role,
      species: occupantSpecies(spec),
      seed: OCCUPANT_SEED_BASE + index * OCCUPANT_SEED_STRIDE,
      speed: OCCUPANT_SPEED,
      wander: this.buildWander(placement.stand, behavior),
      initialFacing: placement.facing,
      initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
      residentId: spec.residentId,
    });
  }

  private makeRoamer(
    spec: RoamingOccupantSpec,
    start: TileXY,
    floor: RoamFloor,
    index: number,
  ): Townsperson {
    const startX = start.x * TILE_SIZE;
    const startY = start.y * TILE_SIZE;
    // Filled in once the figure exists: a stroll is aimed from wherever the
    // roamer is standing now, which the wander params are built before.
    let roamer: Townsperson | null = null;
    const wander: WanderParams = {
      pickTarget: () => this.pickRoamTarget(floor, roamer?.x ?? startX, roamer?.y ?? startY),
      arriveDist: ARRIVE_DIST,
      pauseMin: ROAMER_PAUSE_MIN,
      pauseMax: ROAMER_PAUSE_MAX,
      isWalkable: (x, y) => this.isRoamFloor(floor, x, y),
    };
    roamer = new Townsperson({
      x: startX,
      y: startY,
      role: spec.role,
      species: occupantSpecies(spec),
      seed: OCCUPANT_SEED_BASE + index * OCCUPANT_SEED_STRIDE,
      speed: OCCUPANT_SPEED,
      wander,
      initialFacing: 'down',
      initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
      residentId: spec.residentId,
    });
    return roamer;
  }

  /**
   * Every tile a roamer may stand on: walkable floor the party can reach from
   * where it is set down, less the tiles occupants are already kept off, the
   * stationed occupants' stands and the doorstep around each exit — and only
   * where the floor is at least two tiles wide.
   *
   * The width rule is what keeps a roamer in the room's open middle. A cluttered
   * room's leftover floor is mostly one-tile slots between furniture and the
   * wall, and a roamer who strolls up one of those is back in the corner the
   * player has to thread their way into to talk to them.
   */
  private openRoamableTiles(
    reserved: ReadonlySet<string>,
    usedStands: ReadonlySet<string>,
  ): Map<string, TileXY> {
    const reachable = this.floorReachableByParty();
    const reachableKeys = new Set(reachable.map((tile) => tileKey(tile.x, tile.y)));
    const exits = this.map._interiorExitTiles;
    const besideExit = (tile: TileXY): boolean =>
      exits.some(
        (exit) =>
          Math.max(Math.abs(exit.x - tile.x), Math.abs(exit.y - tile.y)) <=
          ROAMER_EXIT_CLEARANCE_TILES,
      );
    const open = new Map<string, TileXY>();
    for (const tile of reachable) {
      const key = tileKey(tile.x, tile.y);
      if (reserved.has(key) || usedStands.has(key) || besideExit(tile)) continue;
      if (!inTwoByTwoOfFloor(tile, reachableKeys)) continue;
      open.set(key, tile);
    }
    return open;
  }

  /**
   * Four-connected flood fill over walkable tiles from where the party is set
   * down, so a roamer never wanders into a pocket the player cannot walk to.
   */
  private floorReachableByParty(): TileXY[] {
    const origin = findPartyArrivalTiles(this.map, this.map.startTile).leader;
    if (!this.map.isWalkable(origin.x, origin.y)) return [];
    const seen = new Set<string>([tileKey(origin.x, origin.y)]);
    const reached: TileXY[] = [origin];
    // The iterator re-reads `length`, so tiles pushed below are visited by this
    // same loop — that is the flood fill.
    for (const tile of reached) {
      for (const [dx, dy] of CARDINAL_STEPS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        const key = tileKey(x, y);
        if (seen.has(key) || !this.map.isWalkable(x, y)) continue;
        seen.add(key);
        reached.push({ x, y });
      }
    }
    return reached;
  }

  /** The roam-floor tile nearest the room's centre that has room to move from. */
  private roamStartTile(floor: RoamFloor, taken: ReadonlySet<string>): TileXY | null {
    const centre = this.roomCentre();
    let best: TileXY | null = null;
    let bestDistance = Infinity;
    for (const tile of floor.tiles) {
      if (taken.has(tileKey(tile.x, tile.y))) continue;
      if (!hasRoomToMove(this.map, tile.x, tile.y)) continue;
      const distance = (tile.x - centre.x) ** 2 + (tile.y - centre.y) ** 2;
      if (distance >= bestDistance) continue;
      best = tile;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * A random roam-floor tile the roamer can walk to in a straight line from
   * where they stand, or where they stand when none of the draws had one.
   */
  private pickRoamTarget(floor: RoamFloor, fromX: number, fromY: number): { x: number; y: number } {
    if (floor.tiles.length === 0) return { x: fromX, y: fromY };
    for (let attempt = 0; attempt < ROAMER_TARGET_ATTEMPTS; attempt++) {
      const tile = floor.tiles[Math.floor(Math.random() * floor.tiles.length)];
      const toX = tile.x * TILE_SIZE;
      const toY = tile.y * TILE_SIZE;
      if (this.hasClearStroll(floor, fromX, fromY, toX, toY)) return { x: toX, y: toY };
    }
    return { x: fromX, y: fromY };
  }

  /**
   * Whether every point of the straight walk stays on roam floor — tested at
   * the centre, and also at the soles when the walk heads south, because the
   * wander step tests the soles then and would otherwise refuse a stroll this
   * had approved.
   */
  private hasClearStroll(
    floor: RoamFloor,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const samples = Math.ceil(Math.hypot(dx, dy) / ROAMER_LINE_SAMPLE_PX);
    const headsSouth = dy > 0;
    const soleDrop = TILE_SIZE * SOUTHWARD_PROBE_DROP;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = fromX + dx * t;
      const y = fromY + dy * t;
      if (!this.isRoamFloor(floor, x, y)) return false;
      if (headsSouth && !this.isRoamFloor(floor, x, y + soleDrop)) return false;
    }
    return true;
  }

  private isRoamFloor(floor: RoamFloor, worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    return floor.keys.has(tileKey(tx, ty)) && this.map.isWalkable(tx, ty);
  }

  /** The middle of the room's interior, inside its border walls. */
  private roomCentre(): TileXY {
    const structure = this.map.structure;
    const south = structure.length - 2;
    const east = (structure[0]?.length ?? 0) - 2;
    return { x: Math.floor((1 + east) / 2), y: Math.floor((1 + south) / 2) };
  }

  /** A wander confined to a small radius of the stand tile, so the occupant holds its post. */
  private buildWander(stand: TileXY, behavior: ActivityBehavior): WanderParams {
    const centerX = stand.x * TILE_SIZE;
    const centerY = stand.y * TILE_SIZE;
    const radiusPx = behavior.radiusTiles * TILE_SIZE;
    return {
      pickTarget: () => this.sampleNearby(centerX, centerY, radiusPx),
      arriveDist: ARRIVE_DIST,
      pauseMin: behavior.pauseMin,
      pauseMax: behavior.pauseMax,
      isWalkable: (x, y) => this.isInteriorWalkable(x, y),
    };
  }

  /** A random walkable point within `radiusPx` of the anchor; falls back to the anchor itself. */
  private sampleNearby(
    centerX: number,
    centerY: number,
    radiusPx: number,
  ): { x: number; y: number } {
    for (let attempt = 0; attempt < WANDER_SAMPLE_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radiusPx;
      const x = centerX + Math.cos(angle) * dist;
      const y = centerY + Math.sin(angle) * dist;
      if (this.isInteriorWalkable(x, y)) return { x, y };
    }
    return { x: centerX, y: centerY };
  }

  private isInteriorWalkable(worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    return this.map.isWalkable(tx, ty);
  }
}

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The four 2x2 squares containing a tile, as offsets of each square's north-west corner. */
const SQUARE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [0, -1],
  [-1, -1],
];

/** Whether some 2x2 square containing `tile` is floor throughout. */
function inTwoByTwoOfFloor(tile: TileXY, floorKeys: ReadonlySet<string>): boolean {
  return SQUARE_CORNERS.some(([cornerDx, cornerDy]) => {
    const left = tile.x + cornerDx;
    const top = tile.y + cornerDy;
    return (
      floorKeys.has(tileKey(left, top)) &&
      floorKeys.has(tileKey(left + 1, top)) &&
      floorKeys.has(tileKey(left, top + 1)) &&
      floorKeys.has(tileKey(left + 1, top + 1))
    );
  });
}

/**
 * The biggest four-connected stretch of `openFloor` with a tile not yet taken,
 * or null when there is none.
 *
 * Biggest rather than nearest the room's centre: in a cluttered room the
 * geometric centre is usually furniture, and the open tile nearest it can sit
 * in a nook by the hearth that the door reaches only by a winding one-tile
 * path. The largest open stretch is the room's actual middle — where the
 * player walks in and looks first. A roamer must also be able to walk to every
 * tile it may be sent to, which one connected stretch guarantees.
 */
function largestStretch(
  openFloor: ReadonlyMap<string, TileXY>,
  taken: ReadonlySet<string>,
): RoamFloor | null {
  const assigned = new Set<string>();
  let largest: RoamFloor | null = null;
  for (const [seedKey, seed] of openFloor) {
    if (assigned.has(seedKey)) continue;
    const keys = new Set<string>([seedKey]);
    const tiles: TileXY[] = [seed];
    for (const tile of tiles) {
      for (const [dx, dy] of CARDINAL_STEPS) {
        const key = tileKey(tile.x + dx, tile.y + dy);
        const next = openFloor.get(key);
        if (next === undefined || keys.has(key)) continue;
        keys.add(key);
        tiles.push(next);
      }
    }
    for (const key of keys) assigned.add(key);
    const hasFreeTile = tiles.some((tile) => !taken.has(tileKey(tile.x, tile.y)));
    if (!hasFreeTile) continue;
    if (largest === null || tiles.length > largest.tiles.length) largest = { tiles, keys };
  }
  return largest;
}

function occupantSpecies(spec: OccupantSpec): TownSpecies {
  return spec.residentId !== undefined
    ? residentSpecies(residentById(spec.residentId))
    : (spec.species ?? DEFAULT_TOWN_SPECIES);
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** The cardinal facing that points from `from` toward `to`. */
function facingToward(from: TileXY, to: TileXY): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
