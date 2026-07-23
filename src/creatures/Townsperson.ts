/**
 * A lightweight, non-combatant citizen of the Over City. Deliberately *not* a
 * `Mob` (no aggro, pathfinding, or loot) and *not* a `Player` — it only strolls,
 * faces where it walks, and draws itself with the procedural person renderer.
 * `TownLifeSystem` (streets) and `InteriorOccupantSystem` (buildings) own the
 * spawning, culling, and interaction; this class just carries the state and
 * animates it via the shared wander helper.
 */

import {
  generatePersonAppearance,
  type PersonAppearance,
  type TownRole,
} from '../sprites/person/PersonAppearance';
import { drawPerson } from '../sprites/person/drawPerson';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import type { Facing } from '../sprites/person/skeleton';
import { stepWander, type WanderParams, type WanderState } from './townWander';

/** Draw size of a citizen in pixels — full-tile figures matching the player. */
const PERSON_DRAW_SIZE = 32;
/** Walk-cycle clock advance per frame; matches the preview harness's cadence. */
const PHASE_STEP = 1;
/** Minimum movement (px) on an axis before it can flip facing — kills jitter. */
const FACING_DEADZONE = 0.05;

export interface TownspersonOptions {
  x: number;
  y: number;
  role: TownRole;
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
}

export class Townsperson implements WanderState {
  readonly isNonCombatant = true;
  readonly role: TownRole;
  readonly appearance: PersonAppearance;

  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  pause: number;

  facing: Facing = 'down';
  phase = 0;
  moving = false;
  /** How many times the player has talked to this citizen — rotates their dialog. */
  conversationCount = 0;

  private readonly wander: WanderParams;

  constructor(opts: TownspersonOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.targetX = opts.x;
    this.targetY = opts.y;
    this.role = opts.role;
    this.speed = opts.speed;
    this.pause = opts.initialPause ?? 0;
    this.wander = opts.wander;
    if (opts.initialFacing !== undefined) this.facing = opts.initialFacing;
    this.appearance = generatePersonAppearance(opts.seed, opts.role);
  }

  /** Advances one frame of wander, facing, and animation. */
  update(): void {
    const step = stepWander(this, this.wander);
    this.moving = step.moving;
    this.phase += PHASE_STEP;
    if (step.moving) this.updateFacing(step.dx, step.dy);
  }

  /** Turn to face a world point — used to look at the player when spoken to. */
  faceToward(px: number, py: number): void {
    this.updateFacing(px - this.x, py - this.y);
  }

  private updateFacing(dx: number, dy: number): void {
    if (Math.abs(dx) < FACING_DEADZONE && Math.abs(dy) < FACING_DEADZONE) return;
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.facing = dx < 0 ? 'left' : 'right';
    } else {
      this.facing = dy < 0 ? 'up' : 'down';
    }
  }

  /** Draws the citizen in world space. Y-sorted by the caller against `y`. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const drawSize = tileSize > 0 ? tileSize : PERSON_DRAW_SIZE;
    const box = scaleHumanoidBox(this.x - camX, this.y - camY, drawSize);
    drawPerson(ctx, box.sx, box.sy, box.s, this.appearance, this.phase, this.facing, this.moving);
  }
}
