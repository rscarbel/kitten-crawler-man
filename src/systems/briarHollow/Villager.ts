/**
 * A Briar Hollow civilian.
 *
 * Deliberately not a `Mob` and not a `Player`, like `Townsperson`: never in
 * the combat roster, so no attack, blast, boulder or area effect can reach
 * one, and no hostile, Mongo or hireling can see one. That is the whole of
 * how "nobody fights the villagers" is guaranteed — not a rule anyone has to
 * remember to check.
 *
 * This class carries a villager's state, walks them along the route their
 * system planned, and draws them. `VillagerSystem` decides where they go.
 */

import { TILE_SIZE } from '../../core/constants';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { TilePoint } from '../../map/town/townPlan';
import {
  type RatkinCastAction,
  drawRatkinCastSprite,
  ratkinCastTilesPerWalkCycle,
} from '../../sprites/ratkinCastSprite';
import { RATKIN_WORK_MOTIONS } from '../../sprites/art/ratkinCastFigure';
import {
  TimedSpeech,
  drawSpeechBubble,
  drawTimedSpeechBubble,
  type TimedBubbleStyle,
} from '../../sprites/speechBubble';
import {
  drawQuestMarker,
  questMarkerAnchorAbove,
  questMarkerColorFor,
} from '../../sprites/questNPCSprite';
import { drawText, TEXT_PRESETS } from '../../ui/TextBox';
import type { TownPropRenderable } from '../townPropRenderable';
import type { CivilianCastId, VillagerRoutine } from './villagerRoutines';

/** What a villager is doing, as far as their routine is concerned. */
export type VillagerState = 'working' | 'strolling' | 'talking' | 'sheltering' | 'returning';

const FULL_TURN = Math.PI * 2;
const TILE_CENTRE = 0.5;
/**
 * How far above the tile top a ratkin's head reaches, in tiles. The cast
 * stands about a tile tall, as Mordecai does, and half a tile clears every
 * hat and ear.
 */
export const VILLAGER_HEAD_CLEARANCE_TILES = 0.5;
/** Gap between the head and a marker or bubble above it. */
const OVERHEAD_GAP_PX = 2;
/** The name sits under the feet, clear of the prompt, marker and bubbles above. */
const NAME_LABEL_DROP_PX = 1;
/** How far a step must lean one way before the villager turns to face it. */
const FACING_DEADZONE = 0.05;
/** A villager's bubble: warm, like the village's own conversation panel. */
const VILLAGER_BUBBLE_STYLE: TimedBubbleStyle = { border: '#c8a860', text: '#f5ecd7' };
/** The "…" bubble's pulse runs on frames. */
const ELLIPSIS_PULSE_PER_FRAME = 1;

export class Villager implements TownPropRenderable {
  x: number;
  y: number;
  /** +1 right, −1 left, 0 along the vertical. */
  facingX = 0;
  /** +1 toward the camera, −1 away, 0 along the horizontal. */
  facingY = 1;
  state: VillagerState = 'working';
  marker: NPCMarkerType = 'none';
  readonly bark = new TimedSpeech();
  /** Shows the wordless "…" bubble while set — the unnamed four in hiding. */
  hushed = false;
  /** Set each frame by the system: the active crawler is close enough to read the name. */
  showName = false;

  /** The planned route, walked tile centre to tile centre. */
  path: TilePoint[] = [];
  private pathIndex = 0;
  /** Frames to stand before the next decision. */
  standFrames = 0;
  /** Stops still to make on this outing before heading back to the post. */
  strollStopsLeft = 0;
  /** Consecutive frames a crawler has stood in the way. */
  blockedFrames = 0;
  /** Frames left trailing after the cat; 0 when not following. */
  followFramesLeft = 0;
  /** Frames before a child may take up following again. */
  followCooldownFrames = 0;
  /** Frames to wait before walking home after the siege, so the village does not move as one. */
  resumeDelayFrames = 0;
  /** Walks at a hurried pace: fleeing to shelter, or a shopkeeper heading back to the counter. */
  hurrying = false;
  /** Who they are talking to while `state` is `talking`. */
  talkPartner: { readonly x: number; readonly y: number } | null = null;

  private walkPhase = 0;
  private moving = false;
  private readonly loopOffsetSeconds: number;
  private readonly tilesPerWalkCycle: number;
  private readonly hasWorkRow: boolean;
  private ellipsisPulse = 0;

  constructor(
    readonly id: CivilianCastId,
    readonly routine: VillagerRoutine,
    readonly displayName: string | null,
    /** Where they work. */
    readonly post: TilePoint,
    /** Where they hide during the siege. */
    readonly shelter: TilePoint,
    start: TilePoint,
    loopOffsetSeconds: number,
  ) {
    this.x = start.x * TILE_SIZE;
    this.y = start.y * TILE_SIZE;
    this.loopOffsetSeconds = loopOffsetSeconds;
    this.tilesPerWalkCycle = ratkinCastTilesPerWalkCycle(id);
    this.hasWorkRow = RATKIN_WORK_MOTIONS[id] !== undefined;
  }

  /** The tile under the villager's body. */
  get tile(): TilePoint {
    return {
      x: Math.floor(this.x / TILE_SIZE + TILE_CENTRE),
      y: Math.floor(this.y / TILE_SIZE + TILE_CENTRE),
    };
  }

  get centreX(): number {
    return this.x + TILE_SIZE * TILE_CENTRE;
  }

  get centreY(): number {
    return this.y + TILE_SIZE * TILE_CENTRE;
  }

  get isTravelling(): boolean {
    return this.pathIndex < this.path.length;
  }

  /** The tile the villager is walking toward next, or null when standing. */
  get nextWaypoint(): TilePoint | null {
    return this.isTravelling ? this.path[this.pathIndex] : null;
  }

  /** The end of the current route, or null when standing. */
  get destination(): TilePoint | null {
    return this.path.length === 0 ? null : this.path[this.path.length - 1];
  }

  setPath(path: TilePoint[]): void {
    this.path = path;
    this.pathIndex = 0;
    this.blockedFrames = 0;
  }

  clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    this.blockedFrames = 0;
  }

  /** Plays the standing row this frame rather than a step. */
  standStill(): void {
    this.moving = false;
  }

  /** Walks up to `speedPx` along the route. Returns true on arriving at its end. */
  advance(speedPx: number): boolean {
    let budget = speedPx;
    let covered = 0;
    let headingX = 0;
    let headingY = 0;
    while (budget > 0 && this.isTravelling) {
      const target = this.path[this.pathIndex];
      const dx = target.x * TILE_SIZE - this.x;
      const dy = target.y * TILE_SIZE - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        this.x = target.x * TILE_SIZE;
        this.y = target.y * TILE_SIZE;
        budget -= distance;
        covered += distance;
        this.pathIndex++;
      } else {
        this.x += (dx / distance) * budget;
        this.y += (dy / distance) * budget;
        covered += budget;
        budget = 0;
      }
      headingX = dx;
      headingY = dy;
    }
    this.moving = covered > 0;
    if (this.moving) {
      this.walkPhase =
        (this.walkPhase + (covered / (this.tilesPerWalkCycle * TILE_SIZE)) * FULL_TURN) % FULL_TURN;
      this.face(headingX, headingY);
    }
    return !this.isTravelling;
  }

  /** Steps straight toward a world point, for trailing after the cat. Returns the pixels covered. */
  stepToward(worldX: number, worldY: number, speedPx: number): number {
    const dx = worldX - this.x;
    const dy = worldY - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      this.moving = false;
      return 0;
    }
    const step = Math.min(speedPx, distance);
    this.x += (dx / distance) * step;
    this.y += (dy / distance) * step;
    this.moving = true;
    this.walkPhase =
      (this.walkPhase + (step / (this.tilesPerWalkCycle * TILE_SIZE)) * FULL_TURN) % FULL_TURN;
    this.face(dx, dy);
    return step;
  }

  /** Turns to the dominant axis of a heading. */
  face(dx: number, dy: number): void {
    if (Math.abs(dx) < FACING_DEADZONE && Math.abs(dy) < FACING_DEADZONE) return;
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.facingX = Math.sign(dx);
      this.facingY = 0;
    } else {
      this.facingX = 0;
      this.facingY = Math.sign(dy);
    }
  }

  faceToward(worldX: number, worldY: number): void {
    this.face(worldX - this.x, worldY - this.y);
  }

  /** Per-frame bookkeeping that runs whatever the villager is doing. */
  tick(): void {
    this.bark.tick();
    this.ellipsisPulse += ELLIPSIS_PULSE_PER_FRAME;
  }

  private get action(): RatkinCastAction {
    if (this.moving) return 'walk';
    if (this.state === 'talking') return 'talk';
    if (this.state === 'sheltering') return 'cower';
    if (this.state === 'working' && this.hasWorkRow) return 'work';
    return 'idle';
  }

  /** The highest point of the art, for anything drawn over the head. */
  headTop(sy: number, tileSize: number): number {
    return sy - VILLAGER_HEAD_CLEARANCE_TILES * tileSize;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawRatkinCastSprite(ctx, this.id, sx, sy, tileSize, {
      action: this.action,
      walkPhase: this.walkPhase,
      facingX: this.facingX,
      facingY: this.facingY,
      loopOffsetSeconds: this.loopOffsetSeconds,
    });

    const headTop = this.headTop(sy, tileSize);
    const markerColor = this.state === 'talking' ? undefined : questMarkerColorFor(this.marker);
    if (markerColor !== undefined) {
      const glyph = this.marker === 'question' ? '?' : '!';
      const markerY = questMarkerAnchorAbove(headTop - OVERHEAD_GAP_PX, tileSize);
      drawQuestMarker(ctx, sx, markerY, tileSize, glyph, markerColor);
    }

    if (this.displayName !== null && this.showName) {
      drawText(ctx, this.displayName, {
        ...TEXT_PRESETS.label,
        x: sx + tileSize * TILE_CENTRE,
        y: sy + tileSize + NAME_LABEL_DROP_PX,
        align: 'center',
      });
    }

    if (this.bark.current !== null) {
      drawTimedSpeechBubble(
        ctx,
        this.bark,
        sx + tileSize * TILE_CENTRE,
        headTop - OVERHEAD_GAP_PX,
        VILLAGER_BUBBLE_STYLE,
      );
    } else if (this.hushed) {
      drawSpeechBubble(ctx, sx, sy, tileSize, this.ellipsisPulse);
    }
  }
}
