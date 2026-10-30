/**
 * The Cloak & Dagger's cosmetic crowd: the patrons standing about the floor
 * between the dance floor, the stages and the tables.
 *
 * It owns three things:
 *
 * - **Range.** Patrons keep to the club's open floor, gated by
 *   {@link isClubPatronTile} and real map walkability so they never clip a
 *   wall or a counter. A walk that a stage or a corner blocks goes by a
 *   waypoint close to the straight line, passed without stopping.
 * - **Weight.** Every figure on the floor — patrons, staff, dancers, Brandon,
 *   the crawlers themselves — is a circular body, and patrons are pushed out
 *   of any overlap. They shoulder past each other, they refuse to stand inside
 *   the staff, and the player shoves them aside instead of walking through
 *   them. Only patrons ever move under collision: staff stand on their marks
 *   and the player is driven by input, so both act as immovable bodies.
 * - **Company.** Nobody strolls aimlessly. A patron always has somewhere to
 *   be: a {@link ClubGathering} — a knot of two to five friends, or the ring
 *   round a high-top table — standing facing its middle and talking in turn,
 *   or the floor in front of a stage, facing the pole. After a while one
 *   leaves and walks over to another group or a stage, which is all the
 *   walking the crowd does.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import {
  clubFigureWalkCyclePx,
  clubFigureWalkFrames,
  drawClubCastFigure,
  type ClubFigureRef,
} from '../sprites/clubCastFigure';
import { gaitCyclesForDistance } from '../sprites/gaitCadence';
import { CLUB_PATRON_REFS } from '../sprites/clubCastRoster';
import { stepWander, type WanderParams, type WanderStep } from '../creatures/townWander';
import { SOUTHWARD_PROBE_DROP } from '../map/collisionAnchors';
import {
  CLUB_INTERIOR_W,
  CLUB_INTERIOR_H,
  CLUB_GATHERINGS,
  CLUB_PATRON_COUNT,
  CLUB_PERFORMER_POSTS,
  inClubRect,
  isClubPatronTile,
  type ClubGathering,
  type ClubTileRect,
} from '../core/club/clubLayout';
import type { TilePoint } from '../map/town/townPlan';

const PATRON_SPEED_MIN = 0.32;
const PATRON_SPEED_MAX = 0.85;
const PATRON_ARRIVE_DIST = 5;
const PATRON_PAUSE_MIN = 30;
const PATRON_PAUSE_MAX = 240;
/** Appearance seeds are handed out on this stride; the sprite hashes them apart. */
const PATRON_SEED_STRIDE = 7;
const PATRON_SEED_OFFSET = 3;
/**
 * Net travel in a tick, in pixels, below which a patron counts as standing.
 * Under the slowest walking speed, so every real step registers, but above the
 * residue a walker pinned against an immovable body nets out to.
 */
const PATRON_VISIBLE_STEP_PX = 0.15;

/** Height spread across the crowd, as a multiple of a tile — enough to read, short of cartoonish. */
const PATRON_HEIGHT_MIN = 0.88;
const PATRON_HEIGHT_MAX = 1.16;

/** How far from a figure's centre another body is refused, as a fraction of a tile. */
export const CROWD_BODY_RADIUS_TILES = 0.34;
/** The crawlers push harder than the crowd does — they get a wider personal space. */
const PLAYER_RADIUS_TILES = 0.42;
/** A body's centre sits below its sprite origin, at roughly hip height. */
const BODY_CENTER_Y_FRACTION = 0.62;

/** Separation shorter than this is treated as two bodies occupying the same point. */
const COINCIDENT_EPSILON = 0.0001;
const DEGREES_PER_TURN = 360;
const HALF_TURN_DEGREES = DEGREES_PER_TURN / 2;
const RADIANS_PER_DEGREE = Math.PI / HALF_TURN_DEGREES;
/** Horizontal centre of a tile, as a fraction of its width. */
const TILE_CENTER_X_FRACTION = 0.5;

/**
 * A stage the crowd drifts over to watch: `weight` against a gathering's
 * {@link GATHERING_WEIGHT}, `area` the floor watchers stand on, `focus` the
 * tile they turn to face.
 */
export interface CrowdAttraction {
  readonly area: ClubTileRect;
  readonly weight: number;
  readonly focus: TilePoint;
}

/**
 * What a patron is doing: standing with a gathering (by index into the
 * crowd's gatherings), watching a stage (by index into its attractions), or —
 * only when nowhere is in reach — waiting where they stand.
 */
export type PatronIntent =
  | { readonly kind: 'gather'; readonly gathering: number }
  | { readonly kind: 'watch'; readonly attraction: number }
  | { readonly kind: 'wait' };

/** One patron as a gate reads them: what they are about, and whether they have got there. */
export interface PatronReading {
  readonly intent: PatronIntent;
  /** Standing still at their spot rather than walking to it. */
  readonly settled: boolean;
  /** Body centre in world pixels. */
  readonly cx: number;
  readonly cy: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly talking: boolean;
  /** Standing still on a waypoint they passed, which a patron never should. */
  readonly pausedOnWaypoint: boolean;
  /** How far a pending waypoint lies off the straight line to the spot, in tiles. */
  readonly waypointOffLineTiles: number | null;
}

/** A gathering's draw against one stage of weight one, before the pull of company. */
const GATHERING_WEIGHT = 1;
/**
 * How much more a group with people already in it draws than an empty spot:
 * people join company before they start a new circle on their own.
 */
const COMPANY_PULL = 3;
/** Seconds a patron stays with a group, and in front of a stage, before moving on. */
const GATHER_STAY_MIN_SECONDS = 25;
const GATHER_STAY_MAX_SECONDS = 70;
const WATCH_STAY_MIN_SECONDS = 10;
const WATCH_STAY_MAX_SECONDS = 30;
/** How long a patron with nowhere in reach waits before looking again. */
const WAIT_SECONDS = 3;
/** Seconds each member of a group holds the floor before the next takes it up. */
const SPEAKING_TURN_SECONDS = 3;
/** A waypoint round an obstacle lies at most this far off the straight line, in tiles. */
export const WAYPOINT_MAX_OFF_LINE_TILES = 3;

/**
 * Points round a gathering's ring a member may take; the open ones are shared
 * out evenly. Six, starting due east, so no two points stand in one column:
 * figures are taller than a tile, and one standing straight behind another
 * would be painted inside them.
 */
const RING_POINTS = 6;

/** A circular obstacle on the club floor. Patrons yield to these; these never yield. */
export interface CrowdBody {
  /** Centre in world pixels. */
  cx: number;
  cy: number;
  radius: number;
}

interface Patron {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  seed: number;
  facingX: number;
  /** +1 faces the camera (down), −1 away (up); holds its last heading while paused. */
  facingY: number;
  pause: number;
  /** Sprite height as a multiple of the tile, fixed per patron. */
  heightScale: number;
  /** Which cast figure this patron draws as, fixed for its lifetime. */
  ref: ClubFigureRef;
  /** Walk-cycle position, 0–1, advanced by the ground the patron actually covers. */
  walkCycle: number;
  /** Ticks the legs keep walking since the patron last moved; zero is standing. */
  motionTicks: number;
  /** Distance to the target at the end of the previous tick, for stall detection. */
  lastTargetDist: number;
  /** Consecutive walking ticks without closing on the target. */
  stalledTicks: number;
  /** Where the patron stood when this tick began, so facing and gait follow net travel. */
  tickStartX: number;
  tickStartY: number;
  intent: PatronIntent;
  /** Crowd tick the current intent runs out on. */
  intentEndsTick: number;
  /** Crowd tick the patron took up the intent, which orders a group's members round its ring. */
  intentStartTick: number;
  /**
   * Where the intent stands them: a watcher's spot in front of the stage,
   * chosen once per visit, or their current place round a group's ring.
   */
  spotX: number;
  spotY: number;
  /** A point on the way there, when the straight walk to the spot is blocked. */
  via: { x: number; y: number } | null;
  /** Where the walk to `via` began, so a gate can measure how far off the line it lies. */
  viaFromX: number;
  viaFromY: number;
  /** Where that walk was headed when the waypoint was chosen. */
  viaToX: number;
  viaToY: number;
  /** The waypoint most recently passed this intent. */
  lastVia: { x: number; y: number } | null;
  /**
   * Whether the patron's current pause began on the waypoint they had just
   * passed, short of their spot, so a gate can see nobody stops at one.
   */
  stoppedOnWaypoint: boolean;
}

/**
 * Ticks the legs keep walking after a patron last moved, so a tick lost to a
 * blocked step or a shove does not snap the row to idle and back.
 */
const PATRON_MOTION_HOLD_TICKS = 4;
/**
 * Ticks a walking patron may go without closing on its target before it gives
 * up and picks another. Collision pushes a patron back as fast as it walks when
 * its target sits behind a body that never moves — a crawler parked at a table,
 * or a knot of other patrons — and without a give-up the whole crowd ends up
 * leaning on whoever stands still longest.
 */
const PATRON_STALL_TICKS = 90;
/** Closing on the target by less than this many pixels in a tick counts as no progress. */
const PATRON_PROGRESS_EPSILON = 0.05;
/**
 * Random floor tiles tried for one with a clear straight walk before a patron
 * settles for staying put. The open floor wraps around the dance floor, so from
 * a corridor most of the club lies out of a straight line.
 */
const PATRON_TARGET_TRIES = 32;
/** Spacing of the points sampled along a candidate walk, as a fraction of a tile. */
const PATRON_WALK_PROBE_STEP_TILES = 0.125;
const TWO_PI = Math.PI * 2;

export class ClubCrowdSystem {
  private patrons: Patron[] | null = null;
  private patronTiles: ReadonlyArray<{ x: number; y: number }> | null = null;
  /** Each attraction's legal floor, in step with `attractions`, collected with `patronTiles`. */
  private attractionTiles: ReadonlyArray<ReadonlyArray<TilePoint>> | null = null;
  /** One entry per patron, in step with `patrons`; the update loop refreshes each `y`. */
  private readonly figures: InteriorFigure[] = [];

  /** Reused output for `stepWander`, so the patron loop allocates nothing. */
  private readonly wanderStep: WanderStep = { dx: 0, dy: 0, moving: false, distance: 0 };
  /** The patron `stepWander` is advancing, so `pickTarget` knows where the walk starts. */
  private wanderingPatron: Patron | null = null;
  private readonly wanderParams: WanderParams = {
    pickTarget: () => this.nextTarget(this.wanderingPatron),
    pausesOnArrival: () => !this.walksOn,
    random: () => this.random(),
    arriveDist: PATRON_ARRIVE_DIST,
    pauseMin: PATRON_PAUSE_MIN,
    pauseMax: PATRON_PAUSE_MAX,
    isWalkable: (x, y) => this.isPatronSpot(x, y),
  };

  private tick = 0;
  /**
   * Set by `nextTarget` when the patron walks straight on: the arrival it
   * answered was only a waypoint, or a blocked step it answered found a way round.
   */
  private walksOn = false;
  /** Reused by `focusOf`, so turning the crowd to face its spots allocates nothing. */
  private readonly focusPoint = { x: 0, y: 0 };
  /** Each gathering's members this tick, in the order they joined; refilled every tick. */
  private readonly members: Patron[][];

  constructor(
    private readonly map: GameMap,
    private readonly attractions: ReadonlyArray<CrowdAttraction> = [],
    private readonly gatherings: ReadonlyArray<ClubGathering> = [],
    private readonly random: () => number = Math.random,
  ) {
    this.members = gatherings.map(() => []);
  }

  /**
   * Advance the crowd. `staticBodies` are everything a patron must not stand
   * inside this frame — the station staff, the dancers, and the crawlers.
   */
  update(staticBodies: ReadonlyArray<CrowdBody>): void {
    this.ensurePatrons();
    const patrons = this.patrons;
    if (patrons === null) return;

    this.tick++;
    for (const p of patrons) {
      if (this.tick >= p.intentEndsTick) this.takeUpIntent(p);
    }
    this.placeGatherings(patrons);

    for (const p of patrons) {
      p.tickStartX = p.x;
      p.tickStartY = p.y;
      this.wanderingPatron = p;
      stepWander(p, this.wanderParams, this.wanderStep);
    }
    this.wanderingPatron = null;

    this.resolveCollisions(patrons, staticBodies);
    for (const p of patrons) {
      this.animateNetStep(p);
      this.abandonStalledTarget(p);
      this.faceWhatTheyAreThereFor(p);
    }

    for (let i = 0; i < patrons.length; i++) {
      this.figures[i].y = patrons[i].y;
    }
  }

  /**
   * Faces and paces a patron by where it actually went this tick, after the
   * crowd's shoving, not by where it meant to go. A crawler walking into an
   * oncoming patron pushes it back faster than it walks, and a patron animated
   * from its intended step would face and stride forward while sliding backwards.
   */
  private animateNetStep(p: Patron): void {
    const stepX = p.x - p.tickStartX;
    const stepY = p.y - p.tickStartY;
    const covered = Math.hypot(stepX, stepY);
    if (covered < PATRON_VISIBLE_STEP_PX) {
      if (p.motionTicks > 0) p.motionTicks--;
      return;
    }
    if (Math.abs(stepX) >= Math.abs(stepY)) {
      p.facingX = stepX < 0 ? -1 : 1;
      p.facingY = 0;
    } else {
      p.facingX = 0;
      p.facingY = stepY < 0 ? -1 : 1;
    }
    // Paced by ground covered at the size the patron is drawn, so the planted
    // foot holds still whatever speed or height the patron has.
    const cyclePx = clubFigureWalkCyclePx(p.ref, TILE_SIZE * p.heightScale);
    const turn = gaitCyclesForDistance(covered, cyclePx, clubFigureWalkFrames(p.ref));
    p.walkCycle = (p.walkCycle + turn) % 1;
    p.motionTicks = PATRON_MOTION_HOLD_TICKS;
  }

  /**
   * Shares each gathering's ring out among its members, in the order they
   * joined, and points each member at their place. Re-done every tick, so a
   * group closes up when someone leaves and opens out when someone joins.
   */
  private placeGatherings(patrons: ReadonlyArray<Patron>): void {
    for (const group of this.members) group.length = 0;
    for (const p of patrons) {
      if (p.intent.kind === 'gather') this.members[p.intent.gathering]?.push(p);
    }
    this.members.forEach((group, index) => {
      if (group.length === 0) return;
      group.sort((a, b) => a.intentStartTick - b.intentStartTick);
      const ring = this.openRingPoints(index);
      if (ring.length === 0) return;
      group.forEach((p, slot) => {
        const point = ring[Math.floor((slot * ring.length) / group.length)];
        p.spotX = point.x;
        p.spotY = point.y;
        if (p.via !== null) return;
        p.targetX = point.x;
        p.targetY = point.y;
      });
    });
  }

  /** The points round a gathering's ring a patron may stand on, as sprite origins. */
  openRingPoints(index: number): ReadonlyArray<{ x: number; y: number }> {
    const cached = this.ringCache.get(index);
    if (cached !== undefined) return cached;
    const gathering = this.gatherings[index];
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < RING_POINTS; i++) {
      const angle = (i / RING_POINTS) * TWO_PI;
      const cx = (gathering.centre.x + Math.cos(angle) * gathering.radiusTiles) * TILE_SIZE;
      const cy = (gathering.centre.y + Math.sin(angle) * gathering.radiusTiles) * TILE_SIZE;
      const origin = {
        x: cx - TILE_SIZE * TILE_CENTER_X_FRACTION,
        y: cy - TILE_SIZE * BODY_CENTER_Y_FRACTION,
      };
      if (this.isPatronSpot(origin.x, origin.y)) points.push(origin);
    }
    this.ringCache.set(index, points);
    return points;
  }

  private readonly ringCache = new Map<number, ReadonlyArray<{ x: number; y: number }>>();

  /**
   * The wander's next destination for a patron who has just arrived: past a
   * waypoint they reached, on to their spot without stopping.
   */
  private nextTarget(p: Patron | null): { x: number; y: number } {
    this.walksOn = false;
    if (p === null) return this.randomPatronPoint();
    if (p.via !== null && Math.hypot(p.via.x - p.x, p.via.y - p.y) < PATRON_ARRIVE_DIST) {
      p.lastVia = p.via;
      p.via = null;
      this.walksOn = true;
    }
    const target = this.currentTarget(p);
    const arrived = Math.hypot(target.x - p.x, target.y - p.y) < PATRON_ARRIVE_DIST;
    const next = arrived || this.hasClearWalk(p, target) ? target : this.routeRoundBlockedWalk(p);
    const onLastVia =
      p.lastVia !== null && Math.hypot(p.lastVia.x - p.x, p.lastVia.y - p.y) < PATRON_ARRIVE_DIST;
    p.stoppedOnWaypoint = !this.walksOn && !arrived && onLastVia;
    return next;
  }

  /**
   * Plans the walk to the patron's spot again from where they actually stand.
   * A waypoint is only reached to within the arrival distance, a shove moves a
   * patron off the line they planned, and a group's ring re-deals its places
   * as members come and go, so a walk planned earlier can clip a wall. Without
   * a new plan the blocked step stops the patron where they are and every
   * retry hits the same wall.
   */
  private routeRoundBlockedWalk(p: Patron): { x: number; y: number } {
    p.via = null;
    const spot = this.currentTarget(p);
    if (this.hasClearWalk(p, spot)) {
      this.walksOn = true;
      return spot;
    }
    const via = this.waypointBetween(p, spot);
    if (via === undefined) return spot;
    this.headVia(p, via, spot);
    this.walksOn = true;
    return via;
  }

  /** Sends the patron to `via` on the way to `target`, remembering the line for the gate. */
  private headVia(
    p: Patron,
    via: { x: number; y: number },
    target: { x: number; y: number },
  ): void {
    p.via = via;
    p.viaFromX = p.x;
    p.viaFromY = p.y;
    p.viaToX = target.x;
    p.viaToY = target.y;
    p.targetX = via.x;
    p.targetY = via.y;
  }

  /** Where the patron's intent puts them right now: the waypoint if one is pending, else the spot. */
  private currentTarget(p: Patron): { x: number; y: number } {
    if (p.via !== null) return p.via;
    switch (p.intent.kind) {
      case 'gather':
      case 'watch':
        return { x: p.spotX, y: p.spotY };
      case 'wait':
        return { x: p.x, y: p.y };
      default: {
        const unhandled: never = p.intent;
        throw new Error(`unhandled patron intent ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Picks where the patron goes next: a gathering with room, drawn harder
   * when it already has company, or a stage, by its weight — never the one
   * they are leaving, and only somewhere they can walk to in a straight line.
   */
  private takeUpIntent(p: Patron): void {
    const leaving = p.intent;
    for (let attempt = 0; attempt < PATRON_TARGET_TRIES; attempt++) {
      const intent = this.drawIntent(leaving);
      if (intent === null) break;
      const target = this.intentTarget(p, intent);
      if (target === null) continue;
      const via = this.hasClearWalk(p, target) ? null : this.waypointBetween(p, target);
      if (via === undefined) continue;
      this.leaveGathering(p);
      this.adopt(p, intent, target);
      if (intent.kind === 'gather') this.members[intent.gathering]?.push(p);
      if (via !== null) this.headVia(p, via, target);
      return;
    }
    this.leaveGathering(p);
    p.intent = { kind: 'wait' };
    p.via = null;
    p.lastVia = null;
    p.targetX = p.x;
    p.targetY = p.y;
    p.spotX = p.x;
    p.spotY = p.y;
    p.intentStartTick = this.tick;
    p.intentEndsTick = this.tick + Math.round(WAIT_SECONDS * WORLD_TICKS_PER_SECOND);
  }

  /**
   * Drops the patron from the gathering they are in, if any. `members` is
   * only rebuilt once a tick, so every intent change keeps it current itself:
   * two patrons taking up intents in the same tick must each see the other's
   * place taken, or both can join a gathering with room for one.
   */
  private leaveGathering(p: Patron): void {
    if (p.intent.kind !== 'gather') return;
    const group = this.members[p.intent.gathering];
    const index = group.indexOf(p);
    if (index >= 0) group.splice(index, 1);
  }

  /**
   * The open-floor spot closest to the straight line from the patron to
   * `target` that they can walk straight to and walk straight on from: the
   * smallest detour round whatever blocks the line. Undefined when nothing
   * within reach of the line works; callers check the straight walk first.
   */
  private waypointBetween(
    p: Patron,
    target: { x: number; y: number },
  ): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined;
    let bestDetour = Number.POSITIVE_INFINITY;
    for (const tile of this.legalPatronTiles()) {
      const via = { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
      const offLine = distanceToSegment(via, p, target);
      if (offLine > WAYPOINT_MAX_OFF_LINE_TILES * TILE_SIZE) continue;
      const detour =
        Math.hypot(via.x - p.x, via.y - p.y) + Math.hypot(target.x - via.x, target.y - via.y);
      if (detour >= bestDetour) continue;
      if (!this.hasClearWalk(p, via) || !this.hasClearWalk(via, target)) continue;
      best = via;
      bestDetour = detour;
    }
    return best;
  }

  private adopt(p: Patron, intent: PatronIntent, target: { x: number; y: number }): void {
    p.intent = intent;
    p.intentStartTick = this.tick;
    const [minSeconds, maxSeconds] =
      intent.kind === 'watch'
        ? [WATCH_STAY_MIN_SECONDS, WATCH_STAY_MAX_SECONDS]
        : [GATHER_STAY_MIN_SECONDS, GATHER_STAY_MAX_SECONDS];
    const staySeconds = minSeconds + this.random() * (maxSeconds - minSeconds);
    p.intentEndsTick = this.tick + Math.round(staySeconds * WORLD_TICKS_PER_SECOND);
    p.targetX = target.x;
    p.targetY = target.y;
    p.spotX = target.x;
    p.spotY = target.y;
    p.via = null;
    p.lastVia = null;
    p.pause = 0;
    p.stalledTicks = 0;
    p.lastTargetDist = Number.POSITIVE_INFINITY;
  }

  /** Where an intent would first send the patron, or null when it has nowhere to stand. */
  private intentTarget(p: Patron, intent: PatronIntent): { x: number; y: number } | null {
    switch (intent.kind) {
      case 'gather': {
        const ring = this.openRingPoints(intent.gathering);
        const taken = this.members[intent.gathering]?.length ?? 0;
        return ring[Math.floor((taken * ring.length) / (taken + 1))] ?? null;
      }
      case 'watch': {
        const pool = this.attractionTiles?.[intent.attraction] ?? [];
        if (pool.length === 0) return null;
        const tile = pool[Math.floor(this.random() * pool.length)];
        return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
      }
      case 'wait':
        return { x: p.x, y: p.y };
      default: {
        const unhandled: never = intent;
        throw new Error(`unhandled patron intent ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** A weighted draw over every gathering with room and every stage, leaving out `leaving`. */
  private drawIntent(leaving: PatronIntent): PatronIntent | null {
    this.legalPatronTiles();
    const options: Array<{ intent: PatronIntent; weight: number }> = [];
    this.gatherings.forEach((gathering, index) => {
      if (leaving.kind === 'gather' && leaving.gathering === index) return;
      const company = this.members[index]?.length ?? 0;
      if (company >= gathering.capacity || this.openRingPoints(index).length === 0) return;
      const weight = company > 0 ? GATHERING_WEIGHT * COMPANY_PULL : GATHERING_WEIGHT;
      options.push({ intent: { kind: 'gather', gathering: index }, weight });
    });
    this.attractions.forEach((attraction, index) => {
      if (leaving.kind === 'watch' && leaving.attraction === index) return;
      if ((this.attractionTiles?.[index]?.length ?? 0) === 0) return;
      options.push({ intent: { kind: 'watch', attraction: index }, weight: attraction.weight });
    });
    const total = options.reduce((sum, option) => sum + option.weight, 0);
    let roll = this.random() * total;
    for (const option of options) {
      if (roll < option.weight) return option.intent;
      roll -= option.weight;
    }
    return null;
  }

  /**
   * A patron standing at their spot faces what they came for: a group's
   * middle, or a stage's pole. One member of a group talks at a time.
   */
  private faceWhatTheyAreThereFor(p: Patron): void {
    if (p.motionTicks > 0) return;
    if (!this.focusOf(p)) return;
    const dx = this.focusPoint.x - bodyCx(p);
    const dy = this.focusPoint.y - bodyCy(p);
    if (Math.abs(dx) >= Math.abs(dy)) {
      p.facingX = dx < 0 ? -1 : 1;
      p.facingY = 0;
    } else {
      p.facingX = 0;
      p.facingY = dy < 0 ? -1 : 1;
    }
  }

  /**
   * Writes the world point a settled patron turns toward into `focusPoint`;
   * false when they are only waiting and face wherever they were.
   */
  private focusOf(p: Patron): boolean {
    switch (p.intent.kind) {
      case 'gather': {
        const gathering = this.gatherings[p.intent.gathering];
        this.focusPoint.x = gathering.centre.x * TILE_SIZE;
        this.focusPoint.y = gathering.centre.y * TILE_SIZE;
        return true;
      }
      case 'watch': {
        const focus = this.attractions[p.intent.attraction].focus;
        this.focusPoint.x = (focus.x + TILE_CENTER_X_FRACTION) * TILE_SIZE;
        this.focusPoint.y = (focus.y + BODY_CENTER_Y_FRACTION) * TILE_SIZE;
        return true;
      }
      case 'wait':
        return false;
      default: {
        const unhandled: never = p.intent;
        throw new Error(`unhandled patron intent ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Whether this settled member of a group holds the floor this tick. */
  private isTalking(p: Patron): boolean {
    if (p.intent.kind !== 'gather' || p.motionTicks > 0) return false;
    const group = this.members[p.intent.gathering] ?? [];
    if (group.length < 2) return false;
    const turn = Math.floor(this.tick / (SPEAKING_TURN_SECONDS * WORLD_TICKS_PER_SECOND));
    return group[(turn + p.intent.gathering) % group.length] === p;
  }

  /** Every patron as it stands this tick, for gates to measure the crowd's behaviour. */
  readings(): ReadonlyArray<PatronReading> {
    return (this.patrons ?? []).map((p) => {
      const target = this.currentTarget(p);
      const atSpot = Math.hypot(target.x - p.x, target.y - p.y) < TILE_SIZE;
      const viaFrom = { x: p.viaFromX, y: p.viaFromY };
      const viaTo = { x: p.viaToX, y: p.viaToY };
      return {
        intent: p.intent,
        settled: p.motionTicks === 0 && atSpot,
        cx: bodyCx(p),
        cy: bodyCy(p),
        facingX: p.facingX,
        facingY: p.facingY,
        talking: this.isTalking(p),
        pausedOnWaypoint: p.pause > 0 && p.stoppedOnWaypoint,
        waypointOffLineTiles:
          p.via === null ? null : distanceToSegment(p.via, viaFrom, viaTo) / TILE_SIZE,
      };
    });
  }

  private abandonStalledTarget(p: Patron): void {
    if (p.pause > 0) {
      p.lastTargetDist = Number.POSITIVE_INFINITY;
      p.stalledTicks = 0;
      return;
    }
    const targetDist = Math.hypot(p.targetX - p.x, p.targetY - p.y);
    const closedIn = targetDist < p.lastTargetDist - PATRON_PROGRESS_EPSILON;
    p.stalledTicks = closedIn ? 0 : p.stalledTicks + 1;
    p.lastTargetDist = targetDist;
    if (p.stalledTicks < PATRON_STALL_TICKS) return;

    this.takeUpIntent(p);
    p.stoppedOnWaypoint = false;
    p.pause = PATRON_PAUSE_MIN + Math.floor(this.random() * (PATRON_PAUSE_MAX - PATRON_PAUSE_MIN));
  }

  /** Push overlapping patrons apart, and out of anything immovable they've walked into. */
  private resolveCollisions(patrons: Patron[], staticBodies: ReadonlyArray<CrowdBody>): void {
    const radius = TILE_SIZE * CROWD_BODY_RADIUS_TILES;

    for (let i = 0; i < patrons.length; i++) {
      for (let j = i + 1; j < patrons.length; j++) {
        const a = patrons[i];
        const b = patrons[j];
        const dx = bodyCx(b) - bodyCx(a);
        const dy = bodyCy(b) - bodyCy(a);
        const overlap = radius * 2 - Math.hypot(dx, dy);
        if (overlap <= 0) continue;
        // Both are crowd, so both give ground — half the correction each.
        const push = this.separationVector(dx, dy, overlap / 2, a.seed + j);
        this.nudge(a, -push.x, -push.y);
        this.nudge(b, push.x, push.y);
      }
    }

    for (const p of patrons) {
      for (const body of staticBodies) {
        const dx = bodyCx(p) - body.cx;
        const dy = bodyCy(p) - body.cy;
        const overlap = radius + body.radius - Math.hypot(dx, dy);
        if (overlap <= 0) continue;
        // Immovable body: the patron absorbs the whole correction.
        const push = this.separationVector(dx, dy, overlap, p.seed);
        this.nudge(p, push.x, push.y);
      }
    }
  }

  /**
   * Direction to separate two bodies by `distance`. Two figures stacked exactly
   * on top of each other have no direction to separate along, so a seed-derived
   * angle breaks the tie deterministically instead of leaving them welded.
   */
  private separationVector(
    dx: number,
    dy: number,
    distance: number,
    tieBreakSeed: number,
  ): { x: number; y: number } {
    const len = Math.hypot(dx, dy);
    if (len < COINCIDENT_EPSILON) {
      const angle = (tieBreakSeed % DEGREES_PER_TURN) * RADIANS_PER_DEGREE;
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
    }
    return { x: (dx / len) * distance, y: (dy / len) * distance };
  }

  /** Move a patron by a correction, refusing any part of it that leaves legal floor. */
  private nudge(p: Patron, dx: number, dy: number): void {
    if (this.isPatronSpot(p.x + dx, p.y)) p.x += dx;
    if (this.isPatronSpot(p.x, p.y + dy)) p.y += dy;
  }

  /**
   * One figure per patron, built once and re-sorted every frame off the `y` the
   * update loop writes back — a crowd this size would otherwise rebuild a dozen
   * closures per frame purely to carry a number that already exists.
   */
  renderables(): ReadonlyArray<InteriorFigure> {
    this.ensurePatrons();
    return this.figures;
  }

  private renderPatron(
    p: Patron,
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const size = tileSize * p.heightScale;
    // Keep the feet on the tile's ground line while the figure's height varies.
    const footAlign = tileSize - size;
    drawClubCastFigure(ctx, p.ref, p.x - camX + footAlign / 2, p.y - camY + footAlign, size, {
      action: p.motionTicks > 0 ? 'walk' : this.isTalking(p) ? 'talk' : 'idle',
      walkPhase: p.walkCycle * TWO_PI,
      facingX: p.facingX,
      facingY: p.facingY,
      loopOffsetSeconds: p.seed / WORLD_TICKS_PER_SECOND,
    });
  }

  /** True when a patron may stand with its body centre over this world-pixel spot. */
  private isPatronSpot(x: number, y: number): boolean {
    const tx = Math.floor((x + TILE_SIZE * TILE_CENTER_X_FRACTION) / TILE_SIZE);
    const ty = Math.floor((y + TILE_SIZE * BODY_CENTER_Y_FRACTION) / TILE_SIZE);
    if (!isClubPatronTile(tx, ty)) return false;
    return this.map.isWalkable(tx, ty, 'walker');
  }

  /**
   * Every tile a patron is allowed to stand on, collected once. Enumerating the
   * legal floor beats sampling the room and retrying: the club's open floor is a
   * minority of its tiles, so rejection sampling either burns tries or, on a bad
   * run, hands back somewhere illegal.
   */
  private legalPatronTiles(): ReadonlyArray<{ x: number; y: number }> {
    if (this.patronTiles !== null) return this.patronTiles;
    const tiles: Array<{ x: number; y: number }> = [];
    for (let ty = 1; ty < CLUB_INTERIOR_H - 1; ty++) {
      for (let tx = 1; tx < CLUB_INTERIOR_W - 1; tx++) {
        if (isClubPatronTile(tx, ty) && this.map.isWalkable(tx, ty, 'walker'))
          tiles.push({ x: tx, y: ty });
      }
    }
    this.patronTiles = tiles;
    this.attractionTiles = this.attractions.map((attraction) =>
      tiles.filter((tile) => inClubRect(attraction.area, tile.x, tile.y)),
    );
    return tiles;
  }

  /** Never reached with an empty pool: `ensurePatrons` seeds nobody when the floor has no room. */
  private randomPatronPoint(): { x: number; y: number } {
    const tiles = this.legalPatronTiles();
    const tile = tiles[Math.floor(this.random() * tiles.length)];
    return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  }

  /** Whether every step of a straight walk passes the same probe `stepWander` applies. */
  private hasClearWalk(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const probeStepPx = TILE_SIZE * PATRON_WALK_PROBE_STEP_TILES;
    const probeCount = Math.ceil(Math.hypot(dx, dy) / probeStepPx);
    const southwardDrop = dy > 0 ? TILE_SIZE * SOUTHWARD_PROBE_DROP : 0;
    for (let i = 1; i <= probeCount; i++) {
      const t = i / probeCount;
      if (!this.isPatronSpot(from.x + dx * t, from.y + dy * t + southwardDrop)) return false;
    }
    return true;
  }

  /**
   * The club is already full when the party walks in: each patron opens the
   * visit standing in their group or at their stage, not walking to it.
   * Their stay is staggered so the room doesn't break up all at once.
   */
  private arriveAlreadyThere(p: Patron): void {
    const intent = this.drawIntent(p.intent);
    if (intent === null) return;
    const target = this.intentTarget(p, intent);
    if (target === null) return;
    this.adopt(p, intent, target);
    p.intentEndsTick = Math.round(this.random() * p.intentEndsTick);
    p.x = target.x;
    p.y = target.y;
    p.tickStartX = target.x;
    p.tickStartY = target.y;
    if (intent.kind === 'gather') this.members[intent.gathering]?.push(p);
  }

  private ensurePatrons(): void {
    if (this.patrons !== null) return;
    const patrons: Patron[] = [];
    if (this.legalPatronTiles().length > 0) {
      for (let i = 0; i < CLUB_PATRON_COUNT; i++) {
        const start = this.randomPatronPoint();
        const patron: Patron = {
          x: start.x,
          y: start.y,
          targetX: start.x,
          targetY: start.y,
          speed: PATRON_SPEED_MIN + this.random() * (PATRON_SPEED_MAX - PATRON_SPEED_MIN),
          seed: i * PATRON_SEED_STRIDE + PATRON_SEED_OFFSET,
          facingX: 1,
          facingY: 0,
          pause: Math.floor(this.random() * PATRON_PAUSE_MAX),
          heightScale: PATRON_HEIGHT_MIN + this.random() * (PATRON_HEIGHT_MAX - PATRON_HEIGHT_MIN),
          ref: CLUB_PATRON_REFS[i % CLUB_PATRON_REFS.length],
          walkCycle: 0,
          motionTicks: 0,
          lastTargetDist: Number.POSITIVE_INFINITY,
          stalledTicks: 0,
          tickStartX: start.x,
          tickStartY: start.y,
          intent: { kind: 'wait' },
          intentEndsTick: 0,
          intentStartTick: 0,
          spotX: start.x,
          spotY: start.y,
          via: null,
          viaFromX: start.x,
          viaFromY: start.y,
          viaToX: start.x,
          viaToY: start.y,
          lastVia: null,
          stoppedOnWaypoint: false,
        };
        this.arriveAlreadyThere(patron);
        patrons.push(patron);
        this.figures.push({
          y: patron.y,
          render: (ctx, camX, camY, tileSize) =>
            this.renderPatron(patron, ctx, camX, camY, tileSize),
        });
      }
    }
    this.patrons = patrons;
  }
}

/**
 * The club's crowd: drawn to each stage by its post's weight, watching its
 * pole, and gathering at the club's tables and open circles.
 */
export function createClubCrowd(map: GameMap, random: () => number = Math.random): ClubCrowdSystem {
  const attractions = CLUB_PERFORMER_POSTS.map((post) => ({
    area: post.watchFrom,
    weight: post.attraction,
    focus: post.pole,
  }));
  return new ClubCrowdSystem(map, attractions, CLUB_GATHERINGS, random);
}

/** Distance from `point` to the segment from `a` to `b`, in pixels. */
function distanceToSegment(
  point: { readonly x: number; readonly y: number },
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const projected = lengthSq === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  const along = Math.max(0, Math.min(1, projected));
  return Math.hypot(point.x - (a.x + dx * along), point.y - (a.y + dy * along));
}

function bodyCx(p: { x: number }): number {
  return p.x + TILE_SIZE * TILE_CENTER_X_FRACTION;
}

function bodyCy(p: { y: number }): number {
  return p.y + TILE_SIZE * BODY_CENTER_Y_FRACTION;
}

/** A stationary figure standing on a tile — staff or a dancer. */
export function tileBody(tile: { x: number; y: number }): CrowdBody {
  return {
    cx: (tile.x + TILE_CENTER_X_FRACTION) * TILE_SIZE,
    cy: (tile.y + BODY_CENTER_Y_FRACTION) * TILE_SIZE,
    radius: TILE_SIZE * CROWD_BODY_RADIUS_TILES,
  };
}

/** Who a moving body on the floor is: a crawler pushes harder than someone standing on a mark. */
export type MovingBodyKind = 'crawler' | 'standing';

const MOVING_BODY_RADIUS_TILES: Readonly<Record<MovingBodyKind, number>> = {
  crawler: PLAYER_RADIUS_TILES,
  standing: CROWD_BODY_RADIUS_TILES,
};

/**
 * Moves `body` onto a figure at sprite origin `pos`, in place: the club
 * refreshes the same bodies every frame rather than allocating new ones.
 */
export function placeMovingBody(
  body: CrowdBody,
  pos: { readonly x: number; readonly y: number },
  kind: MovingBodyKind,
): void {
  body.cx = pos.x + TILE_SIZE * TILE_CENTER_X_FRACTION;
  body.cy = pos.y + TILE_SIZE * BODY_CENTER_Y_FRACTION;
  body.radius = TILE_SIZE * MOVING_BODY_RADIUS_TILES[kind];
}
