import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { GameMap } from '../map/GameMap';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import { GOBLIN_PACK_ALERT_RADIUS_TILES, GOBLIN_PACK_KIND } from './Goblin';
import { PLAYER_SPEED } from '../core/constants';
import type { ItemId } from '../core/items/defs/ItemDefs';
import { onCurveCrawlerMaxHp } from '../core/party/referenceCrawler';
import { floorReferencePartyLevel } from '../core/difficulty/floorReferenceLevel';
import { randomInt } from '../utils';
import { escapeFromCircleZones } from '../systems/circleHazardEscape';
import { stepAlongEscape, type HazardEscape } from '../systems/GroundHazardSource';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { retreatBehindHelper } from './tactics/retreat';
import type { KiteAim } from './tactics/tacticalFrame';
import type { SiegeLobber, SiegePoint } from './siege/siegeTypes';
import {
  GoblinBomberAnimator,
  drawGoblinBomberSprite,
  goblinBomberBodyPartKey,
  goblinBomberEyePlacement,
  goblinBombReleaseFrame,
  goblinBombReleaseHand,
  goblinFuseCatchFrame,
  prewarmGoblinBomberCombat,
  type GoblinBomberAction,
  type GoblinBomberArchetype,
  type GoblinBomberLocomotion,
} from '../sprites/goblinBomberSprite';
import {
  GOBLIN_BOMB_HAZARD_MARGIN_PX,
  GOBLIN_BOMB_MAX_RANGE_TILES,
  GOBLIN_DYNAMITE_DROP_FLIGHT_FRAMES,
  GOBLIN_DYNAMITE_SETTLE_PX,
  activeBomberTuning,
  goblinBombBlastRadiusPx,
  goblinBombFlightFrames,
  type BomberActionFrames,
  type BomberTuning,
  resolveGoblinBombLanding,
  type BombPoint,
  type BombThrower,
  type GoblinBombShot,
  type GoblinBombShotBase,
} from '../systems/goblinBombConstants';

/**
 * How hard a bomber's blast lands on a siege wall or trebuchet, as a multiple
 * of what the same blast does to a crawler. A powder charge is made for
 * breaching, so the village's timber takes three times what a body does.
 */
export const BOMBER_SIEGE_STRUCTURE_MULTIPLIER = 3;

/** The fewest explosives a dead bomber drops: the one it was holding, at least. */
export const BOMBER_LOOT_MIN_QUANTITY = 1;
export const BOMBER_LOOT_MAX_QUANTITY = 3;

/** A sound a bomber asks for, drained by the scene's creature-audio pass. */
export type BomberGoblinSoundCue =
  /** The frame the fuse catches on the light row. */
  | 'fuseLit'
  /** The Dynamite Goblin's giggle as it reaches for the candle. */
  | 'cackle'
  /** The release: the toss and the goblin's grunt. */
  | 'throw'
  /** "Fire in the hole!" or "Bombs away!" — the warning shout. */
  | 'shout';

const BOMBER_HP = 5;
const AGGRO_RANGE_TILES = 9;

/**
 * Clearance past its own blast's reach that a bomber's preferred band begins
 * at. Inside the band it backs off, so it is rarely near enough to be caught
 * by its own throw even before the self-safety check refuses one.
 */
const BAND_CLEARANCE_TILES = 0.5;
/** How far inside the throw range cap the band ends, so a target at its edge is still in reach. */
const BAND_RANGE_SLACK_TILES = 0.25;

/**
 * How near the lob must come down to the target's feet to count as a throw at
 * them, as a share of the blast radius. A lob stopped at a wall short of the
 * target is a wasted bomb, so the bomber moves for a better angle instead.
 */
const LANDING_ON_TARGET_SHARE = 0.5;

/**
 * Frames between one close-range answer (the Dynamite Goblin's dropped stick,
 * the Black Powder Goblin's hop) and the next, at level 1. Scaled with level
 * like every cadence. Long enough that a crawler who weathers one has a window
 * to land blows before the next.
 */
const CLOSE_MOVE_COOLDOWN_FRAMES = 210;

/** Frames the Dynamite Goblin's flick of a lit stick to the floor takes, on its throw row. */
const DROP_ACTION_FRAMES = 14;
/**
 * How far toward the crawler the dropped stick falls, in tiles: far enough
 * that the way out of its circle is away from them, near enough that a
 * crawler in the goblin's face is well inside it.
 */
const DROP_TOSS_TILES = 0.5;
/**
 * The longest a Dynamite Goblin spends scurrying out of its own dropped
 * stick's circle. Well over the walk out at its retreat speed; the cap only
 * stops a goblin wedged in a corner from running on the spot for good.
 */
const SCURRY_MAX_FRAMES = 60;

/** Frames the Black Powder Goblin's hop back from a crawler in its face lasts. */
const HOP_FRAMES = 18;
/**
 * The hop's speed, as a share of the player's: a leap, not a walk, carrying
 * it nearly three tiles back, well clear of a crawler on its heels, before it locks.
 */
const HOP_SPEED_RATIO = 2;
const HOP_SPEED = PLAYER_SPEED * HOP_SPEED_RATIO;

/**
 * How much of each frame's movement the smoothed target velocity takes in.
 * Low enough that a single jink does not swing the aim, high enough that a
 * crawler who turns is tracked within a few frames.
 */
const AIM_VELOCITY_SMOOTHING = 0.25;
/** A target's step longer than this many player steps in one frame is a teleport, not a walk. */
const AIM_TELEPORT_STEPS = 3;
const AIM_TELEPORT_PX = PLAYER_SPEED * AIM_TELEPORT_STEPS;

const COIN_DROP_MIN = 2;
const COIN_DROP_MAX = 5;
const XP_VALUE = 8;
const CENTER_OFFSET = 0.5;

const MILLISECONDS_PER_SECOND = 1000;

const NO_BOMBS: readonly GoblinBombShot[] = [];
const NO_CUES: readonly BomberGoblinSoundCue[] = [];

const BOMBER_TACTICS: readonly TacticsTrait[] = ['kite', 'regroup'];

/** Ground with nothing on it, for a bomber standing on no map (a harness). */
const OPEN_GROUND: Pick<GameMap, 'isWalkable' | 'blocksLob'> = {
  isWalkable: () => true,
  blocksLob: () => false,
};

/**
 * What a bomber is doing: `ready` is free to move, `light`/`aim`/`throw` are a
 * lob, `drop` is the Dynamite Goblin's flick of a stick at its own feet and
 * `hop` the Black Powder Goblin's leap back before it locks.
 */
type BomberPhase = 'ready' | 'light' | 'aim' | 'throw' | 'drop' | 'hop';

/** What a bomber does when a crawler is inside its band. */
export type BomberCloseMove = 'drop' | 'hop';

/**
 * What both bomber goblins share: a pack goblin that holds a band well outside
 * its own blast, lights, (aims,) and lobs an explosive that `GoblinBombSystem`
 * flies and sets off.
 *
 * Neither is a `Goblin`: they never swing, so none of the melee goblin's
 * windup, combo or guard applies. They answer the goblins' pack alert, so a
 * bomber behind a melee line is part of the same fight.
 *
 * Closing in does not shut one down. Inside its band it backs off nearly as
 * fast as a crawler walks and keeps throwing whenever a lob would land clear
 * of itself, and a crawler in its face gets its close-range answer
 * ({@link BomberCloseMove}). Every lob is led toward where the target is
 * heading.
 *
 * The blast takes a fixed share of each struck crawler's own max HP and never
 * grows with the bomber's own level: once a crawler is caught inside the
 * radius nothing can be done about it, so the level only buys a quicker
 * cadence (P2 in `docs/difficulty-fairness-rules.md`).
 */
export abstract class GoblinBomber extends Mob implements BombThrower, SiegeLobber {
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  private readonly goreBodyPartKey: string;

  override get bodyPartKey(): string {
    return this.goreBodyPartKey;
  }

  private readonly animator: GoblinBomberAnimator;
  private readonly aggroRangePx: number;
  private readonly bandMinPx: number;
  private readonly bandMaxPx: number;
  private readonly blastRadiusPx: number;
  /**
   * No throw is let go whose landing is nearer the bomber than this: its own
   * blast's reach plus the margin allies keep, plus, for a stick, the roll it
   * may take after landing.
   */
  private readonly selfSafetyPx: number;

  /** The tuning the walk speed was last authored from. */
  private speedTuning: BomberTuning;
  private phase: BomberPhase = 'ready';
  /** The tuning the action under way started on; null between actions. */
  private latchedTuning: BomberTuning | null = null;
  /** Whether the action under way has already let its explosive go. */
  private hasReleased = false;
  /** Frames since the current phase began. */
  private phaseFrames = 0;
  private throwCooldown = 0;
  private closeMoveCooldown = 0;
  /** The unit direction of a hop under way, away from the crawler that set it off. */
  private hopDirection: HazardEscape = { dx: 0, dy: 0 };
  /** A dropped stick's landing the Dynamite Goblin is scurrying clear of; null when none. */
  private scurryFrom: BombPoint | null = null;
  private scurryFramesLeft = 0;
  /** The target whose motion {@link targetVelocity} follows, and its feet last frame. */
  private trackedTarget: Player | null = null;
  private trackedFeet: BombPoint | null = null;
  /** The tracked target's smoothed step per frame, in pixels: what a lob is led by. */
  private targetVelocity: BombPoint = { x: 0, y: 0 };
  private retreatFrames = 0;
  private retreatCooldown = 0;
  private isAggro = false;
  private isRetreating = false;
  /** Set by every `updateAI`, cleared by `tickTimers`: a frame without one interrupts the action. */
  private aiRanThisFrame = false;
  /** The target's feet, last time the bomber could see them. */
  private aimPoint: BombPoint | null = null;
  /** The black powder landing fixed on the first lock frame; null when nothing is locked. */
  private lockedLanding: BombPoint | null = null;
  private liveStickCount = 0;
  private previousHp: number;
  /**
   * Throws let go but not yet handed to `GoblinBombSystem`. The bomber never
   * owns a bomb in flight: it stops being updated and drawn the frame it dies,
   * and a bomb stored here would vanish in mid-air with it.
   */
  private pendingBombs: GoblinBombShot[] = [];
  private readonly pendingSoundCues = new Set<BomberGoblinSoundCue>();

  protected constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    readonly archetype: GoblinBomberArchetype,
  ) {
    super(tileX, tileY, tileSize, BOMBER_HP, activeBomberTuning().walkSpeed);
    this.speedTuning = activeBomberTuning();
    this.animator = new GoblinBomberAnimator(archetype);
    this.goreBodyPartKey = goblinBomberBodyPartKey(archetype);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.blastRadiusPx = goblinBombBlastRadiusPx(archetype);
    const rollPx = archetype === 'dynamite' ? GOBLIN_DYNAMITE_SETTLE_PX : 0;
    this.selfSafetyPx = this.blastRadiusPx + GOBLIN_BOMB_HAZARD_MARGIN_PX + rollPx;
    this.bandMinPx = this.selfSafetyPx + tileSize * BAND_CLEARANCE_TILES;
    this.bandMaxPx = tileSize * (GOBLIN_BOMB_MAX_RANGE_TILES - BAND_RANGE_SLACK_TILES);
    this.previousHp = this.hp;
  }

  /** The share of a struck crawler's own max HP one blast takes. */
  abstract get crawlerHpShare(): number;
  /** What it does when a crawler gets inside its band, where the difficulty allows one. */
  protected abstract get closeMove(): BomberCloseMove;
  /** The explosive a dead bomber always drops. */
  protected abstract get carriedExplosive(): ItemId;
  /** Whether the bomber holds an aimed lock between lighting and throwing. */
  protected abstract get aimsBeforeThrowing(): boolean;
  /** Whether a new throw may begin, beyond the shared range and cooldown rules. */
  protected abstract get mayStartThrow(): boolean;
  /** Whether it giggles as it starts to light. */
  protected abstract get cacklesWhenLighting(): boolean;
  /**
   * When it shouts its warning: on the first lock frame for a bomber that
   * locks, so the throw is heard coming, otherwise as the explosive leaves
   * the hand.
   */
  protected abstract get shoutsOn(): 'lockStart' | 'release';

  protected override get eyePlacement(): EyePlacement {
    return goblinBomberEyePlacement(this.archetype);
  }

  /** Answers the goblin pack's alert, so a room fights as one band. */
  override get packKind(): string {
    return GOBLIN_PACK_KIND;
  }

  protected override get packAlertRadiusTiles(): number {
    return GOBLIN_PACK_ALERT_RADIUS_TILES;
  }

  protected override get levelledSpeedCap(): number {
    return PLAYER_SPEED * this.tuning.maxSpeedRatio;
  }

  /** The difficulty's bomber tuning, read live. */
  private get tuning(): BomberTuning {
    return activeBomberTuning();
  }

  /**
   * The tuning the action under way was started on, or the live one between
   * actions. An action's timing must hold from its first frame to its last: a
   * difficulty flipped mid-action would otherwise move its release, lock and
   * row lengths under it, and the circle already drawn would no longer match
   * the throw.
   */
  private get actionTuning(): BomberTuning {
    return this.latchedTuning ?? this.tuning;
  }

  /** This bomber's light and throw rows, in game frames, for the action under way. */
  private get actionFrames(): BomberActionFrames {
    return this.actionTuning.actionFrames[this.archetype];
  }

  /** The throw's release frame for the action under way. */
  private get releaseFrame(): number {
    return goblinBombReleaseFrame(this.archetype, this.actionFrames.throw);
  }

  /**
   * Frames of the target's current motion a lob is led by: the difficulty's
   * share of the time from the frame its landing is fixed to the blast.
   */
  private get aimLeadFrames(): number {
    const tuning = this.actionTuning;
    const flight = goblinBombFlightFrames(tuning, this.archetype);
    const fixedToBlast = this.aimsBeforeThrowing
      ? tuning.bombardierLockFrames + this.releaseFrame + flight
      : flight;
    return Math.round(tuning.aimLeadShare[this.archetype] * fixedToBlast);
  }

  /**
   * Re-authors the walk speed when the difficulty has changed since it was
   * last set, keeping the level's scaling and the tuning's cap.
   */
  private syncSpeedToTuning(): void {
    const tuning = this.tuning;
    if (tuning === this.speedTuning) return;
    this.speedTuning = tuning;
    this.setBaseSpeed(tuning.walkSpeed);
  }

  /**
   * A thrower that fights from behind its own line: it falls back so a melee
   * goblin stands between it and the player, and falls back on one when hurt.
   * Never `block` — a bomb is no guard.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return BOMBER_TACTICS;
  }

  protected override get regroupAim(): KiteAim {
    return retreatBehindHelper;
  }

  /**
   * Its throws are long, telegraphed and dodgeable, so the companion dodges —
   * but only once it is fighting, since this flag wakes a mob at any distance.
   */
  override get requiresEvasion(): boolean {
    return this.currentTarget !== null || this.phase !== 'ready';
  }

  override get bombThrower(): BombThrower {
    return this;
  }

  override get siegeLobber(): SiegeLobber {
    return this;
  }

  get lobBandMinPx(): number {
    return this.bandMinPx;
  }

  get lobBandMaxPx(): number {
    return this.bandMaxPx;
  }

  /**
   * One frame of a siege lob at a ground point the assault chose — a wall, a
   * trebuchet or a defender — standing in for `updateAI` on that frame, so an
   * action it starts here is not cancelled for want of one.
   */
  lobAt(point: SiegePoint | null): boolean {
    if (!this.isAlive) return false;
    if (this.isStaggered) {
      this.beginSiegeFrame();
      this.cancelAction();
      this.isMoving = false;
      return true;
    }
    if (this.phase !== 'ready') {
      this.beginSiegeFrame();
      this.forgetTargetMotion();
      if (point !== null) this.aimPoint = point;
      this.tickAction(this.lockedLanding ?? this.aimPoint);
      return true;
    }
    if (this.scurryFrom !== null) {
      this.beginSiegeFrame();
      if (this.scurryClear(null)) return true;
    }
    if (point === null) return false;
    const landing = this.safeLandingToward(point);
    if (landing === null || !this.landsOn(landing, point)) return false;
    this.beginSiegeFrame();
    this.forgetTargetMotion();
    this.aimPoint = point;
    this.currentTarget = null;
    this.isMoving = false;
    this.faceToward(groundToOrigin(point, this.tileSize));
    if (this.throwCooldown > 0 || !this.mayStartThrow) return true;
    this.beginEngagement();
    this.startLight();
    return true;
  }

  /** What `updateAI` does at the top of every frame, for a frame the siege drives instead. */
  private beginSiegeFrame(): void {
    this.syncSpeedToTuning();
    this.aiRanThisFrame = true;
    this.isRetreating = false;
    this.tickCooldowns();
  }

  /**
   * Whether a shove is under way. Checked before an action ticks as well as
   * in `tickTimers`: the mob loop runs `updateAI` before the shove that lands
   * this frame is applied, so a stagger read only afterwards would let the
   * very next frame's release through.
   */
  private get isStaggered(): boolean {
    return this.knockbackFramesRemaining > 0;
  }

  private tickCooldowns(): void {
    if (this.throwCooldown > 0) this.throwCooldown--;
    if (this.retreatCooldown > 0) this.retreatCooldown--;
    if (this.closeMoveCooldown > 0) this.closeMoveCooldown--;
  }

  /** Whether a lob coming down at `landing` counts as a throw at `target`. */
  private landsOn(landing: BombPoint, target: BombPoint): boolean {
    return (
      Math.hypot(landing.x - target.x, landing.y - target.y) <=
      this.blastRadiusPx * LANDING_ON_TARGET_SHARE
    );
  }

  private startLight(): void {
    this.beginAction();
    this.enterPhase('light');
    if (this.cacklesWhenLighting) this.raiseSoundCue('cackle');
  }

  /**
   * What one blast would take from an on-curve crawler for the floor being
   * played: the base a siege wall's or trebuchet's damage is a multiple of.
   * Crawlers themselves take {@link crawlerHpShare} of their own max HP.
   */
  get referenceBlastDamage(): number {
    return Math.max(
      1,
      Math.round(this.crawlerHpShare * onCurveCrawlerMaxHp(floorReferencePartyLevel())),
    );
  }

  /**
   * What the blast does to each wall and trebuchet it reaches, should a siege
   * be running: the powder's own breaching multiple, times the siege's scale
   * on every attacker's blows. The multiple sits on the blast alone, so the
   * bomber's swing at the bell is no harder than anyone else's.
   */
  private get structureDamage(): number {
    const siegeScale =
      this.siegeCapable?.structureDamageMultiplier ?? this.siegeStructureMultiplier;
    return this.referenceBlastDamage * BOMBER_SIEGE_STRUCTURE_MULTIPLIER * siegeScale;
  }

  takePendingBombs(): readonly GoblinBombShot[] {
    if (this.pendingBombs.length === 0) return NO_BOMBS;
    const bombs = this.pendingBombs;
    this.pendingBombs = [];
    return bombs;
  }

  get lockedBombLanding(): BombPoint | null {
    return this.isAlive ? this.lockedLanding : null;
  }

  get lockedBombProgress(): number {
    if (this.phase !== 'aim') return 1;
    return Math.min(1, this.phaseFrames / this.actionTuning.bombardierLockFrames);
  }

  noteLiveSticks(count: number): void {
    this.liveStickCount = count;
  }

  /** This bomber's own sticks in the air or on the floor, including one let go this frame. */
  protected get liveSticks(): number {
    return this.liveStickCount + this.pendingBombs.length;
  }

  /** The sounds asked for since the last call, emptied by the call. */
  takeSoundCues(): readonly BomberGoblinSoundCue[] {
    if (this.pendingSoundCues.size === 0) return NO_CUES;
    const cues = [...this.pendingSoundCues];
    this.pendingSoundCues.clear();
    return cues;
  }

  private raiseSoundCue(cue: BomberGoblinSoundCue): void {
    this.pendingSoundCues.add(cue);
  }

  /** Which action row is playing, or null when the bomber is free to move or hopping. */
  get currentAction(): 'light' | 'aim' | 'throw' | null {
    if (this.phase === 'ready' || this.phase === 'hop') return null;
    return this.phase === 'drop' ? 'throw' : this.phase;
  }

  override clearAirborneAttacks(): void {
    this.pendingBombs = [];
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.cancelAction();
    this.throwCooldown = 0;
    this.closeMoveCooldown = 0;
    this.scurryFrom = null;
    this.scurryFramesLeft = 0;
    this.forgetTargetMotion();
    this.isAggro = false;
    this.isRetreating = false;
    this.retreatFrames = 0;
    this.retreatCooldown = 0;
    this.aimPoint = null;
    this.pendingBombs = [];
    this.pendingSoundCues.clear();
    this.previousHp = this.hp;
    this.animator.reset();
  }

  /**
   * The explosive it carried, always: one or more of whatever it was throwing,
   * the held one among them, so a bomber killed mid-aim drops its bomb rather
   * than letting it go off.
   */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // A thrower's book on staying out of a blast's way.
    maybeDropSkillBook(items, 'skill_book_cat_reflexes');
    items.push({
      id: this.carriedExplosive,
      quantity: randomInt(BOMBER_LOOT_MIN_QUANTITY, BOMBER_LOOT_MAX_QUANTITY),
    });
    return items;
  }

  /**
   * Warms every row a fight draws on the frame this bomber first notices a
   * target; aggro range is well outside its band, which is the lead that buys.
   */
  private beginEngagement(): void {
    if (this.isAggro) return;
    this.isAggro = true;
    prewarmGoblinBomberCombat(this.archetype);
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.syncSpeedToTuning();
    this.aiRanThisFrame = true;
    this.isRetreating = false;
    this.tickCooldowns();

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    if (nearest !== null && this.canSee(nearest)) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
      this.aimPoint = feetOf(nearest, this.tileSize);
      this.trackTargetMotion(nearest);
    } else {
      this.forgetTargetMotion();
    }

    if (this.isStaggered) this.cancelAction();

    if (this.phase !== 'ready') {
      if (nearest === null) this.isAggro = false;
      else this.beginEngagement();
      this.tickAction(
        this.lockedLanding ?? (nearest === null ? null : feetOf(nearest, this.tileSize)),
      );
      return;
    }

    if (this.scurryFrom !== null && this.scurryClear(nearest)) return;

    if (nearest === null) {
      this.isAggro = false;
      this.retreatFrames = 0;
      this.aimPoint = null;
      this.tactics.disengage();
      this.clearAStarPath();
      this.returnHomeOrWander();
      return;
    }

    this.beginEngagement();
    this.hold(nearest);
  }

  /** Folds this frame's step of `target` into {@link targetVelocity}. */
  private trackTargetMotion(target: Player): void {
    const feet = feetOf(target, this.tileSize);
    const previous = this.trackedFeet;
    this.trackedFeet = feet;
    if (this.trackedTarget !== target || previous === null) {
      this.trackedTarget = target;
      this.targetVelocity = { x: 0, y: 0 };
      return;
    }
    const stepX = feet.x - previous.x;
    const stepY = feet.y - previous.y;
    if (Math.hypot(stepX, stepY) > AIM_TELEPORT_PX) {
      this.targetVelocity = { x: 0, y: 0 };
      return;
    }
    const velocity = this.targetVelocity;
    this.targetVelocity = {
      x: velocity.x + (stepX - velocity.x) * AIM_VELOCITY_SMOOTHING,
      y: velocity.y + (stepY - velocity.y) * AIM_VELOCITY_SMOOTHING,
    };
  }

  private forgetTargetMotion(): void {
    this.trackedTarget = null;
    this.trackedFeet = null;
    this.targetVelocity = { x: 0, y: 0 };
  }

  /**
   * Where a lob at `aim` comes down once led by the target's motion, or the
   * unled landing when the led one would catch the bomber or miss the target's
   * line; null when neither is safe.
   */
  private ledLandingToward(aim: BombPoint): BombPoint | null {
    const unled = this.safeLandingToward(aim);
    const leadX = this.targetVelocity.x * this.aimLeadFrames;
    const leadY = this.targetVelocity.y * this.aimLeadFrames;
    const leadPx = Math.hypot(leadX, leadY);
    if (leadPx === 0) return unled;
    const maxLeadPx = this.tileSize * this.actionTuning.maxAimLeadTiles;
    const leadScale = leadPx > maxLeadPx ? maxLeadPx / leadPx : 1;
    const ledAim = { x: aim.x + leadX * leadScale, y: aim.y + leadY * leadScale };
    const led = this.safeLandingToward(ledAim);
    if (led === null || !this.landsOn(led, ledAim)) return unled;
    return led;
  }

  private canSee(target: Player): boolean {
    if (this.map === null) return true;
    const self = feetOf(this, this.tileSize);
    const them = feetOf(target, this.tileSize);
    return this.map.hasLineOfSight(self.x, self.y, them.x, them.y);
  }

  /**
   * One frame of a light, aim or throw already under way. The bomber stands
   * still and keeps facing `facing`, a ground point: its target's feet, or a
   * bombardier's locked landing once the lock begins.
   */
  private tickAction(facing: BombPoint | null): void {
    this.isMoving = false;
    if (facing !== null) this.faceToward(groundToOrigin(facing, this.tileSize));

    this.phaseFrames++;
    const frames = this.actionFrames;
    if (this.phase === 'hop') {
      this.tickHop();
    } else if (this.phase === 'drop') {
      if (this.phaseFrames >= this.dropReleaseFrame && !this.hasReleased) this.releaseDrop();
      if (this.phaseFrames >= DROP_ACTION_FRAMES) this.enterPhase('ready');
    } else if (this.phase === 'light') {
      if (this.phaseFrames === goblinFuseCatchFrame(this.archetype, frames.light)) {
        this.raiseSoundCue('fuseLit');
      }
      if (this.phaseFrames >= frames.light) {
        if (this.aimsBeforeThrowing) this.beginLock();
        else this.enterPhase('throw');
      }
    } else if (this.phase === 'aim') {
      if (this.phaseFrames >= this.actionTuning.bombardierLockFrames) this.enterPhase('throw');
    } else if (this.phase === 'throw') {
      if (this.phaseFrames >= this.releaseFrame && !this.hasReleased) this.release();
      if (this.phaseFrames >= frames.throw) this.enterPhase('ready');
    }
  }

  private enterPhase(phase: BomberPhase): void {
    this.phase = phase;
    this.phaseFrames = 0;
    if (phase !== 'ready') return;
    // Nothing locked outlives the action that locked it, however that action ended.
    this.lockedLanding = null;
    this.latchedTuning = null;
  }

  /** Latches the live tuning for a new action and readies its one release. */
  private beginAction(): void {
    this.latchedTuning = this.tuning;
    this.hasReleased = false;
  }

  /**
   * One frame of the Black Powder Goblin's hop: a leap straight away from the
   * crawler that set it off, sliding along a wall rather than into it, and
   * then straight into the lock. The bomb was lit as the hop began, so there
   * is no light row after it.
   */
  private tickHop(): void {
    stepAlongEscape(
      this,
      this.hopDirection,
      HOP_SPEED,
      (dx, dy) => this.moveWithCollision(dx, dy),
      true,
    );
    this.isMoving = true;
    this.isRetreating = true;
    if (this.phaseFrames >= HOP_FRAMES) {
      this.isMoving = false;
      this.beginLock();
    }
  }

  /**
   * The drop's frame the stick leaves the hand on: the throw row's own
   * release, played over the drop's frames, so the hand is never shown empty
   * before the stick is let go.
   */
  private get dropReleaseFrame(): number {
    return goblinBombReleaseFrame(this.archetype, DROP_ACTION_FRAMES);
  }

  /**
   * Starts the close-range answer to a crawler inside the band: the Dynamite
   * Goblin flicks a lit stick down between them and scurries out of its
   * circle; the Black Powder Goblin hops back and locks at once.
   */
  private startCloseMove(target: Player): void {
    this.closeMoveCooldown = this.scaledCooldownFrames(CLOSE_MOVE_COOLDOWN_FRAMES);
    this.retreatFrames = 0;
    this.isMoving = false;
    this.faceToward(target);
    this.raiseSoundCue('fuseLit');
    this.beginAction();
    if (this.closeMove === 'drop') {
      this.enterPhase('drop');
      return;
    }
    const self = feetOf(this, this.tileSize);
    const them = feetOf(target, this.tileSize);
    const awayX = self.x - them.x;
    const awayY = self.y - them.y;
    const away = Math.hypot(awayX, awayY);
    const facingAway = { dx: -Math.sign(this.facingX) || 1, dy: 0 };
    this.hopDirection = away === 0 ? facingAway : { dx: awayX / away, dy: awayY / away };
    this.enterPhase('hop');
  }

  /**
   * Lets go of the dropped stick: it falls half a tile toward the crawler, so
   * they are inside its circle and the goblin's way out is away from them,
   * and the goblin starts scurrying clear.
   */
  private releaseDrop(): void {
    const feet = feetOf(this, this.tileSize);
    const aim = this.aimPoint ?? feet;
    const offsetX = aim.x - feet.x;
    const offsetY = aim.y - feet.y;
    const reach = Math.hypot(offsetX, offsetY);
    const tossPx = Math.min(reach, this.tileSize * DROP_TOSS_TILES);
    const toward =
      reach === 0
        ? feet
        : { x: feet.x + (offsetX / reach) * tossPx, y: feet.y + (offsetY / reach) * tossPx };
    const landing = resolveGoblinBombLanding(this.map ?? OPEN_GROUND, feet, toward);
    this.hasReleased = true;
    this.queueShot(landing, GOBLIN_DYNAMITE_DROP_FLIGHT_FRAMES);
    this.raiseSoundCue('shout');
    this.scurryFrom = landing;
    this.scurryFramesLeft = SCURRY_MAX_FRAMES;
  }

  /**
   * One frame of scurrying out of its own dropped stick's circle, widened by
   * the roll and the margin allies keep; false once clear, when the bomber is
   * free to act again.
   */
  private scurryClear(nearest: Player | null): boolean {
    const from = this.scurryFrom;
    if (from === null) return false;
    const zone = { x: from.x, y: from.y, radiusPx: this.selfSafetyPx };
    const escape = escapeFromCircleZones(this.map ?? OPEN_GROUND, [zone], this.x, this.y);
    if (escape === null || this.scurryFramesLeft <= 0) {
      this.scurryFrom = null;
      return false;
    }
    this.scurryFramesLeft--;
    stepAlongEscape(this, escape, this.retreatSpeed, (dx, dy) => this.moveWithCollision(dx, dy));
    this.isMoving = true;
    this.isRetreating = true;
    if (nearest !== null) this.faceToward(nearest);
    return true;
  }

  /** How fast it backs off and scurries: never slower than its own walk. */
  private get retreatSpeed(): number {
    return Math.max(this.speed, PLAYER_SPEED * this.tuning.retreatSpeedRatio);
  }

  /**
   * Fixes the black powder landing on the first frame of the lock: where the
   * target is heading, clamped to range and walls. Everything after — the
   * rest of the lock, the release, the flight — comes down here, wherever the
   * target walks.
   */
  private beginLock(): void {
    const landing = this.aimPoint === null ? null : this.ledLandingToward(this.aimPoint);
    if (landing === null) {
      this.cancelAction();
      return;
    }
    this.lockedLanding = landing;
    this.enterPhase('aim');
    if (this.shoutsOn === 'lockStart') this.raiseSoundCue('shout');
  }

  /**
   * Lets go of the explosive. A stick goes where the target is heading on
   * this frame; a black powder bomb goes where its lock fixed. A throw that
   * would now come down on the bomber itself — a lock it was shoved toward
   * included — is held back instead.
   */
  private release(): void {
    this.hasReleased = true;
    const locked = this.lockedLanding;
    this.lockedLanding = null;
    const landing = locked === null ? this.unlockedReleaseLanding() : this.lockStillClear(locked);
    if (landing === null) {
      this.cancelAction();
      return;
    }
    const tuning = this.actionTuning;
    this.queueShot(landing, goblinBombFlightFrames(tuning, this.archetype));
    this.throwCooldown = this.scaledCooldownFrames(tuning.throwCooldownFrames[this.archetype]);
    if (this.shoutsOn === 'release') this.raiseSoundCue('shout');
  }

  /** A stick's landing on release: where the target is heading, or null when no lob is safe. */
  private unlockedReleaseLanding(): BombPoint | null {
    return this.aimPoint === null ? null : this.ledLandingToward(this.aimPoint);
  }

  /** The locked landing, unless a shove during the lock brought the bomber inside its circle. */
  private lockStillClear(locked: BombPoint): BombPoint | null {
    return this.isClearOfSelf(locked) ? locked : null;
  }

  /** Hands one explosive to `GoblinBombSystem`, with the toss and its sound. */
  private queueShot(landing: BombPoint, flightFrames: number): void {
    const shot: GoblinBombShotBase = {
      start: feetOf(this, this.tileSize),
      hand: this.handPoint(),
      landing,
      flightFrames,
      crawlerHpShare: this.crawlerHpShare,
      structureDamage: this.structureDamage,
      thrower: this,
      releaseHeightPx: this.releaseHeightPx(),
    };
    this.pendingBombs.push(
      this.archetype === 'dynamite'
        ? { ...shot, kind: 'dynamite', fuse: this.actionTuning.fuse }
        : { ...shot, kind: 'black_powder' },
    );
    this.projectileSoundPending = true;
    this.raiseSoundCue('throw');
  }

  /**
   * Abandons whatever action is under way: the circle goes, nothing is thrown,
   * and the bomber waits a moment before lighting again. Used when it is
   * staggered or its AI is taken from it mid-action, and when a throw would
   * now land on itself.
   */
  private cancelAction(): void {
    const wasActing = this.phase !== 'ready';
    const recoveryFrames = this.actionTuning.interruptedRecoveryFrames;
    this.enterPhase('ready');
    if (wasActing) {
      this.throwCooldown = Math.max(this.throwCooldown, this.scaledCooldownFrames(recoveryFrames));
    }
  }

  /** The ground point under the hand the explosive leaves, where its flight is drawn from. */
  private handPoint(): BombPoint {
    const feet = feetOf(this, this.tileSize);
    const hand = goblinBombReleaseHand(this.archetype, this.facingX);
    return { x: feet.x + this.tileSize * hand.forwardTiles, y: feet.y };
  }

  /**
   * How high above {@link handPoint} the hand is. The figure stands on the
   * bottom of its tile, but the ground point every lob is measured from is the
   * tile's centre, which sits that much higher on screen, so the gap comes off
   * the hand's height above the figure's own ground.
   */
  private releaseHeightPx(): number {
    const hand = goblinBombReleaseHand(this.archetype, this.facingX);
    const tileCentreToBottomTiles = 1 - CENTER_OFFSET;
    return this.tileSize * (hand.upTiles - tileCentreToBottomTiles);
  }

  /** Where a lob at `target` would come down, or null when it would catch the bomber. */
  private safeLandingToward(target: BombPoint): BombPoint | null {
    const feet = feetOf(this, this.tileSize);
    const landing = resolveGoblinBombLanding(this.map ?? OPEN_GROUND, feet, target);
    return this.isClearOfSelf(landing) ? landing : null;
  }

  /** Whether a blast at `landing` leaves the bomber where it stands now untouched. */
  private isClearOfSelf(landing: BombPoint): boolean {
    const feet = feetOf(this, this.tileSize);
    return Math.hypot(landing.x - feet.x, landing.y - feet.y) >= this.selfSafetyPx;
  }

  /** Movement, and whether to start a throw, for a bomber that is not mid-action. */
  private hold(nearest: Player): void {
    const target = feetOf(nearest, this.tileSize);
    const hasLineOfSight = this.canSee(nearest);
    const landing = hasLineOfSight ? this.safeLandingToward(target) : null;
    const landsOnTarget = landing !== null && this.landsOn(landing, target);

    const distance = this.distanceTo(nearest);
    const isCrowded = distance < this.bandMinPx;
    const tuning = this.tuning;

    const tacticalMove = this.chooseTacticalStep(
      nearest,
      this.bandMinPx,
      true,
      retreatBehindHelper,
    );
    if (tacticalMove?.breaksOff === true) {
      this.retreatFrames = 0;
      this.retreatCooldown = tuning.retreatCooldownFrames;
      this.isRetreating = true;
      this.walkTacticalStep(tacticalMove, nearest);
      return;
    }

    // After the kite: falling back behind a friend is the better answer when
    // there is one, and the close move is for a crawler who got past it. A
    // dropped stick counts against the live-stick cap like a thrown one.
    const mayCloseMove =
      tuning.closeMoves &&
      hasLineOfSight &&
      this.closeMoveCooldown === 0 &&
      !this.isStaggered &&
      this.mayStartThrow;
    if (isCrowded && mayCloseMove) {
      this.startCloseMove(nearest);
      return;
    }

    if (isCrowded && this.retreatFrames === 0 && this.retreatCooldown === 0) {
      this.retreatFrames = tuning.retreatMaxFrames;
      this.retreatCooldown = tuning.retreatCooldownFrames;
    }

    if (this.retreatFrames > 0) {
      this.retreatFrames--;
      if (distance >= this.bandMinPx) {
        this.retreatFrames = 0;
        this.isMoving = false;
      } else {
        this.backAwayFrom(nearest);
        // Without it a crawler inside the band is safe from the lob for as
        // long as the retreat lasts: the gentler difficulty's opening.
        if (!tuning.throwsWhileRetreating) return;
      }
    } else if (!landsOnTarget && distance >= this.bandMinPx) {
      // No lob from here would land: move onto the last place it saw them,
      // looking for an angle.
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.bandMinPx,
      );
    } else if (distance > this.bandMaxPx) {
      if (this.isBeyondLeash(this.x, this.y)) {
        this.returnHomeOrWander();
      } else {
        this.followTargetAStar(nearest.x, nearest.y, this.speed, this.bandMaxPx);
      }
    } else {
      this.isMoving = false;
    }

    if (!this.isMoving) this.faceToward(nearest);

    // Self-safety is read off the landing rather than off the distance alone:
    // a wall between the two can bring a lob down at the bomber's own feet.
    // Read while backing off too, so a crawler who gives chase still eats a
    // throw whenever one would land clear of the bomber.
    if (!landsOnTarget || distance > this.bandMaxPx || this.throwCooldown > 0) return;
    if (!this.mayStartThrow || this.isStaggered) return;
    this.isMoving = false;
    this.faceToward(nearest);
    this.startLight();
  }

  /**
   * Retreats straight away from a target inside the band, at its retreat
   * speed; a straight line keeps it facing the threat rather than its own
   * path.
   */
  private backAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const speed = this.retreatSpeed;
    this.moveWithCollision((dx / distance) * speed, (dy / distance) * speed);
    this.isMoving = true;
    this.isRetreating = true;
    this.faceToward(target);
  }

  private get locomotion(): GoblinBomberLocomotion {
    if (!this.isMoving) return 'still';
    return this.isRetreating ? 'run' : 'walk';
  }

  /**
   * The animator runs here, not in `updateAI`, because the mob loop skips
   * `updateAI` on a frame a siege directive or a trebuchet threat claims.
   *
   * A frame with no `updateAI` or a shove under way interrupts an action: a
   * staggered or held bomber drops its throw, the circle goes with it, and the
   * bomb is not thrown.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (this.phase !== 'ready' && (this.isStaggered || !this.aiRanThisFrame)) this.cancelAction();
    this.aiRanThisFrame = false;
    if (this.hp < this.previousHp && this.phase === 'ready') this.animator.startFlinch();
    this.previousHp = this.hp;
    this.animator.tick(this.locomotion, this.ownStridePx);
  }

  /** The action row and how far through it the bomber is, or null when none is playing. */
  private get actionFrame(): GoblinBomberAction | null {
    const frames = this.actionFrames;
    if (this.phase === 'light') {
      return { row: 'light', progress: Math.min(1, this.phaseFrames / frames.light) };
    }
    if (this.phase === 'aim') {
      const lockFrames = this.actionTuning.bombardierLockFrames;
      return { row: 'aim', progress: Math.min(1, this.phaseFrames / lockFrames) };
    }
    if (this.phase === 'throw') {
      return { row: 'throw', progress: Math.min(1, this.phaseFrames / frames.throw) };
    }
    if (this.phase === 'drop') {
      return { row: 'throw', progress: Math.min(1, this.phaseFrames / DROP_ACTION_FRAMES) };
    }
    return null;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const resolved = this.animator.resolve(
      performance.now() / MILLISECONDS_PER_SECOND,
      this.locomotion,
      this.actionFrame,
    );
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawGoblinBomberSprite(ctx, {
        archetype: this.archetype,
        x: sx,
        y: sy,
        tileSize,
        facingX: this.facingX,
        state: resolved.state,
        frame: resolved.frame,
      });
    });
    if (this.isAggro) this.renderAggroIndicator(ctx, sx, artTopY, sy, tileSize);
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}

/** The ground point under a body: the centre of the tile it stands on. */
function feetOf(body: { readonly x: number; readonly y: number }, tileSize: number): BombPoint {
  return { x: body.x + tileSize * CENTER_OFFSET, y: body.y + tileSize * CENTER_OFFSET };
}

/** The body origin whose feet stand on `point`, for facing toward a ground point. */
function groundToOrigin(point: BombPoint, tileSize: number): BombPoint {
  return { x: point.x - tileSize * CENTER_OFFSET, y: point.y - tileSize * CENTER_OFFSET };
}
