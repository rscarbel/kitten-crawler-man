import type { GameMap } from '../map/GameMap';
import { resolveLobLanding } from './goblinBombConstants';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import type { TownInteriorPropDestructionSystem } from './TownInteriorPropDestructionSystem';
import { EXPLOSION_IGNITE_RING_TILES, type TreeSystem } from './TreeSystem';
import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { MAX_MOB_HP_MULTIPLIER } from '../creatures/mobLevelScaling';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  drawDynamiteFloorSprite,
  drawDynamiteRangeRing,
  drawDynamiteThrowPath,
} from '../sprites/dynamiteSprite';
import { drawBlackPowderBombFlight, drawThrownBombShadow } from '../sprites/blackPowderBombSprite';
import type { ItemId } from '../core/ItemDefs';
import type { ThrownPropVisualId } from '../sprites/held/heldVisualIds';
import type { Rect } from '../ui/core/geom';
import type { Surface, Ui } from '../ui/core/UiRoot';
import { skinsFor } from '../ui/theme/skins';
import { drawGlass, fillRounded } from '../ui/widgets/paint';
import { text } from '../ui/widgets/text';
import {
  type BlastCore,
  drawDynamiteExplosion,
  drawScorchMark,
  explosionLightRemaining,
  explosionTotalFrames,
  type ExplosionVariant,
  SCORCH_TOTAL_FRAMES,
} from '../sprites/dynamiteExplosion';
import type { GameSystem, SystemContext } from './GameSystem';
import {
  GAS_CYLINDER_CRAWLER_DAMAGE,
  GAS_CYLINDER_MOB_DAMAGE_FRACTION,
} from './destruction/serviceLevelPropKinds';
import type { DynamicLightSink } from './lighting/dynamicLights';
import type { EventBus } from '../core/EventBus';
import {
  eventFrame,
  type HumanRowName,
  humanRowOf,
  type ViewRows,
} from '../sprites/art/humanFigure';
import { DYNAMITE_THROWING_HAND } from '../sprites/art/human/actionsThrow';
import { type CarlRowView, prewarmHumanRow } from '../sprites/humanSprite';
import { easeOut, type Pt } from '../sprites/art/carlArt';

/** The explosives he throws through this system, by the item spent on each throw. */
export type ThrownExplosiveId = Extract<ItemId, 'goblin_dynamite' | 'black_powder_bomb'>;

/** What each explosive looks like in his throwing fist. */
const THROWN_EXPLOSIVE_LOOKS: Readonly<Record<ThrownExplosiveId, ThrownPropVisualId>> = {
  goblin_dynamite: 'prop_dynamite',
  black_powder_bomb: 'prop_black_powder_bomb',
};

export function isThrownExplosive(id: ItemId): id is ThrownExplosiveId {
  return id === 'goblin_dynamite' || id === 'black_powder_bomb';
}

/**
 * Which picture a blast is painted as. A chain takes the kind of whatever set
 * it off; a gas bottle's blast is drawn as dynamite.
 */
export type BlastKind = ExplosionVariant;

/** Frames of charge for a full-strength throw. */
export const DYN_MAX_CHARGE = 120;
/** Frames of charge after which the charge bar turns red, a second before the stick goes off in hand. */
export const DYN_DANGER = 240;
/** The charge meter's danger state blinks on and off every this many frames. */
const CHARGE_FLASH_FRAMES = 8;
/** Above this share of full strength the charge meter turns from green to yellow. */
const CHARGE_HIGH_POWER_FRACTION = 0.85;
const CHARGE_BAR_WIDTH = 20;
const CHARGE_BAR_HEIGHT = 150;
const CHARGE_BAR_RADIUS = 4;
/** Wide enough for the meter's "POWER" and "DANGER" captions. */
const CHARGE_FRAME_WIDTH = 64;
const CHARGE_TICK_QUARTER = 0.25;
const CHARGE_TICK_HALF = 0.5;
const CHARGE_TICK_THREE_QUARTERS = 0.75;
const CHARGE_TICK_FRACTIONS = [CHARGE_TICK_QUARTER, CHARGE_TICK_HALF, CHARGE_TICK_THREE_QUARTERS];
const CHARGE_TICK_THICKNESS = 1;
const CHARGE_POWER_LABEL = ['Throw', 'Power'] as const;
const CHARGE_DANGER_LABEL = ['⚠', 'Danger'] as const;

/**
 * How far a stick launched at `speed` px/frame slides before it stops, on open
 * floor. Friction takes the same share of its speed every frame, so the
 * distance is a geometric series; the last sliver below {@link DYN_STOP} is
 * under a pixel and ignored.
 */
function slideDistance(speed: number): number {
  return speed / (1 - DYN_FRICTION);
}

/** The launch speed that slides a stick `distance` px on open floor; the inverse of {@link slideDistance}. */
function launchSpeedFor(distance: number): number {
  return distance * (1 - DYN_FRICTION);
}

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
/**
 * How far past its own blast's edge a black powder bomb lands at the least, in
 * tiles. A bomb goes off where it lands, so a tap that dropped it at his feet
 * would only blow up the thrower: in open ground the shortest throw clears
 * him. A wall nearer than that still stops the lob at its foot, inside his own
 * blast, and the throw preview shows it landing there.
 */
const BLACK_POWDER_MIN_CLEARANCE_TILES = 0.5;
const BLACK_POWDER_MIN_THROW_PX = DYN_RADIUS + BLACK_POWDER_MIN_CLEARANCE_TILES * TILE_SIZE;
/** Ground covered per frame by a lobbed bomb; flight time follows from the distance. */
const BLACK_POWDER_FLIGHT_PX_PER_FRAME = 8;
const BLACK_POWDER_MIN_FLIGHT_FRAMES = 10;
const BLACK_POWDER_MAX_FLIGHT_FRAMES = 30;
/** Turns a bomb makes over a whole flight: a slow spin, not a tumble. */
const BLACK_POWDER_SPIN_TURNS = 0.6;
/** Spacing of the dots on a bomb's straight-line throw preview, in pixels. */
const BLACK_POWDER_PATH_SAMPLE_PX = 12;

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
 * A black powder bomb on its lob. Unlike a stick it has no physics body: its
 * landing point is fixed when it is thrown, cut short at the first wall on
 * the way, and it goes off on the frame it gets there.
 */
interface LiveBomb {
  /** Where its ground point starts: his centre, the same as a stick's body. */
  readonly fromX: number;
  readonly fromY: number;
  readonly landX: number;
  readonly landY: number;
  readonly flightFrames: number;
  readonly arcPx: number;
  /** The hand it left, which its drawn position closes from; null when thrown from his centre. */
  readonly handFrom: Pt | null;
  readonly mobDamage: number;
  readonly crawlerDamage: number;
  /** Keeps two bombs in the air from sparking in step. */
  readonly seed: number;
  frame: number;
}

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
  readonly kind: BlastKind;
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

/** A stick or bomb released and waiting for the throw's release frame to leave his hand. */
interface PendingThrow {
  /** Where a bomb will land; null for a stick, which is still a blast in his hand. */
  readonly landing: Pt | null;
  /** Ticks since the key was let go, which a stick's fuse is charged when it launches. */
  ticksPending: number;
  /** Puts it in the world, from his throwing hand or from his centre. */
  readonly launch: (fromHand: boolean) => void;
}

/** What a throw puts in the world once it leaves him, told how long it waited and which hand it left, if any. */
type ThrowPlacement = (ticksPending: number, hand: Pt | null) => void;

/** He has something in hand: posed for it, with the views whose rows have been warmed. */
interface HeldExplosive {
  readonly item: ThrownExplosiveId;
  /** The view whose rows have been warmed, null before the first tick. */
  warmedView: CarlRowView | null;
}

/** A blast's light reaches past its damage radius by this much. */
const BLAST_LIGHT_REACH_SCALE = 1.5;
/** The least a blast lights, in tiles, however small its radius. */
const BLAST_LIGHT_MIN_REACH_TILES = 3;

export class DynamiteSystem implements GameSystem {
  private _charging:
    | (HeldExplosive & {
        hotbarIdx: number;
        chargeFrames: number;
        /** Whether the fuse has been drawn catching, so a light cut short is not played twice. */
        lit: boolean;
      })
    | null = null;
  /**
   * A stick in his hand, unlit, waiting for a tap on the world to say where it
   * goes — the touch screen's way to throw, where holding a hotbar slot down
   * while aiming with the same thumb is impractical. Nothing burns while it
   * is held, so it can wait out a menu or a conversation.
   */
  private _readied: HeldExplosive | null = null;
  private pendingThrow: PendingThrow | null = null;
  private liveDynamites: LiveDynamite[] = [];
  private liveBombs: LiveBomb[] = [];
  private explosions: LiveExplosion[] = [];
  private scorches: ScorchMark[] = [];
  private blastCount = 0;
  private bombsThrown = 0;
  /** Set each time a stick goes off; `DestructionKit` reads and clears it to sound the blast. */
  explosionSoundPending = false;
  /** The kind of the latest blast, for whatever sounds {@link explosionSoundPending}. */
  explosionSoundKind: BlastKind = 'dynamite';
  /**
   * Set when a thrown stick comes down out of the air; `DestructionKit` reads
   * and clears it. A stick dropped at his feet never flew, so it never lands.
   */
  stickLandSoundPending = false;
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

  /**
   * Set by the owning scene once a town interior's prop-destruction system
   * exists, which happens after this class is constructed (it is built off
   * `DestructionKit`'s loot system, and the interior prop system is built off
   * that same kit). Left null everywhere else, including on any dungeon floor.
   */
  interiorProps: TownInteriorPropDestructionSystem | null = null;

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
    this._readied = null;
    this.pendingThrow = null;
    this.liveDynamites = [];
    this.liveBombs = [];
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
    for (const bomb of this.liveBombs) {
      points.push({ x: bomb.landX, y: bomb.landY, inHand: false, radiusPx: DYN_RADIUS });
    }
    const pendingLanding = this.pendingThrow?.landing ?? null;
    if (pendingLanding !== null) {
      points.push({
        x: pendingLanding.x,
        y: pendingLanding.y,
        inHand: false,
        radiusPx: DYN_RADIUS,
      });
    }
    // A bomb never goes off in his hand, so only a stick warns from there.
    const stickInHand =
      this._charging?.item === 'goblin_dynamite' ||
      (this.pendingThrow !== null && pendingLanding === null);
    if (stickInHand) {
      points.push({
        x: human.x + HALF_TILE,
        y: human.y + HALF_TILE,
        inHand: true,
        radiusPx: DYN_RADIUS,
      });
    }
    return points;
  }

  /** A blast lights the room it goes off in, dying away with its fireball. */
  collectLights(sink: DynamicLightSink): void {
    for (const explosion of this.explosions) {
      const remaining = explosionLightRemaining(explosion.kind, explosion.ageFrames);
      const reachTiles = Math.max(BLAST_LIGHT_MIN_REACH_TILES, explosion.radius / TILE_SIZE);
      sink.add(
        explosion.x,
        explosion.y,
        'explosion',
        remaining,
        reachTiles * BLAST_LIGHT_REACH_SCALE,
      );
    }
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

  /** What he is charging a throw of, null when he is not. */
  get chargingItem(): ThrownExplosiveId | null {
    return this._charging?.item ?? null;
  }

  /** Whether he holds an unlit stick or bomb waiting for a tap to throw it. */
  get isReadied(): boolean {
    return this._readied !== null;
  }

  /** What he holds waiting for a tap, null when nothing is readied. */
  get readiedItem(): ThrownExplosiveId | null {
    return this._readied?.item ?? null;
  }

  /**
   * Puts an unlit `item` in his hand, to be thrown by {@link throwReadiedAt}.
   * Refused in the safe room for the same reason as {@link beginCharge}, and
   * with none to hold.
   *
   * @returns whether he took one in hand; a refusal is the caller's to explain.
   */
  ready(human: HumanPlayer, item: ThrownExplosiveId): boolean {
    if (human.isProtected || human.inventory.countOf(item) === 0) return false;
    this._charging = null;
    this._readied = { item, warmedView: null };
    human.takeExplosiveInHand(THROWN_EXPLOSIVE_LOOKS[item]);
    return true;
  }

  /** Puts a readied stick back in the bag, unspent. */
  putAway(human: HumanPlayer): void {
    if (this._readied === null) return;
    this._readied = null;
    this.stopDynamiteAction(human);
  }

  /**
   * Throws the readied stick at the world point `(targetX, targetY)`, lighting
   * its fuse as it goes. A target past his reach is thrown as far as he can,
   * along the same line; one at his feet is dropped there.
   *
   * @returns whether a stick was thrown or dropped.
   */
  throwReadiedAt(human: HumanPlayer, targetX: number, targetY: number): boolean {
    const readied = this._readied;
    if (readied === null || !human.canAct) return false;
    this._readied = null;
    if (!human.inventory.removeOne(readied.item)) {
      this.stopDynamiteAction(human);
      return false;
    }
    const originX = human.x + HALF_TILE;
    const originY = human.y + HALF_TILE;
    const toTargetX = targetX - originX;
    const toTargetY = targetY - originY;
    const targetDistance = Math.hypot(toTargetX, toTargetY);
    if (targetDistance > 0) {
      human.facingX = toTargetX / targetDistance;
      human.facingY = toTargetY / targetDistance;
    }
    const reach = slideDistance(this.maxThrowSpeed(human));
    if (readied.item === 'black_powder_bomb') {
      const distance = Math.max(this.bombMinThrow(reach), Math.min(targetDistance, reach));
      this.throwBomb(human, distance);
      return true;
    }
    const speed = launchSpeedFor(Math.min(targetDistance, reach));
    const dropsAtFeet = speed < DYN_SPEED_MIN;
    const expLvl = human.explosivesHandling;
    const stick: LiveDynamite = {
      x: originX,
      y: originY,
      vx: dropsAtFeet ? 0 : human.facingX * speed,
      vy: dropsAtFeet ? 0 : human.facingY * speed,
      fuseFrames: DYN_FUSE,
      state: dropsAtFeet ? 'stopped' : 'flying',
      mobDamage: dynamiteMobDamage(human.level, expLvl),
      crawlerDamage: dynamiteCrawlerDamage(expLvl),
      lobFrom: null,
      lobArc: 0,
      lobFrame: 0,
    };
    if (dropsAtFeet) {
      this.stopDynamiteAction(human);
      this.liveDynamites.push(stick);
      return true;
    }
    this.throwStick(human, stick);
    return true;
  }

  /** The fastest he can throw a stick, which his explosives handling raises. */
  private maxThrowSpeed(human: HumanPlayer): number {
    return DYN_SPEED_MAX + (human.explosivesHandling - 1) * DYN_SPEED_PER_LEVEL;
  }

  /** The shortest bomb throw, never past his longest. */
  private bombMinThrow(reach: number): number {
    return Math.min(BLACK_POWDER_MIN_THROW_PX, reach);
  }

  /** How far a bomb thrown on `chargeFrames` of charge flies: his shortest throw to his longest. */
  private bombThrowDistance(human: HumanPlayer, chargeFrames: number): number {
    const reach = slideDistance(this.maxThrowSpeed(human));
    const shortest = this.bombMinThrow(reach);
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    return shortest + (reach - shortest) * chargeRatio;
  }

  /**
   * Where a bomb thrown `distance` px from his centre the way he faces comes
   * down, by the same rule as a goblin's lob: it arcs over props, bodies and
   * built structures and stops at the foot of a real wall or building.
   */
  private bombLanding(human: HumanPlayer, distance: number): Pt {
    const origin = { x: human.x + HALF_TILE, y: human.y + HALF_TILE };
    const target = {
      x: origin.x + human.facingX * distance,
      y: origin.y + human.facingY * distance,
    };
    return resolveLobLanding(this.gameMap, origin, target);
  }

  /** Has him lob a bomb `distance` px the way he faces; it bursts where it lands. */
  private throwBomb(human: HumanPlayer, distance: number): void {
    const fromX = human.x + HALF_TILE;
    const fromY = human.y + HALF_TILE;
    const landing = this.bombLanding(human, distance);
    const flown = Math.hypot(landing.x - fromX, landing.y - fromY);
    const flightFrames = Math.round(
      Math.min(
        BLACK_POWDER_MAX_FLIGHT_FRAMES,
        Math.max(BLACK_POWDER_MIN_FLIGHT_FRAMES, flown / BLACK_POWDER_FLIGHT_PX_PER_FRAME),
      ),
    );
    const expLvl = human.explosivesHandling;
    const mobDamage = dynamiteMobDamage(human.level, expLvl);
    const crawlerDamage = dynamiteCrawlerDamage(expLvl);
    const arcPx = lobArcTiles(human.facingX, human.facingY) * TILE_SIZE;
    this.bombsThrown++;
    const seed = this.bombsThrown * BLAST_SEED_STRIDE;
    this.throwFromHand(human, landing, (_ticksPending, hand) => {
      this.liveBombs.push({
        fromX,
        fromY,
        landX: landing.x,
        landY: landing.y,
        flightFrames,
        arcPx,
        handFrom: hand,
        mobDamage,
        crawlerDamage,
        seed,
        frame: 0,
      });
    });
  }

  /**
   * Starts lighting a stick. Refused in the safe room, which is a sanctuary
   * for the crawlers and not a bunker to bomb out of.
   *
   * @returns whether the light began; a refusal is the caller's to explain.
   */
  beginCharge(hotbarIdx: number, human: HumanPlayer, item: ThrownExplosiveId): boolean {
    if (human.isProtected) return false;
    this._readied = null;
    this._charging = { item, hotbarIdx, chargeFrames: 0, lit: false, warmedView: null };
    human.takeExplosiveInHand(THROWN_EXPLOSIVE_LOOKS[item]);
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
    const { chargeFrames, item } = this._charging;
    this._charging = null;

    // With none left to throw — the last one sold or dropped mid-charge —
    // the light or the hold he is posed in has nothing in its hand.
    if (!human.inventory.removeOne(item)) {
      this.stopDynamiteAction(human);
      return;
    }
    if (item === 'black_powder_bomb') {
      this.throwBomb(human, this.bombThrowDistance(human, chargeFrames));
      return;
    }

    const isTap = chargeFrames < DYN_TAP;
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const expLvl = human.explosivesHandling;
    const speedMax = this.maxThrowSpeed(human);
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
    this.throwStick(human, stick);
  }

  /** Has him throw `stick`, its fuse burning from the key's release. */
  private throwStick(human: HumanPlayer, stick: LiveDynamite): void {
    this.throwFromHand(human, null, (ticksPending, hand) => {
      // The fuse is lit from the key's release, not from the frame the stick
      // leaves his hand, so a throw's windup never delays the blast the
      // player timed.
      stick.fuseFrames -= ticksPending;
      if (hand !== null) {
        stick.lobFrom = hand;
        stick.lobArc = lobArcTiles(stick.vx, stick.vy);
      }
      this.liveDynamites.push(stick);
    });
  }

  /**
   * Has him throw, and calls `place` on the frame it leaves his hand — with
   * that hand — or at once with no hand if he cannot throw right now
   * (mid-blow, reeling, out cold). A throw cut short before its release frame
   * still places it, from his centre: the item is already spent.
   */
  private throwFromHand(human: HumanPlayer, landing: Pt | null, place: ThrowPlacement): void {
    // A second release can land before the first throw reaches its release
    // frame; the new throw row replaces the old one, whose own end is then no
    // longer the pending throw's and would drop a stick already paid for.
    this.flushPendingThrow();
    const row = human.rowFacing(THROW_ROWS);
    const releaseFrame = eventFrame(row, 'release');
    const pending: PendingThrow = {
      landing,
      ticksPending: 0,
      launch: (fromHand) => {
        if (this.pendingThrow !== pending) return;
        this.pendingThrow = null;
        const hand = fromHand ? human.handWorldPosition(DYNAMITE_THROWING_HAND) : null;
        place(pending.ticksPending, hand);
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
    const view = human.rowViewFacing();
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
    const facesLeft = human.facingSelection.flipX;
    const mirrored = humanRowOf(row)?.mirrorable === true;
    const flipMatches = !mirrored || drawn.flipX === facesLeft;
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

  /**
   * Keeps him standing with the unlit stick hanging from his throwing hand:
   * the light row's first frame, held there by pacing it at zero. Re-asked
   * whenever he is drawn in anything else and stands free, as the charge pose is.
   */
  private poseForReadied(human: HumanPlayer, readied: HeldExplosive | null): void {
    if (readied === null) return;
    const view = human.rowViewFacing();
    // The throw follows a tap with no light to hide a bake behind, so its
    // rows are warmed while the stick is only held.
    if (readied.warmedView !== view) {
      readied.warmedView = view;
      prewarmHumanRow(LIGHT_ROWS[view]);
      prewarmHumanRow(THROW_ROWS[view]);
    }
    if (human.isMoving) return;
    const row = LIGHT_ROWS[view];
    const drawn = human.spriteSelection();
    const facesLeft = human.facingSelection.flipX;
    const mirrored = humanRowOf(row)?.mirrorable === true;
    const flipMatches = !mirrored || drawn.flipX === facesLeft;
    if (human.isActing && drawn.row === row && flipMatches) return;
    if (human.isActing && !ALL_DYNAMITE_ROWS.has(drawn.row)) return;
    human.playAction(row, {
      progress: () => 0,
      faceX: human.facingX,
      faceY: human.facingY,
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
    // A gas bottle whose fuse burnt out goes off through the same blast as a
    // stick — it hurts, knocks back and flattens the same way — but smaller and
    // weaker, at exactly the radius its fuse drew.
    for (const gas of this.destructibles?.drainDetonations() ?? []) {
      const charge: BlastCharge = {
        x: gas.x,
        y: gas.y,
        mobDamage: Math.round(dynamiteMobDamage(human.level, 0) * GAS_CYLINDER_MOB_DAMAGE_FRACTION),
        crawlerDamage: GAS_CYLINDER_CRAWLER_DAMAGE,
      };
      this.detonate(charge, 'dynamite', human, cat, mobGrid, gas.radiusPx);
    }
    // Walking into the safe room with a stick alight snuffs it: the stick is
    // only spent on release, so it goes back in the bag unburned.
    if (this._charging !== null && human.isProtected) {
      this._charging = null;
      this.stopDynamiteAction(human);
    }
    // The hotbar slot is the only way to put a readied stick back, so a stick
    // whose slot was emptied or rearranged away goes back on its own.
    const readiedItem = this._readied?.item ?? null;
    if (readiedItem !== null) {
      const heldOnHotbar = human.inventory.actionBar.slots.some((slot) => slot?.id === readiedItem);
      const cannotHold =
        !human.isActive ||
        human.isProtected ||
        !heldOnHotbar ||
        human.inventory.countOf(readiedItem) === 0;
      if (cannotHold) this.putAway(human);
    }
    this.poseForReadied(human, this._readied);
    if (this._charging) {
      this._charging.chargeFrames++;
      if (this._charging.item === 'black_powder_bomb') {
        // A bomb has no fuse to light while he winds up, so it is held the way
        // a readied one is and can never go off in his hand.
        this.poseForReadied(human, this._charging);
      } else if (this._charging.chargeFrames >= DYN_EXPLODE_HAND) {
        this.explodeInHand(human, cat, mobGrid);
        return;
      } else {
        this.poseForCharge(human);
      }
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
    this.detonate(inHand, 'dynamite', human, cat, mobGrid);
  }

  /**
   * Sets off `trigger` and every stick lying within a blast's reach of it, and
   * of each of those in turn, as one blast.
   */
  private detonate(
    trigger: BlastCharge,
    kind: BlastKind,
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
    fixedRadiusPx: number | null = null,
  ): void {
    // A blast with a fixed radius — a gas bottle's — stands alone: sweeping the
    // sticks lying round it into a chain would grow it past the ring its fuse
    // drew on the floor.
    const chain = fixedRadiusPx === null ? this.sweepChain(trigger) : [trigger];
    const chained = chainedBlast(chain);
    const blast = fixedRadiusPx === null ? chained : { ...chained, radius: fixedRadiusPx };
    this.blastCount++;
    const seed = this.blastCount * BLAST_SEED_STRIDE;
    const fireballScale = Math.min(
      CHAIN_MAX_FIREBALL_SCALE,
      1 + CHAIN_FIREBALL_GROWTH_PER_STICK * (chain.length - 1),
    );
    this.explosions.push({
      kind,
      x: blast.x,
      y: blast.y,
      radius: blast.radius,
      coreRadius: (fixedRadiusPx ?? DYN_RADIUS) * fireballScale,
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
    this.explosionSoundKind = kind;
    this.bus?.emit('explosiveDetonated', { x: blast.x, y: blast.y, kind });
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
    this.interiorProps?.destroyInRadius(cx, cy, radius);
    const trees = this.trees();
    trees?.destroyInRadius(cx, cy, radius);
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
    this.explosions = this.explosions.filter((e) => e.ageFrames < explosionTotalFrames(e.kind));
    for (const scorch of this.scorches) scorch.ageFrames++;
    this.scorches = this.scorches.filter((mark) => mark.ageFrames < SCORCH_TOTAL_FRAMES);

    for (const dyn of this.liveDynamites) {
      dyn.fuseFrames--;
      if (dyn.lobFrame < LOB_FRAMES) {
        dyn.lobFrame++;
        // A thrown stick is drawn in the air until its lob ends, whatever its
        // body is doing, so that is when it is heard hitting the floor.
        const lobEndsNow = dyn.lobFrom !== null && dyn.lobFrame === LOB_FRAMES;
        if (lobEndsNow) this.stickLandSoundPending = true;
      }
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
      const settlesWithoutLob = dyn.lobFrom === null && dyn.state === 'flying';
      if (settlesWithoutLob && spd < DYN_SLIDE_THRESHOLD) this.stickLandSoundPending = true;
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
      this.detonate(trigger, 'dynamite', human, cat, mobGrid);
      burntOut = this.liveDynamites.find((dyn) => dyn.fuseFrames <= 0);
    }

    for (const bomb of this.liveBombs) bomb.frame++;
    const landed = this.liveBombs.filter((bomb) => bomb.frame >= bomb.flightFrames);
    if (landed.length === 0) return;
    this.liveBombs = this.liveBombs.filter((bomb) => bomb.frame < bomb.flightFrames);
    for (const bomb of landed) {
      const charge: BlastCharge = {
        x: bomb.landX,
        y: bomb.landY,
        mobDamage: bomb.mobDamage,
        crawlerDamage: bomb.crawlerDamage,
      };
      this.detonate(charge, 'black_powder', human, cat, mobGrid);
    }
  }

  /** The blackened floor under past blasts; drawn in the ground pass, under everything standing on it. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const mark of this.scorches) {
      drawScorchMark(ctx, mark.x - camX, mark.y - camY, mark.radius, mark.seed, mark.ageFrames);
    }
    // In the ground pass so a bomb's shadow lies under the creatures it passes over.
    for (const bomb of this.liveBombs) {
      const now = bombPointAt(bomb, bomb.frame);
      drawThrownBombShadow(ctx, now.x - camX, now.groundY - camY, now.height, TILE_SIZE);
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dyn of this.liveDynamites) {
      this.renderStick(ctx, dyn, dyn.x - camX, dyn.y - camY);
    }
    for (const bomb of this.liveBombs) this.renderBomb(ctx, bomb, camX, camY);
    for (const explosion of this.explosions) {
      drawDynamiteExplosion(ctx, explosion, camX, camY, explosion.kind);
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

  /**
   * A bomb on its lob: its ground point runs straight from his centre to the
   * landing, it rides an arc above that, and over the first frames its drawn
   * position closes from the hand that threw it onto that path.
   */
  private renderBomb(
    ctx: CanvasRenderingContext2D,
    bomb: LiveBomb,
    camX: number,
    camY: number,
  ): void {
    const now = bombPointAt(bomb, bomb.frame);
    const before = bombPointAt(bomb, Math.max(0, bomb.frame - 1));
    const progress = Math.min(1, bomb.frame / bomb.flightFrames);
    const screenX = now.x - camX;
    const screenY = now.groundY - camY;
    drawBlackPowderBombFlight(ctx, screenX, screenY - now.height, TILE_SIZE, {
      ageFrames: bomb.frame,
      spin: progress * BLACK_POWDER_SPIN_TURNS * Math.PI * 2,
      seed: bomb.seed,
      velocityX: now.x - before.x,
      velocityY: now.groundY - now.height - (before.groundY - before.height),
    });
  }

  /**
   * The throw-power meter at the right edge, half way down: an upright bar
   * that fills from the bottom while the stick is held, yellow near full
   * strength, and flashing red once holding on means it goes off in hand.
   */
  renderChargeMeter(ui: Ui): void {
    if (!this._charging) return;
    const { chargeFrames, item } = this._charging;
    const ratio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const isDanger = item === 'goblin_dynamite' && chargeFrames >= DYN_DANGER;
    const flashOn = !isDanger || Math.floor(chargeFrames / CHARGE_FLASH_FRAMES) % 2 === 0;
    const { palette, space, type, radius } = ui.theme;
    const labelHeight = type.overline.lineHeight;
    const frame: Rect = {
      x: ui.viewport.x + ui.viewport.w - space.lg - CHARGE_FRAME_WIDTH,
      y: ui.viewport.y + (ui.viewport.h - CHARGE_BAR_HEIGHT) / 2 - labelHeight * 2 - space.sm,
      w: CHARGE_FRAME_WIDTH,
      h: CHARGE_BAR_HEIGHT + labelHeight * 2 + space.sm * 2,
    };
    drawGlass(ui, frame, skinsFor(ui.theme).panel.hud, radius.sm);
    const labelColor = isDanger ? palette.state.danger : palette.text.primary;
    const [topLine, bottomLine] = isDanger ? CHARGE_DANGER_LABEL : CHARGE_POWER_LABEL;
    const labelRect = (row: number): Rect => ({
      x: frame.x,
      y: frame.y + space.xs + labelHeight * row,
      w: frame.w,
      h: labelHeight,
    });
    text(ui, labelRect(0), { text: topLine, role: 'overline', color: labelColor, align: 'center' });
    text(ui, labelRect(1), {
      text: bottomLine,
      role: 'overline',
      color: labelColor,
      align: 'center',
    });

    const bar: Rect = {
      x: frame.x + (frame.w - CHARGE_BAR_WIDTH) / 2,
      y: frame.y + frame.h - space.sm - CHARGE_BAR_HEIGHT,
      w: CHARGE_BAR_WIDTH,
      h: CHARGE_BAR_HEIGHT,
    };
    fillRounded(ui.ctx, bar, CHARGE_BAR_RADIUS, palette.meter.track);
    if (flashOn) {
      const fillHeight = Math.ceil(bar.h * ratio);
      const fill = isDanger
        ? palette.state.danger
        : ratio > CHARGE_HIGH_POWER_FRACTION
          ? palette.state.warning
          : palette.state.success;
      ui.clip(bar, () => {
        fillRounded(
          ui.ctx,
          { ...bar, y: bar.y + bar.h - fillHeight, h: fillHeight },
          CHARGE_BAR_RADIUS,
          fill,
        );
      });
    }
    ui.ctx.fillStyle = palette.border.strong;
    for (const fraction of CHARGE_TICK_FRACTIONS) {
      const tickY = Math.round(bar.y + bar.h * (1 - fraction));
      ui.ctx.fillRect(bar.x, tickY, bar.w, CHARGE_TICK_THICKNESS);
    }
  }

  /** A bomb's preview: a straight line from his centre to where it would land now. */
  private bombPreviewPath(human: HumanPlayer, chargeFrames: number): Pt[] {
    const fromX = human.x + HALF_TILE;
    const fromY = human.y + HALF_TILE;
    const landing = this.bombLanding(human, this.bombThrowDistance(human, chargeFrames));
    const length = Math.hypot(landing.x - fromX, landing.y - fromY);
    const samples = Math.max(1, Math.ceil(length / BLACK_POWDER_PATH_SAMPLE_PX));
    const points: Pt[] = [];
    for (let sample = 0; sample <= samples; sample++) {
      const share = sample / samples;
      points.push({
        x: fromX + (landing.x - fromX) * share,
        y: fromY + (landing.y - fromY) * share,
      });
    }
    return points;
  }

  private simulateTrajectory(human: HumanPlayer): Array<{ x: number; y: number }> {
    const chargeFrames = this._charging?.chargeFrames ?? 0;
    if (this._charging?.item === 'black_powder_bomb') {
      return this.bombPreviewPath(human, chargeFrames);
    }
    if (chargeFrames < DYN_TAP) return [];

    const cacheKey = `${chargeFrames}|${human.facingX}|${human.facingY}|${Math.round(human.x)}|${Math.round(human.y)}|${human.explosivesHandling}`;
    if (this._trajectoryCache !== null && this._trajCacheKey === cacheKey) {
      return this._trajectoryCache;
    }

    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const speedMax = this.maxThrowSpeed(human);
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
    if (this._readied !== null) {
      drawDynamiteRangeRing(
        ctx,
        human.x + HALF_TILE - camX,
        human.y + HALF_TILE - camY,
        slideDistance(this.maxThrowSpeed(human)),
      );
      return;
    }
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

export interface DynamiteChargeSurfaceOptions {
  readonly id: string;
  /** The dynamite of the floor on screen; a scene with several floors swaps it as the party moves. */
  readonly dynamite: () => DynamiteSystem;
  /** Whether the meter may show at all this frame (not under a death or the pause menu, say). */
  readonly shows: () => boolean;
}

/**
 * The throw-power meter as a HUD-band surface, open while a stick is held. It
 * takes no input and never halts the world: charging is play.
 */
export function dynamiteChargeSurface(opts: DynamiteChargeSurfaceOptions): Surface {
  return {
    id: opts.id,
    band: 'hud',
    haltsWorld: false,
    isOpen: () => opts.dynamite().isCharging && opts.shows(),
    render: (ui) => opts.dynamite().renderChargeMeter(ui),
  };
}

/**
 * Where a bomb `frame` frames into its lob is drawn, in world pixels: its
 * point on the floor and its height above it, closing from the throwing hand
 * over the first frames.
 */
function bombPointAt(
  bomb: LiveBomb,
  frame: number,
): { x: number; groundY: number; height: number } {
  const progress = Math.min(1, frame / bomb.flightFrames);
  const handProgress = Math.min(1, frame / LOB_FRAMES);
  const fromHand = 1 - easeOut(handProgress);
  const handDx = bomb.handFrom === null ? 0 : (bomb.handFrom.x - bomb.fromX) * fromHand;
  const handDy = bomb.handFrom === null ? 0 : (bomb.handFrom.y - bomb.fromY) * fromHand;
  // The hand is above the floor, so its offset is height, not ground.
  const height = PARABOLA_PEAK_GAIN * progress * (1 - progress) * bomb.arcPx - handDy;
  return {
    x: bomb.fromX + (bomb.landX - bomb.fromX) * progress + handDx,
    groundY: bomb.fromY + (bomb.landY - bomb.fromY) * progress,
    height,
  };
}
