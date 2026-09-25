import type { Player } from '../Player';
import { Mob, type LootDrop } from './Mob';
import { PLAYER_SPEED } from '../core/constants';
import type { TacticsTrait } from './tactics/tacticsTraits';
import type { StructureRef } from '../systems/briarHollow/DefenseStructures';
import {
  isStandingStructure,
  nearestStructurePoint,
  siegeCanEngage,
  tileUnder,
} from './siege/siegeCapability';
import { UndeadCueQueue } from './siege/undeadCues';
import {
  GRAVE_BULL_CHARGE_FRAMES,
  GRAVE_BULL_DEATH_FRAMES,
  GRAVE_BULL_IDLE_FRAMES,
  GRAVE_BULL_IMPACT_FRAMES,
  GRAVE_BULL_PAW_FRAMES,
  GRAVE_BULL_TICKS_PER_FRAME,
  GRAVE_BULL_TILES_PER_CHARGE_CYCLE,
  GRAVE_BULL_TILES_PER_WALK_CYCLE,
  GRAVE_BULL_WALK_FRAMES,
  type GraveBullAction,
} from '../sprites/art/graveBullFigure';
import type { CowView } from '../sprites/art/cowArt';
import {
  GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES,
  GRAVE_BULL_BODY_PART_KEY,
  drawGraveBullSprite,
  prewarmGraveBullAttack,
  prewarmGraveBullDeath,
} from '../sprites/graveBullSprite';

/**
 * Tough enough that a trebuchet's shatter alone leaves it standing, and no
 * tougher than a direct hit and a shatter together can finish.
 * `verify:necromancer` holds both at every level.
 */
export const GRAVE_BULL_HP = 45;
const GRAVE_BULL_WALK_SPEED = 0.9;
/**
 * The charge, as a share of the player's walk. Faster than a crawler can run,
 * so it is dodged by stepping aside during the paw rather than outrun — the
 * heading is locked when the paw begins and never turns.
 */
const CHARGE_SPEED_SHARE_OF_PLAYER = 1.8;
export const GRAVE_BULL_CHARGE_SPEED = PLAYER_SPEED * CHARGE_SPEED_SHARE_OF_PLAYER;
/** How far a charge runs before it gives up, having struck nothing. */
export const GRAVE_BULL_CHARGE_MAX_TILES = 8;
/** How close a structure on its path, or a defender, must be before it paws to charge. */
export const GRAVE_BULL_CHARGE_TRIGGER_TILES = 6;
/** The paw is the charge's telegraph: its whole painted row, at its own rate. */
export const GRAVE_BULL_PAW_TELEGRAPH_FRAMES =
  GRAVE_BULL_PAW_FRAMES * GRAVE_BULL_TICKS_PER_FRAME.paw;
const IMPACT_ROW_TICKS = GRAVE_BULL_IMPACT_FRAMES * GRAVE_BULL_TICKS_PER_FRAME.impact;
/** After a charge that struck a structure: the recoil, then the wait before it may paw again. */
export const GRAVE_BULL_WALL_RECOVERY_FRAMES = 120;
/** After a charge that ran out, was held by a snare, or struck a body. */
const GRAVE_BULL_RECOVERY_FRAMES = 90;
/** The level-1 weight of the charge: what it does to a body, and what a wall takes six times over. */
export const GRAVE_BULL_CHARGE_DAMAGE = 8;
/** A charge that meets a structure lands at this multiple of its weight. */
export const GRAVE_BULL_STRUCTURE_MULTIPLIER = 6;
/** The most of a victim's bar one charge may take, whatever the level and difficulty. */
const GRAVE_BULL_BLOW_CAP_SHARE = 0.4;
/** How far a charge flings a body it meets, in tiles, and over how many frames. */
const CHARGE_KNOCKBACK_TILES = 1.6;
const CHARGE_KNOCKBACK_FRAMES = 16;
/** How near a body's centre must pass the bull's for the charge to strike it, in tiles. */
const CHARGE_HIT_RADIUS_TILES = 0.85;
/** A step that covers less than this share of what it asked for has met something. */
const CHARGE_STALL_SHARE = 0.5;
const AGGRO_RANGE_TILES = 9;
/** Walk stop distance toward a defender it cannot yet charge. */
const APPROACH_STOP_TILES = 1.2;
/** Updates the figure cache may fall behind by on a slow frame; a prewarm lead is counted in cache frames. */
const UPDATES_PER_CACHE_FRAME = 2;
const DEATH_ROW_TICKS = GRAVE_BULL_DEATH_FRAMES * GRAVE_BULL_TICKS_PER_FRAME.death;
const CORPSE_HOLD_FRAMES = 300;
const CORPSE_FADE_FRAMES = 60;
const XP_VALUE = 18;
const COIN_DROP_MIN = 2;
const COIN_DROP_MAX = 6;
const GRAVE_BULL_CULL_MARGIN_TILES = 2;
const GRAVE_BULL_MASS = 6;
const HALF = 0.5;
const NO_TACTICS: readonly TacticsTrait[] = [];

type BullPhase = 'walk' | 'paw' | 'charge' | 'impact' | 'recover';

/** Which painted view a facing is seen from. */
function viewForFacing(facingX: number, facingY: number): CowView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY > 0 ? 'front' : 'back';
}

/**
 * A stray bull from the ruins' old pastures, raised to knock down walls.
 *
 * It walks the siege flow toward the palisade. Six tiles from the structure
 * on its path — or from a defender in the open — it lowers its head and paws
 * for a full second, the heading locked, then charges dead straight: a wall
 * takes six times the charge's weight, a body takes the charge and is flung,
 * and a charge that meets nothing stops after eight tiles. A snare's hold ends
 * a charge on the spot, which is what makes snares its answer.
 */
export class GraveBull extends Mob {
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'grave_bull';
  override readonly bodyPartKey = GRAVE_BULL_BODY_PART_KEY;
  override readonly rendersWhenDead = true;
  displayName = 'Grave Bull';
  description = 'A raised bull in trailing chains, blue fire in its ribs, built to break walls.';

  /** Sounds waiting for the audio pass. */
  readonly cues = new UndeadCueQueue();

  private phase: BullPhase = 'walk';
  private phaseTicks = 0;
  private recoverFramesLeft = 0;
  private chargeDirX = 1;
  private chargeDirY = 0;
  private chargeTravelledPx = 0;
  private chargeStructure: StructureRef | null = null;
  private chargeTargets: readonly Player[] = [];
  private bullWalkFrame = 0;
  private chargeFrame = 0;
  private idleTicks = 0;
  private corpseFrames = 0;
  private lastX: number;
  private lastY: number;
  private attackWarmed = false;
  private deathWarmed = false;
  private isAggro = false;

  /** How the last charge ended, for a gate that watches one. */
  lastChargeEnd: 'structure' | 'wall' | 'body' | 'distance' | 'snare' | null = null;
  /** How far the last charge ran, in pixels. */
  lastChargeDistancePx = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GRAVE_BULL_HP, GRAVE_BULL_WALK_SPEED);
    this.mass = GRAVE_BULL_MASS;
    this.blowCapShareOfTargetHp = GRAVE_BULL_BLOW_CAP_SHARE;
    this.lastX = this.x;
    this.lastY = this.y;
  }

  override get cullMarginTiles(): number {
    return GRAVE_BULL_CULL_MARGIN_TILES;
  }

  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return NO_TACTICS;
  }

  override get siegeStructureMultiplier(): number {
    return GRAVE_BULL_STRUCTURE_MULTIPLIER;
  }

  override get ownsSiegeMovement(): boolean {
    return true;
  }

  protected override get structureStrikeBaseDamage(): number {
    return GRAVE_BULL_CHARGE_DAMAGE;
  }

  /**
   * Its blows on structures are its charges, which its own `updateAI` begins
   * and lands; a generic swing at a wall it is standing against is refused.
   */
  override playStructureStrike(_onImpact: () => void): boolean {
    return false;
  }

  /** A carcass drops a handful of coins and nothing else. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /** Whether it is charging right now. */
  get isCharging(): boolean {
    return this.phase === 'charge';
  }

  /** Whether it is pawing the ground: the charge's telegraph. */
  get isPawing(): boolean {
    return this.phase === 'paw';
  }

  /** The locked heading of the charge being telegraphed or run. */
  get chargeHeading(): { readonly x: number; readonly y: number } {
    return { x: this.chargeDirX, y: this.chargeDirY };
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.enterPhase('walk');
    this.recoverFramesLeft = 0;
    this.chargeStructure = null;
    this.chargeTravelledPx = 0;
    this.corpseFrames = 0;
    this.isAggro = false;
    this.cues.clear();
    this.lastX = this.x;
    this.lastY = this.y;
  }

  override tickTimers(): void {
    super.tickTimers();
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    if (moved > 0 && this.phase === 'charge') {
      const cyclePx = this.tileSize * GRAVE_BULL_TILES_PER_CHARGE_CYCLE;
      this.chargeFrame =
        (this.chargeFrame + (moved / cyclePx) * GRAVE_BULL_CHARGE_FRAMES) %
        GRAVE_BULL_CHARGE_FRAMES;
    } else if (moved > 0) {
      const cyclePx = this.tileSize * GRAVE_BULL_TILES_PER_WALK_CYCLE;
      this.bullWalkFrame =
        (this.bullWalkFrame + (moved / cyclePx) * GRAVE_BULL_WALK_FRAMES) % GRAVE_BULL_WALK_FRAMES;
    }
    this.idleTicks++;
  }

  private enterPhase(phase: BullPhase): void {
    this.phase = phase;
    this.phaseTicks = 0;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.chargeTargets = targets;
    this.phaseTicks++;

    switch (this.phase) {
      case 'paw':
        this.updatePaw();
        return;
      case 'charge':
        this.updateCharge();
        return;
      case 'impact':
        this.isMoving = false;
        if (this.phaseTicks >= IMPACT_ROW_TICKS) this.enterPhase('recover');
        return;
      case 'recover':
        if (this.recoverFramesLeft > 0) this.recoverFramesLeft--;
        if (this.recoverFramesLeft === 0) this.enterPhase('walk');
        this.approach(targets, false);
        return;
      case 'walk':
        this.approach(targets, true);
        return;
    }
  }

  /**
   * Walks at a defender in reach, or down the siege flow, and paws to charge
   * when `mayCharge` and something worth charging is close enough.
   */
  private approach(targets: readonly Player[], mayCharge: boolean): void {
    const target = this.acquireTarget(targets, this.tileSize * AGGRO_RANGE_TILES, (candidate) =>
      siegeCanEngage(this, candidate),
    );
    this.currentTarget = target;

    if (target !== null) {
      if (!this.isAggro) {
        this.isAggro = true;
        this.cues.push({ id: 'bear_growl_1' });
      }
      this.warmAttack();
      const toX = target.x - this.x;
      const toY = target.y - this.y;
      const distance = Math.hypot(toX, toY);
      const clearRun =
        this.map === null || this.map.hasHostileWalkableLine(this.x, this.y, target.x, target.y);
      if (
        mayCharge &&
        distance <= this.tileSize * GRAVE_BULL_CHARGE_TRIGGER_TILES &&
        clearRun &&
        this.hasLOS(target)
      ) {
        this.beginPaw(toX, toY, null);
        return;
      }
      this.updateLastKnown(target);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * APPROACH_STOP_TILES,
      );
      return;
    }

    this.isAggro = false;
    const siege = this.siegeCapable;
    if (siege === null || !this.isHostile) {
      this.doWander();
      return;
    }
    const { defense, flow } = siege.world;
    const lookahead = this.structureAhead(this.prewarmLookaheadTiles());
    if (lookahead !== null) this.warmAttack();
    if (
      mayCharge &&
      lookahead !== null &&
      lookahead.steps <= GRAVE_BULL_CHARGE_TRIGGER_TILES &&
      isStandingStructure(defense, lookahead.ref)
    ) {
      const aim = nearestStructurePoint(defense, lookahead.ref, this);
      if (aim !== null) {
        this.beginPaw(
          aim.x - (this.x + this.tileSize * HALF),
          aim.y - (this.y + this.tileSize * HALF),
          lookahead.ref,
        );
        return;
      }
    }
    const next = flow.nextStep(tileUnder(this));
    if (next === null) {
      this.isMoving = false;
      return;
    }
    this.marchStep(next.x * this.tileSize - this.x, next.y * this.tileSize - this.y);
  }

  /** Tiles ahead the attack rows are warmed at: the charge's trigger, plus the walk the lead takes. */
  private prewarmLookaheadTiles(): number {
    const leadPx = GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES * UPDATES_PER_CACHE_FRAME * this.speed;
    return GRAVE_BULL_CHARGE_TRIGGER_TILES + Math.ceil(leadPx / this.tileSize);
  }

  /** The first structure the flow walks into within `maxSteps` steps, and how many steps away. */
  private structureAhead(maxSteps: number): { ref: StructureRef; steps: number } | null {
    const siege = this.siegeCapable;
    if (siege === null) return null;
    const { flow } = siege.world;
    let tile = tileUnder(this);
    for (let steps = 1; steps <= maxSteps; steps++) {
      const ref = flow.blockingStructure(tile);
      if (ref !== null) return { ref, steps };
      const next = flow.nextStep(tile);
      if (next === null) return null;
      tile = next;
    }
    return null;
  }

  private warmAttack(): void {
    if (this.attackWarmed) return;
    this.attackWarmed = true;
    prewarmGraveBullAttack(viewForFacing(this.facingX, this.facingY));
  }

  private beginPaw(dirX: number, dirY: number, structure: StructureRef | null): void {
    const length = Math.hypot(dirX, dirY);
    if (length === 0) return;
    this.chargeDirX = dirX / length;
    this.chargeDirY = dirY / length;
    this.facingX = this.chargeDirX;
    this.facingY = this.chargeDirY;
    this.chargeStructure = structure;
    this.isMoving = false;
    this.warmAttack();
    this.cues.push({ id: 'bear_growl_1' });
    this.enterPhase('paw');
  }

  private updatePaw(): void {
    this.isMoving = false;
    if (this.isRooted) {
      this.endCharge('snare');
      return;
    }
    if (this.phaseTicks < GRAVE_BULL_PAW_TELEGRAPH_FRAMES) return;
    this.chargeTravelledPx = 0;
    if (!this.deathWarmed) {
      this.deathWarmed = true;
      prewarmGraveBullDeath();
    }
    this.cues.push({ id: 'rolling_earth_ball' });
    this.enterPhase('charge');
  }

  private updateCharge(): void {
    if (this.isRooted) {
      this.endCharge('snare');
      return;
    }
    const step = GRAVE_BULL_CHARGE_SPEED;
    const half = this.tileSize * HALF;
    const centreX = this.x + half;
    const centreY = this.y + half;

    for (const target of this.chargeTargets) {
      if (!target.isAlive || target.isDefendTarget === true) continue;
      const hitX = target.x + half;
      const hitY = target.y + half;
      if (Math.hypot(hitX - centreX, hitY - centreY) > this.tileSize * CHARGE_HIT_RADIUS_TILES)
        continue;
      const connected = this.dealDamage(target, GRAVE_BULL_CHARGE_DAMAGE, 'charge');
      if (connected) {
        target.applyKnockback(
          this.chargeDirX,
          this.chargeDirY,
          this.tileSize * CHARGE_KNOCKBACK_TILES,
          CHARGE_KNOCKBACK_FRAMES,
        );
      }
      this.endCharge('body');
      return;
    }

    const aheadX = Math.floor((centreX + this.chargeDirX * (half + step)) / this.tileSize);
    const aheadY = Math.floor((centreY + this.chargeDirY * (half + step)) / this.tileSize);
    if (this.map !== null && !this.map.isWalkableForHostile(aheadX, aheadY)) {
      this.meetObstacle(aheadX, aheadY);
      return;
    }

    const beforeX = this.x;
    const beforeY = this.y;
    this.moveWithCollision(this.chargeDirX * step, this.chargeDirY * step);
    const moved = Math.hypot(this.x - beforeX, this.y - beforeY);
    this.isMoving = moved > 0;
    this.chargeTravelledPx += moved;
    if (moved < step * CHARGE_STALL_SHARE) {
      this.meetObstacle(aheadX, aheadY);
      return;
    }
    if (this.chargeTravelledPx >= this.tileSize * GRAVE_BULL_CHARGE_MAX_TILES) {
      this.endCharge('distance');
    }
  }

  /**
   * The charge has run into something solid on `tile`. A structure takes the
   * full weight at the siege multiplier, through the village's own damage
   * path; plain rock or a building just stops it.
   */
  private meetObstacle(tileX: number, tileY: number): void {
    const siege = this.siegeCapable;
    const defense = siege?.world.defense ?? null;
    const ref = defense?.at(tileX, tileY) ?? this.chargeStructure;
    if (
      this.isHostile &&
      defense !== null &&
      siege !== null &&
      ref !== null &&
      isStandingStructure(defense, ref)
    ) {
      const damage = this.structureStrikeDamage * siege.structureDamageMultiplier;
      defense.damage(ref, damage, this, 'melee');
      this.endCharge('structure');
      return;
    }
    this.endCharge('wall');
  }

  private endCharge(reason: NonNullable<GraveBull['lastChargeEnd']>): void {
    this.lastChargeEnd = reason;
    this.lastChargeDistancePx = this.chargeTravelledPx;
    this.chargeStructure = null;
    this.isMoving = false;
    if (reason === 'structure' || reason === 'wall') {
      this.recoverFramesLeft = GRAVE_BULL_WALL_RECOVERY_FRAMES;
      this.enterPhase('impact');
      return;
    }
    this.recoverFramesLeft = GRAVE_BULL_RECOVERY_FRAMES;
    this.enterPhase('recover');
  }

  override tickCorpse(): void {
    if (this.corpseFrames === 0) this.cues.push({ id: 'bones_rattling' });
    this.corpseFrames++;
  }

  override get corpseExpired(): boolean {
    return (
      !this.isAlive &&
      this.corpseFrames >= DEATH_ROW_TICKS + CORPSE_HOLD_FRAMES + CORPSE_FADE_FRAMES
    );
  }

  private get corpseAlpha(): number {
    const fadeStart = DEATH_ROW_TICKS + CORPSE_HOLD_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / CORPSE_FADE_FRAMES);
  }

  /** The row and frame being drawn. */
  get currentRow(): { action: GraveBullAction; frame: number } {
    if (!this.isAlive) {
      return {
        action: 'death',
        frame: Math.min(
          GRAVE_BULL_DEATH_FRAMES - 1,
          Math.floor(this.corpseFrames / GRAVE_BULL_TICKS_PER_FRAME.death),
        ),
      };
    }
    switch (this.phase) {
      case 'paw':
        return {
          action: 'paw',
          frame: Math.min(
            GRAVE_BULL_PAW_FRAMES - 1,
            Math.floor(this.phaseTicks / GRAVE_BULL_TICKS_PER_FRAME.paw),
          ),
        };
      case 'charge':
        return { action: 'charge', frame: Math.floor(this.chargeFrame) };
      case 'impact':
        return {
          action: 'impact',
          frame: Math.min(
            GRAVE_BULL_IMPACT_FRAMES - 1,
            Math.floor(this.phaseTicks / GRAVE_BULL_TICKS_PER_FRAME.impact),
          ),
        };
      case 'walk':
      case 'recover':
        break;
    }
    if (this.isMoving) return { action: 'walk', frame: Math.floor(this.bullWalkFrame) };
    return {
      action: 'idle',
      frame: Math.floor(this.idleTicks / GRAVE_BULL_TICKS_PER_FRAME.idle) % GRAVE_BULL_IDLE_FRAMES,
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
    const row = this.currentRow;
    if (this.isAggro && this.isAlive) this.renderAggroIndicator(ctx, sx, sy, tileSize);
    drawGraveBullSprite(
      ctx,
      row.action,
      viewForFacing(this.facingX, this.facingY),
      row.frame,
      sx,
      sy,
      tileSize,
      this.facingX < 0,
      this.isAlive ? 1 : this.corpseAlpha,
    );
    if (this.isAlive) this.renderMobHealthBar(ctx, sx, sy);
  }
}
