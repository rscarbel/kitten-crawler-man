/**
 * The cattery's keeper, a raveling on a slow round: a long look over the room,
 * a turn, a long gaze up at the observatory window, a turn back. Its look is
 * a fan cast over the storey's own floor, so whatever stands tall in the room
 * (a cage, a pillar, a heap of feed sacks) throws a shadow in it, and the fan
 * drawn on the floor is the one that sees. Belle out of her cage in full
 * view of the fan is caught at a glance; at its edge she only puts it on its
 * guard, and seen again while it is, she is caught.
 *
 * A paw heard at a latch breaks the round off: it swings its look onto the
 * noise and floats over until the noise is well inside its fan, sliding
 * along anything tall in its way rather than through it, follows Belle
 * while it sees her, and searches on a while after it loses her before it
 * keeps its round again. So a jostle it hears is one it can catch her for,
 * unless she gets out of its look first.
 *
 * No scene access: a review render or a gate can run the round over a grid
 * built from the storey's layout and ask where it ever sees.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import { PRISON_TILE, type PrisonGrid } from '../../map/goblinPrisonPlan';
import type { TowerTile } from '../../map/town/interiors/townCenterTower';
import {
  blocksLight,
  castCone,
  lightSeesBody,
  stepSuspicion,
  SUSPICION_CAPTURE,
  type ConeShape,
  type PrisonPoint,
  wrapAngle,
} from '../stealthKeySnatch/detection';
import type { OnSightNoticeTuning, PrisonConeTuning } from '../stealthKeySnatch/prisonTuning';
import { tileOriginPx } from './storeyWorks';

/** Frames of each beat of the round, in order. Its look holds still down the room for the whole first beat. */
export const KEEPER_LOOK_FRAMES = 200;
const KEEPER_TURN_FRAMES = 45;
const KEEPER_AWAY_FRAMES = 260;
/** Where it floats while it watches the room, and where it gazes up at the window from. */
const KEEPER_WATCH_POST: TowerTile = { x: 9, y: 8 };
const KEEPER_WINDOW_POST: TowerTile = { x: 9, y: 4 };
/** How far it drifts side to side while it watches, in tiles. */
export const KEEPER_DRIFT_TILES = 2.5;
/**
 * Frames of one sway side to side. Out of step with its round, so it looks
 * down the room from a different place each round; a review that must see
 * every pairing of the two runs for both periods' least common multiple.
 */
export const KEEPER_DRIFT_PERIOD_FRAMES = 420;
const KEEPER_FLOAT_SPEED = 0.12;
/** The look counts as on the room while it points within this of straight down the room. */
const LOOKING_WITHIN_SHARE_OF_PI = 0.35;
const LOOKING_WITHIN = Math.PI * LOOKING_WITHIN_SHARE_OF_PI;
const FACING_ROOM = Math.PI / 2;
const FACING_WINDOW = -Math.PI / 2;
const HALF = 0.5;
const DEGREES_PER_HALF_TURN = 180;
/**
 * The fastest its look swings, as the frames a half turn takes. Quicker than
 * a turn of its round, so it never holds the round back, and quick enough
 * that a heard paw is looked at before it can be worked again.
 */
const KEEPER_SNAP_TURN_FRAMES = 15;
const KEEPER_MAX_TURN_PER_FRAME = Math.PI / KEEPER_SNAP_TURN_FRAMES;

/** Its look: a wide fan over the floor. */
const LOOK_HALF_SHARE_OF_PI = 0.42;
const LOOK_REACH_TILES = 9;
/** How far its look reaches over an open floor, in pixels from its eye. */
export const KEEPER_LOOK_REACH_PX = LOOK_REACH_TILES * TILE_SIZE;
/** The share of its look's reach, at the far end, over which its notice ramps in. */
export const KEEPER_LOOK_SOFT_EDGE = 0.25;
const KEEPER_LOOK: PrisonConeTuning = {
  rangeTiles: LOOK_REACH_TILES,
  halfAngleDeg: LOOK_HALF_SHARE_OF_PI * DEGREES_PER_HALF_TURN,
  softEdge: KEEPER_LOOK_SOFT_EDGE,
};

/** How fast it floats toward a heard paw, in pixels a frame: slower than a running cat. */
const KEEPER_HUNT_SPEED_PX = 1.4;
/**
 * How near it closes on a noise, in tiles from its eye: near enough that the
 * noise is past its look's soft edge, where it notices at the full rate.
 */
const KEEPER_HUNT_STANDOFF_TILES = LOOK_REACH_TILES * (1 - KEEPER_LOOK_SOFT_EDGE);
const KEEPER_HUNT_STANDOFF_PX = KEEPER_HUNT_STANDOFF_TILES * TILE_SIZE;
/** How long it searches on once it has lost Belle, before it keeps its round again. */
export const KEEPER_SEARCH_FRAMES = 150;

/**
 * Frames it holds still with a shriek on hearing a paw, before its look
 * swings onto the noise. It catches at a glance, so this is the whole of the
 * time a cat heard from out of its view has to dash for cover.
 */
export const KEEPER_STARTLE_FRAMES = 30;

/**
 * Where it last heard or saw Belle, how much longer it holds still startled
 * before it turns to look, and how much longer it searches there without
 * seeing her.
 */
interface Hunt {
  at: PrisonPoint;
  startleFramesLeft: number;
  searchFramesLeft: number;
}

/**
 * How it notices Belle at the edge of its look, and forgets her once she is
 * out of it. In full view it catches her at a glance.
 */
export const KEEPER_NOTICE = {
  kind: 'on_sight',
  alertFillFrames: 55,
  coneEdgeWeight: 0.35,
  drainFrames: 90,
} as const satisfies OnSightNoticeTuning;

type KeeperBeat = 'look' | 'turn_away' | 'away' | 'turn_back';

const BEAT_FRAMES: Readonly<Record<KeeperBeat, number>> = {
  look: KEEPER_LOOK_FRAMES,
  turn_away: KEEPER_TURN_FRAMES,
  away: KEEPER_AWAY_FRAMES,
  turn_back: KEEPER_TURN_FRAMES,
};
const NEXT_BEAT: Readonly<Record<KeeperBeat, KeeperBeat>> = {
  look: 'turn_away',
  turn_away: 'away',
  away: 'turn_back',
  turn_back: 'look',
};

/** Frames of one whole round, look to look, for a review that must see every beat. */
export const KEEPER_ROUND_FRAMES = Object.values(BEAT_FRAMES).reduce((sum, beat) => sum + beat, 0);
/** The storey as the keeper's look meets it: every tile that stops a line of sight is a wall to it. */
export function keeperSightGrid(map: GameMap, width: number, height: number): PrisonGrid {
  const tiles = new Uint8Array(width * height).fill(PRISON_TILE.floor);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (map.blocksSight(x, y)) tiles[y * width + x] = PRISON_TILE.wall;
    }
  }
  return { width, height, tiles };
}

/**
 * Whether an eye at `eye` sits inside something tall in the room: a look cast
 * from there is stopped before it starts, so the keeper would be blind.
 */
export function keeperEyeBlocked(grid: PrisonGrid, eye: PrisonPoint): boolean {
  return blocksLight(grid, Math.floor(eye.x / TILE_SIZE), Math.floor(eye.y / TILE_SIZE), 'cone');
}

export class CatteryKeeper {
  private beat: KeeperBeat = 'look';
  private beatFrame = 0;
  private clock = 0;
  private hunt: Hunt | null = null;
  private lookAngle = FACING_ROOM;
  /** World pixels of the tile its body is drawn over. */
  x: number;
  y: number;
  /** How far it has noticed Belle, 0 to {@link SUSPICION_CAPTURE}. */
  suspicion = 0;
  /** Its look as last cast over the room. */
  cone: ConeShape;

  constructor(private grid: PrisonGrid) {
    const post = tileOriginPx(KEEPER_WATCH_POST);
    this.x = post.x;
    this.y = post.y;
    this.cone = this.cast();
  }

  /**
   * A keeper standing exactly where this one stands in its round and its
   * sway, which keeps both from here: a review can hear a paw at every moment
   * without replaying the round up to each.
   */
  clone(): CatteryKeeper {
    const copy = new CatteryKeeper(this.grid);
    copy.beat = this.beat;
    copy.beatFrame = this.beatFrame;
    copy.clock = this.clock;
    copy.hunt = this.hunt === null ? null : { ...this.hunt };
    copy.lookAngle = this.lookAngle;
    copy.x = this.x;
    copy.y = this.y;
    copy.suspicion = this.suspicion;
    copy.cone = this.cone;
    return copy;
  }

  /** Frames it has kept its round: its float runs on this. */
  get frames(): number {
    return this.clock;
  }

  /** Where its look is cast from, in world pixels. */
  get eye(): PrisonPoint {
    return { x: this.x + TILE_SIZE * HALF, y: this.y + TILE_SIZE * HALF };
  }

  /** Whether it is hunting a paw it heard, rather than keeping its round. */
  get hunting(): boolean {
    return this.hunt !== null;
  }

  /** Whether it is looking at the room rather than up at the window: a paw at a latch now is seen. */
  get lookingAtRoom(): boolean {
    if (this.hunting) return true;
    return Math.abs(angleBetween(this.lookAngle, FACING_ROOM)) <= LOOKING_WITHIN;
  }

  /** Which way its face is drawn: toward the side its look leans to. */
  get facingX(): 1 | -1 {
    return Math.cos(this.lookAngle) >= 0 ? 1 : -1;
  }

  /** Whether it has seen enough of Belle to catch her. */
  get caught(): boolean {
    return this.suspicion >= SUSPICION_CAPTURE;
  }

  /** It hears a paw at a latch at `at` and hunts for it, whatever beat of its round it was on. */
  hear(at: PrisonPoint): void {
    const startleFramesLeft = this.hunt === null ? KEEPER_STARTLE_FRAMES : 0;
    this.hunt = { at, startleFramesLeft, searchFramesLeft: KEEPER_SEARCH_FRAMES };
  }

  /** Looks over `grid` from now on, for a room whose tall things have changed. */
  lookOver(grid: PrisonGrid): void {
    this.grid = grid;
  }

  /**
   * Breaks off any hunt and starts turning to the window, as it does once
   * Belle is shut back in her cage: she wakes to its turning back and has the
   * rest of its round away to start on the latch again, rather than a hunt
   * that hears her first jostle and every one after it.
   */
  turnAway(): void {
    this.hunt = null;
    this.beat = 'turn_away';
    this.beatFrame = 0;
  }

  /** Forgets Belle, for a cat put back where it cannot see her. */
  forget(): void {
    this.suspicion = 0;
  }

  /**
   * One frame of the round. `belle` is the centre of Belle's body while she
   * is out of her cage on this storey, and null while she is not;
   * `companions` are the body centres of whoever walks with her, whom it is
   * not there to catch but who put it on its guard.
   */
  step(belle: PrisonPoint | null, companions: readonly PrisonPoint[] = []): void {
    this.clock++;
    const hunt = this.hunt;
    if (hunt === null) {
      this.keepRound();
      this.turnToward(this.angleForBeat());
      this.floatToPost();
    } else if (hunt.startleFramesLeft > 0) {
      hunt.startleFramesLeft--;
    } else {
      const eye = this.eye;
      this.turnToward(Math.atan2(hunt.at.y - eye.y, hunt.at.x - eye.x));
      this.closeOn(hunt.at);
    }
    this.cone = this.cast();
    const seen = this.sees(belle);
    const companion = Math.max(0, ...companions.map((centre) => this.sees(centre)));
    this.suspicion = stepSuspicion(
      this.suspicion,
      'cone',
      { crawler: seen, companion },
      KEEPER_NOTICE,
    );
    if (hunt !== null) this.followHunt(hunt, seen > 0 ? belle : null);
  }

  /** How strongly its look takes in a body centred at `centre` right now, 0 when not at all. */
  sees(centre: PrisonPoint | null): number {
    if (centre === null) return 0;
    return lightSeesBody(this.grid, this.cone, centre, KEEPER_NOTICE.coneEdgeWeight);
  }

  private keepRound(): void {
    this.beatFrame++;
    if (this.beatFrame < BEAT_FRAMES[this.beat]) return;
    this.beat = NEXT_BEAT[this.beat];
    this.beatFrame = 0;
  }

  private turnToward(angle: number): void {
    const left = angleBetween(angle, this.lookAngle);
    const turn = Math.max(-KEEPER_MAX_TURN_PER_FRAME, Math.min(KEEPER_MAX_TURN_PER_FRAME, left));
    this.lookAngle = wrapAngle(this.lookAngle + turn);
  }

  /** Floats toward `at` until it is near enough to notice there at the full rate. */
  private closeOn(at: PrisonPoint): void {
    const eye = this.eye;
    const dx = at.x - eye.x;
    const dy = at.y - eye.y;
    const distance = Math.hypot(dx, dy);
    const beyondStandoff = distance - KEEPER_HUNT_STANDOFF_PX;
    if (beyondStandoff <= 0) return;
    const stride = Math.min(KEEPER_HUNT_SPEED_PX, beyondStandoff);
    this.floatBy((dx / distance) * stride, (dy / distance) * stride);
  }

  /**
   * Floats its body by (`dx`, `dy`), never bringing its eye into a tile that
   * stops its look: met with one, it slides along it on whichever axis is
   * clear, and holds where it is when neither is. An eye already in one, as
   * a heap laid down over it leaves it, may float on out.
   */
  private floatBy(dx: number, dy: number): void {
    const eye = this.eye;
    const eyeAlreadyBlocked = keeperEyeBlocked(this.grid, eye);
    const tries = [
      { dx, dy },
      { dx, dy: 0 },
      { dx: 0, dy },
    ] as const;
    const clear = tries.find(
      (move) =>
        eyeAlreadyBlocked ||
        !keeperEyeBlocked(this.grid, { x: eye.x + move.dx, y: eye.y + move.dy }),
    );
    if (clear === undefined) return;
    this.x += clear.dx;
    this.y += clear.dy;
  }

  /** Keeps after Belle while it sees her (`seenAt`), and gives the hunt up once it has searched long enough without. */
  private followHunt(hunt: Hunt, seenAt: PrisonPoint | null): void {
    if (seenAt !== null) {
      hunt.at = seenAt;
      hunt.searchFramesLeft = KEEPER_SEARCH_FRAMES;
      return;
    }
    hunt.searchFramesLeft--;
    if (hunt.searchFramesLeft <= 0) this.hunt = null;
  }

  private floatToPost(): void {
    const watching = this.beat === 'look' || this.beat === 'turn_back';
    const post = tileOriginPx(watching ? KEEPER_WATCH_POST : KEEPER_WINDOW_POST);
    const driftShare = Math.sin((this.clock / KEEPER_DRIFT_PERIOD_FRAMES) * Math.PI * 2);
    const drift = watching ? driftShare * KEEPER_DRIFT_TILES * TILE_SIZE : 0;
    this.floatBy(
      (post.x + drift - this.x) * KEEPER_FLOAT_SPEED,
      (post.y - this.y) * KEEPER_FLOAT_SPEED,
    );
  }

  private cast(): ConeShape {
    return castCone(this.grid, this.eye, this.lookAngle, KEEPER_LOOK);
  }

  private angleForBeat(): number {
    const share = this.beatFrame / BEAT_FRAMES[this.beat];
    switch (this.beat) {
      case 'look':
        return FACING_ROOM;
      case 'away':
        return FACING_WINDOW;
      case 'turn_away':
        return FACING_ROOM + (FACING_WINDOW - FACING_ROOM) * share;
      case 'turn_back':
        return FACING_WINDOW + (FACING_ROOM - FACING_WINDOW) * share;
      default: {
        const unhandled: never = this.beat;
        throw new Error(`unhandled keeper beat ${String(unhandled)}`);
      }
    }
  }
}

function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
