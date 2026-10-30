import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { Point } from '../map/roomDoorways';
import { GOBLIN_EYES } from './Goblin';
import {
  type GoblinPassiveAnimator,
  bathroomGoblinAnimator,
  drawGoblinPlumberSprite,
  drawGoblinSprite,
  type GoblinArchetype,
} from '../sprites/goblinSprite';
import type { NpcQuestMarker } from '../sprites/npcQuestMarker';
import { IconAnchor, drawOverheadIcon, drawOverheadIconBeacon } from '../sprites/overheadIcon';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { worldPalette } from '../ui/theme/worldInk';
import type { BarkLine } from '../dialog/line';
import { BATHROOM_HIT_BARKS, pickFreshLine } from '../dialog/scripts/scenes/cloggedBathroom';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/** Who a bathroom goblin is: one of the line, or the plumber at its head. */
export type BathroomGoblinRole = 'queue' | 'plumber';

/**
 * The HP handed to the base class. Nothing ever writes it: the goblin is
 * damage immune, and `hp` is here only so `isAlive` keeps it in the mob grid,
 * where the game's weapons find it and it can say "ow".
 */
const MINIMUM_LIVE_HP = 1;
/** A goblin's own walking pace, in pixels per frame, matching the floor's hostile goblins. */
const BATHROOM_GOBLIN_WALK_SPEED = 1.4;
const SECONDS_PER_FRAME = 1 / WORLD_TICKS_PER_SECOND;
const MILLISECONDS_PER_SECOND = 1000;
const HALF = 0.5;
/** The goblin painter overhangs its tile like the hostile goblins' does. */
const BATHROOM_GOBLIN_CULL_MARGIN_TILES = 1.5;

/**
 * Frames between one goblin's "Ow!" bubbles. A flurry of blows still flinches
 * him every time, but the bubble and the cue come at most this often, so a
 * held attack key does not stack a column of text over his head.
 */
export const OW_THROTTLE_FRAMES = 45;
/** How long an "Ow!" stays over his head. */
const OW_BUBBLE_FRAMES = 60;

const HASH_MULTIPLIER_A = 0x9e3779b1;
const HASH_MULTIPLIER_B = 0x85ebca6b;
const HASH_SHIFT = 16;
const UINT32_RANGE = 0x1_0000_0000;

/** A number in [0, 1) fixed by `seed` and `salt`. */
export function bathroomSeedFraction(seed: number, salt: number): number {
  let hash = Math.imul(seed ^ Math.imul(salt + 1, HASH_MULTIPLIER_A), HASH_MULTIPLIER_B);
  hash ^= hash >>> HASH_SHIFT;
  hash = Math.imul(hash, HASH_MULTIPLIER_A);
  hash ^= hash >>> HASH_SHIFT;
  return (hash >>> 0) / UINT32_RANGE;
}

const QUEUE_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.success,
  text: worldPalette.ink.bright,
};
const PLUMBER_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.gold,
  text: worldPalette.ink.bright,
};

/**
 * One goblin of the clogged bathroom: a goblin in the queue, or Grubnik the
 * plumber at its head.
 *
 * A `Mob` rather than a system-drawn figure because that is what puts him in
 * front of the game's own weapons, which is the point: hit him and he says
 * "ow". He is never hurt and never dies (`isDamageImmune`, `cannotBeKilled`),
 * is nobody's enemy (`isHostile` false, so no companion, pet, hireling or
 * homing shot picks him), and pays for nothing: no XP, no coin, no loot, and
 * no blow on him earns ability XP or a proc (`blowsEarnNothing`).
 *
 * He does not decide where to stand. `CloggedBathroomSystem` sets his post,
 * the route he walks after the fix and when he is behind a stall door; this
 * class walks the route, flinches and talks.
 */
export class BathroomGoblin extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;

  readonly role: BathroomGoblinRole;
  /** Fixes his look and which lines he picks. */
  readonly seed: number;
  readonly archetype: GoblinArchetype;
  readonly speech = new TimedSpeech();

  /** The glyph over his head; only the plumber ever wears one. */
  marker: NpcQuestMarker = 'none';
  /** The row he was last drawn in, which his marker hangs from once it is measured. */
  private drawnRow: DrawnFigureRow | undefined;
  /** Behind a shut stall door: not drawn, not hit, not talked to. */
  hidden = false;
  /** Whether nothing may shove him: true while he holds his place in line. */
  holdsPlace = true;
  /** Set when he says "ow"; the bathroom system plays the cue and clears it. */
  owCuePending = false;
  /** How many "ow" barks he has said, for a gate to count and for picking the next. */
  owBarks = 0;

  private readonly animator: GoblinPassiveAnimator;
  private owThrottle = 0;
  private lastOw: BarkLine | null = null;
  private route: readonly Point[] = [];
  private routeIndex = 0;

  protected override get eyePlacement(): EyePlacement {
    return GOBLIN_EYES;
  }

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    role: BathroomGoblinRole,
    seed: number,
    archetype: GoblinArchetype,
  ) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, BATHROOM_GOBLIN_WALK_SPEED);
    this.role = role;
    this.seed = seed;
    this.archetype = archetype;
    this.animator = bathroomGoblinAnimator(role === 'plumber' ? 'plumber' : archetype);
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
    this.displayName = role === 'plumber' ? 'Grubnik, Plumber' : 'Goblin in Line';
    this.description =
      role === 'plumber'
        ? 'Has the hat. Does not have the faintest idea how pipes work.'
        : 'Waiting for the bathroom. Has been for a while.';
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

  override get separationAnchored(): boolean {
    return this.holdsPlace || this.hidden;
  }

  /** An energy shield or a blast pushes him no more than a shoulder does while he holds his place in line. */
  protected override acceptsShove(_x: number, _y: number): boolean {
    return !this.separationAnchored;
  }

  override get displacesPlayers(): boolean {
    return !this.hidden;
  }

  override get ignoresMobCollision(): boolean {
    return this.hidden;
  }

  override get cullMarginTiles(): number {
    return BATHROOM_GOBLIN_CULL_MARGIN_TILES;
  }

  /**
   * Every route into his health refuses, so every blow lands in
   * {@link onDamageBlocked} — the one place he reacts — and a poison proc or a
   * burn can never tick him away.
   */
  protected override get isDamageImmune(): boolean {
    return true;
  }

  /**
   * Every weapon may reach him, so the melee, missile, seismic stomp, sling and energy shield
   * sites all get as far as the blow (and the "ow") rather than passing him by.
   */
  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return !this.hidden;
  }

  protected override onDamageBlocked(): void {
    if (this.hidden) return;
    this.animator.startFlinch();
    if (this.owThrottle > 0) return;
    this.owThrottle = OW_THROTTLE_FRAMES;
    const pool = this.role === 'plumber' ? BATHROOM_HIT_BARKS.plumber : BATHROOM_HIT_BARKS.queue;
    const line = pickFreshLine(pool, this.seed, this.owBarks, this.lastOw);
    this.lastOw = line;
    this.owBarks++;
    this.speech.say(line.paragraphs[0], { durationFrames: OW_BUBBLE_FRAMES });
    this.owCuePending = true;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /** Puts him on `tile` at once, standing still. The caller moves him in the mob grid. */
  placeAtTile(tile: Point): void {
    this.x = tile.x * this.tileSize;
    this.y = tile.y * this.tileSize;
    this.route = [];
    this.routeIndex = 0;
    this.isMoving = false;
  }

  /** Turns him toward `tile`; the art only shows left or right, so a tile straight ahead keeps his facing. */
  faceTile(tile: Point): void {
    const dx = tile.x * this.tileSize - this.x;
    const dy = tile.y * this.tileSize - this.y;
    if (dx === 0 && dy === 0) return;
    this.facingX = Math.sign(dx);
    this.facingY = Math.sign(dy);
  }

  /** Sets him walking through `tiles` in order; an empty list leaves him where he is. */
  walkRoute(tiles: readonly Point[]): void {
    this.route = tiles;
    this.routeIndex = 0;
  }

  get hasArrived(): boolean {
    return this.routeIndex >= this.route.length;
  }

  /**
   * One frame of walking his route at his own pace. Straight at each waypoint:
   * the route is a path the map's search found, so it never runs him through
   * a wall.
   */
  stepRoute(): void {
    let budget = BATHROOM_GOBLIN_WALK_SPEED;
    let moved = false;
    while (budget > 0 && this.routeIndex < this.route.length) {
      const waypoint = this.route[this.routeIndex];
      const goalX = waypoint.x * this.tileSize;
      const goalY = waypoint.y * this.tileSize;
      const dx = goalX - this.x;
      const dy = goalY - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        this.x = goalX;
        this.y = goalY;
        this.recordOwnStride(distance);
        budget -= distance;
        this.routeIndex++;
      } else {
        this.x += (dx / distance) * budget;
        this.y += (dy / distance) * budget;
        this.recordOwnStride(budget);
        budget = 0;
      }
      if (distance > 0) {
        if (dx !== 0) this.facingX = Math.sign(dx);
        this.facingY = Math.sign(dy);
        moved = true;
      }
    }
    this.isMoving = moved;
  }

  /** His speech and "ow" throttle. Runs only near the party, so far copies sit still. */
  updateAI(_targets: Player[]): void {
    this.speech.tick();
    if (this.owThrottle > 0) this.owThrottle--;
  }

  /** His animation, ticked alongside every other goblin's so all three walk the same way. */
  override tickTimers(): void {
    super.tickTimers();
    this.animator.tick(this.isMoving, false, SECONDS_PER_FRAME, this.ownStridePx);
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive || this.hidden) return;
    const seconds = performance.now() / MILLISECONDS_PER_SECOND;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const showsMarker = this.marker !== 'none';
    // Behind the body, so the column stands behind him.
    drawOverheadIconBeacon(ctx, sx, sy, tileSize, camX, camY, this.marker);
    const resolved = this.animator.resolvePassive(seconds, this.isMoving);
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      if (this.role === 'plumber') {
        this.drawnRow = drawGoblinPlumberSprite(ctx, {
          x: sx,
          y: sy,
          tileSize,
          facingX: this.facingX,
          state: resolved.state,
          frame: resolved.frame,
        });
        return;
      }
      this.drawnRow = drawGoblinSprite(ctx, {
        archetype: this.archetype,
        x: sx,
        y: sy,
        tileSize,
        facingX: this.facingX,
        state: resolved.state,
        frame: resolved.frame,
      });
    });
    if (showsMarker) {
      drawOverheadIcon(
        ctx,
        sx,
        IconAnchor.ofRow(this.drawnRow, sy, tileSize),
        tileSize,
        this.marker,
      );
    }
    const style = this.role === 'plumber' ? PLUMBER_BUBBLE_STYLE : QUEUE_BUBBLE_STYLE;
    drawTimedSpeechBubble(ctx, this.speech, sx + tileSize * HALF, artTopY, style);
  }
}
