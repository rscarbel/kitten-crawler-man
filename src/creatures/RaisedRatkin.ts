import type { Player } from '../Player';
import { RisingSkeleton } from './RisingSkeleton';
import type { LootDrop, PlayerDamageType, StructureStrikeTiming } from './Mob';
import { GHOUL_SPEED } from './RuinsGhoul';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { siegeAdvance, siegeCanEngage } from './siege/siegeCapability';
import { UndeadCueQueue } from './siege/undeadCues';
import { SKELETON_RISE_FRAMES } from '../sprites/skeletonTiming';
import {
  CLAW_FRAMES,
  CLAW_IMPACT_FRAME,
  DEATH_FRAMES,
  HURT_FRAMES,
  IDLE_FRAMES,
  RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE,
  RAISED_TICKS_PER_FRAME,
  SHAMBLE_FRAMES,
  raisedRiseFrame,
  type RaisedRatkinAction,
} from '../sprites/art/raisedRatkinFigure';
import { RAISED_RATKIN_LOOKS, type RaisedRatkinLook } from '../sprites/art/raisedRatkinArt';
import type { RatKinView } from '../sprites/art/ratKinArt';
import { drawRaisedRatkinSprite, prewarmRaisedRatkinFight } from '../sprites/raisedRatkinSprite';

/**
 * The weakest body in the assault, by design: the trebuchet's shatter is
 * sized to kill one outright, so a boulder landing in a knot of them clears
 * it. Lower than every other wave creature's HP.
 */
export const RAISED_RATKIN_HP = 8;
/** A shamble: three quarters of a ruins ghoul's walk. */
const RAISED_RATKIN_SPEED_SHARE_OF_GHOUL = 0.75;
export const RAISED_RATKIN_SPEED = GHOUL_SPEED * RAISED_RATKIN_SPEED_SHARE_OF_GHOUL;
const AGGRO_RANGE_TILES = 7;
const ATTACK_RANGE_TILES = 1.1;
/** How close it shambles before it stops to claw, as a share of its reach. */
const FOLLOW_STOP_SHARE = 0.8;
const CLAW_DAMAGE = 3;
/** Frames between claws, counted from the start of one. */
const CLAW_COOLDOWN_FRAMES = 96;
const CLAW_ROW_TICKS = CLAW_FRAMES * RAISED_TICKS_PER_FRAME.claw;
const CLAW_IMPACT_TICKS = CLAW_IMPACT_FRAME * RAISED_TICKS_PER_FRAME.claw;
/** A blow on a wall is the same claw, on the same impact frame. */
const CLAW_ON_STRUCTURE_BASE_DAMAGE = CLAW_DAMAGE;
const HURT_ROW_TICKS = HURT_FRAMES * RAISED_TICKS_PER_FRAME.hurt;
const DEATH_ROW_TICKS = DEATH_FRAMES * RAISED_TICKS_PER_FRAME.death;
/** How long the heap of bones and cloth lies after the collapse, then how long it takes to fade. */
const CORPSE_HOLD_FRAMES = 240;
const CORPSE_FADE_FRAMES = 60;
const XP_VALUE = 4;
const COIN_DROP_MIN = 0;
const COIN_DROP_MAX = 2;
const RAISED_RATKIN_CULL_MARGIN_TILES = 2;
/** Frames between the idle groans of one shambling toward the wall, drawn at random from this span. */
const GROAN_MIN_FRAMES = 360;
const GROAN_MAX_FRAMES = 720;
/** The death's rat voice, pitched down under the bones. */
const DEATH_SQUEAK_PLAYBACK_RATE = 0.7;
const NO_TACTICS: readonly TacticsTrait[] = [];

function pickLook(): RaisedRatkinLook {
  return RAISED_RATKIN_LOOKS[Math.floor(Math.random() * RAISED_RATKIN_LOOKS.length)] ?? 'smock';
}

/** Which of the three painted views a facing is seen from. */
function viewForFacing(facingX: number, facingY: number): RatKinView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY > 0 ? 'front' : 'away';
}

/**
 * One of Briar Hollow's own dead, dragged back up by the necromancer: a
 * ratkin villager in the smock, militia jack or shroud it was buried in.
 *
 * It climbs out of the ground immune, like a raised skeleton, then shambles
 * at whoever is nearest and claws. In the assault it batters the palisade
 * like any siege mob; everywhere else it is an ordinary slow brawler with no
 * tactics — a corpse on somebody else's strings learns nothing.
 */
export class RaisedRatkin extends RisingSkeleton {
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'raised_ratkin';
  override readonly rendersWhenDead = true;
  displayName = 'Raised Ratkin';
  description = 'One of Briar Hollow’s own dead, dragged back up with blue light in its eyes.';

  readonly look: RaisedRatkinLook;
  /** Sounds waiting for the audio pass. */
  readonly cues = new UndeadCueQueue();

  private clawTimer = 0;
  private clawCooldown = 0;
  private hurtTimer = 0;
  private ticksRising = 0;
  private shambleFrame = 0;
  private idleTicks = 0;
  private corpseFrames = 0;
  private groanTimer = GROAN_MIN_FRAMES;
  private isAggro = false;
  private fightWarmed = false;
  private lastX: number;
  private lastY: number;

  private readonly aggroRangePx: number;
  private readonly attackRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number, look: RaisedRatkinLook = pickLook()) {
    super(tileX, tileY, tileSize, RAISED_RATKIN_HP, RAISED_RATKIN_SPEED);
    this.look = look;
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
    this.lastX = this.x;
    this.lastY = this.y;
  }

  override get cullMarginTiles(): number {
    return RAISED_RATKIN_CULL_MARGIN_TILES;
  }

  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return NO_TACTICS;
  }

  protected override get structureStrikeTiming(): StructureStrikeTiming {
    return {
      swingFrames: CLAW_ROW_TICKS,
      impactFrame: CLAW_IMPACT_TICKS,
      cooldownFrames: CLAW_COOLDOWN_FRAMES,
    };
  }

  protected override get structureStrikeBaseDamage(): number {
    return CLAW_ON_STRUCTURE_BASE_DAMAGE;
  }

  protected override get isSwingAnimating(): boolean {
    return this.clawTimer > 0;
  }

  /** A body that exists only to be cut down again drops a few coins and nothing else. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.clawTimer = 0;
    this.clawCooldown = 0;
    this.hurtTimer = 0;
    this.ticksRising = SKELETON_RISE_FRAMES;
    this.corpseFrames = 0;
    this.isAggro = false;
    this.cues.clear();
    this.lastX = this.x;
    this.lastY = this.y;
  }

  override beginRising(): void {
    super.beginRising();
    this.ticksRising = 0;
  }

  override tickTimers(): void {
    const wasRising = this.isRising;
    super.tickTimers();
    if (wasRising) this.ticksRising++;
    if (this.hurtTimer > 0) this.hurtTimer--;
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    if (moved > 0) {
      const cyclePx = this.tileSize * RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE;
      this.shambleFrame = (this.shambleFrame + (moved / cyclePx) * SHAMBLE_FRAMES) % SHAMBLE_FRAMES;
    }
    this.idleTicks++;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const before = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < before && this.hp > 0) this.hurtTimer = HURT_ROW_TICKS;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.tickRise()) return;
    if (this.clawCooldown > 0) this.clawCooldown--;

    if (this.clawTimer > 0) {
      this.clawTimer--;
      this.isMoving = false;
      if (this.clawTimer === CLAW_ROW_TICKS - CLAW_IMPACT_TICKS) this.landClaw();
      return;
    }
    if (this.isStrikingStructure) {
      this.isMoving = false;
      return;
    }

    const target = this.acquireTarget(
      targets,
      this.aggroRangePx,
      (candidate) =>
        siegeCanEngage(this, candidate) &&
        (this.ignoresTownSafeZone || this.map?.isInTownSafeZone(candidate.x, candidate.y) !== true),
    );
    this.currentTarget = target;

    if (target === null) {
      this.isAggro = false;
      this.clearAStarPath();
      this.groanOccasionally();
      if (siegeAdvance(this)) return;
      this.doWander();
      return;
    }

    if (!this.isAggro) {
      this.isAggro = true;
      this.cues.push({ id: 'raised_ratkin_groan' });
    }
    if (!this.fightWarmed) {
      this.fightWarmed = true;
      prewarmRaisedRatkinFight(this.look);
    }
    this.updateLastKnown(target);
    const distance = this.distanceTo(target);
    if (distance > this.attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.attackRangePx * FOLLOW_STOP_SHARE,
      );
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
    if (this.clawCooldown === 0) {
      this.clawTimer = CLAW_ROW_TICKS;
      this.clawCooldown = this.scaledCooldownFrames(CLAW_COOLDOWN_FRAMES);
    }
  }

  /** The claw lands only on a target still in reach: stepping back through the swing dodges it. */
  private landClaw(): void {
    const target = this.currentTarget;
    if (target?.isAlive !== true) return;
    if (this.distanceTo(target) > this.attackRangePx) return;
    this.dealDamage(target, CLAW_DAMAGE);
  }

  private groanOccasionally(): void {
    if (this.groanTimer > 0) {
      this.groanTimer--;
      return;
    }
    this.cues.push({ id: 'raised_ratkin_groan' });
    this.groanTimer =
      GROAN_MIN_FRAMES + Math.floor(Math.random() * (GROAN_MAX_FRAMES - GROAN_MIN_FRAMES));
  }

  override tickCorpse(): void {
    if (this.corpseFrames === 0) {
      this.cues.push({ id: 'raised_ratkin_death' });
      this.cues.push({ id: 'rat_squeak_2', playbackRate: DEATH_SQUEAK_PLAYBACK_RATE });
    }
    this.corpseFrames++;
  }

  override get corpseExpired(): boolean {
    return (
      !this.isAlive &&
      this.corpseFrames >= DEATH_ROW_TICKS + CORPSE_HOLD_FRAMES + CORPSE_FADE_FRAMES
    );
  }

  /** The row and frame being drawn, for the sprite and for a gate that samples what is on screen. */
  get currentRow(): { action: RaisedRatkinAction; frame: number } {
    if (!this.isAlive) {
      return {
        action: 'death',
        frame: Math.min(
          DEATH_FRAMES - 1,
          Math.floor(this.corpseFrames / RAISED_TICKS_PER_FRAME.death),
        ),
      };
    }
    if (this.isRising) return { action: 'rise', frame: raisedRiseFrame(this.ticksRising) };
    const strike = this.structureStrikeProgress;
    if (this.clawTimer > 0 || strike !== null) {
      const progress = this.clawTimer > 0 ? 1 - this.clawTimer / CLAW_ROW_TICKS : (strike ?? 0);
      return {
        action: 'claw',
        frame: Math.min(CLAW_FRAMES - 1, Math.floor(progress * CLAW_FRAMES)),
      };
    }
    if (this.hurtTimer > 0) {
      const progress = 1 - this.hurtTimer / HURT_ROW_TICKS;
      return {
        action: 'hurt',
        frame: Math.min(HURT_FRAMES - 1, Math.floor(progress * HURT_FRAMES)),
      };
    }
    if (this.isMoving) return { action: 'shamble', frame: Math.floor(this.shambleFrame) };
    return {
      action: 'idle',
      frame: Math.floor(this.idleTicks / RAISED_TICKS_PER_FRAME.idle) % IDLE_FRAMES,
    };
  }

  private get corpseAlpha(): number {
    const fadeStart = DEATH_ROW_TICKS + CORPSE_HOLD_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / CORPSE_FADE_FRAMES);
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const row = this.currentRow;
    const rising = this.isAlive && this.isRising;
    if (this.isAggro && this.isAlive && !rising) this.renderAggroIndicator(ctx, sx, sy, tileSize);
    drawRaisedRatkinSprite(
      ctx,
      this.look,
      row.action,
      viewForFacing(this.facingX, this.facingY),
      row.frame,
      sx,
      sy,
      tileSize,
      this.facingX < 0,
      this.isAlive ? 1 : this.corpseAlpha,
    );
    // Nothing to damage while it is still in the ground, and nothing left once it has fallen.
    if (this.isAlive && !rising) this.renderMobHealthBar(ctx, sx, sy);
  }
}
