import { Player, type DamageSource, type StatName, type StatusFigureBox } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  handTipInTile,
  type HumanHandSide,
  standingHipAboveSolePx,
} from '../sprites/art/human/probe';
import type { Mob } from './Mob';
import {
  stampPointOf,
  drawHumanSelection,
  prewarmHumanRow,
  prewarmHumanSprite,
  type HumanRowSelection,
  setHumanAppearance,
  viewForFacing,
} from '../sprites/humanSprite';
import { type HumanAppearance } from '../sprites/art/human/appearance';
import { FALL_SPANS, HumanReactionDirector, type HumanWarmSpan } from '../sprites/humanReactions';
import { IDLE_FRAMES_BEFORE_RELEASE } from '../sprites/figure/figureFrameCache';
import {
  type HumanActionOptions,
  HumanAnimator,
  type HumanReactionOptions,
  type HumanStrikeClock,
  type StrikeTargetContext,
} from '../sprites/humanAnimator';
import { SMUSH_DURATION_TICKS, SMUSH_RECOVERY_TICKS } from '../sprites/art/human/timing';
import { type Pt } from '../sprites/art/carlArt';
import {
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  humanRowOf,
  type HumanRowMeta,
  type HumanRowName,
  type ViewRows,
} from '../sprites/art/humanFigure';
import { drawActivePlayerMarker } from '../sprites/activePlayerMarker';
import type { AbilityManager } from '../core/AbilityManager';
import { getSmushStats } from '../abilities/smush';
import type { ItemId } from '../core/ItemDefs';
import type { GameMap } from '../map/GameMap';
import {
  drawSlingshotRocks,
  ROCK_LAUNCH_CONVERGE_TILES,
  SLINGSHOT_BASE_DAMAGE,
  SLINGSHOT_COOLDOWN_FRAMES,
  SLINGSHOT_RANGE_TILES,
  SLINGSHOT_SPEED,
  SLINGSHOT_STRENGTH_FRACTION,
  type SlingshotRock,
} from '../sprites/slingshotSprite';
import {
  carriedForkInTile,
  carriedSlingshotOf,
  drawCarriedSlingshot,
} from '../sprites/slingshotCarrySprite';
import type { CrawlerKind } from '../core/SkillManager';
import {
  bareFistDamage,
  HUMAN_BASE_HP_OFFSET,
  HUMAN_STARTING_DEXTERITY,
  HUMAN_SWING_FRAMES,
} from '../core/crawlerFormulas';
import {
  IRON_PUNCH_DAMAGE_FRACTION_PER_LEVEL,
  PUGILISM_DAMAGE_PER_LEVEL,
} from '../core/SkillManager';

/**
 * How far the top of his hair sits above the tile anchor at the in-game tile
 * size, rounded up to a whole pixel so the health bar hung off it clears the
 * hair. Measured off the painted cells: the standing rows' solid ink tops out
 * 21.5px above the anchor. Gate G21 in `scripts/gates-human.ts` re-measures it.
 */
const HUMAN_SPRITE_TOP_ABOVE_TILE = 22;

/**
 * How far his ground line sits above the bottom edge of his tile. The rig is
 * measured from the ground line, but the waterline is placed from the tile's
 * bottom edge, so the two are this far apart.
 */
const HUMAN_GROUND_ABOVE_TILE_BOTTOM_PX = (1 - GROUND_OFFSET_IN_TILE) * TILE_SIZE;

/**
 * Where a waterline crosses him when he wades: his hips, read off the solved
 * rig of his standing pose at the in-game tile rather than frozen, so a redraw
 * that changes his proportions moves the waterline with it.
 */
const HUMAN_WAIST_ABOVE_FOOT_PX =
  standingHipAboveSolePx(TILE_SIZE) + HUMAN_GROUND_ABOVE_TILE_BOTTOM_PX;

/**
 * Where his soles land, in tile fractions: the ground line sits at 58/64 of
 * the tile and the soles' outline a pixel or so under it. Measured off the
 * standing rows' solid ink (0.984): head-on the toes of a foot pointing at the
 * camera draw a little below the ground line. Gate G21 re-measures it.
 */
const HUMAN_SOLE_BELOW_TILE_TOP = 0.984;

/**
 * Half his width head-on, arms included, in tile fractions. He is narrower
 * than the tile: flames or drips spread across the full tile would visibly
 * miss him. Measured off the standing front and back rows (0.406); gate G21
 * re-measures it.
 */
const HUMAN_HALF_WIDTH_TILES = 0.41;

/**
 * Carl's ink, measured off the painted `HUMAN_FIGURE` cell against its own tile
 * anchor. Exported so `StatusPreviewScene` reviews effects on
 * the same box the game paints them on — a harness using its own numbers can
 * only prove that the harness's numbers work.
 */
export const HUMAN_STATUS_FIGURE_BOX: StatusFigureBox = {
  centerX: 0.5,
  top: -HUMAN_SPRITE_TOP_ABOVE_TILE / TILE_SIZE,
  bottom: HUMAN_SOLE_BELOW_TILE_TOP,
  halfWidth: HUMAN_HALF_WIDTH_TILES,
};

/** The point under the middle of his tile he stands on, in tile fractions. */
const SMUSH_FALLBACK_STAMP_TILE: Pt = { x: 0.5, y: GROUND_OFFSET_IN_TILE };

/** The slingshot shot he draws for each view he can face. */
const SLING_SHOT_ROWS: ViewRows = {
  front: 'sling_shot',
  side: 'sling_shot_side',
  back: 'sling_shot_away',
};

/** Single source for this class's crawler identity — used by the UI and by skill eligibility. */
const HUMAN_CRAWLER_KIND: CrawlerKind = 'human';

/**
 * Rendered frames per fixed update on the fastest display the cache's release
 * window has to be read against: a 240 Hz screen over the 60 Hz update.
 */
const FASTEST_DISPLAY_FRAMES_PER_TICK = 4;
/**
 * How often a row held warm on stand-by is asked for again. The cache
 * releases a row left undrawn for its release window, counted in rendered
 * frames, and a stand-by row is by definition not being drawn; asking for it
 * again is what marks it used. Twice inside the window on the fastest display,
 * so one late refresh never costs the row.
 */
const STANDBY_REWARM_TICKS = Math.floor(
  IDLE_FRAMES_BEFORE_RELEASE / FASTEST_DISPLAY_FRAMES_PER_TICK / 2,
);
/**
 * Under this share of his health the falls are held warm: a blow or two from
 * here can put him down, and the fall is the one reaction nobody can wait on.
 */
const FALL_STANDBY_HEALTH_SHARE = 0.33;

/** What a set of stand-by rows is held warm for. */
type HumanStandbyReason = 'shell_cast' | 'fall';

interface HumanStandby {
  readonly spans: readonly HumanWarmSpan[];
  readonly askedAtTick: number;
}

function sameSpans(a: readonly HumanWarmSpan[], b: readonly HumanWarmSpan[]): boolean {
  return (
    a.length === b.length &&
    a.every((span, index) => span.row === b[index].row && span.frames === b[index].frames)
  );
}

/** Short label the level-up flash shows for Explosives Handling. */
const EXPLOSIVES_HANDLING_CODE = 'EXP';

/** The human alone can invest points in Explosives Handling. */
type HumanSpendableStat = StatName | 'explosivesHandling';

/**
 * This is a playable character.
 * The human has the power "brawl"
 * which is a powerful short range attack
 * it can be a punch of a stomp called "smush"
 */
export class HumanPlayer extends Player {
  /** Which half of the skill roster this crawler is eligible for. */
  readonly crawlerKind = HUMAN_CRAWLER_KIND;

  override get isCrawler(): boolean {
    return true;
  }

  override get isSwinging(): boolean {
    return this.attackTimer > 0;
  }
  /** Increases dynamite damage and throw distance. */
  explosivesHandling = 1;

  private abilityManager: AbilityManager | null = null;

  attackTimer = 0;
  readonly ATTACK_FRAMES = HUMAN_SWING_FRAMES;
  private autoAttackCooldown = 0;
  private readonly AUTO_ATTACK_COOLDOWN = 90;

  smushTimer = 0;
  smushCooldown = 0;
  /** Ticks a Smush holds him, from the key press to back in guard. */
  readonly SMUSH_FRAMES = SMUSH_DURATION_TICKS;
  /**
   * The timer value the stamp lands on: the windup has run and the press and
   * recovery are still to come. Every Smush row is fitted around this tick —
   * its stamp frame is the one the animator shows here — never the other way
   * round; `scripts/gates-human.ts` replays the player to hold them to it.
   */
  private readonly SMUSH_HIT_TIMER = SMUSH_RECOVERY_TICKS;

  /** The mob the human will automatically fight when not player-controlled. */
  autoTarget: Mob | null = null;

  /**
   * The weapon held in hand, or null for bare fists. Only the human wields —
   * the cat's ranged attack is a spell, not a thing she picks up. Written only
   * through {@link wield}, so letting go of a weapon always lowers its pose.
   */
  private heldWeaponId: ItemId | null = null;

  /** Set when a stone actually leaves the sling, so the scene can sound it. */
  pendingSlingshotFireSound = false;

  /** Set when a stone expires against a wall, so the scene can sound that impact too. */
  pendingSlingshotWallImpactSound = false;

  /**
   * Public rather than private like the rest of the slingshot's internals: a
   * scene-transition snapshot has to carry it across, or every doorway grants
   * a free instant shot on arrival.
   */
  slingshotCooldown = 0;
  private rocks: SlingshotRock[] = [];
  /**
   * Whether the slingshot shot is the action he is drawn in. Tracked here
   * rather than read off the animator, so putting the sling away ends only
   * the shot and never an action some other system started.
   */
  private slingDrawn = false;

  /** His spell and his healing sit under the first two number keys. */
  private static readonly TOME_HOTBAR_SLOT = 0;
  private static readonly POTION_HOTBAR_SLOT = 1;
  private static readonly MELEE_RANGE_MULTIPLIER = 1.95;
  private static readonly ACTIVE_SPHERE_RADIUS = 4;
  /** Distance above the sprite so the sphere sits just below the health bar. */
  private static readonly ACTIVE_SPHERE_GAP = 3;
  /** The marker and health bar are stacked from the top of his hair. */
  private static readonly SPRITE_TOP_ABOVE_TILE = HUMAN_SPRITE_TOP_ABOVE_TILE;
  /** Extra lift from the marker sphere's centre up to the health bar's anchor. */
  private static readonly BAR_LIFT_ABOVE_SPHERE = 7;
  /** Offset from tile anchor so sphere sits in the gap between head top and health bar bottom. */
  private static readonly ACTIVE_SPHERE_SPRITE_TOP = HumanPlayer.SPRITE_TOP_ABOVE_TILE;
  private static readonly HEALTH_BAR_Y_OFFSET =
    HumanPlayer.SPRITE_TOP_ABOVE_TILE + HumanPlayer.BAR_LIFT_ABOVE_SPHERE;
  readonly waterlineAboveFootPx = HUMAN_WAIST_ABOVE_FOOT_PX;

  /**
   * Chooses every row he is drawn in. Ticked from `tickTimers`, once per fixed
   * update, so a catch-up frame that runs two updates advances it twice — the
   * same as everything else it is keeping time with.
   */
  readonly animator = new HumanAnimator({ warmRow: prewarmHumanRow });
  /** Chooses his reaction rows — flinch, stumble, struggle, falls — from what is done to him. */
  private readonly reactions = new HumanReactionDirector(this);
  /** Rows held warm ahead of a moment that can come on any tick, by what they wait for. */
  private readonly standbys = new Map<HumanStandbyReason, HumanStandby>();
  /** Fixed updates counted for the stand-by refresh. */
  private standbyTicks = 0;
  /** Where he stood on the previous tick, which is what his gait is paced from. */
  private lastTickX: number;
  private lastTickY: number;
  private static readonly SPRITE_HORIZONTAL_OFFSET = 0.5;
  private static readonly SPRITE_VERTICAL_OFFSET = 0.5;

  /**
   * He stands two thirds of a tile taller than his own tile and is only three
   * fifths of one wide. Status effects are painted over this box, so a burn
   * spread across his tile instead would pile up around his shins and never
   * reach his chest.
   */
  protected override get statusFigureBox(): StatusFigureBox {
    return HUMAN_STATUS_FIGURE_BOX;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, {
      baseHpOffset: HUMAN_BASE_HP_OFFSET,
      baseStats: { dexterity: HUMAN_STARTING_DEXTERITY },
      crawlerKind: HUMAN_CRAWLER_KIND,
    });
    this.lastTickX = this.x;
    this.lastTickY = this.y;
    // He is drawn on essentially every frame of the scene he is built for, so
    // his standing and running rows are queued now rather than paid for as
    // cache misses on the scene's first frame. They are queued in the outfit
    // already being drawn, not re-dressed from this still-empty inventory: a
    // scene change builds him bare and restores his gear a moment later, and
    // dressing him bare in between would release the outfit he is wearing.
    prewarmHumanSprite();
    // Pre-equip Enchanted BigBoi Boxers — adds +2 CON (+4 maxHp)
    this.inventory.addItem('enchanted_bigboi_boxers', 1);
    this.inventory.equipByItemId('enchanted_bigboi_boxers');
    this.syncHpToMaxHp();
    this.inventory.addItem('smush_tome', 1);
    this.inventory.placeOnHotbar('smush_tome', HumanPlayer.TOME_HOTBAR_SLOT);
    // The base player already granted the starting potions; moving that one
    // stack keeps it a single stack, where re-granting it here would not.
    this.inventory.placeOnHotbar('health_potion', HumanPlayer.POTION_HOTBAR_SLOT);
  }

  /**
   * The gear he is seen in, read off what he has equipped. Nothing in the game
   * grants a pedicure, so its shine is always off; this is the one place a
   * grant would have to answer.
   */
  private appearance(): HumanAppearance {
    const { inventory } = this;
    return {
      gauntlet: inventory.hasEquipped('grull_war_gauntlet'),
      cloak: inventory.hasEquipped('nightgaunt_cloak'),
      trollskinShirt: inventory.hasEquipped('trollskin_shirt'),
      toeRing: inventory.hasEquipped('splatter_skunk_toe_ring'),
      pedicure: false,
    };
  }

  /**
   * Dresses his sprite in what he has on. Cheap when nothing changed, so it is
   * also run on every draw: a tutorial reset or a dev preset replaces his
   * equipment without going through {@link onEquipmentChanged}, and he must
   * never be drawn in last session's clothes. A restore calls it directly.
   *
   * On a change every row asked for ahead of need is asked for again: the
   * stand-bys and the animator's warm requests went to the outfit he took off.
   */
  syncAppearance(): void {
    if (!setHumanAppearance(this.appearance())) return;
    this.standbys.clear();
    this.animator.forgetWarmRequests();
  }

  override onEquipmentChanged(): void {
    super.onEquipmentChanged();
    this.syncAppearance();
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  getProtectiveShellLevel(): number {
    return this.abilityManager?.getLevel('protective_shell') ?? 1;
  }

  getSmushLevel(): number {
    return this.abilityManager?.getLevel('smush') ?? 1;
  }

  getSmushCooldownMax(): number {
    return getSmushStats(this.getSmushLevel()).cooldownFrames;
  }

  spendPoint(stat: HumanSpendableStat): void {
    if (stat === 'explosivesHandling') {
      if (!this.consumePointFor(EXPLOSIVES_HANDLING_CODE)) return;
      this.explosivesHandling++;
      return;
    }
    super.spendPoint(stat);
  }

  /** Crawlers dodge; the mobs they fight do not. */
  protected override get canDodge(): boolean {
    return true;
  }

  getMeleeDamage(): number {
    const pugilismBonus = PUGILISM_DAMAGE_PER_LEVEL * this.effectiveSkillLevel('pugilism');
    const meleeOnlyStrength = this.inventory.equipment.getMeleeOnlyStatBonus('strength');
    const flatDamage =
      bareFistDamage(this.strength + meleeOnlyStrength) +
      this.statusMeleeDamageBonus +
      pugilismBonus;
    // Iron Punch is a technique of the gauntlet, not of the hand: without one
    // worn the banked levels are inert, however they were granted.
    const ironPunchMultiplier = this.inventory.hasEquipped('grull_war_gauntlet')
      ? 1 + IRON_PUNCH_DAMAGE_FRACTION_PER_LEVEL * this.effectiveSkillLevel('iron_punch')
      : 1;
    return flatDamage * ironPunchMultiplier;
  }

  /** The weapon held in hand, or null for bare fists. */
  get wieldedWeaponId(): ItemId | null {
    return this.heldWeaponId;
  }

  /** True while the slingshot is in hand, which redirects the attack key. */
  get isWieldingSlingshot(): boolean {
    return this.heldWeaponId === 'slingshot';
  }

  /**
   * Puts `weaponId` in his hand, or empties it with null. Every change of
   * weapon comes through here: a draw held at full stretch belongs to the
   * sling, and anything that set the weapon behind its back would leave him
   * aiming an empty fist.
   */
  wield(weaponId: ItemId | null): void {
    this.heldWeaponId = weaponId;
    // Taking it out warms the shot for the way he faces, so the first release
    // is not baked on the tick the stone leaves.
    if (this.isWieldingSlingshot) prewarmHumanRow(this.slingShotRow());
    else this.lowerSlingshot();
  }

  /**
   * Takes the slingshot out or puts it away, reporting whether it is now held.
   */
  toggleSlingshotWield(): boolean {
    this.wield(this.isWieldingSlingshot ? null : 'slingshot');
    return this.isWieldingSlingshot;
  }

  /** Ends the held draw once the sling is no longer in his hand. */
  private lowerSlingshot(): void {
    if (this.slingDrawn) this.stopAction();
  }

  /**
   * Drops the wielded weapon if whatever changed the inventory carried it off —
   * a drop, an AI `remove_item`, a tutorial reset that clears slots directly.
   * Without this a stripped slingshot keeps firing from an empty hand, because
   * `wieldedWeaponId` only ever names an item and never checks it is still held.
   */
  override onInventoryChanged(): void {
    if (this.heldWeaponId !== null && this.inventory.countOf(this.heldWeaponId) === 0) {
      this.wield(null);
    }
  }

  /** What a single stone does on impact — deliberately below a bare fist's reach-for-reach worth. */
  getSlingshotDamage(): number {
    return SLINGSHOT_BASE_DAMAGE + Math.floor(this.strength * SLINGSHOT_STRENGTH_FRACTION);
  }

  /** Stones still in the air, for the combat resolver to land. */
  getRocks(): SlingshotRock[] {
    return this.rocks;
  }

  /**
   * Flings a stone along the way he is facing, reporting whether one left the
   * sling. No homing and no splash: the slingshot is aim, and nothing else.
   */
  triggerSlingshot(): boolean {
    if (this.slingshotCooldown > 0) return false;

    const angle = Math.atan2(this.facingY, this.facingX);
    const x = this.x + this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET;
    const y = this.y + this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET;
    // On the move the shot is not drawn at all: the stride would take it back
    // on its first tick, which shows one frame of him planted and sliding. He
    // looses from the sling he carries instead and keeps running.
    const shotDrawn = !this.isMoving && this.playSlingShot();
    // The stone flies the gameplay line from his centre; only its picture
    // starts at the fork he is drawn letting go from, and closes onto that
    // line within its first stretch of flight.
    const fork = shotDrawn ? this.handWorldPosition('left') : this.carriedForkWorldPosition();
    this.rocks.push({
      x,
      y,
      launchOffsetX: fork.x - x,
      launchOffsetY: fork.y - y,
      convergeDistance: this.tileSize * ROCK_LAUNCH_CONVERGE_TILES,
      vx: Math.cos(angle) * SLINGSHOT_SPEED,
      vy: Math.sin(angle) * SLINGSHOT_SPEED,
      distTraveled: 0,
      maxDist: this.tileSize * SLINGSHOT_RANGE_TILES,
      state: 'flying',
      hit: false,
    });
    this.slingshotCooldown = SLINGSHOT_COOLDOWN_FRAMES;
    this.pendingSlingshotFireSound = true;
    return true;
  }

  /**
   * Draws the shot: the release on this tick, then the reload and redraw,
   * held at full draw until he moves or fires again. Refused mid-blow or
   * mid-reaction, which costs only the picture — the stone has already gone.
   */
  private playSlingShot(): boolean {
    const playing = this.playAction(this.slingShotRow(), {
      faceX: this.facingX,
      faceY: this.facingY,
      holdLastFrame: true,
      onEnd: () => {
        this.slingDrawn = false;
      },
    });
    // Replacing a shot still drawn ends it first, and its onEnd clears the
    // flag, so the new one is marked only after it has taken over.
    if (playing) this.slingDrawn = true;
    return playing;
  }

  /** The fork of the sling he carries, or his left fist on a cell that holds it some other way. */
  private carriedForkWorldPosition(): Pt {
    const carry = carriedSlingshotOf(this.spriteSelection());
    if (carry === null) return this.handWorldPosition('left');
    const fork = carriedForkInTile(carry);
    return { x: this.x + fork.x * this.tileSize, y: this.y + fork.y * this.tileSize };
  }

  /** The slingshot shot drawn in the view he faces. */
  private slingShotRow(): HumanRowName {
    return SLING_SHOT_ROWS[viewForFacing(this.facingX, this.facingY)];
  }

  /**
   * Lowers a held draw once he has turned away from where it aims — the
   * companion follow and the auto-target turn him without a step, and a draw
   * held along the old facing would aim at nothing — or once the sling is no
   * longer in his hand at all, whatever took it.
   */
  private lowerSlingshotIfStale(): void {
    if (!this.slingDrawn) return;
    if (!this.isWieldingSlingshot) {
      this.stopAction();
      return;
    }
    const drawn = this.spriteSelection();
    const aimed = this.slingShotRow();
    const flipped = this.facingX < 0;
    const mirrored = humanRowOf(aimed)?.mirrorable === true;
    if (drawn.row !== aimed || (mirrored && drawn.flipX !== flipped)) this.stopAction();
  }

  /**
   * Advances every stone in the air and drops the spent ones.
   *
   * Takes the map rather than holding one, so a stone is always tested against
   * the walls of the scene that is currently ticking it.
   */
  updateRocks(map: GameMap): void {
    this.slingshotCooldown = this.tickCooldown(this.slingshotCooldown);

    for (const rock of this.rocks) {
      if (rock.state !== 'flying') continue;
      if (rock.distTraveled === 0) {
        rock.convergeDistance = Math.min(rock.convergeDistance, this.clearFlight(map, rock));
      }

      const nextX = rock.x + rock.vx;
      const nextY = rock.y + rock.vy;
      const tx = Math.floor(nextX / this.tileSize);
      const ty = Math.floor(nextY / this.tileSize);
      if (!map.isWalkable(tx, ty)) {
        rock.state = 'done';
        this.pendingSlingshotWallImpactSound = true;
        continue;
      }
      rock.x = nextX;
      rock.y = nextY;
      rock.distTraveled += Math.hypot(rock.vx, rock.vy);
      if (rock.distTraveled >= rock.maxDist) rock.state = 'done';
    }

    this.rocks = this.rocks.filter((rock) => rock.state === 'flying');
  }

  /**
   * World pixels a stone will fly before its next step lands in a wall,
   * walked along the very steps {@link updateRocks} will take, and looked for
   * only as far as the stone's drawn launch takes to close.
   */
  private clearFlight(map: GameMap, rock: SlingshotRock): number {
    const step = Math.hypot(rock.vx, rock.vy);
    const lookaheadSteps = step > 0 ? Math.ceil(rock.convergeDistance / step) : 0;
    let x = rock.x;
    let y = rock.y;
    for (let taken = 0; taken < lookaheadSteps; taken++) {
      x += rock.vx;
      y += rock.vy;
      const blocked = !map.isWalkable(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
      if (blocked) return taken * step;
    }
    return rock.convergeDistance;
  }

  /**
   * Drops the stones he has in the air, and nothing else — a party walking off
   * a floor leaves them behind, but the cooldown they cost is not refunded by a
   * staircase.
   */
  clearAirborneAttacks(): void {
    this.rocks = [];
  }

  /**
   * Throws a blow along his facing, at `target` when he has one — what he is
   * swinging at decides which blow it is.
   */
  triggerAttack(target: Mob | null = null) {
    if (this.attackTimer > 0 || this.smushTimer > 0) return;
    // A weapon in hand takes the attack key: bare fists are what the punch and
    // the kick animate, and he cannot swing what he is holding a sling with.
    // Checked after the windup guard above so a sling shot respects the same
    // lock a mid-smush melee swing would.
    if (this.isWieldingSlingshot) {
      this.triggerSlingshot();
      return;
    }
    this.animator.beginStrike(
      this.facingX,
      this.facingY,
      target === null ? null : this.strikeContextOf(target),
    );
    this.attackTimer = this.ATTACK_FRAMES;
  }

  /** What about a target decides the blow thrown at it. */
  private strikeContextOf(target: Mob): StrikeTargetContext {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    return {
      lowProfile: target.lowProfile,
      downed: target.hasStatus('stun') || target.hasStatus('stuck'),
      tall: target.isBoss,
      reachShare: Math.hypot(dx, dy) / this.getMeleeRange(),
    };
  }

  triggerSmush(): boolean {
    if (this.smushCooldown > 0 || this.smushTimer > 0 || this.attackTimer > 0) return false;
    this.smushTimer = this.SMUSH_FRAMES;
    this.animator.beginSmush(this.facingX, this.facingY);
    return true;
  }

  /**
   * The direction a blow in flight lands along: the facing it was thrown with,
   * latched when it began, so steering mid-swing cannot turn the hit away
   * from the fist that is drawn throwing it. Between blows, his facing.
   */
  get strikeFacingX(): number {
    return this.animator.latchedFacing?.x ?? this.facingX;
  }

  get strikeFacingY(): number {
    return this.animator.latchedFacing?.y ?? this.facingY;
  }

  private strikeClock(): HumanStrikeClock {
    return {
      attackTimer: this.attackTimer,
      attackFrames: this.ATTACK_FRAMES,
      smushTimer: this.smushTimer,
      smushFrames: this.SMUSH_FRAMES,
    };
  }

  /** The cell he is drawn in this frame — the one `drawSelf` paints. */
  spriteSelection(): HumanRowSelection {
    return this.animator.select(this.strikeClock());
  }

  /**
   * Plays one of his rows as an action — something a system has him do:
   * hammer a board, pull a lever, drink. Priority, highest first: a blow or a
   * Smush, then a reaction, then an action, then standing and moving; a knockout
   * outranks them all but a reaction that overrides blows. So this is refused
   * (false) mid-blow, mid-reaction or out cold, and replaces an action already
   * playing. By default it ends the first tick he moves, and the stride takes
   * over. With `faceX`/`faceY` the row is drawn in the view that way and
   * mirrored to it, but his gameplay facing is left alone: a gesture toward a
   * pickup must not turn the next sling shot or blow away from the fight.
   *
   * Synchronise to it with `onFrame` (a callback on the tick a frame is first
   * drawn — a hammer's sound on its impact frame) and read positions off the
   * drawn cell with {@link handWorldPosition}.
   */
  playAction(row: HumanRowName, options: HumanActionOptions = {}): boolean {
    return this.animator.playAction(row, options);
  }

  /**
   * Plays one of his rows as a reaction — something done to him: a flinch, a
   * knockback, a knockdown. It ends any action. A reaction never cuts off his
   * own blow unless `overridesBlows` is set (a knockdown, a death), which also
   * plays through a knockout.
   */
  playReaction(row: HumanRowName, options: HumanReactionOptions = {}): boolean {
    return this.animator.playReaction(row, options);
  }

  /** Ends the playing action, if any; its `onEnd` hears `stopped`. */
  stopAction(): void {
    this.animator.stopAction();
  }

  /** Ends the playing reaction, if any; its `onEnd` hears `stopped`. */
  stopReaction(): void {
    this.animator.stopReaction();
  }

  /** Whether an action row is playing. */
  get isActing(): boolean {
    return this.animator.isActing;
  }

  /**
   * Holds rows warm, up to the frame count each span names, for as long as
   * `spans` is asked for under `reason` — the frame a moment he can be drawn
   * in on any tick needs is then baked before that tick. An empty list lets
   * them go; the cache releases them once they sit unused through its window.
   * Asked once a tick; the rows are queued only when the set changes and on
   * a slow refresh, so holding costs nothing between.
   */
  standBy(reason: HumanStandbyReason, spans: readonly HumanWarmSpan[]): void {
    if (spans.length === 0) {
      this.standbys.delete(reason);
      return;
    }
    const held = this.standbys.get(reason);
    const due =
      held === undefined ||
      !sameSpans(held.spans, spans) ||
      this.standbyTicks - held.askedAtTick >= STANDBY_REWARM_TICKS;
    if (!due) return;
    for (const span of spans) prewarmHumanRow(span.row, span.frames);
    this.standbys.set(reason, { spans, askedAtTick: this.standbyTicks });
  }

  /** The falls, held warm while he is low enough that the next blows could floor him. */
  private standByForFalls(): void {
    const low = this.isAlive && this.hp < this.maxHp * FALL_STANDBY_HEALTH_SHARE;
    this.standBy('fall', low ? FALL_SPANS : []);
  }

  /**
   * Where the tip of one of his hands is in the world this tick, read off the
   * solved rig of the cell being drawn — mirrored with it and scaled to his
   * tile — so a thing thrown on a release frame leaves the hand that is drawn
   * throwing it.
   */
  handWorldPosition(side: HumanHandSide): Pt {
    const drawn = this.spriteSelection();
    const inTile = handTipInTile(drawn.row, drawn.frame, drawn.flipX, side);
    return { x: this.x + inTile.x * this.tileSize, y: this.y + inTile.y * this.tileSize };
  }

  /**
   * Where the heel of the Smush being drawn meets the floor, in tile
   * fractions from his tile origin — read off the row actually playing, so
   * the blast lands under the foot in every view, standing or on the hop.
   * His tile's own ground point when no stamp is being drawn.
   */
  smushStampTile(): Pt {
    return stampPointOf(this.spriteSelection()) ?? SMUSH_FALLBACK_STAMP_TILE;
  }

  /**
   * Which grind of the Smush being drawn is on screen this tick, counted from
   * 1 on the first frame after the stamp that the heel is ground into the
   * floor; null on every other frame, and when no Smush is drawn. Read off the
   * row actually playing, so the blast's grind lands on the picture's.
   */
  smushGrindBeat(): number | null {
    const drawn = this.spriteSelection();
    const row: HumanRowMeta = HUMAN_ROW_TABLE[drawn.row];
    const grinds = row.eventFrames?.grind ?? [];
    const beat = grinds.indexOf(drawn.frame);
    return beat < 0 ? null : beat + 1;
  }

  /**
   * Paces his legs from the ground he actually covered since the last tick,
   * whichever system moved him — his own input, the companion follow, a
   * scripted walk. Only while he means to be walking: a shove or a knockback
   * with his feet still is not a stride.
   */
  override tickTimers(): void {
    super.tickTimers();
    const covered = Math.hypot(this.x - this.lastTickX, this.y - this.lastTickY);
    this.lastTickX = this.x;
    this.lastTickY = this.y;
    this.lowerSlingshotIfStale();
    this.standbyTicks++;
    this.standByForFalls();
    this.tickReactions(covered);
    this.animator.tick({
      groundPx: this.isMoving ? covered : 0,
      facingX: this.facingX,
      facingY: this.facingY,
      knockedOut: this.isKnockedOut,
      clock: this.strikeClock(),
    });
  }

  /**
   * Advances only an action that is playing, with him standing where he is —
   * for a scene whose world is halted under a conversation he should still be
   * seen talking through. Nothing else of his moves on: the scene has stopped
   * his timers, and an action is the one thing on him that is only a picture.
   */
  tickActionWhileHalted(): void {
    if (!this.animator.isActing) return;
    this.animator.tick({
      groundPx: 0,
      facingX: this.facingX,
      facingY: this.facingY,
      knockedOut: this.isKnockedOut,
      clock: this.strikeClock(),
    });
  }

  /**
   * Advances only the fall he died in, with him lying where he fell — for a
   * scene whose world has stopped under the death screen, which fades in over
   * him while he goes down. Nothing about the defeat itself moves on.
   *
   * Any action still playing is abandoned first, before the fall can
   * interrupt it: an interrupted gesture carries out what it was holding back
   * (a Protective Shell heals him to full, a chest shows its loot), and under
   * the death screen none of that may happen.
   */
  tickReactionWhileDefeated(): void {
    this.animator.abandonActionForDefeat();
    this.tickReactions(0);
    this.animator.tickReactionOnly();
  }

  private tickReactions(coveredPx: number): void {
    this.reactions.tick({
      alive: this.isAlive,
      active: this.isActive,
      knockedOut: this.isKnockedOut,
      stuck: this.hasStatus('stuck'),
      facingX: this.facingX,
      facingY: this.facingY,
      coveredPx,
      knockbackActive: this.knockbackFramesRemaining > 0,
    });
  }

  override takeDamage(amount: number, source?: DamageSource): boolean {
    const landed = super.takeDamage(amount, source);
    // Any wound puts the fidgets off; only a blow from something raises his guard.
    if (landed) this.animator.noteCombat(source?.kind === 'mob');
    // Only a blow flinches him: a burn or poison tick is a steady hurt, and a
    // killing blow is the fall's to draw.
    if (landed && source?.kind === 'mob' && this.isAlive) {
      // `from` is the striker's tile centre, so the side is measured from his.
      const tileCentre = {
        x: this.x + this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET,
        y: this.y + this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET,
      };
      this.reactions.hurt(source.from, tileCentre, this.facingX, this.facingY);
    }
    return landed;
  }

  /** A shove also stumbles him backward, for as far as it carries him. */
  override applyKnockback(dirX: number, dirY: number, distancePx: number, frames: number): void {
    super.applyKnockback(dirX, dirY, distancePx, frames);
    if (this.isAlive && !this.isKnockedOut) this.reactions.knockback(dirX, dirY, distancePx);
  }

  /** A level gained: a fist clench and a look at the ceiling, if he is standing about. */
  protected override onLevelGained(): void {
    super.onLevelGained();
    this.animator.celebrateLevelUp();
  }

  updateAttack() {
    if (this.attackTimer > 0) this.attackTimer--;
    this.smushCooldown = this.tickCooldown(this.smushCooldown);
    if (this.smushTimer > 0) {
      this.smushTimer--;
      if (this.smushTimer === 0) {
        this.smushCooldown = getSmushStats(this.getSmushLevel()).cooldownFrames;
      }
    }
  }

  /** Returns true on the single frame when the melee hit connects (peak of the swing). */
  isAttackPeak(): boolean {
    return this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  /** Returns true on the single frame when the stamp lands and the blast goes off. */
  isSmushPeak(): boolean {
    return this.smushTimer === this.SMUSH_HIT_TIMER;
  }

  getMeleeRange(): number {
    return this.tileSize * HumanPlayer.MELEE_RANGE_MULTIPLIER;
  }

  /**
   * Clears mid-swing/cooldown state so a checkpoint restore doesn't resume an
   * attack frozen mid-animation from the encounter that killed the player.
   * Several of these fields are private, so `DungeonScene` can't clear them
   * directly and needs this entry point.
   */
  resetCombatState(): void {
    this.attackTimer = 0;
    this.smushTimer = 0;
    this.smushCooldown = 0;
    this.autoAttackCooldown = 0;
    this.autoTarget = null;
    this.reactions.reset();
    this.animator.reset();
    this.clearAirborneAttacks();
    this.slingshotCooldown = 0;
    this.pendingSlingshotFireSound = false;
    this.pendingSlingshotWallImpactSound = false;
  }

  /**
   * Called every frame when the human is the follower and has an autoTarget.
   * Faces the target and attacks when in melee range.
   */
  autoFightTick() {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return;
    }

    const dx =
      this.autoTarget.x +
      this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET -
      (this.x + this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET);
    const dy =
      this.autoTarget.y +
      this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET -
      (this.y + this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

    if (dist <= this.getMeleeRange()) {
      if (this.autoAttackCooldown > 0) {
        this.autoAttackCooldown--;
      } else {
        this.triggerAttack(this.autoTarget);
        this.autoAttackCooldown = this.AUTO_ATTACK_COOLDOWN;
      }
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    if (this.isActive) {
      const r = HumanPlayer.ACTIVE_SPHERE_RADIUS;
      const sphereCX = sx + s * HumanPlayer.SPRITE_HORIZONTAL_OFFSET;
      const sphereCY =
        sy - HumanPlayer.ACTIVE_SPHERE_SPRITE_TOP - HumanPlayer.ACTIVE_SPHERE_GAP - r;
      drawActivePlayerMarker(ctx, sphereCX, sphereCY, r);
    }

    this.syncAppearance();
    const selection = this.spriteSelection();
    const carry = this.isWieldingSlingshot && this.isAlive ? carriedSlingshotOf(selection) : null;
    if (carry?.behindFigure === true) drawCarriedSlingshot(ctx, carry, sx, sy, s);
    drawHumanSelection(ctx, sx, sy, s, selection);
    if (carry?.behindFigure === false) drawCarriedSlingshot(ctx, carry, sx, sy, s);

    drawSlingshotRocks(ctx, this.rocks, camX, camY, s);

    this.renderHealthBar(ctx, sx, sy - HumanPlayer.HEALTH_BAR_Y_OFFSET);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}
