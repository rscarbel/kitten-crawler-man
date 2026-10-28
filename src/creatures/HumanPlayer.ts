import {
  Player,
  type DamageOptions,
  type DamageSource,
  type FigureMouth,
  type StatusFigureBox,
} from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  handTipInTile,
  type HumanHandSide,
  standingHipAboveSolePx,
  strikeContactInTile,
} from '../sprites/art/human/probe';
import type { Mob } from './Mob';
import {
  stampPointOf,
  activeHumanSocketSource,
  type BipedHeldDraw,
  type BipedOffHandDraw,
  type BipedStowedDraw,
  drawHumanSelection,
  explosiveHeldDraw,
  handsShareHaft,
  heldHeadInTile,
  prewarmHumanRow,
  prewarmHumanSprite,
  activeHumanLook,
  type HumanRowSelection,
  setHumanHeld,
  setHumanOffHand,
  humanRowView,
  type HumanRowView,
  viewRow,
} from '../sprites/humanSprite';
import { type FacingSelection, FacingState } from '../sprites/facingView';
import { humanMouthOf } from '../sprites/crawlerMouths';
import { humanGarmentsWearing } from '../sprites/garments/itemLooks';
import { setOutfit } from '../sprites/outfits';
import { FALL_SPANS, HumanReactionDirector, type HumanWarmSpan } from '../sprites/humanReactions';
import { IDLE_FRAMES_BEFORE_RELEASE } from '../sprites/figure/figureFrameCache';
import {
  type HumanActionOptions,
  HumanAnimator,
  type HumanReactionOptions,
  type HumanStrikeClock,
  type StrikeTargetContext,
} from '../sprites/humanAnimator';
import {
  SEISMIC_STOMP_DURATION_TICKS,
  SEISMIC_STOMP_RECOVERY_TICKS,
} from '../sprites/art/human/timing';
import { type Pt } from '../sprites/art/bipedArt';
import {
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  humanRowOf,
  type HumanRowMeta,
  type HumanRowName,
  type ViewRows,
} from '../sprites/art/humanFigure';
import { drawActivePlayerMarker } from '../sprites/activePlayerMarker';
import type { AbilityManager } from '../core/skills/AbilityManager';
import { getSeismicStompStats } from '../abilities/seismicStomp';
import {
  humanLookOf,
  ITEM_DEF,
  MAIN_HAND_KEY,
  OFF_HAND_KEY,
  subSlotsOf,
  weaponStatsOf,
  type ItemId,
} from '../core/items/defs/ItemDefs';
import type { EquipmentChange } from '../core/items/equipment/EquipmentManager';
import { gearModifiers } from '../gear/gearHooks';
import {
  heldVisualIdOf,
  HUMAN_ARM_REACH_TILES,
  type HandWeaponStats,
  type MeleeWeaponStats,
  SLING_COOLDOWN_FRAMES,
  SLING_STONE_SPEED,
} from '../core/items/equipment/weapons';
import type { GameMap } from '../map/GameMap';
import {
  drawSlingshotRocks,
  ROCK_LAUNCH_CONVERGE_TILES,
  type SlingshotRock,
} from '../sprites/slingshotSprite';
import {
  HELD_VISUALS,
  stowedPlacementOfHeld,
  workingToolHeldVisual,
} from '../sprites/held/heldVisuals';
import { heldPhaseAt } from '../sprites/held/heldComposite';
import { carriedGripOf } from '../sprites/art/human/carry';
import type {
  HeldVisualDef,
  OffHandHeldVisualDef,
  WeaponHeldVisualDef,
} from '../sprites/held/heldVisualDef';
import { offHandGripOf } from '../sprites/art/human/offHand';
import type { ShownPlacement } from '../sprites/art/human/stowedGeometry';
import type { ThrownPropVisualId } from '../sprites/held/heldVisualIds';
import { HumanExplosiveHands } from './humanExplosiveHands';
import { motionSetOf } from '../sprites/art/human/motionSets';
import { humanSocketsAt } from '../sprites/art/human/sockets';
import type { WorkingTool } from '../core/items/gathering/toolTiers';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { HumanLook } from '../sprites/looks/humanLook';
import {
  pauseOverheadMeasure,
  reportOverheadTop,
  resumeOverheadMeasure,
} from '../ui/world/overheadStack';
import {
  bareFistDamage,
  HUMAN_BASE_HP_OFFSET,
  HUMAN_SWING_FRAMES,
  slingDamage,
  slingRangeTiles,
} from '../core/party/crawlerFormulas';
import { PUGILISM_DAMAGE_PER_LEVEL } from '../core/skills/SkillManager';
import { UNTAGGED_HIT, weaponHitTags, type DamageTags } from '../core/combat/damageTags';

/**
 * How far his ground line sits above the bottom edge of his tile. The rig is
 * measured from the ground line, but the waterline is placed from the tile's
 * bottom edge, so the two are this far apart.
 */
const HUMAN_GROUND_ABOVE_TILE_BOTTOM_PX = (1 - GROUND_OFFSET_IN_TILE) * TILE_SIZE;

/**
 * Where a waterline crosses `look` when he wades: his hips, read off the
 * solved rig of his standing pose at the in-game tile rather than frozen, so a
 * redraw that changes his proportions moves the waterline with it.
 */
function waistAboveFootPx(look: HumanLook): number {
  const known = waistAboveFootByLook.get(look);
  if (known !== undefined) return known;
  const waist = standingHipAboveSolePx(TILE_SIZE, look) + HUMAN_GROUND_ABOVE_TILE_BOTTOM_PX;
  waistAboveFootByLook.set(look, waist);
  return waist;
}

/** Solved once per look: the waterline is read every frame he wades. */
const waistAboveFootByLook = new WeakMap<HumanLook, number>();

/**
 * Where his soles land, in tile fractions: the ground line sits at 58/64 of
 * the tile and the soles' outline a pixel or so under it. Measured off the
 * standing rows' solid ink (0.984): head-on the toes of a foot pointing at the
 * camera draw a little below the ground line. Gate G21 re-measures it.
 */
const HUMAN_SOLE_BELOW_TILE_TOP = 0.984;

/**
 * The ink of `look`'s figure against its own tile anchor, as the status
 * effects hang off it. Exported so `StatusPreviewScene` reviews effects on the
 * same box the game paints them on — a harness using its own numbers can only
 * prove that the harness's numbers work.
 */
export function humanStatusFigureBoxOf(look: HumanLook): StatusFigureBox {
  const extent = look.figureExtent;
  return {
    centerX: 0.5,
    top: -extent.spriteTopAboveTilePx / TILE_SIZE,
    bottom: HUMAN_SOLE_BELOW_TILE_TOP,
    halfWidth: extent.halfWidthTiles,
  };
}

/** The point under the middle of his tile he stands on, in tile fractions. */
const SEISMIC_STOMP_FALLBACK_STAMP_TILE: Pt = { x: 0.5, y: GROUND_OFFSET_IN_TILE };

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
type HumanStandbyReason = 'shield_cast' | 'fall';

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

/**
 * The human crawler: a short-range brawler whose blows are a punch or the
 * Seismic Stomp.
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
  private abilityManager: AbilityManager | null = null;

  attackTimer = 0;
  readonly ATTACK_FRAMES = HUMAN_SWING_FRAMES;
  private autoAttackCooldown = 0;
  private readonly AUTO_ATTACK_COOLDOWN = 90;

  seismicStompTimer = 0;
  seismicStompCooldown = 0;
  /** Ticks a Seismic Stomp holds him, from the key press to back in guard. */
  readonly SEISMIC_STOMP_FRAMES = SEISMIC_STOMP_DURATION_TICKS;
  /**
   * The timer value the stamp lands on: the windup has run and the press and
   * recovery are still to come. Every Seismic Stomp row is fitted around this tick —
   * its stamp frame is the one the animator shows here — never the other way
   * round; `scripts/gates-human.ts` replays the player to hold them to it.
   */
  private readonly SEISMIC_STOMP_HIT_TIMER = SEISMIC_STOMP_RECOVERY_TICKS;

  /** The mob the human will automatically fight when not player-controlled. */
  autoTarget: Mob | null = null;

  /**
   * Set while a restore or a harness puts a weapon in his hand or takes it out
   * with no gesture; every other equip or unequip of his main hand plays one.
   */
  private holsterGestureMuted = false;
  /**
   * The weapon being put away while its stow plays: still in his fist on the
   * frames the stow holds it, though no longer drawn.
   */
  private stowing: WeaponHeldVisualDef | null = null;
  /** The look of the explosive his throwing fist closes on in the dynamite rows. */
  private explosiveLook: HeldVisualDef = HELD_VISUALS.prop_dynamite;

  /** Whether his gear has changed since his sprite was last dressed in it. */
  private outfitStale = true;
  /** Off while the constructor puts on his starting gear; see {@link onEquipmentChanged}. */
  private dressesOnChange = false;

  /** Set when a stone actually leaves the sling, so the scene can sound it. */
  pendingSlingshotFireSound = false;

  /** Where a stone just expired against a wall, so the scene can sound that impact too. */
  pendingSlingshotWallImpact: { readonly x: number; readonly y: number } | null = null;

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
  private static readonly ACTIVE_SPHERE_RADIUS = 4;
  /** Distance above the sprite so the sphere sits just below the health bar. */
  private static readonly ACTIVE_SPHERE_GAP = 3;
  /** Extra lift from the marker sphere's centre up to the health bar's anchor. */
  private static readonly BAR_LIFT_ABOVE_SPHERE = 7;
  override get waterlineAboveFootPx(): number {
    return waistAboveFootPx(activeHumanLook());
  }

  /** The view his facing is drawn in, held through the selector's hysteresis. */
  readonly facing = new FacingState(this.facingX, this.facingY);
  /**
   * Chooses every row he is drawn in. Ticked from `tickTimers`, once per fixed
   * update, so a catch-up frame that runs two updates advances it twice — the
   * same as everything else it is keeping time with.
   */
  readonly animator = new HumanAnimator({ warmRow: prewarmHumanRow, facing: this.facing });
  /** Chooses his reaction rows — flinch, stumble, struggle, falls — from what is done to him. */
  private readonly reactions = new HumanReactionDirector(this);
  /** How he lights, holds and throws an explosive. */
  readonly explosives = new HumanExplosiveHands(this);
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
    return humanStatusFigureBoxOf(activeHumanLook());
  }

  /**
   * The marker sphere and health bar are stacked from the top of his hair,
   * which sits where the look he is drawn as puts it.
   */
  private get spriteTopAboveTile(): number {
    return activeHumanLook().figureExtent.spriteTopAboveTilePx;
  }

  protected override get statusMouth(): FigureMouth | null {
    return humanMouthOf(this.spriteSelection());
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, {
      baseHpOffset: HUMAN_BASE_HP_OFFSET,
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
    this.inventory.addItem('seismic_stomp_tome', 1);
    this.inventory.placeOnHotbar('seismic_stomp_tome', HumanPlayer.TOME_HOTBAR_SLOT);
    // The base player already granted the starting potions; moving that one
    // stack keeps it a single stack, where re-granting it here would not.
    this.inventory.placeOnHotbar('health_potion', HumanPlayer.POTION_HOTBAR_SLOT);
    this.dressesOnChange = true;
    this.inventory.equipment.onChange((change) => this.gestureMainHand(change));
  }

  /** Dresses his sprite in the garments of what he has equipped; returns whether the look changed. */
  private wearEquipped(): boolean {
    const worn = this.inventory.equippedItems().map((item) => item.id);
    return setOutfit('human', humanGarmentsWearing(worn));
  }

  /**
   * Dresses his sprite in what he has on, if his gear changed since it was
   * last dressed, and closes his main hand on the weapon out in it. On a
   * change every row asked for ahead of need is asked for again: the
   * stand-bys and the animator's warm requests went to the figure he was
   * drawn as before.
   */
  private dressInGear(): void {
    const outfitChanged = this.outfitStale && this.wearEquipped();
    this.outfitStale = false;
    const look = this.inHandLook();
    const mainHandChanged = setHumanHeld(look === null ? null : carriedGripOf(look));
    const shield = this.shieldInHand();
    const offHandChanged = setHumanOffHand(shield === null ? null : offHandGripOf(shield));
    const drawn = this.drawnLook();
    this.animator.setMotionSet(drawn === null ? 'unarmed' : motionSetOf(drawn));
    if (!outfitChanged && !mainHandChanged && !offHandChanged) return;
    this.standbys.clear();
    this.animator.forgetWarmRequests();
  }

  /** The shield equipped on his off hand, or null when it is free. */
  private shieldLook(): OffHandHeldVisualDef | null {
    const id = this.inventory.equipment.getEquippedId(OFF_HAND_KEY);
    if (id === undefined) return null;
    const look = humanLookOf(ITEM_DEF[id]);
    return look?.kind === 'offHand' ? HELD_VISUALS[look.heldVisual] : null;
  }

  /**
   * The shield his off hand closes on: none while a weapon that wants both
   * hands is in them, coming out or going away, when the shield rides stowed.
   */
  private shieldInHand(): OffHandHeldVisualDef | null {
    const weapon = this.inHandLook();
    if (weapon !== null && motionSetOf(weapon) === 'twoHand') return null;
    return this.shieldLook();
  }

  override get shieldAtTheReady(): boolean {
    return this.isAlive && !this.isSwinging && this.shieldInHand() !== null;
  }

  /**
   * Where his shield rests when his off hand is wanted elsewhere: its own
   * place, unless the weapon he carries already rests there, and then the
   * other.
   */
  private shieldRestingPlace(shield: OffHandHeldVisualDef): ShownPlacement | null {
    const own = stowedPlacementOfHeld(shield);
    if (own === 'none') return null;
    const weapon = this.inHandLook() ?? this.carriedLook();
    const taken = weapon === null ? 'none' : stowedPlacementOfHeld(weapon);
    if (taken !== own) return own;
    return own === 'back' ? 'hip' : 'back';
  }

  /** The shield on his off hand on this draw, in hand or stowed as the cell's row has it. */
  private offHandDraw(): BipedOffHandDraw | null {
    if (!this.isAlive) return null;
    const shield = this.shieldLook();
    if (shield === null) return null;
    const stowedAt = this.shieldRestingPlace(shield);
    return stowedAt === null ? null : { look: shield, stowedAt };
  }

  /** A shot glanced off his shield: he takes it behind the shield, if nothing more pressing is playing. */
  raiseOffHandBlock(): void {
    if (this.isAlive && !this.isKnockedOut) this.reactions.block(this.facingX, this.facingY);
  }

  /** The look of the weapon out in his hand, or null for bare fists. */
  private drawnLook(): WeaponHeldVisualDef | null {
    const id = this.mainHandWeaponId;
    return id === null ? null : this.weaponLook(id);
  }

  /** The look of what his fist may close on: the drawn weapon, or the one being put away. */
  private inHandLook(): WeaponHeldVisualDef | null {
    return this.drawnLook() ?? this.stowing;
  }

  /**
   * The look of the weapon he carries stowed: the first one on his hotbar that
   * is not in his hand. A weapon in the bag alone is not shown.
   */
  private carriedLook(): WeaponHeldVisualDef | null {
    const drawn = this.mainHandWeaponId;
    for (const slot of this.inventory.actionBar.slots) {
      if (slot === null || slot.id === drawn) continue;
      const look = this.weaponLook(slot.id);
      if (look !== null) return look;
    }
    return null;
  }

  /**
   * The look weapon `id` is drawn with in his hands: its awakened look once it
   * has woken. Read on every draw, so a weapon that wakes mid-fight changes in
   * his fist on the next frame.
   */
  private weaponLook(id: ItemId): WeaponHeldVisualDef | null {
    const weapon = weaponStatsOf(id);
    if (weapon === null) return null;
    return HELD_VISUALS[heldVisualIdOf(weapon, this.gear.isAwakened(id))];
  }

  /**
   * The weapon drawn where it rests, on the cell being drawn: the one coming
   * out or going away on any frame his main hand is not closed on it —
   * reaching for it on a draw, letting go of it on a stow — and otherwise the
   * one he carries stowed on his hotbar, if any.
   */
  private stowedDraw(selection: HumanRowSelection): BipedStowedDraw | null {
    const moving = this.inHandLook();
    if (moving !== null) {
      const frames = humanSocketsAt(activeHumanSocketSource(), selection.row, selection.frame);
      if (frames.sockets.mainHand.grips !== true) return restingDraw(moving);
    }
    const carried = this.carriedLook();
    return carried === null ? null : restingDraw(carried);
  }

  /**
   * What is drawn in his hands on the cell being drawn: the explosive he is
   * lighting, holding or throwing, else the working tool on a swing where both
   * fists close on its haft, else the weapon out in his hand, else nothing.
   */
  private heldDraw(selection: HumanRowSelection): BipedHeldDraw | null {
    if (!this.isAlive) return null;
    const explosive = explosiveHeldDraw(this.explosiveLook, selection);
    if (explosive !== null) return explosive;
    const tool = this.workingTool;
    const toolLook = tool === null ? null : workingToolHeldVisual(tool);
    if (toolLook !== null && handsShareHaft(selection)) return { look: toolLook, phase: 0 };
    const look = this.inHandLook();
    if (look === null) return null;
    return { look, phase: heldPhaseAt(look, this.standbyTicks) };
  }

  /** Puts `look` in his throwing fist for the dynamite rows that light, hold and throw it. */
  takeExplosiveInHand(look: ThrownPropVisualId): void {
    this.explosiveLook = HELD_VISUALS[look];
  }

  /**
   * Re-dresses him and settles what is in his hand on every equipment change.
   *
   * Not dressed while he is being built: a scene builds him in his starting
   * gear and restores what he was wearing a moment later, and dressing him in
   * between would release the outfit he is about to be drawn in. A build that
   * is never restored is dressed on its first draw.
   */
  protected override onEquipmentChanged(): void {
    super.onEquipmentChanged();
    this.outfitStale = true;
    if (this.dressesOnChange) this.dressInGear();
    this.settleHeldWeapon();
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  getEnergyShieldLevel(): number {
    return this.abilityManager?.getLevel('energy_shield') ?? 1;
  }

  getSeismicStompLevel(): number {
    return this.abilityManager?.getLevel('seismic_stomp') ?? 1;
  }

  getSeismicStompCooldownMax(): number {
    return getSeismicStompStats(this.getSeismicStompLevel()).cooldownFrames;
  }

  /** Crawlers dodge; the mobs they fight do not. */
  protected override get canDodge(): boolean {
    return true;
  }

  getMeleeDamage(): number {
    const pugilismBonus = PUGILISM_DAMAGE_PER_LEVEL * this.effectiveSkillLevel('pugilism');
    const meleeOnlyBonus = this.inventory.equipment.getMeleeOnlyStatBonus('melee');
    return (
      bareFistDamage(this.melee + meleeOnlyBonus) + this.statusMeleeDamageBonus + pugilismBonus
    );
  }

  /**
   * What a blow from a weapon in his hand is worth before the weapon's own
   * multiplier: the unarmed formula without what only a fist earns — Pugilism
   * and the gauntlet's fist-mode melee — since neither is in a weapon.
   */
  getBladeDamage(): number {
    return bareFistDamage(this.melee) + this.statusMeleeDamageBonus;
  }

  /**
   * What kind of blow his melee strike is: the drawn weapon's family, or for a
   * punch, whatever kind of weapon his worn gear makes his fists.
   */
  meleeHitTags(): DamageTags {
    const weapon = this.drawnMeleeWeapon;
    if (weapon !== null) return weaponHitTags(weapon);
    const fistFamily = gearModifiers(this).fistFamily;
    return fistFamily === null ? UNTAGGED_HIT : [fistFamily];
  }

  /** What the blow in his hand is worth: the weapon's while one is drawn to swing, his fists' otherwise. */
  getStrikeDamage(): number {
    return this.drawnMeleeWeapon !== null ? this.getBladeDamage() : this.getMeleeDamage();
  }

  /**
   * The axe or pick in his fists while he works a resource node, drawn
   * between the swing rows' two layers — a cell is shared by every tier, so
   * the tier he holds cannot be painted into it. Null when he is not working
   * one.
   */
  private workingTool: WorkingTool | null = null;

  setWorkingTool(tool: WorkingTool | null): void {
    this.workingTool = tool;
  }

  /** The weapon equipped in his main hand, which is the weapon in his hand; null when it is empty. */
  get mainHandWeaponId(): ItemId | null {
    return this.inventory.equipment.getEquippedId(MAIN_HAND_KEY) ?? null;
  }

  /** How the drawn weapon fights, or null for bare fists. */
  get drawnWeapon(): HandWeaponStats | null {
    const id = this.mainHandWeaponId;
    return id === null ? null : weaponStatsOf(id);
  }

  /** The drawn weapon when it is swung, or null when he punches or holds a sling. */
  get drawnMeleeWeapon(): MeleeWeaponStats | null {
    const weapon = this.drawnWeapon;
    return weapon?.delivery === 'melee' ? weapon : null;
  }

  /** True while a sling is drawn, which redirects the attack key. */
  get hasSlingDrawn(): boolean {
    return this.drawnWeapon?.delivery === 'sling';
  }

  /**
   * Takes `weaponId` out by equipping it in his main hand, displacing whatever
   * was there. Reports whether it is now drawn: false when he has none, or
   * cannot hold it.
   */
  drawWeapon(weaponId: ItemId): boolean {
    if (this.mainHandWeaponId !== weaponId) this.inventory.equipment.equipById(weaponId);
    return this.mainHandWeaponId === weaponId;
  }

  /**
   * Puts the drawn weapon away by taking it out of his main hand: it rides
   * stowed while it sits on his hotbar, and is not shown otherwise.
   */
  stowWeapon(): void {
    if (this.mainHandWeaponId === null) return;
    this.inventory.equipment.unequip(MAIN_HAND_KEY);
  }

  /**
   * Draws `weaponId`, or stows it when it is the one already drawn — a hotbar
   * press of a weapon. Reports whether it is now drawn.
   */
  toggleWeaponDrawn(weaponId: ItemId): boolean {
    if (this.mainHandWeaponId !== weaponId) return this.drawWeapon(weaponId);
    this.stowWeapon();
    return this.mainHandWeaponId === weaponId;
  }

  /**
   * Puts `weaponId` in his hand, or empties it for null, with no gesture: for
   * a harness that poses him armed, never for play.
   */
  holdWithoutGesture(weaponId: ItemId | null): void {
    this.holsterGestureMuted = true;
    try {
      if (weaponId === null) this.inventory.equipment.unequip(MAIN_HAND_KEY);
      else this.inventory.equipment.equipById(weaponId);
    } finally {
      this.holsterGestureMuted = false;
    }
  }

  /**
   * Plays the draw of whatever came into his main hand and the stow of
   * whatever left it, whichever path changed it — the hotbar, the doll, the
   * bag's menu, the AI. A restore replaces the whole set silently.
   */
  private gestureMainHand(change: EquipmentChange): void {
    if (change.reason === 'restore' || change.key !== MAIN_HAND_KEY) return;
    if (this.holsterGestureMuted) {
      this.stowing = null;
      return;
    }
    const drawn = this.drawnLook();
    if (drawn !== null) {
      this.stowing = null;
      this.animator.beginHolster('draw', motionSetOf(drawn), this.facingX, this.facingY);
      return;
    }
    const removed = change.removedItemId === null ? null : this.weaponLook(change.removedItemId);
    if (removed === null) return;
    this.stowing = removed;
    const row = this.animator.beginHolster(
      'stow',
      motionSetOf(removed),
      this.facingX,
      this.facingY,
      () => {
        this.stowing = null;
      },
    );
    if (row === null) this.stowing = null;
    // Settled again now the stow holds it: the equipment change settled his
    // hand empty before the stow had begun.
    this.settleHeldWeapon();
  }

  /**
   * Keeps his outfit and the sling's pose true to what is in his hand: a drawn
   * sling has its shot warmed for the
   * way he faces, so the first release is not baked on the tick the stone
   * leaves; and a sling no longer drawn lowers any draw held at full stretch,
   * or he would be left aiming an empty fist.
   */
  private settleHeldWeapon(): void {
    if (this.dressesOnChange) this.dressInGear();
    if (this.hasSlingDrawn) prewarmHumanRow(this.slingShotRow());
    else this.lowerSlingshot();
  }

  /** Ends the held draw once the sling is no longer in his hand. */
  private lowerSlingshot(): void {
    if (this.slingDrawn) this.stopAction();
  }

  /**
   * Empties a hand whose weapon whatever changed the inventory carried off — a
   * drop, an AI `remove_item`, a tutorial reset that clears slots directly.
   * Without this a stripped slingshot keeps firing from an empty hand, because
   * the equipped map only ever names an item and never checks it is still held.
   */
  override onInventoryChanged(): void {
    for (const subSlot of subSlotsOf('human', 'Weapon')) {
      const key = `Weapon:${subSlot}`;
      const heldId = this.inventory.equipment.getEquippedId(key);
      if (heldId !== undefined && this.inventory.countOf(heldId) === 0) {
        this.inventory.equipment.unequip(key);
      }
    }
  }

  /** What a single stone does on impact. */
  getSlingshotDamage(): number {
    return slingDamage(this.ranged);
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
    if (this.slingshotCooldown > 0 || !this.canAct) return false;

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
      vx: Math.cos(angle) * SLING_STONE_SPEED,
      vy: Math.sin(angle) * SLING_STONE_SPEED,
      distTraveled: 0,
      maxDist: this.tileSize * slingRangeTiles(this.ranged),
      state: 'flying',
      hit: false,
      bounces: 0,
      bouncedOff: null,
      tags: weaponHitTags(this.drawnWeapon),
    });
    this.slingshotCooldown = SLING_COOLDOWN_FRAMES;
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
    const look = this.drawnLook();
    const fork = look === null ? null : heldHeadInTile(look, this.spriteSelection());
    if (fork === null) return this.handWorldPosition('left');
    return { x: this.x + fork.x * this.tileSize, y: this.y + fork.y * this.tileSize };
  }

  /** The slingshot shot drawn in the view he faces. */
  private slingShotRow(): HumanRowName {
    return this.rowFacing(SLING_SHOT_ROWS);
  }

  /**
   * The row a view-keyed table names for a facing — his own unless one is
   * given — judged from the view he is drawn in now, so a row chosen for the
   * way he already faces is always in the view the rest of him is drawn in.
   */
  rowFacing(rows: ViewRows, faceX = this.facingX, faceY = this.facingY): HumanRowName {
    return viewRow(rows, this.facing.peek(faceX, faceY).view);
  }

  /** The view and mirroring his own facing is drawn in, as of this moment's facing. */
  get facingSelection(): FacingSelection {
    return this.facing.peek(this.facingX, this.facingY);
  }

  /** The view whose rows he is drawn in for a facing, his own unless one is given. */
  rowViewFacing(faceX = this.facingX, faceY = this.facingY): HumanRowView {
    return humanRowView(this.facing.peek(faceX, faceY).view);
  }

  /**
   * Lowers a held draw once he has turned away from where it aims — the
   * companion follow and the auto-target turn him without a step, and a draw
   * held along the old facing would aim at nothing — or once the sling is no
   * longer in his hand at all, whatever took it.
   */
  private lowerSlingshotIfStale(): void {
    if (!this.slingDrawn) return;
    if (!this.hasSlingDrawn) {
      this.stopAction();
      return;
    }
    const drawn = this.spriteSelection();
    const aimed = this.slingShotRow();
    const flipped = this.facingSelection.flipX;
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
      // The bathroom queue's block flag stands in for the goblins on it, and a
      // stone meets them as bodies rather than as a wall.
      if (!map.isWalkableIgnoringBathroomQueue(tx, ty)) {
        rock.state = 'done';
        this.pendingSlingshotWallImpact = { x: rock.x, y: rock.y };
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
      const blocked = !map.isWalkableIgnoringBathroomQueue(
        Math.floor(x / this.tileSize),
        Math.floor(y / this.tileSize),
      );
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
    if (this.attackTimer > 0 || this.seismicStompTimer > 0 || !this.canAct) return;
    // A weapon in hand takes the attack key: bare fists are what the punch and
    // the kick animate, and he cannot swing what he is holding a sling with.
    // Checked after the windup guard above so a sling shot respects the same
    // lock a mid-stomp melee swing would.
    if (this.hasSlingDrawn) {
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

  triggerSeismicStomp(): boolean {
    if (this.seismicStompCooldown > 0 || this.seismicStompTimer > 0 || this.attackTimer > 0)
      return false;
    if (!this.canAct) return false;
    this.seismicStompTimer = this.SEISMIC_STOMP_FRAMES;
    this.animator.beginSeismicStomp(this.facingX, this.facingY);
    return true;
  }

  /**
   * Whether a `triggerSeismicStomp` refusal right now is *because of* the cooldown,
   * as opposed to being mid-swing or unable to act — the two refusals a
   * refusal cue should stay silent for, since they are not the player
   * mistiming a press against a timer they can watch.
   */
  get seismicStompRefusedByCooldown(): boolean {
    return (
      this.seismicStompCooldown > 0 &&
      this.seismicStompTimer <= 0 &&
      this.attackTimer <= 0 &&
      this.canAct
    );
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
      seismicStompTimer: this.seismicStompTimer,
      seismicStompFrames: this.SEISMIC_STOMP_FRAMES,
    };
  }

  /** The cell he is drawn in this frame — the one `drawSelf` paints. */
  spriteSelection(): HumanRowSelection {
    return this.animator.select(this.strikeClock());
  }

  /**
   * Plays one of his rows as an action — something a system has him do:
   * hammer a board, pull a lever, drink. Priority, highest first: a blow or a
   * Seismic Stomp, then a reaction, then an action, then standing and moving; a knockout
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
    const inTile = handTipInTile(drawn.row, drawn.frame, drawn.flipX, side, activeHumanLook());
    return { x: this.x + inTile.x * this.tileSize, y: this.y + inTile.y * this.tileSize };
  }

  /**
   * Where the limb landing his current blow meets the world this tick — a
   * fist's knuckles on a punch, a boot's toe on a kick — read off the strike's
   * own `reachLimb` and the solved rig of the cell being drawn. Null off any
   * row that is not a strike, so a whiff or a non-combat action spawns nothing.
   */
  strikeContactWorldPosition(): Pt | null {
    const drawn = this.spriteSelection();
    const row: HumanRowMeta = HUMAN_ROW_TABLE[drawn.row];
    if (row.role !== 'strike' || row.strike === undefined) return null;
    const inTile = strikeContactInTile(
      drawn.row,
      drawn.frame,
      drawn.flipX,
      row.strike.reachLimb,
      activeHumanLook(),
    );
    return { x: this.x + inTile.x * this.tileSize, y: this.y + inTile.y * this.tileSize };
  }

  /**
   * Where the heel of the Seismic Stomp being drawn meets the floor, in tile
   * fractions from his tile origin — read off the row actually playing, so
   * the blast lands under the foot in every view, standing or on the hop.
   * His tile's own ground point when no stamp is being drawn.
   */
  seismicStompStampTile(): Pt {
    return stampPointOf(this.spriteSelection()) ?? SEISMIC_STOMP_FALLBACK_STAMP_TILE;
  }

  /**
   * Which grind of the Seismic Stomp being drawn is on screen this tick, counted from
   * 1 on the first frame after the stamp that the heel is ground into the
   * floor; null on every other frame, and when no Seismic Stomp is drawn. Read off the
   * row actually playing, so the blast's grind lands on the picture's.
   */
  seismicStompGrindBeat(): number | null {
    const drawn = this.spriteSelection();
    const row: HumanRowMeta = HUMAN_ROW_TABLE[drawn.row];
    const grinds = row.eventFrames?.grind ?? [];
    const beat = grinds.indexOf(drawn.frame);
    return beat < 0 ? null : beat + 1;
  }

  /** Also settles the stride's own last position, so the step is not paced as ground walked. */
  override placeAt(x: number, y: number): void {
    super.placeAt(x, y);
    this.lastTickX = x;
    this.lastTickY = y;
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
   * (an Energy Shield heals him to full, a chest shows its loot), and under
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

  override takeDamage(amount: number, source?: DamageSource, options?: DamageOptions): boolean {
    const landed = super.takeDamage(amount, source, options);
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
    // A chilled swing skips frames rather than counting in fractions, so a
    // peak check alone would hold true across a skipped frame and land the
    // blow twice. The peaks also ask whether the timer moved this frame.
    this.swingTimersStepped = this.actionTicksThisFrame > 0;
    this.attackTimer = this.tickActionTimer(this.attackTimer);
    this.seismicStompCooldown = this.tickCooldown(this.seismicStompCooldown);
    if (this.seismicStompTimer > 0) {
      this.seismicStompTimer = this.tickActionTimer(this.seismicStompTimer);
      if (this.seismicStompTimer === 0) {
        this.seismicStompCooldown = getSeismicStompStats(
          this.getSeismicStompLevel(),
        ).cooldownFrames;
      }
    }
  }

  /** Whether {@link updateAttack} advanced the swing timers this frame. */
  private swingTimersStepped = true;

  protected override abandonSwing(): void {
    this.attackTimer = 0;
    this.seismicStompTimer = 0;
  }

  /** Returns true on the single frame when the melee hit connects (peak of the swing). */
  isAttackPeak(): boolean {
    return this.swingTimersStepped && this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  /** Returns true on the single frame when the stamp lands and the blast goes off. */
  isSeismicStompPeak(): boolean {
    return this.swingTimersStepped && this.seismicStompTimer === this.SEISMIC_STOMP_HIT_TIMER;
  }

  getMeleeRange(): number {
    return this.tileSize * (this.drawnMeleeWeapon?.reachTiles ?? HUMAN_ARM_REACH_TILES);
  }

  /**
   * The furthest a press of the attack key can reach, in pixels: a slingshot
   * stone's full flight, whether or not one is wielded right now, since a
   * press can swap to it as easily as it can swing.
   */
  attackReachPx(): number {
    return Math.max(this.getMeleeRange(), this.tileSize * slingRangeTiles(this.ranged));
  }

  /**
   * Clears mid-swing/cooldown state so a checkpoint restore doesn't resume an
   * attack frozen mid-animation from the encounter that killed the player.
   * Several of these fields are private, so `DungeonScene` can't clear them
   * directly and needs this entry point.
   */
  resetCombatState(): void {
    this.attackTimer = 0;
    this.seismicStompTimer = 0;
    this.seismicStompCooldown = 0;
    this.autoAttackCooldown = 0;
    this.autoTarget = null;
    this.reactions.reset();
    this.animator.reset();
    this.clearAirborneAttacks();
    this.slingshotCooldown = 0;
    this.pendingSlingshotFireSound = false;
    this.pendingSlingshotWallImpact = null;
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
        this.autoAttackCooldown = this.tickActionTimer(this.autoAttackCooldown);
      } else if (this.canAct) {
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

    if (this.isActive && !this.paintingBodyOnly) {
      const r = HumanPlayer.ACTIVE_SPHERE_RADIUS;
      const sphereCX = sx + s * HumanPlayer.SPRITE_HORIZONTAL_OFFSET;
      const sphereCY = sy - this.spriteTopAboveTile - HumanPlayer.ACTIVE_SPHERE_GAP - r;
      reportOverheadTop(ctx, sphereCX, sphereCY - r);
      drawActivePlayerMarker(ctx, sphereCX, sphereCY, r);
    }

    this.dressInGear();
    const selection = this.spriteSelection();
    const held = this.heldDraw(selection);
    const stowed = this.stowedDraw(selection);
    const offHand = this.offHandDraw();
    this.drawRetching(ctx, sx, sy, s, () =>
      drawHumanSelection(ctx, sx, sy, s, selection, held, stowed, offHand),
    );

    if (!this.paintingBodyOnly) {
      pauseOverheadMeasure();
      try {
        drawSlingshotRocks(ctx, this.rocks, camX, camY, s);
      } finally {
        resumeOverheadMeasure();
      }
    }

    const healthBarAboveAnchor = this.spriteTopAboveTile + HumanPlayer.BAR_LIFT_ABOVE_SPHERE;
    this.renderHealthBar(ctx, sx, sy - healthBarAboveAnchor);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}

/** `look` drawn where it rests, or null for a look that rests nowhere. */
function restingDraw(look: WeaponHeldVisualDef): BipedStowedDraw | null {
  const placement = stowedPlacementOfHeld(look);
  return placement === 'none' ? null : { look, placement };
}
