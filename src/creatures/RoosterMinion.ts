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

const AGGRO_RANGE_TILES = 8;
/** He walks in to this share of his longest reach, so either blow lands from where he stops. */
const FOLLOW_STOP_FRACTION = 0.85;
const TILE_CENTER = 0.5;
/** Shell XP per blocked peck or punch. */
const STRIKE_BLOCK_XP = 3;

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

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < previousHp && this.hp > 0) this.soundCues.raise('hurt');
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.animationClock.tick(this.x, this.y, this.tileSize, false);
    this.walkFrameSpeed = this.animationClock.walkRadians;
    if (this.animationClock.footfall) this.soundCues.raise('step');
    this.strikes.update(this.strikeBody(), targets);

    const nearest = this.acquireTarget(targets, this.tileSize * AGGRO_RANGE_TILES);
    this.currentTarget = nearest;
    if (this.strikes.current !== null) {
      this.isMoving = false;
      return;
    }
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
        // The party's shell turns aside an enemy's blow, never a turned ally's.
        const shelled =
          !this.isConverted &&
          this.spells?.isPointInsideShell(
            target.x + this.tileSize * TILE_CENTER,
            target.y + this.tileSize * TILE_CENTER,
          ) === true;
        if (shelled && this.spells !== null) {
          this.spells.addBlockXp(STRIKE_BLOCK_XP);
          return;
        }
        this.dealDamage(target, spec.damage, spec.attackType);
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
        punchProgress: strike === 'punch' ? strikeProgress : null,
        isDamageFlashing: this.damageFlash > 0,
        idleSeconds: this.animationClock.idleSeconds,
      });
    });
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
