import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { Point } from '../map/roomDoorways';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { StatusEffect } from '../core/combat/StatusEffect';
import { timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { GoblinPassiveAnimator } from '../sprites/goblinSprite';
import {
  GOBLIN_GUARD_EYES,
  GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES,
  drawGoblinGateGuardSprite,
  drawGoblinGuardSprite,
  type GoblinGateGuardState,
  type GoblinGuardState,
} from '../sprites/goblinGuardSprite';
import { GOBLIN_GATE_GUARD_ROWS, GOBLIN_GUARD_ROWS } from '../sprites/art/goblinGuardFigure';
import { drawQuestBeacon } from '../sprites/questBeacon';
import { drawQuestMarker, QUEST_MARKER_GOLD } from '../sprites/questNPCSprite';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { worldPalette } from '../ui/theme/worldInk';
import type { BarkLine } from '../dialog/line';
import { PRISON_HIT_BARKS } from '../dialog/scripts/scenes/stealthKeySnatch';
import { pickFreshLine } from '../dialog/scripts/scenes/cloggedBathroom';
import { wrapAngle } from '../systems/stealthKeySnatch/detection';

/** Who a prison goblin is: the guard at the stealth gate, or a guard walking the prison. */
export type PrisonGoblinRole = 'gateGuard' | 'patrol';

/** Which glyph the gate guard wears over his head, if any. */
export type PrisonGoblinMarker = 'none' | 'exclamation' | 'question';

/**
 * The row a driver asks a patrol guard to show. `flinch` is never asked for:
 * a blow plays it over whatever the guard is doing.
 */
export type PrisonGuardActivity = Exclude<GoblinGuardState, 'flinch'>;

/** The row the gate guard shows while standing: `talk` while a conversation with him is open. */
export type GateGuardActivity = Extract<GoblinGateGuardState, 'idle' | 'talk'>;

/** A patrol guard's art pinned by its driver; see {@link PrisonGoblin.applyDrivenArt}. */
export interface DrivenGuardArt {
  readonly state: PrisonGuardActivity;
  readonly frame: number;
  /** +1 drawn facing right, -1 left. */
  readonly facingX: number;
}

/** A blow that reached a prison goblin: the centre of whoever threw it, and the weapon. */
export interface PrisonGoblinStrike {
  readonly fromX: number;
  readonly fromY: number;
  readonly damageType: PlayerDamageType;
}

/** One frame of a driven guard: where its body centre is, which way it faces, and what it is doing. */
export interface PrisonGoblinPose {
  /** Body centre, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = east, π/2 = south: the axis its flashlight points along. */
  readonly facing: number;
  readonly activity: PrisonGuardActivity;
}

/**
 * The HP handed to the base class. Nothing ever writes it: the goblin is
 * damage immune, and `hp` is here only so `isAlive` keeps it in the mob grid,
 * where the game's weapons find it and it can say "ow".
 */
const MINIMUM_LIVE_HP = 1;
/** The gate guard's pace when he stands aside, matching the floor's hostile goblins. */
const GATE_GUARD_WALK_SPEED = 1.4;
/** Frames a guard takes to turn half round: quick enough to read as a reaction, slow enough that a cone never snaps. */
const TURN_FRAMES_PER_HALF_TURN = 20;
/** How fast {@link PrisonGoblin.turnToward} swings a guard's facing, in radians per frame. */
export const PRISON_GOBLIN_TURN_RADIANS_PER_FRAME = Math.PI / TURN_FRAMES_PER_HALF_TURN;
/**
 * The band either side of straight up or down in which a turning guard keeps
 * the side he was drawn facing. The art is profile only, so without it a guard
 * looking along a corridor flips left-right on every wobble of his light.
 */
const PROFILE_FLIP_DEADBAND_RADIANS = 0.15;
const FRAMES_PER_SECOND = 60;
const SECONDS_PER_FRAME = 1 / FRAMES_PER_SECOND;
const MILLISECONDS_PER_SECOND = 1000;
const HALF = 0.5;
/** The guard figures overhang their tile like every goblin painter does. */
const PRISON_GOBLIN_CULL_MARGIN_TILES = 1.5;
/** Rate the guards' standing loops (idle, sweep, alert, talk) play at. */
const GUARD_LOOP_FPS = 8;

/** Frames between one guard's "ow" bubbles; a held attack key still flinches him every time. */
export const PRISON_OW_THROTTLE_FRAMES = 45;
/** How long an "ow", or any bark handed to {@link PrisonGoblin.bark}, stays over his head. */
const BARK_BUBBLE_FRAMES = 75;

const GATE_GUARD_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.gold,
  text: worldPalette.ink.bright,
};
const PATROL_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.danger,
  text: worldPalette.ink.bright,
};

function rowFrameCount(rows: ReadonlyArray<{ name: string; frameCount: number }>, name: string) {
  return rows.find((row) => row.name === name)?.frameCount ?? 1;
}

/**
 * A goblin of the Goblin High Security Prison: the gate guard who holds the
 * stealth gate's key quest, or a patrol guard with a baton and a flashlight.
 *
 * A `Mob` so the game's weapons find him and he flinches and says "ow", and so
 * the prison can tell when he was struck. Nothing the party does changes him:
 * - never hurt and never dies (`isDamageImmune`, `cannotBeKilled`), and every
 *   damage type reaches him (`admitsPlayerDamage`) so every blow lands in
 *   {@link onDamageBlocked} — the one place he reacts;
 * - nobody's enemy (`isHostile` false), so no companion, pet, hireling or
 *   homing shot picks him, and he never counts toward a room clear;
 * - pays for nothing: no XP, coin, loot, ability XP or proc;
 * - immovable: no Protective Shell shove, blast push, knockback, separation
 *   push, status (slow, stun, freeze, burn), root or confusion moves or holds
 *   him, so no ability can carry a guard out of a doorway.
 *
 * He does not decide where to go. The gate guard is placed by
 * `StealthKeySnatchSystem`, which may walk him aside with {@link walkRoute};
 * a patrol guard is driven every frame by the prison with {@link applyPose},
 * from the same deterministic patrol state its detection reads, so the guard
 * drawn and the guard that sees are one.
 */
export class PrisonGoblin extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;

  readonly role: PrisonGoblinRole;
  /** Fixes which of his lines he picks. */
  readonly seed: number;
  readonly speech = new TimedSpeech();

  /** The glyph over his head; only the gate guard ever wears one. */
  marker: PrisonGoblinMarker = 'none';
  /** What a patrol guard is doing; set by {@link applyPose}. */
  activity: PrisonGuardActivity = 'idle';
  /** What the gate guard shows while standing. */
  gateActivity: GateGuardActivity = 'idle';
  /** Set when he says "ow"; the owning system plays the cue and clears it. */
  owCuePending = false;
  /** How many "ow" barks he has said. */
  owBarks = 0;
  /**
   * The top of his drawn art in world pixels, measured on the last draw; NaN
   * before the first. For anything hung over him from outside (a suspicion
   * glyph drawn above the prison's darkness).
   */
  artTopWorldY = Number.NaN;

  /**
   * The row, frame and side a driver pins a patrol guard's art to, or null to
   * let his own clock animate him. The prison pins it to the same pure
   * function its cones are cast from, so the lamp drawn is the lens the light
   * leaves. A flinch still plays over it.
   */
  private drivenArt: DrivenGuardArt | null = null;

  private facingRadians = 0;
  private strikesUntaken = 0;
  private readonly animator: GoblinPassiveAnimator;
  private owThrottle = 0;
  private lastOw: BarkLine | null = null;
  private route: readonly Point[] = [];
  private routeIndex = 0;

  protected override get eyePlacement(): EyePlacement {
    return GOBLIN_GUARD_EYES;
  }

  /**
   * @param tileX,tileY the tile he starts on.
   * @param role which goblin he is.
   * @param seed fixes his line picks; any integer.
   */
  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    role: PrisonGoblinRole,
    seed: number,
  ) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, GATE_GUARD_WALK_SPEED);
    this.role = role;
    this.seed = seed;
    this.animator = new GoblinPassiveAnimator(GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES);
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
    this.displayName = role === 'gateGuard' ? 'Snorgle, Gate Guard' : 'Prison Guard';
    this.description =
      role === 'gateGuard'
        ? 'Guards the gate. Has the key ring. Does not have the key.'
        : 'Baton in one hand, flashlight in the other. Takes the job very seriously.';
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

  /** Crossing patrols walk through each other: their timelines, not bodies, decide where they go. */
  override get ignoresMobCollision(): boolean {
    return this.role === 'patrol';
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
    // Refused: nothing the party does may move or hold this goblin.
  }

  override applyStatus(_effect: StatusEffect): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override applyHitSlow(): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override applyHazardSlow(_frames: number): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override root(_frames: number, _source: object): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override get cullMarginTiles(): number {
    return PRISON_GOBLIN_CULL_MARGIN_TILES;
  }

  protected override get isDamageImmune(): boolean {
    return true;
  }

  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return true;
  }

  /**
   * Where the last blow that reached him came from and what it was, for the
   * prison to hear it from the right place; the prison reads and clears it.
   */
  lastStrike: PrisonGoblinStrike | null = null;

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (attacker !== null) {
      this.lastStrike = {
        fromX: attacker.x + this.tileSize * HALF,
        fromY: attacker.y + this.tileSize * HALF,
        damageType: damageType ?? 'melee',
      };
    }
    super.takeDamageFrom(amount, attacker, damageType);
  }

  protected override onDamageBlocked(): void {
    this.strikesUntaken++;
    this.animator.startFlinch();
    if (this.owThrottle > 0) return;
    this.owThrottle = PRISON_OW_THROTTLE_FRAMES;
    const pool = this.role === 'gateGuard' ? PRISON_HIT_BARKS.gateGuard : PRISON_HIT_BARKS.patrol;
    const line = pickFreshLine(pool, this.seed, this.owBarks, this.lastOw);
    this.lastOw = line;
    this.owBarks++;
    this.speech.say(line.paragraphs[0], { durationFrames: BARK_BUBBLE_FRAMES });
    this.owCuePending = true;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * How many blows have reached him since the last call, and resets the count.
   * The prison reads it each frame: a blow from a crawler a guard can see is
   * an instant catch.
   */
  takeStrikes(): number {
    const strikes = this.strikesUntaken;
    this.strikesUntaken = 0;
    return strikes;
  }

  /** Shows `line` in a bubble over his head. */
  bark(line: BarkLine): void {
    this.speech.say(line.paragraphs[0], { durationFrames: BARK_BUBBLE_FRAMES });
  }

  /**
   * Puts a driven patrol guard exactly where `pose` says, facing exactly its
   * way, for this frame. The facing is taken as given rather than eased,
   * because detection casts the cone from the same pose. When `grid` is given
   * he is moved in it; otherwise the caller must `grid.move` him.
   */
  applyPose(pose: PrisonGoblinPose, grid?: SpatialGrid<Mob>): void {
    const fromX = this.x;
    const fromY = this.y;
    this.x = pose.x - this.tileSize * HALF;
    this.y = pose.y - this.tileSize * HALF;
    const stride = Math.hypot(this.x - fromX, this.y - fromY);
    const walking = pose.activity === 'walk' && stride > 0;
    if (walking) this.recordOwnStride(stride);
    this.isMoving = walking;
    this.activity = pose.activity;
    this.setFacingAngle(pose.facing);
    if (grid !== undefined && (fromX !== this.x || fromY !== this.y)) {
      grid.move(this, fromX, fromY);
    }
  }

  /** Pins his art for this and later frames, after {@link applyPose}; null hands it back to his own clock. */
  applyDrivenArt(art: DrivenGuardArt | null): void {
    this.drivenArt = art;
    if (art !== null) this.facingX = art.facingX;
  }

  /** Snaps his facing to `radians`: for a reset, or a driver that eases the turn itself. */
  setFacingAngle(radians: number): void {
    this.facingRadians = wrapAngle(radians);
    this.syncProfileFacing();
  }

  /**
   * Swings his facing toward `radians` by at most
   * {@link PRISON_GOBLIN_TURN_RADIANS_PER_FRAME}; call once per frame. Returns
   * whether he is now facing it.
   */
  turnToward(radians: number): boolean {
    const remaining = wrapAngle(radians - this.facingRadians);
    if (Math.abs(remaining) <= PRISON_GOBLIN_TURN_RADIANS_PER_FRAME) {
      this.setFacingAngle(radians);
      return true;
    }
    this.setFacingAngle(
      this.facingRadians + Math.sign(remaining) * PRISON_GOBLIN_TURN_RADIANS_PER_FRAME,
    );
    return false;
  }

  /** Turns him toward the world point (`x`, `y`) at his turning pace. */
  turnTowardPoint(x: number, y: number): boolean {
    return this.turnToward(Math.atan2(y - this.centreY, x - this.centreX));
  }

  private syncProfileFacing(): void {
    const cos = Math.cos(this.facingRadians);
    const sin = Math.sin(this.facingRadians);
    this.facingY = Math.abs(sin) > HALF ? Math.sign(sin) : 0;
    const nearVertical = Math.abs(cos) < Math.sin(PROFILE_FLIP_DEADBAND_RADIANS);
    if (!nearVertical) this.facingX = Math.sign(cos);
  }

  /** Puts him on `tile` at once, standing still. The caller moves him in the mob grid. */
  placeAtTile(tile: Point): void {
    this.x = tile.x * this.tileSize;
    this.y = tile.y * this.tileSize;
    this.route = [];
    this.routeIndex = 0;
    this.isMoving = false;
  }

  /** Turns him toward `tile` at once. */
  faceTile(tile: Point): void {
    const dx = tile.x * this.tileSize - this.x;
    const dy = tile.y * this.tileSize - this.y;
    if (dx === 0 && dy === 0) return;
    this.setFacingAngle(Math.atan2(dy, dx));
  }

  /** Sets him walking through `tiles` in order with {@link stepRoute}; an empty list leaves him where he is. */
  walkRoute(tiles: readonly Point[]): void {
    this.route = tiles;
    this.routeIndex = 0;
  }

  get hasArrived(): boolean {
    return this.routeIndex >= this.route.length;
  }

  /**
   * One frame of walking his route at his own pace, straight at each
   * waypoint: the route must be a path that never crosses a wall. The caller
   * moves him in the mob grid.
   */
  stepRoute(): void {
    let budget = GATE_GUARD_WALK_SPEED;
    let moved = false;
    while (budget > 0 && this.routeIndex < this.route.length) {
      const waypoint = this.route[this.routeIndex];
      const dx = waypoint.x * this.tileSize - this.x;
      const dy = waypoint.y * this.tileSize - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        this.setFacingAngle(Math.atan2(dy, dx));
        moved = true;
      }
      if (distance <= budget) {
        this.x = waypoint.x * this.tileSize;
        this.y = waypoint.y * this.tileSize;
        this.recordOwnStride(distance);
        budget -= distance;
        this.routeIndex++;
      } else {
        this.x += (dx / distance) * budget;
        this.y += (dy / distance) * budget;
        this.recordOwnStride(budget);
        budget = 0;
      }
    }
    this.isMoving = moved;
  }

  /** His speech and "ow" throttle only: where he goes is set from outside. */
  updateAI(_targets: Player[]): void {
    this.speech.tick();
    if (this.owThrottle > 0) this.owThrottle--;
  }

  override tickTimers(): void {
    super.tickTimers();
    this.animator.tick(this.isMoving, false, SECONDS_PER_FRAME, this.ownStridePx);
  }

  private resolveGuardFrame(seconds: number): { state: GoblinGuardState; frame: number } {
    const passive = this.animator.resolvePassive(seconds, this.isMoving);
    if (passive.state === 'flinch') return { state: passive.state, frame: passive.frame };
    if (this.drivenArt !== null)
      return { state: this.drivenArt.state, frame: this.drivenArt.frame };
    if (passive.state === 'walk') return { state: passive.state, frame: passive.frame };
    const state = this.activity === 'walk' ? 'idle' : this.activity;
    const frames = rowFrameCount(GOBLIN_GUARD_ROWS, state);
    return { state, frame: timeFrameIndex(seconds, GUARD_LOOP_FPS, frames) };
  }

  private resolveGateGuardFrame(seconds: number): { state: GoblinGateGuardState; frame: number } {
    const passive = this.animator.resolvePassive(seconds, this.isMoving);
    if (passive.state === 'flinch' || passive.state === 'walk') {
      return { state: passive.state, frame: passive.frame };
    }
    const frames = rowFrameCount(GOBLIN_GATE_GUARD_ROWS, this.gateActivity);
    return { state: this.gateActivity, frame: timeFrameIndex(seconds, GUARD_LOOP_FPS, frames) };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const seconds = performance.now() / MILLISECONDS_PER_SECOND;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const showsMarker = this.marker !== 'none';
    if (showsMarker) {
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), QUEST_MARKER_GOLD);
    }
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      const place = { x: sx, y: sy, tileSize, facingX: this.facingX };
      if (this.role === 'gateGuard') {
        drawGoblinGateGuardSprite(ctx, { ...place, ...this.resolveGateGuardFrame(seconds) });
        return;
      }
      drawGoblinGuardSprite(ctx, { ...place, ...this.resolveGuardFrame(seconds) });
    });
    this.artTopWorldY = artTopY + camY;
    if (showsMarker) {
      const glyph = this.marker === 'question' ? '?' : '!';
      drawQuestMarker(ctx, sx, artTopY, tileSize, glyph, QUEST_MARKER_GOLD);
    }
    const style = this.role === 'gateGuard' ? GATE_GUARD_BUBBLE_STYLE : PATROL_BUBBLE_STYLE;
    drawTimedSpeechBubble(ctx, this.speech, sx + tileSize * HALF, artTopY, style);
  }
}
