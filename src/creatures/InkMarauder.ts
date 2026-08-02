import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import {
  drawInkMarauderSprite,
  INK_EMERGE_FRAMES,
  INK_MARAUDER_HALF_WIDTH,
  INK_MARAUDER_HEAD_CLEARANCE,
  INK_STRIKE_LAND_FRACTION,
  INK_SWIM_EASE_FRAMES,
  type InkMarauderForm,
} from '../sprites/inkMarauderSprite';

const MARAUDER_HP = 5;
const MARAUDER_SPEED = 1.8;
const AGGRO_RANGE_TILES = 9;
/** Reach of each form's strike, measured to match how far its art extends. */
const STRIKE_RANGE_TILES: Record<InkMarauderForm, number> = {
  ogre: 1.7,
  shark: 1.3,
};
/**
 * Chip damage by design, the same as Signet's own fireball: the summons are
 * showmanship, and the player still earns every kill.
 */
const STRIKE_DAMAGE = 1;
/** Frames between strikes (~0.83 s at 60 fps). */
const ATTACK_COOLDOWN = 50;
/** Length of the sword chop / shark lunge animation. */
const ATTACK_ANIM_FRAMES = 20;
/**
 * The swing is sampled across this many steps so its final rendered frame lands
 * on progress 1 — the recovery has to arrive back at guard, or the blade snaps
 * there the frame the timer expires.
 */
const STRIKE_ANIM_STEPS = ATTACK_ANIM_FRAMES - 1;
/** How long the marauder persists before bleeding away (~8 s at 60 fps). */
export const MARAUDER_LIFESPAN_FRAMES = 480;
/** Lifespan remaining below which the marauder visibly fades out. */
const FADE_START_FRAMES = 90;
const FOLLOW_STOP_FRACTION = 0.8;
/** Share of summons that come up as the ogre rather than the hammerhead. */
const FORM_SPLIT = 0.5;

const FORM_NAMES: Record<InkMarauderForm, string> = {
  ogre: 'Ink Ogre',
  shark: 'Ink Hammerhead',
};

const FORM_DESCRIPTIONS: Record<InkMarauderForm, string> = {
  ogre: "A three-headed brute inked across Signet's back, stepped off her skin with its scimitar.",
  shark: "A hammerhead from Signet's shoulder, swimming through open air.",
};

function randomForm(): InkMarauderForm {
  return Math.random() < FORM_SPLIT ? 'ogre' : 'shark';
}

/**
 * An Ink Marauder — one of Tsarina Signet's tattoos torn from her skin and
 * given a body. It fights alongside the crawlers as a towering blue outline,
 * then bleeds back into ink when its lifespan ends.
 */
export class InkMarauder extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  readonly form: InkMarauderForm;
  displayName: string;
  description: string;

  /** All mobs in the scene — set each frame by the owning quest system. */
  allMobs: Mob[] = [];

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  /** The mob the in-flight swing is aimed at — damage lands mid-animation. */
  private strikeTarget: Mob | null = null;
  private lifespanRemaining: number;
  private age = 0;
  private swimBlend = 0;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    lifespanFrames = MARAUDER_LIFESPAN_FRAMES,
    form: InkMarauderForm = randomForm(),
  ) {
    super(tileX, tileY, tileSize, MARAUDER_HP, MARAUDER_SPEED);
    this.lifespanRemaining = lifespanFrames;
    this.form = form;
    this.displayName = FORM_NAMES[form];
    this.description = FORM_DESCRIPTIONS[form];
  }

  /** Ink Marauders are allies — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  override get cullMarginTiles(): number {
    return Math.max(INK_MARAUDER_HALF_WIDTH, INK_MARAUDER_HEAD_CLEARANCE);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    this.age++;
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.advanceStrike();
    this.advanceSwimBlend();

    this.lifespanRemaining--;
    if (this.lifespanRemaining <= 0) {
      // Dissipate without granting XP/loot — bypass takeDamageFrom's kill-credit path.
      this.hp = 0;
      this.justDied = true;
      return;
    }

    // Still a coalescing swirl, with no body yet to swing anything.
    if (this.age < INK_EMERGE_FRAMES) {
      this.isMoving = false;
      return;
    }

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const strikeRangePx = this.tileSize * STRIKE_RANGE_TILES[this.form];

    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      const d = this.distanceTo(mob);
      if (d < aggroRangePx && d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }

    if (!nearest) {
      this.isMoving = false;
      return;
    }

    this.updateLastKnown(nearest);
    const canReach = nearestDist <= strikeRangePx && this.hasLOS(nearest);
    if (!canReach) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        strikeRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
      this.faceTowardMob(nearest);
    }

    // No swing it cannot finish: a marauder that dissipates mid-chop would land
    // its hit from a body that is no longer there.
    const outlivesTheSwing = this.lifespanRemaining > ATTACK_ANIM_FRAMES;
    if (canReach && this.attackCooldown === 0 && outlivesTheSwing) {
      this.strikeTarget = nearest;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
      this.attackCooldown = ATTACK_COOLDOWN;
    }
  }

  /**
   * 0 on the swing's first rendered frame, exactly 1 on its last. The timer is
   * rendered from `ATTACK_ANIM_FRAMES` down to 1 — it is set before any decrement
   * and the `=== 0` case is idle — so the numerator counts down from the full
   * frame count while the span is one step shorter.
   */
  private strikeProgress(): number {
    if (this.attackAnimTimer === 0) return 0;
    return (ATTACK_ANIM_FRAMES - this.attackAnimTimer) / STRIKE_ANIM_STEPS;
  }

  /** Snapped to a side rather than normalised: this sprite is a mirror, not a rig. */
  private faceTowardMob(target: Mob): void {
    const dx = target.x - this.x;
    if (dx !== 0) this.facingX = Math.sign(dx);
  }

  /** Eases the shark's gait cue so starting and stopping doesn't snap its tail. */
  private advanceSwimBlend(): void {
    const step = 1 / INK_SWIM_EASE_FRAMES;
    const target = this.isMoving ? 1 : 0;
    if (this.swimBlend < target) this.swimBlend = Math.min(target, this.swimBlend + step);
    else if (this.swimBlend > target) this.swimBlend = Math.max(target, this.swimBlend - step);
  }

  /**
   * Runs the swing forward a frame and lands its damage at the moment the blade
   * or the jaws reach the target, rather than the frame the swing began.
   */
  private advanceStrike(): void {
    if (this.attackAnimTimer === 0) return;
    this.attackAnimTimer--;

    const framesRemainingAtImpact = Math.round(
      ATTACK_ANIM_FRAMES - STRIKE_ANIM_STEPS * INK_STRIKE_LAND_FRACTION,
    );
    if (this.attackAnimTimer !== framesRemainingAtImpact) return;

    const target = this.strikeTarget;
    this.strikeTarget = null;
    if (!target?.isAlive) return;
    const strikeRangePx = this.tileSize * STRIKE_RANGE_TILES[this.form];
    const stillInReach = this.distanceTo(target) <= strikeRangePx && this.hasLOS(target);
    if (stillInReach) target.takeDamageFrom(STRIKE_DAMAGE, null, 'melee');
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

    const lifeFraction =
      this.lifespanRemaining < FADE_START_FRAMES ? this.lifespanRemaining / FADE_START_FRAMES : 1;

    drawInkMarauderSprite(ctx, sx, sy, tileSize, {
      form: this.form,
      age: this.age,
      lifeFraction,
      attackProgress: this.strikeProgress(),
      facingX: this.facingX,
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      swimBlend: this.swimBlend,
    });
  }
}
