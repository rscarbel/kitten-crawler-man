import type { GameMap } from '../map/GameMap';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import { EXPLOSION_IGNITE_RING_TILES, type TreeSystem } from './TreeSystem';
import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { MAX_MOB_HP_MULTIPLIER } from '../creatures/mobLevelScaling';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  drawDynamiteFloorSprite,
  drawDynamiteChargeBar,
  drawDynamiteThrowPath,
} from '../sprites/dynamiteSprite';
import {
  type BlastCore,
  drawDynamiteExplosion,
  drawScorchMark,
  EXPLOSION_TOTAL_FRAMES,
  SCORCH_TOTAL_FRAMES,
} from '../sprites/dynamiteExplosion';
import type { GameSystem, SystemContext } from './GameSystem';
import type { EventBus } from '../core/EventBus';
import {
  eventFrame,
  type HumanRowName,
  humanRowOf,
  type ViewRows,
} from '../sprites/art/humanFigure';
import { DYNAMITE_THROWING_HAND } from '../sprites/art/human/actionsThrow';
import { prewarmHumanRow, viewForFacing } from '../sprites/humanSprite';
import type { CarlView } from '../sprites/art/carl/rig';
import { easeOut, type Pt } from '../sprites/art/carlArt';

/** Frames of charge for a full-strength throw. */
export const DYN_MAX_CHARGE = 120;
/** Frames of charge after which the charge bar turns red, a second before the stick goes off in hand. */
export const DYN_DANGER = 240;
/** Frames of charge after which the stick goes off in the thrower's hand. */
const DYN_EXPLODE_HAND = 300;
/** Frames a thrown or dropped stick burns before it goes off. */
const DYN_FUSE = 300;
/** Releases shorter than this many frames drop the stick at the thrower's feet. */
const DYN_TAP = 8;
const DYN_SPEED_MIN = 2.0;
const DYN_SPEED_MAX = 23.1;
/** Share of its speed a stick keeps off a wall. */
const DYN_BOUNCE = 0.6;
const DYN_FRICTION = 0.88;
/** Speed (px/frame) below which a stick comes to rest. */
const DYN_STOP = 0.08;
/** Speed (px/frame) below which dynamite transitions from flying to sliding. */
const DYN_SLIDE_THRESHOLD = 1.5;
/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
const DYN_RADIUS_TILES = 3;
const DYN_RADIUS = TILE_SIZE * DYN_RADIUS_TILES;
/** What an untrained level-1 human's stick does, to crawlers and enemies alike. */
const DYN_DAMAGE = 16;
/** Bonus speed per extra explosives handling level above 1. */
const DYN_SPEED_PER_LEVEL = 4;
/** Flat bonus per explosives handling level above 1 to what a blast does to the crawlers. */
const DYN_CRAWLER_DAMAGE_PER_LEVEL = 2;
/**
 * Blast damage to enemies added per thrower level above 1, as a fraction of
 * {@link DYN_DAMAGE}.
 *
 * Enemy health grows as a fraction of its authored value with every level
 * (`MOB_LEVEL_HP_SCALE`), so a stick whose damage stayed fixed would fall from
 * a threat to a firecracker over a couple of floors. Growing the same way keeps
 * an untrained stick worth roughly the same share of a same-floor mob's health
 * at every level — a consumable that drops and sells at a flat price should not
 * quietly lose its worth.
 */
export const DYN_MOB_DAMAGE_FRACTION_PER_THROWER_LEVEL = 0.15;
/**
 * Ceiling on the thrower-level multiplier. Mob health stops growing at
 * `MAX_MOB_HP_MULTIPLIER`, so a stick that kept growing past it would outscale
 * everything it is thrown at.
 */
const MAX_DYN_THROWER_LEVEL_MULTIPLIER = MAX_MOB_HP_MULTIPLIER;
/**
 * Multiplier on blast damage to enemies added per explosives handling level
 * above 1.
 *
 * A multiplier rather than a flat bonus, the same shape as Iron Punch: a flat
 * point would shrink to nothing against levelled health, where a share of an
 * already-levelled stick keeps every point spent worth what it was when spent.
 */
export const DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL = 0.3;
/**
 * Frames after a blast lands on a blast-resistant mob during which further
 * blasts do nothing to it. Without it a volley of sticks dropped together is one
 * enormous hit, and a boss's health bar is a question of how many sticks were
 * bought rather than how the fight was played.
 */
export const BLAST_RESISTANT_COOLDOWN_FRAMES = 60;
/**
 * How much harder a chain of sticks hits enemies than the same sticks going off
 * one at a time. Packed charges detonating together make one blast, and one
 * blast is worse than its parts: the overlapping fronts reinforce.
 */
export const CHAIN_DAMAGE_BONUS = 1.25;
/**
 * The furthest a chained blast can reach, in tiles, however many sticks are in
 * it — a floor carpeted in dynamite should level the room, not the level.
 */
const CHAIN_MAX_RADIUS_TILES = 8;
/** Each extra stick in a chain adds this share to the size of every fireball in it. */
const CHAIN_FIREBALL_GROWTH_PER_STICK = 0.12;
const CHAIN_MAX_FIREBALL_SCALE = 1.5;
/**
 * How fast a chain ripples outward from the stick that set it off, in pixels
 * per frame. Damage lands at once; only the pictures of the later fireballs
 * wait, so a chain reads as one charge setting off the next.
 */
const CHAIN_RIPPLE_PX_PER_FRAME = 24;
/** Spreads consecutive blasts' seeds so no two blasts share a picture. */
const BLAST_SEED_STRIDE = 7919;
/** Max frames to simulate for the throw path preview (covers full fuse duration). */
const TRAJECTORY_MAX_FRAMES = 300;
/** Collect a path point every N simulated frames to keep screen-point count manageable. */
const TRAJECTORY_SAMPLE_INTERVAL = 3;

/** The rows he lights, holds and throws a stick in, per view. */
const LIGHT_ROWS: ViewRows = {
  front: 'dynamite_light',
  side: 'dynamite_light_side',
  back: 'dynamite_light_away',
};
const HOLD_ROWS: ViewRows = {
  front: 'dynamite_hold',
  side: 'dynamite_hold_side',
  back: 'dynamite_hold_away',
};
const THROW_ROWS: ViewRows = {
  front: 'dynamite_throw',
  side: 'dynamite_throw_side',
  back: 'dynamite_throw_away',
};
const ALL_DYNAMITE_ROWS: ReadonlySet<HumanRowName> = new Set([
  ...Object.values(LIGHT_ROWS),
  ...Object.values(HOLD_ROWS),
  ...Object.values(THROW_ROWS),
]);

/**
 * Frames over which a thrown stick's drawn position closes from the hand
 * that let it go onto the gameplay body it rides on. The body is launched
 * from his centre and never changes course for the picture; only where it is
 * drawn starts at the fist and settles onto it, so the landing, the bounces
 * and the preview path are exactly the gameplay ones.
 */
const LOB_FRAMES = 16;
/** How high above the straight path from hand to body the drawn stick arcs, in tiles. */
const LOB_ARC_TILES = 1;
/**
 * Extra arc, as a share of {@link LOB_ARC_TILES}, on a stick thrown straight
 * down the screen. Toward the camera the flight runs down over his own body,
 * and without a higher arc the drawn stick slides down his chest and legs and
 * reads as dropped rather than thrown.
 */
const LOB_TOWARD_CAMERA_EXTRA_ARC = 1;

/** How high a stick launched with this velocity arcs, in tiles. */
function lobArcTiles(vx: number, vy: number): number {
  const speed = Math.hypot(vx, vy);
  const towardCamera = speed > 0 ? Math.max(0, vy / speed) : 0;
  return LOB_ARC_TILES * (1 + LOB_TOWARD_CAMERA_EXTRA_ARC * towardCamera);
}
/**
 * Full turns a lobbed stick tumbles end over end before it lands. A thrown
 * stick spins; a sliding one does not. Whole, because the settled stick is
 * drawn unrotated: any fraction of a turn left at the end of the lob would
 * snap it square on the frame it lands.
 */
const LOB_TUMBLE_TURNS = 1;
/** A parabola's peak, `4u(1 − u)`, is 1 at `u = ½`; this is the 4. */
const PARABOLA_PEAK_GAIN = 4;
/**
 * The floor sprite is drawn larger than the stick he holds — it has to read
 * lying on its own on the floor — so a lobbed stick leaves the hand at the
 * held size and grows into the floor sprite as it lands.
 */
const LOB_START_SCALE = 0.6;

/**
 * What one blast does to each enemy caught in it, rounded to a whole point.
 *
 * Enemies only: the crawlers' own share of a blast is {@link dynamiteCrawlerDamage},
 * which neither the thrower's level nor this multiplier touches, so training the
 * skill never makes a fumbled stick deadlier to the pair who lit it.
 */
export function dynamiteMobDamage(throwerLevel: number, explosivesLevel: number): number {
  const throwerLevelsAboveFirst = Math.max(0, throwerLevel - 1);
  const handlingLevelsAboveFirst = Math.max(0, explosivesLevel - 1);
  const throwerLevelMultiplier = Math.min(
    MAX_DYN_THROWER_LEVEL_MULTIPLIER,
    1 + DYN_MOB_DAMAGE_FRACTION_PER_THROWER_LEVEL * throwerLevelsAboveFirst,
  );
  const levelledStick = DYN_DAMAGE * throwerLevelMultiplier;
  const handlingMultiplier =
    1 + DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL * handlingLevelsAboveFirst;
  return Math.round(levelledStick * handlingMultiplier);
}

/** What one blast does to the human or the cat when either stands inside it. */
export function dynamiteCrawlerDamage(explosivesLevel: number): number {
  const handlingLevelsAboveFirst = Math.max(0, explosivesLevel - 1);
  return DYN_DAMAGE + handlingLevelsAboveFirst * DYN_CRAWLER_DAMAGE_PER_LEVEL;
}

/**
 * What one blast does to a particular mob caught in it.
 *
 * An ally takes the crawlers' share rather than the enemies': the skill trains
 * the human to hurt what he is fighting, and a companion standing in the blast
 * is exactly as unlucky as the cat would be. A boss takes its
 * {@link Mob.blastDamageScale} share, so a bag of sticks cannot skip its fight,
 * but never less than the crawlers' share.
 */
export function dynamiteDamageToMob(
  mob: Pick<Mob, 'isHostile' | 'blastDamageScale'>,
  mobDamage: number,
  crawlerDamage: number,
): number {
  if (!mob.isHostile) return crawlerDamage;
  const scaledEnemyDamage = Math.max(1, Math.round(mobDamage * mob.blastDamageScale));
  const isBlastResistant = mob.blastDamageScale < 1;
  if (!isBlastResistant) return scaledEnemyDamage;
  // A boss never resists a stick more than a crawler does. The scale is there
  // to stop the level-grown number deleting a boss, and early on that number
  // times the scale falls below what an untrained stick did before it grew.
  return Math.max(crawlerDamage, scaledEnemyDamage);
}

interface LiveDynamite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseFrames: number;
  state: 'flying' | 'sliding' | 'stopped';
  /** Taken at throw time, so a level-up while the fuse burns cannot change the stick. */
  mobDamage: number;
  /** Taken at throw time, for the same reason as {@link mobDamage}. */
  crawlerDamage: number;
  /**
   * The world point the stick left his hand at, which its drawn position
   * closes from onto its body over the lob — null on a stick that never left
   * a hand — and how many frames of the lob have run.
   */
  lobFrom: Pt | null;
  lobFrame: number;
  /** How high the lob arcs, in tiles; set at launch by {@link lobArcTiles}. */
  lobArc: number;
}

/** What one stick brings to a blast, whether lying on the floor or still in his hand. */
type BlastCharge = Pick<LiveDynamite, 'x' | 'y' | 'mobDamage' | 'crawlerDamage'>;

/**
 * One detonation — a single stick, or every stick a chain reaction swept up.
 *
 * The per-stick figures are kept beside the chained totals because a
 * blast-resistant mob takes only one stick's share, chain or no chain: a boss's
 * health bar must be a question of how the fight was played, not of how many
 * sticks were piled up before it.
 */
interface Blast {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly mobDamage: number;
  readonly crawlerDamage: number;
  readonly stickMobDamage: number;
  readonly stickCrawlerDamage: number;
}

/** A blast's picture, aged every tick until its smoke has cleared. */
interface LiveExplosion {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly coreRadius: number;
  readonly cores: ReadonlyArray<BlastCore>;
  ageFrames: number;
}

interface ScorchMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly seed: number;
  ageFrames: number;
}

/** A stick released and waiting for the throw's release frame to leave his hand. */
interface PendingThrow {
  readonly stick: LiveDynamite;
  /** Ticks since the key was let go, which the fuse is charged when it launches. */
  ticksPending: number;
  /** Puts the stick in the world, from his throwing hand or from his centre. */
  readonly launch: (fromHand: boolean) => void;
}

export class DynamiteSystem implements GameSystem {
  private _charging: {
    hotbarIdx: number;
    chargeFrames: number;
    /** Whether the fuse has been drawn catching, so a light cut short is not played twice. */
    lit: boolean;
    /** The view whose hold and throw have been warmed, null before the first tick. */
    warmedView: CarlView | null;
  } | null = null;
  private pendingThrow: PendingThrow | null = null;
  private liveDynamites: LiveDynamite[] = [];
  private explosions: LiveExplosion[] = [];
  private scorches: ScorchMark[] = [];
  private blastCount = 0;
  /** Set each time a stick goes off; `DestructionKit` reads and clears it to sound the blast. */
  explosionSoundPending = false;
  /**
   * Told of every blast's centre and radius, in world pixels, so built
   * structures — walls, trebuchets, snares — take their share. Any bomb goes
   * through here, the party's own included.
   */
  onStructureBlast: ((cx: number, cy: number, radiusPx: number) => void) | null = null;

  /** Counts {@link update} calls, so a blast cooldown can be read against it. */
  private frame = 0;
  /**
   * The frame each blast-resistant mob was last hurt by a blast. Weak, so a mob
   * dropped from the floor is not pinned here.
   */
  private lastBlastFrame = new WeakMap<Mob, number>();

  private _trajectoryCache: Array<{ x: number; y: number }> | null = null;
  private _trajCacheKey = '';

  constructor(
    private readonly gameMap: GameMap,
    /**
     * Defaulted for a caller with no prop system at all. `DestructionKit`, which
     * is the only thing that builds one of these, always hands over its own.
     */
    private readonly destructibles: DestructiblePropSystem | null = null,
    /**
     * Read at blast time rather than held, because the tree system is built
     * *from* the loot system this one's owner also builds — a plain reference
     * would make the two constructions circular. Returns null off the overworld,
     * which is the only map that grows trees.
     */
    private readonly trees: () => TreeSystem | null = () => null,
    /** Absent in scenes that run no event bus; the blast then simply goes unreported. */
    private readonly bus: EventBus | null = null,
  ) {}

  /** Drops any thrown/charging dynamite — used on a checkpoint respawn. */
  resetForCheckpoint(): void {
    this._charging = null;
    this.pendingThrow = null;
    this.liveDynamites = [];
    this.explosions = [];
    this.scorches = [];
    this.lastBlastFrame = new WeakMap<Mob, number>();
  }

  /**
   * Where a blast may soon go off: every stick alight in the world, and the
   * thrower himself while he holds one lit or is about to let it go — a
   * warning for anything that has to get ready for the bang before it lands.
   * `radiusPx` is how far the blast reaches from where it goes off; a stick
   * still in hand has not chosen where that is.
   */
  pendingBlastPoints(
    human: HumanPlayer,
  ): Array<{ x: number; y: number; inHand: boolean; radiusPx: number }> {
    const points = this.liveDynamites.map((stick) => ({
      x: stick.x,
      y: stick.y,
      inHand: false,
      radiusPx: DYN_RADIUS,
    }));
    if (this._charging !== null || this.pendingThrow !== null) {
      points.push({
        x: human.x + HALF_TILE,
        y: human.y + HALF_TILE,
        inHand: true,
        radiusPx: DYN_RADIUS,
      });
    }
    return points;
  }

  get isCharging(): boolean {
    return this._charging !== null;
  }

  get chargeFrames(): number {
    return this._charging?.chargeFrames ?? 0;
  }

  get chargingHotbarIdx(): number | null {
    return this._charging?.hotbarIdx ?? null;
  }

  /**
   * Starts lighting a stick. Refused in the safe room, which is a sanctuary
   * for the crawlers and not a bunker to bomb out of.
   *
   * @returns whether the light began; a refusal is the caller's to explain.
   */
  beginCharge(hotbarIdx: number, human: HumanPlayer): boolean {
    if (human.isProtected) return false;
    this._charging = { hotbarIdx, chargeFrames: 0, lit: false, warmedView: null };
    return true;
  }

  release(human: HumanPlayer): void {
    if (!this._charging) return;
    // A freeze landed mid-charge: the stick goes back in the bag unburned,
    // the same as walking into the safe room with one lit, rather than
    // throwing from hands that can no longer act.
    if (!human.canAct) {
      this._charging = null;
      this.stopDynamiteAction(human);
      return;
    }
    const { chargeFrames } = this._charging;
    this._charging = null;

    // With no stick left to throw — the last one sold or dropped mid-charge —
    // the light or the hold he is posed in has nothing in its hand.
    if (!human.inventory.removeOne('goblin_dynamite')) {
      this.stopDynamiteAction(human);
      return;
    }

    const isTap = chargeFrames < DYN_TAP;
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const expLvl = human.explosivesHandling;
    const speedMax = DYN_SPEED_MAX + (expLvl - 1) * DYN_SPEED_PER_LEVEL;
    const speed = isTap ? 0 : DYN_SPEED_MIN + (speedMax - DYN_SPEED_MIN) * chargeRatio;

    const stick: LiveDynamite = {
      x: human.x + HALF_TILE,
      y: human.y + HALF_TILE,
      vx: human.facingX * speed,
      vy: human.facingY * speed,
      fuseFrames: DYN_FUSE,
      state: isTap ? 'stopped' : 'flying',
      mobDamage: dynamiteMobDamage(human.level, expLvl),
      crawlerDamage: dynamiteCrawlerDamage(expLvl),
      lobFrom: null,
      lobArc: 0,
      lobFrame: 0,
    };
    if (isTap) {
      this.stopDynamiteAction(human);
      this.liveDynamites.push(stick);
      return;
    }
    this.throwFromHand(human, stick);
  }

  /**
   * Has him throw `stick`, and launches it on the frame it leaves his hand —
   * from that hand — or at once from his centre if he cannot throw right now
   * (mid-blow, reeling, out cold). A throw cut short before its release frame
   * still launches the stick, from his centre: the item is already spent.
   */
  private throwFromHand(human: HumanPlayer, stick: LiveDynamite): void {
    // A second release can land before the first throw reaches its release
    // frame; the new throw row replaces the old one, whose own end is then no
    // longer the pending throw's and would drop a stick already paid for.
    this.flushPendingThrow();
    const view = viewForFacing(human.facingX, human.facingY);
    const row = THROW_ROWS[view];
    const releaseFrame = eventFrame(row, 'release');
    const pending: PendingThrow = {
      stick,
      ticksPending: 0,
      launch: (fromHand) => {
        if (this.pendingThrow !== pending) return;
        this.pendingThrow = null;
        // The fuse is lit from the key's release, not from the frame the stick
        // leaves his hand, so a throw's windup never delays the blast the
        // player timed.
        stick.fuseFrames -= pending.ticksPending;
        if (fromHand) {
          stick.lobFrom = human.handWorldPosition(DYNAMITE_THROWING_HAND);
          stick.lobArc = lobArcTiles(stick.vx, stick.vy);
        }
        this.liveDynamites.push(stick);
      },
    };
    this.pendingThrow = pending;
    const accepted =
      releaseFrame !== undefined &&
      human.playAction(row, {
        faceX: human.facingX,
        faceY: human.facingY,
        onFrame: [{ frame: releaseFrame, run: () => pending.launch(true) }],
        onEnd: (reason) => {
          // Under the death screen the stick never leaves his hand: the world
          // it would land in is about to be rewound or rebuilt.
          if (reason === 'defeated') this.dropPendingThrow(pending);
          else pending.launch(false);
        },
      });
    if (!accepted) pending.launch(false);
  }

  /** Launches a stick still waiting on its throw, from his centre. */
  private flushPendingThrow(): void {
    this.pendingThrow?.launch(false);
  }

  /** Forgets a throw that will never launch, so no later throw flushes it into the world. */
  private dropPendingThrow(pending: PendingThrow): void {
    if (this.pendingThrow === pending) this.pendingThrow = null;
  }

  /**
   * Keeps him posed for the charge: lighting the stick until the fuse has
   * caught, then holding it cocked. Asked again whenever the row he is drawn
   * in is not the one wanted — he walked and the stride took over, or he
   * turned and the view changed — and only while he stands still, since
   * moving ends an action on its first step anyway.
   */
  private poseForCharge(human: HumanPlayer): void {
    const charging = this._charging;
    if (charging === null) return;
    const view = viewForFacing(human.facingX, human.facingY);
    // The light buys the better part of a second, which is lead enough to
    // bake the hold and the throw before either is drawn. Turning mid-charge
    // warms the new view's pair the same way: its throw can be let go at once.
    if (charging.warmedView !== view) {
      charging.warmedView = view;
      prewarmHumanRow(HOLD_ROWS[view]);
      prewarmHumanRow(THROW_ROWS[view]);
    }
    if (human.isMoving) return;
    const row = charging.lit ? HOLD_ROWS[view] : LIGHT_ROWS[view];
    const drawn = human.spriteSelection();
    const facesLeft = human.facingX < 0;
    const flipMatches = view !== 'side' || drawn.flipX === facesLeft;
    if (human.isActing && drawn.row === row && flipMatches) return;
    // The fuse catches partway through the light; the rest of it — the draw
    // back into the stance — plays out before the hold takes over.
    const lightRow = LIGHT_ROWS[view];
    const lightStillPlaying =
      drawn.row === lightRow && drawn.frame < (humanRowOf(lightRow)?.frameCount ?? 0) - 1;
    if (human.isActing && lightStillPlaying && flipMatches) return;
    if (human.isActing && !ALL_DYNAMITE_ROWS.has(drawn.row)) return;
    const fuseFrame = eventFrame(row, 'fuseLit');
    const lightFuse = (): void => {
      charging.lit = true;
    };
    // The light holds its last frame — the cocked stance the hold loops on —
    // so there is no tick of standing between the two rows.
    human.playAction(row, {
      loop: charging.lit,
      holdLastFrame: !charging.lit,
      faceX: human.facingX,
      faceY: human.facingY,
      onFrame: fuseFrame === undefined ? [] : [{ frame: fuseFrame, run: lightFuse }],
    });
  }

  /** Ends a light or a hold he is still drawn in, handing him back to standing. */
  private stopDynamiteAction(human: HumanPlayer): void {
    if (human.isActing && ALL_DYNAMITE_ROWS.has(human.spriteSelection().row)) human.stopAction();
  }

  update(ctx: SystemContext): void {
    this.frame++;
    const { human, cat } = ctx;
    const { grid: mobGrid } = ctx.roster;
    // Walking into the safe room with a stick alight snuffs it: the stick is
    // only spent on release, so it goes back in the bag unburned.
    if (this._charging !== null && human.isProtected) {
      this._charging = null;
      this.stopDynamiteAction(human);
    }
    if (this._charging) {
      this._charging.chargeFrames++;
      if (this._charging.chargeFrames >= DYN_EXPLODE_HAND) {
        this.explodeInHand(human, cat, mobGrid);
        return;
      }
      this.poseForCharge(human);
    }
    if (this.pendingThrow !== null) this.pendingThrow.ticksPending++;
    this.updatePhysics(human, cat, mobGrid);
  }

  private explodeInHand(human: HumanPlayer, cat: CatPlayer, mobGrid: SpatialGrid<Mob>): void {
    this._charging = null;
    this.stopDynamiteAction(human);
    // The stick is spent by going off, exactly as by being thrown. With none
    // left — the last one dropped mid-charge — there is nothing in his hand.
    if (!human.inventory.removeOne('goblin_dynamite')) return;
    const inHand: BlastCharge = {
      x: human.x + HALF_TILE,
      y: human.y + HALF_TILE,
      mobDamage: dynamiteMobDamage(human.level, human.explosivesHandling),
      crawlerDamage: dynamiteCrawlerDamage(human.explosivesHandling),
    };
    this.detonate(inHand, human, cat, mobGrid);
  }

  /**
   * Sets off `trigger` and every stick lying within a blast's reach of it, and
   * of each of those in turn, as one blast.
   */
  private detonate(
    trigger: BlastCharge,
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const chain = this.sweepChain(trigger);
    const blast = chainedBlast(chain);
    this.blastCount++;
    const seed = this.blastCount * BLAST_SEED_STRIDE;
    const fireballScale = Math.min(
      CHAIN_MAX_FIREBALL_SCALE,
      1 + CHAIN_FIREBALL_GROWTH_PER_STICK * (chain.length - 1),
    );
    this.explosions.push({
      x: blast.x,
      y: blast.y,
      radius: blast.radius,
      coreRadius: DYN_RADIUS * fireballScale,
      cores: chain.map((stick, index) => ({
        x: stick.x,
        y: stick.y,
        delayFrames: Math.round(
          Math.hypot(stick.x - trigger.x, stick.y - trigger.y) / CHAIN_RIPPLE_PX_PER_FRAME,
        ),
        seed: seed + index,
      })),
      ageFrames: 0,
    });
    this.scorches.push({ x: blast.x, y: blast.y, radius: blast.radius, seed, ageFrames: 0 });
    this.triggerExplosion(blast, human, cat, mobGrid);
  }

  /**
   * `trigger` followed by every stick still in the world that a blast in the
   * chain reaches, each removed from the world as it is swept up.
   */
  private sweepChain(trigger: BlastCharge): BlastCharge[] {
    const chain: BlastCharge[] = [trigger];
    // A for-of over an array visits what is pushed onto it mid-loop, which is
    // what walks the chain out to every stick each newly caught one reaches.
    for (const source of chain) {
      const caught = this.liveDynamites.filter(
        (stick) => Math.hypot(stick.x - source.x, stick.y - source.y) <= DYN_RADIUS,
      );
      if (caught.length === 0) continue;
      this.liveDynamites = this.liveDynamites.filter((stick) => !caught.includes(stick));
      chain.push(...caught);
    }
    return chain;
  }

  private triggerExplosion(
    blast: Blast,
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const { x: cx, y: cy, radius } = blast;
    this.explosionSoundPending = true;
    this.onStructureBlast?.(cx, cy, radius);
    const nearBlast = mobGrid.queryCircle(cx, cy, radius + TILE_SIZE);
    if (!human.zeroDamage) {
      let enemyKills = 0;
      let bossKilled = false;
      for (const mob of nearBlast) {
        // Allies included, which is the point of the type: a blast is the one
        // player-sourced damage that ignores friendly-fire immunity, exactly as
        // it already ignores the pair who lit it.
        if (!mob.isAlive || !mob.takesPlayerDamage('explosion')) continue;
        if (Math.hypot(mob.x + HALF_TILE - cx, mob.y + HALF_TILE - cy) <= radius) {
          if (this.isBlastCoolingDown(mob)) continue;
          const isBlastResistant = mob.blastDamageScale < 1;
          const damage = isBlastResistant
            ? dynamiteDamageToMob(mob, blast.stickMobDamage, blast.stickCrawlerDamage)
            : dynamiteDamageToMob(mob, blast.mobDamage, blast.crawlerDamage);
          // Death resolves synchronously inside `takeDamageFrom`, so the health
          // either side of the call is what says whether this blast did it. The
          // `justDied` flag cannot answer: it stays latched for a whole frame.
          const wasAlive = mob.hp > 0;
          mob.takeDamageFrom(damage, human, 'explosion');
          // Only an enemy is a kill: an ally or a village cow caught in the
          // blast is a casualty, and a multi-kill of livestock is no feat.
          if (wasAlive && mob.hp <= 0 && mob.isHostile) {
            enemyKills++;
            if (mob.isBoss) bossKilled = true;
          }
        }
      }
      if (enemyKills > 0) {
        this.bus?.emit('multiKill', { killer: human, count: enemyKills });
      }
      if (enemyKills > 0) {
        this.bus?.emit('dynamiteKills', { killer: human, kills: enemyKills, bossKilled });
      }
    }
    if (Math.hypot(human.x + HALF_TILE - cx, human.y + HALF_TILE - cy) <= radius) {
      human.takeDamage(blast.crawlerDamage, { kind: 'dynamite' });
    }
    if (Math.hypot(cat.x + HALF_TILE - cx, cat.y + HALF_TILE - cy) <= radius) {
      cat.takeDamage(blast.crawlerDamage, { kind: 'dynamite' });
    }
    // Flattened outright rather than damaged: a barrel that survives a stick of
    // dynamite reads as a bug, however much health it had left. The same goes
    // for a tree, tough as one otherwise is.
    this.destructibles?.destroyInRadius(cx, cy, radius, human);
    const trees = this.trees();
    trees?.destroyInRadius(cx, cy, radius, human);
    // Ignition second, and deliberately: the ring reaches back over the blast
    // radius, and setting fire to the trees first would leave the ones inside it
    // burning as they came down.
    trees?.igniteRadius(cx, cy, radius + EXPLOSION_IGNITE_RING_TILES * TILE_SIZE);
    this.bus?.emit('blastLanded', { x: cx, y: cy, radiusPx: radius });
  }

  /** Whether a blast-resistant mob is still inside its window from the last blast; stamps a new one if not. */
  private isBlastCoolingDown(mob: Mob): boolean {
    const isBlastResistant = mob.blastDamageScale < 1;
    if (!isBlastResistant) return false;
    const lastBlast = this.lastBlastFrame.get(mob);
    if (lastBlast !== undefined && this.frame - lastBlast < BLAST_RESISTANT_COOLDOWN_FRAMES) {
      return true;
    }
    this.lastBlastFrame.set(mob, this.frame);
    return false;
  }

  private updatePhysics(human: HumanPlayer, cat: CatPlayer, mobGrid: SpatialGrid<Mob>): void {
    for (const explosion of this.explosions) explosion.ageFrames++;
    this.explosions = this.explosions.filter((e) => e.ageFrames < EXPLOSION_TOTAL_FRAMES);
    for (const scorch of this.scorches) scorch.ageFrames++;
    this.scorches = this.scorches.filter((mark) => mark.ageFrames < SCORCH_TOTAL_FRAMES);

    for (const dyn of this.liveDynamites) {
      dyn.fuseFrames--;
      if (dyn.lobFrame < LOB_FRAMES) dyn.lobFrame++;
      if (dyn.state === 'stopped') continue;

      const nextX = dyn.x + dyn.vx;
      const txX = Math.floor(nextX / TILE_SIZE);
      const ty = Math.floor(dyn.y / TILE_SIZE);
      if (!this.gameMap.isWalkable(txX, ty)) {
        dyn.vx = -dyn.vx * DYN_BOUNCE;
      } else {
        dyn.x = nextX;
      }

      const nextY = dyn.y + dyn.vy;
      const tx = Math.floor(dyn.x / TILE_SIZE);
      const tyY = Math.floor(nextY / TILE_SIZE);
      if (!this.gameMap.isWalkable(tx, tyY)) {
        dyn.vy = -dyn.vy * DYN_BOUNCE;
      } else {
        dyn.y = nextY;
      }

      dyn.vx *= DYN_FRICTION;
      dyn.vy *= DYN_FRICTION;
      const spd = Math.hypot(dyn.vx, dyn.vy);
      if (spd < DYN_STOP) {
        dyn.state = 'stopped';
        dyn.vx = 0;
        dyn.vy = 0;
      } else if (spd < DYN_SLIDE_THRESHOLD) {
        dyn.state = 'sliding';
      }
    }

    // After the physics, so a chain is swept from where every stick lies this
    // frame. Each detonation removes its whole chain from the world, which is
    // why the next burnt-out fuse is looked up afresh rather than iterated.
    let burntOut = this.liveDynamites.find((dyn) => dyn.fuseFrames <= 0);
    while (burntOut !== undefined) {
      const trigger = burntOut;
      this.liveDynamites = this.liveDynamites.filter((dyn) => dyn !== trigger);
      this.detonate(trigger, human, cat, mobGrid);
      burntOut = this.liveDynamites.find((dyn) => dyn.fuseFrames <= 0);
    }
  }

  /** The blackened floor under past blasts; drawn in the ground pass, under everything standing on it. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const mark of this.scorches) {
      drawScorchMark(ctx, mark.x - camX, mark.y - camY, mark.radius, mark.seed, mark.ageFrames);
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dyn of this.liveDynamites) {
      this.renderStick(ctx, dyn, dyn.x - camX, dyn.y - camY);
    }
    for (const explosion of this.explosions) {
      drawDynamiteExplosion(ctx, explosion, camX, camY);
    }
  }

  /**
   * A stick where it is drawn: over its body once it has settled, and on the
   * way there from the hand that threw it — closing on the body along an arc
   * above the straight line, tumbling end over end as it goes.
   */
  private renderStick(
    ctx: CanvasRenderingContext2D,
    dyn: LiveDynamite,
    sx: number,
    sy: number,
  ): void {
    const lobFrom = dyn.lobFrame < LOB_FRAMES ? dyn.lobFrom : null;
    if (lobFrom === null) {
      drawDynamiteFloorSprite(
        ctx,
        sx - HALF_TILE,
        sy - HALF_TILE,
        TILE_SIZE,
        dyn.fuseFrames,
        DYN_FUSE,
      );
      return;
    }
    const progress = dyn.lobFrame / LOB_FRAMES;
    const closed = easeOut(progress);
    const arc = PARABOLA_PEAK_GAIN * progress * (1 - progress) * dyn.lobArc * TILE_SIZE;
    // Measured against where the body is now, not where it was launched: the
    // drawn stick is a blend of the hand and the body, so on its first frame
    // it is at the fist however far the body has already flown.
    const drawnX = sx + (lobFrom.x - dyn.x) * (1 - closed);
    const drawnY = sy + (lobFrom.y - dyn.y) * (1 - closed) - arc;
    ctx.save();
    ctx.translate(drawnX, drawnY);
    ctx.rotate(progress * LOB_TUMBLE_TURNS * Math.PI * 2);
    const scale = LOB_START_SCALE + (1 - LOB_START_SCALE) * closed;
    ctx.scale(scale, scale);
    drawDynamiteFloorSprite(ctx, -HALF_TILE, -HALF_TILE, TILE_SIZE, dyn.fuseFrames, DYN_FUSE);
    ctx.restore();
  }

  renderChargeBar(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number): void {
    if (!this._charging) return;
    const ratio = Math.min(1, this._charging.chargeFrames / DYN_MAX_CHARGE);
    drawDynamiteChargeBar(ctx, canvasW, canvasH, ratio, this._charging.chargeFrames, DYN_DANGER);
  }

  private simulateTrajectory(human: HumanPlayer): Array<{ x: number; y: number }> {
    const chargeFrames = this._charging?.chargeFrames ?? 0;
    if (chargeFrames < DYN_TAP) return [];

    const cacheKey = `${chargeFrames}|${human.facingX}|${human.facingY}|${Math.round(human.x)}|${Math.round(human.y)}|${human.explosivesHandling}`;
    if (this._trajectoryCache !== null && this._trajCacheKey === cacheKey) {
      return this._trajectoryCache;
    }

    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const expLvl = human.explosivesHandling;
    const speedMax = DYN_SPEED_MAX + (expLvl - 1) * DYN_SPEED_PER_LEVEL;
    const speed = DYN_SPEED_MIN + (speedMax - DYN_SPEED_MIN) * chargeRatio;

    const points: Array<{ x: number; y: number }> = [];
    let x = human.x + HALF_TILE;
    let y = human.y + HALF_TILE;
    let vx = human.facingX * speed;
    let vy = human.facingY * speed;

    points.push({ x, y });

    for (let frame = 0; frame < TRAJECTORY_MAX_FRAMES; frame++) {
      const nextX = x + vx;
      const txX = Math.floor(nextX / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      if (!this.gameMap.isWalkable(txX, ty)) {
        vx = -vx * DYN_BOUNCE;
      } else {
        x = nextX;
      }

      const nextY = y + vy;
      const tx = Math.floor(x / TILE_SIZE);
      const tyY = Math.floor(nextY / TILE_SIZE);
      if (!this.gameMap.isWalkable(tx, tyY)) {
        vy = -vy * DYN_BOUNCE;
      } else {
        y = nextY;
      }

      vx *= DYN_FRICTION;
      vy *= DYN_FRICTION;

      if (frame % TRAJECTORY_SAMPLE_INTERVAL === 0) {
        points.push({ x, y });
      }

      if (Math.hypot(vx, vy) < DYN_STOP) break;
    }

    this._trajectoryCache = points;
    this._trajCacheKey = cacheKey;
    return points;
  }

  renderThrowPath(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    human: HumanPlayer,
  ): void {
    if (!this._charging) return;

    const worldPoints = this.simulateTrajectory(human);
    if (worldPoints.length < 2) return;

    const screenPoints = worldPoints.map((p) => ({ x: p.x - camX, y: p.y - camY }));
    drawDynamiteThrowPath(ctx, screenPoints);
  }
}

/**
 * The single blast a chain of sticks makes.
 *
 * Centred on the chain's middle, and big enough to cover every stick's own
 * blast — the reach grows with the cube root of the charge, as a real blast
 * front's does, plus however far the chain is strung out. Enemies take every
 * stick's damage with {@link CHAIN_DAMAGE_BONUS} on top; the crawlers, and
 * allies, take every stick's share with no bonus.
 */
function chainedBlast(chain: ReadonlyArray<BlastCharge>): Blast {
  const stickCount = Math.max(1, chain.length);
  const centreX = chain.reduce((sum, stick) => sum + stick.x, 0) / stickCount;
  const centreY = chain.reduce((sum, stick) => sum + stick.y, 0) / stickCount;
  const furthestStick = chain.reduce(
    (furthest, stick) => Math.max(furthest, Math.hypot(stick.x - centreX, stick.y - centreY)),
    0,
  );
  const radius = Math.min(
    CHAIN_MAX_RADIUS_TILES * TILE_SIZE,
    DYN_RADIUS * Math.cbrt(stickCount) + furthestStick,
  );
  const totalMobDamage = chain.reduce((sum, stick) => sum + stick.mobDamage, 0);
  const isChain = stickCount > 1;
  return {
    x: centreX,
    y: centreY,
    radius,
    mobDamage: Math.round(isChain ? totalMobDamage * CHAIN_DAMAGE_BONUS : totalMobDamage),
    crawlerDamage: chain.reduce((sum, stick) => sum + stick.crawlerDamage, 0),
    stickMobDamage: chain.reduce((most, stick) => Math.max(most, stick.mobDamage), 0),
    stickCrawlerDamage: chain.reduce((most, stick) => Math.max(most, stick.crawlerDamage), 0),
  };
}
