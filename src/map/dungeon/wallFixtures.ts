/**
 * Wall fixtures: the things hung on a dungeon wall face that light up, animate
 * or break — sconces, fluorescent tubes, sodium lamps, emergency lights, fuse
 * boxes, steam valves, camera domes, hanging chains, torn banners and monitor
 * banks.
 *
 * A fixture never changes its tile. The face tile stays `FloorTypeValue.wall`,
 * as solid and as sight-blocking as any other wall, and its baked art stays the
 * wall painter's; a fixture is a record on the map (`GameMap.wallFixtures`)
 * drawn live in the Y-sorted pass over that art. Static face dressing — cracks,
 * moss, conduit, cobwebs — is the wall painter's and is baked; only what must
 * move, light or break lives here.
 *
 * Every fixture hangs on the lower tile of a face (wall to its north, floor to
 * its south) away from the face's ends, so it is always seen straight on and
 * is struck from the floor in front of it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Rng } from '../../sprites/person/rng';
import {
  BOILER,
  BOOKSHELF,
  FILING_CABINET,
  FloorTypeValue,
  LOCKER_BANK,
  TORCH,
  VENDING_MACHINE,
  WEAPON_RACK,
  WINE_CASK,
  type TileContent,
} from '../tileTypes';
import { multiTileAnchorOf } from '../serviceLevelProps';
import { FACE_CLIMBING_PROP_TILE_TYPES } from '../cellarProps';
import { isWalkableTileType } from '../walkability';
import type { HallwayRegion, RegionMap, RoomRegion } from '../regionMap';
import type { Point } from '../roomDoorways';
import type { RegionCharacters } from './regionCharacters';
import type { CharacterId, CountRange, LightSourceKind, LightSourceSpec } from './roomCharacters';
import { wallShapeAt } from './wallShape';
import { UINT32_SPAN } from '../../core/WorldRandom';
import type { BreakMaterial } from '../../systems/destruction/breakMaterials';

export type WallFixtureKind =
  | 'sconce'
  | 'fluorescent_tube'
  | 'sodium_lamp'
  | 'emergency_light'
  | 'fuse_box'
  | 'steam_valve'
  | 'camera_dome'
  | 'hanging_chains'
  | 'torn_banner'
  | 'monitor_bank';

/**
 * How a fixture answers a blow.
 *
 * - `break`: loses health and, at none, breaks for good.
 * - `swing`: swings and settles; nothing breaks it.
 * - `tear`: tears one stage further each blow, down to rags.
 * - `hiss`: vents a burst of steam; nothing breaks it.
 */
export type FixtureHitResponse = 'break' | 'swing' | 'tear' | 'hiss';

export interface WallFixtureSpec {
  /** The light it throws while whole, or null for none. */
  readonly light: LightSourceKind | null;
  /** Health before it breaks; only meaningful for a `break` fixture. */
  readonly maxHp: number;
  readonly material: BreakMaterial;
  readonly onHit: FixtureHitResponse;
}

const SCONCE_HP = 4;
const TUBE_HP = 3;
const SODIUM_LAMP_HP = 4;
const EMERGENCY_LIGHT_HP = 3;
const FUSE_BOX_HP = 6;
const CAMERA_DOME_HP = 3;
const MONITOR_BANK_HP = 5;
/** Unbreakable fixtures keep a nominal health so every state has the same shape. */
const UNBREAKABLE_HP = 1;

export const WALL_FIXTURE_SPECS = {
  sconce: { light: 'wall_sconce', maxHp: SCONCE_HP, material: 'metal', onHit: 'break' },
  fluorescent_tube: {
    light: 'fluorescent_tube',
    maxHp: TUBE_HP,
    material: 'glass',
    onHit: 'break',
  },
  sodium_lamp: { light: 'sodium_lamp', maxHp: SODIUM_LAMP_HP, material: 'glass', onHit: 'break' },
  emergency_light: {
    light: 'emergency_light',
    maxHp: EMERGENCY_LIGHT_HP,
    material: 'electrical',
    onHit: 'break',
  },
  fuse_box: { light: null, maxHp: FUSE_BOX_HP, material: 'electrical', onHit: 'break' },
  steam_valve: { light: null, maxHp: UNBREAKABLE_HP, material: 'metal', onHit: 'hiss' },
  camera_dome: { light: null, maxHp: CAMERA_DOME_HP, material: 'electrical', onHit: 'break' },
  hanging_chains: { light: null, maxHp: UNBREAKABLE_HP, material: 'metal', onHit: 'swing' },
  torn_banner: { light: null, maxHp: UNBREAKABLE_HP, material: 'cloth', onHit: 'tear' },
  monitor_bank: {
    light: 'monitor_glow',
    maxHp: MONITOR_BANK_HP,
    material: 'glass',
    onHit: 'break',
  },
} as const satisfies Record<WallFixtureKind, WallFixtureSpec>;

/** Frames a fixture flashes after a blow lands. */
export const FIXTURE_HIT_FLASH_FRAMES = 6;
/** Frames struck chains swing for before they hang still again. */
export const FIXTURE_SWING_FRAMES = 90;
/** Frames a struck steam valve vents for. */
export const FIXTURE_HISS_FRAMES = 60;

/** Tear stages a banner passes through; at the last it hangs in rags and tears no further. */
export const BANNER_TEAR_STAGES = 3;

/** What a fixture is now: the part a blow changes and a checkpoint rewinds. */
export interface WallFixtureState {
  hp: number;
  broken: boolean;
  /** 0 for a whole banner, up to {@link BANNER_TEAR_STAGES}. */
  tearStage: number;
  /** Frames left of a swing, a hiss or a hit flash; cosmetic, never checkpointed. */
  swingFrames: number;
  hissFrames: number;
  hitFlashFrames: number;
}

export interface WallFixture {
  /** Index into `GameMap.wallFixtures`. */
  readonly id: number;
  /** The face tile it hangs on. */
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: WallFixtureKind;
  /** Picks the fixture's variant: its wear, its lean, the phase of its animation. */
  readonly seed: number;
  /** The room or hallway segment it faces. */
  readonly region: number;
  /**
   * The fuse box a fluorescent tube is wired to, by id; null for a tube on no
   * breaker and for every other kind. Breaking that box puts the tube out.
   */
  readonly circuit: number | null;
  readonly state: WallFixtureState;
}

/** A fresh, undamaged state for a fixture of `kind`. */
export function freshFixtureState(kind: WallFixtureKind): WallFixtureState {
  return {
    hp: WALL_FIXTURE_SPECS[kind].maxHp,
    broken: false,
    tearStage: 0,
    swingFrames: 0,
    hissFrames: 0,
    hitFlashFrames: 0,
  };
}

/** Whether the fuse box a fixture is wired to, if any, is still whole. */
export function isFixturePowered(
  fixture: WallFixture,
  fixtures: ReadonlyArray<WallFixture>,
): boolean {
  if (fixture.circuit === null) return true;
  if (fixture.circuit < 0 || fixture.circuit >= fixtures.length) return true;
  return !fixtures[fixture.circuit].state.broken;
}

/** Whether a fixture's light should be on: it is whole, and powered. */
export function isFixtureLit(fixture: WallFixture, fixtures: ReadonlyArray<WallFixture>): boolean {
  return !fixture.state.broken && isFixturePowered(fixture, fixtures);
}

// ── Placement tables ────────────────────────────────────────────────────────

/** The fixture each wall-hung light source is, or absent for a light that stands on the floor. */
const FIXTURE_FOR_LIGHT_SOURCE: Readonly<Partial<Record<LightSourceKind, WallFixtureKind>>> = {
  wall_sconce: 'sconce',
  fluorescent_tube: 'fluorescent_tube',
  sodium_lamp: 'sodium_lamp',
  emergency_light: 'emergency_light',
  monitor_glow: 'monitor_bank',
};

/** Whether a light source is hung on a wall face as a fixture rather than placed as a prop. */
export function isWallFixtureLight(kind: LightSourceKind): boolean {
  return FIXTURE_FOR_LIGHT_SOURCE[kind] !== undefined;
}

interface FixtureRoll {
  readonly kind: WallFixtureKind;
  readonly count: CountRange;
  /**
   * Set on a fixture the room is not itself without. It takes a face with a
   * prop in front when no clear one is free, rather than going missing.
   */
  readonly guaranteed?: boolean;
}

const ONE: CountRange = { min: 1, max: 1 };
const ONE_OR_TWO: CountRange = { min: 1, max: 2 };

/**
 * The fixtures a character hangs on its faces besides its lights, placed
 * before them so a room's lights never use up the faces its signature needs.
 * A fuse box is the electrical room's whole point, so it always has one;
 * every other room with tubes may get one by {@link FUSE_BOX_CHANCE}.
 */
const CHARACTER_FIXTURES: Readonly<Partial<Record<CharacterId, ReadonlyArray<FixtureRoll>>>> = {
  guard_post: [{ kind: 'hanging_chains', count: ONE_OR_TWO }],
  kennels: [{ kind: 'hanging_chains', count: ONE_OR_TWO }],
  crypt_chapel: [{ kind: 'torn_banner', count: ONE_OR_TWO }],
  boiler_room: [{ kind: 'steam_valve', count: ONE_OR_TWO }],
  security_nook: [{ kind: 'camera_dome', count: ONE }],
  electrical: [{ kind: 'fuse_box', count: ONE, guaranteed: true }],
};

/** The share of tube-lit rooms, the electrical room aside, that carry a breaker panel. */
const FUSE_BOX_CHANCE = 0.6;

/**
 * A run of face shorter than this gets no spaced light of its own: a stub of
 * corridor between two bends is lit by the runs either side of it.
 */
const MIN_RUN_FOR_SPACED_LIGHT = 6;

// ── Placement ───────────────────────────────────────────────────────────────

export interface WallFixturePlacementInput {
  readonly grid: TileContent[][];
  readonly regionMap: RegionMap;
  readonly characters: RegionCharacters;
  readonly rng: Rng;
}

interface FixtureDraft {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: WallFixtureKind;
  readonly seed: number;
  readonly region: number;
  /**
   * The fuse box draft this tube is wired to. Held by reference rather than by
   * index because `FixturePlacer.remove` splices the draft list, which would
   * shift any index taken before it.
   */
  circuitBox: FixtureDraft | null;
  /** A breaker already blown when the floor is entered: the reason its room is dark. */
  startsBroken: boolean;
}

/** The faces along a region's north wall a fixture may hang on, split by what stands in front. */
interface RegionFaces {
  /** Faces with open floor in front, from which a crawler can strike them. */
  readonly clear: ReadonlyArray<Point>;
  /** Faces with a low prop in front, which leaves the face above it in view. */
  readonly fronted: ReadonlyArray<Point>;
}

/**
 * Props tall enough, or built against the wall closely enough, to climb the
 * face behind them. A fixture hung over one would be drawn through it, so a
 * face fronted by one of these takes none.
 */
const FACE_COVERING_PROP_TYPES: ReadonlySet<number> = new Set([
  BOOKSHELF,
  WEAPON_RACK,
  LOCKER_BANK,
  FILING_CABINET,
  VENDING_MACHINE,
  BOILER,
  WINE_CASK,
  TORCH,
  ...FACE_CLIMBING_PROP_TILE_TYPES,
]);

/** Whether the prop standing on a tile, or the prop a part tile belongs to, covers the face behind it. */
export function coversFaceBehind(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return false;
  const type = grid[y][x].type;
  if (FACE_COVERING_PROP_TYPES.has(type)) return true;
  const anchor = multiTileAnchorOf(grid, x, y);
  return anchor !== null && FACE_COVERING_PROP_TYPES.has(grid[anchor.y][anchor.x].type);
}

const HALF_CHANCE = 0.5;

function rollCount(range: CountRange, rng: Rng): number {
  return range.min + Math.floor(rng() * (range.max - range.min + 1));
}

function faceKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Whether a tile is a wall carrying the lower tile of a face, squeezed or not. */
function carriesFaceFoot(grid: TileContent[][], x: number, y: number): boolean {
  if (grid[y]?.[x]?.type !== FloorTypeValue.wall) return false;
  const { face } = wallShapeAt(grid, x, y);
  return face === 'lower' || face === 'compressed';
}

/**
 * Whether a fixture may hang on this tile: a wall whose face's lower tile it
 * is, with the face running on to either side, so nothing hangs on the
 * return of a doorway, the end of a stub, or a room's corner.
 */
export function isFixtureFace(grid: TileContent[][], x: number, y: number): boolean {
  if (grid[y]?.[x]?.type !== FloorTypeValue.wall) return false;
  if (wallShapeAt(grid, x, y).face !== 'lower') return false;
  return carriesFaceFoot(grid, x - 1, y) && carriesFaceFoot(grid, x + 1, y);
}

class FixturePlacer {
  readonly drafts: FixtureDraft[] = [];
  private readonly taken = new Set<string>();

  constructor(
    private readonly grid: TileContent[][],
    private readonly rng: Rng,
  ) {}

  /** Free when nothing hangs on it or beside it, so two fixtures never touch. */
  isFree(face: Point): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      if (this.taken.has(faceKey(face.x + dx, face.y))) return false;
    }
    return true;
  }

  place(face: Point, kind: WallFixtureKind, region: number): FixtureDraft {
    const draft: FixtureDraft = {
      tileX: face.x,
      tileY: face.y,
      kind,
      seed: Math.floor(this.rng() * UINT32_SPAN),
      region,
      circuitBox: null,
      startsBroken: false,
    };
    this.drafts.push(draft);
    this.taken.add(faceKey(face.x, face.y));
    return draft;
  }

  /** Takes a fixture placed earlier back down, freeing its face. */
  remove(draft: FixtureDraft): void {
    const index = this.drafts.indexOf(draft);
    if (index < 0) return;
    this.drafts.splice(index, 1);
    this.taken.delete(faceKey(draft.tileX, draft.tileY));
  }

  /** Whether a draft is still hung, rather than placed and then taken back down. */
  holds(draft: FixtureDraft): boolean {
    return this.drafts.includes(draft);
  }

  /** The faces a region's floor tiles look north onto, each list in reading order. */
  facesAbove(tiles: Iterable<Point>): RegionFaces {
    const clear: Point[] = [];
    const fronted: Point[] = [];
    for (const tile of tiles) {
      if (!isFixtureFace(this.grid, tile.x, tile.y - 1)) continue;
      const face = { x: tile.x, y: tile.y - 1 };
      if (isWalkableTileType(this.grid[tile.y][tile.x])) clear.push(face);
      else if (!coversFaceBehind(this.grid, tile.x, tile.y)) fronted.push(face);
    }
    const readingOrder = (a: Point, b: Point): number => a.y - b.y || a.x - b.x;
    clear.sort(readingOrder);
    fronted.sort(readingOrder);
    return { clear, fronted };
  }

  /**
   * `count` fixtures spread evenly over `faces`, each nudged outwards from its
   * ideal spot to the nearest free face. Returns those placed.
   */
  spread(faces: ReadonlyArray<Point>, count: number, kind: WallFixtureKind, region: number) {
    const placed: FixtureDraft[] = [];
    for (let piece = 0; piece < count; piece++) {
      const target = Math.floor(((piece + 1) * faces.length) / (count + 1));
      for (let nudge = 0; nudge < faces.length; nudge++) {
        const direction = nudge % 2 === 0 ? 1 : -1;
        const candidate = target + direction * Math.ceil(nudge / 2);
        if (candidate < 0 || candidate >= faces.length) continue;
        const face = faces[candidate];
        if (!this.isFree(face)) continue;
        placed.push(this.place(face, kind, region));
        break;
      }
    }
    return placed;
  }

  /**
   * `count` fixtures on the free faces nearest the ends of the wall, one end
   * or the other first by chance, leaving its middle for the lights spread
   * after them.
   */
  towardEnds(faces: ReadonlyArray<Point>, count: number, kind: WallFixtureKind, region: number) {
    const placed: FixtureDraft[] = [];
    const fromLeft = this.rng() < HALF_CHANCE;
    for (let step = 0; step < faces.length && placed.length < count; step++) {
      const fromStart = Math.floor(step / 2);
      const takeFirstEnd = step % 2 === 0;
      const leftward = takeFirstEnd === fromLeft;
      const face = faces[leftward ? fromStart : faces.length - 1 - fromStart];
      if (this.isFree(face)) placed.push(this.place(face, kind, region));
    }
    return placed;
  }

  /** `count` fixtures on free faces chosen at random. */
  scatter(faces: ReadonlyArray<Point>, count: number, kind: WallFixtureKind, region: number) {
    const shuffled = [...faces];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(this.rng() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    const placed: FixtureDraft[] = [];
    for (const face of shuffled) {
      if (placed.length >= count) break;
      if (this.isFree(face)) placed.push(this.place(face, kind, region));
    }
    return placed;
  }

  /**
   * One fixture every `spacing` tiles along each straight run of face, the
   * first half a spacing in, so a corridor's lights fall between its ends.
   */
  spaced(
    faces: ReadonlyArray<Point>,
    spacing: CountRange,
    kind: WallFixtureKind,
    region: number,
  ): void {
    for (const run of straightRuns(faces)) {
      if (run.length < MIN_RUN_FOR_SPACED_LIGHT) continue;
      let cursor = Math.floor(rollCount(spacing, this.rng) / 2);
      while (cursor < run.length) {
        const face = run[cursor];
        if (this.isFree(face)) {
          this.place(face, kind, region);
          cursor += rollCount(spacing, this.rng);
        } else {
          cursor++;
        }
      }
    }
  }
}

/** Faces split into runs of the same row with no gap, each in order along the row. */
function straightRuns(faces: ReadonlyArray<Point>): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  for (const face of faces) {
    const last = current.length > 0 ? current[current.length - 1] : null;
    if (last !== null && (last.y !== face.y || last.x + 1 !== face.x)) {
      runs.push(current);
      current = [];
    }
    current.push(face);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** A room's top row of floor: the tiles its north faces stand on. */
function roomTopRow(room: RoomRegion): Point[] {
  const tiles: Point[] = [];
  for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
    tiles.push({ x, y: room.bounds.y });
  }
  return tiles;
}

/** Clear faces while any are, so lights can be reached; prop-fronted faces otherwise. */
function lightFaces(faces: RegionFaces): ReadonlyArray<Point> {
  return faces.clear.length > 0 ? faces.clear : faces.fronted;
}

function placeLights(
  placer: FixturePlacer,
  faces: RegionFaces,
  sources: ReadonlyArray<LightSourceSpec>,
  region: number,
  rng: Rng,
): void {
  const usable = lightFaces(faces);
  for (const source of sources) {
    const kind = FIXTURE_FOR_LIGHT_SOURCE[source.kind];
    if (kind === undefined) continue;
    if ('count' in source.amount) {
      const count = rollCount(source.amount.count, rng);
      const placed = placer.spread(usable, count, kind, region);
      // Every clear face taken or crowded: a face behind a low prop will do.
      if (placed.length < count && usable !== faces.fronted) {
        placer.spread(faces.fronted, count - placed.length, kind, region);
      }
    } else {
      placer.spaced(usable, source.amount.everyTiles, kind, region);
    }
  }
}

function placeSignature(
  placer: FixturePlacer,
  faces: RegionFaces,
  roll: FixtureRoll,
  region: number,
  rng: Rng,
): FixtureDraft[] {
  const count = rollCount(roll.count, rng);
  const placed = placer.towardEnds(faces.clear, count, roll.kind, region);
  if (roll.guaranteed === true && placed.length < count) {
    placed.push(...placer.towardEnds(faces.fronted, count - placed.length, roll.kind, region));
  }
  return placed;
}

/**
 * Takes optional signature fixtures back down, the last hung first, until a
 * face is free for the room's wall light. On a short wall the signature
 * pieces at both ends can leave every face between them touching one, and a
 * lit room that should hang a light must not come out dark for a valve.
 */
function freeAFaceForTheLight(
  placer: FixturePlacer,
  faces: RegionFaces,
  optional: FixtureDraft[],
): void {
  const anyFree = (): boolean =>
    faces.clear.some((face) => placer.isFree(face)) ||
    faces.fronted.some((face) => placer.isFree(face));
  while (!anyFree()) {
    const last = optional.pop();
    if (last === undefined) return;
    placer.remove(last);
  }
}

/** A breaker panel for a tube-lit room that is not the electrical room, by chance. */
function optionalFuseBox(
  placer: FixturePlacer,
  faces: RegionFaces,
  region: number,
  rng: Rng,
): FixtureDraft | null {
  if (rng() >= FUSE_BOX_CHANCE) return null;
  const placed = placer.scatter(lightFaces(faces), 1, 'fuse_box', region);
  return placed.length > 0 ? placed[0] : null;
}

function dressRoomFaces(placer: FixturePlacer, room: RoomRegion, input: WallFixturePlacementInput) {
  const assignment = input.characters.forRegion(room.id);
  if (assignment?.type !== 'room') return;
  const { character, unlit } = assignment;
  const faces = placer.facesAbove(roomTopRow(room));
  if (faces.clear.length === 0 && faces.fronted.length === 0) return;
  const optionalSignature: FixtureDraft[] = [];
  const signature = (CHARACTER_FIXTURES[character.id] ?? []).flatMap((roll) => {
    const placed = placeSignature(placer, faces, roll, room.id, input.rng);
    if (roll.guaranteed !== true) optionalSignature.push(...placed);
    return placed;
  });
  const hangsAWallLight = character.lighting.sources.some((source) =>
    isWallFixtureLight(source.kind),
  );
  if (!unlit && hangsAWallLight) freeAFaceForTheLight(placer, faces, optionalSignature);
  if (!unlit) placeLights(placer, faces, character.lighting.sources, room.id, input.rng);

  const tubes = placer.drafts.filter(
    (draft) => draft.region === room.id && draft.kind === 'fluorescent_tube',
  );
  const signatureBox = signature.find((draft) => draft.kind === 'fuse_box' && placer.holds(draft));
  // An unlit room's breaker is already blown: it is the reason the room is
  // dark, and a live panel with nothing on it would promise a blackout that
  // breaking it cannot deliver.
  if (signatureBox !== undefined && unlit) signatureBox.startsBroken = true;
  if (tubes.length === 0) return;
  const box = signatureBox ?? optionalFuseBox(placer, faces, room.id, input.rng);
  if (box === null) return;
  for (const tube of tubes) tube.circuitBox = box;
}

function dressHallwayFaces(
  placer: FixturePlacer,
  hallway: HallwayRegion,
  input: WallFixturePlacementInput,
) {
  const assignment = input.characters.forRegion(hallway.id);
  if (assignment?.type !== 'hallway') return;
  const faces = placer.facesAbove(hallway.tiles);
  placeLights(placer, faces, assignment.character.lighting.sources, hallway.id, input.rng);
}

/**
 * Hangs every fixture a floor's rooms and hallways call for on their north
 * faces: each room's own fixtures first, then the region's wall-hung lights
 * from its lighting profile (none in a room rolled unlit), then a breaker
 * panel for a tube-lit room, which every tube in that room is wired to.
 * Special rooms keep their own dressing and take none.
 */
export function placeWallFixtures(input: WallFixturePlacementInput): WallFixture[] {
  const placer = new FixturePlacer(input.grid, input.rng);
  for (const room of input.regionMap.rooms) dressRoomFaces(placer, room, input);
  for (const hallway of input.regionMap.hallways) dressHallwayFaces(placer, hallway, input);
  const idOfDraft = new Map(placer.drafts.map((draft, id) => [draft, id]));
  return placer.drafts.map((draft, id) => {
    const circuit = draft.circuitBox === null ? null : (idOfDraft.get(draft.circuitBox) ?? null);
    const state = freshFixtureState(draft.kind);
    if (draft.startsBroken) {
      state.hp = 0;
      state.broken = true;
    }
    return {
      id,
      tileX: draft.tileX,
      tileY: draft.tileY,
      kind: draft.kind,
      seed: draft.seed,
      region: draft.region,
      circuit,
      state,
    };
  });
}

/** The open tile a fixture's face stands on, which its dressing and its sort are keyed to. */
export function fixtureFoot(fixture: WallFixture): Point {
  return { x: fixture.tileX, y: fixture.tileY + 1 };
}

// ── Drawing order ───────────────────────────────────────────────────────────

/**
 * Tiles a fixture's art may reach outside its face tile: up into the face's
 * upper tile, and a little past it for a swinging chain or a puff of steam.
 */
const FIXTURE_REACH_TILES = 2;

/**
 * Where a fixture sorts in the Y-sorted pass: the foot of its face. Anything
 * standing on the floor in front of the face has its own foot further south,
 * so a crawler passing under a sconce is drawn over it; a prop whose foot
 * ties with it is queued after it and so drawn over it too.
 */
export function wallFixtureSortY(fixture: WallFixture): number {
  return (fixture.tileY + 1) * TILE_SIZE;
}

/** A floor's fixtures bucketed by row, so a frame visits only the rows in view. */
const fixtureRows = new WeakMap<ReadonlyArray<WallFixture>, ReadonlyArray<WallFixture[]>>();

function rowsOf(fixtures: ReadonlyArray<WallFixture>): ReadonlyArray<WallFixture[]> {
  const cached = fixtureRows.get(fixtures);
  if (cached !== undefined) return cached;
  const rows: WallFixture[][] = [];
  for (const fixture of fixtures) {
    while (rows.length <= fixture.tileY) rows.push([]);
    rows[fixture.tileY].push(fixture);
  }
  fixtureRows.set(fixtures, rows);
  return rows;
}

/**
 * Fills `out` with the fixtures whose art may fall inside a view, row by row,
 * and returns it. `out` is cleared first and reused, so a frame allocates
 * nothing.
 */
export function collectVisibleWallFixtures(
  fixtures: ReadonlyArray<WallFixture>,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  out: WallFixture[],
): WallFixture[] {
  out.length = 0;
  const rows = rowsOf(fixtures);
  const firstRow = Math.max(0, Math.floor(camY / TILE_SIZE) - FIXTURE_REACH_TILES);
  const lastRow = Math.min(
    rows.length - 1,
    Math.floor((camY + viewH) / TILE_SIZE) + FIXTURE_REACH_TILES,
  );
  const minX = camX - (FIXTURE_REACH_TILES + 1) * TILE_SIZE;
  const maxX = camX + viewW + FIXTURE_REACH_TILES * TILE_SIZE;
  for (let row = firstRow; row <= lastRow; row++) {
    for (const fixture of rows[row]) {
      const x = fixture.tileX * TILE_SIZE;
      if (x >= minX && x <= maxX) out.push(fixture);
    }
  }
  return out;
}
