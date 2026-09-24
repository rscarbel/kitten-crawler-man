/**
 * The fire fairy, through its real AI, the real `FairyFireballSystem` and the
 * real crawler movement (`applyMovement`).
 *
 * - The throw leaves on the frame the fairy chooses it, and its landing point
 *   is the crawler's centre on that frame: a crawler who walks away from the
 *   throw, or who was already walking, is not hit by the ball.
 * - The ball is in the air, its landing marked, at least
 *   `LOCKED_TELEGRAPH_MIN_FRAMES`: a crawler who only starts moving that long
 *   after the throw still escapes, at level 1 and the maximum.
 * - The flight outlasts a reaction and a walk out of the whole blast circle:
 *   a crawler standing on the landing who starts walking
 *   `FIREBALL_DODGE_REACTION_FRAMES` after the throw is outside the blast
 *   radius when the ball comes down.
 * - The landing's red danger circle, the blast's full radius, is on the
 *   ground from the throw until the ball lands.
 * - One cast throws a ball at each crawler the fairy may lob at, each on that
 *   crawler's own feet; one ball when only one crawler qualifies.
 * - The AI companion standing on a landing leaves every landing circle before
 *   the ball comes down and stays out until the charges have gone off; so does
 *   she standing exactly on the line between two landings, in the open or in a
 *   one-tile corridor, where the circles' summed push leads nowhere.
 * - So do Mongo and every hireling, standing where the twin lob's two landings
 *   overlap, beside the line between them or exactly on it, whether following
 *   their crawler or fighting a mob inside the circle, and none of them takes
 *   a hit; on the line in a one-tile corridor they leave along it.
 * - The fairy never stands still to throw.
 * - No throw goes through a wall or past `FIREBALL_MAX_RANGE_TILES`.
 * - A landed charge goes off exactly `FIREBALL_FUSE_FRAMES` later.
 * - The death flame damages whoever stands in it and never sets them alight;
 *   its mini-explosion fires `DEATH_FLAME_FRAMES` after the death.
 * - A freeze never guarantees a blast: a crawler frozen on a landed charge, at
 *   every freeze timing, thaws and walks out before it goes off — at the
 *   chilled pace too, since a bolt in the freeze grace can re-chill it.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import { CHILLED_STATUS, FROZEN_STATUS } from '../../src/core/StatusEffect';
import { applyIceHit } from '../../src/core/frostStatus';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import {
  FireFairy,
  FIREBALL_CAST,
  type PendingFireball,
} from '../../src/creatures/fairies/FireFairy';
import type { ActiveFairyCast, FairyCastIntent } from '../../src/creatures/fairies/Fairy';
import {
  CHILLED_MOVE_SPEED_FACTOR,
  DEATH_FLAME_FRAMES,
  FAIRY_NOTICE_RANGE_TILES,
  FIREBALL_BLAST_RADIUS_TILES,
  FIREBALL_BLAST_DAMAGE,
  FIREBALL_BURN_CHANCE,
  FIREBALL_DAMAGE,
  FIREBALL_DODGE_REACTION_FRAMES,
  FIREBALL_FLIGHT_FRAMES,
  FIREBALL_FUSE_FRAMES,
  FIREBALL_HIT_RADIUS_PX,
  FIREBALL_MAX_RANGE_TILES,
  FIREBALL_RETICLE_RADIUS_FRACTION,
  FROZEN_FRAMES,
} from '../../src/creatures/fairies/fairyTuning';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../../src/creatures/mobLevelScaling';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import type { Player } from '../../src/Player';
import { applyMovement } from '../../src/systems/GameLoopPhases';
import { Mongo } from '../../src/creatures/Mongo';
import { Mercenary } from '../../src/creatures/Mercenary';
import {
  MERCENARY_TEMPLATE_IDS,
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../../src/core/mercenaryTemplates';
import { isMarkedGround, setMarkedGroundSources } from '../../src/creatures/tactics/markedGround';
import { createMob } from '../../src/levels/spawner';
import { CompanionSystem } from '../../src/systems/CompanionSystem';
import {
  FairyFireballSystem,
  type FairyFireballSystemDeps,
  type FireHazardZone,
} from '../../src/systems/FairyFireballSystem';
import { drawLandingReticle } from '../../src/sprites/art/fairyEffectsArt';
import { gameContext } from '../nodeGameContext';
import type { FairyGateReport } from './report';
import {
  ARENA_TILES,
  PARK_TILE,
  buildStage,
  centreOf,
  placeOnTile,
  withDodgesOff,
  type TileSpec,
} from './stage';

type Point = { x: number; y: number };
type Walk = { readonly dx: number; readonly dy: number };

/** The entry at `index`, or undefined past either end. */
function itemAt<T>(list: readonly T[], index: number): T | undefined {
  return index >= 0 && index < list.length ? list[index] : undefined;
}

const FAIRY_TILE_X = 5;
const FAIRY_TILE_Y = 10;
/** Where the crawler stands for a throw: six tiles east, in range and in sight. */
const TARGET_TILE_X = 11;
/**
 * Constitution that gives the crawler HP to spare, so no run ends in a death
 * that stops the blows being measured.
 */
const DURABLE_CONSTITUTION = 100;
/** Frames granted for one throw to leave, fly and land. */
const THROW_LIMIT_FRAMES = 400;
/** Frames granted for a landed charge to go off. */
const CHARGE_LIMIT_FRAMES = 600;
/** Frames a sealed-off or out-of-range fairy is given to (fail to) throw. */
const REFUSAL_FRAMES = 200;
/** The frozen crawler's walk: due east, one unit of input. */
const WALK_EAST: Walk = { dx: 1, dy: 0 };
const WALK_SOUTH: Walk = { dx: 0, dy: 1 };
const WALK_WEST: Walk = { dx: -1, dy: 0 };
/** A freeze longer than the fuse, for the run the fairness rule must catch. */
const OVER_FUSE_MARGIN_FRAMES = 10;
/**
 * Frames the frozen-on-a-charge crawler waits out of the fairy's notice before
 * stepping into range. The ball leaves the moment it is in range, so without
 * the wait the longest freeze swept could not land that long before the ball.
 */
const FREEZE_LEAD_IN_FRAMES = FIREBALL_FUSE_FRAMES + OVER_FUSE_MARGIN_FRAMES;
/** A charge within this many pixels of the crawler's centre is under its feet. */
const UNDERFOOT_PX = 1;
/** How far east of the fairy the sealing wall stands: inside throw range, so only sight is blocked. */
const WALL_COLUMN_OFFSET_TILES = 3;
const DECIMALS = 1;
const BLAST_PX = TILE_SIZE * FIREBALL_BLAST_RADIUS_TILES;
const DECIMALS_FINE = 3;
/** Death-flame lengths the flame is watched over, so the frame it goes off shows. */
const DEATH_FLAME_WATCH_SPANS = 2;
/** Tiles past the throw's reach the out-of-range crawler stands. */
const PAST_RANGE_TILES = 1;
/**
 * Where the crawler stands for the fairy that leads its throw: close enough
 * that a whole flight's walk south still lands inside the throw range, so the
 * range clamp cannot pull the led landing short and hide the lead.
 */
const LEADING_TARGET_TILE_X = FAIRY_TILE_X + 2;
/** Frames after the throw a crawler who reacts at once starts to walk. */
const PROMPT_REACTION_FRAMES = 1;
/** A throw held back this long after it is chosen: as long as the telegraph floor. */
const HELD_THROW_FRAMES = LOCKED_TELEGRAPH_MIN_FRAMES;
/** Where an approaching crawler starts: a tile past the fairy's notice. */
const APPROACH_START_TILE_X = FAIRY_TILE_X + FAIRY_NOTICE_RANGE_TILES + 1;
/** An approaching crawler stops this close, so it never walks through the fairy. */
const APPROACH_STOP_TILES = 2;
/** Frames watched before and after a throw for the fairy standing still. */
const MOVING_BEFORE_THROW_FRAMES = 4;
const MOVING_AFTER_THROW_FRAMES = 13;
/** Movement under this many pixels is not a step. */
const MOVE_EPSILON_PX = 0.01;

/** The real fire fairy, with every ball it throws noted as it is handed over. */
class WatchedFireFairy extends FireFairy {
  readonly thrown: PendingFireball[] = [];

  override takePendingFireballs(): readonly PendingFireball[] {
    const taken = super.takePendingFireballs();
    this.thrown.push(...taken);
    return taken;
  }
}

/** A fire fairy that holds each throw {@link HELD_THROW_FRAMES} after choosing it: a windup in disguise. */
class HeldThrowFireFairy extends WatchedFireFairy {
  private held: { readonly cast: ActiveFairyCast; framesLeft: number } | null = null;

  protected override onCastReleased(cast: ActiveFairyCast): void {
    this.held = { cast, framesLeft: HELD_THROW_FRAMES };
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    const held = this.held;
    if (held === null) return;
    held.framesLeft--;
    if (held.framesLeft > 0) return;
    this.held = null;
    super.onCastReleased(held.cast);
  }
}

/**
 * A fire fairy whose landing tracks the crawler: it throws where the crawler
 * will be when the ball comes down, from the step it saw the crawler take.
 */
class LeadingFireFairy extends WatchedFireFairy {
  private readonly lastSeen = new Map<Player, Point>();
  private readonly lastStep = new Map<Player, Point>();

  override updateAI(targets: Player[]): void {
    for (const target of targets) {
      const centre = centreOf(target);
      const seen = this.lastSeen.get(target);
      if (seen !== undefined)
        this.lastStep.set(target, { x: centre.x - seen.x, y: centre.y - seen.y });
      this.lastSeen.set(target, centre);
    }
    super.updateAI(targets);
  }

  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    const intent = super.chooseCast(crawler);
    const target = intent?.target ?? null;
    const step = target === null ? undefined : this.lastStep.get(target);
    if (intent === null || step === undefined) return null;
    return {
      ...intent,
      aimX: intent.aimX + step.x * FIREBALL_FLIGHT_FRAMES,
      aimY: intent.aimY + step.y * FIREBALL_FLIGHT_FRAMES,
    };
  }
}

/** A fire fairy that holds its place for as long as a cast is being played. */
class StillCastingFireFairy extends WatchedFireFairy {
  override updateAI(targets: Player[]): void {
    const heldX = this.x;
    const heldY = this.y;
    super.updateAI(targets);
    if (this.activeCast === null) return;
    this.x = heldX;
    this.y = heldY;
  }
}

/** A fire fairy that never throws: the path a fairy takes when casting has no say in it. */
class MuteFireFairy extends WatchedFireFairy {
  protected override chooseCast(): null {
    return null;
  }
}

/** A lob straight at `target`'s feet, with no guard on range or sight. */
function lobIntent(target: Player): FairyCastIntent {
  const aim = centreOf(target);
  return { cast: FIREBALL_CAST, target, aimX: aim.x, aimY: aim.y };
}

/** A fire fairy that lobs at any crawler it can see, however far. */
class RangeBlindFireFairy extends WatchedFireFairy {
  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    if (crawler?.isAlive !== true || !this.isCastReady(FIREBALL_CAST)) return null;
    return this.hasLOS(crawler) ? lobIntent(crawler) : null;
  }
}

/** A fire fairy that lobs at any crawler in range, wall or no wall. */
class SightBlindFireFairy extends WatchedFireFairy {
  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    if (crawler?.isAlive !== true || !this.isCastReady(FIREBALL_CAST)) return null;
    const aim = centreOf(crawler);
    const origin = this.groundCentre;
    const inRange =
      Math.hypot(aim.x - origin.x, aim.y - origin.y) <= this.tileSize * FIREBALL_MAX_RANGE_TILES;
    return inRange ? lobIntent(crawler) : null;
  }
}

/** A fire fairy that throws only the ball it chose, never a twin at the other crawler. */
class SingleLobFireFairy extends WatchedFireFairy {
  protected override onCastReleased(cast: ActiveFairyCast): void {
    if (cast.cast.id !== FIREBALL_CAST.id) return;
    const from = this.groundCentre;
    this.queueFireball({
      fromX: from.x,
      fromY: from.y,
      toX: cast.aimX,
      toY: cast.aimY,
      damage: FIREBALL_DAMAGE,
      burstDamage: FIREBALL_BLAST_DAMAGE,
    });
  }
}

type FireFairyFactory = (tileX: number, tileY: number) => WatchedFireFairy;
const realFireFairy: FireFairyFactory = (x, y) => new WatchedFireFairy(x, y, TILE_SIZE);

/** Any animation frame: the reticle's spin does not move its reach. */
const RETICLE_FRAME = 0;

/** A flight this short leaves a crawler who reacts in time still inside the circle at the landing. */
const SHORT_FLIGHT_FRAMES = 40;

/** Fire whose balls come down after {@link SHORT_FLIGHT_FRAMES}. */
class ShortFlightFireballSystem extends FairyFireballSystem {
  protected override get flightFrames(): number {
    return SHORT_FLIGHT_FRAMES;
  }
}

/** Fire that shows only the landing reticle while a ball is in the air, no danger circle. */
class ReticleOnlyFireballSystem extends FairyFireballSystem {
  protected override drawLandingWarning(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    flightProgress: number,
  ): void {
    const reticlePx = BLAST_PX * FIREBALL_RETICLE_RADIUS_FRACTION;
    drawLandingReticle(ctx, sx, sy, reticlePx, flightProgress, RETICLE_FRAME);
  }
}

/** Fire whose ground counts as a hazard only once a ball has landed. */
class InFlightBlindFireballSystem extends FairyFireballSystem {
  protected override hazardZones(): readonly FireHazardZone[] {
    return super.hazardZones().filter((zone) => zone.kind !== 'landing');
  }
}

/** Fire that points a body out of only the zone it stands deepest in, blind to the rest. */
class DeepestZoneOnlyFireballSystem extends FairyFireballSystem {
  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const centre = centreOf({ x, y });
    let deepest: FireHazardZone | null = null;
    let deepestDepth = 0;
    for (const zone of this.hazardZones()) {
      const depth = zone.radiusPx - Math.hypot(centre.x - zone.x, centre.y - zone.y);
      if (depth <= deepestDepth) continue;
      deepestDepth = depth;
      deepest = zone;
    }
    if (deepest === null) return null;
    const dx = centre.x - deepest.x;
    const dy = centre.y - deepest.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? { dx: 1, dy: 0 } : { dx: dx / length, dy: dy / length };
  }
}

/**
 * Fire that always answers with the depth-weighted sum of every zone's outward
 * push, never searching for a way out when that sum points along the line
 * between two zone centres.
 */
class SummedPushOnlyFireballSystem extends FairyFireballSystem {
  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const centre = centreOf({ x, y });
    let inside = false;
    let pushX = 0;
    let pushY = 0;
    for (const zone of this.hazardZones()) {
      const offsetX = centre.x - zone.x;
      const offsetY = centre.y - zone.y;
      const distance = Math.hypot(offsetX, offsetY);
      const depth = zone.radiusPx - distance;
      if (depth <= 0) continue;
      inside = true;
      if (distance === 0) continue;
      pushX += (offsetX / distance) * depth;
      pushY += (offsetY / distance) * depth;
    }
    if (!inside) return null;
    const length = Math.hypot(pushX, pushY);
    return length === 0 ? { dx: 1, dy: 0 } : { dx: pushX / length, dy: pushY / length };
  }
}

type FireballsFactory = (deps: FairyFireballSystemDeps) => FairyFireballSystem;
const realFireballs: FireballsFactory = (deps) => new FairyFireballSystem(deps);

function fireStage(
  opts: {
    level?: number;
    wallColumn?: number;
    make?: FireFairyFactory;
    targetTileX?: number;
    fireballs?: FireballsFactory;
    walls?: readonly TileSpec[];
  } = {},
) {
  const walls: TileSpec[] = [...(opts.walls ?? [])];
  if (opts.wallColumn !== undefined) {
    for (let y = 1; y < PARK_TILE; y++) walls.push([opts.wallColumn, y]);
  }
  const built = buildStage(walls);
  const fireballs = (opts.fireballs ?? realFireballs)({
    bus: built.bus,
    gameMap: built.map,
    getMobs: () => built.roster.mobs,
  });
  const stage = { ...built, fireballs };
  const fairy = (opts.make ?? realFireFairy)(FAIRY_TILE_X, FAIRY_TILE_Y);
  fairy.setMap(stage.map);
  stage.roster.add(fairy);
  const level = opts.level ?? 1;
  if (level > 1) fairy.applyMobLevel(level);
  stage.pm.human.setBaseStat('constitution', DURABLE_CONSTITUTION);
  stage.pm.human.hp = stage.pm.human.maxHp;
  placeOnTile(stage.pm.human, opts.targetTileX ?? TARGET_TILE_X, FAIRY_TILE_Y);
  placeOnTile(stage.pm.cat, PARK_TILE, PARK_TILE);
  const path: Point[] = [{ x: fairy.x, y: fairy.y }];
  /** One world frame: the crawler moves, the fairy thinks, the fire system runs, the crawler's timers tick. */
  const step = (move: Walk | null): void => {
    stage.pm.human.invulnerableFrames = 0;
    if (move !== null) {
      applyMovement(stage.pm.human, { dx: move.dx, dy: move.dy, isMobile: false }, stage.map);
    }
    fairy.updateAI(stage.party());
    stage.fireballs.update(stage.ctx());
    stage.pm.human.tickTimers();
    path.push({ x: fairy.x, y: fairy.y });
  };
  return { ...stage, fairy, step, path };
}

/** When a crawler walks away from a throw: never, from the first frame, or `n` frames after the throw. */
type WalkAway = 'never' | 'throughout' | { readonly afterThrowFrames: number };

interface ThrowRun {
  /** The frame the fairy chose the throw, and whether it was already the release then. */
  readonly chosenFrame: number;
  readonly releasedWhenChosen: boolean;
  readonly thrownFrame: number;
  readonly aimedAtCentreOnThrow: boolean;
  readonly landedOnAim: boolean;
  readonly flightFrames: number;
  readonly directHit: boolean;
  readonly distanceAtLanding: number;
}

/** One throw at a crawler on the fairy's row who walks south as `walkAway` says. */
function throwRun(
  make: FireFairyFactory,
  level: number,
  walkAway: WalkAway,
  fireballs: FireballsFactory = realFireballs,
  targetTileX: number = TARGET_TILE_X,
): ThrowRun {
  return withDodgesOff(() => {
    const s = fireStage({ level, make, fireballs, targetTileX });
    let chosenFrame = -1;
    let releasedWhenChosen = false;
    let thrownFrame = -1;
    let aimedAtCentreOnThrow = false;
    let aim: Point = { x: NaN, y: NaN };
    const walking = (n: number): boolean => {
      if (walkAway === 'never') return false;
      if (walkAway === 'throughout') return true;
      return thrownFrame > 0 && n - thrownFrame >= walkAway.afterThrowFrames;
    };
    for (let n = 1; n <= THROW_LIMIT_FRAMES; n++) {
      const chargesBefore = s.fireballs.liveCharges.length;
      const thrownBefore = s.fairy.thrown.length;
      const hpBefore = s.pm.human.hp;
      s.step(walking(n) ? WALK_SOUTH : null);
      const cast = s.fairy.activeCast;
      if (chosenFrame < 0 && cast !== null) {
        chosenFrame = n;
        releasedWhenChosen = cast.phase === 'release';
      }
      const ball = itemAt(s.fairy.thrown, 0);
      if (thrownBefore === 0 && ball !== undefined) {
        thrownFrame = n;
        aim = { x: ball.toX, y: ball.toY };
        const centre = centreOf(s.pm.human);
        aimedAtCentreOnThrow = aim.x === centre.x && aim.y === centre.y;
      }
      const charge = itemAt(s.fireballs.liveCharges, 0);
      if (chargesBefore === 0 && charge !== undefined) {
        const centre = centreOf(s.pm.human);
        return {
          chosenFrame,
          releasedWhenChosen,
          thrownFrame,
          aimedAtCentreOnThrow,
          landedOnAim: charge.x === aim.x && charge.y === aim.y,
          flightFrames: n - thrownFrame,
          directHit: s.pm.human.hp < hpBefore,
          distanceAtLanding: Math.hypot(centre.x - charge.x, centre.y - charge.y),
        };
      }
    }
    return {
      chosenFrame,
      releasedWhenChosen,
      thrownFrame,
      aimedAtCentreOnThrow,
      landedOnAim: false,
      flightFrames: -1,
      directHit: false,
      distanceAtLanding: NaN,
    };
  });
}

const escaped = (run: ThrowRun): boolean =>
  run.flightFrames > 0 && !run.directHit && run.distanceAtLanding > FIREBALL_HIT_RADIUS_PX;

const thrownWhenChosen = (run: ThrowRun): boolean =>
  run.chosenFrame > 0 && run.releasedWhenChosen && run.thrownFrame === run.chosenFrame;

function checkThrow(report: FairyGateReport): void {
  for (const level of [1, MAX_MOB_LEVEL]) {
    const still = throwRun(realFireFairy, level, 'never');
    report.check(
      thrownWhenChosen(still),
      `L${level}: the ball leaves on the frame the fairy chooses the throw`,
      `chosen ${still.chosenFrame}, thrown ${still.thrownFrame}`,
    );
    report.check(
      still.aimedAtCentreOnThrow && still.landedOnAim,
      `L${level}: the landing is the crawler's centre on the throw frame, and the ball comes down there`,
    );
    report.check(
      still.flightFrames >= LOCKED_TELEGRAPH_MIN_FRAMES,
      `L${level}: the ball is in the air at least ${LOCKED_TELEGRAPH_MIN_FRAMES} frames`,
      `${still.flightFrames} frames from the throw frame to the landing frame`,
    );
    const prompt = throwRun(realFireFairy, level, { afterThrowFrames: PROMPT_REACTION_FRAMES });
    report.check(
      escaped(prompt),
      `L${level}: a crawler who walks away from the throw is not hit by the ball`,
      `${prompt.distanceAtLanding.toFixed(DECIMALS)} px clear`,
    );
    const slow = throwRun(realFireFairy, level, { afterThrowFrames: LOCKED_TELEGRAPH_MIN_FRAMES });
    report.check(
      escaped(slow),
      `L${level}: a crawler who only starts walking ${LOCKED_TELEGRAPH_MIN_FRAMES} frames after the throw still escapes`,
      `${slow.distanceAtLanding.toFixed(DECIMALS)} px clear`,
    );
    const walker = throwRun(realFireFairy, level, 'throughout');
    report.check(
      escaped(walker),
      `L${level}: a crawler already walking when the ball is thrown is not hit by it`,
      `${walker.distanceAtLanding.toFixed(DECIMALS)} px clear`,
    );
  }

  const held = throwRun((x, y) => new HeldThrowFireFairy(x, y, TILE_SIZE), 1, 'never');
  report.checkCatches(
    thrownWhenChosen(held),
    'a fairy that holds its throw after choosing it is caught throwing late',
    `chosen ${held.chosenFrame}, thrown ${held.thrownFrame}`,
  );
  const stood = throwRun(realFireFairy, 1, 'never');
  report.checkCatches(escaped(stood), 'the same crawler standing still is caught by the ball');
  const flight = stood.flightFrames;
  const lastMoment = throwRun(realFireFairy, 1, { afterThrowFrames: flight });
  report.checkCatches(
    escaped(lastMoment),
    'a crawler who starts walking only on the frame the ball comes down is caught by it',
    `${lastMoment.distanceAtLanding.toFixed(DECIMALS)} px from the landing`,
  );
  const leading = throwRun(
    (x, y) => new LeadingFireFairy(x, y, TILE_SIZE),
    1,
    'throughout',
    realFireballs,
    LEADING_TARGET_TILE_X,
  );
  report.checkCatches(
    leading.aimedAtCentreOnThrow,
    "a fairy whose landing tracks the crawler is caught aiming off the crawler's centre",
  );
  report.checkCatches(
    escaped(leading),
    'a fairy whose landing tracks the crawler is caught hitting the walking crawler',
    `${leading.distanceAtLanding.toFixed(DECIMALS)} px from the landing`,
  );
}

function checkFlightOutlastsTheDodge(report: FairyGateReport): void {
  const walkOutFrames = Math.ceil(BLAST_PX / PLAYER_SPEED);
  const slackFrames = FIREBALL_FLIGHT_FRAMES - FIREBALL_DODGE_REACTION_FRAMES - walkOutFrames;
  report.precondition(
    slackFrames > 0,
    'FIREBALL_DODGE_REACTION_FRAMES + ceil(blast radius / PLAYER_SPEED) < FIREBALL_FLIGHT_FRAMES',
    `${FIREBALL_DODGE_REACTION_FRAMES} + ${walkOutFrames} vs ${FIREBALL_FLIGHT_FRAMES}: ${slackFrames} frames to spare`,
  );
  const reaction = { afterThrowFrames: FIREBALL_DODGE_REACTION_FRAMES };
  const clearOfBlast = (run: ThrowRun): boolean =>
    run.flightFrames > 0 && !run.directHit && run.distanceAtLanding > BLAST_PX;
  for (const level of [1, MAX_MOB_LEVEL]) {
    const run = throwRun(realFireFairy, level, reaction);
    report.check(
      clearOfBlast(run),
      `L${level}: a crawler on the landing who walks out ${FIREBALL_DODGE_REACTION_FRAMES} frames after the throw is outside the blast radius when the ball lands`,
      `flight ${run.flightFrames} frames, ${(run.distanceAtLanding - BLAST_PX).toFixed(DECIMALS)} px past the rim`,
    );
  }
  const short = throwRun(realFireFairy, 1, reaction, (deps) => new ShortFlightFireballSystem(deps));
  report.checkCatches(
    clearOfBlast(short),
    `a ${SHORT_FLIGHT_FRAMES}-frame flight is caught landing with that crawler still inside the blast radius`,
    `${(short.distanceAtLanding - BLAST_PX).toFixed(DECIMALS)} px past the rim`,
  );
}

/** Side of the square the ground is rendered into, centred on the landing. */
const WARNING_VIEW_PX = 160;
/** Where inside the blast radius the danger circle is sampled: past the reticle's reach. */
const WARNING_INSIDE_SHARE = 0.9;
/** Where outside the blast radius nothing may be drawn: past the danger circle's outline. */
const WARNING_OUTSIDE_SHARE = 1.2;
/** Least opacity, of 255, that counts as something drawn. */
const WARNING_MIN_ALPHA = 20;
/** Index of each channel in an RGBA pixel. */
const RED_CHANNEL = 0;
const GREEN_CHANNEL = 1;
const BLUE_CHANNEL = 2;
const ALPHA_CHANNEL = 3;

interface LandingWarningRun {
  readonly framesInFlight: number;
  readonly framesShown: number;
  readonly framesSpilled: number;
}

/**
 * Renders the fire's ground layer on every frame a ball is in the air, centred
 * on its landing, and reads the pixels just inside and just outside the blast
 * radius: red inside means the danger circle is down, anything outside means it
 * is not the blast's size.
 */
function landingWarningRun(fireballs: FireballsFactory): LandingWarningRun {
  return withDodgesOff(() => {
    const s = fireStage({ fireballs });
    const ctx = gameContext(WARNING_VIEW_PX, WARNING_VIEW_PX);
    const half = WARNING_VIEW_PX / 2;
    let framesInFlight = 0;
    let framesShown = 0;
    let framesSpilled = 0;
    let seenBall = false;
    for (let n = 1; n <= THROW_LIMIT_FRAMES; n++) {
      s.step(null);
      const ball = itemAt(s.fireballs.liveFireballs, 0);
      if (ball === undefined) {
        if (seenBall) break;
        continue;
      }
      seenBall = true;
      framesInFlight++;
      ctx.clearRect(0, 0, WARNING_VIEW_PX, WARNING_VIEW_PX);
      s.fireballs.renderGround(ctx, ball.toX - half, ball.toY - half);
      const inside = ctx.getImageData(half + BLAST_PX * WARNING_INSIDE_SHARE, half, 1, 1).data;
      const outside = ctx.getImageData(half + BLAST_PX * WARNING_OUTSIDE_SHARE, half, 1, 1).data;
      const red = inside[RED_CHANNEL];
      const insideIsRed =
        inside[ALPHA_CHANNEL] >= WARNING_MIN_ALPHA &&
        red > inside[GREEN_CHANNEL] &&
        red > inside[BLUE_CHANNEL];
      if (insideIsRed) framesShown++;
      if (outside[ALPHA_CHANNEL] >= WARNING_MIN_ALPHA) framesSpilled++;
    }
    return { framesInFlight, framesShown, framesSpilled };
  });
}

function checkLandingDangerCircle(report: FairyGateReport): void {
  const shown = (run: LandingWarningRun): boolean =>
    run.framesInFlight > 0 && run.framesShown === run.framesInFlight && run.framesSpilled === 0;
  const real = landingWarningRun(realFireballs);
  report.check(
    shown(real),
    "a red danger circle the blast's size is on the landing from the throw until the ball lands",
    `${real.framesShown}/${real.framesInFlight} frames shown, ${real.framesSpilled} spilled past the radius`,
  );
  const reticleOnly = landingWarningRun((deps) => new ReticleOnlyFireballSystem(deps));
  report.checkCatches(
    shown(reticleOnly),
    'fire that marks the landing with only its reticle is caught showing no danger circle',
    `${reticleOnly.framesShown}/${reticleOnly.framesInFlight} frames shown`,
  );
}

const TWIN_CAT_TILES_SOUTH = 3;
/** Where the cat stands for the twin lob: south of the human, still in throw range and sight. */
const TWIN_CAT_TILE_Y = FAIRY_TILE_Y + TWIN_CAT_TILES_SOUTH;

interface TwinRun {
  readonly balls: number;
  readonly aimedAtBoth: boolean;
  readonly aimedAtHuman: boolean;
}

/** The balls one cast throws, with the cat standing in range, out of range, or dead. */
function twinRun(make: FireFairyFactory, cat: 'in range' | 'out of range' | 'dead'): TwinRun {
  return withDodgesOff(() => {
    const s = fireStage({ make });
    if (cat !== 'out of range') placeOnTile(s.pm.cat, TARGET_TILE_X, TWIN_CAT_TILE_Y);
    if (cat === 'dead') s.pm.cat.hp = 0;
    for (let n = 1; n <= THROW_LIMIT_FRAMES; n++) {
      s.step(null);
      if (s.fairy.thrown.length === 0) continue;
      const aims = s.fairy.thrown.map((ball) => ({ x: ball.toX, y: ball.toY }));
      const on = (target: Player): boolean => {
        const centre = centreOf(target);
        return aims.some((aim) => aim.x === centre.x && aim.y === centre.y);
      };
      return {
        balls: aims.length,
        aimedAtBoth: on(s.pm.human) && on(s.pm.cat),
        aimedAtHuman: on(s.pm.human),
      };
    }
    return { balls: 0, aimedAtBoth: false, aimedAtHuman: false };
  });
}

function checkTwinLob(report: FairyGateReport): void {
  const both = twinRun(realFireFairy, 'in range');
  report.check(
    both.balls === 2 && both.aimedAtBoth,
    "with both crawlers in range and sight, one cast throws two balls, each on a crawler's centre",
    `${both.balls} balls`,
  );
  const single = twinRun((x, y) => new SingleLobFireFairy(x, y, TILE_SIZE), 'in range');
  report.checkCatches(
    single.balls === 2 && single.aimedAtBoth,
    'a fairy that throws one ball per cast is caught leaving the second crawler untargeted',
    `${single.balls} balls`,
  );
  for (const cat of ['out of range', 'dead'] as const) {
    const lone = twinRun(realFireFairy, cat);
    report.check(
      lone.balls === 1 && lone.aimedAtHuman,
      `with the cat ${cat}, one cast throws one ball, at the human`,
      `${lone.balls} balls`,
    );
  }
}

/** Where the AI cat stands: a tile west of the human, so the two landings overlap. */
const COMPANION_CAT_TILE_X = TARGET_TILE_X - 1;

interface CompanionDodgeRun {
  /** Frames from the throw until the cat stood outside every blast circle; -1 if never. */
  readonly clearedAfter: number;
  readonly flightFrames: number;
  readonly reentered: boolean;
  readonly hurt: boolean;
  readonly twoBalls: boolean;
}

/**
 * How the AI cat is told to behave: following the player, or told to stay put
 * — the stance under which a companion that ignored the landing would sit on
 * it until the ball came down.
 */
type CompanionOrders = 'follows' | 'holds her ground';

/**
 * Where the fire comes down around the AI cat: on her own feet and the
 * human's, as the fairy really throws, or flanking her on her row so that she
 * stands on the line between the two landings rather than on either.
 */
type CompanionPlacement = 'on a landing' | 'on the line';

interface CompanionSetup {
  readonly placement: CompanionPlacement;
  readonly corridor: boolean;
}

/**
 * The human (the player, standing still) and the AI cat a tile apart in the
 * fairy's range; the fairy lobs at both. The real `CompanionSystem` steers
 * the cat with the fire registered as its hazard source, as `DungeonScene`
 * wires it, and runs first in the frame as it does there.
 */
function companionDodgeRun(
  fireballs: FireballsFactory,
  orders: CompanionOrders,
  setup: Partial<CompanionSetup> = {},
): CompanionDodgeRun {
  return withDodgesOff(() => {
    const make = setup.placement === 'on the line' ? flankingFireFairy : realFireFairy;
    const walls = setup.corridor === true ? corridorWalls() : [];
    const s = fireStage({ fireballs, make, walls });
    const cat = s.pm.cat;
    placeOnTile(cat, COMPANION_CAT_TILE_X, FAIRY_TILE_Y);
    cat.setBaseStat('constitution', DURABLE_CONSTITUTION);
    cat.hp = cat.maxHp;
    const companion = new CompanionSystem(s.map, COMPANION_CAT_TILE_X, FAIRY_TILE_Y);
    companion.registerHazardSource(s.fireballs);
    if (orders === 'holds her ground') companion.setDoNotMove(cat, true);
    const insideAnyCircle = (): boolean => {
      const centre = centreOf(cat);
      const within = (x: number, y: number): boolean =>
        Math.hypot(centre.x - x, centre.y - y) <= BLAST_PX;
      return (
        s.fireballs.liveFireballs.some((ball) => within(ball.toX, ball.toY)) ||
        s.fireballs.liveCharges.some((charge) => within(charge.x, charge.y))
      );
    };
    let thrownFrame = -1;
    let landedFrame = -1;
    let clearedFrame = -1;
    let reentered = false;
    let hurt = false;
    let twoBalls = false;
    for (let n = 1; n <= CHARGE_LIMIT_FRAMES; n++) {
      cat.invulnerableFrames = 0;
      const hpBefore = cat.hp;
      const flyingBefore = s.fireballs.liveFireballs.length;
      companion.update(s.ctx());
      s.step(null);
      cat.tickTimers();
      if (cat.hp < hpBefore) hurt = true;
      if (thrownFrame < 0 && s.fairy.thrown.length > 0) {
        thrownFrame = n;
        twoBalls = s.fairy.thrown.length === 2;
      }
      if (thrownFrame < 0) continue;
      if (landedFrame < 0 && flyingBefore > 0 && s.fireballs.liveFireballs.length === 0) {
        landedFrame = n;
      }
      const inside = insideAnyCircle();
      if (clearedFrame < 0 && !inside) clearedFrame = n;
      else if (clearedFrame > 0 && inside) reentered = true;
      const resolved =
        landedFrame > 0 &&
        s.fireballs.liveFireballs.length === 0 &&
        s.fireballs.liveCharges.length === 0;
      if (resolved) break;
    }
    return {
      clearedAfter: clearedFrame < 0 ? -1 : clearedFrame - thrownFrame,
      flightFrames: landedFrame - thrownFrame,
      reentered,
      hurt,
      twoBalls,
    };
  });
}

function checkCompanionDodges(report: FairyGateReport): void {
  const dodged = (run: CompanionDodgeRun): boolean =>
    run.clearedAfter >= 0 && run.clearedAfter < run.flightFrames && !run.reentered && !run.hurt;
  const describe = (run: CompanionDodgeRun): string =>
    `clear ${run.clearedAfter} frames after the throw, landing at ${run.flightFrames}, re-entered ${run.reentered}, hurt ${run.hurt}`;
  for (const orders of ['follows', 'holds her ground'] as const) {
    const real = companionDodgeRun(realFireballs, orders);
    report.precondition(
      real.twoBalls,
      `the fairy lobs at both the human and the AI cat (${orders})`,
    );
    report.check(
      dodged(real),
      `the AI companion on a landing (${orders}) leaves every landing circle before the balls come down, and stays out until the charges go off`,
      describe(real),
    );
  }
  for (const orders of ['follows', 'holds her ground'] as const) {
    for (const corridor of [false, true]) {
      const where = corridor ? ' in a one-tile corridor' : '';
      const real = companionDodgeRun(realFireballs, orders, { placement: 'on the line', corridor });
      report.precondition(
        real.twoBalls,
        `the fairy lands two balls either side of the AI cat${where} (${orders})`,
      );
      report.check(
        dodged(real),
        `the AI companion on the line between two landings${where} (${orders}) leaves every circle before the balls come down, and stays out until the charges go off`,
        describe(real),
      );
      const summedOnly = companionDodgeRun(
        (deps) => new SummedPushOnlyFireballSystem(deps),
        orders,
        { placement: 'on the line', corridor },
      );
      report.checkCatches(
        dodged(summedOnly),
        `fire that only sums the circles' pushes is caught holding the AI companion on the line between two landings${where} (${orders})`,
        describe(summedOnly),
      );
    }
  }
  const staying: CompanionOrders = 'holds her ground';
  const blind = companionDodgeRun((deps) => new InFlightBlindFireballSystem(deps), staying);
  report.checkCatches(
    dodged(blind),
    'fire whose landings are no hazard until the ball is down is caught leaving the companion under it',
    describe(blind),
  );
  const deepest = companionDodgeRun((deps) => new DeepestZoneOnlyFireballSystem(deps), staying);
  report.checkCatches(
    dodged(deepest),
    "an escape out of only the deepest circle is caught walking the companion into the human's landing",
    describe(deepest),
  );
}

/**
 * The fairy's path, frame by frame, with the crawler walking in from past its
 * notice, run until `frames` have passed or, when `frames` is null, until the
 * throw plus the frames watched after it.
 */
function pathWhileApproached(
  make: FireFairyFactory,
  frames: number | null,
): { thrown: number; path: readonly Point[] } {
  return withDodgesOff(() => {
    const s = fireStage({ make, targetTileX: APPROACH_START_TILE_X });
    const stopPx = TILE_SIZE * APPROACH_STOP_TILES;
    let thrown = -1;
    const lastFrame = (): number => {
      if (frames !== null) return frames;
      return thrown < 0 ? THROW_LIMIT_FRAMES : thrown + MOVING_AFTER_THROW_FRAMES;
    };
    while (s.path.length <= lastFrame()) {
      const thrownBefore = s.fairy.thrown.length;
      s.step(s.pm.human.x - s.fairy.x > stopPx ? WALK_WEST : null);
      if (thrown < 0 && s.fairy.thrown.length > thrownBefore) thrown = s.path.length - 1;
    }
    return { thrown, path: s.path };
  });
}

/**
 * How a fairy's path around its first throw compares with a never-throwing
 * twin's under the same approach: the largest gap between them, and whether it
 * moved on the frame it threw.
 */
function movementAroundThrow(make: FireFairyFactory): {
  thrown: number;
  movedOnThrow: boolean;
  largestGapPx: number;
} {
  const casting = pathWhileApproached(make, null);
  const lastFrame = casting.path.length - 1;
  const mute = pathWhileApproached((x, y) => new MuteFireFairy(x, y, TILE_SIZE), lastFrame);
  let largestGapPx = 0;
  const firstWatched = Math.max(0, casting.thrown - MOVING_BEFORE_THROW_FRAMES);
  for (let frame = firstWatched; frame <= lastFrame; frame++) {
    const own = itemAt(casting.path, frame);
    const twin = itemAt(mute.path, frame);
    if (own === undefined || twin === undefined) continue;
    largestGapPx = Math.max(largestGapPx, Math.hypot(own.x - twin.x, own.y - twin.y));
  }
  const before = itemAt(casting.path, casting.thrown - 1);
  const after = itemAt(casting.path, casting.thrown);
  const movedOnThrow =
    before !== undefined &&
    after !== undefined &&
    Math.hypot(after.x - before.x, after.y - before.y) >= MOVE_EPSILON_PX;
  return { thrown: casting.thrown, movedOnThrow, largestGapPx };
}

function checkMovesWhileThrowing(report: FairyGateReport): void {
  const window = `${MOVING_BEFORE_THROW_FRAMES} frames before the throw to ${MOVING_AFTER_THROW_FRAMES} after`;
  const moves = (run: ReturnType<typeof movementAroundThrow>): boolean =>
    run.thrown > MOVING_BEFORE_THROW_FRAMES &&
    run.movedOnThrow &&
    run.largestGapPx < MOVE_EPSILON_PX;
  const real = movementAroundThrow(realFireFairy);
  report.check(
    moves(real),
    `the fire fairy throws on the move, and from ${window} flies exactly as a fairy that never throws`,
    real.thrown < 0
      ? 'never threw'
      : `thrown on frame ${real.thrown}, moved ${real.movedOnThrow}, gap ${real.largestGapPx.toFixed(DECIMALS)} px`,
  );
  const still = movementAroundThrow((x, y) => new StillCastingFireFairy(x, y, TILE_SIZE));
  report.checkCatches(
    moves(still),
    'a fairy that holds its place while it throws is caught standing still',
    `moved ${still.movedOnThrow}, gap ${still.largestGapPx.toFixed(DECIMALS)} px`,
  );
}

/**
 * A fairy set on the crawler from the first frame (`forceAggro`), held in
 * place so its positioning cannot close the range or round the wall, and
 * watched for a throw. `noticedThroughout` proves the throw was refused by
 * `lobAt`'s own guards rather than never considered.
 */
function refusalRun(
  make: FireFairyFactory,
  setup: 'walled' | 'beyond range',
): { noticedThroughout: boolean; threw: boolean } {
  const wallColumn = FAIRY_TILE_X + WALL_COLUMN_OFFSET_TILES;
  const s = fireStage({ make, wallColumn: setup === 'walled' ? wallColumn : undefined });
  if (setup === 'beyond range') {
    const beyondRange = FAIRY_TILE_X + Math.ceil(FIREBALL_MAX_RANGE_TILES) + PAST_RANGE_TILES;
    placeOnTile(s.pm.human, beyondRange, FAIRY_TILE_Y);
  }
  s.fairy.forceAggro = true;
  let noticedThroughout = true;
  let threw = false;
  for (let n = 0; n < REFUSAL_FRAMES; n++) {
    placeOnTile(s.fairy, FAIRY_TILE_X, FAIRY_TILE_Y);
    s.step(null);
    if (s.fairy.currentTarget !== s.pm.human) noticedThroughout = false;
    if (s.fairy.activeCast !== null || s.fireballs.liveCharges.length > 0) threw = true;
  }
  return { noticedThroughout, threw };
}

function checkRefusals(report: FairyGateReport): void {
  const sealed = refusalRun(realFireFairy, 'walled');
  report.check(
    sealed.noticedThroughout && !sealed.threw,
    'no throw goes through a wall at a crawler the fairy is fighting',
  );
  const sightBlind = refusalRun((x, y) => new SightBlindFireFairy(x, y, TILE_SIZE), 'walled');
  report.checkCatches(
    sightBlind.noticedThroughout && !sightBlind.threw,
    'a fairy that throws without checking sight is caught throwing through the wall',
  );

  const far = refusalRun(realFireFairy, 'beyond range');
  report.check(
    far.noticedThroughout && !far.threw,
    'no throw goes beyond FIREBALL_MAX_RANGE_TILES at a crawler the fairy is fighting',
  );
  const rangeBlind = refusalRun((x, y) => new RangeBlindFireFairy(x, y, TILE_SIZE), 'beyond range');
  report.checkCatches(
    rangeBlind.noticedThroughout && !rangeBlind.threw,
    'a fairy that throws without checking range is caught throwing out of range',
  );
}

function checkFuseAndDeathFlame(report: FairyGateReport): void {
  withDodgesOff(() => {
    const s = fireStage();
    let landed = -1;
    let exploded = -1;
    for (let n = 1; n <= CHARGE_LIMIT_FRAMES && exploded < 0; n++) {
      const before = s.fireballs.liveCharges.length;
      s.step(null);
      if (landed < 0 && before === 0 && s.fireballs.liveCharges.length === 1) landed = n;
      if (landed > 0 && before === 1 && s.fireballs.liveCharges.length === 0) exploded = n;
    }
    report.check(
      landed > 0 && exploded - landed === FIREBALL_FUSE_FRAMES,
      `a landed charge goes off ${FIREBALL_FUSE_FRAMES} frames later`,
      `${exploded - landed}`,
    );
  });

  // One roll for every draw, above the crawler's dodge chance and under the
  // burn chance: every blow connects, and any burn rolled at all lands.
  const dodgeChance = new HumanPlayer(FAIRY_TILE_X, FAIRY_TILE_Y, TILE_SIZE).dodgeChance;
  const burnLandingRoll = (dodgeChance + FIREBALL_BURN_CHANCE) / 2;
  report.precondition(
    dodgeChance < FIREBALL_BURN_CHANCE,
    'a roll exists that no dodge reaches and every burn chance does',
    `dodge ${dodgeChance.toFixed(DECIMALS_FINE)}, burn ${FIREBALL_BURN_CHANCE}`,
  );
  const random = Math.random;
  Math.random = () => burnLandingRoll;
  try {
    const s = fireStage();
    placeOnTile(s.pm.human, FAIRY_TILE_X, FAIRY_TILE_Y);
    s.kill(s.fairy);
    let damaged = false;
    let burned = false;
    let exploded = -1;
    for (let n = 1; n <= DEATH_FLAME_FRAMES * DEATH_FLAME_WATCH_SPANS && exploded < 0; n++) {
      const flamesBefore = s.fireballs.liveFlames.length;
      const hpBefore = s.pm.human.hp;
      s.pm.human.invulnerableFrames = 0;
      s.fireballs.update(s.ctx());
      if (n < DEATH_FLAME_FRAMES && s.pm.human.hp < hpBefore) damaged = true;
      if (s.pm.human.hasStatus('burn')) burned = true;
      if (flamesBefore > 0 && s.fireballs.liveFlames.length === 0) exploded = n;
    }
    report.check(damaged, 'the death flame damages a crawler standing in it');
    report.check(!burned, 'the death flame never sets the crawler alight');
    report.check(
      exploded === DEATH_FLAME_FRAMES,
      `the mini-explosion fires ${DEATH_FLAME_FRAMES} frames after the death`,
      `${exploded}`,
    );

    const blast = fireStage();
    let blastBurned = false;
    for (let n = 1; n <= CHARGE_LIMIT_FRAMES && !blastBurned; n++) {
      blast.step(null);
      if (blast.pm.human.hasStatus('burn')) blastBurned = true;
    }
    report.checkCatches(
      !blastBurned,
      "under the same rolls, a charge's blast (which may burn) is caught setting the crawler alight",
    );
  } finally {
    Math.random = random;
  }
}

interface FrozenRun {
  readonly escaped: boolean;
  readonly margin: number;
  readonly froze: boolean;
  readonly chilledAtThaw: boolean;
}

/**
 * A crawler waits out of the fairy's notice for {@link FREEZE_LEAD_IN_FRAMES},
 * then stands still in its range; the ball lands under it, and it is frozen
 * `offset` frames from the landing (negative: already frozen when it lands). From the landing on it presses east every frame through the real
 * movement code, which the freeze blocks until the thaw. With `rechill`, a
 * bolt in the freeze grace re-chills it the frame it thaws, so it walks out at
 * the chilled pace.
 */
function frozenOnCharge(
  frozenFrames: number,
  offset: number,
  landFrame: number | null,
  rechill: boolean,
): FrozenRun & { landFrameSeen: number } {
  return withDodgesOff(() => {
    const s = fireStage();
    const human = s.pm.human;
    placeOnTile(human, PARK_TILE, PARK_TILE);
    let landed = false;
    let froze = false;
    const freeze = (): void => {
      applyIceHit(human);
      applyIceHit(human, { frozenFrames });
      froze = human.hasStatus(FROZEN_STATUS);
    };
    let landFrameSeen = -1;
    let chargeCentre = { x: NaN, y: NaN };
    let wasFrozen = false;
    let chilledAtThaw = false;
    for (let n = 1; n <= CHARGE_LIMIT_FRAMES; n++) {
      const before = s.fireballs.liveCharges.length;
      if (n === FREEZE_LEAD_IN_FRAMES) placeOnTile(human, TARGET_TILE_X, FAIRY_TILE_Y);
      if (landFrame !== null && offset !== 0 && n === landFrame + offset) freeze();
      const hpBefore = human.hp;
      s.step(landed ? WALK_EAST : null);
      const frozenNow = human.hasStatus(FROZEN_STATUS);
      if (wasFrozen && !frozenNow) {
        chilledAtThaw = human.hasStatus(CHILLED_STATUS);
        if (rechill) applyIceHit(human);
      }
      wasFrozen = frozenNow;
      if (!landed && before === 0 && s.fireballs.liveCharges.length === 1) {
        landed = true;
        landFrameSeen = n;
        const charge = s.fireballs.liveCharges[0];
        chargeCentre = { x: charge.x, y: charge.y };
        const centre = centreOf(human);
        if (Math.hypot(centre.x - charge.x, centre.y - charge.y) > UNDERFOOT_PX) {
          throw new Error('the crawler is not standing on its charge');
        }
        if (offset === 0) freeze();
        continue;
      }
      if (landed && before === 1 && s.fireballs.liveCharges.length === 0) {
        const centre = centreOf(human);
        const distance = Math.hypot(centre.x - chargeCentre.x, centre.y - chargeCentre.y);
        return {
          escaped: distance > BLAST_PX && human.hp === hpBefore,
          margin: distance - BLAST_PX,
          froze,
          chilledAtThaw,
          landFrameSeen,
        };
      }
    }
    return { escaped: false, margin: -Infinity, froze, chilledAtThaw, landFrameSeen };
  });
}

/** Every freeze timing from already-frozen at the landing to frozen as the walk-out would end. */
function freezeSweep(frozenFrames: number, rechill: boolean) {
  const walkOut = Math.ceil(BLAST_PX / (PLAYER_SPEED * CHILLED_MOVE_SPEED_FACTOR));
  const probe = frozenOnCharge(frozenFrames, 0, null, rechill);
  let runs = 0;
  let escapedAll = true;
  let frozeAll = true;
  let anyChilledAtThaw = false;
  let worstMargin = Infinity;
  for (let offset = -frozenFrames; offset <= walkOut; offset++) {
    const run = frozenOnCharge(frozenFrames, offset, probe.landFrameSeen, rechill);
    if (run.landFrameSeen !== probe.landFrameSeen) throw new Error('the landing frame drifted');
    runs++;
    escapedAll &&= run.escaped;
    frozeAll &&= run.froze;
    anyChilledAtThaw ||= run.chilledAtThaw;
    worstMargin = Math.min(worstMargin, run.margin);
  }
  return { runs, escapedAll, frozeAll, anyChilledAtThaw, worstMargin };
}

function checkFreezeNeverGuaranteesBlast(report: FairyGateReport): void {
  const chilledWalkOut = Math.ceil(BLAST_PX / (PLAYER_SPEED * CHILLED_MOVE_SPEED_FACTOR));
  report.check(
    FROZEN_FRAMES + chilledWalkOut < FIREBALL_FUSE_FRAMES,
    'FROZEN_FRAMES + ceil(blast radius / chilled walk speed) < FIREBALL_FUSE_FRAMES',
    `${FROZEN_FRAMES} + ${chilledWalkOut} vs ${FIREBALL_FUSE_FRAMES}`,
  );
  const thawed = freezeSweep(FROZEN_FRAMES, false);
  report.check(
    thawed.frozeAll && !thawed.anyChilledAtThaw,
    'every run really froze the crawler, and the thaw leaves it un-chilled',
  );
  report.check(
    thawed.escapedAll,
    'a crawler frozen on a landed charge always walks out before the blast',
    `${thawed.runs} freeze timings, worst margin ${thawed.worstMargin.toFixed(DECIMALS)} px`,
  );
  const rechilled = freezeSweep(FROZEN_FRAMES, true);
  report.check(
    rechilled.frozeAll && rechilled.escapedAll,
    'it still walks out when a bolt re-chills it the frame it thaws',
    `${rechilled.runs} freeze timings, worst margin ${rechilled.worstMargin.toFixed(DECIMALS)} px`,
  );
  const overFuse = freezeSweep(FIREBALL_FUSE_FRAMES + OVER_FUSE_MARGIN_FRAMES, false);
  report.checkCatches(
    overFuse.escapedAll,
    'a freeze lengthened past the fuse is caught leaving the crawler in the blast',
    `worst margin ${overFuse.worstMargin.toFixed(DECIMALS)} px`,
  );
}

/** Mongo's pet level for the ally runs: the youngest, slowest raptor. */
const ALLY_MONGO_LEVEL = 1;
/**
 * Where an ally stands for the twin lob: its centre a quarter-tile along the
 * line from the cat's landing towards the human's, deep inside both circles
 * and off the exact midpoint, where the two pushes cancel outright.
 */
const ALLY_OFFSET_TILES = 0.25;
const ALLY_TILE_X = COMPANION_CAT_TILE_X + ALLY_OFFSET_TILES;

/**
 * Whether the ally also stands a quarter-tile south of the line between the
 * landings, or exactly on it. On it, both circles push along that line, so
 * their sum points at the balance point between them rather than out of
 * either: a body that only follows the sum slides there and shakes in place.
 */
type AllyPlacement = 'beside the line' | 'on the line';

const ALLY_TILE_Y: Record<AllyPlacement, number> = {
  'beside the line': FAIRY_TILE_Y + ALLY_OFFSET_TILES,
  'on the line': FAIRY_TILE_Y,
};

/** How far apart the twin lob's two landings come down: the cat and the human stand a tile apart. */
const LANDING_SPACING_TILES = TARGET_TILE_X - COMPANION_CAT_TILE_X;

/**
 * A fire fairy whose one cast brings two balls down on the cat's row either
 * side of her, spaced and offset exactly as the twin lob's landings sit around
 * an ally: the one way to put the AI cat, whom the real lob aims at, on the
 * line between two landings rather than on one.
 */
class FlankingFireFairy extends WatchedFireFairy {
  private cat: Player | null = null;

  override updateAI(targets: Player[]): void {
    this.cat = targets.find((target) => target instanceof CatPlayer) ?? null;
    super.updateAI(targets);
  }

  protected override chooseCast(): FairyCastIntent | null {
    const cat = this.cat;
    if (cat === null || !cat.isAlive || !this.isCastReady(FIREBALL_CAST)) return null;
    return lobIntent(cat);
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    if (cast.cast.id !== FIREBALL_CAST.id) return;
    const from = this.groundCentre;
    const nearOffsetPx = -TILE_SIZE * ALLY_OFFSET_TILES;
    const farOffsetPx = nearOffsetPx + TILE_SIZE * LANDING_SPACING_TILES;
    for (const offsetPx of [nearOffsetPx, farOffsetPx]) {
      this.queueFireball({
        fromX: from.x,
        fromY: from.y,
        toX: cast.aimX + offsetPx,
        toY: cast.aimY,
        damage: FIREBALL_DAMAGE,
        burstDamage: FIREBALL_BLAST_DAMAGE,
      });
    }
  }
}

const flankingFireFairy: FireFairyFactory = (x, y) => new FlankingFireFairy(x, y, TILE_SIZE);

/**
 * Walls along both sides of the fairy's row, border to border: a one-tile
 * corridor through both landings, where the only way out of them is along the
 * line between them.
 */
function corridorWalls(): TileSpec[] {
  const walls: TileSpec[] = [];
  for (let x = 1; x < ARENA_TILES - 1; x++) {
    walls.push([x, FAIRY_TILE_Y - 1], [x, FAIRY_TILE_Y + 1]);
  }
  return walls;
}
/**
 * The mob a fighting ally is set on: midway between the two landings, deep in
 * both circles and further from either rim than a bite reaches, so a melee
 * ally can only reach it by stepping back onto marked ground.
 */
const HALFWAY_BETWEEN_LANDINGS_TILES = (TARGET_TILE_X - COMPANION_CAT_TILE_X) / 2;
const ALLY_FOE_TILE_X = COMPANION_CAT_TILE_X + HALFWAY_BETWEEN_LANDINGS_TILES;
const ALLY_FOE_TILE_Y = FAIRY_TILE_Y;
/** HP enough that no ally's blows end the fight before the charges go off. */
const ALLY_FOE_HP = 100_000;

/** One of each kind of ally ranged over for the corridor and the broken-escape runs. */
const CORRIDOR_ALLY_KINDS = ['Mongo', 'sledge'] as const;

/** What an ally is doing when the balls are thrown. */
type AllyStance = 'following' | 'fighting';

/** Which ally stands on the landings. */
type AllyKind = 'Mongo' | MercenaryTemplateId;

/** Mongo who walks wherever his follow and his fight take him, marked ground or not. */
class HazardBlindMongo extends Mongo {
  protected override get avoidsMarkedGround(): boolean {
    return false;
  }
}

/** A hireling who walks wherever its follow and its fight take it, marked ground or not. */
class HazardBlindMercenary extends Mercenary {
  protected override get avoidsMarkedGround(): boolean {
    return false;
  }
}

/** Mongo who flees marked ground he stands on but will step back onto it. */
class FleeOnlyMongo extends Mongo {
  protected override get avoidsMarkedGround(): boolean {
    return isMarkedGround(this.x, this.y);
  }
}

/** A hireling who flees marked ground it stands on but will step back onto it. */
class FleeOnlyMercenary extends Mercenary {
  protected override get avoidsMarkedGround(): boolean {
    return isMarkedGround(this.x, this.y);
  }
}

/**
 * How much of the marked-ground rule an ally keeps: all of it, none, or the
 * flee without the refusal to step back in.
 */
type AllyAvoidance = 'real' | 'blind' | 'flee only';

/**
 * Builds an ally the way its system does — Mongo at full health for his
 * level, owned by the cat; a hireling owned by the human — and places it.
 */
function makeAlly(
  kind: AllyKind,
  avoidance: AllyAvoidance,
  human: Player,
  cat: Player,
): Mongo | Mercenary {
  if (kind === 'Mongo') {
    const probe = new Mongo(0, 0, TILE_SIZE, cat, ALLY_MONGO_LEVEL, 1);
    const makers = { real: Mongo, blind: HazardBlindMongo, 'flee only': FleeOnlyMongo } as const;
    return new makers[avoidance](0, 0, TILE_SIZE, cat, ALLY_MONGO_LEVEL, probe.maxHp);
  }
  const name = getMercenaryTemplate(kind).name;
  const makers = {
    real: Mercenary,
    blind: HazardBlindMercenary,
    'flee only': FleeOnlyMercenary,
  } as const;
  return new makers[avoidance](0, 0, TILE_SIZE, human, kind, name);
}

interface AllySetup {
  readonly placement: AllyPlacement;
  readonly corridor: boolean;
  readonly fireballs: FireballsFactory;
}

interface AllyDodgeRun {
  /** Frames from the throw until the ally stood outside every blast circle; -1 if never. */
  readonly clearedAfter: number;
  readonly flightFrames: number;
  readonly reentered: boolean;
  /**
   * Whether, once off the marked ground (the blast plus its clearance), the
   * ally ever stepped back onto it: the flee and the follow taking turns on
   * the rim, which the clearance hides from the blast but not from the eye.
   */
  readonly reenteredMarked: boolean;
  readonly hurt: boolean;
  readonly twoBalls: boolean;
  /** Whether the ally ever had the planted mob as its fight. */
  readonly engagedFoe: boolean;
}

/**
 * The human and the cat a tile apart in the fairy's range, standing still; the
 * fairy lobs at both, and the ally stands in the overlap of the two landings.
 * Each frame runs in `DungeonScene`'s order: `MobUpdateLoop` publishes the
 * fire as marked ground and ticks the ally, then the fairy acts and the fire
 * system lands its balls on the whole party, the ally included.
 */
function allyDodgeRun(
  kind: AllyKind,
  stance: AllyStance,
  avoidance: AllyAvoidance,
  setup: Partial<AllySetup> = {},
): AllyDodgeRun {
  return withDodgesOff(() => {
    const walls = setup.corridor === true ? corridorWalls() : [];
    const s = fireStage({ fireballs: setup.fireballs, walls });
    const { human, cat } = s.pm;
    placeOnTile(cat, COMPANION_CAT_TILE_X, FAIRY_TILE_Y);
    cat.setBaseStat('constitution', DURABLE_CONSTITUTION);
    cat.hp = cat.maxHp;
    const ally = makeAlly(kind, avoidance, human, cat);
    ally.setMap(s.map);
    placeOnTile(ally, ALLY_TILE_X, ALLY_TILE_Y[setup.placement ?? 'beside the line']);
    if (ally instanceof Mercenary) ally.allies = [human, cat];
    if (stance === 'fighting') {
      const foe = createMob('goblin', ALLY_FOE_TILE_X, ALLY_FOE_TILE_Y, s.map);
      foe.hp = ALLY_FOE_HP;
      foe.aiHeld = true;
      ally.allMobs = [foe];
    }
    const foe = itemAt(ally.allMobs, 0) ?? null;
    const party: Player[] = [human, cat, ally];
    const insideAnyCircle = (): boolean => {
      const centre = centreOf(ally);
      const within = (x: number, y: number): boolean =>
        Math.hypot(centre.x - x, centre.y - y) <= BLAST_PX;
      return (
        s.fireballs.liveFireballs.some((ball) => within(ball.toX, ball.toY)) ||
        s.fireballs.liveCharges.some((charge) => within(charge.x, charge.y))
      );
    };
    let thrownFrame = -1;
    let landedFrame = -1;
    let clearedFrame = -1;
    let reentered = false;
    let offMarked = false;
    let reenteredMarked = false;
    let hurt = false;
    let twoBalls = false;
    let engagedFoe = false;
    try {
      for (let n = 1; n <= CHARGE_LIMIT_FRAMES; n++) {
        human.invulnerableFrames = 0;
        cat.invulnerableFrames = 0;
        ally.invulnerableFrames = 0;
        const hpBefore = ally.hp;
        const flyingBefore = s.fireballs.liveFireballs.length;
        setMarkedGroundSources([s.fireballs]);
        ally.updateAI(party);
        const fightingFoe = ally instanceof Mongo ? ally.engagedTarget === foe : ally.isFighting;
        if (foe !== null && fightingFoe) engagedFoe = true;
        s.fairy.updateAI(party);
        s.fireballs.update({ ...s.ctx(), extraTargets: [ally] });
        human.tickTimers();
        cat.tickTimers();
        if (ally.hp < hpBefore) hurt = true;
        if (thrownFrame < 0 && s.fairy.thrown.length > 0) {
          thrownFrame = n;
          twoBalls = s.fairy.thrown.length === 2;
        }
        if (thrownFrame < 0) continue;
        if (landedFrame < 0 && flyingBefore > 0 && s.fireballs.liveFireballs.length === 0) {
          landedFrame = n;
        }
        const inside = insideAnyCircle();
        if (clearedFrame < 0 && !inside) clearedFrame = n;
        else if (clearedFrame > 0 && inside) reentered = true;
        const onMarked = s.fireballs.getHazardEscapeVector(ally.x, ally.y) !== null;
        if (!onMarked) offMarked = true;
        else if (offMarked) reenteredMarked = true;
        const resolved =
          landedFrame > 0 &&
          s.fireballs.liveFireballs.length === 0 &&
          s.fireballs.liveCharges.length === 0;
        if (resolved) break;
      }
    } finally {
      setMarkedGroundSources([]);
    }
    return {
      clearedAfter: clearedFrame < 0 ? -1 : clearedFrame - thrownFrame,
      flightFrames: landedFrame - thrownFrame,
      reentered,
      reenteredMarked,
      hurt,
      twoBalls,
      engagedFoe,
    };
  });
}

function checkAlliesDodge(report: FairyGateReport): void {
  const dodged = (run: AllyDodgeRun): boolean =>
    run.clearedAfter >= 0 &&
    run.clearedAfter < run.flightFrames &&
    !run.reentered &&
    !run.reenteredMarked &&
    !run.hurt;
  const describe = (run: AllyDodgeRun): string =>
    `clear ${run.clearedAfter} frames after the throw, landing at ${run.flightFrames}, re-entered ${run.reentered}, back on marked ground ${run.reenteredMarked}, hurt ${run.hurt}`;
  const kinds: readonly AllyKind[] = ['Mongo', ...MERCENARY_TEMPLATE_IDS];
  const placements: readonly AllyPlacement[] = ['beside the line', 'on the line'];
  for (const placement of placements) {
    for (const kind of kinds) {
      for (const stance of ['following', 'fighting'] as const) {
        const real = allyDodgeRun(kind, stance, 'real', { placement });
        const staged = `${kind} (${stance}, ${placement})`;
        report.precondition(
          real.twoBalls,
          `the fairy lobs at both crawlers with ${staged} between them`,
        );
        const picksNoFights = kind !== 'Mongo' && getMercenaryTemplate(kind).kit === 'medic';
        if (stance === 'fighting' && picksNoFights) {
          report.notApplicable(
            `${staged} takes on the mob planted in the circle`,
            'a medic never picks a fight; it is still staged beside one',
          );
        } else if (stance === 'fighting') {
          report.precondition(real.engagedFoe, `${staged} takes on the mob planted in the circle`);
        }
        report.check(
          dodged(real),
          `${staged} on the twin landings leaves every circle before the balls come down, stays out until the charges go off, and takes no hit`,
          describe(real),
        );
      }
    }
  }
  for (const kind of CORRIDOR_ALLY_KINDS) {
    for (const stance of ['following', 'fighting'] as const) {
      const corridor = allyDodgeRun(kind, stance, 'real', {
        placement: 'on the line',
        corridor: true,
      });
      report.precondition(
        corridor.twoBalls,
        `the fairy lobs at both crawlers down a one-tile corridor with ${kind} (${stance}) between them`,
      );
      if (stance === 'fighting') {
        report.precondition(
          corridor.engagedFoe,
          `${kind} takes on the mob planted in the circle down a one-tile corridor`,
        );
      }
      report.check(
        dodged(corridor),
        `${kind} (${stance}) on the line between the twin landings in a one-tile corridor leaves along it, stays out, and takes no hit`,
        describe(corridor),
      );
    }
  }
  for (const kind of CORRIDOR_ALLY_KINDS) {
    for (const corridor of [false, true]) {
      const where = corridor ? 'in a one-tile corridor' : 'in the open';
      const summedOnly = allyDodgeRun(kind, 'following', 'real', {
        placement: 'on the line',
        corridor,
        fireballs: (deps) => new SummedPushOnlyFireballSystem(deps),
      });
      report.checkCatches(
        dodged(summedOnly),
        `fire that only sums the circles' pushes is caught holding ${kind} on the line between the landings ${where}`,
        describe(summedOnly),
      );
    }
  }
  for (const kind of ['Mongo', 'sledge'] as const) {
    for (const stance of ['following', 'fighting'] as const) {
      const blind = allyDodgeRun(kind, stance, 'blind');
      report.checkCatches(
        dodged(blind),
        `${kind} (${stance}) with no marked-ground avoidance is caught standing under the landings`,
        describe(blind),
      );
      // Only the fight is run without the refusal: both follow bands stop an
      // ally further from its crawler than a blast circle reaches, so a
      // following ally never asks to step back in and the refusal is not
      // what keeps it out.
      if (stance !== 'fighting') continue;
      const fleeOnly = allyDodgeRun(kind, stance, 'flee only');
      report.checkCatches(
        dodged(fleeOnly),
        `${kind} (${stance}) that flees but may step back in is caught stepping back onto marked ground`,
        describe(fleeOnly),
      );
    }
  }
}

export function verifyFireFairy(report: FairyGateReport): void {
  report.section('Fire fairy');
  checkThrow(report);
  checkFlightOutlastsTheDodge(report);
  checkLandingDangerCircle(report);
  checkTwinLob(report);
  checkCompanionDodges(report);
  checkAlliesDodge(report);
  checkMovesWhileThrowing(report);
  checkRefusals(report);
  checkFuseAndDeathFlame(report);
  checkFreezeNeverGuaranteesBlast(report);
}
