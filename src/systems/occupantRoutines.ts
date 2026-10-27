/**
 * Behaviours an interior occupant runs on top of standing and wandering: a
 * janitor mopping their way round the room, a marksman shooting at a target.
 *
 * Each routine owns its own timers and decides what the occupant is drawn
 * doing (`Townsperson.routinePose`) while they stand still, how long each
 * pose plays (asked of the figure that paints it) and which sounds it raises
 * on the pose's beats. A new routine is a new `OccupantRoutine` member and a
 * case in `startOccupantRoutine`, whose switch fails to compile until it is
 * handled.
 */

import { TILE_SIZE } from '../core/constants';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { GameMap } from '../map/GameMap';
import type { Townsperson } from '../creatures/Townsperson';
import type { RoutinePoseId } from '../creatures/routinePose';
import { townspersonReleasePoint, townspersonRoutineTiming } from '../creatures/townspersonBody';
import { drawSteveBolt, drawSteveBoltStuck } from '../sprites/steveSprite';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorPropId,
} from '../sprites/art/townInterior/townInteriorProps';
import type { OccupantRoutineCue } from './occupantRoutineCues';

export type OccupantRoutine =
  | { readonly kind: 'mop' }
  | { readonly kind: 'target_practice'; readonly targetProp: TownInteriorPropId };

/** A body a shot must not cross, as its world-pixel box. */
export interface RoutineBody {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Something standing in the room, by the world-pixel origin of the tile it stands on. */
interface Positioned {
  readonly x: number;
  readonly y: number;
}

/**
 * Who of the party is in the room, read off the systems that keep them. Each
 * companion is counted whatever state it is in: a recalling pet, a hire lying
 * downed and a cow getting to her feet are all still bodies a shot would pass
 * through, even though none of them is anyone's target.
 */
export interface RoutineParty {
  readonly crawlers: ReadonlyArray<Positioned>;
  readonly pet: { readonly mongo: Positioned | null };
  readonly hire: {
    readonly activeMerc: Positioned | null;
    readonly downedMerc: Positioned | null;
  };
  readonly cow: { readonly cow: Positioned | null };
}

/** Every party body present in the room, as the boxes an occupant's routine must not shoot through. */
export function partyRoutineBodies(party: RoutineParty): RoutineBody[] {
  const present: Array<Positioned | null> = [
    ...party.crawlers,
    party.pet.mongo,
    party.hire.activeMerc ?? party.hire.downedMerc,
    party.cow.cow,
  ];
  return present.flatMap((body) => (body === null ? [] : [routineBodyAt(body)]));
}

/** The one-tile box a figure standing at `at` fills. */
export function routineBodyAt(at: Positioned): RoutineBody {
  return { x: at.x, y: at.y, w: TILE_SIZE, h: TILE_SIZE };
}

/** What a routine may read of the room around it, and how it is heard. */
export interface RoutineWorld {
  readonly map: GameMap;
  /** Everyone in the room but the occupant running the routine, read each frame. */
  readonly bodies: () => ReadonlyArray<RoutineBody>;
  /** Plays one of the routine's sounds from a world point. */
  readonly playCue: (cue: OccupantRoutineCue, x: number, y: number) => void;
}

export interface RoutineRunner {
  /** Runs before the occupant's own update each frame. */
  update(person: Townsperson): void;
  /** What the routine leaves in the room to be drawn in the Y-sorted pass: a bolt in flight, one in the target. */
  figures(): ReadonlyArray<InteriorFigure>;
}

/**
 * Starts `routine` for `person`, or returns null when the room lacks what it
 * needs (a target practice with no target to face).
 */
export function startOccupantRoutine(
  routine: OccupantRoutine,
  person: Townsperson,
  world: RoutineWorld,
): RoutineRunner | null {
  switch (routine.kind) {
    case 'mop':
      return mopRoutine(world);
    case 'target_practice':
      return targetPracticeRoutine(routine.targetProp, person, world);
    default: {
      const unhandled: never = routine;
      throw new Error(`unhandled occupant routine ${JSON.stringify(unhandled)}`);
    }
  }
}

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const HALF = 0.5;

/** Frames one play of `pose` lasts for this person's figure. */
function poseFrames(person: Townsperson, pose: RoutinePoseId): number {
  const { durationMs } = townspersonRoutineTiming(person.body, pose);
  return Math.max(1, Math.round((durationMs * FRAMES_PER_SECOND) / MS_PER_SECOND));
}

/**
 * Raises `cue` for every beat of `pose` the step from frame `frame` to the
 * next crosses, so a beat at progress 0 sounds on the pose's first frame.
 */
function soundBeats(
  person: Townsperson,
  pose: RoutinePoseId,
  frame: number,
  frames: number,
  onBeat: () => void,
): void {
  const from = frame / frames;
  const to = (frame + 1) / frames;
  for (const beat of townspersonRoutineTiming(person.body, pose).beats) {
    if (beat >= from && beat < to) onBeat();
  }
}

function centreOf(person: Townsperson): { x: number; y: number } {
  return { x: person.x + TILE_SIZE * HALF, y: person.y + TILE_SIZE * HALF };
}

// ── Mop ──────────────────────────────────────────────────────────────────────

/** Two-stroke mop cycles worked over one spot before the mop goes back in the bucket. */
const MOP_CYCLES_PER_SPOT = 3;

const MOP_CUE: Readonly<Record<'mop' | 'wring', OccupantRoutineCue>> = {
  mop: 'mopSwish',
  wring: 'mopSlosh',
};

/**
 * Walks the territory and works the floor wherever a stroll ends: a few
 * strokes over the spot, then a wring in the bucket, then on to the next. A
 * spot once started is finished before the stroll resumes, so the mop never
 * leaves mid-stroke.
 */
function mopRoutine(world: RoutineWorld): RoutineRunner {
  let pose: 'mop' | 'wring' | null = null;
  let frame = 0;
  let cyclesLeft = 0;
  return {
    update(person) {
      if (person.held) return;
      if (person.moving) {
        pose = null;
        person.routinePose = null;
        return;
      }
      if (pose === null) {
        pose = 'mop';
        frame = 0;
        cyclesLeft = MOP_CYCLES_PER_SPOT;
      }
      const working = pose;
      const frames = poseFrames(person, working);
      person.pause = Math.max(person.pause, 1);
      person.routinePose = { id: working, progress: frame / frames };
      soundBeats(person, working, frame, frames, () => {
        const at = centreOf(person);
        world.playCue(MOP_CUE[working], at.x, at.y);
      });
      frame++;
      if (frame < frames) return;
      frame = 0;
      if (working === 'mop' && --cyclesLeft > 0) return;
      if (working === 'mop') {
        pose = 'wring';
        return;
      }
      // The spot is done, so he sets off for the next one.
      pose = null;
      person.pause = 0;
      person.routinePose = null;
    },
    figures: () => [],
  };
}

// ── Target practice ──────────────────────────────────────────────────────────

/** The fewest frames the shot is held levelled before it is loosed. */
const TARGET_AIM_HOLD_FRAMES = 75;
/** How long the line must stay clear before a held shot resumes, so a crawler stepping through doesn't get shot the frame they leave it. */
const TARGET_RESUME_DELAY_FRAMES = 60;
/** Tiles a bolt flies each frame. */
const BOLT_SPEED_TILES_PER_FRAME = 0.45;
const BOLT_SPEED_PX_PER_FRAME = TILE_SIZE * BOLT_SPEED_TILES_PER_FRAME;
/** How long a bolt stays in the target before it starts to fade. */
const BOLT_STUCK_FRAMES = 150;
const BOLT_FADE_FRAMES = 30;
/**
 * How far above a target's feet its painted face is, in tiles: a butt's
 * boss and a board's face both stand about a tile up on their frames, and a
 * bolt that drove into the feet would read as a miss.
 */
const TARGET_FACE_HEIGHT_TILES = 0.95;
/**
 * Where successive bolts land on the face, in tiles from its centre: a loose
 * group rather than every bolt in one hole.
 */
const BOLT_GROUPING: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0.05, y: -0.04 },
  { x: -0.12, y: 0.08 },
  { x: 0.14, y: 0.1 },
  { x: -0.04, y: -0.14 },
  { x: 0.02, y: 0.16 },
];

type ShotPhase = 'aim' | 'shoot' | 'reload';

interface Bolt {
  x: number;
  y: number;
  readonly toX: number;
  readonly toY: number;
  readonly heading: number;
  ageFrames: number;
  /** Frames since it struck, or null while it is still flying. */
  stuckFrames: number | null;
}

/**
 * Holds the post facing the nearest `targetProp` and cycles aim, shot and
 * reload. The bolt is cosmetic: it flies to the target's face, sticks there a
 * moment and fades, and never touches anything on the way.
 *
 * Fire is held, back at aim, while any body overlaps the line from the
 * crossbow to the target, and resumes once it has stayed clear for
 * {@link TARGET_RESUME_DELAY_FRAMES}. A shot already loosed or a reload
 * already under way plays out; only the loosing waits. A bolt still in flight
 * when someone steps into what is left of its path is dropped there, since
 * drawing it on through them would read as a shot that passed through a body.
 */
function targetPracticeRoutine(
  targetProp: TownInteriorPropId,
  person: Townsperson,
  world: RoutineWorld,
): RoutineRunner | null {
  const target = targetFaceOf(world.map, targetProp, person.x, person.y);
  if (target === null) return null;
  let phase: ShotPhase = 'aim';
  let frame = 0;
  /** Runs on through every aim, held or not, so the levelled crossbow keeps breathing. */
  let aimLoopFrame = 0;
  let clearFrames = 0;
  let shotsLoosed = 0;
  const bolts: Bolt[] = [];

  const muzzleOf = (shooter: Townsperson): { x: number; y: number } => {
    const facing = shooter.facingXY();
    const release = townspersonReleasePoint(shooter.body, facing.x, facing.y);
    return { x: shooter.x + release.x * TILE_SIZE, y: shooter.y + release.y * TILE_SIZE };
  };

  const loose = (shooter: Townsperson): void => {
    const from = muzzleOf(shooter);
    const spot = BOLT_GROUPING[shotsLoosed % BOLT_GROUPING.length] ?? { x: 0, y: 0 };
    shotsLoosed++;
    const toX = target.x + spot.x * TILE_SIZE;
    const toY = target.y + spot.y * TILE_SIZE;
    bolts.push({
      x: from.x,
      y: from.y,
      toX,
      toY,
      heading: Math.atan2(toY - from.y, toX - from.x),
      ageFrames: 0,
      stuckFrames: null,
    });
    world.playCue('crossbowRelease', from.x, from.y);
  };

  const pathBlocked = (bolt: Bolt): boolean => {
    const to = { x: bolt.toX, y: bolt.toY };
    return world.bodies().some((body) => segmentCrossesBox(bolt, to, body));
  };

  const advanceBolts = (): void => {
    const dropped: Bolt[] = [];
    for (const bolt of bolts) {
      bolt.ageFrames++;
      if (bolt.stuckFrames !== null) {
        bolt.stuckFrames++;
        continue;
      }
      if (pathBlocked(bolt)) {
        dropped.push(bolt);
        continue;
      }
      const remaining = Math.hypot(bolt.toX - bolt.x, bolt.toY - bolt.y);
      if (remaining <= BOLT_SPEED_PX_PER_FRAME) {
        bolt.x = bolt.toX;
        bolt.y = bolt.toY;
        bolt.stuckFrames = 0;
        world.playCue('boltThunk', bolt.x, bolt.y);
        continue;
      }
      bolt.x += Math.cos(bolt.heading) * BOLT_SPEED_PX_PER_FRAME;
      bolt.y += Math.sin(bolt.heading) * BOLT_SPEED_PX_PER_FRAME;
    }
    const faded = bolts.filter(
      (bolt) =>
        bolt.stuckFrames !== null && bolt.stuckFrames >= BOLT_STUCK_FRAMES + BOLT_FADE_FRAMES,
    );
    for (const bolt of [...dropped, ...faded]) bolts.splice(bolts.indexOf(bolt), 1);
  };

  const lineOfFireBlocked = (shooter: Townsperson): boolean => {
    const from = muzzleOf(shooter);
    return world.bodies().some((body) => segmentCrossesBox(from, target, body));
  };

  return {
    update(shooter) {
      advanceBolts();
      shooter.pause = Math.max(shooter.pause, 1);
      if (shooter.held) return;
      shooter.faceToward(target.x, target.y);
      const blocked = lineOfFireBlocked(shooter);
      if (blocked) clearFrames = TARGET_RESUME_DELAY_FRAMES;
      else if (clearFrames > 0) clearFrames--;
      const holding = blocked || clearFrames > 0;

      if (phase === 'aim') {
        const frames = poseFrames(shooter, 'aim');
        shooter.routinePose = { id: 'aim', progress: (aimLoopFrame % frames) / frames };
        aimLoopFrame++;
        frame = holding ? 0 : frame + 1;
        if (frame >= TARGET_AIM_HOLD_FRAMES) {
          phase = 'shoot';
          frame = 0;
        }
        return;
      }

      const frames = poseFrames(shooter, phase);
      if (phase === 'shoot' && holding && !beatPassed(shooter, 'shoot', frame, frames)) {
        phase = 'aim';
        frame = 0;
        return;
      }
      const playing = phase;
      shooter.routinePose = { id: playing, progress: frame / frames };
      soundBeats(shooter, playing, frame, frames, () => {
        if (playing === 'shoot') loose(shooter);
        else {
          const at = muzzleOf(shooter);
          world.playCue('crossbowReload', at.x, at.y);
        }
      });
      frame++;
      if (frame < frames) return;
      frame = 0;
      phase = playing === 'shoot' ? 'reload' : 'aim';
    },
    figures: () => bolts.map((bolt) => boltFigure(bolt, target.footY)),
  };
}

/** Whether every beat of `pose` has already sounded by frame `frame`: a shot past it is loosed. */
function beatPassed(
  person: Townsperson,
  pose: RoutinePoseId,
  frame: number,
  frames: number,
): boolean {
  const progress = frame / frames;
  return townspersonRoutineTiming(person.body, pose).beats.every((beat) => beat < progress);
}

/**
 * A bolt for the Y-sorted pass. In flight it sorts at its own height; once in
 * the target it sorts just in front of the target's feet, so the target never
 * paints over the bolt standing out of its face.
 */
function boltFigure(bolt: Bolt, targetFootY: number): InteriorFigure {
  const sortsAt = bolt.stuckFrames === null ? bolt.y : targetFootY;
  return {
    y: sortsAt - TILE_SIZE + 1,
    render(ctx, camX, camY, tileSize) {
      const sx = bolt.x - camX;
      const sy = bolt.y - camY;
      if (bolt.stuckFrames === null) {
        drawSteveBolt(ctx, sx, sy, tileSize, bolt.heading, bolt.ageFrames / FRAMES_PER_SECOND);
        return;
      }
      const fading = Math.max(0, bolt.stuckFrames - BOLT_STUCK_FRAMES);
      drawSteveBoltStuck(ctx, sx, sy, tileSize, bolt.heading, 1 - fading / BOLT_FADE_FRAMES);
    },
  };
}

/** The face of the nearest `propId`, and the world y its feet stand on. */
function targetFaceOf(
  map: GameMap,
  propId: TownInteriorPropId,
  fromX: number,
  fromY: number,
): { x: number; y: number; footY: number } | null {
  let best: { x: number; y: number; footY: number } | null = null;
  let bestDistance = Infinity;
  for (const placed of map.placedInteriorProps) {
    if (placed.propId !== propId) continue;
    const { w, h } = TOWN_INTERIOR_PROPS[propId].footprint;
    const x = (placed.tile.x + w * HALF) * TILE_SIZE;
    const footY = (placed.tile.y + h) * TILE_SIZE;
    const y = footY - TARGET_FACE_HEIGHT_TILES * TILE_SIZE;
    const distance = Math.hypot(x - fromX, y - fromY);
    if (distance >= bestDistance) continue;
    best = { x, y, footY };
    bestDistance = distance;
  }
  return best;
}

/**
 * Whether the segment from `from` to `to` passes through `box` (edges
 * included): the slab test, clipping the segment's parameter range against
 * the box one axis at a time.
 */
function segmentCrossesBox(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  box: RoutineBody,
): boolean {
  let enter = 0;
  let exit = 1;
  const axes = [
    { start: from.x, delta: to.x - from.x, min: box.x, max: box.x + box.w },
    { start: from.y, delta: to.y - from.y, min: box.y, max: box.y + box.h },
  ];
  for (const { start, delta, min, max } of axes) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}
