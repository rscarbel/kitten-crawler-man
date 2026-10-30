import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob, type PlayerDamageType } from './Mob';
import { SoundCueQueue, type RoosterSoundCue } from './creatureSoundCues';
import {
  drawRoosterSprite,
  prewarmRoosterRow,
  ROOSTER_BODY_PART_KEYS,
  ROOSTER_GORE_PARTS,
  RoosterAnimationClock,
  roosterArtMarginTiles,
  roosterEyePlacement,
  type RoosterBuild,
} from '../sprites/roosterSprite';
import { ROOSTER_FIGURES } from '../sprites/art/roosterFigure';
import { prewarmFigureState } from '../sprites/figure/figureFrameCache';
import { roosterIdleOffsetSeconds } from './roosterIdleOffset';
import {
  ROOSTER_STRIKE_MAX_REACH_TILES,
  RoosterStrikes,
  type RoosterStrikeBody,
  type RoosterStrikeKind,
} from './roosterStrikes';
import { kickExplosive, liveExplosives } from './explosiveAwareness';
import {
  DYNAMITE_KICK_CONTACT_TILES,
  DYNAMITE_KICK_COOLDOWN_FRAMES,
  DYNAMITE_SEEK_GIVE_UP_FRAMES,
  RoosterKickMotion,
  dynamiteKickVelocity,
  stickNow,
  stickToKick,
  type RoosterFlockView,
} from './roosterKicks';
import type { LiveStickId } from '../systems/ExplosiveSource';

const AGGRO_RANGE_TILES = 8;
/** He walks in to this share of his longest reach, so either blow lands from where he stops. */
const FOLLOW_STOP_FRACTION = 0.85;
const TILE_CENTER = 0.5;
/** Energy Shield XP per blocked peck or punch. */
const STRIKE_BLOCK_XP = 3;
/**
 * What the flock's blows land harder by than Big Rooster's own peck and punch,
 * which they share: the flock guards a boss at the top of floor 2's curve.
 */
const FLOCK_STRIKE_DAMAGE_BONUS = 1;
/** How fast a minion runs to a stick it means to kick, as a share over his walk. */
const DYNAMITE_SEEK_SPEED_MULTIPLIER = 1.5;

/** The painted builds the flock is drawn from: every rooster but Big Rooster himself. */
type RoosterMinionArt = Exclude<RoosterBuild, 'big'>;

/** Everything one rooster in the flock differs by. */
export interface RoosterMinionBuild {
  readonly maxHp: number;
  readonly speed: number;
  readonly xpValue: number;
  /** Of the blows he chooses, the share that are pecks rather than punches. */
  readonly peckShare: number;
  readonly art: RoosterMinionArt;
}

/** The rows a minion walks up to the gym door in, warmed when his spawn is scheduled. */
export function prewarmRoosterMinionArrival(art: RoosterMinionArt): void {
  prewarmRoosterRow(art, 'idle');
  prewarmRoosterRow(art, 'walk');
}

/**
 * His blows and the pieces he comes apart into, warmed the first time he
 * notices a crawler. His cells take milliseconds each to paint and the cache
 * lets an undrawn row go under memory pressure, so warming these at spawn would
 * see them gone by the time anyone reached the door.
 */
function prewarmRoosterMinionFight(art: RoosterMinionArt): void {
  prewarmRoosterRow(art, 'peck');
  prewarmRoosterRow(art, 'punch');
  for (const part of ROOSTER_GORE_PARTS) prewarmFigureState(ROOSTER_FIGURES[art], part);
}

/**
 * A rooster of Big Rooster's flock: a gateway guard that fights only with its
 * beak and fists, through the strikes every rooster shares. It never goes near
 * a dumbbell rack and has no slam.
 */
export abstract class RoosterMinion extends Mob {
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  readonly xpValue: number;

  private readonly strikes = new RoosterStrikes();
  private readonly soundCues = new SoundCueQueue<RoosterSoundCue>();
  /** Whether this encounter has warmed his fight rows yet. */
  private fightRowsWarmed = false;
  private readonly kick = new RoosterKickMotion();
  /** The stick he is walking to or kicking. */
  private stickTarget: LiveStickId | null = null;
  private stickSeekFrames = 0;
  private dynamiteKickCooldown = 0;
  /** The gym as every rooster sees it, or null outside the gym; set each frame by the gym. */
  flockView: RoosterFlockView | null = null;
  private readonly animationClock: RoosterAnimationClock;

  protected constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    protected readonly build: RoosterMinionBuild,
  ) {
    super(tileX, tileY, tileSize, build.maxHp, build.speed);
    this.xpValue = build.xpValue;
    this.animationClock = new RoosterAnimationClock(
      build.art,
      this.x,
      this.y,
      roosterIdleOffsetSeconds(tileX, tileY),
    );
  }

  protected override get eyePlacement(): EyePlacement {
    return roosterEyePlacement(this.build.art);
  }

  override get bodyPartKey(): string {
    return ROOSTER_BODY_PART_KEYS[this.build.art];
  }

  /** His comb and tail reach past his tile, so the default margin would pop him in at the screen edge. */
  override get cullMarginTiles(): number {
    return roosterArtMarginTiles(this.build.art);
  }

  /** Which blow he is winding up and the aim it locked, or null outside a wind-up. */
  get strikeWindupAim(): {
    readonly kind: RoosterStrikeKind;
    readonly x: number;
    readonly y: number;
  } | null {
    return this.strikes.windupAim;
  }

  protected override clearEncounterPhase(): void {
    this.strikes.reset();
    this.kick.reset();
    this.stickTarget = null;
    this.stickSeekFrames = 0;
    this.dynamiteKickCooldown = 0;
    this.fightRowsWarmed = false;
    this.soundCues.clear();
  }

  /** Which painted build he is, for the scene to pick his voice by. */
  get roosterBuild(): RoosterMinionArt {
    return this.build.art;
  }

  /** The sounds he asked for since the last call, emptied by the call. */
  takeSoundCues(): readonly RoosterSoundCue[] {
    return this.soundCues.take();
  }

  protected override receiveDamage(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null,
  ): void {
    const previousHp = this.hp;
    super.receiveDamage(amount, attacker, damageType);
    if (this.hp < previousHp && this.hp > 0) this.soundCues.raise('hurt');
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.animationClock.tick(this.x, this.y, this.tileSize, false);
    this.walkFrameSpeed = this.animationClock.walkRadians;
    if (this.animationClock.footfall) this.soundCues.raise('step');
    this.strikes.update(this.strikeBody(), targets);
    if (this.dynamiteKickCooldown > 0) this.dynamiteKickCooldown--;

    const nearest = this.acquireTarget(targets, this.tileSize * AGGRO_RANGE_TILES);
    this.currentTarget = nearest;
    if (this.strikes.current !== null) {
      this.isMoving = false;
      return;
    }
    if (this.updateDynamiteKick()) return;
    if (nearest === null) {
      this.returnHomeOrWander();
      return;
    }

    if (!this.fightRowsWarmed) {
      prewarmRoosterMinionFight(this.build.art);
      this.fightRowsWarmed = true;
      this.soundCues.raise('notice');
    }
    this.updateLastKnown(nearest);
    const distance = this.distanceTo(nearest);
    const kind = this.chooseStrike(distance);
    if (kind !== null && this.hasLOS(nearest)) {
      this.isMoving = false;
      this.clearAStarPath();
      this.faceToward(nearest);
      prewarmRoosterRow(this.build.art, kind);
      this.strikes.begin(kind, this.facingX, this.facingY);
      this.soundCues.raise('effort');
      return;
    }

    const stopRange = this.tileSize * ROOSTER_STRIKE_MAX_REACH_TILES * FOLLOW_STOP_FRACTION;
    this.followTargetAStar(this.lastKnownTargetX, this.lastKnownTargetY, this.speed, stopRange);
    if (!this.isMoving) this.faceToward(nearest);
  }

  /**
   * Walks to a landed stick of the party's dynamite near him and kicks it,
   * the way Big Rooster does. Returns whether that is what he did this frame.
   */
  private updateDynamiteKick(): boolean {
    if (this.kick.active) {
      this.isMoving = false;
      if (this.kick.tick() === 'impact') this.kickStickNow();
      return true;
    }
    const half = this.tileSize * TILE_CENTER;
    const view = this.flockView;
    if (this.stickTarget === null) {
      if (view === null || this.dynamiteKickCooldown > 0) return false;
      const found = stickToKick(this.x + half, this.y + half, liveExplosives());
      if (found === null) return false;
      this.stickTarget = found.id;
      this.stickSeekFrames = 0;
    }
    const id = this.stickTarget;
    const stick = stickNow(id, liveExplosives());
    this.stickSeekFrames++;
    if (stick === null || this.stickSeekFrames > DYNAMITE_SEEK_GIVE_UP_FRAMES) {
      this.stickTarget = null;
      this.dynamiteKickCooldown = DYNAMITE_KICK_COOLDOWN_FRAMES;
      return false;
    }
    const distance = Math.hypot(stick.x - (this.x + half), stick.y - (this.y + half));
    if (distance <= this.tileSize * DYNAMITE_KICK_CONTACT_TILES) {
      this.isMoving = false;
      this.clearAStarPath();
      this.faceToward({ x: stick.x - half, y: stick.y - half });
      prewarmRoosterRow(this.build.art, 'punch');
      this.kick.begin();
      this.soundCues.raise('effort');
      return true;
    }
    this.followTargetAStar(
      stick.x - half,
      stick.y - half,
      this.speed * DYNAMITE_SEEK_SPEED_MULTIPLIER,
      this.tileSize * DYNAMITE_KICK_CONTACT_TILES,
    );
    return true;
  }

  private kickStickNow(): void {
    const id = this.stickTarget;
    const stick = id === null ? null : stickNow(id, liveExplosives());
    const view = this.flockView;
    if (stick !== null && view !== null) {
      kickExplosive(stick.id, dynamiteKickVelocity(stick, view));
      this.soundCues.raise('kick');
    }
    this.stickTarget = null;
    this.dynamiteKickCooldown = DYNAMITE_KICK_COOLDOWN_FRAMES;
  }

  /** The blow he favours if it is ready and in reach, else the other one, else none. */
  private chooseStrike(distance: number): RoosterStrikeKind | null {
    const preferred: RoosterStrikeKind = Math.random() < this.build.peckShare ? 'peck' : 'punch';
    const other: RoosterStrikeKind = preferred === 'peck' ? 'punch' : 'peck';
    if (this.strikes.canReach(preferred, distance, this.tileSize)) return preferred;
    if (this.strikes.canReach(other, distance, this.tileSize)) return other;
    return null;
  }

  private strikeBody(): RoosterStrikeBody {
    return {
      x: this.x,
      y: this.y,
      tileSize: this.tileSize,
      land: (target, spec) => {
        // The party's energy shield turns aside an enemy's blow, never a turned ally's.
        const shielded =
          !this.isConverted &&
          this.spells?.isPointInsideEnergyShield(
            target.x + this.tileSize * TILE_CENTER,
            target.y + this.tileSize * TILE_CENTER,
          ) === true;
        if (shielded && this.spells !== null) {
          this.spells.addBlockXp(STRIKE_BLOCK_XP);
          return;
        }
        this.dealDamage(target, spec.damage + FLOCK_STRIKE_DAMAGE_BONUS, spec.attackType);
      },
      scaledCooldown: (baseFrames) => this.scaledCooldownFrames(baseFrames),
      impact: (kind) => {
        this.soundCues.raise(kind === 'peck' ? 'peck' : 'swing');
      },
    };
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
    const strike = this.strikes.current;
    const strikeProgress = this.strikes.progress;
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawRoosterSprite(ctx, this.build.art, sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        isMoving: this.isMoving,
        facingX: this.facingX,
        facingY: this.facingY,
        peckProgress: strike === 'peck' ? strikeProgress : null,
        punchProgress: strike === 'punch' ? strikeProgress : this.kick.progress,
        isDamageFlashing: this.damageFlash > 0,
        idleSeconds: this.animationClock.idleSeconds,
      });
    });
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
