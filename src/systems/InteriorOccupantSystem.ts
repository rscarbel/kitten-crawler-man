/**
 * Populates a building's interior with role-appropriate occupants who perform
 * stationed activities — a smith at the forge, patrons at the tables, a barkeep
 * behind the counter — so walking in feels rewarding rather than like touring an
 * empty diorama. Owned by `BuildingInteriorScene` and the interior analog of
 * `TownLifeSystem`: instead of free-roaming a plaza, each occupant is stood by
 * a piece of the hand-crafted furniture and only shuffles within its territory.
 * The exception is a roamer (`roam` placement), who belongs to the whole room
 * rather than to one piece of it and strolls its open floor. The rosters and
 * the shape of a spec live in `buildingOccupants.ts`.
 *
 * Stand tiles are *derived* from the generated interior, not hard-coded: the
 * system scans the finished grid for furniture (forge braziers, hearths,
 * tables, shelves, counters) or looks up the named prop, and stands each
 * occupant on a walkable tile beside it, measured from the furniture's whole
 * footprint. That keeps this decoupled from the exact column/row constants
 * inside `GameMap.generateInterior` — re-arrange a room and the occupants
 * follow the furniture.
 *
 * Never constructed for a live quest-encounter interior (the Starlight Tent maze, cult
 * hideout, tower confrontation): the scene passes `null` occupants whenever its
 * combat stack is active, mirroring the gate `initEntryEncounter` uses.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { interiorHoldsOccupants } from './interiorStoryOwnership';
import { findPartyArrivalTiles, hasRoomToMove } from '../map/findWalkableTile';
import { SOUTHWARD_PROBE_DROP } from '../map/collisionAnchors';
import { Townsperson, type TownspersonFigureOptions } from '../creatures/Townsperson';
import { prewarmTownspersonBody } from '../creatures/townspersonBody';
import { CITIZEN_TALK_RADIUS_TILES, findTownspersonInReach } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { Facing } from '../sprites/person/skeleton';
import {
  BRAZIER,
  TABLE,
  BOOKSHELF,
  CRATE,
  BARREL,
  INTERIOR_COUNTER,
  INTERIOR_WALL,
  MAP_TABLE,
  TRAINING_DUMMY,
  MUSTER_BOARD,
} from '../map/tileTypes';
import type { BuildingEntry } from '../map/buildingEntry';
import type { BuildingId } from '../map/buildingIds';
import type { GameSystem } from './GameSystem';
import { DEFAULT_TOWN_SPECIES } from './townSpecies';
import {
  BUILDING_OCCUPANTS,
  TYPE_OCCUPANTS,
  presentOccupants,
  type OccupantPlacement,
  type OccupantPost,
  type OccupantSpec,
  type OccupantTerritory,
  type PropSide,
  type StationedActivity,
} from './buildingOccupants';
import type { OccupantService } from './townServices';
import {
  routineBodyAt,
  startOccupantRoutine,
  type RoutineRunner,
  type RoutineBody,
  type RoutineWorld,
} from './occupantRoutines';
import { safeRoomAnchorTiles } from './SafeRoomSystem';
import { anchorCursorForBuilding } from './interiorPlacement';
import { TOWN_INTERIOR_PROPS } from '../sprites/art/townInterior/townInteriorProps';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { TownDialogContext } from './townDialog';

/**
 * Every kind of furniture a role can be stationed beside; resolved to concrete
 * pieces by scanning the room. Listed so the resident fallback can try each
 * kind in a fixed order.
 */
export const ANCHOR_KINDS = [
  'forge',
  'hearth',
  'table',
  'shelf',
  'counter',
  'crate',
  'dummy',
  'board',
] as const;

export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/** The furniture a spec is posted at by kind, or null when it is placed some other way. */
export function occupantAnchor(spec: OccupantSpec): AnchorKind | null {
  return spec.placement.kind === 'anchor' ? spec.placement.anchor : null;
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
  // A garrison's map table is a table: the room has no ordinary `TABLE` in it,
  // and an anchor group that matches nothing drops its occupant without a word.
  { kind: 'table', types: [TABLE, MAP_TABLE] },
  { kind: 'shelf', types: [BOOKSHELF] },
  { kind: 'counter', types: [INTERIOR_COUNTER] },
  { kind: 'crate', types: [CRATE, BARREL] },
  { kind: 'dummy', types: [TRAINING_DUMMY] },
  { kind: 'board', types: [MUSTER_BOARD] },
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

const TALK_RADIUS = TILE_SIZE * CITIZEN_TALK_RADIUS_TILES;

/**
 * How far, in tiles, someone keeping a counter can be talked to from across
 * it: the customer stands a tile in front, the keeper a tile behind, and
 * either may have drifted a little along it. Every counter is one tile deep.
 */
export const ACROSS_COUNTER_TALK_RADIUS_TILES = 2.5;
const ACROSS_COUNTER_TALK_RADIUS = TILE_SIZE * ACROSS_COUNTER_TALK_RADIUS_TILES;

/**
 * A roaming occupant stands still while the player is this close. Wider than
 * the talk radius on purpose: at exactly the talk radius a roamer walking away
 * would stop just as they slipped out of reach, and the player would have to
 * chase the last step.
 */
const ROAMER_HOLD_RADIUS_TILES = 2;
const ROAMER_HOLD_RADIUS = TILE_SIZE * ROAMER_HOLD_RADIUS_TILES;
/**
 * Tiles around every exit tile a roamer keeps off. The exit is where the player
 * walks in and where they leave, and a figure standing on the threshold reads as
 * blocking the door even though nobody collides with townsfolk.
 */
const ROAMER_EXIT_CLEARANCE_TILES = 1;
/** Random destinations tried per stroll before a roamer settles for staying put. */
const ROAMER_TARGET_ATTEMPTS = 12;
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

/**
 * One piece of furniture an occupant can be stood beside: its north-west tile
 * and its footprint, which runs east and south from there. A legacy furniture
 * tile is a one-tile piece.
 */
export interface FurniturePiece {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const ONE_TILE = 1;
const HALF = 0.5;

function addAnchorPiece(
  groups: Map<AnchorKind, FurniturePiece[]>,
  kind: AnchorKind,
  piece: FurniturePiece,
): void {
  const list = groups.get(kind) ?? [];
  list.push(piece);
  groups.set(kind, list);
}

/**
 * Group every piece of interior furniture by the anchor kind it can host.
 *
 * Excludes the outermost ring of the grid — the border walls a room is carved
 * inside of can never hold furniture. Exported so `verify-interiors.ts` can
 * scan with these exact bounds rather than its own: a check that swept a wider
 * area than the placer would pass on furniture the placer can never see.
 *
 * Two sources feed the same groups: legacy tile types (`ANCHOR_TILE_TYPES`,
 * one piece per tile) and placed town interior props
 * (`GameMap.placedInteriorProps`, one piece per prop with its whole
 * footprint, each prop declaring its own anchor kinds). A room may mix both
 * freely — the smithy's counter is a prop, its map table is still a legacy
 * tile type, and an occupant anchored on `'table'` finds either.
 */
export function scanInteriorFurniture(map: GameMap): Map<AnchorKind, FurniturePiece[]> {
  const groups = new Map<AnchorKind, FurniturePiece[]>();
  const structure = map.structure;
  for (let y = 1; y < structure.length - 1; y++) {
    const row = structure[y];
    for (let x = 1; x < row.length - 1; x++) {
      const type = row[x].type;
      for (const { kind, types } of ANCHOR_TILE_TYPES) {
        if (!types.includes(type)) continue;
        addAnchorPiece(groups, kind, { x, y, w: ONE_TILE, h: ONE_TILE });
      }
    }
  }
  for (const placed of map.placedInteriorProps) {
    const propDef = TOWN_INTERIOR_PROPS[placed.propId];
    const piece = propPiece(placed.tile, propDef.footprint);
    for (const kind of propDef.anchors) addAnchorPiece(groups, kind, piece);
  }
  return groups;
}

function propPiece(tile: TileXY, footprint: { w: number; h: number }): FurniturePiece {
  return { x: tile.x, y: tile.y, w: footprint.w, h: footprint.h };
}

/**
 * Where the room's roamers should hold still for — the crawler the player is
 * steering — or null when nobody is there to hold still for.
 */
export type RoamerFocus = () => { readonly x: number; readonly y: number } | null;

/**
 * Every crawler, companion and hireling in the room, for a routine that must
 * not shoot through one. The room's other occupants are added by the system.
 */
export type OccupantBodies = RoutineWorld['bodies'];

/** Plays an occupant routine's sound from a world point. */
export type OccupantCuePlayer = RoutineWorld['playCue'];

/** The open floor a roamer may stand on, as a list to sample and a set to test. */
interface RoamFloor {
  readonly tiles: ReadonlyArray<TileXY>;
  readonly keys: ReadonlySet<string>;
}

/** Where one occupant was stood and what holds them there, for the gate to measure. */
export interface PlacedOccupant {
  readonly person: Townsperson;
  readonly spec: OccupantSpec;
  readonly stand: TileXY;
  /** The furniture they were stood beside, or null for a roamer. */
  readonly furniture: FurniturePiece | null;
  /** Whether a tile lies inside the territory they drift within. */
  readonly territoryHolds: (tile: TileXY) => boolean;
}

interface StandPlacement {
  readonly stand: TileXY;
  readonly furniture: FurniturePiece;
  readonly facing: Facing;
}

/** A stand tile, with the furniture it was found beside when there is any. */
interface Stand {
  readonly tile: TileXY;
  readonly furniture: FurniturePiece | null;
  readonly facing: Facing;
}

type PropPlacement = Extract<OccupantPlacement, { kind: 'prop' }>;
type AnchorPlacement = Extract<OccupantPlacement, { kind: 'anchor' }>;
type MarkPlacement = Extract<OccupantPlacement, { kind: 'mark' }>;

/** Facing toward each compass side. */
const FACING_TOWARD: Readonly<Record<PropSide, Facing>> = {
  north: 'up',
  south: 'down',
  east: 'right',
  west: 'left',
};

/** Facing back at a prop from each side of it. */
const FACING_FROM_SIDE: Readonly<Record<PropSide, Facing>> = {
  north: 'down',
  south: 'up',
  east: 'left',
  west: 'right',
};

/** A wander, the test for whether a tile is inside it, and whether its owner holds still for the player. */
interface Territory {
  readonly wander: WanderParams;
  readonly holds: (tile: TileXY) => boolean;
  readonly holdsForPlayer: boolean;
}

export class InteriorOccupantSystem implements GameSystem {
  private readonly occupants: Townsperson[] = [];
  /** Everyone whose territory is the whole room, who holds still while the player is near. */
  private readonly roamers: Townsperson[] = [];
  private readonly placedOccupants: PlacedOccupant[] = [];
  private readonly routines: Array<{ person: Townsperson; runner: RoutineRunner }> = [];
  private readonly services = new Map<Townsperson, OccupantService>();
  /** The occupant held attending the player, and how to tell their service surface is still up. */
  private serving: { readonly person: Townsperson; readonly open: () => boolean } | null = null;
  /** Furniture tiles an occupant is stationed at, keyed `x,y` by each piece's north-west tile. */
  private readonly claimedFurniture = new Set<string>();
  private readonly reserved: ReadonlySet<string>;
  /** Every tile of every counter and bar in the room, keyed `x,y`. */
  private readonly counterTiles: ReadonlySet<string>;
  /** Everyone stood at a counter, who can be talked to from its far side. */
  private readonly counterKeepers = new Set<Townsperson>();

  /**
   * Builds the occupant system for a building, or returns `null` when the
   * building takes no ambient occupants (towers, the Starlight Tent, or any
   * type with no authored roster). The scene calls this only when no live quest
   * encounter owns the interior.
   *
   * @param town - the story as it stands, deciding who on the roster is in the
   *   room this visit.
   * @param focus - read every update; roaming occupants stand still while it is
   *   within {@link ROAMER_HOLD_RADIUS_TILES} of them.
   * @param bodies - the party's bodies, read by routines that must not act
   *   through anyone standing in the way; the room's other occupants are
   *   added to them here.
   * @param playCue - plays the sounds routines raise, from where they raise them.
   */
  static forBuilding(
    map: GameMap,
    type: BuildingEntry['type'],
    buildingId: BuildingId,
    town: TownDialogContext,
    focus: RoamerFocus = () => null,
    bodies: OccupantBodies = () => [],
    playCue: OccupantCuePlayer = () => undefined,
  ): InteriorOccupantSystem | null {
    if (!interiorHoldsOccupants(type, buildingId)) return null;
    const roster = BUILDING_OCCUPANTS.get(buildingId) ?? TYPE_OCCUPANTS[type];
    if (roster === undefined) return null;
    const specs = presentOccupants(roster, town);
    if (specs.length === 0) return null;
    const system = new InteriorOccupantSystem(map, specs, buildingId, focus, bodies, playCue);
    return system.occupants.length > 0 ? system : null;
  }

  private constructor(
    private readonly map: GameMap,
    specs: ReadonlyArray<OccupantSpec>,
    private readonly buildingId: BuildingId,
    private readonly focus: RoamerFocus,
    bodies: OccupantBodies,
    playCue: OccupantCuePlayer,
  ) {
    const furniture = scanInteriorFurniture(map);
    this.counterTiles = pieceTiles(furniture.get('counter') ?? []);
    const groupCursors = new Map<AnchorKind, number>();
    const usedStands = new Set<string>();
    this.reserved = this.reservedTiles();
    const stands: Array<Stand | null> = specs.map(() => null);

    specs.forEach((spec, index) => {
      if (spec.placement.kind !== 'mark') return;
      const stand = this.placeAtMark(spec.placement, usedStands);
      if (stand === null) return;
      usedStands.add(tileKey(stand.tile.x, stand.tile.y));
      stands[index] = stand;
    });

    // Prop placements before anchors: each names one piece of furniture, and
    // claiming it first keeps an anchored extra off it whatever order the
    // roster lists the two in.
    for (const pass of ['prop', 'anchor'] as const) {
      specs.forEach((spec, index) => {
        if (spec.placement.kind !== pass) return;
        const placement = this.placeStationed(spec, furniture, groupCursors, usedStands);
        if (placement === null) return;
        usedStands.add(tileKey(placement.stand.x, placement.stand.y));
        this.claimedFurniture.add(tileKey(placement.furniture.x, placement.furniture.y));
        stands[index] = {
          tile: placement.stand,
          furniture: placement.furniture,
          facing: placement.facing,
        };
      });
    }

    // Only once every posted occupant has its stand, so the floor the roamers
    // are given already leaves those stands out.
    const openFloor = this.openRoamableTiles(usedStands);
    specs.forEach((spec, index) => {
      if (spec.placement.kind !== 'roam') return;
      const floor = largestStretch(openFloor, usedStands);
      if (floor === null) return;
      const start = this.roamStartTile(floor, usedStands);
      if (start === null) return;
      usedStands.add(tileKey(start.x, start.y));
      stands[index] = { tile: start, furniture: null, facing: 'down' };
    });

    const world: RoutineWorld = { map, bodies, playCue };
    specs.forEach((spec, index) => {
      const stand = stands[index];
      if (stand === null) return;
      this.addOccupant(spec, stand, index, openFloor, world);
    });
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

  /** What the occupants' routines leave in the room, for the scene's Y-sorted pass. */
  sortedFigures(): InteriorFigure[] {
    return this.routines.flatMap(({ runner }) => runner.figures());
  }

  /** Every occupant with where they were stood and what bounds their drift. */
  get placements(): ReadonlyArray<PlacedOccupant> {
    return this.placedOccupants;
  }

  /** Tiles no occupant may be stood on, keyed `x,y` — see {@link reservedTiles}. */
  get reservedStandTiles(): ReadonlySet<string> {
    return this.reserved;
  }

  /** What talking to this occupant opens, or undefined when they keep no counter. */
  serviceOf(person: Townsperson): OccupantService | undefined {
    return this.services.get(person);
  }

  /**
   * Holds `person` attending the player — facing them, drawn talking rather
   * than at their routine — for as long as `open` reports their service
   * surface up. Set at once rather than on the next update, because the
   * surface halts the world and no update runs until it closes.
   */
  serve(person: Townsperson, open: () => boolean): void {
    this.endService();
    person.attending = true;
    this.serving = { person, open };
  }

  private endService(): void {
    if (this.serving === null) return;
    this.serving.person.attending = false;
    this.serving = null;
  }

  /**
   * The occupant the player (at world origin `x`,`y`) would talk to, or `null`:
   * anyone within the talk radius, or someone keeping a counter with that
   * counter between them and the player.
   */
  findTalkTarget(x: number, y: number): Townsperson | null {
    return findTownspersonInReach(this.occupants, x, y, (person) => this.talkReach(person, x, y));
  }

  /**
   * How far, in tiles, a conversation with `person` reaches: across a counter
   * for someone keeping one, so the talk opened from the customer's side is
   * not closed at once for being out of reach.
   */
  talkRangeTilesOf(person: Townsperson): number {
    return this.counterKeepers.has(person)
      ? ACROSS_COUNTER_TALK_RADIUS_TILES
      : CITIZEN_TALK_RADIUS_TILES;
  }

  private talkReach(person: Townsperson, x: number, y: number): number {
    if (!this.counterKeepers.has(person)) return TALK_RADIUS;
    const midwayTileX = Math.floor(((person.x + x) / 2 + TILE_SIZE * HALF) / TILE_SIZE);
    const midwayTileY = Math.floor(((person.y + y) / 2 + TILE_SIZE * HALF) / TILE_SIZE);
    const counterBetween = this.counterTiles.has(tileKey(midwayTileX, midwayTileY));
    return counterBetween ? ACROSS_COUNTER_TALK_RADIUS : TALK_RADIUS;
  }

  /** Whether `tile` touches a counter, side on or corner to corner. */
  private besideCounter(tile: TileXY): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.counterTiles.has(tileKey(tile.x + dx, tile.y + dy))) return true;
      }
    }
    return false;
  }

  update(): void {
    if (this.serving?.open() === false) this.endService();
    const focus = this.focus();
    if (focus !== null) {
      for (const roamer of this.roamers) {
        if (roamer.held) continue;
        const distance = Math.hypot(roamer.x - focus.x, roamer.y - focus.y);
        if (distance > ROAMER_HOLD_RADIUS) continue;
        // A pause rather than a freeze, so the idle loop keeps breathing and
        // the stroll resumes from wherever it was once the player moves off.
        roamer.pause = Math.max(roamer.pause, ROAMER_HOLD_FRAMES);
        roamer.faceToward(focus.x, focus.y);
      }
    }
    for (const { person, runner } of this.routines) runner.update(person);
    for (const occupant of this.occupants) {
      const worn = occupant.body;
      occupant.update();
      // A purged canvas recovery can re-dress an occupant, and nothing else
      // warms a room's looks.
      if (occupant.body !== worn) prewarmTownspersonBody(occupant.body);
    }
  }

  /** The room as `person`'s routine sees it: the party, and every other occupant. */
  private worldAround(person: Townsperson, world: RoutineWorld): RoutineWorld {
    const othersInRoom = (): RoutineBody[] =>
      this.occupants.flatMap((other) => (other === person ? [] : [routineBodyAt(other)]));
    return { ...world, bodies: () => [...world.bodies(), ...othersInRoom()] };
  }

  private addOccupant(
    spec: OccupantSpec,
    stand: Stand,
    index: number,
    openFloor: ReadonlyMap<string, TileXY>,
    world: RoutineWorld,
  ): void {
    // Filled in once the figure exists: a stroll across the room is aimed from
    // wherever the occupant is standing now, which the wander is built before.
    let person: Townsperson | null = null;
    const here = (): { x: number; y: number } => ({
      x: person?.x ?? stand.tile.x * TILE_SIZE,
      y: person?.y ?? stand.tile.y * TILE_SIZE,
    });
    const territory = this.territoryFor(spec, stand.tile, openFloor, here);
    person = new Townsperson({
      x: stand.tile.x * TILE_SIZE,
      y: stand.tile.y * TILE_SIZE,
      role: spec.role,
      ...occupantFigure(spec),
      seed: OCCUPANT_SEED_BASE + index * OCCUPANT_SEED_STRIDE,
      speed: OCCUPANT_SPEED,
      wander: territory.wander,
      initialFacing: stand.facing,
      initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
    });
    this.occupants.push(person);
    if (this.besideCounter(stand.tile)) this.counterKeepers.add(person);
    if (territory.holdsForPlayer) this.roamers.push(person);
    if (spec.service !== undefined) this.services.set(person, spec.service);
    if (spec.routine !== undefined) {
      const runner = startOccupantRoutine(spec.routine, person, this.worldAround(person, world));
      if (runner !== null) this.routines.push({ person, runner });
    }
    this.placedOccupants.push({
      person,
      spec,
      stand: stand.tile,
      furniture: stand.furniture,
      territoryHolds: territory.holds,
    });
    prewarmTownspersonBody(person.body);
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
    // Dave and the sleeping bed own their tiles in a safe-room interior.
    for (const anchor of safeRoomAnchorTiles(this.map)) reserved.add(tileKey(anchor.x, anchor.y));
    return reserved;
  }

  /** Every walkable tile pinched between two walls on one axis — a gap in a partition. */
  private doorwayTiles(): TileXY[] {
    const structure = this.map.structure;
    const doorways: TileXY[] = [];
    for (let y = 1; y < structure.length - 1; y++) {
      for (let x = 1; x < structure[y].length - 1; x++) {
        if (!this.map.isWalkable(x, y, 'walker')) continue;
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
   * Places a posted spec by its placement, falling back to any other furniture
   * in the room when the spec names a resident — a room missing the one piece
   * of furniture a resident prefers must still contain that resident.
   */
  private placeStationed(
    spec: OccupantSpec,
    furniture: ReadonlyMap<AnchorKind, FurniturePiece[]>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
  ): StandPlacement | null {
    const placement = spec.placement;
    const preferred = ((): StandPlacement | null => {
      switch (placement.kind) {
        case 'prop':
          return this.placeAtProp(placement, usedStands);
        case 'anchor':
          return this.placeAtAnchorKind(placement, furniture, cursors, usedStands);
        case 'mark':
        case 'roam':
          return null;
        default: {
          const unhandled: never = placement;
          throw new Error(`unhandled occupant placement ${JSON.stringify(unhandled)}`);
        }
      }
    })();
    if (preferred !== null || spec.residentId === undefined) return preferred;

    const post =
      placement.kind === 'roam' || placement.kind === 'mark' ? undefined : placement.post;
    const skipKind = placement.kind === 'anchor' ? placement.anchor : null;
    for (const kind of ANCHOR_KINDS) {
      if (kind === skipKind) continue;
      const pieces = furniture.get(kind);
      if (pieces === undefined || pieces.length === 0) continue;
      const fallback = this.placeAtAnchor(kind, pieces, cursors, usedStands, post);
      if (fallback !== null) return fallback;
    }
    return null;
  }

  /** The authored tile itself, when it is open floor nobody else holds. */
  private placeAtMark(placement: MarkPlacement, usedStands: ReadonlySet<string>): Stand | null {
    const { x, y } = placement.tile;
    const key = tileKey(x, y);
    if (!this.map.isWalkable(x, y, 'walker') || this.reserved.has(key) || usedStands.has(key))
      return null;
    return { tile: { x, y }, furniture: null, facing: FACING_TOWARD[placement.faces] };
  }

  private placeAtAnchorKind(
    placement: AnchorPlacement,
    furniture: ReadonlyMap<AnchorKind, FurniturePiece[]>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
  ): StandPlacement | null {
    const pieces = furniture.get(placement.anchor);
    if (pieces === undefined || pieces.length === 0) return null;
    return this.placeAtAnchor(placement.anchor, pieces, cursors, usedStands, placement.post);
  }

  /**
   * Stands the occupant on the named side of the first unclaimed instance of
   * the prop — `post` ordering the instances when the room has several —
   * centred on the prop's footprint and shifted by `offset`. Faces the prop.
   */
  private placeAtProp(placement: PropPlacement, usedStands: Set<string>): StandPlacement | null {
    const footprint = TOWN_INTERIOR_PROPS[placement.prop].footprint;
    const pieces = this.map.placedInteriorProps
      .filter((placed) => placed.propId === placement.prop)
      .map((placed) => propPiece(placed.tile, footprint));
    const ordered =
      placement.post === undefined ? pieces : this.orderedByPost(pieces, placement.post);
    for (const piece of ordered) {
      if (this.claimedFurniture.has(tileKey(piece.x, piece.y))) continue;
      const stand = this.standBeside(
        piece,
        placement.side,
        placement.offset ?? 0,
        placement.distance ?? 1,
        usedStands,
      );
      if (stand === null) continue;
      return { stand, furniture: piece, facing: FACING_FROM_SIDE[placement.side] };
    }
    return null;
  }

  /**
   * The free tile along one side of `piece` nearest the side's middle shifted
   * by `offset`, or null when every tile along that side is taken or solid.
   * An even-width side's middle is the tile west (or north) of its centre line.
   */
  private standBeside(
    piece: FurniturePiece,
    side: PropSide,
    offset: number,
    distance: number,
    usedStands: ReadonlySet<string>,
  ): TileXY | null {
    const runsEastWest = side === 'north' || side === 'south';
    const spanStart = runsEastWest ? piece.x : piece.y;
    const spanLength = runsEastWest ? piece.w : piece.h;
    const spanEnd = spanStart + spanLength - 1;
    const middle = spanStart + Math.floor((spanLength - 1) / 2) + offset;
    const across = ((): number => {
      switch (side) {
        case 'north':
          return piece.y - distance;
        case 'south':
          return piece.y + piece.h - 1 + distance;
        case 'west':
          return piece.x - distance;
        case 'east':
          return piece.x + piece.w - 1 + distance;
      }
    })();
    return this.nearestFreeOnLine(
      runsEastWest,
      across,
      Math.min(spanStart, middle),
      Math.max(spanEnd, middle),
      middle,
      usedStands,
    );
  }

  private isFreeStand(tile: TileXY, usedStands: ReadonlySet<string>): boolean {
    const key = tileKey(tile.x, tile.y);
    if (usedStands.has(key) || this.reserved.has(key)) return false;
    return this.map.isWalkable(tile.x, tile.y, 'walker');
  }

  /**
   * Stands the occupant at the first piece in the group that still has a free
   * walkable neighbour. Returns the stand tile plus the facing that points
   * back at the furniture.
   *
   * A spec with a `post` walks the group ordered by that post instead of by scan
   * order, and leaves the group's cursor alone — the cursor exists to spread
   * *unposted* extras out, and a posted occupant taking a turn on it would push
   * the extras off the furniture the room actually has.
   */
  private placeAtAnchor(
    kind: AnchorKind,
    pieces: ReadonlyArray<FurniturePiece>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
    post: OccupantPost | undefined,
  ): StandPlacement | null {
    if (post !== undefined) {
      for (const furniture of this.orderedByPost(pieces, post)) {
        if (this.claimedFurniture.has(tileKey(furniture.x, furniture.y))) continue;
        const stand = this.findStandTile(furniture, usedStands);
        if (stand === null) continue;
        return { stand, furniture, facing: facingToward(stand, furniture) };
      }
      return null;
    }
    const start = cursors.get(kind) ?? anchorCursorForBuilding(this.buildingId, pieces.length);
    for (let offset = 0; offset < pieces.length; offset++) {
      const idx = (start + offset) % pieces.length;
      const furniture = pieces[idx];
      if (this.claimedFurniture.has(tileKey(furniture.x, furniture.y))) continue;
      const stand = this.findStandTile(furniture, usedStands);
      if (stand === null) continue;
      cursors.set(kind, idx + 1);
      return { stand, furniture, facing: facingToward(stand, furniture) };
    }
    return null;
  }

  /**
   * The pieces ordered by how well each serves `post`, measured from each
   * piece's centre.
   *
   * `door` and `back` are measured against the player's own entry tile rather
   * than against a wall, because what they mean is "front of house" and "behind
   * the bar" — a barkeep belongs at whichever end of their counter is deepest
   * into the room, whatever shape the room is.
   */
  private orderedByPost(
    pieces: ReadonlyArray<FurniturePiece>,
    post: OccupantPost,
  ): ReadonlyArray<FurniturePiece> {
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
    const rank = (piece: FurniturePiece): number => {
      const centre = pieceCentre(piece);
      const squared = (centre.x - target.x) ** 2 + (centre.y - target.y) ** 2;
      return farthest ? -squared : squared;
    };
    return [...pieces].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Nearest free walkable tile to `piece`, searched in rings outward from its
   * north-west tile, row-major from the north-west, and then slid along the
   * side of the piece it landed on to that side's middle. The ring finds which
   * side of the furniture an occupant belongs on; the slide stops whoever
   * keeps a long counter or table from standing at its western end or its
   * corner. A one-tile side has no middle to slide to.
   */
  private findStandTile(piece: FurniturePiece, usedStands: ReadonlySet<string>): TileXY | null {
    for (let radius = 1; radius <= STAND_SEARCH_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tile = { x: piece.x + dx, y: piece.y + dy };
          if (this.isFreeStand(tile, usedStands))
            return this.centredOnSide(tile, piece, usedStands);
        }
      }
    }
    return null;
  }

  /**
   * `found` slid along its own row (north or south of the piece) or column
   * (west or east of it) to the free tile nearest the middle of the piece's
   * span on that line. Unmoved when it is inside or diagonal to a one-tile
   * span.
   */
  private centredOnSide(
    found: TileXY,
    piece: FurniturePiece,
    usedStands: ReadonlySet<string>,
  ): TileXY {
    const aboveOrBelow = found.y < piece.y || found.y > piece.y + piece.h - 1;
    const besideColumns = found.x < piece.x || found.x > piece.x + piece.w - 1;
    if (!aboveOrBelow && !besideColumns) return found;
    const runsEastWest = aboveOrBelow;
    const spanStart = runsEastWest ? piece.x : piece.y;
    const spanLength = runsEastWest ? piece.w : piece.h;
    if (spanLength <= ONE_TILE) return found;
    const across = runsEastWest ? found.y : found.x;
    const along = runsEastWest ? found.x : found.y;
    const middle = spanStart + Math.floor((spanLength - 1) / 2);
    const slid = this.nearestFreeOnLine(
      runsEastWest,
      across,
      Math.min(spanStart, along),
      Math.max(spanStart + spanLength - 1, along),
      middle,
      usedStands,
    );
    return slid ?? found;
  }

  /**
   * The free tile on one row (`runsEastWest`) or column at `across`, between
   * `first` and `last` inclusive, nearest `middle` — the western or northern
   * of two equally near.
   */
  private nearestFreeOnLine(
    runsEastWest: boolean,
    across: number,
    first: number,
    last: number,
    middle: number,
    usedStands: ReadonlySet<string>,
  ): TileXY | null {
    const along: number[] = [];
    for (let at = first; at <= last; at++) along.push(at);
    along.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
    for (const at of along) {
      const tile = runsEastWest ? { x: at, y: across } : { x: across, y: at };
      if (this.isFreeStand(tile, usedStands)) return tile;
    }
    return null;
  }

  /**
   * The wander bounding an occupant: their spec's territory, else the
   * activity's radius for a posted occupant and the whole room for a roamer.
   */
  private territoryFor(
    spec: OccupantSpec,
    stand: TileXY,
    openFloor: ReadonlyMap<string, TileXY>,
    here: () => { x: number; y: number },
  ): Territory {
    const placement = spec.placement;
    const behavior: ActivityBehavior =
      placement.kind === 'roam' ? ROAMER_BEHAVIOR : ACTIVITY_BEHAVIOR[placement.activity];
    const territory: OccupantTerritory =
      spec.territory ??
      (placement.kind === 'roam'
        ? { kind: 'room' }
        : { kind: 'radius', tiles: ACTIVITY_BEHAVIOR[placement.activity].radiusTiles });
    const centreX = stand.x * TILE_SIZE;
    const centreY = stand.y * TILE_SIZE;
    const pauses = {
      arriveDist: ARRIVE_DIST,
      pauseMin: behavior.pauseMin,
      pauseMax: behavior.pauseMax,
    };
    switch (territory.kind) {
      case 'radius': {
        const radiusPx = territory.tiles * TILE_SIZE;
        return {
          wander: {
            ...pauses,
            pickTarget: () => this.sampleNearby(centreX, centreY, radiusPx),
            isWalkable: (x, y) => this.isInteriorWalkable(x, y),
          },
          holds: (tile) => Math.hypot(tile.x - stand.x, tile.y - stand.y) <= territory.tiles,
          holdsForPlayer: false,
        };
      }
      case 'rect': {
        const bounds = {
          west: (stand.x - territory.west) * TILE_SIZE,
          east: (stand.x + territory.east) * TILE_SIZE,
          north: (stand.y - territory.north) * TILE_SIZE,
          south: (stand.y + territory.south) * TILE_SIZE,
        };
        return {
          wander: {
            ...pauses,
            pickTarget: () => this.sampleInRect(bounds, centreX, centreY),
            isWalkable: (x, y) => this.isInteriorWalkable(x, y),
          },
          holds: (tile) =>
            tile.x >= stand.x - territory.west &&
            tile.x <= stand.x + territory.east &&
            tile.y >= stand.y - territory.north &&
            tile.y <= stand.y + territory.south,
          holdsForPlayer: false,
        };
      }
      case 'room': {
        const floor = floorAround(openFloor, stand);
        return {
          wander: {
            ...pauses,
            pickTarget: () => {
              const from = here();
              return this.pickRoamTarget(floor, from.x, from.y);
            },
            isWalkable: (x, y) => this.isRoamFloor(floor, x, y),
          },
          holds: (tile) => floor.keys.has(tileKey(tile.x, tile.y)),
          holdsForPlayer: true,
        };
      }
      default: {
        const unhandled: never = territory;
        throw new Error(`unhandled occupant territory ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Every tile a roamer may stand on: walkable floor the party can reach from
   * where it is set down, less the tiles occupants are already kept off, the
   * posted occupants' stands and the doorstep around each exit — and only
   * where the floor is at least two tiles wide.
   *
   * The width rule is what keeps a roamer in the room's open middle. A cluttered
   * room's leftover floor is mostly one-tile slots between furniture and the
   * wall, and a roamer who strolls up one of those is back in the corner the
   * player has to thread their way into to talk to them.
   */
  private openRoamableTiles(usedStands: ReadonlySet<string>): Map<string, TileXY> {
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
      if (this.reserved.has(key) || usedStands.has(key) || besideExit(tile)) continue;
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
    if (!this.map.isWalkable(origin.x, origin.y, 'walker')) return [];
    const seen = new Set<string>([tileKey(origin.x, origin.y)]);
    const reached: TileXY[] = [origin];
    // The iterator re-reads `length`, so tiles pushed below are visited by this
    // same loop — that is the flood fill.
    for (const tile of reached) {
      for (const [dx, dy] of CARDINAL_STEPS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        const key = tileKey(x, y);
        if (seen.has(key) || !this.map.isWalkable(x, y, 'walker')) continue;
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
   * Whether the straight walk stays on roam floor the whole way — the line
   * the figure's centre travels, and also the one its soles travel when the
   * walk heads south, because the wander step tests the soles then and would
   * otherwise refuse a stroll this had approved.
   *
   * Every tile either line passes through is tested, corners included: a
   * diagonal that clips a furniture corner by a fraction of a pixel still
   * stands the figure's centre on that furniture for a frame.
   */
  private hasClearStroll(
    floor: RoamFloor,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): boolean {
    const onFloor = (tile: TileXY): boolean =>
      floor.keys.has(tileKey(tile.x, tile.y)) && this.map.isWalkable(tile.x, tile.y, 'walker');
    const centre = tilesAlongSegment(
      fromX + CENTER_OFFSET,
      fromY + CENTER_OFFSET,
      toX + CENTER_OFFSET,
      toY + CENTER_OFFSET,
    );
    if (!centre.every(onFloor)) return false;
    if (toY <= fromY) return true;
    const soleDrop = TILE_SIZE * SOUTHWARD_PROBE_DROP;
    return tilesAlongSegment(
      fromX + CENTER_OFFSET,
      fromY + CENTER_OFFSET + soleDrop,
      toX + CENTER_OFFSET,
      toY + CENTER_OFFSET + soleDrop,
    ).every(onFloor);
  }

  private isRoamFloor(floor: RoamFloor, worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    return floor.keys.has(tileKey(tx, ty)) && this.map.isWalkable(tx, ty, 'walker');
  }

  /** The middle of the room's interior, inside its border walls. */
  private roomCentre(): TileXY {
    const structure = this.map.structure;
    const south = structure.length - 2;
    const east = (structure[0]?.length ?? 0) - 2;
    return { x: Math.floor((1 + east) / 2), y: Math.floor((1 + south) / 2) };
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

  /** A random walkable point inside the world-pixel `bounds`; falls back to the stand itself. */
  private sampleInRect(
    bounds: { west: number; east: number; north: number; south: number },
    standX: number,
    standY: number,
  ): { x: number; y: number } {
    for (let attempt = 0; attempt < WANDER_SAMPLE_ATTEMPTS; attempt++) {
      const x = bounds.west + Math.random() * (bounds.east - bounds.west);
      const y = bounds.north + Math.random() * (bounds.south - bounds.north);
      if (this.isInteriorWalkable(x, y)) return { x, y };
    }
    return { x: standX, y: standY };
  }

  private isInteriorWalkable(worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    return this.map.isWalkable(tx, ty, 'walker');
  }
}

/** Roamers linger between strolls about as long as a browsing shopper does. */
const ROAMER_BEHAVIOR: ActivityBehavior = {
  radiusTiles: 0,
  pauseMin: PAUSE_ROAMING_MIN,
  pauseMax: PAUSE_STATIONED_MAX,
};

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
    const stretch = floorAround(openFloor, seed);
    for (const key of stretch.keys) assigned.add(key);
    const hasFreeTile = stretch.tiles.some((tile) => !taken.has(tileKey(tile.x, tile.y)));
    if (!hasFreeTile) continue;
    if (largest === null || stretch.tiles.length > largest.tiles.length) largest = stretch;
  }
  return largest;
}

/**
 * The four-connected stretch of `openFloor` reached from `from`, with `from`
 * itself always in it — a posted occupant's stand is kept out of the open
 * floor, but is still somewhere they may walk back to.
 */
function floorAround(openFloor: ReadonlyMap<string, TileXY>, from: TileXY): RoamFloor {
  const fromKey = tileKey(from.x, from.y);
  const keys = new Set<string>([fromKey]);
  const tiles: TileXY[] = [openFloor.get(fromKey) ?? from];
  for (const tile of tiles) {
    for (const [dx, dy] of CARDINAL_STEPS) {
      const key = tileKey(tile.x + dx, tile.y + dy);
      const next = openFloor.get(key);
      if (next === undefined || keys.has(key)) continue;
      keys.add(key);
      tiles.push(next);
    }
  }
  return { tiles, keys };
}

function occupantFigure(spec: OccupantSpec): TownspersonFigureOptions {
  if (spec.residentId !== undefined) return { residentId: spec.residentId };
  if (spec.bespokeFigure !== undefined) {
    return { species: spec.species, bespokeFigure: spec.bespokeFigure };
  }
  return { species: spec.species ?? DEFAULT_TOWN_SPECIES };
}

function pieceCentre(piece: FurniturePiece): { x: number; y: number } {
  return { x: piece.x + (piece.w - 1) * HALF, y: piece.y + (piece.h - 1) * HALF };
}

/** Every tile the pieces cover, keyed `x,y`. */
function pieceTiles(pieces: ReadonlyArray<FurniturePiece>): ReadonlySet<string> {
  const tiles = new Set<string>();
  for (const piece of pieces) {
    for (let dy = 0; dy < piece.h; dy++) {
      for (let dx = 0; dx < piece.w; dx++) tiles.add(tileKey(piece.x + dx, piece.y + dy));
    }
  }
  return tiles;
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** The cardinal facing that points from `from` toward the middle of `piece`. */
function facingToward(from: TileXY, piece: FurniturePiece): Facing {
  const to = pieceCentre(piece);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Every tile a straight segment between two world points passes through, in
 * order: a grid traversal stepping across whichever tile edge the segment
 * reaches next, and taking both neighbours where it passes exactly through a
 * corner.
 */
function tilesAlongSegment(fromX: number, fromY: number, toX: number, toY: number): TileXY[] {
  let x = Math.floor(fromX / TILE_SIZE);
  let y = Math.floor(fromY / TILE_SIZE);
  const endX = Math.floor(toX / TILE_SIZE);
  const endY = Math.floor(toY / TILE_SIZE);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // The segment parameter at which it next crosses a vertical / horizontal tile edge.
  const edgeAfter = (start: number, delta: number, cell: number, step: number): number => {
    if (step === 0) return Infinity;
    const edge = (step > 0 ? cell + 1 : cell) * TILE_SIZE;
    return (edge - start) / delta;
  };
  let nextX = edgeAfter(fromX, dx, x, stepX);
  let nextY = edgeAfter(fromY, dy, y, stepY);
  const perTileX = stepX === 0 ? Infinity : TILE_SIZE / Math.abs(dx);
  const perTileY = stepY === 0 ? Infinity : TILE_SIZE / Math.abs(dy);
  const tiles: TileXY[] = [{ x, y }];
  while (x !== endX || y !== endY) {
    if (nextX < nextY) {
      x += stepX;
      nextX += perTileX;
    } else if (nextY < nextX) {
      y += stepY;
      nextY += perTileY;
    } else {
      tiles.push({ x: x + stepX, y }, { x, y: y + stepY });
      x += stepX;
      y += stepY;
      nextX += perTileX;
      nextY += perTileY;
    }
    tiles.push({ x, y });
  }
  return tiles;
}
