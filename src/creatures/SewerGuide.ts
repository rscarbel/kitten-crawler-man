import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { StatusEffect } from '../core/combat/StatusEffect';
import { ELF_TILES_PER_WALK_CYCLE, drawElfSprite, prewarmElf } from '../sprites/elfSprite';
import { WALK_FRAMES } from '../sprites/art/human/timing';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { worldPalette } from '../ui/theme/worldInk';
import type { BarkLine, NonEmpty } from '../dialog/line';
import { pickLine } from '../dialog/line';
import type { TilePoint } from '../map/town/townPlan';
import { itemAt } from '../map/sewer/sewerPlan';

/**
 * How the guide keeps ahead of the party: it walks on to its next stop only
 * while someone is close behind, and stops and calls back once they are
 * further off than `breakTiles`, until they come within `resumeTiles` again.
 * The same latched band an escorted animal keeps behind its leader, turned
 * round to lead.
 */
export interface SewerGuideLeadBand {
  readonly breakTiles: number;
  readonly resumeTiles: number;
  /** Walking pace, in pixels per update. */
  readonly speed: number;
  /** How far one path search reaches. */
  readonly pathBudgetTiles: number;
}

/** A crawler's pace is 2.5: the guide walks a little slower, so the party never has to wait on it. */
const GUIDE_SPEED = 1.6;
const GUIDE_BREAK_TILES = 9;
const GUIDE_RESUME_TILES = 5;
const GUIDE_PATH_BUDGET_TILES = 60;

const SEWER_GUIDE_LEAD_BAND: SewerGuideLeadBand = {
  breakTiles: GUIDE_BREAK_TILES,
  resumeTiles: GUIDE_RESUME_TILES,
  speed: GUIDE_SPEED,
  pathBudgetTiles: GUIDE_PATH_BUDGET_TILES,
};

const MINIMUM_LIVE_HP = 1;
const UPDATES_PER_SECOND = 60;
const HALF = 0.5;
/** Close enough to a stop to count as standing on it, in pixels. */
const STOP_REACHED_PX = 4;
/** A stop's line stays up this long. */
const STOP_LINE_SECONDS = 6;
/** A call back to a straggling party stays up this long, and is repeated no more often than this. */
const WAITING_LINE_SECONDS = 2.5;
const WAITING_CALL_GAP_SECONDS = 7;
/** A grumble at a blow is made no more often than this. */
const HURT_LINE_GAP_SECONDS = 3;
const TWO_PI = Math.PI * 2;
/** The walk is advanced by the ground covered, capped at one sprite frame per tick, as an elf's is. */
const MAX_GAIT_RADIANS_PER_FRAME = TWO_PI / WALK_FRAMES;

const GUIDE_EYES: EyePlacement = {
  sideForward: 0.06,
  sideHeight: -0.36,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.3,
  frontSpacing: 0.08,
};

const GUIDE_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.hint,
  text: worldPalette.ink.bright,
};

function seconds(value: number): number {
  return Math.round(value * UPDATES_PER_SECOND);
}

/** What the guide asks of the place it is guiding through. */
export interface SewerGuideRoute {
  /** The stops, in walking order. */
  readonly stops: ReadonlyArray<TilePoint>;
  /** Whether the guide may leave stop `index` for the next one: its way on is open. */
  readonly mayLeave: (index: number) => boolean;
  /** The line it says on reaching stop `index`, or null to say nothing there. */
  readonly lineAt: (index: number) => BarkLine | null;
  readonly waitingLines: NonEmpty<BarkLine>;
  readonly hurtLines: NonEmpty<BarkLine>;
}

/**
 * An elf from the lodge cellar leading the party through the sewer: it walks
 * from stop to stop ahead of them, says what lies ahead at each, holds at a
 * stop until the way on is open, and waits for anyone who falls behind.
 *
 * Nobody's enemy and nobody's target. It cannot be hurt down — a blow only
 * draws a word — and it never blocks the party: a crawler walks through it.
 */
export class SewerGuide extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Cellar elf';
  description = 'An elf from the lodge cellar who knows the drains under the town.';

  readonly speech = new TimedSpeech();
  /** The stop it is standing at or walking to. */
  private stopIndex = 0;
  private walking = false;
  private waitingForParty = false;
  private waitingCallCooldown = 0;
  private hurtCooldown = 0;
  private lastHp: number;
  private gaitSampleX: number;
  private gaitSampleY: number;
  private announcedStop = -1;

  protected override get eyePlacement(): EyePlacement {
    return GUIDE_EYES;
  }

  constructor(
    tile: TilePoint,
    tileSize: number,
    private readonly route: SewerGuideRoute,
    private readonly band: SewerGuideLeadBand = SEWER_GUIDE_LEAD_BAND,
  ) {
    super(tile.x, tile.y, tileSize, MINIMUM_LIVE_HP, band.speed);
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
    this.pathDistanceBudgetTiles = band.pathBudgetTiles;
    this.lastHp = this.hp;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    prewarmElf();
  }

  /** The stop the guide stands at or is walking to. */
  get currentStop(): number {
    return this.stopIndex;
  }

  /** Whether it has reached its last stop and will go no further. */
  get atJourneyEnd(): boolean {
    return this.stopIndex >= this.route.stops.length - 1 && !this.walking;
  }

  /** Stands the guide straight at stop `index`, as a section rebuilt mid-journey does. */
  placeAtStop(index: number): void {
    const stop = itemAt(this.route.stops, index);
    if (stop === undefined) return;
    this.stopIndex = index;
    this.x = stop.x * this.tileSize;
    this.y = stop.y * this.tileSize;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.walking = false;
    this.announcedStop = index;
    this.clearAStarPath();
  }

  /** Says `line` over its head now, as the section does when the water obeys. */
  say(line: BarkLine): void {
    this.speech.say(line.paragraphs[0], { durationFrames: seconds(STOP_LINE_SECONDS) });
  }

  override get isHostile(): boolean {
    return false;
  }

  override get isPetAttackable(): boolean {
    return false;
  }

  override get countsTowardRoomClear(): boolean {
    return false;
  }

  override canBeConverted(): boolean {
    return false;
  }

  override get blowsEarnNothing(): boolean {
    return true;
  }

  override get acceptsWards(): boolean {
    return false;
  }

  override get ignoresMobCollision(): boolean {
    return true;
  }

  override get displacesPlayers(): boolean {
    return false;
  }

  override applyStatus(_effect: StatusEffect): void {
    // Refused: the guide is not in the fight.
  }

  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /** Thinks wherever it is: it leads from ahead, often further off than the party's activation radius. */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  updateAI(targets: Player[]): void {
    this.speech.tick();
    this.syncGaitToDistanceCovered();
    if (this.waitingCallCooldown > 0) this.waitingCallCooldown--;
    if (this.hurtCooldown > 0) this.hurtCooldown--;
    this.noteBlows();

    const nearestTiles = this.nearestCrawlerTiles(targets);
    if (this.walking) {
      this.walkOn(nearestTiles);
      return;
    }
    this.isMoving = false;
    this.announceArrival();
    const nextStop = this.stopIndex + 1;
    if (nextStop >= this.route.stops.length) return;
    if (!this.route.mayLeave(this.stopIndex)) return;
    if (nearestTiles > this.band.resumeTiles) return;
    this.stopIndex = nextStop;
    this.walking = true;
    this.waitingForParty = false;
  }

  private announceArrival(): void {
    if (this.announcedStop === this.stopIndex) return;
    this.announcedStop = this.stopIndex;
    const line = this.route.lineAt(this.stopIndex);
    if (line !== null) this.say(line);
  }

  private walkOn(nearestTiles: number): void {
    if (this.waitingForParty) {
      if (nearestTiles > this.band.resumeTiles) {
        this.isMoving = false;
        this.callBack();
        return;
      }
      this.waitingForParty = false;
    } else if (nearestTiles > this.band.breakTiles) {
      this.waitingForParty = true;
      this.isMoving = false;
      this.clearAStarPath();
      this.callBack();
      return;
    }
    const stop = itemAt(this.route.stops, this.stopIndex);
    if (stop === undefined) {
      this.walking = false;
      return;
    }
    const goalX = stop.x * this.tileSize;
    const goalY = stop.y * this.tileSize;
    if (Math.hypot(goalX - this.x, goalY - this.y) <= STOP_REACHED_PX) {
      this.walking = false;
      this.isMoving = false;
      this.clearAStarPath();
      return;
    }
    this.followTargetAStar(goalX, goalY, this.band.speed, 0);
  }

  private callBack(): void {
    if (this.waitingCallCooldown > 0) return;
    this.waitingCallCooldown = seconds(WAITING_CALL_GAP_SECONDS);
    const line = pickLine(this.route.waitingLines, this.stopIndex);
    this.speech.say(line.paragraphs[0], { durationFrames: seconds(WAITING_LINE_SECONDS) });
  }

  /** A blow that landed anyway — a blast, a stray shot — draws a word and nothing more. */
  private noteBlows(): void {
    if (this.hp < this.lastHp && this.hurtCooldown === 0) {
      this.hurtCooldown = seconds(HURT_LINE_GAP_SECONDS);
      const line = pickLine(this.route.hurtLines, this.stopIndex);
      this.speech.say(line.paragraphs[0], { durationFrames: seconds(WAITING_LINE_SECONDS) });
    }
    this.hp = this.maxHp;
    this.lastHp = this.hp;
  }

  private nearestCrawlerTiles(targets: readonly Player[]): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const crawler of targets) {
      if (!crawler.isAlive) continue;
      nearest = Math.min(nearest, Math.hypot(crawler.x - this.x, crawler.y - this.y));
    }
    return nearest / this.tileSize;
  }

  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    const radiansPerPixel = TWO_PI / (ELF_TILES_PER_WALK_CYCLE * this.tileSize);
    this.walkFrameSpeed = Math.min(coveredPx * radiansPerPixel, MAX_GAIT_RADIANS_PER_FRAME);
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
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawElfSprite(
        ctx,
        sx,
        sy,
        tileSize,
        this.walkFrame,
        this.isMoving,
        0,
        this.facingX,
        this.facingY,
      );
    });
    drawTimedSpeechBubble(ctx, this.speech, sx + tileSize * HALF, artTopY, GUIDE_BUBBLE_STYLE);
  }
}
