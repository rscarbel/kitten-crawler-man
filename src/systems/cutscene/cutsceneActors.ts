import { PLAYER_SPEED } from '../../core/constants';
import type { Townsperson } from '../../creatures/Townsperson';
import type { GameMap } from '../../map/GameMap';
import type { MobilityClass } from '../../map/mobility';
import type { Player } from '../../Player';
import { applyMovement, type MovementInput, type SouthCollisionAnchor } from '../GameLoopPhases';
import type { CutscenePoint } from './cutsceneCamera';
import type { CutsceneFacing } from './cutsceneSteps';

/** A unit heading for one tick of a scripted walk. */
export type CutsceneHeading = Pick<MovementInput, 'dx' | 'dy'>;

export const FACING_VECTORS: Readonly<Record<CutsceneFacing, CutsceneHeading>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Whatever a script moves, made to answer one shape. The scene builds one per
 * body it lends to its scripts and registers it under a typed id; the
 * director never touches the body except through here.
 *
 * Positions are a body's tile-origin pixels, the same `x`/`y` a crawler and a
 * townsperson keep, so `tile * TILE_SIZE` is standing on that tile.
 */
export interface CutsceneActor {
  /** The object the scene draws, which it asks `CutsceneDirector.hides` about in its render pass. */
  readonly body: object;
  readonly mobility: MobilityClass;
  /** How far one tick of the actor's own walk carries them, which a walk's time allowance is sized by. */
  readonly walkPxPerTick: number;
  readonly position: () => CutscenePoint;
  /** One tick of a scripted walk along `heading`, at the actor's own pace; null stands them still. */
  readonly walk: (heading: CutsceneHeading | null) => void;
  /** Sets the actor down at `at` without a step: each tick of a glide, and a walk that ran out of time. */
  readonly place: (at: CutscenePoint) => void;
  readonly face: (facing: CutsceneFacing) => void;
  /**
   * While held, whatever usually moves this body (its AI, the companion
   * drive, a wander) leaves it to the script. Held for the whole of every
   * script that moves the actor, and let go when that script ends.
   */
  readonly hold: (held: boolean) => void;
}

/**
 * Looks actors up by the scene's typed ids. A registration is a lookup rather
 * than a body, so an actor that is not in the world at the moment (a mob not
 * yet spawned, a cat away with her group) answers null, and a step naming it
 * moves straight on.
 */
export class CutsceneActorRegistry<ActorId extends string> {
  private readonly finders = new Map<ActorId, () => CutsceneActor | null>();

  /** Lends `find`'s actor to scripts as `id`, replacing any earlier one. Returns the unregister. */
  register(id: ActorId, find: () => CutsceneActor | null): () => void {
    this.finders.set(id, find);
    return () => {
      if (this.finders.get(id) === find) this.finders.delete(id);
    };
  }

  find(id: ActorId): CutsceneActor | null {
    return this.finders.get(id)?.() ?? null;
  }
}

function faceBody(body: Player, facing: CutsceneFacing): void {
  const vector = FACING_VECTORS[facing];
  body.facingX = vector.dx;
  body.facingY = vector.dy;
}

/** How a body actor is moved, and what holds it. */
export interface BodyActorOptions {
  readonly map: () => GameMap;
  readonly southAnchor: SouthCollisionAnchor;
  readonly hold: (held: boolean) => void;
}

/**
 * A crawler, companion or quest NPC: anything built on `Player` that walks by
 * `applyMovement`, at a crawler's pace and with a crawler's collision.
 */
export function bodyActor(body: Player, options: BodyActorOptions): CutsceneActor {
  return {
    body,
    mobility: body.mobility,
    walkPxPerTick: PLAYER_SPEED,
    position: () => ({ x: body.x, y: body.y }),
    walk: (heading) => {
      if (heading === null) {
        body.isMoving = false;
        return;
      }
      applyMovement(body, { ...heading, isMobile: true }, options.map(), options.southAnchor);
    },
    place: (at) => {
      body.x = at.x;
      body.y = at.y;
      body.isMoving = false;
    },
    face: (facing) => faceBody(body, facing),
    hold: options.hold,
  };
}

/** An interior occupant or a townsperson in the street, at their own walking pace. */
export function townspersonActor(person: Townsperson): CutsceneActor {
  return {
    body: person,
    mobility: 'walker',
    walkPxPerTick: person.speed,
    position: () => ({ x: person.x, y: person.y }),
    walk: (heading) => person.walkScripted(heading),
    place: (at) => person.placeScripted(at),
    face: (facing) => {
      const vector = FACING_VECTORS[facing];
      person.faceToward(person.x + vector.dx, person.y + vector.dy);
    },
    hold: (held) => {
      person.scripted = held;
    },
  };
}

/**
 * A body a scene paints for its scripts alone: no AI, no roster, no
 * collision. A creature dropping out of the dark, a carrier thrown aside, a
 * cat walking in at a door. Its system draws it at `x`/`y` (tile-origin
 * pixels) facing along `facingX`/`facingY`, and leaves it out while the
 * director hides it.
 */
export interface StagedBody {
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  isMoving: boolean;
}

/**
 * A staged body, stepped straight along each heading at `walkPxPerTick`. Its
 * walks follow the pathfinder's waypoints, so the ground it crosses is
 * already ground its mobility class may stand on; a glide carries it anywhere.
 */
export function stagedActor(
  body: StagedBody,
  walkPxPerTick: number,
  mobility: MobilityClass,
): CutsceneActor {
  const faceAlong = (heading: CutsceneHeading): void => {
    body.facingX = heading.dx;
    body.facingY = heading.dy;
  };
  return {
    body,
    mobility,
    walkPxPerTick,
    position: () => ({ x: body.x, y: body.y }),
    walk: (heading) => {
      if (heading === null) {
        body.isMoving = false;
        return;
      }
      body.x += heading.dx * walkPxPerTick;
      body.y += heading.dy * walkPxPerTick;
      body.isMoving = true;
      faceAlong(heading);
    },
    place: (at) => {
      body.x = at.x;
      body.y = at.y;
      body.isMoving = false;
    },
    face: (facing) => faceAlong(FACING_VECTORS[facing]),
    hold: () => undefined,
  };
}
