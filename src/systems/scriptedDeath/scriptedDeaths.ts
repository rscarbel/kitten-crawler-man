import {
  drawSharkAttackSprite,
  drawSharkBloodPoolSprite,
  SHARK_ATTACK_FRAMES,
  SHARK_ATTACK_TAKEN_FRAME,
} from '../../sprites/sharkAttackSprite';
import {
  drawTimeLimitBloodPoolSprite,
  drawTimeLimitDetonationSprite,
  TIME_LIMIT_DETONATION_BODY_RISE_TILES,
  TIME_LIMIT_DETONATION_FRAMES,
  TIME_LIMIT_DETONATION_TAKEN_FRAME,
} from '../../sprites/timeLimitDetonationSprite';
import type { DeathCause } from '../../ui/DeathExplanations';
import type { CutsceneSoundCue } from '../cutscene/cutsceneSteps';
import { SCRIPTED_DEATH_CUES } from './scriptedDeathCues';
import type { ScriptedDeathKind } from './scriptedDeathKinds';

/**
 * Paints one frame of a scripted death, or its decal `frame` ticks after it
 * appeared, centred on the screen point where the victim stood.
 */
export type ScriptedDeathPainter = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  screenX: number,
  screenY: number,
  tileSize: number,
) => void;

/** A direction a burst of blood is thrown along, as a unit vector. */
export interface GoreThrow {
  readonly dx: number;
  readonly dy: number;
}

/** The blood a death throws from the victim's body the moment they are taken. */
export interface ScriptedDeathGore {
  /** How far above the point the death is centred on the blood bursts from, in tiles. */
  readonly riseTiles: number;
  /** One heavy burst per entry, each thrown its own way. */
  readonly bursts: readonly GoreThrow[];
}

export interface ScriptedDeathDef {
  /** The animation played where the victim stood, a world tick per frame. */
  readonly animation: {
    readonly paint: ScriptedDeathPainter;
    readonly frames: number;
    /** The frame the victim is taken: they are not drawn from it on, and the decal starts. */
    readonly takenAtFrame: number;
  };
  /** What stays on the ground once the animation is over, painted under every body. */
  readonly decal: ScriptedDeathPainter;
  /** Blood thrown at the moment the victim is taken; null for a death that throws none. */
  readonly gore: ScriptedDeathGore | null;
  /** World ticks from the start until the victim dies and the death screen follows. */
  readonly deathDelayFrames: number;
  readonly cause: DeathCause;
  /** Played once per cutscene, this many world ticks after the animation starts. */
  readonly cue: { readonly sound: CutsceneSoundCue; readonly atFrame: number };
}

/** Half a second after the breach settles, to see the pool spread before "You Died". */
const SHARK_POOL_LINGER_FRAMES = 30;
const SHARK_DEATH_DELAY_FRAMES = SHARK_ATTACK_FRAMES + SHARK_POOL_LINGER_FRAMES;

/** Long enough after the burst to see the blood land and the pool start to spread. */
const DETONATION_POOL_LINGER_FRAMES = 30;
const DETONATION_DEATH_DELAY_FRAMES = TIME_LIMIT_DETONATION_FRAMES + DETONATION_POOL_LINGER_FRAMES;

const DIAGONAL = Math.SQRT1_2;
/** Eight throws round the compass, so the body comes apart every way at once. */
const OUTWARD_THROWS: readonly GoreThrow[] = [
  { dx: 1, dy: 0 },
  { dx: DIAGONAL, dy: DIAGONAL },
  { dx: 0, dy: 1 },
  { dx: -DIAGONAL, dy: DIAGONAL },
  { dx: -1, dy: 0 },
  { dx: -DIAGONAL, dy: -DIAGONAL },
  { dx: 0, dy: -1 },
  { dx: DIAGONAL, dy: -DIAGONAL },
];

export const SCRIPTED_DEATHS = {
  shark_attack: {
    animation: {
      paint: drawSharkAttackSprite,
      frames: SHARK_ATTACK_FRAMES,
      takenAtFrame: SHARK_ATTACK_TAKEN_FRAME,
    },
    decal: drawSharkBloodPoolSprite,
    gore: null,
    deathDelayFrames: SHARK_DEATH_DELAY_FRAMES,
    cause: 'sharkAttack',
    // The recording's bite is already timed to the jaws closing.
    cue: { sound: SCRIPTED_DEATH_CUES.sharkBreachBite, atFrame: 0 },
  },
  time_limit_detonation: {
    animation: {
      paint: drawTimeLimitDetonationSprite,
      frames: TIME_LIMIT_DETONATION_FRAMES,
      takenAtFrame: TIME_LIMIT_DETONATION_TAKEN_FRAME,
    },
    decal: drawTimeLimitBloodPoolSprite,
    gore: { riseTiles: TIME_LIMIT_DETONATION_BODY_RISE_TILES, bursts: OUTWARD_THROWS },
    deathDelayFrames: DETONATION_DEATH_DELAY_FRAMES,
    cause: 'levelTimerRanOut',
    cue: {
      sound: SCRIPTED_DEATH_CUES.timeLimitDetonationBurst,
      atFrame: TIME_LIMIT_DETONATION_TAKEN_FRAME,
    },
  },
} as const satisfies Record<ScriptedDeathKind, ScriptedDeathDef>;
