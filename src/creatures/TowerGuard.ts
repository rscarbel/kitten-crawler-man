import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { Point } from '../map/roomDoorways';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { StatusEffect } from '../core/combat/StatusEffect';
import { gaitCyclesForDistance } from '../sprites/gaitCadence';
import { townCastLook, TOWER_GUARD_LOOK_IDS } from '../sprites/person/townCastLooks';
import {
  citizenWalkCyclePx,
  citizenWalkFrames,
  drawCitizenSprite,
  prewarmCitizenFigure,
  prewarmAndPinCitizenTalk,
  unpinCitizenTalk,
  type CitizenAction,
  type CitizenFigure,
} from './citizenFigure';
import { drawQuestMarker } from '../sprites/questNPCSprite';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { worldPalette } from '../ui/theme/worldInk';
import type { BarkLine } from '../dialog/line';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { TOWER_GUARD_HIT_BARKS } from '../dialog/scripts/scenes/towerDoor';
import { pickFreshLine } from '../dialog/scripts/scenes/cloggedBathroom';
import { wrapAngle } from '../systems/stealthKeySnatch/detection';

/** The row a driver asks a tower guard to show. `alert` stands as he stands, under a `!`. */
export type TowerGuardActivity = 'idle' | 'walk' | 'talk' | 'alert';

/** Which glyph a tower guard wears over his head, if any. */
export type TowerGuardMarker = 'none' | 'exclamation' | 'question';

/** One frame of a driven guard: where his body centre is, which way he faces, and what he is doing. */
export interface TowerGuardPose {
  /** Body centre, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = east, π/2 = south. */
  readonly facing: number;
  readonly activity: TowerGuardActivity;
}

/**
 * The HP handed to the base class. Nothing ever writes it: the guard is
 * damage immune, and `hp` is here only so `isAlive` keeps him in the mob
 * grid, where the game's weapons find him and he can say "ow".
 */
const MINIMUM_LIVE_HP = 1;
/** A guard's own walking pace, for anything that reads a mob's speed; his driver sets where he goes. */
const TOWER_GUARD_WALK_SPEED = 1.2;
const HALF = 0.5;
const FULL_TURN = 1;
const RADIANS_PER_CYCLE = Math.PI * 2;
/** The figure stands well above its tile, like every citizen of the cast. */
const TOWER_GUARD_CULL_MARGIN_TILES = 1.5;
/**
 * How far past the diagonal his facing must lean before the figure swaps
 * between its side view and its front or back view, so a facing that wobbles
 * across a diagonal never flips the view every frame.
 */
const VIEW_SWAP_DEADBAND = 0.15;

/** Frames between one guard's "ow" bubbles; a held attack key still lands every blow. */
const TOWER_GUARD_OW_THROTTLE_FRAMES = 45;
/** How long an "ow", or any bark handed to {@link TowerGuard.bark}, stays over his head. */
const BARK_BUBBLE_FRAMES = 75;

const TOWER_GUARD_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.secondary,
  text: worldPalette.ink.bright,
};
const MARKER_INK: Readonly<Record<Exclude<TowerGuardMarker, 'none'>, string>> = {
  exclamation: worldPalette.ink.danger,
  question: worldPalette.ink.gold,
};

/**
 * Where his eyes are, in tiles from his tile's top-left, measured off the
 * cast's standing rows at the size a citizen is drawn.
 */
const TOWER_GUARD_EYES: EyePlacement = {
  sideForward: 0.1,
  sideHeight: -0.32,
  sideSpacing: 0.04,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.33,
  frontSpacing: 0.07,
};

const CITIZEN_ACTION_FOR: Readonly<Record<TowerGuardActivity, CitizenAction>> = {
  idle: 'idle',
  walk: 'walk',
  talk: 'talk',
  alert: 'idle',
};

/** The tower-guard look `variant` wears; any integer picks one, so a pair can be given two. */
function towerGuardFigure(variant: number): CitizenFigure {
  const count = TOWER_GUARD_LOOK_IDS.length;
  const index = ((Math.trunc(variant) % count) + count) % count;
  const id = TOWER_GUARD_LOOK_IDS[index] ?? TOWER_GUARD_LOOK_IDS[0];
  return { species: 'human', look: townCastLook(id) };
}

/**
 * A guard of the Town Center Tower: a groundfolk man in the tower's livery,
 * posted at its door or walking its gatehouse.
 *
 * A `Mob` so the game's weapons find him and he says "ow", and so whoever
 * posts him can tell when he was struck. Nothing the party does changes him:
 * - never hurt and never dies (`isDamageImmune`, `cannotBeKilled`), and every
 *   damage type reaches him (`admitsPlayerDamage`) so every blow lands in
 *   {@link onDamageBlocked}, the one place he reacts;
 * - nobody's enemy (`isHostile` false), so no companion, pet, hireling or
 *   homing shot picks him, and he never counts toward a room clear;
 * - pays for nothing: no XP, coin, loot, ability XP or proc;
 * - immovable: no shove, knockback, separation push, status, root or
 *   confusion moves or holds him.
 *
 * He does not decide where to go: whoever posts him places him with
 * {@link placeAtTile} or drives him every frame with {@link applyPose}.
 */
export class TowerGuard extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Tower Guard';
  description = 'Has kept the tower for years. Has never seen the Warden up close.';

  readonly speech = new TimedSpeech();
  /** Fixes which of his "ow" lines he picks. */
  readonly seed: number;

  private readonly figure: CitizenFigure;
  private marker: TowerGuardMarker = 'none';
  private activity: TowerGuardActivity = 'idle';
  private facingRadians = Math.PI * HALF;
  private gaitPhase = 0;
  private strikesUntaken = 0;
  private owThrottle = 0;
  private owBarks = 0;
  private lastOw: BarkLine | null = null;
  /** His `talk` row, held baked for as long as he shows it; a crowd's rows never include it. */
  private pinnedTalk: DrawnFigureRow | null = null;

  protected override get eyePlacement(): EyePlacement {
    return TOWER_GUARD_EYES;
  }

  /**
   * @param tileX,tileY the tile he starts on.
   * @param lookVariant which of the tower-guard looks he wears, and which of his lines he picks; any integer.
   */
  constructor(tileX: number, tileY: number, tileSize: number, lookVariant: number) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, TOWER_GUARD_WALK_SPEED);
    this.seed = lookVariant;
    this.figure = towerGuardFigure(lookVariant);
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
    this.setFacingAngle(this.facingRadians);
    prewarmCitizenFigure(this.figure);
  }

  /** Which way he faces, in radians (0 = east, π/2 = south). */
  get facingAngle(): number {
    return this.facingRadians;
  }

  /** His body centre, in world pixels. */
  get centreX(): number {
    return this.x + this.tileSize * HALF;
  }

  get centreY(): number {
    return this.y + this.tileSize * HALF;
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

  override get separationAnchored(): boolean {
    return true;
  }

  protected override acceptsShove(_x: number, _y: number): boolean {
    return false;
  }

  override applyKnockback(
    _dirX: number,
    _dirY: number,
    _distancePx: number,
    _frames: number,
  ): void {
    // Refused: nothing the party does may move or hold a tower guard.
  }

  override applyStatus(_effect: StatusEffect): void {
    // Refused: nothing the party does may move or hold a tower guard.
  }

  override applyHitSlow(): void {
    // Refused: nothing the party does may move or hold a tower guard.
  }

  override applyHazardSlow(_frames: number): void {
    // Refused: nothing the party does may move or hold a tower guard.
  }

  override root(_frames: number, _source: object): void {
    // Refused: nothing the party does may move or hold a tower guard.
  }

  override get cullMarginTiles(): number {
    return TOWER_GUARD_CULL_MARGIN_TILES;
  }

  protected override get isDamageImmune(): boolean {
    return true;
  }

  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return true;
  }

  protected override onDamageBlocked(): void {
    this.strikesUntaken++;
    if (this.owThrottle > 0) return;
    this.owThrottle = TOWER_GUARD_OW_THROTTLE_FRAMES;
    const line = pickFreshLine(TOWER_GUARD_HIT_BARKS, this.seed, this.owBarks, this.lastOw);
    this.lastOw = line;
    this.owBarks++;
    this.bark(line);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /** How many blows have reached him since the last call, and resets the count. */
  takeStrikes(): number {
    const strikes = this.strikesUntaken;
    this.strikesUntaken = 0;
    return strikes;
  }

  /** Shows `line` in a bubble over his head. */
  bark(line: BarkLine): void {
    this.speech.say(line.paragraphs[0], { durationFrames: BARK_BUBBLE_FRAMES });
  }

  /** Puts `marker` over his head until it is changed. */
  setMarker(marker: TowerGuardMarker): void {
    this.marker = marker;
  }

  /** Shows `activity` until it is changed; `walk` only plays while he is moved. */
  setActivity(activity: TowerGuardActivity): void {
    if (activity === 'talk' && this.pinnedTalk === null) {
      this.pinnedTalk = prewarmAndPinCitizenTalk(this.figure, this.facingX, this.facingY);
    } else if (activity !== 'talk' && this.pinnedTalk !== null) {
      unpinCitizenTalk(this.pinnedTalk);
      this.pinnedTalk = null;
    }
    this.activity = activity;
  }

  /**
   * Puts a driven guard exactly where `pose` says, facing exactly its way,
   * for this frame. When `grid` is given he is moved in it; otherwise the
   * caller must `grid.move` him.
   */
  applyPose(pose: TowerGuardPose, grid?: SpatialGrid<Mob>): void {
    const fromX = this.x;
    const fromY = this.y;
    this.x = pose.x - this.tileSize * HALF;
    this.y = pose.y - this.tileSize * HALF;
    const stride = Math.hypot(this.x - fromX, this.y - fromY);
    const walking = pose.activity === 'walk' && stride > 0;
    if (walking) this.recordOwnStride(stride);
    this.isMoving = walking;
    this.setFacingAngle(pose.facing);
    this.setActivity(pose.activity);
    if (grid !== undefined && (fromX !== this.x || fromY !== this.y)) {
      grid.move(this, fromX, fromY);
    }
  }

  /** Snaps his facing to `radians`. */
  setFacingAngle(radians: number): void {
    this.facingRadians = wrapAngle(radians);
    this.syncViewFacing();
  }

  /** Turns him toward `tile` at once. */
  faceTile(tile: Point): void {
    const dx = tile.x * this.tileSize - this.x;
    const dy = tile.y * this.tileSize - this.y;
    if (dx === 0 && dy === 0) return;
    this.setFacingAngle(Math.atan2(dy, dx));
  }

  /**
   * The cast draws a side view or a front or back view: the axis his facing
   * leans along picks which, held through {@link VIEW_SWAP_DEADBAND} so a
   * diagonal facing does not flicker between the two.
   */
  private syncViewFacing(): void {
    const across = Math.cos(this.facingRadians);
    const down = Math.sin(this.facingRadians);
    const showingSide = this.facingY === 0;
    const lean = Math.abs(down) - Math.abs(across);
    const turnsToFront = showingSide ? lean > VIEW_SWAP_DEADBAND : lean > -VIEW_SWAP_DEADBAND;
    this.facingX = turnsToFront ? 0 : Math.sign(across);
    this.facingY = turnsToFront ? Math.sign(down) : 0;
  }

  /** Puts him on `tile` at once, standing still. The caller moves him in the mob grid. */
  placeAtTile(tile: Point): void {
    this.x = tile.x * this.tileSize;
    this.y = tile.y * this.tileSize;
    this.isMoving = false;
  }

  /** His speech and "ow" throttle only: where he goes is set from outside. */
  updateAI(_targets: Player[]): void {
    this.speech.tick();
    if (this.owThrottle > 0) this.owThrottle--;
  }

  override tickTimers(): void {
    super.tickTimers();
    const cyclePx = citizenWalkCyclePx(this.figure, this.tileSize);
    const turn = gaitCyclesForDistance(this.ownStridePx, cyclePx, citizenWalkFrames(this.figure));
    this.gaitPhase = (this.gaitPhase + turn) % FULL_TURN;
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
    const walking = this.activity === 'walk' && this.isMoving;
    const action: CitizenAction = walking ? 'walk' : CITIZEN_ACTION_FOR[this.activity];
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawCitizenSprite(ctx, this.figure, sx, sy, tileSize, {
        action,
        walkPhase: this.gaitPhase * RADIANS_PER_CYCLE,
        facingX: this.facingX,
        facingY: this.facingY,
        loopOffsetSeconds: this.seed,
      });
    });
    if (this.marker !== 'none') {
      const glyph = this.marker === 'question' ? '?' : '!';
      drawQuestMarker(ctx, sx, artTopY, tileSize, glyph, MARKER_INK[this.marker]);
    }
    drawTimedSpeechBubble(
      ctx,
      this.speech,
      sx + tileSize * HALF,
      artTopY,
      TOWER_GUARD_BUBBLE_STYLE,
    );
  }
}
