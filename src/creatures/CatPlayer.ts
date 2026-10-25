import { Player, type FigureMouth, type StatName, type StatusFigureBox } from '../Player';

import type { Mob } from './Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Missile } from '../sprites/catSprite';
import {
  activeCatLook,
  CatAnimator,
  drawCatSprite,
  drawMissiles,
  prewarmCatSprite,
  prewarmMagicMissileCast,
  prewarmCatHold,
  catCellFor,
  type CatHeldDraw,
  type CatSpriteState,
  type CatWorkSwing,
  type MissileDepthLayer,
  CAT_WORK_SWING_OF_TOOL,
} from '../sprites/catSprite';
import { catGarmentsWearing } from '../sprites/garments/itemLooks';
import { setOutfit } from '../sprites/outfits';
import { FacingState } from '../sprites/facingView';
import { drawActivePlayerMarker } from '../sprites/activePlayerMarker';
import { catMouthOf } from '../sprites/crawlerMouths';
import type { GameMap } from '../map/GameMap';
import { normalize } from '../utils';
import type { AbilityManager } from '../core/AbilityManager';
import { getMagicMissileStats } from '../abilities/magicMissile';
import {
  SplatterCopies,
  steerMissileToward,
  type SplatterSource,
} from '../abilities/eyesOfSplatter';
import { TILE_SIZE } from '../core/constants';
import type { CrawlerKind } from '../core/SkillManager';
import { carriedToolTier } from '../core/PartyTools';
import { isOwnedToolKind, type ToolKind, type WorkingTool } from '../core/toolTiers';
import { HELD_VISUALS, workingToolHeldVisual } from '../sprites/held/heldVisuals';
import type { HeldVisualDef } from '../sprites/held/heldVisualDef';
import { heldPhaseAt } from '../sprites/held/heldComposite';
import { catGripOf } from '../sprites/art/catSockets';
import { ITEM_DEF, MOUTH_HELD_KEY, weaponStatsOf } from '../core/ItemDefs';
import { CONSTITUTION_LOCK_SNAPSHOT_VERSION } from '../core/PlayerSnapshot';

/** Single source for this class's crawler identity — used by the UI and by skill eligibility. */
const CAT_CRAWLER_KIND: CrawlerKind = 'cat';

import {
  bareClawDamage,
  CAT_BASE_CONSTITUTION,
  CAT_BASE_HP_OFFSET,
  CAT_DEXTERITY_PER_LEVEL,
  CAT_LOCKED_STATS,
  CAT_STARTING_DEXTERITY,
  CAT_SWIPE_FRAMES,
  missileDamage,
} from '../core/crawlerFormulas';
import { CAT_REFLEXES_DODGE_BONUS_PER_LEVEL } from '../core/SkillManager';
import type { DynamicLightSink } from '../systems/lighting/dynamicLights';

/** Degrees in π radians, for the one place this class works in degrees. */
const DEGREES_PER_HALF_TURN = 180;

const CONSTITUTION_AUDIT_NOTICE = 'Constitution refunded — spend the points';

/** A bursting missile's light, as a share of one in flight. */
const MISSILE_BURST_LIGHT = 0.7;

/** The party's own tools, in the order she shows one on her back before she has used either. */
const STOWABLE_TOOL_KINDS: readonly ToolKind[] = ['axe', 'pickaxe'];

/**
 * The cat crawler. Primary attack (Space): claw swipe, short-range melee.
 * Magic Missile: a hotbar ability that fires an arcane projectile.
 */
export class CatPlayer extends Player {
  /** Which half of the skill roster this crawler is eligible for. */
  readonly crawlerKind = CAT_CRAWLER_KIND;

  override get isCrawler(): boolean {
    return true;
  }
  private missiles: Missile[] = [];
  /** Reused result set for the homing missiles' neighbour queries. */
  private readonly _homingQuery = new Set<Mob>();
  private readonly EXPLODE_FRAMES = 22;
  private missileCooldown = 0;
  private map: GameMap | null = null;
  private abilityManager: AbilityManager | null = null;

  private attackTimer = 0;
  /** The swing lasts exactly as long as the sprite sheet's swipe animation. */
  private readonly ATTACK_FRAMES = CAT_SWIPE_FRAMES;
  /** Frames left before the companion AI may swipe again; see {@link autoMeleeTick}. */
  private autoSwipeCooldown = 0;
  /** Drives her pose: the action playing, plus the boredom timer behind idle breaks. */
  private readonly animator = new CatAnimator();
  /** The view her facing is drawn in, held through the selector's hysteresis. */
  private readonly facing = new FacingState(this.facingX, this.facingY);

  /** Sub-missile spawns queued by CombatSystem this frame; flushed after resolvePlayerAttacks. */
  private pendingSubMissileSpawns: Array<{ x: number; y: number }> = [];
  /** Eyes of Splatter releases queued by CombatSystem this frame, flushed with the sub-missiles. */
  private pendingSplatterReleases: SplatterSource[] = [];
  private readonly splatterCopies = new SplatterCopies();

  /** The mob the cat will automatically shoot at when not player-controlled. */
  autoTarget: Mob | null = null;

  /** Her spell and her healing sit under the first two number keys. */
  private static readonly TOME_HOTBAR_SLOT = 0;
  private static readonly POTION_HOTBAR_SLOT = 1;
  private static readonly MELEE_RANGE_MULTIPLIER = 1.6;
  /**
   * How long the companion AI waits between claw swipes.
   *
   * The human companion's auto-attack cadence, deliberately: the two crawlers
   * fight at the same pace when the computer is driving, and neither of them
   * out-swings the player who is holding the attack key.
   */
  private static readonly AUTO_SWIPE_COOLDOWN_FRAMES = 90;
  private static readonly MISSILE_BASE_RANGE = 3.5;
  private static readonly MISSILE_RANGE_INTELLIGENCE_MULTIPLIER = 0.5;
  private static readonly SUBMISSILE_MAX_DIST_TILES = 1.8;
  /** Half a tile: what you add to a tile origin to get its centre. */
  private static readonly TILE_CENTER_OFFSET = 0.5;

  protected override get statusFigureBox(): StatusFigureBox {
    return activeCatLook().statusFigureBox;
  }

  protected override get statusMouth(): FigureMouth | null {
    return catMouthOf(catCellFor(this.spriteState()));
  }

  private spriteState(held: CatHeldDraw | null = this.heldDraw()): CatSpriteState {
    return {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facing: this.facing.peek(this.facingX, this.facingY),
      isKnockedOut: this.isKnockedOut,
      oneShot: this.animator.current,
      carrying: held?.hold === 'carry',
      working: held !== null && held.hold !== 'carry' ? held.hold : null,
    };
  }
  private static readonly SUBMISSILE_COUNT_BASE = 3;
  private static readonly SUBMISSILE_COUNT_RANDOM_RANGE = 3;
  private static readonly SUBMISSILE_ANGLE_VARIANCE = 0.4;
  private static readonly MISSILE_HOMING_DISTANCE_TILES = 12;
  /** A homing missile only curves toward mobs inside this cone ahead of it. */
  private static readonly HOMING_CONE_HALF_ANGLE_DEGREES = 60;
  private static readonly HOMING_CONE_HALF_ANGLE =
    (CatPlayer.HOMING_CONE_HALF_ANGLE_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
  /** Radians a homing missile may turn per frame. */
  private static readonly HOMING_TURN_RATE = 0.08;
  private static readonly ACTIVE_SPHERE_RADIUS = 4;
  /** Distance above the sprite top where the sphere centre sits. */
  private static readonly ACTIVE_SPHERE_GAP = 3;
  /**
   * Her tallest frames stop this far below the tile anchor (she is drawn at two
   * thirds of a tile), so the sphere has to drop into the tile to hover over
   * her head instead of floating in the air above it.
   */
  private static readonly ACTIVE_SPHERE_SPRITE_TOP = -5;
  /**
   * Belly height, measured off the sheet rather than derived: at 14 px the
   * surface crossed her shoulders, which is a cat swimming, not wading. This
   * cuts just under the belly so her legs are in and her whole body, back and
   * head stay clear.
   *
   * Far shallower than the human's hip-deep water, and that is the per-crawler lie
   * `Player.waterlineAboveFootPx` documents: one honest water depth either takes
   * him to the ankle or puts her under.
   */
  override get waterlineAboveFootPx(): number {
    return CatPlayer.BELLY_WATERLINE_PX;
  }
  private static readonly BELLY_WATERLINE_PX = 9;
  /** Raises the health bar above the sphere so it doesn't overlap the cat's head. */
  private static readonly HEALTH_BAR_RAISE = 16;
  private static readonly AI_MIN_COOLDOWN = 20;
  private static readonly MISS_OFFSET_FACTOR = 0.44;
  private static readonly HOMING_LEVEL_THRESHOLD = 14;
  private static readonly RANDOM_OFFSET_BASE = 0.5;

  setMap(map: GameMap) {
    this.map = map;
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  /** Her missiles light the dark round them as they fly, and flare as they burst. */
  collectLights(sink: DynamicLightSink): void {
    for (const missile of this.missiles) {
      const strength = missile.state === 'flying' ? 1 : MISSILE_BURST_LIGHT;
      sink.add(missile.x, missile.y, 'magic_missile', strength);
    }
  }

  getMagicMissileLevel(): number {
    return this.abilityManager?.getLevel('magic_missile') ?? 1;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, {
      baseHpOffset: CAT_BASE_HP_OFFSET,
      baseStats: {
        constitution: CAT_BASE_CONSTITUTION,
        dexterity: CAT_STARTING_DEXTERITY,
      },
      crawlerKind: CAT_CRAWLER_KIND,
    });
    // She is drawn on essentially every frame of the scene she is built for, so
    // her standing and walking rows are queued now rather than paid for as
    // cache misses on the scene's first frame.
    prewarmCatSprite();
    this.inventory.addItem('magic_missile_tome', 1);
    this.inventory.placeOnHotbar('magic_missile_tome', CatPlayer.TOME_HOTBAR_SLOT);
    // The base player already granted the starting potions; moving that one
    // stack keeps it a single stack, where re-granting it here would not.
    this.inventory.placeOnHotbar('health_potion', CatPlayer.POTION_HOTBAR_SLOT);
  }

  getMissileDamage(): number {
    const stats = getMagicMissileStats(this.getMagicMissileLevel());
    return missileDamage(this.intelligence, stats.damageMultiplier);
  }

  /** Crawlers dodge; the mobs they fight do not. */
  protected override get canDodge(): boolean {
    return true;
  }

  /** Cat-like Reflexes rides on top of the dexterity curve, under the same cap. */
  protected override get dodgeFlatBonus(): number {
    return CAT_REFLEXES_DODGE_BONUS_PER_LEVEL * this.skills.getLevel('cat_reflexes');
  }

  /** Every clean miss is a rep. The skill trains itself out of surviving. */
  protected override onDodged(foreseen = false): void {
    super.onDodged(foreseen);
    this.skills.recordUse('cat_reflexes');
  }

  /**
   * The cat's constitution is fixed by the enhanced pet biscuit, and her dexterity
   * is auto-allocated by Enhanced Growth — neither accepts a spent point. Her
   * banked points go to strength and intelligence.
   */
  override canSpendPointInto(stat: StatName): boolean {
    return !CAT_LOCKED_STATS.includes(stat);
  }

  /**
   * Refund constitution bought before the lock existed.
   *
   * Only runs for pre-lock saves. Potion and tattoo constitution in those saves
   * is refunded too — the snapshot records a single total, so provenance is
   * unrecoverable and erring toward the player is the right call. Running it on
   * a modern save would be a bug, not a kindness: potions and tattoos still
   * raise her base constitution lawfully, and this would confiscate the gain the
   * next time she walked through a door.
   */
  override migrateRestoredStats(snapshotVersion: number): void {
    if (snapshotVersion >= CONSTITUTION_LOCK_SNAPSHOT_VERSION) return;
    const excess = this.getBaseStat('constitution') - CAT_BASE_CONSTITUTION;
    if (excess <= 0) return;
    this.setBaseStat('constitution', CAT_BASE_CONSTITUTION);
    this.unspentPoints += excess;
    this.queueSystemNotice(CONSTITUTION_AUDIT_NOTICE);
  }

  /**
   * Enhanced Growth: the System auto-allocates the cat's dexterity on every
   * level-up, which is the counterweight to her locked constitution.
   */
  protected override onLevelGained(): void {
    super.onLevelGained();
    this.setBaseStat('dexterity', this.getBaseStat('dexterity') + CAT_DEXTERITY_PER_LEVEL);
    this.queueFloatingText(`+${CAT_DEXTERITY_PER_LEVEL} DEX`, 'buff');
    this.animator.play('dance');
  }

  /**
   * A contented moment beside an animal she has just greeted: she turns to it
   * and washes a paw. She has no nuzzle row, and a paw wash is the most
   * pleased-with-herself thing she already does. Refused on the move and over
   * any other animation; turning her is safe because a greeting is only ever
   * offered with no enemy in reach.
   */
  playContentGesture(towardX: number, towardY: number): void {
    if (this.isMoving || this.isKnockedOut || this.animator.current !== null) return;
    const dx = towardX - this.x;
    const dy = towardY - this.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      this.facingX = dx / length;
      this.facingY = dy / length;
    }
    this.animator.play('groom_paw');
  }

  getMeleeDamage(): number {
    return bareClawDamage(this.strength) + this.statusMeleeDamageBonus;
  }

  getMeleeRange(): number {
    return this.tileSize * CatPlayer.MELEE_RANGE_MULTIPLIER;
  }

  /** The furthest a press of the attack key can reach, in pixels: her missile's full flight. */
  attackReachPx(): number {
    const stats = getMagicMissileStats(this.getMagicMissileLevel());
    return Math.max(this.getMeleeRange(), this.missileBaseRangePx() * stats.rangeMultiplier);
  }

  /** A missile's flight before its level's range multiplier. */
  private missileBaseRangePx(): number {
    return (
      (CatPlayer.MISSILE_BASE_RANGE +
        this.intelligence * CatPlayer.MISSILE_RANGE_INTELLIGENCE_MULTIPLIER) *
      this.tileSize
    );
  }

  /**
   * Clears in-flight missiles and cooldowns so a checkpoint restore doesn't
   * resume an attack from the encounter that killed the player. Several of
   * these fields are private, so `DungeonScene` can't clear them directly and
   * needs this entry point.
   */
  resetCombatState(): void {
    this.clearAirborneAttacks();
    this.missileCooldown = 0;
    this.attackTimer = 0;
    this.autoSwipeCooldown = 0;
    this.autoTarget = null;
    this.animator.reset();
  }

  /**
   * Drops the missiles she has in the air, and nothing else.
   *
   * Separate from {@link resetCombatState} because a party walking out of a room
   * has to leave its bolts behind — a missile still homing is steered against
   * whatever grid the next frame hands it, so one that outlives its floor hunts
   * the new floor's mobs from the old floor's coordinates — while a cooldown is
   * something she spent and must not be refunded by a staircase.
   */
  clearAirborneAttacks(): void {
    this.missiles = [];
    this.pendingSubMissileSpawns = [];
    this.pendingSplatterReleases = [];
    this.splatterCopies.reset();
  }

  get missileCooldownCurrent(): number {
    return this.missileCooldown;
  }

  /**
   * How often the companion AI actually gets a missile away — her ability's own
   * cooldown, floored so the computer cannot out-shoot a human hand.
   *
   * Public so the follower can price her two attacks against each other before
   * deciding whether standing in reach of something is worth the health it
   * costs. See {@link autoMeleeTick}.
   */
  get autoFireIntervalFrames(): number {
    return Math.max(this.missileCooldownMax, CatPlayer.AI_MIN_COOLDOWN);
  }

  /** How often the companion AI gets a claw in; the other half of that price. */
  get autoSwipeIntervalFrames(): number {
    return CatPlayer.AUTO_SWIPE_COOLDOWN_FRAMES;
  }

  get missileCooldownMax(): number {
    return getMagicMissileStats(this.getMagicMissileLevel()).cooldownFrames;
  }

  private fireMissile(angleOffset = 0, isSubMissile = false, fromX?: number, fromY?: number) {
    const level = this.getMagicMissileLevel();
    const stats = getMagicMissileStats(level);
    const baseAngle = Math.atan2(this.facingY, this.facingX) + angleOffset;
    const baseRange = this.missileBaseRangePx();
    const maxDist = isSubMissile
      ? this.tileSize * CatPlayer.SUBMISSILE_MAX_DIST_TILES
      : baseRange * stats.rangeMultiplier;

    this.missiles.push({
      x: fromX ?? this.x + this.tileSize * CatPlayer.TILE_CENTER_OFFSET,
      y: fromY ?? this.y + this.tileSize * CatPlayer.TILE_CENTER_OFFSET,
      vx: Math.cos(baseAngle) * stats.speed,
      vy: Math.sin(baseAngle) * stats.speed,
      distTraveled: 0,
      maxDist,
      state: 'flying',
      explodeTimer: this.EXPLODE_FRAMES,
      hit: false,
      abilityLevel: isSubMissile ? 1 : level,
      isSubMissile,
    });

    if (!isSubMissile) {
      this.abilityManager?.addUsageXp('magic_missile');
      prewarmMagicMissileCast(level, stats.hasSubMissiles);
    }
  }

  /**
   * True while the attack key throws a missile rather than swiping.
   *
   * The *bar* rather than the tome, because the bar is what the attack key
   * reads: a player who drags Magic Missile out of it is a player whose Space is
   * a claw, however many tomes are in the pack.
   */
  get isMissileSlotted(): boolean {
    return this.inventory.actionBar.slots.some((slot) => slot?.abilityId === 'magic_missile');
  }

  /**
   * The axe, pickaxe or scythe she is drawn working with while she harvests,
   * or null. With one out, her work swing is the two-paw chop or pick that
   * kind of tool is swung with, and standing between swings she holds it
   * ready in that swing's opening pose.
   */
  private workingTool: WorkingTool | null = null;

  /**
   * Which of the party's own tools, axe or pick, she last worked with: that
   * one rides on her back between uses. A borrowed tool — the scythe, the
   * striker's mallet — goes back to its owner and is never stowed. Only the
   * kind is hers to remember; the tier is whatever she carries now.
   */
  private lastOwnedToolKind: ToolKind | null = null;

  /**
   * The tool on her back: the kind she last used — or, before she has used
   * one since the game loaded, the first she carries — at the tier she
   * carries now.
   */
  private get stowedTool(): WorkingTool | null {
    const kinds = this.lastOwnedToolKind === null ? STOWABLE_TOOL_KINDS : [this.lastOwnedToolKind];
    for (const kind of kinds) {
      const tier = carriedToolTier(this, kind);
      if (tier !== null) return { kind, tier };
    }
    return null;
  }

  setWorkingTool(tool: WorkingTool | null): void {
    // A swing cut short by putting the tool away would finish with her paws
    // closed on nothing.
    const putAway = this.workSwing;
    if (putAway !== null) this.animator.stop(putAway);
    this.workingTool = tool;
    if (tool !== null && isOwnedToolKind(tool.kind)) this.lastOwnedToolKind = tool.kind;
    const swing = this.workSwing;
    if (swing !== null) {
      prewarmCatHold(swing, this.facing.peek(this.facingX, this.facingY), this.isMoving);
    }
  }

  /** The swing her working tool is worked with. */
  private get workSwing(): CatWorkSwing | null {
    const tool = this.workingTool;
    if (tool === null) return null;
    return CAT_WORK_SWING_OF_TOOL[tool.kind];
  }

  /**
   * One swing of work at a tree, a rock or a job — never a blow, so it never
   * reads as an attack to anything that asks `isSwinging`. With a tool out it
   * is her two-paw chop or pick; bare-pawed, her swipe's picture.
   */
  playWorkSwing(): void {
    this.animator.play(this.workSwing ?? 'swipe');
  }

  /**
   * A small thing a scene puts in her jaws to carry, over whatever her mouth
   * slot holds; null hands the jaws back to her gear.
   */
  private scriptedMouthCarry: HeldVisualDef | null = null;
  /** Ticks counted for a carried thing's own pictures — a flicker, a glint. */
  private heldTicks = 0;

  setMouthCarry(look: HeldVisualDef | null): void {
    this.scriptedMouthCarry = look;
    this.prewarmMouthCarry();
  }

  private prewarmMouthCarry(): void {
    if (this.mouthCarry() === null) return;
    prewarmCatHold('carry', this.facing.peek(this.facingX, this.facingY), this.isMoving);
  }

  /**
   * What she carries in her jaws: a scene's scripted thing, else the item in
   * her mouth slot made to be carried, else the quest thing in her pack she
   * carries in her jaws while she has it.
   */
  private mouthCarry(): HeldVisualDef | null {
    if (this.scriptedMouthCarry !== null) return this.scriptedMouthCarry;
    const id = this.inventory.equipment.getEquippedId(MOUTH_HELD_KEY);
    const look = id === undefined ? undefined : weaponStatsOf(id)?.heldVisual;
    if (look !== undefined) {
      const def = HELD_VISUALS[look];
      if (catGripOf(def) === 'mouthCarry') return def;
    }
    const questItem = this.inventory.questItemId;
    const carried = questItem === null ? undefined : ITEM_DEF[questItem].carriedInJaws;
    return carried === undefined ? null : HELD_VISUALS[carried];
  }

  /** The thing last seen in her jaws, so one that arrives by a pack change warms her carrying rows. */
  private carriedLastDraw: HeldVisualDef | null = null;

  /**
   * A quest thing comes into her jaws by landing in her pack, which nothing
   * announces to her, so a change is noticed on the draw that first shows it.
   */
  private noticeCarried(carried: HeldVisualDef | null): void {
    if (carried === this.carriedLastDraw) return;
    this.carriedLastDraw = carried;
    this.prewarmMouthCarry();
  }

  /** What she is drawn holding: her working tool while she works, else what is in her jaws. */
  private heldDraw(): CatHeldDraw | null {
    if (!this.isAlive) return null;
    const tool = this.workingTool;
    const swing = this.workSwing;
    const toolLook = tool === null ? null : workingToolHeldVisual(tool);
    if (toolLook !== null && swing !== null) return { look: toolLook, phase: 0, hold: swing };
    const carried = this.mouthCarry();
    this.noticeCarried(carried);
    if (carried === null) return null;
    return { look: carried, phase: heldPhaseAt(carried, this.heldTicks), hold: 'carry' };
  }

  /**
   * Her stowed tool, drawn on her back unless it is the one in her paws: a
   * borrowed scythe or mallet in her paws leaves her own axe where it rides.
   */
  private stowedDraw(held: CatHeldDraw | null): HeldVisualDef | null {
    const tool = this.stowedTool;
    if (tool === null || !this.isAlive) return null;
    const working = held !== null && held.hold !== 'carry' ? this.workingTool : null;
    const inPaws = working !== null && working.kind === tool.kind;
    return inPaws ? null : workingToolHeldVisual(tool);
  }

  /** Primary Space action: claw swipe (melee). */
  triggerAttack() {
    if (this.attackTimer > 0 || !this.canAct) return;
    this.attackTimer = this.ATTACK_FRAMES;
    this.animator.play('swipe');
  }

  /** Hotbar-triggered magic missile fire. Returns true if a missile was actually launched. */
  triggerMissile(): boolean {
    if (this.missileCooldown > 0 || !this.canAct) return false;
    this.fireMissile();
    this.missileCooldown = this.missileCooldownMax;
    this.animator.play('cast');
    return true;
  }

  /** True when the companion auto-fire launched a missile this frame. Cleared by the consumer. */
  pendingAutoFireSound = false;

  updateAttack() {
    // See `HumanPlayer.updateAttack`: a chilled swing can hold on its peak
    // across a skipped frame, so the peak also asks whether it moved.
    this.swingTimerStepped = this.actionTicksThisFrame > 0;
    this.attackTimer = this.tickActionTimer(this.attackTimer);
    // Counted down every frame, not only on the frames a target happens to be
    // in reach. The cat kites, so she is inside her own claw range for a few
    // frames at a time; a cooldown that only ran during those would take the
    // best part of a minute of real fighting to clear ninety of them.
    this.autoSwipeCooldown = this.tickActionTimer(this.autoSwipeCooldown);
  }

  /** Whether {@link updateAttack} advanced the swing timer this frame. */
  private swingTimerStepped = true;

  /** Every scene ticks this each frame, which is where her pose timers live. */
  override tickTimers(): void {
    super.tickTimers();
    this.heldTicks++;
    this.facing.update(this.facingX, this.facingY);
    this.animator.tick(this.isMoving, this.isKnockedOut);
  }

  override get isSwinging(): boolean {
    return this.attackTimer > 0;
  }

  protected override abandonSwing(): void {
    this.attackTimer = 0;
  }

  /** Returns true on the single frame when the claw hits (peak of the swing). */
  isAttackPeak(): boolean {
    return this.swingTimerStepped && this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  getMissiles(): Missile[] {
    return this.missiles;
  }

  /**
   * Queue a sub-missile spawn from a missile impact point (called by CombatSystem).
   * Flushed by flushPendingSubMissiles() after resolvePlayerAttacks completes.
   */
  queueSubMissileSpawn(x: number, y: number): void {
    this.pendingSubMissileSpawns.push({ x, y });
  }

  /**
   * Queue the Eyes of Splatter's copies of a missile that just landed on an
   * enemy (called by CombatSystem). Released by {@link flushPendingSubMissiles},
   * so the list CombatSystem is walking never grows under it.
   */
  queueSplatterCopies(missile: Missile): void {
    this.pendingSplatterReleases.push({
      x: missile.x,
      y: missile.y,
      abilityLevel: missile.abilityLevel,
      isSubMissile: missile.isSubMissile,
      speed: Math.hypot(missile.vx, missile.vy),
    });
  }

  /** True while any Eyes of Splatter copy is circling her. */
  get hasOrbitingSplatterCopies(): boolean {
    return this.splatterCopies.anyOrbiting(this.missiles);
  }

  /**
   * The Eyes of Splatter cues raised since the last call, cleared as they are
   * read: whether copies were released, and whether circling copies broke off
   * toward an enemy.
   */
  drainSplatterCues(): { released: boolean; peeledOff: boolean } {
    const cues = {
      released: this.splatterCopies.releaseCuePending,
      peeledOff: this.splatterCopies.seekCuePending,
    };
    this.splatterCopies.releaseCuePending = false;
    this.splatterCopies.seekCuePending = false;
    return cues;
  }

  /** Spawns any sub-missiles and splatter copies queued this frame. Call after resolvePlayerAttacks. */
  flushPendingSubMissiles(): void {
    for (const source of this.pendingSplatterReleases) {
      this.splatterCopies.release(this.missiles, source, this.EXPLODE_FRAMES);
    }
    this.pendingSplatterReleases = [];
    for (const { x, y } of this.pendingSubMissileSpawns) {
      const count =
        CatPlayer.SUBMISSILE_COUNT_BASE +
        Math.floor(Math.random() * CatPlayer.SUBMISSILE_COUNT_RANDOM_RANGE);
      for (let i = 0; i < count; i++) {
        const angle =
          (i / count) * Math.PI * 2 + Math.random() * CatPlayer.SUBMISSILE_ANGLE_VARIANCE;
        this.fireMissile(angle - Math.atan2(this.facingY, this.facingX), true, x, y);
      }
    }
    this.pendingSubMissileSpawns = [];
  }

  /**
   * Called every frame when the cat is the follower and has an autoTarget.
   * Faces the target and fires missiles on cooldown.
   * @param missChance 0–1 probability the shot flies slightly off-target (visible miss).
   * @returns whether a missile actually launched this frame.
   */
  autoFireTick(missChance = 0): boolean {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return false;
    }

    const dx =
      this.autoTarget.x +
      this.tileSize * CatPlayer.TILE_CENTER_OFFSET -
      (this.x + this.tileSize * CatPlayer.TILE_CENTER_OFFSET);
    const dy =
      this.autoTarget.y +
      this.tileSize * CatPlayer.TILE_CENTER_OFFSET -
      (this.y + this.tileSize * CatPlayer.TILE_CENTER_OFFSET);
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }

    // AI fires at most as fast as an average human could (~3 shots/sec at 60fps).
    // Cooldown is decremented by updateMissiles each frame — don't decrement here too.
    const cooldownMax = Math.max(this.missileCooldownMax, CatPlayer.AI_MIN_COOLDOWN);
    if (this.missileCooldown !== 0 || !this.canAct) return false;

    // Use the same shared cooldown as player-triggered shots
    const offset =
      Math.random() < missChance
        ? (Math.random() - CatPlayer.RANDOM_OFFSET_BASE) * 2 * CatPlayer.MISS_OFFSET_FACTOR
        : 0;
    this.fireMissile(offset);
    this.missileCooldown = cooldownMax;
    this.animator.play('cast');
    this.pendingAutoFireSound = true;
    return true;
  }

  /**
   * The claw-swipe counterpart of {@link autoFireTick}, for a companion cat with
   * something already inside her reach.
   *
   * Until this existed the companion cat had exactly one attack — the missile —
   * so every point a player put into her strength was dead weight for as long as
   * they were playing the human. Nothing downstream needed teaching: the melee
   * resolver never asked which crawler was active, and the swipe animation and
   * its sound were already wired.
   *
   * Cooldown-gated rather than fired on every eligible frame, at the human
   * companion's cadence, so the AI cat cannot out-swing a player holding Space.
   *
   * Called only on the frames her missile is still cooling — the missile
   * out-damages the claw several times over at every ability level, so a swipe
   * that cost her a cast would be a straight loss. What the claw is for is the
   * dead frames in between, which a companion with one attack spent doing
   * nothing however close the thing chewing on her was.
   *
   * @returns whether a swipe actually started.
   */
  autoMeleeTick(): boolean {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return false;
    }

    const centreOffset = this.tileSize * CatPlayer.TILE_CENTER_OFFSET;
    const dx = this.autoTarget.x + centreOffset - (this.x + centreOffset);
    const dy = this.autoTarget.y + centreOffset - (this.y + centreOffset);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

    if (dist > this.getMeleeRange() || this.autoSwipeCooldown > 0 || !this.canAct) return false;
    this.triggerAttack();
    this.autoSwipeCooldown = CatPlayer.AUTO_SWIPE_COOLDOWN_FRAMES;
    return true;
  }

  updateMissiles(mobGrid?: SpatialGrid<Mob>) {
    const level = this.getMagicMissileLevel();
    const hasHoming = level >= CatPlayer.HOMING_LEVEL_THRESHOLD;
    const HOMING_RANGE_PX = TILE_SIZE * CatPlayer.MISSILE_HOMING_DISTANCE_TILES;
    const CONE_HALF = CatPlayer.HOMING_CONE_HALF_ANGLE;
    const TURN_RATE = CatPlayer.HOMING_TURN_RATE;

    this.missileCooldown = this.tickCooldown(this.missileCooldown);

    for (const m of this.missiles) {
      if (m.state === 'flying' && m.splatter !== undefined) continue;
      if (m.state === 'flying') {
        // Level 14+ homing: curve toward nearest mob in forward cone
        if (hasHoming && !m.isSubMissile && mobGrid) {
          const speed = Math.hypot(m.vx, m.vy);
          if (speed > 0) {
            const dirAngle = Math.atan2(m.vy, m.vx);
            let bestMob: Mob | null = null;
            let bestDistSq = Infinity;

            // Only mobs inside the homing radius can ever win, so ask the grid
            // for those rather than walking every mob on the level per missile.
            // The query measures mob origins while the test below measures mob
            // centres, so widen it by a tile or an edge-of-range mob is missed.
            this._homingQuery.clear();
            const candidates = mobGrid.queryCircle(
              m.x,
              m.y,
              HOMING_RANGE_PX + TILE_SIZE,
              this._homingQuery,
            );
            for (const mob of candidates) {
              // Homing seeks enemies only. A missile that curves out of its line
              // into a bystander is the one way a shot the player aimed
              // correctly can still land on a friend, and it reads as the spell
              // choosing the target for them.
              if (!mob.isAlive || !mob.isHostile) continue;
              const ddx = mob.x + TILE_SIZE * CatPlayer.TILE_CENTER_OFFSET - m.x;
              const ddy = mob.y + TILE_SIZE * CatPlayer.TILE_CENTER_OFFSET - m.y;
              const distSq = ddx * ddx + ddy * ddy;
              if (distSq > HOMING_RANGE_PX * HOMING_RANGE_PX || distSq < 1) continue;
              if (distSq >= bestDistSq) continue;
              const mobAngle = Math.atan2(ddy, ddx);
              let angleDiff = Math.abs(mobAngle - dirAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              if (angleDiff > CONE_HALF) continue;
              bestDistSq = distSq;
              bestMob = mob;
            }

            if (bestMob) {
              steerMissileToward(
                m,
                bestMob.x + TILE_SIZE * CatPlayer.TILE_CENTER_OFFSET,
                bestMob.y + TILE_SIZE * CatPlayer.TILE_CENTER_OFFSET,
                TURN_RATE,
              );
            }
          }
        }

        const nextX = m.x + m.vx;
        const nextY = m.y + m.vy;
        if (this.map) {
          const tx = Math.floor(nextX / this.tileSize);
          const ty = Math.floor(nextY / this.tileSize);
          // The bathroom queue's block flag stands in for the goblins on it,
          // and a missile meets them as bodies rather than as a wall.
          if (!this.map.isWalkableIgnoringBathroomQueue(tx, ty)) {
            m.state = 'exploding';
            continue;
          }
        }
        m.x = nextX;
        m.y = nextY;
        m.distTraveled += Math.hypot(m.vx, m.vy);
        if (m.distTraveled >= m.maxDist) {
          m.state = 'exploding';
        }
      } else {
        m.explodeTimer--;
      }
    }
    const centreOffset = this.tileSize * CatPlayer.TILE_CENTER_OFFSET;
    this.splatterCopies.update(this.missiles, {
      mobGrid,
      ownerX: this.x + centreOffset,
      ownerY: this.y + centreOffset,
      ownerStanding: this.isAlive && !this.isKnockedOut,
      isOpen: this.isOpenForMissiles,
      hasClearPath: this.hasClearMissilePath,
    });
    this.missiles = this.missiles.filter((m) => !(m.state === 'exploding' && m.explodeTimer <= 0));
  }

  /** Whether a missile could fly straight between two world points; clear everywhere without a map. */
  private readonly hasClearMissilePath = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): boolean => this.map === null || this.map.hasWalkableLine(fromX, fromY, toX, toY);

  /** Whether a missile at this world point is over floor it can fly across; open everywhere without a map. */
  private readonly isOpenForMissiles = (worldX: number, worldY: number): boolean => {
    if (this.map === null) return true;
    const tx = Math.floor(worldX / this.tileSize);
    const ty = Math.floor(worldY / this.tileSize);
    return this.map.isWalkableIgnoringBathroomQueue(tx, ty);
  };

  /**
   * Whether her gear has changed since her sprite was last dressed in it. Starts
   * set so a build that is never restored is still dressed on its first draw,
   * rather than in whatever the last crawler drawn had on.
   */
  private wearStale = true;

  /** Dresses her sprite in what she has on, if her gear changed since it was last dressed. */
  private dressInWear(): void {
    if (!this.wearStale) return;
    this.wearStale = false;
    const worn = this.inventory.equippedItems().map((item) => item.id);
    setOutfit('cat', catGarmentsWearing(worn));
  }

  protected override onEquipmentChanged(): void {
    super.onEquipmentChanged();
    this.wearStale = true;
    this.dressInWear();
    this.prewarmMouthCarry();
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    this.dressInWear();
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    if (this.isActive && !this.paintingBodyOnly) {
      const r = CatPlayer.ACTIVE_SPHERE_RADIUS;
      const sphereCX = sx + s * CatPlayer.TILE_CENTER_OFFSET;
      const sphereCY = sy - CatPlayer.ACTIVE_SPHERE_SPRITE_TOP - CatPlayer.ACTIVE_SPHERE_GAP - r;
      drawActivePlayerMarker(ctx, sphereCX, sphereCY, r);
    }

    const held = this.heldDraw();
    const state = this.spriteState(held);
    const missileDepthY = this.y + s * CatPlayer.TILE_CENTER_OFFSET;
    const drawMissileLayer = (layer: MissileDepthLayer): void => {
      if (this.paintingBodyOnly) return;
      drawMissiles(ctx, this.missiles, camX, camY, s, this.EXPLODE_FRAMES, layer, missileDepthY);
    };
    drawMissileLayer('beyond');
    this.drawRetching(ctx, sx, sy, s, () => {
      drawCatSprite(ctx, sx, sy, s, state, catCellFor(state), held, this.stowedDraw(held));
    });
    drawMissileLayer('near');

    this.renderHealthBar(ctx, sx, sy - CatPlayer.HEALTH_BAR_RAISE);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}
