/**
 * Tiny cosmetic crawlies — beetles in the cellars, roaches on the service
 * level — that sit in small groups at the foot of a wall and bolt for a crack
 * when someone comes near, or burst out of something broken and run for the
 * nearest wall.
 *
 * A critter is a few pixels of dark body and twitching legs with no shadow
 * disc and no health bar, because anything that looks like a threat in this
 * game must be one: it is never a rat or a mouse, and never the size of the
 * cockroach mob.
 *
 * Critters live on open floor only: a burst critter whose spawn point is not
 * floor is never made, and a runner whose next step is not floor has found
 * its crack and is gone.
 *
 * Moments, not state: nothing here is checkpointed.
 */

import { TILE_SIZE } from '../../core/constants';
import { UINT32_SPAN } from '../../core/WorldRandom';

export type CritterLook = 'beetle' | 'roach';

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** A group that sits still at a wall's foot until it is disturbed. */
export interface ResidentGroup {
  readonly tileX: number;
  readonly tileY: number;
  readonly count: number;
  /** The crack it runs for, in world pixels. */
  readonly hide: WorldPoint;
  /** Picks where in the tile each one sits. */
  readonly seed: number;
}

/** Whether a tile is open floor a critter can run over. */
export type CritterFloor = (tileX: number, tileY: number) => boolean;

/** Returned by {@link ScatterSwarm.addResident} when nothing could be seated. */
export const NO_RESIDENT = -1;

interface Look {
  /** Body length and width, in pixels. */
  readonly length: number;
  readonly width: number;
  /**
   * A one-pixel head ahead of the body, or 0 for none. A beetle without one is
   * a round dot, and three dots read as a face.
   */
  readonly headPx: number;
  readonly body: string;
  /** The sheen along the back, towards the light. */
  readonly back: string;
  readonly legs: string;
  /** Top running speed, in pixels a frame. */
  readonly speed: number;
}

const LOOKS: Readonly<Record<CritterLook, Look>> = {
  beetle: {
    length: 4,
    width: 2,
    headPx: 1,
    body: '#14110d',
    back: '#3b3a2c',
    legs: '#0c0a08',
    speed: 2.2,
  },
  roach: {
    length: 4,
    width: 2,
    headPx: 0,
    body: '#2a160c',
    back: '#5a3418',
    legs: '#140a05',
    speed: 2.8,
  },
};

interface Critter {
  x: number;
  y: number;
  heading: number;
  speed: number;
  readonly look: Look;
  /** Phase of the leg twitch. */
  stride: number;
  /** Where it is running to; null while it sits. */
  hide: WorldPoint | null;
  /** Frames left before it is gone however its run went. */
  life: number;
}

interface Resident {
  readonly id: number;
  readonly critters: Critter[];
  readonly hide: WorldPoint;
  readonly centre: WorldPoint;
}

const HALF = 0.5;
const TWO_PI = Math.PI * 2;
/** A sitting group bolts when anyone comes within this many tiles. */
const DISTURB_RADIUS_TILES = 3;
const DISTURB_RADIUS_PX = TILE_SIZE * DISTURB_RADIUS_TILES;
/** A runner is in its crack once it is this close to it. */
const ARRIVE_PX = 3;
/** How much a running critter's heading wanders off its line each frame, in radians. */
const WANDER_RADIANS = 0.35;
/** Each critter runs at a share of top speed, so a group spreads out rather than moving as a ring. */
const SPEED_SHARE_MIN = 0.6;
/** No run lasts longer than this, crack or no crack. */
export const RUN_LIFE_FRAMES = 90;
/** Critters vanish over their last frames rather than blinking out. */
const FADE_FRAMES = 8;
const STRIDE_RATE = 1.3;
/** How far a leg sticks out past the body, in pixels. */
const LEG_REACH_PX = 1;
/** A leg is one pixel wide. */
const LEG_WIDTH_PX = 1;
/** The sheen stops this far short of each end of the body, in pixels. */
const SHEEN_INSET_PX = 1;
/** The sheen is a one-pixel line along the back. */
const SHEEN_HEIGHT_PX = 1;
/** A burst leaves from a little round its point, not all from one pixel. */
const BURST_SCATTER_PX = 4;
/**
 * A sitting group straggles in a line along the wall's foot, each member this
 * far along from the last, give or take {@link SEAT_ALONG_JITTER_PX}. A loose
 * scatter round a point puts three dark bodies in a triangle, which reads as
 * a face.
 */
const SEAT_SPACING_PX = 5;
const SEAT_ALONG_JITTER_PX = 1.5;
/** How far out from the crack the line runs, in pixels. */
const SEAT_OFF_WALL_PX = 4;
/** Members step in and out of the line by up to this, so it is not ruled straight. */
const SEAT_OFF_WALL_JITTER_PX = 1.5;
/** A sitting critter faces along the wall, off true by up to this, in radians. */
const SEAT_HEADING_JITTER_RADIANS = 0.5;
/** A sitting critter's idle turn swings it by up to this either way, in radians. */
const IDLE_TURN_RADIANS = 0.6;
/** A sitting critter shifts a pixel now and then: one frame in this many. */
const IDLE_SHIFT_ONE_IN = 90;
/**
 * The most critters one swarm holds at once. Each swarm has its own budget,
 * so an owner keeping two (sitting groups and bursts) can show twice this.
 */
export const MAX_CRITTERS = 96;
/** Critters are drawn only this far past the view's edge. */
const CULL_MARGIN_PX = 8;

/** Hash mixers for a seeded seat; any odd constants with good bit spread. */
const MIX_A = 0x9e3779b1;
const MIX_B = 0x85ebca6b;
const MIX_SHIFT_A = 15;
const MIX_SHIFT_B = 13;
/** Each seated critter draws its own values from its own run of salts, so none share. */
const SALTS_PER_CRITTER = 5;
const SALT_ALONG = 0;
const SALT_OFF_WALL = 1;
const SALT_HEADING = 2;
const SALT_SPEED = 3;
const SALT_FACING = 4;

/** A stable value in [0, 1) for one seat of a seeded group. */
function seededUnit(seed: number, salt: number): number {
  let h = Math.imul(seed ^ salt, MIX_A);
  h ^= h >>> MIX_SHIFT_A;
  h = Math.imul(h, MIX_B);
  h ^= h >>> MIX_SHIFT_B;
  return (h >>> 0) / UINT32_SPAN;
}

export class ScatterSwarm {
  private readonly runners: Critter[] = [];
  private readonly residents: Resident[] = [];
  /** Reused by {@link update} for the groups that bolted this frame. */
  private readonly bolted: WorldPoint[] = [];
  private nextResidentId = 0;

  constructor(
    private readonly isFloor: CritterFloor,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * Seats a group at a wall's foot, still until someone comes near. Returns a
   * handle for {@link releaseResident} and {@link isSitting}, or
   * {@link NO_RESIDENT} when the tile is not floor or the budget is spent.
   */
  addResident(lookId: CritterLook, group: ResidentGroup): number {
    if (!this.isFloor(group.tileX, group.tileY)) return NO_RESIDENT;
    const look = LOOKS[lookId];
    const centre = { x: (group.tileX + HALF) * TILE_SIZE, y: (group.tileY + HALF) * TILE_SIZE };
    const toWall = Math.atan2(group.hide.y - centre.y, group.hide.x - centre.x);
    const alongWall = toWall + Math.PI * HALF;
    const alongX = Math.cos(alongWall);
    const alongY = Math.sin(alongWall);
    const lineX = group.hide.x - Math.cos(toWall) * SEAT_OFF_WALL_PX;
    const lineY = group.hide.y - Math.sin(toWall) * SEAT_OFF_WALL_PX;
    const lineMiddle = (group.count - 1) * HALF;
    const critters: Critter[] = [];
    for (let i = 0; i < group.count && this.critterCount + critters.length < MAX_CRITTERS; i++) {
      const salt = i * SALTS_PER_CRITTER;
      const speedShare = seededUnit(group.seed, salt + SALT_SPEED);
      const along =
        (i - lineMiddle) * SEAT_SPACING_PX +
        (seededUnit(group.seed, salt + SALT_ALONG) - HALF) * 2 * SEAT_ALONG_JITTER_PX;
      const offWall =
        (seededUnit(group.seed, salt + SALT_OFF_WALL) - HALF) * 2 * SEAT_OFF_WALL_JITTER_PX;
      const facesBack = seededUnit(group.seed, salt + SALT_FACING) < HALF;
      const headingJitter =
        (seededUnit(group.seed, salt + SALT_HEADING) - HALF) * 2 * SEAT_HEADING_JITTER_RADIANS;
      critters.push({
        x: lineX + alongX * along - Math.cos(toWall) * offWall,
        y: lineY + alongY * along - Math.sin(toWall) * offWall,
        heading: alongWall + (facesBack ? Math.PI : 0) + headingJitter,
        speed: look.speed * (SPEED_SHARE_MIN + speedShare * (1 - SPEED_SHARE_MIN)),
        look,
        stride: 0,
        hide: null,
        life: RUN_LIFE_FRAMES,
      });
    }
    if (critters.length === 0) return NO_RESIDENT;
    const id = this.nextResidentId++;
    this.residents.push({ id, critters, hide: group.hide, centre });
    return id;
  }

  /** Takes a sitting group away unseen. Its critters already running keep running. */
  releaseResident(id: number): void {
    for (let i = this.residents.length - 1; i >= 0; i--) {
      if (this.residents[i].id === id) this.residents.splice(i, 1);
    }
  }

  /** Whether a seated group is still sitting: not bolted, not released. */
  isSitting(id: number): boolean {
    for (const resident of this.residents) if (resident.id === id) return true;
    return false;
  }

  /**
   * Sends up to `count` critters bursting out of `from`, running for `hide`.
   * Returns how many came out: none where `from` is not floor or the budget
   * is spent.
   */
  burst(lookId: CritterLook, from: WorldPoint, count: number, hide: WorldPoint): number {
    const look = LOOKS[lookId];
    let spawned = 0;
    for (let i = 0; i < count && this.critterCount < MAX_CRITTERS; i++) {
      const x = from.x + (this.random() - HALF) * 2 * BURST_SCATTER_PX;
      const y = from.y + (this.random() - HALF) * 2 * BURST_SCATTER_PX;
      if (!this.isFloor(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) continue;
      this.runners.push({
        x,
        y,
        heading: Math.atan2(hide.y - y, hide.x - x) + (this.random() - HALF) * Math.PI * HALF,
        speed: look.speed * (SPEED_SHARE_MIN + this.random() * (1 - SPEED_SHARE_MIN)),
        look,
        stride: this.random() * TWO_PI,
        hide,
        life: RUN_LIFE_FRAMES,
      });
      spawned++;
    }
    return spawned;
  }

  get critterCount(): number {
    let count = this.runners.length;
    for (const resident of this.residents) count += resident.critters.length;
    return count;
  }

  /** Where every critter is, sitting or running; for the gates. */
  critterPositions(): WorldPoint[] {
    const positions: WorldPoint[] = this.runners.map((critter) => ({ x: critter.x, y: critter.y }));
    for (const resident of this.residents) {
      for (const critter of resident.critters) positions.push({ x: critter.x, y: critter.y });
    }
    return positions;
  }

  clear(): void {
    this.runners.length = 0;
    this.residents.length = 0;
  }

  /**
   * Advances every critter a frame. A sitting group with any of `threats`
   * inside {@link DISTURB_RADIUS_PX} bolts for its crack. Returns where each
   * group that bolted this frame was sitting, for its scuttle; the array is
   * reused, so read it before the next call.
   */
  update(threats: ReadonlyArray<WorldPoint>): ReadonlyArray<WorldPoint> {
    const bolted = this.bolted;
    bolted.length = 0;
    for (let i = this.residents.length - 1; i >= 0; i--) {
      const resident = this.residents[i];
      if (!anyWithin(threats, resident.centre, DISTURB_RADIUS_PX)) {
        for (const critter of resident.critters) this.shiftIdle(critter);
        continue;
      }
      for (const critter of resident.critters) {
        critter.hide = resident.hide;
        critter.heading = Math.atan2(resident.hide.y - critter.y, resident.hide.x - critter.x);
        this.runners.push(critter);
      }
      bolted.push(resident.centre);
      this.residents.splice(i, 1);
    }
    for (let i = this.runners.length - 1; i >= 0; i--) {
      if (this.advanceRunner(this.runners[i])) continue;
      this.runners[i] = this.runners[this.runners.length - 1];
      this.runners.pop();
    }
    return bolted;
  }

  /** A sitting critter turns or shifts a pixel now and then, so the group reads as alive. */
  private shiftIdle(critter: Critter): void {
    if (Math.floor(this.random() * IDLE_SHIFT_ONE_IN) !== 0) return;
    critter.heading += (this.random() - HALF) * 2 * IDLE_TURN_RADIANS;
    critter.stride += Math.PI;
  }

  /** One frame of a run. Returns false once it is gone into its crack or out of time. */
  private advanceRunner(critter: Critter): boolean {
    const hide = critter.hide;
    if (hide === null) return false;
    const toHide = Math.atan2(hide.y - critter.y, hide.x - critter.x);
    critter.heading = toHide + (this.random() - HALF) * 2 * WANDER_RADIANS;
    const nextX = critter.x + Math.cos(critter.heading) * critter.speed;
    const nextY = critter.y + Math.sin(critter.heading) * critter.speed;
    critter.stride += STRIDE_RATE;
    critter.life--;
    const arrived =
      Math.hypot(hide.x - nextX, hide.y - nextY) <= Math.max(ARRIVE_PX, critter.speed);
    // Running into a wall or a prop is finding the crack at its foot.
    const blocked = !this.isFloor(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE));
    if (arrived || blocked || critter.life <= 0) return false;
    critter.x = nextX;
    critter.y = nextY;
    return true;
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    for (const resident of this.residents) {
      for (const critter of resident.critters) drawIfInView(ctx, critter, camX, camY, viewW, viewH);
    }
    for (const critter of this.runners) drawIfInView(ctx, critter, camX, camY, viewW, viewH);
  }
}

function anyWithin(threats: ReadonlyArray<WorldPoint>, at: WorldPoint, radius: number): boolean {
  for (const threat of threats) {
    if (Math.hypot(threat.x - at.x, threat.y - at.y) < radius) return true;
  }
  return false;
}

function drawIfInView(
  ctx: CanvasRenderingContext2D,
  critter: Critter,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
): void {
  const sx = critter.x - camX;
  const sy = critter.y - camY;
  const outside =
    sx < -CULL_MARGIN_PX ||
    sy < -CULL_MARGIN_PX ||
    sx > viewW + CULL_MARGIN_PX ||
    sy > viewH + CULL_MARGIN_PX;
  if (!outside) drawCritter(ctx, critter, sx, sy);
}

function drawCritter(
  ctx: CanvasRenderingContext2D,
  critter: Critter,
  sx: number,
  sy: number,
): void {
  const { look } = critter;
  ctx.save();
  ctx.globalAlpha = critter.hide === null ? 1 : Math.min(1, critter.life / FADE_FRAMES);
  ctx.translate(Math.round(sx), Math.round(sy));
  ctx.rotate(critter.heading);
  const halfLength = look.length * HALF;
  const halfWidth = look.width * HALF;
  // One pixel of leg out on each side, the pair stepping out of phase: at
  // this size that is what reads as scurrying.
  const stepPx = Math.sin(critter.stride) > 0 ? HALF : -HALF;
  ctx.fillStyle = look.legs;
  ctx.fillRect(stepPx - HALF, -halfWidth - LEG_REACH_PX, LEG_WIDTH_PX, LEG_REACH_PX);
  ctx.fillRect(-stepPx - HALF, halfWidth, LEG_WIDTH_PX, LEG_REACH_PX);
  ctx.fillStyle = look.body;
  ctx.fillRect(-halfLength, -halfWidth, look.length, look.width);
  if (look.headPx > 0) ctx.fillRect(halfLength, -look.headPx * HALF, look.headPx, look.headPx);
  ctx.fillStyle = look.back;
  ctx.fillRect(
    -halfLength + SHEEN_INSET_PX,
    -halfWidth,
    look.length - 2 * SHEEN_INSET_PX,
    SHEEN_HEIGHT_PX,
  );
  ctx.restore();
}
