/**
 * The cutscene director's general steps, run headless against a generated
 * interior: a named actor's walk, the snap a walk that cannot finish falls
 * back to, glides that run together and are joined, hiding and showing, the
 * hold a script keeps on what it moves, the fade, a wait timed to a cue's own
 * clock, and a scene's world action.
 *
 * Each fault breaks one thing the checks lean on, and the run must go red
 * under it.
 */

import { TILE_SIZE } from '../src/core/constants';
import { Conversation } from '../src/dialog/Conversation';
import type { GameMap } from '../src/map/GameMap';
import type { Player } from '../src/Player';
import {
  runInteriorWorldAction,
  type InteriorActorId,
  type InteriorWorldAction,
} from '../src/scenes/interiorCutscene';
import type { CutsceneActor, CutsceneHeading } from '../src/systems/cutscene/cutsceneActors';
import type { CutscenePoint } from '../src/systems/cutscene/cutsceneCamera';
import {
  CUE_CLOCK_STALL_GRACE_S,
  CutsceneDirector,
  SILENT_CUE_CLOCK,
  WALK_UP_TIMEOUT_FRAMES,
  WORLD_TICKS_PER_SECOND,
  type CutsceneCueClock,
} from '../src/systems/cutscene/CutsceneDirector';
import {
  FADE_HOLD_AFTER_SCRIPT_FRAMES,
  FADE_RECOVERY_FRAMES,
} from '../src/systems/cutscene/cutsceneFade';
import type {
  CutsceneFacing,
  CutsceneScript,
  CutsceneTile,
} from '../src/systems/cutscene/cutsceneSteps';

export const CUTSCENE_STEP_FAULTS = [
  /** The actor's own walk goes nowhere, so only the timeout's snap can end the walk. */
  'walk-goes-nowhere',
  /** Setting the actor down does nothing, so a walk that cannot finish leaves them short. */
  'place-does-nothing',
  /** The scene lends the cat's body under the human's id. */
  'actor-misregistered',
  /** The actor's hold is never passed on to what usually moves it. */
  'hold-ignored',
  /** The two glides wait for each other instead of running together. */
  'glides-in-turn',
  /** The fade is written with no frames, so it cuts rather than eases. */
  'fade-cuts',
  /** The cue never really starts, so its waits count world ticks instead of the audio clock. */
  'cue-never-starts',
  /** The scene's action host drops the action it is handed. */
  'action-dropped',
] as const;

export type CutsceneStepFault = (typeof CUTSCENE_STEP_FAULTS)[number];

type Check = (ok: boolean, label: string) => void;

/** How many tiles of open floor the walk crosses. */
const WALK_TILES = 4;
/** A walking pace slow enough that the walk takes many ticks, fast enough to finish well inside the timeout. */
const PROBE_WALK_PX_PER_TICK = 2;
/** More ticks than any script here needs, so a hung step reports rather than spins. */
const MAX_TICKS = 6000;
const GLIDE_FRAMES = 40;
/** The second glide is the longer of the two, so the join waits on it. */
const LONG_GLIDE_FRAMES = 70;
const GLIDE_TILES = 3;
const FADE_FRAMES = 30;
const HALF = 0.5;
/** How far from half-dark the fade may be at its midpoint, allowing for the tick it starts on. */
const FADE_MIDPOINT_TOLERANCE = 0.1;
/** The mark a timed wait is set for, in seconds into the cue. */
const CUE_MARK_S = 5;
/**
 * The fake audio clock runs this much slower than the world: slow enough that
 * a wait counting ticks ends visibly early, not so slow that the stall grace
 * cuts it short.
 */
const SLOW_AUDIO_RATE = 0.8;
/** How close to its mark, in ticks, a timed wait must end. */
const CUE_TICK_TOLERANCE = 2;

interface ProbeActor {
  readonly actor: CutsceneActor;
  readonly at: { x: number; y: number };
  readonly held: boolean;
  readonly facing: CutsceneFacing | null;
}

function probeActor(start: CutsceneTile, fault: CutsceneStepFault | null): ProbeActor {
  const at = { x: start.x * TILE_SIZE, y: start.y * TILE_SIZE };
  const state: { held: boolean; facing: CutsceneFacing | null } = { held: false, facing: null };
  const actor: CutsceneActor = {
    body: at,
    mobility: 'walker',
    walkPxPerTick: PROBE_WALK_PX_PER_TICK,
    position: () => ({ x: at.x, y: at.y }),
    walk: (heading: CutsceneHeading | null) => {
      if (heading === null || fault === 'walk-goes-nowhere') return;
      at.x += heading.dx * PROBE_WALK_PX_PER_TICK;
      at.y += heading.dy * PROBE_WALK_PX_PER_TICK;
    },
    place: (point: CutscenePoint) => {
      if (fault === 'place-does-nothing') return;
      at.x = point.x;
      at.y = point.y;
    },
    face: (facing) => {
      state.facing = facing;
    },
    hold: (held) => {
      if (fault !== 'hold-ignored') state.held = held;
    },
  };
  return {
    actor,
    at,
    get held() {
      return state.held;
    },
    get facing() {
      return state.facing;
    },
  };
}

function onTile(probe: ProbeActor, tile: CutsceneTile): boolean {
  return probe.at.x === tile.x * TILE_SIZE && probe.at.y === tile.y * TILE_SIZE;
}

/** The west end of the first run of open floor `WALK_TILES` long, and its east end. */
function findWalk(map: GameMap): { from: CutsceneTile; to: CutsceneTile } | null {
  for (let y = 0; y < map.structure.length; y++) {
    const row = map.structure[y];
    for (let x = 0; x + WALK_TILES < row.length; x++) {
      let open = true;
      for (let step = 0; step <= WALK_TILES && open; step++) {
        open = map.isWalkable(x + step, y, 'walker');
      }
      if (open) return { from: { x, y }, to: { x: x + WALK_TILES, y } };
    }
  }
  return null;
}

interface Rig {
  readonly director: CutsceneDirector<InteriorWorldAction, InteriorActorId>;
  readonly ran: InteriorWorldAction[];
}

function makeRig(fault: CutsceneStepFault | null, cueClock: CutsceneCueClock): Rig {
  const ran: InteriorWorldAction[] = [];
  const director = new CutsceneDirector<InteriorWorldAction, InteriorActorId>({
    conversation: new Conversation(null),
    teleportDaveOut: () => undefined,
    playSound: () => undefined,
    runWorldAction: (action) =>
      runInteriorWorldAction(action, {
        setPartyDown: (recorded) => {
          if (fault !== 'action-dropped') ran.push(recorded);
        },
      }),
    cueClock,
  });
  return { director, ran };
}

/** Ticks until the director lets go, and returns how many ticks that took. */
function runOut(
  director: CutsceneDirector<InteriorWorldAction, InteriorActorId>,
  active: Player,
  map: GameMap,
  each: (tick: number) => void = () => undefined,
): number {
  let ticks = 0;
  while (director.isActive && ticks < MAX_TICKS) {
    director.tickEffects();
    director.tickWorld(active, map);
    ticks++;
    each(ticks);
  }
  return ticks;
}

export function runCutsceneStepChecks(
  map: GameMap,
  active: Player,
  fault: CutsceneStepFault | null,
  check: Check,
): void {
  const walk = findWalk(map);
  check(walk !== null, `fixture: the room has ${WALK_TILES + 1} tiles of open floor in a row`);
  if (walk === null) return;

  {
    const { director } = makeRig(fault, SILENT_CUE_CLOCK);
    const human = probeActor(walk.from, fault);
    const cat = probeActor(walk.from, fault);
    director.actors.register('human', () => human.actor);
    director.actors.register('cat', () =>
      fault === 'actor-misregistered' ? human.actor : cat.actor,
    );
    let heldMidWalk = false;
    director.play([
      { kind: 'walkTo', who: 'cat', tile: walk.to, face: 'down', then: 'waitForArrival' },
    ]);
    const ticks = runOut(director, active, map, () => {
      heldMidWalk ||= cat.held;
    });
    check(
      onTile(cat, walk.to) && ticks < WALK_UP_TIMEOUT_FRAMES,
      `walkTo: a named actor walks ${WALK_TILES} tiles and the step ends on arrival (${ticks} ticks)`,
    );
    check(cat.facing === 'down', 'walkTo: and turns to the facing the step names');
    check(onTile(human, walk.from), 'walkTo: the other actor is not moved');
    check(heldMidWalk && !cat.held, 'hold: the actor is held while walked and let go after');
  }

  {
    const { director } = makeRig(fault, SILENT_CUE_CLOCK);
    const stuck = probeActor(walk.from, 'walk-goes-nowhere');
    const placer = probeActor(walk.from, fault);
    director.actors.register('cat', () => ({ ...stuck.actor, place: placer.actor.place }));
    director.play([
      { kind: 'walkTo', who: 'cat', tile: walk.to, face: 'left', then: 'waitForArrival' },
    ]);
    const ticks = runOut(director, active, map);
    check(
      !director.isActive && ticks < MAX_TICKS,
      `walkTo: a walk that goes nowhere still ends (${ticks} ticks)`,
    );
    check(onTile(placer, walk.to), 'walkTo: and sets the actor down on its tile');
  }

  {
    const { director } = makeRig(fault, SILENT_CUE_CLOCK);
    const human = probeActor(walk.from, fault);
    const cat = probeActor(walk.from, fault);
    director.actors.register('human', () => human.actor);
    director.actors.register('cat', () => cat.actor);
    const glideEnd = (tiles: number): CutscenePoint => ({
      x: (walk.from.x + tiles) * TILE_SIZE,
      y: walk.from.y * TILE_SIZE,
    });
    const firstThen = fault === 'glides-in-turn' ? 'waitForArrival' : 'carryOn';
    director.play([
      {
        kind: 'glideTo',
        who: 'human',
        to: glideEnd(GLIDE_TILES),
        frames: GLIDE_FRAMES,
        face: null,
        then: firstThen,
      },
      {
        kind: 'glideTo',
        who: 'cat',
        to: glideEnd(1),
        frames: LONG_GLIDE_FRAMES,
        face: 'up',
        then: 'carryOn',
      },
      { kind: 'awaitActor', who: 'cat' },
    ]);
    let bothMovingAtOnce = false;
    const ticks = runOut(director, active, map, () => {
      const humanMoving =
        human.at.x !== walk.from.x * TILE_SIZE && human.at.x !== glideEnd(GLIDE_TILES).x;
      const catMoving = cat.at.x !== walk.from.x * TILE_SIZE && cat.at.x !== glideEnd(1).x;
      bothMovingAtOnce ||= humanMoving && catMoving;
    });
    check(bothMovingAtOnce, 'glideTo: two glides set off with carryOn run together');
    check(
      human.at.x === glideEnd(GLIDE_TILES).x && cat.at.x === glideEnd(1).x,
      'glideTo: each ends exactly where it was sent',
    );
    check(
      Math.abs(ticks - LONG_GLIDE_FRAMES) <= CUE_TICK_TOLERANCE,
      `awaitActor: the script ends with the longer glide (${ticks} ticks)`,
    );
  }

  {
    const { director } = makeRig(fault, SILENT_CUE_CLOCK);
    const human = probeActor(walk.from, fault);
    const cat = probeActor(walk.from, fault);
    director.actors.register('human', () => human.actor);
    director.actors.register('cat', () =>
      fault === 'actor-misregistered' ? human.actor : cat.actor,
    );
    director.play([{ kind: 'hideActor', who: 'cat' }]);
    runOut(director, active, map);
    check(
      director.hides(cat.at) && !director.hides(human.at),
      'hideActor: only the named actor is hidden, past the end of the script',
    );
    director.play([{ kind: 'showActor', who: 'cat' }]);
    runOut(director, active, map);
    check(!director.hides(cat.at), 'showActor: and is seen again');
  }

  {
    const { director } = makeRig(fault, SILENT_CUE_CLOCK);
    const frames = fault === 'fade-cuts' ? 0 : FADE_FRAMES;
    director.play([{ kind: 'fade', to: 1, frames }]);
    const halfway = Math.round(FADE_FRAMES * HALF);
    let alphaHalfway = 0;
    const ticks = runOut(director, active, map, (tick) => {
      if (tick === halfway) alphaHalfway = director.fadeAlpha;
    });
    check(
      Math.abs(alphaHalfway - HALF) <= FADE_MIDPOINT_TOLERANCE,
      `fade: eases, half dark halfway (${alphaHalfway.toFixed(2)})`,
    );
    check(
      director.fadeAlpha === 1 && ticks >= FADE_FRAMES,
      'fade: and holds the script until black',
    );
    for (let tick = 0; tick < FADE_HOLD_AFTER_SCRIPT_FRAMES; tick++) director.tickEffects();
    check(director.fadeAlpha === 1, 'fade: a script that ends black stays black for the hand-over');
    for (let tick = 0; tick <= FADE_RECOVERY_FRAMES + 1; tick++) director.tickEffects();
    check(director.fadeAlpha === 0, 'fade: then clears on its own');
  }

  {
    let audioNowS = 0;
    const slowClock: CutsceneCueClock = {
      start: () => (fault === 'cue-never-starts' ? null : audioNowS),
      nowS: () => audioNowS,
    };
    const { director } = makeRig(fault, slowClock);
    director.play([
      { kind: 'playCue', cue: 'capture_at_dusk' },
      { kind: 'waitForCue', cue: 'capture_at_dusk', atS: CUE_MARK_S },
    ]);
    const ticks = runOut(director, active, map, () => {
      audioNowS += SLOW_AUDIO_RATE / WORLD_TICKS_PER_SECOND;
    });
    const expected = (CUE_MARK_S / SLOW_AUDIO_RATE) * WORLD_TICKS_PER_SECOND;
    const stallCap = (CUE_MARK_S + CUE_CLOCK_STALL_GRACE_S) * WORLD_TICKS_PER_SECOND;
    check(
      expected < stallCap && Math.abs(ticks - expected) <= CUE_TICK_TOLERANCE,
      `waitForCue: the wait follows the cue's audio clock, not the world's ticks (${ticks} ticks)`,
    );

    const frozen: CutsceneCueClock = { start: () => 0, nowS: () => 0 };
    const stalled = makeRig(fault, frozen).director;
    stalled.play([
      { kind: 'playCue', cue: 'capture_at_dusk' },
      { kind: 'waitForCue', cue: 'capture_at_dusk', atS: CUE_MARK_S },
    ]);
    const stalledTicks = runOut(stalled, active, map);
    check(
      Math.abs(stalledTicks - stallCap) <= CUE_TICK_TOLERANCE,
      `waitForCue: a clock that never moves lets the script go after its grace (${stalledTicks} ticks)`,
    );
  }

  {
    const { director, ran } = makeRig(fault, SILENT_CUE_CLOCK);
    const script: CutsceneScript<InteriorWorldAction, InteriorActorId> = [
      { kind: 'run', action: { kind: 'setPartyDown', tile: walk.to } },
    ];
    director.play(script);
    runOut(director, active, map);
    const [landed] = ran;
    check(
      ran.length === 1 && landed.tile.x === walk.to.x && landed.tile.y === walk.to.y,
      'run: the interior is handed its world action, payload intact',
    );
  }
}
