import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import {
  drawSignetSprite,
  drawEliteMarker,
  SIGNET_OVERLAY_CLEARANCE,
  SIGNET_CHEST_Y_OFFSET,
} from '../sprites/signetSprite';
import { InkMarauder, MARAUDER_LIFESPAN_FRAMES } from './InkMarauder';
import type { InkMarauderForm } from '../sprites/inkMarauderSprite';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import {
  advanceSignetFireballs,
  fireSignetFireball,
  renderSignetFireballs,
  type SignetFireball,
} from './signetFireball';
import { normalize, randomInt } from '../utils';
import { questMarkerColorFor, type QuestMarkerState } from '../sprites/questNPCSprite';
import { drawQuestBeacon } from '../sprites/questBeacon';

const SIGNET_HP = 80;
const SIGNET_SPEED = 1.6;
const CENTER_OFFSET = 0.5;
/** Feedback timers for hits that never actually reduce her hp — she's unkillable. */
const SIGNET_HIT_FLASH_FRAMES = 8;
const SIGNET_HIT_HEALTHBAR_FRAMES = 180;

/** Ally-mode combat tuning — she hangs back and lobs fireballs rather than brawling. */
const AGGRO_RANGE_TILES = 10;
const ATTACK_RANGE_TILES = 6;
/**
 * Chip damage by design: the fireball is showmanship so Signet reads as
 * participating in the fight, while the player still earns every kill.
 */
const FIREBALL_DAMAGE = 1;
/** Frames between casts (~0.83 s at 60 fps). */
const ATTACK_COOLDOWN = 50;
const ATTACK_ANIM_FRAMES = 14;
/** She stops closing once this deep inside her cast range. */
const CAST_STANDOFF_FRACTION = 0.75;
/**
 * The flight line starts at her tile centre — the tile above her may be solid,
 * and the fireball's first walkability probe happens at the spawn point. The
 * flame is merely *drawn* up at her chest and settles onto the line.
 */
const CAST_ORIGIN_Y_OFFSET = CENTER_OFFSET;
const CAST_RENDER_RISE = CENTER_OFFSET - SIGNET_CHEST_Y_OFFSET;
/** How far Signet will stray from her anchor point (her spawn tile) while fighting. */
const LEASH_RADIUS_TILES = 14;

/** Summoner ability — periodically conjures a short-lived spirit ally. */
const SUMMON_COOLDOWN_FRAMES = 600; // 10s at 60fps
const SUMMON_ANIM_FRAMES = 30;
/** Her summons tower over a tile, so they have to land clear of her own figure. */
const SUMMON_SPAWN_OFFSET_TILES = 2;
const SUMMON_SPAWN_SEARCH_RADIUS_TILES = 3;
/** She never pulls the same tattoo twice in a row — the two forms strictly alternate. */
const NEXT_SUMMON_FORM: Record<InkMarauderForm, InkMarauderForm> = {
  ogre: 'shark',
  shark: 'ogre',
};

/**
 * Idle loitering — while she is only a lookout she shifts her weight and takes
 * a step or two, but must stay on the spot the quest placed her: dialog range,
 * the Mold Lion wave origin, and the elite marker all key off her position.
 */
const IDLE_WANDER_RADIUS_TILES = 1.25;
const IDLE_WANDER_SPEED_FRACTION = 0.28;
/** Most idle intervals are spent standing still, so she reads as loitering rather than pacing. */
const IDLE_WANDER_PAUSE_CHANCE = 0.6;
/** Frames between idle direction changes (~1–3 s at 60 fps). */
const IDLE_WANDER_TIMER_MIN = 70;
const IDLE_WANDER_TIMER_MAX = 190;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

/**
 * Gait — her figure is drawn at double scale and she spends most of her time
 * shuffling at a fraction of her top speed, so a fixed per-frame walk cycle
 * reads as frantic limb-flailing. Drive the cycle off ground actually covered.
 */
const GAIT_RADIANS_PER_PIXEL = 0.05;
/** Ceiling so a separation shove or a repositioning jump can't snap the cycle forward. */
const MAX_GAIT_RADIANS_PER_FRAME = 0.09;

/**
 * Tsarina Signet — the half-naiad, half-high-elf Summoner who catches the
 * player spying on Grimaldi's circus. Before the ambush she's a static
 * lookout; once the circus questline's combat phases begin
 * (`allyModeActive`), she fights alongside the player and periodically
 * conjures a short-lived `InkMarauder` ally.
 */
export class Signet extends Mob {
  /**
   * Her horns and elite marker sit well above her tile, so a status label
   * anchored to the tile would land across her face. Same clearance the rest of
   * her overlays use.
   */
  protected override get statusLabelClearanceTiles(): number {
    return SIGNET_OVERLAY_CLEARANCE;
  }

  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Tsarina Signet';
  description = "Grimaldi's wife, a Summoner covered in living tattoos.";

  /** Set true by CircusQuestSystem once the sideshows/big-top combat phases begin. */
  allyModeActive = false;
  /** All mobs in the scene — set each frame by CircusQuestSystem while allyModeActive. */
  allMobs: Mob[] = [];
  /** Frames between summons — shortened by the quest once the ritual is blood-fueled. */
  summonCooldownFrames = SUMMON_COOLDOWN_FRAMES;
  /** Set each frame by CircusQuestSystem — she holds still while her dialog is open. */
  isConversing = false;
  /**
   * Whether she is waiting to say something, set each frame by
   * CircusQuestSystem from the same phases its minimap marker reads.
   *
   * She is the one quest giver who walks, which is why her beacon is drawn from
   * here rather than pinned to a tile the way a notice board's would be.
   */
  markerType: QuestMarkerState = 'none';

  private readonly addMob: (mob: Mob) => void;
  private idleAnchorX: number;
  private idleAnchorY: number;
  private gaitSampleX: number;
  private gaitSampleY: number;
  private idleWanderTimer = randomInt(0, IDLE_WANDER_TIMER_MAX);
  private idleWanderDx = 0;
  private idleWanderDy = 0;
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private summonCooldown = SUMMON_COOLDOWN_FRAMES;
  private summonAnimTimer = 0;
  private nextSummonForm: InkMarauderForm = randomInt(0, 1) === 0 ? 'ogre' : 'shark';
  private isAggro = false;
  private fireballs: SignetFireball[] = [];

  override clearAirborneAttacks(): void {
    this.fireballs = [];
  }

  constructor(tileX: number, tileY: number, tileSize: number, addMob: (mob: Mob) => void) {
    super(tileX, tileY, tileSize, SIGNET_HP, SIGNET_SPEED);
    this.addMob = addMob;
    this.idleAnchorX = tileX * tileSize;
    this.idleAnchorY = tileY * tileSize;
    this.gaitSampleX = this.idleAnchorX;
    this.gaitSampleY = this.idleAnchorY;
  }

  /**
   * Re-pegs her loitering spot after the quest teleports her (she crosses the
   * grounds to the Big Top door in one step); without this she would walk back
   * toward the lookout tile she spawned on.
   */
  anchorIdleWanderToCurrentPosition(): void {
    this.idleAnchorX = this.x;
    this.idleAnchorY = this.y;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.idleWanderDx = 0;
    this.idleWanderDy = 0;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.anchorIdleWanderToCurrentPosition();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.summonCooldown = this.summonCooldownFrames;
    this.summonAnimTimer = 0;
    this.isAggro = false;
    this.fireballs = [];
  }

  /** Signet is an ally — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  /**
   * Unlike a temporary summon (Mongo, a hired mercenary), Signet's spawn tile
   * is her leash anchor — see `LEASH_RADIUS_TILES` — so a checkpoint restore
   * should rewind her there and clear her fireballs/cooldowns via
   * `resetToSpawn()`, the same as a hostile mob.
   */
  override get resetsFullyOnCheckpoint(): boolean {
    return true;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * Signet is quest-critical and must never die, from any direction: some
   * hostile AI (e.g. the Vespa-stage BrindleGrub) targets any mob in range
   * regardless of hostility, and a blast or a sepsis proc reaches her without
   * anyone aiming at all.
   *
   * The shield goes here rather than on `takeDamageFrom` because this is the
   * switch every route into her health asks — the swung one, the blast and the
   * damage-over-time tick alike. Guarding only the swing is what left one crown
   * proc able to kill her.
   */
  protected override get isDamageImmune(): boolean {
    return true;
  }

  /** She still flashes, so a blow reads as refused rather than as missed. */
  protected override onDamageBlocked(): void {
    this.damageFlash = SIGNET_HIT_FLASH_FRAMES;
    this.healthBarTimer = SIGNET_HIT_HEALTHBAR_FRAMES;
  }

  /**
   * Measured over the previous frame so it also picks up the ground she lost
   * to collision slides and separation pushes, not just her intended step.
   */
  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.walkFrameSpeed = Math.min(coveredPx * GAIT_RADIANS_PER_PIXEL, MAX_GAIT_RADIANS_PER_FRAME);
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    this.syncGaitToDistanceCovered();

    if (!this.allyModeActive) {
      // Pre-ambush: a lookout loitering near the circus, watched by CircusQuestSystem's
      // own proximity check rather than anything Signet does herself.
      this.stepIdleWander();
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    if (this.summonCooldown > 0) this.summonCooldown--;
    if (this.summonAnimTimer > 0) this.summonAnimTimer--;

    this.fireballs = advanceSignetFireballs(
      this.fireballs,
      this.map,
      this.tileSize,
      this.allMobs,
      (target) => target.takeDamageFrom(FIREBALL_DAMAGE, null, 'missile'),
    );

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
        attackRangePx * CAST_STANDOFF_FRACTION,
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

    if (nearestDist <= attackRangePx && this.attackCooldown === 0 && this.hasLOS(nearest)) {
      const originX = this.x + this.tileSize * CENTER_OFFSET;
      const originY = this.y + this.tileSize * CAST_ORIGIN_Y_OFFSET;
      this.fireballs.push(
        fireSignetFireball(
          originX,
          originY,
          nearest.x + this.tileSize * CENTER_OFFSET,
          nearest.y + this.tileSize * CENTER_OFFSET,
          this.tileSize * CAST_RENDER_RISE,
        ),
      );
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
        const marauder = new InkMarauder(
          spawnTile.x,
          spawnTile.y,
          this.tileSize,
          MARAUDER_LIFESPAN_FRAMES,
          this.nextSummonForm,
        );
        marauder.setMap(this.map);
        marauder.allMobs = this.allMobs;
        this.addMob(marauder);
        this.nextSummonForm = NEXT_SUMMON_FORM[this.nextSummonForm];
        this.summonAnimTimer = SUMMON_ANIM_FRAMES;
      }
      this.summonCooldown = this.summonCooldownFrames;
    }
  }

  /**
   * A tight loiter around her anchor: she idles most intervals, and any step
   * that would carry her past `IDLE_WANDER_RADIUS_TILES` is turned back inward
   * rather than continued, so she never drifts off her mark.
   */
  private stepIdleWander(): void {
    if (this.isConversing) {
      this.isMoving = false;
      return;
    }

    if (this.idleWanderTimer > 0) {
      this.idleWanderTimer--;
    } else {
      const stepSpeed = this.speed * IDLE_WANDER_SPEED_FRACTION;
      if (Math.random() < IDLE_WANDER_PAUSE_CHANCE) {
        this.idleWanderDx = 0;
        this.idleWanderDy = 0;
      } else {
        const angle = Math.random() * FULL_CIRCLE_RADIANS;
        this.idleWanderDx = Math.cos(angle) * stepSpeed;
        this.idleWanderDy = Math.sin(angle) * stepSpeed;
      }
      this.idleWanderTimer = randomInt(IDLE_WANDER_TIMER_MIN, IDLE_WANDER_TIMER_MAX);
    }

    if (this.idleWanderDx === 0 && this.idleWanderDy === 0) {
      this.isMoving = false;
      return;
    }

    const toAnchorX = this.idleAnchorX - this.x;
    const toAnchorY = this.idleAnchorY - this.y;
    const distFromAnchor = Math.hypot(toAnchorX, toAnchorY);
    const idleRadiusPx = this.tileSize * IDLE_WANDER_RADIUS_TILES;
    if (distFromAnchor > idleRadiusPx) {
      const back = normalize(toAnchorX, toAnchorY);
      const stepSpeed = this.speed * IDLE_WANDER_SPEED_FRACTION;
      this.idleWanderDx = back.x * stepSpeed;
      this.idleWanderDy = back.y * stepSpeed;
    }

    const preMoveX = this.x;
    const preMoveY = this.y;
    this.moveWithCollision(this.idleWanderDx, this.idleWanderDy);

    const movedX = this.x - preMoveX;
    const movedY = this.y - preMoveY;
    if (movedX === 0 && movedY === 0) {
      // Walked into a wall — give up on this heading instead of grinding against it.
      this.idleWanderDx = 0;
      this.idleWanderDy = 0;
      this.isMoving = false;
      return;
    }

    const heading = normalize(movedX, movedY);
    this.facingX = heading.x;
    this.facingY = heading.y;
    this.isMoving = true;
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

    // The shared overlays anchor to the tile top, which lands on her chest at
    // double scale — lift them clear of both her head and her elite marker.
    const overlayY = sy - SIGNET_OVERLAY_CLEARANCE * tileSize;

    // Before the body paint, so the column stands behind her.
    const markerColor = questMarkerColorFor(this.markerType);
    if (markerColor !== undefined) {
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), markerColor);
    }

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, overlayY, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    // The last animated frame has to land on 1.0, or the gesture snaps back
    // from partway through its arc every time the timer expires.
    const summonProgress =
      this.summonAnimTimer > 0
        ? (SUMMON_ANIM_FRAMES - this.summonAnimTimer) / (SUMMON_ANIM_FRAMES - 1)
        : 0;
    const castProgress =
      this.attackAnimTimer > 0
        ? (ATTACK_ANIM_FRAMES - this.attackAnimTimer) / (ATTACK_ANIM_FRAMES - 1)
        : 0;

    drawSignetSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      summonProgress,
      castProgress,
      facingX: this.facingX,
      // Screen y grows downward, so heading up-screen is heading away from the
      // camera. Only when that dominates her horizontal facing.
      facingAway: this.facingY < 0 && Math.abs(this.facingY) > Math.abs(this.facingX),
    });

    ctx.restore();

    renderSignetFireballs(ctx, this.fireballs, camX, camY);

    drawEliteMarker(ctx, sx, sy, tileSize);

    this.renderMobHealthBar(ctx, sx, overlayY);
    // The damage flash outlines her actual tile footprint, so it stays put.
  }
}
