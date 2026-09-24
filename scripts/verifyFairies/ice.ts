/**
 * The ice fairy and the frost it leaves, through its real AI, the real
 * `FairySystem` that flies its bolts, the real crawler timers and the real
 * companion AI.
 *
 * - A bolt is loosed at the crawler's centre with no lead and flies dead
 *   straight, at a speed under the crawler's that no level raises: a crawler
 *   standing still is hit, one that sidesteps or keeps running across its path
 *   from casting range is not.
 * - The bolt stops at the first wall, passes through hostile mobs, and still
 *   lands after the fairy that loosed it has died.
 * - Hit 1 chills; hit 2 inside the chill freezes, and a lone fairy's second
 *   bolt comes back inside its own chill at level 1 and the maximum; a hit in
 *   the freeze grace only chills. Mongo and the hirelings are only chilled.
 * - Ice-resistant gear halves the bolt's damage and the freeze.
 * - The fairy never stands still to fire.
 * - Its death blast refreshes a chill and never freezes or damages.
 * - A frozen AI companion does not move, a frozen crawler lands no swing, and
 *   a chilled crawler's attack cadence slows to the chilled action speed.
 * - A swing or smush already under way when the freeze lands never lands,
 *   and the attack key neither swings nor turns a frozen crawler.
 *
 * Where a rule needs a bolt that breaks it, a probe flies the fairy's own
 * loosed bolt in place of `FairyIceBolts`, with one rule of its flight
 * changed; a faithful probe is first shown to reproduce the real bolt.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import {
  CHILLED_STATUS,
  FROZEN_STATUS,
  makeChilled,
  makeFrozen,
} from '../../src/core/StatusEffect';
import { applyChillOnly, applyIceHit } from '../../src/core/frostStatus';
import {
  CHILLED_ACTION_SPEED_FACTOR,
  CHILLED_FRAMES,
  FROZEN_FRAMES,
} from '../../src/core/statusTuning';
import type { ResistanceType } from '../../src/core/ItemDefs';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { Mob } from '../../src/creatures/Mob';
import { Mongo } from '../../src/creatures/Mongo';
import { triggerPlayerAttack } from '../../src/systems/GameLoopPhases';
import {
  IceFairy,
  ICE_BOLT_ATTACK_TYPE,
  type PendingIceBolt,
} from '../../src/creatures/fairies/IceFairy';
import type { FairyCast } from '../../src/creatures/fairies/Fairy';
import {
  FAIRY_CAST_RECOVER_FRAMES,
  FAIRY_NOTICE_RANGE_TILES,
  ICE_BOLT_HIT_RADIUS_PX,
  ICE_BOLT_MAX_TRAVEL_TILES,
  ICE_BOLT_RANGE_TILES,
  ICE_BOLT_SPEED,
  ICE_BOLT_SPEED_FRACTION_OF_PLAYER,
  ICE_PREFERRED_RANGE_TILES,
} from '../../src/creatures/fairies/fairyTuning';
import { projectileSpeedScaleForLevel } from '../../src/creatures/mobLevelScaling';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import type { GameMap } from '../../src/map/GameMap';
import { RESISTED_DAMAGE_FRACTION, type DamageSource, type Player } from '../../src/Player';
import { causeFromDamageSource } from '../../src/systems/DeathCauseSystem';
import { CompanionSystem } from '../../src/systems/CompanionSystem';
import type { FairyGateReport } from './report';
import { buildStage, centreOf, placeOnTile, withDodgesOff, type TileSpec } from './stage';

type Point = { x: number; y: number };

/** The entry at `index`, or undefined past either end. */
function itemAt<T>(list: readonly T[], index: number): T | undefined {
  return index >= 0 && index < list.length ? list[index] : undefined;
}

const FAIRY_TILE = 10;
/** The crawler's column at the fairy's preferred range and at its farthest shot, both on its row. */
const PREFERRED_TARGET_TILE_X = FAIRY_TILE + ICE_PREFERRED_RANGE_TILES;
const FARTHEST_TARGET_TILE_X = FAIRY_TILE + ICE_BOLT_RANGE_TILES;
/** Frames any one staged run is granted. */
const RUN_LIMIT_FRAMES = 900;
/**
 * The way a dodging crawler moves: south, square across a bolt fired along the
 * fairy's row, toward the open middle of the arena.
 */
const DODGE_DIRECTION: Point = { x: 0, y: 1 };
/** How far a sidestepping crawler steps before standing still again. */
const SIDESTEP_TILES = 1;
/** A bolt half again as fast as the crawler: over the cap by a clear margin. */
const OVER_CAP_SPEED_FRACTION = 1.5;
/** Slack for floating-point sums in a per-frame distance. */
const SPEED_EPSILON_PX = 1e-6;
/** Largest dot product between a fired heading and the dodge that still counts as square across it. */
const SQUARE_ACROSS_TOLERANCE = 1e-9;
/** The wall a bolt must stop at, the crawler it is fired at, and the one behind the wall. */
const BOLT_WALL_X = 16;
const IN_FRONT_OF_WALL_X = 14;
const BEHIND_WALL_X = 18;
/** Rows the fired-at crawler steps off the line, so the bolt flies on to the wall. */
const OFF_THE_LINE_ROWS = 2;
/** Where a body stands on the fairy's row between it and the crawler it fires at. */
const IN_THE_LINE_X = 12;
const MONGO_LEVEL = 1;
const MONGO_STARTING_HP = 200;
/** Bolts at Mongo that prove a second one never freezes him. */
const MONGO_HITS_WANTED = 2;
/** Hits in the chill, freeze, grace sequence: chill, freeze, then one inside the grace. */
const SEQUENCE_HITS = 3;
/** The hit in that sequence that freezes. */
const FREEZING_HIT = 2;
/** Where an approaching crawler starts: a tile past the fairy's notice. */
const APPROACH_START_TILE_X = FAIRY_TILE + FAIRY_NOTICE_RANGE_TILES + 1;
/** An approaching crawler stops this close, so it never walks through the fairy. */
const APPROACH_STOP_TILES = 2;
/** Frames watched before and after a shot for the fairy standing still. */
const MOVING_BEFORE_SHOT_FRAMES = 4;
const MOVING_AFTER_SHOT_FRAMES = FAIRY_CAST_RECOVER_FRAMES + 1;
/** Frames a cadence is sampled over when the attack speed of a chilled crawler is compared. */
const CADENCE_FRAMES = 1200;
/** Slack on the chilled cadence ratio, for the whole swings a window cuts off. */
const CADENCE_TOLERANCE = 0.05;
/** How far the companion is left from the active crawler: past its follow distance. */
const COMPANION_GAP_TILES = 8;
/** Frames the companion is watched: inside one freeze. */
const COMPANION_WATCH_FRAMES = FROZEN_FRAMES - 1;
/** Movement under this many pixels is not a step. */
const MOVE_EPSILON_PX = 0.01;
/** Half-freeze divisor for ice-resistant gear. */
const RESIST_DIVISOR = 2;
/** Frames a chill is left with before the death blast refreshes it. */
const NEARLY_THAWED_FRAMES = 10;
/** A tile off the fairy: inside its death blast, and a diagonal step off for the attack-key case. */
const ADJACENT_TILES = 1;
/** How many cadence windows a sampled chill or freeze outlasts, so it never thaws mid-sample. */
const FROST_OUTLASTS_CADENCE = 2;
const DECIMALS = 2;

/** A crawler whose gear resists ice. */
class IceProofHuman extends HumanPlayer {
  override resists(type: ResistanceType): boolean {
    return type === 'ice' || super.resists(type);
  }
}

/** Ice gear that takes nothing off the blow: the defect the damage half must catch. */
class DamageLeakingIceProofHuman extends IceProofHuman {
  override resistedDamage(amount: number, type: ResistanceType): number {
    return type === 'ice' ? amount : super.resistedDamage(amount, type);
  }
}

/** Ice gear that halves the blow but not the freeze: the defect the freeze half must catch. */
class FreezeLeakingIceProofHuman extends HumanPlayer {
  override resistedDamage(amount: number, type: ResistanceType): number {
    return type === 'ice'
      ? Math.max(0, Math.floor(amount * RESISTED_DAMAGE_FRACTION))
      : super.resistedDamage(amount, type);
  }
}

/** A crawler whose swing timers ignore the chill: the defect the cadence check must catch. */
class ChillBlindHuman extends HumanPlayer {
  override get actionSpeedMultiplier(): number {
    return 1;
  }
}

/**
 * The real ice fairy, with every bolt it looses noted as it is handed over.
 * With `swallowsBolts` the bolts go to a {@link ProbeBolts} instead of to
 * `FairyIceBolts`.
 */
class WatchedIceFairy extends IceFairy {
  readonly fired: PendingIceBolt[] = [];
  swallowsBolts = false;

  /** Gate subclasses name their blows as the ice fairy, the name the death screen reads. */
  override get mobType(): string {
    return IceFairy.name;
  }

  override takePendingIceBolts(): readonly PendingIceBolt[] {
    const taken = super.takePendingIceBolts();
    this.fired.push(...taken);
    return this.swallowsBolts ? [] : taken;
  }
}

/** An ice fairy whose bolt comes back no sooner than a whole chill after the last. */
class SluggishIceFairy extends WatchedIceFairy {
  protected override cooldownFramesFor(cast: FairyCast): number {
    return Math.max(super.cooldownFramesFor(cast), CHILLED_FRAMES);
  }
}

/** An ice fairy that holds its place for as long as a cast is being played. */
class StillCastingIceFairy extends WatchedIceFairy {
  override updateAI(targets: Player[]): void {
    const heldX = this.x;
    const heldY = this.y;
    super.updateAI(targets);
    if (this.activeCast === null) return;
    this.x = heldX;
    this.y = heldY;
  }
}

type IceFairyFactory = (tileX: number, tileY: number) => WatchedIceFairy;
const realIceFairy: IceFairyFactory = (x, y) => new WatchedIceFairy(x, y, TILE_SIZE);

/** How a probe bolt flies; {@link FAITHFUL_PROBE} flies the way `FairyIceBolts` does. */
interface ProbeRules {
  readonly speed: number;
  /** Re-aimed at this body's centre every frame. */
  readonly homesOn: Player | null;
  /** Aimed at launch where this body, moving at this velocity, will meet it. */
  readonly leads: { readonly body: Player; readonly velocity: Point } | null;
  readonly ignoresWalls: boolean;
  readonly diesWithOwner: boolean;
  readonly strikesHostiles: boolean;
  /** Lands a freezing hit on Mongo and the hirelings too. */
  readonly freezesEveryBody: boolean;
}

const FAITHFUL_PROBE: ProbeRules = {
  speed: ICE_BOLT_SPEED,
  homesOn: null,
  leads: null,
  ignoresWalls: false,
  diesWithOwner: false,
  strikesHostiles: false,
  freezesEveryBody: false,
};

interface ProbeBolt {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  travelled: number;
  readonly damage: number;
}

/**
 * The fairy's loosed bolts, flown by the gate under {@link ProbeRules}: the
 * same wall, body and travel tests in the same order as `FairyIceBolts`, and
 * the same blow and frost on whatever it meets.
 */
class ProbeBolts {
  private bolts: ProbeBolt[] = [];
  private launched = 0;

  constructor(
    private readonly rules: ProbeRules,
    private readonly owner: WatchedIceFairy,
    private readonly map: GameMap,
  ) {}

  get live(): readonly Point[] {
    return this.bolts.map((bolt) => ({ x: bolt.x, y: bolt.y }));
  }

  update(party: readonly Player[], mobs: readonly Mob[]): void {
    for (const loosed of this.owner.fired.slice(this.launched))
      this.bolts.push(this.launch(loosed));
    this.launched = this.owner.fired.length;
    this.bolts = this.bolts.filter((bolt) => this.fly(bolt, party, mobs));
  }

  private launch(loosed: PendingIceBolt): ProbeBolt {
    const bolt: ProbeBolt = {
      x: loosed.fromX,
      y: loosed.fromY,
      dirX: loosed.dirX,
      dirY: loosed.dirY,
      travelled: 0,
      damage: loosed.damage,
    };
    const leads = this.rules.leads;
    if (leads === null) return bolt;
    const meeting = interceptPoint(bolt, centreOf(leads.body), leads.velocity, this.rules.speed);
    if (meeting === null) return bolt;
    aimAt(bolt, meeting);
    return bolt;
  }

  /** One frame of flight; false once the bolt is done. */
  private fly(bolt: ProbeBolt, party: readonly Player[], mobs: readonly Mob[]): boolean {
    if (this.rules.diesWithOwner && !this.owner.isAlive) return false;
    const homesOn = this.rules.homesOn;
    if (homesOn !== null) aimAt(bolt, centreOf(homesOn));
    bolt.x += bolt.dirX * this.rules.speed;
    bolt.y += bolt.dirY * this.rules.speed;
    bolt.travelled += this.rules.speed;
    const tileX = Math.floor(bolt.x / TILE_SIZE);
    const tileY = Math.floor(bolt.y / TILE_SIZE);
    if (!this.rules.ignoresWalls && !this.map.isWalkable(tileX, tileY)) return false;
    const hostiles = this.rules.strikesHostiles
      ? mobs.filter((mob) => mob !== this.owner && mob.isHostile)
      : [];
    const struck = nearestWithin([...party, ...hostiles], bolt, ICE_BOLT_HIT_RADIUS_PX);
    if (struck !== null) {
      this.strike(bolt, struck);
      return false;
    }
    return bolt.travelled < TILE_SIZE * ICE_BOLT_MAX_TRAVEL_TILES;
  }

  private strike(bolt: ProbeBolt, target: Player): void {
    const source: DamageSource = {
      kind: 'mob',
      mobType: this.owner.mobType,
      attackType: ICE_BOLT_ATTACK_TYPE,
      from: { x: bolt.x, y: bolt.y },
    };
    const connected = target.takeDamage(target.resistedDamage(bolt.damage, 'ice'), source);
    if (!connected || !target.isAlive) return;
    if (target instanceof Mob && !this.rules.freezesEveryBody) applyChillOnly(target);
    else applyIceHit(target);
  }
}

function aimAt(bolt: ProbeBolt, point: Point): void {
  const dx = point.x - bolt.x;
  const dy = point.y - bolt.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  bolt.dirX = dx / distance;
  bolt.dirY = dy / distance;
}

/**
 * Where a shot at `speed` from `from` meets a body now at `at` moving at
 * `velocity`, or null when no such meeting exists: the positive root of
 * |at − from + velocity·t| = speed·t.
 */
function interceptPoint(from: Point, at: Point, velocity: Point, speed: number): Point | null {
  const relX = at.x - from.x;
  const relY = at.y - from.y;
  // a·t² + 2·halfB·t + c = 0, solved in its half-b form.
  const a = velocity.x * velocity.x + velocity.y * velocity.y - speed * speed;
  const halfB = relX * velocity.x + relY * velocity.y;
  const c = relX * relX + relY * relY;
  const roots: number[] = [];
  if (Math.abs(a) < SQUARE_ACROSS_TOLERANCE) {
    if (halfB !== 0) roots.push(-c / (halfB + halfB));
  } else {
    const discriminant = halfB * halfB - a * c;
    if (discriminant >= 0) {
      const sqrt = Math.sqrt(discriminant);
      roots.push((-halfB - sqrt) / a, (-halfB + sqrt) / a);
    }
  }
  const soonest = Math.min(...roots.filter((t) => t > 0));
  if (!Number.isFinite(soonest)) return null;
  return { x: at.x + velocity.x * soonest, y: at.y + velocity.y * soonest };
}

function nearestWithin(bodies: readonly Player[], point: Point, radius: number): Player | null {
  let nearest: Player | null = null;
  let nearestDistance = radius;
  for (const body of bodies) {
    if (!body.isAlive) continue;
    const centre = centreOf(body);
    const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
    if (distance > nearestDistance) continue;
    nearest = body;
    nearestDistance = distance;
  }
  return nearest;
}

/** One blow a watched body took, with the frost it was left in that frame. */
interface Hit {
  readonly frame: number;
  readonly damage: number;
  readonly chilled: boolean;
  readonly frozen: boolean;
  readonly graceLeft: number;
  readonly frozenTicks: number;
}

interface RigOptions {
  readonly make?: IceFairyFactory;
  readonly level?: number;
  readonly walls?: readonly TileSpec[];
  /** Holds the fairy on its tile, so the line it fires along is known. */
  readonly pinned?: boolean;
  /** Stops the fairy's AI once it has fired, so the run follows one bolt. */
  readonly oneShot?: boolean;
  readonly probe?: (target: Player) => ProbeRules;
  /** The body fired at, when not the human; it joins the party as an extra target. */
  readonly target?: Player;
  readonly targetTileX?: number;
}

/**
 * A lone ice fairy on its tile and a crawler on its row, run one world frame
 * at a time the way the scene orders them: the party's timers, the fairy's AI,
 * then `FairySystem`, which flies the bolts.
 */
function iceRig(opts: RigOptions = {}) {
  const stage = buildStage(opts.walls ?? []);
  const fairy = (opts.make ?? realIceFairy)(FAIRY_TILE, FAIRY_TILE);
  fairy.setMap(stage.map);
  stage.roster.add(fairy);
  const level = opts.level ?? 1;
  if (level > 1) fairy.applyMobLevel(level);
  const target = opts.target ?? stage.pm.human;
  placeOnTile(target, opts.targetTileX ?? PREFERRED_TARGET_TILE_X, FAIRY_TILE);
  const extras: Player[] = target === stage.pm.human ? [] : [target];
  const watched = new Set<Player>([stage.pm.human, stage.pm.cat, target]);
  const hits = new Map<Player, Hit[]>();
  const everFrozen = new Set<Player>();
  const probe =
    opts.probe === undefined ? null : new ProbeBolts(opts.probe(target), fairy, stage.map);
  fairy.swallowsBolts = probe !== null;
  const fireFrames: number[] = [];
  const fairyPath: Point[] = [{ x: fairy.x, y: fairy.y }];
  const boltTrack: Point[] = [];
  let frame = 0;

  const liveBolts = (): readonly Point[] => probe?.live ?? stage.fairies.iceBolts.liveBolts;

  /** One world frame; `move` shifts the fired-at body first, as its own walk would. */
  const step = (move: Point | null = null, everyFrame: (() => void) | null = null): void => {
    frame++;
    if (move !== null) {
      target.x += move.x;
      target.y += move.y;
    }
    everyFrame?.();
    if (opts.pinned === true) placeOnTile(fairy, FAIRY_TILE, FAIRY_TILE);
    const hpBefore = new Map<Player, number>();
    for (const body of watched) {
      body.tickTimers();
      body.invulnerableFrames = 0;
      hpBefore.set(body, body.hp);
    }
    const party = [stage.pm.human, stage.pm.cat, ...extras];
    const firedBefore = fairy.fired.length;
    if (opts.oneShot !== true || fireFrames.length === 0) fairy.updateAI(party);
    stage.fairies.update({ ...stage.ctx(), extraTargets: extras });
    probe?.update(party, stage.roster.mobs);
    if (fairy.fired.length > firedBefore) fireFrames.push(frame);
    fairyPath.push({ x: fairy.x, y: fairy.y });
    const bolts = liveBolts();
    const onlyBolt = bolts.length === 1 ? itemAt(bolts, 0) : undefined;
    if (onlyBolt !== undefined) boltTrack.push({ x: onlyBolt.x, y: onlyBolt.y });
    for (const body of watched) {
      if (body.hasStatus(FROZEN_STATUS)) everFrozen.add(body);
      const damage = (hpBefore.get(body) ?? body.hp) - body.hp;
      if (damage <= 0) continue;
      const frozenStatus = body.statusEffects.find((effect) => effect.type === FROZEN_STATUS);
      const log = hits.get(body) ?? [];
      log.push({
        frame,
        damage,
        chilled: body.hasStatus(CHILLED_STATUS),
        frozen: frozenStatus !== undefined,
        graceLeft: body.freezeGraceFrames,
        frozenTicks: frozenStatus?.totalTicks ?? 0,
      });
      hits.set(body, log);
      body.hp = body.maxHp;
    }
  };

  /** Runs until the fairy has fired once; the frame it fired on, or -1. */
  const runToFirstShot = (): number => {
    while (fireFrames.length === 0 && frame < RUN_LIMIT_FRAMES) step();
    return itemAt(fireFrames, 0) ?? -1;
  };

  /** Runs until nothing is left in the air, moving the fired-at body by `move(frames since the shot)`. */
  const runOutBolts = (move: (sinceShot: number) => Point | null = () => null): void => {
    const shot = itemAt(fireFrames, 0) ?? frame;
    do {
      step(move(frame - shot));
    } while (liveBolts().length > 0 && frame < RUN_LIMIT_FRAMES);
  };

  const hitsOn = (body: Player): readonly Hit[] => hits.get(body) ?? [];

  const watch = (body: Player): void => {
    watched.add(body);
  };

  return {
    ...stage,
    fairy,
    target,
    fireFrames,
    fairyPath,
    boltTrack,
    everFrozen,
    step,
    runToFirstShot,
    runOutBolts,
    hitsOn,
    watch,
    extras,
  };
}

type IceRig = ReturnType<typeof iceRig>;

/** Whether the first bolt was fired along the fairy's row, square across {@link DODGE_DIRECTION}. */
function firedSquareAcross(rig: IceRig): boolean {
  const first = itemAt(rig.fairy.fired, 0);
  if (first === undefined) return false;
  const dot = first.dirX * DODGE_DIRECTION.x + first.dirY * DODGE_DIRECTION.y;
  return Math.abs(dot) < SQUARE_ACROSS_TOLERANCE;
}

type DodgeStyle = 'stands' | 'sidesteps' | 'runs';

const RUN_VELOCITY: Point = {
  x: DODGE_DIRECTION.x * PLAYER_SPEED,
  y: DODGE_DIRECTION.y * PLAYER_SPEED,
};
const SIDESTEP_FRAMES = Math.ceil((TILE_SIZE * SIDESTEP_TILES) / PLAYER_SPEED);

function dodgeMove(style: DodgeStyle): (sinceShot: number) => Point | null {
  return (sinceShot) => {
    if (style === 'stands') return null;
    if (style === 'sidesteps' && sinceShot > SIDESTEP_FRAMES) return null;
    return RUN_VELOCITY;
  };
}

interface DodgeRun {
  readonly squareAcross: boolean;
  readonly hit: boolean;
}

/** One bolt at a crawler on the fairy's row, who dodges `style` from the frame after the shot. */
function dodgeRun(
  style: DodgeStyle,
  opts: Pick<RigOptions, 'level' | 'targetTileX' | 'probe'>,
): DodgeRun {
  return withDodgesOff(() => {
    const rig = iceRig({ ...opts, oneShot: true });
    rig.runToFirstShot();
    rig.runOutBolts(dodgeMove(style));
    return { squareAcross: firedSquareAcross(rig), hit: rig.hitsOn(rig.target).length > 0 };
  });
}

const homingProbe = (target: Player): ProbeRules => ({ ...FAITHFUL_PROBE, homesOn: target });
const leadingProbe =
  (speed: number) =>
  (target: Player): ProbeRules => ({
    ...FAITHFUL_PROBE,
    speed,
    leads: { body: target, velocity: RUN_VELOCITY },
  });
const OVER_CAP_SPEED = PLAYER_SPEED * OVER_CAP_SPEED_FRACTION;

function checkDodging(report: FairyGateReport): void {
  const faithfulStill = dodgeRun('stands', { probe: () => FAITHFUL_PROBE });
  const faithfulSide = dodgeRun('sidesteps', { probe: () => FAITHFUL_PROBE });
  report.precondition(
    faithfulStill.hit && !faithfulSide.hit,
    'a faithful probe bolt reproduces the real one: it hits a crawler standing still and misses one that sidesteps',
  );
  const castRanges: ReadonlyArray<readonly [string, number]> = [
    ['preferred range', PREFERRED_TARGET_TILE_X],
    ['farthest shot', FARTHEST_TARGET_TILE_X],
  ];
  for (const level of [1, MAX_MOB_LEVEL]) {
    for (const [rangeName, targetTileX] of castRanges) {
      const at = `L${level}, ${rangeName}`;
      const still = dodgeRun('stands', { level, targetTileX });
      report.check(still.hit, `${at}: a bolt hits a crawler standing still`);
      const side = dodgeRun('sidesteps', { level, targetTileX });
      report.check(
        side.squareAcross && !side.hit,
        `${at}: a crawler sidestepping ${SIDESTEP_TILES} tile at PLAYER_SPEED from the shot escapes`,
        `fired square across ${side.squareAcross}, hit ${side.hit}`,
      );
      const run = dodgeRun('runs', { level, targetTileX });
      report.check(
        run.squareAcross && !run.hit,
        `${at}: a crawler running across the bolt's path at PLAYER_SPEED escapes`,
        `fired square across ${run.squareAcross}, hit ${run.hit}`,
      );
    }
  }
  const homed = dodgeRun('sidesteps', { probe: homingProbe });
  report.checkCatches(
    !homed.hit,
    'a bolt at the same speed that re-aims at the crawler every frame is caught hitting the sidestepper',
  );
  const ledAtCap = dodgeRun('runs', { probe: leadingProbe(ICE_BOLT_SPEED) });
  report.check(
    !ledAtCap.hit,
    'even aimed with perfect lead, a bolt at ICE_BOLT_SPEED never reaches a crawler running across its path',
  );
  const ledOverCap = dodgeRun('runs', { probe: leadingProbe(OVER_CAP_SPEED) });
  report.checkCatches(
    !ledOverCap.hit,
    `a bolt aimed with lead at ${OVER_CAP_SPEED_FRACTION}× the crawler's speed is caught hitting the runner`,
  );
}

/** The largest distance the lone bolt in the air covered between two frames. */
function fastestStep(track: readonly Point[]): number {
  let fastest = 0;
  for (let n = 1; n < track.length; n++) {
    const from = itemAt(track, n - 1);
    const to = itemAt(track, n);
    if (from === undefined || to === undefined) continue;
    fastest = Math.max(fastest, Math.hypot(to.x - from.x, to.y - from.y));
  }
  return fastest;
}

function measuredBoltSpeed(
  level: number,
  probe?: RigOptions['probe'],
): { speed: number; samples: number } {
  const rig = iceRig({ level, oneShot: true, probe });
  rig.runToFirstShot();
  rig.runOutBolts();
  return { speed: fastestStep(rig.boltTrack), samples: rig.boltTrack.length };
}

function checkBoltSpeed(report: FairyGateReport): void {
  const capPx = PLAYER_SPEED * ICE_BOLT_SPEED_FRACTION_OF_PLAYER + SPEED_EPSILON_PX;
  const underCap = (measured: { speed: number; samples: number }): boolean =>
    measured.samples > 1 && measured.speed <= capPx;
  for (const level of [1, MAX_MOB_LEVEL]) {
    const measured = measuredBoltSpeed(level);
    report.check(
      underCap(measured) && measured.speed < PLAYER_SPEED,
      `L${level}: the bolt never covers more than PLAYER_SPEED × ICE_BOLT_SPEED_FRACTION_OF_PLAYER in a frame`,
      `${measured.speed.toFixed(DECIMALS)} px/frame over ${measured.samples} frames, cap ${capPx.toFixed(DECIMALS)}`,
    );
  }
  const levelledSpeed = ICE_BOLT_SPEED * projectileSpeedScaleForLevel(MAX_MOB_LEVEL);
  const levelled = measuredBoltSpeed(MAX_MOB_LEVEL, () => ({
    ...FAITHFUL_PROBE,
    speed: levelledSpeed,
  }));
  report.checkCatches(
    underCap(levelled),
    'a bolt scaled like a levelled projectile is caught over the cap at the maximum level',
    `${levelled.speed.toFixed(DECIMALS)} px/frame`,
  );
}

/** One bolt from a pinned fairy at a crawler who steps off the line, flying on toward the cat. */
function boltPastDodger(
  walled: boolean,
  probe?: RigOptions['probe'],
): {
  behindHit: boolean;
  squareAcross: boolean;
} {
  return withDodgesOff(() => {
    const rig = iceRig({
      walls: walled ? [[BOLT_WALL_X, FAIRY_TILE]] : [],
      pinned: true,
      oneShot: true,
      targetTileX: IN_FRONT_OF_WALL_X,
      probe,
    });
    placeOnTile(rig.pm.cat, BEHIND_WALL_X, FAIRY_TILE);
    rig.runToFirstShot();
    placeOnTile(rig.target, IN_FRONT_OF_WALL_X, FAIRY_TILE + OFF_THE_LINE_ROWS);
    rig.runOutBolts();
    const cat = rig.pm.cat;
    return {
      behindHit: rig.hitsOn(cat).length > 0 || cat.hasStatus(CHILLED_STATUS),
      squareAcross: firedSquareAcross(rig),
    };
  });
}

function checkWall(report: FairyGateReport): void {
  const walled = boltPastDodger(true);
  report.check(
    walled.squareAcross && !walled.behindHit,
    'a bolt stops at the first wall: the crawler behind it is untouched',
  );
  const open = boltPastDodger(false);
  report.checkCatches(
    !open.behindHit,
    'with the wall gone, the same bolt is caught reaching the crawler behind it',
  );
  const ghost = boltPastDodger(true, () => ({ ...FAITHFUL_PROBE, ignoresWalls: true }));
  report.checkCatches(
    !ghost.behindHit,
    'a bolt that ignores walls is caught striking the crawler behind the wall',
  );
}

/** One bolt at a crawler standing still, with the fairy killed the frame after it fired. */
function boltAfterDeath(probe?: RigOptions['probe']): { hit: boolean; fairyDead: boolean } {
  return withDodgesOff(() => {
    const rig = iceRig({ oneShot: true, probe });
    rig.runToFirstShot();
    rig.kill(rig.fairy);
    rig.runOutBolts();
    return { hit: rig.hitsOn(rig.target).length > 0, fairyDead: !rig.fairy.isAlive };
  });
}

function checkBoltOutlivesFairy(report: FairyGateReport): void {
  const real = boltAfterDeath();
  report.check(
    real.fairyDead && real.hit,
    'a bolt in flight when its fairy dies flies on and hits the crawler',
  );
  const vanishing = boltAfterDeath(() => ({ ...FAITHFUL_PROBE, diesWithOwner: true }));
  report.checkCatches(vanishing.hit, 'a bolt that vanishes with its fairy is caught never landing');
}

/** One bolt from a pinned fairy with a goblin standing on the line to the crawler. */
function boltThroughGoblin(probe?: RigOptions['probe']): {
  goblinTouched: boolean;
  crawlerHit: boolean;
} {
  return withDodgesOff(() => {
    const rig = iceRig({ pinned: true, oneShot: true, probe });
    const goblin = rig.add('goblin', IN_THE_LINE_X, FAIRY_TILE);
    rig.watch(goblin);
    rig.runToFirstShot();
    rig.runOutBolts();
    return {
      goblinTouched: rig.hitsOn(goblin).length > 0 || goblin.hasStatus(CHILLED_STATUS),
      crawlerHit: rig.hitsOn(rig.target).length > 0,
    };
  });
}

function checkHostilesUntouched(report: FairyGateReport): void {
  const real = boltThroughGoblin();
  report.check(
    real.crawlerHit && !real.goblinTouched,
    'a bolt passes through a goblin on its line and hits the crawler behind it',
  );
  const indiscriminate = boltThroughGoblin(() => ({ ...FAITHFUL_PROBE, strikesHostiles: true }));
  report.checkCatches(
    !indiscriminate.goblinTouched,
    'a bolt that strikes any body is caught wounding the goblin',
  );
}

/** Bolts from a pinned fairy at the crawler, with Mongo standing on the line between them. */
function boltsAtMongo(probe?: RigOptions['probe']): {
  hits: number;
  chilled: boolean;
  everFrozen: boolean;
} {
  return withDodgesOff(() => {
    const rig = iceRig({ pinned: true, probe });
    const mongo = new Mongo(
      IN_THE_LINE_X,
      FAIRY_TILE,
      TILE_SIZE,
      rig.pm.cat,
      MONGO_LEVEL,
      MONGO_STARTING_HP,
    );
    mongo.setMap(rig.map);
    rig.extras.push(mongo);
    rig.watch(mongo);
    while (
      rig.hitsOn(mongo).length < MONGO_HITS_WANTED &&
      rig.fairyPath.length <= RUN_LIMIT_FRAMES
    ) {
      rig.step();
    }
    return {
      hits: rig.hitsOn(mongo).length,
      chilled: mongo.hasStatus(CHILLED_STATUS),
      everFrozen: rig.everFrozen.has(mongo),
    };
  });
}

function checkPartyMobsOnlyChilled(report: FairyGateReport): void {
  const real = boltsAtMongo();
  report.check(
    real.hits >= MONGO_HITS_WANTED && real.chilled && !real.everFrozen,
    `Mongo struck by ${MONGO_HITS_WANTED} bolts in a row is chilled and never frozen`,
    `${real.hits} hits`,
  );
  const freezing = boltsAtMongo(() => ({ ...FAITHFUL_PROBE, freezesEveryBody: true }));
  report.checkCatches(
    freezing.hits >= MONGO_HITS_WANTED && !freezing.everFrozen,
    'a bolt that lands the crawler’s freezing hit on Mongo is caught freezing him',
    `${freezing.hits} hits`,
  );
}

/** The first `wanted` bolts at a crawler standing still, with its frost as each one landed. */
function hitSequence(
  opts: Pick<RigOptions, 'make' | 'level' | 'target'>,
  wanted: number,
  setup?: (target: Player) => void,
  everyFrame?: (target: Player, hitsSoFar: number) => void,
): readonly Hit[] {
  return withDodgesOff(() => {
    const rig = iceRig(opts);
    setup?.(rig.target);
    while (rig.hitsOn(rig.target).length < wanted && rig.fairyPath.length <= RUN_LIMIT_FRAMES) {
      rig.step(null, () => everyFrame?.(rig.target, rig.hitsOn(rig.target).length));
    }
    return rig.hitsOn(rig.target);
  });
}

const chillsOnly = (hit: Hit | undefined): boolean =>
  hit !== undefined && hit.chilled && !hit.frozen;

/**
 * Chills the crawler again the moment it thaws, as a second fairy's bolt
 * would: a thaw clears the chill, so without it the next bolt could only chill
 * whatever the grace said.
 */
function rechillOnThaw(target: Player, hitsSoFar: number): void {
  if (hitsSoFar < FREEZING_HIT) return;
  if (target.hasStatus(FROZEN_STATUS) || target.hasStatus(CHILLED_STATUS)) return;
  target.applyStatus(makeChilled(CHILLED_FRAMES));
}

function checkChillFreezeGrace(report: FairyGateReport): void {
  const hits = hitSequence({}, SEQUENCE_HITS, undefined, rechillOnThaw);
  const first = itemAt(hits, 0);
  const second = itemAt(hits, FREEZING_HIT - 1);
  const third = itemAt(hits, SEQUENCE_HITS - 1);
  report.check(chillsOnly(first), 'bolt 1 damages and chills, and does not freeze');
  const alreadyChilled = hitSequence({}, 1, (target) =>
    target.applyStatus(makeChilled(CHILLED_FRAMES)),
  );
  report.checkCatches(
    chillsOnly(itemAt(alreadyChilled, 0)),
    'the same first bolt on a crawler already chilled is caught freezing it',
  );
  report.check(
    second !== undefined && second.frozen && !second.chilled,
    "a lone fairy's second bolt lands inside the chill and freezes",
    second === undefined ? 'no second hit' : `${second.frame - (first?.frame ?? 0)} frames later`,
  );
  report.precondition(
    second?.frozenTicks === FROZEN_FRAMES,
    'an unresisted freeze lasts FROZEN_FRAMES',
    `${second?.frozenTicks}`,
  );
  report.check(
    chillsOnly(third) && (third?.graceLeft ?? 0) > 0,
    'a bolt in the freeze grace only chills a crawler already chilled again',
    `grace left ${third?.graceLeft}`,
  );
  const graceless = hitSequence({}, SEQUENCE_HITS, undefined, (target, hitsSoFar) => {
    rechillOnThaw(target, hitsSoFar);
    if (hitsSoFar >= FREEZING_HIT) target.freezeGraceFrames = 0;
  });
  report.checkCatches(
    chillsOnly(itemAt(graceless, SEQUENCE_HITS - 1)),
    'the same third bolt with the grace window wiped is caught freezing',
  );

  const lastSource = withDodgesOff(() => {
    const rig = iceRig({ oneShot: true });
    rig.runToFirstShot();
    rig.runOutBolts();
    return rig.target.lastDamageSource;
  });
  const boltCause = lastSource === null ? null : causeFromDamageSource(lastSource);
  report.check(
    boltCause === 'iceFairyBolt',
    `a bolt's blow is named '${ICE_BOLT_ATTACK_TYPE}' and read on the death screen as the ice fairy's bolt`,
    `${boltCause}`,
  );
  const goblinCause = causeFromDamageSource({ kind: 'mob', mobType: 'Goblin' });
  report.checkCatches(
    goblinCause === 'iceFairyBolt',
    "a goblin's blow is caught not reading as the ice fairy's bolt",
    goblinCause,
  );

  for (const level of [1, MAX_MOB_LEVEL]) {
    const pair = hitSequence({ level }, FREEZING_HIT);
    report.check(
      itemAt(pair, FREEZING_HIT - 1)?.frozen === true,
      `L${level}: a lone fairy's second bolt lands inside the first one's chill and freezes`,
      pair.length < FREEZING_HIT ? `${pair.length} hits` : `chill ${CHILLED_FRAMES}`,
    );
  }
  const sluggish = hitSequence(
    { make: (x, y) => new SluggishIceFairy(x, y, TILE_SIZE), level: MAX_MOB_LEVEL },
    FREEZING_HIT,
  );
  report.checkCatches(
    itemAt(sluggish, FREEZING_HIT - 1)?.frozen === true,
    'a fairy whose bolt comes back only once a chill has worn off is caught never freezing',
  );
}

function checkResistance(report: FairyGateReport): void {
  const pairAt = (target: HumanPlayer): { drop: number; freeze: number } => {
    const hits = hitSequence({ target }, FREEZING_HIT);
    return {
      drop: itemAt(hits, 0)?.damage ?? 0,
      freeze: itemAt(hits, FREEZING_HIT - 1)?.frozenTicks ?? 0,
    };
  };
  const make = <T extends HumanPlayer>(
    ctor: new (tileX: number, tileY: number, tileSize: number) => T,
  ): T => new ctor(PREFERRED_TARGET_TILE_X, FAIRY_TILE, TILE_SIZE);
  const plain = pairAt(make(HumanPlayer));
  const resisted = pairAt(make(IceProofHuman));
  const halvesDamage = (run: { drop: number }): boolean =>
    run.drop > 0 && run.drop <= plain.drop / RESIST_DIVISOR;
  const halvesFreeze = (run: { freeze: number }): boolean =>
    plain.freeze > 0 && run.freeze === Math.ceil(plain.freeze / RESIST_DIVISOR);
  report.check(
    halvesDamage(resisted),
    "resists('ice') at least halves the bolt's damage",
    `${plain.drop} vs ${resisted.drop}`,
  );
  const damageLeak = pairAt(make(DamageLeakingIceProofHuman));
  report.checkCatches(
    halvesDamage(damageLeak),
    'ice gear that takes nothing off the blow is caught taking the full bolt',
    `${damageLeak.drop}`,
  );
  report.check(
    halvesFreeze(resisted),
    "resists('ice') halves the freeze, rounded up",
    `${plain.freeze} vs ${resisted.freeze}`,
  );
  const freezeLeak = pairAt(make(FreezeLeakingIceProofHuman));
  report.checkCatches(
    halvesFreeze(freezeLeak),
    'ice gear that halves the blow but not the freeze is caught frozen the full time',
    `${freezeLeak.freeze}`,
  );
}

/**
 * The fairy's path, frame by frame, with the crawler walking in from past its
 * notice, run until `frames` have passed or, when `frames` is null, until the
 * shot plus the frames watched after it.
 */
function pathWhileApproached(
  make: IceFairyFactory,
  frames: number | null,
): { shot: number; path: readonly Point[] } {
  return withDodgesOff(() => {
    const rig = iceRig({ make, targetTileX: APPROACH_START_TILE_X });
    const stopPx = TILE_SIZE * APPROACH_STOP_TILES;
    const approach = (): Point | null =>
      rig.target.x - rig.fairy.x > stopPx ? { x: -PLAYER_SPEED, y: 0 } : null;
    const lastFrame = (): number => {
      if (frames !== null) return frames;
      const shot = itemAt(rig.fireFrames, 0);
      return shot === undefined ? RUN_LIMIT_FRAMES : shot + MOVING_AFTER_SHOT_FRAMES;
    };
    while (rig.fairyPath.length <= lastFrame()) rig.step(approach());
    return { shot: itemAt(rig.fireFrames, 0) ?? -1, path: rig.fairyPath };
  });
}

/** An ice fairy that never casts: the path a fairy takes when casting has no say in it. */
class MuteIceFairy extends WatchedIceFairy {
  protected override chooseCast(): null {
    return null;
  }
}

/**
 * How a fairy's path around its first shot compares with a never-casting
 * twin's under the same approach: the largest gap between them, and whether it
 * moved on the frame it fired.
 */
function movementAroundShot(make: IceFairyFactory): {
  shot: number;
  movedOnShot: boolean;
  largestGapPx: number;
} {
  const casting = pathWhileApproached(make, null);
  const lastFrame = casting.path.length - 1;
  const mute = pathWhileApproached((x, y) => new MuteIceFairy(x, y, TILE_SIZE), lastFrame);
  let largestGapPx = 0;
  const firstWatched = Math.max(0, casting.shot - MOVING_BEFORE_SHOT_FRAMES);
  for (let frame = firstWatched; frame <= lastFrame; frame++) {
    const own = itemAt(casting.path, frame);
    const twin = itemAt(mute.path, frame);
    if (own === undefined || twin === undefined) continue;
    largestGapPx = Math.max(largestGapPx, Math.hypot(own.x - twin.x, own.y - twin.y));
  }
  const before = itemAt(casting.path, casting.shot - 1);
  const after = itemAt(casting.path, casting.shot);
  const movedOnShot =
    before !== undefined &&
    after !== undefined &&
    Math.hypot(after.x - before.x, after.y - before.y) >= MOVE_EPSILON_PX;
  return { shot: casting.shot, movedOnShot, largestGapPx };
}

function checkMovesWhileFiring(report: FairyGateReport): void {
  const window = `${MOVING_BEFORE_SHOT_FRAMES} frames before the shot to ${MOVING_AFTER_SHOT_FRAMES} after`;
  const moves = (run: ReturnType<typeof movementAroundShot>): boolean =>
    run.shot > MOVING_BEFORE_SHOT_FRAMES && run.movedOnShot && run.largestGapPx < MOVE_EPSILON_PX;
  const real = movementAroundShot(realIceFairy);
  report.check(
    moves(real),
    `the ice fairy fires on the move, and from ${window} flies exactly as a fairy that never casts`,
    real.shot < 0
      ? 'never fired'
      : `shot on frame ${real.shot}, moved ${real.movedOnShot}, gap ${real.largestGapPx.toFixed(DECIMALS)} px`,
  );
  const still = movementAroundShot((x, y) => new StillCastingIceFairy(x, y, TILE_SIZE));
  report.checkCatches(
    moves(still),
    'a fairy that holds its place while it casts is caught standing still',
    `moved ${still.movedOnShot}, gap ${still.largestGapPx.toFixed(DECIMALS)} px`,
  );
}

function checkDeathBlast(report: FairyGateReport): void {
  const s = buildStage();
  const fairy = new IceFairy(FAIRY_TILE, FAIRY_TILE, TILE_SIZE);
  fairy.setMap(s.map);
  s.roster.add(fairy);
  const human = s.pm.human;
  placeOnTile(human, FAIRY_TILE + ADJACENT_TILES, FAIRY_TILE);
  human.applyStatus(makeChilled(NEARLY_THAWED_FRAMES));
  s.kill(fairy);
  s.fairies.update(s.ctx());
  const chill = human.statusEffects.find((effect) => effect.type === CHILLED_STATUS);
  report.check(
    (chill?.ticksRemaining ?? 0) > NEARLY_THAWED_FRAMES,
    "the death blast refreshes a crawler's chill",
    `${chill?.ticksRemaining}`,
  );
  report.check(
    !human.hasStatus(FROZEN_STATUS) && human.hp === human.maxHp,
    'the death blast never freezes a chilled crawler and deals no damage',
  );
  report.check(!s.pm.cat.hasStatus(CHILLED_STATUS), 'a crawler outside the blast is not chilled');
  applyIceHit(human);
  report.checkCatches(
    !human.hasStatus(FROZEN_STATUS),
    'a freezing hit in the blast’s place is caught freezing the chilled crawler',
  );
}

/** Pixels the AI companion moves over one freeze, left well past its follow distance. */
function companionMoved(frozen: boolean): number {
  const s = buildStage();
  const companion = new CompanionSystem(s.map, FAIRY_TILE, FAIRY_TILE);
  placeOnTile(s.pm.human, FAIRY_TILE, FAIRY_TILE);
  placeOnTile(s.pm.cat, FAIRY_TILE + COMPANION_GAP_TILES, FAIRY_TILE);
  if (frozen) s.pm.cat.applyStatus(makeFrozen(FROZEN_FRAMES));
  const start = { x: s.pm.cat.x, y: s.pm.cat.y };
  for (let n = 0; n < COMPANION_WATCH_FRAMES; n++) {
    companion.update(s.ctx());
    s.pm.cat.tickTimers();
  }
  return Math.hypot(s.pm.cat.x - start.x, s.pm.cat.y - start.y);
}

function checkFrozenCompanion(report: FairyGateReport): void {
  const frozen = companionMoved(true);
  report.check(
    frozen < MOVE_EPSILON_PX,
    'a frozen AI companion does not move',
    `${frozen.toFixed(2)} px`,
  );
  const thawed = companionMoved(false);
  report.checkCatches(
    thawed < MOVE_EPSILON_PX,
    'the same companion unfrozen is caught walking back to the party',
    `${thawed.toFixed(2)} px`,
  );
}

/** Swings the human lands in {@link CADENCE_FRAMES}, attacking the moment each swing allows. */
function swingsLanded(human: HumanPlayer, frost: 'none' | 'chilled' | 'frozen'): number {
  const frostFrames = CADENCE_FRAMES * FROST_OUTLASTS_CADENCE;
  if (frost === 'chilled') human.applyStatus(makeChilled(frostFrames));
  if (frost === 'frozen') human.applyStatus(makeFrozen(frostFrames));
  let peaks = 0;
  for (let n = 0; n < CADENCE_FRAMES; n++) {
    human.triggerAttack();
    human.tickTimers();
    human.updateAttack();
    if (human.isAttackPeak()) peaks++;
  }
  return peaks;
}

function checkChilledCadence(report: FairyGateReport): void {
  const normal = swingsLanded(new HumanPlayer(FAIRY_TILE, FAIRY_TILE, TILE_SIZE), 'none');
  const chilled = swingsLanded(new HumanPlayer(FAIRY_TILE, FAIRY_TILE, TILE_SIZE), 'chilled');
  const frozen = swingsLanded(new HumanPlayer(FAIRY_TILE, FAIRY_TILE, TILE_SIZE), 'frozen');
  report.check(
    normal > 0 && frozen === 0,
    'a frozen crawler lands no swing at all',
    `${frozen} vs ${normal} unfrozen`,
  );
  const ratio = normal === 0 ? 1 : chilled / normal;
  const slowEnough = (r: number): boolean =>
    normal > 0 && Math.abs(r - CHILLED_ACTION_SPEED_FACTOR) <= CADENCE_TOLERANCE;
  report.check(
    slowEnough(ratio),
    "a chilled crawler's attack cadence slows to CHILLED_ACTION_SPEED_FACTOR",
    `${chilled} vs ${normal} swings (${ratio.toFixed(2)})`,
  );
  const blind = swingsLanded(new ChillBlindHuman(FAIRY_TILE, FAIRY_TILE, TILE_SIZE), 'chilled');
  report.checkCatches(
    slowEnough(normal === 0 ? 1 : blind / normal),
    'a crawler whose swing timers ignore the chill is caught at full cadence',
    `${blind} vs ${normal}`,
  );
}

/** A human whose swing survives the freeze: the defect the swing-clearing check must catch. */
class SwingKeepingHuman extends HumanPlayer {
  protected override abandonSwing(): void {
    // Keeps whatever swing was under way.
  }
}

/** A cat whose claw survives the freeze. */
class SwingKeepingCat extends CatPlayer {
  protected override abandonSwing(): void {
    // Keeps whatever swing was under way.
  }
}

/** A freeze short enough that the swing it caught would still have time to land after it. */
const SWING_FREEZE_FRAMES = 30;
/** Frames watched after the freeze lands: the freeze, then more than any whole swing or smush. */
const SWING_WATCH_FRAMES = 240;

/** Anything that swings the way both crawlers do: started, ticked, landing on one peak frame. */
interface SwingSubject {
  readonly body: HumanPlayer | CatPlayer;
  start(): boolean;
  peak(): boolean;
}

function humanSwing(human: HumanPlayer): SwingSubject {
  return {
    body: human,
    start: () => {
      human.triggerAttack();
      return human.isSwinging;
    },
    peak: () => human.isAttackPeak(),
  };
}

function humanSmush(human: HumanPlayer): SwingSubject {
  return { body: human, start: () => human.triggerSmush(), peak: () => human.isSmushPeak() };
}

function catSwing(cat: CatPlayer): SwingSubject {
  return {
    body: cat,
    start: () => {
      cat.triggerAttack();
      return cat.isSwinging;
    },
    peak: () => cat.isAttackPeak(),
  };
}

/**
 * Peaks a swing started one frame before a freeze reaches, through the freeze
 * and well past the thaw. Null when the swing never started, so a subject that
 * refused to swing cannot pass as one whose swing was cleared.
 */
function peaksAfterFreeze(subject: SwingSubject): number | null {
  const { body } = subject;
  if (!subject.start()) return null;
  body.tickTimers();
  body.updateAttack();
  if (subject.peak()) return null;
  body.applyStatus(makeFrozen(SWING_FREEZE_FRAMES));
  let peaks = 0;
  for (let frame = 0; frame < SWING_WATCH_FRAMES; frame++) {
    body.tickTimers();
    body.updateAttack();
    if (subject.peak()) peaks++;
  }
  return peaks;
}

function checkFreezeClearsSwing(report: FairyGateReport): void {
  const at = (): [number, number, number] => [FAIRY_TILE, FAIRY_TILE, TILE_SIZE];
  const cases: ReadonlyArray<readonly [string, SwingSubject, SwingSubject]> = [
    [
      'human swing',
      humanSwing(new HumanPlayer(...at())),
      humanSwing(new SwingKeepingHuman(...at())),
    ],
    [
      'human smush',
      humanSmush(new HumanPlayer(...at())),
      humanSmush(new SwingKeepingHuman(...at())),
    ],
    ['cat swipe', catSwing(new CatPlayer(...at())), catSwing(new SwingKeepingCat(...at()))],
  ];
  for (const [name, shipped, keeping] of cases) {
    const peaks = peaksAfterFreeze(shipped);
    report.check(
      peaks === 0,
      `a ${name} started before a freeze never lands, during the freeze or after the thaw`,
      peaks === null ? 'the swing never started' : `${peaks} peaks`,
    );
    const kept = peaksAfterFreeze(keeping);
    report.checkCatches(
      kept === 0,
      `a ${name} that survives the freeze is caught landing`,
      kept === null ? 'the swing never started' : `${kept} peaks`,
    );
  }
}

/**
 * The facing and swing the active crawler is left with after the attack key,
 * facing east beside a goblin a diagonal step off: inside the cone the key
 * snaps the facing across, but not already faced.
 */
function attackKeyBesideGoblin(active: 'human' | 'cat', frozen: boolean) {
  const s = buildStage();
  const { human, cat } = s.pm;
  const crawler = active === 'human' ? human : cat;
  human.isActive = active === 'human';
  cat.isActive = active === 'cat';
  placeOnTile(crawler, FAIRY_TILE, FAIRY_TILE);
  s.add('goblin', FAIRY_TILE + ADJACENT_TILES, FAIRY_TILE + ADJACENT_TILES);
  crawler.facingX = 1;
  crawler.facingY = 0;
  if (frozen) crawler.applyStatus(makeFrozen(FROZEN_FRAMES));
  triggerPlayerAttack(human, cat, s.roster.grid, s.map, null);
  return { facingX: crawler.facingX, facingY: crawler.facingY, swinging: crawler.isSwinging };
}

function checkFrozenAttackKey(report: FairyGateReport): void {
  for (const active of ['human', 'cat'] as const) {
    const frozen = attackKeyBesideGoblin(active, true);
    report.check(
      frozen.facingX === 1 && frozen.facingY === 0 && !frozen.swinging,
      `the attack key does nothing to a frozen ${active}: no swing, no turn toward the goblin`,
      `facing (${frozen.facingX.toFixed(2)}, ${frozen.facingY.toFixed(2)}), swinging ${frozen.swinging}`,
    );
    const free = attackKeyBesideGoblin(active, false);
    report.checkCatches(
      free.facingX === 1 && free.facingY === 0,
      `the same key on an unfrozen ${active} is caught turning toward the goblin`,
      `facing (${free.facingX.toFixed(2)}, ${free.facingY.toFixed(2)})`,
    );
  }
}

export function verifyIceFairy(report: FairyGateReport): void {
  report.section('Ice fairy');
  checkDodging(report);
  checkBoltSpeed(report);
  withDodgesOff(() => {
    checkWall(report);
    checkBoltOutlivesFairy(report);
    checkHostilesUntouched(report);
    checkPartyMobsOnlyChilled(report);
    checkChillFreezeGrace(report);
    checkResistance(report);
    checkDeathBlast(report);
  });
  checkMovesWhileFiring(report);
  checkFrozenCompanion(report);
  checkChilledCadence(report);
  checkFreezeClearsSwing(report);
  checkFrozenAttackKey(report);
}
