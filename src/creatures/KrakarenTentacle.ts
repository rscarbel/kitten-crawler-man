import type { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import {
  GUARD_TENTACLE_EMERGE_FRAMES,
  GUARD_TENTACLE_RETREAT_FRAMES,
  GUARD_TENTACLE_STRIKE_FRAMES,
  TENTACLE_STRIKE_IMPACT_PROGRESS,
} from '../sprites/krakarenAttackTiming';
import {
  KRAKAREN_TENTACLE_BODY_PART_KEY,
  drawKrakarenTentacleSprite,
  krakarenTentacleOverheadLiftTiles,
} from '../sprites/krakarenTentacleSprite';
import type { KrakarenClone } from './KrakarenClone';

const GUARD_TENTACLE_HP = 15;
/** It is rooted in the floor it came out of; nothing about it walks. */
const GUARD_TENTACLE_SPEED = 0;
const GUARD_TENTACLE_XP = 25;
const GUARD_TENTACLE_MASS = 4;

/**
 * How long the cracking floor shows before the tentacle is there at all.
 *
 * The spawn point is fixed when the boss requests it and this window never
 * revises it, which is what makes the mark a promise — thirty frames against
 * the 21-frame locked-telegraph floor in `docs/difficulty-fairness-rules.md`.
 */
export const TENTACLE_EMERGE_TELEGRAPH_FRAMES = 30;

const TENTACLE_STRIKE_RANGE_TILES = 1.6;
const TENTACLE_STRIKE_RANGE_PX = TILE_SIZE * TENTACLE_STRIKE_RANGE_TILES;

/**
 * Facing and the point the blow lands on are both frozen for this whole
 * window, so the whip is aimed where the player was when it reared rather than
 * where they are on the frame it connects. Twenty-five frames plus the frames
 * of the row before impact, again over the 21-frame floor.
 */
export const TENTACLE_STRIKE_WINDUP_FRAMES = 25;

/**
 * Flat, and never put through the level multiplier.
 *
 * Two damage from an add whose whole job is to be killed is pressure; the same
 * blow at a boss-room mob level is the fight's third damage source outscaling
 * the boss's own melee.
 */
const TENTACLE_STRIKE_DAMAGE = 2;

const TENTACLE_STRIKE_HIT_RADIUS_TILES = 1.0;
const TENTACLE_STRIKE_HIT_RADIUS_PX = TILE_SIZE * TENTACLE_STRIKE_HIT_RADIUS_TILES;
const TENTACLE_STRIKE_COOLDOWN_FRAMES = 90;

/** Fifteen seconds: an ignored tentacle stops guarding rather than guarding forever. */
export const GUARD_TENTACLE_TTL_FRAMES = 900;

/** How long the highlight lasts when the boss soaks a blow behind this tentacle. */
const GUARD_PULSE_FRAMES = 12;

/** Brightening at the peak of a guard pulse, as a `brightness()` filter amount. */
const GUARD_PULSE_PEAK_BRIGHTNESS = 1.9;
const GUARD_PULSE_BASE_BRIGHTNESS = 1;

const TENTACLE_DAMAGE_FLASH_FILTER = 'brightness(3)';

/** Game frames each cell of a one-shot row is held for. */
const FRAMES_PER_ANIMATION_CELL = 3;
const EMERGE_ANIMATION_FRAMES = GUARD_TENTACLE_EMERGE_FRAMES * FRAMES_PER_ANIMATION_CELL;
const STRIKE_ANIMATION_FRAMES = GUARD_TENTACLE_STRIKE_FRAMES * FRAMES_PER_ANIMATION_CELL;
const RETREAT_ANIMATION_FRAMES = GUARD_TENTACLE_RETREAT_FRAMES * FRAMES_PER_ANIMATION_CELL;

/** Covers the strike reach and the baked cell's overhang either side of the tile. */
const KRAKAREN_TENTACLE_CULL_MARGIN_TILES = 2;

/** Where to hang its health bar before the sheet has loaded, in tiles. */
const FALLBACK_OVERHEAD_LIFT_TILES = 1;

const CENTER_OFFSET = 0.5;
const SECONDS_PER_LOOP_OFFSET = 1;

// The cracking floor that stands in for the tentacle until it is there.
const TELEGRAPH_RING_RADIUS_TILES = 0.55;
const TELEGRAPH_RING_LINE_WIDTH = 2;
const TELEGRAPH_RING_COLOR = 'rgba(224, 80, 144, 0.85)';
const TELEGRAPH_FILL_COLOR = 'rgba(40, 8, 24, 0.5)';
const TELEGRAPH_CRACK_COUNT = 5;
const TELEGRAPH_CRACK_INNER_SHARE = 0.25;
const TELEGRAPH_PULSE_CYCLES = 3;
const TELEGRAPH_MIN_ALPHA = 0.4;
const TELEGRAPH_ALPHA_SWING = 0.6;
const FULL_TURN = Math.PI * 2;

type KrakarenTentacleState =
  'emerging' | 'idle' | 'strike_windup' | 'striking' | 'strike_cooldown' | 'retreating';

/**
 * A guard tentacle: the small, killable add the Krakaren Clone drags up out of
 * the floor beside whoever she is fighting.
 *
 * While one of these is alive the boss only takes a quarter of the damage aimed
 * at her (`KrakarenClone.incomingDamageScale`), so the fight's answer is to cut
 * them down rather than to keep swinging at the mantle.
 */
export class KrakarenTentacle extends Mob {
  readonly xpValue = GUARD_TENTACLE_XP;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  override readonly bodyPartKey = KRAKAREN_TENTACLE_BODY_PART_KEY;
  /**
   * Its own tag rather than the boss's `'krakaren'`: `dealPreScaledDamage`
   * raises `attackSoundPending` on every connecting strike, and sharing the
   * boss's tag would route that through her `krakaren_ground_slam` case in
   * `playMobAudioCues` — the tentacle's strike sound is a dedicated flag
   * instead (see {@link strikeSoundPending}).
   */
  override readonly audioTag = 'krakaren_tentacle';
  displayName = 'Guard Tentacle';
  description =
    "A thick tentacle rooted through the floor. While it lives, the Krakaren's hide holds.";
  mass = GUARD_TENTACLE_MASS;

  /** Frames until it gives up and pulls itself back under. Ticked by BossRoomSystem. */
  ttl = GUARD_TENTACLE_TTL_FRAMES;

  /**
   * The boss that pulled it up, or null for one staged outside a fight.
   *
   * Read only to ask whether she is still standing: her guard tentacles leave
   * with her, and the reference points from the short-lived mob at the
   * long-lived one rather than the other way round, so nothing here can pin a
   * corpse the roster would otherwise drop.
   */
  readonly owner: KrakarenClone | null;

  private state: KrakarenTentacleState = 'emerging';
  private telegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
  private phaseTimer = EMERGE_ANIMATION_FRAMES;
  private strikeCooldownTimer = 0;
  private strikeDamagePending = false;
  private strikePointX = 0;
  private strikePointY = 0;
  private facingLocked = false;

  /** Raised the frame the telegraph ends and the emerge row itself begins. */
  emergeSoundPending = false;
  /** Raised on the strike's damage frame, whether or not it connects. */
  strikeSoundPending = false;

  /**
   * Frames left of the "that blow went into me" highlight, poked by the boss
   * whenever a hit is scaled down behind this tentacle.
   */
  private guardPulseTimer = 0;

  /**
   * True once the retreat row has played out. A despawn is not a death, so the
   * HP hitting zero here must not be mistaken for one — this is the terminal
   * phase that stops the retreat from restarting and stops anything reading
   * `isAlive` from re-latching a kill that never happened.
   */
  private retreatComplete = false;

  /** Keeps two tentacles from swaying in lockstep. */
  private readonly loopOffsetSeconds = Math.random() * SECONDS_PER_LOOP_OFFSET;

  constructor(tileX: number, tileY: number, tileSize: number, owner: KrakarenClone | null = null) {
    super(tileX, tileY, tileSize, GUARD_TENTACLE_HP, GUARD_TENTACLE_SPEED);
    this.owner = owner;
  }

  /** Rooted in the floor: the separation shove must not slide it off its crack. */
  protected override moveWithCollision(_dx: number, _dy: number): void {
    // No-op: immobile add.
  }

  override get cullMarginTiles(): number {
    return KRAKAREN_TENTACLE_CULL_MARGIN_TILES;
  }

  /** True while it is still underground and only the floor telegraph is showing. */
  get isUnderground(): boolean {
    return this.state === 'emerging' && this.telegraphTimer > 0;
  }

  /**
   * Nothing to hit yet. It is not in the room during the telegraph — it is a
   * crack in the floor — and a blow that landed on it would be a hit on a mob
   * the player cannot see.
   */
  protected override get isDamageImmune(): boolean {
    return this.isUnderground;
  }

  /** True once it has been counted out and is only playing its exit. */
  get isLeaving(): boolean {
    return this.state === 'retreating';
  }

  /** Whether this tentacle still counts towards the boss's guard. */
  get isGuarding(): boolean {
    return this.isAlive && !this.isLeaving;
  }

  /** Called by the boss on the frame a blow of hers was scaled down. */
  flashGuardPulse(): void {
    this.guardPulseTimer = GUARD_PULSE_FRAMES;
  }

  /**
   * Sends it back under: TTL expiry, or its owner falling. Killed tentacles do
   * not come through here — they burst into gore, which is the whole read of
   * having cut one down.
   */
  beginRetreat(): void {
    if (!this.isAlive || this.state === 'retreating') return;
    this.state = 'retreating';
    this.phaseTimer = RETREAT_ANIMATION_FRAMES;
    this.strikeDamagePending = false;
    this.facingLocked = false;
  }

  protected override clearEncounterPhase(): void {
    this.state = 'emerging';
    this.telegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
    this.phaseTimer = EMERGE_ANIMATION_FRAMES;
    this.strikeCooldownTimer = 0;
    this.strikeDamagePending = false;
    this.facingLocked = false;
    this.guardPulseTimer = 0;
    this.retreatComplete = false;
    this.ttl = GUARD_TENTACLE_TTL_FRAMES;
    this.emergeSoundPending = false;
    this.strikeSoundPending = false;
  }

  override tickTimers(): void {
    super.tickTimers();
    // Outside `updateAI` so the highlight still burns down while a fog has the
    // tentacle confused — a pulse frozen mid-fight reads as a permanent glow.
    if (this.guardPulseTimer > 0) this.guardPulseTimer--;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    switch (this.state) {
      case 'emerging':
        this.doEmerging();
        break;
      case 'idle':
        this.doIdle(targets);
        break;
      case 'strike_windup':
        this.doStrikeWindup();
        break;
      case 'striking':
        this.doStriking(targets);
        break;
      case 'strike_cooldown':
        this.doStrikeCooldown();
        break;
      case 'retreating':
        this.doRetreating();
        break;
    }
  }

  private doEmerging(): void {
    if (this.telegraphTimer > 0) {
      this.telegraphTimer--;
      if (this.telegraphTimer === 0) this.emergeSoundPending = true;
      return;
    }
    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      this.state = 'idle';
    }
  }

  private doIdle(targets: Player[]): void {
    if (this.strikeCooldownTimer > 0) this.strikeCooldownTimer--;

    const nearest = this.acquireTarget(targets, TENTACLE_STRIKE_RANGE_PX);
    this.currentTarget = nearest;
    if (nearest === null) return;

    this.faceToward(nearest);
    if (this.strikeCooldownTimer > 0) return;
    this.startStrikeWindup(nearest);
  }

  /**
   * The blow commits here. Both the facing the row is picked from and the point
   * the damage is measured against are taken now and never revised, so the
   * reared tentacle is a statement about the tile it is going to hit.
   */
  private startStrikeWindup(target: Player): void {
    this.state = 'strike_windup';
    this.phaseTimer = TENTACLE_STRIKE_WINDUP_FRAMES;
    this.strikePointX = target.x + this.tileSize * CENTER_OFFSET;
    this.strikePointY = target.y + this.tileSize * CENTER_OFFSET;
    this.faceToward(target);
    this.facingLocked = true;
  }

  private doStrikeWindup(): void {
    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      this.state = 'striking';
      this.phaseTimer = STRIKE_ANIMATION_FRAMES;
      this.strikeDamagePending = true;
    }
  }

  private doStriking(targets: Player[]): void {
    this.phaseTimer--;
    const progress = 1 - this.phaseTimer / STRIKE_ANIMATION_FRAMES;
    if (this.strikeDamagePending && progress >= TENTACLE_STRIKE_IMPACT_PROGRESS) {
      this.strikeDamagePending = false;
      this.strikeSoundPending = true;
      this.resolveStrike(targets);
    }
    if (this.phaseTimer <= 0) {
      this.state = 'strike_cooldown';
      this.strikeCooldownTimer = TENTACLE_STRIKE_COOLDOWN_FRAMES;
      this.facingLocked = false;
    }
  }

  /**
   * Whoever is standing on the marked ground when the whip lands, rather than
   * whoever it was aimed at: the point is fixed, so stepping off it is the
   * counterplay and stepping onto it is the mistake.
   */
  private resolveStrike(targets: Player[]): void {
    for (const target of targets) {
      if (!target.isAlive) continue;
      const dx = target.x + this.tileSize * CENTER_OFFSET - this.strikePointX;
      const dy = target.y + this.tileSize * CENTER_OFFSET - this.strikePointY;
      if (Math.hypot(dx, dy) > TENTACLE_STRIKE_HIT_RADIUS_PX) continue;
      this.dealPreScaledDamage(target, TENTACLE_STRIKE_DAMAGE, 'tentacle_strike');
    }
  }

  private doStrikeCooldown(): void {
    this.strikeCooldownTimer--;
    if (this.strikeCooldownTimer <= 0) this.state = 'idle';
  }

  private doRetreating(): void {
    this.phaseTimer--;
    if (this.phaseTimer > 0 || this.retreatComplete) return;
    // Zeroed without `justDied`, the same way a spent cockroach leaves: nothing
    // killed it, so there is no gore, no XP and no kill credit — the boss-room
    // compaction pass drops it from the roster on the next frame.
    this.retreatComplete = true;
    this.hp = 0;
  }

  /**
   * The strike row is chosen off facing, so a tentacle that kept turning
   * through its wind-up would whip in a direction it only settled on at the
   * moment of impact. Committed at the wind-up and held to it.
   */
  protected override faceToward(target: { readonly x: number; readonly y: number }): void {
    if (this.facingLocked) return;
    super.faceToward(target);
  }

  /** 0–1 through the emerge row, or null when it is not hauling itself out. */
  private get emergeProgress(): number | null {
    if (this.state !== 'emerging' || this.telegraphTimer > 0) return null;
    return 1 - this.phaseTimer / EMERGE_ANIMATION_FRAMES;
  }

  private get strikeProgress(): number | null {
    if (this.state !== 'striking') return null;
    return 1 - this.phaseTimer / STRIKE_ANIMATION_FRAMES;
  }

  private get retreatProgress(): number | null {
    if (this.state !== 'retreating') return null;
    return 1 - this.phaseTimer / RETREAT_ANIMATION_FRAMES;
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

    if (this.isUnderground) {
      this.drawEmergeTelegraph(ctx, sx, sy, tileSize);
      return;
    }

    ctx.save();
    // A landed blow outranks the guard highlight: the player needs to see their
    // own hit land on the thing they have finally decided to attack.
    if (this.damageFlash > 0) {
      ctx.filter = TENTACLE_DAMAGE_FLASH_FILTER;
    } else if (this.guardPulseTimer > 0) {
      const pulse = this.guardPulseTimer / GUARD_PULSE_FRAMES;
      const brightness =
        GUARD_PULSE_BASE_BRIGHTNESS +
        (GUARD_PULSE_PEAK_BRIGHTNESS - GUARD_PULSE_BASE_BRIGHTNESS) * pulse;
      ctx.filter = `brightness(${brightness})`;
    }

    drawKrakarenTentacleSprite(ctx, sx, sy, tileSize, {
      facingX: this.facingX,
      facingY: this.facingY,
      emergeProgress: this.emergeProgress,
      strikeProgress: this.strikeProgress,
      retreatProgress: this.retreatProgress,
      loopOffsetSeconds: this.loopOffsetSeconds,
    });

    ctx.restore();

    this.renderMobHealthBar(
      ctx,
      sx,
      sy - tileSize * krakarenTentacleOverheadLiftTiles(FALLBACK_OVERHEAD_LIFT_TILES),
    );
  }

  /**
   * The floor breaking open where it is about to come up. Drawn from this mob
   * rather than by a system because it marks this mob's own tile — unlike the
   * boss's slam, whose mark can be twelve tiles from her.
   */
  private drawEmergeTelegraph(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const progress = 1 - this.telegraphTimer / TENTACLE_EMERGE_TELEGRAPH_FRAMES;
    const centreX = sx + tileSize * CENTER_OFFSET;
    const centreY = sy + tileSize * CENTER_OFFSET;
    const radius = tileSize * TELEGRAPH_RING_RADIUS_TILES;
    const pulse = Math.abs(Math.sin(progress * Math.PI * TELEGRAPH_PULSE_CYCLES));

    ctx.save();
    ctx.globalAlpha = TELEGRAPH_MIN_ALPHA + TELEGRAPH_ALPHA_SWING * pulse;
    ctx.fillStyle = TELEGRAPH_FILL_COLOR;
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
    ctx.fill();

    ctx.strokeStyle = TELEGRAPH_RING_COLOR;
    ctx.lineWidth = TELEGRAPH_RING_LINE_WIDTH;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < TELEGRAPH_CRACK_COUNT; i++) {
      const angle = (i / TELEGRAPH_CRACK_COUNT) * FULL_TURN;
      const inner = radius * TELEGRAPH_CRACK_INNER_SHARE;
      ctx.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
      ctx.lineTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
    }
    ctx.stroke();
    ctx.restore();
  }
}
