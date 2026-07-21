import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawSignetSprite, drawEliteMarker } from '../sprites/signetSprite';
import { InkMarauder } from './InkMarauder';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { normalize } from '../utils';

const SIGNET_HP = 80;
const SIGNET_SPEED = 1.6;
const CENTER_OFFSET = 0.5;
/** Feedback timers for hits that never actually reduce her hp — she's unkillable. */
const SIGNET_HIT_FLASH_FRAMES = 8;
const SIGNET_HIT_HEALTHBAR_FRAMES = 180;

/** Ally-mode combat tuning — mirrors Mongo's chase/bite shape. */
const AGGRO_RANGE_TILES = 10;
const ATTACK_RANGE_TILES = 1.0;
const ATTACK_DAMAGE = 6;
/** Frames between strikes (~0.83 s at 60 fps). */
const ATTACK_COOLDOWN = 50;
const ATTACK_ANIM_FRAMES = 14;
/** How far Signet will stray from her anchor point (her spawn tile) while fighting. */
const LEASH_RADIUS_TILES = 14;
const FOLLOW_STOP_FRACTION = 0.8;

/** Summoner ability — periodically conjures a short-lived spirit ally. */
const SUMMON_COOLDOWN_FRAMES = 600; // 10s at 60fps
const SUMMON_ANIM_FRAMES = 30;
const SUMMON_SPAWN_OFFSET_TILES = 1;
const SUMMON_SPAWN_SEARCH_RADIUS_TILES = 3;

/**
 * Tsarina Signet — the half-naiad, half-high-elf Summoner who catches the
 * player spying on Grimaldi's circus. Before the ambush she's a static
 * lookout; once the circus questline's combat phases begin
 * (`allyModeActive`), she fights alongside the player and periodically
 * conjures a short-lived `InkMarauder` ally.
 */
export class Signet extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Tsarina Signet';
  description = "Grimaldi's daughter, a Summoner covered in living tattoos.";

  /** Set true by CircusQuestSystem once the sideshows/big-top combat phases begin. */
  allyModeActive = false;
  /** All mobs in the scene — set each frame by CircusQuestSystem while allyModeActive. */
  allMobs: Mob[] = [];
  /** Frames between summons — shortened by the quest once the ritual is blood-fueled. */
  summonCooldownFrames = SUMMON_COOLDOWN_FRAMES;

  private readonly addMob: (mob: Mob) => void;
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private summonCooldown = SUMMON_COOLDOWN_FRAMES;
  private summonAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number, addMob: (mob: Mob) => void) {
    super(tileX, tileY, tileSize, SIGNET_HP, SIGNET_SPEED);
    this.addMob = addMob;
  }

  /** Signet is an ally — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * Signet is quest-critical and must never die — some hostile AI (e.g. the
   * Vespa-stage BrindleGrub) targets any mob in range regardless of
   * hostility, bypassing the `isHostile` check that protects her from the
   * player. Still flash for hit feedback, but never reduce hp.
   */
  override takeDamageFrom(
    _amount: number,
    _attacker: Player | null,
    _damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    this.damageFlash = SIGNET_HIT_FLASH_FRAMES;
    this.healthBarTimer = SIGNET_HIT_HEALTHBAR_FRAMES;
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    if (!this.allyModeActive) {
      // Pre-ambush: a stationary lookout near the circus, watched by CircusQuestSystem's
      // own proximity check rather than anything Signet does herself.
      this.isMoving = false;
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    if (this.summonCooldown > 0) this.summonCooldown--;
    if (this.summonAnimTimer > 0) this.summonAnimTimer--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const leashPx = this.tileSize * LEASH_RADIUS_TILES;

    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      const dAnchor = Math.hypot(
        mob.x + this.tileSize * CENTER_OFFSET - (this.spawnX + this.tileSize * CENTER_OFFSET),
        mob.y + this.tileSize * CENTER_OFFSET - (this.spawnY + this.tileSize * CENTER_OFFSET),
      );
      if (dAnchor > leashPx) continue;
      const d = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (d < aggroRangePx && d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }

    this.isAggro = nearest !== null;

    if (!nearest) {
      this.isMoving = false;
      return;
    }

    this.updateLastKnown(nearest);
    if (nearestDist > attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.facingX = n.x;
        this.facingY = n.y;
      }
    }

    if (nearestDist <= attackRangePx && this.attackCooldown === 0) {
      nearest.takeDamageFrom(ATTACK_DAMAGE, null, 'melee');
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }

    if (this.summonCooldown === 0 && this.map) {
      const spawnTile = findNearbyWalkableTile(
        this.map,
        Math.round(this.x / this.tileSize) + SUMMON_SPAWN_OFFSET_TILES,
        Math.round(this.y / this.tileSize),
        SUMMON_SPAWN_SEARCH_RADIUS_TILES,
      );
      if (spawnTile) {
        const marauder = new InkMarauder(spawnTile.x, spawnTile.y, this.tileSize);
        marauder.setMap(this.map);
        this.addMob(marauder);
        this.summonAnimTimer = SUMMON_ANIM_FRAMES;
      }
      this.summonCooldown = this.summonCooldownFrames;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const summonAnim = this.summonAnimTimer > 0 ? 1 - this.summonAnimTimer / SUMMON_ANIM_FRAMES : 0;

    drawSignetSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      summonAnim,
      this.facingX,
    );

    ctx.filter = 'none';
    ctx.restore();

    drawEliteMarker(ctx, sx, sy, tileSize);

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
