import { TILE_SIZE } from '../../core/constants';
import { normalize } from '../../utils';
import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import { GOLEM_ATTACK_TIMING, FRAMES_PER_SHEET_FRAME } from '../RockGolem';
import type { GolemAttack } from '../../sprites/rockGolemSprite';
import {
  DEFAULT_ENGAGE_RADIUS_TILES,
  DEFAULT_FOLLOW_BAND,
  DEFAULT_LEASH_RADIUS_TILES,
  DEFAULT_STRIKE_RANGE_TILES,
  NO_PROJECTILES,
  locomotionState,
  type HirelingProjectile,
  type MercenaryDrawState,
  type MercenaryKit,
  type MercenaryKitContext,
} from './MercenaryKit';

/**
 * Tumbledown's kit: the rock golem's own slam/stomp alternation and boulder
 * throw, off the same shared timing table as every wild golem.
 *
 * A hired golem shares the wild ones' animations and attacks; it stays a
 * `Mercenary` rather than a `RockGolem` because everything that makes a
 * hireling a hireling — the owner it trails, the leash, the contract that dies
 * with it — lives in the shell and in `MercenarySystem`.
 */

const ATTACK_COOLDOWN_FRAMES = 45;
/** Range at which the golem hurls a boulder instead of closing, in tiles. */
const THROW_MIN_RANGE_TILES = 4;
const THROW_MAX_RANGE_TILES = 9;
const THROW_COOLDOWN_FRAMES = 240;
/** Damage a thrown rock deals, scaled off the template's melee number. */
const THROW_DAMAGE_RATIO = 0.7;
/** Height and reach the boulder leaves the golem at, as fractions of a tile. */
const HAND_OFFSET_X = 0.3;
const HAND_OFFSET_Y = 0.25;
const CENTER_OFFSET = 0.5;
/** The golem's fists reach a little further than a swordsman's blade. */
const GOLEM_REACH_RATIO = 1.6;
/** Melee starts from a little past strike range, so a victim stepping back is still swung at. */
const STRIKE_TRIGGER_RANGE_RATIO = 1.2;
const MIN_THROW_DAMAGE = 1;

export class GolemKit implements MercenaryKit {
  readonly engageRadiusTiles = DEFAULT_ENGAGE_RADIUS_TILES;
  readonly leashRadiusTiles = DEFAULT_LEASH_RADIUS_TILES;
  readonly strikeRangeTiles = DEFAULT_STRIKE_RANGE_TILES;
  readonly followBand = DEFAULT_FOLLOW_BAND;

  private attack: GolemAttack | null = null;
  private attackFrame = 0;
  private attackResolved = false;
  /** Alternates the two melee attacks, exactly as `RockGolem` does. */
  private lastMelee: GolemAttack = 'stomp';
  private throwCooldown = 0;
  /** Whatever the golem committed its swing to, so the impact frame can land it. */
  private victim: Mob | null = null;
  /**
   * Rocks thrown but not yet handed on. The shell drains this every frame, and
   * a golem that dies mid-throw must not take the boulder with it.
   */
  private pendingThrows: HirelingProjectile[] = [];

  constructor(private readonly strikeDamage: number) {}

  tick(): void {
    if (this.throwCooldown > 0) this.throwCooldown--;
  }

  update(ctx: MercenaryKitContext): boolean {
    return this.advanceAttack(ctx);
  }

  canStartAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean {
    if (this.canThrowAt(ctx.merc, target, distancePx)) return true;
    return distancePx <= ctx.merc.strikeRangePx * STRIKE_TRIGGER_RANGE_RATIO;
  }

  startAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): void {
    // The victim is committed before the wind-up starts. Left unset, the
    // release aims wherever pathfinding happened to leave the golem facing,
    // and carries no target for the projectile system to include.
    this.victim = target;
    if (this.canThrowAt(ctx.merc, target, distancePx)) {
      this.begin(ctx.merc, 'throw');
      this.throwCooldown = THROW_COOLDOWN_FRAMES;
      return;
    }
    this.begin(ctx.merc, this.lastMelee === 'slam' ? 'stomp' : 'slam');
  }

  drawState(merc: Mercenary): MercenaryDrawState {
    const attack = this.attack;
    if (attack === null) return locomotionState(merc);
    const timing = GOLEM_ATTACK_TIMING[attack];
    return { row: attack, progress: this.attackFrame / (timing.frames * FRAMES_PER_SHEET_FRAME) };
  }

  drainProjectiles(): readonly HirelingProjectile[] {
    if (this.pendingThrows.length === 0) return NO_PROJECTILES;
    const thrown = this.pendingThrows;
    this.pendingThrows = [];
    return thrown;
  }

  clearAirborne(): void {
    this.pendingThrows = [];
  }

  private canThrowAt(merc: Mercenary, victim: Mob, distancePx: number): boolean {
    if (this.throwCooldown > 0) return false;
    const minPx = TILE_SIZE * THROW_MIN_RANGE_TILES;
    const maxPx = TILE_SIZE * THROW_MAX_RANGE_TILES;
    if (distancePx < minPx || distancePx > maxPx) return false;
    // Without this it lobs boulders into the wall it is standing behind
    // forever: the cooldown resets, the rock shatters on the same face, and the
    // golem never closes. `canSee` is the shared cached check the wild golem
    // uses, so both ends of the same attack agree on what "can see" means.
    return merc.canSee(victim);
  }

  private begin(merc: Mercenary, attack: GolemAttack): void {
    this.attack = attack;
    this.attackFrame = 0;
    this.attackResolved = false;
    merc.attackCooldown = ATTACK_COOLDOWN_FRAMES;
    merc.isMoving = false;
    if (attack !== 'throw') {
      this.lastMelee = attack;
      merc.attackSoundPending = true;
    }
  }

  /** Plays one frame of an attack; true while one owns the frame. */
  private advanceAttack(ctx: MercenaryKitContext): boolean {
    const attack = this.attack;
    if (attack === null) return false;
    const merc = ctx.merc;

    const timing = GOLEM_ATTACK_TIMING[attack];
    const sheetFrame = Math.floor(this.attackFrame / FRAMES_PER_SHEET_FRAME);
    merc.isMoving = false;

    // Keeps tracking until it commits, exactly as a wild golem does. A facing
    // locked from frame zero of a fifty-six frame throw sends the boulder
    // wherever pathfinding happened to leave the golem pointing.
    const victim = this.victim;
    if (!this.attackResolved && sheetFrame < timing.impactFrame && victim !== null) {
      const heading = normalize(victim.x - merc.x, victim.y - merc.y);
      merc.facingX = heading.x;
      merc.facingY = heading.y;
    }

    if (!this.attackResolved && sheetFrame >= timing.impactFrame) {
      this.attackResolved = true;
      this.resolve(ctx, attack);
    }

    this.attackFrame++;
    if (this.attackFrame >= timing.frames * FRAMES_PER_SHEET_FRAME) {
      this.attack = null;
      this.attackFrame = 0;
      this.attackResolved = false;
      this.victim = null;
    }
    return true;
  }

  private resolve(ctx: MercenaryKitContext, attack: GolemAttack): void {
    const victim = this.victim;
    const merc = ctx.merc;
    if (attack === 'throw') {
      this.releaseRock(ctx, victim);
      return;
    }
    if (victim?.isAlive !== true) return;
    const reachPx = merc.strikeRangePx * GOLEM_REACH_RATIO;
    if (Math.hypot(victim.x - merc.x, victim.y - merc.y) > reachPx) return;
    victim.takeCreditedDamage(this.strikeDamage, ctx.owner, 'melee', merc);
    merc.noteBlowLanded(victim);
  }

  /**
   * Queues one boulder. Its damage is credited to the owner the same way the
   * melee is, so a kill it lands still goes to the player who paid.
   */
  private releaseRock(ctx: MercenaryKitContext, victim: Mob | null): void {
    const merc = ctx.merc;
    const facing = Math.sign(merc.facingX) === 0 ? 1 : Math.sign(merc.facingX);
    const handX = merc.x + TILE_SIZE * (CENTER_OFFSET + HAND_OFFSET_X * facing);
    const handY = merc.y + TILE_SIZE * HAND_OFFSET_Y;
    const aimX = victim ? victim.x + TILE_SIZE * CENTER_OFFSET : handX + merc.facingX;
    const aimY = victim ? victim.y + TILE_SIZE * CENTER_OFFSET : handY + merc.facingY;
    const dirX = aimX - handX;
    const dirY = aimY - handY;
    // A zero direction normalises to NaN and produces a rock that never moves
    // and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingThrows.push({
      kind: 'rock',
      rock: {
        x: handX,
        y: handY,
        dirX: degenerate ? facing : dirX,
        dirY: degenerate ? merc.facingY : dirY,
        damage: Math.max(MIN_THROW_DAMAGE, Math.round(this.strikeDamage * THROW_DAMAGE_RATIO)),
        mobType: merc.mobType,
        aimedAt: victim,
        thrower: merc,
        owner: ctx.owner,
      },
    });
    merc.projectileSoundPending = true;
  }
}
