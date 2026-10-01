/**
 * A lightweight, non-combatant citizen of the Over City. Deliberately *not* a
 * `Mob` (no aggro, pathfinding, or loot) and *not* a `Player` — it only strolls,
 * faces where it walks, and draws itself with the procedural person renderer.
 * `TownLifeSystem` (streets) and `InteriorOccupantSystem` (buildings) own the
 * spawning, culling, and interaction; this class just carries the state and
 * animates it via the shared wander helper.
 */

import { TILE_SIZE } from '../core/constants';
import type { TownRole } from '../sprites/person/PersonAppearance';
import { IDLE_CYCLES_PER_FRAME } from '../sprites/person/gait';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import { gaitCyclesForDistance } from '../sprites/gaitCadence';
import type { Facing } from '../sprites/person/skeleton';
import { stepWander, type WanderParams, type WanderState, type WanderStep } from './townWander';
import type { ResidentId } from '../systems/townResidents';
import type { TownSpecies } from '../systems/townSpecies';
import {
  citizenDialogSeed,
  citizenWalkCyclePx,
  citizenWalkFrames,
  drawCitizenSprite,
  citizenSpeechStyle,
  pickCitizenFigure,
  prewarmCitizenFigure,
  type CitizenFigure,
} from './citizenFigure';
import { residentFigure } from './residentFigures';
import type { NPCMarkerType } from './QuestNPC';
import {
  drawQuestMarker,
  questMarkerColorFor,
  questMarkerTopY,
  type QuestMarkerGlyph,
} from '../sprites/questNPCSprite';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { drawQuestBeacon } from '../sprites/questBeacon';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import { figureRowInkTop } from '../sprites/figure/figureFrameCache';

/**
 * Draw size of a citizen in pixels before the humanoid scale-up — full-tile
 * figures matching the player. The world always passes its tile size, which is
 * this, so the stride length derived here is the one actually drawn.
 */
const PERSON_DRAW_SIZE = TILE_SIZE;
/** Minimum movement (px) on an axis before it can flip facing — kills jitter. */
const FACING_DEADZONE = 0.05;
/**
 * How far the challenging axis must beat the current one before the figure
 * turns.
 *
 * On a near-diagonal heading `|dx|` and `|dy|` trade places from frame to frame,
 * and a bare comparison strobes the figure between two views. A margin plus a
 * minimum dwell means a genuine turn still reads immediately while a heading
 * that merely wobbles across the diagonal does not.
 */
const FACING_TURN_MARGIN = 1.35;
const FACING_DWELL_FRAMES = 10;

/** `phase` is a 0–1 cycle fraction; the sprite wrapper's walk phase is radians. */
const TWO_PI = Math.PI * 2;
/**
 * Spreads each citizen's clock-driven loops (idle, talk) apart by its own id,
 * so a crowd doesn't breathe or gesture in lockstep. Not a multiple of any
 * loop's own period, so ids never re-collide into pairs sharing a phase.
 */
const LOOP_OFFSET_SECONDS_PER_ID = 0.37;

/**
 * Scratch for `stepWander`'s output. Safe to share: it is written and consumed
 * entirely within one synchronous `update()` call.
 */
const sharedWanderStep: WanderStep = { dx: 0, dy: 0, moving: false, distance: 0 };

/** Source of `Townsperson.id` — a stable identity for pairwise crowd passes. */
let nextTownspersonId = 0;

export interface TownspersonOptions {
  x: number;
  y: number;
  role: TownRole;
  species: TownSpecies;
  /** Appearance seed; also seeds the role bias. */
  seed: number;
  /** World-pixels advanced per frame while walking. */
  speed: number;
  /** Wander tuning + destination source; supplied by the owning system. */
  wander: WanderParams;
  /** Initial idle pause in frames, so a crowd doesn't step off in lockstep. */
  initialPause?: number;
  /** Facing to hold until the figure first moves — lets a stationed occupant face its workstation. */
  initialFacing?: Facing;
  /** Names this citizen as a specific person; unset citizens speak from the role pools. */
  residentId?: ResidentId;
}

export class Townsperson implements WanderState {
  readonly isNonCombatant = true;
  /** Stable identity, so a pairwise crowd pass can visit each pair exactly once. */
  readonly id = nextTownspersonId++;
  readonly role: TownRole;
  readonly species: TownSpecies;
  /** Set when this citizen is a named resident; drives their dialog and speaker label. */
  readonly residentId: ResidentId | null;
  readonly figure: CitizenFigure;
  /** The voice this citizen's dialog lines are spoken in. */
  readonly speechStyle: CitizenSpeechStyle;
  /** A stable, look-scoped seed for dialog line rotation — see `citizenDialogSeed`. */
  readonly dialogSeed: number;

  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  pause: number;

  facing: Facing = 'down';
  /** Walk-cycle position in strides, wrapped to one cycle — see `gait.ts`. */
  phase = 0;
  moving = false;
  private framesSinceTurn = FACING_DWELL_FRAMES;
  /**
   * World pixels this citizen covers per full stride — what converts distance
   * travelled into cycle position.
   *
   * It falls out of the figure's leg length and gait *and the size they are
   * drawn at*, so it is re-derived whenever the caller draws them at a new size.
   * Pinning it to the tile size would leave the cadence assuming one stride
   * while the figure drew another, and the foot would start sliding again with
   * nothing to say so.
   */
  private cycleDistance: number;
  private cycleDistanceDrawSize = PERSON_DRAW_SIZE;
  /** The row the last render drew, which bubbles drawn in later passes stack over. */
  private drawnRow: DrawnFigureRow | undefined;
  private readonly walkFrames: number;
  /** How many times the player has talked to this citizen — rotates their dialog. */
  conversationCount = 0;
  /** True while this citizen is mid-conversation — holds them in place facing the player. */
  frozen = false;
  /**
   * Overhead quest glyph. `'none'` for the whole strolling crowd — only a
   * citizen a questline has business with is ever given one, and the questline
   * that gave it is what sets it back to `'none'`.
   *
   * Follows the shipped convention: `'exclamation'` offers, `'question'` turns in.
   */
  markerType: NPCMarkerType = 'none';

  private readonly wander: WanderParams;

  constructor(opts: TownspersonOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.targetX = opts.x;
    this.targetY = opts.y;
    this.role = opts.role;
    this.species = opts.species;
    this.residentId = opts.residentId ?? null;
    this.pause = opts.initialPause ?? 0;
    this.wander = opts.wander;
    if (opts.initialFacing !== undefined) this.facing = opts.initialFacing;
    this.figure =
      this.residentId !== null
        ? residentFigure(this.residentId)
        : pickCitizenFigure(opts.seed, opts.role, opts.species);
    this.dialogSeed = citizenDialogSeed(this.figure);
    this.speechStyle = citizenSpeechStyle(this.figure);
    // Every citizen shares its look's cells with every other wearer of that
    // look, so queuing this look's rows here costs nothing extra once the
    // crowd's small closed set is warm — and keeps the cost off whichever
    // citizen happens to draw the first frame anyone wears it in.
    prewarmCitizenFigure(this.figure);
    this.speed = opts.speed;
    this.cycleDistance = citizenWalkCyclePx(this.figure, PERSON_DRAW_SIZE);
    this.walkFrames = citizenWalkFrames(this.figure);
  }

  /** Advances one frame of wander, facing, and animation. */
  update(): void {
    if (this.frozen) return;
    stepWander(this, this.wander, sharedWanderStep);
    this.moving = sharedWanderStep.moving;
    this.framesSinceTurn++;
    // Cadence comes from ground covered, not from elapsed time: the crowd's
    // speeds span five to one, and one clock for all of them had the slow ones
    // skating and the fast ones mincing.
    const advance = this.moving
      ? gaitCyclesForDistance(sharedWanderStep.distance, this.cycleDistance, this.walkFrames)
      : IDLE_CYCLES_PER_FRAME;
    // Wrapped rather than left to grow: an unbounded phase degrades `Math.sin`
    // and the bucket modulo over a long session.
    this.phase = (this.phase + advance) % 1;
    if (sharedWanderStep.moving) this.updateFacing(sharedWanderStep.dx, sharedWanderStep.dy);
  }

  /** Turn to face a world point — used to look at the player when spoken to. */
  faceToward(px: number, py: number): void {
    this.turnTo(px - this.x, py - this.y);
  }

  /**
   * This citizen's `facing` as the `-1`/`0`/`1` pair the sprite wrapper and
   * the figure cache key on, rather than the `Facing` string itself — for a
   * caller warming a specific row (a `talk` cell for the facing a
   * conversation is about to freeze this citizen into) ahead of `render()`
   * asking for it.
   */
  facingXY(): { x: number; y: number } {
    return {
      x: this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : 0,
      y: this.facing === 'up' ? -1 : this.facing === 'down' ? 1 : 0,
    };
  }

  /** Facing from a heading, with hysteresis so a near-diagonal does not strobe. */
  private updateFacing(dx: number, dy: number): void {
    if (Math.abs(dx) < FACING_DEADZONE && Math.abs(dy) < FACING_DEADZONE) return;
    const horizontal = Math.abs(dx);
    const vertical = Math.abs(dy);
    const wantsHorizontal = horizontal >= vertical;
    const holdsHorizontal = this.facing === 'left' || this.facing === 'right';
    if (wantsHorizontal !== holdsHorizontal) {
      if (this.framesSinceTurn < FACING_DWELL_FRAMES) return;
      const challenger = wantsHorizontal ? horizontal : vertical;
      const incumbent = wantsHorizontal ? vertical : horizontal;
      if (challenger < incumbent * FACING_TURN_MARGIN) return;
    }
    this.turnTo(dx, dy);
  }

  /** Snaps to the dominant axis with no hysteresis — for deliberate turns. */
  private turnTo(dx: number, dy: number): void {
    const next: Facing =
      Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    if (next !== this.facing) this.framesSinceTurn = 0;
    this.facing = next;
  }

  /** Draws the citizen in world space. Y-sorted by the caller against `y`. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const drawSize = tileSize > 0 ? tileSize : PERSON_DRAW_SIZE;
    const box = scaleHumanoidBox(this.x - camX, this.y - camY, drawSize);
    if (drawSize !== this.cycleDistanceDrawSize) {
      this.cycleDistanceDrawSize = drawSize;
      this.cycleDistance = citizenWalkCyclePx(this.figure, drawSize);
    }
    // Beacon first, so the column stands behind the figure rather than across
    // it. Both it and the glyph below branch on `markerType` and nothing else,
    // so the two can never disagree about whether this citizen has something
    // to say.
    const markerColor = questMarkerColorFor(this.markerType);
    if (markerColor !== undefined) {
      drawQuestBeacon(ctx, box.sx, box.sy, box.s, camX, camY, performance.now(), markerColor);
    }

    const facing = this.facingXY();
    this.drawnRow = drawCitizenSprite(ctx, this.figure, this.x - camX, this.y - camY, drawSize, {
      action: this.frozen ? 'talk' : this.moving ? 'walk' : 'idle',
      walkPhase: this.phase * TWO_PI,
      facingX: facing.x,
      facingY: facing.y,
      loopOffsetSeconds: this.id * LOOP_OFFSET_SECONDS_PER_ID,
    });

    const glyph = this.markerGlyph;
    if (markerColor !== undefined && glyph !== null) {
      const artTop = this.artTop(this.y - camY);
      drawQuestMarker(ctx, box.sx, artTop, box.s, glyph, markerColor);
    }
  }

  /** The glyph over this citizen's head, or null while they wear none. */
  private get markerGlyph(): QuestMarkerGlyph | null {
    if (questMarkerColorFor(this.markerType) === undefined) return null;
    return this.markerType === 'question' ? '?' : '!';
  }

  /** The measured top of the row last drawn, or the humanoid box's top before the first draw. */
  private artTop(sy: number): number {
    const drawSize = this.cycleDistanceDrawSize;
    if (this.drawnRow === undefined) return scaleHumanoidBox(this.x, sy, drawSize).sy;
    return figureRowInkTop(this.drawnRow, sy, drawSize);
  }

  /**
   * The screen y a bubble or label hung over this citizen must stay above, for
   * a citizen whose tile top is at screen `sy`: their quest marker's top at the
   * height of its bounce while they wear one, else their art's.
   */
  overheadTop(ctx: CanvasRenderingContext2D, sy: number): number {
    const artTop = this.artTop(sy);
    const glyph = this.markerGlyph;
    if (glyph === null) return artTop;
    const markerSize = scaleHumanoidBox(this.x, sy, this.cycleDistanceDrawSize).s;
    return questMarkerTopY(ctx, artTop, markerSize, glyph);
  }
}
