/**
 * Pumpkin as she lives once she has walked back in on Dave: a cat about the
 * Sleeping Cat Inn's taproom, never a fighter. She rests by the spot she
 * settled on, sits more than she stands, grooms, and now and then gets up to
 * walk a few steps and lie down again. She is there whether Dave is in the
 * room or teleported out of it.
 *
 * Her body is a staged one, so a script can walk her in at the door for the
 * moment she arrives; outside a script she keeps to her own routine.
 */

import { TILE_SIZE } from '../../core/constants';
import { WALK_FRAME_SPEED } from '../../Player';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { SpeakingCat } from '../../creatures/castCatTalk';
import type { SpeakerId } from '../../dialog/speakers';
import type { Pt } from '../../sprites/art/catArt';
import { CatAnimator, CatAppearance, drawCatSprite, prewarmCatTalk } from '../../sprites/catSprite';
import { FacingState, type FacingSelection, selectFacing } from '../../sprites/facingView';
import { PUMPKIN_LOOK } from '../../sprites/looks/cats/pumpkin';
import { stagedActor, type CutsceneActor, type StagedBody } from '../cutscene/cutsceneActors';
import type { WorldPoint } from '../critters/ScatterSwarm';

/** Pixels a tick: an unhurried walk across her own taproom. */
const AMBLE_SPEED = 0.7;
/** Pixels a tick when a script walks her: twice her amble, so an entrance does not keep a scene waiting. */
const SCRIPTED_WALK_SPEED = AMBLE_SPEED * 2;
/** How far from where she settled she wanders. */
const ROAM_TILES = 1.5;
const ROAM_PX = ROAM_TILES * TILE_SIZE;
/** She rests this long, plus up to the random share, between wanders: longer than any town cat. */
const REST_MIN_FRAMES = 600;
const REST_RANDOM_FRAMES = 900;
/** The share of her rests she spends sat down. */
const SIT_SHARE = 0.8;
const ARRIVAL_PX = 2;
const TILE_CENTRE_PX = TILE_SIZE / 2;

/** What answers whether she may step onto a tile. */
export type PumpkinFloor = (tileX: number, tileY: number) => boolean;

export class PumpkinAtHome implements InteriorFigure, SpeakingCat {
  readonly speaker: SpeakerId = 'pumpkin';
  private readonly body: StagedBody;
  private readonly appearance = new CatAppearance('ambient', PUMPKIN_LOOK);
  private readonly animator = new CatAnimator(this.appearance);
  private readonly facing: FacingState;
  private readonly actorView: CutsceneActor;
  private anchor: WorldPoint;
  private target: WorldPoint | null = null;
  private restFramesLeft = REST_MIN_FRAMES;
  private sitting = true;
  private walkFrame = 0;
  private scripted = false;
  /** The view she talks in, turned to whoever she is talking to; null while she is not talking. */
  private talkFacing: FacingSelection | null = null;

  /** `at` is the tile-origin pixel she stands on, and where she settles until a script moves her. */
  constructor(
    at: WorldPoint,
    private readonly isFloor: PumpkinFloor,
    private readonly random: () => number,
  ) {
    this.body = { x: at.x, y: at.y, facingX: 0, facingY: 1, isMoving: false };
    this.anchor = at;
    this.facing = new FacingState(this.body.facingX, this.body.facingY);
    this.actorView = {
      ...stagedActor(this.body, SCRIPTED_WALK_SPEED, 'walker'),
      hold: (held) => {
        this.scripted = held;
        if (!held) this.settle();
      },
    };
    this.appearance.prewarm();
  }

  get y(): number {
    return this.body.y;
  }

  /** The tile-origin pixel she stands on. */
  get position(): WorldPoint {
    return { x: this.body.x, y: this.body.y };
  }

  /** How a script moves her: lent to the room's cutscenes while she is in it. */
  get actor(): CutsceneActor {
    return this.actorView;
  }

  /** She makes wherever a script left her the spot she rests by. */
  private settle(): void {
    this.anchor = { x: this.body.x, y: this.body.y };
    this.target = null;
    this.sitting = true;
    this.restFramesLeft = REST_MIN_FRAMES;
  }

  get isTalking(): boolean {
    return this.talkFacing !== null;
  }

  get canTalk(): boolean {
    return !this.body.isMoving;
  }

  startTalking(toward: Pt): void {
    const dx = toward.x - this.body.x;
    const dy = toward.y - this.body.y;
    const facing = dx === 0 && dy === 0 ? this.currentFacing() : selectFacing(dx, dy);
    this.talkFacing = facing;
    prewarmCatTalk(this.appearance, facing);
  }

  stopTalking(): void {
    this.talkFacing = null;
  }

  prewarmTalk(): void {
    prewarmCatTalk(this.appearance, this.currentFacing());
  }

  private currentFacing(): FacingSelection {
    return this.facing.peek(this.body.facingX, this.body.facingY);
  }

  update(): void {
    // Talking, she stays put: a wander that set off mid-line would end it.
    if (!this.scripted && !this.isTalking) this.tickRoutine();
    this.facing.update(this.body.facingX, this.body.facingY);
    if (this.body.isMoving) {
      this.sitting = false;
      this.walkFrame = (this.walkFrame + WALK_FRAME_SPEED) % (Math.PI * 2);
    }
    this.animator.tick(this.body.isMoving, false);
  }

  private tickRoutine(): void {
    const target = this.target;
    if (target !== null) {
      if (this.stepToward(target)) {
        this.target = null;
        this.restFramesLeft = REST_MIN_FRAMES + Math.floor(this.random() * REST_RANDOM_FRAMES);
        this.sitting = this.random() < SIT_SHARE;
      }
      return;
    }
    this.body.isMoving = false;
    this.restFramesLeft--;
    if (this.restFramesLeft > 0) return;
    const angle = this.random() * Math.PI * 2;
    const reach = this.random() * ROAM_PX;
    this.target = {
      x: this.anchor.x + Math.cos(angle) * reach,
      y: this.anchor.y + Math.sin(angle) * reach,
    };
  }

  /** One step toward `to`; true once she is there or the floor ends in front of her. */
  private stepToward(to: WorldPoint): boolean {
    const dx = to.x - this.body.x;
    const dy = to.y - this.body.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVAL_PX) {
      this.body.isMoving = false;
      return true;
    }
    const step = Math.min(AMBLE_SPEED, distance);
    const nextX = this.body.x + (dx / distance) * step;
    const nextY = this.body.y + (dy / distance) * step;
    this.body.facingX = dx / distance;
    this.body.facingY = dy / distance;
    const tileX = Math.floor((nextX + TILE_CENTRE_PX) / TILE_SIZE);
    const tileY = Math.floor((nextY + TILE_CENTRE_PX) / TILE_SIZE);
    if (!this.isFloor(tileX, tileY)) {
      this.body.isMoving = false;
      return true;
    }
    this.body.x = nextX;
    this.body.y = nextY;
    this.body.isMoving = true;
    return false;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const state = {
      walkFrame: this.walkFrame,
      isMoving: this.body.isMoving,
      facing: this.talkFacing ?? this.currentFacing(),
      oneShot: this.animator.current,
      sitting: !this.body.isMoving && this.sitting,
      talking: this.talkFacing !== null,
    };
    drawCatSprite(
      ctx,
      this.appearance,
      this.body.x - camX,
      this.body.y - camY,
      tileSize,
      this.appearance.cellFor(state),
      state,
    );
  }

  /** Drops her cells from the cache, as the room she is in goes away. */
  release(): void {
    this.appearance.release();
  }
}
