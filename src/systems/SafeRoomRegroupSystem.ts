import type { AudioManager } from '../audio/AudioManager';
import { TILE_SIZE } from '../core/constants';
import { CanvasContextUnavailableError } from '../core/rendering/canvasSurface';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { GameMap } from '../map/GameMap';
import { sameSafeRoom, type SafeRoomId } from '../map/safeRoomId';
import { drawTeleport, TELEPORT_IN_FRAMES, TELEPORT_SOUNDS } from '../sprites/teleportEffect';
import { TeleportSnapshot } from '../sprites/teleportSnapshot';
import type { CompanionSystem } from './CompanionSystem';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { TownPropRenderable } from './townPropRenderable';

type Crawler = HumanPlayer | CatPlayer;

/**
 * How far the companion may be from the crawler walking into a safe room, in
 * tiles, before the world brings it into the room instead of leaving it to
 * walk there.
 */
export const SAFE_ROOM_REGROUP_DISTANCE_TILES = 15;
const SAFE_ROOM_REGROUP_DISTANCE_PX = SAFE_ROOM_REGROUP_DISTANCE_TILES * TILE_SIZE;

/** Offset from a body's origin to the centre of the tile it stands on, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;

/** The rooms each crawler stood in on the last update. */
interface CrawlerRooms {
  readonly human: SafeRoomId | null;
  readonly cat: SafeRoomId | null;
}

/**
 * The snapshot an arrival is built from: not taken yet, taken, or tried once
 * and refused. A refusal is final for the build, so a body with no ink yet or
 * a browser out of canvas budget costs one attempt rather than one per frame.
 */
type ArrivalSnapshot =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ready'; readonly snapshot: TeleportSnapshot }
  | { readonly kind: 'unavailable' };

const PENDING_SNAPSHOT = { kind: 'pending' } as const satisfies ArrivalSnapshot;
const UNAVAILABLE_SNAPSHOT = { kind: 'unavailable' } as const satisfies ArrivalSnapshot;

/** A companion part-way through being built in the room. */
interface Arrival {
  readonly crawler: Crawler;
  elapsedFrames: number;
  /** Taken on its first draw, when the density it is drawn at is known. */
  snapshot: ArrivalSnapshot;
  /** The arrival in the scene's Y-sorted pass, standing in for the crawler. */
  readonly figure: TownPropRenderable;
}

export interface SafeRoomRegroupDeps {
  readonly safeRooms: Pick<SafeRoomSystem, 'safeRoomAt' | 'guidePlacement'>;
  readonly companions: Pick<
    CompanionSystem,
    'getMovementMode' | 'followTrail' | 'regroup' | 'clearDirective'
  >;
  readonly audio: Pick<AudioManager, 'playAt'> | null;
  /**
   * Whether something else owns where the party stands this frame — a script
   * moving it, a stall or a death scene hiding a crawler — and a regroup
   * would move a body out from under it.
   */
  readonly partyIsHeld: (human: HumanPlayer, cat: CatPlayer) => boolean;
}

function tileUnder(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
  };
}

function holdsRoom(previous: SafeRoomId | null, current: SafeRoomId): boolean {
  return previous !== null && sameSafeRoom(previous, current);
}

/**
 * Brings a straggling companion into the safe room the player walks into.
 *
 * When the crawler being driven steps into a safe room and the other crawler
 * is more than {@link SAFE_ROOM_REGROUP_DISTANCE_TILES} away, the world sets
 * the companion down on open floor beside them and builds it there with the
 * same teleport Dave arrives by.
 *
 * Only a companion that is on its feet and following. A knocked-out one stays
 * where it fell: a revive is earned by reaching the body, every revive in the
 * game is judged at the spot it went down, and a door already refuses a party
 * that would leave one behind; teleporting it into the doctor's room would
 * turn every safe room into a free revive at any range. One told to stay put
 * stays put, because the player parked it there on purpose.
 */
export class SafeRoomRegroupSystem {
  /** Null until the first update, so a party that loads already inside a room does not count as walking in. */
  private lastRooms: CrawlerRooms | null = null;
  private arrival: Arrival | null = null;

  constructor(private readonly deps: SafeRoomRegroupDeps) {}

  update(human: HumanPlayer, cat: CatPlayer, gameMap: GameMap): void {
    this.advanceArrival();
    const rooms: CrawlerRooms = {
      human: this.deps.safeRooms.safeRoomAt(human),
      cat: this.deps.safeRooms.safeRoomAt(cat),
    };
    const previous = this.lastRooms;
    this.lastRooms = rooms;
    if (previous === null) return;

    // Each crawler's own last room, not the party's: a character switch hands
    // the drive to a crawler that may already be standing in one, and that is
    // not walking in.
    const humanIsActive = human.isActive;
    const leader = humanIsActive ? human : cat;
    const companion = humanIsActive ? cat : human;
    const enteredRoom = humanIsActive ? rooms.human : rooms.cat;
    const leaderWasIn = humanIsActive ? previous.human : previous.cat;
    const companionIsIn = humanIsActive ? rooms.cat : rooms.human;
    if (enteredRoom === null || holdsRoom(leaderWasIn, enteredRoom)) return;
    if (holdsRoom(companionIsIn, enteredRoom)) return;
    if (!this.mayRegroup(human, cat, leader, companion, humanIsActive)) return;
    this.bringIn(leader, companion, enteredRoom, humanIsActive, gameMap);
  }

  private mayRegroup(
    human: HumanPlayer,
    cat: CatPlayer,
    leader: Crawler,
    companion: Crawler,
    humanIsActive: boolean,
  ): boolean {
    if (this.arrival !== null) return false;
    if (!companion.isAlive || companion.isKnockedOut || !companion.canAct) return false;
    if (this.deps.partyIsHeld(human, cat)) return false;
    const { companions } = this.deps;
    if (companions.getMovementMode(humanIsActive) !== 'follow') return false;
    if (companions.followTrail !== null) return false;
    const distance = Math.hypot(companion.x - leader.x, companion.y - leader.y);
    return distance > SAFE_ROOM_REGROUP_DISTANCE_PX;
  }

  private bringIn(
    leader: Crawler,
    companion: Crawler,
    room: SafeRoomId,
    humanIsActive: boolean,
    gameMap: GameMap,
  ): void {
    const placement = this.deps.safeRooms.guidePlacement(room);
    if (placement === null) return;
    const { bounds, home } = placement;
    const leaderTile = tileUnder(leader);
    // Off Dave's arrival tile as well as the room's fixtures: he may be about
    // to teleport onto it, and two figures built on one tile read as one.
    const isLanding = (x: number, y: number): boolean =>
      x >= bounds.x &&
      x < bounds.x + bounds.w &&
      y >= bounds.y &&
      y < bounds.y + bounds.h &&
      (x !== leaderTile.x || y !== leaderTile.y) &&
      (x !== home.x || y !== home.y) &&
      placement.canStand(x, y);
    const wholeRoomTiles = Math.max(bounds.w, bounds.h);
    const landing = findNearbyWalkableTile(
      gameMap,
      leaderTile.x,
      leaderTile.y,
      wholeRoomTiles,
      isLanding,
    );
    if (landing === null) return;

    companion.placeAt(landing.x * TILE_SIZE, landing.y * TILE_SIZE);
    this.deps.companions.regroup(companion, humanIsActive);
    this.deps.audio?.playAt(
      TELEPORT_SOUNDS.in,
      companion.x + TILE_SIZE * TILE_CENTRE_FRACTION,
      companion.y + TILE_SIZE * TILE_CENTRE_FRACTION,
    );
    const arrival: Arrival = {
      crawler: companion,
      elapsedFrames: 0,
      snapshot: PENDING_SNAPSHOT,
      // Read live: an order to hold still still gives way to a hazard or a
      // mob it must flee, and the build sorts where the body actually is.
      figure: {
        get x() {
          return companion.x;
        },
        get y() {
          return companion.y;
        },
        render: (ctx, camX, camY, tileSize) =>
          this.renderArrival(ctx, arrival, camX, camY, tileSize),
      },
    };
    this.arrival = arrival;
  }

  /**
   * Ends the build once it has run its length, or as soon as the body stops
   * being the companion standing still: switched to, so the player is driving
   * it, or knocked down.
   */
  private advanceArrival(): void {
    const arrival = this.arrival;
    if (arrival === null) return;
    arrival.elapsedFrames++;
    const { crawler } = arrival;
    const finished = arrival.elapsedFrames >= TELEPORT_IN_FRAMES;
    if (finished || crawler.isActive || crawler.isKnockedOut || !crawler.isAlive) {
      this.endArrival();
    }
  }

  private endArrival(): void {
    const arrival = this.arrival;
    if (arrival === null) return;
    if (arrival.snapshot.kind === 'ready') arrival.snapshot.snapshot.release();
    this.arrival = null;
    this.deps.companions.clearDirective();
  }

  private renderArrival(
    ctx: CanvasRenderingContext2D,
    arrival: Arrival,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const { crawler } = arrival;
    if (arrival.snapshot.kind === 'pending') {
      arrival.snapshot = this.takeSnapshot(ctx, crawler, tileSize);
    }
    if (arrival.snapshot.kind !== 'ready') {
      crawler.render(ctx, camX, camY, tileSize);
      return;
    }
    drawTeleport(
      ctx,
      arrival.snapshot.snapshot,
      null,
      crawler.x - camX,
      crawler.y - camY,
      tileSize,
      {
        direction: 'in',
        elapsedFrames: arrival.elapsedFrames,
      },
    );
  }

  /**
   * One attempt at the body's snapshot, at the density `ctx` draws at. A
   * refused canvas context is a browser out of canvas memory, not a bug, so it
   * leaves the body drawn plainly rather than failing the draw.
   */
  private takeSnapshot(
    ctx: CanvasRenderingContext2D,
    crawler: Crawler,
    tileSize: number,
  ): ArrivalSnapshot {
    const { a, b, c, d } = ctx.getTransform();
    const density = Math.sqrt(Math.abs(a * d - b * c));
    try {
      const snapshot = TeleportSnapshot.take(
        (target, x, y, size) => crawler.paintBodyAt(target, x, y, size),
        tileSize,
        density,
      );
      return snapshot === null ? UNAVAILABLE_SNAPSHOT : { kind: 'ready', snapshot };
    } catch (error) {
      if (error instanceof CanvasContextUnavailableError) return UNAVAILABLE_SNAPSHOT;
      throw error;
    }
  }

  /** Whether `crawler` is being built this frame, and the scene must draw {@link sortedFigures} in its place. */
  hides(crawler: Crawler): boolean {
    return this.arrival?.crawler === crawler;
  }

  /** The arrival under way, for the scene's Y-sorted pass; empty when there is none. */
  sortedFigures(): readonly TownPropRenderable[] {
    return this.arrival === null ? [] : [this.arrival.figure];
  }

  /**
   * Ends any build under way and forgets where the crawlers stood, so the next
   * update counts as the first: for a respawn that sets the party down in a
   * room without walking it in, and for the scene's teardown.
   */
  reset(): void {
    this.endArrival();
    this.lastRooms = null;
  }

  dispose(): void {
    this.reset();
  }
}
