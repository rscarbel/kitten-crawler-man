import { Mob, type LootDrop } from './Mob';
import { ClimberFooting } from './climberFooting';
import type { MobilityClass } from '../map/mobility';
import type { Player } from '../Player';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import type { CatAllyId } from '../core/party/partySplit';
import type { CompanionDirective } from '../systems/CompanionSystem';
import type { SpeakerId } from '../dialog/speakers';
import { CAT_SWIPE_FRAMES } from '../core/party/crawlerFormulas';
import {
  CatAnimator,
  CatAppearance,
  CAT_TRAVERSAL_ROWS,
  drawCatSprite,
  prewarmCatTalk,
  type CatSpriteState,
} from '../sprites/catSprite';
import { catEyePlacement, catProfileEyePlacement } from '../sprites/catEyes';
import type { ViewedEyePlacement } from '../sprites/eyePlacement';
import { catRowViewOf } from '../sprites/catViews';
import { FacingState, type FacingSelection, selectFacing } from '../sprites/facingView';
import type { Pt } from '../sprites/art/catArt';
import type { SpeakingCat } from './castCatTalk';
import type { CatLook } from '../sprites/looks/catLook';
import { PUMPKIN_LOOK } from '../sprites/looks/cats/pumpkin';

/** Who each cat ally is: her name, how she is painted and whose voice her lines are in. */
interface CatAllyDef {
  readonly displayName: string;
  readonly description: string;
  readonly look: CatLook;
  readonly speaker: SpeakerId;
}

const CAT_ALLY_DEFS = {
  tower_cattery_cellmate: {
    displayName: 'Pumpkin',
    description: 'A long-haired tortoiseshell. Walks out of everything, eventually.',
    look: PUMPKIN_LOOK,
    speaker: 'pumpkin',
  },
} as const satisfies Record<CatAllyId, CatAllyDef>;

const CAT_ALLY_HP = 60;
/** She keeps pace with a walking crawler, no faster: a cat trotting ahead reads as leading. */
const CAT_ALLY_SPEED = PLAYER_SPEED;
const CLAW_DAMAGE = 4;
const CLAW_REACH_TILES = 0.9;
const CLAW_COOLDOWN_FRAMES = 50;
/** The swipe's blow lands halfway through it, on the frame her paw crosses. */
const CLAW_IMPACT_SHARE = 0.5;
/** How far from the crawler she follows she will go after a hostile. */
const ENGAGE_RADIUS_TILES = 4;
const FOLLOW_START_TILES = 2.5;
const FOLLOW_STOP_TILES = 1.2;
/** How close to an ordered spot she settles, in pixels: on it, so a plate there takes her weight. */
const DIRECTIVE_ARRIVE_PX = 2;
/** Knocked down she lies still this long, then gets up. */
const DOWNED_FRAMES = 300;
/** Getting up, she has this share of her health back. */
const GET_UP_HP_SHARE = 0.5;
/** Damage that would take her below this is refused: she is knocked down instead. */
const DOWNED_AT_HP = 1;

/**
 * A cat who fights beside the party: given to hostiles as a target through
 * the scene's extra targets, walking after the crawler her system names,
 * and swiping with her claws at whatever comes close to them.
 *
 * She cannot be killed. Beaten to her last point she is knocked down, lies
 * there a while untouchable, and gets up with half her health: a cat always
 * comes back.
 */
export class CatAlly extends Mob implements SpeakingCat {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  readonly ally: CatAllyId;
  readonly speaker: SpeakerId;
  readonly appearance: CatAppearance<'companion'>;
  /** The crawler she follows; her system reassigns it every frame. */
  owner: Player;
  /** Every mob in the scene, set each frame by her system so she can pick a fight. */
  allMobs: readonly Mob[] = [];
  /**
   * Set while her system walks her along the party's trail: she neither picks
   * a fight nor walks herself anywhere, and stands where the trail puts her.
   */
  walksTrail = false;
  /**
   * A standing order to go to a spot and stay, the same order the crawler
   * companion takes; null while she follows her crawler. Holding, she does
   * not leave it to fight.
   */
  directive: CompanionDirective | null = null;
  /**
   * Set while she is still shut in a cage: she stands where it holds her and
   * neither follows nor fights.
   */
  caged = false;

  private readonly animator: CatAnimator;
  private readonly facing = new FacingState(this.facingX, this.facingY);
  private readonly eyes: ViewedEyePlacement;
  private readonly profileEyes: ViewedEyePlacement;
  private clawCooldown = 0;
  private swipeFramesLeft = 0;
  private swipeVictim: Mob | null = null;
  private downedFramesLeft = 0;
  /**
   * The view she talks in, turned to whoever she is talking to; null while
   * she is not talking. Her gameplay facing is left alone: it is what her
   * next swipe goes along.
   */
  private talkFacing: FacingSelection | null = null;
  private followingOwner = false;

  constructor(tileX: number, tileY: number, tileSize: number, ally: CatAllyId, owner: Player) {
    super(tileX, tileY, tileSize, CAT_ALLY_HP, CAT_ALLY_SPEED);
    const def = CAT_ALLY_DEFS[ally];
    this.ally = ally;
    this.owner = owner;
    this.speaker = def.speaker;
    this.displayName = def.displayName;
    this.description = def.description;
    this.cannotBeKilled = true;
    this.appearance = new CatAppearance('companion', def.look);
    this.animator = new CatAnimator(this.appearance);
    this.eyes = catEyePlacement(def.look);
    this.profileEyes = catProfileEyePlacement(this.eyes);
    this.appearance.prewarm();
  }

  protected override get eyePlacement(): ViewedEyePlacement {
    return catRowViewOf(this.drawnFacing().view) === 'side' ? this.profileEyes : this.eyes;
  }

  override get isHostile(): boolean {
    return false;
  }

  override get mobility(): MobilityClass {
    return 'climber';
  }

  private readonly footing = new ClimberFooting({
    map: () => this.map,
    play: (move) => this.animator.play(move),
    warm: () => {
      for (const row of CAT_TRAVERSAL_ROWS) this.appearance.prewarmRow(row);
    },
  });

  override get climbing(): ClimberFooting {
    return this.footing;
  }

  /** Ticked wherever the party is: left to the activation radius she would stand frozen behind them. */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  override get yieldsToParty(): boolean {
    return !this.caged;
  }

  /** Shut in her cage, nothing may move her: crawlers and mobs press against the bars instead. */
  override get separationAnchored(): boolean {
    return this.caged || super.separationAnchored;
  }

  override applyKnockback(dirX: number, dirY: number, distancePx: number, frames: number): void {
    if (this.caged) return;
    super.applyKnockback(dirX, dirY, distancePx, frames);
  }

  protected override rollLootItems(): LootDrop['items'] {
    return [];
  }

  /** Lying knocked down, nothing more can be done to her. */
  protected override get isDamageImmune(): boolean {
    return this.isDowned;
  }

  get isDowned(): boolean {
    return this.downedFramesLeft > 0;
  }

  /** Called once something other than her own feet has put her on a new tile. */
  onTeleported(): void {
    this.clearAStarPath();
    this.followingOwner = false;
    this.isMoving = false;
    this.swipeVictim = null;
    this.swipeFramesLeft = 0;
  }

  get isTalking(): boolean {
    return this.talkFacing !== null;
  }

  get canTalk(): boolean {
    return !this.isMoving && !this.isDowned;
  }

  startTalking(toward: Pt): void {
    const dx = toward.x - this.x;
    const dy = toward.y - this.y;
    const facing =
      dx === 0 && dy === 0 ? this.facing.peek(this.facingX, this.facingY) : selectFacing(dx, dy);
    this.talkFacing = facing;
    prewarmCatTalk(this.appearance, facing);
  }

  stopTalking(): void {
    this.talkFacing = null;
  }

  prewarmTalk(): void {
    prewarmCatTalk(this.appearance, this.facing.peek(this.facingX, this.facingY));
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.facing.update(this.facingX, this.facingY);
    this.tickDowned();
    this.animator.tick(this.isMoving, this.isDowned);
    if (this.isDowned || this.caged) {
      this.isMoving = false;
      return;
    }
    if (this.clawCooldown > 0) this.clawCooldown--;
    if (this.walksTrail) {
      this.swipeVictim = null;
      return;
    }
    if (this.advanceSwipe()) return;

    const directive = this.directive;
    const target = directive?.hold === true ? null : this.nearestHostile();
    if (target === null) {
      if (directive === null) this.followOwner();
      else this.followTargetAStar(directive.x, directive.y, this.speed, DIRECTIVE_ARRIVE_PX);
      return;
    }
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    const reach = TILE_SIZE * CLAW_REACH_TILES;
    if (distance > reach) {
      this.followTargetAStar(target.x, target.y, this.speed, reach);
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
    if (this.clawCooldown === 0) this.beginSwipe(target);
  }

  private tickDowned(): void {
    if (this.isDowned) {
      this.downedFramesLeft--;
      if (this.downedFramesLeft === 0) this.hp = Math.ceil(this.maxHp * GET_UP_HP_SHARE);
      return;
    }
    if (this.hp > DOWNED_AT_HP) return;
    this.downedFramesLeft = DOWNED_FRAMES;
    this.swipeVictim = null;
    this.swipeFramesLeft = 0;
    this.animator.reset();
  }

  private beginSwipe(victim: Mob): void {
    this.swipeVictim = victim;
    this.swipeFramesLeft = CAT_SWIPE_FRAMES;
    this.clawCooldown = CLAW_COOLDOWN_FRAMES;
    this.animator.play('swipe');
  }

  /** Plays one frame of a swipe in flight; true while one owns the frame. */
  private advanceSwipe(): boolean {
    const victim = this.swipeVictim;
    if (victim === null) return false;
    this.isMoving = false;
    this.swipeFramesLeft--;
    const impactAt = Math.round(CAT_SWIPE_FRAMES * (1 - CLAW_IMPACT_SHARE));
    if (this.swipeFramesLeft === impactAt) this.landClaw(victim);
    if (this.swipeFramesLeft <= 0) this.swipeVictim = null;
    return true;
  }

  private landClaw(victim: Mob): void {
    if (!victim.isAlive) return;
    const distance = Math.hypot(victim.x - this.x, victim.y - this.y);
    if (distance > TILE_SIZE * CLAW_REACH_TILES) return;
    victim.takeDamageFrom(CLAW_DAMAGE, this, 'melee');
    victim.retaliateMob = this;
  }

  private nearestHostile(): Mob | null {
    const engageRadius = TILE_SIZE * ENGAGE_RADIUS_TILES;
    let nearest: Mob | null = null;
    let nearestDistance = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      const fromOwner = Math.hypot(mob.x - this.owner.x, mob.y - this.owner.y);
      if (fromOwner > engageRadius) continue;
      const distance = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (distance >= nearestDistance) continue;
      nearest = mob;
      nearestDistance = distance;
    }
    return nearest;
  }

  private followOwner(): void {
    const distance = Math.hypot(this.owner.x - this.x, this.owner.y - this.y);
    const stopPx = TILE_SIZE * FOLLOW_STOP_TILES;
    if (distance > TILE_SIZE * FOLLOW_START_TILES) this.followingOwner = true;
    else if (distance <= stopPx) this.followingOwner = false;
    if (!this.followingOwner) {
      this.isMoving = false;
      return;
    }
    this.followTargetAStar(this.owner.x, this.owner.y, this.speed, stopPx);
  }

  private drawnFacing(): FacingSelection {
    return (
      this.footing.crossingFacing ?? this.talkFacing ?? this.facing.peek(this.facingX, this.facingY)
    );
  }

  private spriteState(): CatSpriteState {
    return {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facing: this.drawnFacing(),
      isKnockedOut: this.isDowned,
      oneShot: this.animator.current,
      talking: this.talkFacing !== null,
    };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const state = this.spriteState();
    const cell = this.appearance.cellFor(state);
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawCatSprite(ctx, this.appearance, sx, sy, tileSize, cell, state);
    });
    if (this.isDowned) return;
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
