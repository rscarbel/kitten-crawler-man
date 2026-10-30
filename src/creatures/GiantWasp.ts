import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import type { CreatureAudioTag } from '../audio/creatureAudioTags';
import { normalize } from '../utils';
import { makePoison } from '../core/combat/StatusEffect';
import {
  GIANT_WASP_BODY_PART_KEY,
  drawAcidSpit,
  drawGiantWaspSprite,
  prewarmGiantWasp,
  prewarmGiantWaspGore,
  prewarmWaspSpit,
} from '../sprites/giantWaspSprite';
import { STING_FRAMES, STING_IMPACT_FRAME } from '../sprites/art/giantWaspFigure';
import { deferChrome, type ChromePart } from '../systems/lighting/aboveDarkness';
import type { DynamicLightSink } from '../systems/lighting/dynamicLights';

const GIANT_WASP_HP = 20;
const GIANT_WASP_SPEED = 1.55;
const GIANT_WASP_XP = 22;

const AGGRO_TILES = 10;
const FOLLOW_STOP_RANGE_RATIO = 0.8;

const SPIT_RANGE_TILES = 6;
const SPIT_SPEED = 3.5;
const SPIT_DAMAGE = 2;
/** About 1.7 s between spits. */
const SPIT_COOLDOWN = 100;
const SPIT_TTL = 220;
/** How fast a splash fades once the spit has hit, in TTL per frame. */
const SPIT_HIT_FADE = 5;
/**
 * How long the wasp rears back before the acid launches. Exactly double the
 * `spit_windup` row's frame count in `src/sprites/art/giantWaspFigure.ts`:
 * each painted frame is held for two game ticks, so it reads as a wasp rearing
 * back rather than a hitch in the fight's pacing.
 */
const SPIT_WINDUP_FRAMES = 18;

/** Inside this distance the wasp stops spitting and closes in to sting. */
const GIANT_WASP_STING_RANGE_TILES = 2.5;
/** How close the stinger has to be to connect: the wasp's body against its target's. */
const STING_REACH_TILES = 1.2;
const GIANT_WASP_STING_DAMAGE = 2;
const GIANT_WASP_STING_POISON_CHANCE = 0.1;
/** About 1.5 s between stings. */
const STING_COOLDOWN = 90;
/** How many game ticks each painted frame of the sting row is held for. */
const STING_TICKS_PER_FRAME = 2;
const STING_ANIMATION_TICKS = STING_FRAMES * STING_TICKS_PER_FRAME;
/** The middle of the impact frame, so the damage lands while that frame is on screen. */
const STING_IMPACT_FRAME_MIDPOINT = 0.5;
const STING_IMPACT_PROGRESS = (STING_IMPACT_FRAME + STING_IMPACT_FRAME_MIDPOINT) / STING_FRAMES;

const CENTER_OFFSET = 0.5;
const PLAYER_HITBOX_RADIUS_RATIO = 0.52;

/** It flies above its tile, its head well ahead of the body in profile. */
const GIANT_WASP_EYES: EyePlacement = {
  sideForward: 0.3,
  sideHeight: 0.28,
  sideSpacing: 0.04,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: 0.12,
  frontSpacing: 0.1,
};

/** The blow a Giant Wasp lands: its sting up close, or its venom from range. */
export type GiantWaspBlow = 'sting' | 'spit';

interface AcidSpit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  hit: boolean;
  /** Frames elapsed since impact; drives the splash animation once `hit` is true. */
  hitAge: number;
}

/**
 * A dog-sized wasp that lives in small swarms where the floor-3 forest meets
 * open ground. It hovers at range and spits venom, and when something gets
 * close it closes the last gap and stings.
 */
export class GiantWasp extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return GIANT_WASP_EYES;
  }

  override get bodyPartKey(): string {
    return GIANT_WASP_BODY_PART_KEY;
  }

  /** It hovers clear of the ground a stomp shakes. */
  override get evadesSeismicStomp(): boolean {
    return true;
  }

  readonly xpValue = GIANT_WASP_XP;
  override readonly audioTag: CreatureAudioTag = 'giant_wasp';
  /**
   * Which of its blows raised the last attack sound: the sting, or a spit
   * reaching its target. Both go through the shared blow path and its one flag.
   */
  lastBlow: GiantWaspBlow = 'sting';
  displayName = 'Giant Wasp';
  description =
    'A wasp the size of a dog. It spits venom from the branches and stings anything that comes close.';

  private spitCooldown = 0;
  /** >0 while the wasp is rearing back before a spit; reaching 0 launches it. */
  private spitWindupTimer = 0;
  private stingCooldown = 0;
  /** >0 while the sting row plays; counts down from {@link STING_ANIMATION_TICKS}. */
  private stingTimer = 0;
  /** Set when a sting starts and cleared when it lands, so one sting deals one blow. */
  private stingDamagePending = false;
  /**
   * Whether this wasp has already warmed the eight pieces it comes apart into.
   * They are all drawn on the frame the body comes apart, with no telegraph of
   * their own, so the warming hangs off the wasp noticing something to fight.
   */
  private hasWarmedGore = false;

  readonly spits: AcidSpit[] = [];

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GIANT_WASP_HP, GIANT_WASP_SPEED);
    this.isFlying = true;
    prewarmGiantWasp();
  }

  override clearAirborneAttacks(): void {
    this.spits.length = 0;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    // In-flight acid outlives its owner: left in the list it keeps travelling
    // and chipping a party that was just rewound to the safe room.
    this.spits.length = 0;
    this.spitCooldown = 0;
    this.spitWindupTimer = 0;
    this.stingCooldown = 0;
    this.stingTimer = 0;
    this.stingDamagePending = false;
  }

  updateAI(playerTargets: Player[]): void {
    if (!this.isAlive) return;
    const ts = this.tileSize;

    if (this.spitCooldown > 0) this.spitCooldown--;
    if (this.stingCooldown > 0) this.stingCooldown--;
    this.advanceSpits(playerTargets);

    const nearest = this.acquireTarget(playerTargets, ts * AGGRO_TILES);
    this.currentTarget = nearest;
    if (nearest !== null && !this.hasWarmedGore) {
      this.hasWarmedGore = true;
      prewarmGiantWaspGore();
    }

    // A sting already under way plays out where it started, whoever moved.
    if (this.stingTimer > 0) {
      this.advanceSting(nearest);
      return;
    }

    if (nearest === null) {
      this.spitWindupTimer = 0;
      this.doWander();
      return;
    }

    this.updateLastKnown(nearest);
    const distance = this.distanceTo(nearest);

    if (this.spitWindupTimer > 0) {
      this.isMoving = false;
      this.faceToward(nearest);
      this.spitWindupTimer--;
      if (this.spitWindupTimer === 0) this.releaseAcidSpit(nearest);
      return;
    }

    if (distance <= ts * GIANT_WASP_STING_RANGE_TILES) {
      this.closeAndSting(nearest, distance);
      return;
    }

    this.keepRangeAndSpit(nearest, distance);
  }

  private closeAndSting(target: Player, distance: number): void {
    const reach = this.tileSize * STING_REACH_TILES;
    if (distance > reach) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        reach * FOLLOW_STOP_RANGE_RATIO,
      );
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
    if (this.stingCooldown > 0 || !(this.hasLOS(target) || this.onSameTile(target))) return;
    this.stingTimer = STING_ANIMATION_TICKS;
    this.stingDamagePending = true;
  }

  private advanceSting(target: Player | null): void {
    this.isMoving = false;
    this.stingTimer--;
    const progress = 1 - this.stingTimer / STING_ANIMATION_TICKS;
    if (this.stingDamagePending && progress >= STING_IMPACT_PROGRESS) {
      this.stingDamagePending = false;
      const inReach =
        target !== null && this.distanceTo(target) <= this.tileSize * STING_REACH_TILES;
      if (target !== null && inReach) {
        this.lastBlow = 'sting';
        const connected = this.dealDamage(target, GIANT_WASP_STING_DAMAGE, 'sting');
        if (connected && Math.random() < GIANT_WASP_STING_POISON_CHANCE) {
          target.applyStatus(makePoison(null));
        }
      }
    }
    if (this.stingTimer === 0) {
      this.stingCooldown = this.scaledCooldownFrames(STING_COOLDOWN);
    }
  }

  private keepRangeAndSpit(target: Player, distance: number): void {
    const spitRange = this.tileSize * SPIT_RANGE_TILES;
    if (distance > spitRange) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        spitRange * FOLLOW_STOP_RANGE_RATIO,
      );
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
    if (this.spitCooldown > 0 || !this.hasLOS(target)) return;
    this.spitWindupTimer = SPIT_WINDUP_FRAMES;
    this.spitCooldown = this.scaledCooldownFrames(SPIT_COOLDOWN);
    prewarmWaspSpit();
  }

  private advanceSpits(playerTargets: readonly Player[]): void {
    const ts = this.tileSize;
    for (const spit of this.spits) {
      if (spit.hit) {
        spit.ttl -= SPIT_HIT_FADE;
        spit.hitAge++;
        continue;
      }
      const tileX = Math.floor(spit.x / ts);
      const tileY = Math.floor(spit.y / ts);
      if (this.map && !this.map.isWalkable(tileX, tileY, this.mobility)) {
        spit.hit = true;
        continue;
      }
      spit.x += spit.vx;
      spit.y += spit.vy;
      spit.ttl--;

      for (const target of playerTargets) {
        if (!target.isAlive) continue;
        const cx = target.x + ts * CENTER_OFFSET;
        const cy = target.y + ts * CENTER_OFFSET;
        if (Math.hypot(spit.x - cx, spit.y - cy) >= ts * PLAYER_HITBOX_RADIUS_RATIO) continue;
        this.lastBlow = 'spit';
        this.dealRangedDamage(target, SPIT_DAMAGE, 'spit');
        spit.hit = true;
        break;
      }
    }
    for (let i = this.spits.length - 1; i >= 0; i--) {
      if (this.spits[i].ttl <= 0) this.spits.splice(i, 1);
    }
  }

  private releaseAcidSpit(target: Player): void {
    const ts = this.tileSize;
    const cx = this.x + ts * CENTER_OFFSET;
    const cy = this.y + ts * CENTER_OFFSET;
    const direction = normalize(
      target.x + ts * CENTER_OFFSET - cx,
      target.y + ts * CENTER_OFFSET - cy,
    );
    this.spits.push({
      x: cx,
      y: cy,
      vx: direction.x * SPIT_SPEED,
      vy: direction.y * SPIT_SPEED,
      ttl: SPIT_TTL,
      hit: false,
      hitAge: 0,
    });
    this.projectileSoundPending = true;
  }

  private drawSpits(ctx: CanvasRenderingContext2D, camX: number, camY: number, ts: number): void {
    for (const spit of this.spits) {
      drawAcidSpit(ctx, spit.x - camX, spit.y - camY, ts, spit.vx, spit.vy, spit.hit, spit.hitAge);
    }
  }

  override drawAboveDarkness(
    ctx: CanvasRenderingContext2D,
    part: ChromePart,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (part === 'acidSpits') this.drawSpits(ctx, camX, camY, tileSize);
    else super.drawAboveDarkness(ctx, part, camX, camY, tileSize);
  }

  /** Spit in flight lights the dark it crosses, as every other projectile does. */
  override collectLights(sink: DynamicLightSink): void {
    for (const spit of this.spits) {
      if (!spit.hit) sink.add(spit.x, spit.y, 'acid_spit');
    }
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

    // A spit in flight is a warning: it waits for the darkness to be drawn so
    // the dark never hides it, and draws behind the wasp otherwise.
    if (this.spits.length > 0 && !deferChrome(this, 'acidSpits', camX, camY, tileSize)) {
      this.drawSpits(ctx, camX, camY, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawGiantWaspSprite(ctx, sx, sy, tileSize, {
        facingX: this.facingX,
        facingY: this.facingY,
        spitWindupProgress:
          this.spitWindupTimer > 0 ? 1 - this.spitWindupTimer / SPIT_WINDUP_FRAMES : null,
        stingProgress: this.stingTimer > 0 ? 1 - this.stingTimer / STING_ANIMATION_TICKS : null,
      });
    });
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
