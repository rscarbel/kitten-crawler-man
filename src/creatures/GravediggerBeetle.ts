import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { LootDrop } from './Mob';
import { randomInt } from '../utils';
import type { CreatureAudioTag } from '../audio/creatureAudioTags';
import {
  GRAVEDIGGER_BEETLE_BODY_PART_KEY,
  drawGravediggerBeetleSprite,
  drawGravediggerLarvaSprite,
  drawGravediggerPupaSprite,
  prewarmGravediggerBeetle,
  prewarmGravediggerBeetleGore,
  prewarmGravediggerPupa,
} from '../sprites/gravediggerBeetleSprite';
import {
  BITE_FRAMES,
  BITE_IMPACT_FRAME,
  GRAVEDIGGER_BEETLE_EYES,
  PUPA_HATCH_FRAMES,
} from '../sprites/art/gravediggerBeetleFigure';
import {
  GRAVEDIGGER_SPIT_FRAMES,
  gravediggerSpitReleaseFrame,
} from '../sprites/gravediggerBeetleSpitTiming';
import { prewarmFireball } from '../sprites/fireballSprite';
import { type GlobShooter, type GlobShot, NO_GLOB_SHOTS } from '../systems/globShot';

/** The three stages of the line, in the order one grows into the next. */
export type BeetleStage = 'larva' | 'pupa' | 'adult';

interface BeetleStageSpec {
  readonly name: string;
  readonly description: string;
  readonly hp: number;
  readonly speed: number;
  readonly xp: number;
  /** Class name the death screen and the kill tally read. */
  readonly mobType: string;
  readonly flies: boolean;
}

/**
 * Every stage's authored numbers. The adult is an elite met only on floor 2,
 * at the level of whatever died to spawn it, so its HP is tuned for a crawler
 * who never bought damage to still outlast it there.
 */
const BEETLE_STAGES = {
  larva: {
    name: 'Larva',
    description: 'A pale, blind grub feeding on the dead. Leave it long enough and it will pupate.',
    hp: 4,
    speed: 0.3,
    xp: 0,
    mobType: 'GravediggerLarva',
    flies: false,
  },
  pupa: {
    name: 'Beetle Pupa',
    description: 'A taut, twitching egg sac. Something with mandibles is pushing at the inside.',
    hp: 10,
    speed: 0,
    xp: 2,
    mobType: 'GravediggerPupa',
    flies: false,
  },
  adult: {
    name: 'Gravedigger Beetle',
    description:
      'A hard-shelled carrion beetle with mandibles like shears. It flies, it bites, and from a distance it spits fire.',
    hp: 20,
    speed: 1.55,
    xp: 22,
    mobType: 'GravediggerBeetle',
    flies: true,
  },
} as const satisfies Record<BeetleStage, BeetleStageSpec>;

/** A larva pupates after 10–25 seconds (at 60 fps). */
const LARVA_MIN_FRAMES = 600;
const LARVA_MAX_FRAMES = 1500;
/** A pupa hatches after 5–8 seconds. */
const PUPA_MIN_FRAMES = 300;
const PUPA_MAX_FRAMES = 480;

/**
 * How long before a change of stage the next stage's rows are warmed.
 *
 * A change of stage is a spawn with a clock on it: the animal becomes a whole
 * different build between one frame and the next, and the first thing that
 * asks for that build is the frame it is drawn on. A second of lead turns a
 * cold row into a warm one, well inside the cache's idle release window.
 */
const STAGE_PREWARM_LEAD_FRAMES = 60;

/** How many game ticks each painted frame of the hatch is held for. */
const HATCH_TICKS_PER_FRAME = 3;
/** The last stretch of a pupa's life, which plays the sac splitting open. */
const HATCH_TICKS = PUPA_HATCH_FRAMES * HATCH_TICKS_PER_FRAME;
/** Radians of pulse a sealed pupa advances per tick when it has just sealed, and just before it hatches. */
const PUPA_PULSE_RATE_START = 0.06;
const PUPA_PULSE_RATE_END = 0.3;

const AGGRO_TILES = 10;
const FOLLOW_STOP_RANGE_RATIO = 0.8;
/** Inside this distance the adult stops spitting and closes in to bite. */
const GRAVEDIGGER_FIREBALL_MIN_RANGE_TILES = 2.5;
/** The Acid Llama's spit range, so floor 2's two ranged throwers reach the same distance. */
const GRAVEDIGGER_FIREBALL_MAX_RANGE_TILES = 5.5;
/** How close the mandibles have to be to connect: the beetle's body against its target's. */
const GRAVEDIGGER_BITE_RANGE_TILES = 1.2;
const GRAVEDIGGER_BITE_DAMAGE = 2;
/** About 1.3 s between bites. */
const BITE_COOLDOWN = 80;
const BITE_TICKS_PER_FRAME = 2;
const BITE_ANIMATION_TICKS = BITE_FRAMES * BITE_TICKS_PER_FRAME;
/** The middle of the impact frame, so the damage lands while that frame is on screen. */
const BITE_IMPACT_FRAME_MIDPOINT = 0.5;
const BITE_IMPACT_PROGRESS = (BITE_IMPACT_FRAME + BITE_IMPACT_FRAME_MIDPOINT) / BITE_FRAMES;
const GRAVEDIGGER_FIREBALL_DAMAGE = 2;
/** About 2.5 s between fireballs, the llama's own cadence. */
const FIREBALL_COOLDOWN = 150;
/** The value `spitTimer` holds on the release frame; it counts down. */
const SPIT_RELEASE_TIMER = GRAVEDIGGER_SPIT_FRAMES - gravediggerSpitReleaseFrame();
const CENTER_OFFSET = 0.5;
/** Where the fireball leaves the jaws, ahead of the body's centre along its facing. */
const MOUTH_FORWARD_TILES = 0.35;

/**
 * The Gravedigger Beetle's whole life, one mob that changes body as it grows.
 * It hatches out of the dead on floor 2 as a harmless larva, seals itself into
 * a pupa that can be killed to end the line, and hatches into a flying carrion
 * beetle that bites up close, spits fire from range, and attacks other mobs as
 * readily as the party (attacked mobs retaliate).
 */
export class GravediggerBeetle extends Mob implements GlobShooter {
  stage: BeetleStage = 'larva';

  private get spec(): BeetleStageSpec {
    return BEETLE_STAGES[this.stage];
  }

  get isAdult(): boolean {
    return this.stage === 'adult';
  }

  protected override get eyePlacement(): EyePlacement | null {
    return this.isAdult ? GRAVEDIGGER_BEETLE_EYES : null;
  }

  override readonly audioTag: CreatureAudioTag = 'gravedigger_beetle';

  /** Knee-high on the ground, so a crawler kicks or stomps it rather than punching. */
  override get lowProfile(): boolean {
    return !this.spec.flies;
  }

  /** The adult hovers clear of the ground a stomp shakes; the larva and pupa lie on it. */
  override get evadesSeismicStomp(): boolean {
    return this.spec.flies;
  }

  /**
   * A larva or pupa is litter from the last kill and never holds a room "in
   * combat"; a hatched beetle is a real fight, so it does.
   */
  override get countsTowardRoomClear(): boolean {
    return this.isAdult && super.countsTowardRoomClear;
  }

  /**
   * No stage takes an ordinary ward: a shield fairy that warded a larva would
   * spend a ward slot on litter, and warding an adult would make the one thing
   * that hunts the other monsters untouchable. An adult is still eligible for
   * the fairy's separate crushing ward, which is not `acceptsWards` at all.
   */
  override get acceptsWards(): boolean {
    return false;
  }

  /** The adult picks fights with the nearest mob as readily as with the party; the young hunt nothing. */
  override get huntsOtherMobs(): boolean {
    return this.isAdult;
  }

  override get mobType(): string {
    return this.spec.mobType;
  }

  get xpValue(): number {
    return this.spec.xp;
  }

  /** The larva and the pupa are soft and leave only the generic gore burst. */
  override get bodyPartKey(): string | null {
    return this.isAdult ? GRAVEDIGGER_BEETLE_BODY_PART_KEY : null;
  }

  override get globShooter(): GlobShooter {
    return this;
  }

  /** Frames until the next change of stage; unused once adult. */
  private stageTimer: number;
  /** A sealed pupa's pulse phase, radians; it quickens toward the hatch. */
  private pupaPulsePhase = 0;
  private biteCooldown = 0;
  /** >0 while the bite row plays; counts down from {@link BITE_ANIMATION_TICKS}. */
  private biteTimer = 0;
  /** Set when a bite starts and cleared when it lands, so one bite deals one blow. */
  private biteDamagePending = false;
  private fireballCooldown = 0;
  /** >0 while the spit row plays; counts down from {@link GRAVEDIGGER_SPIT_FRAMES}. */
  private spitTimer = 0;
  /**
   * Whether this adult has already warmed the pieces it comes apart into.
   * They are all drawn on the frame the body comes apart, with no telegraph of
   * their own, so the warming hangs off the beetle noticing something to fight.
   */
  private hasWarmedGore = false;
  /**
   * Shots fired but not yet handed to `GlobProjectileSystem`, which drains this
   * every frame. The beetle never owns a fireball in flight: it stops being
   * updated the instant it dies, and a projectile stored here would vanish.
   */
  private pendingGlobs: GlobShot[] = [];

  /**
   * Populated each frame by `MobUpdateLoop` so the adult can find mob targets
   * as well as the party.
   */
  allMobs: readonly Mob[] = [];

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BEETLE_STAGES.larva.hp, BEETLE_STAGES.larva.speed);
    this.stageTimer = randomInt(LARVA_MIN_FRAMES, LARVA_MAX_FRAMES);
    this.displayName = BEETLE_STAGES.larva.name;
    this.description = BEETLE_STAGES.larva.description;
  }

  override clearAirborneAttacks(): void {
    this.pendingGlobs = [];
  }

  /**
   * The stage is deliberately left alone.
   *
   * Every checkpoint restore calls this on living mobs too, so rewinding the
   * stage would turn every beetle on the floor back into a larva on each death
   * — a strictly easier encounter, repeatable by dying on purpose. The stage
   * is driven by time rather than by the fight.
   */
  override resetToSpawn(): void {
    super.resetToSpawn();
    this.pendingGlobs = [];
    this.biteCooldown = 0;
    this.biteTimer = 0;
    this.biteDamagePending = false;
    this.fireballCooldown = 0;
    this.spitTimer = 0;
  }

  takePendingGlobs(): readonly GlobShot[] {
    if (this.pendingGlobs.length === 0) return NO_GLOB_SHOTS;
    const globs = this.pendingGlobs;
    this.pendingGlobs = [];
    return globs;
  }

  /** The line drops nothing but, very rarely, the book on eating anything. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'glutton');
    return items;
  }

  private enterStage(stage: BeetleStage): void {
    this.stage = stage;
    const spec = BEETLE_STAGES[stage];
    // Through the base-* setters, not by assignment: a new stage is a new set
    // of authored stats, and a plain write would throw away the level this
    // beetle inherited from whatever it burst out of.
    this.setBaseSpeed(spec.speed);
    this.setBaseMaxHp(spec.hp);
    this.hp = this.maxHp;
    this.isFlying = spec.flies;
    this.isMoving = false;
    this.displayName = spec.name;
    this.description = spec.description;
  }

  /** The pupa's remaining life as a 0–1 progress toward its hatch. */
  private pupaHatchProgress(): number {
    return this.stageTimer <= HATCH_TICKS ? 1 - this.stageTimer / HATCH_TICKS : 0;
  }

  /**
   * Ticks the growth clock regardless of whether the beetle is in the active
   * AI radius, so a larva left behind still grows. Called every frame for
   * every living beetle by `MobUpdateLoop`.
   */
  tickEvolve(): void {
    if (!this.isAlive || this.isAdult) return;
    this.stageTimer--;
    if (this.stage === 'pupa') {
      const sealedShare = 1 - this.stageTimer / PUPA_MAX_FRAMES;
      this.pupaPulsePhase +=
        PUPA_PULSE_RATE_START + (PUPA_PULSE_RATE_END - PUPA_PULSE_RATE_START) * sealedShare;
    }
    if (this.stageTimer === STAGE_PREWARM_LEAD_FRAMES) this.prewarmNextStage();
    if (this.stageTimer > 0) return;
    if (this.stage === 'larva') {
      this.enterStage('pupa');
      this.stageTimer = randomInt(PUPA_MIN_FRAMES, PUPA_MAX_FRAMES);
      this.pupaPulsePhase = 0;
    } else {
      this.enterStage('adult');
      this.specialSoundPending = true;
    }
  }

  /** Warms the build this beetle is about to turn into, a second before it does. */
  private prewarmNextStage(): void {
    if (this.stage === 'larva') prewarmGravediggerPupa();
    else prewarmGravediggerBeetle();
  }

  updateAI(playerTargets: Player[]): void {
    if (!this.isAlive) return;
    switch (this.stage) {
      case 'larva':
        // Growth is ticked by tickEvolve() separately, so it continues off-screen.
        this.currentTarget = null;
        this.doWander();
        return;
      case 'pupa':
        this.currentTarget = null;
        this.isMoving = false;
        return;
      case 'adult':
        this.updateAdultAI(playerTargets);
        return;
      default: {
        const unreachable: never = this.stage;
        return unreachable;
      }
    }
  }

  /** The party plus every other living mob in reach, which the adult hunts as readily. */
  private candidateTargets(playerTargets: readonly Player[]): Player[] {
    const reach = this.tileSize * AGGRO_TILES;
    const mobs = this.allMobs.filter(
      (mob) =>
        mob !== this &&
        mob.isAlive &&
        !(mob instanceof GravediggerBeetle) &&
        Math.hypot(mob.x - this.x, mob.y - this.y) < reach,
    );
    return [...playerTargets, ...mobs];
  }

  private updateAdultAI(playerTargets: readonly Player[]): void {
    if (this.biteCooldown > 0) this.biteCooldown--;
    if (this.fireballCooldown > 0) this.fireballCooldown--;

    const nearest = this.acquireTarget(
      this.candidateTargets(playerTargets),
      this.tileSize * AGGRO_TILES,
    );
    this.currentTarget = nearest;
    if (nearest !== null && !this.hasWarmedGore) {
      this.hasWarmedGore = true;
      prewarmGravediggerBeetleGore();
    }

    // A bite or a spit under way plays out where it started: the wind-up is
    // the player's warning, and abandoning it mid-way would make it a lie.
    if (this.biteTimer > 0) {
      this.advanceBite(nearest);
      return;
    }
    if (this.spitTimer > 0) {
      this.advanceSpit(nearest);
      return;
    }

    if (nearest === null) {
      this.doWander();
      return;
    }

    this.updateLastKnown(nearest);
    const distance = this.distanceTo(nearest);
    if (distance <= this.tileSize * GRAVEDIGGER_FIREBALL_MIN_RANGE_TILES) {
      this.closeAndBite(nearest, distance);
      return;
    }
    this.keepRangeAndSpit(nearest, distance);
  }

  private closeAndBite(target: Player, distance: number): void {
    const reach = this.tileSize * GRAVEDIGGER_BITE_RANGE_TILES;
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
    if (this.biteCooldown > 0 || !(this.hasLOS(target) || this.onSameTile(target))) return;
    this.biteTimer = BITE_ANIMATION_TICKS;
    this.biteDamagePending = true;
  }

  private advanceBite(target: Player | null): void {
    this.isMoving = false;
    this.biteTimer--;
    const progress = 1 - this.biteTimer / BITE_ANIMATION_TICKS;
    if (this.biteDamagePending && progress >= BITE_IMPACT_PROGRESS) {
      this.biteDamagePending = false;
      const inReach =
        target !== null && this.distanceTo(target) <= this.tileSize * GRAVEDIGGER_BITE_RANGE_TILES;
      if (target !== null && inReach) this.bite(target);
    }
    if (this.biteTimer === 0) this.biteCooldown = this.scaledCooldownFrames(BITE_COOLDOWN);
  }

  private bite(target: Player): void {
    if (target instanceof Mob) {
      target.takeDamageFrom(this.scaledDamage(GRAVEDIGGER_BITE_DAMAGE), this, null);
      this.attackSoundPending = true;
      if (target.isAlive) target.retaliateMob = this;
      return;
    }
    this.dealDamage(target, GRAVEDIGGER_BITE_DAMAGE, 'bite');
  }

  private keepRangeAndSpit(target: Player, distance: number): void {
    const spitRange = this.tileSize * GRAVEDIGGER_FIREBALL_MAX_RANGE_TILES;
    if (distance > spitRange || !this.hasLOS(target)) {
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
    if (this.fireballCooldown > 0) return;
    this.spitTimer = GRAVEDIGGER_SPIT_FRAMES;
    this.fireballCooldown = this.scaledCooldownFrames(FIREBALL_COOLDOWN);
    prewarmFireball();
  }

  private advanceSpit(target: Player | null): void {
    this.isMoving = false;
    this.spitTimer--;
    // It keeps tracking until it commits, so a target that simply walks round
    // it is not fired at where it used to be.
    if (this.spitTimer > SPIT_RELEASE_TIMER && target !== null) this.faceToward(target);
    if (this.spitTimer === SPIT_RELEASE_TIMER) this.releaseFireball(target);
  }

  /** Where the fireball leaves the jaws, offset along the facing. */
  private mouthPosition(): { readonly x: number; readonly y: number } {
    const ts = this.tileSize;
    return {
      x: this.x + ts * (CENTER_OFFSET + this.facingX * MOUTH_FORWARD_TILES),
      y: this.y + ts * (CENTER_OFFSET + this.facingY * MOUTH_FORWARD_TILES),
    };
  }

  /**
   * Queues one fireball, aimed at wherever the target is on the release frame
   * rather than where it was when the wind-up began.
   */
  private releaseFireball(target: Player | null): void {
    const mouth = this.mouthPosition();
    const ts = this.tileSize;
    const aimX = target !== null ? target.x + ts * CENTER_OFFSET : mouth.x + this.facingX;
    const aimY = target !== null ? target.y + ts * CENTER_OFFSET : mouth.y + this.facingY;
    const dirX = aimX - mouth.x;
    const dirY = aimY - mouth.y;
    // A target exactly on the mouth would give a zero direction, which
    // normalises to NaN and makes a fireball that never moves or expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingGlobs.push({
      kind: 'fireball',
      x: mouth.x,
      y: mouth.y,
      dirX: degenerate ? this.facingX || 1 : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(GRAVEDIGGER_FIREBALL_DAMAGE),
      mobType: this.mobType,
      mobLevel: this.mobLevel,
      // A mob target is one the glob system would not otherwise know to hit.
      aimedAt: target,
    });
    // The fireball system has no notion of mob feuds, so the mob being shot at
    // turns on the beetle here, the moment the shot is fired its way.
    if (target instanceof Mob && target.isAlive) target.retaliateMob = this;
    this.projectileSoundPending = true;
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

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      this.drawStageSprite(ctx, sx, sy, tileSize);
    });
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }

  private drawStageSprite(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    switch (this.stage) {
      case 'larva':
        drawGravediggerLarvaSprite(ctx, sx, sy, tileSize, {
          walkFrame: this.walkFrame,
          isMoving: this.isMoving,
          facingX: this.facingX,
          facingY: this.facingY,
        });
        return;
      case 'pupa': {
        const hatch = this.pupaHatchProgress();
        drawGravediggerPupaSprite(
          ctx,
          sx,
          sy,
          tileSize,
          hatch > 0
            ? { kind: 'hatch', progress: hatch }
            : { kind: 'pulse', phase: this.pupaPulsePhase },
        );
        return;
      }
      case 'adult':
        drawGravediggerBeetleSprite(ctx, sx, sy, tileSize, {
          facingX: this.facingX,
          facingY: this.facingY,
          biteProgress: this.biteTimer > 0 ? 1 - this.biteTimer / BITE_ANIMATION_TICKS : null,
          spitProgress: this.spitTimer > 0 ? 1 - this.spitTimer / GRAVEDIGGER_SPIT_FRAMES : null,
        });
        return;
      default: {
        const unreachable: never = this.stage;
        return unreachable;
      }
    }
  }
}
