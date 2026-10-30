/**
 * The thief over the General Store at dusk, and its flight to the temple dome.
 *
 * **The stakeout.** Once the party comes to the store the thief circles it on
 * a fixed loop, a timeline of the same patrol segments the prison's guards
 * walk (`GuardSegment`, `poseOnSegments`), looking in toward the store with a
 * sight cone cast against the town's buildings (`castCone`, `lightSeesBody`).
 * A crawler in the open inside that cone makes it circle away and come back
 * later: never a fail, only a wait. A crawler stood in a marked hiding spot is
 * never seen. Left unseen for long enough, it swoops on the cat on the step.
 *
 * **The chase.** It flies a fixed route over the roofs, perch to perch, to the
 * Temple of the Sky. Whenever the steered crawler has fallen more than
 * {@link CHASE_LEASH_TILES} behind it settles on its next perch and waits for
 * them, so the party can lose sight of it but can never lose it.
 *
 * Pure state over world pixels: no canvas, no scene. The quest system draws it
 * and plays its sounds from the events {@link RooftopThief.update} returns.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import { PRISON_TILE, type PrisonGrid } from '../../map/goblinPrisonPlan';
import type { TilePoint } from '../../map/town/townPlan';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import {
  castCone,
  lightSeesBody,
  type ConeShape,
  type PrisonPoint,
} from '../stealthKeySnatch/detection';
import { poseOnSegments, type GuardSegment } from '../stealthKeySnatch/prisonPatrols';
import type { PrisonConeTuning } from '../stealthKeySnatch/prisonTuning';

const HALF_TILE = TILE_SIZE / 2;
const FULL_TURN = Math.PI * 2;

/** Where the hiding spots stand round the store's door, in tiles. */
const HIDING_SPOT_OFFSETS: readonly TilePoint[] = [
  { x: -5, y: 2 },
  { x: 5, y: 2 },
  { x: -3, y: 6 },
  { x: 4, y: 6 },
];
const HIDING_SPOT_SEARCH_TILES = 3;
/** How close to a spot's centre a crawler must stand to be hidden in it. */
export const HIDING_SPOT_RADIUS_TILES = 0.9;

/** The loop it flies over the store. */
const CIRCLE_RADIUS_TILES = 6;
const CIRCLE_POINTS = 8;
/** Pixels a frame while it circles. */
const CIRCLE_SPEED = 1.4;
/** Its circling loop sits a little north of the door, over the store's own roof. */
const CIRCLE_CENTRE_ROWS_NORTH = 2;
/** How near the store the steered crawler must come before the thief arrives at all. */
const ARRIVE_WITHIN_TILES = 14;

/** What it sees from above: a cone looking in from its loop toward the store. */
const THIEF_SIGHT: PrisonConeTuning = { rangeTiles: 8, halfAngleDeg: 38, softEdge: 0.25 };
/** Seen at the soft edge of its cone, a crawler counts this much. */
const SIGHT_EDGE_WEIGHT = 0.5;
/** How long it stays away after it sees a crawler, before it comes back. */
const AWAY_FRAMES = 420;
/** How long it must circle unseeing before it swoops: a little over one loop. */
const SWOOP_PATIENCE_FRAMES = 600;
const SWOOP_FRAMES = 70;
/** It is gone off over the roofs, this far from the store, while it is away. */
const AWAY_DISTANCE_TILES = 30;

/** Its flight to the temple. */
const CHASE_SPEED = 2.4;
const CHASE_LEASH_TILES = 11;
/** Closer than this, it leaves its perch again. */
const CHASE_RESUME_TILES = 7;
/** A roof is perched this many rows north of its door, over the building. */
const ROOF_ROWS_NORTH = 3;
/** A building counts as on the way if it stands this close to the straight line. */
const ROUTE_BAND_TILES = 14;
const MIN_PERCH_GAP_TILES = 10;
const MAX_PERCHES = 5;
/** The temple's dome stands this many rows north of its door. */
const TEMPLE_DOME_ROWS_NORTH = 5;
/** Flapping, in radians a frame; it glides on the circle and beats hard in the chase. */
const GLIDE_FLAP_RATE = 0.06;
const BEAT_FLAP_RATE = 0.22;

export interface StakeoutPlan {
  /** The step the cat sits on, in world pixels. */
  readonly catAt: PrisonPoint;
  readonly hidingSpots: readonly TilePoint[];
  readonly loop: readonly GuardSegment[];
  readonly loopFrames: number;
  readonly circleCentre: PrisonPoint;
  readonly grid: PrisonGrid;
}

/** The town as the thief's sight sees it: buildings stop it, open ground does not. */
function sightGrid(map: GameMap): PrisonGrid {
  const height = map.structure.length;
  const width = map.structure[0]?.length ?? 0;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = map.isWalkable(x, y, 'walker') ? PRISON_TILE.floor : PRISON_TILE.wall;
    }
  }
  return { width, height, tiles };
}

function tileCentre(tile: TilePoint): PrisonPoint {
  return { x: tile.x * TILE_SIZE + HALF_TILE, y: tile.y * TILE_SIZE + HALF_TILE };
}

/** The stakeout round the store whose door is `storeDoor`, or null when the ground round it has no room. */
export function planStakeout(map: GameMap, storeDoor: TilePoint): StakeoutPlan | null {
  const step = findNearbyWalkableTile(map, storeDoor.x, storeDoor.y + 1, HIDING_SPOT_SEARCH_TILES);
  if (step === null) return null;
  const hidingSpots: TilePoint[] = [];
  for (const offset of HIDING_SPOT_OFFSETS) {
    const tile = findNearbyWalkableTile(
      map,
      storeDoor.x + offset.x,
      storeDoor.y + offset.y,
      HIDING_SPOT_SEARCH_TILES,
    );
    if (tile !== null) hidingSpots.push(tile);
  }
  const circleCentre = tileCentre({ x: storeDoor.x, y: storeDoor.y - CIRCLE_CENTRE_ROWS_NORTH });
  const radius = CIRCLE_RADIUS_TILES * TILE_SIZE;
  const points: PrisonPoint[] = [];
  for (let i = 0; i < CIRCLE_POINTS; i++) {
    const angle = (i / CIRCLE_POINTS) * FULL_TURN;
    points.push({
      x: circleCentre.x + Math.cos(angle) * radius,
      y: circleCentre.y + Math.sin(angle) * radius,
    });
  }
  const catAt = tileCentre(step);
  const loop: GuardSegment[] = [];
  let start = 0;
  points.forEach((from, index) => {
    const to = points[(index + 1) % points.length] ?? from;
    const frames = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y) / CIRCLE_SPEED);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const facing = Math.atan2(catAt.y - mid.y, catAt.x - mid.x);
    loop.push({ kind: 'move', start, frames, from, to, facing });
    start += frames;
  });
  let grid: PrisonGrid | null = null;
  return {
    catAt,
    hidingSpots,
    loop,
    loopFrames: start,
    circleCentre,
    // Built on the stakeout's first look rather than with the plan: the plan
    // is made with every town scene, the stakeout happens once.
    get grid(): PrisonGrid {
      grid ??= sightGrid(map);
      return grid;
    },
  };
}

/** The roofs it crosses from the store to the temple dome, in order. */
export function planRooftopRoute(
  doors: readonly TilePoint[],
  storeDoor: TilePoint,
  templeDoor: TilePoint,
): readonly PrisonPoint[] {
  const start = tileCentre({ x: storeDoor.x, y: storeDoor.y - ROOF_ROWS_NORTH });
  const end = tileCentre({ x: templeDoor.x, y: templeDoor.y - TEMPLE_DOME_ROWS_NORTH });
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [start, end];
  const along = (point: PrisonPoint): number =>
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / length;
  const across = (point: PrisonPoint): number =>
    Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
  const roofs = doors
    .map((door) => tileCentre({ x: door.x, y: door.y - ROOF_ROWS_NORTH }))
    .filter((roof) => {
      const t = along(roof);
      return t > 0 && t < length && across(roof) <= ROUTE_BAND_TILES * TILE_SIZE;
    })
    .sort((a, b) => along(a) - along(b));
  const route: PrisonPoint[] = [start];
  for (const roof of roofs) {
    if (route.length > MAX_PERCHES) break;
    const last = route[route.length - 1] ?? start;
    const gapToLast = Math.hypot(roof.x - last.x, roof.y - last.y);
    const gapToEnd = Math.hypot(end.x - roof.x, end.y - roof.y);
    if (gapToLast < MIN_PERCH_GAP_TILES * TILE_SIZE || gapToEnd < MIN_PERCH_GAP_TILES * TILE_SIZE)
      continue;
    route.push(roof);
  }
  route.push(end);
  return route;
}

/** What the thief did this frame that the quest answers with a line, a sound or a phase. */
export type ThiefEvent = 'arrived' | 'spotted' | 'returned' | 'swooped' | 'perched' | 'landed';

type ThiefState =
  | { readonly kind: 'not_here' }
  | { kind: 'circling'; loopFrame: number; patience: number }
  | { kind: 'away'; loopFrame: number; framesLeft: number }
  | { kind: 'swooping'; frame: number; readonly from: PrisonPoint }
  | { kind: 'flying'; leg: number; travelled: number }
  | { kind: 'perched'; leg: number }
  | { readonly kind: 'landed' };

/** Where it is drawn, and whether it has the cat. */
export interface ThiefPose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly flap: number;
  readonly carrying: boolean;
}

interface Body {
  readonly x: number;
  readonly y: number;
}

export class RooftopThief {
  private state: ThiefState;
  private flapPhase = 0;
  private x = 0;
  private y = 0;
  private heading = 0;
  private sight: ConeShape | null = null;

  /** Builds the thief for the stakeout, or for the chase already under way. */
  constructor(
    private readonly plan: StakeoutPlan,
    private readonly route: readonly PrisonPoint[],
    chasing: boolean,
  ) {
    this.state = chasing ? { kind: 'flying', leg: 0, travelled: 0 } : { kind: 'not_here' };
    const first = route[0] ?? plan.catAt;
    if (chasing) {
      this.x = first.x;
      this.y = first.y;
    }
  }

  /** Whether the cat is still on the step. */
  get catOnStep(): boolean {
    const kind = this.state.kind;
    return kind === 'not_here' || kind === 'circling' || kind === 'away';
  }

  /** Whether it is anywhere to be drawn. */
  get pose(): ThiefPose | null {
    const kind = this.state.kind;
    if (kind === 'not_here' || kind === 'away' || kind === 'landed') return null;
    return {
      x: this.x,
      y: this.y,
      heading: this.heading,
      flap: Math.sin(this.flapPhase),
      carrying: !this.catOnStep && kind !== 'swooping',
    };
  }

  /** Whether it is on the wing between perches during the chase. */
  get gliding(): boolean {
    return this.state.kind === 'flying';
  }

  /** Its sight cone this frame, while it is looking for the party. */
  get sightCone(): ConeShape | null {
    return this.state.kind === 'circling' ? this.sight : null;
  }

  /** Whether `body` stands in one of the marked hiding spots. */
  isHidden(body: Body): boolean {
    const reach = HIDING_SPOT_RADIUS_TILES * TILE_SIZE;
    return this.plan.hidingSpots.some((spot) => {
      const centre = tileCentre(spot);
      return Math.hypot(body.x + HALF_TILE - centre.x, body.y + HALF_TILE - centre.y) <= reach;
    });
  }

  /**
   * One frame. `steered` is the crawler being played; `present` every crawler
   * on the map, any of whom it may see.
   */
  update(steered: Body, present: readonly Body[]): ThiefEvent | null {
    const state = this.state;
    switch (state.kind) {
      case 'not_here': {
        const distance = Math.hypot(
          steered.x + HALF_TILE - this.plan.catAt.x,
          steered.y + HALF_TILE - this.plan.catAt.y,
        );
        if (distance > ARRIVE_WITHIN_TILES * TILE_SIZE) return null;
        this.state = { kind: 'circling', loopFrame: 0, patience: 0 };
        this.placeOnLoop(0);
        return 'arrived';
      }
      case 'circling':
        return this.circle(state, present);
      case 'away': {
        state.loopFrame++;
        state.framesLeft--;
        if (state.framesLeft > 0) return null;
        this.state = { kind: 'circling', loopFrame: state.loopFrame, patience: 0 };
        this.placeOnLoop(state.loopFrame);
        return 'returned';
      }
      case 'swooping': {
        state.frame++;
        const share = Math.min(1, state.frame / SWOOP_FRAMES);
        this.x = state.from.x + (this.plan.catAt.x - state.from.x) * share;
        this.y = state.from.y + (this.plan.catAt.y - state.from.y) * share;
        this.flapPhase += BEAT_FLAP_RATE;
        if (share < 1) return null;
        this.state = { kind: 'flying', leg: 0, travelled: 0 };
        return 'swooped';
      }
      case 'flying':
        return this.fly(state, steered);
      case 'perched': {
        const distance = Math.hypot(steered.x - this.x, steered.y - this.y);
        this.flapPhase += GLIDE_FLAP_RATE;
        if (distance > CHASE_RESUME_TILES * TILE_SIZE) return null;
        this.state = { kind: 'flying', leg: state.leg, travelled: 0 };
        return null;
      }
      case 'landed':
        return null;
    }
  }

  private circle(
    state: { loopFrame: number; patience: number },
    present: readonly Body[],
  ): ThiefEvent | null {
    state.loopFrame++;
    state.patience++;
    this.placeOnLoop(state.loopFrame);
    const pose = poseOnSegments('thief', this.plan.loop, state.loopFrame % this.plan.loopFrames);
    this.sight = castCone(this.plan.grid, { x: pose.x, y: pose.y }, pose.facing, THIEF_SIGHT);
    const sight = this.sight;
    const seen = present.some(
      (body) =>
        !this.isHidden(body) &&
        lightSeesBody(
          this.plan.grid,
          sight,
          { x: body.x + HALF_TILE, y: body.y + HALF_TILE },
          SIGHT_EDGE_WEIGHT,
        ) > 0,
    );
    if (seen) {
      this.state = { kind: 'away', loopFrame: state.loopFrame, framesLeft: AWAY_FRAMES };
      this.x = this.plan.circleCentre.x;
      this.y = this.plan.circleCentre.y - AWAY_DISTANCE_TILES * TILE_SIZE;
      return 'spotted';
    }
    if (state.patience < SWOOP_PATIENCE_FRAMES) return null;
    this.state = { kind: 'swooping', frame: 0, from: { x: this.x, y: this.y } };
    this.heading = Math.atan2(this.plan.catAt.y - this.y, this.plan.catAt.x - this.x);
    return null;
  }

  private placeOnLoop(loopFrame: number): void {
    const pose = poseOnSegments('thief', this.plan.loop, loopFrame % this.plan.loopFrames);
    const dx = pose.x - this.x;
    const dy = pose.y - this.y;
    if (dx !== 0 || dy !== 0) this.heading = Math.atan2(dy, dx);
    this.x = pose.x;
    this.y = pose.y;
    this.flapPhase += GLIDE_FLAP_RATE;
  }

  private fly(state: { leg: number; travelled: number }, steered: Body): ThiefEvent | null {
    const from = this.route[state.leg] ?? this.plan.catAt;
    if (state.leg + 1 >= this.route.length) {
      this.state = { kind: 'landed' };
      return 'landed';
    }
    const to = this.route[state.leg + 1];
    const legLength = Math.hypot(to.x - from.x, to.y - from.y);
    state.travelled = Math.min(legLength, state.travelled + CHASE_SPEED);
    const share = legLength === 0 ? 1 : state.travelled / legLength;
    this.x = from.x + (to.x - from.x) * share;
    this.y = from.y + (to.y - from.y) * share;
    this.heading = Math.atan2(to.y - from.y, to.x - from.x);
    this.flapPhase += BEAT_FLAP_RATE;
    if (share < 1) return null;
    state.leg++;
    state.travelled = 0;
    if (state.leg >= this.route.length - 1) {
      this.state = { kind: 'landed' };
      return 'landed';
    }
    const behind =
      Math.hypot(steered.x - this.x, steered.y - this.y) > CHASE_LEASH_TILES * TILE_SIZE;
    if (!behind) return null;
    this.state = { kind: 'perched', leg: state.leg };
    return 'perched';
  }
}
