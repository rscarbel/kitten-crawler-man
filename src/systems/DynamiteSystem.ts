import type { GameMap } from '../map/GameMap';
import {
  captureDeliveryStat,
  friendlyBlastDamage,
  hitTrainingOn,
  resolveCrawlerHit,
  type CapturedStat,
} from '../core/combat/outgoingHit';
import { EXPLOSION_HIT, UNTAGGED_HIT } from '../core/combat/damageTags';
import { resolveLobLanding } from './goblinBombConstants';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import type { TownInteriorPropDestructionSystem } from './TownInteriorPropDestructionSystem';
import { EXPLOSION_IGNITE_RING_TILES, type TreeSystem } from './TreeSystem';
import { TILE_SIZE } from '../core/constants';
import { DYN_FRICTION, launchSpeedFor, slideDistance } from './dynamiteSlide';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { gearModifiers } from '../gear/gearHooks';
import { MAX_MOB_HP_MULTIPLIER } from '../creatures/mobLevelScaling';
import {
  DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL,
  MIN_STAT_VALUE,
} from '../core/party/crawlerFormulas';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  drawDynamiteFloorSprite,
  drawDynamiteRangeRing,
  drawDynamiteThrowPath,
} from '../sprites/dynamiteSprite';
import { drawBlackPowderBombFlight, drawThrownBombShadow } from '../sprites/blackPowderBombSprite';
import { drawSmokeBombFlight } from '../sprites/smokeBombSprite';
import type { SmokeCloudSystem } from './SmokeCloudSystem';
import type { ItemId } from '../core/items/defs/ItemDefs';
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
import type {
  ExplosiveSource,
  ExplosiveVelocity,
  LiveBombId,
  LiveExplosive,
  LiveStickId,
} from './ExplosiveSource';
import {
  GAS_CYLINDER_CRAWLER_DAMAGE,
  GAS_CYLINDER_MOB_DAMAGE_FRACTION,
} from './destruction/serviceLevelPropKinds';
import type { DynamicLightSink } from './lighting/dynamicLights';
import type { EventBus } from '../core/EventBus';
import { easeOut, type Pt } from '../sprites/art/bipedArt';

/** Either crawler: both light, carry and throw explosives through this system. */
type Crawler = HumanPlayer | CatPlayer;

/** What the crawlers throw through this system, by the item spent on each throw. */
export type ThrownItemId = Extract<ItemId, 'dynamite' | 'black_powder_bomb' | 'smoke_bomb'>;

/**
 * What a thrown item does once it is out of the hand:
 * - `fuse` — it slides and bounces as a lit stick and goes off when its fuse
 *   burns down, or in the hand if held too long;
 * - `blast` — it is lobbed, and explodes on the frame it lands;
 * - `smoke` — it is lobbed, and bursts into a smoke cloud where it lands.
 */
type ThrownItemLanding =
  { readonly kind: 'fuse' } | { readonly kind: 'blast' } | { readonly kind: 'smoke' };

interface ThrownItemDef {
  /** What it looks like in the human's fist or the cat's jaws. */
  readonly look: ThrownPropVisualId;
  readonly onLand: ThrownItemLanding;
}

const THROWN_ITEMS = {
  dynamite: { look: 'prop_dynamite', onLand: { kind: 'fuse' } },
  black_powder_bomb: { look: 'prop_black_powder_bomb', onLand: { kind: 'blast' } },
  smoke_bomb: { look: 'prop_smoke_bomb', onLand: { kind: 'smoke' } },
} as const satisfies Record<ThrownItemId, ThrownItemDef>;

export function isThrownItem(id: ItemId): id is ThrownItemId {
  return id in THROWN_ITEMS;
}

/** What a lobbed item does where it comes down. */
type LobBurst = Exclude<ThrownItemLanding['kind'], 'fuse'>;

/**
 * What `item` does where it lands if it is lobbed; null for a stick, which
 * rides its own physics.
 */
function lobBurstOf(item: ThrownItemId): LobBurst | null {
  const landing: ThrownItemLanding = THROWN_ITEMS[item].onLand;
  switch (landing.kind) {
    case 'fuse':
      return null;
    case 'blast':
    case 'smoke':
      return landing.kind;
    default: {
      const unhandled: never = landing;
      return unhandled;
    }
  }
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
 * tiles. A bomb goes off where it lands, so a tap that dropped it at the
 * thrower's feet would only blow them up: in open ground the shortest throw
 * clears them. A wall nearer than that still stops the lob at its foot, inside
 * their own blast, and the throw preview shows it landing there.
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

/**
 * Frames over which a thrown stick's drawn position closes from the hand or
 * jaws that let it go onto the gameplay body it rides on. The body is launched
 * from the thrower's centre and never changes course for the picture; only
 * where it is drawn starts there and settles onto it, so the landing, the bounces
 * and the preview path are exactly the gameplay ones.
 */
const LOB_FRAMES = 16;
/** How high above the straight path from hand to body the drawn stick arcs, in tiles. */
const LOB_ARC_TILES = 1;
/**
 * Extra arc, as a share of {@link LOB_ARC_TILES}, on a stick thrown straight
 * down the screen. Toward the camera the flight runs down over the thrower's
 * own body, and without a higher arc the drawn stick slides down their front and
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
 * The floor sprite is drawn larger than the stick in a crawler's hand — it has to read
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
 * a crawler to hurt what they are fighting, and a companion standing in the blast
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
  readonly id: LiveStickId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseFrames: number;
  state: 'flying' | 'sliding' | 'stopped';
  /** What the stick brings to a blast, taken at throw time. */
  power: ChargePower;
  /** What the thrower's gear adds to the blast's reach, taken at throw time. */
  radiusBonusPx: number;
  /** Who lit it, credited with whatever it kills. */
  readonly thrower: Crawler;
  /**
   * The world point the stick left its thrower at, which its drawn position
   * closes from onto its body over the lob — null on a stick that never left
   * a hand — and how many frames of the lob have run.
   */
  lobFrom: Pt | null;
  lobFrame: number;
  /** How high the lob arcs, in tiles; set at launch by {@link lobArcTiles}. */
  lobArc: number;
}

/** What one stick brings to a blast, whether lying on the floor or still with its thrower. */
type BlastCharge = Pick<LiveDynamite, 'x' | 'y' | 'power' | 'radiusBonusPx' | 'thrower'>;

/**
 * What one charge brings to a blast. A stick or a bomb keeps its thrower's
 * level and Explosives Handling from the moment it was thrown, so neither a
 * level-up nor a gear swap while the fuse burns can change it, and in a chain
 * each stick is sized by its own thrower. A gas bottle grows with nobody's
 * handling.
 */
type ChargePower =
  | { readonly kind: 'thrown'; readonly throwerLevel: number; readonly handling: CapturedStat }
  | { readonly kind: 'gas'; readonly mobDamage: number; readonly crawlerDamage: number };

/** Reads the handling a thrown charge captured. */
type HandlingReader = (captured: CapturedStat) => number;

/** A charge thrown by `thrower` now: their level and handling as they stand. */
function thrownPower(thrower: Crawler): ChargePower {
  return {
    kind: 'thrown',
    throwerLevel: thrower.level,
    handling: captureDeliveryStat(thrower, 'thrownExplosive'),
  };
}

/** What `power` does to an enemy, before any chain bonus. */
function chargeMobDamage(power: ChargePower, handlingOf: HandlingReader): number {
  if (power.kind === 'gas') return power.mobDamage;
  return dynamiteMobDamage(power.throwerLevel, handlingOf(power.handling));
}

/** What `power` does to a crawler or an ally. */
function chargeCrawlerDamage(power: ChargePower, handlingOf: HandlingReader): number {
  if (power.kind === 'gas') return power.crawlerDamage;
  return dynamiteCrawlerDamage(handlingOf(power.handling));
}

/** Reads a captured handling outside a crawler hit, for the party's own share of a blast. */
const capturedHandling: HandlingReader = (captured) => captured.value;

/**
 * Something lobbed — a bomb or a smoke bomb. Unlike a stick it has no physics
 * body: its landing point is fixed when it is thrown, cut short at the first
 * wall on the way, and it bursts on the frame it gets there.
 */
interface LobFlight {
  /** Where its ground point starts: the thrower's centre, the same as a stick's body. */
  readonly fromX: number;
  readonly fromY: number;
  readonly landX: number;
  readonly landY: number;
  readonly flightFrames: number;
  readonly arcPx: number;
  /** Where it left the thrower, which its drawn position closes from; null when thrown from their centre. */
  readonly handFrom: Pt | null;
  /** Keeps two lobs in the air from tumbling in step. */
  readonly seed: number;
  frame: number;
}

/** A black powder bomb on its lob, carrying the blast it lands with. */
interface LiveBomb extends LobFlight {
  readonly id: LiveBombId;
  readonly power: ChargePower;
  readonly radiusBonusPx: number;
  readonly thrower: Crawler;
}

/** One detonation — a single stick, or every stick a chain reaction swept up. */
interface Blast {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly charges: readonly ChargePower[];
}

/**
 * What a blast does, each charge sized by the handling it captured.
 *
 * The per-stick figures are kept beside the chained totals because a
 * blast-resistant mob takes only one stick's share, chain or no chain: a boss's
 * health bar must be a question of how the fight was played, not of how many
 * sticks were piled up before it. Enemies take every stick's damage with
 * {@link CHAIN_DAMAGE_BONUS} on top; the crawlers, and allies, take every
 * stick's share with no bonus.
 */
function blastDamage(blast: Blast, handlingOf: HandlingReader) {
  const mobShares = blast.charges.map((power) => chargeMobDamage(power, handlingOf));
  const crawlerShares = blast.charges.map((power) => chargeCrawlerDamage(power, handlingOf));
  const totalMobDamage = mobShares.reduce((sum, share) => sum + share, 0);
  const isChain = blast.charges.length > 1;
  return {
    mobDamage: Math.round(isChain ? totalMobDamage * CHAIN_DAMAGE_BONUS : totalMobDamage),
    crawlerDamage: crawlerShares.reduce((sum, share) => sum + share, 0),
    stickMobDamage: Math.max(0, ...mobShares),
    stickCrawlerDamage: Math.max(0, ...crawlerShares),
  };
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

/** A thrown item released and waiting for the throw's release to leave its thrower. */
interface PendingThrow {
  /**
   * Where a lob will land, and what it does there; null for a stick, which is
   * still a blast in the thrower's hand or jaws.
   */
  readonly landing: { readonly at: Pt; readonly burst: LobBurst } | null;
  readonly thrower: Crawler;
  /** Ticks since the key was let go, which a stick's fuse is charged when it launches. */
  ticksPending: number;
  /** Puts it in the world, from where the throw lets go or from the thrower's centre. */
  readonly launch: (fromHand: boolean) => void;
}

/** What a throw puts in the world once it leaves its thrower, told how long it waited and where it left from, if anywhere. */
type ThrowPlacement = (ticksPending: number, hand: Pt | null) => void;

/** A crawler has an explosive in hand or jaws that has not left them yet. */
interface HeldExplosive {
  readonly item: ThrownItemId;
  readonly thrower: Crawler;
}

/** A blast's light reaches past its damage radius by this much. */
const BLAST_LIGHT_REACH_SCALE = 1.5;
/** The least a blast lights, in tiles, however small its radius. */
const BLAST_LIGHT_MIN_REACH_TILES = 3;

export class DynamiteSystem implements GameSystem, ExplosiveSource {
  private _charging:
    | (HeldExplosive & {
        hotbarIdx: number;
        chargeFrames: number;
      })
    | null = null;
  /**
   * A stick in a crawler's hand or jaws, unlit, waiting for a tap on the world to say where it
   * goes — the touch screen's way to throw, where holding a hotbar slot down
   * while aiming with the same thumb is impractical. Nothing burns while it
   * is held, so it can wait out a menu or a conversation.
   */
  private _readied: HeldExplosive | null = null;
  private pendingThrow: PendingThrow | null = null;
  private liveDynamites: LiveDynamite[] = [];
  private liveBombs: LiveBomb[] = [];
  /** Smoke bombs on their lobs; they never warn as a blast, since they do no harm. */
  private liveSmokeBombs: LobFlight[] = [];
  private explosions: LiveExplosion[] = [];
  private scorches: ScorchMark[] = [];
  private blastCount = 0;
  private bombsThrown = 0;
  private sticksLit = 0;
  /** {@link liveExplosives}' answer, rebuilt at most once a frame however many mobs ask. */
  private explosivesSeen: LiveExplosive[] = [];
  /** The {@link frame} {@link explosivesSeen} was built on, or null once a kick has moved a stick since. */
  private explosivesSeenFrame: number | null = null;
  /** Set each time a stick goes off; `DestructionKit` reads and clears it to sound the blast. */
  explosionSoundPending = false;
  /** The kind of the latest blast, for whatever sounds {@link explosionSoundPending}. */
  explosionSoundKind: BlastKind = 'dynamite';
  /**
   * Set when a thrown stick comes down out of the air; `DestructionKit` reads
   * and clears it. A stick dropped at the thrower's feet never flew, so it never lands.
   */
  stickLandSoundPending = false;
  /** Set when a smoke bomb bursts; `DestructionKit` reads and clears it. */
  smokeBurstSoundPending = false;
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
    this.liveSmokeBombs = [];
    this.explosions = [];
    this.scorches = [];
    this.lastBlastFrame = new WeakMap<Mob, number>();
    this.explosivesSeenFrame = null;
  }

  /**
   * Where a blast may soon go off: every stick alight in the world, and the
   * thrower while they hold one lit or are about to let it go — a warning for
   * anything that has to get ready for the bang before it lands. `radiusPx`
   * is how far the blast reaches from where it goes off; a stick still in hand
   * has not chosen where that is.
   */
  pendingBlastPoints(): Array<{ x: number; y: number; inHand: boolean; radiusPx: number }> {
    const points = this.liveDynamites.map((stick) => ({
      x: stick.x,
      y: stick.y,
      inHand: false,
      radiusPx: DYN_RADIUS + stick.radiusBonusPx,
    }));
    for (const bomb of this.liveBombs) {
      const radiusPx = DYN_RADIUS + bomb.radiusBonusPx;
      points.push({ x: bomb.landX, y: bomb.landY, inHand: false, radiusPx });
    }
    const pending = this.pendingThrow;
    const pendingLanding = pending?.landing ?? null;
    if (pending !== null && pendingLanding?.burst === 'blast') {
      points.push({
        x: pendingLanding.at.x,
        y: pendingLanding.at.y,
        inHand: false,
        radiusPx: DYN_RADIUS + gearBlastBonusPx(pending.thrower),
      });
    }
    // A lob never goes off in a crawler's mouth or hand, so only a stick warns from there.
    const charging = this._charging;
    const holdingStick =
      charging !== null && lobBurstOf(charging.item) === null
        ? charging.thrower
        : pending !== null && pendingLanding === null
          ? pending.thrower
          : null;
    if (holdingStick !== null) {
      points.push({
        x: holdingStick.x + HALF_TILE,
        y: holdingStick.y + HALF_TILE,
        inHand: true,
        radiusPx: DYN_RADIUS + gearBlastBonusPx(holdingStick),
      });
    }
    return points;
  }

  liveExplosives(): readonly LiveExplosive[] {
    if (this.explosivesSeenFrame === this.frame) return this.explosivesSeen;
    const seen: LiveExplosive[] = [];
    for (const stick of this.liveDynamites) {
      seen.push({
        kind: 'stick',
        id: stick.id,
        x: stick.x,
        y: stick.y,
        fuseFramesLeft: stick.fuseFrames,
        blastRadiusPx: DYN_RADIUS + stick.radiusBonusPx,
        owner: 'party',
        grounded: stick.lobFrom === null || stick.lobFrame >= LOB_FRAMES,
      });
    }
    for (const bomb of this.liveBombs) {
      seen.push({
        kind: 'bomb',
        id: bomb.id,
        x: bomb.landX,
        y: bomb.landY,
        fuseFramesLeft: bomb.flightFrames - bomb.frame,
        blastRadiusPx: DYN_RADIUS + bomb.radiusBonusPx,
        owner: 'party',
      });
    }
    this.explosivesSeen = seen;
    this.explosivesSeenFrame = this.frame;
    return seen;
  }

  /**
   * Sends a lit stick off again from where it lies, drawn in the air the way a
   * thrown one is, sliding and bouncing on the same physics, its fuse still
   * burning toward the same blast.
   */
  kick(id: LiveStickId, velocity: ExplosiveVelocity): boolean {
    const stick = this.liveDynamites.find((dyn) => dyn.id === id);
    if (stick === undefined) return false;
    stick.vx = velocity.vx;
    stick.vy = velocity.vy;
    stick.state = 'flying';
    stick.lobFrom = { x: stick.x, y: stick.y };
    stick.lobFrame = 0;
    stick.lobArc = lobArcTiles(velocity.vx, velocity.vy);
    this.explosivesSeenFrame = null;
    return true;
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

  /** What is being charged for a throw, null when nothing is. */
  get chargingItem(): ThrownItemId | null {
    return this._charging?.item ?? null;
  }

  /** Who is charging a throw, null when nobody is. */
  get chargingThrower(): Crawler | null {
    return this._charging?.thrower ?? null;
  }

  /** Whether a crawler holds an unlit stick or bomb waiting for a tap to throw it. */
  get isReadied(): boolean {
    return this._readied !== null;
  }

  /** Who holds an explosive waiting for a tap, null when nobody does. */
  get readiedThrower(): Crawler | null {
    return this._readied?.thrower ?? null;
  }

  /** What is held waiting for a tap, null when nothing is readied. */
  get readiedItem(): ThrownItemId | null {
    return this._readied?.item ?? null;
  }

  /**
   * Puts an unlit `item` in the thrower's hand or jaws, to be thrown by
   * {@link throwReadiedAt}. Refused in the safe room for the same reason as
   * {@link beginCharge}, and with none to hold.
   *
   * @returns whether they took one up; a refusal is the caller's to explain.
   */
  ready(thrower: Crawler, item: ThrownItemId): boolean {
    if (thrower.isProtected || thrower.inventory.countOf(item) === 0) return false;
    this.dropHeld();
    this._readied = { item, thrower };
    thrower.explosives.takeExplosive(THROWN_ITEMS[item].look);
    return true;
  }

  /** Puts a readied stick back in the bag, unspent. */
  putAway(): void {
    const readied = this._readied;
    if (readied === null) return;
    this._readied = null;
    readied.thrower.explosives.dropExplosivePose();
  }

  /**
   * Throws the readied stick at the world point `(targetX, targetY)`, lighting
   * its fuse as it goes. A target past the thrower's reach is thrown as far as
   * they can, along the same line; one at their feet is dropped there.
   *
   * @returns whether a stick was thrown or dropped.
   */
  throwReadiedAt(targetX: number, targetY: number): boolean {
    const readied = this._readied;
    if (readied?.thrower.canAct !== true) return false;
    this._readied = null;
    const { thrower } = readied;
    if (!spendExplosive(thrower, readied.item)) {
      thrower.explosives.dropExplosivePose();
      return false;
    }
    const originX = thrower.x + HALF_TILE;
    const originY = thrower.y + HALF_TILE;
    const toTargetX = targetX - originX;
    const toTargetY = targetY - originY;
    const targetDistance = Math.hypot(toTargetX, toTargetY);
    if (targetDistance > 0) {
      thrower.facingX = toTargetX / targetDistance;
      thrower.facingY = toTargetY / targetDistance;
    }
    const reach = slideDistance(this.maxThrowSpeed(thrower));
    const burst = lobBurstOf(readied.item);
    if (burst !== null) {
      const distance = Math.max(this.bombMinThrow(reach), Math.min(targetDistance, reach));
      this.throwLob(thrower, distance, burst);
      return true;
    }
    const speed = launchSpeedFor(Math.min(targetDistance, reach));
    const dropsAtFeet = speed < DYN_SPEED_MIN;
    const stick = this.stickFrom(thrower, dropsAtFeet ? 0 : speed);
    if (dropsAtFeet) {
      thrower.explosives.dropExplosivePose();
      this.liveDynamites.push(stick);
      return true;
    }
    this.throwStick(thrower, stick);
    return true;
  }

  /**
   * A lit stick leaving `thrower`'s centre the way they face at `speed`
   * px/frame, at rest on the floor when `speed` is 0. It keeps the thrower's
   * level and Explosives Handling from the moment it is lit.
   */
  private stickFrom(thrower: Crawler, speed: number): LiveDynamite {
    const thrown = speed > 0;
    this.sticksLit++;
    return {
      id: `stick_${this.sticksLit}`,
      x: thrower.x + HALF_TILE,
      y: thrower.y + HALF_TILE,
      vx: thrown ? thrower.facingX * speed : 0,
      vy: thrown ? thrower.facingY * speed : 0,
      fuseFrames: DYN_FUSE,
      state: thrown ? 'flying' : 'stopped',
      power: thrownPower(thrower),
      radiusBonusPx: gearBlastBonusPx(thrower),
      thrower,
      lobFrom: null,
      lobArc: 0,
      lobFrame: 0,
    };
  }

  /** The fastest `thrower` can throw a stick, which their Explosives Handling raises. */
  private maxThrowSpeed(thrower: Crawler): number {
    return DYN_SPEED_MAX + (thrower.explosivesHandling - 1) * DYN_SPEED_PER_LEVEL;
  }

  /** The shortest bomb throw, never past the longest. */
  private bombMinThrow(reach: number): number {
    return Math.min(BLACK_POWDER_MIN_THROW_PX, reach);
  }

  /** How far a bomb thrown on `chargeFrames` of charge flies: the shortest throw to the longest. */
  private bombThrowDistance(thrower: Crawler, chargeFrames: number): number {
    const reach = slideDistance(this.maxThrowSpeed(thrower));
    const shortest = this.bombMinThrow(reach);
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    return shortest + (reach - shortest) * chargeRatio;
  }

  /**
   * Where a bomb thrown `distance` px from the thrower's centre the way they
   * face comes down, by the same rule as a goblin's lob: it arcs over props,
   * bodies and built structures and stops at the foot of a real wall or
   * building.
   */
  private bombLanding(thrower: Crawler, distance: number): Pt {
    const origin = { x: thrower.x + HALF_TILE, y: thrower.y + HALF_TILE };
    const target = {
      x: origin.x + thrower.facingX * distance,
      y: origin.y + thrower.facingY * distance,
    };
    return resolveLobLanding(this.gameMap, origin, target);
  }

  /**
   * Has `thrower` lob something `distance` px the way they face; it bursts
   * where it lands, as `burst` says. A bomb's damage is taken from the
   * thrower as it is thrown, so a level-up mid-flight cannot change it.
   */
  private throwLob(thrower: Crawler, distance: number, burst: LobBurst): void {
    const fromX = thrower.x + HALF_TILE;
    const fromY = thrower.y + HALF_TILE;
    const landing = this.bombLanding(thrower, distance);
    const flown = Math.hypot(landing.x - fromX, landing.y - fromY);
    const flightFrames = Math.round(
      Math.min(
        BLACK_POWDER_MAX_FLIGHT_FRAMES,
        Math.max(BLACK_POWDER_MIN_FLIGHT_FRAMES, flown / BLACK_POWDER_FLIGHT_PX_PER_FRAME),
      ),
    );
    const arcPx = lobArcTiles(thrower.facingX, thrower.facingY) * TILE_SIZE;
    this.bombsThrown++;
    const thrownIndex = this.bombsThrown;
    const seed = thrownIndex * BLAST_SEED_STRIDE;
    const flightFrom = (hand: Pt | null): LobFlight => ({
      fromX,
      fromY,
      landX: landing.x,
      landY: landing.y,
      flightFrames,
      arcPx,
      handFrom: hand,
      seed,
      frame: 0,
    });
    if (burst === 'smoke') {
      this.throwFromHand(thrower, { at: landing, burst }, (_ticksPending, hand) => {
        this.liveSmokeBombs.push(flightFrom(hand));
      });
      return;
    }
    const power = thrownPower(thrower);
    this.throwFromHand(thrower, { at: landing, burst }, (_ticksPending, hand) => {
      this.liveBombs.push({
        ...flightFrom(hand),
        id: `bomb_${thrownIndex}`,
        power,
        radiusBonusPx: gearBlastBonusPx(thrower),
        thrower,
      });
    });
  }

  /**
   * Starts lighting a stick, or winding up a bomb. Refused in the safe room,
   * which is a sanctuary for the crawlers and not a bunker to bomb out of.
   *
   * @returns whether the light began; a refusal is the caller's to explain.
   */
  beginCharge(hotbarIdx: number, thrower: Crawler, item: ThrownItemId): boolean {
    if (thrower.isProtected) return false;
    this.dropHeld();
    this._charging = { item, thrower, hotbarIdx, chargeFrames: 0 };
    thrower.explosives.takeExplosive(THROWN_ITEMS[item].look);
    return true;
  }

  /** Lets go of the charging stick or bomb, thrown as hard as the charge says. */
  release(): void {
    const charging = this._charging;
    if (charging === null) return;
    this._charging = null;
    const { chargeFrames, item, thrower } = charging;
    // A freeze landed mid-charge: the stick goes back in the bag unburned,
    // the same as walking into the safe room with one lit, rather than
    // throwing from paws or hands that can no longer act.
    if (!thrower.canAct) {
      thrower.explosives.dropExplosivePose();
      return;
    }

    // With none left to throw — the last one sold or dropped mid-charge —
    // the pose being held has nothing in it.
    if (!spendExplosive(thrower, item)) {
      thrower.explosives.dropExplosivePose();
      return;
    }
    const burst = lobBurstOf(item);
    if (burst !== null) {
      this.throwLob(thrower, this.bombThrowDistance(thrower, chargeFrames), burst);
      return;
    }

    const isTap = chargeFrames < DYN_TAP;
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const speedMax = this.maxThrowSpeed(thrower);
    const speed = isTap ? 0 : DYN_SPEED_MIN + (speedMax - DYN_SPEED_MIN) * chargeRatio;
    const stick = this.stickFrom(thrower, speed);
    if (isTap) {
      thrower.explosives.dropExplosivePose();
      this.liveDynamites.push(stick);
      return;
    }
    this.throwStick(thrower, stick);
  }

  /** Has `thrower` throw `stick`, its fuse burning from the key's release. */
  private throwStick(thrower: Crawler, stick: LiveDynamite): void {
    this.throwFromHand(thrower, null, (ticksPending, hand) => {
      // The fuse is lit from the key's release, not from the frame the stick
      // leaves the thrower, so a throw's windup never delays the blast the
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
   * Has `thrower` throw, and calls `place` on the tick it leaves them — with
   * the point it left from — or at once from no point if they cannot throw
   * right now (mid-blow, reeling, out cold). A throw cut short before its
   * release still places it, from their centre: the item is already spent.
   */
  private throwFromHand(
    thrower: Crawler,
    landing: PendingThrow['landing'],
    place: ThrowPlacement,
  ): void {
    // A second release can land before the first throw lets go; the new throw
    // replaces the old one, whose own end is then no longer the pending
    // throw's and would drop a stick already paid for.
    this.flushPendingThrow();
    const pending: PendingThrow = {
      landing,
      thrower,
      ticksPending: 0,
      launch: (fromHand) => {
        if (this.pendingThrow !== pending) return;
        this.pendingThrow = null;
        const hand = fromHand ? thrower.explosives.explosiveReleasePoint() : null;
        place(pending.ticksPending, hand);
      },
    };
    this.pendingThrow = pending;
    const accepted = thrower.explosives.throwExplosive({
      onRelease: () => pending.launch(true),
      // Under the death screen the stick never leaves the thrower: the world
      // it would land in is about to be rewound or rebuilt.
      onEnd: (defeated) => {
        if (defeated) this.dropPendingThrow(pending);
        else pending.launch(false);
      },
    });
    if (!accepted) pending.launch(false);
  }

  /** Launches a stick still waiting on its throw, from its thrower's centre. */
  private flushPendingThrow(): void {
    this.pendingThrow?.launch(false);
  }

  /** Forgets a throw that will never launch, so no later throw flushes it into the world. */
  private dropPendingThrow(pending: PendingThrow): void {
    if (this.pendingThrow === pending) this.pendingThrow = null;
  }

  /** Forgets whatever is readied or charging, ending its pose, before a new one is taken up. */
  private dropHeld(): void {
    const held = this._charging ?? this._readied;
    this._charging = null;
    this._readied = null;
    held?.thrower.explosives.dropExplosivePose();
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
        power: {
          kind: 'gas',
          mobDamage: Math.round(
            dynamiteMobDamage(human.level, MIN_STAT_VALUE) * GAS_CYLINDER_MOB_DAMAGE_FRACTION,
          ),
          crawlerDamage: GAS_CYLINDER_CRAWLER_DAMAGE,
        },
        radiusBonusPx: 0,
        thrower: human,
      };
      this.detonate(charge, 'dynamite', human, cat, mobGrid, gas.radiusPx);
    }
    // Walking into the safe room with a stick alight snuffs it, and so does
    // handing control to the other crawler: the stick is only spent on
    // release, so it goes back in the bag unburned, and the key that would
    // have thrown it now belongs to someone else.
    const charging = this._charging;
    if (charging !== null && (charging.thrower.isProtected || !charging.thrower.isActive)) {
      this._charging = null;
      charging.thrower.explosives.dropExplosivePose();
    }
    // The hotbar slot is the only way to put a readied stick back, so a stick
    // whose slot was emptied or rearranged away goes back on its own.
    const readied = this._readied;
    if (readied !== null) {
      const { thrower, item } = readied;
      const heldOnHotbar = thrower.inventory.actionBar.slots.some((slot) => slot?.id === item);
      const cannotHold =
        !thrower.isActive ||
        thrower.isProtected ||
        !heldOnHotbar ||
        thrower.inventory.countOf(item) === 0;
      if (cannotHold) this.putAway();
    }
    this._readied?.thrower.explosives.holdExplosive('readied');
    const stillCharging = this._charging;
    if (stillCharging !== null) {
      stillCharging.chargeFrames++;
      if (lobBurstOf(stillCharging.item) !== null) {
        // A lob has no fuse to light during the wind-up, so it can never go
        // off before it is thrown.
        stillCharging.thrower.explosives.holdExplosive('windingUp');
      } else if (stillCharging.chargeFrames >= DYN_EXPLODE_HAND) {
        this.explodeInHand(stillCharging.thrower, human, cat, mobGrid);
        return;
      } else {
        stillCharging.thrower.explosives.holdExplosive('lighting');
      }
    }
    if (this.pendingThrow !== null) this.pendingThrow.ticksPending++;
    this.updatePhysics(human, cat, mobGrid);
    this.updateSmokeBombs(ctx.roster.smokeClouds);
  }

  /** Flies every smoke bomb a frame, bursting each that lands into a cloud there. */
  private updateSmokeBombs(smokeClouds: SmokeCloudSystem): void {
    for (const bomb of this.liveSmokeBombs) bomb.frame++;
    const landed = this.liveSmokeBombs.filter((bomb) => bomb.frame >= bomb.flightFrames);
    if (landed.length === 0) return;
    this.liveSmokeBombs = this.liveSmokeBombs.filter((bomb) => bomb.frame < bomb.flightFrames);
    for (const bomb of landed) smokeClouds.burst(bomb.landX, bomb.landY);
    this.smokeBurstSoundPending = true;
  }

  private explodeInHand(
    thrower: Crawler,
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    this._charging = null;
    thrower.explosives.dropExplosivePose();
    // The stick is spent by going off, exactly as by being thrown. With none
    // left — the last one dropped mid-charge — there is nothing to go off.
    if (!thrower.inventory.removeOne('dynamite')) return;
    const inHand: BlastCharge = {
      x: thrower.x + HALF_TILE,
      y: thrower.y + HALF_TILE,
      power: thrownPower(thrower),
      radiusBonusPx: gearBlastBonusPx(thrower),
      thrower,
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
      coreRadius: (fixedRadiusPx ?? DYN_RADIUS + trigger.radiusBonusPx) * fireballScale,
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
    this.triggerExplosion(blast, trigger.thrower, human, cat, mobGrid);
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

  /** Lands `blast`, crediting `thrower` with what it kills; both crawlers inside it are hurt whoever threw it. */
  private triggerExplosion(
    blast: Blast,
    thrower: Crawler,
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const { x: cx, y: cy, radius } = blast;
    this.explosionSoundPending = true;
    this.onStructureBlast?.(cx, cy, radius);
    const nearBlast = mobGrid.queryCircle(cx, cy, radius + TILE_SIZE);
    if (!thrower.zeroDamage) {
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
          // Death resolves synchronously inside `takeHit`, so the health either
          // side of the call is what says whether this blast did it. The
          // `justDied` flag cannot answer: it stays latched for a whole frame.
          const wasAlive = mob.hp > 0;
          // An immune creature still takes the blow so it shows 'Immune'; only
          // a blast that can land is credited to Demolitionist.
          const blastTrainsSkills = mob.isHostile && !mob.isImmuneTo('explosion');
          const blow = resolveCrawlerHit({
            dealer: thrower,
            delivery: 'captured',
            blowAt: (handlingOf) => {
              const figures = blastDamage(blast, handlingOf);
              return isBlastResistant
                ? dynamiteDamageToMob(mob, figures.stickMobDamage, figures.stickCrawlerDamage)
                : dynamiteDamageToMob(mob, figures.mobDamage, figures.crawlerDamage);
            },
            // An ally takes the party's share of a blast, which Demolitionist
            // softens for a crawler and never grows.
            tags: mob.isHostile ? EXPLOSION_HIT : UNTAGGED_HIT,
            training: blastTrainsSkills ? hitTrainingOn(mob) : 'trainsNothing',
            damageType: 'explosion',
            struckBy: 'dealer',
          });
          mob.takeHit(blow);
          // Only an enemy is a kill: an ally or a village cow caught in the
          // blast is a casualty, and a multi-kill of livestock is no feat.
          if (wasAlive && mob.hp <= 0 && mob.isHostile) {
            enemyKills++;
            if (mob.isBoss) bossKilled = true;
          }
        }
      }
      if (enemyKills > 0) {
        this.bus?.emit('multiKill', { killer: thrower, count: enemyKills });
      }
      if (enemyKills > 0) {
        this.bus?.emit('dynamiteKills', { killer: thrower, kills: enemyKills, bossKilled });
      }
    }
    const partyShare = blastDamage(blast, capturedHandling).crawlerDamage;
    const friendlyFire = friendlyBlastDamage(thrower, partyShare);
    if (Math.hypot(human.x + HALF_TILE - cx, human.y + HALF_TILE - cy) <= radius) {
      human.takeDamage(friendlyFire, { kind: 'dynamite' });
    }
    if (Math.hypot(cat.x + HALF_TILE - cx, cat.y + HALF_TILE - cy) <= radius) {
      cat.takeDamage(friendlyFire, { kind: 'dynamite' });
    }
    // Flattened outright rather than damaged: a barrel that survives a stick of
    // dynamite reads as a bug, however much health it had left. The same goes
    // for a tree, tough as one otherwise is.
    this.destructibles?.destroyInRadius(cx, cy, radius, thrower);
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
      if (!this.gameMap.isWalkable(txX, ty, 'walker')) {
        dyn.vx = -dyn.vx * DYN_BOUNCE;
      } else {
        dyn.x = nextX;
      }

      const nextY = dyn.y + dyn.vy;
      const tx = Math.floor(dyn.x / TILE_SIZE);
      const tyY = Math.floor(nextY / TILE_SIZE);
      if (!this.gameMap.isWalkable(tx, tyY, 'walker')) {
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
        power: bomb.power,
        radiusBonusPx: bomb.radiusBonusPx,
        thrower: bomb.thrower,
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
    for (const lob of [...this.liveBombs, ...this.liveSmokeBombs]) {
      const now = bombPointAt(lob, lob.frame);
      drawThrownBombShadow(ctx, now.x - camX, now.groundY - camY, now.height, TILE_SIZE);
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dyn of this.liveDynamites) {
      this.renderStick(ctx, dyn, dyn.x - camX, dyn.y - camY);
    }
    for (const bomb of this.liveBombs) this.renderBomb(ctx, bomb, camX, camY);
    for (const bomb of this.liveSmokeBombs) this.renderSmokeBomb(ctx, bomb, camX, camY);
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
   * A bomb on its lob: its ground point runs straight from the thrower's centre to the
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

  /** A smoke bomb on its lob, along the same path a bomb flies. */
  private renderSmokeBomb(
    ctx: CanvasRenderingContext2D,
    bomb: LobFlight,
    camX: number,
    camY: number,
  ): void {
    const now = bombPointAt(bomb, bomb.frame);
    const progress = Math.min(1, bomb.frame / bomb.flightFrames);
    drawSmokeBombFlight(ctx, now.x - camX, now.groundY - camY - now.height, TILE_SIZE, {
      ageFrames: bomb.frame,
      spin: progress * BLACK_POWDER_SPIN_TURNS * Math.PI * 2,
      seed: bomb.seed,
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
    const isDanger = lobBurstOf(item) === null && chargeFrames >= DYN_DANGER;
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

  /** A bomb's preview: a straight line from the thrower's centre to where it would land now. */
  private bombPreviewPath(thrower: Crawler, chargeFrames: number): Pt[] {
    const fromX = thrower.x + HALF_TILE;
    const fromY = thrower.y + HALF_TILE;
    const landing = this.bombLanding(thrower, this.bombThrowDistance(thrower, chargeFrames));
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

  private simulateTrajectory(thrower: Crawler): Array<{ x: number; y: number }> {
    const chargeFrames = this._charging?.chargeFrames ?? 0;
    const charging = this._charging;
    if (charging !== null && lobBurstOf(charging.item) !== null) {
      return this.bombPreviewPath(thrower, chargeFrames);
    }
    if (chargeFrames < DYN_TAP) return [];

    const cacheKey = `${chargeFrames}|${thrower.facingX}|${thrower.facingY}|${Math.round(thrower.x)}|${Math.round(thrower.y)}|${thrower.explosivesHandling}`;
    if (this._trajectoryCache !== null && this._trajCacheKey === cacheKey) {
      return this._trajectoryCache;
    }

    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const speedMax = this.maxThrowSpeed(thrower);
    const speed = DYN_SPEED_MIN + (speedMax - DYN_SPEED_MIN) * chargeRatio;

    const points: Array<{ x: number; y: number }> = [];
    let x = thrower.x + HALF_TILE;
    let y = thrower.y + HALF_TILE;
    let vx = thrower.facingX * speed;
    let vy = thrower.facingY * speed;

    points.push({ x, y });

    for (let frame = 0; frame < TRAJECTORY_MAX_FRAMES; frame++) {
      const nextX = x + vx;
      const txX = Math.floor(nextX / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      if (!this.gameMap.isWalkable(txX, ty, 'walker')) {
        vx = -vx * DYN_BOUNCE;
      } else {
        x = nextX;
      }

      const nextY = y + vy;
      const tx = Math.floor(x / TILE_SIZE);
      const tyY = Math.floor(nextY / TILE_SIZE);
      if (!this.gameMap.isWalkable(tx, tyY, 'walker')) {
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

  /** The readied thrower's reach, or the charging throw's path, over the world. */
  renderThrowPath(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const readied = this._readied;
    if (readied !== null) {
      const { thrower } = readied;
      drawDynamiteRangeRing(
        ctx,
        thrower.x + HALF_TILE - camX,
        thrower.y + HALF_TILE - camY,
        slideDistance(this.maxThrowSpeed(thrower)),
      );
      return;
    }
    const charging = this._charging;
    if (charging === null) return;

    const worldPoints = this.simulateTrajectory(charging.thrower);
    if (worldPoints.length < 2) return;

    const screenPoints = worldPoints.map((p) => ({ x: p.x - camX, y: p.y - camY }));
    drawDynamiteThrowPath(ctx, screenPoints);
  }
}

/** What the thrower's worn gear adds to a blast's reach, in world pixels. */
function gearBlastBonusPx(thrower: Crawler): number {
  return gearModifiers(thrower).explosiveRadiusTiles * TILE_SIZE;
}

/**
 * Takes one `item` out of the thrower's pack, and puts it straight back — in
 * the hotbar slot it was thrown from — when their gear's refund chance comes
 * up: the throw still happens either way. Returns false when they had none.
 */
function spendExplosive(thrower: Crawler, item: ThrownItemId): boolean {
  const { inventory } = thrower;
  const thrownFrom = inventory.actionBar.slots.findIndex((slot) => slot?.id === item);
  if (!inventory.removeOne(item)) return false;
  if (Math.random() >= gearModifiers(thrower).explosiveRefundChance) return true;
  inventory.addItem(item, 1);
  if (thrownFrom !== -1) inventory.placeOnHotbar(item, thrownFrom);
  return true;
}

/**
 * The single blast a chain of sticks makes.
 *
 * Centred on the chain's middle, and big enough to cover every stick's own
 * blast — the reach grows with the cube root of the charge, as a real blast
 * front's does, plus however far the chain is strung out. What it does is
 * {@link blastDamage}.
 */
function chainedBlast(chain: ReadonlyArray<BlastCharge>): Blast {
  const stickCount = Math.max(1, chain.length);
  const centreX = chain.reduce((sum, stick) => sum + stick.x, 0) / stickCount;
  const centreY = chain.reduce((sum, stick) => sum + stick.y, 0) / stickCount;
  const furthestStick = chain.reduce(
    (furthest, stick) => Math.max(furthest, Math.hypot(stick.x - centreX, stick.y - centreY)),
    0,
  );
  const radiusBonus = chain.reduce((most, stick) => Math.max(most, stick.radiusBonusPx), 0);
  const radius = Math.min(
    CHAIN_MAX_RADIUS_TILES * TILE_SIZE + radiusBonus,
    (DYN_RADIUS + radiusBonus) * Math.cbrt(stickCount) + furthestStick,
  );
  return {
    x: centreX,
    y: centreY,
    radius,
    charges: chain.map((stick) => stick.power),
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
  bomb: LobFlight,
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
